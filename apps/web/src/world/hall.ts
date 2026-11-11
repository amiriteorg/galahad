import { type Camera, Color, type DirectionalLight, Group, type HemisphereLight, Mesh, type Object3D, type Scene, Sphere, Vector3 } from "three/webgpu";
import type { Collider } from "./colliders.ts";
import type { Vec3 } from "./coords.ts";
import { Cells } from "./hall-cells.ts";
import { Cutaway, indoors } from "./hall-cutaway.ts";
import { HallFlow } from "./hall-flow.ts";
import { finish, Kit, pack, Quads, triangles } from "./hall-kit.ts";
import { Machines } from "./hall-machines.ts";
import { fenceMaterial, floorMaterial, glassMaterial, HallUniforms, indoorLight, type Lighting, rigMaterial, screenMaterial, shaftMaterial, shellMaterial, solidMaterial } from "./hall-materials.ts";
import { CART, CELLS, CRANE, FARM, HALL, HALL_DETAIL, HALL_SOLIDS, inCollider, inHall } from "./hall-plan.ts";
import { Bones } from "./hall-rig.ts";
import { buildHall, buildShafts, LAMP_BAY, LAMP_SIGN } from "./hall-shell.ts";
import { disposeTree } from "./keep.ts";
import type { Glow, Place, PlaceContext, PlaceFrame } from "./place.ts";

/*
 * The workshop hall, east of the keep: the indoor space where robots, assemblies
 * and machines are tested. A building you can always see into (hall-cutaway.ts),
 * lit inside by its own light (the sky through its glazing, the sun's patches
 * through its openings, its lamps: hall-materials.ts), and busy whether or not
 * an experiment is running: a printer farm, a large-format printer and a bridge
 * crane, a cart, an assembly line with two six-axis arms, a CNC mill, a wind
 * tunnel, an electronics bench, and four test cells whose residents test
 * themselves while no experiment needs the cell (hall-flow.ts, hall-machines.ts,
 * hall-cells.ts). Seven draw calls: the shell, its glass, the floor, what stands
 * still, what moves (one skinned mesh), the screens and belts, and the cells' fences;
 * an eighth for the sun's shafts on the medium and high tiers.
 */

/** The lamps indoors: a working light by day, warmer and brighter at night (linear colour). */
const LAMPS_DAY = new Color(0.2, 0.195, 0.18);
const LAMPS_NIGHT = new Color(0.62, 0.5, 0.34);
/** The glass: the sky in it by day, lamplit at night, dark seen from inside at night. */
const GLASS_DAY = new Color(0.385, 0.44, 0.495);
const GLASS_LAMPLIT = new Color(1.35, 0.98, 0.6);
const GLASS_DARK = new Color(0.05, 0.08, 0.16);
/** Machines are only worked while the camera's focus is this near the hall and the camera this close (metres). */
const NEAR = 90;
const CLOSE = 170;
/** How long a cell's resident takes to clear out or come back (seconds). */
const CLEAR = 1.4;

const v = new Vector3();
const w = new Vector3();

export class Workshop implements Place {
  readonly group = new Group();
  readonly warmGlows: Glow[] = [];
  readonly coolGlows: Glow[] = [];
  readonly colliders: Collider[] = [];
  readonly movers: { x: number; y: number; r: number }[] = [{ x: 0, y: 0, r: CART.radius }];
  private readonly u = new HallUniforms();
  private readonly cut = new Cutaway();
  private readonly flow: HallFlow;
  private readonly machines: Machines;
  private readonly cells: Cells;
  private readonly occupied = new Set<string>();
  private camera: Camera | null = null;
  private hemi: HemisphereLight | null = null;
  private sun: DirectionalLight | null = null;
  private lamps = 0;
  private inside = 0;
  private clock = 0;
  private posed = false;
  /** How the hall lights itself on this tier. */
  private readonly lighting: Lighting;

