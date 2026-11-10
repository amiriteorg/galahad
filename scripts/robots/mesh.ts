import { MeshoptSimplifier } from "meshoptimizer";

/*
 * Mesh work for the robot asset build: read STL (binary or ASCII) into a triangle
 * soup, weld it, and reduce it to a low-poly mesh that keeps the part's shape.
 *
 * The reduction is edge collapse guided by quadric error (meshoptimizer, a dev-only
 * dependency of this script: the world never loads it). Vertex clustering was tried
 * first and gives the faceted look cheaply, but the robots are 3D-printed shells
 * with walls a couple of millimetres thick: at the cell sizes the budgets need,
 * clustering folds a wall's inner and outer faces into each other (a crumpled,
 * spiky surface with holes, worst on Reachy Mini's turned body). Edge collapse
 * keeps each surface whole, never flips a face, and drops loose specks smaller
 * than the error (screw heads, cable ends). Every face is then drawn flat-shaded,
 * so the robots keep the faceted low-poly look of the rest of the world.
 */

await MeshoptSimplifier.ready;

/** Triangles as a flat soup: 9 numbers (three x, y, z vertices) each. */
export type Soup = Float32Array;

/** Reads an STL file (binary, or ASCII "solid … facet … vertex …"). */
export function parseStl(bytes: Uint8Array): Soup {
  if (bytes.byteLength >= 84) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = view.getUint32(80, true);
    if (84 + count * 50 === bytes.byteLength) {
      const out = new Float32Array(count * 9);
      for (let t = 0; t < count; t++) {
        const at = 84 + t * 50 + 12; // skip the facet normal
        for (let k = 0; k < 9; k++) out[t * 9 + k] = view.getFloat32(at + k * 4, true);
      }
      return out;
    }
  }
  const text = new TextDecoder().decode(bytes);
  if (!/^\s*solid/.test(text)) throw new Error("not an STL file");
  const values: number[] = [];
  for (const m of text.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)) values.push(Number(m[1]), Number(m[2]), Number(m[3]));
  if (values.length % 9 !== 0 || !values.every(Number.isFinite)) throw new Error("malformed ASCII STL");
  return Float32Array.from(values);
}

/** A soup through a column-major 4×4 transform (rotation + translation), scaled first by `scale`. */
export function transformSoup(soup: Soup, m: Float64Array, scale: readonly number[] = [1, 1, 1]): Soup {
  const out = new Float32Array(soup.length);
  const [sx, sy, sz] = [scale[0] ?? 1, scale[1] ?? 1, scale[2] ?? 1];
  for (let i = 0; i < soup.length; i += 3) {
    const x = soup[i]! * sx;
    const y = soup[i + 1]! * sy;
    const z = soup[i + 2]! * sz;
    out[i] = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
    out[i + 1] = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
    out[i + 2] = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
  }
  // A mirroring scale flips the winding; flip it back so faces still point out.
  if (sx * sy * sz < 0) {
    for (let t = 0; t < out.length; t += 9) {
      for (let k = 0; k < 3; k++) {
        const a = out[t + 3 + k]!;
        out[t + 3 + k] = out[t + 6 + k]!;
        out[t + 6 + k] = a;
      }
    }
  }
  return out;
}

/** An indexed mesh: positions (3 per vertex) and triangles (3 indices each). */
export interface Indexed {
  positions: Float32Array;
  indices: Uint32Array;
}

const OFFSET = 1 << 20;
const SPAN = 1 << 21;
/** A grid cell as one exact number (each axis within ±2^20 cells). */
const cellKey = (ix: number, iy: number, iz: number): number => ((ix + OFFSET) * SPAN + (iy + OFFSET)) * SPAN + (iz + OFFSET);

/** Merges vertices that coincide (to within `epsilon` metres): a soup becomes an indexed mesh, its degenerate triangles dropped. */
export function weld(soup: Soup, epsilon = 1e-6): Indexed {
  const ids = new Map<number, number>();
  const positions: number[] = [];
  const indices: number[] = [];
  const corner = [0, 0, 0];
  for (let t = 0; t < soup.length; t += 9) {
    for (let k = 0; k < 3; k++) {
      const x = soup[t + k * 3]!;
      const y = soup[t + k * 3 + 1]!;
      const z = soup[t + k * 3 + 2]!;
      const key = cellKey(Math.round(x / epsilon), Math.round(y / epsilon), Math.round(z / epsilon));
      let id = ids.get(key);
      if (id === undefined) {
        id = positions.length / 3;
        ids.set(key, id);
        positions.push(x, y, z);
      }
      corner[k] = id;
    }
    if (corner[0] !== corner[1] && corner[1] !== corner[2] && corner[0] !== corner[2]) indices.push(corner[0]!, corner[1]!, corner[2]!);
  }
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) };
}

/**
 * Collapses edges while the surface stays within `error` metres of the original
 * (and drops loose bits smaller than that); returns the mesh with only the
 * vertices it still uses.
 */
export function simplify(mesh: Indexed, error: number): Indexed {
  if (mesh.indices.length === 0) return mesh;
  const [indices] = MeshoptSimplifier.simplify(mesh.indices, mesh.positions, 3, 0, error, ["ErrorAbsolute", "Prune"]);
  const remap = new Int32Array(mesh.positions.length / 3).fill(-1);
  const positions: number[] = [];
  const out = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i]!;
    if (remap[v] === -1) {
      remap[v] = positions.length / 3;
      positions.push(mesh.positions[v * 3]!, mesh.positions[v * 3 + 1]!, mesh.positions[v * 3 + 2]!);
    }
    out[i] = remap[v]!;
  }
  return { positions: Float32Array.from(positions), indices: out };
}

/** Back to a soup (for tests). */
export function toSoup(mesh: Indexed): Soup {
  const out = new Float32Array(mesh.indices.length * 3);
  for (let i = 0; i < mesh.indices.length; i++) {
    const v = mesh.indices[i]!;
    out[i * 3] = mesh.positions[v * 3]!;
    out[i * 3 + 1] = mesh.positions[v * 3 + 1]!;
    out[i * 3 + 2] = mesh.positions[v * 3 + 2]!;
  }
  return out;
}

/** A soup's total surface area (for tests: simplifying shouldn't eat a shape). */
export function area(soup: Soup): number {
  let sum = 0;
  for (let t = 0; t < soup.length; t += 9) {
    const ux = soup[t + 3]! - soup[t]!;
    const uy = soup[t + 4]! - soup[t + 1]!;
    const uz = soup[t + 5]! - soup[t + 2]!;
    const vx = soup[t + 6]! - soup[t]!;
    const vy = soup[t + 7]! - soup[t + 1]!;
    const vz = soup[t + 8]! - soup[t + 2]!;
    sum += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  }
  return sum / 2;
}
