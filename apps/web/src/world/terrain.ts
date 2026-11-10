import { fbm, hash2, hash3, simplex, smoothstep } from "./noise.ts";

/*
 * The SANDBOX's land, as numbers: an endless field of 64 m chunks grown from one
 * seed. Gentle hills, meadows, forests, rocky tops, sandy shores and lakes, and
 * streams that come down from the hills in pools and waterfalls (their beds are
 * stepped, so where a stream drops, it falls); the keep's ground (45 m around
 * the origin) and every experiment plot are flat at level 0 and blend into the
 * hills around them. Pure and deterministic: the same seed and the same plots
 * give the same land on every device. World coordinates (metres, x east, y
 * north, z up), as in the contract.
 */

export const SEED = 0x6a1a4ad;
export const CHUNK = 64;
export const CELLS = 16;
export const CELL = CHUNK / CELLS;
export const WATER_LEVEL = -1.4;
export const FLAT_LEVEL = 0;
export const KEEP_RADIUS = 45;
const KEEP_BLEND = 24;
/** Room for the fence and a path around a plot before the land starts to rise. */
export const PLOT_MARGIN = 3;
const PLOT_BLEND = 14;
/** No trees this close to flat ground. */
const TREE_CLEARANCE = 4;

export type Flat = { kind: "circle"; x: number; y: number; radius: number; blend: number } | { kind: "square"; x: number; y: number; half: number; blend: number };

export const KEEP_FLAT: Flat = { kind: "circle", x: 0, y: 0, radius: KEEP_RADIUS, blend: KEEP_BLEND };
export const plotFlat = (plot: { x: number; y: number; size: number }): Flat => ({ kind: "square", x: plot.x, y: plot.y, half: plot.size / 2 + PLOT_MARGIN, blend: PLOT_BLEND });
export const flatKey = (f: Flat): string => (f.kind === "circle" ? `c${f.x},${f.y},${f.radius}` : `s${f.x},${f.y},${f.half}`);

/** How far (x, y) is outside the flat's level core (negative inside). */
export function flatDistance(f: Flat, x: number, y: number): number {
  if (f.kind === "circle") return Math.hypot(x - f.x, y - f.y) - f.radius;
  return Math.max(Math.abs(x - f.x), Math.abs(y - f.y)) - f.half;
}

/** 1 on the flat, easing to 0 across its blend band. */
export const flatWeight = (f: Flat, x: number, y: number): number => 1 - smoothstep(0, f.blend, flatDistance(f, x, y));

/** How much of a stream runs at (x, y): 1 in its bed, easing to 0 on its banks. */
export function streamAt(seed: number, x: number, y: number): number {
  // Streams follow the zero line of a slow noise: long, winding, never ending.
  const r = Math.abs(simplex(seed + 91, x / 520, y / 520) + 0.35 * simplex(seed + 97, x / 140, y / 140) * 0.08);
  return smoothstep(0.08, 0.01, r);
}

/** How far a stream drops at a waterfall, metres: its pools step down by this much. */
export const STREAM_STEP = 2.2;
/** How far a stream's bed lies below its pool's surface. */
const STREAM_DEPTH = 0.7;

/** The land's broad shape: hills and lake basins, without the small bumps. */
function broadHeight(seed: number, x: number, y: number, octaves = 4): number {
  return fbm(seed, x / 260, y / 260, octaves) * 9 + 2.2 - smoothstep(-0.25, -0.62, simplex(seed + 29, x / 420, y / 420)) * 9;
}

/**
 * The surface of a stream's pool at (x, y): the land's broad height stepped down
 * to a whole number of drops above the lakes. Along a stream it's level for a
 * while, then drops by STREAM_STEP: a waterfall.
 */
export function streamLevel(seed: number, x: number, y: number): number {
  return WATER_LEVEL + Math.max(0, Math.floor((broadHeight(seed, x, y, 3) - WATER_LEVEL - 0.9) / STREAM_STEP)) * STREAM_STEP;
}

/** The land as it would be with nothing built on it. */
export function naturalHeight(seed: number, x: number, y: number): number {
  const detail = simplex(seed + 17, x / 45, y / 45) * 1.1;
  let h = broadHeight(seed, x, y) + detail;
  // High ground breaks into low limestone terraces (little cliffs).
  if (h > 5) {
    const step = 2.2;
    const k = (h - 5) / step;
    const f = k - Math.floor(k);
    h = 5 + (Math.floor(k) + smoothstep(0.55, 1, f)) * step;
  }
  // Streams lay their beds just below their pool's surface, so the water shows in them.
  const s = streamAt(seed, x, y);
  if (s <= 0) return h;
  return h + (streamLevel(seed, x, y) - STREAM_DEPTH - h) * s;
}

