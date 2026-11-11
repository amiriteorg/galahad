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

/** The slow noises of the climate at a point, into `c` (everything but the heights and what follows from them). */
export function climateNoises(seed: number, x: number, y: number, c: Climate): Climate {
  c.woods = simplex(seed + 41, x / 170, y / 170);
  c.kind = simplex(seed + 43, x / 310, y / 310);
  c.rain = simplex(seed + 211, x / 900, y / 900);
  c.margin = simplex(seed + 223, x / 130, y / 130);
  c.rockline = simplex(seed + 53, x / 60, y / 60);
  c.crag = outcrop(seed, x, y);
  c.stream = streamOff(seed, x, y);
  c.basin = basinAt(seed, x, y);
  c.ridge = ridgeAt(seed, x, y);
  c.upland = uplandAt(seed, x, y);
  c.marsh = marshAt(seed, x, y);
  c.lift = scarpAt(seed, x, y) * SCARP + c.ridge * 6;
  return c;
}

/** The slope and the hollow at a point from the heights 4 m to its east, west, north and south, into `c` (its `h` set). */
export function climateSlope(c: Climate, east: number, west: number, north: number, south: number): Climate {
  c.gx = (east - west) / 8;
  c.gy = (north - south) / 8;
  c.hollow = (east + west + north + south) / 4 - c.h;
  return c;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** The ground's moisture from the rest of a climate (`h`, the slope and the noises set), written into it and returned. */
export function moistureOf(c: Climate): number {
  const above = c.h - WATER_LEVEL;
  // The water table: wet at the lakes' level, drying out with height above it.
  const low = 1 - smoothstep(0.3, 4.5, above);
  // Along a stream, as far as its banks reach.
  const riparian = smoothstep(0.26, 0.06, c.stream);
  const steep = smoothstep(0.18, 0.6, Math.hypot(c.gx, c.gy));
  // A slope that falls away to the north keeps its damp; one that faces the sun dries.
  const north = Math.max(-1, Math.min(1, -c.gy * 3));
  const hollow = Math.max(-0.6, Math.min(0.6, c.hollow));
  c.moisture = clamp01(0.28 + 0.36 * low + 0.24 * riparian + 0.14 * c.rain + 0.07 * c.margin + 0.5 * c.marsh - 0.3 * c.upland - 0.2 * steep + 0.06 * north + 0.08 * hollow);
  return c.moisture;
}

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

/** Lays `amount` of biome `k` over what's there: the others give way in proportion. */
function over(w: Float32Array, k: number, amount: number): void {
  if (amount <= 0) return;
  const a = amount > 1 ? 1 : amount;
  for (let i = 0; i < w.length; i++) w[i] = w[i]! * (1 - a);
  w[k] = w[k]! + a;
}

/** Where the bare rock starts, metres (it wavers by the rock line's noise). */
const ROCK_LINE = 6.8;

/**
 * Each biome's share at a point with this climate, into `out` (they sum to 1).
 * Laid one over another, the later the stronger: meadow everywhere, then heath
 * where it's high and dry, the woods where the woods are (birch, conifer or
 * deciduous by their own noise and the damp), marsh where it's wet and low,
 * rock where it breaks through, sand at the water's edge, and the kept ground
 * of the flats over all of it. Under water it's all water.
 */
export function biomeWeights(c: Climate, out: Float32Array = scratchWeights): Float32Array {
  out.fill(0);
  if (c.h < c.water || c.h < WATER_LEVEL) {
    out[WATER] = 1;
    return out;
  }
  out[MEADOW] = 1;
  const above = c.h - WATER_LEVEL;
  const m = c.moisture;
  const woods = smoothstep(-0.06, 0.3, c.woods + 0.55 * c.ridge * (1 - c.ridge) * 4 - 0.5 * c.upland);
  // Heath: the uplands, and any high, dry, open ground.
  over(out, HEATH, Math.max(c.upland * 0.96, smoothstep(0.34, 0.16, m) * smoothstep(3.4, 5.2, c.h) * (1 - woods * 0.8)));
  // The woods: conifers where their noise is high, the ground dry or a ridge under them; birches where it's low; the rest deciduous.
  if (woods > 0) {
    const conifer = smoothstep(0.12, 0.36, c.kind + (0.42 - m) * 0.5 + 0.3 * c.ridge);
    const birch = (1 - conifer) * smoothstep(-0.2, -0.45, c.kind - (m - 0.5) * 0.3);
    over(out, WOODLAND, woods * (1 - conifer) * (1 - birch));
    over(out, BIRCHWOOD, woods * birch);
    over(out, PINEWOOD, woods * conifer);
  }
  // Marsh: wet ground that lies low (the marsh flats are wet by their landform).
  const lowland = 1 - smoothstep(1.3, 2.5, above);
  over(out, MARSH, smoothstep(0.62, 0.84, m) * lowland);
  // Rock: above the rock line, and on a crag's crown.
  over(out, OUTCROP, Math.max(smoothstep(-0.5, 0.3, c.h - c.lift - (ROCK_LINE + c.rockline * 1.6)) * (1 - c.upland), smoothstep(0.35, 0.8, c.crag), smoothstep(0.8, 0.97, c.ridge) * 0.85));
  // Sand at the water's edge unless it's a reedy margin; and dunes behind it where the ground is dry.
  const reedy = smoothstep(0.58, 0.8, m);
  const dunes = smoothstep(0.15, 0.4, c.margin - c.rain * 0.4) * smoothstep(0.52, 0.4, m) * (1 - smoothstep(2.2, 3.4, above));
  over(out, SHORE, Math.max((1 - smoothstep(0.6, 1.1, above)) * (1 - reedy), dunes * (1 - woods)));
  over(out, LAWN, smoothstep(0.45, 0.65, c.flat));
  return out;
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
