import { BufferAttribute, BufferGeometry, Color, Euler, Matrix4, Quaternion, Vector3 } from "three/webgpu";

/*
 * Merged, flat-shaded, vertex-coloured geometry: many primitives become one draw
 * call. Every triangle gets its own normal (the low-poly look) and a colour, with
 * a little per-face variation so flat walls don't look like plastic. Colours are
 * given in sRGB and converted to the renderer's working space.
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

export class Mesher {
  private readonly pos: number[] = [];
  private readonly col: number[] = [];
  private faces = 0;

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
    for (let i = 0; i < points.length / 3; i++) this.col.push(r, g, bl);
    return this;
  }

  get empty(): boolean {
    return this.pos.length === 0;
  }

  build(): BufferGeometry {
    const geometry = new BufferGeometry();
    const positions = new Float32Array(this.pos);
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setAttribute("color", new BufferAttribute(new Float32Array(this.col), 3));
    geometry.setAttribute("normal", new BufferAttribute(flatNormals(positions), 3));
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
