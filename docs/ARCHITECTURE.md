# Galahad: architecture

**One mind, many bodies.** Every Galahad instance (laptop, server, phone, a Pi in a closet) is *the same Galahad*. Each one shares the same memory, vault, roster, oath and devices, and they differ only in what their body can do.

> **Status legend:** ✅ built and tested · 🔜 planned (see [Roadmap](#13-roadmap))

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
   │ serve (HTTPS)        │   │ sandboxes, local models, loops     │
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
| `ledger.recorded` | Every gated action, its verdict and why |
| `loop.set` / `loop.removed` / `loop.ran` | Loops (LWW by name) and each run, recorded by the node that ran it |
| `notice.raised` / `notice.cleared` / `notice.dismissed` | What needs you (LWW by key) |
| `connector.set` / `connector.removed` | Connector manifests (LWW by id) |
| `action.requested` / `action.decided` / `action.done` | The outbox: an action the oath asks about, your answer (the first one stands), the receipt (once, from the node that asked) |
| `investigation.registered` / `investigation.concluded` | A pre-registration (with its digest, checked by every replica) recorded before anything ran, and its conclusion, once, by the node that ran it |
| `trial.scored` | A graded trial: problem, seed, each answer against the exact one, the score, the revision and models that ran it. Every replica checks the verdicts and the score follow from the numbers |
| `artifact.saved` / `artifact.removed` | Work kept from a sandbox: what the files are (paths, sizes, SHA-256s); the files stay on the node that signed it, and only it records their removal |
| `order.set` / `order.revoked` / `order.applied` | Standing orders: signed once and never changed (revoke and sign anew); which order answered which action, re-checked by every replica |

Open-ended parts of an event (a loop's task, a connector's manifest, a call's arguments) are loosely typed in the log and strictly validated by the API and the runner, so what a newer node writes never makes an older one refuse the event.

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
| `decider` | *none until you hire one*, e.g. `cloudflare-ai/typesafe/jev` | low |

The **decider** is a different kind of model: TypeSafe's System One (Jev) answers typed questions about a state (yes/no, a choice among named options, a score on an ordered rubric) with calibrated probabilities instead of text (`galahad decide`, the `decide` route, MCP `decide`). Through Cloudflare AI Gateway it goes to Cloudflare's unified `ai/run` for your account, your gateway named in `cf-aig-gateway-id` and TypeSafe's key stored with Cloudflare; the gateway token, pinned to `gateway.ai.cloudflare.com`, may go to that one route as well, a route fixed in code. With a TypeSafe key of your own it goes to `https://api.typesafe.ai/v1/systemone`.

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
| `cloudflare-ai` | openai | *Your gateway: `https://gateway.ai.cloudflare.com/v1/<account id>/<gateway id>/compat`. The key is the gateway's token, sent as `cf-aig-authorization` (never as `Authorization`, so Cloudflare adds the provider keys you stored with it); models are `<provider>/<model>`, e.g. `deepseek/deepseek-chat`* |
| `ollama`, `llamacpp` | openai (local) | `http://127.0.0.1:11434/v1`, `http://127.0.0.1:8080/v1` |

- **Anthropic** goes through the official SDK with adaptive thinking, explicit effort and streaming. Server-side refusal fallback (`fallbacks: "default"`) is enabled on the models that support it (Fable 5.1, Opus 5.5, Opus 5, Sonnet 5.5).
- **Everything else** uses OpenAI-compatible streaming.
- **Fallback chain:** a model that fails *before* producing text is skipped (missing key, outage, rate limit, refusal), and the next model answers. Each skip is reported to the client.
- **Persona and context:** the standing persona prompt is byte-stable, so it caches well. Relevant memories are appended after it, labelled with their trust level.

**One Galahad on every surface.** Chat in the PWA and `galahad ask` have the same tools agents get over MCP (§8¾), defined once in `packages/node/src/tools.ts`:

| | How |
|---|---|
| **The loop** | `chat()` in `packages/brain/src/chat.ts`: the model calls tools in rounds (at most 12), sees each outcome, then answers. The client gets `tool` and `tool_result` events between the text. Anthropic goes through the SDK's tool use: thinking blocks go back with their signatures, and a refusal never runs that turn's tools. OpenAI-compatible providers use function calling, and DeepSeek's reasoning goes back within the loop. A runtime without tools (some local models) answers without them. A model that fails before anything happened falls back to the next; after a tool ran, a failure ends the answer, so nothing is repeated. |
| **Who acts** | In chat, Galahad runs his tools as the agent `galahad`, with the caller's scopes minus what agents may never hold (`vault:write`, `fleet:admin`, `gateway:mint`, `brain:write`). So his memories are `agent`, his sandboxes are his own, and outward or destructive calls are filed for your approval exactly as an agent's are. No agent can be minted under that name. An agent that calls chat keeps its own powers. |
| **Same checks** | The tools reach the node through the same routes as over HTTP, in process: the route's scope, zod validation of the input, the handler. The model's arguments are checked against the tool's schema before anything runs. |
| **The bank** | Offered only when the caller holds `bank:read`. Once bank data is in an answer, tools that can carry data out (`web_search`, `connector_call`, `sandbox_run`, `sandbox_exec`, `decide`) are refused for the rest of it. |
| **Long answers** | An answer cut off by the model's output limit goes on where it stopped (up to 3 times; some providers' default limit is short), and says so if it still didn't finish. A tool result over 30,000 characters is cut with a note that tells the model to ask for less (a filter, a narrower range, the next page). |
| **Quests** | Their roles keep their own tools (the workshop's shell, the reviewer's reading): they ask for chat without tools (`tools: false`). |

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

The gate decides every connector call (§10), and its questions wait for you in the inbox. **Standing orders** (§10) are answers you give in advance: one tool, narrowed arguments, an expiry, signed into the mind and checked again by every replica. 🔜 The gate on git pushes made inside sandboxes is M2.

**Engineering shape, adopted from T3 Code:**

- Contracts live in one package, and every input is validated with zod at the boundary.
- Transports stay thin and orchestration stays pure.
- The core is event-sourced. Outward actions go through a **transactional outbox** (§10): the intent is recorded in the mind before anything is sent, the send is marked locally before it goes out, and the receipt is recorded afterwards, so a retry never sends twice.

## 8½. Sandbox hosts ✅

Any node with Docker is a **sandbox host**; ultra is the first. A sandbox is where a squire works: one hardened container per task, created in seconds and discarded afterwards.

| Property | How |
|---|---|
| **Unprivileged** | uid 1000, `--cap-drop ALL`, `no-new-privileges`, read-only root, tmpfs `/tmp`, its own workspace. No other host path and no Docker socket. |
| **Bounded** | CPU, memory (no swap), process and **disk** limits. `/work` is the sandbox's own fixed-size ext4 image (20 GB by default; sparse, so it takes only what's written), so a runaway job fills its own workspace, never the host's disk. Every command runs under an in-container `timeout --signal=KILL`, so a stuck task can't outlive its deadline. |
| **Its own kernel, for untrusted code** | On a host with KVM, a sandbox can be a **microVM**: the same hardened container inside its own lightweight virtual machine with its own kernel ([Kata Containers](https://katacontainers.io)), so a kernel exploit lands in a throwaway VM, not on the host. `online` sandboxes (code and content from the internet) are microVMs by default wherever the host has them; you can choose either for any sandbox (`--vm`, `--container`). |
| **Networked by intent** | `isolated`: no network. **`gateway`** (the default): a Docker `--internal` network whose only reachable host service is a sandbox-only model gateway on the bridge IP. UFW allows exactly one port on `galahad0`. `online`: egress plus the gateway. Sandboxes can't reach each other: inter-container traffic is disabled on both networks. |
| **Keys stay home** | A sandbox that may use models gets a gateway token scoped to the providers you chose. It expires with the sandbox and is revoked on destroy. The sandbox never holds a provider key. |
| **Accountable** | Every create, exec and destroy is a signed `ledger.recorded` event in the mind, readable from any device (`galahad ledger`). |
| **Oath-gated cleanup** | The TTL reaper may destroy *ephemeral* sandboxes on behalf of the quest that created them. Destroying a *persistent* sandbox asks first. A request from you counts as the approval. |
| **Fleet-wide** | `galahad sandbox run -- …` on any device is placed on the best sandbox host, or pinned with `--on ultra`. It's forwarded as a signed node-to-node request. A forwarded request always runs where it lands, so work can never bounce between nodes. |

Network reachability was verified on ultra before it was built. From an internal-network container, the gateway port is reachable only once the UFW rule exists. The internet, Coolify (8080) and Galahad's local port (7777) all stay blocked.

**Disk.** Mounting a workspace image needs root, and the node has none: its service runs with `NoNewPrivileges` and a read-only view of the system. So `deploy.sh --sudo` installs a small root helper, `galahad-workspace` (in `sandbox/`), that systemd starts once per connection on `/run/galahad-workspace.sock`, a socket only the galahad user may open. It accepts four commands (create, remove, stats, ping), takes nothing but a 10-hex-digit id and a size, and builds every path itself under a root-only directory. An unmounted mountpoint is mode 000, so a container started without its workspace can't write to the host's disk through it. A **budget** guards the host: a sandbox is created only if every workspace could still fill up to its limit and 10 % of the disk (at least 20 GB) would stay free. Without the helper, workspaces are unlimited Docker volumes, and the heartbeat says so.

**The image stays.** Coolify's nightly cleanup prunes every image no container uses, and it took the sandbox image once. A stopped keeper container (`galahad-sandbox-image`) now keeps it in use, and a sandbox that finds the image missing anyway rebuilds it rather than failing its quest.

**MicroVMs.** `deploy.sh --sudo` installs Kata Containers on a host with `/dev/kvm`: a pinned release whose SHA-256 is checked against the digest GitHub records for it. Docker reaches Kata's shim by name (`--runtime io.containerd.kata.v2`, found on containerd's `PATH`), so Docker's configuration is never edited and nothing restarts: Coolify doesn't notice. Every flag above still applies inside the VM, and three Kata settings harden it further: the guest enforces each sandbox's seccomp filter, QEMU runs under its own seccomp sandbox, and QEMU runs as an unprivileged random user, never root. If a newer Kata changes its configuration so these can't be applied, microVMs stay off rather than run weaker. Two details make the networks work: an online sandbox joins both of its networks when it starts (a VM can't be given one later), and since Docker's DNS lives on the host side, an online microVM gets a read-only `resolv.conf` with the host's upstream resolvers. Measured on ultra: a microVM sandbox is ready in about 1.7 s, with 2 GB of memory and one vCPU on top of its limits.

**The Lab.** A second image, `galahad/lab:1` (`sandbox/lab/`), for mathematics, physics and engineering, under the same hardening as every sandbox. The heavy compiled stacks come from Debian so their ABIs agree: SciPy, SymPy, statsmodels, FEniCSx with PETSc and MPI, gmsh, OpenFOAM, ngspice, Octave, Maxima, Z3. Pinned wheels add the rest without shadowing Debian's numpy: build123d on OpenCascade, MuJoCo, CoolProp, Cantera, OpenSees, scikit-fem, python-control, cvxpy, Pint, uncertainties and SALib. `lab-check` proves every tool against a known answer before anyone relies on it: a Poisson solve against its analytic peak, the cantilever deflection PL³/3EI, free fall, an RC time constant, an adiabatic flame temperature, water's density, the lid-driven cavity. All 20 pass on ultra with a read-only root, no capabilities and no network. `--lab` (or `lab: true`) gives a sandbox or quest the Lab. Deploys build it (7 GB, the first time takes a while) and a keeper holds it like the workshop image.

**Artifacts.** A sandbox is disposable; its results aren't. Whatever a quest writes to `/work/out` (reports, plots, data, CAD files, code) is kept when the quest ends, and `galahad sandbox save` (MCP `sandbox_save`) keeps any directory under `/work` of any sandbox. The node copies it out with `docker cp` (container or microVM alike) through its own tar parser, which treats the sandbox as hostile: only regular files and directories land; links, devices and FIFOs are refused; no path may climb out; bytes and file count are capped while streaming (512 MB, 5,000 files; 20 GB per node). Each file is hashed as it's written. The files stay on that node; an `artifact.saved` event records what they are (paths, sizes, SHA-256s), so every device sees them and can fetch them from the holding node, checked against their hashes (`galahad artifact <id> --out dir`). Only files the manifest lists are ever served, HTML and SVG as their source, never rendered, with `CSP: sandbox`. Removing kept work is yours alone, and only the node holding the files can record that they're gone.

🔜 Next: an egress allowlist for `online`.

## 8¾. A mind for every arm (MCP) ✅

`galahad mcp` is an MCP server (official SDK, stdio) that any agent harness launches next to a node. It talks to that node over loopback using an **arm token**.

| Property | How |
|---|---|
| **Least privilege** | Arm tokens hold `mind:read`, `mind:write`, `sandbox`, `vault:read` (names only) and `chat`. `vault:write`, `fleet:admin`, `gateway:mint` and `brain:write` are refused at mint time. The token works on loopback only, is stored as a hash and is revoked instantly with `galahad arms revoke`. |
| **Provenance** | Memories written through an arm are `agent`, or `untrusted` when they come from the web, files or other people. They're never `owner`, and the arm's label is recorded as their source. |
| **Contained** | Every sandbox an arm creates belongs to the quest `arm.<label>` and is always ephemeral. The arm can execute in and clean up only those. That holds across nodes too: forwarding relays the quest, never your approval. |
| **Asks, never sees** | `request_secret` files a request you fill in the vault; the agent never sees the value. Keys pasted into `remember` are refused. |

Tools: `recall`, `remember`, `web_search`, `decide`, `fleet`, `place`, `sandbox_run` / `create` / `exec` / `destroy` / `save`, `artifacts`, `artifact_read`, `ledger`, `request_secret`, `connectors`, `connector_call`, `loops`, `notices`, and the four bank tools for an agent granted `bank:read`. They're Galahad's own tools (`packages/node/src/tools.ts`), the same ones his chat uses (§6); each names the routes it calls, and an agent is offered the tools whose routes' scopes it holds. Resource: `galahad://oath`. Server instructions tell the agent when to use each. A real MCP client exercises this end to end in `packages/node/test/mcp.test.ts`.

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
- **An outage isn't the end.** A model call that fails (a provider down, a reply cut off mid-stream, which the roster can't fall back from) is asked again after 15 s, 60 s and 3 minutes; only then does the error stand.

### Coding agents: stamina for real codebases ✅

`galahad do --agent opencode "<goal>" [--minutes 60] [--repo https://…]` keeps the plan and the independent review, and hands the work to a full coding agent: **OpenCode** (v2.2.6, pinned and checksummed in the workshop image), with its own file viewer and editor, search and shell, working for up to `--minutes` instead of one command per turn.

| | How |
|---|---|
| **Models** | The agent calls models itself, through Galahad's gateway: the engineer's models on OpenAI-compatible providers with a key, in the roster's order, on a token scoped to those providers and to the sandbox's lifetime. It never sees a key. If a model fails (an outage, a provider's content filter), the next carries on the same session. |
| **Runs long** | It runs headless in the background inside the sandbox (its own process group, stdin closed), so no single command's time limit applies; Galahad follows its event stream every 10 s, so every command and edit it makes appears as it happens. Past `--minutes`, or on Ctrl-C, its whole process group is stopped. |
| **Reviewed** | When it ends, the `reviewer` judges its work from the sandbox (`git status` and `git diff --stat`, what's in `/work/out`) and its last 40 commands. A REVISE continues **the agent's own session** with the notes, at most twice. |
| **Kept** | With `--repo`, the repository is cloned first (`--net online`) and its changes are kept as `/work/out/changes.patch`, new files included, in the quest's artifact. |

The driver is pure orchestration over `exec` (`packages/brain/src/agents.ts`), tested against OpenCode's real event stream and a fake sandbox. Claude Code joins once there's an Anthropic key in the vault.

### Shipping: pull requests through the oath gate ✅

A sandbox never holds a GitHub key. It **reads** through the node's **git gateway**: a quest on a GitHub repository (private ones included) clones `http://<gateway>/git/<connector>/<owner>/<repo>.git` with a token minted for that one repository for the quest's lifetime; the node adds the connector's key on the way to `github.com` (a host fixed in code, never a manifest's say), serves git's smart HTTP **fetch only**, ledgers the read, and revokes the token when the quest ends. The clone's `origin` points back at GitHub and keeps no credential. It **can't push**: instead a quest on a clone (`--repo`) leaves a **shipment** in its kept work: `ship/manifest.json` (the commit it started from, the remote, each changed file's path and mode, deletions) and `ship/files/…` (the new contents), beside `changes.patch` for reading.

`github.ship` is a **native tool** of the GitHub connector: one outward action, carried out by the node itself. When you approve it (or a standing order does), the node, with the connector's key on its pinned origin (`api.github.com`), uploads each file as a blob, builds one tree on the starting commit, commits it, creates a **new** `galahad/…` branch (one that exists is never touched) and opens the pull request; the receipt in the mind names the PR. Every file is checked against the SHA-256 recorded when it was kept before it leaves.

| | |
|---|---|
| `galahad do --agent opencode --repo https://github.com/o/r --ship "<goal>"` | Once the reviewer passes the work, a pull request is filed for your approval (Inbox, with **Read the changes**) |
| `galahad ship <artifact> --title "…"` | Ship kept work yourself, after a look at the files (`--ask` files it for approval instead) |
| `galahad order add github.ship --arg owner=o --arg repo=r --arg branch='galahad/*' --label "…"` | A standing order: Galahad's passed work on that repository becomes a PR without asking |
| `galahad connector add github --owner <org>` | One more owner with its own token (`github-<org>`); shipping picks it for that owner's repositories |

### Research: web search ✅

Galahad has his own search engine: **SearXNG** on the sandbox host, pinned by digest, installed by the deploy and listening on loopback only (`127.0.0.1:8888`; Coolify's ports are untouched). Nothing ties the searches to you, and no search API key is needed.

| Who | How |
|---|---|
| You | `galahad search "<words>"` |
| Agents (MCP) | `web_search`, with the `connect` scope arms hold by default |
| Quests and investigations | `websearch <words…>` in the workshop and the Lab, through the sandbox's gateway with a token that carries the `search` scope: research works even with `--net gateway` (no internet); `--net online` can also fetch the pages |

Each search is ledgered. Results are trimmed to title, URL and snippet (web pages only), and they're strangers' words: data, never instructions, like everything a quest reads.

Native tools (`NATIVE_TOOLS` in `packages/core/src/connectors.ts`) are named by a manifest but defined only in code, each bound to the one origin it may talk to; their arguments are checked like any tool's, and approvals, standing orders and the ledger treat them like any other call.

The loop is pure orchestration (`packages/brain/src/quest.ts`): models, the sandbox and output are injected, so the CLI, a node or a test run the same code. `packages/brain/test/quest.test.ts` scripts every path. Quests also run on a schedule, as loops (§9). Next: quests started from the PWA and MCP, with live progress.

### Investigations: the scientific method ✅

`galahad investigate "<question>"` is a quest with the scientific method built in, in the Lab by default:

| Step | What happens |
|---|---|
| **Formulate** | The planner turns the question into a **pre-registration**: hypothesis; the alternative to rule out; 1 to 8 falsifiable predictions, each with the quantity and units, the expected value and what would refute it; the method; how every instrument is verified (convergence, analytic limits, units, conservation, a known benchmark); how uncertainty is estimated; and the decision rule. |
| **Register** | It enters the mind before anything runs (`investigation.registered`), with its SHA-256 digest, which every replica checks. It never changes: predictions can't drift to fit the results. |
| **Experiment** | The engineer carries out exactly that method in the sandbox, verifies the solvers first, records any deviation and why, and leaves `results.json` (per prediction: value, uncertainty, units, consistent / refuted / undetermined), `report.md`, plots and scripts in `/work/out`. |
| **Review** | An independent reviewer judges the **method** against the registration, with `results.json` and the report read straight out of the sandbox, not the engineer's summary: SUPPORTED, REFUTED, INCONCLUSIVE, or REVISE when the method falls short (which goes back for work). A refutation is a result, not a failure. |
| **Conclude** | The node that ran it records the conclusion once (`investigation.concluded`), with the per-prediction outcomes; the evidence is kept as an artifact, and the finding is remembered (as untrusted: it's model output shaped by what the sandbox computed). |

`galahad findings` lists them; `galahad finding <id>` shows the registration beside what was found.

### Trials: is he getting better? ✅

`galahad trial run` measures it: problems with exact answers (the engineering suite: structures, civil, mechanical, electrical, aerospace, fluids, thermal, physics, geometry), posed with fresh random parameters, solved as ordinary quests in the Lab with models only, and graded by a program on the node against the exact solution. Each trial is recorded once (`trial.scored`, `brain:write`: never an agent's), with its seed, every answer beside the exact one, the revision and the models; every replica checks that the verdicts and the score follow from the numbers. A run's mean score with its bootstrap interval is the Galahad Index. Details, the problems and how the suite itself was verified: [TRIALS](TRIALS.md).

## 9. Loops and the heartbeat ✅

A **loop** is work Galahad does on a schedule: `every 30m` (aligned to the clock) or a five-field cron line read in an IANA time zone (`0 7 * * 1-5` in `Europe/Copenhagen`). Loops live in the mind, so every device sees them and their history, and each names **exactly one node** that runs it, so a loop never runs twice.

| Task | What a run does |
|---|---|
| `heartbeat` | Galahad's regular look around (below) |
| `quest` | A quest in a fresh sandbox (§8⅞), through a short-lived **arm token**: its sandboxes are its own and ephemeral, its memories are `untrusted`, and it can't touch the vault, devices or the roster |
| `call` | One connector tool (§10). A loop is Galahad acting on his own, never you, so an outward or delete tool files an approval request instead of running |

| Guarantee | How |
|---|---|
| **At most once per slot** | A run is marked in node-local storage before it starts and recorded in the mind (`loop.ran`) when it ends. A crash in between is recorded as *interrupted* on the next start and never rerun. |
| **No pile-ups** | A node that was away runs a missed loop once (looking back a week at most), not once per missed slot. At most two runs at once per node; a run past its deadline (2 h) is stopped. |
| **Honest history** | Every run's status (`ok`, `attention`, `failed`, `interrupted`) and a redacted summary are signed events, readable from any device (`galahad loop runs`). A run that fails or needs a look also leaves a notice (one per loop), cleared by its next good run, so a loop that calls a connector is a monitor. |
| **Bounded** | Defining, changing or running a loop needs `brain:write`, which arms never hold. Loop text is scanned for secrets before it's written. |

**The heartbeat** is a built-in loop: the fleet's founding node creates it once (every 30 minutes, on an always-on node) and never again, so if you remove it, it stays removed. Its checks are cheap and deterministic, and a pure function of a snapshot (`assess` in `packages/node/src/heartbeat.ts`), so every rule is tested exactly:

| Check | Severity |
|---|---|
| An always-on node (Linux, no battery) silent for 10 minutes; Windows and macOS machines come and go and aren't flagged | warn |
| This node can't open the vault | alert |
| A device signed two histories (equivocation: its key may be stolen) | alert |
| A role with no usable model (no key, no running local runtime) | warn for planner, engineer, reviewer; info for others |
| A sandbox the reaper missed; a loop that's orphaned or failed three times running | warn |
| This node hosts sandboxes without disk limits; its sandbox image is missing; it has KVM but no microVMs | warn / info / info |
| A connector whose key is missing or pinned elsewhere; a manifest that no longer validates | info / warn |
| A standing order whose tool changed since you signed it; one that expires within 3 days | warn / info |
| Low disk on this node | warn, alert under 3 % |

Findings become **notices** in your inbox, keyed so the same problem never repeats. A notice clears itself when its cause goes away, a dismissed one stays quiet until it changes, and an unchanged finding writes nothing. Notices about one node's body (its disk, its vault) are only cleared by that node. Optionally, a **checklist** you write is read by the `swift` role each beat with the findings and recent activity (as data); it answers `HEARTBEAT_OK`, or two or three lines for you, which become a notice.

## 10. Connectors and the approval outbox ✅

A **connector** is how Galahad reaches a service you use. It's a **manifest, not code**: one pinned origin, the vault secret it authenticates with, and a set of tools, each one HTTP request template plus its oath class.

```json
{ "id": "github", "origin": "https://api.github.com", "auth": { "secret": "github", "scheme": "bearer", "optional": true },
  "tools": { "issues": { "method": "GET", "path": "/repos/{owner}/{repo}/issues", "class": "read", "params": { … } },
             "issue.create": { "method": "POST", "path": "/repos/{owner}/{repo}/issues", "class": "outward", "params": { … } } } }
```

| Property | How |
|---|---|
| **No connector code runs** | A tool call becomes exactly one request to the pinned origin. Arguments are typed and checked (enum, pattern, integer), fill their path segment URL-encoded (`..` refused), the query or a JSON body, and the built URL is checked against the origin again. |
| **Keys stay home** | The node injects the key on the way out, and only if the vault pinned it to *this origin* and it was entered *for this connector*, so a manifest can't borrow another service's key. Redirects are never followed. Answers are capped at 512 KB and redacted of the key and anything secret-shaped. Arguments that look like keys are refused. |
| **The method bounds the class** | GET reads (or is outward); DELETE deletes; POST/PUT/PATCH create, modify, are outward or delete. A manifest can never set `Authorization`, cookies or `Host`. |
| **Asks for its key** | A call that needs a missing key files a secret request; you fill it from any device. |

Every call goes through the oath gate and into the ledger:

| Class | You ask | An agent asks (arm, loop, quest) |
|---|---|---|
| read, create, modify | runs | runs |
| outward, delete | runs: your request *is* the approval | an **action request** in your inbox; nothing is sent |

**The outbox.** An action request (`action.requested`) is recorded in the mind before anything is sent. You approve or decline from any device (`fleet:admin`; never a node or an agent on its own behalf), and **the first decision stands** on every replica. Only the node that filed the request sends it: it marks the send in local storage first, sends once, and records the receipt (`action.done`). If it dies mid-send it reports *outcome unknown* and never retries. No answer within 24 hours means no.

Built in (`galahad connector add <id>`): **GitHub** (repos, issues, pulls, Actions runs, notifications; creating a branch is free, opening an issue or commenting asks), **Cloudflare** (accounts, zones, DNS, Workers, R2; creating a bucket is free, deleting one asks) and **Home Assistant** (at your address; reading state is free, calling any service asks every time). Your own connector is a JSON manifest: `galahad connector add --manifest my.json`.

Coding agents use connectors through MCP (`connectors`, `connector_call`) with the `connect` scope, which arm tokens hold by default. They never see a key, and an outward call returns an action id instead of a result.

**Remote MCP servers.** A connector can also be an MCP server you reach over streamable HTTP (`galahad connector add <id> --mcp https://…/mcp`). The node is the MCP client:

| Property | How |
|---|---|
| **Listed once, by you** | Installing (or refreshing) lists the server's tools and stores them in the manifest: each tool's arguments, summarized from its schema, and a digest of the server's definition. Agents see the stored tools, not whatever the server says today, and a refresh reports what changed. |
| **Your classes** | The server's hints only *propose* a class: read-only → read, destructive → delete, anything else → **outward**, which asks you. You choose (`--class tool=read`), and your choice survives refreshes. |
| **Same fences** | Every request stays on the pinned origin, redirects are refused, answers are capped and redacted, the key is injected only if pinned to that origin for that connector, and a URL with a query or credentials in it is refused (keys go in the vault). The client declares no capabilities, so a server can't ask Galahad to run a model, list files or prompt you. |
| **Same outbox** | An outward MCP call is an action request like any other: approved once, sent once, receipt recorded. A server that needs a key installs without tools and asks for the key; refresh once it's in. |

**Standing orders.** Some things you'd approve every time: pull requests from `feat/*` branches of your repos, release notes to one channel, re-creating one scratch bucket. A standing order is that answer given in advance (`galahad order add`, or **Approve and allow similar** in the inbox):

| Rule | Why |
|---|---|
| One connector tool, and only tools that would ask (outward, delete) | The rest need no order |
| Arguments narrowed with patterns (`*` = any run of characters); every path parameter named and at least one pinned exactly | An order says *where*, never "anywhere" |
| A delete names exactly one thing: no `*` anywhere, every required argument pinned | "Never delete without approval" keeps its meaning |
| Optionally only for some callers (`claude-code`, `loop.release`) | Least privilege for agents and loops |
| Expires, at most a year out; you can revoke it any time | Orders are scoped narrowly and expire ([OATH](OATH.md)) |
| Pinned to the tool as you signed it (a digest of origin, path and parameters) | If the connector's tool changes, the order stops applying and the heartbeat says so |

A covered call is still filed as an action, so it's in your inbox and the ledger. The node that filed it records which order answered it (`order.applied`), and **every replica checks again on replay** that the order existed, was unrevoked and unexpired at that moment, and covers that exact call, before it counts as approved. Only you sign orders (`fleet:admin`, from a terminal or a paired device); agents and nodes never can.

## 10½. The bank, read-only ✅

Your own accounts' balances and transactions, through Enable Banking (PSD2 account information only), for the agents you choose. Setup, the threat model and what couldn't be verified: [BANK](BANK.md).

| Part | Where | What it does |
|---|---|---|
| Client | `packages/node/src/bank/eb-client.ts` | Signs each request with a fresh RS256 JWT (`kid` = your application, 10 minutes), reading the key only to sign. Only `https://api.enablebanking.com` and an allowlist of 7 method and path pairs (no payments), redirects refused, a timeout and a size cap. Errors keep the status and the error code, never the body |
| Service | `packages/node/src/bank/service.ts` | Checks the files' modes and owner before anything; authorising (state, 89 days or the bank's cap) and completing (single use, hashed state, 15 minutes); the account allowlist; the cache (1 h balances, 6 h transactions); a budget of 4 bank fetches per account in any 24 hours; 6 hours' pause on a 429; `reauthorization_required` for an ended consent; the audit log |
| Shaping | `packages/node/src/bank/sanitize.ts` | A fixed output shape; text cleaned of control, bidirectional and zero-width characters and cut to 200 characters; everything wrapped as `untrusted_data` |
| Routes | `packages/core/src/api.ts` | `bankStatus`, `bankAccounts`, `bankBalances`, `bankTransactions` need `bank:read`; `bankConnect`, `bankComplete`, `bankDisconnect` and `grantArm` need `fleet:admin`, which agents never hold |
| Agents | `packages/node/src/mcp.ts` | `bank_status`, `bank_accounts`, `bank_balances`, `bank_transactions`, offered only to an arm granted `bank:read` (`galahad arms grant <agent> bank:read`, or the Bank page) |
| You | PWA **Bank**, `galahad bank …` | Connect and re-authorise (the bank returns to `/bank/callback`, which the PWA finishes), disconnect, who may read; the heartbeat warns 7 days before the consent ends |

No bank data enters the mind: the session, the cache and the audit log are files of the node that holds the bank, not events. Nothing about your accounts replicates (only the heartbeat's reminders become notices), and convergence is untouched.

## 11. Growth & scale 🔜

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

## 12. R2: caches, blobs, backups 🔜

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

## 13. Roadmap

| Milestone | Scope | State |
|---|---|---|
| **M0: One mind, many bodies** | Log, HLC, replay, sync, pairing, vault, gateway, brain + fallback, placement, oath gate, secret scanning, CLI, PWA (Chat, Memory, Vault, Models, Fleet) | ✅ done (the PWA paired and ran in headless Edge, November 2026) |
| **M1: Mind for every arm** | `mcp-mind` MCP server, Hermes memory-provider plugin, skills sync, R2 broker, encrypted backups, recovery key | 🔜 |
| **M1½: Rhythm and reach** | Loops (scheduled quests, connector checks), the heartbeat and notices, connectors with the approval outbox, remote MCP servers as connectors, signed standing orders, sandbox disk limits, KVM microVM sandboxes | ✅ |
| **M2: The Round Table** | Quests as task graphs, parallel squires in worktrees and containers, the gate on every arm's outward actions, checkpoint/migrate | 🔜 |
| **M3: Phone** | PWA polish, push-to-approve, share sheet into the mind | 🔜 |
| **M4: Forge, Scout, Trials** | Squire charters and audit, Scout auto-trials, the eval system in [TRIALS](TRIALS.md) | 🟡 the engineering suite and the Galahad Index ✅; Scout, judges, held-out sets 🔜 |
| **M5: Secure self-update** | Signed releases (your key), provenance, canary node, automatic rollback | 🔜 |
| **M6: No VPN** | Iroh transport, partial replicas, E2E relay | 🔜 |

See also: [OATH](OATH.md) · [TRIALS](TRIALS.md) · [DOCTRINE](DOCTRINE.md) · [GETTING-STARTED](GETTING-STARTED.md)
