import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  type BoardChange,
  ASSEMBLE_MIN_MS,
  ASSEMBLE_MS,
  BENCH,
  type Examination,
  EXAMINE_MAX_MS,
  EXAMINE_MS,
  ExperimentCode,
  ExperimentCode as ExperimentCodeSchema,
  ExperimentEnd,
  ExperimentEnd as ExperimentEndSchema,
  type ExperimentEngine,
  type ExperimentFrame,
  ExperimentFrames,
  ExperimentFrames as ExperimentFramesSchema,
  type ExperimentPhase,
  ExperimentPhaseReport,
  ExperimentPhaseReport as ExperimentPhaseSchema,
  ExperimentStart,
  ExperimentStart as ExperimentStartSchema,
  type ExperimentView,
  type GalahadState,
  HOLD_MAX_MS,
  MAX_PARTNERS,
  PADS,
  PARTNER_IDLE_MS,
  padKindFor,
  type PhaseTimes,
  PLOT_FILL,
  type Pose,
  SITE_NAMES,
  type SiteName,
  SITES,
  type Station,
  STATIONS,
  walkMs,
  type WorldCompanion,
  type WorldEvent,
  type WorldHeartbeat,
  type WorldNode,
  type WorldPartner,
  type WorldReport,
  type WorldWeather,
} from "@galahad/core";
import type { z } from "zod";
import { ExperimentError, type ExperimentStore } from "./experiment-store.ts";

/*
 * The SANDBOX, as the node keeps it: what Galahad is doing (from his chats, tools,
 * quests and agents' calls), his last few thoughts, and the experiments on their
 * plots, each through its life: built at the workshop's bench, tested where it
 * belongs, examined at the observatory, then done. The world itself is in memory (a
 * view of what's happening now); every experiment is also saved as it runs, by the
 * experiment store (node-local), so it can be listed, examined and replayed after.
 * Watchers get every change.
 */

const PLOT = { small: 24, medium: 48, large: 96 } as const;
/** Plots sit on a grid of cells this wide, from the first ring outside the keep. */
const CELL = 110;
/** Experiments kept on the map: all running ones, and this many that ended. */
const KEEP_ENDED = 12;
/** Back to the keep after this long with nothing to do. */
const IDLE_MS = 25_000;
/** A thought is at most this long. */
const THOUGHT_MAX = 160;
/** Frames per second accepted per experiment (beyond it frames are dropped, not queued). */
const MAX_FPS = 60;
/** Saved experiments the world's hello offers to replay. */
export const SAVED_IN_HELLO = 24;

interface Running extends ExperimentView {
  phase: ExperimentPhase;
  phases: PhaseTimes;
  key: Buffer;
  lastFrameAt: number;
  /** Frames accepted in the current second, to hold MAX_FPS. */
  window: { at: number; count: number };
  /** Its cell of the spiral on open land, or -1 on a pad. */
  cell: number;
  /** The pad it stands on (a site's), if any. */
  pad: string | null;
  /** Where it asked to stand, and how far it spans: its place is chosen again once its simulation says. */
  site: SiteName | "open" | undefined;
  extent: number | undefined;
  /** Prepared by a run (experiment_run) before its simulation started: the simulation's start fills it in. */
  drafted: boolean;
  /** When Galahad will be at the bench (node clock), for a build begun before its bodies were known. */
  arrives: number;
  /** Holds it at the observatory while he examines it. */
  timer: ReturnType<typeof setTimeout> | null;
  waiters: (() => void)[];
}

export interface ExperimentOrigin {
  nodeName: string;
  sandbox: string | null;
  quest: string | null;
}

/** The n-th cell of a square spiral around the origin, skipping the keep's own cell. */
export function cellAt(n: number): { x: number; y: number } {
  // Spiral coordinates (ring, side, step), starting at ring 1.
  let ring = 1;
  let index = n;
  while (index >= 8 * ring) {
    index -= 8 * ring;
    ring++;
  }
  const side = Math.floor(index / (2 * ring));
  const step = index % (2 * ring);
  const [cx, cy] = [
    [ring, -ring + 1 + step],
    [ring - 1 - step, ring],
    [-ring, ring - 1 - step],
    [-ring + 1 + step, -ring],
  ][side]!;
  return { x: cx! * CELL, y: cy! * CELL };
}

/** Room kept between a site and the nearest plot on open land (the land's blend from one level to the other). */
const SITE_MARGIN = 14;

