---
title: "Docker security best practices: hardening containers properly"
description: "Harden Docker at runtime: non-root users, dropped capabilities, read-only filesystems, resource limits, safer networking and daemon settings, with checks."
date: 2026-11-15
tags: [devsecops]
art:
  kind: layers
  caption: "Runtime limits that reduce what a compromised container can do."
  items: ["Non-root user", "Dropped capabilities", "Read-only filesystem", "Resource limits"]
---

A container is a normal Linux process with restrictions placed around it, not a virtual machine. With default settings those restrictions are looser than most people assume: the process usually runs as root, keeps a set of kernel privileges it rarely needs, and can write anywhere in its filesystem. This guide shows how to tighten each of those at runtime, why each setting matters, and how to confirm it took effect.

By the end you will have a hardened `docker run` command and its Compose equivalent that you can adapt to your own services, plus a short list of daemon settings and checks for the host.

## What actually isolates a container

It helps to know which kernel features do the work, because every hardening option in this article adjusts one of them.

- **Namespaces** give the container its own view of processes, network interfaces, mount points and hostnames. They control what the process can *see*.
- **Control groups** (cgroups) limit how much CPU, memory and how many processes it can use.
- **Capabilities** split the all-or-nothing power of root into separate privileges, such as binding low ports or changing file ownership. A container's root user gets only a subset.
- **Seccomp** filters which system calls the process may make. Docker applies a default profile that blocks a number of rarely needed and risky calls.
- **AppArmor or SELinux**, where the host has them, add mandatory access rules on top.

All containers share the host's kernel. That is the main difference from a virtual machine, and it is why the settings below matter: a kernel vulnerability or a careless option can turn a compromised container into a compromised host.

## A hardened run command

Here is a complete example for a web service listening on port 8080. The image name is illustrative; each flag is explained in the sections that follow.

```bash
docker run -d --name web \
  --user 10001:10001 \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --pids-limit 200 \
  --memory 512m \
  --cpus 1.5 \
  --restart unless-stopped \
  -p 127.0.0.1:8080:8080 \
  registry.example.com/web:1.4.2
```

The same settings in a Compose file:

```yaml
services:
  web:
    image: registry.example.com/web:1.4.2
    user: "10001:10001"
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    read_only: true
    tmpfs:
      - /tmp:rw,noexec,nosuid,size=64m
    pids_limit: 200
    mem_limit: 512m
    cpus: 1.5
    restart: unless-stopped
    ports:
      - "127.0.0.1:8080:8080"
```

| Setting | Default behaviour | What the hardened value does |
| --- | --- | --- |
| `--user` | Whatever the image says, often root | Runs the process as an unprivileged UID and GID |
| `--cap-drop ALL` | A default set of capabilities is granted | Removes every capability |
| `--security-opt no-new-privileges` | Processes can gain privileges through setuid binaries | Blocks privilege gain for the process and its children |
| `--read-only` | Root filesystem is writable | Root filesystem is mounted read-only |
| `--tmpfs` | No in-memory scratch space | Provides a small writable, non-executable `/tmp` |
| `--pids-limit` | No limit on process count | Caps the number of processes and threads |
| `--memory`, `--cpus` | No limit | Caps memory and CPU time |
| `-p 127.0.0.1:...` | Published ports listen on all host addresses | Port is reachable only from the host itself |

Not every application runs under all of these on the first try. Add them one at a time, test, and read the error when something fails; the troubleshooting section lists the usual causes.

## Run as a non-root user

If a process running as root inside a container finds a way out, through a kernel bug, a mounted host path or a misconfiguration, it arrives on the host as root. Running as an ordinary user removes most of that risk and costs very little.

There are two places to set the user. The image can declare one with a `USER` instruction, which is the better default because it travels with the image; the [Dockerfile best practices article](/blog/dockerfile-best-practices-small-images/) shows how. At runtime, `--user` overrides whatever the image says:

```bash
docker run --rm --user 10001:10001 alpine id
```

```text
uid=10001 gid=10001 groups=10001
```

