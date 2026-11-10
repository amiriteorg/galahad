import { BoxGeometry, BufferAttribute, BufferGeometry, CircleGeometry, Color, CylinderGeometry, DoubleSide, Group, IcosahedronGeometry, Mesh, MeshBasicMaterial, MeshLambertMaterial, SphereGeometry } from "three/webgpu";
import { STAR, STAR_CENTER } from "../brand.ts";
import { disposeTree } from "./keep.ts";
import { at, Mesher } from "./mesher.ts";

/*
 * Galahad as the world shows him: a knightly cyborg. Cream armour panels with
 * orange accents and dark joints, a helm with a slit visor and two amber eyes, an
 * orange crest-fin with his antenna in it, pauldrons, an orange tabard bearing
 * the app's lodestar (glowing), a backpack with a small shield, and a sword at his
 * hip that he draws when he goes out to an experiment or works at the forge.
 * Upright; a small bow of the head when he arrives somewhere. All primitives,
 * all original. Scene coordinates (y up), facing +z; about 2 m tall.
 */

const CREAM = 0xeee5d2;
const CREAM_SHADE = 0xdcd0b8;
const ORANGE = 0xe8853a;
const JOINT = 0x474b54;
const VISOR = 0x15171b;
const STEEL = 0xd9dee4;

export const HEAD_HEIGHT = 2.5;
const HIP = 0.95;

export interface KnightState {
  moving: boolean;
  running: boolean;
  /** At a station, doing something. */
  working: boolean;
  /** A model is thinking for him. */
  thinking: boolean;
  /** Sword drawn: out at an experiment, or at the forge. */
  armed: boolean;
}

/** The lodestar from the app's emblem, as a flat star `size` metres tall, facing +z. */
function starGeometry(size: number): BufferGeometry {
  const k = size / 400;
  const [cx, cy] = STAR_CENTER;
  const pts: number[] = [];
  for (let i = 0; i < STAR.length; i++) {
    const a = STAR[i]!;
    const b = STAR[(i + 1) % STAR.length]!;
    // Clockwise in the SVG (y down) is counter-clockwise here (y up): front-facing.
    pts.push(0, 0, 0, (a[0] - cx) * k, -(a[1] - cy) * k, 0, (b[0] - cx) * k, -(b[1] - cy) * k, 0);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pts), 3));
  g.computeVertexNormals();
  return g;
}

export class Knight {
  readonly root = new Group();
  private readonly body = new Group();
  private readonly upper = new Group();
  private readonly head = new Group();
  private readonly flap = new Group();
  private readonly legs: [Group, Group] = [new Group(), new Group()];
  private readonly arms: [Group, Group] = [new Group(), new Group()];
  private readonly hip = new Group();
  private readonly hand = new Group();
  private readonly sword = new Group();
  private readonly armour = new MeshLambertMaterial({ vertexColors: true });
  private readonly glow = new MeshBasicMaterial({ color: 0xffb547, side: DoubleSide });
  private readonly shadow: Mesh;
  private readonly dimGlow = new Color(0xe89a3c);
  private readonly brightGlow = new Color(0xffd27a);
  private phase = 0;
  private stride = 0;
  private work = 0;
  private think = 0;
  private draw = 0;
  private bow = 0;
  private wasMoving = false;

