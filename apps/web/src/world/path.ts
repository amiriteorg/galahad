import type { ExperimentView, GalahadState, Station } from "@galahad/core/world";
import { STATIONS } from "@galahad/core/world";
import { type Ground, moveOnGround } from "./physics.ts";

/** Seconds without getting closer before he's set down at the waypoint. */
const STUCK_S = 3;

/*
 * Where Galahad stands for each kind of work, and how he walks there: straight
 * lines between waypoints, going round the keep and the other buildings rather
 * than through them. World coordinates (metres, x east, y north). Pure, so
 * unit-tested.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Obstacle extends Point {
  r: number;
}

type Place = Exclude<Station, "field">;

/** Each building's footprint (for walking round it) and how far in front of it he stands. */
const LAYOUT: Record<Place, { r: number; stand: number }> = {
  // The giant tree, its deck's posts and the stairs; he stands at the foot of the stairs.
  keep: { r: 7.5, stand: 8.5 },
  council: { r: 1.7, stand: 2.4 },
  library: { r: 3.2, stand: 4.1 },
  watchtower: { r: 2.6, stand: 3.6 },
  treasury: { r: 3, stand: 4 },
  messenger: { r: 2.6, stand: 3.4 },
  // At the lab he stands at the workbench's end, within reach of it.
  forge: { r: 3.1, stand: 3.25 },
  oracle: { r: 0, stand: 1.4 },
  observatory: { r: 2.5, stand: 3.3 },
};

const MARGIN = 1;

export const PLACES = Object.keys(STATIONS) as Place[];

/** The way a station's building faces: towards the keep (the keep itself faces south). Radians, atan2 convention. */
export function stationFacing(place: Place): number {
  const s = STATIONS[place];
  return place === "keep" ? -Math.PI / 2 : Math.atan2(-s.y, -s.x);
}

export interface Target extends Point {
  /** The way he faces once there (atan2 convention: 0 east, π/2 north). */
  facing: number;
}

/** Where he stands at a station: in front of its building, facing it (at the keep, at its door, facing out). */
export function standAt(place: Place): Target {
  const s = STATIONS[place];
  const out = stationFacing(place);
  const d = LAYOUT[place].stand;
  const x = s.x + Math.cos(out) * d;
  const y = s.y + Math.sin(out) * d;
  return { x, y, facing: place === "keep" ? out : out + Math.PI };
}

/** The gate of an experiment's plot: on its edge nearest the keep, just outside the fence, facing in. */
export function plotGate(plot: { x: number; y: number; size: number }): Target {
  const len = Math.hypot(plot.x, plot.y);
  const ux = len > 1e-6 ? -plot.x / len : 0;
  const uy = len > 1e-6 ? -plot.y / len : -1;
  const edge = plot.size / 2 / Math.max(Math.abs(ux), Math.abs(uy));
  const d = edge + 1.6;
  return { x: plot.x + ux * d, y: plot.y + uy * d, facing: Math.atan2(-uy, -ux) };
}

/** Where his state sends him: a station, or the gate of the experiment he's out at (his hall if it isn't known). */
export function targetFor(galahad: GalahadState, experiments: readonly ExperimentView[]): Target {
  if (galahad.station === "field") {
    const e = experiments.find((x) => x.id === galahad.experiment);
    return e ? plotGate(e.plot) : standAt("keep");
  }
  return standAt(galahad.station);
}

/** The buildings, and the fenced plots, he walks round. */
export function obstacles(experiments: readonly ExperimentView[] = []): Obstacle[] {
  const out: Obstacle[] = PLACES.filter((p) => LAYOUT[p].r > 0).map((p) => ({ x: STATIONS[p].x, y: STATIONS[p].y, r: LAYOUT[p].r }));
  for (const e of experiments) out.push({ x: e.plot.x, y: e.plot.y, r: (e.plot.size / 2) * Math.SQRT2 });
  return out;
}

function closestOnSegment(a: Point, b: Point, p: Point): Point & { t: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return { x: a.x + dx * t, y: a.y + dy * t, t };
}

