import { LAUNCHER_PAD, LAUNCHER_PARK } from "./field-plan.ts";
import { type Route, route, type RouteSample, routeSample, sample } from "./field-route.ts";

/*
 * The mobile launcher: a wheeled platform with an erector rail and a small
 * sounding rocket on it. With the launch pad free it stands over the flame
 * trench, its rail upright; when an experiment wants the pad it lowers the
 * rail, drives off to its parking place beside the blockhouse, and comes back
 * (and raises the rail again) once the pad is free. Kinematic. World metres,
 * x east, y north. Pure.
 */

/** From the pad (facing north, over the trench) out of the pad's gate and round to the parking place beside the blockhouse. */
export const LAUNCHER_ROUTE: Route = route(
  [
    { x: LAUNCHER_PAD.x, y: LAUNCHER_PAD.y },
    { x: LAUNCHER_PAD.x, y: -75 },
    { x: LAUNCHER_PARK.x, y: -75 },
    { x: LAUNCHER_PARK.x, y: LAUNCHER_PARK.y },
  ],
  [0, 4, 4, 0],
);

/** Its speed (m/s) and how fast the rail swings (rad/s). */
export const LAUNCHER_SPEED = 1.2;
const ACCEL = 0.4;
const ERECT_RATE = 0.12;
/** The rail upright, and lowered onto its rest. */
export const UPRIGHT = Math.PI / 2;
export const LOWERED = 0.06;

export interface Launcher {
  /** Distance along the route from the pad (0) to the parking place (its length), and speed along it. */
  s: number;
  v: number;
  /** The rail's angle up from the platform. */
  erect: number;
  x: number;
  y: number;
  heading: number;
  /** Driving, or swinging its rail. */
  busy: boolean;
}

const at: RouteSample = routeSample();

export function launcher(): Launcher {
  const l: Launcher = { s: 0, v: 0, erect: UPRIGHT, x: LAUNCHER_PAD.x, y: LAUNCHER_PAD.y, heading: Math.PI / 2, busy: false };
  return l;
}

/** Straight to where it belongs, with no driving (reduced motion; the first frame). */
export function placeLauncher(l: Launcher, padFree: boolean): void {
  l.s = padFree ? 0 : LAUNCHER_ROUTE.length;
  l.v = 0;
  l.erect = padFree ? UPRIGHT : LOWERED;
  l.busy = false;
  sample(LAUNCHER_ROUTE, l.s, at);
  l.x = at.x;
  l.y = at.y;
  l.heading = at.heading;
}

/**
 * On by `dt`: with the pad wanted, lower the rail, then drive to the parking place; with it free, drive back,
 * then raise the rail. It only moves with its rail down.
 */
export function stepLauncher(l: Launcher, dt: number, padFree: boolean): void {
  const goal = padFree ? 0 : LAUNCHER_ROUTE.length;
  const there = Math.abs(l.s - goal) < 1e-3 && Math.abs(l.v) < 1e-3;
  if (!there && l.erect > LOWERED + 1e-4) {
    l.erect = Math.max(LOWERED, l.erect - ERECT_RATE * dt);
    l.v = 0;
  } else if (!there) {
    const dir = Math.sign(goal - l.s);
    const left = Math.abs(goal - l.s);
    const want = dir * Math.min(LAUNCHER_SPEED, Math.sqrt(2 * ACCEL * left) + 0.02);
    l.v += Math.sign(want - l.v) * Math.min(Math.abs(want - l.v), ACCEL * dt);
    let next = l.s + l.v * dt;
    if ((goal - next) * dir <= 0) {
      next = goal;
      l.v = 0;
    }
    l.s = next;
  } else if (padFree && l.erect < UPRIGHT) l.erect = Math.min(UPRIGHT, l.erect + ERECT_RATE * dt);
  l.busy = !there || (padFree && l.erect < UPRIGHT);
  sample(LAUNCHER_ROUTE, l.s, at);
  l.x = at.x;
  l.y = at.y;
  l.heading = at.heading;
}
