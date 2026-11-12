import { BIOMES, biomeAt } from "../../apps/web/src/world/biome.ts";
import { Solids } from "../../apps/web/src/world/collide.ts";
import { KIND_COUNT, KINDS } from "../../apps/web/src/world/eco/species.ts";
import { BENCH_AREA, CAMP, HEARTH_COLLIDERS } from "../../apps/web/src/world/hearth-plan.ts";
import { KEEP_COLLIDERS } from "../../apps/web/src/world/keep-plan.ts";
import { built } from "../../apps/web/src/world/path.ts";
import { SITE_COLLIDERS } from "../../apps/web/src/world/sites.ts";
import { azimuthOf, elevationOf, type Mat3, rotate, skyMatrix, type Vec3 } from "../../apps/web/src/world/sky/celestial.ts";
import { STAR_COUNT, STAR_DATA, STAR_NAMES } from "../../apps/web/src/world/sky/stars-data.ts";
import { unpackStars } from "../../apps/web/src/world/sky/stars.ts";
import { emptyMoon, emptySun, moonAt, sunAt } from "../../apps/web/src/world/sun.ts";
import { BIG, CELLS, CHUNK, type ChunkSamples, chunkSamples, FINE_CELLS, fineSurface, growLayer, heightAt, LAYERS, onTrail, SEED, SMALL, STRIDE, waterAt } from "../../apps/web/src/world/terrain.ts";
import { intBelow, rng, subSeed, type Suite, type SuiteContext, summarise } from "../lib.ts";
import { castThroughYears, cycleFailures, ecoWorld, foxAndHare, TIER_CAPS } from "../world/eco.ts";
import { buildMap, flats, ground, HOME, type RealMap, wet } from "../world/map.ts";
import { buildGrid, cellX, cellY, pathLength, type Point, ReferenceSearch } from "../world/reference.ts";
import { apart, INSTANTS, referenceMoon, referenceSun, STAR_PINS, SUN_TIMES } from "../world/sky.ts";

/*
 * The world's algorithms, headless: no GPU and no browser. The land and its
 * biomes as they're grown chunk by chunk, where plants and rocks are put,
 * finding a way on the real map (held against an exhaustive reference search),
 * collision queries, the ecosystem's cost and its stability over many seeds, and
 * the sun, moon and stars against references.
 *
 * The world has one seed (the same land on every device): the run's seed chooses
 * which chunks, which starts and goals, and which years are looked at.
 */

const DEG = 180 / Math.PI;

/** A hash of everything a chunk holds: its ground, its colours, its climate's shares and what grows on it. */
function chunkDigest(s: ChunkSamples): number {
  let h = 0x811c9dc5;
  const eat = (view: ArrayBufferView): void => {
    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i]!, 0x01000193);
  };
  eat(s.heights);
  eat(s.split);
  eat(s.faces);
  eat(s.cover);
  eat(s.biomes);
  for (const layer of LAYERS) if (s.layers[layer]) eat(s.layers[layer]!);
  return h >>> 0;
}

