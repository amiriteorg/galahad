# Getting started

This guide sets up the target layout: your **Windows laptop** plus one **beefy Linux server** on the same tailnet, with Docker and VMs. Both run a Galahad node and share one mind.

## 0. Prerequisites (both machines)

- **Tailscale**, logged in to the same tailnet.
- **MagicDNS and HTTPS certificates** enabled in the Tailscale admin console (DNS settings). `galahad expose` needs these.
- **Bun** ≥ 1.4:
  - Windows: `winget install Oven-sh.Bun`
  - Linux/macOS: `curl -fsSL https://bun.sh/install | bash`
- The repo:

```sh
git clone https://github.com/amiriteorg/galahad.git
cd galahad
bun install
bun run check        # typecheck + the full test suite
```

## 1. Found the fleet (laptop)

```powershell
bun galahad init --name laptop --fleet camelot
bun galahad serve
```

`init` does the following:

- Generates this device's keys and stores them in the **Windows Credential Manager** (via `Bun.secrets`).
- Founds the fleet and creates the first vault key.
- Writes `~/.galahad/` (config, `mind.db`, `local.db`, a local `admin.token`).

`serve` listens on `127.0.0.1:7777` and on the laptop's tailnet IP. It never binds `0.0.0.0`.

**Windows firewall:** allow inbound TCP 7777 from the tailnet only.

```powershell
New-NetFirewallRule -DisplayName "Galahad (tailnet)" -Direction Inbound -Protocol TCP -LocalPort 7777 -RemoteAddress 100.64.0.0/10 -Action Allow
```

## 2. Publish the PWA on your tailnet (laptop)

```powershell
bun galahad expose     # runs: tailscale serve --bg --https=443 http://127.0.0.1:7778 (use --https 8443 if 443 is taken)
```

The PWA is now at `https://<this-machine>.<your-tailnet>.ts.net/`, reachable only from your tailnet, over HTTPS with a real certificate.

> The PWA's build, serving, pairing protocol and signed API calls are tested, and it has paired and run in a real browser (headless Edge, November 2026). Please report anything that looks off.

## 3. Pair a phone or browser

```powershell
bun galahad invite --client
```

1. Point the new device's camera at the QR code the terminal prints (or open the printed link on it). It's single-use and valid for 10 minutes.
2. The device creates a non-extractable key and shows a **6-digit code**.
3. The terminal shows the same code. Answer `y` only if they match.

Run it on the node you'll talk to, wherever that is: on a server over SSH (`tailscale ssh you@server`, then `galahad invite --client`) it's the same. The link points at the address `tailscale serve` publishes the PWA on, port included (a server that keeps 443 for something else publishes it on another port, such as 8443); `--origin https://host:port` overrides it, and `--no-qr` leaves the code out. From a device that's already paired, **Fleet → Pair a device** shows the same QR code on its screen.

The device gets every scope except `gateway:mint`: it's your console, the bank, the vault and pairing included. For a device you trust less, pair it from the PWA (**Fleet → Pair a device**, then **Custom** or **Chat & read**) with fewer; an invite never carries a scope the inviting device lacks.

**On an Android phone**, install it from Chrome's menu (**Add to Home screen**, then **Install**). Galahad is then in the share sheet of every app: share a page, a post or some text to him and a new chat opens with it in the message box, unsent, for you to add what you want done with it. (iOS has no share sheet for a web app.)

### Let him reach you: notifications

Until you turn this on, everything he has for you waits in the Inbox. With it, a paired device gets a short notification when something needs you (a warning or an alert from his heartbeat), an approval is waiting, he has finished work you left him with, or he has a question. He stays silent when there's nothing to say.

**On an iPhone or iPad** (iOS 16.4 or later):

