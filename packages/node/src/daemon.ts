import { Database } from "bun:sqlite";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonical, type NodeIdentity } from "@galahad/core";
import { GatewayTokens, pinLegacyKeys } from "@galahad/brain";
import { PairingHost, SyncEngine } from "@galahad/link";
import { adoptChains, MindStore, Vault } from "@galahad/mind";
import { type DockerRunner, type LedgerEntryInput, microVMsAvailable, NETWORKS, SANDBOX_GATEWAY_PORT, vmResolvConf, WorkspaceHelper } from "@galahad/sandbox";
import type { HostLoad } from "@galahad/core";
import { calibrate, spawnBench } from "./compute/calibrate.ts";
import { GovernedSandboxHost } from "./compute/governed-host.ts";
import { Governor } from "./compute/governor.ts";
import { modelSpeed, sandboxStart } from "./compute/measure.ts";
import { ComputeService, liveHost, type Measure } from "./compute/service.ts";
import { ArmTokens } from "./arms.ts";
import { ArtifactStore } from "./artifacts.ts";
import { artifactsAdapter, boardsAdapter, chatsAdapter, experimentsAdapter, investigationsAdapter, memoriesAdapter, trialsAdapter } from "./archive/adapters.ts";
import { boardSource, experimentSource } from "./archive/external.ts";
import { LocalDiskBackend } from "./archive/blobs.ts";
import { ArchiveService } from "./archive/service.ts";
import { ArchiveStore } from "./archive/store.ts";
import { BankService } from "./bank/service.ts";
import { BoardStore, writeOnBoard } from "./board.ts";
import { writeUpExaminations } from "./board-examination.ts";
import { ChatStore } from "./chats.ts";
import { type HubLimits, TurnHub } from "./turns.ts";
import { QuestBoard } from "./quests.ts";
import { WorldHub } from "./world-hub.ts";
import { ExperimentStore } from "./experiment-store.ts";
import { buildAssets } from "./assets.ts";
import { type Capabilities, isAlwaysOn, presence, probeCapabilities } from "./capabilities.ts";
import { ConnectorService } from "./connectors.ts";
import { loopNotice } from "./heartbeat.ts";
import { heartbeatView } from "./heartbeat-world.ts";
import { companionOf } from "./journal.ts";
import { computeUpkeep, type LoopTaskDeps, lookAround, loopExecutor } from "./loop-tasks.ts";
import { LoopRunner, loopRecords } from "./loops.ts";
import { loadEnv } from "./env.ts";
import type { Home } from "./home.ts";
import { createApp } from "./server.ts";
import { shipNative } from "./ship.ts";
import { WeatherService } from "./weather.ts";
import { Eyes, EyesStore } from "./eyes.ts";
import { type DoctorDeps, type DoctorOptions, type DoctorRun, type DoctorSystem, heartbeatFromDoctor, noSystem, realSystem, runDoctor, TroubleLog } from "./doctor-facts.ts";
import { ReviewState, worldReviewer } from "./world-review.ts";

export interface Daemon {
  port: number;
  endpoint: string;
  identity: NodeIdentity;
  store: MindStore;
  sync: SyncEngine;
  loops: LoopRunner;
  connectors: ConnectorService;
  artifacts: ArtifactStore;
  bank: BankService;
  /** The SANDBOX: what Galahad is doing, and the experiments on their plots. */
  world: WorldHub;
  /** The chalkboard you and Galahad share (writeOnBoard in board.ts writes on it from the node). */
  board: BoardStore;
  /** The archive: everything kept for good, and searched by words and meaning. */
  archive: ArchiveService;
  /** Compute: the census, this node's calibration and slots, the plan, effort. */
  compute: ComputeService;
  /** The chat turns this node runs for you, and what you queued behind your chats. */
  turns: TurnHub;
  /** The doctor: one look at this node's whole installation (doctor.ts). */
  doctor(opts?: DoctorOptions): Promise<DoctorRun>;
  stop(): Promise<void>;
}

