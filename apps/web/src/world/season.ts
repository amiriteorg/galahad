/*
 * The season in the SANDBOX: Denmark's, by the real date (never the device's
 * zone), as everything that grows and lives reads it. Not four switches but a
 * year that turns: each season's weight rises and falls over weeks, and with
 * them how far the trees are in leaf, how much is in flower, how far the leaves
 * have turned and how many have fallen. The land, what grows on it, the animals
 * and the sky all read the one `seasonState` (the scene keeps it to the date, or
 * to a season you chose to look at), so they agree.
 *
 * Pure (seasonAt, seasonFor) and allocation-free (written into a reused object),
 * so unit-tested.
 */

export type SeasonName = "winter" | "spring" | "summer" | "autumn";
export const SEASONS: readonly SeasonName[] = ["winter", "spring", "summer", "autumn"];

/** What the HUD offers: the real season, or one to look at. */
export type SeasonChoice = "live" | SeasonName;

export interface Season {
  /** The season it mostly is. */
  name: SeasonName;
  /** How far through the year (0 on 1 January, to 1). */
  year: number;
  /** Each season's weight, 0..1; they sum to 1 and cross over weeks. */
  winter: number;
  spring: number;
  summer: number;
  autumn: number;
  /** Trees in leaf: 0 bare (deep winter) to 1 full (late May to September). */
  leaf: number;
  /** In flower: 0 none to 1 the height of it (May to July); a little again for the heather in late August. */
  bloom: number;
  /** Leaves turned gold and red: 0 green to 1 the height of autumn (mid October). */
  turn: number;
  /** Leaves on the ground: 0 none to 1 the most (November), gone by spring. */
  litter: number;
  /** How alive the small things are (insects, frogs, new growth): 0 dormant (winter) to 1 midsummer. */
  vigour: number;
}

const DAY = 86_400_000;
const PARTS = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit" });

/** How far through its year an instant is, by Denmark's date (0 at the start of 1 January, to 1). */
export function yearFraction(now: number): number {
  let y = 1970;
  let m = 1;
  let d = 1;
  for (const part of PARTS.formatToParts(now)) {
    if (part.type === "year") y = Number(part.value);
    else if (part.type === "month") m = Number(part.value);
    else if (part.type === "day") d = Number(part.value);
  }
  const start = Date.UTC(y, 0, 1);
  const length = (Date.UTC(y + 1, 0, 1) - start) / DAY;
  // (The middle of the day, so the fraction doesn't jump at a zone's midnight.)
  return ((Date.UTC(y, m - 1, d) - start) / DAY + 0.5) / length;
}

const clamp = (x: number): number => Math.max(0, Math.min(1, x));
const smooth = (lo: number, hi: number, x: number): number => {
  const t = clamp((x - lo) / (hi - lo));
  return t * t * (3 - 2 * t);
};
/** Rising over [a, b], full until c, falling over [c, d] (fractions of the year). */
const window = (a: number, b: number, c: number, d: number, x: number): number => smooth(a, b, x) * (1 - smooth(c, d, x));
/** The distance between two fractions of the year, round the year's end. */
const apart = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 1;
  return d > 0.5 ? 1 - d : d;
};

/** Each season's middle (a fraction of the year): mid January, mid April, mid July, mid October. */
const MIDDLE: Record<SeasonName, number> = { winter: 15 / 365, spring: 105 / 365, summer: 196 / 365, autumn: 288 / 365 };
/** A season is felt this far either side of its middle (a fraction of the year: about ten weeks). */
const REACH = 70 / 365;

/** The season at a fraction of the year, into `out`. */
export function seasonOf(year: number, out: Season = emptySeason()): Season {
  const y = ((year % 1) + 1) % 1;
  let total = 0;
  let best: SeasonName = "winter";
  let most = -1;
  for (const s of SEASONS) {
    const w = Math.cos((Math.PI / 2) * Math.min(1, apart(y, MIDDLE[s]) / REACH)) ** 2;
    out[s] = w;
    total += w;
    if (w > most) {
      most = w;
      best = s;
    }
  }
  for (const s of SEASONS) out[s] /= total;
  out.name = best;
  out.year = y;
  // Buds break in April and the crowns are full by late May; they thin through October and are bare by early December.
  out.leaf = window(95 / 365, 145 / 365, 275 / 365, 338 / 365, y);
  // Flowers from late April, their height in June, over by September; the heather a little, late in August.
  out.bloom = Math.max(window(110 / 365, 150 / 365, 190 / 365, 250 / 365, y), 0.45 * window(215 / 365, 235 / 365, 250 / 365, 275 / 365, y));
  // The leaves turn from mid September, are at their height in mid October, and what's left in November is still gold.
  out.turn = window(255 / 365, 290 / 365, 325 / 365, 362 / 365, y);
  // They fall through October and November and lie until the spring.
  out.litter = y < 0.5 ? 1 - smooth(60 / 365, 110 / 365, y) : smooth(275 / 365, 325 / 365, y);
  // The small things: stirring in March, at their height from June to August, quiet by November.
  out.vigour = window(70 / 365, 160 / 365, 240 / 365, 315 / 365, y);
  return out;
}

/** The season now, by Denmark's date, into `out`. */
export function seasonAt(now: number, out: Season = emptySeason()): Season {
  return seasonOf(yearFraction(now), out);
}

/** The season the HUD's choice shows: the real one, or the middle of the one chosen. */
export function seasonFor(choice: SeasonChoice, now: number, out: Season = emptySeason()): Season {
  return choice === "live" ? seasonAt(now, out) : seasonOf(MIDDLE[choice], out);
}

export function emptySeason(): Season {
  return { name: "summer", year: 0.5, winter: 0, spring: 0, summer: 1, autumn: 0, leaf: 1, bloom: 1, turn: 0, litter: 0, vigour: 1 };
}

/**
 * The season everything in the world reads this frame (the scene writes it: the real date's, or the one chosen to
 * look at, eased so a change of choice doesn't snap). One object for the whole page: never keep a copy.
 */
export const seasonState: Season = emptySeason();
