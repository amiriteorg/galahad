import { describe, expect, test } from "bun:test";
import { seasonOf } from "../season.ts";
import { WATER_LEVEL } from "../terrain.ts";
import { FOREST, MEADOW, plainHabitat } from "./habitat.ts";
import { CAUGHT, Ecosystem, emptyEnv, type Env } from "./sim.ts";
import * as S from "./species.ts";
import { type Caps, KIND_COUNT, KINDS, NO_CAPS } from "./species.ts";

/*
 * The ecosystem, run by hand on a made-up piece of country (a meadow in flower, a round lake 60 m east, a wood to
 * the north-west): for simulated years, and for the minutes in which an animal grazes, drinks, takes fright and
 * settles. No GPU, no clock: every run is the same for its seed.
 */

/** What a desktop draws. */
const FULL: Caps = { ...NO_CAPS, roe: 8, hare: 12, fox: 2, hedgehog: 2, squirrel: 4, mallard: 8, swan: 2, heron: 1, fish: 16, songbird: 48, swallow: 10, starling: 160, goose: 13, kestrel: 1, owl: 1, bat: 8 };

/** The sun for a test: how far through a day and night (0 midnight, 0.5 noon). */
function sun(env: Env, day: number): void {
  env.night = Math.max(0, Math.min(1, 0.5 + Math.cos(day * Math.PI * 2) * 1.4 - 0.2));
  env.twilight = Math.max(0, 1 - Math.abs(env.night - 0.45) / 0.45);
  env.evening = day > 0.5 ? 1 : 0;
}

function world(caps: Caps, options: { seed?: number; year?: number; day?: number; arrivals?: number; yearDays?: number; reach?: number } = {}) {
  const eco = new Ecosystem(plainHabitat(), { caps, seed: options.seed ?? 7, arrivals: options.arrivals, yearDays: options.yearDays, reach: options.reach });
  const env = emptyEnv();
  seasonOf(options.year ?? 0.45, env.season);
  sun(env, options.day ?? 0.5);
  return { eco, env };
}

/** Runs for `seconds`, calling `each` (if given) every step. */
function run(eco: Ecosystem, env: Env, seconds: number, each?: (t: number) => void, dt = 1 / 30): void {
  for (let t = 0; t < seconds; t += dt) {
    eco.step(dt, env);
    each?.(t);
  }
}

const of = (eco: Ecosystem, k: number): number[] => {
  const out: number[] = [];
  for (let i = eco.first[k]!; i < eco.first[k + 1]!; i++) if (eco.alive[i] && !eco.going[i]) out.push(i);
  return out;
};

/** Years at speed: half-second steps, a day and a night every three days of living, the season turning with the year. */
function years(eco: Ecosystem, env: Env, n: number, start: number, sample: (year: number) => void, perYear = 2): void {
  const dt = 0.5;
  const steps = Math.round(eco.yearDays / eco.pace / dt);
  const every = Math.round(steps / perYear);
  for (let step = 0; step < n * steps; step++) {
    const year = start + step / steps;
    seasonOf(year % 1, env.season);
    sun(env, (eco.days / 3) % 1);
    eco.step(dt, env);
    if (step % every === every - 1) sample(year);
  }
}

