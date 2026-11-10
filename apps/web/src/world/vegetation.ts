import { cos, positionGeometry, positionLocal, sin, time, uniform, vec3 } from "three/tsl";
import {
  BoxGeometry,
  type BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  DynamicDrawUsage,
  Frustum,
  type Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshLambertNodeMaterial,
  OctahedronGeometry,
  type PerspectiveCamera,
  Quaternion,
  Vector3,
  Box3,
} from "three/webgpu";
import type { Chunk, Land } from "./land.ts";
import { at, Mesher } from "./mesher.ts";
import { CHUNK, type Layer, STRIDE } from "./terrain.ts";
import type { Tier } from "./tiers.ts";

/*
 * Everything that grows: lime-crowned trees, bushes, daisies, lupines, lavender, grass tufts and pink-beige boulders, each kind
 * one instanced mesh (nine draw calls in all), swaying in the wind in the vertex
 * shader. Instances are refilled from the loaded chunks only when the set of
 * chunks in view changes: chunks outside the camera's frustum are culled, grass
 * and flowers only grow near the focus, the nearest chunks fill first, and every
 * kind stops at its tier's cap.
 */

interface Kind {
  layer: Layer;
  /** For layers with several models: which `kind` value this mesh draws (−1: all). */
  kind: number;
  mesh: InstancedMesh;
  cap: number;
  /** Instance tints by placement kind. */
  tints: Color[];
}

/** The wind's strength: 0 under reduced motion. */
export const wind = uniform(1);

/** Sways a model in the wind: more at the top (by its own height), in waves across the land. */
export function swaying(stiffness: number) {
  const phase = positionLocal.x.mul(0.21).add(positionLocal.z.mul(0.17));
  const bend = positionGeometry.y.mul(positionGeometry.y).mul(stiffness).mul(wind);
  return positionLocal.add(vec3(sin(time.mul(1.6).add(phase)), 0, cos(time.mul(1.25).add(phase.mul(1.3)))).mul(bend));
}

function material(stiffness: number): MeshLambertNodeMaterial {
  const m = new MeshLambertNodeMaterial({ vertexColors: true });
  if (stiffness > 0) m.positionNode = swaying(stiffness);
  return m;
}

const TRUNK = 0x9c6845;
const LIME = 0xa7c94b;
const LIME_LIGHT = 0xc2d65c;
const LIME_DEEP = 0x8db743;

/** A trunk that forks into two or three branches, each ending in a chunky cluster of faceted leaves. */
function crownTree(height: number, spread: number, clusters: [number, number, number, number, number][]): BufferGeometry {
  const m = new Mesher().add(new CylinderGeometry(0.2, 0.34, height, 6), TRUNK, at(0, height / 2, 0), 0.1);
  for (const [x, y, z] of clusters.slice(0, 3)) {
    const len = Math.hypot(x, y - height, z);
    const yaw = Math.atan2(x, z);
    const tilt = Math.acos(Math.max(-1, Math.min(1, (y - height) / len)));
    m.add(new CylinderGeometry(0.1, 0.17, len, 5), TRUNK, at(0, height, 0, yaw).multiply(at(0, 0, 0, 0, 1, tilt)).multiply(at(0, len / 2, 0)), 0.1);
  }
  for (const [x, y, z, r, color] of clusters) m.add(new IcosahedronGeometry(r * spread, 0), color, at(x, y, z, x + z, [1, 0.85, 1]), 0.09);
  return m.build();
}