const inside = (o: Obstacle, p: Point, extra = 0): boolean => Math.hypot(p.x - o.x, p.y - o.y) < o.r + extra;

function detours(a: Point, b: Point, obs: readonly Obstacle[], depth: number): Point[] {
  if (depth > 6) return [];
  let hit: { o: Obstacle; t: number; p: Point } | null = null;
  for (const o of obs) {
    // Starting or ending inside a footprint (a teleport, a plot's own gate): nothing to go round.
    if (inside(o, a) || inside(o, b)) continue;
    const p = closestOnSegment(a, b, o);
    // Keep a margin from buildings, except from the one he's just leaving or arriving at, which
    // he only has to not walk through.
    const close = inside(o, a, MARGIN) || inside(o, b, MARGIN);
    if (close && (p.t <= 1e-9 || p.t >= 1 - 1e-9)) continue;
    if (Math.hypot(p.x - o.x, p.y - o.y) < o.r + (close ? 0.05 : MARGIN) && (!hit || p.t < hit.t)) hit = { o, t: p.t, p };
  }
  if (!hit) return [];
  const { o, p } = hit;
  let nx = p.x - o.x;
  let ny = p.y - o.y;
  let n = Math.hypot(nx, ny);
  if (n < 1e-6) {
    // Straight through the middle: go round on the left of the direction of travel.
    nx = -(b.y - a.y);
    ny = b.x - a.x;
    n = Math.hypot(nx, ny) || 1;
  }
  const reach = (o.r + MARGIN) * 1.25;
  const d = { x: o.x + (nx / n) * reach, y: o.y + (ny / n) * reach };
  return [...detours(a, d, obs, depth + 1), d, ...detours(d, b, obs, depth + 1)];
}

/** Waypoints from `from` to `to` (ending at `to`), round whatever stands between. */
export function planPath(from: Point, to: Point, obs: readonly Obstacle[]): Point[] {
  return [...detours(from, to, obs, 0), { x: to.x, y: to.y }];
}

/** The keep's paths (from the foot of its stairs to every station), planned once. */
let keepPaths: Point[][] | null = null;
function paths(): Point[][] {
  if (keepPaths) return keepPaths;
  const from = standAt("keep");
  const obs = obstacles();
  keepPaths = PLACES.filter((p) => p !== "keep").map((p) => [{ x: from.x, y: from.y }, ...planPath(from, standAt(p), obs)]);
  return keepPaths;
}

/** True where the keep has built something: a station's footprint, a path, a place to stand. Nothing grows there. */
export function built(x: number, y: number): boolean {
  if (Math.hypot(x, y) > 70) return false;
  for (const p of PLACES) {
    const s = STATIONS[p];
    const stand = standAt(p);
    if (Math.hypot(x - s.x, y - s.y) < LAYOUT[p].r + 1.5 || Math.hypot(x - stand.x, y - stand.y) < (p === "keep" ? 3.6 : 2.2)) return true;
  }
  for (const line of paths()) {
    for (let i = 1; i < line.length; i++) {
      const q = closestOnSegment(line[i - 1]!, line[i]!, { x, y });
      if (Math.hypot(q.x - x, q.y - y) < 1.3) return true;
    }
  }
  return false;
}

export function pathLength(from: Point, path: readonly Point[]): number {
  let total = 0;
  let prev = from;
  for (const p of path) {
    total += Math.hypot(p.x - prev.x, p.y - prev.y);
    prev = p;
  }
  return total;
}

export const WALK_SPEED = 1.7;
export const RUN_SPEED = 5;
/** Farther than this, he runs. */
export const RUN_BEYOND = 28;
/** However far, he gets there within this many seconds. */
const MAX_TRAVEL_S = 25;

/** His walking pace for the distance left: a walk, a run, or a dash for faraway plots. */
export function paceFor(remaining: number): { speed: number; running: boolean } {
  if (remaining <= RUN_BEYOND) return { speed: WALK_SPEED, running: false };
  return { speed: Math.max(RUN_SPEED, remaining / MAX_TRAVEL_S), running: true };
}

