import { describe, expect, test } from "bun:test";
import { PADS } from "@galahad/core/world";
import type { Collider } from "./colliders.ts";
import { aircraft, CIRCUIT_HEIGHT, ROUTES, runwayFor, stepAircraft, TAXI_KEEP_CLEAR, TAXI_OUT } from "./field-circuit.ts";
import { onPaving, rubberStreaks, runwayPaint } from "./field-ground.ts";
import { launcher, LOWERED, stepLauncher, UPRIGHT } from "./field-launcher.ts";
import {
  DRONE_GATE_RADIUS,
  DRONE_GATES,
  DRONE_PAD,
  FIELD,
  FIELD_COLLIDERS,
  FIELD_GATE,
  FIELD_NAMES,
  FIELD_OBSTACLES,
  FIELD_RIM,
  LAUNCH_SLAB,
  LAUNCHER_PARK,
  RUNWAY,
  TAXIWAY,
  TIE_DOWN,
} from "./field-plan.ts";
import { MISSIONS, PAD_TOP, quad, stepQuad } from "./field-quad.ts";
import { sample, routeSample } from "./field-route.ts";
import { COURSE_ROUTE, courseHeight, OSR_SCALE, ROVER, ROVER_KEEP_CLEAR, roverState, stepRover, wheelHeight } from "./field-rover.ts";
import { bandFill, sockPose, windsock } from "./field-wind.ts";
import { obstacles, planPath, plotGate, type Point, standAt } from "./path.ts";

/*
 * The proving ground: its plan (what stands where, and that nothing stands in
 * anyone's way), and its residents' kinematics: the aircraft's circuits, the
 * rover's suspension, the quadcopter's sorties, the launcher, the windsock.
 */

const fieldPads = PADS.filter((p) => p.site === "field");

const inCollider = (c: Collider, x: number, y: number, grow = 0): boolean => {
  if (c.kind === "circle") return Math.hypot(x - c.x, y - c.y) < c.r + grow;
  const cos = Math.cos(-(c.yaw ?? 0));
  const sin = Math.sin(-(c.yaw ?? 0));
  const lx = (x - c.x) * cos - (y - c.y) * sin;
  const ly = (x - c.x) * sin + (y - c.y) * cos;
  return Math.abs(lx) < c.hx + grow && Math.abs(ly) < c.hy + grow;
};

/** The farthest a collider reaches from its centre along x and y (its bounding box's half-sides). */
const reach = (c: Collider): [number, number] => {
  if (c.kind === "circle") return [c.r, c.r];
  const cos = Math.abs(Math.cos(c.yaw ?? 0));
  const sin = Math.abs(Math.sin(c.yaw ?? 0));
  return [c.hx * cos + c.hy * sin, c.hx * sin + c.hy * cos];
};

function* walk(from: Point, path: readonly Point[]): Generator<Point> {
  let a = from;
  for (const b of path) {
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.2));
    for (let i = 0; i <= n; i++) yield { x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n };
    a = b;
  }
}

