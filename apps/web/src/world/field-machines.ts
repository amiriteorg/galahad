import { AdditiveBlending, BoxGeometry, BufferAttribute, BufferGeometry, Color, ConeGeometry, CylinderGeometry, DoubleSide, type Material, MeshBasicNodeMaterial, Quaternion, SkinnedMesh, SphereGeometry, TorusGeometry, Uint16BufferAttribute, Vector3 } from "three/webgpu";
import { headingToSceneYaw } from "./coords.ts";
import { aircraftParts, C, HINGES } from "./field-build.ts";
import type { Aircraft } from "./field-circuit.ts";
import { PAVE, TRACK_TOP } from "./field-ground.ts";
import type { Launcher } from "./field-launcher.ts";
import { BLOCKHOUSE, ENTRANCE_POSTS, FIELD_GATE, TOWER, WEATHER_MAST, WINDSOCK } from "./field-plan.ts";
import type { Quad } from "./field-quad.ts";
import { ROVER, type RoverState } from "./field-rover.ts";
import { SOCK_BANDS, type SockPose } from "./field-wind.ts";
import { at, between, bevelBox, Mesher } from "./mesher.ts";
import { Rig } from "./rig.ts";

/*
 * The proving ground's moving things in one skinned mesh (one draw call for
 * all of them): the resident aircraft, the rover, the quadcopter, the windsock,
 * the anemometer and its vane, the tracking dish, the tower's beacon, the mobile
 * launcher and the gate's barrier. Each part is bound wholly to one bone, all
 * bones flat under one root and posed directly in the place's scene space (the
 * rig.ts way). The beams (the beacon's, the landing light's) are a second,
 * additive skinned mesh on the same skeleton. Parts are built in bind pose with
 * every machine at the origin of its own frame: nose (or front) +z, left +x, up +y.
 */

const q = new Quaternion();
const qa = new Quaternion();
const qb = new Quaternion();
const qc = new Quaternion();
const v = new Vector3();
const v2 = new Vector3();
const rq = new Quaternion();
const bq = new Quaternion();
const tq = new Quaternion();
const pw = new Vector3();
const hw = new Vector3();
const tv = new Vector3();
const sp = new Vector3();
const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);

/** The rover's own frame from the solver's (forward, left, up) to the scene model's (left +x, up +y, forward +z). */
const rv = (forward: number, left: number, up: number): [number, number, number] => [left, up, forward];

export interface MachineDetail {
  seg: number;
  bevel: boolean;
}

export class Machines {
  private readonly rig = new Rig();
  readonly mesh: SkinnedMesh;
  readonly beams: SkinnedMesh;
  private readonly b: Record<string, number> = {};
  private readonly bind: Record<string, Vector3> = {};

