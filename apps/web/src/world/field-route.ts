/*
 * Routes for the proving ground's machines: a polyline with its corners rounded
 * into arcs, so whatever follows one turns at a finite radius and its heading is
 * always the path's tangent (a taxiing aircraft, a rover, a flight circuit seen
 * from above). A route is a chain of legs (straight lines and circular arcs);
 * `sample` gives the point, heading and curvature at a distance along it. World
 * metres, x east, y north, headings as atan2(dy, dx). Pure.
 */

export interface RoutePoint {
  x: number;
  y: number;
}

export interface Leg {
  /** Where the leg starts, and its heading there. */
  x: number;
  y: number;
  heading: number;
  /** Its length (metres) and its distance from the route's start. */
  length: number;
  start: number;
  /** 0 for a straight line; otherwise 1 / radius, positive turning left (counter-clockwise). */
  curvature: number;
}

export interface Route {
  legs: Leg[];
  length: number;
  closed: boolean;
}

/** A point on a route: where, which way, and how sharply it turns there. */
export interface RouteSample {
  x: number;
  y: number;
  heading: number;
  curvature: number;
}

const wrap = (a: number): number => {
  let d = a % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
};

/**
 * The route through `points`, each corner rounded at `radius` (one for all, or one per point). An open
 * route starts at the first point and ends at the last (their radii are ignored); a closed one returns
 * to its first point, which must lie on a straight stretch (a point in line with its neighbours), so
 * the route has somewhere to begin. Throws if a corner's arc doesn't fit its sides.
 */
export function route(points: readonly RoutePoint[], radius: number | readonly number[], closed = false): Route {
  const n = points.length;
  if (n < 2) throw new Error("a route needs two points");
  const r = (i: number): number => (typeof radius === "number" ? radius : radius[i]!);
  const at = (i: number): RoutePoint => points[((i % n) + n) % n]!;
  // Each corner: how far along its sides the arc starts and ends (its tangent length), and its turn.
  const tangent = new Float64Array(n);
  const turn = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (!closed && (i === 0 || i === n - 1)) continue;
    const a = at(i - 1);
    const b = at(i);
    const c = at(i + 1);
    const t = wrap(Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x));
    if (Math.abs(t) < 1e-9) continue;
    if (Math.abs(Math.abs(t) - Math.PI) < 1e-6) throw new Error(`route: point ${i} doubles back`);
    turn[i] = t;
    tangent[i] = r(i) * Math.tan(Math.abs(t) / 2);
  }
  if (closed && tangent[0]! > 1e-9) throw new Error("route: a closed route starts on a straight stretch");
  const legs: Leg[] = [];
  let s = 0;
  const push = (x: number, y: number, heading: number, length: number, curvature: number): void => {
    if (length < 1e-9) return;
    legs.push({ x, y, heading, length, start: s, curvature });
    s += length;
  };
  const sides = closed ? n : n - 1;
  for (let i = 0; i < sides; i++) {
    const a = at(i);
    const b = at(i + 1);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const heading = Math.atan2(b.y - a.y, b.x - a.x);
    const from = tangent[i]!;
    const to = tangent[(i + 1) % n]!;
    if (from + to > len + 1e-6) throw new Error(`route: the corners at ${i} and ${(i + 1) % n} don't fit a side of ${len.toFixed(2)} m`);
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    push(a.x + ux * from, a.y + uy * from, heading, len - from - to, 0);
    // The corner at this side's far end (a closed route's first point has none: it began there).
    const j = (i + 1) % n;
    if (turn[j]! !== 0 && (closed ? j !== 0 : j < n - 1)) push(b.x - ux * to, b.y - uy * to, heading, r(j) * Math.abs(turn[j]!), Math.sign(turn[j]!) / r(j));
  }
  return { legs, length: s, closed };
}

/** The leg at distance `s` (clamped to an open route's ends, wrapped round a closed one): its index. */
export function legAt(rt: Route, s: number): number {
  const d = rt.closed ? ((s % rt.length) + rt.length) % rt.length : Math.max(0, Math.min(rt.length, s));
  // Few legs: a scan is as fast as a search, and allocates nothing.
  for (let i = rt.legs.length - 1; i > 0; i--) if (d >= rt.legs[i]!.start) return i;
  return 0;
}

/** The point at distance `s` along the route, written into `out`. */
export function sample(rt: Route, s: number, out: RouteSample): RouteSample {
  const d = rt.closed ? ((s % rt.length) + rt.length) % rt.length : Math.max(0, Math.min(rt.length, s));
  const leg = rt.legs[legAt(rt, d)]!;
  const u = Math.min(leg.length, d - leg.start);
  const k = leg.curvature;
  out.curvature = k;
  if (k === 0) {
    out.x = leg.x + Math.cos(leg.heading) * u;
    out.y = leg.y + Math.sin(leg.heading) * u;
    out.heading = leg.heading;
  } else {
    const h = leg.heading + k * u;
    out.x = leg.x + (Math.sin(h) - Math.sin(leg.heading)) / k;
    out.y = leg.y - (Math.cos(h) - Math.cos(leg.heading)) / k;
    out.heading = wrap(h);
  }
  return out;
}

/** A fresh sample to write into. */
export const routeSample = (): RouteSample => ({ x: 0, y: 0, heading: 0, curvature: 0 });

/** The distance along the route nearest to a point (to within `step` metres): where a marker on it stands. */
export function nearestOn(rt: Route, x: number, y: number, step = 0.25): number {
  const p = routeSample();
  let best = 0;
  let bestD = Infinity;
  for (let s = 0; s <= rt.length; s += step) {
    sample(rt, s, p);
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

/** The signed smallest turn from heading a to heading b, in (−π, π]. */
export const turnBetween = (a: number, b: number): number => wrap(b - a);
