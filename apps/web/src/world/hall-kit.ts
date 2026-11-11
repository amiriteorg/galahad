import { BoxGeometry, BufferAttribute, BufferGeometry, CylinderGeometry, type Matrix4 } from "three/webgpu";
import { HALL, HALL_DOOR, HALL_INNER, inCollider, roofAt, type Solid } from "./hall-plan.ts";
import { at, between, bevelBox, flatNormals, Mesher, type Paint } from "./mesher.ts";

/*
 * What the workshop hall is built with: a Mesher that takes world coordinates
 * (x east, y north, z up, as the plan is written) and a level of detail, and
 * the finishing of its merged geometry: which faces the hall's own light
 * reaches, the soft shade where things stand on the floor, and (for the shell)
 * which wall or roof each face belongs to, so it can dissolve.
 */

/** 0 the plainest shapes (low tier), 2 the finest (high). */
export type Detail = 0 | 1 | 2;

/** A place in the world as a scene transform; `heading` turns local +x that way (atan2 convention). */
export const W = (x: number, y: number, z = 0, heading = 0): Matrix4 => at(x, z, -y, heading);

export class Kit {
  readonly m: Mesher;

  constructor(
    readonly detail: Detail,
    m: Mesher = new Mesher(),
  ) {
    this.m = m;
  }

  /** How many sides a round thing gets: `n` at the finest, fewer below. */
  sides(n: number): number {
    return this.detail === 2 ? n : this.detail === 1 ? Math.max(6, Math.round(n * 0.67)) : Math.max(5, Math.round(n * 0.5));
  }

  /** A box centred on (x, y, z): `sx` east-west, `sy` north-south, `sz` high, turned by `heading`. */
  box(color: number | Paint, x: number, y: number, z: number, sx: number, sy: number, sz: number, heading = 0, vary = 0.04): this {
    this.m.add(new BoxGeometry(sx, sz, sy), color, W(x, y, z, heading), vary);
    return this;
  }

  /** The same with bevelled edges at the finest detail (a casing, a panel: its edges catch the light). */
  panel(color: number | Paint, x: number, y: number, z: number, sx: number, sy: number, sz: number, heading = 0, vary = 0.04, bevel = 0.03): this {
    if (this.detail < 2) return this.box(color, x, y, z, sx, sy, sz, heading, vary);
    this.m.add(bevelBox(sx, sz, sy, Math.min(bevel, Math.min(sx, sy, sz) * 0.25)), color, W(x, y, z, heading), vary);
    return this;
  }

