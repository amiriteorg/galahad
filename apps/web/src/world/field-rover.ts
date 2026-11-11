import { BRIDGE, COURSE_LINE, COURSE_RADII } from "./field-plan.ts";
import { type Route, route, type RouteSample, routeSample, sample } from "./field-route.ts";

/*
 * The rover and its obstacle course: the course's ground as a height function
 * (what its ramps, bumps, logs, rocks and sand are built from, and what the
 * rover's wheels stand on), a rocker-bogie suspension solved on it, and the
 * rover's driving round the loop. World metres, x east, y north, z up from the
 * proving ground's level. Pure.
 *
 * The suspension is NASA JPL's rocker-bogie as the Open Source Rover has it: on
 * each side a rocker, hinged on the body, carries the rear wheel and a bogie;
 * the bogie, hinged on the rocker, carries the front and middle wheels. All six
 * wheels stay on the ground whatever its shape, and a differential makes the body
 * pitch by the mean of its two rockers.
 */

// ---------- the course's obstacles ----------

/** An obstacle the wheels climb: all in the course's own frame of each (`x`, `y` its origin, `heading` the way the track crosses it). */
export type Obstacle =
  /** A profile along the track (ramps, a bridge's deck): [distance, height] points, `half` wide either side. */
  | { kind: "ramp"; x: number; y: number; heading: number; half: number; profile: readonly (readonly [number, number])[] }
  /** A round-topped bump across the track: a cylinder of radius `r` lying `h` proud of the ground, from `from` to `to` across (left +). */
  | { kind: "bump"; x: number; y: number; heading: number; r: number; h: number; from: number; to: number }
  /** A rock: half an ellipsoid, `rx` by `ry`, `h` high. */
  | { kind: "rock"; x: number; y: number; rx: number; ry: number; h: number; yaw: number }
  /** Sand in a frame: rippled, `h` deep above the ground; wheels sink `sink` into it. */
  | { kind: "sand"; x: number; y: number; hx: number; hy: number; h: number; sink: number };

const EAST = 0;
const NORTH = Math.PI / 2;
const WEST = Math.PI;

/** Bumps across the south side (heading east): a washboard, then logs under one side's wheels at a time. */
const washboard: Obstacle[] = [-130, -129, -128, -127, -126, -125].map((x) => ({ kind: "bump", x, y: 17.5, heading: EAST, r: 0.36, h: 0.17, from: -1.75, to: 1.75 }));
const logs: Obstacle[] = [
  { kind: "bump", x: -123.4, y: 17.5, heading: EAST, r: 0.34, h: 0.26, from: 0.15, to: 1.8 },
  { kind: "bump", x: -122.1, y: 17.5, heading: EAST, r: 0.34, h: 0.26, from: -1.8, to: -0.15 },
  { kind: "bump", x: -120.8, y: 17.5, heading: EAST, r: 0.34, h: 0.26, from: 0.15, to: 1.8 },
];

/** The bridge on the east side (heading north): an earth ramp up, a plank deck on trestles, a ramp down. */
export { BRIDGE };
const bridge: Obstacle = {
  kind: "ramp",
  x: BRIDGE.x,
  y: BRIDGE.y,
  heading: BRIDGE.heading,
  half: BRIDGE.half,
  profile: [
    [0, 0],
    [BRIDGE.up, BRIDGE.height],
    [BRIDGE.up + BRIDGE.deck, BRIDGE.height],
    [BRIDGE.up + BRIDGE.deck + BRIDGE.down, 0],
  ],
};

/** The rock garden on the north side (heading west): stones the wheels pick their way over. */
const hash = (i: number, salt: number): number => {
  const v = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return v - Math.floor(v);
};
const rocks: Obstacle[] = Array.from({ length: 15 }, (_, i): Obstacle => {
  // Three rows across the track, jittered, so each side's wheels meet different stones.
  const row = i % 3;
  const along = Math.floor(i / 3);
  const size = 0.3 + 0.32 * hash(i, 1);
  return {
    kind: "rock",
    x: -121.6 - along * 1.25 - 0.5 * hash(i, 2),
    y: 38.5 + (row - 1) * 1.05 + (hash(i, 3) - 0.5) * 0.45,
    rx: size * (1 + 0.3 * hash(i, 4)),
    ry: size,
    h: 0.13 + 0.2 * hash(i, 5),
    yaw: hash(i, 6) * Math.PI,
  };
});

