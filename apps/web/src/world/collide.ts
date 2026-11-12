import type { Collider } from "./colliders.ts";

/*
 * What's solid, and how things move among it. The world's physics is kinematic
 * (physics.ts): nothing here has forces or momentum. Solids are circles and
 * turned boxes seen from above, each standing on its own ground from `bottom`
 * to `top` (so a walker passes under a deck and steps over a kerb, and the
 * camera can tell a crown from the air beneath it). They live in a uniform
 * spatial hash, added and removed in batches as the land grows and drops its
 * chunks. Movers are circles that walk: each slides along what it meets
 * (move-and-slide, from a swept test, so nothing tunnels however fast it
 * goes), keeps out of heavier movers, and is moved aside by them.
 *
 * Queries allocate nothing: results come back in the world's own fields
 * (`hit`, `hitX`, `hitY`, `found`). Pure, so unit-tested. World metres, x east,
 * y north; heights are metres above each solid's own ground.
 */

/** The spatial hash's cell, metres: a little wider than a tree's crown. */
export const CELL = 4;
/** Things rest this far apart rather than touching (so rounding never puts one inside the other). */
export const SKIN = 0.01;

export const CIRCLE = 1;
export const BOX = 2;

/** What a solid stops (a bit mask): walkers; the camera (it never stands inside one); the line of sight (the camera's arm shortens rather than look through it). */
export const WALK = 1;
export const VIEW = 2;
export const SIGHT = 4;
/** A wall, a building, a hill: stops everything. */
export const SOLID = WALK | VIEW | SIGHT;

/** A mover's place: the same object every frame, moved in place. A radius of 0: it's away. */
export interface Circle {
  x: number;
  y: number;
  r: number;
}

/**
 * How a kind of walker is built: its radius, how high it stands, the most it steps up onto (or down from), and who
 * gives way (the lighter). A step is about a walker's knee height: Galahad's knee is 0.53 m up (knight.ts: hips at
 * 1.02, a 0.44 m thigh), the dog's 0.2 m (dog.ts).
 */
export interface Build {
  r: number;
  height: number;
  step: number;
  mass: number;
}

/** The walkers of the world. Heavier ones are walked round and push lighter ones aside. */
export const BUILDS = {
  /** A site's machine on the move (a rover, a cart, a taxiing aircraft): nothing moves it. */
  machine: { r: 1, height: 3, step: 0, mass: 1e9 },
  galahad: { r: 0.45, height: 2.5, step: 0.5, mass: 100 },
  deer: { r: 0.5, height: 1.9, step: 0.3, mass: 60 },
  dog: { r: 0.32, height: 0.75, step: 0.2, mass: 20 },
  microduck: { r: 0.3, height: 0.9, step: 0.1, mass: 4 },
  rabbit: { r: 0.2, height: 0.5, step: 0.12, mass: 3 },
  duck: { r: 0.22, height: 0.4, step: 0.05, mass: 2 },
} as const satisfies Record<string, Build>;

interface Bucket {
  n: number;
  items: Int32Array;
}

/** A cell's key: 15 bits a side, so always a small integer (cells 131 km apart share one, which only costs a wasted test). */
const key = (cx: number, cy: number): number => ((cx & 0x7fff) << 15) | (cy & 0x7fff);

// The narrow phase's answer (module scratch: no allocation).
let nX = 0;
let nY = 0;
let nZ = 0;
let spanIn = 0;
let spanOut = 0;
const NONE = 2;

/** `hit` when a sweep met nothing. */
export const NOTHING = -1;

/**
 * A point moving from p by d against a circle of radius R at the origin: the
 * share of the way (0..1) at which it touches, or NONE. Already inside, it's
 * stopped at once unless it's on its way out. Sets the normal (nX, nY).
 */
function rayCircle(px: number, py: number, dx: number, dy: number, R: number): number {
  const c = px * px + py * py - R * R;
  const b = px * dx + py * dy;
  if (c <= 0) {
    if (b >= 0) return NONE;
    const l = Math.hypot(px, py);
    if (l > 1e-9) {
      nX = px / l;
      nY = py / l;
    } else {
      const dl = Math.hypot(dx, dy) || 1;
      nX = -dx / dl;
      nY = -dy / dl;
    }
    return 0;
  }
  if (b >= 0) return NONE;
  const a = dx * dx + dy * dy;
  const disc = b * b - a * c;
  if (disc < 0) return NONE;
  const t = (-b - Math.sqrt(disc)) / a;
  if (t > 1) return NONE;
  nX = (px + dx * t) / R;
  nY = (py + dy * t) / R;
  return t;
}

/**
 * The same against a box (half-extents hx, hy, at the origin, axes its own)
 * grown by r all round: a rectangle with rounded corners.
 */
function rayBox(px: number, py: number, dx: number, dy: number, hx: number, hy: number, r: number): number {
  const qx = px < -hx ? -hx : px > hx ? hx : px;
  const qy = py < -hy ? -hy : py > hy ? hy : py;
  const ox = px - qx;
  const oy = py - qy;
  const d2 = ox * ox + oy * oy;
  if (d2 < r * r) {
    // Already overlapping: out along the shortest way; stopped only if heading farther in.
    if (d2 > 1e-18) {
      const l = Math.sqrt(d2);
      nX = ox / l;
      nY = oy / l;
    } else if (hx - Math.abs(px) < hy - Math.abs(py)) {
      nX = px >= 0 ? 1 : -1;
      nY = 0;
    } else {
      nX = 0;
      nY = py >= 0 ? 1 : -1;
    }
    return dx * nX + dy * nY < 0 ? 0 : NONE;
  }
  const ex = hx + r;
  const ey = hy + r;
  let t0 = 0;
  let t1 = 1;
  let axis = 0;
  let sign = 0;
  if (Math.abs(dx) < 1e-12) {
    if (Math.abs(px) >= ex) return NONE;
  } else {
    let ta = (-ex - px) / dx;
    let tb = (ex - px) / dx;
    let s = -1;
    if (ta > tb) {
      const swap = ta;
      ta = tb;
      tb = swap;
      s = 1;
    }
    if (ta > t0) {
      t0 = ta;
      axis = 1;
      sign = s;
    }
    if (tb < t1) t1 = tb;
    if (t0 > t1) return NONE;
  }
  if (Math.abs(dy) < 1e-12) {
    if (Math.abs(py) >= ey) return NONE;
  } else {
    let ta = (-ey - py) / dy;
    let tb = (ey - py) / dy;
    let s = -1;
    if (ta > tb) {
      const swap = ta;
      ta = tb;
      tb = swap;
      s = 1;
    }
    if (ta > t0) {
      t0 = ta;
      axis = 2;
      sign = s;
    }
    if (tb < t1) t1 = tb;
    if (t0 > t1) return NONE;
  }
  // Where it enters the grown box: on a flat side, that's the touch; in a corner's square, the corner's arc decides.
  const ax = px + dx * t0;
  const ay = py + dy * t0;
  if (axis === 1 && Math.abs(ay) <= hy) {
    nX = sign;
    nY = 0;
    return t0;
  }
  if (axis === 2 && Math.abs(ax) <= hx) {
    nX = 0;
    nY = sign;
    return t0;
  }
  return rayCircle(px - (ax >= 0 ? hx : -hx), py - (ay >= 0 ? hy : -hy), dx, dy, r);
}

export class Solids {
  /** Bumped whenever solids are added or removed. */
  version = 0;
  /** How many solids there are. */
  size = 0;

