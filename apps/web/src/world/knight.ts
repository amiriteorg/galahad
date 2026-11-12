import { attribute, clamp, float, min, mix, step, uniform, vec3, vertexColor } from "three/tsl";
import {
  type Object3D,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  Group,
  IcosahedronGeometry,
  type Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertNodeMaterial,
  Quaternion,
  SphereGeometry,
  type SkinnedMesh,
  TorusGeometry,
  Vector3,
} from "three/webgpu";
import { STAR, STAR_CENTER } from "../brand.ts";
import type { indoorLight } from "./hall-materials.ts";
import type { KnightFace } from "./expression.ts";
import { FootPlanner } from "./ik.ts";
import { at, bevelBox, between, Mesher } from "./mesher.ts";
import { aim, limb, piston, pointIn, Rig } from "./rig.ts";

/*
 * Galahad as the world shows him: a chivalrous cyborg, half knight, half
 * machine. Cream and off-white armour panels with orange accents over dark grey
 * joints and frame; a helm with a black visor, a thin glowing visor line and two
 * amber eyes, an orange crest and an antenna; pauldrons; a short orange tabard;
 * the app's four-pointed lodestar glowing on his chest over an amber core; a
 * backpack with vents; and the mechanics in plain sight: pistons at the knees
 * and elbows that slide as the joints move, actuators and cables, panel lines,
 * glowing seams, segmented fingers. His sword hangs at his left hip; he draws it
 * at the lab (where its glowing tip is his tool at the bench) and out at an
 * experiment (where he stands guard, both hands on the hilt).
 *
 * One skinned mesh (one draw call) and the sword. The pose is solved every
 * frame: the feet are planted on the ground where they land (two-bone IK from
 * the hips, the pelvis riding over them), the hands reach their targets
 * (two-bone IK from the shoulders: the arm's swing, the hilt, the bench, the
 * chin), the head looks at what he's attending to, and idle, walk, run, work,
 * think and guard blend smoothly. Scene coordinates (y up), facing +z; about
 * 2.1 m tall. Up close he's a machine you could take apart: bevelled plates,
 * seams, rivets, finely segmented joints, hoses and clipped cables. All
 * primitives, all original.
 */

const CREAM = 0xf0e8d6;
const CREAM_SHADE = 0xdcd1bb;
const ORANGE = 0xe8853a;
const JOINT = 0x43474f;
const JOINT_LIGHT = 0x6a6f78;
const VISOR = 0x111317;
const STEEL = 0xdfe4ea;
const GLOW = 0xffb547;

export const HEAD_HEIGHT = 2.45;

export interface KnightState {
  moving: boolean;
  running: boolean;
  /** At a station, doing something. */
  working: boolean;
  /** A model is thinking for him. */
  thinking: boolean;
  /** Sword drawn: out at an experiment, or at the lab. */
  armed: boolean;
  /** At the lab's bench (he works there with the sword's tip). */
  bench: boolean;
  /** Writing on the chalkboard: his right hand at the chalk (the attention point), in small strokes. */
  writing?: boolean;
  /** Looking after someone or something (care.ts): his gestures, each a weight he eases to. */
  care?: CarePose;
  /** How he is, shown in his visor and his head's tilt (expression.ts); without it his eyes are simply open, or shut asleep. */
  face?: KnightFace;
  /** A nod, now (radians of pitch on top of where he looks; expression.ts' `nod`). */
  nod?: number;
  /** Raising his right hand in greeting (0 or 1: eased). */
  wave?: number;
}

/**
 * Care's gestures: crouching (to the dog, a duck, a quadcopter's pad), reaching with his right hand to what
 * he attends to (a pat, a battery, a print), a throw (its phase 0..1; 0 when none), a tilt of the head
 * (talking with Reachy), sitting down where he stands (a chair, a log, a bench: the seat is just behind him),
 * lying back on his bed (his feet out before him, his back on its wedge), and asleep (his head back, his eyes
 * and seams dimmed to a glimmer, breathing slowly). Weights 0..1, eased in animate.
 */
export interface CarePose {
  crouch: number;
  reach: number;
  throw: number;
  tilt: number;
  sit: number;
  lie: number;
  asleep: number;
}

/** Seated: how far his hips come down and back onto the seat, and where his feet go (out before him, apart). */
const SIT = { drop: 0.5, back: 0.15, feet: 0.3 };
/** Lying back: his hips down onto the mat and back, how far back his trunk leans, and where his heels rest. */
const LIE = { drop: 0.8, back: 0.3, lean: 0.85, heels: 0.54, heelY: 0.07 };

/** His eyes on the visor (the head's frame): their middle, where they hinge shut. The glow value that marks his visor's own lights (his eyes and its line). */
const EYES = [0, 0.168, 0.2] as const;
const VISOR_LINE = [0, 0.185, 0] as const;
const VISOR_GLOW = 0.95;

/** What he's attending to, in the world (z up), or nothing. */
export interface Attention {
  x: number;
  y: number;
  z: number;
  on: boolean;
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
  return g;
}

// Joint positions in the bind pose (character space): limbs hang straight down.
const HIP_Y = 1.02;
const THIGH = 0.44;
const SHIN = 0.43;
const ANKLE = 0.1;
const UPPER = 0.3;
const FORE = 0.27;
const SHOULDER_X = 0.31;
const SHOULDER_Y = 1.6;
const CHEST_Y = HIP_Y + 0.34;

/** The scabbard's mouth (pelvis frame) and its axis out of it (up, forward, inward): rx 0.3, rz 0.14. */
const SCABBARD_MOUTH = [0.204, 0.012, 0.037] as const;
const SCABBARD_AXIS = [-0.1396, 0.9459, 0.2926] as const;

const v = () => new Vector3();
const q = () => new Quaternion();

export class Knight {
  readonly root = new Group();
  private readonly rig = new Rig();
  private readonly mesh: SkinnedMesh;
  private readonly sword = new Group();
  private readonly glowColor = uniform(new Color(GLOW));
  private readonly material = new MeshLambertNodeMaterial({ vertexColors: true });
  private readonly swordMaterial = new MeshLambertNodeMaterial({ vertexColors: true });
  private glowNode: NonNullable<MeshLambertNodeMaterial["emissiveNode"]> | null = null;
  /** 0 outdoors, 1 in the workshop hall (eased as he goes in): then he's lit as the hall lights itself (lightIndoors). */
  readonly indoors = uniform(0);
  /** His heartbeat in the lodestar on his chest: how much brighter it is now (care.ts' lodestarPulse). */
  readonly pulse = uniform(0);
  /** How awake he is: 1, or a glimmer when he's asleep (his eyes, visor and seams; never the lodestar). */
  private readonly awake = uniform(1);
  /** How bright his visor's own lights are (his eyes and its line): 1 as ever, less tired, more pleased (expression.ts). */
  private readonly visor = uniform(1);
  // His face, eased (see KnightFace).
  private eyeOpen = 1;
  private eyeBright = 1;
  private lineWidth = 1;
  private faceTilt = 0;
  private wave = 0;
  // Care's gestures, eased (see CarePose).
  private crouch = 0;
  private reach = 0;
  private tilt = 0;
  private throwW = 0;
  private sit = 0;
  private lie = 0;
  private asleep = 0;

  /** How many times a foot of his has come down (the sound of his steps counts them: soundscape.ts). */
  footfalls = 0;
  private readonly down = [1, 1];

  /** His head's bone, posed for this frame: his eyes ride on it (eyes.ts). */
  get head(): Object3D {
    return this.rig.bones[this.B.head!]!;
  }

  /** How far his eyes are shut, 0..1: asleep (eased, as his head goes back and his visor dims). */
  get eyesShut(): number {
    return this.asleep;
  }

  /** His visor as it's drawn now: how far his eyes are open (their height), how thick its line, how bright its lights (for the page's trace, and the tests). */
  visorNow(out: { open: number; line: number; bright: number }): { open: number; line: number; bright: number } {
    out.open = this.rig.bones[this.B.eyes!]!.scale.y;
    out.line = this.rig.bones[this.B.visorLine!]!.scale.y;
    out.bright = this.visor.value;
    return out;
  }

  /** Lying on his bed (his sword is off him then: on its stand, hearth.ts). */
  get lying(): boolean {
    return this.lie > 0.5;
  }

  /** How high his head is above his feet now (the bubble floats over it): lower when he sits or lies. */
  get headHeight(): number {
    return HEAD_HEIGHT - 0.5 * this.sit - 1.25 * this.lie - 0.3 * this.crouch;
  }

