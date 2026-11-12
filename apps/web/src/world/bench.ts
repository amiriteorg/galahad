import type { Tier } from "./tiers.ts";

/*
 * What a benchmark asks of the world and reads from it (`?trace=1` only: without it none of this exists).
 *
 * Asked on the address, beside `tier=` and `webgl=1`: `animals=4` (the ecosystem's population, times four),
 * `reach=2` (the land drawn twice as far, with the caps its area needs), `plants=4` (the small plants and the
 * near trees over four times the area), `uncap=1` (every frame the browser offers is drawn: with the browser's own
 * frame-rate limit off, a frame's interval is then what the whole pipeline takes, CPU and GPU), `gpu=1` (WebGPU
 * timestamp queries round every render pass: the GPU's own time a frame), `hold=1` (the resolution governor
 * leaves the picture alone, so what's measured is what was asked for).
 *
 * Read: a log of the last frames (FrameLog), each with the main thread's time in its parts. Pure, so unit-tested;
 * scene.ts does the wiring.
 */

export interface BenchAsk {
  animals: number;
  reach: number;
  plants: number;
  uncap: boolean;
  gpu: boolean;
  hold: boolean;
}

const factor = (raw: string | null, most: number): number => {
  const n = Number(raw);
  return raw !== null && Number.isFinite(n) && n > 0 ? Math.min(most, n) : 1;
};

/** What the address asks for (the page's query, only under `trace=1`: null otherwise). */
export function benchAsk(search: string): BenchAsk | null {
  if (!/[?&]trace=1(&|$)/.test(search)) return null;
  const q = new URLSearchParams(search);
  return { animals: factor(q.get("animals"), 4096), reach: factor(q.get("reach"), 8), plants: factor(q.get("plants"), 64), uncap: q.get("uncap") === "1", gpu: q.get("gpu") === "1", hold: q.get("hold") === "1" };
}

/**
 * A tier asked for more: the same tier with its ecosystem's caps times `animals`, its land `reach` times as far
 * (every plant layer's cap and the triangle budget with the area, so the caps don't hide what more land costs),
 * and its small plants and near trees over `plants` times the area (their caps with it). At 1, 1, 1 it's the tier itself.
 */
export function scaleTier(tier: Tier, ask: Pick<BenchAsk, "animals" | "reach" | "plants">): Tier {
  const { animals: a, reach: r, plants: p } = ask;
  if (a === 1 && r === 1 && p === 1) return tier;
  const area = r * r;
  const side = Math.sqrt(p);
  const n = (v: number, k: number): number => Math.ceil(v * k);
  const w = tier.wild;
  return {
    ...tier,
    radius: tier.radius * r,
    trees: n(tier.trees, area),
    bushes: n(tier.bushes, area),
    rocks: n(tier.rocks, area),
    reeds: n(tier.reeds, area),
    triangles: n(tier.triangles, area * p),
    flowers: n(tier.flowers, p),
    grass: n(tier.grass, p),
    detail: n(tier.detail, p),
    grassRadius: tier.grassRadius * side,
    treeDetail: tier.treeDetail * side,
    treeLod: tier.treeLod * side,
    birds: n(tier.birds, a),
    deer: n(tier.deer, a),
    rabbits: n(tier.rabbits, a),
    ducks: n(tier.ducks, a),
    fireflies: n(tier.fireflies, a),
    wild: { fox: n(w.fox, a), hedgehog: n(w.hedgehog, a), squirrel: n(w.squirrel, a), swan: n(w.swan, a), heron: n(w.heron, a), fish: n(w.fish, a), swallow: n(w.swallow, a), starling: n(w.starling, a), goose: n(w.goose, a), kestrel: n(w.kestrel, a), owl: n(w.owl, a), bat: n(w.bat, a), insects: n(w.insects, a), reach: w.reach },
  };
}

/**
 * The parts of a frame on the main thread, in the order scene.ts runs them: his walking, the weather, the sound and
 * the camera's rig; the experiments on their plots; the land and its plants growing; his day, him, his dog (their
 * rigs and IK); the built places' machines; the ecosystem (its simulation and its poses); the Microducks, his
 * partners and helpers; the camera's arm and what follows it; the render itself (matrices, culling, sorting, the
 * draw calls, the post pipeline); his eyes' panel; the labels.
 */
export const PARTS = ["walk", "plots", "land", "life", "places", "eco", "folk", "camera", "render", "eyes", "labels"] as const;
export type Part = (typeof PARTS)[number];
/** Each part's place in a frame's record. */
export const PART = { walk: 0, plots: 1, land: 2, life: 3, places: 4, eco: 5, folk: 6, camera: 7, render: 8, eyes: 9, labels: 10 } as const satisfies Record<Part, number>;

/** A frame's flags: land was growing, plants were filling, his eyes' panel was drawn. */
export const GROWING = 1;
export const FILLING = 2;
export const EYES = 4;

/** What a frame's record holds: when it began (ms), the interval since the last, the main thread's time in it, its parts, its flags. */
const HEAD = 3;
const STRIDE = HEAD + PARTS.length + 1;