/** The sand pit on the north side, after the rocks: its timber frame's sills are bumps of their own. */
export const SAND = { x: -131.3, y: 38.5, hx: 2.7, hy: 1.85, h: 0.1, sink: 0.055 };
const sand: Obstacle[] = [
  { kind: "sand", ...SAND },
  { kind: "bump", x: SAND.x + SAND.hx + 0.1, y: SAND.y, heading: WEST, r: 0.2, h: 0.15, from: -SAND.hy - 0.2, to: SAND.hy + 0.2 },
  { kind: "bump", x: SAND.x - SAND.hx - 0.1, y: SAND.y, heading: WEST, r: 0.2, h: 0.15, from: -SAND.hy - 0.2, to: SAND.hy + 0.2 },
];

export const OBSTACLES: readonly Obstacle[] = [...washboard, ...logs, bridge, ...rocks, ...sand];

/** The sand's surface: gentle ripples (drawn exactly so). */
export const sandSurface = (x: number, y: number): number => SAND.h + 0.03 * Math.sin(x * 2.3 + 0.7) * Math.sin(y * 1.9 + 1.3);

/** How high one obstacle stands at a point (0 beside it); for sand, `wheels` gives where a wheel settles rather than the surface. */
export function obstacleHeight(o: Obstacle, x: number, y: number, wheels = false): number {
  const dx = x - o.x;
  const dy = y - o.y;
  switch (o.kind) {
    case "ramp": {
      const cos = Math.cos(o.heading);
      const sin = Math.sin(o.heading);
      const u = dx * cos + dy * sin;
      const v = -dx * sin + dy * cos;
      const p = o.profile;
      if (Math.abs(v) > o.half || u <= p[0]![0] || u >= p[p.length - 1]![0]) return 0;
      for (let i = 1; i < p.length; i++) {
        if (u <= p[i]![0]) {
          const a = p[i - 1]!;
          const b = p[i]!;
          return a[1] + ((b[1] - a[1]) * (u - a[0])) / (b[0] - a[0]);
        }
      }
      return 0;
    }
    case "bump": {
      const cos = Math.cos(o.heading);
      const sin = Math.sin(o.heading);
      const u = dx * cos + dy * sin;
      const v = -dx * sin + dy * cos;
      if (v < o.from || v > o.to) return 0;
      const top = o.r * o.r - u * u;
      return top <= 0 ? 0 : Math.max(0, Math.sqrt(top) - (o.r - o.h));
    }
    case "rock": {
      const cos = Math.cos(o.yaw);
      const sin = Math.sin(o.yaw);
      const u = (dx * cos + dy * sin) / o.rx;
      const v = (-dx * sin + dy * cos) / o.ry;
      const k = 1 - u * u - v * v;
      return k <= 0 ? 0 : o.h * Math.sqrt(k);
    }
    case "sand":
      if (Math.abs(dx) > o.hx || Math.abs(dy) > o.hy) return 0;
      return sandSurface(x, y) - (wheels ? o.sink : 0);
  }
}

/** Each obstacle's reach round its origin (metres), so most are skipped at a glance. */
const REACH: Float64Array = Float64Array.from(OBSTACLES, (o) => {
  if (o.kind === "ramp") return Math.hypot(o.profile[o.profile.length - 1]![0], o.half) + 0.1;
  if (o.kind === "bump") return Math.hypot(o.r, Math.max(Math.abs(o.from), Math.abs(o.to))) + 0.1;
  if (o.kind === "rock") return Math.max(o.rx, o.ry) + 0.05;
  return Math.hypot(o.hx, o.hy) + 0.1;
});