  constructor(d: MachineDetail, material: Material, beamMaterial: MeshBasicNodeMaterial) {
    const m = new Mesher();
    const beams = new BeamBuilder();
    const bone = (name: string, x: number, y: number, z: number): number => {
      const i = this.rig.add(x, y, z);
      this.b[name] = i;
      this.bind[name] = new Vector3(x, y, z);
      return i;
    };
    const box = (w: number, h: number, dd: number) => (d.bevel ? bevelBox(w, h, dd, Math.min(0.03, Math.min(w, h, dd) * 0.2)) : new BoxGeometry(w, h, dd));

    // ---------- the aircraft ----------
    const parts = aircraftParts({ body: 0xf1e9d8, trim: C.orange, accent: C.grey, detail: d.seg }).static;
    bone("plane", 0, 0, 0);
    bone("planeLights", 0, 0, 0);
    for (const name of ["prop", "elevator", "rudder", "aileronL", "aileronR", "flapL", "flapR", "wheelL", "wheelR", "nose", "noseWheel"] as const) {
      const [x, y, z] = HINGES[name];
      bone(name, x, y, z);
    }
    for (const p of parts) {
      const boneName = p.part === "body" || p.part === "cowling" || p.part === "spinner" ? (p.glow ? "planeLights" : "plane") : p.part === "prop" ? "prop" : p.part;
      // The spinner turns with the propeller.
      m.bone(this.b[p.part === "spinner" ? "prop" : boneName]!).glow(p.glow ?? 0);
      m.add(p.geometry, p.color, p.matrix, p.vary);
    }
    m.glow(0);
    // The landing light's beam, forward and a little down from the left wing.
    beams.cone(this.b.planeLights!, [1.6, 2.1, 0.84], [0, -0.07, 1], 0.12, 3.2, 26, 0xfff1d8, 0.55);

    // ---------- the rover (the Open Source Rover's geometry, drawn four times life size) ----------
    const R = ROVER;
    bone("rover", 0, 0, 0);
    const pivot = (s: number) => rv(R.pivot[0], s * R.pivot[1], R.pivot[2]);
    const bogie = (s: number) => {
      const p = pivot(s);
      return [p[0], p[1] + R.bogie[1], p[2] + R.bogie[0]] as [number, number, number];
    };
    for (const [s, side] of [[1, "L"], [-1, "R"]] as const) {
      const p = pivot(s);
      bone(`rocker${side}`, ...p);
      const g = bogie(s);
      bone(`bogie${side}`, ...g);
      // Corner knuckles (front and rear) and all six wheels.
      const front = [s * R.track[0], g[1] + R.front[1], g[2] + R.front[0]] as const;
      const mid = [s * R.track[1], g[1] + R.mid[1], g[2] + R.mid[0]] as const;
      const rear = [s * R.track[2], p[1] + R.rear[1], p[2] + R.rear[0]] as const;
      bone(`knuckleF${side}`, ...front);
      bone(`knuckleB${side}`, ...rear);
      bone(`wheelF${side}`, ...front);
      bone(`wheelM${side}`, ...mid);
      bone(`wheelB${side}`, ...rear);
      // The rocker: two box beams from its hinge, to the rear wheel and to the bogie's hinge.
      m.bone(this.b[`rocker${side}`]!);
      m.add(new BoxGeometry(0.09, 1, 0.09), C.steel, between(p[0], p[1], p[2], p[0], rear[1] + 0.2, rear[2] + 0.12), 0.02);
      m.add(new BoxGeometry(0.09, 1, 0.09), C.steel, between(p[0], p[1], p[2], g[0], g[1], g[2]), 0.02);
      m.add(new CylinderGeometry(0.11, 0.11, 0.14, 8), C.orange, at(p[0], p[1], p[2], 0, 1, 0, Math.PI / 2), 0);
      // An arm down to the rear wheel's knuckle, outboard.
      m.add(new BoxGeometry(Math.abs(rear[0] - p[0]) + 0.06, 0.07, 0.07), C.steel, at((p[0] + rear[0]) / 2, rear[1] + 0.2, rear[2] + 0.12), 0);
      // The bogie: a beam to each of its wheels.
      m.bone(this.b[`bogie${side}`]!);
      m.add(new BoxGeometry(0.08, 1, 0.08), C.steel, between(g[0], g[1], g[2], g[0], front[1] + 0.2, front[2]), 0.02);
      m.add(new BoxGeometry(0.08, 1, 0.08), C.steel, between(g[0], g[1], g[2], g[0], mid[1] + 0.2, mid[2]), 0.02);
      m.add(new CylinderGeometry(0.09, 0.09, 0.12, 8), C.orange, at(g[0], g[1], g[2], 0, 1, 0, Math.PI / 2), 0);
      m.add(new BoxGeometry(Math.abs(front[0] - g[0]) + 0.06, 0.07, 0.07), C.steel, at((g[0] + front[0]) / 2, front[1] + 0.2, front[2]), 0);
      // The middle wheel's motor on its axle, from the bogie's beam.
      m.add(new CylinderGeometry(0.07, 0.07, Math.abs(mid[0] - g[0]), 6), C.grey, at((g[0] + mid[0]) / 2, mid[1], mid[2], 0, 1, 0, Math.PI / 2), 0);
      // The corner knuckles: a steering servo over each corner wheel, its bracket down to the axle.
      for (const [k, c] of [["F", front], ["B", rear]] as const) {
        m.bone(this.b[`knuckle${k}${side}`]!);
        m.add(box(0.16, 0.14, 0.2), C.grey, at(c[0], c[1] + 0.27, c[2]), 0.02);
        m.add(new BoxGeometry(0.05, 0.3, 0.12), C.steel, at(c[0] + s * 0.17, c[1] + 0.12, c[2]), 0);
      }
      // The wheels: tyres with grousers (alternating darker faces), pale hubs.
      for (const k of ["F", "M", "B"] as const) {
        const c = k === "F" ? front : k === "M" ? mid : rear;
        m.bone(this.b[`wheel${k}${side}`]!);
        const segs = d.seg + 6;
        m.add(new CylinderGeometry(R.wheelRadius, R.wheelRadius, 0.24, segs), (_x, y, z) => (Math.floor((Math.atan2(y - c[1], z - c[2]) + Math.PI) / ((Math.PI * 2) / segs)) % 2 ? 0x2f3238 : C.tyre), at(c[0], c[1], c[2], 0, 1, 0, Math.PI / 2), 0.02);
        m.add(new CylinderGeometry(R.wheelRadius * 0.5, R.wheelRadius * 0.5, 0.26, 8), C.cream, at(c[0], c[1], c[2], 0, 1, 0, Math.PI / 2), 0);
      }
    }
    // The body: a box on the rockers' axle, a lid with a solar panel, an electronics bay, the differential bar on top.
    m.bone(this.b.rover!);
    m.add(box(0.95, 0.42, 1.25), C.cream, at(0, 0.1, 0.05), 0.03);
    m.add(box(1.0, 0.06, 1.3), C.orange, at(0, 0.34, 0.05), 0.02);
    m.add(new BoxGeometry(0.8, 0.03, 0.95), 0x34508a, at(0, 0.385, -0.05), 0.02);
    m.add(new BoxGeometry(1.5, 0.06, 0.08), C.steel, at(0, 0.42, 0.55), 0.02);
    for (const s of [-1, 1]) m.add(new BoxGeometry(0.05, 0.32, 0.05), C.steel, at(s * 0.72, 0.24, 0.55), 0);
    m.add(new CylinderGeometry(0.09, 0.09, 1.5, 6), C.grey, at(0, -0.02, 0.064, 0, 1, 0, Math.PI / 2), 0);
    // Head and status lights at its front.
    m.glow(1);
    for (const s of [-1, 1]) m.add(new BoxGeometry(0.12, 0.06, 0.03), 0xfff3dc, at(s * 0.3, 0.12, 0.69), 0);
    m.add(new BoxGeometry(0.05, 0.05, 0.03), 0x8fe2ff, at(0.38, 0.27, 0.69), 0);
    m.glow(0);
    // The mast: a pole at the front, a pan-tilt head with two camera eyes.
    m.add(new CylinderGeometry(0.035, 0.045, 0.95, 6), C.steel, at(0.32, 0.85, 0.48), 0);
    bone("mastPan", 0.32, 1.35, 0.48);
    bone("mastHead", 0.32, 1.42, 0.48);
    m.bone(this.b.mastPan!);
    m.add(new BoxGeometry(0.14, 0.1, 0.14), C.grey, at(0.32, 1.35, 0.48), 0);
    m.bone(this.b.mastHead!);
    m.add(box(0.36, 0.16, 0.16), C.cream, at(0.32, 1.47, 0.5), 0.02);
    for (const s of [-1, 1]) m.add(new CylinderGeometry(0.04, 0.04, 0.05, 8), C.black, at(0.32 + s * 0.1, 1.47, 0.59, 0, 1, Math.PI / 2), 0);
    m.add(new BoxGeometry(0.02, 0.3, 0.02), C.steel, at(0.48, 1.62, 0.45), 0);

    // ---------- the quadcopter (a survey drone, drawn large like the robots) ----------
    bone("quad", 0, 0, 0);
    const arm = 0.62;
    const motors: [number, number][] = [[arm, arm], [-arm, arm], [-arm, -arm], [arm, -arm]];
    motors.forEach(([x, z], i) => bone(`rotor${i}`, x, 0.42, z));
    m.bone(this.b.quad!);
    m.add(box(0.42, 0.16, 0.56), C.grey, at(0, 0.3, 0), 0.02);
    m.add(box(0.36, 0.06, 0.44), C.orange, at(0, 0.41, 0), 0.02);
    for (const [x, z] of motors) {
      m.add(new BoxGeometry(0.06, 0.05, 1), C.grey, between(0, 0.32, 0, x, 0.36, z), 0);
      m.add(new CylinderGeometry(0.06, 0.07, 0.1, 8), C.black, at(x, 0.37, z), 0);
    }
    // Skids, a camera gimbal, lights (front white, rear red).
    for (const s of [-1, 1]) {
      m.add(new BoxGeometry(0.04, 0.04, 0.7), C.black, at(s * 0.22, 0.02, 0), 0);
      for (const z of [-0.2, 0.2]) m.add(new BoxGeometry(0.03, 1, 0.03), C.black, between(s * 0.22, 0.02, z, s * 0.14, 0.24, z), 0);
    }
    m.add(new SphereGeometry(0.08, 8, 5), C.black, at(0, 0.17, 0.2), 0);
    m.glow(1);
    for (const [x, z] of motors) m.add(new BoxGeometry(0.05, 0.03, 0.05), z > 0 ? 0xfff3dc : 0xff4a3a, at(x, 0.3, z), 0);
    m.glow(0);
    motors.forEach(([x, z], i) => {
      m.bone(this.b[`rotor${i}`]!);
      for (const s of [-1, 1]) m.add(new BoxGeometry(0.06, 0.012, 0.36), C.cream, at(x, 0.43, z + s * 0.18, 0, 1, s * 0.12), 0);
    });

    // ---------- the windsock: a swivel and five bands ----------
    const ws = WINDSOCK;
    const top = ws.height;
    bone("sock", 0, top, 0);
    m.bone(this.b.sock!);
    m.add(new CylinderGeometry(0.05, 0.05, 0.25, 6), C.grey, at(0, top - 0.1, 0), 0);
    m.add(new BoxGeometry(0.05, 0.05, 0.42), C.grey, at(0, top - 0.05, 0.2), 0);
    m.add(new TorusGeometry(0.42, 0.03, 4, d.seg + 4), C.grey, at(0, top - 0.48, 0.42), 0);
    m.add(new BoxGeometry(0.03, 0.45, 0.03), C.grey, at(0, top - 0.25, 0.42), 0);
    const band = 0.62;
    for (let i = 0; i < SOCK_BANDS; i++) {
      const r0 = 0.42 - (0.2 * i) / SOCK_BANDS;
      const r1 = 0.42 - (0.2 * (i + 1)) / SOCK_BANDS;
      bone(`band${i}`, 0, top - 0.48, 0.42 + band * i);
      m.bone(this.b[`band${i}`]!);
      // A frustum along +z, a little longer than its band so the joints never gape.
      // (And again turned inside out, so the sock has an inside to look into.)
      for (const flip of [1, -1]) m.add(new CylinderGeometry(r1, r0, band + 0.05, d.seg + 4, 1, true), i % 2 ? (flip > 0 ? C.white : 0xdcd8cf) : flip > 0 ? C.orange : 0xc96f35, at(0, top - 0.48, 0.42 + band * i + band / 2 + 0.02, 0, [flip, 1, 1], Math.PI / 2), 0.02);
    }

    // ---------- the weather mast's anemometer and vane ----------
    const wm = WEATHER_MAST;
    bone("cups", 0.72, wm.height + 0.12, 0);
    bone("vane", -0.72, wm.height + 0.12, 0);
    m.bone(this.b.cups!);
    for (let i = 0; i < 3; i++) {
      const a = (i * 2 * Math.PI) / 3;
      const cx = 0.72 + Math.cos(a) * 0.2;
      const cz = Math.sin(a) * 0.2;
      m.add(new BoxGeometry(0.4, 0.015, 0.015), C.steel, at(0.72 + Math.cos(a) * 0.1, wm.height + 0.12, Math.sin(a) * 0.1, -a), 0);
      m.add(new SphereGeometry(0.07, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2), C.white, at(cx, wm.height + 0.12, cz, -a, 1, 0, Math.PI / 2), 0);
    }
    m.add(new CylinderGeometry(0.03, 0.03, 0.1, 6), C.steel, at(0.72, wm.height + 0.12, 0), 0);
    m.bone(this.b.vane!);
    m.add(new BoxGeometry(0.6, 0.02, 0.02), C.steel, at(-0.72 - 0.05, wm.height + 0.14, 0), 0);
    m.add(new BoxGeometry(0.02, 0.18, 0.22), C.orange, at(-0.72 - 0.3, wm.height + 0.16, 0, Math.PI / 2), 0);
    m.add(new ConeGeometry(0.035, 0.1, 4), C.grey, at(-0.72 + 0.27, wm.height + 0.14, 0, 0, 1, 0, -Math.PI / 2), 0);

    // ---------- the tracking dish on the blockhouse ----------
    const B = BLOCKHOUSE;
    bone("dishBase", 0, B.dish - 1.1, 0);
    bone("dish", 0, B.dish, 0);
    m.bone(this.b.dishBase!);
    m.add(new CylinderGeometry(0.38, 0.38, 0.2, 8), C.steel, at(0, B.dish - 1.0, 0), 0);
    for (const s of [-1, 1]) m.add(new BoxGeometry(0.1, 1.15, 0.24), C.steel, at(s * 0.82, B.dish - 0.45, 0), 0);
    m.bone(this.b.dish!);
    // A bowl (the bottom cap of a sphere, both its faces), opening along +y: where it looks.
    for (const flip of [1, -1]) m.add(new SphereGeometry(1.2, d.seg + 4, 3, 0, Math.PI * 2, Math.PI - 0.6, 0.6), flip > 0 ? 0xe9e6df : C.white, at(0, B.dish - 0.1 + 1.2 * Math.cos(0.6), 0, 0, [flip, 1, 1]), 0.02);
    m.add(new CylinderGeometry(0.06, 0.06, 1.5, 6), C.steel, at(0, B.dish, 0, 0, 1, 0, Math.PI / 2), 0);
    for (let i = 0; i < 3; i++) {
      const a = (i * 2 * Math.PI) / 3;
      m.add(new BoxGeometry(0.02, 1, 0.02), C.grey, between(Math.cos(a) * 0.62, B.dish + 0.08, Math.sin(a) * 0.62, 0, B.dish + 0.62, 0), 0);
    }
    m.add(new CylinderGeometry(0.05, 0.08, 0.16, 6), C.grey, at(0, B.dish + 0.66, 0), 0);

    // ---------- the tower's beacon ----------
    bone("beacon", 0, TOWER.beacon, 0);
    m.bone(this.b.beacon!);
    m.add(new CylinderGeometry(0.22, 0.26, 0.12, 8), C.grey, at(0, TOWER.beacon - 0.42, 0), 0);
    m.add(new CylinderGeometry(0.2, 0.2, 0.45, 8), C.grey, at(0, TOWER.beacon - 0.14, 0), 0);
    m.add(new CylinderGeometry(0.05, 0.05, 0.12, 6), C.grey, at(0, TOWER.beacon + 0.12, 0), 0);
    m.glow(1.4);
    // White one way, green the other: the aerodrome beacon's colours.
    m.add(new CylinderGeometry(0.13, 0.13, 0.06, 8), 0xfff8e8, at(0, TOWER.beacon - 0.12, 0.21, 0, 1, Math.PI / 2), 0);
    m.add(new CylinderGeometry(0.13, 0.13, 0.06, 8), 0x7dffa0, at(0, TOWER.beacon - 0.12, -0.21, 0, 1, Math.PI / 2), 0);
    m.glow(0);
    beams.cone(this.b.beacon!, [0, TOWER.beacon - 0.12, 0.25], [0, 0.05, 1], 0.12, 2, 34, 0xfff4dc, 0.45);
    beams.cone(this.b.beacon!, [0, TOWER.beacon - 0.12, -0.25], [0, 0.05, -1], 0.12, 2, 34, 0x7dff9a, 0.45);

    // ---------- the mobile launcher ----------
    bone("launcher", 0, 0, 0);
    bone("rail", 0, 1.15, -1.6);
    m.bone(this.b.launcher!);
    m.add(box(2.6, 0.55, 4.6), C.cream, at(0, 0.8, 0), 0.03);
    m.add(box(2.7, 0.12, 4.7), C.orange, at(0, 1.1, 0), 0.02);
    for (const s of [-1, 1]) for (const z of [-1.6, 0, 1.6]) m.add(new CylinderGeometry(0.42, 0.42, 0.34, d.seg + 2), C.tyre, at(s * 1.2, 0.42, z, 0, 1, 0, Math.PI / 2), 0.02);
    // Jacks at its corners, and an umbilical mast.
    for (const s of [-1, 1]) for (const z of [-2.1, 2.1]) {
      m.add(new CylinderGeometry(0.07, 0.07, 0.7, 6), C.steelDark, at(s * 1.2, 0.4, z), 0);
      m.add(new BoxGeometry(0.3, 0.05, 0.3), C.steelDark, at(s * 1.2, 0.06, z), 0);
    }
    m.add(new BoxGeometry(0.2, 3.2, 0.2), C.steelDark, at(-1.0, 2.7, 1.9), 0);
    m.add(new BoxGeometry(0.9, 0.08, 0.08), C.steelDark, at(-0.55, 4.1, 1.9), 0);
    m.add(new BoxGeometry(0.8, 0.9, 0.45), C.grey, at(0.8, 1.6, 1.8), 0.02);
    m.bone(this.b.rail!);
    // The rail: a lattice beam with the rocket on it, built lying along +z (upright is a turn about x).
    const L = 8.5;
    for (const s of [-1, 1]) m.add(new BoxGeometry(0.1, 0.1, L), C.steelDark, at(s * 0.22, 1.35, -1.6 + L / 2), 0);
    for (let i = 0; i <= 8; i++) m.add(new BoxGeometry(0.5, 0.05, 0.05), C.steelDark, at(0, 1.35, -1.6 + (i * L) / 8), 0);
    const rocket = (z: number) => at(0, 1.8, -1.6 + z);
    m.add(new CylinderGeometry(0.28, 0.28, 5.4, d.seg + 2), (_x, _y, zz) => (zz < -(-1.6 + 1.4) && zz > -(-1.6 + 1.9) ? C.orange : C.white), rocket(3.6).multiply(at(0, 0, 0, 0, 1, Math.PI / 2)), 0.02);
    m.add(new ConeGeometry(0.28, 1.2, d.seg + 2), C.orange, rocket(6.9).multiply(at(0, 0, 0, 0, 1, Math.PI / 2)), 0.02);
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + Math.PI / 4;
      m.add(new BoxGeometry(0.03, 0.55, 0.8), C.orange, rocket(1.3).multiply(at(Math.cos(a) * 0.45, Math.sin(a) * 0.45, 0, 0, 1, 0, a - Math.PI / 2)), 0);
    }
    m.add(new CylinderGeometry(0.22, 0.3, 0.3, d.seg + 2), C.grey, rocket(0.75).multiply(at(0, 0, 0, 0, 1, Math.PI / 2)), 0);

