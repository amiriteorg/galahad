import type { SandboxNetwork } from "@galahad/core";
import { ENGINEERING_SUITE } from "@galahad/brain";
import type { Tryable } from "./trial-cli.ts";

/*
 * The suites a run can be made from. A suite says what it is, lists its problems, and
 * chooses the ones a run names; how one trial of a problem is done and graded is the
 * problem's own (trial-cli.ts Tryable).
 */

export interface SuiteInfo {
  id: string;
  /** What it measures, in a line. */
  about: string;
  /** Where its trials are worked, for the run's first line. */
  where: string;
  /** The network a run uses unless you say otherwise, and the ones it may. */
  network: SandboxNetwork;
  networks: readonly SandboxNetwork[];
  /** Whether its problems have a difficulty you can turn (`--level`). */
  levels?: { min: number; max: number; usual: number };
  /** Every problem, as `galahad trial problems` lists them. */
  list(level?: number): { id: string; domain: string; title: string }[];
  /** The problems a run would pose: all of them, or those named (by id or domain). Throws with what's unknown. */
  choose(names: readonly string[], level?: number): Tryable[];
}

/** Those named, by id or domain; all when none is named. */
export function named<T extends { id: string; domain: string }>(all: readonly T[], names: readonly string[], suite: string): T[] {
  if (!names.length) return [...all];
  const unknown = names.filter((n) => !all.some((p) => p.id === n || p.domain === n));
  if (unknown.length) throw new Error(`no such problem or domain: ${unknown.join(", ")} (galahad trial problems --suite ${suite} lists them)`);
  return all.filter((p) => names.includes(p.id) || names.includes(p.domain));
}

const engineering: SuiteInfo = {
  id: "engineering",
  about: "fourteen mathematics, physics and engineering problems with exact answers",
  where: "in the Lab",
  network: "gateway",
  networks: ["gateway", "online"],
  list: () => ENGINEERING_SUITE.map((p) => ({ id: p.id, domain: p.domain, title: p.title })),
  choose: (names) => named(ENGINEERING_SUITE, names, "engineering"),
};

export const TRIAL_SUITES: Record<string, SuiteInfo> = { engineering };

export function suiteNamed(id: string): SuiteInfo {
  const suite = TRIAL_SUITES[id];
  if (!suite) throw new Error(`no trial suite "${id}" (there is: ${Object.keys(TRIAL_SUITES).join(", ")})`);
  return suite;
}
