import { DRONE_GATES, DRONE_PAD, LAUNCH_SLAB } from "./field-plan.ts";

/*
 * The survey quadcopter: it lifts off its pad, flies its gates, climbs and flies
 * a survey over the launch pad in lawnmower lines, comes home, lands and charges,
 * then goes again. With the launch pad taken it leaves the survey out and keeps
 * to its gates.
 *
 * It flies as a quadcopter must: it can only push along its own up axis, so to
 * speed up, slow down or turn it tilts, by as much as the acceleration (and the
 * air's drag) asks. Here a velocity controller chases each waypoint with limited
 * acceleration, and the tilt is read off that acceleration. World metres, x east,
 * y north, z above the proving ground's level. Pure.
 */

const G = 9.81;

export interface Waypoint {
  x: number;
  y: number;
  z: number;
  /** The speed to fly towards it at (m/s). */
  speed: number;
  /** Come to rest there (a hover point), rather than fly through. */
  stop?: boolean;
  /** How near counts as reached (metres). */
  near: number;
  /** A gate's centre (its index in DRONE_GATES), for the tests. */
  gate?: number;
}

/** The quad's feet stand this high on its pad (the pad's top). */
export const PAD_TOP = 0.14;
/** It hovers this high over its pad before setting down and after lifting off. */
const HOVER = 2.6;
/** The survey's height, and its lines over the launch pad's slab (north to south). */
export const SURVEY_HEIGHT = 13;
const SURVEY_LINES = [12, 4, -4, -12];
const SURVEY_HALF = 14;

const gateLeg = (i: number): Waypoint[] => {
  const g = DRONE_GATES[i]!;
  const cos = Math.cos(g.heading);
  const sin = Math.sin(g.heading);
  return [
    { x: g.x - cos * 4.5, y: g.y - sin * 4.5, z: g.z, speed: 5.5, near: 1.1 },
    { x: g.x, y: g.y, z: g.z, speed: 5, near: 0.55, gate: i },
    { x: g.x + cos * 4, y: g.y + sin * 4, z: g.z, speed: 5.5, near: 1.2 },
  ];
};

const GATES: Waypoint[] = DRONE_GATES.flatMap((_, i) => gateLeg(i));
const SURVEY: Waypoint[] = SURVEY_LINES.flatMap((dy, i): Waypoint[] => {
  const west = { x: LAUNCH_SLAB.x - SURVEY_HALF, y: LAUNCH_SLAB.y + dy, z: SURVEY_HEIGHT, speed: 6.5, near: 1.4 };
  const east = { x: LAUNCH_SLAB.x + SURVEY_HALF, y: LAUNCH_SLAB.y + dy, z: SURVEY_HEIGHT, speed: 6.5, near: 1.4 };
  return i % 2 === 0 ? [west, east] : [east, west];
});
const LIFT: Waypoint = { x: DRONE_PAD.x, y: DRONE_PAD.y, z: HOVER, speed: 2.2, stop: true, near: 0.25 };
const HOME: Waypoint[] = [
  { x: DRONE_PAD.x, y: DRONE_PAD.y, z: HOVER + 1.2, speed: 6, stop: true, near: 0.5 },
  { x: DRONE_PAD.x, y: DRONE_PAD.y, z: HOVER * 0.4, speed: 1.6, stop: true, near: 0.2 },
  { x: DRONE_PAD.x, y: DRONE_PAD.y, z: PAD_TOP, speed: 0.7, stop: true, near: 0.03 },
];

/** A sortie's waypoints: with the survey over the launch pad, or (the pad taken) the gates twice round. */
export const MISSIONS = {
  survey: [LIFT, ...GATES, ...SURVEY, ...HOME],
  gates: [LIFT, ...GATES, ...GATES, ...HOME],
} as const satisfies Record<string, readonly Waypoint[]>;

export type QuadMode = "charging" | "spooling" | "flying" | "landed";

export interface Quad {
  mode: QuadMode;
  /** Seconds left charging, spooling up or winding down. */
  timer: number;
  /** The sortie it's flying and how far through. */
  mission: readonly Waypoint[];
  index: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** The way its nose points (atan2), and its tilt: how far its up axis leans east and north (their tangents). */
  yaw: number;
  tiltX: number;
  tiltY: number;
  /** The rotors: 0 stopped to 1 flying; and their turn (radians). */
  rotors: number;
  rotorAngle: number;
  /** Gates flown through this sortie. */
  gates: number;
}

export function quad(): Quad {
  return { mode: "charging", timer: 6, mission: MISSIONS.survey, index: 0, x: DRONE_PAD.x, y: DRONE_PAD.y, z: PAD_TOP, vx: 0, vy: 0, vz: 0, yaw: Math.PI / 2, tiltX: 0, tiltY: 0, rotors: 0, rotorAngle: 0.4, gates: 0 };
}

