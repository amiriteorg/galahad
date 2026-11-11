import { type Ground, MAX_SLOPE, moveOnGround, rng } from "../physics.ts";
import { emptySeason, type Season } from "../season.ts";
import { WATER_LEVEL } from "../terrain.ts";
import { DRY, emptyTree, FOREST, type Habitat, MEADOW, OPEN, PATCH, Patches, SHALLOW, SHORE, treeNear, WET, WOODS } from "./habitat.ts";
import { clamp, TAU, turnTo } from "./num.ts";
import * as S from "./species.ts";
import { about, breeding, type Caps, KIND_COUNT, KINDS, presence, type Spec, SPECS } from "./species.ts";
import { stepWings, stillWings, Wings } from "./wings.ts";

/*
 * The ecosystem, as a simulation: every animal an agent with its own needs
 * (hunger, thirst, tiredness, fear, company), choosing what to do by what it
 * needs most and what's going on round it, on land that grows what it eats.
 *
 *   needs      Energy is days of an adult's need: burnt by living (more by
 *              running), won by eating what the patch under it holds (grass,
 *              browse, mast, beetles, weed) or by catching something (the fox
 *              a hare or a vole, the heron a fish). Thirst sends the land
 *              animals to the water's edge; tiredness into cover.
 *   choosing   Each animal scores what it could do (a utility for each: eat by
 *              its hunger and the hour, drink by its thirst, rest by its
 *              tiredness and the weather, go to its herd by how far it is)
 *              and does the best, with a bonus for carrying on with what it's
 *              doing, so nobody dithers. Twice a second each, staggered; in
 *              between they only move. Danger doesn't wait for a turn: who's
 *              near (Galahad, his dog, a fox) is looked at every frame.
 *   living     Young come in their season, small, and stay by their mother
 *              until they're weaned and then grown. Animals die of hunger, of
 *              age and by being caught (it's simply gone). What the land grows
 *              bounds them all; more wander in from beyond the range when few
 *              are left, and those the view leaves behind are let go.
 *   clocks     The hour and the season are the world's (the real sun and date
 *              in Denmark); a life runs faster: `pace` days of living pass each
 *              second (a day every four minutes, 96 of them a year of life),
 *              so a leveret born as you watch is weaned in half an hour. The
 *              real night is many such days long: whoever sleeps through it
 *              burns nothing while it sleeps.
 *
 * Structure of arrays, slots in one block per kind, nothing allocated while it
 * runs. Pure: no three.js, seeded, stepped by hand in the tests.
 */

/** What the world tells the ecosystem each step. */
export interface Env {
  season: Season;
  /** 0 by day to 1 in the dead of night; 0..1 in the twilights; 0 in the morning, 1 in the evening. */
  night: number;
  twilight: number;
  evening: number;
  /** The weather (weather.ts' state): rain and storm 0..1, the wind in m/s and where it blows to. */
  rain: number;
  storm: number;
  wind: number;
  windHeading: number;
  /** Lamps lit, 0..1. */
  lamps: number;
  /** Where the view looks: the range is round it. */
  fx: number;
  fy: number;
  /** Galahad and his dog (NaN: not about). */
  gx: number;
  gy: number;
  dx: number;
  dy: number;
}

export const emptyEnv = (): Env => ({ season: emptySeason(), night: 0, twilight: 0, evening: 0, rain: 0, storm: 0, wind: 3, windHeading: 0.35, lamps: 0, fx: 0, fy: 0, gx: Number.NaN, gy: Number.NaN, dx: Number.NaN, dy: Number.NaN });

export interface EcoOptions {
  caps: Caps;
  seed?: number;
  /** The range's radius round the view's focus, metres. */
  reach?: number;
  /** Days of living a second. */
  pace?: number;
  /** Days in a year of living (ages are in years). */
  yearDays?: number;
  /** Whether residents wander in from beyond the range when few are left (the tests of the food web alone turn it off). */
  /**
   * How full of its residents the country beyond keeps the range: while there are fewer than this share of what the
   * range holds, more wander in (0: nobody comes; the default is half).
   */
  arrivals?: number;
}

/** How an animal moves a step on the ground: from (x, y) by `step` towards `heading`, into `out`; the heading taken, or null when there's no way. */
export type Walk = (slot: number, x: number, y: number, heading: number, step: number, out: { x: number; y: number }) => number | null;

/** Why an animal died. */
export const HUNGER = 0;
export const AGE = 1;
export const CAUGHT = 2;

/**
 * Days of living a second: a day every four minutes. Slow enough that a walk to the water and back is a small part
 * of a day (an animal grazes for a minute or two, then has a few minutes for everything else), fast enough that
 * young born as you watch are weaned within the hour.
 */
export const PACE = 1 / 240;
/** Seconds between an animal's decisions (each a little off the others). */
const THINK = 0.5;
/** Days of reserve won in a day spent eating: an animal that eats two fifths of its time holds its own. */
const FILL = 3.5;

/** A ring on the water (a rise, a dabble, a strike): where, how old (seconds), how wide it gets. */
export const RINGS = 12;

export class Ecosystem {
  readonly specs = SPECS;
  readonly caps: Caps;
  readonly reach: number;
  readonly pace: number;
  readonly yearDays: number;
  readonly arrivals: number;
  readonly patches: Patches;
  readonly random: () => number;

  /** Each kind's block of slots: first[k] .. first[k + 1]. */
  readonly first = new Int32Array(KIND_COUNT + 1);
  /** Grown ones of each kind at most (young come on top). */
  readonly grownCap = new Int32Array(KIND_COUNT);
  readonly n: number;

  readonly kind: Uint8Array;
  readonly alive: Uint8Array;
  readonly x: Float64Array;
  readonly y: Float64Array;
  /** Off the ground (`air`): its height (world z). */
  readonly z: Float32Array;
  readonly air: Uint8Array;
  readonly heading: Float32Array;
  readonly speed: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly vz: Float32Array;
  /** Where it's going. */
  readonly tx: Float64Array;
  readonly ty: Float64Array;
  readonly tz: Float32Array;
  /** What it's doing (species.ts' DOING), for how much longer (seconds), and when it next decides. */
  readonly doing: Uint8Array;
  readonly timer: Float32Array;
  readonly think: Float32Array;
  /** Days of need in reserve; thirst and tiredness 0..1. */
  readonly energy: Float32Array;
  readonly thirst: Float32Array;
  readonly tired: Float32Array;
  /** Years: its age, and the age it won't see. */
  readonly age: Float32Array;
  readonly span: Float32Array;
  readonly female: Uint8Array;
  /** Its mother's slot while it's with her (−1: on its own), the herd it keeps with, litters this year. */
  readonly mother: Int16Array;
  readonly group: Int16Array;
  readonly litters: Uint8Array;
  /** What it runs from. */
  readonly fearX: Float64Array;
  readonly fearY: Float64Array;
  /** Its place: a roost, a perch, a trunk, a den. */
  readonly homeX: Float64Array;
  readonly homeY: Float64Array;
  readonly homeZ: Float32Array;
  /** How it's drawn (pose.ts): head down (−1) to up, lying 0..1, its legs' or wings' phase and how hard they work, its tilt, and how much of it shows. */
  readonly nod: Float32Array;
  readonly lie: Float32Array;
  readonly phase: Float32Array;
  readonly amount: Float32Array;
  readonly pitch: Float32Array;
  readonly roll: Float32Array;
  readonly shown: Float32Array;
  /** Going: fading out (it died, or went to ground), then its slot is free. */
  readonly going: Uint8Array;
  /** A number of its own (which perch, which side, which neighbour). */
  readonly own: Float32Array;
  /** Seconds until it will lift its head at a passer-by again: it gets used to someone who only stands there. */
  readonly heed: Float32Array;
  /** The hare a fox is after (−1: none). */
  readonly prey: Int16Array;
  /** Seconds before a frightened animal gets going: its head comes up first (longer if it was down in the grass).  */
  readonly react: Float32Array;
  /** Everything on the wing (wings.ts). */
  readonly wings: Wings;

  /** Rings on the water: x, y, age, reach (RINGS of them, a ring buffer). */
  readonly rings = new Float32Array(RINGS * 4);
  private ring = 0;

  /** Seconds since it began; days of living since. */
  t = 0;
  days = 0;
  /** Births, deaths by cause, and comings and goings, per kind. */
  readonly births = new Int32Array(KIND_COUNT);
  readonly deaths = [new Int32Array(KIND_COUNT), new Int32Array(KIND_COUNT), new Int32Array(KIND_COUNT)];
  readonly came = new Int32Array(KIND_COUNT);
  readonly left = new Int32Array(KIND_COUNT);
  /** How many of each are alive (kept as they come and go), and of those how many are young. */
  readonly count = new Int32Array(KIND_COUNT);
  readonly young = new Int32Array(KIND_COUNT);
  /** What's flying about for the birds and bats to eat, 0..1 (insects.ts shows as many as this). */
  midges = 0.5;

  /** How Galahad and his dog move (m/s), worked out from where they were. */
  gvx = 0;
  gvy = 0;
  dvx = 0;
  dvy = 0;
  private lastG = { x: Number.NaN, y: Number.NaN };
  private lastD = { x: Number.NaN, y: Number.NaN };
  /** The season last told to the patches, the year it was, and when the range was last looked over. */
  private seasonSeen = -1;
  private lastYear = -1;
  private manage = 0;
  private seeded = false;
  private lastFx = Number.NaN;
  private lastFy = Number.NaN;
  /** How much of each kind the range and the season have room for, 0..1 (looked at now and then). */
  readonly room = new Float32Array(KIND_COUNT).fill(1);
  /** How much of each kind is about at this hour, 0..1. */
  readonly about = new Float32Array(KIND_COUNT);
  readonly env: Env = emptyEnv();

  /** The ground as the land animals walk it, and as the water birds do (for the walk among the solids: fauna.ts). */
  readonly land: Ground;
  readonly shore: Ground;
  /** How a step is taken: on the open ground by default; among the solids in the scene. */
  walk: Walk;
  readonly spot = { x: 0, y: 0 };
  readonly tree = emptyTree();
  // Stream pools and what's barred, asked of the habitat once a 2 m cell and remembered a while.
  private readonly barX = new Int32Array(BAR * BAR).fill(0x7fffffff);
  private readonly barY = new Int32Array(BAR * BAR).fill(0x7fffffff);
  private readonly barAt = new Float32Array(BAR * BAR);
  private readonly bar = new Uint8Array(BAR * BAR);

  constructor(
    readonly habitat: Habitat,
    options: EcoOptions,
  ) {
    this.caps = options.caps;
    this.reach = options.reach ?? 130;
    this.pace = options.pace ?? PACE;
    this.yearDays = options.yearDays ?? 96;
    this.arrivals = options.arrivals ?? 0.5;
    this.random = rng(options.seed ?? 7);
    let cells = 32;
    while (cells * PATCH < this.reach * 2.9) cells *= 2;
    this.patches = new Patches(habitat, cells);
    let n = 0;
    for (let k = 0; k < KIND_COUNT; k++) {
      const cap = Math.max(0, Math.floor(this.caps[KINDS[k]!]));
      this.grownCap[k] = cap;
      this.first[k] = n;
      // Those that breed here have room for their young on top.
      n += SPECS[k]!.breedSpan > 0 ? cap + Math.ceil(cap / 2) : cap;
    }
    this.first[KIND_COUNT] = n;
    this.n = n;
    const f32 = () => new Float32Array(n);
    const f64 = () => new Float64Array(n);
    const u8 = () => new Uint8Array(n);
    this.kind = u8();
    for (let k = 0; k < KIND_COUNT; k++) this.kind.fill(k, this.first[k]!, this.first[k + 1]!);
    this.alive = u8();
    this.x = f64();
    this.y = f64();
    this.z = f32();
    this.air = u8();
    this.heading = f32();
    this.speed = f32();
    this.vx = f32();
    this.vy = f32();
    this.vz = f32();
    this.tx = f64();
    this.ty = f64();
    this.tz = f32();
    this.doing = u8();
    this.timer = f32();
    this.think = f32();
    this.energy = f32();
    this.thirst = f32();
    this.tired = f32();
    this.age = f32();
    this.span = f32();
    this.female = u8();
    this.mother = new Int16Array(n).fill(-1);
    this.group = new Int16Array(n);
    this.litters = u8();
    this.fearX = f64();
    this.fearY = f64();
    this.homeX = f64();
    this.homeY = f64();
    this.homeZ = f32();
    this.nod = f32();
    this.lie = f32();
    this.phase = f32();
    this.amount = f32();
    this.pitch = f32();
    this.roll = f32();
    this.shown = f32();
    this.going = u8();
    this.own = f32();
    for (let i = 0; i < n; i++) this.own[i] = this.random();
    this.heed = f32();
    this.prey = new Int16Array(n).fill(-1);
    this.react = f32();
    this.wings = new Wings(this);
    this.rings.fill(1e3);
    this.land = { height: (x, y) => habitat.height(x, y), blocked: (x, y) => !this.dry(x, y) };
    this.shore = { height: (x, y) => habitat.height(x, y), blocked: (x, y) => !this.floats(x, y) };
    this.walk = (slot, x, y, heading, step, out) => (SPECS[this.kind[slot]!]!.realm === S.LAND ? moveOnGround(this.land, x, y, heading, step, out, MAX_SLOPE) : moveOnGround(this.shore, x, y, heading, step, out));
  }

  // ---------- the ground ----------

  /** Whether the habitat bars (x, y): asked once a 2 m cell, and again after a while (plots come and go). */
  barred(x: number, y: number): boolean {
    const cx = Math.floor(x * 0.5);
    const cy = Math.floor(y * 0.5);
    const i = (cy & (BAR - 1)) * BAR + (cx & (BAR - 1));
    if (this.barX[i] !== cx || this.barY[i] !== cy || this.t - this.barAt[i]! > 20) {
      this.barX[i] = cx;
      this.barY[i] = cy;
      this.barAt[i] = this.t;
      this.bar[i] = this.habitat.blocked(cx * 2 + 1, cy * 2 + 1) ? 1 : 0;
    }
    return this.bar[i] === 1;
  }

