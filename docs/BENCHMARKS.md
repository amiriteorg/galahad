# The scorecard: is he moving the right way?

The [Trials](TRIALS.md) measure what costs model tokens: how good his answers are. This measures everything else: the algorithms, the models the world is made of, and whether the system grows when it's given more devices and more compute. One command, no model calls, no network, a few minutes:

```sh
bun run bench                       # every suite, against its recorded baseline
bun run bench fleet compute         # some suites
bun run bench --full                # the long sizes too (32 nodes, eighteen simulated years, bigger logs)
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
  - **Quality** is exact and deterministic: whether replicas converged, a path's length against the shortest, how many triangles have no area. The same seed and code give the same value, so any change is a real change. One for the worse **fails the run**, and so does a metric the baseline had that the run no longer reports (a benchmark can't pass by measuring less).
  - **Speed** is a timing: the median of repeated samples, with their interquartile range. It is compared after scaling by the machine's calibration (below), a difference inside the noise band isn't called a change, a slower one beyond it is reported with its size, and it **fails only past 2× slower** (and never under `--ci`).
- **A change wins only beyond noise** (see "Noise").
- **A fixed budget.** The default run takes about two and a half minutes on the reference machine (an i7-11700) while it is doing other work, `--full` about twenty minutes; each suite runs alone.
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

**The file.** `{ suite, commit, at, seed, machine: { name, calibration, cores }, metrics: [{ id, value, unit, kind, better, spread?, n?, note? }] }` (`packages/core/src/scorecard.ts`, checked with zod wherever one is read). `value` is as measured on that machine; `spread` is how much the number moves when nothing changed (a timing's interquartile range; a quality metric's stated resolution, when it has one); an id starting `full.` is measured only by `--full`. The SANDBOX's rendering in a real browser writes the same shape to `bench/out/world-scale.json` from its own runner (`bench/browser/world-scale.ts`), and `bun run bench` shows it when it's there.

## Noise

A quality metric has none: it's a count, or exact arithmetic on seeded inputs. A few pass through the machine's own sine, cosine or square-root-of-sums, whose last bit can differ between platforms; those state a resolution (a hundredth of an arc-minute, a millionth of a ratio) and a difference within it isn't a change.

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

### world-algorithms: the SANDBOX's algorithms, headless

No GPU and no browser: the same functions the page calls.

| | First baseline |
|---|---|
| Chunks grown twice that differ · the most two neighbours differ along an edge | 0 · 0 m |
| Biomes out of sane bounds over 2 km square (water 15.6 %, meadow 29.0 %, heath 15.6 %, woodland 12.6 %, pinewood 10.9 %, birchwood 6.9 %, outcrop 3.7 %, marsh 3.1 %, shore 1.6 %, lawn 1.0 %) | 0 |
| Ground under water that isn't water · water above the water | 0 · 0 |
| Of 9,093 things placed on the home ground: big ones on what's built · on his hearth · solid ones on his trail | 0 · 0 · 0 |
| Small ones under water · anything inside a solid of the keep | 2 · 9 |
| Finding a way, 300 pairs on the real map: no way found where there is one · a way through something solid | 5 · 2 |
| The planner's way against the shortest: mean · worst | 1.01× · 1.30× |
| A year of the whole cast over 5 seeds: residents lost · kinds over bounds | 0 · 0 |
| The sun against an independent series, 36 instants: mean · worst | 0.267′ · 0.641′ |
| The moon, likewise | 88.47′ · 166.3′ |
| Nine stars against the Naval Observatory, 17 instants: mean · worst | 0.394′ · 0.839′ |
| Sunrise and sunset against the almanac, worst of four | 0.751 min |
| A chunk's ground and big plants · its fine surface · a way planned | 1.96 ms · 2.58 ms · 0.579 ms |
| A thousand steps of the ecosystem: low · medium · high tier | 17.82 · 29.31 · 54.10 ms |

What it says:

- **The land is sound**: the same seed gives the same bytes, chunks meet exactly, water is where the ground is under it, and nothing big grows on what's built, on his hearth or on his trail.
- **The planner is near the shortest way almost always** (the reference is an exhaustive search over the whole home ground on a half-metre grid, pulled taut: `bench/world/reference.ts`), and it has two faults the reference found, held as tests that fail until they're fixed (`bench/world/world.test.ts`): on a long way its grid is coarse (cells up to 2.5 m), and a hop between two free cells with something thin between them is never swept, so 2 of 300 ways go through a solid; and it gives up on a way that needs more than a 120 m look round the blocked line, so 5 pairs across the water east of the keep (40 to 200 m apart, 400 to 500 m on foot) get none. With `--full`, 900 more pairs: 9 without a way, 4 through a solid, the mean 1.01× the shortest.
- **A few small plants are where they shouldn't be**: 9 tufts of grass and flowers inside solids of the keep (the lab's hill, the council's dais, a post), because what's built is asked of circles smaller than those solids; 2 under a stream's pool.
- **The ecosystem holds**: every resident through a year on every seed, nobody over what a tier may draw; its step costs 17.82, 29.31 and 54.10 microseconds on the three tiers. With `--full`, the fox and the hare alone for eighteen years over twelve seeds (the ecosystem's own test holds one seed to it): neither is ever lost or over its bounds; the cycle the test describes (a deep fall, a recovery, the two tied as predator and prey) shows in seven of twelve. In the others a lone fox can't breed and none wanders in while one is left (the test's range is topped up only below a tenth of what it holds), so the foxes stay at one for years and the hares at what the land carries. That is the test's thin immigration, not an instability: with the page's own (half) it can't happen.
- **The sun and the stars are right to under an arc-minute; the moon is off by one to three degrees.** It's computed from the main term of each coordinate, from the Earth's centre. The reference adds the next five terms in longitude, three in latitude, and the parallax of standing in Copenhagen. No almanac table can be fetched offline, so the sun and moon are cross-checked against an independent series (the Astronomical Almanac's low-precision formulae: `bench/world/sky.ts`), the stars against the Naval Observatory's figures the world's own tests hold.

### procedural-models: is every mesh sound?

Each builder is run headless, for each tier it builds differently, and what it made is read as it would be drawn (`bench/models/audit.ts`, which reads a geometry through the fields every one has and needs no three.js of its own): 87 models made by code (289,460 triangles), and the four real robots as the page loads them.

| | Made by code | The four real robots |
|---|---:|---:|
| Numbers that aren't | 0 | |
| Triangles of no area | 112 | 9 |
| Closed parts wound inside out (of 10,716 · 87) | 6 | 1 |
| Triangles of closed parts whose normals point in | 0 | |
| A face drawn twice in one place in another colour | 941 | 450 |
| A face drawn twice in the same colour | 469 | 259 |
| Skinned vertices (of 175,962) with weights that don't sum to one, or a bone that isn't there | 0 | |
| A size or footing that doesn't fit what the thing is | 0 | |
| Over its triangle budget · built twice, a different mesh | 0 · 0 | |

What it says: the knight (9,548 triangles, 2.31 m, his feet on the ground), his dog, his hearth, the animals, everything that grows, the distance and the helpers are clean on every count. The keep has 15 clashing faces (2.7 m west and 2 m south of its middle, 4 to 6 m up); the two sites have the rest: the proving ground 36 triangles of no area, 3 parts inside out (medium and high tiers) and 63 to 101 clashing faces by tier (the first at 110 m west, 63 m south, 5 to 10 m up), the workshop 179 to 266 clashing faces in its fixed kit (the first at 107 m east, 16 m north, under a metre up). The real robots' simplified meshes carry 450 clashing faces (the rover 354) and 9 triangles of no area. Two faces in exactly one place don't flicker the way two that merely overlap do (their depths are identical, so the one drawn first wins everywhere), but one of the two colours is never seen and both are paid for. The budgets are stated in `bench/models/builders.ts`: docs/WORLD.md's figure where it gives one, else what the model had when the audit was written with a tenth to spare.

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

### world-scale: the SANDBOX drawn in a real browser, at scale

`bench/browser/world-scale.ts` measures the SANDBOX where it runs. It starts a throwaway node on a temp home, opens the world in headless Edge over CDP paired as a client, loads it once per configuration (tier, backend, screen, and how much world is asked for: `?trace=1&tier=…&webgl=1&animals=N&reach=N&plants=N`) and measures each scene in windows of a few seconds. `bun bench/browser/world-scale.ts` is the quick matrix (each tier, the ends of each curve, a part's cost, his walk; about ten minutes). `--full` is every tier, backend and screen, the animals, reach and plants curves until they can't hold 15 fps, weather, his eyes, sound, helpers and experiments, and his day (62 loads, 125 scenes, an hour and a half on a shared machine). It writes `bench/out/world-scale.json` in the scorecard's shape with ids like `base.high.webgpu.desktop.wide-day.cpu.p95`, `headroom.medium.animals.frame60`, `parts.high.desktop.cost-plants.cpu` and `bundle.world.brotli`, and everything measured to `world-scale.raw.json` beside it. `bun run bench` shows it when that file is there.

What it can be trusted for: counts (objects handed to the renderer, triangles, animals alive, chunks) are exact. Main-thread times are the page's own clock inside its frame function. GPU time is WebGPU timestamp queries round every pass. The frame interval is taken with the browser's frame-rate limit off, so it is the whole pipeline. A small fixed loop runs on the page's own thread round every window, and CPU-clock times are scaled to the best that loop has done on the machine; each result carries `quiet` and the unscaled p95. Scaled times are good to about a fifth, so compare runs by counts and by the paired part costs, not by frame times a tenth apart. It drives the browser it finds: the one named by `EDGE` (or `GALAHAD_BROWSER`), else Edge or Chrome where the platform keeps them, on Windows, macOS or Linux. It needs a real GPU, so it is not for CI runners without one; the GPU process's memory is counted on Windows only. Every number in these docs was taken on Windows with Edge; on macOS one quick load with Chrome has been run end to end (WebGL2, low tier), which shows the runner works there and nothing about speed. What it writes is checked against the scorecard's contract before it is written (`bench/browser/card.ts`), so `bun run bench` can always read it. No phone is measured: "phone" is a phone's size and pixel ratio in a desktop browser.

What the first runs said (2026-11-12, an i7-11700 with an RTX A4000): the world was limited by its main thread handing three.js objects to draw (about three quarters of a frame on the high tier, at 11 to 16 µs an object a pass), with the GPU nearly idle; and the animals' curve broke in one function that compared every walker with every other. With the robots drawn as one object a kind and walkers parted by a grid, the high tier holds 60 fps to about 5,000 animals where it held about 750, and medium to about 2,800 where it held about 900. The same slice built in Babylon.js and PlayCanvas (`spikes/engines/`) gave no headroom at the phone tier's object count, so the world stays on three.js: the reasoning and the numbers are in [WORLD](WORLD.md).

## Adding a metric, or a suite

- A metric: in its suite, `ctx.quality(id, value, unit, "higher" | "lower", { note, resolution? })` for something exact, `ctx.time(id, fn, { n, warm, batch, per, note })` for something timed (or `ctx.speed(id, samples, unit, better, [from, to], note)` for samples timed elsewhere, with when they were taken). Names are lower case with dots and dashes; one only `--full` measures starts `full.`. Say in the note what the number is. Then record the baseline on purpose and commit it with the change.
- Quality must be the same every time: draw from `rng(subSeed(ctx.seed, "name"))`, never from the clock or `Math.random`; keep the machine's own sine and logarithm out of anything a threshold or a rank depends on, or state a resolution.
- A suite: a file in `bench/suites/` exporting `suite` (`name`, `about`, `headline`, `run(ctx)`), and its line in `bench/run.ts`. Keep it inside its share of the budget; put the long sizes behind `ctx.full`.
- Something measured outside (a browser, a device): write the same JSON to `bench/out/<suite>.json` and add its name to `EXTERNAL` in `bench/run.ts`.

## What isn't measured here

- Model quality and the agent harness's effect on it: the [Trials](TRIALS.md).
- The SANDBOX on a real phone: the world-scale suite emulates a phone's screen in a desktop browser, and no iPhone has been measured.
- Real networks, real Docker, real disks under load: the simulations use the real decision code and stand-in work.
- The sun and moon against a tabulated almanac (no network): an independent series stands in.
- The same quality values on another platform. They're expected to be the same (the only platform-dependent arithmetic is the last bit of a sine, a cosine or a hypotenuse, inside the stated resolutions), and the baselines were recorded on Windows.
