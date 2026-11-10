import { cos, float, length, positionGeometry, positionLocal, sin, smoothstep, time, uniform, vec3 } from "three/tsl";
import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  type Group,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  MeshBasicNodeMaterial,
  MeshLambertNodeMaterial,
  OctahedronGeometry,
  Quaternion,
  Matrix4,
  Vector3,
} from "three/webgpu";
import type { Chunk } from "./land.ts";
import { type AmbientOcclusion, at, between, chip, groundAO, lumpy, Mesher, type Paint } from "./mesher.ts";
import { occlusionMask } from "./occlusion.ts";
import { CHUNK, type Layer, SMALL, STRIDE } from "./terrain.ts";
import type { Tier } from "./tiers.ts";

/*
 * Everything that grows: six kinds of tree (oaks, pines, round trees, parasols,
 * birches with their banded white bark, and pastel trees in blossom), leafy
 * bushes in flower and ferns, pinkish boulders and layered slabs with chipped
 * facets, and underfoot grass in tufts and lush clumps gone to seed, patches of daisies and
 * buttercups or lupines, campions and lavender, clover and pebbles. Each model
 * is one instanced mesh (a draw call), so kinds that grow together share one.
 *
 * Trees come in three levels of detail by distance from the focus, chosen per
 * chunk: near, every crown is a heap of many small facets on a tapering trunk
 * with a root flare and branches; farther, a simpler crown; far off, a few
 * facets. A soft contact shadow sits under every tree, bush and rock.
 *
 * The instance buffers are paged: every chunk holds whole pages of each kind it
 * grows, written once when it's grown and zeroed when it's dropped, so only those
 * pages are uploaded (never the whole buffer, never on a turn of the camera). The
 * small things grow only near the focus and the trees swap models with distance,
 * a few chunks per frame within a time budget, nearest first. Everything sways in
 * the vertex shader; trees, bushes and rocks dissolve when they'd hide Galahad.
 */

/** The wind's strength: 0 under reduced motion. */
export const wind = uniform(1);

/** Sways a model in the wind: more at the top (by its own height), in waves across the land. */
export function swaying(stiffness: number) {
  const phase = positionLocal.x.mul(0.21).add(positionLocal.z.mul(0.17));
  const bend = positionGeometry.y.mul(positionGeometry.y).mul(stiffness).mul(wind);
  return positionLocal.add(vec3(sin(time.mul(1.6).add(phase)), 0, cos(time.mul(1.25).add(phase.mul(1.3)))).mul(bend));
}

const TRUNK = 0x9a6644;
const TRUNK_DARK = 0x7d5034;
const LIME_TOP = 0xc4dc62;
const LIME = 0xaacd4e;
const LIME_DEEP = 0x8dbb45;
const LEAF_SHADE = 0x76a63f;
const PINE = 0x5f9a52;
const PINE_LIGHT = 0x76ad5a;
const PINE_DEEP = 0x518c4b;
const BIRCH = 0xf1ece0;
const BIRCH_MARK = 0x55504c;
const BIRCH_LEAF = 0xcfe27c;
const BIRCH_LEAF_DEEP = 0xb3d264;
const BLOSSOM = 0xf5bfd0;
const BLOSSOM_LIGHT = 0xfbdbe5;
const BLOSSOM_DEEP = 0xe9a2bb;
const CHERRY_BARK = 0x7f5547;
const ROCK = 0xdac3b3;
const ROCK_WARM = 0xd2b4a6;
const ROCK_PALE = 0xe6d6c8;

const treeAO: AmbientOcclusion = groundAO(0.52, 1.8, 0.7);
const lowAO: AmbientOcclusion = groundAO(0.5, 0.45, 0.8);

/** The trees' kinds (a placement's kind is an index here; see terrain.ts). */
export const TREE_KINDS = ["oak", "pine", "round", "parasol", "birch", "blossom"] as const;

/** Bark in pale bands with dark marks, as a birch's (a Paint, by height). */
const birchBark: Paint = (x, y, z) => (fract(y * 2.3 + Math.sin(x * 7 + z * 5) * 0.2) < 0.22 ? BIRCH_MARK : BIRCH);

/**
 * A tapering trunk from the ground up to (topX, h, topZ) in `segs` pieces that
 * waver a little on the way, `sides` facets round, and `roots` roots splaying
 * out at its foot. Returns where it ends.
 */
function trunk(m: Mesher, h: number, r: number, topX: number, topZ: number, segs: number, sides: number, color: number | Paint, roots: number, rootColor: number, rings = 1): [number, number, number] {
  let px = 0;
  let py = 0;
  let pz = 0;
  let pr = r;
  for (let k = 1; k <= segs; k++) {
    const t = k / segs;
    const wobble = k < segs ? Math.sin(k * 2.1) * r * 0.45 : 0;
    const x = topX * t + wobble;
    const z = topZ * t + Math.cos(k * 1.7) * wobble * 0.6;
    const y = h * t;
    const nr = r * (1 - 0.5 * t);
    // A touch longer than the gap, so the pieces overlap at the bends.
    m.add(new CylinderGeometry(nr, pr, 1, sides, rings, true), color, between(px, py - (k > 1 ? 0.06 : 0), pz, x, y, z, 1), 0.12);
    px = x;
    py = y;
    pz = z;
    pr = nr;
  }
  for (let i = 0; i < roots; i++) {
    const a = (i / roots) * Math.PI * 2 + 0.4;
    const reach = r * (1.5 + 0.35 * Math.sin(i * 2.7));
    m.add(new ConeGeometry(r * 0.5, r * 2.5, 4), rootColor, between(Math.sin(a) * reach, 0.02, Math.cos(a) * reach, Math.sin(a) * r * 0.2, r * 1.9, Math.cos(a) * r * 0.2, 1), 0.1);
  }
  return [px, py, pz];
}

type Cluster = [x: number, y: number, z: number, r: number, color: number];

/** A crown's clusters: near, heaps of many small facets (`detail` 1); farther, a few big ones; each pushed about so no two match. */
function crown(m: Mesher, clusters: Cluster[], detail: 0 | 1, squash: number, seed: number): void {
  clusters.forEach(([x, y, z, r, color], i) => {
    // The biggest clusters near get the finer facets; the small ones stay coarse (they're small anyway).
    const fine = detail === 1 && r >= 0.75;
    m.add(lumpy(new IcosahedronGeometry(r, fine ? 1 : 0), seed + i * 7, fine ? 0.13 : 0.16), color, at(x, y, z, x * 1.7 + z + i, [1, squash, 1]), 0.1);
  });
}

/** Branches from the trunk's top out towards the first `n` clusters. */
function branches(m: Mesher, from: [number, number, number], clusters: Cluster[], n: number, r: number, color: number): void {
  for (const [x, y, z] of clusters.slice(0, n)) m.add(new CylinderGeometry(r * 0.55, r, 1, 5, 1, true), color, between(from[0], from[1] - 0.25, from[2], x * 0.8, y - 0.35, z * 0.8, 1), 0.1);
}

