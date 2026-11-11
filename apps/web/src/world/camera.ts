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
 * ground rises behind, the camera lifts over it; when something solid stands
 * in the way (a wall, the keep's deck, a hill) the arm shortens, so the camera
 * stays in clear air. It shortens quickly and lengthens slowly, eased both
 * ways, and wherever it is, the camera is never inside anything (a crown, a
 * post, a machine), nor below the land. Thin things and leaves between it and
 * him aren't looked round: they dissolve in the dither (occlusion.ts).
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
   * his, atan2 convention); and whenever the camera would stand inside a
   * building (`clear` is false where it can't be), turn it to the nearest
   * clear side instead, or come closer.
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
    if (at(t.yaw, back)) return;
    for (let k = 1; k <= 15; k++) {
      for (const sign of [1, -1]) {
        const yaw = t.yaw + sign * k * (Math.PI / 15);
        if (at(yaw, back)) {
          t.yaw = yaw;
          return;
        }
      }
    }
    // Hemmed in all round: come in closer.
    t.distance = Math.max(MIN_DISTANCE, t.distance * 0.92);
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
/** The room it eases to keep round it, where it can. */
const ROOM = 0.7;
/** The line of sight from the focus is this thick: what it meets, the arm shortens before. */
const SIGHT_PAD = 0.3;
/** The spring arm turns about a point this high over the focus (his head's height). */
const PIVOT_HEIGHT = 2.3;
/** How far above the land the camera keeps, and the arm on its way out to it. */
const GROUND_CLEAR = 0.8;
/** The arm is never shorter than this when it can help it (any shorter and it's in his head); this, when it can't. */
const MIN_ARM = 1.6;
const LEAST_ARM = 0.6;
/** The fastest the camera moves along its arm (m/s). */
const ARM_SPEED = 12;
/** Samples of the ground along the arm. */
const GROUND_SAMPLES = 12;
/** How far the arm tilts up (radians) to look over something right by him, tried in turn. */
const TILTS = [0.15, 0.3, 0.45, 0.7, 0.95, 1.2];
/** How many of TILTS are tried first: up to a view from above and to the side; the rest only when nothing else is clear air. */
const GENTLE = 3;
/** The steepest the arm goes (radians above the horizon). */
const STEEPEST = 1.35;

/**
 * The spring arm from the focus to the camera. Each frame it's told where the
 * camera wants to be; it lifts the camera over the ground along the arm, then
 * shortens the arm before whatever solid blocks the view (collide.ts' view
 * query: walls, decks, hills; not leaves or posts, which dissolve), and keeps
 * some room from anything it would pass. Where even that leaves too little
 * room (something right by him), it tilts the arm up to look over it. It eases,
 * in fast and out slowly, so a corner sweeping past doesn't pop the view; and
 * it never leaves the camera inside anything (within its near plane's reach)
 * or under the land, eased or not. Pure; world metres, z up. No allocation.
 */
export class SpringArm {
  /** Where the camera is (world, z up). */
  x = 0;
  y = 0;
  z = 0;
  /** How much of the arm is in use (1: all of it), how far the camera is lifted over where it wanted to be, and how far the arm is tilted up. */
  share = 1;
  lift = 0;
  tilt = 0;
  // The arm as it's tried (scratch).
  private ax = 0;
  private ay = 0;
  private az = 0;

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

  /** How much of the arm (ax, ay, az) from (px, py, pz) is clear: above the ground, and before whatever blocks the view. */
  private reach(px: number, py: number, pz: number, solids: Solids | null, ground: (x: number, y: number) => number): number {
    const { ax, ay, az } = this;
    let clear = 1;
    for (let k = 1; k <= GROUND_SAMPLES; k++) {
      const s = k / GROUND_SAMPLES;
      if (pz + az * s < ground(px + ax * s, py + ay * s) + GROUND_CLEAR * s - 1e-6) {
        clear = (k - 1) / GROUND_SAMPLES;
        break;
      }
    }
    if (solids && clear > 0) clear = Math.min(clear, solids.view(px, py, pz, px + ax, py + ay, pz + az, SIGHT_PAD, ROOM, false, true));
    return clear;
  }

  /** Where on the arm (ax, ay, az) the camera can be, nearest `want` within lo..hi; −1: nowhere. */
  private free(solids: Solids, px: number, py: number, pz: number, want: number, lo: number, hi: number): number {
    return solids.clearAlong(px, py, pz, px + this.ax, py + this.ay, pz + this.az, CAMERA_PAD, want, lo, hi);
  }

  update(pivot: Point3, want: Point3, solids: Solids | null, ground: (x: number, y: number) => number, dt: number, motion: boolean): void {
    const px = pivot.x;
    const py = pivot.y;
    const pz = pivot.z;
    const dx = want.x - px;
    const dy = want.y - py;
    let dz = want.z - pz;
    const len = Math.max(1e-6, Math.hypot(dx, dy, dz));
    // Over the ground: the least lift that keeps the whole arm above it (a hillside behind, a ridge between).
    let need = 0;
    for (let k = 1; k <= GROUND_SAMPLES; k++) {
      const s = k / GROUND_SAMPLES;
      const lift = (ground(px + dx * s, py + dy * s) + GROUND_CLEAR * s - pz) / s - dz;
      if (lift > need) need = lift;
    }
    need = Math.min(need, len * 0.9 + 2);
    if (!motion || need >= this.lift) this.lift = need;
    else this.lift += (need - this.lift) * (1 - Math.exp(-dt * 2));
    dz += this.lift;
    // Too little room that way (something right by him, or no place on the arm outside everything): tilt the arm
    // up until there's enough, or as much as there is.
    const room = Math.min(len, Math.max(MIN_ARM + 1, len * 0.35));
    const least0 = Math.min(1, MIN_ARM / len);
    let tilt = 0;
    let most = -1;
    let over = -1;
    for (let k = -1; k < TILTS.length; k++) {
      // Steeper than a gentle tilt only when no gentle one has clear air, before what blocks the view or beyond it.
      if (k >= GENTLE && (most >= 0 || over >= 0)) break;
      const t = k < 0 ? 0 : TILTS[k]!;
      this.aim(dx, dy, dz, t);
      const c = Math.max(least0, this.reach(px, py, pz, solids, ground));
      const usable = solids ? this.free(solids, px, py, pz, c, least0, c) : c;
      if (usable > most + 1e-3) {
        most = usable;
        tilt = t;
      }
      if (usable * len >= room) break;
      // Failing any place before what blocks the view, the least tilt with one beyond it.
      if (most < 0 && over < 0 && solids && this.free(solids, px, py, pz, c, c, 1) >= 0) over = t;
    }
    if (most < 0 && over >= 0) tilt = over;
    const before = this.tilt;
    if (!motion) this.tilt = tilt;
    else {
      // Eased, and no faster round the pivot than the camera moves along its arm.
      const turn = (tilt - this.tilt) * (1 - Math.exp(-dt * (tilt > this.tilt ? 6 : 2)));
      const most = (ARM_SPEED * dt) / len;
      this.tilt += Math.max(-most, Math.min(most, turn));
    }
    // The arm as tilted now, how much of it is clear, and where on it the camera eases to.
    this.aim(dx, dy, dz, this.tilt);
    const least = Math.min(1, MIN_ARM / len);
    let clear = Math.max(least, this.reach(px, py, pz, solids, ground));
    let next = clear;
    if (motion) {
      // Eased (in quicker than out), and never faster than a camera should move along its arm.
      const step = (clear - this.share) * (1 - Math.exp(-dt * (clear < this.share ? 8 : 2.2)));
      const most = (ARM_SPEED * dt) / len;
      next = this.share + Math.max(-most, Math.min(most, step));
    }
    // Never inside anything: there if it's free; else where it was, if that still is (it waits behind a post
    // sweeping past rather than jump it); else the nearest free place on the arm; else tilted as far as it needs, at once.
    if (solids) {
      let at = this.free(solids, px, py, pz, next, next, next);
      if (at < 0 && motion) at = this.free(solids, px, py, pz, this.share, this.share, this.share);
      if (at < 0 && motion && this.tilt !== before) {
        // Or where it was before the arm tilted this frame.
        this.aim(dx, dy, dz, before);
        at = this.free(solids, px, py, pz, this.share, this.share, this.share);
        if (at >= 0) this.tilt = before;
        else this.aim(dx, dy, dz, this.tilt);
      }
      if (at < 0) at = this.free(solids, px, py, pz, next, least, Math.max(clear, Math.min(1, this.share + (ROOM * 3) / len)));
      if (at < 0 && this.tilt !== tilt) {
        this.tilt = tilt;
        this.aim(dx, dy, dz, tilt);
        clear = Math.max(least, this.reach(px, py, pz, solids, ground));
        at = this.free(solids, px, py, pz, clear, least, clear);
      }
      // Nowhere before what blocks the view (he's in among things): beyond it, where it dissolves between.
      if (at < 0) at = this.free(solids, px, py, pz, clear, clear, 1);
      if (at < 0 && this.tilt !== tilt) {
        this.tilt = tilt;
        this.aim(dx, dy, dz, tilt);
        clear = Math.max(least, this.reach(px, py, pz, solids, ground));
        at = this.free(solids, px, py, pz, clear, clear, 1);
      }
      if (at < 0) at = this.free(solids, px, py, pz, clear, Math.min(1, LEAST_ARM / len), clear);
      next = at < 0 ? least : at;
    }
    this.share = next;
    const { ax, ay, az } = this;
    this.x = px + ax * this.share;
    this.y = py + ay * this.share;
    this.z = pz + az * this.share;
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
