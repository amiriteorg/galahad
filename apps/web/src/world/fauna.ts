import { AdditiveBlending, DynamicDrawUsage, type Group, InstancedMesh, Matrix4, MeshBasicNodeMaterial, Quaternion, TetrahedronGeometry, Vector3 } from "three/webgpu";
import { type Build, BUILDS, type Mover, type Solids } from "./collide.ts";
import type { Sky } from "./daynight.ts";
import { type Habitat } from "./eco/habitat.ts";
import { Insects } from "./eco/insects.ts";
import { MESHES, type MeshName, Poser } from "./eco/pose.ts";
import { Ecosystem, emptyEnv } from "./eco/sim.ts";
import * as S from "./eco/species.ts";
import { type Caps, KIND_COUNT, KINDS, SPECS } from "./eco/species.ts";
import { type EcoSummary, emptySummary, labelOf, summarise, summaryText } from "./eco/summary.ts";
import { EcoView } from "./eco/view.ts";
import { BENCH, DESK_LANTERN, POLE } from "./hearth-plan.ts";
import { type Ground, MAX_SLOPE, moveOnGround, Particles, rng, slideOnGround } from "./physics.ts";
import { type SeasonChoice, seasonFor, seasonState } from "./season.ts";
import { groundAt, type Layer, SEED } from "./terrain.ts";
import type { Tier } from "./tiers.ts";
import type { WeatherState } from "./weather.ts";

/*
 * Life in the SANDBOX: the ecosystem (eco/: every animal an agent with needs,
 * on land that grows what it eats; see eco/sim.ts), drawn (eco/view.ts), and
 * joined to the world it lives in: the land as it's drawn, the trees and
 * flowers that really grow on it, the solids, the real sun and weather, and
 * Galahad and his dog. Also the sparks and exhaust (ballistic particles), which
 * have always lived here.
 *
 * A frame: the simulation steps (decisions twice a second an animal, staggered;
 * in between they only move), the pose is written straight into the instanced
 * meshes' arrays, and that's all. Nothing is allocated; each kind is one draw
 * call, and none while nobody of it is in sight.
 */

/** As much of the land as the ecosystem asks of it (the scene's Land). */
export interface Country {
  /** The chunks that are grown: where each is, and what grows on it. */
  readonly list: readonly { cx: number; cy: number; samples: { layers: Partial<Record<Layer, Float64Array>> } }[];
}

/** Someone the animals notice: where they are (world metres). */
export interface Passer {
  readonly x: number;
  readonly y: number;
}

/** What the dog's side is told of something to chase. */
export interface Quarry {
  x: number;
  y: number;
  /** What it is ("hare", "squirrel", "mallard", "songbird"). */
  kind: string;
  slot: number;
}

/**
 * How the walkers of the ecosystem are built, among the solids (collide.ts' BUILDS has the deer, the rabbit and the
 * duck). The hedgehog and the squirrel aren't among them: too small to be in anyone's way, and every walker there
 * costs the solids a little each frame.
 */
const WALKERS: Partial<Record<number, Build>> = {
  [S.ROE]: BUILDS.deer,
  [S.HARE]: BUILDS.rabbit,
  [S.FOX]: { r: 0.3, height: 0.9, step: 0.2, mass: 9 },
  [S.MALLARD]: BUILDS.duck,
  [S.SWAN]: { r: 0.45, height: 1.2, step: 0.05, mass: 12 },
};
/** Beyond this far from the view an animal walks the open ground, without the solids (nobody sees it brush a trunk). */
const CLOSE = 45;

const m = new Matrix4();
const q = new Quaternion();
const v = new Vector3();
const s = new Vector3();

