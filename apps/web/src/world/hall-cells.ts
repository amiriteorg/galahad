import { solveTwoBone } from "./ik.ts";
import { joints, type Joints, play, type Waypoint, duration } from "./hall-arm.ts";
import type { HallUniforms } from "./hall-materials.ts";
import type { Build, Machines } from "./hall-machines.ts";
import { cylX, cylY } from "./hall-machines.ts";
import { CELL_FENCE, CELL_GATE, CELLS, type Cell, FENCE_HEIGHT } from "./hall-plan.ts";
import { BAR, BELT, K, SLOT } from "./hall-rig.ts";

/*
 * The four test cells: each fenced (posts, rails and wire-mesh panels), with a
 * gate on the aisle that's a light curtain between two posts, and a status
 * beacon (green: free, its resident testing; red: an experiment has it, the
 * curtain armed). While a cell is free its resident tests itself; when an
 * experiment takes the cell the resident clears out (dissolves away) and comes
 * back once it's free:
 *   cell-1  a six-axis arm cycling a test weight through its range (endurance)
 *   cell-2  a robot leg walking on a treadmill (its foot planted on the belt, moving with it)
 *   cell-3  a drone on a tether: it spools up, lifts off, holds station, lands
 *   cell-4  a shake table under a three-storey frame, in bursts
 * The residents' motions are pure functions of time (exported for the tests).
 */

/** The endurance arm's cycle: joint poses it moves through, holding each a moment. */
export const ENDURANCE: readonly number[][] = [
  [0, 0.35, 1.25, 0, 1.45, 0],
  [1.35, 0.85, 0.95, 1.1, 0.85, 1.6],
  [-1.15, 0.2, 1.6, -0.8, 1.15, -1],
  [0.55, -0.25, 1.95, 0, 0.6, 2.4],
];

/** The leg: thigh and shin lengths, the ankle's height over the sole, the treadmill's belt top and speed, the stride. */
export const LEG = { thigh: 0.62, shin: 0.62, ankle: 0.09, belt: 0.36, speed: 0.55, period: 1.5, stance: 0.6, hip: 1.52, lift: 0.13 };

const smooth = (t: number): number => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};

/** The foot's sole on the treadmill at time t, relative to the hip's place over the belt: x along the belt, z its height; and whether it's planted. */
export function legFoot(t: number, out: { x: number; z: number; planted: boolean; hip: number }): void {
  const L = LEG;
  const phase = (((t / L.period) % 1) + 1) % 1;
  const stride = L.speed * L.period * L.stance;
  if (phase < L.stance) {
    // On the belt: carried back at the belt's speed (it doesn't slip).
    out.x = stride / 2 - L.speed * phase * L.period;
    out.z = L.belt;
    out.planted = true;
  } else {
    const s = (phase - L.stance) / (1 - L.stance);
    out.x = -stride / 2 + stride * smooth(s);
    out.z = L.belt + L.lift * Math.sin(Math.PI * s);
    out.planted = false;
  }
  out.hip = L.hip + 0.03 * Math.cos(phase * Math.PI * 2);
}

/** The drone's flight: where its body is over its pad (x, y, z) and how hard its props turn (0..1), at time t. */
export function droneAt(t: number, out: { x: number; y: number; z: number; spin: number; tiltX: number; tiltY: number }): void {
  const cycle = 64;
  const c = ((t % cycle) + cycle) % cycle;
  const rest = 0.16;
  const hover = 2.3;
  let z = rest;
  let spin = 0;
  let drift = 0;
  if (c < 3) spin = smooth(c / 3) * 0.6;
  else if (c < 7) {
    spin = 1;
    z = rest + (hover - rest) * smooth((c - 3) / 4);
  } else if (c < 54) {
    spin = 1;
    z = hover + 0.12 * Math.sin(c * 0.5);
    drift = smooth((c - 7) / 3) * smooth((54 - c) / 3);
  } else if (c < 58) {
    spin = 1;
    z = rest + (hover - rest) * (1 - smooth((c - 54) / 4));
  } else spin = smooth((61 - c) / 3) * 0.6;
  out.x = drift * 0.75 * Math.sin(c * 0.31);
  out.y = drift * 0.55 * Math.sin(c * 0.23 + 1);
  out.z = z;
  out.spin = spin;
  // Leaning into its drift (the way it's speeding up).
  out.tiltX = -drift * 0.12 * Math.cos(c * 0.23 + 1);
  out.tiltY = drift * 0.14 * Math.cos(c * 0.31);
}

