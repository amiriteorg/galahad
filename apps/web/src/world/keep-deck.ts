/*
 * The keep's deck and the stairs up to it, as numbers: what keep.ts draws them
 * from, what keep-plan.ts makes their solids from, and the way up and down
 * them that path.ts walks him along. The keep stands at the world's origin
 * facing south, so its frame (keep.ts': x east, z south) is the world's with
 * y = −z. Pure data.
 */

/** The deck: its frame's height, its planks' top, and the octagon its railing runs round (posts at the corners). */
export const DECK = 4.2;
export const DECK_TOP = DECK + 0.17;
export const DECK_UNDER = DECK - 0.45;
export const RAIL_R = 6.15;
/** The deck's rim, all round; and the part of it he walks on (out to its edge everywhere: the octagon's apothem). */
export const DECK_R = 6.4;
export const DECK_WALK = 5.8;
/** The side of the octagon with no rail: where the stairs come up. */
export const DECK_GAP = 6;

/** The octagon's corners (the keep's frame): RAIL_R out, the first at 22.5°. */
export function deckCorner(i: number): [number, number] {
  const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
  return [Math.sin(a) * RAIL_R, Math.cos(a) * RAIL_R];
}

/** The way out through the gap's side (a unit vector, the keep's frame). */
const GAP_OUT: [number, number] = (() => {
  const [ax, az] = deckCorner(DECK_GAP);
  const [bx, bz] = deckCorner(DECK_GAP + 1);
  const l = Math.hypot(ax + bx, az + bz);
  return [(ax + bx) / l, (az + bz) / l];
})();

/**
 * The stairs: from `top`, beside the deck's gap, down to `foot`, near the keep's door; twelve treads; a stringer
 * under a handrail each side, `side` metres from the middle, on posts. They run along the gap's side, just off it;
 * for the first `opening` metres down from the top there's no handrail on the deck's side: that's the way on.
 */
export const STAIRS = (() => {
  // Along the deck's south-west side, 0.7 m out from where they were first drawn (under its rim).
  const top: [number, number] = [-5.4 + GAP_OUT[0] * 0.7, 3.0 + GAP_OUT[1] * 0.7];
  const foot: [number, number] = [-1.6 + GAP_OUT[0] * 0.7, 6.9 + GAP_OUT[1] * 0.7];
  const run = Math.hypot(foot[0] - top[0], foot[1] - top[1]);
  return {
    top,
    foot,
    run,
    deck: DECK,
    steps: 12,
    /** The way down them (a yaw about the scene's y, keep.ts' `at` convention), and how steeply. */
    yaw: Math.atan2(foot[0] - top[0], foot[1] - top[1]),
    pitch: Math.atan2(DECK, run),
    length: Math.hypot(run, DECK),
    /** Each tread: across, thick, along. */
    tread: { w: 1.4, t: 0.09, d: 0.46 },
    side: 0.74,
    /** The stringers' and handrails' cross-sections (wide, tall) and how far their middles are from the line of the treads' middles, up. */
    stringer: { w: 0.1, h: 0.3, y: -0.1 },
    rail: { w: 0.08, h: 0.08, y: 0.95 },
    /** The posts under each handrail: this many gaps, each this tall. */
    posts: 4,
    post: 0.98,
    /** How far down from the top the deck's side is open (the top three treads), and which side that is (across: −1). */
    opening: (run * 3) / 12,
    inner: -1,
  };
})();

/** The way down the stairs, and across them towards the deck's outside (+), as unit vectors in the keep's frame. */
export const STAIRS_ALONG: [number, number] = [(STAIRS.foot[0] - STAIRS.top[0]) / STAIRS.run, (STAIRS.foot[1] - STAIRS.top[1]) / STAIRS.run];
export const STAIRS_ACROSS: [number, number] = [-STAIRS_ALONG[1], STAIRS_ALONG[0]];

/** A point of the stairs' own frame (`along` down from the top, `across` from the middle) in the keep's. */
export function onStairs(along: number, across: number): [number, number] {
  return [STAIRS.top[0] + STAIRS_ALONG[0] * along + STAIRS_ACROSS[0] * across, STAIRS.top[1] + STAIRS_ALONG[1] * along + STAIRS_ACROSS[1] * across];
}

/** Within the stairs' corridor, or just beyond either end (world x, y). */
export function inStairs(x: number, y: number): boolean {
  const sx = x - STAIRS.top[0];
  const sz = -y - STAIRS.top[1];
  const along = sx * STAIRS_ALONG[0] + sz * STAIRS_ALONG[1];
  const across = sx * STAIRS_ACROSS[0] + sz * STAIRS_ACROSS[1];
  return along > -1 && along < STAIRS.run + 1 && Math.abs(across) < 1.2;
}

/** Tread i's middle (from the deck's end: 0 is the top) in the keep's frame, and how high its top is. */
export function tread(i: number): { x: number; z: number; top: number } {
  const t = (i + 0.5) / STAIRS.steps;
  const [x, z] = onStairs(STAIRS.run * t, 0);
  return { x, z, top: STAIRS.deck * (1 - t) + STAIRS.tread.t / 2 };
}

/** The landing: a board at the deck's height between its edge and the top tread, along the opening (the stairs' frame: along, across, half-extents). */
export const LANDING = { along: STAIRS.opening / 2 + 0.05, across: STAIRS.inner * 0.835, halfAlong: STAIRS.opening / 2, halfAcross: 0.215 };

/** Pots of plants on the deck (the keep's frame, a size, whether a vine trails from it). */
export const DECK_POTS: readonly (readonly [number, number, number, boolean])[] = [
  [4.4, 2.6, 1.2, false],
  [4.9, -1.4, 1, true],
  [-4.7, -2.0, 1.1, true],
  [-3.2, -4.4, 0.9, false],
  [2.0, -5.4, 1, false],
  [-5.2, 1.4, 0.9, true],
];

/** A point of the keep's frame in the world (x east, y north, z up). */
export const keepToWorld = (x: number, z: number, up = 0): { x: number; y: number; z: number } => ({ x, y: -z, z: up });

/** Where he rests at the keep: on the deck, west of the room, looking out over the meadow to the west. */
export const DECK_REST = { ...keepToWorld(-4.3, -0.4, DECK_TOP), facing: Math.PI };

/**
 * The way between the deck and the foot of the stairs (world, z up), from the deck down: round the room's west side
 * to the landing, onto the top tread, down the middle of the treads, and a step out from the foot.
 */
export const STAIR_WAY: readonly { x: number; y: number; z: number }[] = (() => {
  const t0 = tread(0);
  const landing = onStairs(t0.top > 0 ? STAIRS.run / STAIRS.steps / 2 : 0, LANDING.across);
  const top = onStairs(STAIRS.run / STAIRS.steps / 2, 0);
  const foot = onStairs(STAIRS.run + 0.7, 0);
  return [keepToWorld(-4.25, 1.9, DECK_TOP), keepToWorld(landing[0], landing[1], DECK_TOP), keepToWorld(top[0], top[1], t0.top), keepToWorld(foot[0], foot[1], 0)];
})();
