import { BIOMES, BIRCHWOOD, climateLocal, dunesOf, emptyClimate, HEATH, kindNoise, LAWN, marginNoise, MARSH, MEADOW, moistureBase, moistureFrom, OUTCROP, PINEWOOD, rainNoise, SHORE, WATER, weightsFrom, WOODLAND, woodsOf } from "./biome.ts";
import { TRAIL } from "./hearth-plan.ts";
import { hash2, hash3, simplex, smoothstep } from "./noise.ts";
import { type Flat, flatDistance, flatMix, heightAt, outcrop, SITE_FLATS, streamAt, streamLevel, WATER_LEVEL } from "./relief.ts";

/*
 * The SANDBOX's land, as it's drawn and as it grows: an endless field of 64 m
 * chunks from one seed. The land's shape is relief.ts' (re-exported here: hills,
 * lakes, streams, and the bigger landforms farther afield) and its climate and
 * biomes are biome.ts'; this is each chunk's surface (heights on a grid, every
 * triangle's colour) and where every layer of growth stands on it.
 *
 * Each chunk is sampled on a base grid (4 m cells) and, near the camera, a fine
 * one (2 m cells) whose vertices include the base grid's; every cell is split
 * along its more level diagonal, so ledges and banks stay crisp. Small things
 * for the fine grid to show: the meadows ripple, crags break through the turf,
 * some hillsides step down in gentle terraces and streams cut crisp banks.
 *
 * A chunk samples its climate once, at its base grid's corners; the colour of
 * every face and the mix and density of everything that grows are read from it
 * (and from the height each thing stands at), so the ground and its growth
 * change together from one biome into the next, softly: at an edge the two
 * mix. Nothing here knows the date: where things stand is the seed's, the
 * chunk's and the flats'. The season only changes how they're drawn
 * (vegetation.ts, land.ts).
 *
 * Pure and deterministic: the same seed and the same plots give the same land
 * on every device. World coordinates (metres, x east, y north, z up), as in
 * the contract.
 */

export * from "./relief.ts";

export const CHUNK = 64;
/** The base grid, drawn everywhere: cells a chunk's side (4 m). */
export const CELLS = 16;
export const CELL = CHUNK / CELLS;
/** The fine grid near the camera: each base cell split this many ways a side (2 m cells). */
export const FINE = 2;
export const FINE_CELLS = CELLS * FINE;
export const FINE_CELL = CHUNK / FINE_CELLS;
/** No trees this close to flat ground. */
const TREE_CLEARANCE = 4;

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

/**
 * The ground's colour in each biome (sRGB), as it is in summer: the season lays its own tints over it in the land's
 * shader (land.ts), by how much of each face is grass, heath, a deciduous wood's floor or marsh (its `cover`).
 */
const BIOME_COLOR: readonly number[] = [
  GROUND_COLOR.lakebed, // water
  GROUND_COLOR.sand, // shore
  0x8bb262, // marsh: a wet, deeper green
  GROUND_COLOR.meadow, // meadow
  0xa9b56a, // heath: dry and olive under the heather
  GROUND_COLOR.forest, // woodland
  0x93ba50, // birchwood: lighter under the thin crowns
  0x8ca454, // pinewood: needles in the grass
  GROUND_COLOR.rock, // outcrop
  GROUND_COLOR.green, // lawn
];
/** How much of each biome's ground is grass (it pales in autumn and winter, and the wind shows in it). */
const GRASS_COVER: readonly number[] = [0, 0.08, 0.6, 1, 0.5, 0.85, 0.9, 0.6, 0.06, 0.9];
/** How much of it lies under deciduous trees (their leaves lie on it by late autumn). */
const LITTER_COVER: readonly number[] = [0, 0, 0.3, 0.07, 0, 1, 0.85, 0.12, 0, 0];

/** Patches of sunnier, yellower grass and of lusher green across the meadows. */
const SUNNY = 0xc2d66a;
const LUSH = 0x7fb447;

/** A ground's colour at (x, y): its base, with broad patches of sunnier or lusher grass. */
export function groundColor(seed: number, x: number, y: number, ground: Ground): number {
  const base = GROUND_COLOR[ground];
  if (ground !== "meadow" && ground !== "green" && ground !== "forest") return base;
  const n = patchNoise(seed, x, y);
  return n > 0 ? mixHex(base, SUNNY, Math.min(1, n) * 0.55) : mixHex(base, LUSH, Math.min(1, -n) * 0.45);
}

/** The noise that lays out the sunny and lush patches. */
const patchNoise = (seed: number, x: number, y: number): number => simplex(seed + 71, x / 38, y / 38) + 0.4 * simplex(seed + 73, x / 11, y / 11);

