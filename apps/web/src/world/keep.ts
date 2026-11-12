import type { WorldNode } from "@galahad/core/world";
import { STATIONS } from "@galahad/core/world";
import { dot, float, fract, mix, smoothstep, uniform, vec3, vertexColor } from "three/tsl";
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Euler,
  Group,
  IcosahedronGeometry,
  Line,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshBasicNodeMaterial,
  MeshLambertNodeMaterial,
  type Object3D,
  OctahedronGeometry,
  PointLight,
  SphereGeometry,
  TorusGeometry,
} from "three/webgpu";
import { headingToSceneYaw, toScene, type Vec3 } from "./coords.ts";
import { DECK_POTS, DECK_TOP, LANDING, onStairs, STAIRS, tread } from "./keep-deck.ts";
import { fleetSlot } from "./keep-plan.ts";
import { at, between, bevelBox, chip, groundAO, lumpy, Mesher, type Paint, within } from "./mesher.ts";
import { occlusionMask } from "./occlusion.ts";
import { seasonState } from "./season.ts";
import { pathSheen, puddleDarken } from "./wet.ts";
import { obstacles, PLACES, planPath, standAt, stationFacing } from "./path.ts";
import { swaying } from "./vegetation.ts";

/*
 * Galahad's keep and its stations, after the treehouse-and-meadow look: a
 * treehouse in a giant tree (a deck with railings and potted plants, stairs with
 * lanterns, a glass-walled room with solar panels), the council's deck table with
 * mugs and a teapot, a telescope platform, a reading nook, a research bunker in a
 * limestone hill (a wide door, monitors, a 3D printer glowing at work, pipes), a
 * lookout with its mast, a vault hut, a radio post with its banner, and a ring of
 * standing stones with runes. Built from primitives into a few merged meshes (the
 * solid one with a baked ambient occlusion, the giant tree's swaying canopy, glass
 * that's sky-blue by day and warm by night, lamps and screens), plus the oracle's
 * orb, the beacon and the fleet's banners. All original shapes, and made the
 * way a carpenter would: decks and tables of planks, shingled roofs, bevelled
 * panels with seams, framed windows with sills, capped posts, stones along the
 * paths.
 */

type Place = keyof typeof STATIONS;

export const C = {
  cream: 0xeee5d2,
  creamShade: 0xdcd0b8,
  orange: 0xe8853a,
  grey: 0x4a4e57,
  greyLight: 0x8b8f97,
  wood: 0xb57c4e,
  woodDark: 0x8b5a39,
  plank: 0xc8915e,
  trunk: 0x9a6644,
  trunkDark: 0x7d5034,
  leaf: 0xaacd4e,
  leafLight: 0xc4dc62,
  leafDeep: 0x8dbb45,
  stone: 0xdac3b3,
  stoneShade: 0xc9b0a3,
  limestone: 0xe9ddc8,
  solar: 0x2e4a86,
  path: 0xd8bb8c,
  plaza: 0xd2b68e,
  book1: 0x6b8fb8,
  book2: 0xc0644a,
  book3: 0x7aa86a,
  pot: 0xc9795a,
};

/** A gable roof: ridge along local x, `w` deep (z), `h` high, `l` long. */
function gable(w: number, h: number, l: number): BufferGeometry {
  const [x0, x1, z0, z1] = [-l / 2, l / 2, -w / 2, w / 2];
  const A = [x0, 0, z0];
  const B = [x1, 0, z0];
  const Cc = [x1, 0, z1];
  const D = [x0, 0, z1];
  const R1 = [x0, h, 0];
  const R2 = [x1, h, 0];
  // The two slopes and the gable ends from outside; and the slopes again from inside, so the roof has an
  // underside: standing under it (as he does at the library), the deck is overhead, not the sky between the shingles.
  const tris = [D, Cc, R2, D, R2, R1, B, A, R1, B, R1, R2, Cc, B, R2, A, D, R1, R2, Cc, D, R1, R2, D, R1, A, B, R2, R1, B];
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(tris.flat()), 3));
  return g;
}

/** Where a station stands, turned so its local +z faces the way it faces. */
export function stationMatrix(place: Place): Matrix4 {
  const s = STATIONS[place];
  const [x, y, z] = toScene(s.x, s.y, 0);
  return at(x, y, z, headingToSceneYaw(stationFacing(place)));
}

/** Label height above each station's ground, metres. */
export const LABEL_HEIGHT: Record<Place, number> = {
  keep: 10.5,
  council: 3.4,
  library: 5.6,
  watchtower: 14.5,
  treasury: 5.2,
  messenger: 10.2,
  forge: 7.2,
  oracle: 4.4,
  observatory: 6.4,
};

/** The council table's top and the lab bench's (each station's own frame): Reachy Mini and the SO-101 arms stand on them (critters.ts). */
export const COUNCIL_TABLE_TOP = 0.87;
export const LAB_BENCH_TOP = 0.93;

/** Heights of the ground's layers (tops), so no two ever share a plane: no z-fighting. */
const PATH_TOP = 0.05;
const STATION_PLAZA_TOP = 0.075;
const KEEP_PLAZA_TOP = 0.1;

interface Parts {
  solid: Mesher;
  canopy: Mesher;
  glass: Mesher;
  /** Lamps, screens, printers: vertex-coloured light. */
  lit: Mesher;
  /** Where the warm lamps and windows glow at night (scene, radius). */
  warm: [number, number, number, number][];
  /** Where screens glow (teal). */
  cool: [number, number, number, number][];
}

/** A point of a station's local frame in the scene. */
function scenePoint(m: Matrix4, x: number, y: number, z: number): [number, number, number] {
  const e = within(m, at(x, y, z)).elements;
  return [e[12]!, e[13]!, e[14]!];
}

/** Posts and two rails along a polyline (scene coordinates, at height `y`), skipping segments flagged in `gaps`. */
function railing(m: Mesher, points: [number, number][], y: number, gaps: Set<number> = new Set()): void {
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, az] = points[i]!;
    const [bx, bz] = points[i + 1]!;
    m.add(board(0.11, 1.05, 0.11), C.woodDark, at(ax, y + 0.52, az));
    m.add(new ConeGeometry(0.1, 0.08, 4), C.woodDark, at(ax, y + 1.09, az, Math.PI / 4), 0.03);
    if (gaps.has(i)) continue;
    const len = Math.hypot(bx - ax, bz - az);
    const yaw = Math.atan2(bx - ax, bz - az);
    m.add(board(0.12, 0.07, len + 0.06), C.wood, at((ax + bx) / 2, y + 1.02, (az + bz) / 2, yaw), 0.03);
    m.add(board(0.06, 0.06, len), C.wood, at((ax + bx) / 2, y + 0.55, (az + bz) / 2, yaw), 0.03);
    // Balusters between the posts.
    const n = Math.max(1, Math.round(len / 0.45));
    for (let k = 1; k < n; k++) {
      const t = k / n;
      m.add(new BoxGeometry(0.04, 0.48, 0.04), C.wood, at(ax + (bx - ax) * t, y + 0.78, az + (bz - az) * t, yaw), 0);
    }
  }
}

/** A hanging lantern on a little bracket: a dark cage, a warm light, a glow at night. */
function lanternBox(p: Parts, x: number, y: number, z: number, glow = 0.95): void {
  p.solid.add(new BoxGeometry(0.32, 0.06, 0.32), C.grey, at(x, y + 0.2, z), 0);
  p.solid.add(new ConeGeometry(0.26, 0.2, 4), C.grey, at(x, y + 0.32, z, Math.PI / 4), 0);
  p.solid.add(new BoxGeometry(0.3, 0.05, 0.3), C.grey, at(x, y - 0.17, z), 0);
  for (const [dx, dz] of [[-0.13, -0.13], [0.13, -0.13], [0.13, 0.13], [-0.13, 0.13]] as const) p.solid.add(new BoxGeometry(0.03, 0.36, 0.03), C.grey, at(x + dx, y, z + dz), 0);
  p.lit.add(new BoxGeometry(0.2, 0.28, 0.2), 0xffcf8a, at(x, y, z), 0);
  p.warm.push([x, y, z, glow]);
}

/** A terracotta pot with a leafy plant (or a trailing vine) in it. */
function pottedPlant(p: Parts, x: number, y: number, z: number, size = 1, trailing = false): void {
  p.solid.add(new CylinderGeometry(0.22 * size, 0.16 * size, 0.34 * size, 8), C.pot, at(x, y + 0.17 * size, z), 0.05);
  p.solid.add(new CylinderGeometry(0.24 * size, 0.24 * size, 0.05 * size, 8), 0xb86a4d, at(x, y + 0.34 * size, z), 0);
  p.canopy.add(new IcosahedronGeometry(0.26 * size, 0), C.leafDeep, at(x, y + 0.52 * size, z, x + z, [1, 0.8, 1]), 0.1);
  p.canopy.add(new IcosahedronGeometry(0.2 * size, 0), C.leaf, at(x + 0.12 * size, y + 0.7 * size, z - 0.05 * size, x * 3, [1, 0.85, 1]), 0.1);
  if (trailing) for (let i = 0; i < 4; i++) p.canopy.add(new OctahedronGeometry(0.09 * size, 0), i % 2 ? C.leaf : C.leafDeep, at(x + 0.2 * size, y + 0.25 * size - i * 0.16 * size, z + 0.12 * size, i), 0);
}

