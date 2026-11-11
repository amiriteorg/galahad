import { HOLD_SHORT, RUNWAY, TIE_DOWN } from "./field-plan.ts";
import { type Route, route, type RouteSample, routeSample, sample } from "./field-route.ts";

/*
 * The resident aircraft's flying: circuits from the runway, as a short-take-off
 * bush plane would fly them. It starts up at its tie-down, taxis to the holding
 * point and runs up, enters the runway and backtracks to the threshold, turns
 * round, takes off into the wind, climbs out, turns crosswind and downwind
 * (always to the west, over the lake and away from the keep), descends round
 * the base turn onto final, flares and touches down; twice it goes straight
 * round again, the third time it stops, turns off onto the taxiway and taxis
 * back to its tie-down. With the flight pad taken it lands, parks and shuts down.
 *
 * Kinematic, but shaped like flying: it follows lines and arcs (field-route.ts),
 * so its heading is always its track's tangent; its height is a smooth function
 * of the distance flown, so its pitch follows its flight path; it banks by its
 * speed and its turn's radius (tan φ = v² / g r); and its speed changes only as
 * fast as an engine or brakes could change it. World metres, x east, y north,
 * z above the proving ground's level. Pure.
 */

const G = 9.81;
const RX = RUNWAY.x;
const RY = RUNWAY.y;

/** The circuit's turns (metres): about 37° of bank at 21 m/s. */
export const TURN_RADIUS = 60;
/** How far past the runway's middle the crosswind turn's corner lies, and how far before it the base turn's (metres along the runway). */
const UPWIND = 140;
const DOWNWIND = 235;
/** Lined up, it stands this far before the runway's middle; it touches down here; it lifts off here. */
const LINE_UP = 63;
const TOUCH_DOWN = 50;
const LIFT_OFF = 8;
/** The circuit's height above the ground. */
export const CIRCUIT_HEIGHT = 32;
/** Climb and approach gradients (rise over run). */
const CLIMB = 0.17;
const GLIDE = 0.105;
/** Speeds, m/s. */
export const SPEED = { taxi: 5, backtrack: 7.5, rotate: 13.5, climb: 19, cruise: 21.5, approach: 17, final: 16, touchdown: 14 };
const TAXI_ACCEL = 1.3;
const TAKEOFF_ACCEL = 2.7;
const BRAKING = 2.9;
/** Landings in a sortie: touch-and-goes, then one to a full stop. */
export const LANDINGS = 3;
/** It gives way to someone on foot within this of its path ahead while taxiing (metres), looking this far ahead. */
export const TAXI_KEEP_CLEAR = 7;
const TAXI_LOOK_AHEAD = 14;

export type Direction = 1 | -1;

/** The way to take off for a wind blowing towards `windHeading`: into it (north +1: runway 36; south −1: runway 18). */
export function runwayFor(windHeading: number, last: Direction = -1): Direction {
  const north = Math.sin(windHeading);
  // A wind straight across favours neither end: stay with the runway in use.
  if (Math.abs(north) < 0.08) return last;
  return north > 0 ? -1 : 1;
}

export interface Routes {
  /** From the holding point onto the runway, back along it to the threshold, round, and lined up. */
  lineUp: Route;
  /** The circuit: from lined up, down the runway, round the pattern and back to the same point. */
  circuit: Route;
  /** From the runway (short of its middle) onto the taxiway, across the apron and round to the tie-down. */
  exit: Route;
}

/** The circuit seen from above, for one direction of take-off. */
function routesFor(d: Direction): Routes {
  const along = (u: number): number => RY + d * u;
  return {
    lineUp: route(
      [HOLD_SHORT, { x: RX + 6, y: RY }, { x: RX + 6, y: along(-LINE_UP - 4) }, { x: RX, y: along(-LINE_UP - 4) }, { x: RX, y: along(-LINE_UP) }],
      [0, 5, 3, 3, 0],
    ),
    circuit: route(
      [
        { x: RX, y: along(-LINE_UP) },
        { x: RX, y: along(UPWIND) },
        { x: RX - 2 * TURN_RADIUS, y: along(UPWIND) },
        { x: RX - 2 * TURN_RADIUS, y: along(-DOWNWIND) },
        { x: RX, y: along(-DOWNWIND) },
      ],
      TURN_RADIUS,
      true,
    ),
    exit: route([{ x: RX, y: along(-EXIT_BEFORE) }, { x: RX, y: RY }, { x: -78, y: RY }, { x: -78, y: TIE_DOWN.y }, TIE_DOWN], [0, 8, 6, 6, 0]),
  };
}

