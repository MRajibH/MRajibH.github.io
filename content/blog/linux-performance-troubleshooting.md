---
title: "Linux performance troubleshooting: what to check first"
description: "A repeatable first-ten-minutes routine for a slow Linux server: load, CPU, memory, disk and network checks, and how to read what the tools print."
date: 2026-11-15
tags: [linux]
draft: true
---

"The server is slow" is one of the least specific problem reports there is, and guessing at the cause wastes the time when it matters most. This guide gives you a fixed order of checks for a slow Linux machine, explains what each number means, and shows how to tell which of the four basic resources (CPU, memory, disk, network) is actually the limit.

By the end you will be able to log in to an unfamiliar server, work through a short routine and say with evidence where the bottleneck is, instead of restarting services and hoping.

## The first two minutes

Start wide and narrow down. These commands are quick, read-only and present on almost every system. The ones marked with `sysstat` come from the package of that name, which is worth installing on every server before you need it (`sudo apt install sysstat` or `sudo dnf install sysstat`).

```bash
uptime                      # load averages: is it getting worse or better?
sudo dmesg -T | tail -n 30  # recent kernel messages: OOM kills, disk errors
vmstat 1 5                  # run queue, swapping, CPU split, once a second
mpstat -P ALL 1 3           # per-CPU usage (sysstat)
pidstat 1 3                 # per-process CPU usage (sysstat)
iostat -xz 1 3              # per-disk load and latency (sysstat)
free -h                     # memory, including what is reclaimable
df -h && df -i              # full filesystems and exhausted inodes
ss -s                       # socket summary
top                         # interactive overview to finish
```

The order is deliberate. `uptime` tells you whether there is a problem now and which way it is trending. `dmesg` catches the cases where the kernel has already told you the answer, such as a process killed for lack of memory or a failing disk. The middle commands each cover one resource. `top` comes last because it is the easiest to misread when you do not yet know what you are looking for.

For each resource, ask three questions: how busy is it (utilisation), is work queuing for it (saturation), and is it reporting errors? A resource can be only moderately busy on average and still be the bottleneck if work is waiting in line for it, so saturation is usually the more telling sign.

| Resource | Utilisation | Saturation | Errors |
| --- | --- | --- | --- |
| CPU | `mpstat -P ALL 1`, `top` | `r` column in `vmstat`, `/proc/pressure/cpu` | `dmesg` (rare) |
| Memory | `free -h` | `si`/`so` in `vmstat`, `/proc/pressure/memory` | OOM kills in `dmesg` |
| Disk | `%util` in `iostat -xz` | `aqu-sz` and `await` in `iostat` | I/O errors in `dmesg` |
| Network | `sar -n DEV 1` | drops in `ip -s link`, retransmits in `nstat` | errors in `ip -s link` |

## Reading load average correctly

`uptime` prints three load averages, covering roughly the last one, five and fifteen minutes:

```bash
uptime
```

```text
 14:02:11 up 41 days,  3:17,  2 users,  load average: 9.40, 6.12, 2.75
```

Read them right to left to see the trend. Here the load was low fifteen minutes ago and has climbed steadily, so whatever is wrong started recently and is still going on. Falling numbers mean you may have arrived after the event.

Two points are often misunderstood.

First, the number has to be compared with the CPU count. A load of 9 on a machine with 32 CPUs is unremarkable; on a machine with 2 it means work is queuing. Check the count with `nproc`.

Second, on Linux the load average is not purely a CPU measure. It counts tasks that are running or waiting for a CPU, and also tasks in uninterruptible sleep, which mostly means waiting for disk I/O. A high load with idle CPUs is therefore a common and perfectly consistent picture: it points at storage, or at something like a hung network filesystem, not at the processor.

Load average tells you that something is queuing. The rest of the routine finds out what.

## CPU: who is using it and how

`vmstat` gives the fastest summary. Ignore the first line of output, which is an average since boot, and read the ones that follow.

```bash
vmstat 1 5
```

