import type { Insects } from "./insects.ts";
import type { Ecosystem } from "./sim.ts";
import * as S from "./species.ts";
import { DOING, INSECT_DOING, INSECT_NAMES, KIND_COUNT, KINDS, SPECS } from "./species.ts";

/*
 * The ecosystem in words: what an animal is and what it's doing (the hover
 * label), and who's about now, how many, and what most of them are at (for the
 * HUD). Pure; the summary is written into an object it's handed, so asking for
 * it every second costs nothing to speak of.
 */

/** One kind that's about now. */
export interface EcoLine {
  /** Its key ("roe", "bumblebee"). */
  kind: string;
  /** As it's said: "Roe deer". */
  name: string;
  count: number;
  /** Of those, how many are this year's young. */
  young: number;
  /** What most of them are doing: "grazing". */
  doing: string;
}

export interface EcoSummary {
  /** Who's about, the most numerous last (the big animals first, then the birds, then the insects). */
  lines: EcoLine[];
  /** Animals in all (not the insects). */
  animals: number;
  /** Since the page was opened: born here, died (of hunger and age, and caught), come in from beyond and gone off. */
  births: number;
  deaths: number;
  caught: number;
  came: number;
  left: number;
}

export const emptySummary = (): EcoSummary => ({ lines: [], animals: 0, births: 0, deaths: 0, caught: 0, came: 0, left: 0 });

/** What an animal is and is doing: "Roe deer · grazing", "Leveret · staying by its mother". */
export function labelOf(eco: Ecosystem, slot: number): string {
  const k = eco.kind[slot]!;
  const spec = SPECS[k]!;
  const young = eco.age[slot]! < spec.grown;
  let doing: string = DOING[eco.doing[slot]!] ?? "";
  // Said as it looks: a bird in a tree at night is roosting, a sitting swan is on the water.
  if (k === S.ROE && eco.doing[slot] === S.WALK && eco.speed[slot]! > spec.walk * 1.4) doing = "moving off";
  if (spec.realm === S.WATER && (eco.doing[slot] === S.FOLLOW || eco.doing[slot] === S.STAND)) doing = young ? "behind its mother" : "on the water";
  if (spec.realm === S.WATER && eco.doing[slot] === S.FLEE) doing = "making for the water";
  if (k === S.FISH && (eco.doing[slot] === S.SWIM || eco.doing[slot] === S.FLEE)) doing = eco.doing[slot] === S.FLEE ? "darting off" : "in its shoal";
  if (k === S.HERON && eco.doing[slot] === S.SLEEP) doing = "asleep on one leg";
  if (k === S.OWL && eco.doing[slot] === S.GLIDE) doing = "hunting, low and silent";
  return `${young ? spec.young : spec.name} · ${doing}`;
}

const tally = new Int32Array(DOING.length);

/** Who's about now, into `out`. */
export function summarise(eco: Ecosystem, insects: Insects | null, out: EcoSummary = emptySummary()): EcoSummary {
  let n = 0;
  const line = (kind: string, name: string, count: number, young: number, doing: string): void => {
    const l = (out.lines[n] ??= { kind: "", name: "", count: 0, young: 0, doing: "" });
    n++;
    l.kind = kind;
    l.name = name;
    l.count = count;
    l.young = young;
    l.doing = doing;
  };
  out.animals = 0;
  out.births = 0;
  out.deaths = 0;
  out.caught = 0;
  out.came = 0;
  out.left = 0;
  for (let k = 0; k < KIND_COUNT; k++) {
    out.births += eco.births[k]!;
    out.deaths += eco.deaths[0]![k]! + eco.deaths[1]![k]! + eco.deaths[2]![k]!;
    out.caught += eco.deaths[2]![k]!;
    out.came += eco.came[k]!;
    out.left += eco.left[k]!;
    tally.fill(0);
    let count = 0;
    let young = 0;
    const spec = SPECS[k]!;
    for (let i = eco.first[k]!; i < eco.first[k + 1]!; i++) {
      // (Only those that can be seen: a hedgehog under its bush isn't about.)
      if (!eco.alive[i] || eco.going[i] || eco.shown[i]! < 0.5) continue;
      count++;
      if (eco.age[i]! < spec.grown) young++;
      tally[eco.doing[i]!] = tally[eco.doing[i]!]! + 1;
    }
    if (!count) continue;
    out.animals += count;
    let most = 0;
    for (let d = 1; d < tally.length; d++) if (tally[d]! > tally[most]!) most = d;
    line(KINDS[k]!, spec.name, count, young, DOING[most]!);
  }
  if (insects) {
    for (let k = 0; k < insects.count.length; k++) if (insects.count[k]! > 0) line(INSECT_NAMES[k]!.toLowerCase(), INSECT_NAMES[k]!, insects.count[k]!, 0, INSECT_DOING[k]!);
    if (insects.fireflyLevel > 0.3 && insects.fireflies) line("firefly", INSECT_NAMES[S.FIREFLY]!, insects.fireflies, 0, insects.inStep() > 0.5 ? "flashing in step" : INSECT_DOING[S.FIREFLY]!);
  }
  out.lines.length = n;
  return out;
}

/** The summary as one line: "Roe deer 4 (1 young) grazing · Hare 7 resting · …". */
export function summaryText(s: EcoSummary): string {
  return s.lines.map((l) => `${l.name} ${l.count}${l.young ? ` (${l.young} young)` : ""} ${l.doing}`).join(" · ");
}
