/*
 * His day, when there's no work. From the real time in Denmark and a seed, a plan of
 * what he does: woken by the dog, his morning rounds of the keep, a walk with the
 * dog, visiting his friends (the Microducks), reading at the library, the workshop,
 * the proving ground, the council table with Reachy Mini, the board at the
 * observatory, thinking on the bench by the lake, fetch at noon, a walk at sunset,
 * the evening by the fire, his journal at his desk, and asleep at his hearth with
 * the dog beside him. Every device computes the same plan for the same moment (it
 * reads Denmark's clock, never the device's zone), so he's doing the same thing
 * wherever you watch from; and the node reads the same plan when he writes his
 * journal (`dayLog`), so what he recollects is what the world showed.
 *
 * Work always comes first: the scene asks `intentFor` what he does now, and work
 * (then something that needs you, then the dog's battery) beats the plan. When the
 * work is done he picks his day up where it would be: the plan is a function of the
 * time, so it's simply the block for now.
 *
 * Pure: no three.js, nothing per frame. `lifeAt` allocates only its result; the
 * scene asks it once a block (or when work ends), never every frame.
 */

export type Activity = "sleep" | "wake" | "rounds" | "walk" | "walk-dog" | "friends" | "library" | "workshop" | "field" | "council" | "observatory" | "ponder" | "hearth" | "journal";

export const ACTIVITIES: readonly Activity[] = ["sleep", "wake", "rounds", "walk", "walk-dog", "friends", "library", "workshop", "field", "council", "observatory", "ponder", "hearth", "journal"];

/** What the world says he's doing, in a few words (the selector's line, his bubble, his journal). "the dog" is its name once it has one (`withDog`). */
export const ACTIVITY_LABEL: Record<Activity, string> = {
  sleep: "Asleep at his hearth, the dog beside him",
  wake: "Woken by the dog",
  rounds: "Morning rounds",
  walk: "Out for a walk with the dog",
  "walk-dog": "Playing fetch with the dog",
  friends: "Visiting the Microducks",
  library: "Reading at the library",
  workshop: "Looking in on the workshop",
  field: "Looking after the proving ground",
  council: "Talking with Reachy at the council table",
  observatory: "By the board at the observatory",
  ponder: "Thinking by the lake, the dog at his feet",
  hearth: "By the fire with the dog",
  journal: "Writing his journal",
};

/** Under reduced motion he stays put: what the world says then. */
export const STILL_LABEL = "Resting on the deck";

/** A line about him with the dog's name in it, once you've named it ("Out for a walk with Bors"). */
export function withDog(line: string, name?: string | null): string {
  const n = name?.trim();
  return n ? line.replace(/\b[Tt]he dog\b/g, n) : line;
}

/** One block of his day: an activity from `start` to `end` (ms). */
export interface Block {
  activity: Activity;
  start: number;
  end: number;
}

/** The seed every device uses: the same day everywhere. */
export const LIFE_SEED = 0x6a1ad;

const MIN = 60_000;
const DAY_MIN = 24 * 60;

/** A small fast generator from a 32-bit seed (mulberry32). */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seed for a day: its date and the world's seed, mixed. */
function daySeed(day: string, seed: number): number {
  let h = seed ^ 0x9e3779b9;
  for (let i = 0; i < day.length; i++) h = Math.imul(h ^ day.charCodeAt(i), 0x85ebca6b) ^ (h >>> 13);
  return h >>> 0;
}

const PARTS = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

/** Denmark's wall clock at an instant: the date, and when its midnight was (ms). */
export function danishDate(now: number): { day: string; midnight: number } {
  const p: Record<string, number> = {};
  for (const part of PARTS.formatToParts(now)) if (part.type !== "literal") p[part.type] = Number(part.value);
  const wall = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
  // The zone's offset now (whole minutes), and so its midnight on this day.
  const offset = Math.round((wall - Math.floor(now / 1000) * 1000) / MIN) * MIN;
  const day = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  return { day, midnight: Date.UTC(p.year!, p.month! - 1, p.day!) - offset };
}

/** What a day holds between the morning's walk and the evening's: a few of each, in an order of the day's own. */
const DAYTIME: readonly Activity[] = ["friends", "library", "workshop", "ponder", "field", "council", "observatory", "friends", "field", "workshop", "library", "ponder"];

/** When he sits down to his journal: just before the node's nightly reflection runs (21:30 in Denmark), so he's writing as it's written. */
export const JOURNAL_AT = 21 * 60 + 28;

/**
 * A day's plan, in minutes after its midnight (Denmark): asleep until the dog wakes him (06:15 to 06:45), his
 * morning rounds, a walk with the dog, then the day's visits (35 to 70 minutes each, fetch with the dog at
 * midday), a walk at 18:30, the council table, the observatory, the evening by the fire, his journal from 21:28
 * until bedtime (21:52 to 22:12), asleep. The same for the same day and seed. Blocks cover the day end to end.
 */
