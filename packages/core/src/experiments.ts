import type { ExperimentEngine, ExperimentPhase, ExperimentStatus, ExperimentView, PhaseTimes } from "./world.ts";

/*
 * Saved experiments: every experiment the SANDBOX shows is kept on the node that ran it (its view,
 * every readout over time, a recording of its frames, the code that ran it), so it can be listed,
 * replayed and examined after it's gone from the world. And the examination: a pure function from a
 * saved experiment to what it showed (each readout's range, final value, trend and a series for a
 * chart, what's notable, and all of it in words). The chalkboard at the observatory, the experiment's
 * panel, the CLI and Galahad's tools all read the same examination. No zod here: the PWA imports it.
 */

/** Every readout's exact figures, over every sample the simulation sent (the stored series is thinned). */
export interface ReadoutStats {
  count: number;
  min: number;
  max: number;
  /** When the extremes were (simulation seconds). */
  tMin: number;
  tMax: number;
  first: [number, number];
  last: [number, number];
}

/** A saved experiment, as the node keeps it (node-local: never in the mind). */
export interface SavedExperiment extends ExperimentView {
  phase: ExperimentPhase;
  phases: PhaseTimes;
  /** Pinned ones are never cleared to make room. */
  pinned: boolean;
  /** Everything it takes on the node's disk. */
  bytes: number;
  /**
   * Its recording: the frames kept for a replay (at most `hz` a second of simulation, fewer if it had
   * to be thinned to stay within its cap), the bodies in the order its frames name them, and how fast
   * it played live (simulation seconds per second).
   */
  recording: { frames: number; bytes: number; hz: number; thinned: boolean; rate: number; t0: number | null; t1: number | null; bodies: string[] };
  /** Each readout's exact figures, by name, in the order they were first sent. */
  readouts: Record<string, ReadoutStats>;
  /** The code that ran it, when it was sent (its source is fetched on its own). */
  code: { name: string; bytes: number } | null;
}

/** A saved experiment in a list: what it was, how it went, where it stood. */
export interface SavedSummary {
  id: string;
  title: string;
  engine: ExperimentEngine;
  status: ExperimentStatus;
  phase: ExperimentPhase;
  startedAt: number;
  endedAt: number | null;
  nodeName: string;
  plot: { x: number; y: number; size: number };
  summary: string | null;
  pinned: boolean;
  bytes: number;
  frames: number;
  /** Simulated seconds it covers (null without frames). */
  duration: number | null;
  /** A few readouts' final values. */
  readouts: Record<string, number>;
  code: boolean;
}

/** How a run of experiment_run went: the experiment it built, tested and examined, and what its script said. */
export interface ExperimentRunResult {
  /** The experiment, saved (null only if it couldn't be kept). */
  experiment: SavedSummary | null;
  examination: Examination | null;
  /** Any other experiments its script started. */
  others: string[];
  node: string;
  sandbox: string | null;
  exitCode: number | null;
  durationMs: number;
  /** The ends of what the script printed. */
  stdout: string;
  stderr: string;
}

/** One page of a recording: frames as [t, i, x, y, z, qw, qx, qy, qz, i, …], i indexing `bodies`. */
export interface RecordingPage {
  id: string;
  bodies: string[];
  rate: number;
  t0: number | null;
  t1: number | null;
  total: number;
  from: number;
  frames: number[][];
  /** Where the next page starts, or null at the end. */
  next: number | null;
}

export type Trend = "steady" | "rising" | "falling" | "peaked" | "dipped" | "oscillating" | "fluctuating";

export interface ReadoutExamination {
  key: string;
  /** "altitude (m)". */
  label: string;
  count: number;
  min: number;
  max: number;
  tMin: number;
  tMax: number;
  first: number;
  final: number;
  trend: Trend;
  /** It grew without bound: it ended at its largest, at least ten times what it ever was in the first half. */
  ranAway: boolean;
  /** At most CHART_POINTS points (t, value) for a chart: the extremes of each stretch kept. */
  series: [number, number][];
  /** What it did, in a sentence. */
  sentence: string;
}

