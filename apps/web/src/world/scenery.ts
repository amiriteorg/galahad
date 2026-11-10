import { attribute, cos, dot, float, max, mix, normalWorld, positionLocal, sin, smoothstep, time, uniform, vec3, vertexColor } from "three/tsl";
import {
  BoxGeometry,
  BufferAttribute,
  type BufferGeometry,
  Color,
  CylinderGeometry,
  DodecahedronGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicNodeMaterial,
  MeshLambertNodeMaterial,
  SphereGeometry,
  Vector3,
} from "three/webgpu";
import { toScene } from "./coords.ts";
import { C } from "./keep.ts";
import { at, flatNormals, groundAO, linear, Mesher } from "./mesher.ts";
import { fbm } from "./noise.ts";
import { occlusionMask } from "./occlusion.ts";
import { rng } from "./physics.ts";
import { dither } from "./sky.ts";

/*
 * What's far away: three ranges of faceted lavender mountains, each hazier than
 * the one before; low-poly clouds drifting across the sky, lit warm on the sun's
 * side and lavender underneath; wind turbines turning on the far ridges and the
 * white domes of research stations at the horizon. All of it rides with the
 * camera (it's always at the horizon). And a few landmarks standing in the world
 * itself: a research station of domes, solar panels and wind turbines, and a
 * cream limestone cliff with an arch. All procedural.
 */

interface Range {
  r: number;
  base: number;
  top: number;
  /** sRGB: the foot, the slopes, the peaks. */
  colors: [number, number, number];
  seed: number;
  /** How much of the haze it wears (0 clear, 1 gone). */
  haze: number;
  n: number;
}

const RANGES: Range[] = [
  { r: 1120, base: 60, top: 250, colors: [0xb6a8e0, 0xc9bdea, 0xf2e2f0], seed: 3, haze: 0.5, n: 110 },
  { r: 860, base: 30, top: 170, colors: [0x9f8fd0, 0xb3a3dc, 0xe6d2ea], seed: 9, haze: 0.32, n: 100 },
  { r: 620, base: 8, top: 80, colors: [0x8f98c8, 0xa1a8d4, 0xc4c2e2], seed: 17, haze: 0.18, n: 90 },
];

/** A ring of faceted peaks facing the centre, with its haze amount in the `haze` attribute. */
function mountainRanges(): BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const haze: number[] = [];
  for (const row of RANGES) {
    const n = row.n;
    const peak = (i: number) => {
      const a = (i / n) * Math.PI * 2;
      const h = 0.5 + 0.5 * fbm(row.seed, Math.cos(a) * 3, Math.sin(a) * 3, 4);
      return row.base + (row.top - row.base) * h * h + (i % 2 ? 0 : row.top * 0.08);
    };
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      const h0 = peak(i);
      const h1 = peak(i + 1);
      const p = (a: number, h: number, r: number) => [Math.cos(a) * r, h, Math.sin(a) * r];
      // Each span is a ridge: two faces meeting at a crest pushed out towards the centre, so the facets catch the light.
      const b0 = p(a0, -40, row.r + 40);
      const b1 = p(a1, -40, row.r + 40);
      const t0 = p(a0, h0, row.r);
      const t1 = p(a1, h1, row.r);
      const mid = p(am, (h0 + h1) * 0.42, row.r - 30);
      const bm = p(am, -40, row.r - 10);
      const tris = [b0, mid, t0, t0, mid, t1, mid, b1, t1, b0, bm, mid, bm, b1, mid];
      for (let k = 0; k < tris.length; k++) {
        pos.push(...tris[k]!);
        const h = tris[k]![1]!;
        const t = Math.max(0, Math.min(1, h / row.top));
        const c = t > 0.78 ? row.colors[2] : t > 0.3 ? row.colors[1] : row.colors[0];
        const [r, g, b] = linear(c);
        col.push(r, g, b);
        haze.push(row.haze);
      }
    }
  }
  const g = new Mesher().build();
  const positions = new Float32Array(pos);
  g.setAttribute("position", new BufferAttribute(positions, 3));
  g.setAttribute("normal", new BufferAttribute(flatNormals(positions), 3));
  g.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
  g.setAttribute("haze", new BufferAttribute(new Float32Array(haze), 1));
  return g;
}