/** The course's ground at a point: the highest obstacle there (0 on the flat). `wheels`: where a wheel settles (sand gives). */
export function courseHeight(x: number, y: number, wheels = false): number {
  let h = 0;
  for (let i = 0; i < OBSTACLES.length; i++) {
    const o = OBSTACLES[i]!;
    const r = REACH[i]!;
    const dx = x - o.x;
    const dy = y - o.y;
    if (dx * dx + dy * dy > r * r) continue;
    const v = obstacleHeight(o, x, y, wheels);
    if (v > h) h = v;
  }
  return h;
}

/**
 * How high a wheel's centre rides at (x, y), rolling along `heading`: the wheel is a disc of radius `r`
 * resting on whatever is highest under it (so it starts to climb a bump before its axle reaches it, and
 * bridges a narrow gap).
 */
export function wheelHeight(ground: (x: number, y: number) => number, x: number, y: number, heading: number, r: number): number {
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  let best = -Infinity;
  for (let i = -4; i <= 4; i++) {
    const d = (i / 4) * r * 0.96;
    const z = ground(x + cos * d, y + sin * d) + Math.sqrt(r * r - d * d);
    if (z > best) best = z;
  }
  return best;
}

// ---------- the rocker-bogie ----------

/** A point in a side's plane: forward, up (metres). */
type XZ = readonly [number, number];

/**
 * A rocker-bogie's measures, in the body's frame (x forward, y left, z up). The right side mirrors the left.
 * (The Open Source Rover's own, read from its robot description, are four times smaller: see OSR_SCALE.)
 */
export interface RoverGeometry {
  wheelRadius: number;
  /** The rocker's hinge on the body (the differential's axis): forward, half the track to it, up. */
  pivot: readonly [number, number, number];
  /** From the rocker's hinge: the rear wheel's centre, and the bogie's hinge. */
  rear: XZ;
  bogie: XZ;
  /** From the bogie's hinge: the front and middle wheels' centres. */
  front: XZ;
  mid: XZ;
  /** Each wheel's distance from the centre line: front, middle, rear. */
  track: readonly [number, number, number];
}

/** The Open Source Rover is drawn this many times life size (its wheels are 15 cm across), so it reads beside the 2.5 m knight. */
export const OSR_SCALE = 4;

/** The stand-in rover's measures: the Open Source Rover's (nasa-jpl/osr-rover-code, osr.urdf.xacro), times OSR_SCALE. */
export const ROVER: RoverGeometry = {
  // (Its wheels' grousers reach 80.5 mm from the axle: what they stand on.)
  wheelRadius: 0.0805 * OSR_SCALE,
  pivot: [0.016 * OSR_SCALE, 0.181 * OSR_SCALE, -0.004 * OSR_SCALE],
  rear: [-0.312 * OSR_SCALE, -0.191 * OSR_SCALE],
  bogie: [0.0996 * OSR_SCALE, -0.0913 * OSR_SCALE],
  front: [0.1763 * OSR_SCALE, -0.0933 * OSR_SCALE],
  mid: [-0.0948 * OSR_SCALE, -0.0949 * OSR_SCALE],
  track: [0.2 * OSR_SCALE, 0.281 * OSR_SCALE, 0.189 * OSR_SCALE],
};

/** The wheels, in the order their state is kept: front, middle, rear on the left (0..2), then on the right (3..5). */
export const WHEELS = 6;

/** A rover's pose on the ground: where its body is and how its suspension lies. All angles in radians. */
export interface RoverPose {
  /** The body's origin (world, z above the ground's level), heading, pitch (nose up +) and roll (left side up +). */
  x: number;
  y: number;
  z: number;
  heading: number;
  pitch: number;
  roll: number;
  /** Each side's rocker and bogie, nose up +, measured from level (left, right). */
  rocker: [number, number];
  bogie: [number, number];
  /** Each wheel's centre above the ground's level, and how far it stands off whatever is under it (0 when it's on the ground). */
  wheelZ: Float64Array;
  /** Each wheel's centre along the rover (forward of the body's origin). */
  wheelX: Float64Array;
}

export const roverPose = (): RoverPose => ({ x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0, rocker: [0, 0], bogie: [0, 0], wheelZ: new Float64Array(WHEELS), wheelX: new Float64Array(WHEELS) });

const clamp1 = (v: number): number => Math.max(-1, Math.min(1, v));

