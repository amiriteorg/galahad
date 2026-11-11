import { describe, expect, test } from "bun:test";
import { PADS } from "@galahad/core/world";
import { ARM, ARM_REST, armReach, armTip, inLimits, joints, LIMITS } from "./hall-arm.ts";
import { Cart, CART_ACCEL, CART_PATH, CART_SPEED, Lane } from "./hall-cart.ts";
import { droneAt, ENDURANCE, LEG, legFoot, shakeAt } from "./hall-cells.ts";
import { Cutaway, cutAt, CUT_NORTH, CUT_ROOF, CUT_WEST, EASE, KERB, ROOF_OPEN, reachFor } from "./hall-cutaway.ts";
import { HallFlow, TOTE_SLOTS } from "./hall-flow.ts";
import {
  CART,
  CART_LANE,
  CELLS,
  DISPATCH,
  FARM,
  GANTRY,
  HALL,
  HALL_AISLE,
  HALL_CLEARWAYS,
  HALL_COLLIDERS,
  HALL_DOOR,
  HALL_EAVES,
  HALL_SOLIDS,
  HALL_WALLS,
  inCollider,
  LINE,
  printerX,
  stopX,
} from "./hall-plan.ts";
import { BIG_PARTS, BigJob, EJECT_TIME, newPose, PARTS, PRINTER, PrintJob } from "./hall-print.ts";
import { Workshop } from "./hall.ts";
import { planPath, plotGate, type Point, obstacles } from "./path.ts";
import { TIERS } from "./tiers.ts";

/*
 * The workshop hall: that it stays walkable (nothing solid in the door, the
 * aisle, before a cell's gate, or on his way between them; everything solid
 * inside the walls), how it opens for the camera, and the machines' kinematics:
 * printers that lay a part down layer by layer and sweep it off, six-axis arms
 * that reach where they're told, a cart that keeps to its lane and stops for
 * Galahad, residents that never slip or sink, and a floor's worth of work in
 * which no part is ever lost or in two places at once.
 */

const corners = (c: (typeof HALL_COLLIDERS)[number]): [number, number][] => {
  if (c.kind === "circle") return [[c.x - c.r, c.y - c.r], [c.x + c.r, c.y + c.r]];
  const cos = Math.cos(c.yaw ?? 0);
  const sin = Math.sin(c.yaw ?? 0);
  const out: [number, number][] = [];
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) out.push([c.x + sx * c.hx * cos - sy * c.hy * sin, c.y + sx * c.hx * sin + sy * c.hy * cos]);
  return out;
};

/** Every 20 cm along a path from `from`. */
function* walk(from: Point, path: readonly Point[]): Generator<Point> {
  let a = from;
  for (const b of path) {
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.2));
    for (let i = 0; i <= n; i++) yield { x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n };
    a = b;
  }
}

const rectHits = (r: { x: number; y: number; hx: number; hy: number }, c: (typeof HALL_COLLIDERS)[number]): boolean => {
  // A collider touches a rectangle if any point of a fine grid over the rectangle is in it.
  for (let i = 0; i <= 40; i++) {
    for (let j = 0; j <= 20; j++) {
      const x = r.x - r.hx + (2 * r.hx * i) / 40;
      const y = r.y - r.hy + (2 * r.hy * j) / 20;
      if (inCollider(c, x, y)) return true;
    }
  }
  return false;
};

