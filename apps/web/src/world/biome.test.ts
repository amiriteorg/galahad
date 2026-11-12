import { describe, expect, test } from "bun:test";
import { type Biome, BIOMES, biomeAt, biomeMix, climateAt, emptyClimate, moistureAt } from "./biome.ts";
import { TRAIL } from "./hearth-plan.ts";
import { built } from "./path.ts";
import { afield, isleAt, marshAt, ridgeAt, SCARP, scarpAt, STREAM_STEP, streamAt, streamLevel, uplandAt } from "./relief.ts";
import { seasonFor, seasonState } from "./season.ts";
import { BASE_FLATS, BIG, CHUNK, chunkSamples, DETAIL_KINDS, fineSurface, FLOWER_KINDS, heightAt, LAYERS, onTrail, REED_KINDS, SEED, STRIDE, TREE_KINDS, WATER_LEVEL, waterAt } from "./terrain.ts";

/*
 * The land's climate and biomes, the bigger landforms beyond the home ground,
 * and that what grows follows them, softly, and never the date.
 */

/** A lattice over the land out to `reach` metres, `step` apart. */
function* lattice(reach: number, step: number): Generator<[number, number]> {
  for (let x = -reach; x <= reach; x += step) for (let y = -reach; y <= reach; y += step) yield [x, y];
}

/** The chunk at (x, y), with these layers. */
const chunkAt = (x: number, y: number, layers: readonly (typeof LAYERS)[number][] = LAYERS) => chunkSamples(SEED, Math.floor(x / CHUNK), Math.floor(y / CHUNK), BASE_FLATS, built, layers);

/** Somewhere well inside a biome: a point whose surroundings (`r` metres) are all that biome, nearest the keep first. */
function inside(biome: Biome, r = 40, reach = 2000): [number, number] {
  const found: [number, number, number][] = [];
  for (const [x, y] of lattice(reach, 40)) {
    if (biomeAt(SEED, x, y, BASE_FLATS) !== biome) continue;
    if ([[r, 0], [-r, 0], [0, r], [0, -r], [r * 0.7, r * 0.7], [-r * 0.7, -r * 0.7]].every(([dx, dy]) => biomeAt(SEED, x + dx!, y + dy!, BASE_FLATS) === biome)) found.push([Math.hypot(x, y), x, y]);
  }
  found.sort((p, q) => p[0] - q[0]);
  if (!found.length) throw new Error(`no ${biome} found`);
  return [found[0]![1], found[0]![2]];
}