describe("the ecosystem over the years", () => {
  test("it stays alive and within its bounds: every resident through four years, their young in season, the migrants in their months", () => {
    const { eco, env } = world(FULL, { yearDays: 36 });
    const residents = [S.ROE, S.HARE, S.FOX, S.MALLARD, S.SWAN, S.FISH, S.SONGBIRD];
    const seen = new Int32Array(KIND_COUNT);
    const young = { spring: 0, winter: 0 };
    const months = { swallowsSummer: 0, swallowsWinter: 0, hedgehogWinter: 0, hedgehogSummer: 0, starlingsAutumn: 0, starlingsSummer: 0, geeseAutumn: 0, geeseSummer: 0, batsWinter: 0 };
    let samples = 0;
    years(
      eco,
      env,
      4,
      0.3,
      (year) => {
        samples++;
        const y = year % 1;
        for (let k = 0; k < KIND_COUNT; k++) {
          // Never more than there's room for: the grown ones the device may draw, and their young.
          expect(eco.count[k]!).toBeLessThanOrEqual(eco.first[k + 1]! - eco.first[k]!);
          expect(eco.count[k]! - eco.young[k]!).toBeLessThanOrEqual(eco.grownCap[k]! + Math.ceil(eco.grownCap[k]! / 2));
          expect(eco.young[k]!).toBeGreaterThanOrEqual(0);
          if (eco.count[k]! > 0) seen[k] = seen[k]! + 1;
        }
        const born = eco.young[S.ROE]! + eco.young[S.HARE]! + eco.young[S.MALLARD]! + eco.young[S.FOX]!;
        if (y > 0.4 && y < 0.6) young.spring += born;
        if (y > 0.95 || y < 0.2) young.winter += eco.young[S.ROE]! + eco.young[S.MALLARD]!;
        const shown = (k: number) => of(eco, k).filter((i) => eco.shown[i]! > 0.5).length;
        if (y > 0.45 && y < 0.65) {
          months.swallowsSummer += eco.came[S.SWALLOW]!;
          months.hedgehogSummer += eco.count[S.HEDGEHOG]!;
          months.starlingsSummer += eco.count[S.STARLING]!;
          months.geeseSummer += eco.count[S.GOOSE]!;
        }
        if (y > 0.95 || y < 0.12) {
          months.swallowsWinter += eco.count[S.SWALLOW]!;
          months.hedgehogWinter += shown(S.HEDGEHOG);
          months.batsWinter += eco.count[S.BAT]!;
        }
        if (y > 0.72 && y < 0.86) {
          months.starlingsAutumn += eco.came[S.STARLING]! + eco.count[S.STARLING]!;
          months.geeseAutumn += eco.came[S.GOOSE]!;
        }
      },
      12,
    );
    // Alive: the residents are there nearly always (a fox may be between one and the next).
    for (const k of residents) expect(seen[k]! / samples, KINDS[k]).toBeGreaterThan(k === S.FOX || k === S.SWAN ? 0.7 : 0.95);
    // Young in spring and summer, born here; grown (or gone) by the winter after.
    expect(young.spring).toBeGreaterThan(6);
    expect(young.winter).toBeLessThan(young.spring / 2);
    expect(eco.births[S.HARE]!).toBeGreaterThan(4);
    expect(eco.births[S.ROE]! + eco.births[S.MALLARD]! + eco.births[S.FISH]! + eco.births[S.SONGBIRD]!).toBeGreaterThan(8);
    // The months: swallows in summer and never in winter, the hedgehog asleep out of sight through the cold, bats gone;
    // starlings and geese in the autumn (and spring) and not at midsummer.
    expect(months.swallowsSummer).toBeGreaterThan(0);
    expect(months.swallowsWinter).toBe(0);
    expect(months.hedgehogSummer).toBeGreaterThan(0);
    expect(months.hedgehogWinter).toBe(0);
    expect(months.batsWinter).toBe(0);
    expect(months.starlingsSummer).toBe(0);
    expect(months.geeseSummer).toBe(0);
    expect(eco.came[S.GOOSE]!).toBeGreaterThan(0);
    // Everyone who died had a cause, and nothing was eaten but what's eaten.
    expect(eco.deaths[CAUGHT]![S.ROE]).toBe(0);
    console.log(`eco, four years: births ${[...eco.births].map((b, k) => (b ? `${KINDS[k]} ${b}` : "")).filter(Boolean).join(", ")}; caught ${[...eco.deaths[CAUGHT]!].map((b, k) => (b ? `${KINDS[k]} ${b}` : "")).filter(Boolean).join(", ")}`);
  }, 60_000);

  test("predators and prey rise and fall against each other: many foxes bring the hares down, the foxes dwindle, the hares come back", () => {
    // The hare and the fox alone, more of them than a view holds (so their numbers mean something), on a range the
    // country beyond barely tops up: enough that neither is lost for good.
    // (Every seed tried gives the same cycle, at its own time: eight of them, 18 years each, while this was written.)
    const { eco, env } = world({ ...NO_CAPS, hare: 60, fox: 8 }, { seed: 11, yearDays: 36, reach: 150, arrivals: 0.1 });
    const hares: number[] = [];
    const foxes: number[] = [];
    years(eco, env, 18, 0.3, () => {
      hares.push(eco.count[S.HARE]!);
      foxes.push(eco.count[S.FOX]!);
    });
    const mean = (a: number[]): number => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
    // Bounded, and never lost.
    expect(Math.max(...hares)).toBeLessThanOrEqual(90);
    expect(Math.max(...foxes)).toBeLessThanOrEqual(12);
    expect(hares.at(-1)!).toBeGreaterThan(0);
    expect(foxes.at(-1)!).toBeGreaterThan(0);
    // Both rise and fall, by a lot.
    expect(Math.max(...hares)).toBeGreaterThan(55);
    expect(Math.min(...hares)).toBeLessThan(Math.max(...hares) * 0.5);
    expect(Math.max(...foxes)).toBeGreaterThanOrEqual(9);
    expect(Math.min(...foxes)).toBeLessThanOrEqual(4);
    // Against each other: the more foxes there are, the more the hares fall over the year that follows (and the
    // fewer, the more they rise): the two series are tied, with the sign a predator gives its prey.
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
    const tied = both / Math.sqrt(cc * ff);
    expect(tied).toBeLessThan(-0.2);
    // The hares' lowest came under many foxes: over the two years before it they averaged most of what the range holds.
    const low = hares.indexOf(Math.min(...hares));
    expect(mean(foxes.slice(Math.max(0, low - 4), low + 1))).toBeGreaterThanOrEqual(6);
    // And it was the foxes that did it: most hares that died in these years were caught.
    expect(eco.deaths[CAUGHT]![S.HARE]!).toBeGreaterThan(eco.deaths[0]![S.HARE]! + eco.deaths[1]![S.HARE]!);
    console.log(`eco: the foxes' numbers against the hares' change over the following year: r = ${tied.toFixed(2)}`);
    console.log(`eco, hares and foxes over 18 years (two samples a year):\n  hares ${hares.join(" ")}\n  foxes ${foxes.join(" ")}`);
  }, 120_000);

  test("without foxes nothing catches a hare, and the land alone bounds them", () => {
    const { eco, env } = world({ ...NO_CAPS, hare: 60, fox: 0 }, { yearDays: 36, reach: 150, arrivals: 0.1 });
    const hares: number[] = [];
    years(eco, env, 6, 0.3, () => hares.push(eco.count[S.HARE]!));
    expect(eco.deaths[CAUGHT]![S.HARE]).toBe(0);
    expect(Math.min(...hares)).toBeGreaterThan(40);
    expect(Math.max(...hares)).toBeLessThanOrEqual(90);
  }, 60_000);

  test("the same seed gives the same years, to the last animal; another seed, others", () => {
    const fingerprint = (seed: number): string => {
      const { eco, env } = world(FULL, { seed, yearDays: 36 });
      years(eco, env, 0.6, 0.3, () => {});
      let sum = 0;
      for (let i = 0; i < eco.n; i++) if (eco.alive[i]) sum += eco.x[i]! * 1.3 + eco.y[i]! * 0.7 + eco.energy[i]! + eco.doing[i]! + i;
      return `${[...eco.count].join(",")}|${[...eco.births].join(",")}|${sum.toFixed(6)}`;
    };
    const a = fingerprint(11);
    expect(fingerprint(11)).toBe(a);
    expect(fingerprint(12)).not.toBe(a);
  }, 60_000);
});