describe("the hall stays walkable", () => {
  const place = new Workshop({ tier: TIERS.high, shadows: true, ground: () => 0 });
  const all = [...HALL_COLLIDERS, ...place.colliders];

  test("every collider (the plan's and the place's) stands inside the hall, walls included", () => {
    for (const c of all) {
      for (const [x, y] of corners(c)) {
        expect(Math.abs(x - HALL.x)).toBeLessThanOrEqual(HALL.hx + 0.31);
        expect(Math.abs(y - HALL.y)).toBeLessThanOrEqual(HALL.hy + 0.31);
      }
    }
    // Inside the walls proper: everything but the walls themselves.
    for (const s of HALL_SOLIDS) for (const [x, y] of corners(s.collider)) expect(Math.abs(x - HALL.x) <= HALL.hx - 0.29 && Math.abs(y - HALL.y) <= HALL.hy - 0.29).toBe(true);
  });

  test("nothing solid stands in the door, the aisle or before a cell's gate", () => {
    expect(HALL_CLEARWAYS.length).toBe(2 + CELLS.length);
    for (const r of HALL_CLEARWAYS) for (const c of all) expect(rectHits(r, c)).toBe(false);
    // The door is a real opening in the wall, as wide as the plan says.
    for (const w of HALL_WALLS) for (let y = HALL_DOOR.y - HALL_DOOR.half + 0.01; y < HALL_DOOR.y + HALL_DOOR.half; y += 0.25) expect(inCollider(w, HALL_DOOR.x, y)).toBe(false);
  });

  test("from the door to each cell's gate and between the gates, he never comes within his reach of anything solid", () => {
    const obs = obstacles();
    const gates = PADS.filter((p) => p.site === "hall").map((p) => plotGate(p));
    const from = { x: HALL_DOOR.x - 10, y: HALL_DOOR.y + 1 };
    const legs: [Point, Point][] = [];
    for (const g of gates) {
      legs.push([from, g]);
      for (const h of gates) if (h !== g) legs.push([g, h]);
    }
    for (const [a, b] of legs) {
      for (const p of walk(a, planPath(a, b, obs))) {
        for (const c of all) expect(inCollider(c, p.x, p.y, 0.45)).toBe(false);
      }
    }
  });

  test("the cart's lane is clear of everything solid, and it crosses the aisle square to it", () => {
    const pose = { x: 0, y: 0, heading: 0 };
    for (let s = 0; s <= CART_PATH.length; s += 0.1) {
      CART_PATH.at(s, pose);
      // Its footprint: the cart's half-length along the lane, its half-width across, a hand's breadth spare.
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]] as const) {
        const x = pose.x + Math.cos(pose.heading) * a * CART.length * 0.5 - Math.sin(pose.heading) * b * CART.width * 0.5;
        const y = pose.y + Math.sin(pose.heading) * a * CART.length * 0.5 + Math.cos(pose.heading) * b * CART.width * 0.5;
        for (const c of HALL_COLLIDERS) expect(inCollider(c, x, y, 0.05)).toBe(false);
      }
      if (Math.abs(pose.y) < HALL_AISLE) expect(Math.abs(Math.cos(pose.heading))).toBeLessThan(1e-9);
    }
  });

  test("the cells' gates are where the path planner sends him, on the aisle", () => {
    for (const cell of CELLS) {
      const g = plotGate(cell);
      expect(Math.abs(g.y - HALL.y)).toBeLessThanOrEqual(HALL_AISLE);
      expect(g.x).toBe(cell.x);
      expect(cell.beacon.x - cell.x).toBeGreaterThan(1.5);
    }
  });
});

