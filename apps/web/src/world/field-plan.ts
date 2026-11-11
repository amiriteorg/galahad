import { PADS, SITES } from "@galahad/core/world";
import type { Collider, Rect } from "./colliders.ts";

/*
 * The proving ground's plan: where its runway, taxiway, apron, buildings, launch
 * complex, rover course and drone gates are, as the land, the walkers, the camera
 * and its own machines need to know them. It lies on the heights west of the
 * keep, on ground levelled at FIELD_LEVEL (the plateau's own height, so nothing
 * is dug or banked up), looking down on the keep and the lake. The contract
 * (core's SITES and PADS) fixes the ground's rectangle and its pads; everything
 * else about the plan lives here. Pure data, so the path planner and the tests
 * can read it without the renderer.
 *
 * The pads are where experiments stand, so nothing built stands on one: the
 * buildings are round the apron, between the launch pad and the course pad; the
 * rover's obstacle course is in the corner north of the flight pad, the drone's
 * gates in the corner south of it. What's on a pad is flat (paving, paint) or
 * drives off when an experiment takes it (the mobile launcher).
 *
 *        x −210                −168 −152          −112                −70
 *   y 42  ┌───────────────────────┬───┬─────────────┬───────────────────┐
 *         │                       │18 │ rover course│                   │
 *      13 ├───────────────────────┤   ├─────────────┤  course pad       │
 *         │                       │ r │             │                   │
 *         │      flight pad       │ u │             ├───────────────────┤ −2
 *         │                       │ n │  taxiway  tower    apron        │
 *     −35 │                       │ w ╞═════════════╡              gate ═╪═ road
 *         │                       │ a │             hangar              │
 *         │                       │ y │             │    blockhouse     │
 *     −83 ├───────────────────────┤   ├─────────────┼───────────────────┤ −68
 *         │                       │36 │ drone gates │  launch pad       │
 *    −112 └───────────────────────┴───┴─────────────┴───────────────────┘
 */

const S = SITES.field;
const pad = (id: string) => PADS.find((p) => p.id === id)!;

/** The ground's height above the keep's (metres): everything on the proving ground stands this high. */
export const FIELD_LEVEL = 5;

/** The whole ground: mown, level. */
export const FIELD: Rect = { x: S.x, y: S.y, hx: S.w / 2, hy: S.d / 2 };

/** The land stays level this far beyond the ground's rectangle (the terrain's own margin round a site), before it falls away. */
export const FIELD_RIM = 3.7;

/** The runway (18/36, north-south) through the flight pad's centre. */
export const RUNWAY: Rect = { x: pad("flight").x, y: pad("flight").y, hx: 8, hy: 72 };

/** The apron, on the keep's side between the launch pad and the rover course: where aircraft park and the road arrives. */
export const APRON: Rect = { x: -92, y: -35, hx: 18, hy: 27 };

/** The taxiway from the apron to the runway. */
export const TAXIWAY: Rect = { x: (APRON.x - APRON.hx + RUNWAY.x + RUNWAY.hx) / 2, y: RUNWAY.y, hx: (APRON.x - APRON.hx - RUNWAY.x - RUNWAY.hx) / 2, hy: 4 };

/** Where the road from the keep reaches the ground: the middle of its east edge. */
export const FIELD_GATE = { x: FIELD.x + FIELD.hx, y: FIELD.y };

/** The entrance: the road runs on from the gate to the apron between two posts on the plateau's rim. */
export const ENTRANCE: Rect = { x: (APRON.x + APRON.hx + FIELD_GATE.x + FIELD_RIM) / 2, y: FIELD_GATE.y, hx: (FIELD_GATE.x + FIELD_RIM - APRON.x - APRON.hx) / 2, hy: 3 };
/** The gate posts stand this far either side of the road's middle, on the rim. */
export const ENTRANCE_POSTS = { x: FIELD_GATE.x + FIELD_RIM, half: 3.6 };

/** The launch pad's concrete: a slab in the middle of the pad, flush with the ground. */
export const LAUNCH_SLAB: Rect = { x: pad("launch").x, y: pad("launch").y, hx: 8, hy: 8 };
/** The flame trench: from under the launcher south to the deflector at the ground's edge. */
export const FLAME_TRENCH: Rect = { x: LAUNCH_SLAB.x, y: (LAUNCH_SLAB.y + pad("launch").y - pad("launch").size / 2 - 1) / 2, hx: 1.3, hy: (LAUNCH_SLAB.y - (pad("launch").y - pad("launch").size / 2 - 1)) / 2 };
export const FLAME_DEFLECTOR = { x: LAUNCH_SLAB.x, y: pad("launch").y - pad("launch").size / 2 - 2.2, hx: 2.6, hy: 0.9, top: 1.7 };

