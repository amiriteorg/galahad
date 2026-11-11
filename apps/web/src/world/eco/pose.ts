import type { Season } from "../season.ts";
import { WATER_LEVEL } from "../terrain.ts";
import type { Insects } from "./insects.ts";
import { NONE } from "./insects.ts";
import { type Ecosystem, POUNCE, RINGS } from "./sim.ts";
import * as S from "./species.ts";
import { KIND_COUNT, SPECS } from "./species.ts";

/*
 * From the simulation to what's drawn: every animal's place, the way it
 * faces, its tilt, its size, and the four numbers its body's rig answers to
 * (models.ts), written straight into the instanced meshes' own arrays. Pure
 * (typed arrays in, typed arrays out), so the tests can hold it to the same
 * budget as the simulation. Nothing is allocated.
 *
 * Feet stand on the ground as it's drawn (the height it's given), bodies lean
 * with the slope under them, hares and running deer leave the ground between
 * bounds, ducks ride the water. What's beyond its kind's sight line from the
 * view's focus isn't written at all.
 */

/** The meshes, in order: one a kind (the songbirds and starlings share the small bird), the fish's shadows, the rings on the water, the insects, the fireflies. */
export const MESHES = ["roe", "hare", "fox", "hedgehog", "squirrel", "mallard", "swan", "heron", "bird", "swallow", "goose", "kestrel", "owl", "bat", "fish", "ring", "insect", "firefly"] as const;
export type MeshName = (typeof MESHES)[number];
export const M_BIRD = 8;
export const M_FISH = 14;
export const M_RING = 15;
export const M_INSECT = 16;
export const M_FIREFLY = 17;
/** Which mesh each kind is drawn with. */
const MESH_OF = [0, 1, 2, 3, 4, 5, 6, 7, M_FISH, M_BIRD, 9, M_BIRD, 10, 11, 12, 13];

/**
 * One mesh's instances, four numbers each of: where it is and the way it faces (x, y, z in the scene, yaw); its
 * tilt and size (nose up, bank, scale across, scale up); its rig (phase, amount, nod, pose); its look (a tint, and
 * the flag for the parts only some have). The vertex shader does the rest (view.ts).
 */
export interface Batch {
  spot: Float32Array;
  lean: Float32Array;
  anim: Float32Array;
  look: Float32Array;
  /** How many it has room for, and how many were written. */
  room: number;
  count: number;
}

export const batch = (room: number): Batch => {
  const n = Math.max(1, room) * 4;
  return { spot: new Float32Array(n), lean: new Float32Array(n), anim: new Float32Array(n), look: new Float32Array(n), room: Math.max(1, room), count: 0 };
};