describe("the cutaway", () => {
  const settle = (c: Cutaway, cx: number, cy: number, ch: number, fx: number, fy: number, d: number) => {
    for (let i = 0; i < 60; i++) c.step(cx, cy, ch, fx, fy, d, 1 / 30, true);
  };

  test("followed indoors, under the roof, nothing dissolves", () => {
    const c = new Cutaway();
    settle(c, 108, 2, 3.4, 112, 4.6, 10);
    expect(c.active).toBe(true);
    expect(c.roof).toBe(0);
    expect([...c.walls]).toEqual([0, 0, 0, 0, 0]);
  });

  test("from above, the roof goes; from outside, the wall between goes, but not its kerb, and not the others", () => {
    const c = new Cutaway();
    settle(c, 60, -30, 25, HALL.x, HALL.y, 50);
    expect(c.roof).toBe(1);
    expect(c.walls[CUT_WEST]).toBe(1);
    expect(c.walls[4]).toBe(1);
    expect(c.walls[CUT_NORTH]).toBe(0);
    expect(cutAt(c, CUT_WEST, KERB - 0.1)).toBe(0);
    expect(cutAt(c, CUT_WEST, 3)).toBe(1);
    expect(cutAt(c, CUT_NORTH + CUT_ROOF, 10)).toBe(1);
    expect(cutAt(c, CUT_NORTH, 3)).toBe(0);
  });

  test("it eases over a third of a second, and is shut when the focus is elsewhere", () => {
    const c = new Cutaway();
    c.step(HALL.x, HALL.y, 30, HALL.x, HALL.y, 40, 0.1, true);
    expect(c.roof).toBeCloseTo(0.1 / EASE, 6);
    settle(c, HALL.x, HALL.y, 30, HALL.x, HALL.y, 40);
    expect(c.roof).toBe(1);
    settle(c, 0, 0, 30, 0, 0, 40);
    expect(c.roof).toBe(0);
    expect(c.active).toBe(false);
    // Under reduced motion, at once.
    c.step(HALL.x, HALL.y, 30, HALL.x, HALL.y, 40, 0.01, false);
    expect(c.roof).toBe(1);
  });

  test("a camera hovering at a threshold doesn't flicker", () => {
    const c = new Cutaway();
    settle(c, HALL.x, HALL.y, ROOF_OPEN + 0.1, HALL.x, HALL.y, 25);
    expect(c.roof).toBe(1);
    for (let i = 0; i < 30; i++) {
      c.step(HALL.x, HALL.y, ROOF_OPEN - 0.2 + (i % 2) * 0.3, HALL.x, HALL.y, 25, 1 / 30, true);
      expect(c.roof).toBe(1);
    }
  });

  test("walking in at the door, the front stays whole until he's through it", () => {
    expect(reachFor(10)).toBeLessThan(0);
    const c = new Cutaway();
    settle(c, HALL_DOOR.x - 12, 0, 3, HALL_DOOR.x - 1, 0, 10);
    expect(c.active).toBe(false);
    expect(c.walls[CUT_WEST]).toBe(0);
    settle(c, HALL_DOOR.x - 6, 0, 3, HALL_DOOR.x + 3, 0, 10);
    expect(c.walls[CUT_WEST]).toBe(1);
  });
});

describe("the printers", () => {
  test("each layer's toolpath stays on the bed, and the nozzle is always above the part it's laying", () => {
    for (const shape of Object.values(PARTS)) {
      const job = new PrintJob(shape);
      const pose = newPose();
      for (let t = 0; t < job.printTime; t += job.printTime / 997) {
        job.pose(t, pose);
        expect(Math.abs(pose.headX)).toBeLessThanOrEqual(PRINTER.reach);
        expect(Math.abs(pose.headY)).toBeLessThanOrEqual(PRINTER.reach);
        // The part's top (on the sinking bed) never rises above the nozzle's tip.
        expect(pose.bed + pose.printed).toBeLessThanOrEqual(PRINTER.nozzle + 1e-9);
        expect(pose.bed + pose.printed).toBeGreaterThan(PRINTER.nozzle - 2 * PRINTER.layer - 1e-9);
      }
    }
  });

  test("it lays the part down layer by layer, never shrinking, to its full height", () => {
    const job = new PrintJob(PARTS.gear);
    const pose = newPose();
    let last = 0;
    let lastBed = PRINTER.nozzle;
    for (let t = 0; t <= job.printTime; t += 0.05) {
      job.pose(t, pose);
      expect(pose.printed).toBeGreaterThanOrEqual(last - 1e-12);
      expect(pose.bed).toBeLessThanOrEqual(lastBed + 1e-12);
      last = pose.printed;
      lastBed = pose.bed;
    }
    job.pose(job.printTime + 0.01, pose);
    expect(pose.printed).toBeCloseTo(PARTS.gear.height, 9);
    expect(job.layers).toBe(Math.round(PARTS.gear.height / PRINTER.layer));
  });

  test("the sweeper pushes the part off the bed only once the bed is down, and the bed comes back up for the next", () => {
    const job = new PrintJob(PARTS.bracket);
    const pose = newPose();
    let gone = false;
    for (let t = job.printTime; t <= job.duration; t += 0.02) {
      job.pose(t, pose);
      if (pose.partY < 0 && !pose.gone) expect(pose.bed).toBeCloseTo(PRINTER.eject, 9);
      // The bar is behind the part, touching it once it pushes (never through it).
      if (!pose.gone) expect(pose.bar - PRINTER.bar).toBeGreaterThanOrEqual(pose.partY + job.back - 1e-9);
      if (pose.gone) gone = true;
    }
    expect(gone).toBe(true);
    job.pose(job.duration, pose);
    expect(pose.bed).toBeCloseTo(PRINTER.nozzle, 9);
    expect(pose.bar).toBeCloseTo(PRINTER.bed, 9);
    expect(job.duration).toBeCloseTo(job.printTime + EJECT_TIME, 9);
  });

  test("the large-format printer lifts its head a layer at a time and parks it clear above the part for the crane", () => {
    for (const shape of Object.values(BIG_PARTS)) {
      const job = new BigJob(shape);
      const out = { x: 0, y: 0, z: 0, printed: 0, progress: 0 };
      for (let t = 0; t < job.printTime; t += job.printTime / 499) {
        job.pose(t, out);
        expect(out.z).toBeGreaterThanOrEqual(out.printed - 1e-9);
        expect(Math.hypot(out.x, out.y)).toBeLessThan(GANTRY.bed.hx);
      }
      job.pose(job.printTime + 5, out);
      expect(out.z).toBeGreaterThan(shape.height + 0.5);
      // Done within a few minutes, so the crane is seen at work.
      expect(job.printTime).toBeLessThan(300);
    }
  });
});