/** The shake table: the platform's displacement and each floor's (metres, along the burst's direction), at time t; and the direction (0 along x, 1 along y). */
export function shakeAt(t: number, floors: Float64Array): number {
  const burst = 16;
  const k = Math.floor(t / burst);
  const c = t - k * burst;
  const on = c < 8 ? smooth(c / 0.8) * smooth((8 - c) / 0.8) : 0;
  // A chirp from 0.8 Hz to 2.2 Hz: its phase is the integral of its frequency.
  const f0 = 0.8;
  const f1 = 2.2;
  const u = Math.min(c, 8);
  const phase = 2 * Math.PI * (f0 * u + ((f1 - f0) / 16) * u * u);
  const a = 0.06 * on;
  for (let i = 0; i < floors.length; i++) floors[i] = a * (1 + 0.6 * i) * Math.sin(phase - 0.32 * i);
  return k % 2;
}

const SHAKE = { base: 0.35, platform: 0.1, storey: 0.85, slab: 0.07, hx: 0.62, hy: 0.42 };

interface Resident {
  cell: Cell;
  /** Its bones (what each is depends on the resident). */
  bones: number[];
}

export class Cells {
  private readonly residents: Resident[] = [];
  private readonly curtains: number[] = [];
  private readonly endurance: Waypoint[] = ENDURANCE.map((q) => ({ q: Float64Array.from(q) as Joints, hold: 0.6 }));
  private readonly q = joints();
  private readonly foot = { x: 0, z: 0, planted: true, hip: LEG.hip };
  private readonly fly = { x: 0, y: 0, z: 0, spin: 0, tiltX: 0, tiltY: 0 };
  private readonly floors = new Float64Array(4);
  private readonly ik = new Float64Array(6);
  private armBones: ReturnType<Machines["arm"]> | null = null;

  constructor(
    private readonly b: Build,
    machines: Machines,
  ) {
    CELLS.forEach((cell, i) => {
      this.fence(cell, i);
      const fade = i + 1;
      const r: Resident = { cell, bones: [] };
      if (cell.resident === "arm") {
        this.armBones = machines.arm(cell.x, cell.y, 0.6, "weight", fade);
        b.quads.add(K.screen, [cell.x + 2.2, cell.y - 1.2, 1.0], [0, 0.6, 0], [0, 0, 0.3], 1, BAR.endurance, fade);
        this.cabinet(cell.x + 2.4, cell.y - 0.9, fade);
      } else if (cell.resident === "leg") r.bones = this.leg(cell, fade);
      else if (cell.resident === "drone") r.bones = this.drone(cell, fade);
      else r.bones = this.shake(cell, fade);
      this.residents.push(r);
    });
  }

  /** A control cabinet with a screen, for a resident (it goes with it). */
  private cabinet(x: number, y: number, fade: number): void {
    const { rig } = this.b;
    rig.tag("fade", fade).bone(0);
    rig.panel(K.cream, x, y, 0.55, 0.5, 0.4, 1.1, 0, 0.03, 0.03);
    rig.tag("fade", 0);
  }

