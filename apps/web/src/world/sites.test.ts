import { describe, expect, test } from "bun:test";
import { PADS, SITE_NAMES, SITES, STATIONS } from "@galahad/core/world";
import type { Collider } from "./colliders.ts";
import { FIELD_LEVEL, RUNWAY } from "./field-plan.ts";
import { HALL, HALL_AISLE, HALL_COLLIDERS, HALL_DOOR, inHall } from "./hall-plan.ts";
import { built, obstacles, planPath, plotGate, type Point, roads, standAt } from "./path.ts";
import { onSite, paved, plotLevel, SITE_GATES, SITE_LEVEL, SITE_RECTS } from "./sites.ts";
import { BASE_FLATS, heightAt, KEEP_RADIUS, SEED, WATER_LEVEL, waterAt } from "./terrain.ts";

/*
 * The proving ground and the workshop hall: where they stand, the ground they
 * stand on, and how Galahad gets to them.
 */

const inBox = (c: Collider, x: number, y: number, grow = 0): boolean => {
  if (c.kind === "circle") return Math.hypot(x - c.x, y - c.y) < c.r + grow;
  const cos = Math.cos(-(c.yaw ?? 0));
  const sin = Math.sin(-(c.yaw ?? 0));
  const lx = (x - c.x) * cos - (y - c.y) * sin;
  const ly = (x - c.x) * sin + (y - c.y) * cos;
  return Math.abs(lx) < c.hx + grow && Math.abs(ly) < c.hy + grow;
};

/** Every 20 cm along a path from `from`. */
function* walk(from: Point, path: readonly Point[]): Generator<Point> {
  let a = from;
  for (const b of path) {
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.2));
    for (let i = 0; i <= n; i++) yield { x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n };
    a = b;
  }
}

describe("the test sites", () => {
  test("stand clear of the keep and of each other; every pad is on its own site and no two overlap", () => {
    for (const name of SITE_NAMES) {
      const s = SITES[name];
      // Nearest point of the site to the keep's centre: beyond its lawn.
      const nx = Math.max(s.x - s.w / 2, Math.min(0, s.x + s.w / 2));
      const ny = Math.max(s.y - s.d / 2, Math.min(0, s.y + s.d / 2));
      expect(Math.hypot(nx, ny)).toBeGreaterThan(KEEP_RADIUS + 20);
      for (const station of Object.values(STATIONS)) expect(onSite(station.x, station.y, 20)).toBe(false);
    }
    const [a, b] = [SITES.field, SITES.hall];
    expect(Math.abs(a.x - b.x) > (a.w + b.w) / 2 || Math.abs(a.y - b.y) > (a.d + b.d) / 2).toBe(true);
    for (const pad of PADS) {
      const r = SITE_RECTS[pad.site];
      expect(Math.abs(pad.x - r.x) + pad.size / 2).toBeLessThanOrEqual(r.hx + 1e-9);
      expect(Math.abs(pad.y - r.y) + pad.size / 2).toBeLessThanOrEqual(r.hy + 1e-9);
      for (const other of PADS) {
        if (other === pad) continue;
        const apart = Math.max(Math.abs(pad.x - other.x), Math.abs(pad.y - other.y));
        expect(apart).toBeGreaterThanOrEqual((pad.size + other.size) / 2);
      }
    }
  });

  test("their ground is level at its own height, and dry: the hall at the keep's, the proving ground on its plateau", () => {
    expect(SITE_LEVEL.hall).toBe(0);
    expect(SITE_LEVEL.field).toBe(FIELD_LEVEL);
    for (const name of SITE_NAMES) {
      const r = SITE_RECTS[name];
      for (let i = 0; i <= 10; i++) {
        for (let j = 0; j <= 10; j++) {
          const x = r.x - r.hx + (2 * r.hx * i) / 10;
          const y = r.y - r.hy + (2 * r.hy * j) / 10;
          expect(heightAt(SEED, x, y, BASE_FLATS)).toBe(SITE_LEVEL[name]);
          expect(waterAt(SEED, x, y, BASE_FLATS)).toBe(Number.NEGATIVE_INFINITY);
        }
      }
    }
    for (const pad of PADS) expect(plotLevel(pad)).toBe(SITE_LEVEL[pad.site]);
    expect(plotLevel({ x: 110, y: 110 })).toBe(0);
  });

  test("the plateau is the land's own height there: little is dug or banked up", () => {
    // (The first siting put the proving ground on the lake south of the keep and filled it in.)
    const r = SITE_RECTS.field;
    let sum = 0;
    let n = 0;
    for (let x = r.x - r.hx; x <= r.x + r.hx; x += 10) {
      for (let y = r.y - r.hy; y <= r.y + r.hy; y += 10) {
        sum += heightAt(SEED, x, y, []);
        n++;
      }
    }
    expect(Math.abs(sum / n - FIELD_LEVEL)).toBeLessThan(1);
    // The lake south of the keep is still a lake.
    for (const [x, y] of [[20, -90], [-20, -100], [60, -70]] as const) expect(waterAt(SEED, x, y, BASE_FLATS)).toBe(WATER_LEVEL);
  });

  test("the keep's lawn and the proving ground above it meet in an even slope, with no step", () => {
    // Straight from a point on the lawn to the proving ground's gate, half a metre at a time.
    const g = SITE_GATES.field;
    const from = { x: -32, y: -16 };
    const n = Math.ceil(Math.hypot(g.x - from.x, g.y - from.y) / 0.5);
    let last = heightAt(SEED, from.x, from.y, BASE_FLATS);
    expect(last).toBe(0);
    for (let i = 1; i <= n; i++) {
      const h = heightAt(SEED, from.x + ((g.x - from.x) * i) / n, from.y + ((g.y - from.y) * i) / n, BASE_FLATS);
      expect(Math.abs(h - last)).toBeLessThan(0.35);
      last = h;
    }
    expect(last).toBe(FIELD_LEVEL);
  });

  test("roads run from the keep's stairs to each site's gate, on dry ground he can walk; roads and paving are built ground", () => {
    const from = standAt("keep");
    const out = roads();
    expect(out).toHaveLength(SITE_NAMES.length);
    for (const road of out) {
      expect(road[0]).toEqual({ x: from.x, y: from.y });
      const end = road.at(-1)!;
      expect(Object.values(SITE_GATES).some((gate) => gate.x === end.x && gate.y === end.y)).toBe(true);
      let last: number | null = null;
      for (const p of walk(road[0]!, road.slice(1))) {
        expect(waterAt(SEED, p.x, p.y, BASE_FLATS)).toBe(Number.NEGATIVE_INFINITY);
        const h = heightAt(SEED, p.x, p.y, BASE_FLATS);
        // Never steeper than a stair (rise over run).
        if (last !== null) expect(Math.abs(h - last) / 0.2).toBeLessThan(0.75);
        last = h;
        expect(built(p.x, p.y)).toBe(true);
      }
    }
    expect(paved(RUNWAY.x, RUNWAY.y)).toBe(true);
    expect(built(RUNWAY.x, RUNWAY.y + RUNWAY.hy - 1)).toBe(true);
    expect(built(HALL.x, HALL.y)).toBe(true);
    // Mown grass beside the runway isn't.
    expect(built(RUNWAY.x - RUNWAY.hx - 12, RUNWAY.y + 40)).toBe(false);
  });
});