describe("the six-axis arms", () => {
  test("they reach where they're told, tool straight down and turned as asked, within their joints' limits", () => {
    const q = joints();
    const tip: [number, number, number] = [0, 0, 0];
    for (const [x, y, z, yaw] of [
      [1.2, 0.3, 0.4, 0.3],
      [0, 1.4, 0.9, -1],
      [-0.9, -0.8, 0.2, 2.5],
      [1.5, 0, 0.6, 0],
    ] as const) {
      expect(armReach(x, y, z, yaw, q)).toBe(true);
      armTip(q, tip);
      expect(Math.hypot(tip[0] - x, tip[1] - y, tip[2] - z)).toBeLessThan(1e-9);
      expect(inLimits(q)).toBe(true);
      // Straight down: the shoulder, elbow and wrist pitch add up to a half turn.
      expect(q[1]! + q[2]! + q[4]!).toBeCloseTo(Math.PI, 9);
      expect(Math.atan2(Math.sin(q[0]! + Math.PI - q[5]! - yaw), Math.cos(q[0]! + Math.PI - q[5]! - yaw))).toBeCloseTo(0, 9);
    }
    expect(armReach(5, 0, 0, 0, q)).toBe(false);
  });

  test("every place the assembly arms work is in reach: the tote's slots at the dock, the carriers, the screw feeder", () => {
    const q = joints();
    const end = { x: 0, y: 0, heading: 0 };
    CART_PATH.at(CART_PATH.length, end);
    const [picker, fastener] = LINE.arms as [{ x: number; y: number }, { x: number; y: number }];
    for (const [a, b] of TOTE_SLOTS) {
      const x = end.x + Math.cos(end.heading) * a - Math.sin(end.heading) * b;
      const y = end.y + Math.sin(end.heading) * a + Math.cos(end.heading) * b;
      for (const lift of [0, 0.4]) expect(armReach(x - picker.x, y - picker.y, CART.deck + lift - LINE.pedestal + 0.05, 0, q)).toBe(true);
    }
    for (const lift of [0, 0.45]) {
      expect(armReach(stopX(LINE.pick) - picker.x, LINE.y - picker.y, LINE.top + lift - LINE.pedestal + 0.1, 0, q)).toBe(true);
      expect(armReach(stopX(LINE.fasten) - fastener.x, LINE.y - fastener.y, LINE.top + lift - LINE.pedestal + 0.2, 0, q)).toBe(true);
      expect(armReach(LINE.feeder.x - fastener.x, LINE.feeder.y - fastener.y, LINE.feeder.top + lift - LINE.pedestal, 0, q)).toBe(true);
    }
  });

  test("the endurance cycle's poses are within limits and never put the tool into the floor", () => {
    const tip: [number, number, number] = [0, 0, 0];
    for (const q of [...ENDURANCE, ARM_REST]) {
      expect(inLimits(q)).toBe(true);
      armTip(q, tip);
      expect(tip[2] + 0.6).toBeGreaterThan(0.3);
    }
    expect(LIMITS.length).toBe(6);
    expect(ARM.a2 + ARM.d4).toBeLessThan(CELLS[0]!.size / 2);
  });
});

