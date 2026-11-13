import { type ScoreMetric, Scorecard } from "../../packages/core/src/scorecard.ts";

/*
 * What the browser suite (world-scale.ts) leaves for the scorecard, and which browser it drives: the parts
 * of the runner that need neither a browser nor a GPU, so they can be held to the scorecard's contract by a
 * test. The runner itself is a script that starts a node and a browser as soon as it is imported.
 */

/** The world's own seed (relief.ts' SEED): the land every run draws. The ecosystem's dice have a fixed seed of their own (fauna.ts). */
export const LAND_SEED = 0x6a1a4ad;
/** Both seeds in words, for the raw record beside the scorecard. */
export const SEEDS = "land 0x6a1a4ad (relief.ts' SEED), ecosystem 0x5eed (fauna.ts)";

const round = (v: number, digits = 3): number => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};

/** One measured value as the scorecard keeps it; null for what isn't a number. A count of samples is said only when there were some. */
export function metricOf(id: string, value: number, unit: string, better: ScoreMetric["better"], extra: Partial<Pick<ScoreMetric, "n" | "note" | "spread">> = {}): ScoreMetric | null {
  if (!Number.isFinite(value)) return null;
  const { n, ...rest } = extra;
  return { id, value: round(value), unit, kind: "speed", better, ...rest, ...(n !== undefined && n >= 1 ? { n } : {}) };
}

/** The suite's scorecard, checked against the contract before it is written: a result `bun run bench` can't read is refused here, by the runner that made it. */
export function worldScaleCard(head: { commit: string; at: number; machine: Scorecard["machine"] }, metrics: ScoreMetric[]): Scorecard {
  return Scorecard.parse({ suite: "world-scale", commit: head.commit, at: head.at, seed: LAND_SEED, machine: head.machine, metrics });
}

/** Where to look for a browser to drive, in order: the one named (EDGE, as the suite always took it, or GALAHAD_BROWSER, as scripts/brand.ts does), then Edge and Chrome where the platform keeps them. */
export function browserCandidates(platform: NodeJS.Platform, env: { EDGE?: string; GALAHAD_BROWSER?: string }): string[] {
  const named = [env.EDGE, env.GALAHAD_BROWSER].filter((path): path is string => Boolean(path));
  const usual =
    platform === "win32" ? ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe"]
    : platform === "darwin" ? ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
    : ["/usr/bin/microsoft-edge", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  return [...named, ...usual];
}
