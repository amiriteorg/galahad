import { BoxGeometry, BufferAttribute, BufferGeometry, CylinderGeometry, type Matrix4 } from "three/webgpu";
import { HALL, HALL_DOOR, HALL_INNER, inCollider, roofAt, type Solid } from "./hall-plan.ts";
import { at, between, bevelBox, flatNormals, linear, Mesher, type Paint } from "./mesher.ts";

/*
 * What the workshop hall is built with: a Mesher that takes world coordinates
 * (x east, y north, z up, as the plan is written) and a level of detail, and
 * tags every vertex with what the hall's materials need to know about it (the
 * part of the shell it belongs to, the printed part it is, the cell whose
 * resident it is); and the finishing of its merged geometry: which faces the
 * hall's own light reaches, and the soft shade where things stand on the floor.
 */

/** 0 the plainest shapes (low tier), 2 the finest (high). */
export type Detail = 0 | 1 | 2;

/** A place in the world as a scene transform; `heading` turns local +x that way (atan2 convention). */
export const W = (x: number, y: number, z = 0, heading = 0, scale: number | [number, number, number] = 1): Matrix4 => at(x, z, -y, heading, scale);

/** Per-vertex tags a kit can carry: the shell's part (`cut`), a printed part (`part`), a cell's resident (`fade`). */
export type Tag = "cut" | "part" | "fade";

export class Kit {
  readonly m = new Mesher();
  private readonly tags: Record<Tag, number[]> = { cut: [], part: [], fade: [] };
  private readonly current: Record<Tag, number> = { cut: 0, part: 0, fade: 0 };
  private count = 0;

  constructor(readonly detail: Detail) {}

  /** Tags what's added next. */
  tag(name: Tag, value: number): this {
    this.current[name] = value;
    return this;
  }

  /** Binds what's added next to bone `i` (a rig). */
  bone(i: number): this {
    this.m.bone(i);
    return this;
  }

  /** Marks what's added next as glowing with lamp slot `slot` (0: not). */
  glow(slot: number): this {
    this.m.glow(slot);
    return this;
  }

  private grow(n: number): void {
    for (const name of ["cut", "part", "fade"] as const) {
      const list = this.tags[name];
      const v = this.current[name];
      for (let i = 0; i < n; i++) list.push(v);
    }
    this.count += n;
  }

  /** How many sides a round thing gets: `n` at the finest, fewer below. */
  sides(n: number): number {
    return this.detail === 2 ? n : this.detail === 1 ? Math.max(6, Math.round(n * 0.67)) : Math.max(5, Math.round(n * 0.5));
  }

  /** Any geometry, placed by a scene matrix (see W). */
  add(geometry: BufferGeometry, color: number | Paint, m?: Matrix4, vary = 0.04): this {
    this.grow(geometry.index ? geometry.index.count : geometry.getAttribute("position").count);
    this.m.add(geometry, color, m, vary);
    return this;
  }

  /** A box centred on (x, y, z): `sx` east-west, `sy` north-south, `sz` high, turned by `heading`. */
  box(color: number | Paint, x: number, y: number, z: number, sx: number, sy: number, sz: number, heading = 0, vary = 0.04): this {
    return this.add(new BoxGeometry(sx, sz, sy), color, W(x, y, z, heading), vary);
  }

  /** The same with bevelled edges at the finest detail (a casing, a panel: its edges catch the light). */
  panel(color: number | Paint, x: number, y: number, z: number, sx: number, sy: number, sz: number, heading = 0, vary = 0.04, bevel = 0.03): this {
    if (this.detail < 2) return this.box(color, x, y, z, sx, sy, sz, heading, vary);
    return this.add(bevelBox(sx, sz, sy, Math.min(bevel, Math.min(sx, sy, sz) * 0.25)), color, W(x, y, z, heading), vary);
  }

