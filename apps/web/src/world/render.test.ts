import { describe, expect, test } from "bun:test";
import { CameraRig, DEFAULT_DISTANCE, pitchFor } from "./camera.ts";
import { mixColor } from "./daynight.ts";
import { FootPlanner, solveTwoBone } from "./ik.ts";
import { CELL, chunkSamples, growLayer, heightAt, KEEP_FLAT, LAYERS, naturalHeight, SEED, STREAM_STEP, streamAt, streamLevel, WATER_LEVEL, waterAt } from "./terrain.ts";
import { TIERS } from "./tiers.ts";

/*
 * The renderer's pure parts: the characters' inverse kinematics and footwork,
 * the streams' pools and falls, colour maths in linear light, the camera's
 * framing and how it keeps out of buildings, and the tiers' new budgets.
 */

const dist = (o: ArrayLike<number>, i: number, x: number, y: number, z: number) => Math.hypot(o[i]! - x, o[i + 1]! - y, o[i + 2]! - z);

describe("two-bone IK", () => {
  test("the bones keep their lengths, the end reaches the target, and the joint bends towards the pole", () => {
    const out = new Float64Array(6);
    for (const [tx, ty, tz] of [[0.1, -0.7, 0.2], [0.3, -0.5, -0.1], [0, -0.2, 0.4]] as const) {
      solveTwoBone(0, 1, 0, tx, 1 + ty, tz, 0, 1, 5, 0.44, 0.43, out);
      expect(dist(out, 0, 0, 1, 0)).toBeCloseTo(0.44, 9);
      expect(dist(out, 3, out[0]!, out[1]!, out[2]!)).toBeCloseTo(0.43, 9);
      expect(dist(out, 3, tx, 1 + ty, tz)).toBeLessThan(1e-9);
      // The knee goes forward (towards the pole at +z), not back.
      expect(out[2]!).toBeGreaterThan(Math.min(0, tz));
    }
  });

  test("out of reach, it straightens towards the target; on the root, it doesn't blow up", () => {
    const out = new Float64Array(6);
    const reach = solveTwoBone(0, 0, 0, 0, -5, 0, 0, 0, 1, 0.44, 0.43, out);
    expect(reach).toBeCloseTo(0.87, 5);
    expect(out[4]!).toBeCloseTo(-0.87, 5);
    solveTwoBone(0, 0, 0, 0, 0, 0, 0, 0, 0, 0.3, 0.27, out);
    expect([...out].every(Number.isFinite)).toBe(true);
  });
});

describe("footwork", () => {
  const flat = () => 0;
  const rests = [
    { forward: 0, left: 0.13, offset: 0 },
    { forward: 0, left: -0.13, offset: 0.5 },
  ];

  test("a planted foot doesn't slide while the body walks on", () => {
    const feet = new FootPlanner(rests);
    feet.place(0, 0, 0, flat);
    let x = 0;
    const dt = 1 / 60;
    let slid = 0;
    let lastX = [feet.x[0]!, feet.x[1]!];
    let lastPlanted = [1, 1];
    for (let i = 0; i < 300; i++) {
      x += 1.7 * dt;
      feet.step(dt, x, 0, 0, 1.7, 0, 1.3, flat);
      for (let f = 0; f < 2; f++) {
        if (feet.planted[f] && lastPlanted[f]) slid = Math.max(slid, Math.abs(feet.x[f]! - lastX[f]!));
        lastX[f] = feet.x[f]!;
        lastPlanted[f] = feet.planted[f]!;
      }
    }
    expect(slid).toBeLessThan(1e-9);
    // The feet kept up with the body, alternating (never both off the ground at a walk).
    for (let f = 0; f < 2; f++) expect(Math.abs(feet.x[f]! - x)).toBeLessThan(1.3);
  });

  test("feet follow the ground and lift in an arc; standing, they step back under the hips", () => {
    const slope = (x: number) => x * 0.2;
    const feet = new FootPlanner(rests);
    feet.place(0, 0, 0, slope);
    let maxLift = 0;
    let x = 0;
    for (let i = 0; i < 120; i++) {
      x += 1.7 / 60;
      feet.step(1 / 60, x, 0, 0, 1.7, 0, 1.3, slope);
      for (let f = 0; f < 2; f++) {
        expect(feet.z[f]!).toBeCloseTo(slope(feet.x[f]!) + feet.lift[f]!, 9);
        maxLift = Math.max(maxLift, feet.lift[f]!);
      }
    }
    expect(maxLift).toBeGreaterThan(0.1);
    for (let i = 0; i < 120; i++) feet.step(1 / 60, x, 0, 0, 0, 0, 1.3, slope);
    for (let f = 0; f < 2; f++) {
      expect(feet.planted[f]).toBe(1);
      expect(Math.hypot(feet.x[f]! - feet.restX(f, x, 0), feet.y[f]! - feet.restY(f, 0, 0))).toBeLessThan(0.11);
    }
  });

  test("a teleport sets the feet down under the body at once", () => {
    const feet = new FootPlanner(rests);
    feet.place(0, 0, 0, flat);
    feet.step(1 / 60, 100, 50, 1, 0, 0, 1.3, flat);
    for (let f = 0; f < 2; f++) expect(Math.hypot(feet.x[f]! - 100, feet.y[f]! - 50)).toBeLessThan(0.2);
  });
});

