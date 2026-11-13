import { type AvatarExpression, type AvatarProfile, resolveAvatar } from "@galahad/core/avatar";
import type { WorldPartner } from "@galahad/core/world";
import { attribute, mix, step } from "three/tsl";
import { BoxGeometry, BufferAttribute, BufferGeometry, Color, CylinderGeometry, DynamicDrawUsage, type Group, IcosahedronGeometry, InstancedBufferAttribute, InstancedMesh, type Matrix4, MeshLambertMaterial, MeshLambertNodeMaterial, Object3D, Quaternion, SphereGeometry, Vector3 } from "three/webgpu";
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
 * The old squires share three meshes. Named workers add four shared meshes once:
 * a soft helm for each of the three forms, with its face's opening and its tabard
 * set into its own surface, and rounded details (hands, feet, eyes, a crest), each
 * knight in its own colors. All are instanced and posed without frame allocations;
 * MAX figures, each a small circle among the solids (r 0 while it's away).
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
  /** Persistent workers keep their figure across renames; external arms still use their name. */
  id?: string;
  avatar?: AvatarProfile;
  /** Cosmetic rhythm follows immutable identity, never stride, slot or display name. */
  avatarPhase?: number;
  expression?: AvatarExpression;
  motion?: boolean;
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
  /** Busy with its hands where it stands (0..1): his helpers at a station (helpers.ts). */
  work?: number;
}

export interface Leader {
  x: number;
  y: number;
  heading: number;
  moving: boolean;
}

