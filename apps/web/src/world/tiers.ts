/*
 * How much world a device can carry. A tier is chosen once at start from the GPU
 * (WebGPU adapter, or the WebGL2 fallback) and the screen; it caps every
 * instance count and effect. While running, the resolution governor holds the
 * frame time: it lowers the pixel ratio first, and only when that's at its floor
 * does it drop effects (shadows, then grass). Pure, so unit-tested.
 */

export type TierName = "low" | "medium" | "high";

export interface Tier {
  name: TierName;
  /** Pixel ratio: the most it starts at, and the floor the governor may lower it to. */
  maxDpr: number;
  minDpr: number;
  /** One directional sun shadow near the camera; otherwise blob shadows under characters. */
  shadows: boolean;
  shadowMapSize: number;
  /** Hard caps on instances. */
  trees: number;
  bushes: number;
  flowers: number;
  grass: number;
  rocks: number;
  /** Pebbles and clover underfoot. */
  detail: number;
  birds: number;
  deer: number;
  rabbits: number;
  ducks: number;
  /** Microducks, the little biped duck robots round the keep. */
  microducks: number;
  fireflies: number;
  particles: number;
  /** Cheap point lights at night (the forge first). */
  lights: number;
  /** Land is loaded this far round the camera's focus at most (metres); fog hides its edge. */
  radius: number;
  /** Grass, flowers, pebbles and clover only this near the focus. */
  grassRadius: number;
  /** Beyond this (metres from the focus) trees are drawn with their simpler model. */
  treeLod: number;
  /** Within this (metres from the focus) trees are drawn with their most detailed model; 0: never. */
  treeDetail: number;
  /**
   * Triangles a frame may draw for the land and everything on it (the tests hold
   * the land and its plants to this, less room for the keep and the characters).
   */
  triangles: number;
  /** The land is drawn on the fine grid (2 m cells) this far round the focus, metres; the base grid (4 m) beyond. */
  terrainFine: number;
  /** Chunks started per frame at most, and the milliseconds a frame may spend growing land. */
  chunkBudget: number;
  chunkMs: number;
  /** The water's grid near the camera (cells a side): gentle waves need vertices. */
  waterGrid: number;
  /** Soft glows round lamps and windows at night. */
  halos: number;
  /** Multisampling (cheap on the tile-based GPUs of phones). */
  antialias: boolean;
}

export const TIERS: Record<TierName, Tier> = {
  low: {
    name: "low",
    maxDpr: 1,
    minDpr: 0.6,
    shadows: false,
    shadowMapSize: 0,
    trees: 1500,
    bushes: 600,
    flowers: 400,
    grass: 1200,
    rocks: 400,
    detail: 600,
    birds: 10,
    deer: 2,
    rabbits: 3,
    ducks: 3,
    microducks: 6,
    fireflies: 16,
    particles: 96,
    lights: 1,
    radius: 200,
    grassRadius: 36,
    treeLod: 60,
    treeDetail: 0,
    triangles: 500000,
    terrainFine: 40,
    chunkBudget: 1,
    chunkMs: 3,
    waterGrid: 32,
    halos: 24,
    antialias: false,
  },
  medium: {
    name: "medium",
    maxDpr: 1.5,
    minDpr: 1,
    shadows: false,
    shadowMapSize: 0,
    trees: 3000,
    bushes: 1500,
    flowers: 2200,
    grass: 7000,
    rocks: 900,
    detail: 2500,
    birds: 24,
    deer: 4,
    rabbits: 6,
    ducks: 5,
    microducks: 9,
    fireflies: 40,
    particles: 192,
    lights: 2,
    radius: 280,
    grassRadius: 60,
    treeLod: 90,
    treeDetail: 28,
    triangles: 1050000,
    terrainFine: 80,
    chunkBudget: 2,
    chunkMs: 4,
    waterGrid: 56,
    halos: 48,
    antialias: true,
  },
  high: {
    name: "high",
    maxDpr: 2,
    minDpr: 1,
    shadows: true,
    shadowMapSize: 2048,
    trees: 6000,
    bushes: 3000,
    flowers: 5000,
    grass: 16000,
    rocks: 1800,
    detail: 6000,
    birds: 48,
    deer: 8,
    rabbits: 12,
    ducks: 8,
    microducks: 14,
    fireflies: 80,
    particles: 384,
    lights: 3,
    radius: 380,
    grassRadius: 100,
    treeLod: 140,
    treeDetail: 70,
    triangles: 1950000,
    terrainFine: 150,
    chunkBudget: 3,
    chunkMs: 6,
    waterGrid: 80,
    halos: 96,
    antialias: true,
  },
};

