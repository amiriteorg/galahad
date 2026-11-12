import type { Collider } from "./colliders.ts";

/*
 * His hearth, as numbers: the camp on the lawn south of the keep where his day
 * begins and ends, the bench by the lake where he thinks, and the trail he and the
 * dog walk. What hearth.ts draws, what's solid there, where he stands, sits and
 * lies, and where the dog lies beside him. Pure data (the planner, the
 * choreography and the tests read it without the renderer). World metres, x east,
 * y north; headings in the atan2 convention (0 east, π/2 north).
 *
 *   the fire     a ring of stones, a kettle on a tripod over it;
 *   his bed      a mat with a wedge to lean back on, his feet to the fire, a
 *                footlocker at its foot with his blanket folded on it; the
 *                dog's cushion is tucked against its side (it charges there: the
 *                cushion is its dock), so it sleeps within reach of his hand;
 *   the log      a seat by the fire for the evening;
 *   his desk     a chair, a lantern, his journal open on it;
 *   the pole     at the head of his bed: his pennant, a lantern on its arm;
 *   the bench    on the lake's shore to the south, looking out over the water;
 *   the trail    down to the shore, along it and back across the meadow.
 *
 * A seat is under him where he stands (he sits down in place), so it's solid only
 * where he never stands: a chair's back, a log's ends, the desk's far half.
 */

export interface Spot {
  x: number;
  y: number;
  facing: number;
}

const NORTH = Math.PI / 2;
const SOUTH = -Math.PI / 2;

/** The fire, the middle of the camp. */
export const FIRE = { x: 2, y: -18, r: 0.5 };

/** Everything here is within this of `CAMP` (nothing grows there; the ground is trodden). */
export const CAMP = { x: 1.3, y: -18.2, r: 4.6 };

/** His bed: where he stands on the mat, his feet to the fire, before he lies back; the mat; the wedge behind him. */
export const BED: Spot = { x: -0.9, y: -18, facing: 0 };
export const MAT = { x: -0.9, y: -18, hx: 1.2, hy: 0.6, top: 0.1 };
export const WEDGE = { x: -1.95, y: -18, hx: 0.42, hy: 0.52, low: 0.12, high: 0.66 };
/** The footlocker at the foot of his bed (his blanket lies folded on it by day): nothing cuts across his legs between it and him. */
export const LOCKER = { x: 0.34, y: -18, hx: 0.2, hy: 0.5, top: 0.42 };

/** The dog's cushion, against the mat on his right: its bed and its dock. Where it lies there, and which way (towards him). */
export const DOG_BED = { x: -1.0, y: -18.85, r: 0.42 };
/** The post beside the cushion (its charge light). */
export const DOG_POST = { x: -1.55, y: -19.3 };

/** The log by the fire: he sits on it facing the fire and the keep beyond; the dog lies at his right, within reach. */
export const LOG_SEAT: Spot = { x: 2, y: -19.3, facing: NORTH };
export const LOG = { x: 2, y: -19.52, half: 0.75, r: 0.2 };
export const LOG_DOG = { x: 2.92, y: -19.1 };

/** His desk: he sits at it facing north; the journal lies open before him; the dog lies at his right. */
export const DESK_SEAT: Spot = { x: 4.4, y: -17.3, facing: NORTH };
export const DESK = { x: 4.4, y: -16.72, hx: 0.62, hy: 0.3, top: 0.77 };
/** The open journal on the desk (its middle, and the page his hand writes on, z up). */
export const JOURNAL = { x: 4.42, y: -16.86, z: DESK.top + 0.03 };
export const DESK_LANTERN = { x: 3.92, y: -16.56, z: DESK.top + 0.42 };
export const DESK_DOG = { x: 5.22, y: -17.4 };

/** Where his sword stands while he sleeps. */
export const SWORD_STAND = { x: -1.75, y: -16.95 };
/** The pole at the head of his bed: his pennant at its top, a lantern hanging from its arm (thin: the view looks past it). */
export const POLE = { x: -2.62, y: -17.2, height: 2.9, lantern: 1.95 };
export const WOODPILE = { x: 4.15, y: -20.05 };

/** Where the path from the keep reaches the camp, and where the path to the lake leaves it. */
export const CAMP_GATE = { x: 1.4, y: -14.4 };
export const LAKE_GATE = { x: 1.0, y: -22.6 };

/** The bench on the shore: he sits looking south over the lake; the dog lies at his right. */
export const BENCH_SEAT: Spot = { x: -2, y: -47.2, facing: SOUTH };
export const BENCH = { x: -2, y: -47.0, half: 0.85 };
export const BENCH_DOG = { x: -2.9, y: -47.25 };
export const BENCH_AREA = { x: -2, y: -47.1, r: 1.9 };

