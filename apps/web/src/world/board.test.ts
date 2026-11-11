import { describe, expect, test } from "bun:test";
import { BOARD_H, BOARD_W } from "@galahad/core/board";
import { STATIONS } from "@galahad/core/world";
import { BOARD_COLLIDERS, BOARD_SPOT, facePoint, overBoard, standFor } from "./board.ts";
import type { Collider } from "./colliders.ts";
import { KEEP_COLLIDERS } from "./keep-plan.ts";

/*
 * The chalkboard in the world: beside the observatory, clear of it; where he
 * stands to write is clear of everything solid (his radius included) and
 * before the spot he writes; every board point lands on the face.
 */

const GALAHAD_R = 0.45;
const BOARD_COLLIDER = BOARD_COLLIDERS[0]!;

/** How far a point is from a collider's footprint (negative inside). */
function distance(c: Collider, x: number, y: number): number {
  if (c.kind === "circle") return Math.hypot(x - c.x, y - c.y) - c.r;
  const yaw = c.yaw ?? 0;
  const dx = x - c.x;
  const dy = y - c.y;
  const u = Math.abs(dx * Math.cos(yaw) + dy * Math.sin(yaw)) - c.hx;
  const v = Math.abs(-dx * Math.sin(yaw) + dy * Math.cos(yaw)) - c.hy;
  return u > 0 || v > 0 ? Math.hypot(Math.max(u, 0), Math.max(v, 0)) : Math.max(u, v);
}

describe("the chalkboard at the observatory", () => {
  test("it stands near the observatory, clear of its platform and of the keep's other solids", () => {
    expect(Math.hypot(BOARD_SPOT.x - STATIONS.observatory.x, BOARD_SPOT.y - STATIONS.observatory.y)).toBeLessThan(8);
    for (const c of KEEP_COLLIDERS) expect(distance(c, BOARD_SPOT.x, BOARD_SPOT.y)).toBeGreaterThan(BOARD_SPOT.width / 2 - 0.2);
  });

  test("where he stands to write, anywhere on the board: before the face, clear of every solid, facing it", () => {
    for (const x of [0, 400, 800, 1200, 1500]) {
      const stand = standFor({ x, w: 100 });
      expect(distance(BOARD_COLLIDER, stand.x, stand.y)).toBeGreaterThan(GALAHAD_R);
      for (const c of KEEP_COLLIDERS) expect(distance(c, stand.x, stand.y)).toBeGreaterThan(GALAHAD_R);
      // In front: on the face's side, and turned to it.
      expect((stand.x - BOARD_SPOT.x) * Math.cos(BOARD_SPOT.facing) + (stand.y - BOARD_SPOT.y) * Math.sin(BOARD_SPOT.facing)).toBeGreaterThan(0.5);
      expect(Math.cos(stand.facing - BOARD_SPOT.facing)).toBeCloseTo(-1);
    }
  });

  test("board points land on the face: left to right along it, top to bottom down it", () => {
    const a = { x: 0, y: 0, z: 0 };
    const b = { x: 0, y: 0, z: 0 };
    facePoint(0, 0, a);
    facePoint(BOARD_W, BOARD_H, b);
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(BOARD_SPOT.width, 2);
    expect(a.z).toBeGreaterThan(b.z);
    expect(b.z).toBeGreaterThan(0.5);
    expect(a.z).toBeLessThan(2.5);
  });

  test("hovering or tapping it: the ground before it and behind its face, not the observatory", () => {
    expect(overBoard(BOARD_SPOT.x, BOARD_SPOT.y)).toBe(true);
    expect(overBoard(BOARD_SPOT.x - Math.cos(BOARD_SPOT.facing) * 2.5, BOARD_SPOT.y - Math.sin(BOARD_SPOT.facing) * 2.5)).toBe(true);
    expect(overBoard(STATIONS.observatory.x, STATIONS.observatory.y)).toBe(false);
  });
});
