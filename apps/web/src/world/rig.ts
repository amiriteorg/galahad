import { Bone, type BufferGeometry, Matrix4, Quaternion, Skeleton, SkinnedMesh, Vector3, type Material } from "three/webgpu";
import { solveTwoBone } from "./ik.ts";

/*
 * A rigid-skinned character: every part bound wholly to one bone, all bones
 * flat under one root and posed directly in the character's own space (y up,
 * facing +z), so a whole body is one draw call and posing it is plain vector
 * maths. Helpers aim a bone along a direction, solve a two-bone limb, and set a
 * piston between two anchors. Scratch objects only: nothing is allocated per frame.
 */

const mx = new Matrix4();
const ax = new Vector3();
const ay = new Vector3();
const az = new Vector3();
const tmp = new Vector3();
const tq = new Quaternion();
const out6 = new Float64Array(6);

export class Rig {
  readonly bones: Bone[] = [];
  readonly root = new Bone();
  /** Each bone's bind position (character space). */
  private readonly bind: Vector3[] = [];

  /** Adds a bone at its bind position; returns its index. */
  add(x: number, y: number, z: number): number {
    const b = new Bone();
    b.position.set(x, y, z);
    this.root.add(b);
    this.bones.push(b);
    this.bind.push(new Vector3(x, y, z));
    return this.bones.length - 1;
  }

  bindPosition(i: number): Vector3 {
    return this.bind[i]!;
  }

  /** The skinned mesh for a geometry built in bind pose (parts bound with Mesher.bone). */
  mesh(geometry: BufferGeometry, material: Material): SkinnedMesh {
    const mesh = new SkinnedMesh(geometry, material);
    mesh.add(this.root);
    mesh.updateMatrixWorld(true);
    mesh.bind(new Skeleton(this.bones));
    mesh.frustumCulled = false;
    return mesh;
  }

  /** Back to the bind pose. */
  rest(): void {
    for (let i = 0; i < this.bones.length; i++) {
      this.bones[i]!.position.copy(this.bind[i]!);
      this.bones[i]!.quaternion.identity();
    }
  }

  /** Places bone i at p, turned by q (character space). */
  set(i: number, p: Vector3, q: Quaternion): void {
    this.bones[i]!.position.copy(p);
    this.bones[i]!.quaternion.copy(q);
  }
}

/**
 * The turn that points a bone's local axis (`sign` · y: −1 for limbs, which hang
 * along −y, +1 for things that stand up) along `dir`, with its local +z as close
 * as it can to `front`. Writes into `out`.
 */
export function aim(out: Quaternion, dir: Vector3, front: Vector3, sign: 1 | -1 = -1): Quaternion {
  ay.copy(dir).normalize().multiplyScalar(sign);
  az.copy(front).addScaledVector(ay, -front.dot(ay));
  if (az.lengthSq() < 1e-8) az.set(0, 0, 1).addScaledVector(ay, -ay.z);
  if (az.lengthSq() < 1e-8) az.set(1, 0, 0).addScaledVector(ay, -ay.x);
  az.normalize();
  ax.crossVectors(ay, az);
  mx.makeBasis(ax, ay, az);
  return out.setFromRotationMatrix(mx);
}

/** A point at `local` in a bone's frame placed at p, turned by q. */
export function pointIn(out: Vector3, p: Vector3, q: Quaternion, x: number, y: number, z: number): Vector3 {
  return out.set(x, y, z).applyQuaternion(q).add(p);
}

/**
 * A two-bone limb from `root` towards `target`, its middle joint bending towards
 * `pole`: writes the middle joint and the reached end, and the two bones' turns
 * (each hanging along −y, its +z towards `front`).
 */
export function limb(root: Vector3, target: Vector3, pole: Vector3, a: number, b: number, front: Vector3, mid: Vector3, end: Vector3, qUpper: Quaternion, qLower: Quaternion): void {
  solveTwoBone(root.x, root.y, root.z, target.x, target.y, target.z, pole.x, pole.y, pole.z, a, b, out6);
  mid.set(out6[0]!, out6[1]!, out6[2]!);
  end.set(out6[3]!, out6[4]!, out6[5]!);
  // The joint bends towards the pole: each bone's front faces away from the bend's inside.
  tmp.subVectors(mid, root);
  aim(qUpper, tmp, front);
  tmp.subVectors(end, mid);
  aim(qLower, tmp, front);
}

/**
 * A piston between two anchors: the housing at `a` aims (−y) at `b`, the rod at
 * `b` aims (+y) back at `a`; as the joint moves, the rod slides in its housing.
 */
export function piston(rig: Rig, housing: number, rod: number, a: Vector3, b: Vector3, front: Vector3): void {
  tmp.subVectors(b, a);
  aim(tq, tmp, front, -1);
  rig.set(housing, a, tq);
  aim(tq, tmp.negate(), front, 1);
  rig.set(rod, b, tq);
}
