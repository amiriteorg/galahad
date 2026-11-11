import { BOARD_H, BOARD_LIMITS, BOARD_W, type BoardItem, type BoardStroke, type BoardView, type Chalk, CHALK, niceScale } from "@galahad/core/board";

/*
 * The chalkboard's pure parts, for the page you draw on and for the world's
 * board (whose face is drawn from the same state): how the board sits in a
 * view (fit, zoom about a point, two-finger pinch and pan), how a hand's points
 * become a stroke (smoothed as they come, simplified on pen-up, kept to a
 * tenth), the order things are drawn in, undo and redo of your own strokes,
 * the outbox that sends strokes on pen-up and retries when the node is back,
 * and a chart's geometry. No DOM here: unit-tested.
 */

/* ---------------- the view: board units to screen pixels ---------------- */

/** screen = board · scale + (x, y). */
export interface BoardViewport {
  scale: number;
  x: number;
  y: number;
}

/** The whole board in a w × h box, centred, `pad` pixels clear. */
export function fitView(w: number, h: number, pad = 12): BoardViewport {
  const scale = Math.max(0.05, Math.min((w - 2 * pad) / BOARD_W, (h - 2 * pad) / BOARD_H));
  return { scale, x: (w - BOARD_W * scale) / 2, y: (h - BOARD_H * scale) / 2 };
}

export const toBoard = (v: BoardViewport, sx: number, sy: number): [number, number] => [(sx - v.x) / v.scale, (sy - v.y) / v.scale];
export const toScreen = (v: BoardViewport, bx: number, by: number): [number, number] => [bx * v.scale + v.x, by * v.scale + v.y];

/** How far you may zoom: from a little under the fit to six times it. */
export const zoomLimits = (fit: BoardViewport) => ({ min: fit.scale * 0.8, max: fit.scale * 6 });

/** Keeps at least a quarter of the board on the screen, however far it's panned. */
export function clampView(v: BoardViewport, w: number, h: number): BoardViewport {
  const bw = BOARD_W * v.scale;
  const bh = BOARD_H * v.scale;
  const keepX = Math.min(bw, w) / 4;
  const keepY = Math.min(bh, h) / 4;
  return { scale: v.scale, x: Math.min(w - keepX, Math.max(keepX - bw, v.x)), y: Math.min(h - keepY, Math.max(keepY - bh, v.y)) };
}

/** Zoom by `factor` keeping the board point under (sx, sy) where it is. */
export function zoomAt(v: BoardViewport, factor: number, sx: number, sy: number, limits: { min: number; max: number }): BoardViewport {
  const scale = Math.min(limits.max, Math.max(limits.min, v.scale * factor));
  const k = scale / v.scale;
  return { scale, x: sx - (sx - v.x) * k, y: sy - (sy - v.y) * k };
}

/**
 * Two fingers: the board follows them, scaled by how far apart they are now
 * against when they landed, the point between them staying under them.
 */
export function pinchView(start: BoardViewport, a0: [number, number], b0: [number, number], a: [number, number], b: [number, number], limits: { min: number; max: number }): BoardViewport {
  const d0 = Math.max(1, Math.hypot(b0[0] - a0[0], b0[1] - a0[1]));
  const d = Math.max(1, Math.hypot(b[0] - a[0], b[1] - a[1]));
  const scale = Math.min(limits.max, Math.max(limits.min, start.scale * (d / d0)));
  const m0: [number, number] = [(a0[0] + b0[0]) / 2, (a0[1] + b0[1]) / 2];
  const m: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const [bx, by] = toBoard(start, m0[0], m0[1]);
  return { scale, x: m[0] - bx * scale, y: m[1] - by * scale };
}

/* ---------------- strokes: a hand's points to chalk ---------------- */

/** A tenth of a board unit: plenty for chalk, and what the node keeps. */
export const tenth = (v: number): number => Math.round(v * 10) / 10;

