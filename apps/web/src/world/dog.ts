import { attribute, clamp, float, mix, step, uniform, vec3, vertexColor } from "three/tsl";
import { BoxGeometry, type BufferGeometry, CircleGeometry, Color, CylinderGeometry, Euler, Group, IcosahedronGeometry, type Matrix4, Mesh, MeshBasicMaterial, MeshLambertNodeMaterial, Quaternion, type SkinnedMesh, TorusGeometry, Vector3 } from "three/webgpu";
import { BUILDS, type Mover, type Solids } from "./collide.ts";
import { headingToSceneYaw } from "./coords.ts";
import type { indoorLight } from "./hall-materials.ts";
import { FootPlanner } from "./ik.ts";
import { at, bevelBox, Mesher } from "./mesher.ts";
import { angleDiff, turnTowards } from "./path.ts";
import { criticalDamping, type Ground, moveOnGround, rng, slideOnGround, type Spring, springStep } from "./physics.ts";
import { limb, pointIn, Rig } from "./rig.ts";

/*
 * Galahad's loyal companion: a small four-legged robot in cream with orange side
 * panels, dark grey legs, a short antenna and one big round camera-lens eye. It
 * trots beside him on a spring-damper, sits when he works, and when he's been
 * still a while it wanders off to sniff at things, never far. Its legs are
 * two-bone IK chains whose feet stay planted where they land (a trot: diagonal
 * pairs together), so it never slides; sitting folds its hind legs under it.
 * Among the solids it slides along what it meets and keeps out of Galahad's
 * way; when something stands between it and him, it follows in his footsteps. One
 * skinned mesh, its shell in bevelled plates with seams and bolts, its lens a
 * ringed camera eye. Its lens glows brighter at night. Scene coordinates (y up),
 * facing +z; about 0.6 m tall.
 *
 * Galahad looks after it (care.ts): `lead` sends it somewhere else than beside him
 * (after a ball, ahead of him on a walk, to its cushion by his bed), `mood` shows in
 * its tail, its ears and the light in its eye, and `charge` lights the four cells of
 * the battery on its back.
 *
 * It's his dog before anything else. Sitting or lying, it watches him: its head
 * turns to wherever he is. When he settles to something (his work, his journal, the
 * fire) it lies down by him, forelegs out, and stays; it gets up for a sniff about
 * far less often than it did, and comes back. Greeted, it bounces on its forelegs.
 * Asleep, its head is down on its paws and its eye is a glimmer.
 */

const PANEL = 0xf0e8d6;
const STRIPE = 0xe8853a;
const JOINT = 0x43474f;
const JOINT_LIGHT = 0x6a6f78;
const VISOR = 0x14161a;

export interface Master {
  x: number;
  y: number;
  heading: number;
  moving: boolean;
  running: boolean;
  /** Busy at a station (or thinking). */
  working: boolean;
}

type Mode = "follow" | "sit" | "wander" | "sniff" | "lead";

const BODY_Y = 0.38;
const UPPER = 0.17;
const LOWER = 0.18;
const FOOT = 0.035;
/** The legs' roots on the body: front left, front right, hind left, hind right (x left, z forward). */
const HIPS: [number, number][] = [
  [0.13, 0.2],
  [-0.13, 0.2],
  [0.13, -0.2],
  [-0.13, -0.2],
];

const eul = new Euler(0, 0, 0, "YXZ");
/** Footsteps of his it remembers. */
const TRAIL = 48;
/** How long he's still before it wanders off for a sniff: at leisure, and while he's busy (it mostly stays then). */
const WANDER_IDLE = 16;
const WANDER_BUSY = 75;
/** How long he's settled to something before it lies down by him, and how far its body comes down. */
const LIE_AFTER = 10;
const LIE_DROP = 0.2;
/** Where it keeps by him, best first: [to his right, behind him] (negative: to his left). */
const SPOTS: readonly [number, number][] = [
  [1.05, 0.55],
  [-1.05, 0.55],
  [0, 1.3],
  [1.3, -0.2],
  [-1.3, -0.2],
];

