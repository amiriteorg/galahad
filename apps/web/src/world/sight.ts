import type { EyesPlace, Sight, SightEye, SightThing } from "@galahad/core/eyes";
import type { Activity } from "@galahad/core/life";
import { BENCH as ASSEMBLY_BENCH, SITES, type Station, STATIONS } from "@galahad/core/world";
import { BOARD_SPOT } from "./board.ts";
import { BED, BENCH, BENCH_AREA, CAMP, CAMP_GATE, DESK, DOG_BED, FIRE, JOURNAL, LOG, POLE, SWORD_STAND, TRAIL } from "./hearth-plan.ts";
import { CELLS, FARM, HALL_DOOR, inHall, LINE, MILL } from "./hall-plan.ts";
import { BLOCKHOUSE, COURSE, DRONE_PAD, FIELD_LEVEL, HANGAR, LAUNCH_SLAB, RUNWAY, TOWER, WINDSOCK } from "./field-plan.ts";
import { standAt } from "./path.ts";
import type { Season } from "./season.ts";

/*
 * What he sees, gathered from the world's own knowledge: no vision model, no
 * reading of pixels. The scene hands over what it knows this instant (where he
 * is, what he attends to, where his dog is and what it's doing, whether the fire
 * burns, who's about in the ecosystem and where the nearest of each kind is, the
 * experiments on their plots, the helpers and agents with him, the sky's own
 * words, the weather, the season, the sun) and this makes a `Sight` of it;
 * core's `sightInWords` says it, with what's in his field of view by rough
 * bearing and distance. It's the eyes panel's accessible text, and the words the
 * model gets beside the picture.
 *
 * Pure, with no three.js in it (so it's unit-tested); asked a couple of times a
 * second at most (the panel's text, a frame for the node), never per frame.
 */

export interface SightInput {
  now: number;
  /** His feet (world metres) and his eyes. */
  x: number;
  y: number;
  z: number;
  eye: SightEye;
  /** How far his eyes are shut, 0..1. */
  shut: number;
  /** With no work he lives his day: the activity and what the world says of it ("Out for a walk with Bors"). At work: the station. */
  working: boolean;
  activity: Activity;
  label: string;
  station: Station | null;
  /** On the move between places. */
  moving: boolean;
  /** What his head is turned to, when it is. */
  attention: { on: boolean; x: number; y: number; z: number };
  /** Writing his journal at his desk. */
  writing: boolean;
  dog: { x: number; y: number; name: string; state: "with him" | "lying by him" | "asleep" | "charging" | "playing" };
  fire: boolean;
  /** The sun: how high (radians) and whether it's past noon (0..1, over a half: sinking). */
  sunElevation: number;
  evening: number;
  season: Season;
  /** "overcast, 7 °C" (the real weather), or what the sky panel is set to ("rain"). */
  weather: string;
  sky: readonly string[];
  /** Who's about: each kind in sight, with where its nearest one is. */
  wild: readonly { name: string; count: number; doing: string; x: number; y: number; tall: number; air: boolean }[];
  experiments: readonly { title: string; x: number; y: number; size: number; phase: string }[];
  /** The agents and helpers with him now. */
  figures: readonly { what: string; doing: string; x: number; y: number }[];
  /** The Microducks: where each is. */
  ducks: readonly { x: number; y: number }[];
  /** The land's height (for what stands on it). */
  ground(x: number, y: number): number;
  /** A view rendered from a standing place he isn't at (a review): its label. */
  from?: string | null;
}

/** Where his eyes are above his feet, standing (metres): his visor's line. */
export const EYE_HEIGHT = 2.32;

const meadow = TRAIL.find((t) => t.pause > 0 && t.y > 60 && Math.abs(t.x) < 10)!;

/**
 * Where he'd stand at each place a review looks from, and the way he'd look (heading as atan2(north, east),
 * pitch up; radians): at the camp's gate looking over his hearth, behind the bench looking out over the lake,
 * where he stands at the council table and the forge, and at the trail's stop in the north meadow, looking
 * into the trees. Places of his day: each is somewhere he really stands (a test holds them to the plan).
 */
