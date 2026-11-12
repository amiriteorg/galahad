import { describe, expect, test } from "bun:test";
import { cycleFailures, ecoWorld, type FoxAndHare, TIER_CAPS, years } from "./eco.ts";
import { buildMap, wet } from "./map.ts";
import { buildGrid, pathLength, type Point, ReferenceSearch } from "./reference.ts";
import { apart, elongation, moonPlace, referenceMoon, referenceSun, sunPlace } from "./sky.ts";

/*
 * What the world-algorithms suite measures with: the reference search the
 * planner is held against, the references for the sky, and the ecosystem's
 * harness. And, held here until they're fixed in the world's own code, the two
 * defects of the planner the suite found on the real map.
 */

describe("the reference search", () => {
  const open = (blocked: (x: number, y: number) => boolean) => {
    const grid = buildGrid({ x0: 0, y0: 0, x1: 40, y1: 40 }, 0.5, blocked);
    // In plain sight: no blocked cell under the line, sampled finely.
    const clear = (ax: number, ay: number, bx: number, by: number): boolean => {
      const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / 0.1);
      for (let s = 0; s <= steps; s++) if (blocked(ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps)) return false;
      return true;
    };
    const cell = (x: number, y: number): number => Math.floor(y / 0.5) * grid.nx + Math.floor(x / 0.5);
    return { grid, search: new ReferenceSearch(grid, clear), cell };
  };

  test("across open ground the shortest way is the straight line", () => {
    const { search, cell } = open(() => false);
    const way = search.path(cell(2.25, 2.25), cell(30.25, 20.25))!;
    expect(way).toHaveLength(2);
    expect(pathLength(way)).toBeCloseTo(Math.hypot(28, 18), 9);
  });

  test("round a wall it goes by the nearer end, to within a cell of the true shortest", () => {
    // A wall from y = 5 to y = 30 at x = 20, half a metre thick.
    const wall = (x: number, y: number): boolean => x >= 19.75 && x <= 20.25 && y >= 5 && y <= 30;
    const { search, cell } = open(wall);
    const way = search.path(cell(10.25, 10.25), cell(30.25, 10.25))!;
    // Round its southern end at (20, 5): the true shortest touches that corner.
    const shortest = Math.hypot(10, 5.25) * 2;
    expect(pathLength(way)).toBeGreaterThanOrEqual(shortest - 1e-9);
    expect(pathLength(way)).toBeLessThan(shortest * 1.03);
    for (const p of way) expect(wall(p.x, p.y)).toBe(false);
  });

  test("walled in, there is no way; and it says so every time it's asked", () => {
    const box = (x: number, y: number): boolean => Math.max(Math.abs(x - 20), Math.abs(y - 20)) < 6 && Math.max(Math.abs(x - 20), Math.abs(y - 20)) > 5;
    const { search, cell } = open(box);
    expect(search.path(cell(20.25, 20.25), cell(2.25, 2.25))).toBeNull();
    expect(search.path(cell(2.25, 2.25), cell(20.25, 20.25))).toBeNull();
    expect(search.path(cell(2.25, 2.25), cell(38.25, 38.25))).not.toBeNull();
    // From a blocked cell there's nowhere to start.
    expect(search.path(cell(20.25, 14.25), cell(2.25, 2.25))).toBeNull();
  });
});

describe("the references for the sky", () => {
  const at = (iso: string): number => Date.parse(iso);

  test("the sun: at the solstice its longitude is 90° and it stands 23.44° north; at the equinox it's on the equator", () => {
    const solstice = sunPlace(at("2026-06-21T08:24:00Z"));
    expect(Math.abs(solstice.lambda - 90)).toBeLessThan(0.02);
    expect(Math.abs(solstice.dec - 23.44)).toBeLessThan(0.01);
    expect(Math.abs(sunPlace(at("2026-03-20T14:46:00Z")).dec)).toBeLessThan(0.02);
    // Solar noon in Copenhagen at midwinter is about 11:08 UTC: due south, 10.9° up.
    const noon = referenceSun(at("2026-12-21T11:08:00Z"));
    expect(Math.abs(noon.az - 180)).toBeLessThan(0.5);
    expect(Math.abs(noon.alt - (90 - 55.676 - 23.44))).toBeLessThan(0.1);
  });

  test("the moon: new at the solar eclipse of 12 August 2026 and full at the lunar eclipse of 3 March, on the ecliptic at both", () => {
    // New moon was 17:37 UT; the sun and the moon pass within a degree as seen from the Earth's centre.
    expect(elongation(at("2026-08-12T17:37:00Z"))).toBeLessThan(1.2);
    expect(Math.abs(moonPlace(at("2026-08-12T17:37:00Z")).beta)).toBeLessThan(1.2);
    // Full moon was 11:38 UT, in the Earth's shadow.
    expect(180 - elongation(at("2026-03-03T11:38:00Z"))).toBeLessThan(0.8);
    expect(Math.abs(moonPlace(at("2026-03-03T11:38:00Z")).beta)).toBeLessThan(0.8);
    // A week on it's a quarter of the way round.
    expect(Math.abs(elongation(at("2026-08-20T02:00:00Z")) - 90)).toBeLessThan(8);
    // Its parallax is about a degree, so from Copenhagen it stands lower than from the Earth's centre, never by more.
    const p = moonPlace(at("2026-08-20T02:00:00Z")).parallax;
    expect(p).toBeGreaterThan(0.89);
    expect(p).toBeLessThan(1.03);
  });

  test("the angle between two directions: along the horizon, up the meridian, and none", () => {
    expect(apart({ alt: 0, az: 10 }, { alt: 0, az: 11 })).toBeCloseTo(60, 6);
    expect(apart({ alt: 10, az: 0 }, { alt: 12, az: 0 })).toBeCloseTo(120, 6);
    expect(apart({ alt: 33, az: 200 }, { alt: 33, az: 200 })).toBe(0);
    // Near the zenith a degree of bearing is little.
    expect(apart({ alt: 89, az: 0 }, { alt: 89, az: 90 })).toBeLessThan(90);
    // Seen from Copenhagen the moon is within its parallax of where the Earth's centre sees it, and never above it by much.
    expect(referenceMoon(at("2026-08-20T02:00:00Z")).alt).toBeLessThan(90);
  });
});