/**
 * Settles a rover's suspension at (x, y, heading) on `ground` (the ground's height at a world point): each side's
 * bogie and rocker turn until that side's three wheels all stand on the ground, the body pitches by the mean of
 * its rockers (the differential) and rolls by the difference in its sides' heights. Writes into `out` (its
 * rocker and bogie angles are also where the solver starts from, so call it with the last frame's pose).
 */
export function settle(geo: RoverGeometry, ground: (x: number, y: number) => number, x: number, y: number, heading: number, out: RoverPose): RoverPose {
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  const r = geo.wheelRadius;
  const ex = geo.front[0] - geo.mid[0];
  const ez = geo.front[1] - geo.mid[1];
  const eLen = Math.hypot(ex, ez);
  const eAngle = Math.atan2(ez, ex);
  const gx = geo.bogie[0] - geo.rear[0];
  const gz = geo.bogie[1] - geo.rear[1];
  const gLen = Math.hypot(gx, gz);
  const gAngle = Math.atan2(gz, gx);
  let pivotL = 0;
  let pivotR = 0;
  for (let side = 0; side < 2; side++) {
    const sign = side === 0 ? 1 : -1;
    // The height a wheel's centre rides at, `along` metres forward of the body's origin on this side's line for that wheel.
    const ride = (along: number, wheel: 0 | 1 | 2): number => {
      const off = sign * geo.track[wheel];
      return wheelHeight(ground, x + cos * along - sin * off, y + sin * along + cos * off, heading, r);
    };
    let a = out.rocker[side]!;
    let t = out.bogie[side]!;
    let pz = 0;
    let fx = 0;
    let mx = 0;
    let rx = 0;
    let cf = 0;
    let cm = 0;
    let cr = 0;
    for (let i = 0; i < 6; i++) {
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const bx = geo.pivot[0] + geo.bogie[0] * ca - geo.bogie[1] * sa;
      const ct = Math.cos(t);
      const st = Math.sin(t);
      fx = bx + geo.front[0] * ct - geo.front[1] * st;
      mx = bx + geo.mid[0] * ct - geo.mid[1] * st;
      cf = ride(fx, 0);
      cm = ride(mx, 1);
      // The bogie lies so that its two wheels both stand: front above middle by the ground's difference.
      t = Math.asin(clamp1((cf - cm) / eLen)) - eAngle;
      const bz = cf - (geo.front[0] * Math.sin(t) + geo.front[1] * Math.cos(t));
      rx = geo.pivot[0] + geo.rear[0] * ca - geo.rear[1] * sa;
      cr = ride(rx, 2);
      // The rocker lies so that the bogie's hinge and the rear wheel both stand.
      a = Math.asin(clamp1((bz - cr) / gLen)) - gAngle;
      pz = cr - (geo.rear[0] * Math.sin(a) + geo.rear[1] * Math.cos(a));
    }
    out.rocker[side] = a;
    out.bogie[side] = t;
    const k = side * 3;
    out.wheelX[k] = fx;
    out.wheelX[k + 1] = mx;
    out.wheelX[k + 2] = rx;
    out.wheelZ[k] = cf;
    out.wheelZ[k + 1] = cm;
    out.wheelZ[k + 2] = cr;
    if (side === 0) pivotL = pz;
    else pivotR = pz;
  }
  out.x = x;
  out.y = y;
  out.heading = heading;
  out.pitch = (out.rocker[0] + out.rocker[1]) / 2;
  out.roll = Math.atan2(pivotL - pivotR, 2 * geo.pivot[1]);
  out.z = (pivotL + pivotR) / 2 - geo.pivot[0] * Math.sin(out.pitch) - geo.pivot[2] * Math.cos(out.pitch);
  return out;
}

/**
 * How a corner wheel steers for a path of curvature `k` (1/m, left +): Ackermann, every wheel's axle pointing at
 * the one turning centre abeam the middle wheels. `forward` and `left` are the wheel's place from the middle axle.
 */
export const steerFor = (k: number, forward: number, left: number): number => Math.atan2(forward * k, 1 - left * k);

