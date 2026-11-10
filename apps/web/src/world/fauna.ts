import { abs, cos, float, instanceIndex, positionGeometry, positionLocal, sin, time, uniform, vec3 } from "three/tsl";
import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  ConeGeometry,
  DynamicDrawUsage,
  type Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshBasicNodeMaterial,
  MeshLambertNodeMaterial,
  OctahedronGeometry,
  Quaternion,
  TetrahedronGeometry,
  Vector3,
} from "three/webgpu";
import { headingToSceneYaw } from "./coords.ts";
import { at, Mesher } from "./mesher.ts";
import { Boids, type Ground, MAX_SLOPE, moveOnGround, Particles, rng } from "./physics.ts";
import { WATER_LEVEL } from "./terrain.ts";
import type { Tier } from "./tiers.ts";

/*
 * Life around the keep: a flock of birds (boids, on the CPU: a few dozen birds
 * cost less than a compute pass), deer and rabbits that wander and graze,
 * steering round water, steep ground, the keep's lawn and the plots, ducks on the
 * lakes, fireflies at dusk, and sparks and exhaust as ballistic particles. Each
 * kind is one instanced mesh; the CPU writes matrices into pooled objects, nothing
 * is allocated per frame. All of it is procedural.
 */

const m = new Matrix4();
const q = new Quaternion();
const v = new Vector3();
const s = new Vector3();
const UP = new Vector3(0, 1, 0);

function instanced(geometry: BufferGeometry, material: MeshLambertNodeMaterial | MeshBasicNodeMaterial, count: number, root: Group): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, Math.max(1, count));
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.count = 0;
  mesh.frustumCulled = false;
  root.add(mesh);
  return mesh;
}

/** A bird: a body and two wings that flap in the vertex shader (span along local x). */
function birdGeometry(): BufferGeometry {
  const g = new Mesher().add(new BoxGeometry(0.1, 0.08, 0.34), 0x5d6577, at(0, 0, 0)).add(new ConeGeometry(0.05, 0.1, 4), 0xf0b35a, at(0, 0, 0.22, 0, 1, Math.PI / 2), 0);
  // Wings: two flat triangles each side.
  g.triangles([0.04, 0, 0.1, 0.55, 0, -0.05, 0.04, 0, -0.1, 0.04, 0, -0.1, 0.55, 0, -0.05, 0.04, 0, 0.1], 0x7c879c);
  g.triangles([-0.04, 0, 0.1, -0.04, 0, -0.1, -0.55, 0, -0.05, -0.04, 0, -0.1, -0.04, 0, 0.1, -0.55, 0, -0.05], 0x7c879c);
  return g.build();
}

const deerGeometry = (): BufferGeometry =>
  new Mesher()
    .add(new BoxGeometry(0.42, 0.42, 1.05), 0xc58a5a, at(0, 0.95, 0))
    .add(new BoxGeometry(0.2, 0.42, 0.22), 0xc58a5a, at(0, 1.3, 0.48, 0, 1, -0.35))
    .add(new BoxGeometry(0.22, 0.22, 0.34), 0xcf9666, at(0, 1.55, 0.62))
    .add(new BoxGeometry(0.08, 0.08, 0.08), 0x2d2a28, at(0, 1.55, 0.8), 0)
    .add(new ConeGeometry(0.05, 0.32, 3), 0xe9dcc4, at(0.1, 1.82, 0.58, 0, 1, -0.2, 0.3), 0)
    .add(new ConeGeometry(0.05, 0.32, 3), 0xe9dcc4, at(-0.1, 1.82, 0.58, 0, 1, -0.2, -0.3), 0)
    .add(new BoxGeometry(0.1, 0.78, 0.1), 0xa87048, at(0.14, 0.39, 0.38))
    .add(new BoxGeometry(0.1, 0.78, 0.1), 0xa87048, at(-0.14, 0.39, 0.38))
    .add(new BoxGeometry(0.1, 0.78, 0.1), 0xa87048, at(0.14, 0.39, -0.38))
    .add(new BoxGeometry(0.1, 0.78, 0.1), 0xa87048, at(-0.14, 0.39, -0.38))
    .add(new BoxGeometry(0.16, 0.14, 0.1), 0xf3ead8, at(0, 1.06, -0.55), 0)
    .build();