/** True where a cell's largest plot would stand on a site (the proving ground, the hall) or crowd it. */
export function cellOnSite(cell: { x: number; y: number }): boolean {
  const half = PLOT.large / 2 + SITE_MARGIN;
  return SITE_NAMES.some((name) => {
    const s = SITES[name];
    return Math.abs(cell.x - s.x) < s.w / 2 + half && Math.abs(cell.y - s.y) < s.d / 2 + half;
  });
}

const clipThought = (text: string) => {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > THOUGHT_MAX ? `${line.slice(0, THOUGHT_MAX - 1)}…` : line;
};

export class WorldHub {
  private galahad: GalahadState;
  private thoughts: string[] = [];
  private readonly experiments = new Map<string, Running>();
  private readonly watchers = new Set<(event: WorldEvent) => void>();
  private idle: ReturnType<typeof setTimeout> | null = null;
  /** The latest report from each device session (newest last), for `galahad world --logs`. */
  private readonly reports = new Map<string, z.infer<typeof WorldReport> & { device: string; at: number }>();
  private readonly sweep: ReturnType<typeof setInterval>;
  private nodes: () => WorldNode[] = () => [];
  private weather: () => WorldWeather | null = () => null;
  private wakeWeather: () => void = () => {};
  /** The chalkboard's version (board.ts), for the hello: a page then knows whether to fetch it. */
  private boardVersion: () => number | null = () => null;
  private readonly examiners = new Set<(examination: Examination | null, experiment: ExperimentView) => void>();

  constructor(private readonly opts: { now?: () => number; store?: ExperimentStore } = {}) {
    this.galahad = { station: "keep", doing: "At the keep", experiment: null, model: null, since: this.now(), idle: true };
    // An experiment that stops sending (its sandbox died, its script hung) ends as failed; partners that went quiet go home;
    // his heartbeat is read again (another node may have run it, or a notice cleared), and his dog's name (set on another node).
    this.sweep = setInterval(() => {
      this.quiet();
      this.partnersQuiet();
      if (this.watchers.size) this.heartbeatChanged();
      if (this.watchers.size) this.companionChanged();
    }, 15_000);
    this.sweep.unref?.();
    // Saved ones changed (one ended, was pinned or deleted): the world's list of them follows.
    opts.store?.onChange(() => this.emit({ type: "saved", at: this.now(), saved: this.saved() }));
  }

  /** Where experiments are saved (the node always has one; some tests don't). */
  get store(): ExperimentStore | undefined {
    return this.opts.store;
  }

  /** Where the weather comes from, and how to ask for fresh weather when someone opens the world (the app sets it). */
  setWeather(weather: () => WorldWeather | null, wake: () => void): void {
    this.weather = weather;
    this.wakeWeather = wake;
  }

  /** Where the fleet's nodes come from (the app sets it). */
  setNodes(nodes: () => WorldNode[]): void {
    this.nodes = nodes;
  }

  /** Running experiments that haven't sent a frame for 90 seconds have stopped (a run's draft waits for its sandbox: the run ends it). */
  quiet(): void {
    const now = this.now();
    for (const e of [...this.experiments.values()]) {
      if (e.drafted && !e.scene.length) continue;
      if (e.endedAt === null && now - e.lastFrameAt > 90_000) this.conclude(e, "failed", "it stopped sending frames");
    }
  }

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  private emit(event: WorldEvent): void {
    for (const watch of this.watchers) {
      try {
        watch(event);
      } catch {
        /* a watcher that went away */
      }
    }
  }

  /** Everything now: what a new watcher sees first. */
  hello(): WorldEvent {
    const board = this.boardVersion();
    const companion = this.companionNow();
    return {
      type: "hello",
      at: this.now(),
      galahad: this.galahad,
      nodes: this.nodes(),
      experiments: this.views(),
      thoughts: [...this.thoughts],
      weather: this.weather(),
      saved: this.saved(),
      ...(board === null ? {} : { board: { version: board } }),
      heartbeat: this.heartbeatNow(),
      partners: this.partnerViews(),
      ...(companion ? { companion } : {}),
    };
  }

  watch(fn: (event: WorldEvent) => void): () => void {
    this.watchers.add(fn);
    this.wakeWeather();
    return () => this.watchers.delete(fn);
  }

  get watching(): number {
    return this.watchers.size;
  }

  /* ---------- Galahad ---------- */

