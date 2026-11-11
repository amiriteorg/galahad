import type { Rect } from "./colliders.ts";
import { APRON, ARENA, ENTRANCE, FIELD, FIELD_RIM, FLAME_DEFLECTOR, FLAME_TRENCH, HOLD_SHORT, LAUNCH_SLAB, RUNWAY, TAXIWAY, TIE_DOWNS } from "./field-plan.ts";
import { COURSE_ROUTE } from "./field-rover.ts";
import { type Route, routeSample, sample } from "./field-route.ts";
import { ROUTES, TAXI_OUT } from "./field-circuit.ts";
import { Mesher } from "./mesher.ts";

/*
 * The proving ground's ground, as one mesh: mown turf in stripes, the runway's
 * asphalt and its paint, the taxiway, the apron's concrete slabs, the launch
 * pad's slab, the rover's arena and its beaten track. Every layer has its own
 * height, a couple of centimetres above the one under it, so no two ever share
 * a plane (no z-fighting at any distance, on either backend), and paint is
 * geometry laid on top, never coplanar with what it's painted on. Scene
 * coordinates under the place's group (ground at 0, x east, y up, z south).
 * The gloss of each part (how much a wet surface mirrors the sky) rides in the
 * mesh's glow attribute: 1 asphalt and concrete, less for earth and turf.
 */

/** The layers' tops above the proving ground's level (metres). */
export const TURF = 0.025;
/** Under all paving (fills any crack between slabs), the shoulders, the rover's track and arena. */
export const BASE = 0.045;
export const PAVE = 0.065;
export const PAINT = 0.085;
/** The rover's track and its obstacles stand on this. */
export const TRACK_TOP = BASE;

export interface GroundDetail {
  /** The turf's cells (metres): smaller is more facets. */
  turf: number;
  /** Runway tiles along its length (metres). */
  tile: number;
  /** Rubber streaks, slab stains and other small paint. */
  fine: boolean;
}

const WHITE = 0xf3efe6;
const YELLOW = 0xf0c95a;
const ASPHALT = 0x8e929a;
const ASPHALT_DARK = 0x83878f;
const RUBBER = 0x6f737b;
const CONCRETE = 0xcdc8bc;
const CONCRETE_JOINT = 0x9d998f;
const SHOULDER = 0xbab29c;
const EARTH = 0xd2b98d;
const EARTH_DARK = 0xc2a678;
const ARENA_EARTH = 0xd6c39b;
const MOWN = [0xafd067, 0x9ec65a] as const;
const ROUGH = 0x93bb50;

const fract = (v: number): number => v - Math.floor(v);
const hash = (a: number, b: number, salt = 0): number => fract(Math.sin(a * 127.1 + b * 311.7 + salt * 74.7) * 43758.5453);

