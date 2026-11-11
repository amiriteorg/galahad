import { rng } from "../physics.ts";
import { WATER_LEVEL } from "../terrain.ts";
import { type FlowerSpot, flowerNear, type Habitat } from "./habitat.ts";
import { clamp, smooth, TAU, turnTo } from "./num.ts";
import type { Env } from "./sim.ts";
import { BUMBLEBEE, BUTTERFLY, DRAGONFLY, MAYFLY, MOTH } from "./species.ts";

/*
 * The insects: too many and too small to be agents with needs, so each is a
 * few numbers and a habit, and where they are is what's real about them.
 *
 *   bumblebees   work the flowers that actually grow near the view, one to
 *                the next, a few seconds on each; only by day, in bloom, in
 *                the dry.
 *   butterflies  the same flowers, wings slowly opening and closing on one,
 *                then a bobbing, wandering flight to another.
 *   dragonflies  over the water's edge in high summer: a dash, a hang in the
 *                air, a dash.
 *   mayflies     at dusk a column of them dances over the shallows: up
 *                slowly, down fast, all evening.
 *   moths        at night, round each lit lantern, never quite touching it.
 *   fireflies    over the meadow from dusk. Each flashes on its own clock;
 *                seeing a neighbour flash nudges its own clock on a little
 *                (the later in its cycle, the bigger the nudge). That one
 *                rule is how real fireflies fall into step, and these do:
 *                patches of meadow blink together within a minute or two.
 *
 * How many of each depends on the season's vigour and bloom, the hour, the
 * rain and the wind, and on how much the swallows and bats have left
 * (`midges`). Pure, seeded, nothing allocated while it runs.
 */

/** Nothing in this slot. */
export const NONE = 255;
/** How far from the view's focus insects are kept, metres. */
const NEAR = 30;
/** A firefly's neighbours: those whose flashes it sees. */
const SEEN = 6;
/** How much a seen flash moves a firefly's clock on (a share of where it is in its cycle). */
export const NUDGE = 0.14;

export class Insects {
  readonly n: number;
  readonly kind: Uint8Array;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly z: Float32Array;
  /** Where it's from and where it's going (a flower, a point over the water, a lantern). */
  private readonly ax: Float64Array;
  private readonly ay: Float64Array;
  private readonly az: Float32Array;
  private readonly bx: Float64Array;
  private readonly by: Float64Array;
  private readonly bz: Float32Array;
  /** How far along it is (0..1 flying), or how long it stays yet (seconds, settled). */
  private readonly go: Float32Array;
  private readonly stay: Float32Array;
  readonly heading: Float32Array;
  /** Its wings: where in their beat, and how wide. */
  readonly phase: Float32Array;
  readonly amount: Float32Array;
  /** 0 gone to 1 there. */
  readonly shown: Float32Array;
  private readonly leaving: Uint8Array;
  private readonly own: Float32Array;
  /** How many of each kind are out. */
  readonly count = new Int32Array(5);
  private readonly want = new Int32Array(5);

  // ---- fireflies ----
  readonly fireflies: number;
  readonly fx: Float64Array;
  readonly fy: Float64Array;
  readonly fz: Float32Array;
  /** Where each is in its cycle (0..1: it flashes at 1), how long its cycle is, and how bright it is now. */
  readonly clock: Float32Array;
  private readonly period: Float32Array;
  readonly glow: Float32Array;
  private readonly seen: Int16Array;
  private readonly homeX: Float64Array;
  private readonly homeY: Float64Array;
  private readonly homeZ: Float32Array;
  /** How much of them shows, 0..1 (dusk, the season, the dry). */
  fireflyLevel = 0;
  private placed = false;
  private centreX = Number.NaN;
  private centreY = Number.NaN;

  private readonly random: () => number;
  private census = 0;
  private t = 0;
  private readonly flower: FlowerSpot = { x: 0, y: 0, z: 0 };
  /** Lit lanterns: x, y, z (world), `lightCount` of them. */
  readonly lights = new Float64Array(3 * 8);
  lightCount = 0;
  /** Set false to stop the fireflies seeing each other (the tests' control). */
  coupled = true;