export function dayPlan(day: string, seed = LIFE_SEED): { activity: Activity; from: number; to: number }[] {
  const rng = random(daySeed(day, seed));
  const out: { activity: Activity; from: number; to: number }[] = [];
  let at = 0;
  const add = (activity: Activity, to: number) => {
    const end = Math.min(DAY_MIN, Math.round(to));
    if (end <= at) return;
    const last = out[out.length - 1];
    if (last && last.activity === activity) last.to = end;
    else out.push({ activity, from: at, to: end });
    at = end;
  };
  const wake = 6 * 60 + 15 + Math.floor(rng() * 31);
  add("sleep", wake);
  add("wake", at + 8);
  add("rounds", at + 40 + Math.floor(rng() * 11));
  add("walk", at + 25 + Math.floor(rng() * 11));
  // The day's visits, shuffled for the day.
  const pool = [...DAYTIME];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  const evening = 18 * 60 + 30;
  let playedAtNoon = false;
  for (let i = 0; at < evening; i++) {
    if (!playedAtNoon && at >= 12 * 60) {
      add("walk-dog", at + 20 + Math.floor(rng() * 11));
      playedAtNoon = true;
      continue;
    }
    let next = pool[i % pool.length]!;
    // Never the same visit twice in a row (a repeat of the pool's end and start).
    if (next === out[out.length - 1]?.activity) next = pool[(i + 1) % pool.length]!;
    add(next, Math.min(evening, at + 35 + Math.floor(rng() * 36)));
  }
  add("walk", at + 30);
  add("council", at + 25 + Math.floor(rng() * 11));
  add("observatory", 20 * 60 + 30 + Math.floor(rng() * 16));
  add("hearth", JOURNAL_AT);
  add("journal", 21 * 60 + 52 + Math.floor(rng() * 21));
  add("sleep", DAY_MIN);
  return out;
}

/** The block of his day at an instant (absolute ms). Ask once a block: it allocates its result. */
export function lifeAt(now: number, seed = LIFE_SEED): Block {
  const { day, midnight } = danishDate(now);
  const minute = (now - midnight) / MIN;
  const plan = dayPlan(day, seed);
  const block = plan.find((b) => minute < b.to) ?? plan[plan.length - 1]!;
  return { activity: block.activity, start: midnight + block.from * MIN, end: Math.max(midnight + block.to * MIN, now + 1000) };
}

/** How far into its block an instant is (0..1). */
export const blockPhase = (b: Block, now: number): number => Math.max(0, Math.min(1, (now - b.start) / Math.max(1, b.end - b.start)));

const hhmm = (minute: number): string => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(Math.floor(minute % 60)).padStart(2, "0")}`;

/**
 * His day so far (Denmark's, up to `now`), a line a block, for his journal: "06:32 to 06:40 Woken by the dog".
 * `worked` is when he was at work (instants, ms): a block one falls in says work came first for part of it, so
 * the journal never claims a walk the work took. The same plan the world showed on every device.
 */
export function dayLog(now: number, worked: readonly number[] = [], dog?: string | null, seed = LIFE_SEED): string[] {
  const { day, midnight } = danishDate(now);
  const minute = (now - midnight) / MIN;
  const out: string[] = [];
  for (const b of dayPlan(day, seed)) {
    if (b.from >= minute) break;
    const to = Math.min(b.to, minute);
    const busy = worked.some((t) => t >= midnight + b.from * MIN && t < midnight + to * MIN);
    out.push(`${hhmm(b.from)} to ${hhmm(to)} ${withDog(ACTIVITY_LABEL[b.activity], dog)}${busy ? " (work came first for part of it)" : ""}`);
  }
  return out;
}

/**
 * What he does now, most important first: real work (the stream says so) always; then, with nothing to do,
 * what needs you (a heartbeat finding he goes to and tends); then the dog's flat battery (he walks it to its
 * bed, where it charges); then his day. Under reduced motion he stays put at the keep.
 */
export type Intent = "work" | "concern" | "charge" | "life" | "still";

export function intentFor(s: { working: boolean; concern: boolean; dogLow: boolean; motion: boolean }): Intent {
  if (s.working) return "work";
  if (!s.motion) return "still";
  if (s.concern) return "concern";
  if (s.dogLow) return "charge";
  return "life";
}

/** The rounds: the keep's stations in the order he walks them, and which one a moment of the block is at. */
export const ROUNDS = ["council", "library", "oracle", "treasury", "messenger", "forge", "watchtower", "observatory"] as const;

export function roundsStop(phase: number): (typeof ROUNDS)[number] {
  return ROUNDS[Math.min(ROUNDS.length - 1, Math.floor(Math.max(0, phase) * ROUNDS.length))]!;
}
