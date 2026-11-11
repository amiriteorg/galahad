/*
 * His day, when there's no work. From the real time in Denmark and a seed, a plan of
 * what he does: morning rounds of the keep, walking the dog, visiting his friends
 * (the Microducks), reading at the library, the workshop, the proving ground, the
 * council table with Reachy Mini, the board at the observatory, and resting on the
 * deck at night. Every device computes the same plan for the same moment (it reads
 * Denmark's clock, never the device's zone), so he's doing the same thing wherever
 * you watch from.
 *
 * Work always comes first: the scene asks `intentFor` what he does now, and work
 * (then something that needs you, then the dog's battery) beats the plan. When the
 * work is done he picks his day up where it would be: the plan is a function of the
 * time, so it's simply the block for now.
 *
 * Pure: no three.js, nothing per frame. `lifeAt` allocates only its result; the
 * scene asks it once a block (or when work ends), never every frame.
 */

export type Activity = "rest" | "rounds" | "walk-dog" | "friends" | "library" | "workshop" | "field" | "council" | "observatory";

export const ACTIVITIES: readonly Activity[] = ["rest", "rounds", "walk-dog", "friends", "library", "workshop", "field", "council", "observatory"];

/** What the world says he's doing, in a few words (the selector's line, his bubble). */
export const ACTIVITY_LABEL: Record<Activity, string> = {
  rest: "Resting on the deck",
  rounds: "Morning rounds",
  "walk-dog": "Walking the dog",
  friends: "Visiting the Microducks",
  library: "Reading at the library",
  workshop: "Looking in on the workshop",
  field: "Looking after the proving ground",
  council: "Talking with Reachy at the council table",
  observatory: "By the board at the observatory",
};

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

/** What a day holds between waking and the evening: a few of each, in an order of the day's own. */
const DAYTIME: readonly Activity[] = ["friends", "library", "workshop", "field", "council", "observatory", "friends", "field", "workshop", "library"];

/**
 * A day's plan, in minutes after its midnight (Denmark): resting until he wakes (06:15 to 06:45), his morning
 * rounds, a walk with the dog, then the day's visits (35 to 70 minutes each, a short walk with the dog at
 * midday), a walk at 18:30, the council table, the observatory until bedtime (21:45 to 22:15), rest.
 * The same for the same day and seed. Blocks cover the day end to end.
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
  add("rest", wake);
  add("rounds", at + 40 + Math.floor(rng() * 11));
  add("walk-dog", at + 25 + Math.floor(rng() * 11));
  // The day's visits, shuffled for the day.
  const pool = [...DAYTIME];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  const evening = 18 * 60 + 30;
  let walkedAtNoon = false;
  for (let i = 0; at < evening; i++) {
    if (!walkedAtNoon && at >= 12 * 60) {
      add("walk-dog", at + 20 + Math.floor(rng() * 11));
      walkedAtNoon = true;
      continue;
    }
    let next = pool[i % pool.length]!;
    // Never the same visit twice in a row (a repeat of the pool's end and start).
    if (next === out[out.length - 1]?.activity) next = pool[(i + 1) % pool.length]!;
    add(next, Math.min(evening, at + 35 + Math.floor(rng() * 36)));
  }
  add("walk-dog", at + 30);
  add("council", at + 25 + Math.floor(rng() * 11));
  const bed = 21 * 60 + 45 + Math.floor(rng() * 31);
  add("observatory", bed);
  add("rest", DAY_MIN);
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

/**
 * What he does now, most important first: real work (the stream says so) always; then, with nothing to do,
 * what needs you (a heartbeat finding he goes to and tends); then the dog's flat battery (he walks it to its
 * dock); then his day. Under reduced motion he stays put at the keep.
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
