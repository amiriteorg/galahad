import { describe, expect, test } from "bun:test";
import { Lightning, MIN_GAP_S } from "./lightning.ts";

/** Runs a storm for `seconds` at 60 steps a second, recording the flash at every step. */
function run(l: Lightning, seconds: number, storm = 1, motion = true): number[] {
  const seen: number[] = [];
  for (let i = 0; i < seconds * 60; i++) seen.push(l.step(1 / 60, storm, motion, 1));
  return seen;
}

/** The steps at which a pulse begins (the flash jumps up). */
const pulses = (seen: number[]): number[] => seen.flatMap((f, i) => (f > (seen[i - 1] ?? 0) + 0.05 ? [i] : []));

describe("lightning", () => {
  test("strikes while a storm is up: flashes that die away in a fraction of a second, seconds apart", () => {
    const l = new Lightning(7);
    const seen = run(l, 120);
    expect(l.strike).toBeGreaterThan(10);
    expect(l.strike).toBeLessThan(120 / MIN_GAP_S);
    expect(Math.max(...seen)).toBeGreaterThan(0.6);
    expect(Math.max(...seen)).toBeLessThanOrEqual(1);
    // Dark most of the time.
    expect(seen.filter((f) => f > 0.02).length).toBeLessThan(seen.length * 0.15);
    // Three quarters of a second after any pulse begins it's dark again, unless another stroke of the same strike followed.
    const starts = pulses(seen);
    for (const i of starts) if (!starts.some((j) => j > i && j <= i + 45) && i + 45 < seen.length) expect(seen[i + 45]!).toBeLessThan(0.02);
  });

  test("never flashes more than three times in any second (it's gentler: two at most)", () => {
    for (const seed of [1, 2, 3, 99, 20261111]) {
      const starts = pulses(run(new Lightning(seed), 300));
      expect(starts.length).toBeGreaterThan(20);
      for (let i = 0; i < starts.length; i++) {
        const within = starts.filter((s) => s >= starts[i]! && s < starts[i]! + 60).length;
        expect(within).toBeLessThanOrEqual(2);
      }
    }
  });

  test("no storm, no lightning; a weak storm strikes less often than a strong one", () => {
    const calm = new Lightning(3);
    expect(Math.max(...run(calm, 120, 0))).toBe(0);
    expect(Math.max(...run(calm, 120, 0.2))).toBe(0);
    expect(calm.strike).toBe(0);
    const weak = new Lightning(3);
    const strong = new Lightning(3);
    run(weak, 600, 0.4);
    run(strong, 600, 1);
    expect(weak.strike).toBeGreaterThan(0);
    expect(strong.strike).toBeGreaterThan(weak.strike);
  });

  test("under reduced motion nothing flashes, and a flash under way is cut at once", () => {
    const l = new Lightning(5);
    expect(Math.max(...run(l, 300, 1, false))).toBe(0);
    expect(l.strike).toBe(0);
    const m = new Lightning(5);
    while (m.flash < 0.5) m.step(1 / 60, 1, true);
    expect(m.step(1 / 60, 1, false)).toBe(0);
    expect(m.flash).toBe(0);
  });

  test("when the storm passes the last flash still dies away, and no more come", () => {
    const l = new Lightning(11);
    while (l.flash < 0.5) l.step(1 / 60, 1, true);
    const strikes = l.strike;
    const tail = run(l, 30, 0);
    expect(tail[0]!).toBeGreaterThan(0);
    expect(tail.at(-1)).toBe(0);
    expect(Math.max(...tail.slice(60))).toBe(0);
    expect(l.strike).toBe(strikes);
  });

  test("most strikes fall within the view (40° either side of where it looks); some show a bolt, some only light the cloud", () => {
    const l = new Lightning(13);
    let ahead = 0;
    let bolts = 0;
    let last = 0;
    for (let i = 0; i < 60 * 1200; i++) {
      l.step(1 / 60, 1, true, 2);
      if (l.strike !== last) {
        last = l.strike;
        const off = Math.atan2(Math.sin(l.bearing - 2), Math.cos(l.bearing - 2));
        if (Math.abs(off) < 0.7) ahead++;
        if (l.bolt) bolts++;
      }
    }
    expect(last).toBeGreaterThan(100);
    expect(ahead).toBeGreaterThan(last * 0.7);
    expect(bolts).toBeGreaterThan(last * 0.3);
    expect(bolts).toBeLessThan(last * 0.9);
  });

  test("is deterministic: the same seed and steps give the same storm", () => {
    expect(run(new Lightning(42), 60)).toEqual(run(new Lightning(42), 60));
    expect(run(new Lightning(42), 60)).not.toEqual(run(new Lightning(43), 60));
  });
});
