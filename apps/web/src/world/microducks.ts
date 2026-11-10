import { type Ground, moveOnGround, rng } from "./physics.ts";
import { turnTowards } from "./path.ts";

/*
 * Microducks: small biped duck robots (after Pollen Robotics and Hugging Face's
 * open-source Microduck) pottering round the keep. They waddle in a loose flock,
 * stop to look about, bob their heads, peck, hop now and then, and sometimes tag
 * along behind Galahad or the dog for a few seconds. They keep off water, the
 * keep's buildings and the plots, and stay near home. Pure (the renderer reads
 * the pose of each), so unit-tested. World coordinates, metres.
 */

export type DuckMode = "walk" | "look" | "bob" | "peck" | "hop";

export interface Duck {
  x: number;
  y: number;
  heading: number;
  /** Walking speed now, m/s (0 while busy with something else). */
  speed: number;
  mode: DuckMode;
  timer: number;
  /** 0: no one; 1: Galahad; 2: the dog. */
  following: 0 | 1 | 2;
  followTimer: number;
  /** Gait phase (radians) and the pose it gives. */
  phase: number;
  hop: number;
  headYaw: number;
  headPitch: number;
  beak: number;
  wander: number;
}

export interface Leader {
  x: number;
  y: number;
  heading: number;
}

const WALK = 0.45;
const HOME_RADIUS = 34;

export class MicroduckFlock {
  readonly ducks: Duck[] = [];
  private readonly random: () => number;
  private readonly scratch = { x: 0, y: 0 };

  constructor(
    count: number,
    private readonly ground: Ground,
    seed = 17,
  ) {
    this.random = rng(seed);
    // Born in a little group on the lawn south-east of the keep, each on open ground.
    for (let i = 0; i < count; i++) {
      let x = 10;
      let y = -12;
      for (let tries = 0; tries < 40; tries++) {
        const a = -0.7 + this.random() * 1.2;
        const r = 11 + this.random() * 6;
        x = Math.cos(a) * r;
        y = Math.sin(a) * r - 6;
        if (!ground.blocked(x, y)) break;
      }
      this.ducks.push({ x, y, heading: this.random() * Math.PI * 2, speed: 0, mode: "look", timer: this.random() * 2, following: 0, followTimer: 0, phase: this.random() * 6, hop: 0, headYaw: 0, headPitch: 0, beak: 0, wander: this.random() * Math.PI * 2 });
    }
  }

