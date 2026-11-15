---
title: "A DevSecOps pipeline in GitHub Actions: test, scan, deploy"
description: "Build a GitHub Actions pipeline that tests code, scans for secrets and vulnerabilities, builds and signs a container image, and deploys with approval."
date: 2026-11-15
tags: [devsecops]
art:
  kind: flow
  caption: "Each change passes the same checks before it can be deployed."
  items: ["Commit", "Test", "Scan", "Build", "Deploy"]
draft: true
---

Security checks that run by hand, or once a quarter, find problems long after the code that caused them has shipped. DevSecOps means putting those checks into the same automated pipeline that already builds and tests the code, so a leaked credential or a vulnerable dependency fails a pull request the way a broken test does. This guide builds such a pipeline in GitHub Actions, one job at a time.

By the end you will have a single workflow file that tests a Node.js application, scans it for secrets, risky dependencies and code flaws, builds and scans a container image, records where that image came from, and deploys it behind a manual approval.

## The shape of the pipeline

Each stage answers one question, and the cheap, fast questions come first so that most failures are reported within a minute or two.

| Stage | Question it answers | Tool used here | Runs on |
| --- | --- | --- | --- |
| Test | Does the code still work? | The project's own linter and tests | Pull requests and `main` |
| Secret scan | Has a credential been committed? | Gitleaks | Pull requests and `main` |
| Dependency review | Does this change add a vulnerable package? | GitHub dependency review | Pull requests |
| Static analysis | Does the code contain known flaw patterns? | CodeQL | Pull requests and `main` |
| Image build and scan | Does the container image carry known vulnerabilities? | Docker Buildx, Trivy | Pull requests and `main` |
| Publish and attest | Which commit and workflow produced this image? | GitHub Container Registry, artifact attestations | `main` only |
| Deploy | Is someone accountable for releasing it? | A protected environment | `main` only, after approval |

Two principles shape the design. Pull requests run every check but publish nothing, so untrusted changes never get credentials that can push or deploy. And the artifact that was scanned is the artifact that is deployed, identified by its digest, so nothing can be swapped in between.

The examples assume a Node.js project with `lint` and `test` scripts in `package.json` and a `Dockerfile` in the repository root. Substitute your own language's setup and test commands; the security stages do not change.

## Workflow skeleton: triggers and least privilege

Create `.github/workflows/pipeline.yml`. Start with the parts that apply to every job:

```yaml
name: pipeline

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
```

`on` runs the workflow for every pull request and for every push to `main`.

`permissions` controls what the automatic `GITHUB_TOKEN` may do. Every workflow run receives this token, and depending on repository settings it can default to broad write access. Declaring `contents: read` at the top level reduces it to read-only for all jobs; each job that needs more then asks for exactly that. If a step is ever compromised, for example by a malicious dependency executed during tests, the token it can steal is of little use.

`concurrency` cancels a pull request's running pipeline when a newer commit arrives, which saves runner minutes. Runs on `main` are not cancelled, so a deployment is never interrupted halfway.

### A note on action versions

Every `uses:` line runs someone else's code inside your pipeline. The examples reference actions by major version tag, such as `actions/checkout@v7`, because it is readable. A tag can be moved by whoever controls the action's repository, so GitHub's hardening guidance recommends pinning third-party actions to a full commit SHA instead, with the version in a comment:

```yaml
- uses: actions/checkout@<full-40-character-commit-sha> # v7.0.1
```

Copy the SHA from the action's releases page, and let Dependabot keep the pins current by adding a `github-actions` entry to `.github/dependabot.yml`. Major versions change over time, so check each action's releases page for the current one when you adopt this workflow.

