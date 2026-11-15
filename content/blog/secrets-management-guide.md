---
title: "Secrets management for small teams: from .env files to a vault"
description: "A staged path for handling passwords and API keys: stop leaks, encrypt secrets in Git with SOPS and age, deliver them safely, and know when a vault is worth it."
date: 2026-11-15
tags: [devsecops]
draft: true
---

Every application needs a handful of values that must stay private: a database password, an API key, a signing key. Small teams usually start with those values in a `.env` file passed around by chat, and the first leak follows from there. This guide lays out a path in stages, from making the `.env` file safe, through encrypted secrets stored in Git, to a dedicated vault, so you can take the step that fits your team now and recognise when the next one is due.

## What counts as a secret, and how secrets leak

A secret is any value that grants access or proves identity: passwords, API keys and tokens, private keys, database connection strings that embed a password, webhook signing keys, session encryption keys. A useful test is to ask what happens if the value is posted publicly. If the answer is "someone could read our data, spend our money or impersonate us", it is a secret.

Not everything in a configuration file qualifies. Hostnames, port numbers, feature flags and log levels are configuration. Keeping the two apart matters, because configuration can live in plain text in the repository, where it is easy to review, and only the short list of real secrets needs special handling.

Secrets rarely leak through clever attacks. They leak through ordinary work:

- **Git history.** A `.env` file committed once is in the history permanently, even after a later commit deletes it. Anyone who clones the repository has it.
- **Container images.** A `COPY . .` instruction puts the local `.env` into an image layer. Anyone who can pull the image can read every layer.
- **Logs and error pages.** An application that prints its configuration at startup, or a framework debug page that dumps the environment, writes secrets wherever logs go.
- **CI output.** A script that echoes a variable for debugging, or runs with command tracing enabled, prints secrets into build logs that many people can read.
- **Chat, email and tickets.** A password pasted into a message is stored on someone else's servers, searchable, for as long as that service keeps history.
- **Shell history.** A command such as `mysql -pSecretValue` saves the password in the history file.

The stages below close these routes one at a time.

## Stage one: stop the leaks you already have

Before choosing any tool, find out whether secrets are already exposed and stop new ones from being committed.

### Keep plain-text secret files out of Git

Add ignore rules, and commit an example file that documents which variables exist without containing any values:

```bash
cat >> .gitignore <<'EOF'
.env
.env.*
!.env.example
*.pem
*.key
EOF

cat > .env.example <<'EOF'
# Copy to .env and fill in real values. Never commit .env.
DATABASE_URL=
PAYMENT_API_KEY=
SESSION_SIGNING_KEY=
EOF
```

Do the same for images with a `.dockerignore` file containing `.env` and `.env.*`, so a broad `COPY` cannot pick them up. Check that Git really ignores the file:

```bash
git check-ignore -v .env
git ls-files | grep -E '(^|/)\.env' || echo "no env files tracked"
```

### Scan the history

An ignore rule does nothing about what was committed earlier. Gitleaks is an open-source scanner that searches a repository's full history for patterns that look like credentials:

```bash
gitleaks git --redact -v
gitleaks dir --redact -v .
```

The first command scans every commit; the second scans the files in the working directory, including ones that are not tracked. `--redact` keeps the secret values themselves out of the scan output, so the report does not become a new leak.

### Block new leaks at commit time

Gitleaks can run as a pre-commit hook through the `pre-commit` framework, so a commit containing a credential is refused on the developer's machine:

```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/gitleaks/gitleaks
    rev: v8.24.2
    hooks:
      - id: gitleaks
```

```bash
pre-commit install
```

Set `rev` to the current release tag when you add it. A local hook can be skipped, so run the same scan in the CI pipeline as the check that cannot be bypassed; [the DevSecOps pipeline guide](/blog/devsecops-pipeline-github-actions/) shows where it fits.

### If a secret was committed, rotate it first

When a scan finds a real credential, the order of work matters. The value must be assumed copied, so:

1. **Revoke and replace the credential** at the service that issued it. This is the step that removes the risk.
2. Deploy the new value.
3. Check the service's access logs for use of the old credential.
4. Only then consider rewriting Git history to remove the file.

