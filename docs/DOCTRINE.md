# Doctrine and lineage

Galahad stands on the shoulders of people who have thought hard about agents. Each entry below gives the idea, its source and how Galahad uses it. *Built* means it is in the code today; everything else is planned.

## T3 / Theo Browne (Ping)

Sources: [T3 axioms](https://create.t3.gg/en/introduction), [t3code AGENTS.md](https://raw.githubusercontent.com/pingdotgg/t3code/main/AGENTS.md), [t3code](https://github.com/pingdotgg/t3code), [t3-env](https://github.com/t3-oss/t3-env)

| Idea | How Galahad uses it |
|---|---|
| Axioms: **Solve Problems · Bleed Responsibly · Typesafety Isn't Optional** | Use bleeding-edge models and tools, but behind evals and promotion gates. Strict TypeScript and zod at every boundary. |
| YAGNI; "don't introduce machinery because it looks architecturally impressive" | Plain TS, a handful of audited dependencies, no framework where none is needed |
| Complexity at the adapter boundary; orchestration pure; UI dumb; services, not transports | Provider adapters and the gateway absorb vendor quirks. The mind's materializer is pure. HTTP handlers stay thin. *Built.* |
| Event-sourced core; side effects after commit (outbox) | The mind is an event log (*built*). Outward actions go through a transactional outbox (M2). |
| "Authentication of a socket does not authorize every method" | One scope per route, checked at execution. *Built.* |
| "A remote client must never substitute its own … provider credentials" | Clients and arms never receive keys; the gateway injects them. *Built.* |
| Failing test first for bugs; flaky tests fixed, not retried; "hit every surface" | Repo rules in [AGENTS.md](../AGENTS.md). For example, a startup race was fixed at its cause, not with retries. |
| t3-env: validate the environment once, loudly | `packages/node/src/env.ts`. *Built.* |
| One-time pairing links, scoped sessions, revocation | Pairing: invite + SAS + conflict lock, scopes per device, `galahad revoke`. *Built.* |

## Lauren Tan (@poteto)

Sources: [Dr. Eggbot](https://agentools.sh/use-cases/dr-eggbot/), [brainmaxxing](https://github.com/poteto/brainmaxxing), [noodle](https://github.com/poteto/noodle), [verification-skill-example](https://github.com/poteto/verification-skill-example), [talk write-up](https://redreamality.com/blog/lauren-tan-poteto-trust-before-parallel/)

| Idea | How Galahad uses it |
|---|---|
| **Dr. Eggbot:** design single-purpose bots, each with one job and a list of things it must not do; audit the fleet | The **Squire Forge**: charters with one job, allowed tools, must-nots, budget and expiry, plus periodic audits (M4) |
| **"I did it" is not evidence**; verification is the most important skill | Verify before declaring done (oath duty). Verification skills per surface. The Trials. |
| **brainmaxxing:** reflect → ruminate → meditate, plus plan and review | The mind's maintenance loop: reflect after corrections, mine past sessions, audit skills against the mind and prune contradictions |
| Scoped **feature maps** (what exists, how to reach it, how to drive it, what breaks) beat a wiki for agents | Per-surface verification maps for Galahad's own repo and for the projects he works on |
| **noodle:** skill-based orchestration with worktrees and loops | Round Table squires, each in its own worktree (M2) |
| Trust first, then parallel | Parallel squires only where verification exists |

## Andrej Karpathy

Sources: [LLM wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f), [autoresearch](https://github.com/karpathy/autoresearch)

| Idea | How Galahad uses it |
|---|---|
| **LLM wiki:** raw sources (read-only) → an LLM-maintained wiki → a schema file; operations ingest / query / lint; an `index.md` catalog; an append-only `log.md` | The mind's **compiled knowledge layer**. Memories are raw, while compiled pages are maintained by the `swift` and `planner` roles. Good answers are filed back, and a lint pass finds contradictions and stale claims. |
| **autoresearch:** a human-written `program.md`; one editable surface; fixed-budget runs; `results.tsv`; keep or discard; the simplicity criterion | The Trials' self-improvement loop and experiment ledger ([TRIALS](TRIALS.md)) |
| Partial autonomy with a fast generate → verify loop | Autonomy classes in the oath. Approvals are batched and come to whichever device you're holding. |

## Simon Willison

Source: [The lethal trifecta](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/), plus Meta's "Rule of Two" ([summary](https://memx.app/blog/lethal-trifecta-ai-agent-data-exfiltration/))

| Idea | How Galahad uses it |
|---|---|
| Private data + untrusted content + a way to communicate externally = exfiltration | **No squire gets all three.** Untrusted work runs sandboxed on the server, with no vault access and only narrow outbound access. Content from untrusted sources is tagged `untrusted` in the mind and can never change the oath or permissions. |

## Jesse Vincent: obra/superpowers

Source: [superpowers](https://github.com/obra/superpowers)

| Idea | How Galahad uses it |
|---|---|
| brainstorm → worktree → plan (2–5 minute tasks) → subagent-driven development with two-stage review (spec, then quality) → TDD → finish the branch | The Round Table pipeline for engineering quests (M2) |
| verification-before-completion; systematic debugging | Oath duty; a skill set for squires |

## HumanLayer: 12-factor agents

Source: [12-factor-agents](https://github.com/humanlayer/12-factor-agents)

| Factor | How Galahad uses it |
|---|---|
| Own your prompts, context window and control flow | A byte-stable persona with appended context; Galahad owns his loop, and arms are tools |
| Unify execution state and business state | One event log is the source of truth. *Built.* |
| Launch / pause / resume | Quests with checkpoints (M2) |
| Contact humans with tool calls | Approvals and secret requests (secret requests *built*) |
| Compact errors into context; escalate after three consecutive errors | Squire runtime rule (M2) |
| Small, focused agents; agent as a stateless reducer | Squires; materialized state as a fold over events (*built*) |

## Geoffrey Huntley: the Ralph loop

Source: [Ralph loop](https://linearb.io/blog/ralph-loop-agentic-engineering-geoffrey-huntley)

Use a deliberately simple outer loop, with a fresh context each iteration and git as the memory. Galahad uses Ralph-style loops for long engineering quests, always bounded by budgets, tests and the oath.

## Nous Research: Hermes Agent

Sources: [hermes-agent](https://github.com/NousResearch/hermes-agent), [docs](https://hermes-agent.nousresearch.com/docs/llms.txt)

Hermes provides `SKILL.md` skills (compatible with agentskills.io), memory providers, a 20+ platform messaging gateway, ACP (`hermes acp`), an OpenAI-compatible API server and terminal backends (docker, ssh, modal, daytona). Hermes is an arm. Galahad becomes **its memory provider**, so what Hermes learns lands in the one mind (M1).

| Idea | How Galahad uses it |
|---|---|
| A learning loop: after work, write a skill; track its use; let unused ones go stale; archive, never delete; a ledger of every change with one-step rollback; the owner can lock a skill | **Skills** ([ARCHITECTURE §9½](ARCHITECTURE.md)): one note distilled from a quest that passed independent review, from the reviewer's evidence; each use and its quest's outcome recorded; stale after 14 unused days; retired, never deleted; every version a signed event with one-step rollback; locked means he uses it and never changes it. *Built.* |
| What went wrong there and on community hubs: skills as a prompt-injection persistence channel, a pattern scanner taken for a sandbox, self-improvement that rewrote the owner's skills | A skill is words, never something that runs or installs; the boundary is the mind's trust level and your approval of an exact version, not a scanner; he never edits yours. *Built* ([SECURITY](SECURITY.md)). |

## OpenCode

Source: [opencode.ai](https://opencode.ai)

OpenCode is a server with clients and an SDK (`opencode serve`). It's an arm for coding, driven with a scoped gateway token through `galahad run -- opencode` (*built*).

## The local AI scene

Sources: [exo guide](https://noqta.tn/en/blog/exo-labs-local-ai-cluster-frontier-models-guide-2026), [distributed inference notes](https://localaimaster.com/blog/distributed-inference-local-ai)

- **Runtimes:**
  - llama.cpp (Georgi Gerganov), including its RPC backend for mixed hardware.
  - exo with MLX for Apple Silicon clusters.
  - Ollama for convenience.
- **Doctrine:**
  - Run a model on one box whenever it fits. Distribute only when it doesn't.
  - The network is the bottleneck.
  - Local models fill the `swift` role first (*built* roster default).
