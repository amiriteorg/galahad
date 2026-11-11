import { BoxGeometry, BufferAttribute, BufferGeometry, ConeGeometry, CylinderGeometry, type Matrix4, SphereGeometry, TorusGeometry, Vector3 } from "three/webgpu";
import {
  BLOCKHOUSE,
  BOWSER,
  DRONE_GATE_RADIUS,
  DRONE_GATES,
  DRONE_PAD,
  ENTRANCE_POSTS,
  FENCES,
  FIELD,
  FIELD_GATE,
  FLAME_DEFLECTOR,
  FLOODLIGHTS,
  HANGAR,
  HANGAR_AIRCRAFT,
  LIGHTNING_MAST_HEIGHT,
  LIGHTNING_MASTS,
  PAPIS,
  PROPS,
  RIM_MARKERS,
  RUNWAY,
  SIGN,
  SLALOM_POLES,
  START_GATE,
  STEVENSON,
  TAXIWAY,
  TIE_DOWNS,
  TOWER,
  WEATHER_MAST,
  WINDSOCK,
} from "./field-plan.ts";
import { PAVE, shade, TRACK_TOP } from "./field-ground.ts";
import { BRIDGE, OBSTACLES, SAND, sandSurface } from "./field-rover.ts";
import { at, between, bevelBox, lumpy, Mesher, type Paint } from "./mesher.ts";
import type { Glow } from "./place.ts";

/*
 * What stands still on the proving ground, built into two merged meshes: the
 * solid one (buildings, fences, masts, the rover course's obstacles, parked
 * plant; ambient occlusion baked in; a glow mask marking the hangar's and the
 * tower's insides, which are lit at night) and the lit one (lamps, lenses, glass:
 * its glow attribute says which: 0 a lamp, 0.5 a lens that only shines at
 * night, 1 glass). Lights at night are listed as halos (the place draws them).
 * Everything in the place's group's scene coordinates: ground at 0, x east,
 * y up, z south (a world point (x, y, h) is (x, h, −y)).
 */

export interface BuildDetail {
  /** Bevelled edges on boxes (more triangles, edges that catch the light). */
  bevel: boolean;
  /** Round things' sides. */
  seg: number;
  /** Corrugation ribs on the hangar, lattice bracing on masts. */
  ribs: boolean;
  /** The hangar's contents, the tower's consoles, tools and clutter. */
  interior: boolean;
  /** Small props: chocks, cones, tyres, benches. */
  props: boolean;
  /** Letters on the sign. */
  lettering: boolean;
  /** Fence posts this far apart (metres). */
  fenceStep: number;
  /** Runway edge lights this far apart (metres). */
  edgeStep: number;
}

/** A light at night: where (world, z above the ground), how big its halo, its colour. */
export interface Halo {
  x: number;
  y: number;
  z: number;
  r: number;
  color: number;
}

export interface Built {
  solid: Mesher;
  light: Mesher;
  halos: Halo[];
  /** Warm and cool glows for the scene's own halos (scene coordinates of the group). */
  warm: Glow[];
  cool: Glow[];
}

export const C = {
  cream: 0xeee6d4,
  creamShade: 0xdcd2bd,
  orange: 0xe8853a,
  orangeSoft: 0xeba36c,
  grey: 0x4a4e57,
  greyLight: 0x8b9099,
  steel: 0xb4bac2,
  steelDark: 0x7d838c,
  concrete: 0xcfc7b6,
  concreteDark: 0xb3ab9a,
  wood: 0xb57c4e,
  woodDark: 0x8b5a39,
  weathered: 0xa8916f,
  roof: 0xdd8a55,
  roofDark: 0xc2754a,
  red: 0xd9645a,
  yellow: 0xf0c95a,
  black: 0x34373d,
  white: 0xf4f1ea,
  tyre: 0x3b3e45,
  sand: 0xead9b0,
  stone: 0xd8c8b6,
  earth: 0xc9ad80,
  bark: 0x8a6243,
  glassDay: 0xa9c6d3,
  lampWarm: 0xffd59a,
  lampCool: 0xbfeaff,
};

// ---------- placing primitives (world x, y; heights above the ground) ----------

/** A world point and turn as a scene transform. `yaw` is a world turn (counter-clockwise from east, seen from above). */
const W = (x: number, y: number, h: number, yaw = 0, scale: number | [number, number, number] = 1, rx = 0, rz = 0): Matrix4 => at(x, h, -y, yaw, scale, rx, rz);

/** A cylinder's axis laid along the world direction `yaw` (a wheel's axle), centred at (x, y, h). */
const axle = (x: number, y: number, h: number, yaw: number): Matrix4 => at(x, h, -y, yaw, 1, 0, Math.PI / 2);

class Kit {
  readonly solid = new Mesher();
  readonly light = new Mesher();
  readonly halos: Halo[] = [];
  readonly warm: Glow[] = [];
  readonly cool: Glow[] = [];
  constructor(readonly d: BuildDetail) {}

  /** A box from h0 to h1, hx by hy (world half-extents) round (x, y), turned by yaw. */
  box(x: number, y: number, h0: number, h1: number, hx: number, hy: number, color: number | Paint, yaw = 0, vary = 0.04, m: Mesher = this.solid): void {
    const g = this.d.bevel && m === this.solid ? bevelBox(hx * 2, h1 - h0, hy * 2, Math.min(0.04, Math.min(hx, hy, (h1 - h0) / 2) * 0.25)) : new BoxGeometry(hx * 2, h1 - h0, hy * 2);
    m.add(g, color, W(x, y, (h0 + h1) / 2, yaw), vary);
  }

  /** A plain box (never bevelled: small or hidden parts). */
  plain(x: number, y: number, h0: number, h1: number, hx: number, hy: number, color: number | Paint, yaw = 0, vary = 0.03, m: Mesher = this.solid): void {
    m.add(new BoxGeometry(hx * 2, h1 - h0, hy * 2), color, W(x, y, (h0 + h1) / 2, yaw), vary);
  }

  /** An upright cylinder (or cone, r0 at the bottom, r1 at the top). */
  cyl(x: number, y: number, h0: number, h1: number, r0: number, r1: number, color: number | Paint, seg = this.d.seg, m: Mesher = this.solid, vary = 0.03): void {
    m.add(new CylinderGeometry(r1, r0, h1 - h0, seg), color, W(x, y, (h0 + h1) / 2), vary);
  }

  /** A rod between two world points. */
  rod(ax: number, ay: number, ah: number, bx: number, by: number, bh: number, r: number, color: number, seg = 5, m: Mesher = this.solid): void {
    m.add(new CylinderGeometry(r, r, 1, seg), color, between(ax, ah, -ay, bx, bh, -by, 1), 0.02);
  }

  /** A lamp (lit mesh) and its glow at night. */
  lamp(x: number, y: number, h: number, size: number, color: number, halo: number, glow = C.lampWarm, kind = 0): void {
    this.light.glow(kind);
    this.light.add(new BoxGeometry(size, size, size), color, W(x, y, h), 0);
    this.halos.push({ x, y, z: h, r: halo, color: glow });
  }
}

// ---------- the parts ----------

/** Corrugated cladding: ribs standing proud of a wall running from (ax, ay) to (bx, by), its top following `top(t)` (t 0..1 along it). */
function ribs(k: Kit, ax: number, ay: number, bx: number, by: number, out: number, bottom: number, top: (t: number) => number, color: number, pitch = 0.42): void {
  const len = Math.hypot(bx - ax, by - ay);
  const ux = (bx - ax) / len;
  const uy = (by - ay) / len;
  // The wall's outward normal (to the right of a → b), `out` metres off its face.
  const nx = uy;
  const ny = -ux;
  const yaw = Math.atan2(uy, ux);
  const n = Math.floor(len / pitch);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const h = top(t);
    if (h - bottom < 0.2) continue;
    k.plain(ax + ux * len * t + nx * out, ay + uy * len * t + ny * out, bottom, h, 0.05, 0.035, color, yaw, 0.02);
  }
}

