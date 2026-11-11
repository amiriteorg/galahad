import type { WorldPartner } from "@galahad/core/world";
import { BoxGeometry, type BufferGeometry, CylinderGeometry, DynamicDrawUsage, type Group, IcosahedronGeometry, InstancedMesh, type Matrix4, MeshLambertMaterial, Object3D, Vector3 } from "three/webgpu";
import type { Build, Mover, Solids } from "./collide.ts";
import { headingToSceneYaw } from "./coords.ts";
import { at, bevelBox, Mesher } from "./mesher.ts";
import { turnTowards } from "./path.ts";
import { criticalDamping, type Ground, slideOnGround, springStep } from "./physics.ts";

/*
 * His partners in the world: each coding agent working with him over MCP (Claude
 * Code, OpenCode…) is a small squire, a robot in the knights' style (cream plates,
 * an orange tabard, a dark visor with a glowing line), its name on hover. It
 * appears at the keep when its first call comes, walks beside him to the station
 * its calls send them to, stands by while they work, and when it's gone quiet it
 * walks back to the keep and fades away.
 *
 * Cheap: every squire is three instanced meshes in all (body and head, legs, arms),
 * posed every frame without allocating; MAX squires, each a small circle among the
 * solids (r 0 while it's away). The simulation (`PartnerFigures.step`) is plain
 * numbers, so unit-tested without a GPU.
 */

export const MAX = 6;
/** Its build among the solids: about the dog's size, a little taller. */
export const SQUIRE: Build = { r: 0.34, height: 1.3, step: 0.2, mass: 30 };
/** Where it comes from and goes back to: the keep's door, at the foot of its stairs. */
export const KEEP_DOOR = { x: 1.6, y: -9.8 };
/** How long it takes to appear and to fade (seconds). */
const FADE = 0.8;
/** Where each keeps by him: to his left (the dog keeps to his right) and a little behind, the next further back. */
const SPOT = (i: number): [number, number] => [-(1.25 + 0.15 * (i % 2)), 0.6 + 0.85 * i];
/** His footsteps they remember (every half metre), to follow him round what stands between. */
const TRAIL = 64;

export interface Squire {
  /** The agent it is (empty while the slot's free). */
  name: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  heading: number;
  /** 0 away .. 1 here (appearing, fading). */
  shown: number;
  /** Still working (its partner is in the model), or going home. */
  here: boolean;
  /** Its stride's phase (radians) and how much it walks (0..1). */
  phase: number;
  walk: number;
}

export interface Leader {
  x: number;
  y: number;
  heading: number;
  moving: boolean;
}

/** The squires' simulation: who's here, where each walks, how far each has faded in. */
export class PartnerFigures {
  readonly squires: Squire[] = [];
  private readonly movers: (Mover | null)[] = [];
  private readonly scratch = { x: 0, y: 0 };
  private ground: Ground = { height: () => 0, blocked: () => false };
  private readonly trail = new Float64Array(TRAIL * 2);
  private trailCount = 0;
  private trailHead = 0;
  private readonly aim = { x: 0, y: 0 };

  /** Remembers where he walks, every half metre. */
  private footstep(x: number, y: number): void {
    const last = (this.trailHead + TRAIL - 1) % TRAIL;
    if (this.trailCount && Math.hypot(this.trail[last * 2]! - x, this.trail[last * 2 + 1]! - y) < 0.5) return;
    this.trail[this.trailHead * 2] = x;
    this.trail[this.trailHead * 2 + 1] = y;
    this.trailHead = (this.trailHead + 1) % TRAIL;
    this.trailCount = Math.min(TRAIL, this.trailCount + 1);
  }

  /**
   * Something solid between a squire and where it wants to be: the newest of his footsteps it can go to straight
   * (he walked there, so one to the next is clear), into `aim`. False when the way is clear, or none is in sight.
   */
  private followFootsteps(mover: Mover, x: number, y: number, tx: number, ty: number): boolean {
    if (mover.sweep(x, y, tx - x, ty - y, 0, false) >= 1) return false;
    for (let k = 1; k <= this.trailCount; k++) {
      const i = (this.trailHead + TRAIL - k) % TRAIL;
      const px = this.trail[i * 2]!;
      const py = this.trail[i * 2 + 1]!;
      if (mover.sweep(x, y, px - x, py - y, 0, false) < 1) continue;
      this.aim.x = px;
      this.aim.y = py;
      return true;
    }
    return false;
  }

