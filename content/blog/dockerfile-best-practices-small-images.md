---
title: "Dockerfile best practices: smaller, faster, safer images"
description: "Write Dockerfiles that build quickly and ship small images: layer ordering, build cache, multi-stage builds, base image choice and build secrets."
date: 2026-11-15
tags: [devsecops]
art:
  kind: flow
  caption: "A multi-stage build keeps compilers and build tools out of the final image."
  items: ["Build stage", "Copy the result", "Small runtime image"]
---

A Dockerfile that merely works is easy to write. One that rebuilds in seconds after a code change, produces an image a fraction of the size, and does not ship compilers, credentials or stale packages takes a little more thought about how builds actually work. This guide explains the mechanics behind layers and the build cache, then applies them step by step to a real Dockerfile.

By the end you will be able to structure a multi-stage build, choose a base image on its merits, keep secrets out of image history, and measure whether each change helped.

## How layers and the build cache work

An image is a stack of read-only *layers*. Instructions that change the filesystem, mainly `RUN`, `COPY` and `ADD`, each add one layer containing the files that instruction changed. Other instructions such as `ENV`, `CMD` and `EXPOSE` only record metadata.

Two consequences follow, and most of the advice in this article comes from them.

**Layers only add.** If one instruction downloads a 200 MB archive and a later instruction deletes it, the image still carries the 200 MB, because the earlier layer is unchanged and the later one merely marks the file as removed. Anything that should not be in the final image has to be removed in the *same* instruction that created it, or never enter the final image at all.

**The cache is sequential.** When you rebuild, the builder reuses the stored result of an instruction if nothing it depends on has changed. For `RUN` that means the command text and everything before it; for `COPY` it also means the content of the copied files. The first instruction that misses the cache forces every instruction after it to run again.

So the order of instructions decides how much work a rebuild repeats. Put the things that change rarely at the top and the things that change with every commit at the bottom.

## Order instructions so the cache does its job

Here is a common first attempt for a Node.js application:

```dockerfile
FROM node:24
WORKDIR /app
COPY . .
RUN npm install
CMD npm start
```

Every source change, even a one-line edit, alters what `COPY . .` copies. That invalidates the cache for the `npm install` below it, so all dependencies are downloaded and installed again on every build.

The fix is to copy only the files that define the dependencies, install, and copy the rest afterwards:

```dockerfile
FROM node:24-bookworm-slim
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
CMD ["node", "src/server.js"]
```

Now the install layer is rebuilt only when `package.json` or `package-lock.json` changes. An ordinary code change reuses it and the build drops to the time it takes to copy the source.

The same pattern applies in every ecosystem: copy `requirements.txt` before `pip install`, `go.mod` and `go.sum` before `go mod download`, `pom.xml` before resolving Maven dependencies.

Two details in that example are worth noting. `npm ci` installs exactly what the lock file specifies and fails if the lock file and `package.json` disagree, which makes builds repeatable; `npm install` may quietly resolve newer versions. And `CMD` uses the JSON array form, explained later.

### Keep package manager steps together

When installing operating system packages, update the index, install and clean up in one `RUN`:

```dockerfile
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
```

Splitting `apt-get update` into its own instruction causes a subtle bug: that layer is cached, so a later change to the package list installs from an index that may be weeks old, and the install can fail or pick outdated versions. Keeping them together means that changing the package list re-runs the update too. `--no-install-recommends` skips optional packages, and removing the lists in the same instruction keeps them out of the layer.

## Keep the build context small with .dockerignore

Before the build starts, the client sends the *build context*, the directory you pass to `docker build`, to the builder. Everything in it can be copied into the image, and `COPY . .` copies all of it.

A `.dockerignore` file next to the Dockerfile excludes paths from the context:

```text
.git
node_modules
dist
coverage
.env
.env.*
*.log
Dockerfile
.dockerignore
```

This does three useful things. It makes builds faster, because less data is transferred. It stops irrelevant changes, such as a new commit in `.git` or a test report, from invalidating the `COPY . .` layer. And it is a security control: a local `.env` file or a private key in the project directory cannot end up in the image if it never enters the context.

Excluding `node_modules` also prevents dependencies built on your workstation, possibly for a different operating system, from overwriting the ones installed inside the image.

## Multi-stage builds: build in one image, run in another

Building software needs compilers, development headers, test tools and development dependencies. Running it needs almost none of those. A multi-stage build uses several `FROM` instructions in one Dockerfile; each starts a new stage, and a later stage can copy specific files out of an earlier one. Only the final stage becomes the image you ship.

```dockerfile
# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

FROM deps AS build
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
EXPOSE 8080
CMD ["node", "dist/server.js"]
```

What each stage is for:

- **`deps`** installs all dependencies, including the development ones the build needs.
- **`build`** starts from `deps`, adds the source and compiles it into `dist/`.
- **`prod-deps`** installs only production dependencies. `--omit=dev` leaves out everything listed under `devDependencies`.
- **`runtime`** starts from a clean base and copies in just the production dependencies and the compiled output. The source tree, the development dependencies and the npm cache never reach it.