/**
 * Points as they come, eased a little towards the hand (a jittery finger or a
 * trembling mouse makes a steadier line), more for slow movement than fast, so
 * quick strokes don't lag. Returns the point to keep.
 */
export function ease(prev: [number, number] | null, x: number, y: number, scale: number): [number, number] {
  if (!prev) return [x, y];
  // How far it moved, in screen pixels: under 2 px is mostly tremor.
  const moved = Math.hypot(x - prev[0], y - prev[1]) * scale;
  const k = Math.min(1, 0.35 + moved / 12);
  return [prev[0] + (x - prev[0]) * k, prev[1] + (y - prev[1]) * k];
}

/** Ramer–Douglas–Peucker over flat x,y pairs: the indices (of points) worth keeping within `tolerance`. */
export function simplify(points: readonly number[], tolerance: number): number[] {
  const n = points.length / 2;
  if (n <= 2) return Array.from({ length: n }, (_, i) => i);
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  const t2 = tolerance * tolerance;
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ax = points[2 * a]!;
    const ay = points[2 * a + 1]!;
    const dx = points[2 * b]! - ax;
    const dy = points[2 * b + 1]! - ay;
    const len2 = dx * dx + dy * dy;
    let worst = -1;
    let far = 0;
    for (let i = a + 1; i < b; i++) {
      const px = points[2 * i]! - ax;
      const py = points[2 * i + 1]! - ay;
      const t = len2 > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy) / len2)) : 0;
      const ex = px - t * dx;
      const ey = py - t * dy;
      const d2 = ex * ex + ey * ey;
      if (d2 > far) {
        far = d2;
        worst = i;
      }
    }
    if (worst >= 0 && far > t2) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
  return out;
}

/**
 * A finished stroke: simplified (pressure kept for the points that stay), at
 * most `max` points (the contract's), kept to a tenth. Null when there's
 * nothing to it.
 */
export function finishStroke(raw: { points: number[]; pressure: number[] | null }, tolerance: number, max: number): { points: number[]; pressure?: number[] } | null {
  if (raw.points.length < 2) return null;
  let tol = tolerance;
  let kept = simplify(raw.points, tol);
  while (kept.length > max) {
    tol *= 1.6;
    kept = simplify(raw.points, tol);
  }
  // A tap is a dot: one point, drawn as a short stroke.
  const points = kept.length === 1 ? [raw.points[0]!, raw.points[1]!, raw.points[0]! + 0.1, raw.points[1]!] : kept.flatMap((i) => [raw.points[2 * i]!, raw.points[2 * i + 1]!]);
  const out: { points: number[]; pressure?: number[] } = { points: points.map(tenth) };
  if (raw.pressure) {
    const p = kept.length === 1 ? [raw.pressure[0]!, raw.pressure[0]!] : kept.map((i) => raw.pressure![i]!);
    out.pressure = p.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 100) / 100);
  }
  return out;
}

/** A width at a pressure: the chosen width at a middling press, finer for a light touch, broader for a hard one. */
export const pressed = (width: number, pressure: number | undefined): number => (pressure === undefined ? width : width * (0.35 + 1.3 * Math.max(0, Math.min(1, pressure))));

/** A new stroke's id, from random bytes (the node keeps one stroke per id: a retry never draws twice). */
export function strokeId(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  return `s_${Array.from(bytes.subarray(0, 14), (b) => alphabet[b & 63]).join("")}`;
}

/** What's drawn, in the order it was put there: an item or a stroke, the later on top (and the duster only takes what came before it). */
export type Mark = { item: BoardItem } | { stroke: BoardStroke };

export function drawOrder(board: Pick<BoardView, "items" | "strokes">): Mark[] {
  const marks: { at: number; n: number; mark: Mark }[] = [];
  board.items.forEach((item, n) => marks.push({ at: item.at, n, mark: { item } }));
  board.strokes.forEach((stroke, n) => marks.push({ at: stroke.at, n: 1e6 + n, mark: { stroke } }));
  return marks.sort((a, b) => a.at - b.at || a.n - b.n).map((m) => m.mark);
}

