import { ARM, ARM_REST, armReach, duration, joints, type Joints, play, type Waypoint } from "./hall-arm.ts";
import { Cart, CART_PATH, type Obstacle } from "./hall-cart.ts";
import { CART, CRANE, DISPATCH, FARM, GANTRY, LINE, printerX, stopX } from "./hall-plan.ts";
import { BIG_PARTS, BigJob, EJECT, newPose, PARTS, type PartShape, PRINTER, PrintJob, type PrinterPose } from "./hall-print.ts";

/*
 * The workshop's work, as a simulation: pure (no drawing), stepped by the
 * renderer, and allocation-free per step. Parts are printed, swept off down a
 * chute onto the collector belt, ride it to the cart's dock and drop into its
 * tote; the cart takes the tote across the aisle to the assembly line, where an
 * arm picks each part onto a carrier, the conveyor indexes it on to a second arm
 * that screws it down, past the inspection arch and into the outfeed tunnel,
 * and the part goes back to the pool. Meanwhile the large-format printer prints
 * a wheel or a drone frame, and when it's done the bridge crane lifts it out
 * onto the dispatch table, whose rollers take it into the dispatch room.
 *
 * Every machine waits for the next when it must (a printer for a clear belt, the
 * belt for the cart, the cart for the arm and for Galahad, the line for parts),
 * so nothing ever passes through anything. The renderer reads the state: each
 * part's place, each machine's pose.
 */

export type PartState = "idle" | "printing" | "sweep" | "chute" | "belt" | "drop" | "tote" | "held" | "carrier";

export interface Part {
  readonly index: number;
  readonly shape: PartShape;
  /** The printer it's made by. */
  readonly printer: number;
  state: PartState;
  /** Where it is (world metres; z its underside's height) and how it's turned: yaw about z, tilt about its own x (down the chute). */
  x: number;
  y: number;
  z: number;
  yaw: number;
  tilt: number;
  /** How much of it is printed (metres; its full height once done). */
  printed: number;
  /** A clock for the state it's in, and where (a tote slot, a carrier). */
  t: number;
  slot: number;
}

export interface Printer {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly job: PrintJob;
  /** Time into the current job; −1 while waiting for a free part. */
  t: number;
  part: number;
  readonly pose: PrinterPose;
  /** Filament fed (metres): the spool turns by it. */
  fed: number;
}

export type CartState = "loading" | "out" | "unloading" | "back";

export interface Carrier {
  /** The stop it's at (it moves on with the line). */
  stop: number;
  part: number;
  fastened: boolean;
}

export type ArmTask = "idle" | "pick" | "fasten";

export interface AssemblyArm {
  readonly x: number;
  readonly y: number;
  readonly q: Joints;
  task: ArmTask;
  t: number;
  /** The task's waypoints and what happens at each (filled when a task begins). */
  readonly route: Waypoint[];
  /** Which waypoint of its task it's on (−1 when idle). */
  stage: number;
  /** 0 open .. 1 closed (the gripper), and the flange's spin while screwing (radians). */
  grip: number;
  spin: number;
  /** The part it carries, and the tote slot / carrier it's working on. */
  part: number;
  slot: number;
  carrier: number;
}

export type CraneState = "park" | "toPrinter" | "lower" | "grab" | "raise" | "toTable" | "lowerTable" | "release" | "raiseTable";

export interface FlowOptions {
  printers: number;
  /** Parts the tote holds before the cart sets off. */
  tote: number;
}

/** Tote slots: a 3 × 2 grid on its floor (in the cart's frame: along its length, across). */
export const TOTE_SLOTS: readonly (readonly [number, number])[] = [
  [-0.22, -0.14],
  [0, -0.14],
  [0.22, -0.14],
  [-0.22, 0.14],
  [0, 0.14],
  [0.22, 0.14],
];
/** The tote's floor above the cart's deck. */
export const TOTE_FLOOR = 0.04;