  /** A box by its extents. */
  slab(color: number | Paint, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, vary = 0.04): this {
    return this.box(color, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), 0, vary);
  }

  /** An upright cylinder (or cone: `top` radius) standing on z0. */
  cyl(color: number | Paint, x: number, y: number, z0: number, r: number, h: number, sides = 12, top = r, vary = 0.04): this {
    return this.add(new CylinderGeometry(top, r, h, this.sides(sides)), color, W(x, y, z0 + h / 2), vary);
  }

  /** A round (or `sides`-sided) bar between two points. */
  rod(color: number | Paint, ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number, sides = 6, vary = 0.03): this {
    return this.add(new CylinderGeometry(r, r, 1, Math.max(4, this.sides(sides)), 1, this.detail === 0), color, between(ax, az, -ay, bx, bz, -by), vary);
  }

  /** Raw triangles (scene coordinates, nine numbers each). */
  triangles(points: number[], color: number): this {
    this.grow(points.length / 3);
    this.m.triangles(points, color);
    return this;
  }

  /** A flat polygon (a fan over world points, convex), level at height `z`, facing up. */
  polygon(color: number, points: readonly (readonly [number, number])[], z: number): this {
    const out: number[] = [];
    for (let i = 1; i + 1 < points.length; i++) {
      const [a, b, c] = [points[0]!, points[i]!, points[i + 1]!];
      out.push(a[0], z, -a[1], b[0], z, -b[1], c[0], z, -c[1]);
    }
    orient(out, 0, 1, 0);
    return this.triangles(out, color);
  }

  /** A wall-thick triangle in an upright plane (x, z) from north-south `y0` to `y1` (a gable's infill): three points (x, z). */
  wedge(color: number, a: readonly [number, number], b: readonly [number, number], c: readonly [number, number], y0: number, y1: number): this {
    const tri = [a, b, c];
    for (const [y, ny] of [
      [y0, y0 < y1 ? -1 : 1],
      [y1, y0 < y1 ? 1 : -1],
    ] as const) {
      const face = tri.flatMap(([x, z]) => [x, z, -y]);
      orient(face, 0, 0, -ny);
      this.triangles(face, color);
    }
    for (let i = 0; i < 3; i++) {
      const [p, q] = [tri[i]!, tri[(i + 1) % 3]!];
      const r = tri[(i + 2) % 3]!;
      // Outward: away from the third corner.
      let nx = q[1] - p[1];
      let nz = -(q[0] - p[0]);
      if (nx * (r[0] - p[0]) + nz * (r[1] - p[1]) > 0) {
        nx = -nx;
        nz = -nz;
      }
      const quad = [p[0], p[1], -y0, q[0], q[1], -y0, q[0], q[1], -y1, p[0], p[1], -y0, q[0], q[1], -y1, p[0], p[1], -y1];
      orient(quad, nx, nz, 0);
      this.triangles(quad, color);
    }
    return this;
  }

  get empty(): boolean {
    return this.m.empty;
  }

  /** The merged geometry, with its tags as attributes (`cut`, `part`, `fade`). */
  build(): BufferGeometry {
    const g = this.m.build();
    for (const name of ["cut", "part", "fade"] as const) g.setAttribute(name, new BufferAttribute(Float32Array.from(this.tags[name]), 1));
    if (!g.getAttribute("glow")) g.setAttribute("glow", new BufferAttribute(new Float32Array(this.count), 1));
    return g;
  }
}

/** Winds raw triangles (nine numbers each, scene coordinates) so their normals point along (nx, ny, nz). */
function orient(points: number[], nx: number, ny: number, nz: number): void {
  const n = flatNormals(new Float32Array(points));
  for (let i = 0; i < points.length; i += 9) {
    if (n[i]! * nx + n[i + 1]! * ny + n[i + 2]! * nz >= 0) continue;
    for (let k = 0; k < 3; k++) {
      const t = points[i + 3 + k]!;
      points[i + 3 + k] = points[i + 6 + k]!;
      points[i + 6 + k] = t;
    }
  }
}

