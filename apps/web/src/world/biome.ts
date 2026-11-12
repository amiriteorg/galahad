import { simplex, smoothstep } from "./noise.ts";
import { basinAt, type Flat, flatMix, heightAt, marshAt, outcrop, ridgeAt, SCARP, scarpAt, streamOff, uplandAt, WATER_LEVEL, waterAtHeight } from "./relief.ts";

/*
 * Where the SANDBOX's land is what: its climate, and the biomes that follow
 * from it. Nothing here is drawn; the land's colours and everything that grows
 * (terrain.ts) and whoever lives there read it.
 *
 * The climate at a point is a handful of numbers: how high it stands over the
 * water, which way and how steeply it slopes, whether it lies in a hollow, how
 * near a stream or a lake's basin it is, the lie of the bigger landforms
 * (ridge, upland, marsh), and three slow noises (where the woods are, which
 * kind of wood, how much rain the region gets). From them comes the moisture
 * of the ground, 0 dry to 1 wet: wet by the water and along the streams, in
 * hollows and on slopes that face north, dry on high ground, on steep slopes
 * and on the uplands.
 *
 * A biome is a share, not a line: every point has a weight for each (they sum
 * to 1), so one place turns into the next over some tens of metres, and what
 * grows in between is a mix of both. `biomeAt` names the one that has the most.
 *
 *   water      a lake, or a stream's pool
 *   shore      sand at the water's edge, and dunes behind it where it's dry
 *   marsh      wet ground at the water's level: lake margins, stream mouths, the marsh flats
 *   meadow     open grass and flowers
 *   heath      high, dry, open ground: heather and gorse, a lone pine or birch
 *   woodland   deciduous wood: oaks, limes, a cherry
 *   birchwood  a birch grove
 *   pinewood   pines and spruces
 *   outcrop    bare rock: crags, the tops above the rock line
 *   lawn       the kept ground of the keep, the sites and the plots
 *
 * Pure and deterministic (the seed, the point and the flats), and allocation-free
 * when given its outputs to write into.
 */

export const BIOMES = ["water", "shore", "marsh", "meadow", "heath", "woodland", "birchwood", "pinewood", "outcrop", "lawn"] as const;
export type Biome = (typeof BIOMES)[number];

export const WATER = 0;
export const SHORE = 1;
export const MARSH = 2;
export const MEADOW = 3;
export const HEATH = 4;
export const WOODLAND = 5;
export const BIRCHWOOD = 6;
export const PINEWOOD = 7;
export const OUTCROP = 8;
export const LAWN = 9;

/** The climate at a point. One object can be reused: every field is written. */
export interface Climate {
  /** The ground's height (metres), and the water's surface there (−Infinity where it's dry). */
  h: number;
  water: number;
  /** The slope: metres up per metre east and north (over 8 m). */
  gx: number;
  gy: number;
  /** How far the ground lies under its surroundings (positive in a hollow, negative on a knoll), metres. */
  hollow: number;
  /** How much of a flat (the keep's ground, a site, a plot) it is: 0 to 1. */
  flat: number;
  /** Where the woods are (above about 0.12), which kind of wood (high: conifers; low: birch), and the region's rain (−1 to 1). */
  woods: number;
  kind: number;
  rain: number;
  /** A finer noise along the water's edge: reeds here, sand there. */
  margin: number;
  /** Where the bare rock starts, and how much of a crag stands here (0 to 1). */
  rockline: number;
  crag: number;
  /** How far from a stream's bed (0 in it), and how deep in a lake's basin (0 to 1). */
  stream: number;
  basin: number;
  /** The bigger landforms: how far up a ridge, on an upland, on a marsh's flat (each 0 to 1). */
  ridge: number;
  upland: number;
  marsh: number;
  /** How far those landforms have lifted the ground here (a ridge's flank, the upland behind a scarp), metres: the rock line rises with it. */
  lift: number;
  /** The ground's moisture: 0 dry to 1 wet. */
  moisture: number;
}

export function emptyClimate(): Climate {
  return { h: 0, water: Number.NEGATIVE_INFINITY, gx: 0, gy: 0, hollow: 0, flat: 0, woods: 0, kind: 0, rain: 0, margin: 0, rockline: 0, crag: 0, stream: 1, basin: 0, ridge: 0, upland: 0, marsh: 0, lift: 0, moisture: 0 };
}

/** The slowest of the climate's noises: which kind of wood (310 m), the region's rain (900 m), reeds or sand along a shore (130 m). */
export const kindNoise = (seed: number, x: number, y: number): number => simplex(seed + 43, x / 310, y / 310);
export const rainNoise = (seed: number, x: number, y: number): number => simplex(seed + 211, x / 900, y / 900);
export const marginNoise = (seed: number, x: number, y: number): number => simplex(seed + 223, x / 130, y / 130);

