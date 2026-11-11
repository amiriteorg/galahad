import { describe, expect, test } from "bun:test";
import { STATIONS } from "@galahad/core/world";
import type { Mesh } from "three/webgpu";
import { Solids, VIEW, WALK } from "./collide.ts";
import { Keep } from "./keep.ts";
import { fleetColliders, KEEP_COLLIDERS, STAIR_COLLIDERS, STAIRS, tread } from "./keep-plan.ts";
import { PLACES, standAt } from "./path.ts";

/*
 * The keep's solids against the keep as it's drawn: everything a walker could
 * walk into stands inside a footprint, everything the camera could fly into
 * inside a volume, and no footprint reaches far past what's there. The
 * stations' standing places are clear.
 */

/**
 * Every visible vertex of a freshly built keep, in the world (x east, y north, z up), with a few nodes in its
 * fleet; and points all over its faces, at most 0.35 m apart, in 0.5 m cells (their heights), for asking
 * what's drawn near a place.
 */
function drawn(): { vertices: Float64Array; surface: Map<number, number[]> } {
  const keep = new Keep(false, 0);
  keep.setNodes([0, 1, 2, 3].map((i) => ({ id: `n${i}`, name: `n${i}`, kind: "node", online: true, self: i === 0, sandboxHost: i === 1 })) as never);
  keep.group.updateMatrixWorld(true);
  const out: number[] = [];
  const surface = new Map<number, number[]>();
  keep.group.traverseVisible((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const p = mesh.geometry.getAttribute("position");
    const e = mesh.matrixWorld.elements;
    const first = out.length;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);
      out.push(e[0]! * x + e[4]! * y + e[8]! * z + e[12]!, -(e[2]! * x + e[6]! * y + e[10]! * z + e[14]!), e[1]! * x + e[5]! * y + e[9]! * z + e[13]!);
    }
    const index = mesh.geometry.getIndex();
    const corners = index ? index.count : p.count;
    const v = (k: number) => first + (index ? index.getX(k) : k) * 3;
    for (let k = 0; k + 2 < corners; k += 3) {
      const [a, b, c] = [v(k), v(k + 1), v(k + 2)];
      const edge = Math.max(Math.hypot(out[a]! - out[b]!, out[a + 1]! - out[b + 1]!, out[a + 2]! - out[b + 2]!), Math.hypot(out[a]! - out[c]!, out[a + 1]! - out[c + 1]!, out[a + 2]! - out[c + 2]!), Math.hypot(out[b]! - out[c]!, out[b + 1]! - out[c + 1]!, out[b + 2]! - out[c + 2]!));
      const n = Math.max(1, Math.ceil(edge / 0.35));
      for (let i = 0; i <= n; i++) {
        for (let j = 0; i + j <= n; j++) {
          const u = i / n;
          const w = j / n;
          const at = (d: number) => out[a + d]! * (1 - u - w) + out[b + d]! * u + out[c + d]! * w;
          const key = Math.floor(at(0) / 0.5) * 100000 + Math.floor(at(1) / 0.5);
          let list = surface.get(key);
          if (!list) surface.set(key, (list = []));
          list.push(at(0), at(1), at(2));
        }
      }
    }
  });
  keep.dispose();
  return { vertices: Float64Array.from(out), surface };
}

const solids = new Solids();
solids.add([...KEEP_COLLIDERS, ...fleetColliders([false, true, false, false])]);
const { vertices, surface } = drawn();
/** How far past a footprint or a volume a drawn vertex may be (lumpy stone, a bevel). */
const TOLERANCE = 0.15;

