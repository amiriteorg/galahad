import { fbm, hash3, simplex, smoothstep } from "./noise.ts";
import { SITE_NAMES } from "@galahad/core/world";
import { SITE_GATES, SITE_LEVEL, SITE_RECTS } from "./sites.ts";

/*
 * The shape of the SANDBOX's land, as numbers: how high the ground is anywhere,
 * where the water lies and where the streams run, from one seed. Gentle hills,
 * lake basins and streams that come down in pools and waterfalls everywhere; and
 * beyond the home ground (the keep, the two sites and the lake before them:
 * what the map shows) the bigger things worth walking out to and looking across:
 *
 *   ridges     long, winding hills a good ten metres over the land around them;
 *   scarps     the edge of higher country: a long wooded bank three pools
 *              high, and where a stream comes down it, three falls one after
 *              another;
 *   uplands    high, dry, rolling ground with wide views (the heaths);
 *   marshes    wide flats lying at the water's level, half pools, half reeds;
 *   islands    in the lakes, big enough for a wood.
 *
 * The keep's ground (45 m around the origin), the two test sites, the roads to
 * them and every experiment plot are flat and blend into the hills around them.
 * Pure and deterministic: the same seed and the same plots give the same land on
 * every device. World coordinates (metres, x east, y north, z up), as in the
 * contract. What grows there, and how the ground is drawn, is terrain.ts'; the
 * climate between the two is biome.ts'.
 */

export const SEED = 0x6a1a4ad;
export const WATER_LEVEL = -1.4;
export const FLAT_LEVEL = 0;
export const KEEP_RADIUS = 45;
const KEEP_BLEND = 24;
/** Room for the fence and a path around a plot before the land starts to rise. */
export const PLOT_MARGIN = 3;
const PLOT_BLEND = 14;

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

/** How near the middle of a stream's bed (x, y) is: 0 in it, growing away from it (about 1 per 150 m). */
export function streamOff(seed: number, x: number, y: number): number {
  // Streams follow the zero line of a slow noise: long, winding, never ending.
  return Math.abs(simplex(seed + 91, x / 520, y / 520) + 0.35 * simplex(seed + 97, x / 140, y / 140) * 0.08);
}

/** How much of a stream runs at (x, y): 1 in its bed, easing to 0 on its banks. */
export function streamAt(seed: number, x: number, y: number): number {
  return smoothstep(0.08, 0.01, streamOff(seed, x, y));
}

/** How far a stream drops at a waterfall, metres: its pools step down by this much. */
export const STREAM_STEP = 2.2;
/** How far a stream's bed lies below its pool's surface. */
const STREAM_DEPTH = 0.7;

/** The home ground: the middle of what the map shows, and how far from it the land is left as it always was. */
const HOME_X = -35;
const HOME_Y = 0;
const HOME_NEAR = 250;
const HOME_FAR = 430;

/** 0 on the home ground (the keep, the sites, the lake before them), 1 well beyond it: where the bigger landforms are. */
export function afield(x: number, y: number): number {
  const d2 = (x - HOME_X) * (x - HOME_X) + (y - HOME_Y) * (y - HOME_Y);
  if (d2 <= HOME_NEAR * HOME_NEAR) return 0;
  if (d2 >= HOME_FAR * HOME_FAR) return 1;
  return smoothstep(HOME_NEAR, HOME_FAR, Math.sqrt(d2));
}

/** How deep in a lake's basin (x, y) lies: 0 outside one, 1 at its deepest. */
export function basinAt(seed: number, x: number, y: number): number {
  return smoothstep(-0.25, -0.62, simplex(seed + 29, x / 420, y / 420));
}

/** A ridge: how far up one (x, y) is, 0 off it to 1 on its crest. */
export function ridgeAt(seed: number, x: number, y: number): number {
  const far = afield(x, y);
  if (far <= 0) return 0;
  // Ridges follow the zero line of a slow noise, and come and go along it.
  const along = smoothstep(-0.15, 0.4, simplex(seed + 307, x / 1150, y / 1150));
  if (along <= 0) return 0;
  const off = Math.abs(simplex(seed + 301, x / 700, y / 700));
  return smoothstep(0.3, 0.02, off) * along * far;
}

/** A ridge's height over the land around it, metres. */
const RIDGE = 9.5;

/** An upland (the heaths): 0 off it to 1 on it. */
export function uplandAt(seed: number, x: number, y: number): number {
  const far = afield(x, y);
  if (far <= 0) return 0;
  return smoothstep(0.34, 0.6, simplex(seed + 367, x / 1050, y / 1050)) * far;
}

/** A marsh's flat: 0 off it to 1 on it. */
export function marshAt(seed: number, x: number, y: number): number {
  const far = afield(x, y);
  if (far <= 0) return 0;
  return smoothstep(0.36, 0.58, simplex(seed + 353, x / 820, y / 820)) * far;
}

/** The scarp's noise: the upland is where it's positive, and the bank runs just below its zero line. */
const scarpField = (seed: number, x: number, y: number): number => simplex(seed + 331, x / 1300, y / 1300);
/** The scarp stands this high: three of a stream's pools, so a stream comes down it in three falls. */
export const SCARP = STREAM_STEP * 3;
/** The bank's width, metres: a long, gentle, wooded slope. */
const SCARP_WIDTH = 40;

