import { padAt } from "@galahad/core/world";
import type { Collider } from "./colliders.ts";
import { plotGate } from "./path.ts";

/*
 * An experiment's plot on open land, as plots.ts draws it and walkers meet it:
 * a fence of posts and rails round it, with a gap for the gate on the side
 * nearest the keep, the signpost beside the gate and a little research dome
 * behind. One layout for both, so the solids are where the fence is. Pads on
 * the sites have neither fence nor dome (the site is their ground), only the
 * sign; a test cell in the workshop hasn't even that (it has its own stack
 * light, and its gate opens onto the aisle, where a post would stand in his
 * way). The gate is on the square fence the way the keep lies, as plotGate has
 * it: on a plot diagonal from the keep, at the corner. Pure; plot-relative
 * metres (x east, y north) unless it says world.
 */

export interface PlotLayout {
  /** The way from the plot's centre to its gate (atan2 convention); the fence's half-side. */
  gateDir: number;
  half: number;
  /** Posts, and rails from post to post (the gate's stretch has none). */
  posts: [number, number][];
  rails: [number, number, number, number][];
  /** None for a test cell in the hall. */
  sign: [number, number] | null;
  /** The dome's centre and its solar panel's (none on a site's pad). */
  dome: [number, number] | null;
  panel: [number, number] | null;
}

export function plotLayout(plot: { x: number; y: number; size: number }): PlotLayout {
  const sited = padAt(plot) !== null;
  const gate = plotGate(plot);
  const gateDir = Math.atan2(gate.y - plot.y, gate.x - plot.x);
  const f = plot.size / 2 + 1;
  // Where the gate is on the fence: on the square, not a circle (on a diagonal plot the gate is its corner).
  const toGate = f / Math.max(Math.abs(Math.cos(gateDir)), Math.abs(Math.sin(gateDir)));
  const gx = Math.cos(gateDir) * toGate;
  const gy = Math.sin(gateDir) * toGate;
  const posts: [number, number][] = [];
  const rails: [number, number, number, number][] = [];
  const corners: [number, number][] = [[-f, -f], [f, -f], [f, f], [-f, f]];
  for (let side = 0; !sited && side < 4; side++) {
    const [ax, ay] = corners[side]!;
    const [bx, by] = corners[(side + 1) % 4]!;
    const n = Math.max(2, Math.round(Math.hypot(bx - ax, by - ay) / 2.5));
    for (let i = 0; i < n; i++) {
      const px = ax + ((bx - ax) * i) / n;
      const py = ay + ((by - ay) * i) / n;
      const qx = ax + ((bx - ax) * (i + 1)) / n;
      const qy = ay + ((by - ay) * (i + 1)) / n;
      // The gate: a gap in the fence where the path from the keep arrives (no post standing in the middle of it).
      if (Math.hypot(px - gx, py - gy) > 0.5) posts.push([px, py]);
      if (Math.hypot((px + qx) / 2 - gx, (py + qy) / 2 - gy) < 1.6) continue;
      rails.push([px, py, qx, qy]);
    }
  }
  const side = gateDir + Math.PI / 2;
  const sign: [number, number] | null = padAt(plot)?.site === "hall" ? null : [Math.cos(gateDir) * (toGate + 0.8) + Math.cos(side) * 2.2, Math.sin(gateDir) * (toGate + 0.8) + Math.sin(side) * 2.2];
  if (sited) return { gateDir, half: f, posts, rails, sign, dome: null, panel: null };
  const back = gateDir + Math.PI;
  const dome: [number, number] = [Math.cos(back) * (f + 2.2) + Math.cos(side) * f * 0.55, Math.sin(back) * (f + 2.2) + Math.sin(side) * f * 0.55];
  return { gateDir, half: f, posts, rails, sign, dome, panel: [dome[0] - Math.cos(side) * 3.2, dome[1] - Math.sin(side) * 3.2] };
}

/** The plot's solids, in the world: posts, rails, the sign, the dome and its panel. */
export function plotColliders(plot: { x: number; y: number; size: number }): Collider[] {
  const l = plotLayout(plot);
  const out: Collider[] = [];
  const across = l.gateDir + Math.PI / 2;
  for (const [x, y] of l.posts) out.push({ kind: "circle", x: plot.x + x, y: plot.y + y, r: 0.12, top: 1.25 });
  for (const [ax, ay, bx, by] of l.rails) {
    out.push({ kind: "box", x: plot.x + (ax + bx) / 2, y: plot.y + (ay + by) / 2, hx: Math.hypot(bx - ax, by - ay) / 2, hy: 0.06, yaw: Math.atan2(by - ay, bx - ax), top: 1.05 });
  }
  if (l.sign) {
    out.push({ kind: "circle", x: plot.x + l.sign[0], y: plot.y + l.sign[1], r: 0.12, top: 2.45 });
    out.push({ kind: "box", x: plot.x + l.sign[0], y: plot.y + l.sign[1], hx: 0.78, hy: 0.08, yaw: across, top: 2.42, bottom: 1.48, seeThrough: true });
  }
  if (l.dome && l.panel) {
    out.push({ kind: "circle", x: plot.x + l.dome[0], y: plot.y + l.dome[1], r: 2.08, top: 2.0 });
    out.push({ kind: "box", x: plot.x + l.panel[0], y: plot.y + l.panel[1], hx: 0.75, hy: 1.25, yaw: l.gateDir, top: 1.65 });
  }
  return out;
}
