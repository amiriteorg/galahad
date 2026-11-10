import { BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, InstancedMesh, type Material, type Matrix4, type Object3D, type Vector3 } from "three/webgpu";
import { ROBOT_MANIFESTS } from "../assets/robots/index.ts";
import { flatNormals } from "../mesher.ts";
import { Skeleton } from "./kinematics.ts";
import { decodeMeshes, type LinkMesh, parseManifest, type RobotManifest, treeOf } from "./manifest.ts";

/*
 * Loading a robot for the world and drawing many of it. `loadRobot` fetches its
 * manifest and geometry from the daemon (same origin, /world-assets/robots/, each
 * URL versioned by content so it's cached for good), checks both, and builds one
 * flat-shaded, vertex-coloured geometry per link. `RobotInstances` draws every
 * link as one InstancedMesh shared by all robots of the kind (so a flock of ducks
 * costs one draw call per link, not per duck): each robot's skeleton is posed,
 * then its link frames are written straight into the instance matrices.
 */

export const ROBOT_ASSET_PATH = "/world-assets/robots/";

export interface RobotAsset {
  manifest: RobotManifest;
  /** Each drawn link's geometry, by link name. */
  geometries: Map<string, BufferGeometry>;
}

const colour = new Color();

/** A link's triangles, flat-shaded (a normal per face) and coloured from the robot's materials (sRGB → working space), with a little per-face variation. */
export function linkGeometry(mesh: LinkMesh, materials: readonly number[]): BufferGeometry {
  const n = mesh.indices.length;
  const positions = new Float32Array(n * 3);
  const colours = new Float32Array(n * 3);
  const linear = materials.map((hex) => {
    colour.setHex(hex);
    return [colour.r, colour.g, colour.b] as const;
  });
  for (let i = 0; i < n; i++) {
    const v = mesh.indices[i]!;
    positions[i * 3] = mesh.positions[v * 3]!;
    positions[i * 3 + 1] = mesh.positions[v * 3 + 1]!;
    positions[i * 3 + 2] = mesh.positions[v * 3 + 2]!;
  }
  for (let t = 0; t < n; t += 3) {
    // The face takes its first corner's material.
    const c = linear[mesh.materials[mesh.indices[t]!]!]!;
    const k = 0.96 + 0.08 * fract(Math.sin((t / 3 + 1) * 12.9898) * 43758.5453);
    for (let v = 0; v < 3; v++) {
      colours[(t + v) * 3] = c[0] * k;
      colours[(t + v) * 3 + 1] = c[1] * k;
      colours[(t + v) * 3 + 2] = c[2] * k;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(positions, 3));
  g.setAttribute("normal", new BufferAttribute(flatNormals(positions), 3));
  g.setAttribute("color", new BufferAttribute(colours, 3));
  g.computeBoundingSphere();
  return g;
}

const fract = (x: number): number => x - Math.floor(x);

/** Fetches, checks and builds a robot. Rejects (and the world keeps its hand-made robot) if anything's wrong. */
export async function loadRobot(name: string, get: typeof fetch = fetch): Promise<RobotAsset> {
  const entry = ROBOT_MANIFESTS[name];
  if (!entry) throw new Error(`no robot ${name}`);
  const response = await get(`${ROBOT_ASSET_PATH}${entry}`);
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  const manifest = parseManifest(await response.json());
  if (manifest.name !== name) throw new Error(`${name}: the manifest is for ${manifest.name}`);
  const bin = await get(`${ROBOT_ASSET_PATH}${manifest.bin.file}`);
  if (!bin.ok) throw new Error(`${name}: HTTP ${bin.status}`);
  const meshes = decodeMeshes(manifest, await bin.arrayBuffer());
  new Skeleton(treeOf(manifest)); // the tree must hold together before anything is drawn
  const geometries = new Map<string, BufferGeometry>();
  for (const mesh of meshes) {
    // A link at a time, letting frames through in between: no long stall on a phone.
    await new Promise((resolve) => setTimeout(resolve, 0));
    geometries.set(mesh.link, linkGeometry(mesh, manifest.materials));
  }
  return { manifest, geometries };
}

/** Every link of a kind of robot as one InstancedMesh; `capacity` robots at most. */
export class RobotInstances {
  readonly meshes: InstancedMesh[] = [];
  /** The skeleton's link index each mesh draws. */
  private readonly links: number[] = [];

  constructor(asset: RobotAsset, sk: Skeleton, capacity: number, parent: Object3D, material: Material, shadows: boolean) {
    for (const [link, geometry] of asset.geometries) {
      const mesh = new InstancedMesh(geometry, material, Math.max(1, capacity));
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = shadows;
      mesh.count = capacity;
      parent.add(mesh);
      this.meshes.push(mesh);
      this.links.push(sk.linkIndex(link));
    }
  }

  set count(n: number) {
    for (const m of this.meshes) m.count = n;
  }

  /** Writes robot `i`'s pose: every link's frame (from the posed skeleton), placed by `place` (scene: where, which way, how big). */
  write(i: number, sk: Skeleton, place: Matrix4): void {
    const p = place.elements;
    const w = sk.world;
    for (let k = 0; k < this.meshes.length; k++) {
      const out = this.meshes[k]!.instanceMatrix.array as Float32Array;
      const o = i * 16;
      const l = this.links[k]! * 16;
      for (let col = 0; col < 4; col++) {
        const b0 = w[l + col * 4]!;
        const b1 = w[l + col * 4 + 1]!;
        const b2 = w[l + col * 4 + 2]!;
        const b3 = col === 3 ? 1 : 0;
        for (let row = 0; row < 4; row++) out[o + col * 4 + row] = p[row]! * b0 + p[4 + row]! * b1 + p[8 + row]! * b2 + p[12 + row]! * b3;
      }
    }
  }

  commit(): void {
    for (const m of this.meshes) m.instanceMatrix.needsUpdate = true;
  }

  /** The instances sit at the floating origin. */
  place(originScene: Vector3): void {
    for (const m of this.meshes) m.position.copy(originScene);
  }

  dispose(): void {
    for (const m of this.meshes) {
      m.removeFromParent();
      m.geometry.dispose();
      m.dispose();
    }
    this.meshes.length = 0;
  }
}