/* ---------------- undo and redo: your own strokes, this visit ---------------- */

export class StrokeHistory {
  private done: BoardStroke[] = [];
  private undone: BoardStroke[] = [];

  /** A stroke you drew: it can be undone; what you'd undone can't be redone any more. */
  drew(stroke: BoardStroke): void {
    this.done.push(stroke);
    this.undone = [];
    if (this.done.length > 200) this.done.shift();
  }

  /** The stroke to take off, or null. */
  undo(): BoardStroke | null {
    const s = this.done.pop() ?? null;
    if (s) this.undone.push(s);
    return s;
  }

  /** The stroke to put back, or null. */
  redo(): BoardStroke | null {
    const s = this.undone.pop() ?? null;
    if (s) this.done.push(s);
    return s;
  }

  /** Strokes the board no longer has (cleared, or erased elsewhere) can't be undone or redone. */
  keepOnly(present: ReadonlySet<string>): void {
    this.done = this.done.filter((s) => present.has(s.id));
    this.undone = this.undone.filter((s) => !present.has(s.id));
  }

  forget(): void {
    this.done = [];
    this.undone = [];
  }

  get canUndo(): boolean {
    return this.done.length > 0;
  }

  get canRedo(): boolean {
    return this.undone.length > 0;
  }
}

/* ---------------- the outbox: strokes go on pen-up, a few at a time, and wait for the node ---------------- */

export type Op = { kind: "draw"; stroke: BoardStroke } | { kind: "erase"; id: string };

/**
 * What's waiting to reach the node, in order. One request at a time; a failed
 * one stays at the front and is tried again after a wait that doubles (2 s to
 * 30 s), or at once when the node is back. Draws go in batches (the contract's
 * limit); an erase goes alone (after the draws before it).
 */
export class Outbox {
  private queue: Op[] = [];
  private failures = 0;
  inFlight = false;

  add(op: Op): void {
    // Undoing a stroke that hasn't left yet: it never goes at all.
    if (op.kind === "erase") {
      const i = this.queue.findIndex((o) => o.kind === "draw" && o.stroke.id === op.id);
      if (i >= 0 && !(this.inFlight && i === 0)) {
        this.queue.splice(i, 1);
        return;
      }
    }
    this.queue.push(op);
  }

  /** The next request: a batch of draws, or one erase. */
  next(max: number): { draw: BoardStroke[] } | { erase: string[] } | null {
    const first = this.queue[0];
    if (!first) return null;
    if (first.kind === "erase") {
      const ids: string[] = [];
      for (const op of this.queue) {
        if (op.kind !== "erase" || ids.length >= 500) break;
        ids.push(op.id);
      }
      return { erase: ids };
    }
    const draw: BoardStroke[] = [];
    for (const op of this.queue) {
      if (op.kind !== "draw" || draw.length >= max) break;
      draw.push(op.stroke);
    }
    return { draw };
  }

  /** The request went through: its ops leave the queue. */
  sent(count: number): void {
    this.queue.splice(0, count);
    this.failures = 0;
  }

  /** It didn't: how long to wait before the next try (ms). */
  failed(): number {
    this.failures++;
    return Math.min(30_000, 2000 * 2 ** (this.failures - 1));
  }

  /** The node said no for good (a refusal, not an outage): drop what it refused. */
  drop(count: number): void {
    this.queue.splice(0, count);
  }

  get waiting(): number {
    return this.queue.length;
  }

  get failing(): boolean {
    return this.failures > 0;
  }

  /** Strokes not yet on the node (drawn here, still shown). */
  pendingStrokes(): BoardStroke[] {
    return this.queue.flatMap((o) => (o.kind === "draw" ? [o.stroke] : []));
  }

  pendingErases(): Set<string> {
    return new Set(this.queue.flatMap((o) => (o.kind === "erase" ? [o.id] : [])));
  }
}

