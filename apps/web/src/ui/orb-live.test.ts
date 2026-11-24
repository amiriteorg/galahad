import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { seat } from "./avatar.ts";
import { orb } from "./orb.ts";

/*
 * The orb and the seats as they move (your word, 24 November 2026: "pulsing/moving when doing a task, sitting idle,
 * waiting, done"), drawn on a canvas that records what is drawn on it, without a browser.
 */

/** A 2D context that keeps the name of every call made on it. */
function context(calls: string[]): CanvasRenderingContext2D {
  const gradient = { addColorStop() {} };
  return new Proxy({} as Record<string, unknown>, {
    get(target, key) {
      if (typeof key !== "string") return undefined;
      if (key in target) return target[key];
      return (...args: unknown[]) => {
        calls.push(key);
        return key.startsWith("create") ? gradient : args.length ? undefined : undefined;
      };
    },
    set(target, key, value) {
      target[key as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

class Node_ {
  readonly attrs: Record<string, string> = {};
  readonly children: Node_[] = [];
  readonly style: Record<string, string> = {};
  readonly calls: string[] = [];
  className = "";
  width = 0;
  height = 0;
  isConnected = true;
  constructor(readonly tag: string) {
    made.push(this);
  }
  setAttribute(key: string, value: string) { this.attrs[key] = value; }
  appendChild(child: Node_) { this.children.push(child); return child; }
  addEventListener() {}
  getContext(kind: string) { return this.tag === "canvas" && kind === "2d" ? context(this.calls) : null; }
}

let frames: FrameRequestCallback[] = [];
/** Frames asked for since the test began. */
let asked = 0;
let timers: { at: number; callback: () => void; id: number }[] = [];
let clock = 0;
let ids = 0;
let made: Node_[] = [];
/** Runs, at `ms`, the timers due by then and then the frames asked for. */
const run = (ms: number) => {
  clock = ms;
  for (const timer of timers.filter((timer) => timer.at <= ms)) {
    timers = timers.filter((other) => other !== timer);
    timer.callback();
  }
  for (const frame of frames.splice(0)) frame(ms);
};
const root = { dataset: {} as Record<string, string> };
const saved = new Map<string, PropertyDescriptor | undefined>();
function stub(name: string, value: unknown) {
  saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}
beforeEach(() => {
  made = [];
  asked = 0;
  root.dataset = {};
  stub("document", {
    createElement: (tag: string) => new Node_(tag),
    createElementNS: (_: string, tag: string) => new Node_(tag),
    createTextNode: () => new Node_("#text"),
    documentElement: root,
    hidden: false,
    getElementById: () => ({}),
    addEventListener() {},
  });
  stub("window", { devicePixelRatio: 2 });
  stub("matchMedia", () => ({ matches: false, addEventListener() {} }));
  stub("requestAnimationFrame", (callback: FrameRequestCallback) => (asked++, frames.push(callback)));
  // (The clock waits by a timer for a frame that isn't due yet. As a browser does, a delay that isn't a finite number
  // of ms is none.)
  stub("setTimeout", (callback: () => void, ms?: number) => {
    timers.push({ at: clock + (Number.isFinite(ms) ? Math.max(0, ms!) : 0), callback, id: ++ids });
    return ids;
  });
  stub("clearTimeout", (id: number) => (timers = timers.filter((timer) => timer.id !== id)));
});
afterEach(() => {
  // Everything drawn leaves the page, and the page's clock, with nothing left on it, stops.
  for (const node of made) node.isConnected = false;
  for (let i = 0; i < 300 && (frames.length || timers.length); i++) run(60_000 + 20 * i);
  expect([frames, timers]).toEqual([[], []]);
  for (const [name, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
  saved.clear();
});

const canvasOf = (node: Node_) => node.children.find((child) => child.tag === "canvas");
const count = (calls: string[], name: string) => calls.filter((call) => call === name).length;

describe("his orb, moving", () => {
  test("doing something, it is drawn on a canvas reaching past it, sharp on the screen, named as the still one is", () => {
    const drawn = orb({ size: 168, mood: "working", label: "Galahad: at work", key: "test:sharp" }) as unknown as Node_;
    expect(drawn.attrs.class).toBe("orb orb-live");
    expect([drawn.attrs["data-mood"], drawn.attrs.role, drawn.attrs["aria-label"]]).toEqual(["working", "img", "Galahad: at work"]);
    const canvas = canvasOf(drawn)!;
    // His welcome's orb draws out to half again its size, for its motes and waves; at twice the pixels, on this screen.
    expect([canvas.className, canvas.style.width, canvas.width, canvas.attrs["aria-hidden"]]).toEqual(["orb-canvas", "252px", 504, "true"]);
    // Drawn at once, so it never shows empty: the sphere's gradients, its rings, its light and its motes.
    expect(count(canvas.calls, "createRadialGradient")).toBeGreaterThan(2);
    expect(count(canvas.calls, "drawImage")).toBeGreaterThan(10);
    // Then a frame at a time.
    expect(frames.length).toBeGreaterThan(0);
  });

  test("one made before it is put on the page is looked for ten times a second, not at every frame, and forgotten after five", () => {
    const canvas = canvasOf(orb({ size: 36, mood: "working", key: "test:unplaced" }) as unknown as Node_)!;
    canvas.isConnected = false;
    // (Each frame the page draws runs its other animations too: the knights' eyes, on every seat.)
    const before = asked;
    for (let ms = 1000; ms < 2000; ms += 1000 / 60) run(ms);
    expect(asked - before).toBeWithin(8, 13);
    // Put on the page, it moves at its own pace.
    canvas.isConnected = true;
    const drawn = canvas.calls.length;
    for (let ms = 2000; ms < 3000; ms += 1000 / 60) run(ms);
    expect(canvas.calls.length).toBeGreaterThan(drawn);
    // One never put on the page is forgotten.
    const other = canvasOf(orb({ size: 36, mood: "working", key: "test:never" }) as unknown as Node_)!;
    other.isConnected = false;
    canvas.isConnected = false;
    for (let ms = 3000; ms < 9000; ms += 1000 / 60) run(ms);
    expect([frames, timers]).toEqual([[], []]);
  });

  test("still where motion is reduced: the same parts, with no light, motes or waves, and nothing more drawn", () => {
    root.dataset.motion = "reduce";
    const canvas = canvasOf(orb({ size: 168, mood: "working", key: "test:still" }) as unknown as Node_)!;
    expect(count(canvas.calls, "drawImage")).toBe(0);
    // (The halo, the sphere and its core.)
    expect(count(canvas.calls, "createRadialGradient")).toBe(3);
    const before = canvas.calls.length;
    run(1000);
    run(2000);
    expect(canvas.calls.length).toBe(before);
    expect(frames).toEqual([]);
  });

  test("left without a mood, as the history shows him, it is the still SVG; with no canvas to draw on, too", () => {
    expect((orb({ size: 28 }) as unknown as Node_).children[0]!.tag).toBe("svg");
    stub("window", undefined);
    expect((orb({ size: 28, mood: "working" }) as unknown as Node_).children[0]!.tag).toBe("svg");
  });

  test("on screen it moves a frame at a time, and once off the page it is forgotten", () => {
    const canvas = canvasOf(orb({ size: 36, mood: "working", key: "test:frames" }) as unknown as Node_)!;
    const first = canvas.calls.length;
    run(5000);
    expect(canvas.calls.length).toBeGreaterThan(first);
    // (A frame sooner than its next is due draws nothing: at work it is drawn at 30 a second.)
    const drawn = canvas.calls.length;
    run(5010);
    expect(canvas.calls.length).toBe(drawn);
    run(5034);
    expect(canvas.calls.length).toBeGreaterThan(drawn);
    canvas.isConnected = false;
    const gone = canvas.calls.length;
    run(6000);
    run(6100);
    expect(canvas.calls.length).toBe(gone);
  });
});

describe("a knight's seat, moving", () => {
  test("its lights are round its face, over its still ring; never in a conversation's history", () => {
    const live = seat({ id: "gareth", name: "Gareth", state: "working", size: 40 }) as unknown as Node_;
    const lights = live.children.find((child) => child.className === "seat-lights")!;
    expect(lights.tag).toBe("canvas");
    // Its seat is the face and its ring (40 + 2 × 4); the lights reach a quarter past it.
    expect(lights.style.width).toBe(`${Math.ceil(48 * 1.24)}px`);
    expect(live.children[0]!.attrs.class).toContain("worker-avatar");
    const still = seat({ id: "gareth", name: "Gareth", state: "working", size: 40, still: true }) as unknown as Node_;
    expect(still.children.map((child) => child.className)).not.toContain("seat-lights");
  });

  test("Galahad's seat is his orb, moving as where he stands", () => {
    const drawn = seat({ id: "galahad", name: "Galahad", state: "needs", size: 40 }) as unknown as Node_;
    expect(drawn.children[0]!.attrs["data-mood"]).toBe("waiting");
    expect(drawn.children[0]!.attrs["data-tone"]).toBe("warn");
  });
});
