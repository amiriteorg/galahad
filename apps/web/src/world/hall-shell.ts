import { BoxGeometry, type BufferGeometry, OctahedronGeometry } from "three/webgpu";
import { CUT_EAST, CUT_NORTH, CUT_ROOF, CUT_SOUTH, CUT_WEST } from "./hall-cutaway.ts";
import { type Detail, finish, Kit } from "./hall-kit.ts";
import {
  COLUMN,
  COLUMNS,
  CRANE,
  EAST,
  HALL,
  HALL_DOOR,
  HALL_EAVES,
  HALL_INNER,
  HALL_RISE,
  HALL_SOLIDS,
  HALL_TEETH,
  HALL_TOOTH,
  HALL_WALL,
  HEAD,
  LAMP_HEIGHT,
  LAMP_ROWS,
  lampX,
  NORTH,
  OPENINGS,
  type Opening,
  SILL,
  SOUTH,
  WEST,
} from "./hall-plan.ts";
import { at } from "./mesher.ts";
import type { Glow } from "./place.ts";

/*
 * The workshop hall itself: a steel frame (columns inside the long walls, the
 * crane's rails on them), walls of cream panels over timber boards with tall
 * windows, a wide door in the west wall under a rolled-up shutter, and a
 * sawtooth roof whose upright faces are glazed lattice trusses (the
 * skylights), with high-bay lamps under it. The cladding, the roof and the
 * glass are the shell, which dissolves for the cutaway; the frame, the floor
 * and the forecourt never do.
 */

export const C = {
  plinth: 0xbdb6a8,
  board: 0xc8915e,
  boardAlt: 0xb57c4e,
  cream: 0xf1ece0,
  dado: 0xb9c6cf,
  orange: 0xe8853a,
  steel: 0x5d6878,
  steelDark: 0x3e444e,
  roof: 0xa9b8c0,
  seam: 0x93a3ad,
  deck: 0xeeebe4,
  white: 0xf7f5f0,
  glass: 0xffffff,
  floor: 0xd6d1c6,
  apron: 0xcfc8ba,
  apronAlt: 0xc6bfb1,
  yellow: 0xf2c14e,
  dark: 0x4a4e57,
  lamp: 0xfff4dc,
};

const T = HALL_WALL / 2;
/** The floor's top. */
export const FLOOR = 0.07;

/** The lamp slots the building uses (see HallUniforms.lampColors): the high-bay lamps and the sign over the door. */
export const LAMP_BAY = 1;
export const LAMP_SIGN = 2;

/** A run of wall (its core) along one axis with openings cut out of it: sills, heads and the piers between. */
function wall(k: Kit, along: "x" | "y", f0: number, f1: number, from: number, to: number, openings: readonly Opening[], top: number, color: number): void {
  const put = (a: number, b: number, z0: number, z1: number) => {
    if (b - a < 1e-6 || z1 - z0 < 1e-6) return;
    if (along === "x") k.slab(color, a, b, f0, f1, z0, z1, 0.015);
    else k.slab(color, f0, f1, a, b, z0, z1, 0.015);
  };
  let p = from;
  for (const o of [...openings].sort((q, r) => q.a - r.a)) {
    put(p, o.a, 0, top);
    put(o.a, o.b, 0, o.z0);
    put(o.a, o.b, o.z1, top);
    p = o.b;
  }
  put(p, to, 0, top);
}

/** The inside of a run of wall: a painted dado to waist height, broken by the door. */
function dado(k: Kit, along: "x" | "y", face: number, dir: 1 | -1, from: number, to: number, openings: readonly Opening[]): void {
  let p = from;
  const put = (a: number, b: number) => {
    if (b - a < 1e-6) return;
    if (along === "x") k.slab(C.dado, a, b, face, face + dir * 0.03, 0, 1.25, 0.02);
    else k.slab(C.dado, face, face + dir * 0.03, a, b, 0, 1.25, 0.02);
  };
  for (const o of [...openings].filter((q) => q.z0 < 0.01).sort((q, r) => q.a - r.a)) {
    put(p, o.a);
    p = o.b;
  }
  put(p, to);
}