  // One slot per solid (read-only to everyone else; the arrays are replaced when they grow).
  /** 0: an empty slot; CIRCLE or BOX. */
  shape = new Uint8Array(256);
  px = new Float64Array(256);
  py = new Float64Array(256);
  /** A circle's radius, or a box's half-extent along its own x. */
  hx = new Float64Array(256);
  hy = new Float64Array(256);
  /** A box's turn. */
  cos = new Float64Array(256);
  sin = new Float64Array(256);
  /** The ground it stands on (world z), and how far above it its underside and its top are. */
  base = new Float64Array(256);
  lo = new Float64Array(256);
  hi = new Float64Array(256);
  /** No part of it is farther than this from (px, py). */
  reach = new Float64Array(256);
  /** What it stops (WALK, VIEW, SIGHT). */
  mask = new Uint8Array(256);
  private link = new Int32Array(256);
  private mark = new Int32Array(256);
  /** One past the highest slot ever used. */
  high = 0;
  private readonly spare: number[] = [];
  private readonly cells = new Map<number, Bucket>();
  private readonly pool: Bucket[] = [];
  private readonly heads = new Map<number, number>();
  private nextBatch = 1;
  private openHead = -2;
  private tick = 0;

  /** What the last gathering query found: slots, `count` of them. */
  found = new Int32Array(64);
  count = 0;

  /** The last sweep's touch: a solid's slot, or NOTHING, or a mover (−2 − its index); and the surface's normal there. */
  hit = NOTHING;
  hitX = 0;
  hitY = 0;
  /** Scratch for clearAlong: spans along the arm (in, out pairs). */
  private readonly spans = new Float64Array(128);
  /** Solids a sweep passes straight through (the planner's: what its ends stand in). */
  readonly pass = new Int32Array(8);
  passes = 0;

  /** Everything that walks. */
  readonly movers: Mover[] = [];
  private readonly spot = { x: 0, y: 0 };
  /**
   * separate()'s own look-up, made again each round (nothing is allocated once it has grown to the movers): the
   * movers that are there (a radius), in the order they joined; the cells of a 4 m grid they lie in, as chains in
   * a hash table; the few too wide for a cell; and whoever a mover might touch, gathered and put in order.
   */
  private sepThere = new Int32Array(0);
  private sepChain = new Int32Array(0);
  private sepHeads = new Int32Array(0);
  private sepWide = new Int32Array(0);
  private sepNear = new Int32Array(32);
  private readonly sepCells = new Int32Array(9);

  // ---------- adding and removing ----------

  /** Begins a batch: every solid added until `close` belongs to it. */
  open(): void {
    this.openHead = -1;
  }

  /** Ends the batch and returns its id, for `remove` (0: it was empty). */
  close(): number {
    const head = this.openHead;
    this.openHead = -2;
    if (head < 0) return 0;
    const id = this.nextBatch++;
    this.heads.set(id, head);
    this.version++;
    return id;
  }

  /** A circle of radius r, standing on ground at height z, from `bottom` to `top` above it. */
  circle(x: number, y: number, r: number, z = 0, top = Infinity, bottom = 0, mask = SOLID): void {
    if (!(r > 0) || !mask) return;
    const i = this.slot();
    this.shape[i] = CIRCLE;
    this.px[i] = x;
    this.py[i] = y;
    this.hx[i] = r;
    this.hy[i] = r;
    this.cos[i] = 1;
    this.sin[i] = 0;
    this.base[i] = z;
    this.lo[i] = bottom;
    this.hi[i] = top;
    this.reach[i] = r;
    this.mask[i] = mask;
    this.index(i, true);
  }

  /** A box of half-extents hx by hy, turned by `yaw` (the way its hx points, atan2 convention). */
  box(x: number, y: number, hx: number, hy: number, yaw = 0, z = 0, top = Infinity, bottom = 0, mask = SOLID): void {
    if (!(hx > 0 && hy > 0) || !mask) return;
    const i = this.slot();
    this.shape[i] = BOX;
    this.px[i] = x;
    this.py[i] = y;
    this.hx[i] = hx;
    this.hy[i] = hy;
    this.cos[i] = Math.cos(yaw);
    this.sin[i] = Math.sin(yaw);
    this.base[i] = z;
    this.lo[i] = bottom;
    this.hi[i] = top;
    this.reach[i] = Math.hypot(hx, hy);
    this.mask[i] = mask;
    this.index(i, true);
  }

  /**
   * A batch of colliders, each standing on the ground at its own place. Returns the batch's id. Unless `mask`
   * says otherwise, they stop walkers and the camera, and the line of sight too where they're wider than
   * `thin` metres (a post, a mast or a trunk is dissolved by the dither instead).
   */
  add(list: readonly Collider[], ground?: (x: number, y: number) => number, mask = SOLID, thin = 0.5): number {
    this.open();
    for (const c of list) {
      const z = ground ? ground(c.x, c.y) : 0;
      const wide = !c.seeThrough && (c.kind === "circle" ? c.r > thin : Math.min(c.hx, c.hy) > thin / 2 && Math.max(c.hx, c.hy) > thin);
      const m = (c.stops === "camera" ? mask & ~WALK : c.stops === "walkers" ? mask & WALK : mask) & (wide ? SOLID : ~SIGHT);
      if (c.kind === "circle") this.circle(c.x, c.y, c.r, z, c.top, c.bottom, m);
      else this.box(c.x, c.y, c.hx, c.hy, c.yaw, z, c.top, c.bottom, m);
    }
    return this.close();
  }

  /** Takes a batch away. */
  remove(batch: number): void {
    let i = this.heads.get(batch) ?? -1;
    if (i < 0) return;
    this.heads.delete(batch);
    while (i >= 0) {
      const next = this.link[i]!;
      this.index(i, false);
      this.shape[i] = 0;
      this.mask[i] = 0;
      this.spare.push(i);
      this.size--;
      i = next;
    }
    this.version++;
  }

  private slot(): number {
    if (this.openHead === -2) throw new Error("solids are added in batches: open() first");
    let i = this.spare.pop();
    if (i === undefined) {
      i = this.high++;
      if (i === this.shape.length) this.grow();
    }
    this.link[i] = this.openHead;
    this.openHead = i;
    this.mark[i] = 0;
    this.size++;
    return i;
  }

  private grow(): void {
    const n = this.shape.length * 2;
    const f64 = (a: Float64Array) => {
      const b = new Float64Array(n);
      b.set(a);
      return b;
    };
    const i32 = (a: Int32Array) => {
      const b = new Int32Array(n);
      b.set(a);
      return b;
    };
    const u8 = (a: Uint8Array) => {
      const b = new Uint8Array(n);
      b.set(a);
      return b;
    };
    this.shape = u8(this.shape);
    this.mask = u8(this.mask);
    this.px = f64(this.px);
    this.py = f64(this.py);
    this.hx = f64(this.hx);
    this.hy = f64(this.hy);
    this.cos = f64(this.cos);
    this.sin = f64(this.sin);
    this.base = f64(this.base);
    this.lo = f64(this.lo);
    this.hi = f64(this.hi);
    this.reach = f64(this.reach);
    this.link = i32(this.link);
    this.mark = i32(this.mark);
  }