/**
 * A pine's tier: a cone whose skirt is cut into points (alternately long and
 * short, drooping), with a shallow underside. `sides` points round.
 */
function pineTier(r: number, h: number, sides: number, seed: number): BufferGeometry {
  const pos: number[] = [];
  const top = [0, h * 0.5, 0];
  const under = [0, -h * 0.25, 0];
  const rim: number[][] = [];
  for (let i = 0; i < sides * 2; i++) {
    const a = (i / (sides * 2)) * Math.PI * 2 + seed;
    const long = i % 2 === 0;
    const rr = long ? r * (0.95 + 0.1 * Math.sin(i * 3.1 + seed)) : r * 0.7;
    rim.push([Math.cos(a) * rr, long ? -h * 0.5 : -h * 0.36, Math.sin(a) * rr]);
  }
  for (let i = 0; i < rim.length; i++) {
    const a = rim[i]!;
    const b = rim[(i + 1) % rim.length]!;
    // Counter-clockwise from outside: up the slope, then the underside facing down.
    pos.push(...top, ...b, ...a);
    pos.push(...under, ...a, ...b);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  return g;
}

/** A thin blade both ways round (so both faces shade like the ground): from a base `w` wide to a tip. */
function blade(m: Mesher, bx: number, bz: number, a: number, w: number, tx: number, ty: number, tz: number, color: number): void {
  const px = Math.cos(a) * w;
  const pz = -Math.sin(a) * w;
  m.triangles([bx - px, 0, bz - pz, bx + px, 0, bz + pz, tx, ty, tz, bx + px, 0, bz + pz, bx - px, 0, bz - pz, tx, ty, tz], color);
}

/** A flat flower head facing up at (x, y, z): `petals` points round (alternately long and short), `r` across. */
function flowerHead(m: Mesher, x: number, y: number, z: number, r: number, petals: number, color: number, turn: number): void {
  const pts: number[] = [];
  for (let i = 0; i < petals * 2; i++) {
    const a = (i / (petals * 2)) * Math.PI * 2 + turn;
    const b = ((i + 1) / (petals * 2)) * Math.PI * 2 + turn;
    const ra = i % 2 ? r * 0.45 : r;
    const rb = (i + 1) % 2 ? r * 0.45 : r;
    // Counter-clockwise seen from above (scene +y).
    pts.push(x, y, z, x + Math.cos(a) * ra, y, z - Math.sin(a) * ra, x + Math.cos(b) * rb, y, z - Math.sin(b) * rb);
  }
  m.triangles(pts, color);
}

const models = {
  // ---- trees, near: many small facets ----
  oak: (detail: 0 | 1) => {
    const m = new Mesher();
    const clusters: Cluster[] = [
      [1.15, 3.75, 0.25, 1.2, LIME_DEEP],
      [-1.05, 3.6, -0.35, 1.15, LIME],
      [0.15, 3.9, -1.1, 1.1, LEAF_SHADE],
      [-0.35, 3.55, 1.05, 1.0, LIME_DEEP],
      [0.65, 4.6, 0.6, 1.1, LIME_TOP],
      [-0.6, 4.65, -0.4, 1.05, LIME],
      [0.9, 4.4, -0.75, 0.9, LIME_TOP],
      [0.1, 5.25, 0.05, 0.95, LIME_TOP],
      ...(detail ? ([[-1.5, 4.2, 0.6, 0.6, LIME], [1.6, 4.1, 0.9, 0.55, LIME_DEEP], [-0.2, 3.3, -1.7, 0.55, LEAF_SHADE]] as Cluster[]) : []),
    ];
    const top = trunk(m, 2.6, 0.34, 0.25, 0.05, detail ? 3 : 2, detail ? 8 : 6, TRUNK, detail ? 6 : 4, TRUNK_DARK);
    branches(m, top, clusters, detail ? 4 : 3, 0.17, TRUNK);
    crown(m, clusters, detail, 0.82, 11);
    return m.build({ ao: treeAO });
  },
  round: (detail: 0 | 1) => {
    const m = new Mesher();
    const clusters: Cluster[] = [
      [0.55, 2.7, 0.1, 0.95, LIME],
      [-0.55, 2.6, 0.25, 0.9, LIME_DEEP],
      [0.05, 2.75, -0.6, 0.9, LEAF_SHADE],
      [0.15, 3.35, 0.2, 0.95, LIME_TOP],
      ...(detail ? ([[-0.3, 3.2, -0.45, 0.55, LIME_TOP], [0.7, 3.1, -0.3, 0.5, LIME]] as Cluster[]) : []),
    ];
    const top = trunk(m, 1.7, 0.26, -0.15, 0, 2, detail ? 7 : 6, TRUNK, detail ? 5 : 4, TRUNK_DARK);
    branches(m, top, clusters, 2, 0.13, TRUNK);
    crown(m, clusters, detail, 0.82, 23);
    return m.build({ ao: treeAO });
  },
  parasol: (detail: 0 | 1) => {
    const m = new Mesher();
    const clusters: Cluster[] = [
      [1.9, 3.9, 0.4, 1.15, LIME],
      [-1.5, 3.8, -0.6, 1.1, LIME_DEEP],
      [0.3, 4.0, -1.7, 1.05, LEAF_SHADE],
      [-0.4, 3.95, 1.6, 1.05, LIME],
      [0.6, 4.4, 0.1, 1.25, LIME_TOP],
      [-1.0, 4.3, 0.6, 0.9, LIME_TOP],
      ...(detail ? ([[1.2, 4.35, -1.0, 0.7, LIME_TOP], [-1.9, 4.0, 0.9, 0.6, LIME]] as Cluster[]) : []),
    ];
    const top = trunk(m, 3.1, 0.3, 0.55, 0, detail ? 3 : 2, detail ? 7 : 6, TRUNK, detail ? 5 : 4, TRUNK_DARK);
    branches(m, top, clusters, 4, 0.15, TRUNK);
    crown(m, clusters, detail, 0.6, 37);
    return m.build({ ao: treeAO });
  },
  birch: (detail: 0 | 1) => {
    const m = new Mesher();
    // A slender, banded trunk, a little crooked, with a tall loose crown of small light leaves.
    const top = trunk(m, 3.6, 0.17, 0.2, -0.1, detail ? 3 : 2, detail ? 7 : 5, birchBark, detail ? 4 : 0, BIRCH_MARK, detail ? 4 : 2);
    const clusters: Cluster[] = [
      [0.45, 3.4, 0.2, 0.75, BIRCH_LEAF_DEEP],
      [-0.4, 3.7, -0.25, 0.7, BIRCH_LEAF],
      [0.15, 4.3, 0.35, 0.72, BIRCH_LEAF],
      [-0.2, 4.6, -0.3, 0.6, BIRCH_LEAF_DEEP],
      [0.3, 5.1, 0.0, 0.55, BIRCH_LEAF],
      [0.05, 3.3, -0.55, 0.6, BIRCH_LEAF_DEEP],
      ...(detail ? ([[-0.6, 4.1, 0.35, 0.45, BIRCH_LEAF], [0.65, 4.2, -0.35, 0.45, BIRCH_LEAF_DEEP], [-0.1, 5.5, 0.15, 0.4, BIRCH_LEAF]] as Cluster[]) : []),
    ];
    branches(m, top, clusters, detail ? 3 : 2, 0.07, BIRCH);
    crown(m, clusters, detail, 1.05, 53);
    return m.build({ ao: treeAO });
  },
  blossom: (detail: 0 | 1) => {
    const m = new Mesher();
    // A cherry: a dark forked trunk under a wide, pastel crown.
    const clusters: Cluster[] = [
      [0.8, 2.9, 0.2, 1.0, BLOSSOM],
      [-0.75, 2.85, -0.2, 0.95, BLOSSOM_DEEP],
      [0.0, 3.0, -0.8, 0.9, BLOSSOM],
      [-0.1, 2.8, 0.85, 0.85, BLOSSOM_LIGHT],
      [0.3, 3.6, 0.1, 0.95, BLOSSOM_LIGHT],
      ...(detail ? ([[-0.6, 3.5, -0.5, 0.6, BLOSSOM], [1.1, 3.3, -0.6, 0.5, BLOSSOM_LIGHT], [-1.1, 3.2, 0.6, 0.5, BLOSSOM_DEEP]] as Cluster[]) : []),
    ];
    const top = trunk(m, 1.9, 0.24, 0.1, 0.1, 2, detail ? 7 : 5, CHERRY_BARK, detail ? 5 : 3, CHERRY_BARK);
    branches(m, top, clusters, detail ? 4 : 2, 0.12, CHERRY_BARK);
    crown(m, clusters, detail, 0.78, 71);
    return m.build({ ao: treeAO });
  },
  pine: (detail: 0 | 1) => {
    const m = new Mesher();
    trunk(m, 1.6, 0.2, 0, 0, 1, 6, TRUNK, detail ? 4 : 0, TRUNK_DARK);
    if (detail) {
      // Six tiers of pointed boughs, narrowing to the top, alternately shaded.
      const tiers: [number, number, number, number][] = [
        [1.65, 1.5, 1.85, PINE_DEEP],
        [1.45, 1.45, 2.55, PINE],
        [1.22, 1.35, 3.2, PINE_LIGHT],
        [0.98, 1.25, 3.8, PINE],
        [0.72, 1.1, 4.35, PINE_LIGHT],
        [0.42, 0.95, 4.85, PINE],
      ];
      tiers.forEach(([r, h, y, color], i) => m.add(pineTier(r, h, 9 - Math.min(3, i), i * 0.7), color, at(0, y, 0), 0.08));
    } else {
      const tiers: [number, number, number, number][] = [
        [1.55, 1.9, 1.9, PINE],
        [1.25, 1.8, 2.85, PINE_LIGHT],
        [0.95, 1.6, 3.75, PINE],
        [0.6, 1.4, 4.6, PINE_LIGHT],
      ];
      tiers.forEach(([r, h, y, color], i) => m.add(new ConeGeometry(r, h, 8), color, at(0, y, 0, i * 0.7), 0.08));
    }
    return m.build({ ao: treeAO });
  },
  // ---- trees, far off: a few facets ----
  farBroad: () =>
    new Mesher()
      .add(new CylinderGeometry(0.2, 0.32, 2.6, 5), TRUNK, at(0.1, 1.3, 0), 0.1)
      .add(new IcosahedronGeometry(1.6, 0), LIME_DEEP, at(0.3, 3.7, 0, 0, [1, 0.8, 1]), 0.08)
      .add(new IcosahedronGeometry(1.4, 0), LIME, at(-0.4, 4.3, 0.2, 1, [1, 0.8, 1]), 0.08)
      .add(new IcosahedronGeometry(1.1, 0), LIME_TOP, at(0.2, 4.9, -0.3, 2, [1, 0.8, 1]), 0.08)
      .build({ ao: treeAO }),
  farBlossom: () =>
    new Mesher()
      .add(new CylinderGeometry(0.16, 0.26, 2, 5), CHERRY_BARK, at(0.05, 1, 0), 0.1)
      .add(new IcosahedronGeometry(1.3, 0), BLOSSOM_DEEP, at(0.2, 2.9, 0, 0, [1, 0.8, 1]), 0.08)
      .add(new IcosahedronGeometry(1.1, 0), BLOSSOM_LIGHT, at(-0.3, 3.4, 0.2, 1, [1, 0.8, 1]), 0.08)
      .build({ ao: treeAO }),
  farConifer: () =>
    new Mesher()
      .add(new CylinderGeometry(0.14, 0.22, 1.4, 5), TRUNK, at(0, 0.7, 0), 0.1)
      .add(new ConeGeometry(1.5, 2.9, 6), PINE, at(0, 2.4, 0), 0.08)
      .add(new ConeGeometry(1.0, 2.4, 6), PINE_LIGHT, at(0, 3.9, 0, 0.5), 0.08)
      .build({ ao: treeAO }),
  // ---- bushes ----
  /** A leafy bush, with a few blossoms (white, pink, a touch of yellow) scattered over it. */
  bush: (blossoms = 6) => {
    const m = new Mesher()
      .add(lumpy(new IcosahedronGeometry(0.62, 1), 3, 0.14), LIME_DEEP, at(0, 0.42, 0, 0, [1.25, 0.8, 1]), 0.1)
      .add(lumpy(new IcosahedronGeometry(0.46, 0), 5, 0.16), LIME, at(0.48, 0.38, 0.18, 0.7, [1, 0.85, 1]), 0.1)
      .add(lumpy(new IcosahedronGeometry(0.42, 0), 7, 0.16), LIME_TOP, at(-0.38, 0.36, -0.22, 1.3, [1, 0.85, 1]), 0.1)
      .add(lumpy(new IcosahedronGeometry(0.36, 0), 9, 0.16), LEAF_SHADE, at(0.1, 0.3, 0.5, 2.1, [1, 0.8, 1]), 0.1)
      .add(lumpy(new IcosahedronGeometry(0.3, 0), 13, 0.16), LIME, at(-0.2, 0.62, 0.25, 0.4, [1, 0.85, 1]), 0.1);
    for (let i = 0; i < blossoms; i++) {
      const a = i * 2.39996;
      const up = 0.35 + 0.5 * fract(i * 0.618);
      const r = 0.62 * Math.sqrt(1 - up * up * 0.6) + 0.1;
      m.add(new OctahedronGeometry(0.07, 0), [0xfdf8f2, BLOSSOM, 0xf6e27a, BLOSSOM_LIGHT][i % 4]!, at(Math.cos(a) * r * 1.2, 0.4 + up * 0.38, Math.sin(a) * r, a, [1, 0.6, 1]), 0.04);
    }
    return m.build({ ao: groundAO(0.55, 0.9, 0.72) });
  },
  fern: () => {
    const m = new Mesher();
    // Fronds arching out from the middle, each a bent strip of two-sided triangles.
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + (i % 2) * 0.2;
      const len = 0.7 + 0.2 * Math.sin(i * 1.9);
      const color = i % 3 === 0 ? PINE_LIGHT : i % 3 === 1 ? LIME_DEEP : LEAF_SHADE;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const mid = [ca * len * 0.5, 0.42, sa * len * 0.5];
      const tip = [ca * len, 0.18, sa * len];
      const w = 0.09;
      const px = -sa * w;
      const pz = ca * w;
      m.triangles([0, 0.05, 0, mid[0]! + px, mid[1]!, mid[2]! + pz, mid[0]! - px, mid[1]!, mid[2]! - pz, 0, 0.05, 0, mid[0]! - px, mid[1]!, mid[2]! - pz, mid[0]! + px, mid[1]!, mid[2]! + pz], color);
      m.triangles([mid[0]! - px, mid[1]!, mid[2]! - pz, mid[0]! + px, mid[1]!, mid[2]! + pz, tip[0]!, tip[1]!, tip[2]!, mid[0]! + px, mid[1]!, mid[2]! + pz, mid[0]! - px, mid[1]!, mid[2]! - pz, tip[0]!, tip[1]!, tip[2]!], color);
    }
    m.add(lumpy(new IcosahedronGeometry(0.16, 0), 29, 0.2), LEAF_SHADE, at(0, 0.1, 0), 0.1);
    return m.build({ ao: groundAO(0.55, 0.6, 0.8) });
  },
  // ---- rocks: chipped facets, warm layered strata ----
  boulder: () => {
    const strata: Paint = (_x, y) => [ROCK, ROCK_WARM, ROCK_PALE, ROCK][Math.floor((y + 2) * 3.2) % 4]!;
    return new Mesher()
      .add(chip(lumpy(new IcosahedronGeometry(0.9, 1), 3, 0.14), 3, 4, 0.8), strata, at(0, 0.32, 0, 0, [1.3, 0.78, 1.08]), 0.07)
      .add(chip(lumpy(new IcosahedronGeometry(0.42, 0), 5, 0.2), 5, 2, 0.78), ROCK_WARM, at(0.85, 0.1, 0.35, 0.8), 0.08)
      .build({ ao: groundAO(0.55, 0.9, 0.7) });
  },
  slab: () => {
    // A low shelf of layered stone: bands of warm and pale rock, its top chipped flat.
    const strata: Paint = (_x, y) => [ROCK_PALE, ROCK, ROCK_WARM][Math.floor((y + 1) * 7) % 3]!;
    return new Mesher()
      .add(chip(lumpy(new IcosahedronGeometry(1, 1), 13, 0.12), 13, 4, 0.72), strata, at(0, 0.18, 0, 0, [1.5, 0.42, 1.1]), 0.06)
      .add(chip(lumpy(new IcosahedronGeometry(0.4, 0), 15, 0.2), 15, 2, 0.8), ROCK_PALE, at(-1.0, 0.12, 0.55, 1.1, [1, 0.6, 1]), 0.08)
      .build({ ao: groundAO(0.6, 0.6, 0.72) });
  },
  // ---- flowers: a handful of shapes, cheap but each its own ----
  daisy: (n = 5) => {
    const m = new Mesher();
    for (const [x, z, h] of ([[0, 0, 0.36], [0.13, 0.07, 0.29], [-0.09, 0.11, 0.25], [0.05, -0.12, 0.31], [-0.12, -0.06, 0.22]] as const).slice(0, n)) {
      blade(m, x, z, x * 9, 0.012, x, h, z, 0x78ad52);
      flowerHead(m, x, h, z, 0.075, 8, 0xfdfcf6, x * 7 + z);
      m.add(new ConeGeometry(0.026, 0.025, 4), 0xf4c143, at(x, h + 0.012, z), 0);
    }
    blade(m, 0, 0, 0.6, 0.04, 0.12, 0.12, -0.05, 0x82b450);
    blade(m, 0, 0, 2.4, 0.04, -0.1, 0.11, 0.06, 0x82b450);
    return m.build({ ao: lowAO, normals: "up" });
  },
  lupine: (n = 3) => {
    const m = new Mesher();
    for (const [x, z, h, hue] of ([[0, 0, 0.5, 0], [0.12, 0.06, 0.4, 1], [-0.1, 0.08, 0.44, 2]] as const).slice(0, n)) {
      blade(m, x, z, hue * 1.3, 0.014, x, h, z, 0x76ab50);
      const colors = [[0x9a74d8, 0x8b64ca, 0xb79ae4], [0xc98ad8, 0xb877cc, 0xdba8e4], [0x7f8fe0, 0x6e7fd4, 0xa2aeea]][hue]!;
      // A spike of florets: stacked cones narrowing upwards, darker below.
      for (let i = 0; i < 3; i++) m.add(new ConeGeometry(0.06 - i * 0.014, 0.14, 5, 1, true), colors[i]!, at(x, h + i * 0.1, z, i), 0);
    }
    for (let i = 0; i < 5; i++) blade(m, 0.02, 0.02, i * 1.26, 0.03, 0.02 + Math.cos(i * 1.26) * 0.14, 0.07, 0.02 + Math.sin(i * 1.26) * 0.14, 0x7cb04e);
    return m.build({ ao: lowAO, normals: "up" });
  },
  lavender: (n = 7) => {
    const m = new Mesher();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const lean = 0.22 + (i % 3) * 0.06;
      const h = 0.4 + (i % 2) * 0.08;
      const tx = Math.sin(a) * (0.05 + h * lean);
      const tz = Math.cos(a) * (0.05 + h * lean);
      blade(m, Math.sin(a) * 0.05, Math.cos(a) * 0.05, a, 0.01, tx, h, tz, 0x8aa86a);
      m.add(new OctahedronGeometry(0.03, 0), i % 2 ? 0xb594e2 : 0xa27fd6, at(tx, h + 0.04, tz, a, [1, 2.6, 1], lean), 0);
    }
    return m.build({ ao: lowAO, normals: "up" });
  },
  buttercup: (n = 6) => {
    const m = new Mesher();
    for (const [x, z, h] of ([[0, 0, 0.3], [0.1, 0.08, 0.24], [-0.08, 0.1, 0.27], [0.06, -0.1, 0.21], [-0.11, -0.05, 0.18], [0.14, -0.03, 0.15]] as const).slice(0, n)) {
      blade(m, x, z, x * 11 + z, 0.01, x, h, z, 0x7fb24f);
      // A little cup: a cone upside down, its yellow rim facing the sky.
      m.add(new ConeGeometry(0.045, 0.04, 5), 0xf7d548, at(x, h + 0.015, z, x * 5, 1, 0, Math.PI), 0);
    }
    for (let i = 0; i < 3; i++) blade(m, 0, 0, i * 2.1, 0.035, Math.cos(i * 2.1) * 0.12, 0.05, Math.sin(i * 2.1) * 0.12, 0x86b955);
    return m.build({ ao: lowAO, normals: "up" });
  },
  campion: (n = 4) => {
    const m = new Mesher();
    for (const [x, z, h] of ([[0, 0, 0.38], [0.11, 0.06, 0.32], [-0.09, 0.08, 0.28], [0.03, -0.11, 0.25]] as const).slice(0, n)) {
      blade(m, x, z, x * 13, 0.011, x, h, z, 0x7aa84f);
      flowerHead(m, x, h, z, 0.065, 5, 0xf1a2b8, x * 4);
      m.add(new ConeGeometry(0.018, 0.02, 3), 0xc0607e, at(x, h + 0.008, z), 0);
    }
    blade(m, 0, 0, 1.1, 0.035, 0.1, 0.09, 0.05, 0x7fb24f);
    return m.build({ ao: lowAO, normals: "up" });
  },
  // ---- grass ----
  grass: () => {
    const m = new Mesher();
    // Six blades of a tuft.
    const blades: [number, number, number, number, number][] = [
      [0, 0, 0.55, 0.1, 0x9fca55],
      [1.1, 0.06, 0.45, 0.25, 0xb2d465],
      [2.2, 0.05, 0.5, 0.2, 0x8fbf4c],
      [3.3, 0.07, 0.38, 0.3, 0xaed15f],
      [4.4, 0.05, 0.47, 0.22, 0x98c752],
      [5.5, 0.04, 0.42, 0.28, 0xbbd96c],
    ];
    for (const [a, off, h, lean, color] of blades) {
      const bx = Math.sin(a) * off;
      const bz = Math.cos(a) * off;
      blade(m, bx, bz, a, 0.035, bx + Math.sin(a) * lean * h, h, bz + Math.cos(a) * lean * h, color);
    }
    return m.build({ ao: groundAO(0.55, 0.5, 1), normals: "up" });
  },
  lush: (seeds = 0) => {
    const m = new Mesher();
    // A low, dense clump: short blades bending out all round (and a stalk or two gone to seed).
    for (const [x, z, h] of ([[0.06, 0.02, 0.62], [-0.05, -0.04, 0.54]] as const).slice(0, seeds)) {
      blade(m, 0, 0, x * 20, 0.01, x, h, z, 0xb7c97a);
      m.add(new OctahedronGeometry(0.035, 0), 0xe6dca8, at(x, h + 0.05, z, x * 9, [1, 2.4, 1]), 0);
    }
    for (let i = 0; i < 8; i++) {
      const a = i * 2.39996;
      const off = 0.03 + 0.05 * fract(i * 0.618);
      const h = 0.22 + 0.1 * fract(i * 0.37);
      const lean = 0.5 + 0.3 * fract(i * 0.71);
      const bx = Math.sin(a) * off;
      const bz = Math.cos(a) * off;
      blade(m, bx, bz, a, 0.03, bx + Math.sin(a) * lean * h, h, bz + Math.cos(a) * lean * h, [0x8fc24c, 0x9fcd58, 0x83b847, 0xa9d262][i % 4]!);
    }
    return m.build({ ao: groundAO(0.55, 0.35, 1), normals: "up" });
  },
  // ---- underfoot ----
  clover: () => {
    const m = new Mesher();
    // Trefoils: three heart-ish leaflets each, flat to the ground, and two small blossoms.
    for (let i = 0; i < 5; i++) {
      const a = i * 2.4;
      const r = 0.06 + (i % 3) * 0.05;
      const cx = Math.sin(a) * r;
      const cz = Math.cos(a) * r;
      for (let l = 0; l < 3; l++) {
        const b = a + (l * Math.PI * 2) / 3;
        const tx = cx + Math.sin(b) * 0.07;
        const tz = cz + Math.cos(b) * 0.07;
        const px = Math.cos(b) * 0.03;
        const pz = -Math.sin(b) * 0.03;
        const mx = (cx + tx) / 2;
        const mz = (cz + tz) / 2;
        const color = (i + l) % 2 ? 0x7fb84c : 0x8cc254;
        // Facing up (counter-clockwise from above).
        m.triangles([cx, 0.05, cz, tx, 0.055, tz, mx + px, 0.06, mz + pz, cx, 0.05, cz, mx - px, 0.06, mz - pz, tx, 0.055, tz], color);
      }
    }
    m.add(new ConeGeometry(0.03, 0.05, 4), 0xf6f0f4, at(0.05, 0.11, 0.02), 0);
    m.add(new ConeGeometry(0.026, 0.045, 4), 0xf2c6dc, at(-0.08, 0.1, -0.06), 0);
    return m.build({ ao: groundAO(0.7, 0.12, 1), normals: "up" });
  },
  pebbles: () => {
    const m = new Mesher();
    for (const [x, z, r, color] of [[0, 0, 0.09, 0xcfc0b2], [0.16, 0.07, 0.06, 0xb9aea4], [-0.12, 0.1, 0.07, 0xdcccbc], [0.05, -0.15, 0.05, 0xc4b2a6]] as const) {
      m.add(chip(lumpy(new IcosahedronGeometry(r, 0), x * 31 + z, 0.25), x * 13 + 1, 1, 0.75), color, at(x, r * 0.35, z, x * 7, [1.2, 0.6, 1]), 0.06);
    }
    return m.build({ ao: groundAO(0.7, 0.08, 0.8) });
  },
};