/** It leaves the circuit for the taxiway this far before the runway's middle (the turn-off's arc begins after it). */
const EXIT_BEFORE = 14;

export const ROUTES: Record<"north" | "south", Routes> = { north: routesFor(1), south: routesFor(-1) };
export const routesOf = (d: Direction): Routes => (d === 1 ? ROUTES.north : ROUTES.south);

/** From the tie-down, round past the hangar's door and along the taxiway to the holding point. */
export const TAXI_OUT: Route = route([TIE_DOWN, { x: -93, y: TIE_DOWN.y }, { x: -93, y: RY }, HOLD_SHORT], [0, 6, 6, 0]);

/** Distances round the circuit (from lined up): where it touches down, lifts off and leaves for the taxiway. */
const S_TOUCH = LINE_UP - TOUCH_DOWN;
const S_LIFT = LINE_UP - LIFT_OFF;
const S_EXIT = LINE_UP - EXIT_BEFORE;

/**
 * A height that eases from level into a steady gradient and out of it again: the slope grows from 0 to `gradient`
 * over `easeIn` metres, holds, and falls back to 0 over `easeOut`, having risen `rise` in all. Returns the height
 * `x` metres along (0 before it, `rise` after it) and writes the slope there into `slopeOut[0]`.
 */
function ramp(x: number, rise: number, gradient: number, easeIn: number, easeOut: number, slopeOut: Float64Array): number {
  const steady = (rise - (gradient * (easeIn + easeOut)) / 2) / gradient;
  if (x <= 0) {
    slopeOut[0] = 0;
    return 0;
  }
  if (x < easeIn) {
    slopeOut[0] = (gradient * x) / easeIn;
    return (gradient * x * x) / (2 * easeIn);
  }
  const h1 = (gradient * easeIn) / 2;
  if (x < easeIn + steady) {
    slopeOut[0] = gradient;
    return h1 + gradient * (x - easeIn);
  }
  const h2 = h1 + gradient * steady;
  const u = x - easeIn - steady;
  if (u < easeOut) {
    slopeOut[0] = gradient * (1 - u / easeOut);
    return h2 + gradient * u * (1 - u / (2 * easeOut));
  }
  slopeOut[0] = 0;
  return rise;
}

/** How long each takes, metres along the track: the climb from lift-off to circuit height, and the descent from it to touchdown. */
const CLIMB_EASE: [number, number] = [14, 60];
const GLIDE_EASE: [number, number] = [26, 50];
const rampLength = (rise: number, gradient: number, ease: [number, number]): number => (rise - (gradient * (ease[0] + ease[1])) / 2) / gradient + ease[0] + ease[1];
export const CLIMB_LENGTH = rampLength(CIRCUIT_HEIGHT, CLIMB, CLIMB_EASE);
export const GLIDE_LENGTH = rampLength(CIRCUIT_HEIGHT, GLIDE, GLIDE_EASE);

const slope = new Float64Array(1);

/**
 * The wheels' height above the runway at distance `s` flown round the circuit since lining up (it grows lap after
 * lap), for a circuit `length` long; the flight path's slope (rise over run) is written into `slopeOut[0]`.
 * `stopping`: this landing is to a full stop (it stays down after touching down).
 */
