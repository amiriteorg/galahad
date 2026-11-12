import { plainHabitat } from "../../apps/web/src/world/eco/habitat.ts";
import { CAUGHT, Ecosystem, emptyEnv, type Env } from "../../apps/web/src/world/eco/sim.ts";
import * as S from "../../apps/web/src/world/eco/species.ts";
import { type Caps, KIND_COUNT, KINDS, NO_CAPS } from "../../apps/web/src/world/eco/species.ts";
import { seasonOf } from "../../apps/web/src/world/season.ts";

/*
 * The ecosystem, run headless for simulated years on the made-up piece of country
 * its own tests use (a meadow, a round lake to the east, a wood to the north-west),
 * the way those tests run it: half-second steps, a day and a night every three
 * days of living, the season turning with the year. What its tests hold for one
 * seed, this measures over many.
 */

/** What each tier draws (docs/WORLD.md, "Budgets"). */
export const TIER_CAPS: Record<"low" | "medium" | "high", Caps> = {
  low: { ...NO_CAPS, roe: 2, hare: 3, fox: 1, hedgehog: 0, squirrel: 1, mallard: 3, swan: 0, heron: 1, fish: 4, songbird: 10, swallow: 0, starling: 24, goose: 5, kestrel: 1, owl: 0, bat: 2 },
  medium: { ...NO_CAPS, roe: 4, hare: 6, fox: 1, hedgehog: 1, squirrel: 2, mallard: 5, swan: 2, heron: 1, fish: 8, songbird: 24, swallow: 5, starling: 70, goose: 9, kestrel: 1, owl: 1, bat: 4 },
  high: { ...NO_CAPS, roe: 8, hare: 12, fox: 2, hedgehog: 2, squirrel: 4, mallard: 8, swan: 2, heron: 1, fish: 16, songbird: 48, swallow: 10, starling: 160, goose: 13, kestrel: 1, owl: 1, bat: 8 },
};

/** The sun for a run: how far through a day and night (0 midnight, 0.5 noon). */
export function sun(env: Env, day: number): void {
  env.night = Math.max(0, Math.min(1, 0.5 + Math.cos(day * Math.PI * 2) * 1.4 - 0.2));
  env.twilight = Math.max(0, 1 - Math.abs(env.night - 0.45) / 0.45);
  env.evening = day > 0.5 ? 1 : 0;
}

export interface WorldOptions {
  seed: number;
  /** Where in the year it starts (0 the new year, 0.45 midsummer's eve). */
  year?: number;
  arrivals?: number;
  yearDays?: number;
  reach?: number;
}

export function ecoWorld(caps: Caps, options: WorldOptions): { eco: Ecosystem; env: Env } {
  const eco = new Ecosystem(plainHabitat(), { caps, seed: options.seed, arrivals: options.arrivals, yearDays: options.yearDays, reach: options.reach });
  const env = emptyEnv();
  seasonOf(options.year ?? 0.45, env.season);
  sun(env, 0.5);
  return { eco, env };
}

/** Years at speed: half-second steps, `sample` called `perYear` times a year. Returns the steps taken. */
export function years(eco: Ecosystem, env: Env, n: number, start: number, sample: (year: number) => void, perYear = 2): number {
  const dt = 0.5;
  const steps = Math.round(eco.yearDays / eco.pace / dt);
  const every = Math.round(steps / perYear);
  const total = Math.round(n * steps);
  for (let step = 0; step < total; step++) {
    const year = start + step / steps;
    seasonOf(year % 1, env.season);
    sun(env, (eco.days / 3) % 1);
    eco.step(dt, env);
    if (step % every === every - 1) sample(year);
  }
  return total;
}

export const RESIDENTS = [S.ROE, S.HARE, S.FOX, S.MALLARD, S.SWAN, S.FISH, S.SONGBIRD] as const;

export interface YearOfLife {
  /** For each resident kind the tier has: the share of the year's samples in which at least one was there. */
  present: Record<string, number>;
  /** Kinds that were ever over what the tier may draw (its grown ones and half as many young again), or over their own slots. */
  overBounds: string[];
  births: number;
  /** A roe deer was caught (nothing eats one). */
  wronglyCaught: number;
  steps: number;
}