## Stage 1: test and lint

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm test
```

`actions/setup-node` installs the requested Node.js version, and `cache: npm` restores npm's download cache between runs, keyed on the lock file. `npm ci` installs exactly the versions recorded in `package-lock.json` and fails if the lock file is out of step, so the pipeline tests the same dependency tree every time.

This job has no extra permissions and no secrets. That is deliberate: tests execute your dependencies' code, which makes this the job most exposed to a compromised package.

## Stage 2: scan the source

Three scanners look at the repository from different angles. They run in parallel with the tests.

### Committed secrets

```yaml
  secrets:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
      - uses: gitleaks/gitleaks-action@v3
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Gitleaks searches commits for strings that look like API keys, tokens and private keys. `fetch-depth: 0` fetches the full history instead of only the latest commit, because a secret added in one commit and deleted in the next is still in the history for anyone to read. For repositories owned by an organisation, the action also requires a `GITLEAKS_LICENSE` secret, which its documentation describes; repositories under a personal account do not need one.

When this job fails, deleting the line is not enough. The credential must be revoked and replaced, because it has already been exposed. The [secrets management guide](/blog/secrets-management-guide/) covers how to keep credentials out of the repository in the first place.

### New vulnerable dependencies

```yaml
  dependency-review:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/dependency-review-action@v5
        with:
          fail-on-severity: high
```

Dependency review compares the dependency manifests on the pull request with those on the base branch and fails if the change introduces a package with a known vulnerability at or above the chosen severity. It judges only what the pull request changes, so it blocks new problems without failing every build over old ones. It works only on pull requests, hence the `if` condition, and relies on the repository's dependency graph, which is available for public repositories and for private ones with GitHub's code security features enabled.

### Static analysis

```yaml
  codeql:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
    steps:
      - uses: actions/checkout@v7
      - uses: github/codeql-action/init@v4
        with:
          languages: javascript-typescript
          build-mode: none
      - uses: github/codeql-action/analyze@v4
```

Static analysis reads the source without running it and looks for patterns that lead to vulnerabilities, such as user input reaching a database query or a shell command. CodeQL is GitHub's analyser. `build-mode: none` suits interpreted languages that need no compilation step. The job asks for `security-events: write` so it can upload results, which then appear in the repository's Security tab and as annotations on the pull request. Like dependency review, code scanning is free for public repositories and needs GitHub's code security features on private ones.

## Stage 3: build the image, scan it, then publish

This job builds the container image once, scans that exact build, and pushes it only if the scan passes and the run is on `main`.

```yaml
  image:
    needs: [test, secrets, codeql]
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
      id-token: write
      attestations: write
    outputs:
      name: ${{ steps.vars.outputs.name }}
      digest: ${{ steps.push.outputs.digest }}
    steps:
      - uses: actions/checkout@v7

      - id: vars
        run: echo "name=ghcr.io/${GITHUB_REPOSITORY,,}" >> "$GITHUB_OUTPUT"

      - uses: docker/setup-buildx-action@v4

      - name: Build for scanning
        uses: docker/build-push-action@v7
        with:
          context: .
          load: true
          tags: scan-target:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Scan image
        uses: aquasecurity/trivy-action@v0.36.0
        with:
          image-ref: scan-target:${{ github.sha }}
          severity: CRITICAL,HIGH
          ignore-unfixed: true
          exit-code: "1"

      - name: Log in to the registry
        if: github.event_name == 'push'
        uses: docker/login-action@v4
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Push
        id: push
        if: github.event_name == 'push'
        uses: docker/build-push-action@v7
        with:
          context: .
          push: true
          tags: ${{ steps.vars.outputs.name }}:${{ github.sha }}
          cache-from: type=gha

      - name: Attest build provenance
        if: github.event_name == 'push'
        uses: actions/attest-build-provenance@v4
        with:
          subject-name: ${{ steps.vars.outputs.name }}
          subject-digest: ${{ steps.push.outputs.digest }}
          push-to-registry: true
```

The reasoning behind each part:

