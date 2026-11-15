---
title: "Writing systemd services: unit files, restarts and sandboxing"
description: "Write a systemd service unit for your own program: service types, restart policy, dependencies, credentials, sandboxing options and debugging."
date: 2026-11-15
tags: [linux]
draft: true
---

A program started from a terminal dies when the session ends, does not come back after a crash or a reboot, and usually runs with far more access than it needs. A systemd service unit fixes all three with a short text file. This guide shows how to write one for your own application, choose the right service type and restart policy, order it correctly against the network and other services, and then confine it with systemd's sandboxing options, checking each step as you go.

The examples use a small web application called `notes-api` installed in `/opt/notes-api`. Everything applies to any distribution that uses systemd, including Debian, Ubuntu and the RHEL family. A few options need a recent systemd version; those are noted where they appear, and `systemctl --version` shows what you have.

## Where unit files live and how they are read

A unit is anything systemd manages: a service, a socket, a timer, a mount. Each is described by a unit file whose suffix gives its type, so a service is `name.service`.

systemd looks for system units in several directories. Three matter in practice:

| Path | Who owns it | Purpose |
|---|---|---|
| `/usr/lib/systemd/system/` | Packages | Units shipped by the distribution. Do not edit. |
| `/etc/systemd/system/` | The administrator | Your own units and overrides. Takes priority. |
| `/run/systemd/system/` | Runtime | Generated units that vanish at reboot. |

A unit you write goes in `/etc/systemd/system/`. To change a unit shipped by a package, do not copy or edit the original. Use a drop-in, a fragment that is merged on top of it:

```bash
sudo systemctl edit nginx.service
```

That opens an editor and saves the result to `/etc/systemd/system/nginx.service.d/override.conf`. The package can update its unit and your changes still apply. `systemctl cat nginx.service` prints the unit together with every drop-in, which is the quickest way to see what is in effect.

systemd reads unit files into memory. After creating or changing one by hand, tell it to read them again:

```bash
sudo systemctl daemon-reload
```

Forgetting this is the most common reason a change appears to do nothing. `systemctl edit` does it for you.

## A minimal service that runs as its own user

Start by creating an account for the service. A dedicated system user with no login shell means a bug in the application cannot touch files belonging to anyone else:

```bash
sudo useradd --system --home-dir /opt/notes-api --shell /usr/sbin/nologin notes
```

Then write `/etc/systemd/system/notes-api.service`:

