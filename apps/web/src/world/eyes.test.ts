import { describe, expect, test } from "bun:test";
import { Group, Object3D, Vector3 } from "three/webgpu";
import { EYE, Eyes, type EyesHost } from "./eyes.ts";
import { GLOW_NEAR, glowCloseness } from "./glows.ts";
import { Knight } from "./knight.ts";
import { EYE_HEIGHT } from "./sight.ts";

/*
 * His eyes' camera (eyes.ts): where it sits and the way it looks, how far his
 * eyes turn in his head towards what he attends to, when the panel is due a
 * frame, and what the words are told of the view. No renderer: the cameras and
 * the timing are plain maths.
 */

const RAD = Math.PI / 180;
/** Nothing is drawn in these tests: a host whose renderer is never reached. */
const host = { renderer: null, webgpu: true, canvas: null, draw: () => {}, redraw: () => {} } as unknown as EyesHost;
const eyes = () => new Eyes({ width: 256, fps: 5 }, host);
const looking = (e: Eyes) => e.camera.getWorldDirection(new Vector3());

/** A head at `at`, turned `yaw` about the vertical (0: facing +z, as he's built) and `pitch` down. */
function head(at: [number, number, number], yaw = 0, pitch = 0): Object3D {
  const root = new Group();
  const bone = new Object3D();
  root.add(bone);
  root.position.set(...at);
  root.rotation.y = yaw;
  bone.rotation.x = pitch;
  return bone;
}

describe("where his eyes are, and the way they look", () => {
  test("at his visor's line, a little before its glass, looking the way his head faces", () => {
    const e = eyes();
    e.pose(head([10, 2.1, -5]));
    expect(e.camera.position.toArray()).toEqual([10, 2.1 + EYE.up, -5 + EYE.forward]);
    const d = looking(e);
    expect(d.x).toBeCloseTo(0, 6);
    expect(d.y).toBeCloseTo(0, 6);
    expect(d.z).toBeCloseTo(1, 6);
    // Turned a quarter left and looking down: his eyes go with his head.
    e.pose(head([0, 2, 0], Math.PI / 2, 0.5));
    const turned = looking(e);
    expect(turned.x).toBeCloseTo(Math.cos(0.5), 5);
    expect(turned.y).toBeCloseTo(-Math.sin(0.5), 5);
    expect(turned.z).toBeCloseTo(0, 5);
  });

  test("his helm is behind the view: the eye is outside the helm's shell and nothing of the head is before its near plane", () => {
    // The visor's glass is a cylinder of radius 0.212 about the head's axis; the brow and the glowing line reach 0.214.
    expect(EYE.forward - EYE.near).toBeGreaterThan(0.17);
    expect(EYE.forward).toBeGreaterThan(0.214 + 0.02);
    expect(EYE.fov).toBeGreaterThan(55);
    expect(EYE.fov).toBeLessThan(75);
  });

  test("on the knight himself: his eyes ride on his head's bone, at about his height, facing where he faces", () => {
    const knight = new Knight(false);
    knight.root.position.set(4, 1, -7);
    const e = eyes();
    e.pose(knight.head);
    // Standing at rest (the bind pose): his eyes where a review's standing places put them, before his face.
    expect(e.camera.position.y - 1).toBeCloseTo(EYE_HEIGHT, 2);
    expect(Math.hypot(e.camera.position.x - 4, e.camera.position.z + 7)).toBeLessThan(0.5);
    expect(e.camera.position.z).toBeGreaterThan(-7);
    expect(looking(e).z).toBeGreaterThan(0.95);
    expect(knight.eyesShut).toBe(0);
    knight.dispose();
  });
});

