/*
 * References for the world's sky.
 *
 * The stars: the U.S. Naval Observatory's computed altitudes and azimuths (its
 * Astronomical Applications API, "celnav": Hc and Zn, no refraction) for
 * 55.676° N, 12.568° E, the figures the world's own tests hold
 * (apps/web/src/world/sky/heavens.test.ts).
 *
 * The sun and the moon: no almanac table can be fetched here (benchmarks run
 * offline), so they are cross-checked the way the Trials' answers are, by an
 * independent method: the Astronomical Almanac's low-precision formulae (its
 * section C for the sun, good to 0.01°; section D for the moon, good to about
 * 0.3° in longitude and 0.2° in latitude), with the moon's place brought from
 * the Earth's centre to Copenhagen (its parallax is up to a degree). The world
 * computes the sun by NOAA's equations and the moon from the main term of each
 * coordinate (sun.ts), so the two share no code and few constants.
 *
 * Sunrise and sunset: the almanac's times the world's own test holds
 * (timeanddate.com, sunrise-sunset.org).
 */

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
export const COPENHAGEN = { lat: 55.676, lon: 12.568 } as const;

export interface Place {
  /** Degrees above the horizon, and from north through east. */
  alt: number;
  az: number;
}

const daysSince2000 = (ms: number): number => ms / DAY_MS + 2440587.5 - 2451545;
const sinD = (deg: number): number => Math.sin(deg * RAD);
const cosD = (deg: number): number => Math.cos(deg * RAD);
const wrap = (deg: number): number => ((deg % 360) + 360) % 360;

/** Local mean sidereal time, degrees. */
function sidereal(ms: number, lon: number): number {
  return wrap((18.697374558 + 24.06570982441908 * daysSince2000(ms)) * 15 + lon);
}

/** Height and bearing of a body at right ascension and declination (degrees), from (lat, lon). */
function horizontal(ms: number, ra: number, dec: number, lat: number, lon: number): Place {
  const h = sidereal(ms, lon) - ra;
  const alt = Math.asin(sinD(lat) * sinD(dec) + cosD(lat) * cosD(dec) * cosD(h)) / RAD;
  const az = wrap(Math.atan2(-sinD(h) * cosD(dec), cosD(lat) * sinD(dec) - sinD(lat) * cosD(dec) * cosD(h)) / RAD);
  return { alt, az };
}

/** The sun's apparent place: ecliptic longitude, right ascension and declination, degrees. */
export function sunPlace(ms: number): { lambda: number; ra: number; dec: number } {
  const n = daysSince2000(ms);
  const g = 357.528 + 0.9856003 * n;
  const lambda = wrap(280.46 + 0.9856474 * n + 1.915 * sinD(g) + 0.02 * sinD(2 * g));
  const eps = 23.439 - 0.0000004 * n;
  return { lambda, ra: wrap(Math.atan2(cosD(eps) * sinD(lambda), cosD(lambda)) / RAD), dec: Math.asin(sinD(eps) * sinD(lambda)) / RAD };
}

export function referenceSun(ms: number, lat: number = COPENHAGEN.lat, lon: number = COPENHAGEN.lon): Place {
  const { ra, dec } = sunPlace(ms);
  return horizontal(ms, ra, dec, lat, lon);
}

/** The moon from the Earth's centre: ecliptic longitude and latitude and horizontal parallax, degrees. */
export function moonPlace(ms: number): { lambda: number; beta: number; parallax: number } {
  const t = daysSince2000(ms) / 36525;
  const lambda = wrap(
    218.32 + 481267.881 * t + 6.29 * sinD(135.0 + 477198.87 * t) - 1.27 * sinD(259.3 - 413335.36 * t) + 0.66 * sinD(235.7 + 890534.22 * t) + 0.21 * sinD(269.9 + 954397.74 * t) - 0.19 * sinD(357.5 + 35999.05 * t) - 0.11 * sinD(186.5 + 966404.03 * t),
  );
  const beta = 5.13 * sinD(93.3 + 483202.02 * t) + 0.28 * sinD(228.2 + 960400.89 * t) - 0.28 * sinD(318.3 + 6003.15 * t) - 0.17 * sinD(217.6 - 407332.21 * t);
  const parallax = 0.9508 + 0.0518 * cosD(135.0 + 477198.87 * t) + 0.0095 * cosD(259.3 - 413335.36 * t) + 0.0078 * cosD(235.7 + 890534.22 * t) + 0.0028 * cosD(269.9 + 954397.74 * t);
  return { lambda, beta, parallax };
}

