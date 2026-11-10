import { rng } from "./physics.ts";

/*
 * Two LeRobot SO-101 arms on the lab's workbench, doing pick-and-place with small
 * coloured cubes. The leader solves its own inverse kinematics (base yaw, a
 * two-link shoulder and elbow, the wrist keeping the gripper pointing down) along
 * straight moves: reach above a cube, descend, grasp, lift, carry, set it down in
 * the free slot, return, pause. The follower mirrors the leader's joints a moment
 * later, as in leader/follower teleoperation, on its own mirrored cubes. Busy while
 * Galahad works at the lab, resting otherwise. Pure, so unit-tested.
 *
 * Each arm's own frame: y up, forward +z, origin on the bench under its base;
 * metres (drawn a little larger than the real arm, to be seen).
 */

export const ARM = {
  /** The shoulder joint's height above the bench. */
  shoulder: 0.1,
  upper: 0.2,
  fore: 0.18,
  /** Wrist link, and the gripper from wrist to fingertips. */
  wrist: 0.06,
  grip: 0.07,
} as const;

/** Joint angles: base yaw, shoulder and elbow (from vertical, forward positive), wrist pitch, wrist roll, grip (0 open, 1 closed). */
export type Joints = [number, number, number, number, number, number];

/** Inverse kinematics for a fingertip target (arm frame), the gripper pointing straight down. Writes into `out`; returns false when the target is out of reach (it then reaches as far as it can). */
export function solveArm(x: number, y: number, z: number, out: Joints): boolean {
  const yaw = Math.atan2(x, z);
  const r = Math.hypot(x, z);
  // The wrist sits straight above the fingertips.
  const h = y + ARM.wrist + ARM.grip - ARM.shoulder;
  let d = Math.hypot(r, h);
  const max = ARM.upper + ARM.fore - 1e-6;
  const reachable = d <= max && d >= Math.abs(ARM.upper - ARM.fore);
  d = Math.max(Math.abs(ARM.upper - ARM.fore) + 1e-6, Math.min(max, d));
  const cosElbow = (d * d - ARM.upper * ARM.upper - ARM.fore * ARM.fore) / (2 * ARM.upper * ARM.fore);
  const elbow = Math.acos(Math.max(-1, Math.min(1, cosElbow)));
  const towards = Math.atan2(r, h);
  const shoulder = towards - Math.atan2(ARM.fore * Math.sin(elbow), ARM.upper + ARM.fore * Math.cos(elbow));
  out[0] = yaw;
  out[1] = shoulder;
  out[2] = elbow;
  out[3] = Math.PI - shoulder - elbow;
  return reachable;
}

/** Where the fingertips are for some joints (arm frame): for tests and for carrying a cube. */
export function fingertips(j: Joints, out: [number, number, number]): [number, number, number] {
  const a1 = j[1];
  const a12 = j[1] + j[2];
  const a123 = a12 + j[3];
  // In the arm's vertical plane: forward r, up h.
  const r = ARM.upper * Math.sin(a1) + ARM.fore * Math.sin(a12) + (ARM.wrist + ARM.grip) * Math.sin(a123);
  const h = ARM.shoulder + ARM.upper * Math.cos(a1) + ARM.fore * Math.cos(a12) + (ARM.wrist + ARM.grip) * Math.cos(a123);
  out[0] = Math.sin(j[0]) * r;
  out[1] = h;
  out[2] = Math.cos(j[0]) * r;
  return out;
}

export interface Cube {
  x: number;
  y: number;
  z: number;
  /** Which slot it sits in, or −1 while carried. */
  slot: number;
}

/** Where cubes may sit, in front of the arm (arm frame, on the bench). */
export const SLOTS: [number, number][] = [
  [-0.2, 0.22],
  [0.02, 0.3],
  [0.22, 0.2],
];
export const CUBE = 0.04;
const HOME: [number, number, number] = [0, 0.26, 0.12];
const ABOVE = 0.12;

/**
 * Where an arm works and how it reaches: the cube slots, the cube's size, where it
 * rests, how high it lifts, and its inverse kinematics (fingertips at x, y, z in
 * the arm's frame, the gripper pointing down; writes joints 0–3, returns whether
 * it reached). The hand-made arm's by default; the real SO-101 brings its own.
 */
export interface ArmLayout {
  slots: readonly (readonly [number, number])[];
  cube: number;
  home: readonly [number, number, number];
  above: number;
  solve: (x: number, y: number, z: number, out: Joints) => boolean;
}

export const HAND_MADE_ARM: ArmLayout = { slots: SLOTS, cube: CUBE, home: HOME, above: ABOVE, solve: solveArm };

type Phase = "rest" | "reach" | "descend" | "grasp" | "lift" | "carry" | "lower" | "release" | "rise" | "return" | "pause";

const ease = (t: number): number => t * t * (3 - 2 * t);