  private fence(cell: Cell, i: number): void {
    const { solid, rig, bones, fences, detail, warm, cool } = this.b;
    const h = cell.size / 2 + CELL_FENCE;
    const gate = CELL_GATE / 2;
    const gy = cell.y - cell.side * h;
    // Four sides; the aisle side has the gate in its middle.
    const sides: { x0: number; y0: number; x1: number; y1: number }[] = [];
    for (const s of [-1, 1]) sides.push({ x0: cell.x + s * h, y0: cell.y - h, x1: cell.x + s * h, y1: cell.y + h });
    sides.push({ x0: cell.x - h, y0: cell.y + cell.side * h, x1: cell.x + h, y1: cell.y + cell.side * h });
    sides.push({ x0: cell.x - h, y0: gy, x1: cell.x - gate, y1: gy });
    sides.push({ x0: cell.x + gate, y0: gy, x1: cell.x + h, y1: gy });
    for (const side of sides) {
      const len = Math.hypot(side.x1 - side.x0, side.y1 - side.y0);
      const n = Math.max(1, Math.round(len / 2.6));
      const ux = (side.x1 - side.x0) / len;
      const uy = (side.y1 - side.y0) / len;
      for (let k = 0; k <= n; k++) {
        const px = side.x0 + ((side.x1 - side.x0) * k) / n;
        const py = side.y0 + ((side.y1 - side.y0) * k) / n;
        solid.box(K.yellow, px, py, FENCE_HEIGHT / 2, 0.07, 0.07, FENCE_HEIGHT);
        if (detail > 0) solid.box(K.dark, px, py, 0.02, 0.16, 0.16, 0.04);
      }
      for (const z of [0.12, FENCE_HEIGHT - 0.03]) solid.box(K.yellow, (side.x0 + side.x1) / 2, (side.y0 + side.y1) / 2, z, Math.abs(ux) * len + 0.04, Math.abs(uy) * len + 0.04, 0.04);
      // The mesh: one panel each side, drawn as a wire grid in the screens' shader.
      fences.add(0x2f333a, [side.x0, side.y0, 0.14], [side.x1 - side.x0, side.y1 - side.y0, 0], [0, 0, FENCE_HEIGHT - 0.2], 3, 0, 0, len / 0.07);
    }
    // The gate: two light-curtain posts, their beams, and the beacon.
    for (const s of [-1, 1]) {
      solid.panel(K.yellow, cell.x + s * gate, gy, 0.95, 0.1, 0.1, 1.9, 0, 0.02, 0.02);
      solid.box(K.charcoal, cell.x + s * (gate - 0.055), gy, 0.95, 0.012, 0.06, 1.7);
    }
    const curtain = bones.add();
    this.curtains.push(curtain);
    rig.bone(curtain).glow(SLOT.curtain + i);
    for (let k = 0; k < (detail === 0 ? 4 : 8); k++) rig.box(K.white, cell.x, gy, 0.22 + k * (detail === 0 ? 0.42 : 0.21), CELL_GATE - 0.12, 0.006, 0.006, 0, 0);
    rig.glow(0).bone(0);
    const bx = cell.beacon.x;
    const by = cell.beacon.y;
    solid.cyl(K.dark, bx, by, 0, 0.1, 0.06, 10);
    solid.cyl(K.steel, bx, by, 0.06, 0.035, 2.0, 8);
    const seg = [SLOT.red + i, SLOT.amber + i, SLOT.green + i];
    seg.forEach((slot, k) => {
      solid.glow(slot).cyl(K.white, bx, by, 2.06 + k * 0.16, 0.09, 0.14, 12, 0.09, 0).glow(0);
    });
    solid.cyl(K.dark, bx, by, 2.54, 0.09, 0.04, 12);
    void warm;
    void cool;
  }

