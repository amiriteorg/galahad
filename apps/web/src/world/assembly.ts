import type { ExperimentView, GalahadState, Pose } from "@galahad/core/world";
import { phaseOf } from "@galahad/core/world";
import { attribute, clamp, float, positionLocal, sin, uniform, vec3 } from "three/tsl";
import { BufferAttribute, BufferGeometry, DoubleSide, Group, Matrix4, Mesh, MeshLambertNodeMaterial, Quaternion, Vector3 } from "three/webgpu";
import { toScene } from "./coords.ts";
import { ASSEMBLY } from "./hall-plan.ts";
import { shapeMesher } from "./plots.ts";
import { SITE_LEVEL } from "./sites.ts";

/*
 * An experiment being built, on the workshop's assembly bench: its own bodies (its scene's shapes; not
 * its ground planes) appear laid out on the bench as a kit of parts, and are put together one after
 * another, each lifted across to where it belongs, while Galahad works there. Once the simulation has
 * said how its bodies stand (its first frame's poses), that's how they end up; until then they stay
 * laid out. It's sized to the bench. One mesh, built once per experiment (and again when its poses
 * arrive): the assembling happens in its vertex shader from one uniform, so a frame costs a uniform's
 * write and a draw call, and allocates nothing. Gone when its test begins.
 */

/** Where Galahad stands to build (facing the bench, north), and the bench top he works on: fixed, so asking allocates nothing. */
const AT_BENCH = {
  x: ASSEMBLY.stand.x,
  y: ASSEMBLY.stand.y,
  facing: Math.PI / 2,
  bench: { x: ASSEMBLY.bench.x, y: ASSEMBLY.bench.y, z: SITE_LEVEL.hall + ASSEMBLY.top + 0.15 },
} as const;

/** The bench, when Galahad is building his experiment there (out "at the field" with one whose phase is building); null otherwise. */
export function buildingAt(galahad: GalahadState, experiments: readonly ExperimentView[]): typeof AT_BENCH | null {
  if (galahad.station !== "field" || !galahad.experiment) return null;
  for (let i = 0; i < experiments.length; i++) {
    const e = experiments[i]!;
    if (e.id === galahad.experiment) return phaseOf(e) === "building" ? AT_BENCH : null;
  }
  return null;
}

/** What stands on the bench: the experiment he's building, or else the newest being built that has its bodies. */
export function benchFor(m: { galahad: GalahadState; experiments: readonly ExperimentView[] }): ExperimentView | null {
  let newest: ExperimentView | null = null;
  for (const e of m.experiments) {
    if (phaseOf(e) !== "building" || !e.scene.length) continue;
    if (m.galahad.experiment === e.id) return e;
    if (!newest || e.startedAt > newest.startedAt) newest = e;
  }
  return newest;
}

/** The most vertices it builds (a scene of large meshes is put together from the first of them). */
const MAX_VERTICES = 60_000;
/** Each part appears over this share of the build, and is lifted into place over this share. */
const APPEAR = 0.12;
const MOVE = 0.3;
/** How high a part is lifted on its way (metres, at the bench's scale). */
const LIFT = 0.28;

const m4 = new Matrix4();
const q = new Quaternion();
const v = new Vector3();
const one = new Vector3(1, 1, 1);

export class Assembly {
  readonly group = new Group();
  private mesh: Mesh | null = null;
  private readonly progress = uniform(0);
  private readonly material: MeshLambertNodeMaterial;
  private key = "";
  /** The build's span on the node's clock, and the node's clock less ours (from the event that brought it). */
  private span: { from: number; until: number } | null = null;
  private offset = 0;