/** The rest of a point's climate but its heights: where the woods are, the rock, the stream, the landforms; into `c`. */
export function climateLocal(seed: number, x: number, y: number, c: Climate): Climate {
  c.woods = simplex(seed + 41, x / 170, y / 170);
  c.rockline = simplex(seed + 53, x / 60, y / 60);
  c.crag = outcrop(seed, x, y);
  c.stream = streamOff(seed, x, y);
  c.ridge = ridgeAt(seed, x, y);
  c.upland = uplandAt(seed, x, y);
  c.marsh = marshAt(seed, x, y);
  c.lift = scarpAt(seed, x, y) * SCARP + c.ridge * 6;
  return c;
}

/** The noises of the climate at a point, into `c` (everything but the heights and what follows from them). */
export function climateNoises(seed: number, x: number, y: number, c: Climate): Climate {
  c.kind = kindNoise(seed, x, y);
  c.rain = rainNoise(seed, x, y);
  c.margin = marginNoise(seed, x, y);
  c.basin = basinAt(seed, x, y);
  return climateLocal(seed, x, y, c);
}

/** The slope and the hollow at a point from the heights 4 m to its east, west, north and south, into `c` (its `h` set). */
export function climateSlope(c: Climate, east: number, west: number, north: number, south: number): Climate {
  c.gx = (east - west) / 8;
  c.gy = (north - south) / 8;
  c.hollow = (east + west + north + south) / 4 - c.h;
  return c;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * The part of the ground's moisture that its own height and slope don't change: the region's rain, the stream it
 * lies along, the marsh or the upland under it. (A chunk samples this once at each corner of its grid.)
 */
export function moistureBase(c: Climate): number {
  return 0.28 + 0.24 * smoothstep(0.26, 0.06, c.stream) + 0.14 * c.rain + 0.07 * c.margin + 0.5 * c.marsh - 0.3 * c.upland;
}

/**
 * The ground's moisture, 0 dry to 1 wet, from that and from where the point itself lies: wet at the lakes' level
 * and drying out with height above it, drier on a steep slope, damper on one that falls away to the north (it keeps
 * out of the sun) and in a hollow.
 */
export function moistureFrom(base: number, h: number, gx: number, gy: number, hollow: number): number {
  const low = 1 - smoothstep(0.3, 4.5, h - WATER_LEVEL);
  const steep = smoothstep(0.18, 0.6, Math.sqrt(gx * gx + gy * gy));
  const north = gy > 1 / 3 ? -1 : gy < -1 / 3 ? 1 : -gy * 3;
  const dip = hollow > 0.6 ? 0.6 : hollow < -0.6 ? -0.6 : hollow;
  return clamp01(base + 0.36 * low - 0.2 * steep + 0.06 * north + 0.08 * dip);
}

/** The ground's moisture from the rest of a climate (`h`, the slope and the noises set), written into it and returned. */
export function moistureOf(c: Climate): number {
  c.moisture = moistureFrom(moistureBase(c), c.h, c.gx, c.gy, c.hollow);
  return c.moisture;
}

/** Where the woods are, with the landforms' say in it: a ridge's flanks are wooded, an upland open. */
export const woodsOf = (c: Climate): number => c.woods + 0.55 * c.ridge * (1 - c.ridge) * 4 - 0.5 * c.upland;
/** Where dunes lie behind the shore: here and there along it, in the drier regions. */
export const dunesOf = (c: Climate): number => c.margin - c.rain * 0.4;

/** The whole climate at (x, y), into `out`. */
export function climateAt(seed: number, x: number, y: number, flats: readonly Flat[], out: Climate = emptyClimate()): Climate {
  out.h = heightAt(seed, x, y, flats);
  out.water = waterAtHeight(seed, x, y, out.h, flats);
  out.flat = flats.length ? flatMix(flats, x, y) : 0;
  climateSlope(out, heightAt(seed, x + 4, y, flats), heightAt(seed, x - 4, y, flats), heightAt(seed, x, y + 4, flats), heightAt(seed, x, y - 4, flats));
  climateNoises(seed, x, y, out);
  moistureOf(out);
  return out;
}

/** The ground's moisture at (x, y): 0 dry to 1 wet (1 in the water). */
export function moistureAt(seed: number, x: number, y: number, flats: readonly Flat[]): number {
  const c = climateAt(seed, x, y, flats, scratch);
  return c.h < c.water ? 1 : c.moisture;
}

const scratch = emptyClimate();
const scratchWeights = new Float32Array(BIOMES.length);

/** Where the bare rock starts, metres (it wavers by the rock line's noise). */
const ROCK_LINE = 6.8;

/**
 * Each biome's share of dry ground, into `out` (they sum to 1), from plain numbers: its height, how much of a flat
 * it is, its moisture, where the woods are (`woodsOf`) and of which kind, the rock line's noise, how much of a crag,
 * a ridge and an upland stand here, how far the landforms have lifted it, and where the dunes are (`dunesOf`).
 *
 * Laid one over another, the later the stronger: meadow everywhere, then heath where it's high and dry, the woods
 * where the woods are (birch, conifer or deciduous by their own noise and the damp), marsh where it's wet and low,
 * rock where it breaks through, sand at the water's edge, and the kept ground of the flats over all of it.
 */
export function weightsFrom(out: Float32Array, h: number, flat: number, m: number, woods: number, kind: number, rockline: number, crag: number, ridge: number, upland: number, lift: number, dunes: number): Float32Array {
  const above = h - WATER_LEVEL;
  const wooded = smoothstep(-0.06, 0.3, woods);
  // Heath: the uplands, and any high, dry, open ground.
  const dry = m < 0.34 && h > 3.4 ? smoothstep(0.34, 0.16, m) * smoothstep(3.4, 5.2, h) * (1 - wooded * 0.8) : 0;
  const heath = upland * 0.96 > dry ? upland * 0.96 : dry;
  // The woods: conifers where their noise is high, the ground dry or a ridge under them; birches where it's low; the rest deciduous.
  let woodland = 0;
  let birchwood = 0;
  let pinewood = 0;
  if (wooded > 0) {
    const conifer = smoothstep(0.12, 0.36, kind + (0.42 - m) * 0.5 + 0.3 * ridge);
    const birch = (1 - conifer) * smoothstep(-0.2, -0.45, kind - (m - 0.5) * 0.3);
    woodland = wooded * (1 - conifer) * (1 - birch);
    birchwood = wooded * birch;
    pinewood = wooded * conifer;
  }
  // Marsh: wet ground that lies low (the marsh flats are wet by their landform).
  const marsh = m > 0.62 && above < 2.5 ? smoothstep(0.62, 0.84, m) * (1 - smoothstep(1.3, 2.5, above)) : 0;
  // Rock: above the rock line, on a crag's crown, along a ridge's crest.
  let outcrop = smoothstep(-0.5, 0.3, h - lift - (ROCK_LINE + rockline * 1.6)) * (1 - upland);
  if (crag > 0.35) outcrop = Math.max(outcrop, smoothstep(0.35, 0.8, crag));
  if (ridge > 0.8) outcrop = Math.max(outcrop, smoothstep(0.8, 0.97, ridge) * 0.85);
  // Sand at the water's edge unless it's a reedy margin; and dunes behind it where the ground is dry.
  let shore = above < 1.1 ? (1 - smoothstep(0.6, 1.1, above)) * (1 - smoothstep(0.58, 0.8, m)) : 0;
  if (dunes > 0.15 && m < 0.52 && above < 3.4) shore = Math.max(shore, smoothstep(0.15, 0.4, dunes) * smoothstep(0.52, 0.4, m) * (1 - smoothstep(2.2, 3.4, above)) * (1 - wooded));
  const lawn = flat > 0.45 ? smoothstep(0.45, 0.65, flat) : 0;
  // Each takes its share of what those laid over it have left.
  let left = 1 - lawn;
  out[WATER] = 0;
  out[LAWN] = lawn;
  out[SHORE] = shore * left;
  left *= 1 - shore;
  out[OUTCROP] = outcrop * left;
  left *= 1 - outcrop;
  out[MARSH] = marsh * left;
  left *= 1 - marsh;
  out[PINEWOOD] = pinewood * left;
  left *= 1 - pinewood;
  out[BIRCHWOOD] = birchwood * left;
  left *= 1 - birchwood;
  out[WOODLAND] = woodland * left;
  left *= 1 - woodland;
  out[HEATH] = heath * left;
  out[MEADOW] = left * (1 - heath);
  return out;
}

/** Each biome's share at a point with this climate, into `out` (they sum to 1). Under water it's all water. */
export function biomeWeights(c: Climate, out: Float32Array = scratchWeights): Float32Array {
  if (c.h < c.water || c.h < WATER_LEVEL) {
    out.fill(0);
    out[WATER] = 1;
    return out;
  }
  return weightsFrom(out, c.h, c.flat, c.moisture, woodsOf(c), c.kind, c.rockline, c.crag, c.ridge, c.upland, c.lift, dunesOf(c));
}

/** The index (into BIOMES) of the biome with the most weight. */
export function topBiome(w: Float32Array): number {
  let best = 0;
  for (let i = 1; i < w.length; i++) if (w[i]! > w[best]!) best = i;
  return best;
}

/** Each biome's share at (x, y), into `out` (indexed as BIOMES; they sum to 1). */
export function biomeMix(seed: number, x: number, y: number, flats: readonly Flat[], out: Float32Array = new Float32Array(BIOMES.length)): Float32Array {
  return biomeWeights(climateAt(seed, x, y, flats, scratch), out);
}

/** The biome at (x, y): the one with the most of the ground there. */
export function biomeAt(seed: number, x: number, y: number, flats: readonly Flat[]): Biome {
  return BIOMES[topBiome(biomeWeights(climateAt(seed, x, y, flats, scratch), scratchWeights))]!;
}
