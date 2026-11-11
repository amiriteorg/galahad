import type { ExperimentView, GalahadState, Station } from "@galahad/core/world";
import { padAt, STATIONS } from "@galahad/core/world";
import { BUILDS, type Mover } from "./collide.ts";
import { aisleAt, HALL, HALL_DOOR_IN, HALL_DOOR_OUT, inHall } from "./hall-plan.ts";
import { BENCH_AREA, CAMP, CAMP_GATE, LAKE_GATE } from "./hearth-plan.ts";
import { DECK_REST, DECK_TOP, inStairs, STAIR_WAY } from "./keep-deck.ts";
import { MARGIN as PLAN_MARGIN, type Planner, type Wet } from "./nav.ts";
import { type Ground, moveOnGround } from "./physics.ts";
import { paved, SITE_GATES, SITE_OBSTACLES } from "./sites.ts";

/** Seconds without getting closer before he looks for another way (round whatever stopped him). */
const REPLAN_S = 0.4;
/** Seconds without getting closer before he's set down at the waypoint: a last resort, never needed on the real land. */
const STUCK_S = 3;
/** This near a place he can't get to (something stands on it), he's there. */
const NEAR_ENOUGH = 1.2;

/*
 * Where Galahad stands for each kind of work, and how he walks there: straight
 * lines between waypoints, going round the keep and the other buildings rather
 * than through them, and into the workshop hall by its door and along its
 * aisle. Among the world's solids (collide.ts) each leg is planned round every
 * footprint, tree and rock (nav.ts), and he moves and slides: nothing he meets
 * on the way (a machine, something that just grew) is walked through, and he
 * finds another way round it. World coordinates (metres, x east, y north).
 * Pure, so unit-tested.
 */

export interface Point {
  x: number;
  y: number;
  /** Where he stands there, when it's not on the land: on the keep's stairs or its deck (world z). */
  z?: number;
}

export interface Obstacle extends Point {
  r: number;
}

type Place = Exclude<Station, "field">;