function mixHex(a: number, b: number, t: number): number {
  const ch = (k: number) => Math.round(((a >> k) & 255) * (1 - t) + ((b >> k) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** The ground's kind at (x, y), height `h`, on a flat by `flat` (the coarse kinds the land had before its biomes; biome.ts says more). */
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

/**
 * What grows on a chunk, by layer: the big things (trees, bushes, rocks and deadwood, the reeds of the water's edge),
 * then what's underfoot (grown only near the camera).
 */
export const LAYERS = ["trees", "bushes", "rocks", "reeds", "flowers", "grass", "detail"] as const;
export type Layer = (typeof LAYERS)[number];
/** The small layers: grown when a chunk first comes near the camera's focus. */
export const SMALL: readonly Layer[] = ["flowers", "grass", "detail"];
export const BIG: readonly Layer[] = ["trees", "bushes", "rocks", "reeds"];

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
  /**
   * What covers each triangle, four bytes each (0 to 255): how much of it is grass, heath, a deciduous wood's floor,
   * marsh. The season tints the ground by them.
   */
  cover: Uint8Array;
  /**
   * Each triangle's biomes, a byte a biome (as BIOMES, 0 to 255: their shares of it). What's small grows by them, so
   * a flower is of the ground it stands on.
   */
  biomes: Uint8Array;
}

/**
 * A chunk's climate, sampled at its base grid's corners (row by row from its south-west corner): the few numbers its
 * faces and its growth need of it (biome.ts says what each is).
 */
export interface ChunkClimate {
  /** The moisture's share that doesn't depend on a point's own height and slope (biome.ts' moistureBase). */
  moist: Float32Array;
  /** Where the woods are (woodsOf) and of which kind; where dunes lie (dunesOf). */
  woods: Float32Array;
  kind: Float32Array;
  dunes: Float32Array;
  rockline: Float32Array;
  crag: Float32Array;
  /** How far from a stream's bed. */
  stream: Float32Array;
  ridge: Float32Array;
  upland: Float32Array;
  lift: Float32Array;
  /** The slope, and the hollow. */
  gx: Float32Array;
  gy: Float32Array;
  hollow: Float32Array;
}

const CLIMATE_FIELDS = ["moist", "woods", "kind", "dunes", "rockline", "crag", "stream", "ridge", "upland", "lift", "gx", "gy", "hollow"] as const;

export interface ChunkSamples extends Surface {
  cx: number;
  cy: number;
  /** Packed placements per layer (STRIDE numbers each); a small layer only once grown. */
  layers: Partial<Record<Layer, Float64Array>>;
  /** The flats that shape it (for growing its small layers later). */
  near: readonly Flat[];
  /** Its climate at its corners. */
  climate: ChunkClimate;
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
/** A marsh's bare mud, between its tussocks. */
const MUD = 0x9a9a6c;
const FACE_JITTER = 0.035;

/**
 * A chunk's climate at its base grid's corners. The slope and the hollow at a corner come from the heights of its
 * four neighbours on the grid (those beyond the chunk's edge are asked of the land), so they're exactly biome.ts'
 * climateAt there.
 */
function chunkClimate(seed: number, cx: number, cy: number, heights: Float32Array, near: readonly Flat[]): ChunkClimate {
  const n = CELLS + 1;
  const x0 = cx * CHUNK;
  const y0 = cy * CHUNK;
  const out = {} as ChunkClimate;
  for (const f of CLIMATE_FIELDS) out[f] = new Float32Array(n * n);
  const c = scratch;
  // The slowest noises (hundreds of metres to a wave) on every fourth corner, and between them in straight lines.
  for (let j = 0; j <= SLOW; j++) {
    for (let i = 0; i <= SLOW; i++) {
      const x = x0 + i * (CHUNK / SLOW);
      const y = y0 + j * (CHUNK / SLOW);
      slow[(j * (SLOW + 1) + i) * 3] = kindNoise(seed, x, y);
      slow[(j * (SLOW + 1) + i) * 3 + 1] = rainNoise(seed, x, y);
      slow[(j * (SLOW + 1) + i) * 3 + 2] = marginNoise(seed, x, y);
    }
  }
  const per = CELLS / SLOW;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = x0 + i * CELL;
      const y = y0 + j * CELL;
      const k = j * n + i;
      const si = Math.min(SLOW - 1, Math.floor(i / per));
      const sj = Math.min(SLOW - 1, Math.floor(j / per));
      const fi = i / per - si;
      const fj = j / per - sj;
      const a = (sj * (SLOW + 1) + si) * 3;
      const b = a + 3;
      const d = a + (SLOW + 1) * 3;
      const e = d + 3;
      c.kind = (slow[a]! * (1 - fi) + slow[b]! * fi) * (1 - fj) + (slow[d]! * (1 - fi) + slow[e]! * fi) * fj;
      c.rain = (slow[a + 1]! * (1 - fi) + slow[b + 1]! * fi) * (1 - fj) + (slow[d + 1]! * (1 - fi) + slow[e + 1]! * fi) * fj;
      c.margin = (slow[a + 2]! * (1 - fi) + slow[b + 2]! * fi) * (1 - fj) + (slow[d + 2]! * (1 - fi) + slow[e + 2]! * fi) * fj;
      climateLocal(seed, x, y, c);
      const east = i < CELLS ? heights[k + 1]! : heightAt(seed, x + CELL, y, near);
      const west = i > 0 ? heights[k - 1]! : heightAt(seed, x - CELL, y, near);
      const north = j < CELLS ? heights[k + n]! : heightAt(seed, x, y + CELL, near);
      const south = j > 0 ? heights[k - n]! : heightAt(seed, x, y - CELL, near);
      out.gx[k] = (east - west) / 8;
      out.gy[k] = (north - south) / 8;
      out.hollow[k] = (east + west + north + south) / 4 - heights[k]!;
      out.moist[k] = moistureBase(c);
      out.woods[k] = woodsOf(c);
      out.kind[k] = c.kind;
      out.dunes[k] = dunesOf(c);
      out.rockline[k] = c.rockline;
      out.crag[k] = c.crag;
      out.stream[k] = c.stream;
      out.ridge[k] = c.ridge;
      out.upland[k] = c.upland;
      out.lift[k] = c.lift;
    }
  }
  return out;
}

const scratch = emptyClimate();
const weights = new Float32Array(BIOMES.length);
/** A chunk's slowest noises are sampled this many cells a side (16 m apart): kind, rain, margin at each. */
const SLOW = 4;
const slow = new Float64Array((SLOW + 1) * (SLOW + 1) * 3);
/** A face this far under the lakes' level is the lake's floor and nothing else; shallower, it still knows its shore's biomes (for what floats over it). */
const SHALLOWS = 1.15;

/**
 * Where (u, v), in base cells from a chunk's south-west corner, falls among its grid's corners: the four corners'
 * places and their shares, kept here for `lerp` (set once a point, read for every field: nothing is allocated).
 */
let k00 = 0;
let k10 = 0;
let k01 = 0;
let k11 = 0;
let w00 = 0;
let w10 = 0;
let w01 = 0;
let w11 = 0;
function cornersOf(u: number, v: number): void {
  const i = u <= 0 ? 0 : u >= CELLS ? CELLS - 1 : Math.floor(u);
  const j = v <= 0 ? 0 : v >= CELLS ? CELLS - 1 : Math.floor(v);
  const fu = u <= i ? 0 : u >= i + 1 ? 1 : u - i;
  const fv = v <= j ? 0 : v >= j + 1 ? 1 : v - j;
  k00 = j * (CELLS + 1) + i;
  k10 = k00 + 1;
  k01 = k00 + CELLS + 1;
  k11 = k01 + 1;
  w00 = (1 - fu) * (1 - fv);
  w10 = fu * (1 - fv);
  w01 = (1 - fu) * fv;
  w11 = fu * fv;
}
/** A field of the chunk's climate at the point last given to `cornersOf`. */
const lerp = (f: Float32Array): number => f[k00]! * w00 + f[k10]! * w10 + f[k01]! * w01 + f[k11]! * w11;

/** The colour noises of a grid's corners (the patches of sunnier and lusher grass, and where feet have worn the turf). */
interface Fields {
  patch: Float32Array;
  built: Uint8Array;
}

function fields(seed: number, x0: number, y0: number, cells: number, built: (x: number, y: number) => boolean): Fields {
  const n = cells + 1;
  const cell = CHUNK / cells;
  const f: Fields = { patch: new Float32Array(n * n), built: new Uint8Array(n * n) };
  // Only near the keep, on the sites and along the roads to them is anything built (and asking is slow).
  const keep =
    Math.hypot(Math.max(Math.abs(x0 + CHUNK / 2) - CHUNK / 2, 0), Math.max(Math.abs(y0 + CHUNK / 2) - CHUNK / 2, 0)) < 80 ||
    SITE_FLATS.some((f) => flatDistance(f, Math.max(x0, Math.min(f.x, x0 + CHUNK)), Math.max(y0, Math.min(f.y, y0 + CHUNK))) < 2);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = x0 + i * cell;
      const y = y0 + j * cell;
      const k = j * n + i;
      f.patch[k] = patchNoise(seed, x, y);
      f.built[k] = keep && built(x, y) ? 1 : 0;
    }
  }
  return f;
}