  constructor() {
    for (let i = 0; i < MAX; i++) this.squires.push({ name: "", x: KEEP_DOOR.x, y: KEEP_DOOR.y, vx: 0, vy: 0, r: 0, heading: Math.PI / 2, shown: 0, here: false, phase: 0, walk: 0 });
  }

  /** Walks among the world's solids from now on. */
  join(solids: Solids, ground: Ground): void {
    this.ground = ground;
    for (const s of this.squires) {
      const m = solids.join(s, SQUIRE);
      m.ground = ground.blocked;
      this.movers.push(m);
    }
  }

  /** Who's working with him now (the model's partners): newcomers appear at the keep, those gone head home. */
  sync(partners: readonly WorldPartner[]): void {
    for (const s of this.squires) if (s.name && !partners.some((p) => p.name === s.name)) s.here = false;
    for (const p of partners) {
      const known = this.squires.find((s) => s.name === p.name);
      if (known) {
        known.here = true;
        continue;
      }
      const free = this.squires.find((s) => !s.name) ?? this.squires.find((s) => !s.here);
      if (!free) continue;
      Object.assign(free, { name: p.name, x: KEEP_DOOR.x, y: KEEP_DOOR.y, vx: 0, vy: 0, heading: Math.PI / 2, shown: 0, here: true, walk: 0 });
    }
  }

  /** How many are about (here, or still fading). */
  get count(): number {
    let n = 0;
    for (const s of this.squires) if (s.name) n++;
    return n;
  }

  /**
   * One step: each that's here keeps its spot beside him (on a spring, sliding along what it meets); each
   * that's gone walks to the keep's door and fades. Under reduced motion they're simply there, or not.
   */
  step(dt: number, galahad: Leader, motion: boolean): void {
    const fx = Math.cos(galahad.heading);
    const fy = Math.sin(galahad.heading);
    if (this.movers.length) this.footstep(galahad.x, galahad.y);
    let slot = 0;
    for (let i = 0; i < this.squires.length; i++) {
      const s = this.squires[i]!;
      if (!s.name) {
        s.r = 0;
        continue;
      }
      let tx = KEEP_DOOR.x;
      let ty = KEEP_DOOR.y;
      if (s.here) {
        // As the dog's spots are reckoned (dog.ts): a positive side is his right, so these are on his left.
        const [side, back] = SPOT(slot++);
        tx = galahad.x + fy * side - fx * back;
        ty = galahad.y - fx * side - fy * back;
      }
      if (!motion) {
        s.shown = s.here ? 1 : 0;
        if (s.here) {
          s.x = tx;
          s.y = ty;
          s.heading = galahad.heading;
        } else s.name = "";
        s.walk = 0;
        s.r = s.here ? SQUIRE.r : 0;
        continue;
      }
      s.shown = Math.max(0, Math.min(1, s.shown + (s.here ? dt : -dt) / FADE));
      // Gone home (or faded on the way): the slot is free again.
      if (!s.here && (s.shown <= 0 || Math.hypot(s.x - KEEP_DOOR.x, s.y - KEEP_DOOR.y) < 0.6)) {
        if (s.shown <= 0) {
          s.name = "";
          s.r = 0;
          continue;
        }
        s.shown = Math.max(0, s.shown - dt / FADE);
      }
      s.r = s.shown > 0.3 ? SQUIRE.r : 0;
      const mover0 = this.movers[i];
      // Round what stands in the way: in his footsteps (going home, straight for the door: he came from there).
      if (mover0 && s.here && this.followFootsteps(mover0, s.x, s.y, tx, ty)) {
        tx = this.aim.x;
        ty = this.aim.y;
      }
      const sx = s.x;
      const sy = s.y;
      const k = 9;
      springStep(s, tx, ty, k, criticalDamping(k) * 1.1, dt, galahad.moving || !s.here ? 3.4 : 1.6);
      const dx = s.x - sx;
      const dy = s.y - sy;
      const d = Math.hypot(dx, dy);
      const mover = this.movers[i];
      if (d > 1e-5 && mover) {
        const taken = slideOnGround(mover, this.ground, sx, sy, Math.atan2(dy, dx), d, this.scratch);
        s.x = this.scratch.x;
        s.y = this.scratch.y;
        if (taken === null) s.vx = s.vy = 0;
      }
      const speed = dt > 0 ? Math.hypot(s.x - sx, s.y - sy) / dt : 0;
      if (speed > 0.2) s.heading = turnTowards(s.heading, Math.atan2(s.y - sy, s.x - sx), 7 * dt);
      else if (s.here) s.heading = turnTowards(s.heading, galahad.heading, 2 * dt);
      s.walk += (Math.min(1, speed / 1.4) - s.walk) * (1 - Math.exp(-dt * 8));
      s.phase = (s.phase + dt * (5 + speed * 4)) % (Math.PI * 2);
    }
  }

