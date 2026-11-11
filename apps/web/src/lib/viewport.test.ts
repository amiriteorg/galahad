import { describe, expect, test } from "bun:test";
import { keyboardOpen } from "./viewport.ts";

/*
 * iOS doesn't shrink the page for the on-screen keyboard; it shrinks only the visual
 * viewport. While you type on a touch screen and the visible part is much shorter than
 * the page, the keyboard is up: the tab bar steps aside so the composer sits on it.
 */

describe("is the on-screen keyboard up?", () => {
  test("typing on a phone with the visible part much shorter than the page: yes", () => {
    expect(keyboardOpen({ coarse: true, typing: true, fullHeight: 844, visibleHeight: 508 })).toBe(true);
  });

  test("not typing, a fine pointer, or only a browser bar sliding away: no", () => {
    expect(keyboardOpen({ coarse: true, typing: false, fullHeight: 844, visibleHeight: 508 })).toBe(false);
    expect(keyboardOpen({ coarse: false, typing: true, fullHeight: 844, visibleHeight: 508 })).toBe(false);
    expect(keyboardOpen({ coarse: true, typing: true, fullHeight: 844, visibleHeight: 790 })).toBe(false);
  });
});
