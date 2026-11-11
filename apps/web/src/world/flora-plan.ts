import { type Solids, SOLID, VIEW, WALK } from "./collide.ts";
import { STRIDE } from "./terrain.ts";

/*
 * What's solid about what grows: each tree's trunk (walkers go round it, the
 * camera keeps out of it and looks past it through the dither), its crown (the
 * camera keeps out of it, and sees through it), and where a crown hangs low
 * (a pine's skirt, a round tree's or a blossom's crown at chest height) a
 * smaller circle that tall walkers go round and small ones walk under; each
 * rock's footprint (a boulder with the stone beside it, a layered slab). Bushes,
 * flowers, grass and pebbles aren't solid. Sizes are the models' own
 * (vegetation.ts; flora-plan.test.ts holds them to it), times each plant's
 * scale. Pure.
 */

interface TreeSolid {
  /** The trunk's radius (with its wobble and root flare, up to a walker's height). */
  trunk: number;
  /** The crown: from its lowest leaves to its top, and its widest. */
  bottom: number;
  top: number;
  crown: number;
  /** Where the crown hangs low enough to walk into: the part of it that's dense enough to stop a walker (0: none). */
  skirt: number;
}

/** By TREE_KINDS: oak, pine, round, parasol, birch, blossom (model metres, at scale 1). */
export const TREE_SOLIDS: readonly TreeSolid[] = [
  { trunk: 0.52, bottom: 2.55, top: 6.1, crown: 2.45, skirt: 0 },
  { trunk: 0.2, bottom: 0.95, top: 5.35, crown: 1.58, skirt: 1.05 },
  { trunk: 0.62, bottom: 1.82, top: 4.2, crown: 1.58, skirt: 1.2 },
  { trunk: 0.7, bottom: 3.08, top: 5.2, crown: 3.12, skirt: 0 },
  { trunk: 0.3, bottom: 2.55, top: 5.85, crown: 1.27, skirt: 0 },
  { trunk: 0.36, bottom: 2.1, top: 4.4, crown: 1.84, skirt: 1.4 },
];

/** A rock's parts in its model's frame: [x, z, radius, top] (the top before its height is scaled and it's sunk). */
type RockPart = readonly [number, number, number, number];
/** A boulder with a stone beside it (rock kinds 0 and 1), and a layered slab with a stone at its end (kind 2). */
export const ROCK_PARTS: readonly (readonly RockPart[])[] = [
  [
    [-0.15, 0, 1.06, 1.03],
    [0.15, 0, 1.06, 1.03],
    [0.85, 0.35, 0.44, 0.52],
  ],
  [
    [-0.45, 0, 1.08, 0.59],
    [0.45, 0, 1.08, 0.59],
    [-1.0, 0.55, 0.44, 0.36],
  ],
];

/** How vegetation.ts stands a rock: its height scaled by this for its kind, and sunk by 0.14 of its scale. */
export const rockHeight = (kind: number): number => 0.75 + 0.12 * kind;
const ROCK_SINK = 0.14;
const TREE_SINK = 0.04;

/**
 * Adds a chunk's trees and rocks (its packed placements: x, y, z, scale, turn, kind) to the world of solids,
 * as one batch; returns its id (0: nothing solid there).
 */
export function addPlants(solids: Solids, trees: Float64Array | undefined, rocks: Float64Array | undefined): number {
  solids.open();
  if (trees) {
    for (let i = 0; i < trees.length; i += STRIDE) {
      const t = TREE_SOLIDS[trees[i + 5]!];
      if (!t) continue;
      const x = trees[i]!;
      const y = trees[i + 1]!;
      const z = trees[i + 2]! - TREE_SINK;
      const s = trees[i + 3]!;
      // The trunk is a post to the camera: it looks past it (the dither), but never stands in it.
      solids.circle(x, y, t.trunk * s, z, t.bottom * s, 0, WALK | VIEW);
      solids.circle(x, y, t.crown * s, z, t.top * s, t.bottom * s, VIEW);
      if (t.skirt) solids.circle(x, y, t.skirt * s, z, t.top * s, t.bottom * s, WALK);
    }
  }
  if (rocks) {
    for (let i = 0; i < rocks.length; i += STRIDE) {
      const kind = rocks[i + 5]!;
      const parts = ROCK_PARTS[kind === 2 ? 1 : 0]!;
      const x = rocks[i]!;
      const y = rocks[i + 1]!;
      const s = rocks[i + 3]!;
      const z = rocks[i + 2]! - ROCK_SINK * s;
      const cos = Math.cos(rocks[i + 4]!);
      const sin = Math.sin(rocks[i + 4]!);
      const f = rockHeight(kind);
      for (let k = 0; k < parts.length; k++) {
        const [mx, mz, r, top] = parts[k]!;
        // The model's x points along the turn, its z the other way round (scene z is south).
        solids.circle(x + (mx * cos + mz * sin) * s, y + (mx * sin - mz * cos) * s, r * s, z, top * f * s, 0, k < 2 ? SOLID : WALK | VIEW);
      }
    }
  }
  return solids.close();
}
