---
title: "nftables for beginners: a practical Linux firewall guide"
description: "Build a default-deny nftables firewall for a Linux server: tables, chains, sets, rate limits, safe testing over SSH and making rules persistent."
date: 2026-11-15
tags: [linux, devsecops]
art:
  kind: flow
  caption: "Every incoming packet is checked against the rules of the input chain."
  items: ["Incoming packet", "input chain", "Rules in order", "Accept or drop"]
draft: true
---

A server with a public address is probed within minutes of coming online, and every listening service it exposes by accident is a service you now have to defend. A host firewall narrows that down to the ports you actually intend to offer. This guide shows how to write a default-deny ruleset with nftables, the packet filtering framework that replaced iptables in the Linux kernel, how to test it without locking yourself out of a remote machine, and how to keep it across reboots.

By the end you will have one readable configuration file that you understand line by line, and a set of commands for checking that it does what you think it does.

## How nftables is organised

nftables has three building blocks, and almost everything else follows from them.

- A **table** is a container with a name and an address family. It does nothing by itself.
- A **chain** lives inside a table and holds rules. A *base chain* is attached to a hook, a point in the kernel's network path where packets are handed over for inspection. A *regular chain* is not attached to anything and only runs when another chain jumps to it.
- A **rule** is a list of matches followed by a verdict such as `accept` or `drop`.

Unlike iptables, nothing exists until you create it. There are no built-in tables or chains, so an empty ruleset means no filtering at all.

### Address families

The family decides which packets a table sees.

| Family | Packets it handles | Typical use |
| --- | --- | --- |
| `ip` | IPv4 only | Legacy rulesets, IPv4 NAT |
| `ip6` | IPv6 only | Rarely needed on its own |
| `inet` | IPv4 and IPv6 together | Host firewalls; the sensible default |
| `arp` | ARP | Specialised filtering |
| `bridge` | Frames crossing a Linux bridge | Virtualisation hosts |
| `netdev` | Packets at ingress, per device | Early drops before the stack does work |

Use `inet` for a host firewall. One rule such as `tcp dport 443 accept` then covers both IPv4 and IPv6, which removes the classic mistake of securing IPv4 carefully and leaving IPv6 wide open.

### Hooks and policy

A host firewall cares about three hooks:

- `input`: packets addressed to the machine itself.
- `forward`: packets passing through the machine to somewhere else. This matters on routers and on hosts that run containers or virtual machines.
- `output`: packets the machine itself sends.

Each base chain has a *policy*, the verdict applied to a packet that reaches the end of the chain without matching any rule. Setting the input policy to `drop` is what makes a firewall default-deny: anything you did not explicitly allow is discarded.

The chain declaration also carries a priority, which orders chains attached to the same hook. The keyword `filter` is a named priority (numerically 0) and is the right choice for ordinary filtering.

## Before you start: do not lock yourself out

**Warning: applying a firewall ruleset over SSH can cut your own connection. If the rules are wrong, the only way back in may be a provider console or physical access.** Take these precautions before loading anything on a remote machine.

First, make sure you have a second way in: a cloud provider's serial or web console, an out-of-band management interface, or someone at the keyboard.

Second, save the current ruleset in a form that can be restored. The `flush ruleset` line at the top matters, because `nft list ruleset` prints only the rules, and loading that output on top of a live ruleset would fail or duplicate objects instead of replacing them.

```bash
{ echo "flush ruleset"; sudo nft list ruleset; } | sudo tee /root/nft-backup.nft > /dev/null
```

Third, schedule an automatic rollback before you apply the new rules. On a systemd machine, `systemd-run` can create a one-off timer:

```bash
sudo systemd-run --unit=nft-rollback --on-active=3min /usr/sbin/nft -f /root/nft-backup.nft
```

If the new ruleset locks you out, the old one comes back after three minutes. If everything works, cancel the rollback:

```bash
sudo systemctl stop nft-rollback.timer
```

Finally, keep your existing SSH session open and test with a *new* connection from a second terminal. An established session can survive a ruleset that would refuse new connections, so a working old session proves nothing.

## A baseline ruleset for a server

Install the tools if they are not already present. On Debian and Ubuntu the package is `nftables`; on Fedora, RHEL and their relatives it has the same name under `dnf`.

```bash
sudo apt install nftables
sudo nft --version
```

Now write the ruleset. This one suits a typical web server: SSH from a short list of trusted addresses, HTTP and HTTPS from anywhere, everything else dropped. The addresses shown are from the documentation ranges and must be replaced with your own before you apply it.

```bash
sudo nano /etc/nftables.conf
```

```nft
#!/usr/sbin/nft -f

flush ruleset

table inet filter {
    set admin_v4 {
        type ipv4_addr
        flags interval
        elements = { 203.0.113.10, 198.51.100.0/24 }
    }

    chain input {
        type filter hook input priority filter; policy drop;

        ct state established,related accept
        ct state invalid drop
        iif "lo" accept

        ip protocol icmp icmp type { echo-request, destination-unreachable, time-exceeded, parameter-problem } accept
        meta l4proto ipv6-icmp accept

        tcp dport 22 ip saddr @admin_v4 accept
        tcp dport { 80, 443 } accept

        limit rate 5/minute burst 10 packets log prefix "nft-drop: " level info
        counter drop
    }

    chain forward {
        type filter hook forward priority filter; policy drop;
    }

    chain output {
        type filter hook output priority filter; policy accept;
    }
}
```

### What each part does

`flush ruleset` clears everything first, so loading the file always produces exactly the state the file describes. The whole file is applied as one atomic transaction: either every line takes effect or none does, and there is no moment in between where the machine is unprotected. Be aware that this line also removes rules created by other software; see the note on Docker in the mistakes section.

`ct state established,related accept` uses connection tracking, the kernel's record of flows it has already seen. It accepts replies to connections that were allowed in the first place, which is why you do not need separate rules for return traffic. Placing it first is also the cheapest arrangement, since the bulk of packets on a busy server belong to existing connections and leave the chain after one comparison.

`ct state invalid drop` discards packets that match no known connection and could not legitimately start one.

`iif "lo" accept` allows loopback traffic. Many programs talk to themselves over `127.0.0.1`, and blocking that breaks things in confusing ways.

The two ICMP lines keep diagnostics and error reporting working. The IPv6 line is not optional: IPv6 uses ICMPv6 for neighbour discovery, the equivalent of ARP, and a host that drops it loses IPv6 connectivity entirely. Accepting all ICMPv6 is a simple, safe starting point for a single host.

The SSH rule accepts port 22 only from addresses in the `admin_v4` set. If you connect from a changing address and cannot list one, replace that line with `tcp dport 22 accept` and rely on key-only authentication instead; the [SSH hardening guide](/blog/ssh-hardening-guide/) covers that side.

The last two lines log a sample of what is about to be dropped and then drop it while counting. The `limit` on the log rule stops a port scan from flooding your logs. The explicit `counter drop` duplicates what the policy would do anyway, but it gives you a number to look at.

The forward chain drops everything because a plain server should not route packets for others. The output chain accepts everything, which is a reasonable start; restricting outbound traffic is worthwhile on sensitive hosts but needs a careful inventory of what the machine contacts (DNS, package mirrors, time servers, monitoring).

## Check, apply and verify

Check the file for errors without touching the live ruleset. The `-c` flag parses and validates only:

```bash
sudo nft -c -f /etc/nftables.conf
```

No output means the file is valid. With your rollback timer armed, apply it:

```bash
sudo nft -f /etc/nftables.conf
```

Then verify, in this order.

1. Open a **new** SSH session from an allowed address. If it connects, cancel the rollback timer.
2. Read back what the kernel is actually enforcing:

```bash
sudo nft list ruleset
```

3. From a different machine, confirm that an allowed port answers and a closed one does not. A dropped port makes the client wait until it times out, since no reply is sent:

```bash
curl -I --max-time 5 http://your-server.example/
nc -vz -w 5 your-server.example 3306
```

4. Compare against what is listening. Any port in this list that is bound to a public address should be either allowed on purpose or blocked on purpose:

```bash
sudo ss -tulpn
```

5. Watch the drop counter grow as unwanted traffic arrives:

```bash
sudo nft list chain inet filter input
```

## Sets and rate limits

### Sets

A set is a named collection of addresses, ports or other values that rules can refer to with `@name`. Sets keep rules short and are looked up efficiently however many elements they hold. They can also be changed at runtime without reloading the ruleset:

```bash
sudo nft add element inet filter admin_v4 '{ 192.0.2.44 }'
sudo nft delete element inet filter admin_v4 '{ 192.0.2.44 }'
sudo nft list set inet filter admin_v4
```

The single quotes stop your shell from interpreting the braces. A runtime change like this lasts only until the next reload or reboot, so add the address to `/etc/nftables.conf` as well if it should stay.

The braces in `tcp dport { 80, 443 }` are an *anonymous* set: the same mechanism written inline, fixed once the rule is loaded.

### Rate limiting new connections

A dynamic set lets the firewall keep per-address state. This pair of additions slows down sources that open SSH connections too quickly. Declare the set inside the table:

```nft
    set ssh_flood {
        type ipv4_addr
        flags dynamic, timeout
        timeout 10m
    }
```

and place this rule in the input chain *above* the rule that accepts port 22:

```nft
        tcp dport 22 ct state new add @ssh_flood { ip saddr limit rate over 10/minute } drop
```

Each source address gets its own counter. Once an address exceeds ten new connections per minute, further attempts are dropped until its rate falls. Entries expire after ten minutes without updates, so the set does not grow without bound. Order matters here: rules are evaluated top to bottom and the first verdict wins, so a rate limit placed below the accept rule would never be reached.

This is a throttle, not an authentication control. It reduces noise and slows down password guessing; it does not replace disabling password logins.

## Making the rules persistent

Rules loaded with `nft -f` live in kernel memory and vanish at reboot. The `nftables` package on Debian, Ubuntu and similar systems ships a systemd service that loads `/etc/nftables.conf` at boot:

```bash
sudo systemctl enable --now nftables.service
systemctl status nftables.service
```

On Fedora and RHEL-family systems the service reads `/etc/sysconfig/nftables.conf` instead, and firewalld is usually active by default. Run one firewall manager, not two: either keep firewalld and manage rules through it, or disable it before using a hand-written ruleset.

After changing the file, check it and reload:

```bash
sudo nft -c -f /etc/nftables.conf && sudo systemctl reload nftables.service
```

The real test of persistence is a reboot. Do it at a time when you have console access, then run `sudo nft list ruleset` and confirm the rules are present. If you are new to unit files and want to understand what `enable` and `reload` do here, see the [systemd service units guide](/blog/systemd-service-units-guide/).

## Changing rules on a live system

For anything permanent, edit the file and reload. For quick experiments, rules can be added from the command line.

```bash
sudo nft add rule inet filter input tcp dport 8080 accept
```

`add` appends to the end of the chain. In the baseline ruleset the end is after `counter drop`, so this rule would never match. Use `insert` to put a rule at the top, or address a position by handle. Handles are the stable identifiers nftables gives every rule; show them with `-a`:

```bash
sudo nft -a list chain inet filter input
```

```bash
sudo nft add rule inet filter input position 13 tcp dport 8080 accept
sudo nft delete rule inet filter input handle 16
```

`add rule ... position N` places the new rule after the rule with handle N; `insert rule ... position N` places it before. The handle numbers above are examples: read the real ones from the `-a` listing first.

