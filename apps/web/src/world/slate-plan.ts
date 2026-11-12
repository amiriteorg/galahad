import { BOARD_H, BOARD_W } from "@galahad/core/board";
import type { Collider } from "./colliders.ts";

/*
 * His slate: where it stands and what of it is solid. Pure data (no renderer), so
 * the selector, the tests and the walkers read it.
 *
 * A quest is planned, led and reviewed at the council table, so his own slate stands
 * there: on the lawn east of where he stands at the table, clear of its deck, turned
 * to face him and the way up from the keep. It's his, not the board you share with
 * him at the observatory: nothing he chalks here ever lands on your drawing.
 */

/** The way its face looks (atan2 convention): south-west, towards where he stands at the table and the keep beyond. */
const FACING = -Math.PI / 2 - 0.5;

/** Where it stands (world metres, z up), the way its face looks, and its face: a 16:9 slate two and a half metres wide, from 0.7 m above the ground. */
export const SLATE = { x: 4.7, y: 11.1, facing: FACING, width: 2.5, height: (2.5 * BOARD_H) / BOARD_W, bottom: 0.7 } as const;

const nx = Math.cos(FACING);
const ny = Math.sin(FACING);
/** The slate's +x (left to right, as you face it), in the world. */
const rx = Math.cos(FACING + Math.PI / 2);
const ry = Math.sin(FACING + Math.PI / 2);

/** How far before the face he stands to write (his radius is 0.45). */
const STAND = 0.62;

/** A slate point (board units) on the face, in the world (metres; z above the ground under it). */
export function slatePoint(bx: number, by: number, out: { x: number; y: number; z: number }): void {
  const u = (Math.max(0, Math.min(BOARD_W, bx)) / BOARD_W - 0.5) * SLATE.width;
  out.x = SLATE.x + rx * u + nx * 0.05;
  out.y = SLATE.y + ry * u + ny * 0.05;
  out.z = SLATE.bottom + (1 - Math.max(0, Math.min(BOARD_H, by)) / BOARD_H) * SLATE.height;
}

/** Where he stands to write at a region of it: before it, his right hand over it (he faces the slate, so his right is its +x). */
export function slateStand(region: { x: number; w: number }): { x: number; y: number; facing: number } {
  const u = Math.max(-SLATE.width / 2 + 0.3, Math.min(SLATE.width / 2 - 0.1, ((region.x + region.w / 2) / BOARD_W - 0.5) * SLATE.width - 0.22));
  return { x: SLATE.x + rx * u + nx * STAND, y: SLATE.y + ry * u + ny * STAND, facing: FACING + Math.PI };
}

/** Under a ground point: the slate, seen from the front (the ground behind the face is where a look through it lands). */
export function overSlate(x: number, y: number): boolean {
  const dx = x - SLATE.x;
  const dy = y - SLATE.y;
  const along = dx * rx + dy * ry;
  const out = dx * nx + dy * ny;
  return Math.abs(along) <= SLATE.width / 2 + 0.25 && out <= 1.1 && out >= -3.6;
}

/** Solid: the frame and its legs (their feet reach back), never the space before it where he stands. */
export const SLATE_COLLIDERS: readonly Collider[] = [{ kind: "box", x: SLATE.x - nx * 0.18, y: SLATE.y - ny * 0.18, hx: SLATE.width / 2 + 0.2, hy: 0.3, yaw: FACING + Math.PI / 2, top: SLATE.bottom + SLATE.height + 0.2 }];
