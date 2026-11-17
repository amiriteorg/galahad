# The Mac app

**One app that is both the client and a node.** On any Mac it is Galahad's client, as the iPhone and iPad app is. On a Mac that should serve (a Mac mini on a shelf), the same app makes the Mac a node: the node Ultra runs, carried inside the app, kept running through restarts and power cuts, with its knights' VMs on the Mac's own silicon. Setting one up is opening the app and answering three questions, with no Terminal.

Status: designed (16 November 2026); its first phase, the client, built the same day (*M1, built*, below), and its second, the node inside, the same evening (*M2, built*, below); its third, knights' VMs, begun on 17 November: the `container` driver, built against a stand-in (*M3, the driver*, below), its first real run waiting for the Mac mini: [PLAN](PLAN.md) #25. It is for **macOS 27** (the owner's word, 16 November), which runs on Apple silicon alone: Apple made macOS 26 the last release for Intel Macs ([MacRumors](https://www.macrumors.com/2026/04/18/macos-27-compatibility-change/)). So every Mac it runs on can give its knights VMs of their own, and nothing below has an Intel path. What follows is the design, the facts it rests on (each with where it was read) and what is still unknown, with the spike that answers it.

## What it must do

- **Make a Mac mini a node in minutes.** Download, open, choose *Start a fleet* or *Join my fleet*, and it runs from then on: at login, through sleep, after a power cut, with its knights' VMs and its local models.
- **Be your client on a Mac.** Chat, the Roundtable, the Inbox and the rest, laid out as the iPad app lays them out, with what a Mac adds: windows, menus, keyboard shortcuts and the menu bar.
- **Be the same Galahad.** The node is the same code at the same revision as on Linux. The client shares the iPhone app's Swift core and is held to the PWA by the same parity vectors. Nothing that can be shared is written again for the Mac.
- **Leave as cleanly as it came.** *Stop being a node* unregisters its service and asks whether to keep `~/.galahad`; removing the app removes the rest.

## Your Mac mini

The first one is the owner's: a Mac mini with an M5 Pro, 48 GB of memory and a 1 TB disk, on its way (16 November). Until it comes, the owner's MacBook (36 GB, 1 TB) is where the client is built and tried; it is a laptop and isn't made a node. The Mac mini's threads and speed aren't assumed: the node measures them when it starts, as it measured Ultra, and the census shows them. What it can carry follows from the rest:

- **Memory is shared three ways.** macOS, the knights' VMs and a local model all come out of the same 48 GB. The node's ceiling is half the machine unless you set another (`DEFAULT_SHARE` in `packages/core/src/compute.ts`), so 24 GB for its sandboxes: about four knights at work at once, at 4 GB each as on Ultra plus each VM's own overhead (Kata's is a thread and 2 GB; the spike measures Apple's). That leaves about 16 GB for a local model once macOS has its share: a 4-bit model of 20 to 24 billion parameters, with room for its context. Fewer VMs and a bigger model, or the reverse, is your split: *This Mac* shows it as one bar and sets the node's ceiling from it.
- **The governor sees the model's memory** as memory not free: before it admits a VM, it checks the machine itself has room. On a Mac it had read that wrong, counting only the pages no cache holds (`os.freemem()`, 5.7 GB on a 36 GB Mac whose memory pressure said 48% free), so VMs waited for memory that was there. It now reads what macOS's memory pressure reads (`kern.memorystatus_level`), as it reads Linux's MemAvailable.
- **Its disk:** 1 TB holds the knights' VMs (20 GB each, as on Ultra), the images (a few GB) and several local models (10 to 40 GB each), with room to spare. *This Mac* says what each takes.
- **Always on:** it has no battery, and it logs in by itself after a restart or a power cut (FileVault off, the owner's choice).
- **Beside Ultra:** Ultra stays the fleet's big body (Linux, Kata, VMs that grow live). The Mac mini adds knights' VMs on Apple silicon and local models on its unified memory, and placement chooses between them for each task from the census.

## The parts

### 1. The client: the iPhone app's code, built for the Mac

A native macOS target in `apps/apple` (macOS 27), beside the iOS one and from the same sources. The app is about 9,300 lines of Swift, and little of it is iOS-only: six files import UIKit, about 80 lines use modifiers the Mac doesn't have (keyboard types, text autocapitalization, navigation bar title modes, top-bar placements), and three views wrap UIKit (the terminal's screen, an answer's page frame, the window's tint). Each of those three needs its AppKit counterpart; the modifiers go behind small helpers that do nothing on the Mac. The iPad's layout, a sidebar beside a detail, is the Mac's.

Mac Catalyst is not used: the node manager has to register a launchd service, read the Mac's power settings and watch the node's process, which a native target does plainly.

What the Mac adds:

- **Windows.** A chat or a knight opens in a window of its own, and each comes back where it was.
- **Menus and shortcuts.** ⌘N a new chat, ⌘K give a task, ⌘1 to ⌘4 the four places, ⌘, Settings.
- **The Roundtable in the menu bar.** The knights in your order, each face in its status ring (working, waiting for you, failed, paused, resting) with what it is doing, what needs you, and the node in a line. It is [PLAN](PLAN.md) #24's "status at a glance" where a Mac shows it best.

**How it reaches a node:** as the iPhone does, paired, with a device key in the Keychain and every request signed. On the Mac that is the node, the app pairs with its own node on first run, approved with the node's local admin credential (`~/.galahad/admin.token`, readable by your account alone): it is the same account on the same machine, so there is no code to compare. Every client keeps one way in.

### 2. The node inside the app

The release tree with its dependencies, and Bun at the pinned version, inside the bundle:

```
Galahad.app/Contents/
  MacOS/Galahad                                the app: the client and the node's manager
  Helpers/bun                                  Bun at the pin in scripts/bun-pin.sh, checksum-verified when built
  Resources/node/                              the release as install.sh lays it out: packages/, apps/web, node_modules
  Library/LaunchAgents/sh.galahad.node.plist   the service
```

- **A launchd agent the app registers** with `SMAppService.agent(plistName:)`, under the label install.sh already uses (`sh.galahad.node`), so a node install.sh made is taken over rather than doubled. macOS may ask you to allow it in System Settings → General → Login Items; the app says so and opens that pane ([SMAppService](https://developer.apple.com/documentation/servicemanagement/smappservice)).
- **Its home stays `~/.galahad`.** The node keeps its identity, mind and vault there as on Linux, and the CLI and the app share it. The app offers to put `galahad` on your PATH (a script in `~/.local/bin` that runs the bundled node's CLI), so Terminal and SSH work as they do on Ultra.
- **Signed with a Developer ID and notarized, as one.** Every executable inside (Bun, and any native module in `node_modules`) is signed with the hardened runtime. Bun's guide lists the entitlements a signed Bun may need: `allow-jit`, `allow-unsigned-executable-memory`, `disable-executable-page-protection`, `allow-dyld-environment-variables` and `disable-library-validation` ([Bun](https://bun.com/docs/guides/runtime/codesign-macos-executable)). The spike keeps only those it shows are needed, `allow-jit` first.
- **Not one compiled file yet** (`bun build --compile`). The node reads files as it runs: the PWA it bundles at start, the sandbox images' Dockerfiles, its assets. Each would have to be embedded. That is worth doing later if it makes the app smaller or start faster, and only once it is measured.
- **Updated with the app.** A new app is a new release, and the node restarts on it as a planned restart: work it cuts off is taken up again once its commands have ended, and a reply that had already acted waits for you.

### 3. A Mac that stays on

A node is only useful while it is up. The node counted every Mac as a personal machine that sleeps and travels, and guessed a Mac's battery from its host name. Now a Mac's battery is read from the Mac (`pmset -g batt`), and `galahad awake on` keeps the Mac from sleeping while its node runs (`packages/node/src/keep-awake.ts`: `caffeinate -s -w <the node's pid>`, so off mains power, or once the node stops, it lets go). A Mac with no battery that its node keeps awake reports `awake` and counts as always on (`isAlwaysOn`), as a Linux server does; a laptop never does. The app makes "stays on" true, and then the node says so:

| | How | What it needs |
|---|---|---|
| Runs when you're not there | The launchd agent, started at login | Your approval in Login Items, once |
| Comes back after a restart | Automatic login for the account it runs under, with FileVault off (the owner's choice, 16 November: the Mac mini stays unlocked, so its disk isn't encrypted at rest). The other way, FileVault on and the disk unlocked over SSH after each restart (macOS 26 and later on Apple silicon, Remote Login on, Ethernet safest), stays documented for a Mac that needs it ([Apple](https://support.apple.com/guide/security/sec8447f5049/web)) | Automatic login turned on in System Settings → Users & Groups, once |
| Doesn't sleep | `galahad awake on`: the node holds a power assertion while it runs (`caffeinate -s`); the display may sleep | Nothing |
| Starts after a power cut | System Settings → Energy → *Start up automatically after a power failure* | You, once. The app shows the setting and reads it back (`pmset -g`); it never changes it for you |
| Reachable from anywhere | Tailscale, then `galahad expose`, as install.sh does | Tailscale signed in |

Each row is a line of the app's *This Mac* pane, its state read live: a tick, or what is missing. With all of them true and no battery (read from the Mac's own power sources, not the host name), the node reports itself always on, and placement treats the Mac as a server.

### 4. Knights' VMs on the Mac

Apple's `container` (1.0 in June 2026; Apple silicon, macOS 26 or later; Apache-2.0) runs each Linux container in a lightweight VM of its own ([apple/container](https://github.com/apple/container)). On a Mac it keeps the promise Kata keeps on Ultra, a VM for each knight, natively and with no Docker Desktop.

The node's sandbox host spoke Docker's command line alone (`packages/sandbox/src/host.ts`: the `docker` binary, or a `DockerRunner` in tests). A second driver speaks `container`'s ([its command reference at 1.7.1](https://github.com/apple/container/blob/1.7.1/docs/command-reference.md)), built on 17 November (*M3, the driver*, below):

| The node | Docker (Ultra) | `container` (a Mac) |
|---|---|---|
| Makes a sandbox | `docker run -d --cpus --memory --label --network …` | `container run -d --cpus --memory --label --network …`, each of Docker's flags as the table in *M3, the driver* says |
| Runs a command | `docker exec` | `container exec -i -u 1000:1000 -w /work` |
| Opens a terminal | `docker exec --tty` under a pseudo-terminal | `container exec -i -t -u 1000:1000` under a pseudo-terminal |
| Lists and reads | `docker ps`, `docker inspect` | `container list --all --format json` (labels, state, resources), `container inspect` |
| Stops, starts, removes | `docker stop`, `start`, `rm` | `container stop --time 10`, `start`, `delete --force` |
| Its `/work` | the root helper's ext4 image, or a Docker volume | `container volume create -s 20G`: a volume of its own, of a fixed size, with no root helper |
| Reads its use | `docker stats` | `container stats --format json --no-stream` (read, and shown nowhere yet) |
| Builds its images | `docker build` | `container build --pull --platform linux/arm64` |
| Copies its work out | `docker cp <id>:/work/out -` | the VM's own `tar` through `container exec` (container's `cp` names no stream), into the same parser that treats it as hostile |
| Grows a knight's VM | `docker update` (Kata adds cores and memory live) | Not while it runs: it stops, is made again with more on the same volume, and starts (the knight's VM pauses, and what ran in it stops), and every surface says so. Its disk keeps the size it was made with |

**Networks.** *Online* is a NAT network of Galahad's own, `galahad-net` on Ultra's subnet (172.31.249.0/24). *Gateway* (only the node's gateway, on the host) is a network made with `--internal`, which reaches the host alone. *Isolated* (no network at all) has no plain equivalent: the reference names no network like Docker's `none`. Until the spike finds one that holds, an isolated quest isn't placed on a Mac: it goes to a node that can isolate it, or it is refused with the reason. It never runs with less isolation than it asked for.

Built so (17 November), and run on the Mac mini: online is `--network galahad-net --network galahad-gw`, egress first, as an online sandbox on Ultra joins both of its networks; gateway is `galahad-gw` alone (made with `--internal --subnet 172.31.250.0/24`, so the gateway's address is Ultra's 172.31.250.1), with `--no-dns`, since it reaches the gateway by its address; isolated is refused on a Mac, and placement sends it elsewhere. Every VM boots without IPv6 (`--kernel-arg ipv6.disable=1`): Docker's networks are IPv4 alone, and on a Mac IPv6 reached the host's SSH and the sandbox beside it by their link-local addresses. On container's networks alone, two of Ultra's promises didn't hold, and the VM boundary doesn't change that: sandboxes on one network reached each other (container has no counterpart to Docker's `enable_icc=false`), and a gateway sandbox reached whatever the Mac serves, its SSH among them, where Ultra's galahad-firewall lets one port through. **The Mac's sandbox firewall** closes both, and more: see [M3](#m3-the-driver-17-november). No sandbox is made on a Mac while it is off.

On macOS 27 `container` always runs (it needs macOS 26 and Apple silicon), so the app has no Docker path of its own. `container` isn't part of macOS: it is Apple's signed installer package, from its releases on GitHub. `galahad sandbox setup` (the app's *Set Up*) fetches it at the release the driver was checked against, checks it against the SHA-256 pinned for it (Apple's signed and notarized installer, as pkgutil reads it), and installs it, asking for your password once, with the sandbox firewall. A Mac made a node by install.sh on an older macOS keeps Docker Desktop, OrbStack or Colima as today: containers in one shared VM, which the node already tells apart from microVMs (`isolation: "container"`).

**Its images.** The workshop image builds for Apple silicon since 17 November: it fetched x86-64 binaries whatever it was built for, so a Mac's image would have held an OpenCode and an Engram that can't run there; now each is fetched for the platform BuildKit names (`TARGETARCH`), and checked against that platform's SHA-256, the digest GitHub records for the asset (its x86-64 digests are the pins reviewed before, to the byte). Debian, Bun's installer and the tools from apt are arm64 already. Not yet built for arm64, and so refused on a Mac until they are (placement sends them to Linux): the desktop image (Computer Use), made from the workshop with Debian's Xvfb, openbox, Chromium, xdotool and scrot, which Debian builds for arm64, so it needs the workshop's arm64 build first, then a run of `desktop` (its screenshot, its clicks, Chromium under the read-only root) in a VM on the Mac mini, with the 4 GB a browser takes as on Ultra; the Lab, whose Debian stacks are built for arm64 but whose pinned wheels may not be (OpenSees' among them); and Gazebo, whose image pins Open Robotics' amd64 packages and an x86_64 library path.

### 5. Local models

Apple silicon's unified memory runs large local models well. The node already finds Ollama (port 11434) and llama.cpp (9931) where they listen by default; an MLX preset (`mlx_lm.server`, which is OpenAI-compatible) joins them. The app shows what each serves, measured by `galahad roster check` like any other model, and claims nothing it hasn't measured.

### 6. Shipping it

- **From galahad.sh, not the Mac App Store.** A node is a server: it listens on the network, runs VMs and terminals, and keeps working with its window closed, which the App Store's sandbox doesn't allow. So it is a Developer ID-signed, notarized disk image, linked from galahad.sh beside the one-line install. TestFlight is for App Store apps only, so test builds go to a beta channel on galahad.sh instead.
- **Updates:** Sparkle 2 (the owner's choice), from an EdDSA-signed feed on galahad.sh, which is how Mac apps outside the store update. Its signing key is one more secret of the owner's, kept in the Keychain and never in the repository.
- **Its name:** *Galahad*, with the iPhone app's icon, as `org.amirite.galahad.mac` (the owner's choice).
- **Notifications:** a Developer ID app can carry the push capability through a Developer ID provisioning profile (on macOS the entitlement is `com.apple.developer.aps-environment`). The node's Apple push sender already serves the iPhone app.

## The screens

**First run, on a Mac with no node: one window, three steps.**

1. *Make this Mac a node.* Its name (the host name), then *Start a fleet* or *Join my fleet*: an invite from `galahad invite` on another node, approved there once the codes match. Or *Just the app*: the client alone, paired with a node elsewhere.
2. *Keep it on.* The table above as a checklist, each line live. A Mac with a battery skips this step: it works while it's open.
3. *Give its knights VMs.* What they need, a line each, as the Mac has it: Apple's `container`, the sandbox firewall, its service and kernel, the node hosting VMs, the sandbox image, and a VM made to be sure. *Set Up* gives what is missing, each line said as it goes, and asks for your password once, in macOS's own prompt. *Not now* is fine: "Knights work on your other nodes until then."

Then it shows the code to pair your iPhone, as install.sh does, and offers Tailscale.

**The window.** The iPad's sidebar and detail. In the sidebar: Galahad's chat, the Roundtable (the knights in your order, each in its ring, then the rooms), the Inbox and More, with *This Mac* at its foot.

**This Mac.** The node (running, its revision, up since when), its knights' VMs (each one's threads and memory, and its state), staying on (the checklist), its models, its log, the doctor and the update.

**The menu bar.** The Roundtable's icon, marked when something needs you. Opened, it shows the knights in your order with their faces, rings and what each is doing, what needs you, and the node in a line.

## Phases

| | What | Done when |
|---|---|---|
| M0 | This design, and a spike that answers its unknowns | The node runs from a signed, notarized bundle under `SMAppService`. A knight's VM is made, worked in, given a terminal and removed through `container`, and its start is timed beside Kata's on Ultra. An isolated network that holds is found, or the reason there isn't one |
| M1 | The client on the Mac | It pairs with any node and does everything the iPad app does, with the Mac's windows, menus and shortcuts; the vectors pass on both |
| M2 | The node inside | First run (start, join, or just the app), *This Mac*, the CLI on PATH and staying on; signed, notarized and on galahad.sh |
| M3 | Knights' VMs and models on the Mac | The `container` driver in the node, placement that knows a Mac's VMs don't grow live, the MLX preset, the Roundtable in the menu bar, and updates. The driver and placement built against a stand-in, 17 November (*M3, the driver*, below); their first real run is the Mac mini's |

## The spike, 16 November

The first half of M0, run in a macOS 27.2 VM on the owner's MacBook (Tart, Cirrus Labs' plain macOS 27 image, which logs in by itself). The spike's app is a launcher of 60 lines of Swift, the pinned Bun (1.4.4, checksum-verified), the node at `origin/main` with its dependencies, and the agent's plist, every Mach-O signed ad hoc with the hardened runtime: 207 MB.

What held:

- **Bun under the hardened runtime needs only `allow-jit`:** the CLI and the node's `serve` ran on it for minutes, measuring the machine and answering requests.
- **The app registers the node's agent itself.** `SMAppService.agent(plistName:)`, called from the app's own binary, gave `enabled` with no prompt. Before it is registered the status reads `notFound`, not `notRegistered`, so the app treats the two alike.
- **launchd runs the app's binary,** which turns into Bun running the node (`exec`): one process, which launchd keeps alive, with its log in `~/.galahad/logs`.
- **A restart brings it back untouched.** The VM restarted, logged in by itself, and the node answered again 17 seconds after the restart was asked for. That is the owner's choice for the Mac mini, and it works.
- **Leaving is clean.** Unregistered, launchd no longer knows the agent, no process is left, the port is closed, and nothing was written to `~/Library/LaunchAgents`: the plist stays inside the app.
- **A fresh node there** found its fleet, its vault and its loop, and the doctor's complaints were only a fresh node's: no models without keys, no sandboxes, no backup yet.

What it found, now part of the design:

- **`init` must run in your session.** Over SSH, `init` fell back to the file keystore, because the login keychain isn't reachable from there; the app runs it as itself, in your session, so the keys go to the Keychain.
- **A flat `node_modules`.** Bun links its dependencies with thousands of symbolic links, which the VM's shared folder couldn't copy (a tar stream did). The app is built with Bun's hoisted layout and without development dependencies; the one native binary in them was TypeScript's compiler, which the node never runs.

Signed, notarized and judged by Gatekeeper (the same evening, once the owner had the Developer ID certificate from the team's Account Holder, as a `.p12` in their keychain):

- **Built as the app will be:** only what the node runs, laid out flat (`bun install --production --linker hoisted`): 164 MB, no native binary among the dependencies, nine symbolic links all inside the bundle; a 60 MB zip.
- **Signed with the Developer ID,** every executable with the hardened runtime and Apple's secure timestamp; Bun with `allow-jit` alone.
- **Notarized:** Apple's notary service accepted it, and its ticket is stapled to the app. The notary's credentials are a profile in the owner's login keychain (`xcrun notarytool store-credentials galahad-notary`), so a release needs no cards.
- **Gatekeeper on a stock macOS 27.2** (the MacBook) accepts it as a quarantined download: `source=Notarized Developer ID`. Apple's own pre-distribution check (`syspolicy_check distribution`) passes, there and in the VM.
- **Not the VM for this:** the prepared image's Gatekeeper, switched back on, rejects every Developer ID app, notarized or not (a notarized app of another developer's, UTM, too), and macOS 27 lets it be switched off again only in System Settings. Gatekeeper is judged on a stock Mac; the VM was made again from its image.
- **What the app does about it:** a downloaded app opened from Downloads runs from a read-only copy macOS makes for it (App Translocation), so the first run asks to be moved to Applications before it registers the node; and the first open asks "downloaded from the Internet, open it?", as for any app.

Not tried yet:

- **`container`:** it can't run inside a macOS VM; it waits for the Mac mini.
- **The client's windows and the menu bar:** built with M1 (below).

## M1, built (16 November)

`GalahadMac`, beside the iOS target in `apps/apple/project.yml`: a native macOS 27 app from the iPhone app's own sources. What one platform alone has is marked `#if os(iOS)` or `#if os(macOS)`; what differs in small ways goes through `UI/Platform.swift`, whose helpers are, on iOS, exactly the modifier or call they stand for. The iPhone's Roundtable is what it was: the build before and the build after, pictured against one node a minute apart, differ in 147 of 2.9 million pixels (a working ring turning, a blink).

- **The window:** the iPad's sidebar and detail. The sidebar is the Roundtable as the PWA's wide screen has it: its mark, which opens the board; the one who leads, then the knights in your order (dragged into another, as a Mac's lists are), each face in its ring with its state in a word; the rooms; then the Inbox (its count in red) and More. A timeline's title and line are the window's title and subtitle; a conversation keeps to a reading width; a page of rows is the Mac's grouped form.
- **Windows of their own:** a knight, a room or one of Galahad's chats opens in a window of its own (a double click, or Open in New Window), and macOS brings each back where it was.
- **Menus:** ⌘N a new chat (its message box takes the keys), ⌘K a task for the Roundtable, ⌘1 to ⌘4 Galahad, the Roundtable, the Inbox and More, and ⌘, Settings: this Mac and its node, Keys and Connectors.
- **The menu bar:** the Roundtable's mark, with how many things need you beside it; opened, every seat in your order with its face, ring, chip and line, what needs you (it opens the Inbox), the node in a line, and Open Galahad. The app asks the node every 5 s in front and every 15 behind, with its windows open or not.
- **Pairing:** paste the invite, or open a `galahad:` link carrying one (`galahad:https://keep.example.ts.net/#pair=gi1.…`, or the invite alone); then the codes are compared, as on the iPhone.
- **The key** is made in the Secure Enclave, as the iPhone's is, but held otherwise: the Keychain an iPhone keeps enclave keys in opens on a Mac only to an app signed with a profile, which a build signed to run on its own Mac isn't (measured: `errSecMissingEntitlement`, -34018). So the Mac's key is CryptoKit's, and the login keychain keeps only the enclave's wrapping of it, which is no key and opens in no other Mac's enclave.
- **Tests:** `GalahadMacTests` runs the shared tests on macOS (the vectors, the roster, seats, the key, pairing and the rest), and `MacShots` pictures the app's own windows against a dev node when asked (`apps/apple/README.md`).

Left for M2, which signs the app with its Developer ID and a profile: notifications (Apple's push service needs the profile), copies of keys kept on the Mac (the Keychain that asks for Touch ID first needs it too), and the data protection keychain for the key. Until then each local build is, to the login keychain, a new app: it is expected (not tried here) to ask once before a new build uses a key an older one made. (M2 measured it: it does, below.)

## M2, built (16 November)

The node inside the app, on the branch `t3/mac-app-node`; tried in a clean macOS 27.2 VM (Tart's `galahad-mac27`, cloned for each run), pictured on the owner's MacBook, which was never made a node.

- **The bundle** is made by `apps/apple/scripts/mac-node-bundle.sh` from a built app: Bun at the pin (`install_bun`, checksum-verified) in `Contents/Helpers`, the repository at HEAD (`git archive`, with its `REVISION`) and `bun install --frozen-lockfile --production --linker hoisted` in `Contents/Resources/node`, and the agent's plist in `Contents/Library/LaunchAgents`. It is a release step, not a build phase: it makes the app 165 MB bigger (19 to 184 MB) and takes 8 s with Bun's cache warm, needs the network every time, reads the whole repository (which the build's script sandbox forbids) and carries HEAD rather than the tree being edited. A build without it is the client alone, and says so.
- **Signing.** With `GALAHAD_MAC_SIGN=developer-id`, every Mach-O, the deepest first (Bun with `allow-jit` alone and a fixed identifier, Sparkle's XPC services, Autoupdate and Updater.app, the framework, the app), is signed with the Developer ID, the hardened runtime and Apple's timestamp. Signed ad hoc, only Bun is hardened: ad hoc code has no team, so library validation refused the hardened app its own frameworks (measured: Sparkle's, and a Debug build's dylib, "have different Team IDs"). A Release build of the Mac target carries no `get-task-allow` (Xcode added it even there; notarization refuses it).
- **Notarized:** the Developer ID bundle, Sparkle and all, was accepted by Apple's notary service (a 64 MB zip, under two minutes) and its ticket stapled; Gatekeeper on the MacBook accepts it, as a quarantined download too (`source=Notarized Developer ID`), and `syspolicy_check distribution` passes.
- **The launcher:** the app's binary with `--serve-node` becomes Bun on the bundled node (its output in `~/.galahad/logs/node.log`, its PATH install.sh's, Homebrew's first); `--cli` is the bundled CLI. What a terminal asks, or a Mac with no screen to click, runs with no window through the buttons' own code: `--agent [status|register|unregister|restart]`, `--first-run start|join`, and `--this-mac` (what This Mac shows).
- **First run,** on a Mac with no `~/.galahad` and an app not paired: one window, the three steps down its side. *Make this Mac a node:* its name (the short host name, as install.sh takes it), then *Start a fleet* (`galahad init`), *Join my fleet* (`galahad join`, its code shown to compare, approved on the inviting node) or *Just the app*; each run as the app, in your session, so the keys go to the Keychain. It is refused, saying why, while the app isn't in an Applications folder (translocated, on a disk image or elsewhere) and in a build without the node. Then the agent is registered (Login Items' button while macOS asks), the node answers, and the app pairs with it: a client invite and its approval made with `~/.galahad/admin.token` on loopback, read only while it is this account's alone (0600); the node's code must still be the app's own and its approval's proof is checked, as for any device. *Keep it on:* the node keeps the Mac awake (`galahad awake on`, then a restart), and the checklist, live; a Mac with a battery skips it. *Give its knights VMs:* Apple's `container` found or not, and said plainly that this release makes none yet (M3; since 17 November it sets a Mac up: *Setting a Mac up*, below).
- **This Mac,** in Settings and at the sidebar's foot: the node (running, revision, up since), staying on, `galahad` on your PATH (two lines in `~/.local/bin`, never written over another's unasked: install.sh's is said to be there and kept), the log's tail and the doctor. Each line of staying on is read live: the agent (SMAppService), automatic login (`autoLoginUser` in `/Library/Preferences/com.apple.loginwindow`, with `fdesetup status`, a FileVault to be turned on at the next restart counting as on), keep-awake (the config, and the running node's `awake`), `pmset -g`'s `autorestart` (a virtual Mac and a laptop don't list it: "This Mac doesn't offer it"), and Tailscale's status and `serve` (where Galahad is published). Each has the button that opens the pane that changes it (Login Items, Users & Groups, FileVault, Energy) or asks the node (keep awake, restart, publish: `galahad expose`); the app never changes the system's settings itself. *Stop being a node* unregisters the agent and keeps `~/.galahad`. A node install.sh made keeps its own service: the app pairs with it and shows it, and registers no second one.
- **Updates:** Sparkle 2.10.1 (Swift Package Manager, an exact version three weeks old), "Check for Updates…" in the app menu and This Mac, `SUFeedURL` `https://galahad.sh/mac/appcast.xml`. `SUPublicEDKey` is the build setting `GALAHAD_SPARKLE_PUBLIC_KEY`: the owner's key, made 16 November 2026 with Sparkle's `generate_keys`, its private half in the owner's login keychain (account `galahad`) and never in the repository; a build without one makes no updater. The app checks once a day by itself (`SUEnableAutomaticChecks`), and never under test. A release is `apps/apple/scripts/mac-release.sh`: its zip goes up as the GitHub release `mac-<build>` (too big for the site), and the feed, signed by `sign_update`, is served from the site. After an update the node keeps running the release before; the app restarts it onto its own once, at its next launch.

What the VM showed, run through the app's own code (`--first-run`, `--agent`, `--this-mac`, and the app's window opened with no one at the screen):

- *Start a fleet* took 15 s from the app's start to a node of the fleet, its keys in the login keychain (`keystore: os`, no `keys.json`), its service enabled and run by launchd (Bun, its parent launchd), the app paired with it as *Galahad app on vm27* (in the fleet's list), and the Mac kept awake (`caffeinate` asserting for the node's pid). The admin credential is taken on loopback (200) and refused on the proxied port (401).
- A restart, asked for over SSH: the VM logged in by itself and the node answered 39 s after the restart was asked for, keeping the Mac awake again.
- Unregistered: launchd no longer has the service, no node or `caffeinate` runs, the port is closed, the power assertion is gone and nothing was written to `~/Library/LaunchAgents`; `~/.galahad` stays, as designed. Two records stay with the system: launchd's override for the label (`"sh.galahad.node" => enabled`) and Background Task Management's for the app's item (`disabled, allowed`), which run nothing.
- **An update signed ad hoc asks first.** A new ad hoc build put in its place, as Sparkle swaps it: the agent stayed enabled and the node ran on, but the app's window blocked at launch, reading its device key (`SecItemCopyMatching` waiting for SecurityAgent): to the login keychain it is another app. The node's own Bun was unaffected (signed ad hoc from the same pinned binary, its code hash didn't change).
- **An update signed with the Developer ID doesn't.** In a fresh clone, the notarized Developer ID build made the Mac a node (15 s again), then a newer Developer ID build was swapped in: no prompt, and the app, opened with no one at the screen, restarted the node onto the new release 4 s after it was put in place, its window and Sparkle loaded under the hardened runtime.
- *Join my fleet,* with a second node in the same VM inviting it: the app showed the code the inviting node showed, was approved only once the two matched, and 14 s after it started was a node of that fleet (the other node online beside it), paired and kept awake.

## M3, the driver (17 November)

The node hosts knights' VMs and quests' sandboxes on a Mac through Apple's `container`, as Ultra hosts them through Docker and Kata. It is built and tested against a stand-in for `container` (`packages/sandbox/test/fake-container.ts`) that answers as container's documentation says it does, at the 1.7.1 tag (`docs/command-reference.md`, and `networking.md`, `volumes.md`, `resource-usage.md`, `ulimits.md`, `runtime-configuration.md` and `container-inspection.md` beside it); every flag and output format it uses is there from 1.0.0 on. Then it was checked against the real one on the Mac mini (container 1.7.1, macOS 27.0, an M5 Pro with 48 GB), where it is installed alone, with the owner's word: the MacBook is never made a node. What the Mac mini said is below; what it found wrong is fixed.

- **The driver.** `engine: "container"` (`packages/sandbox/src/container.ts`, `container-volumes.ts`, `host.ts`): the same sandbox host as on Docker above it (scopes, leases, the workspace budget, labels, the ledger's lines, the oath gate, the reaper), container's command line under it. Each sandbox is a VM of its own; its `/work` is container's own volume, of a fixed size (`volume create -s`), a knight's made to be kept (a volume's labels are fixed as it is made, so it says so then).
- **Found on a Mac.** `container` on the PATH, then `container system version --format json`, whose API server row is there only while its service answers (the documentation's own sample). Running at 1.x, the node is a sandbox host whose capabilities say `engine: "container"`, `vm: true`, what it won't make (`cannot`) and `grows: false`, beside `container: { version, running }`. A Mac with container hosts through it, running or not, never through Docker one day and container the next; a Mac without it is as it was. The doctor says "Apple's container answers", and tells a Mac whose container isn't running to start it.
- **What a Mac refuses, and why**, each before anything is made (424), and placement sends the work to a host that can: an isolated sandbox (no network like `none`, and none of container's proven to isolate); the desktop image (not built for Apple silicon yet); the Lab (unproven there); Gazebo (its image is x86-64's alone); a bigger disk for a knight's VM (409: container fixes a volume's size as it makes it). A sandbox asked for as a container is given a VM: more, never less.
- **Growing, and making again.** container changes no container that exists and renames none. So a knight's VM grows by stopping, being made again with more on the same volume, and starting; and it is made again the same way. A new VM that won't start is cleared away and the old one made again as it was, and the error says so; the reaper never takes its volume meanwhile. The answer says `paused`, and the CLI, Galahad's `team_grow` and the PWA's *Give it more* say that it paused and what was running in it stopped (the form says so before, and offers no bigger disk). The knight itself isn't told in words: a command it was running fails as its VM stops, and it reads that failure.
- **The governor.** Every sandbox on a Mac is a VM, so each one's overhead counts against the ceiling (Kata's, a thread and 2 GB, until the Mac mini measures Apple's: check 19); its CPUs are whole, and counted so; what a Mac won't make is refused before it waits for a slot. The calibration's start-up and the doctor's start test measure a VM on the gateway network, the most a Mac cuts one off.
- **Placement.** A Mac with container meets sandbox work's needs and a knight's VM's, its reason "a VM of its own for each (Apple's container)"; work it can't make passes it by, however it ranks, and when no host can, the answer names each and why. A knight's own VM leans a little to a host whose VMs grow while they run (its reasons say "its VMs pause to grow" of a Mac); room still decides.
- **Its networks, held to Ultra's promises.** Two of Galahad's own, as on Docker: `galahad-gw` (host-only) and `galahad-net` (vmnet's NAT), each held up by a small VM of the node's own on it (1 CPU, 256 MB, hardened as a sandbox, doing nothing; never listed, counted or reaped as a sandbox). container gives the host its address on a network only while a VM is attached, and the gateway listens there; and a network whose last VM goes can lose its bridge to another network's as its next one comes, which silently cuts off both until container's networking restarts ([apple/container#2051](https://github.com/apple/container/issues/2051), open at 1.7.1; seen on the Mac mini). Held up, a bridge never goes; a keeper that has to come up on a network nothing runs on comes up just after that network's helper is restarted, and container's own `default` (its builder's) is restarted after them while nothing runs on it, so no bridge is ever shared. Every VM boots without IPv6.
- **The Mac's sandbox firewall** (`packages/sandbox/src/mac-firewall.ts`, `galahad firewall`), what galahad-firewall is on Ultra. A gateway sandbox reaches the gateway's one port and nothing else; an online one reaches its resolver and the internet, never the Mac, your network or your tailnet (stricter than Ultra, whose online sandboxes reach past their host); no sandbox reaches another. Two things give it, both root's: pf rules in an anchor under `com.apple/` (macOS's own `pf.conf` evaluates every anchor there, and pf is on while vmnet's networks are), and each Galahad bridge's member filter, without which pf never sees what passes between a bridge's VMs (`BRDGSFILT` with `IFBF_FILT_MEMBER`, from XNU's `if_bridge.c`; no `ifconfig` option sets it, and macOS's `ifconfig` has no `private`). A perl script of root's in `/Library/PrivilegedHelperTools` (perl is macOS's own, so nothing is compiled or fetched; the rules are inside it, and it reads nothing anyone else can write) does both, run by launchd every ten seconds (`sh.galahad.firewall`), and writes what it did to `/var/run`. `galahad firewall install` (or `galahad sandbox setup`, with the rest a Mac needs) puts it there once, asking for your password, and refuses a place that isn't root's alone. The node reads that status (root's alone, at most 30 s old) and each bridge's filter for itself (reading needs no root), and makes no sandbox on a Mac while either says it is off: the API answers 424 with why, a knight's VM isn't resumed, the doctor says so and how, and a bridge just brought up is waited for, up to two of the helper's runs. Each way out of both kinds of sandbox was tried there, open without it and shut with it (below).
- **Setting a Mac up** (`galahad sandbox setup`, `packages/node/src/sandbox-setup.ts`: the app's step 3 and This Mac run it, and so can you in Terminal). Six steps, each said as it goes, in words or (`--json`, which the app reads) a line of JSON each: Apple's `container` (when there is none, its signed installer at 1.7.1, fetched from GitHub and checked against the SHA-256 pinned for it, `CONTAINER_RELEASE`); the sandbox firewall, this release's (another release's, or one installed and off, is installed again); container's service and its kernel (`container system start --enable-kernel-install`: container fetches its recommended kernel and checks its digest); the node, restarted through launchd (`sh.galahad.node`) when it started before container did; the sandbox image, built by the node; and a VM made on the gateway network through the firewall, a command run in it, and the VM removed. What holds is left as it is, so it can be run again at any time, and `status` changes nothing. Only the first two are root's, asked for once, together (`as-root.ts`): by sudo on a terminal, by macOS's own prompt where there is none (the app), so the password goes to macOS, never to Galahad. Root copies the installer into a folder of root's and checks it there again before installing it, so nothing can be put in its place after your check. On the Mac mini, made fresh (container uninstalled with its data by Apple's own script, the firewall removed, a node of launchd's running without them): 67 s from nothing to a VM proved through the firewall, the installer (170 MB), the kernel and the image's build included; run again, it changed nothing and made its proof's VM in 4 s. The doctor now says when container has no kernel, and sends a Mac's fixes to setup. The run found one more thing: at each start a Mac node logged its usual wait for the gateway's address in words the doctor counts as trouble, for an hour; it now says it waits, and only a minute of waiting reads as trouble. And container's builder, a VM of 2 CPUs and 2 GB that a build starts, was left running after it, outside the governor's count: the node stops it once its build is done.
- **The PWA** lists a Mac with container as a sandbox host (it looked for Docker or KVM alone), says on the sandbox form that every sandbox there is a VM and that an isolated one goes to Linux, and the Fleet page shows *VMs (Apple's container)*.

Each of Docker's flags on a Mac (`DOCKER_ON_A_MAC` in `container.ts`, and a test fails if Docker's run or network commands gain a flag it doesn't account for):

| Docker's | On a Mac | Its promise there |
|---|---|---|
| `--detach`, `--name`, `--init`, `--workdir /work`, `--env HOME=/work`, `--label` | the same | holds |
| `--user 1000:1000` | the same, and on every exec and terminal | holds: exec's default user isn't documented, so it is never left to it |
| `--cap-drop ALL` | the same | holds |
| `--security-opt no-new-privileges:true` | none | held by the VM and the dropped capabilities: a setuid file in the image could make a process uid 0 inside, with none of root's powers, on a read-only root (check 6) |
| `--read-only` | the same | holds |
| `--tmpfs /tmp:rw,nosuid,nodev,size=2g,mode=1777` | `--tmpfs /tmp:size=2G,mode=1777` (its tmpfs takes size and mode alone) | holds: no device can be made there (CAP_MKNOD dropped), no file made setuid to root (CAP_CHOWN, CAP_FSETID) |
| `--mount …,dst=/work` | `--mount type=volume,source=galahad-sbx-<id>-work,target=/work` | holds: its own volume of a fixed size, the one thing of the host's it is given |
| `--cpus`, `--memory` | the same (CPUs whole) | holds |
| `--memory-swap` | none | held by the VM: it has its memory and no more (check 4) |
| `--pids-limit 1024` | `--ulimit nproc=1024:1024` | held by the VM: a fork bomb fills its own VM, never the Mac (check 23) |
| `--ulimit nofile=8192:8192` | the same | holds (check 23) |
| `--network none` | none | **refused**: no isolated sandbox on a Mac |
| `--network galahad-gw` | `--network galahad-gw --no-dns` | holds, with the Mac's firewall: the gateway's port, and nothing else |
| `--network galahad-net --network galahad-gw` | the same | holds, with the Mac's firewall: its resolver and the internet; stricter than Ultra (not your network or tailnet) |
| (Docker's networks are IPv4 alone) | `--kernel-arg ipv6.disable=1` | holds: the VM has no IPv6 at all |
| `--runtime io.containerd.kata.v2`, an online VM's resolv.conf | none | holds: every container is its own VM, and container writes its resolver |
| `--hostname knight` | none | moot: the VM is named after its container |
| `network create --internal --subnet 172.31.250.0/24` | the same | holds: host-only, no way out |
| `network create --subnet 172.31.249.0/24` (`galahad-net`) | the same | holds: vmnet's NAT, its resolver at 172.31.249.1 |
| `network create --gateway 172.31.250.1` | none | holds: vmnet gives the host the subnet's first address, while a VM is attached (check 10) |
| `-o com.docker.network.bridge.enable_icc=false` | the Mac's firewall: each bridge's member filter, and its rules | holds: no sandbox reaches another |

**What the Mac mini said** (17 November). Each assumption the driver rested on, run there by hand with `container` 1.7.1, its service started:

1. **The service.** Running, at 1.7.1: held.
2. **What a list says.** `.configuration.id`, `.labels`, `.resources.cpus` and `.memoryInBytes`, `.status.state`, the same from `inspect`: held. Each VM also has `cpuOverhead: 1`.
3. **Whole CPUs.** A VM shows one CPU more than it was given (`cpuOverhead`), and `--cpus 0.5` is refused: the driver gives whole ones.
4. **No swap.** Held.
5. **Exec's user and environment.** 1000, and the run's environment reaches every command: held.
6. **Capabilities.** CapEff and CapBnd all zeros; NoNewPrivs 0, which gives nothing with no capability to gain.
7. **Its root and /tmp.** Read-only root, `/tmp` 1777 and 2.0G: held.
8. **Its /work.** A new volume's root is root's, even under Galahad's image, so the knight couldn't write its own workspace. **Fixed:** a one-off container of the node's own hands it to uid 1000 as it is made (`containerVolumeOwnArgs`), or the workspace fails and the volume goes.
9. **A volume outlives its container.** Held.
10. **The gateway's address.** There only while a VM is attached to the network. **Fixed:** the networks' keepers hold it, and the node binds its gateway listener once it is there, trying every 5 s.
11. **The gateway network.** The gateway's port reached; no names, no internet by address; but the Mac's SSH answered too. **Fixed** by the firewall.
12. **Online.** The internet and names, its default route through its own network's gateway: held (on `galahad-net` now, as on `default` then).
13. **Sandboxes reach each other.** They did, on either network. **Fixed** by the firewall.
14. **The deadline.** 137 after 2 s: held.
15. **A terminal.** `galahad terminal <knight>` gives a login shell in its VM on a real terminal: uid 1000, `xterm-256color`, on `/dev/pts/0`, closed by `exit`: held (a resize not tried).
16. **Copying out.** A tar byte for byte the same (its digest): held.
17. **Stop, start, delete.** Held.
18. **The image.** Built for arm64; OpenCode 2.2.6, Engram 3.7.2, Bun 1.4.4, aarch64: held.
19. **A VM's own cost.** An idle 1 GB VM takes about 0.42 GB of the Mac: under the 2 GB the governor holds for it, as for Kata.
20. **Its start.** The node's calibration measured a VM ready in 8.3 s, beside Kata's 1.7 s on Ultra.
21. **Its use.** `container stats` as read: held.
22. **The node, end to end.** A node from a checkout, in a home of its own: the doctor's sandbox lines all ok, its own VM started through the firewall and removed; `sandbox run` made a VM on each network, each reaching what the firewall allows and nothing else, and no sandbox reached another on either network; an isolated one was refused, saying why; two knights' VMs made there, one grown by pausing (it said so), its `/work` kept, a smaller or bigger disk refused with the reason, and one made again gateway-only. Found: `roundtable provision <id> --network gateway` made an online VM, the CLI never having declared `--network` (fixed, on every platform, and a test now holds each option a command reads to a declaration).
23. **Limits on commands.** `ulimit -n` 8192 in a command: held (the image's `sh` has no `ulimit -u`).

And what no check had asked: **macOS updated itself** (27.0 to 27.2.1) and restarted the Mac mini mid-run; the firewall's helper was running again at boot, but **container's service doesn't start by itself at boot**, so the node now starts it as it starts (`container system start --disable-kernel-install`: it never installs a kernel), and the networks' keepers came back up with their helpers restarted. **IPv6** reached the Mac's SSH and the sandbox beside it by their link-local addresses, past rules for IPv4 (fixed: every VM boots without it); **two networks' bridges collided** after VMs came and went, cutting both off until container's networking restarted (apple/container#2051; fixed by the keepers and the helpers' restarts, red then green on the Mac mini); and pf never saw traffic between two VMs on one bridge, nor matched the Mac's own addresses through `(self)`, which is why the firewall sets each bridge's member filter and names what isn't the internet. Under the installed firewall, from sandboxes made as the driver makes them: the gateway sandbox reached the gateway and nothing else (not the Mac's SSH by any of its addresses, its LAN, its tailnet, another sandbox or the internet); the online one reached the gateway, its resolver and the internet and nothing else; neither had IPv6.

**Open, and next.**

- *Set Up* clicked in the app by a person: its password prompt (AppleScript's `do shell script … with administrator privileges`) is checked for how it hands over the script (run here without the privilege), and not yet answered on the Mac mini's screen; the same steps through sudo were.
- A firewall from another release is put right by `galahad sandbox setup`; the doctor doesn't say so yet.
- The knight told in words when its VM paused mid-task; today it reads the failure of the command that was running.
- Its disk grown: container has no way to grow a volume, so it would be a new, bigger volume and a copy.
- `container stats` is read, and shown nowhere yet: *This Mac*'s VMs can show it.
- The governor's VM overhead from check 19 (it holds more than a VM takes), and the desktop image, the Lab and Gazebo on arm64.
- Another tool's networks on the same Mac can still collide with Galahad's (apple/container#2051): the node keeps its own up, and container's default network clear, but can't keep a network it doesn't know of. A dedicated Mac mini has none.

## How it is told

Against the [mandate](MANDATE.md):

- **Time to a working node:** from download to a knight's first verified task on a clean Mac mini, with no Terminal. Target: under ten minutes, timed on a fresh macOS VM. Its VMs' part, timed on the Mac mini (17 November): 67 s, from no container to a VM proved through the firewall.
- **Capacity:** more knights at work at once across the fleet (the census), with no more interventions per completed task.
- **Cost:** local models on the Mac mini answer the swift role's chores, and paid calls fall by what they took (the usage page).
- **Reversibility:** *Stop being a node* leaves nothing running and nothing of it outside `~/.galahad`, checked by a test that lists launchd's services and the app's files before and after.

## Decided, and what is still needed

The owner's answers (16 November): the Mac mini logs in by itself with FileVault off; updates come through Sparkle; the app is *Galahad*, `org.amirite.galahad.mac`.

- **The Developer ID Application certificate** is in hand (16 November): the team's Account Holder made it (only they can, or an Admin given Apple's cloud-managed Developer ID role, and that cloud signing doesn't work with an App Store Connect API key, so a `.p12` it is), and the owner keeps it in the MacBook's login keychain. Releases are signed there and notarized with the profile above.
- **Where the spike runs.** The owner asked for a macOS VM on the MacBook. A VM serves the app's own install, its service and its first run on a clean macOS. It can't serve `container`: Apple's nested virtualization is for Linux guests (M3 and later, macOS 15 and later), not macOS guests, so `container` doesn't run inside a macOS VM ([Apple Developer Forums](https://developer.apple.com/forums/thread/827663)). That part runs on the MacBook itself, with the owner's yes, or on the Mac mini. A macOS 27 VM needs about 60 GB of disk (its restore image and its own disk); on 16 November the MacBook had under 4 GB free.