/** The board as this page shows it: the node's, with what's still on its way there drawn in, and what's on its way out left out. */
export function withPending(board: BoardView, pending: BoardStroke[], erasing: ReadonlySet<string>): BoardView {
  const have = new Set(board.strokes.map((s) => s.id));
  const strokes = [...board.strokes.filter((s) => !erasing.has(s.id)), ...pending.filter((s) => !have.has(s.id) && !erasing.has(s.id))];
  return { ...board, strokes };
}

/* ---------------- a chart, in board units within its plot ---------------- */

/** The chalks a chart's series take, after the item's own. */
export function seriesChalk(first: Chalk, i: number): Chalk {
  const rest = CHALK.filter((c) => c !== first);
  return i === 0 ? first : rest[(i - 1) % rest.length]!;
}

export interface ChartGeometry {
  /** The axes' box, within the plot (room left for labels). */
  frame: { x: number; y: number; w: number; h: number };
  xTicks: { v: number; at: number }[];
  yTicks: { v: number; at: number }[];
  series: { name: string; chalk: Chalk; points: [number, number][] }[];
  /** A bar's width (bar charts). */
  bar: number;
}

/** Where everything in a chart goes: round ticks on both axes, each value at its place, bars side by side. */
export function chartGeometry(item: Extract<BoardItem, { kind: "chart" }>, plot: { x: number; y: number; w: number; h: number }): ChartGeometry {
  const type = item.type ?? "line";
  const left = 64;
  const bottom = 40;
  const legend = item.series.length > 1 ? 30 : 0;
  const frame = { x: plot.x + left, y: plot.y + legend, w: plot.w - left - 8, h: plot.h - bottom - legend };
  const n = Math.max(...item.series.map((s) => s.values.length));
  const xs = (i: number) => item.xValues?.[i] ?? i;
  const allX = Array.from({ length: n }, (_, i) => xs(i));
  const allY = item.series.flatMap((s) => s.values);
  const ys = niceScale(Math.min(...allY), Math.max(...allY), 4, type === "bar");
  const bars = type === "bar";
  const xScale = bars ? null : niceScale(Math.min(...allX), Math.max(...allX), 5);
  const slot = frame.w / Math.max(1, n);
  const bar = bars ? Math.max(2, (slot * 0.7) / item.series.length) : 0;
  const px = (i: number, s: number) => (bars ? frame.x + slot * i + slot * 0.15 + bar * (s + 0.5) : frame.x + ((xs(i) - xScale!.min) / (xScale!.max - xScale!.min || 1)) * frame.w);
  const py = (v: number) => frame.y + frame.h - ((v - ys.min) / (ys.max - ys.min || 1)) * frame.h;
  return {
    frame,
    yTicks: ys.ticks.map((v) => ({ v, at: py(v) })),
    xTicks: bars
      ? allX.map((v, i) => ({ v, at: frame.x + slot * (i + 0.5) })).filter((_, i, all) => all.length <= 12 || i % Math.ceil(all.length / 12) === 0)
      : xScale!.ticks.map((v) => ({ v, at: frame.x + ((v - xScale!.min) / (xScale!.max - xScale!.min || 1)) * frame.w })),
    series: item.series.map((s, i) => ({ name: s.name, chalk: seriesChalk(item.color, i), points: s.values.map((v, j) => [px(j, i), py(v)] as [number, number]) })),
    bar,
  };
}

/** The bottom of a bar chart's bars: the y of zero (or of the axis's floor). */
export const barBase = (g: ChartGeometry): number => g.yTicks.find((t) => t.v === 0)?.at ?? g.frame.y + g.frame.h;

/* ---------------- the board as it arrives: read at the boundary ---------------- */

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const text = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;
const chalk = (v: unknown): v is Chalk => typeof v === "string" && (CHALK as readonly string[]).includes(v);