const models = {
  broadleaf: () =>
    crownTree(2.2, 1, [
      [0.9, 3.6, 0.2, 1.3, LIME],
      [-0.9, 3.4, -0.3, 1.2, LIME_DEEP],
      [0.1, 3.9, -0.9, 1.15, LIME_LIGHT],
      [0, 4.4, 0.5, 1.2, LIME_LIGHT],
      [-0.4, 3.2, 0.9, 0.9, LIME],
    ]),
  conifer: () =>
    new Mesher()
      .add(new CylinderGeometry(0.14, 0.22, 1.3, 6), TRUNK, at(0, 0.65, 0), 0.1)
      .add(new ConeGeometry(1.45, 2.3, 7), 0x6f9f45, at(0, 2.2, 0), 0.08)
      .add(new ConeGeometry(1.1, 2, 7), 0x7cab4a, at(0, 3.4, 0, 0.5), 0.08)
      .add(new ConeGeometry(0.7, 1.6, 7), 0x8bb751, at(0, 4.5, 0, 1), 0.08)
      .build(),
  round: () =>
    crownTree(1.6, 1, [
      [0.5, 2.6, 0, 1, LIME_LIGHT],
      [-0.5, 2.5, 0.2, 0.95, LIME],
      [0, 3.1, -0.3, 1, LIME_DEEP],
    ]),
  bush: () =>
    new Mesher()
      .add(new IcosahedronGeometry(0.6, 0), LIME_DEEP, at(0, 0.42, 0, 0, [1.2, 0.8, 1]), 0.1)
      .add(new IcosahedronGeometry(0.45, 0), LIME, at(0.45, 0.4, 0.15, 0.7), 0.1)
      .add(new IcosahedronGeometry(0.4, 0), LIME_LIGHT, at(-0.35, 0.35, -0.2, 1.3), 0.1)
      .build(),
  daisy: () => {
    const m = new Mesher();
    for (const [x, z, h] of [[0, 0, 0.36], [0.12, 0.06, 0.28], [-0.08, 0.1, 0.24]] as const) {
      m.add(new BoxGeometry(0.025, h, 0.025), 0x7fb35a, at(x, h / 2, z), 0);
      m.add(new CylinderGeometry(0.075, 0.075, 0.02, 7), 0xfbfaf4, at(x, h, z, 0, 1, 0.3), 0);
      m.add(new CylinderGeometry(0.028, 0.028, 0.035, 6), 0xf3c64a, at(x, h + 0.01, z, 0, 1, 0.3), 0);
    }
    return m.build();
  },
  lupine: () => {
    const m = new Mesher().add(new BoxGeometry(0.03, 0.5, 0.03), 0x7fb35a, at(0, 0.25, 0), 0);
    for (let i = 0; i < 5; i++) m.add(new OctahedronGeometry(0.075 - i * 0.008, 0), i % 2 ? 0x9a72d6 : 0x8a62c8, at(0, 0.48 + i * 0.09, 0, i), 0);
    m.add(new ConeGeometry(0.09, 0.22, 4), 0x7fb35a, at(0.05, 0.08, 0.02, 0, 1, 0.5), 0);
    return m.build();
  },
  lavender: () => {
    const m = new Mesher();
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const lean = 0.25;
      m.add(new BoxGeometry(0.018, 0.42, 0.018), 0x8aa86a, at(Math.sin(a) * 0.05, 0.21, Math.cos(a) * 0.05, a, 1, lean), 0);
      m.add(new BoxGeometry(0.04, 0.14, 0.04), 0xb391e0, at(Math.sin(a) * 0.15, 0.43, Math.cos(a) * 0.15, a, 1, lean), 0);
    }
    return m.build();
  },
  grass: () =>
    new Mesher()
      .add(new ConeGeometry(0.07, 0.6, 3), 0xa3cc58, at(0, 0.3, 0, 0, 1, 0.15, 0.1), 0.08)
      .add(new ConeGeometry(0.06, 0.48, 3), 0xb4d667, at(0.08, 0.23, 0.05, 1, 1, -0.1, -0.25), 0.08)
      .add(new ConeGeometry(0.06, 0.54, 3), 0x92bd4c, at(-0.07, 0.26, -0.04, 2, 1, 0.2, 0.3), 0.08)
      .build(),
  rock: () =>
    new Mesher()
      .add(new DodecahedronGeometry(0.9, 0), 0xd9c3b6, at(0, 0.3, 0, 0, [1.25, 0.75, 1.05]), 0.09)
      .add(new IcosahedronGeometry(0.45, 0), 0xceb3a7, at(0.7, 0.12, 0.3, 0.8), 0.09)
      .build(),
};

const tint = (r: number, g: number, b: number) => new Color(r, g, b);
const PLAIN = [tint(1, 1, 1)];

export class Vegetation {
  private readonly kinds: Kind[];
  private readonly frustum = new Frustum();
  private readonly projScreen = new Matrix4();
  private readonly box = new Box3();
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly up = new Vector3(0, 1, 0);
  private readonly v = new Vector3();
  private readonly s = new Vector3();
  private readonly visible: Chunk[] = [];
  private signature = Number.NaN;
  private grassOn: boolean;
  private focusX = 0;
  private focusY = 0;
  private readonly byDistance = (a: Chunk, b: Chunk): number => dist(a, this.focusX, this.focusY) - dist(b, this.focusX, this.focusY);

  constructor(
    root: Group,
    private readonly tier: Tier,
  ) {
    const tree = material(0.0035);
    const bush = material(0.05);
    const small = material(0.35);
    const rock = material(0);
    const make = (geometry: BufferGeometry, mat: MeshLambertNodeMaterial, cap: number, layer: Layer, kind: number, tints: Color[], shadow: boolean): Kind => {
      const mesh = new InstancedMesh(geometry, mat, Math.max(1, cap));
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.count = 0;
      mesh.visible = mesh.count > 0; // nothing to draw: skip the draw call
      mesh.frustumCulled = false;
      mesh.castShadow = shadow;
      mesh.receiveShadow = tier.shadows;
      root.add(mesh);
      return { layer, kind, mesh, cap, tints };
    };
    const greens = [tint(1, 1, 1), tint(0.94, 1, 0.9)];
    this.kinds = [
      make(models.broadleaf(), tree, tier.trees, "trees", 0, PLAIN, tier.shadows),
      make(models.conifer(), tree, tier.trees, "trees", 1, PLAIN, tier.shadows),
      make(models.round(), tree, tier.trees, "trees", 2, PLAIN, tier.shadows),
      make(models.bush(), bush, tier.bushes, "bushes", -1, greens, false),
      make(models.daisy(), small, tier.flowers, "flowers", 0, PLAIN, false),
      make(models.lupine(), small, tier.flowers, "flowers", 1, PLAIN, false),
      make(models.lavender(), small, tier.flowers, "flowers", 2, PLAIN, false),
      make(models.grass(), small, tier.grass, "grass", -1, PLAIN, false),
      make(models.rock(), rock, tier.rocks, "rocks", -1, PLAIN, false),
    ];
    this.grassOn = tier.grass > 0;
  }