  private leg(cell: Cell, fade: number): number[] {
    const { rig, bones, quads, detail } = this.b;
    const L = LEG;
    rig.tag("fade", fade).bone(0);
    const x = cell.x;
    const y = cell.y;
    // The treadmill: a frame, side rails, the motor's housing at its far end.
    rig.panel(K.dark, x, y, (L.belt - 0.02) / 2, 2.8, 0.9, L.belt - 0.02, 0, 0.03, 0.04);
    for (const s of [-1, 1]) rig.box(K.alu, x, y + s * 0.47, L.belt + 0.03, 2.8, 0.06, 0.08);
    rig.panel(K.orange, x + 1.55, y, 0.35, 0.35, 0.95, 0.5, 0, 0.03, 0.03);
    quads.add(0x4a4e55, [x + 1.4, y - 0.42, L.belt + 0.002], [-2.8, 0, 0], [0, 0.84, 0], 2, BELT.treadmill, fade, 2.8 / 0.25);
    // The rig over it: two posts and a beam, the hip's slider rail.
    for (const s of [-1, 1]) rig.panel(K.steel, x - 0.25, y + s * 0.8, 1.35, 0.12, 0.12, 2.7, 0, 0.02, 0.02);
    rig.panel(K.steel, x - 0.25, y, 2.68, 0.14, 1.72, 0.14, 0, 0.02, 0.02);
    rig.box(K.alu, x - 0.25, y - 0.12, 2.1, 0.06, 0.06, 1.1);
    this.cabinet(x - 2.4, y + 1.6, fade);
    quads.add(K.screen, [x - 2.66, y + 1.32, 0.95], [0, 0.56, 0], [0, 0, 0.3], 0, 21, fade);
    rig.tag("fade", fade);
    const slider = bones.add();
    rig.bone(slider);
    rig.panel(K.orange, -0.25, -0.05, 0.12, 0.2, 0.16, 0.3, 0, 0.03, 0.02);
    cylY(rig, K.dark, 0, 0, 0, 0.09, 0.2, 12);
    const thigh = bones.add();
    rig.bone(thigh);
    rig.panel(K.cream, 0, 0, -L.thigh / 2, 0.12, 0.13, L.thigh - 0.08, 0, 0.03, 0.04);
    cylY(rig, K.dark, 0, 0, -L.thigh, 0.075, 0.17, 12);
    const shin = bones.add();
    rig.bone(shin);
    rig.panel(K.orange, 0, 0, -L.shin / 2, 0.09, 0.1, L.shin - 0.06, 0, 0.03, 0.04);
    if (detail > 0) rig.rod(K.alu, 0.07, 0, -0.08, 0.07, 0, -L.shin + 0.12, 0.012, 6);
    cylY(rig, K.dark, 0, 0, -L.shin, 0.05, 0.12, 10);
    const foot = bones.add();
    rig.bone(foot);
    rig.panel(K.cream, 0.06, 0, -L.ankle + 0.04, 0.3, 0.12, 0.08, 0, 0.02, 0.03);
    rig.box(K.rubber, 0.06, 0, -L.ankle + 0.005, 0.3, 0.12, 0.01);
    rig.bone(0).tag("fade", 0);
    return [slider, thigh, shin, foot];
  }

