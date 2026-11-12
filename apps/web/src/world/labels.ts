/*
 * Laying the SANDBOX's HTML labels out so none sits on another. Each label is
 * a box on the screen, standing on its anchor (the point it names, projected):
 * x its middle, y its bottom. In order of how much it matters (its rank: his
 * speech bubble first, then the experiment that's open, the experiments, the
 * nearer stations before the farther), each goes where it stands if nothing
 * already placed is there; else just above what's in its way, if that's
 * near; else it fades. It decides with a margin it has to clear to change its
 * mind (a label shown keeps its place until something really covers it, one
 * hidden waits for real room), so nothing flickers as the view moves. Pure,
 * and it allocates nothing: the boxes and the order are the caller's, reused.
 */

export interface LabelBox {
  /** Its anchor on the screen (CSS pixels): the box's bottom middle. */
  x: number;
  y: number;
  /** Its size (CSS pixels). */
  w: number;
  h: number;
  /** How much it matters: higher wins. */
  rank: number;
  /** Whether it's on the screen at all this frame. */
  on: boolean;
  /** Out (and its last answer, which it keeps to if it can): how far up it's moved (≤ 0), and whether it shows. */
  lift: number;
  shown: boolean;
}

/** The room left between two labels (CSS pixels). */
export const LABEL_GAP = 4;
/** A label moves up out of another's way by no more than this many times its own height (over his bubble, say); any farther and it fades. */
const MOST_LIFT = 3;
/** It changes its mind (shows, or moves to another place) only with this much room to spare (CSS pixels). */
const HYSTERESIS = 6;

/** Placed boxes this frame: left, top, right, bottom. */
const placed = new Float64Array(4 * 256);

/** Whether a box (left, top, right, bottom) overlaps one already placed, `margin` pixels round it; −1, or the first it does. */
function hit(n: number, l: number, t: number, r: number, b: number, margin: number): number {
  for (let k = 0; k < n; k++) {
    const o = k * 4;
    if (l < placed[o + 2]! + margin && r > placed[o]! - margin && t < placed[o + 3]! + margin && b > placed[o + 1]! - margin) return k;
  }
  return -1;
}

/**
 * Whether a point is before a view: at least `near` along the way it looks (the point, the view's place and its
 * unit direction, each x, y, z). A label behind the view has no place on the screen, and its projection can't
 * be asked: under a reversed depth buffer a point behind the camera projects to a depth below 0, not above 1,
 * and to a mirrored place on the screen. The usual view never has a labelled thing behind it; his own eyes do.
 */
export function before(px: number, py: number, pz: number, vx: number, vy: number, vz: number, dx: number, dy: number, dz: number, near = 0.3): boolean {
  return (px - vx) * dx + (py - vy) * dy + (pz - vz) * dz >= near;
}

/**
 * Lays out the first `count` of `boxes` (their x, y, w, h, rank and on: the rest are its answer), in the order
 * `order` (indices into boxes, kept by the caller and sorted here by rank, from the last frame's order: stable).
 */
export function layoutLabels(boxes: readonly LabelBox[], count: number, order: Int32Array): void {
  // By rank, highest first (insertion sort over last frame's order: nearly sorted, and stable).
  for (let i = 1; i < count; i++) {
    const v = order[i]!;
    const rank = boxes[v]!.rank;
    let j = i - 1;
    while (j >= 0 && boxes[order[j]!]!.rank < rank) {
      order[j + 1] = order[j]!;
      j--;
    }
    order[j + 1] = v;
  }
  let n = 0;
  for (let i = 0; i < count; i++) {
    const b = boxes[order[i]!]!;
    if (!b.on) {
      b.shown = false;
      b.lift = 0;
      continue;
    }
    const l = b.x - b.w / 2;
    const r = b.x + b.w / 2;
    // Where it was last (shown at its lift) it stays while it's clear there by a little; else it needs more room.
    const keep = b.shown ? -HYSTERESIS / 2 : HYSTERESIS;
    let lift = 0;
    let ok = false;
    if (b.shown && b.lift < 0 && hit(n, l, b.y + b.lift - b.h, r, b.y + b.lift, LABEL_GAP + keep) < 0) {
      // Still where it moved to, and no reason to come back down yet: unless its own place is now free with room.
      lift = hit(n, l, b.y - b.h, r, b.y, LABEL_GAP + HYSTERESIS) < 0 ? 0 : b.lift;
      ok = true;
    } else if (hit(n, l, b.y - b.h, r, b.y, LABEL_GAP + (b.shown && b.lift === 0 ? keep : HYSTERESIS)) < 0) {
      ok = true;
    } else {
      // Just above whatever is in its way (up past each in turn, within reach).
      let y = b.y;
      for (let tries = 0; tries < 4; tries++) {
        const k = hit(n, l, y - b.h, r, y, LABEL_GAP);
        if (k < 0) {
          ok = true;
          break;
        }
        y = placed[k * 4 + 1]! - LABEL_GAP;
        if (b.y - y > b.h * MOST_LIFT) break;
      }
      lift = ok ? y - b.y : 0;
    }
    b.shown = ok;
    b.lift = ok ? lift : 0;
    if (!ok || n * 4 >= placed.length) continue;
    const o = n++ * 4;
    placed[o] = l;
    placed[o + 1] = b.y + b.lift - b.h;
    placed[o + 2] = r;
    placed[o + 3] = b.y + b.lift;
  }
}