The columns that matter here:

- `r`: tasks running or waiting to run. If it is consistently higher than the number of CPUs, the CPU is saturated.
- `us`: time in user space, meaning application code.
- `sy`: time in the kernel on behalf of processes: system calls, networking, filesystem work.
- `id`: idle.
- `wa`: idle while waiting for I/O to finish. This is a disk signal, not a CPU one.
- `st`: steal, time the hypervisor gave to other virtual machines when this one wanted to run.

Each pattern suggests a different next step:

| Pattern | Likely meaning | Look next |
| --- | --- | --- |
| High `us` | An application is doing a lot of computation | `pidstat 1`, then profile that process |
| High `sy` | Heavy system call, network or filesystem activity | `strace -c -p PID`, `perf top` |
| High `wa`, low `us`/`sy` | Processes blocked on storage | The disk section below |
| High `st` | The virtual machine is not getting the CPU it asks for | Host contention or a provider CPU limit |
| High `r`, CPUs fully busy | More runnable work than CPUs | Reduce the work or add capacity |

Next, look at each CPU separately:

```bash
mpstat -P ALL 1 3
```

One CPU at 100% while the rest are idle means a single-threaded process is the limit. The average across all CPUs would look harmless, perhaps 8% on a 12-CPU machine, which is exactly why the per-CPU view matters. More cores will not help in that case.

Then find the process:

```bash
pidstat 1 3
```

`pidstat` prints a rolling per-process breakdown of user and system time, which is easier to read and to paste into a ticket than a `top` screen. For a process made of many threads, `pidstat -t -p PID 1` shows which thread is busy.

Once you know the process, two tools show what it is doing. Both add overhead while they run, `strace` considerably, so use them briefly on production systems.

```bash
sudo strace -c -p 12345    # count system calls; stop with Ctrl+C for the summary
sudo perf top -p 12345     # live view of the hottest functions
```

## Memory: used is not the same as short

Linux uses spare memory to cache file data, because unused memory is wasted memory. This makes a healthy system look almost full.

```bash
free -h
```

```text
               total        used        free      shared  buff/cache   available
Mem:            15Gi       6.1Gi       420Mi       310Mi       9.0Gi       9.1Gi
Swap:          4.0Gi          0B       4.0Gi
```

The `free` column here is small, and that is fine. The number to read is `available`: an estimate of how much memory can be given to applications without swapping, counting cache that can be dropped immediately. This machine has about 9 GiB to spare.

Real memory pressure shows up in other ways:

- **`available` is low and falling**, a few percent of the total.
- **The `si` and `so` columns in `vmstat` are persistently non-zero.** They show memory being read back from swap and written out to it each second. Swap that is merely *used* is not a problem; pages moved out long ago can sit there harmlessly. Continuous swapping in and out is what makes a machine crawl.
- **The kernel has killed something.** When memory runs out completely, the out-of-memory (OOM) killer picks a process and ends it. Search the kernel log:

```bash
sudo dmesg -T | grep -i -E "out of memory|oom-kill"
sudo journalctl -k --since "1 hour ago" | grep -i "out of memory"
```

A service that "randomly restarts" is very often being killed this way.

To see which processes hold the memory, sort by resident set size (RSS), the physical memory a process currently occupies:

```bash
ps -eo pid,user,rss,comm --sort=-rss | head -n 15
```

RSS is reported in kibibytes. Bear in mind that shared memory is counted in every process that maps it, so the RSS of a group of worker processes cannot simply be added up.

If a service runs under systemd, its memory use as a whole unit, including child processes, is shown by `systemctl status name.service`, and `systemd-cgtop` gives a live view ranked by unit. Containers have their own limits: a container can be killed for exceeding its own memory limit while the host has plenty free.

## Disk: latency matters more than throughput

Storage is the slowest component in most servers and a frequent cause of "high load, idle CPU".

```bash
iostat -xz 1 3
```

