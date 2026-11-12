import { describe, expect, test } from "bun:test";
import { DOCK, DOCK_STAND } from "./care.ts";
import { BUILDS, Solids } from "./collide.ts";
import { addPlants } from "./flora-plan.ts";
import { Hearth } from "./hearth.ts";
import { BED, BENCH_AREA, BENCH_DOG, BENCH_SEAT, CAMP, DESK, DESK_DOG, DESK_SEAT, FIRE, HEARTH_COLLIDERS, JOURNAL, LOG_DOG, LOG_SEAT, MAT, TRAIL } from "./hearth-plan.ts";
import { fleetColliders, KEEP_COLLIDERS } from "./keep-plan.ts";
import { Planner } from "./nav.ts";
import { built, obstacles, RUN_BEYOND, standAt, type Target, Walker } from "./path.ts";
import { SITE_COLLIDERS } from "./sites.ts";
import { BASE_FLATS, BIG, CHUNK, chunkSamples, heightAt, SEED, waterAt } from "./terrain.ts";
import { TIERS } from "./tiers.ts";

/*
 * His hearth on the real land among the real solids: the camp south of the keep,
 * the bench by the lake and the trail. Everything stands on dry, open ground clear
 * of the keep, its stairs and a full fleet's banners; he fits wherever he stands,
 * sits and lies, the dog wherever it lies by him, within his reach; and he walks
 * to all of it, and round the trail, never set down and never inside anything or
 * in the water.
 */

const ground = (x: number, y: number): number => heightAt(SEED, x, y, BASE_FLATS);
const water = (x: number, y: number): number => waterAt(SEED, x, y, BASE_FLATS);
const wet = (x: number, y: number): boolean => ground(x, y) < water(x, y) + 0.05;
const deep = (x: number, y: number): boolean => ground(x, y) < water(x, y) - 0.1;

const solids = new Solids();
solids.add(KEEP_COLLIDERS);
solids.add(SITE_COLLIDERS, ground);
// A full fleet: every banner and tower there could be.
solids.add(fleetColliders(Array.from({ length: 16 }, (_, i) => i % 3 === 0)));
solids.add(HEARTH_COLLIDERS, ground);
// What grows from the lake up to the woods north of the keep (nothing does where something's built).
for (let cx = Math.floor(-90 / CHUNK); cx <= Math.floor(90 / CHUNK); cx++) {
  for (let cy = Math.floor(-90 / CHUNK); cy <= Math.floor(120 / CHUNK); cy++) {
    const s = chunkSamples(SEED, cx, cy, BASE_FLATS, built, BIG);
    addPlants(solids, s.layers.trees, s.layers.rocks);
  }
}
const planner = new Planner(solids);
const walker = new Walker(standAt("keep"));
const mover = solids.join(walker, BUILDS.galahad);
walker.join({ planner, mover, wet, deep, height: ground });
const dogMover = solids.join({ x: 0, y: -40, r: BUILDS.dog.r }, BUILDS.dog);
const obs = obstacles([]);

function walk(to: Target): { arrived: boolean; fallbacks: number; wrong: string | null; time: number } {
  walker.fallbacks = 0;
  walker.go(to, obs);
  const dt = 1 / 60;
  let time = 0;
  let wrong: string | null = null;
  while ((walker.moving || walker.waypoints.length) && time < 180) {
    walker.step(dt);
    time += dt;
    if (!wrong && solids.overlaps(walker.x, walker.y, walker.r - 0.02, mover.step, mover.height)) wrong = `inside at ${walker.x.toFixed(2)},${walker.y.toFixed(2)}`;
    if (!wrong && deep(walker.x, walker.y)) wrong = `in the water at ${walker.x.toFixed(2)},${walker.y.toFixed(2)}`;
  }
  return { arrived: Math.hypot(walker.x - to.x, walker.y - to.y) < 0.05, fallbacks: walker.fallbacks, wrong, time };
}