/** A mug with a handle. */
function mug(m: Mesher, mat: Matrix4 | null, x: number, y: number, z: number, color: number): void {
  const t = (local: Matrix4) => (mat ? within(mat, local) : local);
  m.add(new CylinderGeometry(0.06, 0.055, 0.12, 8), color, t(at(x, y + 0.06, z)), 0);
  m.add(new CylinderGeometry(0.048, 0.048, 0.01, 8), 0x6b4a32, t(at(x, y + 0.118, z)), 0);
  m.add(new TorusGeometry(0.035, 0.012, 4, 6, Math.PI), color, t(at(x + 0.065, y + 0.06, z, 0, 1, 0, -Math.PI / 2)), 0);
}

/** A vine hanging from (x, y, z): a zigzag of small leaves. */
function vine(p: Parts, x: number, y: number, z: number, length: number, seed: number): void {
  const n = Math.round(length / 0.22);
  for (let i = 0; i < n; i++) {
    const sway = Math.sin(i * 1.7 + seed) * 0.1;
    p.canopy.add(new OctahedronGeometry(0.11 - i * 0.004, 0), i % 2 ? C.leaf : C.leafDeep, at(x + sway, y - i * 0.22, z + Math.cos(i * 1.3 + seed) * 0.06, i + seed, [1, 0.6, 1]), 0.06);
  }
}

/** A board or panel with its edges bevelled (a fifth of its thinnest side, at most 3 cm), so they catch the light. */
const board = (w: number, h: number, d: number): BufferGeometry => bevelBox(w, h, d, Math.min(0.03, Math.min(w, h, d) * 0.2));

type Add = (g: BufferGeometry, color: number | Paint, local: Matrix4, vary?: number) => void;

/**
 * A floor of planks `w` wide (x) by `d` deep (z), centred on (x, z), their tops
 * at `top`: boards along z, `t` thick, with thin gaps, in two shades. `half`
 * trims each board to a shape (its half-length at its x), for decks that aren't square.
 */
function planks(add: Add, x: number, z: number, w: number, d: number, top: number, t = 0.05, half?: (u: number) => number): void {
  const n = Math.max(1, Math.round(w / 0.26));
  const bw = w / n;
  for (let i = 0; i < n; i++) {
    const u = x - w / 2 + (i + 0.5) * bw;
    const len = half ? Math.min(d, 2 * half(u - x)) : d;
    if (len < 0.2) continue;
    add(board(bw - 0.025, t, len - 0.02), i % 3 === 1 ? C.wood : C.plank, at(u, top - t / 2, z), 0.06);
  }
}

/**
 * A gable roof of shingles: ridge along x, `w` deep (z), `h` high, `l` long,
 * its eaves at y0 (in the frame `add` builds in): rows of overlapping shingles
 * on both slopes, every other row offset by half a shingle, over a darker deck.
 */
function shingleRoof(add: Add, w: number, h: number, l: number, y0: number, color: number, alt: number): void {
  add(gable(w, h, l), C.woodDark, at(0, y0, 0), 0.03);
  const run = w / 2;
  const slope = Math.hypot(run, h);
  const pitch = Math.atan2(h, run);
  const rows = Math.ceil(slope / 0.3);
  for (const side of [-1, 1]) {
    for (let r = 0; r < rows; r++) {
      const t = (r + 0.5) / rows;
      const n = Math.ceil(l / 0.46);
      const sw = l / n;
      for (let i = 0; i < n + (r % 2); i++) {
        const xs = -l / 2 + (i + (r % 2 ? 0 : 0.5)) * sw;
        const a = Math.max(-l / 2, xs - sw / 2);
        const b = Math.min(l / 2, xs + sw / 2);
        if (b - a < 0.05) continue;
        // Each shingle lies on the slope a little proud of it, its lower edge tipped out.
        const zz = side * run * (1 - t);
        const yy = y0 + h * t + 0.03;
        add(new BoxGeometry(b - a - 0.02, 0.025, slope / rows + 0.08), (i + r) % 4 === 0 ? alt : color, at((a + b) / 2, yy, zz, 0, 1, -side * (pitch + 0.04)), 0.07);
      }
    }
    // A ridge cap.
  }
  add(board(l + 0.1, 0.1, 0.2), C.woodDark, at(0, y0 + h + 0.02, 0, 0, 1, Math.PI / 4), 0.03);
}

/** A window's frame round a w × h opening centred at (x, y) on a wall facing +z (at z): head, jambs and a sill. */
function windowFrame(add: Add, x: number, y: number, z: number, w: number, h: number, color = C.woodDark): void {
  add(board(w + 0.16, 0.08, 0.08), color, at(x, y + h / 2 + 0.04, z));
  for (const s of [-1, 1]) add(board(0.07, h, 0.07), color, at(x + s * (w / 2 + 0.035), y, z));
  add(board(w + 0.24, 0.06, 0.16), color, at(x, y - h / 2 - 0.03, z + 0.04));
}

