import type { BodyShape, ExperimentFrame, ExperimentStatus, ExperimentView, Pose, SceneBody } from "@galahad/core/world";
import { padAt } from "@galahad/core/world";
import { abs, positionWorld, step, uniform } from "three/tsl";
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Line,
  LineBasicMaterial,
  LineLoop,
  Matrix3,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshLambertNodeMaterial,
  PlaneGeometry,
  SphereGeometry,
  Vector2,
  Vector3,
} from "three/webgpu";
import { experimentEnded } from "../lib/world.ts";
import { headingToSceneYaw, onPlot, toScene, type Vec3 } from "./coords.ts";
import { disposeTree } from "./keep.ts";
import { at, linear, Mesher } from "./mesher.ts";
import { plotLayout } from "./plot-plan.ts";
import { PoseBuffer } from "./pose.ts";
import { plotLevel } from "./sites.ts";

/*
 * Experiments on their plots: a fenced lot with a signpost and a status lamp, and
 * the experiment's bodies in its own z-up frame (scaled, then offset by the plot's
 * centre, as the contract says). Moving bodies play back through a short buffer;
 * fixed ones (posed once, in the first frame) stand at the latest pose received,
 * never interpolated, and at the plot's origin until then. Ground planes are
 * clipped to the plot. Trails fade behind what asks for one; a climbing rocket
 * burns, with exhaust particles. Ended experiments stay, dimmed, merged into one
 * mesh each.
 */

/** Stand-ins (aircraft, rockets) are drawn at least this long, however far a flight was scaled down. */
const MIN_STANDIN_M = 3;
const TRAIL_POINTS = 400;
const DEFAULT_BODY = 0xc9c2b8;

/** The floating origin (world metres), for shaders that need world coordinates. */
export const originUniform = uniform(new Vector2());

export interface Emitter {
  exhaustAt(x: number, y: number, z: number, dx: number, dy: number, dz: number, speed: number): void;
}

export interface StatusColors {
  ok: number;
  warn: number;
  danger: number;
  neutral: number;
  accent: number;
}

function shapeMesher(shape: BodyShape, color: number): Mesher {
  const m = new Mesher();
  switch (shape.kind) {
    case "box":
      return m.add(new BoxGeometry(...shape.size), color);
    case "sphere":
      return m.add(new IcosahedronGeometry(shape.radius, 1), color);
    case "capsule":
      return m.add(new CapsuleGeometry(shape.radius, shape.length, 3, 8).rotateX(Math.PI / 2), color);
    case "cylinder":
      return m.add(new CylinderGeometry(shape.radius, shape.radius, shape.length, 12).rotateX(Math.PI / 2), color);
    case "plane":
      return m.add(new PlaneGeometry(...shape.size), color, undefined, 0);
    case "mesh": {
      const g = new BufferGeometry();
      g.setAttribute("position", new BufferAttribute(new Float32Array(shape.vertices), 3));
      g.setIndex(shape.indices);
      return m.add(g, color, undefined, 0.03);
    }
    case "aircraft": {
      // Local frame: nose +x, up +z, left wing +y.
      const L = shape.length;
      const S = shape.span;
      return m
        .add(new BoxGeometry(L * 0.8, L * 0.12, L * 0.13), color, at(0, 0, 0))
        .add(new ConeGeometry(L * 0.07, L * 0.2, 6).rotateZ(-Math.PI / 2), color, at(L * 0.5, 0, 0))
        .add(new BoxGeometry(L * 0.14, L * 0.1, L * 0.05), 0x3b4048, at(L * 0.25, 0, L * 0.07), 0)
        .add(new BoxGeometry(L * 0.22, S, L * 0.025), color, at(L * 0.06, 0, L * 0.02))
        .add(new BoxGeometry(L * 0.13, S * 0.36, L * 0.02), color, at(-L * 0.42, 0, L * 0.02))
        .add(new BoxGeometry(L * 0.15, L * 0.02, L * 0.22), color, at(-L * 0.42, 0, L * 0.13))
        .add(new BoxGeometry(L * 0.04, S * 0.98, L * 0.03), 0xe07a6a, at(0, 0, L * 0.022), 0);
    }
    case "rocket": {
      // Nose +x.
      const L = shape.length;
      const r = shape.radius;
      const along = (g: BufferGeometry) => g.rotateZ(-Math.PI / 2);
      m.add(along(new CylinderGeometry(r, r, L * 0.72, 10)), color, at(-L * 0.04, 0, 0))
        .add(along(new ConeGeometry(r, L * 0.24, 10)), 0xe07a6a, at(L * 0.44, 0, 0))
        .add(along(new CylinderGeometry(r * 0.6, r * 0.85, L * 0.05, 8)), 0x3b4048, at(-L * 0.42, 0, 0), 0);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        m.add(new BoxGeometry(L * 0.16, r * 0.15, r * 1.6), 0xe07a6a, at(-L * 0.33, Math.sin(a) * r * 1.3, Math.cos(a) * r * 1.3, 0, 1, a), 0);
      }
      return m;
    }
  }
}

