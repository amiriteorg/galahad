import type { Examination, RecordingPage, SavedExperiment } from "@galahad/core/experiments";
import type { ExperimentFrame, ExperimentView, Pose } from "@galahad/core/world";
import type { WorldModel } from "./world.ts";

/*
 * Replaying a saved experiment where it was tested: its recording decoded once into typed arrays
 * (every body's pose at every kept frame, carried forward from the last frame that posed it), a
 * clock that plays, pauses and scrubs, and the world the renderer is given meanwhile (the live one,
 * with the replay standing on its plot and whatever ended there out of the way). The page feeds the
 * renderer a keyframe at a time, as frames of a live test arrive, so a replay costs what a live test
 * does. Pure, so unit-tested.
 */

export interface Recording {
  bodies: string[];
  /** Simulation time of each frame, rising. */
  times: Float64Array;
  /** For each body (by its place in `bodies`), 7 numbers a frame; NaN before the body's first pose. */
  poses: Float32Array[];
  /** Simulation seconds a second, as it played live (a run that wasn't paced plays at real time). */
  rate: number;
}

/** How fast a replay plays: as it did live, unless that was too fast or too slow to watch (then real time). */
export const replayRate = (recorded: number): number => (Number.isFinite(recorded) && recorded >= 0.1 && recorded <= 20 ? recorded : 1);

/** The pages of a recording, decoded (rows that aren't what they should be are skipped). */
export function decodeRecording(pages: readonly RecordingPage[]): Recording {
  const bodies = pages[0]?.bodies ?? [];
  const rows = pages.flatMap((p) => p.frames).filter((r) => Array.isArray(r) && r.length >= 1 && Number.isFinite(r[0]));
  rows.sort((a, b) => a[0]! - b[0]!);
  const n = rows.length;
  const times = new Float64Array(n);
  const poses = bodies.map(() => new Float32Array(n * 7).fill(Number.NaN));
  for (let i = 0; i < n; i++) {
    const row = rows[i]!;
    times[i] = row[0]!;
    // [t, k, x, y, z, qw, qx, qy, qz, k, …]: k is the body's place in `bodies`.
    for (let j = 1; j + 7 < row.length; j += 8) {
      const k = row[j]!;
      const into = Number.isInteger(k) ? poses[k] : undefined;
      if (!into) continue;
      let ok = true;
      for (let c = 0; c < 7; c++) if (!Number.isFinite(row[j + 1 + c])) ok = false;
      if (!ok) continue;
      for (let c = 0; c < 7; c++) into[i * 7 + c] = row[j + 1 + c]!;
    }
  }
  // Carried forward: a body that didn't move in a frame stands where it last stood.
  for (const p of poses) for (let i = 1; i < n; i++) if (Number.isNaN(p[i * 7]!)) for (let c = 0; c < 7; c++) p[i * 7 + c] = p[(i - 1) * 7 + c]!;
  return { bodies, times, poses, rate: replayRate(pages[0]?.rate ?? 1) };
}

/** The last frame at or before `t` (the first, before it starts). */
export function frameAt(times: Float64Array, t: number): number {
  let lo = 0;
  let hi = times.length - 1;
  if (hi < 0 || t <= times[0]!) return 0;
  if (t >= times[hi]!) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid]! <= t) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Every body's pose at frame `i` (those it has one for). */
export function posesAt(rec: Recording, i: number): Record<string, Pose> {
  const out: Record<string, Pose> = {};
  for (let b = 0; b < rec.bodies.length; b++) {
    const p = rec.poses[b]!;
    const k = i * 7;
    if (Number.isNaN(p[k]!)) continue;
    out[rec.bodies[b]!] = [p[k]!, p[k + 1]!, p[k + 2]!, p[k + 3]!, p[k + 4]!, p[k + 5]!, p[k + 6]!];
  }
  return out;
}

/** A replay's clock: simulation time from a start, playing at a rate, paused, scrubbed; it stops at the end. */
export class ReplayClock {
  private anchor: { at: number; t: number };
  playing = true;