describe("the proving ground's plan", () => {
  test("everything it builds stands on the field, within its rim", () => {
    const edge = FIELD_RIM + 0.6;
    for (const c of FIELD_COLLIDERS) {
      const [rx, ry] = reach(c);
      expect(Math.abs(c.x - FIELD.x) + rx).toBeLessThanOrEqual(FIELD.hx + edge);
      expect(Math.abs(c.y - FIELD.y) + ry).toBeLessThanOrEqual(FIELD.hy + edge);
    }
    for (const o of [...FIELD_OBSTACLES, ...FIELD_NAMES]) {
      expect(Math.abs(o.x - FIELD.x)).toBeLessThanOrEqual(FIELD.hx + edge);
      expect(Math.abs(o.y - FIELD.y)).toBeLessThanOrEqual(FIELD.hy + edge);
    }
  });

  test("nothing static stands on a pad: experiments get their pads clear", () => {
    for (const pad of fieldPads) {
      const h = pad.size / 2;
      for (const c of FIELD_COLLIDERS) {
        const [rx, ry] = reach(c);
        const apart = Math.abs(c.x - pad.x) >= h + rx - 1e-9 || Math.abs(c.y - pad.y) >= h + ry - 1e-9;
        if (!apart) throw new Error(`a collider at (${c.x.toFixed(1)}, ${c.y.toFixed(1)}) stands on the ${pad.id} pad`);
      }
      for (const o of FIELD_OBSTACLES) expect(Math.abs(o.x - pad.x) >= h + o.r - 1e-9 || Math.abs(o.y - pad.y) >= h + o.r - 1e-9).toBe(true);
    }
  });

  test("the gate, the road's end, the taxiway and every pad's gate are clear to walk", () => {
    const clear: Point[] = [FIELD_GATE, { x: FIELD_GATE.x + 3, y: FIELD_GATE.y }, ...fieldPads.map((p) => plotGate(p))];
    for (let x = TAXIWAY.x - TAXIWAY.hx; x <= TAXIWAY.x + TAXIWAY.hx; x += 0.5) clear.push({ x, y: TAXIWAY.y });
    for (const p of clear) for (const c of FIELD_COLLIDERS) expect(inCollider(c, p.x, p.y, 0.4)).toBe(false);
    for (const p of clear) for (const o of FIELD_OBSTACLES) expect(Math.hypot(p.x - o.x, p.y - o.y)).toBeGreaterThan(o.r);
  });

  test("Galahad walks from the keep to each pad's gate, and back, without walking through anything", () => {
    const obs = obstacles();
    for (const pad of fieldPads) {
      const gate = plotGate(pad);
      for (const [from, to] of [[standAt("keep"), gate], [gate, standAt("keep")]] as const) {
        const path = planPath(from, to, obs);
        expect(path.at(-1)).toEqual({ x: to.x, y: to.y });
        for (const p of walk(from, path)) for (const c of FIELD_COLLIDERS) if ((c.top ?? 9) > 0.5 && inCollider(c, p.x, p.y, 0.3)) throw new Error(`the walk to the ${pad.id} pad passes through a collider at (${c.x.toFixed(1)}, ${c.y.toFixed(1)}), at (${p.x.toFixed(1)}, ${p.y.toFixed(1)})`);
      }
    }
  });

  test("the aircraft's taxi routes keep their wings clear of everything tall", () => {
    const at = routeSample();
    // Half the span, at the wing's height (2.1 m): anything taller within it would be struck.
    for (const rt of [TAXI_OUT, ROUTES.north.exit, ROUTES.south.exit, ROUTES.north.lineUp, ROUTES.south.lineUp]) {
      for (let s = 0; s <= rt.length; s += 0.5) {
        sample(rt, s, at);
        for (let k = -5.3; k <= 5.3; k += 0.5) {
          const x = at.x - Math.sin(at.heading) * k;
          const y = at.y + Math.cos(at.heading) * k;
          for (const c of FIELD_COLLIDERS) if ((c.top ?? 9) > 1.9 && inCollider(c, x, y, 0.2)) throw new Error(`a wing strikes a collider at (${c.x.toFixed(1)}, ${c.y.toFixed(1)})`);
        }
      }
    }
  });

  test("paint never lies on paint: the rubber streaks clear every marking (no z-fighting)", () => {
    const paint = runwayPaint();
    for (const [a0, b0, a1, b1] of rubberStreaks()) {
      for (const [c0, d0, c1, d1] of paint) expect(a1 <= c0 || c1 <= a0 || b1 <= d0 || d1 <= b0).toBe(true);
      expect(onPaving((a0 + a1) / 2, (b0 + b1) / 2)).toBe(true);
    }
  });
});

