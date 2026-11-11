import { float, uniform, vertexColor } from "three/tsl";
import { BoxGeometry, ConeGeometry, CylinderGeometry, Group, IcosahedronGeometry, Mesh, MeshBasicNodeMaterial, MeshLambertNodeMaterial, SphereGeometry, TorusGeometry } from "three/webgpu";
import type { Collider } from "./colliders.ts";
import type { Vec3 } from "./coords.ts";
import { BENCH, BENCH_SEAT, DESK, DESK_LANTERN, DESK_SEAT, DOG_BED, DOG_POST, FIRE, HEARTH_COLLIDERS, JOURNAL, LOCKER, LOG, MAT, POLE, SEAT_BACK, SWORD_STAND, WEDGE, WOODPILE } from "./hearth-plan.ts";
import { at, between, bevelBox, chip, groundAO, Mesher } from "./mesher.ts";
import type { Glow, Place, PlaceContext, PlaceFrame } from "./place.ts";

/*
 * His hearth, drawn: the camp on the lawn south of the keep where his day begins
 * and ends, and the bench on the lake's shore (hearth-plan.ts has where things
 * stand, what's solid and where he and the dog sit and lie).
 *
 * A fire in a ring of stones under a tripod with a kettle; his bed, a woven mat
 * with a wedge to lean back on, a footlocker at its foot with his blanket folded
 * on it (spread over his legs while he lies there); the dog's cushion tucked against the mat, with its charge post; a
 * log to sit on; his desk with a chair, a lantern and his journal lying open; a
 * stand where his sword rests while he sleeps; a pole at the head of the bed with
 * his pennant and a lantern; a woodpile. The fire burns from dusk to morning and
 * whenever he's at the camp; the lanterns are lit at night.
 *
 * Three small draw calls at the camp (what's solid, what's lit, the flames) and one
 * at the bench; the blanket and the sword are each a mesh shown only while he lies
 * down. Nothing is allocated per frame.
 */

const WOOD = 0xb57c4e;
const WOOD_DARK = 0x8b5a39;
const BARK = 0x6f4a33;
const CUT = 0xe2c9a0;
const CREAM = 0xf0e8d6;
const CANVAS = 0xe9dfc8;
const ORANGE = 0xe8853a;
const WOVEN = 0xd9c7a2;
const STONE = 0xcdb7a8;
const STONE_DARK = 0x9a8f8a;
const IRON = 0x3a3d44;
const STEEL = 0xdfe4ea;
const CHAR = 0x2b2622;

/** Seats' tops (he sits down onto them: knight.ts' SIT). */
const SEAT_TOP = 0.4;

export class Hearth implements Place {
  readonly group = new Group();
  readonly warmGlows: readonly Glow[];
  readonly coolGlows: readonly Glow[];
  readonly colliders: readonly Collider[] = HEARTH_COLLIDERS;
  /** The fire is burning (embers fly from it: the scene's sparks). */
  lit = false;
  private readonly solidMaterial = new MeshLambertNodeMaterial({ vertexColors: true });
  private readonly litMaterial = new MeshBasicNodeMaterial({ vertexColors: true });
  private readonly flameMaterial = new MeshBasicNodeMaterial({ vertexColors: true });
  private readonly night = uniform(0);
  private readonly flames: Mesh;
  private readonly blanket: Mesh;
  private readonly folded: Mesh;
  private readonly sword: Mesh;
  private readonly gz: number;
  private nightLevel = 0;
  private spread = 0;
  private lying = false;
  /** The dog's name, once it has one (its cushion says whose it is). */
  dogName = "";