  constructor(
    readonly t0: number,
    readonly t1: number,
    readonly rate: number,
    now: number,
  ) {
    this.anchor = { at: now, t: t0 };
  }

  /** Where the playhead is at local time `now` (ms). */
  at(now: number): number {
    if (!this.playing) return this.anchor.t;
    const t = this.anchor.t + ((now - this.anchor.at) / 1000) * this.rate;
    if (t < this.t1) return t;
    // The end: it rests there.
    this.anchor = { at: now, t: this.t1 };
    this.playing = false;
    return this.t1;
  }

  get ended(): boolean {
    return !this.playing && this.anchor.t >= this.t1;
  }

  play(now: number): void {
    if (this.playing) return;
    // Played again from the end, it starts over.
    this.anchor = { at: now, t: this.anchor.t >= this.t1 ? this.t0 : this.anchor.t };
    this.playing = true;
  }

  pause(now: number): void {
    if (!this.playing) return;
    this.anchor = { at: now, t: this.at(now) };
    this.playing = false;
  }

  seek(t: number, now: number): void {
    this.anchor = { at: now, t: Math.max(this.t0, Math.min(this.t1, t)) };
  }
}

export const replayId = (id: string): string => `replay:${id}`;
export const isReplay = (id: string | null): boolean => !!id && id.startsWith("replay:");

/** How a saved experiment stands in the world while it's replayed: on its plot, as when it was tested, marked as a replay. */
export function replayView(saved: SavedExperiment): ExperimentView {
  return {
    id: replayId(saved.id),
    title: `Replay · ${saved.title}`,
    engine: saved.engine,
    status: "running",
    phase: "testing",
    plot: saved.plot,
    scale: saved.scale,
    scene: saved.scene,
    startedAt: saved.startedAt,
    endedAt: null,
    nodeName: saved.nodeName,
    sandbox: saved.sandbox,
    quest: saved.quest,
    metrics: {},
    summary: null,
  };
}

/** A live experiment still running on that plot (a replay would stand in its way). */
export const busyPlot = (model: WorldModel, plot: { x: number; y: number }): ExperimentView | undefined =>
  model.experiments.find((e) => e.endedAt === null && e.plot.x === plot.x && e.plot.y === plot.y);

/**
 * The world as the renderer gets it while a replay plays: the replay on its plot (with its first frame,
 * which poses what never moves), and what ended on that plot out of the way. The same objects for the
 * same inputs, so the renderer redoes nothing it needn't.
 */
export class ReplayWorld {
  private last: { model: WorldModel; view: ExperimentView | null; first: ExperimentFrame | null; out: WorldModel } | null = null;
  private experiments: { from: ExperimentView[]; view: ExperimentView | null; out: ExperimentView[] } | null = null;

  shown(model: WorldModel, view: ExperimentView | null, first: ExperimentFrame | null): WorldModel {
    if (!view) return model;
    const last = this.last;
    if (last && last.model === model && last.view === view && last.first === first) return last.out;
    let experiments = this.experiments?.from === model.experiments && this.experiments.view === view ? this.experiments.out : null;
    if (!experiments) {
      experiments = [...model.experiments.filter((e) => !(e.plot.x === view.plot.x && e.plot.y === view.plot.y)), view];
      this.experiments = { from: model.experiments, view, out: experiments };
    }
    const frames = first ? { ...model.frames, [view.id]: first } : model.frames;
    const out: WorldModel = { ...model, experiments, frames };
    this.last = { model, view, first, out };
    return out;
  }
}

/** Each readout's value at simulation time `t`, from its chart series (between two points, on the line between them). */
export function readoutsAt(ex: Examination, t: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of ex.readouts) {
    const s = r.series;
    if (!s.length) continue;
    if (t <= s[0]![0]) out[r.key] = s[0]![1];
    else if (t >= s.at(-1)![0]) out[r.key] = s.at(-1)![1];
    else {
      let i = 1;
      while (s[i]![0] < t) i++;
      const [ta, va] = s[i - 1]!;
      const [tb, vb] = s[i]!;
      out[r.key] = tb > ta ? va + ((vb - va) * (t - ta)) / (tb - ta) : vb;
    }
  }
  return out;
}