/** A tier's caps as the ecosystem counts them. */
export function capsOf(tier: Tier): Caps {
  const w = tier.wild;
  return { roe: tier.deer, hare: tier.rabbits, fox: w.fox, hedgehog: w.hedgehog, squirrel: w.squirrel, mallard: tier.ducks, swan: w.swan, heron: w.heron, fish: w.fish, songbird: tier.birds, swallow: w.swallow, starling: w.starling, goose: w.goose, kestrel: w.kestrel, owl: w.owl, bat: w.bat, insects: w.insects, fireflies: tier.fireflies };
}

/** How many instances each mesh needs for a set of caps (the grown ones, their young, and the birds two kinds share). */
export function roomOf(eco: Ecosystem, caps: Caps): Record<MeshName, number> {
  const slots = (k: number): number => eco.first[k + 1]! - eco.first[k]!;
  const room = {} as Record<MeshName, number>;
  for (const name of MESHES) room[name] = 0;
  for (let k = 0; k < KIND_COUNT; k++) {
    const name = KINDS[k]!;
    if (k === S.SONGBIRD || k === S.STARLING) room.bird += slots(k);
    else room[name as MeshName] = slots(k);
  }
  room.ring = slots(S.FISH) || slots(S.MALLARD) || slots(S.SWAN) ? 12 : 0;
  room.insect = caps.insects;
  room.firefly = caps.fireflies;
  return room;
}

export class Fauna {
  /** The ecosystem itself: the simulation, and the insects. */
  readonly eco: Ecosystem;
  readonly insects: Insects;
  private readonly view: EcoView;
  private readonly poser: Poser;
  private readonly env = emptyEnv();
  /** Each walker's place among the solids (a radius of 0 while it's away, in the air or out of sight), its mover, and its build. */
  private readonly circles: ({ x: number; y: number; r: number } | null)[];
  private readonly movers: (Mover | null)[];
  private joined = false;
  private readonly summed: EcoSummary = emptySummary();
  /** A season to look at instead of the date's (tours: `__sandboxEco.season`), and what a tour reads. */
  private seasonChoice: SeasonChoice | null = null;
  private readonly trace: { ms: number; sim: number; insects: number; pose: number; calls: number; triangles: number; instances: number } | null = null;
  private readonly split = [0, 0, 0];
  private readonly stat = { calls: 0, triangles: 0 };
  private traceSum = 0;
  private traceFrames = 0;
  private clock = 0;

  readonly particles: Particles;
  private readonly sparks: InstancedMesh;
  private readonly sparkMaterial: MeshBasicNodeMaterial;
  private readonly random = rng(23);