/** An sRGB colour scaled in brightness by `k`. */
export function shade(hex: number, k: number): number {
  const r = Math.min(255, Math.round(((hex >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((hex >> 8) & 255) * k));
  const b = Math.min(255, Math.round((hex & 255) * k));
  return (r << 16) | (g << 8) | b;
}

/** Mixes two sRGB colours. */
export function mixHex(a: number, b: number, t: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** A level quad over the world rectangle [x0, x1] × [y0, y1] at height h, facing up. */
export function flat(m: Mesher, x0: number, y0: number, x1: number, y1: number, h: number, color: number): void {
  m.triangles([x0, h, -y0, x1, h, -y0, x1, h, -y1, x0, h, -y0, x1, h, -y1, x0, h, -y1], color);
}

/** A level quad through four world points (x, y) in counter-clockwise order seen from above. */
function quad4(m: Mesher, ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number, h: number, color: number): void {
  m.triangles([ax, h, -ay, bx, h, -by, cx, h, -cy, ax, h, -ay, cx, h, -cy, dx, h, -dy], color);
}

/** A vertical strip from (ax, ay) to (bx, by), from height lo up to hi, facing to the right of a → b. */
function side(m: Mesher, ax: number, ay: number, bx: number, by: number, lo: number, hi: number, color: number): void {
  m.triangles([ax, lo, -ay, bx, lo, -by, bx, hi, -by, ax, lo, -ay, bx, hi, -by, ax, hi, -ay], color);
}

/** A slab's four sides, from `lo` up to its top (the lip a slab shows at its edge). */
function lip(m: Mesher, r: Rect, lo: number, hi: number, color: number): void {
  const [x0, x1, y0, y1] = [r.x - r.hx, r.x + r.hx, r.y - r.hy, r.y + r.hy];
  side(m, x0, y1, x0, y0, lo, hi, color);
  side(m, x0, y0, x1, y0, lo, hi, color);
  side(m, x1, y0, x1, y1, lo, hi, color);
  side(m, x1, y1, x0, y1, lo, hi, color);
}

const within = (r: Rect, x: number, y: number, grow = 0): boolean => Math.abs(x - r.x) <= r.hx + grow && Math.abs(y - r.y) <= r.hy + grow;
const covers = (r: Rect, x0: number, y0: number, x1: number, y1: number): boolean => x0 >= r.x - r.hx && x1 <= r.x + r.hx && y0 >= r.y - r.hy && y1 <= r.y + r.hy;

/** A strip of paint `width` wide along a route, from distance s0 to s1, sampled every `step` metres. */
function routeLine(m: Mesher, rt: Route, s0: number, s1: number, width: number, h: number, color: number, step = 0.6): void {
  const p = routeSample();
  const n = Math.max(1, Math.ceil((s1 - s0) / step));
  let lx = 0;
  let ly = 0;
  let rx = 0;
  let ry = 0;
  for (let i = 0; i <= n; i++) {
    sample(rt, s0 + ((s1 - s0) * i) / n, p);
    const nx = -Math.sin(p.heading) * (width / 2);
    const ny = Math.cos(p.heading) * (width / 2);
    const [ax, ay, bx, by] = [p.x + nx, p.y + ny, p.x - nx, p.y - ny];
    if (i > 0) quad4(m, rx, ry, bx, by, ax, ay, lx, ly, h, color);
    lx = ax;
    ly = ay;
    rx = bx;
    ry = by;
  }
}

/** A ring of paint round (x, y). */
function ring(m: Mesher, x: number, y: number, r: number, width: number, h: number, color: number, n = 20): void {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const b = ((i + 1) / n) * Math.PI * 2;
    const [ri, ro] = [r - width / 2, r + width / 2];
    quad4(m, x + Math.cos(a) * ri, y + Math.sin(a) * ri, x + Math.cos(b) * ri, y + Math.sin(b) * ri, x + Math.cos(b) * ro, y + Math.sin(b) * ro, x + Math.cos(a) * ro, y + Math.sin(a) * ro, h, color);
  }
}

// ---------- the runway's paint ----------

/** A rectangle of paint in a runway end's own frame: u from the end towards the middle, r to the landing pilot's right. */
type EndRect = readonly [u0: number, u1: number, r0: number, r1: number];

/** The seven segments of a blocky runway digit, `w` wide and `h` tall with strokes `s`, in (r, v) about its centre (v up the digit). */
function digit(d: number, w: number, h: number, s: number): [number, number, number, number][] {
  const [x0, x1, y0, y1] = [-w / 2, w / 2, -h / 2, h / 2];
  const seg: Record<string, [number, number, number, number]> = {
    a: [x0, x1, y1 - s, y1],
    b: [x1 - s, x1, 0, y1],
    c: [x1 - s, x1, y0, 0],
    d: [x0, x1, y0, y0 + s],
    e: [x0, x0 + s, y0, 0],
    f: [x0, x0 + s, 0, y1],
    g: [x0, x1, -s / 2, s / 2],
  };
  if (d === 1) return [[-s / 2, s / 2, y0, y1], [-s * 1.6, -s / 2, y1 - s, y1]];
  const on: Record<number, string> = { 3: "abcdg", 6: "acdefg", 8: "abcdefg" };
  return [...on[d]!].map((k) => seg[k]!);
}

/** The paint at one end of the runway, in that end's frame. */
function endMarkings(number: readonly [number, number]): EndRect[] {
  const out: EndRect[] = [];
  // Threshold: eight piano keys either side of the centre line.
  for (let k = 0; k < 4; k++) {
    const r = 1.15 + k * 1.6;
    out.push([2, 11, r - 0.4, r + 0.4], [2, 11, -r - 0.4, -r + 0.4]);
  }
  // The runway's number, read by the pilot landing over this end: digits' bottoms nearest the threshold.
  const [w, h, s] = [2.4, 6, 0.55];
  number.forEach((d, i) => {
    const cr = (i === 0 ? -1 : 1) * 1.75;
    for (const [r0, r1, v0, v1] of digit(d, w, h, s)) out.push([14 + h / 2 + v0, 14 + h / 2 + v1, cr + r0, cr + r1]);
  });
  // Touchdown zone: three bars each side, then the aiming points, then two bars.
  for (const r of [2.2, 2.85, 3.5]) out.push([25, 29, r, r + 0.4], [25, 29, -r - 0.4, -r]);
  out.push([35, 43, 2.1, 3.3], [35, 43, -3.3, -2.1]);
  for (const r of [2.2, 2.85]) out.push([50, 53.5, r, r + 0.4], [50, 53.5, -r - 0.4, -r]);
  // The centre line's dashes towards the middle (the other end paints its half), short of where the yellow lead-off lines leave it.
  for (let u = 24; u + 6 <= RUNWAY.hy - 16 + 0.01; u += 12) out.push([u, u + 6, -0.22, 0.22]);
  return out;
}

/** A runway end's frame in the world: its end's y, which way is "towards the middle" (+1 north) and the landing pilot's right. */
const END_NORTH = { y: RUNWAY.y + RUNWAY.hy, dir: -1 } as const;
const END_SOUTH = { y: RUNWAY.y - RUNWAY.hy, dir: 1 } as const;

function toWorld(end: { y: number; dir: 1 | -1 }, [u0, u1, r0, r1]: EndRect): [number, number, number, number] {
  // Flying towards the middle (dir), the pilot's right is east when going north and west going south.
  const ya = end.y + end.dir * u0;
  const yb = end.y + end.dir * u1;
  const xa = RUNWAY.x + end.dir * r0;
  const xb = RUNWAY.x + end.dir * r1;
  return [Math.min(xa, xb), Math.min(ya, yb), Math.max(xa, xb), Math.max(ya, yb)];
}

/** Every rectangle of white paint on the runway (world: x0, y0, x1, y1). Exported for the tests: none may overlap the rubber. */
export function runwayPaint(): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  for (const r of endMarkings([1, 8])) out.push(toWorld(END_NORTH, r));
  for (const r of endMarkings([3, 6])) out.push(toWorld(END_SOUTH, r));
  // Edge lines, the full length (the east one broken where the taxiway joins, for the lead-off lines to cross).
  for (const s of [-1, 1]) {
    const a = RUNWAY.x + s * (RUNWAY.hx - 0.75);
    const b = RUNWAY.x + s * (RUNWAY.hx - 1.05);
    const [lo, hi] = [RUNWAY.y - RUNWAY.hy + 1, RUNWAY.y + RUNWAY.hy - 1];
    if (s < 0) out.push([Math.min(a, b), lo, Math.max(a, b), hi]);
    else {
      out.push([Math.min(a, b), lo, Math.max(a, b), TAXIWAY.y - TAXIWAY.hy - 9]);
      out.push([Math.min(a, b), TAXIWAY.y + TAXIWAY.hy + 9, Math.max(a, b), hi]);
    }
  }
  return out;
}

/** Rubber laid down where the wheels touch: broken streaks either side of the centre line in each touchdown zone. */
export function rubberStreaks(): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  for (const end of [END_NORTH, END_SOUTH]) {
    for (const s of [-1, 1]) {
      // (Past the runway's number, which they'd otherwise cross.)
      let u = 21;
      let i = 0;
      while (u < 47) {
        const len = 2.5 + 4 * hash(i, s, end.dir);
        const r = s * (1.25 + 0.3 * hash(i, s + 3, end.dir));
        out.push(toWorld(end, [u, u + len, r - 0.17, r + 0.17]));
        u += len + 1 + 2.5 * hash(i, s + 7, end.dir);
        i++;
      }
    }
  }
  return out;
}

