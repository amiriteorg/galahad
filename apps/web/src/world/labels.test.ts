import { describe, expect, test } from "bun:test";
import { PerspectiveCamera, Vector3 } from "three/webgpu";
import { before, LABEL_GAP, type LabelBox, layoutLabels } from "./labels.ts";

/*
 * The SANDBOX's labels laid out on the screen: none ever sits on another; the
 * one that matters more keeps its place and the other moves up out of its way,
 * or fades if that's too far; and nothing flickers as the view moves.
 */

const box = (x: number, y: number, w: number, h: number, rank: number): LabelBox => ({ x, y, w, h, rank, on: true, lift: 0, shown: false });

function lay(boxes: LabelBox[], order = Int32Array.from(boxes.keys())): Int32Array {
  layoutLabels(boxes, boxes.length, order);
  return order;
}

/** Shown boxes that overlap (with the gap between them). */
function overlaps(boxes: LabelBox[]): string[] {
  const out: string[] = [];
  const shown = boxes.filter((b) => b.on && b.shown);
  for (let i = 0; i < shown.length; i++) {
    for (let j = i + 1; j < shown.length; j++) {
      const a = shown[i]!;
      const b = shown[j]!;
      // (Shown labels keep their places until they really touch: never closer than a pixel.)
      const ax = Math.abs(a.x - b.x) < (a.w + b.w) / 2 + 1 - 1e-9;
      const ay = Math.abs(a.y + a.lift - a.h / 2 - (b.y + b.lift - b.h / 2)) < (a.h + b.h) / 2 + 1 - 1e-9;
      if (ax && ay) out.push(`${a.rank} on ${b.rank}`);
    }
  }
  return out;
}

describe("a label behind the view", () => {
  test("isn't placed: what's behind his eyes projects onto the screen all the same, mirrored, so the projection is never asked", () => {
    // His eyes at his hearth, looking south (scene +z); the library is behind him to the north-west.
    const camera = new PerspectiveCamera(62, 1.6, 0.07, 2000);
    camera.position.set(0, 1.9, 18);
    camera.lookAt(0, 1.9, 60);
    camera.updateMatrixWorld();
    const d = camera.getWorldDirection(new Vector3());
    const at = (x: number, y: number, z: number) => before(x, y, z, camera.position.x, camera.position.y, camera.position.z, d.x, d.y, d.z);
    const library = new Vector3(-18, 5.6, -8);
    // The projection alone would put it on the screen (within the frame, on the wrong side).
    const projected = library.clone().project(camera);
    expect(Math.abs(projected.x)).toBeLessThan(1.2);
    expect(Math.abs(projected.y)).toBeLessThan(1.3);
    expect(at(library.x, library.y, library.z)).toBe(false);
    // What's before him is placed: the bench by the lake ahead; and his own bubble, over his head, is not.
    expect(at(-2, 2, 47)).toBe(true);
    expect(at(0, 2.6, 17.8)).toBe(false);
    expect(at(0, 1.9, 18.2)).toBe(false);
    expect(at(0, 1.9, 18.31)).toBe(true);
  });
});

describe("the labels' layout", () => {
  test("his speech bubble keeps its place; the experiment's label under it moves up out of its way", () => {
    const bubble = box(400, 300, 220, 60, 100);
    const exp = box(410, 310, 160, 34, 80);
    lay([exp, bubble]);
    expect([bubble.shown, bubble.lift]).toEqual([true, 0]);
    expect(exp.shown).toBe(true);
    // Just above the bubble.
    expect(exp.y + exp.lift).toBe(300 - 60 - LABEL_GAP);
  });

  test("one that would have to move farther than about its own height fades instead", () => {
    const bubble = box(400, 300, 220, 200, 100);
    const station = box(400, 300, 120, 24, 50);
    lay([bubble, station]);
    expect(station.shown).toBe(false);
  });

  test("the nearer station wins over the farther, which moves or fades", () => {
    const near = box(300, 200, 120, 26, 50 - 20 * 0.01);
    const far = box(320, 205, 120, 26, 50 - 90 * 0.01);
    lay([far, near]);
    expect([near.shown, near.lift]).toEqual([true, 0]);
    expect(far.lift).toBeLessThan(0);
  });

  test("however they're scattered, no two shown labels ever overlap", () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let round = 0; round < 300; round++) {
      const boxes = Array.from({ length: 4 + Math.floor(rnd() * 16) }, () => box(rnd() * 800, rnd() * 600, 60 + rnd() * 160, 20 + rnd() * 50, rnd() * 100));
      const order = lay(boxes);
      expect(overlaps(boxes)).toEqual([]);
      // And frame after frame as they drift, still none.
      for (let f = 0; f < 20; f++) {
        for (const b of boxes) {
          b.x += (rnd() - 0.5) * 6;
          b.y += (rnd() - 0.5) * 6;
        }
        layoutLabels(boxes, boxes.length, order);
        expect(overlaps(boxes)).toEqual([]);
      }
    }
  });

  test("as two labels drift past each other a pixel at a time, each changes its mind at most once each way: no flicker", () => {
    const fixed = box(400, 300, 160, 30, 90);
    const moving = box(400 - 200, 300, 160, 30, 40);
    const boxes = [fixed, moving];
    const order = Int32Array.from([0, 1]);
    let changes = 0;
    let was = "";
    for (let x = 200; x <= 600; x += 0.5) {
      moving.x = x;
      // A little wobble, as a projected label has.
      moving.y = 300 + Math.sin(x * 3) * 0.6;
      layoutLabels(boxes, 2, order);
      const now = `${moving.shown}:${moving.lift < 0}`;
      if (now !== was) changes++;
      was = now;
    }
    // Clear, moved up as it passes, clear again.
    expect(changes).toBeLessThanOrEqual(3);
  });
});
