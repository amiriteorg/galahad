# Galahad's hivemind

The whole system is Galahad: one identity and shared knowledge, expressed through his devices, models and persistent squires. A squire's name identifies its job and makes its contributions attributable. Its instructions, current work and working notes give that part of Galahad continuity.

**SANDBOX is his home**, with his dog, workshop, experiments and the work he shows you. **Squires** is the PWA's view of his squires, direct conversations, shared rooms and engineering tasks. **Memory** holds shared knowledge. Squires links to both SANDBOX and Memory; the main Galahad conversation remains available too. See [WORLD](WORLD.md) for his home.

## Start with two squires

Use the node that will remain the team controller. Pair the PWA to that node, configure its model roster, and open **Squires → New squire**. Give each squire a stable ID, a name, job instructions, a conversation role, an engineering harness and a daily allowance. The default harness is Galahad's native runner; choosing OpenCode, Hermes, Claude Code or Codex does not install it or sign it in.

The same setup from the CLI:

```sh
bun galahad squires add ada --name Ada --role engineer --agent native --limit 40 \
  --instructions "Implement small, verifiable changes. Coordinate dependencies with Lin."
bun galahad squires add lin --name Lin --role reviewer --agent native --limit 40 \
  --instructions "Check assumptions, reproduce failures and review evidence."
bun galahad squires room Workshop ada lin --limit 8
bun galahad squires dm ada "Introduce your job and ask Lin what evidence would help."
bun galahad squires
```

The room command prints its generated ID. In the examples below, replace `ROOM_ID` and `TASK_ID` with the IDs printed by the CLI or shown in Squires. Squires can converse before a VM exists. Shell work and engineering tasks require the VM setup below.

In the PWA, open a squire for a DM or create a room with several squires. Names and timestamps identify each speaker. **Work** shows queued and running tasks, dependencies, progress, results and verification; **Workspace** shows the actual bound VMs, harness checks and consoles. Profile editing also accepts an optional GitHub repository URL.

Squires belongs to the owner. Reading conversations requires an owner device with `chat`; mutations, including messages and provisioning, require `fleet:admin`; inspecting a workspace requires `sandbox`. A paired device with only chat access can read Squires but cannot command its squires. Squire coordination uses an internal broker, not the owner's management API. Galahad himself has a narrow way of his own, described next: he can make a squire and write to his squires, and nothing else of Squires' management.

The `team.*` arm-label namespace is reserved for that internal broker. External arms cannot mint credentials with those labels, and older external tokens using them no longer authenticate. Reinstall or remint such an external integration under an ordinary label such as `hermes` and update its token-file reference.

## Galahad makes his own squires

You do not have to make every squire yourself. Ask in your main conversation ("get someone to keep an eye on our dependency updates"), and Galahad looks at who he already has, makes the one that is missing and briefs it. A squire can do the same from inside a room when the work needs a lasting job none of its squires fits.