/** The rover course's arena: the course pad's middle, compacted earth, kept bare for whatever is tested there. */
export const ARENA: Rect = { x: pad("course").x, y: pad("course").y, hx: 17, hy: 17 };

/** Ground that's paved rather than mown: nothing grows on it and the land is drawn as worn ground under it. */
export const FIELD_PAVED: Rect[] = [RUNWAY, TAXIWAY, APRON, ENTRANCE, LAUNCH_SLAB, ARENA];

// ---------- the buildings ----------

/** The hangar: on the apron's south-west corner, its wide door (always open) in its east wall, facing the keep. */
export const HANGAR = { x: -105, y: -55, hx: 5, hy: 8, wall: 0.3, eaves: 4.6, ridge: 6.8, door: 6 };
/** The control tower, on the apron's north-west corner: a shaft, a glazed cab, a beacon on its roof. */
export const TOWER = { x: -104, y: -13, half: 2.4, cab: 7.6, roof: 10.9, beacon: 12.2 };
/** The launch blockhouse, between the apron and the launch pad: a bunker with a slit window south, a tracking dish on its roof. */
export const BLOCKHOUSE = { x: -89, y: -65, hx: 4, hy: 2.4, roof: 3, dish: 4.7 };
/** The fuel bowser, parked on the apron's north side. */
export const BOWSER = { x: -82, y: -12, hx: 2.7, hy: 1.15, yaw: 0, top: 2.3 };
/** The windsock's pole, by the tower. */
export const WINDSOCK = { x: -111, y: -17, height: 6.6 };
/** The weather mast, north of the apron: an anemometer and a vane at its top. */
export const WEATHER_MAST = { x: -76, y: -5, height: 9 };
/** The PAPIs: four units beside each touchdown zone, on the landing pilot's left. `dir` is the way they're flown towards (+1 north). */
export const PAPIS = [
  { dir: -1, y: RUNWAY.y + RUNWAY.hy - 20, xs: [-150, -148, -146, -144] },
  { dir: 1, y: RUNWAY.y - RUNWAY.hy + 20, xs: [-170, -172, -174, -176] },
] as const;
/** Lightning masts at the launch pad's south corners, just off it. */
export const LIGHTNING_MASTS = [
  { x: -113.2, y: -109.8 },
  { x: -71, y: -109.8 },
] as const;
export const LIGHTNING_MAST_HEIGHT = 16;

/** The apron's floodlight masts, at two of its corners: how tall, and the way their lamps face (atan2). */
export const FLOODLIGHTS = [
  { x: -73, y: -61, height: 9, aim: Math.PI * 0.78 },
  { x: -111.2, y: -6, height: 9, aim: -Math.PI * 0.28 },
] as const;
/** The weather station's Stevenson screen, beside its mast. */
export const STEVENSON = { x: -73.8, y: -6.2 };
/** The aircraft kept in the hangar (nose to the door, a little north of the middle, its cowling off). */
export const HANGAR_AIRCRAFT = { x: HANGAR.x + 1.1, y: HANGAR.y + 1 };
/** The sign at the gate, south of the road: on two posts, its board facing the road from the keep. */
export const SIGN = { x: -66.3, y: -35 - 3.6 - 4.2, half: 2.6, top: 3 };
/** Things standing about: a tow tug by the hangar, an extinguisher, a picnic bench by the tower, cones, drums. */
export const PROPS: readonly { kind: "tug" | "extinguisher" | "bench" | "cones" | "drums"; x: number; y: number; yaw: number }[] = [
  { kind: "tug", x: -98.4, y: -44.6, yaw: Math.PI / 2 },
  { kind: "extinguisher", x: -99.1, y: -63.7, yaw: 0 },
  { kind: "bench", x: -100.5, y: -6.5, yaw: 0 },
  { kind: "cones", x: -98.5, y: -61.2, yaw: Math.PI / 2 },
  { kind: "drums", x: -94.6, y: -64.8, yaw: 0 },
];

