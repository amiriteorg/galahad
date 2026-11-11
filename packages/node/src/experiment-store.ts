import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Examination,
  examine,
  type ExperimentPhase,
  type ExperimentView,
  type PhaseTimes,
  type Pose,
  type ReadoutStats,
  type RecordingPage,
  type SavedExperiment,
  type SavedSummary,
  summaryOf,
} from "@galahad/core";
import { z } from "zod";

/*
 * Saved experiments, on the node that ran them: ~/.galahad/experiments/<id>/
 *   view.json        what it was (title, engine, scene, plot, scale), how it went (status, phases,
 *                    timings, summary), where (node, sandbox), each readout's exact figures, the
 *                    recording's index; written whole and atomically
 *   recording.jsonl  its frames for a replay: one line a frame, [t, i, x, y, z, qw, qx, qy, qz, i, …]
 *                    (i: the body's place in the scene), decimated, thinned to stay within its cap
 *   readouts.jsonl   its readouts over time: [t, k, value, k, value, …] (k: the readout's place)
 *   code.txt         the script that ran it, when it was sent
 *
 * Node-local: never in the mind (it's the world's record, not the fleet's). A running experiment's
 * frames and readouts are kept in memory (within their caps) and written every few seconds; each
 * write is whole and atomic, so a restart finds the last complete state. Every experiment has hard
 * caps, all of them together a budget: the oldest unpinned ones go first.
 */

const KB = 1024;
const MB = 1024 * KB;

export interface ExperimentLimits {
  /** Frames a second of simulation a recording keeps, at most. */
  recordingHz: number;
  /** Readout samples a second of simulation, at most. */
  readoutHz: number;
  /** One experiment's recording, readouts and code, at most (bytes on disk). */
  recordingBytes: number;
  readoutBytes: number;
  codeBytes: number;
  /** All saved experiments together; then the oldest unpinned go. */
  budgetBytes: number;
  /** Pinned ones together (so pins can never crowd out everything else). */
  pinnedBytes: number;
  /** How many are kept at most, whatever their size. */
  count: number;
  /** How often a running experiment's frames are written. */
  flushMs: number;
  /** A page of a recording, about this many bytes. */
  pageBytes: number;
}

/*
 * The figures, and why.
 * - 15 frames a second: the live stream reaches the renderer in tenth-of-a-second batches, so a replay
 *   at 15 keyframes (interpolated in between) is smoother than the test looked live.
 * - 8 MB a recording: a frame is about 60 bytes a moving body, so 8 MB holds ~9 hours of one aircraft,
 *   15 minutes of a 10-body rig, 40 seconds of the 500-body maximum. Past it, the recording is thinned
 *   to half the rate (again and again if need be), so it still covers the whole run.
 * - 2 MB of readouts at 30 a second (exact range, first and last are kept over every sample anyway).
 * - 64 KB of code: one script, which is all the module sends.
 * - 512 MB in all, 256 MB of it pinned, 1000 experiments: typical ones are tens of kilobytes, so that's
 *   the last thousand; the heaviest still leave room for dozens. A node's disk never notices.
 */
export const EXPERIMENT_LIMITS: ExperimentLimits = {
  recordingHz: 15,
  readoutHz: 30,
  recordingBytes: 8 * MB,
  readoutBytes: 2 * MB,
  codeBytes: 64 * KB,
  budgetBytes: 512 * MB,
  pinnedBytes: 256 * MB,
  count: 1000,
  flushMs: 5_000,
  pageBytes: 512 * KB,
};

export class ExperimentError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const ID = /^ex_[A-Za-z0-9_-]{12}$/;
const round = (v: number, k: number) => Math.round(v * k) / k;

/**
 * Samples kept at most `1/hz` apart (simulation time). Between rows, samples are merged (the latest of
 * each wins), so nothing that moved only in a skipped sample is lost. When the rows outgrow their cap,
 * every other row goes (carrying what it said forward into the next) and the rate halves.
 */