  private drone(cell: Cell, fade: number): number[] {
    const { rig, bones } = this.b;
    rig.tag("fade", fade).bone(0);
    const x = cell.x;
    const y = cell.y;
    // The pad, with an H; the tether's winch beside it.
    rig.panel(K.dark, x, y, 0.08, 1.8, 1.8, 0.05, 0, 0.02, 0.02);
    for (const s of [-1, 1]) rig.box(K.white, x + s * 0.3, y, 0.112, 0.1, 0.8, 0.012, 0, 0);
    rig.box(K.white, x, y, 0.112, 0.5, 0.1, 0.012, 0, 0);
    rig.panel(K.orange, x + 1.25, y, 0.2, 0.36, 0.36, 0.4, 0, 0.03, 0.03);
    cylX(rig, K.alu, x + 1.25, y, 0.32, 0.1, 0.38, 12);
    this.cabinet(x - 2.4, y - 1.6, fade);
    this.b.quads.add(K.screen, [x - 2.66, y - 1.88, 0.95], [0, 0.56, 0], [0, 0, 0.3], 0, 23, fade);
    rig.tag("fade", fade);
    const body = bones.add();
    rig.bone(body);
    rig.panel(K.cream, 0, 0, 0, 0.32, 0.26, 0.12, 0, 0.04, 0.04);
    rig.box(K.orange, 0, 0, 0.07, 0.2, 0.16, 0.03);
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      rig.rod(K.dark, 0, 0, 0, 0.42 * Math.cos(a), 0.42 * Math.sin(a), 0.02, 0.022, 6);
      rig.cyl(K.dark, 0.42 * Math.cos(a), 0.42 * Math.sin(a), 0.0, 0.04, 0.07, 10);
    }
    for (const s of [-1, 1]) {
      rig.rod(K.dark, 0, s * 0.1, -0.05, 0.08, s * 0.14, -0.16, 0.01, 4);
      rig.rod(K.dark, 0, s * 0.1, -0.05, -0.08, s * 0.14, -0.16, 0.01, 4);
      rig.box(K.dark, 0, s * 0.14, -0.16, 0.3, 0.02, 0.02);
    }
    const props: number[] = [];
    for (let k = 0; k < 4; k++) {
      const p = bones.add();
      props.push(p);
      rig.bone(p);
      rig.box(K.charcoal, 0, 0, 0, 0.36, 0.035, 0.008, 0, 0.02);
      rig.cyl(K.orange, 0, 0, -0.01, 0.018, 0.03, 6);
    }
    const tether = bones.add();
    rig.bone(tether);
    rig.box(K.yellow, 0, 0, 0.5, 0.012, 0.012, 1, 0, 0);
    rig.bone(0).tag("fade", 0);
    return [body, ...props, tether];
  }

  private shake(cell: Cell, fade: number): number[] {
    const { rig, bones, detail } = this.b;
    const S = SHAKE;
    rig.tag("fade", fade).bone(0);
    const x = cell.x;
    const y = cell.y;
    rig.panel(K.dark, x, y, S.base / 2, 3, 3, S.base, 0, 0.04, 0.05);
    // The actuators, along x and along y.
    cylX(rig, K.alu, x - 1.85, y, S.base + 0.05, 0.12, 0.7, 12);
    cylY(rig, K.alu, x, y - 1.85, S.base + 0.05, 0.12, 0.7, 12);
    rig.box(K.dark, x - 2.3, y, (S.base + 0.1) / 2, 0.2, 0.5, S.base + 0.1);
    rig.box(K.dark, x, y - 2.3, (S.base + 0.1) / 2, 0.5, 0.2, S.base + 0.1);
    this.cabinet(x + 2.4, y + 1.6, fade);
    this.b.quads.add(K.screen, [x + 2.66, y + 1.88, 0.95], [0, -0.56, 0], [0, 0, 0.3], 0, 27, fade);
    rig.tag("fade", fade);
    const platform = bones.add();
    rig.bone(platform);
    rig.panel(K.alu, 0, 0, S.platform / 2, 2.6, 2.6, S.platform, 0, 0.03, 0.03);
    rig.rod(K.steel, -1.3, 0, 0.05, -1.55, 0, 0.05, 0.04, 8);
    rig.rod(K.steel, 0, -1.3, 0.05, 0, -1.55, 0.05, 0.04, 8);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) rig.box(K.dark, sx * S.hx, sy * S.hy, S.platform + 0.02, 0.16, 0.16, 0.04);
    const out = [platform];
    for (let f = 1; f <= 3; f++) {
      const slab = bones.add();
      out.push(slab);
      rig.bone(slab);
      rig.panel(f === 3 ? K.orange : K.cream, 0, 0, S.slab / 2, S.hx * 2 + 0.16, S.hy * 2 + 0.16, S.slab, 0, 0.02, 0.03);
      if (detail > 0 && f < 3) rig.box(K.blue, 0.2, 0.1, S.slab + 0.08, 0.22, 0.22, 0.16);
    }
    for (let k = 0; k < 12; k++) {
      const col = bones.add();
      out.push(col);
      rig.bone(col);
      rig.box(K.steel, 0, 0, 0.5, 0.05, 0.05, 1, 0, 0);
    }
    rig.bone(0).tag("fade", 0);
    return out;
  }

  /** Poses the residents at time t (each frozen in a tidy pose without motion); the cells' lights by whether they're taken. */
  pose(t: number, motion: boolean, u: HallUniforms, machines: Machines): void {
    const bones = this.b.bones;
    const T = motion ? t : 0;
    CELLS.forEach((cell, i) => {
      const present = u.presentValues[i + 1]!;
      const taken = present < 0.5;
      u.lampColors[SLOT.green + i]!.setRGB(taken ? 0.02 : 0.3, taken ? 0.05 : 1.6, taken ? 0.02 : 0.5);
      u.lampColors[SLOT.amber + i]!.setRGB(0.05, 0.03, 0.01);
      u.lampColors[SLOT.red + i]!.setRGB(taken ? 1.8 : 0.06, taken ? 0.2 : 0.02, taken ? 0.15 : 0.02);
      // The curtain's beams show while it's armed.
      const c = this.curtains[i]!;
      bones.set(c, IDENTITY, 0, 0, 0, taken ? 1 : 0, taken ? 1 : 0, taken ? 1 : 0);
      u.lampColors[SLOT.curtain + i]!.setRGB(1.6, 0.1, 0.08);
      if (present <= 0) return;
      const r = this.residents[i]!;
      if (cell.resident === "arm" && this.armBones) {
        const span = duration(this.endurance, this.endurance[this.endurance.length - 1]!.q);
        const into = motion ? T % span : 0;
        play(this.endurance, this.endurance[this.endurance.length - 1]!.q, into, this.q);
        machines.poseArm(this.armBones, cell.x, cell.y, 0.6, this.q, 0, 0, false);
        u.barValues[BAR.endurance] = into / span;
      } else if (cell.resident === "leg") this.poseLeg(cell, r.bones, T, motion, u);
      else if (cell.resident === "drone") this.poseDrone(cell, r.bones, T);
      else this.poseShake(cell, r.bones, T);
    });
  }

  private poseLeg(cell: Cell, b: number[], t: number, motion: boolean, u: HallUniforms): void {
    const bones = this.b.bones;
    const L = LEG;
    const [slider, thigh, shin, foot] = b as [number, number, number, number];
    legFoot(t, this.foot);
    const hx = cell.x;
    const hy = cell.y;
    const hz = this.foot.hip;
    bones.put(slider, hx, hy, hz);
    // The ankle over the sole; the knee forward (towards +x), by two-bone IK in the leg's plane.
    const ax = hx + this.foot.x;
    const az = this.foot.z + L.ankle;
    solveTwoBone(hx, hz, 0, ax, az, 0, hx + 1, hz - 0.6, 0, L.thigh, L.shin, this.ik);
    const kx = this.ik[0]!;
    const kz = this.ik[1]!;
    // Angles from straight down, towards +x.
    const a1 = Math.atan2(kx - hx, hz - kz);
    const a2 = Math.atan2(ax - kx, kz - az);
    bones.put(thigh, hx, hy, hz, 0, 0, -a1);
    bones.put(shin, kx, hy, kz, 0, 0, -a2);
    const toe = this.foot.planted ? 0 : -0.25 * Math.sin(Math.PI * Math.max(0, Math.min(1, (((t / L.period) % 1) - L.stance) / (1 - L.stance))));
    bones.put(foot, ax, hy, az, 0, 0, toe);
    u.beltValues[BELT.treadmill] = motion ? (t * L.speed) / 0.25 : 0;
  }

  private poseDrone(cell: Cell, b: number[], t: number): void {
    const bones = this.b.bones;
    const f = this.fly;
    droneAt(t, f);
    const x = cell.x + f.x;
    const y = cell.y + f.y;
    const [body, p0, p1, p2, p3, tether] = b as [number, number, number, number, number, number];
    bones.put(body, x, y, f.z, 0, f.tiltX, f.tiltY);
    const props = [p0, p1, p2, p3];
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      const ox = 0.42 * Math.cos(a);
      const oy = 0.42 * Math.sin(a);
      // The motor's top, on the tilted body (small angles: the tilt's lift on each arm's end).
      const lift = oy * Math.sin(f.tiltX) - ox * Math.sin(f.tiltY);
      bones.put(props[k]!, x + ox, y + oy, f.z + 0.08 + lift, (k % 2 ? 1 : -1) * t * 60 * f.spin + k, f.tiltX, f.tiltY);
    }
    bones.span(tether, cell.x + 1.25, cell.y, 0.42, x, y, f.z - 0.06);
  }

  private poseShake(cell: Cell, b: number[], t: number): void {
    const bones = this.b.bones;
    const S = SHAKE;
    const along = shakeAt(t, this.floors);
    const dx = (k: number) => (along === 0 ? this.floors[k]! : 0);
    const dy = (k: number) => (along === 1 ? this.floors[k]! : 0);
    const z0 = S.base;
    bones.put(b[0]!, cell.x + dx(0), cell.y + dy(0), z0);
    const top = (k: number) => z0 + S.platform + k * S.storey;
    for (let f = 1; f <= 3; f++) bones.put(b[f]!, cell.x + dx(f), cell.y + dy(f), top(f) - S.slab);
    let c = 4;
    for (let f = 1; f <= 3; f++) {
      const lowZ = f === 1 ? z0 + S.platform + 0.04 : top(f - 1);
      const highZ = top(f) - S.slab;
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          bones.span(b[c++]!, cell.x + dx(f - 1) + sx * S.hx, cell.y + dy(f - 1) + sy * S.hy, lowZ, cell.x + dx(f) + sx * S.hx, cell.y + dy(f) + sy * S.hy, highZ);
        }
      }
    }
  }
}

const IDENTITY = Float64Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]);
