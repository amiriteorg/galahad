import type { WorldNode } from "@galahad/core/world";
import { STATIONS } from "@galahad/core/world";
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Group,
  IcosahedronGeometry,
  Line,
  type Material,
  type Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshLambertNodeMaterial,
  type Object3D,
  OctahedronGeometry,
  PointLight,
  SphereGeometry,
} from "three/webgpu";
import { headingToSceneYaw, toScene, type Vec3 } from "./coords.ts";
import { at, Mesher, within } from "./mesher.ts";
import { obstacles, PLACES, planPath, standAt, stationFacing } from "./path.ts";
import { swaying } from "./vegetation.ts";

/*
 * Galahad's keep and its stations, after the treehouse-and-meadow look: a
 * treehouse in a giant tree (deck, stairs, a glass-walled room with solar panels),
 * a deck table with mugs, a telescope platform, a reading nook, a hillside lab with
 * a wide door and glowing screens, a lookout with an antenna mast, a sturdy vault
 * hut, a radio post with an orange banner and a ring of standing stones. Built
 * from primitives into a few merged meshes: the solid one, the giant tree's
 * canopy (swaying), glass (blue by day, warm by night), lamps and screens, plus
 * the oracle's orb, the beacon and the fleet's banners. All original shapes.
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
  trunk: 0x9c6845,
  trunkDark: 0x7f5236,
  leaf: 0xa7c94b,
  leafLight: 0xc2d65c,
  leafDeep: 0x8db743,
  stone: 0xdcc6b8,
  stoneShade: 0xc9b0a3,
  limestone: 0xece1cb,
  solar: 0x2e4a86,
  path: 0xd2b48a,
  plaza: 0xcfb48f,
  book1: 0x6b8fb8,
  book2: 0xc0644a,
  book3: 0x7aa86a,
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
  const tris = [D, Cc, R2, D, R2, R1, B, A, R1, B, R1, R2, Cc, B, R2, A, D, R1];
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

interface Parts {
  solid: Mesher;
  canopy: Mesher;
  glass: Mesher;
  /** Lamps, screens, printers: vertex-coloured light. */
  lit: Mesher;
}

/** Posts and two rails along a polyline (scene coordinates, at height `y`), skipping segments flagged in `gaps`. */
function railing(m: Mesher, points: [number, number][], y: number, gaps: Set<number> = new Set()): void {
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, az] = points[i]!;
    const [bx, bz] = points[i + 1]!;
    m.add(new BoxGeometry(0.1, 1, 0.1), C.woodDark, at(ax, y + 0.5, az));
    if (gaps.has(i)) continue;
    const len = Math.hypot(bx - ax, bz - az);
    const yaw = Math.atan2(bx - ax, bz - az);
    for (const h of [0.5, 0.95]) m.add(new BoxGeometry(0.07, 0.07, len), C.wood, at((ax + bx) / 2, y + h, (az + bz) / 2, yaw), 0.03);
  }
}

function lanternBox(p: Parts, x: number, y: number, z: number): void {
  p.solid.add(new BoxGeometry(0.3, 0.06, 0.3), C.grey, at(x, y + 0.2, z), 0);
  p.solid.add(new ConeGeometry(0.24, 0.18, 4), C.grey, at(x, y + 0.31, z, Math.PI / 4), 0);
  p.lit.add(new BoxGeometry(0.2, 0.3, 0.2), 0xffd9a0, at(x, y, z), 0);
}

