import type { PerspectiveCamera } from "three/webgpu";

import type { Solids } from "./collide.ts";
import { angleDiff } from "./path.ts";

/*
 * The camera: perspective, orbiting a focus point on the ground. By default it's
 * a close, low third-person view over Galahad's shoulder (he's large in the
 * frame, the meadow, the mountains and the sky behind him); zoomed out it rises
 * towards an overview. Drag (one finger) pans, the wheel or a pinch zooms, a
 * right-drag or a two-finger twist turns it. Everything eases towards its
 * target, except under reduced motion, where it jumps. Following Galahad keeps
 * the focus on him and, while he walks, swings slowly round behind him (unless
 * you've just turned it yourself); panning stops following. The ground under the
 * focus is smoothed, so the view doesn't bob over every facet of a hill.
 *
 * Between the focus and the camera is a spring arm (SpringArm): when the
 * ground rises behind, the arm lifts over it; the camera rides it as a body,
 * carried round as the view turns and sliding round whatever it meets, so it
 * never jumps, whatever turns it, and is never inside anything (a crown, a
 * post, a machine, a wall), nor below the land. What stands between it and him
 * isn't looked round: it dissolves in the dither (occlusion.ts).
 */

export const MIN_DISTANCE = 5;
export const MAX_DISTANCE = 130;
export const DEFAULT_DISTANCE = 10;
/** Where the views of a station and of a plot start. */
export const STATION_DISTANCE = 22;

/**
 * The pitch (radians below the horizon) at a distance: 7° right up close, 11° at
 * the default (the mountains and the sky show at the top), rising to an
 * isometric-ish 54° far out, for an overview.
 */
export function pitchFor(distance: number): number {
  if (distance <= DEFAULT_DISTANCE) return ((7 + (4 * (distance - MIN_DISTANCE)) / (DEFAULT_DISTANCE - MIN_DISTANCE)) * Math.PI) / 180;
  const t = Math.max(0, Math.min(1, (distance - DEFAULT_DISTANCE) / 95));
  return ((11 + 43 * t * t * (3 - 2 * t)) * Math.PI) / 180;
}

/** How far over his shoulder the following view sits: the camera looks along his heading, turned this much. */
const SHOULDER = 0.5;

export class CameraRig {
  /** Focus on the ground, world metres. */
  x = 0;
  y = -8;
  /** The way the camera looks (atan2 convention; π/2 looks north). */
  yaw = Math.PI / 2;
  distance = DEFAULT_DISTANCE;
  target = { x: 0, y: -8, yaw: Math.PI / 2, distance: DEFAULT_DISTANCE };
  follow = true;
  /** The ground under the focus, smoothed. */
  private ground = Number.NaN;
  /** Seconds since the viewer last turned the view (the auto-swing waits for them). */
  private sinceTurn = Infinity;

  /**
   * While following him as he walks, swing slowly round behind him (heading:
   * his, atan2 convention), to the nearest side where nothing blocks the view
   * (`clear` is false where something would). Not for a while after the view
   * was turned by hand: then it stays where it was turned (the arm keeps it out
   * of whatever's there, and what's between dissolves).
   */
  trail(heading: number, walking: boolean, dt: number, clear: (x: number, y: number) => boolean): void {
    this.sinceTurn += dt;
    if (!this.follow) return;
    const t = this.target;
    const back = t.distance * Math.cos(pitchFor(t.distance));
    const at = (yaw: number, b: number) => clear(t.x - Math.cos(yaw) * b, t.y - Math.sin(yaw) * b);
    if (this.sinceTurn >= 6) {
      // Behind him, looking where he looks (over his shoulder at his work). When that's in a building,
      // from the side, still looking his way; his front only when his back's to a wall all round:
      // from the front, his work would stand between the camera and him (and dissolve).
      let want = heading - SHOULDER;
      if (!walking && !at(want, back)) {
        let side: number | null = null;
        for (let k = 1; k <= 7 && side === null; k++) {
          for (const sign of [1, -1]) {
            const yaw = want + sign * k * (Math.PI / 15);
            if (at(yaw, back)) {
              side = yaw;
              break;
            }
          }
        }
        want = side ?? heading + Math.PI - SHOULDER;
      }
      t.yaw += angleDiff(t.yaw, want) * (1 - Math.exp(-dt * (walking ? 0.55 : 0.3)));
    }
    if (this.sinceTurn < 6 || at(t.yaw, back)) return;
    for (let k = 1; k <= 15; k++) {
      for (const sign of [1, -1]) {
        const yaw = t.yaw + sign * k * (Math.PI / 15);
        if (at(yaw, back)) {
          t.yaw = yaw;
          return;
        }
      }
    }
  }