  /** A box by its extents. */
  slab(color: number | Paint, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, vary = 0.04): this {
    return this.box(color, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), 0, vary);
  }

  /** An upright cylinder (or cone: `top` radius) standing on z0. */
  cyl(color: number | Paint, x: number, y: number, z0: number, r: number, h: number, sides = 12, top = r, vary = 0.04): this {
    this.m.add(new CylinderGeometry(top, r, h, this.sides(sides)), color, W(x, y, z0 + h / 2), vary);
    return this;
  }

  /** A round (or `sides`-sided) bar between two points. */
  rod(color: number | Paint, ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number, sides = 6, vary = 0.03): this {
    this.m.add(new CylinderGeometry(r, r, 1, Math.max(4, this.sides(sides)), 1, this.detail === 0), color, between(ax, az, -ay, bx, bz, -by), vary);
    return this;
  }

  /** Any geometry, placed by a scene matrix (see W). */
  add(geometry: BufferGeometry, color: number | Paint, m: Matrix4, vary = 0.04): this {
    this.m.add(geometry, color, m, vary);
    return this;
  }

  /** A flat triangle fan over world points (a polygon seen from `up`: +1 from above/outside, −1 from below), `z` constant. */
  polygon(color: number, points: readonly (readonly [number, number])[], z: number): this {
    const out: number[] = [];
    for (let i = 1; i + 1 < points.length; i++) {
      const [a, b, c] = [points[0]!, points[i]!, points[i + 1]!];
      // Counter-clockwise seen from above (world) is counter-clockwise from above in the scene with z flipped: swap.
      out.push(a[0], z, -a[1], c[0], z, -c[1], b[0], z, -b[1]);
    }
    orient(out, 0, 1, 0);
    this.m.triangles(out, color);
    return this;
  }

  /** A wall-thick triangle in an upright plane (x, z) at north-south `y0`..`y1` (a gable's infill): three points (x, z). */
  wedge(color: number, a: readonly [number, number], b: readonly [number, number], c: readonly [number, number], y0: number, y1: number): this {
    const tri = [a, b, c];
    for (const [y, ny] of [[y0, y0 < y1 ? -1 : 1], [y1, y0 < y1 ? 1 : -1]] as const) {
      const face = tri.flatMap(([x, z]) => [x, z, -y]);
      orient(face, 0, 0, -ny);
      this.m.triangles(face, color);
    }
    for (let i = 0; i < 3; i++) {
      const [p, q] = [tri[i]!, tri[(i + 1) % 3]!];
      const r = tri[(i + 2) % 3]!;
      // Outward: away from the third corner.
      const ex = q[0] - p[0];
      const ez = q[1] - p[1];
      let nx = ez;
      let nz = -ex;
      if (nx * (r[0] - p[0]) + nz * (r[1] - p[1]) > 0) {
        nx = -nx;
        nz = -nz;
      }
      const quad = [p[0], p[1], -y0, q[0], q[1], -y0, q[0], q[1], -y1, p[0], p[1], -y0, q[0], q[1], -y1, p[0], p[1], -y1];
      orient(quad, nx, nz, 0);
      this.m.triangles(quad, color);
    }
    return this;
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

/**
 * Which part of the shell a face belongs to, for the cutaway: the wall's outer side as a plane in the
 * scene (nx·x + nz·z = d, the normal pointing out), and whether it's above the eaves (and goes with the roof).
 */
export type Cut = readonly [nx: number, nz: number, d: number, roof: number];

export const CUT = {
  west: [-1, 0, -(HALL.x - HALL.hx), 0] as Cut,
  east: [1, 0, HALL.x + HALL.hx, 0] as Cut,
  north: [0, -1, HALL.y + HALL.hy, 0] as Cut,
  south: [0, 1, -(HALL.y - HALL.hy), 0] as Cut,
  /** The roof alone: no wall's plane (the camera is never "outside" it). */
  roof: [0, 0, 1e6, 1] as Cut,
};
/** A wall's part above the eaves: it goes with its wall, and with the roof. */
export const above = (cut: Cut): Cut => [cut[0], cut[1], cut[2], 1];

/** Merges built geometries into one, each with its cut plane as a `cut` attribute (vec4). */
export function mergeCut(parts: readonly { geometry: BufferGeometry; cut: Cut }[]): BufferGeometry {
  let count = 0;
  for (const p of parts) count += p.geometry.getAttribute("position").count;
  const position = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  const color = new Float32Array(count * 3);
  const glow = new Float32Array(count);
  const cut = new Float32Array(count * 4);
  let o = 0;
  for (const p of parts) {
    const g = p.geometry;
    const n = g.getAttribute("position").count;
    position.set(g.getAttribute("position").array as Float32Array, o * 3);
    normal.set(g.getAttribute("normal").array as Float32Array, o * 3);
    color.set(g.getAttribute("color").array as Float32Array, o * 3);
    const gl = g.getAttribute("glow");
    if (gl) glow.set(gl.array as Float32Array, o);
    for (let i = 0; i < n; i++) cut.set(p.cut, (o + i) * 4);
    o += n;
    g.dispose();
  }
  const out = new BufferGeometry();
  out.setAttribute("position", new BufferAttribute(position, 3));
  out.setAttribute("normal", new BufferAttribute(normal, 3));
  out.setAttribute("color", new BufferAttribute(color, 3));
  out.setAttribute("glow", new BufferAttribute(glow, 1));
  out.setAttribute("cut", new BufferAttribute(cut, 4));
  out.computeBoundingSphere();
  return out;
}

const smoothstep = (lo: number, hi: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

/** Under the hall's roof and within its walls (a point of the scene, a hair's breadth inside every surface). */
function indoors(x: number, up: number, z: number): boolean {
  return Math.abs(x - HALL.x) < HALL_INNER.hx - 0.005 && Math.abs(-z - HALL.y) < HALL_INNER.hy - 0.005 && up > -0.5 && up < roofAt(x) - 0.03;
}

/** How much of the hall's lamplight falls on a point outside it: a fan across the forecourt from the open door. */
function spill(x: number, up: number, z: number): number {
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
}

/**
 * Finishes a merged geometry for the hall's materials: a `lit` attribute (1 on every face the hall's own
 * light reaches, a fading share on the forecourt before the door, 0 outdoors), a `glow` attribute if it
 * had none, and a baked occlusion: the floor shaded round what stands on it, things darker towards their
 * feet and on faces that look down.
 */
export function finish(geometry: BufferGeometry, options: Finish = {}): BufferGeometry {
  const p = geometry.getAttribute("position").array as Float32Array;
  const n = geometry.getAttribute("normal").array as Float32Array;
  const c = geometry.getAttribute("color").array as Float32Array;
  const count = p.length / 3;
  const lit = new Float32Array(count);
  const foot = options.foot ?? 0.3;
  const height = options.height ?? 0.9;
  const solids = options.solids;
  for (let i = 0; i < p.length; i += 9) {
    const v = i / 3;
    const [nx, ny, nz] = [n[i]!, n[i + 1]!, n[i + 2]!];
    const cx = (p[i]! + p[i + 3]! + p[i + 6]!) / 3 + nx * 0.12;
    const cy = (p[i + 1]! + p[i + 4]! + p[i + 7]!) / 3 + ny * 0.12;
    const cz = (p[i + 2]! + p[i + 5]! + p[i + 8]!) / 3 + nz * 0.12;
    const inside = options.inside || indoors(cx, cy, cz);
    // The floor itself (and what's painted on it): level, facing up, at the foot of everything.
    const floor = ny > 0.99 && cy < 0.3;
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
  if (!geometry.getAttribute("glow")) geometry.setAttribute("glow", new BufferAttribute(new Float32Array(count), 1));
  return geometry;
}

/** The triangles of a geometry. */
export const triangles = (geometry: BufferGeometry): number => geometry.getAttribute("position").count / 3;

/** True when (x, y) is within `grow` of any of the plan's solids. */
export function nearSolid(solids: readonly Solid[], x: number, y: number, grow = 0): boolean {
  for (let i = 0; i < solids.length; i++) if (inCollider(solids[i]!.collider, x, y, grow)) return true;
  return false;
}
