import { BufferAttribute, BufferGeometry, ConeGeometry, CylinderGeometry, IcosahedronGeometry, OctahedronGeometry } from "three/webgpu";
import { PlantMesher, together } from "./flora-mesher.ts";
import { GROW, TINT } from "./flora-season.ts";
import { type AmbientOcclusion, at, between, chip, groundAO, lumpy, type Paint } from "./mesher.ts";
import { TREE_KINDS } from "./terrain.ts";

/*
 * Every model that grows, original and procedural: nine kinds of tree in three
 * levels of detail, bushes, gorse and heather, boulders, slabs and deadwood,
 * the reeds of the water's edge, flowers, grasses and what lies underfoot. Each
 * is built once, as one merged geometry whose parts say what the season does to
 * them (flora-mesher.ts):
 *
 *   a crown   is a heap of facets, each a leaf of its own: lime in summer, its
 *             own gold, amber or red by the height of autumn (a birch's yellow
 *             first, a conifer's never), falling one by one, and in spring
 *             swelling together from buds;
 *   under it  a bough to every heap and a spray of fine twigs that show as the
 *             leaves go, so a bare tree is still a tree worth looking at;
 *   blossom   a second, pink shell over a cherry's crown, a few weeks of spring;
 *   flowers   rise from the ground when their weeks come and sink back after;
 *   grass and reeds  pale to straw; heather goes purple late in August.
 *
 * Sizes are in metres at scale 1; flora-plan.ts' solids are held to these by
 * its test.
 */

const TRUNK = 0x9a6644;
const TRUNK_DARK = 0x7d5034;
const LIME_TOP = 0xc4dc62;
const LIME = 0xaacd4e;
const LIME_DEEP = 0x8dbb45;
const LEAF_SHADE = 0x76a63f;
const PINE = 0x5f9a52;
const PINE_LIGHT = 0x76ad5a;
const PINE_DEEP = 0x518c4b;
const SPRUCE = 0x4b8d63;
const SPRUCE_LIGHT = 0x5f9f70;
const SPRUCE_DEEP = 0x3f7d5c;
const BIRCH = 0xf1ece0;
const BIRCH_MARK = 0x55504c;
const BIRCH_LEAF = 0xcfe27c;
const BIRCH_LEAF_DEEP = 0xb3d264;
const BLOSSOM = 0xf5bfd0;
const BLOSSOM_LIGHT = 0xfbdbe5;
const BLOSSOM_DEEP = 0xe9a2bb;
const CHERRY_BARK = 0x7f5547;
const ALDER_BARK = 0x74615a;
const ALDER = 0x7fb04c;
const ALDER_DEEP = 0x6a9c46;
const ALDER_TOP = 0x95c058;
const WILLOW_BARK = 0x8b7355;
const WILLOW = 0xbcd676;
const WILLOW_DEEP = 0xa4c768;
const WILLOW_TOP = 0xd2e28e;
const ROCK = 0xdac3b3;
const ROCK_WARM = 0xd2b4a6;
const ROCK_PALE = 0xe6d6c8;
const CUT_WOOD = 0xe4cba0;
const MOSS = 0x93bd5c;

/**
 * Autumn, in pastel: what each kind's leaves turn to (one of them per leaf). Light and towards yellow on purpose: a
 * shaded orange is a brown, and an autumn wood should glow, not go to mud.
 */
const GOLD = 0xf8da72;
const AMBER = 0xf7c468;
const ORANGE = 0xf6aa6c;
const CORAL = 0xf29a86;
const RUSSET = 0xf0b47c;
const ROSE = 0xf4a9b2;
const YELLOW = 0xfae886;
const LEMON = 0xf5ec9e;
const OLIVE = 0xcdc970;
const STRAW = 0xdccb8e;
const STRAW_PALE = 0xe6dcae;
const AUTUMN = {
  oak: [AMBER, GOLD, ORANGE, RUSSET, GOLD],
  round: [GOLD, YELLOW, AMBER],
  parasol: [ORANGE, CORAL, GOLD, AMBER],
  birch: [YELLOW, LEMON, GOLD],
  blossom: [CORAL, ROSE, ORANGE],
  alder: [OLIVE, 0xbcbd6a, 0xd9d27e],
  willow: [0xeae37c, GOLD, LEMON],
  bush: [AMBER, CORAL, GOLD, RUSSET],
} as const;
/** The fine twigs of a bare crown: a soft lilac-brown haze (a birch's darker, a willow's golden). */
const TWIG = 0xab8f8c;
const TWIG_BIRCH = 0x8e6f78;
const TWIG_WILLOW = 0xdcb45c;
const TWIG_ALDER = 0x8a6a66;
/** A conifer's needles in winter: a little deeper and bluer. */
const winterNeedle = (c: number): number => {
  const r = (c >> 16) & 255;
  const g = (c >> 8) & 255;
  const b = c & 255;
  return (Math.round(r * 0.86) << 16) | (Math.round(g * 0.93) << 8) | Math.round(Math.min(255, b * 1.12));
};

const treeAO: AmbientOcclusion = groundAO(0.52, 1.8, 0.7);
const lowAO: AmbientOcclusion = groundAO(0.5, 0.45, 0.8);
const fract = (x: number): number => x - Math.floor(x);

/** Bark in pale bands with dark marks, as a birch's (a Paint, by height). */
const birchBark: Paint = (x, y, z) => (fract(y * 2.3 + Math.sin(x * 7 + z * 5) * 0.2) < 0.22 ? BIRCH_MARK : BIRCH);

/**
 * A tapering trunk from the ground up to (topX, h, topZ) in `segs` pieces that
 * waver a little on the way, `sides` facets round, and `roots` roots splaying
 * out at its foot. Returns where it ends.
 */
function trunk(m: PlantMesher, h: number, r: number, topX: number, topZ: number, segs: number, sides: number, color: number | Paint, roots: number, rootColor: number, rings = 1): [number, number, number] {
  m.plain();
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
    // A touch longer than the gap, so the pieces overlap at the bends, and a knot where they meet.
    m.add(new CylinderGeometry(nr, pr, 1, sides, rings, true), color, between(px, py - (k > 1 ? 0.06 : 0), pz, x, y, z, 1), 0.12);
    if (k > 1) m.add(new IcosahedronGeometry(pr * 1.06, 0), color, at(px, py, pz, k), 0.12);
    px = x;
    py = y;
    pz = z;
    pr = nr;
  }
  for (let i = 0; i < roots; i++) {
    const a = (i / roots) * Math.PI * 2 + 0.4;
    const reach = r * (1.5 + 0.35 * Math.sin(i * 2.7));
    m.add(new ConeGeometry(r * 0.5, r * 2.5, 4, 1, true), rootColor, between(Math.sin(a) * reach, 0.02, Math.cos(a) * reach, Math.sin(a) * r * 0.2, r * 1.9, Math.cos(a) * r * 0.2, 1), 0.1);
  }
  return [px, py, pz];
}

type Cluster = [x: number, y: number, z: number, r: number, color: number];

interface Foliage {
  /** Which tint turns it (a birch's is early, an alder's late). */
  tint: number;
  /** What its leaves turn to. */
  autumn: readonly number[];
  twig: number;
}

/**
 * A crown: each cluster a heap of facets, every facet a leaf (it turns and falls in its own turn). Near (`detail` 1)
 * the big clusters are heaps of many small facets; farther, a few big ones; each pushed about so no two match.
 */
function crown(m: PlantMesher, clusters: readonly Cluster[], detail: 0 | 1, squash: number | [number, number, number], seed: number, f: Foliage): void {
  m.season(f.tint, GROW.leaf, { alt: f.autumn, pivot: "face", key: "face" });
  clusters.forEach(([x, y, z, r, color], i) => {
    // The biggest clusters near get the finer facets; the small ones stay coarse (they're small anyway).
    const fine = detail === 1 && r >= 0.75;
    m.add(lumpy(new IcosahedronGeometry(r, fine ? 1 : 0), seed + i * 7, fine ? 0.13 : 0.16), color, at(x, y, z, x * 1.7 + z + i, typeof squash === "number" ? [1, squash, 1] : squash), 0.1);
  });
  m.plain();
}

/**
 * A limb from the trunk's top out through each of the first `n` clusters: three-sided, tapering nearly to a point just
 * short of where the leaves end, so a bare crown has long limbs, not stubs. With `shoots`, a side shoot off each.
 */