    // ---------- the gate's barrier ----------
    bone("barrier", 0, 0.95, 0);
    m.bone(this.b.barrier!);
    m.add(new BoxGeometry(0.3, 0.3, 0.3), C.grey, at(0, 0.95, 0), 0);
    // The arm along +z (towards the north post), banded red and white, a counterweight behind.
    m.add(new BoxGeometry(0.1, 0.12, 6.9), (_x, _y, z) => (Math.floor(z / 0.7) % 2 ? C.red : C.white), at(0, 0.95, 3.55), 0.02);
    m.add(new BoxGeometry(0.22, 0.28, 0.5), C.grey, at(0, 0.95, -0.35), 0);

    this.mesh = this.rig.mesh(m.build({ ao: (_x, y) => 0.75 + 0.25 * Math.min(1, Math.max(0, y / 0.8)) }), material);
    this.beams = new SkinnedMesh(beams.build(), beamMaterial);
    this.beams.frustumCulled = false;
    this.beams.bind(this.mesh.skeleton, this.mesh.bindMatrix);
    this.beams.renderOrder = 4;
  }

  private set(name: string, p: Vector3, rot: Quaternion, scale = 1): void {
    const bone = this.rig.bones[this.b[name]!]!;
    bone.position.copy(p);
    bone.quaternion.copy(rot);
    bone.scale.setScalar(scale);
  }

  /** A part on its hinge: placed at the machine's (pos, rot) plus its bind offset from the machine's origin, turned by `local`. */
  private part(name: string, pos: Vector3, rot: Quaternion, local: Quaternion, scale = 1): void {
    v2.copy(this.bind[name]!).applyQuaternion(rot).add(pos);
    qc.copy(rot).multiply(local);
    this.set(name, v2, qc, scale);
  }

  // ---------- posing (scene space of the place's group; nothing allocated) ----------

  poseAircraft(a: Aircraft, lightsOn: boolean): void {
    v.set(a.x, a.z + PAVE, -a.y);
    // Heading, then nose up about the left axis, then the bank (left wing down +) about the nose.
    q.setFromAxisAngle(Y, headingToSceneYaw(a.heading));
    qa.setFromAxisAngle(X, -a.pitch);
    q.multiply(qa);
    qa.setFromAxisAngle(Z, -a.bank);
    q.multiply(qa);
    this.set("plane", v, q);
    this.set("planeLights", v, q, lightsOn ? 1 : 1e-4);
    qb.setFromAxisAngle(Z, a.prop);
    this.part("prop", v, q, qb);
    qb.setFromAxisAngle(X, -a.elevator * 0.35);
    this.part("elevator", v, q, qb);
    qb.setFromAxisAngle(Y, a.rudder * 0.4);
    this.part("rudder", v, q, qb);
    qb.setFromAxisAngle(X, -a.aileron * 0.3);
    this.part("aileronL", v, q, qb);
    qb.setFromAxisAngle(X, a.aileron * 0.3);
    this.part("aileronR", v, q, qb);
    qb.setFromAxisAngle(X, a.flaps * 0.55);
    this.part("flapL", v, q, qb);
    this.part("flapR", v, q, qb);
    qb.setFromAxisAngle(X, a.wheels);
    this.part("wheelL", v, q, qb);
    this.part("wheelR", v, q, qb);
    qb.setFromAxisAngle(Y, a.steer);
    this.part("nose", v, q, qb);
    qc.setFromAxisAngle(X, a.wheels * (0.3 / 0.24));
    qb.multiply(qc);
    this.part("noseWheel", v, q, qb);
  }

  poseRover(r: RoverState): void {
    const p = r.pose;
    v.set(p.x, p.z + TRACK_TOP, -p.y);
    q.setFromAxisAngle(Y, headingToSceneYaw(p.heading));
    qa.setFromAxisAngle(X, -p.pitch);
    q.multiply(qa);
    qa.setFromAxisAngle(Z, p.roll);
    q.multiply(qa);
    this.set("rover", v, q);
    for (const [i, side] of [[0, "L"], [1, "R"]] as const) {
      const rocker = p.rocker[i]!;
      const bog = p.bogie[i]!;
      // The rocker on its hinge, turned against the body; the bogie on its hinge, turned against the rocker.
      const rockerBind = this.bind[`rocker${side}`]!;
      const bogieBind = this.bind[`bogie${side}`]!;
      pw.copy(rockerBind).applyQuaternion(q).add(v);
      rq.copy(q).multiply(qa.setFromAxisAngle(X, -(rocker - p.pitch)));
      this.set(`rocker${side}`, pw, rq);
      hw.copy(bogieBind).sub(rockerBind).applyQuaternion(rq).add(pw);
      bq.copy(rq).multiply(qa.setFromAxisAngle(X, -(bog - rocker)));
      this.set(`bogie${side}`, hw, bq);
      // Front and middle wheels on the bogie, the rear on the rocker; the corners steer.
      this.wheel(`F${side}`, hw, bq, bogieBind, r.steer[i === 0 ? 0 : 2]!, r.spin[i * 3]!);
      this.wheel(`M${side}`, hw, bq, bogieBind, null, r.spin[i * 3 + 1]!);
      this.wheel(`B${side}`, pw, rq, rockerBind, r.steer[i === 0 ? 1 : 3]!, r.spin[i * 3 + 2]!);
    }
    qa.setFromAxisAngle(Y, r.mastYaw);
    this.part("mastPan", v, q, qa);
    qa.multiply(qb.setFromAxisAngle(X, r.mastPitch));
    this.part("mastHead", v, q, qa);
  }

  /** A wheel (and its knuckle, if it steers) on a beam whose hinge `ref` (bind) is at `origin`, turned by `rot`. */
  private wheel(key: string, origin: Vector3, rot: Quaternion, ref: Vector3, steer: number | null, spin: number): void {
    tv.copy(this.bind[`wheel${key}`]!).sub(ref).applyQuaternion(rot).add(origin);
    tq.copy(rot);
    if (steer !== null) {
      tq.multiply(qb.setFromAxisAngle(Y, steer));
      this.set(`knuckle${key}`, tv, tq);
    }
    tq.multiply(qb.setFromAxisAngle(X, spin));
    this.set(`wheel${key}`, tv, tq);
  }

  poseQuad(quad: Quad): void {
    v.set(quad.x, quad.z, -quad.y);
    // Its up axis leans by its tilt (east +x, north −z in the scene); its nose turns with its yaw.
    v2.set(quad.tiltX, 1, -quad.tiltY).normalize();
    q.setFromUnitVectors(Y, v2);
    qa.setFromAxisAngle(Y, headingToSceneYaw(quad.yaw));
    q.multiply(qa);
    this.set("quad", v, q);
    for (let i = 0; i < 4; i++) {
      qb.setFromAxisAngle(Y, (i % 2 ? -1 : 1) * quad.rotorAngle + i);
      this.part(`rotor${i}`, v, q, qb);
    }
  }

  poseWindsock(sock: SockPose): void {
    const ws = WINDSOCK;
    v.set(ws.x, 0, -ws.y);
    q.setFromAxisAngle(Y, headingToSceneYaw(sock.heading));
    this.part("sock", v, q, qb.identity());
    // The bands, each hung from the end of the one before.
    sp.copy(this.bind.band0!).applyQuaternion(q).add(v);
    for (let i = 0; i < SOCK_BANDS; i++) {
      qc.copy(q).multiply(qa.setFromAxisAngle(Y, sock.swing[i]!)).multiply(qb.setFromAxisAngle(X, sock.droop[i]!));
      this.set(`band${i}`, sp, qc);
      sp.add(tv.set(0, 0, 0.62).applyQuaternion(qc));
    }
  }

  poseWeather(cups: number, vane: number): void {
    const wm = WEATHER_MAST;
    v.set(wm.x, 0, -wm.y);
    q.identity();
    qa.setFromAxisAngle(Y, cups);
    this.part("cups", v, q, qa);
    // (Its arrow points along +x in its bind pose: turned to the way the wind comes from.)
    qa.setFromAxisAngle(Y, vane);
    this.part("vane", v, q, qa);
  }

  poseDish(azimuth: number, elevation: number): void {
    const B = BLOCKHOUSE;
    v.set(B.x, 0, -(B.y - 0.3));
    q.identity();
    qa.setFromAxisAngle(Y, headingToSceneYaw(azimuth));
    this.part("dishBase", v, q, qa);
    // The dish looks along +y in its bind pose: tip it over towards the azimuth by 90° less the elevation.
    qb.setFromAxisAngle(X, Math.PI / 2 - elevation);
    qa.multiply(qb);
    this.part("dish", v, q, qa);
  }

  poseBeacon(angle: number): void {
    v.set(TOWER.x, 0, -TOWER.y);
    q.identity();
    qa.setFromAxisAngle(Y, angle);
    this.part("beacon", v, q, qa);
  }

  poseLauncher(l: Launcher): void {
    v.set(l.x, PAVE, -l.y);
    q.setFromAxisAngle(Y, headingToSceneYaw(l.heading));
    this.set("launcher", v, q);
    // The rail lies along the platform at 0 and stands upright at π/2: a turn about its hinge's left axis.
    qa.setFromAxisAngle(X, -l.erect);
    this.part("rail", v, q, qa);
  }

  poseBarrier(open: number): void {
    v.set(ENTRANCE_POSTS.x - 0.75, 0, -(FIELD_GATE.y - ENTRANCE_POSTS.half + 0.25));
    // Its arm points north across the road; opening swings it up.
    q.setFromAxisAngle(Y, Math.PI);
    qa.setFromAxisAngle(X, -open * 1.45);
    q.multiply(qa);
    qb.identity();
    this.part("barrier", v, q, qb);
  }
}

