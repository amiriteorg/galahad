# The scorecard: is he moving the right way?

The [Trials](TRIALS.md) measure what costs model tokens: how good his answers are. This measures everything else: the algorithms, and whether the system grows when it's given more devices and more compute. One command, no model calls, no network, a few minutes:

```sh
bun run bench                       # every suite, against its recorded baseline
bun run bench fleet compute         # some suites
bun run bench --full                # the long sizes too (32 nodes, bigger logs)
bun run bench --all                 # every metric, not just the headline ones and those that moved
bun run bench --json                # the scorecards and verdicts on stdout
bun run bench --ci                  # what CI gates on: quality only
bun run bench --seed 7              # other inputs
bun run bench --update-baseline     # record this run as the baseline, on purpose
```

It prints, for each suite, what it measured, the baseline, the change and a verdict; writes `bench/out/<suite>.json`; and exits non-zero when something got worse. A change that should make something better, by a person or by Galahad himself, is shown with it: before and after.

## The rules

They are the Trials' own, applied to what a program can measure by itself.

- **Programs grade, never models.** Every input is drawn from a seed (`--seed`, by default 20 261 112), so any result can be reproduced exactly. The seed and the revision are in every scorecard.
- **Two kinds of metric, kept apart.**
  - **Quality** is exact and deterministic: whether replicas converged, how many events a replica wrongly refused, whether a search found what it should. The same seed and code give the same value, so any change is a real change. One for the worse **fails the run**, and so does a metric the baseline had that the run no longer reports (a benchmark can't pass by measuring less).
  - **Speed** is a timing: the median of repeated samples, with their interquartile range. It is compared after scaling by the machine's calibration (below), a difference inside the noise band isn't called a change, a slower one beyond it is reported with its size, and it **fails only past 2× slower** (and never under `--ci`).
- **A change wins only beyond noise** (see "Noise").
- **A fixed budget.** The default run took about two and a half minutes on the reference machine (an i7-11700) while it was doing other work, and `--full` about twenty; that was with the two suites of the 3D world, which were removed with it on 14 November 2026 and were about a quarter of the default run. It hasn't been timed there since. Each suite runs alone.
- **Baselines are recorded on purpose.** One file a suite in `bench/baseline/`, small, one metric a line, reviewed like code. Only `--update-baseline` writes them; a default run's baseline keeps the `full.` metrics the last full run recorded.
- **Nothing is retried.** A timing that came out slow is reported slow; a simulation that failed, failed.

## Reading it

```
fleet: N replicas over the real sync engine and a hostile network: do they converge, and what does a device cost?
  quality: 62 same, 0 better, 0 regressed · speed: 15 same, 0 faster, 0 slower · 44.1 s · calibration 51,830 (0.84× the reference)
  metric                          kind      value      baseline  change  verdict
  fleet.n16.converged          quality          1             1   0.0 %  same
  fleet.n16.replays-per-node   quality  9.13 replays  9.13 replays  0.0 %  same
  fleet.n16.run                  speed   27,010 ms   26,400 ms  +2.3 %  same (within noise)
```

| Verdict | Means | Fails the run |
|---|---|---|
| same | The same value (quality), or inside the noise band (speed) | |
| BETTER / FASTER | Improved; faster beyond noise | |
| slower | Slower beyond noise, less than 2× | |
| REGRESSED | A quality metric got worse, or a speed metric is more than 2× slower beyond noise | yes |
| GONE | The baseline has it and the run didn't report it | yes (a speed metric: not under `--ci`) |
| new | Not in the baseline (or it changed its unit or direction) | |
| BROKE | The suite threw | yes |

A suite with no baseline, or run with another seed, isn't judged (under `--ci` that fails). `--all` lists every metric; each has a note in the JSON saying what it is.

**The file.** `{ suite, commit, at, seed, machine: { name, calibration, cores }, metrics: [{ id, value, unit, kind, better, spread?, n?, note? }] }` (`packages/core/src/scorecard.ts`, checked with zod wherever one is read). `value` is as measured on that machine; `spread` is how much the number moves when nothing changed (a timing's interquartile range; a quality metric's stated resolution, when it has one); an id starting `full.` is measured only by `--full`.

## Noise

A quality metric has none: it's a count, or exact arithmetic on seeded inputs. One that passes through the machine's own sine, cosine or square-root-of-sums, whose last bit can differ between platforms, states a resolution, and a difference within it isn't a change (no suite needs one today).

Speed is another matter on a machine that is doing other work, as the reference machine often is:

- **The calibration is taken while the suite runs, not before it.** A node calibrating itself takes the best of three windows of the kernel (`packages/node/src/compute/bench.ts`), to learn what the machine can do. A benchmark needs what the machine was doing while each timing was taken. So a window of a few milliseconds is taken beside every sample, each sample is brought to the suite's own pace by the windows either side of it, and the scorecard's `machine.calibration` is the median of all the suite's windows (`Pace` in `bench/lib.ts`). Two things were tried first and measured: one best-of-three reading before a forty-second suite made the same code read 31 % to 51 % "faster" than itself; one median for the whole suite let a burst of other work in the suite's last seconds read as a regression.
- **The band.** Two runs of the same code are called the same when they differ by less than 25 %, or by less than 1.5 times their two spreads added, whichever is more. Measured on the reference machine while it was busy at between 0.4 and 0.85 of its own speed: two more default runs of the same code, minutes apart, gave the same value for all 281 quality metrics both times; of 149 timings, 143 were called the same, 5 faster and 1 slower, none a failure. The timings themselves differed from the baseline's by a median of 8 to 10 %, by 26 to 33 % at the 90th percentile, and by more than 40 % in four. So a timing verdict here is a hint to look, never a proof; a quality verdict is exact.
- **A fail needs 2×.** Beyond the band and more than 2 times slower. Under `--ci` speed never fails: a runner isn't the machine the baseline was taken on, and the kernel is good to about one part in ten between machines.

## The suites

### fleet: can the mind grow to more devices?

N replicas, each a real `MindStore` with its own keys and its own clock, exchange real signed events through the real sync engine (`SyncEngine`, `PullState`, `answerSync`, `answerPush`, signed requests checked at the door with the real verifier and nonce cache) over a transport that is a function call (`bench/fleet/sim.ts`). The transport does what networks do, from a seed: it delays (a few to a few tens of milliseconds, now and then seconds, so two pushes a millisecond apart often arrive the other way round), duplicates and drops; the fleet is partitioned and heals, while the founder revokes a node on the other side that keeps working and talking; a node is away for a long while and returns; a clock runs three minutes ahead (inside what the log allows, outside what the door allows), and another twenty (beyond what the log allows); a stranger knocks, and an enrolled node passes on what the stranger signed and an event that was tampered with. Virtual time and the random source are the simulation's, so a run is the same to the last byte: rounds, events and bytes are counts.

It is the deterministic multi-node simulation the Trials planned for L0, and also runs as a normal test at 2 to 5 nodes (`bench/fleet/sim.test.ts`).

| The same work on | 2 nodes | 4 | 8 | 16 |
|---|---:|---:|---:|---:|
| Converged (same events, same state, same as a replica fed the log in order, same after a rebuild) | 1 | 1 | 1 | 1 |
| Wrongly refused or missing · wrongly kept | 0 · 0 | 0 · 0 | 0 · 0 | 0 · 0 |
| Rounds of pulls to agree after a partition heals · a node returns · a clock is put right | 1 · 1 · 1 | 1 · 1 · 1 | 1 · 1 · 1 | 1 · 1 · 1 |
| Events carried for each one needed | 1.45 | 1.38 | 1.28 | 1.17 |
| Bytes on the wire for each event a replica needed | 854.8 | 1,081 | 1,927 | 4,908 |
| Full replays of the log a replica made | 2 | 5 | 8.43 | 9.13 |
| A node's share of one quiet round, bytes (every 5 s) | 434 | 1,416 | 8,442 | 39,705 |
| One event written and taken by every replica, ms (the whole fleet in one process) | 4.84 | 7.51 | 20.26 | 83.48 |

What it says:

- **It converges, at every size, under everything thrown at it**, and exactly the right events count: nothing of a node in good standing is refused or missing, nothing a revoked device signed after its pin counts, nothing a stranger signed is stored. A healed partition, a returning node and a corrected clock each take one round of pulls.
- **A clock twenty minutes ahead mutes its node for a quarter of an hour after it's put right** (960 s): the log refuses what's dated more than five minutes ahead, and that node's own clock never goes back, so everything it writes is refused until time catches up. Nothing is lost. A clock between one and five minutes off can't talk at all (the door's window is 60 seconds) though the log would take its events.
- **The cost of a device grows faster than linearly.** A quiet fleet's chatter is every node asking every other, each request carrying a line for every device: a node's share grows as N to the power 2.21, the whole fleet's as the cube. At 4 nodes that is 1,416 bytes a node every five seconds, at 16 it is 39,705, at 32 (with `--full`) 170,980. Fine for the fleets there are (2 to 8); the first thing to change before a fleet of dozens (ask a few peers a round rather than all, or send one hash of the frontier and the full map only when it differs).
- **Delivering an event gets dearer with the fleet too** (bytes for each event needed grow as N to the 0.840): every write is pushed to every peer as its own signed request.
- **A longer log costs a fleet little more for each event.** On four nodes, from 214 events to 4,005 (with `--full`): bytes for each event needed stay near 934.8, a replica's full replays go from 5 to 22.33 (each one longer, as the log is), and the simulation's time grows in step with the log. Thirty-two nodes converge like the rest (1), each paying 170,980 bytes a quiet round.
- **Found and fixed: pushes that overtook each other replayed the whole log.** Each fresh event is its own request; one that arrived before its predecessor was held as a gap, and the log replayed itself to say so, again for every event that followed and once more when the gap was filled. `answerPush` now takes only what extends a chain and leaves the rest for the next pull. The same runs, the door as it was and as it is:

  | Full replays a replica made | 2 nodes | 4 | 8 | 16 | 4 nodes, three times the log |
  |---|---:|---:|---:|---:|---:|
  | Before | 10.5 | 36.3 | 53 | 72.3 | 104.7 |
  | After | 2 | 5 | 8.4 | 9.1 | 12.7 |
  | Events carried for each needed, before → after | 1.34 → 1.45 | 1.73 → 1.38 | 2.01 → 1.28 | 1.91 → 1.17 | 3.30 → 1.48 |

  What still replays is by the mind's own rules: an event other than a ledger entry or a loop run that arrives dated before the log's newest (a memory, a notice, a profile), and a revocation. A replay is the whole log (see the mind, below), so a fleet with many writers and long logs wants those applied in place too; that is the next thing this number would reward.

### compute: does more of it make the work go faster?

Queues of independent quests (the Trials' shape) at effort 1, 2 and 3 on fleets of 1, 2, 4 and 8 machines of different measured strengths, in virtual time (`bench/compute/sim.ts`). A real mind holds each machine's profile, calibration and the owner's ceilings; the real census (`ComputeService`) derives what each carries; the real placement ranks hosts for every sandbox from what the asking node knows (its own slots live, the others' as old as their last sync); each host's real `Governor` admits a sandbox or makes it wait; the asking node's governor rations model calls. Only the work is a stand-in: a sandbox start, a model call and a command take a seeded, known time. The machines carry 3, 6, 1, 1, 5 and 2 slots at their default ceilings, one is held to a single sandbox by its owner, one is told to take none.

| A trial run (42 quests), as many at once as the slots carry | 1 machine | 2 | 4 | 8 |
|---|---:|---:|---:|---:|
| Slots | 3 | 9 | 11 | 19 |
| Effort 1: virtual seconds | 9,843 | 3,935 | 3,519 | 2,878 |
| Effort 2 | 26,858 | 7,111 | 6,322 | 4,608 |
| Effort 3 | 26,858 | 9,274 | 9,472 | 6,359 |
| The long run (480 quests, effort 1): quests an hour | 18.38 | 60.58 | 70.64 | 95.17 |

What it says:

- **The ceilings hold.** Over 20 runs: no host over its sandboxes, threads or memory at any instant (0), nothing on the node told to take none (0), nothing lost or starved (0), every host serving in the order it was asked (0).
- **More machines finish sooner, short of linearly.** Eight machines with 6.3 times the slots finish a trial run 3.42 times sooner at effort 1, 5.83 at effort 2 and 4.22 at effort 3; in the long run they carry 95.17 quests an hour against 18.38 (0.818 of linear). A trial run is short (two or three quests a slot), so its end, where the last quests run alone, costs more than it does a long queue.
- **Past about sixteen slots, model calls are the limit, not sandboxes.** A quest's model calls each take one of the asked node's model-call slots, eight at once by default. A ninth machine, six slots more, bought 1.01× in the long run; with that node's ceiling at 32 model calls the same eight carry 115.9 quests an hour and the ninth buys 1.30×. `galahad compute` now says so where it says what another machine would buy (`whatMoreBuys`), and `galahad compute limit <node> --model-calls n` is the owner's to raise.
- **The default (`--parallel auto`) runs at most eight trials at once**, whatever the slots: on the eight machines at effort 1 that is 0.265 of the slot-time in use, and 4,166 virtual seconds against 2,878 with `--parallel 19`. It matches the eight model calls; it doesn't follow that ceiling when the owner raises it.
- **Adding weak machines can slow a run at effort.** At effort 3, four machines (11 slots) take 9,472 s where two (9 slots) take 9,274: both run three trials at once, a trial ends when its slowest attempt does, and with more hosts some attempts land on the slow ones. Placement fills by strength and room; it doesn't keep a quest's attempts on like hosts.
- **Found and fixed: a burst of sandboxes queued on one host while others stood idle.** Another host's slots are known only as of its last sync. Every sandbox asked for in the same seconds was placed by the same picture, all went to the best-ranked host, and they waited there. The asking node now counts what it sent each host since that host last reported, and what it ended there (`Dispatched`). The same trial runs, before and after:

  | 8 machines | Effort 1 | Effort 2 | Effort 3 |
  |---|---:|---:|---:|
  | Virtual seconds, before → after | 3,276 → 2,878 (−12 %) | 5,033 → 4,608 (−8 %) | 7,204 → 6,359 (−12 %) |
  | The longest a sandbox waited for a slot | 1,346 s → 0 | 1,178 s → 0 | 1,465 s → 0 |
  | Slot-time spent waiting beside a free slot | 46 % → 0 | 28 % → 0 | 27 % → 0 |

  After, placement does exactly what it would with every host's slots known this instant.

### mind: what the log costs as it grows

A log shaped like a real one at 4,000 and 16,000 events (every event signed and chained), and each thing the daemon does with it timed. `scripts/bench-mind.ts` does the same at 5k, 40k and 400k (minutes).

| Milliseconds | 4,000 events | 16,000 | |
|---|---:|---:|---|
| Answering a pull from a peer in sync | 0.277 | 0.273 | flat |
| Each device's set hash | 0.160 | 0.145 | flat |
| An event this node writes (to a file, synced) | 6.45 | 7.36 | flat |
| A late ledger entry (applied in place) | 4.19 | 4.89 | flat |
| A late memory (the log replays) | 98.43 | 383.2 | grows with the log |
| A hole found and filled, end to end | 240.7 | 1,605 | grows |
| A rebuild | 190.7 | 815.1 | grows |

Quality: a late ledger entry never replays (0), no answer is more than a page (500 events), a hole is repaired to the same state, a rebuild gives the state it had. What it says: what happens every few seconds doesn't grow with the log; what grows is a replay, at about 51 microseconds an event (at 64,000 events, with `--full`: a late memory 1,056 ms, a rebuild 3,060 ms), which is why the fleet suite counts replays.

### archive: does a search find what it should?

A labelled, seeded set in which neither words nor meaning can do it alone: every topic has a sibling that shares half its words, and a neighbour close to it in vector space. A question names its topic in three of the shared words and a vector near it; what's relevant is that topic's ten entries among 600.

| | By words | By meaning | Both, fused |
|---|---:|---:|---:|
| Of what's relevant, the share in the first ten | 0.505 | 0.915 | 1 |
| Mean reciprocal rank | 0.779 | 0.988 | 1 |

Words alone find half (they can't tell a topic from its sibling), meaning alone most, the two fused all of it: that is what fusing is for, and a change to the fusion or the scan that loses it shows here. The int8 scan finds 0.995 of the ten passages a Float32 scan would. A search by both costs 2.81 ms over 1,200 passages, 7.49 ms over 4,800 and 90.13 ms over 76,800 (with `--full`: the scan is linear in the passages); `scripts/bench-archive.ts` times the index to 100,000 at the embedder's own 1,024 dimensions.

### harness-overhead: what the loop itself adds

The chat loop and the quest runner driven by stand-in models that answer at once and tools that return at once, in the provider's own wire format: 0.145 ms a tool round, 0.351 ms an answer without tools, 0.123 ms a quest step. Next to a model's seconds it is nothing, which is the point of holding it: a change that makes the loop slow shows here, where no model's latency hides it.

### context: what a quest sends its engineer

The characters of every turn's conversation with the engineer, summed over a whole quest, for three kinds of work a stand-in engineer does the same way every time: the tests run after each of 13 edits (336,141 characters on 16 November 2026), ten files each read, edited and tested (379,806; its last turn 20,250), and thirty different searches that each print a page (647,513). And how many turns, over the three, didn't begin with the turn before's conversation (6): each of those is a beginning a provider can't read from its cache. The engineer's conversation is most of what a quest costs, so a change that sends more, or rewrites what was cached, fails here before it costs anything. Lean context ([PLAN](PLAN.md) #5) is told here: outputs a later run superseded, and file contents a later edit made stale, are lines instead of excerpts (the second kind sent 420,792 characters, its last turn 23,286, before stale contents were cut on 16 November 2026).

## Adding a metric, or a suite

- A metric: in its suite, `ctx.quality(id, value, unit, "higher" | "lower", { note, resolution? })` for something exact, `ctx.time(id, fn, { n, warm, batch, per, note })` for something timed (or `ctx.speed(id, samples, unit, better, [from, to], note)` for samples timed elsewhere, with when they were taken). Names are lower case with dots and dashes; one only `--full` measures starts `full.`. Say in the note what the number is. Then record the baseline on purpose and commit it with the change.
- Quality must be the same every time: draw from `rng(subSeed(ctx.seed, "name"))`, never from the clock or `Math.random`; keep the machine's own sine and logarithm out of anything a threshold or a rank depends on, or state a resolution.
- A suite: a file in `bench/suites/` exporting `suite` (`name`, `about`, `headline`, `run(ctx)`), and its line in `bench/run.ts`. Keep it inside its share of the budget; put the long sizes behind `ctx.full`.

## What isn't measured here

- Model quality and the agent harness's effect on it: the [Trials](TRIALS.md).
- Real networks, real Docker, real disks under load: the simulations use the real decision code and stand-in work.
- The same quality values on another platform. They're expected to be the same (they are counts and exact arithmetic on seeded inputs), and the baselines were recorded on Windows.
