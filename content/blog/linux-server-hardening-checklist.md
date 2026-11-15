---
title: "Linux server hardening: a practical checklist with commands"
description: "A step-by-step hardening checklist for Debian, Ubuntu, RHEL and Rocky servers: updates, accounts, SSH, firewall, services, sysctl and auditing."
date: 2026-11-15
tags: [linux, devsecops]
art:
  kind: layers
  caption: "Hardening is a set of layers, each closing off a different route in."
  items: ["Updates applied", "SSH keys only", "Firewall", "Least privilege", "Logs and audit"]
draft: true
---

A freshly installed server is rarely insecure in dramatic ways. It is insecure in small ones: a package that has not been patched, a service listening that nobody uses, an account with more access than it needs. This checklist works through those in order of value, with the commands for Debian and Ubuntu on one side and RHEL-family systems (RHEL, Rocky Linux, AlmaLinux) on the other, the reason for each step and a way to confirm it took effect.

Run the commands as root or with `sudo`. Every section stands alone, so you can apply the list to an existing server one item at a time.

## Before you change anything

Hardening changes can lock you out or break an application. Three preparations make them safe to try.

- **Confirm a second way in.** Check that you can reach the provider's web console, a serial console or the physical machine. If SSH or the firewall is misconfigured, this is how you recover.
- **Take a snapshot or backup.** On a virtual machine, a snapshot before you start costs little and makes any step reversible.
- **Record the starting state.** Save what is installed, running and listening, so you can compare afterwards and explain any difference.

```bash
mkdir -p /root/baseline
ss -tulpn > /root/baseline/listening.txt
systemctl list-units --type=service --state=running > /root/baseline/services.txt
systemctl list-unit-files --state=enabled > /root/baseline/enabled.txt
```

`ss -tulpn` lists TCP and UDP sockets in the listening state with the process that owns each. It is the single most useful command in this article; you will run it again at the end.

Throughout the checklist, keep one root session open while you test each change from a second terminal. A session that is already connected survives most mistakes.

## Patch the system and keep it patched

Most compromises of internet-facing servers use vulnerabilities that already have a fix. Applying updates, and making sure they keep being applied, does more than any other item here.

### Debian and Ubuntu

```bash
apt update && apt full-upgrade
apt install unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades
```

The `dpkg-reconfigure` step writes `/etc/apt/apt.conf.d/20auto-upgrades`, which should contain:

```ini
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
```

By default the package installs security updates only. What it is allowed to install, and whether it may reboot, is set in `/etc/apt/apt.conf.d/50unattended-upgrades`. Test the configuration without changing anything:

```bash
unattended-upgrade --dry-run --debug
```

### RHEL, Rocky and AlmaLinux

```bash
dnf upgrade
dnf install dnf-automatic
```

Edit `/etc/dnf/automatic.conf` so that security updates are downloaded and applied:

```ini
[commands]
upgrade_type = security
apply_updates = yes
```

Then enable the timer and confirm it is scheduled:

```bash
systemctl enable --now dnf-automatic.timer
systemctl list-timers dnf-automatic.timer
```

### Reboots

A new kernel or C library does nothing until the old one stops running. Check whether a restart is pending:

```bash
# Debian and Ubuntu: this file exists when a reboot is needed
cat /var/run/reboot-required

# RHEL family (needs the dnf-utils package)
dnf needs-restarting -r
```

Decide deliberately how reboots happen. On a single server, an automatic reboot in a quiet hour is usually better than running an old kernel for months. On a cluster, drain and restart nodes one at a time.

## Lock down accounts and sudo

The goal is that every action traces back to a named person, nobody logs in as root directly, and no account has a weak or empty password.

Create a personal administrative account if you do not have one. The administrators' group is `sudo` on Debian and Ubuntu and `wheel` on the RHEL family:

```bash
# Debian and Ubuntu
adduser alice
usermod -aG sudo alice

# RHEL, Rocky, AlmaLinux
useradd -m alice
passwd alice
usermod -aG wheel alice
```

**Warning:** before the next step, open a new terminal, log in as that user and run `sudo -v` successfully. If you lock the root password before sudo works, you will need the console to recover.

```bash
passwd -l root
```

`passwd -l` locks the password so it cannot be used to log in; `sudo` continues to work, and so does key-based root SSH if you have not disabled it yet. Then audit what exists:

```bash
# Accounts with user id 0. Only root should appear.
awk -F: '$3 == 0 {print $1}' /etc/passwd

# Accounts with an empty password field. There should be no output.
awk -F: '$2 == "" {print $1}' /etc/shadow

# Accounts that have a login shell
grep -Ev '(nologin|false)$' /etc/passwd

# Who can use sudo, and is the configuration valid?
getent group sudo wheel
visudo -c
```

Remove or lock accounts that belong to people who have left (`usermod -L name` locks, `userdel -r name` removes the account and its home directory). Service accounts should have `/usr/sbin/nologin` as their shell.

In sudo rules, avoid `NOPASSWD: ALL` for human accounts. If automation needs passwordless sudo, limit it to the exact commands required, in a separate file under `/etc/sudoers.d/` edited with `visudo -f`.

