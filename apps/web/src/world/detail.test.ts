import { describe, expect, test } from "bun:test";
import { Group, Mesh, Raycaster, Vector3 } from "three/webgpu";
import { COUNCIL_TABLE_TOP, Keep, LAB_BENCH_TOP, stationMatrix } from "./keep.ts";
import { chunkDistance, fineBand, Land, SKIRT, surfaceArrays, wantsFine } from "./land.ts";
import { built } from "./path.ts";
import { BASE_FLATS, CELL, CELLS, CHUNK, chunkSamples, FINE, FINE_CELL, FINE_CELLS, fineSurface, heightAt, KEEP_FLAT, KEEP_RADIUS, plotFlat, SEED, surfaceAt, surfaceHeight } from "./terrain.ts";
import { TIERS } from "./tiers.ts";
import { FAR, MID, NEAR, TREE_KINDS, treeBand, treeTriangles, Vegetation } from "./vegetation.ts";

/*
 * The world's finer resolution: the land's fine grid near the camera (how it
 * meets the base grid without a crack or a pop, and that what feet stand on is
 * what's drawn), the trees' levels of detail, and the tiers' triangle budgets.
 */

const BIG = ["trees", "bushes", "rocks"] as const;
const n = FINE_CELLS + 1;

describe("the land's fine grid", () => {
  test("it holds the base grid's corners, and every corner is the land's own height", () => {
    const base = chunkSamples(SEED, 3, -2, [KEEP_FLAT], built, BIG);
    const fine = fineSurface(SEED, base, built);
    expect(fine.cells).toBe(CELLS * FINE);
    for (let j = 0; j <= CELLS; j++) for (let i = 0; i <= CELLS; i++) expect(fine.heights[j * FINE * n + i * FINE]).toBe(base.heights[j * (CELLS + 1) + i]!);
    for (let j = 0; j < n; j += 3) for (let i = 0; i < n; i += 5) expect(fine.heights[j * n + i]).toBe(Math.fround(heightAt(SEED, 3 * CHUNK + i * FINE_CELL, -2 * CHUNK + j * FINE_CELL, [KEEP_FLAT])));
    // The same seed, the same fine land.
    expect(fineSurface(SEED, chunkSamples(SEED, 3, -2, [KEEP_FLAT], built, BIG), built).faces).toEqual(fine.faces);
  });

  test("neighbouring chunks share their fine edges exactly, morph targets too (no cracks)", () => {
    const a = fineSurface(SEED, chunkSamples(SEED, 2, 1, [], undefined, BIG));
    const right = fineSurface(SEED, chunkSamples(SEED, 3, 1, [], undefined, BIG));
    const up = fineSurface(SEED, chunkSamples(SEED, 2, 2, [], undefined, BIG));
    for (let k = 0; k < n; k++) {
      expect(a.heights[k * n + FINE_CELLS]).toBe(right.heights[k * n]!);
      expect(a.heights[FINE_CELLS * n + k]).toBe(up.heights[k]!);
      expect(a.coarse[k * n + FINE_CELLS]).toBeCloseTo(right.coarse[k * n]!, 5);
      expect(a.coarse[FINE_CELLS * n + k]).toBeCloseTo(up.coarse[k]!, 5);
    }
  });

  test("fully morphed, it is the base surface: a chunk on the fine grid meets one on the base grid without a crack", () => {
    const base = chunkSamples(SEED, -4, 5, [], undefined, BIG);
    const fine = fineSurface(SEED, base);
    const east = chunkSamples(SEED, -3, 5, [], undefined, BIG);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) expect(fine.coarse[j * n + i]).toBeCloseTo(surfaceHeight(base, i / FINE, j / FINE), 5);
      // Along the shared edge, the base neighbour's edge is a straight line between its corners.
      const v = j / FINE;
      const j0 = Math.min(CELLS - 1, Math.floor(v));
      const t = v - j0;
      const edge = east.heights[j0 * (CELLS + 1)]! * (1 - t) + east.heights[(j0 + 1) * (CELLS + 1)]! * t;
      expect(fine.coarse[j * n + FINE_CELLS]).toBeCloseTo(edge, 4);
    }
  });

  test("what feet stand on is what's drawn: surfaceAt and the land's heightAt follow the fine grid's triangles", () => {
    const land = new Land(new Group(), SEED, false, 32, 96);
    land.update(140, -90, 120, performance.now() + 60_000, 999);
    expect(land.fineChunks).toBeGreaterThan(0);
    let worst = 0;
    let off = 0;
    for (let k = 0; k < 600; k++) {
      const x = 100 + ((k * 0.618) % 1) * 90;
      const y = -130 + ((k * 0.377) % 1) * 90;
      const fine = fineSurface(SEED, chunkSamples(SEED, Math.floor(x / CHUNK), Math.floor(y / CHUNK), BASE_FLATS, built, BIG), built);
      const drawn = surfaceHeight(fine, (x - Math.floor(x / CHUNK) * CHUNK) / FINE_CELL, (y - Math.floor(y / CHUNK) * CHUNK) / FINE_CELL);
      worst = Math.max(worst, Math.abs(surfaceAt(SEED, x, y, BASE_FLATS) - drawn), Math.abs(land.heightAt(x, y) - drawn));
      off += Math.abs(heightAt(SEED, x, y, BASE_FLATS) - drawn);
    }
    expect(worst).toBeLessThan(1e-4);
    // And the land's own smooth height is never far from it on average (a few centimetres).
    expect(off / 600).toBeLessThan(0.06);
  });

  test("the keep's ground and a plot stay level on the fine grid", () => {
    const plot = { x: 140, y: -90, size: 30 };
    const flats = [KEEP_FLAT, plotFlat(plot)];
    for (const [cx, cy] of [[0, 0], [-1, 0], [0, -1], [-1, -1], [2, -2]] as const) {
      const s = chunkSamples(SEED, cx, cy, flats, built, BIG);
      const fine = fineSurface(SEED, s, built);
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const x = cx * CHUNK + i * FINE_CELL;
          const y = cy * CHUNK + j * FINE_CELL;
          const onPlot = Math.max(Math.abs(x - plot.x), Math.abs(y - plot.y)) <= plot.size / 2;
          if (Math.hypot(x, y) <= KEEP_RADIUS || onPlot) expect(fine.heights[j * n + i]).toBe(0);
          // Far off, it morphs to the base grid: level too, a base cell in from the flat's edge.
          if (Math.hypot(x, y) <= KEEP_RADIUS - CELL * 1.5) expect(fine.coarse[j * n + i]).toBe(0);
        }
      }
    }
  });

  test("every edge has a skirt hanging below it, facing out, morphing with it", () => {
    const s = chunkSamples(SEED, 1, 1, [], undefined, BIG);
    const fine = fineSurface(SEED, s);
    const c = FINE_CELLS;
    const a = surfaceArrays(fine, fine.coarse, new Float32Array(n * n).fill(-1000));
    expect(a.positions.length / 9).toBe(c * c * 2 + c * 8);
    const skirts = { south: 0, north: 0, east: 0, west: 0 };
    const lifts = new Map<string, number>();
    for (let t = c * c * 2; t < a.positions.length / 9; t++) {
      const p = a.positions.subarray(t * 9, t * 9 + 9);
      // The face's normal, from its winding.
      const ux = p[3]! - p[0]!;
      const uy = p[4]! - p[1]!;
      const uz = p[5]! - p[2]!;
      const vx = p[6]! - p[0]!;
      const vy = p[7]! - p[1]!;
      const vz = p[8]! - p[2]!;
      const nx = uy * vz - uz * vy;
      const nz = ux * vy - uy * vx;
      const cx = (p[0]! + p[3]! + p[6]!) / 3;
      const cz = (p[2]! + p[5]! + p[8]!) / 3;
      if (Math.abs(cz) < 1e-6) {
        expect(nz).toBeGreaterThan(0);
        skirts.south++;
      } else if (Math.abs(cz + CHUNK) < 1e-6) {
        expect(nz).toBeLessThan(0);
        skirts.north++;
      } else if (Math.abs(cx) < 1e-6) {
        expect(nx).toBeLessThan(0);
        skirts.west++;
      } else {
        expect(cx).toBeCloseTo(CHUNK, 6);
        expect(nx).toBeGreaterThan(0);
        skirts.east++;
      }
      // Its morph target hangs with it: top and bottom of a skirt move by the same amount.
      for (let q = 0; q < 3; q++) {
        const v = t * 3 + q;
        const key = `${a.positions[v * 3]},${a.positions[v * 3 + 2]}`;
        const lift = a.positions[v * 3 + 1]! - a.coarse[v]!;
        const seen = lifts.get(key);
        if (seen === undefined) lifts.set(key, lift);
        else expect(lift).toBeCloseTo(seen, 5);
      }
    }
    expect(skirts).toEqual({ south: c * 2, north: c * 2, east: c * 2, west: c * 2 });
    let lowest = Infinity;
    for (let v = c * c * 6; v < a.positions.length / 3; v++) lowest = Math.min(lowest, a.positions[v * 3 + 1]!);
    expect(lowest).toBeLessThan(Math.min(...fine.heights) - SKIRT + 1e-4);
  });

  test("a chunk on the base grid always lies wholly beyond the ring, where its fine neighbours have become the base surface", () => {
    for (const radius of [40, 96, 150]) {
      expect(fineBand(radius)).toBeGreaterThan(0);
      expect(fineBand(radius)).toBeLessThan(radius);
      for (let d = 0; d < radius + CHUNK; d += 0.5) {
        // Asked for before the ring reaches it, let go only after: no flicker on the edge.
        if (wantsFine(d, false, radius)) expect(wantsFine(d, true, radius)).toBe(true);
        if (!wantsFine(d, false, radius)) expect(d).toBeGreaterThanOrEqual(radius);
      }
    }
    expect(wantsFine(0, false, 0)).toBe(false);
    expect(chunkDistance(0, 0, 10, 10)).toBe(0);
    expect(chunkDistance(1, 0, 10, 10)).toBe(54);
  });

  test("the land swaps chunks near the focus to the fine grid, and back as the focus moves away", () => {
    const radius = 96;
    const land = new Land(new Group(), SEED, false, 32, radius);
    const settle = (x: number, y: number) => {
      for (let i = 0; i < 400; i++) if (!land.update(x, y, 200, performance.now() + 60_000, 999)) break;
    };
    settle(0, 0);
    const check = (x: number, y: number) => {
      let fine = 0;
      for (const c of land.list) {
        const d = chunkDistance(c.cx, c.cy, x, y);
        if (d < radius) expect(c.fine).not.toBeNull();
        if (d > radius + CHUNK * 0.5) expect(c.fine).toBeNull();
        expect(c.mesh.visible).toBe(c.fine === null);
        if (c.fine) fine++;
      }
      return fine;
    };
    expect(check(0, 0)).toBeGreaterThan(4);
    settle(600, 0);
    check(600, 0);
    // The far side of the world, on the base grid again: nothing near the keep is still fine.
    for (const c of land.list) if (chunkDistance(c.cx, c.cy, 0, 0) < radius) expect(c.fine).toBeNull();
    land.dispose();
  });

  test("the base grid samples every 4 m and the fine every 2 m", () => {
    expect(CELL).toBe(4);
    expect(FINE_CELL).toBe(2);
  });
});

