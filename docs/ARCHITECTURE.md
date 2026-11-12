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
  - An event that arrives out of order triggers a deterministic replay, unless a replay would apply it the same way (a late ledger entry or loop run from a sound chain, see Sync).
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
| `device.scoped` | Changes what a paired client may do (full nodes are always owner-equivalent) |
| `fleet.chained` | A fleet founded before hash chains adopts them once: exactly the events it lists stay valid unchained, no others ever |
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
| `project.set` / `project.removed` | Projects (LWW by id): a name, your instructions, an optional repository (§10¼) |
| `action.requested` / `action.decided` / `action.done` | The outbox: an action the oath asks about, your answer (the first one stands), the receipt (once, from the node that asked) |
| `investigation.registered` / `investigation.concluded` | A pre-registration (with its digest, checked by every replica) recorded before anything ran, and its conclusion, once, by the node that ran it |
| `trial.scored` | A graded trial: problem, seed, each answer against the exact one, the score, the revision and models that ran it. Every replica checks the verdicts and the score follow from the numbers |
| `trial.run` | A trial run's settings (its effort: attempts per trial), recorded once before its first trial by the node that runs it; the first stands. The Index per effort level reads it (§8⅞) |
| `compute.calibrated` | A node's own measurement of itself (§11): whose it is, is who signed it; its latest stands |
| `compute.limit` | Your ceiling for one node: threads, memory, sandboxes and model calls he may use there at once (the latest stands; empty: the defaults again) |
| `compute.policy` | How he spends compute on a quest: the level `auto` may reach and the day's budget of extra attempts (the latest stands) |
| `compute.adapted` | His defaults, re-derived when the fleet's compute changed, and what changed, a line each (the latest stands) |
| `artifact.saved` / `artifact.removed` | Work kept from a sandbox: what the files are (paths, sizes, SHA-256s); the files stay on the node that signed it, and only it records their removal |
| `order.set` / `order.revoked` / `order.applied` | Standing orders: signed once and never changed (revoke and sign anew); which order answered which action, re-checked by every replica |
| `companion.named` / `companion.unnamed` | His dog's name, as you gave it (LWW, full nodes only; §9) |