function buildKeep(p: Parts): void {
  // The keep faces south (its local frame is the scene's): a giant tree with a deck and a room.
  const { solid, canopy, glass, lit } = p;
  // Roots spreading into the lawn.
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.3;
    solid.add(new ConeGeometry(0.85, 3.6, 5), C.trunkDark, between(Math.sin(a) * 3.1, 0.05, Math.cos(a) * 3.1, Math.sin(a) * 0.8, 2.2, Math.cos(a) * 0.8, 1), 0.1);
  }
  solid.add(lumpy(new CylinderGeometry(1.55, 2.4, 9, 14, 4), 61, 0.05), C.trunk, at(0, 4.5, 0), 0.1);
  solid.add(lumpy(new CylinderGeometry(1.1, 1.55, 3.2, 14, 2), 62, 0.05), C.trunk, at(0.15, 10.4, -0.15, 0.4, 1, -0.04, 0.03), 0.1);
  // Bark ridges, so the trunk reads as faceted wood rather than a column.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    solid.add(new BoxGeometry(0.34, 6.5, 0.3), i % 2 ? C.trunkDark : C.trunk, at(Math.sin(a) * 1.95, 3.6, Math.cos(a) * 1.95, a, 1, 0.08 * Math.cos(a), 0), 0.08);
  }
  for (const [rz, ry, len] of [[0.95, 0.3, 7], [-0.9, 1.7, 6.5], [0.85, 3.4, 6], [-0.8, 4.7, 7]] as const) {
    const branch = at(0, 9.6, 0, ry).multiply(at(0, 0, 0, 0, 1, 0, rz)).multiply(at(0, len / 2, 0));
    solid.add(new CylinderGeometry(0.32, 0.55, len, 6), C.trunk, branch, 0.1);
  }
  // A crown of chunky, faceted leaf clusters: lighter on top, deeper below.
  const clusters: [number, number, number, number, number][] = [
    [0, 18.5, 0, 4.6, C.leaf], [4.6, 16.8, 1.2, 3.6, C.leafLight], [-4.4, 17.2, -1, 3.8, C.leaf], [1.5, 17, 4.4, 3.4, C.leafDeep],
    [-1.8, 16.8, -4.6, 3.6, C.leafLight], [3.4, 19.6, -3, 3, C.leafDeep], [-3.6, 19.8, 2.6, 3.1, C.leafLight], [6.6, 15.4, -2.4, 2.6, C.leaf],
    [-6.4, 15.6, 2.2, 2.7, C.leafDeep], [0.4, 21.6, 0.6, 3, C.leafLight], [3.8, 15.2, 4.2, 2.3, C.leafDeep], [-4.2, 15.4, -4.4, 2.4, C.leaf],
    [5.4, 18.6, 3.2, 2.2, C.leafLight], [-5.6, 18.8, -2.8, 2.3, C.leafLight],
  ];
  // Each cluster a heap of smaller ones, each of many small facets, pushed about so no two match.
  clusters.forEach(([x, y, z, r, color], i) => {
    const cx = x * 1.15;
    const cy = y - 5.6;
    const cz = z * 1.15;
    canopy.add(lumpy(new IcosahedronGeometry(r * 0.82, 1), 70 + i, 0.12), color, at(cx, cy, cz, x * 0.7, [1.05, 0.78, 1.05]), 0.08);
    for (let k = 0; k < 2; k++) {
      const a = i * 2.1 + k * Math.PI;
      const tone = k ? C.leafLight : color === C.leafDeep ? C.leaf : C.leafDeep;
      canopy.add(lumpy(new IcosahedronGeometry(r * 0.52, 1), 90 + i * 2 + k, 0.14), tone, at(cx + Math.cos(a) * r * 0.62, cy + (k ? 0.35 : -0.2) * r, cz + Math.sin(a) * r * 0.62, a, [1.05, 0.8, 1.05]), 0.08);
    }
  });
  // Vines trailing from the lowest branches.
  for (const [x, z, len] of [[4.8, 1.6, 2.6], [-4.4, -1.2, 2.2], [1.6, 4.6, 2.8], [-2.2, 4.0, 2]] as const) vine(p, x * 1.1, 10.2, z * 1.1, len, x);

  // The deck round the trunk, on struts, with a railing; a gap where the stairs land.
  const D = 4.2;
  solid.add(new CylinderGeometry(6.3, 6.3, 0.3, 8), C.woodDark, at(0, D, 0, Math.PI / 8), 0.04);
  // Planks across the octagon (its flat sides face the axes: 5.82 m to a side, its corners cut at 45 degrees).
  const apothem = 6.3 * Math.cos(Math.PI / 8) - 0.04;
  const corner = 6.3 * Math.sin(Math.PI / 8);
  planks((g, c, l, v) => solid.add(g, c, l, v), 0, 0, apothem * 2, apothem * 2, D + 0.17, 0.05, (u) => apothem - Math.max(0, Math.abs(u) - corner));
  // Joists under it, and a darker rim.
  solid.add(new CylinderGeometry(6.35, 6.0, 0.18, 8), C.woodDark, at(0, D - 0.24, 0, Math.PI / 8), 0.03);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    solid.add(new BoxGeometry(0.3, 4.6, 0.3), C.woodDark, at(Math.sin(a) * 3.6, 2.2, Math.cos(a) * 3.6, a));
    solid.add(new BoxGeometry(0.24, 0.24, 4.4), C.woodDark, at(Math.sin(a) * 3.4, D - 0.9, Math.cos(a) * 3.4, a, 1, 0.5));
    // Iron brackets where the struts meet the deck.
    solid.add(new BoxGeometry(0.36, 0.3, 0.36), C.grey, at(Math.sin(a) * 3.6, D - 0.45, Math.cos(a) * 3.6, a), 0);
  }
  const octagon: [number, number][] = [];
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    octagon.push([Math.sin(a) * 6.15, Math.cos(a) * 6.15]);
  }
  railing(solid, octagon, D + 0.15, new Set([6]));
  // Stairs: from the deck's south-west down towards the keep's door, with stringers, handrails and lanterns (their
  // measures, and their solids, are keep-plan.ts' STAIRS).
  const S = STAIRS;
  const { top, foot, yaw, pitch } = S;
  for (let i = 0; i < S.steps; i++) {
    const t = tread(i);
    solid.add(board(S.tread.w, S.tread.t, S.tread.d), i % 2 ? C.wood : C.plank, at(t.x, t.top - S.tread.t / 2, t.z, yaw), 0.05);
  }
  // The stringers and handrails run down the stairs: turned to their way first, then pitched about their own
  // across (yaw, then pitch: not `at`'s order, which would pitch them about the scene's x and slew them off the steps).
  const along = (x: number, y: number, z: number): Matrix4 => new Matrix4().makeRotationFromEuler(new Euler(pitch, yaw, 0, "YXZ")).setPosition(x, y, z);
  for (const side of [-S.side, S.side]) {
    const ox = Math.cos(yaw) * side;
    const oz = -Math.sin(yaw) * side;
    const mx = (top[0] + foot[0]) / 2 + ox;
    const mz = (top[1] + foot[1]) / 2 + oz;
    solid.add(new BoxGeometry(S.stringer.w, S.stringer.h, S.length), C.woodDark, along(mx, D / 2 + S.stringer.y, mz), 0.03);
    // On the deck's side (+side), the handrail and its posts begin only below the opening, the way on from the deck.
    const from = side > 0 ? S.opening : 0;
    const t0 = from / S.run;
    const ht = (t0 + 1) / 2;
    solid.add(new BoxGeometry(S.rail.w, S.rail.h, S.length * (1 - t0)), C.wood, along(top[0] + (foot[0] - top[0]) * ht + ox, D - D * ht + S.rail.y, top[1] + (foot[1] - top[1]) * ht + oz), 0.03);
    for (let i = 0; i <= S.posts; i++) {
      const t = Math.max(t0, i / S.posts);
      if (i > 0 && i / S.posts <= t0) continue;
      solid.add(new BoxGeometry(0.08, S.post, 0.08), C.woodDark, at(top[0] + (foot[0] - top[0]) * t + ox, D - D * t + S.post / 2 - 0.03, top[1] + (foot[1] - top[1]) * t + oz));
    }
  }
  // The landing: planks at the deck's height from its edge to the top tread, along the opening.
  {
    const [lx, lz] = onStairs(LANDING.along, LANDING.across);
    planks((g, c, l, v) => solid.add(g, c, within(at(lx, 0, lz, yaw), l), v), 0, 0, LANDING.halfAcross * 2, LANDING.halfAlong * 2, DECK_TOP, 0.05);
  }
  for (const side of [-1, 1]) {
    const ox = Math.cos(yaw) * side * 0.9;
    const oz = -Math.sin(yaw) * side * 0.9;
    solid.add(new CylinderGeometry(0.06, 0.08, 1.5, 6), C.woodDark, at(foot[0] + ox, 0.75, foot[1] + oz), 0);
    lanternBox(p, foot[0] + ox, 1.7, foot[1] + oz);
  }
  // Stepping stones from the stairs to the plaza.
  for (let i = 0; i < 3; i++) solid.add(lumpy(new CylinderGeometry(0.42, 0.46, 0.08, 7), 20 + i, 0.08), 0xc9beb2, at(foot[0] + 0.3 + i * 0.35, KEEP_PLAZA_TOP + 0.02, foot[1] + 0.8 + i * 0.6, i), 0.05);

  // The room: cream panels, an orange stripe, a glass front, a wide roof with solar panels.
  const R = D + 0.15;
  solid.add(board(5.4, 2.7, 0.2), C.cream, at(0, R + 1.35, 2.1));
  solid.add(board(0.2, 2.7, 3.1), C.cream, at(-2.6, R + 1.35, 3.55));
  solid.add(board(0.2, 2.7, 3.1), C.cream, at(2.6, R + 1.35, 3.55));
  // Seams between the wall's panels, and a plinth.
  for (const z of [2.55, 3.55, 4.55]) for (const x of [-2.71, 2.71]) solid.add(new BoxGeometry(0.02, 2.6, 0.03), C.creamShade, at(x, R + 1.35, z), 0);
  for (const x of [-2.6, 2.6]) solid.add(board(0.26, 0.18, 3.16), C.creamShade, at(x, R + 0.09, 3.55), 0.02);
  solid.add(board(0.5, 2.7, 0.22), C.orange, at(-2.2, R + 1.35, 5.05), 0.02);
  solid.add(board(5.4, 0.35, 0.22), C.cream, at(0, R + 0.17, 5.05));
  solid.add(board(5.4, 0.3, 0.22), C.cream, at(0, R + 2.55, 5.05));
  for (const x of [-1.9, 0.1, 2.5]) solid.add(board(0.1, 2.3, 0.24), C.grey, at(x, R + 1.35, 5.06), 0);
  // A transom bar across the glass, a sill under it.
  solid.add(board(4.4, 0.06, 0.2), C.grey, at(0.3, R + 2.05, 5.08), 0);
  solid.add(board(5.0, 0.07, 0.3), C.creamShade, at(0.3, R + 0.36, 5.12), 0.02);
  glass.add(new BoxGeometry(1.9, 2, 0.06), 0xffffff, at(-0.9, R + 1.35, 5.06), 0);
  glass.add(new BoxGeometry(2.3, 2, 0.06), 0xffffff, at(1.3, R + 1.35, 5.06), 0);
  glass.add(new BoxGeometry(0.06, 1.2, 1.6), 0xffffff, at(2.72, R + 1.5, 3.6), 0);
  p.warm.push([-0.9, R + 1.4, 5.2, 1.7], [1.3, R + 1.4, 5.2, 1.8]);
  // Shelves and a lamp inside, seen through the glass.
  solid.add(new BoxGeometry(1.6, 1.2, 0.3), C.woodDark, at(1.2, R + 0.9, 2.4));
  for (let b = 0; b < 6; b++) solid.add(new BoxGeometry(0.2, 0.3, 0.22), [C.book1, C.book2, C.book3, C.cream, C.orange, C.book1][b]!, at(0.65 + b * 0.22, R + 1.1, 2.45), 0.04);
  lit.add(new CylinderGeometry(0.18, 0.26, 0.3, 8), 0xffd59a, at(-1.2, R + 1.75, 2.6), 0);
  solid.add(new CylinderGeometry(0.03, 0.03, 1.4, 5), C.grey, at(-1.2, R + 0.9, 2.6), 0);
  solid.add(board(6.2, 0.22, 4.2), C.woodDark, at(0, R + 2.85, 3.55, 0, 1, -0.08));
  solid.add(board(6.3, 0.08, 0.12), C.orange, at(0, R + 2.72, 5.62, 0, 1, -0.08), 0);
  // Standing seams on the roof, and rafter ends under its eave.
  for (let k = 0; k < 9; k++) solid.add(new BoxGeometry(0.03, 0.03, 4.1), C.wood, at(-2.8 + k * 0.7, R + 2.97, 3.55, 0, 1, -0.08), 0);
  for (let k = 0; k < 7; k++) solid.add(board(0.1, 0.14, 0.3), C.woodDark, at(-2.7 + k * 0.9, R + 2.62, 5.5, 0, 1, -0.08), 0.03);
  for (const x of [-1.8, 0, 1.8]) {
    // A panel: its frame, and a grid of cells.
    const tilt = at(x, R + 3.02, 3.4, 0, 1, -0.08);
    solid.add(board(1.66, 0.07, 2.46), C.greyLight, tilt, 0);
    solid.add(new BoxGeometry(1.56, 0.07, 2.36), C.solar, within(tilt, at(0, 0.008, 0)), 0.02);
    for (let k = 1; k < 4; k++) solid.add(new BoxGeometry(1.56, 0.075, 0.015), 0x5b74a8, within(tilt, at(0, 0.01, -1.18 + k * 0.59)), 0);
    for (let k = 1; k < 3; k++) solid.add(new BoxGeometry(0.015, 0.075, 2.36), 0x5b74a8, within(tilt, at(-0.78 + k * 0.52, 0.01, 0)), 0);
  }
  // The deck's furniture: a crate, a bench and a small table with mugs, pots of plants, a toolbox.
  solid.add(board(0.9, 0.7, 0.5), C.grey, at(-1.6, R + 0.35, 1.5));
  solid.add(board(0.92, 0.1, 0.52), C.orange, at(-1.6, R + 0.62, 1.5), 0);
  for (const dz of [-0.13, 0.13]) solid.add(board(2.2, 0.08, 0.25), C.wood, at(3.9 + Math.sin(0.9) * dz, R + 0.46, -2.6 + Math.cos(0.9) * dz, 0.9), 0.04);
  for (const dx of [-0.9, 0.9]) solid.add(new BoxGeometry(0.1, 0.45, 0.45), C.woodDark, at(3.9 + Math.cos(0.9) * dx, R + 0.22, -2.6 - Math.sin(0.9) * dx, 0.9));
  for (const dz of [-0.27, 0, 0.27]) solid.add(board(1.2, 0.07, 0.25), dz ? C.wood : C.plank, at(4.3 + Math.sin(0.3) * dz, R + 0.74, 0.6 + Math.cos(0.3) * dz, 0.3), 0.04);
  for (const [dx, dz] of [[-0.5, -0.3], [0.5, -0.3], [-0.5, 0.3], [0.5, 0.3]] as const) solid.add(new BoxGeometry(0.07, 0.72, 0.07), C.woodDark, at(4.3 + dx, R + 0.36, 0.6 + dz, 0.3));
  mug(solid, null, 4.05, R + 0.78, 0.5, C.cream);
  mug(solid, null, 4.45, R + 0.78, 0.75, C.orange);
  for (const [x, z, size, trail] of DECK_POTS) {
    pottedPlant(p, x, R, z, size, trail);
  }
  lanternBox(p, 2.95, R + 2.1, 5.25);
  lanternBox(p, -2.95, R + 2.1, 5.25);
}

