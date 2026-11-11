import { describe, expect, test } from "bun:test";
import { Solids, VIEW, WALK } from "./collide.ts";
import { addPlants, DEADWOOD_SINK, deadwoodScale, LOG, ROCK_PARTS, rockHeight, STUMP, TREE_SOLIDS } from "./flora-plan.ts";
import { chunkSamples, BASE_FLATS, BIG, SEED, STRIDE } from "./terrain.ts";
import { plantModel, TREE_KINDS } from "./vegetation.ts";

/*
 * Trees and rocks as solids, against their models as drawn: the trunk holds
 * the trunk, the crown holds the crown, a rock's circles hold the rock, and
 * none of them is much bigger than what's there. Then a chunk of the real land.
 */

/** A model's vertices (y up, as vegetation.ts builds it). */
function vertices(name: Parameters<typeof plantModel>[0], detail: 0 | 1): Float32Array {
  return plantModel(name, detail).getAttribute("position").array as Float32Array;
}

describe("what grows, as solids", () => {
  test("a tree's trunk holds its trunk up to the crown, and its crown the whole crown (each level of detail, any scale)", () => {
    TREE_KINDS.forEach((name, kind) => {
      const t = TREE_SOLIDS[kind]!;
      let widest = 0;
      for (const detail of [1, 0] as const) {
        const p = vertices(name, detail);
        for (let i = 0; i < p.length; i += 3) {
          const r = Math.hypot(p[i]!, p[i + 2]!);
          const y = p[i + 1]!;
          // The trunk, above the roots (low, stepped over) and below the crown.
          if (y > 0.3 && y < Math.min(t.bottom, 2.4) && r < 0.9) expect(r).toBeLessThan(t.trunk + 0.03);
          // The crown: everything above the trunk's foot is inside the crown's cylinder, or is the trunk.
          if (y >= 0.3) {
            if (r > t.trunk + 0.03) {
              expect(y).toBeGreaterThan(t.bottom - 0.03);
              expect(y).toBeLessThan(t.top + 0.03);
              expect(r).toBeLessThan(t.crown + 0.03);
            }
            widest = Math.max(widest, r);
          }
        }
      }
      // And no bigger than it is.
      expect(t.crown).toBeLessThan(widest + 0.05);
      if (t.skirt) expect(t.skirt).toBeLessThan(t.crown);
    });
  });

  test("a rock's circles hold the rock above the ground, and its top is its top", () => {
    for (const [name, kind] of [["boulder", 0], ["boulder", 1], ["slab", 2]] as const) {
      const parts = ROCK_PARTS[kind === 2 ? 1 : 0]!;
      const p = vertices(name, 1);
      const f = rockHeight(kind);
      let top = 0;
      for (let i = 0; i < p.length; i += 3) {
        // vegetation.ts scales its height by f and sinks it 0.14 (at scale 1).
        const y = p[i + 1]! * f - 0.14;
        if (y < 0.05) continue;
        top = Math.max(top, y);
        const x = p[i]!;
        const z = p[i + 2]!;
        const inside = parts.some(([mx, mz, r, t]) => Math.hypot(x - mx, z - mz) < r + 0.05 && y <= t * f - 0.14 + 0.03);
        expect(inside).toBe(true);
      }
      expect(Math.max(...parts.map((q) => q[3] * f - 0.14))).toBeLessThan(top + 0.05);
    }
  });

  test("deadwood: a log's box holds the log (but for its stub of a branch), a circle the stump it broke from; each low enough to see over", () => {
    const all = vertices("log", 1);
    // (One model: the trunk, and its stump beyond its butt end.)
    const part = (stump: boolean) => {
      const out: number[] = [];
      for (let i = 0; i < all.length; i += 3) if (all[i]! < -LOG.half - 0.02 === stump) out.push(all[i]! - (stump ? STUMP.x : 0), all[i + 1]!, all[i + 2]! - (stump ? STUMP.z : 0));
      return out;
    };
    const log = part(false);
    let top = 0;
    for (let i = 0; i < log.length; i += 3) {
      const [x, y, z] = [log[i]!, log[i + 1]! - DEADWOOD_SINK, log[i + 2]!];
      if (y < 0.05) continue;
      // The stub stands up out of it, thin: everything else is inside the box.
      const stub = y > LOG.top && Math.hypot(x - 0.5, z - 0.2) < 0.3;
      if (!stub) {
        expect(Math.abs(x)).toBeLessThan(LOG.half + 0.03);
        expect(Math.abs(z)).toBeLessThan(LOG.wide + 0.03);
        expect(y).toBeLessThan(LOG.top + 0.03);
        top = Math.max(top, y);
      }
    }
    expect(LOG.top).toBeLessThan(top + 0.08);
    const stump = part(true);
    expect(stump.length).toBeGreaterThan(90);
    let high = 0;
    let wide = 0;
    for (let i = 0; i < stump.length; i += 3) {
      const [x, y, z] = [stump[i]!, stump[i + 1]! - DEADWOOD_SINK, stump[i + 2]!];
      // (Its roots splay out along the ground, stepped over; a mushroom stands beside it in autumn.)
      if (y < 0.2) continue;
      expect(Math.hypot(x, z)).toBeLessThan(STUMP.r + 0.03);
      expect(y).toBeLessThan(STUMP.top + 0.03);
      high = Math.max(high, y);
      wide = Math.max(wide, Math.hypot(x, z));
    }
    expect(STUMP.top).toBeLessThan(high + 0.08);
    expect(STUMP.r).toBeLessThan(wide + 0.15);
    // Whatever a rock's scale, deadwood keeps to its own size: a log is three to four metres, never six.
    expect(deadwoodScale(0.6)).toBeGreaterThan(0.8);
    expect(deadwoodScale(2.4)).toBeLessThan(1.3);
    const solids = new Solids();
    addPlants(solids, undefined, Float64Array.from([0, 0, 0, 1, 0.7, 3]));
    expect(solids.size).toBe(2);
    // Along the log there's no standing in it; a stride to its side there is; and its stump stands beyond its butt end.
    const d = deadwoodScale(1);
    expect(solids.overlaps(Math.cos(0.7) * 1.2, Math.sin(0.7) * 1.2, 0.1, 0.12, 2.5)).toBe(true);
    expect(solids.overlaps(-Math.sin(0.7) * 0.8, Math.cos(0.7) * 0.8, 0.1, 0.12, 2.5)).toBe(false);
    expect(solids.overlaps((STUMP.x * Math.cos(0.7) + STUMP.z * Math.sin(0.7)) * d, (STUMP.x * Math.sin(0.7) - STUMP.z * Math.cos(0.7)) * d, 0.1, 0.12, 2.5)).toBe(true);
  });

  test("a chunk of the real land: each tree a trunk and a crown (a skirt where it hangs low), each rock its circles", () => {
    // A wood north-west of the keep.
    const s = chunkSamples(SEED, -1, 1, BASE_FLATS, () => false, BIG);
    const trees = s.layers.trees!;
    const rocks = s.layers.rocks!;
    expect(trees.length / STRIDE).toBeGreaterThan(30);
    const solids = new Solids();
    const batch = addPlants(solids, trees, rocks);
    let expected = 0;
    for (let i = 0; i < trees.length; i += STRIDE) expected += TREE_SOLIDS[trees[i + 5]!]!.skirt ? 3 : 2;
    for (let i = 0; i < rocks.length; i += STRIDE) expected += rocks[i + 5]! >= 3 ? 2 : 3;
    expect(solids.size).toBe(expected);
    // A walker can't stand in a trunk; the camera can't stand in a crown; neither in a rock.
    for (let i = 0; i < trees.length; i += STRIDE) {
      const [x, y, z, sc] = [trees[i]!, trees[i + 1]!, trees[i + 2]!, trees[i + 3]!];
      expect(solids.overlaps(x, y, 0.1, 0.12, 2.55)).toBe(true);
      const t = TREE_SOLIDS[trees[i + 5]!]!;
      expect(solids.inside(x + t.crown * sc * 0.7, y, z + ((t.bottom + t.top) / 2) * sc)).toBe(true);
    }
    solids.remove(batch);
    expect(solids.size).toBe(0);
    // Masks: trunks stop walkers and the camera, crowns only the camera.
    const one = new Solids();
    addPlants(one, Float64Array.from([0, 0, 0, 1, 0, 0]), undefined);
    const masks = [...one.mask.slice(0, one.high)].sort();
    expect(masks).toEqual([VIEW, WALK | VIEW].sort());
  });
});
