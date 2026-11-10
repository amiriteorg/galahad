import { cos, float, length, positionGeometry, positionLocal, sin, smoothstep, time, uniform, vec3 } from "three/tsl";
import {
  BoxGeometry,
  type BufferGeometry,
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
import { type AmbientOcclusion, at, between, groundAO, lumpy, Mesher } from "./mesher.ts";
import { occlusionMask } from "./occlusion.ts";
import { CHUNK, type Layer, SMALL, STRIDE } from "./terrain.ts";
import type { Tier } from "./tiers.ts";

/*
 * Everything that grows: broadleaf, parasol and round trees with faceted brown
 * trunks and layered lime canopies, dark conifers, bushes, warm pinkish boulders,
 * and underfoot grass tufts, daisies, lupines, lavender, clover and pebbles. Each
 * model is one instanced mesh (a draw call); trees far from the camera use a
 * simpler model. A soft contact shadow sits under every tree, bush and rock.
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
const ROCK = 0xdac3b3;
const ROCK_WARM = 0xd2b4a6;
const ROCK_PALE = 0xe6d6c8;

const treeAO: AmbientOcclusion = groundAO(0.52, 1.8, 0.7);
const lowAO: AmbientOcclusion = groundAO(0.5, 0.45, 0.8);

type Cluster = [x: number, y: number, z: number, r: number, color: number];

/** A faceted trunk with a root flare, forking into branches that end in clusters of faceted leaves. */
function crownTree(trunkH: number, trunkR: number, lean: number, clusters: Cluster[], branches: number, squash = 0.82): BufferGeometry {
  const m = new Mesher();
  // The trunk in two tapering pieces, leaning a little, so it isn't a pole.
  const midX = lean * 0.5;
  const topX = lean;
  m.add(new CylinderGeometry(trunkR * 0.8, trunkR, trunkH * 0.55, 7), TRUNK, between(0, 0, 0, midX, trunkH * 0.55, 0, 1), 0.12);
  m.add(new CylinderGeometry(trunkR * 0.6, trunkR * 0.8, trunkH * 0.5, 7), TRUNK, between(midX, trunkH * 0.53, 0, topX, trunkH, 0, 1), 0.12);
  // Roots: wedges splaying out at the foot.
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.4;
    m.add(new ConeGeometry(trunkR * 0.55, trunkR * 2.6, 4), TRUNK_DARK, between(Math.sin(a) * trunkR * 1.5, 0.02, Math.cos(a) * trunkR * 1.5, Math.sin(a) * trunkR * 0.2, trunkR * 1.9, Math.cos(a) * trunkR * 0.2, 1), 0.1);
  }
  for (const [x, y, z] of clusters.slice(0, branches)) {
    m.add(new CylinderGeometry(trunkR * 0.28, trunkR * 0.48, 1, 5), TRUNK, between(topX, trunkH * 0.92, 0, x * 0.8, y - 0.35, z * 0.8, 1), 0.1);
  }
  for (const [x, y, z, r, color] of clusters) m.add(new IcosahedronGeometry(r, 0), color, at(x, y, z, x * 1.7 + z, [1, squash, 1]), 0.1);
  return m.build({ ao: treeAO });
}