describe("the keep's solids", () => {
  test("whatever stands in a walker's way is inside a footprint", () => {
    const misses: string[] = [];
    for (let i = 0; i < vertices.length; i += 3) {
      const [x, y, z] = [vertices[i]!, vertices[i + 1]!, vertices[i + 2]!];
      // Above the paths and plazas, up to his head.
      if (z < 0.22 || z > 2.4) continue;
      const n = solids.around(x - 1, y - 1, x + 1, y + 1);
      let inside = false;
      for (let k = 0; k < n && !inside; k++) {
        const s = solids.found[k]!;
        inside = (solids.mask[s]! & WALK) !== 0 && solids.lo[s]! < 2.5 && solids.gap(s, x, y) < TOLERANCE;
      }
      if (!inside) misses.push(`${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)}`);
    }
    expect(misses.slice(0, 20)).toEqual([]);
  });

  test("whatever the camera could fly into is inside a volume it keeps out of", () => {
    const misses: string[] = [];
    for (let i = 0; i < vertices.length; i += 3) {
      const [x, y, z] = [vertices[i]!, vertices[i + 1]!, vertices[i + 2]!];
      // The camera is never lower than this over the keep's ground.
      if (z < 1.8) continue;
      const n = solids.around(x - 1, y - 1, x + 1, y + 1);
      let inside = false;
      for (let k = 0; k < n && !inside; k++) {
        const s = solids.found[k]!;
        inside = (solids.mask[s]! & VIEW) !== 0 && solids.far(s, x, y, z, TOLERANCE) === 0;
      }
      if (!inside) misses.push(`${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)}`);
    }
    expect(misses.slice(0, 20)).toEqual([]);
  });

  test("no footprint reaches far past what's drawn", () => {
    // From points round each footprint's edge (a little inside it), something drawn is near.
    const near = (x: number, y: number, lo: number, hi: number, d: number): boolean => {
      for (let cx = Math.floor((x - d) / 0.5); cx <= Math.floor((x + d) / 0.5); cx++) {
        for (let cy = Math.floor((y - d) / 0.5); cy <= Math.floor((y + d) / 0.5); cy++) {
          const list = surface.get(cx * 100000 + cy) ?? [];
          for (let i = 0; i < list.length; i += 3) {
            const z = list[i + 2]!;
            if (z >= lo - 0.3 && z <= hi + 0.3 && Math.hypot(list[i]! - x, list[i + 1]! - y) < d) return true;
          }
        }
      }
      return false;
    };
    const loose: string[] = [];
    for (const c of KEEP_COLLIDERS) {
      if (c.stops === "camera") continue;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        let x: number;
        let y: number;
        if (c.kind === "circle") {
          const r = Math.max(0, c.r - 0.2);
          x = c.x + Math.cos(a) * r;
          y = c.y + Math.sin(a) * r;
        } else {
          const lx = Math.cos(a) * Math.max(0, c.hx - 0.2) * Math.SQRT2;
          const ly = Math.sin(a) * Math.max(0, c.hy - 0.2) * Math.SQRT2;
          const qx = Math.max(-c.hx + 0.2, Math.min(c.hx - 0.2, lx));
          const qy = Math.max(-c.hy + 0.2, Math.min(c.hy - 0.2, ly));
          const yaw = c.yaw ?? 0;
          x = c.x + qx * Math.cos(yaw) - qy * Math.sin(yaw);
          y = c.y + qx * Math.sin(yaw) + qy * Math.cos(yaw);
        }
        if (!near(x, y, c.bottom ?? 0, c.top ?? 99, 0.65)) loose.push(`${c.kind} at ${c.x.toFixed(1)},${c.y.toFixed(1)}: ${x.toFixed(1)},${y.toFixed(1)}`);
      }
    }
    expect(loose).toEqual([]);
  });

  test("the stairs' stringers, handrails and posts run with the steps, 0.74 m either side of them, from the deck to the ground", () => {
    // In the stairs' own frame: along them from the deck's edge, and across them.
    const { top, foot, run } = STAIRS;
    const ux = (foot[0] - top[0]) / run;
    const uz = (foot[1] - top[1]) / run;
    const off: string[] = [];
    let lowest = Infinity;
    let highest = -Infinity;
    // The deck's braces (keep.ts: by a, then pitched about the scene's x), one of which passes close by the stairs' side.
    const braces = [0, 1, 2, 3].map((i) => {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      return { c: [Math.sin(a) * 3.4, STAIRS.deck - 0.9, Math.cos(a) * 3.4], v: [Math.sin(a), -Math.sin(0.5) * Math.cos(a), Math.cos(0.5) * Math.cos(a)] };
    });
    const onBrace = (x: number, y: number, z: number) =>
      braces.some(({ c, v }) => {
        const d = [x - c[0]!, y - c[1]!, z - c[2]!];
        const k = d[0]! * v[0]! + d[1]! * v[1]! + d[2]! * v[2]!;
        return Math.abs(k) < 2.3 && Math.hypot(d[0]! - v[0]! * k, d[1]! - v[1]! * k, d[2]! - v[2]! * k) < 0.25;
      });
    // Every point over the drawn faces (a stringer's box has corners only at its ends).
    const points: number[] = [];
    for (const list of surface.values()) points.push(...list);
    for (let i = 0; i < points.length; i += 3) {
      // Scene coordinates of the keep's frame: x east, z south (the world's −y).
      const sx = points[i]! - top[0];
      const sz = -points[i + 1]! - top[1];
      const y = points[i + 2]!;
      const along = sx * ux + sz * uz;
      const across = -sx * uz + sz * ux;
      // Between the stringers' undersides and the handrails' tops, within a metre of the middle: the stairs (not the deck's rim or its braces).
      const line = STAIRS.deck * (1 - along / run);
      if (along < 0.5 || along > run - 0.3 || Math.abs(across) > 1.0 || y < 0.3 || y > STAIRS.deck - 0.2 || y < line - 0.3 || y > line + 1.05) continue;
      // (Nor the deck's rim beside their top, nor the landing from it.)
      if (Math.hypot(points[i]!, points[i + 1]!) < 6.45 && y > STAIRS.deck - 0.5) continue;
      // The treads themselves (and nothing else) lie within their width.
      if (Math.abs(across) <= STAIRS.tread.w / 2 + 0.01 || onBrace(points[i]!, y, -points[i + 1]!)) continue;
      if (Math.abs(Math.abs(across) - 0.74) > 0.07) off.push(`${along.toFixed(2)} along, ${across.toFixed(2)} across, ${y.toFixed(2)} up`);
      lowest = Math.min(lowest, y);
      highest = Math.max(highest, y);
    }
    expect(off.slice(0, 10)).toEqual([]);
    // The stringers come down to the ground at the foot and up to the deck at the top.
    expect(lowest).toBeLessThan(0.45);
    expect(highest).toBeGreaterThan(STAIRS.deck - 0.4);
  });

  test("the stairs' solids are the stairs as drawn: every tread's top where it's drawn, everything drawn inside one, none reaching past it", () => {
    const { top, foot, run } = STAIRS;
    const ux = (foot[0] - top[0]) / run;
    const uz = (foot[1] - top[1]) / run;
    const stairs = new Solids();
    stairs.add(STAIR_COLLIDERS);
    // The drawn stairs: points on their faces in the slab from the stringers' undersides to the handrails' tops.
    const points: number[] = [];
    for (const list of surface.values()) {
      for (let i = 0; i < list.length; i += 3) {
        const sx = list[i]! - top[0];
        const sz = -list[i + 1]! - top[1];
        const y = list[i + 2]!;
        const along = sx * ux + sz * uz;
        const across = -sx * uz + sz * ux;
        const line = STAIRS.deck * (1 - along / run);
        if (along < 0.3 || along > run - 0.2 || Math.abs(across) > 0.8 || y < line - 0.3 || y > line + 1.05) continue;
        // (The top treads run in under the deck's rim: what's of the deck there isn't the stairs'.)
        const k = Math.min(STAIRS.steps - 1, Math.floor((along / run) * STAIRS.steps));
        const onTread = Math.abs(across) <= STAIRS.tread.w / 2 && Math.abs(along - ((k + 0.5) * run) / STAIRS.steps) <= STAIRS.tread.d / 2 && Math.abs(y - tread(k).top) < 0.01;
        if (Math.hypot(list[i]!, list[i + 1]!) < 6.45 && y > STAIRS.deck - 0.5 && !onTread) continue;
        points.push(list[i]!, list[i + 1]!, y);
      }
    }
    const outside: string[] = [];
    for (let i = 0; i < points.length; i += 3) {
      const [x, y, z] = [points[i]!, points[i + 1]!, points[i + 2]!];
      const n = stairs.around(x - 1, y - 1, x + 1, y + 1);
      let inside = false;
      for (let k = 0; k < n && !inside; k++) inside = stairs.far(stairs.found[k]!, x, y, z, 0.02) === 0;
      if (!inside) outside.push(`${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)}`);
    }
    expect(outside.slice(0, 10)).toEqual([]);
    // Each tread's solid tops out where its board does, and spans no more than its board.
    for (let i = 0; i < STAIRS.steps; i++) {
      const t = tread(i);
      const c = STAIR_COLLIDERS[i * 3]!;
      expect(c.kind === "box" && c.top !== undefined && Math.abs(c.top - t.top) < 1e-9 && Math.abs(c.hx - STAIRS.tread.w / 2) < 1e-9 && Math.abs(c.hy - STAIRS.tread.d / 2) < 1e-9).toBe(true);
      // The drawn board's top surface is there.
      const at = points.filter((_, k) => k % 3 === 0).some((_, k) => Math.abs(points[k * 3 + 2]! - t.top) < 0.005 && Math.hypot(points[k * 3]! - c.x, points[k * 3 + 1]! - c.y) < 0.3);
      expect(at ? i : `tread ${i} not drawn at ${t.top.toFixed(2)}`).toBe(i);
    }
    // No stair solid reaches past what's drawn: from just inside each corner, something drawn is within 0.1 m.
    const all: number[] = [];
    for (const list of surface.values()) all.push(...list);
    const loose: string[] = [];
    for (const c of STAIR_COLLIDERS) {
      if (c.kind !== "box") continue;
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
        const lx = sx * (c.hx - 0.02);
        const ly = sy * (c.hy - 0.02);
        const yaw = c.yaw ?? 0;
        const x = c.x + lx * Math.cos(yaw) - ly * Math.sin(yaw);
        const y = c.y + lx * Math.sin(yaw) + ly * Math.cos(yaw);
        let near = false;
        for (let i = 0; i < all.length && !near; i += 3) near = Math.hypot(all[i]! - x, all[i + 1]! - y) < 0.1 && all[i + 2]! >= (c.bottom ?? 0) - 0.05 && all[i + 2]! <= c.top! + 0.05;
        if (!near) loose.push(`${x.toFixed(2)},${y.toFixed(2)} (${(c.bottom ?? 0).toFixed(2)}–${c.top!.toFixed(2)})`);
      }
    }
    expect(loose).toEqual([]);
  });

  test("he can stand at every station: nothing solid where he stands", () => {
    for (const place of PLACES) {
      const s = standAt(place);
      expect(solids.overlaps(s.x, s.y, 0.45 + 0.05, 0.12, 2.55) ? place : "clear").toBe("clear");
      // And the station's own solids are near it (the plan is where the drawing is).
      expect(solids.nearest(STATIONS[place].x, STATIONS[place].y, 12, 0.12, 2.55)).toBeLessThan(12);
    }
  });
});
