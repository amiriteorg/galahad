import {
  BoxGeometry,
  type BufferGeometry,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  type Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Object3D,
  Vector3,
} from "three/webgpu";
import { ARM, ArmTask, CUBE, follow, type Joints } from "./arms.ts";
import { headingToSceneYaw, toScene } from "./coords.ts";
import { stationMatrix } from "./keep.ts";
import { at, Mesher } from "./mesher.ts";
import { type Duck, type Leader, MicroduckFlock } from "./microducks.ts";
import { standAt } from "./path.ts";
import type { Ground } from "./physics.ts";
import { RealBench, RealDucks, RealReachy, ROBOT_SCALE } from "./robots/actors.ts";
import { loadRobot, type RobotAsset } from "./robots/load.ts";

/*
 * Small machines with a life of their own: Microducks waddling round the keep, two
 * LeRobot SO-101 arms doing pick-and-place on the lab's workbench, and Reachy Mini
 * on the council table.
 *
 * They're the real open-source robots (robots/: Open Duck Mini v2, SO-101, Reachy
 * Mini, from their URDFs, with inverse-kinematics skeletons), fetched after the
 * world first renders. Until then, and for good if a robot's assets fail to load,
 * the hand-made stand-ins below are drawn (for the ducks and the arms; Reachy has
 * none), so the world never breaks. Either way each link or body part is one
 * instanced mesh for all of its kind, posed every frame without allocating.
 */

export const MICRODUCK_LABEL = "Microduck (Pollen Robotics)";
export const ARM_LABEL = "SO-101 arm (LeRobot)";
export const REACHY_LABEL = "Reachy Mini (Pollen Robotics)";

const WHITE = 0xf3f1ec;
const PANEL = 0xd5d8de;
const ACCENT = 0x6fb0d8;
const BEAK = 0xf1a73b;
const DARK = 0x40444c;
const ARM_LIGHT = 0xf2efe8;
const ARM_TONE = 0xe8853a;
/** The stand-in ducks: bigger than life (they're 25 cm), so they read at a glance next to a 2.5 m knight. */
const DUCK_SCALE = 3.2;
/** Where the arms stand on the lab's workbench (its frame: x along it, front +z), and the bench top's height. */
const ARM_SPOTS = [0.65, 1.75];
const ARM_DEPTH = 2.0;
const BENCH_TOP = 0.93;

/** Each arm's place on the bench at a scale (scene; the arm's frame y up, forward +z). */
function benchPlaces(scale: number): Matrix4[] {
  const lab = stationMatrix("forge");
  return ARM_SPOTS.map((x) => lab.clone().multiply(at(x, BENCH_TOP, ARM_DEPTH, 0, scale)));
}

/** Reachy Mini's place on the council table (the station's frame), turned to face where Galahad stands there. */
function reachyPlace(): Matrix4 {
  const council = stationMatrix("council");
  const x = 0.25;
  const z = 0.08;
  const stand = standAt("council");
  const local = new Vector3(...toScene(stand.x, stand.y, 0)).applyMatrix4(council.clone().invert());
  return council.multiply(at(x, 0.87, z, Math.atan2(local.x - x, local.z - z), ROBOT_SCALE));
}

function instanced(geometry: BufferGeometry, material: MeshLambertMaterial, count: number, root: Group, shadows: boolean): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, Math.max(1, count));
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.castShadow = shadows;
  mesh.count = count;
  root.add(mesh);
  return mesh;
}

export class Critters {
  readonly flock: MicroduckFlock;
  private readonly material = new MeshLambertMaterial({ vertexColors: true });
  private readonly duckParts: { body: InstancedMesh; head: InstancedMesh; beak: InstancedMesh; legL: InstancedMesh; legR: InstancedMesh };
  // A duck's scratch skeleton.
  private readonly dRoot = new Object3D();
  private readonly dBody = new Object3D();
  private readonly dHead = new Object3D();
  private readonly dBeak = new Object3D();
  private readonly dLegL = new Object3D();
  private readonly dLegR = new Object3D();
  private readonly gaitOut = { roll: 0, left: 0, right: 0, bob: 0 };