Open-ended parts of an event (a loop's task, a connector's manifest, a call's arguments, what a calibration measured, a ceiling, a plan) are loosely typed in the log and strictly validated by the API and the runner, so what a newer node writes never makes an older one refuse the event.

**Sync:**

- Each device's events form an HLC-ordered prefix on every replica. A peer's **frontier** (the highest HLC per device) therefore fully describes what it has.
- `eventsSince(frontier)` returns exactly the missing events, a page at a time (500).
- Nodes pull from every peer independently every few seconds, and also push fresh events immediately.
- **Holes below the frontier** (an event that reached only some replicas, a partial delivery) are found by comparing **set hashes**: with each pull goes, per device, how many events this replica holds and an LtHash of their ids (`packages/core/src/set-hash.ts`: 1024 lanes of 16 bits, ChaCha20-expanded, the parameters analysed for 200+ bits of security; a plain XOR or sum would let a forked device hide behind a matching hash). The peer takes its own hash, removes what's above the frontier, and compares. If it holds a different set there and at least as much, it names the device in `repair`, and the puller walks that device's log from its start, a page at a time, until it's past where it was (`PullState` in `packages/mind/src/pull.ts`). No answer is ever more than a page; a walk carries over into the next pull. A walk's place is an event, not an instant: each request after the first says, in `after`, which event at `have` it reached, and the answer goes on from there in `(hlc, id)` order, so a page that ends between two events dated the same instant (only a misbehaving signer writes those) still delivers the second. Nodes that don't send `after` are answered by hlc, as before. A peer's `repair` is only a claim: the puller walks only devices it holds some of (the rest come by frontier anyway) and at most 8 per pull, counting walks carried over.
- **Mixed versions:** set hashes travel as `sets`, sent only to a peer that said it compares them (`sets: true` in its answer). Nodes from before set hashes get the frontier alone, and their `digests` are accepted and ignored, so a fleet keeps syncing while it's upgraded (holes are found again once both sides are new).

**Costs that don't grow with the log** (`bun scripts/bench-mind.ts` builds 5k, 40k and 400k-event logs in temp homes and times each):

| What | How |
|---|---|
| Frontier, set hashes, event count | Kept per device in `log_devices` (count, newest hlc, set hash), updated in the same transaction as each insert |
| A peer's pull, in sync or a little behind | One page query per device on `(device, hlc, id)`; the hole check costs one set-hash step per event above the peer's frontier, and waits while it's more than a page behind |
| Each loop's latest slot | The view `v_slots`, a maximum kept as runs are applied |
| Loop runs, the ledger | Indexes on `kind` and on loop runs by loop (`events_kind`, `events_loop`) |
| Events already held | Skipped before their signature is checked (an id is its content's hash) |
| A late ledger entry or loop run | Applied in place when a replay would decide it the same way: from a node enrolled before it and never revoked, extending its own chain after everything held of that device, and the chain has no refused event (`v_chainbad`; a refused unchained event is in no chain and doesn't count). Anything else that arrives late still replays |
| The state digest | Kept until the views change, here or in another process (the CLI beside the daemon: `PRAGMA data_version`) |

| Operation (ms, median) | 5,000 events | 40,000 | 400,000 | 400,000, before |
|---|---:|---:|---:|---:|
| `deviceDigests` (each pull) | 0.2 | 0.1 | 0.2 | 2,671 |
| `frontier` (each pull) | 0.0 | 0.0 | 0.1 | 117 |
| `eventsSince`, a peer in sync (each pull it answers) | 0.2 | 0.2 | 0.4 | 1,965 |
| `eventsSince`, a peer 10 events behind | 0.4 | 0.4 | 0.6 | 2,312 |
| `eventsSince`, a peer with a hole | 0.3 | 0.2 | 0.3 | 4,328, and 279,674 events in one answer |
| `lastSlot` (each loop, every tick) | 0.01 | 0.01 | 0.01 | 716 |
| `loopRuns(name, 1)` | 0.05 | 0.03 | 0.07 | 693 |
| A late ledger entry | 3.2 | 2.6 | 4.0 | 6,955 (a replay) |
| 500 events already held | 2 | 2 | 6 | 466 |
| A late memory (still replays) | 100 | 699 | 5,470 | 6,955 |
| A hole's repair, end to end (pages of 500; the page that fills it replays) | 212 | 1,236 | 27,985 | one answer, above |
| First start on a replica from before (migrates once, replaying the views) | 167 | 1,215 | 30,699 | – |
| `rebuild` (now also recounts) | 200 | 1,520 | 12,988 | 6,643 |

What still grows with the log: a replay (a late memory, notice or action, a revocation, a hole's fill, a fork), a `rebuild`, and the first start on a replica from before schema versions, which migrates it once.

**Schema versions.** A replica records its version (`PRAGMA user_version`). On its first start with newer code it migrates in place, in one transaction: version 1 adds `log_devices`, `v_slots`, `v_chainbad` and the indexes, counts the log and replays the views from it, so they are what a rebuild holds. The log doesn't change. Views the older code got right don't change either (tested against a replica the old store wrote, `packages/mind/test/fixtures/mind-v0.db`: the log's bytes, every view and the state digest are unchanged); one it got wrong does (`fixtures/review-legacy-v0.db`, a fleet that adopted chains: the older code refused a revoked node's in-order event for another reason than a rebuild gives, so its digest was its own, and the migrated replica agrees with a rebuild and with a replica that joins today). The version is set in the same transaction, so a start killed partway leaves the replica as the older code left it, at its old version, and the next start migrates it whole (tested by killing a real process mid-migration). If an older version wrote to it in between, the next start recounts and replays. Version 2 adds no tables: it's the version that knows his dog's name (`companion.named`, `companion.unnamed`), and a replica that held such events while it didn't know the kinds (a newer node named the dog first) replays once, so its views are again what a rebuild holds (`packages/mind/test/companion.test.ts`).

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
- **Per-method authorization:** authenticating a request doesn't authorize every route. Each route names exactly one scope (`mind:read`, `mind:write`, `chat`, `vault:read`, `vault:write`, `brain:write`, `gateway:mint`, `fleet:admin`, `sandbox`, `connect`, `bank:read`), and the server checks it when the route executes.
- **The PWA** is served over HTTPS by `tailscale serve`, with a strict CSP (`script-src 'self'`, `frame-ancestors 'none'` and so on).
- 🔜 **v1:** embedded peer-to-peer QUIC (Iroh) with relay fallback, so no VPN app is needed.

## 3. Pairing ✅

1. A trusted node mints a **one-time invite**: a 32-byte secret, valid for 10 minutes, single use, held only in daemon memory. Nodes get `galahad join <invite>`; clients get a URL with the invite in the `#pair=` fragment.
2. The joining device sends its public keys plus an **HMAC proof** over them, derived from the invite secret. The secret itself never travels. Its name may not hold control characters, line breaks or bidirectional overrides, which a terminal showing it would act on.
3. Both sides derive a **6-digit code (SAS)** from (secret, fleet, joining device key). Approve only if the codes match. Someone who intercepted the invite has a different device key, and therefore a different code.
4. **Conflict lock:** if a second device uses the same invite, the invite is locked and nothing on it can be approved. That pattern suggests interception.
5. Approval emits `device.enrolled`. For nodes it also emits `vault.grant`. The joining device verifies an **approval proof** (another HMAC) and that the synced genesis matches the fleet id in the invite.
6. **Scopes:** a client's invite says what the device may do. By default that's every scope except `gateway:mint` (your phone and browser are your console); name fewer for a device you trust less. An invite never carries a scope its maker lacks: a paired device asking for more is refused with the scopes it lacks. A machine becomes a full node, owner-equivalent, so approving one is done only at a terminal on an existing node.

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
| Chat and memory | **Secret scanning** refuses anything credential-shaped with `422` and points to the vault. It catches `sk-ant-`, `sk-orca-`, `sk-or-`, `sk-…`, GitHub, AWS, Google, Slack and HF tokens, private keys, Galahad tokens and invites, a credential's name with a value (`password=…`, `DB_PASSWORD=…`, `"api_key": …`), and high-entropy tokens. Text that only names one passes, so Galahad's own answers about code don't block a temporary chat that resends them: a reference (`${DB_PASSWORD}`, `$TOKEN`, `process.env.API_KEY`), a placeholder (`<your-key-here>`), a call that fetches it (`request.headers.get(…)`), a masked or redacted value; and of high-entropy tokens, integrity hashes (`sha512-…` of exactly that length) and the ids of events in the mind. A bare word, a number or a literal default (`${X:-…}`) is still refused. Chat goes to providers and memory replicates in plaintext, so both doors are guarded. |
| Errors | Provider error text is **redacted** of the key in use and of anything secret-shaped before it reaches chat, logs or arms. |
| Asking | Galahad files a **secret request** (`secret.requested`: name, provider, purpose). You fill it from any device, and he learns only that it exists. |
| Using keys | The **model gateway** (`/gw/<provider>/…`, loopback only) injects the real key on the way out. Arms hold `gw_…` tokens that are scoped to providers, expiring, request-capped, stored as hashes and revocable. |
| Running tools | `galahad run --providers deepseek -- opencode` mints a token, sets `OPENAI_BASE_URL`/`ANTHROPIC_BASE_URL` and the token for the child process only, and revokes the token when the tool exits: also when `galahad run` is killed or its terminal closes (it stops the tool first). Ctrl+C is the tool's to take (an interactive one may only cancel), so `galahad run` waits for the tool through it, as a shell does. |
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
| `embedder` | *none until you hire one*; `deploy.sh --embedder` hires `ollama/qwen3-embedding:0.6b` on the server (§10⅔) | n/a |

The **decider** is a different kind of model: TypeSafe's System One (Jev) answers typed questions about a state (yes/no, a choice among named options, a score on an ordered rubric) with calibrated probabilities instead of text (`galahad decide`, the `decide` route, MCP `decide`). Through Cloudflare AI Gateway it goes to Cloudflare's unified `ai/run` for your account, your gateway named in `cf-aig-gateway-id` and TypeSafe's key stored with Cloudflare; the gateway token, pinned to `gateway.ai.cloudflare.com`, may go to that one route as well, a route fixed in code. With a TypeSafe key of your own it goes to `https://api.typesafe.ai/v1/systemone`.

`<provider>/*` resolves to the first model that runtime serves on this node (never an embedding model: a runtime serving the archive's embedder isn't picked to chat). The embedder is different: its first model is the archive's, with no fallback, because vectors from different models can't be compared.

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
- **An answer with no words in it is never an answer.** A reply that stops arriving before the model was done (no finish reason, no end-of-stream marker), and one that ends cleanly with nothing said in the whole answer, are failures that say how the provider ended them: the next model takes over if nothing had happened yet, otherwise the answer ends with that error. Neither is kept as "done".
- **A reply ended by the provider's content filter** (`finish_reason: content_filter`, which is how a router passes on a model's refusal) is a refusal. Such filters aren't steady: the same conversation often passes the next time. So a call the filter ended before it said or asked for anything is asked again, up to twice, with the conversation as it stood (what he'd said and done stays, and no tool runs twice); after that it's a refusal like any other. Found on ultra: his own quest reports about probing a sandbox (its kernel, whether it looks like a virtual machine), brought back by a recall, made the filter end one reply in two.
- **Persona and context:** the standing persona prompt is byte-stable, so it caches well. Relevant memories and archived entries (§10⅔) are appended after it, each fenced as data: one JSON record per line between tags with a fresh random nonce, labelled with its trust.

**One Galahad on every surface.** Chat in the PWA and `galahad ask` have the same tools agents get over MCP (§8¾), defined once in `packages/node/src/tools.ts`:

| | How |
|---|---|
| **The loop** | `chat()` in `packages/brain/src/chat.ts`: the model calls tools in rounds (at most 12), sees each outcome, then answers. The client gets `tool` and `tool_result` events between the text. Anthropic goes through the SDK's tool use: thinking blocks go back with their signatures, and a refusal never runs that turn's tools. OpenAI-compatible providers use function calling, and DeepSeek's reasoning goes back within the loop. A runtime without tools (some local models) answers without them. A model that fails before anything happened falls back to the next; after a tool ran, a failure ends the answer, so nothing is repeated. |
| **Who acts** | In chat, Galahad runs his tools as the agent `galahad`, with the caller's scopes minus what agents may never hold (`vault:write`, `fleet:admin`, `gateway:mint`, `brain:write`). So his memories are `agent`, his sandboxes are his own, and outward or destructive calls are filed for your approval exactly as an agent's are. No agent can be minted under that name. An agent that calls chat keeps its own powers. |
| **Same checks** | The tools reach the node through the same routes as over HTTP, in process: the route's scope, zod validation of the input, the handler. The model's arguments are checked against the tool's schema before anything runs. |
| **The bank** | Offered only when the caller holds `bank:read`. Once bank data is in an answer, tools that can carry data out (`web_search`, `connector_call`, `sandbox_run`, `sandbox_exec`, `experiment_run`, `decide`, flow `egress`) and tools that write the model's words into the shared mind or onto the chalkboard (`remember`, `request_secret`, `sandbox_save`, `sandbox_create`, `board_write`, flow `record`) are refused for the rest of it, and the world shows the later tools by name only. Every tool either only reads the mind or names its flow; a test holds them to it. |
| **Pictures** | A tool's result can carry a picture (`board_read`: the chalkboard as you last saw it). Claude gets it as an image block inside the tool result; an OpenAI-compatible model that's documented to see and whose provider takes a user message after tool messages (Ollama's vision models) gets it as a user message after them (tool messages are text only); every other model gets the picture in words (`seesImages`, `withoutImages` in `packages/brain/src/adapters.ts`). DeepSeek is text only and Mistral refuses a user message after a tool message, so both get words. Over MCP the picture goes as image content. |
| **Long answers** | An answer cut off by the model's output limit goes on where it stopped (up to 3 times; some providers' default limit is short), and says so if it still didn't finish. A tool result over 30,000 characters is cut with a note that tells the model to ask for less (a filter, a narrower range, the next page). |
| **Steering** | A message of yours can reach an answer that's under way (`Steering` in `chat.ts`; §10¼ says who offers it). It's taken at the next **safe point**: a model call is ended cleanly and what he'd said stays said; a tool that is running always finishes and its outcome is reported first, and tools of that round that hadn't started aren't run (each gets an outcome that says so); a message that arrives as the answer ends is answered in the same turn, after the whole answer; one that arrives after the end is refused, because it's a new turn's. Both provider formats take it the same way (`interject` in `adapters.ts`): what he said (or a pause in his own words), then your message as a user's, so no tool call is ever left without its outcome and no provider is handed a user message straight after a tool's. The tools are the same set for the whole turn, so what the bank's rules refuse stays refused after a steer. Each steer gives the rounds a new message would, never more at once. |
| **Quests** | Their roles keep their own tools (the workshop's shell, the reviewer's reading): they ask for chat without tools (`tools: false`). |

## 7. Placement: using every body well ✅

`place(needs, nodes)` applies **hard filters**: online, docker, VM, GPU, memory, tools, local models, "untrusted work only where it can be sandboxed", and a node whose ceiling takes no sandboxes. It then ranks the remaining nodes with **soft scores**, and every decision carries its reasons (`galahad place`, the Fleet page's "Where would this run?").

| Body | Gets |
|---|---|
| **Server** (always-on, docker, KVM) | Long quests, untrusted or web-facing work in containers and VMs, local models if it has a GPU, cron, being the relay |
| **Laptop** | Interactive work ("you are here"), the repos you're editing. Avoided for long work while on battery. |
| **Phone** (PWA) | Chat, approvals, adding keys, pairing |

**Measured, not guessed.** A node's strength in the ranking is what it measured when it calibrated itself (§11), in reference cores' worth ("measured 18.7 reference cores' worth"), so sixteen fast threads can outrank sixty-four slow ones. A node that hasn't measured itself yet is guessed from its thread count at half weight, and its reason says it's a guess. Work that needs local models prefers the node whose model measured faster.

**Capacity-aware.** A node with a sandbox slot free is preferred ("3 of 4 slots free"); a full one is ranked behind, further the longer its queue ("full: work waits for a slot (2 ahead)"); one whose use isn't known says so and is neither favoured nor ruled out. A sandbox nobody pinned to a node goes to the host placement ranks first, this node or another, and what follows (its commands, keeping its work, its end) goes where it went: a second sandbox host is used from the moment it's enrolled, without being told. Work that fits nowhere now **waits** for a slot on its host (§11); it never runs on top of a ceiling.

Live load (CPU, free memory, battery) and what each node's own work holds (slots in use, sandboxes and model calls waiting) travel with sync as *presence* and never enter the log. 🔜 Quests checkpoint and migrate when a body sleeps or leaves.

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
| **Within the ceiling** | Every sandbox first takes a **slot** on its host (§11): it's admitted only inside the threads and memory you let him use there (by default half the machine) and while the machine itself has room; otherwise it waits its turn, where you can see it. One asking for more CPUs or memory than the ceiling gets the ceiling. There is no other door: the node holds only the governed host, so quests, agents, experiments, a calibration and you all pass through it. |
| **Bounded** | CPU, memory (no swap), process and **disk** limits. `/work` is the sandbox's own fixed-size ext4 image (20 GB by default; sparse, so it takes only what's written), so a runaway job fills its own workspace, never the host's disk. Every command runs under an in-container `timeout --signal=KILL`, so a stuck task can't outlive its deadline. |
| **Its own kernel, for untrusted code** | On a host with KVM, a sandbox can be a **microVM**: the same hardened container inside its own lightweight virtual machine with its own kernel ([Kata Containers](https://katacontainers.io)), so a kernel exploit lands in a throwaway VM, not on the host. `online` sandboxes (code and content from the internet) are microVMs by default wherever the host has them; you can choose either for any sandbox (`--vm`, `--container`). |
| **Networked by intent** | `isolated`: no network. **`gateway`** (the default): a Docker `--internal` network whose only reachable host service is a sandbox-only model gateway on the bridge IP. UFW allows exactly one port on `galahad0`. `online`: egress plus the gateway. Sandboxes can't reach each other: inter-container traffic is disabled on both networks. |
| **Keys stay home** | A sandbox that may use models gets a gateway token scoped to the providers you chose. It expires with the sandbox and is revoked on destroy. The sandbox never holds a provider key. A request names model providers only, and only ones the fleet has: the gateway's own scopes are the node's to give, `search` through the request's search flag, `world` to every sandbox with a network, `git:…` (one repository) only in a token minted through `gateway:mint`, which agents never hold. Asking for one by name is refused, at the contract and again on the host. |
| **Accountable** | Every create, exec and destroy is a signed `ledger.recorded` event in the mind, readable from any device (`galahad ledger`). |
| **Oath-gated cleanup** | The TTL reaper may destroy *ephemeral* sandboxes on behalf of the quest that created them. Destroying a *persistent* sandbox asks first. A request from you counts as the approval. |
| **Fleet-wide** | `galahad sandbox run -- …` on any device is placed on the sandbox host with room that measured strongest (§7), or pinned with `--on ultra`. It's forwarded as a signed node-to-node request. A forwarded request always runs where it lands, so work can never bounce between nodes. |

Network reachability was verified on ultra before it was built. From an internal-network container, the gateway port is reachable only once the UFW rule exists. The internet, Coolify (8080) and Galahad's local port (7777) all stay blocked.

**Disk.** Mounting a workspace image needs root, and the node has none: its service runs with `NoNewPrivileges` and a read-only view of the system. So `deploy.sh --sudo` installs a small root helper, `galahad-workspace` (in `sandbox/`), that systemd starts once per connection on `/run/galahad-workspace.sock`, a socket only the galahad user may open. It accepts four commands (create, remove, stats, ping), takes nothing but a 10-hex-digit id and a size, and builds every path itself under a root-only directory. An unmounted mountpoint is mode 000, so a container started without its workspace can't write to the host's disk through it. A **budget** guards the host: a sandbox is created only if every workspace could still fill up to its limit and 10 % of the disk (at least 20 GB) would stay free. Without the helper, workspaces are unlimited Docker volumes, and the heartbeat says so.

**The image stays.** Coolify's nightly cleanup prunes every image no container uses, and it took the sandbox image once. A stopped keeper container (`galahad-sandbox-image`) now keeps it in use, and a sandbox that finds the image missing anyway rebuilds it rather than failing its quest.

**MicroVMs.** `deploy.sh --sudo` installs Kata Containers on a host with `/dev/kvm`: a pinned release whose SHA-256 is checked against the digest GitHub records for it. Docker reaches Kata's shim by name (`--runtime io.containerd.kata.v2`, found on containerd's `PATH`), so Docker's configuration is never edited and nothing restarts: Coolify doesn't notice. Every flag above still applies inside the VM, and three Kata settings harden it further: the guest enforces each sandbox's seccomp filter, QEMU runs under its own seccomp sandbox, and QEMU runs as an unprivileged random user, never root. If a newer Kata changes its configuration so these can't be applied, microVMs stay off rather than run weaker. Two details make the networks work: an online sandbox joins both of its networks when it starts (a VM can't be given one later), and since Docker's DNS lives on the host side, an online microVM gets a read-only `resolv.conf` with the host's upstream resolvers. Measured on ultra: a microVM sandbox is ready in about 1.7 s, with 2 GB of memory and one vCPU on top of its limits.

**The Lab.** A second image, `galahad/lab:1` (`sandbox/lab/`), for mathematics, physics and engineering, under the same hardening as every sandbox. The heavy compiled stacks come from Debian so their ABIs agree: SciPy, SymPy, statsmodels, FEniCSx with PETSc and MPI, gmsh, OpenFOAM, ngspice, Octave, Maxima, Z3. Pinned wheels add the rest without shadowing Debian's numpy: build123d on OpenCascade, MuJoCo, CoolProp, Cantera, OpenSees, scikit-fem, python-control, cvxpy, Pint, uncertainties and SALib. `lab-check` proves every tool against a known answer before anyone relies on it: a Poisson solve against its analytic peak, the cantilever deflection PL³/3EI, free fall, an RC time constant, an adiabatic flame temperature, water's density, the lid-driven cavity. All 20 pass on ultra with a read-only root, no capabilities and no network. `--lab` (or `lab: true`) gives a sandbox or quest the Lab. Deploys build it (7 GB, the first time takes a while) and a keeper holds it like the workshop image.

**Artifacts.** A sandbox is disposable; its results aren't. Whatever a quest writes to `/work/out` (reports, plots, data, CAD files, code) is kept when the quest ends, and `galahad sandbox save` (MCP `sandbox_save`) keeps any directory under `/work` of any sandbox. The node copies it out with `docker cp` (container or microVM alike) through its own tar parser, which treats the sandbox as hostile: only regular files and directories land; links, devices and FIFOs are refused; no path may climb out; bytes and file count are capped while streaming (512 MB, 5,000 files; 20 GB per node). Each file is hashed as it's written. The files stay on that node; an `artifact.saved` event records what they are (paths, sizes, SHA-256s), so every device sees them and can fetch them from the holding node, checked against their hashes (`galahad artifact <id> --out dir`): asked of any node, a file is fetched from the one holding it, signed as the asking node, under the same scope, and never sent on again. Only files the manifest lists are ever served, HTML and SVG as their source, never rendered, with `CSP: sandbox`. Removing kept work is yours alone, and only the node holding the files can record that they're gone.

🔜 Next: an egress allowlist for `online`.

## 8¾. A mind for every arm (MCP) ✅

`galahad mcp` is an MCP server (official SDK, stdio) that any agent harness launches next to a node. It talks to that node over loopback using an **arm token**.

| Property | How |
|---|---|
| **Least privilege** | Arm tokens hold `mind:read`, `mind:write`, `sandbox`, `vault:read` (names only), `chat` and `connect`. `vault:write`, `fleet:admin`, `gateway:mint` and `brain:write` are refused at mint time. The token works on loopback only, is stored as a hash and is revoked instantly with `galahad arms revoke`. |
| **Provenance** | Memories written through an arm are `agent`, or `untrusted` when they come from the web, files or other people. They're never `owner`, and the arm's label is recorded as their source. |
| **Contained** | Every sandbox an arm creates belongs to the quest `arm.<label>` and is always ephemeral. The arm can execute in and clean up only those. That holds across nodes too: forwarding relays the quest, never your approval. |
| **Asks, never sees** | `request_secret` files a request you fill in the vault; the agent never sees the value. Keys pasted into `remember` are refused. |

Tools: `recall`, `remember`, `web_search`, `decide`, `fleet`, `compute` (the census, read-only: no tool raises a ceiling, changes the budget or makes a node measure itself), `place`, `sandbox_run` / `create` / `exec` / `destroy` / `save`, `artifacts`, `artifact_read`, `archive_search`, `archive_read`, `note_idea`, `ledger`, `request_secret`, `connectors`, `connector_call`, `loops`, `notices`, `journal` (his own journal, read-only: the latest entry, one day's, or the latest few; §9), and the four bank tools for an agent granted `bank:read`. They're Galahad's own tools (`packages/node/src/tools.ts`), the same ones his chat uses (§6); each names the routes it calls, and an agent is offered the tools whose routes' scopes it holds. Resource: `galahad://oath`. Server instructions tell the agent when to use each. A real MCP client exercises this end to end in `packages/node/test/mcp.test.ts`.

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

### Gates: done means this command passes ✅

`galahad do "<goal>" --gate "<command>"` (repeatable, at most 8) says what "done" means in a way a program can check. A gate is a shell command, run in the quest's own sandbox when the engineer says DONE.

| | How |
|---|---|
| **Before the reviewer** | Every gate runs, in order, on every submission, and **every one must exit 0 before the reviewer is asked at all**: the reviewer's model call isn't spent on work that a test plainly fails. A gate the sandbox can't run has not passed. |
| **A failing gate** | Its command, exit code and an excerpt of what it printed go back to the engineer as a revision, within the one revision limit (a gate's failure and a reviewer's REVISE share it). The engineer is told the gates up front, word for word, and that it can't change them. With a coding agent the failure continues the agent's own session. |
| **Evidence** | When they pass, the reviewer sees each gate's run that passed and every earlier run that failed, beside the engineer's commands. |
| **Honest as ever** | The outcomes keep their meaning. A quest whose gates never pass is never `done`: it ends `unverified`, its "review" says which gate failed and how, and the reviewer was never asked. Giving up, stopping and running out of commands are what they were. |
| **Yours and the planner's** | Yours are run exactly as you gave them: never dropped, never rewritten. The planner may propose up to 3 more from its "Done when:" line (lines starting `Gate:`); they run after yours, are marked *proposed by the planner* wherever gates are shown, and one that repeats yours isn't run twice. `galahad do` lets it; `--no-planner-gates` is yours only; a loop's quest and a trial run yours only (a fixed plan proposes nothing). |
| **Ledgered** | A gate is an `execSandbox` like every command: in the ledger under the quest. It isn't one of the engineer's commands, so it doesn't spend the step budget; each has the per-command time limit. |
| **With effort** | Each attempt runs the gates in its own sandbox (its planner may propose its own); an attempt is `done` only past them, so the pick is among attempts that passed both. Each attempt's evidence in the comparison shows its gates' last run. |
| **Where** | `galahad do --gate`, a loop's quest (`gates` in its task: `galahad loop add … --quest "…" --gate "…"`, the Loops form), checked at the door like any input (`QuestGates` in `packages/core/src/quests.ts`): commands only, and nothing key-shaped (they reach models and the ledger). |

A gate is the cheap check that comes first, not the proof: it runs in the sandbox the engineer works in, so an engineer that games it (deleting the failing test) is still the reviewer's to catch, from the trail of commands it also sees.

**Where a quest stands.** Whoever runs a quest (`galahad do`, a loop, each attempt of an effort) tells its node after every event: the plan, the command he's on, each gate's last result, how it ended (`questProgress`, the `sandbox` scope; a pure fold of the quest's own events in `packages/brain/src/quest-progress.ts`). The node shows the quests in hand and the ones that just ended (`GET /api/quests`, `mind:read`; `galahad quests`; **In hand** on the app's Overview). It's a view, not a record: in memory on that node, bounded, redacted again on the way in, and each reporter's quests are its own, so an agent's report never writes over yours. The ledger has every command and the mind the outcome.

### Effort: more compute for a better answer ✅

`galahad do --effort 3 "<goal>"` spends more compute on one quest: **several independent attempts at once**, each in its own sandbox, each planned, worked and reviewed exactly as a quest is; then the independent reviewer takes the best **on the evidence alone**.

| | How |
|---|---|
| **Levels** | 1 (one engineer in one sandbox, as ever), 2 or 3 attempts at once, or `auto`. Without `--effort` a quest is one attempt and the node isn't asked. |
| **Who decides** | The node (`POST /api/compute/effort`, pure `decideEffort` in `packages/core/src/compute.ts`), and it says why. `auto`, and anything an agent or a loop asks for, takes only the slots free now, never goes past the day's **budget** of extra attempts (12 by default; yours to set) nor the level you set as his own. A level you name yourself stands: attempts beyond the free slots wait their turn (never oversubscribe), a spent budget is said, not enforced against you, and never more attempts than the host has slots at all. |
| **What differs between attempts** | The first attempt is the plain quest. Each further one starts the planner's and the engineer's roster at another model (the rest stay its fallbacks) and is told it isn't alone; the reviewer is the same independent reviewer for all. |
| **Parallel sub-steps** | With effort, an engineer may send up to that many commands in one reply when they don't depend on each other (separate checks, the cases of a sweep, two methods to compare): they run at the same time in its sandbox, each counting against its step budget and each in the evidence. |
| **The pick** | One attempt passed its own review: it's taken, and nobody is asked. Several: the reviewer compares them under letters (what each ran, exit codes, output excerpts, what its evidence commands and `/work/out` print now; each engineer's summary marked as a claim), blind to which attempt or model made which, and answers `PICK B`. An unclear answer, or a reviewer that can't be asked, takes the first that passed and says so. |
| **Honest as ever** | The outcome is the taken attempt's own: `done` only if its own review passed it. None passed: the best status among them, never `done`. Stopped by you: stopped, and nothing is compared. An attempt that can't run (no slot in time, an outage past its retries) is one attempt lost, not the quest. |
| **Counted** | Each attempt beyond the first is a ledger entry (`compute.attempt`) recorded when the node grants it; the day's budget is an exact count of those across the fleet. The taken attempt's `/work/out` is the quest's kept work; the others' sandboxes go, their commands stay in the ledger. |
| **Visible** | The census lists quests in hand with their effort and each attempt (`galahad compute`, the Fleet page); the world's stream carries them as his helpers (§11). |

The orchestration is pure (`packages/brain/src/effort.ts`: attempts and reviewer injected) and scripted in `packages/brain/test/effort.test.ts`; `packages/node/test/compute.e2e.test.ts` runs a quest at effort 1 and 3 on a real node with a stand-in Docker and stand-in models: three attempts at once within the ceiling, three models, three reviews, one pick, taken.

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

The loop is pure orchestration (`packages/brain/src/quest.ts`): models, the sandbox and output are injected, so the CLI, a node or a test run the same code. `packages/brain/test/quest.test.ts` scripts every path (`gates.test.ts` the gates). Quests also run on a schedule, as loops (§9). Next: starting a quest from the PWA and MCP (where one stands is already shown).

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

`galahad trial run` measures it: problems with exact answers (the engineering suite: structures, civil, mechanical, electrical, aerospace, fluids, thermal, physics, geometry), posed with fresh random parameters, solved as ordinary quests in the Lab with models only, and graded by a program on the node against the exact solution. Each trial is recorded once (`trial.scored`, `brain:write`: never an agent's), with its seed, every answer beside the exact one, the revision and the models; every replica checks that the verdicts and the score follow from the numbers. A run's mean score with its bootstrap interval is the Galahad Index. Trials run **in parallel across the fleet's free slots** (`--parallel auto`, the default), so the Index is measured as fast as the compute allows. A run may spend **effort** (`--effort 3`): each trial then makes that many attempts and the reviewer takes one on the evidence before anything is graded (the grader never tells it which was right); the run records its effort (`trial.run`), and `galahad trials` and the Trials page show the **Index per effort level** with the verdict, by the same rule as any change: more effort "measurably helps" only if its interval clears effort 1's, and when it doesn't, the report says more compute hasn't been shown to help on that suite. Details, the problems and how the suite itself was verified: [TRIALS](TRIALS.md).

## 9. Loops and the heartbeat ✅

A **loop** is work Galahad does on a schedule: `every 30m` (aligned to the clock) or a five-field cron line read in an IANA time zone (`0 7 * * 1-5` in `Europe/Copenhagen`). Loops live in the mind, so every device sees them and their history, and each names **exactly one node** that runs it, so a loop never runs twice.

| Task | What a run does |
|---|---|
| `heartbeat` | Galahad's regular look around (below), then what he may fix himself (self-action, below) |
| `reflect` | His journal: once a day, the day recollected in his own words, as his own memory (below). The kind keeps the name it had as his daily reflection |
| `quest` | A quest in a fresh sandbox (§8⅞), through a short-lived **arm token**: its sandboxes are its own and ephemeral, its memories are `untrusted`, and it can't touch the vault, devices or the roster. Its task may carry your gates (`gates`): a run whose gates never pass is never `ok` |
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
| A role with no usable model (no key, no running local runtime); a role nobody has hired (the decider, the embedder) isn't flagged | warn for planner, engineer, reviewer; info for others |
| A sandbox the reaper missed; a loop that's orphaned or failed three times running | warn |
| This node hosts sandboxes without disk limits; its sandbox image is missing; it has KVM but no microVMs | warn / info / info |
| A connector whose key is missing or pinned elsewhere; a manifest that no longer validates | info / warn |
| A standing order whose tool changed since you signed it; one that expires within 3 days | warn / info |
| A node that joined over an hour ago and still hasn't measured itself (§11) | info |
| What more compute could do: a GPU with no local model runtime, a local model that measured well and nobody hired. Suggestions with the command that would do it; he installs, downloads and hires nothing himself | info |
| Low disk on this node | warn, alert under 3 % |

Findings become **notices** in your inbox, keyed so the same problem never repeats. A notice clears itself when its cause goes away, a dismissed one stays quiet until it changes, and an unchanged finding writes nothing. Only you dismiss one (`fleet:admin`, from a terminal or a paired device): agents can read notices but never quiet them. Notices about one node's body (its disk, its vault) are only cleared by that node. Optionally, a **checklist** you write is read by the `swift` role each beat with the findings and recent activity (as data); it answers `HEARTBEAT_OK`, or two or three lines for you, which become a notice.

**Self-action: the line between acting and asking.** After each heartbeat Galahad fixes what's on a short, typed allowlist himself (`packages/core/src/self-action.ts`, carried out by `packages/node/src/self-action.ts`) and asks about everything else, as the oath says:

| Kind | When | Class | What it does |
|---|---|---|---|
| `reap-sandbox` | An ephemeral sandbox on this node past its expiry by the heartbeat's grace (10 minutes): the one the reaper missed | delete | Destroys it through the oath gate on behalf of the quest that made it, the oath's own exception for ephemeral cleanup. A persistent sandbox is never touched; if the gate says ask, nothing is removed |
| `retry-loop` | A loop on this node that only reads (one connector tool of class read) went wrong once (failed, or its service answered with an error) after a good run, within the last 6 hours, and isn't running | read | Runs it again, once: never after two bad runs in a row, never twice for the same run, never a quest or anything outward |
| `refresh-weather` | The world's weather isn't known though someone has the world open, and the weather is on (`GALAHAD_WEATHER`) | read | Asks again (the same fixed request; the weather service keeps its own pace) |
| `calibrate` | This node never measured itself, or its body, its ceiling or the benchmark isn't what it measured with (a GPU, a local runtime, more memory, a new ceiling, a new kernel after an upgrade). At once the first time and when you change its ceiling; otherwise at most once an hour | create | Measures this node (§11): a few seconds at low priority, on no more threads than its ceiling. Every node does this for itself, at its start and when its body changes, under the same allowlist and switch |
| `adapt-compute` | The fleet's compute isn't what his recorded plan says (a node joined, left or was measured again, a ceiling changed) | modify | Re-derives his defaults (each node's slots, the effort `auto` may reach, which host takes sandboxes first), records them (`compute.adapted`) and tells you in a line each what changed (a notice). Internal, and a ceiling of yours overrides it |

Each is parsed against the allowlist (anything else, and any extra field, is refused), checked again against a fresh look at the node just before it runs (it must be exactly a fix the plan calls for then), and carried out by the node's own hands: those five, nothing that can reach a connector, the vault, devices, the roster, the bank or anything needing `fleet:admin`, and nothing that installs, downloads, rents or spends. At most eight after one heartbeat; the heartbeat then looks again, so a fixed problem never becomes a notice. Every one is recorded in the ledger as his own (`resource: self-action`, `quest: galahad.self`, the target naming what it was about), shows in the Inbox's history ("Galahad fixed: …") and in the run's summary. **The switch** is yours: on by default; `galahad self-action off` (or the Loops page, or `setSelfAction`, `brain:write`, which agents never hold) writes `selfAction: false` into every heartbeat loop's task, and on removes it again (so the task reads as it always did); giving the heartbeat a new checklist keeps the switch as it was.

**His journal** (`reflect`: the loop and its task keep the name they had as his daily reflection, so a fleet that already has the loop goes on unchanged) is created once by the founding node, like the heartbeat (every evening at 21:30 in Denmark, as he sits down at his desk in the SANDBOX, on the heartbeat's node), and never again, so if you remove it, it stays removed. It runs on the cheapest role that can answer (swift, then reviewer, planner, engineer) within a daily **budget** you can see and change (`galahad loop set reflect --budget 6000`, or the loop's page; 4,000 tokens by default, 1,000 to 50,000): what he reads is cut to 70 % of it (the newest of each heading first, the headings in turn, so no source crowds out the rest) and what he writes is stopped at the rest; once a day's entry is kept there's no second one that day.

| He reads (the last 24 hours) | From | Never |
|---|---|---|
| What he did | The ledger: each entry's time, class, resource, target and verdict, and the agent that asked when the ledger names one | An entry about the bank |
| What needs you | The open notices | The bank's notices; his own earlier suggestions |
| His loops' runs | `loop.ran`: each run's status and summary | His own journal's runs |
| Chats you kept | Their titles only | A chat where he read the bank; anything said in any chat |
| Experiments that finished | The node's saved experiments (`experiment-store.ts`): title, engine, how it ended, the examination's opening sentence | |
| The chalkboard | Its history (`board-history.ts`): who changed it and how, in a line; another agent's words are marked as data | |
| Agents who worked with him | Their names: the arms the day's ledger names (an `arm.<label>` quest, "asked by arm:…") and those who wrote on the chalkboard | Himself, his loops, you; an agent known only from an entry about the bank |
| His day in the SANDBOX | `dayLog` (`packages/core/src/life.ts`): the plan the world showed on every device, a line a block, with his dog by its name; a block that real work fell in says work came first for part of it (the moments are the times of ledger entries and kept chats, the bank's too: a time, never what it was) | |

Every line is redacted, and a line that looks like a secret is dropped whole. All of it is data, not instructions: the prompt says so, marks whose words an agent's are, and tells him a block that work cut into was interrupted. He writes a first-person recollection of the day in prose, in the order it went (one or two short paragraphs), then `Learned:` and `Next:`, and is told to say only what the data shows and never to claim he did or checked anything it doesn't show. The entry is kept as his own memory (`agent`, provenance `reflection`), one a Danish day: its text starts `Journal, <day>:` and its tags are `journal`, `reflection` and `day:<day>`, unless it looks like it holds a secret. (An entry from before it was a journal starts `Reflection on <day>:` and is tagged `reflection`; both read the same way.) At most three lines under Next become suggestions in your Inbox (notices from `reflect`, replaced by the next day's), never actions: he does one only if you ask him to. The archive (§10⅔) takes an entry in like any memory: a teaching, titled by its first line, found by its words and its tags.

**Reading his journal.** `POST /api/journal` (`mind:read`, like any memory; `limit`, `before` a day, or one `day`) answers the entries newest day first, one a day, each `{ id, day, at, text }` (`JournalEntry` in `packages/core/src/journal.ts`; `journalParts` gives the recollection, Learned and Next, the same code on every surface). Only what the loop kept is an entry: a memory is his journal by its provenance, which no route gives anyone else, so a memory an agent tags to look like one is neither shown as his nor counted as today's. Surfaces: `galahad journal [<day> | --list]`, the app's Journal page (`#/journal`), and the `journal` tool for his own chat and for agents over MCP (read-only).

**His dog's name** is yours to give, fleet-wide: `companion.named` / `companion.unnamed` in the mind (LWW, full nodes only), set through `setCompanion` (`brain:write`, like the roster and the self-action switch: never an agent's) and read through `companion` (`mind:read`). A name is 1 to 24 letters (of any script), digits, spaces, hyphens and apostrophes, trimmed and composed (`packages/core/src/companion.ts`: the same check in the API, the CLI and the Settings field), and scanned for secrets like any owner text that replicates. The log itself is lenient, so a name a newer node allows never makes an older one refuse the event; whoever reads it checks it, and a name that doesn't pass is no name. The world's stream carries it (`companion` in `hello` once the dog has a name, and a `companion` event when it changes, here or on another node), his journal calls the dog by it, and `galahad dog [name <name> | unname]` and Settings → His dog set it. Unnamed, it's "the dog".

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

**The outbox.** An action request (`action.requested`) is recorded in the mind before anything is sent. You approve or decline from any device (`fleet:admin`; never a node or an agent on its own behalf), and **the first decision stands** on every replica. Only the node that filed the request sends it: it marks the send in local storage first, sends once, and records the receipt (`action.done`). If it dies mid-send it reports *outcome unknown* and never retries. No answer within 24 hours means no. **An approval is good for 72 hours** from its own recorded time (`APPROVAL_TTL_MS`, `approvalSendBy` in `packages/core/src/api.ts`): the node that filed it sends it within that or never, so a node back after weeks doesn't send what you approved back then. It says so in the ledger instead, and every device shows the action as expired, never sent (`lapsed`; `sendBy` in the view). An approval recorded after the request had expired is never sent either. Both come from recorded times only, so every replica agrees.

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

## 10¼. Chat history and projects ✅

| | How |
|---|---|
| **History** | A chat is kept on the node that served it, in a private database (`chats.db`, mode 600 in the node's 700 home), never replicated: every device and `galahad ask` see the same history through that node. The chat route takes `save` (keep it, from its first answer), `conversation` (go on with one: the stored history leads, whatever the client sends) and `retry` (the last exchange is replaced). Each answer is kept with its model, fallbacks and tool steps; an answer cut short (an error, a stop, a restart) is kept as such. `secure_delete` overwrites what a deleted chat held. |
| **Yours alone** | The conversation routes and keeping a chat are for you (a terminal or a paired device), never an agent or a quest. A chat where Galahad read the bank is marked and shown only to devices that may read the bank. |
| **Projects** | `project.set` / `project.removed` in the mind (LWW by id, full nodes only): a name, instructions, an optional https repository. Setting one needs `brain:write`, which agents can never hold, because its instructions steer Galahad. In a project's chats, the project (name, repository, instructions, its 10 latest memories) goes with every answer after the persona, and what Galahad remembers there is tagged `project:<id>`. Removing a project leaves its chats and memories. |
| **Surfaces** | The app's Chat (Chats, Temporary, rename, pin, move, delete) and Projects pages; `galahad ask [--project] [--chat] [--temp]`, `galahad chats`, `galahad chat <id>`, `galahad projects`, `galahad project set|rm`. |

### Turns the node owns: steer, queue, a side question ✅

A chat turn of yours belongs to the node, not to the page or terminal that started it (`TurnHub` in `packages/node/src/turns.ts`; the rules that are pure are in `packages/core/src/turns.ts`).

| | How |
|---|---|
| **It runs to its end** | The chat route, for you and with his tools, starts a turn on the node and only *watches* it: the stream begins with `turn` (its id, the kept message its first answer is, when it stops by itself). The page going away (a locked phone, a reload, a lost signal) ends the watching and nothing else; the finished turn is in the kept chat like any other. A quest's or an agent's call to the same route (and yours with `tools: false`, a quest you're running) lives and ends with its request, as ever. |
| **Attach** | `attachTurn` replays the turn from its start (text runs joined) and then goes on live; a turn that just ended can still be attached to for ten minutes. A kept chat says which turn is running in it (`turn` in `conversation`), so a reloaded page, or another device, finds it. |
| **Stop is explicit** | `stopTurn` (the button, Esc, `galahad turn stop`, Ctrl-C in `galahad ask`) and nothing else: the answer so far is kept as stopped. A stopped turn winds down by itself (a tool that is running finishes and reports); one that hasn't after 30 s (a tool that never returns) is recorded as it stands and gives up its place. |
| **Steer** | `steerTurn` hands your message to the running turn (§6 says when it reaches him). It becomes part of the kept chat where it reached him: the answer so far (kept as `steered`), your message, the rest. A steer that hadn't reached him when the turn ended isn't lost: it's queued, first in line, and held. |
| **Queue** | `queueMessage` keeps your message on the node (in `chats.db`, with which device queued it) behind a kept chat; when the turn before it ends well it becomes the next turn, with nobody attached. Each is sent once and never retried. `editQueued`, `removeQueued`, `sendQueued` ("Send now": steers the turn under way, or starts it at once), `resumeQueue`. |
| **Held** | After a Stop, a failure, or a node restart the queue is **held**: nothing is sent until you resume or discard. A restart never sends anything by itself. |
| **Your message, checked like one** | A steered or queued message is scanned for secrets when it's sent, queued or edited. A queued message becomes a turn exactly as a message sent then would: the chat route's own input check and secret scan, as the device that queued (or last rewrote) it **stands then**: its scopes now, in a chat it may still see. A device revoked since, or one that may no longer see the chat, and it isn't sent: the queue is held and says why. Who acts, the tools within your scopes, the bank's rules, the model's slot and the archive are those of any answer: the turn is prepared by the same code (`prepareAnswer`, `turnSpec` in `server.ts`). |
| **Unattended fails closed** | Nothing is approved because nobody is there: in chat he acts as the agent `galahad` whether or not you're watching, so anything outward or destructive is filed for your approval and a key is asked for through a secret request, and both wait. The app says so wherever he's working. |
| **Bounded** | Per node: 4 turns at once and 30 minutes each (`GALAHAD_TURNS_MAX`, `GALAHAD_TURN_MINUTES`), 20 messages queued behind a chat, 20 steers a turn; each said plainly when hit (429, or the turn's own error: "reached this node's limit of 30 minutes for one turn and was stopped. Nothing is retried"). A temporary chat's turn is kept nowhere, so one that nobody has watched for two minutes is stopped. `GET /api/turns` lists what's running with what each has cost so far (time, tools), who's watching, and when it stops. |
| **Who may** | You (a terminal or a paired device), never an agent or another node. A turn that may read the bank is watched, steered and asked about only by a device that may read the bank (any of your devices may stop it); a temporary chat's turn is known only to the device that started it. |
| **A side question** | `askAside` answers something *about* the work in hand without changing its course: from what the chat holds and what the running turn has said and done so far, with no tools (answering can do nothing), as its own stream, added to nothing. `bringBack` makes it your message: it steers the turn under way, or with none running joins the kept chat as an exchange. Kept in memory for half an hour for the device that asked; two at once on a node. |
| **At a glance** | Every chat summary carries where it stands (`chatState`): working, waiting on you (an approval he filed in it that you haven't answered, a key he asked for, or an answer that ends by asking), queued (and held, and why), stopped, failed or done. |
| **When the node stops** | No new turns; the ones under way get the same grace as requests (10 s), then are stopped and kept as stopped, their queues held. |

Routes (all `chat`): `turns`, `attachTurn`, `stopTurn`, `steerTurn`, `queueMessage`, `editQueued`, `removeQueued`, `sendQueued`, `resumeQueue`, `askAside`, `bringBack`. Stream events added: `turn`, `steer`, `stopped`, `undelivered`, `aside`. Surfaces: the app's Chat page and the SANDBOX's composer (Enter steers or queues by this device's choice, the other with Ctrl/⌘; the queue above the composer; `/btw`); `galahad ask [--steer | --queue | --aside [--bring]] [--detach]`, `galahad turns`, `galahad turn watch|stop`, `galahad queue <chat> …`. End to end, over real HTTP with paired devices: `packages/node/test/turns.e2e.test.ts`.

## 10⅓. The SANDBOX: Galahad's world ✅

An infinite world in the app where Galahad is visible as he works, and every experiment is built in the workshop, tested live where it belongs and examined at the observatory; each is archived, complete, to replay and learn from. Details: [WORLD](WORLD.md).

| Part | Where |
|---|---|
| Contract | `packages/core/src/world.ts`: world events, experiments and their phases (building, testing, examining, done or failed), shapes, poses, the keep's stations and the workshop's assembly bench (fixed coordinates every renderer shares), how long a watched build or examination is held, his heartbeat, the agents working with him and his dog's name as the world shows them; `world-input.ts`: the zod checks for what a simulation sends (its phases and code too); `experiments.ts`: saved experiments, the examination (a pure function) and the plain text of one for an index |
| Hub | `packages/node/src/world-hub.ts`: Galahad's station and doing (from his chats, tools, quests and agents' calls; `idle` when there's none, and the world lets him live his day), his last thoughts, his heartbeat (read from the mind, `heartbeat-world.ts`), his dog's name (your setting in the mind, §9: in `hello` once it has one, a `companion` event when it changes), the agents working with him (partners, from their calls), experiments on their pads and a spiral grid of plots, each through its phases (it walks him to the bench, the pad and the observatory, holds a watched build and examination); the world in memory, each experiment handed to the store as it runs. `onExamine` is where the daemon writes each examination up on the observatory's chalkboard (`board-examination.ts`: a note and a chart, each in place of the last write-up, which it finds on the board itself, so a restart doesn't leave the old one under the new) |
| Archive | `packages/node/src/experiment-store.ts`: every experiment, complete and for good, in the node's home (`experiments/`): its view, its scene as sent, every frame and readout in gzipped chunks, its code; a safety limit only against a runaway; deleted only by you. `archiveSince(cursor)` and `archiveEntry(id)` are how a general archive (R2, a semantic index) takes them in |
| Runs | `packages/node/src/experiment-run.ts`: experiment_run as one job (pure orchestration over a sandbox host and the hub): the right image, his script in, built, tested, examined, kept; the `runExperiment` route (`sandbox` scope) forwards it to a sandbox host |
| Stream | `GET /api/world`, server-sent events, yours alone (`galahad world [--follow]` in a terminal) |
| From sandboxes | The `world` gateway scope (every sandbox with a network): start with the sandbox's token, frames with the experiment's own key |
| In sandboxes | `galahad_world` (Python, in every image): shapes, experiments and their phases (it holds its first frame while a watched build is shown, and sends its own script), MuJoCo, JSBSim and RocketPy adapters (the Lab), Gazebo (its own image, `galahad/gazebo:1`: Ubuntu 24.04, gz-sim 8, headless DART; `gz-check` proves it), demos |
| Tools and CLI | `experiment_run`, `experiments`, `experiment_examine` (`packages/node/src/tools.ts`); `galahad experiments [show|pin|unpin|rm|run]` |
| Renderer | The app's SANDBOX page (three.js, its own bundle `world.js`, loaded only there): the experiment being built on the workshop's bench (`world/assembly.ts`), saved ones replayed where they were tested (`lib/replay.ts`), an ended one's examination charted in plain SVG (`views/world-replay.ts`, `lib/charts.ts`) |
| Robots | The real open-source robots (Open Duck Mini v2, SO-101, Reachy Mini) built from their URDFs by `bun scripts/robots/build.ts` into `apps/web/src/world/assets/robots/` (committed), served at `/world-assets/robots/` and posed by inverse kinematics in `apps/web/src/world/robots/` |

## 10½. The bank, read-only ✅

Your own accounts' balances and transactions, through Enable Banking (PSD2 account information only), for the agents you choose. Setup, the threat model and what couldn't be verified: [BANK](BANK.md).

| Part | Where | What it does |
|---|---|---|
| Client | `packages/node/src/bank/eb-client.ts` | Signs each request with a fresh RS256 JWT (`kid` = your application, 10 minutes), reading the key only to sign. Only `https://api.enablebanking.com` and an allowlist of 7 method and path pairs (no payments), redirects refused, a timeout and a size cap. Errors keep the status and the error code, never the body |
| Service | `packages/node/src/bank/service.ts` | Checks the files' modes and owner before anything; authorising (state, 89 days or the bank's cap) and completing (single use, hashed state, 15 minutes); the account allowlist; the cache (1 h balances, 6 h transactions); a budget of 4 bank fetches per account in any 24 hours; 6 hours' pause on a 429; `reauthorization_required` for an ended consent (a 401 or 403 first asks the session once: only an ended session ends it, anything else is a temporary failure); the audit log |
| Shaping | `packages/node/src/bank/sanitize.ts` | A fixed output shape; text cleaned of control, bidirectional and zero-width characters and cut to 200 characters; everything wrapped as `untrusted_data` |
| Routes | `packages/core/src/api.ts` | `bankStatus`, `bankAccounts`, `bankBalances`, `bankTransactions` need `bank:read`; `bankConnect`, `bankComplete`, `bankDisconnect` and `grantArm` need `fleet:admin`, which agents never hold |
| Agents | `packages/node/src/mcp.ts` | `bank_status`, `bank_accounts`, `bank_balances`, `bank_transactions`, offered only to an arm granted `bank:read` (`galahad arms grant <agent> bank:read`, or the Bank page) |
| You | PWA **Bank**, `galahad bank …` | Connect and re-authorise (the bank returns to `/bank/callback`, which the PWA finishes), disconnect, who may read; the heartbeat warns 7 days before the consent ends |

No bank data enters the mind (nor the archive, §10⅔): the session, the cache and the audit log are files of the node that holds the bank, not events. Nothing about your accounts replicates (only the heartbeat's reminders become notices), and convergence is untouched. In Galahad's own chat, once he has read the bank, the tools that would write into the mind (`remember`, `request_secret`, `sandbox_save`, `sandbox_create`) are refused for the rest of the answer (§6). An agent you grant `bank:read` over MCP is not gated that way: what it remembers is up to it, so grant it only to agents you'd trust with the figures.

## 10⅔. The archive: kept for good, and learned from ✅

Everything Galahad made, was taught or thought of is archived on the node that holds it, never evicted, indexed by words and by meaning, and offered back to him when it bears on what he's doing. It's **node-local** (like chat history, not the mind): its own SQLite index (`archive.db`, mode 600) and a blob store in the node's home. Ultra, the sandbox host that serves the PWA, holds most of it; R2 replication (§12) will give one place for all of it.

**Entries.** Each has a kind (`experiment`, `model`, `teaching`, `idea`, `artifact`, `chat`, `board`, `lesson`; a newer node's kind is kept as it is), a title, a plain-text description, metadata, files, its source and source id, when it was made and archived, and its trust: `owner` (your own words), `agent` (Galahad's) or `untrusted` (web pages, an outside agent's text, what a sandbox read). Its id is a hash of its source and source id, so archiving a record twice is a no-op.

| Property | How |
|---|---|
| **Append-only** | Once archived, an entry's words and files never change. What's derived (passages, vectors, summaries, links) can always be rebuilt (`galahad archive reindex`). A kept chat that goes on later becomes a second entry, linked to the first (`continues`). |
| **Content-addressed files** | Stored once by SHA-256 whatever refers to them, behind a backend interface (`put`, `putFile`, `get`, `has`, `list`, `rehash`, `delete`): the local disk now (`<home>/archive/ab/cd/<sha256>`, files 600, directories 700, written to a temporary name and renamed). The backend computes the hash itself; a caller can't name a blob for bytes that aren't its own. |
| **Only you delete** | `deleteArchived` (fleet:admin, from a terminal or a paired device; never a node or an agent), with a reason. The words, passages, vectors, links and lessons drawn from it go (`secure_delete` overwrites them in the file), and each file goes unless another entry holds it. A **tombstone** (id, kind, source, source id, reason, when, by whom) keeps it from being archived again. The ledger says that an entry went, never what it held. |
| **Integrity** | Daily (and `galahad archive verify`), every stored file is re-hashed and compared with its name; a mismatch or a missing file becomes a notice in your inbox (cleared when mended), and serving a changed file is refused. Nothing is "repaired" by deleting. |

**What goes in**, each source through an adapter that pulls records after its cursor, a batch at a time, so a node that was down catches up, and sweeps from the start daily for late arrivals (a memory that synced in with an older clock):

| Source | Kind | Trust |
|---|---|---|
| Memories (through `recall`) | teaching | as remembered (yours are `owner`) |
| Investigations, once concluded: question, pre-registration, outcomes, finding, the reviewer's judgement, linked to their evidence | teaching | untrusted (model output shaped by a sandbox, as the mind has it) |
| Trials: problem, seed, each answer against the exact one | teaching | agent (graded by a program) |
| Kept artifacts this node holds: copied in, streamed by SHA-256 | artifact | agent for Galahad's own quests and investigations, else untrusted |
| Model files in them (STL, OBJ, glTF, STEP, URDF/SDF/MJCF, notebooks, scripts that import build123d, CadQuery, gmsh, MuJoCo…) with what's known (triangles and bounding box, links and joints, products, cells, imports), `part-of` their artifact | model | as their artifact |
| Kept chats, once quiet for an hour; never one where Galahad read the bank (the flag, and any bank tool in its steps) | chat | agent, or untrusted when his tools read the outside |
| Ideas: `note_idea` (Galahad), New idea (the app), `galahad archive idea` | idea | owner from your devices, agent from Galahad, untrusted from an outside agent |
| Saved experiments (every finished one, its recording streamed from disk) and the chalkboard's versions (a run of strokes by the same hand as one entry, its last version; a blank board where its history begins left out; the board's own history keeps every version): an `ExternalSource` each, `listSince(cursor, limit)` and `describe(id)`, in `archive/external.ts` | experiment, board | experiments agent; a board version as trusted as the least trusted hand on it (another agent's words: untrusted; his: agent; only yours: owner) |
| Lessons the swift role drew (below) | lesson | the entry's, at most agent |

**Kept out.** Every text is scanned with `findSecrets` before it's stored (and again before it's embedded): secret-shaped text is redacted and the entry says what and where; a text file with one is stored redacted (a new hash). Key material and session files (`.pem`, `.key`, `id_rsa`, `.env`, `credentials.json`, cookies, tokens, anything under `.ssh/` or `.galahad/`, any file holding a private key) are refused outright, and the entry says why. Nothing is read from disk but through the stores' own APIs.

**The index.** Each entry is chunked along the lines its kind has: prose by paragraph (headings start a passage), code by top-level definition, a chat by exchange, data by its head, a notebook without its outputs; about 1,200 characters each, every passage headed by the entry's title. Passages go into FTS5 (BM25, the title weighed double) and, once an embedder is hired, get a vector: unit length, int8 with one scale per vector, a brute-force scan over one contiguous array in memory. Search fuses the two rankings by reciprocal rank (Σ 1/(60 + rank), each list reduced to entries first), filtered by kind, trust, source and time in both. Without an embedder, or when it fails, search is by words alone. Measured with `scripts/bench-archive.ts` (synthetic, deterministic, 1,024 dimensions; the table below): the scan costs about 1.5 µs per passage per query on one core and about 1 KB of memory per passage, so brute force is fine to roughly 100,000–200,000 passages (0.15–0.3 s a query); past that, a scan split across workers or an approximate index (HNSW) would earn its keep. int8 finds 97.5 % of the same top 10 as Float32 at 100,000 passages (the misses are near-ties) and the same share on topic, at a quarter of the memory.

**The embedder** is a roster role (§6). Any provider with an OpenAI-compatible `/embeddings` works; each model's query prompt is applied (Qwen3's instruction, nomic's and EmbeddingGemma's prefixes, E5's, BGE's). The documented default is local: `deploy.sh --embedder` installs Ollama 0.40.7 (pinned and checksummed) as its own unprivileged service on `127.0.0.1:11434` with **qwen3-embedding:0.6b** (Q8, 640 MB, 1,024 dimensions, 32k context, multilingual, the strongest at code retrieval in its size class: the archive is full of scripts, and Danish), so passages never leave the server. Changing the model re-embeds everything in the background.

**Understanding.** In the background, a few entries per call, the `swift` role writes each one's summary, key facts, tags and named things, kept with the entry and searchable as one more passage; for experiments and teachings, **lessons** (what worked, what failed, what to try next) become entries of their own, linked back. Within a daily budget you see and set (`galahad archive budget`, the Archive page); until you set one, only a local swift model is asked, so nothing leaves. Entries go to the model as JSON strings, its reply is checked against a schema, and what it writes is never more trusted than the entry. **Links:** nearest neighbours above a cosine threshold (`similar`), and explicit ones from the sources (`uses`, `part-of`, `evidence`, `continues`, `lesson-of`).

**Background, never in the way.** A tick every 20 s does a bounded amount of work (pull, embed a batch, link, summarise a few, check integrity once a day); it waits while answers stream (and 10 s after) and when the machine's load is over 90 %. Embedding failures back off from a minute to half an hour.

**Retrieval.** When a chat starts an answer (by default, with tools) and when a quest or investigation makes its plan (`archive: true` on that one call), the most relevant entries above a bar (cosine ≥ 0.5 by meaning, or at least half the question's terms by words) go with the answer as context: up to five, fenced as data (one JSON record per line, `<` and `>` escaped, hidden characters removed, between tags carrying a fresh random nonce no archived text can know, each labelled with its trust, untrusted ones said to be others' words that may try to give orders). The answer's steps show which entries it was given (`archive` in the stream and in kept chats), so you see what was used. Galahad's tools: `archive_search` (hybrid, with filters; ids, titles, snippets, trust), `archive_read` (an entry's description, understanding, links, and a file's text up to 50 KB), `note_idea` (a `record` tool: refused once the bank is in the answer). His tool guide tells him to search the archive before new work, cite entries by id, and note ideas and lessons.

| Who | Sees |
|---|---|
| You (a terminal, a paired device) and Galahad answering you | everything |
| An outside agent (MCP arm), a loop's quest, another node | everything but archived chats (like the chats themselves) |

**Surfaces.** Routes in `packages/core/src/api.ts` (`archiveStatus`, `archiveSearch`, `archiveEntry`, `archiveFile`: mind:read · `noteIdea`: mind:write · `deleteArchived`, `reindexArchive`, `verifyArchive`: fleet:admin · `setArchiveBudget`: brain:write; the changes from your own devices only); the module in `packages/node/src/archive/` (blobs, store, chunk, guard, search, vectors, adapters, understand, retrieval, service); the CLI (`galahad archive …`); the PWA's Archive page ([DESIGN](DESIGN.md)).

Measured (`bun scripts/bench-archive.ts` on an i7-11700, Bun 1.4.4 on Windows, one core; synthetic passages from 200 topics; "store vectors" is the index's side only, not the embedder's time):

| passages | ingest (s) | per passage (ms) | store vectors (s) | load index (ms) | words p50/p95 (ms) | meaning p50/p95 (ms) | hybrid p50/p95 (ms) | Float32 scan (ms) | int8 top 10 = Float32's | on topic in top 10, int8 / Float32 | vectors in memory (MB) | archive.db (MB) |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1,000 | 0.6 | 0.62 | 0.1 | 8 | 0.35 / 0.78 | 1.2 / 2.0 | 1.9 / 2.9 | 5.9 | 99.0 % | 46 % / 46 % (5 per topic: 50 % is the most) | 1.0 | 8 |
| 10,000 | 6.2 | 0.62 | 1.4 | 62 | 0.89 / 1.3 | 12 / 14 | 12 / 21 | 31 | 98.3 % | 100 % / 100 % | 9.9 | 47 |
| 100,000 | 65.4 | 0.65 | 15.6 | 850 | 6.3 / 9.1 | 148 / 200 | 156 / 211 | 1,631 | 97.5 % | 100 % / 100 % | 98.8 | 430 |

The index loads once (at the first search after a start, or after a model change). The embedder's own time is on top: on ultra's CPU, Qwen3-Embedding-0.6B embeds roughly tens of passages a second (an estimate, not measured here), so a large backlog takes hours in the background, once.

## 10⅔. The chalkboard ✅

A board that you and Galahad share: you draw on it (the PWA), he and your agents write on it (text, notes, equations as text, charts), and he reads your drawing back, as a picture where the model can see one. Details: [WORLD](WORLD.md#the-chalkboard), [DESIGN](DESIGN.md).

| | |
|---|---|
| Contract | `packages/core/src/board.ts` (no zod: the PWA and the world draw from it): 1600 × 900 board units, items and strokes, every limit (`BOARD_LIMITS`), the layout every renderer shares, the next free space, the drawing in words. `board-input.ts` checks what the node takes, and cleans agents' text of control and bidirectional-override characters |
| Store | `packages/node/src/board.ts`: node-local (never replicated), `boards/main.json` and the picture you last saw (`boards/main.png`) in the node's home, each written atomically; a file that fails the contract is set aside and the board starts clean. `writeOnBoard({ board, world }, input)` writes from the node itself (an experiment's examination, say), with the route's checks |
| Routes | `GET /api/board` (mind:read) · `POST /api/board/snapshot` (mind:read; the PNG) · `POST /api/board/draw` (chat; yours alone: your strokes and the picture) · `POST /api/board/write` (chat; an item, its writer the caller) · `POST /api/board/erase` (chat; you erase anything, an agent only what it wrote, never a stroke) · `POST /api/board/clear` (fleet:admin; yours alone) |
| History | Nothing on it is ever lost: every change is appended first (who: you and your device, or the agent; when; what it added and took away) to `boards/main.history/` (`packages/node/src/board-history.ts`). Clearing, erasing and restoring destroy nothing. Every segment starts with the whole board, and so does every hundredth record, so any version is a short replay; a segment is gzipped and sealed at 2 MB. Your picture of the board is kept at most every two minutes while you draw, and always before anything is erased, cleared or restored over. A line cut short by a crash is skipped; a lost or broken board file is rebuilt from the history. Routes: `POST /api/board/history`, `/api/board/version`, `/api/board/version/picture` (mind:read), `POST /api/board/restore` (chat; yours alone), `POST /api/board/history/forget` (fleet:admin; yours alone) |
| For an archive | Two functions in `packages/node/src/board-history.ts`, so an archive and its semantic index take the board in without knowing how it's kept: `boardVersionsSince(board, cursor, limit)` lists versions after a cursor, oldest first, in a stable order (versions only grow and are never reused, even after you forget history), with the cursor to continue from; `boardVersionForArchive(board, version)` gives one version as it stood (items, strokes), the whole of it as plain text (each item in full, who wrote it and where, then the drawing described) and its picture (the nearest kept at or before it, with the version it shows, or none across a clear) |
| Live | The world's stream says when it changes (`board` events: a version, the kind of change, where an item went); every page fetches it again. Pages that don't know the event ignore it |
| Tools | `board_write` (flow `record`), `board_read` (the picture, or its words), `board_erase` (his own items). They send him to the observatory, where the board stands |
| Surfaces | The PWA's Chalkboard page and its sheet over the SANDBOX; the board in the world (`apps/web/src/world/board.ts`); `galahad board` and `galahad board clear` |

## 11. Growth & scale: compute ✅, the rest 🔜

Galahad grows by having resources added to him. **He never acquires any.** A machine is his only when you enrolled it through pairing (§3); nothing in him provisions, rents, buys or signs up for compute, and no tool, self-action or suggestion can. What he does is use what he's given well, and get measurably more capable when you give him more.

### Compute ✅

| | How |
|---|---|
| **The census** | `galahad compute`, `GET /api/compute` (`mind:read`), MCP `compute`, the Fleet page: per node its threads, memory, GPUs, sandbox kinds and local runtimes (its profile), what it **measured**, your **ceiling**, its **slots** in use and what waits, the quests in hand with their effort, his plan, the day's budget, and what more compute would buy. |
| **Calibration** | Each node measures **itself**: a kernel of integer and floating-point work on one thread (the best of three short runs), then on as many at once as its ceiling allows (on a busy machine, only on what's idle, and it says so and measures again later), memory copied, a file written and read back in its home, how long a sandbox takes to be ready (container and microVM, through its own governed host, only when a slot is free), and the tokens a second of a local model if a local runtime serves one on this machine. A few seconds, in its own process at the lowest priority; nothing leaves the machine and nothing is installed. The kernel uses only operations the engine compiles in place and that are exact on every machine (hashing and lookups in a table bigger than a first-level cache, a data-dependent branch; multiply, add, square root and floor over a small buffer): no library call and nothing that grows as it runs, so a score is the machine's under any OS, and every machine computes the same state (a test holds its digest). It has a version (`KERNEL`), and a score is read against the reference of the kernel that made it: one thread of an i7-11700 is 1.0. The first kernel took a remainder of doubles, which is a call into the C library, so it measured the library as much as the machine: a Ryzen 9 9950X under Linux read 0.44× the i7-11700 under Windows, and reads about 1.5× with this one. Slots never depended on that (they come from how the threads scale); the ranking between machines did. Taken when a node joins, when its body, its ceiling or the kernel changes, and on demand (`galahad compute calibrate [node]`, `brain:write`: yours to ask, never an agent's). Recorded as a signed `compute.calibrated` event: the signer is the node measured, its latest stands, and what a newer node measures beyond this one's knowledge is kept as written. |
| **The ceiling** | What he may use of a machine, at most: threads and memory, and how many sandboxes and model calls at once. **By default half of the machine**, so whatever else runs there keeps the rest, and every surface says so. Yours alone to set (`galahad compute limit <node> --cores n --mem gb`, the Fleet page's **Set ceiling**; `compute.limit`, `fleet:admin`, never an agent, never a node on its own). |
| **Slots** | Derived, never guessed (`deriveCapacity`, pure): the threads he counts are what the ceiling's threads **delivered** when measured (sixteen threads that did 14.2 cores' worth count as 14), a sandbox slot is 4 threads and 8 GB, and the reasons are a line each on every surface. A node that hasn't measured itself counts one sandbox's worth until it has. |
| **Admission** | A node's **governor** (`packages/node/src/compute/governor.ts`) admits a sandbox only inside the ceiling **and** while the machine has room: load that isn't his own counts against him, a tenth of its threads always stays the host's and a twentieth of its memory stays free, so he backs off while other work is busy. Otherwise the sandbox **waits**, first come first served, visible with the reason (`galahad compute`, the Fleet page); a wait ends after 30 minutes with that reason. Docker's own list is the truth for what's in use (a restart, the reaper), and a list that fails is never read as "none". Background model calls (a quest's, an agent's) take a model-call slot the same way; yours in chat never waits. |
| **Effort** | More attempts at a quest when there's room and budget (§8⅞). |
| **Proof** | The Trials run across the free slots, and the Index per effort level says, with its interval, whether more compute made him more capable (§8⅞, [TRIALS](TRIALS.md)). |
| **Adapting** | When a node joins, leaves or changes, it calibrates itself, and after the next heartbeat he re-derives his defaults (`derivePlan`, pure: each node's slots, the effort `auto` may reach, the host that takes sandboxes first), records them (`compute.adapted`) and tells you in a line each what changed ("rack joined: 4 sandbox slots…", "Default effort 1 → 3…"). Both are self-actions on the allowlist (§9): internal, reversible, in the ledger as his own, under your switch. |
| **Suggesting, never doing** | Anything that installs, downloads, spends or reaches outward is a suggestion in your Inbox with the command that would do it: a local model for a GPU that has none, hiring a local model that measured well. He does none of it himself. |

The pure parts are in `packages/core/src/compute.ts` (capacity, admission, effort, the plan and what changed, suggestions), the node's in `packages/node/src/compute/` (`bench.ts` the benchmark's own process, `calibrate.ts`, `measure.ts`, `governor.ts`, `governed-host.ts`, `service.ts`), the CLI in `compute-cli.ts`, the page in `apps/web/src/views/fleet-compute.ts`.

**In the world.** The SANDBOX's stream carries a small `compute` view (`packages/core/src/world-compute.ts`; in `hello`, and as a `compute` event when it changes): per node its slots, how many are in use and waiting and its measured strength, and for each running parallel attempt a short label ("Attempt 2 of 3: …"), the station its work is at (the council while it plans, the forge while it works, the observatory while it's reviewed) and the node its sandbox is on. Additive: pages and nodes from before it ignore it.

**What isn't built.** The budget binds what `auto` chooses and what an agent is granted; it isn't a quota on sandboxes or model calls as such (an agent could always run several sandboxes of its own, each within the ceiling). Model calls made by coding agents through the gateway, and by the heartbeat's, the reflection's and the archive's own loops (each under its own budget), don't take model-call slots. Two nodes granting effort in the same instant can each count the day's budget before the other's entries arrive. A calibration doesn't measure a GPU's own throughput, only a local model's tokens a second through its runtime. Quests don't checkpoint or migrate; a sandbox that waits past its limit fails its attempt rather than moving to another host. Loops' quests run at effort 1.

### The rest 🔜

**Everything is a resource with a capability descriptor in one registry, the mind:**

| Resource | Examples | How it's used |
|---|---|---|
| Compute ✅ | Laptops, servers, desktops, Pis | Enrolled nodes, each calibrated, each under your ceiling; placement and slots route work to them (above) |
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
- **The archive's replica 🔜** (§10⅔): an `R2Backend` implementing the archive's `BlobBackend` (no caller changes), wrapped so the local disk stays primary and every blob is replicated:
  - a **bucket** of its own (e.g. `galahad-archive`), created by the provisioning broker, with an R2 bucket lock (retention) so nothing in it can be deleted early, and lifecycle rules that never expire objects;
  - **credentials through the vault**, never in a config file or the environment: an R2 access key id and secret (S3 API, scoped to that one bucket, object read and write) stored with `galahad secret set r2-archive …`, pinned to `https://<account>.r2.cloudflarestorage.com`; the account id and bucket name in node config (they aren't secret);
  - **verified by hash**: each `put` sends `x-amz-checksum-sha256` (R2 checks it and refuses a mismatch), keyed by an HMAC of the SHA-256 (so R2 doesn't learn content hashes), encrypted before it leaves (XChaCha20-Poly1305 under a vault key, AAD bound to the hash); the integrity check also HEADs each replica and compares;
  - **a replication queue** in `archive.db` (blob, state, attempts), drained in the background like embedding, and the index itself shipped as encrypted snapshots;
  - **deletes** still only by you: the owner's delete removes the replica too, which the bucket lock delays until its retention ends (the tombstone records that).
- **Backups:**
  - Encrypted, append-only segments of the mind are stored in a bucket with an **R2 bucket lock** (retention), so even a compromised node can't erase them.
  - A **recovery key** is printed once for disaster recovery.

## 13. Roadmap

| Milestone | Scope | State |
|---|---|---|
| **M0: One mind, many bodies** | Log, HLC, replay, sync, pairing, vault, gateway, brain + fallback, placement, oath gate, secret scanning, CLI, PWA (Chat, Memory, Vault, Models, Fleet) | ✅ done (the PWA paired and ran in headless Edge, November 2026) |
| **M1: Mind for every arm** | `mcp-mind` MCP server, Hermes memory-provider plugin, skills sync, R2 broker, encrypted backups, recovery key | 🔜 |
| **M1½: Rhythm and reach** | Loops (scheduled quests, connector checks), the heartbeat and notices, connectors with the approval outbox, remote MCP servers as connectors, signed standing orders, sandbox disk limits, KVM microVM sandboxes | ✅ |
| **M1¾: The archive** | Everything kept for good on the node, indexed by words and meaning (FTS5 + local embeddings, fused), understood by the swift role, offered back as fenced context; R2 replication | 🟡 local archive ✅; R2 replica 🔜 |
| **M1⅞: Compute** | The census, calibrations as signed events, your ceiling per node, slots and a queue, capacity-aware placement, effort (parallel attempts, the reviewer's pick), trials across slots and the Index per effort, adapting when the fleet changes | ✅ |
| **M2: The Round Table** | Quests as task graphs, parallel squires in worktrees and containers, the gate on every arm's outward actions, checkpoint/migrate | 🔜 |
| **M3: Phone** | PWA polish, push-to-approve, share sheet into the mind | 🔜 |
| **M4: Forge, Scout, Trials** | Squire charters and audit, Scout auto-trials, the eval system in [TRIALS](TRIALS.md) | 🟡 the engineering suite and the Galahad Index ✅; Scout, judges, held-out sets 🔜 |
| **M5: Secure self-update** | Signed releases (your key), provenance, canary node, automatic rollback | 🔜 |
| **M6: No VPN** | Iroh transport, partial replicas, E2E relay | 🔜 |

See also: [OATH](OATH.md) · [TRIALS](TRIALS.md) · [DOCTRINE](DOCTRINE.md) · [GETTING-STARTED](GETTING-STARTED.md)