function readStroke(v: unknown): BoardStroke | null {
  if (!v || typeof v !== "object") return null;
  const s = v as Record<string, unknown>;
  const points = s.points;
  if (!text(s.id, 40) || !chalk(s.color) || !finite(s.width) || !Array.isArray(points) || points.length % 2 || points.length > BOARD_LIMITS.strokePoints * 2 || !points.every(finite)) return null;
  const pressure = Array.isArray(s.pressure) && s.pressure.length === points.length / 2 && s.pressure.every(finite) ? (s.pressure as number[]) : undefined;
  return { id: s.id, color: s.color, width: Math.max(1, Math.min(48, s.width)), points: points as number[], ...(pressure ? { pressure } : {}), ...(s.erase === true ? { erase: true } : {}), at: finite(s.at) ? s.at : 0 };
}

function readItem(v: unknown): BoardItem | null {
  if (!v || typeof v !== "object") return null;
  const i = v as Record<string, unknown>;
  if (!text(i.id, 40) || !text(i.by, 64) || !chalk(i.color) || ![i.x, i.y, i.w, i.h, i.at].every(finite)) return null;
  const place = { id: i.id, by: i.by, x: i.x as number, y: i.y as number, w: i.w as number, h: i.h as number, color: i.color, at: i.at as number };
  const title = text(i.title, BOARD_LIMITS.title) ? { title: i.title } : {};
  switch (i.kind) {
    case "text":
      return text(i.text, BOARD_LIMITS.text) ? { kind: "text", text: i.text, ...(i.size === "s" || i.size === "m" || i.size === "l" ? { size: i.size } : {}), ...place } : null;
    case "note":
      return text(i.text, BOARD_LIMITS.note) ? { kind: "note", text: i.text, ...title, ...place } : null;
    case "equation":
      return text(i.text, BOARD_LIMITS.equation) ? { kind: "equation", text: i.text, ...place } : null;
    case "chart": {
      const series = Array.isArray(i.series) && i.series.length >= 1 && i.series.length <= BOARD_LIMITS.series ? i.series : null;
      const ok = series?.every((s) => s && typeof s === "object" && text((s as { name: unknown }).name, BOARD_LIMITS.label) && Array.isArray((s as { values: unknown }).values) && (s as { values: unknown[] }).values.length >= 1 && (s as { values: unknown[] }).values.length <= BOARD_LIMITS.values && (s as { values: unknown[] }).values.every(finite));
      if (!series || !ok) return null;
      const xValues = Array.isArray(i.xValues) && i.xValues.every(finite) ? { xValues: i.xValues as number[] } : {};
      const type: { type?: "line" | "bar" | "scatter" } = i.type === "line" || i.type === "bar" || i.type === "scatter" ? { type: i.type } : {};
      const labels = { ...(text(i.xLabel, BOARD_LIMITS.label) ? { xLabel: i.xLabel } : {}), ...(text(i.yLabel, BOARD_LIMITS.label) ? { yLabel: i.yLabel } : {}) };
      return { kind: "chart", series: series as { name: string; values: number[] }[], ...title, ...type, ...xValues, ...labels, ...place };
    }
    default:
      // A kind this page doesn't know (a newer node): left out, never guessed at.
      return null;
  }
}

/** The board from the node, checked against the contract's limits: what can't be drawn is left out. Null if it isn't a board at all. */
export function readBoard(v: unknown): BoardView | null {
  if (!v || typeof v !== "object") return null;
  const b = v as Record<string, unknown>;
  if (!finite(b.version) || !Array.isArray(b.items) || !Array.isArray(b.strokes) || b.items.length > BOARD_LIMITS.items || b.strokes.length > BOARD_LIMITS.strokes) return null;
  const snap = b.snapshot as Record<string, unknown> | null | undefined;
  const snapshot = snap && finite(snap.at) && finite(snap.version) && finite(snap.width) && finite(snap.height) && finite(snap.bytes) ? (snap as unknown as BoardView["snapshot"]) : null;
  return {
    version: b.version,
    updatedAt: finite(b.updatedAt) ? b.updatedAt : 0,
    items: b.items.map(readItem).filter((i): i is BoardItem => i !== null),
    strokes: b.strokes.map(readStroke).filter((s): s is BoardStroke => s !== null),
    snapshot,
  };
}