  /**
   * Lights him, while `indoors`, as the hall lights its own interior (`irradiance`: hall.ts' light()), not by the
   * scene's lights: by day the sun would light him under the hall's roof on the tiers with no shadows. Before the
   * first frame (it builds his materials' lighting once; `indoors` moves it after). hall.ts' insideLight() gives it.
   */
  lightIndoors(irradiance: ReturnType<typeof indoorLight>): void {
    const outside = float(1).sub(this.indoors);
    const inside = irradiance.mul(this.indoors).mul(1 / Math.PI);
    this.material.colorNode = vertexColor().mul(outside);
    this.material.emissiveNode = (this.glowNode ? (this.glowNode as unknown as ReturnType<typeof vec3>) : vec3(0)).add(vertexColor().mul(inside)) as unknown as NonNullable<MeshLambertNodeMaterial["emissiveNode"]>;
    this.swordMaterial.colorNode = vertexColor().mul(outside);
    this.swordMaterial.emissiveNode = this.swordGlow.mul(attribute("glow", "float")).mul(1.5).add(vertexColor().mul(inside));
  }
  private readonly swordGlow = uniform(new Color(GLOW));
  private readonly shadow: Mesh;
  private readonly dimGlow = new Color(0xf08a24);
  private readonly brightGlow = new Color(0xffae48);
  private readonly feet = new FootPlanner([
    { forward: 0.02, left: 0.13, offset: 0 },
    { forward: 0.02, left: -0.13, offset: 0.5 },
  ]);

  // Bones.
  private readonly B: Record<string, number> = {};
  private readonly fingers: number[][] = [[], []];
  private readonly thumbs: number[][] = [[], []];

  // Blend weights, eased.
  private walk = 0;
  private run = 0;
  private work = 0;
  private think = 0;
  private guard = 0;
  private bench = 0;
  private draw = 0;
  private write = 0;
  private bow = 0;
  private wasMoving = false;
  private pelvisY = HIP_Y;
  private vx = 0;
  private vy = 0;
  private lastX = Number.NaN;
  private lastY = Number.NaN;
  private lookYaw = 0;
  private lookPitch = 0;
  private sheathed = true;
  private swordHeat = 0;

  // Scratch.
  private readonly p = { pelvis: v(), spine: v(), chest: v(), neck: v(), head: v(), hip: [v(), v()], knee: [v(), v()], ankle: [v(), v()], shoulder: [v(), v()], elbow: [v(), v()], wrist: [v(), v()] };
  private readonly r = { pelvis: q(), spine: q(), chest: q(), head: q(), thigh: [q(), q()], shin: [q(), q()], foot: [q(), q()], upper: [q(), q()], fore: [q(), q()], hand: [q(), q()] };
  private readonly target = [v(), v()];
  private readonly grip = [v(), v()];
  private readonly curl = [0, 0];
  private readonly t1 = v();
  private readonly t2 = v();
  private readonly t3 = v();
  private readonly t4 = v();
  private readonly front = v();
  private readonly pole = v();
  private readonly qa = q();
  private readonly qb = q();
  private readonly look = v();
  private readonly swordPos = v();
  private readonly swordDir = v();
  private readonly hilt = v();
  private readonly hiltDir = v();
  private readonly armedGrip = v();
  private readonly armedDir = v();

