---
title: "Docker Compose in production: what to change before you deploy"
description: "Turn a development Compose file into a production one: pinned images, restart policies, health checks, resource limits, log rotation, secrets and safe updates."
date: 2026-11-15
tags: [devsecops]
art:
  kind: layers
  caption: "What a development Compose file needs before it runs in production."
  items: ["Pinned image versions", "Health checks", "Restart policies", "Resource limits"]
draft: true
---

A Compose file written for development is tuned for convenience: source code mounted from the host, every port published, passwords in plain text, containers that stay down when they crash. Run that file on a server and each of those conveniences becomes an outage or a security problem. This guide goes through the changes that make a Compose project fit for a single production server, with the reason for each and a command that proves it took effect.

It assumes Docker Engine with the Compose plugin (the `docker compose` command, with a space) on a Linux host.

## Decide whether Compose is the right tool

Compose runs a group of containers on one Docker host. For a small service on one server, that is a strength: one file describes the whole system, and one command brings it up. It is worth being clear about what you do not get.

| Need | Compose on one host | An orchestrator (Swarm, Kubernetes) |
| --- | --- | --- |
| Restart a crashed container | Yes, with a restart policy | Yes |
| Survive the loss of the server | No | Yes, with several nodes |
| Updates with no interruption | Not built in; brief restart per service | Rolling updates built in |
| Spread load across machines | No | Yes |
| Operational effort | Low | Considerably higher |

If one server going down for the length of a reboot is acceptable, Compose is a reasonable production choice and the rest of this guide applies. If it is not, no amount of tuning a Compose file will add the missing second machine.

## Separate production settings from development

The cleanest structure is a base file with everything both environments share, plus a small override file per environment that contains only the differences. Compose merges files in the order given, with later files winning.

```yaml
# compose.yaml - shared by every environment
services:
  api:
    image: registry.example.com/shop/api:1.4.2
    environment:
      DATABASE_HOST: db
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:17
    volumes:
      - db-data:/var/lib/postgresql/data

volumes:
  db-data:
```

Development conveniences such as `build: .`, a bind mount of the source tree and a published database port belong in a development override, not here. The production override then adds the hardening covered in the following sections. Start it with:

```bash
docker compose -f compose.yaml -f compose.production.yaml up -d
```

Typing both `-f` flags on every command invites mistakes, such as running a later command against the base file alone. Set them once in a `.env` file next to the Compose files on the server:

```bash
COMPOSE_FILE=compose.yaml:compose.production.yaml
COMPOSE_PROJECT_NAME=shop
```

Before starting anything, print the merged result and read it:

```bash
docker compose config
```

This is the single most useful check in the whole workflow. It shows exactly what Compose will run after merging files and substituting variables, and it fails with an error if the YAML is invalid. Note that the output includes resolved environment values, so do not paste it into a ticket or chat.

The most important removal for production is the source-code bind mount. In production the code should be the code inside the image, so that what runs is exactly what was built and tested, and so that nothing on the host can alter it.

## Pin images and control what gets pulled

`image: postgres:latest` means "whatever was newest when this host last pulled". Two servers, or the same server before and after a cleanup, can end up running different software from an identical Compose file. Pin a specific version for every service:

```yaml
services:
  api:
    image: registry.example.com/shop/api:1.4.2
  db:
    image: postgres:17
```

A tag is still a movable label. For the strictest guarantee, reference the image by digest, which identifies exact content:

```bash
docker buildx imagetools inspect registry.example.com/shop/api:1.4.2
```

```yaml
services:
  api:
    image: registry.example.com/shop/api@sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945
```

The digest above is an example of the format; use the value the inspect command prints for your image.

Build images in a pipeline, not on the production server. Building on the server needs the source code and build tools there, uses the server's CPU while it is serving traffic, and produces an image nobody has tested. The pipeline should build once, scan the result (see [container image scanning with Trivy](/blog/container-image-scanning-trivy/)), push it to a registry, and the server should only pull.

To see what is actually running:

```bash
docker compose images
```

## Keep services running and start them in the right order

### Restart policy

By default a container that exits stays stopped. One unhandled exception at night and the service is down until someone notices. Add a restart policy to every long-running service:

```yaml
# compose.production.yaml
services:
  api:
    restart: unless-stopped
  db:
    restart: unless-stopped
```

| Value | Behaviour |
| --- | --- |
| `"no"` | Never restart (the default) |
| `on-failure` | Restart only after a non-zero exit code |
| `always` | Always restart, including after a manual stop once the daemon restarts |
| `unless-stopped` | Always restart, except when you stopped the container yourself |

`unless-stopped` is the usual choice: it recovers from crashes and reboots but respects a deliberate `docker compose stop` during maintenance. The policy only works across reboots if the Docker daemon itself starts at boot:

```bash
sudo systemctl enable --now docker
systemctl is-enabled docker
```

