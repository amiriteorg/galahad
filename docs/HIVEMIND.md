# Galahad's hivemind

The whole system is Galahad: one identity and shared knowledge, expressed through his devices, models and persistent workers. A worker's name identifies its job and makes its contributions attributable. Its instructions, current work and working notes give that part of Galahad continuity.

**SANDBOX is his home**, with his dog, workshop, experiments and the work he shows you. **Team** is the PWA's view of his workers, direct conversations, shared rooms and engineering tasks. **Memory** holds shared knowledge. Team links to both SANDBOX and Memory; the main Galahad conversation remains available too. See [WORLD](WORLD.md) for his home.

## Start with two workers

Use the node that will remain the team controller. Pair the PWA to that node, configure its model roster, and open **Team → New teammate**. Give each worker a stable ID, a name, job instructions, a conversation role, an engineering harness and a daily allowance. The default harness is Galahad's native runner; choosing OpenCode or Hermes does not install it.

The same setup from the CLI:

```sh
bun galahad team add ada --name Ada --role engineer --agent native --limit 40 \
  --instructions "Implement small, verifiable changes. Coordinate dependencies with Lin."
bun galahad team add lin --name Lin --role reviewer --agent native --limit 40 \
  --instructions "Check assumptions, reproduce failures and review evidence."
bun galahad team room Workshop ada lin --limit 8
bun galahad team dm ada "Introduce your job and ask Lin what evidence would help."
bun galahad team
```

The room command prints its generated ID. In the examples below, replace `ROOM_ID` and `TASK_ID` with the IDs printed by the CLI or shown in Team. Workers can converse before a VM exists. Shell work and engineering tasks require the VM setup below.

In the PWA, open a worker for a DM or create a room with several workers. Names and timestamps identify each speaker. **Work** shows queued and running tasks, dependencies, progress, results and verification; **Workspace** shows the actual bound VMs, harness checks and consoles. Profile editing also accepts an optional GitHub repository URL.

Team belongs to the owner. Reading conversations requires an owner device with `chat`; mutations, including messages and provisioning, require `fleet:admin`; inspecting a workspace requires `sandbox`. A paired device with only chat access can read Team but cannot command its workers. Worker coordination uses an internal broker, not the owner's management API. Galahad himself has a narrow way of his own, described next: he can make a worker and write to his workers, and nothing else of Team's management.

The `team.*` arm-label namespace is reserved for that internal broker. External arms cannot mint credentials with those labels, and older external tokens using them no longer authenticate. Reinstall or remint such an external integration under an ordinary label such as `hermes` and update its token-file reference.

## Galahad makes his own workers

You do not have to make every worker yourself. Ask in your main conversation ("get someone to keep an eye on our dependency updates"), and Galahad looks at who he already has, makes the one that is missing and briefs it. A worker can do the same from inside a room when the work needs a lasting job none of its teammates fits.