describe("what an animal does, by what it needs", () => {
  test("they graze where the grass is, and eat it down", () => {
    const { eco, env } = world(FULL);
    let grazing = 0;
    let onGrass = 0;
    let ate = 0;
    run(eco, env, 240, (t) => {
      if (Math.round(t * 30) % 30) return;
      for (const k of [S.ROE, S.HARE]) {
        for (const i of of(eco, k)) {
          if (eco.doing[i] !== S.GRAZE || eco.speed[i]! > 0.05 || eco.nod[i]! > -0.6) continue;
          grazing++;
          const at = eco.patches.at(eco.x[i]!, eco.y[i]!);
          const code = eco.patches.code[at]!;
          if (code === MEADOW || code === FOREST) onGrass++;
          if (eco.patches.graze[at]! + eco.patches.browse[at]! < 6.5) ate++;
        }
      }
    });
    expect(grazing).toBeGreaterThan(40);
    expect(onGrass / grazing).toBeGreaterThan(0.9);
    expect(ate).toBeGreaterThan(0);
    // Fed: nobody is starving in a summer meadow.
    for (const k of [S.ROE, S.HARE]) for (const i of of(eco, k)) expect(eco.energy[i]! / eco.specs[k]!.reserve).toBeGreaterThan(0.3);
  });

  test("a thirsty deer goes to the water's edge, drinks there with its head down, and isn't thirsty after", () => {
    const { eco, env } = world({ ...NO_CAPS, roe: 2 });
    run(eco, env, 1);
    const deer = of(eco, S.ROE)[0]!;
    eco.thirst[deer] = 0.95;
    let drank = false;
    let nearest = Infinity;
    run(eco, env, 260, () => {
      if (eco.doing[deer] !== S.DRINK || eco.speed[deer]! > 0.01 || eco.nod[deer]! > -0.9) return;
      drank = true;
      // At the edge: on dry ground, a stride from the water.
      const x = eco.x[deer]!;
      const y = eco.y[deer]!;
      expect(eco.habitat.height(x, y)).toBeGreaterThan(WATER_LEVEL);
      nearest = Math.min(nearest, Math.hypot(x - 60, y) - 34);
    });
    expect(drank).toBe(true);
    expect(nearest).toBeLessThan(2.5);
    expect(eco.thirst[deer]!).toBeLessThan(0.5);
  });

  test("tired, and at night, they lie up in cover: the wood, when it's near", () => {
    const { eco, env } = world({ ...NO_CAPS, roe: 4 }, { day: 0 });
    run(eco, env, 1);
    for (const i of of(eco, S.ROE)) {
      // Set down beside the wood, worn out.
      eco.x[i] = -20 + (i % 3) * 3;
      eco.y[i] = 20 + (i % 2) * 3;
      eco.tired[i] = 0.95;
      eco.energy[i] = eco.specs[S.ROE]!.reserve;
    }
    run(eco, env, 90);
    const deer = of(eco, S.ROE);
    const lying = deer.filter((i) => eco.lie[i]! > 0.9);
    expect(lying.length).toBeGreaterThanOrEqual(deer.length - 1);
    for (const i of lying) expect(eco.patches.code[eco.patches.at(eco.x[i]!, eco.y[i]!)]).toBe(FOREST);
  });

  test("a herd keeps together, and one of them keeps watch while the others feed, each in turn", () => {
    const { eco, env } = world({ ...NO_CAPS, roe: 4 }, { day: 0.3 });
    run(eco, env, 1);
    const deer = of(eco, S.ROE);
    for (const i of deer) {
      eco.group[i] = deer[0]!;
      eco.x[i] = 10 + (i % 2) * 4;
      eco.y[i] = -40 + (i % 3) * 4;
      eco.energy[i] = eco.specs[S.ROE]!.reserve * 0.5;
      eco.thirst[i] = 0;
    }
    const watchers = new Set<number>();
    let together = 0;
    let looks = 0;
    let watchedWhileFeeding = 0;
    run(eco, env, 200, (t) => {
      if (Math.round(t * 30) % 15) return;
      const cx = deer.reduce((s, i) => s + eco.x[i]!, 0) / deer.length;
      const cy = deer.reduce((s, i) => s + eco.y[i]!, 0) / deer.length;
      looks++;
      if (deer.every((i) => Math.hypot(eco.x[i]! - cx, eco.y[i]! - cy) < 22)) together++;
      const watching = deer.filter((i) => eco.doing[i] === S.WATCH);
      for (const i of watching) watchers.add(i);
      // Never more than one at a time; and its head is up while another's is down.
      expect(watching.length).toBeLessThanOrEqual(1);
      if (watching.length && eco.nod[watching[0]!]! > 0.3 && deer.some((i) => eco.doing[i] === S.GRAZE && eco.nod[i]! < -0.5)) watchedWhileFeeding++;
    });
    expect(together / looks).toBeGreaterThan(0.9);
    expect(watchers.size).toBeGreaterThanOrEqual(2);
    expect(watchedWhileFeeding).toBeGreaterThan(3);
  });
});

