import { describe, expect, test } from "bun:test";
import { STATIONS, type WorldEvent } from "@galahad/core/world";
import { applyWorldEvent, emptyWorld, readWorldEvent } from "../lib/world.ts";
import { fromScene, headingToSceneYaw, onPlot, plotToWorld, toScene, worldToPlot } from "./coords.ts";
import { createDemo } from "./demo.ts";
import { fbm, hash2, simplex, valueNoise } from "./noise.ts";
import { DECK_REST } from "./keep-deck.ts";
import { angleDiff, built, obstacles, PLACES, paceFor, pathLength, planPath, plotGate, RUN_BEYOND, standAt, targetFor, Walker } from "./path.ts";
import { axisAngle, interpolatePose, mulQuat, PoseBuffer, type Quat, rotate, slerp } from "./pose.ts";
import { CELLS, CHUNK, chunkKey, chunkOf, chunkSamples, chunksAround, flatsTouching, heightAt, KEEP_FLAT, KEEP_RADIUS, LAYERS, plotFlat, SEED, STRIDE } from "./terrain.ts";

describe("noise", () => {
  test("deterministic, bounded and seed-dependent", () => {
    expect(hash2(1, 2, 3)).toBe(hash2(1, 2, 3));
    expect(hash2(1, 2, 3)).not.toBe(hash2(2, 2, 3));
    for (let i = 0; i < 2000; i++) {
      const x = (i * 7.31) % 97;
      const y = (i * 3.17) % 89;
      const h = hash2(9, i, -i);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
      expect(Math.abs(simplex(5, x, y))).toBeLessThanOrEqual(1.0001);
      expect(Math.abs(valueNoise(5, x, y))).toBeLessThanOrEqual(1);
      expect(Math.abs(fbm(5, x, y))).toBeLessThanOrEqual(1.0001);
    }
    expect(simplex(1, 10.5, 3.25)).not.toBe(simplex(2, 10.5, 3.25));
  });

  test("continuous: nearby points have nearby values", () => {
    for (let i = 0; i < 200; i++) {
      const x = i * 0.37;
      expect(Math.abs(simplex(3, x, 1.5) - simplex(3, x + 1e-4, 1.5))).toBeLessThan(1e-2);
    }
  });
});

