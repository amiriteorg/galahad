import { describe, expect, test } from "bun:test";
import { applyWeather, emptySky, type Heavens, seenElevation, skyFor, TIME_PRESETS } from "./daynight.ts";

/*
 * The sky's newer parts: where the moon is drawn, the light in the air, and
 * what the weather adds (rays, cloud shadows, ground mist, a thundery sky).
 */

const RAD = Math.PI / 180;
const sky = emptySky();
const dot = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const lum = (c: number) => ((c >> 16) & 255) + ((c >> 8) & 255) + (c & 255);
const heavens = (sunElevation: number, over: Partial<Heavens> = {}): Heavens => ({
  sunElevation: sunElevation * RAD,
  sunAzimuth: 200 * RAD,
  evening: 0.8,
  moonElevation: 35 * RAD,
  moonAzimuth: 140 * RAD,
  moonLit: 0.9,
  ...over,
});

describe("where the moon is drawn", () => {
  test("its height is squeezed into the strip of sky a low camera sees: always there when it's up, never above the strip", () => {
    expect(seenElevation(-5 * RAD)).toBe(-5 * RAD);
    expect(seenElevation(0)).toBe(0);
    let last = 0;
    for (let e = 0.5; e <= 90; e += 0.5) {
      const seen = seenElevation(e * RAD) / RAD;
      expect(seen).toBeGreaterThan(last);
      expect(seen).toBeLessThan(8.7);
      last = seen;
    }
    // It clears the far hills (about 5°) soon after it rises, and a moon high in the south stands near the strip's top.
    expect(seenElevation(6 * RAD) / RAD).toBeGreaterThan(5);
    expect(seenElevation(38 * RAD) / RAD).toBeGreaterThan(8);
    expect(seenElevation(60 * RAD) / RAD).toBeGreaterThan(8.5);
  });

  test("it keeps its real bearing, and its real phase (the sun is turned with it)", () => {
    for (const [moonElevation, moonAzimuth, sunElevation] of [[38, 165, -28], [60, 200, -15], [12, 90, -40], [25, 250, 30]] as const) {
      skyFor(heavens(sunElevation, { moonElevation: moonElevation * RAD, moonAzimuth: moonAzimuth * RAD }), sky);
      // The same bearing: the same direction along the ground.
      const real = Math.atan2(sky.moon[0], sky.moon[1]);
      const seen = Math.atan2(sky.moonSeen[0], sky.moonSeen[1]);
      expect(seen).toBeCloseTo(real, 9);
      expect(Math.asin(sky.moonSeen[2]) / RAD).toBeLessThan(8.7);
      expect(Math.hypot(...sky.moonSeen)).toBeCloseTo(1, 9);
      expect(Math.hypot(...sky.moonSun)).toBeCloseTo(1, 9);
      // The same angle between moon and sun, so the same lit share of its face.
      expect(dot(sky.moonSeen, sky.moonSun)).toBeCloseTo(dot(sky.moon, sky.sun), 9);
    }
    // Below the horizon it's where it is.
    skyFor(heavens(-30, { moonElevation: -20 * RAD }), sky);
    expect(sky.moonSeen[2]).toBeCloseTo(sky.moon[2], 12);
    expect(sky.moonUp).toBe(0);
  });
});

describe("the light in the air", () => {
  test("by day it comes from the sun, and glows most at golden hour", () => {
    skyFor(TIME_PRESETS.day, sky);
    const day = { warm: sky.airWarm, glow: sky.airGlow, cool: sky.airCool };
    expect(dot(sky.airDir, sky.sun)).toBeCloseTo(1, 6);
    expect(day.warm).toBeGreaterThan(0.2);
    skyFor(TIME_PRESETS.golden, sky);
    expect(dot(sky.airDir, sky.sun)).toBeCloseTo(1, 6);
    expect(sky.airWarm).toBeGreaterThan(day.warm * 2);
    expect(sky.airGlow).toBeGreaterThan(day.glow * 3);
    expect(sky.airCool).toBeGreaterThan(day.cool * 2);
    expect(sky.airLight).toBe(sky.sunGlow);
  });

  test("a sun that has set glows from the horizon where it went down, never from under the ground", () => {
    skyFor(heavens(-4), sky);
    expect(sky.airDir[2]).toBe(0);
    expect(Math.hypot(...sky.airDir)).toBeCloseTo(1, 9);
    expect(Math.atan2(sky.airDir[0], sky.airDir[1])).toBeCloseTo(Math.atan2(sky.sun[0], sky.sun[1]), 9);
    expect(sky.airWarm).toBeGreaterThan(0.2);
  });

  test("deep in the night it comes from the moon as drawn, by how full it is; with no moon the air is dark", () => {
    skyFor(heavens(-30), sky);
    expect(dot(sky.airDir, sky.moonSeen)).toBeCloseTo(1, 9);
    const full = sky.airGlow;
    expect(full).toBeGreaterThan(0.3);
    skyFor(heavens(-30, { moonLit: 0.1 }), sky);
    expect(sky.airGlow).toBeLessThan(full / 4);
    skyFor(heavens(-30, { moonElevation: -10 * RAD }), sky);
    expect(sky.airGlow).toBe(0);
    expect(sky.airWarm).toBe(0);
  });

  test("it passes from the sun to the moon through nothing, so no glow ever jumps across the sky", () => {
    let last = Number.NaN;
    for (let e = -6; e >= -16; e -= 0.05) {
      skyFor(heavens(e), sky);
      const strength = sky.airWarm + sky.airGlow + sky.airCool;
      if (!Number.isNaN(last)) expect(Math.abs(strength - last)).toBeLessThan(0.05);
      last = strength;
    }
    skyFor(heavens(-10.5), sky);
    expect(sky.airWarm + sky.airGlow).toBeLessThan(0.01);
  });
});