  constructor(
    root: Group,
    tier: Tier,
    private readonly ground: Ground,
    /** The land's own account of what grows where (trees to roost in, flowers to work); without it there are neither. */
    country: Country | null = null,
  ) {
    const caps = capsOf(tier);
    // The land as the ecosystem sees it: the ground as it's drawn, and the trees and flowers that really grow there.
    const chunk = (cx: number, cy: number, layer: Layer): Float64Array | null => {
      if (!country) return null;
      const list = country.list;
      for (let i = 0; i < list.length; i++) if (list[i]!.cx === cx && list[i]!.cy === cy) return list[i]!.samples.layers[layer] ?? null;
      return null;
    };
    const habitat: Habitat = {
      height: (x, y) => ground.height(x, y),
      blocked: (x, y) => ground.blocked(x, y),
      kind: (x, y, h) => groundAt(SEED, x, y, h, 0),
      trees: (cx, cy) => chunk(cx, cy, "trees"),
      flowers: (cx, cy) => chunk(cx, cy, "flowers"),
    };
    this.eco = new Ecosystem(habitat, { caps, seed: 0x5eed, reach: tier.wild.reach });
    this.insects = new Insects(habitat, caps.insects, caps.fireflies, 0x1b);
    this.view = new EcoView(root, roomOf(this.eco, caps), tier.shadows);
    this.poser = new Poser(this.eco, this.insects);
    this.circles = Array.from({ length: this.eco.n }, () => null);
    this.movers = Array.from({ length: this.eco.n }, () => null);
    // The lanterns of his camp and the bench by the lake: where the moths come, and the bats after them.
    const gz = (p: { x: number; y: number }): number => ground.height(p.x, p.y);
    const lanterns: [number, number, number][] = [
      [POLE.x + 0.38, POLE.y, gz(POLE) + POLE.lantern + 0.03],
      [DESK_LANTERN.x, DESK_LANTERN.y, gz(DESK_LANTERN) + DESK_LANTERN.z],
      [BENCH.x + BENCH.half + 0.35, BENCH.y, gz(BENCH) + 1.7],
    ];
    lanterns.forEach((l, i) => {
      this.insects.lights.set(l, i * 3);
      this.eco.wings.lights.set(l, i * 3);
    });
    this.insects.lightCount = this.eco.wings.lightCount = lanterns.length;

    this.particles = new Particles(tier.particles);
    this.sparkMaterial = new MeshBasicNodeMaterial({ color: 0xffb056, transparent: true, depthWrite: false, blending: AdditiveBlending });
    this.sparks = new InstancedMesh(new TetrahedronGeometry(0.07, 0), this.sparkMaterial, Math.max(1, tier.particles));
    this.sparks.instanceMatrix.setUsage(DynamicDrawUsage);
    this.sparks.count = 0;
    this.sparks.frustumCulled = false;
    root.add(this.sparks);

    // The page's `?trace=1`: what a tour reads (globalThis.__sandboxEco), and a season to look at.
    if (typeof location !== "undefined" && /[?&]trace=1(&|$)/.test(location.search)) {
      const trace = { ms: 0, sim: 0, insects: 0, pose: 0, calls: 0, triangles: 0, instances: 0 };
      this.trace = trace;
      const eco = this.eco;
      (globalThis as { __sandboxEco?: unknown }).__sandboxEco = {
        /** Who's about now, with counts and what most are doing; births, deaths, comings and goings so far. */
        summary: () => {
          const sum = this.summary();
          return { ...sum, lines: sum.lines.map((l) => ({ ...l })), text: summaryText(sum) };
        },
        /** A sample of animals: what each is, where, and what it's doing. */
        sample: (n = 24) => {
          const out: { slot: number; label: string; x: number; y: number; z: number; speed: number; energy: number }[] = [];
          for (let i = 0; i < eco.n && out.length < n; i++) {
            if (eco.alive[i] && eco.shown[i]! > 0.5) out.push({ slot: i, label: labelOf(eco, i), x: eco.x[i]!, y: eco.y[i]!, z: this.poser.drawnY[i]!, speed: eco.speed[i]!, energy: eco.energy[i]! / SPECS[eco.kind[i]!]!.reserve });
          }
          return out;
        },
        /** Where the first of a kind is (to point the view at it): null when there's none. */
        find: (kind: string, doing = "") => {
          const k = (KINDS as readonly string[]).indexOf(kind);
          if (k < 0) return null;
          for (let i = eco.first[k]!; i < eco.first[k + 1]!; i++) {
            if (eco.alive[i] && eco.shown[i]! > 0.5 && (!doing || labelOf(eco, i).includes(doing))) return { slot: i, label: labelOf(eco, i), x: eco.x[i]!, y: eco.y[i]!, z: this.poser.drawnY[i]! };
          }
          return null;
        },
        /** Where the first insect of a kind is (0 bumblebee, 1 butterfly, 2 dragonfly, 3 mayfly, 4 moth). */
        bug: (kind: number) => {
          const b = this.insects;
          for (let i = 0; i < b.n; i++) if (b.kind[i] === kind && b.shown[i]! > 0.8) return { x: b.x[i]!, y: b.y[i]!, z: b.z[i]! };
          return null;
        },
        /** A season to look at ("winter", "spring", "summer", "autumn"), or "live" for the date's. */
        season: (choice: SeasonChoice | null) => void (this.seasonChoice = choice),
        /** How in step the fireflies are, 0..1. */
        inStep: () => this.insects.inStep(),
        /** Milliseconds a frame the ecosystem costs here (a running mean), its draw calls, triangles and instances now. */
        cost: () => ({ ...trace }),
        startle: (x: number, y: number, r: number) => this.startle(x, y, r),
        /** Sets an animal down somewhere (a tour stages a meeting with it). */
        put: (slot: number, x: number, y: number) => {
          eco.x[slot] = eco.tx[slot] = x;
          eco.y[slot] = eco.ty[slot] = y;
          const at = this.circles[slot];
          if (at) {
            at.x = x;
            at.y = y;
          }
        },
        eco,
      };
    }
  }

