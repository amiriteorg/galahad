import { TREE_SOLIDS } from "../flora-plan.ts";
import { hash2 } from "../noise.ts";
import type { Season } from "../season.ts";
import { onSite } from "../sites.ts";
import { CHUNK, chunkSamples, type ChunkSamples, type Flat, flatMix, groundAt, growLayer, heightAt, KEEP_RADIUS, STRIDE, WATER_LEVEL, waterAtHeight } from "../terrain.ts";

/*
 * The land as the ecosystem sees it. A `Habitat` is what the world can say
 * about a place (its height, whether anything wild may stand there, the ground
 * it is, the trees and flowers that really grow on it); `Patches` lays a grid of
 * 8 m cells over the range and keeps what there is to eat in each: grass,
 * browse, what falls from the trees, beetles and worms, voles, the lake's weed
 * and what hatches on it. Each pool grows towards what its ground can carry in
 * this season (a logistic curve, in closed form, so a cell is brought up to
 * date only when someone looks at it: nothing sweeps the grid) and is eaten
 * down by whoever feeds there. That's the bottom of the food web, and why
 * animals are where the grass is.
 *
 * Pure: the real land's habitat here is built from terrain.ts' own functions;
 * the scene's (fauna.ts) reads the land that's drawn.
 */

export interface Habitat {
  /** The ground's height (metres, world z). */
  height(x: number, y: number): number;
  /** Where nothing wild stands: in the water, on the keep's lawn, a site or a plot. May be slow: it's asked once a cell. */
  blocked(x: number, y: number): boolean;
  /** The ground there, as terrain.ts names it; a name nobody here knows is read as open meadow. */
  kind(x: number, y: number, h: number): string;
  /** The trees of a 64 m chunk (packed as terrain.ts packs them: x, y, z, scale, turn, kind), or null where they aren't known. */
  trees(cx: number, cy: number): Float64Array | null;
  /** Its flowers likewise: only where they're drawn (near the view), null elsewhere. */
  flowers(cx: number, cy: number): Float64Array | null;
}

/** A patch's side, metres. */
export const PATCH = 8;

/** What a patch is. */
export const MEADOW = 0;
export const FOREST = 1;
export const SHORE = 2;
export const ROCK = 3;
export const LAWN = 4;
export const SHALLOW = 5;
export const DEEP = 6;
/** Not for the wild: the keep, a site, a plot, a stream's pool. */
export const BARRED = 7;
/** Bit masks of the above, for `nearest` and `share`. */
export const WET = (1 << SHALLOW) | (1 << DEEP);
export const DRY = (1 << MEADOW) | (1 << FOREST) | (1 << SHORE) | (1 << ROCK);
export const OPEN = (1 << MEADOW) | (1 << SHORE);
export const WOODS = 1 << FOREST;

const CODES: Record<string, number> = { meadow: MEADOW, forest: FOREST, sand: SHORE, rock: ROCK, green: LAWN, lakebed: SHALLOW };

/** The pools, in order: what each ground carries at the height of summer (a hare's day of food is 1), and how fast it grows back (a share of itself a day). */
export const POOLS = ["graze", "browse", "mast", "bugs", "voles", "weed", "midges"] as const;
export type Pool = (typeof POOLS)[number];
const CARRY: Record<Pool, readonly number[]> = {
  //       meadow forest shore rock lawn shallow deep barred
  graze: [6, 2.2, 0.8, 0.5, 4, 0, 0, 0],
  browse: [0.8, 4, 0, 0.3, 0, 0, 0, 0],
  mast: [0.1, 3, 0, 0, 0, 0, 0, 0],
  bugs: [1.2, 1.6, 0.4, 0.2, 0.8, 0, 0, 0],
  voles: [2, 0.6, 0, 0.1, 0.3, 0, 0, 0],
  weed: [0, 0, 0, 0, 0, 6, 3, 0],
  midges: [0, 0, 0.5, 0, 0, 3, 2, 0],
};
const RATE: Record<Pool, number> = { graze: 0.14, browse: 0.08, mast: 0.06, bugs: 0.25, voles: 0.012, weed: 0.1, midges: 0.4 };
/** What's left when a pool is eaten bare: roots, seed, eggs. It grows back from this. */
const FLOOR = 0.06;