  constructor(
    private readonly habitat: Habitat,
    insects: number,
    fireflies: number,
    seed = 5,
  ) {
    this.random = rng(seed);
    const n = (this.n = Math.max(0, Math.floor(insects)));
    this.kind = new Uint8Array(n).fill(NONE);
    this.x = new Float64Array(n);
    this.y = new Float64Array(n);
    this.z = new Float32Array(n);
    this.ax = new Float64Array(n);
    this.ay = new Float64Array(n);
    this.az = new Float32Array(n);
    this.bx = new Float64Array(n);
    this.by = new Float64Array(n);
    this.bz = new Float32Array(n);
    this.go = new Float32Array(n);
    this.stay = new Float32Array(n);
    this.heading = new Float32Array(n);
    this.phase = new Float32Array(n);
    this.amount = new Float32Array(n);
    this.shown = new Float32Array(n);
    this.leaving = new Uint8Array(n);
    this.own = new Float32Array(n);
    for (let i = 0; i < n; i++) this.own[i] = this.random();
    const f = (this.fireflies = Math.max(0, Math.floor(fireflies)));
    this.fx = new Float64Array(f);
    this.fy = new Float64Array(f);
    this.fz = new Float32Array(f);
    this.clock = new Float32Array(f);
    this.period = new Float32Array(f);
    this.glow = new Float32Array(f);
    this.seen = new Int16Array(f * SEEN).fill(-1);
    this.homeX = new Float64Array(f);
    this.homeY = new Float64Array(f);
    this.homeZ = new Float32Array(f);
    for (let i = 0; i < f; i++) {
      this.clock[i] = this.random();
      this.period[i] = 2.0 + 0.5 * this.random();
    }
  }

  /** A step. `midges` is how much is on the wing, 0..1 (sim.ts: what the birds and bats leave). */
  step(dt: number, env: Env, midges: number): void {
    this.t += dt;
    if ((this.census -= dt) <= 0) {
      this.census = 0.6;
      this.muster(env, midges);
    }
    for (let i = 0; i < this.n; i++) {
      const k = this.kind[i]!;
      if (k === NONE) continue;
      if (this.leaving[i]) {
        this.shown[i] = this.shown[i]! - dt * 1.5;
        if (this.shown[i]! <= 0) {
          this.kind[i] = NONE;
          this.count[k] = this.count[k]! - 1;
          continue;
        }
      } else this.shown[i] = Math.min(1, this.shown[i]! + dt * 1.2);
      if (k === BUMBLEBEE || k === BUTTERFLY) this.flowerer(i, k, dt);
      else if (k === DRAGONFLY) this.dragonfly(i, dt, env);
      else if (k === MAYFLY) this.mayfly(i, dt);
      else this.moth(i, dt);
    }
    this.stepFireflies(dt, env);
  }

  /** Under reduced motion: no insects (they are all motion). */
  still(): void {
    for (let i = 0; i < this.n; i++) {
      this.kind[i] = NONE;
      this.shown[i] = 0;
    }
    this.count.fill(0);
    this.fireflyLevel = 0;
  }

  // ---------- who's out ----------

  /** How many of each there should be now, and one more or one fewer of each towards it. */
  private muster(env: Env, midges: number): void {
    const s = env.season;
    const day = 1 - env.night;
    const fair = (1 - env.rain) * clamp(1.4 - env.wind / 9);
    const warm = smooth(0.15, 0.55, s.vigour);
    const flowers = Math.min(1, s.bloom * 1.6) * warm * day * fair * (day > 0.5 ? 1 : 0);
    const air = 0.4 + 0.6 * clamp(midges * 1.5);
    const n = this.n;
    const w = this.want;
    w[BUMBLEBEE] = Math.round(n * 0.28 * flowers);
    w[BUTTERFLY] = Math.round(n * 0.26 * flowers * smooth(0.3, 0.7, s.vigour));
    w[DRAGONFLY] = Math.round(n * 0.1 * smooth(0.5, 0.85, s.vigour) * day * fair * air * (day > 0.5 ? 1 : 0));
    w[MAYFLY] = Math.round(n * 0.3 * smooth(0.3, 0.6, s.vigour) * env.twilight * fair * air);
    w[MOTH] = env.lamps > 0.5 ? Math.round(Math.min(this.lightCount * 5, n * 0.22) * smooth(0.12, 0.4, s.vigour) * env.night * fair * air) : 0;
    for (let k = 0; k < 5; k++) {
      if (this.count[k]! < w[k]!) {
        // A few at a time, so a meadow fills over a few seconds.
        for (let more = 0; more < 3 && this.count[k]! < w[k]!; more++) if (!this.send(k, env)) break;
      } else if (this.count[k]! > w[k]!) this.recall(k);
    }
    // Any that the view has left behind go too.
    for (let i = 0; i < n; i++) {
      if (this.kind[i] !== NONE && !this.leaving[i] && Math.hypot(this.x[i]! - env.fx, this.y[i]! - env.fy) > NEAR * 2.2) this.leaving[i] = 1;
    }
  }