  constructor(shadows: boolean) {
    const r = this.rig;
    const B = this.B;
    // The trunk.
    B.pelvis = r.add(0, HIP_Y, 0);
    B.spine = r.add(0, HIP_Y + 0.14, 0);
    B.chest = r.add(0, HIP_Y + 0.34, 0);
    B.neck = r.add(0, HIP_Y + 0.64, -0.01);
    B.head = r.add(0, HIP_Y + 0.74, 0);
    // His eyes and the visor's line ride on the head, each on a bone of its own: they narrow, widen and shut by its scale.
    B.eyes = r.add(EYES[0], HIP_Y + 0.74 + EYES[1], EYES[2]);
    B.visorLine = r.add(VISOR_LINE[0], HIP_Y + 0.74 + VISOR_LINE[1], VISOR_LINE[2]);
    B.flapF = r.add(0, HIP_Y - 0.02, 0.16);
    B.flapB = r.add(0, HIP_Y - 0.02, -0.15);
    for (const [i, s] of [[0, 1], [1, -1]] as const) {
      const n = i === 0 ? "L" : "R";
      B[`shoulder${n}`] = r.add(s * SHOULDER_X, SHOULDER_Y, 0);
      B[`upper${n}`] = r.add(s * (SHOULDER_X + 0.04), SHOULDER_Y - 0.03, 0);
      B[`fore${n}`] = r.add(s * (SHOULDER_X + 0.04), SHOULDER_Y - 0.03 - UPPER, 0);
      B[`hand${n}`] = r.add(s * (SHOULDER_X + 0.04), SHOULDER_Y - 0.03 - UPPER - FORE, 0);
      B[`thigh${n}`] = r.add(s * 0.13, HIP_Y - 0.05, 0);
      B[`shin${n}`] = r.add(s * 0.13, HIP_Y - 0.05 - THIGH, 0);
      B[`foot${n}`] = r.add(s * 0.13, ANKLE, 0);
      B[`kneeH${n}`] = r.add(s * 0.13, HIP_Y - 0.05 - 0.08, 0.1);
      B[`kneeR${n}`] = r.add(s * 0.13, HIP_Y - 0.05 - THIGH - 0.1, 0.085);
      B[`elbowH${n}`] = r.add(s * (SHOULDER_X + 0.04), SHOULDER_Y - 0.03 - 0.05, -0.065);
      B[`elbowR${n}`] = r.add(s * (SHOULDER_X + 0.04), SHOULDER_Y - 0.03 - UPPER - 0.06, -0.055);
      const hand = r.bindPosition(B[`hand${n}`]!);
      for (let f = 0; f < 4; f++) {
        const z = 0.033 - f * 0.022;
        const a = r.add(hand.x - s * 0.004, hand.y - 0.095, z);
        const b = r.add(hand.x - s * 0.004, hand.y - 0.14, z);
        this.fingers[i]!.push(a, b);
      }
      const ta = r.add(hand.x - s * 0.012, hand.y - 0.035, 0.05);
      const tb = r.add(hand.x - s * 0.012, hand.y - 0.075, 0.056);
      this.thumbs[i]!.push(ta, tb);
    }

    const m = new Mesher();
    // Armour plates have bevelled edges that catch the light (a fifth of their thinnest side, at most a centimetre and a half).
    const bv = (w: number, h: number, d: number) => bevelBox(w, h, d, Math.min(0.015, Math.min(w, h, d) * 0.2));
    // A part bound to a bone, placed in the bone's bind frame (offsets from its joint).
    const part = (bone: number, g: BufferGeometry, color: number, local: Matrix4, vary = 0.04, glow = 0) => {
      const p = r.bindPosition(bone);
      m.bone(bone).glow(glow).add(g, color, at(p.x, p.y, p.z).multiply(local), vary);
    };
    const lit = (bone: number, g: BufferGeometry, local: Matrix4, glow = 1) => part(bone, g, 0xffe0a8, local, 0, glow);

    // ---- pelvis: the hip frame, an orange belt, side plates, the scabbard ----
    part(B.pelvis, new BoxGeometry(0.34, 0.16, 0.24), JOINT, at(0, -0.02, 0));
    part(B.pelvis, bv(0.39, 0.065, 0.28), ORANGE, at(0, 0.06, 0), 0.02);
    part(B.pelvis, new BoxGeometry(0.09, 0.06, 0.02), CREAM, at(0, 0.06, 0.145), 0);
    for (const s of [1, -1]) {
      part(B.pelvis, new IcosahedronGeometry(0.078, 1), JOINT, at(s * 0.13, -0.05, 0));
      part(B.pelvis, bv(0.13, 0.16, 0.21), CREAM, at(s * 0.2, -0.05, 0, 0, 1, 0, s * 0.16));
      part(B.pelvis, new BoxGeometry(0.135, 0.02, 0.215), ORANGE, at(s * 0.205, -0.13, 0, 0, 1, 0, s * 0.16), 0);
    }
    // The scabbard at the left hip, mouth forward, tip back.
    const mouth = SCABBARD_MOUTH;
    const axis = SCABBARD_AXIS;
    part(B.pelvis, new BoxGeometry(0.075, 0.86, 0.042), JOINT, at(mouth[0] - axis[0] * 0.43, mouth[1] - axis[1] * 0.43, mouth[2] - axis[2] * 0.43, 0, 1, 0.3, 0.14));
    part(B.pelvis, bv(0.088, 0.07, 0.054), ORANGE, at(mouth[0] - axis[0] * 0.02, mouth[1] - axis[1] * 0.02, mouth[2] - axis[2] * 0.02, 0, 1, 0.3, 0.14), 0);
    part(B.pelvis, bv(0.082, 0.06, 0.05), ORANGE, at(mouth[0] - axis[0] * 0.84, mouth[1] - axis[1] * 0.84, mouth[2] - axis[2] * 0.84, 0, 1, 0.3, 0.14), 0);
    // ---- the tabard: front and back flaps, the star in cream on the front ----
    part(B.flapF, new BoxGeometry(0.27, 0.34, 0.025), ORANGE, at(0, -0.17, 0), 0.02);
    part(B.flapF, new BoxGeometry(0.27, 0.035, 0.03), CREAM, at(0, -0.33, 0), 0);
    part(B.flapF, starGeometry(0.11), CREAM, at(0, -0.15, 0.014), 0);
    part(B.flapB, new BoxGeometry(0.29, 0.3, 0.025), ORANGE, at(0, -0.15, 0), 0.02);
    // ---- the spine: a segmented core with glowing seams, plates and cables ----
    for (let k = 0; k < 3; k++) {
      part(B.spine, new CylinderGeometry(0.125, 0.135, 0.05, 16), JOINT, at(0, k * 0.065, 0));
      part(B.spine, bv(0.16, 0.045, 0.05), CREAM_SHADE, at(0, k * 0.065, 0.11), 0.02);
    }
    for (let k = 0; k < 2; k++) part(B.spine, new CylinderGeometry(0.128, 0.128, 0.012, 16), GLOW, at(0, 0.033 + k * 0.065, 0), 0, 0.9);
    // A bundle of hoses up the back, from the hips into the pack.
    for (const x of [-0.04, 0, 0.04]) part(B.spine, new CylinderGeometry(0.011, 0.011, 1, 5), x ? JOINT_LIGHT : ORANGE, between(x, -0.03, -0.12, x * 1.3, 0.22, -0.15, 1), 0);
    for (const s of [1, -1]) part(B.spine, new CylinderGeometry(0.014, 0.014, 1, 5), JOINT_LIGHT, between(s * 0.1, -0.04, 0.06, s * 0.13, 0.2, 0.07, 1), 0);
    // ---- the chest: armour with panel lines, the star over an amber core, the collar ----
    part(B.chest, bv(0.47, 0.34, 0.28), CREAM, at(0, 0.15, 0));
    part(B.chest, bv(0.4, 0.22, 0.06), CREAM, at(0, 0.2, 0.135, 0, 1, -0.12));
    part(B.chest, bv(0.42, 0.06, 0.26), CREAM_SHADE, at(0, -0.02, 0));
    for (const s of [1, -1]) {
      part(B.chest, bv(0.04, 0.2, 0.22), ORANGE, at(s * 0.24, 0.15, 0), 0.02);
      part(B.chest, new BoxGeometry(0.012, 0.25, 0.012), JOINT, at(s * 0.115, 0.14, 0.172), 0);
      // Vents under the arms.
      for (let k = 0; k < 3; k++) part(B.chest, new BoxGeometry(0.012, 0.018, 0.12), JOINT, at(s * 0.236, 0.06 + k * 0.035, -0.02), 0);
    }
    part(B.chest, new BoxGeometry(0.34, 0.012, 0.012), JOINT, at(0, 0.045, 0.165), 0);
    // A seam down the breastplate's middle, rivets at its corners, a grille under the collar.
    part(B.chest, new BoxGeometry(0.01, 0.07, 0.01), JOINT, at(0, 0.3, 0.168), 0);
    for (const [x, y] of [[0.17, 0.3], [-0.17, 0.3], [0.17, 0.06], [-0.17, 0.06]] as const) part(B.chest, new IcosahedronGeometry(0.01, 0), JOINT_LIGHT, at(x, y, 0.17), 0);
    for (let k = 0; k < 4; k++) part(B.chest, new BoxGeometry(0.008, 0.035, 0.01), JOINT, at(-0.045 + k * 0.03, 0.335, 0.15), 0);
    part(B.chest, new CylinderGeometry(0.105, 0.11, 0.03, 20).rotateX(Math.PI / 2), JOINT, at(0, 0.21, 0.165), 0);
    part(B.chest, new CylinderGeometry(0.075, 0.075, 0.034, 20).rotateX(Math.PI / 2), 0xd8742c, at(0, 0.21, 0.168), 0, 0.28);
    part(B.chest, starGeometry(0.25), 0xfff3d6, at(0, 0.21, 0.188), 0, 2);
    part(B.chest, new CylinderGeometry(0.115, 0.15, 0.07, 16), JOINT, at(0, 0.33, 0));
    // The backpack: a frame, vents with an amber glow between the slats, exhausts and an antenna.
    part(B.chest, bv(0.37, 0.42, 0.18), CREAM_SHADE, at(0, 0.15, -0.24));
    for (const y of [-0.07, 0.37]) part(B.chest, new BoxGeometry(0.39, 0.05, 0.2), JOINT, at(0, y, -0.24));
    part(B.chest, bv(0.39, 0.06, 0.2), ORANGE, at(0, 0.29, -0.24), 0.02);
    for (let k = 0; k < 4; k++) {
      part(B.chest, new BoxGeometry(0.25, 0.022, 0.02), JOINT, at(0, 0.02 + k * 0.055, -0.337), 0);
      if (k < 3) part(B.chest, new BoxGeometry(0.23, 0.016, 0.01), GLOW, at(0, 0.047 + k * 0.055, -0.33), 0, 0.75);
    }
    for (const s of [1, -1]) {
      part(B.chest, new CylinderGeometry(0.035, 0.04, 0.09, 8), JOINT, at(s * 0.12, 0.42, -0.27));
      part(B.chest, new CylinderGeometry(0.042, 0.042, 0.02, 8), ORANGE, at(s * 0.12, 0.46, -0.27), 0);
      // Cables from the pack round to the chest.
      part(B.chest, new CylinderGeometry(0.016, 0.016, 1, 5), JOINT, between(s * 0.17, 0.3, -0.16, s * 0.23, 0.14, -0.02, 1), 0);
      part(B.chest, new CylinderGeometry(0.016, 0.016, 1, 5), JOINT, between(s * 0.23, 0.14, -0.02, s * 0.2, -0.02, 0.08, 1), 0);
    }
    part(B.chest, new CylinderGeometry(0.008, 0.008, 0.34, 4), JOINT, at(-0.15, 0.55, -0.3, 0, 1, -0.12), 0);
    part(B.chest, new IcosahedronGeometry(0.02, 0), GLOW, at(-0.15, 0.72, -0.32), 0, 1);
    // ---- the neck: a jointed column with cables ----
    part(B.neck, new CylinderGeometry(0.065, 0.075, 0.12, 12), JOINT, at(0, 0.04, 0));
    for (const y of [0, 0.065]) part(B.neck, new CylinderGeometry(0.082, 0.082, 0.016, 12), JOINT_LIGHT, at(0, y, 0), 0);
    for (const s of [1, -1]) part(B.neck, new CylinderGeometry(0.011, 0.011, 1, 4), JOINT_LIGHT, between(s * 0.045, -0.03, 0.05, s * 0.035, 0.1, 0.055, 1), 0);
    // ---- the helm: a rounded shell, cheek guards, the black visor with its glowing line and eyes, the crest ----
    part(B.head, new CylinderGeometry(0.19, 0.205, 0.26, 20), CREAM, at(0, 0.13, -0.005));
    part(B.head, new SphereGeometry(0.19, 20, 7, 0, Math.PI * 2, 0, Math.PI / 2), CREAM, at(0, 0.26, -0.005, 0, [1, 0.88, 1]));
    // A seam round the helm where the dome meets the band, and a raised brow over the visor.
    part(B.head, new CylinderGeometry(0.2075, 0.2075, 0.012, 20, 1, true), JOINT, at(0, 0.258, -0.005), 0);
    part(B.head, new CylinderGeometry(0.214, 0.212, 0.03, 20, 1, false, -1.05, 2.1), CREAM_SHADE, at(0, 0.247, 0), 0.02);
    part(B.head, new CylinderGeometry(0.207, 0.212, 0.15, 20, 1, false, -0.95, 1.9), VISOR, at(0, 0.165, 0), 0);
    part(B.visorLine, new CylinderGeometry(0.214, 0.214, 0.011, 22, 1, true, -0.85, 1.7), GLOW, at(0, 0, 0), 0, VISOR_GLOW);
    for (const s of [1, -1]) {
      part(B.eyes, new BoxGeometry(0.058, 0.034, 0.02), GLOW, at(s * 0.068, 0, 0.005, s * 0.32), 0, VISOR_GLOW);
      part(B.head, bv(0.045, 0.17, 0.14), CREAM, at(s * 0.19, 0.1, 0.07, s * 0.35), 0.03);
      part(B.head, new CylinderGeometry(0.058, 0.058, 0.05, 16).rotateZ(Math.PI / 2), JOINT, at(s * 0.205, 0.15, -0.03), 0);
      part(B.head, new CylinderGeometry(0.064, 0.064, 0.02, 16).rotateZ(Math.PI / 2), ORANGE, at(s * 0.228, 0.15, -0.03), 0);
      part(B.head, new CylinderGeometry(0.04, 0.04, 0.012, 16).rotateZ(Math.PI / 2), JOINT_LIGHT, at(s * 0.24, 0.15, -0.03), 0);
      part(B.head, new IcosahedronGeometry(0.014, 1), GLOW, at(s * 0.247, 0.15, -0.03), 0, 0.8);
      // Bolts on the cheek guard.
      for (const y of [0.05, 0.15]) part(B.head, new IcosahedronGeometry(0.008, 0), JOINT_LIGHT, at(s * 0.214, y, 0.1, s * 0.35), 0);
    }
    part(B.head, bv(0.22, 0.065, 0.1), CREAM_SHADE, at(0, 0.055, 0.14));
    for (let k = 0; k < 3; k++) part(B.head, new BoxGeometry(0.11, 0.008, 0.012), JOINT, at(0, 0.035 + k * 0.016, 0.192), 0);
    part(B.head, bv(0.04, 0.11, 0.36), ORANGE, at(0, 0.335, -0.02, 0, 1, -0.06), 0.02);
    part(B.head, bv(0.04, 0.09, 0.13), ORANGE, at(0, 0.3, -0.21, 0, 1, 0.5), 0.02);
    part(B.head, new CylinderGeometry(0.007, 0.007, 1, 4), JOINT, between(0.07, 0.3, -0.12, 0.085, 0.52, -0.17, 1), 0);
    lit(B.head, new IcosahedronGeometry(0.018, 0), at(0.085, 0.53, -0.172));

    for (const [i, s] of [[0, 1], [1, -1]] as const) {
      const n = i === 0 ? "L" : "R";
      // ---- shoulder: a socket under a layered pauldron ----
      part(B[`shoulder${n}`]!, new IcosahedronGeometry(0.085, 1), JOINT, at(0, 0, 0));
      part(B[`shoulder${n}`]!, new SphereGeometry(0.17, 18, 6, 0, Math.PI * 2, 0, Math.PI / 2), CREAM, at(s * 0.05, 0.02, 0, 0, [1.12, 0.85, 1.1], 0, s * -0.14));
      // A rolled rim and a row of rivets round the pauldron's dome.
      part(B[`shoulder${n}`]!, new TorusGeometry(0.17, 0.011, 4, 18), CREAM_SHADE, at(s * 0.05, 0.02, 0, 0, [1.12, 1.1, 1], Math.PI / 2, s * -0.14), 0);
      for (let k = 0; k < 5; k++) {
        const a = -0.9 + k * 0.45;
        part(B[`shoulder${n}`]!, new IcosahedronGeometry(0.009, 0), JOINT_LIGHT, at(s * 0.05 + Math.sin(a) * 0.14, 0.085, Math.cos(a) * 0.14 * 0.95), 0);
      }
      part(B[`shoulder${n}`]!, bv(0.24, 0.045, 0.26), ORANGE, at(s * 0.09, -0.05, 0, 0, 1, 0, s * -0.4), 0.02);
      part(B[`shoulder${n}`]!, bv(0.22, 0.04, 0.24), CREAM_SHADE, at(s * 0.12, -0.11, 0, 0, 1, 0, s * -0.58), 0.02);
      part(B[`shoulder${n}`]!, bv(0.2, 0.035, 0.22), CREAM, at(s * 0.14, -0.16, 0, 0, 1, 0, s * -0.72), 0.02);
      // ---- upper arm: frame, armour shell, elbow joint ----
      part(B[`upper${n}`]!, new CylinderGeometry(0.045, 0.04, 0.27, 12), JOINT, at(0, -0.14, 0));
      part(B[`upper${n}`]!, bv(0.13, 0.21, 0.135), CREAM, at(0, -0.12, 0.012));
      part(B[`upper${n}`]!, new BoxGeometry(0.132, 0.022, 0.137), ORANGE, at(0, -0.03, 0.012), 0);
      part(B[`upper${n}`]!, new BoxGeometry(0.134, 0.008, 0.139), JOINT, at(0, -0.17, 0.012), 0);
      part(B[`upper${n}`]!, new IcosahedronGeometry(0.056, 1), JOINT, at(0, -UPPER, 0));
      // ---- forearm: frame, an orange vambrace with a glowing seam, a cream cuff ----
      part(B[`fore${n}`]!, new CylinderGeometry(0.04, 0.034, 0.25, 12), JOINT, at(0, -0.13, 0));
      part(B[`fore${n}`]!, bv(0.125, 0.18, 0.13), ORANGE, at(0, -0.14, 0.008), 0.02);
      part(B[`fore${n}`]!, bv(0.13, 0.045, 0.135), CREAM, at(0, -0.228, 0.008), 0.02);
      part(B[`fore${n}`]!, new BoxGeometry(0.127, 0.012, 0.133), GLOW, at(0, -0.075, 0.008), 0, 0.85);
      // A cable along the vambrace's inside, clipped at both ends.
      part(B[`fore${n}`]!, new CylinderGeometry(0.009, 0.009, 0.17, 5), JOINT_LIGHT, at(-s * 0.07, -0.14, -0.03), 0);
      for (const y of [-0.06, -0.22]) part(B[`fore${n}`]!, new BoxGeometry(0.02, 0.012, 0.02), ORANGE, at(-s * 0.07, y, -0.03), 0);
      part(B[`fore${n}`]!, new IcosahedronGeometry(0.04, 1), JOINT, at(0, -FORE, 0));
      // ---- hand: a palm and a cream back plate; segmented fingers and thumb ----
      part(B[`hand${n}`]!, new BoxGeometry(0.036, 0.095, 0.088), JOINT, at(0, -0.05, 0));
      part(B[`hand${n}`]!, new BoxGeometry(0.014, 0.07, 0.075), CREAM, at(s * 0.024, -0.05, 0), 0);
      for (let f = 0; f < 4; f++) {
        part(this.fingers[i]![f * 2]!, new BoxGeometry(0.022, 0.048, 0.019), JOINT, at(0, -0.022, 0), 0.03);
        part(this.fingers[i]![f * 2]!, new BoxGeometry(0.024, 0.016, 0.021), CREAM_SHADE, at(0, -0.002, 0), 0);
        part(this.fingers[i]![f * 2 + 1]!, new BoxGeometry(0.02, 0.04, 0.017), JOINT_LIGHT, at(0, -0.02, 0), 0.03);
      }
      part(this.thumbs[i]![0]!, new BoxGeometry(0.024, 0.045, 0.022), JOINT, at(0, -0.02, 0), 0.03);
      part(this.thumbs[i]![1]!, new BoxGeometry(0.021, 0.038, 0.019), JOINT_LIGHT, at(0, -0.018, 0), 0.03);
      // ---- thigh: frame, armour, the hip actuator, the knee joint ----
      part(B[`thigh${n}`]!, new CylinderGeometry(0.06, 0.05, 0.4, 12), JOINT, at(0, -0.21, 0));
      part(B[`thigh${n}`]!, bv(0.18, 0.3, 0.19), CREAM, at(0, -0.17, 0.018));
      part(B[`thigh${n}`]!, new BoxGeometry(0.182, 0.022, 0.192), ORANGE, at(0, -0.04, 0.018), 0);
      part(B[`thigh${n}`]!, new BoxGeometry(0.012, 0.22, 0.192), JOINT, at(s * 0.06, -0.17, 0.02), 0);
      part(B[`thigh${n}`]!, new CylinderGeometry(0.034, 0.034, 0.2, 12), JOINT_LIGHT, at(s * 0.085, -0.12, -0.01), 0);
      for (const y of [-0.03, -0.21]) part(B[`thigh${n}`]!, new CylinderGeometry(0.04, 0.04, 0.015, 12), ORANGE, at(s * 0.085, y, -0.01), 0);
      part(B[`thigh${n}`]!, new BoxGeometry(0.184, 0.008, 0.194), JOINT, at(0, -0.24, 0.018), 0);
      part(B[`thigh${n}`]!, new IcosahedronGeometry(0.07, 1), JOINT, at(0, -THIGH, 0));
      // ---- shin: frame, a greave with an orange stripe, a knee cap, the calf actuator ----
      part(B[`shin${n}`]!, new CylinderGeometry(0.05, 0.04, 0.38, 12), JOINT, at(0, -0.21, 0));
      part(B[`shin${n}`]!, bv(0.16, 0.3, 0.16), CREAM, at(0, -0.21, 0.02));
      part(B[`shin${n}`]!, new BoxGeometry(0.055, 0.23, 0.012), ORANGE, at(0, -0.21, 0.104), 0);
      part(B[`shin${n}`]!, bv(0.135, 0.1, 0.07), CREAM_SHADE, at(0, -0.02, 0.09), 0.02);
      part(B[`shin${n}`]!, new CylinderGeometry(0.03, 0.03, 0.22, 10), JOINT_LIGHT, at(0, -0.19, -0.07), 0);
      part(B[`shin${n}`]!, new BoxGeometry(0.162, 0.008, 0.162), JOINT, at(0, -0.12, 0.02), 0);
      for (const z of [0.065, -0.025]) part(B[`shin${n}`]!, new IcosahedronGeometry(0.009, 0), JOINT_LIGHT, at(s * 0.081, -0.27, z), 0);
      part(B[`shin${n}`]!, new BoxGeometry(0.132, 0.01, 0.132), GLOW, at(0, -0.33, 0.02), 0, 0.7);
      part(B[`shin${n}`]!, new IcosahedronGeometry(0.046, 1), JOINT, at(0, -SHIN, 0));
      // ---- foot: a dark sole, cream toe cap and upper, an orange heel ----
      part(B[`foot${n}`]!, new BoxGeometry(0.165, 0.055, 0.32), JOINT, at(0, -0.072, 0.05));
      part(B[`foot${n}`]!, bv(0.155, 0.07, 0.12), CREAM, at(0, -0.04, 0.15));
      part(B[`foot${n}`]!, bv(0.15, 0.1, 0.17), CREAM_SHADE, at(0, -0.02, 0));
      part(B[`foot${n}`]!, bv(0.155, 0.045, 0.045), ORANGE, at(0, -0.055, -0.1), 0);
      // ---- pistons: a housing on one side of the joint, a rod sliding in it from the other ----
      for (const [h, len, r] of [[`kneeH${n}`, 0.28, 0.027], [`elbowH${n}`, 0.18, 0.022]] as const) {
        part(B[h]!, new CylinderGeometry(r, r, len, 10), JOINT_LIGHT, at(0, -len / 2, 0), 0);
        part(B[h]!, new CylinderGeometry(r * 1.2, r * 1.2, 0.03, 10), ORANGE, at(0, -0.02, 0), 0);
        part(B[h]!, new CylinderGeometry(r * 1.15, r * 1.15, 0.008, 10), JOINT, at(0, -len * 0.55, 0), 0);
        part(B[h]!, new CylinderGeometry(r * 1.1, r * 1.1, 0.012, 10), GLOW, at(0, -len + 0.01, 0), 0, 0.7);
      }
      for (const [h, len, r] of [[`kneeR${n}`, 0.3, 0.012], [`elbowR${n}`, 0.2, 0.01]] as const) {
        part(B[h]!, new CylinderGeometry(r, r, len, 8), STEEL, at(0, len / 2, 0), 0);
        part(B[h]!, new IcosahedronGeometry(r * 1.9, 1), JOINT, at(0, 0, 0), 0);
      }
    }
    this.mesh = this.rig.mesh(m.build(), this.material);
    // The glow mask: up to 1 glows amber (eyes, seams, vents); 2 glows white-hot (the star).
    const glow = attribute("glow", "float");
    // The star (glow 2) beats with his heart: brighter by `pulse`.
    const star = clamp(glow.sub(1), 0, 1);
    // His visor's own lights (glow VISOR_GLOW: his eyes and the line) brighten and dim with how he is.
    const face = step(VISOR_GLOW - 0.01, glow).mul(step(glow, VISOR_GLOW + 0.01));
    this.glowNode = mix(this.glowColor, vec3(1, 0.93, 0.8), star)
      .mul(min(glow, 1))
      .mul(1.5)
      .mul(mix(float(1), this.visor, face))
      .mul(star.mul(this.pulse).add(1))
      .mul(mix(this.awake, float(1), star)) as unknown as NonNullable<MeshLambertNodeMaterial["emissiveNode"]>;
    this.material.emissiveNode = this.glowNode;
    this.mesh.castShadow = shadows;
    this.root.add(this.mesh);

    // The sword (its own mesh): grip at the origin, blade along +y, a faint glowing fuller.
    const s = new Mesher()
      .add(new CylinderGeometry(0.018, 0.02, 0.15, 10, 4), (_x, y) => (Math.round(y * 40) % 2 ? JOINT : JOINT_LIGHT), at(0, 0, 0), 0)
      .add(new IcosahedronGeometry(0.03, 1), ORANGE, at(0, -0.095, 0), 0)
      .add(new BoxGeometry(0.23, 0.035, 0.05), JOINT, at(0, 0.088, 0), 0)
      .add(bv(0.06, 0.042, 0.056), ORANGE, at(0, 0.088, 0), 0)
      .add(new BoxGeometry(0.055, 0.8, 0.014), STEEL, at(0, 0.5, 0), 0.02)
      .add(new ConeGeometry(0.028, 0.09, 4), STEEL, at(0, 0.945, 0, Math.PI / 4, [1, 1, 0.26]), 0)
      .glow(1)
      .add(new BoxGeometry(0.012, 0.72, 0.017), GLOW, at(0, 0.48, 0), 0)
      .build();
    this.swordMaterial.emissiveNode = this.swordGlow.mul(attribute("glow", "float")).mul(1.5);
    const blade = new Mesh(s, this.swordMaterial);
    blade.castShadow = shadows;
    this.sword.add(blade);
    this.root.add(this.sword);

    this.shadow = new Mesh(new CircleGeometry(0.55, 16), new MeshBasicMaterial({ color: 0x1a1408, transparent: true, opacity: 0.24, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.035;
    this.shadow.renderOrder = 2;
    this.root.add(this.shadow);
    this.rig.rest();
  }

  setNight(night: number): void {
    this.glowColor.value.copy(this.dimGlow).lerp(this.brightGlow, Math.min(1, 0.35 + night));
  }

  /** Blob shadow only where there's no real one (low tiers). */
  setBlobShadow(on: boolean): void {
    this.shadow.visible = on;
  }

  /** First sight or a teleport: feet straight under him. */
  place(x: number, y: number, heading: number, ground: (x: number, y: number) => number): void {
    this.feet.place(x, y, heading, ground);
    this.lastX = x;
    this.lastY = y;
    this.vx = this.vy = 0;
  }

  /**
   * Poses him for this frame. He stands at (x, y) on the ground `gz`, facing
   * `heading` (world); `ground` gives the ground's height under each foot.
   * `attend` is what he looks at (and works on, at the bench). Without motion
   * (reduced motion), he simply stands, sword drawn or sheathed.
   */
  animate(dt: number, t: number, s: KnightState, x: number, y: number, gz: number, heading: number, ground: (x: number, y: number) => number, attend: Attention, motion: boolean): void {
    // His velocity, from where he's been (smoothed: the walker turns corners sharply).
    if (Number.isNaN(this.lastX) || dt <= 0) {
      this.lastX = x;
      this.lastY = y;
    }
    const k = 1 - Math.exp(-Math.max(dt, 1e-4) * 10);
    const ivx = dt > 0 ? (x - this.lastX) / dt : 0;
    const ivy = dt > 0 ? (y - this.lastY) / dt : 0;
    this.vx += (Math.min(60, Math.max(-60, ivx)) - this.vx) * k;
    this.vy += (Math.min(60, Math.max(-60, ivy)) - this.vy) * k;
    this.lastX = x;
    this.lastY = y;
    const speed = Math.hypot(this.vx, this.vy);
    const still = !s.moving;
    if (!motion) {
      this.walk = this.run = this.think = this.bow = 0;
      this.work = s.working && !s.thinking && !s.armed ? 1 : 0;
      this.think = s.thinking ? 1 : 0;
      this.guard = s.armed && !s.bench ? 1 : 0;
      this.bench = s.armed && s.bench ? 1 : 0;
      this.draw = s.armed ? 1 : 0;
      this.write = s.writing ? 1 : 0;
      this.feet.place(x, y, heading, ground);
      this.vx = this.vy = 0;
    } else {
      if (this.wasMoving && still) this.bow = 1.3;
      this.wasMoving = s.moving;
      const e = 1 - Math.exp(-dt * 6);
      const runAmount = Math.max(0, Math.min(1, (speed - 2.2) / 2.2));
      this.walk += ((s.moving ? 1 - runAmount : 0) - this.walk) * e;
      this.run += ((s.moving ? runAmount : 0) - this.run) * e;
      this.think += ((still && s.thinking ? 1 : 0) - this.think) * e;
      this.guard += ((still && s.armed && !s.bench && !s.thinking ? 1 : 0) - this.guard) * e;
      this.bench += ((still && s.armed && s.bench ? 1 : 0) - this.bench) * e;
      this.work += ((still && s.working && !s.thinking && !s.armed && !s.writing ? 1 : 0) - this.work) * e;
      this.write += ((still && s.writing ? 1 : 0) - this.write) * e;
      this.draw = Math.max(0, Math.min(1, this.draw + (s.armed && still ? 1 : -1) * dt * 1.5));
      // The feet: a walk (long stance) or a run (flight between steps), the stride with the pace.
      this.feet.duty = 0.62 - 0.24 * runAmount;
      this.feet.liftHeight = 0.13 + 0.1 * runAmount;
      const stride = Math.min(3, Math.max(1.1, speed * 0.62 + 0.25));
      this.feet.step(dt, x, y, heading, this.vx, this.vy, stride, ground);
      for (let i = 0; i < 2; i++) {
        const planted = this.feet.planted[i]!;
        if (planted && !this.down[i]) this.footfalls++;
        this.down[i] = planted;
      }
    }
    // ---- care's gestures, eased (at once under reduced motion) ----
    const care = s.care;
    const ce = motion ? 1 - Math.exp(-dt * 4) : 1;
    this.crouch += ((still && care ? care.crouch : 0) - this.crouch) * ce;
    this.reach += ((still && care ? care.reach : 0) - this.reach) * ce;
    this.tilt += ((still && care ? care.tilt : 0) - this.tilt) * ce;
    this.throwW += ((care && care.throw > 0 ? 1 : 0) - this.throwW) * (motion ? 1 - Math.exp(-dt * 10) : 1);
    // Sitting down and lying back take a moment longer; falling asleep, longer still.
    this.sit += ((still && care ? care.sit : 0) - this.sit) * (motion ? 1 - Math.exp(-dt * 3) : 1);
    this.lie += ((still && care ? care.lie : 0) - this.lie) * (motion ? 1 - Math.exp(-dt * 2.2) : 1);
    this.asleep += ((still && care ? care.asleep : 0) - this.asleep) * (motion ? 1 - Math.exp(-dt * 1.2) : 1);
    this.awake.value = 1 - 0.88 * this.asleep;
    // ---- his face (expression.ts): eased, but for the blink, which is quicker than any easing ----
    const face = s.face;
    const fe = motion ? 1 - Math.exp(-dt * 9) : 1;
    this.eyeOpen += ((face ? face.open : 1 - 0.95 * this.asleep) - this.eyeOpen) * fe;
    this.eyeBright += ((face ? face.bright : 1) - this.eyeBright) * (motion ? 1 - Math.exp(-dt * 5) : 1);
    this.lineWidth += ((face ? face.line : 1) - this.lineWidth) * fe;
    this.faceTilt += ((still && face ? face.tilt : 0) - this.faceTilt) * (motion ? 1 - Math.exp(-dt * 3) : 1);
    this.visor.value = this.eyeBright;
    this.wave += ((s.wave ?? 0) - this.wave) * (motion ? 1 - Math.exp(-dt * 6) : 1);
    const down = Math.max(this.sit, this.lie);
    if (this.bow > 0) this.bow = Math.max(0, this.bow - dt);
    const bowing = this.bow > 0 ? Math.sin((1 - this.bow / 1.3) * Math.PI) : 0;
    this.swordHeat += ((this.bench > 0.5 && this.draw > 0.9 ? 1 : 0) - this.swordHeat) * (1 - Math.exp(-dt * 2));
    this.swordGlow.value.copy(this.glowColor.value).multiplyScalar(0.55 + 1.2 * this.swordHeat);

    const P = this.p;
    const R = this.r;
    const ch = Math.cos(heading);
    const sh = Math.sin(heading);
    // World → his own space: z forward, x to his left.
    const toLocal = (out: Vector3, wx: number, wy: number, wz: number) => out.set(-(wx - x) * sh + (wy - y) * ch, wz - gz, (wx - x) * ch + (wy - y) * sh);

    // ---- the trunk ----
    const phase = this.feet.phase * Math.PI * 2;
    const gait = this.walk + this.run;
    // Feet ankles in his space, and how low the lower foot's ground is (the pelvis rides over it).
    let lowest = 0;
    for (let i = 0; i < 2; i++) {
      toLocal(P.ankle[i]!, this.feet.x[i]!, this.feet.y[i]!, this.feet.z[i]!);
      lowest = Math.min(lowest, P.ankle[i]!.y - this.feet.lift[i]!);
      P.ankle[i]!.y += ANKLE;
    }
    const bob = -Math.cos(phase * 2) * (0.022 * this.walk + 0.045 * this.run);
    const wantY = HIP_Y - 0.035 * this.walk - 0.09 * this.run - 0.05 * this.bench - 0.02 * this.guard - 0.4 * this.crouch * (1 - down) - SIT.drop * this.sit * (1 - this.lie) - LIE.drop * this.lie + bob + Math.max(-0.45, lowest);
    this.pelvisY += (wantY - this.pelvisY) * (motion ? 1 - Math.exp(-dt * 18) : 1);
    const sway = Math.sin(phase) * 0.018 * this.walk;
    P.pelvis.set(sway, this.pelvisY, 0.02 * this.run - SIT.back * this.sit * (1 - this.lie) - LIE.back * this.lie);
    const twist = Math.sin(phase) * (0.12 * this.walk + 0.18 * this.run);
    // Asleep he breathes slowly and deep.
    const breathe = Math.sin(t * (2.1 - 1.2 * this.asleep)) * (0.012 + 0.014 * this.asleep) * (1 - gait);
    // Lying back, his whole trunk leans onto the wedge; seated at his writing, he leans in to the page.
    const lean = -LIE.lean * this.lie;
    const over = 0.26 * this.write * this.sit;
    R.pelvis.setFromEuler(eul.set(0.04 * this.run + lean + 0.1 * over, twist, -sway * 1.5));
    pointIn(P.spine, P.pelvis, R.pelvis, 0, 0.14, 0);
    R.spine.setFromEuler(eul.set(0.06 * this.run + 0.08 * bowing + 0.14 * this.bench + 0.04 * this.work + 0.32 * this.crouch * (1 - this.lie) + lean * 0.94 + over, -twist * 0.5, 0));
    pointIn(P.chest, P.spine, R.spine, 0, 0.2, 0);
    R.chest.setFromEuler(eul.set(0.1 * this.run + 0.1 * bowing + 0.08 * this.bench + breathe + lean * 0.86 + over * 1.2, -twist * 1.1, this.think * 0.05 * Math.sin(t * 0.8)));
    pointIn(P.neck, P.chest, R.chest, 0, 0.3, -0.01);

    // ---- the head: looking at what he attends to, or ahead, glancing about when idle ----
    if (attend.on) toLocal(this.look, attend.x, attend.y, attend.z);
    else this.look.set(Math.sin(t * 0.37) * 1.2 * (1 - gait), 1.55 - 0.3 * this.work, 4);
    this.t1.subVectors(this.look, P.neck);
    let yaw = Math.atan2(this.t1.x, this.t1.z) - twist * 0.2;
    let pitch = -Math.atan2(this.t1.y, Math.hypot(this.t1.x, this.t1.z));
    yaw = Math.max(-1.1, Math.min(1.1, yaw));
    pitch = Math.max(-0.5, Math.min(0.75, pitch)) + bowing * 0.4 + this.think * 0.18;
    // Asleep: his head back on the wedge and a little to one side, looking at nothing.
    yaw += (0.22 - yaw) * this.asleep;
    pitch += (-0.42 * this.lie + 0.5 * (1 - this.lie) - pitch) * this.asleep;
    const le = motion ? 1 - Math.exp(-dt * 5) : 1;
    this.lookYaw += (yaw - this.lookYaw) * le;
    this.lookPitch += (pitch - this.lookPitch) * le;
    R.head.setFromEuler(eul.set(this.lookPitch + (s.nod ?? 0), this.lookYaw, this.think * 0.18 + this.tilt * 0.28 * Math.sin(t * 1.7) + 0.16 * this.asleep + this.faceTilt));
    this.qa.setFromEuler(eul.set(this.lookPitch * 0.4, this.lookYaw * 0.4, 0));
    this.rig.set(this.B.neck!, P.neck, this.qa);
    pointIn(P.head, P.neck, this.qa, 0, 0.1, 0.01);

    this.rig.set(this.B.pelvis!, P.pelvis, R.pelvis);
    this.rig.set(this.B.spine!, P.spine, R.spine);
    this.rig.set(this.B.chest!, P.chest, R.chest);
    this.rig.set(this.B.head!, P.head, R.head);
    // His eyes and the visor's line, on the head: as far open, and as thick, as he is (a blink shuts his eyes in a moment).
    pointIn(this.t1, P.head, R.head, EYES[0], EYES[1], EYES[2]);
    this.rig.set(this.B.eyes!, this.t1, R.head);
    this.rig.bones[this.B.eyes!]!.scale.y = Math.max(0.04, this.eyeOpen * (1 - 0.94 * (face ? face.blink : 0)));
    pointIn(this.t1, P.head, R.head, VISOR_LINE[0], VISOR_LINE[1], VISOR_LINE[2]);
    this.rig.set(this.B.visorLine!, this.t1, R.head);
    this.rig.bones[this.B.visorLine!]!.scale.y = this.lineWidth;
    // The tabard's flaps swing with the thighs.
    const flap = Math.sin(phase) * 0.35 * gait;
    this.qb.setFromEuler(eul.set(-Math.abs(flap) - 0.1 * this.run, 0, 0)).premultiply(R.pelvis);
    pointIn(this.t1, P.pelvis, R.pelvis, 0, -0.02, 0.16);
    this.rig.set(this.B.flapF!, this.t1, this.qb);
    this.qb.setFromEuler(eul.set(Math.abs(flap) * 0.6 + 0.15 * this.run, 0, 0)).premultiply(R.pelvis);
    pointIn(this.t1, P.pelvis, R.pelvis, 0, -0.02, -0.15);
    this.rig.set(this.B.flapB!, this.t1, this.qb);

    // ---- the legs: two-bone IK from the hips to the planted feet ----
    this.front.set(0, 0, 1).applyQuaternion(R.pelvis);
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const n = i === 0 ? "L" : "R";
      pointIn(P.hip[i]!, P.pelvis, R.pelvis, side * 0.13, -0.05, 0);
      // Seated, his feet are out before him, a little apart; lying back, his heels rest on the mat (one knee a little up).
      if (this.sit > 0.001) P.ankle[i]!.lerp(this.t1.set(side * 0.16, ANKLE, SIT.feet + side * 0.03), this.sit * (1 - this.lie));
      if (this.lie > 0.001) P.ankle[i]!.lerp(this.t1.set(side * 0.14, ANKLE + LIE.heelY, LIE.heels - (i === 0 ? 0.13 : 0)), this.lie);
      // Knees forward, a touch outward.
      this.pole.copy(P.hip[i]!).addScaledVector(this.front, 1).add(this.t2.set(side * 0.15, -0.4, 0));
      limb(P.hip[i]!, P.ankle[i]!, this.pole, THIGH, SHIN, this.front, P.knee[i]!, this.t3, R.thigh[i]!, R.shin[i]!);
      P.ankle[i]!.copy(this.t3);
      this.rig.set(this.B[`thigh${n}`]!, P.hip[i]!, R.thigh[i]!);
      this.rig.set(this.B[`shin${n}`]!, P.knee[i]!, R.shin[i]!);
      // The foot: level, along his heading; toes up as it swings forward, down as it pushes off.
      const lifted = this.feet.lift[i]! / Math.max(0.05, this.feet.liftHeight);
      const u = (this.feet.phase + (i === 0 ? 0 : 0.5)) % 1;
      const roll = this.feet.planted[i] ? 0 : (u < 0.8 ? -0.35 : 0.3) * lifted * gait;
      // (Lying back, his toes point up.)
      R.foot[i]!.setFromEuler(eul.set(roll - 1.15 * this.lie, twist * 0.3 + side * (0.06 + 0.12 * this.lie), 0));
      this.rig.set(this.B[`foot${n}`]!, P.ankle[i]!, R.foot[i]!);
      // The knee's piston: from the thigh's front to just below the knee.
      pointIn(this.t1, P.hip[i]!, R.thigh[i]!, 0, -0.08, 0.1);
      pointIn(this.t2, P.knee[i]!, R.shin[i]!, 0, -0.1, 0.085);
      piston(this.rig, this.B[`kneeH${n}`]!, this.B[`kneeR${n}`]!, this.t1, this.t2, this.front);
    }

    // ---- the arms: hand targets from the blended poses, then two-bone IK from the shoulders ----
    this.poseHands(t, phase, gait, attend.on ? this.look : null);
    this.careHands(t, attend.on ? this.look : null, care?.throw ?? 0);
    const swordInHand = this.draw > 0.5;
    if (swordInHand && this.sheathed) this.sheathed = false;
    if (!swordInHand && !this.sheathed) this.sheathed = true;
    this.front.set(0, 0, 1).applyQuaternion(R.chest);
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const n = i === 0 ? "L" : "R";
      pointIn(P.shoulder[i]!, P.chest, R.chest, side * SHOULDER_X, SHOULDER_Y - CHEST_Y, 0);
      this.rig.set(this.B[`shoulder${n}`]!, P.shoulder[i]!, R.chest);
      pointIn(this.t4, P.chest, R.chest, side * (SHOULDER_X + 0.04), SHOULDER_Y - 0.03 - CHEST_Y, 0);
      // Elbows behind and out.
      this.pole.copy(this.t4).add(this.t2.set(side * 0.35, -0.25, -0.45).applyQuaternion(R.chest));
      limb(this.t4, this.target[i]!, this.pole, UPPER, FORE, this.front, P.elbow[i]!, P.wrist[i]!, R.upper[i]!, R.fore[i]!);
      this.rig.set(this.B[`upper${n}`]!, this.t4, R.upper[i]!);
      this.rig.set(this.B[`fore${n}`]!, P.elbow[i]!, R.fore[i]!);
      // The hand continues the forearm, its thumb side towards the grip's axis.
      this.t1.subVectors(P.wrist[i]!, P.elbow[i]!);
      aim(R.hand[i]!, this.t1, this.grip[i]!);
      this.rig.set(this.B[`hand${n}`]!, P.wrist[i]!, R.hand[i]!);
      this.posefingers(i, side, R.hand[i]!, P.wrist[i]!);
      // The elbow's piston: from the back of the upper arm to the back of the forearm.
      pointIn(this.t1, this.t4, R.upper[i]!, 0, -0.05, -0.065);
      pointIn(this.t2, P.elbow[i]!, R.fore[i]!, 0, -0.06, -0.055);
      this.t3.set(0, 0, -1).applyQuaternion(R.upper[i]!);
      piston(this.rig, this.B[`elbowH${n}`]!, this.B[`elbowR${n}`]!, this.t1, this.t2, this.t3);
    }

    // ---- the sword: in the right fist (along its grip axis), or in the scabbard ----
    if (!this.sheathed) {
      pointIn(this.swordPos, P.wrist[1]!, R.hand[1]!, 0, -0.065, 0);
      this.swordDir.copy(this.grip[1]!);
      this.t1.set(0, -1, 0).applyQuaternion(R.hand[1]!);
    } else {
      this.swordPos.copy(this.hilt);
      this.swordDir.copy(this.hiltDir);
      this.t1.set(1, 0, 0).applyQuaternion(R.pelvis);
    }
    aim(this.qa, this.swordDir, this.t1, 1);
    this.sword.position.copy(this.swordPos);
    this.sword.quaternion.copy(this.qa);
    // Lying down he's taken it off: it stands by his bed (hearth.ts shows it there).
    const worn = this.lie < 0.5;
    if (this.sword.visible !== worn) this.sword.visible = worn;
  }

  /** Where each wrist goes, which way its grip axis points, and how far its fingers curl, for the blended poses. */
  private poseHands(t: number, phase: number, gait: number, look: Vector3 | null): void {
    const P = this.p;
    const R = this.r;
    // The hilt in the scabbard at his left hip (grip up and forward), for the draw.
    const mouth = SCABBARD_MOUTH;
    const axis = SCABBARD_AXIS;
    pointIn(this.hilt, P.pelvis, R.pelvis, mouth[0] + axis[0] * 0.1, mouth[1] + axis[1] * 0.1, mouth[2] + axis[2] * 0.1);
    // (Seated, the scabbard swings forward beside his thigh, its tip to the ground before the seat: never through it.)
    this.hiltDir.set(-axis[0], -axis[1], -axis[2]).lerp(this.t1.set(0.3, -0.74, 0.6), this.sit).normalize().applyQuaternion(R.pelvis);
    // The armed pose: guard (point down before him, both hands on the hilt) or the bench (the tip on the work).
    if (this.bench > 0.01 && look) {
      // The tip at the work, the grip back along the line from his right shoulder.
      pointIn(this.t1, P.chest, R.chest, -0.25, 0.26, 0.05);
      this.armedDir.subVectors(look, this.t1).normalize();
      this.t2.set(Math.sin(t * 3.1) * 0.025, Math.sin(t * 4.3) * 0.02, Math.cos(t * 3.7) * 0.02);
      this.armedGrip.copy(look).add(this.t2).addScaledVector(this.armedDir, -0.92);
    } else {
      this.armedGrip.set(-0.02, 0.98 + Math.sin(t * 1.4) * 0.008, 0.36);
      this.armedDir.set(0, -1, 0.1).normalize();
    }
    const swing = Math.sin(phase);
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const target = this.target[i]!;
      const grip = this.grip[i]!;
      const shoulderX = side * (SHOULDER_X + 0.04);
      // Idle: hanging, a little bent, breathing.
      target.set(shoulderX + side * 0.05, 1.04 + Math.sin(t * 2.1 + i) * 0.006, 0.05);
      grip.set(0, 0, 1);
      let curl = 0.35;
      // Walking and running: swinging opposite to the legs (the run with elbows bent).
      const a = -swing * side * 0.5;
      this.t1.set(shoulderX + side * 0.05, P.pelvis.y + 0.06 + Math.max(0, a) * 0.08, Math.sin(a) * 0.32 + 0.04);
      blend(target, this.t1, this.walk);
      this.t1.set(shoulderX + side * 0.02, P.chest.y + 0.02, 0.2 + Math.sin(a) * 0.3);
      blend(target, this.t1, this.run);
      curl += 0.5 * this.run;
      // Seated: his hands on his thighs. Lying back: folded on his middle.
      if (this.sit > 0.001) {
        this.t1.set(side * 0.17, P.pelvis.y + 0.12, P.pelvis.z + 0.3);
        blend(target, this.t1, this.sit * (1 - this.lie));
      }
      if (this.lie > 0.001) {
        pointIn(this.t1, P.spine, R.spine, side * 0.07, 0.1 + (i === 0 ? 0.03 : 0), 0.17);
        blend(target, this.t1, this.lie);
        this.t2.set(-side, 0.2, 0.2).normalize();
        blendDir(grip, this.t2, this.lie);
        curl += (0.5 - curl) * this.lie;
      }
      // At work (most stations): both hands before his chest, busy.
      this.t1.set(side * 0.16 + Math.sin(t * 2.3 + i * 2) * 0.03, P.chest.y - 0.05 + Math.sin(t * 3.1 + i) * 0.025, 0.42);
      blend(target, this.t1, this.work);
      this.t2.set(-side, 0, 0.6).normalize();
      blendDir(grip, this.t2, this.work);
      curl += (0.15 - curl) * this.work;
      // Thinking: the right hand to his chin, the left under the right elbow.
      if (i === 1) this.t1.set(-0.03, P.head.y + 0.03, 0.22);
      else this.t1.set(-0.1, P.chest.y - 0.02, 0.24);
      blend(target, this.t1, this.think);
      blendDir(grip, i === 1 ? up : inward(side, this.t2), this.think);
      curl += (0.9 - curl) * this.think;
      // Guard: both fists on the hilt, the left below the right (the right's is the sword's, below).
      if (i === 0) {
        this.t1.copy(this.armedGrip).add(this.t2.set(0.02, -0.03, 0));
        blend(target, this.t1, this.guard);
        blendDir(grip, this.armedDir, this.guard);
        curl += (1.3 - curl) * this.guard;
      }
      // The bench: the left hand steadies the work, palm down.
      if (i === 0 && look) {
        this.t1.copy(look).add(this.t2.set(0.2, 0.04, -0.12));
        blend(target, this.t1, this.bench);
        this.t2.set(-1, 0, 0.3).normalize();
        blendDir(grip, this.t2, this.bench);
        curl += (0.25 - curl) * this.bench;
      }
      // The chalkboard: the right hand at the chalk on the slate, in small strokes as it writes.
      if (i === 1 && look && this.write > 0.01) {
        this.t1.copy(look).add(this.t2.set(Math.sin(t * 9) * 0.03, Math.sin(t * 13) * 0.012, -0.04));
        blend(target, this.t1, this.write);
        this.t2.set(0, 0.35, 1).normalize();
        blendDir(grip, this.t2, this.write);
        curl += (1.1 - curl) * this.write;
      }
      // The right hand and the sword: to the hilt and up into the armed pose, or back.
      if (i === 1) {
        const armedW = Math.max(this.guard, this.bench);
        const reach = Math.sin(this.draw * Math.PI);
        if (this.draw > 0.5) {
          // Sword in hand: from the hilt into the pose.
          const k = (this.draw - 0.5) * 2;
          this.t1.copy(this.armedGrip);
          this.t1.y += 0.06;
          this.t3.lerpVectors(this.hilt, this.t1, smooth(k));
          blend(target, this.t3, Math.max(armedW, 1 - k));
          this.t2.copy(this.hiltDir).lerp(this.armedDir, smooth(k)).normalize();
          blendDir(grip, this.t2, Math.max(armedW, 1 - k));
          curl += (1.35 - curl) * Math.max(armedW, 1 - k, reach);
        } else if (this.draw > 0) {
          // Reaching across for the hilt (or putting it away).
          blend(target, this.hilt, reach);
          blendDir(grip, this.hiltDir, reach);
          curl += (1.2 - curl) * reach;
        }
      }
      this.curl[i] = curl;
    }
  }

