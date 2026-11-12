import type { Season } from "./season.ts";

/*
 * What the season does to everything that grows, as numbers: the year's state
 * (season.ts) turned into the few amounts the plants' and the land's shaders
 * read. Nothing is rebuilt as the date creeps: every part of every model says
 * which of these amounts colours it and which one grows it, and the shader does
 * the rest, each leaf, flower and facet in its own turn (so a crown thins leaf
 * by leaf, a meadow comes into flower patch by patch, and nothing pops).
 *
 *   tints  how far a part's colour has gone from its summer colour to its other one
 *   grows  how much of a part is there (0 gone, 1 all of it)
 *
 * Pure, so unit-tested; `seasonDrivers` writes into the object it's given.
 */

/** What colours a part: nothing, or one of the year's tints (an index into `Drivers.tint`). */
export const TINT = {
  none: 0,
  /** A deciduous leaf: lime in summer, gold, orange or red by the height of autumn. */
  leaf: 1,
  /** A birch's: yellow first. */
  earlyLeaf: 2,
  /** An alder's or a willow's: green late into the autumn, then only half turned. */
  lateLeaf: 3,
  /** Grass: paler through the autumn, palest in winter. */
  grass: 4,
  /** Heather: purple while it flowers, late in August. */
  heather: 5,
  /** Reeds and rushes: straw-coloured from the autumn until the new growth. */
  reed: 6,
  /** A conifer's needles: a little deeper in winter. */
  needle: 7,
} as const;

/** What grows a part: nothing (it's always there), or one of the year's amounts (an index into `Drivers.grow`). */
export const GROW = {
  none: 0,
  /** Leaves: out through April and May, falling through October and November. */
  leaf: 1,
  /** The fine twigs of a bare crown: there as the leaves aren't. */
  twig: 2,
  /** The meadows' flowers: late April to September. */
  flower: 3,
  /** The woodland floor's spring flowers (anemones): April and May, before the crowns close. */
  spring: 4,
  /** Blossom on the trees and bushes: a few weeks of April and May. */
  blossom: 5,
  /** What the autumn brings up: mushrooms. */
  autumn: 6,
  /** Leaves lying on the ground: from October until the spring. */
  litter: 7,
  /** What flowers the whole warm half of the year: daisies, clover, gorse. */
  long: 8,
} as const;

/** How many tints and amounts there are room for (a part's two indices are packed into one byte). */
export const DRIVERS = 16;

export interface Drivers {
  tint: Float32Array;
  grow: Float32Array;
  /**
   * How much the parts of one amount take their turns: 1 and they all grow together (buds swelling), small and they
   * come and go one after another (leaves falling).
   */
  width: Float32Array;
  /** New leaves are lighter and yellower: 0 to 1, in spring. */
  fresh: number;
  /** The ground: each a colour (linear r, g, b) and how much of it is laid over the summer ground (0 to 1). */
  grass: Float32Array;
  heath: Float32Array;
  litter: Float32Array;
  marsh: Float32Array;
}

export function emptyDrivers(): Drivers {
  const d: Drivers = { tint: new Float32Array(DRIVERS), grow: new Float32Array(DRIVERS), width: new Float32Array(DRIVERS).fill(1), fresh: 0, grass: new Float32Array(4), heath: new Float32Array(4), litter: new Float32Array(4), marsh: new Float32Array(4) };
  d.grow.fill(1);
  return d;
}

const clamp = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (lo: number, hi: number, x: number): number => {
  const t = clamp((x - lo) / (hi - lo));
  return t * t * (3 - 2 * t);
};
/** Rising over days [a, b] of the year, full until c, falling over [c, d]. */
const days = (a: number, b: number, c: number, d: number, year: number): number => smooth(a / 365, b / 365, year) * (1 - smooth(c / 365, d / 365, year));

/** When the heather flowers: from the end of July, at its height in late August, over by October. */
export const heatherBloom = (year: number): number => days(205, 232, 258, 290, year);