function land(ctx: SuiteContext): void {
  const random = rng(subSeed(ctx.seed, "world-chunks"));
  // Chunks near home and far out (the generator makes bigger things beyond the home ground).
  const coords: [number, number][] = [];
  for (let i = 0; i < 16; i++) coords.push(i < 6 ? [intBelow(random, 7) - 3, intBelow(random, 7) - 3] : [intBelow(random, 81) - 40, intBelow(random, 81) - 40]);
  let k = 0;
  const next = (): [number, number] => coords[k++ % coords.length]!;
  ctx.time("world.terrain.chunk", () => chunkSamples(SEED, ...next(), flats, built, BIG), { n: 12, warm: 2, batch: 2, note: "a chunk's ground, climate and big plants (64 m square, 4 m grid)" });
  const bases = coords.map(([cx, cy]) => chunkSamples(SEED, cx, cy, flats, built, BIG));
  k = 0;
  ctx.time("world.terrain.fine", () => fineSurface(SEED, bases[k++ % bases.length]!, built), { n: 12, warm: 2, note: "a chunk's fine surface (2 m grid), from its base" });
  k = 0;
  ctx.time("world.terrain.small-plants", () => {
    const base = bases[k++ % bases.length]!;
    for (const layer of SMALL) growLayer(SEED, base, layer, built);
  }, { n: 12, warm: 2, note: "a chunk's flowers, grass and what lies underfoot" });

  // The same seed, the same bytes: every chunk grown twice.
  let differing = 0;
  for (const [cx, cy] of coords) if (chunkDigest(chunkSamples(SEED, cx, cy, flats, built, LAYERS)) !== chunkDigest(chunkSamples(SEED, cx, cy, flats, built, LAYERS))) differing++;
  ctx.quality("world.terrain.nondeterministic-chunks", differing, "chunks", "lower", { note: `of ${coords.length}, each grown twice with every layer` });

  // Neighbours share their edges exactly, on the base grid and the fine one; and no step between corners is a cliff.
  let gap = 0;
  let fineGap = 0;
  let steepest = 0;
  const n = CELLS + 1;
  const fn = FINE_CELLS + 1;
  for (const [cx, cy] of coords.slice(0, 10)) {
    const a = chunkSamples(SEED, cx, cy, flats, built, []);
    const east = chunkSamples(SEED, cx + 1, cy, flats, built, []);
    const north = chunkSamples(SEED, cx, cy + 1, flats, built, []);
    const fa = fineSurface(SEED, a, built);
    const fe = fineSurface(SEED, east, built);
    const fnn = fineSurface(SEED, north, built);
    for (let j = 0; j < n; j++) {
      gap = Math.max(gap, Math.abs(a.heights[j * n + CELLS]! - east.heights[j * n]!), Math.abs(a.heights[CELLS * n + j]! - north.heights[j]!));
      for (let i = 0; i < CELLS; i++) steepest = Math.max(steepest, Math.abs(a.heights[j * n + i + 1]! - a.heights[j * n + i]!), Math.abs(a.heights[(i + 1) * n + j]! - a.heights[i * n + j]!));
    }
    for (let j = 0; j < fn; j++) fineGap = Math.max(fineGap, Math.abs(fa.heights[j * fn + FINE_CELLS]! - fe.heights[j * fn]!), Math.abs(fa.heights[FINE_CELLS * fn + j]! - fnn.heights[j]!));
  }
  ctx.quality("world.terrain.edge-gap", Math.max(gap, fineGap), "m", "lower", { note: "the most two neighbouring chunks differ along a shared edge (base and fine grids)" });
  ctx.quality("world.terrain.steepest-step", steepest, "m", "lower", { resolution: 1e-3, note: "the most the ground rises between two corners 4 m apart" });

  // The climate over two kilometres square round the keep: each biome's share, and water where the ground is under it.
  const counts = new Array<number>(BIOMES.length).fill(0);
  let samples = 0;
  let dryUnderWater = 0;
  let waterAboveWater = 0;
  for (let y = -1024; y <= 1024; y += 16) {
    for (let x = -1024; x <= 1024; x += 16) {
      const biome = biomeAt(SEED, x, y, flats);
      counts[BIOMES.indexOf(biome)]!++;
      samples++;
      const depth = waterAt(SEED, x, y, flats) - heightAt(SEED, x, y, flats);
      if (depth > 0.25 && biome !== "water") dryUnderWater++;
      if (depth < -0.25 && biome === "water") waterAboveWater++;
    }
  }
  const share = (name: string): number => counts[BIOMES.indexOf(name as (typeof BIOMES)[number])]! / samples;
  const shares = BIOMES.map((name) => `${name} ${(share(name) * 100).toFixed(1)} %`).join(", ");
  // Sane: every biome of the open country is there, none takes the land over, and there is water but not a sea.
  const bounds: Record<string, [number, number]> = { water: [0.03, 0.4], shore: [0.005, 0.25], marsh: [0.005, 0.25], meadow: [0.08, 0.6], heath: [0.01, 0.4], woodland: [0.03, 0.5], birchwood: [0.005, 0.3], pinewood: [0.005, 0.3], outcrop: [0.002, 0.2], lawn: [0, 0.05] };
  const out = BIOMES.filter((name) => share(name) < bounds[name]![0] || share(name) > bounds[name]![1]);
  ctx.quality("world.biome.out-of-bounds", out.length, "biomes", "lower", { note: `${shares}${out.length ? `; out of bounds: ${out.join(", ")}` : ""}`.slice(0, 290) });
  ctx.quality("world.biome.largest-share", Math.max(...BIOMES.map(share)), "", "lower", { resolution: 1e-3, note: "the most any one biome takes of the land" });
  ctx.quality("world.biome.dry-under-water", dryUnderWater, "samples", "lower", { note: `of ${samples}: ground more than 25 cm under the water's level that isn't water` });
  ctx.quality("world.biome.water-above-water", waterAboveWater, "samples", "lower", { note: "ground more than 25 cm over the water's level that is" });
}

