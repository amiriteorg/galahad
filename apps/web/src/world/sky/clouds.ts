/*
 * The clouds, as numbers: which kinds the weather makes, where each stands over
 * the land, and how the wind moves them. Three layers, each with its own place
 * in the world, so they slide past each other as real ones do:
 *
 * - low heaps (cumulus; under rain, ragged scud; in a storm, thunderheads with
 *   anvils): one in each cell of a grid over the land, each with its own place
 *   in its cell, its size, and the cover at which it forms. They are drawn as
 *   real faceted shapes (cloud-mesh.ts);
 * - a sheet above them (stratus, stratocumulus, the lid of an overcast or a
 *   rainy sky): a field over the land, drawn in the sky's shader;
 * - cirrus high above, drawn in the sky's shader too.
 *
 * The shadows that drift over the land are these same clouds: a point is shaded
 * when the cloud that stands between it and the sun (found here by
 * `cumulusOver` and `sheetOver`, on the GPU by the same sums in cloud-field.ts)
 * is there. So a shadow passing over Galahad has its cloud overhead, moving the
 * same way at the same speed.
 *
 * Coordinates are the scene's along the ground (x east, z south), metres.
 * Everything repeats every FIELD metres (far beyond what can be seen), so the
 * wind's travel can wrap and the GPU's floats stay precise in a page left open
 * for days. Pure, allocation-free, unit-tested.
 */

/** The grid of low clouds: its cell (metres) and how many cells a side before it repeats. */
export const CELL = 300;
export const CELLS = 14;
/** Everything repeats every this many metres (the sheet's waves are whole numbers of it too). */
export const FIELD = CELL * CELLS;
/**
 * The flat base of the low clouds, and the height of the sheet (metres above the keep's ground). The camera sees the
 * sky from the far hills' tops (about 5° up) to some 11° up: at this height the low clouds from 650 m to a kilometre
 * and a half off stand in that strip, before and behind the far ranges.
 */
export const CUMULUS_BASE = 125;
export const SHEET_HEIGHT = 560;
/** The sheet is drawn on a shell that curves down to the horizon: its radius of curvature (metres). */
export const SHEET_CURVE = 5200;

const TAU = 2 * Math.PI;
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------- kinds

export type CloudKind = "clear" | "cirrus" | "cumulus" | "stratocumulus" | "stratus" | "nimbostratus" | "cumulonimbus";

export interface CloudKinds {
  /** Low heaps: how far the field of them has formed, 0..1 (each cloud forms at its own level). */
  cumulus: number;
  /** The sheet: the share of the sky it covers, 0..1 (1: a lid). */
  sheet: number;
  /** Cirrus: thin streaks high up, 0..1. */
  cirrus: number;
  /** Thunderheads: towers with anvils among the low clouds, 0..1. */
  towers: number;
  /** How dark and ragged the low clouds are (scud under rain), 0..1. */
  scud: number;
  /** What the sky mostly holds, for words. */
  kind: CloudKind;
}

export const emptyKinds = (): CloudKinds => ({ cumulus: 0, sheet: 0, cirrus: 0, towers: 0, scud: 0, kind: "clear" });

/** The weather as the clouds need it (the world's weather state has all of this). */
export interface CloudWeather {
  cloud: number;
  rain: number;
  mist: number;
  snow?: number;
  storm?: number;
}

/**
 * The kinds of cloud a sky of this weather holds. Fair-weather cumulus is the
 * work of a sun that warms the ground: by day, most in the warm half of the
 * year (`warmth` 0 midwinter to 1 midsummer), not in mist. What cloud there is
 * without it lies as a sheet, with cirrus above while the sky is mostly open.
 * As the cover closes the heaps merge into the sheet; rain and snow fall from a
 * lid with scud under it, and thunder brings the towers.
 */
