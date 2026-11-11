import { describe, expect, test } from "bun:test";
import type { WorldAttempt } from "@galahad/core/world-compute";
import { BUILDS, Solids } from "./collide.ts";
import { HelperFigures, helperPost } from "./helpers.ts";
import { fleetColliders, KEEP_COLLIDERS } from "./keep-plan.ts";
import { MAX, PartnerFigures, SQUIRE } from "./partners.ts";
import { standAt } from "./path.ts";

/*
 * His helpers: one figure for each attempt a quest runs at once, at the station
 * its work is at. They appear at a post beside where he'd stand, clear of him and
 * of everything solid; move with their work from the council to the forge to the
 * observatory; and go when their attempt is done.
 */

const attempt = (index: number, station: WorldAttempt["station"], of = 3): WorldAttempt => ({ id: `q-1.${index}`, quest: "q-1", index, of, label: `Attempt ${index} of ${of}: compute the tip deflection`, station, node: "ultra", since: 0 });
const make = () => {
  const figures = new PartnerFigures();
  return { squires: figures.squires, helpers: new HelperFigures(figures.squires) };
};
const run = (h: HelperFigures, seconds: number, motion = true) => {
  let about = false;
  for (let s = 0; s < seconds; s += 1 / 30) about = h.step(1 / 30, motion);
  return about;
};

describe("his helpers", () => {
  test("each attempt appears at its own post at the station its work is at, grows in, and gets busy with its hands", () => {
    const { squires, helpers } = make();
    helpers.sync([attempt(1, "forge"), attempt(2, "forge"), attempt(3, "forge")]);
    expect(helpers.count).toBe(3);
    const about = squires.filter((s) => s.name);
    expect(about.map((s) => s.shown)).toEqual([0, 0, 0]);
    expect(run(helpers, 0.3)).toBe(true);
    for (const s of about) {
      expect(s.shown).toBeGreaterThan(0);
      expect(s.shown).toBeLessThan(1);
    }
    run(helpers, 2);
    const post = { x: 0, y: 0, facing: 0 };
    about.forEach((s, k) => {
      helperPost("forge", k, post);
      expect([s.x, s.y]).toEqual([post.x, post.y]);
      expect(s.heading).toBe(standAt("forge").facing);
      expect(s.shown).toBe(1);
      expect(s.work).toBeGreaterThan(0.9);
      expect(s.walk).toBe(0);
    });
    // No two in one place, and none where he'd stand.
    const him = standAt("forge");
    for (const a of about) {
      expect(Math.hypot(a.x - him.x, a.y - him.y)).toBeGreaterThan(BUILDS.galahad.r + SQUIRE.r + 0.3);
      for (const b of about) if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(SQUIRE.r * 2);
    }
  });

  test("when its work moves on (planned, worked, reviewed) it shrinks away and appears at the next station; done, it's gone and its place is free", () => {
    const { squires, helpers } = make();
    helpers.sync([attempt(1, "council", 2), attempt(2, "council", 2)]);
    run(helpers, 2);
    const first = squires.find((s) => s.name === "q-1.1")!;
    const at = { x: 0, y: 0, facing: 0 };
    expect([first.x, first.y]).toEqual([helperPost("council", 0, at).x, helperPost("council", 0, at).y]);
    // Attempt 1 is being worked now; attempt 2 is still being planned (and moves up to the first place in the row).
    helpers.sync([attempt(1, "forge", 2), attempt(2, "council", 2)]);
    run(helpers, 0.2);
    expect(first.shown).toBeLessThan(1);
    expect([first.x, first.y]).toEqual([at.x, at.y]);
    run(helpers, 3);
    helperPost("forge", 0, at);
    expect([first.x, first.y]).toEqual([at.x, at.y]);
    expect(first.shown).toBe(1);
    const second = squires.find((s) => s.name === "q-1.2")!;
    helperPost("council", 0, at);
    expect([second.x, second.y]).toEqual([at.x, at.y]);
    // The quest is done: both go.
    helpers.sync([]);
    expect(run(helpers, 0.2)).toBe(true);
    expect(run(helpers, 2)).toBe(false);
    expect(helpers.count).toBe(0);
    expect(squires.every((s) => !s.name)).toBe(true);
  });

  test("their posts at the council, the forge and the observatory are clear of the keep, its stations and a full fleet's banners", () => {
    const solids = new Solids();
    solids.add(KEEP_COLLIDERS);
    solids.add(fleetColliders(Array.from({ length: 16 }, (_, i) => i % 3 === 0)));
    const probe = solids.join({ x: 0, y: -40, r: SQUIRE.r }, SQUIRE);
    const post = { x: 0, y: 0, facing: 0 };
    const blocked: string[] = [];
    for (const station of ["council", "forge", "observatory"] as const) {
      for (let k = 0; k < 3; k++) {
        helperPost(station, k, post);
        if (!probe.fits(post.x, post.y, 0.02)) blocked.push(`${station} ${k}`);
      }
    }
    expect(blocked).toEqual([]);
  });

  test("more attempts than there are figures: the rest simply aren't shown; under reduced motion they're there at once, still", () => {
    const { squires, helpers } = make();
    helpers.sync(Array.from({ length: MAX + 2 }, (_, i) => ({ ...attempt(1, "forge", 8), id: `q-${i}` })));
    expect(helpers.count).toBe(MAX);
    const still = make();
    still.helpers.sync([attempt(1, "observatory")]);
    run(still.helpers, 1 / 30, false);
    const s = still.squires.find((q) => q.name)!;
    expect(s.shown).toBe(1);
    expect(s.work).toBe(0);
    still.helpers.sync([]);
    run(still.helpers, 1 / 30, false);
    expect(still.helpers.count).toBe(0);
    expect(squires.length).toBe(MAX);
  });

  test("a hover says what it is, what it's doing and which attempt", () => {
    const { helpers } = make();
    helpers.sync([attempt(2, "observatory")]);
    run(helpers, 2);
    const post = helperPost("observatory", 0, { x: 0, y: 0, facing: 0 });
    const out: [number, number, number] = [0, 0, 0];
    expect(helpers.hover(post.x + 0.2, post.y, out)).toBe("His helper · being reviewed at the observatory · Attempt 2 of 3: compute the tip deflection");
    expect([out[0], out[1]]).toEqual([post.x, post.y]);
    expect(helpers.hover(post.x + 5, post.y, out)).toBeNull();
  });
});
