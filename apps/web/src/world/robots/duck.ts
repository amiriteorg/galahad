import { aimDirection, aimPoint, type Effector, twoBone } from "./ik.ts";
import { fromXyzRpy, type Skeleton, type Vec3 } from "./kinematics.ts";
import type { RobotManifest } from "./manifest.ts";

/*
 * The Open Duck Mini v2 walking, on its real joints. Each leg is hip yaw, roll and
 * pitch, a knee and an ankle; the neck pitches, the head pitches, yaws and rolls,
 * and two antennas turn. A gait phase drives a foot trajectory per leg (planted
 * and sliding back under the body for half a cycle, lifted and swung forward for
 * the other half, the legs half a cycle apart); leg IK turns each into joint
 * angles (the two-bone solution for hip pitch and knee, the hip's roll for the
 * sideways part, the ankle keeping the foot flat). The body sways over the planted
 * foot, rolls with the waddle and bobs; the head and neck look where they're told;
 * the antennas bounce. Pure (math only), so unit-tested.
 *
 * The robot's frame (as in its URDF): x forward, y left, z up, metres, life size.
 * `pose` puts the skeleton in the duck's ground frame: origin on the ground under
 * the body, the same axes.
 */

/** The real duck's standing crouch (its runtime's initial pose). */
const CROUCH: Record<string, number> = {
  left_hip_yaw: 0,
  left_hip_roll: 0.05,
  left_hip_pitch: -0.63,
  left_knee: 1.368,
  left_ankle: -0.784,
  right_hip_yaw: 0,
  right_hip_roll: -0.05,
  right_hip_pitch: 0.635,
  right_knee: 1.379,
  right_ankle: -0.796,
};

/** The sole sits this far under each foot's frame. */
const SOLE = 0.003;
/** Longest stride (metres), most lift, and how far the body sways and bobs. */
const MAX_STRIDE = 0.09;
const LIFT = 0.028;
const SWAY = 0.011;
const ROLL = 0.07;
const BOB = 0.006;
const LEAN = 0.09;

export interface DuckPoseInput {
  /** Gait phase, radians: the left foot swings while sin(phase) > 0, the right while it's < 0. */
  phase: number;
  /** Walking speed (m/s, life size) and the phase's rate (rad/s), which set the stride. */
  speed: number;
  cadence: number;
  /** How high the body is off the ground in a hop (metres, life size; 0 when not hopping). */
  hop: number;
  /** Where the head looks: yaw left positive, pitch down positive (radians). */
  headYaw: number;
  headPitch: number;
  /** 0…1: chattering (the antennas flick). */
  chatter: number;
  /** Antennas up: tagging along behind someone. */
  perky: boolean;
  /** Seconds, for idle motion. */
  t: number;
  /** A little offset in the idle motion, so a flock doesn't move as one. */
  seed: number;
}

/** Which feet are on the ground at a gait phase: [left, right]. One swings at a time; both are down as they swap. */
export function footContacts(phase: number, out: [boolean, boolean] = [true, true]): [boolean, boolean] {
  const s = Math.sin(phase);
  out[0] = s <= 1e-9;
  out[1] = s >= -1e-9;
  return out;
}

/** The stride (metres, life size) that keeps a planted foot still under a body moving at `speed` with this cadence. */
export const strideFor = (speed: number, cadence: number): number => (cadence > 0 ? Math.min(MAX_STRIDE, (speed * Math.PI) / cadence) : 0);

interface Leg {
  yaw: number;
  roll: number;
  pitch: number;
  knee: number;
  ankle: number;
  /** The ankle's pivot, and the sole. */
  ankleEffector: Effector;
  sole: Effector;
  footLink: number;
  /** The foot's up, in its own frame (from the crouch, where it stands flat). */
  footUp: Vec3;
  bend: 1 | -1;
  /** Where the sole stands in the crouch, in the ground frame. */
  home: Vec3;
  /** From the sole to the ankle's pivot, with the foot flat. */
  soleToAnkle: Vec3;
  /** Which half of the cycle it swings in. */
  offset: number;
}