  /**
   * Care's hands, over the blended poses: the right hand reaches to what he attends to (patting it, a little
   * up and down), and a throw takes it back over his shoulder and forward (its phase: 0..1).
   */
  private careHands(t: number, look: Vector3 | null, phase: number): void {
    const target = this.target[1]!;
    const grip = this.grip[1]!;
    if (this.reach > 0.01 && look) {
      this.t1.copy(look);
      this.t1.y += 0.05 + Math.max(0, Math.sin(t * 6)) * 0.06;
      this.t1.x += 0.04;
      blend(target, this.t1, this.reach);
      this.t2.set(0, -1, 0.35).normalize();
      blendDir(grip, this.t2, this.reach);
      this.curl[1] = this.curl[1]! + (0.3 - this.curl[1]!) * this.reach;
    }
    if (this.throwW > 0.01) {
      // Back over the shoulder, then forward and up as he lets go, then down in the follow-through.
      const p = Math.max(0, Math.min(1, phase));
      const back = smooth(Math.min(1, p / 0.45));
      const fwd = smooth(Math.max(0, Math.min(1, (p - 0.45) / 0.25)));
      const down = smooth(Math.max(0, (p - 0.7) / 0.3));
      this.t1.set(-0.3, SHOULDER_Y + 0.05, -0.05);
      this.t2.set(-0.32, SHOULDER_Y + 0.28, -0.32);
      this.t1.lerp(this.t2, back);
      this.t2.set(-0.2, SHOULDER_Y + 0.22, 0.55);
      this.t1.lerp(this.t2, fwd);
      this.t2.set(-0.15, SHOULDER_Y - 0.35, 0.42);
      this.t1.lerp(this.t2, down);
      blend(target, this.t1, this.throwW);
      this.curl[1] = this.curl[1]! + ((p < 0.55 ? 1.1 : 0.2) - this.curl[1]!) * this.throwW;
    }
    if (this.wave > 0.01) {
      // A greeting: his right hand up beside his helm, open, a small wave from the wrist.
      this.t1.set(-0.4 + Math.sin(t * 7.5) * 0.06, this.p.head.y + 0.2 - 0.5 * this.lie, 0.2 + 0.25 * this.lie);
      blend(target, this.t1, this.wave);
      this.t2.set(Math.sin(t * 7.5) * 0.25, 1, 0.1).normalize();
      blendDir(grip, this.t2, this.wave);
      this.curl[1] = this.curl[1]! + (0.12 - this.curl[1]!) * this.wave;
    }
  }

