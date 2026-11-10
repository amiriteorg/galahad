import { BufferAttribute, BufferGeometry, Color, Euler, Matrix4, Quaternion, Uint16BufferAttribute, Vector3 } from "three/webgpu";

/*
 * Merged, flat-shaded, vertex-coloured geometry: many primitives become one draw
 * call. Every triangle gets its own normal (the low-poly look) and a colour, with
 * a little per-face variation so flat walls don't look like plastic. Colours are
 * given in sRGB and converted to the renderer's working space (linear). A cheap
 * ambient occlusion can be baked into the vertex colours at build time: darker
 * near the ground and on faces that look down (under eaves, under a canopy).
 * Parts can be bound to a bone (rigid skinning: one draw call for a whole
 * character) and marked as glowing (an emissive mask per vertex).
 */

const tmp = new Color();
const a = new Vector3();
const b = new Vector3();
const c = new Vector3();

/** sRGB hex → linear r, g, b. */
export function linear(hex: number): [number, number, number] {
  tmp.setHex(hex);
  return [tmp.r, tmp.g, tmp.b];
}

/** Ambient occlusion for a vertex at (x, y, z) with normal (nx, ny, nz): a factor in (0, 1]. */
export type AmbientOcclusion = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => number;

const smoothstep = (lo: number, hi: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

/**
 * The usual occlusion: `base` at the ground (y = `ground`) brightening to none by
 * `height` above it, and faces that look down a little darker (by `under`).
 */
export function groundAO(base = 0.6, height = 1.3, under = 0.72, ground = 0): AmbientOcclusion {
  return (_x, y, _z, _nx, ny) => (base + (1 - base) * smoothstep(ground, ground + height, y)) * (1 - (1 - under) * smoothstep(0.05, -0.75, ny));
}

export interface BuildOptions {
  ao?: AmbientOcclusion;
  /** "up": every normal points up (grass and flowers shade like the ground they stand on). */
  normals?: "flat" | "up";
}

export class Mesher {
  private readonly pos: number[] = [];
  private readonly col: number[] = [];
  private readonly bones: number[] = [];
  private readonly glows: number[] = [];
  private faces = 0;
  private currentBone = 0;
  private currentGlow = 0;
  private skinned = false;
  private glowing = false;

  /** Binds what's added next to bone `i` (rigid skinning). */
  bone(i: number): this {
    this.currentBone = i;
    this.skinned = true;
    return this;
  }

  /** Marks what's added next as glowing (0..1, the emissive mask). */
  glow(v: number): this {
    this.currentGlow = v;
    if (v > 0) this.glowing = true;
    return this;
  }

  /** Adds a primitive, transformed by `m`, painted `color` (sRGB) with `vary` (0..1) per-face brightness variation. */
  add(geometry: BufferGeometry, color: number, m?: Matrix4, vary = 0.06): this {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    if (m) g.applyMatrix4(m);
    const p = g.getAttribute("position");
    const [r, gr, bl] = linear(color);
    for (let i = 0; i + 2 < p.count; i += 3) {
      const k = vary ? 1 - vary + 2 * vary * fract(Math.sin(++this.faces * 12.9898) * 43758.5453) : 1;
      for (let v = 0; v < 3; v++) {
        this.pos.push(p.getX(i + v), p.getY(i + v), p.getZ(i + v));
        this.col.push(r * k, gr * k, bl * k);
        this.bones.push(this.currentBone);
        this.glows.push(this.currentGlow);
      }
    }
    g.dispose();
    geometry.dispose();
    return this;
  }

  /** Adds raw triangles (scene coordinates, three vertices each). */
  triangles(points: number[], color: number): this {
    const [r, g, bl] = linear(color);
    for (let i = 0; i < points.length; i++) this.pos.push(points[i]!);
    for (let i = 0; i < points.length / 3; i++) {
      this.col.push(r, g, bl);
      this.bones.push(this.currentBone);
      this.glows.push(this.currentGlow);
    }
    return this;
  }

  get empty(): boolean {
    return this.pos.length === 0;
  }

  build(options: BuildOptions = {}): BufferGeometry {
    const geometry = new BufferGeometry();
    const positions = new Float32Array(this.pos);
    const normals = options.normals === "up" ? upNormals(positions.length) : flatNormals(positions);
    const colors = new Float32Array(this.col);
    const ao = options.ao;
    if (ao) {
      for (let i = 0; i < positions.length; i += 3) {
        const f = ao(positions[i]!, positions[i + 1]!, positions[i + 2]!, normals[i]!, normals[i + 1]!, normals[i + 2]!);
        colors[i] = colors[i]! * f;
        colors[i + 1] = colors[i + 1]! * f;
        colors[i + 2] = colors[i + 2]! * f;
      }
    }
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setAttribute("color", new BufferAttribute(colors, 3));
    geometry.setAttribute("normal", new BufferAttribute(normals, 3));
    if (this.skinned) {
      const index = new Uint16Array(this.bones.length * 4);
      const weight = new Float32Array(this.bones.length * 4);
      for (let i = 0; i < this.bones.length; i++) {
        index[i * 4] = this.bones[i]!;
        weight[i * 4] = 1;
      }
      geometry.setAttribute("skinIndex", new Uint16BufferAttribute(index, 4));
      geometry.setAttribute("skinWeight", new BufferAttribute(weight, 4));
    }
    if (this.glowing) geometry.setAttribute("glow", new BufferAttribute(new Float32Array(this.glows), 1));
    geometry.computeBoundingSphere();
    return geometry;
  }
}

const fract = (x: number): number => x - Math.floor(x);

/** One normal per triangle, for non-indexed positions. */
export function flatNormals(positions: Float32Array): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 9) {
    a.fromArray(positions, i);
    b.fromArray(positions, i + 3);
    c.fromArray(positions, i + 6);
    c.sub(b);
    b.sub(a);
    c.cross(b).negate().normalize();
    for (let v = 0; v < 3; v++) c.toArray(normals, i + v * 3);
  }
  return normals;
}

