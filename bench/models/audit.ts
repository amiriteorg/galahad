/*
 * An audit of a mesh as it would be drawn: is it sound? No three.js here: a
 * geometry is read through the few fields every one has, so the audit never
 * depends on which copy of the library built it.
 *
 * A "closed part" is a connected piece of a mesh (vertices welded where they
 * coincide) in which every edge is shared by exactly two triangles: a box, a
 * limb, a boulder. Only of those can it be said which way is out, and so only
 * for those are the winding (its signed volume) and the stored normals held to
 * it. Leaves, blades, cards and the ground are open, and aren't.
 *
 * Two vertices in one place are one vertex only if they also move as one: in a
 * skinned mesh, on the same bone (sixteen printers are modelled in one spot and
 * carried to their places by their bones); in an animal's mesh, in the same part
 * (the drake and the duck share a mesh, and the shader shows one).
 */

export interface Attribute {
  array: ArrayLike<number>;
  itemSize: number;
  count: number;
  normalized?: boolean;
  /** An interleaved attribute is read through these (its array is the whole buffer). */
  getX?(i: number): number;
  getY?(i: number): number;
  getZ?(i: number): number;
  getW?(i: number): number;
}

export interface Geometry {
  index: { array: ArrayLike<number>; count: number } | null;
  getAttribute(name: string): Attribute | undefined;
}

export interface MeshLike {
  isMesh?: boolean;
  isSkinnedMesh?: boolean;
  isInstancedMesh?: boolean;
  visible?: boolean;
  name?: string;
  geometry: Geometry;
  matrixWorld: { elements: ArrayLike<number> };
  skeleton?: { bones: unknown[] };
}

export interface ObjectLike {
  traverse(visit: (object: unknown) => void): void;
  updateMatrixWorld(force?: boolean): void;
}

export interface Audit {
  meshes: number;
  vertices: number;
  triangles: number;
  /** Positions, normals or skin weights that aren't finite numbers. */
  nonFinite: number;
  /**
   * Triangles of no area (two corners in one place, or three in a line). A mesh whose every triangle is one is
   * no fault: it's a strip or a card the vertex shader opens out (a shaft of light), and is counted in `expanded`.
   */
  degenerate: number;
  expanded: number;
  /** Closed parts, and those of them wound inside out (their volume is negative). */
  closedParts: number;
  insideOut: number;
  /** Triangles of closed parts whose stored normal points into the part. */
  inwardNormals: number;
  /** Stored normals that aren't unit vectors. */
  unnormalised: number;
  /**
   * A triangle drawn twice in the same place facing the same way. In different colours they clash: one hides the
   * other (whichever is drawn first), or they flicker where their depths round differently. In the same colour
   * nothing shows, and the second is only wasted. And twice facing opposite ways (a two-sided face made of two): no harm.
   */
  clashing: number;
  redundant: number;
  twoSided: number;
  /** Where the first few clashing faces are (scene space), for whoever goes looking. */
  clashingAt: string[];
  /** Skinned vertices whose weights don't sum to one, and whose bones don't exist. */
  skinned: number;
  badWeights: number;
  badBones: number;
  /** Its bounds as placed (scene space: y up), over every mesh. */
  min: [number, number, number];
  max: [number, number, number];
  /** A hash of every position and index: the same model, the same number. */
  digest: number;
}

export const emptyAudit = (): Audit => ({ meshes: 0, vertices: 0, triangles: 0, nonFinite: 0, degenerate: 0, expanded: 0, closedParts: 0, insideOut: 0, inwardNormals: 0, unnormalised: 0, clashing: 0, redundant: 0, twoSided: 0, clashingAt: [], skinned: 0, badWeights: 0, badBones: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], digest: 0x811c9dc5 });

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
/** Coincident: within a tenth of a millimetre. */
const WELD = 1e4;