Rewriting history is optional clean-up. It does not reach existing clones, forks or caches, so it never substitutes for rotation.

## Choose the approach that fits your team

There is no single correct tool. The options differ in what they protect and in how much work they need.

| Approach | Secrets stored | Shared by | Audit trail | Operating effort | Fits |
| --- | --- | --- | --- | --- | --- |
| Plain `.env` on each machine | Plain text on disk | Copying by hand | None | None | One developer, one server |
| Encrypted files in Git (SOPS with age) | Encrypted, in the repository | Git | Git history of changes | Low: keys to manage | Small teams, a few services |
| CI platform secret store | Encrypted by the platform | Platform access control | Varies by platform | Low | Values needed only during builds and deploys |
| Dedicated vault (for example HashiCorp Vault) | Central encrypted service | Policies per person and service | Every read and write | High: a service to run | Many services, compliance needs |

These are not mutually exclusive. A common and sound combination for a small team is encrypted files in Git as the source of truth, with a single decryption key stored in the CI platform's secret store.

A plain `.env` file is acceptable for a solo project if three things hold: it is ignored by Git, it is readable only by its owner (`chmod 600 .env`), and a copy exists somewhere safe such as a password manager. Its weakness shows as soon as a second person or a second server appears, because there is then no reliable answer to "which copy is current, and who has it".

## Stage two: encrypted secrets in Git with SOPS and age

SOPS is a tool that encrypts the values in a configuration file while leaving the structure readable. age is a small, modern file encryption tool that SOPS can use for keys. Together they let you commit secrets to the repository safely: the file in Git is ciphertext, and only people holding an authorised private key can read it.

The benefits follow from using Git. Secrets are versioned alongside the code that uses them, a change shows up in review as a changed key name, and there is exactly one current copy.

### Create a key for each person

Each team member generates their own key pair:

```bash
mkdir -p ~/.config/sops/age
age-keygen -o ~/.config/sops/age/keys.txt
chmod 600 ~/.config/sops/age/keys.txt
```

The command prints a line starting with `Public key: age1...`. The public key is safe to share and is what others use to encrypt for you. The file contains the private key and must never leave the machine, apart from a backup in a password manager. On Linux, the path above is where SOPS looks by default; elsewhere, point the `SOPS_AGE_KEY_FILE` environment variable at the file.

### Tell SOPS who may decrypt

A `.sops.yaml` file at the repository root lists the public keys allowed to read each group of files:

```yaml
# .sops.yaml
creation_rules:
  - path_regex: secrets/production\.env$
    age: >-
      age1qqy3k8f2n0x7w5v9m4c6r8t2e0z3h5j7l9p1s3d5f7g9h2k4m6n8q0wxyz,
      age1zzt6m3c9v2b8n4x0l5k7j1h3g9f2d4s6a8p0o2i4u6y8t0r3e5w7q9abcd
  - path_regex: secrets/.*\.env$
    age: >-
      age1qqy3k8f2n0x7w5v9m4c6r8t2e0z3h5j7l9p1s3d5f7g9h2k4m6n8q0wxyz,
      age1zzt6m3c9v2b8n4x0l5k7j1h3g9f2d4s6a8p0o2i4u6y8t0r3e5w7q9abcd,
      age1mmw4p7s1d9g3j5l8z0x2c6v4b8n1q3e5t7u9o2a4f6h8k0r2y4i6dcba
```

The keys shown are made-up examples of the format; use the public keys your team generated. Rules are checked from top to bottom and the first match wins, so the stricter production rule comes first. Here two people can read production secrets and a third can read the rest. Commit this file: it is the readable record of who has access to what.

### Create, edit and read a secrets file

Create the file through SOPS itself, so the plain text never exists on disk:

```bash
sops edit secrets/production.env
```

SOPS opens your editor with sample content. Replace it with your values in the usual `KEY=value` form, save and close. The file written to disk is encrypted. Opening it in a normal editor shows each value replaced by a block beginning `ENC[`, with the key names still readable. The same command edits it later.

If you already have a plain file, encrypt it in place:

```bash
sops encrypt -i secrets/production.env
```

To read values:

```bash
sops decrypt secrets/production.env
```

Verify before committing that no plain value remains. Every data line should contain the `ENC[` marker:

```bash
grep -vE '^(sops_|#|$)' secrets/production.env | grep -vc 'ENC\[' 
```

The command counts data lines without the marker and should print `0`.

### Use the secrets without writing them to disk

Decrypting to a plain file on the server recreates the original problem. SOPS can instead decrypt in memory and start a command with the values as environment variables:

```bash
sops exec-env secrets/production.env 'docker compose up -d'
```

The plain values exist only in the environment of that one command and its child processes.

### Add and remove people

To give a new team member access, add their public key to `.sops.yaml`, then re-encrypt the file's data key for the new list of recipients:

```bash
sops updatekeys secrets/production.env
```

SOPS shows the change and asks for confirmation. Commit the result.

Removing someone takes more than deleting their key from the list. They could read every secret up to that point and may hold copies, and the old ciphertext is still in Git history. So after `updatekeys`, generate a fresh data key for the file and, most importantly, change the secrets themselves at their source:

```bash
sops updatekeys secrets/production.env
sops rotate -i secrets/production.env
```

Treat a departure as a rotation event for every credential that person could decrypt.

### Decrypt in CI and on servers

A pipeline or server needs its own identity. Generate a separate age key pair for it, add its public key to the relevant rule in `.sops.yaml`, and store the private key in the CI platform's secret store, exposed to the job as the `SOPS_AGE_KEY` environment variable. SOPS reads the key from that variable. The machine key gets the same treatment as a person's: its own entry, access only to the files it needs, and replacement if the platform is ever compromised.

## Deliver secrets to the running application

However secrets are stored, the application eventually has to receive them, and there are two common channels.

| Channel | How the application reads it | Weak points |
| --- | --- | --- |
| Environment variable | From its process environment | Inherited by child processes; visible in `docker inspect`; often dumped by debug pages and crash reports |
| File | From a path such as `/run/secrets/db_password` | Needs a few lines of code to read; file permissions must be right |

Files are the safer default for the most sensitive values, because access can be limited by file permissions and nothing prints a file's contents by accident. Docker Compose supports this directly: a secret declared in the Compose file is mounted into the container under `/run/secrets/`, only for the services that list it. Many official images accept a variable ending in `_FILE`, such as `POSTGRES_PASSWORD_FILE`, that names the file to read. The full Compose setup is in [Docker Compose in production](/blog/docker-compose-in-production/).

Whichever channel you use, two rules apply. Do not bake secrets into images, whether through `ENV`, build arguments or copied files; an image is meant to be distributed, and its layers and build history are readable by anyone who can pull it. And do not log them: review what the application prints at startup and on errors.

On the server itself, any decrypted file should belong to the service account and nobody else:

```bash
sudo chown shop:shop /opt/shop/secrets/db_password.txt
sudo chmod 600 /opt/shop/secrets/db_password.txt
stat -c '%U:%G %a %n' /opt/shop/secrets/db_password.txt
```

## Stage three: when a vault is worth running

A vault is a network service that stores secrets centrally and hands them out to authenticated people and applications according to policy. HashiCorp Vault is the best-known example. It solves problems that encrypted files cannot:

- **Per-identity access.** Each person and each service authenticates as itself and can read only the paths its policy allows.
- **An audit log of reads.** Git shows who changed a secret. A vault also records who read it and when.
- **Central rotation.** Change a value once, and every consumer gets the new one on its next fetch.
- **Short-lived credentials.** A vault can generate a database account on demand that expires after minutes or hours, so a leaked credential soon stops working.

The cost is that the vault becomes the most critical service you run. It needs backups, monitoring, upgrades, a recovery procedure, and a plan for what applications do when it is unreachable. If it is down, deployments may stop; if it is compromised, everything is. For a team of three with two services, that operating burden usually outweighs the benefit. Signals that the balance has shifted: more than a handful of services, secrets shared across several teams, an audit or compliance requirement to show who accessed what, or frequent staff changes that make manual rotation a constant chore.

