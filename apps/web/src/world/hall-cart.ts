import { CART, CART_LANE, CART_TURN } from "./hall-plan.ts";

/*
 * The cart (an AGV) and its lane, pure. The lane is the plan's polyline with
 * its corners rounded; the cart follows it by distance along it, both ways
 * (it has no front), from dock to dock. It speeds up and slows down at a
 * steady rate, comes to rest exactly at a dock, and stops short of anything
 * in its way: Galahad on the lane ahead, or another machine that says the
 * lane isn't clear (an arm still reaching over its tote, a load overhead).
 */

export interface LanePose {
  x: number;
  y: number;
  /** The way the lane runs at this point, from its start towards its end (atan2 convention). */
  heading: number;
}

interface Piece {
  /** Where it starts along the lane, and its length. */
  s: number;
  length: number;
  /** A straight (from x0, y0 along heading) or an arc (centre cx, cy, radius r, from angle a0 turning by `turn`). */
  kind: "line" | "arc";
  x0: number;
  y0: number;
  heading: number;
  cx: number;
  cy: number;
  r: number;
  a0: number;
  turn: number;
}

/** A polyline with each inner corner rounded to `radius`, by distance along it. */
export class Lane {
  readonly pieces: Piece[] = [];
  readonly length: number;

  constructor(points: readonly { x: number; y: number }[], radius: number) {
    let s = 0;
    let x = points[0]!.x;
    let y = points[0]!.y;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!;
      const b = points[i]!;
      const heading = Math.atan2(b.y - a.y, b.x - a.x);
      const next = points[i + 1];
      let ex = b.x;
      let ey = b.y;
      let turn = 0;
      let cut = 0;
      if (next) {
        const h2 = Math.atan2(next.y - b.y, next.x - b.x);
        turn = Math.atan2(Math.sin(h2 - heading), Math.cos(h2 - heading));
        cut = radius * Math.tan(Math.abs(turn) / 2);
        ex = b.x - Math.cos(heading) * cut;
        ey = b.y - Math.sin(heading) * cut;
      }
      const length = Math.hypot(ex - x, ey - y);
      this.pieces.push({ s, length, kind: "line", x0: x, y0: y, heading, cx: 0, cy: 0, r: 0, a0: 0, turn: 0 });
      s += length;
      if (next && Math.abs(turn) > 1e-6) {
        const side = Math.sign(turn);
        const cx = ex + Math.cos(heading + (side * Math.PI) / 2) * radius;
        const cy = ey + Math.sin(heading + (side * Math.PI) / 2) * radius;
        const a0 = Math.atan2(ey - cy, ex - cx);
        const arc = Math.abs(turn) * radius;
        this.pieces.push({ s, length: arc, kind: "arc", x0: ex, y0: ey, heading, cx, cy, r: radius, a0, turn });
        s += arc;
        x = b.x + Math.cos(heading + turn) * cut;
        y = b.y + Math.sin(heading + turn) * cut;
      } else {
        x = ex;
        y = ey;
      }
    }
    this.length = s;
  }

  /** The point at distance `s` along the lane (clamped), into `out`. */
  at(s: number, out: LanePose): LanePose {
    const d = Math.max(0, Math.min(this.length, s));
    let p = this.pieces[this.pieces.length - 1]!;
    for (let i = 0; i < this.pieces.length; i++) {
      if (d <= this.pieces[i]!.s + this.pieces[i]!.length) {
        p = this.pieces[i]!;
        break;
      }
    }
    const into = d - p.s;
    if (p.kind === "line") {
      out.x = p.x0 + Math.cos(p.heading) * into;
      out.y = p.y0 + Math.sin(p.heading) * into;
      out.heading = p.heading;
    } else {
      const a = p.a0 + (into / p.r) * Math.sign(p.turn);
      out.x = p.cx + Math.cos(a) * p.r;
      out.y = p.cy + Math.sin(a) * p.r;
      out.heading = p.heading + (into / p.r) * Math.sign(p.turn);
    }
    return out;
  }
}

/** The cart's lane, from the printers' dock (0) to the assembly line's (its length). */
export const CART_PATH = new Lane(CART_LANE, CART_TURN);

/** How fast the cart goes (m/s), how hard it speeds up and brakes (m/s²), and how far short of an obstacle it stops (metres, its centre from the obstacle's). */
export const CART_SPEED = 1.1;
export const CART_ACCEL = 0.6;
export const CART_GAP = 1.75;
/** How near Galahad may be to the lane before the cart waits for him (metres from the lane's centre line). */
export const CART_SEES = 1.3;

/** A thing on or near the lane that the cart must not run into. */
export interface Obstacle {
  x: number;
  y: number;
}

const probe: LanePose = { x: 0, y: 0, heading: 0 };

/**
 * How far the cart can go from `s` towards `dir` (+1 or −1) before it must have stopped: to the end of the
 * lane, or to short of the first obstacle on the lane ahead (looked for over `look` metres).
 */
export function clearAhead(lane: Lane, s: number, dir: 1 | -1, obstacles: readonly Obstacle[], look = 6): number {
  const end = dir > 0 ? lane.length - s : s;
  let free = end;
  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i]!;
    // Already alongside: wait for it to move off.
    lane.at(s, probe);
    if (Math.hypot(o.x - probe.x, o.y - probe.y) < CART.radius + 0.6) return 0;
    for (let d = 0.25; d <= Math.min(look, end + CART_GAP); d += 0.25) {
      lane.at(s + dir * d, probe);
      if (Math.hypot(o.x - probe.x, o.y - probe.y) < CART_SEES) {
        free = Math.min(free, Math.max(0, d - CART_GAP));
        break;
      }
    }
  }
  return free;
}

/** The cart: where it is along the lane and how fast it's going (signed: + towards the lane's end). */
export class Cart {
  s = 0;
  v = 0;
  readonly pose: LanePose = { x: 0, y: 0, heading: 0 };

  constructor(readonly lane: Lane = CART_PATH) {
    lane.at(0, this.pose);
  }

  /**
   * Drives towards `target` (a distance along the lane) for `dt` seconds, stopping short of `obstacles`, and
   * holding still while `hold` (an interlock). Returns true once at rest on the target.
   */
  drive(target: number, dt: number, obstacles: readonly Obstacle[], hold = false): boolean {
    const dir: 1 | -1 = target >= this.s ? 1 : -1;
    const left = Math.abs(target - this.s);
    if (left < 1e-4 && Math.abs(this.v) < 1e-4) {
      this.s = target;
      this.v = 0;
      this.lane.at(this.s, this.pose);
      return true;
    }
    const room = hold ? 0 : Math.min(left, clearAhead(this.lane, this.s, dir, obstacles));
    // The fastest speed from which it can still stop within the room it has.
    const allowed = Math.min(CART_SPEED, Math.sqrt(2 * CART_ACCEL * room));
    const speed = Math.abs(this.v) * Math.sign(this.v) * dir;
    let next = speed < allowed ? Math.min(allowed, speed + CART_ACCEL * dt) : Math.max(allowed, speed - CART_ACCEL * 2.5 * dt);
    next = Math.max(0, next);
    let step = next * dt;
    // Never past the room it has (a stop is a stop).
    if (step > room) {
      step = room;
      next = room / Math.max(dt, 1e-6) > next ? next : room / Math.max(dt, 1e-6);
    }
    this.s += dir * step;
    this.v = dir * next;
    if (Math.abs(target - this.s) < 1e-4 && next < 0.05) {
      this.s = target;
      this.v = 0;
    }
    this.lane.at(this.s, this.pose);
    return this.s === target && this.v === 0;
  }
}
