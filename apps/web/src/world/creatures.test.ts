import { describe, expect, test } from "bun:test";
import { BUILDS, Solids } from "./collide.ts";
import { BED, DOG_BED, HEARTH_COLLIDERS } from "./hearth-plan.ts";
import { RobotDog } from "./dog.ts";
import { KEEP_COLLIDERS } from "./keep-plan.ts";
import { MicroduckFlock } from "./microducks.ts";
import { Planner } from "./nav.ts";
import { obstacles, PLACES, standAt, Walker } from "./path.ts";

/*
 * Everything that walks round the keep, together among the keep's solids:
 * Galahad going from station to station, the dog at his side, a flock of
 * Microducks pottering and tagging along. Nobody ever stands inside anything
 * solid or inside anybody else (the small ones give way), and the dog keeps
 * up with him.
 */

const flat = { height: () => 0, blocked: (x: number, y: number) => Math.hypot(x, y) < 8.5 && Math.hypot(x, y + 8.5) > 3 };
const open = { height: () => 0, blocked: () => false };

function world() {
  const solids = new Solids();
  solids.add(KEEP_COLLIDERS);
  const planner = new Planner(solids);
  const walker = new Walker(standAt("keep"));
  const mover = solids.join(walker, BUILDS.galahad);
  walker.join({ planner, mover, wet: null });
  const dog = new RobotDog(false);
  dog.join(solids, () => false);
  const flock = new MicroduckFlock(14, flat, 5);
  flock.join(solids);
  return { solids, walker, dog, flock };
}