  /** The ground under the focus, eased (a hill's facets would make the view bob). */
  settle(ground: number, dt: number, motion: boolean): number {
    if (Number.isNaN(this.ground) || !motion || Math.abs(ground - this.ground) > 6) this.ground = ground;
    else this.ground += (ground - this.ground) * (1 - Math.exp(-dt * 5));
    return this.ground;
  }

  /** Eases towards the target. Returns true while still moving. */
  update(dt: number, motion: boolean): boolean {
    const t = this.target;
    if (!motion) {
      const moved = this.x !== t.x || this.y !== t.y || this.yaw !== t.yaw || this.distance !== t.distance;
      this.x = t.x;
      this.y = t.y;
      this.yaw = t.yaw;
      this.distance = t.distance;
      return moved;
    }
    const k = 1 - Math.exp(-dt * 7);
    const dyaw = angleDiff(this.yaw, t.yaw);
    const far = Math.abs(t.x - this.x) + Math.abs(t.y - this.y) + Math.abs(dyaw) * 10 + Math.abs(t.distance - this.distance);
    if (far < 1e-3) {
      this.x = t.x;
      this.y = t.y;
      this.yaw = t.yaw;
      this.distance = t.distance;
      return false;
    }
    this.x += (t.x - this.x) * k;
    this.y += (t.y - this.y) * k;
    this.yaw += dyaw * k;
    this.distance += (t.distance - this.distance) * k;
    return true;
  }

  /** How high over the ground at the focus the camera looks: close in, at his chest rather than his feet. */
  lookHeight(): number {
    return Math.max(0, 1.5 - Math.max(0, this.distance - 10) * 0.025);
  }

  /**
   * Where the camera wants to be, `ground` metres up at the focus (world, z up): into `out`, with the spring
   * arm's pivot in `pivot`: over the focus at his head's height, above the benches, tables and decks he stands
   * by (the camera still looks at his chest; what's between them dissolves).
   */
  wanted(ground: number, out: Point3, pivot: Point3): void {
    const pitch = pitchFor(this.distance);
    const back = this.distance * Math.cos(pitch);
    const look = ground + this.lookHeight();
    pivot.x = this.x;
    pivot.y = this.y;
    pivot.z = ground + PIVOT_HEIGHT;
    out.x = this.x - Math.cos(this.yaw) * back;
    out.y = this.y - Math.sin(this.yaw) * back;
    out.z = look + this.distance * Math.sin(pitch);
  }

  /** Places the camera, relative to the floating origin, `ground` metres up at the focus: where `arm` puts it, if given. */
  apply(camera: PerspectiveCamera, origin: [number, number], ground: number, arm: SpringArm | null = null): void {
    this.wanted(ground, this.spot, this.pivot);
    const at = arm ?? this.spot;
    // On a tall (portrait) screen, look a little past the focus, so it sits lower and the land ahead shows.
    const ahead = camera.aspect < 1 ? this.distance * 0.3 * (1 - camera.aspect) : 0;
    // Scene axes: (x, z, −y).
    camera.position.set(at.x - origin[0], at.z, -(at.y - origin[1]));
    camera.lookAt(this.x + Math.cos(this.yaw) * ahead - origin[0], ground + this.lookHeight(), -(this.y + Math.sin(this.yaw) * ahead - origin[1]));
  }

  private readonly spot: Point3 = { x: 0, y: 0, z: 0 };
  private readonly pivot: Point3 = { x: 0, y: 0, z: 0 };

