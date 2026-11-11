/*
 * The printers' kinematics, pure. A desktop printer here is a CoreXY machine:
 * its head moves in a level plane (X along the beam, the beam along Y), its bed
 * moves down a layer at a time, so the nozzle stays at one height and the part
 * grows up to it from the sinking bed. A job is a part: its outline, laid down
 * as perimeters, layer after layer, at the head's speed. When the part is done
 * the head parks, the bed drops to the sweeper's level and a bar sweeps the part
 * off the front of the bed down the chute; then the bed comes back up for the
 * next. The large-format printer is a gantry over a fixed bed that lifts its
 * head a layer at a time instead. Everything here is a function of time since a
 * job began, so the renderer can pose any instant and the tests can check them.
 *
 * Units are metres in the printer's own frame: x to its right (east), y to its
 * back (north), z up from its bed's surface (for the head) or from its frame's
 * foot (for the bed).
 */

export type Point2 = readonly [number, number];

/** A part's shape: closed outlines (counter-clockwise, in its own frame round its centre), holes, and its height. */
export interface PartShape {
  name: string;
  outline: Point2[];
  holes: Point2[][];
  height: number;
  /** Its colour (sRGB) and the spool's. */
  color: number;
}

const circle = (r: number, n: number, phase = 0): Point2[] => Array.from({ length: n }, (_, i) => [r * Math.cos(phase + (i / n) * Math.PI * 2), r * Math.sin(phase + (i / n) * Math.PI * 2)] as const);

/** A spur gear's outline: `teeth` trapezoidal teeth between `root` and `tip` radii. */
function gear(teeth: number, root: number, tip: number): Point2[] {
  const out: Point2[] = [];
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2;
    const step = (Math.PI * 2) / teeth;
    for (const [f, r] of [
      [0, root],
      [0.18, tip],
      [0.5, tip],
      [0.68, root],
    ] as const) {
      out.push([r * Math.cos(a + f * step), r * Math.sin(a + f * step)]);
    }
  }
  return out;
}

/** The small parts the farm prints (all drawn 2.5 × life size, like the robots). */
export const PARTS: Record<"gear" | "bracket" | "nut", PartShape> = {
  gear: { name: "Gear", outline: gear(12, 0.088, 0.112), holes: [circle(0.026, 10)], height: 0.05, color: 0xe8853a },
  bracket: {
    name: "Bracket",
    outline: [
      [-0.1, -0.07],
      [0.1, -0.07],
      [0.1, -0.015],
      [-0.045, -0.015],
      [-0.045, 0.07],
      [-0.1, 0.07],
    ],
    holes: [],
    height: 0.11,
    color: 0x4f9be3,
  },
  nut: { name: "Hub", outline: circle(0.09, 6, Math.PI / 6), holes: [circle(0.034, 10)], height: 0.07, color: 0x5cbf6e },
};

/** The big parts the large-format printer makes. */
export const BIG_PARTS: Record<"wheel" | "frame", PartShape> = {
  wheel: {
    name: "Rover wheel",
    outline: circle(0.62, 28),
    holes: Array.from({ length: 6 }, (_, i) => {
      // The spaces between six spokes, inside the rim and outside the hub.
      const a0 = (i / 6) * Math.PI * 2 + 0.16;
      const a1 = ((i + 1) / 6) * Math.PI * 2 - 0.16;
      const pts: Point2[] = [];
      for (let k = 0; k <= 4; k++) {
        const a = a0 + ((a1 - a0) * k) / 4;
        pts.push([0.5 * Math.cos(a), 0.5 * Math.sin(a)]);
      }
      for (let k = 2; k >= 0; k--) {
        const a = a0 + 0.12 + ((a1 - a0 - 0.24) * k) / 2;
        pts.push([0.17 * Math.cos(a), 0.17 * Math.sin(a)]);
      }
      return pts;
    }),
    height: 0.42,
    color: 0x5a6070,
  },
  frame: {
    name: "Drone frame",
    outline: (() => {
      // An X of two arms with round motor pads at their ends, and a square body.
      const pts: Point2[] = [];
      for (let i = 0; i < 4; i++) {
        const a = Math.PI / 4 + (i * Math.PI) / 2;
        const c = Math.cos(a);
        const s = Math.sin(a);
        const w = 0.055;
        // Along the arm to its pad, round the pad, back.
        pts.push([0.16 * c - w * -s, 0.16 * s - w * c]);
        for (let k = -3; k <= 3; k++) {
          const b = a + (k / 3) * 2.2;
          pts.push([0.62 * c + 0.13 * Math.cos(b), 0.62 * s + 0.13 * Math.sin(b)]);
        }
        pts.push([0.16 * c + w * -s, 0.16 * s + w * c]);
      }
      return pts;
    })(),
    holes: [],
    height: 0.1,
    color: 0x3f434c,
  },
};