describe("the resident aircraft", () => {
  const dt = 1 / 30;
  const fly = (seconds: number, wind: number, park: (t: number) => boolean, who: Point = { x: 0, y: 0 }) => {
    const a = aircraft();
    const out: { t: number; x: number; y: number; z: number; v: number; heading: number; pitch: number; bank: number; grounded: boolean; phase: string; curvature: number; s: number }[] = [];
    for (let i = 0; i < seconds / dt; i++) {
      stepAircraft(a, dt, park(i * dt), wind, who.x, who.y);
      out.push({ t: i * dt, x: a.x, y: a.y, z: a.z, v: a.v, heading: a.heading, pitch: a.pitch, bank: a.bank, grounded: a.grounded, phase: a.phase, curvature: a.curvature, s: a.s });
    }
    return { a, out };
  };

  test("flies whole circuits without ever teleporting: as fast as its speed, never below the ground", () => {
    const { out } = fly(300, 0.35, () => false);
    for (let i = 1; i < out.length; i++) {
      const p = out[i - 1]!;
      const q = out[i]!;
      expect(Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z)).toBeLessThanOrEqual(Math.max(p.v, q.v) * dt + 0.03);
      expect(q.z).toBeGreaterThanOrEqual(0);
      expect(q.z).toBeLessThanOrEqual(CIRCUIT_HEIGHT + 1e-6);
    }
    // It flew: well up, and fast.
    expect(Math.max(...out.map((p) => p.z))).toBeGreaterThan(CIRCUIT_HEIGHT - 1);
    expect(out.filter((p) => !p.grounded).length * dt).toBeGreaterThan(100);
  });

  test("on the ground it's on the paving, wings level and its nose never below the ground", () => {
    const { out } = fly(300, 0.35, () => false);
    for (const p of out) {
      if (!p.grounded) continue;
      expect(onPaving(p.x, p.y)).toBe(true);
      expect(Math.abs(p.bank)).toBeLessThan(0.02);
      expect(p.pitch).toBeGreaterThan(-1e-3);
      expect(p.pitch).toBeLessThan(0.2);
    }
  });

  test("its turns are banked for its speed and radius, and its nose follows its flight path", () => {
    const { out } = fly(300, 0.35, () => false);
    let checked = 0;
    for (let i = 60; i < out.length - 60; i++) {
      const p = out[i]!;
      if (p.grounded || p.z < 10) continue;
      // Deep in a turn (the same curvature well before and after): the bank is the coordinated turn's.
      if (p.curvature !== 0 && out[i - 45]!.curvature === p.curvature && out[i + 15]!.curvature === p.curvature) {
        expect(Math.abs(p.bank - Math.atan((p.v * p.v * p.curvature) / 9.81))).toBeLessThan(0.06);
        checked++;
      }
      // Straight and level downwind: wings level, nose a few degrees up.
      if (p.curvature === 0 && Math.abs(p.z - CIRCUIT_HEIGHT) < 1e-6 && out[i - 45]!.curvature === 0) {
        expect(Math.abs(p.bank)).toBeLessThan(0.02);
        expect(p.pitch).toBeGreaterThan(0);
        expect(p.pitch).toBeLessThan(0.12);
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  test("it takes off into the wind", () => {
    for (const wind of [0.35, -1.2, Math.PI / 2, -Math.PI / 2]) {
      const { out } = fly(140, wind, () => false);
      const lift = out.findIndex((p, i) => i > 0 && out[i - 1]!.grounded && !p.grounded);
      expect(lift).toBeGreaterThan(0);
      const h = out[lift]!.heading;
      // Its heading against the way the wind blows.
      expect(Math.cos(h) * Math.cos(wind) + Math.sin(h) * Math.sin(wind)).toBeLessThan(0);
    }
    // A wind straight across the runway changes nothing.
    expect(runwayFor(0, 1)).toBe(1);
    expect(runwayFor(Math.PI, -1)).toBe(-1);
  });

  test("touches down and goes round again, then lands, taxis in and ties down at its spot", () => {
    const { out } = fly(320, 0.35, () => false);
    const touchdowns = out.filter((p, i) => i > 0 && !out[i - 1]!.grounded && p.grounded).length;
    expect(touchdowns).toBeGreaterThanOrEqual(3);
    const home = out.findIndex((p, i) => i > 0 && out[i - 1]!.phase === "taxi-in" && p.phase === "idle");
    expect(home).toBeGreaterThan(0);
    expect(Math.hypot(out[home]!.x - TIE_DOWN.x, out[home]!.y - TIE_DOWN.y)).toBeLessThan(0.05);
  });

  test("when the flight pad is wanted, it lands at the next chance, parks and stays parked", () => {
    const { a, out } = fly(300, 0.35, (t) => t > 70);
    expect(a.phase).toBe("parked");
    expect(Math.hypot(a.x - TIE_DOWN.x, a.y - TIE_DOWN.y)).toBeLessThan(0.05);
    const parked = out.findIndex((p) => p.phase === "parked" && p.t > 70);
    expect(out[parked]!.t).toBeLessThan(200);
    for (const p of out.slice(parked)) expect(p.phase).toBe("parked");
  });

  test("taxiing, it gives way to someone on foot", () => {
    // Galahad stands on the taxiway: it stops short of him and waits.
    const who = { x: -120, y: TAXIWAY.y };
    const { out } = fly(80, 0.35, () => false, who);
    for (const p of out) if (p.grounded && p.z === 0) expect(Math.hypot(p.x - who.x, p.y - who.y)).toBeGreaterThan(TAXI_KEEP_CLEAR - 3);
    expect(out.some((p) => p.phase === "hold")).toBe(false);
  });
});

describe("the rover", () => {
  const dt = 1 / 30;
  const ground = (x: number, y: number) => courseHeight(x, y, true);

  test("all six wheels stay on the ground over every obstacle, and the suspension really works", () => {
    const r = roverState();
    let rockers = 0;
    let rolls = 0;
    const { pivot, rear, bogie, front, mid, track, wheelRadius } = ROVER;
    for (let i = 0; i < 160 / dt; i++) {
      stepRover(r, dt, false, 0, 0, i * dt);
      const p = r.pose;
      const c = Math.cos(p.heading);
      const s = Math.sin(p.heading);
      for (let side = 0; side < 2; side++) {
        const sign = side === 0 ? 1 : -1;
        // Each side's own plane: its pivot's height from the body's pose, then forward kinematics.
        const pz = p.z + pivot[0] * Math.sin(p.pitch) + pivot[2] * Math.cos(p.pitch) + sign * pivot[1] * Math.tan(p.roll);
        const a = p.rocker[side]!;
        const t = p.bogie[side]!;
        const rot = (v: readonly [number, number], ang: number): [number, number] => [v[0] * Math.cos(ang) - v[1] * Math.sin(ang), v[0] * Math.sin(ang) + v[1] * Math.cos(ang)];
        const [rx, rz] = rot(rear, a);
        const [bx, bz] = rot(bogie, a);
        const [fx, fz] = rot(front, t);
        const [mx, mz] = rot(mid, t);
        const wheels: [number, number, number][] = [
          [pivot[0] + bx + fx, pz + bz + fz, track[0]],
          [pivot[0] + bx + mx, pz + bz + mz, track[1]],
          [pivot[0] + rx, pz + rz, track[2]],
        ];
        for (const [along, z, off] of wheels) {
          const wx = p.x + c * along - s * sign * off;
          const wy = p.y + s * along + c * sign * off;
          expect(Math.abs(z - wheelHeight(ground, wx, wy, p.heading, wheelRadius))).toBeLessThan(0.02);
        }
      }
      if (Math.abs(p.rocker[0] - p.pitch) > 0.04) rockers++;
      if (Math.abs(p.roll) > 0.02) rolls++;
    }
    // Rockers swing against the body, and the body rolls where one side climbs alone (the staggered logs, the rocks).
    expect(rockers).toBeGreaterThan(30);
    expect(rolls).toBeGreaterThan(30);
  });

  test("wheels turn at the rate it drives, and the corners steer into turns", () => {
    const r = roverState();
    let last = r.s;
    let lastSpin = r.spin[1]!;
    let steered = false;
    for (let i = 0; i < 40 / dt; i++) {
      stepRover(r, dt, false, 0, 0, i * dt);
      const at = routeSample();
      sample(COURSE_ROUTE, r.s, at);
      if (at.curvature === 0) {
        let d = r.spin[1]! - lastSpin;
        if (d < -Math.PI) d += Math.PI * 2;
        expect(Math.abs(d - (r.s - last) / ROVER.wheelRadius)).toBeLessThan(1e-6);
      } else if (Math.abs(r.steer[0]!) > 0.15) steered = true;
      last = r.s;
      lastSpin = r.spin[1]!;
    }
    expect(steered).toBe(true);
  });

  test("it stops for someone in its way and waits, and goes on when they've gone", () => {
    const r = roverState();
    const who = { x: -125, y: 17.5 };
    for (let i = 0; i < 60 / dt; i++) {
      stepRover(r, dt, false, who.x, who.y, i * dt);
      expect(Math.hypot(r.pose.x - who.x, r.pose.y - who.y)).toBeGreaterThan(ROVER_KEEP_CLEAR - 0.9);
    }
    expect(r.waiting).toBe(true);
    const s = r.s;
    for (let i = 0; i < 10 / dt; i++) stepRover(r, dt, false, 0, 0, 60 + i * dt);
    expect(r.s).toBeGreaterThan(s + 2);
  });

  test("with its course wanted, it finishes its lap and parks at the start", () => {
    const r = roverState();
    for (let i = 0; i < 30 / dt; i++) stepRover(r, dt, false, 0, 0, i * dt);
    for (let i = 0; i < 200 / dt; i++) stepRover(r, dt, true, 0, 0, 30 + i * dt);
    expect(r.parked).toBe(true);
    expect(r.v).toBe(0);
    expect(r.s % COURSE_ROUTE.length).toBeLessThan(1e-6);
  });
});

describe("the quadcopter", () => {
  const dt = 1 / 30;
  test("lifts off, flies through each gate's hoop, surveys, lands on its pad and charges", () => {
    const q = quad();
    let landed = false;
    let maxTilt = 0;
    for (let i = 0; i < 90 / dt; i++) {
      const before = { x: q.x, y: q.y, z: q.z };
      stepQuad(q, dt, false);
      expect(q.z).toBeGreaterThanOrEqual(PAD_TOP - 1e-9);
      expect(Math.hypot(q.x - before.x, q.y - before.y, q.z - before.z)).toBeLessThan(8 * dt);
      maxTilt = Math.max(maxTilt, Math.atan(Math.hypot(q.tiltX, q.tiltY)));
      // Crossing a gate's plane near it, it's inside the hoop.
      for (const g of DRONE_GATES) {
        const c = Math.cos(g.heading);
        const s = Math.sin(g.heading);
        const a = (before.x - g.x) * c + (before.y - g.y) * s;
        const b = (q.x - g.x) * c + (q.y - g.y) * s;
        if (a < 0 && b >= 0 && Math.hypot(q.x - g.x, q.y - g.y) < 4) {
          const across = Math.hypot(-(q.x - g.x) * s + (q.y - g.y) * c, q.z - g.z);
          expect(across).toBeLessThan(DRONE_GATE_RADIUS - 0.5);
        }
      }
      if (q.mode === "landed" && !landed) {
        landed = true;
        // Squarely on its pad.
        expect(Math.hypot(q.x - DRONE_PAD.x, q.y - DRONE_PAD.y)).toBeLessThan(0.05);
        expect(q.z).toBe(PAD_TOP);
      }
    }
    expect(landed).toBe(true);
    expect(maxTilt).toBeLessThan(0.65);
    expect(MISSIONS.survey.filter((w) => w.gate !== undefined)).toHaveLength(DRONE_GATES.length);
  });

  test("with the launch pad taken, it never flies over it", () => {
    const q = quad();
    for (let i = 0; i < 180 / dt; i++) {
      stepQuad(q, dt, true);
      expect(Math.abs(q.x - LAUNCH_SLAB.x) < 20 && Math.abs(q.y - LAUNCH_SLAB.y) < 20).toBe(false);
    }
  });
});

describe("the launcher and the windsock", () => {
  test("the launcher lowers its rail before it moves, parks out of the way, and comes back to raise it", () => {
    const l = launcher();
    const dt = 1 / 30;
    for (let i = 0; i < 120 / dt; i++) {
      const before = { x: l.x, y: l.y };
      stepLauncher(l, dt, false);
      if (Math.hypot(l.x - before.x, l.y - before.y) > 1e-9) expect(l.erect).toBeLessThanOrEqual(LOWERED + 1e-9);
    }
    expect(Math.hypot(l.x - LAUNCHER_PARK.x, l.y - LAUNCHER_PARK.y)).toBeLessThan(1e-6);
    // Parked, it's off the launch pad.
    const pad = PADS.find((p) => p.id === "launch")!;
    expect(Math.abs(l.y - pad.y)).toBeGreaterThan(pad.size / 2 + 2);
    for (let i = 0; i < 120 / dt; i++) stepLauncher(l, dt, true);
    expect(l.s).toBe(0);
    expect(l.erect).toBe(UPRIGHT);
  });

  test("the windsock hangs in a calm, fills band by band and stands straight out from 15 knots, downwind", () => {
    const pose = sockPose();
    windsock(0, 1, 0, false, pose);
    expect(pose.droop[4]!).toBeGreaterThan(1);
    windsock(3.2, 1, 0, false, pose);
    expect(bandFill(3.2, 0)).toBe(1);
    expect(pose.droop[0]!).toBeLessThan(0.05);
    expect(pose.droop[4]!).toBeGreaterThan(0.5);
    windsock(12, 1, 7, true, pose);
    for (let i = 0; i < 5; i++) expect(Math.abs(pose.droop[i]!)).toBeLessThan(0.1);
    expect(Math.abs(pose.heading - 1)).toBeLessThan(0.25);
  });
});

describe("the runway", () => {
  test("the runway runs north-south through the flight pad and its paint stays on it", () => {
    const flight = PADS.find((p) => p.id === "flight")!;
    expect(RUNWAY.x).toBe(flight.x);
    for (const [x0, y0, x1, y1] of runwayPaint()) {
      expect(x0).toBeGreaterThanOrEqual(RUNWAY.x - RUNWAY.hx);
      expect(x1).toBeLessThanOrEqual(RUNWAY.x + RUNWAY.hx);
      expect(y0).toBeGreaterThanOrEqual(RUNWAY.y - RUNWAY.hy);
      expect(y1).toBeLessThanOrEqual(RUNWAY.y + RUNWAY.hy);
    }
  });
});

describe("the real Open Source Rover", () => {
  test("its description's joints are where the suspension solver puts them (so its wheels stand on the ground)", async () => {
    const { parseManifest, treeOf } = await import("./robots/manifest.ts");
    const { Skeleton } = await import("./robots/kinematics.ts");
    const json = JSON.parse(await Bun.file(new URL("./assets/robots/open-source-rover.json", import.meta.url)).text());
    const m = parseManifest(json);
    expect(m.source.license).toBe("Apache-2.0");
    const sk = new Skeleton(treeOf(m));
    sk.fk();
    const base = m.sites.find((s) => s.name === "base_link")!;
    // A link's origin in the body's frame (base_link), at the field's scale: (forward, left, up).
    const at = (link: string): [number, number, number] => {
      const o = sk.linkIndex(link) * 16;
      return [sk.world[o + 12]! * OSR_SCALE, sk.world[o + 13]! * OSR_SCALE, (sk.world[o + 14]! - base.xyz[2]) * OSR_SCALE];
    };
    const near = (a: readonly number[], b: readonly number[]) => a.forEach((v, i) => expect(Math.abs(v - b[i]!)).toBeLessThan(0.004));
    const pivot = at("rocker_bogie_link_L_1");
    near(pivot, ROVER.pivot);
    const bogie = at("rocker_bogie_link_L_2");
    near([bogie[0] - pivot[0], bogie[2] - pivot[2]], ROVER.bogie);
    const front = at("front_wheel_link_left");
    near([front[0] - bogie[0], front[2] - bogie[2]], ROVER.front);
    const mid = at("middle_wheel_link_left");
    near([mid[0] - bogie[0], mid[2] - bogie[2]], ROVER.mid);
    const rear = at("rear_wheel_link_left");
    near([rear[0] - pivot[0], rear[2] - pivot[2]], ROVER.rear);
    near([front[1], mid[1], rear[1]], ROVER.track);
    // Its wheels' reach (their grousers) is the solver's wheel radius.
    const wheel = m.links.find((l) => l.name === "front_wheel_link_left")!.mesh!;
    expect(Math.abs(Math.max(wheel.max[0], -wheel.min[0], wheel.max[2], -wheel.min[2]) * OSR_SCALE - ROVER.wheelRadius)).toBeLessThan(0.006);
  });
});

describe("what the proving ground costs to draw", () => {
  test("a handful of meshes and a triangle budget per tier: at most 60 000 on high, half that on medium", async () => {
    const { ProvingGround, FIELD_DETAIL } = await import("./field.ts");
    const { TIERS } = await import("./tiers.ts");
    const budget = { high: 60_000, medium: 30_000, low: 24_000 } as const;
    for (const name of ["high", "medium", "low"] as const) {
      const place = new ProvingGround({ tier: TIERS[name], shadows: TIERS[name].shadows, ground: () => 0 });
      let meshes = 0;
      let triangles = 0;
      place.group.traverse((o) => {
        const m = o as unknown as { isMesh?: boolean; isInstancedMesh?: boolean; count?: number; geometry?: { index: { count: number } | null; getAttribute(n: string): { count: number } } };
        if (!m.isMesh || !m.geometry) return;
        meshes++;
        const n = (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute("position").count) / 3;
        triangles += n * (m.isInstancedMesh ? (m.count ?? 1) : 1);
      });
      // Ground, solid, lit, machines, their beams and the halos (the last two only drawn at night); on high, the real rover too, once it's loaded.
      expect(meshes).toBeLessThanOrEqual(6);
      if (FIELD_DETAIL[name].realRover) triangles += JSON.parse(await Bun.file(new URL("./assets/robots/open-source-rover.json", import.meta.url)).text()).triangles;
      expect(triangles).toBeLessThanOrEqual(budget[name]);
      place.dispose();
    }
  });

  test("under reduced motion everything rests where it parks, and stays", async () => {
    const { ProvingGround } = await import("./field.ts");
    const { TIERS } = await import("./tiers.ts");
    const place = new ProvingGround({ tier: TIERS.low, shadows: false, ground: () => 0 });
    const f = { dt: 1 / 30, t: 0, motion: true, focusX: -120, focusY: -35, distance: 60, follow: false, galahadX: 0, galahadY: 0, night: 0, rain: 0, wetness: 0, wind: 5, windHeading: 0.35 };
    for (let i = 0; i < 900; i++) {
      f.t += f.dt;
      place.animate(f);
    }
    f.motion = false;
    place.animate(f);
    const at = place.movers.map((m) => [m.x, m.y]);
    expect(Math.hypot(at[0]![0]! - TIE_DOWN.x, at[0]![1]! - TIE_DOWN.y)).toBeLessThan(0.05);
    expect(Math.hypot(at[2]![0]! - DRONE_PAD.x, at[2]![1]! - DRONE_PAD.y)).toBeLessThan(0.05);
    for (let i = 0; i < 60; i++) {
      f.t += f.dt;
      place.animate(f);
    }
    expect(place.movers.map((m) => [m.x, m.y])).toEqual(at);
    place.dispose();
  });
});
