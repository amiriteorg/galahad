import type { ArmLayout, Joints } from "../arms.ts";
import { aimDirection, aimPoint, type Effector, twoBone } from "./ik.ts";
import type { Skeleton, Vec3 } from "./kinematics.ts";
import type { RobotManifest } from "./manifest.ts";

/*
 * The real SO-101 (TheRobotStudio / LeRobot): its URDF chain is a turning base
 * (shoulder_pan), a shoulder and elbow (shoulder_lift, elbow_flex), a wrist that
 * pitches and rolls (wrist_flex, wrist_roll), and a moving jaw (gripper). The
 * pick-and-place task (arms.ts) asks for the gripper's fingertips at a point,
 * pointing down; this solves that on the real chain: the base turns to face the
 * target, the two-bone solution puts the wrist above it, and the wrist pitches the
 * gripper straight down; a couple of passes settle the small offsets the real
 * arm has. Pure (math only), so unit-tested.
 *
 * The task's frame is the old arm's: y up, forward +z, metres, origin on the bench
 * under the base. The URDF's base is z up, forward +x; the skeleton's base maps one
 * to the other.
 */

/** Pick-and-place for the real arm (its own size: a desk arm reaching about 30 cm). */
export const SO101_LAYOUT_SPOTS = {
  slots: [
    [-0.075, 0.17],
    [0.005, 0.2],
    [0.08, 0.16],
  ] as const,
  cube: 0.025,
  // Hovering over the work, gripper down (higher or nearer the base, the wrist can't point it down).
  home: [0, 0.1, 0.18] as const,
  above: 0.06,
};

/** The gripper's joint value open and closed on a cube. */
const GRIP_OPEN = 0.9;
const GRIP_CLOSED = 0.12;

const UP: Vec3 = [0, 1, 0];
const target: Vec3 = [0, 0, 0];
const tcp: Vec3 = [0, 0, 0];
const wrist: Vec3 = [0, 0, 0];

export class So101 {
  readonly pan: number;
  readonly lift: number;
  readonly elbow: number;
  readonly flex: number;
  readonly roll: number;
  readonly grip: number;
  /** The fingertips (the URDF's gripper frame) and the wrist's pivot. */
  readonly tip: Effector;
  private readonly wristPivot: Effector;
  private readonly gripperLink: number;
  /** Which way the elbow folds (up, as the real arm works). */
  private readonly bend: 1 | -1;

  constructor(
    readonly sk: Skeleton,
    manifest: RobotManifest,
  ) {
    this.pan = sk.jointIndex("shoulder_pan");
    this.lift = sk.jointIndex("shoulder_lift");
    this.elbow = sk.jointIndex("elbow_flex");
    this.flex = sk.jointIndex("wrist_flex");
    this.roll = sk.jointIndex("wrist_roll");
    this.grip = sk.jointIndex("gripper");
    const site = manifest.sites.find((s) => s.name === "gripper_frame_link");
    if (!site) throw new Error("SO-101: no gripper frame");
    this.tip = { link: sk.linkIndex(site.link), point: site.xyz };
    this.wristPivot = { link: sk.joints[this.flex]!.child, point: [0, 0, 0] };
    this.gripperLink = sk.joints[this.roll]!.child;
    // URDF base (x forward, y left, z up) → the task's frame (z forward, x left, y up).
    sk.base.set([0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1]);
    sk.fk();
    // Elbow up: whichever fold keeps the elbow above the line from shoulder to wrist.
    this.bend = 1;
    this.reach(0, 0.08, 0.2);
    const elbowUp = this.elbowAboveLine();
    this.bend = elbowUp ? 1 : -1;
    for (let j = 0; j < sk.q.length; j++) sk.q[j] = 0;
    sk.fk();
  }

  private elbowAboveLine(): boolean {
    const s: Vec3 = [0, 0, 0];
    const e: Vec3 = [0, 0, 0];
    const w: Vec3 = [0, 0, 0];
    const axis: Vec3 = [0, 0, 0];
    this.sk.jointFrame(this.lift, s, axis);
    this.sk.jointFrame(this.elbow, e, axis);
    this.sk.jointFrame(this.flex, w, axis);
    const t = (e[2] - s[2]) * (w[2] - s[2]) + (e[0] - s[0]) * (w[0] - s[0]);
    const len = (w[2] - s[2]) ** 2 + (w[0] - s[0]) ** 2;
    const k = len > 0 ? t / len : 0;
    return e[1] > s[1] + (w[1] - s[1]) * k;
  }

  /** Puts the fingertips at (x, y, z) in the task's frame, pointing down. Returns the distance left (metres). */
  reach(x: number, y: number, z: number): number {
    const sk = this.sk;
    target[0] = x;
    target[1] = y;
    target[2] = z;
    for (let pass = 0; pass < 3; pass++) {
      aimPoint(sk, this.pan, this.tip, target);
      aimDirection(sk, this.flex, this.gripperLink, [0, 0, 1], UP);
      // Where the wrist must be for the fingertips to land on the target, with the gripper as it points now.
      sk.point(this.tip.link, this.tip.point, tcp);
      sk.point(this.wristPivot.link, this.wristPivot.point, wrist);
      wrist[0] = target[0] - (tcp[0] - wrist[0]);
      wrist[1] = target[1] - (tcp[1] - wrist[1]);
      wrist[2] = target[2] - (tcp[2] - wrist[2]);
      twoBone(sk, this.lift, this.elbow, this.wristPivot, wrist, this.bend);
      aimDirection(sk, this.flex, this.gripperLink, [0, 0, 1], UP);
    }
    sk.point(this.tip.link, this.tip.point, tcp);
    return Math.hypot(tcp[0] - x, tcp[1] - y, tcp[2] - z);
  }

  /** The task's solver: joints 0–3 (pan, lift, elbow, wrist pitch) for fingertips at (x, y, z). */
  readonly solve = (x: number, y: number, z: number, out: Joints): boolean => {
    const error = this.reach(x, y, z);
    out[0] = this.sk.q[this.pan]!;
    out[1] = this.sk.q[this.lift]!;
    out[2] = this.sk.q[this.elbow]!;
    out[3] = this.sk.q[this.flex]!;
    return error < 0.002;
  };

  /** The task's layout for this arm. */
  layout(): ArmLayout {
    return { ...SO101_LAYOUT_SPOTS, solve: this.solve };
  }

  /** Poses the skeleton from task joints (pan, lift, elbow, wrist pitch, wrist roll, grip 0 open … 1 closed). */
  apply(j: Joints): void {
    const sk = this.sk;
    sk.set(this.pan, j[0]);
    sk.set(this.lift, j[1]);
    sk.set(this.elbow, j[2]);
    sk.set(this.flex, j[3]);
    sk.set(this.roll, j[4]);
    sk.set(this.grip, GRIP_OPEN + (GRIP_CLOSED - GRIP_OPEN) * j[5]);
    sk.fk();
  }
}