  /** Puts a solid into (or takes it out of) every cell its bounds touch. */
  private index(i: number, on: boolean): void {
    let ex = this.hx[i]!;
    let ey = this.hy[i]!;
    if (this.shape[i] === BOX) {
      const c = Math.abs(this.cos[i]!);
      const s = Math.abs(this.sin[i]!);
      const bx = ex * c + ey * s;
      ey = ex * s + ey * c;
      ex = bx;
    }
    const x0 = Math.floor((this.px[i]! - ex) / CELL);
    const x1 = Math.floor((this.px[i]! + ex) / CELL);
    const y0 = Math.floor((this.py[i]! - ey) / CELL);
    const y1 = Math.floor((this.py[i]! + ey) / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const k = key(cx, cy);
        let b = this.cells.get(k);
        if (on) {
          if (!b) {
            b = this.pool.pop() ?? { n: 0, items: new Int32Array(8) };
            this.cells.set(k, b);
          }
          if (b.n === b.items.length) {
            const items = new Int32Array(b.n * 2);
            items.set(b.items);
            b.items = items;
          }
          b.items[b.n++] = i;
        } else if (b) {
          for (let j = 0; j < b.n; j++) {
            if (b.items[j] !== i) continue;
            b.items[j] = b.items[--b.n]!;
            break;
          }
          if (b.n === 0) {
            this.cells.delete(k);
            this.pool.push(b);
          }
        }
      }
    }
  }

  // ---------- gathering ----------

  /** Every solid whose cells the rectangle touches, once each, appended to `found` from n. */
  private scan(minX: number, minY: number, maxX: number, maxY: number, n: number): number {
    const x0 = Math.floor(minX / CELL);
    const x1 = Math.floor(maxX / CELL);
    const y0 = Math.floor(minY / CELL);
    const y1 = Math.floor(maxY / CELL);
    const tick = this.tick;
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const b = this.cells.get(key(cx, cy));
        if (!b) continue;
        for (let j = 0; j < b.n; j++) {
          const i = b.items[j]!;
          if (this.mark[i] === tick) continue;
          this.mark[i] = tick;
          if (n === this.found.length) {
            const found = new Int32Array(n * 2);
            found.set(this.found);
            this.found = found;
          }
          this.found[n++] = i;
        }
      }
    }
    return n;
  }

  /** The solids near a rectangle: into `found`; returns (and sets) `count`. */
  around(minX: number, minY: number, maxX: number, maxY: number): number {
    this.tick++;
    this.count = this.scan(minX, minY, maxX, maxY, 0);
    return this.count;
  }

  /** The solids within `pad` of a segment (a long one is walked in pieces, so only cells near it are looked in). */
  along(ax: number, ay: number, bx: number, by: number, pad: number): number {
    this.tick++;
    const len = Math.hypot(bx - ax, by - ay);
    const pieces = Math.max(1, Math.ceil(len / (CELL * 2)));
    let n = 0;
    for (let k = 0; k < pieces; k++) {
      const x0 = ax + ((bx - ax) * k) / pieces;
      const y0 = ay + ((by - ay) * k) / pieces;
      const x1 = ax + ((bx - ax) * (k + 1)) / pieces;
      const y1 = ay + ((by - ay) * (k + 1)) / pieces;
      n = this.scan(Math.min(x0, x1) - pad, Math.min(y0, y1) - pad, Math.max(x0, x1) + pad, Math.max(y0, y1) + pad, n);
    }
    this.count = n;
    return n;
  }

  // ---------- the camera's view of them ----------

  private viewX = Number.NaN;
  private viewY = Number.NaN;
  private camX = Number.NaN;
  private camY = Number.NaN;
  private camPad = 0;

  /**
   * The camera's questions (its arm and its moves: `span`, `slide3`, `blocked3` and those built on them) see
   * whatever stands above its ground (a deck, eaves, a crown, a lookout) as reaching down to the ground, unless it's
   * over (x, y), where he is, or the camera, a ball of radius `pad` at (cx, cy), is under it or within its reach
   * (it's on its way out from under what he's left; coming from outside, it stops farther off than that): the camera
   * never goes under something he isn't under too, so it never wedges in the corner beneath. NaN: off (as solids
   * really are).
   */
  cameraAt(x: number, y: number, cx = Number.NaN, cy = Number.NaN, pad = 0): void {
    this.viewX = x;
    this.viewY = y;
    this.camX = cx;
    this.camY = cy;
    this.camPad = pad;
  }

  /** How far above its ground solid i's underside is, as the camera's questions see it. */
  private under(i: number): number {
    const lo = this.lo[i]!;
    if (lo <= 0 || Number.isNaN(this.viewX)) return lo;
    return this.gap(i, this.viewX, this.viewY) <= 0 || this.gap(i, this.camX, this.camY) < this.camPad ? lo : 0;
  }

  // ---------- one solid ----------

  /** How far (x, y) is outside a solid's footprint; negative inside it (by how deep). */
  gap(i: number, x: number, y: number): number {
    const dx = x - this.px[i]!;
    const dy = y - this.py[i]!;
    if (this.shape[i] === CIRCLE) return Math.hypot(dx, dy) - this.hx[i]!;
    const c = this.cos[i]!;
    const s = this.sin[i]!;
    const ox = Math.abs(dx * c + dy * s) - this.hx[i]!;
    const oy = Math.abs(-dx * s + dy * c) - this.hy[i]!;
    if (ox <= 0 && oy <= 0) return Math.max(ox, oy);
    return Math.hypot(Math.max(ox, 0), Math.max(oy, 0));
  }

  /** How far the point (x, y, z) is from a solid's volume, grown by `pad` all round: 0 inside. */
  far(i: number, x: number, y: number, z: number, pad = 0): number {
    const side = Math.max(0, this.gap(i, x, y) - pad);
    const under = this.base[i]! + this.lo[i]! - pad - z;
    const over = z - (this.base[i]! + this.hi[i]! + pad);
    const up = under > 0 ? under : over > 0 ? over : 0;
    return up === 0 ? side : side === 0 ? up : Math.hypot(side, up);
  }

  /**
   * Where the walker asking stands (world z: its feet), or NaN: on each solid's own ground, as walkers that keep to
   * the land ask. One that climbs (Galahad: Walker) sets it round its own questions, and clears it after.
   */
  floor = Number.NaN;

  /**
   * True when a solid stands in the way of a walker `height` tall that steps up `step`: its top is more than a step
   * above the walker's feet, and its underside lower than its head (on its own ground, or the walker's `floor`).
   */
  blocks(i: number, step: number, height: number): boolean {
    if (!(this.mask[i]! & WALK)) return false;
    if (Number.isNaN(this.floor)) return this.hi[i]! > step && this.lo[i]! < height;
    const base = this.base[i]!;
    return base + this.hi[i]! > this.floor + step && base + this.lo[i]! < this.floor + height;
  }

  /**
   * What a walker whose feet are at z, stepping up to `step`, stands on at (x, y): the top of the highest thing
   * walkers meet under that point that's no more than a step above its feet (a tread, a deck, a flat rock); −Infinity:
   * nothing (it's on the land). With `r`, under any part of a circle that wide: what a foot is already up on.
   */
  support(x: number, y: number, z: number, step: number, r = 0): number {
    const n = this.around(x - r, y - r, x + r, y + r);
    let top = Number.NEGATIVE_INFINITY;
    for (let k = 0; k < n; k++) {
      const i = this.found[k]!;
      if (!(this.mask[i]! & WALK)) continue;
      const t = this.base[i]! + this.hi[i]!;
      if (t > z + step || t <= top || this.gap(i, x, y) > (r > 0 ? r - SKIN * 2 : 0)) continue;
      top = t;
    }
    return top;
  }

  /** The way out of solid i for a circle of radius r at (x, y): a push into (nX, nY) of the length returned (0: not touching). */
  private push(i: number, x: number, y: number, r: number): number {
    const dx = x - this.px[i]!;
    const dy = y - this.py[i]!;
    if (this.shape[i] === CIRCLE) {
      const R = this.hx[i]! + r;
      const d = Math.hypot(dx, dy);
      if (d >= R - 1e-7) return 0;
      if (d > 1e-9) {
        nX = dx / d;
        nY = dy / d;
      } else {
        nX = 1;
        nY = 0;
      }
      return R - d;
    }
    const c = this.cos[i]!;
    const s = this.sin[i]!;
    const lx = dx * c + dy * s;
    const ly = -dx * s + dy * c;
    const hx = this.hx[i]!;
    const hy = this.hy[i]!;
    const qx = lx < -hx ? -hx : lx > hx ? hx : lx;
    const qy = ly < -hy ? -hy : ly > hy ? hy : ly;
    const ox = lx - qx;
    const oy = ly - qy;
    const d2 = ox * ox + oy * oy;
    if (d2 >= (r - 1e-7) * (r - 1e-7)) return 0;
    let ux: number;
    let uy: number;
    let depth: number;
    if (d2 > 1e-18) {
      const d = Math.sqrt(d2);
      ux = ox / d;
      uy = oy / d;
      depth = r - d;
    } else if (hx - Math.abs(lx) < hy - Math.abs(ly)) {
      ux = lx >= 0 ? 1 : -1;
      uy = 0;
      depth = hx - Math.abs(lx) + r;
    } else {
      ux = 0;
      uy = ly >= 0 ? 1 : -1;
      depth = hy - Math.abs(ly) + r;
    }
    nX = ux * c - uy * s;
    nY = ux * s + uy * c;
    return depth;
  }

  // ---------- questions ----------

  /** True when a circle of radius r at (x, y) touches a solid that stands in the way of something `height` tall stepping over `step`. */
  overlaps(x: number, y: number, r: number, step = 0, height = Infinity): boolean {
    const n = this.around(x - r, y - r, x + r, y + r);
    for (let k = 0; k < n; k++) {
      const i = this.found[k]!;
      if (this.blocks(i, step, height) && this.gap(i, x, y) < r - 1e-7) return true;
    }
    return false;
  }

  /**
   * How far (x, y) is from the nearest solid in the way (negative inside one), looking no farther than `range`
   * (Infinity: nothing that near). `hit` is that solid.
   */
  nearest(x: number, y: number, range: number, step = 0, height = Infinity): number {
    const n = this.around(x - range, y - range, x + range, y + range);
    let best = Infinity;
    this.hit = NOTHING;
    for (let k = 0; k < n; k++) {
      const i = this.found[k]!;
      if (!this.blocks(i, step, height)) continue;
      const d = this.gap(i, x, y);
      if (d < best) {
        best = d;
        this.hit = i;
      }
    }
    return best <= range ? best : Infinity;
  }

  /** True when the point (x, y, z) is inside a solid's volume grown by `pad`, of those the camera keeps out of (z is the world's, as the solids' grounds are). */
  inside(x: number, y: number, z: number, pad = 0): boolean {
    const n = this.around(x - pad, y - pad, x + pad, y + pad);
    for (let k = 0; k < n; k++) {
      const i = this.found[k]!;
      if (this.mask[i]! & VIEW && this.far(i, x, y, z, pad) === 0) return true;
    }
    return false;
  }

  /**
   * The camera's arm from A to B (world, z up): the share of the way (0..1) it can have. Its line of sight, a
   * thin ball of radius `sight`, is blocked where it first meets a SIGHT solid ahead (one round or over A
   * doesn't count: it can only leave it, and it dissolves); and the camera, a ball of radius `room`, never ends inside a VIEW solid (a
   * trunk, a post, a crown, a wall): with B inside one, it backs off to where the arm enters it (0 if it starts
   * in it). With `inside`, only the camera's room counts. With `soft`, the camera's room is kept from wherever
   * the arm first enters one round something that blocks the view (the comfortable distance it eases to), not
   * only round B. 1 when nothing stops
   * it; `hit` is what did. Boxes are grown with square corners here: a little room to spare.
   */
  view(ax: number, ay: number, az: number, bx: number, by: number, bz: number, sight: number, room = sight, inside = false, soft = false): number {
    const n = this.along(ax, ay, bx, by, Math.max(sight, room) * Math.SQRT2);
    let best = 1;
    this.hit = NOTHING;
    for (let k = 0; k < n; k++) {
      const i = this.found[k]!;
      const mask = this.mask[i]!;
      if (!(mask & VIEW)) continue;
      const kept = soft && (mask & SIGHT) !== 0;
      if (this.span(i, ax, ay, az, bx - ax, by - ay, bz - az, room) && (spanOut >= 1 || (kept && spanIn > 0))) {
        const t = Math.max(0, spanIn);
        if (t < best && (spanIn > 0 || !soft)) {
          best = t;
          this.hit = i;
        }
      }
      if (inside || !(mask & SIGHT) || this.gap(i, ax, ay) < sight) continue;
      if (this.span(i, ax, ay, az, bx - ax, by - ay, bz - az, sight) && spanIn > 0 && spanIn < best) {
        best = spanIn;
        this.hit = i;
      }
    }
    return best;
  }

  /**
   * Along the camera's arm from A to B: the share (from `lo`) where a ball of radius `room` first meets a VIEW solid
   * (1 when it meets none): how far out it can go without passing anything. One it's leaving by `lo` doesn't count.
   */
  firstAlong(ax: number, ay: number, az: number, bx: number, by: number, bz: number, room: number, lo: number): number {
    const n = this.along(ax, ay, bx, by, room * Math.SQRT2);
    let best = 1;
    for (let k = 0; k < n; k++) {
      const i = this.found[k]!;
      if (!(this.mask[i]! & VIEW) || !this.span(i, ax, ay, az, bx - ax, by - ay, bz - az, room) || spanOut <= lo) continue;
      if (spanIn < best) best = Math.max(lo, spanIn);
    }
    return best;
  }

  /**
   * Along the camera's arm from A to B: the share (lo..hi) nearest `want` where a ball of radius `room` is
   * inside no VIEW solid, or −1 if there's none. Allocates nothing (the spans are kept in the world's scratch).
   */
  clearAlong(ax: number, ay: number, az: number, bx: number, by: number, bz: number, room: number, want: number, lo: number, hi: number): number {
    const n = this.along(ax, ay, bx, by, room * Math.SQRT2);
    let m = 0;
    const spans = this.spans;
    for (let k = 0; k < n && m < spans.length / 2; k++) {
      const i = this.found[k]!;
      if (!(this.mask[i]! & VIEW) || !this.span(i, ax, ay, az, bx - ax, by - ay, bz - az, room)) continue;
      if (spanOut <= lo || spanIn >= hi) continue;
      // Kept in order of where they begin (there are only a few).
      let j = m++;
      while (j > 0 && spans[(j - 1) * 2]! > spanIn) {
        spans[j * 2] = spans[(j - 1) * 2]!;
        spans[j * 2 + 1] = spans[(j - 1) * 2 + 1]!;
        j--;
      }
      spans[j * 2] = spanIn;
      spans[j * 2 + 1] = spanOut;
    }
    // Walk the gaps between them (within lo..hi) and keep the point nearest `want`.
    let best = -1;
    let bestD = Infinity;
    let from = lo;
    for (let k = 0; k <= m; k++) {
      // The gap before span k (or after the last one).
      const end = k < m ? Math.min(spans[k * 2]!, hi) : hi;
      if (end >= from && (k === m || spans[k * 2]! > from)) {
        const t = want < from ? from : want > end ? end : want;
        const d = Math.abs(t - want);
        if (d < bestD) {
          bestD = d;
          best = t;
        }
      }
      if (k < m && spans[k * 2 + 1]! > from) from = spans[k * 2 + 1]!;
      if (from > hi) break;
    }
    return best;
  }

  /**
   * True when a ball of radius `pad` at (x, y, z) is inside a solid the camera keeps out of (VIEW), each grown by
   * `pad` with square corners, as the camera's other questions grow them.
   */
  blocked3(x: number, y: number, z: number, pad: number): boolean {
    const reach = pad * Math.SQRT2;
    const n = this.around(x - reach, y - reach, x + reach, y + reach);
    for (let k = 0; k < n; k++) {
      const i = this.found[k]!;
      if (!(this.mask[i]! & VIEW)) continue;
      const base = this.base[i]!;
      if (z <= base + this.under(i) - pad || z >= base + this.hi[i]! + pad) continue;
      const dx = x - this.px[i]!;
      const dy = y - this.py[i]!;
      if (this.shape[i] === CIRCLE) {
        const R = this.hx[i]! + pad;
        if (dx * dx + dy * dy < R * R) return true;
        continue;
      }
      const c = this.cos[i]!;
      const s = this.sin[i]!;
      if (Math.abs(dx * c + dy * s) < this.hx[i]! + pad && Math.abs(-dx * s + dy * c) < this.hy[i]! + pad) return true;
    }
    return false;
  }

  /**
   * A ball of radius `pad` at (x, y, z) that's inside something the camera keeps out of, moved out the shortest way
   * (through a side, the top or the underside of each, a few times over): into `out`; true when it ends clear.
   */
  pushOut3(x: number, y: number, z: number, pad: number, out: { x: number; y: number; z: number }): boolean {
    for (let pass = 0; pass < 4; pass++) {
      if (!this.blocked3(x, y, z, pad)) {
        out.x = x;
        out.y = y;
        out.z = z;
        return true;
      }
      const n = this.count;
      for (let k = 0; k < n; k++) {
        const i = this.found[k]!;
        if (!(this.mask[i]! & VIEW)) continue;
        const below = z - (this.base[i]! + this.under(i) - pad);
        const above = this.base[i]! + this.hi[i]! + pad - z;
        if (below <= 0 || above <= 0) continue;
        let depth = below;
        let wx = 0;
        let wy = 0;
        let wz = -1;
        if (above < depth) {
          depth = above;
          wz = 1;
        }
        const dx = x - this.px[i]!;
        const dy = y - this.py[i]!;
        if (this.shape[i] === CIRCLE) {
          const d = Math.hypot(dx, dy);
          const side = this.hx[i]! + pad - d;
          if (side <= 0) continue;
          if (side < depth && d > 1e-9) {
            depth = side;
            wx = dx / d;
            wy = dy / d;
            wz = 0;
          }
        } else {
          const c = this.cos[i]!;
          const s = this.sin[i]!;
          const lx = dx * c + dy * s;
          const ly = -dx * s + dy * c;
          const sx = this.hx[i]! + pad - Math.abs(lx);
          const sy = this.hy[i]! + pad - Math.abs(ly);
          if (sx <= 0 || sy <= 0) continue;
          if (sx < depth) {
            depth = sx;
            const u = lx >= 0 ? 1 : -1;
            wx = u * c;
            wy = u * s;
            wz = 0;
          }
          if (sy < depth) {
            depth = sy;
            const u = ly >= 0 ? 1 : -1;
            wx = -u * s;
            wy = u * c;
            wz = 0;
          }
        }
        x += wx * (depth + SKIN);
        y += wy * (depth + SKIN);
        z += wz * (depth + SKIN);
        break;
      }
    }
    out.x = x;
    out.y = y;
    out.z = z;
    return !this.blocked3(x, y, z, pad);
  }

  /** How far along the segment from A to B (0..1) it leaves solid i grown by `pad` (0: it's never inside it). */
  leaves(i: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, pad: number): number {
    return this.span(i, ax, ay, az, bx - ax, by - ay, bz - az, pad) ? Math.min(1, spanOut) : 0;
  }

  /** Where the line from (ax, ay, az) along (dx, dy, dz) is inside solid i grown by `pad`: into spanIn..spanOut (shares of (dx, dy, dz)); false if nowhere ahead. */
  private span(i: number, ax: number, ay: number, az: number, dx: number, dy: number, dz: number, pad: number): boolean {
    let enter = Number.NEGATIVE_INFINITY;
    let exit = Number.POSITIVE_INFINITY;
    // Level with it.
    const z0 = this.base[i]! + this.under(i) - pad;
    const z1 = this.base[i]! + this.hi[i]! + pad;
    if (Math.abs(dz) < 1e-12) {
      if (az < z0 || az > z1) return false;
    } else {
      let u0 = (z0 - az) / dz;
      let u1 = (z1 - az) / dz;
      if (u0 > u1) {
        const swap = u0;
        u0 = u1;
        u1 = swap;
      }
      if (u0 > enter) enter = u0;
      if (u1 < exit) exit = u1;
    }
    // Over its footprint.
    const px = ax - this.px[i]!;
    const py = ay - this.py[i]!;
    if (this.shape[i] === CIRCLE) {
      const R = this.hx[i]! + pad;
      const a = dx * dx + dy * dy;
      const b = px * dx + py * dy;
      const c = px * px + py * py - R * R;
      if (a < 1e-12) {
        if (c > 0) return false;
      } else {
        const disc = b * b - a * c;
        if (disc < 0) return false;
        const root = Math.sqrt(disc);
        const t0 = (-b - root) / a;
        const t1 = (-b + root) / a;
        if (t0 > enter) enter = t0;
        if (t1 < exit) exit = t1;
      }
    } else {
      const cos = this.cos[i]!;
      const sin = this.sin[i]!;
      const lx = px * cos + py * sin;
      const ly = -px * sin + py * cos;
      const ldx = dx * cos + dy * sin;
      const ldy = -dx * sin + dy * cos;
      for (let axis = 0; axis < 2; axis++) {
        const p = axis ? ly : lx;
        const d = axis ? ldy : ldx;
        const e = (axis ? this.hy[i]! : this.hx[i]!) + pad;
        if (Math.abs(d) < 1e-12) {
          if (Math.abs(p) > e) return false;
          continue;
        }
        let t0 = (-e - p) / d;
        let t1 = (e - p) / d;
        if (t0 > t1) {
          const swap = t0;
          t0 = t1;
          t1 = swap;
        }
        if (t0 > enter) enter = t0;
        if (t1 < exit) exit = t1;
      }
    }
    if (enter > exit || exit < 0) return false;
    spanIn = enter;
    spanOut = exit;
    return true;
  }

  /**
   * Where a point moving from A along D first enters solid i grown by `pad` (square corners, as `span`): the
   * share of D (0..1), or NONE; sets the face it meets (nX, nY, nZ). One it starts inside doesn't stop it.
   */
  private enter(i: number, ax: number, ay: number, az: number, dx: number, dy: number, dz: number, pad: number): number {
    let enter = Number.NEGATIVE_INFINITY;
    let exit = Number.POSITIVE_INFINITY;
    // Which bound it crosses last on the way in: 0 the bottom or top, 1 the circle, 2 and 3 a box's own x and y.
    let face = -1;
    let sign = 0;
    const z0 = this.base[i]! + this.under(i) - pad;
    const z1 = this.base[i]! + this.hi[i]! + pad;
    if (Math.abs(dz) < 1e-12) {
      if (az <= z0 || az >= z1) return NONE;
    } else {
      const u0 = (z0 - az) / dz;
      const u1 = (z1 - az) / dz;
      enter = Math.min(u0, u1);
      exit = Math.max(u0, u1);
      face = 0;
      sign = dz > 0 ? -1 : 1;
    }
    const px = ax - this.px[i]!;
    const py = ay - this.py[i]!;
    if (this.shape[i] === CIRCLE) {
      const R = this.hx[i]! + pad;
      const a = dx * dx + dy * dy;
      const b = px * dx + py * dy;
      const c = px * px + py * py - R * R;
      if (a < 1e-12) {
        if (c >= 0) return NONE;
      } else {
        const disc = b * b - a * c;
        if (disc <= 0) return NONE;
        const root = Math.sqrt(disc);
        const t0 = (-b - root) / a;
        const t1 = (-b + root) / a;
        if (t0 > enter) {
          enter = t0;
          face = 1;
        }
        if (t1 < exit) exit = t1;
      }
    } else {
      const cos = this.cos[i]!;
      const sin = this.sin[i]!;
      const lx = px * cos + py * sin;
      const ly = -px * sin + py * cos;
      const ldx = dx * cos + dy * sin;
      const ldy = -dx * sin + dy * cos;
      for (let axis = 0; axis < 2; axis++) {
        const p = axis ? ly : lx;
        const d = axis ? ldy : ldx;
        const e = (axis ? this.hy[i]! : this.hx[i]!) + pad;
        if (Math.abs(d) < 1e-12) {
          if (Math.abs(p) >= e) return NONE;
          continue;
        }
        const t0 = (-e - p) / d;
        const t1 = (e - p) / d;
        const lo = Math.min(t0, t1);
        if (lo > enter) {
          enter = lo;
          face = 2 + axis;
          sign = d > 0 ? -1 : 1;
        }
        exit = Math.min(exit, Math.max(t0, t1));
      }
    }
    if (enter >= exit || enter > 1 || exit <= 0) return NONE;
    // Starting on its surface (within a skin, as a slide leaves it, or rounding does): stopped at once if heading
    // in through the face it's on. Deeper in, it's on its way out: nothing stops it.
    if (enter < 0 || face < 0) return this.onFace(i, ax, ay, az, dx, dy, dz, pad);
    if (face === 0) {
      nX = 0;
      nY = 0;
      nZ = sign;
    } else if (face === 1) {
      const R = this.hx[i]! + pad;
      nX = (px + dx * enter) / R;
      nY = (py + dy * enter) / R;
      nZ = 0;
    } else {
      const cos = this.cos[i]!;
      const sin = this.sin[i]!;
      const ux = face === 2 ? sign : 0;
      const uy = face === 3 ? sign : 0;
      nX = ux * cos - uy * sin;
      nY = ux * sin + uy * cos;
      nZ = 0;
    }
    return enter;
  }

  /** A point inside solid i grown by `pad` (square corners): 0 with the nearest face's normal if it's within a skin of it and heading in, else NONE. */
  private onFace(i: number, ax: number, ay: number, az: number, dx: number, dy: number, dz: number, pad: number): number {
    // The shallowest way out: through the bottom, the top, or a side.
    const below = az - (this.base[i]! + this.under(i) - pad);
    const above = this.base[i]! + this.hi[i]! + pad - az;
    let depth = below;
    let wx = 0;
    let wy = 0;
    let wz = -1;
    if (above < depth) {
      depth = above;
      wz = 1;
    }
    const px = ax - this.px[i]!;
    const py = ay - this.py[i]!;
    if (this.shape[i] === CIRCLE) {
      const d = Math.hypot(px, py);
      const side = this.hx[i]! + pad - d;
      if (side < depth && d > 1e-9) {
        depth = side;
        wx = px / d;
        wy = py / d;
        wz = 0;
      }
    } else {
      const cos = this.cos[i]!;
      const sin = this.sin[i]!;
      const lx = px * cos + py * sin;
      const ly = -px * sin + py * cos;
      const sx = this.hx[i]! + pad - Math.abs(lx);
      const sy = this.hy[i]! + pad - Math.abs(ly);
      if (sx < depth) {
        depth = sx;
        const ux = lx >= 0 ? 1 : -1;
        wx = ux * cos;
        wy = ux * sin;
        wz = 0;
      }
      if (sy < depth) {
        depth = sy;
        const uy = ly >= 0 ? 1 : -1;
        wx = -uy * sin;
        wy = uy * cos;
        wz = 0;
      }
    }
    if (depth > SKIN * 2 || dx * wx + dy * wy + dz * wz >= 0) return NONE;
    nX = wx;
    nY = wy;
    nZ = wz;
    return 0;
  }

  /**
   * The camera's move-and-slide: a ball of radius `pad` at (x, y, z) wants to move by (dx, dy, dz) among the
   * solids it keeps out of (VIEW). It goes as far as it can, slides along what it meets with what's left
   * (round a post, along a wall, under a deck, over a roof) and stops in a crease; it never enters anything,
   * so it never jumps through one either. Into `out`; true when it met something. Allocates nothing.
   */
  slide3(x: number, y: number, z: number, dx: number, dy: number, dz: number, pad: number, out: { x: number; y: number; z: number }): boolean {
    const len = Math.hypot(dx, dy, dz);
    const reach = pad * Math.SQRT2 + len + SKIN * 4;
    const n = this.around(x - reach, y - reach, x + reach, y + reach);
    let met = false;
    // Each leg is checked to end clear (a skin's push off one face can land in a neighbour's, in a tight corner): one
    // that doesn't is undone, and it stops there. (Unless it began inside something: then it's let out.)
    const checked = !this.amid(n, x, y, z, pad * 0.98);
    const wantX = dx;
    const wantY = dy;
    const wantZ = dz;
    // The faces met so far (a slide that turns back into one stops: a crease).
    let ax = 0;
    let ay = 0;
    let az = 0;
    let bx = 0;
    let by = 0;
    let bz = 0;
    for (let turn = 0; turn < 4; turn++) {
      const left = Math.hypot(dx, dy, dz);
      if (left < 1e-9) break;
      let best = NONE;
      let wx = 0;
      let wy = 0;
      let wz = 0;
      for (let k = 0; k < n; k++) {
        const i = this.found[k]!;
        if (!(this.mask[i]! & VIEW)) continue;
        const t = this.enter(i, x, y, z, dx, dy, dz, pad);
        if (t >= best) continue;
        best = t;
        wx = nX;
        wy = nY;
        wz = nZ;
      }
      if (best === NONE) {
        if (!checked || !this.amid(n, x + dx, y + dy, z + dz, pad * 0.98)) {
          x += dx;
          y += dy;
          z += dz;
        }
        break;
      }
      met = true;
      // Up to the face, and a skin off it (along its normal: a glancing approach would leave it touching).
      const fx = x + dx * best + wx * SKIN;
      const fy = y + dy * best + wy * SKIN;
      const fz = z + dz * best + wz * SKIN;
      if (checked && this.amid(n, fx, fy, fz, pad * 0.98)) break;
      x = fx;
      y = fy;
      z = fz;
      // What's left, along the face.
      let rx = dx * (1 - best);
      let ry = dy * (1 - best);
      let rz = dz * (1 - best);
      const into = rx * wx + ry * wy + rz * wz;
      if (into < 0) {
        rx -= wx * into;
        ry -= wy * into;
        rz -= wz * into;
      }
      // Turned back into the face met before: along the crease between the two instead.
      if (turn > 0 && rx * ax + ry * ay + rz * az < -1e-9) {
        let ex = ay * wz - az * wy;
        let ey = az * wx - ax * wz;
        let ez = ax * wy - ay * wx;
        const el = Math.hypot(ex, ey, ez);
        if (el < 1e-6) break;
        ex /= el;
        ey /= el;
        ez /= el;
        const along = rx * ex + ry * ey + rz * ez;
        rx = ex * along;
        ry = ey * along;
        rz = ez * along;
      }
      if (rx * wantX + ry * wantY + rz * wantZ <= 0 || (turn > 1 && rx * bx + ry * by + rz * bz < -1e-9)) break;
      bx = ax;
      by = ay;
      bz = az;
      ax = wx;
      ay = wy;
      az = wz;
      dx = rx;
      dy = ry;
      dz = rz;
    }
    out.x = x;
    out.y = y;
    out.z = z;
    return met;
  }

  /** True when (x, y, z) is inside one of the first `n` solids gathered in `found` that the camera keeps out of, each grown by `pad` (as blocked3, without gathering). */
  private amid(n: number, x: number, y: number, z: number, pad: number): boolean {
    for (let k = 0; k < n; k++) {
      const i = this.found[k]!;
      if (!(this.mask[i]! & VIEW)) continue;
      const base = this.base[i]!;
      if (z <= base + this.under(i) - pad || z >= base + this.hi[i]! + pad) continue;
      const dx = x - this.px[i]!;
      const dy = y - this.py[i]!;
      if (this.shape[i] === CIRCLE) {
        const R = this.hx[i]! + pad;
        if (dx * dx + dy * dy < R * R) return true;
        continue;
      }
      const c = this.cos[i]!;
      const s = this.sin[i]!;
      if (Math.abs(dx * c + dy * s) < this.hx[i]! + pad && Math.abs(-dx * s + dy * c) < this.hy[i]! + pad) return true;
    }
    return false;
  }

  /** The top of the tallest thing under (x, y) that's no higher than `step` above its ground (world z); −Infinity: none. */
  ledge(x: number, y: number, step: number): number {
    const n = this.around(x, y, x, y);
    let top = Number.NEGATIVE_INFINITY;
    for (let k = 0; k < n; k++) {
      const i = this.found[k]!;
      if (!(this.mask[i]! & WALK) || this.lo[i]! > 0 || this.hi[i]! > step || this.gap(i, x, y) > 0) continue;
      top = Math.max(top, this.base[i]! + this.hi[i]!);
    }
    return top;
  }

  /**
   * A circle of radius r swept from (x, y) by (dx, dy): the share of the way (0..1) it gets before it touches
   * a solid in its way (1: all of it). Something it already overlaps stops it only if it's heading farther in.
   * `hit`, `hitX` and `hitY` say what it met and the surface's normal there. `self` is the mover asking, if
   * one is (it's stopped by movers at least as heavy as itself, too).
   */
  sweep(x: number, y: number, dx: number, dy: number, r: number, step = 0, height = Infinity, self: Mover | null = null): number {
    this.along(x, y, x + dx, y + dy, r + SKIN);
    return this.first(x, y, dx, dy, r, step, height, self);
  }

  /** The sweep's narrow phase, over what was gathered. */
  private first(x: number, y: number, dx: number, dy: number, r: number, step: number, height: number, self: Mover | null): number {
    let best = 1;
    let bx = 0;
    let by = 0;
    this.hit = NOTHING;
    let touched = false;
    for (let k = 0; k < this.count; k++) {
      const i = this.found[k]!;
      if (!this.blocks(i, step, height)) continue;
      const px = x - this.px[i]!;
      const py = y - this.py[i]!;
      let t: number;
      let wx: number;
      let wy: number;
      if (this.shape[i] === CIRCLE) {
        t = rayCircle(px, py, dx, dy, this.hx[i]! + r);
        if (t === NONE) continue;
        wx = nX;
        wy = nY;
      } else {
        const c = this.cos[i]!;
        const s = this.sin[i]!;
        t = rayBox(px * c + py * s, -px * s + py * c, dx * c + dy * s, -dx * s + dy * c, this.hx[i]!, this.hy[i]!, r);
        if (t === NONE) continue;
        wx = nX * c - nY * s;
        wy = nX * s + nY * c;
      }
      if (t > best || (t === best && touched)) continue;
      if (this.passes && this.passing(i)) continue;
      best = t;
      bx = wx;
      by = wy;
      this.hit = i;
      touched = true;
    }
    if (self) {
      const list = this.movers;
      for (let j = 0; j < list.length; j++) {
        const m = list[j]!;
        if (m === self || m.mass < self.mass || !(m.at.r > 0)) continue;
        const px = x - m.at.x;
        const py = y - m.at.y;
        const R = m.at.r + r;
        const far = R + Math.abs(dx) + Math.abs(dy);
        if (px > far || px < -far || py > far || py < -far) continue;
        const t = rayCircle(px, py, dx, dy, R);
        if (t === NONE || t > best || (t === best && touched)) continue;
        best = t;
        bx = nX;
        by = nY;
        this.hit = -2 - j;
        touched = true;
      }
    }
    this.hitX = bx;
    this.hitY = by;
    return touched ? best : 1;
  }

  private passing(i: number): boolean {
    for (let k = 0; k < this.passes; k++) if (this.pass[k] === i) return true;
    return false;
  }

  // ---------- moving ----------

  /**
   * Move-and-slide: a circle of radius r at (x, y) wants to go by (dx, dy). It goes as far as it can, slides
   * along what it meets with what's left of the step (stopping in a corner), and is pushed out of anything it
   * ended up touching. Writes where it ends into `out`; true when it met something.
   */
  slide(x: number, y: number, dx: number, dy: number, r: number, step: number, height: number, out: { x: number; y: number }, self: Mover | null = null): boolean {
    const len = Math.hypot(dx, dy);
    const pad = r + len + SKIN * 4;
    this.around(Math.min(x, x + dx) - pad, Math.min(y, y + dy) - pad, Math.max(x, x + dx) + pad, Math.max(y, y + dy) + pad);
    let met = false;
    // Where it meant to go, and the surfaces met so far: a slide that would turn back into one of them, or against
    // where it was going, stops instead (a corner; otherwise it would shuffle to and fro in the crease).
    const wantX = dx;
    const wantY = dy;
    let ax = 0;
    let ay = 0;
    let bx = 0;
    let by = 0;
    for (let turn = 0; turn < 4; turn++) {
      const left = Math.hypot(dx, dy);
      if (left < 1e-9) break;
      const t = this.first(x, y, dx, dy, r, step, height, self);
      if (this.hit === NOTHING) {
        x += dx;
        y += dy;
        break;
      }
      met = true;
      const go = Math.max(0, t - SKIN / left);
      x += dx * go;
      y += dy * go;
      const wx = this.hitX;
      const wy = this.hitY;
      // What's left of the step, along the surface.
      let rx = dx * (1 - t);
      let ry = dy * (1 - t);
      const into = rx * wx + ry * wy;
      if (into < 0) {
        rx -= wx * into;
        ry -= wy * into;
      }
      if (rx * wantX + ry * wantY <= 0 || (turn > 0 && rx * ax + ry * ay < -1e-9) || (turn > 1 && rx * bx + ry * by < -1e-9)) break;
      bx = ax;
      by = ay;
      ax = wx;
      ay = wy;
      dx = rx;
      dy = ry;
    }
    // Out of whatever it touches all the same (something grew there, or pushed it).
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (let k = 0; k < this.count; k++) {
        const i = this.found[k]!;
        if (!this.blocks(i, step, height)) continue;
        const depth = this.push(i, x, y, r);
        if (depth <= 0) continue;
        x += nX * (depth + SKIN / 2);
        y += nY * (depth + SKIN / 2);
        moved = true;
        met = true;
      }
      if (self) {
        const list = this.movers;
        for (let j = 0; j < list.length; j++) {
          const m = list[j]!;
          if (m === self || m.mass < self.mass || !(m.at.r > 0)) continue;
          const px = x - m.at.x;
          const py = y - m.at.y;
          const R = m.at.r + r;
          const d2 = px * px + py * py;
          if (d2 >= (R - 1e-7) * (R - 1e-7)) continue;
          // Equals share the way out (each moves half, in its own turn); the lighter gives all of it.
          const share = m.mass > self.mass ? 1 : 0.5;
          const d = Math.sqrt(d2);
          const ux = d > 1e-9 ? px / d : Math.cos(self.index * 2.4);
          const uy = d > 1e-9 ? py / d : Math.sin(self.index * 2.4);
          x += ux * (R - d + SKIN / 2) * share;
          y += uy * (R - d + SKIN / 2) * share;
          moved = true;
          met = true;
        }
      }
      if (!moved) break;
    }
    // Solids have the last word: a push out of a heavier walker never leaves it inside one (it may still touch the
    // walker, which separate() parts next).
    for (let k = 0; k < this.count; k++) {
      const i = this.found[k]!;
      if (!this.blocks(i, step, height)) continue;
      const depth = this.push(i, x, y, r);
      if (depth <= 0) continue;
      x += nX * (depth + SKIN / 2);
      y += nY * (depth + SKIN / 2);
    }
    out.x = x;
    out.y = y;
    return met;
  }

  /** A walker joins the world: `at` is its place, kept by its owner; the mover is how it moves. */
  join(at: Circle, build: Build): Mover {
    const m = new Mover(this, this.movers.length, at, build);
    this.movers.push(m);
    return m;
  }

  /**
   * After everyone has moved: movers that overlap are parted. The lighter gives way (two of a weight share
   * it), sliding along whatever solid it's pushed against, and squeezing out sideways if it's pinned.
   *
   * Each mover is tried against those after it, in the order they joined. Among a handful that's every pair.
   * Among many (a whole ecosystem's walkers: every pair of a thousand is half a million looks a frame, which
   * measured 6 ms; of three thousand, 65 ms) each is tried only against those in the cells of a 4 m grid round
   * it, still in that order, so the outcome is the same: `everyPair` asks for the plain way, and a test holds the
   * two to the same places. (A mover shoved more than two metres in one round could be missed until the next:
   * nothing here is ever that deep in another.)
   */
  separate(everyPair = false): void {
    const list = this.movers;
    const n = list.length;
    if (this.sepThere.length < n) {
      this.sepThere = new Int32Array(n * 2);
      this.sepChain = new Int32Array(n * 2);
      this.sepWide = new Int32Array(n * 2);
    }
    const there = this.sepThere;
    for (let round = 0; round < 2; round++) {
      let any = false;
      // Who's there (away, a mover has no radius), and how many of them are too wide for a cell.
      let m = 0;
      let wides = 0;
      for (let a = 0; a < n; a++) {
        const r = list[a]!.at.r;
        if (!(r > 0)) continue;
        there[m++] = a;
        if (r > WIDE) this.sepWide[wides++] = a;
      }
      if (everyPair || m <= FEW) {
        for (let i = 0; i < m; i++) {
          const a = there[i]!;
          for (let j = i + 1; j < m; j++) if (this.part(a, there[j]!)) any = true;
        }
      } else {
        // The grid: each narrow mover in its cell's chain (the last to join at its head).
        let size = 64;
        while (size < m * 2) size *= 2;
        if (this.sepHeads.length < size) this.sepHeads = new Int32Array(size);
        const heads = this.sepHeads;
        heads.fill(-1, 0, size);
        const mask = size - 1;
        const chain = this.sepChain;
        for (let i = 0; i < m; i++) {
          const a = there[i]!;
          const at = list[a]!.at;
          if (at.r > WIDE) continue;
          const h = (Math.imul(Math.floor(at.x / CELL_M), 73856093) ^ Math.imul(Math.floor(at.y / CELL_M), 19349663)) & mask;
          chain[a] = heads[h]!;
          heads[h] = a;
        }
        const cells = this.sepCells;
        for (let i = 0; i < m; i++) {
          const a = there[i]!;
          const at = list[a]!.at;
          let found = 0;
          if (at.r > WIDE) {
            // Too wide for a cell: everyone after it.
            for (let j = i + 1; j < m; j++) found = this.nearby(found, there[j]!);
          } else {
            // The nine cells round where it is now (each once, should two share a place in the table), and the wide ones.
            const cx = Math.floor(at.x / CELL_M);
            const cy = Math.floor(at.y / CELL_M);
            let looked = 0;
            for (let oy = -1; oy <= 1; oy++) {
              for (let ox = -1; ox <= 1; ox++) {
                const h = (Math.imul(cx + ox, 73856093) ^ Math.imul(cy + oy, 19349663)) & mask;
                let seen = false;
                for (let k = 0; k < looked; k++) if (cells[k] === h) seen = true;
                if (seen) continue;
                cells[looked++] = h;
                for (let b = heads[h]!; b >= 0; b = chain[b]!) if (b > a) found = this.nearby(found, b);
              }
            }
            for (let k = 0; k < wides; k++) if (this.sepWide[k]! > a) found = this.nearby(found, this.sepWide[k]!);
          }
          // In the order they joined, as every pair would have it.
          const near = this.sepNear;
          for (let k = 1; k < found; k++) {
            const b = near[k]!;
            let j = k - 1;
            for (; j >= 0 && near[j]! > b; j--) near[j + 1] = near[j]!;
            near[j + 1] = b;
          }
          for (let k = 0; k < found; k++) if (this.part(a, near[k]!)) any = true;
        }
      }
      if (!any) break;
    }
  }

  /** One more for separate() to try (its list grows as it must). */
  private nearby(found: number, b: number): number {
    if (found === this.sepNear.length) {
      const grown = new Int32Array(found * 2);
      grown.set(this.sepNear);
      this.sepNear = grown;
    }
    this.sepNear[found] = b;
    return found + 1;
  }

  /** Parts movers `a` and `b` (a joined first) if they overlap; whether they did. */
  private part(a: number, b: number): boolean {
    const A = this.movers[a]!;
    const B = this.movers[b]!;
    const dx = B.at.x - A.at.x;
    const dy = B.at.y - A.at.y;
    const R = A.at.r + B.at.r;
    if (dx > R || dx < -R || dy > R || dy < -R) return false;
    const d2 = dx * dx + dy * dy;
    if (d2 >= (R - 1e-6) * (R - 1e-6)) return false;
    const d = Math.sqrt(d2);
    const ux = d > 1e-9 ? dx / d : Math.cos(a * 2.4 + b);
    const uy = d > 1e-9 ? dy / d : Math.sin(a * 2.4 + b);
    const over = R - d + SKIN;
    if (A.mass > B.mass) {
      this.shove(B, ux, uy, over, A);
      this.yieldTo(A, B);
    } else if (B.mass > A.mass) {
      this.shove(A, -ux, -uy, over, B);
      this.yieldTo(B, A);
    } else {
      this.shove(B, ux, uy, over / 2, A);
      this.shove(A, -ux, -uy, over / 2, B);
    }
    return true;
  }

  /** The lighter couldn't get out of the way (pinned, or the only way out is water): the heavier stops short instead. */
  private yieldTo(heavy: Mover, light: Mover): void {
    if (heavy.mass >= FIXED) return;
    const dx = heavy.at.x - light.at.x;
    const dy = heavy.at.y - light.at.y;
    const R = heavy.at.r + light.at.r;
    const d = Math.hypot(dx, dy);
    if (R - d <= 1e-4 || d < 1e-9) return;
    this.shove(heavy, dx / d, dy / d, R - d + SKIN, light);
  }

  /** Moves a mover by `over` along (ux, uy), out of `from`; pinned against something solid, it goes sideways instead. */
  private shove(m: Mover, ux: number, uy: number, over: number, from: Mover): void {
    const at = m.at;
    const spot = this.spot;
    // Only what's solid stops a shove (other movers are parted in their own turn), and ground it won't stand on.
    this.slide(at.x, at.y, ux * over, uy * over, at.r, m.step, m.height, spot);
    if (!m.ground?.(spot.x, spot.y)) {
      at.x = spot.x;
      at.y = spot.y;
    }
    const R = at.r + from.at.r;
    const left = R - Math.hypot(at.x - from.at.x, at.y - from.at.y);
    if (left <= 1e-4) return;
    // Pinned: round its pusher, whichever way opens (the same way every time for a pair, so it doesn't dither).
    const side = (m.index + from.index) % 2 === 0 ? 1 : -1;
    let bestX = at.x;
    let bestY = at.y;
    let best = left;
    for (let k = 0; k < 2; k++) {
      const s = k === 0 ? side : -side;
      const reach = Math.min(R, left * 2 + 0.05);
      this.slide(at.x, at.y, -uy * s * reach, ux * s * reach, at.r, m.step, m.height, spot);
      if (m.ground?.(spot.x, spot.y)) continue;
      const still = R - Math.hypot(spot.x - from.at.x, spot.y - from.at.y);
      if (still < best - 1e-6) {
        best = still;
        bestX = spot.x;
        bestY = spot.y;
        break;
      }
    }
    at.x = bestX;
    at.y = bestY;
  }
}