function hangar(k: Kit): void {
  const h = HANGAR;
  const [x0, x1, y0, y1] = [h.x - h.hx, h.x + h.hx, h.y - h.hy, h.y + h.hy];
  const t = h.wall;
  const doorTop = 4.1;
  const wall = C.cream;
  const inner = 0xe9e3d6;
  // A concrete plinth, then the walls: the back (west), the two gable ends, and the front either side of the door.
  k.solid.glow(0);
  k.box(x0 + t / 2, h.y, 0, 0.45, t / 2 + 0.04, h.hy, C.concreteDark);
  k.box(h.x, y1 - t / 2, 0, 0.45, h.hx, t / 2 + 0.04, C.concreteDark);
  k.box(h.x, y0 + t / 2, 0, 0.45, h.hx, t / 2 + 0.04, C.concreteDark);
  k.box(x0 + t / 2, h.y, 0.45, h.eaves, t / 2, h.hy, wall);
  const jamb = (h.hy - h.door) / 2;
  for (const s of [-1, 1]) {
    k.box(x1 - t / 2, h.y + s * (h.door + jamb), 0, h.eaves, t / 2, jamb, wall);
    // The gable ends: a wall to the eaves and a triangle to the ridge.
    const ye = s > 0 ? y1 - t / 2 : y0 + t / 2;
    k.box(h.x, ye, 0.45, h.eaves, h.hx, t / 2, wall);
    gableTriangle(k.solid, h.x, ye, h.hx, h.eaves, h.ridge, t, wall);
  }
  // The header over the door, and the door's frame (orange).
  k.box(x1 - t / 2, h.y, doorTop, h.eaves, t / 2, h.door, wall);
  k.box(x1 + 0.02, h.y, doorTop - 0.2, doorTop, 0.12, h.door + 0.1, C.orange);
  for (const s of [-1, 1]) k.box(x1 + 0.02, h.y + s * (h.door + 0.08), 0, doorTop, 0.12, 0.1, C.orange);
  // The sliding doors, stacked open in front of the jambs: two leaves each side, on a rail.
  for (const s of [-1, 1]) {
    for (const [dx, dy] of [[0.18, 0], [0.36, 0.25]] as const) {
      const yc = h.y + s * (h.hy - 1.1 + dy);
      k.box(x1 + dx, yc, 0.05, doorTop - 0.05, 0.06, 1.15, (_x, y) => (Math.round(y * 3.2) % 2 ? C.creamShade : C.cream), 0, 0.02);
      k.plain(x1 + dx + 0.07, yc, 1.9, 2.1, 0.02, 1.05, C.orange);
    }
  }
  k.plain(x1 + 0.3, h.y, doorTop + 0.02, doorTop + 0.14, 0.18, h.hy, C.steelDark);
  k.plain(x1 + 0.3, h.y, PAVE, PAVE + 0.03, 0.12, h.hy + 0.3, C.steelDark);
  // Corrugation on the outside of every wall.
  if (k.d.ribs) {
    const slope = (x: number) => h.eaves + ((h.ridge - h.eaves) * (1 - Math.abs(x - h.x) / h.hx));
    ribs(k, x0, y1, x0, y0, 0.03, 0.45, () => h.eaves, C.creamShade);
    ribs(k, x0, y0, x1, y0, 0.03, 0.45, (u) => slope(x0 + (x1 - x0) * u) - 0.05, C.creamShade);
    ribs(k, x1, y1, x0, y1, 0.03, 0.45, (u) => slope(x1 - (x1 - x0) * u) - 0.05, C.creamShade);
    for (const s of [-1, 1]) {
      const ya = s > 0 ? y1 : h.y + h.door;
      const yb = s > 0 ? h.y + h.door : y0;
      ribs(k, x1, ya, x1, yb, 0.03, 0.45, () => h.eaves, C.creamShade);
    }
  }
  // The roof: two pitched sheets with an overhang, seams down them, a ridge cap and gutters.
  const over = 0.45;
  const run = h.hx + over;
  const rise = (h.ridge - h.eaves) * (run / h.hx);
  const pitch = Math.atan2(h.ridge - h.eaves, h.hx);
  const slant = Math.hypot(run, rise);
  for (const s of [-1, 1]) {
    const cx = h.x + (s * run) / 2;
    const ch = h.ridge - rise / 2 + 0.06;
    k.solid.add(new BoxGeometry(slant, 0.1, (h.hy + over) * 2), C.roof, W(cx, h.y, ch, 0, 1, 0, s * -pitch), 0.03);
    if (k.d.ribs) {
      for (let y = y0 - over + 0.6; y < y1 + over - 0.3; y += 0.62) {
        k.solid.add(new BoxGeometry(slant, 0.05, 0.07), C.roofDark, W(cx, y, ch + 0.07, 0, 1, 0, s * -pitch), 0.02);
      }
    }
    // A gutter along the eaves.
    k.plain(h.x + s * (run + 0.06), h.y, h.ridge - rise - 0.12, h.ridge - rise + 0.02, 0.1, h.hy + over, C.orange);
  }
  k.plain(h.x, h.y, h.ridge + 0.04, h.ridge + 0.2, 0.22, h.hy + over + 0.02, C.roofDark);
  // Skylights along both slopes (glass).
  k.light.glow(1);
  for (const s of [-1, 1]) {
    for (const y of [-5, 0, 5]) {
      k.light.add(new BoxGeometry(1.1, 0.06, 1.6), C.glassDay, W(h.x + s * run * 0.45, h.y + y, h.ridge - rise * 0.45 + 0.14, 0, 1, 0, s * -pitch), 0);
    }
  }
  // Inside: lighter walls, lit at night.
  k.solid.glow(0.55);
  k.plain(x0 + t + 0.01, h.y, 0.45, h.eaves - 0.05, 0.01, h.hy - t, inner, 0, 0.02);
  for (const s of [-1, 1]) k.plain(h.x, h.y + s * (h.hy - t - 0.01), 0.45, h.eaves - 0.05, h.hx - t, 0.01, inner, 0, 0.02);
  // The floor, sealed grey, a little above the apron's slabs it stands on.
  k.plain(h.x, h.y, PAVE, PAVE + 0.02, h.hx - t, h.hy - t, 0xbfbab0, 0, 0.02);
  // Roof trusses across, and their lamps.
  for (const y of [-6, -2, 2, 6]) {
    const yc = h.y + y;
    k.plain(h.x, yc, h.eaves - 0.25, h.eaves - 0.12, h.hx - t, 0.06, C.steelDark);
    for (const s of [-1, 1]) k.rod(h.x + s * (h.hx - t), yc, h.eaves - 0.15, h.x, yc, h.ridge - 0.2, 0.06, C.steelDark, 4);
    k.rod(h.x, yc, h.eaves - 0.18, h.x, yc, h.ridge - 0.2, 0.05, C.steelDark, 4);
    for (const s of [-1, 1]) k.rod(h.x + s * (h.hx - t) * 0.5, yc, h.eaves - 0.18, h.x, yc, h.ridge - 0.2, 0.04, C.steelDark, 4);
    k.solid.glow(0);
    k.cyl(h.x, yc, h.eaves - 1.05, h.eaves - 0.25, 0.015, 0.015, C.grey, 4);
    k.cyl(h.x, yc, h.eaves - 1.25, h.eaves - 1.05, 0.38, 0.12, C.grey, 8);
    k.solid.glow(0.55);
    k.lamp(h.x, yc, h.eaves - 1.28, 0.32, C.lampWarm, 0.9);
  }
  k.solid.glow(0.55);
  if (k.d.interior) {
    // Along the back wall, from the south: drums, the workbench (a pegboard of tools over it, drawers under it), shelving with boxes.
    for (const [dx, dy, c] of [[0, 0, 0x6f9bc0], [0.62, 0.1, C.grey], [0.3, 0.6, 0x6f9bc0]] as const) {
      k.cyl(x0 + t + 0.45 + dx, y0 + t + 0.5 + dy, 0, 0.9, 0.29, 0.29, c, 10);
      k.cyl(x0 + t + 0.45 + dx, y0 + t + 0.5 + dy, 0.9, 0.92, 0.27, 0.27, C.steelDark, 10);
    }
    const bx = x0 + t + 0.4;
    const by = y0 + 4.2;
    k.box(bx, by, 0, 0.92, 0.38, 1.6, C.wood);
    k.box(bx, by, 0.92, 0.97, 0.42, 1.65, C.woodDark);
    for (const dy of [-1, 0, 1]) k.plain(bx + 0.39, by + dy, 0.25, 0.75, 0.01, 0.42, C.steelDark);
    k.plain(x0 + t + 0.03, by, 1.25, 2.4, 0.02, 1.45, 0xd6b98f);
    for (let i = 0; i < 8; i++) k.plain(x0 + t + 0.07, by - 1.1 + i * 0.32, 1.5 + (i % 3) * 0.28, 1.8 + (i % 3) * 0.28, 0.03, 0.04, i % 2 ? C.red : C.grey);
    k.plain(bx + 0.2, by + 1.2, 0.97, 1.15, 0.12, 0.1, C.grey);
    for (let shelf = 0; shelf < 4; shelf++) {
      const sh = 0.3 + shelf * 0.75;
      k.plain(x0 + t + 0.4, y1 - t - 1.8, sh, sh + 0.04, 0.35, 1.5, C.steelDark);
      for (let i = 0; i < 4; i++) k.plain(x0 + t + 0.4, y1 - t - 2.9 + i * 0.75, sh + 0.04, sh + 0.32 + 0.1 * (i % 2), 0.28, 0.28, i % 2 ? 0xd2b48a : 0xc49f73, 0, 0.06);
    }
    for (const dy of [-1.55, 1.55]) for (const dx of [-0.33, 0.33]) k.plain(x0 + t + 0.4 + dx, y1 - t - 1.8 + dy, 0, 3.05, 0.025, 0.025, C.orange);
    // A second aircraft, its cowling off for maintenance, nose to the door; a tool chest, a stepladder and a parts trolley by its engine.
    k.solid.glow(0.45);
    const a = HANGAR_AIRCRAFT;
    const frame = W(a.x, a.y, 0, Math.PI / 2);
    const inverse = frame.clone().invert();
    const v = new Vector3();
    const plane = aircraftParts({ body: 0x9fc3df, trim: C.cream, accent: C.grey, detail: k.d.seg });
    for (const p of plane.static) {
      if (p.part === "cowling" || p.part === "spinner" || p.part === "prop") continue;
      const paint = p.color;
      // (Its paint is laid out in its own frame.)
      const color: number | Paint = typeof paint === "number" ? paint : (x, y, z) => paint(...(v.set(x, y, z).applyMatrix4(inverse).toArray() as [number, number, number]));
      k.solid.add(p.geometry, color, frame.clone().multiply(p.matrix), p.vary);
    }
    // The engine, bare: a block with its cylinders.
    k.box(a.x + 1.65, a.y, 0.95, 1.65, 0.45, 0.4, C.greyLight);
    for (const s of [-1, 1]) for (const u of [-0.15, 0.2]) k.cyl(a.x + 1.65 + u, a.y + s * 0.52, 1.15, 1.45, 0.11, 0.11, C.steel, 6);
    k.box(a.x + 2.6, a.y - 4.6, 0, 1.25, 0.35, 0.55, C.orange);
    for (let i = 0; i < 4; i++) k.plain(a.x + 2.96, a.y - 4.6, 0.2 + i * 0.27, 0.23 + i * 0.27, 0.01, 0.45, C.grey);
    for (const s of [-1, 1]) k.rod(a.x + 2.4 + s * 0.25, a.y - 2.2, 0, a.x + 2.4 + s * 0.12, a.y - 1.75, 1.7, 0.03, C.orange, 4);
    for (let i = 1; i < 5; i++) k.plain(a.x + 2.4, a.y - 2.2 + i * 0.09, i * 0.34, i * 0.34 + 0.04, 0.2, 0.06, C.steel);
    k.plain(a.x + 2.6, a.y + 2.4, 0.75, 0.82, 0.4, 0.3, C.steelDark);
    k.cyl(a.x + 2.6, a.y + 2.4, 0, 0.75, 0.04, 0.04, C.grey, 5);
  }
  k.solid.glow(0);
  // Floodlight over the door and its pool of light.
  k.lamp(x1 + 0.35, h.y, doorTop + 0.55, 0.3, C.lampWarm, 1.5);
  k.plain(x1 + 0.2, h.y, doorTop + 0.35, doorTop + 0.7, 0.22, 0.3, C.grey);
}

/** A triangular gable wall: across the hangar (x), at y, from the eaves up to the ridge. */
function gableTriangle(m: Mesher, cx: number, y: number, hx: number, eaves: number, ridge: number, t: number, color: number): void {
  const pts: number[] = [];
  for (const s of [-1, 1]) {
    const z = -(y + (s * t) / 2);
    const tri = [cx - hx, eaves, z, cx + hx, eaves, z, cx, ridge, z];
    if (s > 0) pts.push(...tri.slice(0, 3), ...tri.slice(6, 9), ...tri.slice(3, 6));
    else pts.push(...tri);
  }
  // The sloping edges' thickness.
  for (const e of [[cx - hx, eaves, cx, ridge], [cx, ridge, cx + hx, eaves]] as const) {
    const [ax, ah, bx, bh] = e;
    const za = -(y + t / 2);
    const zb = -(y - t / 2);
    pts.push(ax, ah, za, bx, bh, za, bx, bh, zb, ax, ah, za, bx, bh, zb, ax, ah, zb);
  }
  m.triangles(pts, color);
}