/** The belt's speed (m/s), the gap it keeps between parts, and where the end stop is. */
export const BELT_SPEED = 0.26;
const BELT_GAP = 0.3;
const BELT_STOP = FARM.belt.east - 0.16;
/** The printers' chutes' slope (radians), from the bed's front edge down to the belt. */
export const CHUTE_SLOPE = Math.atan2(FARM.top + PRINTER.eject - FARM.belt.top, PRINTER.bed - 0.15 + 0.3 - FARM.belt.half);
/** Seconds for a part to slide down a chute, and to drop from the belt's end into the tote. */
const CHUTE_TIME = 0.7;
const DROP_TIME = 0.55;
/** How long the line takes to move on one stop, and the cart's longest wait for a fuller tote. */
export const INDEX_TIME = 2.2;
const CART_PATIENCE = 40;
/** The carriers' fixture top (where a part stands on one), above the belt's top. */
export const FIXTURE = 0.07;
/** The crane's speeds: the bridge, the trolley (m/s), the hoist (m/s); and how hard they speed up. */
const BRIDGE_SPEED = 1.3;
const TROLLEY_SPEED = 0.9;
const HOIST_SPEED = 0.6;
const CRANE_ACCEL = 0.5;

const ease = (t: number): number => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};

/** One axis of the crane: towards a target at up to `max`, speeding up and braking at `accel`. */
class Axis {
  v = 0;
  constructor(public at: number) {}
  /** Returns true once at rest on the target. */
  to(target: number, max: number, accel: number, dt: number): boolean {
    const d = target - this.at;
    if (Math.abs(d) < 1e-3 && Math.abs(this.v) < 0.02) {
      this.at = target;
      this.v = 0;
      return true;
    }
    const want = Math.sign(d) * Math.min(max, Math.sqrt(2 * accel * Math.abs(d)));
    this.v += Math.max(-accel * dt, Math.min(accel * dt, want - this.v));
    const step = this.v * dt;
    if (Math.abs(step) > Math.abs(d)) {
      this.at = target;
      this.v = 0;
      return true;
    }
    this.at += step;
    return false;
  }
}

export class HallFlow {
  readonly parts: Part[] = [];
  readonly printers: Printer[] = [];
  readonly cart = new Cart(CART_PATH);
  cartState: CartState = "loading";
  cartWait = 0;
  /** The tote's slots: the part in each, −1 empty. */
  readonly tote: Int16Array;
  readonly carriers: Carrier[] = [];
  /** The line: 0 at rest, else how far through moving on a stop (0..1); and how many stops it has moved on in all. */
  index = 0;
  indexes = 0;
  moving = false;
  readonly arms: AssemblyArm[];
  /** The inspection arch's flash (seconds left). */
  flash = 0;
  /** The belt's travel (metres): its cleats move with it. */
  belt = 0;
  /** The large-format printer and its part. */
  readonly big: BigJob[] = [new BigJob(BIG_PARTS.wheel), new BigJob(BIG_PARTS.frame)];
  bigJob = 0;
  bigT = 0;
  /** "printing", "done" (waiting for the crane), "lifted" (on the crane), "table" (on the dispatch table), "out". */
  bigState: "printing" | "done" | "lifted" | "table" = "printing";
  readonly bigPose = { x: 0, y: 0, z: 0, printed: 0, progress: 0 };
  /** The big part's place (world) once off the printer. */
  bigX = GANTRY.bed.x;
  bigY = GANTRY.bed.y;
  bigZ = GANTRY.bedTop;
  /** The crane: its bridge (x), trolley (y), hook (the underside of its vacuum lifter's pad), the lifter's grip (0 off .. 1 holding). */
  readonly bridge = new Axis(CRANE.park.x);
  readonly trolley = new Axis(CRANE.park.y);
  readonly hook = new Axis(CRANE.up);
  craneState: CraneState = "park";
  craneT = 0;
  clamp = 0;
  /** The dispatch room's door: 0 shut .. 1 open. */
  door = 0;
  private readonly obstacles: Obstacle[] = [{ x: 1e4, y: 1e4 }];
  private readonly scratch = joints();
  private readonly tip: [number, number, number] = [0, 0, 0];

