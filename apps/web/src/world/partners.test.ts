import { describe, expect, test } from "bun:test";
import type { WorldPartner } from "@galahad/core/world";
import { KEEP_DOOR, MAX, PartnerFigures } from "./partners.ts";

/*
 * The agents working with him, as figures: one appears at the keep when its first call
 * comes, walks to a place beside him, and when it's gone quiet walks back and fades.
 */

const partner = (name: string, station: WorldPartner["station"] = "library"): WorldPartner => ({ name, station, doing: "Recall from the shared mind", since: 0, last: 0 });
const him = { x: -18, y: 12, heading: Math.PI / 2, moving: false };
const run = (f: PartnerFigures, seconds: number, motion = true) => {
  for (let s = 0; s < seconds; s += 1 / 30) f.step(1 / 30, him, motion);
};

describe("a partner", () => {
  test("appears at the keep's door, small, and grows as it comes", () => {
    const f = new PartnerFigures();
    f.sync([partner("claude-code")]);
    const s = f.squires.find((q) => q.name === "claude-code")!;
    expect([s.x, s.y]).toEqual([KEEP_DOOR.x, KEEP_DOOR.y]);
    expect(s.shown).toBe(0);
    run(f, 0.3);
    expect(s.shown).toBeGreaterThan(0);
    expect(s.shown).toBeLessThan(1);
    expect(f.count).toBe(1);
  });

  test("walks to its place beside him, and stays there while he works", () => {
    const f = new PartnerFigures();
    f.sync([partner("claude-code")]);
    run(f, 20);
    const s = f.squires.find((q) => q.name === "claude-code")!;
    expect(Math.hypot(s.x - him.x, s.y - him.y)).toBeLessThan(2.2);
    expect(Math.hypot(s.x - him.x, s.y - him.y)).toBeGreaterThan(1);
    expect(s.shown).toBe(1);
    expect(s.r).toBeGreaterThan(0);
  });

  test("two never stand in one place", () => {
    const f = new PartnerFigures();
    f.sync([partner("claude-code"), partner("opencode")]);
    run(f, 20);
    const [a, b] = f.squires.filter((q) => q.name);
    expect(Math.hypot(a!.x - b!.x, a!.y - b!.y)).toBeGreaterThan(0.6);
  });

  test("gone quiet: it walks back to the keep and fades, and its place is free again", () => {
    const f = new PartnerFigures();
    f.sync([partner("claude-code")]);
    run(f, 20);
    f.sync([]);
    run(f, 0.4);
    const s = f.squires.find((q) => q.name === "claude-code")!;
    expect(s.here).toBe(false);
    expect(s.shown).toBeLessThan(1);
    run(f, 30);
    expect(f.squires.some((q) => q.name === "claude-code")).toBe(false);
    expect(f.count).toBe(0);
  });

  test("at most a handful at once; under reduced motion they're simply there, or not", () => {
    const f = new PartnerFigures();
    f.sync(Array.from({ length: MAX + 3 }, (_, i) => partner(`agent-${i}`)));
    expect(f.count).toBe(MAX);
    const still = new PartnerFigures();
    still.sync([partner("claude-code")]);
    run(still, 1 / 30, false);
    const s = still.squires.find((q) => q.name === "claude-code")!;
    expect(s.shown).toBe(1);
    expect(Math.hypot(s.x - him.x, s.y - him.y)).toBeLessThan(2.2);
    still.sync([]);
    run(still, 1 / 30, false);
    expect(still.count).toBe(0);
  });
});
