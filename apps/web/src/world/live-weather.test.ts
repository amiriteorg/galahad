import { describe, expect, test } from "bun:test";
import type { WorldWeather } from "@galahad/core/world";
import { liveTarget, mistFor, rainFor, snowFor, windFor } from "./live-weather.ts";

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
    expect(liveTarget(w())).toEqual({ cloud: 0.92, rain: 0, mist: 0, snow: 0, storm: 0, wind: 1.6 });
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

  test("fog is mist", () => {
    expect(liveTarget(w({ kind: "mist", visibility: 300 })).mist).toBe(0.9);
    expect(liveTarget(w({ kind: "mist", visibility: null })).mist).toBe(0.85);
  });

  test("snow grows with mm an hour (of water): flurries light, heavy snow full", () => {
    expect(snowFor(0)).toBe(0);
    expect(snowFor(Number.NaN)).toBe(0);
    expect(snowFor(0.2)).toBeGreaterThan(0.3);
    expect(snowFor(0.2)).toBeLessThan(0.5);
    expect(snowFor(1)).toBeGreaterThan(0.55);
    expect(snowFor(1)).toBeLessThan(0.75);
    expect(snowFor(4)).toBe(1);
    expect(snowFor(30)).toBe(1);
  });

  test("snow falls as snow, never as rain, from a clouded sky, with a little mist under it", () => {
    const t = liveTarget(w({ kind: "snow", precipitation: 2, cloud: 0.6 }));
    expect(t.rain).toBe(0);
    expect(t.snow).toBeGreaterThan(0.7);
    expect(t.cloud).toBe(0.85);
    expect(t.mist).toBe(0.25);
    expect(t.storm).toBe(0);
    // Snow with nothing measured still snows; thick fog in snow stays thick.
    expect(liveTarget(w({ kind: "snow", precipitation: 0 })).snow).toBe(0.35);
    expect(liveTarget(w({ kind: "snow", precipitation: 1, visibility: 600 })).mist).toBe(0.9);
    // Nothing else snows.
    for (const kind of ["clear", "cloudy", "overcast", "mist", "drizzle", "rain", "storm"] as const) expect(liveTarget(w({ kind, precipitation: 3 })).snow).toBe(0);
  });

  test("only thunder is a storm; the wind is carried through in metres a second, within reason", () => {
    expect(liveTarget(w({ kind: "storm", precipitation: 3 })).storm).toBe(1);
    expect(liveTarget(w({ kind: "rain", precipitation: 30 })).storm).toBe(0);
    expect(liveTarget(w({ wind: 9.4 })).wind).toBe(9.4);
    expect(windFor(0)).toBe(0);
    expect(windFor(-3)).toBe(0);
    expect(windFor(Number.NaN)).toBe(0);
    expect(windFor(80)).toBe(33);
  });

  test("everything stays within 0..1", () => {
    for (const kind of ["clear", "cloudy", "overcast", "mist", "drizzle", "rain", "snow", "storm"] as const) {
      for (const precipitation of [0, 0.2, 3, 50]) {
        const t = liveTarget(w({ kind, precipitation, visibility: 500, humidity: 1 }));
        const { wind, ...rest } = t;
        for (const v of Object.values(rest)) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
        expect(wind).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
