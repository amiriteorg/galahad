import { describe, expect, test } from "bun:test";
import { SEED as RELIEF_SEED } from "../../apps/web/src/world/relief.ts";
import { Scorecard } from "../../packages/core/src/scorecard.ts";
import { browserCandidates, LAND_SEED, metricOf, worldScaleCard } from "./card.ts";

/*
 * What the browser suite leaves in bench/out for the scorecard (bench/run.ts) to read. The runner itself
 * needs a browser and a GPU; this is the part of it that can be held to the contract without either.
 */

const machine = { name: "bench-host", calibration: 61_234, cores: 8 };

describe("the browser suite's scorecard", () => {
  test("is one the scorecard reads: when it ended in milliseconds, the land's own seed, its metrics as given", () => {
    const metrics = [metricOf("base.low.webgl2.phone.rest.cpu.p50", 3.21, "ms", "lower")!, metricOf("bundle.world.gzip", 412_345, "bytes", "lower")!];
    const card = worldScaleCard({ commit: "807595a+", at: 1_794_571_200_000, machine }, metrics);
    expect(Scorecard.parse(JSON.parse(JSON.stringify(card)))).toEqual(card);
    expect(card).toMatchObject({ suite: "world-scale", commit: "807595a+", at: 1_794_571_200_000, seed: LAND_SEED, machine });
    expect(card.metrics.map((m) => m.id)).toEqual(["base.low.webgl2.phone.rest.cpu.p50", "bundle.world.gzip"]);
    // The seed is the world's own: the land every run draws.
    expect(LAND_SEED).toBe(RELIEF_SEED);
  });

  test("a result the scorecard could not read is never written: it is refused here, where the runner would see it", () => {
    expect(() => worldScaleCard({ commit: "807595a", at: Date.parse("2026-11-13T12:00:00Z"), machine: { ...machine, calibration: 0 } }, [])).toThrow();
    const twice = metricOf("a.b", 1, "ms", "lower")!;
    expect(() => worldScaleCard({ commit: "807595a", at: 1, machine }, [twice, twice])).toThrow(/unique/);
  });

  test("a metric: its value rounded, nothing for what isn't a number, and a count of samples only when there were some", () => {
    expect(metricOf("x.cpu.p95", 4.123456, "ms", "lower", { n: 120, note: "at rest" })).toEqual({ id: "x.cpu.p95", value: 4.123, unit: "ms", kind: "speed", better: "lower", n: 120, note: "at rest" });
    expect(metricOf("x.hitch.p95", 0, "ms", "lower", { n: 0 })).toEqual({ id: "x.hitch.p95", value: 0, unit: "ms", kind: "speed", better: "lower" });
    expect(metricOf("x.gpu.p50", Number.NaN, "ms", "lower")).toBeNull();
    expect(metricOf("x.gpu.p50", Number.POSITIVE_INFINITY, "ms", "lower")).toBeNull();
    expect(Scorecard.safeParse(worldScaleCard({ commit: "c", at: 1, machine }, [metricOf("x.hitch.p95", 0, "ms", "lower", { n: 0 })!])).success).toBe(true);
  });
});

describe("which browser it drives", () => {
  test("the one you name comes first; then Edge and Chrome where each platform keeps them", () => {
    expect(browserCandidates("win32", { EDGE: "D:/edge.exe" })[0]).toBe("D:/edge.exe");
    expect(browserCandidates("darwin", { GALAHAD_BROWSER: "/opt/chrome" })[0]).toBe("/opt/chrome");
    expect(browserCandidates("win32", {})[0]).toBe("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe");
    expect(browserCandidates("darwin", {})).toEqual(["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]);
    expect(browserCandidates("linux", {})).toContain("/usr/bin/google-chrome");
  });
});