  /** Where a land animal stands: clear of the water's edge and of what's barred. */
  dry(x: number, y: number): boolean {
    return this.habitat.height(x, y) > WATER_LEVEL + 0.22 && !this.barred(x, y);
  }

  /** Where a duck goes: the water and the strand beside it. */
  floats(x: number, y: number): boolean {
    const h = this.habitat.height(x, y);
    return h < WATER_LEVEL + 0.42 && (h < WATER_LEVEL || !this.barred(x, y));
  }

  /** In the water proper. */
  afloat(x: number, y: number): boolean {
    return this.habitat.height(x, y) < WATER_LEVEL - 0.04;
  }

  // ---------- slots ----------

  /** A new animal of a kind, if there's a slot: its number, or −1. */
  spawn(k: number, x: number, y: number, age: number, female: boolean): number {
    const spec = SPECS[k]!;
    for (let i = this.first[k]!; i < this.first[k + 1]!; i++) {
      if (this.alive[i]) continue;
      this.alive[i] = 1;
      this.going[i] = 0;
      this.x[i] = x;
      this.y[i] = y;
      this.z[i] = 0;
      this.air[i] = 0;
      this.heading[i] = this.random() * TAU;
      this.speed[i] = 0;
      this.vx[i] = this.vy[i] = this.vz[i] = 0;
      this.tx[i] = x;
      this.ty[i] = y;
      this.doing[i] = S.STAND;
      this.timer[i] = this.random() * 2;
      this.think[i] = this.random() * THINK;
      this.energy[i] = spec.reserve * (0.55 + 0.35 * this.random());
      this.thirst[i] = this.random() * 0.5;
      this.tired[i] = this.random() * 0.4;
      this.age[i] = age;
      this.span[i] = spec.life * (0.7 + 0.6 * this.random());
      this.female[i] = female ? 1 : 0;
      this.mother[i] = -1;
      this.group[i] = i;
      this.prey[i] = -1;
      this.heed[i] = 0;
      this.litters[i] = 0;
      this.homeX[i] = x;
      this.homeY[i] = y;
      this.homeZ[i] = 0;
      this.nod[i] = 0;
      this.lie[i] = 0;
      this.phase[i] = this.random() * TAU;
      this.amount[i] = 0;
      this.pitch[i] = this.roll[i] = 0;
      this.shown[i] = 0;
      this.count[k] = this.count[k]! + 1;
      if (age < spec.grown) this.young[k] = this.young[k]! + 1;
      return i;
    }
    return -1;
  }

  /** It's gone: at once (caught, or out of the range), or fading where it lies. */
  remove(i: number, fade = false): void {
    if (!this.alive[i]) return;
    if (fade) {
      this.going[i] = 1;
      return;
    }
    const k = this.kind[i]!;
    this.alive[i] = 0;
    this.going[i] = 0;
    this.shown[i] = 0;
    this.count[k] = this.count[k]! - 1;
    if (this.age[i]! < SPECS[k]!.grown) this.young[k] = this.young[k]! - 1;
    // Its young are on their own.
    for (let j = this.first[k]!; j < this.first[k + 1]!; j++) if (this.mother[j] === i) this.mother[j] = -1;
  }

  /** It died. Caught: it's simply gone. Of hunger or age: it lies down and is gone. */
  die(i: number, cause: number): void {
    if (!this.alive[i] || this.going[i]) return;
    const k = this.kind[i]!;
    this.deaths[cause]![k] = this.deaths[cause]![k]! + 1;
    if (cause === CAUGHT) {
      this.remove(i);
      return;
    }
    // Young still at the teat go with her.
    for (let j = this.first[k]!; j < this.first[k + 1]!; j++) {
      if (this.alive[j] && this.mother[j] === i && this.age[j]! < SPECS[k]!.weaned) this.die(j, HUNGER);
    }
    this.doing[i] = S.REST;
    this.speed[i] = 0;
    this.remove(i, true);
  }

  /** How many grown ones of a kind there are. */
  grown(k: number): number {
    return this.count[k]! - this.young[k]!;
  }

  /** A ring on the water. */
  ripple(x: number, y: number, reach: number): void {
    const r = this.ring * 4;
    this.ring = (this.ring + 1) % RINGS;
    this.rings[r] = x;
    this.rings[r + 1] = y;
    this.rings[r + 2] = 0;
    this.rings[r + 3] = reach;
  }

  // ---------- a step ----------

  step(dt: number, env: Env): void {
    this.begin(dt, env);
    if ((this.manage -= dt) <= 0) {
      this.manage = 0.5;
      this.look();
    }
    const first = this.first;
    for (let k = 0; k < KIND_COUNT; k++) {
      const spec = SPECS[k]!;
      if (spec.realm === S.AIR || first[k] === first[k + 1]) continue;
      for (let i = first[k]!; i < first[k + 1]!; i++) {
        if (!this.alive[i]) continue;
        if (this.going[i]) {
          this.fade(i, dt);
          continue;
        }
        this.shown[i] = Math.min(1, this.shown[i]! + dt * 1.5);
        this.live(i, dt, spec);
        if (!this.alive[i] || this.going[i]) continue;
        if (spec.realm === S.LAND) this.landStep(i, dt, spec);
        else if (spec.realm === S.WATER) this.waterStep(i, dt, spec);
        else if (spec.realm === S.WADER) this.heronStep(i, dt, spec);
        else this.fishStep(i, dt, spec);
      }
    }
    stepWings(this, dt);
    const rings = this.rings;
    for (let r = 2; r < rings.length; r += 4) rings[r] = rings[r]! + dt;
  }