  /** The governor's last resort: no more grass (or flowers). */
  dropGrass(): void {
    this.grassOn = false;
    this.signature = Number.NaN;
  }

  /**
   * Refills the instances when the chunks in view (or the floating origin, or the
   * loaded set) changed. `camera` must have its matrices up to date. Returns true
   * when it refilled.
   */
  update(land: Land, camera: PerspectiveCamera, focusX: number, focusY: number, origin: [number, number]): boolean {
    this.projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);
    const visible = this.visible;
    visible.length = 0;
    let sig = land.version * 31 + origin[0] * 7 + origin[1] * 13 + (this.grassOn ? 1 : 0);
    const grassR = this.grassOn ? this.tier.grassRadius : 0;
    for (let c = 0; c < land.list.length; c++) {
      const chunk = land.list[c]!;
      const x0 = chunk.cx * CHUNK - origin[0];
      const y0 = chunk.cy * CHUNK - origin[1];
      // Scene axes: x east, y up, z = −north.
      this.box.min.set(x0, -12, -(y0 + CHUNK));
      this.box.max.set(x0 + CHUNK, 40, -y0);
      if (!this.frustum.intersectsBox(this.box)) continue;
      visible.push(chunk);
      const near = grassR > 0 && dist(chunk, focusX, focusY) < grassR + CHUNK * 0.71 ? 1 : 0;
      sig = (Math.imul(sig, 31) + Math.imul(chunk.cx, 73856093) + Math.imul(chunk.cy, 19349663) + near) | 0;
    }
    if (sig === this.signature) return false;
    this.signature = sig;
    this.focusX = focusX;
    this.focusY = focusY;
    visible.sort(this.byDistance);
    for (const k of this.kinds) this.fill(k, grassR, origin);
    return true;
  }

  private fill(k: Kind, grassR: number, origin: [number, number]): void {
    let count = 0;
    const small = k.layer === "grass" || k.layer === "flowers";
    if (!small || grassR > 0) {
      for (const chunk of this.visible) {
        if (count >= k.cap) break;
        if (small && dist(chunk, this.focusX, this.focusY) > grassR + CHUNK * 0.71) continue;
        const packed = chunk.samples.layers[k.layer];
        for (let i = 0; i < packed.length && count < k.cap; i += STRIDE) {
          const kind = packed[i + 5]!;
          if (k.kind >= 0 && kind !== k.kind) continue;
          const x = packed[i]! - origin[0];
          const y = packed[i + 1]! - origin[1];
          const z = packed[i + 2]! - (k.layer === "rocks" ? 0.15 * packed[i + 3]! : 0.05);
          const scale = packed[i + 3]!;
          this.v.set(x, z, -y);
          this.q.setFromAxisAngle(this.up, packed[i + 4]!);
          if (k.layer === "rocks") this.s.set(scale, scale * (0.7 + 0.15 * kind), scale);
          else this.s.setScalar(scale);
          this.m.compose(this.v, this.q, this.s);
          k.mesh.setMatrixAt(count, this.m);
          const t = k.tints[Math.min(k.tints.length - 1, kind)] ?? k.tints[0]!;
          k.mesh.setColorAt(count, t);
          count++;
        }
      }
    }
    k.mesh.count = count;
    k.mesh.visible = count > 0;
    k.mesh.instanceMatrix.needsUpdate = true;
    if (k.mesh.instanceColor) k.mesh.instanceColor.needsUpdate = true;
  }

  /** Instances drawn now, per layer (for the stats). */
  counts(): Record<Layer, number> {
    const out = { trees: 0, bushes: 0, flowers: 0, grass: 0, rocks: 0 };
    for (const k of this.kinds) out[k.layer] += k.mesh.count;
    return out;
  }

  /** The instanced meshes sit at the floating origin. */
  place(originScene: Vector3): void {
    for (const k of this.kinds) k.mesh.position.copy(originScene);
  }

  dispose(): void {
    const materials = new Set<MeshLambertNodeMaterial>();
    for (const k of this.kinds) {
      k.mesh.removeFromParent();
      k.mesh.geometry.dispose();
      k.mesh.dispose();
      materials.add(k.mesh.material as MeshLambertNodeMaterial);
    }
    for (const m of materials) m.dispose();
  }
}

const dist = (c: Chunk, x: number, y: number): number => Math.hypot((c.cx + 0.5) * CHUNK - x, (c.cy + 0.5) * CHUNK - y);
