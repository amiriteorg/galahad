import { describe, expect, test } from "bun:test";
import { capsOf, roomOf } from "../fauna.ts";
import { seasonOf } from "../season.ts";
import { TIERS, type TierName } from "../tiers.ts";
import { plainHabitat } from "./habitat.ts";
import { Insects } from "./insects.ts";
import { batch, MESHES, Poser } from "./pose.ts";
import { Ecosystem, emptyEnv } from "./sim.ts";
import { KIND_COUNT, SPECS } from "./species.ts";
import * as S from "./species.ts";

/*
 * What the whole ecosystem costs a frame on the CPU, tier by tier: the simulation's step, the insects, and the
 * pose written for every instance (everything but the GPU's upload). The old fauna (a flock, three herds that
 * wandered, fireflies) cost 5, 11 and 26 µs a frame on the machine this was written on (low, medium, high); the
 * ecosystem measures 9 to 15, 19 to 30 and 26 to 73 there, and is held to a budget of 60, 110 and 200 µs: about a
 * hundredth of a 60 Hz frame at most, with room for a phone's CPU a few times slower.
 */

/** Microseconds a frame, by tier. */
const BUDGET: Record<TierName, number> = { low: 60, medium: 110, high: 200 };

function rig(name: TierName, year: number, night: number, evening: number) {
  const tier = TIERS[name];
  const caps = capsOf(tier);
  const habitat = plainHabitat();
  const eco = new Ecosystem(habitat, { caps, reach: tier.wild.reach, seed: 5 });
  const insects = new Insects(habitat, caps.insects, caps.fireflies);
  insects.lights.set([2, -18, 2.5], 0);
  insects.lightCount = eco.wings.lightCount = 1;
  const room = roomOf(eco, caps);
  const batches = MESHES.map((m) => batch(room[m]));
  const poser = new Poser(eco, insects);
  const env = emptyEnv();
  seasonOf(year, env.season);
  env.night = night;
  env.twilight = Math.max(0, 1 - Math.abs(night - 0.45) / 0.45);
  env.evening = evening;
  env.lamps = night > 0.4 ? 1 : 0;
  let t = 0;
  const frame = (): number => {
    // He walks about, his dog trotting round him: the animals near them have something to notice.
    t += 1 / 60;
    env.gx = Math.cos(t * 0.05) * 30;
    env.gy = Math.sin(t * 0.05) * 30;
    env.dx = env.gx + Math.cos(t * 0.7) * 3;
    env.dy = env.gy + Math.sin(t * 0.7) * 3;
    env.fx = env.gx;
    env.fy = env.gy;
    eco.step(1 / 60, env);
    insects.step(1 / 60, env, eco.midges);
    return poser.write(batches, 0, 0, habitat.height, t, env.season);
  };
  return { eco, insects, batches, frame };
}

/** The fastest of a few batches: what the code costs, not what the machine was busy with (the suite runs alongside). */
function cost(frame: () => number, frames = 400, batches = 6): number {
  let per = Infinity;
  for (let b = 0; b < batches; b++) {
    const t0 = performance.now();
    for (let k = 0; k < frames; k++) frame();
    per = Math.min(per, (performance.now() - t0) / frames);
  }
  return per * 1000;
}

describe("the ecosystem's budget", () => {
  for (const name of ["low", "medium", "high"] as const) {
    test(`${name}: a summer's day, a spring dusk with the murmuration up, and a summer night each fit the frame's budget`, () => {
      const lines: string[] = [];
      for (const [what, year, night, evening] of [
        ["summer's day", 0.5, 0, 0],
        ["spring dusk, the starlings up", 0.25, 0.5, 1],
        ["summer night", 0.5, 0.95, 1],
      ] as const) {
        const { eco, insects, frame } = rig(name, year, night, evening);
        // Everyone's arrived and about their business before it's timed.
        for (let k = 0; k < 60 * 40; k++) frame();
        const us = cost(frame);
        let animals = 0;
        for (let k = 0; k < KIND_COUNT; k++) animals += eco.count[k]!;
        const bugs = insects.count.reduce((a, b) => a + b, 0) + (insects.fireflyLevel > 0.1 ? insects.fireflies : 0);
        lines.push(`${what} ${us.toFixed(0)} µs (${animals} animals, ${bugs} insects)`);
        expect(us).toBeLessThan(BUDGET[name]);
        // (And there is someone to pay for.)
        expect(animals).toBeGreaterThan(name === "low" ? 6 : 15);
        if (what.startsWith("spring dusk")) expect(eco.count[S.STARLING]!).toBeGreaterThan(TIERS[name].wild.starling * 0.6);
      }
      console.log(`eco budget, ${name}: ${lines.join("; ")}; budget ${BUDGET[name]} µs`);
    });
  }

  test("every population is capped by its tier, the caps grow with the tier, and no frame draws more than it has room for", () => {
    for (const k of ["fox", "hedgehog", "squirrel", "swan", "heron", "fish", "swallow", "starling", "goose", "kestrel", "owl", "bat", "insects", "reach"] as const) {
      expect(TIERS.low.wild[k]).toBeLessThanOrEqual(TIERS.medium.wild[k]);
      expect(TIERS.medium.wild[k]).toBeLessThanOrEqual(TIERS.high.wild[k]);
    }
    for (const name of ["low", "medium", "high"] as const) {
      const { eco, batches, frame } = rig(name, 0.42, 0.3, 1);
      for (let k = 0; k < 60 * 60; k++) {
        frame();
        if (k % 20) continue;
        for (const b of batches) expect(b.count).toBeLessThanOrEqual(b.room);
        for (let s = 0; s < KIND_COUNT; s++) {
          const cap = capsOf(TIERS[name])[SPECS[s]!.kind];
          expect(eco.count[s]! - eco.young[s]!).toBeLessThanOrEqual(cap + Math.ceil(cap / 2));
          if (!cap) expect(eco.count[s]).toBe(0);
        }
      }
    }
  });

  test("a step and a pose allocate nothing: the same arrays, frame after frame", () => {
    const { batches, frame } = rig("high", 0.5, 0.2, 1);
    for (let k = 0; k < 600; k++) frame();
    const before = batches.map((b) => b.data);
    const heap = process.memoryUsage().heapUsed;
    for (let k = 0; k < 3000; k++) frame();
    batches.forEach((b, i) => expect(b.data).toBe(before[i]!));
    // (Not a byte-exact claim, the runtime has its own business: but nothing that grows with the frames.)
    expect(process.memoryUsage().heapUsed - heap).toBeLessThan(6e6);
  });
});
