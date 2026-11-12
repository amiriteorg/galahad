import { describe, expect, test } from "bun:test";
import { EYES, EYES_PLACES, inView, type SightEye, sightInWords } from "@galahad/core/eyes";
import { STATIONS } from "@galahad/core/world";
import { BENCH, BENCH_SEAT, DESK_SEAT, FIRE, JOURNAL, LOG_SEAT } from "./hearth-plan.ts";
import { KEEP_COLLIDERS } from "./keep-plan.ts";
import { HEARTH_COLLIDERS } from "./hearth-plan.ts";
import { inCollider } from "./hall-plan.ts";
import { standAt } from "./path.ts";
import { emptySeason, seasonAt } from "./season.ts";
import { buildSight, EYE_HEIGHT, EYE_PLACES, lightWords, plural, seasonWords, type SightInput, whereWords } from "./sight.ts";
import { TIERS } from "./tiers.ts";

/*
 * What he sees, gathered from the world's own knowledge (sight.ts) and said by
 * core's sightInWords: where he is, what he attends to, what stands in his field
 * of view. Pure: no renderer, no vision model.
 */

const RAD = Math.PI / 180;
const NOON = Date.UTC(2026, 10, 12, 11, 0);
/** His eyes where he sits or stands, looking along `heading` (atan2(north, east)). */
const eyeAt = (x: number, y: number, heading: number, pitch = -0.1, up = EYE_HEIGHT): SightEye => ({ x, y, z: up, heading, pitch, fov: 62 * RAD, aspect: 1.6 });
const input = (more: Partial<SightInput> = {}): SightInput => ({
  now: NOON,
  x: LOG_SEAT.x,
  y: LOG_SEAT.y,
  z: 0,
  eye: eyeAt(LOG_SEAT.x, LOG_SEAT.y, Math.PI / 2, -0.35, 1.8),
  shut: 0,
  working: false,
  activity: "hearth",
  label: "By the fire with Bors",
  station: "keep",
  moving: false,
  attention: { on: true, x: FIRE.x, y: FIRE.y, z: 0.4 },
  writing: false,
  dog: { x: LOG_SEAT.x + 0.9, y: LOG_SEAT.y + 0.2, name: "Bors", state: "lying by him" },
  fire: true,
  sunElevation: 10 * RAD,
  evening: 0.4,
  season: seasonAt(NOON, emptySeason()),
  weather: "overcast, 7 °C",
  sky: ["Stratus, drifting from the west"],
  wild: [],
  experiments: [],
  figures: [],
  ducks: [],
  ground: () => 0,
  ...more,
});

describe("where he is, the light and the season, in words", () => {
  test("the places of his day are named; elsewhere, how far and which way from the keep", () => {
    expect(whereWords(LOG_SEAT.x, LOG_SEAT.y)).toBe("at his hearth");
    expect(whereWords(DESK_SEAT.x, DESK_SEAT.y)).toBe("at his hearth");
    expect(whereWords(BENCH_SEAT.x, BENCH_SEAT.y)).toBe("on the bench by the lake");
    expect(whereWords(standAt("forge").x, standAt("forge").y)).toBe("at the forge");
    expect(whereWords(standAt("council").x, standAt("council").y)).toBe("at the council table");
    expect(whereWords(110, 2)).toBe("in the workshop");
    expect(whereWords(102.5, 10.4)).toBe("in the workshop, at the assembly bench");
    expect(whereWords(-140, -35)).toBe("up on the proving ground");
    expect(whereWords(0.5, 0.5)).toBe("at the keep, up on its deck");
    expect(whereWords(-4, 65)).toBe("out on the land, about 70 m north of the keep");
    expect(whereWords(30, -32)).toBe("out on the land, about 40 m south-east of the keep");
    // Every station's standing place is named for its station.
    for (const name of Object.keys(STATIONS) as (keyof typeof STATIONS)[]) {
      if (name === "keep") continue;
      const s = standAt(name);
      expect(whereWords(s.x, s.y)).toMatch(name === "observatory" ? /observatory/ : new RegExp(STATIONS[name].label.toLowerCase().replace("'", ".")));
    }
  });

  test("the light follows the sun, morning and evening told apart", () => {
    expect(lightWords(40 * RAD, 0.2)).toBe("day");
    expect(lightWords(8 * RAD, 0.8)).toBe("a low evening sun");
    expect(lightWords(8 * RAD, 0.2)).toBe("a low morning sun");
    expect(lightWords(1 * RAD, 0.8)).toBe("sunset");
    expect(lightWords(-4 * RAD, 0.2)).toBe("dawn");
    expect(lightWords(-4 * RAD, 0.8)).toBe("dusk");
    expect(lightWords(-20 * RAD, 0.8)).toBe("night");
  });

  test("the season by Denmark's date, early and late told apart", () => {
    const at = (month: number, day: number) => seasonWords(seasonAt(Date.UTC(2026, month - 1, day, 11), emptySeason()));
    expect(at(1, 15)).toBe("midwinter");
    expect(at(7, 10)).toBe("midsummer");
    expect(at(11, 12)).toMatch(/autumn/);
    expect(at(4, 20)).toMatch(/spring/);
    expect(new Set([at(3, 5), at(4, 20), at(5, 28)]).size).toBeGreaterThan(1);
  });

  test("several of a kind are said as they are", () => {
    expect([plural("Roe deer"), plural("Hare"), plural("Red fox"), plural("Greylag goose"), plural("Roach"), plural("Mute swan")]).toEqual(["roe deer", "hares", "red foxes", "greylag geese", "roach", "mute swans"]);
  });
});

