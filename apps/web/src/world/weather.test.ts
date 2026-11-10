import { describe, expect, test } from "bun:test";
import { naturalMist, Weather } from "./weather.ts";

/** Runs the weather for `seconds` at 30 steps a second, under a sun at `elevation`°, recording every state. */
function run(w: Weather, seconds: number, elevation = 30, evening = 0.5) {
  const seen: { cloud: number; rain: number; mist: number; wetness: number }[] = [];
  for (let i = 0; i < seconds * 30; i++) seen.push({ ...w.step(1 / 30, elevation, evening) });
  return seen;
}

describe("the weather", () => {
  test("starts clear and dry, and stays so", () => {
    const w = new Weather();
    run(w, 60);
    expect(w.state.cloud).toBe(0);
    expect(w.state.rain).toBe(0);
    expect(w.state.wetness).toBe(0);
    expect(w.state.mist).toBeLessThan(0.1);
  });

  test("rain comes on smoothly: clouds first, then rain, then the ground soaks", () => {
    const w = new Weather("clear");
    w.set("rain");
    const seen = run(w, 90);
    // No jumps: every step is small.
    for (let i = 1; i < seen.length; i++) {
      expect(Math.abs(seen[i]!.cloud - seen[i - 1]!.cloud)).toBeLessThan(0.02);
      expect(Math.abs(seen[i]!.rain - seen[i - 1]!.rain)).toBeLessThan(0.02);
    }
    // It doesn't rain from a clear sky.
    const firstRain = seen.findIndex((s) => s.rain > 0.05);
    expect(seen[firstRain]!.cloud).toBeGreaterThan(0.45);
    expect(seen[firstRain]!.wetness).toBeLessThan(0.1);
    expect(w.state.cloud).toBeGreaterThan(0.9);
    expect(w.state.rain).toBeGreaterThan(0.95);
    expect(w.state.wetness).toBe(1);
  });

  test("when the rain stops it stops first, the clouds clear after, the ground dries slowly and the mist rises", () => {
    const w = new Weather("rain");
    w.snap(30, 0.5);
    run(w, 30);
    w.set("clear");
    const seen = run(w, 12);
    expect(w.state.rain).toBeLessThan(0.05);
    expect(w.state.cloud).toBeGreaterThan(0.3);
    expect(w.state.wetness).toBeGreaterThan(0.85);
    // Steaming after rain.
    expect(Math.max(...seen.map((s) => s.mist))).toBeGreaterThan(0.3);
    run(w, 120);
    expect(w.state.cloud).toBeLessThan(0.01);
    expect(w.state.wetness).toBeGreaterThan(0);
    run(w, 400);
    expect(w.state.wetness).toBe(0);
    expect(w.state.mist).toBeLessThan(0.1);
  });

  test("drizzle is lighter than rain; overcast is grey without rain; mist is misty", () => {
    const states = (["drizzle", "rain", "overcast", "mist"] as const).map((kind) => {
      const w = new Weather(kind);
      run(w, 120);
      return w.state;
    });
    const [drizzle, rain, overcast, mist] = states;
    expect(drizzle!.rain).toBeGreaterThan(0.2);
    expect(drizzle!.rain).toBeLessThan(rain!.rain / 2);
    expect(overcast!.rain).toBe(0);
    expect(overcast!.cloud).toBeGreaterThan(0.6);
    expect(mist!.mist).toBeGreaterThan(0.7);
    expect(mist!.rain).toBe(0);
  });

  test("clear skies bring mist at dawn, a little at night, and almost none by day or at dusk", () => {
    const dawn = naturalMist(1, 0);
    expect(dawn).toBeGreaterThan(0.45);
    expect(naturalMist(30, 0.5)).toBeLessThan(0.08);
    expect(naturalMist(1, 1)).toBeLessThan(dawn / 2);
    expect(naturalMist(-25, 1)).toBeGreaterThan(0.08);
    expect(naturalMist(-25, 1)).toBeLessThan(dawn);
    // A clear morning eases into its dawn mist.
    const w = new Weather("clear");
    run(w, 60, 1, 0);
    expect(w.state.mist).toBeGreaterThan(0.45);
    // A jump in the time of day (a preset) brings its mist at once, as it does its light.
    w.settleMist(40, 0.5);
    expect(w.state.mist).toBeLessThan(0.08);
  });

  test("is deterministic: the same steps give the same weather", () => {
    const a = new Weather("clear");
    const b = new Weather("clear");
    a.set("drizzle");
    b.set("drizzle");
    run(a, 20, 5, 0.2);
    run(b, 20, 5, 0.2);
    expect(a.state).toEqual(b.state);
  });
});