/** Puffy low-poly clouds: flat-bottomed heaps of facets, in two rings (the nearer lower). */
function clouds(seed: number): BufferGeometry {
  const m = new Mesher();
  const random = rng(seed);
  for (let ring = 0; ring < 2; ring++) {
    const count = ring ? 9 : 12;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + random() * 0.4 + ring * 0.3;
      const r = ring ? 640 + random() * 140 : 380 + random() * 140;
      const y = ring ? 200 + random() * 70 : 120 + random() * 60;
      const cx = Math.cos(a) * r;
      const cz = Math.sin(a) * r;
      const size = (ring ? 22 : 16) * (0.8 + random() * 0.5);
      const puffs = 5 + Math.floor(random() * 4);
      // Tangent to the ring, so each heap shows its length to the camera.
      const tx = -Math.sin(a);
      const tz = Math.cos(a);
      for (let k = 0; k < puffs; k++) {
        const along = (k - (puffs - 1) / 2) * size * 0.85;
        const s = size * (1 - Math.abs(k - (puffs - 1) / 2) / puffs) * (0.75 + random() * 0.4);
        const lift = s * 0.32;
        m.add(new IcosahedronGeometry(s, 0), 0xffffff, at(cx + tx * along, y + lift, cz + tz * along + (random() - 0.5) * size * 0.4, random() * 3, [1.25, 0.62, 1]), 0.04);
      }
      // A flat base slab, so the heap sits on one level like the references' clouds.
      m.add(new CylinderGeometry(size * 1.9, size * 1.6, size * 0.35, 9), 0xffffff, at(cx, y, cz, a, [1.4, 1, 0.55]), 0.03);
    }
  }
  return m.build();
}

/** Distant wind turbines (towers and nacelles) and research domes along the horizon. */
function horizonSettlements(): { solid: BufferGeometry; blades: BufferGeometry } {
  const m = new Mesher();
  const bladePos: number[] = [];
  const bladeHub: number[] = [];
  const random = rng(31);
  const blade = new Mesher();
  for (let i = 0; i < 3; i++) blade.add(new BoxGeometry(1.6, 26, 0.4), 0xf6f3ec, at(0, 0, 0, 0, 1, 0, (i * Math.PI * 2) / 3).multiply(at(0, 13.5, 0)), 0);
  blade.add(new IcosahedronGeometry(1.6, 0), C.cream, at(0, 0, 0.8), 0);
  const one = blade.build();
  const bp = one.getAttribute("position");
  const turbine = (a: number, r: number, base: number) => {
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    m.add(new CylinderGeometry(0.9, 1.6, 52, 6), 0xf6f3ec, at(x, base + 26, z), 0);
    m.add(new BoxGeometry(2.4, 2.4, 6), C.cream, at(x, base + 52.5, z, -a + Math.PI / 2), 0);
    // The rotor faces the centre (the camera): its hub sits on the nacelle's inner side.
    const hx = x - Math.cos(a) * 3.4;
    const hz = z - Math.sin(a) * 3.4;
    const yaw = -a - Math.PI / 2;
    for (let v = 0; v < bp.count; v++) {
      const lx = bp.getX(v);
      const ly = bp.getY(v);
      const lz = bp.getZ(v);
      bladePos.push(hx + Math.cos(yaw) * lx + Math.sin(yaw) * lz, base + 52.5 + ly, hz - Math.sin(yaw) * lx + Math.cos(yaw) * lz);
      bladeHub.push(hx, base + 52.5, hz, random() * 6.28, Math.cos(yaw), -Math.sin(yaw));
    }
  };
  // A wind farm on the near range's ridges, and one on the far side.
  for (let i = 0; i < 6; i++) turbine(0.5 + i * 0.07 + random() * 0.03, 600 + random() * 30, 18 + random() * 20);
  for (let i = 0; i < 4; i++) turbine(3.7 + i * 0.08, 610 + random() * 30, 16 + random() * 16);
  // Domes at the horizon (they sit low, in the haze).
  for (const [a, r, size] of [[1.2, 560, 11], [1.24, 575, 8], [1.17, 570, 6], [4.4, 580, 10], [4.45, 590, 7]] as const) {
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    m.add(new SphereGeometry(size, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2), 0xf8f6f1, at(x, -2, z), 0);
    m.add(new CylinderGeometry(size * 1.02, size * 1.02, size * 0.12, 12), C.orange, at(x, size * 0.1 - 2, z), 0);
  }
  one.dispose();
  const blades = new Mesher().build();
  const positions = new Float32Array(bladePos);
  blades.setAttribute("position", new BufferAttribute(positions, 3));
  blades.setAttribute("normal", new BufferAttribute(flatNormals(positions), 3));
  const hub = new Float32Array(bladeHub);
  // hub.xyz, phase; the rotor's axis (x, z) in the plane.
  const hubXYZ = new Float32Array((hub.length / 6) * 4);
  const axis = new Float32Array((hub.length / 6) * 2);
  for (let i = 0; i < hub.length / 6; i++) {
    hubXYZ.set([hub[i * 6]!, hub[i * 6 + 1]!, hub[i * 6 + 2]!, hub[i * 6 + 3]!], i * 4);
    axis.set([hub[i * 6 + 4]!, hub[i * 6 + 5]!], i * 2);
  }
  blades.setAttribute("hub", new BufferAttribute(hubXYZ, 4));
  blades.setAttribute("axis", new BufferAttribute(axis, 2));
  return { solid: m.build(), blades };
}

