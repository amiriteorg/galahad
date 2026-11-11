import { describe, expect, test } from "bun:test";
import type { HeartbeatFinding } from "@galahad/core/world";
import { BUILDS, Solids } from "./collide.ts";
import { ballFlight, Care, type CareDog, type CareField, type CareFrame, CRITICAL, DOCK, DOCK_COLLIDERS, DOCK_STAND, FULL, LOW, lodestarPulse, ROUND_PLANE, stepCharge, WALK } from "./care.ts";
import { DECK_REST } from "./keep-deck.ts";
import { fleetColliders, KEEP_COLLIDERS } from "./keep-plan.ts";
import { MicroduckFlock } from "./microducks.ts";
import { standAt } from "./path.ts";

/*
 * His care, without a GPU: the lodestar's pulse, the dog's battery, the ball's flight,
 * the dock's place among the keep's solids, and the choreography stepped frame by frame
 * with stand-ins for the dog, the ducks and the proving ground.
 */

describe("his heart", () => {
  test("a soft lub-dub at rest, the same every beat; a strong beat when a heartbeat runs, that fades", () => {
    let rest = 0;
    for (let t = 0; t < 5; t += 0.01) rest = Math.max(rest, lodestarPulse(t, -1));
    expect(rest).toBeGreaterThan(0.2);
    expect(rest).toBeLessThan(0.45);
    expect(lodestarPulse(0.1, -1)).toBeCloseTo(lodestarPulse(1.35, -1), 9);
    let strong = 0;
    for (let s = 0; s < 2; s += 0.01) strong = Math.max(strong, lodestarPulse(0.6, s));
    expect(strong).toBeGreaterThan(1);
    expect(lodestarPulse(0.6, 6)).toBe(lodestarPulse(0.6, -1));
  });
});

describe("the dog's battery", () => {
  test("drains as it goes, faster running; charges on its dock; stays between 0 and 1", () => {
    expect(stepCharge(0.5, 10, 0, false)).toBeLessThan(0.5);
    expect(0.5 - stepCharge(0.5, 10, 6, false)).toBeGreaterThan(2 * (0.5 - stepCharge(0.5, 10, 0, false)));
    expect(stepCharge(0.5, 10, 6, true)).toBeGreaterThan(0.5);
    expect(stepCharge(0.001, 100, 6, false)).toBe(0);
    expect(stepCharge(0.999, 100, 0, true)).toBe(1);
  });

  test("a full charge lasts a good while at a trot; from low to full takes a couple of minutes", () => {
    let c = 1;
    let s = 0;
    while (c > LOW) {
      c = stepCharge(c, 1, 1.5, false);
      s++;
    }
    expect(s).toBeGreaterThan(8 * 60);
    c = LOW;
    s = 0;
    while (c < FULL) {
      c = stepCharge(c, 1, 0, true);
      s++;
    }
    expect(s).toBeLessThan(150);
    expect(CRITICAL).toBeLessThan(LOW);
  });

  test("its dock stands clear of the keep, its stairs and every banner of a full fleet; the dog fits on it, he fits beside it", () => {
    const solids = new Solids();
    solids.add(KEEP_COLLIDERS);
    solids.add(fleetColliders(Array.from({ length: 16 }, (_, i) => i % 3 === 0)));
    const dog = solids.join({ x: DOCK.x, y: DOCK.y, r: BUILDS.dog.r }, BUILDS.dog);
    const him = solids.join({ x: DOCK_STAND.x, y: DOCK_STAND.y, r: BUILDS.galahad.r }, BUILDS.galahad);
    expect(dog.fits(DOCK.x, DOCK.y, 0.05)).toBe(true);
    expect(him.fits(DOCK_STAND.x, DOCK_STAND.y, 0.05)).toBe(true);
    // Its own post doesn't stand where the dog sits, or where he stands.
    solids.add(DOCK_COLLIDERS);
    expect(dog.fits(DOCK.x, DOCK.y, 0)).toBe(true);
    expect(him.fits(DOCK_STAND.x, DOCK_STAND.y, 0)).toBe(true);
    // And it's off the way to the stairs (he stands at the keep's door).
    const door = standAt("keep");
    expect(Math.hypot(DOCK.x - door.x, DOCK.y - door.y)).toBeGreaterThan(2);
  });
});

describe("the ball", () => {
  test("leaves his hand, arcs well over the ground, and lands where it was thrown with a hop or two", () => {
    const out: [number, number, number] = [0, 0, 0];
    expect(ballFlight(0, 0, 2.1, 7, 0, 0, 0, out)).toEqual([0, 0, 2.1]);
    let top = 0;
    for (let u = 0; u <= 1; u += 0.01) {
      ballFlight(0, 0, 2.1, 7, 0, 0, u, out);
      expect(out[2]).toBeGreaterThanOrEqual(0.1);
      top = Math.max(top, out[2]);
    }
    expect(top).toBeGreaterThan(2.3);
    ballFlight(0, 0, 2.1, 7, 0, 0, 1, out);
    expect(out[0]).toBeCloseTo(7, 9);
    expect(out[2]).toBeCloseTo(0.11, 9);
  });
});