describe("terrain", () => {
  test("chunk math: which chunk a point is in, and the chunks around it nearest first", () => {
    expect(chunkOf(0, 0)).toEqual([0, 0]);
    expect(chunkOf(63.9, -0.1)).toEqual([0, -1]);
    expect(chunkOf(-64, 128)).toEqual([-1, 2]);
    const around = chunksAround(10, 10, 100);
    expect(around[0]).toEqual([0, 0]);
    expect(new Set(around.map(([x, y]) => chunkKey(x, y))).size).toBe(around.length);
    // Every chunk within the radius is there, and none beyond it.
    for (let cx = -4; cx <= 4; cx++) {
      for (let cy = -4; cy <= 4; cy++) {
        const nx = Math.max(cx * CHUNK, Math.min(10, (cx + 1) * CHUNK));
        const ny = Math.max(cy * CHUNK, Math.min(10, (cy + 1) * CHUNK));
        const near = Math.hypot(nx - 10, ny - 10) <= 100;
        expect(around.some(([x, y]) => x === cx && y === cy)).toBe(near);
      }
    }
  });

  test("the same seed grows the same land; another seed doesn't", () => {
    const a = chunkSamples(SEED, 3, -2, [KEEP_FLAT]);
    const b = chunkSamples(SEED, 3, -2, [KEEP_FLAT]);
    expect(a.heights).toEqual(b.heights);
    expect(a.faces).toEqual(b.faces);
    expect(a.layers).toEqual(b.layers);
    const c = chunkSamples(SEED + 1, 3, -2, [KEEP_FLAT]);
    expect(c.heights).not.toEqual(a.heights);
  });

  test("neighbouring chunks share their edges exactly (no cracks)", () => {
    const n = CELLS + 1;
    const a = chunkSamples(SEED, 2, 1, []);
    const right = chunkSamples(SEED, 3, 1, []);
    const up = chunkSamples(SEED, 2, 2, []);
    for (let k = 0; k < n; k++) {
      expect(a.heights[k * n + CELLS]).toBe(right.heights[k * n]!);
      expect(a.heights[CELLS * n + k]).toBe(up.heights[k]!);
    }
  });

  test("the keep's ground and every plot are flat at level 0, with no trees or rocks on them", () => {
    const plot = { x: 140, y: -90, size: 30 };
    const flats = [KEEP_FLAT, plotFlat(plot)];
    for (let i = 0; i < 400; i++) {
      const r = KEEP_RADIUS * Math.sqrt((i % 20) / 20);
      const a = i * 2.399;
      expect(heightAt(SEED, r * Math.cos(a), r * Math.sin(a), flats)).toBe(0);
      expect(heightAt(SEED, plot.x + (((i % 20) / 19) - 0.5) * plot.size, plot.y + ((Math.floor(i / 20) / 19) - 0.5) * plot.size, flats)).toBe(0);
    }
    for (let cx = -2; cx <= 3; cx++) {
      for (let cy = -3; cy <= 1; cy++) {
        const s = chunkSamples(SEED, cx, cy, flats, built);
        for (const layer of LAYERS) {
          const packed = s.layers[layer]!;
          expect(packed.length % STRIDE).toBe(0);
          const lawn = layer === "grass" || layer === "flowers" || layer === "detail";
          for (let i = 0; i < packed.length; i += STRIDE) {
            const [x, y] = [packed[i]!, packed[i + 1]!];
            // Grass, flowers, pebbles and clover grow on the keep's lawn, but never on a path or a building; nothing else does.
            if (lawn) expect(built(x, y)).toBe(false);
            else expect(Math.hypot(x, y)).toBeGreaterThan(KEEP_RADIUS);
            expect(onPlot(plot, x, y, lawn ? 0 : 3)).toBe(false);
          }
        }
      }
    }
  });

  test("the world has hills and water somewhere, and is gentle (no cliff higher than a terrace step and a slope)", () => {
    let min = Infinity;
    let max = -Infinity;
    for (let x = -3000; x <= 3000; x += 40) {
      for (let y = -3000; y <= 3000; y += 40) {
        const h = heightAt(SEED, x, y, []);
        min = Math.min(min, h);
        max = Math.max(max, h);
        expect(Math.abs(heightAt(SEED, x + 4, y, []) - h)).toBeLessThan(4.5);
      }
    }
    expect(min).toBeLessThan(-1.4);
    expect(max).toBeGreaterThan(5);
  });

  test("a chunk knows which flats shape it", () => {
    const plot = plotFlat({ x: 200, y: 200, size: 20 });
    expect(flatsTouching(0, 0, [KEEP_FLAT, plot])).toEqual([KEEP_FLAT]);
    expect(flatsTouching(3, 3, [KEEP_FLAT, plot])).toEqual([plot]);
    expect(flatsTouching(20, 20, [KEEP_FLAT, plot])).toEqual([]);
  });

  test("far from the origin it still works (floating origin keeps the GPU numbers small)", () => {
    const s = chunkSamples(SEED, 150_000, -150_000, []);
    expect(s.heights.every(Number.isFinite)).toBe(true);
  });
});

