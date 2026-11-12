/*
 * The cast of the SANDBOX's ecosystem: Denmark's own animals, as numbers. What
 * each one is (where it lives, how fast it goes, what it eats and what eats
 * it), when it's about (by the sun, by the months), how wary it is, and how it
 * breeds, grows and ages. The simulation (sim.ts) reads nothing else about a
 * species; the models (models.ts) draw them. Pure data.
 *
 * Lengths are metres at the world's scale (about one and a half times life,
 * as the old deer and rabbits were); times of life are in years, energy in
 * days of an adult's need.
 */

export const KINDS = ["roe", "hare", "fox", "hedgehog", "squirrel", "mallard", "swan", "heron", "fish", "songbird", "swallow", "starling", "goose", "kestrel", "owl", "bat"] as const;
export type Kind = (typeof KINDS)[number];

/** Each kind's number (its place in every table). */
export const ROE = 0;
export const HARE = 1;
export const FOX = 2;
export const HEDGEHOG = 3;
export const SQUIRREL = 4;
export const MALLARD = 5;
export const SWAN = 6;
export const HERON = 7;
export const FISH = 8;
export const SONGBIRD = 9;
export const SWALLOW = 10;
export const STARLING = 11;
export const GOOSE = 12;
export const KESTREL = 13;
export const OWL = 14;
export const BAT = 15;
export const KIND_COUNT = KINDS.length;

/** The insects (insects.ts): they aren't agents, but they are counted and named. */
export const INSECTS = ["bumblebee", "butterfly", "dragonfly", "mayfly", "moth", "firefly"] as const;
export type Insect = (typeof INSECTS)[number];
export const BUMBLEBEE = 0;
export const BUTTERFLY = 1;
export const DRAGONFLY = 2;
export const MAYFLY = 3;
export const MOTH = 4;
export const FIREFLY = 5;
export const INSECT_NAMES: readonly string[] = ["Bumblebee", "Butterfly", "Dragonfly", "Mayfly", "Moth", "Firefly"];
export const INSECT_DOING: readonly string[] = ["working the flowers", "from flower to flower", "hawking over the water", "dancing over the water", "circling the lantern", "flashing"];

/** What a species does at a moment: one number, and how it's said ("Roe deer · grazing"). */
export const DOING = [
  "standing",
  "walking",
  "grazing",
  "drinking",
  "resting",
  "asleep",
  "keeping watch",
  "head up, watching",
  "bolting",
  "settling",
  "staying by its mother",
  "stalking",
  "chasing",
  "mousing",
  "eating",
  "foraging",
  "up a trunk",
  "curled up",
  "on the water",
  "dabbling",
  "preening",
  "waiting for a fish",
  "striking",
  "on the wing",
  "hovering",
  "stooping",
  "roosting",
  "perched",
  "feeding on the ground",
  "skimming the water",
  "in the murmuration",
  "crossing in a V",
  "hawking insects",
  "gliding",
  "rising",
  "leaping",
  "leaving",
  "sheltering",
  "going to roost",
] as const;
export const STAND = 0;
export const WALK = 1;
export const GRAZE = 2;
export const DRINK = 3;
export const REST = 4;
export const SLEEP = 5;
export const WATCH = 6;
export const ALERT = 7;
export const FLEE = 8;
export const SETTLE = 9;
export const FOLLOW = 10;
export const STALK = 11;
export const CHASE = 12;
export const MOUSE = 13;
export const EAT = 14;
export const FORAGE = 15;
export const CLIMB = 16;
export const CURL = 17;
export const SWIM = 18;
export const DABBLE = 19;
export const PREEN = 20;
export const FISHING = 21;
export const STRIKE = 22;
export const FLY = 23;
export const HOVER = 24;
export const STOOP = 25;
export const ROOST = 26;
export const PERCH = 27;
export const PECK = 28;
export const SKIM = 29;
export const MURMUR = 30;
export const MIGRATE = 31;
export const HAWK = 32;
export const GLIDE = 33;
export const RISE = 34;
export const LEAP = 35;
export const LEAVE = 36;
export const SHELTER = 37;
export const TO_ROOST = 38;

/** Where a species lives and how it moves. */
export const LAND = 0;
/** On the water and its shore (ducks, swans). */
export const WATER = 1;
/** In the shallows (the heron). */
export const WADER = 2;
/** Under the water. */
export const SWIMMER = 3;
/** On the wing. */
export const AIR = 4;

