<img src="assets/icon.svg" width="64" height="64" alt="">

# galahad

**A lean, highly capable agent for tasks, above all for coding and for managing large projects.** Galahad creates and orchestrates persistent knights: named workers with lasting jobs, each working in a VM of its own on machines you own. He is one mind across your devices (laptops, servers, desktops, phones): one identity and one memory, the same on each. You can keep adding compute, models, keys and tools, and he grows more capable with each one. He stays courteous, candid and bound by [his oath](docs/OATH.md).

What he is built towards is [the mandate](docs/MANDATE.md): the best coding agent that has ever existed, one that finishes a real task in a real repository correctly, cheaply, and without a human watching every step.

## Status

Galahad runs every day on its owner's machines, a Linux server with KVM among them, and every change ships only with the whole suite green: `bun run check`, about 2,700 tests including property tests and two-node end-to-end tests over HTTP, and the iPhone app's own. Where it stands:

- **What's next:** the feature plan, in order and with why ([PLAN](docs/PLAN.md)); the milestones ([ARCHITECTURE §13](docs/ARCHITECTURE.md#13-roadmap)).
- **How well it does:** its trials, with every run's record (on 14 November 2026, Galahad Index 94 to 98 % on the agentic suite at level 2, at $0.27 to $0.54 a task on a coding plan; at level 3 on 16 November, 95 % at $0.39 a task: [TRIALS](docs/TRIALS.md)), and the scorecard of what is measured without a model ([BENCHMARKS](docs/BENCHMARKS.md)).
- **How it compares:** with Hermes Agent, Rakazo, OpenMausBot, Grok Bot and Dots, surface by surface, every fact sourced and dated ([COMPARISON](docs/COMPARISON.md)).

Working and tested today:

- **One mind across nodes.** A signed, content-addressed event log syncs over your tailnet. State is a pure function of the event set: any delivery order gives an identical digest, and rebuilding from the log gives the same state.
- **Secure pairing.** One-time invites, a 6-digit confirmation code on both screens, and a lock on any invite that gets used twice.
- **The vault.** Add an API key once and every full node can use it. It's sealed per device, never in the log in plaintext, and rotated when a device is revoked.
- **Secrets stay out of chat.** Hidden prompts for entering keys; secret scanning refuses keys in chat and memory; provider errors are redacted; Galahad asks for keys with *secret requests*.
- **Model gateway.** Tools such as OpenCode, Claude Code, Codex and Hermes use your keys through scoped, capped, expiring tokens (`galahad run -- opencode`). The real key never leaves the vault.
- **Provider-agnostic brain.** Roles (planner, engineer, reviewer, swift) with fallback chains, each step of a task thinking as hard as it needs. Anthropic via the official SDK, plus DeepSeek, Abliteration, Heabsy, NEAR AI Cloud, OrcaRouter, OpenRouter, Moonshot, Z.ai, NanoGPT, Synthetic, Ollama's cloud, Verda, Ollama and llama.cpp. Twelve coding plans (OpenCode Go, Z.ai's, Kimi's, Xiaomi MiMo's, MiniMax's, and Alibaba's, ByteDance's, StepFun's, Tencent's and Baidu's) do coding and nothing else, each only as far as its vendor's terms allow.
- **Quests.** `galahad do "<goal>"` plans, works in a fresh sandbox with tools of its own (a shell, and reading, editing and writing files, several calls a turn), and is checked by an independent reviewer model before it counts as done. `--gate "<command>"` says what done means: every gate must pass before the reviewer is even asked. Works with any model on the roster.
- **Persistent knights.** The PWA's Roundtable page and `galahad roundtable` provide named knights, DMs, shared rooms, bounded coordination and tasks with dependencies, progress and independent verification. Galahad makes and briefs more of them himself when you ask or the work needs one, within a daily allowance and marked as his; removing one is yours alone. Shell work requires each knight's retained Kata VM; native, OpenCode, Hermes, Claude Code, Codex and any agent that speaks ACP (Gemini CLI, Goose and the rest, by the command you name) are separate engineering harness choices (Claude Code and Codex can run on your own Claude or ChatGPT subscription, signed in by you inside the VM). Each knight works on the models of the role you give it, built in or one you made, while its tasks' plans and their independent review stay the planner's and the reviewer's; in **sensitive mode** a knight or a task is held to models of its own and nothing else, every call of its work. Its scripts can call an API with a key of yours it never sees (the key gateway puts it in, at the key's address alone), and any task of its can be given again from any of its steps. A knight's state lives on the node that runs it; knights have done verified work in real Kata VMs since 14 November 2026. Setup and limits: [ROUNDTABLE](docs/ROUNDTABLE.md).
- **The knights' looks.** Each knight is one of ten hand-drawn knights, with live eyes: they blink, and show what it is doing (looking up while it thinks, along the work while it runs, wide while it asks your leave or your approval, happy after verified work, lowered after a failure, shut while paused). The same in the PWA and the iPhone app; nothing moves under reduced motion.
- **Turns that outlive the page.** A chat turn runs on the node to its end whether or not anyone is watching; any device attaches and sees it from its start. While he works, a message steers him now or queues for after; a side question doesn't change his course. Anything that needs you waits for you.
- **Skills.** When a quest passes its review he may write one short note on how that kind of work went, and is given the notes that bear on later work, fenced as data with a track record. A skill is words, never something that runs. One that could have read the outside world waits for your approval; yours are yours, and he never changes them (`galahad skills`, the app's Skills page). A connected MCP server may ask you a question in the middle of a call: it waits in your Inbox, answered by you alone. An Agent Skill's folder on GitHub can be taken in too, its `SKILL.md` as text and nothing in it run, waiting for your approval (`galahad skills import`).
- **Placement.** Work goes to the body that suits it: long and untrusted work to the always-on sandbox server, interactive work to the laptop you're on.
- **Compute.** He grows by having machines added to him, and never acquires any. Each node measures itself; you set a ceiling per node (by default he uses half of a machine); work that doesn't fit waits rather than oversubscribing a host; and a quest can spend more compute for a better answer (`--effort`: parallel attempts, the independent reviewer takes the best), which the Trials measure per effort level.
- **The oath gate.** Creating is free; deleting and outward-facing actions ask first.
- **The archive.** Every model, teaching, idea, kept chat and lesson is kept for good (content-addressed, never evicted; only you delete), indexed by words and meaning (FTS5 and local embeddings, fused), summarised, and offered back to Galahad as fenced context when it bears on his work. `galahad archive`, the app's Archive page; `deploy.sh --embedder` runs the embedder on your server.
- **PWA.** Pair a phone or browser with a non-extractable WebCrypto key and the 6-digit code. It is the full hub: chat, the Roundtable and each knight's timeline, a knight's screen and terminal, the Inbox, memory, keys, models and roles, connectors, loops, trials and the rest. Every request is signed, each route has its own scope, and the CSP is strict. Chats are the node's, so a chat begun on your phone goes on at your laptop.
- **iPhone app.** A native SwiftUI app for iPhone and iPad, in testing on TestFlight: its key in the Secure Enclave, chats, the Roundtable, rooms, approve cards, keys and plans, connectors, a knight's screen and terminal, and notifications. Its shared logic is held to the PWA's by test vectors.
- **Mac app.** Galahad for the Mac (macOS 27): your client, and a node in one, so a Mac mini becomes a node from the app with no Terminal. Signed with a Developer ID, notarized, and kept up to date by Sparkle from a signed feed on galahad.sh; [download it](https://github.com/amiriteorg/galahad/releases/latest). Knights' VMs on a Mac, through Apple's `container`, are being tested on a Mac mini.

## Quick start

On a Mac or a Linux machine of yours, in one line:

```sh
curl -fsSL https://galahad.sh | bash
```

It installs Galahad with its own pinned Bun, keeps the node running as a service of yours, founds your fleet (or joins
one: `bash -s -- --join <invite>`), publishes the app on your tailnet when Tailscale is there, and shows the code to pair
your phone. Run it again to update. Nothing runs as root. What it does, step by step: `scripts/install.sh`, or the same
line with `bash -s -- --plan`.

From a checkout instead (**[docs/GETTING-STARTED.md](docs/GETTING-STARTED.md)** has the whole of it):

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
| [PLAN](docs/PLAN.md) | What's built next, in order, why, and what was declined |
| [COMPARISON](docs/COMPARISON.md) | Galahad next to Hermes Agent, Rakazo, OpenMausBot, Grok Bot and Dots, surface by surface, with sources |
| [MAC](docs/MAC.md) | The Mac app: the client and a node in one, to make a Mac mini a node with no Terminal; how it is signed, notarized and updated; knights' VMs through Apple's `container` (in testing) |
| [ROUNDTABLE](docs/ROUNDTABLE.md) | Persistent workers, rooms and DMs, shared knowledge, VM workspaces, task supervision and current limits |
| [OATH](docs/OATH.md) | Character, duties, limits, autonomy classes |
| [TRIALS](docs/TRIALS.md) | How we prove quality holds and intelligence grows |
| [BENCHMARKS](docs/BENCHMARKS.md) | The scorecard (`bun run bench`): what's measured without model tokens, its baselines, and what they say |
| [BANK](docs/BANK.md) | Your bank accounts, read-only, for the agents you choose: setup, threat model, checklist |
| [DOCTRINE](docs/DOCTRINE.md) | The ideas Galahad is built on, and whose they are |
| [AGENTS.md](AGENTS.md) | Rules for agents (and Galahad) working on this repo |

## License

Galahad is open source under the [Apache License 2.0](LICENSE). Found a security problem? Please report it privately: see [SECURITY](SECURITY.md).

Created in [T3 Code](https://t3.codes).