describe("the weather on the sky", () => {
  const under = (preset: Heavens, w: { cloud: number; rain: number; mist: number; snow?: number; storm?: number }) => applyWeather(skyFor(preset, sky), w);

  test("rays fan from the sun through broken cloud or mist, most when it's low; never from a clear, a covered or a night sky", () => {
    expect(under(TIME_PRESETS.golden, { cloud: 0, rain: 0, mist: 0 }).rays).toBe(0);
    const broken = under(TIME_PRESETS.golden, { cloud: 0.45, rain: 0, mist: 0 }).rays;
    expect(broken).toBeGreaterThan(0.6);
    expect(under(TIME_PRESETS.day, { cloud: 0.45, rain: 0, mist: 0 }).rays).toBeLessThan(broken);
    expect(under(TIME_PRESETS.day, { cloud: 0.45, rain: 0, mist: 0 }).rays).toBeGreaterThan(0.2);
    expect(under(TIME_PRESETS.golden, { cloud: 0.2, rain: 0, mist: 0.75 }).rays).toBeGreaterThan(0.3);
    expect(under(TIME_PRESETS.golden, { cloud: 0.95, rain: 1, mist: 0.2 }).rays).toBeLessThan(0.02);
    expect(under(TIME_PRESETS.night, { cloud: 0.45, rain: 0, mist: 0.5 }).rays).toBe(0);
  });

  test("cloud shadows drift over the land only under broken cloud and a sun that's up", () => {
    expect(under(TIME_PRESETS.day, { cloud: 0, rain: 0, mist: 0 }).cloudShadow).toBe(0);
    expect(under(TIME_PRESETS.day, { cloud: 0.45, rain: 0, mist: 0 }).cloudShadow).toBeGreaterThan(0.9);
    expect(under(TIME_PRESETS.day, { cloud: 0.92, rain: 1, mist: 0 }).cloudShadow).toBe(0);
    expect(under(TIME_PRESETS.night, { cloud: 0.45, rain: 0, mist: 0 }).cloudShadow).toBe(0);
    expect(under(TIME_PRESETS.dawn, { cloud: 0.45, rain: 0, mist: 0 }).cloudShadow).toBe(0);
  });

  test("mist lies as a sheet on the ground at dawn and by night, and lifts by day", () => {
    const dawn = under(TIME_PRESETS.dawn, { cloud: 0, rain: 0, mist: 0.5 }).groundMist;
    const day = under(TIME_PRESETS.day, { cloud: 0, rain: 0, mist: 0.5 }).groundMist;
    const night = under(TIME_PRESETS.night, { cloud: 0, rain: 0, mist: 0.5 }).groundMist;
    expect(dawn).toBeCloseTo(0.5, 5);
    expect(night).toBeCloseTo(0.5, 5);
    expect(day).toBeLessThan(dawn / 2);
    expect(day).toBeGreaterThan(0);
    expect(under(TIME_PRESETS.dawn, { cloud: 0, rain: 0, mist: 0 }).groundMist).toBe(0);
  });

  test("clouds are lit from below only by a sun at the horizon, and not through a full deck", () => {
    expect(skyFor(TIME_PRESETS.day, sky).underlight).toBe(0);
    expect(skyFor(TIME_PRESETS.night, sky).underlight).toBe(0);
    expect(skyFor(TIME_PRESETS.dawn, sky).underlight).toBeGreaterThan(0.9);
    expect(skyFor(TIME_PRESETS.golden, sky).underlight).toBeGreaterThan(0.5);
    const open = under(TIME_PRESETS.golden, { cloud: 0.5, rain: 0, mist: 0 }).underlight;
    expect(open).toBeGreaterThan(0.5);
    expect(under(TIME_PRESETS.golden, { cloud: 0.97, rain: 0, mist: 0 }).underlight).toBeLessThan(0.01);
  });

  test("thunder turns the sky to slate: darker than rain's, dimmer below, lamps on", () => {
    const rain = { ...under(TIME_PRESETS.day, { cloud: 1, rain: 1, mist: 0.2 }) };
    const storm = under(TIME_PRESETS.day, { cloud: 1, rain: 1, mist: 0.2, storm: 1 });
    expect(lum(storm.zenith)).toBeLessThan(lum(rain.zenith) * 0.6);
    expect(lum(storm.horizon)).toBeLessThan(lum(rain.horizon));
    expect(storm.lightIntensity).toBeLessThan(rain.lightIntensity);
    expect(storm.exposure).toBeLessThan(rain.exposure);
    expect(storm.lamps).toBeGreaterThan(rain.lamps + 0.3);
  });

  test("snow in the air is on the sky, and lifts the exposure where rain lowers it", () => {
    const grey = { ...under(TIME_PRESETS.day, { cloud: 0.88, rain: 0, mist: 0.3 }) };
    const snowing = under(TIME_PRESETS.day, { cloud: 0.88, rain: 0, mist: 0.3, snow: 0.8 });
    expect(snowing.snow).toBe(0.8);
    expect(grey.snow).toBe(0);
    expect(snowing.exposure).toBeGreaterThan(grey.exposure);
  });
});