/**
 * The water's surface at (x, y), or −Infinity where there's none: the lakes'
 * level, or a stream's pool above it (never on the keep's lawn or a plot).
 */
export function waterAt(seed: number, x: number, y: number, flats: readonly Flat[]): number {
  const h = heightAt(seed, x, y, flats);
  const s = streamAt(seed, x, y);
  if (s > 0.35 && flatMix(flats, x, y) < 0.3) {
    const level = streamLevel(seed, x, y);
    if (level > WATER_LEVEL + 0.01 && h < level - 0.12) return level;
  }
  return h < WATER_LEVEL ? WATER_LEVEL : Number.NEGATIVE_INFINITY;
}

function flatMix(flats: readonly Flat[], x: number, y: number): number {
  let w = 0;
  for (const f of flats) {
    w = Math.max(w, flatWeight(f, x, y));
    if (w >= 1) break;
  }
  return w;
}

/** The ground's height at (x, y), with the flats levelled. */
export function heightAt(seed: number, x: number, y: number, flats: readonly Flat[]): number {
  const w = flatMix(flats, x, y);
  if (w >= 1) return FLAT_LEVEL;
  const h = naturalHeight(seed, x, y);
  return h + (FLAT_LEVEL - h) * w;
}

export type Ground = "lakebed" | "sand" | "meadow" | "forest" | "rock" | "green";

/** sRGB colours of the ground: sunny lime meadows, a deeper forest floor, pale sand, warm limestone. */
export const GROUND_COLOR: Record<Ground, number> = {
  lakebed: 0x8fc3b6,
  sand: 0xead9b0,
  meadow: 0x9fca52,
  forest: 0x86b046,
  rock: 0xe2d2c0,
  green: 0xa9d05c,
};

/** Patches of sunnier, yellower grass and of lusher green across the meadows. */
const SUNNY = 0xc2d66a;
const LUSH = 0x7fb447;

/** A ground's colour at (x, y): its base, with broad patches of sunnier or lusher grass. */
export function groundColor(seed: number, x: number, y: number, ground: Ground): number {
  const base = GROUND_COLOR[ground];
  if (ground !== "meadow" && ground !== "green" && ground !== "forest") return base;
  const n = simplex(seed + 71, x / 38, y / 38) + 0.4 * simplex(seed + 73, x / 11, y / 11);
  return n > 0 ? mixHex(base, SUNNY, Math.min(1, n) * 0.55) : mixHex(base, LUSH, Math.min(1, -n) * 0.45);
}