describe("poses", () => {
  const close = (a: number[], b: number[], eps = 1e-9) => a.forEach((v, i) => expect(Math.abs(v - b[i]!)).toBeLessThan(eps));

  test("slerp: ends exact, halfway is the half-angle turn, always unit, shortest arc", () => {
    const a: Quat = [1, 0, 0, 0];
    const b = axisAngle([0, 0, 1], Math.PI / 2);
    close(slerp(a, b, 0), a);
    close(slerp(a, b, 1), b);
    close(slerp(a, b, 0.5), axisAngle([0, 0, 1], Math.PI / 4));
    // -b is the same orientation: still the short way round.
    close(slerp(a, [-b[0], -b[1], -b[2], -b[3]], 0.5), axisAngle([0, 0, 1], Math.PI / 4));
    for (let t = 0; t <= 1; t += 0.1) expect(Math.hypot(...slerp(a, axisAngle([1, 2, 3], 2.5), t))).toBeCloseTo(1, 12);
    // Nearly identical orientations don't blow up.
    const c = axisAngle([0, 1, 0], 1e-7);
    close(slerp(a, c, 0.5), axisAngle([0, 1, 0], 5e-8), 1e-9);
  });

  test("rotation helpers agree with each other", () => {
    const q = mulQuat(axisAngle([0, 0, 1], Math.PI / 2), axisAngle([0, 1, 0], -Math.PI / 2));
    // Pitch the nose (+x) straight up, then yaw: still straight up.
    close(rotate(q, [1, 0, 0]), [0, 0, 1], 1e-12);
    close(rotate(axisAngle([0, 0, 1], Math.PI / 2), [1, 0, 0]), [0, 1, 0], 1e-12);
  });

  test("pose interpolation lerps position and slerps orientation", () => {
    const q = axisAngle([1, 0, 0], Math.PI);
    const p = interpolatePose([0, 0, 0, 1, 0, 0, 0], [10, -2, 4, q[0], q[1], q[2], q[3]], 0.25);
    close(p.slice(0, 3), [2.5, -0.5, 1]);
    close(p.slice(3), axisAngle([1, 0, 0], Math.PI / 4));
  });

  /** Samples into a record (the renderer's visitor writes straight into meshes). */
  const take = (buffer: PoseBuffer, now: number): Record<string, number[]> | null => {
    const out: Record<string, number[]> = {};
    return buffer.sample(now, (id, ...pose) => (out[id] = pose)) ? out : null;
  };

  test("the playback buffer plays 150 ms behind, between the frames around the playhead", () => {
    const buffer = new PoseBuffer(150);
    // The node's clock is 5 s ahead of ours; frames arrive 20 ms after they're stamped.
    for (let i = 0; i <= 10; i++) buffer.push(5000 + i * 100, i * 0.1, { b: [i, 0, 0, 1, 0, 0, 0] }, i * 100 + 20);
    // At our 870 ms: playhead = 870 − (20 − 5000) − 150 − 5000 = 700 on our timeline → frame 7.
    expect(take(buffer, 870)!.b![0]).toBeCloseTo(7, 9);
    expect(take(buffer, 920)!.b![0]).toBeCloseTo(7.5, 9);
    // Past the last: hold the last (no guessing), and say so only once.
    expect(take(buffer, 99_999)!.b![0]).toBe(10);
    expect(take(buffer, 100_500)).toBeNull();
    expect(take(new PoseBuffer(), 0)).toBeNull();
    const early = new PoseBuffer(150);
    early.push(5000, 0, { b: [3, 0, 0, 1, 0, 0, 0] }, 20);
    early.push(5100, 0.1, { b: [4, 0, 0, 1, 0, 0, 0] }, 120);
    expect(take(early, -500)!.b![0]).toBe(3);
  });

  test("sampled orientations are slerped and unit length", () => {
    const buffer = new PoseBuffer(0);
    const q = axisAngle([0, 0, 1], Math.PI / 2);
    buffer.push(0, 0, { b: [0, 0, 0, 1, 0, 0, 0] }, 0);
    buffer.push(100, 0.1, { b: [0, 0, 0, q[0], q[1], q[2], q[3]] }, 100);
    const pose = take(buffer, 50)!.b!;
    close(pose.slice(3), axisAngle([0, 0, 1], Math.PI / 4));
  });

  test("jitter in arrival doesn't become jerky motion", () => {
    const buffer = new PoseBuffer(150);
    const jitter = [0, 40, 5, 60, 10, 0, 35, 20, 0, 50];
    for (let i = 0; i < 10; i++) buffer.push(i * 50, i * 0.05, { b: [i * 50, 0, 0, 1, 0, 0, 0] }, i * 50 + 30 + jitter[i]!);
    // The least-delayed arrival (30 ms) maps clocks: positions advance exactly with time.
    expect(take(buffer, 400)!.b![0]).toBeCloseTo(220, 9);
    expect(take(buffer, 410)!.b![0]).toBeCloseTo(230, 9);
  });

  test("a restart (time going far back) starts the buffer over; a stale straggler is dropped", () => {
    const buffer = new PoseBuffer(0);
    buffer.push(10_000, 10, { b: [1, 0, 0, 1, 0, 0, 0] }, 10_000);
    buffer.push(9_990, 9.99, { b: [9, 0, 0, 1, 0, 0, 0] }, 10_001);
    expect(buffer.size).toBe(1);
    buffer.push(1_000, 0, { b: [2, 0, 0, 1, 0, 0, 0] }, 10_002);
    expect(buffer.size).toBe(1);
    expect(buffer.latestT).toBe(0);
  });
});