export function circuitHeight(s: number, length: number, stopping: boolean, slopeOut: Float64Array = slope): number {
  const lap = Math.floor(s / length);
  const q = s - lap * length;
  // Round out of the last lap's approach: the flare's end, to the touchdown point.
  if (lap > 0 && q < S_TOUCH) {
    const h = ramp(S_TOUCH - q, CIRCUIT_HEIGHT, GLIDE, GLIDE_EASE[0], GLIDE_EASE[1], slopeOut);
    slopeOut[0] = -slopeOut[0]!;
    return h;
  }
  if (q < S_LIFT || (stopping && lap > 0)) {
    slopeOut[0] = 0;
    return 0;
  }
  const down = length + S_TOUCH - q;
  if (down < GLIDE_LENGTH) {
    const h = ramp(down, CIRCUIT_HEIGHT, GLIDE, GLIDE_EASE[0], GLIDE_EASE[1], slopeOut);
    slopeOut[0] = -slopeOut[0]!;
    return h;
  }
  return ramp(q - S_LIFT, CIRCUIT_HEIGHT, CLIMB, CLIMB_EASE[0], CLIMB_EASE[1], slopeOut);
}

export type Phase =
  /** At the tie-down, engine off. */
  | "parked"
  /** At the tie-down, engine running (starting up, or a pause between sorties). */
  | "idle"
  | "taxi-out"
  /** At the holding point: the run-up. */
  | "hold"
  | "line-up"
  /** Lined up: power coming on. */
  | "ready"
  /** Round the circuit: rolling, flying, touching down. */
  | "circuit"
  /** Off the runway and back to the tie-down. */
  | "taxi-in";

export interface Aircraft {
  phase: Phase;
  /** The way it takes off (north +1). */
  direction: Direction;
  /** Distance along the phase's route, and speed along it (m/s). */
  s: number;
  v: number;
  /** Seconds left in a phase that waits. */
  timer: number;
  /** Landings made this sortie, and whether the coming one is to a full stop. */
  landings: number;
  stopping: boolean;
  /** The main wheels' contact point (world; z above the runway), heading (atan2), pitch (nose up +) and bank (left wing down +, i.e. into a left turn). */
  x: number;
  y: number;
  z: number;
  heading: number;
  pitch: number;
  bank: number;
  /** The flight path's slope (rise over run) and the track's curvature (1/m, left +) where it is. */
  slope: number;
  curvature: number;
  /** Wheels on the ground. */
  grounded: boolean;
  /** The engine: 0 stopped to 1 full power; and the propeller's turn (radians). */
  power: number;
  prop: number;
  /** The wheels' turn about their axles (radians) and the nose wheel's steering (left +). */
  wheels: number;
  steer: number;
  /** Controls, each −1..1 (flaps 0..1): elevator (nose up +), ailerons (rolling left +), rudder (nose left +). */
  flaps: number;
  elevator: number;
  aileron: number;
  rudder: number;
  /** Giving way to someone on the taxiway. */
  waiting: boolean;
}

/** Parked at the tie-down, cold: where it begins, where it rests under reduced motion. */
export function aircraft(): Aircraft {
  const a: Aircraft = {
    phase: "parked",
    direction: -1,
    s: 0,
    v: 0,
    timer: 0,
    landings: 0,
    stopping: false,
    x: TIE_DOWN.x,
    y: TIE_DOWN.y,
    z: 0,
    heading: TIE_DOWN.heading,
    pitch: 0,
    bank: 0,
    slope: 0,
    curvature: 0,
    grounded: true,
    power: 0,
    prop: 0.6,
    wheels: 0,
    steer: 0,
    flaps: 0,
    elevator: 0,
    aileron: 0,
    rudder: 0,
    waiting: false,
  };
  return a;
}

/** Back to the tie-down, engine off, controls neutral (the propeller stays where it stopped). */
export function restAircraft(a: Aircraft): void {
  const prop = a.prop;
  Object.assign(a, aircraft());
  a.prop = prop;
}

const at: RouteSample = routeSample();
const look: RouteSample = routeSample();
const TAU = Math.PI * 2;

/** The angle the wing meets the air at (radians), for a speed and a load: slow flight is nose-high. */
const attack = (v: number, load: number): number => (1 + 7.5 * load * (SPEED.touchdown / Math.max(SPEED.touchdown * 0.8, v)) ** 2) * (Math.PI / 180);

const approachTo = (value: number, target: number, rate: number, dt: number): number => value + Math.sign(target - value) * Math.min(Math.abs(target - value), rate * dt);
const ease = (value: number, target: number, tau: number, dt: number): number => value + (target - value) * (1 - Math.exp(-dt / tau));