  /**
   * Under reduced motion: nobody moves. The range is still kept (so there's someone to see wherever the view goes),
   * and everyone stands, lies or floats in a tidy pose; what would be on the wing is perched or away.
   */
  still(env: Env): void {
    this.begin(0, env);
    this.look(false);
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i]) continue;
      if (this.going[i]) {
        this.remove(i);
        continue;
      }
      const spec = SPECS[this.kind[i]!]!;
      if (spec.realm === S.AIR) continue;
      this.shown[i] = spec.realm === S.SWIMMER ? 0 : 1;
      this.speed[i] = 0;
      this.amount[i] = 0;
      this.pitch[i] = this.roll[i] = 0;
      if (this.air[i] && this.kind[i] !== S.SQUIRREL) {
        this.air[i] = 0;
        this.z[i] = 0.2;
      }
      const d = this.doing[i]!;
      const lying = d === S.REST || d === S.SLEEP || d === S.CURL;
      const down = d === S.GRAZE || d === S.DRINK || d === S.FORAGE || d === S.EAT;
      if (!lying && !down && d !== S.CLIMB && d !== S.SWIM && d !== S.FISHING) this.doing[i] = spec.realm === S.WATER ? S.SWIM : spec.realm === S.WADER ? S.FISHING : S.STAND;
      this.lie[i] = lying ? 1 : 0;
      this.nod[i] = down ? -1 : lying ? -0.3 : 0;
    }
    stillWings(this);
    this.rings.fill(1e3);
  }

  /** The step's bookkeeping: clocks, the season, how fast Galahad and his dog go. */
  private begin(dt: number, env: Env): void {
    const e = this.env;
    if (env !== e) Object.assign(e, env);
    this.t += dt;
    this.days += dt * this.pace;
    this.patches.now = this.days;
    const year = e.season.year;
    if (Math.abs(year - this.seasonSeen) > 0.002) {
      this.seasonSeen = year;
      this.patches.setSeason(e.season);
    }
    // A new year: everyone may breed again.
    if (year < this.lastYear - 0.5) this.litters.fill(0);
    this.lastYear = year;
    for (let k = 0; k < KIND_COUNT; k++) this.about[k] = about(SPECS[k]!, e.night, e.twilight);
    if (dt > 0) {
      const ease = Math.min(1, dt * 6);
      if (!Number.isNaN(e.gx) && !Number.isNaN(this.lastG.x)) {
        this.gvx += (clamp((e.gx - this.lastG.x) / dt, -12, 12) - this.gvx) * ease;
        this.gvy += (clamp((e.gy - this.lastG.y) / dt, -12, 12) - this.gvy) * ease;
      }
      if (!Number.isNaN(e.dx) && !Number.isNaN(this.lastD.x)) {
        this.dvx += (clamp((e.dx - this.lastD.x) / dt, -12, 12) - this.dvx) * ease;
        this.dvy += (clamp((e.dy - this.lastD.y) / dt, -12, 12) - this.dvy) * ease;
      }
    }
    this.lastG.x = e.gx;
    this.lastG.y = e.gy;
    this.lastD.x = e.dx;
    this.lastD.y = e.dy;
    // What's on the wing to eat: it follows the year's vigour, keeps down in rain and wind, and is eaten (wings.ts).
    const air = e.season.vigour * (1 - e.rain) * clamp(1.3 - e.wind / 11);
    this.midges += (air - this.midges) * Math.min(1, dt * this.pace * 0.6);
  }

  private fade(i: number, dt: number): void {
    this.lie[i] = Math.min(1, this.lie[i]! + dt * 2);
    this.amount[i] = 0;
    this.nod[i] = this.nod[i]! + (-0.6 - this.nod[i]!) * Math.min(1, dt * 3);
    // It lies a moment first.
    if (this.lie[i]! >= 1) this.shown[i] = this.shown[i]! - dt * 0.6;
    if (this.shown[i]! <= 0) this.remove(i);
  }

  // ---------- the range: who comes, who's let go ----------

  /** The range, looked over twice a second: the view's leavings let go, the first of everyone set out, newcomers let in. */
  private look(coming = true): void {
    const e = this.env;
    const jumped = !this.seeded || Math.hypot(e.fx - this.lastFx, e.fy - this.lastFy) > this.reach * 0.8;
    this.lastFx = e.fx;
    this.lastFy = e.fy;
    const out = this.reach * 1.35;
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i]) continue;
      // (What's on the wing comes and goes from farther out.)
      if (jumped || Math.hypot(this.x[i]! - e.fx, this.y[i]! - e.fy) > (SPECS[this.kind[i]!]!.realm === S.AIR ? out * 1.6 : out)) {
        // (Not a death: it's only out of sight.)
        const k = this.kind[i]!;
        if (!jumped) this.left[k] = this.left[k]! + 1;
        this.remove(i);
      }
    }
    if (jumped || this.t - this.roomAt > 12) this.survey();
    if (jumped) {
      this.seeded = true;
      this.settle();
      return;
    }
    if (coming && this.arrivals > 0) this.arrive();
  }

  private roomAt = -1e9;

  /** How much room the range has for each kind: by the ground it needs, and the months it's here. */
  private survey(): void {
    this.roomAt = this.t;
    const e = this.env;
    const p = this.patches;
    const open = p.share(e.fx, e.fy, this.reach, OPEN | (1 << MEADOW));
    const dry = p.share(e.fx, e.fy, this.reach, DRY);
    const woods = p.share(e.fx, e.fy, this.reach, WOODS);
    const wet = p.share(e.fx, e.fy, this.reach, WET);
    const shallow = p.share(e.fx, e.fy, this.reach, 1 << SHALLOW);
    const year = e.season.year;
    const room = this.room;
    const full = (share: number, enough: number): number => clamp(share / enough);
    // (The land carries fewer grazers through the winter.)
    const lean = 0.65 + 0.35 * (1 - e.season.winter);
    room[S.ROE] = full(dry, 0.3) * lean;
    room[S.HARE] = full(open, 0.2) * lean;
    room[S.FOX] = full(dry, 0.3);
    room[S.HEDGEHOG] = full(dry, 0.3) * presence(SPECS[S.HEDGEHOG]!, year);
    room[S.SQUIRREL] = full(woods, 0.06);
    room[S.MALLARD] = full(wet, 0.03);
    room[S.SWAN] = wet > 0.04 ? 1 : 0;
    room[S.HERON] = shallow > 0 || wet > 0.03 ? 1 : 0;
    room[S.FISH] = full(wet, 0.04);
    room[S.SONGBIRD] = 0.55 + 0.45 * Math.max(e.season.leaf, e.season.vigour);
    room[S.SWALLOW] = presence(SPECS[S.SWALLOW]!, year) * (wet > 0.01 || open > 0.2 ? 1 : 0);
    room[S.STARLING] = presence(SPECS[S.STARLING]!, year);
    room[S.GOOSE] = presence(SPECS[S.GOOSE]!, year);
    room[S.KESTREL] = open > 0.15 ? 1 : 0;
    room[S.OWL] = 1;
    room[S.BAT] = presence(SPECS[S.BAT]!, year);
  }

  /** How many grown ones of a kind the range holds now. */
  holds(k: number): number {
    return Math.round(this.grownCap[k]! * this.room[k]!);
  }

  /** A place in the range for a kind to stand (or float), `from`..`to` of the reach from the focus: into `spot`. */
  place(k: number, from: number, to: number): boolean {
    const e = this.env;
    const spec = SPECS[k]!;
    for (let tries = 0; tries < 8; tries++) {
      const a = this.random() * TAU;
      const r = this.reach * (from + (to - from) * Math.sqrt(this.random()));
      let x = e.fx + Math.cos(a) * r;
      let y = e.fy + Math.sin(a) * r;
      if (spec.realm === S.WADER) {
        // The shallows are a narrow band: the nearest of them to a point in the range, then a place in it of the right depth.
        if (!this.patches.nearest(x, y, 1 << SHALLOW, 12, this.spot)) continue;
        x = this.spot.x + (this.random() - 0.5) * 2 * PATCH;
        y = this.spot.y + (this.random() - 0.5) * 2 * PATCH;
      }
      const code = this.patches.code[this.patches.at(x, y)]!;
      if (spec.realm === S.LAND) {
        if (!this.dry(x, y)) continue;
        if (k === S.SQUIRREL && code !== FOREST) continue;
        if (k === S.HARE && code === FOREST && tries < 6) continue;
      } else if (spec.realm === S.WATER) {
        if (!this.afloat(x, y)) continue;
      } else if (spec.realm === S.SWIMMER) {
        if (this.habitat.height(x, y) > WATER_LEVEL - 0.4) continue;
      } else if (spec.realm === S.WADER) {
        const h = this.habitat.height(x, y);
        if (h > WATER_LEVEL - 0.06 || h < WATER_LEVEL - 0.34) continue;
      }
      this.spot.x = x;
      this.spot.y = y;
      return true;
    }
    return false;
  }

  /** The first of everyone, all over the range, as the season has them: grown ones of every age, and in their season young beside their mothers. */
  private settle(): void {
    const year = this.env.season.year;
    for (let k = 0; k < KIND_COUNT; k++) {
      const spec = SPECS[k]!;
      if (spec.realm === S.AIR || !spec.resident) continue;
      const want = Math.round(this.holds(k) * (0.6 + 0.3 * this.random()));
      let leader = -1;
      let band = 0;
      for (let made = 0; made < want; made++) {
        // Herds stand together: the next of a band near its first.
        if (leader >= 0 && band < spec.herd) {
          const a = this.random() * TAU;
          const d = 2 + this.random() * 6;
          this.spot.x = this.x[leader]! + Math.cos(a) * d;
          this.spot.y = this.y[leader]! + Math.sin(a) * d;
          const ok = spec.realm === S.LAND ? this.dry(this.spot.x, this.spot.y) : spec.realm === S.WATER ? this.afloat(this.spot.x, this.spot.y) : this.habitat.height(this.spot.x, this.spot.y) < WATER_LEVEL - 0.4;
          if (!ok && !this.place(k, 0.12, 0.95)) continue;
        } else if (!this.place(k, 0.12, 0.95)) continue;
        // A band's first is a female (the doe the others keep by).
        const i = this.spawn(k, this.spot.x, this.spot.y, spec.grown + (spec.life * 0.6 - spec.grown) * this.random(), band === 0 || leader < 0 || this.random() < 0.6);
        if (i < 0) break;
        this.shown[i] = k === S.HEDGEHOG ? 0 : 1;
        if (leader < 0 || band >= spec.herd) {
          leader = i;
          band = 0;
        }
        this.group[i] = leader;
        band++;
        // In the months after they come, some have this year's young with them.
        const since = (year - spec.breedAt + 1) % 1;
        if (this.female[i] && spec.breedSpan > 0 && since > 0 && since < spec.grown && this.random() < 0.5) {
          const litter = spec.litter[0] + Math.floor(this.random() * (spec.litter[1] - spec.litter[0] + 1));
          for (let b = 0; b < litter; b++) this.bear(i, Math.max(0.01, since * (0.6 + 0.4 * this.random())));
          this.litters[i] = 1;
        }
      }
    }
  }

  /** A young one beside its mother; its slot, or −1 when there's no room. */
  bear(m: number, age = 0): number {
    const k = this.kind[m]!;
    const a = this.random() * TAU;
    const i = this.spawn(k, this.x[m]! + Math.cos(a) * 0.7, this.y[m]! + Math.sin(a) * 0.7, age, this.random() < 0.5);
    if (i < 0) return -1;
    this.mother[i] = m;
    this.group[i] = this.group[m]!;
    this.energy[i] = SPECS[k]!.reserve * 0.7;
    this.shown[i] = age > 0 ? 1 : 0;
    return i;
  }

  /** Where residents are few, one wanders in at the range's edge now and then. */
  private arrive(): void {
    const e = this.env;
    for (let k = 0; k < KIND_COUNT; k++) {
      const spec = SPECS[k]!;
      if (spec.realm === S.AIR || (!spec.resident && k !== S.HERON)) continue;
      const holds = this.holds(k);
      // The country beyond is peopled too: while the range holds fewer than its share of what it could, more wander in.
      const few = Math.min(holds, Math.max(spec.herd > 1 ? 2 : 1, Math.ceil(holds * this.arrivals)));
      if (this.grown(k) >= few || (k === S.HERON && this.about[k]! < 0.3)) continue;
      // (About one every five days of living where there are none; the heron sooner.)
      if (this.random() > 0.5 * this.pace * (k === S.HERON ? 1.5 : 0.2) * (few - this.grown(k) + 1)) continue;
      const age = spec.grown + (spec.life * 0.4 - spec.grown) * this.random();
      if (spec.realm === S.WATER || spec.realm === S.WADER) {
        // The birds of the water come in on the wing, from over the range's edge, down onto the water.
        if (!this.place(k, 0.1, 0.9)) continue;
        const tx = this.spot.x;
        const ty = this.spot.y;
        const a = this.random() * TAU;
        const sx = e.fx + Math.cos(a) * this.reach * 1.25;
        const sy = e.fy + Math.sin(a) * this.reach * 1.25;
        const i = this.spawn(k, sx, sy, age, this.random() < 0.6);
        if (i < 0) continue;
        this.came[k] = this.came[k]! + 1;
        this.air[i] = 1;
        this.z[i] = Math.max(this.habitat.height(sx, sy), WATER_LEVEL) + 7;
        this.heading[i] = Math.atan2(ty - sy, tx - sx);
        this.speed[i] = FLIGHT * 0.7;
        this.tx[i] = tx;
        this.ty[i] = ty;
        this.doing[i] = S.FLY;
        this.timer[i] = 60;
        continue;
      }
      // Fish come up from the deep where they are; the land animals walk in from the edge.
      if (!this.place(k, spec.realm === S.SWIMMER ? 0.1 : 0.92, spec.realm === S.SWIMMER ? 0.95 : 1.12)) continue;
      const i = this.spawn(k, this.spot.x, this.spot.y, age, this.random() < 0.6);
      if (i < 0) continue;
      this.came[k] = this.came[k]! + 1;
      this.doing[i] = S.WALK;
      this.timer[i] = 30;
      this.tx[i] = e.fx + (this.x[i]! - e.fx) * 0.5;
      this.ty[i] = e.fy + (this.y[i]! - e.fy) * 0.5;
      // It joins its kind if there are any.
      for (let j = this.first[k]!; j < this.first[k + 1]!; j++) {
        if (j !== i && this.alive[j] && spec.herd > 1) {
          this.group[i] = this.group[j]!;
          break;
        }
      }
    }
  }

  // ---------- living: needs, young, age ----------

  /** A moment of an animal's life: what it burns, how it grows, whether it bears young, and whether this is its last. */
  private live(i: number, dt: number, spec: Spec): void {
    const k = this.kind[i]!;
    const days = dt * this.pace;
    const was = this.age[i]!;
    const age = was + days / this.yearDays;
    this.age[i] = age;
    if (was < spec.grown && age >= spec.grown) {
      this.young[k] = this.young[k]! - 1;
      this.mother[i] = -1;
    }
    const effort = this.speed[i]! / spec.run;
    const m = this.mother[i]!;
    const d = this.doing[i]!;
    const suckling = m >= 0 && age < spec.weaned;
    // Asleep it burns nothing (the real night is a hundred of its days long); in winter everyone burns less.
    const asleep = d === S.SLEEP || d === S.ROOST;
    if (suckling) {
      // At the teat: it lives on her, and she burns for it.
      const hers = this.energy[m]!;
      if (this.energy[i]! > spec.reserve * 0.75) this.energy[i] = this.energy[i]! - days * 0.4;
      else if (hers > spec.reserve * 0.25) {
        // (It takes what it needs, no more; she can spare it while she's fed herself.)
        this.energy[i] = this.energy[i]! + days * 0.6;
        this.energy[m] = hers - days * 0.18;
      } else this.energy[i] = this.energy[i]! - days * 0.4;
    } else if (!asleep) this.energy[i] = this.energy[i]! - days * (0.75 + 1.7 * effort * effort) * (1 - 0.3 * this.env.season.winter) * (0.45 + 0.55 * this.sizeOf(i, spec));
    if (!asleep) this.thirst[i] = Math.min(1, this.thirst[i]! + days * spec.thirst * (1 - 0.6 * this.env.rain));
    if (d === S.REST || asleep || d === S.CURL) this.tired[i] = Math.max(0, this.tired[i]! - dt / 45);
    else this.tired[i] = Math.min(1, this.tired[i]! + dt * (effort > 0.5 ? 1 / 18 : 1 / 420));
    if (this.energy[i]! <= 0) this.die(i, HUNGER);
    else if (age > this.span[i]!) this.die(i, AGE);
  }

  /** Whether she bears young now: in her season, fed, without young at her side, and with room for them. Checked as she decides. */
  private breed(i: number, spec: Spec): void {
    if (!this.female[i] || this.age[i]! < spec.grown || this.litters[i]! >= spec.litters) return;
    const season = breeding(spec, this.env.season.year);
    if (season <= 0 || this.energy[i]! < spec.reserve * 0.55) return;
    const k = this.kind[i]!;
    // Room: the land holds only so many, and this year's young count for half.
    if (this.grown(k) + this.young[k]! * 0.5 >= this.holds(k)) return;
    // (More likely than not within a day at the season's height: a fed female in her season breeds.)
    if (this.random() > THINK * this.pace * 1.2 * season) return;
    for (let j = this.first[k]!; j < this.first[k + 1]!; j++) if (this.alive[j] && this.mother[j] === i && this.age[j]! < spec.weaned) return;
    const litter = spec.litter[0] + Math.floor(this.random() * (spec.litter[1] - spec.litter[0] + 1));
    let born = 0;
    for (let b = 0; b < litter; b++) if (this.bear(i) >= 0) born++;
    if (!born) return;
    this.births[k] = this.births[k]! + born;
    this.litters[i] = this.litters[i]! + 1;
    this.energy[i] = this.energy[i]! - spec.reserve * 0.2;
  }

  /** Eats from a pool where it stands, for the time since it last decided. Returns what it got (in days of its need). */
  private eat(i: number, spec: Spec, pool: Float32Array, at: number): number {
    const want = FILL * THINK * this.pace * spec.need * this.sizeOf(i, spec);
    const got = this.patches.take(pool, at, want);
    this.energy[i] = Math.min(spec.reserve, this.energy[i]! + got / spec.need);
    return got / want;
  }

  /** A bird's few seconds of feeding at cell `at` (wings.ts). */
  feed(i: number, spec: Spec, pool: Float32Array, at: number, seconds: number): void {
    const got = this.patches.take(pool, at, FILL * seconds * this.pace * spec.need);
    this.energy[i] = Math.min(spec.reserve, this.energy[i]! + got / spec.need);
  }

  /** How big it is beside a grown one (0.42 new-born to 1). */
  sizeOf(i: number, spec: Spec): number {
    return spec.grown > 0 ? 0.42 + 0.58 * clamp(this.age[i]! / spec.grown) : 1;
  }

  // ---------- danger ----------

  /**
   * Who's near, every frame: Galahad and his dog. Each animal has a distance at which it lifts its head and one at
   * which it goes; someone standing still gets half of it, someone running at it nearly twice. Returns the nearer
   * one's distance, having set what it runs from when it should run (`scare` 2), or watch (1), or neither (0).
   */
  private scare = 0;
  private danger(i: number, spec: Spec): void {
    const e = this.env;
    const x = this.x[i]!;
    const y = this.y[i]!;
    this.scare = 0;
    const calm = this.doing[i] === S.REST || this.doing[i] === S.SLEEP ? 0.7 : 1;
    for (let who = 0; who < 2; who++) {
      const px = who ? e.dx : e.gx;
      if (Number.isNaN(px)) continue;
      const py = who ? e.dy : e.gy;
      const d = Math.hypot(x - px, y - py);
      if (d > spec.wary * 2.2) continue;
      const vx = who ? this.dvx : this.gvx;
      const vy = who ? this.dvy : this.gvy;
      const pace = Math.hypot(vx, vy);
      // How fast it's coming this way.
      const closing = d > 0.01 ? (vx * (x - px) + vy * (y - py)) / d : 0;
      const push = (0.5 + 0.5 * Math.min(1, pace / 1.2)) * (closing > 2.6 ? (who ? 1.9 : 1.5) : pace > 3 ? 1.2 : 1) * calm;
      const level = d < spec.flight * push ? 2 : d < spec.wary * push ? 1 : 0;
      if (level > this.scare) {
        this.scare = level;
        this.fearX[i] = px;
        this.fearY[i] = py;
      }
    }
  }

  /** Everything within `r` of (x, y) takes fright (a shout, a thrown ball, the dog's bark). */
  startle(x: number, y: number, r: number): void {
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i] || this.going[i] || Math.hypot(this.x[i]! - x, this.y[i]! - y) > r) continue;
      const spec = SPECS[this.kind[i]!]!;
      this.fearX[i] = x;
      this.fearY[i] = y;
      if (spec.realm === S.LAND) this.bolt(i, spec);
      else if (spec.realm === S.WATER) this.splash(i);
      else if (spec.realm === S.WADER) this.heronGo(i, true);
      else if (spec.realm === S.SWIMMER) this.dart(i);
      else this.timer[i] = -1e3; // On the wing or perched: wings.ts reads this as a fright.
    }
  }

  /**
   * The nearest small animal within `r` of (x, y) that a dog might give a short chase: a hare, a squirrel on the
   * ground, a duck ashore, a bird feeding on the ground. Into `out` (its place and what it is); false: none.
   */
  nearestSmall(x: number, y: number, r: number, out: { x: number; y: number; kind: string; slot: number }): boolean {
    let best = r;
    let found = -1;
    for (let pass = 0; pass < SMALL.length; pass++) {
      const k = SMALL[pass]!;
      for (let i = this.first[k]!; i < this.first[k + 1]!; i++) {
        if (!this.alive[i] || this.going[i] || this.air[i] || this.shown[i]! < 0.5) continue;
        if (k === S.MALLARD && this.afloat(this.x[i]!, this.y[i]!)) continue;
        if (k === S.SONGBIRD && this.doing[i] !== S.PECK) continue;
        const d = Math.hypot(this.x[i]! - x, this.y[i]! - y);
        if (d < best) {
          best = d;
          found = i;
        }
      }
    }
    if (found < 0) return false;
    out.x = this.x[found]!;
    out.y = this.y[found]!;
    out.kind = KINDS[this.kind[found]!]!;
    out.slot = found;
    return true;
  }

  // ---------- the land animals ----------

  private landStep(i: number, dt: number, spec: Spec): void {
    const k = this.kind[i]!;
    const d = this.doing[i]!;
    this.timer[i] = this.timer[i]! - dt;
    // Danger first.
    if (d !== S.FLEE && d !== S.CURL && !this.hidden(i)) {
      this.danger(i, spec);
      if (k === S.HEDGEHOG) {
        // It doesn't run from anyone: it curls up where it is until they've gone.
        if (this.scare > 0 && Math.hypot(this.x[i]! - this.fearX[i]!, this.y[i]! - this.fearY[i]!) < spec.wary * 0.6) {
          this.doing[i] = S.CURL;
          this.timer[i] = 6;
        }
      } else if (this.scare === 2) this.bolt(i, spec);
      else if (this.scare === 1 && d !== S.CHASE && d !== S.CLIMB) {
        // Heads up. A deer or a fox moves off before it must run.
        const near = Math.hypot(this.x[i]! - this.fearX[i]!, this.y[i]! - this.fearY[i]!);
        if ((k === S.ROE || k === S.FOX) && near < (spec.wary + spec.flight) * 0.42) this.moveOff(i, spec);
        else if (d !== S.ALERT && this.heed[i]! <= 0 && (d !== S.WALK || this.speed[i]! < spec.walk * 1.2)) {
          // A long look; then it goes back to what it was at for a while, unless they come nearer.
          this.doing[i] = S.ALERT;
          this.timer[i] = 2.5 + this.random() * 2.5;
          this.heed[i] = this.timer[i]! + 7 + this.random() * 8;
        }
      }
    }
    this.heed[i] = this.heed[i]! - dt;
    this.react[i] = this.react[i]! - dt;
    if ((this.think[i] = this.think[i]! - dt) <= 0) {
      this.think[i] = THINK * (0.8 + 0.4 * this.random());
      this.decide(i, spec);
    }
    this.moveOnLand(i, dt, spec);
  }

  /** Out of sight in its cover (the hedgehog by day): nothing bothers it. */
  private hidden(i: number): boolean {
    return this.kind[i] === S.HEDGEHOG && this.doing[i] === S.SLEEP;
  }

  /** It runs for its life: away from what frightened it, for the trees if they're near; its herd goes with it. */
  private bolt(i: number, spec: Spec): void {
    const k = this.kind[i]!;
    if (k === S.SQUIRREL) {
      this.treed(i);
      return;
    }
    if (k === S.HEDGEHOG) {
      this.doing[i] = S.CURL;
      this.timer[i] = 6;
      return;
    }
    const was = this.doing[i];
    // Its head comes up before it goes: a moment, and a longer one if it was down in the grass or lying.
    if (was !== S.FLEE) this.react[i] = (0.1 + 0.2 * this.random()) * (was === S.GRAZE || was === S.DRINK || was === S.REST || was === S.SLEEP ? 1.9 : 1);
    this.doing[i] = S.FLEE;
    this.timer[i] = 2.5 + this.random() * 1.5;
    this.away(i, 30);
    if (was === S.FLEE || spec.herd <= 1) return;
    // The alarm: its band within earshot goes too, and the young with their mothers.
    for (let j = this.first[k]!; j < this.first[k + 1]!; j++) {
      if (j === i || !this.alive[j] || this.going[j] || this.doing[j] === S.FLEE) continue;
      if (this.group[j] !== this.group[i] && this.mother[j] !== i) continue;
      if (Math.hypot(this.x[j]! - this.x[i]!, this.y[j]! - this.y[i]!) > 32) continue;
      this.fearX[j] = this.fearX[i]!;
      this.fearY[j] = this.fearY[i]!;
      this.doing[j] = S.FLEE;
      this.timer[j] = 2.5 + this.random() * 1.5;
      this.away(j, 30);
    }
  }

  /** Sets its target `far` metres away from what it fears: the clearest of five ways. */
  private away(i: number, far: number): void {
    const x = this.x[i]!;
    const y = this.y[i]!;
    const base = Math.atan2(y - this.fearY[i]!, x - this.fearX[i]!);
    let best = -Infinity;
    let pick = base;
    for (let c = 0; c < 5; c++) {
      const a = base + AWAY[c]!;
      let score = -Math.abs(AWAY[c]!) * 0.6 + this.random() * 0.25;
      // How far that way is open; trees are welcome.
      for (let s = 1; s <= 3; s++) {
        const px = x + Math.cos(a) * far * (s / 3);
        const py = y + Math.sin(a) * far * (s / 3);
        if (!this.dry(px, py)) {
          score -= 1.5 / s;
          break;
        }
        if (s === 3 && this.patches.code[this.patches.at(px, py)] === FOREST) score += 0.3;
        // (Not out of the range if there's another way: it would only be let go there.)
        if (s === 3 && Math.hypot(px - this.env.fx, py - this.env.fy) > this.reach * 1.1) score -= 0.8;
      }
      if (score > best) {
        best = score;
        pick = a;
      }
    }
    this.tx[i] = x + Math.cos(pick) * far;
    this.ty[i] = y + Math.sin(pick) * far;
  }

  /** A deer or a fox that's been come too near walks off, briskly, before it has to run. */
  private moveOff(i: number, spec: Spec): void {
    if (this.doing[i] === S.WALK && this.timer[i]! > 0 && this.speed[i]! > spec.walk) return;
    this.doing[i] = S.WALK;
    this.timer[i] = 5;
    this.away(i, 16);
    this.speed[i] = Math.max(this.speed[i]!, spec.walk * 2);
  }

  /** What a land animal does next. */
  private decide(i: number, spec: Spec): void {
    const k = this.kind[i]!;
    const d = this.doing[i]!;
    const e = this.env;
    const x = this.x[i]!;
    const y = this.y[i]!;
    const at = this.patches.at(x, y);
    const p = this.patches;
    // ---- what it's in the middle of ----
    // (On a trunk: it sees that through, to the fork and down again.)
    if (d === S.CLIMB) return;
    if (d === S.FLEE) {
      // What it runs from moves too: who's nearest now (a walker, or the fox).
      this.danger(i, spec);
      if (k === S.HARE || k === S.SQUIRREL) {
        let near = this.scare ? Math.hypot(x - this.fearX[i]!, y - this.fearY[i]!) : 30;
        for (let j = this.first[S.FOX]!; j < this.first[S.FOX + 1]!; j++) {
          if (!this.alive[j] || this.going[j]) continue;
          const dj = Math.hypot(this.x[j]! - x, this.y[j]! - y);
          if (dj < near) {
            near = dj;
            this.fearX[i] = this.x[j]!;
            this.fearY[i] = this.y[j]!;
          }
        }
      }
      const far = Math.hypot(x - this.fearX[i]!, y - this.fearY[i]!);
      if (this.timer[i]! > 0 || far < spec.flight * 2.4) {
        // Still running: the way is looked at again. Hares jink.
        this.away(i, 30);
        if (k === S.HARE) {
          const j = (this.random() - 0.5) * 1.4;
          const dx = this.tx[i]! - x;
          const dy = this.ty[i]! - y;
          this.tx[i] = x + dx * Math.cos(j) - dy * Math.sin(j);
          this.ty[i] = y + dx * Math.sin(j) + dy * Math.cos(j);
        }
        return;
      }
      // Far enough: it pulls up and looks back.
      this.doing[i] = S.SETTLE;
      this.timer[i] = 3 + this.random() * 3;
      return;
    }
    if ((k === S.HARE || k === S.SQUIRREL) && d !== S.CLIMB && this.foxNear(i, spec)) return;
    if ((d === S.SETTLE || d === S.ALERT || d === S.CURL || d === S.EAT) && this.timer[i]! > 0) return;
    if (d === S.CHASE || d === S.STALK || d === S.MOUSE) {
      if (this.hunt(i, spec)) return;
    }
    this.breed(i, spec);
    // ---- the young keep by their mother ----
    const m = this.mother[i]!;
    if (m >= 0 && this.alive[m] && !this.going[m]) {
      const gap = Math.hypot(this.x[m]! - x, this.y[m]! - y);
      const hers = this.doing[m]!;
      if (hers === S.FLEE) {
        this.fearX[i] = this.fearX[m]!;
        this.fearY[i] = this.fearY[m]!;
        this.doing[i] = S.FLEE;
        this.timer[i] = 2;
        this.away(i, 30);
        return;
      }
      if (gap > 3.5 || this.age[i]! < spec.weaned) {
        // At her side: a little behind and to one side, doing as she does.
        const side = this.own[i]! < 0.5 ? 1 : -1;
        const h = this.heading[m]!;
        this.tx[i] = this.x[m]! - Math.cos(h) * 1.1 - Math.sin(h) * side * 0.8;
        this.ty[i] = this.y[m]! - Math.sin(h) * 1.1 + Math.cos(h) * side * 0.8;
        this.doing[i] = gap > 1.8 ? S.FOLLOW : hers === S.REST || hers === S.SLEEP ? hers : hers === S.GRAZE && this.age[i]! > spec.weaned * 0.5 ? S.GRAZE : S.FOLLOW;
        this.timer[i] = 1;
        if (this.doing[i] === S.GRAZE) this.eat(i, spec, k === S.FOX ? p.voles : p.graze, at);
        return;
      }
    }
    // ---- what it needs ----
    const active = this.about[k]!;
    const hunger = this.hungerOf(i, spec);
    const thirst = this.thirst[i]!;
    const tired = this.tired[i]!;
    const wet = Math.max(e.rain, e.storm);
    // The hedgehog is only out at night; by day (and in the cold months) it's under its bush.
    if (k === S.HEDGEHOG) {
      if (active < 0.25 || this.room[k]! < 0.5) {
        this.doing[i] = S.SLEEP;
        this.timer[i] = 5;
        return;
      }
    }
    let best = S.WALK;
    let score = 0.1 + 0.12 * active;
    const keep = (what: number, u: number): void => {
      // Carrying on with what it's doing counts for something: nobody dithers.
      const v = u + (what === d ? 0.14 : 0);
      if (v > score) {
        score = v;
        best = what;
      }
    };
    const food = k === S.FOX ? S.STALK : k === S.HEDGEHOG || k === S.SQUIRREL ? S.FORAGE : S.GRAZE;
    keep(food, hunger * (0.9 + 0.5 * active) * (hunger > 0.15 || d === food ? 1 : 0.4));
    if (spec.thirst > 0.25) keep(S.DRINK, thirst > 0.6 || d === S.DRINK ? 0.3 + thirst * 0.75 : thirst * 0.2);
    keep(S.REST, tired * 0.85 + (1 - active) * 0.5 + wet * 0.45);
    // The herd: gone too far from it, it goes back; and its turn to keep watch comes round.
    let herdX = x;
    let herdY = y;
    if (spec.herd > 1) {
      // Its band: how many grown ones, where it comes among them, how many are at their ease, and where they all are.
      let n = 0;
      let rank = 0;
      let calm = 0;
      let members = 0;
      let sx = 0;
      let sy = 0;
      for (let j = this.first[k]!; j < this.first[k + 1]!; j++) {
        if (!this.alive[j] || this.going[j] || this.group[j] !== this.group[i]) continue;
        members++;
        sx += this.x[j]!;
        sy += this.y[j]!;
        if (this.age[j]! < spec.grown) continue;
        if (j < i) rank++;
        n++;
        const dj = this.doing[j];
        if (dj === S.GRAZE || dj === S.REST || dj === S.STAND || dj === S.WATCH) calm++;
      }
      if (members > 1) {
        herdX = sx / members;
        herdY = sy / members;
        const apart = Math.hypot(herdX - x, herdY - y);
        keep(S.FOLLOW, apart > 9 ? 0.5 + apart / 40 : 0);
        // One of them has its head up while the others feed: each in turn, a few seconds in every twenty.
        if (n > 1 && this.age[i]! >= spec.grown && calm >= 2 && rank === Math.floor(this.t / 20 + this.group[i]!) % n && this.t % 20 < 7 && active > 0.3) keep(S.WATCH, 0.75);
      }
    }
    // ---- doing it ----
    if (best === S.GRAZE || best === S.FORAGE) {
      // (The deer browses where there's more of that than grass; the squirrel takes what the wood has: mast, buds, beetles.)
      const pool = best === S.GRAZE ? (k === S.ROE && p.browse[at]! > p.graze[at]! ? p.browse : p.graze) : k === S.HEDGEHOG ? p.bugs : p.mast[at]! >= p.bugs[at]! && p.mast[at]! >= p.browse[at]! * 0.4 ? p.mast : p.bugs[at]! >= p.browse[at]! * 0.4 ? p.bugs : p.browse;
      const here = pool[at]!;
      const arrived = Math.hypot(this.tx[i]! - x, this.ty[i]! - y) < 1.2;
      if (d === best && arrived && here > 0.12 * spec.need) {
        // Feeding where it stands; a step on now and then.
        this.eat(i, spec, pool, at);
        if (this.timer[i]! <= 0) {
          this.timer[i] = 4 + this.random() * 7;
          const a = this.heading[i]! + (this.random() - 0.5) * 1.6;
          const step = 0.8 + this.random() * 1.6;
          if (this.dry(x + Math.cos(a) * step, y + Math.sin(a) * step)) {
            this.tx[i] = x + Math.cos(a) * step;
            this.ty[i] = y + Math.sin(a) * step;
          }
        }
      } else if (d !== best || arrived || this.timer[i]! <= 0) {
        // Somewhere better to feed: the richest of a few looks about, not too far (and near the herd).
        this.forage(i, k, best === S.GRAZE ? (k === S.ROE ? 2 : 0) : k === S.HEDGEHOG ? 3 : 1, herdX, herdY);
        this.timer[i] = 12;
      }
      this.doing[i] = best;
      return;
    }
    if (best === S.DRINK) {
      if (d === S.DRINK) {
        if (Math.hypot(this.tx[i]! - x, this.ty[i]! - y) < 0.9) {
          // At the water's edge, head down, a few seconds.
          if (this.timer[i]! > 6) this.timer[i] = 4 + this.random() * 3;
          else if (this.timer[i]! <= 0) {
            this.thirst[i] = 0;
            this.doing[i] = S.STAND;
          }
        } else if (this.timer[i]! <= 0) {
          // It never got there: it does without for now.
          this.thirst[i] = 0.3;
          this.doing[i] = S.STAND;
        }
        return;
      }
      if (this.waterside(i)) {
        this.doing[i] = S.DRINK;
        this.timer[i] = 90;
      } else this.thirst[i] = 0.25; // No water in reach: the dew does.
      return;
    }
    if (best === S.REST && k === S.SQUIRREL && treeNear(this.habitat, x, y, 20, 0, this.tree)) {
      // The squirrel rests up a tree: up the trunk to a fork, and down again when it has a mind to.
      this.fearX[i] = x + (this.own[i]! - 0.5) * 8;
      this.fearY[i] = y + ((this.own[i]! * 7) % 1 - 0.5) * 8;
      this.treed(i);
      this.timer[i] = (active < 0.3 ? 60 : 18) + this.random() * 20;
      return;
    }
    if (best === S.REST) {
      if (d !== S.REST && d !== S.SLEEP) {
        // Into cover, if there's some near: under the trees.
        if (p.code[at] !== FOREST && p.nearest(x, y, WOODS, 5, this.spot) && this.dry(this.spot.x, this.spot.y)) {
          this.tx[i] = this.spot.x + (this.random() - 0.5) * 5;
          this.ty[i] = this.spot.y + (this.random() - 0.5) * 5;
        } else {
          this.tx[i] = x;
          this.ty[i] = y;
        }
        this.timer[i] = 20 + this.random() * 25;
      } else if (this.timer[i]! <= 0 && tired < 0.2 && active > 0.5 && wet < 0.4) {
        this.doing[i] = S.STAND;
        this.timer[i] = 2;
        return;
      }
      this.doing[i] = active < 0.3 && wet < 0.5 ? S.SLEEP : wet > 0.5 && tired < 0.5 ? S.SHELTER : S.REST;
      return;
    }
    if (best === S.FOLLOW) {
      this.tx[i] = herdX + (this.random() - 0.5) * 6;
      this.ty[i] = herdY + (this.random() - 0.5) * 6;
      this.doing[i] = S.WALK;
      this.timer[i] = 8;
      return;
    }
    if (best === S.WATCH) {
      this.doing[i] = S.WATCH;
      this.timer[i] = 2;
      return;
    }
    if (best === S.STALK) {
      this.hunt(i, spec);
      return;
    }
    // Going about: a walk to somewhere in the range, a stand, a look round.
    if (d === S.WALK && this.timer[i]! > 0 && Math.hypot(this.tx[i]! - x, this.ty[i]! - y) > 1.5) return;
    if (d === S.WALK || this.random() < 0.3) {
      this.doing[i] = S.STAND;
      this.timer[i] = 2 + this.random() * 5;
      return;
    }
    if (d === S.STAND && this.timer[i]! > 0) return;
    this.roam(i, k, herdX, herdY);
  }

  /** Somewhere to go: a point in the range, near its herd, on its own kind of ground. */
  private roam(i: number, k: number, herdX: number, herdY: number): void {
    const e = this.env;
    const x = this.x[i]!;
    const y = this.y[i]!;
    for (let tries = 0; tries < 4; tries++) {
      const a = this.random() * TAU;
      const r = 8 + this.random() * 22;
      let px = (SPECS[k]!.herd > 1 ? herdX : x) + Math.cos(a) * r;
      let py = (SPECS[k]!.herd > 1 ? herdY : y) + Math.sin(a) * r;
      // Not out of the range: turned back towards the view.
      const out = Math.hypot(px - e.fx, py - e.fy);
      if (out > this.reach * 0.92) {
        px = x + (e.fx - x) * 0.25 + Math.cos(a) * 4;
        py = y + (e.fy - y) * 0.25 + Math.sin(a) * 4;
      }
      if (!this.dry(px, py)) continue;
      if (k === S.SQUIRREL && this.patches.code[this.patches.at(px, py)] !== FOREST) continue;
      this.tx[i] = px;
      this.ty[i] = py;
      this.doing[i] = S.WALK;
      this.timer[i] = 25;
      return;
    }
    this.doing[i] = S.STAND;
    this.timer[i] = 2;
  }

  /** The richest of a few places near to feed: `what` 0 grass, 1 mast, 2 grass or browse, 3 beetles. Its target. */
  private forage(i: number, k: number, what: number, herdX: number, herdY: number): void {
    const p = this.patches;
    const e = this.env;
    const x = this.x[i]!;
    const y = this.y[i]!;
    let best = -Infinity;
    for (let c = 0; c < 6; c++) {
      const a = this.random() * TAU;
      const r = c === 0 ? 2 : 5 + this.random() * 20;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (!this.dry(px, py) || Math.hypot(px - e.fx, py - e.fy) > this.reach * 0.95) continue;
      const cell = p.at(px, py);
      const there = what === 0 ? p.graze[cell]! : what === 1 ? Math.max(p.mast[cell]!, p.bugs[cell]!, p.browse[cell]! * 0.4) : what === 2 ? Math.max(p.graze[cell]!, p.browse[cell]!) : p.bugs[cell]!;
      // Nearer is better; so is nearer the herd.
      const score = there - r * 0.05 - (SPECS[k]!.herd > 1 ? Math.hypot(px - herdX, py - herdY) * 0.04 : 0);
      if (score > best) {
        best = score;
        this.tx[i] = px;
        this.ty[i] = py;
      }
    }
  }

  /** Sets its target at the nearest water's edge: the last dry ground on the way to the nearest water. False: none in reach. */
  private waterside(i: number): boolean {
    const x = this.x[i]!;
    const y = this.y[i]!;
    if (!this.patches.nearest(x, y, WET, 14, this.spot)) return false;
    const wx = this.spot.x;
    const wy = this.spot.y;
    const d = Math.hypot(wx - x, wy - y);
    if (d < 0.01) return false;
    const ux = (wx - x) / d;
    const uy = (wy - y) / d;
    // Back from the water until the ground is dry.
    for (let back = 0; back <= d + PATCH; back += 0.5) {
      const px = wx - ux * back;
      const py = wy - uy * back;
      if (this.dry(px, py)) {
        this.tx[i] = px;
        this.ty[i] = py;
        return true;
      }
    }
    return false;
  }

  /** The squirrel's refuge: the nearest trunk, round its far side. */
  private treed(i: number): void {
    const x = this.x[i]!;
    const y = this.y[i]!;
    if (!treeNear(this.habitat, x, y, 28, 0, this.tree)) {
      this.doing[i] = S.FLEE;
      this.timer[i] = 2.5;
      this.away(i, 20);
      return;
    }
    const t = this.tree;
    this.homeX[i] = t.x;
    this.homeY[i] = t.y;
    this.homeZ[i] = t.z;
    // (own: the trunk's radius and how high it goes are kept in its target.)
    this.tx[i] = t.x;
    this.ty[i] = t.y;
    this.tz[i] = t.z + Math.max(1.2, t.bottom * (0.55 + 0.4 * this.own[i]!));
    this.vz[i] = t.trunk;
    this.doing[i] = S.CLIMB;
    this.timer[i] = 14 + this.random() * 10;
  }

  /**
   * The fox's hunt. Voles: a slow walk through the grass, a stand with its head cocked, and the high pounce. A hare
   * in sight and the fox hungry enough: a stalk as near as it can get, then the chase; caught, the hare is gone
   * and the fox eats. Returns true while the hunt goes on.
   */
  private hunt(i: number, spec: Spec): boolean {
    const d = this.doing[i]!;
    const x = this.x[i]!;
    const y = this.y[i]!;
    const p = this.patches;
    const hunger = this.hungerOf(i, spec);
    if (d === S.MOUSE) {
      if (this.timer[i]! > 0) return true;
      // The pounce is over: did it get one? More likely where there are more.
      const at = p.at(x, y);
      if (this.random() < clamp(p.voles[at]! / 2.2) * 0.75) {
        p.take(p.voles, at, 0.5);
        this.energy[i] = Math.min(spec.reserve, this.energy[i]! + 0.4);
        this.provide(i, 0.35);
        this.doing[i] = S.EAT;
        this.timer[i] = 3;
        return true;
      }
      this.doing[i] = S.STALK;
      this.timer[i] = 0;
    }
    // A hare worth the run? Not straight after one got away. A grown hare outruns a fox: it wants one that's near,
    // small or tired, with its head down, and gets as close as it can before it goes.
    if (hunger > 0.2 && (d === S.CHASE || this.heed[i]! <= 0)) {
      let prey = d === S.CHASE ? this.prey[i]! : -1;
      if (prey >= 0 && (!this.alive[prey] || this.going[prey])) prey = -1;
      let near = prey >= 0 ? Math.hypot(this.x[prey]! - x, this.y[prey]! - y) : Infinity;
      if (prey < 0 && d !== S.CHASE) {
        let best = 0.18;
        const hare = SPECS[S.HARE]!;
        for (let j = this.first[S.HARE]!; j < this.first[S.HARE + 1]!; j++) {
          if (!this.alive[j] || this.going[j]) continue;
          const dj = Math.hypot(this.x[j]! - x, this.y[j]! - y);
          if (dj > 36) continue;
          const dh = this.doing[j]!;
          // (One lying up in the wood is as good as hidden.)
          const hidden = (dh === S.REST || dh === S.SLEEP) && this.patches.code[this.patches.at(this.x[j]!, this.y[j]!)] === FOREST;
          const unaware = dh === S.FLEE ? 0.12 : hidden ? 0.15 : dh === S.GRAZE || dh === S.REST || dh === S.SLEEP ? 1 : 0.55;
          const chance = (1 - dj / 36) * unaware * (1 + 1.6 * (1 - this.sizeOf(j, hare))) * (1 + this.tired[j]!);
          if (chance > best) {
            best = chance;
            prey = j;
            near = dj;
          }
        }
      }
      if (prey >= 0) {
        if (d === S.CHASE) {
          // It gives up when the hare's away, or it's blown; and leaves hares alone for a while.
          if (this.timer[i]! <= 0 || near > 32) prey = -1;
        } else if (near < 5.5 || (this.doing[prey] === S.FLEE && near < 13)) {
          this.doing[i] = S.CHASE;
          this.timer[i] = 5 + this.random() * 3;
        } else if (this.doing[prey] === S.FLEE) {
          // It's been seen from too far off: no use.
          prey = -1;
          this.heed[i] = 20;
        } else {
          this.doing[i] = S.STALK;
          this.timer[i] = 3;
        }
      }
      this.prey[i] = prey;
      if (prey >= 0) {
        this.tx[i] = this.x[prey]!;
        this.ty[i] = this.y[prey]!;
        return true;
      }
      if (d === S.CHASE) {
        this.doing[i] = S.STAND;
        this.timer[i] = 4;
        this.tired[i] = Math.min(1, this.tired[i]! + 0.25);
        this.heed[i] = 25 + this.random() * 30;
        return false;
      }
    }
    if (hunger < 0.2 && d !== S.STALK) return false;
    if (hunger < 0.08) return false;
    // Mousing: to a patch with voles in it, slowly; there, the stand and the pounce.
    const arrived = Math.hypot(this.tx[i]! - x, this.ty[i]! - y) < 1.5;
    if (d === S.STALK && arrived) {
      this.doing[i] = S.MOUSE;
      this.timer[i] = 1.4 + this.random() * 1.6 + POUNCE;
      return true;
    }
    if (d !== S.STALK || this.timer[i]! <= 0) {
      let best = -Infinity;
      for (let c = 0; c < 6; c++) {
        const a = this.random() * TAU;
        const r = 6 + this.random() * 22;
        const px = x + Math.cos(a) * r;
        const py = y + Math.sin(a) * r;
        if (!this.dry(px, py) || Math.hypot(px - this.env.fx, py - this.env.fy) > this.reach * 0.95) continue;
        const score = p.voles[p.at(px, py)]! - r * 0.03;
        if (score > best) {
          best = score;
          this.tx[i] = px;
          this.ty[i] = py;
        }
      }
      this.doing[i] = S.STALK;
      this.timer[i] = 25;
    }
    return true;
  }

  /** How hungry it is, 0..1: a vixen with cubs is as hungry as the hungriest of them (she hunts for them too). */
  private hungerOf(i: number, spec: Spec): number {
    let hunger = 1 - this.energy[i]! / spec.reserve;
    if (this.kind[i] !== S.FOX || !this.female[i]) return hunger;
    for (let j = this.first[S.FOX]!; j < this.first[S.FOX + 1]!; j++) {
      if (this.alive[j] && this.mother[j] === i) hunger = Math.max(hunger, 0.95 * (1 - this.energy[j]! / spec.reserve));
    }
    return hunger;
  }

  /** What she catches feeds her cubs too, while they keep with her. */
  private provide(i: number, each: number): void {
    const k = this.kind[i]!;
    for (let j = this.first[k]!; j < this.first[k + 1]!; j++) {
      if (this.alive[j] && this.mother[j] === i) this.energy[j] = Math.min(SPECS[k]!.reserve, this.energy[j]! + each);
    }
  }

  /** A hare looks for the fox as it decides (and a duck ashore, and a squirrel on the ground): true if it ran. */
  private foxNear(i: number, spec: Spec): boolean {
    const x = this.x[i]!;
    const y = this.y[i]!;
    for (let j = this.first[S.FOX]!; j < this.first[S.FOX + 1]!; j++) {
      if (!this.alive[j] || this.going[j]) continue;
      const d = Math.hypot(this.x[j]! - x, this.y[j]! - y);
      // A fox on the hunt is seen from farther; an animal with its head down sees it later.
      // A fox on the run is seen from far off, one creeping up from much nearer; an animal with its head down sees it later still.
      const sees = (this.doing[j] === S.CHASE ? 22 : this.doing[j] === S.STALK ? 8 : 12.5) * (this.doing[i] === S.GRAZE || this.doing[i] === S.REST || this.doing[i] === S.SLEEP ? 0.62 : 1);
      if (d < sees) {
        this.fearX[i] = this.x[j]!;
        this.fearY[i] = this.y[j]!;
        if (spec.realm === S.LAND) this.bolt(i, spec);
        else this.splash(i);
        return true;
      }
    }
    return false;
  }

  /** A land animal's frame: towards its target at the pace of what it's doing, its legs in time with the ground it covers. */
  private moveOnLand(i: number, dt: number, spec: Spec): void {
    const k = this.kind[i]!;
    const d = this.doing[i]!;
    const x = this.x[i]!;
    const y = this.y[i]!;
    if (d === S.CLIMB) {
      this.climb(i, dt, spec);
      return;
    }
    const size = this.sizeOf(i, spec);
    let want = 0;
    let nod = 0;
    let lie = 0;
    const gap = Math.hypot(this.tx[i]! - x, this.ty[i]! - y);
    const there = gap < 0.5;
    switch (d) {
      case S.WALK:
        // (At the pace it set off at: a walk, or the trot of one that is moving off from someone.)
        want = there ? 0 : Math.max(spec.walk, Math.min(this.speed[i]!, spec.walk * 2.4));
        break;
      case S.FOLLOW:
        // Keeping up: faster the farther behind.
        want = there ? 0 : Math.min(spec.run * 0.8, spec.walk * (0.8 + gap * 0.5));
        break;
      case S.GRAZE:
      case S.FORAGE:
        want = there ? 0 : gap < 2.5 ? spec.walk * 0.35 : spec.walk;
        nod = gap < 2.5 ? -1 + 0.08 * Math.sin(this.t * 5 + i) : -0.15;
        break;
      case S.DRINK:
        want = there ? 0 : spec.walk * 1.1;
        nod = gap < 0.9 ? -1.1 : 0;
        break;
      case S.REST:
      case S.SLEEP:
      case S.SHELTER:
        want = there || gap < 1.5 ? 0 : spec.walk;
        lie = want === 0 && d !== S.SHELTER ? 1 : 0;
        nod = lie ? (d === S.SLEEP ? -0.75 : -0.15) : 0;
        break;
      case S.WATCH:
        nod = 0.45;
        // A slow look round.
        this.heading[i] = this.heading[i]! + Math.sin(this.t * 0.35 + i * 1.7) * 0.5 * dt;
        break;
      case S.ALERT:
      case S.SETTLE: {
        nod = 0.5;
        // Facing what it's watching.
        const to = Math.atan2(this.fearY[i]! - y, this.fearX[i]! - x);
        this.heading[i] = this.heading[i]! + clamp(turnTo(this.heading[i]!, to), -spec.turn * dt, spec.turn * dt);
        break;
      }
      case S.FLEE:
        // (Head up first, then away.)
        want = this.react[i]! > 0 ? 0 : spec.run * (0.55 + 0.45 * size) * (1 - 0.3 * this.tired[i]!);
        nod = this.react[i]! > 0 ? 0.55 : 0.2;
        break;
      case S.CHASE: {
        want = spec.run * (1 - 0.3 * this.tired[i]!);
        nod = -0.1;
        // After the hare itself, every frame: where it will be in a moment. Within a stride of it, it's caught.
        const q = this.prey[i]!;
        if (q >= 0 && this.alive[q] && !this.going[q]) {
          const near = Math.hypot(this.x[q]! - x, this.y[q]! - y);
          const lead = Math.min(0.5, near / 12);
          this.tx[i] = this.x[q]! + Math.cos(this.heading[q]!) * this.speed[q]! * lead;
          this.ty[i] = this.y[q]! + Math.sin(this.heading[q]!) * this.speed[q]! * lead;
          if (near < 0.85) {
            // It's simply gone; the fox eats.
            this.die(q, CAUGHT);
            this.prey[i] = -1;
            this.energy[i] = Math.min(spec.reserve, this.energy[i]! + 3.8);
            this.provide(i, 1.6);
            this.doing[i] = S.EAT;
            this.timer[i] = 7;
            want = 0;
          }
        }
        break;
      }
      case S.STALK:
        want = there ? 0 : spec.walk * 0.55;
        nod = -0.4;
        break;
      case S.MOUSE:
        // The stand, then the pounce: up and over, nose first into the grass.
        if (this.timer[i]! < POUNCE) {
          const u = 1 - Math.max(0, this.timer[i]!) / POUNCE;
          want = 2.6;
          nod = u < 0.5 ? 0.3 : -1;
          this.pitch[i] = (0.5 - u) * 1.5;
          this.tx[i] = x + Math.cos(this.heading[i]!) * 3;
          this.ty[i] = y + Math.sin(this.heading[i]!) * 3;
        } else nod = 0.15 + 0.2 * Math.sin(this.t * 1.3 + i);
        break;
      case S.EAT:
        nod = -1 + 0.1 * Math.sin(this.t * 7 + i);
        break;
      case S.CURL:
        lie = 1;
        nod = -1;
        break;
      default:
        break;
    }
    if (d !== S.MOUSE) this.pitch[i] = this.pitch[i]! * Math.max(0, 1 - dt * 6);
    // Turn, then go: nobody slides sideways.
    let speed = this.speed[i]!;
    if (want > 0 && gap > 0.05) {
      const to = Math.atan2(this.ty[i]! - y, this.tx[i]! - x);
      const turn = turnTo(this.heading[i]!, to);
      const rate = spec.turn * (d === S.FLEE || d === S.CHASE ? 1.6 : 1);
      this.heading[i] = this.heading[i]! + clamp(turn, -rate * dt, rate * dt);
      // Slower through a sharp turn.
      want *= clamp(1.25 - Math.abs(turn) / 1.6, 0.25, 1);
    }
    speed += clamp(want - speed, -spec.accel * 1.6 * dt, spec.accel * dt);
    if (speed < 0.01) speed = 0;
    if (speed > 0) {
      const step = want > 0 ? Math.min(speed * dt, gap + 0.05) : speed * dt;
      const taken = this.walk(i, x, y, this.heading[i]!, step, this.spot);
      if (taken === null) {
        // No way on: it stops and thinks again; running, it turns along whatever it met.
        speed = 0;
        this.think[i] = 0;
        if (d === S.FLEE || d === S.CHASE) this.heading[i] = this.heading[i]! + (this.own[i]! < 0.5 ? 1.2 : -1.2);
        else if (d === S.WALK || d === S.GRAZE || d === S.FORAGE || d === S.STALK) {
          this.tx[i] = x;
          this.ty[i] = y;
        }
      } else {
        const moved = Math.hypot(this.spot.x - x, this.spot.y - y);
        this.heading[i] = this.heading[i]! + clamp(turnTo(this.heading[i]!, taken), -spec.turn * 2 * dt, spec.turn * 2 * dt);
        this.x[i] = this.spot.x;
        this.y[i] = this.spot.y;
        this.phase[i] = (this.phase[i]! + (moved / (spec.stride * (0.6 + 0.4 * size) * (1 + speed / spec.run))) * TAU) % TAU;
      }
    }
    this.speed[i] = speed;
    const ease = Math.min(1, dt * 5);
    this.amount[i] = this.amount[i]! + (Math.min(1, speed / (spec.walk * 1.6)) - this.amount[i]!) * ease;
    this.nod[i] = this.nod[i]! + (nod - this.nod[i]!) * Math.min(1, dt * (nod > this.nod[i]! ? 7 : 3.5));
    this.lie[i] = this.lie[i]! + clamp(lie - this.lie[i]!, -dt * 1.6, dt * 1.2);
    if (k === S.HEDGEHOG && d === S.SLEEP) this.shown[i] = Math.max(0, this.shown[i]! - dt * 3);
  }

  /** The squirrel on a trunk: to it, up it on the side away from what it fears, a wait in the fork, and down again head first. */
  private climb(i: number, dt: number, spec: Spec): void {
    const x = this.x[i]!;
    const y = this.y[i]!;
    const hx = this.homeX[i]!;
    const hy = this.homeY[i]!;
    const trunk = this.vz[i]! + 0.1;
    const gap = Math.hypot(hx - x, hy - y);
    if (!this.air[i]) {
      if (gap > trunk + 0.35) {
        // Running for it.
        this.tx[i] = hx;
        this.ty[i] = hy;
        const to = Math.atan2(hy - y, hx - x);
        this.heading[i] = this.heading[i]! + clamp(turnTo(this.heading[i]!, to), -spec.turn * 2 * dt, spec.turn * 2 * dt);
        const speed = Math.min(spec.run, this.speed[i]! + spec.accel * dt);
        const step = Math.min(speed * dt, gap - trunk - 0.2);
        this.x[i] = x + Math.cos(this.heading[i]!) * step;
        this.y[i] = y + Math.sin(this.heading[i]!) * step;
        this.speed[i] = speed;
        this.phase[i] = (this.phase[i]! + (step / spec.stride) * TAU) % TAU;
        this.amount[i] = 1;
        if (this.timer[i]! < -8) this.doing[i] = S.STAND;
        return;
      }
      // At the foot: onto the bark.
      this.air[i] = 1;
      this.z[i] = this.homeZ[i]! + 0.1;
      this.speed[i] = 0;
    }
    // On the trunk: its place is an angle round it (kept in its heading) and a height.
    const fear = Math.atan2(this.fearY[i]! - hy, this.fearX[i]! - hx);
    const side = Math.atan2(y - hy, x - hx);
    // Round to the far side from what it fears.
    const round = side + clamp(turnTo(side, fear + Math.PI), -2.2 * dt, 2.2 * dt);
    this.x[i] = hx + Math.cos(round) * trunk;
    this.y[i] = hy + Math.sin(round) * trunk;
    this.heading[i] = round + Math.PI;
    const down = this.timer[i]! <= 0;
    const goal = down ? this.homeZ[i]! : this.tz[i]!;
    const dz = clamp(goal - this.z[i]!, -2.4 * dt, 3.2 * dt);
    this.z[i] = this.z[i]! + dz;
    // Up the bark head first, and down it head first.
    this.pitch[i] = this.pitch[i]! + ((down ? -1.45 : 1.45) - this.pitch[i]!) * Math.min(1, dt * 8);
    this.amount[i] = Math.abs(dz) > 1e-4 ? 1 : 0;
    this.phase[i] = (this.phase[i]! + (Math.abs(dz) / 0.35) * TAU) % TAU;
    this.nod[i] = 0.2;
    this.lie[i] = 0;
    if (down && this.z[i]! <= this.homeZ[i]! + 0.02) {
      // Down: off across the ground.
      this.air[i] = 0;
      this.pitch[i] = 0;
      this.doing[i] = S.STAND;
      this.timer[i] = 1;
      this.heading[i] = round;
    }
  }

  // ---------- the water birds ----------

  /** Off the strand and onto the water, flapping (a duck that's been frightened ashore); afloat, away from the bank. */
  private splash(i: number): void {
    const x = this.x[i]!;
    const y = this.y[i]!;
    if (this.kind[i] === S.SWAN) {
      this.doing[i] = S.ALERT;
      this.timer[i] = 4;
      return;
    }
    const base = Math.atan2(y - this.fearY[i]!, x - this.fearX[i]!);
    // Water, as far from the fright as can be found.
    let best = -Infinity;
    for (let c = 0; c < 7; c++) {
      const a = base + (c - 3) * 0.5;
      const r = 9 + this.random() * 6;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (!this.afloat(px, py)) continue;
      const score = Math.hypot(px - this.fearX[i]!, py - this.fearY[i]!) + this.random();
      if (score > best) {
        best = score;
        this.tx[i] = px;
        this.ty[i] = py;
      }
    }
    if (best === -Infinity && this.patches.nearest(x, y, WET, 8, this.spot)) {
      this.tx[i] = this.spot.x;
      this.ty[i] = this.spot.y;
    }
    this.doing[i] = S.FLEE;
    this.timer[i] = 5;
    if (this.afloat(x, y)) this.ripple(x, y, 0.9);
  }

  private waterStep(i: number, dt: number, spec: Spec): void {
    const k = this.kind[i]!;
    this.timer[i] = this.timer[i]! - dt;
    const d = this.doing[i]!;
    if (d === S.FLY) {
      // Coming in: down onto the water with a splash.
      if (this.wingTo(i, dt, spec, k === S.SWAN ? 12 : 28)) {
        this.doing[i] = S.SWIM;
        this.timer[i] = 2;
        this.ripple(this.x[i]!, this.y[i]!, k === S.SWAN ? 1.6 : 1);
      }
      return;
    }
    if (d !== S.FLEE) {
      this.danger(i, spec);
      const ashore = !this.afloat(this.x[i]!, this.y[i]!);
      // Ashore they go for the water as soon as they must; afloat only when someone's right at the bank.
      if (k === S.SWAN) {
        if (this.scare > 0 && d !== S.ALERT) {
          this.doing[i] = S.ALERT;
          this.timer[i] = 3;
        }
      } else if (this.scare === 2 || (this.scare === 1 && ashore && Math.hypot(this.x[i]! - this.fearX[i]!, this.y[i]! - this.fearY[i]!) < spec.flight * 1.5)) this.splash(i);
    }
    if ((this.think[i] = this.think[i]! - dt) <= 0) {
      this.think[i] = THINK * (0.8 + 0.4 * this.random());
      this.decideWater(i, spec);
    }
    this.moveOnWater(i, dt, spec);
  }

  private decideWater(i: number, spec: Spec): void {
    const k = this.kind[i]!;
    const d = this.doing[i]!;
    const x = this.x[i]!;
    const y = this.y[i]!;
    const p = this.patches;
    const afloat = this.afloat(x, y);
    if (d === S.FLEE) {
      if (this.timer[i]! > 0 && Math.hypot(this.tx[i]! - x, this.ty[i]! - y) > 1) return;
      this.doing[i] = S.SWIM;
      this.timer[i] = 3;
      return;
    }
    if (d === S.ALERT && this.timer[i]! > 0) return;
    if (k === S.MALLARD && !afloat && this.foxNear(i, spec)) return;
    this.breed(i, spec);
    // ---- the young swim in a line behind her ----
    const m = this.mother[i]!;
    if (m >= 0 && this.alive[m] && !this.going[m]) {
      // Each behind the one before it: the nearest sibling ahead in the slots, or her.
      let ahead = m;
      for (let j = i - 1; j >= this.first[k]!; j--) {
        if (this.alive[j] && this.mother[j] === m) {
          ahead = j;
          break;
        }
      }
      const h = this.heading[ahead]!;
      const back = ahead === m ? spec.r * 2.6 : spec.r * 1.9;
      this.tx[i] = this.x[ahead]! - Math.cos(h) * back;
      this.ty[i] = this.y[ahead]! - Math.sin(h) * back;
      const hers = this.doing[m]!;
      this.doing[i] = hers === S.FLEE ? S.FLEE : hers === S.SLEEP ? S.SLEEP : hers === S.DABBLE && this.random() < 0.3 ? S.DABBLE : hers === S.PREEN ? S.PREEN : S.FOLLOW;
      this.timer[i] = 1.2;
      if (this.doing[i] === S.DABBLE) this.eat(i, spec, p.weed, p.at(x, y));
      else if (this.age[i]! >= spec.weaned) this.energy[i] = Math.min(spec.reserve, this.energy[i]! + THINK * this.pace * 0.9);
      return;
    }
    const active = this.about[k]!;
    const hunger = 1 - this.energy[i]! / spec.reserve;
    // Asleep on the water at night, head tucked.
    if (active < 0.3) {
      if (d !== S.SLEEP) {
        this.raft(i, k, 3);
        this.timer[i] = 30;
      }
      this.doing[i] = S.SLEEP;
      return;
    }
    if (d === S.DABBLE && this.timer[i]! > 0) {
      const at = p.at(x, y);
      if (Math.hypot(this.tx[i]! - x, this.ty[i]! - y) < 1) {
        this.eat(i, spec, p.weed[at]! > p.midges[at]! ? p.weed : p.midges, at);
        if (this.random() < 0.12) this.ripple(x, y, 0.7);
      }
      return;
    }
    if ((d === S.PREEN || d === S.SWIM || d === S.FOLLOW) && this.timer[i]! > 0 && Math.hypot(this.tx[i]! - x, this.ty[i]! - y) > 0.8) return;
    if (d === S.PREEN && this.timer[i]! > 0) return;
    // The pair, the raft: its mate or the others, if they've drifted apart.
    let cx = x;
    let cy = y;
    let n = 0;
    for (let j = this.first[k]!; j < this.first[k + 1]!; j++) {
      if (!this.alive[j] || this.going[j] || this.age[j]! < spec.grown) continue;
      cx += this.x[j]!;
      cy += this.y[j]!;
      n++;
    }
    cx = (cx - x) / Math.max(1, n);
    cy = (cy - y) / Math.max(1, n);
    const apart = n > 1 ? Math.hypot(cx - x, cy - y) : 0;
    if (apart > (k === S.SWAN ? 5 : 11) && this.afloat(cx, cy)) {
      this.tx[i] = cx + (this.random() - 0.5) * 3;
      this.ty[i] = cy + (this.random() - 0.5) * 3;
      this.doing[i] = S.SWIM;
      this.timer[i] = 10;
      return;
    }
    if (hunger > 0.2 && this.random() < 0.3 + hunger) {
      // To the shallows, where the weed is.
      let best = -Infinity;
      for (let c = 0; c < 6; c++) {
        const a = this.random() * TAU;
        const r = 2 + this.random() * 12;
        const px = x + Math.cos(a) * r;
        const py = y + Math.sin(a) * r;
        if (!this.afloat(px, py)) continue;
        const cell = p.at(px, py);
        const score = p.weed[cell]! + p.midges[cell]! - r * 0.08;
        if (score > best) {
          best = score;
          this.tx[i] = px;
          this.ty[i] = py;
        }
      }
      if (best > -Infinity) {
        this.doing[i] = S.DABBLE;
        this.timer[i] = 10 + this.random() * 8;
        return;
      }
    }
    if (k === S.MALLARD && this.tired[i]! > 0.3 && this.random() < 0.2 && this.env.rain < 0.5) {
      // Out onto the strand to preen: the nearest bank.
      if (p.nearest(x, y, 1 << SHORE, 4, this.spot) && this.floats(this.spot.x, this.spot.y) && !this.afloat(this.spot.x, this.spot.y)) {
        this.tx[i] = this.spot.x;
        this.ty[i] = this.spot.y;
        this.doing[i] = S.PREEN;
        this.timer[i] = 16 + this.random() * 14;
        this.tired[i] = 0;
        return;
      }
    }
    if (this.random() < 0.25) {
      this.doing[i] = S.PREEN;
      this.tx[i] = x;
      this.ty[i] = y;
      this.timer[i] = 4 + this.random() * 5;
      return;
    }
    this.raft(i, k, k === S.SWAN ? 9 : 12);
    this.doing[i] = S.SWIM;
    this.timer[i] = 14;
  }

  /** Somewhere on the water within `r` to swim to. */
  private raft(i: number, k: number, r: number): void {
    const x = this.x[i]!;
    const y = this.y[i]!;
    void k;
    for (let tries = 0; tries < 5; tries++) {
      const a = this.random() * TAU;
      const d = 1 + this.random() * r;
      const px = x + Math.cos(a) * d;
      const py = y + Math.sin(a) * d;
      if (!this.afloat(px, py) || Math.hypot(px - this.env.fx, py - this.env.fy) > this.reach) continue;
      // Not up to someone standing on the bank.
      if (Math.hypot(px - this.env.gx, py - this.env.gy) < 8 || Math.hypot(px - this.env.dx, py - this.env.dy) < 8) continue;
      this.tx[i] = px;
      this.ty[i] = py;
      return;
    }
    this.tx[i] = x;
    this.ty[i] = y;
  }

  private moveOnWater(i: number, dt: number, spec: Spec): void {
    const d = this.doing[i]!;
    const x = this.x[i]!;
    const y = this.y[i]!;
    const afloat = this.afloat(x, y);
    const gap = Math.hypot(this.tx[i]! - x, this.ty[i]! - y);
    const there = gap < 0.35;
    const size = this.sizeOf(i, spec);
    let want = 0;
    let nod = 0;
    let flap = 0;
    let tip = 0;
    switch (d) {
      case S.SWIM:
        want = there ? 0 : spec.walk;
        break;
      case S.FOLLOW:
        want = there ? 0 : Math.min(spec.run * 0.6, spec.walk * (0.7 + gap * 0.9));
        break;
      case S.DABBLE:
        want = there || gap < 1 ? 0 : spec.walk;
        // Tail up, head under: a few seconds down, a moment up.
        if (want === 0) {
          const beat = (this.t * 0.35 + this.own[i]!) % 1;
          tip = beat < 0.7 ? 1 : 0;
          nod = this.kind[i] === S.SWAN ? (beat < 0.7 ? -1 : 0) : 0;
        }
        break;
      case S.PREEN:
        want = there ? 0 : spec.walk * 0.8;
        nod = want === 0 ? -0.55 + 0.25 * Math.sin(this.t * 4 + i) : 0;
        break;
      case S.SLEEP:
        want = there ? 0 : spec.walk * 0.6;
        nod = want === 0 ? -0.85 : 0;
        break;
      case S.ALERT: {
        // The swan turns to face whoever it is, wings a little raised.
        nod = 0.3;
        flap = 0.5;
        const to = Math.atan2(this.fearY[i]! - y, this.fearX[i]! - x);
        this.heading[i] = this.heading[i]! + clamp(turnTo(this.heading[i]!, to), -spec.turn * dt, spec.turn * dt);
        break;
      }
      case S.FLEE:
        want = there ? 0 : afloat ? spec.run * 0.55 : spec.run;
        flap = afloat ? 0.35 : 1;
        break;
      default:
        break;
    }
    let speed = this.speed[i]!;
    if (want > 0) {
      const to = Math.atan2(this.ty[i]! - y, this.tx[i]! - x);
      const turn = turnTo(this.heading[i]!, to);
      this.heading[i] = this.heading[i]! + clamp(turn, -spec.turn * dt, spec.turn * dt);
      want *= clamp(1.2 - Math.abs(turn) / 1.4, 0.2, 1);
    }
    speed += clamp(want * (0.6 + 0.4 * size) - speed, -spec.accel * dt, spec.accel * dt);
    if (speed < 0.005) speed = 0;
    if (speed > 0) {
      const taken = this.walk(i, x, y, this.heading[i]!, Math.min(speed * dt, Math.max(gap, 0.001)), this.spot);
      if (taken === null) {
        speed = 0;
        this.tx[i] = x;
        this.ty[i] = y;
        this.think[i] = 0;
      } else {
        const moved = Math.hypot(this.spot.x - x, this.spot.y - y);
        this.heading[i] = this.heading[i]! + clamp(turnTo(this.heading[i]!, taken), -spec.turn * dt, spec.turn * dt);
        this.x[i] = this.spot.x;
        this.y[i] = this.spot.y;
        // Paddling under the water, waddling on the strand.
        this.phase[i] = (this.phase[i]! + (moved / spec.stride) * TAU) % TAU;
      }
    }
    this.speed[i] = speed;
    // (Its wings beat by the clock when it flaps, its feet by the ground.)
    if (flap > 0.6) this.phase[i] = (this.phase[i]! + dt * 26) % TAU;
    const ease = Math.min(1, dt * 5);
    this.amount[i] = this.amount[i]! + ((flap > 0 ? flap : afloat ? 0 : Math.min(1, speed / spec.walk)) - this.amount[i]!) * ease;
    this.lie[i] = this.lie[i]! + ((flap > 0 ? 0 : 1) - this.lie[i]!) * ease;
    this.nod[i] = this.nod[i]! + (nod - this.nod[i]!) * Math.min(1, dt * 4);
    this.pitch[i] = this.pitch[i]! + (tip * (this.kind[i] === S.SWAN ? 0.25 : 1.15) - this.pitch[i]!) * Math.min(1, dt * 4);
  }

  // ---------- the heron ----------

  /** The heron leaves its stand: for another, or (frightened) well away. */
  heronGo(i: number, frightened: boolean): void {
    const x = this.x[i]!;
    const y = this.y[i]!;
    let found = false;
    for (let tries = 0; tries < 10 && !found; tries++) {
      if (!this.place(S.HERON, 0.1, 0.9)) continue;
      const far = Math.hypot(this.spot.x - x, this.spot.y - y);
      const safe = Number.isNaN(this.env.gx) || Math.hypot(this.spot.x - this.env.gx, this.spot.y - this.env.gy) > 28;
      if (far > (frightened ? 30 : 12) && safe) found = true;
    }
    if (!found) {
      // Nowhere else to stand: right away, out of the range (it comes back another time).
      const a = Math.atan2(y - this.fearY[i]!, x - this.fearX[i]!);
      this.spot.x = this.env.fx + Math.cos(a) * this.reach * 1.5;
      this.spot.y = this.env.fy + Math.sin(a) * this.reach * 1.5;
    }
    this.tx[i] = this.spot.x;
    this.ty[i] = this.spot.y;
    this.doing[i] = S.FLY;
    this.timer[i] = 60;
    if (!this.air[i]) {
      this.air[i] = 1;
      this.z[i] = Math.max(this.habitat.height(x, y), WATER_LEVEL) + 0.2;
      this.vz[i] = 0;
      this.ripple(x, y, 1);
    }
  }

  /**
   * A water bird on the wing to where it's going (its target): up to a few metres over the water and the land
   * between, and down onto it. Its wings beat `beat` radians a second. True when it's down.
   */
  private wingTo(i: number, dt: number, spec: Spec, beat: number): boolean {
    const x = this.x[i]!;
    const y = this.y[i]!;
    const gap = Math.hypot(this.tx[i]! - x, this.ty[i]! - y);
    const floor = Math.max(this.habitat.height(x, y), WATER_LEVEL);
    const cruise = floor + Math.min(7, 1.5 + gap * 0.25);
    const to = Math.atan2(this.ty[i]! - y, this.tx[i]! - x);
    this.heading[i] = this.heading[i]! + clamp(turnTo(this.heading[i]!, to), -spec.turn * dt, spec.turn * dt);
    const speed = Math.min(FLIGHT, this.speed[i]! + 4 * dt, 2 + gap * 0.9);
    this.speed[i] = speed;
    this.x[i] = x + Math.cos(this.heading[i]!) * speed * dt;
    this.y[i] = y + Math.sin(this.heading[i]!) * speed * dt;
    this.z[i] = this.z[i]! + clamp((gap < 3 ? floor : cruise) - this.z[i]!, -3.5 * dt, 3 * dt);
    this.phase[i] = (this.phase[i]! + dt * beat) % TAU;
    this.amount[i] = 1;
    this.lie[i] = Math.max(0, this.lie[i]! - dt * 4);
    this.nod[i] = this.nod[i]! + (-0.45 - this.nod[i]!) * Math.min(1, dt * 3);
    this.pitch[i] = 0;
    if (gap > 0.6 || this.z[i]! - floor > 0.25) return false;
    this.air[i] = 0;
    this.speed[i] = 0;
    return true;
  }

  private heronStep(i: number, dt: number, spec: Spec): void {
    this.timer[i] = this.timer[i]! - dt;
    const d = this.doing[i]!;
    const x = this.x[i]!;
    const y = this.y[i]!;
    if (d === S.FLY) {
      // Slow beats, neck drawn in, legs trailing.
      if (this.wingTo(i, dt, spec, 15)) {
        this.doing[i] = S.FISHING;
        this.timer[i] = 6 + this.random() * 8;
        if (Math.hypot(this.x[i]! - this.env.fx, this.y[i]! - this.env.fy) > this.reach * 1.3) {
          this.left[S.HERON] = this.left[S.HERON]! + 1;
          this.remove(i);
        }
      }
      return;
    }
    this.danger(i, spec);
    if (this.scare === 2) {
      this.heronGo(i, true);
      return;
    }
    let nod = 0;
    if ((this.think[i] = this.think[i]! - dt) <= 0) {
      this.think[i] = THINK;
      const active = this.about[S.HERON]!;
      if (d === S.STRIKE && this.timer[i]! <= 0) {
        // Did it get one? Only if there was a fish in reach.
        let fish = -1;
        let near = 2.6;
        for (let j = this.first[S.FISH]!; j < this.first[S.FISH + 1]!; j++) {
          if (!this.alive[j] || this.going[j]) continue;
          const dj = Math.hypot(this.x[j]! - x, this.y[j]! - y);
          if (dj < near) {
            near = dj;
            fish = j;
          }
        }
        this.ripple(x + Math.cos(this.heading[i]!) * 0.7, y + Math.sin(this.heading[i]!) * 0.7, 0.9);
        const cell = this.patches.at(x, y);
        if (fish >= 0 && this.random() < 0.55) {
          this.die(fish, CAUGHT);
          this.energy[i] = Math.min(spec.reserve, this.energy[i]! + 1.6);
          this.doing[i] = S.EAT;
          this.timer[i] = 3;
        } else if (fish < 0 && this.patches.midges[cell]! > 0.6 && this.random() < 0.5) {
          // Small fry, a frog: what the shallows hold besides.
          this.patches.take(this.patches.midges, cell, 0.5);
          this.energy[i] = Math.min(spec.reserve, this.energy[i]! + 0.7);
          this.doing[i] = S.EAT;
          this.timer[i] = 2;
        } else {
          this.doing[i] = S.FISHING;
          this.timer[i] = 8 + this.random() * 10;
        }
      } else if (d === S.EAT && this.timer[i]! <= 0) {
        this.doing[i] = S.FISHING;
        this.timer[i] = 10 + this.random() * 10;
      } else if (active < 0.3) this.doing[i] = S.SLEEP;
      else if (d === S.SLEEP) this.doing[i] = S.FISHING;
      else if (d === S.FISHING && this.timer[i]! <= 0) {
        const hungry = 1 - this.energy[i]! / spec.reserve;
        // A fish in reach: the strike. None for a long while: a few slow steps, or another stand altogether.
        let fishNear = false;
        for (let j = this.first[S.FISH]!; j < this.first[S.FISH + 1]! && !fishNear; j++) fishNear = this.alive[j] === 1 && Math.hypot(this.x[j]! - x, this.y[j]! - y) < 2.6;
        if (hungry > 0.1 && (fishNear || this.random() < 0.35)) {
          this.doing[i] = S.STRIKE;
          this.timer[i] = 0.45;
        } else if (this.random() < 0.12) this.heronGo(i, false);
        else {
          // A slow step or two along the shallows.
          const a = this.heading[i]! + (this.random() - 0.5) * 2;
          const px = x + Math.cos(a) * 1.4;
          const py = y + Math.sin(a) * 1.4;
          const h = this.habitat.height(px, py);
          if (h < WATER_LEVEL - 0.05 && h > WATER_LEVEL - 0.36) {
            this.tx[i] = px;
            this.ty[i] = py;
            this.doing[i] = S.WALK;
            this.timer[i] = 8;
          } else this.timer[i] = 4;
        }
      } else if (d === S.WALK && (this.timer[i]! <= 0 || Math.hypot(this.tx[i]! - x, this.ty[i]! - y) < 0.2)) {
        this.doing[i] = S.FISHING;
        this.timer[i] = 8 + this.random() * 12;
      } else if (d === S.STAND) this.doing[i] = S.FISHING;
    }
    let speed = 0;
    const now = this.doing[i]!;
    if (now === S.WALK) {
      const to = Math.atan2(this.ty[i]! - y, this.tx[i]! - x);
      this.heading[i] = this.heading[i]! + clamp(turnTo(this.heading[i]!, to), -spec.turn * dt, spec.turn * dt);
      speed = spec.walk;
      this.x[i] = x + Math.cos(this.heading[i]!) * speed * dt;
      this.y[i] = y + Math.sin(this.heading[i]!) * speed * dt;
      this.phase[i] = (this.phase[i]! + ((speed * dt) / spec.stride) * TAU) % TAU;
      nod = -0.15;
    } else if (now === S.STRIKE) nod = -1;
    else if (now === S.EAT) nod = 0.5;
    else if (now === S.SLEEP) nod = -0.5;
    else if (now === S.FISHING) nod = this.scare === 1 ? 0.5 : -0.2 + 0.05 * Math.sin(this.t * 0.7);
    this.speed[i] = speed;
    this.amount[i] = this.amount[i]! + ((speed > 0 ? 0.6 : 0) - this.amount[i]!) * Math.min(1, dt * 4);
    this.lie[i] = Math.min(1, this.lie[i]! + dt * 3);
    this.nod[i] = this.nod[i]! + (nod - this.nod[i]!) * Math.min(1, dt * (now === S.STRIKE ? 22 : 3));
  }

  // ---------- the fish ----------

  /** A fish bolts from where it is, down and away. */
  private dart(i: number): void {
    const a = Math.atan2(this.y[i]! - this.fearY[i]!, this.x[i]! - this.fearX[i]!) + (this.random() - 0.5);
    this.tx[i] = this.x[i]! + Math.cos(a) * 7;
    this.ty[i] = this.y[i]! + Math.sin(a) * 7;
    this.doing[i] = S.FLEE;
    this.timer[i] = 1.6;
    this.tz[i] = 0.5;
  }

  /**
   * A fish: with its shoal (apart from the nearest, along with them, towards their middle), after a leader that
   * wanders the lake. `z` is how deep it swims (the deeper, the fainter its shadow). At dusk, when the hatch is on,
   * it rises to take one (a ring), and now and then it leaps.
   */
  private fishStep(i: number, dt: number, spec: Spec): void {
    this.timer[i] = this.timer[i]! - dt;
    const x = this.x[i]!;
    const y = this.y[i]!;
    const d = this.doing[i]!;
    if (d === S.LEAP) {
      // Out and over.
      this.vz[i] = this.vz[i]! - 9.81 * dt;
      this.z[i] = this.z[i]! + this.vz[i]! * dt;
      this.x[i] = x + Math.cos(this.heading[i]!) * 1.6 * dt;
      this.y[i] = y + Math.sin(this.heading[i]!) * 1.6 * dt;
      this.pitch[i] = Math.atan2(this.vz[i]!, 1.6);
      if (this.z[i]! <= WATER_LEVEL && this.vz[i]! < 0) {
        this.air[i] = 0;
        this.z[i] = 0.2;
        this.pitch[i] = 0;
        this.doing[i] = S.SWIM;
        this.timer[i] = 4;
        this.ripple(this.x[i]!, this.y[i]!, 1.3);
      }
      return;
    }
    if ((this.think[i] = this.think[i]! - dt) <= 0) {
      this.think[i] = THINK * (0.8 + 0.4 * this.random());
      const e = this.env;
      // Someone at the bank, or a heron's feet: away.
      let fright = false;
      if (d !== S.FLEE) {
        for (let who = 0; who < 2 && !fright; who++) {
          const px = who ? e.dx : e.gx;
          const py = who ? e.dy : e.gy;
          if (!Number.isNaN(px) && Math.hypot(px - x, py - y) < spec.flight) {
            this.fearX[i] = px;
            this.fearY[i] = py;
            fright = true;
          }
        }
        if (fright) this.dart(i);
      }
      if (!fright && (d !== S.FLEE || this.timer[i]! <= 0)) {
        this.breed(i, spec);
        const k = S.FISH;
        const lead = this.group[i]!;
        const leader = lead === i || !this.alive[lead];
        if (leader) this.group[i] = i;
        const active = this.about[k]! * (0.25 + 0.75 * e.season.vigour);
        if (d === S.RISE) {
          if (this.timer[i]! <= 0) {
            // It took one.
            const at = this.patches.at(x, y);
            this.eat(i, spec, this.patches.midges, at);
            this.energy[i] = Math.min(spec.reserve, this.energy[i]! + 0.4);
            this.ripple(x, y, 0.8 + this.random() * 0.5);
            this.doing[i] = S.SWIM;
            this.timer[i] = 5 + this.random() * 8;
            this.tz[i] = 0.25 + this.random() * 0.25;
          }
        } else if (this.timer[i]! <= 0 && this.random() < 0.05 * active * (0.4 + 1.6 * e.twilight) * (1 - e.rain)) {
          if (this.random() < 0.1 && this.age[i]! >= spec.grown) {
            // The odd leap.
            this.doing[i] = S.LEAP;
            this.air[i] = 1;
            this.z[i] = WATER_LEVEL;
            this.vz[i] = 2.7 + this.random() * 0.8;
            this.ripple(x, y, 0.9);
            return;
          }
          this.doing[i] = S.RISE;
          this.timer[i] = 0.9;
          this.tz[i] = 0.02;
          this.tx[i] = x;
          this.ty[i] = y;
        } else if (d !== S.RISE) {
          this.doing[i] = S.SWIM;
          if (leader) {
            // The leader's next mark in the lake.
            if (Math.hypot(this.tx[i]! - x, this.ty[i]! - y) < 1 || this.timer[i]! < -20 || this.habitat.height(this.tx[i]!, this.ty[i]!) > WATER_LEVEL - 0.3) {
              for (let tries = 0; tries < 5; tries++) {
                const a = this.random() * TAU;
                const r = 3 + this.random() * 14;
                const px = x + Math.cos(a) * r;
                const py = y + Math.sin(a) * r;
                if (this.habitat.height(px, py) > WATER_LEVEL - 0.35 || Math.hypot(px - e.fx, py - e.fy) > this.reach) continue;
                this.tx[i] = px;
                this.ty[i] = py;
                this.timer[i] = 0;
                break;
              }
            }
          } else {
            // The shoal: near its leader, not on top of anyone.
            let sx = 0;
            let sy = 0;
            for (let j = this.first[k]!; j < this.first[k + 1]!; j++) {
              if (j === i || !this.alive[j]) continue;
              const dx = x - this.x[j]!;
              const dy = y - this.y[j]!;
              const dj = Math.hypot(dx, dy);
              if (dj < 0.9 && dj > 1e-3) {
                sx += (dx / dj) * (0.9 - dj);
                sy += (dy / dj) * (0.9 - dj);
              }
            }
            const h = this.heading[lead]!;
            const slot = (this.own[i]! - 0.5) * 2.4;
            this.tx[i] = this.x[lead]! - Math.cos(h) * (0.6 + this.own[i]! * 1.6) - Math.sin(h) * slot + sx * 2;
            this.ty[i] = this.y[lead]! - Math.sin(h) * (0.6 + this.own[i]! * 1.6) + Math.cos(h) * slot + sy * 2;
            if (this.habitat.height(this.tx[i]!, this.ty[i]!) > WATER_LEVEL - 0.25) {
              this.tx[i] = this.x[lead]!;
              this.ty[i] = this.y[lead]!;
            }
          }
        }
      }
    }
    const now = this.doing[i]!;
    const gap = Math.hypot(this.tx[i]! - x, this.ty[i]! - y);
    const want = now === S.FLEE ? spec.run : now === S.RISE || gap < 0.3 ? 0.05 : Math.min(spec.walk * (0.6 + gap * 0.5), spec.run * 0.5);
    if (gap > 0.05) {
      const to = Math.atan2(this.ty[i]! - y, this.tx[i]! - x);
      this.heading[i] = this.heading[i]! + clamp(turnTo(this.heading[i]!, to), -spec.turn * dt, spec.turn * dt);
    }
    const speed = this.speed[i]! + clamp(want - this.speed[i]!, -spec.accel * dt, spec.accel * dt);
    this.speed[i] = speed;
    const nx = x + Math.cos(this.heading[i]!) * speed * dt;
    const ny = y + Math.sin(this.heading[i]!) * speed * dt;
    if (this.habitat.height(nx, ny) < WATER_LEVEL - 0.2) {
      this.x[i] = nx;
      this.y[i] = ny;
    } else {
      // The bank: it turns along it.
      this.heading[i] = this.heading[i]! + 2.5 * dt * (this.own[i]! < 0.5 ? 1 : -1);
      this.tx[i] = x;
      this.ty[i] = y;
    }
    // Its tail keeps time with its speed; how deep it swims eases to where it means to be.
    this.phase[i] = (this.phase[i]! + dt * (3 + speed * 9)) % TAU;
    this.amount[i] = Math.min(1, 0.35 + speed / spec.run);
    this.z[i] = this.z[i]! + clamp((now === S.FLEE ? 0.5 : this.tz[i]! || 0.3) - this.z[i]!, -dt * 0.5, dt * 0.6);
  }
}

/** The window of the 2 m cells that remember what's barred (cells a side). */
const BAR = 256;
/** The ways an animal may run from what it fears, off straight away (radians). */
const AWAY = [0, 0.5, -0.5, 1.05, -1.05];
/** How fast the birds of the water fly, m/s. */
const FLIGHT = 9;
/** The fox's pounce, seconds. */
export const POUNCE = 0.7;
/** What the dog might chase. */
const SMALL = [S.HARE, S.SQUIRREL, S.MALLARD, S.SONGBIRD];
