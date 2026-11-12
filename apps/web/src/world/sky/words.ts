import type { Heavens } from "../daynight.ts";
import { type Season, seasonState } from "../season.ts";
import { GALACTIC, type Mat3, rotate, skyMatrix, type Vec3 } from "./celestial.ts";
import { cloudKinds, emptyKinds } from "./clouds.ts";
import { showerTonight } from "./meteors.ts";
import { haloStrength, noctilucent, rainbowStrength } from "./optics.ts";
import { emptyPlanets, planetsAt, planetShows } from "./planets.ts";

/*
 * What's in the sky now, in a few short phrases, for the HUD: "Waxing gibbous
 * moon", "Jupiter in the south-east", "A few Leonids tonight", "A rainbow in
 * the east", "Cumulus, drifting from the west". Only what is really there, by
 * the same sums that draw it: the moon when it's up, the planets that show,
 * the shower of the season, what the light is doing in the air, and always the
 * clouds, last. A closed sky hides what's above it, so nothing above it is
 * said. Pure: a function of the instant, the sun and moon, and the weather.
 */

const DEG = 180 / Math.PI;
const TAU = 2 * Math.PI;

const POINTS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"] as const;

/** A compass bearing (radians: 0 north, π/2 east) in words, to the nearest of eight points. */
export function compass(azimuth: number): string {
  const turn = (((azimuth % TAU) + TAU) % TAU) / TAU;
  return POINTS[Math.round(turn * 8) % 8]!;
}

/**
 * The moon's name for where it is in its month (`phase`: 0 new, 0.25 first
 * quarter, 0.5 full, 0.75 last quarter) and how much of it is lit. With no
 * phase (a preset has none), only what its lit share says.
 */
export function moonName(phase: number | undefined, lit: number): string {
  if (lit < 0.03) return "New moon";
  if (lit > 0.97) return "Full moon";
  const shape = lit < 0.42 ? "crescent" : lit <= 0.58 ? "quarter" : "gibbous";
  if (phase === undefined) return shape === "quarter" ? "Half moon" : `${shape[0]!.toUpperCase()}${shape.slice(1)} moon`;
  const waxing = phase < 0.5;
  if (shape === "quarter") return waxing ? "First quarter moon" : "Last quarter moon";
  return `${waxing ? "Waxing" : "Waning"} ${shape} moon`;
}

/** The weather as the words need it: the world's weather state has all of this (`rainPast` is the sky's own memory of a shower, if known). */
export interface WordsWeather {
  cloud: number;
  rain: number;
  mist: number;
  snow?: number;
  storm?: number;
  /** The wind, m/s, and the way it blows towards (atan2 convention: 0 east, π/2 north). */
  wind?: number;
  windHeading?: number;
  rainPast?: number;
}

/** How warm the season is for the clouds: 0 midwinter to 1 midsummer. */
export const seasonWarmth = (s: Season): number => Math.max(0, Math.min(1, s.summer + 0.55 * s.spring + 0.5 * s.autumn + 0.1 * s.winter));

const kinds = emptyKinds();
const planets = emptyPlanets();
const order = [0, 1, 2, 3];
const matrix: Mat3 = new Float64Array(9);
const pole: Vec3 = [0, 0, 0];

/**
 * The sky at the UTC instant `now`, under these heavens (the real sun and moon,
 * or a preset's) and this weather: at most `limit` phrases, the most telling
 * first, the clouds last. `warmth` is the season (0 midwinter .. 1 midsummer;
 * the world's own season when left out): it decides what kind the clouds are.
 */