/** How fast a wheel there rolls for a body speed of 1 (its own path's radius over the body's). */
export const rollFor = (k: number, forward: number, left: number): number => Math.hypot(1 - left * k, forward * k);

// ---------- driving the loop ----------

/** The track: a loop, driven counter-clockwise from the start line. */
export const COURSE_ROUTE: Route = route(COURSE_LINE, COURSE_RADII, true);

/** The rover's speeds (m/s): on the flat, and picking its way over an obstacle. */
export const ROVER_SPEED = 1.15;
export const ROVER_CRAWL = 0.55;
const ROVER_ACCEL = 0.9;
/** It stops when someone stands within this of it or of its track just ahead (metres), and looks this far ahead. */
export const ROVER_KEEP_CLEAR = 2.6;
const ROVER_LOOK_AHEAD = 4.5;

export interface RoverState {
  /** How far it has driven round the loop (metres; grows, never wraps), and its speed. */
  s: number;
  v: number;
  pose: RoverPose;
  /** Each wheel's turn about its axle (radians; front, middle, rear left, then right), and each corner's steering (front left, rear left, front right, rear right). */
  spin: Float64Array;
  steer: Float64Array;
  /** The mast's head: its turn from straight ahead and its nod (down +). */
  mastYaw: number;
  mastPitch: number;
  /** Waiting for someone to get out of its way; parked at the start line. */
  waiting: boolean;
  parked: boolean;
  /** Seconds until it looks somewhere else, and where it looks now (from straight ahead). */
  lookTimer: number;
  lookYaw: number;
}

export function roverState(): RoverState {
  const state: RoverState = { s: 0, v: 0, pose: roverPose(), spin: new Float64Array(WHEELS), steer: new Float64Array(4), mastYaw: 0, mastPitch: 0.2, waiting: false, parked: true, lookTimer: 0, lookYaw: 0 };
  restRover(state);
  return state;
}

const here: RouteSample = routeSample();
const ahead: RouteSample = routeSample();
const wheelGround = (x: number, y: number): number => courseHeight(x, y, true);

/** Each corner wheel's place from the middle axle (forward, left): front left, rear left, front right, rear right. */
const cornerPlace = (geo: RoverGeometry, i: number, out: [number, number]): [number, number] => {
  const front = i % 2 === 0;
  const sign = i < 2 ? 1 : -1;
  const midX = geo.pivot[0] + geo.bogie[0] + geo.mid[0];
  out[0] = (front ? geo.pivot[0] + geo.bogie[0] + geo.front[0] : geo.pivot[0] + geo.rear[0]) - midX;
  out[1] = sign * geo.track[front ? 0 : 2];
  return out;
};
const place: [number, number] = [0, 0];

/** At the start line, parked: wheels straight, mast level. (Its tidy pose, and where it is under reduced motion.) */
export function restRover(state: RoverState, geo: RoverGeometry = ROVER): void {
  state.s = Math.ceil(state.s / COURSE_ROUTE.length - 1e-9) * COURSE_ROUTE.length;
  state.v = 0;
  state.steer.fill(0);
  state.mastYaw = 0;
  state.mastPitch = 0.2;
  state.waiting = false;
  state.parked = true;
  sample(COURSE_ROUTE, state.s, here);
  settle(geo, wheelGround, here.x, here.y, here.heading, state.pose);
}

/** True where the track just ahead crosses an obstacle (the rover slows to a crawl for it). */
function obstacleNear(x: number, y: number): boolean {
  for (let i = 0; i < OBSTACLES.length; i++) {
    const o = OBSTACLES[i]!;
    const reach = REACH[i]! + 1.9;
    const cx = o.kind === "ramp" ? o.x + (Math.cos(o.heading) * o.profile[o.profile.length - 1]![0]) / 2 : o.x;
    const cy = o.kind === "ramp" ? o.y + (Math.sin(o.heading) * o.profile[o.profile.length - 1]![0]) / 2 : o.y;
    const r = o.kind === "ramp" ? o.profile[o.profile.length - 1]![0] / 2 + 2.2 : reach;
    if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) return true;
  }
  return false;
}