function plants(ctx: SuiteContext, map: RealMap): void {
  // What's built: the keep and its stations, his hearth, the sites' buildings (not what grows).
  const buildings = new Solids();
  buildings.add(KEEP_COLLIDERS);
  buildings.add(HEARTH_COLLIDERS, ground);
  buildings.add(SITE_COLLIDERS, ground);
  const onHearth = (x: number, y: number): boolean => Math.hypot(x - CAMP.x, y - CAMP.y) < CAMP.r || Math.hypot(x - BENCH_AREA.x, y - BENCH_AREA.y) < BENCH_AREA.r;
  let placed = 0;
  let inWater = 0;
  let onPaths = 0;
  let inBuildings = 0;
  let hearth = 0;
  let trail = 0;
  let deepest = 0;
  const examples: string[] = [];
  const note = (what: string, layer: string, x: number, y: number): void => void (examples.length < 4 && examples.push(`${layer} ${what} at ${x.toFixed(1)},${y.toFixed(1)}`));
  for (const chunk of map.chunks) {
    // Near the keep, the small things too (they're grown only near the view).
    const near = Math.abs(chunk.cx) <= 1 && Math.abs(chunk.cy) <= 1;
    for (const layer of near ? LAYERS : BIG) {
      const at = chunk.layers[layer] ?? growLayer(SEED, chunk, layer, built);
      for (let i = 0; i < at.length; i += STRIDE) {
        const x = at[i]!;
        const y = at[i + 1]!;
        placed++;
        const depth = waterAt(SEED, x, y, flats) - heightAt(SEED, x, y, flats);
        // Trees, bushes, flowers and grass stand on land (reeds wade, rocks lie on the lakebed, lily pads float: by design).
        if ((layer === "trees" || layer === "bushes" || layer === "flowers" || layer === "grass") && depth > 0.1) {
          inWater++;
          deepest = Math.max(deepest, depth);
          note(`${depth.toFixed(2)} m under water`, layer, x, y);
        }
        if (built(x, y)) {
          // The keep's lawn grows grass and flowers by design; nothing else stands on what's built.
          if (BIG.includes(layer)) {
            onPaths++;
            note("on what's built", layer, x, y);
          }
        }
        // (Only what reaches the ground: a canopy or a crown overhead is no building to a tuft of grass.)
        if (buildings.overlaps(x, y, 0.05, 0, 0.4)) {
          inBuildings++;
          note("inside something built", layer, x, y);
        }
        if (onHearth(x, y) && BIG.includes(layer)) {
          hearth++;
          note("on his hearth", layer, x, y);
        }
        if ((layer === "trees" || layer === "rocks") && onTrail(x, y)) {
          trail++;
          note("on the trail", layer, x, y);
        }
      }
    }
  }
  const where = examples.length ? `; e.g. ${examples.join("; ")}` : "";
  ctx.quality("world.plants.in-water", inWater, "", "lower", { note: `trees, bushes, flowers and grass more than 10 cm under water, of ${placed} things placed on the home ground${deepest ? ` (deepest ${deepest.toFixed(2)} m)` : ""}${where}`.slice(0, 290) });
  ctx.quality("world.plants.on-paths", onPaths, "", "lower", { note: `trees, bushes, rocks and reeds where something is built (a station, a path, a road, paving)${where}`.slice(0, 290) });
  ctx.quality("world.plants.in-buildings", inBuildings, "", "lower", { note: `anything grown inside a solid of the keep, the hearth or a site that reaches the ground${where}`.slice(0, 290) });
  ctx.quality("world.plants.on-hearth", hearth, "", "lower", { note: "trees, bushes, rocks and reeds on his camp or by his bench" });
  ctx.quality("world.plants.on-trail", trail, "", "lower", { note: "trees and rocks (solid) on the trail he and the dog walk" });
}

