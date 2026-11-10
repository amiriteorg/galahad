/*
 * Deterministic noise for the SANDBOX's terrain, written here (no library): an
 * integer hash, value noise and 2D simplex noise, all seeded, so the same seed
 * grows the same world on every device, forever.
 */

/** A 32-bit hash of a seed and integer coordinates, in [0, 1). */
export function hash2(seed: number, x: number, y: number): number {
  let h = (seed | 0) ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** A hash of three integers (a feature's seed, cell and slot), in [0, 1). */
export const hash3 = (seed: number, x: number, y: number, z: number): number => hash2(seed ^ Math.imul(z | 0, 0x9e3779b1), x, y);

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

/** Smooth value noise in [-1, 1]. */
export function valueNoise(seed: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const u = fade(x - x0);
  const v = fade(y - y0);
  const a = hash2(seed, x0, y0);
  const b = hash2(seed, x0 + 1, y0);
  const c = hash2(seed, x0, y0 + 1);
  const d = hash2(seed, x0 + 1, y0 + 1);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
/** Twelve gradient directions, evenly around the circle. */
const GRAD = Array.from({ length: 12 }, (_, i) => [Math.cos((i / 12) * Math.PI * 2), Math.sin((i / 12) * Math.PI * 2)] as const);

function corner(seed: number, i: number, j: number, x: number, y: number): number {
  const t = 0.5 - x * x - y * y;
  if (t <= 0) return 0;
  const g = GRAD[Math.floor(hash2(seed, i, j) * 12)]!;
  const t2 = t * t;
  return t2 * t2 * (g[0] * x + g[1] * y);
}

/** 2D simplex noise in about [-1, 1]. */
export function simplex(seed: number, x: number, y: number): number {
  const s = (x + y) * F2;
  const i = Math.floor(x + s);
  const j = Math.floor(y + s);
  const t = (i + j) * G2;
  const x0 = x - (i - t);
  const y0 = y - (j - t);
  const [i1, j1] = x0 > y0 ? [1, 0] : [0, 1];
  const x1 = x0 - i1 + G2;
  const y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2;
  const y2 = y0 - 1 + 2 * G2;
  return 70 * (corner(seed, i, j, x0, y0) + corner(seed, i + i1, j + j1, x1, y1) + corner(seed, i + 1, j + 1, x2, y2));
}

/** Fractal sum of simplex octaves, normalised to about [-1, 1]. */
export function fbm(seed: number, x: number, y: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * simplex(seed + o * 1013, x * f, y * f);
    norm += amp;
    amp *= gain;
    f *= lacunarity;
  }
  return sum / norm;
}

export const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