/** The whole cast of a tier through `n` years from spring, sampled twelve times a year. */
export function castThroughYears(tier: keyof typeof TIER_CAPS, seed: number, n: number): YearOfLife {
  const { eco, env } = ecoWorld(TIER_CAPS[tier], { seed, yearDays: 36, year: 0.3 });
  const seen = new Int32Array(KIND_COUNT);
  const over = new Set<string>();
  let samples = 0;
  const steps = years(
    eco,
    env,
    n,
    0.3,
    () => {
      samples++;
      for (let k = 0; k < KIND_COUNT; k++) {
        if (eco.count[k]! > eco.first[k + 1]! - eco.first[k]! || eco.count[k]! - eco.young[k]! > eco.grownCap[k]! + Math.ceil(eco.grownCap[k]! / 2) || eco.young[k]! < 0) over.add(KINDS[k]!);
        if (eco.count[k]! > 0) seen[k] = seen[k]! + 1;
      }
    },
    12,
  );
  const present: Record<string, number> = {};
  for (const k of RESIDENTS) if (eco.grownCap[k]! > 0) present[KINDS[k]!] = seen[k]! / samples;
  return { present, overBounds: [...over], births: [...eco.births].reduce((a, b) => a + b, 0), wronglyCaught: eco.deaths[CAUGHT]![S.ROE]!, steps };
}

export interface FoxAndHare {
  hares: number[];
  foxes: number[];
  /** How the foxes' numbers go with the hares' change over the following year (a predator's sign: negative). */
  tied: number;
  /** Hares that died caught, and otherwise. */
  caught: number;
  otherwise: number;
}

/** The hare and the fox alone, as the ecosystem's own test sets them up, for `n` years (two samples a year). */
export function foxAndHare(seed: number, n: number): FoxAndHare {
  const { eco, env } = ecoWorld({ ...NO_CAPS, hare: 60, fox: 8 }, { seed, yearDays: 36, reach: 150, arrivals: 0.1 });
  const hares: number[] = [];
  const foxes: number[] = [];
  years(eco, env, n, 0.3, () => {
    hares.push(eco.count[S.HARE]!);
    foxes.push(eco.count[S.FOX]!);
  });
  const mean = (a: number[]): number => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
  const change = hares.slice(2).map((h, i) => h - hares[i]!);
  const over = foxes.slice(1, -1);
  const mc = mean(change);
  const mf = mean(over);
  let both = 0;
  let cc = 0;
  let ff = 0;
  for (let i = 0; i < change.length; i++) {
    both += (change[i]! - mc) * (over[i]! - mf);
    cc += (change[i]! - mc) ** 2;
    ff += (over[i]! - mf) ** 2;
  }
  return { hares, foxes, tied: cc * ff > 0 ? both / Math.sqrt(cc * ff) : 0, caught: eco.deaths[CAUGHT]![S.HARE]!, otherwise: eco.deaths[0]![S.HARE]! + eco.deaths[1]![S.HARE]! };
}

/**
 * What the ecosystem's own test asks of the fox and the hare over eighteen years, as a list of what failed
 * (empty: all of it held). The test holds this for one seed; here it can be asked of any.
 */
export function cycleFailures(r: FoxAndHare): string[] {
  const { hares, foxes } = r;
  const mean = (a: number[]): number => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
  const failed: string[] = [];
  if (Math.max(...hares) > 90) failed.push("hares over 90");
  if (Math.max(...foxes) > 12) failed.push("foxes over 12");
  if (!(hares.at(-1)! > 0)) failed.push("no hares at the end");
  if (!(foxes.at(-1)! > 0)) failed.push("no foxes at the end");
  if (!(Math.max(...hares) > 55)) failed.push("hares never above 55");
  if (!(Math.min(...hares) < Math.max(...hares) * 0.5)) failed.push("hares never fell by half");
  if (!(Math.max(...foxes) >= 9)) failed.push("foxes never reached 9");
  if (!(Math.min(...foxes) <= 4)) failed.push("foxes never fell to 4");
  if (!(r.tied < -0.2)) failed.push(`not tied as predator and prey (r = ${r.tied.toFixed(2)})`);
  const low = hares.indexOf(Math.min(...hares));
  if (!(mean(foxes.slice(Math.max(0, low - 4), low + 1)) >= 6)) failed.push("the hares' low didn't come under many foxes");
  if (!(r.caught > r.otherwise)) failed.push("most hares that died weren't caught");
  return failed;
}
