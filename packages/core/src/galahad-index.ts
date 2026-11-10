/*
 * The Galahad Index, and the seeded generator trials pose their problems with.
 * No dependencies (no zod): the PWA imports this directly (@galahad/core/galahad-index),
 * so the CLI, the PWA and every node compute the same number from the same scores.
 */

/** mulberry32: small, fast, and the same everywhere. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The Galahad Index for a set of trials: the mean score with a 90 % percentile
 * bootstrap interval (seeded, so the same scores always give the same interval).
 * A change "wins" only if its interval clears the incumbent's.
 */
export function galahadIndex(scores: readonly number[], resamples = 2000): { mean: number; low: number; high: number; n: number } {
  const n = scores.length;
  if (!n) return { mean: 0, low: 0, high: 0, n: 0 };
  const mean = scores.reduce((s, x) => s + x, 0) / n;
  if (n === 1) return { mean, low: mean, high: mean, n };
  const rng = seededRandom(0x9e3779b9);
  const means: number[] = [];
  for (let r = 0; r < resamples; r++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += scores[Math.floor(rng() * n)]!;
    means.push(sum / n);
  }
  means.sort((a, b) => a - b);
  return { mean, low: means[Math.floor(0.05 * (resamples - 1))]!, high: means[Math.ceil(0.95 * (resamples - 1))]!, n };
}
