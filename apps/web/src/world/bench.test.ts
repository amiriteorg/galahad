import { describe, expect, test } from "bun:test";
import { benchAsk, FILLING, FrameLog, GROWING, PART, PARTS, quantile, scaleTier, spreadOf } from "./bench.ts";
import { TIERS } from "./tiers.ts";

describe("what a benchmark asks of the world", () => {
  test("nothing is asked without trace=1", () => {
    expect(benchAsk("")).toBeNull();
    expect(benchAsk("?animals=16&uncap=1")).toBeNull();
    expect(benchAsk("?tier=low&trace=10")).toBeNull();
  });

  test("the address's numbers, bounded; nonsense is 1", () => {
    expect(benchAsk("?trace=1")).toEqual({ animals: 1, reach: 1, plants: 1, uncap: false, gpu: false, hold: false });
    expect(benchAsk("?trace=1&animals=16&reach=2&plants=4&uncap=1&gpu=1&hold=1")).toEqual({ animals: 16, reach: 2, plants: 4, uncap: true, gpu: true, hold: true });
    expect(benchAsk("?animals=-3&reach=abc&plants=1e9&trace=1")).toEqual({ animals: 1, reach: 1, plants: 64, uncap: false, gpu: false, hold: false });
  });

  test("a tier asked for nothing more is the tier itself", () => {
    for (const tier of Object.values(TIERS)) expect(scaleTier(tier, { animals: 1, reach: 1, plants: 1 })).toBe(tier);
  });

  test("more animals: every kind's cap, and nothing else", () => {
    const t = scaleTier(TIERS.medium, { animals: 4, reach: 1, plants: 1 });
    expect(t.deer).toBe(TIERS.medium.deer * 4);
    expect(t.birds).toBe(TIERS.medium.birds * 4);
    expect(t.wild.starling).toBe(TIERS.medium.wild.starling * 4);
    expect(t.wild.insects).toBe(TIERS.medium.wild.insects * 4);
    expect(t.fireflies).toBe(TIERS.medium.fireflies * 4);
    expect(t.wild.reach).toBe(TIERS.medium.wild.reach);
    expect({ ...t, deer: 0, birds: 0, rabbits: 0, ducks: 0, fireflies: 0, wild: null }).toEqual({ ...TIERS.medium, deer: 0, birds: 0, rabbits: 0, ducks: 0, fireflies: 0, wild: null } as never);
    // (The tiers themselves are never written to.)
    expect(TIERS.medium.deer).toBe(5);
  });

  test("more land: the reach, and the caps its area needs", () => {
    const t = scaleTier(TIERS.high, { animals: 1, reach: 2, plants: 1 });
    expect(t.radius).toBe(760);
    expect(t.trees).toBe(24000);
    expect(t.rocks).toBe(7200);
    expect(t.triangles).toBe(7800000);
    // What's drawn only near the view stays as it was.
    expect(t.grass).toBe(TIERS.high.grass);
    expect(t.grassRadius).toBe(TIERS.high.grassRadius);
    expect(t.deer).toBe(TIERS.high.deer);
  });

  test("more plants: the small ones and the near trees over that many times the area", () => {
    const t = scaleTier(TIERS.high, { animals: 1, reach: 1, plants: 4 });
    expect(t.grassRadius).toBe(200);
    expect(t.treeDetail).toBe(140);
    expect(t.grass).toBe(64000);
    expect(t.radius).toBe(TIERS.high.radius);
    expect(t.trees).toBe(TIERS.high.trees);
  });
});

describe("the frames' log", () => {
  test("quantiles by nearest rank", () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(quantile(sorted, 0.5)).toBe(5);
    expect(quantile(sorted, 0.95)).toBe(10);
    expect(quantile(sorted, 0.9)).toBe(9);
    expect(quantile([], 0.5)).toBe(0);
    const s = spreadOf(Float64Array.from([4, 1, 3, 2, 100]));
    expect(s).toEqual({ n: 5, mean: 22, p50: 3, p95: 100, p99: 100, max: 100 });
  });

  test("a frame's time goes to its parts, and they sum to it", () => {
    const log = new FrameLog(8);
    // Two frames, 10 ms apart: 1 ms of land and 3 of render; then 2 of the ecosystem and 6 of render, growing land.
    log.begin(1000, 16, 0);
    log.mark(PART.land, 1);
    log.mark(PART.render, 4);
    log.end(0, 4);
    log.begin(1010, 10, 10);
    log.mark(PART.eco, 12);
    log.mark(PART.render, 18);
    log.mark(PART.render, 20);
    log.end(GROWING, 20);
    log.gpu(2.5);
    log.gpu(0);
    const s = log.stats();
    expect(s.frames).toBe(2);
    expect(s.seconds).toBeCloseTo(0.01, 9);
    expect(s.work.mean).toBe(7);
    expect(s.work.max).toBe(10);
    expect(s.interval.p50).toBe(10);
    expect(s.parts.land).toBe(0.5);
    expect(s.parts.eco).toBe(1);
    expect(s.parts.render).toBe(5.5);
    let sum = 0;
    for (const p of PARTS) sum += s.parts[p];
    expect(sum).toBe(s.work.mean);
    // The frame that grew land is counted apart; a query that gave nothing isn't counted.
    expect(s.growing).toEqual({ n: 1, mean: 10, p50: 10, p95: 10, p99: 10, max: 10 });
    expect(s.gpu.n).toBe(1);
    expect(s.gpu.p50).toBe(2.5);
    expect(s.over16 + s.over33 + s.over50).toBe(0);
    // The longest frame, part by part: what it was doing.
    expect(s.worst.flags).toBe(GROWING);
    expect(s.worst.parts.eco).toBe(2);
    expect(s.worst.parts.render).toBe(8);
    expect(s.worst.parts.land).toBe(0);
  });

  test("it keeps the last frames only, and counts the slow ones", () => {
    const log = new FrameLog(4);
    for (let i = 0; i < 10; i++) {
      log.begin(i * 20, 20, i * 20);
      log.mark(PART.render, i * 20 + (i === 9 ? 60 : i === 8 ? 40 : i === 7 ? 20 : 5));
      log.end(i === 9 ? FILLING : 0, i * 20 + (i === 9 ? 60 : i === 8 ? 40 : i === 7 ? 20 : 5));
    }
    const s = log.stats();
    expect(s.frames).toBe(4);
    expect(s.work.max).toBe(60);
    expect(s.over16).toBe(3);
    expect(s.over33).toBe(2);
    expect(s.over50).toBe(1);
    // The frames of 50 ms and more are listed: when, how long, and the part that took longest.
    expect(s.slow).toEqual([{ at: 180, ms: 60, part: "render", partMs: 60, flags: FILLING }]);
    expect(s.growing.n).toBe(1);
    log.reset();
    expect(log.stats().frames).toBe(0);
  });
});