export class RobotDog {
  readonly root = new Group();
  private readonly rig = new Rig();
  private readonly mesh: SkinnedMesh;
  private readonly eyeColor = uniform(new Color(0xffb547));
  private readonly material = new MeshLambertNodeMaterial({ vertexColors: true });
  /** 0 outdoors, 1 in the workshop hall: then it's lit as the hall lights itself (lightIndoors; as knight.ts' is). */
  readonly indoors = uniform(0);

  /* ---------- care's say (care.ts) ---------- */
  /** Somewhere to go instead of beside him: a ball, its cushion, ahead on a walk. `sit` (or `lie` down) there once arrived; `run` to get there; it faces `face` (NaN: him). */
  readonly lead = { on: false, x: 0, y: 0, sit: false, lie: false, run: false, faceX: Number.NaN, faceY: Number.NaN };
  /** How it feels: its tail's wag, its ears (1 pricked, 0 drooped), the light in its eye (1 as ever, less when tired), its joy (1: bouncing to greet him), how asleep it is, a play bow (forelegs down, tail up) and how far its ears turn to something it heard (radians). */
  readonly mood = { wag: 0.5, ears: 0.6, eye: 1, joy: 0, asleep: 0, bow: 0, earTurn: 0 };
  /** Its battery, 0..1: the four cells on its back light by it. */
  readonly charge = uniform(1);
  private nightLevel = 0;

  /** The eye and lights glow amber (glow ≤ 1); the battery's cells (glow 3..6) green, amber or red, lit by the charge. */
  private emissive() {
    const g = attribute("glow", "float");
    const cell = step(2.5, g);
    const lit = step(g.sub(3).add(0.5), this.charge.mul(4));
    const tone = mix(vec3(0.95, 0.18, 0.1), vec3(0.25, 0.95, 0.4), clamp(this.charge.mul(1.6).sub(0.25), 0, 1));
    return this.eyeColor.mul(g.mul(float(1).sub(cell))).mul(2.2).add(tone.mul(lit.mul(0.85).add(0.06)).mul(cell).mul(1.4));
  }

  /** Lit, while `indoors`, as the hall lights its own interior (`irradiance`: hall.ts' light()), not by the scene's lights. Before the first frame. */
  lightIndoors(irradiance: ReturnType<typeof indoorLight>): void {
    this.material.colorNode = vertexColor().mul(float(1).sub(this.indoors));
    this.material.emissiveNode = this.emissive().add(vertexColor().mul(irradiance.mul(this.indoors).mul(1 / Math.PI)));
  }
  private readonly shadow: Mesh;
  /** Where it is (its place among the solids too: x, y and its radius). */
  private readonly spring: Spring & { r: number } = { x: 0, y: -8, vx: 0, vy: 0, r: BUILDS.dog.r };
  private mover: Mover | null = null;
  /** His footsteps: the last places he walked, every half metre (x, y pairs, a ring). */
  private readonly trail = new Float64Array(TRAIL * 2);
  private trailCount = 0;
  private trailHead = 0;
  private readonly scratch = { x: 0, y: 0 };
  private readonly random = rng(11);
  heading = Math.PI / 2;
  private mode: Mode = "sit";
  private stillFor = 0;
  private timer = 0;
  private goal = { x: 0, y: 0 };
  private gait = 0;
  private sitAmount = 1;
  private lieAmount = 0;
  private sniffAmount = 0;
  /** Its head's turn towards him (radians, eased), and where he is. */
  private gaze = 0;
  private masterX = 0;
  private masterY = 0;

  /** Lying down (by him, or on its cushion). */
  get lying(): boolean {
    return this.lieAmount > 0.5;
  }
  private bodyY = BODY_Y;
  private readonly dim = new Color(0xc9782c);
  private readonly bright = new Color(0xffd27a);
  private readonly feet = new FootPlanner(
    HIPS.map(([x, z], i) => ({ forward: z, left: x, offset: i === 0 || i === 3 ? 0 : 0.5 })),
    0.55,
    0.07,
  );
  private readonly bones = { body: 0, head: 0, tail: 0, ears: [0, 0], upper: [] as number[], lower: [] as number[], foot: [] as number[] };
  private readonly target = { x: 0, y: 0 };
  // Scratch.
  private readonly pBody = new Vector3();
  private readonly qBody = new Quaternion();
  private readonly pHip = new Vector3();
  private readonly pKnee = new Vector3();
  private readonly pFoot = new Vector3();
  private readonly pEnd = new Vector3();
  private readonly pole = new Vector3();
  private readonly front = new Vector3();
  private readonly qUpper = new Quaternion();
  private readonly qLower = new Quaternion();
  private readonly qa = new Quaternion();
  private readonly qb = new Quaternion();
  private readonly t1 = new Vector3();
  private ground: (x: number, y: number) => number = () => 0;