1. Open the app's address in Safari, tap **Share** (on iOS 26 it's in the **⋯** menu), then **Add to Home Screen** (under **More** if it isn't listed; leave **Open as Web App** on). iOS delivers notifications only to a web app on the Home Screen, never to a Safari tab.
2. Open **Galahad** from the Home Screen. If it asks to be paired, pair it as above (paste the invite): the Home Screen app is its own device.
3. **Settings → Notifications**, turn on **Notifications on this device**, and allow them when iOS asks. It asks only from that tap.
4. Tap **Send a test**. It should arrive within a few seconds.

Galahad's icon on the Home Screen then shows how many things wait for you: exactly, as of the last time the app was open, plus one for each new thing he has told you about since.

**In a desktop browser** (Edge, Chrome, Firefox, Safari): step 3 and 4 are the same; nothing needs installing.

Nothing is needed on the server: the node makes its own key the first time a device turns this on, and keeps it beside its device keys. From a terminal on the node:

```sh
bun galahad notify                         # the devices he can reach, what he tells you, quiet hours, what was sent today
bun galahad notify test                    # one test notification to every device (notify test phone: to one)
bun galahad notify quiet 22:00-07:00       # quiet hours, in the node's own time zone unless --tz says otherwise (notify quiet off)
bun galahad notify limit 12                # at most this many a day, the last two kept for alerts; one message says when it's reached
bun galahad notify off phone               # stop notifying a device (it's turned on again from that device)
```

What a notification holds is a short title, one line and where it opens, encrypted to that browser: the push service that carries it (Apple's for an iPhone) can't read it. Never a key, never anything about the bank, never a model's own words. Quiet hours (22:00 to 07:00 by default, in the node's own time zone until you set one: a server that keeps UTC reads them in UTC, so give yours with `--tz`) hold everything but an alert until morning, then one message says what waited. A turn you're watching on another device isn't pushed. If a test doesn't arrive, `bun galahad doctor` has a line for it, and the app's Settings says what the push service answered. A browser whose push service isn't Apple's, Google's, Mozilla's or Microsoft's is refused until you allow its host on the node (`GALAHAD_PUSH_HOSTS=push.example.org`).

## 4. Add the server

### The one-command way: `scripts/deploy.sh`

The script is idempotent. It works on Linux (a systemd user service) and macOS (a launchd agent). From the laptop, in Git Bash:

```sh
# a new fleet whose first node is the server
scripts/deploy.sh you@server --found camelot --name server
# or: add the server to an existing fleet
scripts/deploy.sh you@server --join "$(bun galahad invite --no-wait | grep -o 'gi1\.[A-Za-z0-9_-]*')" --name server
# later: ship the current commit to the node, test it there, restart it
scripts/deploy.sh you@server
```

What a deploy does:

1. Ships the committed tree only, into a fresh private directory it makes on the server (`mktemp -d`, removed when the deploy ends). It refuses to run if you have uncommitted changes.
2. Unpacks it into `~/galahad/releases/<rev>`.
3. Installs Bun 1.4.4 (the version the repo is tested with) unless that's the one in `~/.bun/bin`, from the official release, checking its SHA-256 against the one pinned in `scripts/remote-setup.sh`; then runs `bun install --frozen-lockfile`.
4. Runs the whole test suite on the server, in that release's directory, and stops if anything fails: the node keeps running the release it has, and `~/galahad/app` still points at it. Only a release that passed becomes `app`, in one atomic step. To roll back, point the symlink at an older release and restart.
5. Creates the node or joins the fleet, but only the first time. On later runs the node's identity and mind are kept. Old releases are removed: it keeps this one, the two before it and the one the node is running from (on Linux, where systemd says which).
6. Installs and restarts the service, then prints `galahad status`.

You need SSH access to the server first. Pick one:

- **Tailscale SSH (no keys to manage):** run `sudo tailscale set --ssh` on the server once, then deploy with `GALAHAD_SSH="tailscale ssh" scripts/deploy.sh you@server …`.
- **An SSH key:** add the laptop's public key to `~/.ssh/authorized_keys` on the server.

### By hand

On the **laptop**:

```powershell
bun galahad invite          # prints: galahad join gi1.…   and waits
```

On the **server**:

```sh
cd galahad
GALAHAD_KEYSTORE=file bun galahad join gi1.… --name server
```

- The server prints a 6-digit code, and the laptop shows one too. Approve on the laptop if they match.
- The server then syncs the mind, and its vault grant arrives with it.
- `GALAHAD_KEYSTORE=file` stores the device keys in `~/.galahad/keys.json` (0600). Use it on headless Linux without a Secret Service; with one (a desktop session), leave it out.

Run the server as a service (`/etc/systemd/system/galahad.service`):

```ini
[Unit]
Description=Galahad node
After=network-online.target tailscaled.service
Wants=network-online.target

[Service]
User=YOUR_USER
WorkingDirectory=/home/YOUR_USER/galahad
ExecStart=/home/YOUR_USER/.bun/bin/bun packages/node/src/cli.ts serve
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl daemon-reload && sudo systemctl enable --now galahad
bun galahad status          # both nodes, capabilities, online state
```

## 5. Add your keys once, use them everywhere

Keys go into a **hidden prompt**, never on the command line and never into chat.

```sh
bun galahad key add                       # auto-detects sk-ant- (Anthropic), sk-orca- (OrcaRouter), sk-or- (OpenRouter),
                                       # sk-kimi- (Kimi Code) and sk-sp- (Alibaba Cloud Coding Plan)
bun galahad key add --provider deepseek
bun galahad key add --provider abliteration
bun galahad key add --provider moonshot
bun galahad key add --provider verda --base-url https://…   # endpoint from your Verda console
bun galahad key add --provider cloudflare-ai --base-url https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/compat
                                       # the AI Gateway token; DeepSeek, Mistral … keys stay stored in Cloudflare
bun galahad secret list                   # names + …last4 hints only, never values
```

A key added on any full node is sealed into the vault and usable by every full node. Clients and tools never receive it.

**Coding plans** (a flat-rate subscription with a key of its own) are added the same way, each as its own provider:

```sh
bun galahad key add --provider zai-coding     # Z.ai's GLM Coding Plan
bun galahad key add                           # a Kimi Code key (sk-kimi-…) is recognised
bun galahad provider presets                  # every preset; the plans are marked
```

A plan's key is for coding: its vendor's terms say so, and `key add` prints the vendor's own sentence and where it is said. Galahad and his knights are a coding tool, so they code on a plan themselves (his quests, their work), calling as Galahad, and lend it to the other coding tools in their VMs (OpenCode, Hermes) and under `galahad run`, each calling as itself. His talk with you, his loops and his heartbeat never use it. `key add` prints the roster line that puts the plan first for coding, for example `bun galahad roster set engineer zai-coding/glm-5.3 anthropic/claude-opus-5-5`. [ARCHITECTURE §6](ARCHITECTURE.md) has the whole of it, and what each vendor says of its plan.

A **Claude subscription's sign-in** (what `claude setup-token` prints, `sk-ant-oat…`) is not an API key, and is refused if you paste it as one: Anthropic keeps it to its own tool and its own sign-in flow. Claude Code and Codex on your own subscriptions work with Galahad as agents over MCP, each on its own sign-in (§10: `bun galahad mcp install claude --apply`).

## 6. Models and roles

```sh
bun galahad roster                                  # planner / engineer / reviewer / swift / decider / embedder
bun galahad provider models deepseek                # what the provider serves
bun galahad roster set reviewer deepseek/<model-id> # a different family reviews the work
bun galahad ask "Good morning, Galahad. What do you know about my fleet?"
```

**Local models** for cheap work:

1. Install Ollama on the server (or laptop), then run `ollama pull <model>` and `ollama serve`.
2. Run `bun galahad provider add ollama` once.
3. The `swift` role already tries `ollama/*`, then `llamacpp/*`, then `anthropic/claude-haiku-5-5`.

## 6½. Seat knights at your Roundtable

Your knights sit at the **Roundtable**: Galahad, your primary knight, and the others you seat there, none beneath another, each with a name, a lasting job, rooms and DMs of its own. Open it in the PWA paired to the node you want to keep as the controller, choose **New knight**, then create a room or open a DM. The owner device needs `fleet:admin` to send messages or manage work. You can also ask Galahad in your main conversation to make a knight and brief it; he does so within a daily allowance, and Squires marks it as made by him. The CLI equivalent starts with:

```sh
bun galahad roundtable add ada --name Ada --role engineer --agent native --limit 40
bun galahad roundtable dm ada "Help me plan the next small, verifiable improvement."
bun galahad roundtable
```

A knight you no longer want is paused (`bun galahad roundtable pause knight ada`) or removed for good (`bun galahad roundtable remove ada`, or **Workspace → Remove knight** at the Roundtable). Removal keeps what it said and retires its handle; one with a VM is removed only together with that VM. [ROUNDTABLE](ROUNDTABLE.md#removing-a-knight) has the details.

Conversation can begin with the configured roster. Engineering tasks and shell calls require a persistent Kata VM on a Linux KVM host; they fail if one is unavailable. Image-backed workspaces require the updated helper's retention support; without the helper, files live in a persistent named volume with no disk quota. OpenCode, Hermes, Claude Code and Codex must be installed by the owner in that VM before selecting them for work; Claude Code and Codex can run there on your own Claude or ChatGPT subscription once you have signed them in yourself, in the VM, through the vendor's own flow ([ROUNDTABLE](ROUNDTABLE.md#claude-code-and-codex-your-subscription-does-the-coding)). Squires state lives in this controller's `team.db`, while `recall` and `remember` use Galahad's shared mind. **Working notes** are local execution context. Follow [ROUNDTABLE](ROUNDTABLE.md) for VM provisioning, shared rooms, budgets, dependencies, gates and Stop-and-revise, and [the Hermes integration](../integrations/hermes/README.md) for its separate shared-memory plugin.

## 7. Let tools use your keys without seeing them

```sh
bun galahad run --providers deepseek -- opencode
bun galahad run --providers anthropic -- claude
```

Each run:

- Gets a scoped, capped gateway token.
- Has its `OPENAI_BASE_URL` / `ANTHROPIC_BASE_URL` set to the local gateway.
- Has its token **revoked when the tool exits**.

To mint a token by hand, use `bun galahad token mint --label hermes --providers deepseek --ttl 60`.

## 8. Ask where work should run

```sh
bun galahad place --long --untrusted       # → server: always-on, can sandbox
bun galahad place --interactive            # → laptop: you are here
bun galahad place --docker --mem 64
```

Each answer says why: what the machine **measured** ("measured 18.7 reference cores' worth"), whether it has room ("3 of 4 slots free") or work would wait there ("full: work waits for a slot (2 ahead)").

## 8½. Compute: what he can carry, and your ceiling

Galahad uses the machines you enrolled and never acquires any: nothing here rents, buys or signs up for compute. Each node measures itself when it joins (a few seconds, at the lowest priority), and may use **half of its machine by default**, so whatever else runs there keeps the rest.

```sh
bun galahad compute                              # the census: what each node measured, its ceiling, slots in use and waiting,
                                                 # the day's budget, and what more compute would buy
bun galahad compute calibrate ultra              # measure a node again, now
bun galahad compute limit ultra --cores 24 --mem 96     # your ceiling: what he may use of that machine, at most
bun galahad compute limit ultra --sandboxes 2    # or simply how many sandboxes at once (0: none on this node)
bun galahad compute limit ultra --reset          # back to the default half
bun galahad compute effort auto --budget 12      # how much he spends on a quest by himself (below), and the day's budget
```

- **Slots.** From what a node measured inside its ceiling he derives how many sandboxes it carries at once (4 threads and 8 GB each), and says why, a line each. A sandbox that doesn't fit **waits its turn**; it never runs on top of the ceiling, and `galahad compute` and the Fleet page show what waits and why. While other work is busy on the machine he backs off, and a tenth of its threads always stays the host's.
- **A new machine.** Enroll it (`galahad invite`): it measures itself, sandboxes nobody pinned go to whichever host has room, and after the next heartbeat your Inbox says what changed ("rack joined: 4 sandbox slots…"). Nothing to configure.
- **Suggestions, never actions.** If a node has a GPU and no local model, or a local model measured well and nobody hired it, he says so in your Inbox with the command. He installs, downloads and hires nothing himself.

## 9. Run work in a sandbox

A server deployed with `scripts/deploy.sh` is a sandbox host: the deploy builds `galahad/sandbox:1` and opens only the sandbox gateway port. From any device:

```sh
bun galahad sandbox run -- sh -c 'id; uname -a'               # placed on the best host, destroyed afterwards
bun galahad sandbox run --net online -- git clone https://github.com/amiriteorg/galahad
bun galahad sandbox run --providers deepseek -- sh -c 'echo $OPENAI_BASE_URL'   # models via a scoped token
bun galahad sandbox run --keep --cpus 8 --mem 16 --disk 40 --ttl 240 -- true   # keep a workspace around
bun galahad sandbox exec <id> -- bun test
bun galahad sandbox ls --on ultra                               # each one's disk: used / limit
bun galahad sandbox rm <id>
bun galahad ledger                                              # every action, with the oath's verdict
```

Sandboxes are disposable; their results aren't. A quest keeps whatever it writes to `/work/out`, and you can keep any sandbox's:

```sh
bun galahad sandbox save <id> [/work/results] --label "mesh study"
bun galahad artifacts                          # what quests and sandboxes kept, newest first
bun galahad artifact <id>                      # its files, sizes and SHA-256s
bun galahad artifact <id> report.md            # print one
bun galahad artifact <id> --out ./results      # fetch them all, each checked against its hash
```

For mathematics, physics and engineering, give a sandbox or quest **the Lab** (`--lab`): SciPy and SymPy, FEniCSx with MPI, OpenFOAM, gmsh, build123d on OpenCascade, MuJoCo, ngspice, Octave, Maxima, Cantera, CoolProp, OpenSees, cvxpy and Z3. `lab-check` inside it proves each tool against a known answer:

```sh
bun galahad sandbox run --lab --net isolated -- lab-check
bun galahad do --lab "Find the first three natural frequencies of a 2 m steel cantilever (IPE 200) with FEniCSx and check them against Euler-Bernoulli theory"
```

On a server with KVM, the deploy also installs Kata Containers, and **online sandboxes run in their own microVM**: the same sandbox inside a lightweight virtual machine with its own kernel, ready in about two seconds. `--vm` asks for a microVM for any sandbox or quest (`galahad do --vm …`), and `--container` for a plain container; `galahad sandbox ls` shows which each one is.

Each sandbox's `/work` is its own disk of `--disk` GB (20 by default), so a runaway job fills its workspace and never the server's disk. Limits need the small root helper that `deploy.sh --sudo` installs; without it, workspaces are unlimited and the heartbeat warns you. The node also keeps the image in use, so cleanup tools that prune unused images (Coolify's nightly cleanup) leave it alone, and it rebuilds the image if it's gone anyway.

### Give Galahad a quest

`galahad do` plans the work, does it in a fresh sandbox one command at a time, has another model review the evidence, and remembers the outcome. With `--effort` it spends more compute for a better answer: that many attempts at once, each in its own sandbox and each reviewed, and the independent reviewer takes the best on the evidence alone.

```sh
bun galahad do --effort 3 "<goal>"       # three attempts at once (they wait their turn if fewer slots are free)
bun galahad do --effort auto "<goal>"    # as many as the free slots and the day's budget allow, up to 3
```

Each attempt beyond the first counts against the day's budget of extra attempts (12 by default: `galahad compute effort --budget n`). `auto` never goes past it; a level you name yourself stands, and he says when it does.

```sh
bun galahad do "Write fizzbuzz.py for 1..30 and prove it correct with a test"
bun galahad do --net online "Clone oven-sh/bun and tell me how many test files it has"
bun galahad do --steps 60 --timeout 900 --keep "Build the repo in /work and get its tests green"
```

**Say what done means.** A gate is a command that must pass before the reviewer is even asked; a quest whose gates never pass is never done.

```sh
bun galahad do "Fix the failing test in /work/repo" --gate "cd /work/repo && bun test"
bun galahad do "Write the report" --gate "test -s /work/out/report.md" --gate "grep -q Summary /work/out/report.md"
bun galahad quests                       # the quests in hand: plan, the command he's on, each gate's last result
```

The planner may add gates of its own from its "Done when:" line (they're marked as its proposal; `--no-planner-gates` runs yours only). The app shows the same under **In hand**: a tap on Galahad at the top of Chat, or on the Overview.

The sandbox has no network unless you pass `--net`. Ctrl-C stops after the current step. The exit code is 0 only when the reviewer passed the work.

For bigger work, let a full coding agent do it. OpenCode works for up to `--minutes`, with models through the gateway (it never sees a key), and the independent review still decides:

```sh
bun galahad do --agent opencode --minutes 90 "Write a small HTTP JSON API in Bun with tests, and get them green"
bun galahad do --agent opencode --net online --repo https://github.com/you/project "Fix the failing tests"
```

With `--repo`, the changes are kept as a patch (`changes.patch`) in the quest's artifact.

### Ship it: pull requests through your approval

Galahad's sandboxes never hold your GitHub token: they clone through the node's read-only git gateway (private repositories too, no internet needed), and with `--ship`, work the reviewer passed becomes a pull request request in your Inbox; approve it and the node commits the changes on a new `galahad/…` branch and opens the PR:

```sh
bun galahad do --agent opencode --repo https://github.com/you/project --ship "Fix the failing tests"
bun galahad ship art_… --title "Fix the failing tests"     # ship kept work yourself (asks y/N first)
bun galahad connector add github --owner yourorg            # a second owner with its own token
bun galahad order add github.ship --arg owner=you --arg repo=project --arg branch='galahad/*' --label "Galahad's PRs on project"
```

The token needs **Contents: read and write** and **Pull requests: read and write** on the repositories you want shipped to.

### Ask Galahad a scientific question

`galahad investigate` runs the scientific method in the Lab. The hypothesis and its falsifiable predictions are recorded in the mind before anything runs, the experiment verifies its own instruments, and an independent reviewer judges the method:

```sh
bun galahad investigate "Is the first bending mode of a 2 m steel cantilever (50 x 10 mm, weak axis) within 1 % of Euler-Bernoulli theory?"
bun galahad findings                 # supported, refuted or inconclusive, newest first
bun galahad finding <id>             # the registration beside what was found, and the evidence's artifact
```

### Typed decisions

Hire a decision model (TypeSafe's Jev, through your Cloudflare AI Gateway or with a TypeSafe key) as the `decider`, and ask yes/no, choice or score questions with calibrated probabilities:

```sh
bun galahad roster set decider cloudflare-ai/typesafe/jev
bun galahad decide "Help! My payouts have been failing for 3 days." --question "Does this convey urgency?"
bun galahad decide "…" --question "Which team?" --options billing,technical,sales
```

### Search the web

The deploy gives Galahad his own search engine (SearXNG, on the server, loopback only). Quests and investigations use it from their sandbox as `websearch <words>`, even without the internet:

```sh
bun galahad search "Euler buckling effective length factor fixed pinned"
```

### Measure him: the trials

Fourteen mathematics, physics and engineering problems with exact answers, posed with fresh random parameters and graded by a program, not a model:

```sh
bun galahad trial problems           # what's in the engineering suite
bun galahad trial run                # all of them, across the free slots, in the Lab (models only, no internet)
bun galahad trial run electrical --repeat 3   # some of them, more samples
bun galahad trial run --effort 1     # a baseline whose effort is on record…
bun galahad trial run --effort 3     # …and the same suite with three attempts a trial
bun galahad trials                   # the Galahad Index per run and per effort level (did more compute help?),
                                     # and each problem over every run
bun galahad trial <id|run>           # every answer next to the exact one
```

Two more suites, and what all of it costs (details in [TRIALS](TRIALS.md)):

```sh
bun galahad trial run --suite agentic            # real work in a small repository, graded by hidden tests in a fresh sandbox
bun galahad trial run --suite agentic --level 3  # the same tasks, harder (1 to 4); or one: … slow-rollup-l1
bun galahad trial run --suite reviewer           # a quest's evidence with a known answer, put to the reviewer
bun galahad price set deepseek/deepseek-v4-pro 0.5 2   # your price, $ per million tokens in and out (ollama/* 0 0 for a provider)
bun galahad usage                                # this node's model calls: tokens by model, role, who asked and day
bun galahad trial run --suite agentic --budget 2M       # stops cleanly when the budget is spent; says first what past runs cost
bun galahad trial sweep engineer deepseek/deepseek-v4-pro orcarouter/claude-opus-5-5 --suite agentic
                                                 # the same tasks with the engineer held to each: which is best, and best for its cost
bun galahad trial ab baseline no-gates --suite agentic  # the same tasks under two variants of the harness: does it measurably help?
```

## 10. Give your coding agents the mind (MCP)

Any MCP-capable agent can share Galahad's memory and sandboxes: Claude Code, OpenCode, Codex, Hermes, and T3 Code through them.

```sh
bun galahad mcp install claude --apply     # mints an arm credential and runs `claude mcp add`
bun galahad mcp install opencode           # prints the opencode.json snippet
bun galahad mcp install codex              # prints the ~/.codex/config.toml snippet
bun galahad arms                           # who's connected
bun galahad arms revoke claude-code        # cut one off, instantly
```

The agent gets these tools: `recall`, `remember`, `web_search`, `decide`, `fleet`, `place`, `sandbox_run`, `sandbox_create`, `sandbox_exec`, `sandbox_destroy`, `sandbox_save`, `artifacts`, `artifact_read`, `ledger`, `request_secret`, `connectors`, `connector_call`, `loops` and `notices`, plus the Oath as a resource. They're the same tools Galahad uses himself when you chat with him in the app or with `galahad ask`. An agent you grant `bank:read` also gets the four read-only bank tools (§13). Its credential is **least privilege**:

- **Memory:** its memories are labelled `agent` (or `untrusted`), never `owner`.
- **Sandboxes:** it may use and clean up only its own.
- **Off-limits:** it can never touch the vault, devices, providers or the gateway.
- **Local only:** the credential works on the loopback listener only.
- **Connectors, never keys:** it can call your connectors' tools; anything outward or destructive is filed for your approval.

## 11. Loops and the heartbeat

Galahad already has a heartbeat: every 30 minutes on your always-on node, he looks around and leaves what needs you in the inbox. After each, he fixes the few things that are safe to fix himself (an expired sandbox the reaper missed, a read-only loop that went wrong once) and records each in the ledger as his own; everything else waits for you.

```sh
bun galahad self-action                    # on or off, what he may fix, what he fixed lately (self-action off to stop it)
bun galahad heartbeat                      # run the checks now and print what they find
bun galahad notices                        # what needs you (notice dismiss <key> to quiet one)
bun galahad loop ls                        # every loop, where it runs, when next, how the last run went
bun galahad loop set heartbeat --checklist "Tell me if a quest gave up, or if the same loop needed a look twice in a row."
```

Add your own. Each runs on one node and every run is recorded in the mind:

```sh
# a quest every weekday morning, Copenhagen time (online: it clones the repo)
bun galahad loop add morning --cron "0 7 * * 1-5" --tz Europe/Copenhagen \
  --quest "Check the galahad repo's tests in a fresh clone and report anything failing" --net online
# the same with a gate: the run is only ok if the command passes in its sandbox
bun galahad loop add nightly --cron "0 2 * * *" --tz Europe/Copenhagen \
  --quest "Build the site in /work/site and write the size report" --gate "test -s /work/out/sizes.md"
# a connector check every hour
bun galahad loop add ci --every 1h --call github.runs --arg owner=amiriteorg --arg repo=galahad --arg per_page=5
bun galahad loop run morning               # now, by hand
bun galahad loop runs morning              # its history
bun galahad loop pause morning             # resume / rm
```

**Is everything well?** One command looks at the whole installation on the node you run it on and answers in plain lines, each ok, needs you or broken, with what to do:

```sh
bun galahad doctor                         # everything: asks each role's model one word, starts a sandbox and removes it
bun galahad doctor --offline               # the same, asking no model and probing no connector's service
bun galahad doctor --quick                 # only what costs nothing to look at (what the app's Overview shows)
bun galahad doctor --json                  # the report for a script; the exit code is 0 well, 1 needs you, 2 broken
```

It changes nothing. It checks the node's keys, the mind (integrity, its hash chain, the clock, sync, your last backup's age: it looks in `backups` in or beside the node's home, or where `GALAHAD_BACKUP_DIR` says), the vault, each role's models (the first one skipped on every answer is said), the embedder and the archive, sandboxes, compute, loops, connectors, the app (built, and published by Tailscale), notifications, the disk and the service. The app's Overview has the same on a **Doctor** card, and the heartbeat takes from it what it didn't already check.

Or ask for one in chat: "every weekday at 8, check my open pull requests and tell me which need me". Galahad drafts the loop, and the draft waits in your Inbox (**Loops Galahad drafted**) until you add it or dismiss it; from a terminal, `bun galahad loop drafts`, then `bun galahad loop add --draft <id>` or `bun galahad loop dismiss <id>`. He can't add a loop himself.

A loop that fails or needs a look leaves a notice in your inbox, and its next good run clears it. So a loop that calls a connector is a monitor: install a one-tool connector for your site (`{"id":"site","label":"galahad.bot","origin":"https://galahad.bot","tools":{"home":{"description":"The home page","method":"GET","path":"/","class":"read"}}}`) and `loop add site --every 5m --call site.home`.

## 11½. Skills: what he learned, and you curate

When a quest passes its independent review, Galahad may write one short note on how that kind of work went: when to use it, the steps, what proves it worked, pitfalls. That's a skill. He's given the few that bear on a later quest or question, as notes to weigh. A skill is words: nothing in one runs.

```sh
galahad do "make the parser's tests pass"      # passes review → "Skill learned: …" (or why none was)
galahad skills                                # each skill: state, trust, uses and how those quests ended
galahad skills show sk_…                      # its words, where it came from, every version, the quests that used it
galahad skills approve sk_…                   # prints the whole version that waits, then asks
galahad skills lock sk_… | unlock sk_…        # locked: he uses it, never changes it
galahad skills retire sk_… | restore sk_…     # retired: kept, never offered (nothing is ever deleted)
galahad skills rollback sk_…                  # one version back
galahad skills write --title "How we write release notes" --when "before showing merged work" \
  --step "Read what merged" --step "Say what changed for the reader" --proof "git log --oneline => the commits"
galahad skills budget 6000                    # tokens a day for distilling (0: off)
```

- **His own, in use at once**, only from a quest in an `isolated` sandbox whose planner was given nothing untrusted. Anything that could have read the outside world (`--net gateway` or `online`, a repository, a coding agent, an untrusted memory in its plan), anything he writes when you ask in a chat ("write up how you did that"), and anything another agent proposes **waits for you**: it's given to no model until you approve that exact version. Once your mind holds untrusted memories (every quest's outcome is one), expect most to wait.
- **Yours are yours.** A skill you write or edit is `owner`; he uses it and never changes it. He revises only skills he wrote that you haven't locked.
- **In the app:** Skills, under Mind. What waits comes first, in full, with Approve and Retire.

## 12. Connectors: your services, through the oath

```sh
bun galahad connector ls                               # the catalog and what's installed
bun galahad connector add github                       # or cloudflare, or home-assistant --origin http://homeassistant.local:8123
bun galahad secret set github --connector github       # hidden prompt; the key is pinned to api.github.com
bun galahad connector tools github                     # tools and their oath class
bun galahad connector call github.issues --arg owner=amiriteorg --arg repo=galahad --arg state=open
bun galahad action ls                                  # what agents and loops asked to do
bun galahad action approve <id>                        # sent once, by the node that asked (or: action deny <id>)
```

Reading, creating and modifying just happen (and are ledgered). When *you* call an outward or delete tool, your request is the approval. When an agent or a loop does, it waits for you in the inbox and is sent exactly once if you approve.

### Remote MCP servers

Any MCP server you can reach over HTTP can be a connector. Galahad lists its tools once, you choose what each one is, and from then on it's like any other connector: keys from the vault, reads at once, outward calls ask you.

```sh
bun galahad connector add deepwiki --mcp https://mcp.deepwiki.com/mcp          # public: no key
bun galahad connector add tracker --mcp https://mcp.example.com/mcp --auth bearer
bun galahad secret set tracker --connector tracker                              # then:
bun galahad connector refresh tracker                                           # list its tools with the key
bun galahad connector refresh tracker --class search=read --class "*=outward"   # your classes stay on later refreshes
bun galahad connector call deepwiki.read_wiki_structure --arg repoName=oven-sh/bun
```

The server's hints only propose a class: read-only becomes read, destructive becomes delete, and anything else becomes outward, which asks you. A refresh tells you which tools changed on the server since you installed them. A server that puts its key in the URL isn't supported, because the URL would replicate in plaintext.

### Standing orders: approve once, for a narrow kind of call

When you'd approve the same kind of request every time, sign a standing order. It names one tool, narrows its arguments (`*` matches anything), and expires:

```sh
bun galahad order add github.pr.create --arg owner=amiriteorg --arg repo='*' --arg head='feat/*' \
  --for claude-code --days 30 --label "PRs from feature branches"
bun galahad order add --from <action-id>     # approve a waiting request, and answer the same way next time
bun galahad orders                           # what's active, how often it was used
bun galahad order revoke <id>
```

In the PWA, **Approve and allow similar…** on any request in the Inbox does the same, and the Connectors page lists your orders. A covered call still shows up in your inbox and the ledger, marked with the order that answered it. Orders that delete name exactly one thing (no `*`), every order names where its calls go, and if the connector's tool changes after you sign, the order stops applying until you sign a new one.

## 12½. Chats and projects

Chats are kept on the node you talk to, the app's and the terminal's alike:

```sh
bun galahad ask "Plan the week"                  # kept; --temp for one that isn't
bun galahad chats                                # your chats, pinned first
bun galahad ask --chat <id> "And on Friday?"     # go on with one
bun galahad chat <id>                            # read it; galahad chat rm <id> deletes it for good
```

A turn runs on the node, so it goes on if the terminal (or the app's page) goes away; the answer is in the chat. While he's working in a chat you can tell him something now, or leave it for after:

```sh
bun galahad ask --detach "Read the week's issues and summarise them"   # start it and leave him to it
bun galahad turns                                # what he's working on: time so far, who's watching, when it stops by itself
bun galahad turn watch <turn|chat>               # watch one from its start; galahad turn stop <turn|chat> stops it
bun galahad ask --chat <id> --steer "Only the open ones"      # he's told at his next safe point
bun galahad ask --chat <id> --queue "Then draft replies"      # kept on the node, sent when he's done
bun galahad queue <id>                           # your queue behind a chat: rm <n|all>, send <n>, resume
bun galahad ask --chat <id> --aside "How far along is he?"    # asked on the side; --bring hands the answer to him
```

Ctrl-C in `galahad ask` stops him (it's the terminal's Stop). After a stop, a failure or a node restart the queue is held until you `resume` it. Anything he needs you for meanwhile (an approval, a key) waits in your Inbox: nothing is approved because nobody was watching. In the app the same is in the composer: Enter steers or queues (your choice in Settings), and `/btw …` asks on the side.

A project is a workspace: instructions Galahad follows in its chats, an optional repository, and its own chats and memories.

```sh
bun galahad project set rocket --name "Rocket engine" --instructions "SI units. Cite sources." --repo https://github.com/you/rocket
bun galahad ask --project rocket "Size the nozzle for 5 kN at sea level"
bun galahad projects
```

## 13. Your bank, read-only

Balances and transactions of your own accounts, through Enable Banking, for the agents you choose; nothing can move money. The whole setup (the application at Enable Banking, the key, linking your bank) is in [BANK](BANK.md). In short, on the node that holds it:

```sh
galahad bank setup --app-id <application id> \
  --key /var/lib/galahad/.galahad/bank/enablebanking.pem \
  --redirect-url https://<node>.<tailnet>.ts.net:8443/bank/callback \
  --aspsp "<bank>" --country <XX>
galahad bank status
galahad arms grant claude-code bank:read     # one agent may read it
```

Then authorise in the PWA (**Bank → Connect**, in the paired browser), and again every 89 days: the inbox reminds you a week before.

## 14. The archive: everything kept, and searched by meaning

Every node keeps an archive of what it holds: kept work and the models in it, what Galahad was taught and found (memories, investigations, trials), ideas, kept chats (never one where he read the bank), and lessons drawn from them. Nothing is ever evicted; only you delete. It works at once, searching by words; an **embedder** adds search by meaning.

```sh
galahad archive                                   # what's in it, what's embedded, the embedder, the last integrity check
galahad archive search "cantilever deflection" --kind teaching,artifact --since 30d
galahad archive show arc_…                        # summary, facts, lessons, files, links
galahad archive idea "A windmill for the lab" --text "Pump water to the stream"
```

In the app: **Archive** (`G` then `K`), and **New idea** from the palette.

### Turning on the local embedder (recommended)

On the server, the archive's words never have to leave it: deploy with `--embedder` (a root target, like `--sudo`):

```sh
scripts/deploy.sh root@ultra --embedder
```

The deploy installs **Ollama 0.40.7** (checked against the SHA-256 GitHub records for it) as its own unprivileged service, `galahad-ollama`, listening on `127.0.0.1:11434` only, pulls **qwen3-embedding:0.6b** (about 640 MB; its layer digest is checked against the one pinned in the script), configures the `ollama` provider if it isn't, and hires it as the `embedder` role, unless you've hired one yourself. The archive then embeds its backlog in the background (it pauses while answers stream). Deploys without the flag change nothing here and leave an earlier install as it is.

By hand, anywhere: run any OpenAI-compatible `/embeddings` server (Ollama, llama.cpp's `llama-server --embeddings`), then

```sh
galahad provider add ollama
galahad roster set embedder ollama/qwen3-embedding:0.6b   # name the model: vectors from different models can't be mixed
```

A **remote** embedder works too (any OpenAI-compatible provider with an embeddings endpoint, e.g. Cloudflare Workers AI as its own provider: `galahad provider add workers-ai --kind openai --base-url https://api.cloudflare.com/client/v4/accounts/<id>/ai/v1` with a Workers AI token, then `roster set embedder workers-ai/@cf/baai/bge-m3`), but then every passage the archive keeps goes to that provider. Changing the model re-embeds everything in the background; until it's done, search falls back to words.

### Summaries and lessons

The `swift` role writes each entry's summary, facts, tags and named things, and lessons for teachings, a few at a time in the background. Until you set a budget, **only a local swift model** does it (an Ollama chat model on the server, which `ollama/*` picks up: `sudo -u galahad-ollama OLLAMA_HOST=127.0.0.1:11434 /opt/ollama/bin/ollama pull qwen3:8b`), so nothing leaves. `galahad archive budget 200` allows 200 a day by the role's models in order (a cloud model among them gets the entries' text); `galahad archive budget 0` stops it.

### Where it lives

`archive.db` (the index, mode 600) and `archive/` (the files, by SHA-256, 600 in 700 directories) in the node's home. `GALAHAD_ARCHIVE_DIR=/path` moves the files (the service may write only its home, so a path elsewhere needs `ReadWritePaths` in its unit); `GALAHAD_ARCHIVE=off` stops it pulling anything new. `galahad archive verify` re-hashes every file now (it runs daily, and tells your inbox if one changed or went missing).

## Troubleshooting

| Symptom | Try |
|---|---|
| Something is off and you don't know what | `bun galahad doctor` on the node: every line says what it found and what to do (it also runs with no node up, and says so) |
| `no daemon on http://127.0.0.1:7777` | Start `bun galahad serve` (or check `GALAHAD_PORT`) |
| A peer shows `offline` | `tailscale status`; check the firewall rule; `bun galahad status` shows the last error |
| `expose` fails | Enable MagicDNS + HTTPS certificates in the Tailscale admin console |
| `device keys not found` | The node was initialized with a different keystore; check `keystore` in `~/.galahad/config.json` |
| Doubt about local state | Stop the daemon, then run `bun galahad rebuild`. It replays the log and confirms the state is identical. |
| Lost a device | `bun galahad revoke <name>`. This rotates the vault and lists which keys to rotate at the provider. |
| The app says "Galahad can't be reached just now" | Nothing to do while the node restarts: the page tries again on its own (and at once when the network comes back or you bring the app forward). If it keeps saying so, check `bun galahad status` on the node and `tailscale status`. |
| The app says "This browser's key can't be read just now" | Reload; if that doesn't help, close the Home Screen app completely and open it again. Don't pair it again first: a new pairing replaces the key. |