The UID does not need to exist in the image's `/etc/passwd`; the kernel only cares about the number. Using a high numeric UID that does not match any real account on the host means that files reached through a bind mount are not accidentally owned by a host user.

Two practical consequences:

- **File permissions.** The process can write only where that UID has permission. Mounted volumes must be owned by, or writable for, the UID you chose.
- **Low ports.** Traditionally a non-root process could not bind ports below 1024. The simplest approach is to have the application listen on a high port such as 8080 and map it with `-p 80:8080` if you need port 80 on the host.

### User namespaces and rootless mode

Two further options change who "root in the container" really is.

*User namespace remapping* is a daemon setting (`userns-remap`) that maps UID 0 inside containers to an unprivileged UID range on the host. A process that is root in the container is nobody special outside it. It applies to every container on the daemon and is incompatible with a few features, such as sharing the host's PID or network namespace.

*Rootless mode* runs the Docker daemon itself as an ordinary user, so neither the daemon nor the containers hold root on the host. It has some limitations around networking and storage, described in the [rootless mode documentation](https://docs.docker.com/engine/security/rootless/). It is a good fit for development machines, build runners and multi-user hosts.

Neither replaces `--user`. They reduce the damage if a container's root is abused; running as non-root makes that abuse harder in the first place.

## Drop capabilities and block privilege escalation

Docker starts containers with a reduced capability set, but it is still generous. By default it includes, among others, `CHOWN`, `DAC_OVERRIDE` (bypass file permission checks), `SETUID` and `SETGID`, `NET_RAW` (craft raw packets), `NET_BIND_SERVICE`, `SYS_CHROOT`, `MKNOD` and `KILL`. A typical web application needs none of them.

Drop everything, then add back only what the application demonstrably needs:

```bash
docker run --rm --cap-drop ALL --cap-add NET_BIND_SERVICE nginx:alpine
```

This allow-list approach is safer than removing capabilities one by one, because anything you did not think about stays off.

`--security-opt no-new-privileges` sets a kernel flag that stops a process from gaining privileges it did not start with, for instance by executing a setuid binary such as `su` or `sudo`. Combined with a non-root user and no capabilities, it means a compromised process has no standard route back up to root inside the container.

### Options that undo all of this

Some flags switch protections off wholesale. Treat each as a red flag in a review:

- `--privileged` grants every capability, disables the seccomp and AppArmor confinement, and gives access to host devices. A privileged container is effectively root on the host.
- `--security-opt seccomp=unconfined` and `--security-opt apparmor=unconfined` remove the system call filter or the mandatory access profile.
- `--pid=host`, `--network=host` and `--ipc=host` share the host's namespaces with the container.
- `--cap-add SYS_ADMIN` grants a capability so broad that it is close to full root.

If a tool's documentation asks for `--privileged`, find out which specific capability or device it needs and grant only that, with `--cap-add` or `--device`.

## Make the filesystem read-only

An attacker who gains code execution usually wants to write something: a downloaded tool, a web shell, a modified configuration. `--read-only` mounts the container's root filesystem read-only, so those writes fail.

Applications still need somewhere to write temporary files, so pair it with explicit writable locations:

- `--tmpfs /tmp:rw,noexec,nosuid,size=64m` gives an in-memory `/tmp` with a size cap. `noexec` prevents running programs from it, which blocks the common download-and-execute pattern.
- Named volumes for data that must persist, such as uploads or a database directory.

A read-only root filesystem also enforces a good habit: the container holds no state of its own, so it can be replaced at any time.

Be careful with bind mounts of host paths. Mount only the directory the application needs, never a broad path like `/` or `/etc`, and add `:ro` when the container only reads:

```bash
docker run -d --read-only \
  -v /srv/web/config:/app/config:ro \
  -v web-uploads:/app/uploads \
  registry.example.com/web:1.4.2
```

### The Docker socket

The single most dangerous mount is `/var/run/docker.sock`. Whoever can talk to that socket can start a privileged container with the host's filesystem mounted, which is full root on the host. Mounting it read-only does not help, because the API calls still go through. Avoid giving the socket to containers; if a tool truly needs Docker API access, place a filtering proxy in front that allows only the specific API calls required, and treat that container as highly privileged.

For the same reason, membership of the `docker` group on the host is equivalent to root access. Grant it as carefully as you would grant `sudo`.

## Limit resources

Without limits, one container can exhaust the host: a memory leak pushes other services into the out-of-memory killer, and a fork bomb fills the process table. Limits turn a host-wide outage into one container's problem.

- `--memory 512m` sets a hard ceiling. A container that exceeds it is killed by the kernel, and `docker inspect` then reports `OOMKilled: true`.
- `--cpus 1.5` allows at most one and a half CPUs' worth of time.
- `--pids-limit 200` caps the number of processes and threads.

Choose values from measurement, not guesswork: watch real usage for a while and set the limit comfortably above the normal peak.

```bash
docker stats --no-stream
```

Add log limits too. With the default `json-file` logging driver, logs grow without bound unless rotation is configured, and a chatty container can fill the disk. Set limits per container with `--log-opt max-size=10m --log-opt max-file=3`, or once for the whole daemon as shown below.

## Network exposure

### Publish only what you must, where you must

`-p 8080:8080` publishes the port on every address the host has, including public ones. If the service sits behind a reverse proxy on the same host, bind it to loopback:

```bash
docker run -d -p 127.0.0.1:8080:8080 registry.example.com/web:1.4.2
```

This matters more than it seems, because Docker inserts its own packet filtering rules for published ports, and those are processed before the rules that host firewall tools such as ufw manage. A port you believed was blocked by the firewall can be reachable from the internet anyway. The [nftables guide](/blog/nftables-firewall-guide/) explains the packet path; the safest habit is not to publish a port publicly unless it is meant to be public.

Databases, caches and internal APIs usually need no published port at all. Containers on the same Docker network reach each other directly by service name.

### Separate networks

Put containers on user-defined networks instead of the default bridge. User-defined networks provide name resolution between containers, and only containers attached to the same network can talk to each other. Splitting an application into a front-end network and a back-end network means a compromised web container cannot reach services it has no business reaching.

A network created with `--internal` has no route to the outside world, which suits databases:

```bash
docker network create frontend
docker network create --internal backend

docker run -d --name cache --network backend redis:7-alpine
docker run -d --name web --network frontend -p 127.0.0.1:8080:8080 registry.example.com/web:1.4.2
docker network connect backend web
```

Here the cache can be reached by `web` and nothing else, and has no outbound internet access. The same layout applies to a database.

## Harden the daemon and the host

Daemon-wide defaults live in `/etc/docker/daemon.json`. A reasonable starting point:

```json
{
  "icc": false,
  "no-new-privileges": true,
  "live-restore": true,
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
```

- `icc: false` disables communication between containers on the default bridge network.
- `no-new-privileges: true` applies that flag to every container by default.
- `live-restore: true` keeps containers running while the daemon restarts, which makes it less painful to apply Docker updates promptly.
- The logging options rotate logs for containers created after the change.

Validate the file and restart the daemon. A syntax error in this file prevents Docker from starting, so validate first:

```bash
sudo dockerd --validate --config-file /etc/docker/daemon.json
sudo systemctl restart docker
```

Beyond the configuration file:

- **Keep Docker and the kernel patched.** Container escapes are fixed by updates to the runtime and the kernel, and no flag substitutes for them.
- **Do not expose the Docker API over TCP without mutual TLS.** An unauthenticated API port is remote root. For remote administration, use SSH (`docker -H ssh://user@host`).
- **Harden the host itself.** The container boundary is only as strong as the machine under it; work through the [Linux server hardening checklist](/blog/linux-server-hardening-checklist/).
- **Keep secrets out of images and environment variables where you can.** Environment variables are visible in `docker inspect` to anyone with API access. Mount secrets as files instead.
- **Scan images for known vulnerabilities** before running them and on a schedule afterwards. That topic has its own guide: [container image scanning with Trivy](/blog/container-image-scanning-trivy/).

## Verify the result

Do not assume a flag took effect; check the running container.

Ask Docker what it applied:

```bash
docker inspect --format 'user={{.Config.User}} privileged={{.HostConfig.Privileged}} readonly={{.HostConfig.ReadonlyRootfs}} capdrop={{.HostConfig.CapDrop}} secopt={{.HostConfig.SecurityOpt}} pids={{.HostConfig.PidsLimit}} mem={{.HostConfig.Memory}}' web
```

```text
user=10001:10001 privileged=false readonly=true capdrop=[ALL] secopt=[no-new-privileges] pids=200 mem=536870912
```

Ask the kernel, from inside the container:

```bash
docker exec web sh -c 'id; grep -E "CapEff|NoNewPrivs|Seccomp:" /proc/1/status'
```

```text
uid=10001 gid=10001 groups=10001
CapEff:	0000000000000000
NoNewPrivs:	1
Seccomp:	2
```

`CapEff` of all zeros means the main process holds no capabilities. `NoNewPrivs: 1` confirms the escalation block, and `Seccomp: 2` means a system call filter is active. These commands need a shell and `grep` in the image; for minimal images without them, rely on `docker inspect`.

Test the read-only filesystem and the published port:

```bash
docker exec web touch /probe          # should fail: Read-only file system
docker port web                       # should show 127.0.0.1:8080
sudo ss -tlnp | grep 8080             # should list 127.0.0.1, not 0.0.0.0
```

For a broader audit, [Docker Bench for Security](https://github.com/docker/docker-bench-security) is an open source script from Docker that checks a host and its containers against common hardening recommendations and prints what it finds.

## Common mistakes and troubleshooting

**"Permission denied" after switching to a non-root user.** The application is writing to a path owned by root. Fix the ownership in the image at build time, or point the application at a writable volume or tmpfs. Do not solve it by going back to root.

**"Read-only file system" errors.** The application writes somewhere you did not expect: a cache directory, a PID file, a socket. Find the path in the error message and add a `--tmpfs` for it, or configure the application to use `/tmp`.

**The application cannot bind its port.** After `--cap-drop ALL` as a non-root user, use a port above 1024 inside the container, or add back `NET_BIND_SERVICE`.

**`ping` or similar tools stop working.** They need `NET_RAW`, which was dropped. That is expected; add it only for a debugging container.

**The container restarts in a loop with exit code 137.** It was killed, usually for exceeding its memory limit. Confirm with `docker inspect --format '{{.State.OOMKilled}}' web` and raise the limit or fix the leak.

**Hardening only in the `docker run` command.** Flags typed by hand are forgotten on the next deployment. Keep them in a Compose file or deployment manifest under version control; [Docker Compose in production](/blog/docker-compose-in-production/) covers that workflow.

**Using `--privileged` to make an error go away.** It works because it disables everything. Find the specific capability, device or mount that is missing.

**Trusting the firewall to hide published ports.** Check from another machine which ports actually answer.

## Frequently asked questions

### Is Docker secure by default?

The defaults are reasonable for convenience: namespaces, a reduced capability set and a seccomp profile are all on. They are not a hardened configuration. The process typically runs as root, the filesystem is writable, there are no resource limits, and published ports listen on all addresses. The settings in this guide close those gaps.

### Do I need both a non-root user and dropped capabilities?

Yes, they cover different things. Capabilities limit what root can do; a non-root user has no capabilities to begin with but could regain privileges through a setuid binary unless `no-new-privileges` is set. Used together they leave very little to work with.

### Does a read-only filesystem break logging?

Not if the application logs to standard output and standard error, which is the convention for containers. Docker collects those streams outside the container's filesystem. Applications that insist on log files need a volume or tmpfs for the log directory.

### Is rootless Docker enough on its own?

It is a strong layer, because a container escape lands in an unprivileged account instead of root. It does not protect the application's own data or stop a compromised container from attacking its network neighbours, so the per-container settings still apply.

### How often should containers be rebuilt and redeployed?

Whenever the base image or a dependency receives a security fix, and on a regular schedule even without code changes, so that operating system patches reach running containers. A running container never updates itself; only a new image does that.