function tower(k: Kit): void {
  const T = TOWER;
  const half = T.half;
  // The shaft: rendered cream on a dark plinth, a band of orange under the cab, small windows on two floors.
  k.solid.glow(0);
  k.box(T.x, T.y, 0, 0.5, half + 0.08, half + 0.08, C.concreteDark);
  k.box(T.x, T.y, 0.5, T.cab - 0.4, half, half, C.cream, 0, 0.03);
  k.box(T.x, T.y, T.cab - 0.4, T.cab, half + 0.05, half + 0.05, C.orange);
  for (const floor of [1.9, 4.9]) {
    for (const [nx, ny] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      if (floor < 3 && nx === 1) continue;
      const x = T.x + nx * (half + 0.02);
      const y = T.y + ny * (half + 0.02);
      k.light.glow(1);
      k.plain(x, y, floor, floor + 0.9, nx ? 0.03 : 0.5, ny ? 0.03 : 0.5, C.glassDay, 0, 0, k.light);
      k.plain(x + nx * 0.03, y + ny * 0.03, floor - 0.1, floor - 0.02, nx ? 0.06 : 0.62, ny ? 0.06 : 0.62, C.creamShade);
    }
  }
  // Doors: at the foot (north) and at the stair's landing (east).
  k.plain(T.x, T.y + half + 0.02, 0.5, 2.6, 0.55, 0.04, C.grey);
  k.plain(T.x + half + 0.02, T.y - 1.4, 3.05, 5.1, 0.04, 0.5, C.grey);
  // The stair up the east side: a steel flight rising south to a landing at 3 m, with a handrail.
  const sx = T.x + half + 0.7;
  const steps = 14;
  for (let i = 0; i < steps; i++) {
    const y = T.y + half - 0.25 - i * ((2 * half - 1.5) / steps);
    const top = ((i + 1) / steps) * 3;
    k.plain(sx, y, top - 0.06, top, 0.55, 0.17, C.steelDark);
  }
  k.plain(sx, T.y - half + 0.6, 2.94, 3.02, 0.62, 0.62, C.steelDark);
  for (const [a, b] of [[T.y + half - 0.2, 0], [T.y - half + 0.6, 3]] as const) k.cyl(sx + 0.6, a, 0, b + 1, 0.035, 0.035, C.steel, 5);
  k.rod(sx + 0.6, T.y + half - 0.2, 1, sx + 0.6, T.y - half + 0.6, 4, 0.03, C.steel, 4);
  k.rod(sx - 0.55, T.y + half - 0.2, 0.1, sx - 0.55, T.y - half + 0.6, 2.95, 0.07, C.steelDark, 4);
  k.rod(sx + 0.55, T.y + half - 0.2, 0.1, sx + 0.55, T.y - half + 0.6, 2.95, 0.07, C.steelDark, 4);
  k.cyl(sx + 0.6, T.y - half - 0.02, 0, 4, 0.04, 0.04, C.steel, 5);
  // The cab: a floor slab wider than the shaft, glazing leaning out, mullions, a roof with a railing.
  const cab0 = T.cab;
  const cab1 = T.roof - 0.3;
  const lo = half + 0.45;
  const hi = half + 0.75;
  k.box(T.x, T.y, cab0, cab0 + 0.25, half + 0.85, half + 0.85, C.creamShade);
  k.light.glow(1);
  // Each side's glass: a quad leaning outwards from the sill to the head.
  const glass: number[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    // Two corners at the sill and two at the head, in world (x, y), then to scene.
    const p = (along: number, out: number, h: number): number[] => [T.x + c * out - s * along, h, -(T.y + s * out + c * along)];
    const [b0, b1, h0, h1] = [cab0 + 0.85, cab1, lo, hi];
    glass.push(...p(-h0, h0, b0), ...p(h0, h0, b0), ...p(h1, h1, b1), ...p(-h0, h0, b0), ...p(h1, h1, b1), ...p(-h1, h1, b1));
  }
  k.light.triangles(glass, C.glassDay);
  // The sill under the glass (solid), and mullions at the corners and the middle of each side.
  k.solid.glow(0.5);
  k.box(T.x, T.y, cab0 + 0.25, cab0 + 0.85, lo, lo, C.cream);
  k.solid.glow(0);
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    for (const along of [-1, 0, 1]) {
      const fa = (o: number) => [T.x + c * o - s * along * o, T.y + s * o + c * along * o] as const;
      const [ax, ay] = fa(lo + 0.02);
      const [bx, by] = fa(hi + 0.02);
      k.rod(ax, ay, cab0 + 0.85, bx, by, cab1, 0.05, C.grey, 4);
    }
  }
  // The roof: a slab with a soffit, a railing, two antennas, the beacon's plinth.
  k.box(T.x, T.y, cab1, T.roof, hi + 0.3, hi + 0.3, C.cream);
  k.plain(T.x, T.y, cab1 - 0.06, cab1, hi + 0.25, hi + 0.25, C.creamShade);
  k.plain(T.x, T.y, T.roof, T.roof + 0.06, hi + 0.2, hi + 0.2, 0x9aa2ab);
  const rail = hi + 0.1;
  for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) k.cyl(T.x + x * rail, T.y + y * rail, T.roof, T.roof + 0.9, 0.03, 0.03, C.steel, 4);
  for (const s of [-1, 1]) {
    k.rod(T.x - rail, T.y + s * rail, T.roof + 0.9, T.x + rail, T.y + s * rail, T.roof + 0.9, 0.025, C.steel, 4);
    k.rod(T.x + s * rail, T.y - rail, T.roof + 0.9, T.x + s * rail, T.y + rail, T.roof + 0.9, 0.025, C.steel, 4);
  }
  k.box(T.x, T.y, T.roof, T.beacon - 0.75, 0.28, 0.28, C.grey);
  for (const [dx, dy, h] of [[1.9, 1.7, 3.2], [-1.8, -1.6, 2.4]] as const) {
    k.cyl(T.x + dx, T.y + dy, T.roof, T.roof + h, 0.035, 0.02, C.steel, 4);
    k.plain(T.x + dx, T.y + dy, T.roof + h * 0.7, T.roof + h * 0.7 + 0.04, 0.3, 0.015, C.steel);
    k.lamp(T.x + dx, T.y + dy, T.roof + h + 0.06, 0.1, 0xff6a55, 0.7, 0xff5a46);
  }
  if (k.d.interior) {
    // Consoles round the inside of the glass, their screens glowing.
    k.solid.glow(0.5);
    for (let i = 0; i < 3; i++) {
      const a = (i * Math.PI) / 2 - Math.PI / 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      k.box(T.x + c * (lo - 0.55), T.y + s * (lo - 0.55), cab0 + 0.25, cab0 + 1.1, c ? 0.4 : 1.9, s ? 0.4 : 1.9, C.grey);
      for (const along of [-1, 0, 1]) {
        const x = T.x + c * (lo - 0.7) - s * along * 1.1;
        const y = T.y + s * (lo - 0.7) + c * along * 1.1;
        k.light.glow(0);
        k.plain(x, y, cab0 + 1.15, cab0 + 1.55, c ? 0.03 : 0.35, s ? 0.03 : 0.35, 0x8fd7ff, a, 0, k.light);
      }
    }
    k.solid.glow(0);
  }
  k.warm.push([T.x, (cab0 + cab1) / 2, -T.y, 3.4]);
}

function blockhouse(k: Kit): void {
  const B = BLOCKHOUSE;
  k.solid.glow(0);
  // A bunker with sloping walls: a box tapering to its roof, the roof's edge chamfered.
  const g = new BoxGeometry(B.hx * 2, B.roof, B.hy * 2, 1, 1, 1);
  const p = g.getAttribute("position");
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) p.setXYZ(i, p.getX(i) * 0.88, p.getY(i), p.getZ(i) * 0.84);
  k.solid.add(g, C.concrete, W(B.x, B.y, B.roof / 2), 0.04);
  k.box(B.x, B.y, B.roof, B.roof + 0.18, B.hx * 0.86, B.hy * 0.82, C.concreteDark);
  // Hazard stripes round its foot, a steel door north, the slit window south (towards the pad).
  for (let i = -6; i <= 6; i++) k.plain(B.x + i * 0.62, B.y - B.hy - 0.01, 0, 0.35, 0.16, 0.02, i % 2 ? C.black : C.yellow, 0, 0);
  k.plain(B.x - 1.5, B.y + B.hy - 0.1, 0, 2.1, 0.6, 0.12, C.steelDark);
  k.plain(B.x - 1.5, B.y + B.hy + 0.05, 0.9, 1.1, 0.08, 0.04, C.grey);
  k.light.glow(1);
  k.plain(B.x + 0.4, B.y - B.hy * 0.93 - 0.02, 1.7, 2.05, 2.2, 0.08, 0x86b5c4, 0, 0, k.light);
  k.plain(B.x + 0.4, B.y - B.hy * 0.93 - 0.1, 1.62, 1.7, 2.4, 0.12, C.concreteDark);
  k.cool.push([B.x + 0.4, 1.9, -(B.y - B.hy), 1.4]);
  // A periscope, a vent, cable trays to the pad, an air-conditioning unit.
  k.cyl(B.x - 2.4, B.y, B.roof + 0.18, B.roof + 1.1, 0.12, 0.12, C.grey, 6);
  k.plain(B.x - 2.4, B.y - 0.12, B.roof + 0.9, B.roof + 1.1, 0.1, 0.12, C.grey);
  k.box(B.x + 2.5, B.y + 0.7, B.roof + 0.18, B.roof + 0.6, 0.35, 0.35, C.steel);
  k.box(B.x + B.hx + 0.35, B.y + 0.8, 0, 0.9, 0.3, 0.55, C.steel);
  k.cyl(B.x + B.hx + 0.66, B.y + 0.8, 0.45, 0.47, 0.32, 0.32, C.grey, 10);
  // The dish's pedestal (the dish turns: it's one of the machines).
  k.cyl(B.x, B.y - 0.3, B.roof + 0.18, B.dish - 1.1, 0.42, 0.32, C.steel, 8);
  k.lamp(B.x - 1.5, B.y + B.hy + 0.15, 2.4, 0.18, C.lampWarm, 1, C.lampWarm);
}

