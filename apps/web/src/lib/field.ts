/*
 * Galahad's field: lines of force looping from pole to pole round a dark core, lit from the upper left and burning at
 * the rim on the far side (your choice for the app icon, 26 November 2026: "field aurum"). Pure: points in space with
 * a colour and a size, and their place on a square picture. The icon's renderer (scripts/field-icon.ts) draws them as
 * light; the same points will make Galahad's orb in the apps.
 */

/** A colour in linear light (not sRGB): 0 to 1 and beyond, before tone mapping. */
export type Rgb = [number, number, number];

/** sRGB hex to linear light, as three.js reads a colour. */
export function linear(hex: string): Rgb {
  const channel = (at: number) => {
    const c = parseInt(hex.slice(at, at + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return [channel(1), channel(3), channel(5)];
}

/** A field's colours: its key light (the lit face, bright then deep) and the rim burning on its far side. */
export interface FieldColours {
  key: [string, string];
  rim: string;
}

/** Gold and copper: the Grail's fire. */
export const AURUM: FieldColours = { key: ["#fff4d6", "#ffb12e"], rim: "#ff5a2a" };

/** One point of light: where it is (the field's own units, the core at 0), its colour and its size. */
export interface FieldPoint {
  x: number;
  y: number;
  z: number;
  rgb: Rgb;
  size: number;
}

export interface FieldOptions {
  /** How many lines: more is denser. */
  lines?: number;
  /** Points along each line. */
  steps?: number;
  /** The field's lean (radians, about x, y and z in turn, as three.js turns an Euler). */
  tilt?: [number, number, number];
  /** A turn about the field's own axis (radians): the field turning. */
  turn?: number;
  /** Bolder points (1: as chosen). */
  weight?: number;
  colours?: FieldColours;
  seed?: number;
}

type V3 = [number, number, number];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
/** Rotate by an XYZ Euler (three.js' default order: the matrix Rx·Ry·Rz applied to the point). */
function euler(v: V3, [ax, ay, az]: [number, number, number]): V3 {
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(ax), Math.sin(ax), Math.cos(ay), Math.sin(ay), Math.cos(az), Math.sin(az)];
  // Rz
  let [x, y, z] = [v[0] * cz - v[1] * sz, v[0] * sz + v[1] * cz, v[2]];
  // Ry
  [x, z] = [x * cy + z * sy, -x * sy + z * cy];
  // Rx
  [y, z] = [y * cx - z * sx, y * sx + z * cx];
  return [x, y, z];
}

const KEY = norm([-0.55, 0.58, 0.6]);
const RIM = norm([0.8, -0.45, -0.35]);

/** A point's colour by the key light on it and the rim light behind it, and how strongly it is lit (0 to 1). */
export function shade(n: V3, colours: FieldColours): { rgb: Rgb; k: number } {
  const lit = Math.pow(Math.max(0, dot(n, KEY)), 1.2);
  const facing = Math.max(0, n[2]);
  const rimK = Math.pow(1 - facing, 2.4) * Math.max(0, dot(n, RIM) + 0.25);
  const deep = linear(colours.key[1]), bright = linear(colours.key[0]), rim = linear(colours.rim);
  const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  let c: Rgb = [deep[0] * 0.12, deep[1] * 0.12, deep[2] * 0.12];
  c = mix(c, deep, Math.min(1, lit * 1.5));
  c = mix(c, bright, Math.max(0, lit - 0.4) * 1.7);
  const k = Math.max(lit, rimK), gain = 0.12 + 1.9 * k;
  return { rgb: [(c[0] + rim[0] * rimK * 2.2) * gain, (c[1] + rim[1] * rimK * 2.2) * gain, (c[2] + rim[2] * rimK * 2.2) * gain], k };
}

/** The same random numbers every time (Park and Miller's), so a field is the same picture on every machine. */
function random(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** The field's points: each line a loop from pole to pole (a dipole's, r = L·sin²θ) at its own longitude and width. */
export function fieldPoints(options: FieldOptions = {}): FieldPoint[] {
  const { lines = 46, steps = 260, tilt = [0.42, 0.3, -0.18], turn = 0, weight = 1, colours = AURUM, seed = 11 } = options;
  const rnd = random(seed);
  const points: FieldPoint[] = [];
  for (let line = 0; line < lines; line++) {
    const phi = (line / lines) * Math.PI * 2 + rnd() * 0.12 + turn;
    const width = 1.05 + 0.75 * Math.pow(rnd(), 0.7);
    for (let j = 1; j < steps; j++) {
      const th = (j / steps) * Math.PI, r = width * Math.sin(th) ** 2;
      if (r < 0.32) continue;
      const v = euler([r * Math.sin(th) * Math.cos(phi), r * Math.cos(th), r * Math.sin(th) * Math.sin(phi)], tilt);
      const { rgb, k } = shade(norm(v), colours);
      if (k < 0.02) continue;
      const near = Math.min(1, 1.9 / (0.6 + r)), g = 0.35 + 0.65 * near;
      points.push({ x: v[0] * 1.05, y: v[1] * 1.05, z: v[2] * 1.05, rgb: [rgb[0] * g, rgb[1] * g, rgb[2] * g], size: (0.009 + 0.02 * k) * weight });
    }
  }
  return points;
}

/** Where a point falls on a square picture `size` across, seen from a camera on the z axis (as the icon is drawn):
 * its pixel position, its diameter in pixels, and whether it is in front of the camera at all. */
export function project(p: FieldPoint, size: number, { fov = 28, distance = 8.3, zoom = 1 } = {}): { x: number; y: number; d: number; visible: boolean } {
  const depth = distance - p.z;
  const f = (size / 2 / Math.tan(((fov / 2) * Math.PI) / 180)) * zoom;
  return { x: size / 2 + (p.x * f) / depth, y: size / 2 - (p.y * f) / depth, d: (p.size * (size / 2) * zoom) / depth, visible: depth > 0.1 };
}