  constructor() {
    this.material = new MeshLambertNodeMaterial({ vertexColors: true, side: DoubleSide });
    // p = its centre + (p − centre)·appear + its place in the kit·(1 − move) + up·lift·sin(π·move)
    const slot = attribute("slot", "float");
    const centre = attribute("centre", "vec3");
    const kit = attribute("kit", "vec3");
    const appear = clamp(this.progress.sub(slot.mul(0.55)).div(APPEAR), 0, 1);
    const move = clamp(this.progress.sub(slot.mul(0.55)).sub(0.15).div(MOVE), 0, 1);
    const lifted = vec3(0, sin(move.mul(Math.PI)).mul(LIFT), 0);
    this.material.positionNode = centre.add(positionLocal.sub(centre).mul(appear)).add(kit.mul(float(1).sub(move))).add(lifted);
    const [x, y, z] = toScene(ASSEMBLY.bench.x, ASSEMBLY.bench.y, SITE_LEVEL.hall + ASSEMBLY.top);
    this.group.position.set(x, y, z);
  }

  /**
   * What's on the bench: the experiment Galahad is building (its bodies, and how they stand once built when
   * that's known), or nothing. `at` is the node's clock when this was said. True when anything changed.
   */
  sync(e: ExperimentView | null, at: number, now: number): boolean {
    const building = e && phaseOf(e) === "building" && e.scene.length ? e : null;
    const key = building ? `${building.id}|${building.scene.length}|${building.assembly ? Object.keys(building.assembly).length : 0}` : "";
    if (building?.build) {
      this.span = building.build;
      this.offset = at - now;
    }
    if (key === this.key) return false;
    this.key = key;
    this.clear();
    if (!building) {
      this.span = null;
      return true;
    }
    const geometry = buildKit(building);
    if (!geometry) return true;
    this.mesh = new Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
    return true;
  }

  /** The assembly's progress now (ours, `now`: performance.now()); true while it's still being put together. */
  animate(now: number, motion: boolean): boolean {
    if (!this.mesh) return false;
    const span = this.span;
    const p = !span || span.until <= span.from ? 1 : Math.max(0, Math.min(1, (now + this.offset - span.from) / (span.until - span.from)));
    // Under reduced motion it's shown put together, as it will be.
    const want = motion ? p : 1;
    if (want === this.progress.value) return false;
    this.progress.value = want;
    return true;
  }

  private clear(): void {
    if (!this.mesh) return;
    this.group.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh = null;
  }

  dispose(): void {
    this.clear();
    this.material.dispose();
  }
}

/**
 * The kit: each body (not ground planes) where it stands once built (its assembly pose, or its own origin
 * before that's known), all of it scaled to fit the bench and stood on it; and for each part, its place in
 * the kit, laid out in a grid along the bench. Scene coordinates (y up) about the bench's centre.
 */