function buildStations(p: Parts): void {
  const { solid, glass, lit } = p;
  buildKeep(p);

  // ---- council: a low deck with a long table, benches, mugs and a teapot, under a parasol ----
  {
    const m = stationMatrix("council");
    const add = (g: BufferGeometry, color: number | Paint, local: Matrix4, vary?: number) => solid.add(g, color, within(m, local), vary);
    // The deck: joists under a floor of planks, a darker rim.
    add(new BoxGeometry(5.6, 0.12, 4.4), C.woodDark, at(0, 0.06, 0), 0.05);
    planks(add, 0, 0, 5.6, 4.4, 0.17);
    for (const z of [-2.22, 2.22]) add(board(5.7, 0.14, 0.08), C.woodDark, at(0, 0.1, z), 0.03);
    // The table: five boards on an apron and four bevelled legs.
    const T = COUNCIL_TABLE_TOP;
    for (let i = 0; i < 5; i++) add(board(2.6, 0.06, 0.21), i % 2 ? C.wood : C.plank, at(0, T - 0.03, -0.44 + i * 0.22), 0.04);
    add(board(2.36, 0.09, 0.9), C.woodDark, at(0, T - 0.105, 0), 0.03);
    for (const [x, z] of [[-1.15, -0.45], [1.15, -0.45], [-1.15, 0.45], [1.15, 0.45]] as const) add(board(0.1, T - 0.17, 0.1), C.woodDark, at(x, 0.17 + (T - 0.17) / 2 - 0.03, z));
    for (const z of [-1.05, 1.05]) {
      for (const dz of [-0.1, 0.1]) add(board(2.4, 0.07, 0.19), C.wood, at(0, 0.48, z + dz), 0.04);
      for (const x of [-1, 1]) add(board(0.08, 0.3, 0.32), C.woodDark, at(x, 0.31, z));
    }
    for (const [x, z, c] of [[-0.8, -0.2, C.cream], [-0.2, 0.25, C.orange], [0.5, -0.15, C.cream], [1, 0.2, C.cream]] as const) mug(solid, m, x, COUNCIL_TABLE_TOP, z, c);
    // A teapot and a rolled map (clear of Reachy Mini, who sits at 0.25, 0.08: critters.ts).
    add(new SphereGeometry(0.13, 8, 5), C.cream, at(0.85, 0.98, -0.3, 0, [1, 0.8, 1]), 0.02);
    add(new CylinderGeometry(0.02, 0.03, 0.14, 5), C.cream, at(1.0, 1.0, -0.3, 0, 1, 0, -0.9), 0);
    add(new CylinderGeometry(0.05, 0.05, 0.02, 6), C.orange, at(0.85, 1.08, -0.3), 0);
    add(new CylinderGeometry(0.045, 0.045, 0.8, 6), 0xefe2c4, at(-0.5, 0.92, 0.3, 0.3, 1, 0, Math.PI / 2), 0);
    add(new BoxGeometry(0.5, 0.22, 0.3), C.grey, at(-1.05, 0.98, 0.1));
    add(new BoxGeometry(0.52, 0.05, 0.32), C.orange, at(-1.05, 1.09, 0.1), 0);
    add(new BoxGeometry(0.06, 2.6, 0.06), C.woodDark, at(2.4, 1.3, -1.8));
    add(new ConeGeometry(1.6, 0.6, 16), (x, _y, z) => (Math.floor(Math.atan2(z, x) / (Math.PI / 4) + 8) % 2 ? C.cream : C.creamShade), at(2.4, 2.75, -1.8), 0.03);
    add(new ConeGeometry(1.62, 0.12, 16, 1, true), C.orange, at(2.4, 2.5, -1.8), 0);
    for (const [x, z] of [[-2.5, -1.9], [2.5, 1.9], [-2.5, 1.9]] as const) {
      const [sx, sy, sz] = scenePoint(m, x, 0.16, z);
      pottedPlant(p, sx, sy, sz, 1.1);
    }
  }
  // ---- observatory: a telescope platform on stilts, with a ladder ----
  {
    const m = stationMatrix("observatory");
    const add = (g: BufferGeometry, color: number | Paint, local: Matrix4, vary?: number) => solid.add(g, color, within(m, local), vary);
    const H = 2.6;
    for (const [x, z] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]] as const) add(new BoxGeometry(0.22, H, 0.22), C.woodDark, at(x, H / 2, z));
    for (const z of [-1.6, 1.6]) add(new BoxGeometry(3.2, 0.12, 0.12), C.wood, at(0, H * 0.45, z, 0, 1, 0, 0.6));
    add(new BoxGeometry(3.8, 0.16, 3.8), C.woodDark, at(0, H - 0.02, 0), 0.04);
    planks(add, 0, 0, 3.8, 3.8, H + 0.1);
    const square: [number, number][] = [[-1.85, -1.85], [1.85, -1.85], [1.85, 1.85], [-1.85, 1.85], [-1.85, -1.85]];
    railing(p.solid, square.map(([x, z]) => {
      const v = within(m, at(x, 0, z));
      return [v.elements[12]!, v.elements[14]!] as [number, number];
    }), H + 0.1, new Set([2]));
    for (let i = 0; i < 7; i++) add(new BoxGeometry(0.8, 0.06, 0.08), C.wood, at(0, 0.3 + i * 0.36, 2.05), 0);
    for (const x of [-0.42, 0.42]) add(new BoxGeometry(0.07, H + 0.4, 0.07), C.woodDark, at(x, H / 2, 2.05));
    // The telescope on its tripod, a chest of charts.
    for (let i = 0; i < 3; i++) add(new BoxGeometry(0.04, 1.2, 0.04), C.grey, at(Math.sin((i * Math.PI * 2) / 3) * 0.25, H + 0.6, Math.cos((i * Math.PI * 2) / 3) * 0.25, (i * Math.PI * 2) / 3, 1, 0.22), 0);
    add(new CylinderGeometry(0.12, 0.15, 1.5, 10), C.cream, at(0, H + 1.45, -0.1, 0, 1, -0.75), 0.02);
    add(new CylinderGeometry(0.16, 0.16, 0.12, 10), C.orange, at(0, H + 1.3, 0.02, 0, 1, -0.75), 0);
    add(new CylinderGeometry(0.1, 0.1, 0.06, 10), 0x1b1d22, at(0, H + 1.98, -0.55, 0, 1, -0.75), 0);
    add(new BoxGeometry(0.6, 0.4, 0.45), C.grey, at(1.1, H + 0.3, -1.1));
    add(new BoxGeometry(0.62, 0.06, 0.47), C.orange, at(1.1, H + 0.52, -1.1), 0);
    const [lx, ly, lz] = scenePoint(m, -1.7, H + 1.2, -1.7);
    lanternBox(p, lx, ly, lz);
  }
  // ---- library: a reading nook with shelves, an armchair and a lamp ----
  {
    const m = stationMatrix("library");
    const add = (g: BufferGeometry, color: number | Paint, local: Matrix4, vary?: number) => solid.add(g, color, within(m, local), vary);
    add(new BoxGeometry(5, 0.14, 4), C.woodDark, at(0, 0.07, 0), 0.04);
    planks(add, 0, 0, 5, 4, 0.2);
    add(board(5, 3, 0.2), C.cream, at(0, 1.6, -1.9));
    add(board(0.2, 3, 4), C.cream, at(-2.4, 1.6, 0));
    add(board(0.2, 3, 2), C.cream, at(2.4, 1.6, -1));
    add(board(0.4, 3, 0.22), C.orange, at(2.4, 1.6, 0.1), 0.02);
    // Corner posts and a beam along the open front.
    for (const x of [-2.42, 2.42]) add(board(0.24, 3.1, 0.24), C.woodDark, at(x, 1.6, 1.9));
    add(board(5.0, 0.2, 0.22), C.woodDark, at(0, 3.0, 1.9));
    shingleRoof(add, 4.8, 1.4, 5.8, 3.1, C.wood, C.woodDark);
    // Shelves of many-coloured books.
    for (let row = 0; row < 4; row++) {
      add(new BoxGeometry(3.6, 0.06, 0.4), C.woodDark, at(-0.4, 0.5 + row * 0.6, -1.65), 0);
      for (let b = 0; b < 11; b++) {
        const color = [C.book1, C.book2, C.book3, C.cream, C.orange][(b * 3 + row) % 5]!;
        add(new BoxGeometry(0.22, 0.38 + ((b + row) % 3) * 0.05, 0.3), color, at(-2 + b * 0.3, 0.74 + row * 0.6, -1.62), 0.04);
      }
    }
    add(new BoxGeometry(1, 0.45, 0.9), C.cream, at(1.3, 0.42, 0.2));
    add(new BoxGeometry(1, 0.8, 0.25), C.cream, at(1.3, 0.85, -0.2));
    add(new BoxGeometry(0.45, 0.35, 0.15), C.orange, at(1.3, 0.85, 0.05), 0);
    add(new BoxGeometry(0.6, 0.5, 0.6), C.wood, at(0.2, 0.45, 0.6));
    mug(solid, m, 0.1, 0.7, 0.55, C.orange);
    add(new BoxGeometry(0.3, 0.06, 0.22), C.book2, at(0.35, 0.73, 0.7, 0.4), 0);
    add(new CylinderGeometry(0.03, 0.03, 1.6, 5), C.grey, at(-1.6, 0.9, 0.6), 0);
    lit.add(new ConeGeometry(0.28, 0.32, 8), 0xffd59a, within(m, at(-1.6, 1.8, 0.6)), 0);
    p.warm.push([...scenePoint(m, -1.6, 1.75, 0.6), 1.6]);
    glass.add(new BoxGeometry(0.06, 1.1, 1.2), 0xffffff, within(m, at(-2.52, 1.8, 0.6)), 0);
    // Its frame, on the west wall (a wall facing +z, turned to face west).
    windowFrame((g, c, l, v) => add(g, c, at(0, 0, 0, -Math.PI / 2).multiply(l), v), 0.6, 1.8, 2.54, 1.2, 1.1);
    const [px, py, pz] = scenePoint(m, 2.0, 0.2, 1.4);
    pottedPlant(p, px, py, pz, 1.3);
  }
  // ---- forge: a research bunker set into a limestone hill: wide door, workbench, monitors, printer, pipes ----
  {
    const m = stationMatrix("forge");
    const add = (g: BufferGeometry, color: number | Paint, local: Matrix4, vary?: number) => solid.add(g, color, within(m, local), vary);
    for (const [x, y, z, r, k] of [[0, 1.6, -3.4, 4.2, 1], [-3.2, 1.2, -2.6, 3, 2], [3.3, 1.1, -2.8, 3.1, 3], [0.6, 3.6, -4.6, 3.2, 4], [-2, 3, -4.8, 2.6, 5], [3.6, 3.0, -4.4, 2.4, 6]] as const) {
      const strata: Paint = (_x, py) => [C.limestone, 0xe2d3be, 0xd9c7ae][Math.floor(py * 2.4 + k) % 3]!;
      add(chip(lumpy(new IcosahedronGeometry(r, 2), k, 0.1), k, 5, 0.86), strata, at(x, y, z, x + z, [1, 0.8, 1]), 0.06);
    }
    // Moss and a little grass on the hill.
    for (const [x, y, z] of [[0.2, 4.8, -3], [-2.4, 3.6, -2.2], [2.6, 3.4, -2.4]] as const) p.canopy.add(new IcosahedronGeometry(0.8, 0), C.leafDeep, within(m, at(x, y, z, x, [1.4, 0.5, 1.2])), 0.1);
    // The frame round the wide door: cream panels, orange edges, a grey lintel and a lamp over it.
    add(board(5.6, 3.8, 0.6), C.cream, at(0, 1.9, 0.9));
    for (const x of [-2.2, 2.2]) add(new BoxGeometry(0.06, 3.0, 0.62), C.creamShade, at(x, 1.7, 0.92), 0);
    for (const y of [1.0, 2.6]) for (const x of [-2.55, 2.55]) add(new BoxGeometry(0.62, 0.03, 0.62), C.creamShade, at(x, y, 0.92), 0);
    for (const x of [-1.95, 1.95]) add(board(0.32, 3.1, 0.68), C.orange, at(x, 1.5, 0.95), 0.02);
    // The door's track and its rollers, bolts down the frame.
    add(board(4.4, 0.12, 0.2), C.greyLight, at(0, 3.27, 1.3), 0);
    for (const x of [-1.6, -0.8, 0.8, 1.6]) add(new CylinderGeometry(0.06, 0.06, 0.08, 10).rotateX(Math.PI / 2), C.grey, at(x, 3.27, 1.42), 0);
    for (const x of [-1.95, 1.95]) for (let k = 0; k < 5; k++) add(new IcosahedronGeometry(0.03, 0), C.greyLight, at(x, 0.4 + k * 0.6, 1.3), 0);
    add(board(4.2, 0.3, 0.7), C.grey, at(0, 3.05, 0.95), 0);
    add(board(5.9, 0.22, 1.5), C.greyLight, at(0, 3.9, 1.15), 0.02);
    // Inside the door: the lab's own light (dim by day, warm at night), screens and the printer.
    lit.add(new BoxGeometry(3.6, 2.85, 0.04), 0x5a4c40, within(m, at(0, 1.45, 1.22)), 0);
    p.warm.push([...scenePoint(m, 0, 1.6, 1.4), 3.4]);
    lit.add(new BoxGeometry(0.95, 0.6, 0.03), 0x6fe8d8, within(m, at(-0.9, 1.95, 1.3)), 0);
    lit.add(new BoxGeometry(0.95, 0.6, 0.03), 0x7fd4f0, within(m, at(0.25, 1.95, 1.3)), 0);
    for (const x of [-0.9, 0.25]) add(new BoxGeometry(1.05, 0.7, 0.05), C.grey, at(x, 1.95, 1.27), 0);
    // A desk under the screens.
    add(new BoxGeometry(2.4, 0.08, 0.5), C.wood, at(-0.35, 0.95, 1.5));
    for (const x of [-1.45, 0.75]) add(new BoxGeometry(0.07, 0.9, 0.45), C.grey, at(x, 0.47, 1.5), 0);
    p.cool.push([...scenePoint(m, -0.9, 1.95, 1.5), 0.9], [...scenePoint(m, 0.25, 1.95, 1.5), 0.9]);
    // The 3D printer: a cream frame with its glowing build window.
    // (On a shelf above the workbench's back edge, so the arms have the bench to themselves.)
    add(new BoxGeometry(0.9, 0.06, 0.55), C.grey, at(1.35, 1.1, 1.5), 0);
    add(new BoxGeometry(0.7, 0.74, 0.52), C.cream, at(1.35, 1.5, 1.5), 0.02);
    add(new BoxGeometry(0.72, 0.07, 0.54), C.orange, at(1.35, 1.9, 1.5), 0);
    lit.add(new BoxGeometry(0.5, 0.4, 0.03), 0xffb35a, within(m, at(1.35, 1.5, 1.77)), 0);
    p.warm.push([...scenePoint(m, 1.35, 1.5, 1.95), 0.9]);
    // Pipes along the hill face, clamped in orange.
    add(new CylinderGeometry(0.09, 0.09, 5.2, 6), C.grey, at(-2.75, 2.6, 0.45, 0, 1, 0, Math.PI / 2 - 0.02), 0);
    add(new CylinderGeometry(0.07, 0.07, 3.6, 6), C.greyLight, at(2.75, 1.8, 0.45), 0);
    for (const y of [0.8, 1.8, 2.8]) add(new BoxGeometry(0.22, 0.1, 0.22), C.orange, at(2.75, y, 0.45), 0);
    for (const x of [-4.2, -2.75, -1.3]) add(new BoxGeometry(0.1, 0.24, 0.24), C.orange, at(x, 2.6, 0.45), 0);
    const [dx, dy, dz] = scenePoint(m, 0, 3.4, 1.55);
    lanternBox(p, dx, dy, dz, 1.8);
    // The workbench in front (the arms work on it), a vice, a crate and a cart of instruments.
    // The worktop (the arms stand on it, so its top is exactly LAB_BENCH_TOP), a cabinet of drawers under it.
    add(board(2, 0.13, 0.8), C.wood, at(1.2, LAB_BENCH_TOP - 0.065, 2.2));
    add(board(1.9, 0.78, 0.7), C.creamShade, at(1.2, 0.41, 2.2));
    for (const x of [0.5, 1.2, 1.9]) {
      for (const y of [0.24, 0.6]) {
        add(board(0.6, 0.3, 0.03), C.cream, at(x, y, 2.56), 0.02);
        add(board(0.22, 0.04, 0.04), C.orange, at(x, y + 0.08, 2.585), 0);
      }
    }
    add(new BoxGeometry(1.92, 0.06, 0.72), C.grey, at(1.2, 0.03, 2.2), 0);
    add(new BoxGeometry(0.3, 0.18, 0.2), C.grey, at(0.35, 1.0, 2.1));
    add(new BoxGeometry(0.12, 0.08, 0.3), C.orange, at(0.35, 1.1, 2.1), 0);
    add(new BoxGeometry(0.7, 0.5, 0.5), C.creamShade, at(-1.6, 0.25, 2.1, 0.3));
    add(new BoxGeometry(0.72, 0.06, 0.52), C.orange, at(-1.6, 0.52, 2.1, 0.3), 0);
    add(new BoxGeometry(0.6, 0.06, 0.45), C.greyLight, at(-2.5, 0.9, 1.9), 0);
    add(new BoxGeometry(0.6, 0.06, 0.45), C.greyLight, at(-2.5, 0.45, 1.9), 0);
    for (const [x, z] of [[-2.78, 1.7], [-2.22, 1.7], [-2.78, 2.1], [-2.22, 2.1]] as const) add(new BoxGeometry(0.04, 0.9, 0.04), C.grey, at(x, 0.5, z), 0);
    add(new BoxGeometry(0.4, 0.25, 0.3), C.cream, at(-2.5, 1.06, 1.9), 0.02);
    lit.add(new BoxGeometry(0.28, 0.14, 0.02), 0x7ff0c8, within(m, at(-2.5, 1.08, 2.06)), 0);
    // A solar panel on the hill.
    add(new BoxGeometry(2.2, 0.06, 1.4), C.solar, at(-0.6, 5.3, -2.2, 0.2, 1, -0.4), 0.02);
    add(new BoxGeometry(0.1, 1.2, 0.1), C.greyLight, at(-0.6, 4.7, -2.0), 0);
  }
  // ---- watchtower: a lookout on braced legs, a roof, a pennant and an antenna mast ----
  {
    const m = stationMatrix("watchtower");
    const add = (g: BufferGeometry, color: number | Paint, local: Matrix4, vary?: number) => solid.add(g, color, within(m, local), vary);
    const H = 7;
    for (const [x, z] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]] as const) add(new BoxGeometry(0.28, H, 0.28), C.woodDark, at(x * 1.1, H / 2, z * 1.1, 0, 1, z * 0.04, -x * 0.04));
    for (const y of [2.2, 4.6]) for (const z of [-1.35, 1.35]) add(new BoxGeometry(3, 0.12, 0.12), C.wood, at(0, y, z, 0, 1, 0, 0.7), 0.03);
    for (const y of [2.2, 4.6]) for (const x of [-1.35, 1.35]) add(new BoxGeometry(0.12, 0.12, 3), C.wood, at(x, y, 0, 0, 1, 0.7, 0), 0.03);
    add(new BoxGeometry(3.6, 0.18, 3.6), C.woodDark, at(0, H - 0.02, 0), 0.04);
    planks(add, 0, 0, 3.6, 3.6, H + 0.11);
    for (const [x, z] of [[-1.7, -1.7], [1.7, -1.7], [-1.7, 1.7], [1.7, 1.7]] as const) add(new BoxGeometry(0.12, 2.2, 0.12), C.woodDark, at(x, H + 1.1, z));
    add(new BoxGeometry(4.2, 0.2, 4.2), C.woodDark, at(0, H + 2.3, 0, 0, 1, 0.06), 0.03);
    for (const z of [1.75, -1.75]) {
      add(board(3.4, 0.08, 0.1), C.wood, at(0, H + 0.95, z), 0.03);
      add(board(3.4, 0.06, 0.06), C.wood, at(0, H + 0.45, z), 0.03);
      for (let k = 1; k < 8; k++) add(new BoxGeometry(0.04, 0.5, 0.04), C.wood, at(-1.7 + k * 0.425, H + 0.7, z), 0);
    }
    add(new BoxGeometry(3.4, 0.08, 0.5), C.orange, at(0, H + 2.42, 0), 0);
    add(new CylinderGeometry(0.05, 0.08, 5, 5), C.grey, at(0.9, H + 4.8, -0.9), 0);
    for (const y of [H + 3.6, H + 5.2]) add(new BoxGeometry(0.9, 0.04, 0.04), C.grey, at(0.9, y, -0.9), 0);
    // A pennant on the roof's corner.
    add(new CylinderGeometry(0.03, 0.03, 1.6, 4), C.woodDark, at(-1.9, H + 3.2, 1.9), 0);
    add(new ConeGeometry(0.4, 1.1, 3), C.orange, at(-1.9 + 0.55, H + 3.7, 1.9, 0, [1, 1, 0.08], 0, -Math.PI / 2), 0);
    add(new CylinderGeometry(0.1, 0.13, 0.8, 8), C.cream, at(-0.6, H + 0.9, 0.6, 0.6, 1, -0.9), 0.02);
    for (let i = 0; i < 10; i++) add(new BoxGeometry(0.7, 0.05, 0.07), C.wood, at(0, 0.4 + i * 0.66, 1.62), 0);
    lit.add(new IcosahedronGeometry(0.12, 0), 0xff9a4a, within(m, at(0.9, H + 7.35, -0.9)), 0);
    p.warm.push([...scenePoint(m, 0.9, H + 7.35, -0.9), 0.9]);
    const [lx, ly, lz] = scenePoint(m, 1.4, H + 1.9, 1.4);
    lanternBox(p, lx, ly, lz);
  }
  // ---- treasury: a small, sturdy vault hut with a round door ----
  {
    const m = stationMatrix("treasury");
    const add = (g: BufferGeometry, color: number | Paint, local: Matrix4, vary?: number) => solid.add(g, color, within(m, local), vary);
    add(new BoxGeometry(4.4, 0.3, 4), C.greyLight, at(0, 0.15, 0), 0.03);
    add(board(4, 3, 3.4), C.creamShade, at(0, 1.8, -0.2), 0.04);
    add(board(4.5, 0.4, 3.9), C.cream, at(0, 3.45, -0.2), 0.03);
    for (const x of [-1, 0, 1]) add(new BoxGeometry(0.03, 2.4, 0.03), C.cream, at(x * 1.35, 1.6, 1.51), 0);
    add(new BoxGeometry(4.05, 0.3, 3.45), C.orange, at(0, 2.9, -0.2), 0);
    for (const x of [-1.9, 1.9]) add(new BoxGeometry(0.25, 3, 0.25), C.cream, at(x, 1.8, 1.5), 0.02);
    add(new CylinderGeometry(1, 1, 0.3, 28).rotateX(Math.PI / 2), C.grey, at(0, 1.5, 1.55), 0.02);
    add(new CylinderGeometry(0.78, 0.78, 0.34, 28).rotateX(Math.PI / 2), C.greyLight, at(0, 1.5, 1.6), 0);
    for (let k = 0; k < 16; k++) add(new IcosahedronGeometry(0.035, 0), C.greyLight, at(Math.cos((k / 16) * Math.PI * 2) * 0.89, 1.5 + Math.sin((k / 16) * Math.PI * 2) * 0.89, 1.71), 0);
    for (let i = 0; i < 3; i++) add(new BoxGeometry(1, 0.08, 0.06), C.orange, at(0, 1.5, 1.8, 0, 1, 0, (i * Math.PI) / 3), 0);
    add(new CylinderGeometry(0.12, 0.12, 0.1, 8).rotateX(Math.PI / 2), C.orange, at(0, 1.5, 1.82), 0);
    lit.add(new BoxGeometry(0.5, 0.2, 0.06), 0xffd9a0, within(m, at(0, 2.75, 1.52)), 0);
    p.warm.push([...scenePoint(m, 0, 2.75, 1.7), 1.1]);
  }
  // ---- messenger's post: a radio mast, a dish, an orange banner and a radio hut ----
  {
    const m = stationMatrix("messenger");
    const add = (g: BufferGeometry, color: number | Paint, local: Matrix4, vary?: number) => solid.add(g, color, within(m, local), vary);
    add(board(2.2, 2.3, 1.8), C.cream, at(-1.2, 1.15, -0.4));
    add(board(2.5, 0.18, 2.1), C.grey, at(-1.2, 2.38, -0.4, 0, 1, 0.08));
    add(board(0.8, 1.7, 0.08), C.orange, at(-1.2, 0.85, 0.52), 0);
    add(board(0.96, 0.08, 0.1), C.grey, at(-1.2, 1.74, 0.53), 0);
    add(new IcosahedronGeometry(0.04, 0), C.grey, at(-0.95, 0.85, 0.58), 0);
    glass.add(new BoxGeometry(0.06, 0.6, 0.8), 0xffffff, within(m, at(-2.32, 1.4, -0.4)), 0);
    p.warm.push([...scenePoint(m, -2.4, 1.4, -0.4), 1.2]);
    add(new CylinderGeometry(0.06, 0.16, 8.5, 4), C.grey, at(1.3, 4.25, -0.2, Math.PI / 4), 0);
    for (let i = 1; i < 7; i++) add(new BoxGeometry(0.06, 0.06, 0.7 - i * 0.07), C.greyLight, at(1.3, i * 1.15, -0.2, 0, 1, 0, 0.6), 0);
    add(new BoxGeometry(1.6, 0.08, 0.08), C.grey, at(1.9, 6.4, -0.2), 0);
    add(new BoxGeometry(1.3, 2.2, 0.05), C.orange, at(2.0, 5.2, -0.2), 0.02);
    add(new ConeGeometry(0.65, 0.5, 3), C.orange, at(2.0, 3.85, -0.2, 0, [1, 1, 0.08], Math.PI), 0);
    add(new SphereGeometry(0.6, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2.4), C.cream, at(-1.6, 2.9, -0.6, 0.6, 1, 1.0), 0.02);
    lit.add(new IcosahedronGeometry(0.1, 0), 0xff9a4a, within(m, at(1.3, 8.6, -0.2)), 0);
    p.warm.push([...scenePoint(m, 1.3, 8.6, -0.2), 0.8]);
  }
  // ---- oracle: a ring of standing stones with glowing runes round an altar, moss at their feet ----
  {
    const m = stationMatrix("oracle");
    const add = (g: BufferGeometry, color: number | Paint, local: Matrix4, vary?: number) => solid.add(g, color, within(m, local), vary);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + Math.PI / 9;
      if (Math.abs(Math.cos(a) - 1) < 0.15) continue;
      const h = 2.7 + (i % 3) * 0.4;
      const tilt = 0.05 * ((i % 3) - 1);
      add(lumpy(new BoxGeometry(0.95, h, 0.6, 1, 2, 1), 30 + i, 0.07), i % 2 ? C.stone : C.stoneShade, at(Math.sin(a) * 4.3, 1.25, Math.cos(a) * 4.3, a, 1, tilt), 0.1);
      // A rune on the inner face.
      lit.add(new BoxGeometry(0.12, 0.6, 0.02), 0x9fe0ff, within(m, at(Math.sin(a) * 3.98, 1.5, Math.cos(a) * 3.98, a, 1, tilt)), 0);
      lit.add(new BoxGeometry(0.34, 0.08, 0.02), 0x9fe0ff, within(m, at(Math.sin(a) * 3.98, 1.62, Math.cos(a) * 3.98, a, 1, tilt)), 0);
      p.cool.push([...scenePoint(m, Math.sin(a) * 3.8, 1.5, Math.cos(a) * 3.8), 0.7]);
      p.canopy.add(new IcosahedronGeometry(0.4, 0), C.leafDeep, within(m, at(Math.sin(a) * 4.5, 0.12, Math.cos(a) * 4.5, a, [1.4, 0.4, 1.2])), 0.1);
    }
    add(lumpy(new DodecahedronGeometry(0.9, 0), 40, 0.1), C.stone, at(0, 0.45, 0, 0.4, [1.2, 0.6, 0.9]), 0.08);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      lit.add(new OctahedronGeometry(0.09, 0), 0xc8e6ff, within(m, at(Math.sin(a) * 2.8, 0.1, Math.cos(a) * 2.8)), 0);
    }
  }

  // ---- paths: from the keep's foot of the stairs to every station, the way he walks ----
  const from = standAt("keep");
  const obs = obstacles();
  // Each layer has its own height, so paths, plazas and the keep's plaza never share a plane.
  solid.add(new CylinderGeometry(3.4, 3.5, 0.1, 14), C.plaza, at(...toScene(from.x, from.y, KEEP_PLAZA_TOP - 0.05)), 0);
  for (const place of PLACES) {
    if (place === "keep") continue;
    let prev = { x: from.x, y: from.y };
    for (const pt of planPath(from, standAt(place), obs)) {
      const len = Math.hypot(pt.x - prev.x, pt.y - prev.y);
      if (len > 0.01) {
        const [mx, , mz] = toScene((pt.x + prev.x) / 2, (pt.y + prev.y) / 2);
        const yaw = headingToSceneYaw(Math.atan2(pt.y - prev.y, pt.x - prev.x));
        solid.add(new BoxGeometry(1.5, 0.05, len + 1.5), C.path, at(mx, PATH_TOP - 0.025, mz, yaw), 0);
        // Flat stones half-sunk along both edges, here and there.
        const [sx0, , sz0] = toScene(prev.x, prev.y);
        const [sx1, , sz1] = toScene(pt.x, pt.y);
        for (let k = 0.5; k < len; k += 1.3) {
          const t = k / len;
          const side = Math.floor(k / 1.3) % 2 ? 1 : -1;
          const jitter = Math.sin(k * 7.1 + mx) * 0.12;
          const px = sx0 + (sx1 - sx0) * t + Math.cos(yaw) * side * (0.8 + jitter);
          const pz = sz0 + (sz1 - sz0) * t - Math.sin(yaw) * side * (0.8 + jitter);
          solid.add(chip(lumpy(new IcosahedronGeometry(0.16, 0), k + mx, 0.2), Math.round(k * 3 + mz), 1, 0.7), (k * 5) % 2 > 1 ? C.stone : C.stoneShade, at(px, PATH_TOP - 0.02, pz, k * 2.3, [1.3, 0.35, 1]), 0.06);
        }
      }
      prev = pt;
    }
    solid.add(new CylinderGeometry(1.8, 1.9, 0.075, 12), C.plaza, at(...toScene(prev.x, prev.y, STATION_PLAZA_TOP - 0.0375)), 0);
  }

  // ---- lanterns: a post at every station's standing place (on his left; the dog keeps his right) ----
  for (const place of PLACES) {
    const s = standAt(place);
    const side = s.facing + Math.PI / 2;
    const [sx, , sz] = toScene(s.x + Math.cos(side) * 1.9, s.y + Math.sin(side) * 1.9, 0);
    solid.add(new CylinderGeometry(0.06, 0.09, 2.1, 6), C.woodDark, at(sx, 1.05, sz), 0);
    solid.add(new BoxGeometry(0.4, 0.05, 0.05), C.woodDark, at(sx, 2.05, sz), 0);
    lanternBox(p, sx, 2.3, sz);
  }
}