describe("the climate and the biomes", () => {
  test("every point has shares of the biomes that sum to 1, the same every time; under water it's water, on the keep's ground lawn", () => {
    const w = new Float32Array(BIOMES.length);
    for (const [x, y] of lattice(1200, 60)) {
      biomeMix(SEED, x, y, BASE_FLATS, w);
      let sum = 0;
      for (const v of w) {
        expect(v).toBeGreaterThanOrEqual(0);
        sum += v;
      }
      expect(sum).toBeCloseTo(1, 5);
      const b = biomeAt(SEED, x, y, BASE_FLATS);
      expect(BIOMES).toContain(b);
      expect(biomeAt(SEED, x, y, BASE_FLATS)).toBe(b);
      const wet = heightAt(SEED, x, y, BASE_FLATS) < waterAt(SEED, x, y, BASE_FLATS);
      expect(b === "water").toBe(wet);
      const m = moistureAt(SEED, x, y, BASE_FLATS);
      expect(m).toBeGreaterThanOrEqual(0);
      expect(m).toBeLessThanOrEqual(1);
      if (wet) expect(m).toBe(1);
    }
    for (const [x, y] of [[0, 0], [20, -10], [-30, 15]] as const) expect(biomeAt(SEED, x, y, BASE_FLATS)).toBe("lawn");
  });

  test("every biome is somewhere, none of them all there is", () => {
    const counts = new Map<Biome, number>();
    let n = 0;
    for (const [x, y] of lattice(2400, 40)) {
      const b = biomeAt(SEED, x, y, BASE_FLATS);
      counts.set(b, (counts.get(b) ?? 0) + 1);
      n++;
    }
    for (const b of BIOMES) expect([b, (counts.get(b) ?? 0) > 0]).toEqual([b, true]);
    for (const b of ["meadow", "heath", "woodland", "pinewood", "birchwood", "water"] as const) expect(counts.get(b)! / n).toBeGreaterThan(0.04);
    for (const b of BIOMES) expect(counts.get(b)! / n).toBeLessThan(0.45);
    expect(counts.get("marsh")! / n).toBeGreaterThan(0.015);
    expect(counts.get("outcrop")! / n).toBeGreaterThan(0.004);
  });

  test("one biome turns into the next softly: a few metres on over even ground, no share has moved much", () => {
    const a = new Float32Array(BIOMES.length);
    const b = new Float32Array(BIOMES.length);
    const c = emptyClimate();
    const d = emptyClimate();
    let worst = 0;
    let moved = 0;
    let pairs = 0;
    for (const [x, y] of lattice(900, 30)) {
      climateAt(SEED, x + 7, y + 3, BASE_FLATS, c);
      climateAt(SEED, x + 10, y + 3, BASE_FLATS, d);
      // (A bank, a crag breaking through and the edge of built ground are edges in the land itself.)
      if (c.h < c.water || d.h < d.water || Math.abs(c.h - d.h) > 0.2 || c.crag + d.crag > 0 || c.flat + d.flat > 0) continue;
      biomeMix(SEED, x + 7, y + 3, BASE_FLATS, a);
      biomeMix(SEED, x + 10, y + 3, BASE_FLATS, b);
      let most = 0;
      for (let i = 0; i < a.length; i++) most = Math.max(most, Math.abs(a[i]! - b[i]!));
      worst = Math.max(worst, most);
      if (most > 0.25) moved++;
      pairs++;
    }
    expect(pairs).toBeGreaterThan(1000);
    // (Here and there a hollow or a terrace's riser is damp enough to be another place in three metres; hardly anywhere.)
    expect(worst).toBeLessThanOrEqual(1);
    expect(moved / pairs).toBeLessThan(0.04);
    // And across an edge there is a stretch where both sides have a real share: the mix.
    const [mx, my] = inside("meadow", 30, 600);
    const [wx, wy] = inside("woodland", 30, 600);
    let mixed = 0;
    for (let t = 0; t <= 1; t += 0.002) {
      biomeMix(SEED, mx + (wx - mx) * t, my + (wy - my) * t, BASE_FLATS, a);
      const top = Math.max(...a);
      if (top < 0.8 && top > 0) mixed++;
    }
    expect(mixed).toBeGreaterThan(3);
  });

  test("moisture: wet at the water and along the streams, dry on high ground and on the uplands", () => {
    const c = emptyClimate();
    let shore = 0;
    let shores = 0;
    let hill = 0;
    let hills = 0;
    let bank = 0;
    let banks = 0;
    let upland = 0;
    let uplands = 0;
    for (const [x, y] of lattice(1500, 30)) {
      climateAt(SEED, x, y, BASE_FLATS, c);
      if (c.h < c.water || c.flat > 0) continue;
      const above = c.h - WATER_LEVEL;
      if (above < 0.8) {
        shore += c.moisture;
        shores++;
      } else if (c.upland > 0.9) {
        upland += c.moisture;
        uplands++;
      } else if (above > 5 && c.stream > 0.3) {
        hill += c.moisture;
        hills++;
      } else if (c.stream < 0.08 && above < 4) {
        bank += c.moisture;
        banks++;
      }
    }
    expect(Math.min(shores, hills, banks, uplands)).toBeGreaterThan(20);
    expect(shore / shores).toBeGreaterThan(0.55);
    expect(hill / hills).toBeLessThan(0.4);
    expect(bank / banks).toBeGreaterThan(hill / hills + 0.2);
    expect(upland / uplands).toBeLessThan(0.25);
  });
});

