import { padAt, type SiteName } from "@galahad/core/world";
import { type Collider, inRect, type Rect } from "./colliders.ts";
import { FIELD, FIELD_COLLIDERS, FIELD_GATE, FIELD_LEVEL, FIELD_OBSTACLES, FIELD_PAVED } from "./field-plan.ts";
import { HALL, HALL_COLLIDERS, HALL_DOOR_OUT, HALL_OBSTACLES, HALL_PAVED } from "./hall-plan.ts";

/*
 * The two test sites together (the proving ground and the workshop hall), for
 * whoever needs to ask about both: the land (what's level and how high, what's
 * paved), the path planner (what to walk round, where the roads end), the plots
 * (how high a pad's ground is) and the camera. Each site's own plan is in
 * field-plan.ts and hall-plan.ts. Pure.
 */

export const SITE_RECTS: Record<SiteName, Rect> = { field: FIELD, hall: HALL };

/** How high each site's ground is above the keep's (metres). */
export const SITE_LEVEL: Record<SiteName, number> = { field: FIELD_LEVEL, hall: 0 };

/** The height of the ground a plot stands on: its site's level on a pad, the keep's (0) on open land. */
export function plotLevel(plot: { x: number; y: number }): number {
  const pad = padAt(plot);
  return pad ? SITE_LEVEL[pad.site] : 0;
}

/** What the path planner walks round on the sites. */
export const SITE_OBSTACLES: readonly { x: number; y: number; r: number }[] = [...HALL_OBSTACLES, ...FIELD_OBSTACLES];

/** What nobody walks through on the sites. */
export const SITE_COLLIDERS: readonly Collider[] = [...HALL_COLLIDERS, ...FIELD_COLLIDERS];

const PAVED: readonly Rect[] = [...HALL_PAVED, ...FIELD_PAVED];

/** True on floor or paving (a runway, an apron, the hall's floor). */
export function paved(x: number, y: number): boolean {
  for (let i = 0; i < PAVED.length; i++) if (inRect(PAVED[i]!, x, y)) return true;
  return false;
}

/** On a site, or within `grow` metres of one. */
export function onSite(x: number, y: number, grow = 0): boolean {
  return inRect(FIELD, x, y, grow) || inRect(HALL, x, y, grow);
}

/** Where the road from the keep ends at each site. */
export const SITE_GATES: Record<SiteName, { x: number; y: number }> = { field: FIELD_GATE, hall: HALL_DOOR_OUT };

/**
 * Where a site's name floats (world metres, z up), and the view of it from the HUD: its focus, the camera's
 * distance and the way it looks (atan2 convention): both from the keep's side.
 */
export const SITE_VIEW: Record<SiteName, { label: [number, number, number]; x: number; y: number; distance: number; yaw: number }> = {
  field: { label: [FIELD_GATE.x - 4, FIELD_GATE.y, FIELD_LEVEL + 9], x: FIELD.x + 18, y: FIELD.y, distance: 118, yaw: Math.PI },
  hall: { label: [HALL.x - HALL.hx, HALL.y, 13], x: HALL.x - 6, y: HALL.y, distance: 62, yaw: 0 },
};
