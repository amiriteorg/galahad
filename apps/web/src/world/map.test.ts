import { describe, expect, test } from "bun:test";
import { PADS, SITES, STATIONS } from "@galahad/core/world";
import { MAP_VIEW, mapPoint, mapToWorld, sketchLand } from "./map.ts";

describe("the map", () => {
  test("its window holds the keep, both sites and every pad", () => {
    const inside = (x: number, y: number) => {
      const [u, v] = mapPoint(x, y);
      return u > 0 && u < 1 && v > 0 && v < 1;
    };
    for (const s of Object.values(STATIONS)) expect(inside(s.x, s.y)).toBe(true);
    for (const s of Object.values(SITES)) {
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) expect(inside(s.x + (sx * s.w) / 2, s.y + (sy * s.d) / 2)).toBe(true);
    }
    for (const p of PADS) expect(inside(p.x, p.y)).toBe(true);
  });

  test("north is up and east is right; a point on the map and its place in the world agree", () => {
    expect(mapPoint(MAP_VIEW.x, MAP_VIEW.y)).toEqual([0.5, 0.5]);
    expect(mapPoint(MAP_VIEW.x + 100, MAP_VIEW.y)[0]).toBeGreaterThan(0.5);
    expect(mapPoint(MAP_VIEW.x, MAP_VIEW.y + 100)[1]).toBeLessThan(0.5);
    for (const [x, y] of [[0, 0], [-160, -35], [112, 11], [20, -90], [300, 400]] as const) {
      const [u, v] = mapPoint(x, y);
      const [bx, by] = mapToWorld(u, v);
      expect(bx).toBeCloseTo(x, 9);
      expect(by).toBeCloseTo(y, 9);
    }
  });

  test("the sketch shows the lake south of the keep as water and the keep, the hall and the plateau as land, higher where it's higher", () => {
    const n = 80;
    const cells = sketchLand(n);
    expect(cells).toHaveLength(n * n);
    const cell = (x: number, y: number) => {
      const [u, v] = mapPoint(x, y);
      return cells[Math.floor(v * n) * n + Math.floor(u * n)]!;
    };
    expect(cell(20, -90)).toBe(0);
    expect(cell(0, 0)).toBeGreaterThan(0);
    expect(cell(SITES.hall.x, SITES.hall.y)).toBeGreaterThan(0);
    expect(cell(SITES.field.x, SITES.field.y)).toBeGreaterThan(cell(0, 0));
    // Deterministic: the same land every time.
    expect(sketchLand(n)).toEqual(cells);
  });
});
