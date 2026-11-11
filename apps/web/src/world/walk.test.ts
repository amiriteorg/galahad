import { describe, expect, test } from "bun:test";
import { type ExperimentView, PADS } from "@galahad/core/world";
import { BUILDS, Solids } from "./collide.ts";
import { ProvingGround } from "./field.ts";
import { addPlants } from "./flora-plan.ts";
import { Workshop } from "./hall.ts";
import { DECK_REST, DECK_TOP, STAIRS, tread } from "./keep-deck.ts";
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
walker.join({ planner, mover, wet, deep, height: ground });
const obs = obstacles(experiments);

interface Walked {
  time: number;
  /** The straight walk's time: the straight line at his pace for it. */
  straight: number;
  arrived: boolean;
  fallbacks: number;
  /** Where he was inside something, or in the water (if ever). */
  wrong: string | null;
  /** The most his feet rose or fell in a frame, the tops he stood on (to the centimetre), and the highest. */
  climb: number;
  tops: Set<number>;
  highest: number;
}

function walk(from: Target, to: Target): Walked {
  walker.go(from, obs, true);
  walker.fallbacks = 0;
  walker.go(to, obs);
  const dt = 1 / 60;
  let time = 0;
  let wrong: string | null = null;
  let climb = 0;
  const tops = new Set<number>();
  let highest = walker.z;
  let z = walker.z;
  while ((walker.moving || walker.waypoints.length) && time < 120) {
    walker.step(dt);
    time += dt;
    // Inside something, as he meets it: from where his feet are (up on a tread, the deck or a rock), or the land.
    solids.floor = walker.floor;
    if (!wrong && solids.overlaps(walker.x, walker.y, walker.r - 0.02, mover.step, mover.height)) wrong = `inside at ${walker.x.toFixed(2)},${walker.y.toFixed(2)},${walker.z.toFixed(2)}`;
    solids.floor = Number.NaN;
    if (!wrong && deep(walker.x, walker.y)) wrong = `in the water at ${walker.x.toFixed(2)},${walker.y.toFixed(2)}`;
    if (walker.raised) {
      climb = Math.max(climb, Math.abs(walker.z - z));
      tops.add(Math.round(walker.z * 100));
    }
    highest = Math.max(highest, walker.z);
    z = walker.z;
  }
  const d = Math.hypot(to.x - from.x, to.y - from.y);
  return { time, straight: d / paceFor(d).speed, arrived: Math.hypot(walker.x - to.x, walker.y - to.y) < 0.05, fallbacks: walker.fallbacks, wrong, climb, tops, highest };
}

const gates: [string, Target][] = [
  ...Object.entries(SITE_GATES).map(([site, g]): [string, Target] => [`${site} gate`, { ...g, facing: 0 }]),
  ...PADS.map((pad): [string, Target] => [`pad ${pad.id}`, plotGate(pad)]),
  ...OPEN.map((plot): [string, Target] => [`plot ${plot.x},${plot.y}`, plotGate(plot)]),
];

describe("Galahad among the solids, on the real land", () => {
  test("up the keep's stairs to his place on the deck and down again, from every station: a tread at a time, never more than a step, never through the rails or off the edge", () => {
    const failures: string[] = [];
    const treads = new Set(Array.from({ length: STAIRS.steps }, (_, i) => Math.round(tread(i).top * 100)));
    for (const place of PLACES) {
      for (const [label, from, to] of [[`${place} → the deck`, standAt(place), DECK_REST], [`the deck → ${place}`, DECK_REST, standAt(place)]] as const) {
        const w = walk(from, to);
        if (!w.arrived) failures.push(`${label}: not there (at ${walker.x.toFixed(1)},${walker.y.toFixed(1)},${walker.z.toFixed(2)} after ${w.time.toFixed(1)} s)`);
        if (w.fallbacks) failures.push(`${label}: set down ${w.fallbacks}×`);
        if (w.wrong) failures.push(`${label}: ${w.wrong}`);
        // Each frame, his feet rise or fall at most one tread's height (0.35 m), never more than his step.
        if (w.climb > mover.step) failures.push(`${label}: his feet moved ${w.climb.toFixed(2)} m in a frame`);
        // He stood on every tread on the way (and on the deck, at its top).
        const missed = [...treads].filter((t) => !w.tops.has(t));
        if (missed.length) failures.push(`${label}: never on the treads at ${missed.map((t) => (t / 100).toFixed(2)).join(", ")}`);
        if (Math.abs(w.highest - DECK_TOP) > 1e-6) failures.push(`${label}: highest ${w.highest.toFixed(2)}`);
      }
      if (Math.abs(walker.z - (walker.raised ? DECK_TOP : ground(walker.x, walker.y))) > 1e-6) failures.push(`${place}: ended at ${walker.z.toFixed(2)}`);
    }
    expect(failures).toEqual([]);
  });

  test("anything over his knee still stops him; lower, he steps up onto it and down off it", () => {
    const s = new Solids();
    // A row of blocks across his way: 0.3 m, 0.48 m, 0.6 m, 1 m high.
    s.open();
    s.box(3, 0, 0.6, 3, 0, 0, 0.3);
    s.box(6, 0, 0.6, 3, 0, 0, 0.48);
    s.close();
    const p = new Planner(s);
    const w = new Walker({ x: 0, y: 0, facing: 0 });
    const m = s.join(w, BUILDS.galahad);
    w.join({ planner: p, mover: m, wet: null });
    w.go({ x: 9, y: 0, facing: 0 }, []);
    let top = 0;
    for (let k = 0; k < 60 * 20 && (w.moving || w.waypoints.length); k++) {
      w.step(1 / 60);
      top = Math.max(top, w.z);
    }
    expect([w.x, w.y, w.z].map((v) => Math.round(v * 100) / 100)).toEqual([9, 0, 0]);
    expect(top).toBeCloseTo(0.48, 6);
    // And a knee-high wall, or a metre's, he goes round.
    for (const h of [0.6, 1]) {
      const t = new Solids();
      t.open();
      t.box(3, 0, 0.6, 3, 0, 0, h);
      t.close();
      const q = new Walker({ x: 0, y: 0, facing: 0 });
      const n = t.join(q, BUILDS.galahad);
      q.join({ planner: new Planner(t), mover: n, wet: null });
      q.go({ x: 6, y: 0, facing: 0 }, []);
      let most = 0;
      let through = false;
      for (let k = 0; k < 60 * 20 && (q.moving || q.waypoints.length); k++) {
        q.step(1 / 60);
        most = Math.max(most, q.z);
        through ||= Math.abs(q.x - 3) < 0.6 && Math.abs(q.y) < 3;
      }
      expect([Math.round(q.x * 100) / 100, Math.round(q.y * 100) / 100, most, through]).toEqual([6, 0, 0, false]);
    }
  });

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