function boughs(m: PlantMesher, from: readonly [number, number, number], clusters: readonly Cluster[], n: number, r: number, color: number | Paint, shoots = false): void {
  m.plain();
  clusters.slice(0, n).forEach(([x, y, z, cr], i) => {
    // On through the cluster's middle, outwards and up.
    const dx = x - from[0];
    const dy = y - from[1] + 0.5;
    const dz = z - from[2];
    const len = Math.hypot(dx, dy, dz) || 1;
    const ex = x + (dx / len) * cr * 0.5;
    const ey = y + (dy / len) * cr * 0.5;
    const ez = z + (dz / len) * cr * 0.5;
    m.add(new CylinderGeometry(r * 0.12, r, 1, 3, 1, true), color, between(from[0], from[1] - 0.25, from[2], ex, ey, ez, 1), 0.1);
    if (!shoots) return;
    // A shoot from two thirds of the way along, off to one side and up.
    const sx = from[0] + (ex - from[0]) * 0.62;
    const sy = from[1] + (ey - from[1]) * 0.62;
    const sz = from[2] + (ez - from[2]) * 0.62;
    const a = i * 2.4 + 0.8;
    const reach = cr * 0.75;
    m.add(new ConeGeometry(r * 0.3, 1, 3, 1, true), color, between(sx, sy, sz, sx + Math.cos(a) * reach * 0.7, sy + reach * 0.75, sz + Math.sin(a) * reach * 0.7, 1), 0.1);
  });
}

/**
 * The fine twigs of a bare crown: `per` slivers out from each cluster's middle (both faces), there as the leaves
 * aren't. `hang` pulls them downwards (a willow's).
 */
function twigs(m: PlantMesher, clusters: readonly Cluster[], per: number, color: number, seed: number, hang = 0, reach = 0.95): void {
  clusters.forEach(([x, y, z, r], i) => {
    m.season(TINT.none, GROW.twig, { pivot: [x, y, z], key: fract(i * 0.37 + 0.11) });
    const pts: number[] = [];
    for (let k = 0; k < per; k++) {
      const a = (k / per) * Math.PI * 2 + i * 1.3 + seed;
      const up = hang ? -0.9 * hang + 0.25 * Math.sin(k * 2.3 + i) : 0.15 + 0.75 * fract(Math.sin((k + 1) * 12.9898 + i * 4.1 + seed) * 43758.5453);
      const len = r * reach * (0.8 + 0.4 * fract(k * 0.618 + i * 0.31));
      const flatLen = Math.sqrt(Math.max(0.05, 1 - Math.min(0.9, up * up)));
      const tx = x + Math.cos(a) * len * flatLen;
      const ty = y + up * len * (hang ? 1.5 : 1);
      const tz = z + Math.sin(a) * len * flatLen;
      // A sliver: a short base across the direction it goes, to a point (fine: a twig, not a blade).
      const w = 0.02 + r * 0.016;
      const bx = -Math.sin(a) * w;
      const bz = Math.cos(a) * w;
      pts.push(x - bx, y, z - bz, x + bx, y, z + bz, tx, ty, tz, x + bx, y, z + bz, x - bx, y, z - bz, tx, ty, tz);
    }
    m.triangles(pts, color, 0.1);
  });
  m.plain();
}

/**
 * A conifer's tier: a cone whose skirt is cut into points (alternately long and
 * short, drooping), with a shallow underside. `sides` points round.
 */