export interface DaemonOptions {
  log?: (message: string) => void;
  syncIntervalMs?: number;
  /** Loopback port that `tailscale serve` proxies to (default: port + 1). */
  proxyPort?: number;
  /** Skip the (slow) hardware probe; used by tests. */
  capabilities?: Capabilities;
  /** How often the loop runner wakes (default 15 s). */
  loopIntervalMs?: number;
  /** Let the fleet's founding node create the default loops, the heartbeat and his journal (default true; GALAHAD_HEARTBEAT=off disables). */
  defaultHeartbeat?: boolean;
  /** Outbound fetch for connectors (tests). */
  fetch?: typeof fetch;
  /** Fetch Denmark's weather for the SANDBOX while someone watches it (default off; `galahad serve` turns it on unless GALAHAD_WEATHER=off). */
  weather?: boolean;
  /** How often the archive's background work runs (default 20 s); false: never by itself (tests drive it). */
  archiveIntervalMs?: number | false;
  /** A stand-in for Docker (tests): the sandbox host runs its commands through it instead of spawning any. */
  docker?: DockerRunner;
  /**
   * How this node measures itself. Default: the real benchmark, a few seconds at low priority (and never in
   * tests that pass their own capabilities, unless they give one here). false: it doesn't.
   */
  measure?: Measure | false;
  /** The machine's live load, for admitting sandboxes (default: the real one; null with test capabilities, where only the ceiling counts). */
  hostLoad?: () => Omit<HostLoad, "oursRecently"> | null;
  /** The longest a sandbox waits for a slot (default 30 minutes). */
  slotWaitMs?: number;
  /** The node's limits on chat turns (default: 4 at once, 30 minutes each, 20 queued a chat; GALAHAD_TURNS_MAX and GALAHAD_TURN_MINUTES set the first two). */
  turnLimits?: Partial<HubLimits>;
  /** How long requests and turns under way get to finish when the node stops (default 10 s; tests pass less). */
  shutdownGraceMs?: number;
  /**
   * What the doctor asks of the machine itself (file modes, systemd, Tailscale, the disk, peers' clocks). Default: the
   * real machine; with test capabilities, nothing is asked unless a stand-in is given here.
   */
  system?: DoctorSystem;
}

/**
 * The fleet's founder gives Galahad a heartbeat once: every 30 minutes on an
 * always-on node. Never again after that, so a heartbeat you removed stays removed.
 */
function ensureHeartbeat(store: MindStore, identity: NodeIdentity, caps: Capabilities): void {
  if (store.genesis?.device !== identity.id || store.lww("loop:heartbeat")) return;
  const server = isAlwaysOn(caps)
    ? undefined
    : store.devices().find((d) => d.kind === "node" && d.role === "full" && isAlwaysOn(d.profile?.caps as Partial<Capabilities> | undefined));
  store.emit(identity, "loop.set", {
    name: "heartbeat",
    schedule: "every 30m",
    tz: "UTC",
    on: server?.id ?? identity.id,
    enabled: true,
    task: { kind: "heartbeat" },
    label: "Galahad's regular look around",
  });
}

/**
 * And his journal, once, the same way: every evening in Denmark (21:30, as he sits down to it in the SANDBOX), on
 * the node that runs the heartbeat (an always-on one). Never again after that, so a journal you removed stays
 * removed. The loop and its task are still named `reflect`: it was his daily reflection first, and fleets that
 * have that loop keep it as it is.
 */
export function ensureReflection(store: MindStore, identity: NodeIdentity): void {
  if (store.genesis?.device !== identity.id || store.lww("loop:reflect")) return;
  const beat = loopRecords(store).find((l) => l.name === "heartbeat");
  store.emit(identity, "loop.set", {
    name: "reflect",
    schedule: "30 21 * * *",
    tz: "Europe/Copenhagen",
    on: beat?.on ?? identity.id,
    enabled: true,
    task: { kind: "reflect" },
    label: "Galahad's journal",
  });
}

/** No request may make a node buffer more than this (Bun's default is about 128 MB). */
const MAX_REQUEST_BODY = 8 * 1024 * 1024;
/** How long a stopping node lets requests under way finish (a chat being answered) before it closes them. */
const SHUTDOWN_GRACE_MS = 10_000;

/** Publish this node's endpoint + capabilities, only when they changed (idempotent). */
function publishProfile(store: MindStore, identity: NodeIdentity, endpoint: string, caps: Capabilities): void {
  const body = { endpoint, caps: caps as unknown as Record<string, unknown> };
  const current = store.device(identity.id)?.profile;
  if (current && canonical(current) === canonical(body)) return;
  store.emit(identity, "node.profile", body);
}