describe("the cart", () => {
  test("its lane is the plan's, with its corner rounded: continuous, and its length the polyline's less what the corner cuts", () => {
    const lane = new Lane(CART_LANE, 1.3);
    const a = { x: 0, y: 0, heading: 0 };
    const b = { x: 0, y: 0, heading: 0 };
    lane.at(0, a);
    expect(a).toEqual({ x: CART_LANE[0]!.x, y: CART_LANE[0]!.y, heading: -Math.PI / 2 });
    lane.at(lane.length, a);
    expect(a.x).toBeCloseTo(CART_LANE[2]!.x, 9);
    expect(a.y).toBeCloseTo(CART_LANE[2]!.y, 9);
    for (let s = 0; s + 0.05 <= lane.length; s += 0.05) {
      lane.at(s, a);
      lane.at(s + 0.05, b);
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThanOrEqual(0.05 + 1e-9);
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(0.049);
    }
    const poly = Math.abs(CART_LANE[1]!.y - CART_LANE[0]!.y) + Math.abs(CART_LANE[2]!.x - CART_LANE[1]!.x);
    expect(lane.length).toBeCloseTo(poly - 2 * 1.3 + (Math.PI / 2) * 1.3, 9);
  });

  test("it drives to its dock and stops on it, never faster than it may go or harder than it may brake", () => {
    const cart = new Cart();
    let last = cart.v;
    let steps = 0;
    while (!cart.drive(CART_PATH.length, 1 / 30, []) && steps < 3000) {
      expect(Math.abs(cart.v)).toBeLessThanOrEqual(CART_SPEED + 1e-9);
      expect(Math.abs(cart.v - last)).toBeLessThanOrEqual(CART_ACCEL * 2.5 / 30 + 1e-6);
      last = cart.v;
      steps++;
    }
    expect(cart.s).toBe(CART_PATH.length);
    expect(cart.v).toBe(0);
  });

  test("it stops short of Galahad on its lane, waits while he's there, and goes on once he's gone", () => {
    const cart = new Cart();
    const pose = { x: 0, y: 0, heading: 0 };
    CART_PATH.at(8.5, pose);
    const galahad = [{ x: pose.x + 0.3, y: pose.y }];
    for (let i = 0; i < 900; i++) {
      cart.drive(CART_PATH.length, 1 / 30, galahad);
      expect(Math.hypot(cart.pose.x - galahad[0]!.x, cart.pose.y - galahad[0]!.y)).toBeGreaterThan(CART.radius + 0.35);
    }
    expect(cart.v).toBe(0);
    expect(cart.s).toBeLessThan(8.5);
    let arrived = false;
    for (let i = 0; i < 3000 && !arrived; i++) arrived = cart.drive(CART_PATH.length, 1 / 30, []);
    expect(arrived).toBe(true);
  });
});

describe("the cells' residents", () => {
  test("the leg's foot moves with the treadmill's belt while it's planted (no slip), and is never below the belt", () => {
    const a = { x: 0, z: 0, planted: true, hip: 0 };
    const b = { x: 0, z: 0, planted: true, hip: 0 };
    const dt = 1 / 120;
    for (let t = 0; t < 6; t += dt) {
      legFoot(t, a);
      legFoot(t + dt, b);
      expect(a.z).toBeGreaterThanOrEqual(LEG.belt - 1e-9);
      if (a.planted && b.planted) expect((b.x - a.x) / dt).toBeCloseTo(-LEG.speed, 6);
      // Within the leg's reach from the hip.
      expect(Math.hypot(a.x, a.hip - a.z - LEG.ankle)).toBeLessThanOrEqual(LEG.thigh + LEG.shin);
    }
  });

  test("the drone rests on its pad, never goes below it, and stays well inside its cell", () => {
    const f = { x: 0, y: 0, z: 0, spin: 0, tiltX: 0, tiltY: 0 };
    let flew = false;
    for (let t = 0; t < 130; t += 0.05) {
      droneAt(t, f);
      expect(f.z).toBeGreaterThanOrEqual(0.16 - 1e-9);
      expect(Math.hypot(f.x, f.y)).toBeLessThan(CELLS[2]!.size / 2 - 2);
      if (f.z > 2) flew = true;
      if (f.z < 0.17) expect(Math.hypot(f.x, f.y)).toBeLessThan(1e-6);
    }
    expect(flew).toBe(true);
  });

  test("the shake table shakes in bursts and rests between them, its upper floors swaying further", () => {
    const floors = new Float64Array(4);
    let peak = 0;
    for (let t = 0; t < 32; t += 0.01) {
      shakeAt(t, floors);
      peak = Math.max(peak, Math.abs(floors[3]!));
      if (t % 16 > 8.05) expect(floors.every((v) => v === 0)).toBe(true);
    }
    expect(peak).toBeGreaterThan(0.1);
    expect(peak).toBeLessThan(0.25);
  });
});