/** What faceColor found: the face's colour (sRGB) and what covers it. */
const face = { color: 0, grass: 0, heath: 0, litter: 0, marsh: 0 };

/** A colour's red, green and blue (0 to 255). */
const rgb = (hex: number): readonly [number, number, number] => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const BIOME_RGB = BIOME_COLOR.map(rgb);
const SUNNY_RGB = rgb(SUNNY);
const LUSH_RGB = rgb(LUSH);
const MUD_RGB = rgb(MUD);
const EARTH_RGB = rgb(EARTH);
const ROCK_RGB = rgb(GROUND_COLOR.rock);
const CLIFF_RGB = rgb(0xcdb39f);
const WORN_RGB = rgb(WORN);
const LAKEBED_RGB = rgb(GROUND_COLOR.lakebed);

/**
 * A face's colour and cover, into `face`: its biomes' ground colours in their
 * shares (so one ground turns into the next softly), with the meadows' sunny
 * and lush patches, bare earth where it's steep, rock on crags and cliffs, mud
 * between a marsh's tussocks, worn where feet go, and a little per-face
 * variation for the low-poly look. `w` is its biomes' shares, `crag` how much
 * of a crag it is; `patch` and `worn` its corners' (averaged); `ny` its
 * normal's vertical part, `jitter` a hash in [0, 1). (Thousands a chunk: plain
 * numbers, nothing allocated.)
 */