function avatarPhase(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b) >>> 0;
  return (hash / 0x100000000) * Math.PI * 2;
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
    const same = (s: Squire, p: WorldPartner) => s.id || p.id ? s.id === p.id : s.name === p.name;
    for (const s of this.squires) if (s.name && !partners.some((p) => same(s, p))) s.here = false;
    for (const p of partners) {
      const custom = p.id || p.avatar;
      const metadata = { id: p.id, avatar: custom ? resolveAvatar(p.id ?? p.name, p.avatar) : undefined, avatarPhase: custom ? avatarPhase(p.id ?? p.name) : undefined, expression: p.expression };
      const known = this.squires.find((s) => s.name && same(s, p));
      if (known) {
        Object.assign(known, metadata, { name: p.name });
        known.here = true;
        continue;
      }
      const free = this.squires.find((s) => !s.name) ?? this.squires.find((s) => !s.here);
      if (!free) continue;
      Object.assign(free, metadata, { name: p.name, x: KEEP_DOOR.x, y: KEEP_DOOR.y, vx: 0, vy: 0, heading: Math.PI / 2, shown: 0, here: true, walk: 0, phase: 0 });
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
      s.motion = motion;
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

type Form = AvatarProfile["form"];
/** Half a little knight's width, height and depth (metres): about the dog's size. */
const HALF = [0.325, 0.33, 0.25] as const;
/** The armored helm: how square it is (1 would be round). */
const SQUARE = 0.72;
/** How far each form narrows towards its top, and how far the hood's top is drawn up into its peak. */
const TAPER: Record<Form, number> = { round: 0.1, armored: 0, hooded: 0.22 };
const PEAK = 0.3;
const soft = (n: number): number => Math.sign(n) * Math.abs(n) ** SQUARE;

/** Where a direction (a point of the unit sphere) lands on a form: an egg, a soft square helm, a peaked hood. */
function onForm(form: Form, x: number, y: number, z: number, out: Vector3): Vector3 {
  if (form === "armored") return out.set(soft(x) * HALF[0], soft(y) * HALF[1], soft(z) * HALF[2]);
  const taper = 1 - TAPER[form] * y;
  return out.set(x * taper * HALF[0], (form === "hooded" && y > 0 ? y + PEAK * y * y : y) * HALF[1], z * taper * HALF[2]);
}

/** Which way the form faces there, exactly: it shades without a seam, and what is set into it shades as it does. */
function normalOn(form: Form, x: number, y: number, z: number, out: Vector3): Vector3 {
  const [a, b, c] = HALF;
  if (form === "armored") {
    const e = 2 - SQUARE;
    return out.set((Math.sign(x) * Math.abs(x) ** e) / a, (Math.sign(y) * Math.abs(y) ** e) / b, (Math.sign(z) * Math.abs(z) ** e) / c).normalize();
  }
  const k = TAPER[form];
  const rise = form === "hooded" && y > 0 ? 1 + 2 * PEAK * y : 1;
  return out.set(rise * b * c * x, (y * (1 - k * y) + (1 - y * y) * k) * a * c, rise * a * b * z).normalize();
}

/** The direction whose place on a form's front is (x, y): onForm's inverse there, held to the form's edge. */
function toFront(form: Form, x: number, y: number, out: Vector3): Vector3 {
  let ux: number;
  let uy: number;
  if (form === "armored") {
    ux = Math.sign(x) * Math.abs(x / HALF[0]) ** (1 / SQUARE);
    uy = Math.sign(y) * Math.abs(y / HALF[1]) ** (1 / SQUARE);
  } else {
    const t = y / HALF[1];
    uy = form === "hooded" && t > 0 ? (Math.sqrt(1 + 4 * PEAK * t) - 1) / (2 * PEAK) : t;
    ux = x / (HALF[0] * (1 - TAPER[form] * uy));
  }
  const r = Math.hypot(ux, uy);
  if (r > 1) {
    ux /= r;
    uy /= r;
  }
  return out.set(ux, uy, Math.sqrt(Math.max(0, 1 - ux * ux - uy * uy)));
}

/** Which of its knight's colors a vertex takes: its armor's, its face's or its tabard's (PAINTS, in that order). */
const ARMOR = 0;
const FACE = 1;
const TABARD = 2;
const PAINTS = ["armor", "face", "accent"] as const;
/** The most details one knight is drawn with (prepareKnights counts them). */
const DETAILS = 14;
const FORWARD = new Vector3(0, 0, 1);
const UP = new Vector3(0, 1, 0);
/** How much richer the palest color is in the world than on a page, and how much deeper every one (Partners.toned). */
const RICH = 1.45;
const DEEP = 0.74;
/** How high on each helm a crown's band sits (1: its very top): where the helm is as wide as the band. */
const CROWN: Record<Form, number> = { round: 0.972, armored: 0.992, hooded: 0.961 };
/** On the helm's front: how far apart and how high its eyes are, and how high its mouth. */
const EYES = [0.082, 0.135] as const;
const MOUTH = 0.05;
/** The direction of the helm's side where a hand rests (a point of the unit circle). */
const HIP = [0.838, -0.545] as const;
/** The face's opening and the tabard on a form's front: [centre y, half width, half height, how square]. */
const OPENING: Record<Form, readonly [number, number, number, number]> = { round: [0.115, 0.2, 0.145, 2.6], armored: [0.115, 0.205, 0.14, 3.4], hooded: [0.12, 0.19, 0.15, 2.3] };
const BIB = [-0.15, 0.088, 0.068, 3] as const;
/** How far what is set into the helm stands off it (it meets the helm at its rim, so nothing shows beneath). */
const INLAY = 0.004;
/** How far out a patch's own color goes: the rest, to its edge, is the rim it is set into. */
const RIM = 0.93;

/**
 * A form's one mesh: its helm, and set into its front the face's opening and the tabard, each a patch of the
 * helm's own surface. So the face is the helm's own curve (no plate standing off it), with a rim shaded a
 * little darker, and the three shade as one.
 */
function knightGeometry(form: Form): BufferGeometry {
  const position: number[] = [];
  const normal: number[] = [];
  const part: number[] = [];
  const shade: number[] = [];
  const index: number[] = [];
  const p = new Vector3();
  const n = new Vector3();
  const u = new Vector3();
  const ease = (lo: number, hi: number, x: number): number => {
    const t = Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
    return t * t * (3 - 2 * t);
  };
  const vertex = (x: number, y: number, z: number, which: number, light: number, lift: number): number => {
    onForm(form, x, y, z, p);
    normalOn(form, x, y, z, n);
    // The helm is lit a little less towards its foot and where it looks down, as the ground would leave it.
    const lit = which === ARMOR ? light * (0.84 + 0.16 * ease(-HALF[1], 0.1, p.y)) * (1 - 0.1 * ease(0.1, -0.9, n.y)) : light;
    p.addScaledVector(n, lift);
    position.push(p.x, p.y, p.z);
    normal.push(n.x, n.y, n.z);
    part.push(which);
    shade.push(lit);
    return position.length / 3 - 1;
  };

  // The helm: one point at its top, rings down to one at its foot.
  const RINGS = 18;
  const AROUND = 28;
  const top = vertex(0, 1, 0, ARMOR, 1, 0);
  for (let i = 1; i < RINGS; i++) {
    const tilt = (Math.PI * i) / RINGS;
    for (let j = 0; j < AROUND; j++) {
      const turn = (Math.PI * 2 * j) / AROUND;
      vertex(Math.sin(tilt) * Math.cos(turn), Math.cos(tilt), Math.sin(tilt) * Math.sin(turn), ARMOR, 1, 0);
    }
  }
  const foot = vertex(0, -1, 0, ARMOR, 1, 0);
  const ring = (i: number, j: number): number => top + 1 + (i - 1) * AROUND + (j % AROUND);
  for (let j = 0; j < AROUND; j++) {
    index.push(top, ring(1, j + 1), ring(1, j));
    for (let i = 1; i < RINGS - 1; i++) index.push(ring(i, j), ring(i, j + 1), ring(i + 1, j), ring(i, j + 1), ring(i + 1, j + 1), ring(i + 1, j));
    index.push(foot, ring(RINGS - 1, j), ring(RINGS - 1, j + 1));
  }

  // A patch: rings out from its middle, then a band of the armor itself that is darkest against the patch and
  // comes down to meet the helm: the edge the patch is set into (`rim`: how dark that edge is).
  const patch = (which: number, [cy, rx, ry, square]: readonly [number, number, number, number], around: number, within: readonly number[], rim: number): void => {
    const circle = (reach: number, of: number, light: number, lift: number): number[] =>
      Array.from({ length: around }, (_, j) => {
        const turn = (Math.PI * 2 * j) / around;
        const c = Math.cos(turn);
        const s = Math.sin(turn);
        const edge = reach / (Math.abs(c) ** square + Math.abs(s) ** square) ** (1 / square);
        toFront(form, rx * c * edge, cy + ry * s * edge, u);
        return vertex(u.x, u.y, u.z, of, light, lift);
      });
    toFront(form, 0, cy, u);
    const middle = vertex(u.x, u.y, u.z, which, 1, INLAY);
    const rings = [...within.map((reach) => circle(reach, which, 1 - 0.1 * ease(0.5, RIM, reach), INLAY)), circle(RIM, which, 0.9, INLAY), circle(RIM, ARMOR, rim, INLAY), circle(1, ARMOR, 1, 0)];
    for (let j = 0; j < around; j++) {
      const k = (j + 1) % around;
      index.push(middle, rings[0]![j]!, rings[0]![k]!);
      // (Between the patch's last ring and the band's first there is nothing to join: they are one circle, in two colors.)
      for (let r = 0; r + 1 < rings.length; r++) if (r !== within.length) index.push(rings[r]![j]!, rings[r + 1]![j]!, rings[r + 1]![k]!, rings[r]![j]!, rings[r + 1]![k]!, rings[r]![k]!);
    }
  };
  patch(FACE, OPENING[form], 28, [0.5, 0.8], 0.72);
  patch(TABARD, BIB, 16, [0.6], 0.84);

  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(position), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(normal), 3));
  g.setAttribute("part", new BufferAttribute(new Float32Array(part), 1));
  g.setAttribute("shade", new BufferAttribute(new Float32Array(shade), 1));
  g.setIndex(index);
  return g;
}