describe("streams, pools and waterfalls", () => {
  test("a pool's level is the lakes' plus a whole number of drops", () => {
    for (let i = 0; i < 500; i++) {
      const level = streamLevel(SEED, i * 37.1 - 9000, i * 11.3 + 400);
      const k = (level - WATER_LEVEL) / STREAM_STEP;
      expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-9);
      expect(k).toBeGreaterThanOrEqual(0);
    }
  });

  test("where a stream runs above the lakes, its bed is under its pool; somewhere it falls a step", () => {
    let pools = 0;
    let falls = 0;
    for (let x = -4000; x <= 4000; x += CELL) {
      for (let y = -2000; y <= 2000; y += 24) {
        if (streamAt(SEED, x, y) < 0.95) continue;
        const level = streamLevel(SEED, x, y);
        const water = waterAt(SEED, x, y, []);
        expect(water).toBeGreaterThanOrEqual(WATER_LEVEL);
        if (level <= WATER_LEVEL) continue;
        pools++;
        expect(heightAt(SEED, x, y, [])).toBeLessThan(level);
        if (streamLevel(SEED, x + CELL, y) < level - 1) falls++;
      }
    }
    expect(pools).toBeGreaterThan(10);
    expect(falls).toBeGreaterThan(0);
  });

  test("the keep's lawn holds no pools", () => {
    for (let i = 0; i < 300; i++) {
      const a = i * 2.399;
      const r = (i % 30) * 1.4;
      const w = waterAt(SEED, Math.cos(a) * r, Math.sin(a) * r, [KEEP_FLAT]);
      expect(w).toBe(Number.NEGATIVE_INFINITY);
    }
  });

  test("the small layers grow later, exactly as they would have grown at once", () => {
    const later = chunkSamples(SEED, 2, -1, [KEEP_FLAT], undefined, ["trees", "bushes", "rocks"]);
    const once = chunkSamples(SEED, 2, -1, [KEEP_FLAT]);
    expect(later.layers.grass).toBeUndefined();
    for (const layer of LAYERS) expect(growLayer(SEED, later, layer)).toEqual(once.layers[layer]!);
    expect(naturalHeight(SEED, 10, 10)).toBe(naturalHeight(SEED, 10, 10));
  });
});

describe("colour", () => {
  test("colours blend in linear light: halfway between black and white is brighter than 50% sRGB", () => {
    const mid = mixColor(0x000000, 0xffffff, 0.5);
    expect(mid & 255).toBeGreaterThan(180);
    expect(mixColor(0x123456, 0xabcdef, 0)).toBe(0x123456);
    expect(mixColor(0x123456, 0xabcdef, 1)).toBe(0xabcdef);
  });
});

describe("the camera", () => {
  test("by default it's close and low (he's large in the frame); far out it looks down", () => {
    expect(DEFAULT_DISTANCE).toBeLessThanOrEqual(12);
    expect(pitchFor(DEFAULT_DISTANCE)).toBeLessThan((14 * Math.PI) / 180);
    expect(pitchFor(120)).toBeGreaterThan((45 * Math.PI) / 180);
    expect(new CameraRig().distance).toBe(DEFAULT_DISTANCE);
  });

  test("it never stands inside a building: blocked behind him, it turns to the nearest clear side", () => {
    const rig = new CameraRig();
    rig.lookAt(0, -8.5);
    // Looking south from the keep's door would put the camera in the tree.
    rig.target.yaw = -Math.PI / 2;
    const clear = (x: number, y: number) => Math.hypot(x, y) > 9.5;
    rig.trail(-Math.PI / 2, false, 0.016, clear);
    const back = rig.target.distance * Math.cos(pitchFor(rig.target.distance));
    expect(clear(rig.target.x - Math.cos(rig.target.yaw) * back, rig.target.y - Math.sin(rig.target.yaw) * back)).toBe(true);
  });

  test("while he walks it swings round behind him, but not right after the viewer turned it", () => {
    const rig = new CameraRig();
    rig.lookAt(100, 100);
    rig.target.yaw = 0;
    rig.rotateBy(0);
    const open = () => true;
    for (let i = 0; i < 60; i++) rig.trail(Math.PI, true, 0.05, open);
    expect(rig.target.yaw).toBe(0);
    for (let i = 0; i < 600; i++) rig.trail(Math.PI, true, 0.05, open);
    expect(Math.abs(Math.cos(rig.target.yaw - Math.PI))).toBeGreaterThan(0.8);
  });
});

describe("tier budgets", () => {
  test("ground detail, glows and water grow with the tier; the low tier still has a little grass", () => {
    for (const k of ["detail", "halos", "waterGrid", "grassRadius", "treeLod", "chunkMs"] as const) {
      expect(TIERS.low[k]).toBeLessThanOrEqual(TIERS.medium[k]);
      expect(TIERS.medium[k]).toBeLessThanOrEqual(TIERS.high[k]);
    }
    expect(TIERS.low.grass).toBeGreaterThan(0);
    expect(TIERS.medium.antialias).toBe(true);
  });
});