  constructor(readonly options: FlowOptions) {
    const shapes = [PARTS.gear, PARTS.bracket, PARTS.nut];
    const perPrinter = 4;
    for (let i = 0; i < options.printers; i++) {
      const shape = shapes[i % shapes.length]!;
      const job = new PrintJob(shape);
      // Staggered, so they don't all finish at once.
      const p: Printer = { index: i, x: printerX(i), y: FARM.y, job, t: (job.printTime * ((i * 0.37) % 1)) | 0, part: -1, pose: newPose(), fed: 0 };
      this.printers.push(p);
      for (let k = 0; k < perPrinter; k++) this.parts.push({ index: this.parts.length, shape, printer: i, state: "idle", x: p.x, y: p.y, z: 0, yaw: 0, tilt: 0, printed: 0, t: 0, slot: -1 });
    }
    this.tote = new Int16Array(Math.min(TOTE_SLOTS.length, options.tote)).fill(-1);
    for (let k = 0; k < LINE.stops; k++) this.carriers.push({ stop: k, part: -1, fastened: false });
    this.arms = LINE.arms.map((a) => ({ x: a.x, y: a.y, q: Float64Array.from(ARM_REST) as Joints, task: "idle" as ArmTask, t: 0, route: Array.from({ length: 7 }, () => ({ q: joints(), hold: 0 })), stage: -1, grip: 0, spin: 0, part: -1, slot: -1, carrier: -1 }));
    for (const arm of this.arms) arm.q[0] = Math.PI / 2;
    // Each printer starts with a part on its bed.
    for (const p of this.printers) this.startJob(p, p.t);
  }

  /** A free part of printer `i`'s, or −1. */
  private freePart(i: number): number {
    for (const part of this.parts) if (part.printer === i && part.state === "idle") return part.index;
    return -1;
  }

  private startJob(p: Printer, t: number): void {
    const free = this.freePart(p.index);
    if (free < 0) {
      p.t = -1;
      return;
    }
    p.part = free;
    p.t = t;
    const part = this.parts[free]!;
    part.state = "printing";
    part.printed = 0;
    part.yaw = 0;
    part.tilt = 0;
  }

  /** Whether the belt is clear round x (for a part to land there). */
  private beltClear(x: number): boolean {
    for (const part of this.parts) {
      if (part.state !== "belt" && part.state !== "chute") continue;
      if (part.state === "chute" && Math.abs(part.x - x) < 0.01) continue;
      // (Whatever's behind it travels on while the part is swept and slides down: it must still be a gap behind when it lands.)
      if (part.x > x - 0.45 - BELT_SPEED * (EJECT.sweep + CHUTE_TIME) && part.x < x + 0.4) return false;
    }
    return true;
  }

  private toteCount(): number {
    let n = 0;
    for (let i = 0; i < this.tote.length; i++) if (this.tote[i]! >= 0) n++;
    return n;
  }

  /** The tote slot `k` in the world, at the cart's pose (its floor's height in z). */
  totePoint(k: number, out: [number, number, number]): [number, number, number] {
    const pose = this.cart.pose;
    const [a, b] = TOTE_SLOTS[k]!;
    const c = Math.cos(pose.heading);
    const s = Math.sin(pose.heading);
    out[0] = pose.x + c * a - s * b;
    out[1] = pose.y + s * a + c * b;
    out[2] = CART.deck + TOTE_FLOOR;
    return out;
  }

  /** Where carrier `c` is now (x; the line moves them all together). */
  carrierX(c: Carrier): number {
    return stopX(c.stop) + (this.moving ? ease(this.index) * LINE.pitch : 0);
  }

  /** One step of everything. Galahad stands at (gx, gy). */
  step(dt: number, gx: number, gy: number): void {
    this.obstacles[0]!.x = gx;
    this.obstacles[0]!.y = gy;
    this.belt += BELT_SPEED * dt;
    this.stepPrinters(dt);
    this.stepBelt(dt);
    this.stepCart(dt);
    this.stepLine(dt);
    this.stepBig(dt);
  }