You can get a feel for the workflow on your own machine with Vault's development mode, which runs entirely in memory:

```bash
vault server -dev
```

In a second terminal:

```bash
export VAULT_ADDR='http://127.0.0.1:8200'
vault kv put -mount=secret shop/api db_password='example-only-value'
vault kv get -mount=secret shop/api
vault kv get -mount=secret -field=db_password shop/api
vault kv metadata get -mount=secret shop/api
```

`kv put` writes a secret and `kv get` reads it back, with `-field` printing a single value for use in scripts. The metadata command shows the version history that the key-value engine keeps.

Development mode is for learning only. It listens without TLS, starts already unsealed with a root token, and loses all data when it stops. A production installation needs persistent storage, TLS, a sealing strategy, and applications that authenticate with their own narrow identities rather than a root token. The [Vault documentation](https://developer.hashicorp.com/vault/docs) covers that setup. If you would rather not operate one, the managed secret stores offered by cloud providers give the same central model without the servers.

## Rotation as a routine

A secret that cannot be changed without an outage will never be changed. Make rotation an ordinary, practised task:

- **Keep an inventory.** For each secret, record what it is for, where it is issued, which services use it and when it was last changed. A table in the repository's documentation is enough. The values themselves are never part of it.
- **Use separate credentials per environment and per service.** If staging and production share a database password, a leak from the less protected one compromises both. Separate credentials also mean rotating one does not interrupt the other.
- **Prefer overlap to a hard switch.** Where the issuing service allows two valid keys at once, create the new one, deploy it, confirm it is in use, then revoke the old one.
- **Rotate on events, not only on a calendar.** Someone leaving, a laptop lost, a secret pasted into chat, a dependency compromised: each is a reason to rotate the affected credentials the same day.

Verify a rotation the same way each time: the application works with the new value, and the old value is rejected when you try it.

## Common mistakes

**Deleting a committed secret and considering it handled.** The value is still in history and in every clone. Rotate it.

**Encrypting the file but committing the plain copy too.** A decrypted working copy left next to the encrypted one gets added by a broad `git add`. Use `sops edit` and `sops exec-env` so no plain file exists, and keep the ignore rules from stage one.

**One shared key for the whole team.** If everyone uses the same private key, nobody's access can be removed without re-keying everyone. One key per person and per machine keeps removal a one-line change.

**Losing the only private key.** If the single authorised key is gone, the encrypted files cannot be recovered. Always have at least two recipients, and back up private keys in a password manager.

**Secrets in command-line arguments.** Arguments are visible to other users in the process list and stored in shell history. Pass secrets through files or the environment instead.

**Secrets in the front end.** Anything shipped to a browser or a mobile app is public, whatever the variable is called. Keys that must stay private belong on a server.

**The same value everywhere.** A reused password turns one leak into several. Generate a distinct random value for each use, for example with `openssl rand -base64 32`.

## Frequently asked questions

### Is it really safe to commit encrypted secrets to a public repository?

The encryption is strong enough that the ciphertext alone is not practically useful to an attacker. The risk is elsewhere: a private key that leaks later would unlock every version in the history. For that reason many teams keep encrypted secrets in a private repository anyway, as a second layer.

### Are environment variables a bad way to pass secrets?

They are acceptable and widely used, but they leak more easily than files: child processes inherit them, and diagnostic tools print them. Use files for the most sensitive values where the application supports it, and make sure nothing logs the environment.

### How often should secrets be rotated?

There is no interval that suits every case. Rotate immediately after any suspected exposure and whenever someone with access leaves. Beyond that, pick a schedule you will actually keep, and put the effort into making rotation easy, since an easy rotation gets done.

### What should happen to secrets used only in CI?

Store them in the CI platform's secret store, scoped to the repository and, where the platform supports it, to the deployment environment. Give each one the minimum permissions it needs, and never print them in job output.

### Do small teams need Vault?

Usually not at first. Encrypted files in Git with per-person keys cover storage, sharing and change history with very little to operate. A vault becomes worthwhile when you need per-service access policies, a record of every read, or automatically expiring credentials.