The first line, `# syntax=docker/dockerfile:1`, tells the builder to use the current stable release of the Dockerfile syntax, which makes features such as `RUN --mount` available regardless of the Docker version installed.

`--mount=type=cache` attaches a directory that persists between builds on the same builder but is not part of any layer. npm's download cache lives there, so even when the lock file changes and the install has to run again, packages already downloaded are not fetched a second time, and the cache adds nothing to the image size.

BuildKit, the default builder in current Docker releases, builds only the stages the target depends on and runs independent stages in parallel, so `prod-deps` is built alongside `deps` and `build`.

### Building a single stage

`--target` stops at a named stage, which lets one Dockerfile serve several purposes:

```bash
docker build --target build -t web:build .
docker build -t web:1.4.2 .
```

The first command produces an image with the full toolchain, useful for running tests in CI. The second builds the final stage.

### Compiled languages go further

For languages that compile to a single static binary, the runtime stage can be almost empty. A Go service, for example:

```dockerfile
# syntax=docker/dockerfile:1

FROM golang:1.25-bookworm AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -o /out/server ./cmd/server

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/server /server
ENTRYPOINT ["/server"]
```

`CGO_ENABLED=0` produces a binary with no dependency on the C library, so it runs on a base image that contains no shell, no package manager and no libraries, only essentials such as CA certificates and time zone data. The `nonroot` tag runs as an unprivileged user by default.

## Choose the base image deliberately

The base image decides most of the final size, the number of packages that can have vulnerabilities, and how easy the container is to debug.

| Base type | Example | Contents | Trade-offs |
| --- | --- | --- | --- |
| Full distribution | `node:24`, `debian:bookworm` | Complete userland, build tools in language images | Largest; convenient for build stages, wasteful for runtime |
| Slim | `node:24-bookworm-slim`, `debian:bookworm-slim` | Trimmed Debian with the same C library (glibc) | Good default; compatible with most prebuilt packages |
| Alpine | `node:24-alpine`, `alpine` | Very small userland based on musl libc and BusyBox | Smallest general-purpose option; musl can cause incompatibilities or slower builds for native modules |
| Distroless | `gcr.io/distroless/static-debian12` | Runtime files only, no shell or package manager | Very small attack surface; debugging needs other tools |
| `scratch` | `FROM scratch` | Nothing | Only for fully static binaries; you supply certificates and user data yourself |

Some guidance for picking:

- Use a **slim** image when you want the smallest change from a standard Linux environment. Prebuilt binaries for Python wheels and Node native modules generally target glibc and work unmodified.
- Use **Alpine** when size matters and your dependencies are known to work with musl. If a native dependency has no musl build, it will be compiled from source during the build, which needs a toolchain and takes longer.
- Use **distroless** or **scratch** for services where nobody should be running a shell in production anyway. With no shell, `docker exec` for debugging is not available; attach a separate debugging container instead when you need to inspect one.

### Pin what you build from

A tag such as `node:24-bookworm-slim` is a moving pointer: the publisher updates it when patches are released. That is useful, since rebuilding picks up security fixes, but it also means two builds of the same Dockerfile on different days can produce different images.

Avoid `latest`, which can jump to a new major version without warning. Pin at least the major version and the distribution release. For fully repeatable builds, pin the digest, the content hash that identifies one exact image:

```bash
docker buildx imagetools inspect node:24-bookworm-slim
```

The output includes a `Digest:` line. Append that value to the tag in your `FROM` line in the form `node:24-bookworm-slim@sha256:` followed by the hash. The tag is then only a label for humans, and the digest decides what is pulled. Pinned digests do not update themselves, so pair them with an automated dependency update tool that opens a pull request when the base image changes; otherwise you trade unpredictability for missing patches.

## Keep secrets out of the image

Anything written into a layer stays readable by everyone who can pull the image, even if a later instruction deletes it. `docker image history` also displays build arguments and environment values. These patterns all leak:

- `COPY .npmrc .` followed later by `RUN rm .npmrc`: the file is still in the earlier layer.
- `ARG NPM_TOKEN` used in a `RUN` command: the value is recorded in the image history.
- `ENV API_KEY=...`: stored in the image configuration and visible in `docker inspect`.

For credentials needed *during the build*, such as a token for a private package registry, use a secret mount. The file is available to that one `RUN` instruction and is never written to a layer:

```dockerfile
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc \
    --mount=type=cache,target=/root/.npm \
    npm ci
```

```bash
docker build --secret id=npmrc,src="$HOME/.npmrc" -t web:1.4.2 .
```

Credentials needed *at runtime* do not belong in the image at all. Supply them when the container starts, as mounted files or through a secrets manager; the [secrets management guide](/blog/secrets-management-guide/) goes through the options.

## Runtime details that belong in the Dockerfile

A few instructions affect how the container behaves once it runs.

**Set a non-root user.** Without a `USER` instruction the process runs as root. The official Node images include an unprivileged `node` account, used in the example above. On a base image without one, create it:

```dockerfile
RUN groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --no-create-home app
USER 10001:10001
```

If the application needs to write to a directory, give that user ownership while copying, with `COPY --chown=10001:10001`, instead of running a separate `chown`, which would duplicate the files in a new layer. Runtime hardening beyond this, such as capabilities, read-only filesystems and resource limits, is covered in [Docker security best practices](/blog/docker-security-best-practices/).

**Use the exec form for `CMD` and `ENTRYPOINT`.** `CMD ["node", "dist/server.js"]` starts the program directly as process 1 in the container. The shell form, `CMD node dist/server.js`, wraps it in `/bin/sh -c`, and the shell does not pass signals on. When Docker stops the container it sends `SIGTERM` to process 1; with the shell form your application never receives it, cannot shut down cleanly, and is killed after the timeout.

**Prefer `COPY` to `ADD`.** `ADD` also fetches URLs and unpacks local archives automatically, which is surprising when you did not intend it. Use `COPY` for files from the context and reserve `ADD` for the cases that need its extra behaviour.

**Label the image.** Standard labels make it possible to trace an image back to its source:

```dockerfile
LABEL org.opencontainers.image.source="https://github.com/example/web" \
      org.opencontainers.image.description="Web front end"
```

## Verify what you built

Measure before and after every change; assumptions about size are often wrong.

```bash
docker image ls web
docker image history web:1.4.2
```

`history` lists every layer with its size and the instruction that created it. A single unexpectedly large line is usually a `COPY` that picked up too much or a `RUN` that left caches behind.

Check for common Dockerfile problems without building:

```bash
docker build --check .
```

This runs the builder's built-in checks and reports issues such as a shell-form `CMD` or inconsistent keyword casing. [Hadolint](https://github.com/hadolint/hadolint) is a dedicated linter that goes further, including checks on the shell commands inside `RUN` instructions.

Confirm that the cache is working by building twice and reading the output. On the second build, unchanged steps are marked `CACHED`. If a step you expected to be cached runs again, look at the instruction just above it for something that changes on every build.

Confirm that the image runs as the user you intended and contains what you expect:

```bash
docker run --rm --entrypoint id web:1.4.2
docker run --rm --entrypoint ls web:1.4.2 -la /app
```

These two commands need the `id` and `ls` programs to exist in the image, so they do not apply to distroless or scratch images.

Finally, scan the result for known vulnerabilities in its packages. A smaller image has fewer of them, but not none; see [container image scanning with Trivy](/blog/container-image-scanning-trivy/).

## Common mistakes

**`COPY . .` before installing dependencies.** Every code change reinstalls everything. Copy manifests first.

**Cleaning up in a separate `RUN`.** `RUN rm -rf /var/lib/apt/lists/*` on its own line removes nothing from the image size. Clean up in the instruction that created the files.

**No `.dockerignore`.** The context includes `.git`, local dependencies and possibly credentials, making builds slow and leaky.

**Shipping the build stage.** A single-stage image for a compiled or bundled application carries the compiler and development dependencies into production.

**Using `latest` as the base.** Builds change unpredictably and cannot be reproduced later.

**Passing secrets through `ARG` or `ENV`.** They are stored in the image metadata. Use secret mounts.

**Running `apt-get upgrade` to "stay current".** It makes builds less predictable and bloats layers. Rebuild regularly on an updated base image instead, with `docker build --pull` to make sure the newest version of the base tag is fetched.

**One container, many processes.** Starting a database, an application and a cron daemon from one image makes the image large and the container hard to supervise. Give each process its own image and connect them with Compose.

**Chasing size at the expense of everything else.** A 40 MB image that cannot be debugged, or that breaks a native dependency, is not an improvement over a 150 MB image that works. Remove what is unnecessary, then stop.

## Frequently asked questions

### Does a smaller image really make a difference?

Yes, in three ways. It is pulled and started faster, which matters for deployments and autoscaling. It costs less to store and transfer. And it contains fewer packages, which means fewer vulnerabilities to patch and fewer tools available to an attacker who gets in.

### Should I always use Alpine?

No. Alpine is small, but it uses musl instead of glibc, and some software behaves differently or lacks prebuilt binaries for it. A slim Debian-based image is a safer default; move to Alpine or distroless when you have confirmed your dependencies work there.

### How many stages should a multi-stage build have?

As many as make the Dockerfile clear and the cache effective. Two, build and runtime, is the minimum that brings the benefit. Extra stages for dependencies or tests are worthwhile when they let unrelated steps run in parallel or be cached separately.

### Do I need to combine every command into one RUN?

No. Combine commands when they belong together, especially when one creates files that another removes. Otherwise, separate `RUN` instructions are easier to read and cache better. With multi-stage builds, layer count in build stages does not affect the final image at all.

### How do I automate building and checking images?

Run the build, the linter and a vulnerability scan in continuous integration on every change, and push only images that pass. [A DevSecOps pipeline in GitHub Actions](/blog/devsecops-pipeline-github-actions/) shows a complete workflow.