  private stepPrinters(dt: number): void {
    for (const p of this.printers) {
      if (p.t < 0) {
        this.startJob(p, 0);
        if (p.t < 0) continue;
      }
      const job = p.job;
      const sweepAt = job.printTime + EJECT.park + EJECT.drop;
      let next = p.t + dt;
      // Before the sweep, wait for the belt below to be clear.
      if (p.t <= sweepAt && next > sweepAt && !this.beltClear(p.x)) next = sweepAt;
      job.pose(next, p.pose);
      if (p.pose.extruding) p.fed += dt * job.speed * 0.08;
      p.t = next;
      const part = this.parts[p.part];
      if (part && (part.state === "printing" || part.state === "sweep")) {
        part.printed = p.pose.printed;
        part.x = p.x;
        part.y = p.y + p.pose.partY;
        part.z = FARM.top + p.pose.bed;
        part.state = p.pose.partY < 0 ? "sweep" : "printing";
        if (p.pose.gone) {
          // Over the edge: down the chute.
          part.state = "chute";
          part.t = 0;
          part.printed = part.shape.height;
        }
      }
      if (p.t >= job.duration) this.startJob(p, 0);
    }
  }

  private stepBelt(dt: number): void {
    const docked = this.cartState === "loading" && this.cart.s === 0 && this.cart.v === 0;
    // Parts on the belt, from the end back: each moves on until the stop or the part ahead.
    let ahead = Number.POSITIVE_INFINITY;
    for (let pass = 0; pass < this.parts.length; pass++) {
      // The frontmost part still to move (they're few: a scan is cheaper than sorting).
      let best = -1;
      for (const part of this.parts) {
        if (part.state !== "belt" || part.t === -2) continue;
        if (part.x < ahead && (best < 0 || part.x > this.parts[best]!.x)) best = part.index;
      }
      if (best < 0) break;
      const part = this.parts[best]!;
      const limit = Math.min(BELT_STOP, ahead - BELT_GAP);
      part.x = Math.min(limit, part.x + BELT_SPEED * dt);
      part.t = -2;
      ahead = part.x;
    }
    for (const part of this.parts) if (part.state === "belt") part.t = 0;
    // The part at the end stop drops into the tote, if the cart is there and there's room.
    if (docked) {
      for (const part of this.parts) {
        if (part.state !== "belt" || part.x < BELT_STOP - 1e-6) continue;
        let slot = -1;
        for (let k = 0; k < this.tote.length; k++) if (this.tote[k]! < 0) slot = slot < 0 ? k : slot;
        if (slot < 0) break;
        this.tote[slot] = part.index;
        part.state = "drop";
        part.slot = slot;
        part.t = 0;
        break;
      }
    }
    // Chutes and drops.
    for (const part of this.parts) {
      if (part.state === "chute") {
        part.t += dt;
        const p = this.printers[part.printer]!;
        const u = Math.min(1, part.t / CHUTE_TIME);
        // From the bed's front edge down the chute's slope to the belt's far edge, then onto its centre line.
        const y0 = p.y - PRINTER.bed;
        const y1 = FARM.belt.y + FARM.belt.half;
        const z0 = FARM.top + PRINTER.eject;
        const slide = Math.min(1, u / 0.75);
        part.x = p.x;
        part.y = u < 0.75 ? y0 + (y1 - y0) * slide : y1 + (FARM.belt.y - y1) * ((u - 0.75) / 0.25);
        part.z = u < 0.75 ? z0 + (FARM.belt.top - z0) * slide : FARM.belt.top;
        part.tilt = u < 0.75 ? -CHUTE_SLOPE * Math.min(1, slide * 4, (1 - slide) * 4) : 0;
        if (u >= 1) {
          part.state = "belt";
          part.tilt = 0;
          part.z = FARM.belt.top;
          part.y = FARM.belt.y;
          part.t = 0;
        }
      } else if (part.state === "drop") {
        part.t += dt;
        const u = Math.min(1, part.t / DROP_TIME);
        const to = this.totePoint(part.slot, this.tip);
        const x0 = BELT_STOP;
        part.x = x0 + (to[0] - x0) * u;
        part.y = FARM.belt.y + (to[1] - FARM.belt.y) * u;
        // Off the end, over the tote's rim and down into it.
        part.z = FARM.belt.top + (to[2] - FARM.belt.top) * u * u * u + 0.05 * Math.sin(u * Math.PI);
        part.tilt = 0.35 * Math.sin(u * Math.PI);
        if (u >= 1) {
          part.state = "tote";
          part.tilt = 0;
        }
      } else if (part.state === "tote") {
        // It rides in the tote, turning as the cart turns.
        const to = this.totePoint(part.slot, this.tip);
        part.x = to[0];
        part.y = to[1];
        part.z = to[2];
        part.yaw = this.cart.pose.heading + Math.PI / 2;
      }
    }
  }

