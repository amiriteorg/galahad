import { WATER_LEVEL } from "../terrain.ts";
import { emptyTree, MEADOW, OPEN, SHORE, type TreeSpot, treeNear, WET, WOODS } from "./habitat.ts";
import { clamp, TAU, turnTo } from "./num.ts";
import type { Ecosystem } from "./sim.ts";
import * as S from "./species.ts";
import { breeding, SPECS } from "./species.ts";

/*
 * Everything on the wing.
 *
 *   songbirds   One flock with a day of its own: down in the meadow feeding
 *               (hopping, pecking), up into a tree or three, off to another
 *               spot; into the trees in rain; to roost at dusk and out at
 *               dawn. Walk under their tree, or up to where they feed, and
 *               they flush. In flight each keeps clear of its neighbours.
 *   swallows    Summer's, low and fast over the lake after what's hatching,
 *               dipping to the water now and then.
 *   starlings   In spring and autumn, at dusk, they come in by the dozen from
 *               every side and turn as one over their roost: Denmark's sort
 *               sol. Real flocks keep with their nearest six or seven
 *               neighbours whatever the distance; so do these (each bird
 *               steers by six it keeps track of, swapping in a nearer one as
 *               it finds it), which is what lets a turn run through the flock
 *               as a wave. At dark they pour down into the trees.
 *   geese       In the migration months a skein crosses high over, in a V,
 *               each bird holding its place off the one ahead; the leader
 *               drops back now and then and another takes the point.
 *   kestrel     By day it hangs on the wind over the meadow, head still,
 *               drops on a vole, and moves on.
 *   owl         By night from perch to perch, low and slow.
 *   bats        From dusk, April to October: fluttering loops after insects,
 *               over the water, along the wood's edge and round a lit lantern.
 *
 * All of it steering on velocities in the same arrays as the rest (sim.ts);
 * nothing allocated while it runs. Pure.
 */

/** The flock's day. */
const FEED = 1;
const TREES = 2;
const NIGHT = 3;

/** How many neighbours a starling steers by. */
const NEAR = 6;

export class Wings {
  // ---- the songbirds' flock ----
  private mode = 0;
  private flockTimer = 0;
  private siteX = 0;
  private siteY = 0;
  private readonly trees: TreeSpot[] = [emptyTree(), emptyTree(), emptyTree()];
  private treeCount = 0;
  private flockCheck = 0;
  // ---- the murmuration ----
  private murmuring = false;
  private roostX = 0;
  private roostY = 0;
  private roostZ = 0;
  private murmurT = 0;
  private bunch = 0;
  private wave = 0;
  private waveX = 0;
  private waveY = 0;
  private readonly near: Int16Array;
  // ---- the skein ----
  private skein = 40;
  private skeinOn = false;
  private skeinHeading = 0;
  private lead = 0;
  private leadTimer = 0;
  /** When each visiting kind next comes or goes (seconds). */
  private readonly next = new Float32Array(S.KIND_COUNT);
  /** Lit lanterns the moths and bats come to: x, y, z (world), `lightCount` of them. */
  readonly lights = new Float64Array(3 * 8);
  lightCount = 0;
  private readonly tree = emptyTree();
  private readonly spot = { x: 0, y: 0 };

  constructor(eco: Ecosystem) {
    this.near = new Int16Array((eco.first[S.STARLING + 1]! - eco.first[S.STARLING]!) * NEAR);
  }

  step(eco: Ecosystem, dt: number): void {
    this.songbirds(eco, dt);
    this.swallows(eco, dt);
    this.starlings(eco, dt);
    this.geese(eco, dt);
    this.kestrel(eco, dt);
    this.owl(eco, dt);
    this.bats(eco, dt);
  }

  /** Under reduced motion: the songbirds sit in their trees, wings folded; nothing else is in the air. */
  still(eco: Ecosystem): void {
    this.population(eco, 0);
    for (let k = 0; k < S.KIND_COUNT; k++) {
      if (SPECS[k]!.realm !== S.AIR) continue;
      for (let i = eco.first[k]!; i < eco.first[k + 1]!; i++) {
        if (!eco.alive[i]) continue;
        const d = eco.doing[i]!;
        if (k === S.SONGBIRD && this.treeCount) {
          this.perchOf(eco, i);
          eco.x[i] = eco.homeX[i]!;
          eco.y[i] = eco.homeY[i]!;
          eco.z[i] = eco.homeZ[i]!;
          eco.air[i] = 1;
          eco.doing[i] = S.PERCH;
        }
        const sitting = eco.doing[i] === S.PERCH || d === S.ROOST || (k === S.SONGBIRD && d === S.PECK);
        eco.shown[i] = sitting ? 1 : 0;
        eco.lie[i] = 1;
        eco.amount[i] = 0;
        eco.pitch[i] = eco.roll[i] = eco.nod[i] = 0;
        eco.speed[i] = 0;
      }
    }
  }

  // ---------- flying ----------

  /**
   * A frame of flight: its velocity turned towards (tx, ty, tz) at `speed` by at most `accel`, its place moved on,
   * and how it's drawn (heading along its way, pitched by its climb, banked into its turn, wings beating at `beat`
   * a second, by `flap`). Returns how far it still has to go.
   */
  private fly(eco: Ecosystem, i: number, tx: number, ty: number, tz: number, speed: number, accel: number, dt: number, beat: number, flap: number): number {
    const x = eco.x[i]!;
    const y = eco.y[i]!;
    const z = eco.z[i]!;
    const dx = tx - x;
    const dy = ty - y;
    const dz = tz - z;
    const d = Math.hypot(dx, dy, dz);
    const k = d > 1e-4 ? speed / d : 0;
    let ax = dx * k - eco.vx[i]!;
    let ay = dy * k - eco.vy[i]!;
    let az = dz * k - eco.vz[i]!;
    const a = Math.hypot(ax, ay, az);
    const most = accel * dt;
    if (a > most) {
      ax *= most / a;
      ay *= most / a;
      az *= most / a;
    }
    this.push(eco, i, ax, ay, az, dt, beat, flap);
    return d;
  }

  /** Adds a change of velocity, moves the bird on and poses it. */
  private push(eco: Ecosystem, i: number, ax: number, ay: number, az: number, dt: number, beat: number, flap: number): void {
    const vx = eco.vx[i]! + ax;
    const vy = eco.vy[i]! + ay;
    const vz = eco.vz[i]! + az;
    eco.vx[i] = vx;
    eco.vy[i] = vy;
    eco.vz[i] = vz;
    eco.x[i] = eco.x[i]! + vx * dt;
    eco.y[i] = eco.y[i]! + vy * dt;
    eco.z[i] = eco.z[i]! + vz * dt;
    const flat = Math.hypot(vx, vy);
    eco.speed[i] = flat;
    if (flat > 0.3) {
      const was = eco.heading[i]!;
      const turn = turnTo(was, Math.atan2(vy, vx));
      eco.heading[i] = was + turn;
      // Banked into the turn, nose along the climb: eased, so it never twitches.
      const ease = Math.min(1, dt * 6);
      eco.roll[i] = eco.roll[i]! + (clamp((turn / Math.max(dt, 1e-3)) * 0.28, -1.1, 1.1) - eco.roll[i]!) * ease;
      eco.pitch[i] = eco.pitch[i]! + (Math.atan2(vz, flat) - eco.pitch[i]!) * ease;
    }
    eco.phase[i] = (eco.phase[i]! + dt * beat) % TAU;
    eco.amount[i] = eco.amount[i]! + (flap - eco.amount[i]!) * Math.min(1, dt * 6);
    eco.lie[i] = Math.max(0, eco.lie[i]! - dt * 5);
    eco.shown[i] = Math.min(1, eco.shown[i]! + dt * 1.5);
    eco.air[i] = 1;
  }

