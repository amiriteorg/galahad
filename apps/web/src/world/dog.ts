import { attribute, uniform } from "three/tsl";
import { BoxGeometry, type BufferGeometry, CircleGeometry, Color, CylinderGeometry, Euler, Group, IcosahedronGeometry, type Matrix4, Mesh, MeshBasicMaterial, MeshLambertNodeMaterial, Quaternion, type SkinnedMesh, Vector3 } from "three/webgpu";
import { headingToSceneYaw } from "./coords.ts";
import { FootPlanner } from "./ik.ts";
import { at, Mesher } from "./mesher.ts";
import { angleDiff, turnTowards } from "./path.ts";
import { criticalDamping, type Ground, moveOnGround, rng, type Spring, springStep } from "./physics.ts";
import { limb, pointIn, Rig } from "./rig.ts";

/*
 * Galahad's loyal companion: a small four-legged robot in cream with orange side
 * panels, dark grey legs, a short antenna and one big round camera-lens eye. It
 * trots beside him on a spring-damper, sits when he works, and when he's been
 * still a while it wanders off to sniff at things, never far. Its legs are
 * two-bone IK chains whose feet stay planted where they land (a trot: diagonal
 * pairs together), so it never slides; sitting folds its hind legs under it. One
 * skinned mesh. Its lens glows brighter at night. Scene coordinates (y up),
 * facing +z; about 0.6 m tall.
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

type Mode = "follow" | "sit" | "wander" | "sniff";

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

export class RobotDog {
  readonly root = new Group();
  private readonly rig = new Rig();
  private readonly mesh: SkinnedMesh;
  private readonly eyeColor = uniform(new Color(0xffb547));
  private readonly material = new MeshLambertNodeMaterial({ vertexColors: true });
  private readonly shadow: Mesh;
  private readonly spring: Spring = { x: 0, y: -8, vx: 0, vy: 0 };
  private readonly scratch = { x: 0, y: 0 };
  private readonly random = rng(11);
  heading = Math.PI / 2;
  private mode: Mode = "sit";
  private stillFor = 0;
  private timer = 0;
  private goal = { x: 0, y: 0 };
  private gait = 0;
  private sitAmount = 1;
  private sniffAmount = 0;
  private bodyY = BODY_Y;
  private readonly dim = new Color(0xc9782c);
  private readonly bright = new Color(0xffd27a);
  private readonly feet = new FootPlanner(
    HIPS.map(([x, z], i) => ({ forward: z, left: x, offset: i === 0 || i === 3 ? 0 : 0.5 })),
    0.55,
    0.07,
  );
  private readonly bones = { body: 0, head: 0, tail: 0, upper: [] as number[], lower: [] as number[], foot: [] as number[] };
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
  private readonly t1 = new Vector3();
  private ground: (x: number, y: number) => number = () => 0;

  constructor(shadows: boolean) {
    const r = this.rig;
    const B = this.bones;
    B.body = r.add(0, BODY_Y, 0);
    B.head = r.add(0, BODY_Y + 0.14, 0.33);
    B.tail = r.add(0, BODY_Y + 0.08, -0.3);
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
    // The body: cream shell, orange side panels, a dark belly, a vent on its back.
    part(B.body, new BoxGeometry(0.34, 0.25, 0.56), PANEL, at(0, 0, 0));
    part(B.body, new BoxGeometry(0.36, 0.14, 0.3), STRIPE, at(0, -0.01, 0.04), 0.02);
    part(B.body, new BoxGeometry(0.3, 0.06, 0.48), JOINT, at(0, -0.14, 0), 0);
    part(B.body, new BoxGeometry(0.2, 0.03, 0.2), PANEL, at(0, 0.14, -0.08), 0);
    for (let k = 0; k < 3; k++) part(B.body, new BoxGeometry(0.16, 0.012, 0.02), JOINT, at(0, 0.157, -0.14 + k * 0.05), 0);
    for (const [x, z] of HIPS) part(B.body, new IcosahedronGeometry(0.055, 0), JOINT, at(x * 1.05, -0.06, z), 0);
    // The head: mostly one big camera lens, an orange brow, a short antenna with a glowing tip.
    part(B.head, new BoxGeometry(0.3, 0.26, 0.26), PANEL, at(0, 0, 0));
    part(B.head, new BoxGeometry(0.31, 0.06, 0.22), STRIPE, at(0, 0.1, -0.02), 0);
    part(B.head, new CylinderGeometry(0.105, 0.11, 0.06, 16).rotateX(Math.PI / 2), VISOR, at(0, -0.005, 0.14), 0);
    part(B.head, new CylinderGeometry(0.07, 0.07, 0.02, 16).rotateX(Math.PI / 2), 0xffb547, at(0, -0.005, 0.17), 0, 1);
    part(B.head, new CylinderGeometry(0.03, 0.03, 0.012, 12).rotateX(Math.PI / 2), 0x0d1b22, at(0, -0.005, 0.182), 0);
    part(B.head, new CylinderGeometry(0.008, 0.01, 0.16, 4), JOINT, at(0.09, 0.2, -0.06), 0);
    part(B.head, new IcosahedronGeometry(0.018, 0), 0xffb547, at(0.09, 0.285, -0.06), 0, 1);
    // The tail: a little stalk with an orange tip.
    part(B.tail, new CylinderGeometry(0.015, 0.02, 0.16, 5), JOINT, at(0, 0.08, 0), 0);
    part(B.tail, new BoxGeometry(0.05, 0.05, 0.05), STRIPE, at(0, 0.17, 0), 0);
    // Legs: an upper segment with a cream guard, a lower one, a rubber foot.
    for (let i = 0; i < 4; i++) {
      part(B.upper[i]!, new BoxGeometry(0.075, UPPER, 0.085), JOINT, at(0, -UPPER / 2, 0));
      part(B.upper[i]!, new BoxGeometry(0.08, UPPER * 0.6, 0.07), PANEL, at(0, -UPPER * 0.42, 0.012), 0.02);
      part(B.upper[i]!, new IcosahedronGeometry(0.036, 0), JOINT_LIGHT, at(0, -UPPER, 0), 0);
      part(B.lower[i]!, new BoxGeometry(0.055, LOWER, 0.055), JOINT, at(0, -LOWER / 2, 0), 0);
      part(B.lower[i]!, new BoxGeometry(0.058, 0.04, 0.058), STRIPE, at(0, -LOWER * 0.75, 0), 0);
      part(B.foot[i]!, new BoxGeometry(0.085, FOOT, 0.11), JOINT_LIGHT, at(0, -FOOT / 2, 0.015), 0);
    }
    this.mesh = this.rig.mesh(m.build(), this.material);
    this.material.emissiveNode = this.eyeColor.mul(attribute("glow", "float")).mul(2.2);
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

  /** Puts it beside its master at once (first sight, reduced motion). */
  place(m: Master, ground?: (x: number, y: number) => number): void {
    this.besideOf(m);
    this.spring.x = this.target.x;
    this.spring.y = this.target.y;
    this.spring.vx = this.spring.vy = 0;
    this.heading = m.heading;
    if (ground) this.ground = ground;
    this.feet.place(this.spring.x, this.spring.y, this.heading, this.ground);
  }

  private besideOf(m: Master): void {
    // On his right and a little behind.
    const rx = Math.sin(m.heading);
    const ry = -Math.cos(m.heading);
    this.target.x = m.x + rx * 1.05 - Math.cos(m.heading) * 0.55;
    this.target.y = m.y + ry * 1.05 - Math.sin(m.heading) * 0.55;
  }

  /**
   * One step of its life. Follows on a spring when he moves, sits beside him while
   * he works, wanders and sniffs when he's been still for a while; never into
   * water or walls. Returns true while it moves.
   */
  step(dt: number, t: number, m: Master, ground: Ground, motion: boolean, height: (x: number, y: number) => number): boolean {
    this.ground = height;
    if (!motion) {
      this.place(m, height);
      this.mode = "sit";
      this.sitAmount = 1;
      this.gait = 0;
      this.pose(t, 0, 0, 0);
      return false;
    }
    this.stillFor = m.moving ? 0 : this.stillFor + dt;
    this.besideOf(m);
    let tx = this.target.x;
    let ty = this.target.y;
    if (m.moving) this.mode = "follow";
    else if (this.mode === "follow" && Math.hypot(tx - this.x, ty - this.y) < 0.35) this.mode = "sit";
    else if (this.mode === "sit" && this.stillFor > (m.working ? 24 : 9)) this.pickGoal(m);
    if (this.mode === "wander" || this.mode === "sniff") {
      this.timer -= dt;
      if (this.mode === "wander" && Math.hypot(this.goal.x - this.x, this.goal.y - this.y) < 0.4) {
        this.mode = "sniff";
        this.timer = 2 + this.random() * 2.5;
      } else if (this.mode === "sniff" && this.timer <= 0) {
        if (this.random() < 0.35) this.mode = "follow";
        else this.pickGoal(m);
      }
      if (this.mode !== "follow") {
        tx = this.goal.x;
        ty = this.goal.y;
      }
    }
    const k = this.mode === "follow" ? 14 : 6;
    const maxSpeed = m.running ? 7 : this.mode === "follow" ? 3.2 : 1.4;
    const sx = this.spring.x;
    const sy = this.spring.y;
    springStep(this.spring, tx, ty, k, criticalDamping(k) * 1.1, dt, maxSpeed);
    // The kinematic controller has the last word: no paddling into lakes or walking through walls.
    const dx = this.spring.x - sx;
    const dy = this.spring.y - sy;
    const d = Math.hypot(dx, dy);
    if (d > 1e-5) {
      const taken = moveOnGround(ground, sx, sy, Math.atan2(dy, dx), d, this.scratch);
      this.spring.x = this.scratch.x;
      this.spring.y = this.scratch.y;
      if (taken === null) this.spring.vx = this.spring.vy = 0;
    }
    const vx = dt > 0 ? (this.spring.x - sx) / dt : 0;
    const vy = dt > 0 ? (this.spring.y - sy) / dt : 0;
    const speed = Math.hypot(vx, vy);
    if (speed > 0.25) this.heading = turnTowards(this.heading, Math.atan2(vy, vx), 8 * dt);
    else if (this.mode === "sit") this.heading = turnTowards(this.heading, Math.atan2(m.y - this.y, m.x - this.x), 3 * dt);
    const ease = 1 - Math.exp(-dt * 6);
    this.sitAmount += ((this.mode === "sit" && speed < 0.3 ? 1 : 0) - this.sitAmount) * ease;
    this.sniffAmount += ((this.mode === "sniff" ? 1 : 0) - this.sniffAmount) * ease;
    this.gait += (Math.min(1, speed / 2.5) - this.gait) * ease;
    // A trot: the stride grows with the pace; the feet stay where they land.
    const stride = Math.min(1.6, Math.max(0.42, speed * 0.3 + 0.22));
    this.feet.step(dt, this.x, this.y, this.heading, vx, vy, stride, height);
    this.pose(t, speed, dt, this.feet.phase);
    return speed > 0.02 || Math.abs(angleDiff(this.heading, Math.atan2(m.y - this.y, m.x - this.x))) > 0.01;
  }

  private pickGoal(m: Master): void {
    const a = this.random() * Math.PI * 2;
    const r = 2 + this.random() * 4;
    this.goal.x = m.x + Math.cos(a) * r;
    this.goal.y = m.y + Math.sin(a) * r;
    this.mode = "wander";
    this.timer = 8;
  }

  /** The body over the feet (bobbing with the trot, nose up when it sits), then each leg reaching its planted foot. */
  private pose(t: number, speed: number, dt: number, phase: number): void {
    const sit = this.sitAmount;
    const gz = this.ground(this.x, this.y);
    const ch = Math.cos(this.heading);
    const sh = Math.sin(this.heading);
    let lowest = 0;
    for (let i = 0; i < 4; i++) lowest = Math.min(lowest, this.feet.z[i]! - this.feet.lift[i]! - gz);
    const want = BODY_Y - sit * 0.1 - 0.02 * this.gait + Math.abs(Math.sin(phase * Math.PI * 2)) * 0.02 * this.gait + Math.max(-0.3, lowest);
    this.bodyY += (want - this.bodyY) * (dt > 0 ? 1 - Math.exp(-dt * 16) : 1);
    this.pBody.set(0, this.bodyY, -sit * 0.04);
    this.qBody.setFromEuler(eul.set(-sit * 0.42 + this.sniffAmount * 0.12, 0, Math.sin(phase * Math.PI * 2) * 0.03 * this.gait));
    this.rig.set(this.bones.body, this.pBody, this.qBody);
    // Head: up when it sits, down to the ground when it sniffs, looking about otherwise.
    pointIn(this.t1, this.pBody, this.qBody, 0, 0.14, 0.33);
    this.qa.setFromEuler(eul.set(sit * 0.35 + this.sniffAmount * (0.55 + 0.12 * Math.sin(t * 14)), (1 - this.gait) * 0.25 * Math.sin(t * 0.7), 0)).premultiply(this.qBody);
    this.rig.set(this.bones.head, this.t1, this.qa);
    pointIn(this.t1, this.pBody, this.qBody, 0, 0.08, -0.3);
    this.qa.setFromEuler(eul.set(-0.6, 0, Math.sin(t * (speed > 0.3 ? 14 : 7)) * (0.35 + 0.3 * sit))).premultiply(this.qBody);
    this.rig.set(this.bones.tail, this.t1, this.qa);
    this.front.set(0, 0, 1).applyQuaternion(this.qBody);
    for (let i = 0; i < 4; i++) {
      const [hx, hz] = HIPS[i]!;
      pointIn(this.pHip, this.pBody, this.qBody, hx, -0.05, hz);
      // The planted foot, in its own space (z forward, x left).
      const fx = this.feet.x[i]! - this.x;
      const fy = this.feet.y[i]! - this.y;
      this.pFoot.set(-fx * sh + fy * ch, this.feet.z[i]! - gz + FOOT, fx * ch + fy * sh);
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
    this.eyeColor.value.copy(this.dim).lerp(this.bright, Math.min(1, 0.35 + night));
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
