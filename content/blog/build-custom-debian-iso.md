---
title: "How to build a custom Debian ISO with live-build"
description: "Build a bootable, installable Debian ISO with live-build: configuration, package lists, files, hooks, the installer, testing in QEMU and rebuilds."
date: 2026-11-15
tags: [linux]
draft: true
---

Installing Debian and then adding the same packages and settings by hand on every machine is slow and hard to repeat exactly. live-build, the tool the Debian project uses to produce its own live images, turns a directory of plain-text configuration into a bootable ISO that already contains your packages, files and settings. This guide takes you from an empty directory to an image you have booted in a virtual machine, and explains what each piece of the configuration does so you can adapt it.

Everything here applies to Debian 12 (bookworm) and Debian 13 (trixie). Run the build on Debian itself. Ubuntu ships its own, much older variant of live-build that behaves differently, so on an Ubuntu workstation use a Debian virtual machine as the build host.

## How live-build works

live-build is a set of scripts driven by one command, `lb`, with three subcommands you will use constantly:

- `lb config` creates or updates a `config/` directory describing the image.
- `lb build` reads `config/` and produces the image. It needs root.
- `lb clean` removes build output so the next build starts fresh.

A build runs through stages, and knowing them explains where each kind of customisation goes.

| Stage | What happens | What you can customise |
|---|---|---|
| bootstrap | A minimal Debian system is created with `debootstrap` | Distribution, mirror, architecture |
| chroot | Packages are installed and the system is configured inside a `chroot/` directory | Package lists, files, hook scripts |
| binary | The chroot is compressed into a SquashFS file and wrapped with a bootloader into an ISO | Boot parameters, files on the medium, the installer |

A chroot is a directory that a process treats as its root filesystem. During the chroot stage, live-build runs `apt` inside that directory as if it were a running system, which is how an image ends up with packages installed without ever being booted.

The resulting image is a live system: it boots and runs from the read-only SquashFS with a writable layer in memory. If you add the Debian Installer, the same ISO can also install that system to disk.

## Install live-build and prepare the build host

```bash
sudo apt update
sudo apt install live-build
```

That pulls in `debootstrap` and the other tools the build needs. Check the installed version, since option names have changed between releases:

```bash
dpkg -s live-build | grep Version
man lb_config
```

The manual page on your build host is the reference for the options your version accepts. A few practical points before starting:

- **Disk space.** A build downloads every package, unpacks them into `chroot/`, then compresses them again. Expect several gigabytes for a small image and considerably more for a desktop. Check with `df -h .` first.
- **Filesystem.** Build on a native Linux filesystem mounted without the `nodev` or `noexec` options. Shared folders from a virtual machine host and some network mounts cause failures part-way through the chroot stage.
- **Matching releases.** Building an image of the same Debian release as the build host is the best-tested path.

Create a working directory. Everything live-build reads and writes stays inside it:

```bash
mkdir -p ~/iso/custom-debian && cd ~/iso/custom-debian
```

## Create the configuration with auto scripts

You could run `lb config` once with a long list of options, but those options would then exist only in your shell history. The recommended approach is to store them in a script, `auto/config`, which `lb config` runs automatically. The whole directory can then be kept in Git and rebuilt by anyone.

live-build ships examples to start from:

```bash
mkdir auto
cp /usr/share/doc/live-build/examples/auto/* auto/
```

This gives you three scripts. `auto/build` runs the build and writes its output to `build.log`. `auto/clean` runs the clean-up and also removes the generated files under `config/`. Replace the contents of `auto/config` with your own options:

```bash
#!/bin/sh

set -e

lb config noauto \
    --distribution trixie \
    -a amd64 \
    -b iso-hybrid \
    --archive-areas "main contrib non-free non-free-firmware" \
    --debian-installer live \
    --bootappend-live "boot=live components locales=en_GB.UTF-8 keyboard-layouts=gb" \
    --image-name custom-debian \
    --iso-volume "Custom Debian" \
    "${@}"
```