## Secure remote access

SSH is how you get in, so it is also how everyone else tries. The short version is: keys instead of passwords, no direct root login, and a limit on who may connect.

**Warning:** do not disable password authentication until you have logged in with a key from a second terminal. Keep your current session open the whole time.

Put the settings in a drop-in file, which both Debian-family and current RHEL-family packages read from `/etc/ssh/sshd_config.d/`:

```bash
cat > /etc/ssh/sshd_config.d/10-hardening.conf <<'EOF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
MaxAuthTries 3
X11Forwarding no
EOF

sshd -t && systemctl reload ssh    # the unit is called sshd on the RHEL family
```

`sshd -t` checks the syntax and prints nothing when the file is valid. Confirm what the daemon is really using, because another file may set the same option first:

```bash
sshd -T | grep -Ei '^(permitrootlogin|passwordauthentication|kbdinteractiveauthentication)'
```

That is the minimum. Key generation, the full list of options, how the daemon resolves conflicting files, access restrictions and fail2ban are covered in the [SSH hardening guide](/blog/ssh-hardening-guide/).

## Allow only the traffic you need

A host firewall with a default-deny inbound policy means a service started by accident is not reachable from the internet. Cloud security groups do a similar job at the network edge; use both, because each protects against a mistake in the other.

**Warning:** allow SSH before you enable the firewall or change the default policy, and test a new connection before closing your current one.

### Debian and Ubuntu with ufw

```bash
apt install ufw
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 443/tcp
ufw enable
ufw status verbose
```

### RHEL family with firewalld

firewalld is normally installed and running, with SSH allowed in the default zone.

```bash
firewall-cmd --state
firewall-cmd --list-all
firewall-cmd --permanent --add-service=https
firewall-cmd --permanent --remove-service=cockpit
firewall-cmd --reload
```

Rules added with `--permanent` are saved but do not apply until `--reload`. Remove any service in the `--list-all` output that the server does not offer.

Both tools are front ends to the kernel's packet filter. If you want to write the rules directly, or need rate limiting and sets, see the [nftables firewall guide](/blog/nftables-firewall-guide/).

Verify from another machine, not from the server itself, since local checks do not pass through the same rules. From a host you control, `nc -zv server.example.com 443` should connect and a port you did not open should time out.

## Remove what you do not use

Every listening service is code that processes input from the network. The fewer there are, the less there is to patch and the less there is to get wrong.

```bash
ss -tulpn
```

For each line, ask whether the server needs it and whether it needs to listen on that address. A database used only by an application on the same host should be bound to `127.0.0.1`, not `0.0.0.0`. That is set in the service's own configuration, for example `bind-address` for MariaDB or `listen_addresses` for PostgreSQL.

Stop and disable services that are not needed, and remove the package where possible so it cannot come back:

```bash
systemctl disable --now cups.service
apt purge cups          # Debian and Ubuntu
dnf remove cups         # RHEL family
```

`disable --now` stops the service and prevents it starting at boot. If a service must stay installed but must never run, `systemctl mask name.service` blocks it from being started at all, even as a dependency.

| Task | Debian and Ubuntu | RHEL, Rocky, AlmaLinux |
|---|---|---|
| Apply updates | `apt update && apt full-upgrade` | `dnf upgrade` |
| Automatic security updates | `unattended-upgrades` | `dnf-automatic` |
| Administrators' group | `sudo` | `wheel` |
| SSH service unit | `ssh.service` | `sshd.service` |
| Default firewall front end | `ufw` (install it) | `firewalld` |
| Mandatory access control | AppArmor (`aa-status`) | SELinux (`getenforce`) |
| List installed packages | `dpkg -l` | `rpm -qa` |
| Remove a package | `apt purge name` | `dnf remove name` |

Also check for scheduled work nobody remembers: `systemctl list-timers --all`, the files in `/etc/cron.d/` and each user's `crontab -l`.

## Tighten kernel and network settings

The kernel exposes settings through `sysctl` that control how it handles unusual network traffic and how much it reveals to unprivileged users. Put your choices in a file of your own so that package updates do not overwrite them:

```ini
# /etc/sysctl.d/90-hardening.conf

# Drop packets whose source address could not be reached via the interface they arrived on
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1

# Do not accept or send ICMP redirects, and ignore source-routed packets
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv6.conf.all.accept_redirects = 0
net.ipv6.conf.default.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.all.accept_source_route = 0

# Use SYN cookies when the connection queue fills up
net.ipv4.tcp_syncookies = 1

# Hide kernel addresses and the kernel log from unprivileged users
kernel.kptr_restrict = 2
kernel.dmesg_restrict = 1

# Only allow a process to trace its own descendants
kernel.yama.ptrace_scope = 1

# Protect against link-following tricks in world-writable directories
fs.protected_hardlinks = 1
fs.protected_symlinks = 1
```

Load the file and check a value:

```bash
sysctl --system
sysctl net.ipv4.conf.all.rp_filter kernel.dmesg_restrict
```

