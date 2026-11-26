import { describe, expect, test } from "bun:test";
import { stackPlaces, TOAST_GAP, TOAST_SHOWN } from "./alerts.ts";

/*
 * The toasts' stack: newest in front, the rest tucked behind it; fanned out (under the pointer, or a finger's focus),
 * each sits above the newer ones by their heights.
 */

describe("where each toast stands in the stack", () => {
  test("the newest is in front, the older ones behind it in order, each a step further back", () => {
    const places = stackPlaces([60, 80, 70]);
    expect(places.map((p) => p.depth)).toEqual([2, 1, 0]);
    expect(places.map((p) => p.z)).toEqual([98, 99, 100]);
  });

  test("fanned out, each sits above the newer ones by their heights and the gap between", () => {
    const places = stackPlaces([60, 80, 70]);
    expect(places.map((p) => p.offset)).toEqual([70 + TOAST_GAP + 80 + TOAST_GAP, 70 + TOAST_GAP, 0]);
  });

  test("only the newest three show while tucked; the rest wait behind them, hidden, until the stack fans out", () => {
    const places = stackPlaces([50, 50, 50, 50, 50]);
    expect(places.map((p) => p.hidden)).toEqual([true, true, false, false, false]);
    expect(places.filter((p) => !p.hidden)).toHaveLength(TOAST_SHOWN);
    // (However far back, a toast is drawn at the last step's depth: the hidden ones don't shrink away to nothing.)
    expect(places.map((p) => p.step)).toEqual([3, 3, 2, 1, 0]);
  });

  test("one toast alone is in front, where it is; none is no stack", () => {
    expect(stackPlaces([64])).toEqual([{ depth: 0, step: 0, offset: 0, hidden: false, z: 100 }]);
    expect(stackPlaces([])).toEqual([]);
  });
});