/** Two built models as one (a patch of two kinds of flower), the second moved by (dx, dz). */
function together(a: BufferGeometry, b: BufferGeometry, dx: number, dz: number): BufferGeometry {
  const out = new BufferGeometry();
  for (const name of ["position", "color", "normal"] as const) {
    const pa = a.getAttribute(name).array as Float32Array;
    const pb = (b.getAttribute(name).array as Float32Array).slice();
    if (name === "position") {
      for (let i = 0; i < pb.length; i += 3) {
        pb[i] = pb[i]! + dx;
        pb[i + 2] = pb[i + 2]! + dz;
      }
    }
    const merged = new Float32Array(pa.length + pb.length);
    merged.set(pa);
    merged.set(pb, pa.length);
    out.setAttribute(name, new BufferAttribute(merged, 3));
  }
  a.dispose();
  b.dispose();
  out.computeBoundingSphere();
  return out;
}

/** Triangles in each tree's models, near to far (for the budgets). */
export function treeTriangles(): Record<(typeof TREE_KINDS)[number], [number, number]> {
  const out = {} as Record<(typeof TREE_KINDS)[number], [number, number]>;
  for (const k of TREE_KINDS) {
    const near = models[k](1);
    const mid = models[k](0);
    out[k] = [near.getAttribute("position").count / 3, mid.getAttribute("position").count / 3];
    near.dispose();
    mid.dispose();
  }
  return out;
}