export interface Examination {
  id: string;
  title: string;
  engine: ExperimentEngine;
  status: ExperimentStatus;
  /** Simulated seconds it covered, when it sent frames or readouts. */
  duration: number | null;
  /** Its own summary line. */
  summary: string | null;
  readouts: ReadoutExamination[];
  /** What stands out: a failure, a readout that ran away, its own summary, a thinned recording. */
  notable: string[];
  /** One line, for a thought or a list. */
  headline: string;
  /** The whole examination in a few sentences. */
  words: string;
}

/** The most points a readout's chart series has. */
export const CHART_POINTS = 96;

const UNITS: Record<string, string> = { m: "m", mps: "m/s", s: "s", kt: "kt", kts: "kt", deg: "°", rad: "rad", n: "N", kn: "kN", kg: "kg", pct: "%", hz: "Hz", ms: "ms", mm: "mm", j: "J", w: "W", v: "V", a: "A", nm: "N·m" };

/** "altitude_m" → "altitude (m)", "speed_mps" → "speed (m/s)". */
export function readoutLabel(key: string): string {
  const match = key.match(/^(.*)_([a-z]+)$/);
  const unit = match ? UNITS[match[2]!] : undefined;
  const name = (unit ? match![1]! : key).replace(/_/g, " ");
  return unit ? `${name} (${unit})` : name;
}

/** A readout with sensible precision: 1 234, 12.3, 0.0123. */
export function readoutValue(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1000) return Math.round(value).toLocaleString("en-US").replace(/,/g, " ");
  if (abs >= 100) return value.toFixed(0);
  if (abs >= 10) return value.toFixed(1);
  if (abs >= 0.01 || abs === 0) return value.toFixed(2);
  return value.toExponential(1);
}

type Point = readonly [number, number];

/**
 * The shape of a readout over time. Steady: it barely moved (under 5 % of its size, with no net change
 * to speak of); oscillating: it turned back four times or more, each swing a fifth of its range or more;
 * peaked or dipped: it went to an extreme in between and came most of the way back; rising or falling:
 * its net change is most of its range; fluctuating: none of these.
 */
export function trendOf(points: readonly Point[]): Trend {
  const n = points.length;
  if (n < 2) return "steady";
  let min = Infinity;
  let max = -Infinity;
  let iMin = 0;
  let iMax = 0;
  for (let i = 0; i < n; i++) {
    const v = points[i]![1];
    if (v < min) [min, iMin] = [v, i];
    if (v > max) [max, iMax] = [v, i];
  }
  const first = points[0]![1];
  const final = points[n - 1]![1];
  const span = max - min;
  const scale = Math.max(Math.abs(max), Math.abs(min));
  const net = final - first;
  if (span <= 1e-12 * Math.max(1, scale)) return "steady";
  if (span / scale < 0.05 && Math.abs(net) < 0.6 * span) return "steady";
  // Turns of direction, each by at least a fifth of the range (a zigzag with hysteresis).
  const swing = 0.2 * span;
  let reversals = 0;
  let dir = 0;
  let ext = first;
  let lo = first;
  let hi = first;
  for (let i = 1; i < n; i++) {
    const v = points[i]![1];
    if (dir === 0) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
      if (v - lo >= swing) [dir, ext] = [1, v];
      else if (hi - v >= swing) [dir, ext] = [-1, v];
    } else if (dir > 0) {
      if (v > ext) ext = v;
      else if (ext - v >= swing) [reversals, dir, ext] = [reversals + 1, -1, v];
    } else if (v < ext) ext = v;
    else if (v - ext >= swing) [reversals, dir, ext] = [reversals + 1, 1, v];
  }
  if (reversals >= 4) return "oscillating";
  const inside = (i: number) => i > 0 && i < n - 1;
  if (inside(iMax) && max - first >= 0.4 * span && max - final >= 0.4 * span) return "peaked";
  if (inside(iMin) && first - min >= 0.4 * span && final - min >= 0.4 * span) return "dipped";
  if (Math.abs(net) >= 0.3 * span) return net > 0 ? "rising" : "falling";
  return "fluctuating";
}