/** Where the resident aircraft is tied down when the flight pad is taken: in front of the hangar, nose to its door. */
export const TIE_DOWN = { x: -85.5, y: -56, heading: Math.PI };
/** Painted tie-down spots (flat): the resident's, and two for visitors on the apron's north side. */
export const TIE_DOWNS = [TIE_DOWN, { x: -92, y: -22, heading: Math.PI / 2 }, { x: -81, y: -23, heading: Math.PI / 2 }] as const;
/** Where an aircraft holds short of the runway, on the taxiway. */
export const HOLD_SHORT = { x: RUNWAY.x + 14, y: RUNWAY.y };

/** The mobile launcher: on the launch pad's slab while the pad is free, beside the blockhouse while an experiment has it. */
export const LAUNCHER_PARK = { x: -80.5, y: -65 };
export const LAUNCHER_PAD = { x: LAUNCH_SLAB.x, y: LAUNCH_SLAB.y };

// ---------- the rover's obstacle course (north of the flight pad, west of the course pad) ----------

/** The course's ground: a beaten track round a loop, with the obstacles on its four sides. */
export const COURSE: Rect = { x: -127, y: 28, hx: 14, hy: 13 };
/** The loop's corners (the rover drives it counter-clockwise from the start line), and the radius they're rounded at. */
export const COURSE_START = { x: -133, y: 17.5 };
export const COURSE_CORNER_RADIUS = 4;
/** The slalom's poles, on the west side (the track weaves between them). */
export const SLALOM_POLES = [
  { x: -137.4, y: 32.5 },
  { x: -138.6, y: 27 },
  { x: -137.4, y: 21.8 },
] as const;
/** The track's line: the start, the two east corners, the north-west corner, the slalom's swings, the south-west corner. */
export const COURSE_LINE = [
  COURSE_START,
  { x: -116, y: 17.5 },
  { x: -116, y: 38.5 },
  { x: -138, y: 38.5 },
  { x: -140.4, y: 32.5 },
  { x: -135.6, y: 27 },
  { x: -140.4, y: 21.8 },
  { x: -138, y: 17.5 },
] as const;
export const COURSE_RADII = [0, 4, 4, 3.4, 3, 3, 3, 3.2] as const;

/** The start gate: an arch over the start line, and the charging post beside it where the rover parks. */
export const START_GATE = { x: COURSE_START.x, y: COURSE_START.y, half: 2.3, height: 3.4 };
/** Tyres stacked at the course's corners. */
export const COURSE_TYRES: readonly (readonly [number, number])[] = [
  [-113.3, 15.3],
  [-113.3, 40.8],
  [-141.2, 40.8],
  [-141.2, 15.3],
];

// ---------- the drone's corner (south of the flight pad, west of the launch pad) ----------

/** The quadcopter's landing pad, where it charges. */
export const DRONE_PAD = { x: -116, y: -87.5, half: 1.3 };
/** The gates it flies through: hoops on stands. `heading` is the way it passes through; `z` the hoop's centre above the ground. */
export const DRONE_GATES = [
  { x: -124, y: -94, z: 3.4, heading: Math.PI * 1.1 },
  { x: -137, y: -99, z: 4.6, heading: Math.PI * 1.5 },
  { x: -128, y: -106.5, z: 3, heading: 0.12 },
] as const;
export const DRONE_GATE_RADIUS = 1.7;

// ---------- the boundary ----------

/** The fence along the plateau's rim where it drops towards the lake and the keep: south, and the east side's two ends. */
const RIM_X = FIELD.x + FIELD.hx + FIELD_RIM;
const RIM_S = FIELD.y - FIELD.hy - FIELD_RIM;
const RIM_N = FIELD.y + FIELD.hy + FIELD_RIM;
export const FENCES: readonly { ax: number; ay: number; bx: number; by: number }[] = [
  // South, from clear of the runway's end to the south-east corner.
  { ax: RUNWAY.x + 14, ay: RIM_S, bx: RIM_X, by: RIM_S },
  // East: from the corner up to short of the launch pad's gate; and from beyond the course pad's gate to the north-east corner.
  { ax: RIM_X, ay: RIM_S, bx: RIM_X, by: -77 },
  { ax: RIM_X, ay: 21, bx: RIM_X, by: RIM_N },
  // A short return along the north side.
  { ax: RIM_X, ay: RIM_N, bx: -96, by: RIM_N },
];
/** Low markers along the open stretches of the east rim (nothing to walk into: stepped over). */
export const RIM_MARKERS: readonly { x: number; y: number }[] = [-70, -63, -56, -49, -27, -19, -11, -3, 5].map((y) => ({ x: RIM_X, y }));

