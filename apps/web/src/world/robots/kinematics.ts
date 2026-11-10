/*
 * Kinematics for the world's robots, as pure math (no three.js, so it's unit-tested
 * and shared with the asset build): rigid transforms as 4×4 column-major
 * Float64Arrays (three.js's layout, so a pose copies straight into an instance
 * matrix), and a `Skeleton`: a robot's kinematic tree (links joined by revolute,
 * continuous, prismatic or fixed joints, as in URDF) with joint values that keep
 * to their limits and forward kinematics into every link's frame. Nothing here
 * allocates per frame.
 *
 * Frames follow URDF: a joint's frame is its parent link's frame times the joint's
 * origin; the child link's frame is the joint's frame turned by the joint's value
 * about its axis (or moved along it).
 */

export type Vec3 = [number, number, number];
export type Mat4 = Float64Array;

export const mat4 = (): Mat4 => identity(new Float64Array(16));

export function identity(out: Mat4): Mat4 {
  out.fill(0);
  out[0] = out[5] = out[10] = out[15] = 1;
  return out;
}

/** A URDF origin: translate `xyz`, turn by `rpy` (roll about x, then pitch about y, then yaw about z, fixed axes: R = Rz·Ry·Rx). */
export function fromXyzRpy(xyz: readonly number[], rpy: readonly number[], out: Mat4 = mat4()): Mat4 {
  const [r, p, y] = [rpy[0] ?? 0, rpy[1] ?? 0, rpy[2] ?? 0];
  const cr = Math.cos(r);
  const sr = Math.sin(r);
  const cp = Math.cos(p);
  const sp = Math.sin(p);
  const cy = Math.cos(y);
  const sy = Math.sin(y);
  // Column-major: out[col * 4 + row].
  out[0] = cy * cp;
  out[1] = sy * cp;
  out[2] = -sp;
  out[3] = 0;
  out[4] = cy * sp * sr - sy * cr;
  out[5] = sy * sp * sr + cy * cr;
  out[6] = cp * sr;
  out[7] = 0;
  out[8] = cy * sp * cr + sy * sr;
  out[9] = sy * sp * cr - cy * sr;
  out[10] = cp * cr;
  out[11] = 0;
  out[12] = xyz[0] ?? 0;
  out[13] = xyz[1] ?? 0;
  out[14] = xyz[2] ?? 0;
  out[15] = 1;
  return out;
}

/** The URDF roll, pitch and yaw of a transform's rotation (the inverse of `fromXyzRpy`). */
export function rpyOf(m: Mat4): Vec3 {
  const sp = -m[2]!;
  if (Math.abs(sp) > 1 - 1e-9) {
    // Pitched straight up or down: roll and yaw turn about the same axis; put it all in yaw.
    const pitch = sp > 0 ? Math.PI / 2 : -Math.PI / 2;
    return [0, pitch, Math.atan2(-m[4]!, m[5]!)];
  }
  return [Math.atan2(m[6]!, m[10]!), Math.asin(sp), Math.atan2(m[1]!, m[0]!)];
}

/** A turn of `angle` radians about the unit `axis` (Rodrigues), no translation. */
export function rotation(ax: number, ay: number, az: number, angle: number, out: Mat4 = mat4()): Mat4 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  out[0] = t * ax * ax + c;
  out[1] = t * ax * ay + s * az;
  out[2] = t * ax * az - s * ay;
  out[3] = 0;
  out[4] = t * ax * ay - s * az;
  out[5] = t * ay * ay + c;
  out[6] = t * ay * az + s * ax;
  out[7] = 0;
  out[8] = t * ax * az + s * ay;
  out[9] = t * ay * az - s * ax;
  out[10] = t * az * az + c;
  out[11] = 0;
  out[12] = out[13] = out[14] = 0;
  out[15] = 1;
  return out;
}

/** `out = a · b` for affine transforms (out may be a or b). `ao`, `bo`: offsets into packed arrays. */
export function multiply(a: Float64Array, b: Float64Array, out: Float64Array, ao = 0, bo = 0, oo = 0): Float64Array {
  const a0 = a[ao]!, a1 = a[ao + 1]!, a2 = a[ao + 2]!;
  const a4 = a[ao + 4]!, a5 = a[ao + 5]!, a6 = a[ao + 6]!;
  const a8 = a[ao + 8]!, a9 = a[ao + 9]!, a10 = a[ao + 10]!;
  const a12 = a[ao + 12]!, a13 = a[ao + 13]!, a14 = a[ao + 14]!;
  for (let col = 0; col < 4; col++) {
    const b0 = b[bo + col * 4]!;
    const b1 = b[bo + col * 4 + 1]!;
    const b2 = b[bo + col * 4 + 2]!;
    const b3 = col === 3 ? 1 : 0;
    out[oo + col * 4] = a0 * b0 + a4 * b1 + a8 * b2 + a12 * b3;
    out[oo + col * 4 + 1] = a1 * b0 + a5 * b1 + a9 * b2 + a13 * b3;
    out[oo + col * 4 + 2] = a2 * b0 + a6 * b1 + a10 * b2 + a14 * b3;
    out[oo + col * 4 + 3] = b3;
  }
  return out;
}