  /** One more of a kind, if there's a free slot and somewhere for it to be. */
  private send(k: number, env: Env): boolean {
    let slot = -1;
    for (let i = 0; i < this.n; i++) {
      if (this.kind[i] === NONE) {
        slot = i;
        break;
      }
    }
    if (slot < 0) return false;
    const a = this.random() * TAU;
    const r = 3 + this.random() * NEAR;
    const px = env.fx + Math.cos(a) * r;
    const py = env.fy + Math.sin(a) * r;
    if (k === BUMBLEBEE || k === BUTTERFLY) {
      // Only where a flower really grows.
      if (!flowerNear(this.habitat, px, py, 9, 1 + Math.floor(this.random() * 1e6), this.flower)) return false;
      this.ax[slot] = this.bx[slot] = this.flower.x;
      this.ay[slot] = this.by[slot] = this.flower.y;
      this.az[slot] = this.bz[slot] = this.flower.z;
      this.stay[slot] = 1 + this.random() * 3;
    } else if (k === DRAGONFLY || k === MAYFLY) {
      // Over the water's edge: a point near the view that's wet or all but.
      let found = false;
      for (let tries = 0; tries < 6 && !found; tries++) {
        const b = this.random() * TAU;
        const d = 4 + this.random() * (NEAR + 12);
        const x = env.fx + Math.cos(b) * d;
        const y = env.fy + Math.sin(b) * d;
        const h = this.habitat.height(x, y);
        if (h > WATER_LEVEL + (k === MAYFLY ? -0.05 : 0.35) || h < WATER_LEVEL - 1.2) continue;
        this.ax[slot] = this.bx[slot] = x;
        this.ay[slot] = this.by[slot] = y;
        this.az[slot] = this.bz[slot] = Math.max(h, WATER_LEVEL) + 0.5 + this.random() * 0.6;
        found = true;
      }
      if (!found) return false;
      // Mayflies swarm: the next few join this one's column.
      if (k === MAYFLY && this.count[k]! % 6 !== 0) {
        for (let j = 0; j < this.n; j++) {
          if (j !== slot && this.kind[j] === MAYFLY && !this.leaving[j]) {
            this.ax[slot] = this.ax[j]! + (this.random() - 0.5) * 1.6;
            this.ay[slot] = this.ay[j]! + (this.random() - 0.5) * 1.6;
            this.az[slot] = this.az[j]!;
            break;
          }
        }
      }
      this.stay[slot] = this.random();
    } else {
      // A moth: to one of the lit lanterns.
      if (!this.lightCount) return false;
      const l = Math.floor(this.random() * this.lightCount) * 3;
      if (Math.hypot(this.lights[l]! - env.fx, this.lights[l + 1]! - env.fy) > 90) return false;
      this.ax[slot] = this.lights[l]!;
      this.ay[slot] = this.lights[l + 1]!;
      this.az[slot] = this.lights[l + 2]!;
    }
    this.kind[slot] = k;
    this.leaving[slot] = 0;
    this.shown[slot] = 0;
    this.go[slot] = 1;
    this.x[slot] = this.ax[slot]!;
    this.y[slot] = this.ay[slot]!;
    this.z[slot] = this.az[slot]!;
    this.heading[slot] = this.random() * TAU;
    this.count[k] = this.count[k]! + 1;
    return true;
  }

