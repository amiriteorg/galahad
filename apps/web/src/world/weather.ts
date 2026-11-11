/*
 * The SANDBOX's weather: a small state (clear, overcast, mist, drizzle, rain,
 * snow, storm) that the world eases towards, never jumps to. Clouds gather
 * before the rain or the snow starts and it stops before they clear; the ground
 * gets wet while it rains and dries slowly after; snow settles while it falls
 * and thaws after (into wet ground); mist lies at dawn, after rain and over
 * thawing snow, thin by day; the wind eases too, and a storm brings thunder.
 * Nothing here fetches anything: the HUD sets the kind, or the real weather in
 * Denmark aims it (live-weather.ts). Pure, so unit-tested.
 */

import { BREEZE, WIND_HEADING } from "./place.ts";

export type WeatherKind = "clear" | "overcast" | "mist" | "drizzle" | "rain" | "snow" | "storm";

export const WEATHER_KINDS: readonly WeatherKind[] = ["clear", "overcast", "mist", "drizzle", "rain", "snow", "storm"];

/** Where the weather stands: every value 0..1 except the wind. */
export interface WeatherState {
  /** Cloud cover: a greyer, softer sky, weaker sun and shadows. */
  cloud: number;
  /** Rain: streaks, ripples, splashes. */
  rain: number;
  /** Mist: low, height-bound fog in hollows and over water (the weather's, the dawn's and the rain's). */
  mist: number;
  /** How wet the ground, rocks and roofs are: darker, with a sheen. */
  wetness: number;
  /** Snow falling. */
  snow: number;
  /** Snow lying on the ground, the roofs and the trees. */
  snowCover: number;
  /** Thunder: lightning strikes while it's up. */
  storm: number;
  /** The wind, metres a second: it slants the rain, drives the snow, and bends what grows. */
  wind: number;
  /** The way it blows towards (atan2 convention: 0 east, π/2 north). */
  windHeading: number;
}

/** What the weather eases towards. Snow, storm and wind may be left out (none, none, a light breeze). */
export interface WeatherAim {
  cloud: number;
  rain: number;
  mist: number;
  snow?: number;
  storm?: number;
  /** Metres a second. */
  wind?: number;
  /** The way it blows towards (atan2 convention); Denmark's prevailing west-south-westerly when left out. */
  windHeading?: number;
}

type Target = Required<WeatherAim>;

/** A light breeze (place.ts): what the wind is when nothing says otherwise, the same the windsocks show. */
export { BREEZE };

const TARGETS: Record<WeatherKind, Target> = {
  clear: { cloud: 0, rain: 0, mist: 0, snow: 0, storm: 0, wind: BREEZE, windHeading: WIND_HEADING },
  overcast: { cloud: 0.8, rain: 0, mist: 0.1, snow: 0, storm: 0, wind: 3.5, windHeading: WIND_HEADING },
  mist: { cloud: 0.35, rain: 0, mist: 0.75, snow: 0, storm: 0, wind: 0.6, windHeading: WIND_HEADING },
  drizzle: { cloud: 0.72, rain: 0.35, mist: 0.3, snow: 0, storm: 0, wind: 3, windHeading: WIND_HEADING },
  rain: { cloud: 0.92, rain: 1, mist: 0.22, snow: 0, storm: 0, wind: 6, windHeading: WIND_HEADING },
  snow: { cloud: 0.88, rain: 0, mist: 0.3, snow: 0.8, storm: 0, wind: 2, windHeading: WIND_HEADING },
  storm: { cloud: 1, rain: 1, mist: 0.2, snow: 0, storm: 1, wind: 14, windHeading: WIND_HEADING },
};

/** Seconds to cover about two thirds of the way (an exponential ease). */
const CLOUD_IN = 9;
const CLOUD_OUT = 16;
const RAIN_IN = 5;
const RAIN_OUT = 3.5;
const SNOW_IN = 6;
const SNOW_OUT = 5;
const STORM = 6;
const WIND = 8;
const MIST = 10;
/** Full rain soaks the ground in about this many seconds; it dries over a few minutes (faster in sunshine). */
const SOAK_S = 25;
const DRY_S = 240;
/** Heavy snow covers the ground in about this many seconds; it thaws over a few minutes (faster in sunshine, faster still in rain). */
const SETTLE_S = 40;
const THAW_S = 200;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const ease = (from: number, to: number, dt: number, tau: number): number => to + (from - to) * Math.exp(-dt / tau);

/**
 * The mist the day itself brings, with clear skies: a bank at dawn (strongest
 * just after sunrise, burnt off as the sun climbs), a little in the night, and
 * none by day (so a clear day doesn't pay for mist at all). `elevationDeg` is the sun's height; `evening` is 0 in the
 * morning, 1 in the evening.
 */
export function naturalMist(elevationDeg: number, evening: number): number {
  const morning = clamp01(1 - evening * 1.4);
  const dawn = smooth(-9, 0, elevationDeg) * (1 - smooth(3, 13, elevationDeg)) * morning;
  const night = (1 - smooth(-6, 2, elevationDeg)) * 0.12;
  return Math.max(dawn * 0.52, night);
}

export class Weather {
  kind: WeatherKind;
  readonly state: WeatherState = { cloud: 0, rain: 0, mist: 0, wetness: 0, snow: 0, snowCover: 0, storm: 0, wind: BREEZE, windHeading: WIND_HEADING };