/** The levels of detail a tree can be drawn at: near (many small facets), farther (simpler), far (a few facets). */
export const NEAR = 0;
export const MID = 1;
export const FAR = 2;

/**
 * Which level of detail a chunk's trees are drawn at, by its distance `d` from
 * the focus (its centre, metres) and the tier's distances: near within `near`,
 * the simpler model within `lod`, the far one beyond. A chunk keeps the level it
 * has (`current`) a little past the edge, so it doesn't flip back and forth.
 * A tier without near trees (`near` 0) never draws them.
 */
export function treeBand(d: number, current: number, near: number, lod: number): number {
  const within = (edge: number, inside: boolean) => d < edge + CHUNK * (inside ? 1.1 : 0.7);
  if (near > 0 && within(near, current === NEAR)) return NEAR;
  if (within(lod, current <= MID)) return MID;
  return FAR;
}

/** What a mesh draws: which layer, which placement kinds, and (for trees) at which levels of detail. */
interface Kind {
  layer: Layer;
  kinds: readonly number[] | null;
  /** Which levels of detail it's drawn at, as bits (1 near, 2 mid, 4 far). */
  bands: number;
  mesh: InstancedMesh;
  matrices: Float32Array;
  colors: Float32Array;
  /** Instances per page, and which pages are taken. */
  page: number;
  used: Uint8Array;
  top: number;
  live: number;
  /** A colour range a fresh instance can tint within: [brightness spread, warmth]. */
  tint: [number, number];
}

