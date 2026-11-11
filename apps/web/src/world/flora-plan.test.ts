import { describe, expect, test } from "bun:test";
import { Solids, VIEW, WALK } from "./collide.ts";
import { addPlants, ROCK_PARTS, rockHeight, TREE_SOLIDS } from "./flora-plan.ts";
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
    expected += (rocks.length / STRIDE) * 3;
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
