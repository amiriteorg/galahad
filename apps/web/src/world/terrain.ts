import { fbm, hash2, hash3, simplex, smoothstep } from "./noise.ts";
import { SITE_NAMES } from "@galahad/core/world";
import { SITE_GATES, SITE_LEVEL, SITE_RECTS } from "./sites.ts";

/*
 * The SANDBOX's land, as numbers: an endless field of 64 m chunks grown from one
 * seed. Gentle hills, meadows, forests, rocky tops, sandy shores and lakes, and
 * streams that come down from the hills in pools and waterfalls (their beds are
 * stepped, so where a stream drops, it falls); the keep's ground (45 m around
 * the origin), the two test sites, the roads to them and every experiment plot
 * are flat at level 0 and blend into the hills around them. Small things for the fine grid to show: the meadows ripple,
 * crags break through the turf, some hillsides step down in gentle terraces and
 * streams cut crisp banks. Each chunk is sampled on a base grid (4 m cells) and,
 * near the camera, a fine one (2 m cells) whose vertices include the base grid's;
 * every cell is split along its more level diagonal, so ledges and banks stay
 * crisp. Pure and deterministic: the same seed and the same plots give the same
 * land on every device. World coordinates (metres, x east, y north, z up), as in
 * the contract.
 */

export const SEED = 0x6a1a4ad;
export const CHUNK = 64;
/** The base grid, drawn everywhere: cells a chunk's side (4 m). */
export const CELLS = 16;
export const CELL = CHUNK / CELLS;
/** The fine grid near the camera: each base cell split this many ways a side (2 m cells). */
export const FINE = 2;
export const FINE_CELLS = CELLS * FINE;
export const FINE_CELL = CHUNK / FINE_CELLS;
export const WATER_LEVEL = -1.4;
export const FLAT_LEVEL = 0;
export const KEEP_RADIUS = 45;
const KEEP_BLEND = 24;
/** Room for the fence and a path around a plot before the land starts to rise. */
export const PLOT_MARGIN = 3;
const PLOT_BLEND = 14;
/** No trees this close to flat ground. */
const TREE_CLEARANCE = 4;

/** Ground kept level: at the keep's height (0) unless it says otherwise (`level`, metres). */
export type Flat = (
  | { kind: "circle"; x: number; y: number; radius: number; blend: number }
  | { kind: "square"; x: number; y: number; half: number; blend: number }
  /** Half-extents east-west (hx) and north-south (hy). */
  | { kind: "rect"; x: number; y: number; hx: number; hy: number; blend: number }
) & { level?: number };

export const KEEP_FLAT: Flat = { kind: "circle", x: 0, y: 0, radius: KEEP_RADIUS, blend: KEEP_BLEND };
export const plotFlat = (plot: { x: number; y: number; size: number }): Flat => ({ kind: "square", x: plot.x, y: plot.y, half: plot.size / 2 + PLOT_MARGIN, blend: PLOT_BLEND });
/**
 * The proving ground and the workshop hall stand on level ground, a few metres wider than they are: the hall at the keep's
 * height, the proving ground up on its plateau. The road east to the hall's door is level too (it skirts the lake's arm);
 * the road west climbs the hillside as it lies.
 */
const SITE_APRON = 5;
const SITE_BLEND = 18;
const ROAD_HALF = 4;
export const SITE_FLATS: Flat[] = [
  ...SITE_NAMES.map((name): Flat => {
    const r = SITE_RECTS[name];
    return { kind: "rect", x: r.x, y: r.y, hx: r.hx + SITE_APRON, hy: r.hy + SITE_APRON, blend: SITE_BLEND, level: SITE_LEVEL[name] };
  }),
  { kind: "rect", x: (SITE_GATES.hall.x + KEEP_RADIUS) / 2, y: SITE_GATES.hall.y, hx: (SITE_GATES.hall.x - KEEP_RADIUS) / 2, hy: ROAD_HALF, blend: PLOT_BLEND },
];
/** The ground that's level whatever is running: the keep, the two sites and the roads to them. */
export const BASE_FLATS: Flat[] = [KEEP_FLAT, ...SITE_FLATS];
export const flatKey = (f: Flat): string => (f.kind === "circle" ? `c${f.x},${f.y},${f.radius}` : f.kind === "square" ? `s${f.x},${f.y},${f.half}` : `r${f.x},${f.y},${f.hx},${f.hy}`) + (f.level ? `@${f.level}` : "");