  private readonly leader = new ArmTask(5);
  private readonly followerJoints: Joints = [0, 0, 0, 0, 0, 0];
  private readonly armParts: InstancedMesh[];
  private readonly cubes: InstancedMesh;
  // An arm's scratch skeleton: base → pan → upper → fore → wrist → roll → (fixed jaw, moving jaw).
  private readonly aBase = new Object3D();
  private readonly aPan = new Object3D();
  private readonly aUpper = new Object3D();
  private readonly aFore = new Object3D();
  private readonly aWrist = new Object3D();
  private readonly aRoll = new Object3D();
  private readonly aJaw = new Object3D();
  private readonly aCube = new Object3D();
  private readonly armNodes = [this.aBase, this.aPan, this.aUpper, this.aFore, this.aWrist, this.aRoll, this.aJaw];
  private readonly duckMeshes: InstancedMesh[];
  /** Each arm's place on the bench, as a transform (scene); and its world position for labels. */
  private readonly armPlace: Object3D[] = [new Object3D(), new Object3D()];
  readonly armWorld: [number, number][] = [];

  // The real robots, once loaded (null until then, or for good if loading failed).
  private realDucks: RealDucks | null = null;
  private realBench: RealBench | null = null;
  private reachy: RealReachy | null = null;
  private loading = false;
  private steps = 0;
  private disposed = false;
  private readonly originScene = new Vector3();