  constructor(kind: WeatherKind = "clear") {
    this.kind = kind;
    this.snap(0, 0.5);
  }

  /** What the weather should become (it eases there). */
  set(kind: WeatherKind): void {
    this.kind = kind;
    this.custom = null;
  }

  /** What the weather should become, as cloud, rain, mist, snow, thunder and wind of its own (the real weather in Denmark); it eases there. */
  aim(target: WeatherAim): void {
    const wind = target.wind ?? BREEZE;
    this.custom = {
      cloud: clamp01(target.cloud),
      rain: clamp01(target.rain),
      mist: clamp01(target.mist),
      snow: clamp01(target.snow ?? 0),
      storm: clamp01(target.storm ?? 0),
      wind: wind >= 0 ? Math.min(40, wind) : BREEZE,
      windHeading: Number.isFinite(target.windHeading) ? target.windHeading! : WIND_HEADING,
    };
  }

  private custom: Target | null = null;

  private target(): Target {
    return this.custom ?? TARGETS[this.kind];
  }

  /** Straight to the kind's look (first sight): no easing, wet ground if it rains, lying snow if it snows. */
  snap(elevationDeg: number, evening: number): WeatherState {
    const t = this.target();
    const s = this.state;
    s.cloud = t.cloud;
    s.rain = t.rain;
    s.snow = t.snow;
    s.storm = t.storm;
    s.wind = t.wind;
    s.windHeading = t.windHeading;
    s.wetness = t.rain > 0 ? Math.min(1, 0.5 + t.rain * 0.5) : 0;
    s.snowCover = t.snow > 0 ? Math.min(1, 0.55 + t.snow * 0.5) : 0;
    s.mist = this.mistTarget(t, elevationDeg, evening);
    return s;
  }

  /** The mist straight to what this sun and weather bring (the time of day jumped: a preset). */
  settleMist(elevationDeg: number, evening: number): void {
    this.state.mist = this.mistTarget(this.target(), elevationDeg, evening);
  }

  /** Moves the weather on by `dt` seconds, given the sun (degrees above the horizon, and morning 0 → evening 1). */
  step(dt: number, elevationDeg: number, evening: number): WeatherState {
    const s = this.state;
    const t = this.target();
    s.cloud = ease(s.cloud, t.cloud, dt, t.cloud > s.cloud ? CLOUD_IN : CLOUD_OUT);
    // Rain and snow only fall from a sky that has clouded over.
    const clouded = smooth(0.45, 0.8, s.cloud);
    const rainTarget = t.rain * clouded;
    s.rain = ease(s.rain, rainTarget, dt, rainTarget > s.rain ? RAIN_IN : RAIN_OUT);
    if (s.rain < 1e-3 && rainTarget === 0) s.rain = 0;
    const snowTarget = t.snow * clouded;
    s.snow = ease(s.snow, snowTarget, dt, snowTarget > s.snow ? SNOW_IN : SNOW_OUT);
    if (s.snow < 1e-3 && snowTarget === 0) s.snow = 0;
    // Thunder needs the sky black.
    const stormTarget = t.storm * smooth(0.7, 0.95, s.cloud);
    s.storm = ease(s.storm, stormTarget, dt, STORM);
    if (s.storm < 1e-3 && stormTarget === 0) s.storm = 0;
    s.wind = ease(s.wind, t.wind, dt, WIND);
    if (Math.abs(s.wind - t.wind) < 1e-3) s.wind = t.wind;
    // The wind veers the short way round, as slowly as it strengthens.
    const turn = Math.atan2(Math.sin(t.windHeading - s.windHeading), Math.cos(t.windHeading - s.windHeading));
    s.windHeading = Math.abs(turn) < 1e-3 ? t.windHeading : s.windHeading + turn * (1 - Math.exp(-dt / WIND));

    const sun = smooth(0, 25, elevationDeg) * (1 - s.cloud);
    // Snow settles while it falls; after, it thaws: faster under a bright sun, faster still when rain washes it away.
    if (s.snow > 0.02) s.snowCover = Math.min(1, s.snowCover + (dt / SETTLE_S) * (0.3 + s.snow));
    else if (s.snowCover > 0) s.snowCover = Math.max(0, s.snowCover - (dt / THAW_S) * (0.5 + 1.5 * sun + 3 * s.rain));
    // Wet while it rains; dry after, faster under a bright sun than an overcast one. Thawing snow keeps the ground wet.
    if (s.rain > 0.02) s.wetness = Math.min(1, s.wetness + (dt / SOAK_S) * (0.3 + s.rain));
    else s.wetness = Math.max(0, s.wetness - (dt / DRY_S) * (0.5 + 1.5 * sun));
    if (s.snow <= 0.02 && s.snowCover > 0) s.wetness = Math.max(s.wetness, Math.min(0.75, s.snowCover * 1.5));
    s.mist = ease(s.mist, this.mistTarget(t, elevationDeg, evening), dt, MIST);
    return s;
  }

  private mistTarget(t: Target, elevationDeg: number, evening: number): number {
    // After rain the wet ground steams: mist while it's wet and no longer raining (nor snowing).
    const wet = this.state.wetness;
    const afterRain = wet * wet * (1 - smooth(0.05, 0.4, this.state.rain)) * (1 - smooth(0.05, 0.4, this.state.snow)) * 0.45;
    return clamp01(Math.max(t.mist, naturalMist(elevationDeg, evening) * (1 - t.cloud * 0.4), afterRain));
  }
}