  /** He goes somewhere to do something; with nothing more to do, he walks back to the keep. */
  doing(station: Station, doing: string, extra: { model?: string | null; experiment?: string | null } = {}): void {
    const next: GalahadState = { station, doing: clipThought(doing), experiment: extra.experiment ?? null, model: extra.model ?? null, since: this.now() };
    const same = next.station === this.galahad.station && next.doing === this.galahad.doing && next.model === this.galahad.model;
    this.galahad = same ? { ...next, since: this.galahad.since } : next;
    if (!same) this.emit({ type: "galahad", at: this.now(), galahad: this.galahad });
    this.restIn(IDLE_MS);
  }

  /** Done for now: he heads home a little later (so a quick follow-up doesn't bounce him around). */
  rest(after = 4_000): void {
    this.restIn(after);
  }

  private restIn(ms: number): void {
    if (this.idle) clearTimeout(this.idle);
    this.idle = setTimeout(() => {
      this.idle = null;
      // Building an experiment, out at one being tested or examining one, he stays at it.
      const watching = this.galahad.experiment ? this.experiments.get(this.galahad.experiment) : undefined;
      if (watching && (watching.phase === "building" || watching.phase === "testing" || watching.phase === "examining")) return this.restIn(IDLE_MS);
      this.galahad = { station: "keep", doing: "At the keep", experiment: null, model: null, since: this.now(), idle: true };
      this.emit({ type: "galahad", at: this.now(), galahad: this.galahad });
    }, ms);
    this.idle.unref?.();
  }

  think(text: string): void {
    const line = clipThought(text);
    if (!line || line === this.thoughts.at(-1)) return;
    this.thoughts = [...this.thoughts, line].slice(-8);
    this.emit({ type: "thought", at: this.now(), text: line });
  }

  notice(severity: "info" | "warn" | "error", title: string): void {
    this.emit({ type: "notice", at: this.now(), severity, title: clipThought(title) });
  }

  weatherChanged(): void {
    this.emit({ type: "weather", at: this.now(), weather: this.weather() });
  }

  /* ---------- the chalkboard ---------- */

  /** Where the board's version comes from (the daemon sets it). */
  setBoard(version: () => number): void {
    this.boardVersion = version;
  }

  /** The board changed: every page fetches it again; an item's region is where he goes to write it. */
  boardChanged(change: BoardChange): void {
    this.emit({ type: "board", at: this.now(), ...change });
  }

  fleetChanged(): void {
    this.emit({ type: "fleet", at: this.now(), nodes: this.nodes() });
  }

  /* ---------- his heartbeat ---------- */

  private heartbeat: () => WorldHeartbeat | null = () => null;
  private heartbeatKey = "null";

  /** Where his heartbeat is read from (the app sets it: heartbeat-world.ts, from the mind). */
  setHeartbeat(source: () => WorldHeartbeat | null): void {
    this.heartbeat = source;
    this.heartbeatKey = JSON.stringify(this.heartbeatNow());
  }

  private heartbeatNow(): WorldHeartbeat | null {
    try {
      return this.heartbeat();
    } catch {
      return null;
    }
  }

  /** It ran, a notice was dismissed or cleared: watchers hear of it if what the world shows changed. */
  heartbeatChanged(): void {
    const heartbeat = this.heartbeatNow();
    const key = JSON.stringify(heartbeat);
    if (key === this.heartbeatKey) return;
    this.heartbeatKey = key;
    this.emit({ type: "heartbeat", at: this.now(), heartbeat });
  }

  /* ---------- his dog ---------- */

  private companion: () => WorldCompanion | null = () => null;
  private companionKey = "null";

  /** Where his dog's name is read from (the daemon sets it: the owner's setting in the mind). */
  setCompanion(source: () => WorldCompanion | null): void {
    this.companion = source;
    this.companionKey = JSON.stringify(this.companionNow());
  }

  private companionNow(): WorldCompanion | null {
    try {
      const companion = this.companion();
      return companion ? { name: companion.name } : null;
    } catch {
      return null;
    }
  }

  /** The owner named his dog or took the name back (here, or on another node): watchers hear of it if it changed. */
  companionChanged(): void {
    const companion = this.companionNow();
    const key = JSON.stringify(companion);
    if (key === this.companionKey) return;
    this.companionKey = key;
    this.emit({ type: "companion", at: this.now(), companion });
  }

  /* ---------- partners: the agents working with him (their MCP calls) ---------- */

  private readonly partners = new Map<string, WorldPartner>();