  constructor(shadows: boolean) {
    const mesh = (m: Mesher, parent: Group) => {
      const x = new Mesh(m.build(), this.armour);
      x.castShadow = shadows;
      parent.add(x);
      return x;
    };
    // Torso: armour, tabard, pauldrons, backpack with its shield, the scabbard.
    mesh(
      new Mesher()
        .add(new BoxGeometry(0.4, 0.16, 0.26), JOINT, at(0, 0.95, 0))
        .add(new CylinderGeometry(0.17, 0.19, 0.2, 8), JOINT, at(0, 1.1, 0))
        .add(new BoxGeometry(0.56, 0.5, 0.34), CREAM, at(0, 1.34, 0))
        .add(new BoxGeometry(0.58, 0.08, 0.36), CREAM_SHADE, at(0, 1.12, 0))
        .add(new BoxGeometry(0.4, 0.46, 0.04), ORANGE, at(0, 1.32, 0.18), 0.02)
        .add(new BoxGeometry(0.06, 0.48, 0.045), CREAM, at(0.21, 1.32, 0.18), 0)
        .add(new BoxGeometry(0.06, 0.48, 0.045), CREAM, at(-0.21, 1.32, 0.18), 0)
        .add(new IcosahedronGeometry(0.18, 0), CREAM, at(0.37, 1.56, 0, 0, [1.15, 0.75, 1.05]))
        .add(new IcosahedronGeometry(0.18, 0), CREAM, at(-0.37, 1.56, 0, 0, [1.15, 0.75, 1.05]))
        .add(new BoxGeometry(0.3, 0.05, 0.3), ORANGE, at(0.4, 1.47, 0, 0, 1, 0, -0.35), 0)
        .add(new BoxGeometry(0.3, 0.05, 0.3), ORANGE, at(-0.4, 1.47, 0, 0, 1, 0, 0.35), 0)
        .add(new BoxGeometry(0.42, 0.48, 0.2), JOINT, at(0, 1.33, -0.27))
        .add(new BoxGeometry(0.43, 0.06, 0.21), ORANGE, at(0, 1.45, -0.27), 0)
        .add(new BoxGeometry(0.4, 0.46, 0.05), CREAM, at(0, 1.28, -0.4))
        .add(new BoxGeometry(0.07, 0.4, 0.055), ORANGE, at(0, 1.28, -0.41), 0)
        .add(new BoxGeometry(0.3, 0.07, 0.055), ORANGE, at(0, 1.33, -0.41), 0)
        .add(new BoxGeometry(0.07, 0.7, 0.1), JOINT, at(-0.31, 0.72, 0.04, 0, 1, 0.12, 0.1)),
      this.upper,
    );
    const star = new Mesh(starGeometry(0.2), this.glow);
    star.position.set(0, 1.38, 0.205);
    this.upper.add(star);
    // The tabard's skirt: a flap that sways a little as he walks.
    this.flap.position.set(0, 1.08, 0.17);
    mesh(new Mesher().add(new BoxGeometry(0.34, 0.36, 0.03), ORANGE, at(0, -0.18, 0), 0.02).add(new BoxGeometry(0.34, 0.04, 0.035), CREAM, at(0, -0.35, 0), 0), this.flap);
    this.upper.add(this.flap);

    // Head: a rounded helm, a slit visor (a bar across, a bar down), amber eyes, a crest-fin with the antenna.
    this.head.position.set(0, 1.64, 0);
    mesh(
      new Mesher()
        .add(new CylinderGeometry(0.1, 0.12, 0.1, 8), JOINT, at(0, 0.03, 0))
        .add(new CylinderGeometry(0.21, 0.23, 0.32, 10), CREAM, at(0, 0.24, 0))
        .add(new SphereGeometry(0.21, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2), CREAM, at(0, 0.4, 0))
        .add(new BoxGeometry(0.36, 0.09, 0.08), VISOR, at(0, 0.26, 0.18), 0)
        .add(new BoxGeometry(0.08, 0.16, 0.08), VISOR, at(0, 0.18, 0.19), 0)
        .add(new BoxGeometry(0.05, 0.2, 0.42), ORANGE, at(0, 0.6, -0.02, 0, 1, -0.1), 0.02)
        .add(new CylinderGeometry(0.012, 0.012, 0.3, 4), JOINT, at(0, 0.72, -0.2, 0, 1, -0.3), 0),
      this.head,
    );
    for (const x of [0.075, -0.075]) {
      const eye = new Mesh(new BoxGeometry(0.06, 0.035, 0.02), this.glow);
      eye.position.set(x, 0.265, 0.225);
      this.head.add(eye);
    }
    const tip = new Mesh(new IcosahedronGeometry(0.025, 0), this.glow);
    tip.position.set(0, 0.86, -0.25);
    this.head.add(tip);
    this.upper.add(this.head);

    this.legs.forEach((leg, i) => {
      const side = i === 0 ? 1 : -1;
      mesh(
        new Mesher()
          .add(new BoxGeometry(0.2, 0.4, 0.22), CREAM, at(0, -0.22, 0))
          .add(new IcosahedronGeometry(0.1, 0), JOINT, at(0, -0.45, 0))
          .add(new BoxGeometry(0.18, 0.36, 0.2), CREAM_SHADE, at(0, -0.65, 0))
          .add(new BoxGeometry(0.14, 0.28, 0.04), ORANGE, at(0, -0.63, 0.11), 0)
          .add(new BoxGeometry(0.22, 0.13, 0.32), JOINT, at(0, -0.89, 0.04)),
        leg,
      );
      leg.position.set(0.14 * side, HIP, 0);
      this.root.add(leg);
    });
    this.arms.forEach((arm, i) => {
      const side = i === 0 ? 1 : -1;
      mesh(
        new Mesher()
          .add(new BoxGeometry(0.14, 0.32, 0.15), CREAM, at(0, -0.17, 0))
          .add(new IcosahedronGeometry(0.08, 0), JOINT, at(0, -0.36, 0))
          .add(new BoxGeometry(0.15, 0.28, 0.16), ORANGE, at(0, -0.52, 0.01))
          .add(new BoxGeometry(0.12, 0.12, 0.14), JOINT, at(0, -0.71, 0.02)),
        arm,
      );
      arm.position.set(0.39 * side, 1.52, 0);
      arm.rotation.z = 0.06 * side;
      this.upper.add(arm);
    });

    // The sword: in its scabbard at the left hip, or in his right hand.
    mesh(
      new Mesher()
        .add(new BoxGeometry(0.05, 0.72, 0.014), STEEL, at(0, 0.46, 0), 0)
        .add(new BoxGeometry(0.2, 0.035, 0.05), JOINT, at(0, 0.09, 0), 0)
        .add(new BoxGeometry(0.06, 0.036, 0.055), ORANGE, at(0, 0.09, 0), 0)
        .add(new CylinderGeometry(0.018, 0.02, 0.13, 5), JOINT, at(0, 0.015, 0), 0)
        .add(new IcosahedronGeometry(0.03, 0), ORANGE, at(0, -0.06, 0), 0),
      this.sword,
    );
    this.hip.position.set(-0.31, 1.0, 0.06);
    this.upper.add(this.hip);
    this.hand.position.set(0, -0.72, 0.04);
    this.arms[1].add(this.hand);
    this.sheathe();

    this.upper.position.y = -HIP;
    this.body.position.y = HIP;
    this.body.add(this.upper);
    this.root.add(this.body);
    this.shadow = new Mesh(new CircleGeometry(0.55, 14), new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.2, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.03;
    this.shadow.renderOrder = 2;
    this.root.add(this.shadow);
  }

  /** Hilt up at his hip, blade down into the scabbard. */
  private sheathe(): void {
    this.hip.add(this.sword);
    this.sword.position.set(0, 0, 0);
    this.sword.rotation.set(Math.PI + 0.12, 0, 0.1);
  }

  /** In his right hand, blade up and a little forward. */
  private wield(): void {
    this.hand.add(this.sword);
    this.sword.position.set(0, 0, 0);
    this.sword.rotation.set(Math.PI / 2 - 0.35, 0, 0);
  }

  setNight(night: number): void {
    this.glow.color.copy(this.dimGlow).lerp(this.brightGlow, Math.min(1, 0.4 + night));
  }

  /** Blob shadow only where there's no real one (low tiers). */
  setBlobShadow(on: boolean): void {
    this.shadow.visible = on;
  }

  /**
   * Poses him for this frame: a walk or run cycle while moving (upright, his
   * tabard swaying); at work, his arm busy; thinking, a hand raised to his visor
   * and his head tilted; a small bow when he arrives. He draws his sword when
   * armed. Without motion (reduced motion), he simply stands.
   */
  animate(dt: number, t: number, state: KnightState, motion: boolean): void {
    const [left, right] = this.arms;
    const wantSword = state.armed;
    if (!motion) {
      this.phase = this.stride = this.work = this.think = this.bow = 0;
      this.draw = wantSword ? 1 : 0;
      if (wantSword !== (this.sword.parent === this.hand)) wantSword ? this.wield() : this.sheathe();
      this.legs[0].rotation.x = this.legs[1].rotation.x = 0;
      left.rotation.set(0, 0, 0.06);
      right.rotation.set(wantSword ? -0.5 : 0, 0, -0.06);
      this.head.rotation.set(0, 0, 0);
      this.body.position.y = HIP;
      this.body.rotation.set(0, 0, 0);
      this.flap.rotation.x = 0;
      return;
    }
    if (this.wasMoving && !state.moving) this.bow = 1.4;
    this.wasMoving = state.moving;
    const k = 1 - Math.exp(-dt * 8);
    const still = !state.moving;
    this.stride += ((state.running ? 0.95 : state.moving ? 0.55 : 0) - this.stride) * k;
    this.work += ((still && state.working && !state.thinking ? 1 : 0) - this.work) * k;
    this.think += ((still && state.thinking ? 1 : 0) - this.think) * k;
    this.draw += ((wantSword ? 1 : 0) - this.draw) * (1 - Math.exp(-dt * 5));
    // He reaches across for the hilt; past halfway, the sword changes hands.
    if (this.draw > 0.5 && this.sword.parent !== this.hand) this.wield();
    if (this.draw < 0.5 && this.sword.parent === this.hand) this.sheathe();
    const reach = Math.sin(Math.min(1, this.draw) * Math.PI);
    this.phase += dt * (state.running ? 11 : 7.5);
    const swing = Math.sin(this.phase) * this.stride;
    this.legs[0].rotation.x = swing;
    this.legs[1].rotation.x = -swing;
    // Right arm (scene −x): swings; at work it strikes or sets to; thinking, it rises to the visor;
    // armed, it holds the sword ready; mid-draw, it reaches across to the left hip.
    const strike = Math.max(0, Math.sin(t * 4.2)) ** 3;
    const armed = this.draw > 0.5 ? 1 : 0;
    const swingShare = Math.max(0, 1 - this.work - this.think - armed * 0.7);
    right.rotation.x = swing * 0.7 * swingShare + this.work * (-1 - 0.6 * strike) + this.think * -2.1 + armed * (1 - this.work) * -0.55 - reach * 0.4;
    right.rotation.z = -0.06 + this.think * 0.62 + this.work * 0.12 + reach * 0.9;
    left.rotation.x = -swing * 0.7 * (1 - this.think) + this.think * -0.6;
    left.rotation.z = 0.06 - this.think * 0.5;
    if (this.bow > 0) this.bow = Math.max(0, this.bow - dt);
    const bowing = this.bow > 0 ? Math.sin((1 - this.bow / 1.4) * Math.PI) : 0;
    this.head.rotation.x = bowing * 0.38 + this.think * 0.12;
    this.head.rotation.z = this.think * 0.16;
    this.head.rotation.y = this.think * 0.1 * Math.sin(t * 0.45);
    const bob = Math.abs(Math.sin(this.phase)) * this.stride * 0.08;
    const breathe = (1 - Math.min(1, this.stride * 3)) * 0.01 * Math.sin(t * 2.2);
    this.body.position.y = HIP + bob + breathe;
    // Upright: only a run leans him forward, and a bow a touch.
    this.body.rotation.x = (state.running ? 0.12 : 0.02) * this.stride + bowing * 0.06 + this.work * 0.06 * strike;
    this.body.rotation.z = this.think * 0.04 * Math.sin(t * 0.8);
    this.flap.rotation.x = -Math.abs(swing) * 0.5;
  }

  dispose(): void {
    disposeTree(this.root, [this.glow, this.armour]);
    this.glow.dispose();
    this.armour.dispose();
  }
}