/** The inverse of a rigid transform (rotation + translation). */
export function invertRigid(m: Mat4, out: Mat4 = mat4()): Mat4 {
  const r00 = m[0]!, r10 = m[1]!, r20 = m[2]!;
  const r01 = m[4]!, r11 = m[5]!, r21 = m[6]!;
  const r02 = m[8]!, r12 = m[9]!, r22 = m[10]!;
  const tx = m[12]!, ty = m[13]!, tz = m[14]!;
  out[0] = r00;
  out[1] = r01;
  out[2] = r02;
  out[3] = 0;
  out[4] = r10;
  out[5] = r11;
  out[6] = r12;
  out[7] = 0;
  out[8] = r20;
  out[9] = r21;
  out[10] = r22;
  out[11] = 0;
  out[12] = -(r00 * tx + r10 * ty + r20 * tz);
  out[13] = -(r01 * tx + r11 * ty + r21 * tz);
  out[14] = -(r02 * tx + r12 * ty + r22 * tz);
  out[15] = 1;
  return out;
}

/** A point through a transform (packed at offset `o`). */
export function transformPoint(m: Float64Array, x: number, y: number, z: number, out: Vec3, o = 0): Vec3 {
  out[0] = m[o]! * x + m[o + 4]! * y + m[o + 8]! * z + m[o + 12]!;
  out[1] = m[o + 1]! * x + m[o + 5]! * y + m[o + 9]! * z + m[o + 13]!;
  out[2] = m[o + 2]! * x + m[o + 6]! * y + m[o + 10]! * z + m[o + 14]!;
  return out;
}

/** A direction through a transform's rotation (packed at offset `o`). */
export function transformDir(m: Float64Array, x: number, y: number, z: number, out: Vec3, o = 0): Vec3 {
  out[0] = m[o]! * x + m[o + 4]! * y + m[o + 8]! * z;
  out[1] = m[o + 1]! * x + m[o + 5]! * y + m[o + 9]! * z;
  out[2] = m[o + 2]! * x + m[o + 6]! * y + m[o + 10]! * z;
  return out;
}

export type JointType = "revolute" | "continuous" | "prismatic" | "fixed";

/** A joint as the manifest (and URDF) gives it. */
export interface JointSpec {
  name: string;
  type: JointType;
  parent: string;
  child: string;
  /** The joint's frame in its parent link's frame. */
  xyz: Vec3;
  rpy: Vec3;
  /** In the joint's frame. */
  axis: Vec3;
  /** Limits (radians or metres); ignored for continuous and fixed joints. */
  lower: number;
  upper: number;
}

export interface KinematicTree {
  /** Link names; the root is the one link that is no joint's child. */
  links: readonly string[];
  joints: readonly JointSpec[];
}

interface JointNode {
  name: string;
  type: JointType;
  /** Unit axis in the joint's frame. */
  axis: Vec3;
  origin: Mat4;
  lower: number;
  upper: number;
  parent: number;
  child: number;
}

const scratch = mat4();
const motion = mat4();

/**
 * A robot's kinematic tree. Links are kept in depth-first order (every parent
 * before its children, and each subtree contiguous), so forward kinematics is
 * one pass and a subtree can be updated alone.
 */
export class Skeleton {
  /** Link names, depth-first. */
  readonly links: string[] = [];
  /** Each link's parent (−1 for the root) and the joint that joins them (−1 for the root). */
  readonly parent: Int32Array;
  readonly joint: Int32Array;
  /** One past the last link of each link's subtree. */
  readonly subtreeEnd: Int32Array;
  readonly joints: JointNode[] = [];
  /** Joint values, by joint index. */
  readonly q: Float64Array;
  /** Every link's frame in the world, 16 floats each (column-major), after `fk()`. */
  readonly world: Float64Array;
  /** Where the root link is in the world. */
  readonly base: Mat4 = mat4();
  private readonly byName = new Map<string, number>();
  private readonly linkByName = new Map<string, number>();

