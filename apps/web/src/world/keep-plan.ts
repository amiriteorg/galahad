import { type Station, STATIONS } from "@galahad/core/world";
import type { Collider } from "./colliders.ts";
import { PLACES, standAt, stationFacing } from "./path.ts";

/*
 * The keep's and its stations' solids, as walkers and the camera need them:
 * footprints (circles and turned boxes) with their heights, drawn from the same
 * numbers keep.ts builds them with (world.test.ts holds them to the drawn
 * meshes). What a walker meets is what stands on the ground in his way: the
 * giant tree's trunk and roots, the deck's posts, the stairs, each station's
 * deck, walls, legs, ladder and lantern; what the camera keeps out of is all of
 * it, up to the crowns and roofs. Pure data,
 * so the planner and the tests can read it without the renderer. World metres,
 * x east, y north; heights above the keep's ground (0).
 */

type Place = Exclude<Station, "field">;

/** A station's own frame (as keep.ts builds it): x to its left, z towards its front, which faces `stationFacing`. */
function frame(place: Place) {
  const s = STATIONS[place];
  const h = stationFacing(place);
  const sin = Math.sin(h);
  const cos = Math.cos(h);
  const x = (lx: number, lz: number) => s.x - sin * lx + cos * lz;
  const y = (lx: number, lz: number) => s.y + cos * lx + sin * lz;
  /** A local turn (keep.ts's `at(…, yaw)`) as a world yaw for a box whose hx lies along its local x. */
  const yaw = (turn = 0) => h + Math.PI / 2 + turn;
  return {
    circle: (lx: number, lz: number, r: number, top: number, bottom = 0, more: Partial<Collider> = {}): Collider => ({ kind: "circle", x: x(lx, lz), y: y(lx, lz), r, top, bottom, ...more }) as Collider,
    box: (lx: number, lz: number, hx: number, hz: number, top: number, bottom = 0, turn = 0, more: Partial<Collider> = {}): Collider =>
      ({ kind: "box", x: x(lx, lz), y: y(lx, lz), hx, hy: hz, yaw: yaw(turn), top, bottom, ...more }) as Collider,
  };
}

/** The keep's deck: its height, its octagon's corner radius, and its underside. */
const DECK = 4.2;
const DECK_R = 6.4;
const DECK_UNDER = DECK - 0.45;

/** The giant tree's crown, in layers (from, to, how wide): its heaps of leaves are widest a little above the room's roof. */
const CROWN: readonly [number, number, number][] = [
  [7.0, 8.0, 8.4],
  [8.0, 9.0, 10.0],
  [9.0, 12.0, 11.0],
  [12.0, 14.0, 9.8],
  [14.0, 17.0, 8.6],
  [17.0, 18.6, 3.6],
];

/** The giant tree, its deck, the room on it and the stairs (the keep's frame is the scene's: it faces south). */
function keep(): Collider[] {
  const f = frame("keep");
  const out: Collider[] = [
    // The trunk (lumpy, 2.4 m at its foot), its roots, and the trunk above the deck up into the crown.
    f.circle(0, 0, 2.7, 9),
    f.circle(0, 0, 1.75, 12.2, 9),
    // The crown: heaps of leaves from the deck's roof up; the camera keeps out, and sees through it.
    f.circle(0, 0, Math.max(...CROWN.map(([, , r]) => r)), CROWN[CROWN.length - 1]![1], CROWN[0]![0], { stops: "camera", seeThrough: true }),
    // The deck with its rim, joists and railing, and the furniture and plants on it.
    f.circle(0, 0, DECK_R, DECK + 1.5, DECK_UNDER),
    // The room: its walls, glass front and a wide roof with solar panels.
    f.box(0, 3.55, 3.25, 2.25, DECK + 3.65, DECK + 0.1),
  ];
  // Its seven roots, splaying into the lawn.
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.3;
    out.push(f.box(Math.sin(a) * 2.65, Math.cos(a) * 2.65, 1.3, 0.72, 1.15, 0, a - Math.PI / 2));
  }
  // The deck's four struts and their braces (out to the deck's underside).
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    out.push(f.circle(Math.sin(a) * 3.55, Math.cos(a) * 3.55, 0.45, DECK, 0));
    // Its brace, as keep.ts turns it (by a, then pitched about the scene's x): from (c - v) to (c + v), scene axes.
    const v = [Math.sin(a) * 2.2, -Math.cos(a) * Math.sin(0.5) * 2.2, Math.cos(a) * Math.cos(0.5) * 2.2];
    const c = [Math.sin(a) * 3.4, DECK - 0.9, Math.cos(a) * 3.4];
    out.push(f.box(c[0]!, c[2]!, 0.17, Math.hypot(v[0]!, v[2]!) + 0.15, c[1]! + Math.abs(v[1]!) + 0.2, c[1]! - Math.abs(v[1]!) - 0.2, Math.atan2(v[0]!, v[2]!)));
  }
  out.push(...STAIR_COLLIDERS);
  return out;
}