/** Audit one geometry into `into` (its bounds as placed by `matrix`, a column-major 4×4; `bones`: how many its skeleton has). */
export function auditGeometry(g: Geometry, into: Audit = emptyAudit(), matrix: ArrayLike<number> = IDENTITY, bones = 0): Audit {
  const position = g.getAttribute("position");
  if (!position) return into;
  const p = position.array;
  const n = position.count;
  // A plain normal is three numbers; what grows packs its shading into four, which says nothing of which way a face looks.
  const packed = g.getAttribute("normal");
  const normal = packed && packed.itemSize === 3 ? packed : undefined;
  const index = g.index?.array ?? null;
  const triangles = Math.floor((index ? g.index!.count : n) / 3);
  const corner = index ? (i: number) => index[i]! : (i: number) => i;
  into.meshes++;
  into.vertices += n;
  into.triangles += triangles;

  // Finite, and where it stands.
  let h = into.digest;
  const m = matrix;
  for (let i = 0; i < n; i++) {
    const x = p[i * 3]!;
    const y = p[i * 3 + 1]!;
    const z = p[i * 3 + 2]!;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      into.nonFinite++;
      continue;
    }
    h = Math.imul(h ^ Math.round(x * WELD), 0x01000193);
    h = Math.imul(h ^ Math.round(y * WELD), 0x01000193);
    h = Math.imul(h ^ Math.round(z * WELD), 0x01000193);
    const wx = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
    const wy = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
    const wz = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
    if (wx < into.min[0]) into.min[0] = wx;
    if (wy < into.min[1]) into.min[1] = wy;
    if (wz < into.min[2]) into.min[2] = wz;
    if (wx > into.max[0]) into.max[0] = wx;
    if (wy > into.max[1]) into.max[1] = wy;
    if (wz > into.max[2]) into.max[2] = wz;
  }
  if (index) for (let i = 0; i < triangles * 3; i++) h = Math.imul(h ^ index[i]!, 0x01000193);
  into.digest = h >>> 0;
  if (normal) {
    const a = normal.array;
    const scale = normal.normalized ? 1 / 127 : 1;
    for (let i = 0; i < normal.count; i++) {
      const x = a[i * 3]! * scale;
      const y = a[i * 3 + 1]! * scale;
      const z = a[i * 3 + 2]! * scale;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) into.nonFinite++;
      else if (Math.abs(Math.hypot(x, y, z) - 1) > 0.02) into.unnormalised++;
    }
  }

  // Skin: every vertex's weights sum to one, on bones that exist.
  const skinIndex = g.getAttribute("skinIndex");
  const skinWeight = g.getAttribute("skinWeight");
  if (skinIndex && skinWeight) {
    const per = skinWeight.itemSize;
    const unit = skinWeight.normalized ? 1 / (skinWeight.array instanceof Uint8Array ? 255 : 65535) : 1;
    for (let i = 0; i < skinWeight.count; i++) {
      let sum = 0;
      let missing = false;
      for (let k = 0; k < per; k++) {
        const weight = skinWeight.array[i * per + k]! * unit;
        if (!Number.isFinite(weight)) into.nonFinite++;
        sum += weight;
        if (weight > 0 && bones > 0 && !(skinIndex.array[i * per + k]! < bones)) missing = true;
      }
      into.skinned++;
      if (Math.abs(sum - 1) > 1e-3) into.badWeights++;
      if (missing) into.badBones++;
    }
  }

  // Weld coincident vertices (that move as one), then read the triangles.
  const ids = new Map<string, number>();
  const welded = new Int32Array(n);
  const rigA = g.getAttribute("rigA");
  const rigB = g.getAttribute("rigB");
  /** What a vertex moves with: its heaviest bone, or its part of an animal. */
  const moves = (i: number): string => {
    if (skinIndex && skinWeight) {
      let best = 0;
      for (let k = 1; k < skinWeight.itemSize; k++) if (skinWeight.array[i * skinWeight.itemSize + k]! > skinWeight.array[i * skinWeight.itemSize + best]!) best = k;
      return `b${skinIndex.array[i * skinIndex.itemSize + best]}`;
    }
    if (rigA && rigB) return `r${rigA.getX!(i)},${rigA.getY!(i)},${rigA.getZ!(i)},${rigA.getW!(i)},${rigB.getX!(i)},${rigB.getY!(i)},${rigB.getZ!(i)}`;
    return "";
  };
  for (let i = 0; i < n; i++) {
    const key = `${Math.round(p[i * 3]! * WELD)},${Math.round(p[i * 3 + 1]! * WELD)},${Math.round(p[i * 3 + 2]! * WELD)}${moves(i)}`;
    let id = ids.get(key);
    if (id === undefined) ids.set(key, (id = ids.size));
    welded[i] = id;
  }
  const count = ids.size;
  const parent = new Int32Array(count);
  for (let i = 0; i < count; i++) parent[i] = i;
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const edges = new Map<number, number>();
  const faces = new Map<string, number>();
  const colour = g.getAttribute("color");
  /** A triangle's colour as one number (the sum over its corners): two faces in one place flicker only if theirs differ. */
  const shade = (t: number): number => {
    if (!colour) return 0;
    const unit = colour.normalized ? 1 / 255 : 1;
    let sum = 0;
    for (let k = 0; k < 3; k++) for (let c = 0; c < 3; c++) sum += colour.array[corner(t * 3 + k) * colour.itemSize + c]! * unit * (c + 1);
    return sum;
  };
  const sound = new Uint8Array(triangles);
  const degenerateBefore = into.degenerate;
  for (let t = 0; t < triangles; t++) {
    const ia = corner(t * 3);
    const ib = corner(t * 3 + 1);
    const ic = corner(t * 3 + 2);
    const a = welded[ia]!;
    const b = welded[ib]!;
    const c = welded[ic]!;
    const ux = p[ib * 3]! - p[ia * 3]!;
    const uy = p[ib * 3 + 1]! - p[ia * 3 + 1]!;
    const uz = p[ib * 3 + 2]! - p[ia * 3 + 2]!;
    const vx = p[ic * 3]! - p[ia * 3]!;
    const vy = p[ic * 3 + 1]! - p[ia * 3 + 1]!;
    const vz = p[ic * 3 + 2]! - p[ia * 3 + 2]!;
    const area = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    if (a === b || b === c || a === c || !(area > 1e-10)) {
      into.degenerate++;
      continue;
    }
    sound[t] = 1;
    parent[find(a)] = find(b);
    parent[find(b)] = find(c);
    for (const [x, y] of [[a, b], [b, c], [c, a]] as const) {
      const key = x < y ? x * count + y : y * count + x;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
    // The same three corners again: the same way round, or the other.
    const low = Math.min(a, b, c);
    const turned = low === a ? [a, b, c] : low === b ? [b, c, a] : [c, a, b];
    const same = `${turned[0]},${turned[1]},${turned[2]}`;
    const other = `${turned[0]},${turned[2]},${turned[1]}`;
    const twin = faces.get(same);
    if (twin !== undefined) {
      if (Math.abs(shade(t) - shade(twin)) > 0.02) {
        into.clashing++;
        if (into.clashingAt.length < 3) {
          const cx = (p[ia * 3]! + p[ib * 3]! + p[ic * 3]!) / 3;
          const cy = (p[ia * 3 + 1]! + p[ib * 3 + 1]! + p[ic * 3 + 1]!) / 3;
          const cz = (p[ia * 3 + 2]! + p[ib * 3 + 2]! + p[ic * 3 + 2]!) / 3;
          into.clashingAt.push(`${(m[0]! * cx + m[4]! * cy + m[8]! * cz + m[12]!).toFixed(2)},${(m[1]! * cx + m[5]! * cy + m[9]! * cz + m[13]!).toFixed(2)},${(m[2]! * cx + m[6]! * cy + m[10]! * cz + m[14]!).toFixed(2)}`);
        }
      } else into.redundant++;
    } else if (faces.has(other)) into.twoSided++;
    faces.set(same, t);
  }

  if (triangles > 0 && into.degenerate - degenerateBefore === triangles) {
    into.degenerate = degenerateBefore;
    into.expanded++;
  }

  // Closed parts: every edge of the part shared by exactly two triangles.
  const open = new Uint8Array(count);
  for (const [key, uses] of edges) if (uses !== 2) open[find(Math.floor(key / count))] = 1;
  const volume = new Float64Array(count);
  const has = new Uint8Array(count);
  for (let t = 0; t < triangles; t++) {
    if (!sound[t]) continue;
    const ia = corner(t * 3);
    const ib = corner(t * 3 + 1);
    const ic = corner(t * 3 + 2);
    const root = find(welded[ia]!);
    if (open[root]) continue;
    has[root] = 1;
    const ax = p[ia * 3]!;
    const ay = p[ia * 3 + 1]!;
    const az = p[ia * 3 + 2]!;
    const bx = p[ib * 3]!;
    const by = p[ib * 3 + 1]!;
    const bz = p[ib * 3 + 2]!;
    const cx = p[ic * 3]!;
    const cy = p[ic * 3 + 1]!;
    const cz = p[ic * 3 + 2]!;
    volume[root] = volume[root]! + (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
  }
  for (let i = 0; i < count; i++) {
    if (!has[i]) continue;
    into.closedParts++;
    if (volume[i]! < -1e-9) into.insideOut++;
  }
  // In a closed part wound the right way, a triangle's stored normals point the way its winding does: out.
  if (normal) {
    const a = normal.array;
    for (let t = 0; t < triangles; t++) {
      if (!sound[t]) continue;
      const ia = corner(t * 3);
      const ib = corner(t * 3 + 1);
      const ic = corner(t * 3 + 2);
      const root = find(welded[ia]!);
      if (open[root] || volume[root]! < -1e-9) continue;
      const ux = p[ib * 3]! - p[ia * 3]!;
      const uy = p[ib * 3 + 1]! - p[ia * 3 + 1]!;
      const uz = p[ib * 3 + 2]! - p[ia * 3 + 2]!;
      const vx = p[ic * 3]! - p[ia * 3]!;
      const vy = p[ic * 3 + 1]! - p[ia * 3 + 1]!;
      const vz = p[ic * 3 + 2]! - p[ia * 3 + 2]!;
      const fx = uy * vz - uz * vy;
      const fy = uz * vx - ux * vz;
      const fz = ux * vy - uy * vx;
      const nx = a[ia * 3]! + a[ib * 3]! + a[ic * 3]!;
      const ny = a[ia * 3 + 1]! + a[ib * 3 + 1]! + a[ic * 3 + 1]!;
      const nz = a[ia * 3 + 2]! + a[ib * 3 + 2]! + a[ic * 3 + 2]!;
      if (fx * nx + fy * ny + fz * nz < 0) into.inwardNormals++;
    }
  }
  return into;
}

/** Audit everything drawn under `root`: every mesh, where it stands (`only`: just the skinned ones, a body without what it carries). */
export function auditObject(root: ObjectLike, into: Audit = emptyAudit(), only?: "skinned"): Audit {
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    const mesh = object as MeshLike;
    if (!mesh.isMesh || !mesh.geometry || (only === "skinned" && !mesh.isSkinnedMesh)) return;
    // An instanced mesh's instances are placed on the GPU: the one model is audited where it's made.
    auditGeometry(mesh.geometry, into, mesh.isInstancedMesh ? IDENTITY : mesh.matrixWorld.elements, mesh.isSkinnedMesh ? (mesh.skeleton?.bones.length ?? 0) : 0);
  });
  return into;
}