  /** The ground (or the water) under a point. */
  private floor(eco: Ecosystem, x: number, y: number): number {
    return Math.max(eco.habitat.height(x, y), WATER_LEVEL);
  }

  /** A point on the range's edge, in the air, into `spot`; returns its bearing from the focus. */
  private edge(eco: Ecosystem, from = 1.2): number {
    const a = eco.random() * TAU;
    this.spot.x = eco.env.fx + Math.cos(a) * eco.reach * from;
    this.spot.y = eco.env.fy + Math.sin(a) * eco.reach * from;
    return a;
  }

  /** One of a visiting kind comes in at the edge on the wing; its slot, or −1. */
  private come(eco: Ecosystem, k: number, height: number): number {
    const a = this.edge(eco);
    const i = eco.spawn(k, this.spot.x, this.spot.y, SPECS[k]!.grown + 1, eco.random() < 0.5);
    if (i < 0) return -1;
    eco.air[i] = 1;
    eco.z[i] = this.floor(eco, this.spot.x, this.spot.y) + height;
    const speed = SPECS[k]!.walk;
    eco.vx[i] = -Math.cos(a) * speed;
    eco.vy[i] = -Math.sin(a) * speed;
    eco.heading[i] = a + Math.PI;
    eco.doing[i] = S.FLY;
    eco.timer[i] = 0;
    eco.came[k] = eco.came[k]! + 1;
    return i;
  }

  /** Sends one off: it flies out of the range (and is let go there). */
  private go(eco: Ecosystem, i: number): void {
    const a = Math.atan2(eco.y[i]! - eco.env.fy, eco.x[i]! - eco.env.fx) + (eco.random() - 0.5);
    eco.tx[i] = eco.env.fx + Math.cos(a) * eco.reach * 2.4;
    eco.ty[i] = eco.env.fy + Math.sin(a) * eco.reach * 2.4;
    eco.doing[i] = S.LEAVE;
    eco.air[i] = 1;
  }

  /** How many of a visiting kind should be here now, by the hour, the months, the weather. */
  private wanted(eco: Ecosystem, k: number, fair: number): number {
    return Math.round(eco.grownCap[k]! * eco.room[k]! * (eco.about[k]! > 0.45 ? 1 : 0) * fair);
  }

  // ---------- songbirds ----------

  /** The flock's numbers: the first of them, fledglings in their season, fewer in winter. */
  private population(eco: Ecosystem, dt: number): void {
    const k = S.SONGBIRD;
    const want = eco.holds(k);
    if (want <= 0) return;
    if (eco.count[k] === 0) {
      // The first of them, already in their trees (or down feeding): nobody pops out of the air.
      this.siteX = eco.env.fx + (eco.random() - 0.5) * eco.reach * 0.6;
      this.siteY = eco.env.fy + (eco.random() - 0.5) * eco.reach * 0.6;
      this.choose(eco, this.siteX, this.siteY, 70);
      const n = Math.round(want * (0.7 + 0.3 * eco.random()));
      for (let b = 0; b < n; b++) {
        const i = eco.spawn(k, this.siteX, this.siteY, SPECS[k]!.grown + eco.random() * 2, eco.random() < 0.5);
        if (i < 0) break;
        this.sit(eco, i);
      }
      this.mode = this.treeCount ? TREES : FEED;
      this.flockTimer = 6 + eco.random() * 10;
      if (!this.treeCount) this.land(eco);
      return;
    }
    if (dt <= 0) return;
    const spec = SPECS[k]!;
    // Fledglings, while there's food on the wing.
    if (eco.count[k]! < want && eco.midges > 0.25 && eco.random() < dt * eco.pace * 0.5 * breeding(spec, eco.env.season.year) * eco.count[k]! * 0.25) {
      for (let j = eco.first[k]!; j < eco.first[k + 1]!; j++) {
        if (!eco.alive[j] || eco.age[j]! < spec.grown) continue;
        const i = eco.spawn(k, eco.x[j]!, eco.y[j]!, 0, eco.random() < 0.5);
        if (i >= 0) {
          eco.z[i] = eco.z[j]!;
          eco.air[i] = eco.air[j]!;
          eco.doing[i] = eco.doing[j]!;
          eco.births[k] = eco.births[k]! + 1;
          this.target(eco, i);
        }
        break;
      }
    }
    // Too many for the season: one leaves. Too few: some come.
    if (eco.count[k]! > want + 1 && eco.random() < dt * 0.05) {
      for (let j = eco.first[k + 1]! - 1; j >= eco.first[k]!; j--) {
        if (eco.alive[j] && eco.doing[j] !== S.LEAVE) {
          this.go(eco, j);
          break;
        }
      }
    } else if (eco.count[k]! < want * eco.arrivals && eco.random() < dt * 0.05) {
      const i = this.come(eco, k, 12);
      if (i >= 0) this.target(eco, i);
    }
  }

  /** Up to three trees near (x, y) for the flock to sit in. */
  private choose(eco: Ecosystem, x: number, y: number, r: number): void {
    this.treeCount = 0;
    for (let pick = 0; pick < 3; pick++) {
      const t = this.trees[this.treeCount]!;
      if (!treeNear(eco.habitat, x, y, pick === 0 ? r : 16, pick, t)) break;
      // Round the first one found.
      if (pick === 0) {
        x = t.x;
        y = t.y;
      } else if (this.trees.slice(0, this.treeCount).some((o) => o.x === t.x && o.y === t.y)) continue;
      this.treeCount++;
    }
  }

  /** A bird's own place in the flock's trees, into its home. */
  private perchOf(eco: Ecosystem, i: number): void {
    const t = this.trees[i % Math.max(1, this.treeCount)]!;
    const a = eco.own[i]! * TAU * 7;
    const out = 0.2 + 0.55 * ((eco.own[i]! * 13) % 1);
    eco.homeX[i] = t.x + Math.cos(a) * t.crown * out;
    eco.homeY[i] = t.y + Math.sin(a) * t.crown * out;
    // On the crown: highest at its middle, lower towards its edge.
    eco.homeZ[i] = t.z + t.top - (t.top - t.bottom) * (0.12 + 0.45 * out * out);
  }

