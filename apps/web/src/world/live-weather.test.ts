import { describe, expect, test } from "bun:test";
import type { WorldWeather } from "@galahad/core/world";
import { liveTarget, mistFor, rainFor } from "./live-weather.ts";

const w = (over: Partial<WorldWeather> = {}): WorldWeather => ({
  kind: "overcast",
  cloud: 0.92,
  precipitation: 0,
  visibility: 20760,
  wind: 1.6,
  temperature: 6.8,
  humidity: 0.84,
  observed: 0,
  place: "Copenhagen",
  source: "DMI HARMONIE via Open-Meteo",
  ...over,
});

describe("Denmark's weather, as the world shows it", () => {
  test("rain grows with mm an hour: none when dry, light for drizzle, full when heavy", () => {
    expect(rainFor(0)).toBe(0);
    expect(rainFor(0.04)).toBe(0);
    expect(rainFor(0.3)).toBeGreaterThan(0.25);
    expect(rainFor(0.3)).toBeLessThan(0.45);
    expect(rainFor(2.5)).toBeGreaterThan(0.55);
    expect(rainFor(2.5)).toBeLessThan(0.8);
    expect(rainFor(8)).toBe(1);
    expect(rainFor(40)).toBe(1);
    expect(rainFor(Number.NaN)).toBe(0);
  });

  test("mist thickens as visibility drops", () => {
    expect(mistFor(null)).toBe(0);
    expect(mistFor(20_000)).toBe(0);
    expect(mistFor(8000)).toBeLessThan(mistFor(3000));
    expect(mistFor(3000)).toBeLessThan(mistFor(1500));
    expect(mistFor(400)).toBe(0.9);
  });

  test("an overcast evening in Copenhagen: grey and dry", () => {
    expect(liveTarget(w())).toEqual({ cloud: 0.92, rain: 0, mist: 0 });
  });

  test("rain needs a clouded sky, so rain under thin cloud still clouds over", () => {
    const t = liveTarget(w({ kind: "rain", cloud: 0.4, precipitation: 1.2 }));
    expect(t.cloud).toBeGreaterThanOrEqual(0.85);
    expect(t.rain).toBeGreaterThanOrEqual(0.5);
  });

  test("drizzle with nothing measured still drizzles; thunder pours under a black sky", () => {
    expect(liveTarget(w({ kind: "drizzle", precipitation: 0 })).rain).toBe(0.3);
    expect(liveTarget(w({ kind: "storm", precipitation: 3 }))).toMatchObject({ cloud: 1 });
    expect(liveTarget(w({ kind: "storm", precipitation: 3 })).rain).toBeGreaterThanOrEqual(0.9);
  });

  test("fog is mist; snow (not drawn yet) is a grey, misty sky with no rain", () => {
    expect(liveTarget(w({ kind: "mist", visibility: 300 })).mist).toBe(0.9);
    expect(liveTarget(w({ kind: "mist", visibility: null })).mist).toBe(0.85);
    expect(liveTarget(w({ kind: "snow", precipitation: 2, cloud: 0.6 }))).toEqual({ cloud: 0.85, rain: 0, mist: 0.55 });
  });

  test("everything stays within 0..1", () => {
    for (const kind of ["clear", "cloudy", "overcast", "mist", "drizzle", "rain", "snow", "storm"] as const) {
      for (const precipitation of [0, 0.2, 3, 50]) {
        const t = liveTarget(w({ kind, precipitation, visibility: 500, humidity: 1 }));
        for (const v of Object.values(t)) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});
