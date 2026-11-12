import { describe, expect, test } from "bun:test";
import { Group, type InstancedMesh } from "three/webgpu";
import { GROW } from "./flora-season.ts";
import { chooseSeason, keepSeason, seasonShown, showSeason, stepGrowth } from "./flora-shade.ts";
import { LeafFall } from "./leaf-fall.ts";
import { STRIDE, TREE_KINDS, type ChunkSamples } from "./terrain.ts";

/*
 * The season as it's shown (eased, never popped), and the leaves that come down
 * in the autumn wind: only while the crowns are thinning, only from deciduous
 * trees near the focus, and a tree that's still near keeps its leaves in the air.
 */

/** A chunk's worth of trees for the leaves to fall from: [x, y, kind]. */
const grown = (trees: [number, number, number][], dist = 0) => ({ dist, chunk: { samples: { layers: { trees: Float64Array.from(trees.flatMap(([x, y, kind]) => [x, y, 0.5, 1, 0, kind])) } } as unknown as ChunkSamples } });
const mesh = (root: Group): InstancedMesh => root.children[0] as InstancedMesh;
const sources = (root: Group): Float32Array => mesh(root).geometry.getAttribute("source").array as Float32Array;

describe("the season as it's shown", () => {
  test("a change of season is eased over a couple of seconds, never a jump; under reduced motion it's at once", () => {
    showSeason("summer");
    expect(seasonShown.grow[GROW.leaf]).toBe(1);
    chooseSeason("winter");
    keepSeason(Date.now());
    let last = seasonShown.grow[GROW.leaf]!;
    let worst = 0;
    let frames = 0;
    while (stepGrowth(1 / 60, 3, true) && frames < 3000) {
      worst = Math.max(worst, Math.abs(seasonShown.grow[GROW.leaf]! - last));
      last = seasonShown.grow[GROW.leaf]!;
      frames++;
    }
    expect(worst).toBeLessThan(0.02);
    expect(frames).toBeGreaterThan(60);
    expect(frames).toBeLessThan(1500);
    expect(seasonShown.grow[GROW.leaf]).toBe(0);
    expect(seasonShown.grow[GROW.twig]).toBe(1);
    // Settled: nothing more to draw for it.
    expect(stepGrowth(1 / 60, 3, true)).toBe(false);
    chooseSeason("summer");
    keepSeason(Date.now());
    expect(stepGrowth(1 / 60, 3, false)).toBe(true);
    expect(seasonShown.grow[GROW.leaf]).toBe(1);
    showSeason(null);
  });
});

describe("leaves in the autumn air", () => {
  test("they fall only while the crowns are thinning, in the autumn half of the year", () => {
    // Full crowns, bare crowns, spring's half-open ones: none.
    expect(LeafFall.share(1, 1, true)).toBe(0);
    expect(LeafFall.share(0, 0, true)).toBe(0);
    expect(LeafFall.share(0.5, 0, false)).toBe(0);
    // Mid October to mid November: all of them.
    expect(LeafFall.share(0.85, 1, true)).toBe(1);
    expect(LeafFall.share(0.3, 1, true)).toBe(1);
    // And in between they begin and stop a few at a time.
    expect(LeafFall.share(0.97, 0.9, true)).toBeGreaterThan(0);
    expect(LeafFall.share(0.97, 0.9, true)).toBeLessThan(0.5);
    expect(LeafFall.share(0.04, 1, true)).toBeLessThan(0.5);
  });

  test("from the deciduous trees nearest the focus, never a pine or a spruce; none in summer, none under reduced motion", () => {
    const root = new Group();
    const leaves = new LeafFall(root, 96);
    const oak = TREE_KINDS.indexOf("oak");
    const pine = TREE_KINDS.indexOf("pine");
    const birch = TREE_KINDS.indexOf("birch");
    const spruce = TREE_KINDS.indexOf("spruce");
    leaves.gather([grown([[5, 0, oak], [10, 4, pine], [-8, 3, birch], [200, 0, oak], [3, -6, spruce]])], 0, 0, 0, 0);
    expect(leaves.stale).toBe(false);
    const src = sources(root);
    const from = new Set<string>();
    for (let i = 0; i < 96; i++) if (src[i * 4 + 1]! > -1000) from.add(`${src[i * 4]},${-src[i * 4 + 2]!}`);
    expect([...from].sort()).toEqual(["-8,3", "5,0"]);
    // A leaf falls from under its tree's top to its foot.
    for (let i = 0; i < 96; i++) if (src[i * 4 + 1]! > -1000) expect(src[i * 4 + 3]!).toBeGreaterThan(3);
    showSeason("summer");
    for (let i = 0; i < 300; i++) leaves.animate(1 / 30, 6, true);
    expect(leaves.count).toBe(0);
    expect(mesh(root).visible).toBe(false);
    // 11 November: most of them, more in a wind; none when nothing may move.
    showSeason(0.862);
    for (let i = 0; i < 300; i++) leaves.animate(1 / 30, 2, true);
    const breeze = leaves.count;
    for (let i = 0; i < 300; i++) leaves.animate(1 / 30, 12, true);
    expect(breeze).toBeGreaterThan(20);
    expect(leaves.count).toBeGreaterThan(breeze);
    expect(leaves.count).toBeLessThanOrEqual(96);
    for (let i = 0; i < 300; i++) leaves.animate(1 / 30, 12, false);
    expect(leaves.count).toBe(0);
    showSeason("winter");
    for (let i = 0; i < 300; i++) leaves.animate(1 / 30, 12, true);
    expect(leaves.count).toBe(0);
    showSeason(null);
    leaves.dispose();
    expect(root.children.length).toBe(0);
  });

  test("a tree that's still near keeps its leaves in the air as the focus moves on; a tier with none draws none", () => {
    const root = new Group();
    const leaves = new LeafFall(root, 56);
    const oak = TREE_KINDS.indexOf("oak");
    const trees: [number, number, number][] = [];
    for (let i = 0; i < 60; i++) trees.push([i * 1.5, (i % 5) * 4, oak]);
    leaves.gather([grown(trees)], 0, 0, 0, 0);
    const before = sources(root).slice();
    // (Which leaf is whose: by its tree's place.)
    const whose = (a: Float32Array, i: number) => `${a[i * 4]},${a[i * 4 + 2]}`;
    leaves.gather([grown(trees)], 9, 0, 0, 0);
    const after = sources(root);
    let kept = 0;
    let stayed = 0;
    for (let i = 0; i < 56; i++) {
      // (A leaf with no tree waits under the ground.)
      if (before[i * 4 + 1]! < -1000) continue;
      const still = [...Array(56).keys()].some((k) => after[k * 4 + 1]! > -1000 && whose(after, k) === whose(before, i));
      if (!still) continue;
      kept++;
      if (whose(after, i) === whose(before, i)) stayed++;
    }
    expect(kept).toBeGreaterThan(10);
    expect(stayed).toBe(kept);
    expect(STRIDE).toBe(6);
    leaves.dispose();
    const none = new LeafFall(root, 0);
    none.gather([grown(trees)], 0, 0, 0, 0);
    none.animate(1 / 30, 5, true);
    expect(none.count).toBe(0);
    expect(root.children.length).toBe(0);
  });
});