const rabbitGeometry = (): BufferGeometry =>
  new Mesher()
    .add(new IcosahedronGeometry(0.17, 0), 0xb9ab9a, at(0, 0.17, 0, 0, [1, 0.9, 1.3]))
    .add(new IcosahedronGeometry(0.11, 0), 0xc4b6a4, at(0, 0.3, 0.17))
    .add(new BoxGeometry(0.04, 0.2, 0.05), 0xc4b6a4, at(0.04, 0.46, 0.14, 0, 1, -0.2), 0)
    .add(new BoxGeometry(0.04, 0.2, 0.05), 0xc4b6a4, at(-0.04, 0.46, 0.14, 0, 1, -0.2), 0)
    .add(new IcosahedronGeometry(0.05, 0), 0xf6f1ea, at(0, 0.2, -0.22), 0)
    .build();

const duckGeometry = (): BufferGeometry =>
  new Mesher()
    .add(new IcosahedronGeometry(0.17, 0), 0xf1ede2, at(0, 0.08, 0, 0, [1, 0.7, 1.45]))
    .add(new IcosahedronGeometry(0.1, 0), 0x3f8a5c, at(0, 0.24, 0.18))
    .add(new ConeGeometry(0.035, 0.09, 4), 0xf2a93b, at(0, 0.23, 0.3, 0, 1, Math.PI / 2), 0)
    .build();

interface Herd {
  mesh: InstancedMesh;
  x: Float64Array;
  y: Float64Array;
  heading: Float64Array;
  /** Seconds left in the current state; state 0 grazes, 1 walks. */
  timer: Float32Array;
  state: Uint8Array;
  phase: Float32Array;
  active: Uint8Array;
  speed: number;
  hop: number;
  water: boolean;
}

export class Fauna {
  private readonly birds: Boids;
  private readonly birdMesh: InstancedMesh;
  private readonly herds: Herd[];
  private readonly fireflies: InstancedMesh;
  private readonly fireflyOpacity = uniform(0);
  private readonly fireflyAnchors: Float64Array;
  private fireflyCentre = { x: Number.NaN, y: Number.NaN };
  readonly particles: Particles;
  private readonly sparks: InstancedMesh;
  private readonly random = rng(23);
  private readonly scratch = { x: 0, y: 0 };
  private readonly materials: (MeshLambertNodeMaterial | MeshBasicNodeMaterial)[] = [];
  private readonly flap = uniform(1);
  /** Ducks keep to the water. */
  private readonly water: Ground = { height: (x, y) => this.ground.height(x, y), blocked: (x, y) => this.ground.height(x, y) > WATER_LEVEL - 0.3 };

  constructor(
    root: Group,
    tier: Tier,
    private readonly ground: Ground,
  ) {
    this.birds = new Boids(tier.birds, 5);
    const birdMaterial = new MeshLambertNodeMaterial({ vertexColors: true });
    const i = float(instanceIndex);
    birdMaterial.positionNode = positionLocal.add(vec3(0, abs(positionGeometry.x).mul(sin(time.mul(13).add(i.mul(1.7)))).mul(0.55).mul(this.flap), 0));
    this.birdMesh = instanced(birdGeometry(), birdMaterial, tier.birds, root);

    const animal = new MeshLambertNodeMaterial({ vertexColors: true });
    const herd = (geometry: BufferGeometry, n: number, speed: number, hop: number, water: boolean): Herd => ({
      mesh: instanced(geometry, animal, n, root),
      x: new Float64Array(n),
      y: new Float64Array(n),
      heading: new Float64Array(n),
      timer: new Float32Array(n),
      state: new Uint8Array(n),
      phase: new Float32Array(n),
      active: new Uint8Array(n),
      speed,
      hop,
      water,
    });
    this.herds = [herd(deerGeometry(), tier.deer, 1.3, 0.03, false), herd(rabbitGeometry(), tier.rabbits, 2.6, 0.22, false), herd(duckGeometry(), tier.ducks, 0.5, 0, true)];

    const glow = new MeshBasicNodeMaterial({ color: 0xe8ff8a, transparent: true, depthWrite: false, blending: AdditiveBlending });
    glow.fog = false;
    glow.opacityNode = this.fireflyOpacity.mul(sin(time.mul(3.1).add(i.mul(5.3))).mul(0.45).add(0.55));
    glow.positionNode = positionLocal.add(vec3(sin(time.mul(0.7).add(i.mul(1.7))), sin(time.mul(1.3).add(i.mul(2.1))).mul(0.4), cos(time.mul(0.6).add(i.mul(1.1)))).mul(1.3));
    this.fireflies = instanced(new OctahedronGeometry(0.06, 0), glow, tier.fireflies, root);
    this.fireflyAnchors = new Float64Array(tier.fireflies * 2);

    this.particles = new Particles(tier.particles);
    const spark = new MeshBasicNodeMaterial({ color: 0xffb056, transparent: true, depthWrite: false, blending: AdditiveBlending });
    this.sparks = instanced(new TetrahedronGeometry(0.07, 0), spark, tier.particles, root);
    this.materials.push(birdMaterial, animal, glow, spark);
  }