export class Horizon {
  readonly group = new Group();
  private readonly cloudGroup = new Group();
  private readonly tint = uniform(new Color(1, 1, 1));
  private readonly haze = uniform(new Color(0xe4d4f0));
  private readonly hazeBoost = uniform(0);
  private readonly cloudLit = uniform(new Color(1, 1, 1));
  private readonly cloudShade = uniform(new Color(0xd8d0f0));
  private readonly sunDir = uniform(new Vector3(0, 1, 0));
  private readonly spin = uniform(1);
  private readonly materials: MeshBasicNodeMaterial[] = [];
  private readonly scratch = new Color();
  private readonly scratch2 = new Color();

  constructor() {
    // Mountains: lit by the sun on their facets, and hazier the farther the range (its feet always in the haze).
    const mountains = new MeshBasicNodeMaterial({ vertexColors: true });
    mountains.fog = false;
    const lit = float(0.8).add(max(dot(normalWorld, this.sunDir), 0).mul(0.32));
    const feet = float(1).sub(smoothstep(-30, 70, positionLocal.y));
    const amount = max(attribute("haze", "float").add(this.hazeBoost), feet).min(1);
    mountains.colorNode = mix(vertexColor().mul(this.tint).mul(lit), this.haze, amount).add(dither());
    const ring = new Mesh(mountainRanges(), mountains);
    ring.renderOrder = -5;
    ring.frustumCulled = false;

    // Clouds: the sun's side warm and bright, the underside lavender.
    const cloud = new MeshBasicNodeMaterial({ vertexColors: true, transparent: true, opacity: 0.96, depthWrite: false });
    cloud.fog = false;
    const side = max(dot(normalWorld, this.sunDir), 0);
    const top = normalWorld.y.mul(0.5).add(0.5);
    cloud.colorNode = mix(this.cloudShade, this.cloudLit, side.mul(0.55).add(top.mul(0.45)).min(1)).mul(vertexColor());
    const puffs = new Mesh(clouds(5), cloud);
    puffs.renderOrder = -6;
    puffs.frustumCulled = false;
    this.cloudGroup.add(puffs);

    // The far settlements: as hazy as the near range.
    const { solid, blades } = horizonSettlements();
    const far = new MeshBasicNodeMaterial({ vertexColors: true });
    far.fog = false;
    far.colorNode = mix(vertexColor().mul(this.tint).mul(lit), this.haze, float(0.3).add(this.hazeBoost).add(feet.mul(0.4)).min(1));
    const settlements = new Mesh(solid, far);
    settlements.renderOrder = -4;
    settlements.frustumCulled = false;
    // Blades turn round their hub, in the vertex shader (one draw call for every rotor).
    const rotor = new MeshBasicNodeMaterial({ color: 0xf6f3ec });
    rotor.fog = false;
    const hub = attribute("hub", "vec4");
    const axis = attribute("axis", "vec2");
    const angle = time.mul(0.8).mul(this.spin).add(hub.w);
    const rel = positionLocal.sub(hub.xyz);
    // Rotate about the horizontal axis (axis.x, 0, axis.y): split into along-axis and in-plane parts.
    const ax = vec3(axis.x, 0, axis.y);
    const along = ax.mul(dot(rel, ax));
    const inPlane = rel.sub(along);
    const crossed = vec3(ax.y.mul(inPlane.z).sub(ax.z.mul(inPlane.y)), ax.z.mul(inPlane.x).sub(ax.x.mul(inPlane.z)), ax.x.mul(inPlane.y).sub(ax.y.mul(inPlane.x)));
    rotor.positionNode = hub.xyz.add(along).add(inPlane.mul(cos(angle))).add(crossed.mul(sin(angle)));
    rotor.colorNode = mix(vec3(0.92, 0.9, 0.86).mul(this.tint), this.haze, float(0.32).add(this.hazeBoost).min(1));
    const rotors = new Mesh(blades, rotor);
    rotors.renderOrder = -4;
    rotors.frustumCulled = false;
    this.materials.push(mountains, cloud, far, rotor);
    this.group.add(ring, this.cloudGroup, settlements, rotors);
  }

