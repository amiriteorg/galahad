import { BUILDS, type Mover, type Solids } from "./collide.ts";
import { type Ground, moveOnGround, rng, slideOnGround } from "./physics.ts";
import { turnTowards } from "./path.ts";

/*
 * Microducks: small biped duck robots (Antoine Pirrone's open-source Open Duck
 * Mini v2, drawn from its URDF) pottering round the keep. They waddle in a loose flock,
 * stop to look about, bob their heads, peck, hop now and then, and sometimes tag
 * along behind Galahad or the dog for a few seconds. They keep off water, the
 * keep's buildings and the plots, and stay near home. Among the solids each is
 * a small circle that slides along what it meets, keeps out of the others' way
 * and is moved aside by Galahad and the dog. Pure (the renderer reads
 * the pose of each), so unit-tested. World coordinates, metres.
 */

export type DuckMode = "walk" | "look" | "bob" | "peck" | "hop";

export interface Duck {
  x: number;
  y: number;
  /** Its radius among the solids. */
  r: number;
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
  /** Gathered round Galahad (care.ts), looking up at him. */
  gathered?: boolean;
}

export interface Leader {
  x: number;
  y: number;
  heading: number;
}

const WALK = 0.65;
const HOME_RADIUS = 34;

export class MicroduckFlock {
  readonly ducks: Duck[] = [];
  /* ---------- Galahad's visits (care.ts) ---------- */
  /** He's come to see them: those within reach gather round this point, looking up at him. */
  readonly gather = { on: false, x: 0, y: 0 };
  /** The one he's leading home (it follows him), or −1. */
  led = -1;
  private readonly movers: Mover[] = [];
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
      this.ducks.push({ x, y, r: BUILDS.microduck.r, heading: this.random() * Math.PI * 2, speed: 0, mode: "look", timer: this.random() * 2, following: 0, followTimer: 0, phase: this.random() * 6, hop: 0, headYaw: 0, headPitch: 0, beak: 0, wander: this.random() * Math.PI * 2 });
    }
  }

  /** Walks among the world's solids from now on (each standing where it fits). */
  join(solids: Solids): void {
    for (const d of this.ducks) {
      const m = solids.join(d, BUILDS.microduck);
      m.ground = (x, y) => this.ground.blocked(x, y);
      for (let tries = 0; tries < 30 && !m.fits(d.x, d.y, 0.05); tries++) {
        const a = this.random() * Math.PI * 2;
        const r = 11 + this.random() * 8;
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r - 6;
        if (!this.ground.blocked(x, y)) {
          d.x = x;
          d.y = y;
        }
      }
      this.movers.push(m);
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
      if (i === this.led) {
        d.following = 1;
        d.followTimer = Math.max(d.followTimer, 1);
      }
      // Round him in a loose ring when he visits, each in its own place of it.
      const gathering = this.gather.on && i !== this.led && Math.hypot(d.x - this.gather.x, d.y - this.gather.y) < 30;
      d.gathered = false;

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
      } else if (gathering) {
        const a = i * 2.39996;
        const gx = this.gather.x + Math.cos(a) * (1.9 + 0.4 * (i % 3)) - d.x;
        const gy = this.gather.y + Math.sin(a) * (1.9 + 0.4 * (i % 3)) - d.y;
        const dist = Math.hypot(gx, gy);
        tx = gx / (dist || 1);
        ty = gy / (dist || 1);
        d.speed = dist < 0.35 ? 0 : Math.min(1.3, WALK + dist * 0.3);
        if (dist < 0.6) {
          d.gathered = true;
          d.mode = "look";
          d.timer = Math.max(d.timer, 0.5);
          d.heading = turnTowards(d.heading, Math.atan2(this.gather.y - d.y, this.gather.x - d.x), 3 * dt);
        }
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
        const mover = this.movers[i];
        const taken = mover ? slideOnGround(mover, this.ground, d.x, d.y, d.heading, d.speed * dt, this.scratch, 0.9) : moveOnGround(this.ground, d.x, d.y, d.heading, d.speed * dt, this.scratch, 0.9);
        if (taken === null) {
          d.wander += Math.PI * (0.5 + this.random());
          d.heading += 0.8;
        } else {
          d.x = this.scratch.x;
          d.y = this.scratch.y;
          d.heading = taken;
        }
        d.phase += dt * MicroduckFlock.cadence(d.speed);
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
    if (d.mode === "look" && !d.following) yaw = d.gathered ? 0.15 * Math.sin(t * 1.3 + i) : 0.7 * Math.sin(t * 1.8 + i);
    // Gathered round him: heads up, at him.
    if (d.gathered) pitch = -0.35;
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

  /** How fast the gait's phase turns (rad/s) at a walking speed (m/s): quicker steps when hurrying. */
  static cadence(speed: number): number {
    return 6 + speed * 6;
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

  /** The duck farthest from the rest (its index, and how far from the flock's middle), for him to lead home. */
  stray(): { index: number; distance: number } {
    const n = this.ducks.length;
    let cx = 0;
    let cy = 0;
    for (const d of this.ducks) {
      cx += d.x / n;
      cy += d.y / n;
    }
    let index = -1;
    let distance = 0;
    this.ducks.forEach((d, i) => {
      const r = Math.hypot(d.x - cx, d.y - cy);
      if (r > distance) {
        distance = r;
        index = i;
      }
    });
    return { index, distance };
  }

  /** The middle of the flock (into `out`). */
  middle(out: { x: number; y: number }): { x: number; y: number } {
    out.x = 0;
    out.y = 0;
    for (const d of this.ducks) {
      out.x += d.x / this.ducks.length;
      out.y += d.y / this.ducks.length;
    }
    return out;
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
