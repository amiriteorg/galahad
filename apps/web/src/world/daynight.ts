import { direction, emptyMoon, emptySun, type MoonPosition, moonAt, type SunPosition, sunAt } from "./sun.ts";
import type { WeatherState } from "./weather.ts";

/*
 * Day and night in the SANDBOX, by the real sun over Denmark: the look follows
 * how high the sun stands (and whether it's climbing or sinking), not the hour,
 * so winter days are short and their low noon sun is one long, soft golden hour,
 * and midsummer nights never get quite dark. A low sun gives golden, peach and
 * lavender light; below the horizon come civil and nautical twilight, then deep
 * blue night under the stars and the moon (in its real phase). Weather lies on
 * top: clouds grey the sky, soften the light and the shadows, and lower the
 * exposure; broken cloud throws drifting shadows and breaks the sun into rays;
 * mist lies as a sheet on the ground when the sun is low. The air itself has a
 * light in it: it warms and glows towards the sun (the moon, deep in the night)
 * and cools away from it. Everything is written into a reusable object (the
 * render loop allocates nothing). Pure, so unit-tested.
 */

type Vec3 = [number, number, number];

export interface Sky {
  /** Unit vectors in the world frame (x east, y north, z up). */
  sun: Vec3;
  moon: Vec3;
  /** Where the directional light comes from: the sun by day; by night the moon, or the sky's glow when it's down. */
  lightDir: Vec3;
  /** The sun's height above the horizon, radians (negative at night). */
  sunElevation: number;
  /** 0 while the sun climbs (morning), 1 while it sinks (evening). */
  evening: number;
  /** The moon's lit fraction, and how far it's risen (0 below the horizon, 1 a few degrees up). */
  moonLit: number;
  moonUp: number;
  /** 0 by day, 1 in the dead of night. */
  night: number;
  /** 0..1 while the sun is low: warmth in the light, the haze and the clouds. */
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
  /** Tone-mapping exposure: a touch more at night, so the dark still reads; less under cloud. */
  exposure: number;
  /** Lamps and lit windows: off by day, on once the sun is low (sooner under cloud). */
  lamps: number;
  /** The weather on the sky (from applyWeather): cloud cover and mist, 0..1. */
  cloud: number;
  mist: number;
  /** How dark the sun's shadows are, 0..1 (soft under cloud). */
  shadow: number;
  /** The moon as it's drawn: at its real bearing, its height squeezed into the strip of sky a low camera sees (seenElevation). */
  moonSeen: Vec3;
  /** The sun's direction turned as the moon was moved, so the drawn moon keeps its real phase. */
  moonSun: Vec3;
  /** Where the light in the air comes from: the sun; deep in the night, the moon as drawn. */
  airDir: Vec3;
  /** The air towards that light (sRGB), and how far it warms broadly, glows right round the light, and cools away from it (each 0..1). */
  airLight: number;
  airWarm: number;
  airGlow: number;
  airCool: number;
  /** Clouds lit from below by a sun at the horizon, 0..1. */
  underlight: number;
  /** Shadows of clouds drifting over the land, 0..1 (broken cloud under a sun that's up; from applyWeather). */
  cloudShadow: number;
  /** Rays fanning from the sun, 0..1 (broken cloud or mist under a low sun; from applyWeather). */
  rays: number;
  /** A sheet of mist lying on the ground, 0..1 (mist under a low sun or at night; from applyWeather). */
  groundMist: number;
  /** Snow in the air, 0..1 (from applyWeather): a paler, closer sky. */
  snow: number;
}

/** The weather as the sky needs it: cloud, rain and mist, and snow if there is any (the world's weather state has all of this). */
export type SkyWeather = Pick<WeatherState, "cloud" | "rain" | "mist"> & Partial<WeatherState>;

/** The sun and moon as the sky needs them: heights and bearings (radians), which side of noon, the moon's phase. */
export interface Heavens {
  sunElevation: number;
  sunAzimuth: number;
  evening: number;
  moonElevation: number;
  moonAzimuth: number;
  moonLit: number;
}