describe("the ecosystem's harness", () => {
  test("a year of living is its steps, sampled as asked; the same seed lives the same year", () => {
    const run = (seed: number): string => {
      const { eco, env } = ecoWorld(TIER_CAPS.low, { seed, yearDays: 36, year: 0.3 });
      let samples = 0;
      const steps = years(eco, env, 0.05, 0.3, () => samples++, 40);
      expect(steps).toBe(Math.round(0.05 * (36 / eco.pace / 0.5)));
      expect(samples).toBe(2);
      return [...eco.count].join(",");
    };
    expect(run(5)).toBe(run(5));
  });

  test("what the world's own test asks of the fox and the hare: a series that does it all passes, one that never falls doesn't", () => {
    const cycle: FoxAndHare = { hares: [70, 60, 40, 20, 8, 10, 30, 55, 70, 72], foxes: [3, 6, 9, 10, 9, 6, 4, 3, 2, 3], tied: -0.6, caught: 300, otherwise: 100 };
    expect(cycleFailures(cycle)).toEqual([]);
    const flat: FoxAndHare = { hares: [60, 62, 61, 63, 60, 62], foxes: [1, 1, 1, 1, 1, 1], tied: 0.02, caught: 10, otherwise: 100 };
    const failed = cycleFailures(flat);
    expect(failed).toContain("hares never fell by half");
    expect(failed).toContain("foxes never reached 9");
    expect(failed.some((f) => f.startsWith("not tied"))).toBe(true);
    expect(failed).toContain("most hares that died weren't caught");
  });
});

describe("the planner on the real map (found by bun run bench world-algorithms)", () => {
  const map = buildMap();
  const w = map.walker;
  const route = (ax: number, ay: number, bx: number, by: number): { found: boolean; legs: Point[] } => {
    const out: Point[] = [];
    const found = map.planner.route(ax, ay, bx, by, w, wet, out);
    return { found, legs: [{ x: ax, y: ay }, ...out] };
  };
  /** Legs of a way that the planner's own check of a straight leg refuses. */
  const refused = (legs: Point[]): number => {
    let bad = 0;
    for (let i = 1; i < legs.length; i++) if (!map.planner.clear(legs[i - 1]!.x, legs[i - 1]!.y, legs[i]!.x, legs[i]!.y, w, wet)) bad++;
    return bad;
  };

  test("between stations it gives ways whose every leg is clear", () => {
    for (const [ax, ay, bx, by] of [[-40.25, -30.25, 38.25, 20.75], [12.25, -44.25, -30.75, 40.25], [-100.75, -129.75, -101.75, -103.25]] as const) {
      const { found, legs } = route(ax, ay, bx, by);
      expect(found).toBe(true);
      expect(refused(legs)).toBe(0);
    }
  });

  // On a long way the planner's grid is coarse (its cells up to 2.5 m): two neighbouring cells can both be free with
  // something thin between their middles, and the hop between them is never swept. Leg 13 of this way, from
  // (-21.3, 5.1) to (-21.3, 7.6), goes through a solid by the keep. To fix in nav.ts' grid(): sweep each hop of the
  // cells' way before it's pulled taut (or grow what's drawn into a coarse grid by half the cell's extra size).
  test.failing("a long way across the home ground has no leg through something solid", () => {
    const { found, legs } = route(99.75, -141.25, 26.25, 109.75);
    expect(found).toBe(true);
    expect(refused(legs)).toBe(0);
  });

  // East of the keep the water runs for 300 m: from one bank to the other is 115 m as the crow flies and 443 m on
  // foot (the reference search finds it). The planner looks 10, 40 and 120 m round the blocked part of the line,
  // finds nothing and says there's no way. To fix in nav.ts' route(): one more, wider look (or plan from each end
  // towards the nearest dry crossing).
  test.failing("it finds the way round the water east of the keep", () => {
    expect(route(89.75, -107.25, 147.75, -7.75).found).toBe(true);
  });
});