function bowser(k: Kit): void {
  const b = BOWSER;
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  const P = (u: number, v: number): [number, number] => [b.x + c * u - s * v, b.y + s * u + c * v];
  k.solid.glow(0);
  // Chassis, cab (east end), tank, hose reel, wheels.
  {
    const [x, y] = P(-0.3, 0);
    k.plain(x, y, 0.45, 0.65, 2.3, 0.55, C.grey, b.yaw);
  }
  {
    const [x, y] = P(1.95, 0);
    k.box(x, y, 0.55, 2.1, 0.7, 1.05, C.cream, b.yaw);
    k.box(x, y, 2.1, 2.3, 0.62, 0.98, C.creamShade, b.yaw);
    k.light.glow(1);
    const [gx, gy] = P(2.66, 0);
    k.plain(gx, gy, 1.35, 1.95, 0.03, 0.85, C.glassDay, b.yaw, 0, k.light);
    for (const v of [-1.06, 1.06]) {
      const [wx, wy] = P(1.95, v);
      k.plain(wx, wy, 1.4, 1.9, 0.5, 0.02, C.glassDay, b.yaw, 0, k.light);
    }
    const [lx, ly] = P(2.68, 0.75);
    k.lamp(lx, ly, 0.85, 0.12, 0xfff3d6, 0.5, 0xfff3d6, 0.5);
    const [rx, ry] = P(2.68, -0.75);
    k.lamp(rx, ry, 0.85, 0.12, 0xfff3d6, 0.5, 0xfff3d6, 0.5);
  }
  {
    const [x, y] = P(-0.75, 0);
    k.solid.add(new CylinderGeometry(0.88, 0.88, 3.3, k.d.seg + 2), (_x, h) => (h > 1.55 && h < 1.75 ? C.white : C.red), W(x, y, 1.48, b.yaw, 1, 0, Math.PI / 2), 0.02);
    for (const u of [-2.4, 0.9]) {
      const [ex, ey] = P(u, 0);
      k.solid.add(new SphereGeometry(0.88, k.d.seg + 2, 4, 0, Math.PI * 2, 0, Math.PI / 2), C.red, W(ex, ey, 1.48, b.yaw, [1, 0.32, 1], 0, u < 0 ? Math.PI / 2 : -Math.PI / 2), 0.02);
    }
    const [hx, hy] = P(-0.75, 0);
    k.plain(hx, hy, 2.3, 2.42, 0.35, 0.3, C.grey, b.yaw);
    for (const v of [-0.95, 0.95]) {
      const [rx, ry] = P(-0.75, v);
      k.rod(rx - 1.5 * c, ry - 1.5 * s, 2.36, rx + 1.5 * c, ry + 1.5 * s, 2.36, 0.03, C.steel, 4);
    }
  }
  {
    const [x, y] = P(-2.55, 0);
    k.plain(x, y, 0.5, 1.55, 0.25, 0.85, C.grey, b.yaw);
    k.solid.add(new CylinderGeometry(0.42, 0.42, 1.2, k.d.seg), C.black, axle(x - c * 0.12, y - s * 0.12, 1.05, b.yaw + Math.PI / 2), 0.02);
  }
  for (const u of [-1.5, 1.85]) {
    for (const v of [-0.95, 0.95]) {
      const [x, y] = P(u, v);
      k.solid.add(new CylinderGeometry(0.42, 0.42, 0.3, k.d.seg + 2), C.tyre, axle(x, y, 0.42, b.yaw + Math.PI / 2), 0.02);
      k.solid.add(new CylinderGeometry(0.2, 0.2, 0.32, 8), C.steel, axle(x, y, 0.42, b.yaw + Math.PI / 2), 0.02);
    }
  }
}

function windsockMast(k: Kit): void {
  const w = WINDSOCK;
  k.solid.glow(0);
  k.cyl(w.x, w.y, 0, 0.25, 0.4, 0.36, C.concreteDark, 8);
  k.cyl(w.x, w.y, 0.25, w.height - 0.3, 0.09, 0.06, (_x, h) => (Math.floor(h / 1.2) % 2 ? C.white : C.orange), 6);
  k.cyl(w.x, w.y, w.height - 0.3, w.height, 0.07, 0.07, C.grey, 6);
  k.lamp(w.x, w.y, w.height + 0.1, 0.12, 0xff6a55, 0.7, 0xff5a46);
  // A floodlight on its pole, for the sock at night.
  k.plain(w.x + 0.15, w.y, w.height - 1.6, w.height - 1.35, 0.15, 0.12, C.grey);
}

function weatherMast(k: Kit): void {
  const m = WEATHER_MAST;
  k.solid.glow(0);
  // A three-legged lattice mast.
  const r = 0.22;
  const legs = [0, 1, 2].map((i) => [m.x + Math.cos((i * 2 * Math.PI) / 3) * r, m.y + Math.sin((i * 2 * Math.PI) / 3) * r] as const);
  for (const [x, y] of legs) k.cyl(x, y, 0, m.height - 0.6, 0.025, 0.025, C.steel, 4);
  if (k.d.ribs) {
    for (let h = 0.4; h < m.height - 0.8; h += 0.8) {
      for (let i = 0; i < 3; i++) {
        const [ax, ay] = legs[i]!;
        const [bx, by] = legs[(i + 1) % 3]!;
        k.rod(ax, ay, h, bx, by, h + 0.8, 0.012, C.steel, 3);
      }
    }
  }
  k.cyl(m.x, m.y, 0, 0.18, 0.45, 0.45, C.concreteDark, 8);
  k.cyl(m.x, m.y, m.height - 0.6, m.height - 0.2, 0.05, 0.05, C.steel, 5);
  // The crossarm (the anemometer and vane turn on its ends), a solar panel, a logger box.
  k.plain(m.x, m.y, m.height - 0.25, m.height - 0.17, 0.75, 0.04, C.steel);
  for (const s of [-1, 1]) k.cyl(m.x + s * 0.72, m.y, m.height - 0.17, m.height + 0.12, 0.025, 0.025, C.steel, 4);
  k.solid.add(new BoxGeometry(0.9, 0.04, 0.6), 0x34508a, W(m.x, m.y - 0.45, 3.1, 0, 1, 0.6), 0.02);
  k.plain(m.x + 0.3, m.y, 1.6, 2.1, 0.12, 0.2, C.cream);
  k.lamp(m.x, m.y, m.height - 0.1, 0.1, 0xff6a55, 0.6, 0xff5a46);
  // The Stevenson screen: a white louvred box on legs.
  const s = STEVENSON;
  for (const [dx, dy] of [[-0.3, -0.25], [0.3, -0.25], [0.3, 0.25], [-0.3, 0.25]] as const) k.plain(s.x + dx, s.y + dy, 0, 1, 0.03, 0.03, C.white);
  k.box(s.x, s.y, 1, 1.65, 0.38, 0.32, C.white);
  for (let i = 0; i < 5; i++) k.plain(s.x, s.y - 0.33, 1.05 + i * 0.12, 1.09 + i * 0.12, 0.36, 0.01, 0xe2ddd2);
  k.solid.add(new ConeGeometry(0.5, 0.18, 4), C.white, W(s.x, s.y, 1.74, Math.PI / 4), 0.02);
  k.cyl(s.x + 1.1, s.y, 0, 0.75, 0.08, 0.08, C.steel, 6);
}

function papi(k: Kit): void {
  k.solid.glow(0);
  for (const p of PAPIS) {
    p.xs.forEach((x, i) => {
      // Two legs, a housing, two lenses facing the approach: the two nearest the runway red, the far two white (on the slope).
      for (const s of [-1, 1]) k.plain(x + s * 0.3, p.y, 0, 0.45, 0.04, 0.04, C.steelDark);
      k.box(x, p.y, 0.45, 0.85, 0.42, 0.32, C.cream);
      const red = i < 2;
      for (const s of [-1, 1]) {
        k.light.glow(0.5);
        k.light.add(new CylinderGeometry(0.11, 0.11, 0.04, 8), red ? 0xff5040 : 0xfff6e8, W(x + s * 0.18, p.y + p.dir * -0.33, 0.66, 0, 1, Math.PI / 2), 0);
      }
      k.halos.push({ x, y: p.y - p.dir * 0.4, z: 0.66, r: 0.9, color: red ? 0xff5a46 : 0xfff3e0 });
    });
  }
}

function runwayLights(k: Kit): void {
  k.solid.glow(0);
  const fitting = (x: number, y: number, top: number, color: number, halo: number, r = 0.75, back?: number) => {
    k.cyl(x, y, 0, top - 0.08, 0.035, 0.03, C.steelDark, 5);
    k.cyl(x, y, 0, 0.06, 0.12, 0.12, C.concreteDark, 6);
    k.light.glow(0.5);
    if (back === undefined) k.light.add(new CylinderGeometry(0.07, 0.09, 0.14, 6), color, W(x, y, top), 0);
    else {
      // Two-faced: one colour towards the approach, the other along the runway.
      k.light.add(new CylinderGeometry(0.08, 0.08, 0.12, 6, 1, false, 0, Math.PI), color, W(x, y, top, back), 0);
      k.light.add(new CylinderGeometry(0.08, 0.08, 0.12, 6, 1, false, Math.PI, Math.PI), 0xff5040, W(x, y, top, back), 0);
    }
    k.halos.push({ x, y, z: top, r, color: halo });
  };
  // Edge lights along both sides (not where the taxiway joins).
  const [y0, y1] = [RUNWAY.y - RUNWAY.hy, RUNWAY.y + RUNWAY.hy];
  for (const s of [-1, 1]) {
    const x = RUNWAY.x + s * (RUNWAY.hx + 0.7);
    const n = Math.round((y1 - y0) / k.d.edgeStep);
    for (let i = 0; i <= n; i++) {
      const y = y0 + ((y1 - y0) * i) / n;
      if (s > 0 && Math.abs(y - TAXIWAY.y) < TAXIWAY.hy + 6.5) continue;
      fitting(x, y, 0.38, 0xfff3d6, 0xfff1d0);
    }
  }
  // Threshold and end lights across each end: green towards the approach, red along the runway.
  for (const [y, out] of [[y0 - 0.7, -1], [y1 + 0.7, 1]] as const) {
    for (let i = 0; i < 7; i++) {
      const x = RUNWAY.x - RUNWAY.hx + 1 + (i * (RUNWAY.hx * 2 - 2)) / 6;
      // (A half cylinder from θ 0 to π faces scene +x, east, before it's turned: turned by a world yaw, it faces that way.)
      fitting(x, y, 0.32, 0x7dffa0, 0x7dff9a, 0.75, out > 0 ? Math.PI / 2 : -Math.PI / 2);
    }
  }
  // Taxiway edge lights, blue.
  for (const s of [-1, 1]) {
    for (let x = RUNWAY.x + RUNWAY.hx + 7; x < TAXIWAY.x + TAXIWAY.hx - 1; x += k.d.edgeStep * 0.6) fitting(x, TAXIWAY.y + s * (TAXIWAY.hy + 0.6), 0.3, 0x7fb4ff, 0x6fa8ff, 0.6);
  }
}

function fences(k: Kit): void {
  k.solid.glow(0);
  const step = k.d.fenceStep;
  for (const f of FENCES) {
    const len = Math.hypot(f.bx - f.ax, f.by - f.ay);
    const n = Math.max(1, Math.round(len / step));
    const yaw = Math.atan2(f.by - f.ay, f.bx - f.ax);
    for (let i = 0; i <= n; i++) {
      const x = f.ax + ((f.bx - f.ax) * i) / n;
      const y = f.ay + ((f.by - f.ay) * i) / n;
      k.box(x, y, 0, 1.2, 0.06, 0.06, C.weathered, yaw, 0.08);
      k.plain(x, y, 1.2, 1.25, 0.075, 0.075, C.woodDark, yaw);
    }
    for (const h of [0.55, 1.05]) {
      k.solid.add(new BoxGeometry(len, 0.1, 0.04), C.weathered, W((f.ax + f.bx) / 2, (f.ay + f.by) / 2, h, yaw), 0.06);
    }
  }
  // Low marker boards along the open stretches of the rim, orange and white.
  for (const m of RIM_MARKERS) {
    k.plain(m.x, m.y, 0, 0.5, 0.04, 0.04, C.grey);
    k.box(m.x, m.y, 0.25, 0.55, 0.03, 0.45, (_x, h) => (h > 0.4 ? C.orange : C.white));
  }
  // Boundary cones along the north and west edges (the plateau runs on there).
  const cone = (x: number, y: number) => {
    k.solid.add(new ConeGeometry(0.3, 0.6, 6), (_x, h) => (h > 0.25 && h < 0.4 ? C.white : C.orange), W(x, y, 0.3), 0.02);
    k.plain(x, y, 0, 0.04, 0.32, 0.32, C.orange);
  };
  for (let x = FIELD.x - FIELD.hx + 6; x < FIELD.x + FIELD.hx - 30; x += 18) cone(x, FIELD.y + FIELD.hy + 2.2);
  for (let y = FIELD.y - FIELD.hy + 4; y < FIELD.y + FIELD.hy; y += 18) cone(FIELD.x - FIELD.hx - 2.2, y);
}

