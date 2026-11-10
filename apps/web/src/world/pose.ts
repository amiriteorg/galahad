import type { Pose } from "@galahad/core/world";

/*
 * Smooth motion from a 5–30 Hz stream: frames wait in a short playback buffer
 * (about 150 ms) and the renderer samples between the two around "now − delay",
 * lerping positions and slerping orientations. Pure, so unit-tested.
 * Quaternions are w, x, y, z, as in the contract.
 */

export type Quat = [number, number, number, number];

export function normalizeQuat(q: Quat): Quat {
  const n = Math.hypot(q[0], q[1], q[2], q[3]);
  return n > 1e-12 ? [q[0] / n, q[1] / n, q[2] / n, q[3] / n] : [1, 0, 0, 0];
}

/** Spherical interpolation along the shorter arc, always unit length. */
export function slerp(a: Quat, b: Quat, t: number): Quat {
  let [bw, bx, by, bz] = b;
  let dot = a[0] * bw + a[1] * bx + a[2] * by + a[3] * bz;
  if (dot < 0) {
    dot = -dot;
    bw = -bw;
    bx = -bx;
    by = -by;
    bz = -bz;
  }
  if (dot > 0.9995) {
    // Nearly the same orientation: a normalised lerp is exact enough and never divides by ~0.
    return normalizeQuat([a[0] + (bw - a[0]) * t, a[1] + (bx - a[1]) * t, a[2] + (by - a[2]) * t, a[3] + (bz - a[3]) * t]);
  }
  const theta = Math.acos(Math.min(1, dot));
  const sin = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sin;
  const wb = Math.sin(t * theta) / sin;
  return normalizeQuat([a[0] * wa + bw * wb, a[1] * wa + bx * wb, a[2] * wa + by * wb, a[3] * wa + bz * wb]);
}

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function interpolatePose(a: Pose, b: Pose, t: number): Pose {
  const q = slerp([a[3], a[4], a[5], a[6]], [b[3], b[4], b[5], b[6]], t);
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t), q[0], q[1], q[2], q[3]];
}

/** A quaternion (w, x, y, z) from a turn about an axis. */
export function axisAngle(axis: [number, number, number], angle: number): Quat {
  const [x, y, z] = axis;
  const n = Math.hypot(x, y, z) || 1;
  const s = Math.sin(angle / 2) / n;
  return [Math.cos(angle / 2), x * s, y * s, z * s];
}

/** a then b (Hamilton product a·b: b is applied first in the body frame). */
export function mulQuat(a: Quat, b: Quat): Quat {
  const [aw, ax, ay, az] = a;
  const [bw, bx, by, bz] = b;
  return [aw * bw - ax * bx - ay * by - az * bz, aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw];
}

/** Rotates a vector by a unit quaternion. */
export function rotate(q: Quat, v: [number, number, number]): [number, number, number] {
  const [w, x, y, z] = q;
  const [vx, vy, vz] = v;
  // t = 2 · (q.xyz × v); v' = v + w·t + q.xyz × t
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
}

export const PLAYBACK_DELAY_MS = 150;
/** How long frames are kept behind the playhead. */
const KEEP_MS = 1500;
/** Offsets from the last this-many frames decide how the node's clock maps to ours. */
const CLOCK_WINDOW = 30;
const MAX_FRAMES = 120;

interface Buffered {
  at: number;
  t: number;
  poses: Record<string, Pose>;
}

/**
 * Frames of one experiment, played back slightly behind real time. Frames are
 * placed on the node's clock (`at`); the least-delayed recent arrival maps it to
 * ours, so network jitter doesn't become jerky motion.
 */
export class PoseBuffer {
  private frames: Buffered[] = [];
  private offsets: number[] = [];

  constructor(private readonly delayMs = PLAYBACK_DELAY_MS) {}

  get size(): number {
    return this.frames.length;
  }

  /** The newest frame's simulation time, if any. */
  get latestT(): number | null {
    return this.frames.at(-1)?.t ?? null;
  }