// ---------- the build ----------

/** The proving ground's ground, built at a level of detail. */
export function buildGround(d: GroundDetail): Mesher {
  const m = new Mesher();
  const covered = [RUNWAY, TAXIWAY, APRON, ENTRANCE, LAUNCH_SLAB, ARENA];

  // Turf: mown in stripes along the runway, each cell its own shade, a little patchy; rough grass round the rim.
  m.glow(0.25);
  const cell = d.turf;
  const x0 = FIELD.x - FIELD.hx;
  const y0 = FIELD.y - FIELD.hy;
  const nx = Math.round((FIELD.hx * 2) / cell);
  const ny = Math.round((FIELD.hy * 2) / cell);
  const cx = (FIELD.hx * 2) / nx;
  const cy = (FIELD.hy * 2) / ny;
  const stripe = 7;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const ax = x0 + i * cx;
      const ay = y0 + j * cy;
      const bx = ax + cx;
      const by = ay + cy;
      if (covered.some((r) => covers(r, ax, ay, bx, by))) continue;
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2;
      const band = MOWN[Math.floor((mx - RUNWAY.x + 1000 * stripe + stripe / 2) / stripe) % 2]!;
      const patch = 0.97 + 0.06 * hash(Math.floor(mx / 13), Math.floor(my / 11), 5);
      // Two triangles, each a touch different: facets you can see up close, not a pattern from afar.
      m.triangles([ax, TURF, -ay, bx, TURF, -ay, bx, TURF, -by], shade(band, patch * (0.982 + 0.036 * hash(i, j, 1))));
      m.triangles([ax, TURF, -ay, bx, TURF, -by, ax, TURF, -by], shade(band, patch * (0.982 + 0.036 * hash(i, j, 2))));
    }
  }
  // The rim: rough grass from the mown edge out to the fence line.
  const R = FIELD_RIM;
  const [fx0, fx1, fy0, fy1] = [FIELD.x - FIELD.hx, FIELD.x + FIELD.hx, FIELD.y - FIELD.hy, FIELD.y + FIELD.hy];
  const rimStep = 7;
  for (let x = fx0 - R; x < fx1 + R - 1e-6; x += rimStep) {
    const xe = Math.min(fx1 + R, x + rimStep);
    flat(m, x, fy0 - R, xe, fy0, TURF, shade(ROUGH, 0.95 + 0.1 * hash(x, 1)));
    flat(m, x, fy1, xe, fy1 + R, TURF, shade(ROUGH, 0.95 + 0.1 * hash(x, 2)));
  }
  for (let y = fy0; y < fy1 - 1e-6; y += rimStep) {
    const ye = Math.min(fy1, y + rimStep);
    flat(m, fx0 - R, y, fx0, ye, TURF, shade(ROUGH, 0.95 + 0.1 * hash(y, 3)));
    flat(m, fx1, y, fx1 + R, ye, TURF, shade(ROUGH, 0.95 + 0.1 * hash(y, 4)));
  }

  // Under every slab, a base: anything seen between two slabs is the slab's own colour, never the grass.
  m.glow(0.8);
  for (const r of [RUNWAY, TAXIWAY, ENTRANCE]) flat(m, r.x - r.hx, r.y - r.hy, r.x + r.hx, r.y + r.hy, BASE, ASPHALT_DARK);
  for (const r of [APRON, LAUNCH_SLAB]) flat(m, r.x - r.hx, r.y - r.hy, r.x + r.hx, r.y + r.hy, BASE, CONCRETE_JOINT);
  // Gravel shoulders along the runway.
  for (const s of [-1, 1]) {
    const xa = RUNWAY.x + s * RUNWAY.hx;
    const xb = xa + s * 1.4;
    for (let y = RUNWAY.y - RUNWAY.hy; y < RUNWAY.y + RUNWAY.hy - 1e-6; y += 12) {
      const ye = Math.min(RUNWAY.y + RUNWAY.hy, y + 12);
      // (Not where the taxiway joins.)
      if (s === 1 && ye > TAXIWAY.y - TAXIWAY.hy - 6 && y < TAXIWAY.y + TAXIWAY.hy + 6) {
        if (y < TAXIWAY.y - TAXIWAY.hy - 6) flat(m, Math.min(xa, xb), y, Math.max(xa, xb), TAXIWAY.y - TAXIWAY.hy - 6, BASE, shade(SHOULDER, 0.97 + 0.06 * hash(y, s)));
        if (ye > TAXIWAY.y + TAXIWAY.hy + 6) flat(m, Math.min(xa, xb), TAXIWAY.y + TAXIWAY.hy + 6, Math.max(xa, xb), ye, BASE, shade(SHOULDER, 0.97 + 0.06 * hash(y, s)));
        continue;
      }
      flat(m, Math.min(xa, xb), y, Math.max(xa, xb), ye, BASE, shade(SHOULDER, 0.97 + 0.06 * hash(y, s)));
    }
  }

  // The runway: asphalt tiles, a few patched darker, its lip down to the shoulders.
  m.glow(1);
  const rx0 = RUNWAY.x - RUNWAY.hx;
  const ry0 = RUNWAY.y - RUNWAY.hy;
  const across = 4;
  const along = Math.round((RUNWAY.hy * 2) / d.tile);
  const tw = (RUNWAY.hx * 2) / across;
  const tl = (RUNWAY.hy * 2) / along;
  for (let j = 0; j < along; j++) {
    for (let i = 0; i < across; i++) {
      const patched = hash(i, j, 9) > 0.9;
      // Worn paler down the middle, where the wheels run.
      const middle = i === 1 || i === 2 ? 1.03 : 0.99;
      const c = shade(patched ? ASPHALT_DARK : ASPHALT, middle * (0.97 + 0.06 * hash(i, j, 3)));
      flat(m, rx0 + i * tw, ry0 + j * tl, rx0 + (i + 1) * tw, ry0 + (j + 1) * tl, PAVE, c);
    }
  }
  lip(m, RUNWAY, TURF, PAVE, ASPHALT_DARK);
  // The taxiway (it meets the runway's edge and the apron's, so its own ends have no lip), and fillets where it joins the runway.
  for (let x = TAXIWAY.x - TAXIWAY.hx; x < TAXIWAY.x + TAXIWAY.hx - 1e-6; x += 6) {
    const xe = Math.min(TAXIWAY.x + TAXIWAY.hx, x + 6);
    for (const s of [-1, 1]) flat(m, x, TAXIWAY.y + (s < 0 ? -TAXIWAY.hy : 0), xe, TAXIWAY.y + (s < 0 ? 0 : TAXIWAY.hy), PAVE, shade(ASPHALT, 0.97 + 0.06 * hash(x, s, 4)));
  }
  side(m, TAXIWAY.x - TAXIWAY.hx + 6, TAXIWAY.y - TAXIWAY.hy, TAXIWAY.x + TAXIWAY.hx, TAXIWAY.y - TAXIWAY.hy, TURF, PAVE, ASPHALT_DARK);
  side(m, TAXIWAY.x + TAXIWAY.hx, TAXIWAY.y + TAXIWAY.hy, TAXIWAY.x - TAXIWAY.hx + 6, TAXIWAY.y + TAXIWAY.hy, TURF, PAVE, ASPHALT_DARK);
  const ex = RUNWAY.x + RUNWAY.hx;
  for (const s of [-1, 1]) {
    // A curved fillet between the runway's edge and the taxiway's, six metres each way.
    const y = TAXIWAY.y + s * TAXIWAY.hy;
    const n = 6;
    const pts: [number, number][] = [];
    for (let k = 0; k <= n; k++) {
      const a = (k / n) * (Math.PI / 2);
      pts.push([ex + 6 - 6 * Math.sin(a), y + s * (6 - 6 * Math.cos(a))]);
    }
    for (let k = 0; k < n; k++) {
      const [ax, ay] = pts[k]!;
      const [bx, by] = pts[k + 1]!;
      // A fan from the corner where the two edges meet.
      if (s > 0) m.triangles([ex, PAVE, -y, ax, PAVE, -ay, bx, PAVE, -by], shade(ASPHALT, 0.99));
      else m.triangles([ex, PAVE, -y, bx, PAVE, -by, ax, PAVE, -ay], shade(ASPHALT, 0.99));
      if (s > 0) side(m, bx, by, ax, ay, TURF, PAVE, ASPHALT_DARK);
      else side(m, ax, ay, bx, by, TURF, PAVE, ASPHALT_DARK);
    }
    // Its base, so nothing shows through.
    m.glow(0.8);
    if (s > 0) m.triangles([ex, BASE, -y, ex + 6, BASE, -y, ex, BASE, -(y + 6)], ASPHALT_DARK);
    else m.triangles([ex, BASE, -y, ex, BASE, -(y - 6), ex + 6, BASE, -y], ASPHALT_DARK);
    m.glow(1);
  }
  // The road in from the gate.
  for (let x = ENTRANCE.x - ENTRANCE.hx; x < ENTRANCE.x + ENTRANCE.hx - 1e-6; x += 4) {
    flat(m, x, ENTRANCE.y - ENTRANCE.hy, Math.min(ENTRANCE.x + ENTRANCE.hx, x + 4), ENTRANCE.y + ENTRANCE.hy, PAVE, shade(ASPHALT, 0.97 + 0.06 * hash(x, 6)));
  }
  side(m, ENTRANCE.x - ENTRANCE.hx, ENTRANCE.y - ENTRANCE.hy, ENTRANCE.x + ENTRANCE.hx, ENTRANCE.y - ENTRANCE.hy, TURF, PAVE, ASPHALT_DARK);
  side(m, ENTRANCE.x + ENTRANCE.hx, ENTRANCE.y + ENTRANCE.hy, ENTRANCE.x - ENTRANCE.hx, ENTRANCE.y + ENTRANCE.hy, TURF, PAVE, ASPHALT_DARK);

  // The apron and the launch pad: concrete slabs with joints between them (the base shows in the joints).
  const slabs = (r: Rect, size: number, salt: number, tint: (x: number, y: number) => number) => {
    const nx2 = Math.round((r.hx * 2) / size);
    const ny2 = Math.round((r.hy * 2) / size);
    const sx = (r.hx * 2) / nx2;
    const sy = (r.hy * 2) / ny2;
    const gap = 0.035;
    for (let j = 0; j < ny2; j++) {
      for (let i = 0; i < nx2; i++) {
        const ax = r.x - r.hx + i * sx + (i > 0 ? gap : 0);
        const ay = r.y - r.hy + j * sy + (j > 0 ? gap : 0);
        const bx = r.x - r.hx + (i + 1) * sx - (i < nx2 - 1 ? gap : 0);
        const by = r.y - r.hy + (j + 1) * sy - (j < ny2 - 1 ? gap : 0);
        const c = tint((ax + bx) / 2, (ay + by) / 2);
        flat(m, ax, ay, bx, by, PAVE, shade(c, 0.975 + 0.045 * hash(i, j, salt)));
      }
    }
    lip(m, r, TURF, PAVE, CONCRETE_JOINT);
  };
  slabs(APRON, 6, 11, () => CONCRETE);
  // The launch slab, scorched round its middle and down the flame trench.
  slabs(LAUNCH_SLAB, 2, 13, (x, y) => {
    const r = Math.hypot(x - LAUNCH_SLAB.x, y - LAUNCH_SLAB.y);
    const t = Math.max(0, 1 - r / 6.5) + (Math.abs(x - LAUNCH_SLAB.x) < 2.2 && y < LAUNCH_SLAB.y ? 0.35 : 0);
    return mixHex(CONCRETE, 0x5d5a57, Math.min(0.75, t * 0.7));
  });

  // The arena and the rover's track: beaten earth.
  m.glow(0.45);
  // (Rolled and swept: faint, broad variations, and the darker arcs of what's been driven on it.)
  const cells = d.fine ? 16 : 10;
  const arenaStep = (ARENA.hx * 2) / cells;
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const ax = ARENA.x - ARENA.hx + i * arenaStep;
      const ay = ARENA.y - ARENA.hy + j * arenaStep;
      const cx = ax + arenaStep / 2 - ARENA.x;
      const cy = ay + arenaStep / 2 - ARENA.y;
      const r = Math.hypot(cx, cy);
      const worn = Math.max(0, 1 - Math.abs(r - 9) / 2.2) * 0.05 + Math.max(0, 1 - Math.abs(r - 13.5) / 1.8) * 0.035;
      const c = shade(ARENA_EARTH, (0.985 + 0.03 * hash(Math.floor(i / 3), Math.floor(j / 3), 21)) * (1 - worn));
      m.triangles([ax, BASE, -ay, ax + arenaStep, BASE, -ay, ax + arenaStep, BASE, -(ay + arenaStep)], shade(c, 0.995 + 0.01 * hash(i, j, 22)));
      m.triangles([ax, BASE, -ay, ax + arenaStep, BASE, -(ay + arenaStep), ax, BASE, -(ay + arenaStep)], shade(c, 0.995 + 0.01 * hash(i, j, 24)));
    }
  }
  // The track: five strips across, the ruts darker, every sample shared by its neighbours (no cracks).
  {
    const rt = COURSE_ROUTE;
    const p = routeSample();
    const offsets = [-2.1, -1.45, -0.8, 0.8, 1.45, 2.1];
    const colors = [EARTH, EARTH_DARK, EARTH, EARTH_DARK, EARTH];
    const step = 0.8;
    const n = Math.ceil(rt.length / step);
    let prev: number[] | null = null;
    for (let i = 0; i <= n; i++) {
      sample(rt, (rt.length * i) / n, p);
      const nxv = -Math.sin(p.heading);
      const nyv = Math.cos(p.heading);
      const row = offsets.flatMap((o) => [p.x + nxv * o, p.y + nyv * o]);
      if (prev) {
        for (let k = 0; k < 5; k++) {
          const c = shade(colors[k]!, 0.95 + 0.08 * hash(i, k, 23));
          // Left of the route is +offset; quads wound counter-clockwise from above.
          quad4(m, prev[k * 2]!, prev[k * 2 + 1]!, row[k * 2]!, row[k * 2 + 1]!, row[k * 2 + 2]!, row[k * 2 + 3]!, prev[k * 2 + 2]!, prev[k * 2 + 3]!, BASE, c);
        }
      }
      prev = row;
    }
  }

  // ---------- paint ----------
  m.glow(1);
  for (const [a, b, c, e] of runwayPaint()) flat(m, a, b, c, e, PAINT, WHITE);
  if (d.fine) for (const [a, b, c, e] of rubberStreaks()) flat(m, a, b, c, e, PAINT, RUBBER);
  // The taxiway's centre line, from the apron to the runway, and its lead-off lines curving onto the runway's centre line.
  const south = ROUTES.south.exit;
  const north = ROUTES.north.exit;
  // (Each exit route: off the centre line, round onto the taxiway, along it, then across the apron to the tie-down.)
  routeLine(m, south, 0, south.length, 0.22, PAINT, YELLOW);
  routeLine(m, north, 0, 30, 0.22, PAINT, YELLOW);
  routeLine(m, TAXI_OUT, 0, TAXI_OUT.length, 0.22, PAINT, YELLOW);
  // The holding point: two solid lines on the taxiway's side, two dashed on the runway's.
  {
    const hx = HOLD_SHORT.x - 2.3;
    const [ya, yb] = [TAXIWAY.y - TAXIWAY.hy + 0.3, TAXIWAY.y + TAXIWAY.hy - 0.3];
    flat(m, hx - 0.15, ya, hx, yb, PAINT, YELLOW);
    flat(m, hx - 0.45, ya, hx - 0.3, yb, PAINT, YELLOW);
    for (let y = ya; y < yb - 0.1; y += 1.2) {
      flat(m, hx - 0.75, y, hx - 0.6, Math.min(yb, y + 0.7), PAINT, YELLOW);
      flat(m, hx - 1.05, y, hx - 0.9, Math.min(yb, y + 0.7), PAINT, YELLOW);
    }
  }
  // Tie-down spots: a ring and a bar across it where the nose wheel stops.
  for (const t of TIE_DOWNS) {
    ring(m, t.x, t.y, 1.1, 0.16, PAINT, YELLOW, d.fine ? 20 : 12);
    const c = Math.cos(t.heading);
    const s = Math.sin(t.heading);
    const [bx, by] = [t.x + c * 1.75, t.y + s * 1.75];
    quad4(m, bx - s * 0.9 - c * 0.08, by + c * 0.9 - s * 0.08, bx - s * 0.9 + c * 0.08, by + c * 0.9 + s * 0.08, bx + s * 0.9 + c * 0.08, by - c * 0.9 + s * 0.08, bx + s * 0.9 - c * 0.08, by - c * 0.9 - s * 0.08, PAINT, YELLOW);
  }
  // The apron's edge line, and the road's centre line in from the gate.
  {
    const [ax0, ax1, ay0, ay1] = [APRON.x - APRON.hx + 0.4, APRON.x + APRON.hx - 0.4, APRON.y - APRON.hy + 0.4, APRON.y + APRON.hy - 0.4];
    flat(m, ax0, ay0, ax1, ay0 + 0.15, PAINT, YELLOW);
    flat(m, ax0, ay1 - 0.15, ax1, ay1, PAINT, YELLOW);
    // (The west edge is open where the taxiway joins; the east where the road comes in.)
    flat(m, ax0, ay0 + 0.15, ax0 + 0.15, TAXIWAY.y - TAXIWAY.hy, PAINT, YELLOW);
    flat(m, ax0, TAXIWAY.y + TAXIWAY.hy, ax0 + 0.15, ay1 - 0.15, PAINT, YELLOW);
    flat(m, ax1 - 0.15, ay0 + 0.15, ax1, ENTRANCE.y - ENTRANCE.hy, PAINT, YELLOW);
    flat(m, ax1 - 0.15, ENTRANCE.y + ENTRANCE.hy, ax1, ay1 - 0.15, PAINT, YELLOW);
    for (let x = ENTRANCE.x - ENTRANCE.hx + 0.6; x < ENTRANCE.x + ENTRANCE.hx - 1.5; x += 3) flat(m, x, ENTRANCE.y - 0.08, x + 1.5, ENTRANCE.y + 0.08, PAINT, WHITE);
  }
  // The launch pad: a ring round the launcher, its slab's edge in yellow.
  ring(m, LAUNCH_SLAB.x, LAUNCH_SLAB.y, 5.6, 0.2, PAINT, YELLOW, d.fine ? 28 : 16);
  {
    const r = LAUNCH_SLAB;
    const [a0, a1, b0, b1] = [r.x - r.hx + 0.35, r.x + r.hx - 0.35, r.y - r.hy + 0.35, r.y + r.hy - 0.35];
    flat(m, a0, b0, a1, b0 + 0.2, PAINT, YELLOW);
    flat(m, a0, b1 - 0.2, a1, b1, PAINT, YELLOW);
    flat(m, a0, b0 + 0.2, a0 + 0.2, b1 - 0.2, PAINT, YELLOW);
    flat(m, a1 - 0.2, b0 + 0.2, a1, b1 - 0.2, PAINT, YELLOW);
  }
  // The flame trench, from the slab's edge to the deflector: a concrete channel under a steel grating (dark slots between its bars).
  {
    const t = FLAME_TRENCH;
    const channel: Rect = { x: t.x, y: (LAUNCH_SLAB.y - LAUNCH_SLAB.hy + FLAME_DEFLECTOR.y + FLAME_DEFLECTOR.hy) / 2, hx: t.hx + 0.5, hy: (LAUNCH_SLAB.y - LAUNCH_SLAB.hy - FLAME_DEFLECTOR.y - FLAME_DEFLECTOR.hy) / 2 };
    flat(m, channel.x - channel.hx, channel.y - channel.hy, channel.x + channel.hx, channel.y + channel.hy, PAVE, mixHex(CONCRETE, 0x5d5a57, 0.35));
    lip(m, channel, TURF, PAVE, CONCRETE_JOINT);
    for (let y = channel.y - channel.hy + 0.25; y < channel.y + channel.hy - 0.4; y += 0.5) flat(m, t.x - t.hx, y, t.x + t.hx, y + 0.28, PAINT, 0x403d3b);
  }
  // The arena: a white line round it and a cross at its middle.
  {
    const r = ARENA;
    const [a0, a1, b0, b1] = [r.x - r.hx + 0.5, r.x + r.hx - 0.5, r.y - r.hy + 0.5, r.y + r.hy - 0.5];
    const h = PAVE;
    flat(m, a0, b0, a1, b0 + 0.12, h, WHITE);
    flat(m, a0, b1 - 0.12, a1, b1, h, WHITE);
    flat(m, a0, b0 + 0.12, a0 + 0.12, b1 - 0.12, h, WHITE);
    flat(m, a1 - 0.12, b0 + 0.12, a1, b1 - 0.12, h, WHITE);
    flat(m, r.x - 1.5, r.y - 0.06, r.x + 1.5, r.y + 0.06, h, WHITE);
    flat(m, r.x - 0.06, r.y - 1.5, r.x - 0.06 + 0.12, r.y - 0.06, h, WHITE);
    flat(m, r.x - 0.06, r.y + 0.06, r.x - 0.06 + 0.12, r.y + 1.5, h, WHITE);
  }
  return m;
}

/** True where the ground is paved or painted (the tests: nothing static stands on paving but what's meant to). */
export const onPaving = (x: number, y: number): boolean => [RUNWAY, TAXIWAY, APRON, ENTRANCE, LAUNCH_SLAB].some((r) => within(r, x, y));