describe("they notice Galahad and his dog", () => {
  /** Walks someone from `from` towards (x, y) at `speed`, stopping `short` of it; returns where they are. */
  const approach = (env: Env, who: "g" | "d", from: { x: number; y: number }, x: number, y: number, speed: number, t: number, short = 0) => {
    const d = Math.hypot(x - from.x, y - from.y);
    const gone = Math.min(Math.max(0, d - short), speed * t);
    const px = from.x + ((x - from.x) / d) * gone;
    const py = from.y + ((y - from.y) / d) * gone;
    if (who === "g") {
      env.gx = px;
      env.gy = py;
    } else {
      env.dx = px;
      env.dy = py;
    }
    return Math.hypot(x - px, y - py);
  };

  test("a deer lifts its head as he walks by, moves off if he comes close, and bolts only when he's on top of it", () => {
    const { eco, env } = world({ ...NO_CAPS, roe: 1 });
    run(eco, env, 1);
    const deer = of(eco, S.ROE)[0]!;
    eco.x[deer] = 0;
    eco.y[deer] = -60;
    eco.tx[deer] = 0;
    eco.ty[deer] = -60;
    eco.thirst[deer] = 0;
    eco.energy[deer] = eco.specs[S.ROE]!.reserve * 0.5;
    run(eco, env, 20);
    // He walks past, 17 m off at his nearest: heads up, no running.
    const start = { x: -60, y: eco.y[deer]! + 17 };
    let lifted = false;
    let ran = false;
    run(eco, env, 60, (t) => {
      approach(env, "g", start, 60, start.y, 1.4, t);
      if (eco.doing[deer] === S.ALERT && eco.nod[deer]! > 0.3) lifted = true;
      if (eco.doing[deer] === S.FLEE) ran = true;
    });
    expect(lifted).toBe(true);
    expect(ran).toBe(false);
    // Now he walks straight at it: it moves off at a walk and keeps its distance; nobody has to run.
    const here = { x: eco.x[deer]! + 40, y: eco.y[deer]! };
    const target = { x: eco.x[deer]!, y: eco.y[deer]! };
    let movedOff = false;
    let nearest = Infinity;
    run(eco, env, 40, (t) => {
      approach(env, "g", here, target.x - 60, target.y, 1.3, t);
      const d = Math.hypot(eco.x[deer]! - env.gx, eco.y[deer]! - env.gy);
      nearest = Math.min(nearest, d);
      if (eco.doing[deer] === S.WALK && eco.speed[deer]! > 0.8 && d < 20) movedOff = true;
      if (eco.doing[deer] === S.FLEE) ran = true;
    });
    expect(movedOff).toBe(true);
    expect(ran).toBe(false);
    expect(nearest).toBeGreaterThan(8);
    // He runs at it: it bolts while he's still well off, in a burst several times its walk.
    const from = { x: env.gx, y: env.gy };
    const at = { x: eco.x[deer]!, y: eco.y[deer]! };
    let boltedAt = Infinity;
    let fastest = 0;
    run(eco, env, 8, (t) => {
      approach(env, "g", from, at.x, at.y, 5.5, t, 1);
      if (eco.doing[deer] !== S.FLEE) return;
      boltedAt = Math.min(boltedAt, Math.hypot(eco.x[deer]! - env.gx, eco.y[deer]! - env.gy));
      fastest = Math.max(fastest, eco.speed[deer]!);
    });
    expect(boltedAt).toBeLessThan(16);
    expect(boltedAt).toBeGreaterThan(4);
    expect(fastest).toBeGreaterThan(5);
    // He stops; it pulls up, looks back, and goes back to its day.
    let settled = false;
    run(eco, env, 60, () => {
      if (eco.doing[deer] === S.SETTLE) settled = true;
    });
    expect(settled).toBe(true);
    expect([S.FLEE, S.SETTLE]).not.toContain(eco.doing[deer]!);
    expect(eco.speed[deer]!).toBeLessThan(2);
  });

  test("the dog running at a hare makes it bolt from much farther than he does walking by; its head comes up first", () => {
    const boltDistance = (who: "g" | "d", speed: number): number => {
      const { eco, env } = world({ ...NO_CAPS, hare: 1 });
      run(eco, env, 1);
      const hare = of(eco, S.HARE)[0]!;
      eco.x[hare] = 0;
      eco.y[hare] = -50;
      eco.tx[hare] = 0;
      eco.ty[hare] = -50;
      eco.energy[hare] = eco.specs[S.HARE]!.reserve * 0.4;
      eco.thirst[hare] = 0;
      run(eco, env, 15);
      const from = { x: eco.x[hare]! - 45, y: eco.y[hare]! };
      const to = { x: eco.x[hare]!, y: eco.y[hare]! };
      let at = Infinity;
      let headUpFirst = false;
      run(eco, env, 40, (t) => {
        const d = approach(env, who, from, to.x, to.y, speed, t, 0.5);
        if (eco.doing[hare] === S.FLEE && at === Infinity) {
          at = d;
          headUpFirst = eco.speed[hare]! < 0.5;
        }
      });
      expect(headUpFirst).toBe(true);
      return at;
    };
    const walking = boltDistance("g", 1.4);
    const dog = boltDistance("d", 6);
    expect(walking).toBeLessThan(8);
    expect(dog).toBeGreaterThan(walking * 1.5);
    expect(dog).toBeGreaterThan(9);
  });

  test("ducks ashore take to the water when the dog runs at them", () => {
    const { eco, env } = world({ ...NO_CAPS, mallard: 4 });
    run(eco, env, 1);
    const ducks = of(eco, S.MALLARD);
    // Out on the bank on the lake's west side, preening.
    ducks.forEach((i, n) => {
      eco.x[i] = 60 - 34.6;
      eco.y[i] = -2 + n * 1.2;
      eco.doing[i] = S.PREEN;
      eco.timer[i] = 60;
      eco.tx[i] = eco.x[i]!;
      eco.ty[i] = eco.y[i]!;
      eco.think[i] = 1;
    });
    for (const i of ducks) expect(eco.afloat(eco.x[i]!, eco.y[i]!)).toBe(false);
    const from = { x: -15, y: 0 };
    let flapped = false;
    run(eco, env, 12, (t) => {
      approach(env, "d", from, 26, 0, 6, t, 0.5);
      if (ducks.some((i) => eco.doing[i] === S.FLEE && eco.amount[i]! > 0.5)) flapped = true;
    });
    expect(flapped).toBe(true);
    for (const i of ducks) expect(eco.afloat(eco.x[i]!, eco.y[i]!)).toBe(true);
    // And off from the bank he's at.
    for (const i of ducks) expect(Math.hypot(eco.x[i]! - env.dx, eco.y[i]! - env.dy)).toBeGreaterThan(3);
  });

  test("the dog's side: the nearest small thing worth a chase, and a fright that sends everything near running", () => {
    const { eco, env } = world({ ...NO_CAPS, hare: 3, roe: 2 });
    run(eco, env, 1);
    const hares = of(eco, S.HARE);
    hares.forEach((i, n) => {
      eco.x[i] = n * 30;
      eco.y[i] = -70;
    });
    const out = { x: 0, y: 0, kind: "", slot: -1 };
    expect(eco.nearestSmall(31, -68, 12, out)).toBe(true);
    expect(out.kind).toBe("hare");
    expect(out.slot).toBe(hares[1]!);
    expect(Math.hypot(out.x - 30, out.y + 70)).toBeLessThan(0.01);
    // Nothing small within reach: no. (A deer isn't small.)
    const deer = of(eco, S.ROE)[0]!;
    eco.x[deer] = 0;
    eco.y[deer] = 60;
    expect(eco.nearestSmall(0, 58, 6, out)).toBe(false);
    // A fright: the hare by it runs; the one 60 m off doesn't.
    eco.startle(1, -69, 10);
    expect(eco.doing[hares[0]!]).toBe(S.FLEE);
    expect(eco.doing[hares[2]!]).not.toBe(S.FLEE);
    run(eco, env, 3);
    expect(Math.hypot(eco.x[hares[0]!]! - 1, eco.y[hares[0]!]! + 69)).toBeGreaterThan(10);
  });

  test("a squirrel goes up the nearest trunk, round to its far side, and comes down when he's gone", () => {
    const { eco, env } = world({ ...NO_CAPS, squirrel: 1 });
    run(eco, env, 1);
    const sq = of(eco, S.SQUIRREL)[0]!;
    const ground = eco.habitat.height(eco.x[sq]!, eco.y[sq]!);
    env.gx = eco.x[sq]! + 16;
    env.gy = eco.y[sq]!;
    let high = 0;
    let far = false;
    run(eco, env, 20, () => {
      // He walks up to it, wherever it goes, and stands by it.
      const d = Math.hypot(eco.x[sq]! - env.gx, eco.y[sq]! - env.gy);
      if (d > 2) {
        env.gx += ((eco.x[sq]! - env.gx) / d) * 1.4 * (1 / 30);
        env.gy += ((eco.y[sq]! - env.gy) / d) * 1.4 * (1 / 30);
      }
      if (!eco.air[sq]) return;
      high = Math.max(high, eco.z[sq]! - ground);
      // The trunk between it and him.
      const toHim = Math.atan2(env.gy - eco.homeY[sq]!, env.gx - eco.homeX[sq]!);
      const side = Math.atan2(eco.y[sq]! - eco.homeY[sq]!, eco.x[sq]! - eco.homeX[sq]!);
      if (Math.cos(toHim - side) < -0.7) far = true;
    });
    expect(eco.doing[sq]).toBe(S.CLIMB);
    expect(high).toBeGreaterThan(1);
    expect(far).toBe(true);
    env.gx = Number.NaN;
    run(eco, env, 40);
    expect(eco.air[sq]).toBe(0);
  });
});