`-x` asks for extended statistics and `-z` hides devices with no activity. As with `vmstat`, skip the first report, which covers the time since boot. The useful columns:

- `r/s`, `w/s`: read and write requests per second.
- `rkB/s`, `wkB/s`: the amount of data read and written.
- `r_await`, `w_await`: the average time in milliseconds a request takes, including time spent queued. This is what applications feel.
- `aqu-sz`: the average number of requests queued or in flight.
- `%util`: the share of time the device had at least one request in progress.

Judge by `await` first. What counts as slow depends on the hardware: an NVMe drive normally answers in well under a millisecond, while a spinning disk takes several. A sudden rise against that device's own normal figure is the signal. Treat `%util` with care on SSDs, NVMe drives and RAID arrays: these serve many requests in parallel, so a value near 100% shows the device is continuously busy, not that it has reached its limit.

To find the process responsible:

```bash
pidstat -d 1 3
```

This lists read and write rates per process. `sudo iotop -o` does the same interactively if it is installed.

Two storage problems do not show up as load at all, and both produce "No space left on device" errors:

```bash
df -h     # space
df -i     # inodes
```

A filesystem can have free space and still be unable to create files because it has run out of inodes, the structures that describe files. Millions of tiny files, such as session files or mail queues, are the usual cause. To find where space has gone, stay on one filesystem with `-x` and sort the result:

```bash
sudo du -xh --max-depth=1 /var | sort -h | tail -n 10
```

If `df` reports a full disk but `du` cannot account for it, a running process is probably holding a deleted file open, typically a log file that was removed without telling the service. The space is released only when the process closes the file or restarts.

## Network: errors, drops and retransmits

Network problems tend to appear as slow or failing requests while every local resource looks idle. Start with the interface counters:

```bash
ip -s link show
```

Each interface shows receive and transmit totals with `errors` and `dropped` columns. Take two readings a few seconds apart; counters that keep rising matter, old totals do not.

For throughput per interface over time:

```bash
sar -n DEV 1 5
```

Next, check TCP health. Retransmissions mean packets were lost or delayed somewhere on the path:

```bash
nstat -az | grep -i retrans
ss -s
ss -ltn
```

`nstat` prints kernel network counters; run it twice and compare. `ss -s` summarises sockets by state, and `ss -ltn` lists listening TCP sockets with two queue columns: `Recv-Q` is the number of connections currently waiting to be accepted by the application, and `Send-Q` is the maximum the queue can hold. A `Recv-Q` that stays near `Send-Q` means the application is not accepting connections fast enough, so new clients are delayed or refused even though the network itself is healthy.

Do not forget name resolution. A slow or unreachable DNS server makes everything that opens a connection by name appear slow. Time a lookup directly, where the address shown is a stand-in for your resolver:

```bash
time getent hosts example.com
dig example.com @192.0.2.53 | grep "Query time"
```

If a host firewall is in play, dropped packets look just like packet loss to an application. The [nftables guide](/blog/nftables-firewall-guide/) shows how to count and trace what the firewall discards.

## Pressure stall information: a direct measure of waiting

Most of the numbers above measure activity and leave you to infer whether anything is suffering. Pressure stall information (PSI) measures the suffering itself: the share of time tasks were stalled waiting for a resource.

```bash
cat /proc/pressure/cpu
cat /proc/pressure/memory
cat /proc/pressure/io
```

```text
some avg10=12.40 avg60=8.15 avg300=3.02 total=157580209
full avg10=4.10 avg60=2.31 avg300=0.85 total=45267021
```

The `some` line is the percentage of time at least one task was stalled on that resource, averaged over the last 10, 60 and 300 seconds. The `full` line is the percentage of time all non-idle tasks were stalled at once, which is time in which no useful work happened. `total` is the accumulated stall time in microseconds.

Values near zero mean nothing is waiting. In the sample above, tasks have spent about 12% of the last ten seconds waiting for I/O, and the figure is rising across the three windows, so storage is the place to look. PSI is especially useful on machines where utilisation numbers mislead, such as hosts running many containers.