/** Someone on foot within the taxiing aircraft's way: near it, or near its path just ahead. */
function inTheWay(rt: Route, s: number, x: number, y: number, whoX: number, whoY: number): boolean {
  if ((whoX - x) ** 2 + (whoY - y) ** 2 < TAXI_KEEP_CLEAR ** 2) return true;
  for (let d = 4; d <= TAXI_LOOK_AHEAD; d += 5) {
    sample(rt, Math.min(rt.length, s + d), look);
    if ((whoX - look.x) ** 2 + (whoY - look.y) ** 2 < TAXI_KEEP_CLEAR ** 2) return true;
  }
  return false;
}

/** Rolls along a taxi route towards its end at up to `speed`, braking for the end and for anyone in the way; true once stopped there. */
function taxi(a: Aircraft, rt: Route, speed: number, dt: number, whoX: number, whoY: number, stopAtEnd = true): boolean {
  sample(rt, a.s, at);
  a.waiting = inTheWay(rt, a.s, at.x, at.y, whoX, whoY);
  const left = rt.length - a.s;
  // Slower round the tight turns (the nose wheel can only steer so far), and no faster than it can stop from.
  let want = a.waiting ? 0 : Math.abs(at.curvature) > 0.12 ? Math.min(speed, 3) : speed;
  if (stopAtEnd) want = Math.min(want, Math.sqrt(2 * TAXI_ACCEL * Math.max(0, left)) + 0.05);
  a.v = approachTo(a.v, want, a.waiting ? BRAKING : TAXI_ACCEL, dt);
  const step = Math.min(left, a.v * dt);
  a.s += step;
  a.wheels = (a.wheels + step / WHEEL_RADIUS) % TAU;
  sample(rt, a.s, at);
  place(a, at, dt);
  if (left - step < 1e-3) {
    if (stopAtEnd) a.v = 0;
    return true;
  }
  return false;
}

/** The main wheels' radius, and the distance from them forward to the nose wheel (metres). */
export const WHEEL_RADIUS = 0.3;
export const WHEEL_BASE = 1.75;

/** On the ground at a point of a route: level, wings level, the nose wheel steering for the turn. */
function place(a: Aircraft, p: RouteSample, dt: number): void {
  a.x = p.x;
  a.y = p.y;
  a.z = 0;
  a.heading = p.heading;
  a.curvature = p.curvature;
  a.slope = 0;
  a.grounded = true;
  a.pitch = ease(a.pitch, 0, 0.3, dt);
  a.bank = ease(a.bank, 0, 0.3, dt);
  a.steer = ease(a.steer, Math.atan(WHEEL_BASE * p.curvature), 0.15, dt);
  a.rudder = ease(a.rudder, Math.max(-1, Math.min(1, a.steer * 2)), 0.15, dt);
  a.elevator = ease(a.elevator, 0, 0.3, dt);
  a.aileron = ease(a.aileron, 0, 0.3, dt);
  a.flaps = ease(a.flaps, 0, 1.5, dt);
}

/**
 * Flies (and taxis) the aircraft on by `dt` seconds. `park`: the flight pad is wanted, so it lands at the next
 * chance, taxis in and shuts down. `windHeading`: the way the wind blows towards. (`whoX`, `whoY`): someone on
 * foot, whom it gives way to while taxiing.
 */