/** Three legacy squire meshes, plus four shared meshes for every custom little knight. */
export class Partners {
  readonly figures = new PartnerFigures();
  private readonly material = new MeshLambertMaterial({ vertexColors: true });
  private readonly body: InstancedMesh;
  private readonly legs: InstancedMesh;
  private readonly arms: InstancedMesh;
  private knightMaterial?: MeshLambertNodeMaterial;
  private detailMaterial?: MeshLambertMaterial;
  private knights?: Record<Form, InstancedMesh>;
  private details!: InstancedMesh;
  private readonly meshes: InstancedMesh[];
  private readonly color = new Color();
  private readonly armor = new Color();
  private readonly face = new Color();
  private readonly accent = new Color();
  private readonly tone = new Color();
  private readonly ivory = new Color(CREAM);
  private readonly ink = new Color(VISOR);
  private readonly root = new Object3D();
  private readonly helm = new Object3D();
  private readonly part = new Object3D();
  /** The form being posed, and where on it a detail is being set. */
  private form: Form = "round";
  private readonly towards = new Vector3();
  private readonly facing = new Vector3();
  private readonly roll = new Quaternion();

  constructor(private readonly group: Group, private readonly shadows: boolean) {
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
    const mesh = (g: BufferGeometry, n: number, name: string, material = this.material) => {
      const im = new InstancedMesh(g, material, n);
      im.name = name;
      im.instanceMatrix.setUsage(DynamicDrawUsage);
      im.castShadow = shadows;
      im.count = 0;
      im.frustumCulled = false;
      group.add(im);
      return im;
    };
    this.body = mesh(body, MAX, "squire-body");
    this.legs = mesh(leg, MAX * 2, "squire-legs");
    this.arms = mesh(arm, MAX * 2, "squire-arms");
    this.meshes = [this.body, this.legs, this.arms];
  }