| Where | Tool | What it does |
|---|---|---|
| Your conversation with Galahad | `team` | Reads his squires and rooms: who each is, its job, what it is doing, and how many more he may make. With a room's id, that conversation's latest messages and tasks. Never working notes. |
| | `team_recruit` | Makes a new squire: a handle, a one-word name and its job in his words; optionally which of your model roles answers for it. |
| | `team_message` | Writes to one squire (in that squire's direct conversation with you, where you read it too) or to a room, as Galahad. |
| A squire, in a room | `recruit_teammate` | Makes a new squire, which joins that room at once. In a direct conversation it joins nothing; its maker writes to it with `message_teammate`. |

What he makes is bounded, marked and yours to change:

- **Only new squires.** A handle that exists is refused, and so is one that belonged to a squire you removed. He cannot edit, pause, re-brief or replace a squire, yours or his own. He does not choose a squire's daily allowance, its look, its harness, its repository or its VM: a new one starts enabled with the standard 40 jobs a day, Galahad's native harness, a seeded avatar, no repository and no VM until its first shell work. A repository is cloned into the squire's VM with your GitHub access, so it stays yours to give in **Edit squire**.
- **An allowance of his own.** At most 8 squires a day across Galahad and all his squires together, inside the node's limit of 32; and at most 40 of his own messages into Squires a day. Past either, he is told so and says so. Yours are never counted against him, and his messages never take more than half the team queue, so yours always go through.
- **The same budgets as ever.** A message of his starts a chain with the room's reply allowance, exactly as one of yours does. A squire made in a room spends that room's current chain; nothing it does opens a budget of its own. Every job still draws on its squire's daily allowance.
- **Honest about whose words they are.** Squires shows "made by Galahad" (or by the squire that asked) on the squire, and the CLI listing says the same. Its job is told to it as Galahad's brief, fenced, and never as your instructions. Changing its instructions in **Edit squire** makes them yours from then on; saving something else about it leaves them his. Who made it stays on record. What he reads back from Squires comes to him as data, so a squire's message cannot pass for a line of yours.
- **No new powers.** A squire he makes has exactly what yours have. The three tools are Galahad's alone: no other agent is offered them over MCP, their routes refuse every other caller whatever scopes it holds, and a loop does not have them. He has them only when the device you are talking to him from may command Squires itself (`fleet:admin`): from a device that can only read Squires, he cannot change it for you either, and such a device can watch or stop a turn that has these tools but not steer it. A new squire's name is one plain word in one script, never yours or his, and never one that reads like another squire's, however it is spelled. Each squire made is a line in the ledger with its handle and role.
- **Bank data stays put.** Once bank data is in an answer, he makes and briefs nobody for the rest of it.

His squires answer on the Squires page, in their own time, not inside the answer that briefed them. Ask Galahad later what came of it and he reads the conversation. He cannot remove a squire: that is yours, described under [Removing a squire](#removing-a-squire).

## Rooms, DMs and bounded coordination

An owner message in a room queues a reply for every member without needing an `@` mention; so does one Galahad writes there himself. A squire can respond, send a brokered DM to another squire, send to a room it belongs to, delegate a task in the current room, or make a new squire for it. These actions retain the initiating conversation's allowance. Squires may remain silent when they have nothing useful to add.

```sh
bun galahad squires chat ROOM_ID "Agree on the smallest change and its verification."
bun galahad squires chat ROOM_ID
bun galahad squires dm lin
```

Replies and tasks persist on the controller and continue when the page or terminal closes. One squire runs one job at a time across all rooms; different squires can run concurrently, subject to the controller's four-job limit and compute admission. Messages sent to a busy squire wait for its current job. They do not steer an engineering task already running.

There are two allowances:

| Allowance | Default and behavior |
|---|---|
| Squire daily allowance | 40 jobs per UTC day. Each claimed reply or engineering task consumes one. Queued work waits when it is exhausted; setting it to 0 prevents new jobs. |
| Room conversation allowance | 8 jobs per initiating message (yours, or Galahad's own) or owner-created task. Replies, delegated tasks, newly made squires and cross-room handoffs share that chain's remaining allowance. Exhausted work stops; a new message from you starts a new chain. |
| Galahad's own allowance | 8 squires made in a day, by him and his squires together; 40 messages of his own into Squires in a day. Neither limits you. |

These count jobs, not model tokens or money. A single engineering job can contain several model calls, commands and review rounds. Explicit retries create a fresh bounded chain while still counting against the squire's daily allowance. Current limits are 32 squires, 128 rooms and 256 queued or running jobs per controller.

## Shared knowledge and working notes

Squire conversations use Galahad's existing `recall` and `remember` tools. Knowledge written this way enters the shared mind with agent provenance and follows the normal replication and secret-scanning rules. Engineering tasks receive relevant recalled context. Messages, external material and other squires' results remain context, not authority to change the owner's instructions.

**Working notes** are the squire's local execution context: an unfinished investigation, a workspace convention or what to pick up next. The `remember_for_me` tool replaces only that squire's notes. The UI calls them Working notes; the CLI retains the name `team memory`:

```sh
bun galahad squires memory ada "The current investigation is in /work/tasks/TASK_ID. Recheck the failing case before changing code."
bun galahad squires memory ada
```

These notes live in the controller's team database. They are not another personal memory system or a replicated replacement for Galahad's Memory.

## Persistent VM workspaces

Each squire's shell runs in its own persistent **Kata VM** on an online Linux host with KVM. The first shell call or engineering task provisions it lazily. You can provision it explicitly from **Workspace** or the CLI:

```sh
bun galahad squires provision ada --on server --cpus 2 --mem 4 --disk 20
```

**A squire's VM can use the internet.** That is the owner's word (13 November 2026), so a squire's VM is made `online`: it reaches the internet and Galahad's model gateway, can fetch packages, and can run a coding tool signed in to an account of its own. `--network gateway` (and the same choice in **Workspace**) makes one that reaches the model gateway and nothing else, as every squire's VM was before. The choice is made when the VM is made: a microVM's network can't be changed afterwards, so a VM made before this keeps the gateway alone until it is made again. What that means for safety: an online VM can send out whatever is kept in it (the repository it cloned, its working files, any sign-in you put there). Galahad's provider keys are not among those: they stay in the vault, and the VM holds only its scoped, revocable gateway token.

Use your host's actual node name in place of `server`. With no resource flags the CLI requests 1 vCPU, 2 GB memory and a 20 GB workspace disk; the PWA prefills 2 vCPUs and 4 GB memory. No suitable VM host or an unavailable bound VM produces an error. There is no container or host-shell fallback. Once bound, work stays on that exact VM; a missing workspace must be recovered rather than silently replaced with an empty one. The host selection is retained if provisioning is interrupted before binding finishes.

With the workspace helper, `/work` is a size-limited disk image. Image-backed Squires workspaces require the helper's retention support: it keeps the disk even when its container is absent and remounts existing data after a host restart. Normal TTL and orphan cleanup do not delete retained squire disks. Without the helper, `/work` is a persistent Docker named volume with **no disk quota**; the requested disk size is not enforced. The Workspace panel reports the actual limit or unlimited disk. VM isolation is required in either case. Destroying a persistent workspace is a separate owner action, not what **Stop** does.

For repository work, set an owner-selected HTTPS GitHub URL on the squire and configure the corresponding GitHub connector first:

```sh
bun galahad squires add ada --name Ada --repo https://github.com/you/project
```

The controller prepares a lease scoped to that repository, then clones it through the read-only GitHub gateway into `/work/repo`. Each task gets a detached worktree under `/work/tasks/<task-id>`. Without a repository it gets an ordinary directory there. Provider keys and connector credentials stay in the vault; the VM uses scoped gateway tokens. A task cannot assume that another squire's files exist in its VM, or that a dependency's changes have been merged into its worktree.

### Models and engineering harnesses

The squire's conversation role chooses from Galahad's roster. Its engineering harness is a separate choice:

| Harness | Requirement |
|---|---|
| `native` | Galahad's existing planner, engineer and independent reviewer flow, using configured roster models. |
| `opencode` | Owner-installed OpenCode in the VM; `opencode --version` must succeed. Needs a keyed OpenAI-compatible engineer model on the roster. |
| `hermes` | Owner-installed Hermes and Python 3 in the VM; `hermes acp --check` must succeed. Uses ACP sessions and a dedicated persistent `/work/.hermes` profile, with a keyed OpenAI-compatible engineer model. |
| `claude` | Owner-installed Claude Code in the VM, as Anthropic publishes it (`claude --version` must succeed), and Python 3. Runs on its own sign-in in that VM when it has one; otherwise on a keyed Anthropic-API engineer model through the gateway. |
| `codex` | Owner-installed Codex CLI in the VM, as OpenAI publishes it (`codex --version` must succeed), and Python 3. Runs on its own sign-in in that VM when it has one; otherwise on a keyed OpenAI-compatible engineer model through the gateway, on an endpoint that speaks the Responses API. |

A coding plan (GLM Coding Plan, Kimi Code and the others in [ARCHITECTURE §6](ARCHITECTURE.md)) is for exactly this: put its model on the `engineer` roster and it does the coding, whichever harness the squire has. The native runner calls it as Galahad; OpenCode or Hermes in the squire's VM runs on it through the gateway, calling as itself. The roster's next model is the fallback either way.

The Workspace panel checks external harness readiness when the squire is idle: whether the harness is installed in the VM, and what it would run on there (a vendor's tool on its own sign-in, or a roster model through the gateway), or what to do so that it can. A roster model counts only if the VM's gateway token covers its provider: a VM's token covers the providers that had a key when the VM was made. Selecting a harness is not proof it is installed or signed in, and Galahad never installs, updates or signs in one. Retained harness sessions support retrying the same task; protocol success alone does not mark a task verified.

### Claude Code and Codex: your subscription does the coding

A Claude plan or a ChatGPT plan may be used only by its vendor's own tool, unmodified, signed in by you through the vendor's own flow. So that is what these two harnesses are: the tool you installed and signed in inside the squire's VM, run headless (`claude -p --output-format stream-json`, `codex exec --json`) by a small bridge that reads what it prints. Its commands and edits are shown as they happen, and the task's gates and the independent reviewer still decide.

To try it:

1. Give the squire an online VM (the default; a VM made before 13 November 2026 reaches only the gateway and cannot sign in): `bun galahad squires provision ada`.
2. In **Workspace → Open console**, install the tool as its vendor documents, so that it is on the VM's `PATH` or in `~/.local/bin` (`/work/.local/bin`, which is kept with the workspace).
3. Still in the console, sign it in through the vendor's own flow: `claude auth login` for Claude Code; `codex login --device-auth` for Codex (OpenAI's device-code sign-in, which must be allowed in your ChatGPT security settings). Follow what the tool prints. The sign-in stays in that VM.
4. Choose the harness in **Edit squire → Coding harness**, or `bun galahad squires add ada --name Ada --agent claude` (or `codex`).
5. **Workspace → Harness readiness** then says what it would run on, for example "Runs on its own sign-in in this VM (claude.ai)".

Which credential a task uses is decided when the task starts, from what the tool says of itself in that VM (`claude auth status`, `codex login status`) and from the `engineer` roster:

| The tool in the VM | The roster | A task runs on |
|---|---|---|
| Signed in | Any | Its own sign-in first. The roster's models that speak its API are its fallbacks, through the gateway. |
| Not signed in | A keyed model that speaks its API | That model through the gateway: for Claude Code a provider of kind `anthropic` (`ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN`, the gateway's token); for Codex a provider of kind `openai` through a `model_providers` entry with `wire_api = "responses"`. |
| Not signed in | None | Nothing: the task fails at once and says what to do. |
| Not installed | Any | Nothing: Galahad never installs it. |

On its own sign-in the tool talks to its vendor itself, on the model your account gives it. Every variable that points at Galahad's gateway is taken out of its environment for that run, so the gateway never sees that traffic. When the allowance is spent (Claude Code's `rate_limit_event` with status `rejected`, or a `result` that is an error; Codex's `turn.failed` or `error`), the run ends as failed with the reason, and the reset time where the tool gives one, and the next model on the roster takes over: it continues the same session if the tool had answered in it, and starts the task afresh if it had not.

What Galahad never does:

- **He never holds a sign-in.** Nothing of his reads, copies, moves or sends the files and variables a tool keeps its sign-in in, and he puts nothing of one in the vault, the ledger, a log or an event. Whether the tool is signed in is asked of the tool, and of its answer only "signed in or not" and one word from a fixed list (`claude.ai`, `chatgpt`, `api_key` and the like) leaves the VM. A Claude sign-in pasted as a provider's key is refused, and the gateway takes only its own tokens. What the tool prints is redacted before it is shown or kept, a sign-in a model made it print included.
- **He never installs, updates or signs in the tool**, and it is the vendor's binary as published. Its own updater is the tool's affair.
- **He never passes one tool off as another.** The flags are the vendor's documented ones; no User-Agent or client identity is set or changed anywhere.
- **One sign-in, one machine.** OpenAI's documentation says not to share one Codex sign-in across machines or concurrent jobs. Each squire's VM has its own, a squire runs one job at a time, and nothing copies a sign-in between VMs: sign in once in each VM that should use the plan.

What to know before relying on it: an online VM can send out whatever is kept in it, the tool's sign-in included, and the tool runs there with every permission, so a prompt injected through a repository or a web page could have it do that. A third-party endpoint that speaks the Anthropic API may need the tool's own model variables set in the VM (they are passed through untouched). Whether unattended runs are within a plan's terms is the vendor's to say and yours to weigh: Anthropic's limits "assume ordinary, individual usage", and OpenAI recommends API keys for automation.

Hermes can also use Galahad's shared memory through a separate native memory provider plugin when Hermes runs beside the daemon. That plugin needs a dedicated memory-scoped arm token; the VM's model gateway token cannot substitute for it. Installation, the loopback restriction and the tested protocol version are documented in [the Hermes integration](../integrations/hermes/README.md).

## Small knights, one visual family

Each squire has a simple, soft little knight avatar: a plump helmet or hood, a gentle face opening, tiny hands and feet, and expressive eyes with small highlights. Thinking brings a tilted head and an upward glance; working brings attentive eyes and small hand movements; resting closes the eyes. Breathing and blinking have individual rhythms that survive a rename. In **Edit squire**, customize the shape, armor and accent colors, eyes, crest and motion temperament. Preview the expressions, then save; cancel leaves the saved appearance untouched. Existing squires receive a stable appearance from their immutable ID, so renaming one does not change its face. Reset returns to that default.

Colors come as coordinated pairs. The eight presets (Mint, Sand, Lilac, Sky, Rose, Moss, Honey, Apricot) each pair a pastel armor with a deeper, soft accent of the same hue, and every seeded default is one of them. Choosing a new body color brings its matching accent with it, in the editor and from the CLI, so sky-blue armor does not keep another palette's brown tabard. An accent you pick yourself is yours and stays until you choose a preset or reset.

```sh
bun galahad squires avatar ada
bun galahad squires avatar ada --form round --color '#a8c9db' --eyes oval --accessory plume --temperament curious
bun galahad squires avatar ada --color '#a8c9db' --accent '#33558a'
bun galahad squires avatar ada --reset
```

In the SANDBOX the same profile is drawn in three dimensions. Each form is one smooth mesh (an egg, a squarer helm, a hood with a peak) with the face opening and the tabard set into the helm's own surface, so nothing stands off it as a plate; the eyes and mouth sit on that curve. A crown is a small band with three points, a plume has a curl, and ears stand on the helm wherever its shape puts them. Pleased eyes close into arches and sleeping ones droop, as in Squires. The world's sunlight and tone mapping wash pale colors out, so each color is deepened there with its hue held; an already vivid one is left nearly as it is.

Squires and the SANDBOX share the same profile. Thinking and working follow active conversations and tasks; queued work waits; a paused squire rests; a recently failed or interrupted job looks concerned; only a completed, verified task produces the brief pleased expression. These are activity cues, not model claims about feelings. Historical messages use a neutral face rather than changing their apparent emotion as new work arrives. Text labels remain alongside the avatars, and reduced motion disables decorative movement while preserving readable expressions.

Profiles are versioned, validated cosmetic data saved in `team.db`. Colors are six-digit hex values; forms and details come from fixed options. No remote image, user-supplied SVG, script, upload or additional runtime dependency is required. Temperament changes animation, not the squire's permissions, instructions or budgets. The existing SANDBOX limit of six visible partners remains; active squires take precedence over recent outcomes. Six knights share four meshes (one a form, and one of small rounded details), posed without allocating.

## Tasks, dependencies and verification

Create a task in a room, assign one of its members, and state both its goal and the commands that prove completion. Tasks queue immediately; there is no separate draft or Start step.

```sh
bun galahad squires task ROOM_ID ada "Reproduce and fix the parser regression" \
  --title "Fix parser regression" --gate "bun run typecheck" --gate "bun test path/to/parser.test.ts"
bun galahad squires task ROOM_ID lin "Review the predecessor's evidence and remaining risks" \
  --title "Review parser fix" --after TASK_ID
```

Use verification commands that actually exist in your repository. A dependency must already exist in the same room. The dependent task waits until every predecessor is **done and independently verified**. It receives their titles and result text; this is evidence transfer, not automatic file transfer, branch merging or repository integration across VMs.

Every gate is a shell command run in the task's workspace. All gates must pass before the independent reviewer can accept the result. Gates are not approval prompts. The runner allows bounded revisions within the job; failed gates, a failed review or a missing harness cannot produce a verified completion. Squires shows the saved progress, output and error as it polls the controller.

### Pause, stop, resume and revise

```sh
bun galahad squires pause room ROOM_ID
bun galahad squires resume room ROOM_ID
bun galahad squires pause squire ada
bun galahad squires resume teammate ada
bun galahad squires stop task TASK_ID
bun galahad squires resume task TASK_ID
```

Pausing a room holds its queue and interrupts active work there. Pausing a squire disables it and interrupts its active work across rooms. Resuming either re-enables scheduling and retries interrupted work; it does not revive explicitly stopped or failed tasks. Resume such a task explicitly. Stop also marks selected queued work stopped. A running command may need time to wind down before a retry can take its squire's lock.

In Squires, **Stop and revise** stops the original task and opens an editable copy of its goal, gates and dependencies. Saving creates a successor task; the original remains in the record. It does not change the original task in place or automatically rewire its dependents. Squires messages do not provide live task steering. The main Chat page's existing steer/queue/aside controls are a separate flow.

If a job reaches its 15-minute controller limit, or the node stops during it, the work becomes interrupted and its room is held for review. Restarting the controller does not replay interrupted side effects automatically.

### Removing a squire

Pause a squire you may want back. Remove one you do not: removal is for good, and it is yours alone. Galahad has no tool for it, and no agent or node is let through the route, whatever its scopes.

```sh
bun galahad squires remove ada
bun galahad squires remove lin --destroy-workspace
```

In Squires, open the squire's conversation, then **Workspace → Remove squire**. Both ways ask first; the app has you type the handle. It needs `fleet:admin`.

What removal does:

- **Stops its work first.** The squire is paused, its running job is stopped and its queued jobs are stopped, each saying why. If a running command has not wound down within ten seconds, nothing is removed: the squire stays, paused, and you remove it once that command has ended. A removal that fails later, at its VM, leaves it the same way: here, paused, and still bound.
- **Takes it out of the team.** It is in no list, takes no message or task, and leaves every shared room. Those rooms go on with their other members.
- **Keeps what it said.** Its messages stay in their rooms under its name, and its direct conversations are kept, yours with it and any it had with another squire; they are no longer listed and take no new words or tasks, and a reply that was still waiting in one is stopped. `galahad squires` names each removed squire with the commands that read them. Its working notes and its record stay in `team.db`. Nothing is erased.
- **Retires its handle.** `ada` is never used again, by you or by Galahad, so no later squire inherits its conversations, its usage or its provenance in the shared mind. Who made a squire stays on record after its maker is removed.
- **Destroys its VM, only if you say so.** A squire with a VM is removed only together with it: `--destroy-workspace` at the CLI, or the confirmation in the app, which says so. That is the same owner-approved destruction as **Sandboxes → Destroy**, recorded as the request of the device that asked, and it also needs `sandbox`. Everything in `/work` goes with the VM. Whether there is a VM is asked of its host each time, never assumed from the record: that also finds one that was made just before a crash and never bound. If the host is offline, or its Docker cannot say what is there just now, nothing is removed. A VM that its host says is already gone, or whose node has left the fleet, does not hold the removal up, and the answer says which it was.

Each removal is a line in the ledger that says what became of its VM: destroyed with it, already gone, on a node that had left the fleet, or none. (If the host destroys the VM but cannot remove its retained disk, that is the host's own ledger line, as for any sandbox.) Tasks that were waiting on a removed squire's unfinished task keep waiting: stop or revise them. Removing a squire Galahad made does not give him another to make that day.

## Persistence and present limits

The shared mind still uses the replicated signed event log. The squires' profiles, room history, jobs, allowances, working notes and VM bindings live in **`team.db` in the controller's Galahad home** (`~/.galahad/team.db` by default). That database is not replicated through the mind and is not reconstructed by replaying it. Keep using the same controller; another node has its own Squires state. A remote VM host does not become a second team controller for those squires.

Active squire presence is projected into SANDBOX under `Galahad · <name>` at the council or forge. Conversation and task contents stay in Squires; presence is a view of work, not another store of it.

This implementation provides persistent squires, squires Galahad makes for himself, bounded coordination, task dependencies, parallel progress, VM workspaces and verified task results. Automatic cross-VM file integration, live steering of Squires tasks, erasing a removed squire's history and a complete pull-request/CI-repair loop are not implemented. Browser checks with a mock API, deterministic runtime tests and a credential-free Hermes handshake do not establish a model-backed task running successfully in a live VM. That deployment validation remains separate.

## Rollback without losing work

Pause rooms and squires, let active operations settle, and stop the controller before taking a consistent backup of its team database and workspace disk images or named volumes. The runtime, API/CLI routes and Squires UI are additive and can be removed together without changing the replicated mind's event format. Keep `team.db`, VM bindings and workspace data so a compatible controller can recover them later.

A build from before squire removal does not know a removed squire's record: after a rollback to one, removed squires are listed again as paused squires, and saving one there erases the mark. Leave them paused and unedited until the newer build is back.

**Keep the workspace helper with retention support installed. Do not downgrade it during rollback.** Older cleanup behavior does not understand retained image-backed squire disks. Preserve named volumes separately on hosts without the helper. Do not substitute normal orphan cleanup for an owner-approved workspace deletion.

(The records below were written when the Squires page was called Team and his squires were called workers or teammates; they are left as they were written.)

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

## Verification — 13 and 14 November 2026

Coding plans and subscription sign-ins are told apart from API keys; the page is called Squires; a squire's VM can use the internet; Claude Code and Codex are harnesses. Plane LAB-43 (not updated: Plane is not reachable from the session that did this).

- Baseline: the pushed tree (CI green on `8b42d08`), `bun run check` 2,625 pass, 11 skip. After: `GALAHAD_KEYSTORE=file bun run check` passed 2,699 tests with 11 skipped and none failed; `bun run bench --ci` passed all 356 metrics in 7 suites with no quality metric regressed; no baseline was updated.
- **Coding plans and sign-ins**: tests first in `packages/brain/test/plans.test.ts` (what each preset says of itself; a quest's or a squire's work goes to a plan under his own name and no other tool's; outside coding he never answers with one, alone on a role, held to by name or as `provider/*`; nothing else he does is handed a plan's key; the gateway forwards a tool's own User-Agent; a sign-in is no provider's key), `packages/node/test/key-cli.test.ts` (`galahad key add` against a stand-in node), `packages/node/test/doctor.test.ts` (a plan on a role), `packages/node/test/e2e.test.ts` (a real daemon refuses a sign-in sealed as a provider's key, lists a plan's models without calling it, and answers a quest's call from a plan as Galahad but never his talk), `packages/core/test/secret-scan.test.ts` and `apps/web/src/lib/lib.test.ts`. What the plans' terms say was read on the vendors' own pages on 13 November; Zhipu's mainland pages and Alibaba's international ones could not be reached.
- **The owner's rulings**, each built test first: the page is called Squires and his workers squires, in the app, the terminal (`galahad squires`, with `team` kept), what he and they are told, and every message (the `#/team` address, the API's paths and `team.db` are unchanged); a squire's VM can use the internet, so it is made `online` unless `gateway` is asked for (`packages/node/test/team-vm.e2e.test.ts`, against a stand-in Docker); and Galahad and his squires are themselves a coding tool, so a plan does their own coding as well as their coding tools'.
- **Claude Code and Codex as harnesses** (`packages/brain/src/vendor-cli.ts`, `packages/brain/test/vendor-cli.test.ts`, `packages/node/test/team-runtime.test.ts`): against stand-in executables replaying one scrubbed recording of each real tool (Claude Code 2.1.311, Codex 0.167.2): a normal run, a resumed run, a tool call paired with its result, a very long line, a spent allowance, a tool that is not signed in, a tool that is missing; a run on its own sign-in has every gateway variable removed; no shipped source names a sign-in's file or variable.

Not verified: no call was made with a real plan key, so his own coding on a plan, OpenCode or Hermes running on one in a squire's VM, a plan's spent-window error and the fallback after it, and whether a vendor accepts Galahad's own User-Agent (or OpenCode's through the gateway) are all untried. An online squire's VM was made only against a stand-in Docker. Neither Claude Code nor Codex has run in a real squire's VM, been signed in inside one, or met a really spent allowance. The renamed page, the Vault's and the Models page's new lines, the VM form's network choice and the two new harness choices were not looked at in a browser, and the live check kept outside the repository still looks for the old labels.