describe("the grade", () => {
  const warmth = (v: readonly number[]) => v[0]! / v[2]!;
  const copy = (s: typeof sky) => ({ sat: s.gradeSat, shadow: [...s.gradeShadow], light: [...s.gradeLight] });
  const under = (preset: Heavens, w: { cloud: number; rain: number; mist: number }) => applyWeather(skyFor(preset, sky), w);

  test("golden hour is amber in the light and lavender in the shade, and richer than noon", () => {
    const noon = copy(skyFor(TIME_PRESETS.day, sky));
    const golden = copy(skyFor(TIME_PRESETS.golden, sky));
    expect(warmth(golden.light)).toBeGreaterThan(1.2);
    expect(warmth(golden.shadow)).toBeLessThan(0.88);
    expect(golden.sat).toBeGreaterThan(noon.sat + 0.05);
    // Noon is nearly neutral.
    expect(Math.abs(warmth(noon.light) - 1)).toBeLessThan(0.08);
  });

  test("a morning's low sun is cooler than an evening's", () => {
    const evening = copy(skyFor(heavens(5, { evening: 1 }), sky));
    const morning = copy(skyFor(heavens(5, { evening: 0 }), sky));
    expect(warmth(morning.light)).toBeLessThan(warmth(evening.light));
    expect(warmth(morning.light)).toBeGreaterThan(1.05);
  });

  test("night is blue in the shade and quieter in colour", () => {
    const night = copy(skyFor(TIME_PRESETS.night, sky));
    expect(night.shadow[2]! - night.shadow[0]!).toBeGreaterThan(0.2);
    expect(night.sat).toBeLessThan(1);
  });

  test("it never jumps as the sun moves, and stays near neutral", () => {
    for (const evening of [0, 0.5, 1]) {
      let last: ReturnType<typeof copy> | null = null;
      for (let e = -40; e <= 70; e += 0.1) {
        const g = copy(skyFor(heavens(e, { evening }), sky));
        for (const v of [g.sat, ...g.shadow, ...g.light]) {
          expect(v).toBeGreaterThan(0.8);
          expect(v).toBeLessThan(1.25);
        }
        if (last) {
          expect(Math.abs(g.sat - last.sat)).toBeLessThan(0.01);
          for (let i = 0; i < 3; i++) {
            expect(Math.abs(g.shadow[i]! - last.shadow[i]!)).toBeLessThan(0.01);
            expect(Math.abs(g.light[i]! - last.light[i]!)).toBeLessThan(0.01);
          }
        }
        last = g;
      }
    }
  });

  test("a sky that has clouded over has no sun to grade by: nearly neutral", () => {
    const g = copy(under(TIME_PRESETS.golden, { cloud: 1, rain: 0.5, mist: 0.2 }));
    expect(Math.abs(g.sat - 1)).toBeLessThan(0.05);
    for (const v of [...g.shadow, ...g.light]) expect(Math.abs(v - 1)).toBeLessThan(0.03);
    // Broken cloud keeps some of it.
    const broken = copy(under(TIME_PRESETS.golden, { cloud: 0.3, rain: 0, mist: 0 }));
    expect(warmth(broken.light)).toBeGreaterThan(1.1);
  });
});