describe("a floor's worth of work", () => {
  test("parts flow from the printers to the line and out: none is lost, none is in two places, none passes through another", () => {
    const flow = new HallFlow({ printers: 7, tote: 6 });
    let out = 0;
    let lifted = false;
    let delivered = false;
    const placed = new Set<number>();
    for (let i = 0; i < 20 * 60 * 14; i++) {
      flow.step(1 / 20, 106, 0);
      // The tote holds each part once, and the carriers each one too.
      const seen = new Set<number>();
      for (const p of flow.tote) if (p >= 0) {
        expect(seen.has(p)).toBe(false);
        seen.add(p);
        expect(flow.parts[p]!.state === "tote" || flow.parts[p]!.state === "drop").toBe(true);
      }
      for (const c of flow.carriers) if (c.part >= 0) {
        expect(seen.has(c.part)).toBe(false);
        seen.add(c.part);
      }
      // Parts on the belt keep their distance.
      const belt = flow.parts.filter((p) => p.state === "belt").map((p) => p.x).sort((a, b) => a - b);
      for (let k = 1; k < belt.length; k++) expect(belt[k]! - belt[k - 1]!).toBeGreaterThan(0.29);
      for (const x of belt) expect(x).toBeLessThanOrEqual(FARM.belt.east);
      for (const c of flow.carriers) if (c.part >= 0 && c.stop > LINE.pick) placed.add(c.part);
      if (flow.bigState === "lifted") lifted = true;
      if (lifted && flow.bigState === "printing") delivered = true;
      out = Math.max(out, flow.indexes);
    }
    expect(placed.size).toBeGreaterThan(5);
    expect(out).toBeGreaterThan(10);
    expect(lifted).toBe(true);
    expect(delivered).toBe(true);
    // Every printer has made parts.
    for (const p of flow.printers) expect(p.fed).toBeGreaterThan(0);
  });

  test("the crane's load never comes lower than the large printer's frame on its way, and is set down on the table", () => {
    const flow = new HallFlow({ printers: 3, tote: 4 });
    let set = false;
    for (let i = 0; i < 20 * 60 * 8; i++) {
      flow.step(1 / 20, 106, 0);
      if (flow.craneState === "toTable") expect(flow.bigZ).toBeGreaterThan(GANTRY.height);
      if (flow.bigState === "table" && !set) {
        set = true;
        expect(flow.bigZ).toBeCloseTo(DISPATCH.top, 6);
      }
    }
    expect(set).toBe(true);
  });

  test("the printers stand where the plan says, and the tote's slots are inside the tote", () => {
    for (let i = 0; i < 7; i++) expect(Math.abs(printerX(i) - FARM.bench.x)).toBeLessThan(FARM.bench.hx - PRINTER.half + 0.05);
    for (const [a, b] of TOTE_SLOTS) {
      expect(Math.abs(a) + 0.11).toBeLessThan(CART.tote.length / 2);
      expect(Math.abs(b) + 0.11).toBeLessThan(CART.tote.width / 2 + 0.02);
    }
  });
});

describe("the hall's budget", () => {
  test("a handful of draw calls and few triangles per tier, half on medium", () => {
    const high = new Workshop({ tier: TIERS.high, shadows: true, ground: () => 0 }).stats;
    const medium = new Workshop({ tier: TIERS.medium, shadows: false, ground: () => 0 }).stats;
    const low = new Workshop({ tier: TIERS.low, shadows: false, ground: () => 0 }).stats;
    expect(high.draws).toBeLessThanOrEqual(8);
    expect(high.triangles).toBeLessThanOrEqual(80_000);
    expect(medium.triangles).toBeLessThanOrEqual(40_000);
    expect(low.triangles).toBeLessThan(medium.triangles);
    expect(high.bones).toBeLessThan(256);
    void HALL_EAVES;
  });
});