function faceColor(w: Float32Array | null, crag: number, patch: number, worn: boolean, ny: number, jitter: number): void {
  const k = 1 - FACE_JITTER + 2 * FACE_JITTER * jitter;
  if (!w) {
    face.color = (Math.round(LAKEBED_RGB[0] * k) << 16) | (Math.round(LAKEBED_RGB[1] * k) << 8) | Math.round(LAKEBED_RGB[2] * k);
    face.grass = face.heath = face.litter = face.marsh = 0;
    return;
  }
  let r = 0;
  let g = 0;
  let b = 0;
  let grass = 0;
  let litter = 0;
  for (let i = 1; i < BIOMES.length; i++) {
    const wi = w[i]!;
    if (wi <= 0) continue;
    const c = BIOME_RGB[i]!;
    r += c[0] * wi;
    g += c[1] * wi;
    b += c[2] * wi;
    grass += GRASS_COVER[i]! * wi;
    litter += LITTER_COVER[i]! * wi;
  }
  // Sunnier and lusher patches wherever grass grows.
  const turf = w[MEADOW]! + w[LAWN]! + w[WOODLAND]! + w[BIRCHWOOD]! + 0.6 * (w[PINEWOOD]! + w[HEATH]!) + 0.5 * w[MARSH]!;
  if (turf > 0) {
    const to = patch > 0 ? SUNNY_RGB : LUSH_RGB;
    const t = (patch > 0 ? Math.min(1, patch) * 0.55 : Math.min(1, -patch) * 0.45) * turf;
    r += (to[0] - r) * t;
    g += (to[1] - g) * t;
    b += (to[2] - b) * t;
  }
  // A marsh's mud shows between its tussocks, more the wetter it is.
  if (w[MARSH]! > 0.05 && patch > -0.2) {
    const t = w[MARSH]! * smoothstep(-0.2, 0.7, patch) * 0.5;
    r += (MUD_RGB[0] - r) * t;
    g += (MUD_RGB[1] - g) * t;
    b += (MUD_RGB[2] - b) * t;
  }
  let bare = 0;
  const soft = 1 - w[OUTCROP]! - w[LAWN]!;
  if (soft > 0 && (ny < 0.95 || crag > 0.45)) {
    const steep = ny < 0.95 ? smoothstep(0.95, 0.8, ny) : 0;
    if (steep > 0) {
      const t = steep * 0.45 * soft;
      r += (EARTH_RGB[0] - r) * t;
      g += (EARTH_RGB[1] - g) * t;
      b += (EARTH_RGB[2] - b) * t;
    }
    const rocky = Math.max(crag > 0.45 ? smoothstep(0.45, 0.8, crag) : 0, ny < 0.8 ? smoothstep(0.8, 0.62, ny) : 0) * soft;
    if (rocky > 0) {
      r += (ROCK_RGB[0] - r) * rocky;
      g += (ROCK_RGB[1] - g) * rocky;
      b += (ROCK_RGB[2] - b) * rocky;
    }
    bare = Math.max(steep * 0.45, rocky) * soft;
  }
  // A cliff's face a little warmer and darker than its top.
  if (w[OUTCROP]! > 0 && ny < 0.9) {
    const t = smoothstep(0.9, 0.6, ny) * w[OUTCROP]!;
    r += (CLIFF_RGB[0] - r) * t;
    g += (CLIFF_RGB[1] - g) * t;
    b += (CLIFF_RGB[2] - b) * t;
  }
  if (worn && w[LAWN]! > 0.5) {
    r += (WORN_RGB[0] - r) * 0.45;
    g += (WORN_RGB[1] - g) * 0.45;
    b += (WORN_RGB[2] - b) * 0.45;
  }
  face.color = (Math.min(255, Math.round(r * k)) << 16) | (Math.min(255, Math.round(g * k)) << 8) | Math.min(255, Math.round(b * k));
  const open = 1 - bare;
  face.grass = grass * open * (worn ? 0.5 : 1);
  face.heath = w[HEATH]! * open;
  face.litter = litter * open;
  face.marsh = w[MARSH]! * open;
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
 * surface already has (at every few corners) are taken from it, not computed again;
 * the climate is the chunk's own (`climate`), or sampled now for its base grid.
 */
function sampleSurface(seed: number, cx: number, cy: number, cells: number, near: readonly Flat[], built: (x: number, y: number) => boolean, salt: number, from?: Surface, climate?: ChunkClimate): Surface & { climate: ChunkClimate } {
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
  const cl = climate ?? chunkClimate(seed, cx, cy, heights, near);
  const split = new Uint8Array(cells * cells);
  const faces = new Uint32Array(cells * cells * 2);
  const cover = new Uint8Array(cells * cells * 8);
  const N = BIOMES.length;
  const biomes = new Uint8Array(cells * cells * 2 * N);
  const f = fields(seed, x0, y0, cells, built);
  const gi0 = cx * cells;
  const gj0 = cy * cells;
  const toBase = CELLS / cells;
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const h00 = heights[j * n + i]!;
      const h10 = heights[j * n + i + 1]!;
      const h01 = heights[(j + 1) * n + i]!;
      const h11 = heights[(j + 1) * n + i + 1]!;
      const k = splitOf(seed, gi0 + i, gj0 + j, salt, h00, h10, h01, h11);
      split[j * cells + i] = k;
      const s = SPLITS[k]!;
      // Two triangles per cell; each one's corners, centroid and slope decide its colour.
      for (let t = 0; t < 2; t++) {
        const a = (j + s[t * 6 + 1]!) * n + i + s[t * 6]!;
        const b = (j + s[t * 6 + 3]!) * n + i + s[t * 6 + 2]!;
        const d = (j + s[t * 6 + 5]!) * n + i + s[t * 6 + 4]!;
        const g = gradient(s, t, heights[a]!, heights[b]!, heights[d]!, cell);
        const ny = 1 / Math.sqrt(1 + g[0]! * g[0]! + g[1]! * g[1]!);
        const u = i + (s[t * 6]! + s[t * 6 + 2]! + s[t * 6 + 4]!) / 3;
        const v = j + (s[t * 6 + 1]! + s[t * 6 + 3]! + s[t * 6 + 5]!) / 3;
        let h = (heights[a]! + heights[b]! + heights[d]!) / 3;
        const q = (j * cells + i) * 2 + t;
        const patch = (f.patch[a]! + f.patch[b]! + f.patch[d]!) / 3;
        const jitter = hash3(seed, gi0 + i, gj0 + j, salt * 4 + t + 7);
        if (h < WATER_LEVEL - SHALLOWS) {
          faceColor(null, 0, patch, false, ny, jitter);
          biomes[q * N + WATER] = 255;
        } else {
          // (The shallows are their shore's: sand under clear water, a reed bed's mud.)
          const floor = h < WATER_LEVEL - 0.2;
          if (h < WATER_LEVEL + 0.02) h = WATER_LEVEL + 0.02;
          cornersOf(u * toBase, v * toBase);
          const crag = lerp(cl.crag);
          // (The face's own slope: its aspect is its own, not its neighbourhood's.)
          const m = moistureFrom(lerp(cl.moist), h, g[0]!, g[1]!, lerp(cl.hollow));
          weightsFrom(weights, h, near.length ? flatMix(near, x0 + u * cell, y0 + v * cell) : 0, m, lerp(cl.woods), lerp(cl.kind), lerp(cl.rockline), crag, lerp(cl.ridge), lerp(cl.upland), lerp(cl.lift), lerp(cl.dunes));
          for (let n2 = 0; n2 < N; n2++) biomes[q * N + n2] = Math.round(weights[n2]! * 255);
          if (floor) faceColor(null, 0, patch, false, ny, jitter);
          else faceColor(weights, crag, patch, f.built[a]! + f.built[b]! + f.built[d]! >= 2, ny, jitter);
        }
        faces[q] = face.color;
        cover[q * 4] = Math.round(Math.min(1, face.grass) * 255);
        cover[q * 4 + 1] = Math.round(Math.min(1, face.heath) * 255);
        cover[q * 4 + 2] = Math.round(Math.min(1, face.litter) * 255);
        cover[q * 4 + 3] = Math.round(Math.min(1, face.marsh) * 255);
      }
    }
  }
  return { cells, heights, split, faces, cover, biomes, climate: cl };
}