/** A mover this heavy is never moved by the others (a site's machine: its place is its own). */
const FIXED = 1e8;

/** A walker in the world of solids: its place (`at`), its build, and how it moves. */
/** separate(): up to this many movers there, every pair is tried; a cell of its grid, metres; a mover wider than this (its radius) isn't put in a cell. */
const FEW = 24;
const CELL_M = 4;
const WIDE = 1;

export class Mover {
  /** True when its last slide met something. */
  touched = false;
  /** Ground it won't be pushed onto (water, a plot), if any. */
  ground: ((x: number, y: number) => boolean) | null = null;
  readonly mass: number;
  readonly step: number;
  readonly height: number;

  constructor(
    readonly solids: Solids,
    readonly index: number,
    readonly at: Circle,
    build: Build,
  ) {
    this.mass = build.mass;
    this.step = build.step;
    this.height = build.height;
  }

  /** Its radius (its place's: 0 while it's away). */
  get r(): number {
    return this.at.r;
  }

  /** From (x, y), a step of (dx, dy), slid along whatever is in the way (solids, and movers no lighter than itself): into `out`. */
  slide(x: number, y: number, dx: number, dy: number, out: { x: number; y: number }): boolean {
    this.touched = this.solids.slide(x, y, dx, dy, this.at.r, this.step, this.height, out, this);
    return this.touched;
  }

  /** How much of the way from (x, y) by (dx, dy) is clear for it, `grow` metres wider than it is (see Solids.sweep). */
  sweep(x: number, y: number, dx: number, dy: number, grow = 0, others = true): number {
    return this.solids.sweep(x, y, dx, dy, this.at.r + grow, this.step, this.height, others ? this : null);
  }

  /** True where it could stand: nothing solid there, with `grow` metres to spare. */
  fits(x: number, y: number, grow = 0): boolean {
    return !this.solids.overlaps(x, y, this.at.r + grow, this.step, this.height);
  }
}
