/*
 * Inverse kinematics and footwork for the SANDBOX's characters: a two-bone
 * solver (thigh and shin, upper arm and forearm) and a foot planner that keeps
 * every foot planted where it landed while the body walks on, swings it to the
 * next landing in an arc, and steps it back under the body when he stops. Works
 * for two feet (Galahad) and four (his dog's trot). Plain numbers in, typed
 * arrays out: nothing is allocated per step. Pure, so unit-tested.
 */

/**
 * Two-bone IK. From the root joint (r), towards the target (t), bending the
 * middle joint towards the pole (p), with bone lengths a (root → middle) and b
 * (middle → end). Writes the middle joint into out[0..2] and the reached end
 * into out[3..5] (the target, or as far towards it as the bones reach). Returns
 * the distance from the root to the end. Any space, as long as all points share it.
 */
export function solveTwoBone(
  rx: number,
  ry: number,
  rz: number,
  tx: number,
  ty: number,
  tz: number,
  px: number,
  py: number,
  pz: number,
  a: number,
  b: number,
  out: Float64Array | number[],
): number {
  let dx = tx - rx;
  let dy = ty - ry;
  let dz = tz - rz;
  let len = Math.hypot(dx, dy, dz);
  if (len < 1e-9) {
    // On top of the root: straight down is as good as any direction.
    dx = 0;
    dy = -1;
    dz = 0;
    len = 1;
  }
  dx /= len;
  dy /= len;
  dz /= len;
  const reach = Math.min(a + b - 1e-6, Math.max(Math.abs(a - b) + 1e-6, Math.hypot(tx - rx, ty - ry, tz - rz)));
  // The pole's direction, square to the line root → end.
  let qx = px - rx;
  let qy = py - ry;
  let qz = pz - rz;
  const along = qx * dx + qy * dy + qz * dz;
  qx -= dx * along;
  qy -= dy * along;
  qz -= dz * along;
  let qn = Math.hypot(qx, qy, qz);
  if (qn < 1e-9) {
    // The pole is on the line: any square direction will do (d × z, or d × x when d is along z).
    if (Math.abs(dz) < 0.9) {
      qx = dy;
      qy = -dx;
      qz = 0;
    } else {
      qx = 0;
      qy = dz;
      qz = -dy;
    }
    qn = Math.hypot(qx, qy, qz) || 1;
  }
  qx /= qn;
  qy /= qn;
  qz /= qn;
  const cos = Math.max(-1, Math.min(1, (a * a + reach * reach - b * b) / (2 * a * reach)));
  const sin = Math.sqrt(1 - cos * cos);
  out[0] = rx + dx * a * cos + qx * a * sin;
  out[1] = ry + dy * a * cos + qy * a * sin;
  out[2] = rz + dz * a * cos + qz * a * sin;
  out[3] = rx + dx * reach;
  out[4] = ry + dy * reach;
  out[5] = rz + dz * reach;
  return reach;
}

/** Where a foot rests relative to the body: `forward` along the heading, `left` to its left (metres). */
export interface FootRest {
  forward: number;
  left: number;
  /** When in the cycle this foot lifts (0..1). */
  offset: number;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);
const frac = (x: number): number => x - Math.floor(x);

/**
 * Footwork in the world frame (x east, y north, heights from `ground`). Each foot
 * is planted (it doesn't slide) for the stance part of the cycle and swings to
 * its next landing for the rest; the landing is predicted from the body's
 * velocity so that the foot is under its hip at mid-stance. Standing still, a
 * foot that isn't under its hip takes a small step back there. Faster than a
 * stride can keep up with (a dash), the feet cycle under the body unplanted.
 */
export class FootPlanner {
  readonly n: number;
  /** Where each foot is now (world), and how high above the ground it's lifted. */
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly z: Float64Array;
  readonly lift: Float64Array;
  /** 1 while the foot is on the ground. */
  readonly planted: Uint8Array;
  /** The cycle's phase (0..1 repeating); for the body's bob and the arms' swing. */
  phase = 0;
  private readonly fromX: Float64Array;
  private readonly fromY: Float64Array;
  /** The height a swinging foot left from, and how far the ground on its way stood above the line to where it lands. */
  private readonly fromZ: Float64Array;
  private readonly over: Float64Array;
  private readonly toX: Float64Array;
  private readonly toY: Float64Array;
  private readonly settle: Float64Array;
  private readonly wasStance: Uint8Array;
  private started = false;

