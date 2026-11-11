import { describe, expect, test } from "bun:test";
import { chartSeries, examine, ranAway, readoutLabel, readoutValue, type ReadoutStats, type SavedExperiment, summaryOf, trendOf } from "../src/experiments.ts";
import { phaseOf, stationForTool } from "../src/world.ts";

/*
 * The examination: what a saved experiment showed, as data (for the panel's charts, the CLI,
 * Galahad's tools and the observatory's chalkboard) and in words. Pure, so every rule is here.
 */

const series = (n: number, f: (t: number) => number, dt = 0.1): [number, number][] => Array.from({ length: n }, (_, i) => [i * dt, f(i * dt)]);

function statsOf(points: [number, number][]): ReadoutStats {
  let [min, max, tMin, tMax] = [Infinity, -Infinity, 0, 0];
  for (const [t, v] of points) {
    if (v < min) [min, tMin] = [v, t];
    if (v > max) [max, tMax] = [v, t];
  }
  return { count: points.length, min, max, tMin, tMax, first: points[0]!, last: points.at(-1)! };
}

function saved(over: Partial<SavedExperiment>, readouts: Record<string, [number, number][]> = {}): SavedExperiment {
  return {
    id: "ex_AAAAAAAAAAAA",
    title: "Two-link arm",
    engine: "mujoco",
    status: "done",
    plot: { x: 112, y: 11, size: 10 },
    scale: 1,
    scene: [],
    startedAt: 1_000,
    endedAt: 21_000,
    nodeName: "ultra",
    sandbox: "0123456789",
    quest: null,
    metrics: {},
    summary: null,
    phase: "done",
    phases: { building: 1_000, testing: 2_000, examining: 21_000, ended: 30_000 },
    pinned: false,
    bytes: 1234,
    recording: { frames: 300, bytes: 9000, hz: 15, thinned: false, rate: 1, t0: 0, t1: 20, bodies: ["hand"] },
    readouts: Object.fromEntries(Object.entries(readouts).map(([k, p]) => [k, statsOf(p)])),
    code: null,
    ...over,
  };
}

describe("a readout's shape", () => {
  test("steady, rising, falling, peaked, dipped, oscillating, fluctuating", () => {
    expect(trendOf(series(50, () => 600))).toBe("steady");
    // Within 5 % of its size and no net change: an altitude held at 600 ± 5.
    expect(trendOf(series(200, (t) => 600 + 5 * Math.sin(t * 3)))).toBe("steady");
    expect(trendOf(series(50, (t) => 3 * t + 1))).toBe("rising");
    // An arm's tracking error: a big transient that settles low.
    expect(trendOf(series(200, (t) => 3 + 90 * Math.exp(-t * 2) + 0.4 * Math.sin(t * 9)))).toBe("falling");
    // A rocket's altitude: up to apogee and down again.
    expect(trendOf(series(100, (t) => Math.max(0, 900 - 9 * (t - 5) ** 2 * 3.6)))).toBe("peaked");
    expect(trendOf(series(100, (t) => (t - 5) ** 2))).toBe("dipped");
    expect(trendOf(series(400, (t) => Math.sin(t * 2)))).toBe("oscillating");
    // A pendulum let go at 69°, over a swing and a half: it turned only twice, but right across its range.
    expect(trendOf(series(300, (t) => 69 * Math.cos(t * Math.PI), 0.01))).toBe("oscillating");
    // A wobble with no clear direction, no one extreme, turning back fewer than four times, never right across.
    expect(trendOf([[0, 3], [1, 10], [2, 6], [3, 9], [4, 2], [5, 3]])).toBe("fluctuating");
    // A rocket's speed: the burn, the coast, the fall, the chute: not an oscillation.
    expect(trendOf([[0, 0], [3, 200], [10, 50], [20, 120], [30, 10]])).toBe("fluctuating");
    expect(trendOf([[0, 5]])).toBe("steady");
  });

  test("ran away: it ended at its largest, ten times what it ever was in its first half", () => {
    expect(ranAway(series(60, (t) => Math.exp(t)))).toBe(true);
    expect(ranAway(series(60, (t) => t))).toBe(false);
    expect(ranAway(series(60, (t) => Math.exp(-t)))).toBe(false);
    expect(ranAway(series(5, (t) => Math.exp(t * 10)))).toBe(false);
    // A large final value that isn't its largest isn't a runaway.
    expect(ranAway([...series(30, () => 1), [3, 50], [3.1, 40]])).toBe(false);
  });

  test("a chart's series: at most 96 points, the extremes of each stretch, first and last kept", () => {
    const spiky = series(10_000, (t) => (Math.abs(t - 432.1) < 0.05 ? 999 : Math.sin(t)), 0.1);
    const chart = chartSeries(spiky);
    expect(chart.length).toBeLessThanOrEqual(96);
    expect(Math.max(...chart.map(([, v]) => v))).toBe(999);
    expect(chart[0]).toEqual(spiky[0]!);
    expect(chart.at(-1)).toEqual(spiky.at(-1)!);
    for (let i = 1; i < chart.length; i++) expect(chart[i]![0]).toBeGreaterThanOrEqual(chart[i - 1]![0]);
    expect(chartSeries([[0, 1], [1, 2]])).toEqual([[0, 1], [1, 2]]);
  });

  test("labels and values, as everywhere else", () => {
    expect(readoutLabel("altitude_m")).toBe("altitude (m)");
    expect(readoutLabel("error_mm")).toBe("error (mm)");
    expect(readoutLabel("reward")).toBe("reward");
    expect(readoutValue(1234.5)).toBe("1 235");
    expect(readoutValue(3.14159)).toBe("3.14");
    expect(readoutValue(0.00012)).toBe("1.2e-4");
  });
});

