import { HALL, HALL_EAVES } from "./hall-plan.ts";

/*
 * Seeing into the workshop hall. While the camera's focus is on its floor (or,
 * from far off, near it), the hall opens: the roof dissolves once the camera
 * rises towards it, and so does whichever wall the camera stands outside of.
 * Indoors, under the roof, nothing dissolves: the walls and the roof are all
 * around, as they should be. The amounts below are what the shell's material
 * computes for every fragment (hall-materials.ts mirrors them in TSL); the only
 * thing the renderer sets each frame is how open the hall is. Pure.
 */

const smoothstep = (lo: number, hi: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

/** The roof starts to dissolve when the camera is this high above the floor, and is gone at `ROOF_GONE`: before the camera reaches the eaves. */
export const ROOF_FROM = 5.6;
export const ROOF_GONE = HALL_EAVES - 0.8;
/** A wall dissolves over this range of the camera's distance outside it (metres; negative: still inside). */
export const WALL_FROM = -0.4;
export const WALL_GONE = 1.6;
/** The foot of every wall stays, however open the hall is: the building's outline is always there. */
export const KERB = 0.55;

/**
 * Whether the hall should be open (1) or closed (0) for a camera focused on (focusX, focusY) from
 * `distance` away. Close in, the focus has to be well inside (walking in at the door, the front
 * stays whole until he's through it); from far off, a focus near the hall opens it too.
 */
export function cutawayWanted(focusX: number, focusY: number, distance: number): 0 | 1 {
  const grow = -1.5 + 11.5 * smoothstep(12, 60, distance);
  return Math.abs(focusX - HALL.x) < HALL.hx + grow && Math.abs(focusY - HALL.y) < HALL.hy + grow ? 1 : 0;
}

/** Eases how open the hall is towards what's wanted: about a third of a second either way, at once under reduced motion. */
export function easeCutaway(open: number, wanted: number, dt: number, motion: boolean): number {
  if (!motion) return wanted;
  const step = dt / 0.35;
  return wanted > open ? Math.min(wanted, open + step) : Math.max(wanted, open - step);
}

/** How much of the roof is dissolved for a camera `height` above the floor, the hall being `open`. */
export const roofCut = (height: number, open: number): number => open * smoothstep(ROOF_FROM, ROOF_GONE, height);

/** How much of a wall is dissolved at `up` metres above the floor, for a camera `outside` metres beyond the wall's outer side. */
export const wallCut = (outside: number, up: number, open: number): number => (up < KERB ? 0 : open * smoothstep(WALL_FROM, WALL_GONE, outside));