  /** The animals that walk (and the ducks and swans) are among the world's solids from now on: they go round trunks and rocks, and keep out of each other's and Galahad's way. */
  join(solids: Solids): void {
    const eco = this.eco;
    for (let k = 0; k < KIND_COUNT; k++) {
      const build = WALKERS[k];
      if (!build) continue;
      const afloat = SPECS[k]!.realm === S.WATER;
      for (let i = eco.first[k]!; i < eco.first[k + 1]!; i++) {
        const at = { x: 0, y: 0, r: 0 };
        const mover = solids.join(at, build);
        // (Nothing pushes one where it couldn't go itself.)
        mover.ground = afloat ? (x, y) => eco.shore.blocked(x, y) : (x, y) => eco.land.blocked(x, y);
        this.circles[i] = at;
        this.movers[i] = mover;
      }
    }
    eco.walk = (slot, x, y, heading, step, out) => {
      const land = SPECS[eco.kind[slot]!]!.realm === S.LAND;
      const where = land ? eco.land : eco.shore;
      const mover = this.movers[slot];
      // On the open ground first (most steps meet nothing); only if that step would end inside something solid, and
      // it's near enough the view to be seen brushing a trunk, the full slide round it.
      const taken = moveOnGround(where, x, y, heading, step, out, land ? MAX_SLOPE : Infinity);
      if (taken === null || !mover || mover.at.r === 0 || Math.abs(x - eco.env.fx) > CLOSE || Math.abs(y - eco.env.fy) > CLOSE) return taken;
      if (!solids.overlaps(out.x, out.y, mover.at.r, mover.step, mover.height)) return taken;
      return slideOnGround(mover, where, x, y, heading, step, out, land ? MAX_SLOPE : Infinity);
    };
    this.joined = true;
  }