  /** Pans by a drag of (dx, dy) CSS pixels on a viewport `height` pixels tall. */
  panPixels(dx: number, dy: number, height: number, fov: number): void {
    const perPixel = (2 * this.target.distance * Math.tan((fov * Math.PI) / 360)) / Math.max(1, height);
    const rx = Math.sin(this.target.yaw);
    const ry = -Math.cos(this.target.yaw);
    const fx = Math.cos(this.target.yaw);
    const fy = Math.sin(this.target.yaw);
    const k = perPixel / Math.sin(pitchFor(this.target.distance));
    this.target.x += -rx * dx * perPixel + fx * dy * k;
    this.target.y += -ry * dx * perPixel + fy * dy * k;
  }

  /** Pans by metres along the view (right, forward). */
  panMetres(right: number, forward: number): void {
    this.target.x += Math.sin(this.target.yaw) * right + Math.cos(this.target.yaw) * forward;
    this.target.y += -Math.cos(this.target.yaw) * right + Math.sin(this.target.yaw) * forward;
  }

  zoomBy(factor: number): void {
    this.target.distance = Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, this.target.distance * factor));
  }

  rotateBy(radians: number): void {
    this.target.yaw += radians;
    this.sinceTurn = 0;
  }

  lookAt(x: number, y: number, distance?: number): void {
    this.target.x = x;
    this.target.y = y;
    if (distance !== undefined) this.target.distance = Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, distance));
  }
}

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** Nothing solid is ever nearer the camera than this (its near plane is a quarter metre out, its corners a little more). */
export const CAMERA_PAD = 0.35;
/** The room it keeps round it where it can: where on the arm it eases to is at least this far from anything. */
const ROOM = 0.7;
/** The spring arm turns about a point this high over the focus (his head's height). */
const PIVOT_HEIGHT = 2.3;
/** How far above the land the camera keeps, and the arm on its way out to it; and the least it ever is, moving. */
const GROUND_CLEAR = 0.8;
const GROUND_MIN = 0.6;
/** The arm is never shorter than this when it can help it (any shorter and it's in his head); this, when it can't. */
const MIN_ARM = 1.6;
const LEAST_ARM = 0.6;
/** The fastest the arm moves the camera on its own (m/s), beyond where turning, zooming or following takes it. */
export const ARM_SPEED = 12;
/** How quickly it eases where it's going (per second). */
const SEEK = 6;
/** Samples of the ground along the arm. */
const GROUND_SAMPLES = 12;
/** How far the arm tilts up (radians) to look over something right by him, tried in turn. */
const TILTS = [0.15, 0.3, 0.45, 0.7, 0.95, 1.2];
/** How many of TILTS are tried first: up to a view from above and to the side; the rest only when he's hemmed in. */
const GENTLE = 3;
/** The steepest the arm goes (radians above the horizon). */
const STEEPEST = 1.35;
/** It comes down from a tilt only once the lower one has this much more room than it needs (so it doesn't flicker). */
const SETTLE = 1.25;
/** The pivot moving farther than this in a frame is a cut (a jump to another place): the camera goes straight there. */
const CUT = 6;
/** Seconds against something it can't slide round before it tries other ways out. */
const WEDGED = 0.2;

/**
 * The spring arm from the focus to the camera, and the camera on it as a
 * body. The arm wants the camera at its end, lifted over the land between (a
 * hillside behind, a ridge between) and tilted up when something stands right
 * by him, at the nearest place there with room round it. The camera is carried
 * round with the arm as the view turns, zooms and follows him, so a turn moves
 * it exactly as far as the turn does; then it eases on its own to where the
 * arm wants it, never faster in all than the arm's end moves plus ARM_SPEED.
 * Every move slides among the solids it keeps out of (collide.ts' slide3:
 * round a post, along a wall, under a deck, over a roof), never into one nor
 * through it, so it never jumps, by any input, and it keeps over the land.
 * Whatever is merely in the way between it and him (leaves, a trunk, a wall)
 * isn't looked round: it dissolves in the dither (occlusion.ts). It never goes
 * under something he isn't under (collide.ts' cameraAt), so it never wedges
 * beneath eaves or a deck; where it's against something it can't slide round,
 * it tries up, down, in, and to either side. A cut, or reduced motion, puts it
 * straight where the arm wants it. Pure; world metres, z up. No allocation.
 */