export function cloudKinds(w: CloudWeather, sunElevationDeg: number, warmth: number, out: CloudKinds): CloudKinds {
  const c = clamp01(w.cloud);
  const wet = clamp01(Math.max(w.rain, (w.snow ?? 0) * 0.8));
  const storm = clamp01(w.storm ?? 0);
  // Convection: a sun well up, a warm season, clear air.
  const convection = smooth(4, 24, sunElevationDeg) * (0.3 + 0.7 * clamp01(warmth)) * (1 - 0.8 * clamp01(w.mist));
  // Of broken cloud, the share that's heaps (the rest is sheet): few in mist, whose cloud lies flat.
  const share = (0.25 + 0.75 * convection) * (1 - 0.7 * clamp01(w.mist));
  const closing = smooth(0.62, 0.95, c);
  const open = 1 - closing;
  out.scud = clamp01(wet * 1.4);
  out.towers = storm;
  // Heaps: the broken cloud's share, then a few under the deck for depth; scud while it rains.
  out.cumulus = clamp01((c * open * share * 1.3 + 0.22 * closing) * (1 - wet) + 0.34 * wet + 0.2 * storm);
  // The sheet: what isn't heaps; a lid when it rains, snows or thunders.
  out.sheet = clamp01(Math.max(c * (1 - share * open), smooth(0, 0.25, wet) * Math.max(0.9, c), storm));
  // Cirrus: while the sky is mostly open, and less of it under towering summer cumulus.
  out.cirrus = smooth(0.03, 0.2, c) * (1 - smooth(0.42, 0.72, c)) * (1 - 0.55 * convection) * (1 - wet);
  out.kind =
    c < 0.04
      ? "clear"
      : storm > 0.4
        ? "cumulonimbus"
        : wet > 0.12
          ? "nimbostratus"
          : out.sheet > 0.8
            ? "stratus"
            : out.cumulus * 0.9 > out.sheet && out.cumulus > 0.12
              ? "cumulus"
              : out.sheet > 0.2
                ? "stratocumulus"
                : out.cirrus > 0.05
                  ? "cirrus"
                  : out.cumulus > 0.03
                    ? "cumulus"
                    : "stratocumulus";
  return out;
}

// ---------------------------------------------------------------- the wind's travel

/** The low clouds' speed over the land for a wind at the ground (m/s): they ride a faster wind than the one that bends the grass. */
export const cloudSpeed = (wind: number): number => 2 + 1.25 * wind;
/** The sheet rides a faster one still. */
export const SHEET_SPEED = 1.35;

/** How far the wind has carried the clouds (metres, wrapped to the field), and a slow clock they change by. */
export interface CloudTravel {
  x: number;
  z: number;
  sheetX: number;
  sheetZ: number;
  /** Seconds, wrapped (clouds form and fade on it, slowly). */
  clock: number;
}

export const emptyTravel = (): CloudTravel => ({ x: 0, z: 0, sheetX: 0, sheetZ: 0, clock: 0 });

const wrap = (v: number, period: number): number => ((v % period) + period) % period;
/** The clock wraps here: a whole number of every cloud's own slow cycle would be asking too much, so it wraps where a jump can't be seen (see `breath`). */
export const CLOCK_WRAP = 86_400;

/** Moves the clouds on by `dt` seconds with a wind of `wind` m/s blowing towards (windX, windZ), a unit vector along the ground. */
export function blow(t: CloudTravel, dt: number, wind: number, windX: number, windZ: number): CloudTravel {
  const d = cloudSpeed(wind) * dt;
  t.x = wrap(t.x + windX * d, FIELD);
  t.z = wrap(t.z + windZ * d, FIELD);
  t.sheetX = wrap(t.sheetX + windX * d * SHEET_SPEED, FIELD);
  t.sheetZ = wrap(t.sheetZ + windZ * d * SHEET_SPEED, FIELD);
  t.clock = wrap(t.clock + dt, CLOCK_WRAP);
  return t;
}

// ---------------------------------------------------------------- the low clouds