export interface Spread {
  n: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

/** The value a share `q` of the way up a sorted list (nearest rank). */
export function quantile(sorted: ArrayLike<number>, q: number): number {
  const n = sorted.length;
  if (!n) return 0;
  return sorted[Math.min(n - 1, Math.max(0, Math.ceil(q * n) - 1))]!;
}

export function spreadOf(values: Float64Array, n = values.length): Spread {
  if (!n) return { n: 0, mean: 0, p50: 0, p95: 0, p99: 0, max: 0 };
  const sorted = values.slice(0, n).sort();
  let sum = 0;
  for (let i = 0; i < n; i++) sum += sorted[i]!;
  return { n, mean: sum / n, p50: quantile(sorted, 0.5), p95: quantile(sorted, 0.95), p99: quantile(sorted, 0.99), max: sorted[n - 1]! };
}

export interface FrameStats {
  /** Frames in the log, and the seconds they span. */
  frames: number;
  seconds: number;
  /** The interval between frames (ms): with the cap lifted, what the whole pipeline takes a frame. */
  interval: Spread;
  /** The main thread's time a frame (ms), and in the frames that grew land or filled plants (the hitches). */
  work: Spread;
  growing: Spread;
  /** The GPU's time in a frame's render passes (ms; timestamp queries: empty where there are none). */
  gpu: Spread;
  /** Each part's mean time a frame (ms). */
  parts: Record<Part, number>;
  /** The longest frame: its parts (ms) and its flags (what it was doing that took so long). */
  worst: { parts: Record<Part, number>; flags: number };
  /** The frames of 50 ms and more (the last sixteen): when each began (the frame clock, ms), how long it took, and its longest part. */
  slow: { at: number; ms: number; part: Part; partMs: number; flags: number }[];
  /** Frames whose main-thread time passed a 60 Hz frame, a 30 Hz one, and 50 ms (a long task). */
  over16: number;
  over33: number;
  over50: number;
}

/** The last frames, in rings: nothing is allocated while it runs. */
export class FrameLog {
  private readonly data: Float64Array;
  private readonly gpuMs: Float64Array;
  private n = 0;
  private gpuN = 0;
  private at = 0;
  private row = 0;
  private last = 0;

  constructor(private readonly capacity = 16384) {
    this.data = new Float64Array(capacity * STRIDE);
    this.gpuMs = new Float64Array(capacity);
  }

  /** A frame begins: when (the frame clock, ms), the interval since the last drawn, and the clock now. */
  begin(at: number, interval: number, now: number): void {
    this.row = (this.n % this.capacity) * STRIDE;
    this.data.fill(0, this.row, this.row + STRIDE);
    this.data[this.row] = at;
    this.data[this.row + 1] = interval;
    this.at = this.last = now;
  }

  /** The time since the last mark (or the frame's beginning) was this part's. */
  mark(part: number, now: number): void {
    this.data[this.row + HEAD + part] = this.data[this.row + HEAD + part]! + now - this.last;
    this.last = now;
  }

  end(flags: number, now: number): void {
    this.data[this.row + 2] = now - this.at;
    this.data[this.row + STRIDE - 1] = flags;
    this.n++;
  }

  /** The GPU's time in a frame's passes, as its query resolves (a frame or two later). */
  gpu(ms: number): void {
    if (!(ms > 0)) return;
    this.gpuMs[this.gpuN % this.capacity] = ms;
    this.gpuN++;
  }

  reset(): void {
    this.n = 0;
    this.gpuN = 0;
  }

  stats(): FrameStats {
    const n = Math.min(this.n, this.capacity);
    const interval = new Float64Array(n);
    const work = new Float64Array(n);
    const growing = new Float64Array(n);
    const parts = {} as Record<Part, number>;
    const worst = { parts: {} as Record<Part, number>, flags: 0 };
    for (const p of PARTS) parts[p] = worst.parts[p] = 0;
    let longest = -1;
    const slow: FrameStats["slow"] = [];
    let grew = 0;
    let first = Infinity;
    let last = -Infinity;
    let over16 = 0;
    let over33 = 0;
    let over50 = 0;
    for (let i = 0; i < n; i++) {
      const r = i * STRIDE;
      const at = this.data[r]!;
      first = Math.min(first, at);
      last = Math.max(last, at);
      interval[i] = this.data[r + 1]!;
      const ms = this.data[r + 2]!;
      work[i] = ms;
      if (ms > 1000 / 60) over16++;
      if (ms > 1000 / 30) over33++;
      if (ms > 50) over50++;
      if (this.data[r + STRIDE - 1]! & (GROWING | FILLING)) growing[grew++] = ms;
      for (let p = 0; p < PARTS.length; p++) parts[PARTS[p]!] += this.data[r + HEAD + p]! / n;
      if (ms >= 50) {
        let part = 0;
        for (let p = 1; p < PARTS.length; p++) if (this.data[r + HEAD + p]! > this.data[r + HEAD + part]!) part = p;
        slow.push({ at, ms, part: PARTS[part]!, partMs: this.data[r + HEAD + part]!, flags: this.data[r + STRIDE - 1]! });
      }
      if (ms > longest) {
        longest = ms;
        worst.flags = this.data[r + STRIDE - 1]!;
        for (let p = 0; p < PARTS.length; p++) worst.parts[PARTS[p]!] = this.data[r + HEAD + p]!;
      }
    }
    return { frames: n, seconds: n > 1 ? (last - first) / 1000 : 0, interval: spreadOf(interval), work: spreadOf(work), growing: spreadOf(growing, grew), gpu: spreadOf(this.gpuMs, Math.min(this.gpuN, this.capacity)), parts, worst, slow: slow.sort((a, b) => a.at - b.at).slice(-16), over16, over33, over50 };
  }
}
