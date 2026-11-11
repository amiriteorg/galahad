import { float, length, positionGeometry, smoothstep } from "three/tsl";
import { type BufferGeometry, CircleGeometry, DoubleSide, FrontSide, type Group, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshBasicNodeMaterial, MeshLambertNodeMaterial, Quaternion, Vector3 } from "three/webgpu";
import { models, plantModel, together, treeTriangles } from "./flora-models.ts";
import { DEADWOOD_SINK, deadwoodScale, rockHeight } from "./flora-plan.ts";
import { GROW } from "./flora-season.ts";
import { type PlantLook, plantNodes, primeSeason, seasonShown, swaying, wind } from "./flora-shade.ts";
import { type Chunk, waterWave } from "./land.ts";
import { LeafFall } from "./leaf-fall.ts";
import { occlusionMask } from "./occlusion.ts";
import { weatherUniforms, wetDarken, wetSheen } from "./wet.ts";
import { BIG, CHUNK, type Layer, SMALL, STRIDE, TREE_KINDS } from "./terrain.ts";
import type { Tier } from "./tiers.ts";

/*
 * Everything that grows, on the GPU: nine kinds of tree (oaks, pines, round
 * trees, parasols, birches with their banded white bark, cherries, spruces,
 * alders and willows), leafy bushes, ferns, gorse and mounds of heather,
 * pinkish boulders, layered slabs and deadwood, the reeds, cattails and rushes
 * of the water's edge, and underfoot grass in tufts and lush clumps, marram and
 * rushes, patches of daisies and buttercups or lupines, campions and lavender,
 * wood anemones, heather, clover, pebbles, mushrooms, fallen leaves, driftwood
 * and lily pads. Each model (flora-models.ts) is one instanced mesh (a draw
 * call, and only while a chunk in reach grows some), so kinds that grow
 * together share one.
 *
 * Trees come in three levels of detail by distance from the focus, chosen per
 * chunk: near, every crown is a heap of many small facets on a tapering trunk
 * with a root flare and boughs; farther, a simpler crown; far off, a few
 * facets. A soft contact shadow sits under every tree, bush and rock.
 *
 * The instance buffers are paged: every chunk holds whole pages of each kind it
 * grows, written once when it's grown and zeroed when it's dropped, so only those
 * pages are uploaded (never the whole buffer, never on a turn of the camera). The
 * small things grow only near the focus and the trees swap models with distance,
 * a few chunks per frame within a time budget, nearest first.
 *
 * The season and the wind never touch those buffers: every leaf, flower and
 * blade is grown, coloured and bent in the vertex shader from a few uniforms
 * (flora-shade.ts). Trees, bushes, rocks and reeds dissolve when they'd hide
 * Galahad. In autumn the leaves that come down in the wind are drawn here too,
 * from the crowns nearest the focus (leaf-fall.ts).
 */

export { plantModel, swaying, TREE_KINDS, treeTriangles, wind };

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
  // Asked every frame for every chunk: plain comparisons, nothing allocated.
  if (near > 0 && d < near + CHUNK * (current === NEAR ? 1.1 : 0.7)) return NEAR;
  if (d < lod + CHUNK * (current <= MID ? 1.1 : 0.7)) return MID;
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
  /** The season's amounts (flora-season.ts' GROW) that all of it grows by: while they're all nothing, there's nothing of it to draw. */
  gate: readonly number[] | null;
  /** Out of season: not drawn. */
  dormant: boolean;
}

/** One chunk's share of the instances. */
export interface Grown {
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
/** Near and farther, but not far off (where a cheaper model stands in). */
const CLOSE = (1 << NEAR) | (1 << MID);

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
  /** The leaves coming down in autumn, from the crowns nearest the focus. */
  private readonly leaves: LeafFall;
  /** The trees' and the bushes' materials: while their crowns are thin, their leaves are drawn from both sides. */
  private leafy: MeshLambertNodeMaterial[] = [];
  private thin = false;
  /** Each layer's cap (the tier's), and how many instances its kinds' pages hold now. */
  private readonly caps: Record<Layer, number>;
  private readonly held: Record<Layer, number> = { trees: 0, bushes: 0, rocks: 0, reeds: 0, flowers: 0, grass: 0, detail: 0 };

