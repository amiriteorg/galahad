import { describe, expect, test } from "bun:test";
import { isAlwaysOn } from "../src/capabilities.ts";

describe("which bodies are servers", () => {
  test("a Linux machine without a battery is always on", () => {
    expect(isAlwaysOn({ os: "linux", hasBattery: false })).toBe(true);
    expect(isAlwaysOn({ os: "linux", hasBattery: true })).toBe(false);
  });

  test("personal machines come and go, battery or not (a laptop whose battery Windows doesn't report)", () => {
    expect(isAlwaysOn({ os: "win32", hasBattery: false })).toBe(false);
    expect(isAlwaysOn({ os: "darwin", hasBattery: false })).toBe(false);
  });

  test("unknown capabilities are not a server", () => {
    expect(isAlwaysOn(undefined)).toBe(false);
    expect(isAlwaysOn({})).toBe(false);
  });
});