/** The moon as seen from a place on the Earth's surface (its parallax taken off). */
export function referenceMoon(ms: number, lat: number = COPENHAGEN.lat, lon: number = COPENHAGEN.lon): Place {
  const { lambda, beta, parallax } = moonPlace(ms);
  // Direction cosines in the equator's frame (the obliquity's cosine and sine, as the Almanac gives them).
  const l = cosD(beta) * cosD(lambda);
  const m = 0.9175 * cosD(beta) * sinD(lambda) - 0.3978 * sinD(beta);
  const n = 0.3978 * cosD(beta) * sinD(lambda) + 0.9175 * sinD(beta);
  // From the centre to the observer, in Earth radii.
  const r = 1 / sinD(parallax);
  const theta = sidereal(ms, lon);
  const x = r * l - cosD(lat) * cosD(theta);
  const y = r * m - cosD(lat) * sinD(theta);
  const z = r * n - sinD(lat);
  const ra = wrap(Math.atan2(y, x) / RAD);
  const dec = Math.atan2(z, Math.hypot(x, y)) / RAD;
  return horizontal(ms, ra, dec, lat, lon);
}

/** The angle between two directions in the sky, arc-minutes. */
export function apart(a: Place, b: Place): number {
  const cos = sinD(a.alt) * sinD(b.alt) + cosD(a.alt) * cosD(b.alt) * cosD(a.az - b.az);
  return (Math.acos(Math.max(-1, Math.min(1, cos))) / RAD) * 60;
}

/** The angle between the sun and the moon from the Earth's centre, degrees (0 at new moon, 180 at full). */
export function elongation(ms: number): number {
  const sun = sunPlace(ms);
  const moon = moonPlace(ms);
  return Math.acos(Math.max(-1, Math.min(1, cosD(moon.beta) * cosD(moon.lambda - sun.lambda)))) / RAD;
}

/** Thirty-six instants over two years: every twentieth day or so, at an hour that goes round the clock. */
export const INSTANTS: readonly number[] = Array.from({ length: 36 }, (_, i) => Date.parse("2026-01-05T00:00:00Z") + i * 20.3 * DAY_MS + ((i * 7) % 24) * 3_600_000);

/** The Naval Observatory's figures: star, instant, altitude, azimuth. */
export const STAR_PINS: readonly (readonly [string, string, number, number])[] = [
  ["Polaris", "2026-11-11T22:00:00Z", 56.281, 0.264],
  ["Polaris", "2026-02-01T20:00:00Z", 56.162, 359.312],
  ["Polaris", "2026-06-21T23:00:00Z", 55.203, 0.73],
  ["Polaris", "2030-09-01T03:00:00Z", 56.28, 0.207],
  ["Sirius", "2026-02-01T20:00:00Z", 16.162, 163.079],
  ["Sirius", "2026-11-12T04:00:00Z", 15.165, 202.101],
  ["Vega", "2026-11-11T22:00:00Z", 19.738, 310.95],
  ["Vega", "2026-06-21T23:00:00Z", 71.4, 150.174],
  ["Vega", "2026-02-01T20:00:00Z", 5.323, 348.434],
  ["Betelgeuse", "2026-11-11T22:00:00Z", 25.023, 115.541],
  ["Betelgeuse", "2026-02-01T20:00:00Z", 41.6, 173.968],
  ["Capella", "2026-11-11T22:00:00Z", 60.002, 89.106],
  ["Arcturus", "2026-06-21T23:00:00Z", 35.913, 249.746],
  ["Antares", "2026-06-21T23:00:00Z", 6.083, 197.889],
  ["Deneb", "2026-06-21T23:00:00Z", 61.411, 92.864],
  ["Aldebaran", "2026-11-11T22:00:00Z", 42.384, 130.704],
  ["Rigel", "2026-11-11T22:00:00Z", 15.962, 132.923],
];

/** The almanac's sunrises and sunsets over Copenhagen: the window to look in (UTC), whether it's a rise, and the minute. */
export const SUN_TIMES: readonly (readonly [string, string, boolean, string])[] = [
  ["2026-06-21T00:00:00Z", "2026-06-21T06:00:00Z", true, "2026-06-21T02:25:00Z"],
  ["2026-06-21T16:00:00Z", "2026-06-21T23:00:00Z", false, "2026-06-21T19:57:00Z"],
  ["2026-12-21T05:00:00Z", "2026-12-21T10:00:00Z", true, "2026-12-21T07:37:00Z"],
  ["2026-12-21T12:00:00Z", "2026-12-21T17:00:00Z", false, "2026-12-21T14:38:00Z"],
];