  private stepCart(dt: number): void {
    const cart = this.cart;
    const end = cart.lane.length;
    const n = this.toteCount();
    switch (this.cartState) {
      case "loading":
        this.cartWait += dt;
        if (n >= this.tote.length || (n > 0 && this.cartWait > CART_PATIENCE)) {
          // Not while a part is still dropping in.
          let dropping = false;
          for (const p of this.parts) if (p.state === "drop") dropping = true;
          if (!dropping) {
            this.cartState = "out";
            this.cartWait = 0;
          }
        }
        cart.drive(0, dt, this.obstacles);
        break;
      case "out":
        if (cart.drive(end, dt, this.obstacles)) this.cartState = "unloading";
        break;
      case "unloading": {
        const picker = this.arms[0]!;
        // Off again once the tote is empty and the arm is up and away from it.
        if (n === 0 && !(picker.task === "pick" && picker.stage < 3)) this.cartState = "back";
        cart.drive(end, dt, this.obstacles);
        break;
      }
      case "back":
        if (cart.drive(0, dt, this.obstacles)) {
          this.cartState = "loading";
          this.cartWait = 0;
        }
        break;
    }
  }

  /** Begins the picker's task: from the tote's slot `slot` to the carrier at the pick stop. */
  private beginPick(arm: AssemblyArm, slot: number, carrier: number): void {
    const part = this.parts[this.tote[slot]!]!;
    const from = this.totePoint(slot, this.tip);
    const grab = part.shape.height * 0.55;
    const ax = from[0] - arm.x;
    const ay = from[1] - arm.y;
    const az = from[2] - LINE.pedestal + grab;
    const yaw = part.yaw;
    const tx = stopX(LINE.pick) - arm.x;
    const ty = LINE.y - arm.y;
    const tz = LINE.top + FIXTURE - LINE.pedestal + grab;
    const r = arm.route;
    armReach(ax, ay, az + 0.35, yaw, r[0]!.q);
    r[0]!.hold = 0.1;
    armReach(ax, ay, az, yaw, r[1]!.q);
    r[1]!.hold = 0.45;
    armReach(ax, ay, az + 0.4, yaw, r[2]!.q);
    r[2]!.hold = 0;
    armReach(tx, ty, tz + 0.4, 0, r[3]!.q);
    r[3]!.hold = 0.1;
    armReach(tx, ty, tz, 0, r[4]!.q);
    r[4]!.hold = 0.45;
    armReach(tx, ty, tz + 0.4, 0, r[5]!.q);
    r[5]!.hold = 0;
    r[6]!.q.set(ARM_REST);
    r[6]!.q[0] = Math.PI / 2;
    r[6]!.hold = 0;
    arm.task = "pick";
    arm.t = 0;
    arm.slot = slot;
    arm.carrier = carrier;
    arm.part = -1;
  }

