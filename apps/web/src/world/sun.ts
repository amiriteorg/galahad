/*
 * The real sun and moon over Copenhagen. "Now" in the SANDBOX is the real
 * instant (UTC milliseconds), whatever the viewer's device clock zone says: the
 * sun's place comes from NOAA's solar-position equations (Meeus, good to well
 * under a minute of sunrise in these latitudes), the moon's from a low-precision
 * lunar theory (about a degree, plenty for a sky), and its phase from where the
 * two stand. The clock on the HUD is the time in Denmark, through Intl. Pure,
 * allocation-free (results are written into reused objects), unit-tested.
 */

/** Copenhagen, the city hall square. */
export const COPENHAGEN = { lat: 55.676, lon: 12.568 } as const;

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;

export interface SunPosition {
  /** Height above the horizon, radians (geometric: no refraction). */
  elevation: number;
  /** Compass bearing, radians: 0 north, π/2 east, π south. */
  azimuth: number;
  /** The local hour angle, radians: negative before solar noon, positive after (−π..π). */
  hourAngle: number;
  /** Declination and right ascension (radians), for the moon's phase. */
  declination: number;
  rightAscension: number;
}

export interface MoonPosition {
  elevation: number;
  azimuth: number;
  /** The lit fraction of the disc, 0 (new) to 1 (full). */
  lit: number;
  /** Where in its month: 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter. */
  phase: number;
}

export const emptySun = (): SunPosition => ({ elevation: 0, azimuth: 0, hourAngle: 0, declination: 0, rightAscension: 0 });
export const emptyMoon = (): MoonPosition => ({ elevation: 0, azimuth: 0, lit: 0, phase: 0 });

const wrap = (deg: number): number => ((deg % 360) + 360) % 360;

/** Bearing from north (radians) of a body at hour angle `h` and declination `dec`, seen from latitude `phi`. */
function bearing(h: number, dec: number, phi: number): number {
  // atan2 gives the azimuth from the south, westwards; from the north it's half a turn on.
  const a = Math.atan2(Math.sin(h), Math.cos(h) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)) + Math.PI;
  return a >= 2 * Math.PI ? a - 2 * Math.PI : a;
}

/** The sun at a UTC instant (milliseconds), seen from (lat, lon) in degrees: NOAA's equations. */
export function sunAt(ms: number, out: SunPosition, lat: number = COPENHAGEN.lat, lon: number = COPENHAGEN.lon): SunPosition {
  const jd = ms / DAY_MS + 2440587.5;
  const T = (jd - 2451545) / 36525;
  const L0 = wrap(280.46646 + T * (36000.76983 + T * 0.0003032));
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const Mr = M * RAD;
  const C = Math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * Mr) * (0.019993 - 0.000101 * T) + Math.sin(3 * Mr) * 0.000289;
  const omega = (125.04 - 1934.136 * T) * RAD;
  const lambda = (L0 + C - 0.00569 - 0.00478 * Math.sin(omega)) * RAD;
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = (eps0 + 0.00256 * Math.cos(omega)) * RAD;
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const y = Math.tan(eps / 2) ** 2;
  const L0r = L0 * RAD;
  // The equation of time, minutes.
  const eot =
    (4 / RAD) *
    (y * Math.sin(2 * L0r) - 2 * e * Math.sin(Mr) + 4 * e * y * Math.sin(Mr) * Math.cos(2 * L0r) - 0.5 * y * y * Math.sin(4 * L0r) - 1.25 * e * e * Math.sin(2 * Mr));
  const minutes = (((ms % DAY_MS) + DAY_MS) % DAY_MS) / 60_000;
  const solar = minutes + eot + 4 * lon;
  let h = solar / 4 - 180;
  h = ((((h + 180) % 360) + 360) % 360) - 180;
  const hr = h * RAD;
  const phi = lat * RAD;
  out.elevation = Math.asin(Math.max(-1, Math.min(1, Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(hr))));
  out.azimuth = bearing(hr, dec, phi);
  out.hourAngle = hr;
  out.declination = dec;
  out.rightAscension = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  return out;
}

/**
 * The moon at a UTC instant: its place from the main terms of its orbit (the
 * low-precision theory most sky apps use), and its phase from its elongation
 * from the sun (pass the sun at the same instant).
 */
export function moonAt(ms: number, sun: SunPosition, out: MoonPosition, lat: number = COPENHAGEN.lat, lon: number = COPENHAGEN.lon): MoonPosition {
  const d = ms / DAY_MS + 2440587.5 - 2451545;
  const L = (218.316 + 13.176396 * d) * RAD;
  const M = (134.963 + 13.064993 * d) * RAD;
  const F = (93.272 + 13.22935 * d) * RAD;
  const l = L + 6.289 * RAD * Math.sin(M);
  const b = 5.128 * RAD * Math.sin(F);
  const dist = 385001 - 20905 * Math.cos(M);
  const e = 23.4397 * RAD;
  const ra = Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
  const dec = Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
  const sidereal = (280.16 + 360.9856235 * d) * RAD + lon * RAD;
  const h = sidereal - ra;
  const phi = lat * RAD;
  out.elevation = Math.asin(Math.max(-1, Math.min(1, Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(h))));
  out.azimuth = bearing(h, dec, phi);
  // The phase: the elongation, then the phase angle at the moon (sun 149.6 million km off).
  const sd = sun.declination;
  const sra = sun.rightAscension;
  const elongation = Math.acos(Math.max(-1, Math.min(1, Math.sin(sd) * Math.sin(dec) + Math.cos(sd) * Math.cos(dec) * Math.cos(sra - ra))));
  const SUN_KM = 149_598_000;
  const inc = Math.atan2(SUN_KM * Math.sin(elongation), dist - SUN_KM * Math.cos(elongation));
  const angle = Math.atan2(Math.cos(sd) * Math.sin(sra - ra), Math.sin(sd) * Math.cos(dec) - Math.cos(sd) * Math.sin(dec) * Math.cos(sra - ra));
  out.lit = (1 + Math.cos(inc)) / 2;
  out.phase = 0.5 + (0.5 * inc * (angle < 0 ? -1 : 1)) / Math.PI;
  return out;
}

/** A unit vector in the world frame (x east, y north, z up) from an elevation and a compass bearing. */
export function direction(elevation: number, azimuth: number, out: [number, number, number]): [number, number, number] {
  const c = Math.cos(elevation);
  out[0] = c * Math.sin(azimuth);
  out[1] = c * Math.cos(azimuth);
  out[2] = Math.sin(elevation);
  return out;
}

const danishParts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Copenhagen", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** The time in Denmark at an instant, "14:32", whatever zone the device is in (summer time included). */
export function danishTime(ms: number): string {
  const parts = danishParts.formatToParts(ms);
  let hh = "00";
  let mm = "00";
  for (const p of parts) {
    if (p.type === "hour") hh = p.value;
    else if (p.type === "minute") mm = p.value;
  }
  return `${hh}:${mm}`;
}
