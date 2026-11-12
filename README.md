<img src="assets/icon.svg" width="64" height="64" alt="">

# galahad

**The autonomous paragonic knight and engineer.** Galahad is one agent that lives on all your devices (laptops, servers, desktops, phones) and shares **one mind** across them. You can keep adding compute, models, keys and tools, and he grows more capable with each one. He stays courteous, candid and bound by [his oath](docs/OATH.md).

## Status: M0 built

Working and tested today (`bun run check` runs the whole suite, including property tests and a two-node end-to-end test over HTTP):

- **One mind across nodes.** A signed, content-addressed event log syncs over your tailnet. State is a pure function of the event set: any delivery order gives an identical digest, and rebuilding from the log gives the same state.
- **Secure pairing.** One-time invites, a 6-digit confirmation code on both screens, and a lock on any invite that gets used twice.
- **The vault.** Add an API key once and every full node can use it. It's sealed per device, never in the log in plaintext, and rotated when a device is revoked.
- **Secrets stay out of chat.** Hidden prompts for entering keys; secret scanning refuses keys in chat and memory; provider errors are redacted; Galahad asks for keys with *secret requests*.
- **Model gateway.** Tools such as OpenCode, Claude Code, Codex and Hermes use your keys through scoped, capped, expiring tokens (`galahad run -- opencode`). The real key never leaves the vault.
- **Provider-agnostic brain.** Roles (planner, engineer, reviewer, swift) with fallback chains. Anthropic via the official SDK, plus DeepSeek, Abliteration, OrcaRouter, OpenRouter, Moonshot, Verda, Ollama and llama.cpp.
- **Quests.** `galahad do "<goal>"` plans, works in a fresh sandbox one shell command at a time, and is checked by an independent reviewer model before it counts as done. `--gate "<command>"` says what done means: every gate must pass before the reviewer is even asked. Works with any model on the roster.
- **Turns that outlive the page.** A chat turn runs on the node to its end whether or not anyone is watching; any device attaches and sees it from its start. While he works, a message steers him now or queues for after; a side question doesn't change his course. Anything that needs you waits for you.
- **Skills.** When a quest passes its review he may write one short note on how that kind of work went, and is given the notes that bear on later work, fenced as data with a track record. A skill is words, never something that runs. One that could have read the outside world waits for your approval; yours are yours, and he never changes them (`galahad skills`, the app's Skills page).
- **Placement.** Work goes to the body that suits it: long and untrusted work to the always-on sandbox server, interactive work to the laptop you're on.
- **Compute.** He grows by having machines added to him, and never acquires any. Each node measures itself; you set a ceiling per node (by default he uses half of a machine); work that doesn't fit waits rather than oversubscribing a host; and a quest can spend more compute for a better answer (`--effort`: parallel attempts, the independent reviewer takes the best), which the Trials measure per effort level.
- **The oath gate.** Creating is free; deleting and outward-facing actions ask first.
- **The archive.** Every experiment, model, teaching, idea, kept chat and lesson is kept for good (content-addressed, never evicted; only you delete), indexed by words and meaning (FTS5 and local embeddings, fused), summarised, and offered back to Galahad as fenced context when it bears on his work. `galahad archive`, the app's Archive page; `deploy.sh --embedder` runs the embedder on your server.
- **PWA.** Pair a phone or browser with a non-extractable WebCrypto key and the 6-digit code. From there you can chat, search memory, add keys in a password field (never shown back), answer secret requests, approve devices and edit the roster. Every request is signed, each route has its own scope, and the CSP is strict. *It has paired and run in a real browser (headless Edge, November 2026).*

## Quick start

See **[docs/GETTING-STARTED.md](docs/GETTING-STARTED.md)**. The short version:

```sh
bun install && bun run check
bun galahad init --name laptop --fleet camelot
bun galahad serve
bun galahad key add
bun galahad ask "Good morning, Galahad."
```

## Docs

| Doc | What's in it |
|---|---|
| [ARCHITECTURE](docs/ARCHITECTURE.md) | The mind, the Link, pairing, vault, brain, placement, R2, growth, roadmap |
| [OATH](docs/OATH.md) | Character, duties, limits, autonomy classes |
| [TRIALS](docs/TRIALS.md) | How we prove quality holds and intelligence grows |
| [BENCHMARKS](docs/BENCHMARKS.md) | The scorecard (`bun run bench`): what's measured without model tokens, its baselines, and what they say |
| [WORLD](docs/WORLD.md) | The SANDBOX: Galahad's world, and experiments shown live in it |
| [BANK](docs/BANK.md) | Your bank accounts, read-only, for the agents you choose: setup, threat model, checklist |
| [DOCTRINE](docs/DOCTRINE.md) | The ideas Galahad is built on, and whose they are |
| [AGENTS.md](AGENTS.md) | Rules for agents (and Galahad) working on this repo |

Created in [T3 Code](https://t3.codes).
