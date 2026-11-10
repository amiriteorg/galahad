import type { Skeleton, Vec3 } from "./kinematics.ts";

/*
 * Inverse kinematics on a Skeleton, within every joint's limits:
 *
 * - `aim`: turns one joint so a point on the chain swings towards a target (one
 *   step of cyclic coordinate descent), or a direction on it lines up with another.
 * - `twoBone`: the analytic solution for a two-link limb (a hip and a knee, a
 *   shoulder and an elbow) whose two joints turn about parallel axes: the law of
 *   cosines gives the middle joint's bend, then the root joint swings the end onto
 *   the target. Works from the robot's own frames, so it needs no hand-written
 *   conventions for which way an axis points.
 * - `ccd`: cyclic coordinate descent for any chain.
 *
 * Each solver leaves the skeleton's frames current from the first joint it
 * moved down to the end of the chain. Nothing allocates.
 */

const pivot: Vec3 = [0, 0, 0];
const axis: Vec3 = [0, 0, 0];
const end: Vec3 = [0, 0, 0];
const mid: Vec3 = [0, 0, 0];
const root: Vec3 = [0, 0, 0];
const midAxis: Vec3 = [0, 0, 0];
const u: Vec3 = [0, 0, 0];
const v: Vec3 = [0, 0, 0];

/** A point fixed in a link (`link`, in its frame). */
export interface Effector {
  link: number;
  point: Vec3;
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** `out = x − n (x·n)`: x with its component along the unit n taken out. */
function flatten(x: Vec3, n: Vec3, out: Vec3): Vec3 {
  const d = dot(x, n);
  out[0] = x[0] - n[0] * d;
  out[1] = x[1] - n[1] * d;
  out[2] = x[2] - n[2] * d;
  return out;
}

/** The signed angle from a to b about the unit axis n (both seen in the plane normal to n). */
function signedAngle(a: Vec3, b: Vec3, n: Vec3): number {
  const cx = a[1] * b[2] - a[2] * b[1];
  const cy = a[2] * b[0] - a[0] * b[2];
  const cz = a[0] * b[1] - a[1] * b[0];
  return Math.atan2(cx * n[0] + cy * n[1] + cz * n[2], dot(a, b));
}

/** Recomputes the frames below joint j. */
const settle = (sk: Skeleton, j: number): void => sk.updateSubtree(sk.joints[j]!.child);

/** One CCD step: turns joint j so the effector swings towards the target (world). Returns the angle it turned. */
export function aimPoint(sk: Skeleton, j: number, effector: Effector, target: Vec3): number {
  sk.jointFrame(j, pivot, axis);
  sk.point(effector.link, effector.point, end);
  u[0] = end[0] - pivot[0];
  u[1] = end[1] - pivot[1];
  u[2] = end[2] - pivot[2];
  v[0] = target[0] - pivot[0];
  v[1] = target[1] - pivot[1];
  v[2] = target[2] - pivot[2];
  flatten(u, axis, u);
  flatten(v, axis, v);
  if (dot(u, u) < 1e-14 || dot(v, v) < 1e-14) return 0;
  const before = sk.q[j]!;
  const after = sk.set(j, before + signedAngle(u, v, axis));
  settle(sk, j);
  return after - before;
}

/** Turns joint j so a direction fixed in a link (`local`, in that link's frame) lines up with `target` (world) as far as the joint's axis allows. */
export function aimDirection(sk: Skeleton, j: number, link: number, local: Vec3, target: Vec3): number {
  sk.jointFrame(j, pivot, axis);
  const w = sk.world;
  const o = link * 16;
  u[0] = w[o]! * local[0] + w[o + 4]! * local[1] + w[o + 8]! * local[2];
  u[1] = w[o + 1]! * local[0] + w[o + 5]! * local[1] + w[o + 9]! * local[2];
  u[2] = w[o + 2]! * local[0] + w[o + 6]! * local[1] + w[o + 10]! * local[2];
  flatten(u, axis, u);
  flatten(target, axis, v);
  if (dot(u, u) < 1e-14 || dot(v, v) < 1e-14) return 0;
  const before = sk.q[j]!;
  const after = sk.set(j, before + signedAngle(u, v, axis));
  settle(sk, j);
  return after - before;
}

/**
 * Analytic two-bone IK: `rootJoint` and `midJoint` turn about parallel axes; the
 * effector (the end of the second bone) is put on the target as nearly as the
 * limits allow. `bend` picks which way the middle joint folds (+1 or −1, as the
 * signed angle from the first bone to the second about the root's axis); when
 * omitted it keeps the way it folds now. Returns the distance left to the target.
 */
export function twoBone(sk: Skeleton, rootJoint: number, midJoint: number, effector: Effector, target: Vec3, bend?: 1 | -1): number {
  sk.jointFrame(rootJoint, root, axis);
  sk.jointFrame(midJoint, mid, midAxis);
  sk.point(effector.link, effector.point, end);
  // Everything in the plane normal to the root's axis.
  u[0] = mid[0] - root[0];
  u[1] = mid[1] - root[1];
  u[2] = mid[2] - root[2];
  flatten(u, axis, u);
  v[0] = end[0] - mid[0];
  v[1] = end[1] - mid[1];
  v[2] = end[2] - mid[2];
  flatten(v, axis, v);
  const l1 = Math.hypot(u[0], u[1], u[2]);
  const l2 = Math.hypot(v[0], v[1], v[2]);
  if (l1 > 1e-9 && l2 > 1e-9) {
    const tx = target[0] - root[0];
    const ty = target[1] - root[1];
    const tz = target[2] - root[2];
    const along = tx * axis[0] + ty * axis[1] + tz * axis[2];
    const d = Math.hypot(tx - axis[0] * along, ty - axis[1] * along, tz - axis[2] * along);
    // The angle between the bones now (0: straight on), and the one that reaches d.
    const now = signedAngle(u, v, axis);
    const side = bend ?? (now >= 0 ? 1 : -1);
    const cos = (d * d - l1 * l1 - l2 * l2) / (2 * l1 * l2);
    const want = side * Math.acos(Math.max(-1, Math.min(1, cos)));
    // Turning the middle joint by δ turns the second bone by δ about its own axis, which is ± the root's.
    const sense = dot(midAxis, axis) >= 0 ? 1 : -1;
    sk.set(midJoint, sk.q[midJoint]! + (want - now) * sense);
    settle(sk, midJoint);
  }
  aimPoint(sk, rootJoint, effector, target);
  sk.point(effector.link, effector.point, end);
  return Math.hypot(end[0] - target[0], end[1] - target[1], end[2] - target[2]);
}

/**
 * Cyclic coordinate descent: from the last joint to the first, each turns the
 * effector towards the target; repeated until it's within `tolerance` metres or
 * out of iterations. Returns the distance left.
 */
export function ccd(sk: Skeleton, joints: readonly number[], effector: Effector, target: Vec3, iterations = 12, tolerance = 1e-4): number {
  let error = Infinity;
  for (let it = 0; it < iterations; it++) {
    for (let k = joints.length - 1; k >= 0; k--) aimPoint(sk, joints[k]!, effector, target);
    sk.point(effector.link, effector.point, end);
    const was = error;
    error = Math.hypot(end[0] - target[0], end[1] - target[1], end[2] - target[2]);
    if (error < tolerance) break;
    // Stuck (a chain lying straight along the line to its target can't fold by aiming): bend it a little.
    if (was - error < 1e-9) {
      for (const j of joints) sk.set(j, sk.q[j]! + 0.1);
      sk.updateSubtree(sk.joints[joints[0]!]!.child);
    }
  }
  return error;
}