describe("levels of detail and budgets", () => {
  test("trees: near within the tier's detail distance, simpler to its tree distance, far beyond; steady on the edges", () => {
    for (const tier of Object.values(TIERS)) {
      let last = NEAR;
      for (let d = 0; d < 600; d += 1) {
        const band = treeBand(d, FAR, tier.treeDetail, tier.treeLod);
        // Farther never means more detail; a tier without near trees never draws them.
        expect(band).toBeGreaterThanOrEqual(last);
        if (tier.treeDetail === 0) expect(band).not.toBe(NEAR);
        // A chunk keeps its level a little past the edge: never coarser than a fresh one's.
        for (const current of [NEAR, MID, FAR]) expect(treeBand(d, current, tier.treeDetail, tier.treeLod)).toBeLessThanOrEqual(band);
        last = band;
      }
      expect(treeBand(tier.treeLod + CHUNK * 2, FAR, tier.treeDetail, tier.treeLod)).toBe(FAR);
    }
    const edge = TIERS.medium.treeLod + CHUNK * 0.9;
    expect(treeBand(edge, MID, TIERS.medium.treeDetail, TIERS.medium.treeLod)).toBe(MID);
    expect(treeBand(edge, FAR, TIERS.medium.treeDetail, TIERS.medium.treeLod)).toBe(FAR);
  });

  test("every kind of tree has more, smaller facets near than farther off", () => {
    const tris = treeTriangles();
    for (const kind of TREE_KINDS) {
      const [near, mid] = tris[kind];
      expect(near).toBeGreaterThan(mid * 1.5);
      expect(near).toBeLessThan(1000);
    }
  });

  test("the land and what grows on it stay within each tier's triangle budget, at the keep and out in the woods", () => {
    // Room left for the keep, the characters and the sky.
    const room = 80_000;
    for (const name of ["low", "medium", "high"] as const) {
      const tier = TIERS[name];
      for (const [x, y] of [[0, 0], [400, 300], [-120, 90]] as const) {
        const root = new Group();
        const land = new Land(root, SEED, false, 32, tier.terrainFine);
        const veg = new Vegetation(root, tier, (px, py) => land.heightAt(px, py), (c, l) => land.smallLayer(c, l));
        land.onGrow = (c) => veg.addChunk(c);
        land.onDrop = (c) => veg.removeChunk(c);
        for (let i = 0; i < 400; i++) {
          const growing = land.update(x, y, tier.radius, performance.now() + 60_000, 999);
          if (!veg.update(x, y, performance.now() + 60_000) && !growing) break;
        }
        let ground = 0;
        for (const c of land.list) ground += (c.fine ?? c.mesh).geometry.getAttribute("position").count / 3;
        expect(ground + veg.triangles()).toBeLessThan(tier.triangles - room);
        veg.dispose();
        land.dispose();
      }
    }
    // And the budgets themselves grow with the tier, each below what it drew at full reach before the finer
    // world (low 0.54-0.65 M, medium 1.07-1.16 M, high 1.75-2.14 M): phones must not get slower.
    expect(TIERS.low.triangles).toBeLessThan(TIERS.medium.triangles);
    expect(TIERS.medium.triangles).toBeLessThan(TIERS.high.triangles);
    expect(TIERS.low.triangles).toBeLessThan(540_000);
    expect(TIERS.medium.triangles).toBeLessThan(1_070_000);
    expect(TIERS.high.triangles).toBeLessThan(2_000_000);
  });
});