const UP: Vec3 = [0, 0, 1];
const ankleTarget: Vec3 = [0, 0, 0];
const xyz: Vec3 = [0, 0, 0];
const rpy: Vec3 = [0, 0, 0];
const p: Vec3 = [0, 0, 0];
const q: Vec3 = [0, 0, 0];

export class OpenDuck {
  readonly legs: Leg[];
  /** The body's height (the root frame above the ground) in the crouch. */
  readonly standHeight: number;
  /** The tallest point when standing (the antennas' tips, about), metres. */
  readonly height: number;
  private readonly neck: number;
  private readonly headPitchJ: number;
  private readonly headYawJ: number;
  private readonly headRollJ: number;
  private readonly antennas: [number, number];

  constructor(
    readonly sk: Skeleton,
    manifest: RobotManifest,
  ) {
    for (const [name, value] of Object.entries(CROUCH)) sk.set(sk.jointIndex(name), value);
    fromXyzRpy([0, 0, 0], [0, 0, 0], sk.base);
    sk.fk();
    const site = (name: string): Effector => {
      const s = manifest.sites.find((x) => x.name === name);
      if (!s) throw new Error(`Open Duck: no site ${name}`);
      return { link: sk.linkIndex(s.link), point: [s.xyz[0], s.xyz[1], s.xyz[2]] };
    };
    const soles = [site("left_foot"), site("right_foot")];
    let lowest = 0;
    for (const s of soles) lowest = Math.min(lowest, sk.point(s.link, s.point, p)[2] - SOLE);
    this.standHeight = -lowest;
    this.legs = (["left", "right"] as const).map((side, i) => {
      const pitch = sk.jointIndex(`${side}_hip_pitch`);
      const knee = sk.jointIndex(`${side}_knee`);
      const ankle = sk.jointIndex(`${side}_ankle`);
      const footLink = sk.joints[ankle]!.child;
      const ankleEffector: Effector = { link: footLink, point: [0, 0, 0] };
      const sole = soles[i]!;
      sk.point(sole.link, sole.point, p);
      p[2] -= SOLE;
      sk.point(footLink, [0, 0, 0], q);
      // The foot's up, in its own frame: the world's up through its frame's rotation, transposed.
      const w = sk.world;
      const o = footLink * 16;
      const footUp: Vec3 = [w[o + 2]!, w[o + 6]!, w[o + 10]!];
      // The way the knee folds in the crouch: the signed angle from thigh to shin about the hip's axis.
      const hip: Vec3 = [0, 0, 0];
      const axis: Vec3 = [0, 0, 0];
      const kneeAt: Vec3 = [0, 0, 0];
      sk.jointFrame(pitch, hip, axis);
      sk.jointFrame(knee, kneeAt, [0, 0, 0]);
      const a: Vec3 = [kneeAt[0] - hip[0], kneeAt[1] - hip[1], kneeAt[2] - hip[2]];
      const b: Vec3 = [q[0] - kneeAt[0], q[1] - kneeAt[1], q[2] - kneeAt[2]];
      const cross = (a[1] * b[2] - a[2] * b[1]) * axis[0] + (a[2] * b[0] - a[0] * b[2]) * axis[1] + (a[0] * b[1] - a[1] * b[0]) * axis[2];
      return {
        yaw: sk.jointIndex(`${side}_hip_yaw`),
        roll: sk.jointIndex(`${side}_hip_roll`),
        pitch,
        knee,
        ankle,
        ankleEffector,
        sole,
        footLink,
        footUp,
        bend: cross >= 0 ? 1 : -1,
        home: [p[0], p[1], 0],
        soleToAnkle: [q[0] - p[0], q[1] - p[1], q[2] - p[2]],
        offset: i === 0 ? 0 : Math.PI,
      } satisfies Leg;
    });
    this.neck = sk.jointIndex("neck_pitch");
    this.headPitchJ = sk.jointIndex("head_pitch");
    this.headYawJ = sk.jointIndex("head_yaw");
    this.headRollJ = sk.jointIndex("head_roll");
    this.antennas = [sk.jointIndex("left_antenna"), sk.jointIndex("right_antenna")];
    // Its height standing: the highest joint pivot (the antennas') plus their length, near enough.
    const head = site("head");
    this.height = this.standHeight + sk.point(head.link, head.point, p)[2] + 0.09;
    this.pose({ phase: 0, speed: 0, cadence: 6, hop: 0, headYaw: 0, headPitch: 0, chatter: 0, perky: false, t: 0, seed: 0 });
  }