function pineTier(r: number, h: number, sides: number, seed: number, droop = 0.5): BufferGeometry {
  const pos: number[] = [];
  const top = [0, h * 0.5, 0];
  const under = [0, -h * 0.25, 0];
  const rim: number[][] = [];
  for (let i = 0; i < sides * 2; i++) {
    const a = (i / (sides * 2)) * Math.PI * 2 + seed;
    const long = i % 2 === 0;
    const rr = long ? r * (0.95 + 0.1 * Math.sin(i * 3.1 + seed)) : r * 0.7;
    rim.push([Math.cos(a) * rr, long ? -h * droop : -h * (droop - 0.14), Math.sin(a) * rr]);
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
function blade(m: PlantMesher, bx: number, bz: number, a: number, w: number, tx: number, ty: number, tz: number, color: number, by = 0): void {
  const px = Math.cos(a) * w;
  const pz = -Math.sin(a) * w;
  m.triangles([bx - px, by, bz - pz, bx + px, by, bz + pz, tx, ty, tz, bx + px, by, bz + pz, bx - px, by, bz - pz, tx, ty, tz], color);
}

/** A flat flower head facing up at (x, y, z): `petals` points round (alternately long and short), `r` across. */
function flowerHead(m: PlantMesher, x: number, y: number, z: number, r: number, petals: number, color: number, turn: number): void {
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

const LEAVES: Foliage = { tint: TINT.leaf, autumn: AUTUMN.oak, twig: TWIG };

export const models = {
  // ---- trees, near (detail 1: many small facets) and farther (detail 0) ----
  oak: (detail: 0 | 1) => {
    const m = new PlantMesher();
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
    boughs(m, top, clusters, 8, 0.17, TRUNK, detail === 1);
    twigs(m, clusters, detail ? 3 : 2, TWIG, 1);
    crown(m, clusters, detail, 0.82, 11, LEAVES);
    return m.build({ ao: treeAO });
  },
  round: (detail: 0 | 1) => {
    const m = new PlantMesher();
    const clusters: Cluster[] = [
      [0.55, 2.7, 0.1, 0.95, LIME],
      [-0.55, 2.6, 0.25, 0.9, LIME_DEEP],
      [0.05, 2.75, -0.6, 0.9, LEAF_SHADE],
      [0.15, 3.35, 0.2, 0.95, LIME_TOP],
      ...(detail ? ([[-0.3, 3.2, -0.45, 0.55, LIME_TOP], [0.7, 3.1, -0.3, 0.5, LIME]] as Cluster[]) : []),
    ];
    const top = trunk(m, 1.7, 0.26, -0.15, 0, 2, detail ? 7 : 6, TRUNK, detail ? 5 : 4, TRUNK_DARK);
    boughs(m, top, clusters, 4, 0.13, TRUNK, detail === 1);
    twigs(m, clusters, detail ? 5 : 2, TWIG, 2);
    crown(m, clusters, detail, 0.82, 23, { ...LEAVES, autumn: AUTUMN.round });
    return m.build({ ao: treeAO });
  },
  parasol: (detail: 0 | 1) => {
    const m = new PlantMesher();
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
    boughs(m, top, clusters, 6, 0.15, TRUNK, detail === 1);
    twigs(m, clusters, detail ? 5 : 2, TWIG, 3);
    crown(m, clusters, detail, 0.6, 37, { ...LEAVES, autumn: AUTUMN.parasol });
    return m.build({ ao: treeAO });
  },
  birch: (detail: 0 | 1) => {
    const m = new PlantMesher();
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
    // Its leader runs on up through the crown, white, with its boughs off it.
    m.add(new CylinderGeometry(0.03, 0.085, 1, 4, 1, true), BIRCH, between(top[0], top[1] - 0.1, top[2], 0.02, 5.45, 0.05, 1), 0.08);
    boughs(m, [top[0], top[1] + 0.5, top[2]], clusters, 6, 0.07, BIRCH);
    twigs(m, clusters, detail ? 5 : 2, TWIG_BIRCH, 4, 0.35);
    crown(m, clusters, detail, 1.05, 53, { tint: TINT.earlyLeaf, autumn: AUTUMN.birch, twig: TWIG_BIRCH });
    return m.build({ ao: treeAO });
  },
  blossom: (detail: 0 | 1) => {
    const m = new PlantMesher();
    // A cherry: a dark forked trunk under a wide crown, green in summer, under a shell of blossom for a few weeks of spring.
    const leaves: Cluster[] = [
      [0.8, 2.9, 0.2, 1.0, LIME],
      [-0.75, 2.85, -0.2, 0.95, LIME_DEEP],
      [0.0, 3.0, -0.8, 0.9, LIME],
      [-0.1, 2.8, 0.85, 0.85, LIME_TOP],
      [0.3, 3.6, 0.1, 0.95, LIME_TOP],
      ...(detail ? ([[-0.6, 3.5, -0.5, 0.6, LIME], [1.1, 3.3, -0.6, 0.5, LIME_TOP], [-1.1, 3.2, 0.6, 0.5, LIME_DEEP]] as Cluster[]) : []),
    ];
    const top = trunk(m, 1.9, 0.24, 0.1, 0.1, 2, detail ? 7 : 5, CHERRY_BARK, detail ? 5 : 3, CHERRY_BARK);
    boughs(m, top, leaves, 5, 0.12, CHERRY_BARK, detail === 1);
    twigs(m, leaves, detail ? 4 : 2, 0xa8847c, 5);
    crown(m, leaves, 0, 0.78, 71, { ...LEAVES, autumn: AUTUMN.blossom });
    // The blossom: a second shell, a touch wider, each facet a spray of flowers opening and falling in its own turn.
    m.season(TINT.none, GROW.blossom, { pivot: "face", key: "face" });
    const pinks = [BLOSSOM, BLOSSOM_DEEP, BLOSSOM, BLOSSOM_LIGHT, BLOSSOM_LIGHT, BLOSSOM, BLOSSOM_LIGHT, BLOSSOM_DEEP];
    leaves.forEach(([x, y, z, r], i) => {
      const fine = detail === 1 && r >= 0.75;
      m.add(lumpy(new IcosahedronGeometry(r * 1.05, fine ? 1 : 0), 71 + i * 7, fine ? 0.13 : 0.16), pinks[i % pinks.length]!, at(x, y, z, x * 1.7 + z + i, [1, 0.78, 1]), 0.1);
    });
    return m.build({ ao: treeAO });
  },
  pine: (detail: 0 | 1) => {
    const m = new PlantMesher();
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
      tiers.forEach(([r, h, y, color], i) => m.season(TINT.needle, GROW.none, { alt: winterNeedle(color) }).add(pineTier(r, h, 9 - Math.min(3, i), i * 0.7), color, at(0, y, 0), 0.08));
    } else {
      const tiers: [number, number, number, number][] = [
        [1.55, 1.9, 1.9, PINE],
        [1.25, 1.8, 2.85, PINE_LIGHT],
        [0.95, 1.6, 3.75, PINE],
        [0.6, 1.4, 4.6, PINE_LIGHT],
      ];
      tiers.forEach(([r, h, y, color], i) => m.season(TINT.needle, GROW.none, { alt: winterNeedle(color) }).add(new ConeGeometry(r, h, 8), color, at(0, y, 0, i * 0.7), 0.08));
    }
    return m.build({ ao: treeAO });
  },
  spruce: (detail: 0 | 1) => {
    const m = new PlantMesher();
    // A spire: taller and narrower than a pine, darker and bluer, its lowest boughs sweeping the ground.
    trunk(m, 1.2, 0.2, 0, 0, 1, 6, TRUNK_DARK, detail ? 4 : 0, TRUNK_DARK);
    const tiers: [number, number, number, number][] = detail
      ? [
          [1.42, 1.5, 1.35, SPRUCE_DEEP],
          [1.3, 1.45, 2.1, SPRUCE],
          [1.14, 1.4, 2.85, SPRUCE_DEEP],
          [0.98, 1.35, 3.6, SPRUCE_LIGHT],
          [0.8, 1.3, 4.35, SPRUCE],
          [0.62, 1.25, 5.05, SPRUCE_LIGHT],
          [0.45, 1.2, 5.75, SPRUCE],
          [0.28, 1.15, 6.45, SPRUCE_LIGHT],
        ]
      : [
          [1.38, 2.0, 1.5, SPRUCE_DEEP],
          [1.12, 1.9, 2.75, SPRUCE],
          [0.86, 1.8, 3.95, SPRUCE_LIGHT],
          [0.6, 1.7, 5.1, SPRUCE],
          [0.34, 1.6, 6.2, SPRUCE_LIGHT],
        ];
    tiers.forEach(([r, h, y, color], i) => {
      m.season(TINT.needle, GROW.none, { alt: winterNeedle(color) });
      if (detail) m.add(pineTier(r, h, 8 - Math.min(3, i >> 1), i * 0.9, 0.62), color, at(0, y, 0), 0.08);
      else m.add(new ConeGeometry(r, h, 7), color, at(0, y, 0, i * 0.7), 0.08);
    });
    return m.build({ ao: treeAO });
  },
  alder: (detail: 0 | 1) => {
    const m = new PlantMesher();
    // Upright and narrow, dark-barked, by the water: it keeps its leaves green late and drops them hardly turned.
    const clusters: Cluster[] = [
      [0.5, 3.0, 0.15, 0.85, ALDER_DEEP],
      [-0.45, 3.4, -0.2, 0.82, ALDER],
      [0.12, 4.1, 0.32, 0.85, ALDER],
      [-0.18, 4.85, -0.25, 0.76, ALDER_TOP],
      [0.2, 5.5, 0.08, 0.62, ALDER_TOP],
      [0.0, 6.05, 0.0, 0.44, ALDER_TOP],
      ...(detail ? ([[-0.7, 4.0, 0.4, 0.5, ALDER_DEEP], [0.72, 4.3, -0.35, 0.5, ALDER], [0.1, 3.0, -0.7, 0.55, ALDER_DEEP]] as Cluster[]) : []),
    ];
    const top = trunk(m, 2.7, 0.22, 0.1, 0.05, detail ? 3 : 2, detail ? 7 : 5, ALDER_BARK, detail ? 5 : 3, ALDER_BARK);
    m.add(new CylinderGeometry(0.04, 0.11, 1, 4, 1, true), ALDER_BARK, between(top[0], top[1] - 0.1, top[2], 0.04, 5.9, 0.02, 1), 0.08);
    boughs(m, [top[0], top[1] + 0.3, top[2]], clusters, 6, 0.09, ALDER_BARK, detail === 1);
    twigs(m, clusters, detail ? 5 : 2, TWIG_ALDER, 6);
    crown(m, clusters, detail, 1.0, 83, { tint: TINT.lateLeaf, autumn: AUTUMN.alder, twig: TWIG_ALDER });
    return m.build({ ao: treeAO });
  },
  willow: (detail: 0 | 1) => {
    const m = new PlantMesher();
    // A stout, leaning trunk under a dome of silvery green, with curtains of it hanging round the rim; golden twigs in winter.
    const dome: Cluster[] = [
      [0.9, 3.5, 0.3, 1.15, WILLOW],
      [-0.85, 3.45, -0.4, 1.1, WILLOW_DEEP],
      [0.1, 3.6, -1.0, 1.05, WILLOW],
      [-0.2, 3.5, 1.0, 1.0, WILLOW_DEEP],
      [0.2, 4.15, 0.0, 1.1, WILLOW_TOP],
    ];
    const curtains: Cluster[] = [];
    const n = detail ? 9 : 6;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.3;
      const r = 1.85 + 0.25 * Math.sin(i * 2.3);
      curtains.push([Math.cos(a) * r, 2.45 + 0.2 * Math.sin(i * 1.7), Math.sin(a) * r, 0.5 + 0.08 * Math.sin(i * 3.1), [WILLOW, WILLOW_TOP, WILLOW_DEEP][i % 3]!]);
    }
    const top = trunk(m, 2.2, 0.36, 0.35, 0.1, 2, detail ? 8 : 6, WILLOW_BARK, detail ? 6 : 4, WILLOW_BARK);
    boughs(m, top, dome, 5, 0.19, WILLOW_BARK);
    boughs(m, [top[0], top[1] + 0.6, top[2]], curtains, n, 0.07, WILLOW_BARK);
    twigs(m, dome, detail ? 4 : 2, TWIG_WILLOW, 7);
    twigs(m, curtains, detail ? 4 : 2, TWIG_WILLOW, 8, 1, 1.5);
    const foliage: Foliage = { tint: TINT.lateLeaf, autumn: AUTUMN.willow, twig: TWIG_WILLOW };
    crown(m, dome, detail, 0.7, 97, foliage);
    // The curtains: long, narrow heaps hanging from the rim.
    crown(m, curtains, 0, [0.9, 2.3, 0.9], 101, foliage);
    return m.build({ ao: treeAO });
  },
  // ---- trees, far off: a few facets, each still a leaf that turns and falls; a few slivers of bough for the winter ----
  farBroad: () => {
    const m = new PlantMesher();
    m.add(new CylinderGeometry(0.2, 0.32, 2.6, 4, 1, true), TRUNK, at(0.1, 1.3, 0), 0.1);
    const lumps: Cluster[] = [
      [0.3, 3.7, 0, 1.6, LIME_DEEP],
      [-0.4, 4.3, 0.2, 1.4, LIME],
      [0.2, 4.9, -0.3, 1.1, LIME_TOP],
    ];
    twigs(m, lumps, 2, TWIG, 9, 0, 0.85);
    m.season(TINT.leaf, GROW.leaf, { alt: [...AUTUMN.oak, ...AUTUMN.round], pivot: "face", key: "face" });
    lumps.forEach(([x, y, z, r, color], i) => m.add(new IcosahedronGeometry(r, 0), color, at(x, y, z, i, [1, 0.8, 1]), 0.08));
    return m.build({ ao: treeAO });
  },
  farBirch: () => {
    const m = new PlantMesher();
    m.add(new CylinderGeometry(0.08, 0.17, 4.6, 4, 1, true), BIRCH, at(0.1, 2.3, -0.05), 0.1);
    const lumps: Cluster[] = [
      [0.1, 3.7, 0, 1.0, BIRCH_LEAF_DEEP],
      [0.0, 4.6, 0.1, 0.9, BIRCH_LEAF],
      [0.15, 5.3, -0.05, 0.6, BIRCH_LEAF],
    ];
    twigs(m, lumps, 2, TWIG_BIRCH, 10, 0.35, 0.95);
    m.season(TINT.earlyLeaf, GROW.leaf, { alt: AUTUMN.birch, pivot: "face", key: "face" });
    lumps.forEach(([x, y, z, r, color], i) => m.add(new IcosahedronGeometry(r, 0), color, at(x, y, z, i, [1, 1.05, 1]), 0.08));
    return m.build({ ao: treeAO });
  },
  farBlossom: () => {
    const m = new PlantMesher();
    m.add(new CylinderGeometry(0.16, 0.26, 2, 4, 1, true), CHERRY_BARK, at(0.05, 1, 0), 0.1);
    const lumps: Cluster[] = [
      [0.2, 2.9, 0, 1.3, LIME],
      [-0.3, 3.4, 0.2, 1.1, LIME_TOP],
    ];
    twigs(m, lumps, 2, 0xa8847c, 11, 0, 0.85);
    m.season(TINT.leaf, GROW.leaf, { alt: AUTUMN.blossom, pivot: "face", key: "face" });
    lumps.forEach(([x, y, z, r, color], i) => m.add(new IcosahedronGeometry(r, 0), color, at(x, y, z, i, [1, 0.8, 1]), 0.08));
    m.season(TINT.none, GROW.blossom, { pivot: "face", key: "face" });
    lumps.forEach(([x, y, z, r], i) => m.add(new IcosahedronGeometry(r * 1.06, 0), i ? BLOSSOM_LIGHT : BLOSSOM_DEEP, at(x, y, z, i + 0.6, [1, 0.8, 1]), 0.08));
    return m.build({ ao: treeAO });
  },
  farConifer: () => {
    const m = new PlantMesher();
    m.add(new CylinderGeometry(0.14, 0.22, 1.4, 4, 1, true), TRUNK, at(0, 0.7, 0), 0.1);
    m.season(TINT.needle, GROW.none, { alt: winterNeedle(PINE) }).add(new ConeGeometry(1.5, 2.9, 6), PINE, at(0, 2.4, 0), 0.08);
    m.season(TINT.needle, GROW.none, { alt: winterNeedle(PINE_LIGHT) }).add(new ConeGeometry(1.0, 2.4, 6), PINE_LIGHT, at(0, 3.9, 0, 0.5), 0.08);
    return m.build({ ao: treeAO });
  },
  farSpruce: () => {
    const m = new PlantMesher();
    m.add(new CylinderGeometry(0.14, 0.2, 1.2, 4, 1, true), TRUNK_DARK, at(0, 0.6, 0), 0.1);
    m.season(TINT.needle, GROW.none, { alt: winterNeedle(SPRUCE_DEEP) }).add(new ConeGeometry(1.36, 3.4, 6), SPRUCE_DEEP, at(0, 2.3, 0), 0.08);
    m.season(TINT.needle, GROW.none, { alt: winterNeedle(SPRUCE) }).add(new ConeGeometry(0.95, 3.2, 6), SPRUCE, at(0, 4.2, 0, 0.5), 0.08);
    m.season(TINT.needle, GROW.none, { alt: winterNeedle(SPRUCE_LIGHT) }).add(new ConeGeometry(0.5, 2.6, 5), SPRUCE_LIGHT, at(0, 5.7, 0, 0.2), 0.08);
    return m.build({ ao: treeAO });
  },
  // ---- bushes ----
  /** A leafy bush, with a few blossoms (white, pink, a touch of yellow) scattered over it in their weeks; a mound of twigs in winter. */
  bush: (blossoms = 5) => {
    const m = new PlantMesher();
    const lumps: [number, number, number, number, number, number, number][] = [
      [0, 0.42, 0, 0.62, LIME_DEEP, 1.25, 3],
      [0.48, 0.38, 0.18, 0.46, LIME, 1, 5],
      [-0.38, 0.36, -0.22, 0.42, LIME_TOP, 1, 7],
      [0.1, 0.3, 0.5, 0.36, LEAF_SHADE, 1, 9],
      [-0.2, 0.62, 0.25, 0.3, LIME, 1, 13],
    ];
    twigs(m, [[0, 0.1, 0, 0.72, 0], [0.3, 0.1, 0.2, 0.5, 0], [-0.25, 0.1, -0.1, 0.5, 0]], 4, TWIG, 12, 0, 1);
    m.season(TINT.leaf, GROW.leaf, { alt: AUTUMN.bush, pivot: "face", key: "face" });
    lumps.forEach(([x, y, z, r, color, wide, seed], i) => m.add(lumpy(new IcosahedronGeometry(r, i ? 0 : 1), seed, i ? 0.16 : 0.14), color, at(x, y, z, i * 0.7, [wide, i ? 0.85 : 0.8, 1]), 0.1));
    for (let i = 0; i < blossoms; i++) {
      const a = i * 2.39996;
      const up = 0.35 + 0.5 * fract(i * 0.618);
      const r = 0.62 * Math.sqrt(1 - up * up * 0.6) + 0.1;
      m.season(TINT.none, GROW.flower, { key: fract(i * 0.37) });
      m.add(new OctahedronGeometry(0.07, 0), [0xfdf8f2, BLOSSOM, 0xf6e27a, BLOSSOM_LIGHT][i % 4]!, at(Math.cos(a) * r * 1.2, 0.4 + up * 0.38, Math.sin(a) * r, a, [1, 0.6, 1]), 0.04);
    }
    return m.build({ ao: groundAO(0.55, 0.9, 0.72) });
  },
  /** A bush far off: two heaps of leaves. */
  farBush: () => {
    const m = new PlantMesher();
    m.season(TINT.leaf, GROW.leaf, { alt: AUTUMN.bush, pivot: "face", key: "face" });
    m.add(lumpy(new IcosahedronGeometry(0.66, 0), 3, 0.16), LIME_DEEP, at(0, 0.42, 0, 0, [1.3, 0.82, 1.05]), 0.1);
    m.add(lumpy(new IcosahedronGeometry(0.44, 0), 5, 0.16), LIME, at(0.42, 0.42, 0.2, 0.7, [1, 0.9, 1]), 0.1);
    return m.build({ ao: groundAO(0.55, 0.9, 0.72) });
  },
  fern: () => {
    const m = new PlantMesher();
    // Fronds arching out from the middle, each a bent strip of two-sided triangles; bracken-brown by late autumn.
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
      m.season(TINT.leaf, GROW.none, { alt: [0xd3a868, 0xc99a62, 0xdbb777][i % 3]!, key: fract(i * 0.23) });
      m.triangles([0, 0.05, 0, mid[0]! + px, mid[1]!, mid[2]! + pz, mid[0]! - px, mid[1]!, mid[2]! - pz, 0, 0.05, 0, mid[0]! - px, mid[1]!, mid[2]! - pz, mid[0]! + px, mid[1]!, mid[2]! + pz], color);
      m.triangles([mid[0]! - px, mid[1]!, mid[2]! - pz, mid[0]! + px, mid[1]!, mid[2]! + pz, tip[0]!, tip[1]!, tip[2]!, mid[0]! + px, mid[1]!, mid[2]! + pz, mid[0]! - px, mid[1]!, mid[2]! - pz, tip[0]!, tip[1]!, tip[2]!], color);
    }
    m.season(TINT.leaf, GROW.none, { alt: 0xc99a62 }).add(lumpy(new IcosahedronGeometry(0.16, 0), 29, 0.2), LEAF_SHADE, at(0, 0.1, 0), 0.1);
    return m.build({ ao: groundAO(0.55, 0.6, 0.8) });
  },
  /** Gorse: a dark, spiny mound, flecked with yellow most of the warm year. */
  gorse: () => {
    const m = new PlantMesher();
    const greens = [0x5f9150, 0x6c9c55, 0x578848];
    ([[0, 0.48, 0, 0.6, 1.15], [0.45, 0.4, 0.2, 0.42, 1], [-0.4, 0.42, -0.15, 0.45, 1], [0.05, 0.36, -0.5, 0.36, 1], [0.1, 0.7, 0.15, 0.36, 1]] as const).forEach(([x, y, z, r, wide], i) =>
      m.add(chip(lumpy(new IcosahedronGeometry(r, 0), 31 + i * 5, 0.2), 17 + i, 2, 0.84), greens[i % 3]!, at(x, y, z, i, [wide, 0.95, 1]), 0.1),
    );
    // Spines of new growth, and its flowers.
    for (let i = 0; i < 7; i++) {
      const a = i * 2.39996;
      const r = 0.25 + 0.3 * fract(i * 0.618);
      m.add(new ConeGeometry(0.05, 0.42, 3, 1, true), greens[(i + 1) % 3]!, at(Math.cos(a) * r, 0.86 + 0.12 * fract(i * 0.41), Math.sin(a) * r, a, 1, Math.sin(a) * 0.35, -Math.cos(a) * 0.35), 0.08);
    }
    for (let i = 0; i < 6; i++) {
      const a = i * 2.39996 + 0.7;
      const up = 0.25 + 0.65 * fract(i * 0.618);
      const r = 0.62 * Math.sqrt(1 - up * up * 0.55) + 0.06;
      m.season(TINT.none, GROW.long, { key: fract(i * 0.29) });
      m.add(new OctahedronGeometry(0.075, 0), i % 3 ? 0xf7d84c : 0xf9e476, at(Math.cos(a) * r * 1.1, 0.42 + up * 0.5, Math.sin(a) * r, a, [1, 0.7, 1]), 0.04);
    }
    return m.build({ ao: groundAO(0.55, 0.9, 0.72) });
  },
  /** A mound of heather: a low, wide hummock, purple while it flowers. */
  heatherMound: () => {
    const m = new PlantMesher();
    const purples = [0xb986d8, 0xc79be2, 0xa977cf, 0xd0a8e6];
    ([[0, 0.2, 0, 0.72, [1.45, 0.5, 1.2], 0x8fa462], [0.7, 0.16, 0.3, 0.45, [1.2, 0.5, 1], 0x869a5a], [-0.6, 0.15, -0.35, 0.42, [1.2, 0.5, 1.1], 0x97aa66], [0.1, 0.17, -0.6, 0.4, [1.2, 0.5, 1], 0x8fa462]] as const).forEach(([x, y, z, r, s, color], i) => {
      m.season(TINT.heather, GROW.none, { alt: purples, key: "face" });
      m.add(lumpy(new IcosahedronGeometry(r, 0), 41 + i * 3, 0.2), color, at(x, y, z, i * 1.1, s as unknown as [number, number, number]), 0.12);
    });
    return m.build({ ao: groundAO(0.6, 0.5, 0.8) });
  },
  // ---- rocks: chipped facets, warm layered strata ----
  boulder: () => {
    const strata: Paint = (_x, y) => [ROCK, ROCK_WARM, ROCK_PALE, ROCK][Math.floor((y + 2) * 3.2) % 4]!;
    return new PlantMesher()
      .add(chip(lumpy(new IcosahedronGeometry(0.9, 1), 3, 0.14), 3, 4, 0.8), strata, at(0, 0.32, 0, 0, [1.3, 0.78, 1.08]), 0.07)
      .add(chip(lumpy(new IcosahedronGeometry(0.42, 0), 5, 0.2), 5, 2, 0.78), ROCK_WARM, at(0.85, 0.1, 0.35, 0.8), 0.08)
      .build({ ao: groundAO(0.55, 0.9, 0.7) });
  },
  slab: () => {
    // A low shelf of layered stone: bands of warm and pale rock, its top chipped flat.
    const strata: Paint = (_x, y) => [ROCK_PALE, ROCK, ROCK_WARM][Math.floor((y + 1) * 7) % 3]!;
    return new PlantMesher()
      .add(chip(lumpy(new IcosahedronGeometry(1, 1), 13, 0.12), 13, 4, 0.72), strata, at(0, 0.18, 0, 0, [1.5, 0.42, 1.1]), 0.06)
      .add(chip(lumpy(new IcosahedronGeometry(0.4, 0), 15, 0.2), 15, 2, 0.8), ROCK_PALE, at(-1.0, 0.12, 0.55, 1.1, [1, 0.6, 1]), 0.08)
      .build({ ao: groundAO(0.6, 0.6, 0.72) });
  },
  // ---- deadwood ----
  /** A fallen trunk: its bark going, pale where it broke, moss along its top, a stub of a branch, bracket fungi on its side. */
  log: () => {
    const m = new PlantMesher();
    const bark: Paint = (x, y) => (y > 0.36 ? MOSS : fract(x * 1.7) < 0.2 ? TRUNK : TRUNK_DARK);
    // Along x, 2.6 m, lying a little into the ground.
    m.add(new CylinderGeometry(0.21, 0.25, 2.6, 7, 3, true), bark, at(0, 0.2, 0, 0, 1, 0, Math.PI / 2), 0.12);
    m.add(new ConeGeometry(0.24, 0.1, 7, 1, true), CUT_WOOD, at(-1.32, 0.2, 0, 0, 1, 0, Math.PI / 2), 0.05);
    m.add(new ConeGeometry(0.2, 0.34, 6, 1, true), CUT_WOOD, at(1.42, 0.2, 0, 0, [1, 1, 1], 0, -Math.PI / 2), 0.1);
    m.add(new CylinderGeometry(0.05, 0.08, 0.5, 4, 1, true), TRUNK_DARK, between(0.35, 0.3, 0.05, 0.6, 0.62, 0.3, 1), 0.1);
    // Bracket fungi: little shelves out of its side.
    for (const [x, z, r] of [[-0.6, 0.23, 0.13], [-0.4, 0.24, 0.1], [0.7, -0.23, 0.11]] as const) {
      const out = Math.sign(z);
      m.triangles([x - r, 0.22, z, x + r, 0.22, z, x, 0.25, z + out * r * 0.6, x + r, 0.22, z, x - r, 0.22, z, x, 0.25, z + out * r * 0.6], 0xf0c9a0, 0.06);
    }
    return m.build({ ao: groundAO(0.55, 0.5, 0.75) });
  },
  /** A stump: cut flat, its rings showing, moss on its roots, a shoot or two of mushrooms beside it in autumn. */
  stump: () => {
    const m = new PlantMesher();
    trunk(m, 0.42, 0.34, 0, 0, 1, 8, TRUNK_DARK, 0, TRUNK_DARK);
    // Its roots, splayed out low (a standing tree's would reach above where it was cut).
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.4;
      const reach = 0.5 + 0.1 * Math.sin(i * 2.7);
      m.add(new ConeGeometry(0.15, 0.5, 4, 1, true), TRUNK_DARK, between(Math.sin(a) * reach, 0.02, Math.cos(a) * reach, Math.sin(a) * 0.12, 0.3, Math.cos(a) * 0.12, 1), 0.1);
    }
    // Its cut top: the pale wood and a darker heart, as two fans.
    flowerHead(m, 0, 0.422, 0, 0.19, 4, CUT_WOOD, 0.3);
    flowerHead(m, 0.01, 0.428, 0.01, 0.09, 3, 0xd6b88a, 0.9);
    m.add(lumpy(new IcosahedronGeometry(0.16, 0), 7, 0.2), MOSS, at(0.3, 0.08, 0.12, 0, [1.2, 0.5, 1]), 0.08);
    for (const [x, z, h] of [[0.44, -0.1, 0.16]] as const) {
      m.season(TINT.none, GROW.autumn, { pivot: [x, 0, z], key: fract(x * 3.3) });
      m.add(new CylinderGeometry(0.018, 0.024, h, 4, 1, true), 0xf3ead8, at(x, h / 2, z), 0.04);
      m.add(new ConeGeometry(0.07, 0.05, 6, 1, true), 0xe9a07c, at(x, h + 0.02, z), 0.06);
    }
    return m.build({ ao: groundAO(0.55, 0.5, 0.75) });
  },
  // ---- the water's edge ----
  /** A stand of reeds: tall blades with feathery plumes, straw-coloured from the autumn until the new growth. */
  reeds: () => {
    const m = new PlantMesher();
    const greens = [0x9cc264, 0x8ab65a, 0xa9cb6c, 0x93bd5f];
    for (let i = 0; i < 13; i++) {
      const a = i * 2.39996;
      const off = 0.08 + 0.36 * Math.sqrt(fract(i * 0.618));
      const h = 1.55 + 0.75 * fract(i * 0.37);
      const lean = 0.05 + 0.1 * fract(i * 0.71);
      const bx = Math.sin(a) * off;
      const bz = Math.cos(a) * off;
      const tx = bx + Math.sin(a) * lean * h;
      const tz = bz + Math.cos(a) * lean * h;
      m.season(TINT.reed, GROW.none, { alt: [STRAW, STRAW_PALE, 0xd3bf84][i % 3]!, key: fract(i * 0.23) });
      blade(m, bx, bz, a + 1.2, 0.035, tx, h, tz, greens[i % 4]!);
      // Every other one carries a plume.
      if (i % 3 === 0) m.season(TINT.reed, GROW.none, { alt: 0xefe6cc, key: fract(i * 0.23) }).add(new OctahedronGeometry(0.06, 0), 0xb6a4a8, at(tx + Math.sin(a) * 0.03, h + 0.06, tz + Math.cos(a) * 0.03, a, [1, 3.2, 1], 0.25 * Math.cos(a), -0.25 * Math.sin(a)), 0.06);
    }
    return m.build({ ao: groundAO(0.6, 0.9, 1), normals: "up" });
  },
  /** A stand of reeds far off: a few broad strokes of it. */
  farReeds: () => {
    const m = new PlantMesher();
    for (let i = 0; i < 5; i++) {
      const a = i * 2.39996;
      const off = 0.12 + 0.3 * Math.sqrt(fract(i * 0.618));
      const h = 1.3 + 0.7 * fract(i * 0.37);
      const bx = Math.sin(a) * off;
      const bz = Math.cos(a) * off;
      m.season(TINT.reed, GROW.none, { alt: [STRAW, STRAW_PALE][i % 2]!, key: fract(i * 0.23) });
      blade(m, bx, bz, a + 1.2, 0.11, bx + Math.sin(a) * 0.12 * h, h, bz + Math.cos(a) * 0.12 * h, [0x9cc264, 0x8ab65a, 0xa9cb6c][i % 3]!);
    }
    return m.build({ ao: groundAO(0.6, 0.9, 1), normals: "up" });
  },
  /** Cattails: broad blades and brown, velvet heads on their stalks. */
  cattails: () => {
    const m = new PlantMesher();
    const greens = [0x8fba5c, 0x7fae54, 0x9bc566];
    for (let i = 0; i < 8; i++) {
      const a = i * 2.39996 + 0.5;
      const off = 0.06 + 0.26 * Math.sqrt(fract(i * 0.618));
      const h = 1.1 + 0.6 * fract(i * 0.43);
      const lean = 0.1 + 0.16 * fract(i * 0.71);
      const bx = Math.sin(a) * off;
      const bz = Math.cos(a) * off;
      m.season(TINT.reed, GROW.none, { alt: [STRAW, 0xd3bf84][i % 2]!, key: fract(i * 0.31) });
      blade(m, bx, bz, a + 1.2, 0.06, bx + Math.sin(a) * lean * h, h, bz + Math.cos(a) * lean * h, greens[i % 3]!);
    }
    for (const [x, z, h] of [[0.05, 0.02, 1.5], [-0.14, 0.1, 1.28], [0.12, -0.13, 1.38], [-0.04, -0.2, 1.12]] as const) {
      m.season(TINT.reed, GROW.none, { alt: STRAW, key: fract(x * 5.1) });
      blade(m, x, z, x * 9, 0.014, x, h, z, 0x8fb65c);
      m.plain().add(new CylinderGeometry(0.036, 0.036, 0.2, 5, 1, true), 0x7d5843, at(x, h - 0.02, z), 0.08);
      m.add(new ConeGeometry(0.012, 0.16, 3, 1, true), 0xb9a878, at(x, h + 0.16, z), 0.04);
    }
    return m.build({ ao: groundAO(0.6, 0.8, 1), normals: "up" });
  },
  /** A stand of rushes: stiff, dark, knee-high, with brown tufts near their tips; green the year round. */
  rushes: () => {
    const m = new PlantMesher();
    const greens = [0x6fa04e, 0x7bab55, 0x65964a];
    for (let i = 0; i < 14; i++) {
      const a = i * 2.39996;
      const off = 0.05 + 0.3 * Math.sqrt(fract(i * 0.618));
      const h = 0.62 + 0.4 * fract(i * 0.37);
      const lean = 0.12 + 0.2 * fract(i * 0.71);
      const bx = Math.sin(a) * off;
      const bz = Math.cos(a) * off;
      const tx = bx + Math.sin(a) * lean * h;
      const tz = bz + Math.cos(a) * lean * h;
      m.season(TINT.reed, GROW.none, { alt: 0xa9b06a, key: fract(i * 0.23) });
      blade(m, bx, bz, a + 1.2, 0.022, tx, h, tz, greens[i % 3]!);
      if (i % 3 === 0) m.plain().add(new OctahedronGeometry(0.035, 0), 0x9a6f4c, at(bx + (tx - bx) * 0.82, h * 0.82, bz + (tz - bz) * 0.82, a, [1, 1.6, 1]), 0.06);
    }
    return m.build({ ao: groundAO(0.6, 0.5, 1), normals: "up" });
  },
  // ---- flowers: a handful of shapes, cheap but each its own; they rise in their weeks and sink back after ----
  daisy: (n = 5) => {
    const m = new PlantMesher();
    for (const [x, z, h] of ([[0, 0, 0.36], [0.13, 0.07, 0.29], [-0.09, 0.11, 0.25], [0.05, -0.12, 0.31], [-0.12, -0.06, 0.22]] as const).slice(0, n)) {
      m.season(TINT.none, GROW.long, { pivot: [x, 0, z], key: fract(x * 7.7 + 0.2) });
      blade(m, x, z, x * 9, 0.012, x, h, z, 0x78ad52);
      flowerHead(m, x, h, z, 0.075, 8, 0xfdfcf6, x * 7 + z);
      m.add(new ConeGeometry(0.026, 0.025, 3, 1, true), 0xf4c143, at(x, h + 0.012, z), 0);
    }
    m.season(TINT.grass, GROW.long, { alt: 0xc6cf8a, pivot: [0, 0, 0], key: 0.1 });
    blade(m, 0, 0, 0.6, 0.04, 0.12, 0.12, -0.05, 0x82b450);
    blade(m, 0, 0, 2.4, 0.04, -0.1, 0.11, 0.06, 0x82b450);
    return m.build({ ao: lowAO, normals: "up" });
  },
  lupine: (n = 3) => {
    const m = new PlantMesher();
    for (const [x, z, h, hue] of ([[0, 0, 0.5, 0], [0.12, 0.06, 0.4, 1], [-0.1, 0.08, 0.44, 2]] as const).slice(0, n)) {
      m.season(TINT.none, GROW.flower, { pivot: [x, 0, z], key: fract(x * 5.3 + 0.4) });
      blade(m, x, z, hue * 1.3, 0.014, x, h, z, 0x76ab50);
      const colors = [[0x9a74d8, 0x8b64ca, 0xb79ae4], [0xc98ad8, 0xb877cc, 0xdba8e4], [0x7f8fe0, 0x6e7fd4, 0xa2aeea]][hue]!;
      // A spike of florets: stacked cones narrowing upwards, darker below.
      for (let i = 0; i < 3; i++) m.add(new ConeGeometry(0.06 - i * 0.014, 0.14, 5, 1, true), colors[i]!, at(x, h + i * 0.1, z, i), 0);
    }
    m.season(TINT.grass, GROW.flower, { alt: 0xc2cc86, pivot: [0.02, 0, 0.02], key: 0.1 });
    for (let i = 0; i < 5; i++) blade(m, 0.02, 0.02, i * 1.26, 0.03, 0.02 + Math.cos(i * 1.26) * 0.14, 0.07, 0.02 + Math.sin(i * 1.26) * 0.14, 0x7cb04e);
    return m.build({ ao: lowAO, normals: "up" });
  },
  lavender: (n = 7) => {
    const m = new PlantMesher();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const lean = 0.22 + (i % 3) * 0.06;
      const h = 0.4 + (i % 2) * 0.08;
      const tx = Math.sin(a) * (0.05 + h * lean);
      const tz = Math.cos(a) * (0.05 + h * lean);
      // Its grey-green stems come up first, and their heads with the summer.
      m.season(TINT.grass, GROW.flower, { alt: 0xb9bf94, pivot: [0, 0, 0], key: 0.05 });
      blade(m, Math.sin(a) * 0.05, Math.cos(a) * 0.05, a, 0.01, tx, h, tz, 0x8aa86a);
      m.season(TINT.none, GROW.flower, { pivot: [tx, h, tz], key: 0.3 + 0.7 * fract(i * 0.37) });
      m.add(new OctahedronGeometry(0.03, 0), i % 2 ? 0xb594e2 : 0xa27fd6, at(tx, h + 0.04, tz, a, [1, 2.6, 1], lean), 0);
    }
    return m.build({ ao: lowAO, normals: "up" });
  },
  buttercup: (n = 6) => {
    const m = new PlantMesher();
    for (const [x, z, h] of ([[0, 0, 0.3], [0.1, 0.08, 0.24], [-0.08, 0.1, 0.27], [0.06, -0.1, 0.21], [-0.11, -0.05, 0.18], [0.14, -0.03, 0.15]] as const).slice(0, n)) {
      m.season(TINT.none, GROW.flower, { pivot: [x, 0, z], key: fract(x * 6.1 + 0.6) });
      blade(m, x, z, x * 11 + z, 0.01, x, h, z, 0x7fb24f);
      // A little cup: a cone upside down, its yellow rim facing the sky.
      m.add(new ConeGeometry(0.045, 0.04, 5), 0xf7d548, at(x, h + 0.015, z, x * 5, 1, 0, Math.PI), 0);
    }
    m.season(TINT.grass, GROW.flower, { alt: 0xc6cf8a, pivot: [0, 0, 0], key: 0.1 });
    for (let i = 0; i < 3; i++) blade(m, 0, 0, i * 2.1, 0.035, Math.cos(i * 2.1) * 0.12, 0.05, Math.sin(i * 2.1) * 0.12, 0x86b955);
    return m.build({ ao: lowAO, normals: "up" });
  },
  campion: (n = 4) => {
    const m = new PlantMesher();
    for (const [x, z, h] of ([[0, 0, 0.38], [0.11, 0.06, 0.32], [-0.09, 0.08, 0.28], [0.03, -0.11, 0.25]] as const).slice(0, n)) {
      m.season(TINT.none, GROW.flower, { pivot: [x, 0, z], key: fract(x * 4.9 + 0.1) });
      blade(m, x, z, x * 13, 0.011, x, h, z, 0x7aa84f);
      flowerHead(m, x, h, z, 0.065, 5, 0xf1a2b8, x * 4);
      m.add(new ConeGeometry(0.018, 0.02, 3, 1, true), 0xc0607e, at(x, h + 0.008, z), 0);
    }
    m.season(TINT.grass, GROW.flower, { alt: 0xc6cf8a, pivot: [0, 0, 0], key: 0.1 });
    blade(m, 0, 0, 1.1, 0.035, 0.1, 0.09, 0.05, 0x7fb24f);
    return m.build({ ao: lowAO, normals: "up" });
  },
  /** Wood anemones: white stars low over their leaves, a carpet under the bare trees in April; gone by June. */
  anemone: () => {
    const m = new PlantMesher();
    for (const [x, z, h] of [[0, 0, 0.16], [0.22, 0.1, 0.13], [-0.18, 0.15, 0.14], [0.08, -0.22, 0.12], [-0.22, -0.13, 0.15]] as const) {
      m.season(TINT.none, GROW.spring, { pivot: [x, 0, z], key: fract(x * 3.7 + z * 2.1 + 0.5) });
      flowerHead(m, x, h, z, 0.07, 3, 0xfdfbf6, x * 5 + z * 3);
      flowerHead(m, x, h + 0.004, z, 0.07, 3, 0xfdfbf6, x * 5 + z * 3 + 1.05);
      m.add(new ConeGeometry(0.016, 0.018, 3, 1, true), 0xf2d667, at(x, h + 0.01, z), 0);
      // Its leaves: a low collar under the flower.
      for (let l = 0; l < 2; l++) {
        const a = x * 7 + l * 3.1;
        blade(m, x, z, a + 1.4, 0.035, x + Math.cos(a) * 0.1, h * 0.6, z + Math.sin(a) * 0.1, l % 2 ? 0x76ab50 : 0x86b85a);
      }
    }
    return m.build({ ao: lowAO, normals: "up" });
  },
  /** Heather underfoot: a low tuft of wiry sprigs, their tips purple late in August. */
  heather: () => {
    const m = new PlantMesher();
    const purples = [0xba88d9, 0xc99de3, 0xab79d0];
    for (let i = 0; i < 6; i++) {
      const a = i * 2.39996;
      const off = 0.04 + 0.24 * Math.sqrt(fract(i * 0.618));
      const h = 0.2 + 0.16 * fract(i * 0.37);
      const lean = 0.25 + 0.35 * fract(i * 0.71);
      const bx = Math.sin(a) * off;
      const bz = Math.cos(a) * off;
      const tx = bx + Math.sin(a) * lean * h;
      const tz = bz + Math.cos(a) * lean * h;
      m.plain();
      blade(m, bx, bz, a + 1.2, 0.03, tx, h * 0.7, tz, [0x7f9658, 0x8ba260, 0x768c52][i % 3]!);
      m.season(TINT.heather, GROW.none, { alt: purples[i % 3]!, key: fract(i * 0.23) });
      m.add(new ConeGeometry(0.055, 0.22, 3, 1, true), [0x94a866, 0x8a9e5e, 0x9db06c][i % 3]!, at(tx, h * 0.84, tz, a, 1, lean * Math.cos(a), -lean * Math.sin(a)), 0.08);
    }
    return m.build({ ao: groundAO(0.6, 0.3, 1), normals: "up" });
  },
  // ---- grass: it pales through the autumn, palest in winter ----
  grass: () => {
    const m = new PlantMesher();
    // Six blades of a tuft.
    const blades: [number, number, number, number, number][] = [
      [0, 0, 0.55, 0.1, 0x9fca55],
      [1.1, 0.06, 0.45, 0.25, 0xb2d465],
      [2.2, 0.05, 0.5, 0.2, 0x8fbf4c],
      [3.3, 0.07, 0.38, 0.3, 0xaed15f],
      [4.4, 0.05, 0.47, 0.22, 0x98c752],
      [5.5, 0.04, 0.42, 0.28, 0xbbd96c],
    ];
    blades.forEach(([a, off, h, lean, color], i) => {
      const bx = Math.sin(a) * off;
      const bz = Math.cos(a) * off;
      m.season(TINT.grass, GROW.none, { alt: [0xd6d59a, 0xe0dba6, 0xccd08e][i % 3]!, key: fract(i * 0.37) });
      blade(m, bx, bz, a, 0.035, bx + Math.sin(a) * lean * h, h, bz + Math.cos(a) * lean * h, color);
    });
    return m.build({ ao: groundAO(0.55, 0.5, 1), normals: "up" });
  },
  lush: (seeds = 0) => {
    const m = new PlantMesher();
    // A low, dense clump: short blades bending out all round (and a stalk or two gone to seed).
    for (const [x, z, h] of ([[0.06, 0.02, 0.62], [-0.05, -0.04, 0.54]] as const).slice(0, seeds)) {
      m.season(TINT.grass, GROW.none, { alt: 0xe2d8a8 });
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
      m.season(TINT.grass, GROW.none, { alt: [0xcfd192, 0xd9d6a0, 0xc6cb88][i % 3]!, key: fract(i * 0.29) });
      blade(m, bx, bz, a, 0.03, bx + Math.sin(a) * lean * h, h, bz + Math.cos(a) * lean * h, [0x8fc24c, 0x9fcd58, 0x83b847, 0xa9d262][i % 4]!);
    }
    return m.build({ ao: groundAO(0.55, 0.35, 1), normals: "up" });
  },
  /** Marram: the dunes' grass, tall, arching, pale blue-green, with a spike or two in seed. */
  marram: () => {
    const m = new PlantMesher();
    for (let i = 0; i < 9; i++) {
      const a = i * 2.39996;
      const off = 0.03 + 0.07 * fract(i * 0.618);
      const h = 0.55 + 0.35 * fract(i * 0.37);
      const lean = 0.35 + 0.4 * fract(i * 0.71);
      const bx = Math.sin(a) * off;
      const bz = Math.cos(a) * off;
      m.season(TINT.grass, GROW.none, { alt: [0xe2d9a6, 0xd9cf98][i % 2]!, key: fract(i * 0.29) });
      blade(m, bx, bz, a, 0.022, bx + Math.sin(a) * lean * h, h, bz + Math.cos(a) * lean * h, [0xb4cf8c, 0xa6c684, 0xc2d898][i % 3]!);
    }
    for (const [x, z, h] of [[0.05, 0.03, 0.95], [-0.06, -0.02, 0.82]] as const) {
      m.season(TINT.grass, GROW.none, { alt: 0xe6dcae });
      blade(m, 0, 0, x * 20, 0.008, x, h, z, 0xc9cf98);
      m.add(new OctahedronGeometry(0.022, 0), 0xe4d9a8, at(x, h + 0.07, z, x * 9, [1, 4, 1]), 0);
    }
    return m.build({ ao: groundAO(0.6, 0.5, 1), normals: "up" });
  },
  /** A tussock of rushes underfoot in the marsh: short, stiff, dark. */
  tussock: () => {
    const m = new PlantMesher();
    for (let i = 0; i < 10; i++) {
      const a = i * 2.39996;
      const off = 0.03 + 0.08 * fract(i * 0.618);
      const h = 0.3 + 0.22 * fract(i * 0.37);
      const lean = 0.2 + 0.35 * fract(i * 0.71);
      const bx = Math.sin(a) * off;
      const bz = Math.cos(a) * off;
      m.season(TINT.reed, GROW.none, { alt: 0xb4b877, key: fract(i * 0.29) });
      blade(m, bx, bz, a, 0.02, bx + Math.sin(a) * lean * h, h, bz + Math.cos(a) * lean * h, [0x72a350, 0x7fae57, 0x68984b][i % 3]!);
    }
    return m.build({ ao: groundAO(0.55, 0.3, 1), normals: "up" });
  },
  // ---- underfoot ----
  clover: () => {
    const m = new PlantMesher();
    // Trefoils: three heart-ish leaflets each, flat to the ground, and two small blossoms.
    m.season(TINT.grass, GROW.none, { alt: 0xb9c97c });
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
    m.season(TINT.none, GROW.long, { pivot: [0.05, 0.05, 0.02], key: 0.3 }).add(new ConeGeometry(0.03, 0.05, 4, 1, true), 0xf6f0f4, at(0.05, 0.11, 0.02), 0);
    m.season(TINT.none, GROW.long, { pivot: [-0.08, 0.05, -0.06], key: 0.7 }).add(new ConeGeometry(0.026, 0.045, 4, 1, true), 0xf2c6dc, at(-0.08, 0.1, -0.06), 0);
    return m.build({ ao: groundAO(0.7, 0.12, 1), normals: "up" });
  },
  pebbles: () => {
    const m = new PlantMesher();
    for (const [x, z, r, color, sides] of [[0, 0, 0.09, 0xcfc0b2, 20], [0.16, 0.07, 0.06, 0xb9aea4, 8], [-0.12, 0.1, 0.07, 0xdcccbc, 20], [0.05, -0.15, 0.05, 0xc4b2a6, 8]] as const) {
      const stone = sides === 20 ? new IcosahedronGeometry(r, 0) : new OctahedronGeometry(r, 0);
      m.add(chip(lumpy(stone, x * 31 + z, 0.25), x * 13 + 1, 1, 0.75), color, at(x, r * 0.35, z, x * 7, [1.2, 0.6, 1]), 0.06);
    }
    return m.build({ ao: groundAO(0.7, 0.08, 0.8) });
  },
  /** Mushrooms, up in the autumn: red caps with pale stems, and a brown one. */
  mushrooms: () => {
    const m = new PlantMesher();
    for (const [x, z, h, r, cap] of [[0, 0, 0.13, 0.075, 0xea8a74], [0.13, 0.06, 0.09, 0.055, 0xef9a80], [-0.1, 0.1, 0.07, 0.05, 0xc99a6c], [0.04, -0.14, 0.1, 0.06, 0xe57f6c]] as const) {
      m.season(TINT.none, GROW.autumn, { pivot: [x, 0, z], key: fract(x * 4.3 + z * 2.9 + 0.5) });
      m.add(new CylinderGeometry(0.016, 0.024, h, 3, 1, true), 0xf6efe0, at(x, h / 2, z), 0.04);
      m.add(new ConeGeometry(r, r * 0.75, 6, 1, true), cap, at(x, h + r * 0.3, z, x * 9), 0.06);
    }
    return m.build({ ao: groundAO(0.7, 0.1, 0.85) });
  },
  /** Fallen leaves: a strewing of them lying where they fell, gold and amber, fading by midwinter; gone by spring. */
  litter: () => {
    const m = new PlantMesher();
    const golds = [GOLD, AMBER, ORANGE, YELLOW, CORAL, RUSSET, GOLD, AMBER];
    for (let i = 0; i < 14; i++) {
      const a = i * 2.39996;
      const r = 0.08 + 0.5 * Math.sqrt(fract(i * 0.618 + 0.1));
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const t = i * 1.7;
      const s = 0.055 + 0.03 * fract(i * 0.41);
      const y = 0.035 + 0.012 * (i % 3);
      m.season(TINT.needle, GROW.litter, { alt: [0xd8c097, 0xcfb58a, 0xdcc8a2][i % 3]!, pivot: [x, y, z], key: fract(i * 0.21 + 0.05) });
      // A leaf: a little kite lying flat, facing up.
      const ax = Math.cos(t) * s * 1.5;
      const az = Math.sin(t) * s * 1.5;
      const bx = -Math.sin(t) * s * 0.7;
      const bz = Math.cos(t) * s * 0.7;
      m.triangles([x - ax, y, z - az, x + bx, y + 0.012, z + bz, x + ax, y, z + az, x - ax, y, z - az, x + ax, y, z + az, x - bx, y + 0.012, z - bz], golds[i % golds.length]!);
    }
    return m.build({ ao: groundAO(0.8, 0.08, 1), normals: "up" });
  },
  /** Driftwood on the shore: a bleached, forked branch among a few stones. */
  driftwood: () => {
    const m = new PlantMesher();
    const pale = 0xdcd2c2;
    m.add(new CylinderGeometry(0.035, 0.06, 1, 5, 1, true), pale, between(-0.42, 0.05, -0.05, 0.3, 0.1, 0.06, 1), 0.08);
    m.add(new CylinderGeometry(0.02, 0.035, 1, 4, 1, true), 0xd2c6b4, between(0.05, 0.08, 0.02, 0.38, 0.2, -0.22, 1), 0.08);
    m.add(new CylinderGeometry(0.015, 0.03, 1, 4, 1, true), pale, between(0.28, 0.1, 0.06, 0.52, 0.16, 0.2, 1), 0.08);
    m.add(new ConeGeometry(0.06, 0.06, 5), 0xe6dccb, at(-0.44, 0.05, -0.05, 0, 1, 0, Math.PI / 2 + 0.1), 0.05);
    for (const [x, z, r, color] of [[-0.1, 0.22, 0.07, 0xcfc0b2], [0.24, -0.1, 0.05, 0xb9aea4]] as const) m.add(chip(lumpy(new OctahedronGeometry(r, 0), x * 31, 0.25), 3, 1, 0.75), color, at(x, r * 0.35, z, x * 7, [1.2, 0.6, 1]), 0.06);
    return m.build({ ao: groundAO(0.7, 0.12, 0.8) });
  },
  /** Lily pads on still water: round leaves with a notch, and a white flower or two in summer; gone in winter. */
  lily: () => {
    const m = new PlantMesher();
    const pads: [number, number, number, number][] = [
      [0, 0, 0.3, 0.3],
      [0.5, 0.22, 0.24, 1.9],
      [-0.38, 0.36, 0.21, 3.7],
      [0.14, -0.5, 0.26, 5.1],
    ];
    pads.forEach(([x, z, r, turn], i) => {
      m.season(TINT.lateLeaf, GROW.leaf, { alt: [0xc5bd6e, 0xb9a968][i % 2]!, pivot: [x, 0.02, z], key: fract(i * 0.23 + 0.1) });
      const pts: number[] = [];
      // Seven of eight wedges: the eighth is its notch.
      for (let k = 0; k < 7; k++) {
        const a = turn + (k / 8) * Math.PI * 2;
        const b = turn + ((k + 1) / 8) * Math.PI * 2;
        pts.push(x, 0.022, z, x + Math.cos(a) * r, 0.02, z - Math.sin(a) * r, x + Math.cos(b) * r, 0.02, z - Math.sin(b) * r);
      }
      m.triangles(pts, [0x86bd5e, 0x79b356, 0x92c466][i % 3]!, 0.06);
    });
    for (const [x, z, s] of [[0.2, 0.08, 1]] as const) {
      m.season(TINT.none, GROW.flower, { pivot: [x, 0.02, z], key: fract(x * 3.1 + 0.4) });
      flowerHead(m, x, 0.05, z, 0.12 * s, 4, 0xfdf7f4, x * 5);
      flowerHead(m, x, 0.08, z, 0.08 * s, 3, 0xfbe3ea, x * 5 + 0.5);
      m.add(new ConeGeometry(0.025 * s, 0.04, 4, 1, true), 0xf5cf57, at(x, 0.1, z), 0);
    }
    return m.build({ ao: groundAO(0.9, 0.05, 1), normals: "up" });
  },
};

export { together };

/** A tree's or a rock's model as it's drawn (so the tests can hold the solids' plan, flora-plan.ts, to it). */
export function plantModel(name: (typeof TREE_KINDS)[number] | "boulder" | "slab" | "log" | "stump", detail: 0 | 1 = 1): BufferGeometry {
  return name === "boulder" || name === "slab" || name === "log" || name === "stump" ? models[name]() : models[name](detail);
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
