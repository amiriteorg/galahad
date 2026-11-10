import { BoxGeometry, Color, CylinderGeometry, Group, IcosahedronGeometry, Mesh, MeshBasicMaterial, MeshLambertMaterial, CircleGeometry } from "three/webgpu";
import { headingToSceneYaw } from "./coords.ts";
import { disposeTree } from "./keep.ts";
import { at, Mesher } from "./mesher.ts";
import { angleDiff, turnTowards } from "./path.ts";
import { criticalDamping, type Ground, moveOnGround, rng, type Spring, springStep } from "./physics.ts";

/*
 * Galahad's loyal companion: a small four-legged robot in cream with orange side
 * panels, dark grey legs, a short antenna and one big round camera-lens eye. It
 * trots beside him on a spring-damper, sits when he works, and when he's been
 * still a while it wanders off to sniff at things, never far. Its lens glows
 * brighter at night. Scene coordinates (y up), facing +z; about 0.6 m tall.
 */

const PANEL = 0xeee5d2;
const STRIPE = 0xe8853a;
const JOINT = 0x474b54;
const VISOR = 0x1b1d22;

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

export class RobotDog {
  readonly root = new Group();
  private readonly body = new Group();
  private readonly head = new Group();
  private readonly tail = new Group();
  private readonly legs: Group[] = [];
  private readonly eyeMaterial = new MeshBasicMaterial({ color: 0xffb547 });
  private readonly material = new MeshLambertMaterial({ vertexColors: true });
  private readonly shadow: Mesh;
  private readonly spring: Spring = { x: 0, y: -8, vx: 0, vy: 0 };
  private readonly scratch = { x: 0, y: 0 };
  private readonly random = rng(11);
  heading = Math.PI / 2;
  private mode: Mode = "sit";
  private stillFor = 0;
  private timer = 0;
  private goal = { x: 0, y: 0 };
  private phase = 0;
  private gait = 0;
  private sitAmount = 1;
  private sniffAmount = 0;
  private readonly dim = new Color(0xc9782c);
  private readonly bright = new Color(0xffd27a);

