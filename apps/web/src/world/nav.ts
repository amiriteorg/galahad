import type { Solids } from "./collide.ts";

/*
 * Finding a way round what's solid: for a walker of a given size, from one
 * point to another, round every solid in the world and off the ground it won't
 * walk on (water). A clear straight line is taken as it is. Otherwise the part
 * of the line that's blocked (from the first thing in the way to the last) is
 * planned on a grid laid over it: the solids are drawn into the grid grown by
 * the walker's radius and a margin, the ground is asked only where the search
 * looks, an A* search finds the cells, and the cells are pulled taut into a
 * few straight legs, each checked clear with a swept circle. The grid's arrays
 * are kept and reused (a plan is made when a walk begins, not every frame).
 * Pure, so unit-tested. World metres, x east, y north.
 */

export interface Point {
  x: number;
  y: number;
}

/** A walker as the planner sees it: its radius, what it steps over, how tall it is. */
export interface Walking {
  r: number;
  step: number;
  height: number;
}

/** Ground the walker won't set foot on (water), or null: anywhere. */
export type Wet = ((x: number, y: number) => boolean) | null;

/** Room kept between a planned way and what's solid, beyond the walker's own radius. */
export const MARGIN = 0.2;
/** Grid cells are this fine, or coarser for a long way (at most SIDE a side). */
const CELL = 0.5;
const SIDE = 200;
/** Room round the blocked part of the line. */
const PAD = 10;
/** The ground is checked this often along a straight leg. */
const GROUND_STEP = 0.3;
/** The search gives up after this many cells. */
const MAX_EXPANSIONS = 40_000;

const FREE = 1;
const BLOCKED = 2;
const SQRT2 = Math.SQRT2;
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];

export class Planner {
  /** How many grid plans were made (for tests and the debug view). */
  plans = 0;
  private readonly state = new Uint8Array(SIDE * SIDE);
  /** Each cell's middle: 0 not asked yet, 1 dry, 2 wet. */
  private readonly water = new Uint8Array(SIDE * SIDE);
  private readonly g = new Float32Array(SIDE * SIDE);
  private readonly from = new Int32Array(SIDE * SIDE);
  private readonly closed = new Uint8Array(SIDE * SIDE);
  private readonly heap = new Int32Array(SIDE * SIDE * 4);
  private readonly key = new Float32Array(SIDE * SIDE * 4);
  private heapSize = 0;

  constructor(readonly solids: Solids) {}

  /** True when a walker can go straight from a to b: nothing solid in the way (with `margin` to spare) and no wet ground. */
  clear(ax: number, ay: number, bx: number, by: number, w: Walking, wet: Wet, margin = 0.05): boolean {
    const dx = bx - ax;
    const dy = by - ay;
    if (this.solids.sweep(ax, ay, dx, dy, w.r + margin, w.step, w.height) < 1) return false;
    if (wet) {
      const n = Math.ceil(Math.hypot(dx, dy) / GROUND_STEP);
      for (let k = 1; k <= n; k++) if (wet(ax + (dx * k) / n, ay + (dy * k) / n)) return false;
    }
    return true;
  }

