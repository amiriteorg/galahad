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

/** The Index of the trials run at one effort level. */
export interface EffortIndex {
  /** Attempts per trial (1: one engineer in one sandbox). */
  effort: number;
  mean: number;
  low: number;
  high: number;
  /** Scored trials (crashed ones say nothing about ability), and the runs they came from. */
  n: number;
  runs: number;
}

const percent = (x: number): string => `${(100 * x).toFixed(0)}%`;

/**
 * The Index per effort level, and whether more effort measurably helped: a level "wins" only
 * if its interval clears effort 1's (the same rule as any change). `efforts` says which runs
 * ran at more than effort 1 (a run it doesn't name ran at 1). When more effort didn't
 * measurably help, the verdict says so.
 */
export function effortReport(
  trials: readonly { run: string; status: string; score: number }[],
  efforts: Readonly<Record<string, number>>,
): { levels: EffortIndex[]; helps: boolean | null; verdict: string } {
  const byLevel = new Map<number, { scores: number[]; runs: Set<string> }>();
  for (const t of trials) {
    if (t.status !== "scored") continue;
    const effort = efforts[t.run] ?? 1;
    const level = byLevel.get(effort) ?? { scores: [], runs: new Set<string>() };
    level.scores.push(t.score);
    level.runs.add(t.run);
    byLevel.set(effort, level);
  }
  const levels = [...byLevel.entries()]
    .sort(([a], [b]) => a - b)
    .map(([effort, level]) => ({ effort, ...galahadIndex(level.scores), runs: level.runs.size }));
  const base = levels.find((l) => l.effort === 1);
  const top = [...levels].reverse().find((l) => l.effort > 1);
  if (!base || !top || base.n < 2 || top.n < 2) {
    return { levels, helps: null, verdict: "Not measured at more than one effort level yet: galahad trial run --effort 3 (and one at --effort 1) to see whether more compute helps." };
  }
  const said = (l: EffortIndex) => `${percent(l.mean)} (${percent(l.low)}–${percent(l.high)}, ${l.n} trials)`;
  if (top.low > base.high) return { levels, helps: true, verdict: `More effort measurably helps: effort ${top.effort} scores ${said(top)} against ${said(base)} at effort 1, and the intervals don't overlap.` };
  if (top.high < base.low) return { levels, helps: false, verdict: `More effort measurably hurt: effort ${top.effort} scores ${said(top)} against ${said(base)} at effort 1.` };
  return { levels, helps: false, verdict: `No measurable difference: effort ${top.effort} scores ${said(top)} against ${said(base)} at effort 1, and the intervals overlap. More compute hasn't been shown to help on this suite.` };
}
