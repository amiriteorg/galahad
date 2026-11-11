/*
 * What nobody walks through, seen from above: world metres, x east, y north. A
 * circle (a trunk, a post, a machine) or a box (a wall, a bench, a parked
 * vehicle), which may be turned (`yaw`, atan2 convention: the way its x half-
 * extent points). `top` is how high it stands above the ground (metres): low
 * things can be stepped over or seen over, tall ones can't. `bottom` is how
 * high its underside is (a deck, a crown, a roof: walked under, but not air for
 * the camera); without it, it stands on the ground. Pure data; who is stopped
 * by what is decided where they're used (collide.ts).
 */

export type Collider =
  | { kind: "circle"; x: number; y: number; r: number; top?: number; bottom?: number }
  | { kind: "box"; x: number; y: number; hx: number; hy: number; yaw?: number; top?: number; bottom?: number };

/** An axis-aligned rectangle: its centre and half-extents (east-west, north-south). */
export interface Rect {
  x: number;
  y: number;
  hx: number;
  hy: number;
}

/** Inside the rectangle, or within `grow` metres of it. */
export const inRect = (r: Rect, x: number, y: number, grow = 0): boolean => Math.abs(x - r.x) <= r.hx + grow && Math.abs(y - r.y) <= r.hy + grow;