What each line is for:

- `noauto` stops `lb config` from calling `auto/config` again and looping for ever. Do not remove it.
- `--distribution` is the Debian release by codename. Set it explicitly: the built-in default is `testing`, which changes under you.
- `-a amd64` sets the architecture. The default is the architecture of the build host.
- `-b iso-hybrid` selects the image type. A hybrid ISO can be burned to optical media or written directly to a USB stick. Other values include `hdd` for a disk image and `netboot` for network booting.
- `--archive-areas` chooses which sections of the Debian archive packages may come from. The default is `main` only. Adding `non-free-firmware` makes firmware for common network and graphics hardware available; `contrib` and `non-free` are needed only if you list packages from them.
- `--debian-installer live` adds the Debian Installer in the mode that copies the live system to disk. Leave the option out for a live-only image.
- `--bootappend-live` sets kernel parameters for the live system. `boot=live` and `components` are required for it to start and configure itself; the `locales` and `keyboard-layouts` parameters set the language and keyboard.
- `--image-name` sets the start of the output file name. The default is `live-image`.
- `--iso-volume` is the volume label shown when the medium is mounted.
- `"${@}"` passes through any extra options given on the command line.

Make the scripts executable and generate the configuration tree:

```bash
chmod +x auto/*
lb config
ls config/
```

You now have a `config/` directory with generated settings files (`binary`, `bootstrap`, `chroot`, `common`, `source`) and empty subdirectories for your customisations. Treat the generated files as output: change options in `auto/config` and run `lb config` again.

## Choose the packages

Packages are listed in text files under `config/package-lists/`. A file must end in `.list.chroot` to be installed into the live system. You can have as many lists as you like, which helps keep them organised by purpose.

```bash
cat > config/package-lists/base.list.chroot <<'EOF'
# Administration
sudo
openssh-server
curl
ca-certificates
vim-tiny
htop

# Networking
network-manager
nftables
EOF
```

One package per line; lines starting with `#` are comments. Dependencies are resolved by `apt`, so list what you want, not everything it needs.

For a desktop, list a task metapackage, which is a package that exists only to depend on a whole set:

```bash
echo "task-xfce-desktop" > config/package-lists/desktop.list.chroot
```

Two related mechanisms cover the cases package lists do not:

- **Local packages.** Copy any `.deb` file into `config/packages.chroot/` and it is installed into the image. This is the simplest way to include software you built yourself.
- **Extra repositories.** Put an APT source line in `config/archives/name.list.chroot` and the repository's signing key in `config/archives/name.key.chroot`. Packages from it can then be named in your lists.

By default `apt` also installs recommended packages, which is what a normal Debian install does. To build a smaller image, add `--apt-recommends false` to `auto/config`, and be prepared to list a few packages explicitly that you previously got for free.

## Add files and run hooks

Packages give you software. Files and hooks give you configuration.

### Files in the live system

Anything placed under `config/includes.chroot/` is copied into the image's filesystem at the same path, after packages are installed, so your files replace packaged versions.

```bash
mkdir -p config/includes.chroot/etc/skel
mkdir -p config/includes.chroot/etc/ssh/sshd_config.d

echo "alias ll='ls -lah'" > config/includes.chroot/etc/skel/.bash_aliases

cat > config/includes.chroot/etc/ssh/sshd_config.d/10-hardening.conf <<'EOF'
PermitRootLogin no
PasswordAuthentication no
EOF
```

`/etc/skel` is the template for new home directories, so files there appear for every user created on the system. The SSH settings are a small example of shipping a secure default; the [SSH hardening guide](/blog/ssh-hardening-guide/) explains the full set.

Files under `config/includes.binary/` go onto the ISO itself, next to the boot files, not into the system. Use that for documentation or scripts a user should find when they browse the medium.

### Hook scripts