  constructor(
    private readonly root: Group,
    count: number,
    ground: Ground,
    private readonly shadows: boolean,
  ) {
    this.flock = new MicroduckFlock(count, ground);
    const s = DUCK_SCALE;
    // A rounded body with a tail, a neck; a head with an upper beak and eyes; a lower beak; jointed legs with flat feet.
    const body = new Mesher()
      .add(new IcosahedronGeometry(0.075 * s, 1), WHITE, at(0, 0.125 * s, 0, 0, [1, 0.88, 1.28]), 0.04)
      .add(new BoxGeometry(0.11 * s, 0.03 * s, 0.1 * s), PANEL, at(0, 0.165 * s, -0.005 * s), 0.02)
      .add(new BoxGeometry(0.115 * s, 0.012 * s, 0.03 * s), ACCENT, at(0, 0.15 * s, 0.05 * s), 0)
      .add(new BoxGeometry(0.05 * s, 0.03 * s, 0.05 * s), WHITE, at(0, 0.16 * s, -0.1 * s, 0, 1, 0.5), 0.02)
      .add(new CylinderGeometry(0.018 * s, 0.022 * s, 0.07 * s, 6), PANEL, at(0, 0.2 * s, 0.06 * s, 0, 1, 0.35), 0.02)
      .build();
    const head = new Mesher()
      .add(new IcosahedronGeometry(0.038 * s, 1), WHITE, at(0, 0, 0, 0, [1, 0.92, 1.12]), 0.03)
      .add(new BoxGeometry(0.036 * s, 0.012 * s, 0.05 * s), BEAK, at(0, -0.006 * s, 0.05 * s), 0)
      .add(new BoxGeometry(0.01 * s, 0.01 * s, 0.006 * s), DARK, at(0.022 * s, 0.01 * s, 0.03 * s), 0)
      .add(new BoxGeometry(0.01 * s, 0.01 * s, 0.006 * s), DARK, at(-0.022 * s, 0.01 * s, 0.03 * s), 0)
      .build();
    const beak = new Mesher().add(new BoxGeometry(0.032 * s, 0.008 * s, 0.045 * s), 0xe0922c, at(0, -0.004 * s, 0.022 * s), 0).build();
    const leg = () =>
      new Mesher()
        .add(new BoxGeometry(0.018 * s, 0.05 * s, 0.02 * s), DARK, at(0, -0.025 * s, 0.004 * s, 0, 1, -0.25))
        .add(new BoxGeometry(0.016 * s, 0.045 * s, 0.018 * s), DARK, at(0, -0.065 * s, 0.006 * s, 0, 1, 0.2))
        .add(new BoxGeometry(0.035 * s, 0.008 * s, 0.045 * s), BEAK, at(0, -0.088 * s, 0.018 * s), 0)
        .build();
    this.duckParts = {
      body: instanced(body, this.material, count, root, shadows),
      head: instanced(head, this.material, count, root, shadows),
      beak: instanced(beak, this.material, count, root, false),
      legL: instanced(leg(), this.material, count, root, false),
      legR: instanced(leg(), this.material, count, root, false),
    };
    this.duckMeshes = Object.values(this.duckParts);
    this.dRoot.add(this.dBody, this.dLegL, this.dLegR);
    this.dBody.add(this.dHead);
    this.dHead.add(this.dBeak);
    this.dHead.position.set(0, 0.245 * s, 0.075 * s);
    this.dBeak.position.set(0, -0.006 * s, 0.03 * s);
    this.dLegL.position.set(0.035 * s, 0.092 * s, 0);
    this.dLegR.position.set(-0.035 * s, 0.092 * s, 0);

    // The SO-101: two-tone, a base, a turning shoulder, upper arm, forearm, wrist pitch and roll, a two-jaw gripper.
    const a = new Mesher();
    const parts = [
      a.add(new CylinderGeometry(0.05, 0.06, 0.03, 10), ARM_TONE, at(0, 0.015, 0), 0).add(new BoxGeometry(0.1, 0.012, 0.1), ARM_LIGHT, at(0, 0.003, 0), 0).build(),
      new Mesher().add(new BoxGeometry(0.06, 0.07, 0.06), ARM_LIGHT, at(0, 0.035, 0)).add(new CylinderGeometry(0.03, 0.03, 0.075, 10).rotateZ(Math.PI / 2), ARM_TONE, at(0, ARM.shoulder - 0.03, 0), 0).build(),
      new Mesher().add(new BoxGeometry(0.04, ARM.upper, 0.035), ARM_LIGHT, at(0, ARM.upper / 2, 0)).add(new BoxGeometry(0.042, 0.05, 0.036), ARM_TONE, at(0, ARM.upper * 0.75, 0), 0).build(),
      new Mesher().add(new BoxGeometry(0.034, ARM.fore, 0.03), ARM_TONE, at(0, ARM.fore / 2, 0)).add(new CylinderGeometry(0.022, 0.022, 0.05, 8).rotateZ(Math.PI / 2), ARM_LIGHT, at(0, 0, 0), 0).build(),
      new Mesher().add(new BoxGeometry(0.03, ARM.wrist, 0.03), ARM_LIGHT, at(0, ARM.wrist / 2, 0)).build(),
      new Mesher().add(new BoxGeometry(0.05, 0.022, 0.035), ARM_TONE, at(0, 0.011, 0), 0).add(new BoxGeometry(0.01, ARM.grip, 0.022), DARK, at(-0.018, 0.022 + ARM.grip / 2 - 0.01, 0), 0).build(),
      new Mesher().add(new BoxGeometry(0.01, ARM.grip, 0.022), DARK, at(0, ARM.grip / 2 - 0.01, 0), 0).build(),
    ];
    this.armParts = parts.map((g) => instanced(g, this.material, 2, root, shadows));
    this.cubes = instanced(new BoxGeometry(CUBE, CUBE, CUBE), this.material, 4, root, shadows);
    const colours = [new Color(0xe35d4f), new Color(0x4f9be3), new Color(0x5cbf6e), new Color(0xf2c14e)];
    colours.forEach((c, i) => this.cubes.setColorAt(i, c));
    this.aBase.add(this.aPan);
    this.aPan.add(this.aUpper);
    this.aUpper.add(this.aFore);
    this.aFore.add(this.aWrist);
    this.aWrist.add(this.aRoll);
    this.aRoll.add(this.aJaw);
    this.aUpper.position.y = ARM.shoulder;
    this.aFore.position.y = ARM.upper;
    this.aWrist.position.y = ARM.fore;
    this.aRoll.position.y = ARM.wrist;
    // On the lab's workbench (its local frame: front +z), side by side, drawn about twice life size.
    const v = new Vector3();
    benchPlaces(2.2).forEach((m, i) => {
      const place = this.armPlace[i]!;
      place.matrix.copy(m);
      place.matrix.decompose(place.position, place.quaternion, place.scale);
      v.setFromMatrixPosition(place.matrix);
      this.armWorld.push([v.x, -v.z]);
    });
  }

