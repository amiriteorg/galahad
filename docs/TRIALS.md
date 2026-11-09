# The Trials: how we know Galahad is getting better

Two claims need evidence, always. First, **quality holds**: nothing regresses. Second, **intelligence grows**: Galahad can do more, better or cheaper over time. Both are measured, not assumed.

> **Status:** L0 exists today (typecheck + 50+ tests, including property and two-node end-to-end tests). Everything else here is planned for M4 🔜.

## Layers

| Layer | What it checks | Graders | State |
|---|---|---|---|
| **L0: code gates** | Typecheck, unit tests, **property tests** (shuffled and duplicated delivery converge to one digest; rebuild = same state), two-node e2e over HTTP. 🔜 Deterministic multi-node simulation with partitions and clock skew. | Programmatic | ✅ |
| **L1: capabilities** | Per role and per modality (planning, coding, review, summarization, vision, speech…) | Programmatic first (exact match, schema, tests pass, executes). LLM judges second: a *different model family* from the candidate, pairwise comparison with positions swapped, calibrated against your labels. | 🔜 |
| **L2: agentic** | End-to-end tasks in sandboxes on the server: a repo plus a task plus **hidden tests** (SWE-style) | Hidden tests, diff review | 🔜 |
| **L3: in the wild** | Real quests: success, your corrections, rejected approvals, cost, wall time | Ledger analytics | 🔜 |

## Rules that keep the numbers honest

- **Every correction becomes an eval case.** When you correct Galahad or reject an approval, the case is captured, analyzed for its failure mode (error analysis in the Hamel Husain / Shreya Shankar style) and added to L1 or L2. Following Lauren Tan, the goal is to make a recurring mistake *impossible*, not just less likely.
- **Frozen held-out set.** A private set is never used for tuning or prompt iteration. It is only ever scored.
- **Fresh tasks against contamination.** Tasks rotate in from recent commits and issues, so a model can't have seen them in training.
- **Experiment ledger.** Like autoresearch's `results.tsv`, every trial records `config/commit · score · cost · time · status (keep | discard | crash) · note`. Nothing is promoted without a row.
- **Fixed budget per experiment.** Self-improvement follows the autoresearch loop: change one surface, run with a fixed budget, keep only if better, otherwise revert. At equal score, the simpler version wins.

## The Galahad Index

A weighted composite score across task categories, tracked over time:

- **Cost-normalized:** quality per dollar and per second sit alongside raw quality. Getting cheaper at equal quality counts as growth.
- **Bootstrap confidence intervals:** a change "wins" only if its interval clears the incumbent's.
- **Per role and per model:** this is what the roster is tuned against.

## Promotion gates

A change ships only if it is **not worse on held-out beyond noise** *and* **better on its target**. This applies to:

| Change | Gate |
|---|---|
| Roster (new model for a role) | L1 for that role plus held-out; cost within the oath's limits |
| Skill or prompt | The L1/L2 cases it touches plus held-out |
| Self-update (code) | L0 green, L2 smoke, held-out; then signed release → canary → fleet (M5) |

## Scout

A Scout squire watches for new models, harness releases, MCP servers and skills. It trials each one in a sandbox against L1 and L2, writes the ledger rows, and proposes promotion with a scorecard. You approve, or sign a standing order such as "auto-promote if it beats the incumbent and costs ≤ 1.5×".

## You, five minutes a week

The PWA will show a handful of random recent outputs to rate. Your ratings calibrate the LLM judges, so automated grading stays aligned with your taste. 🔜 Index trends and ledger dashboards will also live in the PWA.