  constructor(shadows: boolean) {
    const torso = new Mesher()
      .add(new BoxGeometry(0.34, 0.25, 0.56), PANEL, at(0, 0, 0))
      .add(new BoxGeometry(0.36, 0.14, 0.3), STRIPE, at(0, -0.01, 0.04), 0.02)
      .add(new BoxGeometry(0.3, 0.06, 0.48), JOINT, at(0, -0.14, 0), 0)
      .add(new BoxGeometry(0.2, 0.03, 0.2), PANEL, at(0, 0.14, -0.08), 0)
      .build();
    const torsoMesh = new Mesh(torso, this.material);
    torsoMesh.castShadow = shadows;
    this.body.add(torsoMesh);

    // A rounded head that is mostly one big camera lens, and a short antenna.
    const headMesh = new Mesh(
      new Mesher()
        .add(new BoxGeometry(0.3, 0.26, 0.26), PANEL, at(0, 0, 0))
        .add(new BoxGeometry(0.31, 0.06, 0.22), STRIPE, at(0, 0.1, -0.02), 0)
        .add(new CylinderGeometry(0.105, 0.11, 0.06, 14).rotateX(Math.PI / 2), VISOR, at(0, -0.005, 0.14), 0)
        .add(new CylinderGeometry(0.008, 0.01, 0.16, 4), JOINT, at(0.09, 0.2, -0.06), 0)
        .build(),
      this.material,
    );
    const eye = new Mesh(new CylinderGeometry(0.07, 0.07, 0.02, 14).rotateX(Math.PI / 2), this.eyeMaterial);
    eye.position.set(0, -0.005, 0.17);
    const pupil = new Mesh(new CylinderGeometry(0.028, 0.028, 0.012, 10).rotateX(Math.PI / 2), new MeshBasicMaterial({ color: 0x0d1b22 }));
    pupil.position.set(0, -0.005, 0.181);
    const tip = new Mesh(new IcosahedronGeometry(0.018, 0), this.eyeMaterial);
    tip.position.set(0.09, 0.285, -0.06);
    this.head.add(headMesh, eye, pupil, tip);
    this.head.position.set(0, 0.14, 0.33);
    this.body.add(this.head);

    const tailMesh = new Mesh(
      new Mesher().add(new CylinderGeometry(0.015, 0.02, 0.16, 5), JOINT, at(0, 0.08, 0), 0).add(new BoxGeometry(0.05, 0.05, 0.05), STRIPE, at(0, 0.17, 0), 0).build(),
      this.material,
    );
    this.tail.add(tailMesh);
    this.tail.position.set(0, 0.08, -0.3);
    this.tail.rotation.x = -0.6;
    this.body.add(this.tail);

    const legGeometry = () =>
      new Mesher()
        .add(new BoxGeometry(0.08, 0.16, 0.09), JOINT, at(0, -0.08, 0))
        .add(new BoxGeometry(0.06, 0.15, 0.06), JOINT, at(0, -0.22, 0.01), 0)
        .add(new BoxGeometry(0.09, 0.04, 0.12), JOINT, at(0, -0.3, 0.02), 0)
        .build();
    for (const [x, z] of [[0.13, 0.2], [-0.13, 0.2], [0.13, -0.2], [-0.13, -0.2]] as const) {
      const leg = new Group();
      leg.position.set(x, -0.04, z);
      const mesh = new Mesh(legGeometry(), this.material);
      mesh.castShadow = shadows;
      leg.add(mesh);
      this.legs.push(leg);
      this.body.add(leg);
    }
    this.body.position.y = 0.36;
    this.root.add(this.body);
    this.shadow = new Mesh(new CircleGeometry(0.36, 12), new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.03;
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
  place(m: Master): void {
    this.besideOf(m);
    const tx = this.target.x;
    const ty = this.target.y;
    this.spring.x = tx;
    this.spring.y = ty;
    this.spring.vx = this.spring.vy = 0;
    this.heading = m.heading;
  }

  private readonly target = { x: 0, y: 0 };

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
  step(dt: number, t: number, m: Master, ground: Ground, motion: boolean): boolean {
    if (!motion) {
      this.place(m);
      this.mode = "sit";
      this.sitAmount = 1;
      this.pose(0, 0);
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
    const speed = Math.hypot(this.spring.vx, this.spring.vy);
    if (speed > 0.25) this.heading = turnTowards(this.heading, Math.atan2(this.spring.vy, this.spring.vx), 8 * dt);
    else if (this.mode === "sit") this.heading = turnTowards(this.heading, Math.atan2(m.y - this.y, m.x - this.x), 3 * dt);
    const ease = 1 - Math.exp(-dt * 6);
    this.sitAmount += ((this.mode === "sit" && speed < 0.3 ? 1 : 0) - this.sitAmount) * ease;
    this.sniffAmount += ((this.mode === "sniff" ? 1 : 0) - this.sniffAmount) * ease;
    this.gait += (Math.min(1, speed / 2.5) - this.gait) * ease;
    this.phase += dt * (5 + speed * 3.2);
    this.pose(t, speed);
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

  private pose(t: number, speed: number): void {
    const trot = Math.sin(this.phase) * 0.7 * this.gait;
    const sit = this.sitAmount;
    // Diagonal pairs move together; sitting folds the hind legs.
    this.legs[0]!.rotation.x = trot * (1 - sit);
    this.legs[3]!.rotation.x = trot * (1 - sit) - sit * 1.25;
    this.legs[1]!.rotation.x = -trot * (1 - sit);
    this.legs[2]!.rotation.x = -trot * (1 - sit) - sit * 1.25;
    this.body.rotation.x = -sit * 0.42;
    this.body.position.y = 0.36 - sit * 0.1 + Math.abs(Math.sin(this.phase)) * 0.025 * this.gait;
    this.head.rotation.x = sit * 0.3 + this.sniffAmount * (0.55 + 0.12 * Math.sin(t * 14));
    this.head.rotation.y = (1 - this.gait) * 0.25 * Math.sin(t * 0.7);
    this.tail.rotation.z = Math.sin(t * (speed > 0.3 ? 14 : 7)) * (0.35 + 0.3 * sit);
  }

  /** Where it stands, for the renderer (world → scene, relative to the floating origin). */
  apply(ground: number, origin: [number, number]): void {
    // Scene axes: (x, z, −y).
    this.root.position.set(this.x - origin[0], ground, -(this.y - origin[1]));
    this.root.rotation.y = headingToSceneYaw(this.heading);
  }

  setNight(night: number): void {
    this.eyeMaterial.color.copy(this.dim).lerp(this.bright, Math.min(1, 0.35 + night));
  }

  setBlobShadow(on: boolean): void {
    this.shadow.visible = on;
  }

  dispose(): void {
    disposeTree(this.root);
  }
}
