import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  type Examination,
  examine,
  experimentText,
  type ExperimentPhase,
  type ExperimentView,
  padAt,
  type PhaseTimes,
  placeWords,
  type Pose,
  type RecordingPage,
  type SavedExperiment,
  type SavedSummary,
  type SceneBody,
  summaryOf,
  type Truncation,
} from "@galahad/core";
import { z } from "zod";

/*
 * The experiment archive, on the node that ran them: ~/.galahad/experiments/<id>/
 *   view.json                 what it was, how it went (status, phases and their times, summary), where
 *                             (node, sandbox), each readout's exact figures, its recording's index;
 *                             written whole and atomically
 *   scene.json                its bodies, meshes included, exactly as the simulation sent them (its model)
 *   frames/NNNNNN.jsonl.gz    every frame the node received, in order: one line a frame,
 *                             [t, i, x, y, z, qw, qx, qy, qz, i, …] (i: the body's place in recording.bodies)
 *   readouts/NNNNNN.jsonl.gz  every readout sample: [t, k, value, k, value, …] (k: its place among the
 *                             readouts, in the order they were first sent)
 *   code.txt                  the script that ran it, when it was sent
 *
 * Every experiment is kept, complete and for good: nothing is cleared to make room, and only the owner
 * deletes one (the deleteExperiment route). Frames and readouts are gzipped a chunk at a time (about 2 MB
 * of text each), so the archive stays small and a running experiment holds at most a chunk of each in
 * memory. One limit, for safety only: a runaway simulation's recording stops at a size no real one
 * reaches (recordingBytes, readoutBytes), and the record says where. Node-local: never in the mind.
 *
 * For a general archive (R2, a semantic index): archiveSince lists every finished experiment after a
 * cursor, oldest first, in a stable order; archiveEntry gives one's files (each with its role) and a
 * plain-text description of it. Nothing else about this layout needs knowing.
 */

const KB = 1024;
const MB = 1024 * KB;

export interface ExperimentLimits {
  /** Safety limits against a runaway simulation, in bytes of text before compression: past one, that stream stops being kept and the record says where. */
  recordingBytes: number;
  readoutBytes: number;
  /** The script kept with it. */
  codeBytes: number;
  /** A chunk of frames or readouts, before compression. */
  chunkBytes: number;
  /** How often a running experiment's open chunks are written. */
  flushMs: number;
  /** A page of a recording, about this many bytes of text. */
  pageBytes: number;
  /** The most points of one readout the examination reads (an even share of a longer one, its extremes always among them). */
  seriesPoints: number;
}

/*
 * The figures, and why.
 * - 256 MB of frames and 64 MB of readouts (as text; gzip makes it a fifth to a tenth on disk): a frame
 *   is about 75 bytes a moving body, so that's 2 hours of a 10-body rig at 60 frames a second, or the
 *   500-body maximum at 60 for two minutes; readouts likewise. Real experiments are kilobytes to a few
 *   megabytes. Only something that runs away reaches them, and then it's said.
 * - 2 MB chunks: what a running experiment holds in memory per stream, and what a replay's page reads.
 * - 64 KB of code: one script, which is all the module sends.
 */