/** What there is to eat (a bit each): the land's pools (habitat.ts), the water's, the air's, and each other. */
export const GRASS = 1;
export const BROWSE = 2;
export const MAST = 4;
export const BUGS = 8;
export const VOLES = 16;
export const WEED = 32;
export const MIDGES = 64;
export const FISHES = 128;
export const HARES = 256;

export interface Spec {
  kind: Kind;
  /** As it's said: "Roe deer", and its young ("Roe fawn"). */
  name: string;
  young: string;
  realm: number;
  /** Its radius among the solids, and how high a label sits over it. */
  r: number;
  tall: number;
  /** Metres a second: going about, and for its life. How fast it turns (radians a second) and picks up speed (m/s²). */
  walk: number;
  run: number;
  turn: number;
  accel: number;
  /** A stride's length at a walk (metres): its legs keep time with the ground it covers. */
  stride: number;
  /** What it eats (bits), and how much forage an adult's day takes (the pools' units: a hare's day is 1). */
  diet: number;
  need: number;
  /** Days of need it can carry. */
  reserve: number;
  /** How thirsty a day makes it (1: it must drink once a day; 0: it gets its water from what it eats, or lives in it). */
  thirst: number;
  /** How much of it is about by day, in the twilights, by night (0..1). */
  rhythm: readonly [number, number, number];
  /** It lifts its head when someone walks within `wary` metres, and goes when they're within `flight`. */
  wary: number;
  flight: number;
  /** How many keep together (1: alone). */
  herd: number;
  /** Young: the middle of the season they come in (a fraction of the year) and how wide it is; how many at once; litters a year at most. */
  breedAt: number;
  breedSpan: number;
  litter: readonly [number, number];
  litters: number;
  /** Years: until it's weaned, until it's grown, and how long it lives. */
  weaned: number;
  grown: number;
  life: number;
  /** The months it's here: windows of the year (rising over a..b, here until c, gone by d), or null: always. */
  months: readonly (readonly [number, number, number, number])[] | null;
  /** Whether more wander in from beyond the range when there are few (a resident), or it only comes and goes by the season and the hour (a visitor). */
  resident: boolean;
}

const D = 1 / 365;
const ALWAYS = null;

/**
 * The cast. Roe deer browse and graze in small groups, most about at dawn and
 * dusk; hares graze alone; the fox takes hares and voles, mostly from dusk; the
 * hedgehog snuffles for beetles at night from April to October; red squirrels
 * keep to trunks and what falls from them. Mallards dabble, a pair of swans
 * feeds on the weed, the heron waits for fish, the fish take what hatches on
 * the water. Songbirds feed by day and roost in trees; swallows are here from
 * May to September; starlings gather to murmurate in spring and autumn and
 * geese cross then; a kestrel hovers for voles by day, an owl takes them by
 * night, and bats hawk the night's insects from April to October.
 */