/** A desktop printer's geometry (its own frame; the bench top is z = 0). */
export const PRINTER = {
  /** The frame's half-width and half-depth, and its height. */
  half: 0.46,
  height: 1.05,
  /** The bed: its half-size, and its surface's height at the top of its travel (the nozzle's tip is just above). */
  bed: 0.3,
  nozzle: 0.82,
  /** The bed's surface when the sweeper clears it, and the sweeper bar's half-depth. */
  eject: 0.2,
  bar: 0.015,
  /** The head's travel (half, either way) and where it parks (back left). */
  reach: 0.27,
  park: [-0.27, 0.27] as Point2,
  /** Layer height and the head's speed. */
  layer: 0.004,
  speed: 0.42,
};

/** Seconds for each step of the eject cycle: park, drop the bed, sweep, return the bar and raise the bed. */
export const EJECT = { park: 1, drop: 2.2, sweep: 2.4, back: 2 };
export const EJECT_TIME = EJECT.park + EJECT.drop + EJECT.sweep + EJECT.back;

/** A path: points, and the distance along it to each. */
export interface Path {
  points: Point2[];
  at: number[];
  length: number;
}

function pathOf(points: Point2[]): Path {
  const at = [0];
  for (let i = 1; i < points.length; i++) at.push(at[i - 1]! + Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]));
  return { points, at, length: at[at.length - 1]! };
}

/** Where along a path `d` is (clamped), into `out`. */
export function along(path: Path, d: number, out: [number, number]): [number, number] {
  const { points, at } = path;
  if (d <= 0) {
    out[0] = points[0]![0];
    out[1] = points[0]![1];
    return out;
  }
  let lo = 0;
  let hi = at.length - 1;
  if (d >= at[hi]!) {
    out[0] = points[hi]![0];
    out[1] = points[hi]![1];
    return out;
  }
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (at[mid]! <= d) lo = mid;
    else hi = mid;
  }
  const f = (d - at[lo]!) / Math.max(1e-9, at[hi]! - at[lo]!);
  out[0] = points[lo]![0] + (points[hi]![0] - points[lo]![0]) * f;
  out[1] = points[lo]![1] + (points[hi]![1] - points[lo]![1]) * f;
  return out;
}

/** A loop scaled about the part's centre (an inner perimeter: the part's outlines here are near enough round). */
const inset = (loop: readonly Point2[], k: number): Point2[] => loop.map(([x, y]) => [x * k, y * k] as const);

/** One layer's toolpath: the outline and two inner perimeters, then each hole, each loop closed, joined by travel moves. */
export function layerPath(shape: PartShape, perimeters = 3): Path {
  const loops: Point2[][] = [];
  for (let p = 0; p < perimeters; p++) loops.push(inset(shape.outline, 1 - p * 0.12));
  for (const hole of shape.holes) loops.push([...hole]);
  const pts: Point2[] = [];
  for (const loop of loops) {
    for (const p of loop) pts.push(p);
    pts.push(loop[0]!);
  }
  return pathOf(pts);
}

/** Where a printer is in its job, at a time since the job began. */
export interface PrinterPose {
  /** The nozzle's tip over the bed: x, y (the head), and the bed's surface height (frame). */
  headX: number;
  headY: number;
  bed: number;
  /** The sweeper bar's y (it rests at the bed's back edge). */
  bar: number;
  /** The part on the bed: its y (pushed by the bar), how much of it is printed (metres), and whether it has gone over the edge. */
  partY: number;
  printed: number;
  gone: boolean;
  /** 0..1 through the print (for the display), and whether the head is laying filament. */
  progress: number;
  extruding: boolean;
}

export const newPose = (): PrinterPose => ({ headX: 0, headY: 0, bed: PRINTER.nozzle, bar: PRINTER.bed, partY: 0, printed: 0, gone: false, progress: 0, extruding: false });

const smooth = (t: number): number => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};

/** A desktop print job: a shape, its toolpath and how long each layer and the whole job take. */
export class PrintJob {
  readonly path: Path;
  readonly layers: number;
  readonly layerTime: number;
  /** Printing alone; and with the eject cycle after it. */
  readonly printTime: number;
  readonly duration: number;
  /** The part's extent in y (its own frame): its front and back. */
  readonly front: number;
  readonly back: number;
  private readonly p: [number, number] = [0, 0];

  constructor(
    readonly shape: PartShape,
    readonly speed = PRINTER.speed,
    readonly layer = PRINTER.layer,
  ) {
    this.path = layerPath(shape);
    this.layers = Math.max(1, Math.round(shape.height / layer));
    this.layerTime = this.path.length / speed + 0.25;
    this.printTime = this.layers * this.layerTime;
    this.duration = this.printTime + EJECT_TIME;
    this.front = Math.min(...shape.outline.map((q) => q[1]));
    this.back = Math.max(...shape.outline.map((q) => q[1]));
  }

