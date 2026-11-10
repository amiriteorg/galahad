/*
 * Day and night in the SANDBOX, by the viewer's own clock: the sun rises in the
 * east, crosses the south and sets in the west; mornings are soft pastels, the
 * afternoon ends in golden hour, and nights are properly dark, with stars and a
 * moon. Everything here is a function of the hour, written into a reusable object
 * (the render loop allocates nothing). Pure, so unit-tested.
 */

export interface Sky {
  hours: number;
  /** Unit vectors in the world frame (x east, y north, z up). */
  sun: [number, number, number];
  moon: [number, number, number];
  /** The sun's height above the horizon, radians (negative at night). */
  sunElevation: number;
  /** 0 by day, 1 in the dead of night. */
  night: number;
  /** 0..1 around sunrise and sunset: warmth, and fireflies at dusk. */
  golden: number;
  zenith: number;
  horizon: number;
  /** The directional light: the sun by day, the moon by night. */
  light: number;
  lightIntensity: number;
  lightFromSun: boolean;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  /** 0..1: how bright the stars are. */
  stars: number;
  water: number;
}

interface Key {
  h: number;
  zenith: number;
  horizon: number;
  light: number;
  lightIntensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  water: number;
}

/** The look at key hours; between them, colours blend. */
/** Soft blue to lavender by day, peach and gold at the ends of it, deep blue at night; turquoise water. */
const KEYS: Key[] = [
  { h: 0, zenith: 0x070b1d, horizon: 0x16204a, light: 0x8098ff, lightIntensity: 0.7, hemiSky: 0x2c44a0, hemiGround: 0x101a40, hemiIntensity: 0.75, water: 0x173a52 },
  { h: 4.6, zenith: 0x090e22, horizon: 0x1b2552, light: 0x8098ff, lightIntensity: 0.65, hemiSky: 0x2e46a2, hemiGround: 0x111b42, hemiIntensity: 0.75, water: 0x193d55 },
  { h: 5.6, zenith: 0x7068b8, horizon: 0xf4b9b0, light: 0xffb48c, lightIntensity: 1, hemiSky: 0xbcaee0, hemiGround: 0x6d5a62, hemiIntensity: 0.85, water: 0x6fb2c4 },
  { h: 7, zenith: 0x96bdf0, horizon: 0xf2d9e8, light: 0xffe4c4, lightIntensity: 2.3, hemiSky: 0xdcdcf6, hemiGround: 0x8f8466, hemiIntensity: 1.05, water: 0x52cfc6 },
  { h: 12.5, zenith: 0x8bb8ef, horizon: 0xe4dbf3, light: 0xfff4e2, lightIntensity: 2.9, hemiSky: 0xe0e4f8, hemiGround: 0x958a6a, hemiIntensity: 1.15, water: 0x48d0c8 },
  { h: 16.5, zenith: 0x92b8ee, horizon: 0xeedbe6, light: 0xffe9cc, lightIntensity: 2.7, hemiSky: 0xe2dcf2, hemiGround: 0x978766, hemiIntensity: 1.1, water: 0x50ccc4 },
  { h: 18.4, zenith: 0xa49be0, horizon: 0xffc796, light: 0xffaf62, lightIntensity: 2.3, hemiSky: 0xe0c8e6, hemiGround: 0x93705a, hemiIntensity: 1, water: 0x7cc2c8 },
  { h: 19.5, zenith: 0x4a4488, horizon: 0xe8978e, light: 0xff8d5c, lightIntensity: 0.9, hemiSky: 0x9284b8, hemiGround: 0x4c3c46, hemiIntensity: 0.8, water: 0x4a6f9a },
  { h: 20.8, zenith: 0x0b1028, horizon: 0x1e2a58, light: 0x8098ff, lightIntensity: 0.7, hemiSky: 0x2c44a0, hemiGround: 0x101a40, hemiIntensity: 0.75, water: 0x183b54 },
  { h: 24, zenith: 0x070b1d, horizon: 0x16204a, light: 0x8098ff, lightIntensity: 0.7, hemiSky: 0x2c44a0, hemiGround: 0x101a40, hemiIntensity: 0.75, water: 0x173a52 },
];