interface Key {
  /** The sun's elevation, degrees. */
  e: number;
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

/*
 * The look at key heights of the sun; between them, colours blend in linear
 * light. After the references: periwinkle mornings, a pale lavender-blue noon
 * over lime meadows, a golden hour of warm peach light with lavender in the
 * shade and the sky, and deep blue nights lit by the moon. The fill (hemisphere)
 * is lavender from above and a warm green bounce from below, so shadows are
 * coloured, never grey. Mornings and evenings differ (cool pastels rising, warm
 * peach sinking), and a low noon (a Danish winter's) blends the two: warm,
 * bright and long.
 */
const NIGHT: Omit<Key, "e"> = { zenith: 0x080d24, horizon: 0x1c2958, sunGlow: 0x24346a, light: 0x9db0ff, lightIntensity: 0.34, hemiSky: 0x34488f, hemiGround: 0x141c34, hemiIntensity: 0.52, water: 0x1b4060, exposure: 1.0 };
const NOON: Omit<Key, "e"> = { zenith: 0x7fb0ee, horizon: 0xcfd6f4, sunGlow: 0xfff2dc, light: 0xfff1de, lightIntensity: 2.5, hemiSky: 0xcbd6f6, hemiGround: 0x8f9c5e, hemiIntensity: 1.0, water: 0x4fd2cc, exposure: 1 };

const MORNING: Key[] = [
  { e: -90, ...NIGHT },
  { e: -18, ...NIGHT },
  { e: -13.5, zenith: 0x0a1028, horizon: 0x22305e, sunGlow: 0x2a3a70, light: 0x9db0ff, lightIntensity: 0.32, hemiSky: 0x364a92, hemiGround: 0x141d36, hemiIntensity: 0.52, water: 0x1d4262, exposure: 1.0 },
  { e: -8.8, zenith: 0x2c3070, horizon: 0x7a6488, sunGlow: 0xb07a8c, light: 0xb8a8e8, lightIntensity: 0.6, hemiSky: 0x6a6cb8, hemiGround: 0x2e3048, hemiIntensity: 0.65, water: 0x3a5a80, exposure: 1.05 },
  { e: -3.9, zenith: 0x6e6cbc, horizon: 0xf4bcb6, sunGlow: 0xffb08c, light: 0xffb894, lightIntensity: 1.1, hemiSky: 0xb8b0e6, hemiGround: 0x6c6658, hemiIntensity: 0.85, water: 0x74b4cc, exposure: 1.1 },
  { e: 14.8, zenith: 0x92b6f0, horizon: 0xe8d4ea, sunGlow: 0xffe0c4, light: 0xffe2c4, lightIntensity: 2.1, hemiSky: 0xcdd0f4, hemiGround: 0x8c9460, hemiIntensity: 0.95, water: 0x5ccfd0, exposure: 1 },
  { e: 62, ...NOON },
  { e: 90, ...NOON },
];

const EVENING: Key[] = [
  { e: -90, ...NIGHT },
  { e: -17, zenith: 0x0c1230, horizon: 0x243262, sunGlow: 0x2e3e76, light: 0x9db0ff, lightIntensity: 0.34, hemiSky: 0x34488f, hemiGround: 0x141c34, hemiIntensity: 0.52, water: 0x1c4060, exposure: 1.0 },
  { e: -10.6, zenith: 0x262a66, horizon: 0x6c5a86, sunGlow: 0x9a6a84, light: 0xa8a6ee, lightIntensity: 0.5, hemiSky: 0x5a5eae, hemiGround: 0x2a2c46, hemiIntensity: 0.6, water: 0x30507a, exposure: 1.05 },
  { e: -4.9, zenith: 0x5250a0, horizon: 0xf0a49a, sunGlow: 0xff9670, light: 0xff9e70, lightIntensity: 0.95, hemiSky: 0x9a8cc8, hemiGround: 0x4e4650, hemiIntensity: 0.8, water: 0x4e74a0, exposure: 1.15 },
  { e: 8.9, zenith: 0x9a9ce6, horizon: 0xf6c6aa, sunGlow: 0xffae74, light: 0xffcc94, lightIntensity: 2.4, hemiSky: 0xd2c4f6, hemiGround: 0xa4ac62, hemiIntensity: 1.35, water: 0x7ccad2, exposure: 1.12 },
  // A low afternoon sun (all a Danish winter's day): still golden, brighter and softer.
  { e: 18, zenith: 0x8eaaec, horizon: 0xe8d0e6, sunGlow: 0xffd2a8, light: 0xffdcb0, lightIntensity: 2.4, hemiSky: 0xd0ccf2, hemiGround: 0x96a05e, hemiIntensity: 1.12, water: 0x62ccc8, exposure: 1.06 },
  { e: 35, zenith: 0x88afec, horizon: 0xdcd4ee, sunGlow: 0xffe4c4, light: 0xffe6c6, lightIntensity: 2.4, hemiSky: 0xd0d0f2, hemiGround: 0x919a5c, hemiIntensity: 0.98, water: 0x55cec8, exposure: 1 },
  { e: 62, ...NOON },
  { e: 90, ...NOON },
];

const toLinear = (c: number): number => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const toSrgb = (v: number): number => Math.round(255 * Math.max(0, Math.min(1, v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)));
/** sRGB channel → linear light, as a table (no pow in the render loop). */
const LINEAR = Float64Array.from({ length: 256 }, (_, i) => toLinear(i));

/** Blends two sRGB colours in linear light (as light mixes), back to sRGB. */
export function mixColor(a: number, b: number, t: number): number {
  const ch = (s: number) => toSrgb(LINEAR[(a >> s) & 255]! * (1 - t) + LINEAR[(b >> s) & 255]! * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** Relative luminance of an sRGB colour, 0..1. */
const luminance = (c: number): number => 0.2126 * LINEAR[(c >> 16) & 255]! + 0.7152 * LINEAR[(c >> 8) & 255]! + 0.0722 * LINEAR[c & 255]!;

/** A colour's grey (same luminance, in linear light) times `scale`, tinted a little lavender: the overcast version of it. */
function overcastOf(c: number, scale: number): number {
  const l = luminance(c) * scale;
  return (toSrgb(l * 0.97) << 16) | (toSrgb(l * 0.97) << 8) | toSrgb(Math.min(1, l * 1.06));
}

export const emptySky = (): Sky => ({
  sun: [0, 0, 1],
  moon: [0, 0, 1],
  lightDir: [0, 0, 1],
  sunElevation: 0,
  evening: 0.5,
  moonLit: 0,
  moonUp: 0,
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
  lamps: 0,
  cloud: 0,
  mist: 0,
  shadow: 1,
  moonSeen: [0, 0, 1],
  moonSun: [0, 0, 1],
  airDir: [0, 0, 1],
  airLight: 0,
  airWarm: 0,
  airGlow: 0,
  airCool: 0,
  underlight: 0,
  cloudShadow: 0,
  rays: 0,
  groundMist: 0,
  snow: 0,
});

export const emptyHeavens = (): Heavens => ({ sunElevation: 0, sunAzimuth: Math.PI, evening: 0.5, moonElevation: 0, moonAzimuth: 0, moonLit: 0 });

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;

const scratchSun = emptySun();
const scratchMoon = emptyMoon();

/** The real sun and moon over Copenhagen at a UTC instant (ms), as the sky needs them. */
export function heavensAt(ms: number, out: Heavens): Heavens {
  const s: SunPosition = sunAt(ms, scratchSun);
  const m: MoonPosition = moonAt(ms, s, scratchMoon);
  out.sunElevation = s.elevation;
  out.sunAzimuth = s.azimuth;
  // Which side of noon: the hour angle's sine, pushed towards 0 and 1 away from noon and midnight.
  out.evening = clamp01(0.5 + 0.75 * Math.sin(s.hourAngle));
  out.moonElevation = m.elevation;
  out.moonAzimuth = m.azimuth;
  out.moonLit = m.lit;
  return out;
}

/** The HUD's fixed looks, as places of the sun (and a moon for the night): they override the real sky. */
export const TIME_PRESETS = {
  dawn: { sunElevation: 1.5 * RAD, sunAzimuth: 100 * RAD, evening: 0, moonElevation: 24 * RAD, moonAzimuth: 250 * RAD, moonLit: 0.4 },
  day: { sunElevation: 48 * RAD, sunAzimuth: 170 * RAD, evening: 0.45, moonElevation: -30 * RAD, moonAzimuth: 20 * RAD, moonLit: 0.5 },
  golden: { sunElevation: 7 * RAD, sunAzimuth: 255 * RAD, evening: 1, moonElevation: -12 * RAD, moonAzimuth: 90 * RAD, moonLit: 0.6 },
  night: { sunElevation: -28 * RAD, sunAzimuth: 0, evening: 0.85, moonElevation: 38 * RAD, moonAzimuth: 165 * RAD, moonLit: 0.85 },
} as const satisfies Record<string, Heavens>;
export type TimePreset = keyof typeof TIME_PRESETS;

function sample(keys: Key[], e: number, field: Exclude<keyof Key, "e">, color: boolean): number {
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1]!.e <= e) i++;
  const a = keys[i]!;
  const b = keys[i + 1]!;
  const t = clamp01((e - a.e) / (b.e - a.e));
  return color ? mixColor(a[field], b[field], t) : a[field] + (b[field] - a[field]) * t;
}

/** Morning and evening keys at elevation `e`, blended by `evening`. */
function look(e: number, evening: number, field: Exclude<keyof Key, "e">, color: boolean): number {
  const m = sample(MORNING, e, field, color);
  const v = sample(EVENING, e, field, color);
  return color ? mixColor(m, v, evening) : m + (v - m) * evening;
}

/** The top of the strip of sky the camera sees over the far hills, and how fast a rising body climbs into it (radians). */
const SEEN_TOP = 8.6 * RAD;
const SEEN_RISE = 6 * RAD;

/**
 * The height the moon is drawn at for its real height (radians). The camera
 * looks at the horizon, over Galahad's shoulder, and sees only the lowest ten
 * degrees of the sky: a moon standing high in the south would never show. So its
 * height is squeezed into that strip: it rises as it really does, clears the
 * far hills quickly, and then climbs ever more slowly towards the strip's top.
 * Its bearing and its phase stay real. Below the horizon nothing changes.
 */
export function seenElevation(elevation: number): number {
  return elevation <= 0 ? elevation : SEEN_TOP * (1 - Math.exp(-elevation / SEEN_RISE));
}

/** Turns `v` by the rotation that takes unit vector `from` to unit vector `to` (Rodrigues), into `out`. */
function turned(v: Vec3, from: Vec3, to: Vec3, out: Vec3): void {
  let kx = from[1] * to[2] - from[2] * to[1];
  let ky = from[2] * to[0] - from[0] * to[2];
  let kz = from[0] * to[1] - from[1] * to[0];
  const sin = Math.hypot(kx, ky, kz);
  if (sin < 1e-9) {
    out[0] = v[0];
    out[1] = v[1];
    out[2] = v[2];
    return;
  }
  kx /= sin;
  ky /= sin;
  kz /= sin;
  const cos = from[0] * to[0] + from[1] * to[1] + from[2] * to[2];
  const kv = kx * v[0] + ky * v[1] + kz * v[2];
  out[0] = v[0] * cos + (ky * v[2] - kz * v[1]) * sin + kx * kv * (1 - cos);
  out[1] = v[1] * cos + (kz * v[0] - kx * v[2]) * sin + ky * kv * (1 - cos);
  out[2] = v[2] * cos + (kx * v[1] - ky * v[0]) * sin + kz * kv * (1 - cos);
}

/** A thundery sky: slate overhead, a paler bruise at the horizon. */
const STORM_ZENITH = 0x1c2233;
const STORM_HORIZON = 0x4a5468;

/** The moon's light in the air: a silver blue. */
const MOON_AIR = 0xb4c2ff;
/** The sun's height (degrees) at which the light in the air passes from the sun's afterglow to the moon. */
const AIR_SWITCH = -10.5;

/** A fallback for the night light when the moon is down: the sky's glow, from high in the south. */
const SKYGLOW: Vec3 = [0.18, -0.42, 0.89];

/** The sky for a sun and moon (the real ones, or a preset), written into `out`. */
export function skyFor(h: Heavens, out: Sky): Sky {
  const e = h.sunElevation * DEG;
  direction(h.sunElevation, h.sunAzimuth, out.sun);
  direction(h.moonElevation, h.moonAzimuth, out.moon);
  out.sunElevation = h.sunElevation;
  out.evening = h.evening;
  out.moonLit = h.moonLit;
  out.moonUp = smooth(-1.5, 4, h.moonElevation * DEG);
  // The moon as drawn: squeezed into the visible strip of sky, its phase kept by turning the sun with it.
  direction(seenElevation(h.moonElevation), h.moonAzimuth, out.moonSeen);
  turned(out.sun, out.moon, out.moonSeen, out.moonSun);

  out.zenith = look(e, h.evening, "zenith", true);
  out.horizon = look(e, h.evening, "horizon", true);
  out.sunGlow = look(e, h.evening, "sunGlow", true);
  out.light = look(e, h.evening, "light", true);
  out.hemiSky = look(e, h.evening, "hemiSky", true);
  out.hemiGround = look(e, h.evening, "hemiGround", true);
  out.water = look(e, h.evening, "water", true);
  out.exposure = look(e, h.evening, "exposure", false);
  out.hemiIntensity = look(e, h.evening, "hemiIntensity", false);
  let intensity = look(e, h.evening, "lightIntensity", false);

  const sinEl = Math.sin(h.sunElevation);
  out.night = clamp01((0.05 - sinEl) / 0.3);
  // Golden: from just below the horizon, strongest a few degrees up, fading by about 25° (so a winter noon stays warm).
  out.golden = smooth(-8, 2, e) * (1 - smooth(10, 26, e)) * (1 - out.night * 0.7);
  out.stars = clamp01((0.02 - sinEl) / 0.25);
  out.lightFromSun = sinEl > 0.02;
  // The light switches from the sun to the night's source as the sun sets: dimmed through the switch, so nothing pops.
  intensity *= Math.min(1, Math.abs(sinEl - 0.02) / 0.03);
  if (out.lightFromSun) {
    out.lightDir[0] = out.sun[0];
    out.lightDir[1] = out.sun[1];
    out.lightDir[2] = out.sun[2];
  } else {
    // The moon when it's up (never lower than ~17° for the light, or its shadows would cross the world), the sky's glow when not.
    const up = out.moonUp;
    const mz = Math.max(0.3, out.moon[2]);
    const mh = Math.sqrt(1 - mz * mz) / (Math.hypot(out.moon[0], out.moon[1]) || 1);
    out.lightDir[0] = SKYGLOW[0] * (1 - up) + out.moon[0] * mh * up;
    out.lightDir[1] = SKYGLOW[1] * (1 - up) + out.moon[1] * mh * up;
    out.lightDir[2] = SKYGLOW[2] * (1 - up) + mz * up;
    normalize(out.lightDir);
    // A bright moon lights the night a little more; a new moon (or none) leaves the sky's glow, still enough to read.
    intensity *= 0.78 + 0.4 * up * h.moonLit;
  }
  out.lightIntensity = intensity;
  // Lamps: on as the sun goes down, and glowing a little through golden hour (not at a low winter noon).
  out.lamps = Math.min(1, smooth(4, -4, e) + 0.35 * out.golden * Math.min(1, Math.abs(h.evening - 0.5) * 2.5));
  // The light in the air: the sun's (its afterglow, until it is well down), then the moon's.
  if (e > AIR_SWITCH) {
    const k = smooth(AIR_SWITCH, -7, e);
    const flat = Math.hypot(out.sun[0], out.sun[1]) || 1;
    // Never from below the horizon: a sun that has set glows from the horizon where it went down.
    const z = Math.max(0, out.sun[2]);
    const r = Math.sqrt(1 - z * z) / flat;
    out.airDir[0] = out.sun[0] * r;
    out.airDir[1] = out.sun[1] * r;
    out.airDir[2] = z;
    out.airLight = out.sunGlow;
    out.airWarm = (0.25 + 0.6 * out.golden) * k;
    out.airGlow = (0.1 + 0.55 * out.golden) * k;
    out.airCool = (0.1 + 0.45 * out.golden) * k;
  } else {
    const k = (1 - smooth(-13.5, AIR_SWITCH, e)) * out.moonUp;
    out.airDir[0] = out.moonSeen[0];
    out.airDir[1] = out.moonSeen[1];
    out.airDir[2] = out.moonSeen[2];
    out.airLight = mixColor(out.horizon, MOON_AIR, 0.5);
    out.airWarm = 0.4 * h.moonLit * k;
    out.airGlow = 0.55 * h.moonLit * k;
    out.airCool = 0.1 * k;
  }
  // Clouds catch the sun from below while it stands at the horizon.
  out.underlight = smooth(-7, -1.5, e) * (1 - smooth(4, 12, e));
  out.cloud = 0;
  out.mist = 0;
  out.shadow = 1;
  out.cloudShadow = 0;
  out.rays = 0;
  out.groundMist = 0;
  out.snow = 0;
  return out;
}

/**
 * The weather on the sky: cloud greys the colours (keeping their brightness),
 * hides the sun's warmth, softens the direct light and its shadows while the
 * sky's fill grows, lowers the exposure, and hides the stars; lamps come on
 * sooner under a dark sky.
 */
export function applyWeather(out: Sky, w: SkyWeather): Sky {
  const c = w.cloud;
  const e = out.sunElevation * DEG;
  const snow = w.snow ?? 0;
  out.cloud = c;
  out.mist = w.mist;
  out.snow = snow;
  // Mist lies as a sheet on the ground while the sun is low, and at night; by day it lifts into the air.
  out.groundMist = w.mist * (0.3 + 0.7 * (1 - smooth(3, 14, e)));
  // Rays: the sun broken by cloud with gaps in it, or by mist, and strongest when it's low.
  const broken = smooth(0.12, 0.32, c) * (1 - smooth(0.62, 0.88, c));
  out.rays = out.lightFromSun ? Math.max(broken, w.mist * 0.7 * (1 - c)) * (1 - 0.6 * smooth(12, 45, e)) * smooth(0, 3, e) : 0;
  out.cloudShadow = out.lightFromSun ? broken * smooth(2, 12, e) : 0;
  if (c <= 0.001 && w.rain <= 0.001 && snow <= 0.001) return out;
  const grey = c * 0.82;
  out.zenith = mixColor(out.zenith, overcastOf(out.zenith, 0.85 + 0.3 * out.night), grey);
  out.horizon = mixColor(out.horizon, overcastOf(out.horizon, 0.95), grey);
  out.sunGlow = mixColor(out.sunGlow, overcastOf(out.horizon, 1), grey);
  out.light = mixColor(out.light, overcastOf(out.light, 1), grey * 0.8);
  out.hemiSky = mixColor(out.hemiSky, overcastOf(out.hemiSky, 1.05), grey * 0.7);
  out.water = mixColor(out.water, overcastOf(out.water, 0.85), grey * 0.6);
  out.golden *= 1 - 0.75 * c;
  out.airLight = mixColor(out.airLight, overcastOf(out.horizon, 1), grey);
  out.airWarm *= 1 - 0.7 * c;
  out.airGlow *= 1 - 0.85 * c;
  out.airCool *= 1 - 0.6 * c;
  out.underlight *= 1 - smooth(0.6, 0.95, c);
  out.lightIntensity *= 1 - 0.72 * c;
  out.hemiIntensity *= 1 + 0.22 * c;
  // Falling snow is bright air: it lifts the exposure a little where rain lowers it.
  out.exposure *= 1 - 0.12 * c - 0.05 * w.rain + 0.06 * snow;
  // Thunder: the sky goes to slate, the light under it dim and cold (lightning is seen against it).
  const storm = w.storm ?? 0;
  if (storm > 0.001) {
    out.zenith = mixColor(out.zenith, STORM_ZENITH, 0.72 * storm);
    out.horizon = mixColor(out.horizon, STORM_HORIZON, 0.6 * storm);
    out.airLight = mixColor(out.airLight, STORM_HORIZON, 0.6 * storm);
    out.hemiSky = mixColor(out.hemiSky, STORM_HORIZON, 0.4 * storm);
    out.lightIntensity *= 1 - 0.35 * storm;
    out.hemiIntensity *= 1 - 0.3 * storm;
    out.exposure *= 1 - 0.1 * storm;
    out.lamps = Math.min(1, out.lamps + 0.5 * storm * (1 - out.lamps));
  }
  out.stars *= 1 - c;
  out.shadow = 1 - 0.75 * c;
  out.lamps = Math.min(1, out.lamps + 0.45 * c * smooth(30, 5, out.sunElevation * DEG) * (1 - out.lamps));
  return out;
}

function normalize(v: Vec3): void {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  v[0] /= n;
  v[1] /= n;
  v[2] /= n;
}
