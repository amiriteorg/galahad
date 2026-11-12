import { describe, expect, test } from "bun:test";
import { BUILDS, CELL, NOTHING, SKIN, Solids } from "./collide.ts";
import { wantsColliders } from "./debug-colliders.ts";
import type { Collider } from "./colliders.ts";
import { rng } from "./physics.ts";

/*
 * The world of solids: the spatial hash and its batches, the questions it
 * answers (overlap, nearest, a swept circle), move-and-slide, and movers
 * giving way to each other.
 */

/** A world with one batch of colliders. */
function world(list: Collider[]): Solids {
  const s = new Solids();
  s.add(list);
  return s;
}

/** How far a circle of radius r at (x, y) is from a collider (negative: overlapping), the slow, obvious way. */
function clearance(c: Collider, x: number, y: number, r: number): number {
  if (c.kind === "circle") return Math.hypot(x - c.x, y - c.y) - c.r - r;
  const cos = Math.cos(c.yaw ?? 0);
  const sin = Math.sin(c.yaw ?? 0);
  const lx = Math.abs((x - c.x) * cos + (y - c.y) * sin) - c.hx;
  const ly = Math.abs(-(x - c.x) * sin + (y - c.y) * cos) - c.hy;
  return (lx <= 0 && ly <= 0 ? Math.max(lx, ly) : Math.hypot(Math.max(lx, 0), Math.max(ly, 0))) - r;
}

function scatter(n: number, seed: number, span = 200): Collider[] {
  const rand = rng(seed);
  const out: Collider[] = [];
  for (let i = 0; i < n; i++) {
    const x = (rand() - 0.5) * span;
    const y = (rand() - 0.5) * span;
    if (rand() < 0.5) out.push({ kind: "circle", x, y, r: 0.2 + rand() * 2.5, top: rand() * 4 });
    else out.push({ kind: "box", x, y, hx: 0.1 + rand() * 6, hy: 0.1 + rand() * 2, yaw: rand() * Math.PI, top: rand() * 4 });
  }
  return out;
}

