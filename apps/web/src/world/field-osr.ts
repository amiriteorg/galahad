import { Bone, BufferAttribute, BufferGeometry, type Material, Matrix4, Quaternion, Skeleton as Bones, SkinnedMesh, Uint16BufferAttribute, Vector3 } from "three/webgpu";
import { headingToSceneYaw } from "./coords.ts";
import { TRACK_TOP } from "./field-ground.ts";
import { OSR_SCALE, type RoverState } from "./field-rover.ts";
import { ROBOT_MANIFESTS } from "./assets/robots/index.ts";
import { Skeleton } from "./robots/kinematics.ts";
import { linkGeometry, ROBOT_ASSET_PATH } from "./robots/load.ts";
import { decodeMeshes, type LinkMesh, parseManifest, type RobotManifest, treeOf } from "./robots/manifest.ts";

/*
 * The real Open Source Rover (NASA JPL, nasa-jpl/osr-rover-code, Apache-2.0),
 * built from its own robot description by scripts/robots/build.ts, drawn four
 * times life size and driven by the field's rover: its rockers and bogies
 * turned as the suspension solver settles them, its corner wheels steered and
 * every wheel rolled at its own rate, on its real joints. Fourteen joints, fifteen
 * parts, one skinned mesh (one draw call): each part bound to one bone, posed
 * from the robot's own forward kinematics. Until it has loaded (or if it can't)
 * the field draws its procedural stand-in, which has the same geometry: the
 * solver's measures are this description's.
 */

/** Its description's colours, in the field's palette: the body's brown as cream, the silver and black as they are. */
const PALETTE: Record<number, number> = { 0x8b4513: 0xece4d2, 0xbfbfbf: 0xb9bec6, 0x1a1a1a: 0x34373d };

/** The URDF's frame (x forward, y left, z up) in the rover model's (forward +z, left +x, up +y). */
const URDF_TO_MODEL = new Matrix4().set(0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1);

const m = new Matrix4();
const link = new Matrix4();
const body = new Matrix4();
const q = new Quaternion();
const qa = new Quaternion();
const v = new Vector3();
const s = new Vector3();
const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);

export class RealRover {
  readonly mesh: SkinnedMesh;
  private readonly sk: Skeleton;
  private readonly bones: Bone[] = [];
  private readonly linkOf: number[] = [];
  /** From the body's frame (the solver's, at the rockers' axle height) to the description's root (base_footprint). */
  private readonly toRoot = new Matrix4();
  private readonly joints: { rocker: [number, number]; bogie: [number, number]; steer: [number, number, number, number]; wheels: number[] };