  /**
   * Steps the ecosystem and the particles and writes what's drawn (relative to the floating origin). `focus` is
   * where the view looks: the range is round it. The sky and the weather are the world's; Galahad and his dog are
   * noticed. Returns true when anything is visible and moving.
   */
  step(dt: number, focusX: number, focusY: number, origin: [number, number], sky: Sky, weather: WeatherState, galahad: Passer | null, dog: Passer | null, motion: boolean): boolean {
    const started = this.trace ? performance.now() : 0;
    const eco = this.eco;
    const env = this.env;
    if (this.seasonChoice) seasonFor(this.seasonChoice, Date.now(), seasonState);
    env.season = seasonState;
    env.night = sky.night;
    // The twilights: either side of the sun's setting and rising, and a little of the golden hour before.
    env.twilight = Math.max(0, 1 - Math.abs(sky.night - 0.45) / 0.45, 0.5 * sky.golden * (1 - sky.night));
    env.evening = sky.evening;
    env.lamps = sky.lamps;
    env.rain = Math.max(weather.rain, weather.snow);
    env.storm = weather.storm;
    env.wind = weather.wind;
    env.windHeading = weather.windHeading;
    env.fx = focusX;
    env.fy = focusY;
    env.gx = galahad ? galahad.x : Number.NaN;
    env.gy = galahad ? galahad.y : Number.NaN;
    env.dx = dog ? dog.x : Number.NaN;
    env.dy = dog ? dog.y : Number.NaN;
    if (this.joined) this.pulled();
    const t1 = this.trace ? performance.now() : 0;
    let t2 = t1;
    if (motion) {
      eco.step(dt, env);
      if (this.trace) t2 = performance.now();
      this.insects.step(dt, env, eco.midges);
      this.clock += dt;
    } else {
      eco.still(env);
      this.insects.still();
    }
    if (this.joined) this.pushed();
    const t3 = this.trace ? performance.now() : 0;
    const drawn = this.poser.write(this.view.batches, origin[0], origin[1], this.ground.height, this.clock, seasonState);
    if (this.trace) {
      this.split[0] = this.split[0]! + t2 - t1;
      this.split[1] = this.split[1]! + t3 - t2;
      this.split[2] = this.split[2]! + performance.now() - t3;
    }
    this.view.commit(1 - sky.night);
    this.stepParticles(motion ? dt : 0, origin);
    if (this.trace) {
      // (A browser's clock ticks in tenths of a millisecond: summed over many frames it's still true.)
      this.traceSum += performance.now() - started;
      if (++this.traceFrames >= 300) {
        this.trace.ms = this.traceSum / this.traceFrames;
        this.trace.sim = this.split[0]! / this.traceFrames;
        this.trace.insects = this.split[1]! / this.traceFrames;
        this.trace.pose = this.split[2]! / this.traceFrames;
        this.split.fill(0);
        this.traceSum = 0;
        this.traceFrames = 0;
      }
      this.view.stats(this.stat);
      this.trace.calls = this.stat.calls;
      this.trace.triangles = this.stat.triangles;
      this.trace.instances = drawn;
    }
    return motion && drawn > 0;
  }

  /** What the solids did to the walkers since last frame (someone heavier pushed one aside): taken up. */
  private pulled(): void {
    const eco = this.eco;
    for (let i = 0; i < eco.n; i++) {
      const at = this.circles[i];
      if (!at || at.r === 0) continue;
      if (at.x !== eco.x[i] || at.y !== eco.y[i]) {
        eco.x[i] = at.x;
        eco.y[i] = at.y;
      }
    }
  }

  /** Where each walker is now, for the solids: on the ground and in sight it's a circle, else it's away. */
  private pushed(): void {
    const eco = this.eco;
    for (let i = 0; i < eco.n; i++) {
      const at = this.circles[i];
      if (!at) continue;
      if (!eco.alive[i] || eco.air[i] || eco.shown[i]! < 0.5 || eco.going[i]) {
        at.r = 0;
        continue;
      }
      const k = eco.kind[i]!;
      at.x = eco.x[i]!;
      at.y = eco.y[i]!;
      at.r = WALKERS[k]!.r * (0.5 + 0.5 * eco.sizeOf(i, SPECS[k]!));
    }
  }

  /**
   * The animal under the pointer, for a hover label ("Roe deer · grazing"): the ray's origin and direction in the
   * scene, the floating origin, and where to put the label (x, y, and how far above the ground there), into `out`.
   */
  hover(ray: { origin: { x: number; y: number; z: number }; direction: { x: number; y: number; z: number } }, origin: readonly [number, number], out: [number, number, number]): string | null {
    const slot = this.poser.pick(origin[0], origin[1], ray.origin.x, ray.origin.y, ray.origin.z, ray.direction.x, ray.direction.y, ray.direction.z);
    if (slot < 0) return null;
    const eco = this.eco;
    const spec = SPECS[eco.kind[slot]!]!;
    out[0] = eco.x[slot]!;
    out[1] = eco.y[slot]!;
    out[2] = this.poser.drawnY[slot]! - this.ground.height(out[0], out[1]) + spec.tall * eco.sizeOf(slot, spec) + 0.25;
    return labelOf(eco, slot);
  }

