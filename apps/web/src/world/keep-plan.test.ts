import { describe, expect, test } from "bun:test";
import { STATIONS } from "@galahad/core/world";
import type { Mesh } from "three/webgpu";
import { Solids, VIEW, WALK } from "./collide.ts";
import { Keep } from "./keep.ts";
import { fleetColliders, KEEP_COLLIDERS } from "./keep-plan.ts";
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

  test("he can stand at every station: nothing solid where he stands", () => {
    for (const place of PLACES) {
      const s = standAt(place);
      expect(solids.overlaps(s.x, s.y, 0.45 + 0.05, 0.12, 2.55) ? place : "clear").toBe("clear");
      // And the station's own solids are near it (the plan is where the drawing is).
      expect(solids.nearest(STATIONS[place].x, STATIONS[place].y, 12, 0.12, 2.55)).toBeLessThan(12);
    }
  });
});
