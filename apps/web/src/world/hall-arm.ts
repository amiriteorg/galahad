/*
 * The hall's six-axis arms, pure: an industrial arm with a spherical wrist (a
 * turning base, a shoulder and an elbow that pitch, and a wrist that rolls,
 * pitches and rolls), drawn 2.5 × the size of a small cobot like the robots.
 *
 * Its own frame: origin on its pedestal's top, z up, x forward when the base is
 * at 0. Every link's frame has its own +z along the link. Forward kinematics is
 * a chain of turns and offsets; inverse kinematics puts the tool's tip at a point
 * with the tool pointing straight down (as picking and screwing need), turned
 * about the vertical to a given yaw: the base turns to face the point, the
 * shoulder and elbow are a two-bone solution (elbow up) for the wrist's centre
 * above it, and the wrist pitches the tool down and rolls it to the yaw.
 */

/** Link lengths: shoulder above the pedestal, upper arm, forearm (elbow to wrist centre), wrist centre to flange, flange to the tool's tip. */
export const ARM = { d1: 0.5, a2: 1.0, d4: 0.95, d6: 0.16, tool: 0.26 };

/** Joint angles (radians): base, shoulder (0 upright, + leaning forward), elbow (0 straight, + bending forward), wrist roll, wrist pitch, flange roll. */
export type Joints = Float64Array;
export const joints = (): Joints => new Float64Array(6);

/** A pose the arm rests in: folded, the tool down over its base's front. */
export const ARM_REST: readonly number[] = [0, -0.25, 2.1, 0, Math.PI - 1.85, 0];

/** A 3×4 rigid transform, row-major: [r00 r01 r02 tx, r10 r11 r12 ty, r20 r21 r22 tz]. */
export type Frame = Float64Array;
export const frame = (): Frame => new Float64Array(12);

function identity(f: Frame): Frame {
  f.fill(0);
  f[0] = 1;
  f[5] = 1;
  f[10] = 1;
  return f;
}

/** f ← f · rotation about its own z (c, s = cos, sin). */
function turnZ(f: Frame, a: number): void {
  const c = Math.cos(a);
  const s = Math.sin(a);
  for (let r = 0; r < 3; r++) {
    const x = f[r * 4]!;
    const y = f[r * 4 + 1]!;
    f[r * 4] = x * c + y * s;
    f[r * 4 + 1] = -x * s + y * c;
  }
}

/** f ← f · rotation about its own y. */
function turnY(f: Frame, a: number): void {
  const c = Math.cos(a);
  const s = Math.sin(a);
  for (let r = 0; r < 3; r++) {
    const x = f[r * 4]!;
    const z = f[r * 4 + 2]!;
    f[r * 4] = x * c - z * s;
    f[r * 4 + 2] = x * s + z * c;
  }
}

/** f ← f · a move of `d` along its own z. */
function up(f: Frame, d: number): void {
  f[3] = f[3]! + f[2]! * d;
  f[7] = f[7]! + f[6]! * d;
  f[11] = f[11]! + f[10]! * d;
}

/**
 * The links' frames for joints `q`, in the arm's frame: [turret, upper arm, forearm, wrist (after its roll),
 * hand (after its pitch, at the wrist's centre), flange (after its roll, at the flange)], each a Frame in `out`.
 */
export function armFrames(q: ArrayLike<number>, out: Frame[]): Frame[] {
  const f = identity(out[0]!);
  turnZ(f, q[0]!);
  const upper = out[1]!;
  upper.set(f);
  up(upper, ARM.d1);
  turnY(upper, q[1]!);
  const fore = out[2]!;
  fore.set(upper);
  up(fore, ARM.a2);
  turnY(fore, q[2]!);
  const wrist = out[3]!;
  wrist.set(fore);
  turnZ(wrist, q[3]!);
  const hand = out[4]!;
  hand.set(wrist);
  up(hand, ARM.d4);
  turnY(hand, q[4]!);
  const flange = out[5]!;
  flange.set(hand);
  turnZ(flange, q[5]!);
  up(flange, ARM.d6);
  return out;
}

export const armFramesOut = (): Frame[] => Array.from({ length: 6 }, frame);

/** The tool's tip for joints `q` (arm frame), into `out`. */
export function armTip(q: ArrayLike<number>, out: [number, number, number], scratch: Frame[] = armFramesOut()): [number, number, number] {
  const f = armFrames(q, scratch)[5]!;
  out[0] = f[3]! + f[2]! * ARM.tool;
  out[1] = f[7]! + f[6]! * ARM.tool;
  out[2] = f[11]! + f[10]! * ARM.tool;
  return out;
}

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Joints putting the tool's tip at (x, y, z) in the arm's frame, pointing straight down, its tool turned
 * to `yaw` about the vertical (atan2 convention). Returns false (and the nearest it can do) if out of reach.
 */