/** How far (x, y) is outside the flat's level core (negative inside). */
export function flatDistance(f: Flat, x: number, y: number): number {
  if (f.kind === "circle") return Math.hypot(x - f.x, y - f.y) - f.radius;
  if (f.kind === "rect") return Math.max(Math.abs(x - f.x) - f.hx, Math.abs(y - f.y) - f.hy);
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

/** A gentle terrace's step, metres. */
const TERRACE = 0.8;

/** Where a crag breaks through the turf: 0 none, up to 1 at its crown. Only some hillsides have them. */
export function outcrop(seed: number, x: number, y: number): number {
  const region = simplex(seed + 141, x / 150, y / 150);
  if (region < 0.15) return 0;
  // Knolls several cells across (narrower ones would stand up off the grid like tents), their crowns craggy.
  const n = simplex(seed + 149, x / 16, y / 16) + 0.3 * simplex(seed + 151, x / 7, y / 7);
  return smoothstep(0.15, 0.5, region) * smoothstep(0.25, 0.95, n);
}

/** The land as it would be with nothing built on it. */
export function naturalHeight(seed: number, x: number, y: number): number {
  let h = broadHeight(seed, x, y) + simplex(seed + 17, x / 45, y / 45) * 1.1;
  // Small undulations above the shore: the meadows ripple, so the fine grid's facets catch the light.
  const dry = smoothstep(WATER_LEVEL - 0.4, WATER_LEVEL + 1.6, h);
  if (dry > 0) h += (simplex(seed + 131, x / 17, y / 17) * 0.3 + simplex(seed + 137, x / 7.5, y / 7.5) * 0.11) * dry;
  // Gentle terraces on the middle slopes, where a slow noise says so: old fields, sheep tracks.
  if (h > 1 && h < 5.4) {
    const where = smoothstep(0.2, 0.55, simplex(seed + 157, x / 120, y / 120)) * smoothstep(1, 2.2, h) * (1 - smoothstep(4.4, 5.4, h));
    if (where > 0) {
      const k = h / TERRACE;
      const f = k - Math.floor(k);
      h += ((Math.floor(k) + smoothstep(0.62, 1, f)) * TERRACE - h) * where;
    }
  }
  // High ground breaks into low limestone terraces (little cliffs).
  if (h > 5) {
    const step = 2.2;
    const k = (h - 5) / step;
    const f = k - Math.floor(k);
    h = 5 + (Math.floor(k) + smoothstep(0.55, 1, f)) * step;
  }
  // Crags stand a metre or so out of the turf (never at the water's edge).
  const crag = outcrop(seed, x, y);
  if (crag > 0) h += crag * 1.5 * smoothstep(0, 2.5, h);
  // Streams lay their beds just below their pool's surface, so the water shows in them, and cut crisp banks down
  // to them. They only ever cut: where the land is already lower (a lake's floor), it stays so.
  const s = streamAt(seed, x, y);
  if (s <= 0) return h;
  const bed = streamLevel(seed, x, y) - STREAM_DEPTH;
  return bed < h ? h + (bed - h) * (0.2 * s + 0.8 * smoothstep(0.3, 0.72, s)) : h;
}

/**
 * The water's surface at (x, y), or −Infinity where there's none: the lakes'
 * level, or a stream's pool above it (never on the keep's lawn or a plot).
 */
export function waterAt(seed: number, x: number, y: number, flats: readonly Flat[]): number {
  return waterAtHeight(seed, x, y, heightAt(seed, x, y, flats), flats);
}

/** waterAt, for a point whose ground height `h` is already known. */
export function waterAtHeight(seed: number, x: number, y: number, h: number, flats: readonly Flat[]): number {
  const s = streamAt(seed, x, y);
  if (s > 0.35 && flatMix(flats, x, y) < 0.3) {
    const level = streamLevel(seed, x, y);
    if (level > WATER_LEVEL + 0.01 && h < level - 0.12) return level;
  }
  return h < WATER_LEVEL ? WATER_LEVEL : Number.NEGATIVE_INFINITY;
}

export function flatMix(flats: readonly Flat[], x: number, y: number): number {
  let w = 0;
  for (const f of flats) {
    w = Math.max(w, flatWeight(f, x, y));
    if (w >= 1) break;
  }
  return w;
}

/**
 * The ground's height at (x, y), with the flats levelled: each at its own level, and where the blend bands of
 * two meet (the keep's lawn and the proving ground above it), eased between them by their weights.
 */
export function heightAt(seed: number, x: number, y: number, flats: readonly Flat[]): number {
  let most = 0;
  let sum = 0;
  let level = 0;
  for (let i = 0; i < flats.length; i++) {
    const f = flats[i]!;
    const w = flatWeight(f, x, y);
    if (w <= 0) continue;
    const at = f.level ?? FLAT_LEVEL;
    if (w >= 1) return at;
    sum += w;
    level += w * at;
    if (w > most) most = w;
  }
  const h = naturalHeight(seed, x, y);
  return most > 0 ? h + (level / sum - h) * most : h;
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
  return patchColor(ground, patchNoise(seed, x, y));
}

/** The noise that lays out the sunny and lush patches. */
const patchNoise = (seed: number, x: number, y: number): number => simplex(seed + 71, x / 38, y / 38) + 0.4 * simplex(seed + 73, x / 11, y / 11);

function patchColor(ground: Ground, n: number): number {
  const base = GROUND_COLOR[ground];
  if (ground !== "meadow" && ground !== "green" && ground !== "forest") return base;
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
  return groundOf(h, flat, simplex(seed + 53, x / 60, y / 60), simplex(seed + 41, x / 170, y / 170));
}

/** groundAt, given its two noises: where the bare rock starts, and where the forests are. */
function groundOf(h: number, flat: number, rockline: number, woods: number): Ground {
  if (h < WATER_LEVEL - 0.2) return "lakebed";
  if (h < WATER_LEVEL + 0.8) return "sand";
  if (flat > 0.55) return "green";
  if (h > 6.8 + rockline * 1.6) return "rock";
  return woods > 0.12 ? "forest" : "meadow";
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

/** A chunk's ground sampled on a grid: heights at its corners, how each cell is split, and each triangle's colour. */
export interface Surface {
  /** Cells a side. */
  cells: number;
  /** (cells+1)² heights, row by row from the chunk's south-west corner. */
  heights: Float32Array;
  /** How each cell is split into two triangles (an index into SPLITS). */
  split: Uint8Array;
  /** Two triangles per cell, in SPLITS' order, as sRGB colours. */
  faces: Uint32Array;
}

export interface ChunkSamples extends Surface {
  cx: number;
  cy: number;
  /** Packed placements per layer (STRIDE numbers each); a small layer only once grown. */
  layers: Partial<Record<Layer, Float64Array>>;
  /** The flats that shape it (for growing its small layers later). */
  near: readonly Flat[];
  /** Its fine surface, once it's been asked for (see fineSurface). */
  fine?: FineSurface;
}

/** A chunk's fine surface, with the base surface's height under each of its corners (it morphs into that far off). */
export interface FineSurface extends Surface {
  coarse: Float32Array;
}

/**
 * The corners (di, dj) of a cell's two triangles, counter-clockwise from above:
 * split along its south-west to north-east diagonal (0), or the other (1).
 */
export const SPLITS: readonly (readonly number[])[] = [
  [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1],
  [0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1],
];

/** A cell is split along its more level diagonal (so a ledge or a bank runs along an edge, crisp); a tie, by its hash. */
function splitOf(seed: number, gi: number, gj: number, salt: number, h00: number, h10: number, h01: number, h11: number): number {
  const a = Math.abs(h00 - h11);
  const b = Math.abs(h10 - h01);
  if (Math.abs(a - b) > 1e-3) return a < b ? 0 : 1;
  return hash3(seed, gi, gj, salt) < 0.5 ? 0 : 1;
}

/**
 * The height of a sampled surface at (u, v), in cells from the chunk's south-west
 * corner: on the triangle of the cell it falls in, exactly as it's drawn.
 */
export function surfaceHeight(s: Surface, u: number, v: number): number {
  const n = s.cells + 1;
  const i = Math.max(0, Math.min(s.cells - 1, Math.floor(u)));
  const j = Math.max(0, Math.min(s.cells - 1, Math.floor(v)));
  return cellHeight(s.split[j * s.cells + i]!, s.heights[j * n + i]!, s.heights[j * n + i + 1]!, s.heights[(j + 1) * n + i]!, s.heights[(j + 1) * n + i + 1]!, u - i, v - j);
}

/** The height at (fu, fv) in a cell with these corners, split this way (on the triangle it falls in). */
function cellHeight(split: number, h00: number, h10: number, h01: number, h11: number, fu: number, fv: number): number {
  if (split === 0) return fu >= fv ? h00 + fu * (h10 - h00) + fv * (h11 - h10) : h00 + fv * (h01 - h00) + fu * (h11 - h01);
  return fu + fv <= 1 ? h00 + fu * (h10 - h00) + fv * (h01 - h00) : h11 + (1 - fu) * (h01 - h11) + (1 - fv) * (h10 - h11);
}

/**
 * The ground's height at (x, y) exactly as the fine grid draws it (heightAt is
 * the land's own, smooth between the grid's corners; this is the faceted surface
 * feet stand on). Deterministic, like heightAt.
 */
export function surfaceAt(seed: number, x: number, y: number, flats: readonly Flat[]): number {
  const gi = Math.floor(x / FINE_CELL);
  const gj = Math.floor(y / FINE_CELL);
  const x0 = gi * FINE_CELL;
  const y0 = gj * FINE_CELL;
  // Rounded as the grid stores them, so this is the drawn surface to the last bit.
  const h00 = Math.fround(heightAt(seed, x0, y0, flats));
  const h10 = Math.fround(heightAt(seed, x0 + FINE_CELL, y0, flats));
  const h01 = Math.fround(heightAt(seed, x0, y0 + FINE_CELL, flats));
  const h11 = Math.fround(heightAt(seed, x0 + FINE_CELL, y0 + FINE_CELL, flats));
  return cellHeight(splitOf(seed, gi, gj, FINE_SALT, h00, h10, h01, h11), h00, h10, h01, h11, (x - x0) / FINE_CELL, (y - y0) / FINE_CELL);
}

/** Salts for the two grids' tie-breaking splits and face variation. */
const BASE_SALT = 13;
const FINE_SALT = 14;

/** Bare earth on steep banks and terrace risers, and the worn turf beside the keep's paths. */
const EARTH = 0xcbab7e;
const WORN = 0xc3c27a;
const FACE_JITTER = 0.035;

/**
 * A face's colour: its ground's (with the meadows' sunny and lush patches), bare
 * earth where it's steep, rock on crags and cliffs, worn where feet go, and a
 * little per-face variation for the low-poly look. Its noises are its corners'
 * (averaged: they're slow, and a corner is shared by six faces); `ny` is its
 * normal's vertical part, `jitter` a hash in [0, 1).
 */
function faceColor(f: Fields, a: number, b: number, c: number, h: number, flat: number, ny: number, jitter: number): number {
  const ground = groundOf(h, flat, (f.rockline[a]! + f.rockline[b]! + f.rockline[c]!) / 3, (f.woods[a]! + f.woods[b]! + f.woods[c]!) / 3);
  let color = patchColor(ground, (f.patch[a]! + f.patch[b]! + f.patch[c]!) / 3);
  if (ground === "meadow" || ground === "forest" || ground === "sand") {
    const steep = smoothstep(0.95, 0.8, ny);
    if (steep > 0) color = mixHex(color, EARTH, steep * 0.45);
    const crag = (f.crag[a]! + f.crag[b]! + f.crag[c]!) / 3;
    const rocky = Math.max(crag > 0 ? smoothstep(0.45, 0.8, crag) : 0, smoothstep(0.8, 0.62, ny));
    if (rocky > 0) color = mixHex(color, GROUND_COLOR.rock, rocky);
  } else if (ground === "rock") {
    // A cliff's face a little warmer and darker than its top.
    color = mixHex(color, 0xcdb39f, smoothstep(0.9, 0.6, ny));
  } else if (ground === "green" && f.built[a]! + f.built[b]! + f.built[c]! >= 2) color = mixHex(color, WORN, 0.45);
  return shade(color, 1 - FACE_JITTER + 2 * FACE_JITTER * jitter);
}

/** The noises that colour the ground, sampled at a grid's corners. */
interface Fields {
  rockline: Float32Array;
  woods: Float32Array;
  patch: Float32Array;
  crag: Float32Array;
  built: Uint8Array;
}

function fields(seed: number, x0: number, y0: number, cells: number, built: (x: number, y: number) => boolean): Fields {
  const n = cells + 1;
  const cell = CHUNK / cells;
  const f: Fields = { rockline: new Float32Array(n * n), woods: new Float32Array(n * n), patch: new Float32Array(n * n), crag: new Float32Array(n * n), built: new Uint8Array(n * n) };
  // Only near the keep, on the sites and along the roads to them is anything built (and asking is slow).
  const keep =
    Math.hypot(Math.max(Math.abs(x0 + CHUNK / 2) - CHUNK / 2, 0), Math.max(Math.abs(y0 + CHUNK / 2) - CHUNK / 2, 0)) < 80 ||
    SITE_FLATS.some((f) => flatDistance(f, Math.max(x0, Math.min(f.x, x0 + CHUNK)), Math.max(y0, Math.min(f.y, y0 + CHUNK))) < 2);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = x0 + i * cell;
      const y = y0 + j * cell;
      const k = j * n + i;
      f.rockline[k] = simplex(seed + 53, x / 60, y / 60);
      f.woods[k] = simplex(seed + 41, x / 170, y / 170);
      f.patch[k] = patchNoise(seed, x, y);
      f.crag[k] = outcrop(seed, x, y);
      f.built[k] = keep && built(x, y) ? 1 : 0;
    }
  }
  return f;
}