function buildKeep(p: Parts): void {
  // The keep faces south (its local frame is the scene's): a giant tree with a deck and a room.
  const { solid, canopy, glass } = p;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    solid.add(new ConeGeometry(0.9, 3.4, 5), C.trunkDark, at(Math.sin(a) * 2.2, 0.6, Math.cos(a) * 2.2, a, 1, Math.PI / 2 - 0.35, 0).multiply(at(0, 0, 0, 0, 1, 0, 0)), 0.1);
  }
  solid.add(new CylinderGeometry(1.55, 2.4, 9, 7), C.trunk, at(0, 4.5, 0), 0.1);
  solid.add(new CylinderGeometry(1.1, 1.55, 3.2, 7), C.trunk, at(0.15, 10.4, -0.15, 0.4, 1, -0.04, 0.03), 0.1);
  for (const [rz, ry, len] of [[0.95, 0.3, 7], [-0.9, 1.7, 6.5], [0.85, 3.4, 6], [-0.8, 4.7, 7]] as const) {
    const branch = at(0, 9.6, 0, ry).multiply(at(0, 0, 0, 0, 1, 0, rz)).multiply(at(0, len / 2, 0));
    solid.add(new CylinderGeometry(0.32, 0.55, len, 6), C.trunk, branch, 0.1);
  }
  // A crown of chunky, faceted leaf clusters.
  const clusters: [number, number, number, number, number][] = [
    [0, 18.5, 0, 4.6, C.leaf], [4.6, 16.8, 1.2, 3.6, C.leafLight], [-4.4, 17.2, -1, 3.8, C.leaf], [1.5, 17, 4.4, 3.4, C.leafDeep],
    [-1.8, 16.8, -4.6, 3.6, C.leafLight], [3.4, 19.6, -3, 3, C.leafDeep], [-3.6, 19.8, 2.6, 3.1, C.leafLight], [6.6, 15.4, -2.4, 2.6, C.leaf],
    [-6.4, 15.6, 2.2, 2.7, C.leafDeep], [0.4, 21.6, 0.6, 3, C.leafLight],
  ];
  for (const [x, y, z, r, color] of clusters) canopy.add(new IcosahedronGeometry(r, 0), color, at(x * 1.15, y - 5.6, z * 1.15, x * 0.7, [1.05, 0.78, 1.05]), 0.08);

  // The deck round the trunk, on struts, with a railing; a gap where the stairs land.
  const D = 4.2;
  solid.add(new CylinderGeometry(6.3, 6.3, 0.3, 8), C.plank, at(0, D, 0, Math.PI / 8), 0.04);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    solid.add(new BoxGeometry(0.28, 4.6, 0.28), C.woodDark, at(Math.sin(a) * 3.6, 2.2, Math.cos(a) * 3.6, a, 1, 0.55 * Math.cos(a) * 0, 0));
    solid.add(new BoxGeometry(0.24, 0.24, 4.4), C.woodDark, at(Math.sin(a) * 3.4, D - 0.9, Math.cos(a) * 3.4, a, 1, 0.5));
  }
  const octagon: [number, number][] = [];
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    octagon.push([Math.sin(a) * 6.15, Math.cos(a) * 6.15]);
  }
  railing(solid, octagon, D + 0.15, new Set([6]));
  // Stairs: from the deck's south-west down towards the keep's door, with lanterns at the foot.
  const top: [number, number] = [-5.4, 3.0];
  const foot: [number, number] = [-1.6, 6.9];
  const steps = 11;
  const yaw = Math.atan2(foot[0] - top[0], foot[1] - top[1]);
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) / steps;
    solid.add(new BoxGeometry(1.3, 0.12, 0.5), C.plank, at(top[0] + (foot[0] - top[0]) * t, D - D * t, top[1] + (foot[1] - top[1]) * t, yaw), 0.05);
  }
  for (const side of [-0.7, 0.7]) {
    const ox = Math.cos(yaw) * side;
    const oz = -Math.sin(yaw) * side;
    const run = Math.hypot(foot[0] - top[0], foot[1] - top[1]);
    const pitch = Math.atan2(D, run);
    solid.add(new BoxGeometry(0.08, 0.08, Math.hypot(run, D)), C.wood, at((top[0] + foot[0]) / 2 + ox, D / 2 + 0.9, (top[1] + foot[1]) / 2 + oz, yaw, 1, pitch), 0.03);
    solid.add(new BoxGeometry(0.1, 1, 0.1), C.woodDark, at(foot[0] + ox, 0.5, foot[1] + oz));
  }
  lanternBox(p, foot[0] - 0.8, 1.2, foot[1] + 0.2);
  lanternBox(p, foot[0] + 0.8, 1.2, foot[1] + 0.2);

  // The room: cream panels, an orange stripe, a glass front, a wide roof with solar panels.
  const R = D + 0.15;
  solid.add(new BoxGeometry(5.4, 2.7, 0.2), C.cream, at(0, R + 1.35, 2.1));
  solid.add(new BoxGeometry(0.2, 2.7, 3.1), C.cream, at(-2.6, R + 1.35, 3.55));
  solid.add(new BoxGeometry(0.2, 2.7, 3.1), C.cream, at(2.6, R + 1.35, 3.55));
  solid.add(new BoxGeometry(0.5, 2.7, 0.22), C.orange, at(-2.2, R + 1.35, 5.05), 0.02);
  solid.add(new BoxGeometry(5.4, 0.35, 0.22), C.cream, at(0, R + 0.17, 5.05));
  solid.add(new BoxGeometry(5.4, 0.3, 0.22), C.cream, at(0, R + 2.55, 5.05));
  for (const x of [-1.9, 0.1, 2.5]) solid.add(new BoxGeometry(0.1, 2.3, 0.24), C.grey, at(x, R + 1.35, 5.06), 0);
  glass.add(new BoxGeometry(1.9, 2, 0.06), 0xffffff, at(-0.9, R + 1.35, 5.06), 0);
  glass.add(new BoxGeometry(2.3, 2, 0.06), 0xffffff, at(1.3, R + 1.35, 5.06), 0);
  glass.add(new BoxGeometry(0.06, 1.2, 1.6), 0xffffff, at(2.72, R + 1.5, 3.6), 0);
  solid.add(new BoxGeometry(6.2, 0.22, 4.2), C.woodDark, at(0, R + 2.85, 3.55, 0, 1, -0.08));
  for (const x of [-1.8, 0, 1.8]) solid.add(new BoxGeometry(1.6, 0.06, 2.4), C.solar, at(x, R + 3.02, 3.4, 0, 1, -0.08), 0.02);
  solid.add(new BoxGeometry(0.9, 0.7, 0.5), C.grey, at(-1.6, R + 0.35, 1.5));
  solid.add(new BoxGeometry(0.92, 0.1, 0.52), C.orange, at(-1.6, R + 0.62, 1.5), 0);
  lanternBox(p, 2.9, R + 2.1, 5.2);
  // Planters along the railing.
  for (const [x, z] of [[4.4, 2.6], [4.8, -1.6], [-4.6, -2.2]] as const) {
    solid.add(new BoxGeometry(0.9, 0.45, 0.5), C.woodDark, at(x, R + 0.22, z, Math.atan2(x, z)));
    canopy.add(new IcosahedronGeometry(0.42, 0), C.leafDeep, at(x, R + 0.62, z), 0.1);
  }
}