Verify the policy by simulating a crash: kill the container's main process from the host, then watch the container come back. (Stopping it with `docker compose stop` or `docker compose kill` is not a fair test, because Docker treats those as a deliberate stop.)

```bash
sudo kill -9 "$(docker inspect --format '{{.State.Pid}}' "$(docker compose ps -q api)")"
sleep 5
docker compose ps api
```

### Health checks

"Running" only means the process exists. A database that is still replaying its log, or an API stuck in a deadlock, is running and useless. A health check is a command Docker runs inside the container at intervals to decide whether the service actually works:

```yaml
services:
  db:
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U shop -d shop"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s

  api:
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:8080/healthz"]
      interval: 15s
      timeout: 3s
      retries: 3
      start_period: 20s
```

`start_period` gives the service time to boot before failures count. The command must exist inside the image: a minimal image may have neither `curl` nor `wget`, in which case use a small check built into the application itself.

Health checks make start order meaningful. The short form of `depends_on` only waits for the dependency's container to start. The long form, used in the base file above, waits for it to be healthy:

```yaml
    depends_on:
      db:
        condition: service_healthy
        restart: true
```

`restart: true` additionally restarts the API when Compose recreates the database during an update.

One limit to know: on a single Docker host, an unhealthy container is marked unhealthy but is not restarted automatically. The restart policy reacts to the process exiting, not to a failing health check. The health status is still valuable for start order, for the `--wait` flag shown later, and for monitoring.

## Limit resources and rotate logs

### Memory, CPU and process limits

Without limits, one container with a memory leak can consume the whole host. The kernel then starts killing processes, and it may pick the database rather than the culprit. Give every service a ceiling:

```yaml
services:
  api:
    deploy:
      resources:
        limits:
          cpus: "1.5"
          memory: 512M
          pids: 200
  db:
    deploy:
      resources:
        limits:
          cpus: "2"
          memory: 1G
```

A container that exceeds its memory limit is killed and, with a restart policy, restarted, which contains the damage to that one service. The `pids` limit caps the number of processes and stops a runaway fork loop. Choose numbers from observation rather than guesswork:

```bash
docker stats --no-stream
```

Run it under normal load, then set limits with comfortable headroom above the observed figures.

### Log rotation

Docker's default `json-file` logging driver has no size limit. A chatty service writes until the disk is full, and a full disk takes down everything on the host, including the database. Set rotation per service:

```yaml
services:
  api:
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "5"
```

This keeps at most five files of ten megabytes each per container. The values must be quoted strings. To apply the same default to every container on the host, set it in `/etc/docker/daemon.json` and restart Docker:

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "5"
  }
}
```

Either way, the setting only applies to containers created afterwards. Existing containers keep their old configuration until they are recreated. Confirm what a container actually uses:

```bash
docker inspect --format '{{json .HostConfig.LogConfig}}' "$(docker compose ps -q api)"
```

## Reduce what is exposed

### Publish only what must be reachable

Services in the same Compose project share a private network and reach each other by service name, so the API connects to `db:5432` without any published port. A `ports:` entry is only needed for traffic entering from outside the host. In development it is common to publish the database port to use a desktop client; in production that puts the database on the internet.

There is a trap here on hosts that use `ufw`. Docker's documentation is explicit that published container ports are routed before `ufw`'s rules are applied, so a port published with `"5432:5432"` is reachable from outside even if `ufw` says it is denied. Do not rely on the host firewall to hide a published port. Instead:

```yaml
services:
  db:
    # no ports: section at all

  api:
    ports:
      - "127.0.0.1:8080:8080"
```

The database publishes nothing. The API is published on the loopback address only, so it is reachable by a reverse proxy running on the same host (which terminates TLS and listens on ports 80 and 443) but not directly from the network. A short port entry without an address binds to all interfaces.

Check from the host, then from a different machine:

```bash
sudo ss -tlnp | grep -E ':(8080|5432)\b'
nc -zv -w 3 server.example.com 5432
```

The first command should show 8080 bound to `127.0.0.1` and nothing for 5432. The second, run from elsewhere, should fail to connect.

### Drop privileges inside the container

If an attacker gets code execution inside a container, what they can do next depends on how the container was started. A few lines remove most of the useful options:

```yaml
services:
  api:
    user: "10001:10001"
    read_only: true
    tmpfs:
      - /tmp
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    init: true
```

`user` runs the process as an unprivileged account instead of root. `read_only` makes the container's filesystem immutable, with `tmpfs` providing a writable in-memory `/tmp` for applications that need one. `cap_drop: ALL` removes the Linux capabilities, which are the pieces of root's power, and `no-new-privileges` stops the process from regaining them through setuid programs. `init: true` adds a tiny init process that forwards signals and cleans up child processes.

Apply these to your own application first. Third-party images such as databases often need specific capabilities or a writable path, so test them one option at a time. [Docker security best practices](/blog/docker-security-best-practices/) explains each control in depth.

### Keep secrets out of the Compose file

A password in an `environment:` block ends up in version control, in the output of `docker compose config`, and in `docker inspect`. Compose secrets deliver the value as a file inside the container instead:

```yaml
services:
  db:
    environment:
      POSTGRES_USER: shop
      POSTGRES_DB: shop
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password
    secrets:
      - db_password

  api:
    environment:
      DATABASE_PASSWORD_FILE: /run/secrets/db_password
    secrets:
      - db_password

