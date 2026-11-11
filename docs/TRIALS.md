# The Trials: how we know Galahad is getting better

Two claims need evidence, always. First, **quality holds**: nothing regresses. Second, **intelligence grows**: Galahad can do more, better or cheaper over time. Both are measured, not assumed.

> **Status:** L0 exists today (typecheck and 380+ tests, including property and two-node end-to-end tests). The first L1 suite exists too: **engineering** ✅, fourteen problems with exact answers, run with `galahad trial run`, scored into the Galahad Index. Everything else here is planned for M4 🔜.

## Layers

| Layer | What it checks | Graders | State |
|---|---|---|---|
| **L0: code gates** | Typecheck, unit tests, **property tests** (shuffled and duplicated delivery converge to one digest; rebuild = same state), two-node e2e over HTTP. 🔜 Deterministic multi-node simulation with partitions and clock skew. | Programmatic | ✅ |
| **L1: capabilities** | Per role and per modality (planning, coding, review, summarization, vision, speech…). ✅ The engineering suite: mathematics, physics and engineering problems with exact answers, solved end to end in the Lab. | Programmatic first (exact match, schema, tests pass, executes). LLM judges second: a *different model family* from the candidate, pairwise comparison with positions swapped, calibrated against your labels. | ✅ engineering · 🔜 the rest |
| **L2: agentic** | End-to-end tasks in sandboxes on the server: a repo plus a task plus **hidden tests** (SWE-style) | Hidden tests, diff review | 🔜 |
| **L3: in the wild** | Real quests: success, your corrections, rejected approvals, cost, wall time | Ledger analytics | 🔜 |

## The engineering suite ✅

`galahad trial run` poses each problem, Galahad solves it as an ordinary quest in the Lab (planner → engineer → independent reviewer), and a program grades the numbers he leaves in `/work/out/answer.json`. `galahad trial problems` lists them; name problems or domains to run some (`galahad trial run electrical rlc-step`), `--repeat 3` for more samples, `--parallel 3` at a time.

| Problem | Domain | Asked for | Exact answer, checked against |
|---|---|---|---|
| `cantilever-beam` | structures | Tip deflection, peak bending stress, first natural frequency | Closed form; Hermite beam FEM (static and modal) |
| `fixed-pinned-column` | structures | Critical load, the exact effective length factor, where the buckled shape peaks | tan kL = kL; FEM buckling eigenproblem. K = 0.7 or "mid-height" fail |
| `two-span-beam` | civil | Reactions, the hogging moment over the middle support, the span's peak moment | Three-moment equation; beam FEM |
| `rectangular-torsion` | mechanical | Torsion constant, peak shear stress, twist | Timoshenko & Goodier's series; a double Fourier series of the Prandtl stress function |
| `two-mass-oscillator` | mechanical | Both natural frequencies and mode shapes | Closed form; a generalized eigensolver |
| `rlc-step` | electrical | Damping ratio, time and value of the overshoot peak, voltage at a later time | Closed form; ODE integration |
| `diode-resistor` | electrical | Current, diode voltage and power, with the Shockley equation | Bisection to the last bit; Lambert W |
| `hohmann-plane-change` | aerospace | Both burns with the plane change at apoapsis, total Δv, transfer time | Vis-viva; the transfer orbit flown numerically, burns as vectors |
| `regenerative-brayton` | aerospace | Net work, efficiency, back-work ratio, exhaust temperature | Closed form; entropy balance solved numerically |
| `lid-driven-cavity` | fluids | Re = 100: centreline velocity extremes and where, the primary vortex's strength and centre | No closed form: Taylor–Hood FEM on 32² to 128² meshes, agreeing to 6 digits. Ghia, Ghia & Shin (1982) pass |
| `plate-quench` | thermal | Mid-plane and surface temperature, fraction of energy lost, after a sudden quench | The eigenfunction series (ζ tan ζ = Bi); the PDE by the method of lines |
| `large-amplitude-pendulum` | physics | Period, peak speed, peak rod tension at 60–175° | Complete elliptic integral by the AGM; ODE integration. Small-angle formulas fail |
| `drag-projectile` | physics | Range, flight time, apex, landing speed with quadratic drag | RK4 at 10⁻⁴ s with events located by bisection; DOP853 |
| `oblique-hole-plate` | geometry | Volume, mass and surface area of a plate with a tilted bore | Cavalieri's principle; OpenCascade (build123d) |