  /** Poses the whole duck (joints and body) for this moment of its gait; the skeleton's frames are current after. */
  pose(input: DuckPoseInput): void {
    const sk = this.sk;
    const moving = Math.min(1, input.speed / 0.08);
    const stride = strideFor(input.speed, input.cadence);
    const s = Math.sin(input.phase);
    // The body: over the planted foot, rolled with the waddle, bobbing, leaning into the walk; up in a hop.
    const sway = -SWAY * s * moving;
    const roll = ROLL * s * moving;
    const bob = BOB * Math.abs(s) * moving;
    const lean = LEAN * moving;
    xyz[0] = -0.004 * moving;
    xyz[1] = sway;
    xyz[2] = this.standHeight + bob + input.hop;
    rpy[0] = roll;
    rpy[1] = lean;
    fromXyzRpy(xyz, rpy, sk.base);
    sk.updateLink(0);
    // The legs: each sole on its trajectory, the leg solved to reach it.
    for (const leg of this.legs) {
      const theta = input.phase + leg.offset;
      const swing = Math.max(0, Math.sin(theta));
      ankleTarget[0] = leg.home[0] - (stride / 2) * Math.cos(theta) + leg.soleToAnkle[0];
      ankleTarget[1] = leg.home[1] + leg.soleToAnkle[1];
      ankleTarget[2] = LIFT * swing * moving + input.hop * 0.45 + leg.soleToAnkle[2];
      sk.set(leg.yaw, 0);
      sk.updateSubtree(sk.joints[leg.yaw]!.child);
      for (let pass = 0; pass < 2; pass++) {
        twoBone(sk, leg.pitch, leg.knee, leg.ankleEffector, ankleTarget, leg.bend);
        aimPoint(sk, leg.roll, leg.ankleEffector, ankleTarget);
      }
      twoBone(sk, leg.pitch, leg.knee, leg.ankleEffector, ankleTarget, leg.bend);
      // The foot flat on the ground.
      aimDirection(sk, leg.ankle, leg.footLink, leg.footUp, UP);
    }
    // The head: the neck takes part of a look up or down, the head the rest.
    const pitch = input.headPitch;
    const neck = sk.set(this.neck, pitch > 0 ? -0.35 * Math.min(1, pitch / 0.8) : -0.6 * pitch);
    sk.set(this.headPitchJ, -pitch - neck);
    sk.set(this.headYawJ, input.headYaw);
    sk.set(this.headRollJ, 0.12 * Math.sin(input.t * 0.7 + input.seed) * (1 - moving * 0.5));
    // The antennas: a slow sway, a bounce with each step, a flick when it chatters; up when it tags along.
    const idle = 0.12 * Math.sin(input.t * 1.3 + input.seed);
    const bounce = 0.22 * Math.sin(2 * input.phase) * moving;
    const flick = input.chatter * 0.45 * Math.sin(input.t * 22 + input.seed);
    const up = input.perky ? -0.5 : 0;
    sk.set(this.antennas[0], up + idle + bounce + flick);
    sk.set(this.antennas[1], up - idle * 0.8 + bounce - flick);
    sk.fk();
  }

  /** Where each sole is now (ground frame), for tests and for pinning feet. */
  sole(leg: number, out: Vec3): Vec3 {
    const l = this.legs[leg]!;
    this.sk.point(l.sole.link, l.sole.point, out);
    out[2] -= SOLE;
    return out;
  }
}