  /** The printer at `t` seconds into the job (clamped to its end), into `out`. */
  pose(t: number, out: PrinterPose): PrinterPose {
    const P = PRINTER;
    out.gone = false;
    out.partY = 0;
    out.bar = P.bed;
    if (t < this.printTime) {
      const k = Math.max(0, Math.floor(t / this.layerTime));
      const into = t - k * this.layerTime;
      // A quarter second at the end of each layer: the bed steps down and the head travels back to the start.
      const d = Math.min(this.path.length, into * this.speed);
      along(this.path, d, this.p);
      out.headX = this.p[0];
      out.headY = this.p[1];
      out.extruding = d < this.path.length;
      out.printed = Math.min(this.shape.height, (k + Math.min(1, d / this.path.length)) * this.layer);
      out.bed = P.nozzle - (k + 1) * this.layer;
      out.progress = t / this.printTime;
      return out;
    }
    out.printed = this.shape.height;
    out.progress = 1;
    out.extruding = false;
    const lowest = P.nozzle - this.layers * this.layer;
    let e = t - this.printTime;
    // Park the head (it's above the part's top already, so it can go straight there).
    const fromX = this.path.points[this.path.points.length - 1]![0];
    const fromY = this.path.points[this.path.points.length - 1]![1];
    const parked = smooth(e / EJECT.park);
    out.headX = fromX + (P.park[0] - fromX) * parked;
    out.headY = fromY + (P.park[1] - fromY) * parked;
    out.bed = lowest;
    if ((e -= EJECT.park) < 0) return out;
    // Drop the bed to the sweeper's level.
    out.bed = lowest + (P.eject - lowest) * smooth(e / EJECT.drop);
    if ((e -= EJECT.drop) < 0) return out;
    // Sweep: the bar comes forward from the back edge to past the front; the part goes ahead of it once it's touched.
    out.bed = P.eject;
    const to = -P.bed - P.bar - this.back - 0.02;
    out.bar = P.bed + (to - P.bed) * smooth(e / EJECT.sweep);
    out.partY = Math.min(0, out.bar - P.bar - this.back);
    out.gone = out.partY < -P.bed;
    if ((e -= EJECT.sweep) < 0) return out;
    // The bar goes back and the bed comes up to the nozzle for the next part.
    out.gone = true;
    const back = smooth(e / EJECT.back);
    out.bar = to + (P.bed - to) * back;
    out.bed = P.eject + (P.nozzle - P.eject) * back;
    return out;
  }
}

/** The large-format printer: a gantry (Y) carrying a carriage (X) with a head that rises (Z) a layer at a time. */
export const GANTRY_PRINTER = {
  /** The head's reach either way in x and y, the layer height and the head's speed. */
  reach: 1.2,
  layer: 0.02,
  speed: 1.6,
  /** Where the head waits, raised, while a part is lifted out (the back of the bed). */
  park: [0, 1.15] as Point2,
  clear: 0.9,
};

/** A big print: the same, but the head rises instead of the bed falling. */
export class BigJob {
  readonly path: Path;
  readonly layers: number;
  readonly layerTime: number;
  readonly printTime: number;
  private readonly p: [number, number] = [0, 0];

  constructor(readonly shape: PartShape) {
    this.path = layerPath(shape, 2);
    this.layers = Math.max(1, Math.round(shape.height / GANTRY_PRINTER.layer));
    this.layerTime = this.path.length / GANTRY_PRINTER.speed + 0.4;
    this.printTime = this.layers * this.layerTime;
  }

  /** The head (x, y over the bed, z of its tip above the bed) and how much is printed, at `t`; parked and raised once done. */
  pose(t: number, out: { x: number; y: number; z: number; printed: number; progress: number }): void {
    if (t >= this.printTime) {
      const e = smooth((t - this.printTime) / 2);
      const last = this.path.points[this.path.points.length - 1]!;
      out.x = last[0] + (GANTRY_PRINTER.park[0] - last[0]) * e;
      out.y = last[1] + (GANTRY_PRINTER.park[1] - last[1]) * e;
      out.z = this.shape.height + GANTRY_PRINTER.clear * e;
      out.printed = this.shape.height;
      out.progress = 1;
      return;
    }
    const k = Math.max(0, Math.floor(t / this.layerTime));
    const d = Math.min(this.path.length, (t - k * this.layerTime) * GANTRY_PRINTER.speed);
    along(this.path, d, this.p);
    out.x = this.p[0];
    out.y = this.p[1];
    out.z = (k + 1) * GANTRY_PRINTER.layer;
    out.printed = Math.min(this.shape.height, (k + Math.min(1, d / this.path.length)) * GANTRY_PRINTER.layer);
    out.progress = t / this.printTime;
  }
}