  /** A bird's own place where the flock feeds on the ground. */
  private groundOf(eco: Ecosystem, i: number): void {
    const a = eco.own[i]! * TAU * 5;
    const r = 0.6 + 3.6 * ((eco.own[i]! * 17) % 1);
    let x = this.siteX + Math.cos(a) * r;
    let y = this.siteY + Math.sin(a) * r;
    if (!eco.dry(x, y)) {
      x = this.siteX;
      y = this.siteY;
    }
    eco.homeX[i] = x;
    eco.homeY[i] = y;
    eco.homeZ[i] = eco.habitat.height(x, y);
  }

  /** Where a bird should be for what the flock is doing. */
  private target(eco: Ecosystem, i: number): void {
    if (this.mode === FEED || !this.treeCount) this.groundOf(eco, i);
    else this.perchOf(eco, i);
    if (eco.doing[i] !== S.LEAVE) eco.doing[i] = this.mode === NIGHT ? S.TO_ROOST : S.FLY;
    eco.air[i] = 1;
    if (eco.z[i]! < eco.habitat.height(eco.x[i]!, eco.y[i]!)) eco.z[i] = eco.habitat.height(eco.x[i]!, eco.y[i]!) + 0.05;
  }

  /** Puts a bird straight onto its place (the first of them; reduced motion). */
  private sit(eco: Ecosystem, i: number): void {
    const feeding = this.mode === FEED || !this.treeCount;
    if (feeding) this.groundOf(eco, i);
    else this.perchOf(eco, i);
    eco.x[i] = eco.homeX[i]!;
    eco.y[i] = eco.homeY[i]!;
    eco.z[i] = eco.homeZ[i]!;
    eco.air[i] = feeding ? 0 : 1;
    eco.doing[i] = feeding ? S.PECK : S.PERCH;
    eco.lie[i] = 1;
    eco.shown[i] = 1;
    eco.vx[i] = eco.vy[i] = eco.vz[i] = 0;
  }

  /** A place in the meadow for the flock to come down and feed: not under anyone's feet. */
  private land(eco: Ecosystem): void {
    const e = eco.env;
    for (let tries = 0; tries < 8; tries++) {
      const a = eco.random() * TAU;
      const r = 18 + eco.random() * 45;
      const x = this.siteX + Math.cos(a) * r;
      const y = this.siteY + Math.sin(a) * r;
      if (Math.hypot(x - e.fx, y - e.fy) > eco.reach * 0.7 || !eco.dry(x, y)) continue;
      const code = eco.patches.code[eco.patches.at(x, y)]!;
      if (code !== MEADOW && code !== SHORE && tries < 6) continue;
      if (!Number.isNaN(e.gx) && Math.hypot(x - e.gx, y - e.gy) < 14) continue;
      this.siteX = x;
      this.siteY = y;
      this.mode = FEED;
      return;
    }
    // Nowhere to come down: they stay in the trees.
    this.mode = this.treeCount ? TREES : FEED;
  }

  /** Everyone up and off to wherever the flock is going now. */
  private send(eco: Ecosystem): void {
    for (let i = eco.first[S.SONGBIRD]!; i < eco.first[S.SONGBIRD + 1]!; i++) if (eco.alive[i] && eco.doing[i] !== S.LEAVE) this.target(eco, i);
  }

  /** They flush: up from the ground into the trees, or out of their trees into others farther off. */
  private flush(eco: Ecosystem, fromX: number, fromY: number): void {
    if (this.mode === FEED) {
      this.choose(eco, this.siteX, this.siteY, 60);
      this.mode = this.treeCount ? TREES : FEED;
      if (!this.treeCount) this.land(eco);
    } else {
      // Other trees, away from whoever it was.
      const a = Math.atan2(this.siteY - fromY, this.siteX - fromX) + (eco.random() - 0.5) * 1.2;
      const x = this.trees[0]!.x + Math.cos(a) * 34;
      const y = this.trees[0]!.y + Math.sin(a) * 34;
      const was = this.trees[0]!.x;
      this.choose(eco, x, y, 26);
      if (!this.treeCount || this.trees[0]!.x === was) this.choose(eco, this.siteX, this.siteY, 60);
    }
    if (this.treeCount) {
      this.siteX = this.trees[0]!.x;
      this.siteY = this.trees[0]!.y;
    }
    this.flockTimer = 14 + eco.random() * 12;
    this.send(eco);
  }