/** A window in a wall: a white frame with a transom and mullions, and its pane. `face`: the wall's outer face; `dir`: +1 if outside is towards +axis. */
function windowAt(k: Kit, glass: Kit, along: "x" | "y", face: number, dir: 1 | -1, o: Opening, detail: Detail): void {
  const depth = 0.34;
  const mid = face - dir * (depth / 2 - 0.04);
  const bar = (a: number, b: number, z0: number, z1: number, d = depth) => {
    if (along === "x") k.slab(C.white, a, b, mid - d / 2, mid + d / 2, z0, z1, 0.01);
    else k.slab(C.white, mid - d / 2, mid + d / 2, a, b, z0, z1, 0.01);
  };
  const w = 0.14;
  bar(o.a, o.b, o.z0, o.z0 + w);
  bar(o.a, o.b, o.z1 - w, o.z1);
  bar(o.a, o.a + w, o.z0, o.z1);
  bar(o.b - w, o.b, o.z0, o.z1);
  if (detail > 0) {
    const n = Math.max(1, Math.round((o.b - o.a) / 1.5));
    for (let i = 1; i < n; i++) bar(o.a + ((o.b - o.a) * i) / n - 0.04, o.a + ((o.b - o.a) * i) / n + 0.04, o.z0, o.z1, 0.12);
    const transom = o.z0 + (o.z1 - o.z0) * 0.62;
    bar(o.a, o.b, transom - 0.04, transom + 0.04, 0.12);
    // A sill outside.
    const s = face + dir * 0.09;
    if (along === "x") k.slab(C.white, o.a - 0.1, o.b + 0.1, s - 0.12, s + 0.12, o.z0 - 0.09, o.z0, 0.01);
    else k.slab(C.white, s - 0.12, s + 0.12, o.a - 0.1, o.b + 0.1, o.z0 - 0.09, o.z0, 0.01);
  }
  const g = face - dir * 0.2;
  if (along === "x") glass.slab(C.glass, o.a, o.b, g - 0.01, g + 0.01, o.z0, o.z1, 0);
  else glass.slab(C.glass, g - 0.01, g + 0.01, o.a, o.b, o.z0, o.z1, 0);
}

/** The cladding outside a run of wall: a plinth, timber boards (a low band under the windows, a tall one between), an orange fascia under the eaves. */
function cladding(k: Kit, along: "x" | "y", face: number, dir: 1 | -1, from: number, to: number, openings: readonly Opening[], detail: Detail): void {
  const strip = (a: number, b: number, z0: number, z1: number, proud: number, color: number, vary = 0.03) => {
    if (b - a < 1e-6) return;
    const f0 = face;
    const f1 = face + dir * proud;
    if (along === "x") k.slab(color, a, b, f0, f1, z0, z1, vary);
    else k.slab(color, f0, f1, a, b, z0, z1, vary);
  };
  const clear = (a: number, b: number, z0: number, z1: number): boolean => openings.every((o) => b <= o.a + 1e-6 || a >= o.b - 1e-6 || z1 <= o.z0 + 1e-6 || z0 >= o.z1 - 1e-6);
  // Runs between the openings that reach the ground (the door).
  const runs: [number, number][] = [];
  let p = from;
  for (const o of [...openings].filter((q) => q.z0 < 0.01).sort((q, r) => q.a - r.a)) {
    runs.push([p, o.a]);
    p = o.b;
  }
  runs.push([p, to]);
  for (const [a, b] of runs) {
    strip(a, b, 0, 0.6, 0.16, C.plinth);
    strip(a, b, 8.45, HALL_EAVES + 0.02, 0.14, C.orange, 0.02);
    const pitch = detail === 2 ? 0.7 : detail === 1 ? 1.4 : b - a;
    const n = Math.max(1, Math.round((b - a) / pitch));
    for (let i = 0; i < n; i++) {
      const b0 = a + ((b - a) * i) / n;
      const b1 = a + ((b - a) * (i + 1)) / n;
      const gap = detail === 0 ? 0 : 0.025;
      const color = i % 3 === 1 ? C.boardAlt : C.board;
      // The tall band where no window is in the way, the low one under the windows.
      const tall = clear(b0, b1, SILL - 0.1, HEAD + 0.1);
      strip(b0 + gap, b1 - gap, 0.6, tall ? 6.6 : SILL - 0.12, 0.1, color, 0.07);
    }
  }
}

/** The lodestar over the door: two crossed slivers, glowing after dark. */
function sign(k: Kit, x: number, y: number, z: number, r: number): void {
  k.glow(LAMP_SIGN);
  k.add(new OctahedronGeometry(1, 0), 0xffd9a0, at(x, z, -y, 0, [0.07, r, r * 0.26]), 0);
  k.add(new OctahedronGeometry(1, 0), 0xffd9a0, at(x, z, -y, 0, [0.07, r * 0.26, r]), 0);
  k.glow(0);
}

export interface Building {
  /** The cladding and the roof (with `cut`, `lit` and `glow` attributes). */
  shell: BufferGeometry;
  /** The floor indoors and the forecourt outside (with `lit`). */
  floor: BufferGeometry;
  /** Where lamps and lit windows glow at night. */
  warm: Glow[];
}