function gate(k: Kit): void {
  k.solid.glow(0);
  const x = ENTRANCE_POSTS.x;
  for (const s of [-1, 1]) {
    const y = FIELD_GATE.y + s * ENTRANCE_POSTS.half;
    k.box(x, y, 0, 2.7, 0.32, 0.32, C.cream);
    k.box(x, y, 2.7, 2.9, 0.4, 0.4, C.orange);
    k.cyl(x, y, 2.9, 3.05, 0.1, 0.1, C.grey, 6);
    k.lamp(x, y, 3.2, 0.26, C.lampWarm, 1.3);
    k.plain(x, y, 3.05, 3.08, 0.2, 0.2, C.grey);
  }
  // The barrier's housing on the south post's inner side (its arm is one of the machines).
  k.box(x - 0.75, FIELD_GATE.y - ENTRANCE_POSTS.half + 0.25, 0, 1.05, 0.25, 0.25, C.orange);
  k.box(x - 0.75, FIELD_GATE.y + ENTRANCE_POSTS.half - 0.3, 0, 0.95, 0.06, 0.06, C.steel);
  k.plain(x - 0.75, FIELD_GATE.y + ENTRANCE_POSTS.half - 0.3, 0.92, 0.97, 0.16, 0.06, C.steel);
  // The sign: two posts, a board facing the road from the keep, its name in letters.
  const g = SIGN;
  for (const s of [-1, 1]) k.box(g.x, g.y + s * (g.half - 0.3), 0, g.top, 0.1, 0.1, C.woodDark);
  k.box(g.x, g.y, g.top - 1.75, g.top - 0.05, 0.08, g.half, C.cream);
  k.box(g.x + 0.02, g.y, g.top - 1.85, g.top - 1.73, 0.1, g.half + 0.05, C.orange);
  k.box(g.x + 0.02, g.y, g.top - 0.07, g.top + 0.05, 0.1, g.half + 0.05, C.orange);
  if (k.d.lettering) {
    lettering(k, "PROVING", g.x + 0.09, g.y, g.top - 0.42, 0.105);
    lettering(k, "GROUND", g.x + 0.09, g.y, g.top - 1.27, 0.105);
  }
  k.lamp(g.x + 0.6, g.y, g.top + 0.25, 0.15, C.lampWarm, 1);
  k.plain(g.x + 0.35, g.y, g.top + 0.05, g.top + 0.1, 0.28, 0.04, C.grey);
}

/** A 5 × 7 pixel font, just the letters the sign needs. */
const FONT: Record<string, string[]> = {
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
};

/** Words in raised pixel letters on a board facing east (+x), centred on (x, y), their middle at height h. */
function lettering(k: Kit, word: string, x: number, y: number, h: number, px: number): void {
  const cols = word.length * 6 - 1;
  // Read from the east, the letters run south to north... no: facing east, a reader's right is south.
  for (let i = 0; i < word.length; i++) {
    const glyph = FONT[word[i]!]!;
    for (let row = 0; row < 7; row++) {
      const line = glyph[row]!;
      let c = 0;
      while (c < 5) {
        if (line[c] !== "1") {
          c++;
          continue;
        }
        let e = c;
        while (e < 5 && line[e] === "1") e++;
        const col0 = i * 6 + c;
        const col1 = i * 6 + e;
        // Columns run from the reader's left (north) to right (south).
        const ya = y + (cols / 2 - col0) * px;
        const yb = y + (cols / 2 - col1) * px;
        const hz = h + (3 - row) * px;
        k.plain(x, (ya + yb) / 2, hz - px / 2, hz + px / 2, 0.02, Math.abs(ya - yb) / 2, C.grey, 0, 0);
        c = e;
      }
    }
  }
}

function launchComplex(k: Kit): void {
  k.solid.glow(0);
  // The flame deflector: a curved steel scoop facing north, on a concrete block.
  const d = FLAME_DEFLECTOR;
  k.box(d.x, d.y, 0, 0.5, d.hx, d.hy, C.concreteDark);
  const n = 6;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * (Math.PI / 2);
    const b = ((i + 1) / n) * (Math.PI / 2);
    const r = d.top - 0.5;
    const [ya, ha] = [d.y + d.hy - r * (1 - Math.cos(a)) * 1.2, 0.5 + r * Math.sin(a)];
    const [yb, hb] = [d.y + d.hy - r * (1 - Math.cos(b)) * 1.2, 0.5 + r * Math.sin(b)];
    // (A unit-long plate: between() stretches it to the segment.)
    k.solid.add(new BoxGeometry(d.hx * 2 - 0.2, 0.08, 1.04), 0x8a8580, between(d.x, ha, -ya, d.x, hb, -yb).multiply(at(0, 0, 0, 0, 1, Math.PI / 2)), 0.05);
  }
  k.box(d.x, d.y - d.hy + 0.15, 0.5, d.top, d.hx, 0.15, C.concreteDark);
  for (const s of [-1, 1]) k.box(d.x + s * (d.hx - 0.1), d.y, 0.5, d.top, 0.1, d.hy, C.concreteDark);
  // The lightning masts: lattice towers banded red and white, a red light on top, and the wire between them.
  for (const m of LIGHTNING_MASTS) {
    const r = 0.32;
    k.cyl(m.x, m.y, 0, 0.3, 0.7, 0.6, C.concreteDark, 8);
    const legs = [0, 1, 2, 3].map((i) => [m.x + Math.cos(i * (Math.PI / 2) + Math.PI / 4) * r, m.y + Math.sin(i * (Math.PI / 2) + Math.PI / 4) * r] as const);
    const band = (h: number) => (Math.floor(h / 2.4) % 2 ? C.white : C.red);
    for (const [x, y] of legs) k.rod(x, y, 0.3, m.x + (x - m.x) * 0.4, m.y + (y - m.y) * 0.4, LIGHTNING_MAST_HEIGHT, 0.035, C.red, 4);
    for (let h = 1.2; h < LIGHTNING_MAST_HEIGHT - 1; h += k.d.ribs ? 1.2 : 2.4) {
      const f = 1 - 0.6 * (h / LIGHTNING_MAST_HEIGHT);
      for (let i = 0; i < 4; i++) {
        const [ax, ay] = legs[i]!;
        const [bx, by] = legs[(i + 1) % 4]!;
        k.rod(m.x + (ax - m.x) * f, m.y + (ay - m.y) * f, h, m.x + (bx - m.x) * f, m.y + (by - m.y) * f, h, 0.02, band(h), 3);
      }
    }
    k.cyl(m.x, m.y, LIGHTNING_MAST_HEIGHT, LIGHTNING_MAST_HEIGHT + 1.6, 0.04, 0.015, C.steel, 4);
    k.lamp(m.x, m.y, LIGHTNING_MAST_HEIGHT + 0.1, 0.16, 0xff6a55, 0.9, 0xff5a46);
  }
  const [a, b] = LIGHTNING_MASTS;
  const sag = 2.2;
  const segs = 10;
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs;
    const t1 = (i + 1) / segs;
    const h = (t: number) => LIGHTNING_MAST_HEIGHT + 1.4 - sag * 4 * t * (1 - t);
    k.rod(a.x + (b.x - a.x) * t0, a.y, h(t0), a.x + (b.x - a.x) * t1, a.y, h(t1), 0.012, C.grey, 3);
  }
}

