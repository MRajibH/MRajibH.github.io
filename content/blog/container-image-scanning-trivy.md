---
title: "Container image scanning with Trivy: find and fix vulnerabilities"
description: "Scan container images with Trivy, read the report, fix what matters, record accepted risks with expiry dates, and fail CI builds on fixable serious issues."
date: 2026-11-15
tags: [devsecops]
art:
  kind: flow
  caption: "Scanning fits into the build as a gate before an image is shipped."
  items: ["Build image", "Scan with Trivy", "Fix or accept findings", "Ship"]
---

A container image carries an operating system's packages and your application's dependencies with it, and both keep collecting publicly known vulnerabilities after the image is built. Trivy is an open-source scanner from Aqua Security that lists those vulnerabilities for any image. This guide shows how to run it, how to read its report without drowning in it, how to fix the findings that matter, and how to make a build fail when a fixable serious issue appears.

Everything here is for scanning images you build or run yourself.

## What Trivy checks, and what it cannot see

Trivy works by reading the contents of an image and comparing what it finds against vulnerability databases. It does not run the image and it does not attack anything. Knowing what it reads tells you how far to trust a clean report.

By default, `trivy image` runs two scanners:

- **Vulnerabilities (`vuln`).** Trivy reads the package manager's records inside the image (for example the dpkg database on Debian and Ubuntu, or the apk database on Alpine) and the dependency manifests and lockfiles of language ecosystems such as Node.js, Python, Go, Java, Ruby, PHP and Rust. Each package and version is matched against known advisories.
- **Secrets (`secret`).** Trivy searches files in the image for patterns that look like credentials, such as cloud access keys or private keys left behind by a `COPY` instruction.

Two more scanners are available on request: `misconfig` for configuration problems and `license` for software licences.

The limits follow from the method:

- **Software installed without a package manager is mostly invisible.** A binary downloaded with `curl` or compiled from source in the Dockerfile leaves no package record. Trivy can still identify Go and Rust binaries that embed their dependency information, but a hand-installed C program will not be reported, however old it is.
- **Only published vulnerabilities are found.** A scanner knows nothing about flaws in your own code or about issues nobody has reported yet.
- **A finding is not proof of exploitability.** The report says a vulnerable version is present. Whether your application ever reaches the vulnerable code is a separate question.

For operating system packages, Trivy uses the distribution's own security advisories rather than the upstream project's. That matters because distributions backport fixes: Debian may patch a flaw without changing the upstream version number. Using vendor data avoids a large class of false alarms. It is also why the same vulnerability can have a different severity in Trivy than in the National Vulnerability Database: the vendor's rating for its own distribution is preferred.

## Install Trivy and run a first scan

On Debian or Ubuntu, add the project's package repository so updates arrive with the rest of the system:

```bash
sudo apt-get install wget gnupg
wget -qO - https://aquasecurity.github.io/trivy-repo/deb/public.key | gpg --dearmor | sudo tee /usr/share/keyrings/trivy.gpg > /dev/null
echo "deb [signed-by=/usr/share/keyrings/trivy.gpg] https://aquasecurity.github.io/trivy-repo/deb generic main" | sudo tee -a /etc/apt/sources.list.d/trivy.list
sudo apt-get update
sudo apt-get install trivy
```

On macOS or Linux with Homebrew, `brew install trivy` does the same job. If you would rather not install anything, run the official container image and give it access to the Docker socket and a cache folder:

```bash
docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$HOME/.cache/trivy:/root/.cache/" \
  aquasec/trivy image registry.example.com/shop/api:1.4.2
```