export class SpringArm {
  /** Where the camera is (world, z up). */
  x = 0;
  y = 0;
  z = 0;
  /** How far the arm's end is lifted over where it wanted to be, and how far the arm is tilted up (radians). */
  lift = 0;
  tilt = 0;
  /** Times it had to be put on the arm at once while moving (something grew round it, more than it could get out of). */
  places = 0;
  /** The tilt it eases to. */
  private aimTilt = 0;
  private placed = false;
  /** Seconds it has been against something it can't slide round, and before it tries other ways out again. */
  private jam = 0;
  private rest = 0;
  // The arm last frame: its pivot, the end it wanted, and the lift.
  private lpx = 0;
  private lpy = 0;
  private lpz = 0;
  private ldx = 0;
  private ldy = 0;
  private ldz = 0;
  private llift = 0;
  // The arm as it's tried (scratch), and a slide's end.
  private ax = 0;
  private ay = 0;
  private az = 0;
  private readonly to = { x: 0, y: 0, z: 0 };

  /** The arm (dx, dy, dz) from the pivot, tilted up by `tilt`: into ax, ay, az. */
  private aim(dx: number, dy: number, dz: number, tilt: number): void {
    const h = Math.hypot(dx, dy);
    if (tilt <= 0 || h < 1e-6) {
      this.ax = dx;
      this.ay = dy;
      this.az = dz;
      return;
    }
    const len = Math.hypot(h, dz);
    const e = Math.min(STEEPEST, Math.atan2(dz, h) + tilt);
    const k = (len * Math.cos(e)) / h;
    this.ax = dx * k;
    this.ay = dy * k;
    this.az = len * Math.sin(e);
  }

  /**
   * Where on the arm as aimed (ax, ay, az) it wants the camera: the nearest place to its end, at least `least` out,
   * with room round it, or else just clear of everything; else closer in (from `low`); −1: nowhere.
   */
  private share(solids: Solids | null, px: number, py: number, pz: number, least: number, low: number): number {
    if (!solids) return 1;
    const bx = px + this.ax;
    const by = py + this.ay;
    const bz = pz + this.az;
    const roomy = solids.clearAlong(px, py, pz, bx, by, bz, ROOM, 1, least, 1);
    if (roomy >= 0) return roomy;
    const clear = solids.clearAlong(px, py, pz, bx, by, bz, CAMERA_PAD, 1, least, 1);
    return clear >= 0 ? clear : solids.clearAlong(px, py, pz, bx, by, bz, CAMERA_PAD, least, low, 1);
  }