/** How far from the view's focus each kind is drawn (metres): the small ones not far, what's in the sky from a long way. */
const SIGHT = [190, 120, 150, 70, 80, 150, 190, 190, 70, 160, 170, 400, 520, 260, 200, 110];
/** How much each kind's lying down lowers it, at full size (metres). */
const DROP = [0.6, 0.06, 0.26, 0, 0.02, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
/** How long each kind is, nose to tail (metres): for the lean of its body on a slope. */
const LENGTH = [1.1, 0.45, 0.8, 0.3, 0.3, 0.4, 0.9, 0.5, 0, 0, 0, 0, 0, 0, 0, 0];
/** The songbirds' colours (a robin's, a blue tit's, a blackbird's, a chaffinch's): a tint each. */
const FEATHERS = [
  [0.86, 0.5, 0.3],
  [0.62, 0.74, 0.98],
  [0.24, 0.23, 0.25],
  [0.92, 0.78, 0.5],
  [0.74, 0.64, 0.52],
];
/** The insects: a tint and a shape (how wide and long, how tall) each. Bumblebee, butterfly (three kinds), dragonfly, mayfly, moth. */
const INSECT_TINT = [
  [1, 0.72, 0.16],
  [1, 1, 1],
  [0.55, 0.85, 0.95],
  [0.92, 0.96, 0.9],
  // (A moth is only ever seen by lantern light: lit as the lantern lights it.)
  [2.6, 2.2, 1.6],
];
const BUTTERFLY_TINT = [
  [1, 0.97, 0.9],
  [1, 0.86, 0.3],
  [1, 0.55, 0.22],
  [0.62, 0.72, 1],
];
const INSECT_SHAPE = [
  [0.95, 1.6],
  [1.9, 1],
  [2.7, 1],
  [1.1, 1],
  [1.5, 1],
];

/** Writes one instance's place: at (x, y, z) in the scene, facing `yaw`, nose up by `pitch`, banked by `roll` (left wing down for a positive roll), scaled `wide` across and `tall` up. */
export function place(out: Batch, at: number, x: number, y: number, z: number, yaw: number, pitch: number, roll: number, wide: number, tall: number): void {
  const o = at * 4;
  out.spot[o] = x;
  out.spot[o + 1] = y;
  out.spot[o + 2] = z;
  out.spot[o + 3] = yaw;
  out.lean[o] = pitch;
  out.lean[o + 1] = roll;
  out.lean[o + 2] = wide;
  out.lean[o + 3] = tall;
}

export class Poser {
  /** Each animal's height as drawn (the scene's y of its feet), and whether it was drawn this frame: for picking. */
  readonly drawnY: Float32Array;
  readonly drawn: Uint8Array;

  constructor(
    private readonly eco: Ecosystem,
    private readonly insects: Insects,
  ) {
    this.drawnY = new Float32Array(eco.n);
    this.drawn = new Uint8Array(eco.n);
  }

  /**
   * Writes every batch for this frame. (ox, oy) is the floating origin; `height` the ground as it's drawn; `t`
   * seconds, for the water's bob. Returns how many instances were written in all.
   */
  write(batches: readonly Batch[], ox: number, oy: number, height: (x: number, y: number) => number, t: number, season: Season): number {
    const eco = this.eco;
    for (let b = 0; b < batches.length; b++) batches[b]!.count = 0;
    const fx = eco.env.fx;
    const fy = eco.env.fy;
    const winter = season.winter;
    let total = 0;
    for (let k = 0; k < KIND_COUNT; k++) {
      const a = eco.first[k]!;
      const end = eco.first[k + 1]!;
      if (a === end) continue;
      const spec = SPECS[k]!;
      const out = batches[MESH_OF[k]!]!;
      const sight = SIGHT[k]!;
      for (let i = a; i < end; i++) {
        this.drawn[i] = 0;
        if (!eco.alive[i] || eco.shown[i]! < 0.02 || out.count >= out.room) continue;
        const x = eco.x[i]!;
        const y = eco.y[i]!;
        if (Math.abs(x - fx) > sight || Math.abs(y - fy) > sight) continue;
        const n = out.count++;
        total++;
        const size = eco.sizeOf(i, spec) * eco.shown[i]!;
        const heading = eco.heading[i]!;
        const yaw = heading + Math.PI / 2;
        let py: number;
        let pitch = eco.pitch[i]!;
        let roll = 0;
        let nod = eco.nod[i]!;
        let pose = eco.lie[i]!;
        let amount = eco.amount[i]!;
        let phase = eco.phase[i]!;
        let scale = size;
        let flag = 0;
        let tr = 1;
        let tg = 1;
        let tb = 1;
        const d = eco.doing[i]!;
        if (k === S.FISH) {
          // A shadow under the water (fainter the deeper it swims), or a leap over it.
          const leap = eco.air[i] === 1;
          py = leap ? eco.z[i]! : WATER_LEVEL + 0.012;
          roll = leap ? Math.PI / 2 : 0;
          pitch = leap ? pitch : 0;
          // (Its rig's third number is how dark its shadow is; its fourth and its flag say it's out in the air, silver.)
          nod = leap ? 1 : Math.max(0.06, 0.5 - eco.z[i]! * 0.95) * eco.shown[i]!;
          pose = leap ? 1 : 0;
          flag = pose;
          scale = (0.55 + 0.45 * eco.sizeOf(i, spec)) * (0.8 + 0.5 * eco.own[i]!);
        } else if (spec.realm === S.AIR) {
          if (eco.air[i]) py = eco.z[i]!;
          else {
            // On the ground: a hop now and then (`vz` counts it down).
            const hop = k === S.SONGBIRD && eco.vz[i]! > 0 ? Math.sin((eco.vz[i]! / 0.16) * Math.PI) * 0.07 : 0;
            py = height(x, y) + hop;
          }
          roll = eco.roll[i]!;
          if (k === S.SONGBIRD) {
            const c = FEATHERS[Math.floor(eco.own[i]! * 4.999)]!;
            tr = c[0]!;
            tg = c[1]!;
            tb = c[2]!;
            scale = size * 1.45;
          } else if (k === S.STARLING) {
            tr = 0.17;
            tg = 0.18;
            tb = 0.22;
            scale = size * 1.5;
          } else if (k === S.OWL && !eco.air[i]) py = height(x, y);
        } else if (spec.realm === S.WATER) {
          const afloat = !eco.air[i] && height(x, y) < WATER_LEVEL - 0.04;
          // Afloat it rides the water, low; ashore it stands on the bank and waddles.
          py = eco.air[i] ? eco.z[i]! : afloat ? WATER_LEVEL - (k === S.SWAN ? 0.1 : 0.07) * size + 0.012 * Math.sin(t * 1.3 + i) : height(x, y);
          // (The simulation's tip is nose down.)
          pitch = eco.air[i] ? 0 : -pitch;
          if (!afloat && !eco.air[i]) roll = Math.sin(phase) * 0.14 * amount;
          flag = eco.female[i] ? 0 : 1;
          if (k === S.MALLARD && eco.age[i]! < spec.grown) {
            // Ducklings: yellow and brown, neither duck nor drake yet.
            flag = 0;
            tr = 1.15;
            tg = 1.05;
            tb = 0.6;
          } else if (k === S.SWAN && eco.age[i]! < spec.grown) {
            tr = 0.66;
            tg = 0.64;
            tb = 0.62;
          }
          // (Wings beat by their own clock only while it flaps.)
          if (amount < 0.02) phase = 0;
        } else if (spec.realm === S.WADER) {
          py = eco.air[i] ? eco.z[i]! : height(x, y);
          if (eco.air[i]) roll = eco.roll[i]!;
        } else {
          // On the land: feet on the ground as it's drawn, the body leaning with the slope under it.
          const ground = height(x, y);
          py = eco.air[i] ? eco.z[i]! : ground;
          const len = LENGTH[k]! * size;
          if (!eco.air[i] && len > 0.25 && d !== S.MOUSE) {
            const cx = Math.cos(heading) * len * 0.5;
            const sy = Math.sin(heading) * len * 0.5;
            pitch += Math.atan2(height(x + cx, y + sy) - height(x - cx, y - sy), len);
          }
          const speed = eco.speed[i]!;
          if (k === S.HARE || k === S.SQUIRREL) {
            // It bounds: off the ground between strides, nose up as it leaves and down as it lands.
            if (!eco.air[i] && speed > 0.2) {
              const s = Math.sin(phase);
              py += Math.max(0, s) * (0.05 + 0.02 * speed) * size;
              pitch += Math.cos(phase) * 0.16 * Math.min(1, speed / 3);
            }
          } else if (k === S.ROE && speed > 3.2) {
            const s = Math.sin(phase);
            py += Math.max(0, s) * 0.3 * size;
            pitch += Math.cos(phase) * 0.14;
          } else if (k === S.FOX && d === S.MOUSE && eco.timer[i]! < POUNCE) {
            // The pounce: up and over.
            py += Math.sin((1 - Math.max(0, eco.timer[i]!) / POUNCE) * Math.PI) * 0.8;
          }
          // Lying, its body comes down onto its folded legs.
          py -= pose * DROP[k]! * size;
          if (k === S.ROE) {
            flag = !eco.female[i] && eco.age[i]! >= spec.grown ? 1 : 0;
            // A greyer coat in winter; fawns a shade paler.
            tr = 1 - 0.2 * winter;
            tg = 1 - 0.12 * winter;
            tb = 1 + 0.06 * winter;
            if (eco.age[i]! < spec.grown * 0.5) {
              tr *= 1.08;
              tg *= 1.04;
            }
          }
        }
        this.drawnY[i] = py;
        this.drawn[i] = 1;
        place(out, n, x - ox, py, -(y - oy), yaw, pitch, roll, scale, scale);
        const q = n * 4;
        out.anim[q] = phase;
        out.anim[q + 1] = amount;
        out.anim[q + 2] = nod;
        out.anim[q + 3] = pose;
        out.look[q] = tr;
        out.look[q + 1] = tg;
        out.look[q + 2] = tb;
        out.look[q + 3] = flag;
      }
    }
    total += this.rings(batches[M_RING]!, ox, oy);
    total += this.bugs(batches[M_INSECT]!, batches[M_FIREFLY]!, ox, oy);
    return total;
  }

  /** The rings on the water: each widening and fading over a second and a half. */
  private rings(out: Batch, ox: number, oy: number): number {
    const r = this.eco.rings;
    for (let n = 0; n < RINGS; n++) {
      const age = r[n * 4 + 2]!;
      if (age > 1.6 || out.count >= out.room) continue;
      const u = age / 1.6;
      const size = r[n * 4 + 3]! * (0.15 + 0.85 * Math.sqrt(u));
      const at = out.count++;
      place(out, at, r[n * 4]! - ox, WATER_LEVEL + 0.015, -(r[n * 4 + 1]! - oy), 0, 0, 0, size, 1);
      out.anim[at * 4] = 0;
      out.anim[at * 4 + 1] = 0;
      out.anim[at * 4 + 2] = (1 - u) * 0.7;
      out.anim[at * 4 + 3] = 0;
      // (White, and riding the waves.)
      out.look[at * 4] = out.look[at * 4 + 1] = out.look[at * 4 + 2] = out.look[at * 4 + 3] = 1;
    }
    return out.count;
  }

  /** The insects (each its kind's shape and colour) and the fireflies (each as bright as it is this instant). */
  private bugs(out: Batch, glow: Batch, ox: number, oy: number): number {
    const b = this.insects;
    for (let i = 0; i < b.n; i++) {
      const k = b.kind[i]!;
      if (k === NONE || out.count >= out.room) continue;
      const at = out.count++;
      const shape = INSECT_SHAPE[k]!;
      const s = b.shown[i]!;
      place(out, at, b.x[i]! - ox, b.z[i]!, -(b.y[i]! - oy), b.heading[i]! + Math.PI / 2, 0, 0, shape[0]! * s, shape[1]! * s);
      const tint = k === S.BUTTERFLY ? BUTTERFLY_TINT[i & 3]! : INSECT_TINT[k]!;
      const q = at * 4;
      out.anim[q] = b.phase[i]!;
      out.anim[q + 1] = b.amount[i]!;
      out.anim[q + 2] = 0;
      out.anim[q + 3] = 0;
      out.look[q] = tint[0]!;
      out.look[q + 1] = tint[1]!;
      out.look[q + 2] = tint[2]!;
      out.look[q + 3] = 0;
    }
    if (b.fireflyLevel > 0.01) {
      for (let i = 0; i < b.fireflies && glow.count < glow.room; i++) {
        const at = glow.count++;
        const g = b.glow[i]!;
        // A spark while it's dark, a flare as it flashes.
        const size = 0.35 + 0.65 * g;
        place(glow, at, b.fx[i]! - ox, b.fz[i]!, -(b.fy[i]! - oy), 0, 0, 0, size, size);
        glow.anim[at * 4] = 0;
        glow.anim[at * 4 + 1] = 0;
        glow.anim[at * 4 + 2] = (0.06 + 0.94 * g) * b.fireflyLevel;
        glow.anim[at * 4 + 3] = 0;
      }
    }
    return out.count + glow.count;
  }

  /**
   * The animal a ray meets first (the pointer's, in the scene's own frame: its origin and its direction), of those
   * drawn this frame: its slot, or −1. Each is a ball about its middle, a little generous (they're small).
   */
  pick(ox: number, oy: number, rx: number, ry: number, rz: number, dx: number, dy: number, dz: number): number {
    const eco = this.eco;
    let best = Infinity;
    let found = -1;
    for (let i = 0; i < eco.n; i++) {
      if (!this.drawn[i]) continue;
      const spec = SPECS[eco.kind[i]!]!;
      if (spec.realm === S.SWIMMER && !eco.air[i]) continue;
      const size = eco.sizeOf(i, spec);
      const r = Math.max(0.3, spec.tall * 0.5 * size);
      // From the ray's origin to the ball's middle.
      const cx = eco.x[i]! - ox - rx;
      const cy = this.drawnY[i]! + (eco.air[i] && spec.realm === S.AIR ? 0 : spec.tall * 0.45 * size) - ry;
      const cz = -(eco.y[i]! - oy) - rz;
      const along = cx * dx + cy * dy + cz * dz;
      if (along < 0 || along > best) continue;
      const off2 = cx * cx + cy * cy + cz * cz - along * along;
      // (More generous far off, where a ball is a pixel or two.)
      const reach = r + along * 0.012;
      if (off2 < reach * reach) {
        best = along;
        found = i;
      }
    }
    return found;
  }
}