Mounting the Docker socket gives that container control of the Docker daemon, so use this form on a workstation or a disposable CI runner, not on a shared server. The other installation methods are listed in the [Trivy installation guide](https://trivy.dev/docs/latest/getting-started/installation/).

Now scan an image:

```bash
trivy image registry.example.com/shop/api:1.4.2
```

Trivy looks for the image in the local Docker Engine first, then containerd and Podman, and finally pulls it from the registry. On the first run it downloads its vulnerability database, which takes a moment; later runs reuse the cached copy and refresh it when it is out of date.

You can also scan an image that exists only as a file, which is useful in a pipeline that builds without pushing:

```bash
docker save registry.example.com/shop/api:1.4.2 -o api.tar
trivy image --input api.tar
```

To confirm the tool works end to end, scan a deliberately old public image such as `python:3.4-alpine`. A long list of findings means the database downloaded and matching works.

## Read the report without drowning in it

The default output is one table per target. A target is either the operating system layer or one application manifest, such as a `package-lock.json` found in the image. Each row is one vulnerability in one package:

| Column | Meaning |
| --- | --- |
| Library | The affected package |
| Vulnerability | The identifier, usually a CVE number |
| Severity | CRITICAL, HIGH, MEDIUM, LOW or UNKNOWN |
| Status | Whether a fix exists (see below) |
| Installed Version | What the image contains |
| Fixed Version | The first version without the flaw, if there is one |

The **Status** column is the most useful one for planning work:

| Status | What it means for you |
| --- | --- |
| `fixed` | A patched version exists. Updating removes the finding. |
| `affected` | The package is vulnerable and no fix is available yet. |
| `will_not_fix` | The distribution has decided not to patch this release. |
| `fix_deferred` | A fix is planned but postponed. |
| `end_of_life` | The distribution release no longer receives fixes at all. |

A first scan of a typical image based on a full distribution can list hundreds of rows, most of them LOW or MEDIUM with no fix available. Treating all of them as equally urgent is how teams end up ignoring the scanner. Narrow the report to what you can act on:

```bash
trivy image --severity HIGH,CRITICAL --ignore-unfixed registry.example.com/shop/api:1.4.2
```

`--severity` keeps only the listed levels. `--ignore-unfixed` hides every finding without a patched version, leaving the ones with status `fixed`. What remains is a to-do list: each row is serious, and each row has an upgrade that removes it.

That filter is for prioritising, not for pretending the rest does not exist. Run the unfiltered scan now and then, and look for `end_of_life` in particular. An image built on a distribution release that has reached end of life will never get another fix, and the right response is to move to a supported base image.

For anything beyond reading by eye, use JSON and a query tool such as `jq`:

```bash
trivy image --format json --output report.json registry.example.com/shop/api:1.4.2

jq -r '.Results[] | .Target as $t | .Vulnerabilities[]?
       | select(.Severity == "CRITICAL")
       | [$t, .PkgName, .InstalledVersion, .FixedVersion // "none", .VulnerabilityID]
       | @tsv' report.json
```

To see whether the noise comes from the base image or from your own dependencies, scan each kind separately with `--pkg-types os` and `--pkg-types library`. The answer decides who fixes it and how.

## Fix what the scan finds

Findings fall into three groups, and each has its own fix.

### Operating system packages

Most OS findings disappear when the image is rebuilt on a current base image. Docker reuses cached layers, so an image rebuilt every day can still contain packages from the day the cache was first filled. Force a fresh base and fresh layers:

```bash
docker build --pull --no-cache -t registry.example.com/shop/api:1.4.3 .
trivy image --severity HIGH,CRITICAL --ignore-unfixed registry.example.com/shop/api:1.4.3
```

`--pull` fetches the newest version of the base image tag and `--no-cache` reruns every instruction. If findings remain because the base image itself lags behind, apply the distribution's pending updates in the Dockerfile:

```dockerfile
FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get upgrade -y \
 && rm -rf /var/lib/apt/lists/*
```

The longer-term fix is fewer packages. Every package you do not ship is a package that can never appear in a report. Slim base images and multi-stage builds, where compilers and build tools stay in a stage that is thrown away, routinely remove most findings in one step. [Dockerfile best practices for small images](/blog/dockerfile-best-practices-small-images/) covers both techniques.

### Application dependencies

For a finding under a language manifest, the Fixed Version column tells you the target. Update the dependency in the project, not in the image:

```bash
npm install express@latest
npm audit fix
```

then commit the changed lockfile and rebuild. When the vulnerable package is a dependency of a dependency, update the direct dependency that pulls it in, or use your package manager's override mechanism to force the patched version, and run your tests. Scanning the source tree catches these before an image is ever built:

```bash
trivy fs --severity HIGH,CRITICAL .
```

### Secrets in layers

If Trivy reports a secret inside an image, deleting the file in a later Dockerfile instruction does not help: the earlier layer still contains it, and anyone who can pull the image can extract it. Treat the credential as exposed. Revoke and replace it first, then fix the build so the file never enters the image, using a `.dockerignore` entry or a build secret. [Secrets management for small teams](/blog/secrets-management-guide/) explains how to keep credentials out of builds in the first place.

After any fix, rescan and compare. A fix is verified when the row is gone from the report, not when the Dockerfile looks right.

## Record accepted risks instead of ignoring them

Some findings cannot be fixed today: no patch exists, or the vulnerable function is in a component your application never calls. Leaving them in a failing report trains everyone to ignore red builds. Hiding them silently is worse. The middle path is a written exception that expires.

Create a file named `.trivyignore` in the directory where Trivy runs (the identifiers below are examples of the format, not real findings):

```txt
# No fix released yet for the base image. Vendor tracking the issue.
CVE-2024-12345 exp:2026-12-31

# Affects a command-line tool that is not used by the service.
CVE-2023-98765 exp:2027-01-31
```

Each line is one identifier. The optional `exp:` date makes the exception lapse on that day, after which the finding returns and someone has to look at it again. Always set one. An exception without an end date is a permanent blind spot.

For more precision there is a YAML form, which can limit an exception to one file path and record the reason in a structured field. It is marked experimental and must be passed explicitly:

```yaml
# .trivyignore.yaml
vulnerabilities:
  - id: CVE-2024-12345
    paths:
      - "usr/local/lib/python3.12/site-packages/setuptools-70.0.0.dist-info/METADATA"
    statement: Build-time tool only, not reachable at run time
    expired_at: 2026-12-31
```

```bash
trivy image --ignorefile .trivyignore.yaml registry.example.com/shop/api:1.4.3
```

Keep the ignore file in version control next to the Dockerfile. Changes to it then go through the same review as code, and the history shows who accepted which risk and when. To audit what is currently hidden, add `--show-suppressed` to a scan.

## Fail the build on findings you can fix

A scan that someone has to remember to run will stop being run. The durable setup is a pipeline step that blocks a release when the image contains a serious vulnerability with an available fix.

The mechanism is the exit code. Trivy exits with `0` even when it finds problems, unless told otherwise:

```bash
trivy image --exit-code 1 --severity HIGH,CRITICAL --ignore-unfixed registry.example.com/shop/api:1.4.3
echo "exit code: $?"
```

With `--exit-code 1`, any finding that survives the filters makes the command fail, and a failing command fails the pipeline. The combination with `--ignore-unfixed` is deliberate. Blocking a release over a flaw that has no patch gives the developer nothing to do except add an exception, which teaches the team to add exceptions by reflex.

In GitHub Actions, the Trivy project maintains an action that wraps the same options. This workflow builds the image, uploads the full report to the repository's code scanning view, then applies the gate:

```yaml
name: image-scan
on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read
  security-events: write

jobs:
  scan:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4

      - name: Build image
        run: docker build -t shop/api:${{ github.sha }} .

      - name: Full report for the Security tab
        uses: aquasecurity/trivy-action@v0.36.0
        with:
          image-ref: shop/api:${{ github.sha }}
          format: sarif
          output: trivy-results.sarif

      - name: Upload report
        if: always()
        uses: github/codeql-action/upload-sarif@v4
        with:
          sarif_file: trivy-results.sarif

      - name: Gate on fixable high and critical findings
        uses: aquasecurity/trivy-action@v0.36.0
        with:
          image-ref: shop/api:${{ github.sha }}
          format: table
          exit-code: "1"
          ignore-unfixed: true
          severity: CRITICAL,HIGH
          trivyignores: .trivyignore
```

Two details deserve attention. The report step has no exit code set, so it always records everything; only the last step can fail the job. And `if: always()` on the upload keeps the report available even when a step fails.

The workflow above refers to the action by a version tag to stay readable. In a real repository, replace each tag with the full commit SHA of the release you have reviewed. A tag can be moved to point at different code; a commit SHA cannot. This is not a theoretical concern for this action: in March 2026 an attacker repointed most of its version tags to malicious commits, and the [project's advisory](https://github.com/aquasecurity/trivy/security/advisories/GHSA-69fq-xp46-6x23) notes that workflows pinned to a commit SHA were not affected. The same rule applies to every third-party action, and [the DevSecOps pipeline guide](/blog/devsecops-pipeline-github-actions/) shows where image scanning sits among the other checks.

If you scan the same way locally and in CI, put the shared options in a `trivy.yaml` file at the repository root, which Trivy reads automatically:

```yaml
severity:
  - HIGH
  - CRITICAL
ignorefile: .trivyignore
vulnerability:
  ignore-unfixed: true
```

## Keep scanning after the image ships

An image that passed its scan on the day it was built becomes vulnerable later without changing by a single byte, because new advisories are published against the packages inside it. Scanning only at build time therefore misses the images that matter most: the ones running in production.

Two habits close the gap.

**Rescan on a schedule.** Run a nightly job that scans the image tags currently deployed, using the same gate as the build. When it fails, the fix is usually a rebuild on the updated base image, followed by a normal deployment.

**Keep a software bill of materials.** A software bill of materials (SBOM) is a machine-readable list of everything in the image. Generate one at build time and store it with the release:

```bash
trivy image --format cyclonedx --output api-1.4.3.cdx.json registry.example.com/shop/api:1.4.3
```

Later, check that list against the current database without needing the image itself:

```bash
trivy sbom api-1.4.3.cdx.json
```

This is fast, works for images that have since been deleted from the registry, and answers the question that follows every widely reported vulnerability: which of your releases contain the affected package.

## Common mistakes

**Scanning only the `latest` tag.** The tag moves. Scan the exact tag or digest that will be deployed, and deploy that same reference.

**Failing the build on every severity from day one.** The first run blocks all work and the scanner gets switched off. Start with fixable CRITICAL and HIGH findings, clear them, then tighten.

**Treating a clean report as a secure image.** The scan says nothing about software installed outside a package manager, about your own code, or about how the container is run. Runtime settings such as a non-root user and dropped capabilities are a separate job, covered in [Docker security best practices](/blog/docker-security-best-practices/).

**Exceptions with no expiry and no reason.** Six months later nobody remembers why a CVE is in the ignore file. Write the reason as a comment and set an `exp:` date.

**A stale or missing database in CI.** If a runner cannot reach the registry that hosts the database, the scan fails or uses old data. Cache the Trivy cache directory between runs. For an air-gapped runner, download the database on a connected machine with `trivy image --download-db-only`, copy the cache across, and scan with `--skip-db-update`, accepting that results are only as fresh as the last copy.

**Scanning the wrong architecture.** Trivy loads the `linux/amd64` variant of a multi-platform image by default. If you deploy to ARM servers, pass `--platform linux/arm64` so the report describes what actually runs.

**Timeouts on large images.** The default scan timeout is five minutes. For very large images raise it with `--timeout 15m`, and consider why the image is that large.

## Frequently asked questions

### Does Trivy send my image or code anywhere?

No. In its default standalone mode the scan runs locally. Trivy downloads the vulnerability database to the machine and does the matching there. The image contents are not uploaded.

### Why does the same image show different results on different days?

The image has not changed, but the database has. New advisories are published continuously, and vendors revise severities and fix information. This is the reason for rescanning deployed images on a schedule.

### Should the build fail on vulnerabilities that have no fix?

Usually not. A failing build should be something the developer can resolve by taking an action. Report unfixed findings, review them periodically, and act on the patterns: many unfixed findings in one base image is a reason to change the base image.

### Is scanning the image enough, or should the Dockerfile be scanned too?

They answer different questions. The image scan reports vulnerable packages. A configuration scan, run with `trivy config .` in the repository, reports risky build instructions such as running as root. Use both.

### Can Trivy scan images in a private registry?

Yes. Trivy uses the credentials Docker already has, so after `docker login registry.example.com` a scan of an image in that registry works the same way as a public one.
