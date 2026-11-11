import { describe, expect, test } from "bun:test";
import { naturalMist, Weather, type WeatherState } from "./weather.ts";

/** Runs the weather for `seconds` at 30 steps a second, under a sun at `elevation`°, recording every state. */
function run(w: Weather, seconds: number, elevation = 30, evening = 0.5) {
  const seen: WeatherState[] = [];
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
    expect(Math.max(...seen.map((s) => s.mist))).toBeGreaterThan(0.25);
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

  test("aimed at the real weather it eases there, snaps there on first sight, and a preset takes over again", () => {
    const w = new Weather("clear");
    w.aim({ cloud: 0.92, rain: 0.6, mist: 0.2 });
    const last = run(w, 180).at(-1)!;
    expect(last.cloud).toBeCloseTo(0.92, 2);
    expect(last.rain).toBeCloseTo(0.6, 2);
    expect(last.wetness).toBeGreaterThan(0.9);
    const first = new Weather("clear");
    first.aim({ cloud: 0.92, rain: 0.6, mist: 0.2 });
    const snapped = first.snap(30, 0.5);
    expect(snapped.cloud).toBe(0.92);
    expect(snapped.rain).toBe(0.6);
    expect(snapped.wetness).toBeGreaterThan(0.5);
    w.set("clear");
    const cleared = run(w, 400).at(-1)!;
    expect(cleared.rain).toBe(0);
    expect(cleared.cloud).toBeLessThan(0.01);
  });

  test("snow falls only from a clouded sky, settles while it falls, and thaws after into wet ground and mist", () => {
    const w = new Weather("clear");
    w.set("snow");
    const seen = run(w, 120, 10);
    const first = seen.findIndex((s) => s.snow > 0.05);
    expect(seen[first]!.cloud).toBeGreaterThan(0.45);
    expect(seen[first]!.snowCover).toBeLessThan(0.1);
    // No jumps, and no rain with it.
    for (let i = 1; i < seen.length; i++) {
      expect(Math.abs(seen[i]!.snow - seen[i - 1]!.snow)).toBeLessThan(0.02);
      expect(Math.abs(seen[i]!.snowCover - seen[i - 1]!.snowCover)).toBeLessThan(0.02);
      expect(seen[i]!.rain).toBe(0);
    }
    expect(w.state.snow).toBeGreaterThan(0.75);
    expect(w.state.snowCover).toBe(1);
    expect(w.state.wetness).toBe(0);
    // It stops: the snow lies a while, thawing; the ground under it is wet, and steams.
    w.set("clear");
    const after = run(w, 60, 10);
    expect(w.state.snow).toBe(0);
    expect(w.state.snowCover).toBeGreaterThan(0.3);
    expect(w.state.snowCover).toBeLessThan(1);
    expect(w.state.wetness).toBeGreaterThan(0.4);
    expect(Math.max(...after.map((s) => s.mist))).toBeGreaterThan(0.1);
    for (let i = 1; i < after.length; i++) expect(after[i]!.snowCover).toBeLessThanOrEqual(after[i - 1]!.snowCover);
    run(w, 600, 10);
    expect(w.state.snowCover).toBe(0);
    run(w, 600, 10);
    expect(w.state.wetness).toBe(0);
  });

  test("snow thaws faster in sunshine than under cloud, and rain washes it away fastest", () => {
    const thaw = (kind: "clear" | "overcast" | "rain", elevation: number) => {
      const w = new Weather("snow");
      w.snap(elevation, 0.5);
      w.set(kind);
      let seconds = 0;
      while (w.state.snowCover > 0 && seconds < 3600) {
        w.step(1 / 10, elevation, 0.5);
        seconds += 0.1;
      }
      return seconds;
    };
    const sunny = thaw("clear", 40);
    const grey = thaw("overcast", 40);
    const night = thaw("clear", -20);
    const rainy = thaw("rain", 40);
    expect(sunny).toBeLessThan(grey);
    expect(sunny).toBeLessThan(night);
    expect(rainy).toBeLessThan(sunny);
    expect(night).toBeLessThan(900);
  });

  test("first sight of snow has it lying already; first sight of a storm is black, pouring and windy", () => {
    const snow = new Weather("snow");
    expect(snow.state.snow).toBeGreaterThan(0.7);
    expect(snow.state.snowCover).toBeGreaterThan(0.9);
    expect(snow.state.rain).toBe(0);
    const storm = new Weather("storm");
    expect(storm.state.storm).toBe(1);
    expect(storm.state.cloud).toBe(1);
    expect(storm.state.rain).toBe(1);
    expect(storm.state.wind).toBeGreaterThan(10);
    expect(new Weather("clear").state.storm).toBe(0);
  });

  test("thunder waits for a black sky and goes with it; the wind rises and falls smoothly", () => {
    const w = new Weather("clear");
    const calm = w.state.wind;
    w.set("storm");
    const seen = run(w, 90);
    const first = seen.findIndex((s) => s.storm > 0.05);
    expect(seen[first]!.cloud).toBeGreaterThan(0.7);
    for (let i = 1; i < seen.length; i++) {
      expect(Math.abs(seen[i]!.wind - seen[i - 1]!.wind)).toBeLessThan(0.1);
      expect(Math.abs(seen[i]!.storm - seen[i - 1]!.storm)).toBeLessThan(0.02);
    }
    expect(w.state.storm).toBeGreaterThan(0.95);
    expect(w.state.wind).toBeGreaterThan(calm + 8);
    w.set("clear");
    run(w, 120);
    expect(w.state.storm).toBe(0);
    expect(w.state.wind).toBeCloseTo(calm, 5);
  });

  test("the real weather can bring snow, thunder and wind; what it leaves out is none, and a breeze", () => {
    const w = new Weather("clear");
    w.aim({ cloud: 0.9, rain: 0, mist: 0.25, snow: 0.6, storm: 0, wind: 11 });
    const last = run(w, 180).at(-1)!;
    expect(last.snow).toBeCloseTo(0.6, 2);
    expect(last.wind).toBeCloseTo(11, 2);
    expect(last.snowCover).toBe(1);
    w.aim({ cloud: 0.5, rain: 0, mist: 0 });
    const plain = run(w, 400).at(-1)!;
    expect(plain.snow).toBe(0);
    expect(plain.storm).toBe(0);
    expect(plain.wind).toBeGreaterThan(0);
    expect(plain.wind).toBeLessThan(5);
    // Nonsense from outside stays in range.
    w.aim({ cloud: 7, rain: -1, mist: 0.2, snow: 9, storm: 3, wind: -4 });
    const odd = run(w, 60).at(-1)!;
    for (const v of [odd.cloud, odd.rain, odd.snow, odd.storm]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(odd.wind).toBeGreaterThanOrEqual(0);
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

  test("the wind veers to the real direction the short way round, smoothly, and a preset brings the prevailing one back", () => {
    const w = new Weather("clear");
    const start = w.state.windHeading;
    // From just north of east round to just south of it: the short way is through east, never round the back.
    w.aim({ cloud: 0.3, rain: 0, mist: 0, wind: 5, windHeading: -0.4 });
    let last = start;
    for (const s of run(w, 60)) {
      const step = Math.atan2(Math.sin(s.windHeading - last), Math.cos(s.windHeading - last));
      expect(step).toBeLessThanOrEqual(1e-9);
      expect(Math.abs(step)).toBeLessThan(0.02);
      expect(Math.cos(s.windHeading)).toBeGreaterThan(0.9);
      last = s.windHeading;
    }
    expect(Math.abs(w.state.windHeading - -0.4)).toBeLessThan(1e-3);
    w.set("rain");
    run(w, 90);
    expect(Math.abs(w.state.windHeading - start)).toBeLessThan(1e-3);
    // Snapped on first sight; a direction that isn't a number is the prevailing one.
    w.aim({ cloud: 0, rain: 0, mist: 0, windHeading: Number.NaN });
    w.snap(30, 0.5);
    expect(w.state.windHeading).toBe(start);
  });
});