export interface TreeSpot {
  x: number;
  y: number;
  /** The ground it stands on. */
  z: number;
  /** Above its ground: where its crown starts and ends, and how wide the crown and the trunk are. */
  bottom: number;
  top: number;
  crown: number;
  trunk: number;
}
export const emptyTree = (): TreeSpot => ({ x: 0, y: 0, z: 0, bottom: 2, top: 5, crown: 2, trunk: 0.4 });

export interface FlowerSpot {
  x: number;
  y: number;
  /** The height of its head (world z). */
  z: number;
}

/** How high each flower's head stands, at scale 1 (vegetation.ts' models): daisies, lupines, lavender, buttercups, campions. */
const FLOWER_HEAD = [0.3, 0.62, 0.46, 0.25, 0.34];

/**
 * A tree within `r` of (x, y), into `out`: the nearest (`pick` 0), or one of
 * them chosen by `pick` (so a flock spreads over a wood's trees). False: none.
 */
export function treeNear(h: Habitat, x: number, y: number, r: number, pick: number, out: TreeSpot): boolean {
  let best = Infinity;
  const cx0 = Math.floor((x - r) / CHUNK);
  const cx1 = Math.floor((x + r) / CHUNK);
  const cy0 = Math.floor((y - r) / CHUNK);
  const cy1 = Math.floor((y + r) / CHUNK);
  for (let cx = cx0; cx <= cx1; cx++) {
    for (let cy = cy0; cy <= cy1; cy++) {
      const t = h.trees(cx, cy);
      if (!t) continue;
      for (let i = 0; i < t.length; i += STRIDE) {
        const d = Math.hypot(t[i]! - x, t[i + 1]! - y);
        if (d > r) continue;
        // Chosen by a hash of the tree and the pick: the same answer every time it's asked.
        const score = pick ? hash2(pick, Math.round(t[i]! * 4), Math.round(t[i + 1]! * 4)) + 0.4 * (d / r) : d;
        if (score >= best) continue;
        const solid = TREE_SOLIDS[t[i + 5]!];
        if (!solid) continue;
        best = score;
        const s = t[i + 3]!;
        out.x = t[i]!;
        out.y = t[i + 1]!;
        out.z = t[i + 2]!;
        out.bottom = solid.bottom * s;
        out.top = solid.top * s;
        out.crown = solid.crown * s;
        out.trunk = solid.trunk * s;
      }
    }
  }
  return best < Infinity;
}

/** A flower within `r` of (x, y) chosen by `pick`, into `out`. False: none grows there (or none is drawn yet). */
export function flowerNear(h: Habitat, x: number, y: number, r: number, pick: number, out: FlowerSpot): boolean {
  let best = Infinity;
  const cx0 = Math.floor((x - r) / CHUNK);
  const cx1 = Math.floor((x + r) / CHUNK);
  const cy0 = Math.floor((y - r) / CHUNK);
  const cy1 = Math.floor((y + r) / CHUNK);
  for (let cx = cx0; cx <= cx1; cx++) {
    for (let cy = cy0; cy <= cy1; cy++) {
      const f = h.flowers(cx, cy);
      if (!f) continue;
      for (let i = 0; i < f.length; i += STRIDE) {
        const d = Math.hypot(f[i]! - x, f[i + 1]! - y);
        if (d > r) continue;
        const score = hash2(pick, Math.round(f[i]! * 8), Math.round(f[i + 1]! * 8));
        if (score >= best) continue;
        best = score;
        out.x = f[i]!;
        out.y = f[i + 1]!;
        out.z = f[i + 2]! + (FLOWER_HEAD[f[i + 5]!] ?? 0.3) * f[i + 3]!;
      }
    }
  }
  return best < Infinity;
}