  constructor(ctx: PlaceContext) {
    const tier = ctx.tier.name;
    const detail = HALL_DETAIL[tier];
    const lighting: Lighting = { sun: detail > 0, wet: 0.7 };
    this.lighting = lighting;
    this.flow = new HallFlow({ printers: FARM.count[tier], tote: tier === "low" ? 4 : 6 });
    const fixed = new Kit(detail);
    const rig = new Kit(detail);
    const glassKit = new Kit(detail);
    const quads = new Quads();
    const fenceQuads = new Quads();
    const bones = new Bones();
    const building = buildHall(detail, fixed, glassKit);
    const build = { detail, solid: fixed, rig, glass: glassKit, quads, fences: fenceQuads, bones, warm: this.warmGlows, cool: this.coolGlows };
    this.machines = new Machines(build, this.flow);
    this.cells = new Cells(build, this.machines);
    this.warmGlows.push(...building.warm);

    const shell = new Mesh(pack(building.shell), shellMaterial(this.u, lighting));
    const floor = new Mesh(pack(building.floor), floorMaterial(this.u, lighting));
    const solid = new Mesh(pack(finish(fixed.build(), { solids: HALL_SOLIDS })), solidMaterial(this.u, lighting));
    const glass = new Mesh(pack(glassKit.build()), glassMaterial(this.u));
    const moving = bones.mesh(pack(finish(rig.build(), { inside: true, foot: 0 }), "part"), rigMaterial(this.u, lighting));
    const screens = new Mesh(quads.build(), screenMaterial(this.u));
    const fences = new Mesh(fenceQuads.build(), fenceMaterial(this.u));
    glass.renderOrder = 1;
    fences.renderOrder = 1;
    // The shell casts the hall's shadow outdoors; indoors the hall's own light has none to cast.
    shell.castShadow = ctx.shadows;
    shell.receiveShadow = ctx.shadows;
    floor.receiveShadow = ctx.shadows;
    // The view's camera and the scene's sky and sun, found from the first frame drawn.
    shell.onBeforeRender = (_renderer, scene, camera) => {
      if ((camera as { isPerspectiveCamera?: boolean }).isPerspectiveCamera) this.camera = camera;
      if (!this.hemi) this.findLights(scene);
    };
    this.group.add(floor, solid, shell, moving, screens, fences, glass);
    const meshes: Mesh[] = [shell, solid, glass, floor, moving, screens, fences];
    // Shafts of sunlight through the openings (not on the low tier).
    if (lighting.sun) {
      const shafts = new Mesh(buildShafts(), shaftMaterial(this.u));
      shafts.renderOrder = 2;
      this.group.add(shafts);
      meshes.push(shafts);
    }
    // One sphere for everything: out of view, nothing of the hall is drawn.
    const bounds = new Sphere(new Vector3(HALL.x, 5, -HALL.y), Math.hypot(HALL.hx + 9, HALL.hy + 2, 8));
    for (const mesh of meshes) mesh.geometry.boundingSphere = bounds.clone();
    this.setNight(0);
    this.machines.pose(this.flow, this.u, 0, false);
    this.cells.pose(0, false, this.u, this.machines);
  }

  private findLights(scene: Scene): void {
    const visit = (o: Object3D) => {
      const l = o as { isHemisphereLight?: boolean; isDirectionalLight?: boolean };
      if (l.isHemisphereLight && !this.hemi) this.hemi = o as HemisphereLight;
      if (l.isDirectionalLight && !this.sun) this.sun = o as DirectionalLight;
    };
    for (const child of scene.children) visit(child);
  }

  /** Triangles and draw calls, for the budget (tests and the report). */
  get stats(): { draws: number; triangles: number; bones: number } {
    let draws = 0;
    let count = 0;
    let bones = 0;
    this.group.traverse((o) => {
      const mesh = o as Mesh & { skeleton?: { bones: unknown[] } };
      if (!mesh.isMesh) return;
      draws++;
      count += triangles(mesh.geometry);
      bones += mesh.skeleton?.bones.length ?? 0;
    });
    return { draws, triangles: count, bones };
  }

  /** The simulation (for tests). */
  get work(): HallFlow {
    return this.flow;
  }

  setNight(lamps: number): void {
    this.lamps = lamps;
    const u = this.u;
    u.fill.value.copy(LAMPS_DAY).lerp(LAMPS_NIGHT, lamps);
    u.pools.value = 0.35 + 1.4 * lamps;
    u.lampColors[LAMP_BAY]!.setRGB(1, 0.93, 0.8).multiplyScalar(0.5 + 2.2 * lamps);
    u.lampColors[LAMP_SIGN]!.setRGB(1, 0.62, 0.25).multiplyScalar(0.1 + 1.6 * lamps);
  }

  setOccupied(pads: ReadonlySet<string>): void {
    this.occupied.clear();
    for (const c of CELLS) if (pads.has(c.id)) this.occupied.add(c.id);
  }