/**
 * The beams' geometry, built by hand (the mesher keeps one colour a face; a beam fades along its length): soft
 * cones of light, each bound to one bone, their vertex colours fading to black at the far end (additive: black
 * adds nothing).
 */
class BeamBuilder {
  private readonly pos: number[] = [];
  private readonly col: number[] = [];
  private readonly bones: number[] = [];

  cone(bone: number, from: readonly [number, number, number], dir: readonly [number, number, number], r0: number, r1: number, length: number, color: number, strength: number, sides = 10, rings = 8): void {
    const d = new Vector3(...dir).normalize();
    const u = new Vector3().crossVectors(d, Math.abs(d.y) < 0.9 ? Y : X).normalize();
    const w = new Vector3().crossVectors(d, u);
    const c = new Color(color);
    const point = (k: number, j: number): [number, number, number, number] => {
      const t = k / rings;
      const r = r0 + (r1 - r0) * t;
      const a = (j / sides) * Math.PI * 2;
      const x = from[0] + d.x * length * t + (u.x * Math.cos(a) + w.x * Math.sin(a)) * r;
      const y = from[1] + d.y * length * t + (u.y * Math.cos(a) + w.y * Math.sin(a)) * r;
      const z = from[2] + d.z * length * t + (u.z * Math.cos(a) + w.z * Math.sin(a)) * r;
      return [x, y, z, strength * (1 - t) ** 1.7];
    };
    for (let k = 0; k < rings; k++) {
      for (let j = 0; j < sides; j++) {
        const a = point(k, j);
        const b = point(k, j + 1);
        const e = point(k + 1, j + 1);
        const f = point(k + 1, j);
        for (const p of [a, b, e, a, e, f]) {
          this.pos.push(p[0], p[1], p[2]);
          this.col.push(c.r * p[3], c.g * p[3], c.b * p[3]);
          this.bones.push(bone);
        }
      }
    }
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute("color", new BufferAttribute(new Float32Array(this.col), 3));
    const index = new Uint16Array(this.bones.length * 4);
    const weight = new Float32Array(this.bones.length * 4);
    for (let i = 0; i < this.bones.length; i++) {
      index[i * 4] = this.bones[i]!;
      weight[i * 4] = 1;
    }
    g.setAttribute("skinIndex", new Uint16BufferAttribute(index, 4));
    g.setAttribute("skinWeight", new BufferAttribute(weight, 4));
    g.computeBoundingSphere();
    return g;
  }
}

/** The beams' material: additive, fading along each beam, no fog (a beam in the mist is light, not haze). */
export function beamMaterial(): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide });
  m.fog = false;
  return m;
}