const STANDS: [string, Target][] = [
  ["his bed", BED],
  ["the log by the fire", LOG_SEAT],
  ["his desk", DESK_SEAT],
  ["beside the dog's cushion", DOCK_STAND],
  ["the bench by the lake", BENCH_SEAT],
];
const DOG_SPOTS: [string, { x: number; y: number }, { x: number; y: number }][] = [
  ["its cushion", DOCK, BED],
  ["by the log", LOG_DOG, LOG_SEAT],
  ["by his chair", DESK_DOG, DESK_SEAT],
  ["by the bench", BENCH_DOG, BENCH_SEAT],
];

describe("his hearth, on the real land", () => {
  test("the camp is on the keep's level lawn, dry, and nothing grows on it; the bench stands dry on the shore with the lake before it", () => {
    for (let a = 0; a < Math.PI * 2; a += 0.3) {
      for (const r of [0, CAMP.r * 0.5, CAMP.r * 0.95]) {
        const x = CAMP.x + Math.cos(a) * r;
        const y = CAMP.y + Math.sin(a) * r;
        expect(Math.abs(ground(x, y))).toBeLessThan(0.02);
        expect(built(x, y)).toBe(true);
      }
    }
    expect(built(BENCH_AREA.x, BENCH_AREA.y)).toBe(true);
    // The bench: well above the water, which begins a few metres to the south, straight ahead of him.
    expect(ground(BENCH_SEAT.x, BENCH_SEAT.y)).toBeGreaterThan(-0.4);
    expect(wet(BENCH_SEAT.x, BENCH_SEAT.y)).toBe(false);
    let shore = 0;
    while (shore < 20 && !wet(BENCH_SEAT.x, BENCH_SEAT.y - shore)) shore += 0.5;
    expect(shore).toBeGreaterThan(3);
    expect(shore).toBeLessThan(10);
  });

  test("he fits wherever he stands, sits and lies, clear of the keep, its stairs and a full fleet's banners; the dog fits where it lies by him, within his reach", () => {
    const failures: string[] = [];
    for (const [name, at] of STANDS) if (!mover.fits(at.x, at.y, 0.02)) failures.push(`he doesn't fit at ${name}`);
    for (const [name, at, him] of DOG_SPOTS) {
      if (!dogMover.fits(at.x, at.y, 0.02)) failures.push(`the dog doesn't fit ${name}`);
      const d = Math.hypot(at.x - him.x, at.y - him.y);
      // Not so near they'd be pushed apart, near enough for his hand.
      if (d < BUILDS.dog.r + BUILDS.galahad.r || d > 1.05) failures.push(`the dog ${name} is ${d.toFixed(2)} m from him`);
    }
    expect(failures).toEqual([]);
    // His bed is on the mat; his journal lies within his reach of where he sits, on the desk before him.
    expect(Math.abs(BED.x - MAT.x)).toBeLessThan(MAT.hx);
    expect(Math.hypot(JOURNAL.x - DESK_SEAT.x, JOURNAL.y - DESK_SEAT.y)).toBeLessThan(0.55);
    expect(JOURNAL.y).toBeGreaterThan(DESK_SEAT.y);
    expect(Math.abs(JOURNAL.z - DESK.top)).toBeLessThan(0.05);
    // The fire's far enough from his feet, his seat and his desk.
    for (const at of [BED, LOG_SEAT, DESK_SEAT]) expect(Math.hypot(at.x - FIRE.x, at.y - FIRE.y)).toBeGreaterThan(FIRE.r + BUILDS.galahad.r + 0.3);
  });

  test("he walks to all of it from the keep's door and between them: there, never set down, never inside anything", () => {
    const failures: string[] = [];
    walker.go(standAt("keep"), obs, true);
    for (const [name, to] of [...STANDS, ...STANDS.slice().reverse(), ["the keep's door", standAt("keep")] as [string, Target]]) {
      const w = walk(to);
      if (!w.arrived) failures.push(`${name}: not there (at ${walker.x.toFixed(2)},${walker.y.toFixed(2)} after ${w.time.toFixed(0)} s)`);
      if (w.fallbacks) failures.push(`${name}: set down ${w.fallbacks}×`);
      if (w.wrong) failures.push(`${name}: ${w.wrong}`);
    }
    expect(failures).toEqual([]);
  });

  test("the trail keeps to dry, open land and comes back round; he walks all of it without being set down", () => {
    const failures: string[] = [];
    for (const [i, p] of TRAIL.entries()) {
      if (ground(p.x, p.y) < water(p.x, p.y) + 0.4) failures.push(`point ${i} is at the water`);
      if (!mover.fits(p.x, p.y, 0.3)) failures.push(`point ${i} is against something`);
    }
    // A view to stop at, at least twice; and the last point is near the first (round again).
    expect(TRAIL.filter((p) => p.pause >= 30).length).toBeGreaterThanOrEqual(2);
    expect(Math.hypot(TRAIL[0]!.x - TRAIL.at(-1)!.x, TRAIL[0]!.y - TRAIL.at(-1)!.y)).toBeLessThan(12);
    walker.go(LOG_SEAT, obs, true);
    let total = 0;
    for (const [i, p] of [...TRAIL, TRAIL[0]!].entries()) {
      const w = walk({ x: p.x, y: p.y, facing: 0 });
      total += w.time;
      if (!w.arrived) failures.push(`leg ${i}: not there`);
      if (w.fallbacks) failures.push(`leg ${i}: set down ${w.fallbacks}×`);
      if (w.wrong) failures.push(`leg ${i}: ${w.wrong}`);
    }
    expect(failures).toEqual([]);
    // A real walk: a few minutes on his feet, before the pauses; and no leg long enough to make him run.
    expect(total).toBeGreaterThan(180);
    expect(total).toBeLessThan(420);
    const round = [...TRAIL, TRAIL[0]!];
    for (let i = 1; i < round.length; i++) expect(Math.hypot(round[i]!.x - round[i - 1]!.x, round[i]!.y - round[i - 1]!.y)).toBeLessThan(RUN_BEYOND);
    // It goes out beyond the keep's lawn, into the meadow where the wildlife is.
    expect(Math.max(...TRAIL.map((p) => Math.hypot(p.x, p.y)))).toBeGreaterThan(60);
  });

  test("drawn in a handful of meshes, with its lamps' glows; nothing left behind when it goes", () => {
    const hearth = new Hearth({ tier: TIERS.medium, shadows: false, ground });
    let meshes = 0;
    let triangles = 0;
    hearth.group.traverse((o) => {
      const g = (o as { geometry?: { getAttribute(n: string): { count: number } } }).geometry;
      if (!g) return;
      meshes++;
      triangles += g.getAttribute("position").count / 3;
    });
    expect(meshes).toBeLessThanOrEqual(6);
    expect(triangles).toBeLessThan(9000);
    expect(hearth.warmGlows.length).toBe(4);
    expect(hearth.colliders).toBe(HEARTH_COLLIDERS);
    // The fire burns at night, and by day while he's there; not in a downpour.
    const frame = { dt: 1 / 30, t: 1, motion: true, focusX: 0, focusY: 0, distance: 30, follow: true, galahadX: 100, galahadY: 100, night: 0, rain: 0, wetness: 0, wind: 3, windHeading: 0 };
    hearth.animate(frame);
    expect(hearth.lit).toBe(false);
    hearth.animate({ ...frame, galahadX: LOG_SEAT.x, galahadY: LOG_SEAT.y });
    expect(hearth.lit).toBe(true);
    hearth.setNight(1);
    hearth.animate(frame);
    expect(hearth.lit).toBe(true);
    hearth.animate({ ...frame, rain: 1 });
    expect(hearth.lit).toBe(false);
    // Tapping the desk finds the journal; the cushion says whose it is once the dog has a name.
    expect(hearth.overJournal(JOURNAL.x, JOURNAL.y)).toBe(true);
    expect(hearth.overJournal(FIRE.x, FIRE.y)).toBe(false);
    const out: [number, number, number] = [0, 0, 0];
    expect(hearth.hover(DOCK.x, DOCK.y, out)).toBe("The dog's bed");
    hearth.dogName = "Bors";
    expect(hearth.hover(DOCK.x, DOCK.y, out)).toBe("Bors's bed");
    expect(hearth.hover(JOURNAL.x, JOURNAL.y, out)).toBe("His journal · tap to read");
    hearth.dispose();
    expect(hearth.group.parent).toBeNull();
  });
});
