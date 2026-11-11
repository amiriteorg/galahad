import { BoxGeometry, Color, DynamicDrawUsage, type Group, InstancedMesh, type Material, Matrix4, Quaternion, Vector3 } from "three/webgpu";
import { ArmTask, follow, type Joints } from "../arms.ts";
import { headingToSceneYaw } from "../coords.ts";
import { HEAD_HEIGHT } from "../knight.ts";
import { type Duck, type Leader, MicroduckFlock } from "../microducks.ts";
import { angleDiff } from "../path.ts";
import { OpenDuck } from "./duck.ts";
import { Skeleton, type Vec3 } from "./kinematics.ts";
import { type RobotAsset, RobotInstances } from "./load.ts";
import { treeOf } from "./manifest.ts";
import { ReachyMini } from "./reachy.ts";
import { So101 } from "./so101.ts";

/*
 * The real robots in the world: a flock of Open Duck Minis, two SO-101 arms on the
 * lab bench, and Reachy Mini on the council table. Each kind has one skeleton,
 * posed robot by robot, and one InstancedMesh per link for all of them.
 *
 * Every robot is drawn at ROBOT_SCALE × life size so it reads beside the 2.5 m
 * knight: an Open Duck Mini v2 (about 0.5 m tall) stands about 1.2 m here, a
 * SO-101 (about 0.27 m to the top of its folded shoulder) about 0.7 m, Reachy Mini
 * (0.39 m to its antennas' tips) about 1 m.
 */
export const ROBOT_SCALE = 2.5;

/** A robot's frame (URDF: x forward, y left, z up) → the scene's (a model facing +z, y up). */
const URDF_TO_SCENE = new Matrix4().set(0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1);
const Y_AXIS = new Vector3(0, 1, 0);

/** The ducks of the flock as Open Duck Minis: the gait on real joints, looking at Galahad when he's close. */
export class RealDucks {
  private readonly sk: Skeleton;
  private readonly duck: OpenDuck;
  private readonly instances: RobotInstances;
  private readonly place = new Matrix4();
  private readonly q = new Quaternion();
  private readonly v = new Vector3();
  private readonly s = new Vector3(ROBOT_SCALE, ROBOT_SCALE, ROBOT_SCALE);
  /** Each duck's look (smoothed): yaw left, pitch down. */
  private readonly lookYaw: Float64Array;
  private readonly lookPitch: Float64Array;
  private readonly input = { phase: 0, speed: 0, cadence: 0, hop: 0, headYaw: 0, headPitch: 0, chatter: 0, perky: false, t: 0, seed: 0 };
  /** How high above a duck's feet its label goes (metres). */
  readonly labelHeight: number;

  constructor(asset: RobotAsset, root: Group, count: number, material: Material, shadows: boolean) {
    this.sk = new Skeleton(treeOf(asset.manifest));
    this.duck = new OpenDuck(this.sk, asset.manifest);
    this.instances = new RobotInstances(asset, this.sk, count, root, material, shadows);
    this.lookYaw = new Float64Array(count);
    this.lookPitch = new Float64Array(count);
    this.labelHeight = this.duck.height * ROBOT_SCALE + 0.1;
  }

  pose(ducks: readonly Duck[], dt: number, t: number, galahad: Leader, height: (x: number, y: number) => number, origin: [number, number]): void {
    const k = 1 - Math.exp(-dt * 6);
    const input = this.input;
    for (let i = 0; i < ducks.length; i++) {
      const d = ducks[i]!;
      // Galahad close by and nothing better to do: look up at him.
      let yaw = d.headYaw;
      let pitch = d.headPitch;
      const gx = galahad.x - d.x;
      const gy = galahad.y - d.y;
      const dist = Math.hypot(gx, gy);
      if (dist < 4.5 && d.mode !== "peck" && d.mode !== "bob") {
        yaw = Math.max(-1.3, Math.min(1.3, angleDiff(d.heading, Math.atan2(gy, gx))));
        pitch = -Math.atan2(HEAD_HEIGHT - this.labelHeight * 0.85, Math.max(0.5, dist));
      }
      this.lookYaw[i] = this.lookYaw[i]! + (yaw - this.lookYaw[i]!) * k;
      this.lookPitch[i] = this.lookPitch[i]! + (pitch - this.lookPitch[i]!) * k;
      input.phase = d.phase;
      input.speed = d.speed / ROBOT_SCALE;
      input.cadence = MicroduckFlock.cadence(d.speed);
      input.hop = MicroduckFlock.hopHeight(d) / ROBOT_SCALE;
      input.headYaw = this.lookYaw[i]!;
      input.headPitch = this.lookPitch[i]!;
      input.chatter = d.beak;
      input.perky = d.following !== 0;
      input.t = t;
      input.seed = i * 1.7;
      this.duck.pose(input);
      this.q.setFromAxisAngle(Y_AXIS, headingToSceneYaw(d.heading));
      this.v.set(d.x - origin[0], height(d.x, d.y), -(d.y - origin[1]));
      this.place.compose(this.v, this.q, this.s).multiply(URDF_TO_SCENE);
      this.instances.write(i, this.sk, this.place);
    }
    this.instances.commit();
  }

  setOrigin(originScene: Vector3): void {
    this.instances.place(originScene);
  }

  dispose(): void {
    this.instances.dispose();
  }
}

/** Two SO-101s on the lab bench doing pick-and-place, the second mirroring the first (leader and follower). */
export class RealBench {
  readonly leader: ArmTask;
  private readonly follower: Joints = [0, 0, 0, 0, 0, 0];
  private readonly drawSk: Skeleton;
  private readonly draw: So101;
  private readonly instances: RobotInstances;
  private readonly cubes: InstancedMesh;
  private readonly place = new Matrix4();
  private readonly cube = new Matrix4();
  private readonly shift = new Matrix4();