export interface DeviceInfo {
  /** A WebGPU adapter was found (otherwise the WebGL2 backend runs). */
  webgpu: boolean;
  /** The adapter is a software fallback. */
  fallbackAdapter: boolean;
  /** Touch is the main pointer (phones, tablets). */
  coarse: boolean;
  /** The screen's shorter side, CSS pixels. */
  minScreen: number;
  /** navigator.deviceMemory (GB), when the browser says. */
  memory: number | null;
  /** navigator.hardwareConcurrency, when the browser says. */
  cores: number | null;
}

/** The tier for a device: phones top out at medium; a software adapter or a small, weak device gets low. */
export function chooseTier(d: DeviceInfo): TierName {
  if (d.fallbackAdapter) return "low";
  if ((d.memory !== null && d.memory < 4) || (d.cores !== null && d.cores <= 2)) return "low";
  if (d.coarse || d.minScreen < 600) return d.webgpu && (d.memory === null || d.memory >= 4) ? "medium" : "low";
  return d.webgpu ? "high" : "medium";
}

/** One lower, for a restart after the device was lost. */
export const lowerTier = (t: TierName): TierName => (t === "high" ? "medium" : "low");

export type GovernorAction = "none" | "dpr" | "drop-shadows" | "drop-grass";

/**
 * Holds the frame time near the budget by changing the pixel ratio: two slow
 * seconds in a row lower it a step (down to the tier's floor); several fast
 * seconds in a row raise it again (up to the tier's ceiling). At the floor and
 * still slow, it drops shadows, then grass, once each. A step down that doesn't
 * make frames faster (a device held back by something other than pixels) is put
 * back at once, and the pixel ratio isn't lowered again: a blurrier picture that
 * buys nothing is the worst of both. A second is judged by its
 * median frame (a shader compiling once is not a slow device), and the first
 * seconds after a start or a pause aren't judged at all.
 */
export class ResolutionGovernor {
  dpr: number;
  shadows: boolean;
  grass: boolean;
  private readonly times = new Float32Array(256);
  private samples = 0;
  private windowStart = -1;
  private started = -1;
  private fastWindows = 0;
  private slowWindows = 0;
  /** The last step down, judged by the window after it. */
  private stepped: { from: number; median: number } | null = null;
  /** Whether lowering the pixel ratio has been worth it here (until shown otherwise). */
  private dprHelps = true;

  constructor(
    private readonly tier: Tier,
    startDpr: number,
    /** Frame-time target: about 55 fps, so 60 Hz screens that are holding up aren't punished. */
    private readonly budgetMs = 1000 / 55,
    private readonly warmupMs = 3000,
  ) {
    this.dpr = Math.max(tier.minDpr, Math.min(tier.maxDpr, startDpr));
    this.shadows = tier.shadows;
    this.grass = tier.grass > 0;
  }

  /** Records one rendered frame's time; every second, maybe acts. Only frames rendered back to back count. */
  frame(now: number, ms: number): GovernorAction {
    if (this.started < 0) this.started = now;
    if (now - this.started < this.warmupMs) return "none";
    if (this.windowStart < 0) this.windowStart = now;
    if (this.samples < this.times.length) this.times[this.samples++] = ms;
    if (now - this.windowStart < 1000) return "none";
    const n = this.samples;
    const window = this.times.subarray(0, n).sort();
    const median = n ? window[n >> 1]! : 0;
    this.samples = 0;
    this.windowStart = now;
    if (n < 20) return "none";
    if (this.stepped) {
      const { from, median: before } = this.stepped;
      this.stepped = null;
      if (median > before * 0.88) {
        this.dprHelps = false;
        this.slowWindows = 0;
        this.dpr = from;
        return "dpr";
      }
    }
    if (median > this.budgetMs * 1.15) {
      this.fastWindows = 0;
      if (++this.slowWindows < 2) return "none";
      this.slowWindows = 0;
      if (this.dprHelps && this.dpr > this.tier.minDpr + 1e-6) {
        this.stepped = { from: this.dpr, median };
        this.dpr = Math.max(this.tier.minDpr, Math.round((this.dpr - 0.25) * 100) / 100);
        return "dpr";
      }
      if (this.shadows) {
        this.shadows = false;
        return "drop-shadows";
      }
      if (this.grass) {
        this.grass = false;
        return "drop-grass";
      }
      return "none";
    }
    this.slowWindows = 0;
    if (median < this.budgetMs * 0.7) {
      this.fastWindows++;
      if (this.fastWindows >= 4 && this.dpr < this.tier.maxDpr - 1e-6) {
        this.fastWindows = 0;
        this.dpr = Math.min(this.tier.maxDpr, Math.round((this.dpr + 0.25) * 100) / 100);
        return "dpr";
      }
    } else this.fastWindows = 0;
    return "none";
  }

  /** Forget the current window (after a pause: the first frames back aren't representative). */
  reset(): void {
    this.samples = 0;
    this.windowStart = -1;
    this.started = -1;
    this.slowWindows = 0;
    this.stepped = null;
  }
}
