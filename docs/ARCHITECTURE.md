# Galahad: architecture

**One mind, many bodies.** Every Galahad instance (laptop, server, phone, a Pi in a closet) is *the same Galahad*. Each one shares the same memory, vault, roster, oath and devices, and they differ only in what their body can do.

> **Status legend:** ✅ built and tested in M0 · 🔜 planned (see [Roadmap](#11-roadmap))

## Principles

1. **Compose, don't rewrite.** Hermes Agent, OpenCode, Claude Code and Codex are Galahad's arms. Galahad is the mind, the vault and the mesh above them.
2. **Provider-agnostic.** Models are hired by *role*, and the roster can change any day.
3. **Fast by default, verified always.** Parallelism provides the speed. Checks are never skipped to save time.
4. **Idempotent everywhere.** Any operation can be retried, and any node can be rebuilt from the log.
5. **Local-first.** Every node holds a replica and keeps working offline. No node is the master.
6. **Open standards at every seam:** MCP, ACP, `SKILL.md`, OpenAI-compatible HTTP.
7. **Bounded autonomy.** Galahad has full freedom inside the [oath](OATH.md). Creating is free, while deleting and anything outward-facing ask first.
8. **Secrets are structural.** Keys never pass through chat, memory, logs or arms. They live only in the vault and are used only by brokers.
9. **Typesafety isn't optional.** Contracts live in one package and every input is validated where it enters the system.

## The big picture

```
        ┌──────────────── THE MIND  (signed, content-addressed, replicated event log) ────────────────┐
        │  fleet · devices · vault keys & sealed secrets · providers · roster · memories · requests   │
        └──────▲─────────────────────▲─────────────────────────▲──────────────────────────────────────┘
               │ pull + push sync    │                         │
        ┌──────┴───────┐      ┌──────┴───────┐          ┌──────┴───────┐
        │ laptop node  │◄────►│ server node  │◄────────►│  more nodes  │   ◄── THE LINK (Tailscale + signed requests)
        └──────┬───────┘      └──────┬───────┘          └──────────────┘
   127.0.0.1   │ tailnet IP          │ tailnet IP
   ┌───────────┴──────────┐   ┌──────┴────────────────────────────┐
   │ CLI (admin token)    │   │ gateway /gw/* → providers (keys    │
   │ PWA via tailscale    │   │ injected; arms hold scoped tokens) │
   │ serve (HTTPS)        │   │ sandboxes, local models, cron 🔜   │
   └──────────────────────┘   └────────────────────────────────────┘
```

Code layout:

| Package | Role |
|---|---|
| `packages/core` | Contracts and primitives: crypto, canonical JSON, HLC, event schemas, API routes and scopes, pairing math, request signing, the oath gate, secret scanning |
| `packages/mind` | The replica: SQLite log + views, the vault, fleet founding/enrollment/revocation |
| `packages/link` | Pairing host, the joining client, the sync engine |
| `packages/brain` | Provider presets, roster, adapters (Anthropic SDK, OpenAI-compatible), chat with fallback, model gateway |
| `packages/node` | Daemon, HTTP server, CLI, capability probe, placement, config/keystore |
| `apps/web` | The PWA (served by every node) |

## 1. The Mind ✅

The mind is an **append-only log of signed events**. Each event has the form `{v, id, fleet, hlc, device, kind, body, prov, sig}`.

- **Content-addressed:** `id = sha256(canonical JSON of the unsigned event)`. Re-applying an event is a no-op, so sync can retry forever.
- **Signed:** each event is signed by the node that wrote it, using Ed25519 over a domain-separated id. Only nodes sign log events; clients never do.
- **Self-certifying fleet:** the fleet id is the id of the `fleet.genesis` event, so a joining node can check it landed in the right fleet.
- **Ordered by a hybrid logical clock (HLC):** the format is `<15-digit ms>.<6-digit counter>`, and ties are broken by id. Timestamps more than 5 minutes in the future are refused, so a broken or hostile clock can't win every last-writer-wins race.
- **State is a pure function of the event set:**
  - Views (devices, memories with FTS5 search, LWW records, vault grants, rejections) are materialized by replaying events in `(hlc, id)` order.
  - An event that arrives out of order triggers a deterministic replay.
  - So two replicas holding the same events have identical state. `digest()` proves this, and a property test checks it under shuffled delivery with duplicates.
- **Authorization is part of the log's rules:**
  - Only active full nodes may enroll or revoke devices, write secrets, configure providers or change the roster.
  - Events from unknown or revoked devices are stored but rejected. If an enrollment arrives late, they become valid on replay.
  - The last full node can't be revoked.
- **Forward-compatible:** unknown event kinds are stored and ignored, so mixed versions can coexist during a rollout.
- **Writes are atomic:** an event this node isn't authorized to write never enters the log.

Event kinds today:

| Kind | Purpose |
|---|---|
| `fleet.genesis` | Founds the fleet |
| `device.enrolled` / `device.revoked` | Adds or removes a device |
| `node.profile` | A node's endpoint and capabilities, re-published only when they change |
| `vault.key` / `vault.grant` | Vault keys, sealed to each full node |
| `secret.set` / `secret.deleted` | Encrypted secrets (LWW by name) |
| `secret.requested` | Galahad asks you for a credential |
| `provider.set` / `provider.removed` | Provider config (LWW) |
| `roster.set` | Role → ordered models (LWW) |
| `memory.added` / `memory.forgotten` | Memories with provenance and trust |

**Sync:**

- Each device's events form an HLC-ordered prefix on every replica. A peer's **frontier** (the highest HLC per device) therefore fully describes what it has.
- `eventsSince(frontier)` returns exactly the missing events, paginated.
- Nodes pull from every peer independently every few seconds, and also push fresh events immediately.

**Planned 🔜:** snapshots, cold segments moved to the blob store, partial replicas on phones, and the compiled-knowledge layer (an LLM wiki, see [DOCTRINE](DOCTRINE.md)).

## 2. The Link ✅

- **Transport v0: Tailscale.** Each node has three listeners and never binds `0.0.0.0`:

  | Listener | Address | Purpose |
  |---|---|---|
  | **loopback** | `127.0.0.1:<port>` | Local processes only: the CLI's admin token and the model gateway |
  | **proxied** | `127.0.0.1:<port+1>` | The only target of `tailscale serve` (the HTTPS PWA) |
  | **tailnet** | `<tailnet ip>:<port>` | Node-to-node link traffic |

  Proxied traffic arrives from `127.0.0.1` but is remote, so that listener refuses the admin token and the gateway (tested).
- **Every request is signed** by the caller's device key over `(method, path+query, time, nonce, sha256(body))`, with a 60-second skew window and a nonce cache against replay. WireGuard already encrypts the wire; the signature proves *which enrolled device* is calling.
- **Credentials by caller:**

  | Caller | How it authenticates | Where |
  |---|---|---|
  | Node | Ed25519 key | Link and API |
  | Client (PWA) | Non-extractable WebCrypto P-256 key, verified with `lowS: false` because WebCrypto doesn't normalize signatures | API only |
  | CLI | Local admin token | Loopback listener only |
- **Per-method authorization:** authenticating a request doesn't authorize every route. Each route names exactly one scope (`mind:read`, `mind:write`, `chat`, `vault:read`, `vault:write`, `brain:write`, `gateway:mint`, `fleet:admin`), and the server checks it when the route executes.
- **The PWA** is served over HTTPS by `tailscale serve`, with a strict CSP (`script-src 'self'`, `frame-ancestors 'none'` and so on).
- 🔜 **v1:** embedded peer-to-peer QUIC (Iroh) with relay fallback, so no VPN app is needed.

## 3. Pairing ✅

1. A trusted node mints a **one-time invite**: a 32-byte secret, valid for 10 minutes, single use, held only in daemon memory. Nodes get `galahad join <invite>`; clients get a URL with the invite in the `#pair=` fragment.
2. The joining device sends its public keys plus an **HMAC proof** over them, derived from the invite secret. The secret itself never travels.
3. Both sides derive a **6-digit code (SAS)** from (secret, fleet, joining device key). Approve only if the codes match. Someone who intercepted the invite has a different device key, and therefore a different code.
4. **Conflict lock:** if a second device uses the same invite, the invite is locked and nothing on it can be approved. That pattern suggests interception.
5. Approval emits `device.enrolled`. For nodes it also emits `vault.grant`. The joining device verifies an **approval proof** (another HMAC) and that the synced genesis matches the fleet id in the invite.

## 4. The Vault ✅

Add an API key once, and every full node can use it. The key never appears in the log in plaintext.

| Piece | What it is |
|---|---|
| Vault key | A random 32-byte key per key id (`kid`) |
| Grant | The vault key, sealed to one **full node's** X25519 key: ephemeral X25519 → HKDF-SHA256 → XChaCha20-Poly1305, bound to `fleet\|kid\|device` |
| `secret.set` | XChaCha20-Poly1305 encryption under the vault key, with AAD `galahad/secret/v1\|fleet\|name\|kid` |

- **Only full nodes** ever hold the vault key. Clients (PWA, phones) and arms (coding agents, sandboxes) never see provider keys.
- **Revocation rotates the vault:** a new kid is created, every live secret is resealed, and the revoked node can't read anything written afterwards. The command lists the secrets the device could have seen, so you can rotate those at the provider too.
- **At rest:**
  - Device private keys live in the OS keychain (`Bun.secrets`), or in a 0600 file on headless servers.
  - Plaintext exists only in memory, at the moment of use.

## 5. Secret handling, end to end ✅

| Door | Rule |
|---|---|
| Entering keys | A hidden terminal prompt (`galahad key add`, `secret set`) or the PWA's password field. Never on the command line, never in chat. |
| Chat and memory | **Secret scanning** refuses anything credential-shaped with `422` and points to the vault. It catches `sk-ant-`, `sk-orca-`, `sk-or-`, `sk-…`, GitHub, AWS, Google, Slack and HF tokens, private keys, Galahad tokens and invites, `password=…`, and high-entropy tokens. Chat goes to providers and memory replicates in plaintext, so both doors are guarded. |
| Errors | Provider error text is **redacted** of the key in use and of anything secret-shaped before it reaches chat, logs or arms. |
| Asking | Galahad files a **secret request** (`secret.requested`: name, provider, purpose). You fill it from any device, and he learns only that it exists. |
| Using keys | The **model gateway** (`/gw/<provider>/…`, loopback only) injects the real key on the way out. Arms hold `gw_…` tokens that are scoped to providers, expiring, request-capped, stored as hashes and revocable. |
| Running tools | `galahad run --providers deepseek -- opencode` mints a token, sets `OPENAI_BASE_URL`/`ANTHROPIC_BASE_URL` and the token for the child process only, and revokes the token when the tool exits. |
| API | No route ever returns a secret's plaintext. Listing shows name, provider and a `…last4` hint (only for values of 12 characters or more). |

## 6. The Brain ✅

**Roles, not vendors.** Each role is an ordered list of `<provider>/<model>` refs. The first one that answers wins.

| Role | Default | Effort |
|---|---|---|
| `planner` | `anthropic/claude-opus-5-5` | high |
| `engineer` | `anthropic/claude-opus-5-5` | xhigh |
| `reviewer` | `anthropic/claude-opus-5-5` (set a different model family, e.g. DeepSeek) | high |
| `swift` | `ollama/*` → `llamacpp/*` → `anthropic/claude-haiku-5-5` | low |

`<provider>/*` resolves to the first model that runtime serves on this node.

**Provider presets:**

| Preset | Kind | Base URL |
|---|---|---|
| `anthropic` | anthropic | `https://api.anthropic.com` |
| `deepseek` | openai | `https://api.deepseek.com/v1` |
| `abliteration` | openai | `https://api.abliteration.ai/v1` |
| `orcarouter` | openai | `https://api.orcarouter.ai/v1` |
| `openrouter` | openai | `https://openrouter.ai/api/v1` |
| `moonshot` | openai | `https://api.moonshot.ai/v1` |
| `verda` | openai | *Account-specific: pass `--base-url` from the Verda console* |
| `ollama`, `llamacpp` | openai (local) | `http://127.0.0.1:11434/v1`, `http://127.0.0.1:8080/v1` |

- **Anthropic** goes through the official SDK with adaptive thinking, explicit effort and streaming. Server-side refusal fallback (`fallbacks: "default"`) is enabled on the models that support it (Fable 5.1, Opus 5.5, Opus 5, Sonnet 5.5).
- **Everything else** uses OpenAI-compatible streaming.
- **Fallback chain:** a model that fails *before* producing text is skipped (missing key, outage, rate limit, refusal), and the next model answers. Each skip is reported to the client.
- **Persona and context:** the standing persona prompt is byte-stable, so it caches well. Relevant memories are appended after it, labelled with their trust level.

## 7. Placement: using every body well ✅

`place(needs, nodes)` applies **hard filters**: online, docker, VM, GPU, memory, tools, local models, and "untrusted work only where it can be sandboxed". It then ranks the remaining nodes with **soft scores**, and every decision carries its reasons.

| Body | Gets |
|---|---|
| **Server** (always-on, docker, KVM) | Long quests, untrusted or web-facing work in containers and VMs, local models if it has a GPU, cron, being the relay |
| **Laptop** | Interactive work ("you are here"), the repos you're editing. Avoided for long work while on battery. |
| **Phone** (PWA) | Chat, approvals, adding keys, pairing |

Live load (CPU, free memory, battery) travels with sync as *presence* and never enters the log. 🔜 Quests checkpoint and migrate when a body sleeps or leaves.

## 8. The Oath gate ✅

`decide(action)` classifies every side effect:

| Class | Verdict |
|---|---|
| read, create, modify | **allow** (logged) |
| outward (push, send, deploy, purchase) | **ask** |
| delete | **ask**, except cleaning up *ephemeral* things the same quest created |
| forbidden | **deny** |

Standing orders that you sign can pre-approve a narrow class, for example `git.push` to `amiriteorg/*#feat/*` until a given date. The gate is implemented and tested; 🔜 wiring it into every arm, together with an approvals UI, is M2.

**Engineering shape, adopted from T3 Code:**

- Contracts live in one package, and every input is validated with zod at the boundary.
- Transports stay thin and orchestration stays pure.
- The core is event-sourced. 🔜 Outward actions will go through a **transactional outbox**: the intent is recorded atomically with its events and executed afterwards with an idempotency key and a receipt, so a retry never sends twice.

## 8½. Sandbox hosts ✅

Any node with Docker is a **sandbox host**; ultra is the first. A sandbox is where a squire works: one hardened container per task, created in seconds and discarded afterwards.

| Property | How |
|---|---|
| **Unprivileged** | uid 1000, `--cap-drop ALL`, `no-new-privileges`, read-only root, tmpfs `/tmp`, its own workspace volume. No host mounts and no Docker socket. |
| **Bounded** | CPU, memory (no swap) and process limits. Every command runs under an in-container `timeout --signal=KILL`, so a stuck task can't outlive its deadline. |
| **Networked by intent** | `isolated`: no network. **`gateway`** (the default): a Docker `--internal` network whose only reachable host service is a sandbox-only model gateway on the bridge IP. UFW allows exactly one port on `galahad0`. `online`: egress plus the gateway. Sandboxes can't reach each other: inter-container traffic is disabled on both networks. |
| **Keys stay home** | A sandbox that may use models gets a gateway token scoped to the providers you chose. It expires with the sandbox and is revoked on destroy. The sandbox never holds a provider key. |
| **Accountable** | Every create, exec and destroy is a signed `ledger.recorded` event in the mind, readable from any device (`galahad ledger`). |
| **Oath-gated cleanup** | The TTL reaper may destroy *ephemeral* sandboxes on behalf of the quest that created them. Destroying a *persistent* sandbox asks first. A request from you counts as the approval. |
| **Fleet-wide** | `galahad sandbox run -- …` on any device is placed on the best sandbox host, or pinned with `--on ultra`. It's forwarded as a signed node-to-node request. A forwarded request always runs where it lands, so work can never bounce between nodes. |

Network reachability was verified on ultra before it was built. From an internal-network container, the gateway port is reachable only once the UFW rule exists. The internet, Coolify (8080) and Galahad's local port (7777) all stay blocked. 🔜 Next: KVM microVMs for code we have no reason to trust, per-sandbox disk quotas, and an egress allowlist for `online`.

## 8¾. A mind for every arm (MCP) ✅

`galahad mcp` is an MCP server (official SDK, stdio) that any agent harness launches next to a node. It talks to that node over loopback using an **arm token**.

| Property | How |
|---|---|
| **Least privilege** | Arm tokens hold `mind:read`, `mind:write`, `sandbox`, `vault:read` (names only) and `chat`. `vault:write`, `fleet:admin`, `gateway:mint` and `brain:write` are refused at mint time. The token works on loopback only, is stored as a hash and is revoked instantly with `galahad arms revoke`. |
| **Provenance** | Memories written through an arm are `agent`, or `untrusted` when they come from the web, files or other people. They're never `owner`, and the arm's label is recorded as their source. |
| **Contained** | Every sandbox an arm creates belongs to the quest `arm.<label>` and is always ephemeral. The arm can execute in and clean up only those. That holds across nodes too: forwarding relays the quest, never your approval. |
| **Asks, never sees** | `request_secret` files a request you fill in the vault; the agent never sees the value. Keys pasted into `remember` are refused. |

Tools: `recall`, `remember`, `fleet`, `place`, `sandbox_run` / `create` / `exec` / `destroy`, `ledger`, `request_secret`. Resource: `galahad://oath`. Server instructions tell the agent when to use each. A real MCP client exercises this end to end in `packages/node/test/mcp.test.ts`.

## 8⅞. Quests: the first agent loop ✅

`galahad do "<goal>"` runs one quest end to end: **plan → work → independent review → remembered.**

| Stage | How |
|---|---|
| **Plan** | The `planner` role writes a short numbered plan and a "Done when:" line. |
| **Work** | The `engineer` role works in a fresh sandbox on the best sandbox host, with exactly one tool: a shell, one command per turn (after [mini-SWE-agent](https://github.com/SWE-agent/mini-swe-agent)). Any model on the roster can do this, local ones included; no provider's tool-calling API is needed. Each command is a ledgered `execSandbox` under the quest's id. |
| **Review** | When the engineer replies `DONE`, the `reviewer` role (ideally another model family) judges only the evidence: the commands, exit codes and output excerpts. Anything but a clear `PASS` sends the work back with notes, at most twice; after that the outcome is honest: *unverified*. |
| **Remember** | The outcome goes into the mind as an `untrusted` memory tagged `quest`: it's model output shaped by whatever the sandbox read, so it's data, never instructions. |

Guarantees:
- **Secrets never reach a model.** Every message is redacted before any call, including command output; the chat door would refuse them anyway.
- **Bounded.** A step budget (default 30 commands), a per-command time limit (300 s) and two revisions at most. Older observations shrink to excerpts so long quests stay affordable.
- **Contained.** The default network is `isolated`; `--net gateway` or `--net online` is your explicit choice. The sandbox is destroyed afterwards unless `--keep`. Ctrl-C stops after the current step and still cleans up.
- **Outcomes are honest.** `done` (the reviewer passed it), `unverified`, `gave-up` (the engineer says why) or `stopped`.

The loop is pure orchestration (`packages/brain/src/quest.ts`): models, the sandbox and output are injected, so the CLI, a node or a test run the same code. `packages/brain/test/quest.test.ts` scripts every path. Next: quests started from the PWA and MCP, running on the node, with live progress.

## 9. Growth & scale 🔜

Galahad grows by having resources added to him. **Everything is a resource with a capability descriptor in one registry, the mind:**

| Resource | Examples | How it's used |
|---|---|---|
| Compute | Laptops, servers, desktops, Pis | Enrolled nodes; placement routes work to them |
| Intelligence | API providers, local runtimes, every modality: text, vision, image/video/audio generation, speech, embeddings | Roles per modality, with fallbacks and eval scores |
| Credentials | API keys, cloud tokens | The vault, plus brokers that mint scoped, short-lived access |
| Subscriptions | Claude, ChatGPT, Cursor, Grok through their **official CLIs**, logged in on a specific node | Credentials never leave that node, and work needing that subscription is routed there. Each provider's terms are respected. |
| Actuators | Home Assistant, MQTT, ROS 2, OctoPrint | Always in the *ask* class. Interlocks, simulate or dry-run first, rate limits, and never anything that endangers people. |

- 🔜 `galahad add <anything>` detects what it was given, probes it (lists models, test call, latency, cost), runs a calibration eval, and registers it.
- **Scaling the mind:** periodic snapshots, cold segments moved to the blob store, partial replicas on phones. Presence and telemetry never go into the log.

## 10. R2: caches, blobs, backups 🔜

Cloudflare R2 (S3-compatible, no egress fees) is Galahad's shared storage layer.

- **Build cache:**
  - sccache uses its S3 backend with `SCCACHE_BUCKET`, `SCCACHE_ENDPOINT=https://<account>.r2.cloudflarestorage.com` and `SCCACHE_REGION=auto`.
  - Caches get their own bucket.
- **Credentials:**
  - The parent Cloudflare/R2 token lives in the vault and is used only by a **provisioning broker**.
  - Arms receive **R2 temporary credentials** (the API's maximum TTL is 7 days).
  - Prefix scoping is reliable today only via local signing, which is why caches use a separate bucket.
- **Oath applies:**
  - Galahad creates buckets, lifecycle rules and credentials himself.
  - **Deleting needs your approval.** R2 tokens can't separate create from delete, so the broker enforces this.
- **Blob store:** content-addressed and encrypted. Object names are HMAC'd, so R2 never learns content hashes.
- **Backups:**
  - Encrypted, append-only segments of the mind are stored in a bucket with an **R2 bucket lock** (retention), so even a compromised node can't erase them.
  - A **recovery key** is printed once for disaster recovery.

## 11. Roadmap

| Milestone | Scope | State |
|---|---|---|
| **M0: One mind, many bodies** | Log, HLC, replay, sync, pairing, vault, gateway, brain + fallback, placement, oath gate, secret scanning, CLI, PWA (Chat, Memory, Vault, Models, Fleet) | ✅ done (PWA not yet run in a real browser) |
| **M1: Mind for every arm** | `mcp-mind` MCP server, Hermes memory-provider plugin, skills sync, R2 broker, encrypted backups, recovery key | 🔜 |
| **M2: The Round Table** | Quests as task graphs, parallel squires in worktrees and containers, transactional outbox, approvals UI, checkpoint/migrate | 🔜 |
| **M3: Phone** | PWA polish, push-to-approve, share sheet into the mind | 🔜 |
| **M4: Forge, Scout, Trials** | Squire charters and audit, Scout auto-trials, the eval system in [TRIALS](TRIALS.md) | 🔜 |
| **M5: Secure self-update** | Signed releases (your key), provenance, canary node, automatic rollback | 🔜 |
| **M6: No VPN** | Iroh transport, partial replicas, E2E relay | 🔜 |

See also: [OATH](OATH.md) · [TRIALS](TRIALS.md) · [DOCTRINE](DOCTRINE.md) · [GETTING-STARTED](GETTING-STARTED.md)