  /**
   * The way from a to b: waypoints appended to `out` (not a itself; ending at b exactly). True when it's a
   * way round everything; false when none was found, and then `out` gets b alone (walk straight and slide).
   */
  route(ax: number, ay: number, bx: number, by: number, w: Walking, wet: Wet, out: Point[]): boolean {
    if (this.clear(ax, ay, bx, by, w, wet)) {
      out.push({ x: bx, y: by });
      return true;
    }
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1e-6) {
      out.push({ x: bx, y: by });
      return true;
    }
    // The blocked part of the line: from the first thing in the way (seen from a) to the last (seen from b).
    const ux = (bx - ax) / len;
    const uy = (by - ay) / len;
    let first = this.solids.sweep(ax, ay, bx - ax, by - ay, w.r + MARGIN, w.step, w.height) * len;
    let last = len - this.solids.sweep(bx, by, ax - bx, ay - by, w.r + MARGIN, w.step, w.height) * len;
    if (wet) {
      const n = Math.ceil(len / GROUND_STEP);
      for (let k = 0; k <= n; k++) {
        if (!wet(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n)) continue;
        first = Math.min(first, (len * k) / n);
        break;
      }
      for (let k = n; k >= 0; k--) {
        if (!wet(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n)) continue;
        last = Math.max(last, (len * k) / n);
        break;
      }
    }
    if (first > last) {
      first = 0;
      last = len;
    }
    // Plan from a little before it to a little after (or from the ends), and walk straight to and from there;
    // round something big (a lake), on a wider and coarser grid.
    for (const pad of [PAD, PAD * 4, PAD * 12]) {
      const s0 = Math.max(0, first - pad);
      const s1 = Math.min(len, last + pad);
      const px = ax + ux * s0;
      const py = ay + uy * s0;
      const qx = ax + ux * s1;
      const qy = ay + uy * s1;
      const start = out.length;
      if (s0 > 0) out.push({ x: px, y: py });
      if (this.grid(px, py, qx, qy, pad, w, wet, out)) {
        if (s1 < len) out.push({ x: bx, y: by });
        else out[out.length - 1] = { x: bx, y: by };
        return true;
      }
      out.length = start;
    }
    out.push({ x: bx, y: by });
    return false;
  }

  /** A* on a grid over the box round p and q (grown by `pad`), pulled taut; appended to `out`, ending at q. */
  private grid(px: number, py: number, qx: number, qy: number, pad: number, w: Walking, wet: Wet, out: Point[]): boolean {
    this.plans++;
    const minX = Math.min(px, qx) - pad;
    const minY = Math.min(py, qy) - pad;
    const spanX = Math.abs(qx - px) + pad * 2;
    const spanY = Math.abs(qy - py) + pad * 2;
    const cell = Math.max(CELL, spanX / SIDE, spanY / SIDE);
    const nx = Math.min(SIDE, Math.ceil(spanX / cell));
    const ny = Math.min(SIDE, Math.ceil(spanY / cell));
    const n = nx * ny;
    const state = this.state;
    state.fill(0, 0, n);
    this.water.fill(0, 0, n);
    this.closed.fill(0, 0, n);
    // Every solid in the way drawn in, grown by the walker's radius and the margin.
    const solids = this.solids;
    const grow = w.r + MARGIN;
    const found = solids.around(minX - grow - 6, minY - grow - 6, minX + nx * cell + grow + 6, minY + ny * cell + grow + 6);
    for (let k = 0; k < found; k++) {
      const i = solids.found[k]!;
      if (!solids.blocks(i, w.step, w.height)) continue;
      const reach = solids.reach[i]! + grow;
      const i0 = Math.max(0, Math.floor((solids.px[i]! - reach - minX) / cell));
      const i1 = Math.min(nx - 1, Math.floor((solids.px[i]! + reach - minX) / cell));
      const j0 = Math.max(0, Math.floor((solids.py[i]! - reach - minY) / cell));
      const j1 = Math.min(ny - 1, Math.floor((solids.py[i]! + reach - minY) / cell));
      for (let j = j0; j <= j1; j++) {
        const cy = minY + (j + 0.5) * cell;
        for (let ii = i0; ii <= i1; ii++) {
          if (state[j * nx + ii] === BLOCKED) continue;
          if (solids.gap(i, minX + (ii + 0.5) * cell, cy) < grow) state[j * nx + ii] = BLOCKED;
        }
      }
    }
    // Water is asked about only where the search looks, once a cell; a cell next to a wet one isn't free either
    // (so the way keeps off the shore by a cell, whatever happens between the cells' middles).
    const water = this.water;
    const dry = (i: number, j: number): boolean => {
      if (i < 0 || j < 0 || i >= nx || j >= ny) return true;
      const c = j * nx + i;
      if (!water[c]) water[c] = wet!(minX + (i + 0.5) * cell, minY + (j + 0.5) * cell) ? 2 : 1;
      return water[c] === 1;
    };
    const free = (c: number): boolean => {
      let s = state[c]!;
      if (s === 0) {
        s = FREE;
        if (wet) {
          const i = c % nx;
          const j = (c - i) / nx;
          for (let dj = -1; dj <= 1 && s === FREE; dj++) for (let di = -1; di <= 1 && s === FREE; di++) if (!dry(i + di, j + dj)) s = BLOCKED;
        }
        state[c] = s;
      }
      return s === FREE;
    };
    /** A straight leg on the grid: nothing solid in the way (swept), and every cell it crosses free. */
    const straight = (ax: number, ay: number, bx: number, by: number): boolean => {
      if (solids.sweep(ax, ay, bx - ax, by - ay, w.r + 0.05, w.step, w.height) < 1) return false;
      const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / (cell * 0.5));
      for (let k = 1; k < steps; k++) {
        const x = ax + ((bx - ax) * k) / steps;
        const y = ay + ((by - ay) * k) / steps;
        if (x < minX || y < minY || x >= minX + nx * cell || y >= minY + ny * cell) continue;
        if (!free(cellOf(x, y))) return false;
      }
      return true;
    };
    const cellOf = (x: number, y: number): number => {
      const i = Math.max(0, Math.min(nx - 1, Math.floor((x - minX) / cell)));
      const j = Math.max(0, Math.min(ny - 1, Math.floor((y - minY) / cell)));
      return j * nx + i;
    };
    const cx = (c: number) => minX + ((c % nx) + 0.5) * cell;
    const cy = (c: number) => minY + (Math.floor(c / nx) + 0.5) * cell;
    // Each end in a free cell it can walk to straight (it may stand nearer a solid than the margin).
    const nearestFree = (x: number, y: number): number => {
      const c0 = cellOf(x, y);
      if (free(c0)) return c0;
      const ci = c0 % nx;
      const cj = Math.floor(c0 / nx);
      for (let ring = 1; ring <= Math.ceil(3 / cell); ring++) {
        let best = -1;
        let bd = Infinity;
        for (let dj = -ring; dj <= ring; dj++) {
          for (let di = -ring; di <= ring; di++) {
            if (Math.max(Math.abs(di), Math.abs(dj)) !== ring) continue;
            const i = ci + di;
            const j = cj + dj;
            if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
            const c = j * nx + i;
            if (!free(c)) continue;
            const d = Math.hypot(cx(c) - x, cy(c) - y);
            if (d < bd && solids.sweep(x, y, cx(c) - x, cy(c) - y, w.r, w.step, w.height) === 1) {
              bd = d;
              best = c;
            }
          }
        }
        if (best >= 0) return best;
      }
      return -1;
    };
    const start = nearestFree(px, py);
    const goal = nearestFree(qx, qy);
    if (start < 0 || goal < 0) return false;
    // A*, eight ways round (never cutting a corner), on distance.
    const g = this.g;
    const from = this.from;
    const closed = this.closed;
    g.fill(Infinity, 0, n);
    g[start] = 0;
    from[start] = -1;
    this.heapSize = 0;
    const gx = cx(goal);
    const gy = cy(goal);
    const h = (c: number) => {
      const ex = Math.abs(cx(c) - gx);
      const ey = Math.abs(cy(c) - gy);
      return ex + ey + (SQRT2 - 2) * Math.min(ex, ey);
    };
    this.push(start, h(start));
    let expansions = 0;
    let reached = false;
    while (this.heapSize > 0) {
      const c = this.pop();
      if (closed[c]) continue;
      closed[c] = 1;
      if (c === goal) {
        reached = true;
        break;
      }
      if (++expansions > MAX_EXPANSIONS) break;
      const i = c % nx;
      const j = (c - i) / nx;
      for (let k = 0; k < 8; k++) {
        const ii = i + DX[k]!;
        const jj = j + DY[k]!;
        if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
        const d = jj * nx + ii;
        if (closed[d] || !free(d)) continue;
        if (k >= 4 && (!free(j * nx + ii) || !free(jj * nx + i))) continue;
        const cost = g[c]! + (k >= 4 ? SQRT2 : 1) * cell;
        if (cost >= g[d]!) continue;
        g[d] = cost;
        from[d] = c;
        this.push(d, cost + h(d));
      }
    }
    if (!reached) return false;
    // The cells from start to goal, between the two ends.
    const pts: Point[] = [{ x: qx, y: qy }];
    for (let c = goal; c >= 0; c = from[c]!) pts.push({ x: cx(c), y: cy(c) });
    pts.push({ x: px, y: py });
    pts.reverse();
    // Pulled taut: from each point, straight on to the farthest one in plain sight.
    let i = 0;
    while (i < pts.length - 1) {
      let j = i + 1;
      while (j + 1 < pts.length && straight(pts[i]!.x, pts[i]!.y, pts[j + 1]!.x, pts[j + 1]!.y)) j++;
      out.push(pts[j]!);
      i = j;
    }
    return true;
  }

  private push(c: number, k: number): void {
    let i = this.heapSize++;
    const heap = this.heap;
    const key = this.key;
    if (i >= heap.length) {
      // Out of room (it never is in practice: the search stops first); drop the farthest.
      this.heapSize--;
      return;
    }
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (key[parent]! <= k) break;
      heap[i] = heap[parent]!;
      key[i] = key[parent]!;
      i = parent;
    }
    heap[i] = c;
    key[i] = k;
  }

  private pop(): number {
    const heap = this.heap;
    const key = this.key;
    const top = heap[0]!;
    const n = --this.heapSize;
    if (n > 0) {
      const c = heap[n]!;
      const k = key[n]!;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        if (l >= n) break;
        const r = l + 1;
        const m = r < n && key[r]! < key[l]! ? r : l;
        if (key[m]! >= k) break;
        heap[i] = heap[m]!;
        key[i] = key[m]!;
        i = m;
      }
      heap[i] = c;
      key[i] = k;
    }
    return top;
  }
}