/**
 * Drives the rover on by `dt` seconds. `park`: its course is wanted for something else, so it finishes its lap
 * and stops at the start line. (`whoX`, `whoY`): someone on foot; it stops rather than drive into them, and waits.
 */
export function stepRover(state: RoverState, dt: number, park: boolean, whoX: number, whoY: number, t: number, geo: RoverGeometry = ROVER): void {
  const length = COURSE_ROUTE.length;
  sample(COURSE_ROUTE, state.s, here);
  // Someone in the way: by the rover, or on its track just ahead.
  let blocked = (whoX - here.x) ** 2 + (whoY - here.y) ** 2 < ROVER_KEEP_CLEAR ** 2;
  for (let d = 1.5; !blocked && d <= ROVER_LOOK_AHEAD; d += 1.5) {
    sample(COURSE_ROUTE, state.s + d, ahead);
    blocked = (whoX - ahead.x) ** 2 + (whoY - ahead.y) ** 2 < ROVER_KEEP_CLEAR ** 2;
  }
  state.waiting = blocked;
  // Where it must stop, if it's parking: the next time round to the start line.
  const home = Math.ceil(state.s / length - 1e-9) * length;
  if (!park) state.parked = false;
  let want = blocked || state.parked ? 0 : obstacleNear(here.x, here.y) ? ROVER_CRAWL : ROVER_SPEED;
  if (park && !state.parked) want = Math.min(want, Math.sqrt(2 * ROVER_ACCEL * 0.6 * Math.max(0, home - state.s)) + 0.02);
  const dv = want - state.v;
  state.v += Math.sign(dv) * Math.min(Math.abs(dv), ROVER_ACCEL * (blocked ? 2 : 1) * dt);
  let step = state.v * dt;
  if (park && !state.parked && state.s + step >= home - 1e-4) {
    step = home - state.s;
    state.v = 0;
    state.parked = true;
  }
  state.s += step;
  sample(COURSE_ROUTE, state.s, here);
  settle(geo, wheelGround, here.x, here.y, here.heading, state.pose);
  // Wheels roll as far as each one's own path, and the corners steer for the track's curve (eased: servos take a moment).
  const k = here.curvature;
  const midX = geo.pivot[0] + geo.bogie[0] + geo.mid[0];
  for (let w = 0; w < WHEELS; w++) {
    const sign = w < 3 ? 1 : -1;
    const which = w % 3;
    const forward = (which === 0 ? geo.pivot[0] + geo.bogie[0] + geo.front[0] : which === 1 ? midX : geo.pivot[0] + geo.rear[0]) - midX;
    state.spin[w] = (state.spin[w]! + (step * rollFor(k, forward, sign * geo.track[which]!)) / geo.wheelRadius) % (Math.PI * 2);
  }
  const ease = 1 - Math.exp(-dt * 5);
  for (let c = 0; c < 4; c++) {
    cornerPlace(geo, c, place);
    state.steer[c] = state.steer[c]! + (steerFor(k, place[0], place[1]) - state.steer[c]!) * ease;
  }
  // The mast: watches whoever is near, otherwise looks about, a new way every few seconds; nods down at obstacles.
  const near = (whoX - here.x) ** 2 + (whoY - here.y) ** 2 < 14 * 14;
  if (near) state.lookYaw = wrap(Math.atan2(whoY - here.y, whoX - here.x) - here.heading);
  else if ((state.lookTimer -= dt) <= 0) {
    state.lookTimer = 2.5 + 3 * frac(Math.sin(t * 12.9898 + state.s) * 43758.5453);
    state.lookYaw = (frac(Math.sin(t * 78.233 + state.s * 3.1) * 12543.123) - 0.5) * 2.6;
  }
  const turn = wrap(state.lookYaw - state.mastYaw);
  state.mastYaw += Math.sign(turn) * Math.min(Math.abs(turn), 1.4 * dt);
  const nod = near ? 0.05 : state.v > 0.05 && state.v < ROVER_CRAWL + 0.05 ? 0.5 : 0.18;
  state.mastPitch += (nod - state.mastPitch) * (1 - Math.exp(-dt * 2.5));
}

const frac = (v: number): number => v - Math.floor(v);
const wrap = (a: number): number => {
  let d = a % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
};
