import { BoxGeometry, Group, Mesh, MeshLambertMaterial } from "three/webgpu";
import type { Collider } from "./colliders.ts";
import { FIELD_LEVEL, FIELD_PAVED } from "./field-plan.ts";
import { disposeTree } from "./keep.ts";
import { at, Mesher } from "./mesher.ts";
import type { Glow, Place, PlaceContext, PlaceFrame } from "./place.ts";

/*
 * The proving ground, on the heights west of the keep: where aircraft, rockets
 * and ground vehicles are tested. For now only its paving is drawn (the runway,
 * the taxiway and the apron); its plan is in field-plan.ts. Its group stands at
 * the ground's level, so everything in it is placed as if the ground were at 0.
 */

export class ProvingGround implements Place {
  readonly group = new Group();
  readonly warmGlows: Glow[] = [];
  readonly coolGlows: Glow[] = [];
  readonly colliders: Collider[] = [];

  constructor(ctx: PlaceContext) {
    const paving = new Mesher();
    for (const r of FIELD_PAVED) paving.add(new BoxGeometry(r.hx * 2, 0.06, r.hy * 2), 0x8d9097, at(r.x, 0.04, -r.y), 0);
    const mesh = new Mesh(paving.build(), new MeshLambertMaterial({ vertexColors: true }));
    mesh.receiveShadow = ctx.shadows;
    this.group.add(mesh);
    this.group.position.y = FIELD_LEVEL;
  }

  setNight(_lamps: number): void {}

  setOccupied(_pads: ReadonlySet<string>): void {}

  animate(_frame: PlaceFrame): void {}

  dispose(): void {
    disposeTree(this.group);
  }
}