  /**
   * Steps and poses everything: the ducks (round Galahad and the dog), and the arms
   * (busy while Galahad works at the lab). Positions are relative to the floating origin.
   */
  step(dt: number, t: number, galahad: Leader, dog: Leader, height: (x: number, y: number) => number, busy: boolean, origin: [number, number], motion: boolean): void {
    // The second step comes after the first frame is on screen: then fetch the real robots.
    if (!this.loading && ++this.steps >= 2) this.loadRobots();
    if (motion) this.flock.step(dt, t, galahad, dog);
    if (this.realDucks) this.realDucks.pose(this.flock.ducks, dt, t, galahad, height, origin);
    else this.poseDucks(height, origin);
    if (this.realBench) this.realBench.step(dt, busy, motion, origin);
    else {
      if (motion) {
        this.leader.step(dt, busy);
        follow(this.leader.joints, this.followerJoints, dt);
      }
      this.poseArm(0, this.leader.joints, origin);
      this.poseArm(1, this.followerJoints, origin);
      this.poseCubes(origin);
    }
    this.reachy?.step(dt, t, galahad, height, origin, motion);
  }

  /** Fetches the real robots one after another; each replaces its stand-in when (and only if) it's ready. */
  private loadRobots(): void {
    this.loading = true;
    const swap = (name: string, use: (asset: RobotAsset) => void): Promise<void> =>
      loadRobot(name)
        .then((asset) => {
          try {
            if (this.disposed) throw new Error("the world closed");
            use(asset);
          } catch (error) {
            for (const g of asset.geometries.values()) g.dispose();
            throw error;
          }
        })
        .catch((error: unknown) => {
          if (!this.disposed) console.warn(`SANDBOX: keeping the stand-in for ${name}:`, error instanceof Error ? error.message : error);
        });
    void swap("open-duck-mini-v2", (asset) => {
      const ducks = new RealDucks(asset, this.root, this.flock.ducks.length, this.material, this.shadows);
      ducks.setOrigin(this.originScene);
      this.realDucks = ducks;
      for (const m of this.duckMeshes) m.visible = false;
    })
      .then(() =>
        swap("so-101", (asset) => {
          const bench = new RealBench(asset, this.root, this.material, this.shadows, benchPlaces(ROBOT_SCALE));
          bench.setOrigin(this.originScene);
          this.realBench = bench;
          for (const m of [...this.armParts, this.cubes]) m.visible = false;
        }),
      )
      .then(() =>
        swap("reachy-mini", (asset) => {
          const reachy = new RealReachy(asset, this.root, this.material, this.shadows, reachyPlace());
          reachy.setOrigin(this.originScene);
          this.reachy = reachy;
        }),
      );
  }

  private poseDucks(height: (x: number, y: number) => number, origin: [number, number]): void {
    const p = this.duckParts;
    const ducks = this.flock.ducks;
    for (let i = 0; i < ducks.length; i++) {
      const d: Duck = ducks[i]!;
      MicroduckFlock.gait(d, this.gaitOut);
      const g = this.gaitOut;
      this.dRoot.position.set(d.x - origin[0], height(d.x, d.y) + MicroduckFlock.hopHeight(d), -(d.y - origin[1]));
      this.dRoot.rotation.set(0, headingToSceneYaw(d.heading), 0);
      this.dBody.position.y = g.bob;
      this.dBody.rotation.set(0, 0, g.roll);
      this.dHead.rotation.set(d.headPitch, d.headYaw, 0);
      this.dBeak.rotation.x = d.beak * 0.45;
      this.dLegL.rotation.x = g.left;
      this.dLegR.rotation.x = g.right;
      this.dRoot.updateMatrixWorld(true);
      p.body.setMatrixAt(i, this.dBody.matrixWorld);
      p.head.setMatrixAt(i, this.dHead.matrixWorld);
      p.beak.setMatrixAt(i, this.dBeak.matrixWorld);
      p.legL.setMatrixAt(i, this.dLegL.matrixWorld);
      p.legR.setMatrixAt(i, this.dLegR.matrixWorld);
    }
    for (let k = 0; k < this.duckMeshes.length; k++) this.duckMeshes[k]!.instanceMatrix.needsUpdate = true;
  }