/**
 * Galahad's feet: follows a path at his pace, turning towards where he goes, and
 * towards the work once he arrives. `teleport` (reduced motion) skips the walk.
 */
export class Walker {
  x: number;
  y: number;
  heading: number;
  moving = false;
  running = false;
  private path: Point[] = [];
  private facing: number;
  private pace = WALK_SPEED;
  private readonly scratch = { x: 0, y: 0 };
  private best = Infinity;
  private stuck = 0;

  private resetProgress(): void {
    this.best = Infinity;
    this.stuck = 0;
  }

  constructor(start: Target) {
    this.x = start.x;
    this.y = start.y;
    this.heading = start.facing;
    this.facing = start.facing;
  }

  /** Remaining waypoints (for tests and debugging). */
  get waypoints(): readonly Point[] {
    return this.path;
  }

  go(target: Target, obs: readonly Obstacle[], teleport = false): void {
    this.facing = target.facing;
    if (teleport) {
      this.x = target.x;
      this.y = target.y;
      this.heading = target.facing;
      this.path = [];
      this.moving = this.running = false;
      return;
    }
    if (Math.hypot(target.x - this.x, target.y - this.y) < 0.05) {
      this.path = [];
      return;
    }
    this.path = planPath(this, target, obs);
    this.resetProgress();
    const pace = paceFor(pathLength(this, this.path));
    this.pace = pace.speed;
    this.running = pace.running;
  }

  /**
   * Advances by dt seconds. With `ground`, it's a kinematic controller: a step that
   * would land in water or a wall turns aside instead, and if no way forward opens
   * for a few seconds he's set down at the waypoint (never stuck for good).
   * Returns true while anything (position or heading) changes.
   */
  step(dt: number, ground?: Ground): boolean {
    let budget = this.pace * dt;
    this.moving = this.path.length > 0;
    while (budget > 0 && this.path.length) {
      const next = this.path[0]!;
      const dx = next.x - this.x;
      const dy = next.y - this.y;
      const d = Math.hypot(dx, dy);
      const want = Math.atan2(dy, dx);
      if (d <= budget && !ground?.blocked(next.x, next.y)) {
        if (d > 1e-6) this.heading = turnTowards(this.heading, want, 10 * dt);
        this.x = next.x;
        this.y = next.y;
        budget -= d;
        this.path.shift();
        this.resetProgress();
        continue;
      }
      const len = Math.min(budget, d);
      budget = 0;
      if (!ground) {
        this.heading = turnTowards(this.heading, want, 10 * dt);
        this.x += (dx / d) * len;
        this.y += (dy / d) * len;
        break;
      }
      const taken = moveOnGround(ground, this.x, this.y, want, len, this.scratch);
      if (taken !== null) {
        this.heading = turnTowards(this.heading, taken, 10 * dt);
        this.x = this.scratch.x;
        this.y = this.scratch.y;
      }
      // No closer for a while (or no way at all): set him down at the waypoint.
      const left = Math.hypot(next.x - this.x, next.y - this.y);
      if (left < this.best - 0.05) {
        this.best = left;
        this.stuck = 0;
      } else if ((this.stuck += dt) > STUCK_S) {
        this.x = next.x;
        this.y = next.y;
        this.path.shift();
        this.resetProgress();
      }
    }
    if (!this.path.length) {
      this.moving = false;
      this.running = false;
      const before = this.heading;
      this.heading = turnTowards(this.heading, this.facing, 6 * dt);
      return Math.abs(angleDiff(before, this.facing)) > 1e-3;
    }
    return true;
  }
}

/** The signed smallest turn from a to b, in (−π, π]. */
export function angleDiff(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/** Turns from a towards b by at most `max` radians. */
export function turnTowards(a: number, b: number, max: number): number {
  const d = angleDiff(a, b);
  return Math.abs(d) <= max ? b : a + Math.sign(d) * max;
}
