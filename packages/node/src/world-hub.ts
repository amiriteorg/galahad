import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  ExperimentEnd,
  ExperimentEnd as ExperimentEndSchema,
  type ExperimentFrame,
  ExperimentFrames,
  ExperimentFrames as ExperimentFramesSchema,
  ExperimentStart,
  ExperimentStart as ExperimentStartSchema,
  type ExperimentView,
  type GalahadState,
  MAX_PARTNERS,
  PADS,
  PARTNER_IDLE_MS,
  padKindFor,
  PLOT_FILL,
  SITE_NAMES,
  SITES,
  type Station,
  STATIONS,
  type WorldEvent,
  type WorldHeartbeat,
  type WorldNode,
  type WorldPartner,
  type WorldReport,
  type WorldWeather,
} from "@galahad/core";
import type { z } from "zod";

/*
 * The SANDBOX, as the node keeps it: what Galahad is doing (from his chats, tools,
 * quests and agents' calls), his last few thoughts, and the experiments running on
 * their plots. In memory: the world is a view of what's happening now, not a record
 * (the ledger, chats and artifacts are the records). Watchers get every change.
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

interface Running extends ExperimentView {
  key: Buffer;
  lastFrameAt: number;
  /** Frames accepted in the current second, to hold MAX_FPS. */
  window: { at: number; count: number };
  /** Its cell of the spiral on open land, or -1 on a pad. */
  cell: number;
  /** The pad it stands on (a site's), if any. */
  pad: string | null;
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

  constructor(private readonly opts: { now?: () => number } = {}) {
    this.galahad = { station: "keep", doing: "At the keep", experiment: null, model: null, since: this.now(), idle: true };
    // An experiment that stops sending (its sandbox died, its script hung) ends as failed; partners that went quiet go home;
    // his heartbeat is read again (another node may have run it, or a notice cleared).
    this.sweep = setInterval(() => {
      this.quiet();
      this.partnersQuiet();
      if (this.watchers.size) this.heartbeatChanged();
    }, 15_000);
    this.sweep.unref?.();
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

  /** Running experiments that haven't sent a frame for 90 seconds have stopped. */
  quiet(): void {
    const now = this.now();
    for (const e of this.experiments.values()) {
      if ((e.status === "starting" || e.status === "running") && now - e.lastFrameAt > 90_000) {
        e.status = "failed";
        e.endedAt = now;
        e.summary = "it stopped sending frames";
        this.emit({ type: "experiment", at: now, experiment: this.view(e) });
      }
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
    return {
      type: "hello",
      at: this.now(),
      galahad: this.galahad,
      nodes: this.nodes(),
      experiments: this.views(),
      thoughts: [...this.thoughts],
      weather: this.weather(),
      heartbeat: this.heartbeatNow(),
      partners: this.partnerViews(),
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
      // Out at an experiment that's still running, he stays to watch it.
      const watching = this.galahad.experiment ? this.experiments.get(this.galahad.experiment) : undefined;
      if (watching && (watching.status === "running" || watching.status === "starting")) return this.restIn(IDLE_MS);
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
    const { key: _key, window: _window, cell: _cell, pad: _pad, lastFrameAt: _last, ...view } = e;
    return view;
  }

  /**
   * A new experiment where it belongs: on a pad of the proving ground or the hall when one of the
   * right kind is free (an ended experiment still standing there is cleared away), otherwise on the
   * next free plot of open land. Returns its id and the key its frames must carry.
   */
  start(input: z.infer<typeof ExperimentStart>, origin: ExperimentOrigin): { id: string; key: string; view: ExperimentView } {
    this.prune();
    const at = this.now();
    const kind = padKindFor(input.engine, input.extent, input.site);
    const running = new Set([...this.experiments.values()].filter((e) => e.endedAt === null).map((e) => e.pad));
    const pad = kind ? PADS.find((p) => p.kind === kind && !running.has(p.id)) : undefined;
    let cell = -1;
    let plot: ExperimentView["plot"];
    if (pad) {
      for (const e of [...this.experiments.values()]) {
        if (e.pad !== pad.id) continue;
        this.experiments.delete(e.id);
        this.emit({ type: "cleared", at, experiment: e.id });
      }
      plot = { x: pad.x, y: pad.y, size: pad.size };
    } else {
      const used = new Set([...this.experiments.values()].map((e) => e.cell));
      cell = 0;
      while (used.has(cell) || cellOnSite(cellAt(cell))) cell++;
      plot = { ...cellAt(cell), size: PLOT[input.plot ?? "medium"] };
    }
    const scale = input.extent ? Math.min(1, (plot.size * PLOT_FILL) / input.extent) : 1;
    const key = randomBytes(32);
    const id = `ex_${randomBytes(9).toString("base64url")}`;
    const experiment: Running = {
      id,
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
      key,
      lastFrameAt: at,
      window: { at, count: 0 },
      cell,
      pad: pad?.id ?? null,
    };
    this.experiments.set(id, experiment);
    this.emit({ type: "experiment", at, experiment: this.view(experiment) });
    // He walks out to watch it.
    this.doing("field", `Running an experiment: ${input.title}`, { experiment: id });
    this.think(`Let's see how "${input.title}" behaves.`);
    return { id, key: key.toString("base64url"), view: this.view(experiment) };
  }

  /** The experiment, if this key is its own (constant-time). */
  private owned(id: string, key: string): Running {
    const e = this.experiments.get(id);
    const given = Buffer.from(key, "base64url");
    if (!e || given.length !== e.key.length || !timingSafeEqual(given, e.key)) throw new WorldError(404, "no such experiment, or not yours");
    return e;
  }

  frames(id: string, key: string, input: z.infer<typeof ExperimentFrames>): { accepted: number } {
    const e = this.owned(id, key);
    if (e.status === "done" || e.status === "failed") throw new WorldError(409, "that experiment has ended");
    const at = this.now();
    e.lastFrameAt = at;
    if (at - e.window.at >= 1000) e.window = { at, count: 0 };
    let accepted = 0;
    for (const f of input.frames) {
      if (e.window.count >= MAX_FPS) break;
      e.window.count++;
      accepted++;
      const frame: ExperimentFrame = { experiment: id, t: f.t, poses: f.poses, ...(f.metrics ? { metrics: f.metrics } : {}) };
      if (f.metrics) e.metrics = { ...e.metrics, ...f.metrics };
      this.emit({ type: "frame", at, frame });
    }
    if (e.status === "starting") {
      e.status = "running";
      this.emit({ type: "experiment", at, experiment: this.view(e) });
    }
    return { accepted };
  }

  end(id: string, key: string, input: z.infer<typeof ExperimentEnd>): ExperimentView {
    const e = this.owned(id, key);
    if (e.status === "done" || e.status === "failed") return this.view(e);
    e.status = input.status;
    e.endedAt = this.now();
    e.summary = input.summary ?? null;
    if (input.metrics) e.metrics = { ...e.metrics, ...input.metrics };
    this.emit({ type: "experiment", at: this.now(), experiment: this.view(e) });
    this.think(input.summary ? `${e.title}: ${input.summary}` : `${e.title} ${input.status === "done" ? "finished" : "failed"}.`);
    if (this.galahad.experiment === id) this.rest(8_000);
    return this.view(e);
  }

  /** A sandbox that's gone takes its unfinished experiments with it. */
  sandboxGone(sandbox: string): void {
    for (const e of this.experiments.values()) {
      if (e.sandbox === sandbox && (e.status === "starting" || e.status === "running")) {
        e.status = "failed";
        e.endedAt = this.now();
        e.summary = "its sandbox stopped before it finished";
        this.emit({ type: "experiment", at: this.now(), experiment: this.view(e) });
      }
    }
  }

  /** Only the most recent ended experiments stay on the map. */
  private prune(): void {
    const ended = [...this.experiments.values()].filter((e) => e.endedAt !== null).sort((a, b) => b.endedAt! - a.endedAt!);
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
    this.watchers.clear();
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
 *   POST /world/experiments                 (Bearer: the sandbox's token, scope "world") → { id, key, plot, scale }
 *   POST /world/experiments/<id>/frames     (x-experiment-key) { frames: [...] }
 *   POST /world/experiments/<id>/end        (x-experiment-key) { status, summary?, metrics? }
 * Starting spends one request of the token; frames carry the experiment's own key instead,
 * so a long simulation doesn't use up the sandbox's budget for models.
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
      const { id, key, view } = ctx.world.start(input.data, { nodeName: ctx.nodeName, sandbox, quest: null });
      return json(200, { id, key, plot: view.plot, scale: view.scale });
    }
    const match = path.match(/^\/world\/experiments\/(ex_[A-Za-z0-9_-]{12})\/(frames|end)$/);
    if (!match) return json(404, { error: "not found" });
    const key = req.headers.get("x-experiment-key") ?? "";
    if (match[2] === "frames") {
      const input = ExperimentFramesSchema.safeParse(body);
      if (!input.success) return problem(input.error.issues);
      return json(200, ctx.world.frames(match[1]!, key, input.data));
    }
    const input = ExperimentEndSchema.safeParse(body);
    if (!input.success) return problem(input.error.issues);
    return json(200, { experiment: ctx.world.end(match[1]!, key, input.data) });
  } catch (error) {
    if (error instanceof WorldError) return json(error.status, { error: error.message });
    throw error;
  }
}