/** Builds the shell and the floor, adds what never dissolves (the steel frame) to `fixed` and the panes to `glass`. */
export function buildHall(detail: Detail, fixed: Kit, glass: Kit): Building {
  const k = new Kit(detail);
  const warm: Glow[] = [];
  const cutTo = (cut: number) => {
    k.tag("cut", cut);
    glass.tag("cut", cut);
  };

  // ---------- walls ----------
  cutTo(CUT_WEST);
  wall(k, "y", WEST - T + 0.1, WEST + T, SOUTH + T, NORTH - T, OPENINGS.west, HALL_EAVES, C.cream);
  cladding(k, "y", WEST - T + 0.1, -1, SOUTH + T, NORTH - T, OPENINGS.west, detail);
  dado(k, "y", WEST + T, 1, SOUTH + T, NORTH - T, OPENINGS.west);
  for (const o of OPENINGS.west.slice(1)) windowAt(k, glass, "y", WEST - T + 0.1, -1, o, detail);
  // The door: an orange portal, the shutter rolled up in its housing above, its guides either side.
  for (const s of [1, -1]) {
    k.slab(C.orange, WEST - T - 0.08, WEST + T + 0.04, s * HALL_DOOR.half, s * (HALL_DOOR.half + 0.4), 0, HALL_DOOR.height + 0.4, 0.02);
    k.slab(C.steelDark, WEST - T - 0.14, WEST - T - 0.02, s * (HALL_DOOR.half - 0.12), s * HALL_DOOR.half, 0, HALL_DOOR.height, 0.02);
  }
  k.slab(C.orange, WEST - T - 0.08, WEST + T + 0.04, -HALL_DOOR.half - 0.4, HALL_DOOR.half + 0.4, HALL_DOOR.height, HALL_DOOR.height + 0.4, 0.02);
  k.panel(C.white, WEST - T - 0.36, 0, HALL_DOOR.height + 0.95, 0.62, HALL_DOOR.half * 2 + 0.9, 0.95, 0, 0.02, 0.06);
  if (detail > 0) for (let i = 0; i < 4; i++) k.slab(0xd9d4c9, WEST - T - 0.05, WEST + T - 0.3, -HALL_DOOR.half, HALL_DOOR.half, HALL_DOOR.height - 0.14 - i * 0.16, HALL_DOOR.height - 0.02 - i * 0.16, 0.03);
  sign(k, WEST - T - 0.02, 0, 8.05, 0.62);
  warm.push([WEST - 1.2, 3.2, 0, 5.5], [WEST - 0.8, HALL_DOOR.height + 0.5, 0, 2.6]);

  cutTo(CUT_EAST);
  wall(k, "y", EAST - T, EAST + T - 0.1, SOUTH + T, NORTH - T, OPENINGS.east, HALL_EAVES, C.cream);
  cladding(k, "y", EAST + T - 0.1, 1, SOUTH + T, NORTH - T, OPENINGS.east, detail);
  dado(k, "y", EAST - T, -1, SOUTH + T, NORTH - T, OPENINGS.east);
  for (const o of OPENINGS.east) windowAt(k, glass, "y", EAST + T - 0.1, 1, o, detail);

  for (const [cut, y, dir, openings] of [
    [CUT_NORTH, NORTH, 1, OPENINGS.north],
    [CUT_SOUTH, SOUTH, -1, OPENINGS.south],
  ] as const) {
    cutTo(cut);
    const inner = y - dir * T;
    const outer = y + dir * (T - 0.1);
    wall(k, "x", Math.min(inner, outer), Math.max(inner, outer), WEST - T, EAST + T, openings, HALL_EAVES, C.cream);
    cladding(k, "x", outer, dir, WEST - T, EAST + T, openings, detail);
    dado(k, "x", inner, -dir as 1 | -1, WEST + T, EAST - T, openings);
    for (const o of openings) windowAt(k, glass, "x", outer, dir, o, detail);
    // The gables under each tooth of the roof: they go with the wall, and with the roof.
    cutTo(cut + CUT_ROOF);
    for (let i = 0; i < HALL_TEETH; i++) {
      const x0 = WEST + i * HALL_TOOTH;
      k.wedge(C.cream, [x0, HALL_EAVES], [x0, HALL_EAVES + HALL_RISE], [x0 + HALL_TOOTH, HALL_EAVES], inner, outer);
    }
    for (let i = 0; i < HALL_TEETH; i += 2) warm.push([WEST + (i + 0.5) * HALL_TOOTH, 4.4, -(y + dir * 0.5), 3.4]);
  }

  // ---------- the roof ----------
  const slope = Math.atan2(HALL_RISE, HALL_TOOTH);
  const nx = Math.sin(slope);
  const nz = Math.cos(slope);
  const run = Math.hypot(HALL_TOOTH, HALL_RISE);
  for (let i = 0; i < HALL_TEETH; i++) {
    const x0 = WEST + i * HALL_TOOTH;
    const mx = x0 + HALL_TOOTH / 2;
    const mz = HALL_EAVES + HALL_RISE / 2;
    cutTo(CUT_ROOF);
    // The slope: a zinc skin with standing seams over a pale deck.
    k.add(new BoxGeometry(run + 0.3, 0.1, HALL.hy * 2 + 0.9), C.roof, at(mx - nx * 0.05 + 0.1, mz - nz * 0.05, 0, 0, 1, 0, -slope), 0.03);
    k.add(new BoxGeometry(run - 0.25, 0.14, HALL_INNER.hy * 2 - 0.02), C.deck, at(mx - nx * 0.17 + 0.05, mz - nz * 0.17, 0, 0, 1, 0, -slope), 0.02);
    const seams = detail === 2 ? 20 : detail === 1 ? 10 : 0;
    for (let s = 0; s < seams; s++) {
      const y = SOUTH + ((s + 0.5) * HALL.hy * 2) / seams;
      k.add(new BoxGeometry(run + 0.2, 0.07, 0.07), C.seam, at(mx + nx * 0.03 + 0.1, mz + nz * 0.03, -y, 0, 1, 0, -slope), 0.02);
    }
    // The upright face: a lattice truss from wall to wall, glazed. The first stands on the west wall.
    cutTo(i === 0 ? CUT_WEST + CUT_ROOF : CUT_ROOF);
    const f0 = i === 0 ? WEST - T + 0.1 : x0 - 0.02;
    const f1 = i === 0 ? WEST + T : x0 + 0.2;
    const z0 = HALL_EAVES;
    const z1 = HALL_EAVES + HALL_RISE;
    k.slab(C.steel, f0, f1, SOUTH - T + 0.1, NORTH + T - 0.1, z0, z0 + 0.26, 0.02);
    k.slab(C.steel, f0, f1, SOUTH - T + 0.1, NORTH + T - 0.1, z1 - 0.22, z1 + 0.02, 0.02);
    const panels = 8;
    const fm = (f0 + f1) / 2;
    for (let p = 0; p <= panels; p++) {
      const y = SOUTH + (p * HALL.hy * 2) / panels;
      k.slab(C.steel, f0, f1, y - 0.09, y + 0.09, z0 + 0.26, z1 - 0.22, 0.02);
      if (p === panels) break;
      const yn = SOUTH + ((p + 1) * HALL.hy * 2) / panels;
      if (detail > 0) k.rod(C.steel, fm, p % 2 ? yn : y, z0 + 0.26, fm, p % 2 ? y : yn, z1 - 0.22, 0.055, 4);
      glass.slab(C.glass, fm - 0.01, fm + 0.01, y + 0.09, yn - 0.09, z0 + 0.26, z1 - 0.22, 0);
    }
    // High-bay lamps under the deck.
    cutTo(CUT_ROOF);
    for (const y of detail === 0 ? [0] : LAMP_ROWS) {
      const top = mz - nz * 0.24 - 0.02;
      const lx = lampX(i);
      k.rod(C.steelDark, lx, y, top, lx, y, LAMP_HEIGHT + 0.35, 0.03, 4);
      k.cyl(C.steelDark, lx, y, LAMP_HEIGHT + 0.05, 0.46, 0.3, 10, 0.16, 0.02);
      k.glow(LAMP_BAY);
      k.cyl(C.lamp, lx, y, LAMP_HEIGHT, 0.38, 0.06, 10, 0.38, 0);
      k.glow(0);
    }
    if (i % 2 === 1) warm.push([mx, LAMP_HEIGHT - 0.1, 0, 2.2]);
  }
  // The cap along the east wall's top, closing the last valley.
  cutTo(CUT_EAST + CUT_ROOF);
  k.slab(C.roof, EAST - 0.2, EAST + T + 0.15, SOUTH - T - 0.15, NORTH + T + 0.15, HALL_EAVES - 0.02, HALL_EAVES + 0.14, 0.02);
  cutTo(0);
  glass.tag("cut", 0);

  // ---------- what never dissolves: the frame ----------
  for (const c of COLUMNS) {
    fixed.panel(C.steel, c.x, c.y, HALL_EAVES / 2, COLUMN, COLUMN, HALL_EAVES, 0, 0.03, 0.04);
    if (detail > 0) fixed.box(C.steelDark, c.x, c.y, 0.06, COLUMN + 0.24, COLUMN + 0.24, 0.12, 0, 0.02);
    // The corbel the crane's rail sits on.
    const side = Math.sign(c.y - HALL.y);
    const rail = side > 0 ? CRANE.north : CRANE.south;
    fixed.slab(C.steel, c.x - 0.2, c.x + 0.2, Math.min(rail - side * 0.2, c.y), Math.max(rail - side * 0.2, c.y), CRANE.rail - 0.85, CRANE.rail - 0.5, 0.02);
  }
  for (const y of [CRANE.north, CRANE.south]) {
    fixed.slab(C.steel, WEST + T + 0.05, EAST - T - 0.05, y - 0.19, y + 0.19, CRANE.rail - 0.5, CRANE.rail - 0.08, 0.02);
    fixed.slab(C.steelDark, WEST + T + 0.3, EAST - T - 0.3, y - 0.05, y + 0.05, CRANE.rail - 0.08, CRANE.rail, 0.02);
    for (const x of [WEST + T + 0.25, EAST - T - 0.25]) fixed.box(C.yellow, x, y, CRANE.rail + 0.2, 0.3, 0.3, 0.4, 0, 0.02);
  }

  // ---------- the floor: one level sheet (its markings are painted in its shader), and the forecourt ----------
  const f = new Kit(detail);
  const step = detail === 2 ? 1 : detail === 1 ? 2 : 4;
  const xs = breaks(WEST - T, EAST + T, step, [WEST + T, EAST - T]);
  const ys = breaks(SOUTH - T, NORTH + T, step, [SOUTH + T, NORTH - T]);
  for (let i = 0; i + 1 < xs.length; i++) {
    for (let j = 0; j + 1 < ys.length; j++) f.polygon(C.floor, [[xs[i]!, ys[j]!], [xs[i + 1]!, ys[j]!], [xs[i + 1]!, ys[j + 1]!], [xs[i]!, ys[j + 1]!]], FLOOR);
  }
  const fx0 = WEST - 8.2;
  const cells = detail === 0 ? 3 : 6;
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells * 2; j++) {
      const x0 = fx0 + ((WEST - T - fx0) * i) / cells;
      const x1 = fx0 + ((WEST - T - fx0) * (i + 1)) / cells;
      const y0 = -9 + (18 * j) / (cells * 2);
      const y1 = -9 + (18 * (j + 1)) / (cells * 2);
      f.polygon((i + j) % 2 ? C.apron : C.apronAlt, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], FLOOR - 0.005);
    }
  }
  f.slab(C.apron, fx0, WEST - T, -9, 9, -0.4, FLOOR - 0.012, 0.02);
  for (const [x0, x1, y0, y1] of [
    [WEST - T - 1, EAST + T + 1, NORTH + T, NORTH + T + 1],
    [WEST - T - 1, EAST + T + 1, SOUTH - T - 1, SOUTH - T],
    [EAST + T, EAST + T + 1, SOUTH - T, NORTH + T],
    [WEST - T - 1, WEST - T, 9, NORTH + T],
    [WEST - T - 1, WEST - T, SOUTH - T, -9],
  ] as const) {
    f.slab(C.apron, x0, x1, y0, y1, -0.3, 0.05, 0.03);
  }
  for (const s of [1, -1]) {
    f.cyl(C.dark, fx0 + 0.4, s * 8.5, 0, 0.14, 0.9, 8);
    f.cyl(C.orange, fx0 + 0.4, s * 8.5, 0.9, 0.16, 0.12, 8);
  }

  return {
    shell: finish(k.build(), { foot: 0.22, height: 1.6 }),
    floor: finish(f.build(), { solids: HALL_SOLIDS }),
    warm,
  };
}

/** Sorted cuts from `from` to `to`: every `step`, and at each of `extra` (edges that must fall on a cut). */
function breaks(from: number, to: number, step: number, extra: readonly number[]): number[] {
  const out = new Set<number>([from, to]);
  for (let v = Math.ceil(from / step) * step; v < to; v += step) if (v > from + 0.15 && v < to - 0.15) out.add(v);
  for (const v of extra) if (v > from && v < to) out.add(v);
  const sorted = [...out].sort((p, q) => p - q);
  // Drop cuts that fall within a hand's breadth of an edge that must be there.
  return sorted.filter((v, i) => i === 0 || v - sorted[i - 1]! > 0.14 || extra.includes(v) || v === to);
}
