import { type Activity, danishDate } from "@galahad/core/life";
import type { Station } from "@galahad/core/world";

/*
 * He notices you. When you open the SANDBOX, Galahad looks towards the view, raises
 * a hand and says a line that fits the hour in Denmark and what he's doing; the dog
 * reacts too. This is the line, and when a greeting is due: both pure (no model is
 * asked, nothing is fetched), from what the page already knows.
 *
 * His voice: courteous, candid, brief. He says where he is and what he's at, never
 * what his work is about (that's in the chat it belongs to); asleep he says
 * nothing at all.
 */

export interface GreetingInput {
  /** Now (ms): the hour is Denmark's, whatever the device's zone. */
  now: number;
  /** With no work, the part of his day he's in; at work, null. */
  activity: Activity | null;
  /** At work: where (never what the work is about). */
  station: Station | null;
  /** Asleep: he doesn't wake to greet you. */
  asleep: boolean;
  /** On his bed, awake (turning in, or just woken). */
  lying: boolean;
  /** A quest is in hand on the node. */
  quest: boolean;
  /** Something needs you (his heartbeat found it). */
  needsYou: boolean;
  /** The weather as it's drawn: only what he'd remark on. */
  weather: "rain" | "snow" | "storm" | "mist" | null;
  /** His dog's name ("" while it has none). */
  dog: string;
}

/** Away this long, and he greets you again. */
export const ABSENCE_MS = 30 * 60_000;

/**
 * Whether a greeting is due: the first time the SANDBOX is seen in this browser, and whenever it wasn't
 * looked at for half an hour (the page closed, the tab hidden, another page of the app). So it's once a
 * visit, not once a route change. `lastSeen`: when the SANDBOX was last on screen (ms), or null: never.
 */
export function shouldGreet(now: number, lastSeen: number | null): boolean {
  return lastSeen === null || !Number.isFinite(lastSeen) || now - lastSeen >= ABSENCE_MS || lastSeen > now + 60_000;
}

/** The hour in Denmark, 0..24. */
export const danishHour = (now: number): number => (now - danishDate(now).midnight) / 3_600_000;

function salutation(hour: number): string {
  if (hour >= 5 && hour < 10) return "Good morning, my liege.";
  if (hour >= 10 && hour < 12) return "Good day, my liege.";
  if (hour >= 12 && hour < 18) return "Good afternoon, my liege.";
  if (hour >= 18 && hour < 23) return "Good evening, my liege.";
  return "You're up late, my liege.";
}

const AT_WORK: Record<Station, string> = {
  keep: "I'm at work at the keep.",
  council: "I'm thinking something through at the council table.",
  library: "I'm at work in the library.",
  watchtower: "I'm up at the watchtower.",
  treasury: "I'm at the treasury.",
  messenger: "I'm at the messenger's post.",
  forge: "I'm at work at the forge.",
  oracle: "I'm with the oracle.",
  observatory: "I'm at the observatory.",
  field: "I'm out at an experiment.",
};

/** What he's at, in his own words. `we`: "Bors and I", or "The dog and I". */
function doing(i: GreetingInput, we: string, dog: string): string {
  if (i.activity === null) {
    if (i.quest) return i.station === "council" || i.station === null ? "A quest is in hand: its plan is on my slate." : `A quest is in hand. ${AT_WORK[i.station]}`;
    return i.station ? AT_WORK[i.station] : "I'm at work.";
  }
  switch (i.activity) {
    case "sleep":
      return "I'm turning in for the night.";
    case "wake":
      return i.lying ? `${dog} has just woken me.` : `${we} are up.`;
    case "rounds":
      return "I'm on my rounds of the keep.";
    case "walk":
      return `${we} are out on the trail.`;
    case "walk-dog":
      return `${we} are playing fetch.`;
    case "friends":
      return "I'm with the Microducks.";
    case "library":
      return "I'm reading in the library.";
    case "workshop":
      return "I'm looking in on the workshop.";
    case "field":
      return "I'm up on the proving ground.";
    case "council":
      return "Reachy Mini and I are talking at the council table.";
    case "observatory":
      return "I'm at the board by the observatory.";
    case "ponder":
      return `${we} are on the bench by the lake.`;
    case "hearth":
      return `${we} are by the fire.`;
    case "journal":
      return "I'm writing up the day.";
  }
}

const WEATHER: Record<NonNullable<GreetingInput["weather"]>, string> = {
  rain: "It's raining here.",
  snow: "It's snowing here.",
  storm: "There's thunder about.",
  mist: "The mist is in.",
};

/**
 * What he says when he notices you: the hour's greeting, what he's at, and one more thing if there is one
 * (what needs you, before the weather). Null asleep: he says nothing.
 */
export function greetingLine(i: GreetingInput): string | null {
  if (i.asleep) return null;
  const name = i.dog.trim();
  const we = name ? `${name} and I` : "The dog and I";
  const dog = name || "The dog";
  const parts = [salutation(danishHour(i.now)), doing(i, we, dog)];
  if (i.needsYou) parts.push("Something needs you: it's in your Inbox.");
  else if (i.weather) parts.push(WEATHER[i.weather]);
  return parts.join(" ");
}
