import type { Skeleton, Vec3 } from "./kinematics.ts";
import type { RobotManifest } from "./manifest.ts";

/*
 * Reachy Mini (Pollen Robotics) on the council table: a body that turns on its
 * base, a head on a Stewart platform (here: yaw, pitch and roll about the
 * platform's centre) and two antennas. It turns to look at whoever it's told to
 * (the body takes part of the turn, the head the rest, as the real one does), and
 * otherwise looks about. Pure (math only), so unit-tested.
 *
 * The robot's frame (as in its URDF): x forward, y left, z up, metres, life size.
 */

const SETTLE = 4;

export class ReachyMini {
  private readonly body: number;
  private readonly yaw: number;
  private readonly pitch: number;
  private readonly roll: number;
  private readonly antennas: [number, number];
  private readonly headLink: number;
  /** Where the head turns about (robot frame, at rest). */
  readonly pivot: Vec3 = [0, 0, 0];
  /** The look now (smoothed), and the turn the body takes of it. */
  private lookYaw = 0;
  private lookPitch = 0;
  private bodyYaw = 0;
  /** Talking with Galahad (care.ts, at the council table): 0 .. 1, its head tilting and nodding as it "speaks". */
  talk = 0;

  constructor(
    readonly sk: Skeleton,
    manifest: RobotManifest,
  ) {
    this.body = sk.jointIndex("yaw_body");
    this.yaw = sk.jointIndex("head_yaw");
    this.pitch = sk.jointIndex("head_pitch");
    this.roll = sk.jointIndex("head_roll");
    this.antennas = [sk.jointIndex("left_antenna"), sk.jointIndex("right_antenna")];
    this.headLink = sk.joints[this.roll]!.child;
    if (!manifest.sites.some((s) => s.name === "head")) throw new Error("Reachy Mini: no head site");
    sk.fk();
    sk.jointFrame(this.yaw, this.pivot, [0, 0, 0]);
  }

  /**
   * Moves on by dt seconds: looking at `target` (robot frame) if there is one,
   * otherwise about the room; the skeleton's frames are current after.
   */
  step(dt: number, t: number, target: Vec3 | null): void {
    let yaw: number;
    let pitch: number;
    if (target) {
      const dx = target[0] - this.pivot[0];
      const dy = target[1] - this.pivot[1];
      const dz = target[2] - this.pivot[2];
      yaw = Math.atan2(dy, dx);
      // Pitch about +y: positive tips the face down.
      pitch = -Math.atan2(dz, Math.hypot(dx, dy));
    } else {
      yaw = 0.7 * Math.sin(t * 0.23) + 0.25 * Math.sin(t * 0.61);
      pitch = 0.12 * Math.sin(t * 0.37);
    }
    const k = 1 - Math.exp(-dt * SETTLE);
    this.lookYaw += (yaw - this.lookYaw) * k;
    this.lookPitch += (pitch - this.lookPitch) * k;
    // The body follows the look slowly and takes most of a big turn; the head does the rest at once.
    const want = this.lookYaw - Math.max(-0.5, Math.min(0.5, this.lookYaw)) * 0.6;
    this.bodyYaw += (want - this.bodyYaw) * (1 - Math.exp(-dt * SETTLE * 0.4));
    const sk = this.sk;
    sk.set(this.body, this.bodyYaw);
    sk.set(this.yaw, this.lookYaw - sk.q[this.body]!);
    sk.set(this.pitch, this.lookPitch + this.talk * 0.07 * Math.sin(t * 3.3));
    sk.set(this.roll, 0.08 * Math.sin(t * 0.5) * (target ? 0.4 : 1) + this.talk * 0.22 * Math.sin(t * 1.9 + 1.3));
    // Antennas: a slow, lopsided wave; livelier while it watches someone.
    const lively = target ? 1.6 : 1;
    sk.set(this.antennas[0], 0.25 * Math.sin(t * 1.1 * lively) + 0.1);
    sk.set(this.antennas[1], -0.25 * Math.sin(t * 1.1 * lively + 0.9) - 0.1);
    sk.fk();
  }

  /** Where the face points (robot frame, a unit vector), for tests. */
  facing(out: Vec3): Vec3 {
    const w = this.sk.world;
    const o = this.headLink * 16;
    out[0] = w[o]!;
    out[1] = w[o + 1]!;
    out[2] = w[o + 2]!;
    return out;
  }
}