export function armReach(x: number, y: number, z: number, yaw: number, out: Joints): boolean {
  const wz = z + ARM.d6 + ARM.tool;
  const r = Math.hypot(x, y);
  const h = wz - ARM.d1;
  const q1 = r > 1e-6 ? Math.atan2(y, x) : out[0]!;
  const reach = ARM.a2 + ARM.d4;
  let d = Math.hypot(r, h);
  const ok = d <= reach - 1e-6 && d >= Math.abs(ARM.a2 - ARM.d4) + 1e-6;
  d = Math.max(Math.abs(ARM.a2 - ARM.d4) + 1e-6, Math.min(reach - 1e-6, d));
  const c3 = (d * d - ARM.a2 * ARM.a2 - ARM.d4 * ARM.d4) / (2 * ARM.a2 * ARM.d4);
  const q3 = Math.acos(Math.max(-1, Math.min(1, c3)));
  const beta = Math.atan2(r, h);
  const alpha = Math.atan2(ARM.d4 * Math.sin(q3), ARM.a2 + ARM.d4 * Math.cos(q3));
  const q2 = beta - alpha;
  out[0] = q1;
  out[1] = q2;
  out[2] = q3;
  out[3] = 0;
  out[4] = Math.PI - q2 - q3;
  // Tool down: its x axis points at q1 + π − q6.
  out[5] = wrap(q1 + Math.PI - yaw);
  return ok;
}

/** Joint limits (radians), as the real arm's: the shoulder and the wrist's pitch have stops. */
export const LIMITS: readonly (readonly [number, number])[] = [
  [-Math.PI, Math.PI],
  [-1.6, 1.9],
  [-0.2, 2.75],
  [-Math.PI, Math.PI],
  [-0.2, 3.3],
  [-Math.PI * 2, Math.PI * 2],
];

/** Within the arm's joint limits. */
export const inLimits = (q: ArrayLike<number>): boolean => LIMITS.every(([lo, hi], i) => q[i]! >= lo - 1e-9 && q[i]! <= hi + 1e-9);

const ease = (t: number): number => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * c * (c * (c * 6 - 15) + 10);
};

/** A move in joint space from `a` to `b` (each joint the short way round for the turning ones), eased: at `t` 0..1, into `out`. */
export function blend(a: ArrayLike<number>, b: ArrayLike<number>, t: number, out: Joints): Joints {
  const k = ease(t);
  for (let i = 0; i < 6; i++) {
    let d = b[i]! - a[i]!;
    if (i === 0 || i === 3) d = wrap(d);
    out[i] = a[i]! + d * k;
  }
  return out;
}

/** How long a joint move takes: the largest joint change at the arm's speed (rad/s), never under `least` seconds. */
export function moveTime(a: ArrayLike<number>, b: ArrayLike<number>, speed = 1.6, least = 0.5): number {
  let m = 0;
  for (let i = 0; i < 5; i++) m = Math.max(m, Math.abs(i === 0 || i === 3 ? wrap(b[i]! - a[i]!) : b[i]! - a[i]!));
  return Math.max(least, (m / speed) * 1.875);
}

/**
 * A sequence of waypoints (joint poses) and what the tool does at each, played by time: the arm's task.
 * `hold` seconds at a waypoint (gripping, screwing) after arriving.
 */
export interface Waypoint {
  q: Joints;
  hold: number;
}

/** Where a sequence is at time `t` from its start: the joints into `out`; returns the index of the move under way (−1 when done). */
export function play(points: readonly Waypoint[], from: ArrayLike<number>, t: number, out: Joints): number {
  let prev: ArrayLike<number> = from;
  let clock = t;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const move = moveTime(prev, p.q);
    if (clock < move) {
      blend(prev, p.q, clock / move, out);
      return i;
    }
    clock -= move;
    if (clock < p.hold) {
      out.set(p.q);
      return i;
    }
    clock -= p.hold;
    prev = p.q;
  }
  out.set(points.length ? points[points.length - 1]!.q : (from as Joints));
  return -1;
}

/** The duration of a sequence's first `count` waypoints (all of them by default). */
export function duration(points: readonly Waypoint[], from: ArrayLike<number>, count = points.length): number {
  let prev: ArrayLike<number> = from;
  let total = 0;
  for (let i = 0; i < count; i++) {
    const p = points[i]!;
    total += moveTime(prev, p.q) + p.hold;
    prev = p.q;
  }
  return total;
}