const models = {
  broadleaf: () =>
    crownTree(2.6, 0.34, 0.25, [
      [1.15, 3.7, 0.25, 1.25, LIME_DEEP],
      [-1.05, 3.55, -0.35, 1.2, LIME],
      [0.15, 3.85, -1.1, 1.15, LEAF_SHADE],
      [-0.35, 3.5, 1.05, 1.05, LIME_DEEP],
      [0.65, 4.55, 0.6, 1.15, LIME_TOP],
      [-0.6, 4.6, -0.4, 1.1, LIME],
      [0.9, 4.35, -0.75, 0.95, LIME_TOP],
      [0.1, 5.2, 0.05, 1.0, LIME_TOP],
    ], 3),
  round: () =>
    crownTree(1.7, 0.26, -0.15, [
      [0.55, 2.7, 0.1, 0.95, LIME],
      [-0.55, 2.6, 0.25, 0.9, LIME_DEEP],
      [0.05, 2.75, -0.6, 0.9, LEAF_SHADE],
      [0.15, 3.35, 0.2, 0.95, LIME_TOP],
    ], 2),
  parasol: () =>
    crownTree(3.1, 0.3, 0.55, [
      [1.9, 3.9, 0.4, 1.15, LIME],
      [-1.5, 3.8, -0.6, 1.1, LIME_DEEP],
      [0.3, 4.0, -1.7, 1.05, LEAF_SHADE],
      [-0.4, 3.95, 1.6, 1.05, LIME],
      [0.6, 4.4, 0.1, 1.25, LIME_TOP],
      [-1.0, 4.3, 0.6, 0.9, LIME_TOP],
    ], 4, 0.6),
  conifer: () => {
    const m = new Mesher().add(new CylinderGeometry(0.13, 0.24, 1.4, 6), TRUNK, at(0, 0.7, 0), 0.1);
    const tiers: [number, number, number, number][] = [
      [1.55, 1.9, 1.9, PINE],
      [1.25, 1.8, 2.85, PINE_LIGHT],
      [0.95, 1.6, 3.75, PINE],
      [0.6, 1.4, 4.6, PINE_LIGHT],
    ];
    tiers.forEach(([r, h, y, color], i) => m.add(new ConeGeometry(r, h, 8), color, at(0, y, 0, i * 0.7), 0.08));
    return m.build({ ao: treeAO });
  },
  farBroad: () =>
    new Mesher()
      .add(new CylinderGeometry(0.2, 0.32, 2.6, 5), TRUNK, at(0.1, 1.3, 0), 0.1)
      .add(new IcosahedronGeometry(1.6, 0), LIME_DEEP, at(0.3, 3.7, 0, 0, [1, 0.8, 1]), 0.08)
      .add(new IcosahedronGeometry(1.4, 0), LIME, at(-0.4, 4.3, 0.2, 1, [1, 0.8, 1]), 0.08)
      .add(new IcosahedronGeometry(1.1, 0), LIME_TOP, at(0.2, 4.9, -0.3, 2, [1, 0.8, 1]), 0.08)
      .build({ ao: treeAO }),
  farConifer: () =>
    new Mesher()
      .add(new CylinderGeometry(0.14, 0.22, 1.4, 5), TRUNK, at(0, 0.7, 0), 0.1)
      .add(new ConeGeometry(1.5, 2.9, 6), PINE, at(0, 2.4, 0), 0.08)
      .add(new ConeGeometry(1.0, 2.4, 6), PINE_LIGHT, at(0, 3.9, 0, 0.5), 0.08)
      .build({ ao: treeAO }),
  bush: () =>
    new Mesher()
      .add(new IcosahedronGeometry(0.62, 0), LIME_DEEP, at(0, 0.42, 0, 0, [1.25, 0.8, 1]), 0.1)
      .add(new IcosahedronGeometry(0.46, 0), LIME, at(0.48, 0.38, 0.18, 0.7, [1, 0.85, 1]), 0.1)
      .add(new IcosahedronGeometry(0.42, 0), LIME_TOP, at(-0.38, 0.36, -0.22, 1.3, [1, 0.85, 1]), 0.1)
      .add(new IcosahedronGeometry(0.36, 0), LEAF_SHADE, at(0.1, 0.3, 0.5, 2.1, [1, 0.8, 1]), 0.1)
      .build({ ao: groundAO(0.55, 0.9, 0.72) }),
  boulder: () =>
    new Mesher()
      .add(lumpy(new IcosahedronGeometry(0.9, 1), 3, 0.16), ROCK, at(0, 0.32, 0, 0, [1.3, 0.78, 1.08]), 0.07)
      .add(lumpy(new IcosahedronGeometry(0.42, 0), 5, 0.2), ROCK_WARM, at(0.85, 0.1, 0.35, 0.8), 0.08)
      .build({ ao: groundAO(0.55, 0.9, 0.7) }),
  rocks: () =>
    new Mesher()
      .add(lumpy(new IcosahedronGeometry(0.7, 0), 7, 0.2), ROCK_PALE, at(0, 0.28, 0, 0, [1.25, 0.8, 1.1]), 0.08)
      .add(lumpy(new IcosahedronGeometry(0.5, 0), 9, 0.22), ROCK_WARM, at(0.75, 0.16, -0.2, 0.9, [1.1, 0.75, 1]), 0.08)
      .add(lumpy(new IcosahedronGeometry(0.34, 0), 11, 0.22), ROCK, at(-0.55, 0.1, 0.5, 1.7), 0.08)
      .build({ ao: groundAO(0.55, 0.7, 0.7) }),
  daisy: () => {
    const m = new Mesher();
    for (const [x, z, h] of [[0, 0, 0.36], [0.13, 0.07, 0.29], [-0.09, 0.11, 0.25], [0.05, -0.12, 0.31]] as const) {
      m.add(new BoxGeometry(0.022, h, 0.022), 0x78ad52, at(x, h / 2, z), 0);
      m.add(new CylinderGeometry(0.08, 0.07, 0.018, 8), 0xfdfcf6, at(x, h, z, x * 9, 1, 0.25), 0);
      m.add(new CylinderGeometry(0.03, 0.03, 0.03, 6), 0xf4c143, at(x, h + 0.012, z, 0, 1, 0.25), 0);
    }
    m.add(new ConeGeometry(0.1, 0.16, 4), 0x82b450, at(0, 0.06, 0), 0);
    return m.build({ ao: lowAO, normals: "up" });
  },
  lupine: () => {
    const m = new Mesher();
    for (const [x, z, h, hue] of [[0, 0, 0.5, 0], [0.12, 0.06, 0.4, 1], [-0.1, 0.08, 0.44, 2]] as const) {
      m.add(new BoxGeometry(0.026, h, 0.026), 0x76ab50, at(x, h / 2, z), 0);
      const colors = [[0x9a74d8, 0x8b64ca], [0xc98ad8, 0xb877cc], [0x7f8fe0, 0x6e7fd4]][hue]!;
      for (let i = 0; i < 5; i++) m.add(new OctahedronGeometry(0.068 - i * 0.008, 0), colors[i % 2]!, at(x, h - 0.02 + i * 0.075, z, i), 0);
    }
    m.add(new ConeGeometry(0.12, 0.2, 5), 0x7cb04e, at(0.03, 0.08, 0.02, 0, 1, 0.3), 0);
    return m.build({ ao: lowAO, normals: "up" });
  },
  lavender: () => {
    const m = new Mesher();
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const lean = 0.22 + (i % 3) * 0.06;
      const h = 0.4 + (i % 2) * 0.08;
      m.add(new BoxGeometry(0.016, h, 0.016), 0x8aa86a, at(Math.sin(a) * 0.05, h / 2, Math.cos(a) * 0.05, a, 1, lean), 0);
      m.add(new BoxGeometry(0.038, 0.15, 0.038), i % 2 ? 0xb594e2 : 0xa27fd6, at(Math.sin(a) * (0.05 + h * lean), h, Math.cos(a) * (0.05 + h * lean), a, 1, lean), 0);
    }
    return m.build({ ao: lowAO, normals: "up" });
  },
  grass: () => {
    const m = new Mesher();
    // Six blades, each a thin triangle both ways round (so both faces shade like the ground).
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
      const w = 0.035;
      const px = Math.cos(a) * w;
      const pz = -Math.sin(a) * w;
      const tx = bx + Math.sin(a) * lean * h;
      const tz = bz + Math.cos(a) * lean * h;
      m.triangles([bx - px, 0, bz - pz, bx + px, 0, bz + pz, tx, h, tz, bx + px, 0, bz + pz, bx - px, 0, bz - pz, tx, h, tz], color);
    }
    return m.build({ ao: groundAO(0.55, 0.5, 1), normals: "up" });
  },
  clover: () => {
    const m = new Mesher();
    for (let i = 0; i < 6; i++) {
      const a = i * 2.4;
      const r = 0.06 + (i % 3) * 0.05;
      for (let l = 0; l < 3; l++) {
        const b = a + (l * Math.PI * 2) / 3;
        m.add(new OctahedronGeometry(0.04, 0), i % 2 ? 0x7fb84c : 0x8cc254, at(Math.sin(a) * r + Math.sin(b) * 0.035, 0.06, Math.cos(a) * r + Math.cos(b) * 0.035, b, [1, 0.3, 1]), 0);
      }
    }
    m.add(new IcosahedronGeometry(0.035, 0), 0xf6f0f4, at(0.05, 0.11, 0.02), 0);
    m.add(new IcosahedronGeometry(0.03, 0), 0xf2c6dc, at(-0.08, 0.1, -0.06), 0);
    return m.build({ ao: groundAO(0.7, 0.12, 1), normals: "up" });
  },
  pebbles: () => {
    const m = new Mesher();
    for (const [x, z, r, color] of [[0, 0, 0.09, 0xcfc0b2], [0.16, 0.07, 0.06, 0xb9aea4], [-0.12, 0.1, 0.07, 0xdcccbc], [0.05, -0.15, 0.05, 0xc4b2a6]] as const) {
      m.add(lumpy(new IcosahedronGeometry(r, 0), x * 31 + z, 0.25), color, at(x, r * 0.35, z, x * 7, [1.2, 0.6, 1]), 0.06);
    }
    return m.build({ ao: groundAO(0.7, 0.08, 0.8) });
  },
};