  /** An agent's call: it arrives (or moves on) to the station its tool sends it to, beside him. */
  partner(name: string, station: Station, doing: string): void {
    const now = this.now();
    const was = this.partners.get(name);
    const line = clipThought(doing);
    const next: WorldPartner = { name: name.slice(0, 48), station, doing: line, since: was?.since ?? now, last: now };
    this.partners.delete(name);
    this.partners.set(name, next);
    while (this.partners.size > MAX_PARTNERS) this.partners.delete(this.partners.keys().next().value!);
    if (!was || was.station !== station || was.doing !== line) this.emit({ type: "partners", at: now, partners: this.partnerViews() });
  }

  /** Partners that have made no call for a while go home. */
  partnersQuiet(): void {
    const now = this.now();
    let gone = false;
    for (const [name, p] of this.partners) {
      if (now - p.last < PARTNER_IDLE_MS) continue;
      this.partners.delete(name);
      gone = true;
    }
    if (gone) this.emit({ type: "partners", at: now, partners: this.partnerViews() });
  }

  private partnerViews(): WorldPartner[] {
    return [...this.partners.values()].map((p) => ({ ...p }));
  }

  /* ---------- experiments ---------- */

  private views(): ExperimentView[] {
    return [...this.experiments.values()].map((e) => this.view(e));
  }

  private view(e: Running): ExperimentView {
    return {
      id: e.id,
      title: e.title,
      engine: e.engine,
      status: e.status,
      plot: e.plot,
      scale: e.scale,
      scene: e.scene,
      startedAt: e.startedAt,
      endedAt: e.endedAt,
      nodeName: e.nodeName,
      sandbox: e.sandbox,
      quest: e.quest,
      metrics: e.metrics,
      summary: e.summary,
      phase: e.phase,
      phases: { ...e.phases },
      assembly: e.assembly ?? null,
      build: e.build ?? null,
    };
  }

  /** What the store keeps of it. */
  private fields(e: Running): ExperimentView & { phase: ExperimentPhase; phases: PhaseTimes } {
    return { ...this.view(e), phase: e.phase, phases: { ...e.phases } };
  }

  /** Tells the store. A disk that fails never stops the world (the store logs its trouble); what the caller did wrong (ExperimentError) is theirs to hear. */
  private keep(what: (store: ExperimentStore) => void): void {
    const store = this.opts.store;
    if (!store) return;
    try {
      what(store);
    } catch (error) {
      if (error instanceof ExperimentError) throw error;
    }
  }

  /** The saved experiments that have ended, newest first, to replay. */
  private saved() {
    return this.opts.store?.recent(SAVED_IN_HELLO) ?? [];
  }

  /**
   * Where an experiment stands: on a pad of the proving ground or the hall when one of the right kind is
   * free (an ended experiment still standing there is cleared away), otherwise on the next free plot of
   * open land. `except` is one being placed again: its own pad or cell doesn't count as taken.
   */
  private place(engine: ExperimentEngine, extent: number | undefined, site: SiteName | "open" | undefined, size: keyof typeof PLOT | undefined, except?: string) {
    const at = this.now();
    const kind = padKindFor(engine, extent, site);
    const running = new Set([...this.experiments.values()].filter((e) => e.endedAt === null && e.id !== except).map((e) => e.pad));
    const pad = kind ? PADS.find((p) => p.kind === kind && !running.has(p.id)) : undefined;
    let cell = -1;
    let plot: ExperimentView["plot"];
    if (pad) {
      for (const e of [...this.experiments.values()]) {
        if (e.pad !== pad.id || e.id === except) continue;
        this.experiments.delete(e.id);
        this.emit({ type: "cleared", at, experiment: e.id });
      }
      plot = { x: pad.x, y: pad.y, size: pad.size };
    } else {
      const used = new Set([...this.experiments.values()].filter((e) => e.id !== except).map((e) => e.cell));
      cell = 0;
      while (used.has(cell) || cellOnSite(cellAt(cell))) cell++;
      plot = { ...cellAt(cell), size: PLOT[size ?? "medium"] };
    }
    const scale = extent ? Math.min(1, (plot.size * PLOT_FILL) / extent) : 1;
    return { plot, cell, pad: pad?.id ?? null, scale };
  }