/** On its pad, rotors still. */
export function restQuad(q: Quad): void {
  const angle = q.rotorAngle;
  Object.assign(q, quad());
  q.rotorAngle = angle;
}

/** The most it accelerates sideways and up or down (m/s²), how quickly it answers (seconds), and the air's drag (1/s). */
const ACCEL = 5.2;
const ACCEL_Z = 3.2;
const RESPONSE = 0.55;
const DRAG = 0.16;
const CHARGE_S = 16;

const wrap = (a: number): number => {
  let d = a % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
};

/** Flies the quad on by `dt` seconds. `keepOff`: the launch pad is taken, so no survey over it. */
export function stepQuad(q: Quad, dt: number, keepOff: boolean): void {
  let lift = 0;
  if (q.mode === "charging") {
    q.timer -= dt;
    if (q.timer <= 0) {
      q.mode = "spooling";
      q.timer = 1.4;
      q.mission = keepOff ? MISSIONS.gates : MISSIONS.survey;
      q.index = 0;
      q.gates = 0;
    }
  } else if (q.mode === "spooling") {
    lift = 1;
    q.timer -= dt;
    if (q.timer <= 0) q.mode = "flying";
  } else if (q.mode === "landed") {
    q.timer -= dt;
    if (q.timer <= 0) {
      q.mode = "charging";
      q.timer = CHARGE_S;
    }
  }
  let ax = 0;
  let ay = 0;
  if (q.mode === "flying") {
    lift = 1;
    // Told to keep off the launch pad mid-survey: straight home.
    if (keepOff && q.mission === MISSIONS.survey && q.index > GATES.length && q.index < q.mission.length - HOME.length) q.index = q.mission.length - HOME.length;
    const wp = q.mission[q.index]!;
    const dx = wp.x - q.x;
    const dy = wp.y - q.y;
    const dz = wp.z - q.z;
    const dist = Math.hypot(dx, dy, dz);
    const last = q.index === q.mission.length - 1;
    if (dist < wp.near && (!wp.stop || Math.hypot(q.vx, q.vy, q.vz) < 0.5)) {
      if (wp.gate !== undefined) q.gates++;
      if (last) {
        // Down: set squarely on the pad, rotors winding down.
        q.mode = "landed";
        q.timer = 1.6;
        q.x = wp.x;
        q.y = wp.y;
        q.z = wp.z;
        q.vx = q.vy = q.vz = 0;
      } else q.index++;
    }
    if (q.mode === "flying") {
      // Towards the waypoint at its speed; to a hover point, no faster than it can stop from.
      const speed = wp.stop ? Math.min(wp.speed, Math.sqrt(2 * ACCEL_Z * 0.45 * dist) + 0.05) : wp.speed;
      const k = dist > 1e-6 ? speed / dist : 0;
      ax = (dx * k - q.vx) / RESPONSE;
      ay = (dy * k - q.vy) / RESPONSE;
      let az = (dz * k - q.vz) / RESPONSE;
      const side = Math.hypot(ax, ay);
      if (side > ACCEL) {
        ax *= ACCEL / side;
        ay *= ACCEL / side;
      }
      az = Math.max(-ACCEL_Z, Math.min(ACCEL_Z, az));
      q.vx += ax * dt;
      q.vy += ay * dt;
      q.vz += az * dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.z = Math.max(PAD_TOP, q.z + q.vz * dt);
      // Nose to where it's going, once it's going anywhere.
      const ground = Math.hypot(q.vx, q.vy);
      if (ground > 1.2) {
        const turn = wrap(Math.atan2(q.vy, q.vx) - q.yaw);
        q.yaw = wrap(q.yaw + Math.sign(turn) * Math.min(Math.abs(turn), 3.2 * dt));
      }
    }
  }
  // It leans the way it's pushing: the acceleration asked for, and the drag it flies against.
  const flying = q.mode === "flying";
  const lean = 1 - Math.exp(-dt / 0.14);
  q.tiltX += ((flying ? (ax + DRAG * q.vx * Math.abs(q.vx) * 0.35) / G : 0) - q.tiltX) * lean;
  q.tiltY += ((flying ? (ay + DRAG * q.vy * Math.abs(q.vy) * 0.35) / G : 0) - q.tiltY) * lean;
  q.rotors += (lift - q.rotors) * (1 - Math.exp(-dt / 0.45));
  if (lift === 0 && q.rotors < 0.004) q.rotors = 0;
  q.rotorAngle = (q.rotorAngle + q.rotors * 38 * dt) % (Math.PI * 2);
}