  /** The squire nearest a world point within `r` metres. */
  near(x: number, y: number, r: number): Squire | null {
    let best: Squire | null = null;
    let bd = r;
    for (const s of this.squires) {
      if (!s.name || s.shown < 0.3) continue;
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }
}

const CREAM = 0xf1ebdc;
const ORANGE = 0xe8853a;
const JOINT = 0x43474f;
const VISOR = 0x15171b;
const GLOW = 0xffc46a;

/** Drawn: the squires as three instanced meshes (body and head; legs; arms), posed from the simulation. */
export class Partners {
  readonly figures = new PartnerFigures();
  private readonly material = new MeshLambertMaterial({ vertexColors: true });
  private readonly body: InstancedMesh;
  private readonly legs: InstancedMesh;
  private readonly arms: InstancedMesh;
  private readonly root = new Object3D();
  private readonly part = new Object3D();

  constructor(group: Group, shadows: boolean) {
    const bv = (w: number, h: number, d: number) => bevelBox(w, h, d, Math.min(0.02, Math.min(w, h, d) * 0.2));
    const geometry = (build: (m: Mesher) => void): BufferGeometry => {
      const m = new Mesher();
      build(m);
      return m.build();
    };
    // Body and head (its origin at the hips): a cream chest with an orange tabard, a round helm with a visor and its glowing line.
    const body = geometry((m) => {
      m.add(bv(0.34, 0.36, 0.24), CREAM, at(0, 0.26, 0) as Matrix4)
        .add(bv(0.36, 0.2, 0.26), ORANGE, at(0, 0.1, 0.005) as Matrix4, 0.02)
        .add(new BoxGeometry(0.2, 0.22, 0.02), ORANGE, at(0, -0.04, 0.12) as Matrix4, 0)
        .add(new IcosahedronGeometry(0.16, 1), CREAM, at(0, 0.6, 0) as Matrix4, 0.03)
        .add(new BoxGeometry(0.22, 0.08, 0.06), VISOR, at(0, 0.6, 0.13) as Matrix4, 0)
        .glow(1)
        .add(new BoxGeometry(0.18, 0.012, 0.02), GLOW, at(0, 0.6, 0.165) as Matrix4, 0)
        .glow(0)
        .add(new CylinderGeometry(0.012, 0.012, 0.16, 5), JOINT, at(0.07, 0.8, -0.03) as Matrix4, 0)
        .add(new IcosahedronGeometry(0.025, 0), ORANGE, at(0.07, 0.885, -0.03) as Matrix4, 0)
        .add(bv(0.18, 0.2, 0.08), JOINT, at(0, 0.3, -0.15) as Matrix4, 0);
    });
    // A leg (its origin at the hip, hanging down): a dark limb with a cream guard and a foot.
    const leg = geometry((m) => {
      m.add(new CylinderGeometry(0.045, 0.04, 0.36, 8), JOINT, at(0, -0.2, 0) as Matrix4)
        .add(bv(0.1, 0.18, 0.1), CREAM, at(0, -0.12, 0.01) as Matrix4, 0.02)
        .add(bv(0.1, 0.05, 0.17), JOINT, at(0, -0.4, 0.03) as Matrix4, 0);
    });
    // An arm (its origin at the shoulder): an orange pauldron, a dark arm, a cream hand.
    const arm = geometry((m) => {
      m.add(new IcosahedronGeometry(0.07, 1), ORANGE, at(0, 0, 0) as Matrix4, 0)
        .add(new CylinderGeometry(0.035, 0.03, 0.3, 8), JOINT, at(0, -0.17, 0) as Matrix4)
        .add(new IcosahedronGeometry(0.045, 1), CREAM, at(0, -0.34, 0) as Matrix4, 0.02);
    });
    const mesh = (g: BufferGeometry, n: number) => {
      const im = new InstancedMesh(g, this.material, n);
      im.instanceMatrix.setUsage(DynamicDrawUsage);
      im.castShadow = shadows;
      im.count = 0;
      im.frustumCulled = false;
      group.add(im);
      return im;
    };
    this.body = mesh(body, MAX);
    this.legs = mesh(leg, MAX * 2);
    this.arms = mesh(arm, MAX * 2);
  }