function upNormals(length: number): Float32Array {
  const normals = new Float32Array(length);
  for (let i = 1; i < length; i += 3) normals[i] = 1;
  return normals;
}

const q = new Quaternion();
const e = new Euler();
const s = new Vector3();
const t = new Vector3();

/** A transform: translate (x, y, z), turn (rx, ry, rz radians, XYZ), scale. Scene coordinates (y up). */
export function at(x: number, y: number, z: number, ry = 0, scale: number | [number, number, number] = 1, rx = 0, rz = 0): Matrix4 {
  t.set(x, y, z);
  q.setFromEuler(e.set(rx, ry, rz));
  if (typeof scale === "number") s.setScalar(scale);
  else s.set(scale[0], scale[1], scale[2]);
  return new Matrix4().compose(t, q, s);
}

/** `parent · child`, without touching either. */
export const within = (parent: Matrix4, child: Matrix4): Matrix4 => parent.clone().multiply(child);

/** A transform that lays a primitive's local +y axis from (ax, ay, az) to (bx, by, bz): for struts, cables, branches. */
export function between(ax: number, ay: number, az: number, bx: number, by: number, bz: number, scaleXZ = 1): Matrix4 {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len = Math.hypot(dx, dy, dz) || 1e-6;
  t.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
  a.set(0, 1, 0);
  b.set(dx / len, dy / len, dz / len);
  q.setFromUnitVectors(a, b);
  s.set(scaleXZ, len, scaleXZ);
  return new Matrix4().compose(t, q, s);
}

/**
 * A faceted boulder: an icosahedron whose vertices are pushed in and out
 * (deterministically, by `seed`), so every rock is its own shape.
 */
export function lumpy(geometry: BufferGeometry, seed: number, amount = 0.18): BufferGeometry {
  const p = geometry.getAttribute("position");
  const keyed = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    // Shared corners move together, so the surface stays closed.
    const key = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
    let k = keyed.get(key);
    if (k === undefined) {
      k = 1 - amount + 2 * amount * fract(Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed * 4.1) * 43758.5453);
      keyed.set(key, k);
    }
    p.setXYZ(i, x * k, y * k, z * k);
  }
  return geometry;
}