function navigation(ctx: SuiteContext, map: RealMap): void {
  const w = map.walker;
  const { solids, planner } = map;
  // The reference: the whole home ground on a half-metre grid, for a walker of his size.
  const grid = buildGrid(HOME, 0.5, (x, y) => solids.overlaps(x, y, w.r + 0.05, w.step, w.height) || wet(x, y));
  const clear = (ax: number, ay: number, bx: number, by: number): boolean => planner.clear(ax, ay, bx, by, w, wet);
  const reference = new ReferenceSearch(grid, clear);
  const free: number[] = [];
  for (let c = 0; c < grid.blocked.length; c++) if (!grid.blocked[c]) free.push(c);
  ways(ctx, map, grid, reference, free, "world.nav", 300, "world-nav");
  // With --full, three times as many again, drawn apart from the first (the default numbers are measured either way).
  if (ctx.full) ways(ctx, map, grid, reference, free, "full.world.nav", 900, "world-nav-more");

  // Collision queries on the same map: a thousand of each.
  const random = rng(subSeed(ctx.seed, "world-collide"));
  const points = Array.from({ length: 1000 }, () => {
    const c = free[intBelow(random, free.length)]!;
    return { x: cellX(grid, c), y: cellY(grid, c), dx: (random() - 0.5) * 8, dy: (random() - 0.5) * 8 };
  });
  const slid = { x: 0, y: 0 };
  ctx.time("world.collide.overlaps-1k", () => {
    for (const p of points) solids.overlaps(p.x + p.dx, p.y + p.dy, w.r, w.step, w.height);
  }, { n: 15, warm: 3, note: "a thousand: is a walker's circle inside anything?" });
  ctx.time("world.collide.sweep-1k", () => {
    for (const p of points) solids.sweep(p.x, p.y, p.dx, p.dy, w.r, w.step, w.height);
  }, { n: 15, warm: 3, note: "a thousand: how far can a walker go along a line of a few metres?" });
  ctx.time("world.collide.slide-1k", () => {
    for (const p of points) solids.slide(p.x, p.y, p.dx * 0.01, p.dy * 0.01, w.r, w.step, w.height, slid);
  }, { n: 15, warm: 3, note: "a thousand: one frame's step, sliding along what's met" });
}