function course(k: Kit): void {
  k.solid.glow(0);
  const base = TRACK_TOP;
  for (const o of OBSTACLES) {
    if (o.kind === "bump") {
      // A round-topped hump across the track: concrete for the washboard, logs (bark, pale ends) for the rest.
      const log = o.r > 0.3 && o.h > 0.2;
      const geom = log ? new CylinderGeometry(o.r, o.r, o.to - o.from, k.d.seg + 2) : hump(o.r, o.h, o.to - o.from, 6);
      const mid = (o.from + o.to) / 2;
      const c = Math.cos(o.heading);
      const s = Math.sin(o.heading);
      // (Across the track is the heading's left.)
      const x = o.x - s * mid;
      const y = o.y + c * mid;
      if (log) {
        // (A cylinder stands along y: laid along z first, then turned to the heading, it lies across the track.)
        k.solid.add(geom, C.bark, W(x, y, base + o.h - o.r, o.heading).multiply(at(0, 0, 0, 0, 1, Math.PI / 2)), 0.08);
        for (const e of [o.from, o.to]) k.solid.add(new CylinderGeometry(o.r * 0.96, o.r * 0.96, 0.02, k.d.seg + 2), 0xe0c49a, W(o.x - s * e, o.y + c * e, base + o.h - o.r, o.heading).multiply(at(0, 0, 0, 0, 1, Math.PI / 2)), 0);
      } else k.solid.add(geom, C.concrete, W(x, y, base, o.heading), 0.05);
    } else if (o.kind === "rock") {
      const g = lumpy(new SphereGeometry(1, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2), o.x * 7 + o.y, 0.04);
      // (Pressed down a touch so the lumps never stand above where the wheels ride.)
      k.solid.add(g, shade(C.stone, 0.92 + 0.12 * Math.abs(Math.sin(o.x * 3.1 + o.y))), W(o.x, o.y, base - 0.01, o.yaw, [o.rx, o.h * 0.96, o.ry]), 0.1);
    } else if (o.kind === "sand") {
      // Rippled sand in its frame.
      const nx = Math.round(o.hx * 4);
      const ny = Math.round(o.hy * 4);
      const pts: number[] = [];
      const P = (i: number, j: number): number[] => {
        const x = o.x - o.hx + (2 * o.hx * i) / nx;
        const y = o.y - o.hy + (2 * o.hy * j) / ny;
        return [x, base + sandSurface(x, y), -y];
      };
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) pts.push(...P(i, j), ...P(i + 1, j), ...P(i + 1, j + 1), ...P(i, j), ...P(i + 1, j + 1), ...P(i, j + 1));
      k.solid.triangles(pts, C.sand);
      for (const s of [-1, 1]) k.box(o.x, o.y + s * (o.hy + 0.1), base, base + 0.18, o.hx + 0.3, 0.1, C.wood);
    } else {
      // The bridge: earth ramps up and down, a plank deck on trestles between them, kerbs along it.
      const B = BRIDGE;
      const c = Math.cos(o.heading);
      const s = Math.sin(o.heading);
      const P = (u: number, v: number): [number, number] => [o.x + c * u - s * v, o.y + s * u + c * v];
      const ramp = (u0: number, u1: number, h0: number, h1: number) => {
        const pts: number[] = [];
        const corner = (u: number, v: number, h: number) => {
          const [x, y] = P(u, v);
          return [x, base + h, -y];
        };
        const [a0, a1, b0, b1] = [corner(u0, o.half, h0), corner(u1, o.half, h1), corner(u0, -o.half, h0), corner(u1, -o.half, h1)];
        // The slope, then each side down to the ground (the facing direction is fixed by the winding).
        pts.push(...b0, ...b1, ...a1, ...b0, ...a1, ...a0);
        const [g0, g1, f0, f1] = [corner(u0, o.half, 0), corner(u1, o.half, 0), corner(u0, -o.half, 0), corner(u1, -o.half, 0)];
        pts.push(...g0, ...a0, ...a1, ...g0, ...a1, ...g1);
        pts.push(...f0, ...f1, ...b1, ...f0, ...b1, ...b0);
        k.solid.triangles(pts, C.earth);
      };
      ramp(0, B.up, 0, B.height);
      ramp(B.up + B.deck, B.up + B.deck + B.down, B.height, 0);
      // Timber faces where the ramps meet the deck.
      for (const u of [B.up, B.up + B.deck]) {
        const [x, y] = P(u, 0);
        k.plain(x, y, base, base + B.height, 0.06, o.half, C.woodDark, o.heading);
      }
      const planks = Math.round(B.deck / 0.32);
      for (let i = 0; i < planks; i++) {
        const u = B.up + ((i + 0.5) * B.deck) / planks;
        const [x, y] = P(u, 0);
        k.box(x, y, base + B.height - 0.06, base + B.height, (B.deck / planks) * 0.46, o.half + 0.05, i % 3 === 1 ? C.wood : 0xc8915e, o.heading, 0.05);
      }
      for (const v of [-1, 1]) {
        const [x, y] = P(B.up + B.deck / 2, v * (o.half + 0.12));
        k.box(x, y, base + B.height - 0.1, base + B.height + 0.16, B.deck / 2 + 0.1, 0.08, C.woodDark, o.heading);
        for (const u of [B.up + 0.3, B.up + B.deck / 2, B.up + B.deck - 0.3]) {
          const [tx, ty] = P(u, v * (o.half - 0.15));
          k.plain(tx, ty, base, base + B.height - 0.06, 0.09, 0.09, C.woodDark, o.heading);
          const [bx2, by2] = P(u, 0);
          k.plain(bx2, by2, base + B.height - 0.3, base + B.height - 0.06, 0.09, o.half - 0.1, C.woodDark, o.heading);
        }
      }
    }
  }
  // The sand pit's sills (the bumps either end) are timbers, drawn by the bump case above as concrete humps: give them wood.
  // The slalom poles, striped.
  for (const p of SLALOM_POLES) {
    k.cyl(p.x, p.y, base, base + 0.08, 0.3, 0.28, C.tyre, 8);
    k.cyl(p.x, p.y, base + 0.08, base + 1.6, 0.05, 0.05, (_x, h) => (Math.floor(h / 0.3) % 2 ? C.white : C.orange), 6);
  }
  // The start gate: two posts, a beam with a chequered banner, a timing light; the charging post.
  const g = START_GATE;
  for (const s of [-1, 1]) {
    k.box(g.x, g.y + s * g.half, 0, g.height, 0.12, 0.12, C.grey);
    k.plain(g.x, g.y + s * g.half, 0, 0.1, 0.3, 0.3, C.grey);
  }
  k.box(g.x, g.y, g.height - 0.5, g.height, 0.08, g.half + 0.15, (_x, h, z) => ((Math.floor(-z / 0.25) + Math.floor(h / 0.25)) % 2 ? C.black : C.white), 0, 0);
  k.light.glow(0);
  k.plain(g.x + 0.12, g.y + 0.9, g.height - 0.42, g.height - 0.08, 0.03, 0.12, 0x9dffb4, 0, 0, k.light);
  k.cool.push([g.x + 0.15, g.height - 0.25, -(g.y + 0.9), 0.7]);
  const cp = { x: g.x - 2.2, y: g.y - g.half - 1.3 };
  k.box(cp.x, cp.y, 0, 1.3, 0.2, 0.15, C.cream);
  k.plain(cp.x, cp.y, 1.3, 1.36, 0.24, 0.19, C.orange);
  k.lamp(cp.x + 0.21, cp.y, 1.05, 0.08, 0x8fe2ff, 0.5, 0x8fe2ff);
  // Stacked tyres at the course's corners.
  if (k.d.props) {
    for (const [x, y] of [[-113.3, 15.3], [-113.3, 40.8], [-141.2, 40.8], [-141.2, 15.3]] as const) {
      for (let i = 0; i < 3; i++) k.solid.add(new TorusGeometry(0.34, 0.14, 4, k.d.seg + 2), C.tyre, W(x, y, 0.14 + i * 0.27, 0, 1, Math.PI / 2), 0.05);
    }
  }
}

/** The part of a cylinder of radius r standing h proud of the ground, `length` long across: a hump's cross-section extruded. */
function hump(r: number, h: number, length: number, n: number): BufferGeometry {
  const reach = Math.sqrt(r * r - (r - h) * (r - h));
  const prof: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const u = -reach + (2 * reach * i) / n;
    prof.push([u, Math.max(0, Math.sqrt(r * r - u * u) - (r - h))]);
  }
  const pts: number[] = [];
  const v0 = -length / 2;
  const v1 = length / 2;
  // Local frame: u along scene x (the track's way, after the heading turn), v along scene z (across).
  for (let i = 0; i < n; i++) {
    const [ua, ha] = prof[i]!;
    const [ub, hb] = prof[i + 1]!;
    pts.push(ua, ha, v1, ub, hb, v1, ub, hb, v0, ua, ha, v1, ub, hb, v0, ua, ha, v0);
    // The ends.
    pts.push(ua, ha, v0, ub, hb, v0, ub, 0, v0, ua, ha, v0, ub, 0, v0, ua, 0, v0);
    pts.push(ub, hb, v1, ua, ha, v1, ua, 0, v1, ub, hb, v1, ua, 0, v1, ub, 0, v1);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pts), 3));
  return g;
}

function droneCorner(k: Kit): void {
  k.solid.glow(0);
  const p = DRONE_PAD;
  k.box(p.x, p.y, 0, 0.14, p.half, p.half, C.grey);
  // An H, and an orange border.
  for (const s of [-1, 1]) {
    k.plain(p.x + s * 0.42, p.y, 0.14, 0.152, 0.07, 0.48, C.white, 0, 0);
    k.plain(p.x, p.y + s * (p.half - 0.06), 0.14, 0.152, p.half - 0.02, 0.05, C.orange, 0, 0);
    k.plain(p.x + s * (p.half - 0.06), p.y, 0.14, 0.152, 0.05, p.half - 0.12, C.orange, 0, 0);
  }
  k.plain(p.x, p.y, 0.14, 0.152, 0.35, 0.06, C.white, 0, 0);
  // Its charging post, with a status light.
  const cx = p.x + p.half + 0.5;
  k.box(cx, p.y, 0, 1.4, 0.16, 0.2, C.cream);
  k.plain(cx, p.y, 1.4, 1.46, 0.2, 0.24, C.orange);
  k.lamp(cx - 0.17, p.y, 1.15, 0.08, 0x8fe2ff, 0.5, 0x8fe2ff);
  k.rod(cx - 0.16, p.y + 0.1, 0.7, p.x + p.half - 0.1, p.y + 0.3, 0.16, 0.025, C.black, 4);
  // The gates: hoops banded orange and white on two posts each.
  for (const g of DRONE_GATES) {
    const r = DRONE_GATE_RADIUS;
    const hoop = new TorusGeometry(r, 0.09, 5, k.d.seg * 2 + 4);
    // A torus lies in its local xy plane: stand it up, its axis along the way through.
    const across = (x: number, z: number) => (x - g.x) * -Math.sin(g.heading) + (-z - g.y) * Math.cos(g.heading);
    k.solid.add(hoop, (x, h, z) => (Math.floor((Math.atan2(h - g.z, across(x, z)) + Math.PI) / (Math.PI / 6)) % 2 ? C.orange : C.white), W(g.x, g.y, g.z, g.heading + Math.PI / 2), 0.02);
    const sx = Math.cos(g.heading + Math.PI / 2) * (r + 0.2);
    const sy = Math.sin(g.heading + Math.PI / 2) * (r + 0.2);
    for (const s of [-1, 1]) {
      k.cyl(g.x + s * sx, g.y + s * sy, 0, g.z + 0.1, 0.06, 0.06, C.steelDark, 6);
      k.plain(g.x + s * sx, g.y + s * sy, 0, 0.06, 0.25, 0.25, C.grey);
      k.rod(g.x + s * sx, g.y + s * sy, g.z, g.x + s * sx * (r / (r + 0.2)), g.y + s * sy * (r / (r + 0.2)), g.z, 0.04, C.steelDark, 4);
    }
  }
}