  /** The same renderer also draws legacy helpers. They need no custom geometry or buffers. */
  private prepareKnights(): void {
    if (this.knights) return;
    const mesh = (geometry: BufferGeometry, material: MeshLambertMaterial | MeshLambertNodeMaterial, count: number, name: string) => {
      const m = new InstancedMesh(geometry, material, count);
      m.name = name;
      m.count = 0;
      m.castShadow = this.shadows;
      m.frustumCulled = false;
      m.position.copy(this.body.position);
      m.instanceMatrix.setUsage(DynamicDrawUsage);
      this.group.add(m);
      this.meshes.push(m);
      return m;
    };
    // One material for the three helms: `part` picks each vertex's own of its knight's three colors.
    const helms = (this.knightMaterial = new MeshLambertNodeMaterial());
    const part = attribute("part", "float");
    helms.colorNode = mix(mix(attribute("armor", "vec3"), attribute("face", "vec3"), step(0.5, part)), attribute("accent", "vec3"), step(1.5, part)).mul(attribute("shade", "float"));
    const helm = (form: Form): InstancedMesh => {
      const g = knightGeometry(form);
      for (const paint of PAINTS) {
        const colors = new InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
        colors.setUsage(DynamicDrawUsage);
        g.setAttribute(paint, colors);
      }
      return mesh(g, helms, MAX, `knight-${form}`);
    };
    this.knights = { round: helm("round"), armored: helm("armored"), hooded: helm("hooded") };
    // At most DETAILS a knight: four limbs, two eyes and their glints (or, closed, two strokes each),
    // a mouth of two strokes, and a crown's band and three points. No per-worker geometry.
    this.details = mesh(new SphereGeometry(1, 12, 7), (this.detailMaterial = new MeshLambertMaterial()), MAX * DETAILS, "knight-details");
    this.details.setColorAt(0, this.color.setHex(0xffffff));
    this.details.instanceColor!.setUsage(DynamicDrawUsage);
  }

  /** A rounded detail, in the knight's own space or its helm's. */
  private detail(color: Color, x: number, y: number, z: number, sx: number, sy: number, sz: number, turn = 0, onHelm = false): void {
    this.part.position.set(x, y, z);
    this.part.rotation.set(0, 0, turn);
    this.part.scale.set(sx, sy, sz);
    this.part.updateMatrix();
    this.details.setMatrixAt(this.details.count, this.part.matrix.premultiply(onHelm ? this.helm.matrixWorld : this.root.matrixWorld));
    this.details.setColorAt(this.details.count++, color);
  }

  /** A detail set on the face at (x, y): flat against it there, `lift` proud of it, turned in its own plane. */
  private stud(color: Color, x: number, y: number, lift: number, sx: number, sy: number, sz: number, turn = 0): void {
    const u = toFront(this.form, x, y, this.towards);
    normalOn(this.form, u.x, u.y, u.z, this.facing);
    onForm(this.form, u.x, u.y, u.z, this.part.position).addScaledVector(this.facing, INLAY + lift);
    this.part.quaternion.setFromUnitVectors(FORWARD, this.facing);
    if (turn) this.part.quaternion.multiply(this.roll.setFromAxisAngle(FORWARD, turn));
    this.part.scale.set(sx, sy, sz);
    this.part.updateMatrix();
    this.details.setMatrixAt(this.details.count, this.part.matrix.premultiply(this.helm.matrixWorld));
    this.details.setColorAt(this.details.count++, color);
  }