/** `pairs` seeded starts and goals on the real map: the planner's way for each, held against the reference's. */
function ways(ctx: SuiteContext, map: RealMap, grid: ReturnType<typeof buildGrid>, reference: ReferenceSearch, free: readonly number[], id: string, pairs: number, stream: string): void {
  const w = map.walker;
  const { solids, planner } = map;
  const random = rng(subSeed(ctx.seed, stream));
  const ratios: number[] = [];
  const times: number[] = [];
  let should = 0;
  let missed = 0;
  let longMissed = 0;
  let through = 0;
  const worst: string[] = [];
  const from = performance.now();
  for (let k = 0; k < pairs; k++) {
    const a = free[intBelow(random, free.length)]!;
    const ax = cellX(grid, a);
    const ay = cellY(grid, a);
    // A third near (a walk between stations), a third across the keep's ground, a third anywhere.
    const within = k % 3 === 0 ? 40 : k % 3 === 1 ? 120 : Infinity;
    let b = free[intBelow(random, free.length)]!;
    for (let tries = 0; tries < 400 && Math.hypot(cellX(grid, b) - ax, cellY(grid, b) - ay) > within; tries++) b = free[intBelow(random, free.length)]!;
    const bx = cellX(grid, b);
    const by = cellY(grid, b);
    const best = reference.path(a, b);
    const out: Point[] = [];
    const started = performance.now();
    const found = planner.route(ax, ay, bx, by, w, wet, out);
    times.push(performance.now() - started);
    if (k % 16 === 0) ctx.pulse();
    if (found) {
      // A way is a way: no leg through anything solid (his own size, to the centimetre) or across deep water.
      const pts = [{ x: ax, y: ay }, ...out];
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i - 1]!;
        const q = pts[i]!;
        let bad = solids.sweep(p.x, p.y, q.x - p.x, q.y - p.y, w.r - 0.01, w.step, w.height) < 1;
        const steps = Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / 0.25);
        for (let s = 0; s <= steps && !bad; s++) {
          const x = p.x + ((q.x - p.x) * s) / steps;
          const y = p.y + ((q.y - p.y) * s) / steps;
          if (heightAt(SEED, x, y, flats) < waterAt(SEED, x, y, flats) - 0.1) bad = true;
        }
        if (bad) {
          through++;
          break;
        }
      }
    }
    if (!best) continue;
    should++;
    const shortest = pathLength(best);
    if (!found) {
      missed++;
      if (shortest > 300) longMissed++;
      if (worst.length < 3) worst.push(`none from ${ax},${ay} to ${bx},${by} (${Math.round(Math.hypot(bx - ax, by - ay))} m apart, ${Math.round(shortest)} m round)`);
      continue;
    }
    ratios.push(pathLength([{ x: ax, y: ay }, ...out]) / shortest);
  }
  const span: [number, number] = [from, performance.now()];
  const s = summarise(ratios);
  const sorted = [...ratios].sort((p, q) => p - q);
  ctx.quality(`${id}.missed`, missed, "ways", "lower", { note: `of ${should} pairs with a way (by the reference search), the planner found none${missed ? `: ${longMissed} of them over 300 m round; e.g. ${worst.join("; ")}` : ""}`.slice(0, 290) });
  ctx.quality(`${id}.through-solids`, through, "ways", "lower", { note: "ways the planner gave that cross something solid or deep water" });
  ctx.quality(`${id}.length-ratio-mean`, ratios.reduce((p, q) => p + q, 0) / ratios.length, "×", "lower", { resolution: 1e-6, n: ratios.length, note: "the planner's way against the shortest (reference: exhaustive search on a 0.5 m grid, pulled taut)" });
  ctx.quality(`${id}.length-ratio-worst`, sorted.at(-1)!, "×", "lower", { resolution: 1e-6, note: `median ${s.median.toFixed(4)}, 95th percentile ${sorted[Math.floor(sorted.length * 0.95)]!.toFixed(4)}` });
  ctx.quality(`${id}.over-factor`, ratios.filter((r) => r > 1.15).length, "ways", "lower", { note: "ways more than 1.15 times the shortest" });
  ctx.speed(`${id}.plan`, times, "ms", "lower", span, "planning one way on the real map (a third within 40 m, a third within 120 m, a third anywhere on the home ground)");
}