  /** About where Galahad is: the station he's at, or the bench or plot of the experiment he's with. */
  private spot(): { x: number; y: number } {
    const g = this.galahad;
    const e = g.experiment ? this.experiments.get(g.experiment) : undefined;
    if (g.station === "field") return e ? (e.phase === "building" ? BENCH.stand : e.plot) : STATIONS.keep;
    return STATIONS[g.station];
  }

  /**
   * How long, from now, the world shows it put together on the bench: until ASSEMBLE_MS after he's there
   * (at least ASSEMBLE_MIN_MS, at most HOLD_MAX_MS). With nobody watching, nothing is held.
   */
  private buildSpan(arrives: number): { from: number; until: number } {
    const now = this.now();
    if (!this.watchers.size) return { from: now, until: now };
    return { from: now, until: Math.min(now + HOLD_MAX_MS, Math.max(now + ASSEMBLE_MIN_MS, arrives + ASSEMBLE_MS)) };
  }

  private create(
    input: { title: string; engine: ExperimentEngine; scene: ExperimentView["scene"]; extent?: number; site?: SiteName | "open"; plot?: keyof typeof PLOT },
    origin: ExperimentOrigin,
    drafted: boolean,
  ): Running {
    this.prune();
    const at = this.now();
    const { plot, cell, pad, scale } = this.place(input.engine, input.extent, input.site, input.plot);
    const arrives = at + walkMs(this.spot(), BENCH.stand);
    const experiment: Running = {
      id: `ex_${randomBytes(9).toString("base64url")}`,
      title: input.title,
      engine: input.engine,
      status: "starting",
      plot,
      scale,
      scene: input.scene,
      startedAt: at,
      endedAt: null,
      nodeName: origin.nodeName,
      sandbox: origin.sandbox,
      quest: origin.quest,
      metrics: {},
      summary: null,
      phase: "building",
      phases: { building: at, testing: null, examining: null, ended: null },
      assembly: null,
      build: input.scene.length ? this.buildSpan(arrives) : null,
      key: randomBytes(32),
      lastFrameAt: at,
      window: { at, count: 0 },
      cell,
      pad,
      site: input.site,
      extent: input.extent,
      drafted,
      arrives,
      timer: null,
      waiters: [],
    };
    this.experiments.set(experiment.id, experiment);
    this.keep((store) => store.begin(this.fields(experiment)));
    this.emit({ type: "experiment", at, experiment: this.view(experiment) });
    // He goes to the workshop's bench to build it.
    this.doing("field", `Building an experiment: ${input.title}`, { experiment: experiment.id });
    return experiment;
  }

  /** Seconds its simulation should hold its first frame (the start's answer, `build`): 0, don't. */
  private holdSeconds(e: Running): number {
    return e.build ? Math.max(0, Math.round((e.build.until - this.now()) / 100) / 10) : 0;
  }

  /**
   * A new experiment where it belongs (see place), being built. Returns its id, the key its frames must
   * carry, and how long its first frame should wait so the world can show it built (0: no wait). A run's
   * draft for this sandbox, waiting for its simulation, is filled in instead.
   */
  start(input: z.infer<typeof ExperimentStart>, origin: ExperimentOrigin): { id: string; key: string; view: ExperimentView; build: number } {
    const draft = origin.sandbox ? [...this.experiments.values()].find((e) => e.drafted && !e.scene.length && e.sandbox === origin.sandbox && e.endedAt === null) : undefined;
    const e = draft ? this.fill(draft, input) : this.create(input, origin, false);
    this.think(`Let's put "${e.title}" together.`);
    return { id: e.id, key: e.key.toString("base64url"), view: this.view(e), build: this.holdSeconds(e) };
  }

  /** A run's draft gets its simulation: its bodies and engine, and its place again if that changed. */
  private fill(e: Running, input: z.infer<typeof ExperimentStart>): Running {
    const site = input.site ?? e.site;
    const extent = input.extent ?? e.extent;
    if (padKindFor(input.engine, extent, site) !== padKindFor(e.engine, e.extent, e.site) || extent !== e.extent) {
      const placed = this.place(input.engine, extent, site, input.plot, e.id);
      Object.assign(e, { plot: placed.plot, cell: placed.cell, pad: placed.pad, scale: placed.scale });
    }
    Object.assign(e, { engine: input.engine, scene: input.scene, site, extent, lastFrameAt: this.now(), build: this.buildSpan(e.arrives) });
    this.keep((store) => store.update(this.fields(e)));
    this.emit({ type: "experiment", at: this.now(), experiment: this.view(e) });
    return e;
  }