/** It grew without bound: at least six samples, ending at its largest magnitude, ten times or more its largest in the first half. */
export function ranAway(points: readonly Point[]): boolean {
  const n = points.length;
  if (n < 6) return false;
  let early = 0;
  let largest = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(points[i]![1]);
    if (i < Math.floor(n / 2)) early = Math.max(early, a);
    largest = Math.max(largest, a);
  }
  const final = Math.abs(points[n - 1]![1]);
  return final > 0 && final >= largest * 0.999 && final >= 10 * Math.max(early, 1e-9);
}

/** At most `max` points for a chart: as they are when there are few, otherwise each stretch's lowest and highest, in time order. */
export function chartSeries(points: readonly Point[], max = CHART_POINTS): [number, number][] {
  if (points.length <= max) return points.map(([t, v]) => [t, v]);
  const buckets = Math.max(1, Math.floor(max / 2));
  const out: [number, number][] = [];
  for (let b = 0; b < buckets; b++) {
    const from = Math.floor((b * points.length) / buckets);
    const to = Math.floor(((b + 1) * points.length) / buckets);
    let lo = from;
    let hi = from;
    for (let i = from; i < to; i++) {
      if (points[i]![1] < points[lo]![1]) lo = i;
      if (points[i]![1] > points[hi]![1]) hi = i;
    }
    for (const i of lo === hi ? [lo] : lo < hi ? [lo, hi] : [hi, lo]) out.push([points[i]![0], points[i]![1]]);
  }
  // Always the very first and last, so the chart starts and ends where the readout did.
  const [t0, v0] = points[0]!;
  const [t1, v1] = points.at(-1)!;
  if (out[0]![0] !== t0) out[0] = [t0, v0];
  if (out.at(-1)![0] !== t1) out[out.length - 1] = [t1, v1];
  return out;
}

/** A line as a sentence: a full stop unless it ends with one already. */
const stop = (text: string) => (/[.!?…]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);

const at = (t: number) => `${t < 10 ? t.toFixed(1) : Math.round(t)} s`;

function sentenceFor(r: Omit<ReadoutExamination, "sentence" | "series">): string {
  const v = readoutValue;
  const range = r.min === r.max ? "" : ` (between ${v(r.min)} and ${v(r.max)})`;
  if (r.count === 1) return `${r.label} was ${v(r.final)}.`;
  if (r.ranAway) return `${r.label} ran away: from about ${v(r.first)} to ${v(r.final)} by the end.`;
  switch (r.trend) {
    case "steady":
      return `${r.label} held at about ${v(r.final)}${range}.`;
    case "rising":
      return `${r.label} rose from ${v(r.first)} to ${v(r.final)}${r.max > r.final ? `, peaking at ${v(r.max)}` : ""}.`;
    case "falling":
      return `${r.label} fell from ${v(r.first)} to ${v(r.final)}${r.min < r.final ? `, its lowest ${v(r.min)}` : ""}.`;
    case "peaked":
      return `${r.label} rose from ${v(r.first)} to ${v(r.max)} at ${at(r.tMax)}, then fell to ${v(r.final)}.`;
    case "dipped":
      return `${r.label} fell from ${v(r.first)} to ${v(r.min)} at ${at(r.tMin)}, then rose to ${v(r.final)}.`;
    case "oscillating":
      return `${r.label} oscillated between ${v(r.min)} and ${v(r.max)}, ending at ${v(r.final)}.`;
    case "fluctuating":
      return `${r.label} varied between ${v(r.min)} and ${v(r.max)}, ending at ${v(r.final)}.`;
  }
}

/** One readout examined: its exact figures, with the trend and chart from its stored series (thinned, but the whole run). */
export function examineReadout(key: string, stats: ReadoutStats, stored: readonly Point[]): ReadoutExamination {
  const points: Point[] = stored.length ? [...stored] : stats.count > 1 && stats.last[0] !== stats.first[0] ? [stats.first, stats.last] : [stats.last];
  const base = {
    key,
    label: readoutLabel(key),
    count: stats.count,
    min: stats.min,
    max: stats.max,
    tMin: stats.tMin,
    tMax: stats.tMax,
    first: stats.first[1],
    final: stats.last[1],
    trend: trendOf(points),
    ranAway: ranAway(points),
  };
  return { ...base, series: chartSeries(points), sentence: sentenceFor(base) };
}