/** The hash three's TSL `hash()` computes on the GPU (PCG), on the same 32-bit integers: the page and the shader agree on every cloud. */
export function hash32(n: number): number {
  const state = (Math.imul(n >>> 0, 747796405) + 2891336453) >>> 0;
  const word = Math.imul((state >>> ((state >>> 28) + 4)) ^ state, 277803737) >>> 0;
  return (((word >>> 22) ^ word) >>> 0) / 4294967296;
}

/** A cell's number, and the salts its properties are hashed with. */
export const cellId = (ci: number, cj: number): number => wrap(ci, CELLS) + wrap(cj, CELLS) * CELLS;
export const SALT = { rank: 11, size: 1013, x: 2027, z: 3041, turn: 4057, tower: 5081, phase: 6101 } as const;
const hashOf = (id: number, salt: number): number => hash32(id * 7 + salt);

/** A cloud's radius before it has grown (metres): small ones and big ones. */
export const RADIUS_MIN = 54;
export const RADIUS_SPAN = 70;
/** Its footprint is an ellipse this much narrower across than along. */
export const SQUASH = 0.72;
/** A cloud grows from nothing to its size as the level passes its rank, over this much level. */
export const GROW = 0.16;
/** The level is stretched so that a full field has every cloud grown. */
export const LEVEL_GAIN = 1 + GROW;
/** The share of cells that hold a thunderhead when thunder is up. */
export const TOWER_SHARE = 0.3;

export interface Cloud {
  /** Its centre in the field (metres; add the wind's travel for where it is over the land). */
  x: number;
  z: number;
  /** Its radius along its long axis now (0: not formed), and the turn of that axis (radians). */
  r: number;
  turn: number;
  /** How far it has grown, 0..1. */
  grown: number;
  /** Whether this cell's cloud is a thunderhead when thunder is up. */
  tower: boolean;
}

export const emptyCloud = (): Cloud => ({ x: 0, z: 0, r: 0, turn: 0, grown: 0, tower: false });

/** The slow swell and fade every cloud has of its own: its rank wanders this much on the clock. */
export function breath(id: number, clock: number): number {
  const h = hashOf(id, SALT.phase);
  // (A whole number of turns a day, so the clock's wrap can't be seen.)
  const turns = 30 + Math.floor(h * 50);
  return 0.07 * Math.sin((clock / CLOCK_WRAP) * TAU * turns + h * TAU);
}

/** The cloud of cell (ci, cj) at a level of cumulus (0..1) and a clock (seconds), into `out`. */
export function cloudAt(ci: number, cj: number, level: number, clock: number, out: Cloud): Cloud {
  const id = cellId(ci, cj);
  const rank = hashOf(id, SALT.rank);
  const r0 = RADIUS_MIN + RADIUS_SPAN * hashOf(id, SALT.size);
  // Room to stand anywhere in its cell without leaving it (so one look-up finds the cloud over any point).
  const room = CELL / 2 - r0 * 1.16 - 2;
  out.x = (wrap(ci, CELLS) + 0.5) * CELL + (hashOf(id, SALT.x) * 2 - 1) * room;
  out.z = (wrap(cj, CELLS) + 0.5) * CELL + (hashOf(id, SALT.z) * 2 - 1) * room;
  out.turn = hashOf(id, SALT.turn) * Math.PI;
  out.grown = smooth(rank, rank + GROW, level * LEVEL_GAIN + breath(id, clock) * Math.min(1, level * 4));
  out.r = r0 * (0.8 + 0.35 * level) * out.grown;
  out.tower = hashOf(id, SALT.tower) < TOWER_SHARE;
  return out;
}

const scratch = emptyCloud();

/**
 * How much low cloud stands over a point of the land (0..1; soft at the
 * cloud's rim), given the wind's travel: the cloud of the cell the point is
 * under, if it has formed and reaches that far.
 */
