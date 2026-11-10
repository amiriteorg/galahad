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
  /** The sky and the haze towards the sun: warm white by day, peach at golden hour. */
  sunGlow: number;
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
  /** Tone-mapping exposure: a touch more at night, so the dark still reads. */
  exposure: number;
}

interface Key {
  h: number;
  zenith: number;
  horizon: number;
  sunGlow: number;
  light: number;
  lightIntensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  water: number;
  exposure: number;
}

/**
 * The look at key hours; between them, colours blend in linear light. After the
 * references: periwinkle mornings, a pale lavender-blue noon over lime meadows,
 * a golden hour of warm peach light with lavender in the shade and the sky, and
 * deep blue nights lit by the moon. The fill (hemisphere) is lavender from above
 * and a warm green bounce from below, so shadows are coloured, never grey.
 */
const KEYS: Key[] = [
  { h: 0, zenith: 0x080d24, horizon: 0x1c2958, sunGlow: 0x24346a, light: 0x9db0ff, lightIntensity: 0.34, hemiSky: 0x34488f, hemiGround: 0x141c34, hemiIntensity: 0.52, water: 0x1b4060, exposure: 1.0 },
  { h: 4.6, zenith: 0x0a1028, horizon: 0x22305e, sunGlow: 0x2a3a70, light: 0x9db0ff, lightIntensity: 0.32, hemiSky: 0x364a92, hemiGround: 0x141d36, hemiIntensity: 0.52, water: 0x1d4262, exposure: 1.0 },
  { h: 5.1, zenith: 0x2c3070, horizon: 0x7a6488, sunGlow: 0xb07a8c, light: 0xb8a8e8, lightIntensity: 0.6, hemiSky: 0x6a6cb8, hemiGround: 0x2e3048, hemiIntensity: 0.65, water: 0x3a5a80, exposure: 1.05 },
  { h: 5.6, zenith: 0x6e6cbc, horizon: 0xf4bcb6, sunGlow: 0xffb08c, light: 0xffb894, lightIntensity: 1.1, hemiSky: 0xb8b0e6, hemiGround: 0x6c6658, hemiIntensity: 0.85, water: 0x74b4cc, exposure: 1.1 },
  { h: 7, zenith: 0x92b6f0, horizon: 0xe8d4ea, sunGlow: 0xffe0c4, light: 0xffe2c4, lightIntensity: 2.1, hemiSky: 0xcdd0f4, hemiGround: 0x8c9460, hemiIntensity: 0.95, water: 0x5ccfd0, exposure: 1 },
  { h: 12.5, zenith: 0x7fb0ee, horizon: 0xcfd6f4, sunGlow: 0xfff2dc, light: 0xfff1de, lightIntensity: 2.5, hemiSky: 0xcbd6f6, hemiGround: 0x8f9c5e, hemiIntensity: 1.0, water: 0x4fd2cc, exposure: 1 },
  { h: 16.5, zenith: 0x88afec, horizon: 0xdcd4ee, sunGlow: 0xffe4c4, light: 0xffe6c6, lightIntensity: 2.4, hemiSky: 0xd0d0f2, hemiGround: 0x919a5c, hemiIntensity: 0.98, water: 0x55cec8, exposure: 1 },
  { h: 18.4, zenith: 0x9a9ce6, horizon: 0xf6c6aa, sunGlow: 0xffae74, light: 0xffcc94, lightIntensity: 2.4, hemiSky: 0xd2c4f6, hemiGround: 0xa4ac62, hemiIntensity: 1.35, water: 0x7ccad2, exposure: 1.12 },
  { h: 19.5, zenith: 0x5250a0, horizon: 0xf0a49a, sunGlow: 0xff9670, light: 0xff9e70, lightIntensity: 0.95, hemiSky: 0x9a8cc8, hemiGround: 0x4e4650, hemiIntensity: 0.8, water: 0x4e74a0, exposure: 1.15 },
  { h: 20.1, zenith: 0x262a66, horizon: 0x6c5a86, sunGlow: 0x9a6a84, light: 0xa8a6ee, lightIntensity: 0.5, hemiSky: 0x5a5eae, hemiGround: 0x2a2c46, hemiIntensity: 0.6, water: 0x30507a, exposure: 1.05 },
  { h: 20.8, zenith: 0x0c1230, horizon: 0x243262, sunGlow: 0x2e3e76, light: 0x9db0ff, lightIntensity: 0.34, hemiSky: 0x34488f, hemiGround: 0x141c34, hemiIntensity: 0.52, water: 0x1c4060, exposure: 1.0 },
  { h: 24, zenith: 0x080d24, horizon: 0x1c2958, sunGlow: 0x24346a, light: 0x9db0ff, lightIntensity: 0.34, hemiSky: 0x34488f, hemiGround: 0x141c34, hemiIntensity: 0.52, water: 0x1b4060, exposure: 1.0 },
];

const toLinear = (c: number): number => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const toSrgb = (v: number): number => Math.round(255 * Math.max(0, Math.min(1, v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)));
/** sRGB channel → linear light, as a table (the render loop calls mixColor every few seconds; no pow there). */
const LINEAR = Float64Array.from({ length: 256 }, (_, i) => toLinear(i));

/** Blends two sRGB colours in linear light (as light mixes), back to sRGB. */
export function mixColor(a: number, b: number, t: number): number {
  const ch = (s: number) => toSrgb(LINEAR[(a >> s) & 255]! * (1 - t) + LINEAR[(b >> s) & 255]! * t);
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
  sunGlow: 0,
  light: 0,
  lightIntensity: 0,
  lightFromSun: true,
  hemiSky: 0,
  hemiGround: 0,
  hemiIntensity: 0,
  stars: 0,
  water: 0,
  exposure: 1,
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
  out.sunGlow = mixColor(a.sunGlow, b.sunGlow, t);
  out.exposure = a.exposure + (b.exposure - a.exposure) * t;
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