describe("where Galahad goes", () => {
  test("he stands in front of each station, outside its building, facing it", () => {
    for (const place of PLACES) {
      const s = standAt(place);
      const st = STATIONS[place];
      const d = Math.hypot(s.x - st.x, s.y - st.y);
      expect(d).toBeGreaterThan(1);
      expect(d).toBeLessThan(10);
      for (const o of obstacles()) expect(Math.hypot(s.x - o.x, s.y - o.y)).toBeGreaterThanOrEqual(o.r);
      if (place !== "keep") expect(Math.abs(angleDiff(s.facing, Math.atan2(st.y - s.y, st.x - s.x)))).toBeLessThan(1e-9);
    }
    expect(standAt("keep").x).toBeCloseTo(0, 12);
    expect(standAt("keep").y).toBeCloseTo(-8.5, 12);
  });

  test("his state sends him to the station, or the gate of the experiment he's out at", () => {
    const e = { id: "x", plot: { x: 100, y: 0, size: 20 } };
    const g = { station: "field" as const, doing: "", experiment: "x", model: null, since: 0 };
    const gate = targetFor(g, [e as never]);
    expect(gate.x).toBeCloseTo(100 - 10 - 1.6, 9);
    expect(gate.y).toBeCloseTo(0, 9);
    expect(gate.facing).toBeCloseTo(0, 9); // facing east, into the plot
    // At the keep (and when the experiment's gone), up on its deck.
    expect(targetFor({ ...g, experiment: "gone" }, [])).toEqual(DECK_REST);
    expect(targetFor({ ...g, station: "keep" }, [])).toEqual(DECK_REST);
    expect(targetFor({ ...g, station: "library" }, [])).toEqual(standAt("library"));
    const corner = plotGate({ x: -50, y: -50, size: 20 });
    expect(onPlot({ x: -50, y: -50, size: 20 }, corner.x, corner.y)).toBe(false);
    expect(onPlot({ x: -50, y: -50, size: 20 }, corner.x, corner.y, 2)).toBe(true);
  });

  test("paths go round the keep and the buildings, never through them", () => {
    const obs = obstacles();
    const samples = (from: { x: number; y: number }, path: { x: number; y: number }[]) => {
      const pts: { x: number; y: number }[] = [];
      let prev = from;
      for (const p of path) {
        for (let k = 0; k <= 20; k++) pts.push({ x: prev.x + ((p.x - prev.x) * k) / 20, y: prev.y + ((p.y - prev.y) * k) / 20 });
        prev = p;
      }
      return pts;
    };
    for (const a of PLACES) {
      for (const b of PLACES) {
        const from = standAt(a);
        const to = standAt(b);
        const path = planPath(from, to, obs);
        expect(path.at(-1)).toEqual({ x: to.x, y: to.y });
        for (const p of samples(from, path)) for (const o of obs) expect(Math.hypot(p.x - o.x, p.y - o.y)).toBeGreaterThan(o.r - 1e-9);
        expect(pathLength(from, path)).toBeLessThan(Math.hypot(to.x - from.x, to.y - from.y) * 1.8 + 1);
      }
    }
  });

  test("a clear way is a straight line", () => {
    expect(planPath({ x: 100, y: 100 }, { x: 120, y: 100 }, obstacles())).toEqual([{ x: 120, y: 100 }]);
  });

  test("he walks near, runs far, and arrives facing the work; reduced motion teleports", () => {
    expect(paceFor(10).running).toBe(false);
    expect(paceFor(RUN_BEYOND + 1).running).toBe(true);
    expect(paceFor(2000).speed).toBeGreaterThan(50); // far plots take at most ~25 s
    const w = new Walker(standAt("keep"));
    w.go(standAt("forge"), obstacles());
    expect(w.moving || w.waypoints.length > 0).toBe(true);
    let t = 0;
    while (w.step(1 / 30) && t < 60) t += 1 / 30;
    const forge = standAt("forge");
    expect(w.x).toBeCloseTo(forge.x, 6);
    expect(w.y).toBeCloseTo(forge.y, 6);
    expect(Math.abs(angleDiff(w.heading, forge.facing))).toBeLessThan(1e-3);
    expect(w.moving).toBe(false);
    const jump = new Walker(standAt("keep"));
    jump.go(standAt("oracle"), obstacles(), true);
    expect(jump).toMatchObject({ x: standAt("oracle").x, y: standAt("oracle").y, moving: false });
  });
});