  /** One fewer of a kind: it fades out where it is. */
  private recall(k: number): void {
    for (let i = this.n - 1; i >= 0; i--) {
      if (this.kind[i] === k && !this.leaving[i]) {
        this.leaving[i] = 1;
        return;
      }
    }
  }

  // ---------- habits ----------

  /** A bee or a butterfly: on a flower a while, then to another near. */
  private flowerer(i: number, k: number, dt: number): void {
    const bee = k === BUMBLEBEE;
    if (this.go[i]! >= 1) {
      // On the flower. The bee walks round the head; the butterfly sits, its wings slowly opening and closing.
      this.stay[i] = this.stay[i]! - dt;
      const a = this.t * (bee ? 2.4 : 0.3) + this.own[i]! * TAU;
      this.x[i] = this.bx[i]! + Math.cos(a) * (bee ? 0.035 : 0.01);
      this.y[i] = this.by[i]! + Math.sin(a) * (bee ? 0.035 : 0.01);
      this.z[i] = this.bz[i]! + 0.02;
      if (bee) this.heading[i] = a + Math.PI / 2;
      this.phase[i] = (this.phase[i]! + dt * (bee ? 70 : 2.6)) % TAU;
      this.amount[i] = bee ? 0.25 : 0.85;
      if (this.stay[i]! > 0) return;
      // The next flower: one within a few metres (the same again if there's no other).
      this.ax[i] = this.bx[i]!;
      this.ay[i] = this.by[i]!;
      this.az[i] = this.bz[i]!;
      if (flowerNear(this.habitat, this.ax[i]!, this.ay[i]!, bee ? 5 : 9, 1 + Math.floor(this.random() * 1e6), this.flower)) {
        this.bx[i] = this.flower.x;
        this.by[i] = this.flower.y;
        this.bz[i] = this.flower.z;
      }
      this.go[i] = 0;
      this.stay[i] = bee ? 1.5 + this.random() * 4 : 3 + this.random() * 6;
      return;
    }
    // On the wing between them: the bee straight and low with a little weave, the butterfly bobbing and wandering.
    const dx = this.bx[i]! - this.ax[i]!;
    const dy = this.by[i]! - this.ay[i]!;
    const far = Math.max(0.3, Math.hypot(dx, dy));
    const u = Math.min(1, this.go[i]! + (dt * (bee ? 1.5 : 0.9)) / far);
    this.go[i] = u;
    const arc = Math.sin(u * Math.PI);
    const side = Math.sin(this.t * (bee ? 9 : 4.3) + this.own[i]! * 40) * (bee ? 0.06 : 0.3) * arc;
    const was = this.x[i]!;
    const wasY = this.y[i]!;
    this.x[i] = this.ax[i]! + dx * u - (dy / far) * side;
    this.y[i] = this.ay[i]! + dy * u + (dx / far) * side;
    this.z[i] = this.az[i]! + (this.bz[i]! - this.az[i]!) * u + arc * (bee ? 0.18 : 0.45) + (bee ? 0 : Math.sin(this.t * 7 + this.own[i]! * 9) * 0.12 * arc);
    if (Math.hypot(this.x[i]! - was, this.y[i]! - wasY) > 1e-4) this.heading[i] = Math.atan2(this.y[i]! - wasY, this.x[i]! - was);
    this.phase[i] = (this.phase[i]! + dt * (bee ? 90 : 13)) % TAU;
    this.amount[i] = 1;
  }