describe("his eyes turn in his head towards what he attends to", () => {
  test("something within their reach of where his head points is looked at squarely", () => {
    const e = eyes();
    e.pose(head([0, 2, 0]));
    const at = new Vector3(0.6, 1.7, 3);
    e.gaze(true, at.x, at.y, at.z, 0, false);
    const want = at.clone().sub(e.camera.position).normalize();
    expect(looking(e).angleTo(want)).toBeLessThan(1e-4);
  });

  test("beyond it they turn as far as eyes do and no further: the page under his pen comes into view", () => {
    const e = eyes();
    // Seated at his desk, his head as far down as a neck goes (0.75 rad); the page is steeper below than that.
    const bone = head([0, 1.7, 0], 0, 0.75);
    e.pose(bone);
    const before = looking(e).clone();
    const page = new Vector3(0, 0.82, 0.45);
    const steep = page.clone().sub(e.camera.position).normalize();
    expect(before.angleTo(steep)).toBeGreaterThan(EYE.turn);
    e.gaze(true, page.x, page.y, page.z, 0, false);
    const after = looking(e);
    expect(after.angleTo(before)).toBeCloseTo(EYE.turn, 4);
    expect(after.angleTo(steep)).toBeCloseTo(before.angleTo(steep) - EYE.turn, 4);
    // The page is now inside the view (its bottom edge is half the field of view below where he looks).
    expect(after.angleTo(steep)).toBeLessThan((EYE.fov / 2) * RAD);
    expect(before.angleTo(steep)).toBeGreaterThan((EYE.fov / 2) * RAD - 0.1);
  });

  test("eased in and out with motion, at once without; with nothing attended to they look where his head points", () => {
    const e = eyes();
    const bone = head([0, 2, 0]);
    const straight = new Vector3(0, 0, 1);
    const at: [number, number, number] = [2, 1.2, 3];
    e.pose(bone);
    e.gaze(true, ...at, 1 / 60, true);
    const first = looking(e).angleTo(straight);
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(0.1);
    for (let i = 0; i < 120; i++) {
      e.pose(bone);
      e.gaze(true, ...at, 1 / 60, true);
    }
    expect(looking(e).angleTo(straight)).toBeCloseTo(EYE.turn, 2);
    // He looks away: they come back.
    for (let i = 0; i < 120; i++) {
      e.pose(bone);
      e.gaze(false, 0, 0, 0, 1 / 60, true);
    }
    expect(looking(e).angleTo(straight)).toBeLessThan(0.01);
    e.pose(bone);
    e.gaze(true, ...at, 0, false);
    expect(looking(e).angleTo(straight)).toBeCloseTo(EYE.turn, 4);
  });
});

describe("a standing place, and what the words are told", () => {
  test("posed at a place it looks along the heading given (east 0, north a quarter turn), pitched as said", () => {
    const e = eyes();
    e.poseAt(5, 2.3, -9, Math.PI / 2, -0.2);
    const d = looking(e);
    // North is scene −z.
    expect(d.x).toBeCloseTo(0, 5);
    expect(d.z).toBeCloseTo(-Math.cos(0.2), 5);
    expect(d.y).toBeCloseTo(-Math.sin(0.2), 5);
    // The words get it in world metres (x east, y north, z up), with the floating origin put back.
    const eye = e.sightEye([64, -128], { x: 0, y: 0, z: 0, heading: 0, pitch: 0, fov: 0, aspect: 0 });
    expect(eye.x).toBeCloseTo(69, 6);
    expect(eye.y).toBeCloseTo(-119, 6);
    expect(eye.z).toBeCloseTo(2.3, 6);
    expect(eye.heading).toBeCloseTo(Math.PI / 2, 5);
    expect(eye.pitch).toBeCloseTo(-0.2, 5);
    expect(eye.fov).toBeCloseTo(EYE.fov * RAD, 6);
    expect(eye.aspect).toBe(EYE.aspect);
  });
});

describe("when the panel is drawn", () => {
  test("closed, never; and it isn't wanted at all unless the panel is open or his view is the main one", () => {
    const e = eyes();
    expect(e.isOpen).toBe(false);
    expect(e.wanted).toBe(false);
    expect(e.due(1e9, true)).toBe(false);
    e.swapped = true;
    expect(e.wanted).toBe(true);
    expect(e.due(1e9, true)).toBe(false);
  });
});

describe("glows seen from beside them", () => {
  test("a lamp's glow draws in and softens near the eye, and is as it was put from across the lawn", () => {
    // (The shader's own smoothstep over the same numbers: glows.ts.)
    expect(glowCloseness(0.3)).toBe(0);
    expect(glowCloseness(GLOW_NEAR.to)).toBe(1);
    expect(glowCloseness(40)).toBe(1);
    // Seated by his fire (1.3 m from his eyes) it's about a third its size and light; from his bed (3.5 m), well over half.
    const at = (d: number) => GLOW_NEAR.size + (1 - GLOW_NEAR.size) * glowCloseness(d);
    expect(at(1.3)).toBeLessThan(0.36);
    expect(at(3.5)).toBeGreaterThan(0.6);
    expect(at(3.5)).toBeLessThan(0.8);
    for (let d = 0.2; d < 8; d += 0.1) expect(glowCloseness(d + 0.1)).toBeGreaterThanOrEqual(glowCloseness(d));
  });
});