describe("coordinates", () => {
  test("world (z up) to scene (y up) is a proper rotation and round-trips", () => {
    expect(toScene(1, 2, 3)).toEqual([1, 3, -2]);
    expect(fromScene(...toScene(4, -5, 6))).toEqual([4, -5, 6]);
    // East × north = up in the world; the same triple in the scene: x × (−z) = y.
    const [ex, ny, up] = [toScene(1, 0, 0), toScene(0, 1, 0), toScene(0, 0, 1)];
    const cross = [ex[1] * ny[2] - ex[2] * ny[1], ex[2] * ny[0] - ex[0] * ny[2], ex[0] * ny[1] - ex[1] * ny[0]];
    expect(cross.map((v) => v + 0)).toEqual(up.map((v) => v + 0));
  });

  test("an experiment's coordinates land on its plot: scaled, then offset by the plot's centre", () => {
    const plot = { x: 60, y: -30, size: 20 };
    expect(plotToWorld(plot, 0.5, [4, -2, 10])).toEqual([62, -31, 5]);
    expect(worldToPlot(plot, 0.5, plotToWorld(plot, 0.5, [4, -2, 10]))).toEqual([4, -2, 10]);
    expect(onPlot(plot, 69.9, -39.9)).toBe(true);
    expect(onPlot(plot, 70.1, -30)).toBe(false);
  });

  test("a heading in the world turns a model to face it in the scene", () => {
    // The model's front is scene +z; turned by the yaw it must point along the heading.
    for (const heading of [0, Math.PI / 2, 2, -2.5]) {
      const yaw = headingToSceneYaw(heading);
      const front = [Math.sin(yaw), 0, Math.cos(yaw)];
      const want = toScene(Math.cos(heading), Math.sin(heading), 0);
      front.forEach((v, i) => expect(v).toBeCloseTo(want[i]!, 12));
    }
  });
});

describe("the demo", () => {
  test("every event it makes is a valid contract event the reducer accepts", () => {
    const start = 1_700_000_000_000;
    const demo = createDemo(start);
    const events: WorldEvent[] = [demo.hello(start)];
    for (let ms = 0; ms <= 300_000; ms += 50) events.push(...demo.step(start + ms));
    let model = emptyWorld();
    const kinds = new Set<string>();
    const stations = new Set<string>();
    for (const e of events) {
      const read = readWorldEvent(JSON.parse(JSON.stringify(e)));
      expect(read).toEqual(JSON.parse(JSON.stringify(e)));
      kinds.add(e.type);
      if (e.type === "galahad") stations.add(e.galahad.station);
      model = applyWorldEvent(model, e);
    }
    expect([...kinds].sort()).toEqual(["experiment", "frame", "galahad", "hello", "notice", "thought"]);
    expect(stations.size).toBeGreaterThanOrEqual(8);
    expect(model.experiments.map((e) => e.engine).sort()).toEqual(["gazebo", "jsbsim", "mujoco", "rocketpy"]);
    expect(model.thoughts.length).toBeGreaterThan(0);
    // Plots never overlap each other or the keep's ground.
    const plots = model.experiments.map((e) => e.plot);
    for (const p of plots) {
      expect(Math.hypot(p.x, p.y) - (p.size / 2) * Math.SQRT2).toBeGreaterThan(KEEP_RADIUS);
      for (const q of plots) if (p !== q) expect(Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y))).toBeGreaterThan((p.size + q.size) / 2);
    }
    // The rocket climbs above 800 m at some point and comes back down.
    const altitudes = events.flatMap((e) => (e.type === "frame" && e.frame.experiment === "demo-rocket" ? [e.frame.metrics?.altitude_m ?? 0] : []));
    expect(Math.max(...altitudes)).toBeGreaterThan(800);
    expect(altitudes.at(-1)).toBeLessThan(800);
  });

  test("the same start gives the same script", () => {
    const a = createDemo(0);
    const b = createDemo(0);
    a.hello(0);
    b.hello(0);
    expect(JSON.stringify(a.step(12_345))).toBe(JSON.stringify(b.step(12_345)));
  });
});