/** Each building's footprint (for walking round it) and how far in front of it he stands. */
const LAYOUT: Record<Place, { r: number; stand: number }> = {
  // The giant tree, its deck's posts and the stairs; he stands at the foot of the stairs.
  keep: { r: 7.5, stand: 8.5 },
  // Clear of the deck the table stands on (it reaches 2.3 m out).
  council: { r: 1.7, stand: 2.85 },
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

/**
 * The gate of an experiment's plot: on its edge nearest the keep, just outside the fence, facing in.
 * A test cell in the hall opens onto the aisle instead.
 */
export function plotGate(plot: { x: number; y: number; size: number }): Target {
  if (padAt(plot)?.site === "hall") {
    const side = plot.y >= HALL.y ? 1 : -1;
    return { x: plot.x, y: plot.y - side * (plot.size / 2 + 1.4), facing: (side * Math.PI) / 2 };
  }
  const len = Math.hypot(plot.x, plot.y);
  const ux = len > 1e-6 ? -plot.x / len : 0;
  const uy = len > 1e-6 ? -plot.y / len : -1;
  const edge = plot.size / 2 / Math.max(Math.abs(ux), Math.abs(uy));
  // 1.6 m out from the plot's edge, and clear of its fence (its corner posts too, when the keep lies off a corner).
  const fence = plot.size / 2 + 1;
  let d = edge + 1.6;
  const outside = (k: number) => Math.hypot(Math.max(0, Math.abs(ux * k) - fence), Math.max(0, Math.abs(uy * k) - fence));
  while (outside(d) < 0.595) d += 0.05;
  return { x: plot.x + ux * d, y: plot.y + uy * d, facing: Math.atan2(-uy, -ux) };
}

/** Where his state sends him: a station (at the keep, up on its deck), or the gate of the experiment he's out at (the keep if it isn't known). */
export function targetFor(galahad: GalahadState, experiments: readonly ExperimentView[]): Target {
  if (galahad.station === "field") {
    const e = experiments.find((x) => x.id === galahad.experiment);
    return e ? plotGate(e.plot) : DECK_REST;
  }
  return galahad.station === "keep" ? DECK_REST : standAt(galahad.station);
}

/** The buildings (the keep's, the hall, the proving ground's) and the fenced plots he walks round. Pads on a site have no fence. */
export function obstacles(experiments: readonly ExperimentView[] = []): Obstacle[] {
  const out: Obstacle[] = PLACES.filter((p) => LAYOUT[p].r > 0).map((p) => ({ x: STATIONS[p].x, y: STATIONS[p].y, r: LAYOUT[p].r }));
  for (const o of SITE_OBSTACLES) out.push({ x: o.x, y: o.y, r: o.r });
  for (const e of experiments) if (!padAt(e.plot)) out.push({ x: e.plot.x, y: e.plot.y, r: (e.plot.size / 2) * Math.SQRT2 });
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

/** How far outside the hall's walls he passes when he has to go round a corner of it. */
const HALL_CLEAR = 4;

/**
 * From a point outside the hall to its door: nothing if the door is in plain view (west of the
 * hall's front), otherwise round the nearer front corner, and from behind the hall round the back
 * corner first.
 */
function hallApproach(p: Point): Point[] {
  const front = HALL.x - HALL.hx - HALL_CLEAR;
  if (p.x <= front) return [];
  const side = (p.y >= HALL.y ? 1 : -1) * (HALL.hy + HALL_CLEAR);
  const corner = { x: front, y: HALL.y + side };
  if (Math.abs(p.y - HALL.y) >= HALL.hy + HALL_CLEAR) return [corner];
  return [{ x: HALL.x + HALL.hx + HALL_CLEAR, y: HALL.y + side }, corner];
}

/** A waypoint up on the keep's stairs or deck (it says how high, and that's off the ground). */
const raisedAt = (p: Point): boolean => p.z !== undefined && p.z > 0.05;

/** On the keep's deck (a point that says it's up there). */
const onDeck = (p: Point): boolean => (p.z ?? 0) > DECK_TOP - 0.1;

/**
 * Waypoints from `from` to `to` (ending at `to`), round whatever stands between. Into and out of
 * the workshop hall he goes by its door, and inside it along the aisle; up to the keep's deck and
 * down from it by its stairs (STAIR_WAY: those waypoints say how high they are).
 */
export function planPath(from: Point, to: Point, obs: readonly Obstacle[]): Point[] {
  const up = onDeck(to);
  const down = onDeck(from);
  const climbing = (from.z ?? 0) > 0.05 && !down && inStairs(from.x, from.y);
  if (!up && !down && !climbing) return groundPath(from, to, obs);
  const foot = STAIR_WAY[STAIR_WAY.length - 1]!;
  const copy = (p: Point): Point => ({ x: p.x, y: p.y, z: p.z });
  if (up && (down || climbing)) return [...(climbing ? STAIR_WAY.slice(0, -1).reverse() : []).map(copy), copy(to)];
  if (up) return [...groundPath(from, foot, obs).slice(0, -1), copy(foot), ...STAIR_WAY.slice(0, -1).reverse().map(copy), copy(to)];
  // Down (from the deck, or from partway down the stairs), then on over the land.
  const way = climbing ? [foot] : STAIR_WAY;
  return [...way.slice(0, -1).map(copy), copy(foot), ...groundPath(foot, to, obs)];
}

/** Waypoints over the land (and through the hall), as planPath. */
function groundPath(from: Point, to: Point, obs: readonly Obstacle[]): Point[] {
  const fromHall = inHall(from.x, from.y);
  const toHall = inHall(to.x, to.y);
  if (!fromHall && !toHall) return [...detours(from, to, obs, 0), { x: to.x, y: to.y }];
  const out: Point[] = [];
  let here: Point = from;
  /** On to `p`: straight (indoors, through the door) or round what is in the way (outdoors). */
  const leg = (p: Point, outdoors: boolean): void => {
    if (Math.hypot(p.x - here.x, p.y - here.y) < 0.05) return;
    if (outdoors) out.push(...detours(here, p, obs, 0));
    out.push({ x: p.x, y: p.y });
    here = p;
  };
  if (fromHall) {
    leg(aisleAt(from.x), false);
    if (toHall) leg(aisleAt(to.x), false);
    else {
      leg(HALL_DOOR_IN, false);
      leg(HALL_DOOR_OUT, false);
      for (const p of hallApproach(to).reverse()) leg(p, true);
    }
  } else {
    for (const p of hallApproach(from)) leg(p, true);
    leg(HALL_DOOR_OUT, true);
    leg(HALL_DOOR_IN, false);
    leg(aisleAt(to.x), false);
  }
  leg(to, !toHall);
  if (!out.length) out.push({ x: to.x, y: to.y });
  return out;
}

/** The keep's paths (from the foot of its stairs to every station), planned once. */
let keepPaths: Point[][] | null = null;
function paths(): Point[][] {
  if (keepPaths) return keepPaths;
  const from = standAt("keep");
  const obs = obstacles();
  keepPaths = PLACES.filter((p) => p !== "keep").map((p) => [{ x: from.x, y: from.y }, ...planPath(from, standAt(p), obs)]);
  // Down to his hearth, and on from it to the bench by the lake.
  keepPaths.push([{ x: from.x, y: from.y }, { ...CAMP_GATE }], [{ ...LAKE_GATE }, { x: BENCH_AREA.x + 0.6, y: BENCH_AREA.y + 1.2 }]);
  return keepPaths;
}

/** Every footprint and place to stand round the keep, as circles (x, y, r), worked out once. */
let builtCircles: Float64Array | null = null;
function circles(): Float64Array {
  if (builtCircles) return builtCircles;
  const out: number[] = [];
  for (const p of PLACES) {
    const s = STATIONS[p];
    const stand = standAt(p);
    out.push(s.x, s.y, LAYOUT[p].r + 1.5, stand.x, stand.y, p === "keep" ? 3.6 : 2.2);
  }
  out.push(CAMP.x, CAMP.y, CAMP.r, BENCH_AREA.x, BENCH_AREA.y, BENCH_AREA.r);
  builtCircles = Float64Array.from(out);
  return builtCircles;
}

/** The roads from the foot of the keep's stairs out to the two sites, planned once. */
let siteRoads: Point[][] | null = null;
export function roads(): Point[][] {
  if (siteRoads) return siteRoads;
  const from = standAt("keep");
  const obs = obstacles();
  siteRoads = Object.values(SITE_GATES).map((gate) => [{ x: from.x, y: from.y }, ...planPath(from, gate, obs)]);
  return siteRoads;
}

/** Within `half` metres of a polyline (asked thousands of times when the ground is coloured: no allocation). */
function along(line: readonly Point[], x: number, y: number, half: number): boolean {
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len2 = ex * ex + ey * ey;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * ex + (y - a.y) * ey) / len2)) : 0;
    const dx = a.x + ex * t - x;
    const dy = a.y + ey * t - y;
    if (dx * dx + dy * dy < half * half) return true;
  }
  return false;
}

