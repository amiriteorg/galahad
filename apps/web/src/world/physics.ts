/*
 * Physics in proportion. The experiments' physics comes from their simulators
 * (MuJoCo, JSBSim, RocketPy) through the frames; the world itself only needs
 * light, kinematic motion: a ground-following controller for characters and
 * animals (slopes, no wading into lakes or walking through walls), a
 * spring-damper for the dog, boids for birds and ballistic particles for exhaust
 * and sparks. Typed arrays and no allocations per step. Pure, so unit-tested.
 *
 * The seam: everything the loop steps is a `Simulation`. If interactive physics is
 * ever needed, a WASM engine would be one more Simulation owning its own bodies;
 * nothing else would change. None is added now.
 */

export interface Simulation {
  step(dt: number): void;
}

/** What the controller needs to know about the ground. */
export interface Ground {
  height(x: number, y: number): number;
  /** True where nobody may stand: water, walls, plots (for animals). */
  blocked(x: number, y: number): boolean;
}

/** Steeper than this (rise over run), animals turn away. */
export const MAX_SLOPE = 0.7;

/**
 * Tries to move a body from (x, y) by `step` metres towards `heading`; if that
 * spot is blocked or too steep, tries turning a little either way. Writes the new
 * position into `out` and returns the heading actually taken, or null when every
 * way is blocked (the body stays put).
 */
export function moveOnGround(ground: Ground, x: number, y: number, heading: number, step: number, out: { x: number; y: number }, maxSlope = Infinity): number | null {
  const here = ground.height(x, y);
  for (let k = 0; k < TURNS.length; k++) {
    const h = heading + TURNS[k]!;
    const nx = x + Math.cos(h) * step;
    const ny = y + Math.sin(h) * step;
    if (ground.blocked(nx, ny)) continue;
    if (step > 1e-6 && Math.abs(ground.height(nx, ny) - here) / step > maxSlope) continue;
    out.x = nx;
    out.y = ny;
    return h;
  }
  out.x = x;
  out.y = y;
  return null;
}

const TURNS = [0, 0.45, -0.45, 0.9, -0.9, 1.35, -1.35, 1.8, -1.8];

/** A 2D spring-damper (semi-implicit Euler): x'' = k (target − x) − c x'. */
export interface Spring {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export function springStep(s: Spring, tx: number, ty: number, k: number, c: number, dt: number, maxSpeed = Infinity): void {
  s.vx += (k * (tx - s.x) - c * s.vx) * dt;
  s.vy += (k * (ty - s.y) - c * s.vy) * dt;
  const speed = Math.hypot(s.vx, s.vy);
  if (speed > maxSpeed) {
    s.vx *= maxSpeed / speed;
    s.vy *= maxSpeed / speed;
  }
  s.x += s.vx * dt;
  s.y += s.vy * dt;
}

/** Critical damping for stiffness k (unit mass): no overshoot, fastest settle. */
export const criticalDamping = (k: number): number => 2 * Math.sqrt(k);

/**
 * A flock: separation, alignment and cohesion, plus a pull towards a home point
 * and a band of heights. Positions and velocities are packed xyz (world frame, z up).
 */
export class Boids implements Simulation {
  readonly pos: Float32Array;
  readonly vel: Float32Array;
  home = { x: 0, y: 0, z: 30 };
  minSpeed = 5;
  maxSpeed = 9;
  /** Keep within this far of home (horizontally). */
  range = 90;

  constructor(
    readonly count: number,
    seed = 1,
  ) {
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    let s = seed;
    const rand = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < count; i++) {
      this.pos[i * 3] = (rand() - 0.5) * 30;
      this.pos[i * 3 + 1] = (rand() - 0.5) * 30;
      this.pos[i * 3 + 2] = 25 + rand() * 10;
      const a = rand() * Math.PI * 2;
      this.vel[i * 3] = Math.cos(a) * 6;
      this.vel[i * 3 + 1] = Math.sin(a) * 6;
    }
  }

  /** Moves the whole flock (when home jumps far, e.g. after the camera flew elsewhere). */
  shift(dx: number, dy: number): void {
    for (let i = 0; i < this.count; i++) {
      this.pos[i * 3] = this.pos[i * 3]! + dx;
      this.pos[i * 3 + 1] = this.pos[i * 3 + 1]! + dy;
    }
  }

