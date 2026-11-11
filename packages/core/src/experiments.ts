import type { ExperimentEngine, ExperimentPhase, ExperimentStatus, ExperimentView, PhaseTimes } from "./world.ts";

/*
 * Saved experiments: every experiment the SANDBOX shows is archived on the node that ran it, for good
 * and complete (its view, its scene's bodies and meshes as sent, every readout over time, every frame,
 * the code that ran it), so it can be listed, replayed, examined, and taken into a general archive and
 * its index. Only the owner deletes one. And the examination: a pure function from a
 * saved experiment to what it showed (each readout's range, final value, trend and a series for a
 * chart, what's notable, and all of it in words). The chalkboard at the observatory, the experiment's
 * panel, the CLI and Galahad's tools all read the same examination. No zod here: the PWA imports it.
 */

/** Every readout's exact figures, over every sample the simulation sent. */
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
  /** The owner's favourite (offered first to replay). Nothing is ever cleared to make room. */
  pinned: boolean;
  /** Everything it takes on the node's disk (compressed). */
  bytes: number;
  /**
   * Its recording: every frame the node received, the bodies in the order its frames name them, how fast
   * it played live (simulation seconds per second), and where it was cut short if a runaway simulation
   * reached its safety limit.
   */
  recording: { frames: number; bytes: number; rate: number; t0: number | null; t1: number | null; bodies: string[]; truncated: Truncation | null };
  /** Its readout samples: every one, unless a safety limit stopped them. */
  samples: { count: number; truncated: Truncation | null };
  /** Each readout's exact figures, by name, in the order they were first sent. */
  readouts: Record<string, ReadoutStats>;
  /** The code that ran it, when it was sent (its source is fetched on its own). */
  code: { name: string; bytes: number } | null;
}

/** Where a runaway simulation's recording (or readouts) stopped: at simulation time `t`, having reached `limit` bytes. */
export interface Truncation {
  t: number;
  limit: number;
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
  /** What stands out: a failure, a readout that ran away, its own summary, a recording cut short. */
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
 * to speak of); oscillating: it turned back four times or more, each swing a fifth of its range or more
 * (or twice or more, swinging across most of its range between the turns);
 * peaked or dipped: it went to one extreme in between and came most of the way back; rising or falling:
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
  /** The values it turned at, in order. */
  const turns: number[] = [];
  for (let i = 1; i < n; i++) {
    const v = points[i]![1];
    if (dir === 0) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
      if (v - lo >= swing) [dir, ext] = [1, v];
      else if (hi - v >= swing) [dir, ext] = [-1, v];
    } else if (dir > 0) {
      if (v > ext) ext = v;
      else if (ext - v >= swing) [reversals, dir, ext] = [reversals + 1, -1, (turns.push(ext), v)];
    } else if (v < ext) ext = v;
    else if (v - ext >= swing) [reversals, dir, ext] = [reversals + 1, 1, (turns.push(ext), v)];
  }
  // Four turns or more; or two or more where each swing between them crosses most of the range (a pendulum's first swings).
  let wide = reversals >= 2;
  for (let i = 1; i < turns.length && wide; i++) if (Math.abs(turns[i]! - turns[i - 1]!) < 0.6 * span) wide = false;
  if (reversals >= 4 || wide) return "oscillating";
  // One extreme in between (a hiccup on the way allowed), most of the way there and back.
  const inside = (i: number) => i > 0 && i < n - 1;
  if (reversals <= 2 && inside(iMax) && max - first >= 0.4 * span && max - final >= 0.4 * span) return "peaked";
  if (reversals <= 2 && inside(iMin) && first - min >= 0.4 * span && final - min >= 0.4 * span) return "dipped";
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

/** One readout examined: its exact figures, with the trend and chart from its series (every sample, or an even share of a very long one). */
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
 * and anything notable (a readout that ran away, a failed status, its own summary, a recording cut
 * short), then all of it in words. `series` is each readout's stored samples, by name.
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
  const mb = (b: number) => `${Math.round(b / 2 ** 20)} MB`;
  if (rec.truncated) notable.push(`Its recording stopped at ${at(rec.truncated.t)}: it reached its safety limit (${mb(rec.truncated.limit)}), so what came after isn't kept.`);
  if (saved.samples?.truncated) notable.push(`Its readouts stopped at ${at(saved.samples.truncated.t)}: they reached their safety limit (${mb(saved.samples.truncated.limit)}).`);

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

const PLACE_WORDS: Record<string, string> = { flight: "over the proving ground's runway", launch: "on the proving ground's launch pad", course: "on the proving ground's rover course" };

/**
 * A saved experiment as plain text, for an archive's semantic index (and anyone reading it): what it
 * was (title, engine, its bodies), where it was tested and when, how it ended, the examination in
 * words with each readout, its own summary, and the code that ran it. Its text came from the script
 * that ran it: an index should keep it as data, never as instructions.
 */
export function experimentText(saved: SavedExperiment, examination: Examination | null, code: { name: string; source: string } | null, place: string): string {
  const shapes = new Map<string, number>();
  for (const b of saved.scene) shapes.set(b.shape.kind, (shapes.get(b.shape.kind) ?? 0) + 1);
  const bodies = [...shapes].map(([kind, n]) => `${n} ${kind}${n === 1 ? "" : "s"}`).join(", ");
  const day = (ms: number | null) => (ms === null ? "" : new Date(ms).toISOString().replace("T", " ").slice(0, 16) + " UTC");
  const lines = [
    `Experiment: ${saved.title}`,
    `Id: ${saved.id}`,
    `Engine: ${ENGINE_NAME[saved.engine]}`,
    `Tested ${place}, on ${saved.nodeName}${saved.sandbox ? ` (sandbox ${saved.sandbox})` : ""}, from ${day(saved.phases.testing ?? saved.startedAt)} to ${day(saved.endedAt)}.`,
    `Status: ${saved.status}${saved.summary ? `: ${saved.summary}` : ""}`,
    `Bodies: ${saved.scene.length}${bodies ? ` (${bodies})` : ""}: ${saved.scene.map((b) => b.label ?? b.id).slice(0, 40).join(", ")}${saved.scene.length > 40 ? ", …" : ""}`,
    `Recording: ${saved.recording.frames} frames${saved.recording.t0 !== null && saved.recording.t1 !== null ? ` over ${at(saved.recording.t1 - saved.recording.t0)} of simulation` : ""}.`,
  ];
  if (examination) {
    lines.push("", `Examination: ${examination.words}`);
    for (const r of examination.readouts) lines.push(`- ${r.label} [${r.key}]: ${r.trend}, from ${readoutValue(r.first)} to ${readoutValue(r.final)}, range ${readoutValue(r.min)} to ${readoutValue(r.max)}, ${r.count} samples${r.ranAway ? ", ran away" : ""}.`);
    if (examination.notable.length) lines.push(`Notable: ${examination.notable.join(" ")}`);
  }
  if (code) lines.push("", `Code (${code.name}):`, code.source);
  return lines.join("\n");
}

/** Where a plot is, in words, for the text above: a pad of a test site, or open land. */
export function placeWords(pad: { site: string; kind: string; id: string } | null): string {
  if (!pad) return "on open land";
  return pad.site === "hall" ? `in the workshop hall's test cell ${pad.id.replace("cell-", "")}` : (PLACE_WORDS[pad.kind] ?? "on the proving ground");
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