If the `/proc/pressure` directory does not exist, the running kernel was built without PSI or has it switched off; the other tools in this guide still apply.

## Looking back in time

Many problems are over by the time you log in. The `sysstat` package can record system activity at regular intervals so that you can look at the past. On Debian and Ubuntu, collection is enabled by setting `ENABLED="true"` in `/etc/default/sysstat` and then enabling the service; on Fedora and RHEL-family systems, installing the package and enabling the service is enough.

```bash
sudo systemctl enable --now sysstat
```

Once data has been collected, `sar` reads it back:

```bash
sar -u                           # CPU, today
sar -r                           # memory
sar -d                           # disks
sar -q                           # run queue and load
sar -n DEV                       # network interfaces
sar -u -s 02:00:00 -e 03:00:00   # only between these times
```

The location of earlier days' files differs between distributions (`/var/log/sysstat/` on Debian and Ubuntu, `/var/log/sa/` on RHEL-family systems); pass one with `-f`.

Combine this with the journal to line events up with resource use:

```bash
journalctl --since "02:00" --until "03:00" -p warning
```

A CPU spike at the same minute every night, next to a cron job or a systemd timer in the journal, is a finding you can act on. For services that need limits or scheduling changes as a result, see the [systemd service units guide](/blog/systemd-service-units-guide/).

## Common mistakes

**Restarting before looking.** A restart often clears the symptom and destroys the evidence. Spend two minutes capturing `vmstat`, `iostat`, `free` and the top processes first. If you must restart immediately, at least save `dmesg` and the process list to a file.

**Treating low free memory as a problem.** Page cache fills spare memory by design. Read `available`, swap activity and OOM messages instead.

**Treating swap usage as a problem.** Used swap with zero `si`/`so` is idle data parked on disk. Only ongoing swapping hurts.

**Reading load average as CPU usage.** Load includes tasks blocked on I/O. Always compare it with the CPU count and with the `wa` column.

**Trusting averages.** An average over all CPUs hides one saturated core, and an average over five minutes hides a ten-second stall. Use per-CPU and one-second views when hunting.

**Reading the first line of `vmstat` or `iostat`.** The first report is the average since boot and says nothing about the present.

**Changing several things at once.** If you raise a limit, restart a service and tune a kernel setting together, you cannot tell which one helped. Change one thing, then measure again with the same command you used to find the problem.

**Tuning kernel parameters first.** Most slowness comes from the workload: a missing database index, an unbounded queue, a runaway log, a job scheduled at a bad time. Kernel tuning is the last step, after you have shown the kernel is the limit.

## Frequently asked questions

### What load average is too high?

There is no universal figure. As a rule of thumb, sustained load above the number of CPUs means tasks are waiting. Whether they wait for CPU or for I/O is the next question, answered by `vmstat` and `iostat`. The trend across the three averages is more useful than any single value.

### Why is my server slow when CPU usage is low?

The usual causes are storage latency, memory pressure with swapping, a saturated single thread hidden by the all-CPU average, or something outside the machine such as a slow database, DNS server or upstream API. Check `wa` in `vmstat`, `await` in `iostat`, `si`/`so`, per-CPU usage, and the pressure files.

### Is it safe to run these tools on a production server?

The observation tools in the first section only read counters the kernel already keeps and add negligible load. `strace` is the exception: it can slow the traced process substantially, so attach it briefly. `perf` sampling is much lighter but still best kept short.

### How do I find out what happened last night?

You need data that was recorded at the time: `sar` history from `sysstat`, the journal, application logs and any external monitoring. If none of that was collected, enable `sysstat` now so the next occurrence is captured.

### Should I add more RAM or CPUs?

Only after the measurements say that resource is saturated. More memory helps when `available` is low and the system is swapping or OOM-killing. More CPUs help when the run queue exceeds the CPU count and the workload can run in parallel. Neither helps a single-threaded bottleneck or a slow disk.
