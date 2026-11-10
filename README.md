<img src="assets/icon.svg" width="64" height="64" alt="">

# galahad

**The autonomous paragonic knight and engineer.** Galahad is one agent that lives on all your devices (laptops, servers, desktops, phones) and shares **one mind** across them. You can keep adding compute, models, keys and tools, and he grows more capable with each one. He stays courteous, candid and bound by [his oath](docs/OATH.md).

## Status: M0 and M1½ built, M4 under way

Working and tested today (380+ tests, including property and two-node end-to-end tests, per [TRIALS](docs/TRIALS.md#layers)):

- **One mind across nodes.** A signed, content-addressed event log syncs over your tailnet; any delivery order gives the same digest, and rebuilding gives the same state. [→](docs/ARCHITECTURE.md#1-the-mind-)
- **The Link.** Tailscale transport, every request signed by a device key, one scope per route. [→](docs/ARCHITECTURE.md#2-the-link-)
- **Secure pairing.** One-time invites, a 6-digit code on both screens, a lock on any invite used twice. [→](docs/ARCHITECTURE.md#3-pairing-)
- **The vault.** Add a key once; sealed per full node, never in the log in plaintext, rotated on revocation. [→](docs/ARCHITECTURE.md#4-the-vault-)
- **Secrets stay out of chat.** Hidden prompts, secret scanning, redacted errors, *secret requests*, and a model gateway that lends tools scoped tokens, never keys (`galahad run -- opencode`). [→](docs/ARCHITECTURE.md#5-secret-handling-end-to-end-)
- **Provider-agnostic brain.** Roles (planner, engineer, reviewer, swift) with fallback chains across Anthropic and OpenAI-compatible providers, local ones included. [→](docs/ARCHITECTURE.md#6-the-brain-)
- **Placement and the oath gate.** Work goes to the body that suits it; creating is free, deleting and outward actions ask first. [→](docs/ARCHITECTURE.md#7-placement-using-every-body-well-) [→](docs/ARCHITECTURE.md#8-the-oath-gate-)
- **Sandbox hosts.** Hardened containers with disk limits, KVM microVMs for online work, the Lab for science and engineering, and kept artifacts. [→](docs/ARCHITECTURE.md#8-sandbox-hosts-)
- **A mind for every arm.** `galahad mcp` gives coding agents memory, sandboxes and secret requests on least-privilege arm tokens. [→](docs/ARCHITECTURE.md#8-a-mind-for-every-arm-mcp-)
- **Quests.** `galahad do "<goal>"` plans, works in a fresh sandbox and counts as done only when an independent reviewer passes it. [→](docs/ARCHITECTURE.md#8-quests-the-first-agent-loop-)
- **Coding agents.** `--agent opencode` hands long work to OpenCode, with models through the gateway and the same review. [→](docs/ARCHITECTURE.md#coding-agents-stamina-for-real-codebases-)
- **Shipping.** Sandboxes clone through a read-only git gateway; passed work becomes a pull request only with your approval or a standing order you signed. [→](docs/ARCHITECTURE.md#shipping-pull-requests-through-the-oath-gate-)
- **Investigations.** `galahad investigate` pre-registers falsifiable predictions before any experiment runs. [→](docs/ARCHITECTURE.md#investigations-the-scientific-method-)
- **Trials.** `galahad trial run` grades fourteen engineering problems by program into the Galahad Index. [→](docs/TRIALS.md#the-engineering-suite-)
- **Loops and the heartbeat.** Scheduled quests and checks, at most once per slot, with notices in your inbox. [→](docs/ARCHITECTURE.md#9-loops-and-the-heartbeat-)
- **Connectors and the approval outbox.** GitHub, Cloudflare, Home Assistant and remote MCP servers; outward calls wait for you or a signed standing order. [→](docs/ARCHITECTURE.md#10-connectors-and-the-approval-outbox-)
- **Independently reviewed.** An audit found 13 issues: 11 are fixed, each with a test that fails without the fix, and 2 are documented limitations. [→](docs/SECURITY.md#independent-review-november-2026)
- **PWA.** Pair a phone or browser with a non-extractable WebCrypto key; chat, memory, vault, models and fleet, every request signed. It has paired and run in headless Edge. [→](docs/ARCHITECTURE.md#13-roadmap)

Next: growth and scale, R2 backups, the Round Table and the rest of the [roadmap](docs/ARCHITECTURE.md#13-roadmap).

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
| [DOCTRINE](docs/DOCTRINE.md) | The ideas Galahad is built on, and whose they are |
| [AGENTS.md](AGENTS.md) | Rules for agents (and Galahad) working on this repo |

Created in [T3 Code](https://t3.codes).