### Tracing a packet

When a packet is not treated the way you expect, tracing shows which rules it hit. Mark the traffic you care about, then watch:

```bash
sudo nft insert rule inet filter input tcp dport 8080 meta nftrace set 1
sudo nft monitor trace
```

Each matching packet prints the chain and rule it passed through and the final verdict. Remove the trace rule afterwards (find its handle with `-a` and delete it), because tracing all traffic on a busy port is expensive.

## Common mistakes

**Testing with the session you already have.** Established connections are accepted by the first rule. Only a new connection proves the SSH rule works.

**Forgetting IPv6.** With an `ip` table, IPv6 traffic is not filtered at all. Use `inet`, and do not drop ICMPv6.

**Appending rules after the final drop.** A rule below an unconditional `drop` is dead. If a new rule seems to have no effect, list the chain and look at where it landed.

**`iif` against an interface that comes and goes.** `iif "eth0"` is resolved to an interface index when the rule is loaded, which is fast but fails if the interface does not exist yet and goes stale if it is recreated. For interfaces that appear dynamically, such as VPN or container interfaces, match by name with `iifname` instead. The loopback interface is always present, so `iif "lo"` is fine.

**`flush ruleset` on a Docker host.** Docker creates its own NAT and forwarding rules. Flushing the whole ruleset deletes them, and containers lose connectivity until the Docker daemon is restarted. On a container host, restart Docker after reloading the firewall, or avoid the global flush by replacing only your own table. Starting the file with these two lines instead of `flush ruleset` does that; the first line makes sure the table exists so the delete on the second cannot fail:

```nft
table inet filter
delete table inet filter
```

Note also that a forward policy of `drop` in your table applies to container traffic too. A packet must be accepted by every base chain it passes through, so on a container host the forward chain needs rules that allow the bridge traffic you want.

**Assuming the input chain protects published container ports.** Traffic to a port published by Docker is redirected to the container and travels through the forward hook, not input. Your `tcp dport` rules in the input chain do not see it. Bind published ports to `127.0.0.1` when they should not be public; the [Docker security article](/blog/docker-security-best-practices/) explains this in more detail.

**Mixing tools.** Running ufw, firewalld or legacy iptables scripts next to a hand-written nftables file produces rulesets that fight each other. Check with `sudo nft list ruleset`: if you see tables you did not write, something else is managing the firewall too.

## Frequently asked questions

### Is nftables a replacement for iptables?

Yes. nftables is the successor to iptables, ip6tables, arptables and ebtables, with one syntax and one tool for all of them. On current distributions the `iptables` command is usually a compatibility layer that translates into nftables rules in the kernel, which is why rules from old tooling can show up in `nft list ruleset`.

### Should I use nftables directly or a front end like ufw or firewalld?

Front ends are fine for simple needs and are easier to start with. Writing nftables directly gives you one file that states the complete policy, atomic reloads and features such as sets and per-address limits. Pick one approach per machine and do not combine them.

### Do I need rules for outgoing traffic?

Not to begin with. An output policy of `accept` is common for general-purpose servers. Outbound filtering limits what a compromised process can reach, but it must be built from a list of the destinations the server legitimately needs, or updates and name resolution will break.

### Why does a blocked port hang instead of refusing the connection?

`drop` discards the packet silently, so the client waits for a reply that never comes. If you prefer an immediate refusal, for example on an internal network where quick failure helps debugging, use `reject` in place of `drop`. On internet-facing hosts, `drop` is the usual choice.

### How do I undo everything quickly?

`sudo nft flush ruleset` removes all rules and leaves the machine with no filtering. To return to a known state, load a saved file with `sudo nft -f /root/nft-backup.nft`. For the wider picture of locking down a server beyond the firewall, continue with the [Linux server hardening checklist](/blog/linux-server-hardening-checklist/).
