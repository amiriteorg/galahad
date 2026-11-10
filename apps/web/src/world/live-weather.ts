import type { WorldWeather } from "@galahad/core/world";

/*
 * Denmark's weather, as the node reports it (DMI's model at Copenhagen), turned
 * into what the world eases towards: how clouded the sky is, how hard it rains,
 * how thick the mist lies. Continuous, so a grey drizzly afternoon looks like one
 * rather than like a preset. Snow isn't drawn yet: it shows as a grey, misty sky.
 * Pure, so unit-tested.
 */

export interface WeatherTarget {
  /** 0..1 */
  cloud: number;
  rain: number;
  mist: number;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Rain for mm an hour: drizzle (0.1–0.5) light, moderate (2.5) about two thirds, heavy (8+) full. */
export function rainFor(mmPerHour: number): number {
  if (!(mmPerHour > 0.05)) return 0;
  return clamp01(0.25 + (0.75 * Math.log1p(mmPerHour)) / Math.log1p(8));
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

export function liveTarget(w: WorldWeather): WeatherTarget {
  let rain = w.kind === "snow" ? 0 : rainFor(w.precipitation);
  if (w.kind === "drizzle") rain = Math.max(rain, 0.3);
  if (w.kind === "rain") rain = Math.max(rain, 0.5);
  if (w.kind === "storm") rain = Math.max(rain, 0.9);
  let mist = Math.max(mistFor(w.visibility), w.humidity >= 0.97 ? 0.3 : 0);
  if (w.kind === "mist") mist = Math.max(mist, 0.85);
  if (w.kind === "snow") mist = Math.max(mist, 0.55);
  // Rain only falls from a sky that has clouded over (the world won't start it under less).
  let cloud = clamp01(w.cloud);
  if (rain > 0 || w.kind === "snow") cloud = Math.max(cloud, 0.85);
  if (w.kind === "storm") cloud = 1;
  return { cloud, rain, mist };
}