  constructor(manifest: RobotManifest, meshes: readonly LinkMesh[], material: Material, shadows: boolean) {
    this.sk = new Skeleton(treeOf(manifest));
    const palette = manifest.materials.map((c) => PALETTE[c] ?? c);
    // Every drawn part's triangles, bound to its own bone (bind pose: each part in its own frame, its bone at the origin).
    const positions: number[] = [];
    const colors: number[] = [];
    const normals: number[] = [];
    const index: number[] = [];
    let b = 0;
    for (const mesh of meshes) {
      this.bones.push(new Bone());
      this.linkOf.push(this.sk.linkIndex(mesh.link));
      const g = linkGeometry(mesh, palette);
      const p = g.getAttribute("position");
      const c = g.getAttribute("color");
      const n = g.getAttribute("normal");
      for (let i = 0; i < p.count; i++) {
        positions.push(p.getX(i), p.getY(i), p.getZ(i));
        colors.push(c.getX(i), c.getY(i), c.getZ(i));
        normals.push(n.getX(i), n.getY(i), n.getZ(i));
        index.push(b);
      }
      g.dispose();
      b++;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute("color", new BufferAttribute(new Float32Array(colors), 3));
    geometry.setAttribute("normal", new BufferAttribute(new Float32Array(normals), 3));
    // Nothing of it glows (the field's machine material reads a glow mask).
    geometry.setAttribute("glow", new BufferAttribute(new Float32Array(positions.length / 3), 1));
    const skinIndex = new Uint16Array(index.length * 4);
    const skinWeight = new Float32Array(index.length * 4);
    for (let i = 0; i < index.length; i++) {
      skinIndex[i * 4] = index[i]!;
      skinWeight[i * 4] = 1;
    }
    geometry.setAttribute("skinIndex", new Uint16BufferAttribute(skinIndex, 4));
    geometry.setAttribute("skinWeight", new BufferAttribute(skinWeight, 4));
    geometry.computeBoundingSphere();
    this.mesh = new SkinnedMesh(geometry, material);
    for (const bone of this.bones) this.mesh.add(bone);
    this.mesh.updateMatrixWorld(true);
    this.mesh.bind(new Bones(this.bones));
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = shadows;
    this.mesh.receiveShadow = shadows;
    // The body's frame is the description's base_link: the root (base_footprint) lies below it.
    const base = manifest.sites.find((x) => x.name === "base_link");
    this.toRoot.makeTranslation(0, 0, -(base?.xyz[2] ?? 0));
    const j = (name: string) => this.sk.jointIndex(name);
    this.joints = {
      rocker: [j("rocker_bogie_joint_L_1"), j("rocker_bogie_joint_R_1")],
      bogie: [j("rocker_bogie_joint_L_2"), j("rocker_bogie_joint_R_2")],
      steer: [j("front_wheel_joint_L"), j("rear_wheel_joint_L"), j("front_wheel_joint_R"), j("rear_wheel_joint_R")],
      wheels: ["front_wheel_joint_left", "middle_wheel_joint_left", "rear_wheel_joint_left", "front_wheel_joint_right", "middle_wheel_joint_right", "rear_wheel_joint_right"].map(j),
    };
  }

  /** Poses it as the field's rover stands (scene space of the place's group). */
  pose(r: RoverState): void {
    const p = r.pose;
    const sk = this.sk;
    // A turn about the description's y (left) axis by θ tips its nose down: nose-up angles go in negated.
    for (let i = 0; i < 2; i++) {
      sk.set(this.joints.rocker[i]!, -(p.rocker[i]! - p.pitch));
      sk.set(this.joints.bogie[i]!, -(p.bogie[i]! - p.rocker[i]!));
    }
    for (let c = 0; c < 4; c++) sk.set(this.joints.steer[c]!, r.steer[c]!);
    for (let w = 0; w < 6; w++) sk.set(this.joints.wheels[w]!, r.spin[w]!);
    sk.fk();
    // The body: where the solver put it, turned by heading, pitch and roll, scaled up, the description's frame in the model's.
    q.setFromAxisAngle(Y, headingToSceneYaw(p.heading));
    q.multiply(qa.setFromAxisAngle(X, -p.pitch));
    q.multiply(qa.setFromAxisAngle(Z, p.roll));
    body.compose(v.set(p.x, p.z + TRACK_TOP, -p.y), q, s.setScalar(OSR_SCALE)).multiply(URDF_TO_MODEL).multiply(this.toRoot);
    for (let i = 0; i < this.bones.length; i++) {
      const w = sk.world;
      const o = this.linkOf[i]! * 16;
      const e = link.elements;
      for (let k = 0; k < 16; k++) e[k] = w[o + k]!;
      m.multiplyMatrices(body, link);
      const bone = this.bones[i]!;
      m.decompose(bone.position, bone.quaternion, bone.scale);
    }
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
  }
}

/** Fetches the rover's manifest and geometry from the node (versioned URLs, cached for good) and builds it. Rejects if anything's wrong. */
export async function loadRealRover(material: Material, shadows: boolean, get: typeof fetch = fetch): Promise<RealRover> {
  const entry = ROBOT_MANIFESTS["open-source-rover"];
  if (!entry) throw new Error("no rover asset");
  const response = await get(`${ROBOT_ASSET_PATH}${entry}`);
  if (!response.ok) throw new Error(`rover: HTTP ${response.status}`);
  const manifest = parseManifest(await response.json());
  const bin = await get(`${ROBOT_ASSET_PATH}${manifest.bin.file}`);
  if (!bin.ok) throw new Error(`rover: HTTP ${bin.status}`);
  return new RealRover(manifest, decodeMeshes(manifest, await bin.arrayBuffer()), material, shadows);
}