const ENGINE_NAME: Record<ExperimentEngine, string> = { mujoco: "MuJoCo", gazebo: "Gazebo", isaac: "Isaac", jsbsim: "JSBSim", rocketpy: "RocketPy", custom: "a custom simulation" };

/** How many readouts the words go through (the rest are in the list). */
const SAID = 6;

/**
 * A saved experiment, examined: each readout's range, final value and trend, a series for its chart,
 * and anything notable (a readout that ran away, a failed status, its own summary, a thinned
 * recording), then all of it in words. `series` is each readout's stored samples, by name.
 */
export function examine(saved: SavedExperiment, series: Record<string, readonly Point[]>): Examination {
  const readouts = Object.entries(saved.readouts).map(([key, stats]) => examineReadout(key, stats, series[key] ?? []));
  const rec = saved.recording;
  const times = [rec.t0, rec.t1, ...readouts.flatMap((r) => [saved.readouts[r.key]!.first[0], saved.readouts[r.key]!.last[0]])].filter((t): t is number => t !== null);
  const duration = times.length ? Math.max(...times) - Math.min(...times) : null;
  const notable: string[] = [];
  if (saved.status === "failed") notable.push(`It failed: ${stop(saved.summary ?? "no reason was given")}`);
  else if (saved.status === "starting" || saved.status === "running") notable.push("It hadn't finished when it was examined.");
  for (const r of readouts) if (r.ranAway) notable.push(`${r.label} ran away, ending at ${readoutValue(r.final)}.`);
  if (saved.status === "done" && saved.summary) notable.push(`In its own words: ${stop(saved.summary)}`);
  if (!readouts.length) notable.push("It sent no readouts.");
  if (rec.thinned) notable.push(`Its recording was thinned to ${Math.round(rec.hz * 10) / 10} frames a second of simulation to stay within its size.`);

  const status = saved.status === "done" ? "finished" : saved.status === "failed" ? "failed" : "didn't finish";
  const span = duration !== null && duration > 0 ? ` after ${at(duration)} of simulation` : "";
  const lead = readouts.find((r) => r.ranAway) ?? readouts[0];
  const headline =
    saved.status === "failed"
      ? `${saved.title} failed${saved.summary ? `: ${stop(saved.summary)}` : "."}`
      : lead
        ? `${saved.title} ${status}: ${lead.sentence.charAt(0).toLowerCase()}${lead.sentence.slice(1)}`
        : `${saved.title} ${status}${saved.summary ? `: ${stop(saved.summary)}` : "."}`;
  const words = [
    `${saved.title} (${ENGINE_NAME[saved.engine]}) ${status}${span}.`,
    ...readouts.slice(0, SAID).map((r) => r.sentence),
    readouts.length > SAID ? `${readouts.length - SAID} more readout${readouts.length - SAID === 1 ? "" : "s"} in the list.` : "",
    // What the readouts' sentences haven't said already.
    ...notable.filter((n) => !/ ran away, /.test(n)),
    readouts.length && !readouts.some((r) => r.ranAway) ? "Nothing ran away." : "",
  ]
    .filter(Boolean)
    .join(" ");
  return { id: saved.id, title: saved.title, engine: saved.engine, status: saved.status, duration, summary: saved.summary, readouts, notable, headline, words };
}

/** A saved experiment in a list (its first few readouts' final values). */
export function summaryOf(saved: SavedExperiment): SavedSummary {
  const readouts: Record<string, number> = {};
  for (const [key, stats] of Object.entries(saved.readouts).slice(0, 4)) readouts[key] = stats.last[1];
  const { t0, t1 } = saved.recording;
  return {
    id: saved.id,
    title: saved.title,
    engine: saved.engine,
    status: saved.status,
    phase: saved.phase,
    startedAt: saved.startedAt,
    endedAt: saved.endedAt,
    nodeName: saved.nodeName,
    plot: saved.plot,
    summary: saved.summary,
    pinned: saved.pinned,
    bytes: saved.bytes,
    frames: saved.recording.frames,
    duration: t0 !== null && t1 !== null ? t1 - t0 : null,
    readouts,
    code: saved.code !== null,
  };
}