/**
 * A chunk's fine surface (FINE_CELLS a side), grown from its base samples: their
 * heights are reused, the rest are new, and every corner knows the base
 * surface's height under it.
 */
export function fineSurface(seed: number, base: ChunkSamples, built: (x: number, y: number) => boolean = () => false): FineSurface {
  if (base.fine) return base.fine;
  const s = sampleSurface(seed, base.cx, base.cy, FINE_CELLS, base.near, built, FINE_SALT, base, base.climate);
  const n = FINE_CELLS + 1;
  const coarse = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) coarse[j * n + i] = surfaceHeight(base, i / FINE, j / FINE);
  base.fine = { cells: s.cells, heights: s.heights, split: s.split, faces: s.faces, cover: s.cover, biomes: s.biomes, coarse };
  return base.fine;
}

/** Scales an sRGB colour's brightness (per-face variation for the low-poly look). */
export function shade(color: number, k: number): number {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return (c((color >> 16) & 255) << 16) | (c((color >> 8) & 255) << 8) | c(color & 255);
}

/**
 * The kinds of each layer (a placement's kind is an index here): the models are vegetation.ts', and what's solid
 * about the trees and the rocks is flora-plan.ts'.
 */
export const TREE_KINDS = ["oak", "pine", "round", "parasol", "birch", "blossom", "spruce", "alder", "willow"] as const;
export const BUSH_KINDS = ["leafy", "flowering", "fern", "gorse", "heather"] as const;
export const ROCK_KINDS = ["boulder", "stones", "slab", "log"] as const;
export const REED_KINDS = ["reeds", "cattails", "rushes"] as const;
export const FLOWER_KINDS = ["daisy", "lupine", "lavender", "buttercup", "campion", "anemone", "heather"] as const;
export const GRASS_KINDS = ["tuft", "lush", "seed", "marram", "rush"] as const;
export const DETAIL_KINDS = ["pebbles", "clover", "mushrooms", "litter", "driftwood", "lily"] as const;

interface LayerRule {
  /** Grid spacing, metres: at most one per cell. */
  grid: number;
  /** How many of its cells are taken in each biome (indexed as BIOMES). */
  density: readonly number[];
  /** How far from flat ground it keeps. */
  clearance: number;
  scale: [number, number];
  /** Which model, for a pick in [0, 1) in a biome. */
  kind(biome: number, pick: number): number;
  salt: number;
  /** Also on the lakebed (rocks). */
  underwater?: boolean;
  /** Grows out into the water this deep, metres (reeds; in still water, lily pads float where it's no deeper). */
  wade?: number;
  /** Grows on the keep's lawn too (not on plots, nor where something is built). */
  lawn?: boolean;
  /** Only where the ground is even (not on a terrace's riser, a crag or a steep bank): trees and bushes. */
  even?: boolean;
  /** Thicker on crags (boulders gather where the rock breaks through). */
  crags?: number;
  /** Solid (walkers and the camera meet it): keeps off the trail he walks. */
  solid?: boolean;
  /** Only this low over the lakes' level, metres (reeds: the wet ground at the water's edge). */
  low?: number;
}

/** A pick among kinds by their shares: `table` is kind, share, kind, share… (the last kind takes the rest). */
function among(table: readonly number[], pick: number): number {
  let sum = 0;
  for (let i = 0; i + 1 < table.length; i += 2) {
    sum += table[i + 1]!;
    if (pick < sum) return table[i]!;
  }
  return table[table.length - 2]!;
}

