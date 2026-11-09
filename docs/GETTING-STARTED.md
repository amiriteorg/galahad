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
bun galahad expose     # runs: tailscale serve --bg 7777
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

## Troubleshooting

| Symptom | Try |
|---|---|
| `no daemon on http://127.0.0.1:7777` | Start `bun galahad serve` (or check `GALAHAD_PORT`) |
| A peer shows `offline` | `tailscale status`; check the firewall rule; `bun galahad status` shows the last error |
| `expose` fails | Enable MagicDNS + HTTPS certificates in the Tailscale admin console |
| `device keys not found` | The node was initialized with a different keystore; check `keystore` in `~/.galahad/config.json` |
| Doubt about local state | Stop the daemon, then run `bun galahad rebuild`. It replays the log and confirms the state is identical. |
| Lost a device | `bun galahad revoke <name>`. This rotates the vault and lists which keys to rotate at the provider. |