```ini
[Unit]
Description=Notes API
Documentation=https://example.com/notes-api/docs
After=network-online.target
Wants=network-online.target

[Service]
Type=exec
User=notes
Group=notes
WorkingDirectory=/opt/notes-api
ExecStart=/opt/notes-api/venv/bin/python -m notes_api --port 8080
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

The file has three sections.

**`[Unit]`** holds settings common to every unit type: a description for humans and the relationships to other units. `After=` and `Wants=` are explained in the section on dependencies.

**`[Service]`** says how to run the program. `ExecStart=` must begin with an absolute path. It is not run through a shell, so pipes, redirection and `&&` do not work; if you need them, put them in a script and run the script. `User=` and `Group=` drop root privileges before the program starts.

**`[Install]`** is read only by `systemctl enable`. `WantedBy=multi-user.target` means "start this as part of a normal multi-user boot", which is the right choice for almost every server daemon.

Check the file, then start the service and enable it at boot:

```bash
systemd-analyze verify /etc/systemd/system/notes-api.service
sudo systemctl daemon-reload
sudo systemctl enable --now notes-api.service
systemctl status notes-api.service
```

`systemd-analyze verify` reports unknown directives, misspellings and missing executables before you try to start anything. `enable --now` both enables and starts. In the status output, look for `Active: active (running)` and the last few log lines.

Starting and enabling are separate ideas: `start` runs the service now, `enable` makes it start at boot. A service that is started but not enabled disappears at the next reboot.

## Choose the right service type

`Type=` tells systemd how to know that start-up has finished. That moment matters because units ordered after yours wait for it, and `systemctl start` returns when it is reached.

| Type | Considered started when | Use for |
|---|---|---|
| `simple` | Immediately, before the program has even been executed | The default; acceptable, but `exec` is better |
| `exec` | The program binary has been executed successfully | Most programs that stay in the foreground |
| `notify` | The program sends a readiness message | Daemons that support `sd_notify` |
| `forking` | The initial process exits, leaving a child running | Traditional daemons that background themselves |
| `oneshot` | The program has run to completion and exited | Scripts and set-up tasks |

Some guidance for choosing:

- **Prefer `exec` over `simple`.** With `simple`, a wrong path in `ExecStart=` is reported as a successful start followed by a failure. With `exec`, the start itself fails and `systemctl start` tells you.
- **Use `notify` if the program supports it.** The program tells systemd when it is actually ready to serve, for example after it has opened its listening socket. Dependants then start at the right time, not just after the process exists. The program must send the message itself, usually through the `sd_notify()` function or a library that wraps it.
- **Avoid `forking` for new software.** Run your program in the foreground and let systemd handle the background. If you must wrap a daemon that forks, set `PIDFile=` so systemd can find the main process.
- **Pair `oneshot` with `RemainAfterExit=yes`** when the unit represents a state, such as "firewall rules loaded", so it shows as active after the command exits.

Your program should write its logs to standard output or standard error. systemd captures both and sends them to the journal with the unit name attached, so there is no log file to configure or rotate.

## Restart policy and rate limits

`Restart=` decides whether systemd brings the service back after it stops.

| Value | Restarts after |
|---|---|
| `no` | Never (the default) |
| `on-failure` | A non-zero exit code, death by signal, a timeout or a watchdog expiry |
| `on-abnormal` | A signal, a timeout or a watchdog expiry, but not a plain non-zero exit code |
| `always` | Any exit, including a clean one |

`on-failure` suits most services: a crash is recovered, while a deliberate clean exit is respected. Use `always` for something that must never be down, even if it exits with status zero. Stopping a service with `systemctl stop` never triggers a restart under any setting.

`RestartSec=` is the pause before each restart. The default is 100 milliseconds, which turns a program that fails at start-up into a tight loop. A few seconds is kinder to the logs and to whatever the program depends on.

That loop is bounded by the start rate limit. By default a unit may be started five times in ten seconds; beyond that, systemd stops trying and marks the unit failed. The limit is configured in the `[Unit]` section, not `[Service]`:

```ini
[Unit]
StartLimitIntervalSec=5min
StartLimitBurst=10

[Service]
Restart=on-failure
RestartSec=5
```

This allows ten starts in five minutes before giving up. Note how the two settings interact: with `RestartSec=5` and the default limits, five starts can never fit into ten seconds, so the service would retry for ever. Raising the interval, as here, makes the limit meaningful again.

On systemd 254 and later, the delay can grow with each attempt. This starts at one second and backs off towards one minute over eight steps:

```ini
[Service]
Restart=on-failure
RestartSec=1
RestartSteps=8
RestartMaxDelaySec=60
```

When a unit has hit its limit and you have fixed the cause, clear the counter and start it:

```bash
sudo systemctl reset-failed notes-api.service
sudo systemctl start notes-api.service
```

To test the policy, kill the main process and watch it return:

```bash
sudo systemctl kill --signal=SIGKILL notes-api.service
sleep 6
systemctl status notes-api.service
systemctl show notes-api.service -p NRestarts
```

Stopping deserves a moment too. On `systemctl stop`, systemd sends `SIGTERM` to the service's processes and waits up to `TimeoutStopSec=` (90 seconds by default) before sending `SIGKILL`. Make sure your program handles `SIGTERM` by finishing in-flight work and exiting, and shorten the timeout if it never needs that long.

## Dependencies and ordering

systemd keeps two questions separate, and mixing them up causes most start-up bugs.

- **Ordering:** `After=` and `Before=` decide sequence only. `After=postgresql.service` means "if both are being started, start mine second". It does not cause PostgreSQL to start.
- **Requirement:** `Wants=` and `Requires=` pull another unit in. They say nothing about order; without `After=`, both start at the same time.

So a dependency normally needs one of each:

```ini
[Unit]
Wants=postgresql.service
After=postgresql.service
```

`Wants=` is the weak form: your service starts even if the other unit fails. `Requires=` is strict: if the required unit fails to start, yours is not started, and if it is stopped, yours is stopped too. Prefer `Wants=` unless your service truly cannot run alone, and make the program retry its connections anyway, since a database on another host has no unit to depend on.

For the network, `After=network.target` only means the network stack has been set up, not that an address has been assigned. A service that must bind to a specific address or contact a remote host at start-up should use the pair shown in the minimal unit: `Wants=network-online.target` with `After=network-online.target`.

Inspect the result with:

```bash
systemctl list-dependencies notes-api.service
systemd-analyze critical-chain notes-api.service
```

## Configuration and secrets

Keep settings out of the unit file so the same unit works in every environment. Two mechanisms cover most needs.

Simple settings can be environment variables, either inline or from a file:

```ini
[Service]
Environment=NOTES_LOG_LEVEL=info
EnvironmentFile=/etc/notes-api/env
```

The file contains plain `NAME=value` lines; it is not a shell script, so there is no variable expansion or command substitution.

Environment variables are a poor place for secrets. They are inherited by child processes and can be read by other processes of the same user. systemd's credentials feature (version 247 and later) is safer:

```ini
[Service]
LoadCredential=db-password:/etc/notes-api/db-password
```

Keep the source file owned by root with mode `0600`. When the service starts, systemd makes a copy available only to that service, in a directory named by the `CREDENTIALS_DIRECTORY` environment variable. The application reads the file `$CREDENTIALS_DIRECTORY/db-password`. The service user never needs read access to the original. For where secrets should come from in the first place, see the [secrets management guide](/blog/secrets-management-guide/).

## Sandbox the service

Running as a non-root user is the first layer. systemd can add many more, each one a single line that removes something the service does not need. The useful mindset is that a bug in your application will eventually let someone run code as the service, and these options decide what that code can reach.

Start by measuring. `systemd-analyze security` scores a unit's exposure from 0 (tightly confined) to 10 (unconfined) and lists every option it checked:

```bash
systemd-analyze security notes-api.service
```

Then add this block to the `[Service]` section:

```ini
# Privileges
NoNewPrivileges=yes
CapabilityBoundingSet=
AmbientCapabilities=