describe("the keep's walkers, together", () => {
  test("nobody stands inside anything, or inside anybody: the ducks keep apart, the dog keeps out of his way", () => {
    const { solids, walker, dog, flock } = world();
    const master = { x: walker.x, y: walker.y, heading: walker.heading, moving: false, running: false, working: false };
    dog.place(master, () => 0);
    const dt = 1 / 60;
    const order = ["forge", "council", "oracle", "watchtower", "treasury", "keep"] as const;
    const problems: string[] = [];
    let t = 0;
    for (const place of order) {
      walker.go(standAt(place), obstacles());
      // Walk there, then stand a while (the ducks potter, the dog sits, sniffs about).
      let after = 0;
      for (let k = 0; k < 60 * 40 && after < 8; k++, t += dt) {
        if (!walker.moving && !walker.waypoints.length) after += dt;
        walker.step(dt);
        master.x = walker.x;
        master.y = walker.y;
        master.heading = walker.heading;
        master.moving = walker.moving;
        master.running = walker.running;
        master.working = !walker.moving;
        dog.step(dt, t, master, open, true, () => 0);
        flock.step(dt, t, walker, { x: dog.x, y: dog.y, heading: dog.heading });
        solids.separate();
        const all = [{ name: "Galahad", x: walker.x, y: walker.y, r: walker.r, b: BUILDS.galahad }, { name: "the dog", x: dog.x, y: dog.y, r: BUILDS.dog.r, b: BUILDS.dog }, ...flock.ducks.map((d, i) => ({ name: `duck ${i}`, x: d.x, y: d.y, r: d.r, b: BUILDS.microduck }))];
        for (let a = 0; a < all.length && problems.length < 10; a++) {
          const A = all[a]!;
          if (solids.overlaps(A.x, A.y, A.r - 0.02, A.b.step, A.b.height)) problems.push(`${t.toFixed(2)} s: ${A.name} inside a solid at ${A.x.toFixed(2)},${A.y.toFixed(2)}`);
          for (let b = a + 1; b < all.length; b++) {
            const B = all[b]!;
            if (Math.hypot(A.x - B.x, A.y - B.y) < A.r + B.r - 0.03) problems.push(`${t.toFixed(2)} s: ${A.name} inside ${B.name}`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
    expect(walker.fallbacks).toBe(0);
  });

  test("the dog keeps up with him from station to station, round whatever stands between", () => {
    const { solids, walker, dog } = world();
    const master = { x: walker.x, y: walker.y, heading: walker.heading, moving: false, running: false, working: false };
    dog.place(master, () => 0);
    const dt = 1 / 60;
    let t = 0;
    for (const place of PLACES) {
      walker.go(standAt(place), obstacles());
      let far = 0;
      let after = 0;
      for (let k = 0; k < 60 * 30 && after < 3; k++, t += dt) {
        if (!walker.moving && !walker.waypoints.length) after += dt;
        walker.step(dt);
        Object.assign(master, { x: walker.x, y: walker.y, heading: walker.heading, moving: walker.moving, running: walker.running, working: !walker.moving });
        dog.step(dt, t, master, open, true, () => 0);
        solids.separate();
        far = Math.max(far, Math.hypot(dog.x - walker.x, dog.y - walker.y));
      }
      // Three seconds after he's there, it's at his side; on the way it never fell far behind.
      expect(Math.hypot(dog.x - walker.x, dog.y - walker.y)).toBeLessThan(2.2);
      expect(far).toBeLessThan(9);
    }
  });
});

describe("the dog, sent somewhere it can't go straight to", () => {
  test("its cushion, from behind the head of his bed (his sword's stand in the gap): it finds its way round and lies down there", () => {
    const solids = new Solids();
    solids.add(KEEP_COLLIDERS);
    solids.add(HEARTH_COLLIDERS, () => 0);
    const planner = new Planner(solids);
    const dog = new RobotDog(false);
    dog.join(solids, () => false, planner);
    // He's on his bed; the dog came in behind the wedge he leans on, as it does when they come down from the keep at night.
    const him = { x: BED.x, y: BED.y, heading: 0, moving: false, running: false, working: false };
    dog.place({ ...him, x: -2.2, y: -16.4 }, () => 0);
    dog.lead.on = true;
    dog.lead.x = DOG_BED.x;
    dog.lead.y = DOG_BED.y;
    dog.lead.sit = dog.lead.lie = true;
    const dt = 1 / 60;
    let inside = 0;
    for (let k = 0; k < 60 * 25; k++) {
      dog.step(dt, k * dt, him, open, true, () => 0);
      if (solids.overlaps(dog.x, dog.y, BUILDS.dog.r - 0.03, BUILDS.dog.step, BUILDS.dog.height)) inside++;
    }
    expect(Math.hypot(dog.x - DOG_BED.x, dog.y - DOG_BED.y)).toBeLessThan(0.3);
    expect(dog.lying).toBe(true);
    expect(inside).toBe(0);
  });

  test("its cushion, with him lying on his bed between it and the cushion: round his feet, never through him", () => {
    const solids = new Solids();
    solids.add(KEEP_COLLIDERS);
    solids.add(HEARTH_COLLIDERS, () => 0);
    const planner = new Planner(solids);
    // He lies on his bed: a walker among the solids like any other (nobody walks through him).
    const him = { x: BED.x, y: BED.y, heading: 0, moving: false, running: false, working: false };
    solids.join({ x: BED.x, y: BED.y, r: BUILDS.galahad.r }, BUILDS.galahad);
    const dog = new RobotDog(false);
    dog.join(solids, () => false, planner);
    // The dog came down the path with him and stands north of the bed; its cushion is against the bed's south side.
    dog.place({ ...him, x: 0.6, y: -16.6 }, () => 0);
    dog.lead.on = true;
    dog.lead.x = DOG_BED.x;
    dog.lead.y = DOG_BED.y;
    dog.lead.sit = dog.lead.lie = true;
    const dt = 1 / 60;
    let nearest = Number.POSITIVE_INFINITY;
    for (let k = 0; k < 60 * 30; k++) {
      dog.step(dt, k * dt, him, open, true, () => 0);
      solids.separate();
      nearest = Math.min(nearest, Math.hypot(dog.x - him.x, dog.y - him.y));
    }
    expect(Math.hypot(dog.x - DOG_BED.x, dog.y - DOG_BED.y)).toBeLessThan(0.3);
    expect(dog.lying).toBe(true);
    expect(nearest).toBeGreaterThan(BUILDS.galahad.r + BUILDS.dog.r - 0.06);
  });

  test("after a ball in the open it goes straight, and asks for no way round", () => {
    const solids = new Solids();
    const planner = new Planner(solids);
    const dog = new RobotDog(false);
    dog.join(solids, () => false, planner);
    const him = { x: 0, y: -20, heading: 0, moving: false, running: false, working: false };
    dog.place(him, () => 0);
    dog.lead.on = true;
    dog.lead.x = 7;
    dog.lead.y = -24;
    dog.lead.run = true;
    for (let k = 0; k < 60 * 5; k++) dog.step(1 / 60, k / 60, him, open, true, () => 0);
    expect(Math.hypot(dog.x - 7, dog.y + 24)).toBeLessThan(0.3);
    expect(planner.plans).toBe(0);
  });
});