/**
 * The stairs from the deck's south-west down towards the keep's door, as keep.ts draws them (the keep's frame, which
 * is the scene's: x east, z south): twelve treads from `top` (the deck's edge) to `foot`, a stringer under a
 * handrail each side, `side` metres from the middle, on posts. Everything about them comes from here.
 */
export const STAIRS = (() => {
  const top: [number, number] = [-5.4, 3.0];
  const foot: [number, number] = [-1.6, 6.9];
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
  };
})();

/** Tread i's middle (from the deck's end: 0 is the top) in the keep's frame, and how high its top is. */
export function tread(i: number): { x: number; z: number; top: number } {
  const t = (i + 0.5) / STAIRS.steps;
  return {
    x: STAIRS.top[0] + (STAIRS.foot[0] - STAIRS.top[0]) * t,
    z: STAIRS.top[1] + (STAIRS.foot[1] - STAIRS.top[1]) * t,
    top: STAIRS.deck * (1 - t) + STAIRS.tread.t / 2,
  };
}

/**
 * The stairs' solids, exactly as drawn: each tread a block from the ground to its top (what a walker stands on), and
 * beside each, the stringer and handrail over it, from the stringer's underside to the handrail's top there (three
 * to a tread, the tread first); and the lantern each side of their foot.
 */
export const STAIR_COLLIDERS: readonly Collider[] = (() => {
  const f = frame("keep");
  const S = STAIRS;
  const out: Collider[] = [];
  const along = S.run / S.steps / 2;
  const cos = Math.cos(S.yaw);
  const sin = Math.sin(S.yaw);
  // The line of the treads' middles falls from the deck (s = 0) to the ground (s = 1); a stringer or rail of
  // height h is h / cos(pitch) tall, seen straight up.
  const line = (s: number) => S.deck * (1 - s);
  const below = S.stringer.y - S.stringer.h / 2 / Math.cos(S.pitch);
  const above = S.rail.y + S.rail.h / 2 / Math.cos(S.pitch);
  for (let i = 0; i < S.steps; i++) {
    const t = tread(i);
    // Along the stairs, a box's own y (hy); across them, its x (hx), turned by the stairs' yaw.
    out.push(f.box(t.x, t.z, S.tread.w / 2, S.tread.d / 2, t.top, 0, S.yaw));
    const s0 = i / S.steps;
    const s1 = (i + 1) / S.steps;
    for (const side of [-S.side, S.side]) {
      out.push(f.box(t.x + cos * side, t.z - sin * side, Math.max(S.stringer.w, S.rail.w) / 2, along, line(s0) + above, Math.max(0, line(s1) + below), S.yaw));
    }
  }
  for (const side of [-1, 1]) out.push(f.circle(S.foot[0] + cos * side * 0.9, S.foot[1] - sin * side * 0.9, 0.2, 2.1));
  return out;
})();

function council(): Collider[] {
  const f = frame("council");
  return [
    // The low deck (everything on it stands on it): the table, the benches, the pots of plants.
    f.box(0, 0, 2.9, 2.3, 1.6),
    // The parasol: its pole on the deck, its canopy over the table's end.
    f.circle(2.4, -1.8, 0.1, 2.6),
    f.circle(2.4, -1.8, 1.7, 3.1, 2.35, { seeThrough: true }),
  ];
}

function observatory(): Collider[] {
  const f = frame("observatory");
  const out: Collider[] = [];
  for (const [x, z] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]] as const) out.push(f.circle(x, z, 0.2, 2.6));
  // The braces on the front and back (the sides are open: small things can go under the platform).
  for (const z of [-1.6, 1.6]) out.push(f.box(0, z, 1.75, 0.1, 2.15, 0.2));
  // The platform with its railing, the telescope and the chest on it.
  out.push(f.box(0, 0, 2.0, 2.0, 4.75, 2.45));
  // The ladder.
  out.push(f.box(0, 2.05, 0.5, 0.1, 3.05));
  return out;
}

function library(): Collider[] {
  const f = frame("library");
  return [
    // The nook: its deck, walls, posts and shelves, and the window on its west side.
    f.box(0, 0, 2.65, 2.1, 3.25),
    // Its shingled roof, wider than the walls.
    f.box(0, 0, 3.05, 2.6, 4.75, 3.0),
  ];
}

/** The lab's hill: limestone heaps (centre, its height, radius), squashed to 0.8 of their height. */
const HILL: readonly [number, number, number, number][] = [
  [0, -3.4, 1.6, 4.2],
  [-3.2, -2.6, 1.2, 3],
  [3.3, -2.8, 1.1, 3.1],
  [0.6, -4.6, 3.6, 3.2],
  [-2, -4.8, 3, 2.6],
  [3.6, -4.4, 3.0, 2.4],
];