const smoothstep = (lo: number, hi: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

/** Under the hall's roof and within its walls (a point of the scene, a hair's breadth inside every surface). */
export function indoors(x: number, up: number, z: number): boolean {
  return Math.abs(x - HALL.x) < HALL_INNER.hx - 0.005 && Math.abs(-z - HALL.y) < HALL_INNER.hy - 0.005 && up > -0.5 && up < roofAt(x) - 0.03;
}

/** How much of the hall's lamplight falls on a point outside it: a fan across the forecourt from the open door. */
export function spill(x: number, up: number, z: number): number {
  const out = HALL_DOOR.x - x;
  if (out < -0.4 || up > 7) return 0;
  const reach = 11;
  const across = Math.abs(-z - HALL_DOOR.y) - HALL_DOOR.half;
  const fan = 1 - smoothstep(0, 1.5 + Math.max(0, out) * 0.55, across);
  const far = 1 - Math.max(0, out) / reach;
  return far <= 0 ? 0 : 0.62 * far * far * fan;
}

/**
 * The shade on the floor round what stands on it: soft and close (a contact shadow), from every
 * solid of the plan. 1 in the open, down to `depth` right against a machine's foot.
 */
export function floorShade(solids: readonly Solid[], x: number, y: number, depth = 0.62): number {
  let shade = 1;
  for (let i = 0; i < solids.length; i++) {
    const c = solids[i]!.collider;
    let d: number;
    if (c.kind === "circle") d = Math.hypot(x - c.x, y - c.y) - c.r;
    else {
      const dx = Math.abs(x - c.x) - c.hx;
      const dy = Math.abs(y - c.y) - c.hy;
      d = dx <= 0 && dy <= 0 ? Math.max(dx, dy) : Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
    }
    const reach = Math.min(1.1, 0.35 + 0.3 * (c.top ?? 1));
    if (d < reach) shade = Math.min(shade, depth + (1 - depth) * smoothstep(-0.05, reach, d));
  }
  return shade;
}

export interface Finish {
  /** Things that shade the floor round their feet (the plan's solids). */
  solids?: readonly Solid[];
  /** Darker near the floor, by this much at most, fading out by `height` (things standing on it). */
  foot?: number;
  height?: number;
  /** Everything is indoors (the machines): skip the test. */
  inside?: boolean;
  /** The floor's height (faces level and facing up below this are floor). */
  floor?: number;
}

/**
 * Finishes a merged geometry for the hall's materials: a `lit` attribute (1 on every face the hall's own
 * light reaches, a fading share on the forecourt before the door, 0 outdoors) and a baked occlusion: the
 * floor shaded round what stands on it, things darker towards their feet and on faces that look down.
 */
export function finish(geometry: BufferGeometry, options: Finish = {}): BufferGeometry {
  const p = geometry.getAttribute("position").array as Float32Array;
  const n = geometry.getAttribute("normal").array as Float32Array;
  const c = geometry.getAttribute("color").array as Float32Array;
  const count = p.length / 3;
  const lit = new Float32Array(count);
  const foot = options.foot ?? 0.3;
  const height = options.height ?? 0.9;
  const floorAt = options.floor ?? 0.3;
  const solids = options.solids;
  for (let i = 0; i < p.length; i += 9) {
    const v = i / 3;
    const [nx, ny, nz] = [n[i]!, n[i + 1]!, n[i + 2]!];
    const cx = (p[i]! + p[i + 3]! + p[i + 6]!) / 3 + nx * 0.12;
    const cy = (p[i + 1]! + p[i + 4]! + p[i + 7]!) / 3 + ny * 0.12;
    const cz = (p[i + 2]! + p[i + 5]! + p[i + 8]!) / 3 + nz * 0.12;
    const inside = options.inside || indoors(cx, cy, cz);
    const floor = ny > 0.99 && cy < floorAt;
    for (let k = 0; k < 3; k++) {
      const x = p[i + k * 3]!;
      const up = p[i + k * 3 + 1]!;
      const z = p[i + k * 3 + 2]!;
      lit[v + k] = inside ? 1 : spill(x, up, z);
      let f = 1;
      if (floor) {
        if (solids && inside) f = floorShade(solids, x, -z);
      } else {
        f = 1 - foot * (1 - smoothstep(0, height, up));
        if (ny < -0.2) f *= 0.78;
      }
      c[i + k * 3] = c[i + k * 3]! * f;
      c[i + k * 3 + 1] = c[i + k * 3 + 1]! * f;
      c[i + k * 3 + 2] = c[i + k * 3 + 2]! * f;
    }
  }
  geometry.setAttribute("lit", new BufferAttribute(lit, 1));
  return geometry;
}

/** The triangles of a geometry. */
export const triangles = (geometry: BufferGeometry): number => (geometry.index ? geometry.index.count : geometry.getAttribute("position").count) / 3;

/** True when (x, y) is within `grow` of any of the plan's solids. */
export function nearSolid(solids: readonly Solid[], x: number, y: number, grow = 0): boolean {
  for (let i = 0; i < solids.length; i++) if (inCollider(solids[i]!.collider, x, y, grow)) return true;
  return false;
}

/**
 * Flat quads for screens and belts (unlit, patterned in the shader): each with its colour, uv (u along,
 * v across), and a kind, a slot and a cell (see screenMaterial).
 */
export class Quads {
  private readonly pos: number[] = [];
  private readonly col: number[] = [];
  private readonly uvs: number[] = [];
  private readonly kind: number[] = [];
  private readonly slot: number[] = [];
  private readonly fade: number[] = [];

  /** A quad from corner `o` along `u` (length `ul` in uv) and `v` (world vectors, x east, y north, z up). */
  add(color: number, o: readonly [number, number, number], u: readonly [number, number, number], v: readonly [number, number, number], kind: number, slot: number, fade = 0, ul = 1): this {
    const c = linear(color);
    const corner = (a: number, b: number) => [o[0] + u[0] * a + v[0] * b, o[2] + u[2] * a + v[2] * b, -(o[1] + u[1] * a + v[1] * b)];
    const quad = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
      [1, 1],
      [0, 1],
    ] as const;
    for (const [a, b] of quad) {
      this.pos.push(...corner(a, b));
      this.col.push(c[0], c[1], c[2]);
      this.uvs.push(a * ul, b);
      this.kind.push(kind);
      this.slot.push(slot);
      this.fade.push(fade);
    }
    return this;
  }

  get empty(): boolean {
    return this.pos.length === 0;
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(Float32Array.from(this.pos), 3));
    g.setAttribute("color", new BufferAttribute(Float32Array.from(this.col), 3));
    g.setAttribute("uv", new BufferAttribute(Float32Array.from(this.uvs), 2));
    g.setAttribute("kind", new BufferAttribute(Float32Array.from(this.kind), 1));
    g.setAttribute("slot", new BufferAttribute(Float32Array.from(this.slot), 1));
    g.setAttribute("fade", new BufferAttribute(Float32Array.from(this.fade), 1));
    g.setAttribute("normal", new BufferAttribute(flatNormals(Float32Array.from(this.pos)), 3));
    g.computeBoundingSphere();
    return g;
  }
}
