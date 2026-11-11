import { COPENHAGEN } from "../sun.ts";

/*
 * The turning sky: where a fixed place among the stars (a right ascension and a
 * declination, J2000) stands over Copenhagen at a UTC instant. One rotation
 * matrix does it for every star at once: precession from J2000 to the date
 * (IAU 1976, as in Meeus), then the Earth's turn (Greenwich mean sidereal time
 * plus the longitude), then the tilt of the latitude. Good to a hundredth of a
 * degree, which is far finer than a sky needs. Pure, allocation-free (results
 * are written into what's passed in), unit-tested against the U.S. Naval
 * Observatory's figures.
 *
 * Frames. Equatorial: x towards right ascension 0 on the equator, y towards
 * 6 h, z to the north celestial pole. Horizon (the world's): x east, y north,
 * z up.
 */

export type Vec3 = [number, number, number];
/** A 3 × 3 matrix, row by row. */
export type Mat3 = Float64Array;

const RAD = Math.PI / 180;
const ARCSEC = RAD / 3600;
const DAY_MS = 86_400_000;
const TAU = 2 * Math.PI;

/** Days since J2000.0 (12:00 on 1 January 2000) at a UTC instant. */
export const daysSince2000 = (ms: number): number => ms / DAY_MS + 2440587.5 - 2451545;

/** Local mean sidereal time at a UTC instant (radians, 0..2π): the right ascension on the meridian at longitude `lon` (degrees east). */
export function siderealTime(ms: number, lon: number = COPENHAGEN.lon): number {
  const d = daysSince2000(ms);
  const T = d / 36525;
  const degrees = 280.46061837 + 360.98564736629 * d + T * T * (0.000387933 - T / 38710000) + lon;
  return ((((degrees % 360) + 360) % 360) * RAD) % TAU;
}

/** The unit vector of a right ascension and a declination (radians), into `out`. */
export function equatorial(ra: number, dec: number, out: Vec3): Vec3 {
  const c = Math.cos(dec);
  out[0] = c * Math.cos(ra);
  out[1] = c * Math.sin(ra);
  out[2] = Math.sin(dec);
  return out;
}

/**
 * The matrix that takes J2000 equatorial vectors to the horizon's frame (x east,
 * y north, z up) at a UTC instant, seen from (lat, lon) in degrees: into `out`.
 */
export function skyMatrix(ms: number, out: Mat3, lat: number = COPENHAGEN.lat, lon: number = COPENHAGEN.lon): Mat3 {
  // Precession since J2000: the three small angles, and the matrix they make.
  const T = daysSince2000(ms) / 36525;
  const zeta = T * (2306.2181 + T * (0.30188 + T * 0.017998)) * ARCSEC;
  const z = T * (2306.2181 + T * (1.09468 + T * 0.018203)) * ARCSEC;
  const theta = T * (2004.3109 - T * (0.42665 + T * 0.041833)) * ARCSEC;
  const cz = Math.cos(zeta);
  const sz = Math.sin(zeta);
  const cZ = Math.cos(z);
  const sZ = Math.sin(z);
  const ct = Math.cos(theta);
  const st = Math.sin(theta);
  const p00 = cz * ct * cZ - sz * sZ;
  const p01 = -sz * ct * cZ - cz * sZ;
  const p02 = -st * cZ;
  const p10 = cz * ct * sZ + sz * cZ;
  const p11 = -sz * ct * sZ + cz * cZ;
  const p12 = -st * sZ;
  const p20 = cz * st;
  const p21 = -sz * st;
  const p22 = ct;
  // The Earth's turn and the latitude: east, north and up as rows, in the equator's frame of the date.
  const s = siderealTime(ms, lon);
  const cs = Math.cos(s);
  const ss = Math.sin(s);
  const phi = lat * RAD;
  const cp = Math.cos(phi);
  const sp = Math.sin(phi);
  const e0 = -ss;
  const e1 = cs;
  const n0 = -sp * cs;
  const n1 = -sp * ss;
  const n2 = cp;
  const u0 = cp * cs;
  const u1 = cp * ss;
  const u2 = sp;
  out[0] = e0 * p00 + e1 * p10;
  out[1] = e0 * p01 + e1 * p11;
  out[2] = e0 * p02 + e1 * p12;
  out[3] = n0 * p00 + n1 * p10 + n2 * p20;
  out[4] = n0 * p01 + n1 * p11 + n2 * p21;
  out[5] = n0 * p02 + n1 * p12 + n2 * p22;
  out[6] = u0 * p00 + u1 * p10 + u2 * p20;
  out[7] = u0 * p01 + u1 * p11 + u2 * p21;
  out[8] = u0 * p02 + u1 * p12 + u2 * p22;
  return out;
}

/** `m` times the vector at `v[offset..offset + 2]`, into `out` (which may be `v`). */
export function rotate(m: Mat3, v: ArrayLike<number>, out: Vec3, offset = 0): Vec3 {
  const x = v[offset]!;
  const y = v[offset + 1]!;
  const z = v[offset + 2]!;
  out[0] = m[0]! * x + m[1]! * y + m[2]! * z;
  out[1] = m[3]! * x + m[4]! * y + m[5]! * z;
  out[2] = m[6]! * x + m[7]! * y + m[8]! * z;
  return out;
}

/** A horizon-frame unit vector's height above the horizon, radians. */
export const elevationOf = (v: Vec3): number => Math.asin(Math.max(-1, Math.min(1, v[2])));

/** Its compass bearing, radians: 0 north, π/2 east. */
export function azimuthOf(v: Vec3): number {
  const a = Math.atan2(v[0], v[1]);
  return a < 0 ? a + TAU : a;
}

/**
 * The Sun's longitude along the ecliptic at a UTC instant (radians, 0..2π),
 * for the equinox of J2000 (as meteor showers are tabulated): its mean
 * longitude and the equation of its centre, good to a hundredth of a degree.
 */
export function solarLongitude(ms: number): number {
  const d = daysSince2000(ms);
  const T = d / 36525;
  const g = (357.52911 + 35999.05029 * T) * RAD;
  const ofDate = 280.46646 + 36000.76983 * T + (1.914602 - 0.004817 * T) * Math.sin(g) + 0.019993 * Math.sin(2 * g) + 0.000289 * Math.sin(3 * g) - 0.00569;
  // (Back to the equinox of J2000: the equinox has moved 1.397° a century.)
  const j2000 = ofDate - 1.396971 * T;
  return (((j2000 % 360) + 360) % 360) * RAD;
}

/** The galaxy in the equator's frame (J2000): its north pole (12 h 51.4 min, +27.13°) and its centre (17 h 45.6 min, −28.94°). */
export const GALACTIC: { readonly pole: Readonly<Vec3>; readonly centre: Readonly<Vec3> } = {
  pole: equatorial(192.85948 * RAD, 27.12825 * RAD, [0, 0, 0]),
  centre: equatorial(266.40499 * RAD, -28.93617 * RAD, [0, 0, 0]),
};

/** The obliquity of the ecliptic at J2000 (radians): the tilt between the planets' plane and the equator. */
export const OBLIQUITY = 23.43928 * RAD;