  /** Begins the fastener's task: a screw from the feeder, into the part on the carrier at the fastening stop. */
  private beginFasten(arm: AssemblyArm, carrier: number): void {
    const part = this.parts[this.carriers[carrier]!.part]!;
    const fx = LINE.feeder.x - arm.x;
    const fy = LINE.feeder.y - arm.y;
    const fz = LINE.feeder.top - LINE.pedestal + 0.02;
    const tx = stopX(LINE.fasten) - arm.x;
    const ty = LINE.y - arm.y;
    const tz = LINE.top + FIXTURE - LINE.pedestal + part.shape.height + 0.01;
    const r = arm.route;
    armReach(fx, fy, fz + 0.3, 0, r[0]!.q);
    r[0]!.hold = 0;
    armReach(fx, fy, fz, 0, r[1]!.q);
    r[1]!.hold = 0.35;
    armReach(fx, fy, fz + 0.3, 0, r[2]!.q);
    r[2]!.hold = 0;
    armReach(tx, ty, tz + 0.3, 0, r[3]!.q);
    r[3]!.hold = 0.1;
    armReach(tx, ty, tz, 0, r[4]!.q);
    r[4]!.hold = 1.6;
    armReach(tx, ty, tz + 0.3, 0, r[5]!.q);
    r[5]!.hold = 0;
    r[6]!.q.set(ARM_REST);
    r[6]!.q[0] = Math.PI / 2;
    r[6]!.hold = 0;
    arm.task = "fasten";
    arm.t = 0;
    arm.carrier = carrier;
    arm.part = -1;
    arm.slot = -1;
  }

  private carrierAt(stop: number): number {
    for (let i = 0; i < this.carriers.length; i++) if (this.carriers[i]!.stop === stop) return i;
    return -1;
  }

  private stepLine(dt: number): void {
    const [picker, fastener] = this.arms as [AssemblyArm, AssemblyArm];
    const docked = this.cartState === "unloading";
    this.flash = Math.max(0, this.flash - dt);
    // The conveyor.
    if (this.moving) {
      this.index += dt / INDEX_TIME;
      if (this.index >= 1) {
        this.moving = false;
        this.index = 0;
        this.indexes++;
        for (const c of this.carriers) {
          c.stop = (c.stop + 1) % LINE.stops;
          if (c.stop === LINE.stops - 2 && c.part >= 0) {
            // Into the outfeed: done.
            this.parts[c.part]!.state = "idle";
            c.part = -1;
            c.fastened = false;
          }
          if (c.stop === LINE.inspect && c.part >= 0) this.flash = 0.9;
        }
      }
    } else {
      const pickC = this.carrierAt(LINE.pick);
      const fastC = this.carrierAt(LINE.fasten);
      const picked = pickC >= 0 && this.carriers[pickC]!.part >= 0;
      const needsFasten = fastC >= 0 && this.carriers[fastC]!.part >= 0 && !this.carriers[fastC]!.fastened;
      const partsComing = docked && this.toteCount() > 0;
      let downstream = false;
      for (const c of this.carriers) if (c.part >= 0 && c.stop > LINE.pick) downstream = true;
      const armsClear = picker.task === "idle" && fastener.task === "idle";
      if (armsClear && !needsFasten && (picked || (!partsComing && downstream))) {
        this.moving = true;
        this.index = 0;
      }
      // The picker: a part from the tote onto the empty carrier at its stop.
      if (picker.task === "idle" && docked && pickC >= 0 && !picked) {
        for (let k = 0; k < this.tote.length; k++) {
          if (this.tote[k]! >= 0) {
            this.beginPick(picker, k, pickC);
            break;
          }
        }
      }
      if (fastener.task === "idle" && needsFasten) this.beginFasten(fastener, fastC);
    }
    for (const arm of this.arms) this.stepArm(arm, dt);
    // Parts on carriers ride with them.
    for (const c of this.carriers) {
      if (c.part < 0) continue;
      const part = this.parts[c.part]!;
      if (part.state !== "carrier") continue;
      part.x = this.carrierX(c);
      part.y = LINE.y;
      part.z = LINE.top + FIXTURE;
    }
  }