  /**
   * A run (experiment_run) prepares an experiment before its sandbox exists: Galahad goes to the workshop
   * and starts building while the sandbox spins up; its simulation's start fills it in (`attach` names
   * the sandbox). The run ends it if the simulation never does.
   */
  draft(input: { title: string; engine: ExperimentEngine; extent?: number; site?: SiteName | "open" }, origin: ExperimentOrigin): ExperimentView {
    return this.view(this.create({ ...input, scene: [] }, origin, true));
  }

  attach(id: string, sandbox: string): void {
    const e = this.experiments.get(id);
    if (!e || e.endedAt !== null) return;
    e.sandbox = sandbox;
    this.keep((store) => store.update(this.fields(e)));
  }

  /** The experiment, if this key is its own (constant-time). */
  private owned(id: string, key: string): Running {
    const e = this.experiments.get(id);
    const given = Buffer.from(key, "base64url");
    if (!e || given.length !== e.key.length || !timingSafeEqual(given, e.key)) throw new WorldError(404, "no such experiment, or not yours");
    return e;
  }

  /** The module says where it is: how its bodies stand once built (for the bench), then that the test begins. */
  phase(id: string, key: string, input: z.infer<typeof ExperimentPhaseReport>): ExperimentView {
    const e = this.owned(id, key);
    if (e.endedAt !== null) throw new WorldError(409, "that experiment has ended");
    if (e.phase === "building") {
      if (input.phase === "building") {
        const names = new Set(e.scene.map((b) => b.id));
        e.assembly = Object.fromEntries(Object.entries(input.poses).filter(([body]) => names.has(body))) as Record<string, Pose>;
        this.emit({ type: "experiment", at: this.now(), experiment: this.view(e) });
      } else this.testing(e);
    }
    return this.view(e);
  }

  /** Built: out to where it's tested, and the test begins. */
  private testing(e: Running): void {
    const at = this.now();
    e.phase = "testing";
    e.status = "running";
    e.phases.testing = at;
    e.assembly = null;
    this.keep((store) => store.update(this.fields(e)));
    this.emit({ type: "experiment", at, experiment: this.view(e) });
    this.doing("field", `Testing: ${e.title}`, { experiment: e.id });
    this.think(`Let's see how "${e.title}" behaves.`);
  }

  frames(id: string, key: string, input: z.infer<typeof ExperimentFrames>): { accepted: number } {
    const e = this.owned(id, key);
    if (e.status === "done" || e.status === "failed") throw new WorldError(409, "that experiment has ended");
    const at = this.now();
    e.lastFrameAt = at;
    // A module that doesn't say its phases: its first frame is the test.
    if (e.phase === "building") this.testing(e);
    if (at - e.window.at >= 1000) e.window = { at, count: 0 };
    const accepted: (typeof input.frames)[number][] = [];
    for (const f of input.frames) {
      if (e.window.count >= MAX_FPS) break;
      e.window.count++;
      accepted.push(f);
      const frame: ExperimentFrame = { experiment: id, t: f.t, poses: f.poses, ...(f.metrics ? { metrics: f.metrics } : {}) };
      this.emit({ type: "frame", at, frame });
    }
    // The record (and the latest readouts) keep every frame: only the live stream is held to MAX_FPS.
    for (const f of input.frames) if (f.metrics) e.metrics = { ...e.metrics, ...f.metrics };
    this.keep((store) => store.record(id, input.frames, at));
    return { accepted: accepted.length };
  }

  end(id: string, key: string, input: z.infer<typeof ExperimentEnd>): ExperimentView {
    const e = this.owned(id, key);
    if (e.endedAt === null) this.conclude(e, input.status, input.summary ?? null, input.metrics);
    return this.view(e);
  }

  /** The code that ran it (the module's own `__main__`). */
  code(id: string, key: string, input: z.infer<typeof ExperimentCode>): void {
    this.owned(id, key);
    this.keep((store) => store.setCode(id, input.name, input.source));
  }

  /** A run keeps the script it ran with its experiment. */
  keepCode(id: string, name: string, source: string): void {
    if (this.experiments.has(id)) this.keep((store) => store.setCode(id, name, source));
  }