  push(at: number, t: number, poses: Record<string, Pose>, receivedAt: number): void {
    this.offsets.push(receivedAt - at);
    if (this.offsets.length > CLOCK_WINDOW) this.offsets.shift();
    const last = this.frames.at(-1);
    if (last && at < last.at) {
      // A frame from before the newest (a restart, or the node's clock stepped back): start over.
      if (last.at - at > KEEP_MS) this.frames = [];
      else return;
    }
    if (last && at === last.at) {
      // Same instant: merge (a later message carries the newer poses).
      last.poses = { ...last.poses, ...poses };
      last.t = t;
      return;
    }
    this.frames.push({ at, t, poses });
    // Nobody sampling (the page is hidden): never grow without bound.
    if (this.frames.length > MAX_FRAMES) this.frames.splice(0, this.frames.length - MAX_FRAMES);
  }

  /**
   * Visits every body's pose at local time `now` (same clock as receivedAt):
   * interpolated between the frames around the playhead, or held at the first or
   * last. Returns false, visiting nothing, when nothing changed since the last call
   * (no frames, or still holding the same frame). Allocates nothing.
   */
  sample(now: number, visit: PoseVisitor): boolean {
    const frames = this.frames;
    if (!frames.length) return false;
    let offset = Infinity;
    for (let k = 0; k < this.offsets.length; k++) offset = Math.min(offset, this.offsets[k]!);
    const playhead = now - offset - this.delayMs;
    // Drop what the playhead has passed, keeping one frame before it.
    while (frames.length > 2 && frames[1]!.at <= playhead - KEEP_MS) frames.shift();
    const last = frames[frames.length - 1]!;
    const held = playhead <= frames[0]!.at ? frames[0]! : playhead >= last.at ? last : null;
    if (held) {
      if (held === this.lastHeld) return false;
      this.lastHeld = held;
      for (const id in held.poses) {
        const p = held.poses[id]!;
        visit(id, p[0], p[1], p[2], p[3], p[4], p[5], p[6]);
      }
      return true;
    }
    this.lastHeld = null;
    let i = frames.length - 2;
    while (i > 0 && frames[i]!.at > playhead) i--;
    const a = frames[i]!;
    const b = frames[i + 1]!;
    const u = (playhead - a.at) / (b.at - a.at);
    for (const id in a.poses) {
      const pa = a.poses[id]!;
      const pb = b.poses[id];
      if (!pb) visit(id, pa[0], pa[1], pa[2], pa[3], pa[4], pa[5], pa[6]);
      else {
        slerpInto(pa[3], pa[4], pa[5], pa[6], pb[3], pb[4], pb[5], pb[6], u, this.q);
        const q = this.q;
        visit(id, lerp(pa[0], pb[0], u), lerp(pa[1], pb[1], u), lerp(pa[2], pb[2], u), q[0]!, q[1]!, q[2]!, q[3]!);
      }
    }
    for (const id in b.poses) {
      if (a.poses[id]) continue;
      const pb = b.poses[id]!;
      visit(id, pb[0], pb[1], pb[2], pb[3], pb[4], pb[5], pb[6]);
    }
    return true;
  }

  private lastHeld: Buffered | null = null;
  private readonly q = new Float64Array(4);

  clear(): void {
    this.frames = [];
    this.offsets = [];
    this.lastHeld = null;
  }
}

export type PoseVisitor = (id: string, x: number, y: number, z: number, qw: number, qx: number, qy: number, qz: number) => void;

/** slerp without allocating: writes w, x, y, z into `out`. */
export function slerpInto(aw: number, ax: number, ay: number, az: number, bw: number, bx: number, by: number, bz: number, t: number, out: Float64Array): void {
  let dot = aw * bw + ax * bx + ay * by + az * bz;
  if (dot < 0) {
    dot = -dot;
    bw = -bw;
    bx = -bx;
    by = -by;
    bz = -bz;
  }
  let wa = 1 - t;
  let wb = t;
  if (dot <= 0.9995) {
    const theta = Math.acos(Math.min(1, dot));
    const sin = Math.sin(theta);
    wa = Math.sin((1 - t) * theta) / sin;
    wb = Math.sin(t * theta) / sin;
  }
  const w = aw * wa + bw * wb;
  const x = ax * wa + bx * wb;
  const y = ay * wa + by * wb;
  const z = az * wa + bz * wb;
  const n = Math.hypot(w, x, y, z) || 1;
  out[0] = w / n;
  out[1] = x / n;
  out[2] = y / n;
  out[3] = z / n;
}