function ecosystem(ctx: SuiteContext): void {
  // What a step costs, by how many animals a tier has.
  for (const tier of ["low", "medium", "high"] as const) {
    const { eco, env } = ecoWorld(TIER_CAPS[tier], { seed: ctx.seed });
    for (let i = 0; i < 1500; i++) eco.step(1 / 30, env);
    let animals = 0;
    for (let k = 0; k < KIND_COUNT; k++) animals += eco.count[k]!;
    ctx.time(`world.eco.step-1k.${tier}`, () => {
      for (let i = 0; i < 1000; i++) eco.step(1 / 30, env);
    }, { n: 9, warm: 1, note: `a thousand steps of the ${tier} tier's cast (${animals} animals at midsummer noon)` });
  }
  // A year of the whole cast, over several seeds: every resident stays, nobody is over what the tier may draw.
  cast(ctx, "world.eco.year", 5, 1);
  // With --full, four years over twelve (the default numbers are measured either way).
  if (ctx.full) cast(ctx, "full.world.eco.years", 12, 4);

  if (ctx.full) {
    // The fox and the hare alone for eighteen years, as the ecosystem's own test runs them for one seed: over twelve.
    let gone = 0;
    let cycles = 0;
    const tied: number[] = [];
    const why: string[] = [];
    for (let i = 0; i < 12; i++) {
      const seed = 100 + i * 7;
      const r = foxAndHare(seed, 18);
      ctx.pulse();
      if (!(r.hares.at(-1)! > 0) || !(r.foxes.at(-1)! > 0) || Math.max(...r.hares) > 90 || Math.max(...r.foxes) > 12) gone++;
      const failed = cycleFailures(r);
      if (failed.length === 0) cycles++;
      else if (why.length < 3) why.push(`seed ${seed}: ${failed[0]}`);
      tied.push(r.tied);
    }
    ctx.quality("full.world.eco.fox-hare.lost-or-over", gone, "seeds", "lower", { note: "of 12: hares or foxes gone at the end of 18 years, or over what the range holds" });
    ctx.quality("full.world.eco.fox-hare.cycle-share", cycles / 12, "", "higher", { note: `seeds whose 18 years pass everything the ecosystem's own test asks of seed 11 (a deep fall, a recovery, tied as predator and prey)${why.length ? `; e.g. ${why.join("; ")}` : ""}`.slice(0, 290) });
    ctx.quality("full.world.eco.fox-hare.tied-median", summarise(tied).median, "", "lower", { resolution: 1e-6, note: "the correlation of the foxes' numbers with the hares' change over the next year (a predator's sign is negative)" });
  }
}

/** The high tier's whole cast through `yearsEach` years on each of `count` seeds. */
function cast(ctx: SuiteContext, id: string, count: number, yearsEach: number): void {
  const seeds = Array.from({ length: count }, (_, i) => subSeed(ctx.seed, `eco-${i}`) % 100_000);
  let lost = 0;
  let over = 0;
  let caught = 0;
  let leastSeen = 1;
  const trouble: string[] = [];
  for (const seed of seeds) {
    const r = castThroughYears("high", seed, yearsEach);
    ctx.pulse();
    for (const [kind, present] of Object.entries(r.present)) {
      leastSeen = Math.min(leastSeen, present);
      // (A fox or the swans may be between one and the next: the world's own test allows that.)
      if (present < (kind === "fox" || kind === "swan" ? 0.5 : 0.9)) {
        lost++;
        trouble.push(`seed ${seed}: ${kind} there ${(present * 100).toFixed(0)} % of the time`);
      }
    }
    over += r.overBounds.length;
    caught += r.wronglyCaught;
    if (r.overBounds.length) trouble.push(`seed ${seed}: over bounds ${r.overBounds.join(", ")}`);
  }
  ctx.quality(`${id}.residents-lost`, lost, "", "lower", { note: `resident kinds (of ${KINDS.slice(0, 3).join(", ")}…) mostly gone during ${yearsEach} year(s), over ${seeds.length} seeds; the least seen was there ${(leastSeen * 100).toFixed(0)} % of the time${trouble.length ? `; ${trouble.slice(0, 3).join("; ")}` : ""}`.slice(0, 290) });
  ctx.quality(`${id}.over-bounds`, over, "", "lower", { note: "kinds ever over what the tier may draw (its grown ones and half as many young again)" });
  ctx.quality(`${id}.wrongly-caught`, caught, "", "lower", { note: "roe deer caught (nothing eats one)" });
}