function apronThings(k: Kit): void {
  k.solid.glow(0);
  // Floodlight masts.
  for (const f of FLOODLIGHTS) {
    k.cyl(f.x, f.y, 0, 0.3, 0.35, 0.32, C.concreteDark, 8);
    k.cyl(f.x, f.y, 0.3, f.height, 0.12, 0.08, C.steel, 6);
    const c = Math.cos(f.aim);
    const s = Math.sin(f.aim);
    k.plain(f.x, f.y, f.height - 0.05, f.height + 0.05, 0.8, 0.06, C.steelDark, f.aim + Math.PI / 2);
    for (const off of [-0.55, 0, 0.55]) {
      const x = f.x - s * off + c * 0.15;
      const y = f.y + c * off + s * 0.15;
      k.plain(x, y, f.height - 0.3, f.height + 0.05, 0.2, 0.16, C.grey, f.aim);
      k.lamp(x + c * 0.18, y + s * 0.18, f.height - 0.13, 0.22, C.lampWarm, 1.6);
    }
  }
  if (!k.d.props) return;
  // Chocks at the tie-downs, and their anchors.
  for (const t of TIE_DOWNS) {
    const c = Math.cos(t.heading);
    const s = Math.sin(t.heading);
    for (const v of [-2.6, 2.6]) {
      k.plain(t.x - s * v, t.y + c * v, PAVE, PAVE + 0.1, 0.12, 0.12, C.grey);
      k.cyl(t.x - s * v, t.y + c * v, PAVE + 0.1, PAVE + 0.16, 0.06, 0.06, C.steel, 5);
    }
  }
  for (const p of PROPS) {
    if (p.kind === "tug") {
      // A tow tractor: a low body, a seat, a bar.
      k.box(p.x, p.y, 0.25, 0.85, 1.1, 0.65, C.orange, p.yaw);
      k.box(p.x - Math.cos(p.yaw) * 0.4, p.y - Math.sin(p.yaw) * 0.4, 0.85, 1.35, 0.25, 0.3, C.grey, p.yaw);
      for (const u of [-0.7, 0.7]) for (const v of [-0.7, 0.7]) k.solid.add(new CylinderGeometry(0.28, 0.28, 0.22, k.d.seg), C.tyre, axle(p.x + Math.cos(p.yaw) * u - Math.sin(p.yaw) * v, p.y + Math.sin(p.yaw) * u + Math.cos(p.yaw) * v, 0.28, p.yaw + Math.PI / 2), 0.02);
      k.rod(p.x + Math.cos(p.yaw) * 1.1, p.y + Math.sin(p.yaw) * 1.1, 0.4, p.x + Math.cos(p.yaw) * 2.4, p.y + Math.sin(p.yaw) * 2.4, 0.3, 0.04, C.grey, 4);
    } else if (p.kind === "extinguisher") {
      k.cyl(p.x, p.y, 0.3, 1.15, 0.2, 0.2, C.red, 8);
      k.cyl(p.x, p.y, 1.15, 1.3, 0.2, 0.08, C.red, 8);
      k.plain(p.x, p.y, 0.15, 0.3, 0.3, 0.25, C.grey, p.yaw);
      for (const s of [-1, 1]) k.solid.add(new CylinderGeometry(0.15, 0.15, 0.08, 8), C.tyre, axle(p.x + Math.cos(p.yaw + Math.PI / 2) * 0.3 * s, p.y + Math.sin(p.yaw + Math.PI / 2) * 0.3 * s, 0.15, p.yaw + Math.PI / 2), 0.02);
    } else if (p.kind === "bench") {
      const c = Math.cos(p.yaw);
      const s = Math.sin(p.yaw);
      k.box(p.x, p.y, 0.72, 0.78, 0.9, 0.38, C.wood, p.yaw);
      for (const v of [-0.62, 0.62]) {
        k.box(p.x - s * v, p.y + c * v, 0.42, 0.47, 0.9, 0.14, C.wood, p.yaw);
        for (const u of [-0.7, 0.7]) k.plain(p.x + c * u - s * v * 0.6, p.y + s * u + c * v * 0.6, 0, 0.72, 0.04, 0.04, C.woodDark, p.yaw);
      }
    } else if (p.kind === "cones") {
      for (let i = 0; i < 4; i++) {
        const x = p.x + Math.cos(p.yaw) * i * 0.9;
        const y = p.y + Math.sin(p.yaw) * i * 0.9;
        k.solid.add(new ConeGeometry(0.17, 0.5, 6), (_x, h) => (h > 0.22 && h < 0.33 ? C.white : C.orange), W(x, y, PAVE + 0.25), 0.02);
        k.plain(x, y, PAVE, PAVE + 0.03, 0.2, 0.2, C.orange);
      }
    } else if (p.kind === "drums") {
      for (const [dx, dy] of [[0, 0], [0.62, 0.05], [0.3, 0.55]] as const) {
        k.cyl(p.x + dx, p.y + dy, 0, 0.88, 0.29, 0.29, 0x6f9bc0, 10);
        k.cyl(p.x + dx, p.y + dy, 0.88, 0.9, 0.27, 0.27, C.steelDark, 10);
      }
    }
  }
}

/** Grass left long round posts, masts and the fence line. */
function tufts(k: Kit): void {
  const add = (x: number, y: number, s: number) => {
    k.solid.add(new ConeGeometry(0.16 * s, 0.34 * s, 3, 1, true), 0x8fb94a, W(x, y, 0.15 * s, x * 3.1 + y), 0.12);
  };
  const ring = (x: number, y: number, r: number, n: number) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + x;
      add(x + Math.cos(a) * r * (0.9 + 0.3 * Math.sin(i * 7.1)), y + Math.sin(a) * r * (0.9 + 0.3 * Math.cos(i * 3.7)), 0.8 + 0.4 * Math.abs(Math.sin(i * 5.3 + y)));
    }
  };
  for (const f of FENCES) {
    const len = Math.hypot(f.bx - f.ax, f.by - f.ay);
    for (let d = 0.7; d < len; d += 1.3) {
      const t = d / len;
      const j = Math.sin(d * 12.9898) * 0.5;
      add(f.ax + (f.bx - f.ax) * t + j * 0.3, f.ay + (f.by - f.ay) * t - j * 0.3, 0.9 + 0.5 * Math.abs(j));
    }
  }
  for (const p of [WINDSOCK, WEATHER_MAST, ...LIGHTNING_MASTS, ...FLOODLIGHTS]) ring(p.x, p.y, 0.8, 7);
  for (const p of PAPIS) for (const x of p.xs) ring(x, p.y, 0.6, 4);
  ring(TOWER.x - 2.6, TOWER.y + 2.6, 0.5, 5);
}

/** Everything that stands still on the proving ground. */
export function buildStatic(d: BuildDetail): Built {
  const k = new Kit(d);
  hangar(k);
  tower(k);
  blockhouse(k);
  bowser(k);
  windsockMast(k);
  weatherMast(k);
  papi(k);
  runwayLights(k);
  fences(k);
  gate(k);
  launchComplex(k);
  course(k);
  droneCorner(k);
  apronThings(k);
  if (d.props) tufts(k);
  return { solid: k.solid, light: k.light, halos: k.halos, warm: k.warm, cool: k.cool };
}

// ---------- the aircraft's shape (the resident's, the hangar's) ----------

export interface AircraftPart {
  /** Which moving part it belongs to ("body" doesn't move against the airframe). */
  part: "body" | "prop" | "spinner" | "cowling" | "elevator" | "rudder" | "aileronL" | "aileronR" | "flapL" | "flapR" | "wheelL" | "wheelR" | "nose" | "noseWheel";
  geometry: BufferGeometry;
  color: number | Paint;
  /** Where it sits in the aircraft's own frame (scene axes: nose +z, up +y, origin on the ground under the main wheels). */
  matrix: Matrix4;
  vary: number;
  /** Lit at night (navigation and landing lights). */
  glow?: number;
}

/** Where each moving part's hinge is, in the aircraft's frame (nose +z, up +y, left +x). */
export const HINGES = {
  prop: [0, 1.32, 2.28],
  elevator: [0, 1.62, -5.02],
  rudder: [0, 1.75, -5.12],
  aileronL: [0, 2.12, -0.42],
  aileronR: [0, 2.12, -0.42],
  flapL: [0, 2.08, -0.44],
  flapR: [0, 2.08, -0.44],
  wheelL: [1.12, 0.3, 0],
  wheelR: [-1.12, 0.3, 0],
  nose: [0, 0.95, 1.75],
  noseWheel: [0, 0.24, 1.75],
} as const;

/** A closed tube through cross-sections (z along the body; each an ellipse-ish octagon of half-width w, from `lo` to `hi`). */
function loft(sections: readonly (readonly [z: number, w: number, lo: number, hi: number])[], sides: number): BufferGeometry {
  const ring = (s: readonly [number, number, number, number]): [number, number, number][] => {
    const [z, w, lo, hi] = s;
    const out: [number, number, number][] = [];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      // Flatter sides and a rounder top: a light aircraft's cross-section.
      const c = Math.cos(a);
      const sn = Math.sin(a);
      out.push([w * Math.sign(c) * Math.abs(c) ** 0.7, (lo + hi) / 2 + ((hi - lo) / 2) * Math.sign(sn) * Math.abs(sn) ** 0.8, z]);
    }
    return out;
  };
  const rings = sections.map(ring);
  const pts: number[] = [];
  for (let k = 0; k < rings.length - 1; k++) {
    const a = rings[k]!;
    const b = rings[k + 1]!;
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      pts.push(...a[i]!, ...b[j]!, ...b[i]!, ...a[i]!, ...a[j]!, ...b[j]!);
    }
  }
  for (const [rg, flip] of [[rings[0]!, true], [rings[rings.length - 1]!, false]] as const) {
    const cz = rg[0]![2];
    const cy = rg.reduce((s, p) => s + p[1], 0) / sides;
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      if (flip) pts.push(0, cy, cz, ...rg[i]!, ...rg[j]!);
      else pts.push(0, cy, cz, ...rg[j]!, ...rg[i]!);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pts), 3));
  // (Wound one way; flat normals follow the winding, so make sure they face out.)
  return outwardFrom(g, sections);
}

/** Flips any triangle whose normal faces the body's axis (so a loft's facets face out). */
function outwardFrom(g: BufferGeometry, sections: readonly (readonly [number, number, number, number])[]): BufferGeometry {
  const p = g.getAttribute("position") as BufferAttribute;
  const zs = sections.map((s) => s[0]);
  const z0 = Math.min(...zs);
  const z1 = Math.max(...zs);
  const axisY = (z: number): number => {
    // The body's centre line at z, between sections.
    for (let i = 0; i < sections.length - 1; i++) {
      const a = sections[i]!;
      const b = sections[i + 1]!;
      if ((z - a[0]) * (z - b[0]) <= 0) {
        const t = Math.abs(b[0] - a[0]) < 1e-9 ? 0 : (z - a[0]) / (b[0] - a[0]);
        return (a[2] + a[3]) / 2 + (((b[2] + b[3]) / 2 - (a[2] + a[3]) / 2) * t);
      }
    }
    return (sections[0]![2] + sections[0]![3]) / 2;
  };
  for (let i = 0; i < p.count; i += 3) {
    const ax = p.getX(i), ay = p.getY(i), az = p.getZ(i);
    const bx = p.getX(i + 1), by = p.getY(i + 1), bz = p.getZ(i + 1);
    const cx = p.getX(i + 2), cy = p.getY(i + 2), cz = p.getZ(i + 2);
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const mx = (ax + bx + cx) / 3;
    const my = (ay + by + cy) / 3;
    const mz = (az + bz + cz) / 3;
    let ox = mx;
    let oy = my - axisY(mz);
    let oz = 0;
    if (Math.abs(ox) < 1e-6 && Math.abs(oy) < 1e-6) oz = mz - (z0 + z1) / 2;
    if (mz <= z0 + 1e-6) oz = -1;
    if (mz >= z1 - 1e-6) oz = 1;
    if (Math.abs(mz - z0) < 1e-6 || Math.abs(mz - z1) < 1e-6) {
      ox = 0;
      oy = 0;
    }
    if (nx * ox + ny * oy + nz * oz < 0) {
      p.setXYZ(i + 1, cx, cy, cz);
      p.setXYZ(i + 2, bx, by, bz);
    }
  }
  return g;
}

