import { describe, expect, test } from "bun:test";
import { type ExperimentView, PADS } from "@galahad/core/world";
import { BUILDS, Solids } from "./collide.ts";
import { ProvingGround } from "./field.ts";
import { addPlants } from "./flora-plan.ts";
import { Workshop } from "./hall.ts";
import { KEEP_COLLIDERS } from "./keep-plan.ts";
import { Planner } from "./nav.ts";
import type { Place } from "./place.ts";
import { built, obstacles, PLACES, paceFor, plotGate, standAt, type Target, Walker } from "./path.ts";
import { plotColliders } from "./plot-plan.ts";
import { SITE_COLLIDERS, SITE_GATES } from "./sites.ts";
import { BASE_FLATS, BIG, CHUNK, chunkSamples, heightAt, plotFlat, SEED, waterAt } from "./terrain.ts";
import { TIERS } from "./tiers.ts";

/*
 * Galahad walking on the real land among the real solids: the keep and its
 * stations as planned (keep-plan.ts), the sites' walls and machines, the trees
 * and rocks the land grows, and the fences of a few plots on open land. From
 * every station to every other, to each site's gate, to every pad's gate and to
 * the plots: he gets there, never inside anything or in the water, never set
 * down by the last resort, and in about the time the straight walk would take.
 */

/** Plots on open land where the node would put them (cells of its spiral: world-hub.ts), one of them off a corner of the keep. */
const OPEN = [
  { x: 0, y: 110, size: 24 },
  { x: 110, y: -110, size: 48 },
  { x: -110, y: 110, size: 24 },
];
const experiments = OPEN.map((plot, i) => ({ id: `e${i}`, plot }) as unknown as ExperimentView);
const flats = [...BASE_FLATS, ...OPEN.map(plotFlat)];
const ground = (x: number, y: number): number => heightAt(SEED, x, y, flats);
const wet = (x: number, y: number): boolean => heightAt(SEED, x, y, flats) < waterAt(SEED, x, y, flats) + 0.05;
/** In the water, not just at its edge. */
const deep = (x: number, y: number): boolean => heightAt(SEED, x, y, flats) < waterAt(SEED, x, y, flats) - 0.1;

const solids = new Solids();
solids.add(KEEP_COLLIDERS);
solids.add(SITE_COLLIDERS, ground);
const context = { tier: TIERS.medium, shadows: false, ground };
for (const place of [new ProvingGround(context), new Workshop(context)] as Place[]) {
  solids.add(place.colliders, ground);
  // Their machines where they stand to begin with (they're movers in the world; here, still).
  solids.add((place.movers ?? []).filter((m) => m.r > 0).map((m) => ({ kind: "circle" as const, x: m.x, y: m.y, r: m.r, top: 3 })), ground);
  place.dispose();
}
for (const plot of OPEN) solids.add(plotColliders(plot));
// What grows on every chunk from the proving ground to the hall and out to the plots.
for (let cx = Math.floor(-230 / CHUNK); cx <= Math.floor(150 / CHUNK); cx++) {
  for (let cy = Math.floor(-150 / CHUNK); cy <= Math.floor(130 / CHUNK); cy++) {
    const s = chunkSamples(SEED, cx, cy, flats, built, BIG);
    addPlants(solids, s.layers.trees, s.layers.rocks);
  }
}
const planner = new Planner(solids);
const walker = new Walker(standAt("keep"));
const mover = solids.join(walker, BUILDS.galahad);
walker.join({ planner, mover, wet, deep });
const obs = obstacles(experiments);

interface Walked {
  time: number;
  /** The straight walk's time: the straight line at his pace for it. */
  straight: number;
  arrived: boolean;
  fallbacks: number;
  /** Where he was inside something, or in the water (if ever). */
  wrong: string | null;
}

function walk(from: Target, to: Target): Walked {
  walker.go(from, obs, true);
  walker.fallbacks = 0;
  walker.go(to, obs);
  const dt = 1 / 60;
  let time = 0;
  let wrong: string | null = null;
  while ((walker.moving || walker.waypoints.length) && time < 120) {
    walker.step(dt);
    time += dt;
    if (!wrong && solids.overlaps(walker.x, walker.y, walker.r - 0.02, mover.step, mover.height)) wrong = `inside at ${walker.x.toFixed(2)},${walker.y.toFixed(2)}`;
    if (!wrong && deep(walker.x, walker.y)) wrong = `in the water at ${walker.x.toFixed(2)},${walker.y.toFixed(2)}`;
  }
  const d = Math.hypot(to.x - from.x, to.y - from.y);
  return { time, straight: d / paceFor(d).speed, arrived: Math.hypot(walker.x - to.x, walker.y - to.y) < 0.05, fallbacks: walker.fallbacks, wrong };
}

const gates: [string, Target][] = [
  ...Object.entries(SITE_GATES).map(([site, g]): [string, Target] => [`${site} gate`, { ...g, facing: 0 }]),
  ...PADS.map((pad): [string, Target] => [`pad ${pad.id}`, plotGate(pad)]),
  ...OPEN.map((plot): [string, Target] => [`plot ${plot.x},${plot.y}`, plotGate(plot)]),
];

describe("Galahad among the solids, on the real land", () => {
  test("every place he goes is clear of everything solid and dry", () => {
    for (const [name, t] of [...PLACES.map((p): [string, Target] => [p, standAt(p)]), ...gates]) {
      expect(solids.overlaps(t.x, t.y, walker.r, mover.step, mover.height) ? name : "clear").toBe("clear");
      expect(wet(t.x, t.y) ? name : "dry").toBe("dry");
    }
  });

  test("from every station to every other, to each site's gate, every pad's gate and the plots: there, never through anything, in about the straight walk's time", () => {
    const failures: string[] = [];
    const ratios: number[] = [];
    for (const a of PLACES) {
      for (const [name, to] of [...PLACES.filter((b) => b !== a).map((b): [string, Target] => [b, standAt(b)]), ...gates]) {
        const w = walk(standAt(a), to);
        const label = `${a} → ${name}`;
        if (!w.arrived) failures.push(`${label}: not there (at ${walker.x.toFixed(1)},${walker.y.toFixed(1)} after ${w.time.toFixed(1)} s)`);
        if (w.fallbacks) failures.push(`${label}: set down ${w.fallbacks}×`);
        if (w.wrong) failures.push(`${label}: ${w.wrong}`);
        ratios.push(w.time / Math.max(w.straight, 1));
        if (w.time > w.straight * 1.6 + 2) failures.push(`${label}: ${w.time.toFixed(1)} s against ${w.straight.toFixed(1)} s straight`);
      }
    }
    expect(failures).toEqual([]);
    ratios.sort((x, y) => x - y);
    // Most walks take hardly longer than the straight line would.
    expect(ratios[Math.floor(ratios.length / 2)]!).toBeLessThan(1.2);
  });
});
