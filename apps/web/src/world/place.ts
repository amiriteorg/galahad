import type { Group } from "three/webgpu";
import type { Collider } from "./colliders.ts";
import type { Vec3 } from "./coords.ts";
import type { Tier } from "./tiers.ts";

/*
 * A built place of the world beyond the keep (the proving ground, the workshop
 * hall): what the scene needs from it, and what it's told each frame. The scene
 * adds its group to the world, lights its glows at night, steps it, tells it
 * which of its pads have an experiment on them (so its own machines make way),
 * and gives its GPU resources back at the end. The plan of each place (where
 * things stand) is pure data in field-plan.ts and hall-plan.ts.
 */

/** A soft glow at night: [x, y, z, radius] in scene coordinates (x east, y up, z south), as Glows takes them. */
export type Glow = readonly [number, number, number, number];

/** What a place is built with. */
export interface PlaceContext {
  tier: Tier;
  /** Whether the sun casts shadows (otherwise nothing should set castShadow). */
  shadows: boolean;
  /** The ground's height at a world point (metres, z up): the land as drawn. */
  ground(x: number, y: number): number;
}

/** One frame, as a place sees it. One object, reused: never keep it. */
export interface PlaceFrame {
  /** Seconds since the last frame drawn, and the clock (seconds). */
  dt: number;
  t: number;
  /** False under reduced motion: nothing should move then (machines rest in a tidy pose). */
  motion: boolean;
  /** The camera's focus on the ground (world metres), its distance from it, and whether it follows Galahad. */
  focusX: number;
  focusY: number;
  distance: number;
  follow: boolean;
  /** Where Galahad stands. */
  galahadX: number;
  galahadY: number;
  /** 0 by day to 1 at night; how hard it rains (0 to 1); how wet the ground is (0 to 1). */
  night: number;
  rain: number;
  wetness: number;
  /** The wind: its speed (m/s; Denmark's now when the weather is live, a light breeze otherwise) and the way it blows towards (atan2 convention). */
  wind: number;
  windHeading: number;
}

/** A light breeze, when the real wind isn't known (m/s). */
export const BREEZE = 3;
/** The way the wind blows towards: east-north-east (Denmark's prevailing wind is from the west-south-west). */
export const WIND_HEADING = 0.35;

export interface Place {
  /** In the world's root: absolute scene coordinates (x east, y up, z south = −north). */
  readonly group: Group;
  /** Lamps and lit windows (warm), screens and status lights (cool). */
  readonly warmGlows: readonly Glow[];
  readonly coolGlows: readonly Glow[];
  /** What nobody walks through here, beyond what the plan already lists. */
  readonly colliders: readonly Collider[];
  /**
   * What moves here and shouldn't be walked through or into (a rover, a cart, a taxiing aircraft): the same
   * objects every frame, their x and y (and r) updated in place by animate; a mover that's away (airborne,
   * hidden) has r 0.
   */
  readonly movers?: readonly { x: number; y: number; r: number }[];
  /** Lamps come on as the sun gets low: 0 by day to 1 at night. */
  setNight(lamps: number): void;
  /** The pads (core's PADS, by id) that have an experiment standing on them: the place's own machines keep clear. */
  setOccupied(pads: ReadonlySet<string>): void;
  animate(frame: PlaceFrame): void;
  /** What's under a world point, for a hover label ("Rover", "3D printer"): its name, and where the label floats (written into `out`, z above the ground). */
  hover?(x: number, y: number, out: Vec3): string | null;
  dispose(): void;
}