export const EYE_PLACES: Record<EyesPlace, { x: number; y: number; heading: number; pitch: number }> = {
  hearth: { x: CAMP_GATE.x, y: CAMP_GATE.y, heading: Math.atan2(FIRE.y - CAMP_GATE.y, FIRE.x - CAMP_GATE.x), pitch: -0.2 },
  bench: { x: BENCH.x, y: BENCH.y + 1.9, heading: -Math.PI / 2, pitch: -0.12 },
  council: { x: standAt("council").x, y: standAt("council").y, heading: standAt("council").facing, pitch: -0.14 },
  forge: { x: standAt("forge").x, y: standAt("forge").y, heading: standAt("forge").facing, pitch: -0.14 },
  meadow: { x: meadow.x, y: meadow.y, heading: Math.atan2(meadow.look[1] - meadow.y, meadow.look[0] - meadow.x), pitch: -0.03 },
};

const lower = (s: string): string => s[0]!.toLowerCase() + s.slice(1);
/** "Roe deer" → "a roe deer"; "Tawny owl" → "a tawny owl". */
const one = (name: string): string => `${/^[aeiou]/i.test(name) ? "an" : "a"} ${lower(name)}`;
/** "Hare" → "hares", "Red fox" → "red foxes", "Roe deer" → "roe deer", "Greylag goose" → "greylag geese". */
export function plural(name: string): string {
  const n = lower(name);
  if (/(deer|roach)$/.test(n)) return n;
  if (/goose$/.test(n)) return n.replace(/goose$/, "geese");
  return /(x|s|ch|sh)$/.test(n) ? `${n}es` : `${n}s`;
}

const COMPASS = ["east", "north-east", "north", "north-west", "west", "south-west", "south", "south-east"];
/** The way from the keep to a point, as a compass word (x east, y north). */
const compassOf = (x: number, y: number): string => COMPASS[((Math.round(Math.atan2(y, x) / (Math.PI / 4)) % 8) + 8) % 8]!;

/** Where he is, as it follows "He is": "at his hearth", "in the workshop", "out on the land, about 120 m north of the keep". */
export function whereWords(x: number, y: number): string {
  if (Math.hypot(x - BENCH_AREA.x, y - BENCH_AREA.y) < BENCH_AREA.r + 1.5) return "on the bench by the lake";
  if (Math.hypot(x - CAMP.x, y - CAMP.y) < CAMP.r + 1) return "at his hearth";
  if (inHall(x, y)) return Math.hypot(x - ASSEMBLY_BENCH.stand.x, y - ASSEMBLY_BENCH.stand.y) < 3 ? "in the workshop, at the assembly bench" : "in the workshop";
  const field = SITES.field;
  if (Math.abs(x - field.x) < field.w / 2 && Math.abs(y - field.y) < field.d / 2) return "up on the proving ground";
  if (Math.hypot(x - BOARD_SPOT.x, y - BOARD_SPOT.y) < 5) return "at the chalkboard, by the observatory";
  let best: string | null = null;
  let near = 5.5;
  for (const [name, s] of Object.entries(STATIONS)) {
    if (name === "keep") continue;
    const d = Math.hypot(x - s.x, y - s.y);
    if (d < near) {
      near = d;
      best = `at the ${lower(s.label)}`;
    }
  }
  if (best) return best;
  const d = Math.hypot(x, y);
  if (d < 7) return "at the keep, up on its deck";
  if (d < 40) return `on the keep's lawn, ${compassOf(x, y)} of the keep`;
  return `out on the land, about ${Math.round(d / 10) * 10} m ${compassOf(x, y)} of the keep`;
}

/** The light, from where the sun stands: "day", "a low sun", "sunset", "dusk", "night", and their mornings. */
export function lightWords(sunElevation: number, evening: number): string {
  const deg = (sunElevation * 180) / Math.PI;
  const late = evening > 0.5;
  if (deg > 12) return "day";
  if (deg > 4) return late ? "a low evening sun" : "a low morning sun";
  if (deg > -1) return late ? "sunset" : "sunrise";
  if (deg > -8) return late ? "dusk" : "dawn";
  return "night";
}