/**
 * How far up the scarp (x, y) is: 0 below it, 1 on the upland behind it. The bank's width is measured in metres (the
 * noise's value over its slope is the distance to its zero line), so it's never steeper than it's meant to be, however
 * the noise bunches up.
 */
export function scarpAt(seed: number, x: number, y: number): number {
  const far = afield(x, y);
  if (far <= 0) return 0;
  const f = scarpField(seed, x, y);
  if (f >= 0) return far;
  if (f <= -0.34) return 0;
  const gx = (scarpField(seed, x + 6, y) - f) / 6;
  const gy = (scarpField(seed, x, y + 6) - f) / 6;
  const d = f / Math.max(0.0012, Math.hypot(gx, gy));
  return d <= -SCARP_WIDTH ? 0 : smoothstep(-SCARP_WIDTH, 0, d) * far;
}

/** Islands stand one to a cell of this size (metres), where the cell's middle lies out in a lake. */
const ISLE_CELL = 190;

/** An island's rise at (x, y), metres over the lake's floor (0 away from one). */
export function isleAt(seed: number, x: number, y: number): number {
  const ci = Math.floor(x / ISLE_CELL);
  const cj = Math.floor(y / ISLE_CELL);
  // Its middle keeps well inside its cell, so no island is cut by a cell's edge.
  const mx = (ci + 0.34 + 0.32 * hash3(seed, ci, cj, 411)) * ISLE_CELL;
  const my = (cj + 0.34 + 0.32 * hash3(seed, ci, cj, 412)) * ISLE_CELL;
  const r = 34 + 30 * hash3(seed, ci, cj, 413);
  const dx = x - mx;
  const dy = y - my;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return 0;
  // Only out in a lake, and not on the home ground's own shores.
  if (Math.hypot(mx - HOME_X, my - HOME_Y) < HOME_NEAR) return 0;
  const deep = basinAt(seed, mx, my);
  if (deep < 0.42) return 0;
  // An uneven dome: a noise turns its outline, so no two are the same round shape.
  const d = Math.sqrt(d2) / (r * (0.88 + 0.12 * simplex(seed + 419, x / 38, y / 38)));
  if (d >= 1) return 0;
  const dome = (1 - d * d) * (1 - d * d);
  // (A small island is a low one: its shores are never cliffs.)
  return dome * (9 * deep + 2 + 2 * hash3(seed, ci, cj, 414)) * Math.min(1, r / 54);
}

/** The land's broad shape: hills and lake basins (and, beyond the home ground, ridges, uplands, marshes and islands), without the small bumps. */
export function broadHeight(seed: number, x: number, y: number, octaves = 4): number {
  let h = fbm(seed, x / 260, y / 260, octaves) * 9 + 2.2 - basinAt(seed, x, y) * 9 + isleAt(seed, x, y);
  const far = afield(x, y);
  if (far <= 0) return h;
  // An upland: the land lifted to high, rolling ground.
  const up = uplandAt(seed, x, y);
  if (up > 0) h += (4.3 + 0.9 * simplex(seed + 373, x / 150, y / 150) - h) * up * (1 - basinAt(seed, x, y));
  // A marsh: low land laid out flat at the water's own level, its hollows a hand under it (pools), its hummocks a hand over.
  const marsh = marshAt(seed, x, y);
  if (marsh > 0) {
    const low = 1 - smoothstep(WATER_LEVEL + 2.2, WATER_LEVEL + 4.5, h);
    if (low > 0) h += (WATER_LEVEL + 0.16 + 0.34 * simplex(seed + 359, x / 26, y / 26) - h) * marsh * low * smoothstep(WATER_LEVEL - 2.5, WATER_LEVEL - 0.6, h);
  }
  // A ridge: a long hill laid over whatever is there (through a lake: a spit, or a causeway).
  const ridge = ridgeAt(seed, x, y);
  if (ridge > 0) h += ridge * ridge * (3 - 2 * ridge) * RIDGE * (0.75 + 0.25 * simplex(seed + 311, x / 210, y / 210));
  return h;
}

/**
 * The surface of a stream's pool at (x, y): the land's broad height stepped down
 * to a whole number of drops above the lakes. Along a stream it's level for a
 * while, then drops by STREAM_STEP: a waterfall. Down a scarp it drops three
 * times.
 */
export function streamLevel(seed: number, x: number, y: number): number {
  // (With the scarp's rise, so a stream's pools climb the bank as the land does: three falls, one after another.)
  const rise = scarpAt(seed, x, y) * SCARP;
  return WATER_LEVEL + Math.max(0, Math.floor((broadHeight(seed, x, y, 3) + rise - WATER_LEVEL - 0.9) / STREAM_STEP)) * STREAM_STEP;
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
  // The upland behind a scarp stands a scarp higher (added after the terraces, so the bank is one slope, not a staircase).
  const scarp = scarpAt(seed, x, y);
  if (scarp > 0) h += scarp * SCARP;
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
