/*
 * The alerts' arithmetic, pure and unit-tested (their drawing is ui/toast.ts's, ui/banner.ts's and ui/controls.ts'
 * count). The iPhone, iPad, Mac and Android apps can take the same numbers.
 */

/** How many toasts show while the stack is tucked: the newest in front, two behind it. */
export const TOAST_SHOWN = 3;
/** The room between two toasts when the stack fans out, in CSS pixels. */
export const TOAST_GAP = 8;

/** Where one toast stands in the stack. */
export interface StackPlace {
  /** 0 for the newest, in front; 1 for the one behind it, and so on. */
  depth: number;
  /** How far back it is drawn while tucked: its depth, but never past the last that shows. */
  step: number;
  /** How far above the stack's foot it sits when the stack fans out: the newer ones' heights, each with the gap. */
  offset: number;
  /** Tucked behind the ones that show, out of sight until the stack fans out. */
  hidden: boolean;
  /** Its stacking order: the newer in front. */
  z: number;
}

/** Each toast's place, given their heights oldest first (as they were raised); the places come in the same order. */
export function stackPlaces(heights: readonly number[], shown = TOAST_SHOWN, gap = TOAST_GAP): StackPlace[] {
  const places: StackPlace[] = new Array(heights.length);
  let offset = 0;
  for (let index = heights.length - 1; index >= 0; index--) {
    const depth = heights.length - 1 - index;
    places[index] = { depth, step: Math.min(depth, shown), offset, hidden: depth >= shown, z: 100 - depth };
    offset += heights[index]! + gap;
  }
  return places;
}
