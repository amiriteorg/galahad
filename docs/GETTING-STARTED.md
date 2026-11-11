# Getting started

This guide sets up the target layout: your **Windows laptop** (`wkp-minaltan`) plus one **beefy Linux server** on the same tailnet, with Docker and VMs. Both run a Galahad node and share one mind.

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

The PWA is now at `https://wkp-minaltan.<your-tailnet>.ts.net/`, reachable only from your tailnet, over HTTPS with a real certificate.

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

## 4. Add the server

### The one-command way: `scripts/deploy.sh`

The script is idempotent. It works on Linux (a systemd user service) and macOS (a launchd agent). From the laptop, in Git Bash:

```sh
# a new fleet whose first node is the server
scripts/deploy.sh wmd@ultra --found camelot --name ultra
# or: add the server to an existing fleet
scripts/deploy.sh wmd@ultra --join "$(bun galahad invite --no-wait | grep -o 'gi1\.[A-Za-z0-9_-]*')" --name ultra
# later: ship the current commit to the node, test it there, restart it
scripts/deploy.sh wmd@ultra
```

What a deploy does:

1. Ships the committed tree only, into a fresh private directory it makes on the server (`mktemp -d`, removed when the deploy ends). It refuses to run if you have uncommitted changes.
2. Unpacks it into `~/galahad/releases/<rev>`, then switches the `~/galahad/app` symlink to that directory in one atomic step. To roll back, point the symlink at an older release and restart.
3. Installs Bun 1.4.4 (the version the repo is tested with) unless that's the one in `~/.bun/bin`, from the official release, checking its SHA-256 against the one pinned in `scripts/remote-setup.sh`; then runs `bun install --frozen-lockfile`.
4. Runs the whole test suite on the server and stops if anything fails.
5. Creates the node or joins the fleet, but only the first time. On later runs the node's identity and mind are kept. Old releases are removed: it keeps this one, the two before it and the one the node is running from (on Linux, where systemd says which).
6. Installs and restarts the service, then prints `galahad status`.

You need SSH access to the server first. Pick one:

- **Tailscale SSH (no keys to manage):** run `sudo tailscale set --ssh` on the server once, then deploy with `GALAHAD_SSH="tailscale ssh" scripts/deploy.sh wmd@ultra …`.
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
bun galahad key add                       # auto-detects sk-ant- (Anthropic), sk-orca- (OrcaRouter), sk-or- (OpenRouter)
bun galahad key add --provider deepseek
bun galahad key add --provider abliteration
bun galahad key add --provider moonshot
bun galahad key add --provider verda --base-url https://…   # endpoint from your Verda console
bun galahad key add --provider cloudflare-ai --base-url https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/compat
                                       # the AI Gateway token; DeepSeek, Mistral … keys stay stored in Cloudflare
bun galahad secret list                   # names + …last4 hints only, never values
```

A key added on any full node is sealed into the vault and usable by every full node. Clients and tools never receive it.

## 6. Models and roles

```sh
bun galahad roster                                  # planner / engineer / reviewer / swift
bun galahad provider models deepseek                # what the provider serves
bun galahad roster set reviewer deepseek/<model-id> # a different family reviews the work
bun galahad ask "Good morning, Galahad. What do you know about my fleet?"
```

**Local models** for cheap work:

1. Install Ollama on the server (or laptop), then run `ollama pull <model>` and `ollama serve`.
2. Run `bun galahad provider add ollama` once.
3. The `swift` role already tries `ollama/*`, then `llamacpp/*`, then `anthropic/claude-haiku-5-5`.

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

`galahad do` plans the work, does it in a fresh sandbox one command at a time, has another model review the evidence, and remembers the outcome:

```sh
bun galahad do "Write fizzbuzz.py for 1..30 and prove it correct with a test"
bun galahad do --net online "Clone oven-sh/bun and tell me how many test files it has"
bun galahad do --steps 60 --timeout 900 --keep "Build the repo in /work and get its tests green"
```

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
bun galahad trial run                # all of them, three at a time, in the Lab (models only, no internet)
bun galahad trial run electrical --repeat 3   # some of them, more samples
bun galahad trials                   # the Galahad Index per run, and each problem over every run
bun galahad trial <id|run>           # every answer next to the exact one
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

Galahad already has a heartbeat: every 30 minutes on your always-on node, he looks around and leaves what needs you in the inbox.

```sh
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
# a connector check every hour
bun galahad loop add ci --every 1h --call github.runs --arg owner=amiriteorg --arg repo=galahad --arg per_page=5
bun galahad loop run morning               # now, by hand
bun galahad loop runs morning              # its history
bun galahad loop pause morning             # resume / rm
```

A loop that fails or needs a look leaves a notice in your inbox, and its next good run clears it. So a loop that calls a connector is a monitor: install a one-tool connector for your site (`{"id":"site","label":"galahad.bot","origin":"https://galahad.bot","tools":{"home":{"description":"The home page","method":"GET","path":"/","class":"read"}}}`) and `loop add site --every 5m --call site.home`.

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

A project is a workspace: instructions Galahad follows in its chats, an optional repository, and its own chats and memories.

```sh
bun galahad project set rocket --name "Rocket engine" --instructions "SI units. Cite sources." --repo https://github.com/you/rocket
bun galahad ask --project rocket "Size the nozzle for 5 kN at sea level"
bun galahad projects
```

## 12¾. Watch Galahad: the SANDBOX

The app's **SANDBOX** page is a world where Galahad walks between the places of his keep as he works, and every experiment he runs stands on its own plot, live. In a terminal: `bun galahad world --follow`. In any sandbox with a network, `python3 -m galahad_world arm|plane|rocket` puts a demo on a plot (the Lab has MuJoCo, JSBSim and RocketPy); `bun galahad sandbox run --gazebo -- python3 -m galahad_world gazebo` runs one in Gazebo. More: [WORLD](WORLD.md).

## 13. Your bank, read-only

Balances and transactions of your own accounts, through Enable Banking, for the agents you choose; nothing can move money. The whole setup (the application at Enable Banking, the key, MitID) is in [BANK](BANK.md). In short, on the node that holds it:

```sh
galahad bank setup --app-id <application id> \
  --key /var/lib/galahad/.galahad/bank/enablebanking.pem \
  --redirect-url https://<node>.<tailnet>.ts.net:8443/bank/callback
galahad bank status
galahad arms grant claude-code bank:read     # one agent may read it
```

Then authorise in the PWA (**Bank → Connect**, in the paired browser), and again every 89 days: the inbox reminds you a week before.

## Troubleshooting

| Symptom | Try |
|---|---|
| `no daemon on http://127.0.0.1:7777` | Start `bun galahad serve` (or check `GALAHAD_PORT`) |
| A peer shows `offline` | `tailscale status`; check the firewall rule; `bun galahad status` shows the last error |
| `expose` fails | Enable MagicDNS + HTTPS certificates in the Tailscale admin console |
| `device keys not found` | The node was initialized with a different keystore; check `keystore` in `~/.galahad/config.json` |
| Doubt about local state | Stop the daemon, then run `bun galahad rebuild`. It replays the log and confirms the state is identical. |
| Lost a device | `bun galahad revoke <name>`. This rotates the vault and lists which keys to rotate at the provider. |
| The app says "Galahad can't be reached just now" | Nothing to do while the node restarts: the page tries again on its own (and at once when the network comes back or you bring the app forward). If it keeps saying so, check `bun galahad status` on the node and `tailscale status`. |
| The app says "This browser's key can't be read just now" | Reload; if that doesn't help, close the Home Screen app completely and open it again. Don't pair it again first: a new pairing replaces the key. |