- **`needs`** makes the job wait for the tests and scanners. An image is not built from code that failed them. Dependency review is left out of the list because it is skipped on pushes.
- **The `vars` step** builds the image name from the repository name and converts it to lower case, since registry paths must be lower case and repository names need not be.
- **Buildx** is Docker's current build client. Setting it up enables the GitHub Actions cache backend, `type=gha`, which stores image layers between runs so unchanged layers are not rebuilt. Structuring the Dockerfile so that the cache is effective is covered in [Dockerfile best practices](/blog/dockerfile-best-practices-small-images/).
- **`load: true`** places the built image in the runner's local Docker engine instead of pushing it, so it can be scanned before it exists anywhere else.
- **Trivy** checks the operating system packages and application dependencies inside the image against vulnerability databases. `exit-code: "1"` makes the step fail when it finds anything matching the `severity` list; without it the scan only prints a report. `ignore-unfixed: true` skips vulnerabilities for which no fixed version exists yet, since there is no action you can take on them by upgrading. Tuning the scanner and handling exceptions is a topic of its own: see [container image scanning with Trivy](/blog/container-image-scanning-trivy/).
- **Login and push** run only on pushes to `main`. The registry password is the workflow's own `GITHUB_TOKEN`, made sufficient by `packages: write`, so no long-lived registry credential needs to be stored. The second build reuses the cached layers and completes quickly.
- **The image is tagged with the commit SHA**, not `latest`. Every image traces back to one commit, and deploying or rolling back means naming a specific build.
- **The attestation** is a signed statement recording which repository, commit and workflow produced the image with this digest. It is signed using a short-lived identity issued to the workflow run, which is why the job needs `id-token: write`, and `attestations: write` allows it to be stored. Anyone who pulls the image can later check that it really came from this pipeline.

## Stage 4: deploy behind an approval gate

```yaml
  deploy:
    if: github.event_name == 'push'
    needs: image
    runs-on: ubuntu-latest
    environment: production
    concurrency:
      group: deploy-production
      cancel-in-progress: false
    env:
      IMAGE: ${{ needs.image.outputs.name }}@${{ needs.image.outputs.digest }}
    steps:
      - name: Deploy over SSH
        env:
          SSH_KEY: ${{ secrets.DEPLOY_SSH_KEY }}
          KNOWN_HOSTS: ${{ secrets.DEPLOY_KNOWN_HOSTS }}
          TARGET: ${{ vars.DEPLOY_TARGET }}
        run: |
          install -m 700 -d ~/.ssh
          printf '%s\n' "$SSH_KEY" > ~/.ssh/id_ed25519
          chmod 600 ~/.ssh/id_ed25519
          printf '%s\n' "$KNOWN_HOSTS" > ~/.ssh/known_hosts
          ssh "$TARGET" "docker pull $IMAGE && APP_IMAGE=$IMAGE docker compose -f /srv/app/compose.yaml up -d"
```

The important line is `environment: production`. An environment is a named deployment target configured under the repository's Settings. It can carry protection rules, most usefully *required reviewers*: the job pauses until a named person approves it in the GitHub interface. An environment can also be restricted to particular branches and holds its own secrets, which are released only to jobs that reference the environment and pass its rules. The SSH key above is therefore not readable by the test job or by a pull request.

The deploy step refers to the image by digest (`name@sha256:...`), not by tag. A digest identifies exact content, so the server pulls precisely the image that was scanned and attested.

The SSH command itself is one simple option: it connects as a dedicated deployment user (the `DEPLOY_TARGET` variable holds a value such as `deploy@app.example.com`), pulls the image and restarts the service with Compose, where the Compose file reads the image reference from `APP_IMAGE`. Storing the server's host key in `DEPLOY_KNOWN_HOSTS` lets SSH verify it is talking to the right machine instead of trusting whatever answers. Restrict that deployment account on the server as far as you can; the [SSH hardening guide](/blog/ssh-hardening-guide/) shows how. If you deploy to a cloud provider, prefer its OpenID Connect integration, which exchanges the workflow's identity for short-lived cloud credentials so that no static key is stored in GitHub at all.

The job-level `concurrency` group ensures that two deployments never run at the same time, and `cancel-in-progress: false` lets a running one finish.

## Verify that the pipeline works

A security check that has never failed has never been tested. Prove each stage on a throwaway branch.

