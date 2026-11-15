---
title: "SSH hardening: keys, sshd_config and fail2ban done properly"
description: "Set up SSH keys, harden sshd_config with a drop-in file, restrict who can log in and add fail2ban, with checks that prevent locking yourself out."
date: 2026-11-15
tags: [linux, devsecops]
art:
  kind: terminal
  caption: "Create a key, install it on the server, and test the config before reloading."
  items: ["ssh-keygen -t ed25519", "ssh-copy-id -i ~/.ssh/id_ed25519.pub alice@server.example.com", "sudo sshd -t"]
draft: true
---

Any server with SSH open to the internet receives a steady stream of automated login attempts. Password guessing only has to succeed once, so the reliable fix is to make passwords irrelevant: authenticate with keys, refuse everything else, and limit which accounts may connect at all. This guide covers key setup, how the SSH daemon actually reads its configuration, a hardened set of options with the reasoning for each, access restrictions and fail2ban, with a verification step after every change.

The commands apply to OpenSSH on Debian, Ubuntu and the RHEL family (RHEL, Rocky Linux, AlmaLinux). Where they differ, both forms are shown. The main difference to remember is the service name: `ssh` on Debian and Ubuntu, `sshd` on the RHEL family.

## Before you change anything

SSH is usually the only way into a remote server, so a mistake in its configuration can cut you off. Three habits prevent that.

- **Keep one session open.** Reloading or restarting the daemon does not close connections that are already established. A root session left open in one terminal lets you undo a bad change while you test from another.
- **Have a way in that is not SSH.** Confirm you can reach the provider's web console, a serial console or the machine itself.
- **Validate before reloading.** `sshd -t` checks the configuration for errors. Run it before every reload so a typing mistake cannot stop the daemon from starting.

The order of the steps in this guide matters for the same reason: install and test a key first, and only then turn passwords off.

## Create and install a key pair

A key pair is two related files. The private key stays on your computer and proves who you are; the public key is copied to every server you want to reach. The server never sees the private key, and a public key is useless to anyone who steals it.

Generate the pair on your own machine, not on the server:

```bash
ssh-keygen -t ed25519 -C "alice@laptop"
```

Ed25519 keys are short, fast and supported by every maintained OpenSSH release. Use `-t rsa -b 4096` only if you must connect to an old system that does not accept Ed25519. The `-C` text is a label that helps you recognise the key later.

When asked, set a passphrase. It encrypts the private key file, so a stolen laptop or backup does not hand over access to your servers. An agent keeps the unlocked key in memory so you type the passphrase once per session:

```bash
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/id_ed25519
```

Copy the public key to the server while password login still works:

```bash
ssh-copy-id -i ~/.ssh/id_ed25519.pub alice@server.example.com
```

`ssh-copy-id` appends the key to `~/.ssh/authorized_keys` on the server and sets suitable permissions. If the tool is not available, do the same by hand on the server:

```bash
install -d -m 700 ~/.ssh
cat >> ~/.ssh/authorized_keys     # paste the public key, then press Ctrl-D
chmod 600 ~/.ssh/authorized_keys
```

The permissions are not optional. With the default `StrictModes yes`, the daemon ignores an `authorized_keys` file if it, the `.ssh` directory or the home directory can be written by other users.

### Verify key login

From a new terminal, force the client to use only the key:

```bash
ssh -o PreferredAuthentications=publickey -o PasswordAuthentication=no alice@server.example.com
```

If this logs you in, the key works. If it fails, add `-v` to see which keys were offered and why they were refused, and fix that before going further.

### Hardware-backed keys

If you have a FIDO2 security key, OpenSSH can create a key that cannot be used without the device being present and touched:

```bash
ssh-keygen -t ed25519-sk -C "alice@security-key"
```

The file written to disk is only a handle; the secret stays in the hardware. This protects against malware copying the key file, which a passphrase alone does not.

## How sshd reads its configuration

Many hardening attempts fail quietly because of one rule in the `sshd_config` manual: for each keyword, the first value obtained is the one used. Later lines that set the same keyword are ignored.

On Debian, Ubuntu and current RHEL-family releases, the main file `/etc/ssh/sshd_config` begins with an `Include` line for `/etc/ssh/sshd_config.d/*.conf`. The files in that directory are read in alphabetical order, before the rest of the main file. Two consequences follow:

- A setting in a drop-in file beats the same setting further down `sshd_config`.
- Among drop-in files, the one whose name sorts first wins. Cloud images often ship a file such as `50-cloud-init.conf`, and the RHEL family ships `50-redhat.conf`. A file of yours named `99-hardening.conf` would lose to them on any keyword they set.

So put your settings in a file with a low number, such as `10-hardening.conf`, and leave the vendor's main file untouched. That also keeps package upgrades from prompting you about a modified file.

Never assume which value is active. Ask the daemon:

```bash
sshd -T | grep -Ei '^(permitrootlogin|passwordauthentication|pubkeyauthentication)'
```

`sshd -T` (capital T, run as root) validates the configuration and prints the effective value of every option after all files are merged. If the output disagrees with what you wrote, search for the earlier definition:

```bash
grep -rn -i 'passwordauthentication' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/
```

## A hardened sshd_config drop-in

**Warning:** this configuration turns off password login and direct root login. Apply it only after the key test in the previous section succeeded for a non-root account that can use `sudo`, and keep your existing session open.

If you plan to use the `AllowGroups` line, create the group and add yourself to it first, or you will be refused along with everyone else:

```bash
groupadd ssh-users
usermod -aG ssh-users alice
```

Then create `/etc/ssh/sshd_config.d/10-hardening.conf`:

```ini
# Authentication: keys only
PubkeyAuthentication yes
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitEmptyPasswords no
AuthenticationMethods publickey

# Who may log in
PermitRootLogin no
AllowGroups ssh-users

# Limit attempts and idle unauthenticated connections
MaxAuthTries 3
LoginGraceTime 30

# Switch off features you do not use
X11Forwarding no
AllowAgentForwarding no
AllowTcpForwarding no

# Drop sessions whose client has gone away
ClientAliveInterval 300
ClientAliveCountMax 2

# Record which key was used for each login
LogLevel VERBOSE
```

What each group does, and why:

**Authentication.** `PasswordAuthentication no` is the headline, but it is not enough alone. Keyboard-interactive authentication, which on most systems is passed to PAM (the Pluggable Authentication Modules system that normally checks passwords), can still prompt for a password, so `KbdInteractiveAuthentication no` closes that route too. `AuthenticationMethods publickey` states the policy positively: a public key is the only accepted way in. Leave `UsePAM` as your distribution set it; with the lines above PAM no longer authenticates anyone, but it still applies account and session rules.

**Who may log in.** `PermitRootLogin no` forces everyone through a personal account and `sudo`, so logs show who did what. The upstream default, `prohibit-password`, already blocks root passwords but still accepts a root key. `AllowGroups` turns access into an explicit list: an account that is not in the group cannot log in over SSH even with a valid key, which covers service accounts and forgotten users.

**Limits.** `MaxAuthTries 3` cuts off a connection after three failed attempts (the default is 6). Be aware that every key your agent offers counts as an attempt, so a client with many keys loaded can be rejected before it reaches the right one; `ssh -i` with `-o IdentitiesOnly=yes` fixes that on the client. `LoginGraceTime 30` gives an unauthenticated connection 30 seconds instead of the default 120.

**Features.** Each forwarding option is a capability a compromised account could use to reach further into your network. Turn off what you do not need, and know what you lose: `AllowTcpForwarding no` breaks `ssh -L` tunnels, use of the host as a jump host with `ssh -J`, and editors that tunnel over SSH. If you rely on those, leave it at `yes` or allow it for specific users in a `Match` block.

**Keepalives.** With these values the server probes a silent client every 300 seconds and disconnects after two unanswered probes. This cleans up dead connections; it is not an idle timeout for a client that is still responding.

**Logging.** At `VERBOSE` the daemon logs the fingerprint of the key used for each login, which lets you tell which of a user's keys was used.

| Directive | OpenSSH default | Hardened value |
|---|---|---|
| `PermitRootLogin` | `prohibit-password` | `no` |
| `PasswordAuthentication` | `yes` | `no` |
| `KbdInteractiveAuthentication` | `yes` | `no` |
| `MaxAuthTries` | `6` | `3` |
| `LoginGraceTime` | `120` seconds | `30` seconds |
| `X11Forwarding` | `no` (Debian and Ubuntu ship `yes`) | `no` |
| `AllowAgentForwarding` | `yes` | `no` |
| `AllowTcpForwarding` | `yes` | `no`, if you do not tunnel |
| `ClientAliveInterval` | `0` (off) | `300` |

