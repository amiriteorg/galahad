import { describe, expect, test } from "bun:test";
import { BUILDS, Solids } from "./collide.ts";
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