/** The roads out to the sites are this wide (half of it). */
const ROAD_HALF = 1.7;

/**
 * True where something is built: a station's footprint, a path, a place to stand, a road to a
 * site, a site's paving or floor. Nothing grows there.
 */
export function built(x: number, y: number): boolean {
  if (paved(x, y)) return true;
  const out = roads();
  for (let i = 0; i < out.length; i++) if (along(out[i]!, x, y, ROAD_HALF)) return true;
  if (x * x + y * y > 70 * 70) return false;
  const c = circles();
  for (let i = 0; i < c.length; i += 3) {
    const dx = x - c[i]!;
    const dy = y - c[i + 1]!;
    if (dx * dx + dy * dy < c[i + 2]! * c[i + 2]!) return true;
  }
  // Within 1.3 m of a path.
  const lines = paths();
  for (let i = 0; i < lines.length; i++) if (along(lines[i]!, x, y, 1.3)) return true;
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
/** On the keep's stairs (and while he's up on its deck), this share of his pace: a step at a time. */
const STAIR_PACE = 0.55;
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

/** Galahad among the solids: the planner (it knows the world's solids), his place among them, and the ground he won't walk on. */
export interface WalkWorld {
  planner: Planner;
  /** His circle in the world (joined with the walker itself as its place). */
  mover: Mover;
  /** Ground the way keeps off (the water and its very edge). */
  wet: Wet;
  /** Ground he never steps on (water deeper than a puddle at the edge); `wet` if not given. */
  deep?: Wet;
  /** The land's height (world z); 0 if not given. */
  height?: (x: number, y: number) => number;
}

/** Turns tried, either way, when a step would end in water. */
const ASIDE = [0.5, -0.5, 1.0, -1.0, 1.5, -1.5];

/**
 * Galahad's feet: follows a path at his pace, turning towards where he goes, and
 * towards the work once he arrives. `teleport` (reduced motion) skips the walk.
 * Among the solids (`join`), every leg is planned round what's there and he
 * moves and slides on it; whatever stops him on the way (a machine, a tree that
 * just grew), he plans round from where he is. He's set down at the waypoint
 * only as a last resort (`fallbacks` counts it).
 */
export class Walker {
  x: number;
  y: number;
  /** His radius among the solids. */
  r: number = BUILDS.galahad.r;
  heading: number;
  moving = false;
  running = false;
  /** Times he was set down at a waypoint because no way there opened. */
  fallbacks = 0;
  /** Times he planned again on the way. */
  replans = 0;
  /** Where his feet are (world z): on the land, or on what he's stepped up onto (a tread, the deck, a flat rock). */
  z = 0;
  /** True while that's above the land: his questions are asked from there (collide.ts' floor). */
  raised = false;
  private path: Point[] = [];
  private facing: number;
  private pace = WALK_SPEED;
  private readonly scratch = { x: 0, y: 0 };
  private best = Infinity;
  private stuck = 0;
  private world: WalkWorld | null = null;
  /** The solids' version his path was last checked against. */
  private seen = -1;

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

  /** Walks among the world's solids from now on. */
  join(world: WalkWorld): void {
    this.world = world;
    this.stand(this.raised ? this.z : Number.NaN);
  }

  /** Stands him where he is, on the land or what he's on: at z if it's given (a place on the deck), else the land. */
  private stand(z: number): void {
    const land = this.world?.height?.(this.x, this.y) ?? 0;
    this.z = Number.isNaN(z) ? land : Math.max(land, z);
    this.raised = this.z > land + 0.03;
  }

  /** The floor his questions are asked from: where his feet are while he's up on something; NaN on the land. */
  get floor(): number {
    return this.raised ? this.z : Number.NaN;
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
      this.stand(target.z ?? Number.NaN);
      return;
    }
    if (Math.hypot(target.x - this.x, target.y - this.y) < 0.05) {
      this.path = [];
      return;
    }
    const plan = planPath({ x: this.x, y: this.y, z: this.raised ? this.z : undefined }, target, obs);
    this.path = this.world ? this.refine(plan) : plan;
    this.seen = this.world ? this.world.planner.solids.version : -1;
    this.resetProgress();
    const pace = paceFor(pathLength(this, this.path));
    this.pace = pace.speed;
    this.running = pace.running;
  }

  /**
   * The way's legs, each planned round what's solid (a waypoint inside something is passed by). Those up on the
   * keep's stairs and deck (a waypoint with a height) are taken as they are: they're its way up and down.
   */
  private refine(plan: readonly Point[]): Point[] {
    const { planner, mover, wet } = this.world!;
    const out: Point[] = [];
    let x = this.x;
    let y = this.y;
    let up = this.raised;
    for (let i = 0; i < plan.length; i++) {
      const p = plan[i]!;
      if (up || raisedAt(p)) out.push(p);
      else {
        if (i < plan.length - 1 && !mover.fits(p.x, p.y, PLAN_MARGIN)) continue;
        planner.route(x, y, p.x, p.y, mover, wet, out);
      }
      x = p.x;
      y = p.y;
      up = raisedAt(p);
    }
    return out;
  }

  /** From where he is to the waypoint ahead, round whatever is there now. */
  private replan(): void {
    const { planner, mover, wet } = this.world!;
    const next = this.path[0]!;
    const way: Point[] = [];
    planner.route(this.x, this.y, next.x, next.y, mover, wet, way);
    this.path.splice(0, 1, ...way);
    this.replans++;
  }

  /**
   * Advances by dt seconds. With `ground`, it's a kinematic controller: a step that
   * would land in water or a wall turns aside instead, and if no way forward opens
   * for a few seconds he's set down at the waypoint (never stuck for good).
   * Among the solids (`join`), the ground is theirs (`ground` is not used).
   * Returns true while anything (position or heading) changes.
   */
  step(dt: number, ground?: Ground): boolean {
    if (this.world) return this.walk(dt);
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
        this.fallbacks++;
      }
    }
    return this.settle(dt);
  }

  /** Once there: he turns to his work. True while he's still turning (or walking). */
  private settle(dt: number): boolean {
    if (!this.path.length) {
      this.moving = false;
      this.running = false;
      const before = this.heading;
      this.heading = turnTowards(this.heading, this.facing, 6 * dt);
      return Math.abs(angleDiff(before, this.facing)) > 1e-3;
    }
    return true;
  }

  /**
   * A step among the solids: move and slide along the way, round whatever is met. He steps up onto what's no
   * higher than his step above his feet (collide.ts' support) and down off it, never more than a step down at once
   * (he doesn't walk off the deck's edge); up there, everything is asked from where his feet are.
   */
  private walk(dt: number): boolean {
    const { planner, mover, wet } = this.world!;
    const solids = planner.solids;
    this.moving = this.path.length > 0;
    // Something grew (or went) since the way was planned: if it's now in the way ahead, plan round it (on the land).
    const version = solids.version;
    if (this.path.length && version !== this.seen) {
      this.seen = version;
      const next = this.path[0]!;
      if (!this.raised && !raisedAt(next) && !planner.clear(this.x, this.y, next.x, next.y, mover, wet, 0)) this.replan();
    }
    // On stairs and steps, at a climber's pace.
    let budget = this.pace * dt * (this.raised || (this.path[0] && raisedAt(this.path[0])) ? STAIR_PACE : 1);
    for (let guard = 0; budget > 1e-9 && this.path.length && guard < 6; guard++) {
      const next = this.path[0]!;
      const dx = next.x - this.x;
      const dy = next.y - this.y;
      const d = Math.hypot(dx, dy);
      if (d < 1e-6) {
        this.path.shift();
        this.resetProgress();
        continue;
      }
      const len = Math.min(budget, d);
      const out = this.scratch;
      // What stops him is judged from the highest thing a foot of his is up on (a tread is narrower than he is: one
      // foot on it, he steps to the next), or where his feet are.
      const land0 = this.world!.height?.(this.x, this.y) ?? 0;
      const reach = Math.max(this.z, solids.support(this.x, this.y, this.z, mover.step, mover.r));
      solids.floor = reach > land0 + 0.03 ? reach : Number.NaN;
      mover.slide(this.x, this.y, (dx / d) * len, (dy / d) * len, out);
      const deep = this.world!.deep ?? wet;
      if (deep?.(out.x, out.y)) this.aside(dx / d, dy / d, len, out, deep);
      // Where his feet are there: on the land, or what he's stepped up onto; not over an edge more than a step down.
      const land = this.world!.height?.(out.x, out.y) ?? 0;
      const z = Math.max(land, solids.support(out.x, out.y, this.z, mover.step));
      solids.floor = Number.NaN;
      if (this.raised && z < this.z - mover.step - 1e-6) {
        out.x = this.x;
        out.y = this.y;
      } else {
        this.z = z;
        this.raised = z > land + 0.03;
      }
      const mx = out.x - this.x;
      const my = out.y - this.y;
      if (mx * mx + my * my > 1e-12) this.heading = turnTowards(this.heading, Math.atan2(my, mx), 10 * dt);
      this.x = out.x;
      this.y = out.y;
      const left = Math.hypot(next.x - this.x, next.y - this.y);
      if (left < 0.02 || (!mover.touched && len >= d - 1e-9)) {
        // There (exactly: the plan's ends are clear of everything).
        if (!mover.touched) {
          this.x = next.x;
          this.y = next.y;
        }
        budget -= len;
        this.path.shift();
        this.resetProgress();
        continue;
      }
      budget = 0;
      this.progress(left, dt);
    }
    return this.settle(dt);
  }

  /** Getting no closer: another way round; near a place that's taken, that will do; as a last resort, set down there. */
  private progress(left: number, dt: number): void {
    if (left < this.best - 0.02) {
      this.best = left;
      this.stuck = 0;
      return;
    }
    const before = this.stuck;
    this.stuck += dt;
    const { mover } = this.world!;
    if (this.path.length === 1 && left < NEAR_ENOUGH && !this.fitsAt(this.path[0]!)) {
      // Something stands where he was going: this near, he's arrived.
      this.path.length = 0;
      this.resetProgress();
      return;
    }
    if (before < REPLAN_S && this.stuck >= REPLAN_S && !this.raised && !raisedAt(this.path[0]!)) {
      this.replan();
      return;
    }
    if (this.stuck > STUCK_S) {
      const next = this.path.shift()!;
      if (this.fitsAt(next)) {
        this.x = next.x;
        this.y = next.y;
        this.stand(next.z ?? Number.NaN);
      }
      this.fallbacks++;
      this.resetProgress();
    }
  }

  /** True where he could stand at a waypoint: nothing solid there, as he'd meet it from its height (on the deck, from the deck). */
  private fitsAt(p: Point): boolean {
    const { planner, mover } = this.world!;
    planner.solids.floor = raisedAt(p) ? p.z! : Number.NaN;
    const fits = mover.fits(p.x, p.y);
    planner.solids.floor = Number.NaN;
    return fits;
  }

  /** The step would end in water: turn aside, a little and then more, either way; or stay put. */
  private aside(ux: number, uy: number, len: number, out: { x: number; y: number }, deep: (x: number, y: number) => boolean): void {
    const { mover } = this.world!;
    const h = Math.atan2(uy, ux);
    for (let k = 0; k < ASIDE.length; k++) {
      const a = h + ASIDE[k]!;
      mover.slide(this.x, this.y, Math.cos(a) * len, Math.sin(a) * len, out);
      if (!deep(out.x, out.y)) return;
    }
    out.x = this.x;
    out.y = this.y;
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
