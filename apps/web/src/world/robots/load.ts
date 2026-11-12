import { BatchedMesh, BufferAttribute, BufferGeometry, Color, type Material, Matrix4, type Object3D, type Vector3 } from "three/webgpu";
import { ROBOT_MANIFESTS } from "../assets/robots/index.ts";
import { flatNormals } from "../mesher.ts";
import { Skeleton } from "./kinematics.ts";
import { decodeMeshes, type LinkMesh, parseManifest, type RobotManifest, treeOf } from "./manifest.ts";

/*
 * Loading a robot for the world and drawing many of it. `loadRobot` fetches its
 * manifest and geometry from the daemon (same origin, /world-assets/robots/, each
 * URL versioned by content so it's cached for good), checks both, and builds one
 * flat-shaded, vertex-coloured geometry per link. `RobotInstances` draws every
 * link of every robot of a kind as one mesh (three's BatchedMesh: the links'
 * geometries side by side in one buffer, a matrix an instance in a texture), so a
 * flock of ducks is one object to the renderer in each pass, not one a link: each
 * robot's skeleton is posed, then its link frames are written as its instances'
 * matrices. (It was one InstancedMesh a link: thirty objects for the three kinds,
 * and thirty more in the sun's shadow pass, a quarter of everything the world
 * handed the renderer each frame.)
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

/** Every link of every robot of a kind as one mesh; `capacity` robots at most. */
export class RobotInstances {
  /** All of them: the renderer's one object for the kind. */
  readonly mesh: BatchedMesh;
  /** The skeleton's link index each drawn link takes its frame from. */
  private readonly links: number[] = [];
  /** The mesh's instance for robot `i`'s drawn link `k`: at `i * links.length + k`. */
  private readonly ids: Int32Array;
  private readonly capacity: number;
  /** How many robots are shown. */
  private shown: number;
  private readonly m = new Matrix4();
  private readonly geometries: BufferGeometry[];

  constructor(asset: RobotAsset, sk: Skeleton, capacity: number, parent: Object3D, material: Material, shadows: boolean) {
    const robots = Math.max(1, capacity);
    this.capacity = robots;
    this.shown = capacity;
    this.geometries = [...asset.geometries.values()];
    let vertices = 0;
    for (const geometry of this.geometries) vertices += geometry.getAttribute("position").count;
    const mesh = new BatchedMesh(robots * this.geometries.length, vertices, 0, material);
    // Nothing is looked for or sorted each frame: every robot of the kind is drawn (they're a handful, together).
    mesh.perObjectFrustumCulled = false;
    mesh.sortObjects = false;
    mesh.frustumCulled = false;
    mesh.castShadow = shadows;
    this.ids = new Int32Array(robots * this.geometries.length);
    // (Link by link, so the instances of one link lie together and are drawn in one go.)
    let k = 0;
    for (const [link, geometry] of asset.geometries) {
      const id = mesh.addGeometry(geometry);
      for (let i = 0; i < robots; i++) {
        const instance = mesh.addInstance(id);
        this.ids[i * this.geometries.length + k] = instance;
        if (i >= capacity) mesh.setVisibleAt(instance, false);
      }
      this.links.push(sk.linkIndex(link));
      k++;
    }
    parent.add(mesh);
    this.mesh = mesh;
  }

  /** How many of the robots are drawn (the first `n`). */
  set count(n: number) {
    const shown = Math.max(0, Math.min(this.capacity, n));
    const links = this.links.length;
    for (let i = Math.min(shown, this.shown); i < Math.max(shown, this.shown); i++) {
      for (let k = 0; k < links; k++) this.mesh.setVisibleAt(this.ids[i * links + k]!, i < shown);
    }
    this.shown = shown;
  }

  /** Writes robot `i`'s pose: every link's frame (from the posed skeleton), placed by `place` (scene: where, which way, how big). */
  write(i: number, sk: Skeleton, place: Matrix4): void {
    const p = place.elements;
    const w = sk.world;
    const out = this.m.elements;
    const links = this.links.length;
    for (let k = 0; k < links; k++) {
      const l = this.links[k]! * 16;
      for (let col = 0; col < 4; col++) {
        const b0 = w[l + col * 4]!;
        const b1 = w[l + col * 4 + 1]!;
        const b2 = w[l + col * 4 + 2]!;
        const b3 = col === 3 ? 1 : 0;
        for (let row = 0; row < 4; row++) out[col * 4 + row] = p[row]! * b0 + p[4 + row]! * b1 + p[8 + row]! * b2 + p[12 + row]! * b3;
      }
      this.mesh.setMatrixAt(this.ids[i * links + k]!, this.m);
    }
  }

  /** (The matrices go to the GPU as they're written: nothing more to do. Kept so callers needn't know.) */
  commit(): void {}

  /** Where robot `i`'s drawn link `k` is, as it was last written (for tests). */
  frame(i: number, k: number, out: Matrix4): Matrix4 {
    return this.mesh.getMatrixAt(this.ids[i * this.links.length + k]!, out);
  }

  /** The instances sit at the floating origin. */
  place(originScene: Vector3): void {
    this.mesh.position.copy(originScene);
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.dispose();
    for (const geometry of this.geometries) geometry.dispose();
    this.geometries.length = 0;
  }
}