function sky(ctx: SuiteContext): void {
  const sun = emptySun();
  const moon = emptyMoon();
  const sunOff: number[] = [];
  const moonOff: number[] = [];
  for (const ms of INSTANTS) {
    sunAt(ms, sun);
    sunOff.push(apart({ alt: sun.elevation * DEG, az: sun.azimuth * DEG }, referenceSun(ms)));
    moonAt(ms, sun, moon);
    moonOff.push(apart({ alt: moon.elevation * DEG, az: moon.azimuth * DEG }, referenceMoon(ms)));
  }
  const mean = (a: number[]): number => a.reduce((p, q) => p + q, 0) / a.length;
  ctx.quality("world.sky.sun.mean-error", mean(sunOff), "′", "lower", { resolution: 0.01, n: sunOff.length, note: "arc-minutes from an independent series (the Astronomical Almanac's low-precision sun, itself good to 0.6′), at 36 instants over two years" });
  ctx.quality("world.sky.sun.max-error", Math.max(...sunOff), "′", "lower", { resolution: 0.01 });
  ctx.quality("world.sky.moon.mean-error", mean(moonOff), "′", "lower", { resolution: 0.01, n: moonOff.length, note: "arc-minutes from an independent series seen from Copenhagen (the Almanac's low-precision moon with its parallax, itself good to about 20′)" });
  ctx.quality("world.sky.moon.max-error", Math.max(...moonOff), "′", "lower", { resolution: 0.01 });

  const stars = unpackStars(STAR_DATA, STAR_COUNT);
  const m: Mat3 = new Float64Array(9);
  const v: Vec3 = [0, 0, 0];
  const starOff = STAR_PINS.map(([name, iso, alt, az]) => {
    rotate(skyMatrix(Date.parse(iso), m), stars.dir, v, STAR_NAMES[name]! * 3);
    return apart({ alt: elevationOf(v) * DEG, az: azimuthOf(v) * DEG }, { alt, az });
  });
  ctx.quality("world.sky.stars.mean-error", mean(starOff), "′", "lower", { resolution: 0.01, n: starOff.length, note: "arc-minutes from the U.S. Naval Observatory's altitude and azimuth for nine stars at 17 instants" });
  ctx.quality("world.sky.stars.max-error", Math.max(...starOff), "′", "lower", { resolution: 0.01 });

  // Sunrise and sunset (the sun's centre at -0.833°), against the almanac's minute.
  const riseOff = SUN_TIMES.map(([lo, hi, rising, when]) => {
    let a = Date.parse(lo);
    let b = Date.parse(hi);
    for (let i = 0; i < 40; i++) {
      const mid = (a + b) / 2;
      if (sunAt(mid, sun).elevation * DEG + 0.833 < 0 === rising) a = mid;
      else b = mid;
    }
    return Math.abs((a + b) / 2 - Date.parse(when)) / 60_000;
  });
  ctx.quality("world.sky.sunrise.max-error", Math.max(...riseOff), "min", "lower", { resolution: 0.01, n: riseOff.length, note: "minutes from the almanac's sunrise and sunset over Copenhagen at midsummer and midwinter 2026" });
}

export const suite: Suite = {
  name: "world-algorithms",
  about: "the SANDBOX's algorithms, headless: the land, what grows where, finding a way, the ecosystem, the sky",
  headline: [
    "world.terrain.nondeterministic-chunks",
    "world.terrain.edge-gap",
    "world.biome.out-of-bounds",
    "world.plants.in-water",
    "world.plants.on-paths",
    "world.plants.in-buildings",
    "world.nav.missed",
    "world.nav.through-solids",
    "world.nav.length-ratio-mean",
    "world.nav.length-ratio-worst",
    "world.eco.year.residents-lost",
    "world.eco.year.over-bounds",
    "world.sky.sun.max-error",
    "world.sky.moon.max-error",
    "world.sky.stars.max-error",
    "world.terrain.chunk",
    "world.nav.plan",
    "world.eco.step-1k.high",
  ],
  run(ctx) {
    land(ctx);
    ctx.log("the land: grown, compared, surveyed");
    const map = buildMap();
    plants(ctx, map);
    navigation(ctx, map);
    ctx.log("the real map: plants checked, ways planned against the reference");
    ecosystem(ctx);
    ctx.log("the ecosystem: stepped, and run through its years");
    sky(ctx);
  },
};