  /** Two strokes on the face that meet at (x, y): bent up into a smile, or down into an arch (a mouth, a closed eye). */
  private arc(x: number, y: number, wide: number, thick: number, bend: number): void {
    for (let side = -1; side <= 1; side += 2) this.stud(this.ink, x + side * wide * 0.72, y + Math.sin(bend) * wide * 0.5, -0.003, wide, thick, 0.006, side * bend);
  }

  /** A detail growing from the helm in a direction: its middle `out` off the helm there, standing the way the helm faces, leaning by `lean`. */
  private sprout(color: Color, x: number, y: number, z: number, out: number, sx: number, sy: number, sz: number, lean: number): void {
    const length = Math.hypot(x, y, z);
    normalOn(this.form, x / length, y / length, z / length, this.facing);
    onForm(this.form, x / length, y / length, z / length, this.part.position).addScaledVector(this.facing, out);
    this.part.quaternion.setFromUnitVectors(UP, this.facing);
    if (lean) this.part.quaternion.multiply(this.roll.setFromAxisAngle(FORWARD, lean));
    this.part.scale.set(sx, sy, sz);
    this.part.updateMatrix();
    this.details.setMatrixAt(this.details.count, this.part.matrix.premultiply(this.helm.matrixWorld));
    this.details.setColorAt(this.details.count++, color);
  }

  /**
   * A profile's color as the world's light shows it. The PWA draws these colors flat; under the world's sun and
   * its tone mapping a pastel washes out towards grey, so here it is deepened and its hue held. The paler the
   * color the more it is enriched: one that is vivid already is left nearly as it is.
   */
  private toned(hex: string, out: Color): Color {
    out.set(hex);
    const most = Math.max(out.r, out.g, out.b);
    const rich = 1 + RICH * (most ? Math.min(out.r, out.g, out.b) / most : 1);
    const light = 0.2126 * out.r + 0.7152 * out.g + 0.0722 * out.b;
    return out.setRGB(Math.max(0, light + (out.r - light) * rich) * DEEP, Math.max(0, light + (out.g - light) * rich) * DEEP, Math.max(0, light + (out.b - light) * rich) * DEEP);
  }

