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

> The PWA has these views: Chat, Memory, Vault, Models and Fleet. Its build, serving, pairing protocol and signed API calls are tested; it hasn't yet been run in a real browser. Please report anything that looks off.

## 3. Pair a phone or browser

```powershell
bun galahad invite --client
```

1. Open the printed URL on the device you're adding. It's single-use and valid for 10 minutes.
2. The device creates a non-extractable key and shows a **6-digit code**.
3. The terminal shows the same code. Answer `y` only if they match.

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

1. Ships the committed tree only. It refuses to run if you have uncommitted changes.
2. Unpacks it into `~/galahad/releases/<rev>`, then switches the `~/galahad/app` symlink to that directory in one atomic step. To roll back, point the symlink at an older release and restart.
3. Installs Bun if it's missing and runs `bun install --frozen-lockfile`.
4. Runs the whole test suite on the server and stops if anything fails.
5. Creates the node or joins the fleet, but only the first time. On later runs the node's identity and mind are kept.
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
bun galahad sandbox run --keep --cpus 8 --mem 16 --ttl 240 -- true             # keep a workspace around
bun galahad sandbox exec <id> -- bun test
bun galahad sandbox ls --on ultra
bun galahad sandbox rm <id>
bun galahad ledger                                              # every action, with the oath's verdict
```

### Give Galahad a quest

`galahad do` plans the work, does it in a fresh sandbox one command at a time, has another model review the evidence, and remembers the outcome:

```sh
bun galahad do "Write fizzbuzz.py for 1..30 and prove it correct with a test"
bun galahad do --net online "Clone oven-sh/bun and tell me how many test files it has"
bun galahad do --steps 60 --timeout 900 --keep "Build the repo in /work and get its tests green"
```

The sandbox has no network unless you pass `--net`. Ctrl-C stops after the current step. The exit code is 0 only when the reviewer passed the work.

## 10. Give your coding agents the mind (MCP)

Any MCP-capable agent can share Galahad's memory and sandboxes: Claude Code, OpenCode, Codex, Hermes, and T3 Code through them.

```sh
bun galahad mcp install claude --apply     # mints an arm credential and runs `claude mcp add`
bun galahad mcp install opencode           # prints the opencode.json snippet
bun galahad mcp install codex              # prints the ~/.codex/config.toml snippet
bun galahad arms                           # who's connected
bun galahad arms revoke claude-code        # cut one off, instantly
```

The agent gets these tools: `recall`, `remember`, `fleet`, `place`, `sandbox_run`, `sandbox_create`, `sandbox_exec`, `sandbox_destroy`, `ledger`, `request_secret`, `connectors`, `connector_call`, `loops` and `notices`, plus the Oath as a resource. Its credential is **least privilege**:

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

## Troubleshooting

| Symptom | Try |
|---|---|
| `no daemon on http://127.0.0.1:7777` | Start `bun galahad serve` (or check `GALAHAD_PORT`) |
| A peer shows `offline` | `tailscale status`; check the firewall rule; `bun galahad status` shows the last error |
| `expose` fails | Enable MagicDNS + HTTPS certificates in the Tailscale admin console |
| `device keys not found` | The node was initialized with a different keystore; check `keystore` in `~/.galahad/config.json` |
| Doubt about local state | Stop the daemon, then run `bun galahad rebuild`. It replays the log and confirms the state is identical. |
| Lost a device | `bun galahad revoke <name>`. This rotates the vault and lists which keys to rotate at the provider. |
