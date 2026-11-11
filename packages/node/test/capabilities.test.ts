import { describe, expect, test } from "bun:test";
import { type Capabilities, isAlwaysOn } from "../src/capabilities.ts";
import { refreshCapabilities } from "../src/daemon.ts";

/*
 * The node looks at its own body every five minutes, on a timer. Bun ends the process
 * on an unhandled rejection, so a refresh that fails must be a line in the log, never
 * the end of the node (and of every chat, quest and loop it was running).
 */
describe("a capability refresh that fails", () => {
  const caps = { os: "linux", hasBattery: false } as Capabilities;

  test("a probe that fails is logged, and the last capabilities stand", async () => {
    const logs: string[] = [];
    const published: Capabilities[] = [];
    const fresh = await refreshCapabilities(
      async () => {
        throw new Error("docker info hung");
      },
      (c) => void published.push(c),
      (message) => void logs.push(message),
    );
    expect(fresh).toBeNull();
    expect(published).toEqual([]);
    expect(logs.join("\n")).toContain("docker info hung");
  });

  test("a profile the mind refuses (this node was revoked, say) is logged, not thrown", async () => {
    const logs: string[] = [];
    const fresh = await refreshCapabilities(
      async () => caps,
      () => {
        throw new Error("emit not authorized: signer is not an active device");
      },
      (message) => void logs.push(message),
    );
    expect(fresh).toBe(caps);
    expect(logs.join("\n")).toContain("signer is not an active device");
  });

  test("a refresh that works publishes what it found", async () => {
    const published: Capabilities[] = [];
    expect(await refreshCapabilities(async () => caps, (c) => void published.push(c), () => {})).toBe(caps);
    expect(published).toEqual([caps]);
  });
});

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
