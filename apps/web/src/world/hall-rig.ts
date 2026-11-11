import { Bone, type BufferGeometry, type Material, Skeleton, SkinnedMesh } from "three/webgpu";
import type { Frame } from "./hall-arm.ts";

/*
 * Everything that moves in the workshop hall is one skinned mesh: each moving
 * part is bound wholly to a bone (rigid skinning), the bones sit flat under the
 * mesh, and posing a part is writing its bone's matrix (from world-axes
 * numbers: x east, y north, z up). One draw call, a few kilobytes of bone
 * matrices a frame, nothing allocated. Bone 0 stays put (the residents' fixed
 * parts, which dissolve with them, are bound to it).
 */

/** The colours the hall's machines are made of (sRGB). */
export const K = {
  cream: 0xf1ece0,
  white: 0xf7f5f0,
  orange: 0xe8853a,
  steel: 0x5d6878,
  dark: 0x3e444e,
  charcoal: 0x2f333a,
  yellow: 0xf2c14e,
  blue: 0x7fb2e5,
  mint: 0x9fd8c0,
  lavender: 0xc9c2ec,
  alu: 0xc9ced4,
  rubber: 0x34373d,
  copper: 0xc98b5a,
  red: 0xe35d4f,
  green: 0x5cbf6e,
  wood: 0xc8915e,
  pei: 0xcaa25e,
  cardboard: 0xc9a77c,
  screen: 0x1c2733,
};

/**
 * Lamp slots (HallUniforms.lampColors): status lights, screens' glow and beacons, by what they belong to.
 * 0 is dark; the building's own are 1 (the high-bay lamps) and 2 (the sign).
 */
export const SLOT = {
  printer: 3, // … one per printer, up to 7
  gantry: 10,
  inspect: 11,
  cart: 12,
  crane: 13,
  cnc: 14,
  tunnel: 15,
  green: 16, // … one per cell (beacons' green)
  amber: 20,
  red: 24,
  curtain: 28,
  dock: 32,
  bench: 34,
  feeder: 35,
  door: 36,
  vacuum: 37,
  work: 38,
};

/** Progress bars (HallUniforms.bars): one per printer, the large printer's, the endurance test's counter, the mill's. */
export const BAR = { printer: 0, gantry: 7, endurance: 8, cnc: 9 };
/** Belts (HallUniforms.belts): the collector belt, the conveyor, the treadmill, the dispatch rollers. */
export const BELT = { collector: 0, conveyor: 1, treadmill: 2, rollers: 3 };

const PI_ = [0, 2, 1];
const SG = [1, 1, -1];

export class Bones {
  readonly bones: Bone[] = [];

  constructor() {
    this.add();
  }

  /** A new bone (at rest: the identity); its index. */
  add(): number {
    const b = new Bone();
    b.matrixAutoUpdate = false;
    this.bones.push(b);
    return this.bones.length - 1;
  }

  /**
   * Places bone `i`: its local axes are the columns of `r` (a world-axes rotation, row-major 3×3 at
   * `r[o]`, or a 3×4 Frame), scaled by (sx, sy, sz), and its origin at (x, y, z) in the world.
   */
  set(i: number, r: ArrayLike<number>, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, stride = 3): void {
    const b = this.bones[i]!;
    const e = b.matrix.elements;
    const scale = [sx, sy, sz];
    for (let j = 0; j < 3; j++) {
      for (let k = 0; k < 3; k++) e[j * 4 + k] = SG[k]! * SG[j]! * r[PI_[k]! * stride + PI_[j]!]! * scale[PI_[j]!]!;
    }
    e[3] = 0;
    e[7] = 0;
    e[11] = 0;
    e[12] = x;
    e[13] = z;
    e[14] = -y;
    e[15] = 1;
    b.matrixWorldNeedsUpdate = true;
  }

  /** Places bone `i` at a Frame (world axes, translation in its 4th column) offset by (ox, oy, oz). */
  frame(i: number, f: Frame, ox: number, oy: number, oz: number, sx = 1, sy = 1, sz = 1): void {
    this.set(i, f, f[3]! + ox, f[7]! + oy, f[11]! + oz, sx, sy, sz, 4);
  }

  private readonly r = new Float64Array(9);

  /** Places bone `i` at (x, y, z), turned by `yaw` about the vertical, then tilted by `tilt` about its own x and `roll` about its own y; scaled along its z by `sz`. */
  put(i: number, x: number, y: number, z: number, yaw = 0, tilt = 0, roll = 0, sz = 1): void {
    const r = this.r;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const cx = Math.cos(tilt);
    const sx = Math.sin(tilt);
    const cr = Math.cos(roll);
    const sr = Math.sin(roll);
    // Rz(yaw) · Rx(tilt) · Ry(roll)
    const a00 = cy;
    const a01 = -sy * cx;
    const a02 = sy * sx;
    const a10 = sy;
    const a11 = cy * cx;
    const a12 = -cy * sx;
    const a20 = 0;
    const a21 = sx;
    const a22 = cx;
    r[0] = a00 * cr - a02 * sr;
    r[1] = a01;
    r[2] = a00 * sr + a02 * cr;
    r[3] = a10 * cr - a12 * sr;
    r[4] = a11;
    r[5] = a10 * sr + a12 * cr;
    r[6] = a20 * cr - a22 * sr;
    r[7] = a21;
    r[8] = a20 * sr + a22 * cr;
    this.set(i, r, x, y, z, 1, 1, sz);
  }

  /** Places bone `i` at (ax, ay, az) with its z axis along the line to (bx, by, bz), scaled to its length (a cable, a strut drawn a unit long). */
  span(i: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number): void {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    const r = this.r;
    if (len < 1e-6) {
      r.fill(0);
      r[0] = 1;
      r[4] = 1;
      r[8] = 1;
      this.set(i, r, ax, ay, az, 1, 1, 0);
      return;
    }
    const zx = dx / len;
    const zy = dy / len;
    const zz = dz / len;
    // Any x axis square to it.
    let xx = zy * 1 - zz * 0;
    let xy = zz * 0 - zx * 1;
    let xz = 0;
    if (Math.hypot(xx, xy) < 1e-4) {
      xx = 1;
      xy = 0;
      xz = 0;
    }
    const xl = Math.hypot(xx, xy, xz);
    xx /= xl;
    xy /= xl;
    xz /= xl;
    const yx = zy * xz - zz * xy;
    const yy = zz * xx - zx * xz;
    const yz = zx * xy - zy * xx;
    r[0] = xx;
    r[1] = yx;
    r[2] = zx;
    r[3] = xy;
    r[4] = yy;
    r[5] = zy;
    r[6] = xz;
    r[7] = yz;
    r[8] = zz;
    this.set(i, r, ax, ay, az, 1, 1, len);
  }

  /** The skinned mesh for geometry built bone by bone (Kit.bone), with the bones under it. */
  mesh(geometry: BufferGeometry, material: Material): SkinnedMesh {
    const mesh = new SkinnedMesh(geometry, material);
    for (const b of this.bones) mesh.add(b);
    mesh.updateMatrixWorld(true);
    mesh.bind(new Skeleton(this.bones));
    mesh.frustumCulled = false;
    return mesh;
  }
}