function buildStations(p: Parts): void {
  const { solid, glass, lit } = p;
  buildKeep(p);

  // ---- council: a low deck with a long table, benches and mugs ----
  {
    const m = stationMatrix("council");
    const add = (g: BufferGeometry, color: number, local: Matrix4, vary?: number) => solid.add(g, color, within(m, local), vary);
    add(new BoxGeometry(5.6, 0.16, 4.4), C.plank, at(0, 0.08, 0), 0.05);
    add(new BoxGeometry(2.6, 0.1, 1.1), C.wood, at(0, 0.82, 0));
    for (const [x, z] of [[-1.15, -0.45], [1.15, -0.45], [-1.15, 0.45], [1.15, 0.45]] as const) add(new BoxGeometry(0.1, 0.74, 0.1), C.woodDark, at(x, 0.45, z));
    for (const z of [-1.05, 1.05]) add(new BoxGeometry(2.4, 0.08, 0.4), C.wood, at(0, 0.48, z));
    for (const [x, z, c] of [[-0.8, -0.2, C.cream], [-0.2, 0.25, C.orange], [0.5, -0.15, C.cream], [1, 0.2, C.cream]] as const) {
      add(new CylinderGeometry(0.06, 0.055, 0.12, 8), c, at(x, 0.93, z), 0);
    }
    add(new BoxGeometry(0.5, 0.22, 0.3), C.grey, at(-1.05, 0.98, 0.1));
    add(new BoxGeometry(0.52, 0.05, 0.32), C.orange, at(-1.05, 1.09, 0.1), 0);
    add(new BoxGeometry(0.06, 2.6, 0.06), C.woodDark, at(2.4, 1.3, -1.8));
    add(new ConeGeometry(1.6, 0.6, 8), C.cream, at(2.4, 2.75, -1.8), 0.03);
  }
  // ---- observatory: a telescope platform on stilts, with a ladder ----
  {
    const m = stationMatrix("observatory");
    const add = (g: BufferGeometry, color: number, local: Matrix4, vary?: number) => solid.add(g, color, within(m, local), vary);
    const H = 2.6;
    for (const [x, z] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]] as const) add(new BoxGeometry(0.22, H, 0.22), C.woodDark, at(x, H / 2, z));
    for (const z of [-1.6, 1.6]) add(new BoxGeometry(3.2, 0.12, 0.12), C.wood, at(0, H * 0.45, z, 0, 1, 0, 0.6));
    add(new BoxGeometry(3.8, 0.2, 3.8), C.plank, at(0, H, 0), 0.04);
    const square: [number, number][] = [[-1.85, -1.85], [1.85, -1.85], [1.85, 1.85], [-1.85, 1.85], [-1.85, -1.85]];
    railing(p.solid, square.map(([x, z]) => {
      const v = within(m, at(x, 0, z));
      return [v.elements[12]!, v.elements[14]!] as [number, number];
    }), H + 0.1, new Set([2]));
    for (let i = 0; i < 7; i++) add(new BoxGeometry(0.8, 0.06, 0.08), C.wood, at(0, 0.3 + i * 0.36, 2.05), 0);
    for (const x of [-0.42, 0.42]) add(new BoxGeometry(0.07, H + 0.4, 0.07), C.woodDark, at(x, H / 2, 2.05));
    // The telescope on its tripod.
    for (let i = 0; i < 3; i++) add(new BoxGeometry(0.04, 1.2, 0.04), C.grey, at(Math.sin((i * Math.PI * 2) / 3) * 0.25, H + 0.6, Math.cos((i * Math.PI * 2) / 3) * 0.25, (i * Math.PI * 2) / 3, 1, 0.22), 0);
    add(new CylinderGeometry(0.12, 0.15, 1.5, 10), C.cream, at(0, H + 1.45, -0.1, 0, 1, -0.75), 0.02);
    add(new CylinderGeometry(0.16, 0.16, 0.12, 10), C.orange, at(0, H + 1.3, 0.02, 0, 1, -0.75), 0);
    add(new BoxGeometry(0.6, 0.4, 0.45), C.grey, at(1.1, H + 0.3, -1.1));
  }
  // ---- library: a reading nook with shelves, an armchair and a lamp ----
  {
    const m = stationMatrix("library");
    const add = (g: BufferGeometry, color: number, local: Matrix4, vary?: number) => solid.add(g, color, within(m, local), vary);
    add(new BoxGeometry(5, 0.2, 4), C.plank, at(0, 0.1, 0), 0.04);
    add(new BoxGeometry(5, 3, 0.2), C.cream, at(0, 1.6, -1.9));
    add(new BoxGeometry(0.2, 3, 4), C.cream, at(-2.4, 1.6, 0));
    add(new BoxGeometry(0.2, 3, 2), C.cream, at(2.4, 1.6, -1));
    add(new BoxGeometry(0.4, 3, 0.22), C.orange, at(2.4, 1.6, 0.1), 0.02);
    add(gable(4.8, 1.4, 5.8), C.woodDark, at(0, 3.1, 0), 0.03);
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
    add(new CylinderGeometry(0.03, 0.03, 1.6, 5), C.grey, at(-1.6, 0.9, 0.6), 0);
    lit.add(new ConeGeometry(0.28, 0.32, 8), 0xffd9a0, at(-1.6, 1.8, 0.6), 0);
    glass.add(new BoxGeometry(0.06, 1.1, 1.2), 0xffffff, at(-2.52, 1.8, 0.6), 0);
  }
  // ---- forge: a research bunker set into a limestone hill: wide door, workbench, screens, printer ----
  {
    const m = stationMatrix("forge");
    const add = (g: BufferGeometry, color: number, local: Matrix4, vary?: number) => solid.add(g, color, within(m, local), vary);
    for (const [x, y, z, r] of [[0, 1.6, -3.4, 4.2], [-3.2, 1.2, -2.6, 3], [3.3, 1.1, -2.8, 3.1], [0.6, 3.6, -4.6, 3.2], [-2, 3, -4.8, 2.6]] as const) {
      add(new DodecahedronGeometry(r, 0), C.limestone, at(x, y, z, x + z, [1, 0.8, 1]), 0.07);
    }
    add(new BoxGeometry(5.2, 3.6, 0.6), C.cream, at(0, 1.8, 0.9));
    add(new BoxGeometry(3.4, 2.7, 0.62), 0x2b2d33, at(0, 1.38, 0.92), 0);
    for (const x of [-1.85, 1.85]) add(new BoxGeometry(0.3, 2.9, 0.66), C.orange, at(x, 1.45, 0.93), 0.02);
    add(new BoxGeometry(3.9, 0.28, 0.66), C.grey, at(0, 2.9, 0.93), 0);
    add(new BoxGeometry(5.6, 0.2, 1.4), C.greyLight, at(0, 3.7, 1.1), 0.02);
    lit.add(new BoxGeometry(0.9, 0.55, 0.06), 0x6fe8d8, at(-0.8, 1.9, 0.6), 0);
    lit.add(new BoxGeometry(0.9, 0.55, 0.06), 0x6fe8d8, at(0.25, 1.9, 0.6), 0);
    lit.add(new BoxGeometry(0.5, 0.42, 0.42), 0xffb35a, at(1.1, 1.05, 0.55), 0);
    // The workbench in front, and a little crate.
    add(new BoxGeometry(2, 0.12, 0.8), C.wood, at(1.2, 0.86, 2.2));
    add(new BoxGeometry(1.9, 0.75, 0.7), C.creamShade, at(1.2, 0.4, 2.2));
    for (const x of [0.5, 1.2, 1.9]) add(new BoxGeometry(0.45, 0.05, 0.02), C.orange, at(x, 0.6, 2.56), 0);
    add(new BoxGeometry(0.3, 0.18, 0.2), C.grey, at(0.6, 1, 2.1));
    add(new BoxGeometry(0.7, 0.5, 0.5), C.creamShade, at(-1.6, 0.25, 2.1, 0.3));
    add(new BoxGeometry(0.72, 0.06, 0.52), C.orange, at(-1.6, 0.52, 2.1, 0.3), 0);
    // A solar panel and a little pipe on the hill.
    add(new BoxGeometry(2.2, 0.06, 1.4), C.solar, at(-0.6, 5.3, -2.2, 0.2, 1, -0.4), 0.02);
    add(new CylinderGeometry(0.08, 0.08, 2.5, 6), C.grey, at(2.6, 2.4, 0.4), 0);
  }
  // ---- watchtower: a lookout on braced legs, a roof and an antenna mast ----
  {
    const m = stationMatrix("watchtower");
    const add = (g: BufferGeometry, color: number, local: Matrix4, vary?: number) => solid.add(g, color, within(m, local), vary);
    const H = 7;
    for (const [x, z] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]] as const) add(new BoxGeometry(0.28, H, 0.28), C.woodDark, at(x * 1.1, H / 2, z * 1.1, 0, 1, z * 0.04, -x * 0.04));
    for (const y of [2.2, 4.6]) for (const z of [-1.35, 1.35]) add(new BoxGeometry(3, 0.12, 0.12), C.wood, at(0, y, z, 0, 1, 0, 0.7), 0.03);
    add(new BoxGeometry(3.6, 0.22, 3.6), C.plank, at(0, H, 0), 0.04);
    for (const [x, z] of [[-1.7, -1.7], [1.7, -1.7], [-1.7, 1.7], [1.7, 1.7]] as const) add(new BoxGeometry(0.12, 2.2, 0.12), C.woodDark, at(x, H + 1.1, z));
    add(new BoxGeometry(4.2, 0.2, 4.2), C.woodDark, at(0, H + 2.3, 0, 0, 1, 0.06), 0.03);
    add(new BoxGeometry(3.4, 0.5, 0.08), C.wood, at(0, H + 0.45, 1.75), 0.03);
    add(new BoxGeometry(3.4, 0.08, 0.5), C.orange, at(0, H + 2.42, 0), 0);
    add(new CylinderGeometry(0.05, 0.08, 5, 5), C.grey, at(0.9, H + 4.8, -0.9), 0);
    for (const y of [H + 3.6, H + 5.2]) add(new BoxGeometry(0.9, 0.04, 0.04), C.grey, at(0.9, y, -0.9), 0);
    add(new CylinderGeometry(0.1, 0.13, 0.8, 8), C.cream, at(-0.6, H + 0.9, 0.6, 0.6, 1, -0.9), 0.02);
    for (let i = 0; i < 10; i++) add(new BoxGeometry(0.7, 0.05, 0.07), C.wood, at(0, 0.4 + i * 0.66, 1.62), 0);
    lit.add(new IcosahedronGeometry(0.12, 0), 0xff9a4a, within(m, at(0.9, H + 7.35, -0.9)), 0);
  }
  // ---- treasury: a small, sturdy vault hut with a round door ----
  {
    const m = stationMatrix("treasury");
    const add = (g: BufferGeometry, color: number, local: Matrix4, vary?: number) => solid.add(g, color, within(m, local), vary);
    add(new BoxGeometry(4.4, 0.3, 4), C.greyLight, at(0, 0.15, 0), 0.03);
    add(new BoxGeometry(4, 3, 3.4), C.creamShade, at(0, 1.8, -0.2), 0.04);
    add(new BoxGeometry(4.5, 0.4, 3.9), C.cream, at(0, 3.45, -0.2), 0.03);
    add(new BoxGeometry(4.05, 0.3, 3.45), C.orange, at(0, 2.9, -0.2), 0);
    add(new CylinderGeometry(1, 1, 0.3, 16).rotateX(Math.PI / 2), C.grey, at(0, 1.5, 1.55), 0.02);
    add(new CylinderGeometry(0.78, 0.78, 0.34, 16).rotateX(Math.PI / 2), C.greyLight, at(0, 1.5, 1.6), 0);
    for (let i = 0; i < 3; i++) add(new BoxGeometry(1, 0.08, 0.06), C.orange, at(0, 1.5, 1.8, 0, 1, 0, (i * Math.PI) / 3), 0);
    add(new CylinderGeometry(0.12, 0.12, 0.1, 8).rotateX(Math.PI / 2), C.orange, at(0, 1.5, 1.82), 0);
    lit.add(new BoxGeometry(0.5, 0.2, 0.06), 0xffd9a0, within(m, at(0, 2.75, 1.52)), 0);
  }
  // ---- messenger's post: a radio mast, a dish, an orange banner and a radio hut ----
  {
    const m = stationMatrix("messenger");
    const add = (g: BufferGeometry, color: number, local: Matrix4, vary?: number) => solid.add(g, color, within(m, local), vary);
    add(new BoxGeometry(2.2, 2.3, 1.8), C.cream, at(-1.2, 1.15, -0.4));
    add(new BoxGeometry(2.5, 0.18, 2.1), C.grey, at(-1.2, 2.38, -0.4, 0, 1, 0.08));
    add(new BoxGeometry(0.8, 1.7, 0.08), C.orange, at(-1.2, 0.85, 0.52), 0);
    add(new CylinderGeometry(0.06, 0.16, 8.5, 4), C.grey, at(1.3, 4.25, -0.2, Math.PI / 4), 0);
    for (let i = 1; i < 7; i++) add(new BoxGeometry(0.06, 0.06, 0.7 - i * 0.07), C.greyLight, at(1.3, i * 1.15, -0.2, 0, 1, 0, 0.6), 0);
    add(new BoxGeometry(1.6, 0.08, 0.08), C.grey, at(1.9, 6.4, -0.2), 0);
    add(new BoxGeometry(1.3, 2.2, 0.05), C.orange, at(2.0, 5.2, -0.2), 0.02);
    add(new ConeGeometry(0.65, 0.5, 3), C.orange, at(2.0, 3.85, -0.2, 0, [1, 1, 0.08], Math.PI), 0);
    add(new SphereGeometry(0.6, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2.4), C.cream, at(-1.6, 2.9, -0.6, 0.6, 1, 1.0), 0.02);
    lit.add(new IcosahedronGeometry(0.1, 0), 0xff9a4a, within(m, at(1.3, 8.6, -0.2)), 0);
  }
  // ---- oracle: a ring of standing stones round an altar ----
  {
    const m = stationMatrix("oracle");
    const add = (g: BufferGeometry, color: number, local: Matrix4, vary?: number) => solid.add(g, color, within(m, local), vary);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + Math.PI / 9;
      if (Math.abs(Math.cos(a) - 1) < 0.15) continue;
      add(new BoxGeometry(0.95, 2.7 + (i % 3) * 0.4, 0.6), i % 2 ? C.stone : C.stoneShade, at(Math.sin(a) * 4.3, 1.25, Math.cos(a) * 4.3, a, 1, 0.05 * ((i % 3) - 1)), 0.1);
    }
    add(new DodecahedronGeometry(0.9, 0), C.stone, at(0, 0.45, 0, 0.4, [1.2, 0.6, 0.9]), 0.08);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      lit.add(new OctahedronGeometry(0.09, 0), 0xc8e6ff, within(m, at(Math.sin(a) * 2.8, 0.08, Math.cos(a) * 2.8)), 0);
    }
  }

  // ---- paths: from the keep's foot of the stairs to every station, the way he walks ----
  const from = standAt("keep");
  const obs = obstacles();
  solid.add(new CylinderGeometry(3.2, 3.2, 0.06, 12), C.plaza, at(...toScene(from.x, from.y, 0.03)), 0);
  for (const place of PLACES) {
    if (place === "keep") continue;
    let prev = { x: from.x, y: from.y };
    for (const pt of planPath(from, standAt(place), obs)) {
      const len = Math.hypot(pt.x - prev.x, pt.y - prev.y);
      if (len > 0.01) {
        const [mx, , mz] = toScene((pt.x + prev.x) / 2, (pt.y + prev.y) / 2);
        solid.add(new BoxGeometry(1.4, 0.04, len + 1.4), C.path, at(mx, 0.04, mz, headingToSceneYaw(Math.atan2(pt.y - prev.y, pt.x - prev.x))), 0);
      }
      prev = pt;
    }
    solid.add(new CylinderGeometry(1.7, 1.7, 0.05, 10), C.plaza, at(...toScene(prev.x, prev.y, 0.045)), 0);
  }

  // ---- lanterns: a post at every station's standing place (on his left; the dog keeps his right) ----
  for (const place of PLACES) {
    const s = standAt(place);
    const side = s.facing + Math.PI / 2;
    const [sx, , sz] = toScene(s.x + Math.cos(side) * 1.7, s.y + Math.sin(side) * 1.7, 0);
    solid.add(new CylinderGeometry(0.06, 0.08, 2.1, 6), C.woodDark, at(sx, 1.05, sz), 0);
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
  private readonly solidMaterial = new MeshLambertMaterial({ vertexColors: true });
  private readonly canopyMaterial = new MeshLambertNodeMaterial({ vertexColors: true });
  private readonly glassMaterial = new MeshBasicMaterial({ vertexColors: true });
  private readonly litMaterial = new MeshBasicMaterial({ vertexColors: true });
  private readonly beacon = new Group();
  private readonly orb: Mesh;
  private fleet = new Group();
  private fleetKey = "";
  private night = 0;
  /** At most a few cheap lights; they only light up at night. */
  private readonly lamps: PointLight[] = [];
  private readonly dayGlass = new Color(0xb9d4e6);
  private readonly nightGlass = new Color(0xffc874);
  spots: FleetSpot[] = [];

  constructor(shadows: boolean, lights: number) {
    const parts: Parts = { solid: new Mesher(), canopy: new Mesher(), glass: new Mesher(), lit: new Mesher() };
    buildStations(parts);
    const solid = new Mesh(parts.solid.build(), this.solidMaterial);
    solid.castShadow = shadows;
    solid.receiveShadow = shadows;
    this.canopyMaterial.positionNode = swaying(0.0012);
    const canopy = new Mesh(parts.canopy.build(), this.canopyMaterial);
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
    this.orb = new Mesh(new IcosahedronGeometry(0.32, 1), new MeshBasicMaterial({ color: 0xcfe9ff }));
    this.orb.position.set(ox, 1.7, oz);
    this.group.add(this.orb);

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
    this.glassMaterial.color.copy(this.dayGlass).lerp(this.nightGlass, night);
    this.litMaterial.color.setScalar(0.72 + 0.28 * night);
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
      const side = i % 2 === 0 ? 1 : -1;
      const k = Math.floor(i / 2);
      const angle = -Math.PI / 2 + side * (0.62 + k * 0.28);
      const r = 12 + (k % 2) * 1.6;
      const x = Math.cos(angle) * r;
      const y = Math.sin(angle) * r;
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
    if (!solid.empty) this.fleet.add(new Mesh(solid.build(), this.solidMaterial));
    if (!lit.empty) this.fleet.add(new Mesh(lit.build(), this.litMaterial));
    this.group.add(this.fleet);
  }

  /** Flicker and float. */
  animate(t: number, motion: boolean): void {
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
export const forgeAnvil = (): Vec3 => stationPoint("forge", 1.2, 2.2, 1.0);
const forgeDoor = (): Vec3 => stationPoint("forge", 0, 1.8, 0);

export const stationLabelPoint = (place: Place): Vec3 => [STATIONS[place].x, STATIONS[place].y, LABEL_HEIGHT[place]];