export const SPECS: readonly Spec[] = [
  { kind: "roe", name: "Roe deer", young: "Roe fawn", realm: LAND, r: 0.5, tall: 1.75, walk: 1.05, run: 7.2, turn: 2.6, accel: 9, stride: 1.25, diet: GRASS | BROWSE, need: 5, reserve: 5, thirst: 0.45, rhythm: [0.55, 1, 0.4], wary: 24, flight: 9, herd: 4, breedAt: 152 * D, breedSpan: 26 * D, litter: [1, 2], litters: 1, weaned: 0.2, grown: 0.75, life: 9, months: ALWAYS, resident: true },
  { kind: "hare", name: "Hare", young: "Leveret", realm: LAND, r: 0.22, tall: 0.75, walk: 0.9, run: 9.2, turn: 4.5, accel: 16, stride: 0.75, diet: GRASS, need: 1, reserve: 3.5, thirst: 0.2, rhythm: [0.4, 1, 0.75], wary: 15, flight: 6.5, herd: 1, breedAt: 150 * D, breedSpan: 85 * D, litter: [2, 3], litters: 3, weaned: 0.08, grown: 0.3, life: 5, months: ALWAYS, resident: true },
  { kind: "fox", name: "Red fox", young: "Fox cub", realm: LAND, r: 0.3, tall: 0.95, walk: 1.5, run: 7.6, turn: 3.6, accel: 11, stride: 0.9, diet: VOLES | HARES, need: 1, reserve: 6, thirst: 0.35, rhythm: [0.3, 1, 0.9], wary: 30, flight: 13, herd: 1, breedAt: 105 * D, breedSpan: 22 * D, litter: [2, 4], litters: 1, weaned: 0.18, grown: 0.6, life: 6, months: ALWAYS, resident: true },
  { kind: "hedgehog", name: "Hedgehog", young: "Hoglet", realm: LAND, r: 0.17, tall: 0.5, walk: 0.34, run: 0.9, turn: 2.2, accel: 2, stride: 0.22, diet: BUGS, need: 1, reserve: 5, thirst: 0.2, rhythm: [0, 0.6, 1], wary: 4, flight: 0, herd: 1, breedAt: 175 * D, breedSpan: 30 * D, litter: [2, 4], litters: 1, weaned: 0.12, grown: 0.4, life: 5, months: [[85 * D, 110 * D, 290 * D, 318 * D]], resident: true },
  { kind: "squirrel", name: "Red squirrel", young: "Squirrel kit", realm: LAND, r: 0.15, tall: 0.6, walk: 1.5, run: 4.6, turn: 6, accel: 14, stride: 0.5, diet: MAST, need: 1, reserve: 4, thirst: 0.2, rhythm: [1, 0.7, 0], wary: 11, flight: 5.5, herd: 1, breedAt: 115 * D, breedSpan: 35 * D, litter: [2, 3], litters: 1, weaned: 0.18, grown: 0.4, life: 6, months: ALWAYS, resident: true },
  { kind: "mallard", name: "Mallard", young: "Duckling", realm: WATER, r: 0.22, tall: 0.6, walk: 0.5, run: 2.8, turn: 2.8, accel: 5, stride: 0.3, diet: WEED | BUGS, need: 1, reserve: 4, thirst: 0, rhythm: [1, 0.8, 0.15], wary: 12, flight: 5.5, herd: 5, breedAt: 148 * D, breedSpan: 30 * D, litter: [3, 5], litters: 1, weaned: 0.12, grown: 0.3, life: 6, months: ALWAYS, resident: true },
  { kind: "swan", name: "Mute swan", young: "Cygnet", realm: WATER, r: 0.48, tall: 1.5, walk: 0.5, run: 1.6, turn: 1.3, accel: 1.5, stride: 0.45, diet: WEED, need: 4, reserve: 6, thirst: 0, rhythm: [1, 0.8, 0.1], wary: 9, flight: 0, herd: 2, breedAt: 150 * D, breedSpan: 24 * D, litter: [2, 3], litters: 1, weaned: 0.3, grown: 0.85, life: 14, months: ALWAYS, resident: true },
  { kind: "heron", name: "Grey heron", young: "Grey heron", realm: WADER, r: 0.32, tall: 1.9, walk: 0.28, run: 9, turn: 1.6, accel: 4, stride: 0.6, diet: FISHES, need: 1, reserve: 6, thirst: 0, rhythm: [1, 1, 0.2], wary: 30, flight: 17, herd: 1, breedAt: 0, breedSpan: 0, litter: [0, 0], litters: 0, weaned: 0, grown: 0, life: 15, months: ALWAYS, resident: false },
  { kind: "fish", name: "Roach", young: "Roach fry", realm: SWIMMER, r: 0.2, tall: 0.3, walk: 0.35, run: 2.6, turn: 3.5, accel: 6, stride: 0.5, diet: MIDGES, need: 0.2, reserve: 8, thirst: 0, rhythm: [0.7, 1, 0.5], wary: 6, flight: 4, herd: 5, breedAt: 135 * D, breedSpan: 30 * D, litter: [1, 2], litters: 1, weaned: 0, grown: 0.4, life: 7, months: ALWAYS, resident: true },
  { kind: "songbird", name: "Songbird", young: "Fledgling", realm: AIR, r: 0.12, tall: 0.5, walk: 0.5, run: 7.5, turn: 5, accel: 14, stride: 0.2, diet: MIDGES | MAST, need: 0.2, reserve: 3, thirst: 0, rhythm: [1, 0.7, 0], wary: 10, flight: 6, herd: 12, breedAt: 150 * D, breedSpan: 40 * D, litter: [1, 2], litters: 1, weaned: 0, grown: 0.15, life: 4, months: ALWAYS, resident: true },
  { kind: "swallow", name: "Swallow", young: "Swallow", realm: AIR, r: 0.12, tall: 0.5, walk: 8, run: 12, turn: 5.5, accel: 16, stride: 0.2, diet: MIDGES, need: 0.2, reserve: 3, thirst: 0, rhythm: [1, 0.8, 0], wary: 0, flight: 0, herd: 6, breedAt: 0, breedSpan: 0, litter: [0, 0], litters: 0, weaned: 0, grown: 0, life: 4, months: [[112 * D, 135 * D, 250 * D, 275 * D]], resident: false },
  { kind: "starling", name: "Starling", young: "Starling", realm: AIR, r: 0.12, tall: 0.5, walk: 9, run: 13, turn: 5, accel: 16, stride: 0.2, diet: 0, need: 0, reserve: 3, thirst: 0, rhythm: [0, 1, 0], wary: 0, flight: 0, herd: 100, breedAt: 0, breedSpan: 0, litter: [0, 0], litters: 0, weaned: 0, grown: 0, life: 5, months: [[55 * D, 70 * D, 110 * D, 125 * D], [240 * D, 255 * D, 318 * D, 335 * D]], resident: false },
  { kind: "goose", name: "Greylag goose", young: "Greylag goose", realm: AIR, r: 0.4, tall: 1, walk: 13, run: 15, turn: 0.5, accel: 4, stride: 0.5, diet: 0, need: 0, reserve: 6, thirst: 0, rhythm: [1, 1, 0.15], wary: 0, flight: 0, herd: 9, breedAt: 0, breedSpan: 0, litter: [0, 0], litters: 0, weaned: 0, grown: 0, life: 12, months: [[45 * D, 62 * D, 105 * D, 120 * D], [245 * D, 262 * D, 322 * D, 338 * D]], resident: false },
  { kind: "kestrel", name: "Kestrel", young: "Kestrel", realm: AIR, r: 0.25, tall: 0.6, walk: 7, run: 13, turn: 2.6, accel: 9, stride: 0.3, diet: VOLES, need: 1, reserve: 4, thirst: 0, rhythm: [1, 0.6, 0], wary: 0, flight: 0, herd: 1, breedAt: 0, breedSpan: 0, litter: [0, 0], litters: 0, weaned: 0, grown: 0, life: 8, months: ALWAYS, resident: false },
  { kind: "owl", name: "Tawny owl", young: "Tawny owl", realm: AIR, r: 0.28, tall: 0.6, walk: 5.5, run: 9, turn: 2.4, accel: 7, stride: 0.3, diet: VOLES, need: 1, reserve: 4, thirst: 0, rhythm: [0, 0.5, 1], wary: 0, flight: 0, herd: 1, breedAt: 0, breedSpan: 0, litter: [0, 0], litters: 0, weaned: 0, grown: 0, life: 10, months: ALWAYS, resident: false },
  { kind: "bat", name: "Pipistrelle bat", young: "Pipistrelle bat", realm: AIR, r: 0.1, tall: 0.4, walk: 5.5, run: 8, turn: 9, accel: 30, stride: 0.2, diet: MIDGES, need: 0.2, reserve: 3, thirst: 0, rhythm: [0, 0.9, 1], wary: 0, flight: 0, herd: 3, breedAt: 0, breedSpan: 0, litter: [0, 0], litters: 0, weaned: 0, grown: 0, life: 6, months: [[80 * D, 105 * D, 285 * D, 310 * D]], resident: false },
];