  /** One soft helm with its face and tabard set into it, tiny hands and feet; its motion describes its work. */
  private knight(s: Squire, t: number): void {
    const p = s.avatar!;
    const form = (this.form = p.form);
    const expression = s.expression ?? "idle";
    const active = s.motion !== false;
    const awake = active && expression !== "resting";
    const phase = s.avatarPhase ?? 0;
    const lively = p.temperament === "calm" ? 0.6 : p.temperament === "lively" ? 1.2 : 1;
    const breath = active ? Math.sin(t * (expression === "resting" ? 0.9 : 1.6) + phase) * 0.004 * lively : 0;
    const tilt = expression === "thinking" ? -0.075 : expression === "concerned" ? 0.035 : expression === "pleased" ? -0.025 : 0;
    const sway = awake ? Math.sin(t * 1.3 + phase) * (expression === "thinking" ? 0.022 : 0.008) * lively : 0;
    const nod = expression === "working" ? 0.05 + (awake ? Math.sin(t * 3 + phase) * 0.012 : 0) : expression === "resting" ? 0.06 : 0;
    this.helm.position.set(0, 0.45 + breath, 0);
    this.helm.rotation.set(nod, 0, tilt + sway);
    this.helm.scale.set(1 - breath * 0.6, 1 + breath, 1);
    this.helm.updateMatrix();
    this.helm.matrixWorld.multiplyMatrices(this.root.matrixWorld, this.helm.matrix);

    // Its three colors, as the PWA draws them: a light face in the armor's own hue (so even dark armor
    // keeps a readable face), and the tabard softened a little towards the armor.
    this.toned(p.color, this.armor);
    this.face.set(p.color).lerp(this.ivory, 0.5);
    this.toned(p.accent, this.accent).lerp(this.armor, 0.14);
    const helm = this.knights![form];
    helm.setMatrixAt(helm.count, this.helm.matrixWorld);
    for (const paint of PAINTS) this[paint].toArray(helm.geometry.getAttribute(paint).array, helm.count * 3);
    helm.count++;

    // Its feet a shade darker, down where less light reaches.
    const boots = this.tone.copy(this.armor).multiplyScalar(0.88);
    const swing = awake ? Math.sin(s.phase) * s.walk * 0.045 : 0;
    // Its hands rest at the helm's own side, a little below its middle.
    const hip = onForm(form, HIP[0], HIP[1], 0, this.towards);
    const reach = hip.x + 0.012;
    const rest = 0.45 + hip.y;
    for (let side = -1; side <= 1; side += 2) {
      this.detail(boots, side * 0.105, 0.045 + Math.max(0, side * swing), 0.025, 0.075, 0.045, 0.095);
      let handX = side * reach;
      let handY = rest - side * swing;
      let handZ = 0.015;
      if (expression === "working") {
        handX = side * 0.22;
        handY = 0.3 + (awake ? Math.sin(t * 6 + phase + side) * 0.018 * lively : 0);
        handZ = 0.2;
      } else if (expression === "thinking" && side === 1) {
        handX = 0.2;
        handY = 0.45;
        handZ = 0.19;
      } else if (expression === "waiting" || expression === "concerned") {
        handX = side * 0.24;
        handY = 0.25;
        handZ = 0.13;
      } else if (expression === "pleased") {
        handY = rest + 0.07 + (awake ? Math.sin(t * 2 + phase) * 0.008 : 0);
      }
      this.detail(this.armor, handX, handY, handZ, 0.055, 0.065, 0.06, side * -0.14);
    }

    let eyeHeight = p.eyes === "round" ? 0.037 : p.eyes === "visor" ? 0.022 : 0.048;
    const eyeWidth = p.eyes === "round" ? 0.033 : p.eyes === "visor" ? 0.041 : 0.029;
    let lookX = 0;
    let lookY = 0;
    if (expression === "thinking") {
      lookX = 0.012;
      lookY = 0.006;
    } else if (expression === "working") {
      eyeHeight *= 0.72;
      lookY = -0.008;
    } else if (expression === "waiting") {
      eyeHeight *= 1.12;
      lookX = awake ? Math.sin(t * 0.9 + phase) * 0.012 : 0.005;
    } else if (expression === "concerned") eyeHeight *= 0.9;
    // A smooth closing and opening, independent of walking. Pleased and sleeping eyes
    // are closed into their own shapes already; a blink never interrupts them.
    const cycle = ((t + phase * 2) % 5.9 + 5.9) % 5.9;
    const blink = awake && expression !== "pleased" && cycle < 0.28 ? Math.sin((cycle / 0.28) * Math.PI) ** 2 : 0;
    eyeHeight *= 1 - blink * 0.9;
    for (let side = -1; side <= 1; side += 2) {
      const eyeX = side * EYES[0] + lookX;
      const eyeY = EYES[1] + lookY;
      // Closed: arched with pleasure, or drooped in sleep (as the PWA draws them).
      if (expression === "pleased") this.arc(eyeX, eyeY + 0.004, eyeWidth * 0.8, 0.009, -0.55);
      else if (expression === "resting") this.arc(eyeX, eyeY - 0.012, eyeWidth * 0.8, 0.0068, 0.42);
      else {
        const angle = expression === "concerned" ? side * 0.26 : expression === "thinking" ? side * 0.06 : 0;
        const open = eyeHeight * (expression === "thinking" && side === -1 ? 0.78 : 1);
        this.stud(this.ink, eyeX, eyeY, -0.005, eyeWidth, open, 0.013, angle);
        // The highlight follows the upper lid as it closes, so it never floats outside a blink.
        this.stud(this.ivory, eyeX - 0.009, eyeY + open * 0.3, 0.007, 0.0065, Math.min(0.0065, open * 0.24), 0.004, angle);
      }
    }
    // Its mouth: a small round one while it waits, otherwise turned up into a smile or down.
    const mouthX = expression === "thinking" ? 0.008 : 0;
    if (expression === "waiting") this.stud(this.ink, mouthX, MOUTH, -0.003, 0.011, 0.013, 0.006);
    else {
      const bend = expression === "pleased" ? 0.55 : expression === "concerned" ? -0.4 : expression === "idle" || expression === "thinking" ? 0.28 : expression === "resting" ? 0.12 : 0;
      this.arc(mouthX, MOUTH, expression === "pleased" ? 0.026 : expression === "working" || expression === "resting" ? 0.015 : 0.021, 0.0075, bend);
    }

    // What it wears on its head stands on the helm where the helm is, whatever its form.
    if (p.accessory === "plume") {
      this.sprout(this.accent, 0.1, 1, -0.12, 0.075, 0.05, 0.1, 0.044, -0.2);
      this.sprout(this.accent, 0.2, 1, -0.12, 0.175, 0.036, 0.05, 0.034, -0.95);
    } else if (p.accessory === "ears") {
      for (let side = -1; side <= 1; side += 2) this.sprout(this.accent, side * 0.52, 0.85, -0.04, 0.058, 0.05, 0.085, 0.04, 0);
    } else if (p.accessory === "crown") {
      // A band about the top of the helm, and three soft points standing on it, the middle one tallest.
      const high = CROWN[form];
      const ring = Math.sqrt(1 - high * high);
      const band = onForm(form, ring, high, 0, this.towards).x;
      const deep = onForm(form, 0, high, ring, this.towards).z;
      this.detail(this.accent, 0, this.towards.y + 0.012, 0, band + 0.008, 0.034, deep + 0.008, 0, true);
      for (let side = -1; side <= 1; side++) {
        const at = onForm(form, Math.sin(side * 1.05) * ring, high, Math.cos(side * 1.05) * ring, this.towards);
        this.detail(this.accent, at.x, at.y + 0.064, at.z, 0.02, side ? 0.042 : 0.056, 0.02, 0, true);
      }
    }
  }