  /** Curls the fingers (two segments each) and the thumb about the palm. */
  private posefingers(i: number, side: number, hand: Quaternion, wrist: Vector3): void {
    const c = this.curl[i]!;
    const bones = this.fingers[i]!;
    for (let f = 0; f < 4; f++) {
      const z = 0.033 - f * 0.022;
      pointIn(this.t1, wrist, hand, -side * 0.004, -0.095, z);
      // Fingers curl towards the palm (his side, −side·x in the hand's frame), the outer joint more.
      this.qa.setFromEuler(eul.set(0, 0, -side * c * (0.9 + f * 0.05))).premultiply(hand);
      this.rig.set(bones[f * 2]!, this.t1, this.qa);
      pointIn(this.t2, this.t1, this.qa, 0, -0.045, 0);
      this.qb.setFromEuler(eul.set(0, 0, -side * c * 1.1)).premultiply(this.qa);
      this.rig.set(bones[f * 2 + 1]!, this.t2, this.qb);
    }
    const thumb = this.thumbs[i]!;
    pointIn(this.t1, wrist, hand, -side * 0.012, -0.035, 0.05);
    this.qa.setFromEuler(eul.set(0.5 + c * 0.25, 0, -side * c * 0.6)).premultiply(hand);
    this.rig.set(thumb[0]!, this.t1, this.qa);
    pointIn(this.t2, this.t1, this.qa, 0, -0.04, 0.006);
    this.qb.setFromEuler(eul.set(c * 0.3, 0, -side * c * 0.5)).premultiply(this.qa);
    this.rig.set(thumb[1]!, this.t2, this.qb);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.skeleton.dispose();
    for (const o of this.sword.children) (o as Mesh).geometry.dispose();
    this.shadow.geometry.dispose();
    (this.shadow.material as MeshBasicMaterial).dispose();
    this.material.dispose();
    this.swordMaterial.dispose();
  }
}

const eul = new Euler(0, 0, 0, "YXZ");
const up = new Vector3(0, 1, 0);
const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Moves `out` towards `to` by weight w (0..1). */
function blend(out: Vector3, to: Vector3, w: number): void {
  if (w > 0) out.lerp(to, Math.min(1, w));
}

/** Turns a direction towards another by weight w, keeping it unit length. */
function blendDir(out: Vector3, to: Vector3, w: number): void {
  if (w > 0) out.lerp(to, Math.min(1, w)).normalize();
}

/** Towards his middle from a hand on `side`, a little up. */
function inward(side: number, out: Vector3): Vector3 {
  return out.set(-side, 0.4, 0.3).normalize();
}