secrets:
  db_password:
    file: ./secrets/db_password.txt
```

Each listed secret is mounted at `/run/secrets/<name>`, and only in the services that list it. The official PostgreSQL image reads the password from the file named by `POSTGRES_PASSWORD_FILE`; your own application needs a few lines of code to do the same. The file on the host should be readable only by the deploying user (`chmod 600`) and must never be committed. How to get that file onto the server safely is the subject of [secrets management for small teams](/blog/secrets-management-guide/).

## Deploy, update and roll back

With pinned images, an update is a change to a version number in the Compose file, followed by:

```bash
docker compose pull
docker compose up -d --wait --remove-orphans
docker compose ps
```

`pull` downloads the new images while the old containers are still serving. `up -d` then recreates only the services whose image or configuration changed and leaves the rest alone. `--wait` makes the command block until the services are running and healthy, and exit with an error if they do not get there, which turns the health checks into a deployment test a script can act on. `--remove-orphans` deletes containers for services that were removed from the file.

Each recreated service is briefly unavailable while the old container stops and the new one starts. Set `stop_grace_period` if the application needs more than the default ten seconds to finish in-flight requests after receiving the stop signal.

To update one service without touching its dependencies:

```bash
docker compose up -d --no-deps --wait api
```

**Rollback** is the same procedure with the previous version. Because the Compose file is in version control, that is a revert of one commit followed by the same `up` command. This only works when images are pinned and old images remain in the registry.

A rollback of the application does not undo changes to the data. Back up named volumes before any update that includes a database migration:

```bash
docker compose exec -T db pg_dump -U shop shop | gzip > "shop-$(date +%F).sql.gz"
gzip -t "shop-$(date +%F).sql.gz" && ls -lh shop-*.sql.gz
```

A logical dump taken with the database's own tool is safer than copying the volume's files while the database is running. Copy backups off the server, and restore one into a scratch container now and then; a backup that has never been restored is an assumption.

Never run `docker compose down -v` on a production host. The `-v` flag deletes the named volumes, which is where the database lives.

## Common mistakes

**Changes to the Compose file seem to have no effect.** Settings are applied when a container is created. After editing the file, run `docker compose up -d` again; `docker compose restart` restarts the existing containers with their old configuration.

**The stack works until the first reboot.** Either the restart policy is missing or the Docker service is not enabled at boot. Reboot a new server once on purpose, before it carries traffic, and check `docker compose ps` afterwards.

**The database is reachable from the internet despite the firewall.** A published port bypasses `ufw`. Remove the `ports:` entry or bind it to `127.0.0.1`.

**The API starts before the database and crashes in a loop.** The short form of `depends_on` does not wait for readiness. Add a health check to the database and use `condition: service_healthy`.

**A health check always fails.** The check command is missing from the image. Run it by hand with `docker compose exec api wget -q --spider http://localhost:8080/healthz` and read the error.

**The disk fills up.** Unrotated logs and old images are the usual causes. Add log rotation, and remove unused images periodically with `docker image prune`, after confirming you do not need them for a rollback.

**A variable is empty in production.** Compose substitutes `${VARIABLE}` from the shell and the `.env` file at the time the command runs. `docker compose config` shows the substituted result and warns about variables that are not set.

## Frequently asked questions

### Is Docker Compose suitable for production at all?

Yes, for workloads that fit on one server and can tolerate that server being briefly unavailable. Compose handles restarts, ordering, limits and updates well on a single host. It does not provide failover to another machine, so services that must stay up through a server failure need an orchestrator and more than one node.

### Do the `deploy` resource limits work without Swarm?

Yes. The current `docker compose` command applies `deploy.resources.limits` to containers on a single host. Other parts of the `deploy` section, such as `update_config` and `placement`, are meant for an orchestrator. Verify limits with `docker stats`, which shows the memory ceiling per container.

### How do I update without downtime?

Compose has no built-in rolling update on a single host, so each updated service has a short interruption. Keep it short by pulling images before recreating containers, by making the application start quickly, and by using `--wait` so a failed start is detected immediately. If even a few seconds is too much, that is the point to move to an orchestrator.

### Should the reverse proxy be in the same Compose file?

It can be either. Keeping it in the same file documents the whole system in one place and lets the proxy reach the application over the private network, so the application needs no published port at all. A proxy installed on the host is simpler when it serves several separate Compose projects.

### Where should the Compose files live on the server?

In a dedicated directory such as `/opt/shop`, checked out from version control, owned by the deploying user and not writable by others. The secrets directory inside it should be excluded from version control and readable only by that user.