  /**
   * For the dog: the nearest small animal within `r` metres of (x, y) that it might give a short chase (a hare, a
   * squirrel on the ground, a duck ashore, a bird feeding on the ground), into `out`. False: nothing to chase.
   * Nothing is allocated.
   */
  nearestSmall(x: number, y: number, r: number, out: Quarry): boolean {
    return this.eco.nearestSmall(x, y, r, out);
  }

  /** A fright at (x, y): everything within `r` metres runs, flies up, takes to the water or dives (a bark, a thrown ball landing). */
  startle(x: number, y: number, r: number): void {
    this.eco.startle(x, y, r);
  }

  /**
   * Who's about now: each kind in sight with how many, how many young, and what most are doing; and the births,
   * deaths and comings and goings since the page opened. The same object every time (ask as often as you like).
   */
  summary(): EcoSummary {
    return summarise(this.eco, this.insects, this.summed);
  }

  /** Where the nearest of a kind that's about is to (x, y) (the selector's "Wildlife": the view goes to it), into `out`; false when there's none. */
  locate(kind: string, x: number, y: number, out: { x: number; y: number }): boolean {
    const k = (KINDS as readonly string[]).indexOf(kind);
    if (k < 0) return false;
    const eco = this.eco;
    let best = Infinity;
    for (let i = eco.first[k]!; i < eco.first[k + 1]!; i++) {
      if (!eco.alive[i] || eco.shown[i]! <= 0.5) continue;
      const d = Math.hypot(eco.x[i]! - x, eco.y[i]! - y);
      if (d < best) {
        best = d;
        out.x = eco.x[i]!;
        out.y = eco.y[i]!;
      }
    }
    return best < Infinity;
  }

  private stepParticles(dt: number, origin: [number, number]): void {
    const p = this.particles;
    p.step(dt);
    let shown = 0;
    for (let i = 0; i < p.capacity; i++) {
      const life = p.life[i]!;
      if (life <= 0) continue;
      const k = i * 3;
      v.set(p.pos[k]! - origin[0], p.pos[k + 2]!, -(p.pos[k + 1]! - origin[1]));
      q.identity();
      s.setScalar(0.4 + 0.8 * (life / p.maxLife[i]!));
      m.compose(v, q, s);
      this.sparks.setMatrixAt(shown++, m);
    }
    this.sparks.count = shown;
    this.sparks.visible = shown > 0;
    this.sparks.instanceMatrix.needsUpdate = true;
  }

  /** Sparks from the forge's anvil (world coordinates). */
  sparksAt(x: number, y: number, z: number, n: number): void {
    for (let i = 0; i < n; i++) {
      const a = this.random() * Math.PI * 2;
      const up = 2.5 + this.random() * 2.5;
      const out = 0.6 + this.random() * 1.6;
      this.particles.emit(x, y, z, Math.cos(a) * out, Math.sin(a) * out, up, 0.5 + this.random() * 0.5);
    }
  }

  /** Exhaust from a rocket's tail (world coordinates), blown back along (dx, dy, dz). */
  exhaustAt(x: number, y: number, z: number, dx: number, dy: number, dz: number, speed: number): void {
    const jitter = speed * 0.25;
    this.particles.emit(x, y, z, dx * speed + (this.random() - 0.5) * jitter, dy * speed + (this.random() - 0.5) * jitter, dz * speed + (this.random() - 0.5) * jitter, 0.35 + this.random() * 0.4);
  }

  /** The instanced meshes sit at the floating origin (their instances are relative to it). */
  place(originScene: Vector3): void {
    this.view.place(originScene);
    this.sparks.position.copy(originScene);
  }

  dispose(): void {
    this.view.dispose();
    this.sparks.removeFromParent();
    this.sparks.geometry.dispose();
    this.sparks.dispose();
    this.sparkMaterial.dispose();
    if (this.trace) delete (globalThis as { __sandboxEco?: unknown }).__sandboxEco;
  }
}

export type { EcoSummary };