export function stepAircraft(a: Aircraft, dt: number, park: boolean, windHeading: number, whoX: number, whoY: number): void {
  const routes = routesOf(a.direction);
  let power = a.power;
  switch (a.phase) {
    case "parked":
      power = 0;
      a.v = 0;
      a.waiting = false;
      if (!park) {
        a.phase = "idle";
        a.timer = 4;
      }
      break;
    case "idle":
      // Starting up, or between sorties: the engine ticks over.
      power = 0.22;
      a.v = 0;
      a.timer -= dt;
      if (park) a.phase = "parked";
      else if (a.timer <= 0) {
        a.phase = "taxi-out";
        a.s = 0;
      }
      break;
    case "taxi-out":
      power = 0.3;
      if (taxi(a, TAXI_OUT, SPEED.taxi, dt, whoX, whoY)) {
        a.phase = "hold";
        a.timer = 7;
        a.direction = runwayFor(windHeading, a.direction);
      }
      break;
    case "hold": {
      // The run-up: power up and back while it stands on its brakes, then a look at the wind.
      a.timer -= dt;
      a.v = 0;
      const u = 7 - a.timer;
      power = u > 1.5 && u < 5 ? 0.7 : 0.25;
      a.elevator = ease(a.elevator, u > 2.2 && u < 3.4 ? 0.8 : 0, 0.2, dt);
      a.aileron = ease(a.aileron, u > 3.4 && u < 4.2 ? 0.8 : u >= 4.2 && u < 5 ? -0.8 : 0, 0.2, dt);
      if (a.timer <= 0) {
        a.direction = runwayFor(windHeading, a.direction);
        a.phase = "line-up";
        a.s = 0;
      }
      break;
    }
    case "line-up": {
      power = 0.32;
      // Briskly back along the runway, slowly round at its end.
      sample(routes.lineUp, a.s, at);
      const backtracking = at.curvature === 0 && a.s > 12 && routes.lineUp.length - a.s > 14;
      if (taxi(a, routes.lineUp, backtracking ? SPEED.backtrack : SPEED.taxi, dt, whoX, whoY)) {
        a.phase = "ready";
        a.timer = 2.5;
      }
      break;
    }
    case "ready":
      a.timer -= dt;
      a.v = 0;
      power = a.timer < 1.2 ? 1 : 0.3;
      a.flaps = ease(a.flaps, 0.4, 0.6, dt);
      if (a.timer <= 0) {
        a.phase = "circuit";
        a.s = 0;
        a.landings = 0;
        a.stopping = park || LANDINGS <= 1;
      }
      break;
    case "circuit":
      power = fly(a, routes.circuit, dt, park);
      break;
    case "taxi-in":
      power = 0.28;
      if (taxi(a, routes.exit, SPEED.taxi, dt, whoX, whoY)) {
        a.phase = park ? "parked" : "idle";
        a.timer = 9;
      }
      break;
  }
  // The engine answers in its own time; the propeller turns with it (and runs down when it's cut).
  a.power = ease(a.power, power, power < a.power ? 0.9 : 0.6, dt);
  if (a.power < 0.004 && power === 0) a.power = 0;
  a.prop = (a.prop + (a.power > 0 ? 9 + 34 * a.power : 0) * Math.min(1, a.power * 12) * dt) % TAU;
}