export function cumulusOver(x: number, z: number, level: number, travel: CloudTravel): number {
  if (level <= 0) return 0;
  const fx = wrap(x - travel.x, FIELD);
  const fz = wrap(z - travel.z, FIELD);
  const c = cloudAt(Math.floor(fx / CELL), Math.floor(fz / CELL), level, travel.clock, scratch);
  if (c.r < 1) return 0;
  const dx = fx - c.x;
  const dz = fz - c.z;
  const cos = Math.cos(c.turn);
  const sin = Math.sin(c.turn);
  const along = (dx * cos + dz * sin) / c.r;
  const across = (-dx * sin + dz * cos) / (c.r * SQUASH);
  return 1 - smooth(0.72, 1.04, Math.hypot(along, across));
}

// ---------------------------------------------------------------- the sheet

/** The sheet's waves: whole numbers of them across the field, so it repeats with it. */
const K1 = (TAU * 6) / FIELD;
const K2 = (TAU * 4) / FIELD;
const K3 = (TAU * 7) / FIELD;
const K4 = (TAU * 3) / FIELD;
export const SHEET_WAVES = { k1: K1, k2: K2, k3: K3, k4: K4, warp1: 1.9, warp2: 1.6 } as const;

/** The sheet's thickness at a point of its own field, 0..1 (cloud where it stands above the edge for the cover). */
export function sheetField(fx: number, fz: number): number {
  return 0.5 + 0.5 * Math.sin(K1 * fx + SHEET_WAVES.warp1 * Math.sin(K2 * fz)) * Math.sin(K3 * fz + SHEET_WAVES.warp2 * Math.sin(K4 * fx));
}

/** The thickness above which the sheet is cloud, for a share of sky covered (1: all of it, with room to spare). */
export function sheetEdge(cover: number): number {
  const c = clamp01(cover);
  const side = c < 0.5 ? 1 : -1;
  return 0.5 + 0.5 * side * Math.abs(2 * c - 1) ** 1.6 - smooth(0.88, 1, c) * 0.2;
}

/** How much of the sheet stands over a point of the land (0..1, soft at its rim). */
export function sheetOver(x: number, z: number, cover: number, travel: CloudTravel): number {
  if (cover <= 0) return 0;
  const edge = sheetEdge(cover);
  return smooth(edge - 0.02, edge + 0.1, sheetField(x - travel.sheetX, z - travel.sheetZ));
}

// ---------------------------------------------------------------- shadows

/**
 * Where over the land the cloud stands whose shadow falls on a point: the point
 * moved towards the sun by the cloud's height over how steeply the light comes
 * down. `sun` is a unit vector in the scene's axes (x east, y up, z south);
 * `height` the cloud's height above the point. Into `out` (x, z). A sun lower
 * than about 11° is taken as 11° (shadows that long have faded out anyway).
 */
export function shadowCaster(x: number, z: number, sunX: number, sunY: number, sunZ: number, height: number, out: [number, number]): [number, number] {
  const k = height / Math.max(0.19, sunY);
  out[0] = x + sunX * k;
  out[1] = z + sunZ * k;
  return out;
}

const caster: [number, number] = [0, 0];

/** The shade of the clouds on a point of the land at height `y` (0 sunlit .. 1 under a cloud): the low clouds' and the sheet's, whichever is more. */
export function cloudShade(x: number, y: number, z: number, sunX: number, sunY: number, sunZ: number, kinds: Pick<CloudKinds, "cumulus" | "sheet">, travel: CloudTravel): number {
  shadowCaster(x, z, sunX, sunY, sunZ, CUMULUS_BASE - y, caster);
  const low = cumulusOver(caster[0], caster[1], kinds.cumulus, travel);
  shadowCaster(x, z, sunX, sunY, sunZ, SHEET_HEIGHT - y, caster);
  return Math.max(low, sheetOver(caster[0], caster[1], kinds.sheet, travel));
}

/**
 * How far along the ground the sheet is from a viewer who looks up at it at
 * `elevation` (radians): it lies on a shell that curves down to the horizon, so
 * it is never infinitely far, and its shapes still read low in the sky.
 */
export function sheetReach(elevation: number): number {
  const t = Math.tan(Math.max(-0.03, elevation));
  return SHEET_CURVE * (Math.sqrt(t * t + (2 * SHEET_HEIGHT) / SHEET_CURVE) - t);
}