// The trees of each biome (TREE_KINDS: 0 oak, 1 pine, 2 round, 3 parasol, 4 birch, 5 blossom, 6 spruce, 7 alder, 8 willow).
const TREES: Record<number, readonly number[]> = {
  // The meadows have their lone oaks and parasols, and here and there a tree in blossom.
  [MEADOW]: [0, 0.32, 3, 0.2, 2, 0.15, 4, 0.16, 5, 0.17],
  [WOODLAND]: [0, 0.4, 2, 0.2, 3, 0.1, 4, 0.08, 5, 0.07, 7, 0.05, 1, 0.06, 6, 0.04],
  [BIRCHWOOD]: [4, 0.74, 0, 0.08, 2, 0.06, 1, 0.06, 7, 0.06],
  [PINEWOOD]: [1, 0.5, 6, 0.36, 4, 0.09, 0, 0.05],
  [HEATH]: [1, 0.5, 4, 0.42, 0, 0.08],
  [MARSH]: [7, 0.46, 8, 0.38, 4, 0.16],
  [OUTCROP]: [1, 0.6, 4, 0.4],
  [SHORE]: [1, 0.6, 4, 0.4],
};
// Bushes (BUSH_KINDS: 0 leafy, 1 in flower, 2 fern, 3 gorse, 4 a mound of heather).
const BUSHES: Record<number, readonly number[]> = {
  [MEADOW]: [0, 0.5, 1, 0.32, 2, 0.18],
  [LAWN]: [0, 0.5, 1, 0.32, 2, 0.18],
  [WOODLAND]: [0, 0.4, 1, 0.15, 2, 0.45],
  [BIRCHWOOD]: [2, 0.5, 0, 0.3, 1, 0.2],
  [PINEWOOD]: [2, 0.55, 0, 0.25, 4, 0.2],
  [HEATH]: [4, 0.55, 3, 0.45],
  [MARSH]: [0, 0.6, 2, 0.4],
  [SHORE]: [3, 0.5, 0, 0.5],
  [OUTCROP]: [0, 0.4, 3, 0.3, 4, 0.3],
};
// Rocks and deadwood (ROCK_KINDS: 0 a boulder, 1 a few stones, 2 a layered slab, 3 a fallen log by its stump).
const DEADWOOD: readonly number[] = [0, 0.26, 1, 0.14, 2, 0.12, 3, 0.48];
// Flowers (FLOWER_KINDS: 0 daisies, 1 lupines, 2 lavender, 3 buttercups, 4 campions, 5 wood anemones, 6 heather).
const MEADOW_FLOWERS: readonly number[] = [0, 0.28, 1, 0.18, 2, 0.16, 3, 0.2, 4, 0.18];
const FLOWERS: Record<number, readonly number[]> = {
  [WOODLAND]: [5, 0.72, 4, 0.14, 3, 0.14],
  [BIRCHWOOD]: [5, 0.72, 4, 0.14, 3, 0.14],
  [PINEWOOD]: [6, 0.5, 5, 0.3, 4, 0.2],
  [HEATH]: [6, 0.9, 3, 0.1],
  [MARSH]: [3, 0.6, 4, 0.4],
  [SHORE]: [2, 0.5, 0, 0.5],
  [OUTCROP]: [2, 0.5, 6, 0.5],
};
// Grass (GRASS_KINDS: 0 a tuft, 1 a lush clump, 2 tall grass in seed, 3 marram, 4 a tussock of rushes).
const GRASSES: Record<number, readonly number[]> = {
  [WOODLAND]: [0, 0.55, 1, 0.4, 2, 0.05],
  [BIRCHWOOD]: [0, 0.55, 1, 0.4, 2, 0.05],
  [PINEWOOD]: [0, 0.6, 1, 0.3, 2, 0.1],
  [SHORE]: [3, 0.85, 0, 0.15],
  [MARSH]: [4, 0.6, 1, 0.4],
  [HEATH]: [0, 0.5, 2, 0.3, 3, 0.2],
};
const MEADOW_GRASS: readonly number[] = [0, 0.55, 1, 0.3, 2, 0.15];
// Underfoot (DETAIL_KINDS: 0 pebbles, 1 clover, 2 mushrooms, 3 fallen leaves, 4 driftwood, 5 a lily pad).
const DETAIL: Record<number, readonly number[]> = {
  [SHORE]: [0, 0.8, 4, 0.2],
  [OUTCROP]: [0, 1],
  [WOODLAND]: [3, 0.6, 2, 0.12, 0, 0.13, 1, 0.15],
  [BIRCHWOOD]: [3, 0.6, 2, 0.12, 0, 0.13, 1, 0.15],
  [PINEWOOD]: [0, 0.5, 2, 0.25, 3, 0.25],
  [HEATH]: [0, 0.7, 1, 0.3],
  [MARSH]: [1, 0.5, 0, 0.5],
};
const MEADOW_DETAIL: readonly number[] = [0, 0.25, 1, 0.75];