describe("the spatial hash", () => {
  test("solids come and go in batches; a dropped batch is gone and its slots are used again", () => {
    const s = new Solids();
    const trees = s.add([{ kind: "circle", x: 0, y: 0, r: 1 }, { kind: "circle", x: 10, y: 0, r: 1 }]);
    const wall = s.add([{ kind: "box", x: 5, y: 20, hx: 30, hy: 0.3 }]);
    expect(s.size).toBe(3);
    expect(s.overlaps(0.5, 0, 0.2)).toBe(true);
    expect(s.overlaps(-22, 20.2, 0.2)).toBe(true);
    const before = s.version;
    s.remove(trees);
    expect(s.version).toBeGreaterThan(before);
    expect(s.size).toBe(1);
    expect(s.overlaps(0.5, 0, 0.2)).toBe(false);
    expect(s.overlaps(10, 0, 0.2)).toBe(false);
    expect(s.overlaps(-22, 20.2, 0.2)).toBe(true);
    // Removing it again, or a batch that never was, is nothing.
    s.remove(trees);
    s.remove(999);
    expect(s.size).toBe(1);
    const high = s.high;
    s.add([{ kind: "circle", x: 0, y: 0, r: 1 }, { kind: "circle", x: 3, y: 3, r: 1 }]);
    expect(s.high).toBe(high);
    s.remove(wall);
    expect(s.overlaps(-22, 20.2, 0.2)).toBe(false);
    // Nothing is added outside a batch.
    expect(() => s.circle(0, 0, 1)).toThrow();
    // An empty batch has no id.
    s.open();
    expect(s.close()).toBe(0);
  });

  test("it grows past its first size, and chunks of solids can be dropped in any order", () => {
    const s = new Solids();
    const batches: number[] = [];
    const all: Collider[][] = [];
    for (let k = 0; k < 40; k++) {
      const list = scatter(60, k + 1, 600);
      all.push(list);
      batches.push(s.add(list));
    }
    expect(s.size).toBe(2400);
    for (const k of [3, 17, 0, 39, 22]) {
      s.remove(batches[k]!);
      all[k] = [];
    }
    expect(s.size).toBe(2400 - 5 * 60);
    const left = all.flat();
    const rand = rng(99);
    for (let i = 0; i < 400; i++) {
      const x = (rand() - 0.5) * 600;
      const y = (rand() - 0.5) * 600;
      expect(s.overlaps(x, y, 0.6)).toBe(left.some((c) => clearance(c, x, y, 0.6) < -1e-7));
    }
  });

  test("overlap and nearest agree with the slow, obvious way, for circles and turned boxes", () => {
    const list = scatter(500, 7);
    const s = world(list);
    const rand = rng(8);
    for (let i = 0; i < 600; i++) {
      const x = (rand() - 0.5) * 210;
      const y = (rand() - 0.5) * 210;
      const r = rand() * 1.5;
      expect(s.overlaps(x, y, r)).toBe(list.some((c) => clearance(c, x, y, r) < -1e-7));
      const near = Math.min(...list.map((c) => clearance(c, x, y, 0)));
      const got = s.nearest(x, y, 6);
      if (near <= 6) expect(got).toBeCloseTo(near, 9);
      else expect(got).toBe(Infinity);
    }
  });

  test("what's low is stepped over and what's overhead is walked under", () => {
    const s = world([
      { kind: "box", x: 0, y: 0, hx: 2, hy: 2, top: 0.2 },
      { kind: "circle", x: 10, y: 0, r: 3, top: 5, bottom: 4 },
      { kind: "circle", x: 20, y: 0, r: 0.3 },
    ]);
    // A kerb: a knight steps over it, a duck doesn't.
    expect(s.overlaps(0, 0, 0.4, BUILDS.galahad.step, BUILDS.galahad.height)).toBe(false);
    expect(s.overlaps(0, 0, 0.3, BUILDS.microduck.step, BUILDS.microduck.height)).toBe(true);
    // A deck four metres up: he walks under it, but something five metres tall wouldn't.
    expect(s.overlaps(10, 0, 0.4, 0.35, 2.5)).toBe(false);
    expect(s.overlaps(10, 0, 0.4, 0.35, 5)).toBe(true);
    // Without a top, it's tall.
    expect(s.overlaps(20, 0, 0.4, 3, 100)).toBe(true);
    expect(s.sweep(-5, 0, 30, 0, 0.4, 0.35, 2.5)).toBeCloseTo((25 - 0.7) / 30, 9);
    // In the air: the camera asks about volumes. The solids stand on their own ground.
    const hill = new Solids();
    hill.add([{ kind: "circle", x: 0, y: 0, r: 2, top: 6, bottom: 3 }], () => 10);
    expect(hill.inside(0, 0, 14)).toBe(true);
    expect(hill.inside(0, 0, 12)).toBe(false);
    expect(hill.inside(0, 0, 12.8, 0.5)).toBe(true);
    expect(hill.inside(2.3, 0, 14, 0.5)).toBe(true);
    expect(hill.inside(2.6, 0, 14, 0.5)).toBe(false);
    expect(hill.far(hill.found[0]!, 5, 0, 20)).toBeCloseTo(Math.hypot(3, 4), 9);
    // A ledge to stand on: the low thing's top, where there is one.
    expect(s.ledge(1, 1, 0.35)).toBeCloseTo(0.2, 9);
    expect(s.ledge(10, 0, 0.35)).toBe(Number.NEGATIVE_INFINITY);
    expect(s.ledge(50, 50, 0.35)).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe("a circle swept along a segment", () => {
  test("it stops where it first touches: a circle, a box's side, a box's corner, a turned box", () => {
    const s = world([{ kind: "circle", x: 10, y: 0, r: 2 }]);
    expect(s.sweep(0, 0, 20, 0, 0.5)).toBeCloseTo(7.5 / 20, 9);
    expect(s.hit).toBe(0);
    expect(s.hitX).toBeCloseTo(-1, 9);
    expect(s.hitY).toBeCloseTo(0, 9);
    // Past it, alongside, or short of it: nothing.
    expect(s.sweep(0, 3, 20, 0, 0.5)).toBe(1);
    expect(s.hit).toBe(NOTHING);
    expect(s.sweep(0, 0, 7, 0, 0.5)).toBe(1);
    expect(s.sweep(0, 0, -20, 0, 0.5)).toBe(1);

    const b = world([{ kind: "box", x: 10, y: 0, hx: 2, hy: 1 }]);
    expect(b.sweep(0, 0, 20, 0, 0.5)).toBeCloseTo(7.5 / 20, 9);
    expect([b.hitX, b.hitY]).toEqual([-1, 0]);
    expect(b.sweep(10, 10, 0, -20, 0.5)).toBeCloseTo(8.5 / 20, 9);
    expect([b.hitX, b.hitY]).toEqual([0, 1]);
    // Its corner is rounded by the circle's radius: grazing past it at 45° just clears, a hair nearer touches.
    const d = 0.5 / Math.SQRT2;
    expect(b.sweep(8 - d - 3, -1 - d + 3 - 1e-6, 6, -6, 0.5)).toBe(1);
    const t = b.sweep(8 - d - 3, -1 - d + 3 + 0.1, 6, -6, 0.5);
    expect(t).toBeLessThan(1);
    expect(b.hitX).toBeLessThan(0);
    expect(b.hitY).toBeLessThan(0);

    // A box turned 45°: its corner points west, 2 m from its centre.
    const turned = world([{ kind: "box", x: 10, y: 0, hx: Math.SQRT2, hy: Math.SQRT2, yaw: Math.PI / 4 }]);
    expect(turned.sweep(0, 0, 20, 0, 0.5)).toBeCloseTo(7.5 / 20, 9);
    expect(turned.hitX).toBeCloseTo(-1, 9);
  });

  test("it agrees with small steps, whatever is in the way", () => {
    const list = scatter(300, 21, 120);
    const s = world(list);
    const rand = rng(22);
    let hits = 0;
    for (let i = 0; i < 300; i++) {
      const x = (rand() - 0.5) * 120;
      const y = (rand() - 0.5) * 120;
      const a = rand() * Math.PI * 2;
      const len = 1 + rand() * 30;
      const r = 0.2 + rand() * 0.6;
      const dx = Math.cos(a) * len;
      const dy = Math.sin(a) * len;
      // Starting clear of everything.
      if (list.some((c) => clearance(c, x, y, r) < 0.01)) continue;
      const t = s.sweep(x, y, dx, dy, r);
      // Clear all the way to the touch, and touching just past it.
      const steps = Math.ceil((len * t) / 0.05);
      for (let k = 0; k <= steps; k++) {
        const f = (t * k) / Math.max(1, steps);
        const worst = Math.min(...list.map((c) => clearance(c, x + dx * f, y + dy * f, r)));
        expect(worst).toBeGreaterThan(-1e-6);
      }
      if (t < 1) {
        hits++;
        const f = t + 1e-3 / len;
        expect(Math.min(...list.map((c) => clearance(c, x + dx * f, y + dy * f, r)))).toBeLessThan(0);
        const c = list[s.hit]!;
        expect(clearance(c, x + dx * t, y + dy * t, r)).toBeCloseTo(0, 6);
      }
    }
    expect(hits).toBeGreaterThan(50);
  });

  test("already inside something, it may leave but not go farther in", () => {
    const s = world([{ kind: "circle", x: 0, y: 0, r: 2 }, { kind: "box", x: 10, y: 0, hx: 2, hy: 1 }]);
    expect(s.sweep(1, 0, 5, 0, 0.5)).toBe(1);
    expect(s.sweep(1, 0, -5, 0, 0.5)).toBe(0);
    expect(s.hitX).toBeCloseTo(1, 9);
    expect(s.sweep(11.5, 0, 5, 0, 0.5)).toBe(1);
    expect(s.sweep(11.5, 0, -5, 0, 0.5)).toBe(0);
    expect([s.hitX, s.hitY]).toEqual([1, 0]);
  });

  test("nothing tunnels: a dash of metres a frame stops at a rail a hand wide", () => {
    const s = world([{ kind: "box", x: 50, y: 0, hx: 0.04, hy: 20 }]);
    const out = { x: 0, y: 0 };
    // 80 m/s for a tenth of a second.
    s.slide(45, 3, 8, 0.5, 0.45, 0.35, 2.5, out);
    expect(out.x).toBeLessThanOrEqual(50 - 0.04 - 0.45);
    expect(out.x).toBeGreaterThan(49.4);
    // And a kilometre in one step.
    expect(s.sweep(-500, 0, 1000, 0, 0.45)).toBeCloseTo((550 - 0.49) / 1000, 9);
  });

  test("a sweep can be told what to pass straight through", () => {
    const s = world([{ kind: "circle", x: 10, y: 0, r: 2 }, { kind: "circle", x: 20, y: 0, r: 2 }]);
    s.pass[0] = 0;
    s.passes = 1;
    expect(s.sweep(0, 0, 30, 0, 0.5)).toBeCloseTo(17.5 / 30, 9);
    expect(s.hit).toBe(1);
    s.passes = 0;
    expect(s.sweep(0, 0, 30, 0, 0.5)).toBeCloseTo(7.5 / 30, 9);
  });
});

describe("move and slide", () => {
  const out = { x: 0, y: 0 };

  test("with nothing in the way, the whole step is taken", () => {
    const s = world([{ kind: "circle", x: 100, y: 100, r: 1 }]);
    expect(s.slide(0, 0, 3, 4, 0.45, 0, 2, out)).toBe(false);
    expect(out).toEqual({ x: 3, y: 4 });
  });

  test("it slides along a wall with what's left of the step, a skin away from it", () => {
    const s = world([{ kind: "box", x: 0, y: 5, hx: 50, hy: 0.5 }]);
    expect(s.slide(0, 3, 2, 2, 0.5, 0, 2, out)).toBe(true);
    // One metre up to the wall (4.5 − 0.5 − 3), then along it.
    expect(out.y).toBeLessThanOrEqual(4);
    expect(out.y).toBeGreaterThan(4 - 2 * SKIN);
    expect(out.x).toBeCloseTo(2, 1);
    // Round a pillar: it ends beside it, not in it, and farther on than where it touched.
    const p = world([{ kind: "circle", x: 5, y: 0.3, r: 1 }]);
    p.slide(0, 0, 6, 0, 0.5, 0, 2, out);
    expect(Math.hypot(out.x - 5, out.y - 0.3)).toBeGreaterThanOrEqual(1.5);
    expect(out.x).toBeGreaterThan(3.6);
    expect(out.y).toBeLessThan(0);
  });

  test("in a corner it stops, and never ends inside anything", () => {
    const corner: Collider[] = [
      { kind: "box", x: 0, y: 5, hx: 10, hy: 0.5 },
      { kind: "box", x: 5, y: 0, hx: 0.5, hy: 10 },
    ];
    const s = world(corner);
    let x = 0;
    let y = 0;
    for (let i = 0; i < 200; i++) {
      s.slide(x, y, 0.3, 0.25, 0.5, 0, 2, out);
      x = out.x;
      y = out.y;
      for (const c of corner) expect(clearance(c, x, y, 0.5)).toBeGreaterThan(-1e-9);
    }
    expect(x).toBeCloseTo(4, 1);
    expect(y).toBeCloseTo(4, 1);
  });

  test("pressed against a wall it rests there: no jitter", () => {
    const s = world([{ kind: "box", x: 0, y: 5, hx: 50, hy: 0.5 }, { kind: "circle", x: 3, y: 4.2, r: 0.4 }]);
    let x = 0;
    let y = 3;
    const seen: number[] = [];
    for (let i = 0; i < 400; i++) {
      // Pushing up and to the right, into the wall and then the post beside it.
      s.slide(x, y, 0.02, 0.05, 0.5, 0, 2, out);
      x = out.x;
      y = out.y;
      if (i >= 300) seen.push(x, y);
    }
    for (let i = 2; i < seen.length; i++) expect(Math.abs(seen[i]! - seen[i - 2]!)).toBeLessThan(1e-9);
    expect(y).toBeLessThanOrEqual(4);
  });

  test("something that finds itself inside a solid is put outside it, the short way", () => {
    const s = world([{ kind: "box", x: 0, y: 0, hx: 4, hy: 1 }, { kind: "circle", x: 20, y: 0, r: 2 }]);
    s.slide(1, 0.7, 0, 0, 0.5, 0, 2, out);
    expect(out.x).toBeCloseTo(1, 9);
    expect(out.y).toBeGreaterThanOrEqual(1.5);
    expect(out.y).toBeLessThan(1.52);
    s.slide(21, 0, 0, 0, 0.5, 0, 2, out);
    expect(out.x).toBeGreaterThanOrEqual(22.5);
    expect(out.x).toBeLessThan(22.52);
  });

  test("random walks through a thicket never end inside anything, however long the step", () => {
    const list = scatter(400, 31, 80);
    const s = world(list);
    const rand = rng(32);
    let x = 200;
    let y = 0;
    let heading = Math.PI;
    for (let i = 0; i < 4000; i++) {
      heading += (rand() - 0.5) * 0.8;
      const len = rand() < 0.05 ? 6 : rand() * 0.4;
      s.slide(x, y, Math.cos(heading) * len, Math.sin(heading) * len, 0.45, 0, 3, out);
      // Never through anything on the way either (the step and its slide stay clear at their ends).
      x = out.x;
      y = out.y;
      // (Three rounds of pushing out leave at most a hair where three solids crowd.)
      expect(Math.min(...list.map((c) => clearance(c, x, y, 0.45)))).toBeGreaterThan(-0.02);
      if (Math.hypot(x, y) > 60) heading = Math.atan2(-y, -x);
    }
  });
});

describe("movers", () => {
  const out = { x: 0, y: 0 };

  test("the lighter gives way: a knight walks on, a duck is moved aside; two ducks share it", () => {
    const s = new Solids();
    const knight = { x: 0, y: 0, r: BUILDS.galahad.r };
    const duck = { x: 0.5, y: 0.1, r: BUILDS.microduck.r };
    s.join(knight, BUILDS.galahad);
    s.join(duck, BUILDS.microduck);
    s.separate();
    expect(knight).toEqual({ x: 0, y: 0, r: BUILDS.galahad.r });
    expect(Math.hypot(duck.x, duck.y)).toBeGreaterThanOrEqual(BUILDS.galahad.r + BUILDS.microduck.r);
    expect(duck.x).toBeGreaterThan(0.5);
    const a = { x: 10, y: 0, r: 0.3 };
    const b = { x: 10.4, y: 0, r: 0.3 };
    s.join(a, BUILDS.microduck);
    s.join(b, BUILDS.microduck);
    s.separate();
    expect(b.x - a.x).toBeGreaterThanOrEqual(0.6);
    expect(a.x).toBeCloseTo(10 - (b.x - 10.4), 9);
    // One that's away (no radius) is nobody's obstacle.
    const away = { x: 0, y: 0, r: 0 };
    s.join(away, BUILDS.machine);
    s.separate();
    expect(knight.x).toBe(0);
  });

  test("a mover walks round one no lighter than itself, and through the place of one that will give way", () => {
    const s = new Solids();
    const knight = { x: 0, y: 0, r: 0.45 };
    const duck = { x: 3, y: 0, r: 0.3 };
    const k = s.join(knight, BUILDS.galahad);
    const d = s.join(duck, BUILDS.microduck);
    // The knight's step isn't stopped by the duck.
    expect(k.slide(0, 0, 4, 0, out)).toBe(false);
    expect(out.x).toBe(4);
    // The duck's is, by the knight: it stops short of him and slides round.
    duck.x = -3;
    duck.y = 0.05;
    expect(d.slide(duck.x, duck.y, 4, 0, out)).toBe(true);
    expect(Math.hypot(out.x, out.y)).toBeGreaterThanOrEqual(0.75);
    expect(d.touched).toBe(true);
    // And a duck by a duck.
    const other = { x: -6, y: 0.05, r: 0.3 };
    s.join(other, BUILDS.microduck);
    d.slide(duck.x, duck.y, -4, 0, out);
    expect(out.x).toBeGreaterThan(-6 + 0.6 - 1e-9);
    expect(d.sweep(duck.x, duck.y, -4, 0)).toBeLessThan(1);
    expect(d.sweep(duck.x, duck.y, -4, 0, 0, false)).toBe(1);
  });

  test("pushed against a wall, the lighter slides along it or squeezes out sideways rather than into the wall", () => {
    const wall: Collider[] = [{ kind: "box", x: 0, y: 2, hx: 20, hy: 0.5 }];
    const s = world(wall);
    const knight = { x: 0, y: 0, r: 0.45 };
    const duck = { x: 0, y: 1.19, r: 0.3 };
    const k = s.join(knight, BUILDS.galahad);
    s.join(duck, BUILDS.microduck);
    // He walks straight at the wall with the duck between: it must not end in the wall, nor in him.
    for (let i = 0; i < 120; i++) {
      k.slide(knight.x, knight.y, 0, 0.03, out);
      knight.x = out.x;
      knight.y = out.y;
      s.separate();
      expect(clearance(wall[0]!, duck.x, duck.y, 0.3)).toBeGreaterThan(-1e-6);
    }
    expect(knight.y).toBeGreaterThan(1);
    expect(Math.hypot(duck.x - knight.x, duck.y - knight.y)).toBeGreaterThanOrEqual(0.75 - 1e-3);
    expect(Math.abs(duck.x)).toBeGreaterThan(0.3);
  });

  test("a machine on the move pushes everyone, the knight too", () => {
    const s = new Solids();
    const knight = { x: 0, y: 0, r: 0.45 };
    const rover = { x: -3, y: 0.1, r: 1.2 };
    s.join(knight, BUILDS.galahad);
    s.join(rover, BUILDS.machine);
    for (let i = 0; i < 60; i++) {
      rover.x += 0.05;
      s.separate();
    }
    expect(rover.x).toBeCloseTo(0, 9);
    expect(Math.hypot(knight.x - rover.x, knight.y - rover.y)).toBeGreaterThanOrEqual(1.65);
  });
});

describe("many movers", () => {
  /** A crowd among some solids: walkers of every build, a few machines too wide for a cell, and some that are away. */
  const crowd = (seed: number, n: number, span: number) => {
    const s = new Solids();
    s.add(scatter(200, 7, span * 1.5));
    const rand = rng(seed);
    const at = Array.from({ length: n }, (_, i) => ({ x: (rand() - 0.5) * span, y: (rand() - 0.5) * span, r: i % 97 === 0 ? 1.6 : i % 5 === 0 ? 0 : 0.2 + rand() * 0.4 }));
    at.forEach((c, i) => s.join(c, i % 97 === 0 ? BUILDS.machine : i % 3 === 0 ? BUILDS.deer : i % 3 === 1 ? BUILDS.rabbit : BUILDS.microduck));
    return { s, at };
  };

  test("each is tried only against those near it, and they end exactly where trying every pair puts them", () => {
    for (const seed of [1, 2, 3]) {
      const near = crowd(seed, 600, 70);
      const every = crowd(seed, 600, 70);
      let parted = 0;
      for (let frame = 0; frame < 25; frame++) {
        // Everyone drifts a little, the same in both worlds; now and then someone goes away or comes back.
        const rand = rng(seed * 1000 + frame);
        for (let i = 0; i < near.at.length; i++) {
          const dx = (rand() - 0.5) * 0.3;
          const dy = (rand() - 0.5) * 0.3;
          const flip = rand() < 0.01 && i % 97 !== 0;
          for (const world of [near, every]) {
            const c = world.at[i]!;
            c.x += dx;
            c.y += dy;
            if (flip) c.r = c.r > 0 ? 0 : 0.35;
          }
        }
        const before = near.at.map((c) => c.x + c.y);
        near.s.separate();
        every.s.separate(true);
        for (let i = 0; i < near.at.length; i++) {
          expect(near.at[i]).toEqual(every.at[i]!);
          if (near.at[i]!.x + near.at[i]!.y !== before[i]) parted++;
        }
      }
      // (And it's a crowd: plenty of them were in each other's way.)
      expect(parted).toBeGreaterThan(300);
    }
  });

  test("an ecosystem's worth of walkers costs what's near each, not every pair of them", () => {
    // Three thousand spread over half a kilometre, as animals are: compared in the same run, the fastest of several
    // batches each way, so a busy machine slows both alike.
    const fastest = (everyPair: boolean): number => {
      const { s, at } = crowd(11, 3000, 500);
      const rand = rng(12);
      let best = Infinity;
      for (let batch = 0; batch < 5; batch++) {
        for (const c of at) {
          c.x += (rand() - 0.5) * 0.2;
          c.y += (rand() - 0.5) * 0.2;
        }
        const started = performance.now();
        for (let i = 0; i < 4; i++) s.separate(everyPair);
        best = Math.min(best, (performance.now() - started) / 4);
      }
      return best;
    };
    const every = fastest(true);
    const near = fastest(false);
    console.log(`separating 3000 movers: every pair ${every.toFixed(2)} ms, those near ${near.toFixed(3)} ms`);
    expect(near).toBeLessThan(every / 8);
  });
});

describe("the cost", () => {
  test("a frame's questions cost the same in a dense forest as in a sparse one, and little", () => {
    // 60 movers among 12 000 solids over 800 m, and among 1 200: a spatial hash asks only what's near,
    // so the forest's size mustn't matter. Compared in the same run, fastest of several batches, so a
    // busy machine (the whole suite running) slows both alike and can't fail it: no wall-clock bound
    // on its own, only a loose one against something pathological.
    const world = (layers: number) => {
      const s = new Solids();
      for (let k = 0; k < layers; k++) s.add(scatter(100, 100 + k, 800));
      const rand = rng(5);
      const movers = Array.from({ length: 60 }, () => s.join({ x: (rand() - 0.5) * 60, y: (rand() - 0.5) * 60, r: 0.3 }, BUILDS.microduck));
      const out = { x: 0, y: 0 };
      return (i: number) => {
        for (const m of movers) {
          const a = i * 0.01 + m.index;
          m.slide(m.at.x, m.at.y, Math.cos(a) * 0.03, Math.sin(a) * 0.03, out);
          m.at.x = out.x;
          m.at.y = out.y;
        }
        s.separate();
        s.sweep(0, 0, 25, 3, 0.5);
      };
    };
    const fastest = (frame: (i: number) => void) => {
      for (let i = 0; i < 300; i++) frame(i);
      let best = Infinity;
      for (let batch = 0; batch < 6; batch++) {
        const started = performance.now();
        for (let i = 0; i < 300; i++) frame(i);
        best = Math.min(best, (performance.now() - started) / 300);
      }
      return best;
    };
    const dense = fastest(world(120));
    const sparse = fastest(world(12));
    // (Measured at about 0.03 ms a frame either way.)
    expect(dense).toBeLessThan(sparse * 4 + 0.02);
    expect(dense).toBeLessThan(1);
    expect(CELL).toBeGreaterThan(0);
  });
});

describe("the debug view", () => {
  test("it's asked for by the page's ?colliders=1 (or on, true), and only then", () => {
    expect(wantsColliders("?colliders=1")).toBe(true);
    expect(wantsColliders("?tier=low&colliders=on")).toBe(true);
    expect(wantsColliders("?colliders=true&x=2")).toBe(true);
    for (const off of ["", "?colliders=0", "?colliders=10", "?nocolliders=1", "?colliders"]) expect(wantsColliders(off)).toBe(false);
  });
});