export class Patches {
  /** Cells a side (a power of two): the window wraps, a cell that comes back into it is looked at afresh. */
  readonly n: number;
  private readonly mask: number;
  private readonly keyX: Int32Array;
  private readonly keyY: Int32Array;
  /** What each cell is (MEADOW …). */
  readonly code: Uint8Array;
  /** When each cell was last brought up to date (days). */
  private readonly seen: Float32Array;
  readonly graze: Float32Array;
  readonly browse: Float32Array;
  readonly mast: Float32Array;
  readonly bugs: Float32Array;
  readonly voles: Float32Array;
  readonly weed: Float32Array;
  readonly midges: Float32Array;
  private readonly pools: Float32Array[];
  /** The season's say on each pool: how much of its summer's carrying it carries now, and how fast it grows. */
  private readonly carry = new Float32Array(POOLS.length);
  private readonly rate = new Float32Array(POOLS.length);
  /** The clock, in days. */
  now = 0;
  /** Each cell's nearest water, once looked for: the offset in cells (NONE: none in reach; UNKNOWN: not looked for yet). */
  private readonly waterDx: Int8Array;
  private readonly waterDy: Int8Array;

  constructor(
    readonly habitat: Habitat,
    cells = 64,
  ) {
    this.n = cells;
    this.mask = cells - 1;
    const size = cells * cells;
    this.keyX = new Int32Array(size).fill(0x7fffffff);
    this.keyY = new Int32Array(size).fill(0x7fffffff);
    this.code = new Uint8Array(size);
    this.seen = new Float32Array(size);
    this.pools = POOLS.map(() => new Float32Array(size));
    [this.graze, this.browse, this.mast, this.bugs, this.voles, this.weed, this.midges] = this.pools as [Float32Array, Float32Array, Float32Array, Float32Array, Float32Array, Float32Array, Float32Array];
    this.waterDx = new Int8Array(size);
    this.waterDy = new Int8Array(size);
    this.carry.fill(1);
    this.rate.set(POOLS.map((p) => RATE[p]));
  }

  /**
   * The season: green things carry least in winter and grow with the year's vigour; beetles and what hatches on
   * the water follow it closely; the trees' mast is there in autumn and (what was hidden of it) through the winter;
   * voles are fewest at the winter's end.
   */
  setSeason(s: Season): void {
    const green = 0.35 + 0.65 * Math.max(s.leaf, s.vigour);
    const grow = 0.04 + 0.96 * s.vigour;
    const small = 0.04 + 0.96 * s.vigour;
    const c = this.carry;
    const r = this.rate;
    c[0] = green;
    r[0] = RATE.graze * grow;
    c[1] = 0.35 + 0.65 * s.leaf;
    r[1] = RATE.browse * grow;
    c[2] = 0.25 + 0.75 * Math.min(1, s.autumn + 0.6 * s.winter);
    r[2] = RATE.mast * (0.2 + 0.8 * s.autumn);
    c[3] = small;
    r[3] = RATE.bugs * (0.3 + 0.7 * s.vigour);
    c[4] = 0.45 + 0.55 * (1 - s.winter);
    r[4] = RATE.voles * (0.25 + 0.75 * s.vigour);
    c[5] = 0.3 + 0.7 * s.vigour;
    r[5] = RATE.weed * grow;
    c[6] = small;
    r[6] = RATE.midges * (0.3 + 0.7 * s.vigour);
  }

  /** The cell at (x, y): its place in every array, looked at and brought up to date. */
  at(x: number, y: number): number {
    return this.cell(Math.floor(x / PATCH), Math.floor(y / PATCH));
  }

  /** The cell (cx, cy), by its own coordinates. */
  cell(cx: number, cy: number): number {
    const i = (cy & this.mask) * this.n + (cx & this.mask);
    if (this.keyX[i] !== cx || this.keyY[i] !== cy) this.look(i, cx, cy);
    else if (this.now - this.seen[i]! > 0.03) this.grow(i);
    return i;
  }

  /** A cell's first sight: what it is, and its pools at most of what they carry now. */
  private look(i: number, cx: number, cy: number): void {
    const h = this.habitat;
    const x = (cx + 0.5) * PATCH;
    const y = (cy + 0.5) * PATCH;
    const z = h.height(x, y);
    let code: number;
    if (z < WATER_LEVEL - 0.55) code = DEEP;
    else if (z < WATER_LEVEL + 0.02) code = SHALLOW;
    else if (h.blocked(x, y)) code = BARRED;
    else code = CODES[h.kind(x, y, z)] ?? MEADOW;
    if (code === SHALLOW && z >= WATER_LEVEL + 0.02) code = SHORE;
    this.keyX[i] = cx;
    this.keyY[i] = cy;
    this.code[i] = code;
    this.seen[i] = this.now;
    this.waterDx[i] = UNKNOWN;
    for (let p = 0; p < POOLS.length; p++) this.pools[p]![i] = CARRY[POOLS[p]!]![code]! * this.carry[p]! * (0.55 + 0.4 * hash2(p + 3, cx, cy));
  }