  update(pivot: Point3, want: Point3, solids: Solids | null, ground: (x: number, y: number) => number, dt: number, motion: boolean): void {
    const px = pivot.x;
    const py = pivot.y;
    const pz = pivot.z;
    const dx = want.x - px;
    const dy = want.y - py;
    const dz0 = want.z - pz;
    const len = Math.max(1e-6, Math.hypot(dx, dy, dz0));
    const least = Math.min(1, MIN_ARM / len);
    const low = Math.min(1, LEAST_ARM / len);
    // Nothing he isn't under is gone under.
    solids?.cameraAt(px, py, this.placed ? this.x : Number.NaN, this.placed ? this.y : Number.NaN, CAMERA_PAD);
    // Over the ground: the least lift that keeps the whole arm above it (a hillside behind, a ridge between).
    let need = 0;
    for (let k = 1; k <= GROUND_SAMPLES; k++) {
      const s = k / GROUND_SAMPLES;
      const lift = (ground(px + dx * s, py + dy * s) + GROUND_CLEAR * s - pz) / s - dz0;
      if (lift > need) need = lift;
    }
    need = Math.min(need, len * 0.9 + 2);
    if (!motion || need >= this.lift) this.lift = need;
    else this.lift += (need - this.lift) * (1 - Math.exp(-dt * 2));
    const dz = dz0 + this.lift;
    // Too little room that way (something right by him): tilt the arm up until there's enough, or to the tilt with
    // the most (and only if that's clearly more); come down only with room to spare.
    const room = Math.min(len, Math.max(MIN_ARM + 1, len * 0.35));
    let goal = -1;
    let best = -1;
    let bestTilt = 0;
    for (let k = -1; k < TILTS.length; k++) {
      if (k >= GENTLE && best * len >= MIN_ARM) break;
      const t = k < 0 ? 0 : TILTS[k]!;
      this.aim(dx, dy, dz, t);
      const f = Math.max(0, this.share(solids, px, py, pz, least, low));
      if (f * len >= Math.min(len, room * (t < this.aimTilt - 1e-6 ? SETTLE : 1)) - 1e-6) {
        goal = t;
        break;
      }
      if (f > best * 1.3 + 1e-3) {
        best = f;
        bestTilt = t;
      }
    }
    this.aimTilt = goal >= 0 ? goal : bestTilt;
    const cut = !this.placed || Math.hypot(px - this.lpx, py - this.lpy, pz - this.lpz) > CUT;
    if (!motion || cut) {
      this.tilt = this.aimTilt;
      this.place(px, py, pz, dx, dy, dz, least, low, solids);
    } else {
      // Eased, and no faster round the pivot than the camera moves on its own.
      const turn = (this.aimTilt - this.tilt) * (1 - Math.exp(-dt * (this.aimTilt > this.tilt ? 6 : 2)));
      const most = (ARM_SPEED * dt) / len;
      this.tilt += Math.max(-most, Math.min(most, turn));
      this.follow(px, py, pz, dx, dy, dz0, dz, least, low, solids, ground, dt);
    }
    this.lpx = px;
    this.lpy = py;
    this.lpz = pz;
    this.ldx = dx;
    this.ldy = dy;
    this.ldz = dz0;
    this.llift = this.lift;
    this.placed = true;
    solids?.cameraAt(Number.NaN, Number.NaN);
  }

  /** Carried with the arm, then eased to where the arm wants it, sliding round whatever's in the way. */
  private follow(px: number, py: number, pz: number, dx: number, dy: number, dz0: number, dz: number, least: number, low: number, solids: Solids | null, ground: (x: number, y: number) => number, dt: number): void {
    // In all, it moves no more in a frame than the arm's end does (turned, zoomed, following him), and ARM_SPEED.
    const x0 = this.x;
    const y0 = this.y;
    const z0 = this.z;
    const budget = Math.hypot(px + dx - this.lpx - this.ldx, py + dy - this.lpy - this.ldy, pz + dz - this.lpz - this.ldz - this.llift) + ARM_SPEED * dt;
    // Carried: as far along the arm as it was, and as far off it (turned with it).
    const l2 = this.ldx * this.ldx + this.ldy * this.ldy + this.ldz * this.ldz;
    const ox = this.x - this.lpx;
    const oy = this.y - this.lpy;
    const oz = this.z - this.lpz;
    const s = l2 > 1e-12 ? (ox * this.ldx + oy * this.ldy + oz * this.ldz) / l2 : 1;
    const qx = ox - s * this.ldx;
    const qy = oy - s * this.ldy;
    const qz = oz - s * this.ldz;
    const turn = Math.atan2(dy, dx) - Math.atan2(this.ldy, this.ldx);
    const c = Math.cos(turn);
    const n = Math.sin(turn);
    let cx = px + s * dx + qx * c - qy * n - this.x;
    let cy = py + s * dy + qx * n + qy * c - this.y;
    let cz = pz + s * dz0 + qz - this.z;
    const carried = Math.hypot(cx, cy, cz);
    if (carried > budget) {
      cx *= budget / carried;
      cy *= budget / carried;
      cz *= budget / carried;
    }
    this.go(cx, cy, cz, solids, ground);
    // Then to where the arm wants it, eased, with what's left of the budget (all of it when the carry was blocked:
    // it keeps up with the turn, gliding round what stopped it).
    this.aim(dx, dy, dz, this.tilt);
    const goal = Math.max(least, this.share(solids, px, py, pz, least, low));
    const gx = px + this.ax * goal;
    const gy = py + this.ay * goal;
    const gz = pz + this.az * goal;
    const ex = gx - this.x;
    const ey = gy - this.y;
    const ez = gz - this.z;
    const e = Math.hypot(ex, ey, ez);
    const left = budget - Math.hypot(this.x - x0, this.y - y0, this.z - z0);
    if (e > 1e-9 && left > 1e-6) {
      const want = Math.min(e * (1 - Math.exp(-dt * SEEK)), left);
      const got = this.go((ex * want) / e, (ey * want) / e, (ez * want) / e, solids, ground);
      // Barely moved, though it had far to go: against something it can't slide round.
      this.jam = got < want * 0.3 && e > 0.5 ? Math.min(1, this.jam + dt) : Math.max(0, this.jam - dt * 2);
      // (Not every frame: when no way out helped, it waits a little before trying again.)
      this.rest = Math.max(0, this.rest - dt);
      if (this.jam > WEDGED && this.rest === 0 && !this.unwedge(gx, gy, gz, px, py, pz, Math.min(left - got, 0.5), solids, ground)) this.rest = 0.25;
    }
    // Over the land, wherever it is.
    const floor = ground(this.x, this.y) + GROUND_CLEAR;
    if (this.z < floor) this.go(0, 0, floor - this.z, solids, ground);
    // Something closed round it (he came out from under what it's beside, or a chunk's trees grew): out the
    // shortest way, never far; failing that, where the arm wants it, at once.
    if (solids?.blocked3(this.x, this.y, this.z, CAMERA_PAD * 0.9)) {
      const to = this.to;
      if (solids.pushOut3(this.x, this.y, this.z, CAMERA_PAD, to) && to.z >= ground(to.x, to.y) + GROUND_MIN && Math.hypot(to.x - this.x, to.y - this.y, to.z - this.z) <= CAMERA_PAD * 1.5) {
        this.x = to.x;
        this.y = to.y;
        this.z = to.z;
      } else {
        this.places++;
        this.place(px, py, pz, dx, dy, dz, least, low, solids);
      }
    }
  }