  constructor(shadows: boolean) {
    const r = this.rig;
    const B = this.bones;
    B.body = r.add(0, BODY_Y, 0);
    B.head = r.add(0, BODY_Y + 0.14, 0.33);
    B.tail = r.add(0, BODY_Y + 0.08, -0.3);
    B.ears = [r.add(0.1, BODY_Y + 0.27, 0.29), r.add(-0.1, BODY_Y + 0.27, 0.29)];
    for (const [x, z] of HIPS) {
      B.upper.push(r.add(x, BODY_Y - 0.05, z));
      B.lower.push(r.add(x, BODY_Y - 0.05 - UPPER, z));
      B.foot.push(r.add(x, BODY_Y - 0.05 - UPPER - LOWER, z));
    }
    const m = new Mesher();
    const part = (bone: number, g: BufferGeometry, color: number, local: Matrix4, vary = 0.04, glow = 0) => {
      const p = r.bindPosition(bone);
      m.bone(bone).glow(glow).add(g, color, at(p.x, p.y, p.z).multiply(local), vary);
    };
    // Plates have bevelled edges that catch the light.
    const bv = (w: number, h: number, d: number) => bevelBox(w, h, d, Math.min(0.018, Math.min(w, h, d) * 0.2));
    // The body: a cream shell, orange side panels, a dark belly, a vent on its back, seams and bolts.
    part(B.body, bv(0.34, 0.25, 0.56), PANEL, at(0, 0, 0));
    part(B.body, bv(0.36, 0.14, 0.3), STRIPE, at(0, -0.01, 0.04), 0.02);
    part(B.body, bv(0.3, 0.06, 0.48), JOINT, at(0, -0.14, 0), 0);
    part(B.body, bv(0.2, 0.03, 0.2), PANEL, at(0, 0.14, -0.08), 0);
    for (let k = 0; k < 3; k++) part(B.body, new BoxGeometry(0.16, 0.012, 0.02), JOINT, at(0, 0.157, -0.14 + k * 0.05), 0);
    for (const s of [1, -1]) {
      // Seams across the flank, bolts at the panel's corners, a small status light.
      for (const z of [-0.17, 0.21]) part(B.body, new BoxGeometry(0.008, 0.2, 0.01), JOINT, at(s * 0.171, 0.0, z), 0);
      for (const [y, z] of [[0.045, -0.08], [0.045, 0.16], [-0.06, -0.08], [-0.06, 0.16]] as const) part(B.body, new IcosahedronGeometry(0.008, 0), JOINT_LIGHT, at(s * 0.182, y, z), 0);
      part(B.body, new BoxGeometry(0.01, 0.02, 0.035), 0xffb547, at(s * 0.181, 0.085, 0.2), 0, 0.8);
    }
    part(B.body, new BoxGeometry(0.34, 0.008, 0.01), JOINT, at(0, 0.11, 0.28), 0);
    for (const [x, z] of HIPS) part(B.body, new IcosahedronGeometry(0.055, 1), JOINT, at(x * 1.05, -0.06, z), 0);
    // The head: mostly one big camera lens in a ringed bezel, an orange brow, ear vents, a short antenna with a glowing tip.
    part(B.head, bv(0.3, 0.26, 0.26), PANEL, at(0, 0, 0));
    part(B.head, bv(0.31, 0.06, 0.22), STRIPE, at(0, 0.1, -0.02), 0);
    part(B.head, new CylinderGeometry(0.105, 0.11, 0.06, 24).rotateX(Math.PI / 2), VISOR, at(0, -0.005, 0.14), 0);
    part(B.head, new TorusGeometry(0.108, 0.014, 6, 24), JOINT_LIGHT, at(0, -0.005, 0.171), 0);
    part(B.head, new CylinderGeometry(0.07, 0.07, 0.02, 24).rotateX(Math.PI / 2), 0xffb547, at(0, -0.005, 0.17), 0, 1);
    part(B.head, new TorusGeometry(0.052, 0.006, 4, 20), 0x2a2d33, at(0, -0.005, 0.181), 0);
    part(B.head, new CylinderGeometry(0.03, 0.03, 0.012, 16).rotateX(Math.PI / 2), 0x0d1b22, at(0, -0.005, 0.182), 0);
    part(B.head, new IcosahedronGeometry(0.009, 0), 0xfff4dc, at(0.022, 0.016, 0.19), 0, 1);
    for (const s of [1, -1]) {
      part(B.head, bv(0.03, 0.12, 0.12), JOINT, at(s * 0.158, 0.0, -0.03), 0);
      for (let k = 0; k < 3; k++) part(B.head, new BoxGeometry(0.012, 0.012, 0.09), JOINT_LIGHT, at(s * 0.175, -0.035 + k * 0.035, -0.03), 0);
    }
    part(B.head, new CylinderGeometry(0.008, 0.01, 0.16, 6), JOINT, at(0.09, 0.2, -0.06), 0);
    part(B.head, new CylinderGeometry(0.016, 0.016, 0.02, 8), STRIPE, at(0.09, 0.13, -0.06), 0);
    part(B.head, new IcosahedronGeometry(0.018, 1), 0xffb547, at(0.09, 0.285, -0.06), 0, 1);
    // Its ears: two small cream flaps over the head, an orange edge (they prick up and droop with its mood).
    for (const ear of B.ears) {
      part(ear, bv(0.05, 0.11, 0.035), PANEL, at(0, 0.05, 0), 0.02);
      part(ear, new BoxGeometry(0.052, 0.02, 0.037), STRIPE, at(0, 0.1, 0), 0);
    }
    // Its battery: four cells in a row along its back, before the vent.
    for (let k = 0; k < 4; k++) part(B.body, new BoxGeometry(0.05, 0.012, 0.035), 0x2a2d33, at(0, 0.158, 0.03 + k * 0.045), 0, 3 + k);
    // The tail: a little stalk with an orange tip.
    part(B.tail, new CylinderGeometry(0.015, 0.02, 0.16, 6), JOINT, at(0, 0.08, 0), 0);
    part(B.tail, bv(0.05, 0.05, 0.05), STRIPE, at(0, 0.17, 0), 0);
    // Legs: an upper segment with a bevelled cream guard, a knee joint, a lower one with an orange band, a rubber foot.
    for (let i = 0; i < 4; i++) {
      part(B.upper[i]!, new BoxGeometry(0.075, UPPER, 0.085), JOINT, at(0, -UPPER / 2, 0));
      part(B.upper[i]!, bv(0.08, UPPER * 0.6, 0.07), PANEL, at(0, -UPPER * 0.42, 0.012), 0.02);
      part(B.upper[i]!, new IcosahedronGeometry(0.036, 1), JOINT_LIGHT, at(0, -UPPER, 0), 0);
      part(B.lower[i]!, new CylinderGeometry(0.026, 0.022, LOWER, 8), JOINT, at(0, -LOWER / 2, 0), 0);
      part(B.lower[i]!, new CylinderGeometry(0.032, 0.032, 0.04, 8), STRIPE, at(0, -LOWER * 0.75, 0), 0);
      part(B.foot[i]!, bv(0.085, FOOT, 0.11), JOINT_LIGHT, at(0, -FOOT / 2, 0.015), 0);
    }
    this.mesh = this.rig.mesh(m.build(), this.material);
    this.material.emissiveNode = this.emissive();
    this.mesh.castShadow = shadows;
    this.root.add(this.mesh);
    this.shadow = new Mesh(new CircleGeometry(0.36, 14), new MeshBasicMaterial({ color: 0x1a1408, transparent: true, opacity: 0.22, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.035;
    this.shadow.scale.set(0.8, 1.3, 1);
    this.root.add(this.shadow);
  }

  get x(): number {
    return this.spring.x;
  }

  get y(): number {
    return this.spring.y;
  }

  /** Walks among the world's solids from now on. */
  join(solids: Solids, blocked: (x: number, y: number) => boolean): void {
    this.mover = solids.join(this.spring, BUILDS.dog);
    this.mover.ground = blocked;
  }

  /** Puts it beside its master at once (first sight, reduced motion). */
  place(m: Master, ground?: (x: number, y: number) => number): void {
    this.besideOf(m);
    this.trailCount = 0;
    this.spring.x = this.target.x;
    this.spring.y = this.target.y;
    this.spring.vx = this.spring.vy = 0;
    this.heading = m.heading;
    if (ground) this.ground = ground;
    this.feet.place(this.spring.x, this.spring.y, this.heading, this.ground);
  }

  private besideOf(m: Master): void {
    // On his right and a little behind; where that's taken (a wall, a post), on his left, or behind him.
    const fx = Math.cos(m.heading);
    const fy = Math.sin(m.heading);
    for (const [side, back] of SPOTS) {
      this.target.x = m.x + fy * side - fx * back;
      this.target.y = m.y - fx * side - fy * back;
      if (!this.mover || this.mover.fits(this.target.x, this.target.y, 0.05)) return;
    }
    this.target.x = m.x + fy * 1.05 - fx * 0.55;
    this.target.y = m.y - fx * 1.05 - fy * 0.55;
  }

  /** Remembers where he walks, every half metre. */
  private footstep(m: Master): void {
    const last = (this.trailHead + TRAIL - 1) % TRAIL;
    if (this.trailCount && Math.hypot(this.trail[last * 2]! - m.x, this.trail[last * 2 + 1]! - m.y) < 0.5) return;
    this.trail[this.trailHead * 2] = m.x;
    this.trail[this.trailHead * 2 + 1] = m.y;
    this.trailHead = (this.trailHead + 1) % TRAIL;
    this.trailCount = Math.min(TRAIL, this.trailCount + 1);
  }

  /**
   * Something solid between it and where it wants to be: the newest of his footsteps it can go to straight
   * (he walked there, so from one to the next is clear), into `target`. False when none is in sight.
   */
  private followFootsteps(tx: number, ty: number): boolean {
    const mover = this.mover!;
    const x = this.spring.x;
    const y = this.spring.y;
    if (mover.sweep(x, y, tx - x, ty - y, 0, false) >= 1) return false;
    for (let k = 1; k <= this.trailCount; k++) {
      const i = (this.trailHead + TRAIL - k) % TRAIL;
      const px = this.trail[i * 2]!;
      const py = this.trail[i * 2 + 1]!;
      if (mover.sweep(x, y, px - x, py - y, 0, false) < 1) continue;
      this.target.x = px;
      this.target.y = py;
      return true;
    }
    return false;
  }

  /**
   * One step of its life. Follows on a spring when he moves, sits beside him while
   * he works, wanders and sniffs when he's been still for a while; never into
   * water or walls. Returns true while it moves.
   */
  step(dt: number, t: number, m: Master, ground: Ground, motion: boolean, height: (x: number, y: number) => number): boolean {
    this.ground = height;
    this.masterX = m.x;
    this.masterY = m.y;
    if (!motion) {
      this.place(m, height);
      this.mode = "sit";
      this.sitAmount = 1;
      this.lieAmount = 0;
      this.gaze = 0;
      this.gait = 0;
      this.pose(t, 0, 0, 0);
      return false;
    }
    this.stillFor = m.moving ? 0 : this.stillFor + dt;
    if (this.mover) this.footstep(m);
    this.besideOf(m);
    let tx = this.target.x;
    let ty = this.target.y;
    if (this.lead.on) {
      // Care sends it: after a ball, to its dock. It sits there once arrived, if it's told to.
      tx = this.lead.x;
      ty = this.lead.y;
      this.mode = (this.lead.sit || this.lead.lie) && Math.hypot(tx - this.x, ty - this.y) < 0.3 ? "sit" : "lead";
    } else if (this.mode === "lead") this.mode = "follow";
    else if (m.moving) this.mode = "follow";
    else if (this.mode === "follow" && Math.hypot(tx - this.x, ty - this.y) < 0.35) this.mode = "sit";
    // Now and then it has a sniff about; while he's busy it mostly stays by him.
    else if (this.mode === "sit" && this.stillFor > (m.working ? WANDER_BUSY : WANDER_IDLE)) this.pickGoal(m);
    if (this.mode === "wander" || this.mode === "sniff") {
      this.timer -= dt;
      if (this.mode === "wander" && Math.hypot(this.goal.x - this.x, this.goal.y - this.y) < 0.4) {
        this.mode = "sniff";
        this.timer = 2 + this.random() * 2.5;
      } else if (this.mode === "sniff" && this.timer <= 0) {
        // Back to him, more often than not (and he's still for that much longer before it's off again).
        if (this.random() < 0.65) {
          this.mode = "follow";
          this.stillFor = 0;
        } else this.pickGoal(m);
      }
      if (this.mode !== "follow") {
        tx = this.goal.x;
        ty = this.goal.y;
      }
    }
    // Round what stands in the way: in his footsteps.
    if (this.mover && this.mode !== "sit" && !this.lead.on && this.followFootsteps(tx, ty)) {
      tx = this.target.x;
      ty = this.target.y;
    }
    const k = this.mode === "follow" || this.mode === "lead" ? 14 : 6;
    const maxSpeed = this.mode === "lead" ? (this.lead.run ? 6.2 : 2.6) : m.running ? 7 : this.mode === "follow" ? 3.2 : 1.4;
    const sx = this.spring.x;
    const sy = this.spring.y;
    springStep(this.spring, tx, ty, k, criticalDamping(k) * 1.1, dt, maxSpeed);
    // The kinematic controller has the last word: no paddling into lakes or walking through walls.
    const dx = this.spring.x - sx;
    const dy = this.spring.y - sy;
    const d = Math.hypot(dx, dy);
    if (d > 1e-5) {
      const taken = this.mover ? slideOnGround(this.mover, ground, sx, sy, Math.atan2(dy, dx), d, this.scratch) : moveOnGround(ground, sx, sy, Math.atan2(dy, dx), d, this.scratch);
      this.spring.x = this.scratch.x;
      this.spring.y = this.scratch.y;
      if (taken === null) this.spring.vx = this.spring.vy = 0;
      else if (this.mover?.touched && dt > 0) {
        // Slid along something: it goes on at the speed it actually moves (no pressing into a wall).
        this.spring.vx = (this.spring.x - sx) / dt;
        this.spring.vy = (this.spring.y - sy) / dt;
      }
    }
    const vx = dt > 0 ? (this.spring.x - sx) / dt : 0;
    const vy = dt > 0 ? (this.spring.y - sy) / dt : 0;
    const speed = Math.hypot(vx, vy);
    if (speed > 0.25) this.heading = turnTowards(this.heading, Math.atan2(vy, vx), 8 * dt);
    else if (this.mode === "sit") {
      const face = this.lead.on && !Number.isNaN(this.lead.faceX);
      this.heading = turnTowards(this.heading, Math.atan2((face ? this.lead.faceY : m.y) - this.y, (face ? this.lead.faceX : m.x) - this.x), 3 * dt);
    }
    const ease = 1 - Math.exp(-dt * 6);
    const settled = this.mode === "sit" && speed < 0.3;
    this.sitAmount += ((settled ? 1 : 0) - this.sitAmount) * ease;
    // Down by him once he's settled to something (or where care says); up again the moment he moves.
    const down = settled && (this.lead.on ? this.lead.lie : m.working && this.stillFor > LIE_AFTER);
    this.lieAmount += ((down ? 1 : 0) - this.lieAmount) * (1 - Math.exp(-dt * 3));
    // Its head turns to him while it's settled (not while it sleeps, or has its nose to the ground).
    const toHim = Math.max(-1.25, Math.min(1.25, angleDiff(this.heading, Math.atan2(m.y - this.y, m.x - this.x))));
    const watch = settled && this.mood.asleep < 0.5 ? toHim : 0;
    this.gaze += (watch - this.gaze) * (1 - Math.exp(-dt * 4));
    this.sniffAmount += ((this.mode === "sniff" ? 1 : 0) - this.sniffAmount) * ease;
    this.gait += (Math.min(1, speed / 2.5) - this.gait) * ease;
    // A trot: the stride grows with the pace; the feet stay where they land.
    const stride = Math.min(1.6, Math.max(0.42, speed * 0.3 + 0.22));
    this.feet.step(dt, this.x, this.y, this.heading, vx, vy, stride, height);
    this.pose(t, speed, dt, this.feet.phase);
    return speed > 0.02 || Math.abs(angleDiff(this.heading, Math.atan2(m.y - this.y, m.x - this.x))) > 0.01;
  }

  private pickGoal(m: Master): void {
    // Somewhere near him it can stand (not in a wall, a trunk, a rock).
    for (let tries = 0; tries < 6; tries++) {
      const a = this.random() * Math.PI * 2;
      const r = 2 + this.random() * 4;
      this.goal.x = m.x + Math.cos(a) * r;
      this.goal.y = m.y + Math.sin(a) * r;
      if (!this.mover || this.mover.fits(this.goal.x, this.goal.y, 0.1)) break;
    }
    this.mode = "wander";
    this.timer = 8;
  }

  /** The body over the feet (bobbing with the trot, nose up when it sits), then each leg reaching its planted foot. */
  private pose(t: number, speed: number, dt: number, phase: number): void {
    const lie = this.lieAmount;
    // A play bow: its chest down between its forelegs, its rump and tail up, looking up at him.
    const bow = this.mood.bow * (1 - lie);
    // Lying, it's flat on its belly (no sitting up on its haunches); bowing, it's off them.
    const sit = this.sitAmount * (1 - lie) * (1 - bow);
    const asleep = this.mood.asleep * lie;
    // Greeting him: a bounce on its forelegs.
    const bounce = this.mood.joy * (1 - lie) * Math.abs(Math.sin(t * 9.5));
    const gz = this.ground(this.x, this.y);
    const ch = Math.cos(this.heading);
    const sh = Math.sin(this.heading);
    let lowest = 0;
    for (let i = 0; i < 4; i++) lowest = Math.min(lowest, this.feet.z[i]! - this.feet.lift[i]! - gz);
    const want = BODY_Y - sit * 0.1 - lie * LIE_DROP - bow * 0.07 - 0.02 * this.gait + Math.abs(Math.sin(phase * Math.PI * 2)) * 0.02 * this.gait + bounce * 0.05 + Math.max(-0.3, lowest);
    this.bodyY += (want - this.bodyY) * (dt > 0 ? 1 - Math.exp(-dt * 16) : 1);
    // (Asleep, its sides rise and fall.)
    this.pBody.set(0, this.bodyY + asleep * 0.008 * Math.sin(t * 1.3), -sit * 0.04);
    this.qBody.setFromEuler(eul.set(-sit * 0.42 - bounce * 0.2 + this.sniffAmount * 0.12 + bow * 0.4, 0, Math.sin(phase * Math.PI * 2) * 0.03 * this.gait));
    this.rig.set(this.bones.body, this.pBody, this.qBody);
    // Head: up when it sits, down to the ground when it sniffs, on its paws asleep; watching him when it's settled, looking about otherwise.
    pointIn(this.t1, this.pBody, this.qBody, 0, 0.14 - asleep * 0.11, 0.33);
    const about = (1 - this.gait) * 0.25 * Math.sin(t * 0.7) * (1 - asleep) * (1 - Math.min(1, Math.abs(this.gaze) * 2));
    this.qa.setFromEuler(eul.set(sit * 0.35 - bow * 0.55 - lie * (1 - asleep) * 0.22 + asleep * 0.3 + this.sniffAmount * (0.55 + 0.12 * Math.sin(t * 14)), about + this.gaze * (1 - this.sniffAmount), this.mood.joy * 0.12 * Math.sin(t * 6))).premultiply(this.qBody);
    this.rig.set(this.bones.head, this.t1, this.qa);
    // Its ears, over the head: pricked when it's keen, drooped and back when it's tired.
    const ears = this.mood.ears;
    // (t1 and qa hold the head's place and turn, just set.)
    const head = this.qa;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      pointIn(this.pEnd, this.t1, head, side * 0.1, 0.13, -0.04);
      // (Each turns to what it heard; the one on that side a little more.)
      const turn = this.mood.earTurn * (1 + 0.25 * side * Math.sign(this.mood.earTurn));
      this.qb.setFromEuler(eul.set(-(1 - ears) * 0.8 + 0.08 * Math.sin(t * 3.1 + i) * ears, turn, side * (0.12 + (1 - ears) * 0.7))).premultiply(head);
      this.rig.set(this.bones.ears[i]!, this.pEnd, this.qb);
    }
    // The tail: up and wagging when it's happy, low and slow when it's tired.
    const wag = this.mood.wag;
    pointIn(this.t1, this.pBody, this.qBody, 0, 0.08, -0.3);
    this.qa.setFromEuler(eul.set(-0.25 - 0.6 * wag - 0.45 * bow, 0, Math.sin(t * (speed > 0.3 ? 14 : 5 + 10 * wag)) * (0.35 + 0.3 * sit) * (0.25 + 0.95 * wag))).premultiply(this.qBody);
    this.rig.set(this.bones.tail, this.t1, this.qa);
    // The light in its eye: the night's, dimmed when it's tired (a uniform's value: nothing is uploaded but a colour).
    this.eyeColor.value.copy(this.dim).lerp(this.bright, Math.min(1, 0.35 + this.nightLevel)).multiplyScalar(0.35 + 0.65 * this.mood.eye);
    this.front.set(0, 0, 1).applyQuaternion(this.qBody);
    for (let i = 0; i < 4; i++) {
      const [hx, hz] = HIPS[i]!;
      pointIn(this.pHip, this.pBody, this.qBody, hx, -0.05, hz);
      // The planted foot, in its own space (z forward, x left).
      const fx = this.feet.x[i]! - this.x;
      const fy = this.feet.y[i]! - this.y;
      this.pFoot.set(-fx * sh + fy * ch, this.feet.z[i]! - gz + FOOT, fx * ch + fy * sh);
      // Lying: its forelegs out before it, its hind legs tucked in beside it.
      if (lie > 0.001) this.pFoot.lerp(this.t1.set(hx * (i < 2 ? 0.75 : 1.35), FOOT, hz + (i < 2 ? 0.2 : 0.09)), lie);
      // Greeting: its forefeet come off the ground with each bounce.
      if (i < 2) this.pFoot.y += bounce * 0.07;
      // Knees bend backwards (as a robot dog's do), a touch outward.
      this.pole.copy(this.pHip).add(this.t1.set(hx * 0.6, -0.1, -0.5));
      limb(this.pHip, this.pFoot, this.pole, UPPER, LOWER, this.front, this.pKnee, this.pEnd, this.qUpper, this.qLower);
      this.rig.set(this.bones.upper[i]!, this.pHip, this.qUpper);
      this.rig.set(this.bones.lower[i]!, this.pKnee, this.qLower);
      this.qa.setFromEuler(eul.set(0, 0, 0));
      this.rig.set(this.bones.foot[i]!, this.pEnd, this.qa);
    }
  }

  /** Where it stands, for the renderer (world → scene, relative to the floating origin). */
  apply(ground: number, origin: [number, number]): void {
    // Scene axes: (x, z, −y).
    this.root.position.set(this.x - origin[0], ground, -(this.y - origin[1]));
    this.root.rotation.y = headingToSceneYaw(this.heading);
  }

  setNight(night: number): void {
    this.nightLevel = night;
    this.eyeColor.value.copy(this.dim).lerp(this.bright, Math.min(1, 0.35 + night)).multiplyScalar(0.35 + 0.65 * this.mood.eye);
  }

  /** Where its mouth is (world, z up), for the ball it carries. */
  mouth(out: [number, number, number]): [number, number, number] {
    out[0] = this.x + Math.cos(this.heading) * 0.52;
    out[1] = this.y + Math.sin(this.heading) * 0.52;
    out[2] = this.ground(this.x, this.y) + this.bodyY + 0.02;
    return out;
  }

  setBlobShadow(on: boolean): void {
    this.shadow.visible = on;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.skeleton.dispose();
    this.material.dispose();
    this.shadow.geometry.dispose();
    (this.shadow.material as MeshBasicMaterial).dispose();
  }
}
