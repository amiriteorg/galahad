import { BoxGeometry, CylinderGeometry, ExtrudeGeometry, type Matrix4, Shape, Path as ShapePath } from "three/webgpu";
import { ARM, armFrames, armFramesOut, type Frame } from "./hall-arm.ts";
import { CART_PATH } from "./hall-cart.ts";
import { FIXTURE, type HallFlow, INDEX_TIME, TOTE_FLOOR, TOTE_SLOTS } from "./hall-flow.ts";
import { type Detail, Kit, Quads } from "./hall-kit.ts";
import type { HallUniforms } from "./hall-materials.ts";
import { BENCH, CART, CRANE, DISPATCH, DOCKS, FARM, GANTRY, LINE, MILL, RACKS, SHELVES, stopX, TOOLS, TUNNEL } from "./hall-plan.ts";
import { GANTRY_PRINTER, type PartShape, PRINTER } from "./hall-print.ts";
import { BAR, BELT, Bones, K, SLOT } from "./hall-rig.ts";
import { at } from "./mesher.ts";
import type { Glow } from "./place.ts";

/*
 * The workshop's machines: what stands still goes into the hall's merged solid
 * mesh, what moves into its rig (each moving part on a bone), screens and belts
 * into its screens. `pose` writes the bones and the few uniforms from the
 * simulation (hall-flow.ts) each frame. Sizes are the plan's (hall-plan.ts) and
 * the kinematics' (hall-print.ts, hall-arm.ts): what's drawn is what moves.
 */

export interface Build {
  detail: Detail;
  solid: Kit;
  rig: Kit;
  glass: Kit;
  quads: Quads;
  bones: Bones;
  warm: Glow[];
  cool: Glow[];
}

/** A cylinder centred on (x, y, z) with its axis along world x (or y). */
export function cylX(k: Kit, color: number, x: number, y: number, z: number, r: number, len: number, sides = 12): Kit {
  return k.add(new CylinderGeometry(r, r, len, k.sides(sides)), color, at(x, z, -y, 0, 1, 0, -Math.PI / 2));
}
export function cylY(k: Kit, color: number, x: number, y: number, z: number, r: number, len: number, sides = 12): Kit {
  return k.add(new CylinderGeometry(r, r, len, k.sides(sides)), color, at(x, z, -y, 0, 1, Math.PI / 2, 0));
}

/** A plate `sx` wide (east-west), `sy` long and `sz` thick, centred on (x, y, z), its length tilted up towards +y by `tilt` (radians). */
export function plateY(k: Kit, color: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, tilt: number): Kit {
  return k.add(new BoxGeometry(sx, sz, sy), color, at(x, z, -y, 0, 1, tilt, 0), 0.02);
}
/** The same with its length along x, tilted down towards +x by `tilt`. */
export function plateX(k: Kit, color: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, tilt: number): Kit {
  return k.add(new BoxGeometry(sx, sz, sy), color, at(x, z, -y, 0, 1, 0, -tilt), 0.02);
}

/** A part's solid: its outline (with holes) extruded up its height, standing on z = 0 round its centre. */
export function partGeometry(shape: PartShape): ExtrudeGeometry {
  const s = new Shape();
  shape.outline.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  for (const hole of shape.holes) {
    const h = new ShapePath();
    // Holes wind the other way round.
    [...hole].reverse().forEach(([x, y], i) => (i ? h.lineTo(x, y) : h.moveTo(x, y)));
    h.closePath();
    s.holes.push(h);
  }
  return new ExtrudeGeometry(s, { depth: shape.height, bevelEnabled: false, curveSegments: 1 });
}

/** World axes for an extrusion (along +z) laid in the scene (y up). */
const EXTRUDED: Matrix4 = at(0, 0, 0, 0, 1, -Math.PI / 2);

interface PrinterBones {
  beam: number;
  head: number;
  bed: number;
  bar: number;
  spool: number;
}

interface ArmBones {
  links: number[];
  fingers: [number, number];
}

const frames = armFramesOut();

export class Machines {
  readonly printers: PrinterBones[] = [];
  readonly parts: number[] = [];
  readonly big: number[] = [];
  readonly gantry = { beam: 0, carriage: 0, head: 0 };
  readonly crane = { bridge: 0, trolley: 0, hook: 0, cables: [0, 0] };
  cart = 0;
  readonly carriers: number[] = [];
  readonly arms: ArmBones[] = [];
  door = 0;
  readonly mill = { table: 0, head: 0, spindle: 0 };
  readonly tunnel = { fan: 0, model: 0 };

  constructor(
    private readonly b: Build,
    flow: HallFlow,
  ) {
    this.farm(flow);
    this.collector();
    this.parts.push(...flow.parts.map((p) => this.part(p.shape, p.index + 1)));
    this.big.push(...flow.big.map((j, k) => this.part(j.shape, flow.parts.length + 1 + k)));
    this.largePrinter();
    this.dispatch();
    this.overhead();
    this.agv();
    this.line();
    LINE.arms.forEach((a, i) => this.arms.push(this.arm(a.x, a.y, LINE.pedestal, i === 0 ? "gripper" : "driver", 0)));
    this.cnc();
    this.windTunnel();
    this.electronics();
    this.storage();
  }

  // ---------- the printer farm ----------

  private farm(flow: HallFlow): void {
    const { solid, rig, bones, quads, detail, cool } = this.b;
    const bench = FARM.bench;
    const top = FARM.top;
    // The bench: a steel frame and a laminate top, a shelf of spare spools under it.
    solid.panel(K.cream, bench.x, bench.y, top - 0.03, bench.hx * 2, bench.hy * 2, 0.06, 0, 0.02, 0.02);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) solid.box(K.steel, bench.x + sx * (bench.hx - 0.08), bench.y + sy * (bench.hy - 0.08), (top - 0.06) / 2, 0.07, 0.07, top - 0.06);
    if (detail > 0) for (let i = 1; i < 4; i++) for (const sy of [-1, 1]) solid.box(K.steel, bench.x - bench.hx + (i * bench.hx * 2) / 4, bench.y + sy * (bench.hy - 0.08), (top - 0.06) / 2, 0.06, 0.06, top - 0.06);
    solid.slab(K.steel, bench.x - bench.hx + 0.05, bench.x + bench.hx - 0.05, bench.y - bench.hy + 0.05, bench.y + bench.hy - 0.05, 0.18, 0.22);
    const spoolColors = [0xe8853a, 0x4f9be3, 0x5cbf6e, 0xf7f5f0, 0x3f434c, 0xe35d4f, 0xf2c14e];
    for (let i = 0; i < (detail === 0 ? 4 : 12); i++) cylY(solid, spoolColors[i % spoolColors.length]!, bench.x - bench.hx + 0.45 + i * 0.78, bench.y, 0.38, 0.16, 0.09, 14);