describe("the bigger landforms, beyond the home ground", () => {
  test("the home ground is left as it was: no ridge, upland, marsh, scarp or island within 250 m of the map's middle", () => {
    for (const [x, y] of lattice(300, 12)) {
      if (Math.hypot(x + 35, y) > 250) continue;
      expect(afield(x, y)).toBe(0);
      expect(ridgeAt(SEED, x, y) + uplandAt(SEED, x, y) + marshAt(SEED, x, y) + scarpAt(SEED, x, y) + isleAt(SEED, x, y)).toBe(0);
    }
    expect(afield(600, 0)).toBe(1);
  });

  test("out there are ridges, uplands, marsh flats at the water's level, wooded islands in the lakes, and scarps that streams come down in three falls", () => {
    let ridge = 0;
    let upland = 0;
    let marsh = 0;
    let isles = 0;
    let highest = 0;
    for (const [x, y] of lattice(2000, 25)) {
      const h = heightAt(SEED, x, y, []);
      highest = Math.max(highest, h);
      if (ridgeAt(SEED, x, y) > 0.9) ridge++;
      if (uplandAt(SEED, x, y) > 0.9) upland++;
      // A marsh flat lies within a hand of the water's level, some of it under it (pools), some over (hummocks).
      if (marshAt(SEED, x, y) > 0.95 && Math.abs(h - WATER_LEVEL) < 0.6) marsh++;
      // An island: dry land with water round it, a hundred metres off.
      if (isleAt(SEED, x, y) > 5 && h > WATER_LEVEL + 1) {
        let ring = 0;
        for (let a = 0; a < 8; a++) if (heightAt(SEED, x + Math.cos(a * 0.785) * 105, y + Math.sin(a * 0.785) * 105, []) < WATER_LEVEL) ring++;
        if (ring >= 6) isles++;
      }
    }
    expect(ridge).toBeGreaterThan(100);
    expect(upland).toBeGreaterThan(300);
    expect(marsh).toBeGreaterThan(40);
    expect(isles).toBeGreaterThan(3);
    // The ridges stand well over the hills there were (which topped out near 12 m).
    expect(highest).toBeGreaterThan(15);
    // A stream on a scarp: over its bank its pools climb the scarp's whole height, a pool at a time.
    let cascades = 0;
    for (const [x, y] of lattice(2000, 20)) {
      const s = scarpAt(SEED, x, y);
      if (s < 0.45 || s > 0.55 || streamAt(SEED, x, y) < 0.8) continue;
      const levels = new Set<number>();
      for (let dx = -60; dx <= 60; dx += 2) for (let dy = -60; dy <= 60; dy += 6) if (streamAt(SEED, x + dx, y + dy) > 0.8) levels.add(Math.round(streamLevel(SEED, x + dx, y + dy) * 10));
      if (levels.size >= 3) cascades++;
    }
    expect(cascades).toBeGreaterThan(5);
    expect(SCARP).toBeCloseTo(STREAM_STEP * 3, 9);
  });
});