// ---------- the choreography, stepped ----------

function world(opts: { motion?: boolean } = {}) {
  const dog: CareDog & { x: number; y: number } = {
    x: 0,
    y: -9,
    lead: { on: false, x: 0, y: 0, sit: false, run: false, faceX: Number.NaN, faceY: Number.NaN },
    mood: { wag: 0.5, ears: 0.6, eye: 1 },
    charge: { value: 1 },
    mouth: (out) => {
      out[0] = dog.x;
      out[1] = dog.y;
      out[2] = 0.4;
      return out;
    },
  };
  const ground = { height: () => 0, blocked: () => false };
  const flock = new MicroduckFlock(6, ground);
  const swapped: number[] = [];
  const field: CareField & { residents: { plane: { phase: string }; rover: { pose: { x: number; y: number } }; drone: { mode: string } } } = {
    residents: { plane: { phase: "idle" }, rover: { pose: { x: -150, y: 20 } }, drone: { mode: "flying" } },
    preflight: false,
    swapBattery: () => void swapped.push(1),
  };
  let talking = 0;
  const care = new Care(dog, flock, field, (on) => (talking = on));
  let now = Date.parse("2026-11-11T11:00:00Z");
  const him = { x: 0, y: -8.5, heading: Math.PI / 2, moving: false };
  const frame: CareFrame = {
    now,
    dt: 1 / 30,
    t: 0,
    motion: opts.motion ?? true,
    working: false,
    concern: null,
    galahad: him,
    dog: { x: 0, y: 0, speed: 0 },
    nodeSpot: (id, out) => {
      if (id !== "n_rack") return false;
      out.x = 7;
      out.y = -9.7;
      return true;
    },
    height: () => 0,
    wet: () => false,
  };
  /** Steps `seconds`; he walks straight to his target (as the walker would) and the dog to its lead (or beside him). */
  const run = (seconds: number) => {
    for (let s = 0; s < seconds; s += frame.dt) {
      now += frame.dt * 1000;
      frame.now = now;
      frame.t += frame.dt;
      const out = care.step(frame);
      const t = out.target;
      const d = Math.hypot(t.x - him.x, t.y - him.y);
      const step = 6 * frame.dt;
      if (out.intent !== "work" && d > 0.01) {
        him.moving = d > step;
        him.x += d > step ? ((t.x - him.x) / d) * step : t.x - him.x;
        him.y += d > step ? ((t.y - him.y) / d) * step : t.y - him.y;
        if (!him.moving) him.heading = t.facing;
      } else him.moving = false;
      const lx = dog.lead.on ? dog.lead.x : him.x + 1;
      const ly = dog.lead.on ? dog.lead.y : him.y - 0.5;
      const dd = Math.hypot(lx - dog.x, ly - dog.y);
      const ds = Math.min(dd, (dog.lead.run ? 6 : 3) * frame.dt);
      if (dd > 1e-6) {
        dog.x += ((lx - dog.x) / dd) * ds;
        dog.y += ((ly - dog.y) / dd) * ds;
      }
      frame.dog.x = dog.x;
      frame.dog.y = dog.y;
      frame.dog.speed = ds / frame.dt;
    }
    return care.out;
  };
  return { care, dog, flock, field, frame, him, run, swapped, talking: () => talking };
}