  /** Poses each squire that's about, in scene space relative to the floating origin (nothing allocated). */
  pose(height: (x: number, y: number) => number, origin: [number, number], t: number): void {
    let n = 0;
    for (const s of this.figures.squires) {
      if (!s.name || s.shown <= 0.01) continue;
      // Appearing and fading: it grows from (and shrinks to) nothing, a little bounce as it comes.
      const size = s.shown < 1 ? Math.sin(s.shown * Math.PI * 0.5) : 1;
      const bob = Math.abs(Math.sin(s.phase)) * 0.04 * s.walk + Math.sin(t * 2 + n) * 0.006;
      this.root.position.set(s.x - origin[0], height(s.x, s.y) + 0.46 * size + bob, -(s.y - origin[1]));
      this.root.rotation.set(0, headingToSceneYaw(s.heading), 0);
      this.root.scale.setScalar(size);
      this.root.updateMatrixWorld(true);
      this.body.setMatrixAt(n, this.root.matrixWorld);
      const swing = Math.sin(s.phase) * 0.6 * s.walk;
      for (let side = 0; side < 2; side++) {
        const sign = side === 0 ? 1 : -1;
        this.part.position.set(sign * 0.09, 0, 0);
        this.part.rotation.set(sign * swing, 0, 0);
        this.part.updateMatrix();
        this.legs.setMatrixAt(n * 2 + side, this.part.matrix.premultiply(this.root.matrixWorld));
        this.part.position.set(sign * 0.22, 0.4, 0);
        this.part.rotation.set(-sign * swing * 0.8, 0, sign * 0.12);
        this.part.updateMatrix();
        this.arms.setMatrixAt(n * 2 + side, this.part.matrix.premultiply(this.root.matrixWorld));
      }
      n++;
    }
    this.body.count = n;
    this.legs.count = n * 2;
    this.arms.count = n * 2;
    if (n) {
      this.body.instanceMatrix.needsUpdate = true;
      this.legs.instanceMatrix.needsUpdate = true;
      this.arms.instanceMatrix.needsUpdate = true;
    }
  }

  /** The instanced meshes sit at the floating origin (their instances are relative to it), as critters.ts' do. */
  place(originScene: Vector3): void {
    for (const m of [this.body, this.legs, this.arms]) m.position.copy(originScene);
  }

  /** Its name, for a hover label (and where to put it). */
  hover(x: number, y: number, out: [number, number, number]): string | null {
    const s = this.figures.near(x, y, 0.8);
    if (!s) return null;
    out[0] = s.x;
    out[1] = s.y;
    out[2] = 1.25;
    return `${s.name}: an agent working with Galahad`;
  }

  /** How far the nearest squire that's about is from a point (−1: none), for the page's trace. */
  gap(x: number, y: number): number {
    let best = -1;
    for (const s of this.figures.squires) {
      if (!s.name || s.shown < 0.5) continue;
      const d = Math.hypot(s.x - x, s.y - y);
      if (best < 0 || d < best) best = d;
    }
    return best;
  }

  /** Where one is, by name (the selector's "Partners"), into `out`; false if it isn't about. */
  find(name: string, out: { x: number; y: number }): boolean {
    const s = this.figures.squires.find((q) => q.name === name);
    if (!s) return false;
    out.x = s.x;
    out.y = s.y;
    return true;
  }

  dispose(): void {
    for (const m of [this.body, this.legs, this.arms]) {
      m.geometry.dispose();
      m.removeFromParent();
    }
    this.material.dispose();
  }
}