describe("what grows follows the biome, and never the date", () => {
  test("where things stand doesn't depend on the season", () => {
    const keep = { ...seasonState };
    try {
      seasonFor("summer", 0, seasonState);
      const summer = chunkAt(120, 200);
      seasonFor("winter", 0, seasonState);
      const winter = chunkAt(120, 200);
      for (const layer of LAYERS) expect(winter.layers[layer]).toEqual(summer.layers[layer]!);
      expect(winter.heights).toEqual(summer.heights);
      expect(winter.faces).toEqual(summer.faces);
      expect(winter.cover).toEqual(summer.cover);
    } finally {
      Object.assign(seasonState, keep);
    }
  });

  /** How many of a chunk's layer are of each kind. */
  const kinds = (packed: Float64Array, n: number): number[] => {
    const out = new Array<number>(n).fill(0);
    for (let i = 0; i < packed.length; i += STRIDE) out[packed[i + 5]!]!++;
    return out;
  };
  const share = (counts: number[], ...of: number[]): number => of.reduce((s, k) => s + counts[k]!, 0) / Math.max(1, counts.reduce((s, v) => s + v, 0));

  test("a pinewood is mostly pines and spruces, a birch grove birches, a deciduous wood neither; each thick with trees", () => {
    const pine = TREE_KINDS.indexOf("pine");
    const spruce = TREE_KINDS.indexOf("spruce");
    const birch = TREE_KINDS.indexOf("birch");
    const at = (b: Biome) => kinds(chunkAt(...inside(b, 46), BIG).layers.trees!, TREE_KINDS.length);
    const pinewood = at("pinewood");
    const birchwood = at("birchwood");
    const woodland = at("woodland");
    expect(share(pinewood, pine, spruce)).toBeGreaterThan(0.65);
    expect(pinewood[spruce]!).toBeGreaterThan(3);
    expect(share(birchwood, birch)).toBeGreaterThan(0.55);
    expect(share(woodland, pine, spruce, birch)).toBeLessThan(0.4);
    for (const wood of [pinewood, birchwood, woodland]) expect(wood.reduce((s, v) => s + v, 0)).toBeGreaterThan(18);
  });

  test("a heath is open and under heather; a meadow under flowers, with no heather and no reeds", () => {
    const heather = FLOWER_KINDS.indexOf("heather");
    const heath = chunkAt(...inside("heath", 46));
    const meadow = chunkAt(...inside("meadow", 46));
    const onHeath = kinds(heath.layers.flowers!, FLOWER_KINDS.length);
    expect(share(onHeath, heather)).toBeGreaterThan(0.7);
    expect(onHeath[heather]!).toBeGreaterThan(200);
    expect(heath.layers.trees!.length / STRIDE).toBeLessThan(8);
    const inMeadow = kinds(meadow.layers.flowers!, FLOWER_KINDS.length);
    expect(share(inMeadow, heather)).toBeLessThan(0.05);
    expect(share(inMeadow, 0, 1, 2, 3, 4)).toBeGreaterThan(0.9);
    // Reeds keep to the low wet ground, wherever a chunk has some.
    for (const s of [heath, meadow]) for (let i = 0; i < s.layers.reeds!.length; i += STRIDE) expect(s.layers.reeds![i + 2]!).toBeLessThan(WATER_LEVEL + 2.6);
  });

  test("a marsh stands in reeds, out into the shallows, with lily pads on its still water; alders and willows are its trees", () => {
    const [x, y] = inside("marsh", 12);
    const reeds: number[] = new Array(REED_KINDS.length).fill(0);
    const trees: number[] = new Array(TREE_KINDS.length).fill(0);
    let wading = 0;
    let lilies = 0;
    // (The chunks round it: a marsh is half water.)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const s = chunkAt(x + dx * CHUNK, y + dy * CHUNK);
        kinds(s.layers.reeds!, REED_KINDS.length).forEach((n, k) => (reeds[k] = reeds[k]! + n));
        // (Its own trees: those that stand on marsh, not on the meadow beside it.)
        const t = s.layers.trees!;
        for (let i = 0; i < t.length; i += STRIDE) if (biomeAt(SEED, t[i]!, t[i + 1]!, BASE_FLATS) === "marsh") trees[t[i + 5]!]!++;
        const r = s.layers.reeds!;
        for (let i = 0; i < r.length; i += STRIDE) {
          if (r[i + 2]! < WATER_LEVEL) {
            wading++;
            // Never deeper than a reed stands, and never rushes.
            expect(r[i + 2]!).toBeGreaterThan(WATER_LEVEL - 0.56);
            expect(r[i + 5]).not.toBe(REED_KINDS.indexOf("rushes"));
          }
        }
        const d = s.layers.detail!;
        for (let i = 0; i < d.length; i += STRIDE) {
          if (d[i + 5] !== DETAIL_KINDS.indexOf("lily")) continue;
          lilies++;
          // Afloat: on the water's surface, over the lake's floor.
          expect(d[i + 2]).toBe(WATER_LEVEL);
          expect(heightAt(SEED, d[i]!, d[i + 1]!, BASE_FLATS)).toBeLessThan(WATER_LEVEL);
        }
      }
    }
    expect(reeds.reduce((s, v) => s + v, 0)).toBeGreaterThan(150);
    expect(reeds.every((n) => n > 0)).toBe(true);
    expect(wading).toBeGreaterThan(20);
    expect(lilies).toBeGreaterThan(10);
    expect(trees.reduce((s, v) => s + v, 0)).toBeGreaterThan(2);
    expect(share(trees, TREE_KINDS.indexOf("alder"), TREE_KINDS.indexOf("willow"))).toBeGreaterThan(0.5);
  });

  test("every triangle of a chunk knows its biomes, and what's small is of the ground it stands on", () => {
    const N = BIOMES.length;
    const [hx, hy] = inside("heath", 46);
    for (const [x, y] of [[hx, hy], inside("marsh", 12), [0, -70]] as const) {
      const s = chunkAt(x, y);
      const fine = fineSurface(SEED, s, built);
      for (const surface of [s, fine]) {
        expect(surface.biomes.length).toBe(surface.cells * surface.cells * 2 * N);
        const n = surface.cells + 1;
        for (let q = 0; q < surface.cells * surface.cells * 2; q++) {
          let sum = 0;
          for (let k = 0; k < N; k++) sum += surface.biomes[q * N + k]!;
          // (Shares as bytes: they sum to one, give or take their rounding.)
          expect(Math.abs(sum - 255)).toBeLessThanOrEqual(N);
          // A face well under the lake is the lake's floor and nothing else.
          const i = (q >> 1) % surface.cells;
          const j = Math.floor((q >> 1) / surface.cells);
          const deepest = Math.max(surface.heights[j * n + i]!, surface.heights[j * n + i + 1]!, surface.heights[(j + 1) * n + i]!, surface.heights[(j + 1) * n + i + 1]!);
          if (deepest < WATER_LEVEL - 1.2) expect(surface.biomes[q * N]).toBe(255);
        }
      }
    }
    // On a heath the heather stands on triangles that are heath, never on one with none of it.
    const heath = chunkAt(hx, hy);
    const fine = fineSurface(SEED, heath, built);
    const flowers = heath.layers.flowers!;
    let heather = 0;
    for (let i = 0; i < flowers.length; i += STRIDE) {
      if (flowers[i + 5] !== FLOWER_KINDS.indexOf("heather")) continue;
      heather++;
      const u = (flowers[i]! - heath.cx * CHUNK) / (CHUNK / fine.cells);
      const v = (flowers[i + 1]! - heath.cy * CHUNK) / (CHUNK / fine.cells);
      const ci = Math.min(fine.cells - 1, Math.floor(u));
      const cj = Math.min(fine.cells - 1, Math.floor(v));
      // (One of its cell's two triangles has a share of heath or of pinewood, where heather also grows.)
      const at = (cj * fine.cells + ci) * 2 * N;
      const share = (k: number) => fine.biomes[at + k]! + fine.biomes[at + N + k]!;
      expect(share(BIOMES.indexOf("heath")) + share(BIOMES.indexOf("pinewood")) + share(BIOMES.indexOf("outcrop"))).toBeGreaterThan(0);
    }
    expect(heather).toBeGreaterThan(200);
  });

  test("nothing solid grows on the trail he walks, nor anything at all in a stream's pool", () => {
    let seen = 0;
    for (let cx = -1; cx <= 0; cx++) {
      for (let cy = -1; cy <= 0; cy++) {
        const s = chunkSamples(SEED, cx, cy, BASE_FLATS, built, BIG);
        for (const layer of ["trees", "rocks"] as const) {
          const p = s.layers[layer]!;
          for (let i = 0; i < p.length; i += STRIDE) {
            seen++;
            expect(onTrail(p[i]!, p[i + 1]!)).toBe(false);
          }
        }
      }
    }
    expect(seen).toBeGreaterThan(10);
    for (const p of TRAIL) expect(onTrail(p.x, p.y)).toBe(true);
    expect(onTrail(60, 60)).toBe(false);
    // Streams: wherever a pool stands over its bed, nothing of the land's layers stands under it.
    let pools = 0;
    for (const [cx, cy] of [[-2, 1], [-1, 2], [1, 0], [2, -1], [3, -2]] as const) {
      const s = chunkSamples(SEED, cx, cy, BASE_FLATS, built);
      for (const layer of LAYERS) {
        if (layer === "rocks") continue;
        const p = s.layers[layer]!;
        for (let i = 0; i < p.length; i += STRIDE) {
          const level = waterAt(SEED, p[i]!, p[i + 1]!, BASE_FLATS);
          if (level > WATER_LEVEL + 0.01) expect(p[i + 2]!).toBeGreaterThanOrEqual(level - 0.13);
        }
      }
      for (let i = 0; i < 400; i++) if (waterAt(SEED, cx * CHUNK + (i % 20) * 3.2, cy * CHUNK + Math.floor(i / 20) * 3.2, BASE_FLATS) > WATER_LEVEL + 0.01) pools++;
    }
    expect(pools).toBeGreaterThan(10);
  });
});