/** Blends two sRGB colours channel by channel. */
export function mixColor(a: number, b: number, t: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

const SUNRISE = 6;
const SUNSET = 19;
const MAX_ELEVATION = (62 * Math.PI) / 180;

export const emptySky = (): Sky => ({
  hours: 0,
  sun: [0, 0, 1],
  moon: [0, 0, 1],
  sunElevation: 0,
  night: 0,
  golden: 0,
  zenith: 0,
  horizon: 0,
  light: 0,
  lightIntensity: 0,
  lightFromSun: true,
  hemiSky: 0,
  hemiGround: 0,
  hemiIntensity: 0,
  stars: 0,
  water: 0,
});

/** The sky at an hour of the day (0–24, local time), written into `out`. */
export function skyAt(hours: number, out: Sky): Sky {
  const h = ((hours % 24) + 24) % 24;
  out.hours = h;
  // The sun: up from sunrise to sunset, highest at midday, east → south → west.
  const day = (h - SUNRISE) / (SUNSET - SUNRISE);
  const elevation = day >= 0 && day <= 1 ? Math.sin(day * Math.PI) * MAX_ELEVATION : -Math.sin(((h < SUNRISE ? h + 24 : h) - SUNSET) / (24 - (SUNSET - SUNRISE)) * Math.PI) * 0.6;
  const azimuth = -Math.PI * Math.min(1, Math.max(0, day)) - (day > 1 ? (day - 1) * 0.5 : day < 0 ? day * 0.5 : 0);
  const ce = Math.cos(elevation);
  out.sun[0] = ce * Math.cos(azimuth);
  out.sun[1] = ce * Math.sin(azimuth) - 0.25 * ce;
  out.sun[2] = Math.sin(elevation);
  normalize(out.sun);
  out.sunElevation = elevation;
  // The moon rides opposite, high enough to light the night.
  out.moon[0] = -out.sun[0];
  out.moon[1] = -out.sun[1] * 0.6 - 0.3;
  out.moon[2] = Math.max(0.35, -out.sun[2]);
  normalize(out.moon);

  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1]!.h <= h) i++;
  const a = KEYS[i]!;
  const b = KEYS[i + 1]!;
  const t = (h - a.h) / (b.h - a.h);
  out.zenith = mixColor(a.zenith, b.zenith, t);
  out.horizon = mixColor(a.horizon, b.horizon, t);
  out.light = mixColor(a.light, b.light, t);
  out.lightIntensity = a.lightIntensity + (b.lightIntensity - a.lightIntensity) * t;
  out.hemiSky = mixColor(a.hemiSky, b.hemiSky, t);
  out.hemiGround = mixColor(a.hemiGround, b.hemiGround, t);
  out.hemiIntensity = a.hemiIntensity + (b.hemiIntensity - a.hemiIntensity) * t;
  out.water = mixColor(a.water, b.water, t);

  const sinEl = Math.sin(elevation);
  out.night = clamp01((0.05 - sinEl) / 0.3);
  out.golden = clamp01(1 - Math.abs(sinEl - 0.08) / 0.22) * (1 - out.night * 0.7);
  out.stars = clamp01((0.02 - sinEl) / 0.25);
  out.lightFromSun = sinEl > 0.02;
  return out;
}

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

function normalize(v: [number, number, number]): void {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  v[0] /= n;
  v[1] /= n;
  v[2] /= n;
}

/** The viewer's local hour, with minutes. */
export const localHours = (date: Date): number => date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;

/** The HUD's "time of day" choices: the clock, or a fixed hour to look at. */
export const TIME_PRESETS = { dawn: 6.2, day: 12.5, golden: 18.5, night: 23 } as const;
export type TimePreset = keyof typeof TIME_PRESETS;
