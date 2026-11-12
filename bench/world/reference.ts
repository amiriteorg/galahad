/*
 * A reference for the planner (nav.ts): the shortest way between two points by a
 * method that shares nothing with it. The whole home ground is drawn once into
 * one fine grid (the planner draws a small grid round the blocked part of each
 * line, coarser for a long way); an exhaustive A* over all of it finds the cells
 * (the planner's gives up after 40,000); and the way is pulled taut from both
 * ends until it stops getting shorter. It is slow, and that is the point: it is
 * what the planner's answer is held against.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Grid {
  x0: number;
  y0: number;
  cell: number;
  nx: number;
  ny: number;
  /** 1 where a walker's middle may not be. */
  blocked: Uint8Array;
}

export function buildGrid(box: { x0: number; y0: number; x1: number; y1: number }, cell: number, blocked: (x: number, y: number) => boolean): Grid {
  const nx = Math.floor((box.x1 - box.x0) / cell);
  const ny = Math.floor((box.y1 - box.y0) / cell);
  const out = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (blocked(box.x0 + (i + 0.5) * cell, box.y0 + (j + 0.5) * cell)) out[j * nx + i] = 1;
  return { x0: box.x0, y0: box.y0, cell, nx, ny, blocked: out };
}

export const cellX = (g: Grid, c: number): number => g.x0 + ((c % g.nx) + 0.5) * g.cell;
export const cellY = (g: Grid, c: number): number => g.y0 + (Math.floor(c / g.nx) + 0.5) * g.cell;

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];

export class ReferenceSearch {
  private readonly g: Float64Array;
  private readonly from: Int32Array;
  /** The search a cell's numbers belong to (so nothing is cleared between searches). */
  private readonly stamp: Int32Array;
  private readonly closed: Int32Array;
  private readonly heap: Int32Array;
  private readonly key: Float64Array;
  private heapSize = 0;
  private search = 0;

  /** `clear`: whether a walker can go straight from a to b. */
  constructor(
    readonly grid: Grid,
    private readonly clear: (ax: number, ay: number, bx: number, by: number) => boolean,
  ) {
    const n = grid.nx * grid.ny;
    this.g = new Float64Array(n);
    this.from = new Int32Array(n);
    this.stamp = new Int32Array(n);
    this.closed = new Int32Array(n);
    this.heap = new Int32Array(n * 4);
    this.key = new Float64Array(n * 4);
  }

  /** The shortest way from one free cell's middle to another's: its points (both ends included), or null when there is none. */
  path(start: number, goal: number): Point[] | null {
    const { grid } = this;
    const { nx, ny, cell, blocked } = grid;
    if (blocked[start] || blocked[goal]) return null;
    const search = ++this.search;
    const gx = goal % nx;
    const gy = Math.floor(goal / nx);
    const h = (c: number): number => {
      const ex = Math.abs((c % nx) - gx);
      const ey = Math.abs(Math.floor(c / nx) - gy);
      return (ex + ey + (Math.SQRT2 - 2) * Math.min(ex, ey)) * cell;
    };
    this.heapSize = 0;
    this.stamp[start] = search;
    this.g[start] = 0;
    this.from[start] = -1;
    this.push(start, h(start));
    let reached = false;
    while (this.heapSize > 0) {
      const c = this.pop();
      if (this.closed[c] === search) continue;
      this.closed[c] = search;
      if (c === goal) {
        reached = true;
        break;
      }
      const i = c % nx;
      const j = (c - i) / nx;
      for (let k = 0; k < 8; k++) {
        const ii = i + DX[k]!;
        const jj = j + DY[k]!;
        if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
        const d = jj * nx + ii;
        if (blocked[d] || this.closed[d] === search) continue;
        // Never through a corner.
        if (k >= 4 && (blocked[j * nx + ii] || blocked[jj * nx + i])) continue;
        const cost = this.g[c]! + (k >= 4 ? Math.SQRT2 : 1) * cell;
        if (this.stamp[d] === search && cost >= this.g[d]!) continue;
        this.stamp[d] = search;
        this.g[d] = cost;
        this.from[d] = c;
        this.push(d, cost + h(d));
      }
    }
    if (!reached) return null;
    let pts: Point[] = [];
    for (let c = goal; c >= 0; c = this.from[c]!) pts.push({ x: cellX(grid, c), y: cellY(grid, c) });
    pts.reverse();
    // Pulled taut, from one end and then the other, until it gets no shorter.
    for (let pass = 0; pass < 6; pass++) {
      const before = pathLength(pts);
      pts = this.taut(pts);
      pts.reverse();
      pts = this.taut(pts);
      pts.reverse();
      if (before - pathLength(pts) < 1e-6) break;
    }
    return pts;
  }

  /** From each point, straight on to the farthest one in plain sight. */
  private taut(pts: Point[]): Point[] {
    const out: Point[] = [pts[0]!];
    let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      while (j > i + 1 && !this.clear(pts[i]!.x, pts[i]!.y, pts[j]!.x, pts[j]!.y)) j--;
      out.push(pts[j]!);
      i = j;
    }
    return out;
  }

  private push(c: number, k: number): void {
    let i = this.heapSize++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.key[parent]! <= k) break;
      this.heap[i] = this.heap[parent]!;
      this.key[i] = this.key[parent]!;
      i = parent;
    }
    this.heap[i] = c;
    this.key[i] = k;
  }

  private pop(): number {
    const top = this.heap[0]!;
    const n = --this.heapSize;
    if (n > 0) {
      const c = this.heap[n]!;
      const k = this.key[n]!;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        if (l >= n) break;
        const r = l + 1;
        const m = r < n && this.key[r]! < this.key[l]! ? r : l;
        if (this.key[m]! >= k) break;
        this.heap[i] = this.heap[m]!;
        this.key[i] = this.key[m]!;
        i = m;
      }
      this.heap[i] = c;
      this.key[i] = k;
    }
    return top;
  }
}

export function pathLength(pts: readonly Point[]): number {
  let length = 0;
  for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  return length;
}