Some of these are already the default on your distribution; setting them explicitly documents the intent and protects against a later change. Two cautions apply. A server that routes traffic, runs containers with custom networking or has asymmetric routes may need a looser `rp_filter` value (`2`) or redirects enabled, so test on such hosts. And `ptrace_scope = 1` stops you attaching a debugger to an unrelated process as an ordinary user; use `sudo` when you need to.

### Keep mandatory access control on

AppArmor (Debian and Ubuntu) and SELinux (RHEL family) confine services so that a compromised process cannot read or write outside what its policy allows. Check that they are active:

```bash
aa-status      # Debian and Ubuntu
getenforce     # RHEL family: should print Enforcing
```

When SELinux blocks something, the answer is almost never to switch it off. Look at the denial with `ausearch -m AVC -ts recent` and fix the label or the boolean.

### Review file permissions

Programs with the set-user-id bit run with their owner's privileges, so an unexpected one is worth investigating. World-writable files outside temporary directories are usually mistakes.

```bash
find / -xdev -type f -perm -4000 2>/dev/null
find / -xdev -type f -perm -0002 2>/dev/null
```

Save the first list with your baseline and compare it after package changes.

## Log, audit and measure the result

Hardening you cannot observe is a guess. Make sure the server records what happens and that you can read the record.

Authentication events go to the systemd journal on every current distribution, and often to a text file as well (`/var/log/auth.log` on Debian-family systems with rsyslog installed, `/var/log/secure` on the RHEL family).

```bash
journalctl -u ssh --since today        # use -u sshd on the RHEL family
journalctl -p warning --since "1 hour ago"
lastlog | grep -v 'Never logged in'
```

For a record of changes to sensitive files, use the audit daemon. It is installed by default on the RHEL family; on Debian and Ubuntu run `apt install auditd`. Add watch rules in a file under `/etc/audit/rules.d/`:

```bash
cat > /etc/audit/rules.d/50-identity.rules <<'EOF'
-w /etc/passwd -p wa -k identity
-w /etc/shadow -p wa -k identity
-w /etc/sudoers -p wa -k privilege
-w /etc/sudoers.d/ -p wa -k privilege
-w /etc/ssh/sshd_config -p wa -k sshd
EOF

augenrules --load
auditctl -l
```

Each rule watches a path for writes and attribute changes (`-p wa`) and tags matching events with a key. Search by key later with `ausearch -k identity`.

Logs kept only on the server can be altered by whoever compromises it. If the server matters, forward logs to another machine or a logging service.

Finally, measure. Lynis is an open-source auditing tool that inspects a host and lists findings with suggestions. It is packaged in Debian and Ubuntu, and in EPEL for the RHEL family:

```bash
apt install lynis      # or: dnf install lynis (with EPEL enabled)
lynis audit system
```

Treat the output as a list of questions, not a score to maximise. Some suggestions will not fit your server; the value is in deciding each one on purpose. Then rerun `ss -tulpn` and compare it with the baseline you saved at the start.

## Common mistakes

- **Locking yourself out.** Disabling passwords before testing a key, or enabling a firewall before allowing SSH, are the two classic ways. Keep a session open and a console available.
- **Hardening once.** A server drifts as packages and people change. Rerun the checks on a schedule, or put the configuration in a tool such as Ansible so it is reapplied.
- **Installing updates but never rebooting.** The fixed kernel is on disk; the vulnerable one is still running.
- **Editing vendor files in place.** Changes to `/etc/ssh/sshd_config` or `/etc/sysctl.conf` can be lost or cause prompts during upgrades. Use the drop-in directories.
- **Disabling SELinux or AppArmor to fix an error.** This removes a whole layer of containment to solve one denial.
- **Trusting the cloud firewall alone.** A single wrong rule in a security group exposes everything behind it if the host has no filter of its own.
- **Applying a benchmark without reading it.** Settings meant for a workstation or a different role can break a server. Understand each change before you make it.
- **Forgetting the application.** A hardened operating system does not help if the web application on top runs as root or holds secrets in a world-readable file. For services you write yourself, see [writing systemd services](/blog/systemd-service-units-guide/) for per-service sandboxing.

## Frequently asked questions

### What should I do first on a new server?

Apply all updates and turn on automatic security updates, then set up key-based SSH with root login disabled, then enable a default-deny firewall. Those three steps remove the most common ways a new server is compromised and take well under an hour.

### Is changing the SSH port worth it?

It reduces noise in the logs from automated scanners, which makes real events easier to see. It does not stop anyone who scans all ports, so treat it as tidiness, not protection. Keys, disabled passwords and a firewall are what matter.

### Do I need antivirus on a Linux server?

For most servers, patching, least privilege and mandatory access control give more protection than a scanner. A scanner is useful where the server stores files that other systems will open, such as a mail or file-sharing server, or where a compliance standard requires one.

### How often should I repeat this checklist?

Review listening services, accounts and sudo rules whenever the server's role changes and at a fixed interval otherwise, for example quarterly. Automatic updates and log forwarding should run continuously without you.

### Should I follow the CIS Benchmarks instead?

The benchmarks published by the Center for Internet Security are far more detailed than this list and are a good next step, especially if you have compliance requirements. Start with the basics here, then work through the benchmark for your distribution and record which items you chose not to apply and why.