  step(dt: number): void {
    const n = this.count;
    const p = this.pos;
    const v = this.vel;
    for (let i = 0; i < n; i++) {
      const ix = i * 3;
      let cx = 0, cy = 0, cz = 0, ax = 0, ay = 0, az = 0, sx = 0, sy = 0, sz = 0, near = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const jx = j * 3;
        const dx = p[jx]! - p[ix]!;
        const dy = p[jx + 1]! - p[ix + 1]!;
        const dz = p[jx + 2]! - p[ix + 2]!;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > 144) continue;
        near++;
        cx += dx;
        cy += dy;
        cz += dz;
        ax += v[jx]!;
        ay += v[jx + 1]!;
        az += v[jx + 2]!;
        if (d2 < 6.25) {
          const k = 1 / Math.max(d2, 0.01);
          sx -= dx * k;
          sy -= dy * k;
          sz -= dz * k;
        }
      }
      let fx = 0, fy = 0, fz = 0;
      if (near) {
        fx += (cx / near) * 0.8 + (ax / near - v[ix]!) * 1.2 + sx * 6;
        fy += (cy / near) * 0.8 + (ay / near - v[ix + 1]!) * 1.2 + sy * 6;
        fz += (cz / near) * 0.4 + (az / near - v[ix + 2]!) * 0.6 + sz * 6;
      }
      // Home: a gentle pull, stronger beyond the range; and a band of heights.
      const hx = this.home.x - p[ix]!;
      const hy = this.home.y - p[ix + 1]!;
      const hd = Math.hypot(hx, hy);
      const pull = hd > this.range ? 3 : 0.15;
      fx += (hx / (hd || 1)) * pull * Math.min(1, hd / 10);
      fy += (hy / (hd || 1)) * pull * Math.min(1, hd / 10);
      fz += (this.home.z - p[ix + 2]!) * 0.5;
      v[ix] = v[ix]! + fx * dt;
      v[ix + 1] = v[ix + 1]! + fy * dt;
      v[ix + 2] = v[ix + 2]! + fz * dt;
      const speed = Math.hypot(v[ix]!, v[ix + 1]!, v[ix + 2]!) || 1;
      const clamped = Math.max(this.minSpeed, Math.min(this.maxSpeed, speed));
      v[ix] = (v[ix]! / speed) * clamped;
      v[ix + 1] = (v[ix + 1]! / speed) * clamped;
      v[ix + 2] = ((v[ix + 2]! / speed) * clamped) * 0.5;
    }
    for (let i = 0; i < n * 3; i++) p[i] = p[i]! + v[i]! * dt;
  }
}

/** Ballistic particles in a fixed pool: exhaust, sparks. Packed xyz (world frame, z up). */
export class Particles implements Simulation {
  readonly pos: Float32Array;
  readonly vel: Float32Array;
  /** Remaining life, seconds (≤ 0: free). */
  readonly life: Float32Array;
  readonly maxLife: Float32Array;
  gravity = 9.81;
  drag = 0.6;
  private next = 0;

  constructor(readonly capacity: number) {
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
  }

  /** Emits one particle, reusing the oldest slot when the pool is full. */
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number): void {
    const i = this.next;
    this.next = (this.next + 1) % this.capacity;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.life[i] = life;
    this.maxLife[i] = life;
  }

  get alive(): number {
    let n = 0;
    for (let i = 0; i < this.capacity; i++) if (this.life[i]! > 0) n++;
    return n;
  }

  step(dt: number): void {
    const damp = Math.exp(-this.drag * dt);
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i]! <= 0) continue;
      this.life[i] = this.life[i]! - dt;
      const k = i * 3;
      this.vel[k + 2] = this.vel[k + 2]! - this.gravity * dt;
      this.vel[k] = this.vel[k]! * damp;
      this.vel[k + 1] = this.vel[k + 1]! * damp;
      this.vel[k + 2] = this.vel[k + 2]! * damp;
      this.pos[k] = this.pos[k]! + this.vel[k]! * dt;
      this.pos[k + 1] = this.pos[k + 1]! + this.vel[k + 1]! * dt;
      this.pos[k + 2] = this.pos[k + 2]! + this.vel[k + 2]! * dt;
    }
  }
}

/** A small deterministic random source (no Math.random in tests). */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}