// ---------- what's in the way ----------

/** What the path planner walks round (buildings, as circles). */
export const FIELD_OBSTACLES: { x: number; y: number; r: number }[] = [
  // (Each circle keeps within its building's own ground: none reaches onto a pad. The walls themselves are in FIELD_COLLIDERS.)
  { x: HANGAR.x, y: HANGAR.y, r: 7 },
  { x: TOWER.x, y: TOWER.y, r: TOWER.half * Math.SQRT2 + 0.5 },
  { x: BLOCKHOUSE.x, y: BLOCKHOUSE.y, r: 2.9 },
  { x: BOWSER.x, y: BOWSER.y, r: Math.hypot(BOWSER.hx, BOWSER.hy) },
  { x: WINDSOCK.x, y: WINDSOCK.y, r: 0.4 },
  { x: WEATHER_MAST.x, y: WEATHER_MAST.y, r: 0.5 },
  // The rover course's bridge (two circles along it), its rock garden and its start gate's posts.
  { x: -116, y: 25.2, r: 2.6 },
  { x: -116, y: 31.3, r: 2.6 },
  { x: -124.2, y: 38.5, r: 3.2 },
  { x: FLAME_DEFLECTOR.x, y: FLAME_DEFLECTOR.y, r: 2.1 },
];

const box = (x: number, y: number, hx: number, hy: number, top?: number, yaw?: number): Collider => ({ kind: "box", x, y, hx, hy, ...(yaw === undefined ? {} : { yaw }), ...(top === undefined ? {} : { top }) });
const circle = (x: number, y: number, r: number, top?: number): Collider => ({ kind: "circle", x, y, r, ...(top === undefined ? {} : { top }) });

/** The rover course's bridge (field-rover.ts drives it, field-build.ts draws it): from (x, y) along `heading`, an earth ramp up, a plank deck, a ramp down. */
export const BRIDGE = { x: -116, y: 22, heading: Math.PI / 2, half: 1.65, up: 3.6, deck: 5.3, down: 3.6, height: 0.9 };

/**
 * The bridge as walkers meet it: each earth ramp in nine shallow steps (a foot on it is never 5 cm off its slope),
 * the deck, and the kerbs along the deck's sides (higher than a walker on it steps over without standing on them).
 */
function bridge(): Collider[] {
  const B = BRIDGE;
  const c = Math.cos(B.heading);
  const s = Math.sin(B.heading);
  const at = (u: number, v: number): [number, number] => [B.x + c * u - s * v, B.y + s * u + c * v];
  const out: Collider[] = [];
  const steps = 9;
  for (const [u0, length, rising] of [[0, B.up, true], [B.up + B.deck, B.down, false]] as const) {
    for (let k = 0; k < steps; k++) {
      const [x, y] = at(u0 + ((k + 0.5) * length) / steps, 0);
      const top = (B.height * (rising ? k + 0.5 : steps - k - 0.5)) / steps;
      out.push(box(x, y, length / steps / 2, B.half, top, B.heading));
    }
  }
  const [dx, dy] = at(B.up + B.deck / 2, 0);
  out.push(box(dx, dy, B.deck / 2, B.half, B.height, B.heading));
  for (const v of [-1, 1]) {
    const [kx, ky] = at(B.up + B.deck / 2, v * (B.half + 0.12));
    out.push(box(kx, ky, B.deck / 2 + 0.1, 0.08, B.height + 0.16, B.heading));
  }
  return out;
}