describe("an experiment, examined", () => {
  test("each readout's range, final value, trend and chart, its own summary, and all of it in words", () => {
    const error = series(200, (t) => 3 + 90 * Math.exp(-t * 2));
    const ex = examine(saved({ summary: "it tracked the circle" }, { error_mm: error }), { error_mm: error });
    expect(ex.readouts).toHaveLength(1);
    const r = ex.readouts[0]!;
    expect(r).toMatchObject({ key: "error_mm", label: "error (mm)", trend: "falling", ranAway: false, count: 200 });
    expect(r.max).toBeCloseTo(93, 5);
    expect(r.final).toBeCloseTo(error.at(-1)![1], 10);
    expect(r.series.length).toBeLessThanOrEqual(96);
    expect(ex.notable).toEqual(["In its own words: it tracked the circle."]);
    expect(ex.headline).toMatch(/^Two-link arm finished: error \(mm\) fell from 93\.0 to 3\.00/);
    expect(ex.words).toContain("Two-link arm (MuJoCo) finished after 20 s of simulation.");
    expect(ex.words).toContain("Nothing ran away.");
    expect(ex.duration).toBe(20);
  });

  test("a failure, a runaway and a thinned recording are notable; a readout seen only at the end is a value", () => {
    const angle = series(80, (t) => 0.01 * Math.exp(t * 1.2));
    const ex = examine(
      saved({ status: "failed", phase: "failed", summary: "RuntimeError: it came down at t=40 s", recording: { frames: 900, bytes: 8e6, hz: 7.5, thinned: true, rate: 4, t0: 0, t1: 7.9, bodies: [] } }, { angle_rad: angle, lowest_m: [[7.9, 31]] }),
      { angle_rad: angle },
    );
    expect(ex.readouts.find((r) => r.key === "angle_rad")).toMatchObject({ ranAway: true });
    expect(ex.readouts.find((r) => r.key === "lowest_m")!.sentence).toBe("lowest (m) was 31.0.");
    expect(ex.notable[0]).toBe("It failed: RuntimeError: it came down at t=40 s.");
    expect(ex.notable.some((n) => /^angle \(rad\) ran away, ending at/.test(n))).toBe(true);
    expect(ex.notable.some((n) => /thinned to 7\.5 frames a second/.test(n))).toBe(true);
    expect(ex.headline).toBe("Two-link arm failed: RuntimeError: it came down at t=40 s.");
    expect(ex.words).toContain("angle (rad) ran away");
    expect(ex.words).not.toContain("Nothing ran away");
  });

  test("with nothing to go on: no readouts, said so", () => {
    const ex = examine(saved({ status: "failed", phase: "failed", summary: "its sandbox couldn't start: no sandbox host", recording: { frames: 0, bytes: 0, hz: 15, thinned: false, rate: 1, t0: null, t1: null, bodies: [] } }), {});
    expect(ex).toMatchObject({ readouts: [], duration: null });
    expect(ex.notable).toEqual(["It failed: its sandbox couldn't start: no sandbox host.", "It sent no readouts."]);
    expect(ex.words).toBe("Two-link arm (MuJoCo) failed. It failed: its sandbox couldn't start: no sandbox host. It sent no readouts.");
  });

  test("a list's summary: its first readouts' final values, how long it covers", () => {
    const s = summaryOf(saved({}, { a: [[0, 1], [20, 2]], b: [[0, 3], [20, 4]] }));
    expect(s).toMatchObject({ id: "ex_AAAAAAAAAAAA", readouts: { a: 2, b: 4 }, duration: 20, frames: 300, code: false, phase: "done" });
  });
});

describe("phases and stations", () => {
  test("an older node's experiment has a phase from its status", () => {
    expect(phaseOf({ status: "starting" })).toBe("building");
    expect(phaseOf({ status: "running" })).toBe("testing");
    expect(phaseOf({ status: "done" })).toBe("done");
    expect(phaseOf({ status: "failed", phase: "examining" })).toBe("examining");
  });

  test("running one takes him out to it; reading saved ones is the observatory's work", () => {
    expect(stationForTool("experiment_run")).toBe("field");
    expect(stationForTool("experiments")).toBe("observatory");
    expect(stationForTool("experiment_examine")).toBe("observatory");
  });
});