  /**
   * It ended (done, or failed): it's saved, and Galahad walks to the observatory and examines it. While
   * someone watches, he takes his time there (the walk, then EXAMINE_MS; at most EXAMINE_MAX_MS); then
   * it's done.
   */
  private conclude(e: Running, status: "done" | "failed", summary: string | null, metrics?: Record<string, number>): void {
    const at = this.now();
    const from = e.phase === "building" ? BENCH.stand : e.plot;
    e.status = status;
    e.endedAt = at;
    e.summary = summary;
    if (metrics) e.metrics = { ...e.metrics, ...metrics };
    e.phase = "examining";
    e.phases.examining = at;
    e.assembly = null;
    e.build = null;
    this.keep((store) => store.finish(this.fields(e)));
    this.emit({ type: "experiment", at, experiment: this.view(e) });
    this.think(summary ? `${e.title}: ${summary}` : `${e.title} ${status === "done" ? "finished" : "failed"}.`);
    // The seam for the observatory's chalkboard: whatever writes the examination up listens (onExamine).
    const examination = this.examination(e.id);
    for (const fn of this.examiners) {
      try {
        fn(examination, this.view(e));
      } catch {
        /* a listener's problem */
      }
    }
    this.doing("observatory", `Examining: ${e.title}`, { experiment: e.id });
    const hold = this.watchers.size ? Math.min(EXAMINE_MAX_MS, walkMs(from, STATIONS.observatory) + EXAMINE_MS) : 0;
    if (!hold) return this.examined(e);
    e.timer = setTimeout(() => this.examined(e), hold);
    e.timer.unref?.();
  }

  /** Examined: done (or failed), and he goes back to rest. */
  private examined(e: Running): void {
    if (e.timer) clearTimeout(e.timer);
    e.timer = null;
    if (e.phase !== "examining") return;
    e.phase = e.status === "done" ? "done" : "failed";
    e.phases.ended = this.now();
    this.keep((store) => store.update(this.fields(e)));
    // (Cleared from its pad meanwhile, it's no longer in the world: only its record changes.)
    if (this.experiments.get(e.id) === e) this.emit({ type: "experiment", at: this.now(), experiment: this.view(e) });
    const examination = this.examination(e.id);
    if (examination) this.think(examination.headline);
    if (this.galahad.experiment === e.id) this.rest(4_000);
    for (const resolve of e.waiters.splice(0)) resolve();
  }

  /** What an experiment showed, from what the store kept. */
  examination(id: string): Examination | null {
    try {
      return this.opts.store?.examination(id) ?? null;
    } catch {
      return null;
    }
  }

  /** The seam for whatever writes up an examination (the observatory's chalkboard): called as each experiment's examining begins. */
  onExamine(fn: (examination: Examination | null, experiment: ExperimentView) => void): () => void {
    this.examiners.add(fn);
    return () => this.examiners.delete(fn);
  }

  /** Resolves once it's done or failed (examined), or after `maxMs`. */
  settled(id: string, maxMs = EXAMINE_MAX_MS + 5_000): Promise<void> {
    const e = this.experiments.get(id);
    if (!e || e.phase === "done" || e.phase === "failed") return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, maxMs);
      timer.unref?.();
      e.waiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /** The experiments a sandbox started (a run reports them). */
  experimentsOf(sandbox: string): ExperimentView[] {
    return [...this.experiments.values()].filter((e) => e.sandbox === sandbox).map((e) => this.view(e));
  }

  current(id: string): ExperimentView | null {
    const e = this.experiments.get(id);
    return e ? this.view(e) : null;
  }

  /** A run's experiment that never got going (its sandbox didn't start, its script failed first) ends, failed, saying why. */
  abandon(id: string, summary: string): void {
    const e = this.experiments.get(id);
    if (e && e.endedAt === null) this.conclude(e, "failed", summary.slice(0, 300));
  }

  /** A sandbox that's gone takes its unfinished experiments with it. */
  sandboxGone(sandbox: string): void {
    for (const e of [...this.experiments.values()]) {
      if (e.sandbox === sandbox && e.endedAt === null) this.conclude(e, "failed", "its sandbox stopped before it finished");
    }
  }

  /** Only the most recent ended experiments stay on the map (one being examined stays until it's done). */
  private prune(): void {
    const ended = [...this.experiments.values()].filter((e) => e.endedAt !== null && !e.timer).sort((a, b) => b.endedAt! - a.endedAt!);
    for (const e of ended.slice(KEEP_ENDED)) this.experiments.delete(e.id);
  }

  /** A device says how the world ran there. The 20 most recent sessions are kept, in memory. */
  report(input: z.infer<typeof WorldReport>, device: string): void {
    this.reports.delete(input.session);
    this.reports.set(input.session, { ...input, device, at: this.now() });
    while (this.reports.size > 20) this.reports.delete(this.reports.keys().next().value!);
  }

