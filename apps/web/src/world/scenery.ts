import { float, max, mix, positionLocal, smoothstep, uniform, vertexColor } from "three/tsl";
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,

  CylinderGeometry,
  DodecahedronGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicNodeMaterial,
  MeshLambertMaterial,
  SphereGeometry,
  type Vector3,
} from "three/webgpu";
import { toScene } from "./coords.ts";
import { C } from "./keep.ts";
import { at, linear, Mesher } from "./mesher.ts";
import { fbm } from "./noise.ts";
import { rng } from "./physics.ts";

/*
 * What's far away: lavender mountain ranges on the horizon, hazy pink in the
 * distance, and soft low-poly clouds (both ride with the camera, so they're always
 * at the horizon); and a few landmarks standing in the world: a research station
 * of white domes, solar panels and wind turbines, and a cream limestone cliff with
 * an arch. All procedural.
 */

const MOUNTAIN_R = [980, 1150] as const;

function mountainRing(): BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const n = 120;
  const rows: { r: number; base: number; top: number; colors: [number, number, number]; seed: number }[] = [
    { r: MOUNTAIN_R[1], base: 50, top: 190, colors: [0xb9aade, 0xcdbfe9, 0xf0dcee], seed: 3 },
    { r: MOUNTAIN_R[0], base: 20, top: 120, colors: [0xa391cf, 0xb8a7dc, 0xe2cde6], seed: 9 },
  ];
  for (const row of rows) {
    const peak = (i: number) => {
      const a = (i / n) * Math.PI * 2;
      const h = 0.5 + 0.5 * fbm(row.seed, Math.cos(a) * 3, Math.sin(a) * 3, 4);
      return row.base + (row.top - row.base) * h * h + (i % 2 ? 0 : 18);
    };
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      const h0 = peak(i);
      const h1 = peak(i + 1);
      const p = (a: number, h: number, r: number) => [Math.cos(a) * r, h, Math.sin(a) * r];
      // Faces towards the centre (the camera).
      const b0 = p(a0, -40, row.r + 30);
      const b1 = p(a1, -40, row.r + 30);
      const t0 = p(a0, h0, row.r);
      const t1 = p(a1, h1, row.r);
      const tris = [b0, t1, t0, b0, b1, t1];
      for (let k = 0; k < tris.length; k++) {
        pos.push(...tris[k]!);
        const h = tris[k]![1]!;
        const t = Math.max(0, Math.min(1, h / row.top));
        const c = t > 0.8 ? row.colors[2] : t > 0.35 ? row.colors[1] : row.colors[0];
        const [r, g, b] = linear(c);
        const shade = 0.92 + 0.08 * Math.sin(i * 1.7 + k);
        col.push(r * shade, g * shade, b * shade);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
  return g;
}

function clouds(seed: number): BufferGeometry {
  const m = new Mesher();
  const random = rng(seed);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + random() * 0.4;
    const r = 480 + random() * 160;
    const y = 170 + random() * 110;
    const cx = Math.cos(a) * r;
    const cz = Math.sin(a) * r;
    const puffs = 4 + Math.floor(random() * 3);
    for (let k = 0; k < puffs; k++) {
      const s = 14 + random() * 16;
      m.add(new IcosahedronGeometry(s, 0), k % 2 ? 0xfbeef3 : 0xf3dbe6, at(cx + (k - puffs / 2) * s * 0.9, y + random() * 8, cz + (random() - 0.5) * 16, random() * 3, [1.4, 0.5, 1]), 0.05);
    }
  }
  return m.build();
}

export class Horizon {
  readonly group = new Group();
  private readonly cloudGroup = new Group();
  private readonly tint = uniform(new Color(1, 1, 1));
  private readonly haze = uniform(new Color(0xe4d4f0));
  private readonly hazeAmount = uniform(0.42);
  private readonly cloudTint = uniform(new Color(1, 1, 1));
  private readonly materials: MeshBasicNodeMaterial[] = [];
  private readonly scratch = new Color();

  constructor() {
    const mountains = new MeshBasicNodeMaterial({ vertexColors: true, side: DoubleSide });
    mountains.fog = false;
    // Their feet melt into the haze (the same colour as the fog), so the land's far edge never shows.
    const feet = float(1).sub(smoothstep(-30, 90, positionLocal.y));
    mountains.colorNode = mix(vertexColor().mul(this.tint), this.haze, max(this.hazeAmount, feet));
    const ring = new Mesh(mountainRing(), mountains);
    ring.renderOrder = -5;
    ring.frustumCulled = false;
    const cloud = new MeshBasicNodeMaterial({ vertexColors: true, transparent: true, opacity: 0.94, depthWrite: false });
    cloud.fog = false;
    cloud.colorNode = vertexColor().mul(this.cloudTint);
    const puffs = new Mesh(clouds(5), cloud);
    puffs.renderOrder = -6;
    puffs.frustumCulled = false;
    this.cloudGroup.add(puffs);
    this.materials.push(mountains, cloud);
    this.group.add(ring, this.cloudGroup);
  }

  /** Light on the far hills and the clouds for the time of day: `light` tints, `horizon` is the haze. */
  set(light: number, horizon: number, night: number): void {
    const l = this.scratch.setHex(light);
    this.tint.value.setRGB(1, 1, 1).lerp(l, 0.35).multiplyScalar(1 - night * 0.72);
    this.haze.value.setHex(horizon);
    this.hazeAmount.value = 0.4 + night * 0.2;
    this.cloudTint.value.setRGB(1, 1, 1).lerp(l, 0.45).multiplyScalar(1 - night * 0.75);
  }

  /** Rides with the camera; clouds drift. */
  follow(camera: Vector3, t: number, motion: boolean): void {
    this.group.position.set(camera.x, 0, camera.z);
    if (motion) this.cloudGroup.rotation.y = t * 0.004;
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
  private readonly material = new MeshLambertMaterial({ vertexColors: true });
  private readonly rotors: Group[] = [];
  static readonly STATION: Landmark = { x: 150, y: 215 };
  static readonly ARCH: Landmark = { x: -205, y: 150 };

  constructor(height: (x: number, y: number) => number, shadows: boolean) {
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
    }
    {
      const [x, y, z] = put(S.x + 2, S.y - 9, 0);
      m.add(new BoxGeometry(16, 3, 5), C.cream, at(x, y + 1.5, z), 0.03);
      m.add(new BoxGeometry(16.4, 0.3, 5.4), C.greyLight, at(x, y + 3.1, z), 0);
      m.add(new BoxGeometry(16.1, 0.4, 5.1), C.orange, at(x, y + 2.4, z), 0);
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
    const mesh = new Mesh(m.build(), this.material);
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