A hook is a shell script that runs inside the chroot after packages and files are in place. Use one for anything that needs a command: enabling a service, removing a file, changing a default.

```bash
cat > config/hooks/normal/9000-site-setup.hook.chroot <<'EOF'
#!/bin/sh

set -e

# Start the firewall at boot
systemctl enable nftables.service

# Do not keep downloaded package lists in the image
rm -rf /var/lib/apt/lists/*
EOF

chmod +x config/hooks/normal/9000-site-setup.hook.chroot
```

The file name must end in `.hook.chroot`. Hooks run in name order, so the number at the front controls sequence. `set -e` matters: without it a failing command is ignored and you get an image that silently lacks the change. Hooks ending in `.hook.binary` run during the binary stage, outside the chroot, and can alter the contents of the medium.

A hook runs in a chroot, not a booted system. `systemctl enable` works because it only creates symbolic links, but `systemctl start` and anything else that needs a running init system does not.

### The live user and the installer

When the image boots as a live system, the live-config package creates a user at boot. Unless you change it, the user is named `user` with the password `live`, and it has `sudo` rights. That is fine for a rescue or demonstration medium and unsuitable for anything left running on a network, so if you include `openssh-server`, keep password login disabled as in the example above.

With `--debian-installer live`, the boot menu gains installer entries. The installer asks its usual questions and creates the real user accounts for the installed system. To answer those questions in advance, place a preseed file (the Debian Installer's answer-file format) at `config/includes.installer/preseed.cfg`.

## Build and test the image

```bash
sudo lb build
```

With the example auto scripts in place, the full output is also saved to `build.log`. A first build downloads every package and can take a long time; later builds reuse the downloads kept in `cache/`.

When it finishes, the image is in the working directory:

```bash
ls -lh *.iso
sha256sum custom-debian-amd64.hybrid.iso
```

Publish the checksum alongside the image if other people will download it, so they can confirm the file arrived intact.

### Boot it in a virtual machine

Never test first on real hardware. QEMU boots the ISO directly:

```bash
sudo apt install qemu-system-x86
qemu-system-x86_64 -enable-kvm -m 2G -cdrom custom-debian-amd64.hybrid.iso
```

`-enable-kvm` uses hardware virtualisation and needs access to `/dev/kvm`; without it, drop the flag and expect a much slower boot. To test the installer as well, give the machine an empty disk to install to:

```bash
qemu-img create -f qcow2 test-disk.qcow2 20G
qemu-system-x86_64 -enable-kvm -m 2G \
    -cdrom custom-debian-amd64.hybrid.iso \
    -drive file=test-disk.qcow2,format=qcow2
```

Inside the booted system, check that your changes are present:

```bash
dpkg -l openssh-server nftables      # packages installed
systemctl is-enabled nftables        # hook ran
cat /etc/ssh/sshd_config.d/10-hardening.conf   # file included
```

If something is missing, the cause is nearly always a file name with the wrong suffix or a file in the wrong directory.

### Write it to a USB stick

**Warning:** the next command overwrites the whole target device. Run `lsblk` before and after plugging in the stick to identify it, and use the device itself (for example `/dev/sdb`), not a partition (`/dev/sdb1`).

```bash
lsblk
sudo dd if=custom-debian-amd64.hybrid.iso of=/dev/sdX bs=4M status=progress conv=fsync
```

Replace `/dev/sdX` with the device you identified. `conv=fsync` makes `dd` wait until the data is physically written before it exits.

## Rebuild, clean and version the configuration

You will rebuild many times. How much you clean first decides how long each rebuild takes.

| Command | Removes | Use it when |
|---|---|---|
| `sudo lb clean --binary` | Only the binary stage output | You changed boot parameters or `includes.binary` |
| `sudo lb clean` | Chroot, binary and source output; keeps `cache/` | You changed packages, includes or hooks |
| `sudo lb clean --purge` | Everything, including `cache/` | Results are inconsistent or you changed distribution |

The usual loop after editing package lists, includes or hooks is:

```bash
sudo lb clean
lb config
sudo lb build
```

Because `sudo lb build` runs as root, the build directories are owned by root, which is why cleaning needs `sudo` too.

Keep `auto/` and your own files under `config/` in version control and ignore everything generated. A `.gitignore` for the working directory:

```text
/.build/
/cache/
/chroot/
/binary/
/build.log
/chroot.*
/binary.*
/*.iso
/*.contents
/*.files
/*.packages
/*.zsync
/config/binary
/config/bootstrap
/config/chroot
/config/common
/config/source
```

With that in place, the repository contains only what a person wrote, and a build on a clean machine is a clone followed by `lb config && sudo lb build`. The same commands run unattended in a continuous integration job, provided the job has root and enough disk space.

One caveat about repeatability: package versions come from the mirror at build time, so two builds on different days can differ. If you need identical output, build against a fixed snapshot of the archive instead of the live mirror.

## Common mistakes and troubleshooting

- **Wrong file suffix.** A package list named `base.list` or a hook named `setup.sh` is ignored without any warning. Lists end in `.list.chroot`; hooks end in `.hook.chroot` or `.hook.binary`.
- **Editing generated files.** Changes to `config/common` or `config/binary` are overwritten the next time `lb config` runs. Put options in `auto/config`.
- **Not cleaning after changes.** live-build records which steps have finished and skips them. If a package you added is not in the image, run `sudo lb clean` and build again.
- **A package cannot be found.** Check the spelling, that the package exists in the release you chose, and that its archive area is listed in `--archive-areas`. Search with `apt-cache policy name` on a system running the same release.
- **Hook fails the build.** Read the end of `build.log`; the failing command is shown just before the error. To investigate interactively, enter the half-built system with `sudo chroot chroot /bin/bash`.
- **Build fails with permission or device errors.** The working directory is on a filesystem mounted `nodev` or `noexec`, or on a shared folder. Move it to a local disk.
- **Building inside a container.** The build needs to mount filesystems and create device nodes, which an unprivileged container cannot do. Use a virtual machine or a privileged container you trust.
- **Image boots in one firmware mode only.** Test both legacy BIOS and UEFI boot in your virtual machine before distributing an image, since they use different bootloaders.
- **Secrets baked into the image.** Anything under `config/includes.chroot/` can be read by whoever has the ISO. Do not include private keys, passwords or tokens; provision those after installation.

## Frequently asked questions

### Can I build an Ubuntu ISO this way?

Not with these instructions. Ubuntu maintains its own fork of live-build with different options and builds its images through separate tooling. The configuration layout described here matches the Debian package.

### What is the difference between a live image and an installer image?

A live image boots straight into a working system that runs from the medium and forgets changes at shutdown. An installer image exists to put Debian on a disk. Adding `--debian-installer live` gives you both in one ISO: boot the live system, or choose the installer entry to copy it to disk.

### How do I make the image smaller?

Start from a short package list, set `--apt-recommends false`, avoid desktop task packages unless you need them, and remove caches in a hook. Check which packages take the space with `dpkg-query -Wf '${Installed-Size}\t${Package}\n' | sort -n | tail` inside the booted image.

### Do changes made in the live session persist?

Not by default; the writable layer lives in memory. live-boot supports persistence through a separate partition or file labelled `persistence` and a `persistence` boot parameter, described in the live manual.

### Where is the full documentation?

The [Debian Live manual](https://live-team.pages.debian.net/live-manual/html/live-manual/index.en.html) covers every directory under `config/`, and `man lb_config` on the build host lists every option for the installed version.

Once the installed system is running, harden it with the [Linux server hardening checklist](/blog/linux-server-hardening-checklist/), and if the image ships software of your own, run it as a proper service using the guide to [writing systemd services](/blog/systemd-service-units-guide/).