/**
 * One look at this node's own body: probe, then publish. It runs on a timer, and Bun ends
 * the process on an unhandled rejection, so a failure here is a line in the log (the last
 * capabilities stand), never the end of the node. Returns what the probe found, or null.
 */
export async function refreshCapabilities(
  probe: () => Promise<Capabilities>,
  publish: (caps: Capabilities) => void,
  log: (message: string) => void,
): Promise<Capabilities | null> {
  let fresh: Capabilities;
  try {
    fresh = await probe();
  } catch (error) {
    log(`capabilities not refreshed: ${(error as Error).message}`);
    return null;
  }
  try {
    publish(fresh);
  } catch (error) {
    log(`profile not published: ${(error as Error).message}`);
  }
  return fresh;
}

export async function startDaemon(home: Home, opts: DaemonOptions = {}): Promise<Daemon> {
  // The doctor reads the lines of this log that read like trouble (in memory, redacted when kept).
  const trouble = new TroubleLog();
  const say = opts.log ?? ((message: string) => console.log(`[galahad] ${message}`));
  const log = (message: string): void => {
    trouble.note(message);
    say(message);
  };
  const env = loadEnv();
  const config = home.readConfig();
  if (!config.fleet) throw new Error("this node has not joined a fleet");
  const identity = await home.loadIdentity(config.keystore);
  const store = new MindStore(home.mindPath);
  store.expectFleet(config.fleet);
  if (!store.activeDevice(identity.id)) throw new Error("this node is not an active member of its fleet (revoked?)");
  const vault = new Vault(store, identity);
  const local = new Database(home.localPath, { create: true, strict: true });
  local.exec("PRAGMA journal_mode = WAL");
  const tokens = new GatewayTokens(local);
  const arms = new ArmTokens(local);

  const port = env.GALAHAD_PORT ?? config.port;
  let caps = opts.capabilities ?? (await probeCapabilities());
  const advertise = env.GALAHAD_ADVERTISE ?? config.advertise ?? caps.tailscale?.ip ?? "127.0.0.1";
  const endpoint = `http://${advertise}:${port}`;

  const sync = new SyncEngine(store, identity, { intervalMs: opts.syncIntervalMs, log });
  const stopPush = store.onEmit((event) => sync.push([event]));
  const pairing = new PairingHost(store, identity, endpoint);

  // A legacy fleet's founder adopts hash chains once (no-op everywhere else).
  try {
    const adopted = adoptChains(store, identity);
    if (adopted !== null) log(`adopted hash chains; ${adopted} legacy event(s) grandfathered, no others ever`);
  } catch (error) {
    log(`chain adoption failed: ${(error as Error).message}`);
  }

  // Keys entered before origin pinning get pinned to where their provider points today.
  try {
    const pinned = pinLegacyKeys(store, vault);
    if (pinned.length) log(`pinned ${pinned.length} key(s) to their provider's origin: ${pinned.join(", ")}`);
  } catch (error) {
    log(`key pinning skipped: ${(error as Error).message}`);
  }

  // Node-local: which gateway token belongs to which sandbox (never trusted from container labels).
  local.exec("CREATE TABLE IF NOT EXISTS sandbox_tokens (id TEXT PRIMARY KEY, hash TEXT NOT NULL)");
  const sandboxTokens = {
    put: (id: string, hash: string) => void local.query("INSERT OR REPLACE INTO sandbox_tokens (id, hash) VALUES (?, ?)").run(id, hash),
    take: (id: string) => {
      const row = local.query<{ hash: string }, [string]>("SELECT hash FROM sandbox_tokens WHERE id = ?").get(id);
      local.query("DELETE FROM sandbox_tokens WHERE id = ?").run(id);
      return row?.hash ?? null;
    },
  };

  // Every gated action lands in the signed, replicated ledger.
  const ledger = (entry: LedgerEntryInput) => {
    const body = Object.fromEntries(Object.entries(entry).filter(([, v]) => v !== undefined)) as LedgerEntryInput;
    try {
      store.emit(identity, "ledger.recorded", body);
    } catch (error) {
      log(`ledger write failed: ${(error as Error).message}`);
    }
  };

  // Compute: this node's slots. Every sandbox it creates and every background model call takes one, and waits when
  // there's none; the ceiling is the owner's (or the default half), read from the mind as it is each time.
  let computeService: ComputeService | null = null;
  const governor = new Governor({
    capacity: () => computeService!.selfCapacity(),
    host: opts.hostLoad ?? (opts.capabilities ? () => null : liveHost),
    ...(opts.slotWaitMs ? { maxWaitMs: opts.slotWaitMs } : {}),
    onChange: () => computeService?.changed(),
  });

  // Sandbox host: only when Docker is reachable on this machine.
  let sandbox: GovernedSandboxHost | null = null;
  const sandboxContext = resolve(dirname(fileURLToPath(import.meta.url)), "../../../sandbox");
  if (caps.sandbox !== undefined && caps.sandbox !== null) {
    // Online microVMs can't use Docker's DNS (it lives on the host side): they get the host's resolvers.
    const resolvConf = join(home.dir, "sandbox-resolv.conf");
    const readIf = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : null);
    writeFileSync(resolvConf, vmResolvConf(readIf("/run/systemd/resolve/resolv.conf"), readIf("/etc/resolv.conf")), { mode: 0o644 });
    const microVMs = caps.sandbox.vm ?? microVMsAvailable();
    sandbox = new GovernedSandboxHost(
      {
      node: identity.id,
      tokens,
      tokenStore: sandboxTokens,
      ledger,
      ...(opts.docker ? { runner: opts.docker } : {}),
      maxCpus: caps.cores,
      maxMemoryGb: Math.max(1, Math.floor(caps.memoryGb * 0.75)),
      // Size-limited workspaces when the root helper is installed (scripts/remote-setup.sh); otherwise
      // unlimited Docker volumes, and the heartbeat says so.
      workspaces: new WorkspaceHelper(env.GALAHAD_WORKSPACE_SOCKET),
      imageContext: sandboxContext,
      // Online sandboxes run in KVM microVMs where Kata is installed (scripts/remote-setup.sh).
      microVMs,
      resolvConf,
      },
      { governor, capacity: () => computeService!.selfCapacity(), microVMs },
    );
    try {
      await sandbox.ensureNetworks();
      // Sandboxes from before this start hold their slots before anything new is admitted.
      await sandbox.reconcile();
      // Keep the image in use, so pruning (Coolify's nightly cleanup) doesn't take it.
      void sandbox.keepImages().catch((error) => log(`sandbox image keepers: ${(error as Error).message}`));
    } catch (error) {
      log(`sandbox networks unavailable: ${(error as Error).message}`);
      sandbox = null;
    }
  }

  const startedAt = Date.now();
  // How this node measures itself: the benchmark in its own low-priority process, a sandbox's start-up through
  // its own governed host, a local model's speed through the roster's local runtimes. Nothing leaves the machine.
  const measuring = sandbox;
  const measure: Measure | null =
    opts.measure === false
      ? null
      : (opts.measure ??
        (opts.capabilities
          ? null
          : (reason, body, limit) =>
              calibrate(reason, {
                body,
                limit,
                dir: home.dir,
                load: () => liveHost().load,
                now: Date.now,
                bench: spawnBench,
                ...(measuring ? { sandboxStart: () => sandboxStart(measuring, governor, () => computeService!.selfCapacity(), !!caps.sandbox?.vm) } : {}),
                modelSpeed: () => modelSpeed({ store, vault, ...(opts.fetch ? { fetch: opts.fetch } : {}) }, caps, (o, signal) => governor.enterModel(o, signal)),
              })));
  const compute = new ComputeService({ store, identity, nodeName: config.name, caps: () => caps, peers: () => sync.status(), governor, ledger, log, measure });
  computeService = compute;
  const artifacts = new ArtifactStore({ store, identity, dir: join(home.dir, "artifacts"), ledger });
  const bank = new BankService({ dir: join(home.dir, "bank") });
  const chats = new ChatStore(join(home.dir, "chats.db"));
  // Your chat turns run here to their end, whoever is listening; what you queue behind a chat waits in chats.db.
  const turns = new TurnHub({
    chats,
    log,
    limits: {
      ...(env.GALAHAD_TURNS_MAX ? { maxTurns: env.GALAHAD_TURNS_MAX } : {}),
      ...(env.GALAHAD_TURN_MINUTES ? { maxMinutes: env.GALAHAD_TURN_MINUTES } : {}),
      ...opts.turnLimits,
    },
  });
  // Every experiment the world shows is saved here, node-local (its view, readouts, recording, code).
  const experiments = new ExperimentStore({ dir: home.experimentsDir, log });
  const world = new WorldHub({ store: experiments });
  const weather = new WeatherService({
    enabled: opts.weather ?? false,
    wanted: () => world.watching > 0,
    onChange: () => world.weatherChanged(),
    log,
  });
  world.setWeather(
    () => weather.current(),
    () => void weather.refresh(),
  );
  const board = new BoardStore({ dir: join(home.dir, "boards"), log, onChange: (change) => world.boardChanged(change) });
  world.setBoard(() => board.version);
  // His eyes (eyes.ts): the last few frames a page rendered, node-local in the home, never the mind's log.
  const eyes = new Eyes({ store: new EyesStore({ dir: join(home.dir, "eyes"), log }), world, weather: () => weather.current(), dog: () => companionOf(store)?.name ?? null });
  const reviewState = new ReviewState(join(home.dir, "eyes"));
  // An experiment's examination, written up on the chalkboard at the observatory where it's examined: each in place
  // of the last write-up (the board's history keeps every one), so the board doesn't fill with them.
  world.onExamine(
    writeUpExaminations(
      (input) => writeOnBoard({ board, world }, input),
      () => board.view().items,
      log,
    ),
  );
  // ---- The archive: node-local, its own database and blob store in the home, never the mind's log.
  const archiveStore = new ArchiveStore(join(home.dir, "archive.db"), new LocalDiskBackend(env.GALAHAD_ARCHIVE_DIR ?? join(home.dir, "archive")));
  const archive = new ArchiveService({
    store: archiveStore,
    brain: { store, vault, ...(opts.fetch ? { fetch: opts.fetch } : {}) },
    mind: store,
    identity,
    nodeName: config.name,
    log,
    ...(opts.archiveIntervalMs ? { intervalMs: opts.archiveIntervalMs } : {}),
    adapters: [
      memoriesAdapter(store),
      investigationsAdapter(store),
      trialsAdapter(store),
      artifactsAdapter(artifacts),
      chatsAdapter(chats, { has: (s, id) => archiveStore.has(s, id), sourceIds: (s, prefix) => archiveStore.sourceIds(s, prefix) }),
      // Every finished experiment (its recording streamed from disk), and the chalkboard's versions (a run of
      // strokes as one; each as trusted as the least trusted hand on it): archive/external.ts.
      experimentsAdapter(experimentSource(experiments)),
      boardsAdapter(boardSource(board)),
    ],
  });
  if (env.GALAHAD_ARCHIVE !== "off" && opts.archiveIntervalMs !== false) archive.start();

  // Checked at start (and before every bank call): a key or session readable by others keeps bank access off.
  if (bank.status().configured && bank.problem()) log(`bank access is off: ${bank.problem()}`);
  const connectors = new ConnectorService({ store, vault, identity, local, ledger, log, fetch: opts.fetch, natives: { "github.ship": shipNative(artifacts) } });
  const taskDeps: LoopTaskDeps = {
    bank,
    store,
    vault,
    identity,
    nodeName: config.name,
    sync,
    caps: () => caps,
    sandbox,
    connectors,
    arms,
    port,
    home: home.dir,
    startedAt,
    log,
    fetch: opts.fetch,
    compute,
  };
  // This node's own upkeep of its compute, one look at a time: it measures itself when that's due.
  let upkeeping: Promise<unknown> | null = null;
  let lookAgain = false;
  let stopping = false;
  const upkeep = (): void => {
    if (stopping) return;
    if (upkeeping) {
      // Something changed while he was looking: one more look when this one ends.
      lookAgain = true;
      return;
    }
    upkeeping = computeUpkeep(taskDeps)
      .then((done) => {
        for (const fix of done) log(`compute: ${fix.title}`);
      })
      .catch((error) => log(`compute upkeep: ${(error as Error).message}`))
      .finally(() => {
        upkeeping = null;
        if (lookAgain) {
          lookAgain = false;
          upkeep();
        }
      });
  };
  const loops = new LoopRunner({
    store,
    identity,
    local,
    log,
    execute: loopExecutor(taskDeps),
    onFinished: (loop, result) => {
      if (loop.task.kind !== "heartbeat") loopNotice(store, identity, loop.name, result.status, result.summary, Date.now());
      // His heartbeat in the world: it beat, and what still needs you.
      if (loop.task.kind === "heartbeat" || loop.task.kind === "reflect") world.heartbeatChanged();
    },
  });
  // Self-action's hands, and what his journal reads.
  taskDeps.runLoop = (name) => void loops.runNow(name);
  taskDeps.isRunning = (name) => loops.isRunning(name);
  taskDeps.weather = { enabled: opts.weather ?? false, watched: () => world.watching > 0, known: () => weather.current() !== null, refresh: () => weather.refresh() };
  taskDeps.chats = chats;
  taskDeps.experiments = experiments;
  taskDeps.board = board;
  // His review of his own world (world-review.ts): the owner's to start, or a loop's the owner set up.
  const reviewWorld = worldReviewer({ store, vault, identity, eyes, state: reviewState, noteIdea: (input) => archive.noteIdea(input, { trust: "agent", who: "arm:galahad" }), ...(opts.fetch ? { fetch: opts.fetch } : {}) });
  taskDeps.review = reviewWorld;
  world.setHeartbeat(() => heartbeatView(store));
  // His dog's name, from the mind: every node's world shows the same one.
  world.setCompanion(() => companionOf(store));
  // The world shows each node's slots and his helpers at work.
  world.setCompute(() => compute.worldView());
  compute.onChange(() => world.computeChanged());
  // The quests in hand, on his slate at the council table (world-quest.ts): the world hears of every report.
  const quests = new QuestBoard();
  world.setQuests(() => quests.world());
  quests.onChange(() => world.questsChanged());

  // Bundled once: the app this node serves, and what the doctor checks is there.
  const assets = await buildAssets();
  const proxyPort = opts.proxyPort ?? env.GALAHAD_PROXY_PORT ?? port + 1;
  const doctorDeps: DoctorDeps = {
    store,
    vault,
    identity,
    nodeName: config.name,
    home,
    keystore: config.keystore,
    sync,
    caps: () => caps,
    sandbox,
    governor,
    compute,
    archive,
    archiveOff: env.GALAHAD_ARCHIVE === "off",
    assets,
    port,
    proxyPort,
    startedAt,
    trouble,
    system: opts.system ?? (opts.capabilities ? noSystem : realSystem),
    ...(env.GALAHAD_BACKUP_DIR ? { backupDir: env.GALAHAD_BACKUP_DIR } : {}),
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  };
  // The heartbeat takes from a quick look what it doesn't check itself (a clock out of step, the app not published, …).
  taskDeps.doctor = () => heartbeatFromDoctor(doctorDeps);

  const shutdown = new AbortController();
  const app = createApp({
    identity,
    nodeName: config.name,
    port,
    store,
    vault,
    pairing,
    sync,
    tokens,
    arms,
    adminToken: home.adminToken(),
    assets,
    doctor: (options) => runDoctor(doctorDeps, options),
    caps: () => caps,
    // What this node's own work holds goes with its presence, so every node's census and placement know it.
    presence: async () => ({ ...(await presence()), compute: compute.usage() }),
    log,
    sandbox,
    governor,
    compute,
    computeUpkeep: upkeep,
    sandboxContext,
    connectors,
    artifacts,
    loops,
    heartbeatCheck: () => lookAround(taskDeps),
    bank,
    chats,
    turns,
    quests,
    world,
    board,
    eyes,
    review: { run: reviewWorld, state: reviewState },
    archive,
    ledger,
    shutdown: shutdown.signal,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });

  // Loopback: the CLI and the local model gateway (local processes only).
  // Proxied: what `tailscale serve` forwards to (the HTTPS PWA) — remote traffic, so no
  //   admin token and no gateway, even though it arrives from 127.0.0.1.
  // Tailnet: node-to-node link traffic. Never 0.0.0.0.
  const servers = [
    Bun.serve({ hostname: "127.0.0.1", port, idleTimeout: 255, maxRequestBodySize: MAX_REQUEST_BODY, fetch: (req) => app(req, "loopback") }),
    Bun.serve({ hostname: "127.0.0.1", port: proxyPort, idleTimeout: 255, maxRequestBodySize: MAX_REQUEST_BODY, fetch: (req) => app(req, "proxied") }),
  ];
  if (advertise !== "127.0.0.1") {
    servers.push(Bun.serve({ hostname: advertise, port, idleTimeout: 255, maxRequestBodySize: MAX_REQUEST_BODY, fetch: (req) => app(req, "tailnet") }));
  }
  // Sandboxes reach this listener (and only this one) on the gateway network's bridge IP.
  let reaper: ReturnType<typeof setInterval> | null = null;
  if (sandbox) {
    try {
      servers.push(
        Bun.serve({ hostname: NETWORKS.gateway.gateway, port: SANDBOX_GATEWAY_PORT, idleTimeout: 255, maxRequestBodySize: MAX_REQUEST_BODY, fetch: (req) => app(req, "sandbox") }),
      );
    } catch (error) {
      log(`sandbox gateway listener unavailable: ${(error as Error).message}`);
    }
    const host = sandbox;
    reaper = setInterval(() => {
      host
        .reap()
        .then((reaped) => reaped.length && log(`reaped ${reaped.length} expired sandbox(es)`))
        .catch((error) => log(`reaper: ${(error as Error).message}`));
    }, 60_000);
  }

  // Advertise the endpoint only once we are actually listening on it.
  publishProfile(store, identity, endpoint, caps);
  sync.start();

  // Loops and the outbox start once the API they call is listening.
  if ((opts.defaultHeartbeat ?? true) && process.env.GALAHAD_HEARTBEAT !== "off") {
    try {
      ensureHeartbeat(store, identity, caps);
    } catch (error) {
      log(`default heartbeat not created: ${(error as Error).message}`);
    }
    try {
      ensureReflection(store, identity);
    } catch (error) {
      log(`his journal's loop not created: ${(error as Error).message}`);
    }
  }
  loops.start(opts.loopIntervalMs);
  // A node that just joined (or whose body, ceiling or benchmark changed while it was down) measures itself now.
  if (measure) upkeep();
  const drain = () => connectors.drain().catch((error) => log(`outbox: ${(error as Error).message}`));
  void drain();
  const outbox = setInterval(drain, 5_000);
  const refresh = opts.capabilities
    ? null
    : setInterval(() => {
        void refreshCapabilities(probeCapabilities, (fresh) => publishProfile(store, identity, endpoint, fresh), log).then((fresh) => {
          if (fresh) caps = fresh;
          // A GPU, a local runtime, more memory, a new ceiling: it measures itself again.
          upkeep();
        });
      }, 5 * 60_000);

  log(
    `node ${config.name} up · fleet ${store.genesis?.name} · ${endpoint} · vault ${vault.unlocked() ? "unlocked" : "locked"}${sandbox ? " · sandbox host" : ""} · ${loops.mine().length} loop(s) here of ${loopRecords(store).length}`,
  );
  return {
    port,
    endpoint,
    identity,
    store,
    sync,
    loops,
    connectors,
    artifacts,
    bank,
    world,
    board,
    archive,
    compute,
    turns,
    doctor: (options) => runDoctor(doctorDeps, options),
    /**
     * In order: take nothing new (stop listening; requests under way go on), start nothing
     * new (timers, sync, loops), let what's under way finish (the outbox, then requests, for
     * a while), and only then close what they write to.
     */
    async stop() {
      const finished = Promise.all(servers.map((s) => s.stop()));
      shutdown.abort();
      clearInterval(outbox);
      if (refresh) clearInterval(refresh);
      if (reaper) clearInterval(reaper);
      stopPush();
      sync.stop();
      stopping = true;
      // No new turns from here (nothing queued is sent); the ones under way get the same grace as requests do.
      const turnsEnded = turns.drain();
      governor.close();
      await upkeeping;
      // The archive starts nothing new, and its round under way (an embedding call) is cut off.
      await archive.stop();
      world.close();
      eyes.close();
      weather.close();
      await loops.stop();
      await connectors.drain();
      await Promise.race([Promise.all([finished, turnsEnded]), Bun.sleep(opts.shutdownGraceMs ?? SHUTDOWN_GRACE_MS)]);
      // A turn still going after that is stopped: its answer kept as stopped, what's queued behind it held until you resume.
      await turns.close();
      await Promise.all(servers.map((s) => s.stop(true)));
      bank.close();
      chats.close();
      archiveStore.close(); // requests may still have been searching it
      experiments.close(); // flushes what requests wrote, so after them
      local.close();
      store.close();
    },
  };
}
