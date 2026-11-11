import { Color, Group, Mesh, Sphere, Vector3 } from "three/webgpu";
import type { Collider } from "./colliders.ts";
import type { Vec3 } from "./coords.ts";
import { cutawayWanted, easeCutaway } from "./hall-cutaway.ts";
import { finish, Kit, triangles } from "./hall-kit.ts";
import { glassMaterial, HallUniforms, shellMaterial, solidMaterial } from "./hall-materials.ts";
import { HALL, HALL_DETAIL, HALL_SOLIDS } from "./hall-plan.ts";
import { buildHall, LAMP_BAY, LAMP_SIGN } from "./hall-shell.ts";
import { disposeTree } from "./keep.ts";
import type { Glow, Place, PlaceContext, PlaceFrame } from "./place.ts";

/*
 * The workshop hall, east of the keep: the indoor space where robots, assemblies
 * and machines are tested. A building you can always see into (hall-cutaway.ts),
 * lit by the sun through its skylights, door and windows by day and by its own
 * lamps at night, and busy whether or not an experiment is running. Its plan is
 * hall-plan.ts; the building is hall-shell.ts; its materials and the handful of
 * uniforms a frame costs are hall-materials.ts.
 */

/** The hall's own light indoors: a pale fill by day (the sky through the skylights), warm lamps at night (linear). */
const FILL_DAY = new Color(0.33, 0.335, 0.34);
const FILL_NIGHT = new Color(0.66, 0.53, 0.36);
/** Glass: sky-pale and thin by day, warm and bright at night. */
const GLASS_DAY = new Color(0.62, 0.8, 0.92);
const GLASS_NIGHT = new Color(1.5, 1.08, 0.62);
/** Where the sun casts no shadows (low and medium tiers), this much of it and of the sky reaches indoor faces. */
const UNSHADOWED = 0.4;

export class Workshop implements Place {
  readonly group = new Group();
  readonly warmGlows: Glow[] = [];
  readonly coolGlows: Glow[] = [];
  readonly colliders: Collider[] = [];
  readonly movers: { x: number; y: number; r: number }[] = [];
  private readonly u = new HallUniforms();
  private open = 0;
  private lamps = 0;
  private shadowed: boolean;

  constructor(ctx: PlaceContext) {
    const detail = HALL_DETAIL[ctx.tier.name];
    const fixed = new Kit(detail);
    const building = buildHall(detail, fixed);
    this.warmGlows.push(...building.warm);
    this.shadowed = ctx.shadows;

    const shell = new Mesh(building.shell, shellMaterial(this.u));
    shell.castShadow = ctx.shadows;
    shell.receiveShadow = ctx.shadows;
    // The sun's shadows can be dropped while running (the governor's last resort): the indoor shade follows.
    shell.onBeforeRender = (renderer) => {
      this.shadowed = (renderer as unknown as { shadowMap: { enabled: boolean } }).shadowMap.enabled;
    };
    const solid = new Mesh(finish(fixed.m.build(), { solids: HALL_SOLIDS }), solidMaterial(this.u, { wet: true }));
    solid.castShadow = ctx.shadows;
    solid.receiveShadow = ctx.shadows;
    const glass = new Mesh(building.glass, glassMaterial(this.u));
    glass.renderOrder = 1;
    this.group.add(shell, solid, glass);
    // One sphere for everything: out of view, nothing of the hall is drawn.
    const bounds = new Sphere(new Vector3(HALL.x, 5, -HALL.y), Math.hypot(HALL.hx + 6, HALL.hy + 2, 8));
    for (const mesh of [shell, solid, glass]) mesh.geometry.boundingSphere = bounds.clone();
    this.setNight(0);
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
    u.fill.value.copy(FILL_DAY).lerp(FILL_NIGHT, lamps);
    u.glass.value.copy(GLASS_DAY).lerp(GLASS_NIGHT, lamps);
    u.glassOpacity.value = 0.2 + 0.32 * lamps;
    u.room.value.setScalar(0.62).lerp(FILL_NIGHT, lamps * 0.6);
    u.lampColors[LAMP_BAY]!.setRGB(1, 0.93, 0.8).multiplyScalar(0.3 + 1.7 * lamps);
    u.lampColors[LAMP_SIGN]!.setRGB(1, 0.62, 0.25).multiplyScalar(0.1 + 1.5 * lamps);
  }

  setOccupied(_pads: ReadonlySet<string>): void {}

  animate(frame: PlaceFrame): void {
    const u = this.u;
    this.open = easeCutaway(this.open, cutawayWanted(frame.focusX, frame.focusY, frame.distance), frame.dt, frame.motion);
    u.open.value = this.open;
    u.shade.value = this.shadowed ? 1 : UNSHADOWED;
  }

  hover(_x: number, _y: number, _out: Vec3): string | null {
    return null;
  }

  dispose(): void {
    disposeTree(this.group);
  }
}