  private poseArm(i: number, j: Joints, origin: [number, number]): void {
    const place = this.armPlace[i]!;
    this.aBase.position.set(place.position.x - origin[0], place.position.y, place.position.z + origin[1]);
    this.aBase.quaternion.copy(place.quaternion);
    this.aBase.scale.copy(place.scale);
    this.aPan.rotation.set(0, j[0], 0);
    this.aUpper.rotation.set(j[1], 0, 0);
    this.aFore.rotation.set(j[2], 0, 0);
    this.aWrist.rotation.set(j[3], 0, 0);
    this.aRoll.rotation.set(0, j[4], 0);
    this.aJaw.position.set(0.018 - 0.016 * j[5], 0.022, 0);
    this.aBase.updateMatrixWorld(true);
    const nodes = this.armNodes;
    for (let k = 0; k < nodes.length; k++) {
      this.armParts[k]!.setMatrixAt(i, nodes[k]!.matrixWorld);
      this.armParts[k]!.instanceMatrix.needsUpdate = true;
    }
  }

  private poseCubes(origin: [number, number]): void {
    // Two cubes per arm: the leader's, and the follower's mirrored.
    for (let arm = 0; arm < 2; arm++) {
      const place = this.armPlace[arm]!;
      for (let c = 0; c < 2; c++) {
        const cube = this.leader.cubes[c]!;
        this.aBase.position.set(place.position.x - origin[0], place.position.y, place.position.z + origin[1]);
        this.aBase.quaternion.copy(place.quaternion);
        this.aBase.scale.copy(place.scale);
        this.aBase.updateMatrixWorld(true);
        this.aCube.position.set(arm === 0 ? cube.x : -cube.x, cube.y, cube.z);
        this.aCube.updateMatrix();
        this.aCube.matrixWorld.multiplyMatrices(this.aBase.matrixWorld, this.aCube.matrix);
        this.cubes.setMatrixAt(arm * 2 + c, this.aCube.matrixWorld);
      }
    }
    this.cubes.instanceMatrix.needsUpdate = true;
  }

  /** What's under a world point, for a hover label: a Microduck, an arm or Reachy Mini (and where to put the label). */
  hover(x: number, y: number, out: [number, number, number]): string | null {
    const d = this.flock.near(x, y, 0.9);
    if (d) {
      out[0] = d.x;
      out[1] = d.y;
      out[2] = this.realDucks ? this.realDucks.labelHeight : 0.75;
      return MICRODUCK_LABEL;
    }
    if (this.reachy && Math.hypot(this.reachy.world[0] - x, this.reachy.world[1] - y) < 0.8) {
      out[0] = this.reachy.world[0];
      out[1] = this.reachy.world[1];
      out[2] = this.reachy.labelHeight;
      return REACHY_LABEL;
    }
    for (const [ax, ay] of this.armWorld) {
      if (Math.hypot(ax - x, ay - y) < 0.9) {
        out[0] = ax;
        out[1] = ay;
        out[2] = 1.9;
        return ARM_LABEL;
      }
    }
    return null;
  }

  /** The instanced meshes sit at the floating origin (their instances are relative to it). */
  place(originScene: Vector3): void {
    this.originScene.copy(originScene);
    for (const m of [...this.duckMeshes, ...this.armParts, this.cubes]) m.position.copy(originScene);
    this.realDucks?.setOrigin(originScene);
    this.realBench?.setOrigin(originScene);
    this.reachy?.setOrigin(originScene);
  }

  dispose(): void {
    this.disposed = true;
    for (const m of [...Object.values(this.duckParts), ...this.armParts, this.cubes]) {
      m.removeFromParent();
      m.geometry.dispose();
      m.dispose();
    }
    this.realDucks?.dispose();
    this.realBench?.dispose();
    this.reachy?.dispose();
    this.material.dispose();
  }
}