// Densities are indexed as BIOMES: water, shore, marsh, meadow, heath, woodland, birchwood, pinewood, outcrop, lawn.
const RULES: Record<Layer, LayerRule> = {
  trees: {
    grid: 8,
    density: [0, 0, 0.2, 0.07, 0.035, 0.7, 0.62, 0.74, 0.05, 0],
    clearance: TREE_CLEARANCE,
    scale: [0.8, 1.4],
    even: true,
    solid: true,
    kind: (b, p) => among(TREES[b] ?? TREES[MEADOW]!, p),
    salt: 1,
  },
  bushes: {
    grid: 10.67,
    density: [0, 0.05, 0.22, 0.14, 0.55, 0.36, 0.3, 0.34, 0.1, 0.05],
    clearance: 2,
    scale: [0.7, 1.3],
    even: true,
    kind: (b, p) => among(BUSHES[b] ?? BUSHES[MEADOW]!, p),
    salt: 21,
  },
  flowers: {
    grid: 2.6,
    density: [0, 0.03, 0.2, 0.46, 0.8, 0.3, 0.26, 0.16, 0.06, 0.3],
    clearance: 0.5,
    scale: [1.3, 2.1],
    kind: (b, p) => among(FLOWERS[b] ?? MEADOW_FLOWERS, p),
    salt: 41,
    lawn: true,
  },
  grass: {
    grid: 1.7,
    density: [0, 0.3, 0.6, 0.7, 0.42, 0.4, 0.5, 0.26, 0.14, 0.42],
    clearance: 0.5,
    scale: [0.9, 1.8],
    kind: (b, p) => among(GRASSES[b] ?? MEADOW_GRASS, p),
    salt: 61,
    lawn: true,
  },
  rocks: {
    grid: 12.8,
    density: [0.06, 0.1, 0.05, 0.12, 0.1, 0.15, 0.15, 0.15, 0.62, 0],
    clearance: TREE_CLEARANCE,
    scale: [0.6, 2.4],
    // In a wood, half of them are deadwood; elsewhere a boulder, a few stones or a layered slab.
    kind: (b, p) => (b === WOODLAND || b === BIRCHWOOD || b === PINEWOOD ? among(DEADWOOD, p) : Math.min(2, Math.floor(p * 3))),
    salt: 81,
    underwater: true,
    crags: 0.75,
    solid: true,
  },
  reeds: {
    grid: 4,
    density: [0, 0.03, 0.6, 0, 0, 0, 0, 0, 0, 0],
    clearance: 2,
    scale: [0.8, 1.35],
    // REED_KINDS: 0 reeds, 1 cattails, 2 a stand of rushes (on the wet ground, not in the water).
    kind: (_b, p) => (p < 0.5 ? 0 : p < 0.72 ? 1 : 2),
    salt: 121,
    wade: 0.55,
    low: 2.6,
  },
  detail: {
    grid: 2.1,
    density: [0, 0.3, 0.2, 0.26, 0.2, 0.62, 0.62, 0.34, 0.34, 0.22],
    clearance: 0.3,
    scale: [0.8, 1.5],
    kind: (b, p) => among(DETAIL[b] ?? MEADOW_DETAIL, p),
    salt: 101,
    lawn: true,
    wade: 1.1,
  },
};

function clearOfFlats(flats: readonly Flat[], x: number, y: number, clearance: number, lawn = false): boolean {
  // (The keep's lawn grows grass and flowers; plots, the sites and the roads are kept bare.)
  for (const f of flats) if ((!lawn || f.kind !== "circle") && flatDistance(f, x, y) <= clearance) return false;
  return true;
}

/** Nothing solid grows this near the trail he and the dog walk (hearth-plan.ts), nor its stops. */
const TRAIL_CLEAR = 1.6;
const TRAIL_BOX = (() => {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of TRAIL) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return [x0 - TRAIL_CLEAR, y0 - TRAIL_CLEAR, x1 + TRAIL_CLEAR, y1 + TRAIL_CLEAR] as const;
})();

/** On the trail: within TRAIL_CLEAR of the line from each of its points to the next, round again. */
export function onTrail(x: number, y: number): boolean {
  if (x < TRAIL_BOX[0] || y < TRAIL_BOX[1] || x > TRAIL_BOX[2] || y > TRAIL_BOX[3]) return false;
  for (let i = 0; i < TRAIL.length; i++) {
    const a = TRAIL[i]!;
    const b = TRAIL[(i + 1) % TRAIL.length]!;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (y - a.y) * ey) / (ex * ex + ey * ey)));
    const dx = a.x + ex * t - x;
    const dy = a.y + ey * t - y;
    if (dx * dx + dy * dy < TRAIL_CLEAR * TRAIL_CLEAR) return true;
  }
  return false;
}

/** How many of the still shallows' cells off a reedy margin carry a lily pad. */
const LILIES = 0.34;

/**
 * One biome for something small at (u, v), in a surface's cells from the chunk's south-west corner: one of the biomes of
 * the triangle it stands on, by their shares of it and a hash in [0, 1).
 */
function biomeOn(s: Surface, u: number, v: number, pick: number): number {
  const i = Math.max(0, Math.min(s.cells - 1, Math.floor(u)));
  const j = Math.max(0, Math.min(s.cells - 1, Math.floor(v)));
  const fu = u - i;
  const fv = v - j;
  // (Which of the cell's two triangles: as cellHeight has it.)
  const t = s.split[j * s.cells + i] === 0 ? (fu >= fv ? 0 : 1) : fu + fv <= 1 ? 0 : 1;
  const at = ((j * s.cells + i) * 2 + t) * BIOMES.length;
  let total = 0;
  for (let k = 0; k < BIOMES.length; k++) total += s.biomes[at + k]!;
  let sum = 0;
  const to = pick * total;
  for (let k = 0; k < BIOMES.length; k++) {
    sum += s.biomes[at + k]!;
    if (to < sum) return k;
  }
  return MEADOW;
}

/** One biome for a placement, by the biomes' shares there and a hash in [0, 1): at an edge the two sides mix. */
function pickBiome(w: Float32Array, pick: number): number {
  let sum = 0;
  for (let i = 0; i < w.length; i++) {
    sum += w[i]!;
    if (pick < sum) return i;
  }
  return MEADOW;
}

