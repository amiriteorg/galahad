import { PADS, SITES } from "@galahad/core/world";
import type { Collider, Rect } from "./colliders.ts";

/*
 * The proving ground's plan: where its runway, taxiway, apron, launch pad and
 * rover course are, as the land, the walkers and the camera need to know them.
 * It lies on the heights west of the keep, on ground levelled at FIELD_LEVEL
 * (the plateau's own height, so nothing is dug or banked up), looking down on
 * the keep and the lake. The contract (core's SITES and PADS) fixes the
 * ground's rectangle and its pads; everything else about the plan lives here.
 * Pure data, so the path planner and the tests can read it without the
 * renderer.
 */

const S = SITES.field;
const pad = (id: string) => PADS.find((p) => p.id === id)!;

/** The ground's height above the keep's (metres): everything on the proving ground stands this high. */
export const FIELD_LEVEL = 5;

/** The whole ground: mown, level. */
export const FIELD: Rect = { x: S.x, y: S.y, hx: S.w / 2, hy: S.d / 2 };

/** The runway (18/36, north-south) through the flight pad's centre. */
export const RUNWAY: Rect = { x: pad("flight").x, y: pad("flight").y, hx: 8, hy: 72 };

/** The apron, on the keep's side between the launch pad and the rover course: where aircraft park and the road arrives. */
export const APRON: Rect = { x: -92, y: -35, hx: 18, hy: 27 };

/** The taxiway from the apron to the runway. */
export const TAXIWAY: Rect = { x: (APRON.x - APRON.hx + RUNWAY.x + RUNWAY.hx) / 2, y: RUNWAY.y, hx: (APRON.x - APRON.hx - RUNWAY.x - RUNWAY.hx) / 2, hy: 4 };

/** Where the road from the keep reaches the ground: the middle of its east edge. */
export const FIELD_GATE = { x: FIELD.x + FIELD.hx, y: FIELD.y };

/** Ground that's paved rather than mown: nothing grows on it and the land is drawn as worn ground under it. */
export const FIELD_PAVED: Rect[] = [RUNWAY, TAXIWAY, APRON];

/** What the path planner walks round (buildings, as circles). */
export const FIELD_OBSTACLES: { x: number; y: number; r: number }[] = [];

/** What nobody walks through (hangars, the tower, parked machines). */
export const FIELD_COLLIDERS: Collider[] = [];