  /** `places`: each arm's place on the bench in the scene (its frame: y up, forward +z), drawn ROBOT_SCALE × life size. */
  constructor(
    asset: RobotAsset,
    root: Group,
    material: Material,
    shadows: boolean,
    private readonly places: readonly Matrix4[],
  ) {
    const solver = new So101(new Skeleton(treeOf(asset.manifest)), asset.manifest);
    this.leader = new ArmTask(5, solver.layout());
    this.drawSk = new Skeleton(treeOf(asset.manifest));
    this.draw = new So101(this.drawSk, asset.manifest);
    this.instances = new RobotInstances(asset, this.drawSk, places.length, root, material, shadows);
    this.cubes = new InstancedMesh(new BoxGeometry(1, 1, 1), material, places.length * 2);
    this.cubes.instanceMatrix.setUsage(DynamicDrawUsage);
    this.cubes.frustumCulled = false;
    this.cubes.castShadow = shadows;
    [0xe35d4f, 0x4f9be3, 0x5cbf6e, 0xf2c14e].slice(0, places.length * 2).forEach((c, i) => this.cubes.setColorAt(i, new Color(c)));
    root.add(this.cubes);
    for (let i = 0; i < 6; i++) this.follower[i] = this.leader.joints[i]!;
  }

  step(dt: number, busy: boolean, motion: boolean, origin: [number, number]): void {
    if (motion) {
      this.leader.step(dt, busy);
      follow(this.leader.joints, this.follower, dt);
    }
    this.shift.makeTranslation(-origin[0], 0, origin[1]);
    const size = this.leader.layout.cube;
    for (let arm = 0; arm < this.places.length; arm++) {
      this.draw.apply(arm === 0 ? this.leader.joints : this.follower);
      this.place.multiplyMatrices(this.shift, this.places[arm]!);
      // The cubes, in the arm's frame (the follower's mirrored).
      for (let c = 0; c < 2; c++) {
        const cube = this.leader.cubes[c]!;
        this.cube.makeScale(size, size, size).setPosition(arm === 0 ? cube.x : -cube.x, cube.y, cube.z);
        this.cube.premultiply(this.place);
        this.cubes.setMatrixAt(arm * 2 + c, this.cube);
      }
      // The skeleton's own base already turns the URDF into the arm's frame (So101).
      this.instances.write(arm, this.drawSk, this.place);
    }
    this.instances.commit();
    this.cubes.instanceMatrix.needsUpdate = true;
  }

  setOrigin(originScene: Vector3): void {
    this.instances.place(originScene);
    this.cubes.position.copy(originScene);
  }

  dispose(): void {
    this.instances.dispose();
    this.cubes.removeFromParent();
    this.cubes.geometry.dispose();
    this.cubes.dispose();
  }
}

/** Reachy Mini on the council table: looks at Galahad when he's at the table, and about the room when he isn't. */
export class RealReachy {
  private readonly sk: Skeleton;
  private readonly reachy: ReachyMini;
  private readonly instances: RobotInstances;
  private readonly place = new Matrix4();
  private readonly shift = new Matrix4();
  private readonly toLocal = new Matrix4();
  private readonly v = new Vector3();
  private readonly target: Vec3 = [0, 0, 0];
  /** Where it stands in the world (z up: x, y), and how high its label goes above the ground there. */
  readonly world: [number, number];
  readonly labelHeight: number;
  private posed = false;

  /** `at`: its place in the scene (its frame: y up, forward +z), drawn ROBOT_SCALE × life size. */
  constructor(
    asset: RobotAsset,
    root: Group,
    material: Material,
    shadows: boolean,
    private readonly at: Matrix4,
  ) {
    this.sk = new Skeleton(treeOf(asset.manifest));
    this.reachy = new ReachyMini(this.sk, asset.manifest);
    this.instances = new RobotInstances(asset, this.sk, 1, root, material, shadows);
    this.toLocal.multiplyMatrices(at, URDF_TO_SCENE).invert();
    this.v.setFromMatrixPosition(at);
    this.world = [this.v.x, -this.v.z];
    this.labelHeight = this.v.y + 0.42 * ROBOT_SCALE;
  }

  /** Talking with Galahad while he's at the table (care.ts): 0 .. 1. */
  talk = 0;

  step(dt: number, t: number, galahad: Leader, groundAt: (x: number, y: number) => number, origin: [number, number], motion: boolean): void {
    if (!motion && this.posed) return;
    this.posed = true;
    const near = Math.hypot(galahad.x - this.world[0], galahad.y - this.world[1]) < 5;
    if (near) {
      this.v.set(galahad.x, groundAt(galahad.x, galahad.y) + HEAD_HEIGHT * 0.92, -galahad.y).applyMatrix4(this.toLocal);
      this.target[0] = this.v.x;
      this.target[1] = this.v.y;
      this.target[2] = this.v.z;
    }
    this.reachy.talk = near ? this.talk : 0;
    this.reachy.step(motion ? dt : 0, t, near ? this.target : null);
    this.shift.makeTranslation(-origin[0], 0, origin[1]);
    this.place.multiplyMatrices(this.shift, this.at).multiply(URDF_TO_SCENE);
    this.instances.write(0, this.sk, this.place);
    this.instances.commit();
  }

  setOrigin(originScene: Vector3): void {
    this.instances.place(originScene);
  }

  dispose(): void {
    this.instances.dispose();
  }
}