  /** Light on the far hills and the clouds for the time of day: `light` tints, `horizon` is the haze; `overcast` greys and darkens the clouds. */
  set(light: number, horizon: number, night: number, sun: readonly [number, number, number], glow: number, golden: number, overcast = 0): void {
    const l = this.scratch.setHex(light);
    this.tint.value.setRGB(1, 1, 1).lerp(l, 0.3).multiplyScalar(1 - night * 0.72);
    this.haze.value.setHex(horizon).multiplyScalar(0.8);
    this.hazeBoost.value = night * 0.18;
    this.sunDir.value.set(sun[0], Math.max(0.05, sun[2]), -sun[1]).normalize();
    // Clouds: lit in the sun's colour (peach at golden hour), shaded lavender, all dim at night.
    const g = this.scratch2.setHex(glow);
    this.cloudLit.value.setRGB(1, 1, 1).lerp(l, 0.35 + golden * 0.25).lerp(g, golden * 0.3).multiplyScalar(1 - night * 0.78);
    this.cloudShade.value.setHex(0xcfc6ee).lerp(this.haze.value, 0.35).multiplyScalar(1 - night * 0.7);
    if (overcast > 0) {
      this.cloudLit.value.lerp(this.haze.value, overcast * 0.6).multiplyScalar(1 - overcast * 0.25);
      this.cloudShade.value.lerp(this.haze.value, overcast * 0.4).multiplyScalar(1 - overcast * 0.35);
      this.hazeBoost.value += overcast * 0.2;
    }
  }

  /** Rides with the camera; clouds drift; rotors turn (not under reduced motion). */
  follow(camera: Vector3, t: number, motion: boolean): void {
    this.group.position.set(camera.x, 0, camera.z);
    this.spin.value = motion ? 1 : 0;
    if (motion) this.cloudGroup.rotation.y = t * 0.0035;
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof Mesh) o.geometry.dispose();
    });
    for (const m of this.materials) m.dispose();
  }
}

/** A wind turbine's blades: three, round a hub, turning about the scene's z axis of their group. */
function blades(): BufferGeometry {
  const m = new Mesher().add(new IcosahedronGeometry(0.7, 0), C.cream, at(0, 0, 0.3), 0);
  for (let i = 0; i < 3; i++) m.add(new BoxGeometry(0.5, 11, 0.12), 0xf4f1ea, at(0, 0, 0, 0, 1, 0, (i * Math.PI * 2) / 3).multiply(at(0, 5.6, 0)), 0.02);
  return m.build();
}

export interface Landmark {
  x: number;
  y: number;
}

/** The research station (domes, solar panels, turbines) and the limestone arch: real places in the world. */
export class Landmarks {
  readonly group = new Group();
  private readonly material = new MeshLambertNodeMaterial({ vertexColors: true });
  private readonly rotors: Group[] = [];
  static readonly STATION: Landmark = { x: 150, y: 215 };
  static readonly ARCH: Landmark = { x: -205, y: 150 };
  /** Lit windows of the station (scene coordinates, radius), for the night glows. */
  readonly windows: [number, number, number, number][] = [];