/** sRGB hex to linear r, g, b, into `out` (its first three). */
function linear(hex: number, out: Float32Array): void {
  for (let i = 0; i < 3; i++) {
    const c = ((hex >> (16 - 8 * i)) & 255) / 255;
    out[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }
}

const a = new Float32Array(3);
const b = new Float32Array(3);
/** Several colours mixed by their weights, into `out` (rgb), with `amount` as its fourth. */
function blend(out: Float32Array, amount: number, colours: readonly number[], shares: readonly number[]): void {
  let total = 0;
  a.fill(0);
  for (let i = 0; i < colours.length; i++) {
    const w = shares[i]!;
    if (w <= 0) continue;
    linear(colours[i]!, b);
    a[0] = a[0]! + b[0]! * w;
    a[1] = a[1]! + b[1]! * w;
    a[2] = a[2]! + b[2]! * w;
    total += w;
  }
  if (total > 0) {
    out[0] = a[0]! / total;
    out[1] = a[1]! / total;
    out[2] = a[2]! / total;
  }
  out[3] = clamp(amount);
}

/**
 * The ground's seasonal colours (sRGB, as the ground's own colours are given: terrain.ts): pastel, never mud. Grass
 * stays a green all year, yellower in autumn and a pale sage in winter; fallen leaves are a light gold, then a pale buff.
 */
const GRASS_SPRING = 0xa9d858;
const GRASS_AUTUMN = 0xb8cd62;
const GRASS_WINTER = 0xbccc90;
const HEATH_BLOOM = 0xc190dd;
const HEATH_AUTUMN = 0xc7a183;
const HEATH_WINTER = 0xb7b28e;
const LITTER_GOLD = 0xe9d187;
const LITTER_OLD = 0xdbd1b0;
const MARSH_STRAW = 0xcdc98c;

/** The year's amounts for the shaders, from the season, into `out`. */
export function seasonDrivers(s: Season, out: Drivers = emptyDrivers()): Drivers {
  const y = s.year;
  const { tint, grow, width } = out;
  tint.fill(0);
  grow.fill(1);
  width.fill(1);
  tint[TINT.leaf] = s.turn;
  // Birches are yellow while the oaks have only begun; alders and willows hold their green, and never turn all the way.
  tint[TINT.earlyLeaf] = clamp(s.turn * 1.8);
  tint[TINT.lateLeaf] = clamp(s.turn * 1.5 - 0.5) * 0.75;
  const pale = clamp(s.winter + 0.55 * s.autumn);
  tint[TINT.grass] = pale;
  tint[TINT.heather] = heatherBloom(y);
  tint[TINT.reed] = clamp(s.winter + 0.85 * s.autumn + 0.25 * s.spring * (1 - s.vigour));
  tint[TINT.needle] = s.winter;

  grow[GROW.leaf] = s.leaf;
  // In spring every bud swells at once; in autumn the leaves fall one after another. (Both are the same at
  // midsummer, all there, and at midwinter, none: the change of the two ways is never seen.)
  width[GROW.leaf] = y < 0.5 ? 0.9 : 0.34;
  grow[GROW.twig] = 1 - s.leaf;
  width[GROW.twig] = 1;
  grow[GROW.flower] = s.bloom;
  width[GROW.flower] = 0.4;
  grow[GROW.spring] = days(86, 100, 134, 150, y);
  width[GROW.spring] = 0.5;
  grow[GROW.blossom] = days(90, 103, 128, 143, y);
  width[GROW.blossom] = 0.6;
  grow[GROW.autumn] = days(245, 270, 318, 345, y);
  width[GROW.autumn] = 0.4;
  grow[GROW.litter] = s.litter;
  width[GROW.litter] = 0.5;
  grow[GROW.long] = days(78, 104, 275, 318, y);
  width[GROW.long] = 0.5;
  out.fresh = s.spring * (1 - 0.6 * s.summer);

  // The ground. Grass: fresher in spring, paling through the autumn, palest in winter.
  blend(out.grass, 0.3 * s.spring + 0.6 * s.autumn + 0.75 * s.winter, [GRASS_SPRING, GRASS_AUTUMN, GRASS_WINTER], [0.3 * s.spring, 0.6 * s.autumn, 0.75 * s.winter]);
  // Heath: mauve while the heather flowers, russet after, grey-gold in winter.
  const bloom = heatherBloom(y);
  // (Out of flower the season's colour is most of what's seen: at half, the summer's olive showed through all November.)
  blend(out.heath, 0.85 * bloom + (1 - bloom) * (0.84 * s.autumn + 0.7 * s.winter), [HEATH_BLOOM, HEATH_AUTUMN, HEATH_WINTER], [bloom * 2, (1 - bloom) * s.autumn, (1 - bloom) * s.winter]);
  // Fallen leaves: gold while the trees are turned, faded by midwinter.
  blend(out.litter, s.litter, [LITTER_GOLD, LITTER_OLD], [s.turn, 1 - s.turn]);
  blend(out.marsh, 0.75 * tint[TINT.reed]!, [MARSH_STRAW], [1]);
  return out;
}

/**
 * How much of a part is there, 0 to 1: `amount` is its driver's value, `width` how much the parts take their turns
 * (1: all together), `key` its own place in the queue (0 first to 1 last). The shader does exactly this.
 */
export function partScale(amount: number, width: number, key: number): number {
  const t = clamp((amount - key * (1 - width)) / width);
  // Quick out of nothing and easing into its full size: a bud is seen as soon as it breaks. And where the parts take
  // their turns (leaves falling), those still there are smaller the fewer are left: the last leaves of a crown are
  // small ones, not a few great shards.
  return t * (2 - t) * (1 - (1 - width) * 0.5 * (1 - amount));
}