  /** Poses each squire that's about, in scene space relative to the floating origin (nothing allocated). */
  pose(height: (x: number, y: number) => number, origin: [number, number], t: number): void {
    for (const m of this.meshes) m.count = 0;
    let n = 0;
    for (const s of this.figures.squires) {
      if (!s.name || s.shown <= 0.01) continue;
      // Appearing and fading: it grows from (and shrinks to) nothing, a little bounce as it comes.
      const size = s.shown < 1 ? Math.sin(s.shown * Math.PI * 0.5) : 1;
      const bob = s.motion === false || s.expression === "resting" ? 0 : s.avatar ? Math.abs(Math.sin(s.phase)) * 0.025 * s.walk : Math.abs(Math.sin(s.phase)) * 0.04 * s.walk + Math.sin(t * 2 + n) * 0.006;
      this.root.position.set(s.x - origin[0], height(s.x, s.y) + (s.avatar ? 0 : 0.46) * size + bob, -(s.y - origin[1]));
      this.root.rotation.set(0, headingToSceneYaw(s.heading), 0);
      this.root.scale.setScalar(size);
      this.root.updateMatrixWorld(true);
      if (s.avatar) {
        this.prepareKnights();
        this.knight(s, t);
        continue;
      }
      this.body.setMatrixAt(n, this.root.matrixWorld);
      this.part.scale.setScalar(1);
      const swing = Math.sin(s.phase) * 0.6 * s.walk;
      for (let side = 0; side < 2; side++) {
        const sign = side === 0 ? 1 : -1;
        this.part.position.set(sign * 0.09, 0, 0);
        this.part.rotation.set(sign * swing, 0, 0);
        this.part.updateMatrix();
        this.legs.setMatrixAt(n * 2 + side, this.part.matrix.premultiply(this.root.matrixWorld));
        this.part.position.set(sign * 0.22, 0.4, 0);
        // Walking, its arms swing against its legs; at work, both are up before it, going in turn.
        const work = s.work ?? 0;
        this.part.rotation.set(-sign * swing * 0.8 - work * (1.05 + 0.4 * Math.sin(s.phase + side * Math.PI)), 0, sign * 0.12);
        this.part.updateMatrix();
        this.arms.setMatrixAt(n * 2 + side, this.part.matrix.premultiply(this.root.matrixWorld));
      }
      n++;
    }
    this.body.count = n;
    this.legs.count = n * 2;
    this.arms.count = n * 2;
    for (const m of this.meshes) if (m.count) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    if (this.knights) for (const helm of Object.values(this.knights)) if (helm.count) for (const paint of PAINTS) helm.geometry.getAttribute(paint).needsUpdate = true;
  }

  /** The instanced meshes sit at the floating origin (their instances are relative to it), as critters.ts' do. */
  place(originScene: Vector3): void {
    for (const m of this.meshes) m.position.copy(originScene);
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
    const s = this.figures.squires.find((q) => q.id === name || q.name === name);
    if (!s) return false;
    out.x = s.x;
    out.y = s.y;
    return true;
  }

  dispose(): void {
    for (const m of this.meshes) {
      m.geometry.dispose();
      m.removeFromParent();
    }
    this.material.dispose();
    this.knightMaterial?.dispose();
    this.detailMaterial?.dispose();
  }
}