/** What a mesh draws: which layer, which placement kinds, and (for trees) near or far. */
interface Kind {
  layer: Layer;
  kinds: readonly number[] | null;
  /** 0: always; 1: only near the focus; 2: only far from it. */
  lod: 0 | 1 | 2;
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
  near: boolean;
  dist: number;
}

const ZERO16 = new Float32Array(16);

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
    const make = (geometry: BufferGeometry, mat: MeshLambertNodeMaterial | MeshBasicNodeMaterial, cap: number, layer: Layer, kinds: readonly number[] | null, page: number, lod: 0 | 1 | 2, shadow: boolean, tint: [number, number]): Kind => {
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
      const k: Kind = { layer, kinds, lod, mesh, matrices: mesh.instanceMatrix.array as Float32Array, colors: mesh.instanceColor.array as Float32Array, page, used: new Uint8Array(pages), top: 0, live: 0, tint };
      this.kinds.push(k);
      return k;
    };
    const shadows = tier.shadows;
    // Trees: kind 0 broadleaf, 1 conifer, 2 round, 3 parasol; near models and two simpler far ones.
    make(models.broadleaf(), tree, tier.trees, "trees", [0], 8, 1, shadows, [0.12, 0.06]);
    make(models.conifer(), tree, tier.trees, "trees", [1], 8, 1, shadows, [0.1, 0]);
    make(models.round(), tree, tier.trees, "trees", [2], 8, 1, shadows, [0.12, 0.08]);
    make(models.parasol(), tree, tier.trees, "trees", [3], 8, 1, shadows, [0.1, 0.06]);
    make(models.farBroad(), tree, tier.trees, "trees", [0, 2, 3], 16, 2, false, [0.12, 0.06]);
    make(models.farConifer(), tree, tier.trees, "trees", [1], 16, 2, false, [0.1, 0]);
    make(models.bush(), bush, tier.bushes, "bushes", null, 8, 0, false, [0.14, 0.05]);
    make(models.boulder(), rock, tier.rocks, "rocks", [0, 2], 4, 0, shadows, [0.1, 0.03]);
    make(models.rocks(), rock, tier.rocks, "rocks", [1], 4, 0, shadows, [0.1, 0.03]);
    make(models.daisy(), small, tier.flowers, "flowers", [0], 32, 0, false, [0.06, 0]);
    make(models.lupine(), small, tier.flowers, "flowers", [1], 32, 0, false, [0.08, 0]);
    make(models.lavender(), small, tier.flowers, "flowers", [2], 32, 0, false, [0.08, 0]);
    make(models.grass(), small, tier.grass, "grass", null, 64, 0, false, [0.16, 0.08]);
    make(models.pebbles(), pebble, tier.detail, "detail", [0], 32, 0, false, [0.1, 0.02]);
    make(models.clover(), small, tier.detail, "detail", [1], 32, 0, false, [0.1, 0.04]);
    // Contact shadows: a soft dark disc under every tree, bush and rock.
    const disc = new CircleGeometry(1, 12).rotateX(-Math.PI / 2);
    const shade = new MeshBasicNodeMaterial({ color: 0x1f2a10, transparent: true, depthWrite: false });
    shade.opacityNode = float(1).sub(smoothstep(0.15, 1, length(positionGeometry.xz))).mul(0.34);
    shade.polygonOffset = true;
    shade.polygonOffsetFactor = -2;
    shade.polygonOffsetUnits = -2;
    this.materials.push(shade);
    this.contact = make(disc, shade, tier.trees + tier.bushes + tier.rocks, "trees", null, 16, 0, false, [0, 0]);
    this.contact.mesh.renderOrder = 1;
    this.grassOn = tier.grass > 0;
  }

  /** A chunk was grown: it's filled over the next frames, nearest first. */
  addChunk(chunk: Chunk): void {
    const g: Grown = { chunk, pages: this.kinds.map(() => []), counts: this.kinds.map(() => 0), big: false, small: false, near: false, dist: dist(chunk, this.focusX, this.focusY) };
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
   * between near and far models. Works until `deadline` (performance.now()),
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
    const lod = this.tier.treeLod;
    let pending = false;
    let worked = false;
    for (let i = 0; i < this.order.length; i++) {
      const g = this.order[i]!;
      // Hysteresis, so a chunk on an edge doesn't flip back and forth.
      const wantSmall = g.small ? g.dist < grassR + CHUNK * 1.1 : g.dist < grassR + CHUNK * 0.7;
      const wantNear = g.near ? g.dist < lod + CHUNK * 1.1 : g.dist < lod + CHUNK * 0.7;
      if (g.big && g.small === wantSmall && g.near === wantNear) continue;
      if (worked && performance.now() > deadline) {
        pending = true;
        break;
      }
      worked = true;
      if (!g.big || g.near !== wantNear) {
        g.near = wantNear;
        this.fillBig(g);
      }
      if (g.small !== wantSmall) {
        g.small = wantSmall;
        this.fillSmall(g);
      }
    }
    return pending;
  }

  /** Trees (near or far models), bushes, rocks and their contact shadows. */
  private fillBig(g: Grown): void {
    const layers = g.chunk.samples.layers;
    for (let k = 0; k < this.kinds.length; k++) {
      const kind = this.kinds[k]!;
      if (kind === this.contact || (kind.layer !== "trees" && kind.layer !== "bushes" && kind.layer !== "rocks")) continue;
      this.release(g, k);
      if (kind.lod === 1 && !g.near) continue;
      if (kind.lod === 2 && g.near) continue;
      this.fill(g, k, layers[kind.layer]!);
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
        const r = layer === "trees" ? [2.2, 1.7, 1.7, 2.6][kindOf]! * scale : layer === "bushes" ? 1.05 * scale : 1.25 * scale;
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

const fract = (x: number): number => x - Math.floor(x);
const dist = (c: Chunk, x: number, y: number): number => (Number.isNaN(x) ? 0 : Math.hypot((c.cx + 0.5) * CHUNK - x, (c.cy + 0.5) * CHUNK - y));
