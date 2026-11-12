import { yearFraction } from "../season.ts";

/*
 * What light does in the air, by real conditions only: a rainbow (and its
 * fainter second bow) opposite a sun lower than 42° while rain falls or has
 * just passed and the sun is out; a 22° halo with sundogs round a lowish sun in
 * thin high cloud; noctilucent clouds low in the north on Denmark's summer
 * nights. Nothing here asks the world for anything: each is a function of the
 * sun's place, the date and the weather the page already has. (No aurora:
 * that would need data the page doesn't have.) Pure, so unit-tested; sky.ts
 * and rainbow.ts draw from the same numbers.
 */

type Vec3 = [number, number, number];

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------- the rainbow

/**
 * The bows, as degrees from the point opposite the sun. The first: violet at
 * 40.6°, red at 42.4° (water's dispersion), drawn a little wider so it reads.
 * The second: red at 50.4° inside, violet at 53.5° outside.
 */
export const RAINBOW = { inner: 40.2, outer: 43, secondInner: 49.8, secondOuter: 54.2, second: 0.42 } as const;

/** The point opposite the sun (a unit vector, any frame), into `out`. */
export function antisolar(sun: Readonly<Vec3>, out: Vec3): Vec3 {
  out[0] = -sun[0];
  out[1] = -sun[1];
  out[2] = -sun[2];
  return out;
}

/** The angle between a view direction and the point opposite the sun, radians (both unit vectors in one frame). */
export function bowDistance(view: Readonly<Vec3>, sun: Readonly<Vec3>): number {
  return Math.acos(Math.max(-1, Math.min(1, -(view[0] * sun[0] + view[1] * sun[1] + view[2] * sun[2]))));
}

const bow = { primary: 0, secondary: 0, hue: 0 };

/**
 * The bows at an angle from the point opposite the sun (degrees): how bright
 * the first and the second are there (0..1 each), and the colour across them
 * (hue 0 red .. 1 violet). One object, reused.
 */
export function rainbowAt(angleDeg: number): { primary: number; secondary: number; hue: number } {
  const p = (angleDeg - RAINBOW.inner) / (RAINBOW.outer - RAINBOW.inner);
  const s = (angleDeg - RAINBOW.secondInner) / (RAINBOW.secondOuter - RAINBOW.secondInner);
  // A band with soft ends.
  const band = (t: number) => (t <= 0 || t >= 1 ? 0 : smooth(0, 0.22, t) * (1 - smooth(0.78, 1, t)));
  bow.primary = band(p);
  bow.secondary = band(s) * RAINBOW.second;
  // Red outside the first bow, inside the second.
  bow.hue = bow.primary > 0 ? 1 - clamp01(p) : clamp01(s);
  return bow;
}

/**
 * The rain that has just passed, remembered: it rises with the rain within
 * seconds and fades over a couple of minutes after (the shower moving off,
 * still in the air opposite the sun). Returns the new memory, 0..1.
 */
export function rainMemory(past: number, rain: number, dt: number): number {
  const target = clamp01(rain);
  const tau = target > past ? 4 : 75;
  const next = target + (past - target) * Math.exp(-dt / tau);
  return next < 1e-4 && target === 0 ? 0 : next;
}

/**
 * How strongly a rainbow shows, 0..1: the sun up but lower than 42° (higher,
 * and the whole bow is below the horizon), out (no closed sky between it and
 * the rain), and rain in the air: falling now, or just past.
 */
export function rainbowStrength(sunElevationDeg: number, rain: number, rainPast: number, cloud: number): number {
  const sunUp = smooth(0.3, 3, sunElevationDeg) * (1 - smooth(38, 42, sunElevationDeg));
  const sunOut = 1 - smooth(0.55, 0.88, cloud);
  const drops = clamp01(Math.max(rain, rainPast) * 1.5);
  return sunUp * sunOut * smooth(0.04, 0.5, drops);
}

// ---------------------------------------------------------------- halo and sundogs

/** The halo's radius round the sun: ice's 22°. */
export const HALO = 22 * RAD;
/** Ice's refractive index, and the prism angle of a plate crystal's side faces. */
const ICE = 1.31;

const dog = { distance: 0, bearing: 0 };

/**
 * A sundog for a sun at `elevation` (radians): how far from the sun it stands
 * (22° when the sun is on the horizon, farther as it climbs: light crosses the
 * crystals askew) and the turn of bearing that puts it there at the sun's own
 * height. One object, reused.
 */
export function parhelion(elevation: number): { distance: number; bearing: number } {
  const h = Math.max(0, Math.min(60 * RAD, elevation));
  const skew = Math.sqrt(ICE * ICE - Math.sin(h) ** 2) / Math.cos(h);
  dog.distance = 2 * Math.asin(Math.min(1, skew * 0.5)) - 60 * RAD;
  dog.bearing = Math.acos(Math.max(-1, Math.min(1, (Math.cos(dog.distance) - Math.sin(h) ** 2) / Math.cos(h) ** 2)));
  return dog;
}

/**
 * How strongly the halo and its sundogs show, 0..1: thin high cloud (`cirrus`,
 * 0..1) before a sun that is up and lowish, and no thicker cloud in the way.
 */
export function haloStrength(sunElevationDeg: number, cirrus: number, cloud: number): number {
  const sun = smooth(0.5, 4, sunElevationDeg) * (1 - smooth(30, 46, sunElevationDeg));
  return sun * smooth(0.08, 0.6, cirrus) * (1 - smooth(0.5, 0.8, cloud));
}

// ---------------------------------------------------------------- noctilucent clouds

/**
 * Their season at Denmark's latitude, by the real date: from the last week of
 * May to the first week of August, at its height from mid June to late July.
 * 0..1.
 */
export function noctilucentSeason(ms: number): number {
  const day = yearFraction(ms) * 365;
  return smooth(140, 162, day) * (1 - smooth(205, 222, day));
}

/**
 * How strongly they show, 0..1: in their season, while the sun is 6° to 16°
 * below the horizon (they are 80 km up and still sunlit when the land and the
 * lower air are dark), and the sky under them is open.
 */
export function noctilucent(ms: number, sunElevationDeg: number, cloud: number): number {
  const depth = -sunElevationDeg;
  const lit = smooth(6, 8, depth) * (1 - smooth(14, 16, depth));
  if (lit <= 0) return 0;
  return noctilucentSeason(ms) * lit * (1 - smooth(0.25, 0.8, cloud));
}

export { DEG as DEGREES };
