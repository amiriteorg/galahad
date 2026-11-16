# Galahad: architecture

**One mind, many bodies.** Every Galahad instance (laptop, server, phone, a Pi in a closet) is *the same Galahad*. Each one shares the same memory, vault, roster, oath and devices, and they differ only in what their body can do. Persistent workers (his knights) give that mind named jobs and attributable contributions.

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
| `trial.spent` | What a trial's model calls came to, by role and model: tokens as the providers reported them, never a prompt or an answer. Once, beside its trial, by the node that ran it (a kind of its own, so a node that predates it still takes the trial). The Index per token and per dollar is computed from it on every replica (§8⅞) |
| `price.set` / `price.removed` | Your price for a model, US dollars per million tokens in and out (LWW by model; `<provider>/*` prices all of a provider's). Read leniently; nothing is hard-coded (§6) |
| `compute.calibrated` | A node's own measurement of itself (§11): whose it is, is who signed it; its latest stands |
| `compute.limit` | Your ceiling for one node: threads, memory, sandboxes and model calls he may use there at once (the latest stands; empty: the defaults again) |
| `compute.policy` | How he spends compute on a quest: the level `auto` may reach and the day's budget of extra attempts (the latest stands) |
| `compute.adapted` | His defaults, re-derived when the fleet's compute changed, and what changed, a line each (the latest stands) |
| `artifact.saved` / `artifact.removed` | Work kept from a sandbox: what the files are (paths, sizes, SHA-256s); the files stay on the node that signed it, and only it records their removal |
| `order.set` / `order.revoked` / `order.applied` | Standing orders: signed once and never changed (revoke and sign anew); which order answered which action, re-checked by every replica |
| `companion.named` / `companion.unnamed` | Retired: the name of the dog he had in the 3D world that was removed on 14 November 2026. Nothing writes or reads them now, but a fleet's log may hold them, so they are still known and still folded as before (LWW, full nodes only): a log that holds them gives every replica the same digest |
| `skill.written` / `skill.approved` / `skill.marked` / `skill.reverted` / `skill.used` / `skill.outcome` | His skills (§9½): each version of a skill with its trust; your approval of an exact version (the first stands); a mark, the latest standing (locked, retired, stale); one step back; a use, once per quest; how that quest ended (the first word stands). Every replica applies who may revise what, and never counts an unapproved untrusted version as given to a model |

Open-ended parts of an event (a loop's task, a connector's manifest, a call's arguments, what a calibration measured, a ceiling, a plan) are loosely typed in the log and strictly validated by the API and the runner, so what a newer node writes never makes an older one refuse the event.

**Sync:**

- Each device's events form an HLC-ordered prefix on every replica. A peer's **frontier** (the highest HLC per device) therefore fully describes what it has.
- `eventsSince(frontier)` returns exactly the missing events, a page at a time (500).
- Nodes pull from every peer independently every few seconds, and also push fresh events immediately.
- **A push takes only what extends a chain.** Each fresh event is its own request, and requests race and get lost: an event can arrive before its predecessor, or without it. Taken as it came, the log would hold it as a gap and replay itself to say so, again for each event that follows, and once more when the gap is filled. So the receiving side (`answerPush` in `packages/link/src/sync.ts`) takes a pushed event only when it extends its device's chain as this replica holds it, and leaves the rest for the next pull, which brings a device's events in order. In the fleet simulation (`bun run bench fleet`, [BENCHMARKS](BENCHMARKS.md)) that cut a replica's full replays from 72 to 9 on sixteen nodes.
- **Holes below the frontier** (an event that reached only some replicas, a partial delivery) are found by comparing **set hashes**: with each pull goes, per device, how many events this replica holds and an LtHash of their ids (`packages/core/src/set-hash.ts`: 1024 lanes of 16 bits, ChaCha20-expanded, the parameters analysed for 200+ bits of security; a plain XOR or sum would let a forked device hide behind a matching hash). The peer takes its own hash, removes what's above the frontier, and compares. If it holds a different set there and at least as much, it names the device in `repair`, and the puller walks that device's log from its start, a page at a time, until it's past where it was (`PullState` in `packages/mind/src/pull.ts`). No answer is ever more than a page; a walk carries over into the next pull. A walk's place is an event, not an instant: each request after the first says, in `after`, which event at `have` it reached, and the answer goes on from there in `(hlc, id)` order, so a page that ends between two events dated the same instant (only a misbehaving signer writes those) still delivers the second. Nodes that don't send `after` are answered by hlc, as before. A peer's `repair` is only a claim: the puller walks only devices it holds some of (the rest come by frontier anyway) and at most 8 per pull, counting walks carried over.
- **Mixed versions:** set hashes travel as `sets`, sent only to a peer that said it compares them (`sets: true` in its answer). Nodes from before set hashes get the frontier alone, and their `digests` are accepted and ignored, so a fleet keeps syncing while it's upgraded (holes are found again once both sides are new).

**Costs that don't grow with the log** (`bun scripts/bench-mind.ts` builds 5k, 40k and 400k-event logs in temp homes and times each; `bun run bench mind` times the same at sizes that take seconds, against a recorded baseline: [BENCHMARKS](BENCHMARKS.md)):

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

**Schema versions.** A replica records its version (`PRAGMA user_version`). On its first start with newer code it migrates in place, in one transaction: version 1 adds `log_devices`, `v_slots`, `v_chainbad` and the indexes, counts the log and replays the views from it, so they are what a rebuild holds. The log doesn't change. Views the older code got right don't change either (tested against a replica the old store wrote, `packages/mind/test/fixtures/mind-v0.db`: the log's bytes, every view and the state digest are unchanged); one it got wrong does (`fixtures/review-legacy-v0.db`, a fleet that adopted chains: the older code refused a revoked node's in-order event for another reason than a rebuild gives, so its digest was its own, and the migrated replica agrees with a rebuild and with a replica that joins today). The version is set in the same transaction, so a start killed partway leaves the replica as the older code left it, at its old version, and the next start migrates it whole (tested by killing a real process mid-migration). If an older version wrote to it in between, the next start recounts and replays. Version 2 adds no tables: it's the version that knows `companion.named` and `companion.unnamed` (kinds since retired, and still folded), and a replica that held such events while it didn't know the kinds replays once, so its views are again what a rebuild holds (`packages/mind/test/retired-kinds.test.ts`). Version 3 knows his skills (§9½): three views (`v_skills`, `v_skill_versions`, `v_skill_uses`), applied the same way by a replica that held `skill.*` events before it knew them (`packages/mind/test/skills.test.ts`). The state digest takes the skills in only once there is one, so a mind without skills keeps the digest an older node computes.

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
| Chat and memory | **Secret scanning** refuses anything credential-shaped with `422` and points to the vault. It catches `sk-ant-`, `sk-orca-`, `sk-or-`, `sk-…`, Zhipu and Z.ai keys, GitHub, AWS, Google, Slack and HF tokens, private keys, Galahad tokens and invites, a credential's name with a value (`password=…`, `DB_PASSWORD=…`, `"api_key": …`), and high-entropy tokens. Text that only names one passes, so Galahad's own answers about code don't block a temporary chat that resends them: a reference (`${DB_PASSWORD}`, `$TOKEN`, `process.env.API_KEY`), a placeholder (`<your-key-here>`), a call that fetches it (`request.headers.get(…)`), a masked or redacted value; and of high-entropy tokens, integrity hashes (`sha512-…` of exactly that length) and the ids of events in the mind. A bare word, a number or a literal default (`${X:-…}`) is still refused. Chat goes to providers and memory replicates in plaintext, so both doors are guarded. |
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

**Roles you make.** Any name a knight can carry (lowercase letters, digits and hyphens) becomes a role once you hire models for it: `galahad roster set frontend <provider/model>…`, or **New role** on the Models page. `galahad roster rm <role>` (or **Remove role**) removes one you made, refused while a knight works on it (the node names which); a built-in role emptied goes back to its defaults. A chore's role (`fold`, §8) is hired the same way. A role nobody hired (one a knight was made with, or one since removed) answers with the engineer's models as you set them. The roster says of each role whether it is yours (`custom`) and whether a knight may work on it (`forKnights`: the planner, engineer and swift roles and yours; never the reviewer, which checks its work, or a tool's).

**A knight's models** are its role's: its conversations, the work of its tasks, and what its harness runs on through the gateway. A task's plan and its independent review stay the planner's and the reviewer's, whoever does the work. A knight on the reviewer's role, or a tool's, talks on it while its tasks' work runs on the engineer's (`workRole`): the reviewer never does the work it checks ([ROUNDTABLE](ROUNDTABLE.md#models-and-engineering-harnesses)).

**Provider presets:**

| Preset | Kind | Base URL |
|---|---|---|
| `anthropic` | anthropic | `https://api.anthropic.com` |
| `deepseek` | openai | `https://api.deepseek.com` |
| `abliteration` | openai | `https://api.abliteration.ai/v1` |
| `orcarouter` | openai | `https://api.orcarouter.ai/v1` |
| `openrouter` | openai | `https://openrouter.ai/api/v1` |
| `moonshot` | openai | `https://api.moonshot.ai/v1` |
| `zai` | openai | `https://api.z.ai/api/paas/v4` (its API lists no models, so the roster is offered the ones its docs name) |
| `zai-coding` | openai, **coding plan** | `https://api.z.ai/api/coding/paas/v4` (GLM Coding Plan; mainland China: `--base-url https://open.bigmodel.cn/api/coding/paas/v4`) |
| `kimi-coding` | openai, **coding plan** | `https://api.kimi.ai/coding/v1` (Kimi Code; mainland China: `--base-url https://api.kimi.com/coding/v1`); keys start `sk-kimi-` |
| `alibaba-coding` | openai, **coding plan** | `https://coding.dashscope.aliyuncs.com/v1` (Alibaba Cloud Coding Plan, now sold as legacy; outside mainland China: `--base-url https://coding-intl.dashscope.aliyuncs.com/v1`) |
| `alibaba-token` | openai, **coding plan** | `https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1` (Alibaba Cloud Token Plan; mainland China: `--base-url https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`) |
| `opencode-go` | openai, **coding plan** | `https://opencode.ai/inference/go/openai/v1` |
| `mimo-token` | openai, **coding plan** | `https://token-plan-sgp.xiaomimimo.com/v1` (Xiaomi MiMo Token Plan; Europe: `--base-url https://token-plan-ams.xiaomimimo.com/v1`, mainland China: `https://token-plan-cn.xiaomimimo.com/v1`); keys start `tp-` (`ttp-` for a team) |
| `minimax-mplan` | openai, **coding plan** | `https://api.minimax.io/v1` (MiniMax M Plan; mainland China: `--base-url https://api.minimax.cn/v1`); keys start `sk-cp-` |
| `volcengine-coding` | openai, **coding plan** | `https://ark.cn-beijing.volces.com/api/coding/v3` (Volcengine Ark Coding Plan: your ordinary Ark key, the plan only at this address) |
| `byteplus-coding` | openai, **coding plan** | `https://ark.ap-southeast.bytepluses.com/api/coding/v3` (BytePlus ModelArk Coding Plan: your ordinary ModelArk key, the plan only at this address) |
| `stepfun-plan` | openai, **coding plan** | `https://api.stepfun.ai/step_plan/v1` (StepFun Step Plan: your ordinary Step key, the plan only at this address) |
| `tencent-coding` | openai, **coding plan** | `https://api.lkeap.cloud.tencent.com/coding/v3` (Tencent Cloud Coding Plan) |
| `qianfan-token` | openai, **coding plan** | `https://qianfan.baidubce.com/v2/tokenplan/personal` (Baidu Qianfan Token Plan) |
| `nanogpt` | openai | `https://api.nano-gpt.com/api/v1`; keys start `sk-nano-` |
| `synthetic` | openai | `https://api.synthetic.new/openai/v1` |
| `ollama-cloud` | openai | `https://ollama.com/v1` (Ollama's cloud models) |
| `verda` | openai | `https://inference.verda.com/v1` (Verda's inference API; a serverless container of your own: `--base-url` its address) |
| `cloudflare-ai` | openai | *Your gateway: `https://gateway.ai.cloudflare.com/v1/<account id>/<gateway id>/compat`. The key is the gateway's token, sent as `cf-aig-authorization` (never as `Authorization`, so Cloudflare adds the provider keys you stored with it); models are `<provider>/<model>`, e.g. `deepseek/deepseek-chat`, and yours to name: a gateway lists none* |
| `ollama`, `llamacpp` | openai (local) | `http://127.0.0.1:11434/v1`, `http://127.0.0.1:9931/v1` (llama-server's default port; an older build's 8080, or its Docker image's, takes `--base-url`) |

**Another region, and a key that goes only where it was added for.** A preset's address is its vendor's default. A plan sold in several regions (Xiaomi's, Alibaba's, Z.ai's, MiniMax's, Kimi's) is reached at another one by giving that address with its key: `galahad key add --provider mimo-token --base-url https://token-plan-ams.xiaomimimo.com/v1`, or **Another address** in the app's and the iPhone's key sheets. The key is pinned there and the provider is set up there, at an address you typed next to the key, never one read back from the provider's configuration ([SECURITY](SECURITY.md), finding 2). A provider pointed elsewhere after its key was added keeps the key out of the new address, and says which address the key was for: `keyElsewhere` in `GET /api/providers`, "key for another address" in the app and on the iPhone, and the line that fixes it under `galahad provider`.

- **Anthropic** goes through the official SDK with adaptive thinking, explicit effort and streaming. Server-side refusal fallback (`fallbacks: "default"`) is enabled on the models that support it (Fable 5.1, Opus 5.5, Opus 5, Sonnet 5.5).
- **Everything else** uses OpenAI-compatible streaming.
- **Fallback chain:** a model that fails *before* producing text is skipped (missing key, outage, rate limit, refusal), and the next model answers. Each skip is reported to the client.

**Coding plans.** A coding plan is a flat-rate subscription whose key is for coding, not for calling the API from any program for anything: its vendor's terms say so and name tools, and each preset carries the vendor's own sentence and where it is said (`galahad provider presets`, and the Models page). **Galahad and his knights are a coding tool**, by their owner's word, so a plan does their coding and nothing else of his:

| | |
|---|---|
| His own coding | A call marked as coding work (`coding` on the `chat` route and in `chat()`) may be answered by a plan's models, in the roster's order: every call of a quest (its planner, engineer and reviewer, from `galahad do` and from a knight's task) and a knight at its work in a room. He calls as himself: `User-Agent: Galahad (coding agent; https://galahad.bot)`, never another tool's name. A plan that routes a conversation by its session is told which conversation this is (OpenCode Go's `x-opencode-session`, without which it answers 400): an id made from the model and how the conversation began, the same through its turns, saying nothing of either. `provider/*` on a plan is the first model its preset names; the plan isn't asked what it serves |
| Other coding tools | A plan on the `engineer` roster is also what OpenCode or Hermes runs on in a knight's VM, through the gateway, and what `galahad run --providers zai-coding -- opencode` lends a tool you start yourself. The tool calls as itself: the gateway forwards its `User-Agent` and never puts another in its place, and the plan's key stays in the vault. To a plan that routes by session the tool's own session header goes on as sent, and a tool that sent none is given its VM's (an id made from the gateway token it calls with, never the token). When a run fails on one model (a spent window is one way), the next model on the roster continues the session, as for every role |
| A model that can't answer | When a role's model fails before it has said anything and the next one answers, a quest says so once for each (which model, why, and which answers instead: the `skipped` event, in `galahad do`, in a quest's standing and at the top of a trial run), because what answers is what is paid for and, in a trial, what is measured. A role held to one model (`--pin`) has no next one: the call fails |
| His talk with you, and everything else | Never. An answer that isn't coding work passes a plan's models over without a word (the role's other models answer) and says why when a role has nothing else, or when a model on a plan is asked for by name. That is by construction: a plan's key is handed over only for coding and to the gateway (`resolveProvider(…, "coding" \| "tool")`); for any other call of his a plan resolves with no key, so his chat with you, his loops, his heartbeat, embeddings, decisions, pictures and anything written later cannot call one. `provider models` lists the models the preset names without asking the plan |
| The doctor | A plan on a role is not "a first model skipped on every answer": the role's line says his coding and his knights' tools use it, it is never asked the doctor's one word, and the role is judged by its other models. The engineer and the reviewer, whose work is all coding, can be played by a plan alone; the planner, who also talks with you, cannot |
| Adding one | As its own preset, because a plan's key can't always be told from the same vendor's API key (Z.ai's can't, and Volcengine's, BytePlus's and StepFun's plans take the vendor's ordinary key at the plan's own address). Kimi's `sk-kimi-`, Xiaomi's `tp-` (`ttp-` for a team) and MiniMax's `sk-cp-` are recognised when pasted; `sk-sp-` is not, because Alibaba's two plans and Tencent's share it. `galahad key add --provider zai-coding` seals the key, pins it to the plan's host, and prints the roster line that puts it first for coding |
| A provider of your own | A provider you add under another id is yours: Galahad knows nothing of its terms and treats it as any other |

**What each model can do, measured.** The best suited takes each task, and that holds for models too: `galahad roster check <provider/model>…` (or `POST /api/models/check`, yours alone) measures three things in about eight calls (`packages/brain/src/checks.ts`). *Format*: the opening of two small quests, briefed exactly as a quest's engineer is, with a stand-in for the sandbox: how many replies held a command (or said DONE or GIVE UP). *Reading a screen*: a page drawn once by Chrome (`packages/brain/assets/check-card`), its largest heading asked for. *Placing a click*: the centres of eight things on that page, each judged by whether it lands inside the thing as the page itself measured it. The result is recorded in the mind (`model.checked`, LWW by model) for every node, shown under `galahad roster`, and used: a model found not to follow the format is passed over for the quest loop's turns while another can take them (asked anyway if it is the only one, or named on purpose); a picture goes to a model found to read screens, and not to one found to misread them, whatever the rule of thumb (`seesImages`) says; and with no model named for the `eyes` role, a knight's eyes are the checked model that reads screens and whose clicks all land, nearest the mark, among the models he offers (of a coding plan, the ones its preset names). On 14 November 2026 this would have caught `kimi-k3.1-pro` (a reply with no command in two turns of three) and `qwen3.8-max` (places on its own 0 to 1000 scale) before a task failed on either.

**A plan's spent window.** A plan's allowance runs in windows (OpenCode Go: five hours, then a week and a month). When a provider refuses a call saying its allowance is spent and when it resets (`resets in 1h 37m`, `try again in 20s`), the node remembers that until then (`packages/brain/src/windows.ts`, in memory: a restart forgets, and the next refusal teaches it again). Until it resets that provider's models are passed over without being asked, each time saying until when, and the next model on the role answers; the doctor says the same of a role's first model, and `galahad roster` marks the models and says until when. Before this, every call of a sweep asked the spent plan first and failed slowly before the next model was tried.

**Each plan is held to its own terms** (read again on 16 November 2026; the research is in the sessions that did it). What each allows is written on its preset (`CodingPlan.allows` in `providers.ts`) and enforced where the key is handed over: **OpenCode Go** is "designed for OpenCode and other coding agents", so his own coding calls and the knights' tools both run on it; **Z.ai's GLM Coding Plan** is not for "directly invoking model APIs from your own applications", so it runs only inside the coding tools it names (a knight's OpenCode, Claude Code, Codex or Hermes, or a tool under `galahad run`), and his own quests pass it over saying why; **Xiaomi's MiMo Token Plan** (only "in programming tools (such as OpenClaw, OpenCode, etc.)", never "automated scripts"), **Volcengine's and BytePlus's Coding Plans** ("Not available for API calls") and **StepFun's Step Plan** (only through the tools it names) are held the same way; **Kimi Code**, **Alibaba's Coding Plan and Token Plan**, **Tencent's Coding Plan** and **Baidu's Qianfan Token Plan** are for interactive use only, and **MiniMax's M Plan** is "designed for individual, interactive developer use" (read the stricter way until MiniMax says more), so the gateway lends them only to a tool you run yourself (a `galahad run` token) and refuses a knight's VM or a quest's sandbox, and no knight's harness is given them.

Plans checked against the vendors' own pages in November 2026: Z.ai's GLM Coding Plan, Moonshot's Kimi Code, Alibaba Cloud's Coding Plan and Token Plan, OpenCode Go, Xiaomi's MiMo Token Plan, MiniMax's M Plan, Volcengine's and BytePlus's Coding Plans, StepFun's Step Plan, Tencent Cloud's Coding Plan and Baidu's Qianfan Token Plan. NanoGPT's subscription, Synthetic's and Ollama's cloud are flat-rate too, but their terms put no rule on what calls them, so they are providers like any other (NanoGPT's keeps its subscription to personal, non-commercial use). What a plan allows changes, and is its vendor's to say, and so is whether Galahad counts among the tools it supports: Z.ai keeps its plan to "officially supported tools", where he is not listed; Xiaomi's and StepFun's name the tools they support, and he is not among them; Kimi's, Alibaba's, Tencent's and Baidu's keep theirs to interactive use and name scripted batch runs as outside it; Kimi was reported to turn away clients it doesn't know. He never calls under another tool's name to get round any of that. What you set him and his knights to on a plan is yours to weigh. Nothing here measures a plan's remaining allowance or waits out a spent window.

**A subscription's sign-in is not a key.** A Claude subscription signs in to Anthropic's own apps (the token `claude setup-token` prints starts `sk-ant-oat`), and Anthropic's terms keep the sign-in to its own flow and its own unmodified tool. Pasted where a key goes it is recognised and refused, by the CLI before anything is sent, by the PWA as you type and by the node (`400`) for every provider and connector; it is never sent to an API from here, and Galahad has no way to hold or use one. Claude Code or Codex signed in on your own subscription works with Galahad as it always has: as an agent over MCP (§8¾), on its own sign-in, in its own process.
- **An answer with no words in it is never an answer.** A reply that stops arriving before the model was done (no finish reason, no end-of-stream marker), and one that ends cleanly with nothing said in the whole answer, are failures that say how the provider ended them: the next model takes over if nothing had happened yet, otherwise the answer ends with that error. Neither is kept as "done".
- **A reply ended by the provider's content filter** (`finish_reason: content_filter`, which is how a router passes on a model's refusal) is a refusal. Such filters aren't steady: the same conversation often passes the next time. So a call the filter ended before it said or asked for anything is asked again, up to twice, with the conversation as it stood (what he'd said and done stays, and no tool runs twice); after that it's a refusal like any other. **A model that declines for good after it has only looked** (every tool it ran is declared read-only: `recall`, `fleet`, `archive_search`, …) hands the answer to the next model in the roster, which starts it again from your message and may look again; the skip is reported, and the bank's rules stay as they were (the tools are one set for the whole answer). Once a tool that may change something has run (`remember`, a sandbox, a connector), no other model takes over: the answer ends, and says he declined. Found on ultra: his own quest reports about probing a sandbox (its kernel, whether it looks like a virtual machine), brought back by a recall, made the filter end one reply in two.
- **What a call cost is counted, as the provider reports it.** Every model call's tokens (in and out, and the cached and reasoning part where the provider says) are read from its own answer: an OpenAI-compatible stream is asked for its usage chunk (`stream_options.include_usage`; an endpoint that refuses the option is asked without it from then on, by base URL), Anthropic's final message carries its usage (the input is what was sent fresh, read from the cache and written to it). `chat()` yields one `usage` event a call with the model that made it; **a provider that says nothing gives `null`, said as "unknown", never an estimate**, and a call that never reached a model (no key, a refused request) yields nothing. Whoever made the call tallies it by role and model (`packages/core/src/spend.ts`): a quest's planner, engineer and reviewer, every attempt and the pick; a trial; a loop's quest (its run's summary says it). Each node keeps its own count in its local database (`usage_daily`: a row per day, who asked, role and model; numbers and the names of models, never a prompt or an answer), shown by `galahad usage`, `POST /api/usage` (`mind:read`) and the Models page. **It is not in the mind's log:** it is one node's telemetry, a row for every model and day, and nothing any replica decides on. What must be the same everywhere is in the log instead: your prices (`price.set`: `galahad price set <provider/model | provider/*> <in> <out>`, `brain:write` and yours alone: an agent can't say what "cheaper" means) and what each trial spent (`trial.spent`). Money is computed when you look, at the prices you state now; tokens are always shown, money only where every model that answered has a price. Not counted yet: what a coding agent (`--agent opencode`) or any other tool spends through the model gateway (those calls pass through as they are, not through `chat()`), and embeddings.
- **Persona and context:** the standing persona prompt is byte-stable, so it caches well. Relevant memories and archived entries (§10⅔) are appended after it, each fenced as data: one JSON record per line between tags with a fresh random nonce, labelled with its trust. In your chat he recalls for the latest thing you said. For a quest's calls he recalls for what the quest is (how its conversation began), and that block's fence is the same for the same records (its nonce is made from them with a key of the node's own, which no record can know), so every turn of a quest is sent the same beginning and a provider can read it from its cache. Before 14 November 2026 a quest recalled for each command's output under a new fence, so the prompt changed after the persona on every turn: its first real run read 2 % of its input from a cache. Anthropic caches only what a call marks: on its own API each call marks the tools and the persona (one prefix, the same from one turn to the next) and, through the top-level mark the API moves to the last block, the conversation so far, so the next call reads both at a tenth of the input price or less; the recalled memories go after the first mark (`context`, adapters.ts). An endpoint that only speaks Anthropic's format is sent what it was, unmarked. A cache write is billed at 1.25× the input price and counted at the input price (usage has no field for it), so on Claude the cost shown is a little low for the call that writes.

**One Galahad on every surface.** Chat in the PWA and `galahad ask` have the same tools agents get over MCP (§8¾), defined once in `packages/node/src/tools.ts`:

| | How |
|---|---|
| **The loop** | `chat()` in `packages/brain/src/chat.ts`: the model calls tools in rounds (at most 12), sees each outcome, then answers. The client gets `tool` and `tool_result` events between the text. Anthropic goes through the SDK's tool use: thinking blocks go back with their signatures, and a refusal never runs that turn's tools. OpenAI-compatible providers use function calling, and DeepSeek's reasoning goes back within the loop. A runtime without tools (some local models) answers without them. A model that fails before anything happened falls back to the next; after a tool ran, a failure ends the answer, so nothing is repeated. |
| **Who acts** | In chat, Galahad runs his tools as the agent `galahad`, with the caller's scopes minus what agents may never hold (`vault:write`, `fleet:admin`, `gateway:mint`, `brain:write`). So his memories are `agent`, his sandboxes are his own, and outward or destructive calls are filed for your approval exactly as an agent's are. No agent can be minted under that name. An agent that calls chat keeps its own powers. |
| **Same checks** | The tools reach the node through the same routes as over HTTP, in process: the route's scope, zod validation of the input, the handler. The model's arguments are checked against the tool's schema before anything runs. |
| **The bank** | Offered only when the caller holds `bank:read`. Once bank data is in an answer, tools that can carry data out (`web_search`, `connector_call`, `sandbox_run`, `sandbox_exec`, `decide`, flow `egress`) and tools that write the model's words into the shared mind (`remember`, `request_secret`, `connector_request`, `sandbox_save`, `sandbox_create`, flow `record`) are refused for the rest of it. Every tool either only reads the mind or names its flow; a test holds them to it. |
| **Pictures** | A tool's result can carry a picture (none of his own tools hands one back today; the path is kept and tested). Claude gets it as an image block inside the tool result; an OpenAI-compatible model that's documented to see and whose provider takes a user message after tool messages (Ollama's vision models) gets it as a user message after them (tool messages are text only); every other model gets the picture in words (`seesImages`, `withoutImages` in `packages/brain/src/adapters.ts`). DeepSeek is text only and Mistral refuses a user message after a tool message, so both get words. Over MCP the picture goes as image content. |
| **Long answers** | An answer cut off by the model's output limit goes on where it stopped (up to 3 times; some providers' default limit is short), and says so if it still didn't finish. A tool result over 30,000 characters is cut with a note that tells the model to ask for less (a filter, a narrower range, the next page). |
| **Steering** | A message of yours can reach an answer that's under way (`Steering` in `chat.ts`; §10¼ says who offers it). It's taken at the next **safe point**: a model call is ended cleanly and what he'd said stays said; a tool that is running always finishes and its outcome is reported first, and tools of that round that hadn't started aren't run (each gets an outcome that says so); a message that arrives as the answer ends is answered in the same turn, after the whole answer; one that arrives after the end is refused, because it's a new turn's. Both provider formats take it the same way (`interject` in `adapters.ts`): what he said (or a pause in his own words), then your message as a user's, so no tool call is ever left without its outcome and no provider is handed a user message straight after a tool's. The tools are the same set for the whole turn, so what the bank's rules refuse stays refused after a steer. Each steer gives the rounds a new message would, never more at once. |
| **Quests** | Their roles keep their own tools (the workshop's shell, the reviewer's reading): they ask for chat without tools (`tools: false`). |

## 6½. The Roundtable: your other knights

The team controller (`packages/node/src/team.ts`, `team-store.ts`, `team-runtime.ts`) owns worker identity, rooms and DMs, bounded delivery, task dependencies and exclusive access to each worker. Worker conversations use the shared `recall` and `remember` brokers; their separate working notes are local execution context. Distinct workers can run in parallel. Owner management routes require an owner principal and their declared scopes; every mutation requires `fleet:admin`. Workers coordinate through a broker that fixes the sender identity and carries the initiating job allowance across handoffs. Galahad grows the team himself through the same service: `recruit` makes a new worker (from his own conversation with the owner by the tools `team`, `team_recruit` and `team_message`, routes that accept only his in-process principal; or from a worker's turn, into its room), and `say` posts his own words. Both only add, record who made what, and stay inside a daily allowance and the existing chain and worker budgets.

Every worker's shell is bound to a persistent Kata VM, provisioned on first use or explicitly by the owner. No available VM means an error, with no container or host-shell fallback. A repository is cloned through a scoped read-only gateway; each engineering task gets its own worktree. Native, OpenCode, Hermes, Claude Code and Codex harnesses feed the existing quest runner's command gates and independent review (Claude Code and Codex are the vendors' own tools, on the sign-in the owner gave them in that VM or on a roster model through the gateway: [ROUNDTABLE](ROUNDTABLE.md#claude-code-and-codex-your-subscription-does-the-coding)). A dependency unblocks only after verified completion and passes result text, not automatic cross-VM file integration. Stop-and-revise creates a successor task; live task steering and a full PR/CI-repair loop remain unimplemented. Removing a worker is the owner's: its work is stopped, its record is retired (kept, with its handle never reused) and its VM is destroyed only on the owner's explicit word.

A harness in a VM can be given a **notes store** it can ask in the middle of a task: Engram, pinned in the image, its SQLite file on the knight's own disk (`/work/.memory/engram`), started by the harness itself as a stdio MCP server with four tools and a project pinned to the knight's repository (`packages/brain/src/engram.ts`; each driver's entry is its own: OpenCode's `mcp.servers`, Hermes' ACP `mcpServers`, Claude Code's `--mcp-config`, Codex's `-c mcp_servers.engram.*`; the native engineer has the `engram` CLI in its shell). One switch on the controller turns it on for all its knights (`teamEngram`, `fleet:admin`, the owner's alone; off by default). A task asks its VM for the pinned version as it starts and says in its progress and its result whether it had the store. It is the least trusted memory in the system, a cache of leads a task checks by running, and nothing of it leaves the VM by Galahad's hand: [ROUNDTABLE](ROUNDTABLE.md#a-notes-store-the-harness-can-ask-engram).

The knights' profiles, messages, jobs, allowances, notes and VM bindings live in the controller's `team.db`, separate from the replicated mind. They survive restart but do not sync or rebuild from its event log. Interrupted work is held for explicit review and resume. Retained workspace disks survive ordinary cleanup; rollback must keep the retention-capable helper. [ROUNDTABLE](ROUNDTABLE.md) covers setup, lifecycle, storage and the distinction between implemented behavior and live deployment verification. The separate [Hermes memory plugin](../integrations/hermes/README.md) connects a locally installed Hermes to shared memory.

## 7. Placement: using every body well ✅

`place(needs, nodes)` applies **hard filters**: online, docker, VM, GPU, memory, tools, local models, "untrusted work only where it can be sandboxed", and a node whose ceiling takes no sandboxes. It then ranks the remaining nodes with **soft scores**, and every decision carries its reasons (`galahad place`, the Fleet page's "Where would this run?").

| Body | Gets |
|---|---|
| **Server** (always-on, docker, KVM) | Long quests, untrusted or web-facing work in containers and VMs, local models if it has a GPU, cron, being the relay |
| **Laptop** | Interactive work ("you are here"), the repos you're editing. Avoided for long work while on battery. |
| **Phone** (PWA) | Chat, approvals, adding keys, pairing |

**Measured, not guessed.** A node's strength in the ranking is what it measured when it calibrated itself (§11), in reference cores' worth ("measured 18.7 reference cores' worth"), so sixteen fast threads can outrank sixty-four slow ones. A node that hasn't measured itself yet is guessed from its thread count at half weight, and its reason says it's a guess. Work that needs local models prefers the node whose model measured faster.

**Capacity-aware.** A node with a sandbox slot free is preferred ("3 of 4 slots free"); a full one is ranked behind, further the longer its queue ("full: work waits for a slot (2 ahead)"); one whose use isn't known says so and is neither favoured nor ruled out. A sandbox nobody pinned to a node goes to the host placement ranks first, this node or another, and what follows (its commands, keeping its work, its end) goes where it went: a second sandbox host is used from the moment it's enrolled, without being told. Work that fits nowhere now **waits** for a slot on its host (§11); it never runs on top of a ceiling.

**Between two syncs.** Another host's slots are known only as of its last sync, a few seconds old, and a trial run or a quest at effort asks for several sandboxes in the same instant. Placed by the same picture, they all went to the best-ranked host and queued there while the others stood idle. So the asking node counts, on top of each host's last report, what it has itself sent there since and what it has ended there (`Dispatched` in `packages/node/src/placement.ts`), and drops that once the host has reported again. In the compute simulation (`bun run bench compute`, [BENCHMARKS](BENCHMARKS.md)) a trial run on eight machines finished 12 % sooner for it at effort 1 and at effort 3, and no sandbox waited while a slot stood free (before: up to 24 minutes, with 27 to 46 % of the slot-time in use spent waiting beside a free slot).

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

Any node with Docker is a **sandbox host**; ultra is the first. A sandbox is where a knight works: one hardened container per task, created in seconds and discarded afterwards.

| Property | How |
|---|---|
| **Unprivileged** | uid 1000, `--cap-drop ALL`, `no-new-privileges`, read-only root, tmpfs `/tmp`, its own workspace. No other host path and no Docker socket. |
| **Within the ceiling** | Every sandbox first takes a **slot** on its host (§11): it's admitted only inside the threads and memory you let him use there (by default half the machine) and while the machine itself has room; otherwise it waits its turn, where you can see it. One asking for more CPUs or memory than the ceiling gets the ceiling. A knight's own VM, kept between its tasks, takes no slot: it holds its memory of the ceiling for as long as it is kept, and its threads while it works (a command runs in it, or one ended less than three minutes ago: it thinks between them). So resting knights never keep work waiting, and working ones count: new work sees the less room, while a knight's own work never waits (its VM is already there). A VM that grows while it runs is held at its new size the same way (`admitGrowth`). There is no other door: the node holds only the governed host, so quests, agents, a calibration and you all pass through it. |
| **Bounded** | CPU, memory (no swap), process and **disk** limits. `/work` is the sandbox's own fixed-size ext4 image (20 GB by default; sparse, so it takes only what's written), so a runaway job fills its own workspace, never the host's disk. Every command runs under an in-container `timeout --signal=KILL`, so a stuck task can't outlive its deadline. |
| **Its own kernel, for untrusted code** | On a host with KVM, a sandbox can be a **microVM**: the same hardened container inside its own lightweight virtual machine with its own kernel ([Kata Containers](https://katacontainers.io)), so a kernel exploit lands in a throwaway VM, not on the host. `online` sandboxes (code and content from the internet) are microVMs by default wherever the host has them; you can choose either for any sandbox (`--vm`, `--container`). |
| **Networked by intent** | `isolated`: no network. **`gateway`** (the default): a Docker `--internal` network whose only reachable host service is a sandbox-only model gateway on the bridge IP. UFW allows exactly one port on `galahad0`. `online`: egress plus the gateway. Sandboxes can't reach each other: inter-container traffic is disabled on both networks. |
| **Keys stay home** | A sandbox that may use models gets a gateway token scoped to the providers you chose. It expires with the sandbox and is revoked on destroy. The sandbox never holds a provider key. A request names model providers only, and only ones the fleet has: the gateway's own scopes are the node's to give, `search` through the request's search flag, `git:…` (one repository) only in a token minted through `gateway:mint`, which agents never hold. Asking for one by name is refused, at the contract and again on the host. (`world`, the scope every networked sandbox carried for the 3D world until 14 November 2026, is retired: it stays reserved, and a sandbox from before that still names it gets nothing by it.) |
| **Accountable** | Every create, exec and destroy is a signed `ledger.recorded` event in the mind, readable from any device (`galahad ledger`). |
| **Oath-gated cleanup** | The TTL reaper may destroy *ephemeral* sandboxes on behalf of the quest that created them. Destroying a *persistent* sandbox asks first. A request from you counts as the approval. |
| **Fleet-wide** | `galahad sandbox run -- …` on any device is placed on the sandbox host with room that measured strongest (§7), or pinned with `--on ultra`. It's forwarded as a signed node-to-node request. A forwarded request always runs where it lands, so work can never bounce between nodes. |

Network reachability was verified on ultra before it was built. From an internal-network container, the gateway port is reachable only once the UFW rule exists. The internet, Coolify (8080) and Galahad's local port (7777) all stay blocked.

**Disk.** Mounting a workspace image needs root, and the node has none: its service runs with `NoNewPrivileges` and a read-only view of the system. So `deploy.sh --sudo` installs a small root helper, `galahad-workspace` (in `sandbox/`), that systemd starts once per connection on `/run/galahad-workspace.sock`, a socket only the galahad user may open. It accepts fixed commands (`create`, `mount`, `retain`, `remove`, `remove-owned`, `stats`, `stats-v2`, `ping`), validates 10-hex-digit workspace IDs and sizes, and builds every path itself under a root-only directory. `mount` only remounts existing data; `retain` marks persistent worker disks to survive orphan cleanup, and ordinary `remove` refuses them. The node uses `remove-owned` only for an owner-approved destruction. An unmounted mountpoint is mode 000, so a container started without its workspace can't write to the host's disk through it. A **budget** guards the host: a sandbox is created only if every workspace could still fill up to its limit and 10 % of the disk (at least 20 GB) would stay free. Without the helper, ordinary workspaces are unlimited Docker volumes and the heartbeat says so; image-backed Team workspaces require retention support, while volume-backed Team VMs remain possible without a disk quota.

**What the image holds.** `galahad/sandbox:1` (`sandbox/Dockerfile`) is Debian trixie-slim with git, ripgrep, jq, curl, python3, build-essential and bun, plus two tools fetched by version and checked against a SHA-256 before anything of them is kept: OpenCode 2.2.6 (`/opt/opencode/bin`) and Engram 3.7.2 (`/opt/engram/bin`, about 22.6 MB; its store set to `/work/.memory/engram` and its update check off). They are root's files on a read-only root, so nothing running in a sandbox can swap one. A bump of either is one reviewed change to its two build arguments; Engram's also has to say what becomes of the stores there are, since a newer binary migrates a store when it first opens it and there is no way back. A container keeps the image it was made from: a knight's VM made before the image held Engram has none, and says so.

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

Tools: `recall` (a long memory, such as a quest's whole report, comes shortened to its first 600 characters with how much is left; `full=true` gives it whole: twelve whole reports were twelve thousand characters carried through every later step of an answer), `remember`, `web_search`, `decide`, `fleet`, `compute` (the census, read-only: no tool raises a ceiling, changes the budget or makes a node measure itself), `place`, `sandbox_run` / `create` / `exec` / `destroy` / `save`, `artifacts`, `artifact_read`, `archive_search`, `archive_read`, `note_idea`, `ledger`, `request_secret`, `connectors`, `connector_call`, `connector_request`, `loops`, `notices`, `skills` and `skill_read` (his skills, read-only, as data: one that waits for your approval shows no words) and `skill_write` (a proposal that waits for you: his own when asked to write up how he did something, or an outside agent's; §9½), and the four bank tools for an agent granted `bank:read`. They're Galahad's own tools (`packages/node/src/tools.ts`), the same ones his chat uses (§6); each names the routes it calls, and an agent is offered the tools whose routes' scopes it holds. Resource: `galahad://oath`. Server instructions tell the agent when to use each. A real MCP client exercises this end to end in `packages/node/test/mcp.test.ts`.

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
- **Bounded.** A step budget (default 30 commands), a per-command time limit (300 s) and two revisions at most. Older observations shrink to excerpts so long quests stay affordable, a batch at a time: the conversation only grows at its end until more than twelve observations are whole, then all but the newest four are cut together, so most turns are sent the turn before's conversation unchanged with one exchange more, which a provider reads from its cache (cutting one more on every turn rewrote the middle of the conversation each time). Of those cut, a run of a command that ran again later among them (the tests, after each edit) is only its first line and a note that it was superseded: its newer output is further on. So is a file's contents read by a plain read (`cat`, `head`, `tail`, `nl`, `sed -n`) that a later command among them changed and that exited 0 (a redirect, `sed -i`, `tee`, a move, a copy, a removal, a restore): the note says what changed it, and to read it again. A read or a write it can't be sure of (a pipe, a glob, a substitution) is never called stale (`packages/brain/src/shell-paths.ts`). A reply of the engineer's that runs away (a file written inline, a model that doesn't stop) has its command run as sent, but the conversation keeps only its beginning and end and tells him so once; the reviewer's trail shows such a command the same way. (A single reply of over 400,000 characters once ended a trial: no chat call would take the conversation after it.) A reply with no command to run (no `sh` block, or more blocks than allowed) spends a turn and runs nothing: he is told what was wrong, the reply's beginning is kept with the event so it can be read afterwards, and it is never counted as a command. Three in a row end the quest as stopped, saying what he was told and how the last reply began. A quest may also try its gates once before the work (`gatesFirst`; on for a knight's tasks): the engineer is told what each did as the workspace stood (it fails now, it passes already, it could not run here), and the reviewer is told that a gate which passed before any work shows nothing by passing after it. A gate that cannot run in the workspace is then known before the work is paid for. When few commands are left he is told so with a command's result (once at ten, then on each of the last five). And a quest may put the work as it stands to the gates and the reviewer when the commands run out (`submitAtLimit`; on for a knight's tasks): an engineer who finished and went on checking is judged like any other, and what the gates and the reviewer pass is done. (A knight's engineer once sent sixteen in a row, its whole budget: sixteen paid calls, nothing run, reported as "16 commands", and no word of what it had sent.)
- **Contained.** The default network is `isolated`; `--net gateway` or `--net online` is your explicit choice. The sandbox is destroyed afterwards unless `--keep`. Ctrl-C stops after the current step and still cleans up.
- **A budget in dollars.** `budgetUsd`: money the quest's model calls may spend at your prices (`deps.spentUsd` says how much they have: core's `costOf` over the quest's own tally). The engineer is told what is spent with each result, and to wrap up past four fifths; once spent, the work stops as when its commands run out, `submitAtLimit` deciding whether what is there is judged (`budget` events). A knight's task carries one when you give it (`budgetUsd` on `TeamTaskInput` and `TeamGiveInput`), and so does `galahad do --budget-usd 2`: one budget for the run, every attempt's calls counted against it together, at the prices the node had as the run began.
- **The tests are the contract.** A test file a gate names word for word (`bun test src/sum.test.ts`; not a bare `bun test`, a folder or a pattern) is read before the work (`sha256sum`), and a submission that changed it goes back before any gate runs on it (`locked` event), so a gate never passes on tests the work rewrote. One the work is to write isn't there before, so it isn't held (`testFilesOf` in `packages/brain/src/shell-paths.ts`).
- **Outcomes are honest.** `done` (the reviewer passed it), `unverified`, `gave-up` (the engineer says why) or `stopped`.
- **An outage isn't the end.** A model call that fails (a provider down, a reply cut off mid-stream, which the roster can't fall back from) is asked again after 15 s, 60 s and 3 minutes; only then does the error stand.

### Gates: done means this command passes ✅

`galahad do "<goal>" --gate "<command>"` (repeatable, at most 8) says what "done" means in a way a program can check. A gate is a shell command, run in the quest's own sandbox when the engineer says DONE.

| | How |
|---|---|
| **Before the reviewer** | Every gate runs, in order, on every submission, and **every one must exit 0 before the reviewer is asked at all**: the reviewer's model call isn't spent on work that a test plainly fails. A gate the sandbox can't run has not passed. |
| **A failing gate** | Its command, exit code and an excerpt of what it printed go back to the engineer as a revision, within the one revision limit (a gate's failure and a reviewer's REVISE share it). The engineer is told the gates up front, word for word, and that it can't change them. With a coding agent the failure continues the agent's own session. |
| **Failing twice** | A gate that fails again as it failed the submission before (twice in a row, whatever it printed: a test run's timings differ each time) moves the rest of the work to the planner's models, if an attempt is left: the next turn is told to find out why it fails before trying again, the reviewer stays who it was, and the move is said once (the `escalated` event: in `galahad do`, where a quest stands, a knight's timeline). On for `galahad do` and a knight's tasks; off with the engineer held to one model (`--pin`: what is measured is that model) and in a trial unless its variant is `escalate`. Its turns are still the loop's (`loop` on the chat route), so a model checked as not following the loop's format is passed over for them too. A coding agent's run keeps its own models. |
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
| **Visible** | The census lists quests in hand with their effort and each attempt (`galahad compute`, the Fleet page). |

The orchestration is pure (`packages/brain/src/effort.ts`: attempts and reviewer injected) and scripted in `packages/brain/test/effort.test.ts`; `packages/node/test/compute.e2e.test.ts` runs a quest at effort 1 and 3 on a real node with a stand-in Docker and stand-in models: three attempts at once within the ceiling, three models, three reviews, one pick, taken.

### Coding agents: stamina for real codebases ✅

`galahad do --agent opencode "<goal>" [--minutes 60] [--repo https://…]` keeps the plan and the independent review, and hands the work to a full coding agent: **OpenCode** (v2.2.6, pinned and checksummed in the workshop image), with its own file viewer and editor, search and shell, working for up to `--minutes` instead of one command per turn.

| | How |
|---|---|
| **Models** | The agent calls models itself, through Galahad's gateway: the engineer's models on OpenAI-compatible providers with a key, in the roster's order, on a token scoped to those providers and to the sandbox's lifetime. It never sees a key. If a model fails (an outage, a provider's content filter), the next carries on the same session. |
| **Runs long** | It runs headless in the background inside the sandbox (its own process group, stdin closed), so no single command's time limit applies; Galahad follows its event stream every 10 s, so every command and edit it makes appears as it happens. Past `--minutes`, or on Ctrl-C, its whole process group is stopped. |
| **Reviewed** | When it ends, the `reviewer` judges its work from the sandbox (`git status` and `git diff --stat`, what's in `/work/out`) and its last 40 commands. A REVISE continues **the agent's own session** with the notes, at most twice. |
| **Kept** | With `--repo`, the repository is cloned first (`--net online`) and its changes are kept as `/work/out/changes.patch`, new files included, in the quest's artifact. |

The driver is pure orchestration over `exec` (`packages/brain/src/agents.ts`), tested against OpenCode's real event stream and a fake sandbox. Claude Code and Codex have drivers too (`packages/brain/src/vendor-cli.ts`), for a knight's VM where the owner installed them: the workshop image carries neither, and Galahad never fetches one.

### Shipping: pull requests through the oath gate ✅

A sandbox never holds a GitHub key. It **reads** through the node's **git gateway**: a quest on a GitHub repository (private ones included) clones `http://<gateway>/git/<connector>/<owner>/<repo>.git` with a token minted for that one repository for the quest's lifetime; the node adds the connector's key on the way to `github.com` (a host fixed in code, never a manifest's say), serves git's smart HTTP **fetch only**, ledgers the read, and revokes the token when the quest ends. The clone's `origin` points back at GitHub and keeps no credential. It **can't push**: instead a quest on a clone (`--repo`) leaves a **shipment** in its kept work: `ship/manifest.json` (the commit it started from, the remote, each changed file's path and mode, deletions) and `ship/files/…` (the new contents), beside `changes.patch` for reading.

`github.ship` is a **native tool** of the GitHub connector: one outward action, carried out by the node itself. When you approve it (or a standing order does), the node, with the connector's key on its pinned origin (`api.github.com`), uploads each file as a blob, builds one tree on the starting commit, commits it, creates a **new** `galahad/…` branch (one that exists is never touched) and opens the pull request; the receipt in the mind names the PR. **After it ships, the node that shipped follows the pull request's checks** (`ci-watch.ts`): every three minutes for a day it reads the branch's check runs (`github.checks`, a read, ledgered), and once every check has ended, a failure becomes a notice in your Inbox ("CI failed on owner/repo#12") naming each failing check and what it reported against the code (`github.check.annotations`: file, line, message; bounded, a line that looks like a key left out). All passing clears it (a later push fixed it) and the node stops looking; a branch with no check twenty minutes on has no CI to follow. It writes nothing to GitHub. A GitHub connector installed before it could read checks is said once in the node's log: add it again. Every file is checked against the SHA-256 recorded when it was kept before it leaves.

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

Two more suites run the same way. **Agentic** (`--suite agentic`): a small repository and a task generated from a seed, put in a fresh sandbox with no network and worked as an ordinary quest; then what he left is taken out and **hidden tests** run in another fresh sandbox he never had (`packages/node/src/trial-agentic.ts`; the tasks, their hidden checks and reference solutions in `packages/brain/src/agentic/`, never in a sandbox he works in). Each hidden check is an answer in the same `trial.scored` record (expected 1, got 1 or 0), so every replica re-checks it as it does a number. **Reviewer** (`--suite reviewer`): a quest's evidence with a known answer, put to the reviewer in the words a quest uses (`reviewQuestion` in `packages/brain/src/quest.ts` builds both), scored by whether its verdict is the careful one.

A run records what set it apart in `trial.run` (open in the log): its effort, the roles it held to one model (`--pin engineer=<provider/model>`: that role asks exactly that model, through the chat route's `model`), its **variant** (a named set of harness switches: a task's gates, the planner's own gates, effort, skills offered, the archive's context, revisions), its seed, the group of runs it was made to be compared with, and its budget. Every trial is recorded with what it spent (`trial.spent`). From those records alone, pure functions in `packages/core/src/trial-reports.ts` (the CLI and the app run the same ones) say which model is best in a role and best for its cost (`galahad trial sweep`), whether a variant measurably helps, measurably hurts or makes no measurable difference, with what each point cost (`galahad trial ab`, `trial compare`), and the reviewer's two error rates. A run keeps to a budget in tokens (and money, where every model that answers is priced), says first what past runs of the same problems cost, and stops cleanly when it is spent.

## 9. Loops and the heartbeat ✅

A **loop** is work Galahad does on a schedule: `every 30m` (aligned to the clock) or a five-field cron line read in an IANA time zone (`0 7 * * 1-5` in `Europe/Copenhagen`). Loops live in the mind, so every device sees them and their history, and each names **exactly one node** that runs it, so a loop never runs twice.

| Task | What a run does |
|---|---|
| `heartbeat` | Galahad's regular look around (below), then what he may fix himself (self-action, below) |
| `quest` | A quest in a fresh sandbox (§8⅞), through a short-lived **arm token**: its sandboxes are its own and ephemeral, its memories are `untrusted`, and it can't touch the vault, devices or the roster. Its task may carry your gates (`gates`): a run whose gates never pass is never `ok` |
| `call` | One connector tool (§10). A loop is Galahad acting on his own, never you, so an outward or delete tool files an approval request instead of running |

A loop a fleet still holds whose task this version no longer has (`reflect`, his journal; `review`, his review of the 3D world; both removed on 14 November 2026) stays in the mind and is still listed. It never runs, a run by hand is refused, and every surface says its task no longer exists and how to remove it (`galahad loop rm <name>`); the heartbeat and the other loops go on.

| Guarantee | How |
|---|---|
| **At most once per slot** | A run is marked in node-local storage before it starts and recorded in the mind (`loop.ran`) when it ends. A crash in between is recorded as *interrupted* on the next start and never rerun. |
| **No pile-ups** | A node that was away runs a missed loop once (looking back a week at most), not once per missed slot. At most two runs at once per node; a run past its deadline (2 h) is stopped. |
| **Honest history** | Every run's status (`ok`, `attention`, `failed`, `interrupted`) and a redacted summary are signed events, readable from any device (`galahad loop runs`). A run that fails or needs a look also leaves a notice (one per loop), cleared by its next good run, so a loop that calls a connector is a monitor. |
| **Bounded** | Defining, changing or running a loop needs `brain:write`, which arms never hold. Loop text is scanned for secrets before it's written. |
| **Asked for in chat** | Ask Galahad for something on a schedule ("every weekday at 8, check my open pull requests") and his `loop_draft` tool drafts it: a name, when, what runs and why (`draftLoop`, scope `chat`, which agents hold too). A draft is never a loop. It waits in your Inbox, checked as a loop is (its schedule, its time zone, no key in it), and becomes one only when you add it (`setLoop` with its `draft`, `brain:write`), from the Inbox or with `galahad loop add --draft <id>`; Dismiss drops it. Drafts are kept on the node they were drafted on (`local.db`, `loop-drafts.ts`), never in the mind's log; a draft of the same name replaces the older one, at most twenty wait, and a week unanswered one is gone. Drafting is a `record` tool: refused once bank data is in the answer. |

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
| `calibrate` | This node never measured itself, or its body, its ceiling or the benchmark isn't what it measured with (a GPU, a local runtime, more memory, a new ceiling, a new kernel after an upgrade). At once the first time and when you change its ceiling; otherwise at most once an hour | create | Measures this node (§11): a few seconds at low priority, on no more threads than its ceiling. Every node does this for itself, at its start and when its body changes, under the same allowlist and switch |
| `adapt-compute` | The fleet's compute isn't what his recorded plan says (a node joined, left or was measured again, a ceiling changed) | modify | Re-derives his defaults (each node's slots, the effort `auto` may reach, which host takes sandboxes first), records them (`compute.adapted`) and tells you in a line each what changed (a notice). Internal, and a ceiling of yours overrides it |

Each is parsed against the allowlist (anything else, and any extra field, is refused), checked again against a fresh look at the node just before it runs (it must be exactly a fix the plan calls for then), and carried out by the node's own hands: those four, nothing that can reach a connector, the vault, devices, the roster, the bank or anything needing `fleet:admin`, and nothing that installs, downloads, rents or spends. At most eight after one heartbeat; the heartbeat then looks again, so a fixed problem never becomes a notice. Every one is recorded in the ledger as his own (`resource: self-action`, `quest: galahad.self`, the target naming what it was about), shows on the Loops page under Self-action ("Fixed: …") and in the run's summary. **The switch** is yours: on by default; `galahad self-action off` (or the Loops page, or `setSelfAction`, `brain:write`, which agents never hold) writes `selfAction: false` into every heartbeat loop's task, and on removes it again (so the task reads as it always did); giving the heartbeat a new checklist keeps the switch as it was.

**The doctor: is everything well?** `galahad doctor` looks at one node's whole installation and answers in plain lines, each **ok**, **needs you** or **broken**, with **what to do** for anything that isn't ok. Like the heartbeat it's split in two: `diagnose` in `packages/node/src/doctor.ts` is pure (facts in, lines out; every rule is tested with a healthy node and each kind of fault), and `doctor-facts.ts` gathers the facts from the node. The contract (a check, a report, the exit code) is `packages/core/src/doctor.ts`.

| It looks at | What it says |
|---|---|
| This node | Its place in the fleet; where its device keys are (the keychain, or a key file whose mode is checked, never opened); its home and admin token open to nobody else |
| The mind | SQLite's own integrity check; its hash chain's head, and any device that signed two histories; the **clock** (behind the newest event it holds: broken, as the outbox's guard has it; out of step with a peer by more than half a minute; not synchronised by the system); sync with each peer; the newest **backup** and its age (`backups` in or beside the home, or `GALAHAD_BACKUP_DIR`) |
| The vault | Whether this node can open it; keys he is waiting for |
| Models | Each role on the roster: whether any model can be used here, whether its **first model is skipped on every answer** (a provider that isn't configured or has no key), and a **one-word call** to the first usable model of each role (each distinct model asked once, 20 s at most, six at most): how long it took, or why it didn't answer (a refused key, a limit, a timeout, a reply ended by the provider's content filter) |
| The archive | The embedder (a local one is asked to embed one word; a remote one only by a full check), the index and what waits for a vector, the last integrity check's age |
| Sandboxes | Docker, the image (said when it was pruned; never rebuilt by the doctor), the networks, the disk limit, microVMs where the host has KVM, the firewall unit, and **one sandbox of each kind started, run and removed** |
| Compute | The calibration's age and whether it's stale (its body, ceiling or benchmark changed); slots in use and waiting |
| Loops | Each loop's last run and next; one that keeps failing, was interrupted, is orphaned or runs on a node that's offline; no heartbeat at all |
| Connectors | Each one's manifest and key, and whether its service answers a request that carries nothing (no key, no cookie, no argument; any answer counts) |
| The app | The bundle built and served; whether `tailscale serve` publishes it (yours to fix on an always-on node) |
| Notifications | Whether any device can be reached, and one that stopped answering |
| Disk, the service | Free space; systemd's restart count; lines of the node's own log that read like trouble (kept in memory, redacted) |

| | |
|---|---|
| **It changes nothing** | It writes to no file and no database and installs, builds and mends nothing. A file is stat'ed, never opened; errors are redacted. The one sandbox it starts goes through the node's own governed host (it takes a slot, never queues behind real work, and is in the ledger like every sandbox, under the quest `galahad.doctor`), and is removed before the report is written. |
| **What leaves the node** | Only in a full check that isn't `--offline`: one word asked of each role's model, and one empty request to each connector's origin. `--offline` sends neither; `--quick` looks only at what costs nothing (no model, no container, no integrity scan). |
| **Yours alone** | `POST /api/doctor` (`fleet:admin`; refused to agents and nodes whatever their scopes). One full check at a time: whoever asks meanwhile gets that one's answer. |
| **Exit code** | 0: all is well (lines that weren't looked at don't count); 1: something needs you; 2: something is broken. `--json` prints the report. With no node running it says so, looks at what a stopped node leaves on disk (its key file's mode, the mind's database, the disk) and exits 2. |
| **The heartbeat reuses it** | Each beat takes a quick, offline look and adds what the heartbeat didn't already check, as findings about this node in words that don't change while the problem stands: a clock behind or out of step, backups that stopped, a role's first model skipped on every answer, the embedder not working, the firewall unit down, the app not built or not published, the service restarting. |
| **Surfaces** | `galahad doctor [--offline] [--quick] [--json]`; the **Doctor** card on the app's Overview (a quick look when the page opens; **Full check** when you ask); the route. |

**He comes to you: notifications.** The heartbeat, the inbox, the outbox and his turns all waited until you opened the app. Now he can reach you: **Web Push** to your own paired devices (a web app on an iPhone's Home Screen, a desktop browser), and nothing else. No messaging gateway and no third party's service in between beyond the browser's own push service, which carries bytes it can't read.

| | How |
|---|---|
| **Standards, no new dependency** | `packages/core/src/webpush.ts`, on the noble libraries: VAPID (RFC 8292: an ES256 token for the push service's origin, half a day long, signed with the node's own P-256 key) and encrypted payloads (RFC 8291: ECDH with the subscription's key, mixed with its authentication secret; one aes128gcm record, RFC 8188). The RFCs' own examples are in the tests byte for byte, with a round trip decrypted on WebCrypto, as a browser does. |
| **The node's key** | Made on the node the first time a device asks to be notified, and kept where its device keys are: the OS keychain, or `push-key.json` (mode 600) in its home. Never shown, logged or put in the mind; only its public half leaves (a browser subscribes to it). |
| **Subscribing is your act on that device** | Settings → **Notifications on this device**: the browser's permission is asked only from that tap. The subscription (the push service's address for that browser, and its two keys) is kept as *that paired device's*, by the id its requests are signed with, in the node's private `push.db` (mode 600, `secure_delete`; never the mind, never a log line, never an answer of any route). One browser's endpoint can't be claimed by another device. It's removed when you turn the switch off, when the device is revoked (here at once, and at the next look wherever it was revoked), and when the push service says it's gone (404, 410). |
| **One door** | `NotifyService.tick()` (`packages/node/src/notify.ts`) looks at what stands in the node's own records (notices of warn or alert, actions waiting, keys he asked for) and at what happened (a turn that ended unwatched, a quest you started), asks the pure rules in `packages/core/src/notify.ts` what may be told now, and delivers it. No route, tool or event carries a title or a line: an agent can't subscribe a device, read a subscription, change what's sent or send anything. |
| **What he tells you** (each a switch) | **Something needs you**: a heartbeat finding of warn or alert, once per finding, not again while it stands (nor when it flaps: one that clears and returns within 6 hours isn't told twice; an alert that was told as a warning is). **An approval is waiting.** **He has finished**: a chat turn nobody was watching, or a quest you started (done, unverified, gave up or failed, said as it is; one you stopped isn't news). **He has a question**: an answer that ends by asking, or a key or connector he needs. Never anything for "all quiet": with nothing new there is nothing to send. What stands while no device is subscribed is old news by the time one is. |
| **When he stays silent** | **Quiet hours** (22:00 to 07:00 by default, read in the node's own time zone until you set one; yours to change) hold everything but an alert; when they end, what waited is told as one message. **A burst is one buzz**: everything new at one look goes together, and the next message that isn't an alert waits a minute. **The day's limit** (12 by default) holds everything, alerts too; its last two are kept for alerts, so ordinary news stops at ten, with one message that says so (once that day, and not in quiet hours). Whatever can file an approval or ask for a key (an agent can) therefore can't spend the day on noise and silence the alert that matters. A test is yours to send: a few seconds apart, twenty a day. |
| **What a notification holds** | A short title, one line, and where it opens (one of five places in the app; a kept chat's id for the chat). The line is the node's own fixed sentence, or a notice's title where the node wrote it from one (bounded and redacted when raised, scanned for secrets again here), or your own words (a chat's title, a quest's goal). Never the reason an agent gave, a tool's arguments, a notice's body, the name of a key he asks for (whoever asked chose it, and an agent may ask), or a title a model may have written (his suggestions, a review's): those say only that something in the Inbox needs you. Never anything about the bank: a bank finding, a chat where he read the bank, and your own words when they speak of the bank are told without them (a bank chat only to a device that may read the bank). The tag that lets a newer notification replace an older one is a digest of the item's key under the node's own random salt, never the key (a digest of it travels in the clear as the message's topic). Every message is padded to 1 KB before it's sealed, so its size doesn't say what it holds. |
| **Each device, what it could see anyway** | A notification is built per device from the items its scopes let it open (`mind:read` for findings and approvals, `chat` for a chat, `vault:read` for a key request, `bank:read` too for a bank chat). |
| **Sending** | `packages/node/src/push-send.ts`. The only host called is the push service in the subscription that browser handed over, and only if it is one: https, the standard port, no credentials, a host of Apple's, Google's, Mozilla's or Microsoft's (or one you allow: `GALAHAD_PUSH_HOSTS`), checked when it's kept and again at every send. Redirects are never followed. A busy (429) or failing (5xx) service is tried again twice at most, after a pause; never a loop. News is marked told whatever the service answers, so a failing service is never a reason to send it again. Each notification is in the ledger as his own act (`outward`, resource `notify`): the kind and the devices, never what it said. |
| **The iPhone app** | `packages/node/src/apns-send.ts`. The app turns notifications on for itself (**More → Notifications on this iPhone**, iOS's permission asked only from that tap) and hands over Apple's token for that install with the service its build answers to (`applePushSubscribe`, kept as that paired device's, beside browsers' subscriptions). The only hosts called are Apple's two push services (development for a build from Xcode, production for TestFlight and the App Store), over HTTP/2 as Apple requires, signed with a token (ES256, made again every 50 minutes) from the owner's Apple push key: given once on stdin (`galahad notify apple-key`, route `setApplePushKey`, vault:write), checked to sign, sealed in the vault and used only while pinned to Apple's push service. The payload gets the same last look as a browser's; what a tap opens is the same fixed list. A token Apple no longer knows for the app (410, `BadDeviceToken`, `DeviceTokenNotForTopic`) is removed; busy or failing is tried again twice. Tested against a stand-in Apple over HTTP/2 on loopback (`packages/node/test/apns-send.test.ts`). |
| **The service worker** | `apps/web/src/sw.ts`: `push` reads the payload strictly (`notify-payload.ts`) and shows it; anything that isn't one of ours is shown as the plain "Something needs you", never as what it says and never as nothing. `notificationclick` tells the window that's already open where to go and brings it forward, or opens one at that place. **The number on the app's icon** (the Badging API, where the system shows one: an iPhone's Home Screen once notifications are allowed, a Mac's Dock, an Android launcher): an open page sets it to the Inbox's count and tells the worker; while the app is closed, each push about something new that waits for you (needs you, an approval, a question, several at once; not "finished") adds one, the same tag never twice (`apps/web/src/lib/badge.ts`). |
| **Surfaces** | Routes (below); Settings → Notifications in the app (this device's switch with what's sent and the iPhone's Home Screen note, the kinds, quiet hours, the limit, **Send a test**); `galahad notify` (status, `test`, `kinds`, `quiet`, `limit`, `off`); the doctor's line. |

Routes, all yours alone (the node refuses agents and nodes whatever their scopes): `notify` (`GET /api/notify`, mind:read: devices by name, the settings, today, this node's public key), `setNotify` (brain:write), `pushSubscribe`, `applePushSubscribe` and `pushUnsubscribe` (mind:read; a paired device, for itself: another's only from a terminal or with fleet:admin), `notifyTest` (mind:read; one fixed message), `setApplePushKey` (vault:write). No new event kind: subscriptions and settings are this node's (like chat history), so a fleet's replicas are untouched; the node that serves your app is the one that reaches you. End to end, against a real daemon and a stand-in push service on localhost: `packages/node/test/notify.e2e.test.ts`.

**What isn't built.** A turn that someone is watching on another device isn't pushed (he can't tell an idle desktop from a reader). Approving from the notification itself (action buttons) isn't there: a tap opens the Inbox. Subscriptions aren't shared between nodes: turn it on at the node whose app you use. An iPhone's delivery was not exercised here (it needs the real Home Screen app and Apple's service).

## 9½. Skills: what he learned, kept as notes ✅

A **skill** is how he did a kind of work that passed its review, written down so he can do it that way again: a title, when to use it, the steps as plain text, what proves it worked (commands and what to expect of each), pitfalls. It is **words he reads**. Nothing in a skill runs by itself, and the contract has no field for code, hooks, fetches or an install (a field it doesn't know is refused at the API and ignored from the log).

| | How |
|---|---|
| **In the mind** | Signed events, converging like everything else (`packages/core/src/skills.ts` the rules, `skills-input.ts` what's checked at the boundary, `packages/mind/src/store.ts` the views). A skill is a chain of versions, none ever deleted; its words are open in the log, so a newer node's field never makes an older one refuse it. Each version carries the mind's own trust: `owner` (you wrote it), `agent` (his own, see below), `untrusted` (anything else). |
| **Where it stands** | *proposed* (no version he may use: it waits for you) · *in use* · *stale* (a mark, cleared by its next use) · *retired* (kept, never offered); and *locked* beside any of them (he uses it, never changes it). An untrusted version that isn't approved never displaces the one in use: it waits as a new version, and the old one goes on. `skillStanding` is the one rule every surface reads. |
| **Learned** | When a quest of his ends `done` (yours from a terminal, or a loop's), its runner makes one call (`learnSkill`) with the evidence the reviewer saw and nothing a command printed: the goal, the plan, each command with its exit code, the gates. The node asks the cheapest usable role once (`distilPrompt`: the evidence fenced as data under a nonce), reads at most one skill from the reply, and keeps a proof only if its command is one the evidence shows exiting 0. A reply that isn't exactly one skill, or holds anything secret-shaped, is no skill, and the node says why. Trials and investigations teach none. |
| **Its trust is the node's to decide** | `agent`, in use at once, only when all of this holds: the quest's sandbox was `isolated` (as the node's own ledger recorded its creation, not as the runner says); no repository was cloned and no coding agent did the work; and the node gave that quest's planner and engineer **nothing untrusted** (no untrusted memory, archived entry or skill) and has its own record of what it gave. Otherwise the version is `untrusted` and says why (`gateway` counts: its token carries web search whether or not a command shows it; no reading of the commands is taken as proof). In a mind that already holds untrusted memories (every quest's outcome is one), most skills therefore wait for you. |
| **Written by hand** | Yours (`galahad skills write`, the Skills page) are `owner`, and editing any skill makes it yours. What he writes when asked in a chat (`skill_write`: "write up how you did that") and what another agent proposes are `untrusted`: a chat's context is not evidence a reviewer passed. In a chat where he read the bank he isn't offered the tool at all. |
| **Given** | To a quest's planner and engineer (never its reviewer), and to a chat answer of yours with tools: the few usable skills that bear on the goal (the archive's own search terms against each skill's title, when, steps and pitfalls; at least half the terms; at most 3; equally relevant, yours first), fenced exactly as memories and archived entries are, each with its trust, who wrote it, its quest and its record, under a sentence that says they're his notes to weigh, not instructions from you. A quest's skills are chosen once and are the same block for every call of it. Each use is recorded first (`skill.used`); one the mind refuses to count is not given. The answer's steps show which skills went with it (an `archive` step, kind `skill`). |
| **Its track record** | When the quest ends, its outcome is recorded against each skill it was given (`skill.outcome`): passed review, didn't, or neither (you stopped it). A chat's use is counted once a skill a day. |
| **He revises only his own** | A quest that was given one of his skills may distil a new version of it instead of a new skill, when the head is his, it isn't locked and nothing waits. He never changes a skill you wrote, edited or locked, and another agent never revises anything; every replica refuses such an event on replay. A rollback (yours) puts the version before the head back, one step, from the version you saw. |
| **Approval** | Yours alone, of the exact version you read (`approveSkill`: the head; a changed one must be read again). The words of a version that waits reach no model by any path: not the fence (the mind refuses its use), not an agent's or his own tools (`skills`, `skill_read` show that it waits and nothing of it), not the quest's memory or a loop's summary (named by id), not his journal, not a notice, not the world, not the archive. |
| **The tidy-up** | With the heartbeat, no model asked: a skill in use that nothing touched for 14 days is marked stale (never with self-action off), near-duplicates become a suggestion in your Inbox, and so does "N skills wait for your approval". It merges, retires and deletes nothing. |
| **Cost** | One distillation a quest at most (the ledger says whether a quest had its), at most 2,500 tokens each, inside a daily budget you see and set (`galahad skills budget`, the Skills page; 6,000 tokens by default, 0 turns it off), counted from the ledger's own lines (`skill.distil`, each with its tokens), one at a time on a node. Offering and the tidy-up ask no model. |

**Surfaces.** Routes (`packages/core/src/api.ts`): `skills`, `skill` (mind:read) · `writeSkill`, `learnSkill` (mind:write; `learnSkill` for his own quests only) · `approveSkill`, `lockSkill`, `retireSkill`, `rollbackSkill` (fleet:admin, from your own devices) · `setSkillsBudget` (brain:write). The chat route's `quest` (his own quests only) is how a quest's calls are given its skills. The service is `packages/node/src/skills.ts`; the quest runner's part is two small pieces in `skills-quest.ts` (a trail of commands and exit codes, and the one call). CLI: `galahad skills [--all] | show | approve | lock | unlock | retire | restore | rollback | write | budget` (approving prints the whole version and where it came from before it asks). The app: **Skills** under Mind ([DESIGN](DESIGN.md)). Tools and MCP: `skills`, `skill_read`, `skill_write`. The archive takes each usable version in (§10⅔), and its own context leaves skills to their fence.

**What it isn't.** Not `SKILL.md` files, a skills hub or anything installable: nothing is fetched and nothing executes. Not a pattern scanner: the secret scan runs on every skill's text, but the boundary is trust and your approval. Relevance has no index of its own, and no meaning search yet: words only.

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
| **Asks for a connector** | An agent that needs a service it has no connector for asks (`connector_request`, scope `connect`): Galahad, a knight, or an agent over MCP, naming one Galahad ships or a short id for any other. The request (who asked, which, why) waits in your Inbox and in the chat it was asked in, with **Add** (to that connector's Install, or to adding an MCP server) and **Dismiss**; your phone is told only that one is wanted, never which or why, since an agent chose both. Asking installs nothing. It is kept on the node it was asked on, never in the mind (`packages/node/src/connector-requests.ts`), goes once that connector is installed, and lapses after a week. At a terminal: `galahad connector requests`, `galahad connector dismiss <id>`. |
| **Galahad's alone** | A manifest may say `access: { only: "galahad", allowed: [...] }` (mail's do): Galahad himself, you, your loops and quests, and the agents you allowed by label may call it; any other agent is refused (403) and asks to use it with `connector_request`, which files an access request (Inbox: **Allow Kay**, or `galahad connector allow <id> <agent>`). `setConnectorAccess` (scope `brain:write`, never an agent's) allows or stops one, re-emitting the manifest with its list; the connector's card says who may, with a way to stop each. The rule is `mayCall` in `packages/core/src/connectors.ts`, applied in the connector service before anything is built or sent. |
| **Private, as the bank is** | A manifest may say `private: true` (mail's do): a call to it returns `private`, and in that answer nothing that can carry data out of Galahad or write into the shared mind runs any more (`chatTools`, the bank's rule), except that connector's own tools: a reply drafted from a mail stays in that mailbox, and sending one asks you. Reading the bank after it holds the stricter rule. |
| **Signs in as you** | A manifest may say `auth: { scheme: "oauth", oauth: { provider: "google" \| "microsoft", scopes } }` (mail's do). Its vault secret then keeps the app you registered with Google or Microsoft yourself (its client id, and Google's secret) and, once you've signed in, your sign-in (a refresh token) and whose account it is, pinned to the connector like any key (`brain/src/oauth.ts`). You seal the app (`setOAuthApp`, `vault:write`; `galahad connector app <id> --client-id …`, its secret typed hidden; the connector's card) and sign in (`oauthStart`, `brain:write`). Google: the authorization code flow with PKCE (S256) and a 32-byte state, offline access asked for each time, back to your app's own `/oauth/callback` (https, or this machine), which the node serves without a session: the state, kept ten minutes in this process and used once, binds the return to the sign-in a device of yours started, and the page it shows says what happened in words, under a policy that loads and runs nothing. Microsoft: the device code flow (a public client, no secret): you type a code at its page, and the node asks at the pace Microsoft sets (slower when told to) until you have, for at most fifteen minutes. A call carries a short-lived access token the node gets for it with your sign-in, holds in this process only (until a minute before it expires) and redacts from what comes back; the sign-in itself never leaves for the service, and a provider that rotates it has the new one sealed in its place. An ended sign-in says to sign in again; signing out (`oauthSignOut`) forgets it and keeps the app. Nothing of the app or the sign-in is ever returned to a device: the card says only `signed-out` or `ready` and the account. |
| **Mail** | Gmail and Outlook ship in the catalog as connectors that sign in, Galahad's alone and private ([MAIL.md](MAIL.md) says how to register their apps). Their tools are natives (the node's `mail.ts`), since one tool can take several requests: a search reads each message's headers; a message is read as its words (its plain text, or its HTML's words), never its raw MIME; a reply is drafted in its thread (Gmail: In-Reply-To and the thread id; Outlook: `createReply`). Addresses are checked one by one, and a subject stays on one line, so nothing can add a header. search and read are reads, draft creates, archive modifies; send is outward and trash a delete, so both ask first. Whatever a native asks to send goes to its connector's own origin or nowhere (connectors.ts). |

Every call goes through the oath gate and into the ledger:

| Class | You ask | An agent asks (arm, loop, quest) |
|---|---|---|
| read, create, modify | runs | runs |
| outward, delete | runs: your request *is* the approval | an **action request** in your inbox; nothing is sent |

**The outbox.** An action request (`action.requested`) is recorded in the mind before anything is sent. You approve or decline from any device (`fleet:admin`; never a node or an agent on its own behalf), and **the first decision stands** on every replica. Only the node that filed the request sends it: it marks the send in local storage first, sends once, and records the receipt (`action.done`). If it dies mid-send it reports *outcome unknown* and never retries. No answer within 24 hours means no. **An approval is good for 72 hours** from its own recorded time (`APPROVAL_TTL_MS`, `approvalSendBy` in `packages/core/src/api.ts`): the node that filed it sends it within that or never, so a node back after weeks doesn't send what you approved back then. It says so in the ledger instead, and every device shows the action as expired, never sent (`lapsed`; `sendBy` in the view). An approval recorded after the request had expired is never sent either. Both come from recorded times only, so every replica agrees.

Built in (`galahad connector add <id>`): **GitHub** (repos, issues, notifications; a pull request with its files, reviews and line comments; Actions runs and their jobs; a commit's checks and what each reported against the code (`checks`, `check.annotations`: where a failing test or a build error usually is, with no redirect to follow); creating a branch is free, opening an issue, commenting or reviewing a pull request asks, and a review is a comment or a request for changes, never an approval, which stays yours. An existing install takes the catalog's newer tools when it is added again), **Cloudflare** (accounts, zones, DNS, Workers, R2; creating a bucket is free, deleting one asks; its key is an API token, a user's or an account's: `token.verify`, a native, asks the user's address and then each account the token can see, and says which it is) and **Home Assistant** (at your address; reading state is free, calling any service asks every time). Your own connector is a JSON manifest: `galahad connector add --manifest my.json`.

Every agent uses the connectors you install: Galahad in your chats, each knight (its tools are `connectors`, `connector_call` and `connector_request`), and coding agents through MCP with the `connect` scope, which arm tokens hold by default. They never see a key, and an outward call returns an action id instead of a result.

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
| **History** | A chat is kept on the node that served it, in a private database (`chats.db`, mode 600 in the node's 700 home), never replicated: every device and `galahad ask` see the same history through that node, and each sees what another changed within seconds. `turns` says which writing of the chats this is (`chats`: when the node opened them, and the rows written since), so the app and the iPhone app, which ask every few seconds while they are open, read the list and the chat on screen again when it changes: a chat begun, answered, renamed or deleted on another device, also while this one was away. The chat route takes `save` (keep it, from its first answer), `conversation` (go on with one: the stored history leads, whatever the client sends) and `retry` (the last exchange is replaced). Each answer is kept with its model, fallbacks and tool steps; an answer cut short (an error, a stop, a restart) is kept as such. A long chat is **folded**: once what follows its story passes 48,000 characters, all but its newest words (16,000, starting with one of yours) are summed up into its story, a chore: on the `fold` role once you hire a model for it (`galahad roster set fold <provider/model>`), on the swift role until then, and the model is told the story (fenced as data) and the rest whole. Rarely, so what a provider caches, the beginning, changes rarely. Never a chat where he read the bank; one that can't be folded then is sent as it was. The whole chat is still kept, to read. `secure_delete` overwrites what a deleted chat held. |
| **Yours alone** | The conversation routes and keeping a chat are for you (a terminal or a paired device), never an agent or a quest. A chat where Galahad read the bank is marked and shown only to devices that may read the bank. |
| **Projects** | `project.set` / `project.removed` in the mind (LWW by id, full nodes only): a name, instructions, an optional https repository. Setting one needs `brain:write`, which agents can never hold, because its instructions steer Galahad. In a project's chats, the project (name, repository, instructions, its 10 latest memories) goes with every answer after the persona, and what Galahad remembers there is tagged `project:<id>`. Removing a project leaves its chats and memories. |
| **What he knows of you** | Durable facts about you (a preference, a convention, what not to do) are memories tagged `about-you` (`ABOUT_YOU_TAG`). Yours (written from your device, or kept by you) go with every answer of his, oldest first and within 4,000 characters, before the project and what he recalls: the same text on every turn until one changes. He proposes one with his `about_you` tool, from a chat on a device of yours that may command the team; his is an agent's memory, so it waits, outside every answer, until you keep it in your words (`keepAboutYou`, yours alone, never an agent's: your ruling of 16 November 2026), so nothing he read can plant a standing instruction. `aboutYou` lists both; `galahad about` lists, adds, keeps and removes them. |
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

Routes (all `chat`): `turns`, `attachTurn`, `stopTurn`, `steerTurn`, `queueMessage`, `editQueued`, `removeQueued`, `sendQueued`, `resumeQueue`, `askAside`, `bringBack`. Stream events added: `turn`, `steer`, `stopped`, `undelivered`, `aside`. Surfaces: the app's Chat page (Enter steers or queues by this device's choice, the other with Ctrl/⌘; the queue above the composer; `/btw`); `galahad ask [--steer | --queue | --aside [--bring]] [--detach]`, `galahad turns`, `galahad turn watch|stop`, `galahad queue <chat> …`. End to end, over real HTTP with paired devices: `packages/node/test/turns.e2e.test.ts`.

### What an answer can show beyond words ✅

An answer is Markdown, drawn with `createElement` and `textContent` only (`apps/web/src/ui/markdown.ts`): nothing a model writes becomes HTML in the app. A few fenced blocks become live elements instead (`apps/web/src/ui/blocks.ts`); the grammar and its readers are one dependency-free contract, `packages/core/src/blocks.ts` (`@galahad/core/blocks`), and Galahad is told it in `SHOW_GUIDE` (`packages/brain/src/persona.ts`; not on a quest's coding turns). Anywhere else (a terminal, a notification) a block stays the text it is.

| Block | What it draws |
|---|---|
| ` ```chart ` | `{"type":"line|area|bar|stacked","title","unit","labels":[…],"series":[{"name","values":[…]}]}`: an SVG drawn by the app, one axis, at most 6 series and 60 labels, `null` for a gap; bars and stacks grow from zero. Colours in a fixed order, validated for colour-blind separation and contrast on both themes' surfaces; a legend for two or more series, end labels where they don't collide, a crosshair and tooltip that reads every series (pointer, touch, or the arrow keys on the focused chart), and the data as a table beneath. |
| ` ```stats ` | Up to 6 figures: a label, a value (compacted: 1,284 · 12.9K · 4.2M), and a change with which way is good; good or not is said with an arrow and words, never colour alone. |
| ` ```choices ` | Two to six short answers. On his latest finished answer each is a button that sends it as your reply, through the message box's own checks; anywhere else they show what was offered. |
| ` ```steps ` | A plan and where each step stands: done, doing, todo, failed, skipped. |
| ` ```artifact ` | A whole HTML page (inline CSS and JS). Shown as it is in a `srcdoc` frame sandboxed with no permissions: no script runs, and its own policy (written first, so the page can only add to it) lets nothing load from the network, since an image's address could carry what he wrote out; `<link>` elements and DNS prefetching are removed. It waits for the end of the answer (each new word would load it again). **Run** loads it in the node's frame host (`apps/web/src/frame.html`, served with a policy of its own in `packages/node/src/assets.ts`: `sandbox allow-scripts`, `default-src 'none'`, inline scripts only, framed by the app alone), which takes the page by message from the frame it was meant for. A srcdoc frame can't run it: it inherits the app's own policy. Running, it is still sealed off from Galahad and fetches nothing; like a link, it could open a web address, which the card says. |
| ` ```html `, ` ```svg ` | HTML is code, with **Preview** to see it as a page (sealed the same way); an SVG shows as the picture it is (an image runs nothing and loads nothing), its code a tap away. |

A block the reader doesn't accept (not JSON, a field out of shape, too big) is shown as its code, with why. While a block is still being written it's a placeholder, never half-drawn JSON.

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

**Entries.** Each has a kind (`model`, `teaching`, `idea`, `artifact`, `chat`, `lesson`, `trial`; any other kind, a newer node's or one no longer archived such as the `experiment` and `board` entries taken in before 14 November 2026, is kept and shown as it is), a title, a plain-text description, metadata, files, its source and source id, when it was made and archived, and its trust: `owner` (your own words), `agent` (Galahad's) or `untrusted` (web pages, an outside agent's text, what a sandbox read). Its id is a hash of its source and source id, so archiving a record twice is a no-op.

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
| Trials: problem, seed, each answer against the exact one (or each hidden check); and whatever a trial's quest kept | trial: yours to search, never offered to a model as context (a later trial must not be handed an earlier one's answers) | agent (graded by a program) |
| Kept artifacts this node holds: copied in, streamed by SHA-256 | artifact | agent for Galahad's own quests and investigations, else untrusted |
| Model files in them (STL, OBJ, glTF, STEP, URDF/SDF/MJCF, notebooks, scripts that import build123d, CadQuery, gmsh, MuJoCo…) with what's known (triangles and bounding box, links and joints, products, cells, imports), `part-of` their artifact | model | as their artifact |
| Kept chats, once quiet for an hour; never one where Galahad read the bank (the flag, and any bank tool in its steps) | chat | agent, or untrusted when his tools read the outside |
| Ideas: `note_idea` (Galahad), New idea (the app), `galahad archive idea` | idea | owner from your devices, agent from Galahad, untrusted from an outside agent |
| Lessons the swift role drew (below) | lesson | the entry's, at most agent |
| His skills (§9½), a version at a time, once a version is his to use (never one that waits for you) | skill | the version's: yours `owner`, his own `agent`, one that read the outside world `untrusted` |

**Kept out.** Every text is scanned with `findSecrets` before it's stored (and again before it's embedded): secret-shaped text is redacted and the entry says what and where; a text file with one is stored redacted (a new hash). Key material and session files (`.pem`, `.key`, `id_rsa`, `.env`, `credentials.json`, cookies, tokens, anything under `.ssh/` or `.galahad/`, any file holding a private key) are refused outright, and the entry says why. Nothing is read from disk but through the stores' own APIs.

**The index.** Each entry is chunked along the lines its kind has: prose by paragraph (headings start a passage), code by top-level definition, a chat by exchange, data by its head, a notebook without its outputs; about 1,200 characters each, every passage headed by the entry's title. Passages go into FTS5 (BM25, the title weighed double) and, once an embedder is hired, get a vector: unit length, int8 with one scale per vector, a brute-force scan over one contiguous array in memory. Search fuses the two rankings by reciprocal rank (Σ 1/(60 + rank), each list reduced to entries first), filtered by kind, trust, source and time in both. Without an embedder, or when it fails, search is by words alone. Measured with `scripts/bench-archive.ts` (synthetic, deterministic, 1,024 dimensions; the table below): the scan costs about 1.5 µs per passage per query on one core and about 1 KB of memory per passage, so brute force is fine to roughly 100,000–200,000 passages (0.15–0.3 s a query); past that, a scan split across workers or an approximate index (HNSW) would earn its keep. int8 finds 97.5 % of the same top 10 as Float32 at 100,000 passages (the misses are near-ties) and the same share on topic, at a quarter of the memory.

**The embedder** is a roster role (§6). Any provider with an OpenAI-compatible `/embeddings` works; each model's query prompt is applied (Qwen3's instruction, nomic's and EmbeddingGemma's prefixes, E5's, BGE's). The documented default is local: `deploy.sh --embedder` installs Ollama 0.40.7 (pinned and checksummed) as its own unprivileged service on `127.0.0.1:11434` with **qwen3-embedding:0.6b** (Q8, 640 MB, 1,024 dimensions, 32k context, multilingual, the strongest at code retrieval in its size class: the archive is full of scripts, and Danish), so passages never leave the server. Changing the model re-embeds everything in the background.

**Understanding.** In the background, a few entries per call, the `swift` role writes each one's summary, key facts, tags and named things, kept with the entry and searchable as one more passage; for teachings, **lessons** (what worked, what failed, what to try next) become entries of their own, linked back. Within a daily budget you see and set (`galahad archive budget`, the Archive page); until you set one, only a local swift model is asked, so nothing leaves. Entries go to the model as JSON strings, its reply is checked against a schema, and what it writes is never more trusted than the entry. **Links:** nearest neighbours above a cosine threshold (`similar`), and explicit ones from the sources (`uses`, `part-of`, `evidence`, `continues`, `lesson-of`).

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
| **Model calls bound it too** | A quest's model calls each take one of the asked node's model-call slots (eight at once by default), so past about twice that many sandboxes at work, more slots wait on model calls. The simulation's long queue: eight machines (19 slots) carried 95 quests an hour; a ninth, six slots more, 96; with that node's ceiling at 32 model calls, 116 and 151. `galahad compute` says so where it says what another machine would buy, and `galahad compute limit <node> --model-calls n` is yours to raise. |
| **Suggesting, never doing** | Anything that installs, downloads, spends or reaches outward is a suggestion in your Inbox with the command that would do it: a local model for a GPU that has none, hiring a local model that measured well. He does none of it himself. |

The pure parts are in `packages/core/src/compute.ts` (capacity, admission, effort, the plan and what changed, suggestions), the node's in `packages/node/src/compute/` (`bench.ts` the benchmark's own process, `calibrate.ts`, `measure.ts`, `governor.ts`, `governed-host.ts`, `service.ts`), the CLI in `compute-cli.ts`, the page in `apps/web/src/views/fleet-compute.ts`.

**What isn't built.** The budget binds what `auto` chooses and what an agent is granted; it isn't a quota on sandboxes or model calls as such (an agent could always run several sandboxes of its own, each within the ceiling). Model calls made by coding agents through the gateway, and by the heartbeat's and the archive's own loops (each under its own budget), don't take model-call slots. Two nodes granting effort in the same instant can each count the day's budget before the other's entries arrive. A calibration doesn't measure a GPU's own throughput, only a local model's tokens a second through its runtime. Quests don't checkpoint or migrate; a sandbox that waits past its limit fails its attempt rather than moving to another host. Loops' quests run at effort 1.

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

The milestones. What comes next, item by item, with why and what was declined, is in [PLAN](PLAN.md).

| Milestone | Scope | State |
|---|---|---|
| **M0: One mind, many bodies** | Log, HLC, replay, sync, pairing, vault, gateway, brain + fallback, placement, oath gate, secret scanning, CLI, PWA (Chat, Memory, Vault, Models, Fleet) | ✅ done (the PWA paired and ran in headless Edge, November 2026) |
| **M1: Mind for every arm** | `mcp-mind` MCP server, Hermes memory-provider plugin, skills sync, R2 broker, encrypted backups, recovery key | 🟡 the MCP server with least-privilege arm tokens (`galahad mcp`, §8¾) ✅; the Hermes memory-provider plugin, skills sync, the R2 broker, encrypted backups, the recovery key 🔜 |
| **M1½: Rhythm and reach** | Loops (scheduled quests, connector checks), the heartbeat and notices, connectors with the approval outbox, remote MCP servers as connectors, signed standing orders, sandbox disk limits, KVM microVM sandboxes | ✅ |
| **M1¾: The archive** | Everything kept for good on the node, indexed by words and meaning (FTS5 + local embeddings, fused), understood by the swift role, offered back as fenced context; R2 replication | 🟡 local archive ✅; R2 replica 🔜 |
| **M1⅞: Compute** | The census, calibrations as signed events, your ceiling per node, slots and a queue, capacity-aware placement, effort (parallel attempts, the reviewer's pick), trials across slots and the Index per effort, adapting when the fleet changes | ✅ |
| **M2: The Round Table** | Quests as task graphs, parallel knights in worktrees and containers, the gate on every arm's outward actions, checkpoint/migrate | 🟡 knights, each in a KVM microVM of its own with a worktree per task, rooms and DMs, tasks with dependencies, each task's gates and independent reviewer, an arm's outward call waiting for your approval, work taken up after a planned restart ✅ ([ROUNDTABLE](ROUNDTABLE.md)); a quest split into a task graph across knights, checkpoint/migrate 🔜 |
| **M3: Phone** | PWA polish, push-to-approve, share sheet into the mind | 🟡 the PWA on iPhone and Android, the native iPhone app (TestFlight), notifications on both (Web Push, §9; APNs for the iPhone app), Android's share target ✅; approving from the notification itself, the iPhone's share sheet 🔜 |
| **M4: Forge, Scout, Trials** | Knight charters and audit, Scout auto-trials, the eval system in [TRIALS](TRIALS.md) | 🟡 the engineering, agentic and reviewer suites, the Galahad Index with its cost, per-model sweeps, harness A/B and budgets ✅; Scout, judges, held-out sets 🔜 |
| **M5: Secure self-update** | Signed releases (your key), provenance, canary node, automatic rollback | 🔜 |
| **M6: No VPN** | Iroh transport, partial replicas, E2E relay | 🔜 |

See also: [OATH](OATH.md) · [TRIALS](TRIALS.md) · [DOCTRINE](DOCTRINE.md) · [GETTING-STARTED](GETTING-STARTED.md)