  constructor(
    private readonly rests: readonly FootRest[],
    /** Share of the cycle a foot is on the ground. */
    public duty = 0.62,
    /** How high a foot lifts at mid-swing, metres. */
    public liftHeight = 0.14,
    /** Above this speed (m/s) the feet stop planting: a dash. */
    public maxPlantSpeed = 9,
  ) {
    this.n = rests.length;
    const f = () => new Float64Array(this.n);
    this.x = f();
    this.y = f();
    this.z = f();
    this.lift = f();
    this.fromX = f();
    this.fromY = f();
    this.fromZ = f();
    this.over = f();
    this.toX = f();
    this.toY = f();
    this.settle = f();
    this.planted = new Uint8Array(this.n).fill(1);
    this.wasStance = new Uint8Array(this.n).fill(1);
  }

  /**
   * A swinging foot's height, `k` of the way (eased) and `s` of the time from where it left to where it lands: along
   * the line from the one height to the other, lifted at mid-swing by its lift and by however far the ground on the
   * way stands above that line (a step's edge), so it clears the edge rather than popping up it; never below the
   * ground it's over. On even ground, sloping or not: its lift over the ground.
   */
  private swingZ(i: number, k: number, s: number, ground: (x: number, y: number) => number, scale = 1): number {
    const from = this.fromZ[i]!;
    const to = ground(this.toX[i]!, this.toY[i]!);
    const line = from + (to - from) * k + Math.sin(s * Math.PI) * (this.liftHeight * scale + this.over[i]!);
    return Math.max(ground(this.x[i]!, this.y[i]!), line);
  }

  /** As a foot lifts: how far the ground on its way stands above the line from where it is to where it's going (a step's edge; 0 on even ground). */
  private measure(i: number, ground: (x: number, y: number) => number): void {
    const fx = this.fromX[i]!;
    const fy = this.fromY[i]!;
    const tx = this.toX[i]!;
    const ty = this.toY[i]!;
    const from = this.fromZ[i]!;
    const to = ground(tx, ty);
    let over = 0;
    for (let j = 1; j < 8; j++) {
      const u = j / 8;
      over = Math.max(over, ground(fx + (tx - fx) * u, fy + (ty - fy) * u) - (from + (to - from) * u));
    }
    this.over[i] = over;
  }

  /** Where foot i rests under a body at (bx, by) facing `heading`. */
  restX(i: number, bx: number, heading: number): number {
    const r = this.rests[i]!;
    return bx + Math.cos(heading) * r.forward - Math.sin(heading) * r.left;
  }

  restY(i: number, by: number, heading: number): number {
    const r = this.rests[i]!;
    return by + Math.sin(heading) * r.forward + Math.cos(heading) * r.left;
  }

  /** Every foot at rest under the body at once (first sight, a teleport). */
  place(bx: number, by: number, heading: number, ground: (x: number, y: number) => number): void {
    for (let i = 0; i < this.n; i++) {
      this.x[i] = this.toX[i] = this.fromX[i] = this.restX(i, bx, heading);
      this.y[i] = this.toY[i] = this.fromY[i] = this.restY(i, by, heading);
      this.z[i] = this.fromZ[i] = ground(this.x[i]!, this.y[i]!);
      this.lift[i] = 0;
      this.planted[i] = 1;
      this.wasStance[i] = 1;
      this.settle[i] = 0;
    }
    this.started = true;
  }