  /** Brings a cell's pools up to now: each along its logistic curve towards what the ground carries this season. */
  private grow(i: number): void {
    const dt = this.now - this.seen[i]!;
    this.seen[i] = this.now;
    const code = this.code[i]!;
    if (code === BARRED) return;
    for (let p = 0; p < POOLS.length; p++) {
      const full = CARRY[POOLS[p]!]![code]!;
      if (full <= 0) continue;
      const k = full * this.carry[p]!;
      const pool = this.pools[p]!;
      const x = Math.max(pool[i]!, FLOOR * full);
      pool[i] = k / (1 + (k / x - 1) * Math.exp(-this.rate[p]! * dt));
    }
  }

  /** Eats up to `want` of a pool at cell i; returns what there was. */
  take(pool: Float32Array, i: number, want: number): number {
    const got = Math.min(want, pool[i]!);
    pool[i] = pool[i]! - got;
    return got;
  }

  /**
   * The nearest patch to (x, y) that is one of `codes` (a bit mask), within `reach` patches: its centre into
   * `out`. Water is remembered per cell (it's asked for all day); the rest is looked for each time.
   */
  nearest(x: number, y: number, codes: number, reach: number, out: { x: number; y: number }): boolean {
    const cx = Math.floor(x / PATCH);
    const cy = Math.floor(y / PATCH);
    const water = codes === WET;
    const here = water ? this.cell(cx, cy) : -1;
    if (water && this.waterDx[here] !== UNKNOWN) {
      if (this.waterDx[here] === NONE) return false;
      out.x = (cx + this.waterDx[here]! + 0.5) * PATCH;
      out.y = (cy + this.waterDy[here]! + 0.5) * PATCH;
      return true;
    }
    let best = Infinity;
    let bx = 0;
    let by = 0;
    for (let ring = 0; ring <= reach && ring <= best + 1; ring++) {
      for (let k = -ring; k <= ring; k++) {
        // The ring's four sides (its corners twice: no harm).
        for (let side = 0; side < 4; side++) {
          const dx = side === 0 ? k : side === 1 ? k : side === 2 ? -ring : ring;
          const dy = side === 0 ? -ring : side === 1 ? ring : k;
          if (!((1 << this.code[this.cell(cx + dx, cy + dy)]!) & codes)) continue;
          const d = Math.hypot(dx, dy);
          if (d < best) {
            best = d;
            bx = dx;
            by = dy;
          }
        }
        if (ring === 0) break;
      }
    }
    if (water) {
      // (`here` may have been evicted by the look round: only remembered if it's still this cell.)
      if (this.keyX[here] === cx && this.keyY[here] === cy) {
        this.waterDx[here] = best < Infinity ? bx : NONE;
        this.waterDy[here] = by;
      }
    }
    if (best === Infinity) return false;
    out.x = (cx + bx + 0.5) * PATCH;
    out.y = (cy + by + 0.5) * PATCH;
    return true;
  }

  /**
   * How much of the range round (x, y) is each kind of ground: a lattice of looks, 16 m apart, counted into
   * `out` (a share for each code, MEADOW … BARRED).
   */
  census(x: number, y: number, reach: number, out: Float32Array): void {
    out.fill(0);
    let all = 0;
    for (let dy = -reach; dy <= reach; dy += 16) {
      for (let dx = -reach; dx <= reach; dx += 16) {
        if (dx * dx + dy * dy > reach * reach) continue;
        all++;
        const code = this.code[this.at(x + dx, y + dy)]!;
        out[code] = out[code]! + 1;
      }
    }
    if (all) for (let c = 0; c < out.length; c++) out[c] = out[c]! / all;
  }
}

const UNKNOWN = -128;
const NONE = 127;

/**
 * The real land's habitat, from terrain.ts alone (no GPU): for tests, and for
 * measuring. The scene's own (fauna.ts) reads the land as it's drawn instead.
 */
