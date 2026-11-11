import type { WorldWeather } from "@galahad/core/world";

/*
 * Denmark's weather, as the node reports it (DMI's model at Copenhagen), turned
 * into what the world eases towards: how clouded the sky is, how hard it rains
 * or snows, how thick the mist lies, how hard the wind blows, and whether there
 * is thunder. Continuous, so a grey drizzly afternoon looks like one rather than
 * like a preset. Pure, so unit-tested.
 */

export interface WeatherTarget {
  /** 0..1 */
  cloud: number;
  rain: number;
  mist: number;
  snow: number;
  /** Thunder, 0 or 1. */
  storm: number;
  /** The wind at 10 m, metres a second. */
  wind: number;
  /** The way it blows towards (atan2 convention: 0 east, π/2 north); left out when the report doesn't say. */
  windHeading?: number;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Rain for mm an hour: drizzle (0.1–0.5) light, moderate (2.5) about two thirds, heavy (8+) full. */
export function rainFor(mmPerHour: number): number {
  if (!(mmPerHour > 0.05)) return 0;
  return clamp01(0.25 + (0.75 * Math.log1p(mmPerHour)) / Math.log1p(8));
}

/** Snow for mm an hour (of water): flurries (0.1–0.5) light, steady snow (1) about two thirds, heavy (4+) full. */
export function snowFor(mmPerHour: number): number {
  if (!(mmPerHour > 0.02)) return 0;
  return clamp01(0.3 + (0.7 * Math.log1p(mmPerHour)) / Math.log1p(4));
}

/** Mist for visibility (metres): fog under 1 km, haze to 10 km, none beyond. */
export function mistFor(visibility: number | null): number {
  if (visibility === null) return 0;
  if (visibility < 1000) return 0.9;
  if (visibility < 2000) return 0.65;
  if (visibility < 5000) return 0.4;
  if (visibility < 10_000) return 0.2;
  return 0;
}

/**
 * Where a wind blows towards (atan2 convention: 0 east, π/2 north), from where a weather report
 * says it blows from (degrees clockwise from north): a westerly (270) blows towards the east (0).
 */
export function windHeadingFrom(fromDegrees: number): number {
  const towards = ((fromDegrees + 180) * Math.PI) / 180;
  return Math.atan2(Math.cos(towards), Math.sin(towards));
}

/** The wind as the world uses it: metres a second, never negative, a hurricane at most. */
export function windFor(metresPerSecond: number): number {
  return metresPerSecond > 0 ? Math.min(33, metresPerSecond) : 0;
}

export function liveTarget(w: WorldWeather): WeatherTarget {
  const snowing = w.kind === "snow";
  let rain = snowing ? 0 : rainFor(w.precipitation);
  if (w.kind === "drizzle") rain = Math.max(rain, 0.3);
  if (w.kind === "rain") rain = Math.max(rain, 0.5);
  if (w.kind === "storm") rain = Math.max(rain, 0.9);
  // Snow with nothing measured still snows, lightly.
  const snow = snowing ? Math.max(snowFor(w.precipitation), 0.35) : 0;
  let mist = Math.max(mistFor(w.visibility), w.humidity >= 0.97 ? 0.3 : 0);
  if (w.kind === "mist") mist = Math.max(mist, 0.85);
  // Falling snow hides the distance by itself: a little mist under it, not a fog.
  if (snowing) mist = Math.max(mist, 0.25);
  // Rain and snow only fall from a sky that has clouded over (the world won't start them under less).
  let cloud = clamp01(w.cloud);
  if (rain > 0 || snowing) cloud = Math.max(cloud, 0.85);
  if (w.kind === "storm") cloud = 1;
  const target: WeatherTarget = { cloud, rain, mist, snow, storm: w.kind === "storm" ? 1 : 0, wind: windFor(w.wind) };
  if (typeof w.windFrom === "number" && Number.isFinite(w.windFrom)) target.windHeading = windHeadingFrom(w.windFrom);
  return target;
}