1. **Secrets.** Commit a file containing a realistic-looking but fake credential, for example a made-up private key block, and open a pull request. The `secrets` job should fail and name the file. Close the pull request and delete the branch afterwards.
2. **Dependencies.** In a pull request, add an old release of a package that has a published high-severity advisory. The `dependency-review` job should fail and link to the advisory.
3. **Image scan.** Temporarily change the Dockerfile's base image to a release that is several years old. The Trivy step should list findings and fail the job.
4. **Permissions.** Open any job's log and expand the "Set up job" section. It prints the `GITHUB_TOKEN` permissions granted to that job; confirm that `test` has read access only.
5. **Approval.** Merge a change to `main` and confirm that the `deploy` job waits for review and does not start by itself.
6. **Provenance.** After a successful run, verify the attestation from any machine with the GitHub CLI, using your own owner, repository and digest in place of the example values:

```bash
gh attestation verify oci://ghcr.io/example-org/web@sha256:<digest> --repo example-org/web
```

Finally, make the checks mandatory. In the repository's branch protection rule or ruleset for `main`, require pull requests and mark the `test`, `secrets`, `codeql` and `image` jobs as required status checks. Without that, a failing scan is only a suggestion.

## Common mistakes

**Leaving the default token permissions.** A workflow without a `permissions` block may run with write access to the repository. Set read-only at the top and grant more per job.

**Using `pull_request_target` to get secrets into pull request builds.** That trigger runs with the base repository's secrets and a privileged token. If the workflow then checks out and runs the pull request's code, an outside contributor can execute anything with those secrets. Keep building and testing untrusted code under the plain `pull_request` trigger.

**Interpolating untrusted text into scripts.** Writing `${{ github.event.pull_request.title }}` directly inside a `run:` block pastes attacker-controlled text into a shell script. Pass such values through an `env:` variable and reference the variable in the script, as the deploy step above does with its inputs.

**Scans that report but never fail.** A scanner without a failing exit code, or a job marked `continue-on-error`, produces output nobody reads. Decide on a threshold and enforce it.

**Scanning one image and deploying another.** Rebuilding in the deploy job, or deploying a mutable tag, breaks the link between what was checked and what runs. Pass the digest forward.

**Failing on everything from day one.** Turning on every severity for an existing project buries the team in findings and the checks get disabled. Start by failing on critical and high issues with available fixes, clear the backlog, then tighten.

**Long-lived credentials in repository secrets.** Repository-level secrets are available to every workflow in the repository. Put deployment credentials in a protected environment, and replace static cloud keys with OpenID Connect where the provider supports it.

**Forgetting scheduled scans.** New vulnerabilities are published against code that has not changed. Add a `schedule` trigger to rerun the dependency and image scans weekly so that a quiet repository is still checked.

## Frequently asked questions

### Does adding security scans make the pipeline slow?

Less than expected, because the source scans run in parallel with the tests. Secret scanning and dependency review take seconds on most repositories. CodeQL and the image build are the slowest parts; layer caching keeps rebuilds short, and static analysis can be limited to pull requests that touch code.

### What should I do about a vulnerability with no fix available?

Read the advisory and decide whether the vulnerable code is reachable in your application. If it is not, record a documented, time-limited exception in the scanner's ignore file so that it is reviewed again later. If it is, look for a mitigation: a configuration change, a different package or removing the feature.

### Is this pipeline only for containers?

No. The test, secret scanning, dependency review and static analysis stages apply to any project. Replace the image stage with whatever produces your artifact, such as a package or a static site, and keep the same rule: scan what you ship and deploy exactly what you scanned.

### Should third-party actions be pinned to a commit SHA?

For anything beyond a personal experiment, yes. A commit SHA cannot be changed after the fact, whereas a tag can be moved to different code. Pin to the full SHA, note the version in a comment, and use Dependabot to propose updates so the pins do not go stale.

### Can pull requests from forks run this workflow?

Yes, with restrictions that protect you. For pull requests from forks, GitHub provides a read-only token and withholds secrets, so the test and build stages run but uploads that need write access, such as code scanning results, may be refused. Nothing is published or deployed, which is the intended behaviour.