  /** Moves by (mx, my, mz), sliding along whatever it meets, but never under the land (then it stays); how far it went. */
  private go(mx: number, my: number, mz: number, solids: Solids | null, ground: (x: number, y: number) => number): number {
    const x0 = this.x;
    const y0 = this.y;
    const z0 = this.z;
    if (solids) {
      solids.slide3(x0, y0, z0, mx, my, mz, CAMERA_PAD, this.to);
      this.x = this.to.x;
      this.y = this.to.y;
      this.z = this.to.z;
    } else {
      this.x += mx;
      this.y += my;
      this.z += mz;
    }
    if (this.z < ground(this.x, this.y) + GROUND_MIN) {
      this.x = x0;
      this.y = y0;
      this.z = z0;
      return 0;
    }
    return Math.hypot(this.x - x0, this.y - y0, this.z - z0);
  }

  /** A short move `by` metres each way (up, down, straight for (gx, gy, gz), in towards the pivot, and either side): keeps the one that ends nearest (gx, gy, gz); false when none is nearer. */
  private unwedge(gx: number, gy: number, gz: number, px: number, py: number, pz: number, by: number, solids: Solids | null, ground: (x: number, y: number) => number): boolean {
    const x0 = this.x;
    const y0 = this.y;
    const z0 = this.z;
    const sx = gx - x0;
    const sy = gy - y0;
    const sl = Math.hypot(sx, sy) || 1;
    let bestX = x0;
    let bestY = y0;
    let bestZ = z0;
    let best = Math.hypot(gx - x0, gy - y0, gz - z0);
    for (let k = 0; k < 6; k++) {
      let mx = 0;
      let my = 0;
      let mz = 0;
      if (k === 0 || k === 1) mz = k === 0 ? 1 : -1;
      else if (k === 2 || k === 3) {
        const tx = (k === 2 ? gx : px) - x0;
        const ty = (k === 2 ? gy : py) - y0;
        const tz = (k === 2 ? gz : pz) - z0;
        const m = Math.hypot(tx, ty, tz) || 1;
        mx = tx / m;
        my = ty / m;
        mz = tz / m;
      } else {
        mx = ((k === 4 ? -1 : 1) * sy) / sl;
        my = ((k === 4 ? 1 : -1) * sx) / sl;
      }
      this.go(mx * by, my * by, mz * by, solids, ground);
      const d = Math.hypot(gx - this.x, gy - this.y, gz - this.z);
      if (d < best - 1e-3) {
        best = d;
        bestX = this.x;
        bestY = this.y;
        bestZ = this.z;
      }
      this.x = x0;
      this.y = y0;
      this.z = z0;
    }
    this.x = bestX;
    this.y = bestY;
    this.z = bestZ;
    return bestX !== x0 || bestY !== y0 || bestZ !== z0;
  }