describe("what he sees from where he is", () => {
  test("by the fire: the fire he's looking at, his desk, the keep beyond, his dog by its name", () => {
    const words = sightInWords(buildSight(input()));
    expect(words).toStartWith("Through Galahad's eyes, 12:00 in Denmark (");
    expect(words).toContain("overcast, 7 °C");
    expect(words).toContain("He is at his hearth: by the fire with Bors.");
    expect(words).toContain("He's looking at the fire, burning, ");
    expect(words).toContain("the keep under its great tree");
    // The dog at his side is under his gaze while he looks into the fire: said all the same, with where it is.
    expect(words).toContain("Bors is out of view, within reach to the right (lying by him).");
    expect(words).toContain("The sky: Stratus, drifting from the west.");
    expect(words.length).toBeLessThanOrEqual(EYES.words);
  });

  test("writing his journal: he looks at the page; walking, he looks at nothing in particular", () => {
    const writing = buildSight(input({ x: DESK_SEAT.x, y: DESK_SEAT.y, eye: eyeAt(DESK_SEAT.x, DESK_SEAT.y, Math.PI / 2, -0.6, 1.75), activity: "journal", label: "Writing his journal", writing: true, attention: { on: true, x: JOURNAL.x, y: JOURNAL.y, z: 0.8 } }));
    expect(writing.lookingAt).toBe("his journal, open on the desk");
    expect(sightInWords(writing)).toContain("He's looking at his journal, open on the desk, within reach.");
    const walking = buildSight(input({ moving: true, activity: "walk", label: "Out for a walk with Bors", x: 15, y: -40, eye: eyeAt(15, -40, -1.2) }));
    expect(walking.lookingAt).toBeNull();
    expect(sightInWords(walking)).toContain("out for a walk with Bors");
  });

  test("at work it says the station and nothing of what the work is about", () => {
    const s = standAt("watchtower");
    const working = sightInWords(buildSight(input({ working: true, station: "watchtower", x: s.x, y: s.y, eye: eyeAt(s.x, s.y, s.facing), label: "Search the web: a private question", attention: { on: false, x: 0, y: 0, z: 0 } })));
    expect(working).toContain("He is at the watchtower: at work.");
    expect(working).not.toContain("private question");
  });

  test("who's about: the nearest of each kind with how many, an experiment on its plot, an agent with him, the Microducks", () => {
    const sight = buildSight(
      input({
        x: -4,
        y: 65,
        eye: eyeAt(-4, 65, Math.PI / 2, -0.03),
        activity: "walk",
        label: "Out for a walk with Bors",
        attention: { on: false, x: 0, y: 0, z: 0 },
        dog: { x: -3, y: 70, name: "Bors", state: "with him" },
        wild: [
          { name: "Roe deer", count: 4, doing: "grazing", x: -3, y: 100, tall: 1.75, air: false },
          { name: "Kestrel", count: 1, doing: "hovering", x: -10, y: 95, tall: 0.6, air: true },
          { name: "Hare", count: 2, doing: "resting", x: -40, y: 20, tall: 0.75, air: false },
        ],
        experiments: [{ title: "Two-link arm", x: 0, y: 110, size: 20, phase: "running" }],
        figures: [{ what: "the agent claude-code", doing: "working with him", x: -2, y: 68 }],
        ducks: [{ x: 5, y: 80 }, { x: 30, y: 70 }, { x: 6, y: 81 }],
      }),
    );
    const words = sightInWords(sight);
    expect(words).toContain("Bors (with him), 5 m");
    expect(words).toContain('the experiment "Two-link arm" (running), about 45 m ahead');
    expect(words).toContain("the agent claude-code (working with him), 4 m");
    expect(words).toContain("3 Microducks, the nearest, about 15 m");
    expect(words).toContain("4 roe deer, the nearest (grazing), about 35 m ahead");
    expect(words).toContain("a kestrel (hovering), about 30 m");
    // The hares are behind him: not in view, so not said.
    expect(words).not.toContain("hare");
  });

  test("walls: in the workshop he sees its machines and not the land; from outside, the hall and nothing inside it", () => {
    const inside = sightInWords(buildSight(input({ x: 84.2, y: 6.2, eye: eyeAt(84.2, 6.2, Math.PI / 2, -0.2), activity: "workshop", label: "Looking in on the workshop", attention: { on: false, x: 0, y: 0, z: 0 }, dog: { x: 84.9, y: 5.2, name: "Bors", state: "with him" }, wild: [{ name: "Roe deer", count: 9, doing: "grazing", x: 84, y: 76, tall: 1.75, air: false }] })));
    expect(inside).toContain("He is in the workshop: looking in on the workshop.");
    expect(inside).toContain("the printer farm, 3 m");
    expect(inside).not.toContain("roe deer");
    expect(inside).not.toContain("the keep");
    expect(inside).not.toContain("the workshop hall");
    const outside = sightInWords(buildSight(input({ x: 60, y: 0, eye: eyeAt(60, 0, 0, -0.05), moving: true, activity: "workshop", label: "Looking in on the workshop" })));
    expect(outside).toContain("the workshop hall, about 45 m ahead");
    expect(outside).toContain("the hall's wide door");
    expect(outside).not.toContain("printer farm");
    expect(outside).not.toContain("test cell");
  });

  test("up on the proving ground its own things are named", () => {
    const words = sightInWords(buildSight(input({ x: -95, y: -30, z: 5, eye: eyeAt(-95, -30, 2.2, -0.05, 5 + EYE_HEIGHT), activity: "field", label: "Looking after the proving ground", attention: { on: false, x: 0, y: 0, z: 0 }, dog: { x: -94, y: -29, name: "Bors", state: "with him" }, ground: (x) => (x < -70 ? 5 : 0) })));
    expect(words).toContain("He is up on the proving ground");
    expect(words).toContain("the control tower, about 20 m a little to the right");
    expect(words).toContain("the windsock, about 20 m a little to the left");
    expect(words).not.toContain("on its heights");
  });

  test("asleep: his eyes are shut, and it says what's round him instead", () => {
    const words = sightInWords(buildSight(input({ shut: 1, activity: "sleep", label: "Asleep at his hearth, Bors beside him", x: -0.9, y: -18, eye: eyeAt(-1.9, -18, 0, 0.4, 0.8), dog: { x: -1, y: -18.85, name: "Bors", state: "asleep" }, attention: { on: false, x: 0, y: 0, z: 0 } })));
    expect(words).toContain("He is at his hearth, asleep: his eyes are shut, so he sees nothing now.");
    expect(words).toContain("Around him: Bors (asleep on its cushion)");
    expect(words).not.toContain("In his field of view");
  });
});