Distribution packages sometimes change the upstream defaults in the file they ship, as the X11 row shows, which is one more reason to check with `sshd -T`.

### Apply and test

```bash
sshd -t                      # no output means the syntax is valid
systemctl reload ssh         # Debian and Ubuntu
systemctl reload sshd        # RHEL, Rocky, AlmaLinux
```

Now test from a second terminal, leaving the first connected:

```bash
# Must succeed
ssh alice@server.example.com

# Must fail with "Permission denied (publickey)"
ssh -o PubkeyAuthentication=no -o PreferredAuthentications=password alice@server.example.com

# Must fail
ssh root@server.example.com
```

On the server, confirm the effective values and look at the log:

```bash
sshd -T | grep -Ei '^(permitrootlogin|passwordauthentication|kbdinteractiveauthentication|authenticationmethods|allowgroups)'
journalctl -u ssh -n 20      # use -u sshd on the RHEL family
```

If the new login fails, use the session you kept open to correct or remove the drop-in file, reload, and try again.

## Restrict where connections come from

Key-only authentication stops password guessing. Limiting who can reach the port at all removes most of the remaining exposure, including any future flaw in the daemon itself.

**Firewall.** If you administer the server from fixed addresses or through a VPN, allow port 22 only from those. With ufw on Debian and Ubuntu:

```bash
ufw allow from 203.0.113.10 to any port 22 proto tcp
```

Add the specific rule and test it before deleting a general `allow 22/tcp` rule. The [nftables firewall guide](/blog/nftables-firewall-guide/) shows the equivalent in raw rules.

**Per-user rules.** A `Match` block applies settings only to connections that meet a condition. It must come after all global settings in its file, because everything following a `Match` line belongs to the block. This example limits a backup account to SFTP when it connects from its usual address:

```ini
Match User backup Address 203.0.113.20
    ForceCommand internal-sftp
    AllowTcpForwarding no
    PermitTTY no
```

The block only tightens the session when the connection comes from that address; to refuse the account from anywhere else, add a `from=` option to its key as shown below.

To see what a particular connection would get, pass its details to the test mode:

```bash
sshd -T -C user=backup,addr=203.0.113.20,host=client.example.com | grep -i forcecommand
```

**Per-key restrictions.** A line in `authorized_keys` can carry options that limit what that key may do. For a key used by an automated job:

```text
from="203.0.113.20",restrict,command="/usr/local/bin/run-backup" ssh-ed25519 AAAAC3... backup@jobs
```

`from=` accepts the key only from the listed address, `restrict` disables forwarding and terminal allocation, and `command=` runs the named program whatever the client asked for.

## Slow down attackers with fail2ban

With passwords disabled, guessing cannot succeed, so fail2ban is no longer what keeps attackers out. It is still useful: it bans addresses that fail repeatedly, which keeps logs readable and reduces load from persistent scanners.

fail2ban watches log entries for a service (a "jail") and, when one address fails `maxretry` times within `findtime`, adds a firewall rule blocking it for `bantime`.

```bash
apt install fail2ban                              # Debian and Ubuntu
dnf install epel-release && dnf install fail2ban  # RHEL family, from EPEL
```

Do not edit `/etc/fail2ban/jail.conf`; a package update can replace it. Put overrides in `/etc/fail2ban/jail.local`:

```ini
[DEFAULT]
bantime = 1h
findtime = 10m
maxretry = 5
ignoreip = 127.0.0.1/8 ::1 203.0.113.10
bantime.increment = true

[sshd]
enabled = true
backend = systemd
```

The shipped defaults are a ten-minute ban after five failures in ten minutes. An hour is a more useful ban, and `bantime.increment` lengthens it each time the same address returns. `ignoreip` lists addresses that are never banned; put your own fixed address there so a run of failed logins from your side cannot block you. `backend = systemd` reads from the journal, which is necessary on systems that do not write a text authentication log, as on a default Debian 12 install.

