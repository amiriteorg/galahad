# The feature plan

What Galahad builds next, in order, and why. Each item says which of the [mandate's](MANDATE.md) numbers it should move (correctness, horizon, cost, reversibility; the north star is human interventions per completed task) and how that will be told. Ideas come from the owner, from other agents (Hermes Agent, Grok Bot, OpenAI Dots, OpenMausBot, Rakazo) and from proposals. Some were declined: the end says which, and why.

✅ built · 🔨 being built · 🔜 planned · ✋ declined

## Next, in order

What breaks today comes first, then what costs too much, then what Galahad can't do yet.

| # | What | Moves, and how it's told | From | State |
|---|---|---|---|---|
| 1 | **Galahad leads in rooms.** What you say to a room without naming a knight is his: he answers, and brings in only the knights the work needs. | Cost: one turn of his and theirs, not one of every knight's. Interventions: you ask the room, not each knight. | Grok Bot's chief of staff; Rakazo's and OpenMausBot's room routing | ✅ 16 Nov 2026 |
| 2 | **Knights' computers that grow.** A knight's VM gets more cores, memory or disk while it runs, with no restart and its work kept (a real microVM went from 2 to 4 cores, 4 to 6 GB and 1 to 3 GB of disk live). Sandboxes are admitted by their real size, so idle knights no longer fill every slot. Shrinking happens when the VM is made again. | Horizon: no task dies of a full disk or of memory. Told by tasks that fail with no space or out of memory, and by sandboxes that wait for a slot. | The owner | 🔨 |
| 3 | **Cheaper coding plans.** Xiaomi MiMo's, NanoGPT's and other flat-rate plans join OpenCode Go and the rest, each used only as far as its vendor's own terms allow. | Cost per completed task, from the census. | The owner | 🔨 |
| 4 | **Chores on cheap models.** Every background call names its role: folding a long chat, a room's story, understanding the archive, distilling a skill, the heartbeat's checklist, looking at a screen. Any chore can be sent to another role or model. | Cost: tokens a day by chore, in the census. | Hermes' auxiliary models | 🔜 |
| 5 | **Lean context.** A long chat is folded into a story past a threshold, as rooms are already. In a quest, tool output that has been superseded (a file since edited, an error since fixed, a log since run again) becomes a one-line stub when context is folded, never in the middle of the cached prefix. Exact diffs, paths and the latest error stay whole. | Cost and correctness: tokens per task and pass rate in the trials. | Hermes' compression; a proposal for semantic garbage collection | 🔜 |
| 6 | **Switch, and escalate when stuck.** Galahad and a quest can move the rest of a turn to another role: down for repetitive work, up when stuck. When the same gate fails twice, the next attempt goes to the strongest role. | Cost and correctness: dollars and pass rate per task in the trials. | Hermes' `model_switch` | 🔜 |
| 7 | **A decider on your own machine.** The `decider` role answers typed decisions (yes or no, one of several, a score) with probabilities. Today only TypeSafe's Jev can fill it, through its API. A small model on the node (llama.cpp) is to answer the same way, by reading its next-token probabilities over the options it was given and normalising across those alone, with no text generated. That is SemIf's method (formerly OpenJev), run on the node instead of in a browser. | Cost: decisions and chores (#4) at no API cost, and nothing leaves the machine. Told by a decision set in the trials: accuracy and calibration (Brier score) against Jev's, before it decides anything that matters. | SemIf (openjev.com) | 🔜 |
| 8 | **Galahad's own computer.** A persistent VM with a desktop that is his, kept between conversations. You watch it and take it over as you do a knight's, and he works on it with a `computer` tool. | Horizon: work that needs a browser or a GUI, done by him. | Grok Bot's cloud computer; Dots' containers | 🔜 |
| 9 | **Knights' verified work teaches skills.** Today only his own quests become skills. | Horizon: interventions on the second similar task. | Hermes' curator | 🔜 |
| 10 | **Event triggers.** A loop can wake on a signed webhook, new mail on a connector or a GitHub event, not only on a schedule. | Horizon: work started without you asking. | Dots' triggers | 🔜 |
| 11 | **Impact check before a deletion.** Before a plan removes or renames files, routes or exports, find what still depends on them (imports, routes, tests), and ask only when something does. Done by search, not by a model's guess. | Reversibility and interventions: bad merges caught before, not reverted after. | A proposal for intent and drift prediction, made deterministic | 🔜 |
| 12 | **Fork at the doubt.** When the planner names two approaches, the worktree is branched, both are worked, and the gates and the independent reviewer pick one. (`--effort` already forks, but at the start.) | Correctness, its cost bounded by the effort budget: pass rate and dollars per task in the trials. | A proposal for speculative forks | 🔜 |
| 13 | **Night practice.** A nightly loop within a budget re-runs the day's failed quests in fresh sandboxes against their gates; what passes review becomes a skill. Memory is linted for duplicates and contradictions on the swift role. | Horizon and correctness over time, with spend capped by the budget. | A proposal for sleep-time consolidation; the mind's maintenance in [DOCTRINE](DOCTRINE.md) | 🔜 |
| 14 | **Keys a knight uses but never sees.** A knight's script gets a placeholder, and the gateway swaps in the vault's key only on the key's pinned address. Models and connectors already work this way. | Horizon, without new exposure: a knight calls an API you gave a key for. | A proposal for zero-knowledge vaulting | 🔜 |
| 15 | **Show me once.** While you take over a knight's desktop, your steps (addresses, clicks, keys, with what you type withheld) are kept as structured steps, and the knight writes them up as a skill. | Horizon: a GUI task you did once isn't asked of you again. | Grok Bot's learning from a recording | 🔜 |
| 16 | **Chat apps.** Talk to Galahad and the rooms from Telegram first, then Slack, Discord, Signal and WhatsApp. Your own account is verified; anyone else's words are data. | Reach. | Hermes' gateway; Dots in Slack and Teams | 🔜 |
| 17 | **Export a knight.** Its name, job, role, harness and skills as a Markdown bundle, with keys scrubbed and nothing executable, to import on another node. | Reuse. | OpenMausBot's portable bots | 🔜 |
| 18 | **What he knows of you.** One page of durable facts he keeps about you (preferences, conventions, what not to do), yours to read and edit. | Interventions: corrections you don't have to repeat. | Hermes' `USER.md` | 🔜 |

## Already here

What the others are known for, and where Galahad has it.

| Their feature | Galahad's |
|---|---|
| Approval cards before outward or destructive actions (OpenMausBot, Rakazo) | The oath gate and approve cards, with a notification on your phone ✅ |
| Named, persistent bots that talk to each other (Grok Bot, Hermes' bot mode) | Knights, in rooms and in direct messages between knights ✅ |
| A manager bot that coordinates the others and reports (Grok Bot) | Galahad leads every room (#1) ✅ |
| A computer per agent, with a terminal and a browser, working while you're away (Dots, Rakazo) | A KVM microVM per knight, with a desktop, a terminal and its work kept ✅ |
| Schedules (Dots, Hermes) | Loops ✅ (events: #10) |
| Skills written after hard work (Hermes) | Skills from quests that passed independent review ✅ (from knights' work: #9) |
| Memory with full-text search (Hermes) | The mind, and the archive by words and by meaning ✅ |
| Agent CLIs behind one chat (OpenMausBot) | Knights on OpenCode, Claude Code, Codex or Hermes, each event in one stream ✅ |
| The brain kept apart from where code runs; throwaway sandboxes (Rakazo) | The node and its sealed vault, VMs and sandboxes apart ✅ |
| No two tasks on one agent's shared state at once (Rakazo's leases) | Each knight works one thing at a time, across rooms and tasks ✅ |
| Models chosen by role (Hermes) | Planner, engineer, reviewer, swift, decider, eyes and embedder ✅ (per chore: #4) |
| Keys never in the agent's hands | The model gateway and connectors inject them ✅ (knights' own scripts: #14) |

## Declined, and why

| Idea | Why not |
|---|---|
| One shared computer whose logins every bot uses (Grok Bot) | One compromised knight would hold every session. A knight signs in on its own VM (you can take it over to do so), and Galahad on his own (#8). |
| Bots that start with full access and no sandbox (OpenMausBot's default) | Every knight works in its own VM, always. |
| A registry of tools the agent writes for itself (a just-in-time MCP forge) | Code an agent writes and later runs as one of its own tools is a channel for whatever injected it to persist, and each tool is one more way to pick wrong. Scripts in a knight's `/work`, and skills that name them, do the same job. Revisit if the trials show the same script written again and again. |
| Pheromone trails for a swarm of workers | Galahad runs a handful of knights, each in its own VM and clone, and rooms and tasks coordinate them. Revisit with many workers on one repository. |
| Thousands of connectors as a catalog (Dots) | Remote MCP servers, added as connectors, cover the long tail with no catalog to keep. |