  animate(frame: PlaceFrame): void {
    const u = this.u;
    // The hall's frame in the scene (the world's origin floats), and the camera in the hall's frame.
    this.group.updateWorldMatrix(true, false);
    u.shift.value.setFromMatrixPosition(this.group.matrixWorld);
    let cx = frame.focusX;
    let cy = frame.focusY - frame.distance;
    let ch = frame.distance;
    if (this.camera) {
      v.copy(this.camera.position).sub(u.shift.value);
      cx = v.x;
      cy = -v.z;
      ch = v.y;
    }
    this.cut.step(cx, cy, ch, frame.focusX, frame.focusY, frame.distance, frame.dt, frame.motion);
    for (let i = 0; i < 5; i++) u.wallValues[i] = this.cut.walls[i]!;
    u.roof.value = this.cut.roof;
    this.light(frame, cx, cy, ch);
    // The residents clear out of a cell an experiment has taken, and come back when it's free.
    for (let i = 0; i < CELLS.length; i++) {
      const want = this.occupied.has(CELLS[i]!.id) ? 0 : 1;
      const was = u.presentValues[i + 1]!;
      u.presentValues[i + 1] = frame.motion ? Math.max(0, Math.min(1, was + Math.sign(want - was) * (frame.dt / CLEAR))) : want;
    }
    // The machines work only while someone's looking at the hall, and rest under reduced motion.
    const near = Math.hypot(frame.focusX - HALL.x, frame.focusY - HALL.y) < NEAR && frame.distance < CLOSE;
    if (near && frame.motion) {
      const dt = Math.min(frame.dt, 0.1);
      this.clock += dt;
      this.flow.step(dt, frame.galahadX, frame.galahadY);
      u.time.value = this.clock;
    }
    if ((near && frame.motion) || !this.posed) {
      this.machines.pose(this.flow, u, this.clock, frame.motion);
      this.posed = true;
    }
    this.cells.pose(this.clock, frame.motion, u, this.machines);
    const cart = this.flow.cart.pose;
    this.movers[0]!.x = cart.x;
    this.movers[0]!.y = cart.y;
  }

  /**
   * The light indoors, as the hall's own faces take it (an irradiance node: the sky through its glazing, the sun's
   * patches through its openings, its lamps): for whoever walks in (Galahad, his dog: their materials use it there,
   * on every tier, rather than the scene's sun, which no roof stops where there are no shadows).
   */
  insideLight(): ReturnType<typeof indoorLight> {
    return indoorLight(this.u, this.lighting);
  }

  /** The sky's light as the scene has it now, and the glass for where the camera is. */
  private light(frame: PlaceFrame, cx: number, cy: number, ch: number): void {
    const u = this.u;
    if (this.hemi) {
      u.sky.value.copy(this.hemi.color).multiplyScalar(this.hemi.intensity);
      u.ground.value.copy(this.hemi.groundColor).multiplyScalar(this.hemi.intensity);
    }
    if (this.sun) {
      u.sun.value.copy(this.sun.color).multiplyScalar(this.sun.intensity);
      w.copy(this.sun.position).sub(this.sun.target.position).normalize();
      u.sunDir.value.copy(w);
      u.sunShadow.value = this.sun.shadow.intensity;
      // The shafts: in clear sunlight only (a clear sky's hard shadows), and not once the roof is gone.
      u.shafts.value = 0.0055 * this.sun.shadow.intensity * (1 - this.cut.roof) * Math.max(0, Math.min(1, (w.y - 0.06) * 6)) * (1 - frame.night);
    }
    const wantInside = indoors(cx, cy, ch) ? 1 : 0;
    this.inside += frame.motion ? Math.max(-1, Math.min(1, (wantInside - this.inside) * 8 * frame.dt)) : wantInside - this.inside;
    const lamps = this.lamps;
    u.glass.value.copy(GLASS_DAY).lerp(GLASS_LAMPLIT, lamps * (1 - this.inside)).lerp(GLASS_DARK, lamps * this.inside);
    u.glassOpacity.value = 0.28 + 0.3 * lamps * (1 - this.inside) - 0.1 * this.inside * (1 - lamps);
  }

  hover(x: number, y: number, out: Vec3): string | null {
    if (!inHall(x, y)) return null;
    out[0] = x;
    out[1] = y;
    out[2] = 2.4;
    const cart = this.flow.cart.pose;
    if (Math.hypot(x - cart.x, y - cart.y) < CART.radius) return "Cart (AGV)";
    for (const c of CELLS) {
      if (Math.abs(x - c.x) < c.size / 2 && Math.abs(y - c.y) < c.size / 2) {
        // An experiment there has its own label.
        if (this.occupied.has(c.id)) return null;
        out[2] = 3;
        return c.name;
      }
    }
    for (const s of HALL_SOLIDS) if (s.name && inCollider(s.collider, x, y, 0.15)) return s.name;
    if (Math.abs(x - this.flow.bridge.at) < 1.2) {
      out[2] = CRANE.rail;
      return "Bridge crane";
    }
    return null;
  }

  dispose(): void {
    disposeTree(this.group);
  }
}