export class Thinned {
  private rows: { t: number; line: string }[] = [];
  private pending: Map<number, number[]> | null = null;
  private pendingT = 0;
  bytes = 0;
  interval: number;
  thinned = false;

  constructor(
    /** Values an item has: 7 for a pose, 1 for a readout. */
    private readonly width: number,
    hz: number,
    private readonly cap: number,
  ) {
    this.interval = 1 / hz;
  }

  get count(): number {
    return this.rows.length;
  }

  get first(): number | null {
    return this.rows[0]?.t ?? null;
  }

  get last(): number | null {
    return this.rows.at(-1)?.t ?? null;
  }

  lines(): string[] {
    return this.rows.map((r) => r.line);
  }

  /** A sample at t of each item (by its index): a row once `interval` has passed since the last. */
  offer(t: number, items: Iterable<[number, number[]]>): void {
    const pending = (this.pending ??= new Map());
    for (const [k, v] of items) pending.set(k, v);
    this.pendingT = t;
    const last = this.rows.at(-1);
    if (!last || t - last.t >= this.interval - 1e-9) this.commit();
  }

  /** Whatever is still pending becomes the last row (the very last sample is always kept). */
  close(): void {
    this.commit();
  }

  private commit(): void {
    if (!this.pending?.size) return;
    const line = lineOf(this.pendingT, this.pending);
    this.pending = null;
    this.rows.push({ t: this.pendingT, line });
    this.bytes += line.length + 1;
    while (this.bytes > this.cap && this.rows.length > 2) this.thin();
  }

  private thin(): void {
    const rows = this.rows;
    const kept: { t: number; line: string }[] = [];
    for (let i = 0; i < rows.length; i++) {
      if (i === 0 || i === rows.length - 1 || i % 2 === 0) {
        kept.push(rows[i]!);
        continue;
      }
      // Dropped: what it said about anything the next row doesn't say carries forward.
      const dropped = itemsOf(rows[i]!.line, this.width);
      const next = rows[i + 1]!;
      const into = itemsOf(next.line, this.width);
      let changed = false;
      for (const [k, v] of dropped) {
        if (into.has(k)) continue;
        into.set(k, v);
        changed = true;
      }
      if (changed) next.line = lineOf(next.t, into);
    }
    this.rows = kept;
    this.bytes = kept.reduce((sum, r) => sum + r.line.length + 1, 0);
    this.interval *= 2;
    this.thinned = true;
  }
}

/** One row: [t, k, …values, k, …values]. */
function lineOf(t: number, items: Map<number, number[]>): string {
  const flat: number[] = [round(t, 1e4)];
  for (const [k, v] of items) flat.push(k, ...v);
  return JSON.stringify(flat);
}

/** A row's items again: each index, then `width` values (7 for a pose, 1 for a readout). */
function itemsOf(line: string, width: number): Map<number, number[]> {
  const flat = JSON.parse(line) as number[];
  const items = new Map<number, number[]>();
  for (let i = 1; i + width < flat.length; i += width + 1) items.set(flat[i]!, flat.slice(i + 1, i + 1 + width));
  return items;
}