const parseHex = (hex: string | undefined): number => (hex ? parseInt(hex.slice(1), 16) : DEFAULT_BODY);
const shapeLength = (shape: BodyShape): number => (shape.kind === "aircraft" || shape.kind === "rocket" ? shape.length : 0);

interface Trail {
  line: Line;
  points: Float32Array;
  colors: Float32Array;
  count: number;
  color: [number, number, number];
}

interface Body {
  def: SceneBody;
  mesh: Mesh;
  trail: Trail | null;
  exhaust: Mesh | null;
  posed: boolean;
  lastZ: number;
}

const STATUS_COLOR = (p: StatusColors, s: ExperimentStatus): number => (s === "running" ? p.ok : s === "starting" ? p.warn : s === "failed" ? p.danger : p.neutral);

const tail = new Vector3();
const nose = new Vector3();
const nm = new Matrix3();
const mm = new Matrix4();
const vv = new Vector3();

/** One experiment's plot: its fence and sign (plot frame, y up) and its bodies (the experiment's own frame, z up, scaled). */
class Plot {
  readonly base = new Group();
  private readonly frame = new Group();
  private readonly material = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
  /** Planes (ground sheets) are clipped to the plot in the fragment shader. */
  private readonly planeMaterial = new MeshLambertNodeMaterial({ vertexColors: true, side: DoubleSide });
  private readonly plotUniform = uniform(new Vector3());
  private readonly lamp: Mesh;
  private readonly ring: LineLoop;
  private readonly bodies = new Map<string, Body>();
  readonly labelled: Body[] = [];
  private baked: Mesh | null = null;
  readonly buffer = new PoseBuffer();
  private structure = "";
  private changed = false;
  private stableSince = 0;
  private horizon = 0;
  /** The sign's top, world coordinates (z up): where the label floats. */
  readonly signPoint: Vec3 = [0, 0, 0];
  /** The height of the ground the plot stands on. */
  private level = 0;
  exp: ExperimentView;

  constructor(
    exp: ExperimentView,
    private colors: StatusColors,
    private readonly fenceMaterial: MeshLambertMaterial,
    private readonly shadows: boolean,
    private readonly emitter: Emitter,
  ) {
    this.exp = exp;
    this.lamp = new Mesh(new IcosahedronGeometry(0.22, 0), new MeshBasicMaterial({ color: 0xffffff }));
    this.ring = new LineLoop(new BufferGeometry(), new LineBasicMaterial({ color: colors.accent }));
    this.ring.visible = false;
    this.frame.rotation.x = -Math.PI / 2;
    this.base.add(this.frame, this.lamp, this.ring);
    // World (x, y) of the fragment = scene (x, −z) + origin; inside the plot's square or discarded.
    const u = this.plotUniform;
    const dx = abs(positionWorld.x.add(originUniform.x).sub(u.x));
    const dy = abs(positionWorld.z.negate().add(originUniform.y).sub(u.y));
    this.planeMaterial.opacityNode = step(dx, u.z).mul(step(dy, u.z));
    this.planeMaterial.alphaTest = 0.5;
    this.build(exp);
  }

  /** Rebuilds what depends on the plot and the scene; otherwise just takes the new status and readouts. */
  update(exp: ExperimentView): boolean {
    const same = exp.scene === this.exp.scene && exp.plot === this.exp.plot && exp.scale === this.exp.scale;
    const rebuilt = !same && JSON.stringify([exp.plot, exp.scale, exp.scene]) !== this.structure;
    if (rebuilt) this.build(exp);
    const statusChanged = rebuilt || exp.status !== this.exp.status;
    this.exp = exp;
    if (statusChanged) this.restyle();
    return statusChanged;
  }

  setColors(c: StatusColors): void {
    this.colors = c;
    (this.ring.material as LineBasicMaterial).color.setHex(c.accent);
    this.restyle();
  }

  setSelected(on: boolean): void {
    this.ring.visible = on;
  }