export function buildKit(e: Pick<ExperimentView, "scene" | "assembly">): BufferGeometry | null {
  const parts: { positions: Float32Array; normals: Float32Array; colors: Float32Array; centre: Vector3; size: number }[] = [];
  let vertices = 0;
  for (const body of e.scene) {
    if (body.shape.kind === "plane") continue;
    const g = shapeMesher(body.shape, body.color ? parseInt(body.color.slice(1), 16) : 0xc9c2b8).build();
    const count = g.getAttribute("position").count;
    if (vertices + count > MAX_VERTICES) break;
    vertices += count;
    const pose: Pose | undefined = e.assembly?.[body.id];
    // The experiment's frame (z up) into the scene's (y up): x, z, −y.
    m4.compose(v.set(pose?.[0] ?? 0, pose?.[1] ?? 0, pose?.[2] ?? 0), q.set(pose?.[4] ?? 0, pose?.[5] ?? 0, pose?.[6] ?? 0, pose?.[3] ?? 1), one);
    const pos = g.getAttribute("position");
    const nor = g.getAttribute("normal");
    const col = g.getAttribute("color");
    const positions = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    const nm = new Matrix4().extractRotation(m4);
    const lo = new Vector3(Infinity, Infinity, Infinity);
    const hi = new Vector3(-Infinity, -Infinity, -Infinity);
    for (let i = 0; i < count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m4);
      positions.set([v.x, v.z, -v.y], i * 3);
      lo.min(v);
      hi.max(v);
      v.fromBufferAttribute(nor, i).applyMatrix4(nm).normalize();
      normals.set([v.x, v.z, -v.y], i * 3);
    }
    const colors = new Float32Array(col ? (col.array as Float32Array) : new Float32Array(count * 3).fill(0.8));
    g.dispose();
    const c = lo.clone().add(hi).multiplyScalar(0.5);
    parts.push({ positions, normals, colors, centre: new Vector3(c.x, c.z, -c.y), size: hi.sub(lo).length() });
  }
  if (!parts.length) return null;
  // Fit the whole of it on the bench (a model aircraft, a rocket lying ready, an arm at its own size).
  const lo = new Vector3(Infinity, Infinity, Infinity);
  const hi = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const p of parts) for (let i = 0; i < p.positions.length; i += 3) {
    v.set(p.positions[i]!, p.positions[i + 1]!, p.positions[i + 2]!);
    lo.min(v);
    hi.max(v);
  }
  const W = ASSEMBLY.bench.hx * 2 * 0.8;
  const D = ASSEMBLY.bench.hy * 2 * 0.8;
  const span = hi.clone().sub(lo);
  const s = Math.min(2, W / Math.max(1e-6, span.x), D / Math.max(1e-6, span.z), 1.1 / Math.max(1e-6, span.y));
  const mid = lo.clone().add(hi).multiplyScalar(0.5);
  // Centred on the bench, its lowest point on the top (a little lift so nothing sinks in).
  const shift = new Vector3(-mid.x * s, -lo.y * s + 0.005, -mid.z * s);
  // The kit: parts in a grid along the bench, each a cell's width apart.
  const cols = Math.ceil(Math.sqrt(parts.length * 2.4));
  const rows = Math.ceil(parts.length / cols);
  const total = parts.reduce((n, p) => n + p.positions.length / 3, 0);
  const position = new Float32Array(total * 3);
  const normal = new Float32Array(total * 3);
  const color = new Float32Array(total * 3);
  const centre = new Float32Array(total * 3);
  const kit = new Float32Array(total * 3);
  const slot = new Float32Array(total);
  let k = 0;
  parts.forEach((p, i) => {
    const cx = p.centre.x * s + shift.x;
    const cy = p.centre.y * s + shift.y;
    const cz = p.centre.z * s + shift.z;
    const gx = -W / 2 + ((i % cols) + 0.5) * (W / cols);
    const gz = -D / 2 + (Math.floor(i / cols) + 0.5) * (D / rows);
    // Laid out: lying on the bench at its cell, so its lowest point is on the top.
    let low = Infinity;
    for (let j = 1; j < p.positions.length; j += 3) low = Math.min(low, p.positions[j]! * s + shift.y);
    const ky = 0.005 - low;
    const order = parts.length > 1 ? i / (parts.length - 1) : 0;
    for (let j = 0; j < p.positions.length; j += 3, k++) {
      position[k * 3] = p.positions[j]! * s + shift.x;
      position[k * 3 + 1] = p.positions[j + 1]! * s + shift.y;
      position[k * 3 + 2] = p.positions[j + 2]! * s + shift.z;
      normal.set([p.normals[j]!, p.normals[j + 1]!, p.normals[j + 2]!], k * 3);
      color.set([p.colors[j]!, p.colors[j + 1]!, p.colors[j + 2]!], k * 3);
      centre.set([cx, cy, cz], k * 3);
      kit.set([gx - cx, ky, gz - cz], k * 3);
      slot[k] = order;
    }
  });
  // Until it's known how they stand once built, the parts stay laid out (nothing to put them together into).
  if (!e.assembly || !Object.keys(e.assembly).length) {
    for (let i = 0; i < position.length; i++) {
      position[i]! += kit[i]!;
      centre[i]! += kit[i]!;
      kit[i] = 0;
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(position, 3));
  geometry.setAttribute("normal", new BufferAttribute(normal, 3));
  geometry.setAttribute("color", new BufferAttribute(color, 3));
  geometry.setAttribute("centre", new BufferAttribute(centre, 3));
  geometry.setAttribute("kit", new BufferAttribute(kit, 3));
  geometry.setAttribute("slot", new BufferAttribute(slot, 1));
  geometry.computeBoundingSphere();
  return geometry;
}