/** A triangle's slope (dh/dx, dh/dy per metre) from its corners' heights (corners as in SPLITS), into `slope`. */
const slope = new Float64Array(2);
function gradient(c: readonly number[], t: number, h0: number, h1: number, h2: number, cell: number): Float64Array {
  const ax = c[t * 6]!;
  const ay = c[t * 6 + 1]!;
  const bx = c[t * 6 + 2]! - ax;
  const by = c[t * 6 + 3]! - ay;
  const dx = c[t * 6 + 4]! - ax;
  const dy = c[t * 6 + 5]! - ay;
  const hb = h1 - h0;
  const hd = h2 - h0;
  // Solve [bx by; dx dy] g = [hb; hd] (in cells), then per metre.
  const det = bx * dy - by * dx;
  slope[0] = (hb * dy - hd * by) / det / cell;
  slope[1] = (bx * hd - dx * hb) / det / cell;
  return slope;
}

/**
 * Samples a chunk's ground on a grid of `cells` a side. Heights a coarser
 * surface already has (at every few corners) are taken from it, not computed again.
 */
function sampleSurface(seed: number, cx: number, cy: number, cells: number, near: readonly Flat[], built: (x: number, y: number) => boolean, salt: number, from?: Surface): Surface {
  const x0 = cx * CHUNK;
  const y0 = cy * CHUNK;
  const cell = CHUNK / cells;
  const n = cells + 1;
  const heights = new Float32Array(n * n);
  const step = from ? cells / from.cells : 0;
  const fn = from ? from.cells + 1 : 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      heights[j * n + i] = from && i % step === 0 && j % step === 0 ? from.heights[(j / step) * fn + i / step]! : heightAt(seed, x0 + i * cell, y0 + j * cell, near);
    }
  }
  const split = new Uint8Array(cells * cells);
  const faces = new Uint32Array(cells * cells * 2);
  const f = fields(seed, x0, y0, cells, built);
  const gi0 = cx * cells;
  const gj0 = cy * cells;
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const h00 = heights[j * n + i]!;
      const h10 = heights[j * n + i + 1]!;
      const h01 = heights[(j + 1) * n + i]!;
      const h11 = heights[(j + 1) * n + i + 1]!;
      const k = splitOf(seed, gi0 + i, gj0 + j, salt, h00, h10, h01, h11);
      split[j * cells + i] = k;
      const c = SPLITS[k]!;
      // Two triangles per cell; each one's corners, centroid and slope decide its colour.
      for (let t = 0; t < 2; t++) {
        const a = (j + c[t * 6 + 1]!) * n + i + c[t * 6]!;
        const b = (j + c[t * 6 + 3]!) * n + i + c[t * 6 + 2]!;
        const d = (j + c[t * 6 + 5]!) * n + i + c[t * 6 + 4]!;
        const g = gradient(c, t, heights[a]!, heights[b]!, heights[d]!, cell);
        const ny = 1 / Math.sqrt(1 + g[0]! * g[0]! + g[1]! * g[1]!);
        const x = x0 + (i + (c[t * 6]! + c[t * 6 + 2]! + c[t * 6 + 4]!) / 3) * cell;
        const y = y0 + (j + (c[t * 6 + 1]! + c[t * 6 + 3]! + c[t * 6 + 5]!) / 3) * cell;
        const flat = near.length ? flatMix(near, x, y) : 0;
        faces[(j * cells + i) * 2 + t] = faceColor(f, a, b, d, (heights[a]! + heights[b]! + heights[d]!) / 3, flat, ny, hash3(seed, gi0 + i, gj0 + j, salt * 4 + t + 7));
      }
    }
  }
  return { cells, heights, split, faces };
}