  /**
   * Steps every creature and writes their matrices (relative to the floating
   * origin). `focus` is where the camera looks; things too far from it come back
   * near it. Returns true when anything is visible and moving.
   */
  step(dt: number, focusX: number, focusY: number, origin: [number, number], night: number, dusk: number, motion: boolean): boolean {
    const ground = this.ground;
    if (!motion) {
      this.flap.value = 0;
      this.birdMesh.visible = false;
      this.fireflies.visible = false;
      for (const h of this.herds) h.mesh.visible = false;
      this.sparks.visible = false;
      return false;
    }
    this.flap.value = 1;
    this.stepBirds(dt, focusX, focusY, origin, night);
    for (const herd of this.herds) this.stepHerd(herd, dt, focusX, focusY, origin, ground, night);
    this.stepFireflies(focusX, focusY, origin, ground, dusk);
    this.stepParticles(dt, origin);
    return true;
  }

  private stepBirds(dt: number, fx: number, fy: number, origin: [number, number], night: number): void {
    const b = this.birds;
    if (!b.count) return;
    // Far from the flock's home (the camera flew off): bring them along.
    const hx = fx + 30;
    const hy = fy + 20;
    if (Math.hypot(hx - b.home.x, hy - b.home.y) > 250) b.shift(hx - b.home.x, hy - b.home.y);
    b.home.x = hx;
    b.home.y = hy;
    b.home.z = 26;
    b.step(dt);
    const mesh = this.birdMesh;
    mesh.visible = night < 0.6;
    for (let i = 0; i < b.count; i++) {
      const k = i * 3;
      const vx = b.vel[k]!;
      const vy = b.vel[k + 1]!;
      v.set(b.pos[k]! - origin[0], b.pos[k + 2]!, -(b.pos[k + 1]! - origin[1]));
      q.setFromAxisAngle(UP, headingToSceneYaw(Math.atan2(vy, vx)));
      s.setScalar(1.2);
      m.compose(v, q, s);
      mesh.setMatrixAt(i, m);
    }
    mesh.count = b.count;
    mesh.instanceMatrix.needsUpdate = true;
  }

  private landOk(herd: Herd, ground: Ground, x: number, y: number): boolean {
    const h = ground.height(x, y);
    return herd.water ? h < WATER_LEVEL - 0.3 : !ground.blocked(x, y) && h > WATER_LEVEL + 0.3;
  }

  private stepHerd(herd: Herd, dt: number, fx: number, fy: number, origin: [number, number], ground: Ground, night: number): void {
    const n = herd.x.length;
    const reach = herd.water ? 160 : 120;
    let shown = 0;
    // Water birds keep to the water; land animals to the land (the ground's `blocked`).
    const where = herd.water ? this.water : ground;
    for (let i = 0; i < n; i++) {
      if (herd.active[i] && Math.hypot(herd.x[i]! - fx, herd.y[i]! - fy) > reach * 1.3) herd.active[i] = 0;
      if (!herd.active[i]) {
        // Try a few spots near the focus; come back next frame if none suits.
        for (let tries = 0; tries < 4; tries++) {
          const a = this.random() * Math.PI * 2;
          const r = 25 + this.random() * (reach - 25);
          const x = fx + Math.cos(a) * r;
          const y = fy + Math.sin(a) * r;
          if (!this.landOk(herd, ground, x, y)) continue;
          herd.x[i] = x;
          herd.y[i] = y;
          herd.heading[i] = this.random() * Math.PI * 2;
          herd.timer[i] = 1 + this.random() * 4;
          herd.state[i] = 0;
          herd.active[i] = 1;
          break;
        }
        if (!herd.active[i]) continue;
      }
      herd.timer[i] = herd.timer[i]! - dt;
      if (herd.timer[i]! <= 0) {
        // Rabbits and deer rest more at night.
        herd.state[i] = this.random() < (night > 0.5 ? 0.25 : 0.55) ? 1 : 0;
        herd.timer[i] = herd.state[i] ? 2 + this.random() * 4 : 3 + this.random() * 6;
      }
      let moving = false;
      if (herd.state[i]) {
        herd.heading[i] = herd.heading[i]! + (this.random() - 0.5) * 1.6 * dt;
        const taken = moveOnGround(where, herd.x[i]!, herd.y[i]!, herd.heading[i]!, herd.speed * dt, this.scratch, herd.water ? Infinity : MAX_SLOPE);
        if (taken === null) {
          herd.heading[i] = herd.heading[i]! + Math.PI * (0.5 + this.random());
        } else {
          herd.heading[i] = taken;
          herd.x[i] = this.scratch.x;
          herd.y[i] = this.scratch.y;
          moving = true;
        }
      }
      herd.phase[i] = herd.phase[i]! + dt * (moving ? 9 : 1.5);
      const z = herd.water ? WATER_LEVEL + 0.02 * Math.sin(herd.phase[i]!) : ground.height(herd.x[i]!, herd.y[i]!);
      const bob = moving ? Math.abs(Math.sin(herd.phase[i]!)) * herd.hop : 0;
      v.set(herd.x[i]! - origin[0], z + bob, -(herd.y[i]! - origin[1]));
      q.setFromAxisAngle(UP, headingToSceneYaw(herd.heading[i]!));
      s.setScalar(1);
      m.compose(v, q, s);
      herd.mesh.setMatrixAt(shown++, m);
    }
    herd.mesh.count = shown;
    herd.mesh.visible = shown > 0;
    herd.mesh.instanceMatrix.needsUpdate = true;
  }

