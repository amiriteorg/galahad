import { type Camera, Color, type DirectionalLight, Group, type HemisphereLight, Mesh, type Object3D, type Scene, Sphere, Vector3 } from "three/webgpu";
import type { Collider } from "./colliders.ts";
import type { Vec3 } from "./coords.ts";
import { Cutaway, indoors } from "./hall-cutaway.ts";
import { finish, Kit, triangles } from "./hall-kit.ts";
import { floorMaterial, glassMaterial, HallUniforms, type Lighting, shellMaterial, solidMaterial } from "./hall-materials.ts";
import { HALL, HALL_DETAIL, HALL_SOLIDS } from "./hall-plan.ts";
import { buildHall, LAMP_BAY, LAMP_SIGN } from "./hall-shell.ts";
import { disposeTree } from "./keep.ts";
import type { Glow, Place, PlaceContext, PlaceFrame } from "./place.ts";

/*
 * The workshop hall, east of the keep: the indoor space where robots, assemblies
 * and machines are tested. A building you can always see into (hall-cutaway.ts),
 * lit inside by its own light (the sky through its glazing, the sun's patches
 * through its openings, its lamps: hall-materials.ts) and busy whether or not an
 * experiment is running. Its plan is hall-plan.ts; the building is hall-shell.ts.
 */

/** The lamps indoors: a working light by day, warmer and brighter at night (linear colour). */
const LAMPS_DAY = new Color(0.2, 0.195, 0.18);
const LAMPS_NIGHT = new Color(0.62, 0.5, 0.34);

/** The glass: the sky in it by day, lamplit at night, dark seen from inside at night. */
const GLASS_DAY = new Color(0.385, 0.44, 0.495);
const GLASS_LAMPLIT = new Color(1.35, 0.98, 0.6);
const GLASS_DARK = new Color(0.05, 0.08, 0.16);

const v = new Vector3();
const w = new Vector3();

export class Workshop implements Place {
  readonly group = new Group();
  readonly warmGlows: Glow[] = [];
  readonly coolGlows: Glow[] = [];
  readonly colliders: Collider[] = [];
  readonly movers: { x: number; y: number; r: number }[] = [];
  private readonly u = new HallUniforms();
  private readonly cut = new Cutaway();
  private camera: Camera | null = null;
  private hemi: HemisphereLight | null = null;
  private sun: DirectionalLight | null = null;
  private lamps = 0;
  private inside = 0;

  constructor(ctx: PlaceContext) {
    const detail = HALL_DETAIL[ctx.tier.name];
    const lighting: Lighting = { sun: detail > 0, wet: 0.7 };
    const fixed = new Kit(detail);
    const building = buildHall(detail, fixed);
    this.warmGlows.push(...building.warm);

    const shell = new Mesh(building.shell, shellMaterial(this.u, lighting));
    const floor = new Mesh(building.floor, floorMaterial(this.u, lighting));
    const solid = new Mesh(finish(fixed.build(), { solids: HALL_SOLIDS }), solidMaterial(this.u, lighting));
    const glass = new Mesh(building.glass, glassMaterial(this.u));
    glass.renderOrder = 1;
    shell.castShadow = ctx.shadows;
    shell.receiveShadow = ctx.shadows;
    floor.receiveShadow = ctx.shadows;
    solid.castShadow = ctx.shadows;
    solid.receiveShadow = ctx.shadows;
    // The view's camera and the scene's sky and sun, found from the first frame drawn.
    shell.onBeforeRender = (_renderer, scene, camera) => {
      if ((camera as { isPerspectiveCamera?: boolean }).isPerspectiveCamera) this.camera = camera;
      if (!this.hemi) this.findLights(scene);
    };
    this.group.add(floor, solid, shell, glass);
    // One sphere for everything: out of view, nothing of the hall is drawn.
    const bounds = new Sphere(new Vector3(HALL.x, 5, -HALL.y), Math.hypot(HALL.hx + 9, HALL.hy + 2, 8));
    for (const mesh of [shell, solid, glass, floor]) mesh.geometry.boundingSphere = bounds.clone();
    this.setNight(0);
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
  get stats(): { draws: number; triangles: number } {
    let draws = 0;
    let count = 0;
    this.group.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      draws++;
      count += triangles(mesh.geometry);
    });
    return { draws, triangles: count };
  }

  setNight(lamps: number): void {
    this.lamps = lamps;
    const u = this.u;
    u.fill.value.copy(LAMPS_DAY).lerp(LAMPS_NIGHT, lamps);
    u.pools.value = 0.35 + 1.4 * lamps;
    u.lampColors[LAMP_BAY]!.setRGB(1, 0.93, 0.8).multiplyScalar(0.5 + 2.2 * lamps);
    u.lampColors[LAMP_SIGN]!.setRGB(1, 0.62, 0.25).multiplyScalar(0.1 + 1.6 * lamps);
  }

  setOccupied(_pads: ReadonlySet<string>): void {}

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
    // The sky's light, as the scene has it now.
    if (this.hemi) {
      u.sky.value.copy(this.hemi.color).multiplyScalar(this.hemi.intensity);
      u.ground.value.copy(this.hemi.groundColor).multiplyScalar(this.hemi.intensity);
    }
    if (this.sun) {
      u.sun.value.copy(this.sun.color).multiplyScalar(this.sun.intensity);
      w.copy(this.sun.position).sub(this.sun.target.position).normalize();
      u.sunDir.value.copy(w);
      u.sunShadow.value = this.sun.shadow.intensity;
    }
    // The glass: from outside, the sky in it by day and the lamps behind it at night; from inside, the day beyond, or the dark.
    const wantInside = indoors(cx, cy, ch) ? 1 : 0;
    this.inside += frame.motion ? Math.max(-1, Math.min(1, (wantInside - this.inside) * 8 * frame.dt)) : wantInside - this.inside;
    const g = u.glass.value;
    const lamps = this.lamps;
    g.copy(GLASS_DAY).lerp(GLASS_LAMPLIT, lamps * (1 - this.inside)).lerp(GLASS_DARK, lamps * this.inside);
    u.glassOpacity.value = 0.28 + 0.3 * lamps * (1 - this.inside) - 0.1 * this.inside * (1 - lamps);
    u.time.value = frame.motion ? frame.t : u.time.value;
  }

  hover(_x: number, _y: number, _out: Vec3): string | null {
    return null;
  }

  dispose(): void {
    disposeTree(this.group);
  }
}