  private stepArm(arm: AssemblyArm, dt: number): void {
    if (arm.task === "idle") {
      arm.grip += (0 - arm.grip) * Math.min(1, dt * 6);
      return;
    }
    arm.t += dt;
    const route = arm.route;
    const from = this.scratch;
    // (The task began from where the arm was; it always rests in the same place, so that's the rest pose.)
    from.set(ARM_REST);
    from[0] = Math.PI / 2;
    const stage = play(route, from, arm.t, arm.q);
    arm.stage = stage;
    // What the tool does: the gripper closes at the tote (stage 1's hold) and opens at the carrier (stage 4's).
    if (arm.task === "pick") {
      const closed = stage >= 2 || (stage === 1 && this.holding(route, from, arm.t, 1));
      const opened = stage >= 5 || stage === -1 || (stage === 4 && this.holding(route, from, arm.t, 4));
      const want = closed && !opened ? 1 : 0;
      arm.grip += (want - arm.grip) * Math.min(1, dt * 8);
      if (closed && !opened && arm.part < 0 && arm.slot >= 0) {
        // Picked up.
        arm.part = this.tote[arm.slot]!;
        this.tote[arm.slot] = -1;
        arm.slot = -1;
        this.parts[arm.part]!.state = "held";
      }
      if (opened && arm.part >= 0) {
        // Set down on the carrier.
        const c = this.carriers[arm.carrier]!;
        c.part = arm.part;
        c.fastened = false;
        const part = this.parts[arm.part]!;
        part.state = "carrier";
        part.yaw = 0;
        arm.part = -1;
      }
      if (arm.part >= 0) {
        // In the gripper: under the tool's tip.
        const part = this.parts[arm.part]!;
        this.toolTip(arm, this.tip);
        part.x = this.tip[0];
        part.y = this.tip[1];
        part.z = this.tip[2] - part.shape.height * 0.55;
        part.yaw = arm.q[0]! + Math.PI - arm.q[5]!;
      }
    } else {
      // Screwing: the flange turns while it holds on the part.
      const screwing = stage === 4 && this.holding(route, from, arm.t, 4);
      arm.spin += screwing ? dt * 14 : 0;
      arm.grip += ((stage >= 1 && stage <= 4 ? 1 : 0) - arm.grip) * Math.min(1, dt * 8);
      if (stage >= 5 || stage === -1) {
        const c = this.carriers[arm.carrier];
        if (c) c.fastened = true;
      }
    }
    if (stage === -1) {
      arm.task = "idle";
      arm.t = 0;
      arm.stage = -1;
    }
  }

  /** Whether a sequence at `t` is in waypoint `i`'s hold (arrived, not yet left). */
  private holding(route: readonly Waypoint[], from: ArrayLike<number>, t: number, i: number): boolean {
    const until = duration(route, from, i + 1);
    return t >= until - route[i]!.hold && t < until;
  }

  /** The tool's tip of an arm in the world, into `out`. */
  toolTip(arm: AssemblyArm, out: [number, number, number]): [number, number, number] {
    // (Tool straight down at every waypoint, so the tip is under the wrist's centre: solve it directly.)
    const q = arm.q;
    const s = Math.sin;
    const c = Math.cos;
    const r = ARM.a2 * s(q[1]!) + ARM.d4 * s(q[1]! + q[2]!) + (ARM.d6 + ARM.tool) * s(q[1]! + q[2]! + q[4]!);
    const z = ARM.d1 + ARM.a2 * c(q[1]!) + ARM.d4 * c(q[1]! + q[2]!) + (ARM.d6 + ARM.tool) * c(q[1]! + q[2]! + q[4]!);
    out[0] = arm.x + r * c(q[0]!);
    out[1] = arm.y + r * s(q[0]!);
    out[2] = LINE.pedestal + z;
    return out;
  }