export function terrainHabitat(seed: number, flats: readonly Flat[]): Habitat {
  const chunks = new Map<number, ChunkSamples>();
  const samples = (cx: number, cy: number): ChunkSamples => {
    const key = (cx + 4096) * 8192 + (cy + 4096);
    let s = chunks.get(key);
    if (!s) chunks.set(key, (s = chunkSamples(seed, cx, cy, flats, () => false, ["trees"])));
    return s;
  };
  return {
    height: (x, y) => heightAt(seed, x, y, flats),
    blocked: (x, y) => {
      const h = heightAt(seed, x, y, flats);
      return h < waterAtHeight(seed, x, y, h, flats) + 0.05 || Math.hypot(x, y) < KEEP_RADIUS + 6 || onSite(x, y, 6);
    },
    kind: (x, y, h) => groundAt(seed, x, y, h, flatMix(flats, x, y)),
    trees: (cx, cy) => samples(cx, cy).layers.trees ?? null,
    flowers: (cx, cy) => growLayer(seed, samples(cx, cy), "flowers"),
  };
}

/**
 * A made-up piece of country for tests: level meadow in flower, a round lake with a sandy shore, and a wood. Cheap
 * to ask, and everything about it is known.
 */
export function plainHabitat(lake = { x: 60, y: 0, r: 34 }, wood = { x: -70, y: 30, r: 45 }): Habitat {
  const height = (x: number, y: number): number => {
    const d = Math.hypot(x - lake.x, y - lake.y);
    if (d >= lake.r + 6) return 0.5;
    // The bank drops to the water over 6 m; the bed shelves gently for 9 m (the shallows), then goes down to 1.6 m of water.
    if (d >= lake.r) return WATER_LEVEL + ((d - lake.r) / 6) * (0.5 - WATER_LEVEL);
    const out = lake.r - d;
    return WATER_LEVEL - Math.min(1.6, out * 0.055 + Math.max(0, out - 9) * 0.3);
  };
  const inWood = (x: number, y: number): boolean => Math.hypot(x - wood.x, y - wood.y) < wood.r;
  const packs = new Map<number, [Float64Array, Float64Array]>();
  const pack = (cx: number, cy: number): [Float64Array, Float64Array] => {
    const key = (cx + 4096) * 8192 + (cy + 4096);
    let p = packs.get(key);
    if (p) return p;
    const trees: number[] = [];
    const flowers: number[] = [];
    for (let j = 0; j < 8; j++) {
      for (let i = 0; i < 8; i++) {
        const gx = cx * 8 + i;
        const gy = cy * 8 + j;
        const x = (gx + 0.2 + 0.6 * hash2(1, gx, gy)) * 8;
        const y = (gy + 0.2 + 0.6 * hash2(2, gx, gy)) * 8;
        const here = inWood(x, y) ? 0.8 : 0.04;
        if (hash2(3, gx, gy) < here && height(x, y) > 0.4) trees.push(x, y, height(x, y), 0.9 + 0.4 * hash2(4, gx, gy), 0, Math.floor(hash2(5, gx, gy) * 5));
      }
    }
    for (let j = 0; j < 24; j++) {
      for (let i = 0; i < 24; i++) {
        const gx = cx * 24 + i;
        const gy = cy * 24 + j;
        const x = (gx + hash2(6, gx, gy)) * (CHUNK / 24);
        const y = (gy + hash2(7, gx, gy)) * (CHUNK / 24);
        if (hash2(8, gx, gy) < 0.4 && !inWood(x, y) && height(x, y) > 0.4) flowers.push(x, y, height(x, y), 1.3 + 0.8 * hash2(9, gx, gy), 0, Math.floor(hash2(10, gx, gy) * 5));
      }
    }
    p = [new Float64Array(trees), new Float64Array(flowers)];
    packs.set(key, p);
    return p;
  };
  return {
    height,
    blocked: (x, y) => height(x, y) < WATER_LEVEL + 0.05,
    kind: (x, y, h) => (h < WATER_LEVEL - 0.2 ? "lakebed" : h < 0.45 ? "sand" : inWood(x, y) ? "forest" : "meadow"),
    trees: (cx, cy) => pack(cx, cy)[0],
    flowers: (cx, cy) => pack(cx, cy)[1],
  };
}