  private stepFireflies(fx: number, fy: number, origin: [number, number], ground: Ground, dusk: number): void {
    const n = this.fireflyAnchors.length / 2;
    this.fireflyOpacity.value = dusk;
    this.fireflies.visible = dusk > 0.02 && n > 0;
    if (!this.fireflies.visible) return;
    const c = this.fireflyCentre;
    const moved = !(Math.hypot(fx - c.x, fy - c.y) < 40);
    if (moved) {
      c.x = fx;
      c.y = fy;
      for (let i = 0; i < n; i++) {
        const a = this.random() * Math.PI * 2;
        const r = 6 + this.random() * 40;
        this.fireflyAnchors[i * 2] = fx + Math.cos(a) * r;
        this.fireflyAnchors[i * 2 + 1] = fy + Math.sin(a) * r;
      }
    }
    for (let i = 0; i < n; i++) {
      const x = this.fireflyAnchors[i * 2]!;
      const y = this.fireflyAnchors[i * 2 + 1]!;
      v.set(x - origin[0], Math.max(ground.height(x, y), WATER_LEVEL) + 0.8 + (i % 5) * 0.25, -(y - origin[1]));
      m.makeTranslation(v.x, v.y, v.z);
      this.fireflies.setMatrixAt(i, m);
    }
    this.fireflies.count = n;
    this.fireflies.instanceMatrix.needsUpdate = true;
  }

  private stepParticles(dt: number, origin: [number, number]): void {
    const p = this.particles;
    p.step(dt);
    let shown = 0;
    for (let i = 0; i < p.capacity; i++) {
      const life = p.life[i]!;
      if (life <= 0) continue;
      const k = i * 3;
      v.set(p.pos[k]! - origin[0], p.pos[k + 2]!, -(p.pos[k + 1]! - origin[1]));
      q.identity();
      s.setScalar(0.4 + 0.8 * (life / p.maxLife[i]!));
      m.compose(v, q, s);
      this.sparks.setMatrixAt(shown++, m);
    }
    this.sparks.count = shown;
    this.sparks.visible = shown > 0;
    this.sparks.instanceMatrix.needsUpdate = true;
  }

  /** Sparks from the forge's anvil (world coordinates). */
  sparksAt(x: number, y: number, z: number, n: number): void {
    for (let i = 0; i < n; i++) {
      const a = this.random() * Math.PI * 2;
      const up = 2.5 + this.random() * 2.5;
      const out = 0.6 + this.random() * 1.6;
      this.particles.emit(x, y, z, Math.cos(a) * out, Math.sin(a) * out, up, 0.5 + this.random() * 0.5);
    }
  }

  /** Exhaust from a rocket's tail (world coordinates), blown back along (dx, dy, dz). */
  exhaustAt(x: number, y: number, z: number, dx: number, dy: number, dz: number, speed: number): void {
    const jitter = speed * 0.25;
    this.particles.emit(x, y, z, dx * speed + (this.random() - 0.5) * jitter, dy * speed + (this.random() - 0.5) * jitter, dz * speed + (this.random() - 0.5) * jitter, 0.35 + this.random() * 0.4);
  }

  /** The instanced meshes sit at the floating origin (their instances are relative to it). */
  place(originScene: Vector3): void {
    for (const mesh of [this.birdMesh, this.fireflies, this.sparks, ...this.herds.map((h) => h.mesh)]) mesh.position.copy(originScene);
  }

  dispose(): void {
    for (const mesh of [this.birdMesh, this.fireflies, this.sparks, ...this.herds.map((h) => h.mesh)]) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      mesh.dispose();
    }
    for (const material of this.materials) material.dispose();
  }
}
