import { SITES } from "@galahad/core/world";
import type { Collider, Rect } from "./colliders.ts";

/*
 * The workshop hall's plan: where its walls, door and aisle are, as the land,
 * the walkers and the camera need to know them. The contract (core's SITES and
 * PADS) fixes the hall's rectangle and its test cells; everything else about
 * the plan lives here. Pure data, so the path planner and the tests can read it
 * without the renderer.
 */

const S = SITES.hall;

/** The hall's floor: wall to wall. */
export const HALL: Rect = { x: S.x, y: S.y, hx: S.w / 2, hy: S.d / 2 };

/** Walls this thick, standing on the floor's edge. */
export const HALL_WALL = 0.6;
/** The eaves' height (the roof rises above it). */
export const HALL_EAVES = 9;

/** The door: in the west wall, facing the keep, this wide, always open. */
export const HALL_DOOR = { x: HALL.x - HALL.hx, y: HALL.y, half: 6 };
/** Just outside and just inside the door, on its centre line. */
export const HALL_DOOR_OUT = { x: HALL_DOOR.x - 4, y: HALL_DOOR.y };
export const HALL_DOOR_IN = { x: HALL_DOOR.x + 4, y: HALL_DOOR.y };

/** The aisle runs east from the door along the hall's centre line; this is its half-width. */
export const HALL_AISLE = 5;

/** Inside the hall (on its floor). */
export const inHall = (x: number, y: number): boolean => Math.abs(x - HALL.x) < HALL.hx && Math.abs(y - HALL.y) < HALL.hy;

/** The point of the aisle abreast of (x, y). */
export const aisleAt = (x: number): { x: number; y: number } => ({ x: Math.max(HALL_DOOR_IN.x, Math.min(HALL.x + HALL.hx - 3, x)), y: HALL.y });

/** What the path planner walks round: the whole hall, as one circle (he goes in by the door, never through a wall). */
export const HALL_OBSTACLES: { x: number; y: number; r: number }[] = [{ x: HALL.x, y: HALL.y, r: Math.hypot(HALL.hx, HALL.hy) }];

/** The walls (the west one in two pieces, either side of the door). What stands inside is added by the hall. */
export const HALL_COLLIDERS: Collider[] = (() => {
  const t = HALL_WALL / 2;
  const side = (HALL.hy - HALL_DOOR.half) / 2;
  return [
    { kind: "box", x: HALL.x, y: HALL.y + HALL.hy, hx: HALL.hx + t, hy: t, top: HALL_EAVES },
    { kind: "box", x: HALL.x, y: HALL.y - HALL.hy, hx: HALL.hx + t, hy: t, top: HALL_EAVES },
    { kind: "box", x: HALL.x + HALL.hx, y: HALL.y, hx: t, hy: HALL.hy + t, top: HALL_EAVES },
    { kind: "box", x: HALL_DOOR.x, y: HALL.y + HALL_DOOR.half + side, hx: t, hy: side, top: HALL_EAVES },
    { kind: "box", x: HALL_DOOR.x, y: HALL.y - HALL_DOOR.half - side, hx: t, hy: side, top: HALL_EAVES },
  ];
})();

/** Ground that's floor or paving rather than grass: the hall's floor and the forecourt before its door. */
export const HALL_PAVED: Rect[] = [
  { x: HALL.x, y: HALL.y, hx: HALL.hx + 1, hy: HALL.hy + 1 },
  { x: HALL_DOOR.x - 4, y: HALL.y, hx: 4, hy: HALL_DOOR.half + 3 },
];
