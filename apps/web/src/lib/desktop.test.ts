import { describe, expect, test } from "bun:test";
import { hasDesktop } from "./desktop.ts";

describe("whether a VM has a desktop", () => {
  test("its image says so", () => {
    expect(hasDesktop({ image: "galahad/desktop:1" })).toBe(true);
    expect(hasDesktop({ image: "galahad/workshop:1" })).toBe(false);
    expect(hasDesktop(null)).toBe(false);
    expect(hasDesktop(undefined)).toBe(false);
  });
});