  constructor(ctx: PlaceContext) {
    const gz = ctx.ground(FIRE.x, FIRE.y);
    this.gz = gz;
    const solid = new Mesher();
    const lit = new Mesher();
    /** A transform at a world point (x east, y north) `h` above the camp's ground. */
    const P = (x: number, y: number, h: number, ry = 0, scale: number | [number, number, number] = 1, rx = 0, rz = 0) => at(x, gz + h, -y, ry, scale, rx, rz);

    // ---- the fire: a ring of stones, charred ground, logs leaning together, a tripod with a kettle ----
    solid.add(new CylinderGeometry(FIRE.r - 0.04, FIRE.r + 0.02, 0.05, 12), CHAR, P(FIRE.x, FIRE.y, 0.025), 0.12);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.2;
      const r = 0.13 + 0.035 * Math.sin(i * 2.7);
      solid.add(chip(new IcosahedronGeometry(r, 1), 40 + i, 3, 0.8), i % 3 ? STONE : STONE_DARK, P(FIRE.x + Math.cos(a) * FIRE.r, FIRE.y + Math.sin(a) * FIRE.r, r * 0.6, i * 1.3), 0.08);
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.5;
      solid.add(new CylinderGeometry(0.05, 0.06, 0.62, 6), i % 2 ? BARK : CHAR, between(FIRE.x + Math.cos(a) * 0.32, gz + 0.06, -(FIRE.y + Math.sin(a) * 0.32), FIRE.x - Math.cos(a) * 0.05, gz + 0.4, -(FIRE.y - Math.sin(a) * 0.05)), 0.1);
    }
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.9;
      solid.add(new CylinderGeometry(0.022, 0.028, 1, 5), IRON, between(FIRE.x + Math.cos(a) * 0.72, gz, -(FIRE.y + Math.sin(a) * 0.72), FIRE.x, gz + 1.5, -FIRE.y), 0.04);
    }
    solid.add(new CylinderGeometry(0.008, 0.008, 0.52, 4), IRON, P(FIRE.x, FIRE.y, 1.22), 0);
    solid.add(new SphereGeometry(0.15, 8, 5), IRON, P(FIRE.x, FIRE.y, 0.84, 0, [1, 0.8, 1]), 0.05);
    solid.add(new CylinderGeometry(0.06, 0.08, 0.04, 8), IRON, P(FIRE.x, FIRE.y, 0.97), 0);
    solid.add(new TorusGeometry(0.11, 0.01, 4, 10, Math.PI), IRON, P(FIRE.x, FIRE.y, 0.92), 0);
    solid.add(new CylinderGeometry(0.018, 0.03, 0.16, 5), IRON, P(FIRE.x + 0.17, FIRE.y, 0.88, 0, 1, 0, -1.0), 0);
    // Embers under the logs.
    for (let i = 0; i < 6; i++) lit.add(new IcosahedronGeometry(0.05, 0), i % 2 ? 0xff8a2a : 0xffb347, P(FIRE.x + Math.cos(i * 1.9) * 0.16, FIRE.y + Math.sin(i * 1.9) * 0.16, 0.07), 0.15);

    // ---- his bed: a woven mat, a wedge to lean back on with a pillow, the blanket (below) ----
    solid.add(bevelBox(MAT.hx * 2, MAT.top, MAT.hy * 2, 0.03), WOVEN, P(MAT.x, MAT.y, MAT.top / 2), 0.07);
    for (const s of [-1, 1]) solid.add(new BoxGeometry(MAT.hx * 2 - 0.1, 0.012, 0.07), ORANGE, P(MAT.x, MAT.y + s * (MAT.hy - 0.12), MAT.top + 0.004), 0.04);
    const slope = Math.atan2(WEDGE.high - WEDGE.low, WEDGE.hx * 2 + 0.2);
    solid.add(bevelBox(WEDGE.hx * 2 + 0.36, 0.16, WEDGE.hy * 2, 0.04), ORANGE, P(WEDGE.x + 0.06, WEDGE.y, (WEDGE.low + WEDGE.high) / 2 - 0.02, 0, 1, 0, -slope), 0.05);
    solid.add(bevelBox(0.36, WEDGE.high - 0.12, WEDGE.hy * 2 - 0.06, 0.03), WOOD, P(WEDGE.x - 0.3, WEDGE.y, (WEDGE.high - 0.12) / 2), 0.06);
    solid.add(bevelBox(0.3, 0.11, 0.62, 0.04), CREAM, P(WEDGE.x - 0.2, WEDGE.y, WEDGE.high + 0.08, 0, 1, 0, -slope), 0.03);

    // The footlocker at the foot of the bed: a chest with iron bands and a clasp.
    solid.add(bevelBox(LOCKER.hx * 2, LOCKER.top, LOCKER.hy * 2, 0.025), WOOD_DARK, P(LOCKER.x, LOCKER.y, LOCKER.top / 2), 0.06);
    for (const s of [-1, 1]) solid.add(new BoxGeometry(LOCKER.hx * 2 + 0.012, LOCKER.top + 0.006, 0.05), IRON, P(LOCKER.x, LOCKER.y + s * (LOCKER.hy - 0.14), LOCKER.top / 2), 0.03);
    solid.add(new BoxGeometry(0.02, 0.07, 0.08), 0xd9a441, P(LOCKER.x + LOCKER.hx + 0.008, LOCKER.y, LOCKER.top - 0.09), 0);

    // ---- the dog's cushion against the mat: its bed and its dock; the post with its charge light ----
    solid.add(new CylinderGeometry(DOG_BED.r + 0.05, DOG_BED.r + 0.07, 0.03, 14), 0x5b606b, P(DOG_BED.x, DOG_BED.y, 0.015), 0.02);
    solid.add(new CylinderGeometry(DOG_BED.r - 0.05, DOG_BED.r, 0.09, 14), CREAM, P(DOG_BED.x, DOG_BED.y, 0.075), 0.04);
    solid.add(new TorusGeometry(DOG_BED.r - 0.03, 0.055, 5, 14), ORANGE, P(DOG_BED.x, DOG_BED.y, 0.11, 0, 1, Math.PI / 2), 0.04);
    solid.add(new CylinderGeometry(0.06, 0.08, 0.7, 8), CREAM, P(DOG_POST.x, DOG_POST.y, 0.35), 0.03);
    solid.add(new BoxGeometry(0.15, 0.06, 0.15), IRON, P(DOG_POST.x, DOG_POST.y, 0.73), 0);
    lit.add(new IcosahedronGeometry(0.045, 1), 0x7cf0a0, P(DOG_POST.x, DOG_POST.y, 0.79), 0);

    // ---- the log by the fire: bark, cut ends ----
    solid.add(new CylinderGeometry(LOG.r, LOG.r * 1.06, LOG.half * 2, 9), BARK, P(LOG.x, LOG.y, LOG.r, 0, 1, 0, Math.PI / 2), 0.1);
    for (const s of [-1, 1]) solid.add(new CylinderGeometry(LOG.r * 0.86, LOG.r * 0.86, 0.02, 9), CUT, P(LOG.x + s * LOG.half, LOG.y, LOG.r, 0, 1, 0, Math.PI / 2), 0.05);

    // ---- his desk: top, legs, a lantern, his journal open, a pen and ink; the chair ----
    solid.add(bevelBox(DESK.hx * 2, 0.05, DESK.hy * 2, 0.012), WOOD, P(DESK.x, DESK.y, DESK.top - 0.025), 0.05);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) solid.add(new BoxGeometry(0.06, DESK.top - 0.05, 0.06), WOOD_DARK, P(DESK.x + sx * (DESK.hx - 0.07), DESK.y + sy * (DESK.hy - 0.06), (DESK.top - 0.05) / 2), 0.05);
    solid.add(new BoxGeometry(DESK.hx * 2 - 0.2, 0.05, 0.03), WOOD_DARK, P(DESK.x, DESK.y + DESK.hy - 0.06, DESK.top - 0.3), 0.04);
    // The journal: a leather cover, two pages a little raised at the spine, lines of writing on the left one.
    solid.add(new BoxGeometry(0.4, 0.012, 0.27), 0x8a4b2a, P(JOURNAL.x, JOURNAL.y, DESK.top + 0.006), 0.03);
    for (const s of [-1, 1]) solid.add(new BoxGeometry(0.185, 0.014, 0.25), 0xf6efdc, P(JOURNAL.x + s * 0.096, JOURNAL.y, DESK.top + 0.02, 0, 1, 0, s * 0.06), 0.015);
    for (let i = 0; i < 6; i++) solid.add(new BoxGeometry(0.14 - (i === 5 ? 0.06 : 0), 0.002, 0.006), 0x5a4a3a, P(JOURNAL.x - 0.096 - (i === 5 ? 0.03 : 0), JOURNAL.y + 0.09 - i * 0.032, DESK.top + 0.03), 0);
    solid.add(new BoxGeometry(0.004, 0.003, 0.25), ORANGE, P(JOURNAL.x, JOURNAL.y - 0.01, DESK.top + 0.031), 0);
    solid.add(new CylinderGeometry(0.03, 0.035, 0.05, 8), IRON, P(DESK.x + 0.42, DESK.y + 0.12, DESK.top + 0.025), 0);
    solid.add(new CylinderGeometry(0.006, 0.006, 0.2, 5), CREAM, P(DESK.x + 0.42, DESK.y + 0.12, DESK.top + 0.13, 0, 1, 0.25, 0.3), 0);
    // The lantern.
    const lx = DESK_LANTERN.x;
    const ly = DESK_LANTERN.y;
    solid.add(new CylinderGeometry(0.075, 0.085, 0.03, 8), IRON, P(lx, ly, DESK.top + 0.015), 0);
    for (let i = 0; i < 4; i++) solid.add(new BoxGeometry(0.012, 0.2, 0.012), IRON, P(lx + Math.cos(i * 1.5708 + 0.785) * 0.075, ly + Math.sin(i * 1.5708 + 0.785) * 0.075, DESK.top + 0.13), 0);
    lit.add(new BoxGeometry(0.1, 0.17, 0.1), 0xffd27a, P(lx, ly, DESK.top + 0.125), 0);
    solid.add(new ConeGeometry(0.1, 0.07, 4), IRON, P(lx, ly, DESK.top + 0.265, 0.785), 0);
    solid.add(new TorusGeometry(0.035, 0.007, 4, 8), IRON, P(lx, ly, DESK.top + 0.33), 0);
    // The chair: its seat just behind where he stands, its back behind that.
    const cy = DESK_SEAT.y - SEAT_BACK - 0.06;
    solid.add(bevelBox(0.44, 0.05, 0.42, 0.012), WOOD, P(DESK_SEAT.x, cy, SEAT_TOP - 0.025), 0.05);
    for (const sx of [-1, 1]) {
      solid.add(new BoxGeometry(0.045, SEAT_TOP - 0.05, 0.045), WOOD_DARK, P(DESK_SEAT.x + sx * 0.18, cy + 0.17, (SEAT_TOP - 0.05) / 2), 0.05);
      solid.add(new BoxGeometry(0.045, 1.0, 0.045), WOOD_DARK, P(DESK_SEAT.x + sx * 0.18, cy - 0.19, 0.5), 0.05);
    }
    for (const h of [0.62, 0.8, 0.96]) solid.add(new BoxGeometry(0.4, 0.07, 0.025), WOOD, P(DESK_SEAT.x, cy - 0.19, h), 0.05);

    // ---- where his sword stands while he sleeps: a post with a fork, a foot ----
    solid.add(new CylinderGeometry(0.14, 0.17, 0.06, 8), WOOD_DARK, P(SWORD_STAND.x, SWORD_STAND.y, 0.03), 0.05);
    solid.add(new CylinderGeometry(0.03, 0.035, 1.05, 6), WOOD, P(SWORD_STAND.x, SWORD_STAND.y - 0.06, 0.55), 0.05);
    solid.add(new BoxGeometry(0.2, 0.04, 0.05), WOOD_DARK, P(SWORD_STAND.x, SWORD_STAND.y - 0.03, 1.06), 0.04);
    for (const s of [-1, 1]) solid.add(new BoxGeometry(0.03, 0.09, 0.09), WOOD_DARK, P(SWORD_STAND.x + s * 0.085, SWORD_STAND.y + 0.01, 1.09), 0.04);

    // ---- the pole at the head of his bed: his pennant at its top (orange, a cream star's worth of stripe), a lantern on its arm ----
    solid.add(new CylinderGeometry(0.035, 0.05, POLE.height, 6), WOOD_DARK, P(POLE.x, POLE.y, POLE.height / 2), 0.05);
    solid.add(new CylinderGeometry(0.1, 0.13, 0.08, 7), STONE_DARK, P(POLE.x, POLE.y, 0.04), 0.06);
    solid.add(new BoxGeometry(0.62, 0.36, 0.02), ORANGE, P(POLE.x + 0.34, POLE.y, POLE.height - 0.24), 0.03);
    solid.add(new ConeGeometry(0.18, 0.3, 3), ORANGE, P(POLE.x + 0.79, POLE.y, POLE.height - 0.24, 0, [1, 1, 0.08], 0, -Math.PI / 2), 0.03);
    solid.add(new BoxGeometry(0.62, 0.06, 0.024), CANVAS, P(POLE.x + 0.34, POLE.y, POLE.height - 0.24), 0.02);
    solid.add(new IcosahedronGeometry(0.05, 0), ORANGE, P(POLE.x, POLE.y, POLE.height + 0.04), 0);
    solid.add(new BoxGeometry(0.42, 0.035, 0.035), WOOD_DARK, P(POLE.x + 0.2, POLE.y, POLE.lantern + 0.3), 0.04);
    solid.add(new CylinderGeometry(0.005, 0.005, 0.12, 3), IRON, P(POLE.x + 0.38, POLE.y, POLE.lantern + 0.23), 0);
    solid.add(new ConeGeometry(0.09, 0.06, 4), IRON, P(POLE.x + 0.38, POLE.y, POLE.lantern + 0.14, 0.785), 0);
    lit.add(new BoxGeometry(0.1, 0.16, 0.1), 0xffd27a, P(POLE.x + 0.38, POLE.y, POLE.lantern + 0.03), 0);
    solid.add(new CylinderGeometry(0.07, 0.07, 0.02, 6), IRON, P(POLE.x + 0.38, POLE.y, POLE.lantern - 0.06), 0);

    // ---- the woodpile ----
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < 4 - row; i++) {
        const a = 0.2;
        const along = (i - (3 - row) / 2) * 0.24;
        const x = WOODPILE.x + Math.cos(a) * along;
        const y = WOODPILE.y + Math.sin(a) * along;
        solid.add(new CylinderGeometry(0.11, 0.115, 0.5, 7), (i + row) % 2 ? BARK : WOOD_DARK, P(x, y, 0.115 + row * 0.2, -a, 1, Math.PI / 2), 0.1);
        solid.add(new CylinderGeometry(0.095, 0.095, 0.01, 7), CUT, P(x - Math.sin(a) * 0.25, y + Math.cos(a) * 0.25, 0.115 + row * 0.2, -a, 1, Math.PI / 2), 0.05);
      }
    }

    // ---- the bench by the lake: a plank seat, a back, a lantern on a post at its end ----
    const bz = ctx.ground(BENCH.x, BENCH.y) - gz;
    const by = BENCH_SEAT.y + SEAT_BACK + 0.06;
    solid.add(bevelBox(BENCH.half * 2, 0.06, 0.44, 0.012), WOOD, P(BENCH.x, by, bz + SEAT_TOP - 0.03), 0.06);
    for (const s of [-1, 1]) {
      solid.add(new BoxGeometry(0.07, SEAT_TOP - 0.06, 0.38), WOOD_DARK, P(BENCH.x + s * (BENCH.half - 0.12), by, bz + (SEAT_TOP - 0.06) / 2), 0.05);
      solid.add(new BoxGeometry(0.06, 0.62, 0.06), WOOD_DARK, P(BENCH.x + s * (BENCH.half - 0.12), by + 0.24, bz + SEAT_TOP + 0.26, 0, 1, 0.12), 0.05);
    }
    for (const h of [0.2, 0.42]) solid.add(new BoxGeometry(BENCH.half * 2, 0.13, 0.03), WOOD, P(BENCH.x, by + 0.25 + h * 0.1, bz + SEAT_TOP + h, 0, 1, 0.12), 0.06);
    const px = BENCH.x + BENCH.half + 0.45;
    solid.add(new CylinderGeometry(0.035, 0.05, 1.5, 6), WOOD_DARK, P(px, by + 0.2, bz + 0.75), 0.05);
    solid.add(new BoxGeometry(0.3, 0.03, 0.03), WOOD_DARK, P(px - 0.13, by + 0.2, bz + 1.46), 0.04);
    solid.add(new ConeGeometry(0.09, 0.06, 4), IRON, P(px - 0.26, by + 0.2, bz + 1.4, 0.785), 0);
    lit.add(new BoxGeometry(0.09, 0.14, 0.09), 0xffd27a, P(px - 0.26, by + 0.2, bz + 1.3), 0);

    // Lamps and embers: lit a little by day, bright at night.
    this.litMaterial.colorNode = vertexColor().mul(float(0.9).add(this.night.mul(1.5)));
    const mesh = new Mesh(solid.build({ ao: groundAO(0.6, 1.1, 0.72, gz) }), this.solidMaterial);
    mesh.castShadow = ctx.shadows;
    mesh.receiveShadow = ctx.shadows;
    const lamps = new Mesh(lit.build(), this.litMaterial);

    // ---- the flames: three tongues, their own mesh (it flickers by its scale) ----
    const f = new Mesher();
    f.add(new ConeGeometry(0.17, 0.62, 5), 0xff7a1a, at(0, 0.31, 0), 0.1);
    f.add(new ConeGeometry(0.11, 0.46, 5), 0xffb347, at(0.07, 0.25, 0.05, 0.6), 0.1);
    f.add(new ConeGeometry(0.08, 0.34, 4), 0xffe08a, at(-0.05, 0.2, -0.04, 1.3), 0.05);
    this.flames = new Mesh(f.build(), this.flameMaterial);
    this.flames.position.set(FIRE.x, gz + 0.1, -FIRE.y);
    this.flames.visible = false;

    // ---- the blanket: folded at the foot of the mat, or spread over his legs while he lies there ----
    const fold = new Mesher();
    fold.add(bevelBox(0.3, 0.13, 0.7, 0.04), ORANGE, at(0, 0, 0), 0.05);
    fold.add(new BoxGeometry(0.31, 0.03, 0.72), CREAM, at(0, 0.02, 0), 0.03);
    this.folded = new Mesh(fold.build(), this.solidMaterial);
    this.folded.position.set(LOCKER.x, gz + LOCKER.top + 0.065, -LOCKER.y);
    const b = new Mesher();
    b.add(bevelBox(1.22, 0.3, 0.86, 0.07), ORANGE, at(0, 0.15, 0), 0.05);
    for (const x of [-0.38, 0.0, 0.38]) b.add(new BoxGeometry(0.09, 0.305, 0.87), CREAM, at(x, 0.15, 0), 0.03);
    this.blanket = new Mesh(b.build(), this.solidMaterial);
    this.blanket.position.set(MAT.x + 0.3, gz + MAT.top, -MAT.y);
    this.blanket.visible = false;
    for (const m of [this.folded, this.blanket]) {
      m.castShadow = ctx.shadows;
      m.receiveShadow = ctx.shadows;
    }

    // ---- his sword, on its stand while he sleeps: point down, hilt up ----
    const s = new Mesher();
    s.add(new BoxGeometry(0.055, 0.86, 0.012), STEEL, at(0, 0.5, 0), 0.03);
    s.add(new BoxGeometry(0.055, 0.1, 0.012), STEEL, at(0, 0.035, 0, 0, [0.5, 1, 1]), 0.03);
    s.add(new BoxGeometry(0.26, 0.04, 0.045), ORANGE, at(0, 0.95, 0), 0.03);
    s.add(new CylinderGeometry(0.018, 0.02, 0.2, 6), IRON, at(0, 1.07, 0), 0);
    s.add(new IcosahedronGeometry(0.03, 0), ORANGE, at(0, 1.19, 0), 0);
    this.sword = new Mesh(s.build(), this.solidMaterial);
    this.sword.position.set(SWORD_STAND.x, gz + 0.08, -(SWORD_STAND.y + 0.01));
    this.sword.rotation.x = 0.06;
    this.sword.castShadow = ctx.shadows;
    this.sword.visible = false;

    this.group.add(mesh, lamps, this.flames, this.folded, this.blanket, this.sword);
    // (Small: the camera comes close here.)
    this.warmGlows = [
      [FIRE.x, gz + 0.45, -FIRE.y, 1.3],
      [lx, gz + DESK.top + 0.13, -ly, 0.5],
      [POLE.x + 0.38, gz + POLE.lantern + 0.03, -POLE.y, 0.55],
      [px - 0.26, gz + bz + 1.3, -(by + 0.2), 0.6],
    ];
    this.coolGlows = [];
  }

  setNight(lamps: number): void {
    this.nightLevel = lamps;
    this.night.value = lamps;
  }

  setOccupied(): void {}

  /** He's lying on his bed: the blanket's over his legs, his sword's on its stand. */
  setLying(lying: boolean): void {
    if (lying === this.lying) return;
    this.lying = lying;
    this.sword.visible = lying;
  }

  animate(frame: PlaceFrame): void {
    // The fire: from dusk to morning, and whenever he's at the camp.
    const near = Math.hypot(frame.galahadX - FIRE.x, frame.galahadY - FIRE.y) < 7;
    const lit = (this.nightLevel > 0.12 || near) && frame.rain < 0.85;
    this.lit = lit;
    if (this.flames.visible !== lit) this.flames.visible = lit;
    if (lit) {
      if (frame.motion) {
        const t = frame.t;
        this.flames.scale.set(1 + 0.12 * Math.sin(t * 9.1), 0.86 + 0.2 * Math.sin(t * 6.3) + 0.08 * Math.sin(t * 15.7), 1 + 0.12 * Math.cos(t * 7.7));
        this.flames.rotation.y = t * 0.9;
      } else this.flames.scale.set(1, 1, 1);
    }
    // The blanket: spread as he lies back, folded again when he's up.
    const want = this.lying ? 1 : 0;
    if (this.spread !== want) {
      this.spread = frame.motion ? Math.max(0, Math.min(1, this.spread + (want ? 1 : -1) * frame.dt * 1.6)) : want;
      const on = this.spread > 0.02;
      if (this.blanket.visible !== on) this.blanket.visible = on;
      if (this.folded.visible === on) this.folded.visible = !on;
      this.blanket.scale.set(0.3 + 0.7 * this.spread, 0.35 + 0.65 * this.spread, 1);
      this.blanket.position.x = MAT.x + 0.7 - 0.4 * this.spread;
    }
  }

  /** Under a ground point: his journal on the desk (tap it to read it). */
  overJournal(x: number, y: number): boolean {
    return Math.abs(x - DESK.x) < DESK.hx + 0.15 && Math.abs(y - DESK.y) < DESK.hy + 0.3;
  }

  hover(x: number, y: number, out: Vec3): string | null {
    const set = (px: number, py: number, pz: number, label: string): string => {
      out[0] = px;
      out[1] = py;
      out[2] = this.gz + pz;
      return label;
    };
    if (this.overJournal(x, y)) return set(JOURNAL.x, JOURNAL.y, DESK.top + 0.75, "His journal · tap to read");
    if (Math.hypot(x - DOG_BED.x, y - DOG_BED.y) < DOG_BED.r + 0.15) return set(DOG_BED.x, DOG_BED.y, 0.7, this.dogName ? `${this.dogName}'s bed` : "The dog's bed");
    if (Math.abs(x - MAT.x) < MAT.hx && Math.abs(y - MAT.y) < MAT.hy) return set(MAT.x, MAT.y, 1.1, "His bed");
    if (Math.hypot(x - FIRE.x, y - FIRE.y) < FIRE.r + 0.5) return set(FIRE.x, FIRE.y, 1.8, "The fire");
    if (Math.abs(x - BENCH.x) < BENCH.half + 0.2 && Math.abs(y - BENCH.y) < 0.7) return set(BENCH.x, BENCH.y, 1.4, "The bench by the lake");
    return null;
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof Mesh) o.geometry.dispose();
    });
    this.solidMaterial.dispose();
    this.litMaterial.dispose();
    this.flameMaterial.dispose();
    this.group.removeFromParent();
  }
}