describe("his day, stepped", () => {
  test("at work, care leaves him to the stream; under reduced motion he rests on the deck", () => {
    const w = world();
    w.frame.working = true;
    const before = w.care.out.key;
    expect(w.run(2).intent).toBe("work");
    expect(w.care.out.label).toBe("");
    expect(w.care.out.key).toBe(before);
    const still = world({ motion: false });
    const out = still.run(1);
    expect(out.intent).toBe("still");
    expect([out.target.x, out.target.y]).toEqual([DECK_REST.x, DECK_REST.y]);
  });

  test("what needs you: he goes to a silent node's spot, and stays there concerned until it's resolved", () => {
    const w = world();
    const silent: HeartbeatFinding = { key: "node-offline:n_rack", severity: "warn", title: "rack is offline", place: "node", node: "n_rack" };
    w.frame.concern = silent;
    const out = w.run(6);
    expect(out.intent).toBe("concern");
    expect(out.label).toBe("Needs you: rack is offline");
    expect(Math.hypot(out.target.x - 7, out.target.y + 9.7)).toBeCloseTo(2.3, 5);
    expect(out.thinking).toBe(true);
    expect(out.attention).toMatchObject({ on: true, x: 7, y: -9.7 });
    // Disk: the workshop's racks; a sandbox: the forge.
    w.frame.concern = { key: "disk:n_self", severity: "alert", title: "ultra is low on disk", place: "racks", node: null };
    expect(w.run(0.1).target.y).toBeGreaterThan(15);
    w.frame.concern = { key: "sandbox-overdue:x", severity: "warn", title: "Sandbox x outlived its time", place: "forge", node: null };
    expect(w.run(0.1).target).toMatchObject({ x: standAt("forge").x, y: standAt("forge").y });
    // Resolved (or dismissed): back to his day.
    w.frame.concern = null;
    expect(w.run(0.1).intent).toBe("life");
  });

  test("the dog's battery runs low: he walks it to its dock, it sits there, he pats it, and it stays till it's full", () => {
    const w = world();
    w.care.forced = "library";
    w.care.charge = LOW - 0.01;
    let out = w.run(0.2);
    expect(out.intent).toBe("charge");
    expect([out.target.x, out.target.y]).toEqual([DOCK_STAND.x, DOCK_STAND.y]);
    expect(w.dog.lead).toMatchObject({ on: true, x: DOCK.x, y: DOCK.y, sit: true });
    out = w.run(8);
    expect(w.care.docked).toBe(true);
    // Settled and patted, he goes on with his day; it stays on its dock, charging.
    out = w.run(4);
    expect(out.intent).toBe("life");
    expect(w.dog.lead).toMatchObject({ on: true, x: DOCK.x, y: DOCK.y });
    expect(w.dog.charge.value).toBeGreaterThan(LOW);
    // Its mood shows: tired while it was low (ears drooped, eye dim); full, it comes back to him.
    for (let i = 0; i < 200 && w.care.docked; i++) w.run(1);
    expect(w.care.docked).toBe(false);
    expect(w.care.charge).toBeGreaterThanOrEqual(FULL - 0.01);
    w.run(0.1);
    expect(w.dog.lead.on).toBe(false);
  });

  test("walking the dog: three throws it fetches and brings back, a pat, then on to the next spot", () => {
    const w = world();
    w.care.forced = "walk-dog";
    let out = w.run(6);
    expect([out.target.x, out.target.y]).toEqual([WALK[0]!.x, WALK[0]!.y]);
    const seen = new Set<string>();
    let threw = false;
    for (let i = 0; i < 900 && out.target.x === WALK[0]!.x; i++) {
      out = w.run(0.1);
      seen.add(w.care.ball);
      if (out.pose.throw > 0) threw = true;
    }
    expect(threw).toBe(true);
    // (It waits where the ball comes down, so the ball rests on the grass a moment at most.)
    for (const state of ["carried", "flying", "held"]) expect(seen.has(state as never)).toBe(true);
    expect([out.target.x, out.target.y]).toEqual([WALK[1]!.x, WALK[1]!.y]);
    // Playing made it happy.
    expect(w.dog.mood.wag).toBeGreaterThan(0.5);
  });

  test("the proving ground: round the aircraft before it flies (held at its tie-down), then the quadcopter's battery swapped", () => {
    const w = world();
    w.care.forced = "field";
    const targets = new Set<string>();
    let held = false;
    for (let i = 0; i < 700 && !w.swapped.length; i++) {
      const out = w.run(0.1);
      targets.add(`${out.target.x.toFixed(2)},${out.target.y.toFixed(2)}`);
      if (w.field.preflight) held = true;
      // The quad lands while he's at its pad.
      if (i === 400) w.field.residents.drone.mode = "charging";
    }
    expect(held).toBe(true);
    for (const [x, y] of ROUND_PLANE) expect(targets.has(`${x.toFixed(2)},${y.toFixed(2)}`)).toBe(true);
    expect(w.swapped.length).toBe(1);
    expect(w.field.preflight).toBe(false);
    // An aircraft that's away flying isn't held for a walk-round.
    const away = world();
    away.care.forced = "field";
    away.field.residents.plane.phase = "circuit";
    away.run(3);
    expect(away.field.preflight).toBe(false);
  });

  test("his friends gather round when he visits; at the council table he and Reachy talk", () => {
    const w = world();
    w.care.forced = "friends";
    let gathered = false;
    for (let i = 0; i < 200; i++) {
      w.run(0.1);
      if (w.flock.gather.on) gathered = true;
    }
    expect(gathered).toBe(true);
    const c = world();
    c.care.forced = "council";
    const out = c.run(20);
    expect(out.pose.tilt).toBe(1);
    expect(c.talking()).toBe(1);
  });

  test("work interrupts his day; when it's done he picks it up where it would be", () => {
    const w = world();
    w.care.forced = "library";
    const first = { ...w.run(5).target };
    w.frame.working = true;
    w.run(3);
    w.frame.working = false;
    const back = w.run(0.1);
    expect(back.intent).toBe("life");
    expect({ x: back.target.x, y: back.target.y }).toEqual({ x: first.x, y: first.y });
  });

  test("costs next to nothing a frame", () => {
    const w = world();
    w.care.forced = "walk-dog";
    w.run(1);
    const t0 = performance.now();
    w.run(1000 / 30);
    const per = (performance.now() - t0) / 1000;
    // A thousand frames of care (and the test's own stepping) well within a frame's budget each.
    expect(per).toBeLessThan(0.05);
    console.log(`care: ${(per * 1000).toFixed(1)} µs a frame`);
  });
});