export interface FleetSpot {
  node: WorldNode;
  /** World position of its label (z up). */
  label: Vec3;
}

export class Keep {
  readonly group = new Group();
  private readonly solidMaterial = new MeshLambertNodeMaterial({ vertexColors: true });
  private readonly canopyMaterial = new MeshLambertNodeMaterial({ vertexColors: true });
  /** The great tree's crown by the season: how far its leaves have turned (0 green to 1 gold and rust), and the share of them it still holds. */
  private readonly crownTurn = uniform(0);
  private readonly crownKeep = uniform(1);
  private readonly nightUniform = uniform(0);
  private readonly dayGlass = uniform(new Color(0xb9d4e6));
  private readonly nightGlass = uniform(new Color(0xffc46e));
  private readonly glassMaterial = new MeshBasicNodeMaterial({ vertexColors: true });
  private readonly litMaterial = new MeshBasicNodeMaterial({ vertexColors: true });
  private readonly beacon = new Group();
  private readonly orb: Mesh;
  private fleet = new Group();
  private fleetKey = "";
  private night = 0;
  /** At most a few cheap lights; they only light up at night. */
  private readonly lamps: PointLight[] = [];
  spots: FleetSpot[] = [];
  /** Where the keep's lamps and windows glow at night (scene, radius), warm and cool (screens, runes). */
  readonly warmGlows: [number, number, number, number][];
  readonly coolGlows: [number, number, number, number][];