/**
 * Where a layer grows on a chunk. Small things stand on the fine surface (`fine`,
 * exactly as it's drawn near the camera); big ones on the land's own height,
 * and the even-minded only where the base surface (`base`) agrees with it. Each
 * takes the biome of where it stands (one of them, by their shares there), and
 * with it how thickly its layer grows and which of its kinds it is.
 */
function placeLayer(seed: number, cx: number, cy: number, near: readonly Flat[], rule: LayerRule, built: (x: number, y: number) => boolean, base: ChunkSamples, fine: Surface | null): Float64Array {
  const out: number[] = [];
  const x0 = cx * CHUNK;
  const y0 = cy * CHUNK;
  const per = Math.round(CHUNK / rule.grid);
  const step = CHUNK / per;
  const cl = base.climate;
  const s = rule.salt;
  // (The most of its cells a rule ever takes: a cell whose hash is over that is never taken, wherever it lies.)
  let most = rule.crags ?? 0;
  for (const d of rule.density) most = Math.max(most, d);
  if (rule === RULES.detail) most = Math.max(most, LILIES);
  const trail = rule.solid === true && x0 <= TRAIL_BOX[2] && x0 + CHUNK >= TRAIL_BOX[0] && y0 <= TRAIL_BOX[3] && y0 + CHUNK >= TRAIL_BOX[1];
  for (let j = 0; j < per; j++) {
    for (let i = 0; i < per; i++) {
      const gx = cx * per + i;
      const gy = cy * per + j;
      const u = hash3(seed, gx, gy, s);
      if (u >= most) continue;
      const x = (gx + 0.12 + 0.76 * hash3(seed, gx, gy, s + 1)) * step;
      const y = (gy + 0.12 + 0.76 * hash3(seed, gx, gy, s + 2)) * step;
      if (!clearOfFlats(near, x, y, rule.clearance, rule.lawn)) continue;
      if (rule.lawn && built(x, y)) continue;
      if (trail && onTrail(x, y)) continue;
      // (What only grows low is nowhere near it on most of the land: the base grid says so before the land's own height is asked.)
      if (rule.low !== undefined && surfaceHeight(base, (x - x0) / CELL, (y - y0) / CELL) > WATER_LEVEL + rule.low + 1) continue;
      let z = fine ? surfaceHeight(fine, (x - x0) / FINE_CELL, (y - y0) / FINE_CELL) : heightAt(seed, x, y, near);
      if (rule.low !== undefined && z > WATER_LEVEL + rule.low) continue;
      cornersOf((x - x0) / CELL, (y - y0) / CELL);
      let afloat = false;
      if (!rule.underwater) {
        const stream = lerp(cl.stream);
        if (z < WATER_LEVEL + 0.15) {
          // Out in the water: only what wades (reeds) or floats (a lily pad), in still water no deeper than it goes.
          if (!rule.wade || z < WATER_LEVEL - rule.wade || stream < 0.06) continue;
          afloat = z < WATER_LEVEL;
        } else if (stream < 0.07 && streamAt(seed, x, y) > 0.35 && z < streamLevel(seed, x, y) - 0.12) continue; // under a stream's pool
      }
      if (rule.even && Math.abs(surfaceHeight(base, (x - x0) / CELL, (y - y0) / CELL) - z) > 0.35) continue;
      let biome = WATER;
      // What's small is of the ground it stands on (its triangle's biomes, as the fine grid has them); what's big, of the land's own climate there.
      if (fine) biome = biomeOn(fine, (x - x0) / FINE_CELL, (y - y0) / FINE_CELL, hash3(seed, gx, gy, s + 6));
      else if (!rule.underwater || z >= WATER_LEVEL) {
        // (What stands in the shallows is its shore's: a reed bed's, or a beach's.)
        const h = z < WATER_LEVEL + 0.02 ? WATER_LEVEL + 0.02 : z;
        const m = moistureFrom(lerp(cl.moist), h, lerp(cl.gx), lerp(cl.gy), lerp(cl.hollow));
        weightsFrom(weights, h, near.length ? flatMix(near, x, y) : 0, m, lerp(cl.woods), lerp(cl.kind), lerp(cl.rockline), lerp(cl.crag), lerp(cl.ridge), lerp(cl.upland), lerp(cl.lift), lerp(cl.dunes));
        biome = pickBiome(weights, hash3(seed, gx, gy, s + 6));
      }
      let kind: number;
      if (afloat && rule === RULES.detail) {
        // Lily pads: on the still water of a reedy margin, clear of the reeds' own belt.
        if (biome !== MARSH || z > WATER_LEVEL - 0.18 || u >= LILIES) continue;
        kind = 5;
        z = WATER_LEVEL;
      } else {
        const density = rule.crags ? Math.max(rule.density[biome]!, outcrop(seed, x, y) * rule.crags) : rule.density[biome]!;
        if (u >= density) continue;
        kind = rule.kind(biome, hash3(seed, gx, gy, s + 5));
        // Reeds stand in the water; rushes on the wet ground beside it.
        if (rule === RULES.reeds && afloat && kind === 2) kind = 0;
      }
      const [lo, hi] = rule.scale;
      out.push(x, y, z, lo + (hi - lo) * hash3(seed, gx, gy, s + 3) ** 1.5, hash3(seed, gx, gy, s + 4) * Math.PI * 2, kind);
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