describe("the hour, the weather and the months", () => {
  test("the hedgehog is out only at night: by day it's under its bush, unseen", () => {
    const { eco, env } = world({ ...NO_CAPS, hedgehog: 2 }, { day: 0.5 });
    run(eco, env, 20);
    for (const i of of(eco, S.HEDGEHOG)) expect(eco.shown[i]!).toBeLessThan(0.05);
    sun(env, 0);
    let foraged = false;
    run(eco, env, 120, () => {
      for (const i of of(eco, S.HEDGEHOG)) if (eco.shown[i]! > 0.9 && eco.doing[i] === S.FORAGE) foraged = true;
    });
    expect(foraged).toBe(true);
    // Someone comes right up to it: it doesn't run, it curls.
    const hog = of(eco, S.HEDGEHOG)[0]!;
    env.gx = eco.x[hog]! + 1.5;
    env.gy = eco.y[hog]!;
    run(eco, env, 2);
    expect(eco.doing[hog]).toBe(S.CURL);
    expect(eco.speed[hog]!).toBeLessThan(0.05);
  });

  test("songbirds feed by day, are in the trees through the night, and leave them at dawn; someone under their tree flushes them", () => {
    const { eco, env } = world({ ...NO_CAPS, songbird: 24 }, { day: 0.5 });
    let fed = 0;
    run(eco, env, 150, () => {
      fed = Math.max(fed, of(eco, S.SONGBIRD).filter((i) => eco.doing[i] === S.PECK).length);
    });
    expect(fed).toBeGreaterThan(8);
    // Dusk, then night: every one of them in a tree, wings folded.
    sun(env, 0.92);
    run(eco, env, 60);
    sun(env, 0);
    run(eco, env, 30);
    const birds = of(eco, S.SONGBIRD);
    expect(birds.length).toBeGreaterThan(12);
    for (const i of birds) {
      expect(eco.doing[i]).toBe(S.ROOST);
      expect(eco.lie[i]!).toBeGreaterThan(0.9);
      // Up in a crown, not on the ground.
      expect(eco.z[i]! - eco.habitat.height(eco.x[i]!, eco.y[i]!)).toBeGreaterThan(2);
    }
    // He walks under their tree: out they go, and into others.
    const tree = { x: eco.x[birds[0]!]!, y: eco.y[birds[0]!]! };
    env.gx = tree.x + 0.5;
    env.gy = tree.y;
    let flying = 0;
    run(eco, env, 4, () => {
      flying = Math.max(flying, birds.filter((i) => eco.doing[i] === S.TO_ROOST || eco.doing[i] === S.FLY).length);
    });
    expect(flying).toBeGreaterThan(birds.length * 0.7);
    env.gx = Number.NaN;
    run(eco, env, 40);
    for (const i of of(eco, S.SONGBIRD)) expect(Math.hypot(eco.x[i]! - tree.x, eco.y[i]! - tree.y)).toBeGreaterThan(8);
    // Dawn: down to feed again.
    sun(env, 0.3);
    let down = 0;
    run(eco, env, 120, () => {
      down = Math.max(down, of(eco, S.SONGBIRD).filter((i) => eco.doing[i] === S.PECK).length);
    });
    expect(down).toBeGreaterThan(6);
  });

  test("in rain the land animals shelter and the songbirds keep to the trees; nothing hawks insects in it", () => {
    const { eco, env } = world({ ...FULL, starling: 0, goose: 0 }, { day: 0.5 });
    run(eco, env, 60);
    env.rain = 1;
    env.wind = 7;
    run(eco, env, 150);
    expect(of(eco, S.SONGBIRD).filter((i) => eco.doing[i] === S.PECK).length).toBe(0);
    expect(of(eco, S.SWALLOW).filter((i) => eco.doing[i] !== S.LEAVE).length).toBe(0);
    const land = [...of(eco, S.ROE), ...of(eco, S.HARE)];
    const sheltering = land.filter((i) => eco.doing[i] === S.SHELTER || eco.doing[i] === S.REST || eco.doing[i] === S.SLEEP).length;
    expect(sheltering / land.length).toBeGreaterThan(0.4);
  });

  test("swallows skim the lake in summer; bats come out at dusk; the kestrel hangs over the meadow by day and the owl hunts by night", () => {
    const { eco, env } = world(FULL, { day: 0.5, year: 0.5 });
    let skimming = 0;
    let hovering = 0;
    let hoverHeight = 0;
    let moved = 0;
    let last = { x: 0, y: 0 };
    run(eco, env, 240, () => {
      skimming = Math.max(skimming, of(eco, S.SWALLOW).filter((i) => eco.doing[i] === S.SKIM).length);
      const k = of(eco, S.KESTREL)[0];
      if (k !== undefined && eco.doing[k] === S.HOVER) {
        if (hovering > 30) moved = Math.max(moved, Math.hypot(eco.x[k]! - last.x, eco.y[k]! - last.y));
        else last = { x: eco.x[k]!, y: eco.y[k]! };
        hovering++;
        hoverHeight = eco.z[k]! - eco.habitat.height(eco.x[k]!, eco.y[k]!);
      } else hovering = 0;
    });
    expect(skimming).toBeGreaterThan(2);
    expect(eco.count[S.BAT]).toBe(0);
    expect(eco.count[S.OWL]).toBe(0);
    // It hung there: ten metres up and more, and didn't drift a metre.
    expect(hoverHeight).toBeGreaterThan(8);
    expect(moved).toBeLessThan(1);
    sun(env, 0.9);
    run(eco, env, 60);
    sun(env, 0);
    let owl = false;
    run(eco, env, 200, () => {
      if (eco.count[S.OWL]! > 0) owl = true;
    });
    expect(eco.count[S.BAT]!).toBeGreaterThan(2);
    expect(owl).toBe(true);
    expect(of(eco, S.SWALLOW).filter((i) => eco.doing[i] !== S.LEAVE).length).toBe(0);
    expect(of(eco, S.KESTREL).filter((i) => eco.doing[i] !== S.LEAVE).length).toBe(0);
    // Bats stay off the ground and in the range.
    for (const i of of(eco, S.BAT)) expect(eco.z[i]! - Math.max(eco.habitat.height(eco.x[i]!, eco.y[i]!), WATER_LEVEL)).toBeGreaterThan(1);
  });
});