/** A finite row of numbers, as read back from disk (anything else is skipped). */
function parseRow(line: string): number[] | null {
  if (!line) return null;
  try {
    const row = JSON.parse(line) as unknown;
    if (!Array.isArray(row) || !row.length || !row.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
    return row as number[];
  } catch {
    return null;
  }
}

const PHASES = ["building", "testing", "examining", "done", "failed"] as const;
const Finite = z.number().finite();
/** view.json as read back: what must be there, loosely (a newer node may write more). */
const SavedFile = z.looseObject({
  id: z.string().regex(ID),
  title: z.string().max(500),
  engine: z.string().max(32),
  status: z.enum(["starting", "running", "done", "failed"]),
  phase: z.enum(PHASES),
  phases: z.looseObject({ building: Finite, testing: Finite.nullable(), examining: Finite.nullable(), ended: Finite.nullable() }),
  plot: z.looseObject({ x: Finite, y: Finite, size: Finite }),
  scale: Finite.positive(),
  scene: z.array(z.looseObject({ id: z.string(), shape: z.looseObject({ kind: z.string() }) })),
  startedAt: Finite,
  endedAt: Finite.nullable(),
  nodeName: z.string(),
  sandbox: z.string().nullable(),
  quest: z.string().nullable(),
  metrics: z.record(z.string(), Finite),
  summary: z.string().nullable(),
  pinned: z.boolean(),
  recording: z.looseObject({ frames: z.number().int().min(0), hz: Finite, thinned: z.boolean(), rate: Finite, t0: Finite.nullable(), t1: Finite.nullable(), bodies: z.array(z.string()) }),
  readouts: z.record(z.string(), z.looseObject({ count: z.number().int().min(0), min: Finite, max: Finite, tMin: Finite, tMax: Finite, first: z.tuple([Finite, Finite]), last: z.tuple([Finite, Finite]) })),
  code: z.looseObject({ name: z.string(), bytes: z.number().int().min(0) }).nullable(),
});

/** A running experiment's buffers. */
interface Live {
  frames: Thinned;
  readouts: Thinned;
  bodies: Map<string, number>;
  keys: Map<string, number>;
  /** Added to a simulation's clock when it goes back (a reset): recordings run forwards. */
  offset: number;
  lastT: number;
  /** The first and latest frame: simulation time and the node's clock (how fast it played). */
  clock: { t0: number; at0: number; t1: number; at1: number } | null;
  dirty: boolean;
}

export interface ExperimentStoreOptions {
  /** Where they're kept (the node's home/experiments). */
  dir: string;
  limits?: Partial<ExperimentLimits>;
  log?: (message: string) => void;
  now?: () => number;
}

/** What's under the hub's control in a view (the rest is the store's). */
type Fields = ExperimentView & { phase: ExperimentPhase; phases: PhaseTimes };

export class ExperimentStore {
  readonly limits: ExperimentLimits;
  private readonly saved = new Map<string, SavedExperiment>();
  private readonly live = new Map<string, Live>();
  private readonly listeners = new Set<() => void>();
  private readonly timer: ReturnType<typeof setInterval>;
  private cache: { id: string; bytes: number; recording: string[] | null; examination: Examination | null } | null = null;
  private readonly log: (message: string) => void;

  constructor(private readonly o: ExperimentStoreOptions) {
    this.limits = { ...EXPERIMENT_LIMITS, ...o.limits };
    this.log = o.log ?? (() => {});
    mkdirSync(o.dir, { recursive: true, mode: 0o700 });
    this.recover();
    this.timer = setInterval(() => this.flush(), this.limits.flushMs);
    this.timer.unref?.();
  }

  private now(): number {
    return this.o.now?.() ?? Date.now();
  }

  private path(id: string, file = ""): string {
    if (!ID.test(id)) throw new ExperimentError(400, "not an experiment id");
    return join(this.o.dir, id, file);
  }

  /** The list of ended ones changed: tell whoever shows it. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    for (const fn of this.listeners) {
      try {
        fn();
      } catch {
        /* a listener's problem */
      }
    }
  }

  // ---------- after a restart ----------

  /** Everything on disk, checked; what was running when the node stopped ended then; what can't be read is cleared. */
  private recover(): void {
    for (const name of readdirSync(this.o.dir)) {
      if (!ID.test(name)) continue;
      const dir = join(this.o.dir, name);
      for (const file of ["view.json", "recording.jsonl", "readouts.jsonl", "code.txt"]) rmSync(join(dir, `${file}.tmp`), { force: true });
      let saved: SavedExperiment;
      try {
        const parsed = SavedFile.parse(JSON.parse(readFileSync(join(dir, "view.json"), "utf8")));
        if (parsed.id !== name) throw new Error("its id isn't its folder's");
        saved = parsed as unknown as SavedExperiment;
      } catch (error) {
        this.log(`saved experiment ${name} can't be read (${(error as Error).message.slice(0, 120)}); cleared`);
        rmSync(dir, { recursive: true, force: true });
        continue;
      }
      if (saved.phase !== "done" && saved.phase !== "failed") {
        if (saved.status === "starting" || saved.status === "running") {
          // It was running when the node stopped: it ended then (its last complete write).
          const ended = Math.max(saved.startedAt, ...[saved.phases.testing, saved.phases.building].filter((t): t is number => t !== null));
          saved.status = "failed";
          saved.summary = "the node stopped before it finished";
          saved.endedAt ??= ended;
        }
        saved.phase = saved.status === "done" ? "done" : "failed";
        saved.phases.ended ??= saved.endedAt ?? saved.startedAt;
        this.saved.set(name, saved);
        this.writeView(saved);
      } else this.saved.set(name, saved);
      saved.bytes = this.measure(name);
    }
    this.enforce();
  }

  private measure(id: string): number {
    let bytes = 0;
    for (const file of ["view.json", "recording.jsonl", "readouts.jsonl", "code.txt"]) {
      try {
        bytes += statSync(this.path(id, file)).size;
      } catch {
        /* not there */
      }
    }
    return bytes;
  }

  // ---------- from the world ----------

  /** A new experiment: kept from its first moment. */
  begin(view: Fields): void {
    if (this.saved.has(view.id)) return this.update(view);
    const saved: SavedExperiment = {
      ...this.fields(view),
      pinned: false,
      bytes: 0,
      recording: { frames: 0, bytes: 0, hz: this.limits.recordingHz, thinned: false, rate: 1, t0: null, t1: null, bodies: view.scene.map((b) => b.id) },
      readouts: {},
      code: null,
    };
    const live: Live = {
      frames: new Thinned(7, this.limits.recordingHz, this.limits.recordingBytes),
      readouts: new Thinned(1, this.limits.readoutHz, this.limits.readoutBytes),
      bodies: new Map(saved.recording.bodies.map((id, i) => [id, i])),
      keys: new Map(),
      offset: 0,
      lastT: -Infinity,
      clock: null,
      dirty: false,
    };
    mkdirSync(this.path(view.id), { recursive: true, mode: 0o700 });
    this.saved.set(view.id, saved);
    this.live.set(view.id, live);
    this.writeView(saved);
    this.enforce();
  }

  /** What the hub knows of it (assembly poses and the build's span are the world's, not kept). */
  private fields(view: Fields): Omit<SavedExperiment, "pinned" | "bytes" | "recording" | "readouts" | "code"> {
    const { assembly: _assembly, build: _build, ...rest } = view;
    return { ...rest, scene: view.scene, metrics: { ...view.metrics } };
  }

  /** It changed (its scene once known, its status, its phase, its summary): written at once when that matters. */
  update(view: Fields): void {
    const saved = this.saved.get(view.id);
    if (!saved) return;
    const before = `${saved.status}|${saved.phase}|${saved.scene.length}|${saved.title}`;
    Object.assign(saved, this.fields(view));
    const live = this.live.get(view.id);
    if (live) {
      for (const b of view.scene) if (!live.bodies.has(b.id)) live.bodies.set(b.id, live.bodies.size);
      saved.recording.bodies = [...live.bodies.keys()];
      live.dirty = true;
    }
    if (`${saved.status}|${saved.phase}|${saved.scene.length}|${saved.title}` !== before || !live) {
      this.writeView(saved);
      if (!live) this.changed();
    }
  }

  /** Frames, as the hub accepted them: poses for the recording, readouts for their series. */
  record(id: string, frames: readonly { t: number; poses: Record<string, Pose>; metrics?: Record<string, number> }[], at: number): void {
    const saved = this.saved.get(id);
    const live = this.live.get(id);
    if (!saved || !live) return;
    for (const f of frames) {
      // Recordings run forwards: a simulation that starts its clock over carries on from where it was.
      let t = f.t + live.offset;
      if (t < live.lastT) {
        live.offset += live.lastT - t + 1 / this.limits.recordingHz;
        t = f.t + live.offset;
      }
      live.lastT = t;
      live.clock = live.clock ? { ...live.clock, t1: t, at1: at } : { t0: t, at0: at, t1: t, at1: at };
      const poses: [number, number[]][] = [];
      for (const body in f.poses) {
        const i = live.bodies.get(body);
        if (i === undefined) continue;
        const p = f.poses[body]!;
        poses.push([i, [round(p[0], 1e4), round(p[1], 1e4), round(p[2], 1e4), round(p[3], 1e4), round(p[4], 1e4), round(p[5], 1e4), round(p[6], 1e4)]]);
      }
      if (poses.length) live.frames.offer(t, poses);
      if (f.metrics) this.sample(saved, live, t, f.metrics);
    }
    live.dirty = true;
  }

  /** Readouts: their exact figures over every sample, and the thinned series. */
  private sample(saved: SavedExperiment, live: Live, t: number, metrics: Record<string, number>): void {
    const items: [number, number[]][] = [];
    for (const key in metrics) {
      const v = metrics[key]!;
      let k = live.keys.get(key);
      if (k === undefined) {
        // At most 48 different readouts an experiment (each frame may carry 24).
        if (live.keys.size >= 48) continue;
        k = live.keys.size;
        live.keys.set(key, k);
      }
      const s = saved.readouts[key];
      if (!s) saved.readouts[key] = { count: 1, min: v, max: v, tMin: t, tMax: t, first: [t, v], last: [t, v] };
      else {
        s.count++;
        if (v < s.min) [s.min, s.tMin] = [v, t];
        if (v > s.max) [s.max, s.tMax] = [v, t];
        s.last = [t, v];
      }
      items.push([k, [round(v, 1e6)]]);
    }
    if (items.length) live.readouts.offer(t, items);
  }

  /** The script that ran it (replacing any sent before). */
  setCode(id: string, name: string, source: string): void {
    const saved = this.saved.get(id);
    if (!saved) throw new ExperimentError(404, "no such experiment");
    const bytes = Buffer.byteLength(source);
    if (bytes > this.limits.codeBytes) throw new ExperimentError(413, `code is kept up to ${this.limits.codeBytes / KB} KB`);
    this.write(id, "code.txt", source);
    saved.code = { name, bytes };
    this.writeView(saved);
  }

  /** It ended: the last of its frames and readouts written, and it joins the saved ones. */
  finish(view: Fields): void {
    const saved = this.saved.get(view.id);
    if (!saved) return;
    Object.assign(saved, this.fields(view));
    const live = this.live.get(view.id);
    if (live) {
      live.frames.close();
      live.readouts.close();
      // A final readout the end gave (that frames didn't) is still a readout.
      const t = live.frames.last ?? (Number.isFinite(live.lastT) ? live.lastT : 0);
      const fresh = Object.entries(view.metrics).filter(([key, value]) => saved.readouts[key]?.last[1] !== value);
      if (fresh.length) this.sample(saved, live, t, Object.fromEntries(fresh));
      live.readouts.close();
      this.writeLive(saved, live);
      this.live.delete(view.id);
    }
    this.cache = null;
    this.enforce();
    this.changed();
  }

  /** Writes what the running ones gathered since the last time. */
  flush(): void {
    for (const [id, live] of this.live) {
      if (!live.dirty) continue;
      const saved = this.saved.get(id);
      if (saved) this.writeLive(saved, live);
    }
    this.enforce();
  }

  private writeLive(saved: SavedExperiment, live: Live): void {
    live.dirty = false;
    const rec = saved.recording;
    rec.frames = live.frames.count;
    rec.bytes = live.frames.bytes;
    rec.thinned = live.frames.thinned;
    rec.hz = 1 / live.frames.interval;
    rec.t0 = live.frames.first;
    rec.t1 = live.frames.last;
    const c = live.clock;
    // How fast it played live (simulation seconds a second), when it ran long enough to tell.
    rec.rate = c && c.at1 - c.at0 >= 1000 && c.t1 > c.t0 ? round((c.t1 - c.t0) / ((c.at1 - c.at0) / 1000), 1e3) : 1;
    this.write(saved.id, "recording.jsonl", live.frames.lines().join("\n"));
    this.write(saved.id, "readouts.jsonl", live.readouts.lines().join("\n"));
    this.writeView(saved);
  }

  private write(id: string, file: string, text: string): void {
    const path = this.path(id, file);
    try {
      writeFileSync(`${path}.tmp`, text, { mode: 0o600 });
      renameSync(`${path}.tmp`, path);
    } catch (error) {
      this.log(`saving experiment ${id}: ${(error as Error).message}`);
    }
  }

  private writeView(saved: SavedExperiment): void {
    if (!existsSync(this.path(saved.id))) mkdirSync(this.path(saved.id), { recursive: true, mode: 0o700 });
    this.write(saved.id, "view.json", JSON.stringify(saved));
    saved.bytes = this.measure(saved.id);
  }

  // ---------- the budget ----------

  /** Over the budget (or the count): the oldest unpinned ended ones go, until it fits. */
  private enforce(): void {
    let total = 0;
    for (const s of this.saved.values()) total += s.bytes;
    if (total <= this.limits.budgetBytes && this.saved.size <= this.limits.count) return;
    const candidates = [...this.saved.values()].filter((s) => !s.pinned && !this.live.has(s.id)).sort((a, b) => a.startedAt - b.startedAt);
    let count = this.saved.size;
    let evicted = 0;
    for (const s of candidates) {
      if (total <= this.limits.budgetBytes && count <= this.limits.count) break;
      total -= s.bytes;
      count--;
      evicted++;
      this.drop(s.id);
    }
    if (evicted) {
      this.log(`cleared ${evicted} old saved experiment(s) to stay within ${Math.round(this.limits.budgetBytes / MB)} MB`);
      this.changed();
    }
  }

  private drop(id: string): void {
    this.saved.delete(id);
    this.live.delete(id);
    if (this.cache?.id === id) this.cache = null;
    rmSync(this.path(id), { recursive: true, force: true });
  }

  // ---------- reading ----------

  get(id: string): SavedExperiment | null {
    const saved = ID.test(id) ? this.saved.get(id) : undefined;
    return saved ? structuredClone(saved) : null;
  }

  isLive(id: string): boolean {
    return this.live.has(id);
  }

  /** Newest first, at most `limit`, with the totals. */
  listing(limit = 200): { experiments: SavedSummary[]; total: number; bytes: number; budget: number; pinnedBudget: number } {
    const all = [...this.saved.values()].sort((a, b) => b.startedAt - a.startedAt);
    return {
      experiments: all.slice(0, limit).map(summaryOf),
      total: all.length,
      bytes: all.reduce((sum, s) => sum + s.bytes, 0),
      budget: this.limits.budgetBytes,
      pinnedBudget: this.limits.pinnedBytes,
    };
  }

  /** The newest that have ended (what the world offers to replay). */
  recent(limit: number): SavedSummary[] {
    return [...this.saved.values()]
      .filter((s) => (s.phase === "done" || s.phase === "failed") && !this.live.has(s.id))
      .sort((a, b) => (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt))
      .slice(0, limit)
      .map(summaryOf);
  }

  /** Each readout's stored series, by name. */
  private series(saved: SavedExperiment): Record<string, [number, number][]> {
    const live = this.live.get(saved.id);
    const lines = live ? live.readouts.lines() : this.readLines(saved.id, "readouts.jsonl");
    const names = Object.keys(saved.readouts);
    const out: Record<string, [number, number][]> = {};
    for (const name of names) out[name] = [];
    for (const line of lines) {
      const row = parseRow(line);
      if (!row) continue;
      const t = row[0]!;
      for (let i = 1; i + 1 < row.length; i += 2) {
        const name = names[row[i]!];
        if (name !== undefined) out[name]!.push([t, row[i + 1]!]);
      }
    }
    return out;
  }

  private readLines(id: string, file: string): string[] {
    try {
      return readFileSync(this.path(id, file), "utf8").split("\n");
    } catch {
      return [];
    }
  }

  /** What it showed: computed from what's kept (and cached once it has ended). */
  examination(id: string): Examination | null {
    const saved = ID.test(id) ? this.saved.get(id) : undefined;
    if (!saved) return null;
    if (!this.live.has(id) && this.cache?.id === id && this.cache.bytes === saved.bytes && this.cache.examination) return this.cache.examination;
    const examination = examine(saved, this.series(saved));
    if (!this.live.has(id)) this.cache = { id, bytes: saved.bytes, recording: this.cache?.id === id ? this.cache.recording : null, examination };
    return examination;
  }

  code(id: string): { name: string; source: string } | null {
    const saved = ID.test(id) ? this.saved.get(id) : undefined;
    if (!saved?.code) return null;
    try {
      return { name: saved.code.name, source: readFileSync(this.path(id, "code.txt"), "utf8") };
    } catch {
      return null;
    }
  }

  /** A page of its recording, from frame `from`: at most `limit` frames, or about pageBytes. */
  recording(id: string, from = 0, limit = 2000): RecordingPage | null {
    const saved = ID.test(id) ? this.saved.get(id) : undefined;
    if (!saved) return null;
    const live = this.live.get(id);
    let lines: string[];
    if (live) lines = live.frames.lines();
    else if (this.cache?.id === id && this.cache.bytes === saved.bytes && this.cache.recording) lines = this.cache.recording;
    else {
      lines = this.readLines(id, "recording.jsonl").filter(Boolean);
      this.cache = { id, bytes: saved.bytes, recording: lines, examination: this.cache?.id === id ? this.cache.examination : null };
    }
    const frames: number[][] = [];
    let bytes = 0;
    let i = from;
    for (; i < lines.length && frames.length < limit && bytes < this.limits.pageBytes; i++) {
      const row = parseRow(lines[i]!);
      bytes += lines[i]!.length + 1;
      if (row) frames.push(row);
    }
    const r = saved.recording;
    return { id, bodies: r.bodies, rate: r.rate, t0: r.t0, t1: r.t1, total: lines.length, from, frames, next: i < lines.length ? i : null };
  }

  // ---------- yours ----------

  pin(id: string, pinned: boolean): SavedSummary {
    const saved = ID.test(id) ? this.saved.get(id) : undefined;
    if (!saved) throw new ExperimentError(404, "no such saved experiment");
    if (pinned && !saved.pinned) {
      const held = [...this.saved.values()].filter((s) => s.pinned).reduce((sum, s) => sum + s.bytes, 0);
      if (held + saved.bytes > this.limits.pinnedBytes) throw new ExperimentError(409, `pinned experiments may take ${Math.round(this.limits.pinnedBytes / MB)} MB at most; unpin one first`);
    }
    saved.pinned = pinned;
    this.writeView(saved);
    this.changed();
    return summaryOf(saved);
  }

  remove(id: string): boolean {
    if (!ID.test(id) || !this.saved.has(id)) return false;
    if (this.live.has(id)) throw new ExperimentError(409, "it's still running; it can be deleted once it has ended");
    this.drop(id);
    this.changed();
    return true;
  }

  close(): void {
    clearInterval(this.timer);
    this.flush();
    this.listeners.clear();
  }
}