  constructor(shadows: boolean, lights: number) {
    const parts: Parts = { solid: new Mesher(), canopy: new Mesher(), glass: new Mesher(), lit: new Mesher(), warm: [], cool: [] };
    buildStations(parts);
    this.warmGlows = parts.warm;
    this.coolGlows = parts.cool;
    this.solidMaterial.maskNode = occlusionMask();
    // In rain: wet roofs, decks and walls, and puddles that ring with drops on the paths and plazas.
    this.solidMaterial.colorNode = puddleDarken();
    this.solidMaterial.emissiveNode = pathSheen(0.8);
    // The great tree's crown keeps the season with the rest of the land: its leaves turn gold and rust one by one
    // in autumn, most come down, and what it holds through the winter is brown (an oak keeps some of its leaves);
    // in spring it's thin and fresh until it fills. Each facet is its own leaf-mass: its own shade (the mesher
    // varies every face a little) is what orders it.
    const leaf = vertexColor().rgb;
    const each = fract(leaf.r.mul(91.7).add(leaf.g.mul(37.3)).add(leaf.b.mul(57.1)).mul(13.7));
    const turned = smoothstep(each.mul(0.6), each.mul(0.6).add(0.4), this.crownTurn);
    // (The baked shade under the crown stays: the autumn colour takes the facet's own lightness.)
    const light = dot(leaf, vec3(0.3, 0.6, 0.1)).div(0.45).clamp(0.4, 1.3);
    const autumn = mix(vec3(0.76, 0.36, 0.05), vec3(0.5, 0.13, 0.035), each).mul(light);
    this.canopyMaterial.colorNode = mix(vec3(1), autumn.div(leaf.max(0.01)), turned);
    this.canopyMaterial.maskNode = occlusionMask().and(fract(each.mul(7.31).add(0.37)).lessThan(this.crownKeep));
    // Glass: the sky's pale blue by day, a warm lit room at night (bright enough to bloom past white).
    this.glassMaterial.colorNode = mix(this.dayGlass, this.nightGlass.mul(1.8), this.nightUniform).mul(vertexColor());
    // Lamps and screens: lit a little by day, bright at night.
    this.litMaterial.colorNode = vertexColor().mul(float(0.85).add(this.nightUniform.mul(1.6)));
    const solid = new Mesh(parts.solid.build({ ao: groundAO(0.58, 1.3, 0.68) }), this.solidMaterial);
    solid.castShadow = shadows;
    solid.receiveShadow = shadows;
    this.canopyMaterial.positionNode = swaying(0.0012);
    const canopy = new Mesh(parts.canopy.build({ ao: groundAO(0.6, 1, 0.7) }), this.canopyMaterial);
    canopy.castShadow = shadows;
    this.group.add(solid, canopy, new Mesh(parts.glass.build(), this.glassMaterial), new Mesh(parts.lit.build(), this.litMaterial));

    // Lights by tier: the lab's door, the keep's room, the lookout's mast.
    const forge = forgeDoor();
    const lab = new PointLight(0xffb36a, 0, 14, 1.6);
    lab.position.set(...toScene(forge[0], forge[1], 2.2));
    const room = new PointLight(0xffc27a, 0, 16, 1.6);
    room.position.set(0, 7, 6.5);
    const tower = STATIONS.watchtower;
    const mast = new PointLight(0xffa860, 0, 18, 1.8);
    mast.position.set(...toScene(tower.x, tower.y, 9.5));
    for (const light of [lab, room, mast].slice(0, Math.max(0, lights))) {
      this.lamps.push(light);
      this.group.add(light);
    }

    // The oracle's orb.
    const oracle = STATIONS.oracle;
    const [ox, , oz] = toScene(oracle.x, oracle.y, 0);
    this.orb = new Mesh(new IcosahedronGeometry(0.32, 1), new MeshBasicMaterial({ color: 0xd6eeff }));
    this.orb.position.set(ox, 1.7, oz);
    this.group.add(this.orb);
    this.coolGlows.push([ox, 1.7, oz, 1.4]);

    // The beacon: a flame on a mast above the room and a column of light, when something needs you.
    const flame = new Mesh(new ConeGeometry(0.4, 1.1, 6), new MeshBasicMaterial({ color: 0xffb347 }));
    flame.position.set(-2, 8.6, 3.4);
    const mastPole = new Mesh(new CylinderGeometry(0.06, 0.06, 1.4, 5), new MeshBasicMaterial({ color: C.grey }));
    mastPole.position.set(-2, 7.8, 3.4);
    const beam = new Mesh(
      new CylinderGeometry(0.3, 0.8, 40, 10, 1, true),
      new MeshBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0.22, blending: AdditiveBlending, depthWrite: false }),
    );
    beam.position.set(-2, 29, 3.4);
    this.beacon.add(flame, mastPole, beam);
    this.beacon.visible = false;
    this.group.add(this.beacon, this.fleet);
  }

  /** 0 by day, 1 at night: glass turns from sky blue to warm, lamps and screens brighten, lights come on. */
  setNight(night: number): void {
    this.night = night;
    this.nightUniform.value = night;
    for (const lamp of this.lamps) lamp.intensity = 8 * night;
  }

  setBeacon(on: boolean): void {
    this.beacon.visible = on;
  }

  get beaconOn(): boolean {
    return this.beacon.visible;
  }

  /** Banners for nodes, a tower for each sandbox host, along the arc in front of the keep. Lit when online. */
  setNodes(nodes: WorldNode[]): void {
    const shown = nodes.filter((n) => n.kind === "node").slice(0, 16);
    const key = JSON.stringify(shown.map((n) => [n.id, n.name, n.online, n.self, n.sandboxHost]));
    if (key === this.fleetKey) return;
    this.fleetKey = key;
    this.group.remove(this.fleet);
    disposeTree(this.fleet, [this.solidMaterial, this.litMaterial]);
    this.fleet = new Group();
    this.spots = [];
    const solid = new Mesher();
    const lit = new Mesher();
    shown.forEach((node, i) => {
      // Slots on both sides of the way to the stairs, nearest first.
      const { x, y } = fleetSlot(i);
      const [sx, , sz] = toScene(x, y, 0);
      const cloth = node.online ? (node.self ? C.orange : 0xf1b26a) : 0x9a9ea6;
      if (node.sandboxHost) {
        solid.add(new CylinderGeometry(0.7, 0.9, 5.4, 8), C.cream, at(sx, 2.7, sz), 0.03);
        solid.add(new CylinderGeometry(0.92, 0.92, 0.3, 8), C.orange, at(sx, 3.8, sz), 0);
        solid.add(new SphereGeometry(0.9, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2), C.cream, at(sx, 5.4, sz), 0.02);
        (node.online ? lit : solid).add(new BoxGeometry(0.42, 0.42, 0.42), node.online ? 0xffd27a : 0x6a6e75, at(sx, 6.5, sz, 0.6, 1, 0.5), 0);
        this.spots.push({ node, label: [x, y, 7.8] });
      } else {
        solid.add(new CylinderGeometry(0.07, 0.09, 4.4, 6), C.woodDark, at(sx, 2.2, sz));
        solid.add(new BoxGeometry(1.2, 0.07, 0.07), C.woodDark, at(sx + 0.55, 4.1, sz));
        solid.add(new BoxGeometry(1, 1.7, 0.05), cloth, at(sx + 0.6, 3.15, sz), 0.02);
        solid.add(new ConeGeometry(0.5, 0.45, 3), cloth, at(sx + 0.6, 2.08, sz, 0, [1, 1, 0.1], Math.PI), 0);
        (node.online ? lit : solid).add(new OctahedronGeometry(0.2, 0), node.online ? 0xffd27a : 0x6a6e75, at(sx, 4.6, sz), 0);
        this.spots.push({ node, label: [x, y, 5.4] });
      }
    });
    if (!solid.empty) this.fleet.add(new Mesh(solid.build({ ao: groundAO(0.6, 1.2, 0.7) }), this.solidMaterial));
    if (!lit.empty) this.fleet.add(new Mesh(lit.build(), this.litMaterial));
    this.group.add(this.fleet);
  }

  /** Flicker and float. */
  animate(t: number, motion: boolean): void {
    // The crown by the season (eased; at once under reduced motion).
    const s = seasonState;
    const turn = Math.max(s.turn, s.winter) * (1 - s.spring);
    const hold = 0.36 + 0.64 * s.leaf;
    const k = motion ? 0.05 : 1;
    this.crownTurn.value += (turn - this.crownTurn.value) * k;
    this.crownKeep.value += (hold - this.crownKeep.value) * k;
    if (!motion) {
      this.orb.position.y = 1.7;
      return;
    }
    const flicker = 0.85 + 0.15 * Math.sin(t * 11) * Math.sin(t * 7.3 + 1);
    if (this.lamps[0]) this.lamps[0].intensity = (6.5 + 3 * flicker) * this.night;
    this.orb.position.y = 1.7 + 0.15 * Math.sin(t * 1.6);
    this.orb.rotation.y = t * 0.6;
    if (this.beacon.visible) this.beacon.children[0]!.scale.set(1, 0.85 + 0.25 * flicker, 1);
  }

  dispose(): void {
    disposeTree(this.group);
    for (const m of [this.solidMaterial, this.canopyMaterial, this.glassMaterial, this.litMaterial]) m.dispose();
  }
}

/** Disposes every geometry and material under `root`, except materials in `keep` (shared, still in use). */
export function disposeTree(root: Object3D, keep: Material[] = []): void {
  root.traverse((o) => {
    if (o instanceof Mesh || o instanceof Line) {
      o.geometry.dispose();
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (!keep.includes(m)) m.dispose();
    }
  });
}

/** A point in front of a station, in the world (z up): `lx` to its left, `lz` towards its front. */
function stationPoint(place: Place, lx: number, lz: number, z: number): Vec3 {
  const s = STATIONS[place];
  const h = stationFacing(place);
  // A station's local +x is the world direction h + 90°, its +z (its front) is h.
  return [s.x - Math.sin(h) * lx + Math.cos(h) * lz, s.y + Math.cos(h) * lx + Math.sin(h) * lz, z];
}

/** The lab's workbench in the world (z up), where sparks fly from. */
export const forgeAnvil = (): Vec3 => stationPoint("forge", 0.35, 2.1, 1.05);
const forgeDoor = (): Vec3 => stationPoint("forge", 0, 1.8, 0);

export const stationLabelPoint = (place: Place): Vec3 => [STATIONS[place].x, STATIONS[place].y, LABEL_HEIGHT[place]];