  /** A dragonfly: a fast straight dash to somewhere new over the water's edge, a hang in the air, and again. */
  private dragonfly(i: number, dt: number, env: Env): void {
    this.phase[i] = (this.phase[i]! + dt * 80) % TAU;
    this.amount[i] = 0.7;
    if (this.go[i]! >= 1) {
      this.stay[i] = this.stay[i]! - dt;
      // Hanging: it holds its place, drifting a hand's breadth.
      this.x[i] = this.bx[i]! + Math.sin(this.t * 2.1 + i) * 0.04;
      this.y[i] = this.by[i]! + Math.cos(this.t * 1.7 + i) * 0.04;
      this.z[i] = this.bz[i]!;
      if (this.stay[i]! > 0) return;
      this.ax[i] = this.bx[i]!;
      this.ay[i] = this.by[i]!;
      this.az[i] = this.bz[i]!;
      for (let tries = 0; tries < 4; tries++) {
        const a = this.heading[i]! + (this.random() - 0.5) * 3.4;
        const d = 1.5 + this.random() * 5;
        const x = this.ax[i]! + Math.cos(a) * d;
        const y = this.ay[i]! + Math.sin(a) * d;
        const h = this.habitat.height(x, y);
        if (h > WATER_LEVEL + 0.4 || Math.hypot(x - env.fx, y - env.fy) > NEAR * 1.8) continue;
        this.bx[i] = x;
        this.by[i] = y;
        this.bz[i] = Math.max(h, WATER_LEVEL) + 0.35 + this.random() * 0.9;
        this.heading[i] = a;
        break;
      }
      this.go[i] = 0;
      this.stay[i] = 0.5 + this.random() * 1.6;
      return;
    }
    const dx = this.bx[i]! - this.ax[i]!;
    const dy = this.by[i]! - this.ay[i]!;
    const far = Math.max(0.3, Math.hypot(dx, dy));
    const u = Math.min(1, this.go[i]! + (dt * 5.5) / far);
    this.go[i] = u;
    // (Quick off the mark, quick to stop.)
    const e = u * u * (3 - 2 * u);
    this.x[i] = this.ax[i]! + dx * e;
    this.y[i] = this.ay[i]! + dy * e;
    this.z[i] = this.az[i]! + (this.bz[i]! - this.az[i]!) * e;
  }

  /** A mayfly in its column: up slowly, down fast, round and round. */
  private mayfly(i: number, dt: number): void {
    const beat = (this.t * 0.42 + this.own[i]! * 3 + this.stay[i]!) % 1;
    // Three quarters of the time rising, a quarter falling.
    const lift = beat < 0.75 ? beat / 0.75 : 1 - (beat - 0.75) / 0.25;
    const a = this.t * (0.5 + this.own[i]!) + this.own[i]! * TAU * 3;
    const r = 0.25 + 0.5 * ((this.own[i]! * 7) % 1);
    this.x[i] = this.ax[i]! + Math.cos(a) * r;
    this.y[i] = this.ay[i]! + Math.sin(a) * r;
    this.z[i] = this.az[i]! - 0.25 + lift * 1.1;
    this.heading[i] = a + Math.PI / 2;
    this.phase[i] = (this.phase[i]! + dt * 60) % TAU;
    this.amount[i] = beat < 0.75 ? 0.9 : 0.3;
  }

  /** A moth round its lantern: close circles that never settle, in and out. */
  private moth(i: number, dt: number): void {
    const o = this.own[i]!;
    const a = this.t * (2.2 + 2.4 * o) * (i & 1 ? 1 : -1) + o * 50;
    const r = 0.28 + 0.3 * (0.5 + 0.5 * Math.sin(this.t * (0.9 + o) + o * 20)) + 0.12 * Math.sin(this.t * 5.3 + i);
    const was = this.x[i]!;
    const wasY = this.y[i]!;
    this.x[i] = this.ax[i]! + Math.cos(a) * r;
    this.y[i] = this.ay[i]! + Math.sin(a) * r;
    this.z[i] = this.az[i]! + 0.22 * Math.sin(this.t * (1.3 + o) + o * 9) + 0.08 * Math.sin(this.t * 6.1 + i);
    const to = Math.atan2(this.y[i]! - wasY, this.x[i]! - was);
    this.heading[i] = this.heading[i]! + turnTo(this.heading[i]!, to) * Math.min(1, dt * 12);
    this.phase[i] = (this.phase[i]! + dt * 38) % TAU;
    this.amount[i] = 1;
  }

  // ---------- fireflies ----------