  private songbirds(eco: Ecosystem, dt: number): void {
    const k = S.SONGBIRD;
    const a = eco.first[k]!;
    const b = eco.first[k + 1]!;
    if (a === b) return;
    this.population(eco, dt);
    if (!eco.count[k]) return;
    const e = eco.env;
    const spec = SPECS[k]!;
    // ---- the flock's mind, a few times a second ----
    this.flockTimer -= dt;
    if ((this.flockCheck -= dt) <= 0) {
      this.flockCheck = 0.25;
      const roost = eco.about[k]! < 0.3;
      const foul = e.storm > 0.5 || e.rain > 0.7 || e.wind > 13;
      if (roost && this.mode !== NIGHT) {
        // To roost: the nearest wood, or the nearest trees.
        if (eco.patches.nearest(this.siteX, this.siteY, WOODS, 8, this.spot)) this.choose(eco, this.spot.x, this.spot.y, 30);
        if (!this.treeCount) this.choose(eco, this.siteX, this.siteY, 90);
        this.mode = NIGHT;
        this.send(eco);
      } else if (!roost && (this.mode === NIGHT || this.flockTimer <= 0)) {
        if (this.mode === FEED || foul) {
          this.choose(eco, this.siteX, this.siteY, 60);
          this.mode = this.treeCount ? TREES : FEED;
          this.flockTimer = (foul ? 40 : 12) + eco.random() * 16;
        } else {
          this.land(eco);
          this.flockTimer = 18 + eco.random() * 18;
        }
        this.send(eco);
      }
      // Someone under their tree, or walking up to where they feed.
      for (let who = 0; who < 2; who++) {
        const px = who ? e.dx : e.gx;
        if (Number.isNaN(px)) continue;
        const py = who ? e.dy : e.gy;
        let near = false;
        if (this.mode === FEED) near = Math.hypot(px - this.siteX, py - this.siteY) < spec.flight + 4;
        else for (let t = 0; t < this.treeCount; t++) near ||= Math.hypot(px - this.trees[t]!.x, py - this.trees[t]!.y) < this.trees[t]!.crown + 1.5;
        if (near && this.flockTimer < 100) {
          this.flush(eco, px, py);
          // (Not again for a moment: they've only just gone up.)
          this.flockCheck = 1.5;
          break;
        }
      }
    }
    // ---- each bird ----
    for (let i = a; i < b; i++) {
      if (!eco.alive[i]) continue;
      const d = eco.doing[i]!;
      if (eco.timer[i] === -1e3) {
        // A fright (sim.ts' startle): all of them go.
        eco.timer[i] = 0;
        this.flush(eco, eco.fearX[i]!, eco.fearY[i]!);
      }
      const flying = d === S.FLY || d === S.TO_ROOST || d === S.LEAVE;
      // (At roost it burns nothing: the real night is a hundred of its days long.)
      if (d !== S.ROOST) eco.energy[i] = eco.energy[i]! - dt * eco.pace * (flying ? 1.5 : 0.7);
      const was = eco.age[i]!;
      eco.age[i] = was + (dt * eco.pace) / eco.yearDays;
      if (was < spec.grown && eco.age[i]! >= spec.grown) eco.young[k] = eco.young[k]! - 1;
      if (eco.energy[i]! <= 0 || eco.age[i]! > eco.span[i]!) {
        eco.deaths[eco.energy[i]! <= 0 ? 0 : 1]![k] = eco.deaths[eco.energy[i]! <= 0 ? 0 : 1]![k]! + 1;
        eco.remove(i);
        continue;
      }
      if (d === S.LEAVE) {
        this.fly(eco, i, eco.tx[i]!, eco.ty[i]!, eco.z[i]! + 2, spec.run, spec.accel, dt, 30, 1);
        continue;
      }
      if (flying) {
        // To its place: high while it's far, down onto it at the end; clear of the others on the way.
        const hx = eco.homeX[i]!;
        const hy = eco.homeY[i]!;
        const far = Math.hypot(hx - eco.x[i]!, hy - eco.y[i]!);
        const lift = clamp(far - 4, 0, 9) * 0.8;
        const sway = Math.sin(eco.t * 2.3 + i * 1.9) * Math.min(3, far * 0.25);
        const speed = Math.min(spec.run, 2.2 + far * 1.3);
        const left = this.fly(eco, i, hx - Math.sin(eco.heading[i]!) * sway, hy + Math.cos(eco.heading[i]!) * sway, eco.homeZ[i]! + lift, speed, spec.accel, dt, 34, 1);
        // Apart from whoever's nearest in the air.
        for (let j = a; j < b; j++) {
          if (j === i || !eco.alive[j] || eco.doing[j] !== d) continue;
          const dx = eco.x[i]! - eco.x[j]!;
          const dy = eco.y[i]! - eco.y[j]!;
          const dz = eco.z[i]! - eco.z[j]!;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > 1.2 || d2 < 1e-6) continue;
          const push = (dt * 5) / d2;
          eco.vx[i] = eco.vx[i]! + dx * push;
          eco.vy[i] = eco.vy[i]! + dy * push;
          eco.vz[i] = eco.vz[i]! + dz * push * 0.5;
        }
        if (left < 0.45 && far < 0.4) {
          // Down. In a tree it's perched (or roosting); on the ground it feeds.
          const ground = this.mode === FEED || !this.treeCount;
          eco.x[i] = hx;
          eco.y[i] = hy;
          eco.z[i] = eco.homeZ[i]!;
          eco.air[i] = ground ? 0 : 1;
          eco.vx[i] = eco.vy[i] = eco.vz[i] = 0;
          eco.speed[i] = 0;
          eco.doing[i] = ground ? S.PECK : this.mode === NIGHT ? S.ROOST : S.PERCH;
          eco.timer[i] = eco.random() * 2;
          eco.heading[i] = eco.random() * TAU;
        }
        continue;
      }
      // Sitting: wings folded, level.
      eco.lie[i] = Math.min(1, eco.lie[i]! + dt * 6);
      eco.amount[i] = 0;
      eco.pitch[i] = eco.pitch[i]! * Math.max(0, 1 - dt * 8);
      eco.roll[i] = eco.roll[i]! * Math.max(0, 1 - dt * 8);
      eco.shown[i] = Math.min(1, eco.shown[i]! + dt * 1.5);
      let nod = d === S.ROOST ? -0.5 : 0;
      if (d === S.PECK) {
        // A hop, a look, a peck: `vz` counts a hop down (pose.ts lifts it by it).
        eco.timer[i] = eco.timer[i]! - dt;
        if (eco.vz[i]! > 0) {
          eco.vz[i] = Math.max(0, eco.vz[i]! - dt);
          eco.x[i] = eco.x[i]! + Math.cos(eco.heading[i]!) * 1.6 * dt;
          eco.y[i] = eco.y[i]! + Math.sin(eco.heading[i]!) * 1.6 * dt;
        } else if (eco.timer[i]! <= 0) {
          eco.timer[i] = 0.7 + eco.random() * 1.8;
          // Back towards its own spot if it's strayed, else anywhere.
          const back = Math.hypot(eco.homeX[i]! - eco.x[i]!, eco.homeY[i]! - eco.y[i]!) > 1.5;
          eco.heading[i] = back ? Math.atan2(eco.homeY[i]! - eco.y[i]!, eco.homeX[i]! - eco.x[i]!) : eco.random() * TAU;
          eco.vz[i] = 0.16;
          const at = eco.patches.at(eco.x[i]!, eco.y[i]!);
          const p = eco.patches;
          eco.feed(i, spec, p.bugs[at]! > 0.1 ? p.bugs : p.mast[at]! > 0.1 ? p.mast : p.graze, at, 4);
        } else if (eco.timer[i]! < 0.45) nod = -1;
      }
      eco.nod[i] = eco.nod[i]! + (nod - eco.nod[i]!) * Math.min(1, dt * 14);
    }
  }

  // ---------- swallows ----------

  private swallows(eco: Ecosystem, dt: number): void {
    const k = S.SWALLOW;
    const a = eco.first[k]!;
    const b = eco.first[k + 1]!;
    if (a === b) return;
    const e = eco.env;
    const spec = SPECS[k]!;
    const want = this.wanted(eco, k, e.rain < 0.5 && e.wind < 12 && eco.midges > 0.15 ? 1 : 0);
    if ((this.next[k] = this.next[k]! - dt) <= 0) {
      this.next[k] = 1.5 + eco.random() * 3;
      if (eco.count[k]! < want) this.come(eco, k, 6);
      else if (eco.count[k]! > want) {
        for (let i = a; i < b; i++) {
          if (eco.alive[i] && eco.doing[i] !== S.LEAVE) {
            this.go(eco, i);
            break;
          }
        }
      }
    }
    for (let i = a; i < b; i++) {
      if (!eco.alive[i]) continue;
      if (eco.doing[i] === S.LEAVE) {
        this.fly(eco, i, eco.tx[i]!, eco.ty[i]!, this.floor(eco, eco.x[i]!, eco.y[i]!) + 9, spec.run, spec.accel, dt, 26, 1);
        continue;
      }
      // A new mark every second or three: over the water if there's any, low; else over the meadow.
      if ((eco.timer[i] = eco.timer[i]! - dt) <= 0) {
        eco.timer[i] = 1 + eco.random() * 2.2;
        const water = eco.patches.nearest(e.fx, e.fy, WET, 12, this.spot);
        const cx = water ? this.spot.x : e.fx;
        const cy = water ? this.spot.y : e.fy;
        const ang = eco.random() * TAU;
        const r = 4 + eco.random() * (water ? 24 : 40);
        eco.tx[i] = cx + Math.cos(ang) * r;
        eco.ty[i] = cy + Math.sin(ang) * r;
        const over = eco.afloat(eco.tx[i]!, eco.ty[i]!);
        eco.tz[i] = this.floor(eco, eco.tx[i]!, eco.ty[i]!) + (over ? 0.25 + eco.random() * eco.random() * 3 : 1.5 + eco.random() * 5);
        eco.doing[i] = over ? S.SKIM : S.HAWK;
        eco.midges = Math.max(0, eco.midges - 0.00006);
      }
      // Never into the ground: the mark is lifted over what's between.
      const floor = this.floor(eco, eco.x[i]! + eco.vx[i]! * 0.5, eco.y[i]! + eco.vy[i]! * 0.5);
      const left = this.fly(eco, i, eco.tx[i]!, eco.ty[i]!, Math.max(eco.tz[i]!, floor + 0.3), spec.walk + 3 * eco.own[i]!, spec.accel, dt, 24, 0.75 + 0.25 * Math.sin(eco.t * 3 + i));
      if (eco.z[i]! < floor + 0.15) {
        eco.z[i] = floor + 0.15;
        eco.vz[i] = Math.abs(eco.vz[i]!) * 0.5;
        // A dip to the water: a ring.
        if (eco.afloat(eco.x[i]!, eco.y[i]!) && eco.random() < 0.5) eco.ripple(eco.x[i]!, eco.y[i]!, 0.6);
      }
      if (left < 1.5) eco.timer[i] = 0;
    }
  }

  // ---------- starlings: the murmuration ----------

  private starlings(eco: Ecosystem, dt: number): void {
    const k = S.STARLING;
    const a = eco.first[k]!;
    const b = eco.first[k + 1]!;
    const n = b - a;
    if (!n) return;
    const e = eco.env;
    const spec = SPECS[k]!;
    const dusk = e.evening > 0.5 && e.twilight > 0.3 && e.night < 0.8 && e.rain < 0.6 && e.storm < 0.5;
    const want = dusk ? Math.round(n * eco.room[k]!) : 0;
    if (dusk && !this.murmuring) {
      // Over their roost: the nearest wood to the view.
      this.murmuring = true;
      this.murmurT = eco.random() * 100;
      if (!eco.patches.nearest(e.fx, e.fy, WOODS, 9, this.spot)) {
        this.spot.x = e.fx + 30;
        this.spot.y = e.fy + 20;
      }
      this.roostX = this.spot.x;
      this.roostY = this.spot.y;
      this.roostZ = this.floor(eco, this.spot.x, this.spot.y);
      this.wave = 8;
    } else if (!dusk && this.murmuring && eco.count[k] === 0) this.murmuring = false;
    if (!eco.count[k] && !want) return;
    // They come in by the dozen, from every side.
    if (eco.count[k]! < want && (this.bunch -= dt) <= 0) {
      this.bunch = 1.2 + eco.random() * 2.5;
      const from = this.edge(eco, 1.15);
      const height = this.floor(eco, this.spot.x, this.spot.y) + 18 + eco.random() * 25;
      const many = Math.min(want - eco.count[k]!, 8 + Math.floor(eco.random() * 14));
      for (let m = 0; m < many; m++) {
        const i = eco.spawn(k, this.spot.x + (eco.random() - 0.5) * 14, this.spot.y + (eco.random() - 0.5) * 14, 1, true);
        if (i < 0) break;
        eco.air[i] = 1;
        eco.z[i] = height + (eco.random() - 0.5) * 6;
        eco.vx[i] = -Math.cos(from) * 11;
        eco.vy[i] = -Math.sin(from) * 11;
        eco.doing[i] = S.MURMUR;
        eco.think[i] = 0;
        // Its neighbours to begin with: the slots beside it.
        for (let q = 0; q < NEAR; q++) this.near[(i - a) * NEAR + q] = (i - a + q + 1) % n;
      }
    }
    this.murmurT += dt;
    const t = this.murmurT;
    // What they turn about: a point that wanders over the roost, wide and slow.
    const R = 30 + n * 0.08;
    const ax = this.roostX + Math.cos(t * 0.31) * R * (0.65 + 0.35 * Math.sin(t * 0.17));
    const ay = this.roostY + Math.sin(t * 0.41) * R;
    const az = this.roostZ + 30 + 11 * Math.sin(t * 0.23);
    // Now and then something goes through them (as a hawk would): the flock opens round it and folds back.
    if ((this.wave -= dt) <= 0) {
      this.wave = 9 + eco.random() * 9;
      this.waveX = ax + (eco.random() - 0.5) * 20;
      this.waveY = ay + (eco.random() - 0.5) * 20;
    }
    const waving = this.wave > 7.5 ? 1 : 0;
    const down = !dusk;
    for (let i = a; i < b; i++) {
      if (!eco.alive[i]) continue;
      const x = eco.x[i]!;
      const y = eco.y[i]!;
      const z = eco.z[i]!;
      if (down) {
        // Dark: down into the trees, each to a place of its own, and gone.
        eco.doing[i] = S.TO_ROOST;
        const o = eco.own[i]! * TAU * 9;
        const px = this.roostX + Math.cos(o) * 9 * eco.own[i]!;
        const py = this.roostY + Math.sin(o) * 9 * eco.own[i]!;
        // (Slower as it nears, so it comes down onto its place instead of circling it.)
        const left = this.fly(eco, i, px, py, this.roostZ + 4.5, Math.min(11, 4 + Math.hypot(px - x, py - y, this.roostZ + 4.5 - z) * 0.7), 22, dt, 30, 1);
        eco.think[i] = eco.think[i]! + dt;
        if (left < 2.5 || eco.think[i]! > 30) eco.remove(i);
        continue;
      }
      // Its six: one of them looked at again each frame, and swapped for a nearer bird if one's found.
      const row = (i - a) * NEAR;
      let cx = 0;
      let cy = 0;
      let cz = 0;
      let mx = 0;
      let my = 0;
      let mz = 0;
      let sx = 0;
      let sy = 0;
      let sz = 0;
      let seen = 0;
      let worst = -1;
      let worstD = -1;
      for (let q = 0; q < NEAR; q++) {
        const j = a + this.near[row + q]!;
        if (j === i || !eco.alive[j]) {
          worst = q;
          worstD = Infinity;
          continue;
        }
        const dx = eco.x[j]! - x;
        const dy = eco.y[j]! - y;
        const dz = eco.z[j]! - z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > worstD) {
          worstD = d2;
          worst = q;
        }
        seen++;
        cx += dx;
        cy += dy;
        cz += dz;
        mx += eco.vx[j]!;
        my += eco.vy[j]!;
        mz += eco.vz[j]!;
        if (d2 < 2.6) {
          const push = 1 / Math.max(d2, 0.05);
          sx -= dx * push;
          sy -= dy * push;
          sz -= dz * push;
        }
      }
      const cand = a + Math.floor(eco.random() * n);
      if (cand !== i && eco.alive[cand] && worst >= 0) {
        const d2 = (eco.x[cand]! - x) ** 2 + (eco.y[cand]! - y) ** 2 + (eco.z[cand]! - z) ** 2;
        let has = false;
        for (let q = 0; q < NEAR; q++) has ||= this.near[row + q] === cand - a;
        if (!has && d2 < worstD) this.near[row + worst] = cand - a;
      }
      const vx = eco.vx[i]!;
      const vy = eco.vy[i]!;
      const vz = eco.vz[i]!;
      let fx = 0;
      let fy = 0;
      let fz = 0;
      if (seen) {
        // Along with them, towards them, and not on top of them.
        fx += (mx / seen - vx) * 2.4 + (cx / seen) * 0.9 + sx * 9;
        fy += (my / seen - vy) * 2.4 + (cy / seen) * 0.9 + sy * 9;
        fz += (mz / seen - vz) * 2.4 + (cz / seen) * 0.9 + sz * 9;
      }
      // Towards what they turn about: gently near it, hard when far.
      const tx = ax - x;
      const ty = ay - y;
      const tz = az - z;
      const far = Math.hypot(tx, ty, tz) || 1;
      const pull = 1.2 + Math.max(0, far - 18) * 0.35;
      fx += (tx / far) * pull;
      fy += (ty / far) * pull;
      fz += (tz / far) * pull * 0.7;
      if (waving) {
        const wx = x - this.waveX;
        const wy = y - this.waveY;
        const wd = Math.hypot(wx, wy);
        if (wd < 16 && wd > 0.01) {
          const k2 = (16 - wd) * 1.6;
          fx += (wx / wd) * k2;
          fy += (wy / wd) * k2;
          fz += (i & 1 ? 1 : -1) * k2 * 0.4;
        }
      }
      // Never down into the trees while they turn.
      if (z < this.roostZ + 13) fz += (this.roostZ + 13 - z) * 2;
      let nx = vx + fx * dt;
      let ny = vy + fy * dt;
      let nz = vz + fz * dt;
      const speed = Math.hypot(nx, ny, nz) || 1;
      const held = clamp(speed, spec.walk, spec.run);
      nx *= held / speed;
      ny *= held / speed;
      nz = (nz * held) / speed;
      this.push(eco, i, nx - vx, ny - vy, nz - vz, dt, 30, 1);
      eco.doing[i] = S.MURMUR;
    }
  }

  // ---------- geese: a skein in a V ----------

  private geese(eco: Ecosystem, dt: number): void {
    const k = S.GOOSE;
    const a = eco.first[k]!;
    const b = eco.first[k + 1]!;
    if (a === b) return;
    const e = eco.env;
    const spec = SPECS[k]!;
    if (!this.skeinOn) {
      if (eco.room[k]! < 0.05 || eco.about[k]! < 0.5 || e.storm > 0.5) return;
      if ((this.skein -= dt * eco.room[k]!) > 0) return;
      this.skein = 150 + eco.random() * 240;
      // South-west in autumn, north-east in spring: across the view, a little to one side of it.
      const way = (e.season.year > 0.5 ? -2.36 : 0.79) + (eco.random() - 0.5) * 0.7;
      const side = (eco.random() - 0.5) * eco.reach * 0.8;
      const sx = e.fx - Math.cos(way) * eco.reach * 1.75 - Math.sin(way) * side;
      const sy = e.fy - Math.sin(way) * eco.reach * 1.75 + Math.cos(way) * side;
      const height = this.floor(eco, e.fx, e.fy) + 42 + eco.random() * 22;
      const many = Math.max(3, Math.round((b - a) * (0.6 + 0.4 * eco.random())));
      let first = -1;
      for (let m = 0; m < many; m++) {
        const i = eco.spawn(k, sx, sy, 2, true);
        if (i < 0) break;
        if (first < 0) first = i;
        eco.air[i] = 1;
        eco.doing[i] = S.MIGRATE;
        eco.heading[i] = way;
        eco.vx[i] = Math.cos(way) * spec.walk;
        eco.vy[i] = Math.sin(way) * spec.walk;
        eco.z[i] = height;
        eco.came[k] = eco.came[k]! + 1;
      }
      if (first < 0) return;
      this.skeinOn = true;
      this.skeinHeading = way;
      this.lead = 0;
      this.leadTimer = 18 + eco.random() * 14;
      // Each to its place in the V at once (they come out of the haze already formed).
      this.rank(eco, 1e3);
      return;
    }
    if (!eco.count[k]) {
      this.skeinOn = false;
      return;
    }
    // The point drops back now and then, and the next takes it.
    if ((this.leadTimer -= dt) <= 0) {
      this.leadTimer = 18 + eco.random() * 14;
      this.lead++;
    }
    this.rank(eco, dt);
    // Out of sight on the far side: let go.
    for (let i = a; i < b; i++) {
      if (!eco.alive[i]) continue;
      const along = (eco.x[i]! - e.fx) * Math.cos(this.skeinHeading) + (eco.y[i]! - e.fy) * Math.sin(this.skeinHeading);
      if (along > eco.reach * 1.8) {
        eco.left[k] = eco.left[k]! + 1;
        eco.remove(i);
      }
    }
  }

  /** Each goose to its place: the leader straight on, the rest stepped back and out on alternate sides of it. */
  private rank(eco: Ecosystem, dt: number): void {
    const k = S.GOOSE;
    const a = eco.first[k]!;
    const b = eco.first[k + 1]!;
    const spec = SPECS[k]!;
    const n = eco.count[k]!;
    const h = this.skeinHeading + Math.sin(eco.t * 0.05) * 0.08;
    const ux = Math.cos(h);
    const uy = Math.sin(h);
    // The leader: the lead-th of those alive.
    let leader = -1;
    let seen = 0;
    for (let i = a; i < b; i++) {
      if (!eco.alive[i]) continue;
      if (seen++ === this.lead % n) leader = i;
    }
    if (leader < 0) return;
    const snap = dt >= 1e3;
    if (!snap) this.fly(eco, leader, eco.x[leader]! + ux * 60, eco.y[leader]! + uy * 60, eco.z[leader]! + Math.sin(eco.t * 0.2) * 0.5, spec.walk, spec.accel, dt, 17, 1);
    let place = 0;
    for (let i = a; i < b; i++) {
      if (!eco.alive[i] || i === leader) continue;
      place++;
      const arm = place & 1 ? 1 : -1;
      const back = Math.ceil(place / 2);
      const px = eco.x[leader]! - ux * back * 2.5 - uy * arm * back * 1.75;
      const py = eco.y[leader]! - uy * back * 2.5 + ux * arm * back * 1.75;
      const pz = eco.z[leader]! + 0.25 * Math.sin(eco.t * 0.9 + i);
      if (snap) {
        eco.x[i] = px;
        eco.y[i] = py;
        eco.z[i] = pz;
        continue;
      }
      // Onto its place and along with the leader: faster when it's behind.
      const gap = Math.hypot(px - eco.x[i]!, py - eco.y[i]!, pz - eco.z[i]!);
      this.fly(eco, i, px + ux * 14, py + uy * 14, pz, Math.min(spec.run, spec.walk * (0.9 + gap * 0.12)), spec.accel, dt, 17, 1);
      eco.phase[i] = (eco.phase[i]! + dt * 0.3 * Math.sin(i)) % TAU;
    }
  }

  // ---------- the kestrel ----------

  private kestrel(eco: Ecosystem, dt: number): void {
    const k = S.KESTREL;
    const i = eco.first[k]!;
    if (i === eco.first[k + 1]) return;
    const e = eco.env;
    const spec = SPECS[k]!;
    const want = this.wanted(eco, k, e.rain < 0.4 && e.wind < 12 && e.storm < 0.3 ? 1 : 0);
    if (!eco.alive[i]) {
      if (want && (this.next[k] = this.next[k]! - dt) <= 0) {
        this.next[k] = 20 + eco.random() * 30;
        const s = this.come(eco, k, 16);
        if (s >= 0) eco.timer[s] = 0;
      }
      return;
    }
    let d = eco.doing[i]!;
    eco.timer[i] = eco.timer[i]! - dt;
    eco.energy[i] = eco.energy[i]! - dt * eco.pace * 0.9;
    if (!want && d !== S.LEAVE && d !== S.STOOP && d !== S.EAT) {
      this.go(eco, i);
      d = S.LEAVE;
    }
    if (d === S.LEAVE) {
      this.fly(eco, i, eco.tx[i]!, eco.ty[i]!, this.floor(eco, eco.x[i]!, eco.y[i]!) + 18, spec.run * 0.8, spec.accel, dt, 22, 0.8);
      return;
    }
    if (d === S.HOVER) {
      // Hanging on the wind: nose into it, tail down, wings quick; it holds its place to a hand's breadth.
      const into = e.windHeading + Math.PI;
      eco.heading[i] = eco.heading[i]! + clamp(turnTo(eco.heading[i]!, into), -2 * dt, 2 * dt);
      const hx = eco.tx[i]! + Math.sin(eco.t * 1.7) * 0.12;
      const hy = eco.ty[i]! + Math.cos(eco.t * 1.3) * 0.12;
      eco.x[i] = eco.x[i]! + (hx - eco.x[i]!) * Math.min(1, dt * 3);
      eco.y[i] = eco.y[i]! + (hy - eco.y[i]!) * Math.min(1, dt * 3);
      eco.z[i] = eco.z[i]! + (eco.tz[i]! + Math.sin(eco.t * 2.1) * 0.1 - eco.z[i]!) * Math.min(1, dt * 3);
      eco.vx[i] = eco.vy[i] = eco.vz[i] = 0;
      eco.speed[i] = 0;
      eco.phase[i] = (eco.phase[i]! + dt * 46) % TAU;
      eco.amount[i] = 0.75;
      eco.pitch[i] = eco.pitch[i]! + (0.55 - eco.pitch[i]!) * Math.min(1, dt * 4);
      eco.roll[i] = eco.roll[i]! * Math.max(0, 1 - dt * 5);
      eco.nod[i] = -0.6;
      if (eco.timer[i]! <= 0) {
        const at = eco.patches.at(eco.x[i]!, eco.y[i]!);
        if (eco.random() < 0.3 + 0.3 * clamp(eco.patches.voles[at]! / 2)) {
          // It's seen one: down.
          eco.doing[i] = S.STOOP;
          eco.tz[i] = eco.habitat.height(eco.x[i]!, eco.y[i]!);
        } else this.hoverSpot(eco, i);
      }
      return;
    }
    if (d === S.STOOP) {
      const left = this.fly(eco, i, eco.tx[i]!, eco.ty[i]!, eco.tz[i]! + 0.1, spec.run, 40, dt, 20, 0.15);
      eco.nod[i] = -0.3;
      if (left < 0.5) {
        const at = eco.patches.at(eco.x[i]!, eco.y[i]!);
        const got = eco.random() < clamp(eco.patches.voles[at]! / 2) * 0.7;
        if (got) {
          eco.patches.take(eco.patches.voles, at, 0.5);
          eco.energy[i] = Math.min(spec.reserve, eco.energy[i]! + 1.2);
        }
        eco.doing[i] = S.EAT;
        eco.timer[i] = got ? 5 : 1.2;
        eco.air[i] = 0;
        eco.vx[i] = eco.vy[i] = eco.vz[i] = 0;
        eco.speed[i] = 0;
        eco.pitch[i] = eco.roll[i] = 0;
      }
      return;
    }
    if (d === S.EAT) {
      // On the ground a moment, wings half spread over it.
      eco.amount[i] = 0;
      eco.lie[i] = Math.min(0.6, eco.lie[i]! + dt * 3);
      eco.nod[i] = -0.8 + 0.2 * Math.sin(eco.t * 6);
      if (eco.timer[i]! <= 0) {
        eco.air[i] = 1;
        eco.z[i] = eco.habitat.height(eco.x[i]!, eco.y[i]!) + 0.2;
        this.hoverSpot(eco, i);
      }
      return;
    }
    // On its way to where it'll hang next.
    if (d !== S.GLIDE) this.hoverSpot(eco, i);
    const left = this.fly(eco, i, eco.tx[i]!, eco.ty[i]!, eco.tz[i]!, spec.walk, spec.accel, dt, 20, 0.35 + 0.35 * Math.sin(eco.t * 0.9));
    eco.nod[i] = 0;
    if (left < 1.2) {
      eco.doing[i] = S.HOVER;
      eco.timer[i] = 5 + eco.random() * 8;
    }
  }

  /** Where the kestrel hangs next: over open ground with voles in it, in view. */
  private hoverSpot(eco: Ecosystem, i: number): void {
    const e = eco.env;
    let best = -Infinity;
    for (let c = 0; c < 6; c++) {
      const a = eco.random() * TAU;
      const r = 18 + eco.random() * eco.reach * 0.45;
      const x = e.fx + Math.cos(a) * r;
      const y = e.fy + Math.sin(a) * r;
      const cell = eco.patches.at(x, y);
      if (!((1 << eco.patches.code[cell]!) & OPEN)) continue;
      const score = eco.patches.voles[cell]! - Math.hypot(x - eco.x[i]!, y - eco.y[i]!) * 0.01 + eco.random() * 0.3;
      if (score > best) {
        best = score;
        eco.tx[i] = x;
        eco.ty[i] = y;
      }
    }
    if (best === -Infinity) {
      eco.tx[i] = e.fx;
      eco.ty[i] = e.fy;
    }
    eco.tz[i] = eco.habitat.height(eco.tx[i]!, eco.ty[i]!) + 11 + eco.random() * 5;
    eco.doing[i] = S.GLIDE;
  }

  // ---------- the owl ----------

  private owl(eco: Ecosystem, dt: number): void {
    const k = S.OWL;
    const i = eco.first[k]!;
    if (i === eco.first[k + 1]) return;
    const e = eco.env;
    const spec = SPECS[k]!;
    const want = this.wanted(eco, k, e.storm < 0.5 ? 1 : 0);
    if (!eco.alive[i]) {
      if (want && (this.next[k] = this.next[k]! - dt) <= 0) {
        this.next[k] = 25 + eco.random() * 30;
        // Only where there's a tree to sit in.
        if (!treeNear(eco.habitat, e.fx, e.fy, eco.reach * 0.6, 1 + Math.floor(eco.random() * 50), this.tree)) return;
        const s = this.come(eco, k, 8);
        if (s >= 0) this.perchOn(eco, s, this.tree);
      }
      return;
    }
    let d = eco.doing[i]!;
    eco.timer[i] = eco.timer[i]! - dt;
    if (!want && d !== S.LEAVE) {
      this.go(eco, i);
      d = S.LEAVE;
    }
    if (d === S.LEAVE) {
      this.fly(eco, i, eco.tx[i]!, eco.ty[i]!, this.floor(eco, eco.x[i]!, eco.y[i]!) + 10, spec.run, spec.accel, dt, 9, 0.8);
      return;
    }
    if (d === S.PERCH) {
      // Upright on its perch, its head turning.
      eco.lie[i] = Math.min(1, eco.lie[i]! + dt * 4);
      eco.amount[i] = 0;
      eco.pitch[i] = eco.pitch[i]! * Math.max(0, 1 - dt * 6);
      eco.roll[i] = eco.roll[i]! * Math.max(0, 1 - dt * 6);
      eco.heading[i] = eco.heading[i]! + Math.sin(eco.t * 0.5) * 0.6 * dt;
      if (eco.timer[i]! <= 0 && e.rain < 0.6) {
        // Off to another tree, low over the meadow.
        if (treeNear(eco.habitat, eco.x[i]! + (eco.random() - 0.5) * 60, eco.y[i]! + (eco.random() - 0.5) * 60, 50, 1 + Math.floor(eco.random() * 50), this.tree) && Math.hypot(this.tree.x - eco.x[i]!, this.tree.y - eco.y[i]!) > 12 && Math.hypot(this.tree.x - e.fx, this.tree.y - e.fy) < eco.reach) this.perchOn(eco, i, this.tree);
        else eco.timer[i] = 6;
      }
      return;
    }
    // Gliding: low over the ground between perches, then up onto the next.
    const hx = eco.homeX[i]!;
    const hy = eco.homeY[i]!;
    const far = Math.hypot(hx - eco.x[i]!, hy - eco.y[i]!);
    const low = this.floor(eco, eco.x[i]! + eco.vx[i]! * 0.6, eco.y[i]! + eco.vy[i]! * 0.6) + 2.6;
    const tz = far < 9 ? eco.homeZ[i]! + far * 0.12 : Math.max(low, Math.min(eco.z[i]!, low + 3));
    const left = this.fly(eco, i, hx, hy, tz, Math.min(spec.walk, 1.5 + far * 0.9), spec.accel, dt, 8, far < 9 ? 0.9 : 0.3 + 0.3 * Math.sin(eco.t * 1.1));
    eco.doing[i] = S.GLIDE;
    // A vole on the way, sometimes (it barely checks its flight).
    if (far > 12 && eco.random() < dt * 0.05) {
      const at = eco.patches.at(eco.x[i]!, eco.y[i]!);
      if (eco.random() < clamp(eco.patches.voles[at]! / 2) * 0.6) {
        eco.patches.take(eco.patches.voles, at, 0.5);
        eco.energy[i] = Math.min(spec.reserve, eco.energy[i]! + 1.2);
      }
    }
    if (left < 0.5 && far < 0.5) {
      eco.x[i] = hx;
      eco.y[i] = hy;
      eco.z[i] = eco.homeZ[i]!;
      eco.vx[i] = eco.vy[i] = eco.vz[i] = 0;
      eco.speed[i] = 0;
      eco.doing[i] = S.PERCH;
      eco.timer[i] = 12 + eco.random() * 18;
    }
  }

  /** Sends a bird to a tree's top. */
  private perchOn(eco: Ecosystem, i: number, t: TreeSpot): void {
    eco.homeX[i] = t.x;
    eco.homeY[i] = t.y;
    eco.homeZ[i] = t.z + t.top - (t.top - t.bottom) * 0.1;
    eco.doing[i] = S.GLIDE;
    eco.air[i] = 1;
  }

  // ---------- bats ----------

  private bats(eco: Ecosystem, dt: number): void {
    const k = S.BAT;
    const a = eco.first[k]!;
    const b = eco.first[k + 1]!;
    if (a === b) return;
    const e = eco.env;
    const spec = SPECS[k]!;
    const want = this.wanted(eco, k, e.rain < 0.4 && e.wind < 10 && eco.midges > 0.08 ? 1 : 0);
    if ((this.next[k] = this.next[k]! - dt) <= 0) {
      this.next[k] = 2 + eco.random() * 5;
      if (eco.count[k]! < want) this.come(eco, k, 6);
      else if (eco.count[k]! > want) {
        for (let i = a; i < b; i++) {
          if (eco.alive[i] && eco.doing[i] !== S.LEAVE) {
            this.go(eco, i);
            break;
          }
        }
      }
    }
    for (let i = a; i < b; i++) {
      if (!eco.alive[i]) continue;
      if (eco.doing[i] === S.LEAVE) {
        this.fly(eco, i, eco.tx[i]!, eco.ty[i]!, this.floor(eco, eco.x[i]!, eco.y[i]!) + 9, spec.run, spec.accel, dt, 60, 1);
        continue;
      }
      // A new mark several times a second: that's the flutter. Round a lit lantern, over the water, or about the view.
      if ((eco.timer[i] = eco.timer[i]! - dt) <= 0) {
        eco.timer[i] = 0.3 + eco.random() * 0.8;
        let cx = e.fx;
        let cy = e.fy;
        let spread = 34;
        const pick = (eco.own[i]! * 3 + eco.t * 0.02) % 3;
        if (pick < 1 && this.lightCount && e.lamps > 0.5) {
          const l = (Math.floor(eco.own[i]! * 97) % this.lightCount) * 3;
          cx = this.lights[l]!;
          cy = this.lights[l + 1]!;
          spread = 7;
        } else if (pick < 2 && eco.patches.nearest(e.fx, e.fy, WET, 10, this.spot)) {
          cx = this.spot.x;
          cy = this.spot.y;
          spread = 18;
        }
        const ang = eco.random() * TAU;
        const r = eco.random() * spread;
        eco.tx[i] = cx + Math.cos(ang) * r;
        eco.ty[i] = cy + Math.sin(ang) * r;
        eco.tz[i] = this.floor(eco, eco.tx[i]!, eco.ty[i]!) + 2.4 + eco.random() * 5.5;
        eco.doing[i] = S.HAWK;
        eco.midges = Math.max(0, eco.midges - 0.00004);
      }
      const floor = this.floor(eco, eco.x[i]!, eco.y[i]!) + 1.6;
      this.fly(eco, i, eco.tx[i]!, eco.ty[i]!, Math.max(eco.tz[i]!, floor), spec.walk + 2 * eco.own[i]!, spec.accel, dt, 62, 1);
      if (eco.z[i]! < floor) eco.z[i] = floor;
    }
  }
}

/** A step of everything on the wing. */
export function stepWings(eco: Ecosystem, dt: number): void {
  eco.wings.step(eco, dt);
}

export function stillWings(eco: Ecosystem): void {
  eco.wings.still(eco);
}