describe("the stations, made finer, keep what stands on them", () => {
  test("Reachy Mini's table top is 0.87 m up and the arms' bench 0.93 m (where critters.ts puts them)", () => {
    expect(COUNCIL_TABLE_TOP).toBe(0.87);
    expect(LAB_BENCH_TOP).toBe(0.93);
    const keep = new Keep(false, 0);
    const solids = keep.group.children.filter((o): o is Mesh => o instanceof Mesh);
    const ray = new Raycaster();
    // Straight down onto a station's spot (its own frame), the first thing hit.
    const topAt = (place: "council" | "forge", x: number, z: number): number => {
      const from = new Vector3(x, 3, z).applyMatrix4(stationMatrix(place));
      ray.set(from, new Vector3(0, -1, 0));
      const hit = ray.intersectObjects(solids, false)[0];
      return hit ? hit.point.y : Number.NaN;
    };
    // Where Reachy Mini sits, and free spots on the table; both arms' places on the bench, and between them.
    for (const [x, z] of [[0.25, 0.08], [0, -0.35], [-0.6, 0.4]] as const) expect(topAt("council", x, z)).toBeCloseTo(COUNCIL_TABLE_TOP, 3);
    for (const x of [0.65, 1.2, 1.75]) expect(topAt("forge", x, 2.0)).toBeCloseTo(LAB_BENCH_TOP, 3);
    keep.dispose();
  });
});