function forge(): Collider[] {
  const f = frame("forge");
  const out: Collider[] = [];
  for (const [x, z, y, r] of HILL) {
    // Where a heap meets the ground and up to a walker's height it's nearly as wide as it gets.
    out.push(f.circle(x, z, r * 1.04, y + r * 0.84));
  }
  out.push(
    // The frame round the wide door, its track, the lintel and the lamp over it.
    f.box(0, 1.15, 3.0, 0.8, 4.15),
    // The desk under the screens and the shelf with the printer on it.
    f.box(0.1, 1.5, 1.75, 0.33, 2.0),
    // The workbench (the arms stand on it), its vice.
    f.box(1.2, 2.2, 1.05, 0.44, 2.2),
    // The crate and the cart of instruments.
    f.box(-1.6, 2.1, 0.4, 0.3, 0.6, 0, 0.3),
    f.box(-2.5, 1.9, 0.35, 0.27, 1.25),
    // Pipes up and along the hill's face.
    f.circle(2.75, 0.45, 0.16, 3.65),
    f.box(-2.75, 0.45, 2.7, 0.17, 2.82, 2.38),
    // The solar panel on the hill.
    f.box(-0.6, -2.1, 1.25, 0.8, 5.75, 4.0, 0.2),
  );
  return out;
}

function watchtower(): Collider[] {
  const f = frame("watchtower");
  const out: Collider[] = [];
  for (const [x, z] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]] as const) out.push(f.circle(x * 1.1, z * 1.1, 0.24, 7.1));
  out.push(
    // X-braces on every side from a little over a metre up: the dog and the ducks go under them, he doesn't.
    f.box(0, 0, 1.55, 1.55, 6.9, 1.15),
    // The ladder up its front.
    f.box(0, 1.62, 0.42, 0.1, 6.5, 0.3),
    // The lookout: its platform, railing and roof.
    f.box(0, 0, 2.2, 2.2, 9.7, 6.75),
    // The mast and the pennant.
    f.circle(0.9, -0.9, 0.5, 14.6, 9.4),
    f.circle(-1.6, 1.9, 0.65, 11, 9.4, { seeThrough: true }),
  );
  return out;
}

function treasury(): Collider[] {
  const f = frame("treasury");
  // The vault on its plinth, its pillars and round door.
  return [f.box(0, 0, 2.3, 2.1, 3.75)];
}

function messenger(): Collider[] {
  const f = frame("messenger");
  return [
    // The radio hut, its roof and the dish on it.
    f.box(-1.2, -0.4, 1.35, 1.15, 3.6),
    // The mast, and the banner and its crossbar on it.
    f.circle(1.3, -0.2, 0.45, 8.8),
    f.box(1.95, -0.2, 0.85, 0.15, 6.55, 3.5, 0, { seeThrough: true }),
  ];
}

function oracle(): Collider[] {
  const f = frame("oracle");
  const out: Collider[] = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + Math.PI / 9;
    if (Math.abs(Math.cos(a) - 1) < 0.15) continue;
    const h = 2.7 + (i % 3) * 0.4;
    out.push(f.box(Math.sin(a) * 4.3, Math.cos(a) * 4.3, 0.55, 0.37, 1.35 + h / 2, 0, a));
  }
  // The altar: a squat stone (an ellipse, turned a little), and the orb floating over it.
  out.push(f.box(0, 0, 0.92, 0.6, 1.05, 0, 0.4), f.circle(0, 0, 0.55, 2.25, 1.2, { stops: "camera", seeThrough: true }));
  return out;
}

/** A lantern on a post at every station's standing place, on his left (the dog keeps his right). */
function lanterns(): Collider[] {
  return PLACES.map((place) => {
    const s = standAt(place);
    const side = s.facing + Math.PI / 2;
    return { kind: "circle", x: s.x + Math.cos(side) * 1.9, y: s.y + Math.sin(side) * 1.9, r: 0.24, top: 2.85 } as Collider;
  });
}

/** A node's place in the fleet's arc in front of the keep (the i-th shown, nearest the stairs first): keep.ts stands its banner or tower there. */
export function fleetSlot(i: number): { x: number; y: number } {
  const side = i % 2 === 0 ? 1 : -1;
  const k = Math.floor(i / 2);
  const angle = -Math.PI / 2 + side * (0.62 + k * 0.28);
  const r = 12 + (k % 2) * 1.6;
  return { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
}

/** The fleet's banners (a pole, its cloth to the east of it) and sandbox hosts' towers, for the nodes keep.ts shows (`hosts`: which of them are towers). */
export function fleetColliders(hosts: readonly boolean[]): Collider[] {
  const out: Collider[] = [];
  hosts.forEach((tower, i) => {
    const { x, y } = fleetSlot(i);
    if (tower) out.push({ kind: "circle", x, y, r: 0.98, top: 6.9 });
    else out.push({ kind: "circle", x, y, r: 0.14, top: 4.85 }, { kind: "box", x: x + 0.6, y, hx: 0.62, hy: 0.1, top: 4.2, bottom: 1.8, seeThrough: true });
  });
  return out;
}

/** The beacon's mast and flame over the room, while it's lit. */
export const BEACON_COLLIDERS: readonly Collider[] = [{ kind: "circle", x: -2, y: -3.4, r: 0.5, top: 9.3, bottom: DECK + 3.3, stops: "camera", seeThrough: true }];

/** Every solid of the keep and its stations. */
export const KEEP_COLLIDERS: readonly Collider[] = [...keep(), ...council(), ...observatory(), ...library(), ...forge(), ...watchtower(), ...treasury(), ...messenger(), ...oracle(), ...lanterns()];