  constructor(height: (x: number, y: number) => number, shadows: boolean) {
    this.material.maskNode = occlusionMask();
    const m = new Mesher();
    const ground = (x: number, y: number) => Math.max(height(x, y), -1.2);
    const put = (x: number, y: number, dy = 0): [number, number, number] => {
      const [sx, , sz] = toScene(x, y);
      return [sx, ground(x, y) + dy, sz];
    };
    // The research station: three domes, a low hall, rows of solar panels.
    const S = Landmarks.STATION;
    for (const [dx, dy, r] of [[0, 0, 7], [11, 4, 4.6], [-9, 5, 4]] as const) {
      const [x, y, z] = put(S.x + dx, S.y + dy, -0.3);
      m.add(new SphereGeometry(r, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0xf6f4ef, at(x, y, z), 0.03);
      m.add(new CylinderGeometry(r * 1.01, r * 1.01, 0.5, 14), C.orange, at(x, y + 0.6, z), 0);
      m.add(new CylinderGeometry(r * 1.04, r * 1.04, 0.5, 14), C.greyLight, at(x, y, z), 0);
      this.windows.push([x, y + r * 0.45, z, r * 0.9]);
    }
    {
      const [x, y, z] = put(S.x + 2, S.y - 9, 0);
      m.add(new BoxGeometry(16, 3, 5), C.cream, at(x, y + 1.5, z), 0.03);
      m.add(new BoxGeometry(16.4, 0.3, 5.4), C.greyLight, at(x, y + 3.1, z), 0);
      m.add(new BoxGeometry(16.1, 0.4, 5.1), C.orange, at(x, y + 2.4, z), 0);
      for (let i = 0; i < 5; i++) this.windows.push([x - 6 + i * 3, y + 1.6, z + 2.6, 1.6]);
    }
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 5; col++) {
        const [x, y, z] = put(S.x - 22 + col * 4.2, S.y - 16 - row * 4, 0);
        m.add(new BoxGeometry(3.6, 0.1, 2.2), C.solar, at(x, y + 1.3, z, 0, 1, -0.5), 0.02);
        m.add(new BoxGeometry(0.12, 1.3, 0.12), C.greyLight, at(x, y + 0.65, z), 0);
      }
    }
    // Wind turbines on the rise beyond the domes.
    const rotorGeometry = blades();
    for (const [dx, dy] of [[28, 22], [44, 6], [16, 40]] as const) {
      const [x, y, z] = put(S.x + dx, S.y + dy, 0);
      m.add(new CylinderGeometry(0.45, 0.8, 22, 8), 0xf4f1ea, at(x, y + 11, z), 0.02);
      m.add(new BoxGeometry(1.2, 1.2, 3), C.cream, at(x, y + 22.4, z), 0.02);
      m.add(new BoxGeometry(1.22, 0.3, 1), C.orange, at(x, y + 22.4, z + 0.6), 0);
      const rotor = new Group();
      rotor.position.set(x, y + 22.4, z + 1.8);
      const mesh = new Mesh(rotorGeometry, this.material);
      rotor.add(mesh);
      this.rotors.push(rotor);
      this.group.add(rotor);
    }
    // The limestone cliff with its arch.
    const A = Landmarks.ARCH;
    const random = rng(41);
    for (let i = 0; i < 16; i++) {
      const dx = (random() - 0.5) * 50;
      const dy = (random() - 0.5) * 22 - 10;
      const r = 6 + random() * 7;
      const [x, y, z] = put(A.x + dx, A.y + dy, r * 0.25);
      m.add(new DodecahedronGeometry(r, 0), random() < 0.5 ? C.limestone : 0xdfd1b8, at(x, y, z, random() * 3, [1.3, 1 + random() * 0.6, 1]), 0.06);
    }
    {
      const [x, y, z] = put(A.x, A.y + 12, 0);
      const span = 16;
      const n = 9;
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI;
        m.add(new BoxGeometry(4.2, 4.2, 5), i % 2 ? C.limestone : 0xe2d5bd, at(x + Math.cos(a) * span * 0.5, y + Math.sin(a) * 14, z, 0, 1, 0, a - Math.PI / 2), 0.06);
      }
      for (const side of [-1, 1]) m.add(new BoxGeometry(5, 6, 6), C.limestone, at(x + side * span * 0.5, y + 1.5, z), 0.06);
    }
    const mesh = new Mesh(m.build({ ao: groundAO(0.62, 2.5, 0.74, -1.2) }), this.material);
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
    this.group.add(mesh);
  }

  /** Turbines turn (slowly, and not at all under reduced motion). */
  animate(t: number, motion: boolean): void {
    if (!motion) return;
    for (let i = 0; i < this.rotors.length; i++) this.rotors[i]!.rotation.z = t * (0.7 + i * 0.13) + i;
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof Mesh) o.geometry.dispose();
    });
    this.material.dispose();
  }
}