/** One chunk's share of the instances. */
interface Grown {
  chunk: Chunk;
  /** Pages held, per kind (index into kinds). */
  pages: number[][];
  counts: number[];
  big: boolean;
  small: boolean;
  /** Its trees' level of detail. */
  band: number;
  dist: number;
}

const ZERO16 = new Float32Array(16);
const ALL = 7;

export class Vegetation {
  private readonly kinds: Kind[] = [];
  private readonly contact: Kind;
  private readonly grown = new Map<Chunk, Grown>();
  private readonly order: Grown[] = [];
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly q2 = new Quaternion();
  private readonly up = new Vector3(0, 1, 0);
  private readonly n = new Vector3();
  private readonly v = new Vector3();
  private readonly s = new Vector3();
  private grassOn: boolean;
  private anchorX = 0;
  private anchorY = 0;
  private focusX = Number.NaN;
  private focusY = Number.NaN;
  private readonly byDistance = (a: Grown, b: Grown): number => a.dist - b.dist;
  private readonly materials: (MeshLambertNodeMaterial | MeshBasicNodeMaterial)[] = [];

  constructor(
    private readonly root: Group,
    private readonly tier: Tier,
    /** The ground's height (world), for tilting contact shadows to the slope. */
    private readonly height: (x: number, y: number) => number,
    /** Grows a chunk's small layer on demand. */
    private readonly smallLayer: (chunk: Chunk, layer: Layer) => Float64Array,
  ) {
    const material = (stiffness: number, mask: boolean): MeshLambertNodeMaterial => {
      const mat = new MeshLambertNodeMaterial({ vertexColors: true });
      if (stiffness > 0) mat.positionNode = swaying(stiffness);
      if (mask) mat.maskNode = occlusionMask();
      this.materials.push(mat);
      return mat;
    };
    const tree = material(0.0032, true);
    const bush = material(0.045, true);
    const rock = material(0, true);
    const small = material(0.32, false);
    const pebble = material(0, false);
    const make = (geometry: BufferGeometry, mat: MeshLambertNodeMaterial | MeshBasicNodeMaterial, cap: number, layer: Layer, kinds: readonly number[] | null, page: number, bands: number, shadow: boolean, tint: [number, number]): Kind => {
      const pages = Math.max(1, Math.ceil(cap / page));
      const mesh = new InstancedMesh(geometry, mat, pages * page);
      // Static usage on purpose: three.js re-uploads a dynamic buffer whole every frame, while a static one
      // is uploaded only when it changes, and then only the pages touched (their update ranges).
      mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(pages * page * 3), 3);
      mesh.count = 0;
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.castShadow = shadow;
      mesh.receiveShadow = tier.shadows;
      root.add(mesh);
      const k: Kind = { layer, kinds, bands, mesh, matrices: mesh.instanceMatrix.array as Float32Array, colors: mesh.instanceColor.array as Float32Array, page, used: new Uint8Array(pages), top: 0, live: 0, tint };
      this.kinds.push(k);
      return k;
    };
    const shadows = tier.shadows;
    // A layer's cap is shared among its kinds, each by about its share of the layer (the small layers' shares add up to
    // the layer's cap exactly; the big ones' leave a little slack).
    const cap = (total: number, share: number) => Math.ceil(total * share);
    // Trees: near models (only on tiers that draw them), simpler ones farther, and three far ones.
    const tints: [number, number][] = [[0.12, 0.06], [0.1, 0], [0.12, 0.08], [0.1, 0.06], [0.1, 0.04], [0.08, 0.02]];
    const shares = [0.36, 0.32, 0.14, 0.14, 0.2, 0.12];
    TREE_KINDS.forEach((name, i) => {
      if (tier.treeDetail > 0) make(models[name](1), tree, cap(tier.trees, shares[i]! * 0.5), "trees", [i], 4, 1 << NEAR, shadows, tints[i]!);
      // Farther off, a round tree is drawn as a small oak (one draw call fewer; at that distance they're alike).
      if (name === "round") return;
      make(models[name](0), tree, cap(tier.trees, shares[i]! + (name === "oak" ? shares[2]! : 0)), "trees", name === "oak" ? [0, 2] : [i], 8, 1 << MID, shadows, tints[i]!);
    });
    make(models.farBroad(), tree, cap(tier.trees, 0.8), "trees", [0, 2, 3, 4], 16, 1 << FAR, false, [0.12, 0.06]);
    make(models.farConifer(), tree, cap(tier.trees, 0.32), "trees", [1], 16, 1 << FAR, false, [0.1, 0]);
    make(models.farBlossom(), tree, cap(tier.trees, 0.12), "trees", [5], 8, 1 << FAR, false, [0.08, 0.02]);
    // Bushes: leafy, in flower, and ferns under the trees.
    make(models.bush(), bush, cap(tier.bushes, 0.85), "bushes", [0, 1], 8, ALL, false, [0.12, 0.05]);
    make(models.fern(), bush, cap(tier.bushes, 0.3), "bushes", [2], 4, ALL, false, [0.12, 0.04]);
    // Rocks: a boulder with a stone beside it, or a layered slab.
    make(models.boulder(), rock, cap(tier.rocks, 0.75), "rocks", [0, 1], 4, ALL, shadows, [0.1, 0.03]);
    make(models.slab(), rock, cap(tier.rocks, 0.4), "rocks", [2], 4, ALL, shadows, [0.1, 0.03]);
    // Flowers in mixed patches (fewer draw calls): daisies with buttercups; lupines, campions and lavender.
    make(together(models.daisy(3), models.buttercup(3), 0.24, 0.08), small, cap(tier.flowers, 0.5), "flowers", [0, 3], 16, ALL, false, [0.06, 0.02]);
    make(together(together(models.lupine(2), models.campion(2), -0.2, 0.14), models.lavender(4), 0.16, -0.18), small, cap(tier.flowers, 0.5), "flowers", [1, 2, 4], 16, ALL, false, [0.08, 0.02]);
    // Grass: tufts, and lush clumps with a stalk gone to seed (the layer's cap split between them, as it was one).
    make(models.grass(), small, cap(tier.grass, 0.55), "grass", [0], 32, ALL, false, [0.16, 0.08]);
    make(models.lush(1), small, cap(tier.grass, 0.45), "grass", [1, 2], 32, ALL, false, [0.14, 0.07]);
    make(models.pebbles(), pebble, cap(tier.detail, 0.5), "detail", [0], 16, ALL, false, [0.1, 0.02]);
    make(models.clover(), small, cap(tier.detail, 0.5), "detail", [1], 16, ALL, false, [0.1, 0.04]);
    // Contact shadows: a soft dark disc under every tree, bush and rock.
    const disc = new CircleGeometry(1, 12).rotateX(-Math.PI / 2);
    const shade = new MeshBasicNodeMaterial({ color: 0x1f2a10, transparent: true, depthWrite: false });
    shade.opacityNode = float(1).sub(smoothstep(0.15, 1, length(positionGeometry.xz))).mul(0.34);
    shade.polygonOffset = true;
    shade.polygonOffsetFactor = -2;
    shade.polygonOffsetUnits = -2;
    this.materials.push(shade);
    this.contact = make(disc, shade, tier.trees + tier.bushes + tier.rocks, "trees", null, 16, ALL, false, [0, 0]);
    this.contact.mesh.renderOrder = 1;
    this.grassOn = tier.grass > 0;
  }

  /** A chunk was grown: it's filled over the next frames, nearest first. */
  addChunk(chunk: Chunk): void {
    const g: Grown = { chunk, pages: this.kinds.map(() => []), counts: this.kinds.map(() => 0), big: false, small: false, band: FAR, dist: dist(chunk, this.focusX, this.focusY) };
    this.grown.set(chunk, g);
    this.order.push(g);
  }

  /** A chunk was dropped: its pages are zeroed and freed. */
  removeChunk(chunk: Chunk): void {
    const g = this.grown.get(chunk);
    if (!g) return;
    for (let k = 0; k < this.kinds.length; k++) this.release(g, k);
    this.grown.delete(chunk);
    this.order.splice(this.order.indexOf(g), 1);
  }

  /** The governor's last resort: no more grass, flowers or pebbles. */
  dropGrass(): void {
    this.grassOn = false;
  }

  /**
   * Brings the instances up to date for the focus: fills new chunks, grows the
   * small things near the focus (and lets them go farther off), swaps trees
   * between their levels of detail. Works until `deadline` (performance.now()),
   * nearest chunks first, at least one step a call. Returns true while work is left.
   */
  update(focusX: number, focusY: number, deadline: number): boolean {
    const moved = !(Math.abs(focusX - this.focusX) < 4 && Math.abs(focusY - this.focusY) < 4);
    if (moved) {
      this.focusX = focusX;
      this.focusY = focusY;
      for (let i = 0; i < this.order.length; i++) this.order[i]!.dist = dist(this.order[i]!.chunk, focusX, focusY);
      this.order.sort(this.byDistance);
    }
    const grassR = this.grassOn ? this.tier.grassRadius : -1e9;
    let pending = false;
    let worked = false;
    for (let i = 0; i < this.order.length; i++) {
      const g = this.order[i]!;
      // Hysteresis, so a chunk on an edge doesn't flip back and forth.
      const wantSmall = g.small ? g.dist < grassR + CHUNK * 1.1 : g.dist < grassR + CHUNK * 0.7;
      const wantBand = treeBand(g.dist, g.big ? g.band : FAR, this.tier.treeDetail, this.tier.treeLod);
      if (g.big && g.small === wantSmall && g.band === wantBand) continue;
      if (worked && performance.now() > deadline) {
        pending = true;
        break;
      }
      worked = true;
      if (!g.big || g.band !== wantBand) {
        g.band = wantBand;
        this.fillBig(g);
      }
      if (g.small !== wantSmall) {
        g.small = wantSmall;
        this.fillSmall(g);
      }
    }
    return pending;
  }

  /** Trees (at the chunk's level of detail), bushes, rocks and their contact shadows. */
  private fillBig(g: Grown): void {
    const layers = g.chunk.samples.layers;
    for (let k = 0; k < this.kinds.length; k++) {
      const kind = this.kinds[k]!;
      if (kind === this.contact || (kind.layer !== "trees" && kind.layer !== "bushes" && kind.layer !== "rocks")) continue;
      const draws = (kind.bands & (1 << g.band)) !== 0;
      // Bushes and rocks are the same at every level: written once.
      if (kind.bands === ALL && g.big) continue;
      this.release(g, k);
      if (draws) this.fill(g, k, layers[kind.layer]!);
    }
    if (!g.big) {
      this.fillContact(g);
      g.big = true;
    }
  }

  private fillSmall(g: Grown): void {
    for (let k = 0; k < this.kinds.length; k++) {
      const kind = this.kinds[k]!;
      if (!SMALL.includes(kind.layer)) continue;
      this.release(g, k);
      if (g.small) this.fill(g, k, this.smallLayer(g.chunk, kind.layer));
    }
  }

  private matches(kind: Kind, placementKind: number): boolean {
    return kind.kinds === null || kind.kinds.includes(placementKind);
  }

  /** Writes a chunk's placements of one kind into fresh pages. */
  private fill(g: Grown, k: number, packed: Float64Array): void {
    const kind = this.kinds[k]!;
    let n = 0;
    for (let i = 0; i < packed.length; i += STRIDE) if (this.matches(kind, packed[i + 5]!)) n++;
    if (!n) return;
    const pages = g.pages[k]!;
    let slot = -1;
    let left = 0;
    let written = 0;
    const rocks = kind.layer === "rocks";
    for (let i = 0; i < packed.length; i += STRIDE) {
      if (!this.matches(kind, packed[i + 5]!)) continue;
      if (left === 0) {
        const page = this.allocate(kind);
        if (page < 0) break; // the tier's cap: this chunk goes without the rest
        pages.push(page);
        slot = page * kind.page;
        left = kind.page;
      }
      const x = packed[i]!;
      const y = packed[i + 1]!;
      const scale = packed[i + 3]!;
      const z = packed[i + 2]! - (rocks ? 0.14 * scale : 0.04);
      this.v.set(x - this.anchorX, z, -(y - this.anchorY));
      this.q.setFromAxisAngle(this.up, packed[i + 4]!);
      if (rocks) this.s.set(scale, scale * (0.75 + 0.12 * packed[i + 5]!), scale);
      else this.s.setScalar(scale);
      this.m.compose(this.v, this.q, this.s);
      this.m.toArray(kind.matrices, slot * 16);
      // A per-plant tint from where it stands: a little lighter or darker, a little warmer or not.
      const h = fract(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453);
      const h2 = fract(h * 7.31);
      const b = 1 - kind.tint[0] + 2 * kind.tint[0] * h;
      const warm = kind.tint[1] * (h2 - 0.5) * 2;
      kind.colors[slot * 3] = b * (1 + warm);
      kind.colors[slot * 3 + 1] = b;
      kind.colors[slot * 3 + 2] = b * (1 - warm);
      slot++;
      left--;
      written++;
    }
    // The rest of the last page draws nothing.
    for (; left > 0; left--, slot++) kind.matrices.set(ZERO16, slot * 16);
    for (const page of pages) this.touch(kind, page);
    g.counts[k] = written;
    kind.live += written;
    this.refreshCount(kind);
  }

  /** A soft shadow under each tree, bush and rock of the chunk, tilted to the slope. */
  private fillContact(g: Grown): void {
    const k = this.kinds.indexOf(this.contact);
    const kind = this.contact;
    const pages = g.pages[k]!;
    let slot = -1;
    let left = 0;
    let written = 0;
    const layers = g.chunk.samples.layers;
    outer: for (const layer of ["trees", "bushes", "rocks"] as const) {
      const packed = layers[layer]!;
      for (let i = 0; i < packed.length; i += STRIDE) {
        const x = packed[i]!;
        const y = packed[i + 1]!;
        const scale = packed[i + 3]!;
        const kindOf = packed[i + 5]!;
        if (left === 0) {
          const page = this.allocate(kind);
          if (page < 0) break outer;
          pages.push(page);
          slot = page * kind.page;
          left = kind.page;
        }
        const r = layer === "trees" ? (TREE_SHADOW[kindOf] ?? 2) * scale : layer === "bushes" ? (kindOf === 2 ? 0.8 : 1.05) * scale : (kindOf === 2 ? 1.5 : 1.25) * scale;
        // The ground's slope here, so the disc lies on it rather than floating off it.
        const dx = this.height(x + 1, y) - this.height(x - 1, y);
        const dy = this.height(x, y + 1) - this.height(x, y - 1);
        this.n.set(-dx / 2, 1, dy / 2).normalize();
        this.q.setFromUnitVectors(this.up, this.n);
        this.q2.setFromAxisAngle(this.up, packed[i + 4]!);
        this.q.multiply(this.q2);
        this.v.set(x - this.anchorX, packed[i + 2]! + 0.03, -(y - this.anchorY));
        this.s.set(r, 1, r * (layer === "rocks" ? 0.8 : 1));
        this.m.compose(this.v, this.q, this.s);
        this.m.toArray(kind.matrices, slot * 16);
        kind.colors[slot * 3] = kind.colors[slot * 3 + 1] = kind.colors[slot * 3 + 2] = 1;
        slot++;
        left--;
        written++;
      }
    }
    for (; left > 0; left--, slot++) kind.matrices.set(ZERO16, slot * 16);
    for (const page of pages) this.touch(kind, page);
    g.counts[k] = written;
    kind.live += written;
    this.refreshCount(kind);
  }

  private allocate(kind: Kind): number {
    for (let p = 0; p < kind.used.length; p++) {
      if (kind.used[p]) continue;
      kind.used[p] = 1;
      if (p + 1 > kind.top) kind.top = p + 1;
      return p;
    }
    return -1;
  }

  /** Zeroes and frees a chunk's pages of one kind. */
  private release(g: Grown, k: number): void {
    const kind = this.kinds[k]!;
    const pages = g.pages[k]!;
    if (!pages.length) return;
    for (const page of pages) {
      kind.matrices.fill(0, page * kind.page * 16, (page + 1) * kind.page * 16);
      kind.used[page] = 0;
      this.touch(kind, page);
    }
    pages.length = 0;
    kind.live -= g.counts[k]!;
    g.counts[k] = 0;
    while (kind.top > 0 && !kind.used[kind.top - 1]) kind.top--;
    this.refreshCount(kind);
  }

  /** Uploads one page (only it) next frame. */
  private touch(kind: Kind, page: number): void {
    kind.mesh.instanceMatrix.addUpdateRange(page * kind.page * 16, kind.page * 16);
    kind.mesh.instanceMatrix.needsUpdate = true;
    const color = kind.mesh.instanceColor!;
    color.addUpdateRange(page * kind.page * 3, kind.page * 3);
    color.needsUpdate = true;
  }

  private refreshCount(kind: Kind): void {
    kind.mesh.count = kind.top * kind.page;
    kind.mesh.visible = kind.live > 0;
  }

  /** Instances drawn now, per layer (for the stats). */
  counts(): Record<Layer, number> {
    const out: Record<Layer, number> = { trees: 0, bushes: 0, rocks: 0, flowers: 0, grass: 0, detail: 0 };
    for (const k of this.kinds) if (k !== this.contact) out[k.layer] += k.live;
    return out;
  }

  /** Triangles drawn now (instances as drawn, the empty ends of their pages too), for the budgets. */
  triangles(): number {
    let n = 0;
    for (const k of this.kinds) {
      const g = k.mesh.geometry;
      if (k.mesh.visible) n += (k.mesh.count * (g.index ?? g.getAttribute("position")).count) / 3;
    }
    return n;
  }

  /**
   * The floating origin moved. Instances are written relative to an anchor, so
   * nothing moves; only far from it (where float precision would start to show)
   * is everything rewritten round the new origin.
   */
  place(originX: number, originY: number): void {
    if (Math.hypot(originX - this.anchorX, originY - this.anchorY) > 4096) {
      this.anchorX = originX;
      this.anchorY = originY;
      for (let k = 0; k < this.kinds.length; k++) {
        const kind = this.kinds[k]!;
        kind.matrices.fill(0);
        kind.used.fill(0);
        kind.top = 0;
        kind.live = 0;
        kind.mesh.instanceMatrix.clearUpdateRanges();
        kind.mesh.instanceColor!.clearUpdateRanges();
        kind.mesh.instanceMatrix.needsUpdate = true;
        kind.mesh.instanceColor!.needsUpdate = true;
        this.refreshCount(kind);
      }
      for (const g of this.order) {
        for (const p of g.pages) p.length = 0;
        g.counts.fill(0);
        g.big = g.small = false;
      }
    }
    for (const k of this.kinds) k.mesh.position.set(this.anchorX, 0, -this.anchorY);
  }

  dispose(): void {
    for (const k of this.kinds) {
      k.mesh.removeFromParent();
      k.mesh.geometry.dispose();
      k.mesh.dispose();
    }
    for (const m of this.materials) m.dispose();
    this.grown.clear();
    this.order.length = 0;
  }
}

/** Each tree's contact shadow's radius (by kind, before its scale). */
const TREE_SHADOW = [2.2, 1.7, 1.7, 2.6, 1.3, 1.9];

const fract = (x: number): number => x - Math.floor(x);
const dist = (c: Chunk, x: number, y: number): number => (Number.isNaN(x) ? 0 : Math.hypot((c.cx + 0.5) * CHUNK - x, (c.cy + 0.5) * CHUNK - y));