# Filesystem
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
StateDirectory=notes-api
PrivateDevices=yes

# Kernel interfaces
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectKernelLogs=yes
ProtectControlGroups=yes
ProtectClock=yes
ProtectHostname=yes

# Network and system calls
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
RestrictNamespaces=yes
RestrictSUIDSGID=yes
RestrictRealtime=yes
LockPersonality=yes
SystemCallArchitectures=native
SystemCallFilter=@system-service
```

What the groups do:

**Privileges.** `NoNewPrivileges=yes` stops the process and its children from gaining privileges through set-user-id programs such as `sudo`. An empty `CapabilityBoundingSet=` removes every Linux capability, the fine-grained pieces of root's power. If the service must listen on a port below 1024, keep that one capability: set both `CapabilityBoundingSet=` and `AmbientCapabilities=` to `CAP_NET_BIND_SERVICE`.

**Filesystem.** `ProtectSystem=strict` mounts the entire filesystem read-only for the service, apart from `/dev`, `/proc` and `/sys`. `ProtectHome=yes` makes `/home`, `/root` and `/run/user` appear empty. `PrivateTmp=yes` gives the service its own `/tmp` and `/var/tmp`, invisible to other processes. Having made everything read-only, grant back exactly what is needed: `StateDirectory=notes-api` creates `/var/lib/notes-api`, owned by the service user and writable, and exposes its path in the `STATE_DIRECTORY` variable. `CacheDirectory=`, `LogsDirectory=` and `RuntimeDirectory=` do the same under `/var/cache`, `/var/log` and `/run`. For a path outside those, use `ReadWritePaths=`.

**Kernel interfaces.** These block writes to kernel settings, loading of kernel modules, reading the kernel log and changing the clock or hostname. An ordinary application needs none of them. `PrivateDevices=yes` hides physical devices, leaving only pseudo-devices such as `/dev/null` and `/dev/urandom`.

**Network and system calls.** `RestrictAddressFamilies=` limits which kinds of socket can be created; a web service needs IPv4, IPv6 and Unix sockets. `SystemCallFilter=@system-service` allows a maintained set of system calls suitable for typical services and blocks the rest. `SystemCallArchitectures=native` prevents the filter being sidestepped through a different calling convention.

Apply the options a few at a time. After each change:

```bash
sudo systemctl daemon-reload
sudo systemctl restart notes-api.service
systemctl status notes-api.service
journalctl -u notes-api.service -n 30
systemd-analyze security notes-api.service
```

Exercise the application properly after each round, not just its start-up, because a blocked operation may only happen on a rarely used path. A read-only filesystem shows up as a "Read-only file system" or "Permission denied" error in the application's log. A blocked system call normally kills the process with the `SIGSYS` signal, which the status output shows as `status=31/SYS`.

A lower exposure score is a guide, not a goal. Some options do not fit some programs; `MemoryDenyWriteExecute=yes`, for instance, breaks runtimes that generate machine code at run time. Leave out what the service cannot live with and keep the rest.

### Resource limits

In the same section you can cap what the service may consume, so a leak or a traffic spike cannot starve the rest of the host:

```ini
MemoryMax=512M
CPUQuota=150%
TasksMax=256
```

`MemoryMax=` is a hard limit; a service that exceeds it is killed by the out-of-memory handler and, with `Restart=on-failure`, restarted. `CPUQuota=150%` allows one and a half CPU cores. `TasksMax=` limits the number of processes and threads. Watch live usage with `systemd-cgtop` or `systemctl status`.

These protections confine one service. For the host around it, continue with the [Linux server hardening checklist](/blog/linux-server-hardening-checklist/).

## Common mistakes and debugging

Three commands answer most questions:

```bash
systemctl status notes-api.service          # state, main process, recent log lines
journalctl -u notes-api.service -b          # all log lines since boot
journalctl -u notes-api.service -f          # follow the log live
```

Add `-p err` to `journalctl` to show only errors, or `--since "10 min ago"` to narrow the time range.

- **No `daemon-reload` after editing.** systemd keeps using the old definition and `systemctl status` prints a warning that the unit file changed on disk.
- **Shell syntax in `ExecStart=`.** Pipes, `>` redirection and `&&` are passed to the program as literal arguments. Wrap them in a script, or use `/bin/sh -c '...'` if you must.
- **Relative paths.** The executable must be given as an absolute path, and the working directory is `/` unless `WorkingDirectory=` is set.
- **Assuming your login environment.** Services do not read `~/.bashrc` or `/etc/profile`. `PATH` is a minimal default and variables you rely on interactively are absent. Set what you need with `Environment=`.
- **`After=` without `Wants=`.** Ordering alone does not start the other unit.
- **Rate limit settings in `[Service]`.** `StartLimitIntervalSec=` and `StartLimitBurst=` belong in `[Unit]`; in the wrong section they are ignored with a warning in the journal.
- **A daemon that backgrounds itself under `Type=exec`.** systemd sees the main process exit and treats the service as stopped. Run the program in foreground mode.
- **Editing files in `/usr/lib/systemd/system/`.** The next package update overwrites them. Use `systemctl edit`.
- **Exit code 203/EXEC.** systemd could not execute the file: the path is wrong, the file is not executable, or a script's interpreter line points to something missing.
- **Exit code 217/USER.** The account named in `User=` does not exist.

## Frequently asked questions

### What is the difference between systemctl enable and systemctl start?

`start` runs the service immediately and has no effect on the next boot. `enable` creates the links that make it start at boot and does not start it now. `systemctl enable --now` does both.

### Should I use Restart=always or Restart=on-failure?

Use `on-failure` unless a clean exit should also be treated as a problem. It recovers from crashes while letting the program shut itself down deliberately. Either way, set `RestartSec=` to a few seconds and make sure the start rate limit can actually be reached.

### Do I need a PID file?

No, not for a program that runs in the foreground. systemd tracks the processes it starts directly through control groups. PID files are only needed for `Type=forking` daemons, which are best avoided in new software.

### How do I run a service without root at all?

Use a user unit. Place the file in `~/.config/systemd/user/`, manage it with `systemctl --user`, and run `loginctl enable-linger yourname` so it starts at boot without you logging in. Be aware that several sandboxing options are unavailable to user services.

### Can systemd replace cron for scheduled jobs?

Yes. A timer unit (`name.timer`) activates a matching `oneshot` service on a schedule. You get the same logging, sandboxing and resource limits as any other service, and `systemctl list-timers` shows when each job last ran and will run next.

The complete reference is in the manual pages on your own system: `man systemd.service` for start-up and restart behaviour, `man systemd.exec` for the execution environment and sandboxing, and `man systemd.unit` for dependencies. They are also published on the [systemd documentation site](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html).
