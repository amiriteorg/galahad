import { BoxGeometry, Group, Mesh, MeshLambertMaterial } from "three/webgpu";
import type { Collider } from "./colliders.ts";
import { HALL_PAVED } from "./hall-plan.ts";
import { disposeTree } from "./keep.ts";
import { at, Mesher } from "./mesher.ts";
import type { Glow, Place, PlaceContext, PlaceFrame } from "./place.ts";

/*
 * The workshop hall, east of the keep: the indoor space where robots, assemblies
 * and machines are tested. For now only its floor and forecourt are drawn; its
 * plan (walls, door, aisle) is in hall-plan.ts.
 */

export class Workshop implements Place {
  readonly group = new Group();
  readonly warmGlows: Glow[] = [];
  readonly coolGlows: Glow[] = [];
  readonly colliders: Collider[] = [];

  constructor(ctx: PlaceContext) {
    const floor = new Mesher();
    for (const r of HALL_PAVED) floor.add(new BoxGeometry(r.hx * 2, 0.06, r.hy * 2), 0xb9b6ae, at(r.x, 0.04, -r.y), 0);
    const mesh = new Mesh(floor.build(), new MeshLambertMaterial({ vertexColors: true }));
    mesh.receiveShadow = ctx.shadows;
    this.group.add(mesh);
  }

  setNight(_lamps: number): void {}

  setOccupied(_pads: ReadonlySet<string>): void {}

  animate(_frame: PlaceFrame): void {}

  dispose(): void {
    disposeTree(this.group);
  }
}
