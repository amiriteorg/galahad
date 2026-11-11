import { describe, expect, test } from "bun:test";
import { emptyDrivers, GROW, heatherBloom, partScale, seasonDrivers, TINT } from "./flora-season.ts";
import { emptySeason, seasonAt, seasonFor, seasonOf } from "./season.ts";

/*
 * What the season does to what grows: the amounts the shaders read, through the
 * year. Leaves out in spring and down by December, birches yellow first,
 * conifers never; flowers only in their weeks; heather in late August; grass
 * that pales; leaves lying under the trees; and nothing that jumps from one day
 * to the next.
 */

const at = (month: number, day: number) => seasonDrivers(seasonAt(Date.UTC(2026, month - 1, day, 11)));
const day = (n: number) => seasonDrivers(seasonOf((n + 0.5) / 365));

describe("the season's amounts", () => {
  test("midsummer: every leaf out and lime, the meadows in flower, no twigs showing, nothing on the ground", () => {
    const d = seasonDrivers(seasonFor("summer", 0));
    expect(d.grow[GROW.leaf]).toBe(1);
    expect(d.grow[GROW.twig]).toBe(0);
    expect(d.tint[TINT.leaf]).toBe(0);
    expect(d.tint[TINT.earlyLeaf]).toBe(0);
    expect(d.tint[TINT.grass]!).toBeLessThan(0.02);
    expect(d.grow[GROW.flower]!).toBeGreaterThan(0.9);
    expect(d.grow[GROW.long]).toBe(1);
    expect(d.grow[GROW.litter]).toBe(0);
    expect(d.grow[GROW.autumn]).toBe(0);
    expect(d.grow[GROW.blossom]).toBe(0);
    expect(d.grass[3]!).toBeLessThan(0.02);
    expect(d.litter[3]).toBe(0);
    // What the summer world was before it had seasons: nothing tinted, everything there.
    expect(d.tint[TINT.none]).toBe(0);
    expect(d.grow[GROW.none]).toBe(1);
  });

  test("the height of autumn: the leaves turned and thinning, birches ahead of the oaks, alders behind; mushrooms up; leaves on the ground", () => {
    const d = seasonDrivers(seasonFor("autumn", 0));
    expect(d.tint[TINT.leaf]!).toBeGreaterThan(0.9);
    expect(d.tint[TINT.earlyLeaf]).toBe(1);
    expect(d.tint[TINT.lateLeaf]!).toBeLessThan(d.tint[TINT.leaf]!);
    expect(d.grow[GROW.leaf]!).toBeGreaterThan(0.5);
    expect(d.grow[GROW.leaf]!).toBeLessThan(1);
    expect(d.grow[GROW.autumn]).toBe(1);
    expect(d.grow[GROW.litter]!).toBeGreaterThan(0.1);
    expect(d.tint[TINT.grass]!).toBeGreaterThan(0.4);
    // While they're turning, the birches are always further on.
    for (let n = 258; n < 288; n += 3) {
      const e = day(n);
      expect(e.tint[TINT.earlyLeaf]!).toBeGreaterThan(e.tint[TINT.leaf]!);
      expect(e.tint[TINT.lateLeaf]!).toBeLessThanOrEqual(e.tint[TINT.leaf]!);
    }
  });

  test("11 November: a third of the leaves left, all of them turned, the ground deep in them", () => {
    const d = at(11, 11);
    expect(d.grow[GROW.leaf]!).toBeGreaterThan(0.2);
    expect(d.grow[GROW.leaf]!).toBeLessThan(0.4);
    expect(d.tint[TINT.leaf]).toBe(1);
    expect(d.grow[GROW.litter]!).toBeGreaterThan(0.8);
    expect(d.grow[GROW.flower]).toBe(0);
    expect(d.litter[3]!).toBeGreaterThan(0.8);
  });

  test("midwinter: bare crowns with their twigs, no flowers, pale grass, straw reeds; conifers keep their needles", () => {
    const d = seasonDrivers(seasonFor("winter", 0));
    expect(d.grow[GROW.leaf]).toBe(0);
    expect(d.grow[GROW.twig]).toBe(1);
    for (const k of [GROW.flower, GROW.spring, GROW.blossom, GROW.autumn, GROW.long]) expect(d.grow[k]).toBe(0);
    expect(d.tint[TINT.grass]!).toBeGreaterThan(0.9);
    expect(d.tint[TINT.reed]!).toBeGreaterThan(0.9);
    expect(d.grow[GROW.litter]).toBe(1);
    // (A conifer's needles are a tint, never an amount: they're always there.)
    expect(d.tint[TINT.needle]!).toBeGreaterThan(0.9);
    expect(d.grow[GROW.none]).toBe(1);
  });

  test("spring: blossom on the trees and anemones on the woodland floor while the buds open; fresh green", () => {
    const d = seasonDrivers(seasonFor("spring", 0));
    expect(d.grow[GROW.blossom]).toBe(1);
    expect(d.grow[GROW.spring]).toBe(1);
    expect(d.grow[GROW.long]).toBe(1);
    expect(d.grow[GROW.leaf]!).toBeGreaterThan(0.02);
    expect(d.grow[GROW.leaf]!).toBeLessThan(0.4);
    expect(d.fresh).toBeGreaterThan(0.8);
    expect(d.tint[TINT.leaf]).toBe(0);
    // By June the blossom and the anemones are over.
    expect(at(6, 10).grow[GROW.blossom]).toBe(0);
    expect(at(6, 10).grow[GROW.spring]).toBe(0);
  });

  test("the heather flowers late in August, and at no other time", () => {
    expect(heatherBloom(238 / 365)).toBe(1);
    expect(at(8, 26).tint[TINT.heather]).toBe(1);
    expect(at(8, 26).heath[3]!).toBeGreaterThan(0.6);
    for (const [m, d] of [[1, 15], [4, 15], [6, 15], [7, 10], [10, 25], [12, 1]] as const) expect(at(m, d).tint[TINT.heather]).toBe(0);
    // In flower the heath is mauve (more red and blue than green); out of flower, never.
    const bloom = at(8, 26).heath;
    expect(Math.min(bloom[0]!, bloom[2]!)).toBeGreaterThan(bloom[1]!);
    const autumn = at(10, 25).heath;
    expect(autumn[2]!).toBeLessThan(autumn[1]!);
  });

  test("every amount stays within 0 and 1, all year", () => {
    for (let n = 0; n < 365; n++) {
      const d = day(n);
      for (const v of [...d.tint, ...d.grow, d.fresh, d.grass[3]!, d.heath[3]!, d.litter[3]!, d.marsh[3]!]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      for (const w of d.width) {
        expect(w).toBeGreaterThan(0.1);
        expect(w).toBeLessThanOrEqual(1);
      }
    }
  });

  test("nothing pops: from one hour to the next no part grows, shrinks or changes colour by more than a trace, the year round", () => {
    const step = 1 / (365 * 24);
    let prev = seasonDrivers(seasonOf(1 - step));
    let worstGrow = 0;
    let worstTint = 0;
    let worstGround = 0;
    for (let y = 0; y < 1; y += step) {
      const d = seasonDrivers(seasonOf(y));
      for (let k = 0; k < d.grow.length; k++) {
        // Each part in its own turn: the first, the middle and the last of the queue.
        for (const key of [0, 0.25, 0.5, 0.75, 0.999]) worstGrow = Math.max(worstGrow, Math.abs(partScale(d.grow[k]!, d.width[k]!, key) - partScale(prev.grow[k]!, prev.width[k]!, key)));
        worstTint = Math.max(worstTint, Math.abs(d.tint[k]! - prev.tint[k]!));
      }
      for (const g of ["grass", "heath", "litter", "marsh"] as const) for (let i = 0; i < 4; i++) worstGround = Math.max(worstGround, Math.abs(d[g][i]! * (i < 3 ? d[g][3]! : 1) - prev[g][i]! * (i < 3 ? prev[g][3]! : 1)));
      worstGround = Math.max(worstGround, Math.abs(d.fresh - prev.fresh));
      prev = d;
    }
    // (A flower takes days to open and a leaf days to fall: an hour is a hundredth of that.)
    expect(worstGrow).toBeLessThan(0.03);
    expect(worstTint).toBeLessThan(0.01);
    expect(worstGround).toBeLessThan(0.01);
  });

  test("parts take their turns: with a narrow width they come one after another, with a wide one together", () => {
    // Half the leaves fallen: the first in the queue are all there (smaller, now that fewer are left), the last gone.
    expect(partScale(0.5, 0.3, 0)).toBeCloseTo(0.825, 9);
    expect(partScale(0.5, 0.3, 0.999)).toBe(0);
    expect(partScale(0.98, 0.3, 0)).toBeGreaterThan(0.99);
    // Buds: every one a little out, and seen as soon as they break (a tenth of the way to leaf, a fifth of their size).
    expect(partScale(0.3, 1, 0)).toBeCloseTo(partScale(0.3, 1, 0.999), 9);
    expect(partScale(0.1, 1, 0.5)).toBeGreaterThan(0.18);
    expect(partScale(0.1, 1, 0.5)).toBeLessThan(0.3);
    // All there at 1, none at 0, whatever the turn and the width.
    for (const w of [0.2, 0.5, 1]) {
      for (const key of [0, 0.4, 0.999]) {
        expect(partScale(1, w, key)).toBe(1);
        expect(partScale(0, w, key)).toBe(0);
      }
    }
  });

  test("it writes into what it's given, and allocates nothing", () => {
    const out = emptyDrivers();
    const s = emptySeason();
    expect(seasonDrivers(seasonOf(0.8, s), out)).toBe(out);
    expect(out.tint[TINT.leaf]!).toBeGreaterThan(0.5);
  });
});
