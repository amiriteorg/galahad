import type { PerspectiveCamera } from "three/webgpu";

import { angleDiff } from "./path.ts";

/*
 * The camera: perspective, orbiting a focus point on the ground, looking down at
 * about 45° at the usual distance; zoomed right in it lowers towards the horizon
 * (the mountains and the sky come into view), zoomed out it looks more straight
 * down. Drag (one finger) pans, the wheel or a pinch zooms, a right-drag or a
 * two-finger twist turns it. Everything eases towards its target, except under
 * reduced motion, where it jumps. Following Galahad keeps the focus on him;
 * panning stops following.
 */

export const MIN_DISTANCE = 8;
export const MAX_DISTANCE = 130;
export const DEFAULT_DISTANCE = 30;

/**
 * The pitch (radians below the horizon) at a distance: 8° right up close, 16° at
 * the default (the mountains and the sky show at the top), rising to an
 * isometric-ish 54° far out, for an overview.
 */
export function pitchFor(distance: number): number {
  if (distance <= DEFAULT_DISTANCE) return ((8 + (8 * (distance - 8)) / (DEFAULT_DISTANCE - 8)) * Math.PI) / 180;
  const t = Math.max(0, Math.min(1, (distance - DEFAULT_DISTANCE) / 80));
  return ((16 + 38 * t * t * (3 - 2 * t)) * Math.PI) / 180;
}

export class CameraRig {
  /** Focus on the ground, world metres. */
  x = 0;
  y = -8;
  /** The way the camera looks (atan2 convention; π/2 looks north). */
  yaw = Math.PI / 2;
  distance = DEFAULT_DISTANCE;
  target = { x: 0, y: -8, yaw: Math.PI / 2, distance: DEFAULT_DISTANCE };
  follow = true;

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

  /** Places the camera, relative to the floating origin, `ground` metres up at the focus. */
  apply(camera: PerspectiveCamera, origin: [number, number], ground: number): void {
    const pitch = pitchFor(this.distance);
    const back = this.distance * Math.cos(pitch);
    const cx = this.x - Math.cos(this.yaw) * back - origin[0];
    const cy = this.y - Math.sin(this.yaw) * back - origin[1];
    // Close in, look at his chest rather than his feet.
    const lift = Math.max(0, 1.6 - this.distance * 0.03);
    // On a tall (portrait) screen, look a little past the focus, so it sits lower and the land ahead shows.
    const ahead = camera.aspect < 1 ? this.distance * 0.3 * (1 - camera.aspect) : 0;
    // Scene axes: (x, z, −y).
    camera.position.set(cx, ground + lift + this.distance * Math.sin(pitch), -cy);
    camera.lookAt(this.x + Math.cos(this.yaw) * ahead - origin[0], ground + lift, -(this.y + Math.sin(this.yaw) * ahead - origin[1]));
  }

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
  }

  lookAt(x: number, y: number, distance?: number): void {
    this.target.x = x;
    this.target.y = y;
    if (distance !== undefined) this.target.distance = Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, distance));
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