/** What nobody walks through (walls, masts, parked plant, the course's obstacles): precise boxes and circles. */
export const FIELD_COLLIDERS: Collider[] = (() => {
  const out: Collider[] = [];
  // The hangar: its back and side walls, and its front either side of the door; the airframe stored at its back.
  const h = HANGAR;
  const t = h.wall / 2;
  out.push(box(h.x - h.hx + t, h.y, t, h.hy, h.eaves));
  out.push(box(h.x, h.y + h.hy - t, h.hx, t, h.eaves));
  out.push(box(h.x, h.y - h.hy + t, h.hx, t, h.eaves));
  const jamb = (h.hy - h.door) / 2;
  // (The front's jambs with the door leaves stacked open in front of them.)
  out.push(box(h.x + h.hx + 0.05, h.y + h.door + jamb + 0.15, 0.45, jamb + 0.2, h.eaves));
  out.push(box(h.x + h.hx + 0.05, h.y - h.door - jamb - 0.15, 0.45, jamb + 0.2, h.eaves));
  // The aircraft inside, its wings across the hangar.
  out.push(box(HANGAR_AIRCRAFT.x - 1.45, HANGAR_AIRCRAFT.y, 3.95, 5.3, 3.1));
  // The tower (its stair on the east side) and the blockhouse.
  out.push(box(TOWER.x, TOWER.y, TOWER.half, TOWER.half, TOWER.roof));
  out.push(box(TOWER.x + TOWER.half + 0.7, TOWER.y, 0.7, TOWER.half, 3));
  out.push(box(BLOCKHOUSE.x, BLOCKHOUSE.y, BLOCKHOUSE.hx, BLOCKHOUSE.hy, BLOCKHOUSE.roof));
  out.push(box(BLOCKHOUSE.x + BLOCKHOUSE.hx + 0.35, BLOCKHOUSE.y + 0.8, 0.35, 0.6, 0.9));
  // The floodlights, the weather station's screen, and what stands about.
  for (const f of FLOODLIGHTS) out.push(circle(f.x, f.y, 0.4, f.height));
  out.push(box(STEVENSON.x, STEVENSON.y, 0.42, 0.36, 1.8));
  for (const p of PROPS) {
    if (p.kind === "tug") out.push(box(p.x + Math.cos(p.yaw) * 0.6, p.y + Math.sin(p.yaw) * 0.6, 1.8, 0.75, 1.4, p.yaw));
    else if (p.kind === "bench") out.push(box(p.x, p.y, 0.95, 0.85, 0.8, p.yaw));
    else if (p.kind === "drums") out.push(circle(p.x + 0.3, p.y + 0.25, 0.75, 0.9));
    else if (p.kind === "extinguisher") out.push(circle(p.x, p.y, 0.35, 1.3));
  }
  out.push(box(BOWSER.x, BOWSER.y, BOWSER.hx, BOWSER.hy, BOWSER.top, BOWSER.yaw));
  out.push(circle(WINDSOCK.x, WINDSOCK.y, 0.25, WINDSOCK.height));
  out.push(circle(WEATHER_MAST.x, WEATHER_MAST.y, 0.3, WEATHER_MAST.height));
  for (const p of PAPIS) for (const x of p.xs) out.push(box(x, p.y, 0.45, 0.4, 0.9));
  for (const m of LIGHTNING_MASTS) out.push(circle(m.x, m.y, 0.45, LIGHTNING_MAST_HEIGHT));
  out.push(box(FLAME_DEFLECTOR.x, FLAME_DEFLECTOR.y, FLAME_DEFLECTOR.hx, FLAME_DEFLECTOR.hy, FLAME_DEFLECTOR.top));
  // The fences (posts and rails: a thin box each) and the entrance's posts.
  for (const f of FENCES) out.push(box((f.ax + f.bx) / 2, (f.ay + f.by) / 2, Math.abs(f.bx - f.ax) / 2 + 0.1, Math.abs(f.by - f.ay) / 2 + 0.1, 1.2));
  for (const side of [-1, 1]) out.push(circle(ENTRANCE_POSTS.x, FIELD_GATE.y + side * ENTRANCE_POSTS.half, 0.3, 3.2));
  // The barrier's housing, and the entrance's sign, south of the road.
  out.push(box(ENTRANCE_POSTS.x - 0.75, FIELD_GATE.y - ENTRANCE_POSTS.half + 0.25, 0.3, 0.3, 1.1));
  out.push(box(SIGN.x, SIGN.y, 0.2, SIGN.half, SIGN.top));
  // The rover course: the start gate's posts, the bridge, the rock garden, the sand pit's frame, the slalom's poles.
  for (const side of [-1, 1]) out.push(circle(START_GATE.x, START_GATE.y + side * START_GATE.half, 0.22, START_GATE.height));
  out.push(...bridge());
  out.push(circle(-124.2, 38.5, 3.2, 0.6));
  out.push(box(-131.3, 38.5, 2.9, 2, 0.25));
  for (const p of SLALOM_POLES) out.push(circle(p.x, p.y, 0.3, 1.6));
  out.push(circle(START_GATE.x - 2.2, START_GATE.y - START_GATE.half - 1.3, 0.3, 1.4));
  for (const [x, y] of COURSE_TYRES) out.push(circle(x, y, 0.5, 0.9));
  // The drone's gates (their stands) and its pad's charging post.
  for (const g of DRONE_GATES) {
    const sx = Math.cos(g.heading + Math.PI / 2) * (DRONE_GATE_RADIUS + 0.2);
    const sy = Math.sin(g.heading + Math.PI / 2) * (DRONE_GATE_RADIUS + 0.2);
    out.push(circle(g.x + sx, g.y + sy, 0.2, g.z));
    out.push(circle(g.x - sx, g.y - sy, 0.2, g.z));
  }
  out.push(circle(DRONE_PAD.x + DRONE_PAD.half + 0.5, DRONE_PAD.y, 0.3, 1.4));
  return out;
})();