  private restyle(): void {
    const ended = experimentEnded(this.exp);
    (this.lamp.material as MeshBasicMaterial).color.setHex(STATUS_COLOR(this.colors, this.exp.status));
    this.material.color.setScalar(ended ? 0.55 : 1);
    this.planeMaterial.color.setScalar(ended ? 0.55 : 1);
    for (const b of this.bodies.values()) {
      if (b.trail) (b.trail.line.material as LineBasicMaterial).opacity = ended ? 0.35 : 0.9;
      if (b.exhaust && ended) b.exhaust.visible = false;
    }
  }

  private build(exp: ExperimentView): void {
    this.structure = JSON.stringify([exp.plot, exp.scale, exp.scene]);
    this.clearBodies();
    for (const child of [...this.base.children]) {
      if (!child.userData.fence) continue;
      this.base.remove(child);
      (child as Mesh).geometry.dispose();
    }
    const { x, y, size } = exp.plot;
    // A pad stands on its site's ground (the proving ground is up on its plateau); open land is levelled at the keep's height.
    this.level = plotLevel(exp.plot);
    const [sx, sy, sz] = toScene(x, y, this.level);
    this.base.position.set(sx, sy, sz);
    this.plotUniform.value.set(x, y, size / 2);
    // On a pad of the proving ground or the hall, the site is the ground and the fence: only the sign and its lamp are the plot's.
    const sited = padAt(exp.plot) !== null;
    const fence = new Mesher();
    if (!sited) {
      fence.add(new BoxGeometry(size + 1.6, 0.08, size + 1.6), 0xbfb092, at(0, 0.03, 0), 0);
      fence.add(new BoxGeometry(size, 0.08, size), 0xe3d9c0, at(0, 0.06, 0), 0.02);
    }
    // The fence (a gap for the gate), the signpost beside the gate and the dome behind: plot-plan.ts lays them out, where walkers meet them too.
    const layout = plotLayout(exp.plot);
    const gateDir = layout.gateDir;
    for (const [px, py] of layout.posts) fence.add(new BoxGeometry(0.16, 1.2, 0.16), 0x8d5f3d, at(px, 0.6, -py));
    for (const [px, py, qx, qy] of layout.rails) {
      const yaw = headingToSceneYaw(Math.atan2(qy - py, qx - px));
      const len = Math.hypot(qx - px, qy - py);
      for (const h of [0.45, 0.95]) fence.add(new BoxGeometry(0.08, 0.1, len * 1.02), 0xa77b52, at((px + qx) / 2, h, -(py + qy) / 2, yaw));
    }
    // The signpost beside the gate, facing the keep, with a lamp of its status. A test cell in the hall has its own stack
    // light and none (see plot-plan.ts): its label floats over the cell.
    const [signX, signY] = layout.sign ?? [0, 0];
    if (layout.sign) {
      fence.add(new BoxGeometry(0.16, 2.4, 0.16), 0x654330, at(signX, 1.2, -signY));
      fence.add(new BoxGeometry(1.5, 0.85, 0.1), 0xf0e4c6, at(signX, 1.95, -signY, headingToSceneYaw(gateDir)));
    }
    this.lamp.visible = layout.sign !== null;
    if (layout.dome && layout.panel) {
      // A little research dome with a solar panel, behind the pad: test pads sit by the domes.
      const [domeX, domeY] = layout.dome;
      const [panelX, panelY] = layout.panel;
      fence.add(new SphereGeometry(2, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2), 0xf6f4ef, at(domeX, -0.1, -domeY), 0.03);
      fence.add(new CylinderGeometry(2.03, 2.03, 0.35, 12), 0xe8853a, at(domeX, 0.45, -domeY), 0);
      fence.add(new BoxGeometry(2.4, 0.08, 1.5), 0x2e4a86, at(panelX, 1.1, -panelY, headingToSceneYaw(gateDir), 1, -0.45), 0.02);
      fence.add(new BoxGeometry(0.1, 1, 0.1), 0x8b8f97, at(panelX, 0.5, -panelY), 0);
    }
    // (A test cell in the hall has none of it: nothing to draw, and a draw of nothing is a GPU warning.)
    const furniture = fence.build();
    if (furniture.getAttribute("position")?.count) {
      const fenceMesh = new Mesh(furniture, this.fenceMaterial);
      fenceMesh.userData.fence = true;
      fenceMesh.receiveShadow = this.shadows;
      this.base.add(fenceMesh);
    } else furniture.dispose();
    this.lamp.position.set(signX, 2.6, -signY);
    this.signPoint[0] = x + signX;
    this.signPoint[1] = y + signY;
    this.signPoint[2] = this.level + (layout.sign ? 3.1 : 3.4);
    const r = layout.half + 0.6;
    this.ring.geometry.setAttribute("position", new BufferAttribute(new Float32Array([-r, 0.12, -r, r, 0.12, -r, r, 0.12, r, -r, 0.12, r]), 3));

    // The experiment's own frame: z up, scaled, centred on the plot.
    this.frame.scale.setScalar(exp.scale);
    for (const def of exp.scene) {
      const color = parseHex(def.color);
      const mesh = new Mesh(shapeMesher(def.shape, color).build(), def.shape.kind === "plane" ? this.planeMaterial : this.material);
      mesh.castShadow = this.shadows && def.shape.kind !== "plane";
      mesh.receiveShadow = this.shadows;
      const len = shapeLength(def.shape);
      // Too small to see at this scale: the stand-in is drawn larger, centred where it is.
      if (len > 0) mesh.scale.setScalar(Math.max(1, MIN_STANDIN_M / (len * exp.scale)));
      this.frame.add(mesh);
      let exhaust: Mesh | null = null;
      if (def.shape.kind === "rocket") {
        const L = def.shape.length;
        exhaust = new Mesh(
          new ConeGeometry(def.shape.radius * 0.9, L * 0.45, 8).rotateZ(Math.PI / 2).translate(-L * 0.67, 0, 0),
          new MeshBasicMaterial({ color: 0xffa24a, transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false }),
        );
        exhaust.visible = false;
        mesh.add(exhaust);
      }
      const body: Body = { def, mesh, trail: def.trail ? this.makeTrail(color) : null, exhaust, posed: false, lastZ: Number.NaN };
      this.bodies.set(def.id, body);
      if (def.label) this.labelled.push(body);
    }
    this.stableSince = 0;
  }