export class ArmTask {
  readonly joints: Joints = [0, 0, 0, 0, 0, 0];
  readonly cubes: Cube[] = [];
  held = -1;
  phase: Phase = "rest";
  private t = 0;
  private duration = 1;
  private pick = 0;
  private drop = 0;
  private readonly random: () => number;
  private readonly from: [number, number, number];
  private readonly to: [number, number, number];
  private readonly tip: [number, number, number];

  constructor(
    seed = 3,
    readonly layout: ArmLayout = HAND_MADE_ARM,
  ) {
    this.random = rng(seed);
    const { slots, cube, home } = layout;
    this.from = [...home];
    this.to = [...home];
    this.tip = [...home];
    this.cubes.push({ x: slots[0]![0], y: cube / 2, z: slots[0]![1], slot: 0 }, { x: slots[1]![0], y: cube / 2, z: slots[1]![1], slot: 1 });
    layout.solve(home[0], home[1], home[2], this.joints);
  }

  private move(phase: Phase, to: readonly [number, number, number], seconds: number): void {
    this.phase = phase;
    this.from[0] = this.tip[0];
    this.from[1] = this.tip[1];
    this.from[2] = this.tip[2];
    this.to[0] = to[0];
    this.to[1] = to[1];
    this.to[2] = to[2];
    this.t = 0;
    this.duration = seconds * (0.85 + this.random() * 0.35);
  }

  private slotPoint(slot: number, height: number): [number, number, number] {
    const [x, z] = this.layout.slots[slot]!;
    return [x, height, z];
  }

  /** Advances the task by dt seconds. `busy`: start new cycles (otherwise it finishes what it holds and rests). */
  step(dt: number, busy: boolean): void {
    this.t += dt;
    const done = this.t >= this.duration;
    const k = ease(Math.min(1, this.t / this.duration));
    this.tip[0] = this.from[0] + (this.to[0] - this.from[0]) * k;
    this.tip[1] = this.from[1] + (this.to[1] - this.from[1]) * k;
    this.tip[2] = this.from[2] + (this.to[2] - this.from[2]) * k;
    let grip = this.joints[5];
    if (this.phase === "grasp") grip = k;
    else if (this.phase === "release") grip = 1 - k;
    if (done) this.next(busy);
    this.layout.solve(this.tip[0], this.tip[1], this.tip[2], this.joints);
    // The wrist turns a little as it works, as a hand would.
    this.joints[4] = this.phase === "rest" ? 0 : 0.35 * Math.sin(this.tip[0] * 6);
    this.joints[5] = grip;
    if (this.held >= 0) {
      const c = this.cubes[this.held]!;
      c.x = this.tip[0];
      c.y = this.tip[1] - this.layout.cube * 0.4;
      c.z = this.tip[2];
    }
  }

  private next(busy: boolean): void {
    const { cube, above, home, slots } = this.layout;
    switch (this.phase) {
      case "rest":
      case "pause": {
        if (!busy) {
          this.move("rest", home, 0.8);
          return;
        }
        // A cube, and the free slot.
        this.pick = Math.floor(this.random() * this.cubes.length);
        const used = new Set(this.cubes.map((c) => c.slot));
        const free = slots.map((_, s) => s).filter((s) => !used.has(s));
        this.drop = free[Math.floor(this.random() * free.length)] ?? 2;
        const c = this.cubes[this.pick]!;
        this.move("reach", [c.x, cube / 2 + above * (1 + this.random() / 3), c.z], 0.9);
        return;
      }
      case "reach": {
        const c = this.cubes[this.pick]!;
        this.move("descend", [c.x, cube * 0.6, c.z], 0.5);
        return;
      }
      case "descend":
        this.move("grasp", this.tip, 0.3);
        return;
      case "grasp":
        this.held = this.pick;
        this.cubes[this.pick]!.slot = -1;
        this.move("lift", [this.tip[0], cube / 2 + above, this.tip[2]], 0.45);
        return;
      case "lift":
        this.move("carry", this.slotPoint(this.drop, cube / 2 + above), 1);
        return;
      case "carry":
        this.move("lower", this.slotPoint(this.drop, cube * 0.6), 0.5);
        return;
      case "lower":
        this.move("release", this.tip, 0.3);
        return;
      case "release": {
        const c = this.cubes[this.held]!;
        const [x, z] = slots[this.drop]!;
        c.x = x;
        c.y = cube / 2;
        c.z = z;
        c.slot = this.drop;
        this.held = -1;
        this.move("rise", [this.tip[0], cube / 2 + above, this.tip[2]], 0.4);
        return;
      }
      case "rise":
        this.move("return", home, 0.8);
        return;
      case "return":
        this.move("pause", home, 0.6 + this.random() * 1.4);
        return;
    }
  }
}

/** The follower: the leader's joints, mirrored left-right, a moment behind. */
export function follow(leader: Joints, follower: Joints, dt: number): void {
  const k = 1 - Math.exp(-dt * 10);
  for (let i = 0; i < 6; i++) {
    const target = i === 0 || i === 4 ? -leader[i]! : leader[i]!;
    follower[i] = follower[i]! + (target - follower[i]!) * k;
  }
}