/**
 * A chunk's fine surface (FINE_CELLS a side), grown from its base samples: their
 * heights are reused, the rest are new, and every corner knows the base
 * surface's height under it.
 */
export function fineSurface(seed: number, base: ChunkSamples, built: (x: number, y: number) => boolean = () => false): FineSurface {
  if (base.fine) return base.fine;
  const s = sampleSurface(seed, base.cx, base.cy, FINE_CELLS, base.near, built, FINE_SALT, base);
  const n = FINE_CELLS + 1;
  const coarse = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) coarse[j * n + i] = surfaceHeight(base, i / FINE, j / FINE);
  base.fine = { ...s, coarse };
  return base.fine;
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
  /** Only where the ground is even (not on a terrace's riser, a crag or a steep bank): trees and bushes. */
  even?: boolean;
  /** Thicker on crags (boulders gather where the rock breaks through). */
  crags?: number;
}

const RULES: Record<Layer, LayerRule> = {
  trees: {
    grid: 8,
    density: { lakebed: 0, sand: 0, green: 0, meadow: 0.07, forest: 0.7, rock: 0.05 },
    clearance: TREE_CLEARANCE,
    scale: [0.8, 1.4],
    even: true,
    // TREE_KINDS: 0 oak, 1 pine, 2 round, 3 parasol, 4 birch, 5 blossom. Forests are mostly pines, oaks and
    // birches; the meadows have their lone oaks and parasols, and here and there a tree in blossom.
    kind: (g, p) =>
      g === "forest" ? (p < 0.34 ? 1 : p < 0.64 ? 0 : p < 0.82 ? 4 : p < 0.92 ? 2 : p < 0.96 ? 3 : 5) : p < 0.32 ? 0 : p < 0.52 ? 3 : p < 0.67 ? 2 : p < 0.83 ? 4 : 5,
    salt: 1,
  },
  bushes: {
    grid: 10.67,
    density: { lakebed: 0, sand: 0.04, green: 0.05, meadow: 0.14, forest: 0.35, rock: 0.1 },
    clearance: 2,
    scale: [0.7, 1.3],
    even: true,
    // 0 leafy, 1 in flower, 2 fern (mostly under the trees).
    kind: (g, p) => (g === "forest" ? (p < 0.4 ? 0 : p < 0.55 ? 1 : 2) : p < 0.5 ? 0 : p < 0.82 ? 1 : 2),
    salt: 21,
  },
  flowers: {
    grid: 2.6,
    density: { lakebed: 0, sand: 0.02, green: 0.3, meadow: 0.46, forest: 0.08, rock: 0.05 },
    clearance: 0.5,
    scale: [1.3, 2.1],
    // 0 daisies, 1 lupines, 2 lavender, 3 buttercups, 4 campions.
    kind: (_g, p) => (p < 0.28 ? 0 : p < 0.46 ? 1 : p < 0.62 ? 2 : p < 0.82 ? 3 : 4),
    salt: 41,
    lawn: true,
  },
  grass: {
    grid: 1.7,
    density: { lakebed: 0, sand: 0.1, green: 0.42, meadow: 0.7, forest: 0.4, rock: 0.14 },
    clearance: 0.5,
    scale: [0.9, 1.8],
    // 0 a tuft, 1 a lush clump, 2 tall grass in seed.
    kind: (g, p) => (p < 0.55 ? 0 : p < (g === "forest" ? 0.95 : 0.85) ? 1 : 2),
    salt: 61,
    lawn: true,
  },
  rocks: {
    grid: 12.8,
    density: { lakebed: 0.06, sand: 0.1, green: 0, meadow: 0.12, forest: 0.14, rock: 0.62 },
    clearance: TREE_CLEARANCE,
    scale: [0.6, 2.4],
    // 0 a boulder, 1 a few stones, 2 a layered slab.
    kind: (_g, p) => Math.min(2, Math.floor(p * 3)),
    salt: 81,
    underwater: true,
    crags: 0.75,
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
  // (The keep's lawn grows grass and flowers; plots, the sites and the roads are kept bare.)
  for (const f of flats) if ((!lawn || f.kind !== "circle") && flatDistance(f, x, y) <= clearance) return false;
  return true;
}

/**
 * Where a layer grows on a chunk. Small things stand on the fine surface (`fine`,
 * exactly as it's drawn near the camera); big ones on the land's own height,
 * and the even-minded only where the base surface (`base`) agrees with it.
 */
function placeLayer(seed: number, cx: number, cy: number, near: readonly Flat[], rule: LayerRule, built: (x: number, y: number) => boolean, base: Surface, fine: Surface | null): Float64Array {
  const out: number[] = [];
  const x0 = cx * CHUNK;
  const y0 = cy * CHUNK;
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
      const z = fine ? surfaceHeight(fine, (x - x0) / FINE_CELL, (y - y0) / FINE_CELL) : heightAt(seed, x, y, near);
      if (z < WATER_LEVEL + 0.15 && !rule.underwater) continue;
      if (rule.even && Math.abs(surfaceHeight(base, (x - x0) / CELL, (y - y0) / CELL) - z) > 0.35) continue;
      const ground = groundAt(seed, x, y, z, 0);
      const density = rule.crags ? Math.max(rule.density[ground], outcrop(seed, x, y) * rule.crags) : rule.density[ground];
      if (hash3(seed, gx, gy, s) >= density) continue;
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
  const surface = sampleSurface(seed, cx, cy, CELLS, near, built, BASE_SALT);
  const samples: ChunkSamples = { cx, cy, ...surface, layers: {}, near };
  for (const layer of layerList) growLayer(seed, samples, layer, built);
  return samples;
}

/** A chunk's layer, grown now if it wasn't yet (the small ones, when the chunk comes near). */
export function growLayer(seed: number, s: ChunkSamples, layer: Layer, built: (x: number, y: number) => boolean = () => false): Float64Array {
  let packed = s.layers[layer];
  if (!packed) packed = s.layers[layer] = placeLayer(seed, s.cx, s.cy, s.near, RULES[layer], built, s, SMALL.includes(layer) ? fineSurface(seed, s, built) : null);
  return packed;
}

/** A seed's fingerprint for tests and diagnostics. */
export const seedHash = (seed: number): number => hash2(seed, 0, 0);