describe("the places a review looks from", () => {
  test("each is a place of his day he can stand at (clear of what's solid there), looking at what's there", () => {
    expect(Object.keys(EYE_PLACES).sort()).toEqual([...EYES_PLACES].sort());
    const solids = [...KEEP_COLLIDERS, ...HEARTH_COLLIDERS];
    for (const [name, p] of Object.entries(EYE_PLACES)) {
      // (What stops only the camera, and what's overhead, doesn't stop him.)
      for (const c of solids) if (c.stops !== "camera" && (c.bottom ?? 0) < 1.5) expect([name, inCollider(c, p.x, p.y)]).toEqual([name, false]);
      expect(Math.abs(p.pitch)).toBeLessThan(0.3);
    }
    // From the camp's gate his hearth is in view; from behind the bench, the bench and the lake.
    const from = (name: keyof typeof EYE_PLACES) => eyeAt(EYE_PLACES[name].x, EYE_PLACES[name].y, EYE_PLACES[name].heading, EYE_PLACES[name].pitch);
    expect(inView(from("hearth"), { what: "the fire", x: FIRE.x, y: FIRE.y, z: 0, h: 1.6, rank: 8 })).toBe(true);
    expect(inView(from("bench"), { what: "the bench", x: BENCH.x, y: BENCH.y, z: 0, h: 0.9, rank: 6 })).toBe(true);
    expect(inView(from("council"), { what: "the council table", x: STATIONS.council.x, y: STATIONS.council.y, z: 0, h: 3, rank: 4 })).toBe(true);
    expect(inView(from("forge"), { what: "the forge", x: STATIONS.forge.x, y: STATIONS.forge.y, z: 0, h: 3, rank: 4 })).toBe(true);
    expect(EYE_PLACES.meadow.y).toBeGreaterThan(60);
    const words = sightInWords(buildSight(input({ eye: from("bench"), from: "the bench by the lake" })));
    expect(words).toContain("This view is from the bench by the lake, where he'd stand; he himself is at his hearth");
    expect(words).toContain("the bench by the lake, 2 m ahead");
    expect(words).toContain("the lake");
  });
});

describe("what the panel may cost, by tier", () => {
  test("small and seldom: a few frames a second into a small canvas, more where there's room", () => {
    expect(TIERS.low.eyes).toEqual({ width: 192, fps: 2 });
    expect(TIERS.medium.eyes).toEqual({ width: 256, fps: 5 });
    expect(TIERS.high.eyes).toEqual({ width: 384, fps: 12 });
    for (const tier of Object.values(TIERS)) {
      // The panel's pixels a second are a small share of the main view's at 1280 × 800 and 30 frames a second.
      const share = (tier.eyes.width * (tier.eyes.width / 1.6) * tier.eyes.fps) / (1280 * 800 * 30);
      expect(share).toBeLessThan(0.04);
    }
  });
});