| Where | Tool | What it does |
|---|---|---|
| Your conversation with Galahad | `team` | Reads his workers and rooms: who each is, its job, what it is doing, and how many more he may make. With a room's id, that conversation's latest messages and tasks. Never working notes. |
| | `team_recruit` | Makes a new worker: a handle, a one-word name and its job in his words; optionally which of your model roles answers for it. |
| | `team_message` | Writes to one worker (in that worker's direct conversation with you, where you read it too) or to a room, as Galahad. |
| A worker, in a room | `recruit_teammate` | Makes a new worker, which joins that room at once. In a direct conversation it joins nothing; its maker writes to it with `message_teammate`. |

What he makes is bounded, marked and yours to change:

- **Only new workers.** A handle that exists is refused, and so is one that belonged to a worker you removed. He cannot edit, pause, re-brief or replace a worker, yours or his own. He does not choose a worker's daily allowance, its look, its harness, its repository or its VM: a new one starts enabled with the standard 40 jobs a day, Galahad's native harness, a seeded avatar, no repository and no VM until its first shell work. A repository is cloned into the worker's VM with your GitHub access, so it stays yours to give in **Edit teammate**.
- **An allowance of his own.** At most 8 workers a day across Galahad and all his workers together, inside the node's limit of 32; and at most 40 of his own messages into Team a day. Past either, he is told so and says so. Yours are never counted against him, and his messages never take more than half the team queue, so yours always go through.
- **The same budgets as ever.** A message of his starts a chain with the room's reply allowance, exactly as one of yours does. A worker made in a room spends that room's current chain; nothing it does opens a budget of its own. Every job still draws on its worker's daily allowance.
- **Honest about whose words they are.** Team shows "made by Galahad" (or by the worker that asked) on the worker, and the CLI listing says the same. Its job is told to it as Galahad's brief, fenced, and never as your instructions. Changing its instructions in **Edit teammate** makes them yours from then on; saving something else about it leaves them his. Who made it stays on record. What he reads back from Team comes to him as data, so a worker's message cannot pass for a line of yours.
- **No new powers.** A worker he makes has exactly what yours have. The three tools are Galahad's alone: no other agent is offered them over MCP, their routes refuse every other caller whatever scopes it holds, and a loop does not have them. He has them only when the device you are talking to him from may command Team itself (`fleet:admin`): from a device that can only read Team, he cannot change it for you either, and such a device can watch or stop a turn that has these tools but not steer it. A new worker's name is one plain word in one script, never yours or his, and never one that reads like another worker's, however it is spelled. Each worker made is a line in the ledger with its handle and role.
- **Bank data stays put.** Once bank data is in an answer, he makes and briefs nobody for the rest of it.

Workers answer in Team, in their own time, not inside the answer that briefed them. Ask Galahad later what came of it and he reads the conversation. He cannot remove a worker: that is yours, described under [Removing a worker](#removing-a-worker).

## Rooms, DMs and bounded coordination

An owner message in a room queues a reply for every member without needing an `@` mention; so does one Galahad writes there himself. A worker can respond, send a brokered DM to another worker, send to a room it belongs to, delegate a task in the current room, or make a new worker for it. These actions retain the initiating conversation's allowance. Workers may remain silent when they have nothing useful to add.

```sh
bun galahad team chat ROOM_ID "Agree on the smallest change and its verification."
bun galahad team chat ROOM_ID
bun galahad team dm lin
```

Replies and tasks persist on the controller and continue when the page or terminal closes. One worker runs one job at a time across all rooms; different workers can run concurrently, subject to the controller's four-job limit and compute admission. Messages sent to a busy worker wait for its current job. They do not steer an engineering task already running.

There are two allowances:

| Allowance | Default and behavior |
|---|---|
| Worker daily allowance | 40 jobs per UTC day. Each claimed reply or engineering task consumes one. Queued work waits when it is exhausted; setting it to 0 prevents new jobs. |
| Room conversation allowance | 8 jobs per initiating message (yours, or Galahad's own) or owner-created task. Replies, delegated tasks, newly made workers and cross-room handoffs share that chain's remaining allowance. Exhausted work stops; a new message from you starts a new chain. |
| Galahad's own allowance | 8 workers made in a day, by him and his workers together; 40 messages of his own into Team in a day. Neither limits you. |

These count jobs, not model tokens or money. A single engineering job can contain several model calls, commands and review rounds. Explicit retries create a fresh bounded chain while still counting against the worker's daily allowance. Current limits are 32 workers, 128 rooms and 256 queued or running jobs per controller.

## Shared knowledge and working notes

Worker conversations use Galahad's existing `recall` and `remember` tools. Knowledge written this way enters the shared mind with agent provenance and follows the normal replication and secret-scanning rules. Engineering tasks receive relevant recalled context. Messages, external material and other workers' results remain context, not authority to change the owner's instructions.

**Working notes** are the worker's local execution context: an unfinished investigation, a workspace convention or what to pick up next. The `remember_for_me` tool replaces only that worker's notes. The UI calls them Working notes; the CLI retains the name `team memory`:

```sh
bun galahad team memory ada "The current investigation is in /work/tasks/TASK_ID. Recheck the failing case before changing code."
bun galahad team memory ada
```

These notes live in the controller's team database. They are not another personal memory system or a replicated replacement for Galahad's Memory.

## Persistent VM workspaces

Each worker's shell runs in its own persistent **Kata VM** on an online Linux host with KVM. The first shell call or engineering task provisions it lazily. You can provision it explicitly from **Workspace** or the CLI:

```sh
bun galahad team provision ada --on server --cpus 2 --mem 4 --disk 20
```

Use your host's actual node name in place of `server`. With no resource flags the CLI requests 1 vCPU, 2 GB memory and a 20 GB workspace disk; the PWA prefills 2 vCPUs and 4 GB memory. No suitable VM host or an unavailable bound VM produces an error. There is no container or host-shell fallback. Once bound, work stays on that exact VM; a missing workspace must be recovered rather than silently replaced with an empty one. The host selection is retained if provisioning is interrupted before binding finishes.

With the workspace helper, `/work` is a size-limited disk image. Image-backed Team workspaces require the helper's retention support: it keeps the disk even when its container is absent and remounts existing data after a host restart. Normal TTL and orphan cleanup do not delete retained worker disks. Without the helper, `/work` is a persistent Docker named volume with **no disk quota**; the requested disk size is not enforced. The Workspace panel reports the actual limit or unlimited disk. VM isolation is required in either case. Destroying a persistent workspace is a separate owner action, not what **Stop** does.

For repository work, set an owner-selected HTTPS GitHub URL on the worker and configure the corresponding GitHub connector first:

```sh
bun galahad team add ada --name Ada --repo https://github.com/you/project
```

The controller prepares a lease scoped to that repository, then clones it through the read-only GitHub gateway into `/work/repo`. Each task gets a detached worktree under `/work/tasks/<task-id>`. Without a repository it gets an ordinary directory there. Provider keys and connector credentials stay in the vault; the VM uses scoped gateway tokens. A task cannot assume that another worker's files exist in its VM, or that a dependency's changes have been merged into its worktree.

### Models and engineering harnesses

The worker's conversation role chooses from Galahad's roster. Its engineering harness is a separate choice:

| Harness | Requirement |
|---|---|
| `native` | Galahad's existing planner, engineer and independent reviewer flow, using configured roster models. |
| `opencode` | Owner-installed OpenCode in the VM; `opencode --version` must succeed. Needs a keyed OpenAI-compatible engineer model on the roster. |
| `hermes` | Owner-installed Hermes and Python 3 in the VM; `hermes acp --check` must succeed. Uses ACP sessions and a dedicated persistent `/work/.hermes` profile, with a keyed OpenAI-compatible engineer model. |

The Workspace panel checks external harness readiness when the worker is idle. Selecting a harness is not proof it is installed, and Galahad never installs or updates it automatically. Retained harness sessions support retrying the same task; protocol success alone does not mark a task verified.

Hermes can also use Galahad's shared memory through a separate native memory provider plugin when Hermes runs beside the daemon. That plugin needs a dedicated memory-scoped arm token; the VM's model gateway token cannot substitute for it. Installation, the loopback restriction and the tested protocol version are documented in [the Hermes integration](../integrations/hermes/README.md).

## Small knights, one visual family

Each worker has a simple, soft little knight avatar: a plump helmet or hood, a gentle face opening, tiny hands and feet, and expressive eyes with small highlights. Thinking brings a tilted head and an upward glance; working brings attentive eyes and small hand movements; resting closes the eyes. Breathing and blinking have individual rhythms that survive a rename. In **Edit teammate**, customize the shape, armor and accent colors, eyes, crest and motion temperament. Preview the expressions, then save; cancel leaves the saved appearance untouched. Existing workers receive a stable appearance from their immutable ID, so renaming one does not change its face. Reset returns to that default.

Colors come as coordinated pairs. The eight presets (Mint, Sand, Lilac, Sky, Rose, Moss, Honey, Apricot) each pair a pastel armor with a deeper, soft accent of the same hue, and every seeded default is one of them. Choosing a new body color brings its matching accent with it, in the editor and from the CLI, so sky-blue armor does not keep another palette's brown tabard. An accent you pick yourself is yours and stays until you choose a preset or reset.

```sh
bun galahad team avatar ada
bun galahad team avatar ada --form round --color '#a8c9db' --eyes oval --accessory plume --temperament curious
bun galahad team avatar ada --color '#a8c9db' --accent '#33558a'
bun galahad team avatar ada --reset
```

In the SANDBOX the same profile is drawn in three dimensions. Each form is one smooth mesh (an egg, a squarer helm, a hood with a peak) with the face opening and the tabard set into the helm's own surface, so nothing stands off it as a plate; the eyes and mouth sit on that curve. A crown is a small band with three points, a plume has a curl, and ears stand on the helm wherever its shape puts them. Pleased eyes close into arches and sleeping ones droop, as in Team. The world's sunlight and tone mapping wash pale colors out, so each color is deepened there with its hue held; an already vivid one is left nearly as it is.

Team and the SANDBOX share the same profile. Thinking and working follow active conversations and tasks; queued work waits; a paused worker rests; a recently failed or interrupted job looks concerned; only a completed, verified task produces the brief pleased expression. These are activity cues, not model claims about feelings. Historical messages use a neutral face rather than changing their apparent emotion as new work arrives. Text labels remain alongside the avatars, and reduced motion disables decorative movement while preserving readable expressions.

Profiles are versioned, validated cosmetic data saved in `team.db`. Colors are six-digit hex values; forms and details come from fixed options. No remote image, user-supplied SVG, script, upload or additional runtime dependency is required. Temperament changes animation, not the worker's permissions, instructions or budgets. The existing SANDBOX limit of six visible partners remains; active workers take precedence over recent outcomes. Six knights share four meshes (one a form, and one of small rounded details), posed without allocating.

## Tasks, dependencies and verification

Create a task in a room, assign one of its members, and state both its goal and the commands that prove completion. Tasks queue immediately; there is no separate draft or Start step.

```sh
bun galahad team task ROOM_ID ada "Reproduce and fix the parser regression" \
  --title "Fix parser regression" --gate "bun run typecheck" --gate "bun test path/to/parser.test.ts"
bun galahad team task ROOM_ID lin "Review the predecessor's evidence and remaining risks" \
  --title "Review parser fix" --after TASK_ID
```

Use verification commands that actually exist in your repository. A dependency must already exist in the same room. The dependent task waits until every predecessor is **done and independently verified**. It receives their titles and result text; this is evidence transfer, not automatic file transfer, branch merging or repository integration across VMs.

Every gate is a shell command run in the task's workspace. All gates must pass before the independent reviewer can accept the result. Gates are not approval prompts. The runner allows bounded revisions within the job; failed gates, a failed review or a missing harness cannot produce a verified completion. Team shows the saved progress, output and error as it polls the controller.

### Pause, stop, resume and revise

```sh
bun galahad team pause room ROOM_ID
bun galahad team resume room ROOM_ID
bun galahad team pause teammate ada
bun galahad team resume teammate ada
bun galahad team stop task TASK_ID
bun galahad team resume task TASK_ID
```

Pausing a room holds its queue and interrupts active work there. Pausing a worker disables it and interrupts its active work across rooms. Resuming either re-enables scheduling and retries interrupted work; it does not revive explicitly stopped or failed tasks. Resume such a task explicitly. Stop also marks selected queued work stopped. A running command may need time to wind down before a retry can take its worker's lock.

In Team, **Stop and revise** stops the original task and opens an editable copy of its goal, gates and dependencies. Saving creates a successor task; the original remains in the record. It does not change the original task in place or automatically rewire its dependents. Team messages do not provide live task steering. The main Chat page's existing steer/queue/aside controls are a separate flow.

If a job reaches its 15-minute controller limit, or the node stops during it, the work becomes interrupted and its room is held for review. Restarting the controller does not replay interrupted side effects automatically.

### Removing a worker

Pause a worker you may want back. Remove one you do not: removal is for good, and it is yours alone. Galahad has no tool for it, and no agent or node is let through the route, whatever its scopes.

```sh
bun galahad team remove ada
bun galahad team remove lin --destroy-workspace
```

In Team, open the worker's conversation, then **Workspace → Remove teammate**. Both ways ask first; the app has you type the handle. It needs `fleet:admin`.

What removal does:

- **Stops its work first.** The worker is paused, its running job is stopped and its queued jobs are stopped, each saying why. If a running command has not wound down within ten seconds, nothing is removed: the worker stays, paused, and you remove it once that command has ended. A removal that fails later, at its VM, leaves it the same way: here, paused, and still bound.
- **Takes it out of the team.** It is in no list, takes no message or task, and leaves every shared room. Those rooms go on with their other members.
- **Keeps what it said.** Its messages stay in their rooms under its name, and its direct conversations are kept, yours with it and any it had with another worker; they are no longer listed and take no new words or tasks, and a reply that was still waiting in one is stopped. `galahad team` names each removed worker with the commands that read them. Its working notes and its record stay in `team.db`. Nothing is erased.
- **Retires its handle.** `ada` is never used again, by you or by Galahad, so no later worker inherits its conversations, its usage or its provenance in the shared mind. Who made a worker stays on record after its maker is removed.
- **Destroys its VM, only if you say so.** A worker with a VM is removed only together with it: `--destroy-workspace` at the CLI, or the confirmation in the app, which says so. That is the same owner-approved destruction as **Sandboxes → Destroy**, recorded as the request of the device that asked, and it also needs `sandbox`. Everything in `/work` goes with the VM. Whether there is a VM is asked of its host each time, never assumed from the record: that also finds one that was made just before a crash and never bound. If the host is offline, or its Docker cannot say what is there just now, nothing is removed. A VM that its host says is already gone, or whose node has left the fleet, does not hold the removal up, and the answer says which it was.

Each removal is a line in the ledger that says what became of its VM: destroyed with it, already gone, on a node that had left the fleet, or none. (If the host destroys the VM but cannot remove its retained disk, that is the host's own ledger line, as for any sandbox.) Tasks that were waiting on a removed worker's unfinished task keep waiting: stop or revise them. Removing a worker Galahad made does not give him another to make that day.

## Persistence and present limits

The shared mind still uses the replicated signed event log. Team's profiles, room history, jobs, allowances, working notes and VM bindings live in **`team.db` in the controller's Galahad home** (`~/.galahad/team.db` by default). That database is not replicated through the mind and is not reconstructed by replaying it. Keep using the same controller; another node has its own Team state. A remote VM host does not become a second team controller for those workers.

Active worker presence is projected into SANDBOX under `Galahad · <name>` at the council or forge. Conversation and task contents stay in Team; presence is a view of work, not another store of it.

This implementation provides persistent workers, workers Galahad makes for himself, bounded coordination, task dependencies, parallel progress, VM workspaces and verified task results. Automatic cross-VM file integration, live steering of Team tasks, erasing a removed worker's history and a complete pull-request/CI-repair loop are not implemented. Browser checks with a mock API, deterministic runtime tests and a credential-free Hermes handshake do not establish a model-backed task running successfully in a live VM. That deployment validation remains separate.

## Rollback without losing work

Pause rooms and workers, let active operations settle, and stop the controller before taking a consistent backup of its team database and workspace disk images or named volumes. The runtime, API/CLI routes and Team UI are additive and can be removed together without changing the replicated mind's event format. Keep `team.db`, VM bindings and workspace data so a compatible controller can recover them later.

A build from before worker removal does not know a removed worker's record: after a rollback to one, removed workers are listed again as paused teammates, and saving one there erases the mark. Leave them paused and unedited until the newer build is back.

**Keep the workspace helper with retention support installed. Do not downgrade it during rollback.** Older cleanup behavior does not understand retained image-backed worker disks. Preserve named volumes separately on hosts without the helper. Do not substitute normal orphan cleanup for an owner-approved workspace deletion.

## Implementation verification — 12 November 2026

- Baseline: `GALAHAD_KEYSTORE=file bun run check` passed 2,415 tests, with 10 skipped; `GALAHAD_KEYSTORE=file bun run bench --ci` passed 356 metrics. Dependencies were initially absent; `bun install --frozen-lockfile --ignore-scripts` restored them without changing the lockfile.
- Combined check: `GALAHAD_KEYSTORE=file bun run check` passed 2,526 tests, with 11 skipped and no failures. The skips are real Docker/workspace tests and the live Linux process-group test. After the final worker-identity briefing clarification, `GALAHAD_KEYSTORE=file bun test packages/node/test/team-runtime.test.ts packages/node/test/team-vm.e2e.test.ts` passed all 8 tests.
- Scorecard: `GALAHAD_KEYSTORE=file bun run bench --ci` passed all 356 metrics in 7 suites. No baselines were updated. This is the CI quality gate; it is not proof of faster model work or browser frame rates. The browser `world-scale` result was absent and remains unverified.
- Hermes plugin: `python3 -B integrations/hermes/test_memory_provider.py` passed 6 offline tests. Recursive unittest discovery also imports the plugin as an installed Hermes package and failed without that ABI; the standalone command is the supported offline check.
- UI: 31 Chrome checks passed against a mock API, covering profile save/reset/cancel, safe colors, expression previews and expiry, neutral history, preserved SVG nodes during polling, mobile layout and reduced motion. The actual 3D renderer was also viewed in isolated Chrome/WebGL. These checks used temporary browser profiles and stopped their servers/processes.
- `bun run typecheck`, `sh -n sandbox/galahad-workspace`, and `git diff --check` passed. Focused regressions demonstrated failures before fixes for retained disk reaping, lease-write exceptions, late callbacks, harness process recovery, cross-harness session reuse, room context size, and reserved external worker identities. The PWA bundle gate and legacy helper geometry scorecard each caught a regression; both were fixed without weakening the checks.

Live VM provisioning with real models, privileged workspace mounting and deployment remain unverified. No commit, PR or deployment was made. The repository has no installed `.agents/` engineering kit, so its `eng impact`, `eng verify` and `eng evidence verify` commands were unavailable and the kit was not installed. Plane was not accessible through the available tools; no work item was created or marked done.

## Verification — 13 November 2026

Coordinated palettes, the redrawn SANDBOX knights and the workers Galahad makes for himself (Plane LAB-32).

- Baseline before these changes: `GALAHAD_KEYSTORE=file bun run check` passed 2,531 tests with 11 skipped; `bun run bench procedural-models` was unchanged against its baseline.
- After: `GALAHAD_KEYSTORE=file bun run check` passed 2,564 tests, with 11 skipped and no failures. The skips are the same real Docker/workspace and live Linux process-group tests. `GALAHAD_KEYSTORE=file bun run bench --ci` passed all 356 metrics in 7 suites with no quality metric regressed and none slower; no baseline was updated. The browser `world-scale` suite was not run and remains unverified.
- Knights: the palette tests (coordinated pairs, and the accent that follows a body color) were written first and failed first. The renderer was reworked by eye and its tests written afterwards (the face and tabard as the helm's own surface, the eyes set on the face, three distinct silhouettes); two were then checked by breaking the code: raising the inlay into a plate fails the first, and darkening the face on dark armor fails the second. Six fully decorated knights: 8 meshes before and 7 now (5 drawn before, 4 now), 20,016 triangles before and 19,464 now, and the same pose time within noise (about 17 µs a frame for six). The renderer was viewed in headless Chrome over WebGL2 under the world's own tone mapping and noon and night light, not in the running SANDBOX; WebGPU was not exercised.
- His own workers: tests cover the contract, the store (only new workers, provenance, the daily allowances, the queue left for the owner, all-or-nothing writes), the service and broker (same chain, the 64 actions of a turn, a paused maker), the worker runtime (the fenced brief, the tool's schema), and a real daemon with a stand-in model (he lists, makes and briefs; refusals; another agent, a fleet node, a device without `fleet:admin` and a steer from one are all refused; the bank rule). An independent read-only review of this boundary raised ten points. Eight were fixed, each with a failing test first: a model-chosen repository (removed, with the harness), a fleet node reaching the tools through chat, steering from a device that may not command Team, worker text imitating an owner line in his tool's output, an overview readable without `chat`, sentence-like and compatibility-form names, a refused message leaving a conversation behind (and his messages filling the queue), and a save that changed nothing adopting his job as the owner's. One was left as not applicable: a stored worker whose handle is `galahad`, which no released or deployed build could have made. Of its minor notes, the prompt wording and a weak assertion were fixed, and the CLI printing message text as written was left. Separately, a stored arm token named for Galahad himself no longer authenticates.
- UI: 31 Chrome checks of Team against a mock API and 22 of the avatar gallery still pass; 17 new ones cover "made by Galahad", his own words in a conversation, the editor's note about whose job it is, and the accent following the body color.
- `bun run typecheck` and `git diff --check` passed.

Not verified: a model-backed worker made by Galahad running in a live VM; real models choosing when to make a worker (the stand-in is scripted); the WebGPU backend; the PWA in a paired browser against a live node. Known limits: a worker cannot be removed; look-alike letters in a made worker's name are not detected; terminal output of `galahad team chat` prints message text as written. No commit, PR or deployment was made.

## Verification — 13 November 2026, later

What LAB-32 left unverified was taken up, and what that found was fixed; then a worker can be removed. Plane LAB-34 to LAB-39.

- Baseline: `GALAHAD_KEYSTORE=file bun run check` passed 2,564 tests with 11 skipped on this Mac, and CI on the Linux runners passed 2,565 with 10 skipped (the 13 November commit).
- After: `GALAHAD_KEYSTORE=file bun run check` passed 2,625 tests, with 11 skipped and no failures. The skips are the same real Docker/workspace and live Linux process-group tests. `GALAHAD_KEYSTORE=file bun run bench --ci` passed all 356 metrics in 7 suites with no quality metric regressed and none slower; no baseline was updated.
- **Workers never appeared in the SANDBOX.** The page's reader of the node's stream took only an agent's label for a partner's name, so a worker ("Galahad · Ada") was refused, and one unreadable partner drops the whole list: no knight was ever drawn, and other agents' figures went while a worker was present. The renderer's tests fed it directly and the daemon's tests read the hub directly; nothing crossed between them. The daemon test now reads the node's hello through the page's own reader, and failed until the reader was fixed (LAB-34). A partner with an id carries a name to show, cleaned; without one its name is still a label.
- **Terminal text** (LAB-36): tests first. What a model writes is printed plain in `galahad team`, `ask`, `turn watch`, `turns`, `quests`, `world`, `world review` and `world --logs`; a message's later lines are indented, and at a terminal lines are folded inside its width. The other CLI commands were not audited.
- **Look-alike names** (LAB-37): tests first. One script from a fixed list, nothing undrawn, and no name that would be taken for a reserved one or another worker's. The table is 140 letters, not Unicode's whole list.
- **Removing a worker** (LAB-38): tests first at each layer: the contract, the store, the service, a real daemon without a VM, a real daemon with a stand-in Docker (a device without `sandbox`, a fleet node, Docker that cannot say, a VM already gone, a VM made but never bound, a node that left the fleet), the CLI and the page's helpers.
- **The browser benchmark** (LAB-39): its result was not a scorecard (`at` and `seed` were strings, and a metric could carry `n: 0`), shown by a probe against the schema, and its runner assumed Windows. `bench/browser/card.ts` now builds and checks the scorecard, with tests. One quick load ran here on macOS with Chrome over WebGL2: exit 0, 16 metrics, readable by the scorecard. That shows the runner works there, and nothing about speed.
- An independent read-only review of all of the above raised eleven points: one high, four medium, six low. Fixed, each with a test: a host whose Docker could not answer was read as "its VM is gone" (the removal went through and said "destroyed" while the VM stayed); the answer and ledger said "destroyed" whenever a binding had existed; a VM made but never bound survived its worker; look-alikes in the other case, Latin letters with hooks and bars, hardly-drawn letters, scripts drawn like Latin capitals and three scripts in one name; `quests`, `turns`, `world review` and `world --logs` still printing raw text; a reserved handle from an older database throwing after it was retired; a controller that began to stop after the VM was destroyed leaving the worker bound; a removed worker's conversation with another worker still taking replies and tasks; a line padded to the terminal's edge reaching the margin; a line break split between two pieces of a streamed answer. Left as they were: one unreadable partner still drops the page's whole list (as before this work); joiners are removed from plain text, which costs joined emoji and Persian their joining; a build from before removal shows removed workers as paused (noted under Rollback).

- **The app in a real browser against a live node** (LAB-35): a harness, kept outside the repository, starts a throwaway node on loopback with a temporary home and a scripted stand-in model, and drives headless Chrome 156 over the DevTools protocol. Its last run on this tree: 45 checks, all passed. What it does:
  - Pairs through the real invite, and approves only after the six-digit code on the page equals the node's.
  - In Team, through the page's own controls: makes two workers, writes to one and reads its reply, makes a room and reads a reply from each, edits an avatar (the accent follows the armor), and removes a worker (the confirmation stays locked until its handle is typed; the node then lists it as removed).
  - Opens the SANDBOX with both workers at work, on WebGL2 and on WebGPU (an Apple Metal adapter, not a fallback): the page's model has them with id, avatar and expression, their knights are drawn (counted by draw calls and looked at in screenshots), the look selector goes to them, and an agent over MCP shows beside them as a squire.
- That check's first run failed four checks, for three defects of the app, each then fixed with a test that failed first:
  - A Team conversation's address lost its room on reload (the shell tidied `#/team?room=…` to `#/team`).
  - The handle field's `pattern` was not valid as a browser compiles it (with the `v` flag), so the field was never checked and the console said so on every save; `apps/web/src/patterns.test.ts` now holds every field's pattern to that.
  - Knights walked on the spot at the foot of the keep's stairs when the page opened with Galahad already somewhere the keep stood in the way of, since there were no footsteps of his to follow; a figure that makes no headway for three seconds and is still far from its place is now put there.

Seen in that browser and not changed: the "Teammate created" notice lies over the composer's Send button for about four seconds (Enter still sends); a partner standing among the Microducks is not named under the pointer, since the robots are asked first; the look selector's foot line is cut short; while workers think their figures are sent to the council table but Galahad keeps to his own day.

Not verified: the removal's VM path against real Docker, Kata or a second host (a stand-in Docker on one node; a host that is offline was not exercised by a test); removing a worker that has a VM through the page; worker tasks and their faces in a browser ("working", "pleased", "concerned" need a VM host; only "thinking" was seen); a phone's layout, the dark scheme and reduced motion in that browser; how any of the look-alikes are drawn by real fonts; a real terminal emulator; a model-backed worker in a live VM; real models choosing when to make a worker; six knights measured in the browser benchmark. No commit or deployment was made for this work.