  private stepFireflies(dt: number, env: Env): void {
    const n = this.fireflies;
    if (!n) return;
    // From dusk into the night, in the growing months, in the dry.
    const level = clamp(env.night * 1.4) * (env.evening > 0.5 ? 1 : 0.5) * (1 - env.rain) * smooth(0.25, 0.6, env.season.vigour);
    this.fireflyLevel += (level - this.fireflyLevel) * Math.min(1, dt * 0.8);
    if (this.fireflyLevel < 0.01) return;
    if (!this.placed || !(Math.hypot(env.fx - this.centreX, env.fy - this.centreY) < 26)) this.scatter(env);
    const t = this.t;
    for (let i = 0; i < n; i++) {
      // Each drifts round its own spot.
      this.fx[i] = this.homeX[i]! + Math.sin(t * 0.31 + i * 1.7) * 1.3;
      this.fy[i] = this.homeY[i]! + Math.cos(t * 0.27 + i * 1.1) * 1.3;
      this.fz[i] = this.homeZ[i]! + Math.sin(t * 0.5 + i * 2.1) * 0.35;
      this.glow[i] = Math.max(0, this.glow[i]! - dt / 0.4);
      const clock = this.clock[i]! + dt / this.period[i]!;
      if (clock < 1) {
        this.clock[i] = clock;
        continue;
      }
      // It flashes; those that see it are nudged on, the more the later they are in their own cycle (never while
      // they're still dark from their last).
      this.clock[i] = 0;
      this.glow[i] = 1;
      if (!this.coupled) continue;
      for (let q = 0; q < SEEN; q++) {
        const j = this.seen[i * SEEN + q]!;
        if (j < 0) break;
        const c = this.clock[j]!;
        if (c > 0.2) this.clock[j] = Math.min(1, c + NUDGE * c);
      }
    }
  }

  /** Sets the fireflies out round the view (those the view has left, at least), and works out who sees whom. */
  private scatter(env: Env): void {
    const n = this.fireflies;
    const all = !this.placed;
    this.placed = true;
    this.centreX = env.fx;
    this.centreY = env.fy;
    for (let i = 0; i < n; i++) {
      if (!all && Math.hypot(this.homeX[i]! - env.fx, this.homeY[i]! - env.fy) < 46) continue;
      for (let tries = 0; tries < 5; tries++) {
        const a = this.random() * TAU;
        const r = 5 + this.random() * 38;
        const x = env.fx + Math.cos(a) * r;
        const y = env.fy + Math.sin(a) * r;
        const h = this.habitat.height(x, y);
        // Over the meadow and the banks, not out over open water.
        if (h < WATER_LEVEL - 0.3 && tries < 4) continue;
        this.homeX[i] = x;
        this.homeY[i] = y;
        this.homeZ[i] = Math.max(h, WATER_LEVEL) + 0.5 + this.random() * 1.2;
        break;
      }
    }
    // Each sees its nearest few (and only those within a dozen metres).
    for (let i = 0; i < n; i++) {
      for (let q = 0; q < SEEN; q++) this.seen[i * SEEN + q] = -1;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const d = Math.hypot(this.homeX[j]! - this.homeX[i]!, this.homeY[j]! - this.homeY[i]!);
        if (d > 12) continue;
        // Kept in order of distance: the farthest of the six gives way.
        let at = -1;
        for (let q = 0; q < SEEN; q++) {
          const o = this.seen[i * SEEN + q]!;
          if (o < 0 || Math.hypot(this.homeX[o]! - this.homeX[i]!, this.homeY[o]! - this.homeY[i]!) > d) {
            at = q;
            break;
          }
        }
        if (at < 0) continue;
        for (let q = SEEN - 1; q > at; q--) this.seen[i * SEEN + q] = this.seen[i * SEEN + q - 1]!;
        this.seen[i * SEEN + at] = j;
      }
    }
  }

  /** How much in step the fireflies are with those they see: 0 (anyhow) to 1 (as one). For the tests and the tour. */
  inStep(): number {
    let sum = 0;
    let pairs = 0;
    for (let i = 0; i < this.fireflies; i++) {
      for (let q = 0; q < SEEN; q++) {
        const j = this.seen[i * SEEN + q]!;
        if (j < 0) break;
        // How near their clocks are, round the cycle.
        const d = Math.abs(this.clock[i]! - this.clock[j]!);
        sum += Math.cos(Math.min(d, 1 - d) * TAU);
        pairs++;
      }
    }
    return pairs ? sum / pairs : 0;
  }
}