/** The most of each kind at once (grown ones: their young come on top, half as many again). From the device's tier. */
export type Caps = Record<Kind, number> & { insects: number; fireflies: number };

/** No animals at all. */
export const NO_CAPS: Caps = { roe: 0, hare: 0, fox: 0, hedgehog: 0, squirrel: 0, mallard: 0, swan: 0, heron: 0, fish: 0, songbird: 0, swallow: 0, starling: 0, goose: 0, kestrel: 0, owl: 0, bat: 0, insects: 0, fireflies: 0 };

const clamp = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (lo: number, hi: number, x: number): number => {
  const t = clamp((x - lo) / (hi - lo));
  return t * t * (3 - 2 * t);
};

/** How much of a species is here at this time of year (0: none; 1: all of them). */
export function presence(spec: Spec, year: number): number {
  if (!spec.months) return 1;
  let most = 0;
  for (const [a, b, c, d] of spec.months) most = Math.max(most, smooth(a, b, year) * (1 - smooth(c, d, year)));
  return most;
}

/** How much of a species is about at this hour: `night` 0 by day to 1 in the dead of night, `twilight` 0..1 at dawn and dusk. */
export function about(spec: Spec, night: number, twilight: number): number {
  const day = spec.rhythm[0] * (1 - night) + spec.rhythm[2] * night;
  return day + (spec.rhythm[1] - day) * twilight;
}

/** How near its breeding season's middle the year is: 1 at its height, 0 outside it. */
export function breeding(spec: Spec, year: number): number {
  if (!spec.breedSpan) return 0;
  const d = Math.abs(year - spec.breedAt);
  return clamp(1 - Math.min(d, 1 - d) / spec.breedSpan);
}