  step(dt: number, t: number, galahad: Leader, dog: Leader): void {
    const n = this.ducks.length;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < n; i++) {
      cx += this.ducks[i]!.x / n;
      cy += this.ducks[i]!.y / n;
    }
    for (let i = 0; i < n; i++) {
      const d = this.ducks[i]!;
      d.timer -= dt;
      if (d.following) {
        d.followTimer -= dt;
        if (d.followTimer <= 0) d.following = 0;
      } else if (this.random() < dt * 0.025) {
        // Now and then, tag along behind Galahad or the dog for a little while.
        d.following = this.random() < 0.6 ? 1 : 2;
        d.followTimer = 4 + this.random() * 5;
        d.mode = "walk";
      }
      if (d.timer <= 0 && !d.following) this.choose(d);

      // Where it wants to go.
      let tx = Math.cos(d.wander);
      let ty = Math.sin(d.wander);
      d.wander += (this.random() - 0.5) * 2.2 * dt;
      if (d.following) {
        const l = d.following === 1 ? galahad : dog;
        const gx = l.x - Math.cos(l.heading) * (1.6 + i * 0.35) - d.x;
        const gy = l.y - Math.sin(l.heading) * (1.6 + i * 0.35) - d.y;
        const dist = Math.hypot(gx, gy);
        tx = gx / (dist || 1);
        ty = gy / (dist || 1);
        d.speed = dist < 0.5 ? 0 : Math.min(1.4, WALK + dist * 0.25);
      } else if (d.mode === "walk") d.speed = WALK;
      else d.speed = 0;
      // A loose flock: drawn to the others when far, kept apart when close.
      const fx = cx - d.x;
      const fy = cy - d.y;
      const fd = Math.hypot(fx, fy);
      if (fd > 3.5) {
        tx += (fx / fd) * 0.8;
        ty += (fy / fd) * 0.8;
      }
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const o = this.ducks[j]!;
        const sx = d.x - o.x;
        const sy = d.y - o.y;
        const s = Math.hypot(sx, sy);
        if (s < 0.7 && s > 1e-6) {
          tx += (sx / s) * (0.7 - s) * 4;
          ty += (sy / s) * (0.7 - s) * 4;
        }
      }
      // Home is the keep's lawn.
      const home = Math.hypot(d.x, d.y);
      if (home > HOME_RADIUS && !d.following) {
        tx -= (d.x / home) * 1.5;
        ty -= (d.y / home) * 1.5;
      }
      if (d.speed > 0) {
        d.heading = turnTowards(d.heading, Math.atan2(ty, tx), 4 * dt);
        const taken = moveOnGround(this.ground, d.x, d.y, d.heading, d.speed * dt, this.scratch, 0.9);
        if (taken === null) {
          d.wander += Math.PI * (0.5 + this.random());
          d.heading += 0.8;
        } else {
          d.x = this.scratch.x;
          d.y = this.scratch.y;
          d.heading = taken;
        }
        d.phase += dt * (6 + d.speed * 6);
      }
      this.pose(d, dt, t, i);
    }
  }

  private choose(d: Duck): void {
    const r = this.random();
    d.mode = r < 0.45 ? "walk" : r < 0.65 ? "look" : r < 0.8 ? "bob" : r < 0.94 ? "peck" : "hop";
    d.timer = d.mode === "walk" ? 2 + this.random() * 4 : d.mode === "hop" ? 0.5 : 1.2 + this.random() * 1.8;
    if (d.mode === "hop") d.hop = 0.001;
  }

  private pose(d: Duck, dt: number, t: number, i: number): void {
    const k = 1 - Math.exp(-dt * 10);
    let yaw = 0;
    let pitch = 0;
    let beak = 0;
    if (d.mode === "look" && !d.following) yaw = 0.7 * Math.sin(t * 1.8 + i);
    if (d.mode === "bob" && !d.following) pitch = 0.35 * Math.max(0, Math.sin(t * 7 + i));
    if (d.mode === "peck" && !d.following) {
      const p = Math.max(0, Math.sin(t * 5 + i));
      pitch = 1.1 * p;
      beak = p > 0.7 ? 1 : 0;
    }
    // Now and then the beak opens, as if to say something.
    if (Math.sin(t * 0.9 + i * 2.3) > 0.97) beak = 1;
    d.headYaw += (yaw - d.headYaw) * k;
    d.headPitch += (pitch - d.headPitch) * k;
    d.beak += (beak - d.beak) * k;
    if (d.hop > 0) {
      d.hop += dt;
      if (d.hop > 0.42) d.hop = 0;
    }
  }

  /** The hop's height now (m). */
  static hopHeight(d: Duck): number {
    return d.hop > 0 ? Math.sin((d.hop / 0.42) * Math.PI) * 0.16 : 0;
  }

  /** Waddle: body roll and leg swing for the gait phase (radians), fading when still; written into `out`. */
  static gait(d: Duck, out: { roll: number; left: number; right: number; bob: number }): void {
    const moving = Math.min(1, d.speed / WALK);
    const s = Math.sin(d.phase);
    out.roll = 0.16 * s * moving;
    out.left = 0.55 * s * moving;
    out.right = -0.55 * s * moving;
    out.bob = Math.abs(s) * 0.025 * moving;
  }

  /** The duck nearest a world point within `r` metres, if any. */
  near(x: number, y: number, r: number): Duck | null {
    let best: Duck | null = null;
    let bd = r;
    for (const d of this.ducks) {
      const dist = Math.hypot(d.x - x, d.y - y);
      if (dist < bd) {
        bd = dist;
        best = d;
      }
    }
    return best;
  }
}