/** How far behind where he stands a seat's middle is, and how far back he settles onto it. */
export const SEAT_BACK = 0.15;

/**
 * The trail, walked in turn and round again: down to the lake's shore and along it, up the keep's west side and
 * out into the meadow to the north (beyond the lawn, where the wildlife is: the dog's best chance of a hare),
 * back down the east side past the forge, and home. `pause` is how long he stays (seconds; 0: he walks on),
 * looking towards `look`. No leg is long enough to make him run.
 */
export const TRAIL: readonly { x: number; y: number; pause: number; look: readonly [number, number] }[] = [
  { x: 5, y: -27, pause: 0, look: [14, -43] },
  { x: 15, y: -43.5, pause: 45, look: [34, -70] },
  { x: 4, y: -45, pause: 0, look: [-17, -43] },
  { x: -17, y: -43, pause: 45, look: [-34, -70] },
  { x: -24, y: -29, pause: 0, look: [-40, -12] },
  // Up the west side, between the oracle's stones and the proving ground.
  { x: -40, y: -12, pause: 0, look: [-42, 10] },
  { x: -42, y: 10, pause: 0, look: [-40, 32] },
  { x: -40, y: 32, pause: 0, look: [-34, 52] },
  { x: -34, y: 52, pause: 0, look: [-26, 63] },
  // The meadow under the woods' edge: he stops and looks into the trees.
  { x: -26, y: 63, pause: 40, look: [-30, 100] },
  { x: -4, y: 65, pause: 30, look: [0, 100] },
  { x: 16, y: 56, pause: 0, look: [36, 40] },
  // Down the east side, by the birches and round behind the forge's hill.
  { x: 36, y: 40, pause: 0, look: [44, 20] },
  { x: 44, y: 20, pause: 0, look: [44, -4] },
  { x: 44, y: -4, pause: 0, look: [30, -18] },
  { x: 30, y: -18, pause: 0, look: [10, -24] },
  { x: 10, y: -24, pause: 15, look: [0, 0] },
  { x: 0.4, y: -22.2, pause: 0, look: [5, -27] },
];

/** What nobody walks through at the camp and the bench. */
export const HEARTH_COLLIDERS: readonly Collider[] = [
  // The fire's stones and the tripod over them.
  { kind: "circle", x: FIRE.x, y: FIRE.y, r: FIRE.r + 0.12, top: 1.5, seeThrough: true },
  // The wedge at the head of his bed (the mat itself is walked on).
  { kind: "box", x: WEDGE.x - 0.12, y: WEDGE.y, hx: 0.3, hy: WEDGE.hy, yaw: 0, top: WEDGE.high },
  // The footlocker at the foot of his bed.
  { kind: "box", x: LOCKER.x, y: LOCKER.y, hx: LOCKER.hx, hy: LOCKER.hy, yaw: 0, top: LOCKER.top + 0.15 },
  // The pennant's pole.
  { kind: "circle", x: POLE.x, y: POLE.y, r: 0.07, top: POLE.height, seeThrough: true },
  // The dog's charging post, the sword's stand, the woodpile.
  { kind: "circle", x: DOG_POST.x, y: DOG_POST.y, r: 0.1, top: 0.8, seeThrough: true },
  { kind: "circle", x: SWORD_STAND.x, y: SWORD_STAND.y, r: 0.16, top: 1.35, seeThrough: true },
  { kind: "box", x: WOODPILE.x, y: WOODPILE.y, hx: 0.55, hy: 0.3, yaw: 0.2, top: 0.62 },
  // The log's ends (he sits on its middle); too high to step onto.
  { kind: "circle", x: LOG.x - LOG.half + 0.12, y: LOG.y, r: 0.14, top: 0.6 },
  { kind: "circle", x: LOG.x + LOG.half - 0.12, y: LOG.y, r: 0.14, top: 0.6 },
  // The desk's far half with its lantern, and the chair's back.
  { kind: "box", x: DESK.x, y: DESK.y + 0.1, hx: DESK.hx, hy: DESK.hy - 0.1, yaw: 0, top: DESK.top + 0.5 },
  { kind: "box", x: DESK_SEAT.x, y: DESK_SEAT.y - 0.53, hx: 0.24, hy: 0.035, yaw: 0, top: 1.02 },
  // The bench's back.
  { kind: "box", x: BENCH.x, y: BENCH_SEAT.y + 0.56, hx: BENCH.half, hy: 0.05, yaw: 0, top: 0.95 },
];