  constructor(
    private readonly root: Group,
    private readonly tier: Tier,
    /** The ground's height (world), for tilting contact shadows to the slope. */
    private readonly height: (x: number, y: number) => number,
    /** Grows a chunk's small layer on demand. */
    private readonly smallLayer: (chunk: Chunk, layer: Layer) => Float64Array,
  ) {
    this.caps = { trees: tier.trees, bushes: tier.bushes, rocks: tier.rocks, reeds: tier.reeds, flowers: tier.flowers, grass: tier.grass, detail: tier.detail };
    const material = (look: PlantLook, porosity: number, mask: boolean): MeshLambertNodeMaterial => {
      // (No vertexColors: a plant's colour is the season's, worked out from its two colours in the shader.)
      const mat = new MeshLambertNodeMaterial();
      const n = plantNodes(look);
      mat.positionNode = n.position;
      if (mask) mat.maskNode = occlusionMask();
      // Rain darkens rock and bark most, leaves and grass a little, and gives them a sheen; snow lies on what faces up.
      mat.colorNode = n.colour.mul(n.shimmer.add(1)).mul(wetDarken(porosity, 1, n.colour));
      // (And a turned leaf lets the sky's light through: its shaded side glows a little by day, not at all by night.)
      mat.emissiveNode = leafy ? wetSheen(porosity).add(n.colour.mul(weatherUniforms.sky).mul(n.through).mul(0.16)) : wetSheen(porosity);
      this.materials.push(mat);
      return mat;
    };
    let leafy = true;
    const tree = material({ stiffness: 0.0032, shimmer: 0.07 }, 0.6, true);
    const bush = material({ stiffness: 0.045, shimmer: 0.08 }, 0.6, true);
    leafy = false;
    this.leafy = [tree, bush];
    // (Built for the season it will first be drawn in: a thin crown is seen from both sides.)
    primeSeason();
    this.seasons();
    const rock = material({ stiffness: 0, shimmer: 0 }, 1, true);
    const reed = material({ stiffness: 0.06, shimmer: 0.16 }, 0.35, true);
    const small = material({ stiffness: 0.32, shimmer: 0.18 }, 0.35, false);
    const pebble = material({ stiffness: 0, shimmer: 0 }, 1, false);
    const afloat = material({ stiffness: 0, shimmer: 0, afloat: waterWave }, 0.35, false);
    const make = (geometry: BufferGeometry, mat: MeshLambertNodeMaterial | MeshBasicNodeMaterial, cap: number, layer: Layer, kinds: readonly number[] | null, page: number, bands: number, shadow: boolean, tint: [number, number], gate: readonly number[] | null = null): Kind => {
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
      const k: Kind = { layer, kinds, bands, mesh, matrices: mesh.instanceMatrix.array as Float32Array, colors: mesh.instanceColor.array as Float32Array, page, used: new Uint8Array(pages), top: 0, live: 0, tint, gate, dormant: false };
      this.kinds.push(k);
      return k;
    };
    const shadows = tier.shadows;
    // A layer's cap is shared among its kinds, each by about the most of the layer it can be where it grows thickest
    // (so the shares add up to more than the layer: no one place grows them all).
    const cap = (total: number, share: number) => Math.ceil(total * share);
    // Trees: near models (only on tiers that draw them), simpler ones farther, and five far ones.
    const tints: [number, number][] = [[0.12, 0.06], [0.1, 0], [0.12, 0.08], [0.1, 0.06], [0.1, 0.04], [0.08, 0.02], [0.1, 0], [0.1, 0.04], [0.1, 0.05]];
    const shares = [0.36, 0.32, 0.14, 0.14, 0.2, 0.12, 0.2, 0.1, 0.1];
    // (Every model is a draw call: a tier below the highest has fewer of them. Its spruces, alders and willows have no
    // near model of their own, a far spruce is a far pine and a far birch any broad tree, its rushes are reeds, and it
    // has no driftwood.)
    const rich = tier.name === "high";
    TREE_KINDS.forEach((name, i) => {
      const near = tier.treeDetail > 0 && (rich || i < 6);
      if (near) make(models[name](1), tree, cap(tier.trees, shares[i]! * 0.5), "trees", [i], 4, 1 << NEAR, shadows, tints[i]!);
      // Farther off, a round tree is drawn as a small oak (one draw call fewer; at that distance they're alike).
      if (name === "round") return;
      make(models[name](0), tree, cap(tier.trees, shares[i]! + (name === "oak" ? shares[2]! : 0)), "trees", name === "oak" ? [0, 2] : [i], 8, near || tier.treeDetail === 0 ? 1 << MID : CLOSE, shadows, tints[i]!);
    });
    make(models.farBroad(), tree, cap(tier.trees, 0.8), "trees", rich ? [0, 2, 3, 7, 8] : [0, 2, 3, 4, 7, 8], 16, 1 << FAR, false, [0.12, 0.06]);
    if (rich) make(models.farBirch(), tree, cap(tier.trees, 0.3), "trees", [4], 16, 1 << FAR, false, [0.1, 0.04]);
    make(models.farConifer(), tree, cap(tier.trees, 0.4), "trees", rich ? [1] : [1, 6], 16, 1 << FAR, false, [0.1, 0]);
    if (rich) make(models.farSpruce(), tree, cap(tier.trees, 0.24), "trees", [6], 16, 1 << FAR, false, [0.1, 0]);
    make(models.farBlossom(), tree, cap(tier.trees, 0.12), "trees", [5], 8, 1 << FAR, false, [0.08, 0.02]);
    // Bushes: leafy, in flower, ferns under the trees; gorse and mounds of heather on the heath.
    make(models.bush(), bush, cap(tier.bushes, 0.6), "bushes", [0, 1], 8, CLOSE, false, [0.12, 0.05]);
    make(models.farBush(), bush, cap(tier.bushes, 0.85), "bushes", [0, 1], 16, 1 << FAR, false, [0.12, 0.05]);
    make(models.fern(), bush, cap(tier.bushes, 0.3), "bushes", [2], 4, ALL, false, [0.12, 0.04]);
    make(models.gorse(), bush, cap(tier.bushes, 0.25), "bushes", [3], 4, ALL, false, [0.1, 0.03]);
    make(models.heatherMound(), bush, cap(tier.bushes, 0.3), "bushes", [4], 4, ALL, false, [0.1, 0.04]);
    // Rocks: a boulder with a stone beside it, or a layered slab; and deadwood, a fallen log by its stump.
    make(models.boulder(), rock, cap(tier.rocks, 0.75), "rocks", [0, 1], 4, ALL, shadows, [0.1, 0.03]);
    make(models.slab(), rock, cap(tier.rocks, 0.4), "rocks", [2], 4, ALL, shadows, [0.1, 0.03]);
    make(models.log(), rock, cap(tier.rocks, 0.3), "rocks", [3], 4, ALL, shadows, [0.1, 0.04]);
    // The water's edge: reeds with cattails among them, and stands of rushes (which a lower tier draws as reeds).
    make(models.reeds(), reed, cap(tier.reeds, 0.5), "reeds", rich ? [0, 1] : [0, 1, 2], 16, CLOSE, false, [0.1, 0.04]);
    if (rich) make(models.rushes(), reed, cap(tier.reeds, 0.2), "reeds", [2], 16, CLOSE, false, [0.1, 0.04]);
    make(models.farReeds(), reed, tier.reeds, "reeds", [0, 1, 2], 32, 1 << FAR, false, [0.1, 0.04]);
    // Flowers in mixed patches (fewer draw calls): daisies with buttercups; lupines, campions and lavender; the
    // woodland floor's anemones; the heath's heather. Out of their season there is nothing of them, and they aren't drawn.
    make(together(models.daisy(3), models.buttercup(3), 0.24, 0.08), small, cap(tier.flowers, 0.5), "flowers", [0, 3], 16, ALL, false, [0.06, 0.02], [GROW.long, GROW.flower]);
    make(together(together(models.lupine(2), models.campion(2), -0.2, 0.14), models.lavender(4), 0.16, -0.18), small, cap(tier.flowers, 0.5), "flowers", [1, 2, 4], 16, ALL, false, [0.08, 0.02], [GROW.flower]);
    make(models.anemone(), small, cap(tier.flowers, 0.4), "flowers", [5], 16, ALL, false, [0.06, 0.02], [GROW.spring]);
    make(models.heather(), small, cap(tier.flowers, 0.8), "flowers", [6], 16, ALL, false, [0.12, 0.05]);
    // Grass: tufts, lush clumps with a stalk gone to seed, and the dunes' marram (which, smaller and darker, is the
    // marsh's tussock too: one model, one draw call).
    make(models.grass(), small, cap(tier.grass, 0.55), "grass", [0], 32, ALL, false, [0.16, 0.08]);
    make(models.lush(1), small, cap(tier.grass, 0.45), "grass", [1, 2], 32, ALL, false, [0.14, 0.07]);
    make(models.marram(), small, cap(tier.grass, 0.4), "grass", [3, 4], 32, ALL, false, [0.12, 0.05]);
    // Underfoot: pebbles and clover; in the woods mushrooms and fallen leaves; driftwood on the shores; lily pads afloat.
    make(models.pebbles(), pebble, cap(tier.detail, 0.5), "detail", [0], 16, ALL, false, [0.1, 0.02]);
    make(models.clover(), small, cap(tier.detail, 0.5), "detail", [1], 16, ALL, false, [0.1, 0.04]);
    make(models.mushrooms(), pebble, cap(tier.detail, 0.15), "detail", [2], 16, ALL, false, [0.08, 0.03], [GROW.autumn]);
    make(models.litter(), pebble, cap(tier.detail, 0.4), "detail", [3], 16, ALL, false, [0.12, 0.06], [GROW.litter]);
    if (rich) make(models.driftwood(), pebble, cap(tier.detail, 0.12), "detail", [4], 8, ALL, false, [0.08, 0.02]);
    if (tier.name !== "low") make(models.lily(), afloat, cap(tier.detail, 0.2), "detail", [5], 16, ALL, false, [0.1, 0.04], [GROW.leaf, GROW.flower]);
    // Contact shadows: a soft dark disc under every tree, bush and rock.
    const disc = new CircleGeometry(1, 8).rotateX(-Math.PI / 2);
    const shade = new MeshBasicNodeMaterial({ color: 0x1f2a10, transparent: true, depthWrite: false });
    shade.opacityNode = float(1).sub(smoothstep(0.15, 1, length(positionGeometry.xz))).mul(0.34);
    shade.polygonOffset = true;
    shade.polygonOffsetFactor = -2;
    shade.polygonOffsetUnits = -2;
    this.materials.push(shade);
    this.contact = make(disc, shade, tier.trees + tier.bushes + tier.rocks, "trees", null, 16, ALL, false, [0, 0]);
    this.contact.mesh.renderOrder = 1;
    this.grassOn = tier.grass > 0;
    this.leaves = new LeafFall(root, tier.leaves);
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
    this.leaves.stale = true;
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
      this.leaves.stale = true;
    }
    const grassR = this.grassOn ? this.tier.grassRadius : -1e9;
    this.seasons();
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
        const was = g.band;
        g.band = wantBand;
        this.fillBig(g, was);
      }
      if (g.small !== wantSmall) {
        g.small = wantSmall;
        this.fillSmall(g);
      }
    }
    // The leaves in the air come from the trees round the focus: found again when it has moved or the land has changed.
    if (this.leaves.stale && !pending) this.leaves.gather(this.order, focusX, focusY, this.anchorX, this.anchorY);
    return pending;
  }

  /** What's out of season isn't drawn: a kind all of whose parts the season has at nothing (anemones in summer, flowers in winter). */
  private seasons(): void {
    // A full crown hides its own far side (drawn one-sided, as it always was); a thinning one is looked through,
    // so its leaves are drawn from both sides. (A change of material, twice a year.)
    const thin = seasonShown.grow[GROW.leaf]! < 0.9;
    if (thin !== this.thin) {
      this.thin = thin;
      for (const m of this.leafy) {
        m.side = thin ? DoubleSide : FrontSide;
        m.needsUpdate = true;
      }
    }
    for (let k = 0; k < this.kinds.length; k++) {
      const kind = this.kinds[k]!;
      if (!kind.gate) continue;
      let most = 0;
      for (let i = 0; i < kind.gate.length; i++) most = Math.max(most, seasonShown.grow[kind.gate[i]!]!);
      const dormant = most <= 0.002;
      if (dormant === kind.dormant) continue;
      kind.dormant = dormant;
      this.refreshCount(kind);
    }
  }

  /** A frame of the leaves in the air (their own clock: the wind's speed, m/s, and whether anything may move). */
  animate(dt: number, speed: number, motion: boolean): void {
    this.leaves.animate(dt, speed, motion);
  }

  /** Trees (at the chunk's level of detail), bushes, rocks, reeds and their contact shadows. */
  private fillBig(g: Grown, was: number): void {
    const layers = g.chunk.samples.layers;
    for (let k = 0; k < this.kinds.length; k++) {
      const kind = this.kinds[k]!;
      if (kind === this.contact || !BIG.includes(kind.layer)) continue;
      const draws = (kind.bands & (1 << g.band)) !== 0;
      // What's drawn the same at the old level and the new stays as it's written (rocks at every level; a bush near and farther).
      if (g.big && draws === ((kind.bands & (1 << was)) !== 0)) continue;
      this.release(g, k);
      if (draws) this.fill(g, k, layers[kind.layer]!);
    }
    if (!g.big) {
      this.fillContact(g);
      g.big = true;
      this.leaves.stale = true;
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
    // (Deadwood is in the rocks' layer, and drawn at its own size; what's afloat lies on the water as it's placed.)
    const dead = rocks && (kind.kinds?.[0] ?? 0) >= 3;
    const floats = kind.layer === "detail" && kind.kinds?.[0] === 5;
    const coarse = kind.layer === "grass" && kind.kinds?.[0] === 3;
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
      // (A tussock of rushes is the marram's model, smaller and darker.)
      const tussock = coarse && packed[i + 5] === 4;
      const scale = dead ? deadwoodScale(packed[i + 3]!) : tussock ? packed[i + 3]! * 0.6 : packed[i + 3]!;
      const z = packed[i + 2]! - (dead ? DEADWOOD_SINK * scale : rocks ? 0.14 * scale : floats ? 0 : 0.04);
      this.v.set(x - this.anchorX, z, -(y - this.anchorY));
      this.q.setFromAxisAngle(this.up, packed[i + 4]!);
      if (rocks && !dead) this.s.set(scale, scale * rockHeight(packed[i + 5]!), scale);
      else this.s.setScalar(scale);
      this.m.compose(this.v, this.q, this.s);
      this.m.toArray(kind.matrices, slot * 16);
      // A per-plant tint from where it stands: a little lighter or darker, a little warmer or not.
      const h = fract(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453);
      const h2 = fract(h * 7.31);
      const b = 1 - kind.tint[0] + 2 * kind.tint[0] * h;
      const warm = kind.tint[1] * (h2 - 0.5) * 2;
      kind.colors[slot * 3] = b * (1 + warm) * (tussock ? 0.6 : 1);
      kind.colors[slot * 3 + 1] = b * (tussock ? 0.82 : 1);
      kind.colors[slot * 3 + 2] = b * (1 - warm) * (tussock ? 0.5 : 1);
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
        const dead = layer === "rocks" && kindOf >= 3;
        const r = layer === "trees" ? (TREE_SHADOW[kindOf] ?? 2) * scale : layer === "bushes" ? (BUSH_SHADOW[kindOf] ?? 1.05) * scale : dead ? 1.75 * deadwoodScale(scale) : (kindOf === 2 ? 1.5 : 1.25) * scale;
        // The ground's slope here, so the disc lies on it rather than floating off it.
        const dx = this.height(x + 1, y) - this.height(x - 1, y);
        const dy = this.height(x, y + 1) - this.height(x, y - 1);
        this.n.set(-dx / 2, 1, dy / 2).normalize();
        this.q.setFromUnitVectors(this.up, this.n);
        this.q2.setFromAxisAngle(this.up, packed[i + 4]!);
        this.q.multiply(this.q2);
        this.v.set(x - this.anchorX, packed[i + 2]! + 0.03, -(y - this.anchorY));
        this.s.set(r, 1, r * (dead ? 0.36 : layer === "rocks" ? 0.8 : 1));
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
    // (The tier's cap is its layer's, whatever the kinds' own shares add up to.)
    if (kind !== this.contact && this.held[kind.layer] + kind.page > this.caps[kind.layer]) return -1;
    for (let p = 0; p < kind.used.length; p++) {
      if (kind.used[p]) continue;
      kind.used[p] = 1;
      if (p + 1 > kind.top) kind.top = p + 1;
      if (kind !== this.contact) this.held[kind.layer] += kind.page;
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
    if (kind !== this.contact) this.held[kind.layer] -= pages.length * kind.page;
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
    kind.mesh.visible = kind.live > 0 && !kind.dormant;
  }

  /** Instances drawn now, per layer (for the stats). */
  counts(): Record<Layer, number> {
    const out: Record<Layer, number> = { trees: 0, bushes: 0, rocks: 0, reeds: 0, flowers: 0, grass: 0, detail: 0 };
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
        this.held[kind.layer] = 0;
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
      this.leaves.stale = true;
    }
    for (const k of this.kinds) k.mesh.position.set(this.anchorX, 0, -this.anchorY);
    this.leaves.place(this.anchorX, this.anchorY);
  }

  dispose(): void {
    for (const k of this.kinds) {
      k.mesh.removeFromParent();
      k.mesh.geometry.dispose();
      k.mesh.dispose();
    }
    for (const m of this.materials) m.dispose();
    this.leaves.dispose();
    this.grown.clear();
    this.order.length = 0;
  }
}

/** Each tree's contact shadow's radius (by kind, before its scale), and each bush's. */
const TREE_SHADOW = [2.2, 1.7, 1.7, 2.6, 1.3, 1.9, 1.5, 1.5, 2.7];
const BUSH_SHADOW = [1.05, 1.05, 0.8, 1.0, 1.25];

const fract = (x: number): number => x - Math.floor(x);
const dist = (c: Chunk, x: number, y: number): number => (Number.isNaN(x) ? 0 : Math.hypot((c.cx + 0.5) * CHUNK - x, (c.cy + 0.5) * CHUNK - y));