/** The season as it's said: "late autumn", "midwinter", "early spring" (the year's own date; a season chosen to look at reads as its middle). */
export function seasonWords(s: Season): string {
  // Each season's weight says how far in it is: the one before or after still weighing tells early from late.
  const order = ["winter", "spring", "summer", "autumn"] as const;
  const i = order.indexOf(s.name);
  const before = s[order[(i + 3) % 4]!];
  const after = s[order[(i + 1) % 4]!];
  if (before > 0.12 && before > after) return `early ${s.name}`;
  if (after > 0.12 && after > before) return `late ${s.name}`;
  return s.name === "winter" || s.name === "summer" ? `mid${s.name}` : s.name;
}

const DOG_DOING: Record<SightInput["dog"]["state"], string> = {
  "with him": "with him",
  "lying by him": "lying by him",
  asleep: "asleep on its cushion",
  charging: "charging on its cushion",
  playing: "playing fetch",
};

/** Everything that may be in his view, as things with a place; reused between calls (the scene asks a few times a second at most). */
export function buildSight(i: SightInput): Sight {
  const g = i.ground;
  const things: SightThing[] = [];
  const add = (what: string, x: number, y: number, rank: number, more: Partial<SightThing> = {}) => things.push({ what, x, y, z: g(x, y), h: 1, rank, ...more });

  // His dog first: the bond matters most.
  add(i.dog.name || "his dog", i.dog.x, i.dog.y, 9, { doing: DOG_DOING[i.dog.state], h: 0.9, reach: 80 });
  // His hearth, and the bench by the lake.
  add(i.fire ? "the fire, burning" : "the fire's ring of stones", FIRE.x, FIRE.y, 8, { h: i.fire ? 1.6 : 0.5, reach: i.fire ? 200 : 40 });
  add("his bed", BED.x, BED.y, 6, { h: 0.6, reach: 40 });
  add("the dog's cushion", DOG_BED.x, DOG_BED.y, 3, { h: 0.3, reach: 15 });
  add("his desk", DESK.x, DESK.y, 6, { h: DESK.top + 0.5, reach: 50 });
  add("his journal, open on the desk", JOURNAL.x, JOURNAL.y, 7, { z: g(JOURNAL.x, JOURNAL.y) + JOURNAL.z - 0.03, h: 0.06, reach: 4 });
  add("the log seat", LOG.x, LOG.y, 4, { h: 0.45, reach: 30 });
  add("his sword's stand", SWORD_STAND.x, SWORD_STAND.y, 5, { h: 1.4, reach: 30 });
  add("the pole with his pennant and lantern", POLE.x, POLE.y, 5, { h: POLE.height, reach: 120 });
  add("the bench by the lake", BENCH.x, BENCH.y, 6, { h: 0.9, reach: 60 });
  add("the lake", BENCH.x, BENCH.y - 22, 4, { h: 0.1, reach: 260 });
  // The keep and its stations; the chalkboard; the two sites.
  add("the keep under its great tree", 0, 0, 5, { h: 26, reach: 700 });
  for (const [name, s] of Object.entries(STATIONS)) {
    if (name === "keep") continue;
    add(name === "council" ? "the council table, Reachy Mini on it" : `the ${lower(s.label)}`, s.x, s.y, 4, { h: name === "watchtower" ? 9 : 3, reach: 160 });
  }
  add("the chalkboard", BOARD_SPOT.x, BOARD_SPOT.y, 6, { h: 2.4, reach: 90 });
  add("the workshop hall", SITES.hall.x, SITES.hall.y, 4, { h: 9, reach: 500 });
  // (Seen from below as a whole; up on it, it's its own things that are seen.)
  const onField = Math.abs(i.eye.x - SITES.field.x) < SITES.field.w / 2 && Math.abs(i.eye.y - SITES.field.y) < SITES.field.d / 2;
  if (!onField) add("the proving ground on its heights", SITES.field.x, SITES.field.y, 4, { z: g(SITES.field.x, SITES.field.y), h: 8, reach: 500 });
  // In the workshop: its machines (seen only from inside: its walls hide them, and hide the land from in there).
  add("the assembly bench", ASSEMBLY_BENCH.x, ASSEMBLY_BENCH.y, 6, { h: 1.2, reach: 30 });
  add("the printer farm", FARM.bench.x, FARM.bench.y, 5, { h: 1.9, reach: 50 });
  add("the assembly line and its arms", (LINE.west + LINE.east) / 2, LINE.y, 5, { h: 1.8, reach: 60 });
  add("the mill", MILL.x, MILL.y, 4, { h: 2.2, reach: 40 });
  add("the hall's wide door", HALL_DOOR.x, HALL_DOOR.y, 4, { h: HALL_DOOR.height, reach: 70 });
  for (const c of CELLS) add(`a test cell (${lower(c.name)})`, c.x, c.y, 4, { h: 2.6, reach: 45 });
  // Up on the proving ground (5 m above the keep): what stands there.
  const up = (what: string, x: number, y: number, rank: number, h: number, reach: number) => add(what, x, y, rank, { z: FIELD_LEVEL, h, reach });
  up("the runway", RUNWAY.x, RUNWAY.y, 4, 0.2, 220);
  up("the hangar", HANGAR.x, HANGAR.y, 5, HANGAR.ridge, 300);
  up("the control tower", TOWER.x, TOWER.y, 5, TOWER.beacon, 400);
  up("the launch pad", LAUNCH_SLAB.x, LAUNCH_SLAB.y, 5, 6, 200);
  up("the blockhouse", BLOCKHOUSE.x, BLOCKHOUSE.y, 4, BLOCKHOUSE.dish, 120);
  up("the rover course", COURSE.x, COURSE.y, 4, 1.2, 120);
  up("the quadcopter's pad", DRONE_PAD.x, DRONE_PAD.y, 5, 1.2, 60);
  up("the windsock", WINDSOCK.x, WINDSOCK.y, 3, WINDSOCK.height, 150);
  // Experiments on their plots; the agents and helpers with him; his friends the Microducks.
  for (const e of i.experiments) add(`the experiment "${e.title.slice(0, 60)}"`, e.x, e.y, 7, { doing: e.phase, h: Math.max(2, e.size * 0.3), reach: 300 });
  for (const f of i.figures) add(f.what, f.x, f.y, 6, { doing: f.doing, h: 1.6, reach: 90 });
  if (i.ducks.length) {
    let nearest = i.ducks[0]!;
    for (const d of i.ducks) if (Math.hypot(d.x - i.x, d.y - i.y) < Math.hypot(nearest.x - i.x, nearest.y - i.y)) nearest = d;
    add("a Microduck", nearest.x, nearest.y, 5, { count: i.ducks.length, plural: "Microducks, the nearest", h: 0.9, reach: 70 });
  }
  // Who's about: the nearest of each kind (what's on the wing is up in the air).
  for (const w of i.wild) add(one(w.name), w.x, w.y, 3, { doing: w.doing, count: w.count, plural: `${plural(w.name)}, the nearest`, z: g(w.x, w.y) + (w.air ? 6 : 0), h: w.air ? 14 : w.tall, reach: w.tall > 1 ? 160 : 70 });

  // Walls: from inside the workshop only what's in it is seen, and from outside nothing of its inside but the hall itself.
  const indoors = inHall(i.eye.x, i.eye.y);
  for (let k = things.length - 1; k >= 0; k--) {
    const t = things[k]!;
    const inside = inHall(t.x, t.y) && t.what !== "the workshop hall" && t.what !== "the hall's wide door";
    if (indoors ? !inside && t.what !== "the hall's wide door" : inside) things.splice(k, 1);
  }

  // What he attends to: the thing his head is turned to, when one is there.
  let lookingAt: string | null = null;
  if (i.writing) lookingAt = "his journal, open on the desk";
  else if (i.attention.on && !i.moving) {
    let near = 1.6;
    for (const t of things) {
      const d = Math.hypot(t.x - i.attention.x, t.y - i.attention.y);
      if (d < near) {
        near = d;
        lookingAt = t.what;
      }
    }
  }
  return {
    now: i.now,
    where: whereWords(i.x, i.y),
    doing: i.working ? "At work" : i.label,
    eye: i.eye,
    shut: i.shut,
    lookingAt,
    things,
    sky: i.sky,
    weather: i.weather,
    season: seasonWords(i.season),
    light: lightWords(i.sunElevation, i.evening),
    ...(i.from ? { from: i.from } : {}),
  };
}