/** What can be named on hover: its name, where it stands, how near the pointer must be, and how high its label floats. */
export const FIELD_NAMES: readonly { name: string; x: number; y: number; r: number; z: number }[] = [
  { name: "Hangar", x: HANGAR.x, y: HANGAR.y, r: 8, z: HANGAR.ridge + 1 },
  { name: "Control tower", x: TOWER.x, y: TOWER.y, r: 3.6, z: TOWER.beacon + 1 },
  { name: "Launch blockhouse and tracking dish", x: BLOCKHOUSE.x, y: BLOCKHOUSE.y, r: 4.4, z: BLOCKHOUSE.dish + 2.2 },
  { name: "Fuel bowser", x: BOWSER.x, y: BOWSER.y, r: 3, z: BOWSER.top + 0.8 },
  { name: "Windsock", x: WINDSOCK.x, y: WINDSOCK.y, r: 1.6, z: WINDSOCK.height + 1 },
  { name: "Weather mast", x: WEATHER_MAST.x, y: WEATHER_MAST.y, r: 1.6, z: WEATHER_MAST.height + 1 },
  { name: "PAPI (approach slope lights)", x: -147, y: PAPIS[0].y, r: 4, z: 1.8 },
  { name: "PAPI (approach slope lights)", x: -173, y: PAPIS[1].y, r: 4, z: 1.8 },
  { name: "Flame deflector", x: FLAME_DEFLECTOR.x, y: FLAME_DEFLECTOR.y, r: 3, z: 2.6 },
  { name: "Rover course: start gate", x: START_GATE.x, y: START_GATE.y, r: 2.6, z: START_GATE.height + 0.8 },
  { name: "Rover course: washboard", x: -127.6, y: 17.5, r: 2.4, z: 1.2 },
  { name: "Rover course: staggered logs", x: -121.6, y: 17.5, r: 2.2, z: 1.2 },
  { name: "Rover course: bridge", x: -116, y: 28.25, r: 5, z: 2.6 },
  { name: "Rover course: rock garden", x: -124.2, y: 38.5, r: 3.4, z: 1.6 },
  { name: "Rover course: sand pit", x: -131.3, y: 38.5, r: 3, z: 1.2 },
  { name: "Rover course: slalom", x: -138, y: 27, r: 4, z: 2.2 },
  { name: "Drone pad", x: DRONE_PAD.x, y: DRONE_PAD.y, r: 1.8, z: 1.4 },
  ...DRONE_GATES.map((g) => ({ name: "Drone gate", x: g.x, y: g.y, r: 2.2, z: g.z + DRONE_GATE_RADIUS + 0.8 })),
  { name: "Proving ground: the gate", x: ENTRANCE_POSTS.x, y: FIELD_GATE.y, r: 4.5, z: 4 },
  ...FLOODLIGHTS.map((f) => ({ name: "Apron floodlight", x: f.x, y: f.y, r: 1.2, z: f.height + 0.8 })),
  { name: "Stevenson screen (thermometers)", x: STEVENSON.x, y: STEVENSON.y, r: 1, z: 2.3 },
  ...LIGHTNING_MASTS.map((m) => ({ name: "Lightning mast", x: m.x, y: m.y, r: 1.4, z: LIGHTNING_MAST_HEIGHT + 2 })),
  ...PROPS.filter((p) => p.kind === "tug").map((p) => ({ name: "Tow tug", x: p.x, y: p.y, r: 1.6, z: 2 })),
];