/** Round the circuit by `dt`: the take-off roll, the flight, the touchdown; a touch-and-go carries on, a full stop leaves for the taxiway. Returns the power wanted. */
function fly(a: Aircraft, circuit: Route, dt: number, park: boolean): number {
  const length = circuit.length;
  const lap = Math.floor(a.s / length);
  const q = a.s - lap * length;
  const toTouchdown = lap > 0 && q < S_TOUCH ? S_TOUCH - q : length + S_TOUCH - q;
  const rolling = a.z <= 0 && (lap === 0 ? q < S_LIFT : q >= S_TOUCH && (a.stopping || q < S_LIFT));
  let power: number;
  let target: number;
  let accel: number;
  if (rolling && lap > 0 && a.stopping) {
    // Down and stopping: brakes on, to a taxiing pace by the turn-off.
    power = 0.2;
    target = SPEED.taxi;
    accel = BRAKING;
  } else if (rolling && lap > 0 && q < S_TOUCH + 9) {
    // A touch-and-go: the wheels run on a moment before the power comes back.
    power = 0.35;
    target = SPEED.touchdown - 1.5;
    accel = 1.2;
  } else if (rolling) {
    power = 1;
    target = SPEED.climb;
    accel = TAKEOFF_ACCEL;
  } else if (toTouchdown < GLIDE_LENGTH + 40) {
    // Slowing for the approach, then for the fence, then the flare.
    power = toTouchdown < 30 ? 0.25 : 0.45;
    target = toTouchdown < 34 ? SPEED.touchdown : toTouchdown < 150 ? SPEED.final : SPEED.approach;
    accel = 1.1;
  } else if (q - S_LIFT < CLIMB_LENGTH * 0.85) {
    power = 1;
    target = SPEED.climb;
    accel = 1.4;
  } else {
    power = 0.78;
    target = SPEED.cruise;
    accel = 1;
  }
  a.v = approachTo(a.v, target, accel, dt);
  const step = a.v * dt;
  const before = a.s;
  a.s += step;
  // Touching down: one more landing made; decide what the next one is to be.
  const touch = Math.floor((before - S_TOUCH) / length) !== Math.floor((a.s - S_TOUCH) / length) && a.s >= length;
  if (touch) {
    a.landings++;
    if (park || a.landings >= LANDINGS) a.stopping = true;
  }
  const z = circuitHeight(a.s, length, a.stopping, slope);
  sample(circuit, a.s, at);
  a.x = at.x;
  a.y = at.y;
  a.z = z;
  a.heading = at.heading;
  a.curvature = at.curvature;
  a.slope = slope[0]!;
  a.grounded = z <= 0;
  a.waiting = false;
  const nowQ = a.s - Math.floor(a.s / length) * length;
  if (a.grounded) {
    a.wheels = (a.wheels + step / WHEEL_RADIUS) % TAU;
    // Rotating: the nose comes up as flying speed arrives, the main wheels still on the runway.
    const lifting = !a.stopping || lap === 0;
    const rotate = lifting && nowQ > S_LIFT - 12 && a.v > SPEED.rotate - 1.5 ? attack(a.v, 1) * Math.min(1, (nowQ - (S_LIFT - 12)) / 10) : 0;
    const pitchBefore = a.pitch;
    a.pitch = ease(a.pitch, rotate, rotate > 0 ? 0.3 : 0.55, dt);
    a.elevator = ease(a.elevator, Math.max(-1, Math.min(1, rotate > 0 ? 0.7 : (a.pitch - pitchBefore) / dt)), 0.15, dt);
    a.bank = ease(a.bank, 0, 0.2, dt);
    a.aileron = ease(a.aileron, 0, 0.2, dt);
    a.steer = ease(a.steer, 0, 0.2, dt);
    a.rudder = ease(a.rudder, 0, 0.2, dt);
    a.flaps = ease(a.flaps, a.stopping && lap > 0 ? 0 : 0.4, 1.2, dt);
    // Stopped enough, and at the turn-off: onto the taxiway.
    if (a.stopping && lap > 0 && nowQ >= S_EXIT && a.s >= length) {
      a.phase = "taxi-in";
      a.s = nowQ - S_EXIT;
      a.landings = 0;
    }
    return power;
  }
  // Flying. The bank is the turn's: looked for a moment ahead, and rolled into in its own time.
  sample(circuit, a.s + a.v * 0.45, look);
  const airborne = Math.min(1, z / 2.5);
  const bank = Math.atan((a.v * a.v * look.curvature) / G) * airborne;
  const bankBefore = a.bank;
  a.bank = ease(a.bank, bank, 0.42, dt);
  a.aileron = ease(a.aileron, Math.max(-1, Math.min(1, ((a.bank - bankBefore) / dt) * 1.6)), 0.12, dt);
  a.rudder = ease(a.rudder, Math.max(-1, Math.min(1, a.bank * 0.5)), 0.2, dt);
  const pitch = Math.atan(a.slope) + attack(a.v, 1 / Math.max(0.6, Math.cos(a.bank)));
  const pitchBefore = a.pitch;
  a.pitch = ease(a.pitch, pitch, 0.28, dt);
  a.elevator = ease(a.elevator, Math.max(-1, Math.min(1, ((a.pitch - pitchBefore) / dt) * 5 + (toTouchdown < 30 ? 0.35 : 0))), 0.15, dt);
  a.steer = ease(a.steer, 0, 0.2, dt);
  a.flaps = ease(a.flaps, toTouchdown < GLIDE_LENGTH - 40 ? 1 : q - S_LIFT < 90 ? 0.4 : 0, 1.4, dt);
  return power;
}

/** True while it's on the ground and in the way of someone on foot (a parked or airborne aircraft isn't moving at them). */
export const onTheGround = (a: Aircraft): boolean => a.grounded;