export function skyWords(now: number, heavens: Heavens, weather: WordsWeather, limit = 4, warmth: number = seasonWarmth(seasonState)): string[] {
  const words: string[] = [];
  const sun = heavens.sunElevation * DEG;
  const cloud = weather.cloud;
  const k = cloudKinds(weather, sun, warmth, kinds);
  // What's above the clouds shows through gaps, not through a lid (nor through thick mist).
  const open = k.sheet < 0.85 && weather.mist < 0.7;
  const dark = sun < -6;

  // ---- light in the air ----
  if (rainbowStrength(sun, weather.rain, weather.rainPast ?? 0, cloud) > 0.15) words.push(`A rainbow in the ${compass(heavens.sunAzimuth + Math.PI)}`);
  if (haloStrength(sun, k.cirrus, cloud) > 0.2) words.push(sun < 16 ? "A halo and sundogs round the sun" : "A halo round the sun");
  if (noctilucent(now, sun, cloud) > 0.2) words.push("Noctilucent clouds in the north");
  if (open && Math.abs(sun) < 1.6 && cloud < 0.7) words.push(`Sun ${heavens.evening > 0.5 ? "setting" : "rising"} in the ${compass(heavens.sunAzimuth)}`);

  // ---- the moon, the planets, the stars ----
  if (open) {
    if (heavens.moonElevation * DEG > 1) words.push(moonName(heavens.moonPhase, heavens.moonLit));
    planetsAt(now, planets);
    // The brightest that show, two at most.
    order.sort((a, b) => planets[a]!.magnitude - planets[b]!.magnitude);
    let said = 0;
    for (const i of order) {
      const p = planets[i]!;
      if (said < 2 && planetShows(p, heavens.sunElevation) > 0.5) {
        words.push(`${p.name} in the ${compass(p.azimuth)}`);
        said++;
      }
    }
  }
  // ---- a meteor shower: said in the evening and through the night ----
  if (sun < 0 || (heavens.evening > 0.5 && sun < 12)) {
    const tonight = showerTonight(now);
    if (tonight) words.push(tonight.strength === "peak" ? `${tonight.shower.name} at their peak tonight` : tonight.strength === "active" ? `${tonight.shower.name} tonight` : `A few ${tonight.shower.name} tonight`);
  }
  // ---- the Milky Way, on a dark, open, moonless night, when it stands up from the horizon ----
  if (open && sun < -14 && cloud < 0.3 && (heavens.moonElevation < 0 || heavens.moonLit < 0.25)) {
    rotate(skyMatrix(now, matrix), GALACTIC.pole, pole);
    if (pole[2] < 0.82) {
      // It crosses the horizon a quarter turn either side of where the galaxy's pole stands.
      const across = Math.atan2(pole[0], pole[1]) + Math.PI / 2;
      const a = compass(across);
      const b = compass(across + Math.PI);
      words.push(`The Milky Way, ${a} to ${b}`);
    }
  }

  // ---- the clouds, always, last ----
  const wind = weather.wind ?? 0;
  // Where they come from: the wind blows towards its heading (atan2: 0 east), so from the bearing opposite.
  const from = compass(Math.PI / 2 - (weather.windHeading ?? 0) + Math.PI);
  const drift = wind < 1 ? "hardly moving" : `drifting from the ${from}`;
  let sky: string;
  if (k.kind === "clear") sky = weather.mist > 0.5 ? "Mist over the land" : dark ? "A clear night" : "Clear sky";
  else if (k.kind === "cumulonimbus") sky = wind < 1 ? "Thunderclouds overhead" : `Thunderclouds from the ${from}`;
  else if (k.kind === "nimbostratus") sky = `${(weather.snow ?? 0) > weather.rain ? "Snow" : "Rain"} clouds${wind < 1 ? "" : ` from the ${from}`}`;
  else if (k.kind === "stratus") sky = `Stratus overcast${wind < 1 ? "" : `, from the ${from}`}`;
  else if (k.kind === "cirrus") sky = "Cirrus, high and thin";
  else sky = `${k.kind === "cumulus" ? "Cumulus" : "Stratocumulus"}, ${drift}`;

  const room = Math.max(0, Math.floor(limit) - 1);
  if (words.length > room) words.length = room;
  if (limit >= 1) words.push(sky);
  return words;
}
