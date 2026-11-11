import { describe, expect, test } from "bun:test";
import type { WorldPartner } from "@galahad/core/world";
import { Solids } from "./collide.ts";
import { KEEP_COLLIDERS } from "./keep-plan.ts";
import { KEEP_DOOR, MAX, PartnerFigures, SQUIRE } from "./partners.ts";

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

  test("its door at the keep is open ground, and from there it finds its way round the keep to him, in his footsteps", () => {
    const solids = new Solids();
    solids.add(KEEP_COLLIDERS);
    const probe = solids.join({ x: KEEP_DOOR.x, y: KEEP_DOOR.y, r: SQUIRE.r }, SQUIRE);
    expect(probe.fits(KEEP_DOOR.x, KEEP_DOOR.y, 0.05)).toBe(true);
    const f = new PartnerFigures();
    f.join(solids, { height: () => 0, blocked: () => false });
    f.sync([partner("claude-code")]);
    // He walks from the keep's door round to the library's side (north-west, past the keep), leaving footsteps.
    const leader = { x: KEEP_DOOR.x, y: KEEP_DOOR.y - 1, heading: Math.PI, moving: true };
    const way = [
      [-10, -9],
      [-14, -2],
      [-15, 6],
    ];
    for (const [x, y] of way) {
      for (let k = 0; k < 120; k++) {
        const d = Math.hypot(x! - leader.x, y! - leader.y);
        if (d < 0.05) break;
        leader.heading = Math.atan2(y! - leader.y, x! - leader.x);
        const step = Math.min(d, 2 / 30);
        leader.x += Math.cos(leader.heading) * step;
        leader.y += Math.sin(leader.heading) * step;
        f.step(1 / 30, leader, true);
      }
    }
    leader.moving = false;
    for (let k = 0; k < 600; k++) f.step(1 / 30, leader, true);
    const s = f.squires.find((q) => q.name === "claude-code")!;
    expect(Math.hypot(s.x - leader.x, s.y - leader.y)).toBeLessThan(2.5);
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

  test("six of them cost next to nothing a frame", () => {
    const solids = new Solids();
    solids.add(KEEP_COLLIDERS);
    const f = new PartnerFigures();
    f.join(solids, { height: () => 0, blocked: () => false });
    f.sync(Array.from({ length: MAX }, (_, i) => partner(`agent-${i}`)));
    const leader = { x: -18, y: 12, heading: 0, moving: true };
    for (let k = 0; k < 60; k++) f.step(1 / 30, leader, true);
    const t0 = performance.now();
    for (let k = 0; k < 1000; k++) {
      leader.heading += 0.01;
      f.step(1 / 30, leader, true);
    }
    const per = (performance.now() - t0) / 1000;
    expect(per).toBeLessThan(0.2);
    console.log(`partners: ${(per * 1000).toFixed(1)} µs a frame for ${MAX}`);
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