  /** Straight where the arm wants it, at once (tilted further, if it must be, to find a place). */
  private place(px: number, py: number, pz: number, dx: number, dy: number, dz: number, least: number, low: number, solids: Solids | null): void {
    let at = -1;
    for (let k = -1; k < TILTS.length && at < 0; k++) {
      const t = k < 0 ? this.tilt : TILTS[k]!;
      if (k >= 0 && t <= this.tilt) continue;
      this.aim(dx, dy, dz, t);
      at = this.share(solids, px, py, pz, least, low);
      if (at >= 0) this.tilt = this.aimTilt = t;
    }
    if (at < 0) {
      this.aim(dx, dy, dz, this.tilt);
      at = least;
    }
    this.x = px + this.ax * at;
    this.y = py + this.ay * at;
    this.z = pz + this.az * at;
    this.jam = 0;
  }
}

export interface InputHandlers {
  pan(dx: number, dy: number): void;
  zoom(factor: number): void;
  rotate(radians: number): void;
  tap(clientX: number, clientY: number): void;
  /** The mouse moved over the canvas with no button down. */
  hover?(clientX: number, clientY: number): void;
  /** Any direct manipulation began (stops following when it pans). */
  interacted(): void;
}

/** Pointer, wheel and touch gestures on the canvas. Returns a function that removes them. */
export function attachInput(el: HTMLElement, on: InputHandlers): () => void {
  const pointers = new Map<number, { x: number; y: number; button: number }>();
  let dragged = false;
  let start: { x: number; y: number } | null = null;
  let pinch: { d: number; a: number; cx: number; cy: number } | null = null;

  const gesture = () => {
    const [a, b] = [...pointers.values()];
    if (!a || !b) return null;
    return { d: Math.hypot(b.x - a.x, b.y - a.y), a: Math.atan2(b.y - a.y, b.x - a.x), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  };

  const down = (e: PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0 && e.button !== 2) return;
    el.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button });
    if (pointers.size === 1) {
      dragged = false;
      start = { x: e.clientX, y: e.clientY };
    } else {
      dragged = true;
      pinch = gesture();
    }
  };
  const move = (e: PointerEvent) => {
    const p = pointers.get(e.pointerId);
    if (!p) {
      if (e.pointerType === "mouse" && pointers.size === 0) on.hover?.(e.clientX, e.clientY);
      return;
    }
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (pointers.size >= 2) {
      const g = gesture();
      if (g && pinch) {
        if (pinch.d > 0 && g.d > 0) on.zoom(pinch.d / g.d);
        on.rotate(angleDiff(pinch.a, g.a));
        on.pan(g.cx - pinch.cx, g.cy - pinch.cy);
        on.interacted();
      }
      pinch = g;
      return;
    }
    if (!dragged && start && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 5) return;
    if (!dragged) on.interacted();
    dragged = true;
    if (p.button === 2 || e.shiftKey) on.rotate(-dx * 0.008);
    else on.pan(dx, dy);
  };
  const up = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) {
      if (!dragged && e.type === "pointerup") on.tap(e.clientX, e.clientY);
      start = null;
    }
  };
  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    on.zoom(Math.exp(delta * 0.0015));
  };
  const menu = (e: Event) => e.preventDefault();

  el.addEventListener("pointerdown", down);
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
  el.addEventListener("wheel", wheel, { passive: false });
  el.addEventListener("contextmenu", menu);
  return () => {
    el.removeEventListener("pointerdown", down);
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", up);
    el.removeEventListener("wheel", wheel);
    el.removeEventListener("contextmenu", menu);
  };
}