```bash
fail2ban-client -t                   # test the configuration
systemctl enable --now fail2ban
fail2ban-client status sshd
```

The status output shows the number of failures seen and the addresses currently banned. To release an address:

```bash
fail2ban-client set sshd unbanip 198.51.100.7
```

OpenSSH itself has gained a related feature. From release 9.8 the `PerSourcePenalties` option, enabled by default, makes the daemon refuse connections for a while from addresses that repeatedly fail authentication or otherwise misbehave. Check your version with `ssh -V`. On such systems fail2ban becomes an optional extra, mainly valuable for longer bans and for protecting other services with the same tool.

## Common mistakes and troubleshooting

- **Disabling passwords before testing a key.** The most common lockout. Always complete a key-only login from a new terminal first.
- **Putting settings where they are overridden.** A line at the bottom of `sshd_config`, or in a drop-in whose name sorts after the vendor's, has no effect if the keyword was already set. `sshd -T` shows the truth.
- **Leaving keyboard-interactive on.** `PasswordAuthentication no` alone can still leave a PAM password prompt available.
- **Adding `AllowGroups` or `AllowUsers` without including yourself.** These are allow-lists; anyone not on them is refused.
- **"Too many authentication failures".** The agent offered more keys than `MaxAuthTries` permits. Connect with `ssh -o IdentitiesOnly=yes -i ~/.ssh/id_ed25519`, or set those options for the host in `~/.ssh/config`.
- **Key ignored after copying.** Check ownership and permissions of the home directory, `~/.ssh` (700) and `authorized_keys` (600). On SELinux systems, `restorecon -R ~/.ssh` repairs labels on files that were moved into place.
- **A port change that does not take effect.** On Ubuntu releases that start the daemon through `ssh.socket`, the listening port belongs to the socket unit; after editing `Port`, run `systemctl daemon-reload` and `systemctl restart ssh.socket`. On SELinux systems, a new port must also be labelled with `semanage port -a -t ssh_port_t -p tcp 2222`. Open the new port in the firewall before closing the old one.
- **Restarting without `sshd -t`.** A syntax error stops the daemon from starting and, once your last session ends, leaves no way in over SSH.
- **Unprotected private keys.** A key without a passphrase, copied between machines or stored in a repository, undoes everything above. Keep one key per device and remove a device's public key from servers when the device is retired. See the [secrets management guide](/blog/secrets-management-guide/) for handling keys used by automation.

When a login fails and the reason is unclear, read both sides: `ssh -vvv` on the client shows what was offered, and `journalctl -u ssh -f` (or `-u sshd`) on the server shows why it was refused.

## Frequently asked questions

### Should I change the SSH port from 22?

It reduces the number of automated attempts in your logs and nothing more, because a full port scan finds the service in seconds. It is harmless if you update the firewall and any SELinux label, but it is not a substitute for keys and should not be counted as a security control.

### Is fail2ban still needed with key-only authentication?

Not for protection against guessing, which can no longer succeed. It remains useful for cutting log noise and for banning hosts that hammer the port, and newer OpenSSH releases apply similar penalties themselves through `PerSourcePenalties`.

### What is the difference between PermitRootLogin no and prohibit-password?

`prohibit-password` lets root log in with a key but never with a password. `no` refuses root over SSH entirely, so administrators must log in as themselves and use `sudo`. Prefer `no`; it gives per-person accountability and one less high-value account exposed.

### How do I add a second factor to SSH?

The simplest route is a FIDO2 security key with an `ed25519-sk` key, optionally with `PubkeyAuthOptions verify-required` on the server to demand the device PIN as well. The alternative is a one-time-code PAM module combined with `AuthenticationMethods publickey,keyboard-interactive`, which requires both a key and a code.

### How do I remove someone's access?

Delete their line from `~/.ssh/authorized_keys` in every account where it appears, or lock the account and remove it from the group named in `AllowGroups`. Existing sessions are not closed by either change, so end those too, for example with `loginctl terminate-user name`.

This guide covers the SSH service itself. For the rest of the host, including updates, accounts, the firewall and auditing, continue with the [Linux server hardening checklist](/blog/linux-server-hardening-checklist/). The authoritative reference for every option is the [sshd_config manual page](https://man.openbsd.org/sshd_config).