export const EXPERIMENT_LIMITS: ExperimentLimits = {
  recordingBytes: 256 * MB,
  readoutBytes: 64 * MB,
  codeBytes: 64 * KB,
  chunkBytes: 2 * MB,
  flushMs: 5_000,
  pageBytes: 512 * KB,
  seriesPoints: 20_000,
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
const chunkName = (stream: "frames" | "readouts", i: number) => `${stream}/${String(i).padStart(6, "0")}.jsonl.gz`;

/** One chunk of a stream on disk: its lines, the simulation times it covers, its size as text and gzipped. */
interface Chunk {
  lines: number;
  t0: number;
  t1: number;
  raw: number;
  bytes: number;
}

/** What view.json holds: the saved experiment (its scene is scene.json), its place in the archive's order, its chunks. */
type Kept = Omit<SavedExperiment, "scene"> & { seq: number | null; chunks: { frames: Chunk[]; readouts: Chunk[] } };

/**
 * A stream (frames or readouts) as it's written: closed chunks on disk, the open one in memory (written
 * whole at every flush, closed once it's a chunk's size), and its safety limit.
 */
class Stream {
  private open: { lines: string[]; raw: number; t0: number; t1: number } | null = null;
  /** The open chunk as last written (on disk, not yet closed). */
  private written: Chunk | null = null;
  raw = 0;
  truncated: Truncation | null = null;
  dirty = false;
  readonly chunks: Chunk[] = [];

  constructor(
    private readonly dir: string,
    private readonly stream: "frames" | "readouts",
    private readonly limit: number,
    private readonly chunkBytes: number,
  ) {}

  /** A line at time t; false (and the stream stops for good) once its safety limit is reached. */
  append(t: number, line: string): boolean {
    if (this.truncated) return false;
    if (this.raw + line.length + 1 > this.limit) {
      this.truncated = { t, limit: this.limit };
      this.dirty = true;
      return false;
    }
    const open = (this.open ??= { lines: [], raw: 0, t0: t, t1: t });
    open.lines.push(line);
    open.raw += line.length + 1;
    open.t1 = t;
    this.raw += line.length + 1;
    this.dirty = true;
    return true;
  }

  get lines(): number {
    return this.chunks.reduce((n, c) => n + c.lines, 0) + (this.open?.lines.length ?? 0);
  }

  /** The open chunk's lines (the newest, not yet in a closed chunk). */
  get pending(): string[] {
    return this.open?.lines ?? [];
  }

  /** The open chunk to disk (gzipped, atomically); closed once it's big enough, or `last`. */
  flush(write: (file: string, data: Uint8Array) => number, last: boolean): void {
    this.dirty = false;
    const open = this.open;
    if (!open?.lines.length) return;
    const bytes = write(join(this.dir, chunkName(this.stream, this.chunks.length)), gzipSync(open.lines.join("\n")));
    const chunk: Chunk = { lines: open.lines.length, t0: open.t0, t1: open.t1, raw: open.raw, bytes };
    if (last || open.raw >= this.chunkBytes) {
      this.chunks.push(chunk);
      this.open = null;
      this.written = null;
    } else this.written = chunk;
  }

  /** Its chunks as the index records them: the closed ones, and the open one as last written. */
  index(): Chunk[] {
    return this.open && this.written ? [...this.chunks, this.written] : [...this.chunks];
  }
}

const PHASES = ["building", "testing", "examining", "done", "failed"] as const;
const Finite = z.number().finite();
const ChunkSchema = z.looseObject({ lines: z.number().int().min(0), t0: Finite, t1: Finite, raw: z.number().min(0), bytes: z.number().min(0) });
const TruncationSchema = z.looseObject({ t: Finite, limit: Finite }).nullable();
/** view.json as read back: what must be there, loosely (a newer node may write more). */
const KeptFile = z.looseObject({
  id: z.string().regex(ID),
  title: z.string().max(500),
  engine: z.string().max(32),
  status: z.enum(["starting", "running", "done", "failed"]),
  phase: z.enum(PHASES),
  phases: z.looseObject({ building: Finite, testing: Finite.nullable(), examining: Finite.nullable(), ended: Finite.nullable() }),
  plot: z.looseObject({ x: Finite, y: Finite, size: Finite }),
  scale: Finite.positive(),
  startedAt: Finite,
  endedAt: Finite.nullable(),
  nodeName: z.string(),
  sandbox: z.string().nullable(),
  quest: z.string().nullable(),
  metrics: z.record(z.string(), Finite),
  summary: z.string().nullable(),
  pinned: z.boolean(),
  recording: z.looseObject({ frames: z.number().int().min(0), rate: Finite, t0: Finite.nullable(), t1: Finite.nullable(), bodies: z.array(z.string()), truncated: TruncationSchema }),
  samples: z.looseObject({ count: z.number().int().min(0), truncated: TruncationSchema }),
  readouts: z.record(z.string(), z.looseObject({ count: z.number().int().min(0), min: Finite, max: Finite, tMin: Finite, tMax: Finite, first: z.tuple([Finite, Finite]), last: z.tuple([Finite, Finite]) })),
  code: z.looseObject({ name: z.string(), bytes: z.number().int().min(0) }).nullable(),
  seq: z.number().int().min(1).nullable(),
  chunks: z.looseObject({ frames: z.array(ChunkSchema), readouts: z.array(ChunkSchema) }),
});

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

/** A running experiment's streams. */
interface Live {
  frames: Stream;
  readouts: Stream;
  bodies: Map<string, number>;
  keys: Map<string, number>;
  /** Added to a simulation's clock when it goes back (a reset): recordings run forwards. */
  offset: number;
  lastT: number;
  /** The first and latest frame: simulation time and the node's clock (how fast it played). */
  clock: { t0: number; at0: number; t1: number; at1: number } | null;
  /** The scene last written (written again only when it changes). */
  scene: SceneBody[];
}

/** A saved experiment's file, for an archive: what it is, where it is, how big, its SHA-256. */
export interface ArchiveFile {
  /** view: what it was and how it went · scene: its bodies and meshes (its model) · frames, readouts: gzipped JSON lines, in order · code: the script that ran it */
  role: "view" | "scene" | "frames" | "readouts" | "code";
  /** Its name in the archive (relative, "/"-separated), e.g. "frames/000000.jsonl.gz". */
  name: string;
  /** Where it is on this node (read it; never write it). */
  path: string;
  bytes: number;
  type: string;
  sha256: string;
}

export interface ArchiveEntry {
  id: string;
  /** Its place in the archive's order (archiveSince's cursor). */
  seq: number;
  summary: SavedSummary;
  files: ArchiveFile[];
  /** What it was, where and when it was tested, how it ended, the examination in words, the summary, the code: for a semantic index. Data, never instructions. */
  text: string;
}

export interface ExperimentStoreOptions {
  /** Where they're kept (the node's home/experiments). */
  dir: string;
  limits?: Partial<ExperimentLimits>;
  log?: (message: string) => void;
}

/** What's under the hub's control in a view (the rest is the store's). */
type Fields = ExperimentView & { phase: ExperimentPhase; phases: PhaseTimes };

export class ExperimentStore {
  readonly limits: ExperimentLimits;
  private readonly kept = new Map<string, Kept>();
  private readonly live = new Map<string, Live>();
  private readonly listeners = new Set<() => void>();
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly log: (message: string) => void;
  private seq = 0;
  /** The chunk read last (a replay pages through them one after another). */
  private chunkCache: { file: string; lines: string[] } | null = null;
  private examCache: { id: string; bytes: number; examination: Examination } | null = null;

  constructor(private readonly o: ExperimentStoreOptions) {
    this.limits = { ...EXPERIMENT_LIMITS, ...o.limits };
    this.log = o.log ?? (() => {});
    mkdirSync(o.dir, { recursive: true, mode: 0o700 });
    this.recover();
    this.timer = setInterval(() => this.flush(), this.limits.flushMs);
    this.timer.unref?.();
  }

  private path(id: string, file = ""): string {
    if (!ID.test(id)) throw new ExperimentError(400, "not an experiment id");
    return join(this.o.dir, id, file);
  }

  /** The list of saved ones changed (one finished, was pinned or deleted): tell whoever shows it. */
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

  /**
   * Everything on disk, checked. What was running when the node stopped ended then, failed, and is
   * archived as it was. What can't be read is left where it is, untouched (it's the owner's to delete),
   * and said.
   */
  private recover(): void {
    const unfinished: Kept[] = [];
    for (const name of readdirSync(this.o.dir)) {
      if (!ID.test(name)) continue;
      const dir = join(this.o.dir, name);
      rmSync(join(dir, "view.json.tmp"), { force: true });
      let kept: Kept;
      try {
        const parsed = KeptFile.parse(JSON.parse(readFileSync(join(dir, "view.json"), "utf8")));
        if (parsed.id !== name) throw new Error("its id isn't its folder's");
        kept = parsed as unknown as Kept;
      } catch (error) {
        this.log(`saved experiment ${name} can't be read (${(error as Error).message.slice(0, 120)}); left as it is`);
        continue;
      }
      this.kept.set(name, kept);
      if (kept.seq !== null) this.seq = Math.max(this.seq, kept.seq);
      if (kept.phase !== "done" && kept.phase !== "failed") unfinished.push(kept);
      kept.bytes = this.measure(name);
    }
    // In the order they started, after everything already in the archive's order.
    for (const kept of unfinished.sort((a, b) => a.startedAt - b.startedAt)) {
      if (kept.status === "starting" || kept.status === "running") {
        const last = Math.max(kept.startedAt, ...[kept.phases.testing, kept.phases.building].filter((t): t is number => t !== null));
        kept.status = "failed";
        kept.summary = "the node stopped before it finished";
        kept.endedAt ??= last;
      }
      kept.phase = kept.status === "done" ? "done" : "failed";
      kept.phases.ended ??= kept.endedAt ?? kept.startedAt;
      kept.seq ??= ++this.seq;
      this.writeView(kept);
    }
  }

  private measure(id: string): number {
    let bytes = 0;
    const walk = (d: string) => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(join(d, entry.name));
        else bytes += statSync(join(d, entry.name)).size;
      }
    };
    try {
      walk(this.path(id));
    } catch {
      /* gone */
    }
    return bytes;
  }

  // ---------- from the world ----------

  /** A new experiment: kept from its first moment. */
  begin(view: Fields): void {
    if (this.kept.has(view.id)) return this.update(view);
    const kept: Kept = {
      ...this.fields(view),
      pinned: false,
      bytes: 0,
      recording: { frames: 0, bytes: 0, rate: 1, t0: null, t1: null, bodies: view.scene.map((b) => b.id), truncated: null },
      samples: { count: 0, truncated: null },
      readouts: {},
      code: null,
      seq: null,
      chunks: { frames: [], readouts: [] },
    };
    for (const sub of ["", "frames", "readouts"]) mkdirSync(this.path(view.id, sub), { recursive: true, mode: 0o700 });
    this.live.set(view.id, {
      frames: new Stream(this.path(view.id), "frames", this.limits.recordingBytes, this.limits.chunkBytes),
      readouts: new Stream(this.path(view.id), "readouts", this.limits.readoutBytes, this.limits.chunkBytes),
      bodies: new Map(kept.recording.bodies.map((id, i) => [id, i])),
      keys: new Map(),
      offset: 0,
      lastT: -Infinity,
      clock: null,
      scene: view.scene,
    });
    this.kept.set(view.id, kept);
    this.writeScene(view.id, view.scene);
    this.writeView(kept);
  }

  /** What the hub knows of it, but its scene (that's scene.json) and the world's own (assembly poses, the build's span). */
  private fields(view: Fields): Omit<Kept, "pinned" | "bytes" | "recording" | "samples" | "readouts" | "code" | "seq" | "chunks"> {
    const { assembly: _assembly, build: _build, scene: _scene, ...rest } = view;
    return { ...rest, metrics: { ...view.metrics }, phases: { ...view.phases } };
  }

  /** It changed (its scene once known, its status, its phase, its summary): written at once when that matters. */
  update(view: Fields): void {
    const kept = this.kept.get(view.id);
    if (!kept) return;
    const before = `${kept.status}|${kept.phase}|${kept.title}|${kept.sandbox}`;
    Object.assign(kept, this.fields(view));
    const live = this.live.get(view.id);
    if (live && view.scene !== live.scene) {
      live.scene = view.scene;
      for (const b of view.scene) if (!live.bodies.has(b.id)) live.bodies.set(b.id, live.bodies.size);
      kept.recording.bodies = [...live.bodies.keys()];
      this.writeScene(view.id, view.scene);
    }
    // Finished (examined): its place in the archive's order.
    if (!live && (kept.phase === "done" || kept.phase === "failed") && kept.seq === null) kept.seq = ++this.seq;
    if (`${kept.status}|${kept.phase}|${kept.title}|${kept.sandbox}` !== before || !live) {
      this.writeView(kept);
      if (!live) this.changed();
    }
  }

  /** Frames, every one the hub received: poses for the recording, readouts for their series. */
  record(id: string, frames: readonly { t: number; poses: Record<string, Pose>; metrics?: Record<string, number> }[], at: number): void {
    const kept = this.kept.get(id);
    const live = this.live.get(id);
    if (!kept || !live) return;
    for (const f of frames) {
      // Recordings run forwards: a simulation that starts its clock over carries on from where it was.
      let t = f.t + live.offset;
      if (t < live.lastT) {
        live.offset += live.lastT - t;
        t = f.t + live.offset;
      }
      live.lastT = t;
      const row: number[] = [t];
      for (const body in f.poses) {
        const i = live.bodies.get(body);
        if (i !== undefined) row.push(i, ...f.poses[body]!);
      }
      if (row.length > 1 && live.frames.append(t, JSON.stringify(row))) {
        live.clock = live.clock ? { ...live.clock, t1: t, at1: at } : { t0: t, at0: at, t1: t, at1: at };
        kept.recording.frames++;
      }
      if (f.metrics) this.sample(kept, live, t, f.metrics);
    }
  }

  /** Readouts: their exact figures over every sample, and every sample kept. */
  private sample(kept: Kept, live: Live, t: number, metrics: Record<string, number>): void {
    const row: number[] = [t];
    for (const key in metrics) {
      const v = metrics[key]!;
      let k = live.keys.get(key);
      if (k === undefined) {
        // At most 48 different readouts an experiment (each frame may carry 24).
        if (live.keys.size >= 48) continue;
        k = live.keys.size;
        live.keys.set(key, k);
      }
      const s = kept.readouts[key];
      if (!s) kept.readouts[key] = { count: 1, min: v, max: v, tMin: t, tMax: t, first: [t, v], last: [t, v] };
      else {
        s.count++;
        if (v < s.min) [s.min, s.tMin] = [v, t];
        if (v > s.max) [s.max, s.tMax] = [v, t];
        s.last = [t, v];
      }
      row.push(k, v);
    }
    if (row.length > 1 && live.readouts.append(t, JSON.stringify(row))) kept.samples.count++;
  }

  /** The script that ran it (replacing any sent before). */
  setCode(id: string, name: string, source: string): void {
    const kept = this.kept.get(id);
    if (!kept) throw new ExperimentError(404, "no such experiment");
    const bytes = Buffer.byteLength(source);
    if (bytes > this.limits.codeBytes) throw new ExperimentError(413, `code is kept up to ${this.limits.codeBytes / KB} KB`);
    this.write(this.path(id, "code.txt"), Buffer.from(source));
    kept.code = { name, bytes };
    this.writeView(kept);
  }

  /** It ended: the last of its frames and readouts written. */
  finish(view: Fields): void {
    const kept = this.kept.get(view.id);
    if (!kept) return;
    Object.assign(kept, this.fields(view));
    const live = this.live.get(view.id);
    if (live) {
      // A final readout the end gave (that frames didn't) is still a readout.
      const last = (key: string) => kept.readouts[key]?.last[1];
      const fresh = Object.entries(view.metrics).filter(([key, value]) => last(key) === undefined || Math.abs(last(key)! - value) > 1e-6 * Math.max(1, Math.abs(value)));
      if (fresh.length) this.sample(kept, live, Number.isFinite(live.lastT) ? live.lastT : 0, Object.fromEntries(fresh));
      this.writeLive(kept, live, true);
      this.live.delete(view.id);
    }
    if ((kept.phase === "done" || kept.phase === "failed") && kept.seq === null) kept.seq = ++this.seq;
    this.writeView(kept);
    this.examCache = null;
    this.changed();
  }

  /** Writes what the running ones gathered since the last time. */
  flush(): void {
    for (const [id, live] of this.live) {
      const kept = this.kept.get(id);
      if (kept && (live.frames.dirty || live.readouts.dirty)) this.writeLive(kept, live, false);
    }
  }

  private writeLive(kept: Kept, live: Live, last: boolean): void {
    const write = (file: string, data: Uint8Array) => this.write(file, data);
    live.frames.flush(write, last);
    live.readouts.flush(write, last);
    kept.chunks = { frames: live.frames.index(), readouts: live.readouts.index() };
    const rec = kept.recording;
    rec.truncated = live.frames.truncated;
    kept.samples.truncated = live.readouts.truncated;
    const frames = kept.chunks.frames;
    rec.t0 = frames[0]?.t0 ?? null;
    rec.t1 = frames.at(-1)?.t1 ?? null;
    rec.bytes = frames.reduce((n, c) => n + c.bytes, 0);
    const c = live.clock;
    // How fast it played live (simulation seconds a second), when it ran long enough to tell.
    rec.rate = c && c.at1 - c.at0 >= 1000 && c.t1 > c.t0 ? Math.round(((c.t1 - c.t0) / ((c.at1 - c.at0) / 1000)) * 1000) / 1000 : 1;
    this.writeView(kept);
  }

  /** Whole and atomic. Returns the bytes written (0 if it couldn't be: logged, and the world carries on). */
  private write(path: string, data: Uint8Array): number {
    try {
      writeFileSync(`${path}.tmp`, data, { mode: 0o600 });
      renameSync(`${path}.tmp`, path);
      return data.length;
    } catch (error) {
      this.log(`saving an experiment: ${(error as Error).message}`);
      return 0;
    }
  }

  private writeScene(id: string, scene: SceneBody[]): void {
    this.write(this.path(id, "scene.json"), Buffer.from(JSON.stringify(scene)));
  }

  private writeView(kept: Kept): void {
    if (!existsSync(this.path(kept.id))) mkdirSync(this.path(kept.id), { recursive: true, mode: 0o700 });
    this.write(this.path(kept.id, "view.json"), Buffer.from(JSON.stringify(kept)));
    kept.bytes = this.measure(kept.id);
  }

  // ---------- reading ----------

  private scene(id: string): SceneBody[] {
    const live = this.live.get(id);
    if (live) return live.scene;
    try {
      const scene = JSON.parse(readFileSync(this.path(id, "scene.json"), "utf8")) as unknown;
      return Array.isArray(scene) ? (scene as SceneBody[]) : [];
    } catch {
      return [];
    }
  }

  /** It, whole (its scene too), as the routes give it. */
  get(id: string): SavedExperiment | null {
    const kept = ID.test(id) ? this.kept.get(id) : undefined;
    if (!kept) return null;
    const { seq: _seq, chunks: _chunks, ...saved } = structuredClone(kept);
    return { ...saved, scene: this.scene(id) };
  }

  /** The saved experiment without its scene (lists, summaries, the examination). */
  private bare(kept: Kept): SavedExperiment {
    const { seq: _seq, chunks: _chunks, ...saved } = kept;
    return { ...saved, scene: [] };
  }

  isLive(id: string): boolean {
    return this.live.has(id);
  }

  /** Newest first, at most `limit`, with the totals. */
  listing(limit = 200): { experiments: SavedSummary[]; total: number; bytes: number } {
    const all = [...this.kept.values()].sort((a, b) => b.startedAt - a.startedAt);
    return { experiments: all.slice(0, limit).map((k) => summaryOf(this.bare(k))), total: all.length, bytes: all.reduce((n, k) => n + k.bytes, 0) };
  }

  /** The ended ones to offer for a replay: the owner's favourites first, then the newest. */
  recent(limit: number): SavedSummary[] {
    return [...this.kept.values()]
      .filter((k) => (k.phase === "done" || k.phase === "failed") && !this.live.has(k.id))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt))
      .slice(0, limit)
      .map((k) => summaryOf(this.bare(k)));
  }

  /** A stream's lines, chunk by chunk from `fromChunk` (a running one's open chunk from memory). */
  private *lines(id: string, stream: "frames" | "readouts", fromChunk = 0): Generator<string[]> {
    const live = this.live.get(id);
    const chunks = live ? live[stream].chunks : this.kept.get(id)!.chunks[stream];
    for (let i = fromChunk; i < chunks.length; i++) yield this.readChunk(this.path(id, chunkName(stream, i)));
    if (live && fromChunk <= chunks.length && live[stream].pending.length) yield live[stream].pending;
  }

  private readChunk(file: string): string[] {
    if (this.chunkCache?.file === file) return this.chunkCache.lines;
    let lines: string[] = [];
    try {
      lines = gunzipSync(readFileSync(file)).toString("utf8").split("\n");
    } catch {
      this.log(`a saved experiment's chunk can't be read: …${file.slice(-48)}`);
    }
    this.chunkCache = { file, lines };
    return lines;
  }

  /** Each readout's series for the examination: every sample, or an even share of a very long one (its extremes and its last among them). */
  private series(kept: Kept): Record<string, [number, number][]> {
    const names = Object.keys(kept.readouts);
    const out: Record<string, [number, number][]> = {};
    const seen = names.map(() => 0);
    const stride = names.map((n) => Math.max(1, Math.ceil(kept.readouts[n]!.count / this.limits.seriesPoints)));
    for (const name of names) out[name] = [];
    for (const lines of this.lines(kept.id, "readouts")) {
      for (const line of lines) {
        const row = parseRow(line);
        if (!row) continue;
        const t = row[0]!;
        for (let i = 1; i + 1 < row.length; i += 2) {
          const k = row[i]!;
          const name = names[k];
          if (name === undefined) continue;
          const s = kept.readouts[name]!;
          const n = seen[k]!++;
          if (n % stride[k]! === 0 || t === s.tMin || t === s.tMax || n === s.count - 1) out[name]!.push([t, row[i + 1]!]);
        }
      }
    }
    return out;
  }

  /** What it showed: computed from what's kept (and cached once it has ended). */
  examination(id: string): Examination | null {
    const kept = ID.test(id) ? this.kept.get(id) : undefined;
    if (!kept) return null;
    if (!this.live.has(id) && this.examCache?.id === id && this.examCache.bytes === kept.bytes) return this.examCache.examination;
    const examination = examine(this.bare(kept), this.series(kept));
    if (!this.live.has(id)) this.examCache = { id, bytes: kept.bytes, examination };
    return examination;
  }

  code(id: string): { name: string; source: string } | null {
    const kept = ID.test(id) ? this.kept.get(id) : undefined;
    if (!kept?.code) return null;
    try {
      return { name: kept.code.name, source: readFileSync(this.path(id, "code.txt"), "utf8") };
    } catch {
      return null;
    }
  }

  /**
   * A page of its recording from frame `from`: at most `limit` frames, or about pageBytes. With `hz`, a
   * replay's view of it: at most that many frames a second of simulation, each carrying what moved in the
   * frames it stands for (the record itself keeps every frame).
   */
  recording(id: string, from = 0, limit = 2000, hz?: number): RecordingPage | null {
    const kept = ID.test(id) ? this.kept.get(id) : undefined;
    if (!kept) return null;
    const live = this.live.get(id);
    const chunks = live ? live.frames.chunks : kept.chunks.frames;
    const total = live ? live.frames.lines : chunks.reduce((n, c) => n + c.lines, 0);
    // Straight to the chunk `from` is in.
    let first = 0;
    let index = 0;
    while (first < chunks.length && index + chunks[first]!.lines <= from) index += chunks[first++]!.lines;
    const frames: number[][] = [];
    const interval = hz ? 1 / hz : 0;
    let pending: Map<number, number[]> | null = null;
    let pendingT = 0;
    let lastKept = -Infinity;
    let bytes = 0;
    let next: number | null = null;
    const emit = () => {
      const row = [pendingT];
      for (const [k, v] of pending!) row.push(k, ...v);
      frames.push(row);
      lastKept = pendingT;
      pending = null;
    };
    outer: for (const lines of this.lines(id, "frames", first)) {
      for (const line of lines) {
        if (!line) continue;
        const at = index++;
        if (at < from) continue;
        if (frames.length >= limit || bytes >= this.limits.pageBytes) {
          next = at;
          break outer;
        }
        bytes += line.length + 1;
        const row = parseRow(line);
        if (!row) continue;
        if (!interval) {
          frames.push(row);
          continue;
        }
        pending ??= new Map();
        for (let j = 1; j + 7 < row.length; j += 8) pending.set(row[j]!, row.slice(j + 1, j + 8));
        pendingT = row[0]!;
        if (pendingT - lastKept >= interval - 1e-9) emit();
      }
    }
    if (pending) emit();
    const r = kept.recording;
    return { id, bodies: r.bodies, rate: r.rate, t0: r.t0, t1: r.t1, total, from, frames, next };
  }

  // ---------- for a general archive ----------

  /**
   * Every finished experiment (examined, done or failed, its files complete) after `cursor`, oldest first,
   * in the order they were finished: a stable order, so an archive takes each once by keeping the cursor it
   * was given last (null: from the beginning). One the owner deleted since isn't listed.
   */
  archiveSince(cursor: string | null, limit = 100): { experiments: (SavedSummary & { seq: number })[]; cursor: string | null } {
    const after = cursor === null ? 0 : Number(cursor);
    if (!Number.isInteger(after) || after < 0) throw new ExperimentError(400, "not an archive cursor");
    const items = [...this.kept.values()]
      .filter((k): k is Kept & { seq: number } => k.seq !== null && k.seq > after && !this.live.has(k.id))
      .sort((a, b) => a.seq - b.seq)
      .slice(0, Math.max(1, Math.min(1000, limit)));
    return { experiments: items.map((k) => ({ ...summaryOf(this.bare(k)), seq: k.seq })), cursor: items.length ? String(items.at(-1)!.seq) : cursor };
  }

  /** One finished experiment for an archive: its files (each with its role and SHA-256) and the plain text of it, for an index. */
  archiveEntry(id: string): ArchiveEntry | null {
    const kept = ID.test(id) ? this.kept.get(id) : undefined;
    if (!kept || kept.seq === null || this.live.has(id)) return null;
    const file = (role: ArchiveFile["role"], name: string, type: string): ArchiveFile | null => {
      const path = this.path(id, name);
      try {
        const data = readFileSync(path);
        return { role, name, path, bytes: data.length, type, sha256: createHash("sha256").update(data).digest("hex") };
      } catch {
        return null;
      }
    };
    const chunks = (stream: "frames" | "readouts") => kept.chunks[stream].map((_, i) => file(stream, chunkName(stream, i), "application/gzip"));
    const files = [
      file("view", "view.json", "application/json"),
      file("scene", "scene.json", "application/json"),
      ...chunks("frames"),
      ...chunks("readouts"),
      kept.code ? file("code", "code.txt", "text/plain; charset=utf-8") : null,
    ].filter((f): f is ArchiveFile => f !== null);
    const saved = this.get(id)!;
    return { id, seq: kept.seq, summary: summaryOf(saved), files, text: experimentText(saved, this.examination(id), this.code(id), placeWords(padAt(saved.plot))) };
  }

  // ---------- the owner's ----------

  /** A favourite (offered first to replay); nothing else. */
  pin(id: string, pinned: boolean): SavedSummary {
    const kept = ID.test(id) ? this.kept.get(id) : undefined;
    if (!kept) throw new ExperimentError(404, "no such saved experiment");
    kept.pinned = pinned;
    this.writeView(kept);
    this.changed();
    return summaryOf(this.bare(kept));
  }

  /** Gone for good: only the owner asks for this (the deleteExperiment route). */
  remove(id: string): boolean {
    if (!ID.test(id) || !this.kept.has(id)) return false;
    if (this.live.has(id)) throw new ExperimentError(409, "it's still running; it can be deleted once it has ended");
    this.kept.delete(id);
    if (this.examCache?.id === id) this.examCache = null;
    this.chunkCache = null;
    rmSync(this.path(id), { recursive: true, force: true });
    this.changed();
    return true;
  }

  close(): void {
    clearInterval(this.timer);
    this.flush();
    this.listeners.clear();
  }
}