  private makeTrail(color: number): Trail {
    const points = new Float32Array(TRAIL_POINTS * 3);
    const colors = new Float32Array(TRAIL_POINTS * 3);
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(points, 3));
    geometry.setAttribute("color", new BufferAttribute(colors, 3));
    geometry.setDrawRange(0, 0);
    const line = new Line(geometry, new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false }));
    line.frustumCulled = false;
    line.visible = false; // until it has two points to join
    this.frame.add(line);
    return { line, points, colors, count: 0, color: linear(color) };
  }

  private clearBodies(): void {
    for (const b of this.bodies.values()) {
      b.mesh.geometry.dispose();
      b.exhaust?.geometry.dispose();
      (b.exhaust?.material as MeshBasicMaterial | undefined)?.dispose();
      if (b.trail) {
        b.trail.line.geometry.dispose();
        (b.trail.line.material as LineBasicMaterial).dispose();
      }
    }
    for (const child of [...this.frame.children]) this.frame.remove(child);
    this.bodies.clear();
    this.labelled.length = 0;
    if (this.baked) {
      this.baked.geometry.dispose();
      this.baked = null;
    }
  }

  /** A frame arrived: fixed bodies take their pose at once (never interpolated); moving ones go to the buffer. */
  push(frame: ExperimentFrame, at: number, receivedAt: number): void {
    for (const id in frame.poses) {
      const b = this.bodies.get(id);
      if (b?.def.fixed) this.place(b, frame.poses[id]!);
    }
    this.buffer.push(at, frame.t, frame.poses, receivedAt);
  }

  /** Joining mid-run (or an ended one): every body at its latest known pose. */
  seed(poses: Record<string, Pose>): void {
    for (const id in poses) {
      const b = this.bodies.get(id);
      if (b) this.place(b, poses[id]!);
    }
  }

  private place(b: Body, p: Pose): void {
    b.mesh.position.set(p[0], p[1], p[2]);
    b.mesh.quaternion.set(p[4], p[5], p[6], p[3]);
    b.posed = true;
    this.changed = true;
  }

  /** The buffer's visitor: moving bodies only (bound once, so sampling allocates nothing). */
  private readonly visit = (id: string, x: number, y: number, z: number, qw: number, qx: number, qy: number, qz: number): void => {
    const b = this.bodies.get(id);
    if (!b || b.def.fixed) return;
    b.mesh.position.set(x, y, z);
    b.mesh.quaternion.set(qx, qy, qz, qw);
    b.posed = true;
    if (b.trail) this.extendTrail(b.trail, x, y, z);
    if (b.exhaust) this.burn(b, z);
    b.lastZ = z;
    this.changed = true;
  };

  /** Moves the bodies to the poses at `now`. Returns true when anything moved. */
  animate(now: number, horizon: number): boolean {
    if (this.baked) return false;
    this.horizon = horizon;
    const sampled = this.buffer.sample(now, this.visit);
    const moved = sampled || this.changed;
    this.changed = false;
    if (moved) this.stableSince = 0;
    else if (experimentEnded(this.exp)) {
      if (!this.stableSince) this.stableSince = now;
      else if (now - this.stableSince > 2000) this.bake();
    }
    return moved;
  }

  /** A rocket burns while it climbs: a glow at its tail and exhaust particles. */
  private burn(b: Body, z: number): void {
    const exhaust = b.exhaust!;
    const rising = !Number.isNaN(b.lastZ) && (z - b.lastZ) * this.exp.scale > 0.004;
    exhaust.visible = this.exp.status === "running" && rising && z * this.exp.scale > 0.05;
    if (!exhaust.visible) return;
    exhaust.scale.set(1, 0.85 + 0.3 * Math.abs(Math.sin(z * 7.1)), 1);
    // Where its tail is and which way its nose points, in the world (z up).
    const L = (b.def.shape as { length: number }).length;
    b.mesh.updateWorldMatrix(true, false);
    tail.set(-L * 0.5, 0, 0).applyMatrix4(b.mesh.matrixWorld);
    nose.set(L * 0.5, 0, 0).applyMatrix4(b.mesh.matrixWorld).sub(tail).normalize();
    const ox = originUniform.value.x;
    const oy = originUniform.value.y;
    this.emitter.exhaustAt(tail.x + ox, -tail.z + oy, tail.y, -nose.x, nose.z, -nose.y, 6);
  }

  private extendTrail(trail: Trail, x: number, y: number, z: number): void {
    const s = this.exp.scale;
    if (trail.count > 0) {
      const i = (trail.count - 1) * 3;
      const d = Math.hypot(x - trail.points[i]!, y - trail.points[i + 1]!, z - trail.points[i + 2]!) * s;
      // A jump (a restart, a reset): start the trail over rather than draw a line across the plot.
      if (d > this.exp.plot.size * 0.5) trail.count = 0; // restarts; hidden until it has two points again
      else if (d < 0.12) return;
    }
    if (trail.count === TRAIL_POINTS) {
      trail.points.copyWithin(0, 3);
      trail.count--;
    }
    const k = trail.count * 3;
    trail.points[k] = x;
    trail.points[k + 1] = y;
    trail.points[k + 2] = z;
    trail.count++;
    // Older points fade into the sky.
    const h = linearInto(this.horizon);
    const c = trail.color;
    for (let i = 0; i < trail.count; i++) {
      const w = ((i + 1) / trail.count) ** 2;
      trail.colors[i * 3] = h[0] + (c[0] - h[0]) * w;
      trail.colors[i * 3 + 1] = h[1] + (c[1] - h[1]) * w;
      trail.colors[i * 3 + 2] = h[2] + (c[2] - h[2]) * w;
    }
    const geometry = trail.line.geometry;
    geometry.getAttribute("position").needsUpdate = true;
    geometry.getAttribute("color").needsUpdate = true;
    geometry.setDrawRange(0, trail.count);
    trail.line.visible = trail.count > 1;
  }

  /** An ended experiment no longer moves: its bodies (but ground planes, which are clipped) become one mesh. */
  private bake(): void {
    const parts = [...this.bodies.values()].filter((b) => (b.posed || b.def.fixed) && b.def.shape.kind !== "plane");
    const positions: number[] = [];
    const colors: number[] = [];
    const normals: number[] = [];
    for (const b of parts) {
      b.mesh.updateMatrix();
      mm.copy(b.mesh.matrix);
      nm.getNormalMatrix(mm);
      const g = b.mesh.geometry;
      const p = g.getAttribute("position");
      const c = g.getAttribute("color");
      const n = g.getAttribute("normal");
      for (let i = 0; i < p.count; i++) {
        vv.fromBufferAttribute(p, i).applyMatrix4(mm);
        positions.push(vv.x, vv.y, vv.z);
        vv.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
        normals.push(vv.x, vv.y, vv.z);
        colors.push(c.getX(i), c.getY(i), c.getZ(i));
      }
      this.frame.remove(b.mesh);
      b.mesh.geometry.dispose();
      b.exhaust?.geometry.dispose();
    }
    const merged = new BufferGeometry();
    merged.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
    merged.setAttribute("normal", new BufferAttribute(new Float32Array(normals), 3));
    merged.setAttribute("color", new BufferAttribute(new Float32Array(colors), 3));
    merged.computeBoundingSphere();
    this.baked = new Mesh(merged, this.material);
    this.baked.castShadow = this.shadows;
    this.frame.add(this.baked);
  }

  /** A labelled body's position in the world (z up), written into `out`; false until it has a pose. */
  bodyPoint(b: Body, out: Vec3): boolean {
    if (!b.posed) return false;
    const p = b.mesh.position;
    const s = this.exp.scale;
    out[0] = this.exp.plot.x + p.x * s;
    out[1] = this.exp.plot.y + p.y * s;
    out[2] = this.level + p.z * s + 0.4;
    return true;
  }

  dispose(): void {
    this.clearBodies();
    disposeTree(this.base, [this.fenceMaterial, this.material, this.planeMaterial]);
    this.material.dispose();
    this.planeMaterial.dispose();
  }
}