function mixHex(a: number, b: number, t: number): number {
  const ch = (k: number) => Math.round(((a >> k) & 255) * (1 - t) + ((b >> k) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

export function groundAt(seed: number, x: number, y: number, h: number, flat: number): Ground {
  if (h < WATER_LEVEL - 0.2) return "lakebed";
  if (h < WATER_LEVEL + 0.8) return "sand";
  if (flat > 0.55) return "green";
  if (h > 6.8 + simplex(seed + 53, x / 60, y / 60) * 1.6) return "rock";
  return simplex(seed + 41, x / 170, y / 170) > 0.12 ? "forest" : "meadow";
}

export const chunkOf = (x: number, y: number): [number, number] => [Math.floor(x / CHUNK), Math.floor(y / CHUNK)];
export const chunkKey = (cx: number, cy: number): string => `${cx},${cy}`;

/** Every chunk whose square comes within `radius` of (x, y), nearest first. */
export function chunksAround(x: number, y: number, radius: number): [number, number][] {
  const out: { c: [number, number]; d: number }[] = [];
  const [x0, y0] = chunkOf(x - radius, y - radius);
  const [x1, y1] = chunkOf(x + radius, y + radius);
  for (let cx = x0; cx <= x1; cx++) {
    for (let cy = y0; cy <= y1; cy++) {
      const nx = Math.max(cx * CHUNK, Math.min(x, (cx + 1) * CHUNK));
      const ny = Math.max(cy * CHUNK, Math.min(y, (cy + 1) * CHUNK));
      const d = Math.hypot(nx - x, ny - y);
      if (d <= radius) out.push({ c: [cx, cy], d: Math.hypot((cx + 0.5) * CHUNK - x, (cy + 0.5) * CHUNK - y) });
    }
  }
  return out.sort((a, b) => a.d - b.d).map((o) => o.c);
}

/** The flats that shape a chunk (their level core, blend band or tree clearance reaches it). */
export function flatsTouching(cx: number, cy: number, flats: readonly Flat[]): Flat[] {
  const minX = cx * CHUNK;
  const minY = cy * CHUNK;
  return flats.filter((f) => {
    const nx = Math.max(minX, Math.min(f.x, minX + CHUNK));
    const ny = Math.max(minY, Math.min(f.y, minY + CHUNK));
    return flatDistance(f, nx, ny) < Math.max(f.blend, TREE_CLEARANCE);
  });
}


/** Placements are packed: x, y, z, scale, turn (radians), kind; world coordinates. */
export const STRIDE = 6;

/** What grows on a chunk, by layer: the big things, then what's underfoot (grown only near the camera). */
export const LAYERS = ["trees", "bushes", "rocks", "flowers", "grass", "detail"] as const;
export type Layer = (typeof LAYERS)[number];
/** The small layers: grown when a chunk first comes near the camera's focus. */
export const SMALL: readonly Layer[] = ["flowers", "grass", "detail"];
export const BIG: readonly Layer[] = ["trees", "bushes", "rocks"];

export interface ChunkSamples {
  cx: number;
  cy: number;
  /** (CELLS+1)² heights, row by row from the chunk's south-west corner. */
  heights: Float32Array;
  /** Two triangles per cell, as sRGB colours. */
  faces: Uint32Array;
  /** Packed placements per layer (STRIDE numbers each); a small layer only once grown. */
  layers: Partial<Record<Layer, Float64Array>>;
  /** The flats that shape it (for growing its small layers later). */
  near: readonly Flat[];
}

/** Scales an sRGB colour's brightness (per-face variation for the low-poly look). */
export function shade(color: number, k: number): number {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return (c((color >> 16) & 255) << 16) | (c((color >> 8) & 255) << 8) | c(color & 255);
}

interface LayerRule {
  /** Grid spacing, metres: at most one per cell. */
  grid: number;
  density: Record<Ground, number>;
  /** How far from flat ground it keeps. */
  clearance: number;
  scale: [number, number];
  /** Which model, for a pick in [0, 1) on a ground. */
  kind(ground: Ground, pick: number): number;
  salt: number;
  /** Also on the lakebed (rocks). */
  underwater?: boolean;
  /** Grows on the keep's lawn too (not on plots, nor where something is built). */
  lawn?: boolean;
}

const RULES: Record<Layer, LayerRule> = {
  trees: {
    grid: 8,
    density: { lakebed: 0, sand: 0, green: 0, meadow: 0.07, forest: 0.7, rock: 0.05 },
    clearance: TREE_CLEARANCE,
    scale: [0.8, 1.4],
    // 0 broadleaf, 1 conifer, 2 round, 3 parasol.
    kind: (g, p) => (g === "forest" ? (p < 0.36 ? 1 : p < 0.76 ? 0 : p < 0.9 ? 2 : 3) : p < 0.45 ? 0 : p < 0.7 ? 3 : 2),
    salt: 1,
  },
  bushes: {
    grid: 10.67,
    density: { lakebed: 0, sand: 0.04, green: 0.05, meadow: 0.14, forest: 0.35, rock: 0.1 },
    clearance: 2,
    scale: [0.7, 1.3],
    kind: (_g, p) => (p < 0.6 ? 0 : 1),
    salt: 21,
  },
  flowers: {
    grid: 2.6,
    density: { lakebed: 0, sand: 0.02, green: 0.3, meadow: 0.46, forest: 0.08, rock: 0.05 },
    clearance: 0.5,
    scale: [1.3, 2.1],
    kind: (_g, p) => Math.min(2, Math.floor(p * 3)),
    salt: 41,
    lawn: true,
  },
  grass: {
    grid: 1.7,
    density: { lakebed: 0, sand: 0.1, green: 0.42, meadow: 0.7, forest: 0.4, rock: 0.14 },
    clearance: 0.5,
    scale: [0.9, 1.8],
    kind: () => 0,
    salt: 61,
    lawn: true,
  },
  rocks: {
    grid: 12.8,
    density: { lakebed: 0.06, sand: 0.1, green: 0, meadow: 0.12, forest: 0.14, rock: 0.62 },
    clearance: TREE_CLEARANCE,
    scale: [0.6, 2.4],
    kind: (_g, p) => Math.min(2, Math.floor(p * 3)),
    salt: 81,
    underwater: true,
  },
  detail: {
    grid: 2.1,
    density: { lakebed: 0, sand: 0.3, green: 0.22, meadow: 0.26, forest: 0.24, rock: 0.34 },
    clearance: 0.3,
    scale: [0.8, 1.5],
    // 0 pebbles (shores, rock, the forest floor), 1 clover (the meadows).
    kind: (g, p) => (g === "sand" || g === "rock" ? 0 : g === "forest" ? (p < 0.6 ? 0 : 1) : p < 0.25 ? 0 : 1),
    salt: 101,
    lawn: true,
  },
};

function clearOfFlats(flats: readonly Flat[], x: number, y: number, clearance: number, lawn = false): boolean {
  for (const f of flats) if ((!lawn || f.kind === "square") && flatDistance(f, x, y) <= clearance) return false;
  return true;
}

function placeLayer(seed: number, cx: number, cy: number, near: readonly Flat[], rule: LayerRule, built: (x: number, y: number) => boolean): Float64Array {
  const out: number[] = [];
  const per = Math.round(CHUNK / rule.grid);
  const step = CHUNK / per;
  const s = rule.salt;
  for (let j = 0; j < per; j++) {
    for (let i = 0; i < per; i++) {
      const gx = cx * per + i;
      const gy = cy * per + j;
      const x = (gx + 0.12 + 0.76 * hash3(seed, gx, gy, s + 1)) * step;
      const y = (gy + 0.12 + 0.76 * hash3(seed, gx, gy, s + 2)) * step;
      if (!clearOfFlats(near, x, y, rule.clearance, rule.lawn)) continue;
      if (rule.lawn && built(x, y)) continue;
      const z = heightAt(seed, x, y, near);
      if (z < WATER_LEVEL + 0.15 && !rule.underwater) continue;
      const ground = groundAt(seed, x, y, z, 0);
      if (hash3(seed, gx, gy, s) >= rule.density[ground]) continue;
      const [lo, hi] = rule.scale;
      out.push(x, y, z, lo + (hi - lo) * hash3(seed, gx, gy, s + 3) ** 1.5, hash3(seed, gx, gy, s + 4) * Math.PI * 2, rule.kind(ground, hash3(seed, gx, gy, s + 5)));
    }
  }
  return new Float64Array(out);
}


/**
 * Everything about one chunk that doesn't need a GPU: heights, face colours and
 * what grows there (the layers asked for; the rest can be grown later with growLayer).
 */
export function chunkSamples(seed: number, cx: number, cy: number, flats: readonly Flat[], built: (x: number, y: number) => boolean = () => false, layerList: readonly Layer[] = LAYERS): ChunkSamples {
  const near = flatsTouching(cx, cy, flats);
  const x0 = cx * CHUNK;
  const y0 = cy * CHUNK;
  const n = CELLS + 1;
  const heights = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) heights[j * n + i] = heightAt(seed, x0 + i * CELL, y0 + j * CELL, near);

  const faces = new Uint32Array(CELLS * CELLS * 2);
  for (let j = 0; j < CELLS; j++) {
    for (let i = 0; i < CELLS; i++) {
      const h00 = heights[j * n + i]!;
      const h10 = heights[j * n + i + 1]!;
      const h01 = heights[(j + 1) * n + i]!;
      const h11 = heights[(j + 1) * n + i + 1]!;
      // Two triangles per cell; their centroids decide their ground.
      for (let t = 0; t < 2; t++) {
        const x = x0 + (i + (t === 0 ? 2 / 3 : 1 / 3)) * CELL;
        const y = y0 + (j + (t === 0 ? 1 / 3 : 2 / 3)) * CELL;
        const h = t === 0 ? (h00 + h10 + h11) / 3 : (h00 + h11 + h01) / 3;
        const ground = groundAt(seed, x, y, h, flatMix(near, x, y));
        faces[(j * CELLS + i) * 2 + t] = shade(groundColor(seed, x, y, ground), 0.97 + hash3(seed, x0 / CELL + i, y0 / CELL + j, t + 7) * 0.06);
      }
    }
  }
  const layers: Partial<Record<Layer, Float64Array>> = {};
  for (const layer of layerList) layers[layer] = placeLayer(seed, cx, cy, near, RULES[layer], built);
  return { cx, cy, heights, faces, layers, near };
}

/** A chunk's layer, grown now if it wasn't yet (the small ones, when the chunk comes near). */
export function growLayer(seed: number, s: ChunkSamples, layer: Layer, built: (x: number, y: number) => boolean = () => false): Float64Array {
  let packed = s.layers[layer];
  if (!packed) packed = s.layers[layer] = placeLayer(seed, s.cx, s.cy, s.near, RULES[layer], built);
  return packed;
}

/** A seed's fingerprint for tests and diagnostics. */
export const seedHash = (seed: number): number => hash2(seed, 0, 0);