  reportsView(): (z.infer<typeof WorldReport> & { device: string; at: number })[] {
    return [...this.reports.values()].reverse();
  }

  close(): void {
    if (this.idle) clearTimeout(this.idle);
    clearInterval(this.sweep);
    for (const e of this.experiments.values()) if (e.timer) clearTimeout(e.timer);
    this.watchers.clear();
    this.examiners.clear();
  }
}

export class WorldError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Where each station is, for anything that needs to say "Galahad is at …". */
export const stationLabel = (station: Station): string => (station === "field" ? "out on an experiment" : STATIONS[station].label);

/** The gateway scope that lets a sandbox put experiments into the world. */
export const WORLD_SCOPE = "world";

const json = (status: number, body: unknown) => Response.json(body, { status });
const MAX_BODY = 4_000_000;

/**
 * The world, as a sandbox reaches it through its gateway:
 *   POST /world/experiments                 (Bearer: the sandbox's token, scope "world") → { id, key, plot, scale, build }
 *   POST /world/experiments/<id>/phase      (x-experiment-key) { phase: "building", poses } | { phase: "testing" }
 *   POST /world/experiments/<id>/code       (x-experiment-key) { name, source }
 *   POST /world/experiments/<id>/frames     (x-experiment-key) { frames: [...] }
 *   POST /world/experiments/<id>/end        (x-experiment-key) { status, summary?, metrics? }
 * Starting spends one request of the token; the rest carry the experiment's own key instead,
 * so a long simulation doesn't use up the sandbox's budget for models. `build` is how many
 * seconds the first frame should wait while the world shows it built (0 with nobody watching).
 */
export async function handleSandboxWorld(
  req: Request,
  ctx: { tokens: { consume(token: string, scope: string): { ok: true } | { ok: false; reason: string }; labelOf(token: string): string | null }; world: WorldHub; nodeName: string },
): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "POST" });
  const text = await req.text();
  if (text.length > MAX_BODY) return json(413, { error: "at most 4 MB at a time: send frames in smaller batches" });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json(400, { error: "invalid JSON" });
  }
  const path = new URL(req.url).pathname;
  const problem = (issues: { path: PropertyKey[]; message: string }[]) => json(400, { error: issues.slice(0, 5).map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") });
  try {
    if (path === "/world/experiments") {
      const token = req.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? "";
      const verdict = ctx.tokens.consume(token, WORLD_SCOPE);
      if (!verdict.ok) return json(401, { error: verdict.reason });
      const input = ExperimentStartSchema.safeParse(body);
      if (!input.success) return problem(input.error.issues);
      const label = ctx.tokens.labelOf(token);
      const sandbox = label?.startsWith("sandbox:") ? label.slice("sandbox:".length) : null;
      const { id, key, view, build } = ctx.world.start(input.data, { nodeName: ctx.nodeName, sandbox, quest: null });
      return json(200, { id, key, plot: view.plot, scale: view.scale, build });
    }
    const match = path.match(/^\/world\/experiments\/(ex_[A-Za-z0-9_-]{12})\/(frames|end|phase|code)$/);
    if (!match) return json(404, { error: "not found" });
    const key = req.headers.get("x-experiment-key") ?? "";
    if (match[2] === "frames") {
      const input = ExperimentFramesSchema.safeParse(body);
      if (!input.success) return problem(input.error.issues);
      return json(200, ctx.world.frames(match[1]!, key, input.data));
    }
    if (match[2] === "phase") {
      const input = ExperimentPhaseSchema.safeParse(body);
      if (!input.success) return problem(input.error.issues);
      const view = ctx.world.phase(match[1]!, key, input.data);
      return json(200, { phase: view.phase });
    }
    if (match[2] === "code") {
      const input = ExperimentCodeSchema.safeParse(body);
      if (!input.success) return problem(input.error.issues);
      ctx.world.code(match[1]!, key, input.data);
      return json(200, { kept: true });
    }
    const input = ExperimentEndSchema.safeParse(body);
    if (!input.success) return problem(input.error.issues);
    return json(200, { experiment: ctx.world.end(match[1]!, key, input.data) });
  } catch (error) {
    if (error instanceof WorldError || error instanceof ExperimentError) return json(error.status, { error: error.message });
    throw error;
  }
}