const linearScratch: [number, number, number] = [0, 0, 0];
let linearKey = -1;
/** linear() for the trail's fade colour, cached (it changes with the time of day, not per point). */
function linearInto(hex: number): [number, number, number] {
  if (hex !== linearKey) {
    const [r, g, b] = linear(hex);
    linearScratch[0] = r;
    linearScratch[1] = g;
    linearScratch[2] = b;
    linearKey = hex;
  }
  return linearScratch;
}

export class Plots {
  readonly group = new Group();
  private readonly plots = new Map<string, Plot>();
  private readonly list: Plot[] = [];
  private readonly fenceMaterial = new MeshLambertMaterial({ vertexColors: true });
  private selected: string | null = null;

  constructor(
    private colors: StatusColors,
    private readonly shadows: boolean,
    private readonly emitter: Emitter,
  ) {}

  /** Adds, updates and removes plots to match the model. Returns true when anything changed. */
  sync(experiments: readonly ExperimentView[], frames: Record<string, ExperimentFrame>): boolean {
    let changed = false;
    const ids = new Set(experiments.map((e) => e.id));
    for (const [id, plot] of this.plots) {
      if (ids.has(id)) continue;
      this.group.remove(plot.base);
      plot.dispose();
      this.plots.delete(id);
      this.list.splice(this.list.indexOf(plot), 1);
      changed = true;
    }
    for (const e of experiments) {
      const plot = this.plots.get(e.id);
      if (!plot) {
        const created = new Plot(e, this.colors, this.fenceMaterial, this.shadows, this.emitter);
        const last = frames[e.id];
        if (last) created.seed(last.poses);
        created.setSelected(e.id === this.selected);
        this.plots.set(e.id, created);
        this.list.push(created);
        this.group.add(created.base);
        changed = true;
      } else if (plot.exp !== e) {
        if (plot.update(e)) {
          changed = true;
          const last = frames[e.id];
          if (last) plot.seed(last.poses);
        }
        plot.setSelected(e.id === this.selected);
      }
    }
    return changed;
  }