/** A wing panel: a flattened hexagonal section from x0 to x1 (span), chord from zLead to zTrail, thickness t, at height y. */
function panel(x0: number, x1: number, zLead: number, zTrail: number, t: number, y: number): BufferGeometry {
  const chord = zLead - zTrail;
  const prof: [number, number][] = [
    [zLead, 0],
    [zLead - chord * 0.12, t * 0.5],
    [zLead - chord * 0.45, t * 0.55],
    [zTrail, 0.01],
    [zLead - chord * 0.45, -t * 0.35],
    [zLead - chord * 0.12, -t * 0.35],
  ];
  const pts: number[] = [];
  const n = prof.length;
  for (let i = 0; i < n; i++) {
    const [za, ya] = prof[i]!;
    const [zb, yb] = prof[(i + 1) % n]!;
    pts.push(x0, y + ya, za, x1, y + ya, za, x1, y + yb, zb, x0, y + ya, za, x1, y + yb, zb, x0, y + yb, zb);
  }
  for (const [x, flip] of [[x0, true], [x1, false]] as const) {
    for (let i = 1; i < n - 1; i++) {
      const [za, ya] = prof[0]!;
      const [zb, yb] = prof[i]!;
      const [zc, yc] = prof[i + 1]!;
      if (flip) pts.push(x, y + ya, za, x, y + yc, zc, x, y + yb, zb);
      else pts.push(x, y + ya, za, x, y + yb, zb, x, y + yc, zc);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pts), 3));
  return fixWinding(g, (x, yy, z) => [0, yy - y, z - (zLead + zTrail) / 2 + (x - (x0 + x1) / 2) * 0]);
}

/** Flips triangles whose normals point against `outward(centroid)` (rough outward directions are enough). */
function fixWinding(g: BufferGeometry, outward: (x: number, y: number, z: number) => [number, number, number]): BufferGeometry {
  const p = g.getAttribute("position") as BufferAttribute;
  for (let i = 0; i < p.count; i += 3) {
    const a = [p.getX(i), p.getY(i), p.getZ(i)];
    const b = [p.getX(i + 1), p.getY(i + 1), p.getZ(i + 1)];
    const c = [p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2)];
    const u = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
    const v = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
    const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    const m = [(a[0]! + b[0]! + c[0]!) / 3, (a[1]! + b[1]! + c[1]!) / 3, (a[2]! + b[2]! + c[2]!) / 3];
    let o = outward(m[0]!, m[1]!, m[2]!);
    // End caps: outward along the span.
    if (Math.abs(n[0]!) > Math.abs(n[1]!) + Math.abs(n[2]!)) o = [m[0]! - 0, 0, 0];
    if (n[0]! * o[0] + n[1]! * o[1] + n[2]! * o[2] < 0) {
      p.setXYZ(i + 1, c[0]!, c[1]!, c[2]!);
      p.setXYZ(i + 2, b[0]!, b[1]!, b[2]!);
    }
  }
  return g;
}

/**
 * A high-wing bush plane, tricycle undercarriage, our own design: cream with orange (or another livery). Parts
 * in its own frame (nose +z, up +y, left +x, the ground under its main wheels at the origin), each tagged with
 * the moving part it belongs to; `static` is everything, posed at rest.
 */
export function aircraftParts(livery: { body: number; trim: number; accent: number; detail: number }): { static: AircraftPart[] } {
  const seg = livery.detail;
  const out: AircraftPart[] = [];
  const add = (part: AircraftPart["part"], geometry: BufferGeometry, color: number | Paint, matrix: Matrix4 = at(0, 0, 0), vary = 0.03, glow?: number) =>
    out.push({ part, geometry, color, matrix, vary, ...(glow === undefined ? {} : { glow }) });
  const { body, trim, accent } = livery;
  const windows = 0x3d5266;
  // The fuselage: lofted through sections from the firewall to the tail; a stripe along it.
  const fuselage = loft(
    [
      [1.12, 0.52, 0.78, 1.95],
      [0.55, 0.58, 0.74, 2.12],
      [-0.6, 0.57, 0.8, 2.12],
      [-1.5, 0.5, 0.95, 2.02],
      [-2.6, 0.38, 1.15, 1.9],
      [-3.8, 0.24, 1.33, 1.82],
      [-4.9, 0.12, 1.45, 1.8],
      [-5.25, 0.06, 1.5, 1.78],
    ],
    seg >= 10 ? 10 : 8,
  );
  add("body", fuselage, (x, y, z) => {
    // Side windows: the cabin's upper half between the doors' posts; the stripe below them.
    const side = Math.abs(x) > 0.3;
    if (side && y > 1.45 && y < 2.0 && z < 0.5 && z > -1.35) return windows;
    if (side && y > 1.2 && y < 1.38 && z < 0.5) return trim === body ? accent : trim;
    return body;
  }, at(0, 0, 0), 0.025);
  // The windscreen, leaning back from the cowling to the wing.
  add("body", new BoxGeometry(1.0, 0.06, 0.78), windows, at(0, 2.0, 0.78, 0, 1, -0.95), 0);
  // The cowling and spinner.
  add("cowling", loft([[2.12, 0.34, 1.08, 1.6], [1.85, 0.47, 0.88, 1.82], [1.12, 0.53, 0.78, 1.96]], 8), accent === C.grey ? trim : accent, at(0, 0, 0), 0.03);
  add("spinner", new ConeGeometry(0.16, 0.34, seg), C.cream, at(0, 1.32, 2.28, 0, 1, Math.PI / 2), 0);
  // The propeller: two blades about the hub (on its own bone).
  for (const s of [-1, 1]) add("prop", new BoxGeometry(0.11, 0.9, 0.035), (_x, y) => (Math.abs(y - 1.32) > 0.78 ? C.orange : C.grey), at(0, 1.32 + s * 0.5, 2.2, s * 0.35), 0);
  // The wing: two panels from the cabin roof out to the tips, orange tips; the ailerons and flaps are their own parts.
  for (const s of [-1, 1]) {
    add("body", panel(s * 0.45, s * 5.2, 0.78, -0.42, 0.2, 2.14), (x) => (Math.abs(x) > 4.75 ? C.orange : body), at(0, 0, 0), 0.02);
    add(s > 0 ? "aileronL" : "aileronR", panel(s * 2.95, s * 4.7, -0.42, -0.82, 0.07, 2.13), body, at(0, 0, 0), 0.02);
    add(s > 0 ? "flapL" : "flapR", panel(s * 0.55, s * 2.85, -0.44, -0.82, 0.07, 2.09), body, at(0, 0, 0), 0.02);
    // Struts from the lower fuselage to under the wing.
    add("body", new CylinderGeometry(0.035, 0.035, 1, 4), C.grey, between(s * 0.5, 0.95, 0.1, s * 2.75, 2.06, 0.18), 0);
    add("body", new CylinderGeometry(0.03, 0.03, 1, 4), C.grey, between(s * 0.5, 0.95, -0.25, s * 2.7, 2.06, -0.3), 0);
    // Navigation lights at the tips: red on the left, green on the right.
    add("body", new BoxGeometry(0.08, 0.08, 0.14), s > 0 ? 0xff4a3a : 0x5dff8a, at(s * 5.24, 2.15, 0.45), 0, 1.2);
  }
  // The landing light, in the left wing's leading edge.
  add("body", new BoxGeometry(0.22, 0.08, 0.04), 0xfff4dc, at(1.6, 2.13, 0.8), 0, 1.2);
  // The tail: tailplane and fin; elevator and rudder on their own.
  add("body", panel(-1.65, 1.65, -4.55, -5.0, 0.08, 1.62), body, at(0, 0, 0), 0.02);
  add("elevator", panel(-1.62, 1.62, -5.02, -5.35, 0.05, 1.62), (x) => (Math.abs(x) > 1.35 ? C.orange : body), at(0, 0, 0), 0.02);
  const fin = new BufferGeometry();
  {
    const p = [
      [0, 1.75, -4.2],
      [0, 1.75, -5.12],
      [0, 3.05, -5.12],
      [0, 2.95, -4.85],
    ];
    const t = 0.05;
    const pts: number[] = [];
    for (const s of [-1, 1]) {
      const q = p.map(([, y, z]) => [s * t, y!, z!]);
      if (s > 0) pts.push(...q[0]!, ...q[1]!, ...q[2]!, ...q[0]!, ...q[2]!, ...q[3]!);
      else pts.push(...q[0]!, ...q[2]!, ...q[1]!, ...q[0]!, ...q[3]!, ...q[2]!);
    }
    // Its leading edge and top.
    pts.push(t, 1.75, -4.2, -t, 2.95, -4.85, -t, 1.75, -4.2, t, 1.75, -4.2, t, 2.95, -4.85, -t, 2.95, -4.85);
    pts.push(t, 2.95, -4.85, -t, 3.05, -5.12, -t, 2.95, -4.85, t, 2.95, -4.85, t, 3.05, -5.12, -t, 3.05, -5.12);
    fin.setAttribute("position", new BufferAttribute(new Float32Array(pts), 3));
  }
  add("body", fixWinding(fin, (x, y, z) => [x, y - 2.3, z + 4.7]), (_x, y) => (y > 2.6 ? C.orange : body), at(0, 0, 0), 0.02);
  add("rudder", new BoxGeometry(0.07, 1.25, 0.34), (_x, y) => (y > 2.6 ? C.orange : body), at(0, 2.38, -5.29), 0.02);
  // A white light on the tail, a red beacon on the fin.
  add("body", new BoxGeometry(0.06, 0.06, 0.08), 0xfff8ec, at(0, 1.66, -5.32), 0, 1.2);
  add("body", new BoxGeometry(0.08, 0.1, 0.1), 0xff4a3a, at(0, 3.1, -5.0), 0, 1);
  // The undercarriage: spring legs to the main wheels (each on its own axle), the nose leg and wheel.
  for (const s of [-1, 1]) {
    add("body", new BoxGeometry(0.08, 1, 0.12), C.grey, between(s * 0.45, 0.85, 0, s * 1.08, 0.3, 0), 0);
    add(s > 0 ? "wheelL" : "wheelR", new CylinderGeometry(0.3, 0.3, 0.2, seg + 2), (x, y, z) => (Math.hypot(y - 0.3, z) < 0.15 ? C.cream : C.tyre), at(s * 1.12, 0.3, 0, 0, 1, 0, Math.PI / 2), 0.03);
    add("body", new SphereGeometry(0.34, seg, 4, 0, Math.PI * 2, 0, Math.PI / 2), trim === body ? accent : trim, at(s * 1.12, 0.36, 0, 0, [0.45, 0.6, 1.25]), 0.02);
  }
  add("nose", new CylinderGeometry(0.045, 0.045, 0.75, 6), C.steel, at(0, 0.6, 1.75), 0);
  add("noseWheel", new CylinderGeometry(0.24, 0.24, 0.14, seg + 2), (x, y, z) => (Math.hypot(y - 0.24, z - 1.75) < 0.12 ? C.cream : C.tyre), at(0, 0.24, 1.75, 0, 1, 0, Math.PI / 2), 0.03);
  return { static: out };
}