  private stepBig(dt: number): void {
    const job = this.big[this.bigJob]!;
    if (this.bigState === "printing") {
      this.bigT += dt;
      job.pose(this.bigT, this.bigPose);
      this.bigX = GANTRY.bed.x;
      this.bigY = GANTRY.bed.y;
      this.bigZ = GANTRY.bedTop;
      if (this.bigT >= job.printTime + 2.2) this.bigState = "done";
    } else job.pose(job.printTime + 3, this.bigPose);
    this.stepCrane(dt);
    // The dispatch table rolls a part north into the dispatch room, whose door opens for it and shuts after.
    let wantDoor = 0;
    if (this.bigState === "table") {
      wantDoor = 1;
      if (this.door > 0.97) {
        this.bigY += dt * 0.35;
        if (this.bigY > DISPATCH.room.y + 0.2) {
          // Gone: the next print begins.
          this.bigState = "printing";
          this.bigJob = (this.bigJob + 1) % this.big.length;
          this.bigT = 0;
        }
      }
    }
    this.door = Math.max(0, Math.min(1, this.door + (wantDoor ? dt / 2.5 : -dt / 2.5)));
  }

  private stepCrane(dt: number): void {
    const job = this.big[this.bigJob]!;
    const top = GANTRY.bedTop + job.shape.height;
    let atX = false;
    let atY = false;
    switch (this.craneState) {
      case "park":
        this.bridge.to(CRANE.park.x, BRIDGE_SPEED, CRANE_ACCEL, dt);
        this.trolley.to(CRANE.park.y, TROLLEY_SPEED, CRANE_ACCEL, dt);
        this.hook.to(CRANE.up, HOIST_SPEED, CRANE_ACCEL, dt);
        if (this.bigState === "done") this.craneState = "toPrinter";
        break;
      case "toPrinter":
        this.hook.to(CRANE.up, HOIST_SPEED, CRANE_ACCEL, dt);
        atX = this.bridge.to(GANTRY.bed.x, BRIDGE_SPEED, CRANE_ACCEL, dt);
        atY = this.trolley.to(GANTRY.bed.y, TROLLEY_SPEED, CRANE_ACCEL, dt);
        if (atX && atY) this.craneState = "lower";
        break;
      case "lower":
        if (this.hook.to(top, HOIST_SPEED, CRANE_ACCEL, dt)) {
          this.craneState = "grab";
          this.craneT = 0;
        }
        break;
      case "grab":
        this.craneT += dt;
        this.clamp = Math.min(1, this.craneT / 0.8);
        if (this.craneT > 1) {
          this.craneState = "raise";
          this.bigState = "lifted";
        }
        break;
      case "raise":
        if (this.hook.to(CRANE.up, HOIST_SPEED, CRANE_ACCEL, dt)) this.craneState = "toTable";
        break;
      case "toTable":
        atX = this.bridge.to(DISPATCH.drop.x, BRIDGE_SPEED, CRANE_ACCEL, dt);
        atY = this.trolley.to(DISPATCH.drop.y, TROLLEY_SPEED, CRANE_ACCEL, dt);
        if (atX && atY) this.craneState = "lowerTable";
        break;
      case "lowerTable":
        if (this.hook.to(DISPATCH.top + job.shape.height, HOIST_SPEED, CRANE_ACCEL, dt)) {
          this.craneState = "release";
          this.craneT = 0;
        }
        break;
      case "release":
        this.craneT += dt;
        this.clamp = Math.max(0, 1 - this.craneT / 0.8);
        if (this.craneT > 1) {
          this.craneState = "raiseTable";
          this.bigState = "table";
          this.bigX = DISPATCH.drop.x;
          this.bigY = DISPATCH.drop.y;
          this.bigZ = DISPATCH.top;
        }
        break;
      case "raiseTable":
        if (this.hook.to(CRANE.up, HOIST_SPEED, CRANE_ACCEL, dt)) this.craneState = "park";
        break;
    }
    if (this.bigState === "lifted") {
      this.bigX = this.bridge.at;
      this.bigY = this.trolley.at;
      this.bigZ = this.hook.at - job.shape.height;
    }
  }

  /** The big part being printed or carried, and how much of it exists (its full height once done). */
  get bigShape(): PartShape {
    return this.big[this.bigJob]!.shape;
  }
}