    flow.printers.forEach((p, i) => {
      const x = p.x;
      const y = p.y;
      const P = PRINTER;
      const h = P.half;
      // The frame: four posts, rails round the top and the foot, the lead screws at the back, the chute at the front.
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) solid.box(K.dark, x + sx * h, y + sy * h, top + P.height / 2, 0.045, 0.045, P.height);
      for (const z of [top + 0.02, top + P.height - 0.02]) {
        for (const sy of [-1, 1]) solid.box(K.dark, x, y + sy * h, z, h * 2, 0.04, 0.04);
        for (const sx of [-1, 1]) solid.box(K.dark, x + sx * h, y, z, 0.04, h * 2, 0.04);
      }
      // The head's Y rails along the top's sides.
      for (const sx of [-1, 1]) solid.box(K.alu, x + sx * (h - 0.05), y, top + P.nozzle + 0.14, 0.035, h * 2 - 0.06, 0.03);
      for (const sx of [-1, 1]) solid.rod(K.alu, x + sx * 0.22, y + 0.4, top + 0.02, x + sx * 0.22, y + 0.4, top + P.height - 0.02, 0.012, 6);
      solid.panel(K.cream, x, y + 0.4, top + 0.07, 0.6, 0.1, 0.1, 0, 0.02, 0.02);
      // The chute: a sloping tray from the bed's front edge (at the sweeper's level) down to the belt's far edge.
      const y0 = y - P.bed;
      const y1 = FARM.belt.y + FARM.belt.half;
      const z0 = top + P.eject;
      const z1 = FARM.belt.top + 0.03;
      const len = Math.hypot(y0 - y1, z0 - z1);
      const slope = Math.atan2(z0 - z1, y0 - y1);
      plateY(solid, K.alu, x, (y0 + y1) / 2, (z0 + z1) / 2 - 0.012, 0.5, len, 0.02, slope);
      for (const sx of [-1, 1]) solid.rod(K.alu, x + sx * 0.25, y0, z0 + 0.03, x + sx * 0.25, y1, z1 + 0.03, 0.012, 4);
      // The display and the status light.
      quads.add(K.screen, [x + h - 0.2, y - h - 0.03, top + 0.32], [0.17, 0, 0], [0, 0, 0.09], 1, BAR.printer + i);
      solid.glow(SLOT.printer + i).box(K.white, x, y - h, top + P.height + 0.025, h * 1.6, 0.03, 0.015, 0, 0).glow(0);
      cool.push([x, top + P.height + 0.1, -(y - h), 0.5]);
      // The spool holder on its right side.
      solid.rod(K.dark, x + h, y + 0.1, top + 0.82, x + h + 0.12, y + 0.1, top + 0.82, 0.015, 6);

      const beam = bones.add();
      rig.bone(beam);
      rig.box(K.dark, 0, 0, 0, h * 2 - 0.1, 0.045, 0.045);
      for (const sx of [-1, 1]) rig.box(K.orange, sx * (h - 0.05), 0, 0.0, 0.06, 0.08, 0.06);
      const head = bones.add();
      rig.bone(head);
      rig.panel(K.orange, 0, 0, 0.11, 0.1, 0.09, 0.12, 0, 0.03, 0.015);
      rig.box(K.dark, 0, -0.055, 0.085, 0.07, 0.02, 0.07);
      rig.cyl(K.copper, 0, 0, 0, 0.004, 0.03, 6, 0.016);
      rig.cyl(K.alu, 0, 0, 0.03, 0.02, 0.025, 6);
      const bed = bones.add();
      rig.bone(bed);
      rig.box(K.pei, 0, 0, -0.004, P.bed * 2, P.bed * 2, 0.008, 0, 0.02);
      rig.box(K.alu, 0, 0, -0.018, P.bed * 2 + 0.02, P.bed * 2 + 0.02, 0.02, 0, 0.02);
      rig.box(K.dark, 0, 0.36, -0.03, 0.5, 0.12, 0.03, 0, 0.02);
      for (const sx of [-1, 1]) rig.cyl(K.dark, sx * 0.22, 0.4, -0.06, 0.03, 0.06, 6);
      const bar = bones.add();
      rig.bone(bar);
      rig.box(K.orange, 0, 0, 0.022, P.bed * 2 + 0.03, P.bar * 2, 0.04, 0, 0.02);
      for (const sx of [-1, 1]) rig.box(K.dark, sx * (P.bed + 0.02), 0, 0.0, 0.02, 0.05, 0.06);
      const spool = bones.add();
      rig.bone(spool);
      cylX(rig, p.job.shape.color, 0, 0, 0, 0.17, 0.08, 16);
      cylX(rig, K.white, 0.045, 0, 0, 0.1, 0.012, 12);
      if (detail > 0) rig.box(K.dark, 0, 0, 0.11, 0.09, 0.02, 0.04);
      rig.bone(0);
      this.printers.push({ beam, head, bed, bar, spool });
    });
  }

  /** The collector belt in front of the printers, out to the cart's dock, with a lip into the tote at its end. */
  private collector(): void {
    const { solid, quads, detail } = this.b;
    const B = FARM.belt;
    const len = B.east - B.west;
    const mid = (B.east + B.west) / 2;
    solid.slab(K.steel, B.west, B.east, B.y - B.half - 0.04, B.y - B.half, B.top - 0.12, B.top + 0.05);
    solid.slab(K.steel, B.west, B.east, B.y + B.half, B.y + B.half + 0.04, B.top - 0.12, B.top + 0.05);
    solid.slab(K.dark, B.west, B.east, B.y - B.half, B.y + B.half, B.top - 0.1, B.top - 0.004);
    for (const x of [B.west + 0.1, B.east - 0.1]) cylY(solid, K.alu, x, B.y, B.top - 0.06, 0.055, B.half * 2 + 0.02, 10);
    const legs = Math.max(2, Math.round(len / (detail === 0 ? 4 : 2)));
    for (let i = 0; i <= legs; i++) {
      const x = B.west + 0.15 + ((len - 0.3) * i) / legs;
      for (const s of [-1, 1]) solid.box(K.steel, x, B.y + s * (B.half - 0.02), (B.top - 0.12) / 2, 0.05, 0.05, B.top - 0.12);
    }
    quads.add(0x55595f, [B.west, B.y - B.half, B.top], [len, 0, 0], [0, B.half * 2, 0], 2, BELT.collector, 0, len / 0.25);
    // The end stop's gate and the lip over into the tote.
    solid.box(K.yellow, B.east - 0.02, B.y, B.top + 0.16, 0.04, B.half * 2 + 0.08, 0.06);
    for (const s of [-1, 1]) solid.box(K.yellow, B.east - 0.02, B.y + s * (B.half + 0.02), B.top + 0.07, 0.04, 0.04, 0.16);
    plateX(solid, K.alu, B.east + 0.11, B.y, B.top - 0.03, 0.24, B.half * 2, 0.015, 0.3);
    void mid;
  }

  /** A part (small or big) on its own bone, tagged for its print to grow. */
  private part(shape: PartShape, tag: number): number {
    const { rig, bones } = this.b;
    const i = bones.add();
    rig.bone(i).tag("part", tag);
    rig.add(partGeometry(shape), shape.color, EXTRUDED, 0.05);
    rig.tag("part", 0).bone(0);
    return i;
  }

  // ---------- the large-format printer and the dispatch ----------

  private largePrinter(): void {
    const { solid, rig, bones, quads, detail, cool } = this.b;
    const F = GANTRY.frame;
    const H = GANTRY.height;
    const bed = GANTRY.bed;
    // Four posts and the rails the gantry runs on (along y), a bed on legs.
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) solid.panel(K.dark, F.x + sx * (F.hx - 0.08), F.y + sy * (F.hy - 0.08), H / 2, 0.14, 0.14, H, 0, 0.03, 0.02);
    for (const sx of [-1, 1]) solid.box(K.alu, F.x + sx * (F.hx - 0.08), F.y, H - 0.06, 0.16, F.hy * 2, 0.12);
    for (const sy of [-1, 1]) solid.box(K.dark, F.x, F.y + sy * (F.hy - 0.08), H - 0.06, F.hx * 2, 0.12, 0.12);
    solid.panel(K.pei, bed.x, bed.y, GANTRY.bedTop - 0.02, bed.hx * 2, bed.hy * 2, 0.04, 0, 0.02, 0.01);
    solid.slab(K.steel, bed.x - bed.hx + 0.1, bed.x + bed.hx - 0.1, bed.y - bed.hy + 0.1, bed.y + bed.hy - 0.1, 0.1, GANTRY.bedTop - 0.04);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) solid.box(K.steel, bed.x + sx * (bed.hx - 0.15), bed.y + sy * (bed.hy - 0.15), 0.05, 0.12, 0.12, 0.1);
    // Its big spool and control cabinet on the west side.
    cylY(solid, 0x5a6070, F.x - F.hx - 0.35, F.y + 0.6, 1.2, 0.35, 0.2, 18);
    solid.box(K.dark, F.x - F.hx - 0.35, F.y + 0.6, 0.55, 0.1, 0.1, 1.1);
    solid.panel(K.cream, F.x - F.hx - 0.4, F.y - 0.6, 0.7, 0.5, 0.7, 1.4, 0, 0.03, 0.03);
    quads.add(K.screen, [F.x - F.hx - 0.66, F.y - 0.35, 1.05], [0, -0.5, 0], [0, 0, 0.28], 1, BAR.gantry);
    solid.glow(SLOT.gantry).box(K.white, F.x - F.hx - 0.4, F.y - 0.6, 1.45, 0.2, 0.2, 0.1, 0, 0).glow(0);
    cool.push([F.x - F.hx - 0.4, 1.6, -(F.y - 0.6), 0.6]);

    this.gantry.beam = bones.add();
    rig.bone(this.gantry.beam);
    rig.panel(K.yellow, 0, 0, 0, F.hx * 2 - 0.1, 0.16, 0.18, 0, 0.03, 0.02);
    for (const sx of [-1, 1]) rig.box(K.dark, sx * (F.hx - 0.08), 0, 0.02, 0.22, 0.26, 0.14);
    this.gantry.carriage = bones.add();
    rig.bone(this.gantry.carriage);
    rig.panel(K.orange, 0, -0.12, 0, 0.28, 0.1, 0.32, 0, 0.03, 0.02);
    rig.box(K.alu, 0, -0.2, -0.6, 0.06, 0.06, 1.6);
    this.gantry.head = bones.add();
    rig.bone(this.gantry.head);
    rig.panel(K.cream, 0, 0, 0.16, 0.18, 0.16, 0.22, 0, 0.03, 0.02);
    rig.cyl(K.copper, 0, 0, 0, 0.008, 0.05, 6, 0.03);
    if (detail > 0) rig.box(K.dark, 0, 0.1, 0.3, 0.14, 0.04, 0.12);
    rig.bone(0);
  }

  private dispatch(): void {
    const { solid, rig, bones, quads, detail } = this.b;
    const T = DISPATCH.table;
    const R = DISPATCH.room;
    // The roller table, running north into the room's door.
    for (const sx of [-1, 1]) solid.box(K.steel, T.x + sx * (T.hx - 0.04), T.y, DISPATCH.top - 0.08, 0.08, T.hy * 2, 0.14);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) solid.box(K.steel, T.x + sx * (T.hx - 0.06), T.y + sy * (T.hy - 0.1), (DISPATCH.top - 0.15) / 2, 0.07, 0.07, DISPATCH.top - 0.15);
    const rollers = detail === 0 ? 6 : 14;
    for (let i = 0; i < rollers; i++) cylX(solid, K.alu, T.x, T.y - T.hy + 0.1 + ((T.hy * 2 - 0.2) * i) / (rollers - 1), DISPATCH.top - 0.035, 0.035, T.hx * 2 - 0.1, 8);
    void quads;
    // The room: panelled walls, a flat roof, a roller door in its south face.
    const z1 = DISPATCH.height;
    const door = DISPATCH.door;
    solid.slab(K.cream, R.x - R.hx, R.x - door.half, R.y - R.hy, R.y - R.hy + 0.1, 0, z1);
    solid.slab(K.cream, R.x + door.half, R.x + R.hx, R.y - R.hy, R.y - R.hy + 0.1, 0, z1);
    solid.slab(K.cream, R.x - door.half, R.x + door.half, R.y - R.hy, R.y - R.hy + 0.1, door.height, z1);
    for (const sx of [-1, 1]) solid.slab(K.cream, R.x + sx * R.hx - 0.05, R.x + sx * R.hx + 0.05, R.y - R.hy, R.y + R.hy, 0, z1);
    solid.slab(K.cream, R.x - R.hx, R.x + R.hx, R.y + R.hy - 0.1, R.y + R.hy, 0, z1);
    solid.slab(K.steel, R.x - R.hx - 0.06, R.x + R.hx + 0.06, R.y - R.hy - 0.06, R.y + R.hy + 0.02, z1, z1 + 0.08);
    solid.slab(K.orange, R.x - door.half - 0.08, R.x + door.half + 0.08, R.y - R.hy - 0.05, R.y - R.hy, door.height, door.height + 0.25);
    solid.slab(K.charcoal, R.x - door.half, R.x + door.half, R.y - R.hy + 0.04, R.y - R.hy + 0.08, 0, door.height);
    solid.glow(SLOT.door).box(K.white, R.x + door.half + 0.3, R.y - R.hy - 0.02, door.height + 0.15, 0.1, 0.04, 0.1, 0, 0).glow(0);
    this.door = bones.add();
    rig.bone(this.door);
    // The door's slats (it rolls up into the head: drawn as a panel rising behind the lintel).
    rig.slab(K.alu, -door.half + 0.02, door.half - 0.02, -0.03, 0.03, 0, door.height);
    if (detail > 0) for (let i = 1; i < 8; i++) rig.slab(K.steel, -door.half + 0.02, door.half - 0.02, -0.035, -0.03, (door.height * i) / 8 - 0.01, (door.height * i) / 8 + 0.01);
    rig.bone(0);
  }

  // ---------- the bridge crane ----------

  private overhead(): void {
    const { rig, bones, detail, warm } = this.b;
    const C = CRANE;
    const span = C.north - C.south;
    const deck = C.rail + 0.95;
    this.crane.bridge = bones.add();
    rig.bone(this.crane.bridge);
    // Two box girders on end trucks that ride the rails.
    for (const sx of [-1, 1]) rig.panel(K.yellow, sx * 0.42, 0, deck - 0.35, 0.24, span - 0.6, 0.7, 0, 0.02, 0.03);
    for (const sy of [-1, 1]) {
      rig.panel(K.dark, 0, sy * (span / 2), C.rail + 0.25, 1.6, 0.42, 0.42, 0, 0.02, 0.03);
      for (const sx of [-1, 1]) cylY(rig, K.charcoal, sx * 0.55, sy * (span / 2), C.rail + 0.1, 0.12, 0.2, 10);
      rig.box(K.orange, 0, sy * (span / 2 - 0.35), deck - 0.2, 0.5, 0.3, 0.3);
    }
    if (detail > 0) for (let i = 1; i < 6; i++) rig.box(K.dark, 0, -span / 2 + (span * i) / 6, deck - 0.05, 0.84, 0.08, 0.06);
    this.crane.trolley = bones.add();
    rig.bone(this.crane.trolley);
    rig.panel(K.orange, 0, 0, 0.18, 1.2, 0.95, 0.36, 0, 0.02, 0.03);
    cylX(rig, K.alu, 0, 0, 0.0, 0.2, 0.7, 14);
    rig.box(K.dark, 0.5, 0.25, 0.45, 0.3, 0.3, 0.2);
    rig.glow(SLOT.crane).box(K.white, -0.5, -0.4, 0.42, 0.1, 0.1, 0.1, 0, 0).glow(0);
    this.crane.hook = bones.add();
    rig.bone(this.crane.hook);
    // The hook block, and under it a vacuum lifter: a beam with pads.
    rig.panel(K.yellow, 0, 0, 0.55, 0.36, 0.26, 0.4, 0, 0.03, 0.02);
    for (const sx of [-1, 1]) cylY(rig, K.dark, sx * 0.08, 0, 0.66, 0.09, 0.28, 10);
    rig.box(K.dark, 0, 0, 0.3, 0.06, 0.06, 0.18);
    rig.panel(K.orange, 0, 0, 0.17, 0.8, 0.16, 0.1, 0, 0.02, 0.02);
    rig.cyl(K.rubber, 0, 0, 0, 0.16, 0.05, 14);
    rig.cyl(K.steel, 0, 0, 0.05, 0.12, 0.07, 12);
    rig.glow(SLOT.vacuum).box(K.white, 0.3, 0, 0.23, 0.05, 0.05, 0.03, 0, 0).glow(0);
    for (let c = 0; c < 2; c++) {
      this.crane.cables[c] = bones.add();
      rig.bone(this.crane.cables[c]!);
      rig.box(K.charcoal, 0, 0, 0.5, 0.025, 0.025, 1, 0, 0);
    }
    rig.bone(0);
    warm.push([C.park.x, C.rail + 1, -C.park.y, 0.6]);
  }

  // ---------- the cart ----------

  private agv(): void {
    const { solid, rig, bones, detail } = this.b;
    const C = CART;
    this.cart = bones.add();
    rig.bone(this.cart);
    // Its frame: x along the lane, y across, z up from the floor.
    rig.panel(K.cream, 0, 0, 0.21, C.length, C.width, 0.3, 0, 0.03, 0.05);
    for (const sx of [-1, 1]) {
      rig.box(K.charcoal, sx * (C.length / 2 + 0.03), 0, 0.17, 0.06, C.width - 0.1, 0.16);
      rig.glow(SLOT.cart).box(K.white, sx * (C.length / 2 + 0.065), 0, 0.27, 0.01, C.width * 0.6, 0.03, 0, 0).glow(0);
      rig.cyl(K.dark, sx * (C.length / 2 - 0.1), 0, 0.36, 0.05, 0.06, 10);
      for (const sy of [-1, 1]) cylY(rig, K.rubber, sx * (C.length / 2 - 0.25), sy * (C.width / 2 - 0.08), 0.08, 0.08, 0.1, 12);
    }
    rig.box(K.orange, 0, 0, C.deck - 0.01, C.length - 0.06, C.width - 0.06, 0.02, 0, 0.02);
    // The tote.
    const t = C.tote;
    const z0 = C.deck;
    rig.box(K.blue, 0, 0, z0 + TOTE_FLOOR / 2, t.length, t.width, TOTE_FLOOR, 0, 0.02);
    for (const sx of [-1, 1]) rig.box(K.blue, sx * (t.length / 2 - 0.012), 0, z0 + t.height / 2, 0.024, t.width, t.height, 0, 0.03);
    for (const sy of [-1, 1]) rig.box(K.blue, 0, sy * (t.width / 2 - 0.012), z0 + t.height / 2, t.length - 0.05, 0.024, t.height, 0, 0.03);
    if (detail > 0) for (const sx of [-1, 1]) rig.box(K.dark, sx * (t.length / 2 + 0.005), 0, z0 + t.height - 0.06, 0.012, 0.16, 0.04);
    rig.bone(0);
    // Its charger at the printers' dock: a plate on the floor and a post.
    const dock = CART_PATH.at(0, { x: 0, y: 0, heading: 0 });
    solid.slab(K.dark, dock.x - 0.45, dock.x + 0.45, dock.y - 0.3, dock.y + 0.3, 0.07, 0.085);
    solid.panel(K.cream, dock.x + 0.75, dock.y + 0.35, 0.45, 0.22, 0.3, 0.9, 0, 0.02, 0.02);
    solid.glow(SLOT.dock).box(K.white, dock.x + 0.63, dock.y + 0.35, 0.75, 0.01, 0.12, 0.05, 0, 0).glow(0);
  }

  // ---------- the assembly line ----------

  private line(): void {
    const { solid, rig, bones, quads, glass, detail, cool } = this.b;
    const L = LINE;
    const len = L.east - L.west;
    // The conveyor: side frames, legs, its belt, the drums.
    for (const s of [-1, 1]) solid.slab(K.steel, L.west, L.east, L.y + s * L.half - 0.04, L.y + s * L.half + 0.04, L.top - 0.16, L.top + 0.06);
    solid.slab(K.dark, L.west, L.east, L.y - L.half + 0.04, L.y + L.half - 0.04, L.top - 0.12, L.top - 0.004);
    for (let i = 0; i <= Math.round(len / 2.4); i++) {
      const x = L.west + 0.2 + ((len - 0.4) * i) / Math.round(len / 2.4);
      for (const s of [-1, 1]) solid.box(K.steel, x, L.y + s * (L.half - 0.04), (L.top - 0.16) / 2, 0.06, 0.06, L.top - 0.16);
    }
    quads.add(0x4f535a, [L.west, L.y - L.half + 0.04, L.top], [len, 0, 0], [0, (L.half - 0.04) * 2, 0], 2, BELT.conveyor, 0, len / 0.3);
    // The tunnels at either end, with strip curtains.
    for (const [x0, x1] of [L.infeed, L.outfeed]) {
      for (const s of [-1, 1]) solid.slab(K.cream, x0, x1, L.y + s * 0.85 - 0.04, L.y + s * 0.85 + 0.04, 0, L.tunnel);
      solid.panel(K.cream, (x0 + x1) / 2, L.y, L.tunnel - 0.05, x1 - x0, 1.78, 0.1, 0, 0.02, 0.02);
      solid.box(K.orange, (x0 + x1) / 2, L.y, L.tunnel - 0.18, x1 - x0 + 0.02, 1.8, 0.06);
      const inner = x0 === L.infeed[0] ? x1 : x0;
      const strips = detail === 0 ? 3 : 7;
      for (let i = 0; i < strips; i++) solid.box(0x9db4c8, inner, L.y - 0.6 + (1.2 * (i + 0.5)) / strips, (L.top + 0.05 + L.tunnel - 0.1) / 2, 0.01, 1.2 / strips - 0.02, L.tunnel - 0.1 - L.top - 0.05, 0, 0);
      const outer = x0 === L.infeed[0] ? x0 : x1;
      solid.slab(K.cream, outer - 0.04, outer + 0.04, L.y - 0.85, L.y + 0.85, 0, L.tunnel);
    }
    // The inspection arch: two posts, a beam, a camera and a ring light.
    const ix = stopX(L.inspect);
    for (const s of [-1, 1]) solid.panel(K.cream, ix, L.y + s * 0.62, 0.95, 0.14, 0.14, 1.9, 0, 0.02, 0.02);
    solid.panel(K.cream, ix, L.y, 1.92, 0.18, 1.4, 0.14, 0, 0.02, 0.02);
    solid.box(K.dark, ix, L.y, 1.75, 0.16, 0.16, 0.2);
    solid.glow(SLOT.inspect).cyl(K.white, ix, L.y, 1.62, 0.13, 0.03, 16, 0.13, 0).glow(0);
    cool.push([ix, 1.6, -L.y, 0.5]);
    // The arms' pedestals, and the screw feeder.
    for (const a of L.arms) {
      solid.cyl(K.steel, a.x, a.y, 0, 0.45, 0.06, 16);
      solid.cyl(K.cream, a.x, a.y, 0.06, 0.34, L.pedestal - 0.06, 16, 0.3);
    }
    const f = L.feeder;
    solid.cyl(K.steel, f.x, f.y, 0, f.r - 0.05, f.top - 0.2, 10);
    solid.cyl(K.alu, f.x, f.y, f.top - 0.2, f.r - 0.06, 0.2, 14, f.r);
    solid.cyl(K.dark, f.x, f.y, f.top - 0.03, f.r - 0.04, 0.02, 14);
    solid.glow(SLOT.feeder).box(K.white, f.x + f.r - 0.02, f.y, f.top - 0.12, 0.02, 0.06, 0.04, 0, 0).glow(0);
    // A control cabinet with a screen, between the line and the CNC.
    solid.panel(K.cream, 86.2, -14.2, 0.9, 0.7, 0.5, 1.8, 0, 0.03, 0.03);
    quads.add(K.screen, [85.95, -13.94, 1.2], [0.5, 0, 0], [0, 0, 0.36], 0, 3);
    void glass;
    // The carriers: pallets with a fixture plate.
    for (let k = 0; k < L.stops; k++) {
      const c = bones.add();
      this.carriers.push(c);
      rig.bone(c);
      rig.panel(K.dark, 0, 0, 0.025, 0.62, 0.64, 0.05, 0, 0.02, 0.01);
      rig.box(K.blue, 0, 0, FIXTURE - 0.01, 0.44, 0.44, 0.02, 0, 0.02);
      if (detail > 0) for (const sx of [-1, 1]) for (const sy of [-1, 1]) rig.cyl(K.alu, sx * 0.17, sy * 0.17, FIXTURE, 0.012, 0.03, 6);
    }
    rig.bone(0);
  }

  /** A six-axis arm on a pedestal at (x, y), `h` high; `fade` tags it to a cell's resident. Its tool: a gripper, a screwdriver, or a test weight. */
  arm(x: number, y: number, h: number, tool: "gripper" | "driver" | "weight", fade: number): ArmBones {
    const { rig, bones, detail } = this.b;
    rig.tag("fade", fade);
    const links: number[] = [];
    for (let i = 0; i < 6; i++) links.push(bones.add());
    // The fixed base on the pedestal (bound to the rest bone, at the arm's place).
    rig.bone(0);
    if (fade) {
      rig.cyl(K.steel, x, y, 0, 0.45, 0.06, 16);
      rig.cyl(K.cream, x, y, 0.06, 0.34, h - 0.06, 16, 0.3);
    }
    rig.cyl(K.dark, x, y, h, 0.3, 0.1, 16);
    // Turret: a housing up to the shoulder, and the shoulder's motor across.
    rig.bone(links[0]!);
    rig.cyl(K.orange, 0, 0, 0.1, 0.28, 0.18, 16, 0.26);
    rig.panel(K.orange, 0, 0, 0.4, 0.34, 0.4, 0.3, 0, 0.03, 0.05);
    cylY(rig, K.dark, 0, 0, ARM.d1, 0.19, 0.46, 16);
    // Upper arm.
    rig.bone(links[1]!);
    rig.panel(K.cream, 0, 0.0, ARM.a2 / 2, 0.2, 0.24, ARM.a2 - 0.1, 0, 0.03, 0.05);
    cylY(rig, K.dark, 0, 0, ARM.a2, 0.15, 0.4, 16);
    if (detail > 0) cylY(rig, K.orange, 0, 0.21, 0, 0.13, 0.04, 14);
    // Forearm: its rear housing (it doesn't roll) …
    rig.bone(links[2]!);
    rig.panel(K.orange, 0, 0, 0.18, 0.26, 0.24, 0.36, 0, 0.03, 0.04);
    // … and its front tube, which rolls with the wrist.
    rig.bone(links[3]!);
    rig.cyl(K.cream, 0, 0, 0.36, 0.085, ARM.d4 - 0.48, 14, 0.075);
    for (const s of [-1, 1]) rig.box(K.cream, 0, s * 0.075, ARM.d4 - 0.06, 0.12, 0.03, 0.16);
    // The hand: the wrist's pitch joint and a short neck to the flange.
    rig.bone(links[4]!);
    cylY(rig, K.dark, 0, 0, 0, 0.07, 0.12, 12);
    rig.cyl(K.orange, 0, 0, 0.0, 0.06, ARM.d6 - 0.02, 12);
    // The flange and the tool.
    rig.bone(links[5]!);
    rig.cyl(K.dark, 0, 0, -0.02, 0.07, 0.03, 14);
    if (tool === "weight") {
      rig.cyl(K.steel, 0, 0, 0.01, 0.15, 0.12, 14);
      rig.cyl(K.yellow, 0, 0, 0.13, 0.15, 0.02, 14);
    } else if (tool === "driver") {
      rig.cyl(K.charcoal, 0, 0, 0.01, 0.055, 0.17, 12, 0.04);
      rig.cyl(K.orange, 0, 0, 0.06, 0.06, 0.03, 12);
      rig.cyl(K.alu, 0, 0, 0.18, 0.012, ARM.tool - 0.18, 6, 0.006);
    } else rig.panel(K.charcoal, 0, 0, 0.06, 0.18, 0.08, 0.1, 0, 0.02, 0.02);
    const fingers: [number, number] = [bones.add(), bones.add()];
    if (tool === "gripper") {
      for (const f of fingers) {
        rig.bone(f);
        rig.box(K.alu, 0, 0, 0.18, 0.02, 0.05, 0.16, 0, 0.02);
      }
    }
    rig.bone(0).tag("fade", 0);
    return { links, fingers };
  }

  // ---------- along the walls ----------

  private cnc(): void {
    const { solid, rig, bones, glass, quads, cool } = this.b;
    const M = MILL;
    const x0 = M.x - M.hx;
    const x1 = M.x + M.hx;
    const y0 = M.y - M.hy;
    const y1 = M.y + M.hy;
    const top = 2.5;
    // The enclosure: a cream cabinet with an orange band, a big window in its door (north face).
    solid.slab(K.cream, x0, x1, y0, y0 + 0.1, 0, top);
    for (const x of [x0, x1]) solid.slab(K.cream, x - (x === x0 ? 0 : 0.1), x + (x === x0 ? 0.1 : 0), y0, y1, 0, top);
    solid.slab(K.cream, x0, x1, y0, y1, top - 0.1, top);
    solid.slab(K.cream, x0, x1, y1 - 0.1, y1, 0, 0.75);
    solid.slab(K.cream, x0, x1, y1 - 0.1, y1, 2.05, top - 0.1);
    for (const x of [x0 + 0.1, x1 - 0.1]) solid.slab(K.cream, x - (x < M.x ? 0 : 0.35), x + (x < M.x ? 0.35 : 0), y1 - 0.1, y1, 0.75, 2.05);
    solid.slab(K.orange, x0 - 0.01, x1 + 0.01, y1 - 0.02, y1 + 0.01, 2.1, 2.25);
    solid.slab(K.dark, x0 + 0.45, x1 - 0.45, y1 - 0.11, y1 - 0.07, 0.75, 0.8);
    glass.slab(0xffffff, x0 + 0.45, x1 - 0.45, y1 - 0.06, y1 - 0.04, 0.8, 2.05, 0);
    // Inside: the machine's bed and column.
    solid.slab(K.dark, x0 + 0.3, x1 - 0.3, y0 + 0.2, y1 - 0.4, 0, 0.75);
    solid.panel(K.steel, M.x, y0 + 0.45, 1.5, 1.2, 0.5, 1.5, 0, 0.03, 0.04);
    solid.glow(SLOT.cnc).box(K.white, x1 - 0.05, y1 - 0.02, top - 0.25, 0.08, 0.06, 0.2, 0, 0).glow(0);
    solid.glow(SLOT.work).box(K.white, M.x, y0 + 0.6, 2.3, 1.2, 0.08, 0.03, 0, 0).glow(0);
    quads.add(K.screen, [x1 + 0.02, y1 - 0.15, 1.3], [0, -0.45, 0], [0, 0, 0.32], 1, BAR.cnc);
    cool.push([M.x, 1.6, -(y1 + 0.3), 0.8]);
    this.mill.table = bones.add();
    rig.bone(this.mill.table);
    rig.panel(K.alu, 0, 0, 0.82, 1.3, 0.7, 0.12, 0, 0.02, 0.02);
    rig.box(K.dark, 0, 0, 0.92, 0.3, 0.2, 0.08);
    rig.box(0xd8dde2, 0, 0, 1.0, 0.36, 0.24, 0.1);
    this.mill.head = bones.add();
    rig.bone(this.mill.head);
    rig.panel(K.orange, 0, 0, 0.35, 0.36, 0.4, 0.5, 0, 0.03, 0.03);
    rig.cyl(K.dark, 0, 0, 0.0, 0.08, 0.12, 12);
    this.mill.spindle = bones.add();
    rig.bone(this.mill.spindle);
    rig.cyl(K.alu, 0, 0, -0.14, 0.02, 0.14, 8);
    rig.box(K.alu, 0.0, 0, -0.07, 0.045, 0.01, 0.12);
    rig.bone(0);
  }

  private windTunnel(): void {
    const { solid, rig, bones, glass, quads, cool, detail } = this.b;
    const T = TUNNEL;
    const cx = T.x;
    const z = 1.55;
    const y0 = T.y - T.hy;
    const y1 = T.y + T.hy;
    // From the fan at the north end: the fan's drum, a settling chamber, the contraction, the test section (glazed), the diffuser.
    const ring = (y: number, len: number, r: number, color: number) => cylY(solid, color, cx, y, z, r, len, 16);
    ring(y1 - 0.9, 1.8, 1.3, K.cream);
    ring(y1 - 1.82, 0.06, 1.33, K.orange);
    solid.add(new CylinderGeometry(1.25, 0.8, 1.6, solid.sides(16), 1, true), K.cream, at(cx, z, -(y1 - 2.65), 0, 1, -Math.PI / 2, 0));
    const ts0 = y1 - 3.45;
    const ts1 = ts0 - 2.6;
    // The test section: a square box with windows in its sides and roof.
    for (const sx of [-1, 1]) {
      solid.slab(K.alu, cx + sx * 0.8 - 0.04, cx + sx * 0.8 + 0.04, ts1, ts0, z - 0.8, z - 0.3);
      solid.slab(K.alu, cx + sx * 0.8 - 0.04, cx + sx * 0.8 + 0.04, ts1, ts0, z + 0.6, z + 0.8);
      glass.slab(0xffffff, cx + sx * 0.8 - 0.01, cx + sx * 0.8 + 0.01, ts1 + 0.1, ts0 - 0.1, z - 0.3, z + 0.6, 0);
    }
    solid.slab(K.alu, cx - 0.84, cx + 0.84, ts1, ts0, z - 0.84, z - 0.8);
    solid.slab(K.alu, cx - 0.84, cx + 0.84, ts1, ts0, z + 0.8, z + 0.84);
    for (const y of [ts0, ts1]) solid.slab(K.dark, cx - 0.9, cx + 0.9, y - 0.05, y + 0.05, z - 0.9, z + 0.9);
    solid.add(new CylinderGeometry(0.85, 1.05, T.hy * 2 - 3.45 - 2.6 - 0.1, solid.sides(16), 1, true), K.cream, at(cx, z, -((ts1 + y0) / 2), 0, 1, -Math.PI / 2, 0));
    // Stands.
    for (const y of [y1 - 1, ts0 - 0.2, ts1 + 0.2, y0 + 0.5]) for (const sx of [-1, 1]) solid.box(K.steel, cx + sx * 0.6, y, (z - 0.85) / 2, 0.1, 0.1, z - 0.85);
    // Its readout on a desk beside it.
    solid.panel(K.cream, cx - 1.3, ts1 + 1.3, 0.4, 0.5, 0.9, 0.8, 0, 0.02, 0.02);
    quads.add(K.screen, [cx - 1.56, ts1 + 1.6, 1.0], [0, -0.6, 0], [0, 0, 0.36], 0, 5);
    solid.glow(SLOT.tunnel).box(K.white, cx, y1 - 0.4, z + 1.32, 0.15, 0.15, 0.08, 0, 0).glow(0);
    cool.push([cx - 1.6, 1.2, -(ts1 + 1.3), 0.6]);
    this.tunnel.fan = bones.add();
    rig.bone(this.tunnel.fan);
    const blades = detail === 0 ? 3 : 6;
    for (let i = 0; i < blades; i++) {
      // Each blade radial in the fan's plane (square to the tunnel's axis, y).
      const a = (i / blades) * Math.PI * 2;
      rig.add(new BoxGeometry(0.95, 0.16, 0.03), K.dark, at(0.6 * Math.cos(a), 0.6 * Math.sin(a), 0, 0, 1, 0.25, a), 0.03);
    }
    cylY(rig, K.orange, 0, 0, 0, 0.18, 0.3, 12);
    this.tunnel.model = bones.add();
    rig.bone(this.tunnel.model);
    // A model aircraft on its sting: fuselage along -y (into the wind), a wing, a tail.
    cylY(rig, K.white, 0, -0.05, 0, 0.05, 0.7, 10);
    rig.box(K.white, 0, -0.08, 0, 0.9, 0.16, 0.02, 0, 0.02);
    rig.box(K.white, 0, 0.27, 0.0, 0.32, 0.08, 0.015, 0, 0.02);
    rig.box(K.orange, 0, 0.28, 0.08, 0.015, 0.1, 0.16, 0, 0.02);
    rig.bone(0);
    solid.rod(K.dark, cx, ts1 + 0.9, z - 0.8, cx, ts1 + 1.15, z - 0.04, 0.02, 6);
  }

  private electronics(): void {
    const { solid, quads, detail, cool } = this.b;
    const B = BENCH;
    const x0 = B.x - B.hx;
    // The bench top, its legs, a shelf above with the instruments.
    solid.panel(K.wood, B.x, B.y, 0.88, B.hx * 2, B.hy * 2, 0.05, 0, 0.03, 0.02);
    for (const sy of [-1, 1]) for (const sx of [-1, 1]) solid.box(K.steel, B.x + sx * (B.hx - 0.06), B.y + sy * (B.hy - 0.06), 0.43, 0.06, 0.06, 0.86);
    solid.slab(K.steel, B.x + B.hx - 0.3, B.x + B.hx - 0.04, B.y - B.hy, B.y + B.hy, 1.38, 1.42);
    for (const sy of [-1, 1]) solid.box(K.steel, B.x + B.hx - 0.17, B.y + sy * (B.hy - 0.04), 1.15, 0.05, 0.05, 0.54);
    const scopes = detail === 0 ? 2 : 4;
    for (let i = 0; i < scopes; i++) {
      const y = B.y - B.hy + 1.2 + i * ((B.hy * 2 - 2.4) / Math.max(1, scopes - 1));
      solid.panel(0x9aa3ad, B.x + B.hx - 0.17, y, 1.6, 0.26, 0.44, 0.34, 0, 0.02, 0.02);
      quads.add(K.screen, [B.x + B.hx - 0.31, y + 0.18, 1.5], [0, -0.28, 0], [0, 0, 0.2], 0, 7 + i);
      cool.push([B.x + B.hx - 0.4, 1.6, -y, 0.45]);
    }
    // Monitors on the bench, a power supply, and a robot half built.
    for (const y of [B.y - 3.2, B.y + 2.6]) {
      solid.box(K.dark, x0 + 0.5, y, 0.98, 0.1, 0.1, 0.16);
      solid.panel(K.charcoal, x0 + 0.5, y, 1.3, 0.05, 0.7, 0.44, 0, 0.02, 0.01);
      quads.add(K.screen, [x0 + 0.47, y + 0.32, 1.11], [0, -0.64, 0], [0, 0, 0.38], 0, y > B.y ? 12 : 13);
    }
    solid.panel(0xb8c0c8, x0 + 0.5, B.y - 0.8, 1.02, 0.3, 0.4, 0.22, 0, 0.02, 0.02);
    solid.glow(SLOT.bench).box(K.white, x0 + 0.34, B.y - 0.9, 1.05, 0.01, 0.12, 0.05, 0, 0).glow(0);
    solid.panel(K.orange, x0 + 0.55, B.y + 0.7, 0.98, 0.3, 0.4, 0.14, 0, 0.03, 0.02);
    solid.cyl(K.dark, x0 + 0.55, B.y + 0.7, 1.05, 0.08, 0.12, 10);
    solid.box(K.cream, x0 + 0.55, B.y + 0.7, 1.2, 0.16, 0.12, 0.1);
    // A stool.
    solid.cyl(K.dark, x0 - 0.5, B.y + 0.5, 0, 0.04, 0.6, 6);
    solid.cyl(K.orange, x0 - 0.5, B.y + 0.5, 0.6, 0.2, 0.06, 12);
  }

  private storage(): void {
    const { solid, detail } = this.b;
    // Pallet racks: orange uprights, blue beams, crates and bins.
    const R = RACKS;
    const bays = Math.round((R.hx * 2) / 2.65);
    const levels = [0.15, 1.45, 2.75];
    for (let i = 0; i <= bays; i++) {
      const x = R.x - R.hx + (R.hx * 2 * i) / bays;
      for (const sy of [-1, 1]) solid.box(K.orange, x, R.y + sy * (R.hy - 0.05), 2.05, 0.08, 0.08, 4.1);
      if (detail > 0) for (let k = 0; k < 4; k++) solid.rod(K.orange, x, R.y - R.hy + 0.05, 0.3 + k, x, R.y + R.hy - 0.05, 0.8 + k, 0.015, 4);
    }
    const crate = [K.cardboard, 0xb8c4cc, K.blue, 0xd9b38c, K.mint, 0x9aa3ad];
    let n = 0;
    for (let i = 0; i < bays; i++) {
      const xa = R.x - R.hx + (R.hx * 2 * i) / bays;
      const xb = R.x - R.hx + (R.hx * 2 * (i + 1)) / bays;
      for (const z of levels) {
        for (const sy of [-1, 1]) solid.box(0x4f7fb8, (xa + xb) / 2, R.y + sy * (R.hy - 0.05), z + 1.2, xb - xa - 0.08, 0.06, 0.1);
        if (z > 0.2) solid.slab(0xb59a74, xa + 0.06, xb - 0.06, R.y - R.hy + 0.08, R.y + R.hy - 0.08, z + 1.24, z + 1.27);
        const base = z > 0.2 ? z + 1.27 : 0.07;
        const count = detail === 0 ? 1 : 3;
        for (let c = 0; c < count; c++) {
          const w = (xb - xa - 0.2) / count;
          const hgt = 0.4 + ((n * 7) % 5) * 0.12;
          if ((n * 13) % 7 === 3) {
            n++;
            continue;
          }
          solid.panel(crate[n % crate.length]!, xa + 0.1 + w * (c + 0.5), R.y, base + hgt / 2, w - 0.08, R.hy * 2 - 0.25, hgt, 0, 0.05, 0.02);
          n++;
        }
      }
    }
    // The tool wall: a workbench with drawers, a vice, and a pegboard of tools.
    const T = TOOLS;
    solid.panel(K.wood, T.x, T.y, 0.9, T.hx * 2, T.hy * 2, 0.06, 0, 0.03, 0.02);
    solid.panel(0xb8c4cc, T.x - T.hx + 0.6, T.y, 0.44, 1.0, T.hy * 2 - 0.1, 0.84, 0, 0.03, 0.03);
    solid.panel(0xb8c4cc, T.x + T.hx - 0.6, T.y, 0.44, 1.0, T.hy * 2 - 0.1, 0.84, 0, 0.03, 0.03);
    if (detail > 0) for (const sx of [-1, 1]) for (let d = 0; d < 4; d++) solid.box(K.red, T.x + sx * (T.hx - 0.6), T.y + T.hy - 0.04, 0.17 + d * 0.2, 0.8, 0.02, 0.15, 0, 0.02);
    solid.slab(0xd8c4a0, T.x - T.hx, T.x + T.hx, T.y - T.hy, T.y - T.hy + 0.04, 1.0, 2.4);
    const tools = detail === 0 ? 6 : 16;
    for (let i = 0; i < tools; i++) {
      const tx = T.x - T.hx + 0.4 + i * ((T.hx * 2 - 0.8) / (tools - 1));
      const long = 0.25 + ((i * 5) % 4) * 0.08;
      solid.box(i % 3 === 0 ? K.orange : i % 3 === 1 ? K.steel : K.red, tx, T.y - T.hy + 0.07, 1.8 + ((i % 2) * 0.25) - long / 2, 0.05, 0.03, long, 0, 0.03);
    }
    solid.box(K.dark, T.x + 1.2, T.y + 0.1, 1.0, 0.24, 0.18, 0.14);
    // The charging docks: two spare carts on their chargers.
    const D = DOCKS;
    for (const sx of [-1, 1]) {
      const x = D.x + sx * 2.2;
      solid.slab(K.dark, x - 0.45, x + 0.45, D.y - 0.35, D.y + 0.35, 0.07, 0.085);
      solid.panel(K.cream, x, D.y - 0.15, 0.21, CART.width, CART.length * 0.85, 0.3, 0, 0.03, 0.05);
      solid.box(K.orange, x, D.y - 0.15, CART.deck - 0.01, CART.width - 0.06, CART.length * 0.85 - 0.06, 0.02);
      solid.panel(K.cream, x, D.y + D.hy - 0.12, 0.55, 0.4, 0.2, 1.1, 0, 0.02, 0.02);
      solid.glow(SLOT.dock + 1).box(K.white, x, D.y + D.hy - 0.23, 0.9, 0.12, 0.01, 0.05, 0, 0).glow(0);
    }
    // Spools of filament on shelves inside the door.
    const S = SHELVES;
    for (const z of [0.1, 0.65, 1.2, 1.75, 2.28]) solid.slab(K.steel, S.x - S.hx, S.x + S.hx, S.y - S.hy, S.y + S.hy, z - 0.03, z);
    for (const sy of [-1, 1]) for (const sx of [-1, 1]) solid.box(K.dark, S.x + sx * (S.hx - 0.03), S.y + sy * (S.hy - 0.03), 1.15, 0.05, 0.05, 2.3);
    const colors = [0xe8853a, 0x4f9be3, 0x5cbf6e, 0xf7f5f0, 0x3f434c, 0xe35d4f, 0xf2c14e, 0xc9c2ec, 0x9fd8c0];
    let k = 0;
    for (const z of [0.1, 0.65, 1.2, 1.75]) {
      const per = detail === 0 ? 3 : 7;
      for (let i = 0; i < per; i++) {
        cylX(solid, colors[k % colors.length]!, S.x, S.y - S.hy + 0.5 + i * ((S.hy * 2 - 1) / (per - 1)), z + 0.17, 0.16, 0.09, 14);
        k++;
      }
    }
  }

  // ---------- each frame ----------

  private readonly tip: [number, number, number] = [0, 0, 0];

  /** Poses every machine from the simulation; writes the clamps, bars, belts and status lights. */
  pose(flow: HallFlow, u: HallUniforms, t: number, motion: boolean): void {
    const bones = this.b.bones;
    const P = PRINTER;
    // The printers.
    for (let i = 0; i < flow.printers.length; i++) {
      const p = flow.printers[i]!;
      const b = this.printers[i]!;
      const pose = p.pose;
      bones.put(b.beam, p.x, p.y + pose.headY, FARM.top + P.nozzle + 0.14);
      bones.put(b.head, p.x + pose.headX, p.y + pose.headY, FARM.top + P.nozzle);
      bones.put(b.bed, p.x, p.y, FARM.top + pose.bed);
      bones.put(b.bar, p.x, p.y + pose.bar, FARM.top + pose.bed);
      bones.put(b.spool, p.x + P.half + 0.1, p.y + 0.1, FARM.top + 0.82, 0, 0, -p.fed / 0.17);
      u.barValues[BAR.printer + i] = pose.progress;
      const waiting = p.t < 0;
      const c = u.lampColors[SLOT.printer + i]!;
      light(c, waiting ? AMBER : pose.progress < 1 ? BUSY : READY);
    }
    // The parts.
    for (let i = 0; i < flow.parts.length; i++) {
      const part = flow.parts[i]!;
      const bone = this.parts[i]!;
      if (part.state === "idle") {
        // Away: shrunk to nothing under the floor.
        bones.set(bone, ZERO, part.x, part.y, -1, 0, 0, 0);
        u.clampValues[i + 1] = 1e4;
        continue;
      }
      bones.put(bone, part.x, part.y, part.z, part.yaw, part.tilt);
      u.clampValues[i + 1] = part.state === "printing" || part.state === "sweep" ? part.z + part.printed : 1e4;
    }
    // The big part (only the one being made or carried is shown).
    for (let k = 0; k < this.big.length; k++) {
      const bone = this.big[k]!;
      if (k !== flow.bigJob) {
        bones.set(bone, ZERO, GANTRY.bed.x, GANTRY.bed.y, -1, 0, 0, 0);
        continue;
      }
      bones.put(bone, flow.bigX, flow.bigY, flow.bigZ);
      u.clampValues[flow.parts.length + 1 + k] = flow.bigState === "printing" ? flow.bigZ + flow.bigPose.printed : 1e4;
    }
    // The large printer's gantry.
    const bp = flow.bigPose;
    bones.put(this.gantry.beam, GANTRY.frame.x, GANTRY.frame.y + bp.y, GANTRY.height - 0.02);
    bones.put(this.gantry.carriage, GANTRY.frame.x + bp.x, GANTRY.frame.y + bp.y, GANTRY.height - 0.25);
    bones.put(this.gantry.head, GANTRY.frame.x + bp.x, GANTRY.frame.y + bp.y - 0.2, GANTRY.bedTop + bp.z);
    u.barValues[BAR.gantry] = bp.progress;
    light(u.lampColors[SLOT.gantry]!, flow.bigState === "printing" ? BUSY : READY);
    void GANTRY_PRINTER;
    // The crane.
    const deck = CRANE.rail + 0.95;
    bones.put(this.crane.bridge, flow.bridge.at, 0, 0);
    bones.put(this.crane.trolley, flow.bridge.at, flow.trolley.at, deck);
    bones.put(this.crane.hook, flow.bridge.at, flow.trolley.at, flow.hook.at);
    for (let c = 0; c < 2; c++) {
      const s = c ? 1 : -1;
      bones.span(this.crane.cables[c]!, flow.bridge.at + s * 0.08, flow.trolley.at, flow.hook.at + 0.72, flow.bridge.at + s * 0.08, flow.trolley.at, deck);
    }
    const craneMoving = Math.abs(flow.bridge.v) + Math.abs(flow.trolley.v) > 0.02;
    light(u.lampColors[SLOT.crane]!, craneMoving && Math.sin(t * 9) > 0 ? AMBER : DIM);
    u.lampColors[SLOT.vacuum]!.setRGB(0.3 * flow.clamp, 1.5 * flow.clamp, 0.5 * flow.clamp);
    // The dispatch room's door, and the rollers.
    bones.put(this.door, DISPATCH.room.x, DISPATCH.room.y - DISPATCH.room.hy - 0.02, flow.door * (DISPATCH.door.height - 0.15));
    light(u.lampColors[SLOT.door]!, flow.door > 0.02 && Math.sin(t * 6) > 0 ? AMBER : DIM);
    // The cart.
    const cp = flow.cart.pose;
    bones.put(this.cart, cp.x, cp.y, 0, cp.heading);
    const moving = Math.abs(flow.cart.v) > 0.01;
    light(u.lampColors[SLOT.cart]!, moving ? BUSY : flow.cartState === "loading" || flow.cartState === "unloading" ? READY : AMBER);
    light(u.lampColors[SLOT.dock]!, flow.cartState === "loading" && !moving ? READY : IDLE);
    // The line.
    for (let k = 0; k < flow.carriers.length; k++) {
      const c = flow.carriers[k]!;
      bones.put(this.carriers[k]!, flow.carrierX(c), LINE.y, LINE.top);
    }
    u.beltValues[BELT.conveyor] = (flow.indexes * LINE.pitch + (flow.moving ? smooth(flow.index) * LINE.pitch : 0)) / 0.3;
    u.beltValues[BELT.collector] = flow.belt / 0.25;
    u.lampColors[SLOT.inspect]!.setRGB(0.4 + 2.2 * flow.flash, 0.6 + 2.6 * flow.flash, 0.8 + 1.4 * flow.flash);
    u.lampColors[SLOT.feeder]!.setRGB(0.3, 1.4, 0.5);
    for (let a = 0; a < this.arms.length; a++) {
      const arm = flow.arms[a]!;
      this.poseArm(this.arms[a]!, arm.x, arm.y, LINE.pedestal, arm.q, arm.grip, a === 1 ? arm.spin : 0, a === 1);
    }
    // The mill: a pocket, cut back and forth, a little deeper each pass.
    const M = MILL;
    const cyc = motion ? t % 48 : 0;
    const pass = Math.floor(cyc / 8);
    const k = (cyc % 8) / 8;
    const zig = Math.abs(((k * 6) % 2) - 1);
    bones.put(this.mill.table, M.x + (zig - 0.5) * 0.24, M.y + 0.1, 0);
    bones.put(this.mill.head, M.x, M.y + 0.1 + (k - 0.5) * 0.16, 1.24 - pass * 0.008);
    bones.put(this.mill.spindle, M.x, M.y + 0.1 + (k - 0.5) * 0.16, 1.24 - pass * 0.008, motion ? t * 40 : 0);
    u.barValues[BAR.cnc] = cyc / 48;
    u.lampColors[SLOT.cnc]!.setRGB(0.25, 0.8, 1.6);
    u.lampColors[SLOT.work]!.setRGB(1.6, 1.55, 1.4);
    // The wind tunnel: its fan, and the model sweeping its angle of attack.
    const T = TUNNEL;
    bones.put(this.tunnel.fan, T.x, T.y + T.hy - 0.9, 1.55, 0, 0, motion ? t * 9 : 0);
    const ts1 = T.y + T.hy - 3.45 - 2.6;
    bones.put(this.tunnel.model, T.x, ts1 + 1.15, 1.55, 0, motion ? 0.22 * Math.sin(t * 0.4) : 0.05);
    u.lampColors[SLOT.tunnel]!.setRGB(0.3, 1.5, 0.5);
    u.lampColors[SLOT.bench]!.setRGB(1.6, 0.25, 0.15);
    u.lampColors[SLOT.dock + 1]!.setRGB(0.3, 1.5, 0.5);
    void INDEX_TIME;
    void TOTE_SLOTS;
  }

  /** Poses an arm's bones for joints `q` at its base (x, y) on a pedestal `h` high; its gripper's fingers apart by `grip`, its flange turned on by `spin`. */
  poseArm(b: ArmBones, x: number, y: number, h: number, q: ArrayLike<number>, grip: number, spin: number, driver: boolean): void {
    const bones = this.b.bones;
    const f = armFrames(q, frames);
    for (let i = 0; i < 5; i++) bones.frame(b.links[i]!, f[i]!, x, y, h);
    // The flange: turned on further while screwing.
    const flange = f[5]!;
    if (spin) {
      const c = Math.cos(spin);
      const s = Math.sin(spin);
      for (let r = 0; r < 3; r++) {
        const fx = flange[r * 4]!;
        const fy = flange[r * 4 + 1]!;
        flange[r * 4] = fx * c + fy * s;
        flange[r * 4 + 1] = -fx * s + fy * c;
      }
    }
    bones.frame(b.links[5]!, flange, x, y, h);
    // The fingers slide apart along the flange's x (a screwdriver's bit stays on the axis).
    const open = driver ? 0 : 0.075 - 0.05 * grip;
    for (let k = 0; k < 2; k++) {
      const s = k ? 1 : -1;
      bones.set(b.fingers[k]!, flange, flange[3]! + x + flange[0]! * s * open, flange[7]! + y + flange[4]! * s * open, flange[11]! + h + flange[8]! * s * open, 1, 1, 1, 4);
    }
  }
}

const ZERO = new Float64Array(9);

type RGB = readonly [number, number, number];
/** Status light colours (linear, bright enough to glow). */
const BUSY: RGB = [0.25, 0.8, 1.6];
const READY: RGB = [0.3, 1.5, 0.5];
const AMBER: RGB = [1.8, 0.9, 0.15];
const DIM: RGB = [0.06, 0.04, 0.02];
const IDLE: RGB = [0.25, 0.35, 0.5];
const light = (c: { setRGB(r: number, g: number, b: number): unknown }, v: RGB): void => {
  c.setRGB(v[0], v[1], v[2]);
};

const smooth = (t: number): number => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};

/** Where the tool's tip is for a frame list (exported for tests). */
export function tipOf(f: Frame[]): [number, number, number] {
  const fl = f[5]!;
  return [fl[3]! + fl[2]! * ARM.tool, fl[7]! + fl[6]! * ARM.tool, fl[11]! + fl[10]! * ARM.tool];
}
