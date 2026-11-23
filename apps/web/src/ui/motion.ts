/*
 * One clock for everything on the page that moves while a state lasts (ui/orb.ts' orbs and seats; your word, 24
 * November 2026: "pulsing/moving when doing a task, sitting idle, waiting, done"). It draws one animation frame at a
 * time for all of them, only what is on screen, and nothing while the page is hidden. When motion is reduced (the
 * device asks for it, or Settings → Motion says so), each is drawn once, still, and the clock stops until that
 * changes.
 */

import { prefersReducedMotion } from "./dom.ts";

/** Draws a moment: `t` in seconds (from any fixed moment), and whether it may move (false: draw it still). */
export type Draw = (t: number, moving: boolean) => void;

interface Mover {
  el: Element;
  draw: Draw;
  /** Milliseconds between two frames of it. */
  every: number;
  last: number;
  /** Whether it has been on the page; one that leaves it is forgotten. */
  seen: boolean;
  /** Frames waited for it to be put on the page. */
  waited: number;
  onScreen: boolean;
  still: boolean;
}

const movers = new Map<Element, Mover>();
let request = 0;
let watching = false;
let observer: IntersectionObserver | null = null;

/** Whether things may move: the app's own setting first (Settings → Motion), then the device's (ui/dom.ts). */
export function motionAllowed(): boolean {
  return typeof document !== "undefined" && typeof matchMedia === "function" && !prefersReducedMotion();
}

/** Draws `el` with `draw` at most `fps` times a second while it is on the page and on screen; forgets it once it has
 * left the page (drawn again, or its page left). Its first moment is drawn already, as it was made: still, where
 * motion is reduced. */
export function move(el: Element, draw: Draw, fps = 60): void {
  movers.set(el, { el, draw, every: 1000 / fps - 1.5, last: Number.NEGATIVE_INFINITY, seen: false, waited: 0, onScreen: true, still: !motionAllowed() });
  if (typeof IntersectionObserver === "function") {
    observer ??= new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const mover = movers.get(entry.target);
        if (mover) mover.onScreen = entry.isIntersecting;
      }
      wake();
    });
    observer.observe(el);
  }
  watch();
  wake();
}

function wake(): void {
  if (request || !movers.size || typeof requestAnimationFrame !== "function" || document.hidden) return;
  request = requestAnimationFrame(tick);
}

function tick(now: number): void {
  request = 0;
  const moving = motionAllowed();
  const t = now / 1000;
  let again = false;
  for (const mover of movers.values()) {
    if (!mover.el.isConnected) {
      // One that was on the page and has left it is forgotten; one not yet put on it is waited for, a few seconds.
      if (mover.seen || ++mover.waited > 240) {
        movers.delete(mover.el);
        observer?.unobserve(mover.el);
      } else again = true;
      continue;
    }
    mover.seen = true;
    if (!moving) {
      if (!mover.still) mover.draw(t, false);
      mover.still = true;
      continue;
    }
    mover.still = false;
    if (!mover.onScreen) continue;
    again = true;
    if (now - mover.last < mover.every) continue;
    mover.last = now;
    mover.draw(t, true);
  }
  // Still, or nothing on screen: the clock waits for motion to be allowed, for one to come on screen, or a new one.
  if (again) wake();
}

function watch(): void {
  if (watching || typeof document === "undefined") return;
  watching = true;
  document.addEventListener?.("visibilitychange", wake);
  if (typeof matchMedia === "function") matchMedia("(prefers-reduced-motion: reduce)").addEventListener?.("change", wake);
  if (typeof MutationObserver === "function") new MutationObserver(wake).observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion"] });
}
