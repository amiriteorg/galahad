import { EAST, HALL, HALL_EAVES, NORTH, SOUTH, WEST } from "./hall-plan.ts";

/*
 * Seeing into the workshop hall. While the camera's focus is on its floor (or,
 * from far off, near it), the hall opens: the roof dissolves once the camera
 * rises towards the eaves, and so does each wall the camera stands outside of
 * (above a kerb, so the building's outline stays). Indoors, under the roof,
 * nothing dissolves: the walls and the roof are all around, as they should be.
 *
 * Each part is either wanted open or not (with a little hysteresis, so a
 * camera hovering at a threshold doesn't flicker), and eases there in about a
 * third of a second: the dither only shows while a part comes or goes, never
 * as a standing screen over the view. The renderer sets five numbers a frame
 * (hall-materials.ts); this is where they come from. Pure.
 */

/** The parts that dissolve, by index (the shell's `cut` attribute names them; 0 is nothing). */
export const CUT_NONE = 0;
export const CUT_WEST = 1;
export const CUT_EAST = 2;
export const CUT_NORTH = 3;
export const CUT_SOUTH = 4;
/** Added to a wall's index for what goes with the roof as well (the gables over the eaves); the roof alone is this. */
export const CUT_ROOF = 8;

/** The roof goes when the camera is this high above the floor, and comes back below `ROOF_SHUT`. */
export const ROOF_OPEN = 6.4;
export const ROOF_SHUT = 5.6;
/** A wall goes when the camera is this far outside it, and comes back once it's within `WALL_SHUT` of it. */
export const WALL_OPEN = 0.5;
export const WALL_SHUT = 0;
/** The foot of every wall stays, however open the hall is: the building's outline is always there. */
export const KERB = 0.55;
/** How long a part takes to come or go (seconds). */
export const EASE = 0.35;

const smoothstep = (lo: number, hi: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

/**
 * How far round the hall its focus may be for it to open (metres; negative: well inside). Close in,
 * the focus has to be inside (walking in at the door, the front stays whole until he's through it);
 * from far off, a focus near the hall opens it too.
 */
export const reachFor = (distance: number): number => -1.5 + 11.5 * smoothstep(12, 60, distance);

export class Cutaway {
  /** How dissolved each part is, 0 whole .. 1 gone: [nothing, west, east, north, south]. */
  readonly walls = new Float32Array(5);
  roof = 0;
  /** Whether the hall is open at all (its focus is in it). */
  active = false;
  private readonly want = new Uint8Array(5);
  private wantRoof = false;

  /**
   * One frame. The camera at (cx, cy) `ch` metres above the floor, looking at (fx, fy) from `distance`
   * away; `motion` false: no easing (under reduced motion parts come and go at once).
   */
  step(cx: number, cy: number, ch: number, fx: number, fy: number, distance: number, dt: number, motion: boolean): void {
    const grow = reachFor(distance) + (this.active ? 0.6 : 0);
    this.active = Math.abs(fx - HALL.x) < HALL.hx + grow && Math.abs(fy - HALL.y) < HALL.hy + grow;
    // How far outside each wall's outer face the camera is (negative: inside it).
    const outside = [0, WEST - cx, cx - EAST, cy - NORTH, SOUTH - cy];
    for (let i = 1; i < 5; i++) {
      const was = this.want[i] === 1;
      this.want[i] = this.active && outside[i]! > (was ? WALL_SHUT : WALL_OPEN) ? 1 : 0;
    }
    this.wantRoof = this.active && ch > (this.wantRoof ? ROOF_SHUT : ROOF_OPEN);
    const k = motion ? dt / EASE : 1;
    for (let i = 1; i < 5; i++) this.walls[i] = toward(this.walls[i]!, this.want[i]!, k);
    this.roof = toward(this.roof, this.wantRoof ? 1 : 0, k);
  }
}

const toward = (from: number, to: number, step: number): number => (to > from ? Math.min(to, from + step) : Math.max(to, from - step));

/** How dissolved a point of the shell is: `cut` is its part (a wall's index, plus CUT_ROOF if it goes with the roof), `up` its height above the floor. */
export function cutAt(c: Cutaway, cut: number, up: number): number {
  if (up < KERB && cut < CUT_ROOF) return 0;
  const roof = cut >= CUT_ROOF ? c.roof : 0;
  return Math.max(c.walls[cut % CUT_ROOF] ?? 0, roof);
}

/** The camera is inside the hall, under its roof (for the shell's glass: lamplit seen from outside, dark seen from within). */
export const indoors = (x: number, y: number, up: number): boolean => x > WEST && x < EAST && y > SOUTH && y < NORTH && up < HALL_EAVES;