Every problem but the cavity draws **fresh random parameters** from a seed each time, so a remembered textbook number doesn't help; the seed is recorded, so any trial can be posed again exactly. Tolerances (0.05 % to 0.5 %, the cavity 2 % to 4 %) are tight enough that a rule of thumb fails where it should and loose enough that a sound numerical method passes.

**The suite is itself verified.** `scripts/trials-crosscheck.py` re-solves 25 random draws of every problem by an independent method in the Lab (the right-hand column); the worst disagreement is 1.5 × 10⁻⁵, against tolerances of 10⁻³ and up. `scripts/trials-cavity.py` computes the cavity's reference values.

**Across the slots, and with effort.** Trials run in parallel across the fleet's free sandbox slots (`--parallel auto`, the default; a number is kept within what the slots carry, and work that doesn't fit waits rather than oversubscribing a host). `--effort 2` or `3` makes that many independent attempts a trial; the independent reviewer takes one on the evidence, **before anything is graded**, and only that attempt's answers count. A run records its effort before its first trial (`trial.run`), so runs can be told apart. `galahad trials` and the Trials page then show the **Index per effort level**, each with its 90 % interval, and a verdict by the rule below: more effort "measurably helps" only if its interval clears effort 1's. When it doesn't, the report says so: "No measurable difference… More compute hasn't been shown to help on this suite." A run is measured at one level (`auto` isn't offered for trials: it would mix them), a fleet that can't carry one trial at the effort asked doesn't start the run, and a trial the node couldn't give that effort to is recorded as crashed, which isn't counted.

**What keeps a score honest:**

- **Programs grade, never models.** The exact answers live in the grader on the node, never in the sandbox; the sandbox has models only (no internet: nothing to look up).
- **The grader never picks.** With effort, the reviewer chooses among attempts from their evidence alone and the grader only ever sees the one taken: a wrong pick scores as wrong, even when another attempt was right (tested). Otherwise more attempts would score better by letting the answer key choose.
- **Only plain numbers count**, in the units asked for. A missing key, a string or a wrong unit scores nothing for that answer.
- **The thing measured can't write its marks.** Recording a trial needs `brain:write`, which agents (arms) never get, and **every replica checks** that each verdict follows from the recorded numbers and the score is the share passed; an inflated mark is refused by the log itself.
- **Crashes aren't counted** (no sandbox, a model outage: that says nothing about ability) and are shown separately; a run you stop isn't recorded at all. Running out of commands is scored: that is ability.
- **Every trial keeps its work** (scripts, plots, the answer file) as an artifact, so any score can be audited.

`galahad trials` shows the Index for each run (mean score, 90 % bootstrap interval, the revision and the models that ran it) and how each problem has fared over every run; `galahad trial <id or run>` shows every answer next to the exact one. The PWA shows the same under **Trials**.

## Rules that keep the numbers honest

- **Every correction becomes an eval case.** When you correct Galahad or reject an approval, the case is captured, analyzed for its failure mode (error analysis in the Hamel Husain / Shreya Shankar style) and added to L1 or L2. Following Lauren Tan, the goal is to make a recurring mistake *impossible*, not just less likely.
- **Frozen held-out set.** A private set is never used for tuning or prompt iteration. It is only ever scored.
- **Fresh tasks against contamination.** Tasks rotate in from recent commits and issues, so a model can't have seen them in training.
- **Experiment ledger.** Like autoresearch's `results.tsv`, every trial records `config/commit · score · cost · time · status (keep | discard | crash) · note`. Nothing is promoted without a row. ✅ Trials record the revision, the models, the score, the time, scored or crashed, and a note; cost needs token accounting, which comes with M4.
- **Fixed budget per experiment.** Self-improvement follows the autoresearch loop: change one surface, run with a fixed budget, keep only if better, otherwise revert. At equal score, the simpler version wins.

## The Galahad Index

A weighted composite score across task categories, tracked over time:

- **Cost-normalized:** quality per dollar and per second sit alongside raw quality. Getting cheaper at equal quality counts as growth.
- **Bootstrap confidence intervals:** a change "wins" only if its interval clears the incumbent's. ✅ Each run's Index carries a seeded 90 % percentile bootstrap interval.
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