describe("into the workshop hall", () => {
  const cells = PADS.filter((p) => p.site === "hall");
  const outside: Point[] = [standAt("keep"), standAt("forge"), { x: 110, y: 110 }, { x: 220, y: 4 }, { x: 150, y: -60 }, { x: 60, y: -30 }, SITE_GATES.field, { x: 106, y: 40 }];

  test("a test cell's gate is on the aisle, facing the cell", () => {
    for (const cell of cells) {
      const gate = plotGate(cell);
      expect(inHall(gate.x, gate.y)).toBe(true);
      expect(Math.abs(gate.y - HALL.y)).toBeLessThanOrEqual(HALL_AISLE);
      expect(gate.x).toBe(cell.x);
      // Facing it: towards the cell's centre.
      expect(Math.sign(Math.sin(gate.facing))).toBe(Math.sign(cell.y - gate.y));
    }
  });

  test("he goes in and out by the door, from anywhere, and never through a wall", () => {
    const obs = obstacles();
    for (const start of outside) {
      for (const cell of cells) {
        const gate = plotGate(cell);
        for (const [from, to] of [[start, gate], [gate, start]] as const) {
          const path = planPath(from, to, obs);
          expect(path.at(-1)).toEqual({ x: to.x, y: to.y });
          let throughDoor = false;
          for (const p of walk(from, path)) {
            for (const wall of HALL_COLLIDERS) expect(inBox(wall, p.x, p.y, 0.4)).toBe(false);
            if (Math.abs(p.x - HALL_DOOR.x) < 0.2 && Math.abs(p.y - HALL_DOOR.y) < HALL_DOOR.half - 1) throughDoor = true;
          }
          expect(throughDoor).toBe(true);
        }
      }
    }
  });

  test("from one cell to another he keeps to the aisle", () => {
    const obs = obstacles();
    const a = plotGate(cells[0]!);
    const b = plotGate(cells[3]!);
    const path = planPath(a, b, obs);
    expect(path.at(-1)).toEqual({ x: b.x, y: b.y });
    for (const p of walk(a, path)) {
      expect(inHall(p.x, p.y)).toBe(true);
      for (const cell of cells) expect(Math.max(Math.abs(p.x - cell.x), Math.abs(p.y - cell.y))).toBeGreaterThanOrEqual(cell.size / 2);
    }
  });

  test("outdoors, a walk past the hall goes round it", () => {
    const obs = obstacles();
    const from = { x: 60, y: 6 };
    const to = { x: 160, y: -4 };
    for (const p of walk(from, planPath(from, to, obs))) for (const wall of HALL_COLLIDERS) expect(inBox(wall, p.x, p.y, 0.4)).toBe(false);
  });

  test("pads on a site have no fence to walk round; plots on open land do", () => {
    const view = (plot: { x: number; y: number; size: number }) => ({ plot }) as never;
    const pad = PADS.find((p) => p.id === "flight")!;
    expect(obstacles([view(pad)])).toHaveLength(obstacles().length);
    expect(obstacles([view({ x: 110, y: 110, size: 48 })])).toHaveLength(obstacles().length + 1);
  });
});
