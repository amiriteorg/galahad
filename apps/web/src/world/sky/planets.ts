import { COPENHAGEN, emptySun, sunAt } from "../sun.ts";
import { azimuthOf, daysSince2000, elevationOf, type Mat3, OBLIQUITY, rotate, skyMatrix, type Vec3 } from "./celestial.ts";

/*
 * The naked-eye planets over Copenhagen: Venus, Mars, Jupiter and Saturn, from
 * the Jet Propulsion Laboratory's low-precision orbits ("Approximate Positions
 * of the Planets", E. M. Standish, table 1: mean elements and their rates,
 * valid 1800 to 2050, https://ssd.jpl.nasa.gov/planets/approx_pos.html). Each
 * planet's and the Earth's place round the Sun is worked out from its ellipse,
 * the difference is where the planet stands in our sky, and the turning-sky
 * matrix puts it over the horizon. Good to a few minutes of arc for Venus and
 * Mars and about a tenth of a degree for Jupiter and Saturn: plenty to say
 * "Jupiter in the south-east" and to draw it among the right stars. Brightness
 * from the usual formulas (distance and phase). Pure, allocation-free,
 * unit-tested against the U.S. Naval Observatory.
 */

export type PlanetName = "Venus" | "Mars" | "Jupiter" | "Saturn";
export const PLANETS: readonly PlanetName[] = ["Venus", "Mars", "Jupiter", "Saturn"];

export interface Planet {
  name: PlanetName;
  /** Where it stands among the stars: a unit vector in the equator's frame (J2000). */
  place: Vec3;
  /** Height above the horizon and compass bearing, radians (no refraction). */
  elevation: number;
  azimuth: number;
  /** Visual magnitude (smaller is brighter: Venus about −4, Saturn about +1). */
  magnitude: number;
  /** Its angle from the Sun in the sky, radians. */
  elongation: number;
}

export const emptyPlanets = (): Planet[] => PLANETS.map((name) => ({ name, place: [1, 0, 0], elevation: 0, azimuth: 0, magnitude: 0, elongation: 0 }));

const RAD = Math.PI / 180;

/** a (au), e, I, L, ϖ, Ω (degrees), then their rates a century: JPL's table 1. */
type Elements = readonly [number, number, number, number, number, number, number, number, number, number, number, number];
const ELEMENTS: Record<PlanetName | "Earth", Elements> = {
  Venus: [0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255, 0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418],
  // (The Earth and Moon's centre of mass: within a few thousand kilometres of the Earth, nothing in the sky.)
  Earth: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0, 0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0],
  Mars: [1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891, 0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343],
  Jupiter: [5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909, -0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106],
  Saturn: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448, -0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794],
};

/** A body's place round the Sun (au, the ecliptic's frame of J2000) `T` centuries after J2000, into `out`. */
function heliocentric(el: Elements, T: number, out: Vec3): Vec3 {
  const a = el[0] + el[6] * T;
  const e = el[1] + el[7] * T;
  const I = (el[2] + el[8] * T) * RAD;
  const L = el[3] + el[9] * T;
  const peri = el[4] + el[10] * T;
  const node = (el[5] + el[11] * T) * RAD;
  const w = peri * RAD - node;
  // The mean anomaly, to −180..180°, then Kepler's equation by Newton's method.
  const M = ((((L - peri + 180) % 360) + 360) % 360 - 180) * RAD;
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 6; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const x = a * (Math.cos(E) - e);
  const y = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(w);
  const sw = Math.sin(w);
  const cn = Math.cos(node);
  const sn = Math.sin(node);
  const ci = Math.cos(I);
  const si = Math.sin(I);
  out[0] = (cw * cn - sw * sn * ci) * x + (-sw * cn - cw * sn * ci) * y;
  out[1] = (cw * sn + sw * cn * ci) * x + (-sw * sn + cw * cn * ci) * y;
  out[2] = sw * si * x + cw * si * y;
  return out;
}

/** Magnitude at one au from Sun and Earth, and how it dims with the phase angle `i` (degrees): the classic formulas (Meeus, after Müller). */
function magnitudeOf(name: PlanetName, r: number, delta: number, i: number): number {
  const distance = 5 * Math.log10(r * delta);
  if (name === "Venus") return -4.4 + distance + i * (0.0009 + i * (0.000239 - i * 0.00000065));
  if (name === "Mars") return -1.52 + distance + 0.016 * i;
  if (name === "Jupiter") return -9.4 + distance + 0.005 * i;
  // Saturn without its rings' tilt (they add or take a few tenths).
  return -8.88 + distance + 0.044 * i;
}

const earth: Vec3 = [0, 0, 0];
const body: Vec3 = [0, 0, 0];
const local: Vec3 = [0, 0, 0];
const matrix: Mat3 = new Float64Array(9);
const sun = emptySun();
const cosE = Math.cos(OBLIQUITY);
const sinE = Math.sin(OBLIQUITY);

/** The four planets at a UTC instant, seen from (lat, lon) in degrees: written into `out` (emptyPlanets()), which is returned. */
export function planetsAt(ms: number, out: Planet[], lat: number = COPENHAGEN.lat, lon: number = COPENHAGEN.lon): Planet[] {
  const T = daysSince2000(ms) / 36525;
  heliocentric(ELEMENTS.Earth, T, earth);
  skyMatrix(ms, matrix, lat, lon);
  sunAt(ms, sun, lat, lon);
  const r0 = Math.hypot(earth[0], earth[1], earth[2]);
  for (const p of out) {
    heliocentric(ELEMENTS[p.name], T, body);
    const r = Math.hypot(body[0], body[1], body[2]);
    const x = body[0] - earth[0];
    const y = body[1] - earth[1];
    const z = body[2] - earth[2];
    const delta = Math.hypot(x, y, z);
    // From the ecliptic's frame to the equator's: a turn about x by the obliquity.
    p.place[0] = x / delta;
    p.place[1] = (y * cosE - z * sinE) / delta;
    p.place[2] = (y * sinE + z * cosE) / delta;
    rotate(matrix, p.place, local);
    p.elevation = elevationOf(local);
    p.azimuth = azimuthOf(local);
    // The angles at the planet (its phase) and at the Earth (its elongation from the Sun), from the triangle's sides.
    const phase = Math.acos(Math.max(-1, Math.min(1, (r * r + delta * delta - r0 * r0) / (2 * r * delta))));
    p.elongation = Math.acos(Math.max(-1, Math.min(1, (r0 * r0 + delta * delta - r * r) / (2 * r0 * delta))));
    p.magnitude = magnitudeOf(p.name, r, delta, phase / RAD);
  }
  return out;
}

/**
 * Whether a planet can be seen: up, and the sky dark enough for something that
 * bright (Venus and Jupiter show in bright twilight, Saturn needs it darker).
 * 0..1.
 */
export function planetShows(p: Planet, sunElevation: number): number {
  const up = Math.max(0, Math.min(1, (p.elevation / RAD - 1) / 3));
  // The sun's depth (degrees below the horizon) at which a star of this magnitude comes out.
  const need = Math.max(0, 5.5 + 1.6 * p.magnitude);
  const dark = Math.max(0, Math.min(1, (-sunElevation / RAD - need + 2.5) / 2.5));
  return up * dark;
}