  /**
   * One step. The body is at (bx, by), facing `heading`, moving at (vx, vy) m/s;
   * `stride` is how far the body travels in one cycle. Returns true while any
   * foot is off the ground.
   */
  step(dt: number, bx: number, by: number, heading: number, vx: number, vy: number, stride: number, ground: (x: number, y: number) => number): boolean {
    if (!this.started) this.place(bx, by, heading, ground);
    const speed = Math.hypot(vx, vy);
    const moving = speed > 0.08;
    let anyLifted = false;
    // Far from where it should be (a teleport, the floating origin's jump): set down at rest.
    for (let i = 0; i < this.n; i++) {
      if (Math.hypot(this.x[i]! - this.restX(i, bx, heading), this.y[i]! - this.restY(i, by, heading)) > Math.max(3, stride * 2)) {
        this.place(bx, by, heading, ground);
        break;
      }
    }
    if (moving && speed > this.maxPlantSpeed) {
      // A dash: the feet cycle under the body, never planted.
      this.phase = frac(this.phase + (dt * speed) / Math.max(0.3, stride));
      for (let i = 0; i < this.n; i++) {
        const u = frac(this.phase + this.rests[i]!.offset);
        const reach = Math.cos(u * Math.PI * 2) * stride * 0.18;
        this.x[i] = this.restX(i, bx, heading) + Math.cos(heading) * reach;
        this.y[i] = this.restY(i, by, heading) + Math.sin(heading) * reach;
        this.lift[i] = Math.max(0, Math.sin(u * Math.PI * 2)) * this.liftHeight * 1.4;
        this.z[i] = ground(this.x[i]!, this.y[i]!) + this.lift[i]!;
        this.planted[i] = this.lift[i]! > 0.01 ? 0 : 1;
        this.toX[i] = this.fromX[i] = this.x[i]!;
        this.toY[i] = this.fromY[i] = this.y[i]!;
        this.wasStance[i] = this.planted[i]!;
        if (!this.planted[i]) anyLifted = true;
      }
      return anyLifted;
    }
    if (moving) {
      const cycle = Math.max(0.2, stride / speed);
      this.phase = frac(this.phase + dt / cycle);
      for (let i = 0; i < this.n; i++) {
        this.settle[i] = 0;
        const u = frac(this.phase + this.rests[i]!.offset);
        const stance = u < this.duty;
        if (stance) {
          if (!this.wasStance[i]) {
            // Touch down where it was going.
            this.x[i] = this.toX[i]!;
            this.y[i] = this.toY[i]!;
          }
          this.lift[i] = 0;
          this.planted[i] = 1;
          this.z[i] = ground(this.x[i]!, this.y[i]!);
        } else {
          if (this.wasStance[i]) {
            this.fromX[i] = this.x[i]!;
            this.fromY[i] = this.y[i]!;
            this.fromZ[i] = this.z[i]!;
          }
          const s = (u - this.duty) / (1 - this.duty);
          // Land a half-stance ahead of the hip, where the hip will be when it lands.
          const left = (1 - s) * (1 - this.duty) * cycle;
          const ahead = (stride * this.duty) / 2;
          const ux = vx / speed;
          const uy = vy / speed;
          this.toX[i] = this.restX(i, bx, heading) + vx * left + ux * ahead;
          this.toY[i] = this.restY(i, by, heading) + vy * left + uy * ahead;
          if (this.wasStance[i]) this.measure(i, ground);
          const k = smooth(s);
          this.x[i] = this.fromX[i]! + (this.toX[i]! - this.fromX[i]!) * k;
          this.y[i] = this.fromY[i]! + (this.toY[i]! - this.fromY[i]!) * k;
          this.lift[i] = Math.sin(s * Math.PI) * this.liftHeight;
          this.z[i] = this.swingZ(i, k, s, ground);
          this.planted[i] = 0;
          anyLifted = true;
        }
        this.wasStance[i] = stance ? 1 : 0;
      }
      return anyLifted;
    }
    // Standing: finish any swing, then step each foot that's out of place back under its hip, one at a time.
    let stepping = -1;
    for (let i = 0; i < this.n; i++) if (this.settle[i]! > 0 || !this.planted[i]) stepping = stepping < 0 ? i : stepping;
    if (stepping < 0) {
      let worst = 0.1;
      for (let i = 0; i < this.n; i++) {
        const d = Math.hypot(this.x[i]! - this.restX(i, bx, heading), this.y[i]! - this.restY(i, by, heading));
        if (d > worst) {
          worst = d;
          stepping = i;
        }
      }
      if (stepping >= 0) {
        this.fromX[stepping] = this.x[stepping]!;
        this.fromY[stepping] = this.y[stepping]!;
        this.fromZ[stepping] = this.z[stepping]!;
        this.settle[stepping] = 1e-6;
      }
    }
    for (let i = 0; i < this.n; i++) {
      this.wasStance[i] = 1;
      if (i !== stepping) {
        this.lift[i] = 0;
        this.planted[i] = 1;
        this.z[i] = ground(this.x[i]!, this.y[i]!);
        continue;
      }
      // A settling step: 0.3 s, from wherever it was to rest.
      const s = Math.min(1, this.settle[i]! + dt / 0.3);
      this.settle[i] = s >= 1 ? 0 : s;
      this.toX[i] = this.restX(i, bx, heading);
      this.toY[i] = this.restY(i, by, heading);
      if (s <= dt / 0.3 + 1e-9) this.measure(i, ground);
      const k = smooth(s);
      this.x[i] = this.fromX[i]! + (this.toX[i]! - this.fromX[i]!) * k;
      this.y[i] = this.fromY[i]! + (this.toY[i]! - this.fromY[i]!) * k;
      this.lift[i] = s >= 1 ? 0 : Math.sin(s * Math.PI) * this.liftHeight * 0.6;
      this.z[i] = s >= 1 ? ground(this.x[i]!, this.y[i]!) : this.swingZ(i, k, s, ground, 0.6);
      this.planted[i] = s >= 1 ? 1 : 0;
      if (!this.planted[i]) anyLifted = true;
    }
    return anyLifted;
  }
}