  constructor(tree: KinematicTree) {
    const names = new Set(tree.links);
    if (names.size !== tree.links.length) throw new Error("duplicate link names");
    const children = new Map<string, JointSpec[]>();
    const isChild = new Set<string>();
    for (const j of tree.joints) {
      if (!names.has(j.parent)) throw new Error(`joint ${j.name}: no parent link ${j.parent}`);
      if (!names.has(j.child)) throw new Error(`joint ${j.name}: no child link ${j.child}`);
      if (isChild.has(j.child)) throw new Error(`link ${j.child} has two parents`);
      isChild.add(j.child);
      const list = children.get(j.parent) ?? [];
      list.push(j);
      children.set(j.parent, list);
    }
    const roots = tree.links.filter((l) => !isChild.has(l));
    if (roots.length !== 1) throw new Error(`a robot needs exactly one root link (found ${roots.length})`);
    const parents: number[] = [];
    const jointOf: number[] = [];
    const ends: number[] = [];
    const visit = (link: string, parent: number, via: JointSpec | null): void => {
      const index = this.links.length;
      this.links.push(link);
      this.linkByName.set(link, index);
      parents.push(parent);
      ends.push(0);
      if (via) {
        const [ax, ay, az] = via.axis;
        const n = Math.hypot(ax, ay, az);
        this.byName.set(via.name, this.joints.length);
        jointOf.push(this.joints.length);
        this.joints.push({
          name: via.name,
          type: via.type,
          axis: n > 1e-12 ? [ax / n, ay / n, az / n] : [0, 0, 1],
          origin: fromXyzRpy(via.xyz, via.rpy),
          lower: via.lower,
          upper: via.upper,
          parent,
          child: index,
        });
      } else jointOf.push(-1);
      for (const j of children.get(link) ?? []) visit(j.child, index, j);
      ends[index] = this.links.length;
    };
    visit(roots[0]!, -1, null);
    if (this.links.length !== tree.links.length) throw new Error("some links aren't connected to the root");
    this.parent = Int32Array.from(parents);
    this.joint = Int32Array.from(jointOf);
    this.subtreeEnd = Int32Array.from(ends);
    this.q = new Float64Array(this.joints.length);
    this.world = new Float64Array(this.links.length * 16);
    this.fk();
  }

  /** A joint's index by name (throws if there's none: a manifest that doesn't fit its code is a bug). */
  jointIndex(name: string): number {
    const i = this.byName.get(name);
    if (i === undefined) throw new Error(`no joint ${name}`);
    return i;
  }

  linkIndex(name: string): number {
    const i = this.linkByName.get(name);
    if (i === undefined) throw new Error(`no link ${name}`);
    return i;
  }

  /** Sets a joint's value, kept within its limits; returns the value it took. */
  set(j: number, value: number): number {
    const node = this.joints[j]!;
    let v = value;
    if (node.type === "fixed") v = 0;
    else if (node.type !== "continuous") v = Math.min(node.upper, Math.max(node.lower, v));
    this.q[j] = v;
    return v;
  }

  /** Recomputes one link's frame from its parent's (which must be current). */
  updateLink(i: number): void {
    const j = this.joint[i]!;
    if (j < 0) {
      this.world.set(this.base, i * 16);
      return;
    }
    const node = this.joints[j]!;
    multiply(this.world, node.origin, scratch, this.parent[i]! * 16, 0, 0);
    const v = this.q[j]!;
    if (node.type === "revolute" || node.type === "continuous") {
      rotation(node.axis[0], node.axis[1], node.axis[2], v, motion);
      multiply(scratch, motion, this.world, 0, 0, i * 16);
    } else if (node.type === "prismatic") {
      identity(motion);
      motion[12] = node.axis[0] * v;
      motion[13] = node.axis[1] * v;
      motion[14] = node.axis[2] * v;
      multiply(scratch, motion, this.world, 0, 0, i * 16);
    } else this.world.set(scratch, i * 16);
  }

  /** Forward kinematics for every link. */
  fk(): void {
    for (let i = 0; i < this.links.length; i++) this.updateLink(i);
  }

  /** Forward kinematics for one link and everything below it. */
  updateSubtree(i: number): void {
    const end = this.subtreeEnd[i]!;
    for (let k = i; k < end; k++) this.updateLink(k);
  }

  /** A point given in a link's frame, in the world. */
  point(link: number, local: readonly number[], out: Vec3): Vec3 {
    return transformPoint(this.world, local[0]!, local[1]!, local[2]!, out, link * 16);
  }

  /** A joint's pivot and unit axis in the world (its parent link must be current). */
  jointFrame(j: number, pivot: Vec3, axis: Vec3): void {
    const node = this.joints[j]!;
    multiply(this.world, node.origin, scratch, node.parent * 16, 0, 0);
    pivot[0] = scratch[12]!;
    pivot[1] = scratch[13]!;
    pivot[2] = scratch[14]!;
    transformDir(scratch, node.axis[0], node.axis[1], node.axis[2], axis);
  }
}