  push(frame: ExperimentFrame, at: number, receivedAt: number): void {
    this.plots.get(frame.experiment)?.push(frame, at, receivedAt);
  }

  animate(now: number, horizon: number): boolean {
    let moved = false;
    for (let i = 0; i < this.list.length; i++) moved = this.list[i]!.animate(now, horizon) || moved;
    return moved;
  }

  setColors(c: StatusColors): void {
    this.colors = c;
    for (const plot of this.list) plot.setColors(c);
  }

  select(id: string | null): void {
    this.selected = id;
    for (const [pid, plot] of this.plots) plot.setSelected(pid === id);
  }

  /** The experiment whose plot holds the world point (x, y), nearest first. */
  pick(x: number, y: number): string | null {
    let best: { id: string; d: number } | null = null;
    for (const [id, plot] of this.plots) {
      const p = plot.exp.plot;
      if (!onPlot(p, x, y, 2)) continue;
      const d = Math.hypot(x - p.x, y - p.y);
      if (!best || d < best.d) best = { id, d };
    }
    return best?.id ?? null;
  }

  get(id: string): Plot | undefined {
    return this.plots.get(id);
  }

  dispose(): void {
    for (const plot of this.list) plot.dispose();
    this.plots.clear();
    this.list.length = 0;
    this.fenceMaterial.dispose();
  }
}

export type { Body, Plot };