describe("the lake's own chain", () => {
  test("fish keep to the water in shoals, rise at dusk when the hatch is on (rings), and scatter from someone at the bank", () => {
    const { eco, env } = world({ ...NO_CAPS, fish: 12 }, { day: 0.8, year: 0.5 });
    env.twilight = 1;
    let rises = 0;
    let rings = 0;
    run(eco, env, 240, () => {
      for (const i of of(eco, S.FISH)) {
        expect(eco.habitat.height(eco.x[i]!, eco.y[i]!)).toBeLessThan(WATER_LEVEL);
        if (eco.doing[i] === S.RISE) rises++;
      }
      rings = Math.max(rings, [...eco.rings].filter((v, n) => n % 4 === 2 && v < 1.5).length);
    });
    expect(rises).toBeGreaterThan(10);
    expect(rings).toBeGreaterThan(0);
    // Shoals: most fish have another within a couple of metres.
    const fish = of(eco, S.FISH);
    const near = fish.filter((i) => fish.some((j) => j !== i && Math.hypot(eco.x[i]! - eco.x[j]!, eco.y[i]! - eco.y[j]!) < 3)).length;
    expect(near / fish.length).toBeGreaterThan(0.6);
    // Someone on the bank beside one: it darts off.
    const one = fish[0]!;
    env.gx = eco.x[one]! + 2;
    env.gy = eco.y[one]!;
    const was = { x: eco.x[one]!, y: eco.y[one]! };
    run(eco, env, 2.5);
    expect(Math.hypot(eco.x[one]! - was.x, eco.y[one]! - was.y)).toBeGreaterThan(2.5);
  });

  test("the heron stands in the shallows, strikes, and flies off down the shore when he comes near", () => {
    const { eco, env } = world({ ...NO_CAPS, fish: 16, heron: 1 }, { year: 0.5 });
    let stood = false;
    let struck = false;
    run(eco, env, 500, () => {
      const h = of(eco, S.HERON)[0];
      if (h === undefined || eco.air[h]) return;
      const depth = WATER_LEVEL - eco.habitat.height(eco.x[h]!, eco.y[h]!);
      if (eco.doing[h] === S.FISHING) {
        stood = true;
        // Ankle to knee deep.
        expect(depth).toBeGreaterThan(0);
        expect(depth).toBeLessThan(0.45);
      }
      if (eco.doing[h] === S.STRIKE && eco.nod[h]! < -0.7) struck = true;
    });
    expect(stood).toBe(true);
    expect(struck).toBe(true);
    const h = of(eco, S.HERON)[0]!;
    while (eco.air[h]) run(eco, env, 1);
    const was = { x: eco.x[h]!, y: eco.y[h]! };
    env.gx = was.x - 6;
    env.gy = was.y;
    let flew = 0;
    run(eco, env, 20, () => {
      if (eco.alive[h] && eco.air[h]) flew = Math.max(flew, eco.z[h]! - WATER_LEVEL);
    });
    expect(flew).toBeGreaterThan(1.5);
    if (eco.alive[h]) expect(Math.hypot(eco.x[h]! - was.x, eco.y[h]! - was.y)).toBeGreaterThan(12);
  });

  test("mallards dabble and eat the weed down; ducklings follow their mother in a line", () => {
    const { eco, env } = world({ ...NO_CAPS, mallard: 4 }, { year: 0.42 });
    run(eco, env, 2);
    const mother = of(eco, S.MALLARD).find((i) => eco.female[i])!;
    for (const i of of(eco, S.MALLARD)) if (eco.mother[i]! >= 0) eco.remove(i);
    for (let n = 0; n < 3; n++) eco.bear(mother, 0.02);
    const ducklings = of(eco, S.MALLARD).filter((i) => eco.mother[i] === mother);
    expect(ducklings.length).toBe(3);
    let dabbled = false;
    let gaps = 0;
    let looks = 0;
    run(eco, env, 180, (t) => {
      if (of(eco, S.MALLARD).some((i) => eco.doing[i] === S.DABBLE && eco.pitch[i]! > 0.8)) dabbled = true;
      if (t < 30 || Math.round(t * 30) % 30) return;
      looks++;
      // Each within a few lengths of the one ahead.
      if (Math.hypot(eco.x[ducklings[0]!]! - eco.x[mother]!, eco.y[ducklings[0]!]! - eco.y[mother]!) < 2.5 && Math.hypot(eco.x[ducklings[1]!]! - eco.x[ducklings[0]!]!, eco.y[ducklings[1]!]! - eco.y[ducklings[0]!]!) < 2) gaps++;
    });
    expect(dabbled).toBe(true);
    expect(gaps / looks).toBeGreaterThan(0.7);
    // Small: under half a grown duck.
    expect(eco.sizeOf(ducklings[0]!, eco.specs[S.MALLARD]!)).toBeLessThan(0.6);
  });
});

describe("under reduced motion", () => {
  test("everyone is there, and nobody moves: standing, lying or afloat, the birds in their trees", () => {
    const { eco, env } = world(FULL);
    eco.still(env);
    expect(eco.count[S.ROE]!).toBeGreaterThan(2);
    expect(eco.count[S.SONGBIRD]!).toBeGreaterThan(10);
    const before = [...eco.x];
    for (let n = 0; n < 60; n++) eco.still(env);
    for (let i = 0; i < eco.n; i++) {
      if (!eco.alive[i]) continue;
      expect(eco.x[i]).toBe(before[i]!);
      expect(eco.speed[i]).toBe(0);
      expect(eco.amount[i]).toBe(0);
    }
    // The birds sit in trees, wings folded; nothing hangs in the air.
    for (const i of of(eco, S.SONGBIRD)) {
      expect(eco.doing[i]).toBe(S.PERCH);
      expect(eco.lie[i]).toBe(1);
    }
    for (const k of [S.SWALLOW, S.STARLING, S.GOOSE, S.BAT]) for (const i of of(eco, k)) expect(eco.shown[i]).toBe(0);
  });
});
