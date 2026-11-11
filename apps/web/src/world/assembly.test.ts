import { describe, expect, test } from "bun:test";
import type { ExperimentView } from "@galahad/core/world";
import { BENCH } from "@galahad/core/world";
import { benchFor, buildingAt, buildKit } from "./assembly.ts";
import { ASSEMBLY, HALL_COLLIDERS, HALL_DOOR, inCollider } from "./hall-plan.ts";
import { Workshop } from "./hall.ts";
import { obstacles, planPath, type Point } from "./path.ts";
import { TIERS } from "./tiers.ts";

/*
 * Building an experiment at the workshop's assembly bench: where Galahad stands and that he can get
 * there, what's on the bench, and the kit its bodies are laid out as and put together into.
 */

const view = (over: Partial<ExperimentView> = {}): ExperimentView => ({
  id: "ex_AAAAAAAAAAAA",
  title: "Arm",
  engine: "mujoco",
  status: "starting",
  phase: "building",
  plot: { x: 112, y: 11, size: 10 },
  scale: 1,
  scene: [
    { id: "floor", shape: { kind: "plane", size: [10, 10] }, fixed: true },
    { id: "pedestal", shape: { kind: "cylinder", radius: 0.08, length: 0.5 }, fixed: true },
    { id: "upper", shape: { kind: "capsule", radius: 0.04, length: 0.5 } },
    { id: "hand", shape: { kind: "sphere", radius: 0.05 } },
  ],
  startedAt: 1,
  endedAt: null,
  nodeName: "ultra",
  sandbox: null,
  quest: null,
  metrics: {},
  summary: null,
  ...over,
});

describe("the assembly bench", () => {
  test("its place is the contract's; Galahad gets there from the door without touching anything", () => {
    expect(ASSEMBLY.bench.x).toBe(BENCH.x);
    expect(ASSEMBLY.stand).toEqual(BENCH.stand);
    const place = new Workshop({ tier: TIERS.high, shadows: true, ground: () => 0 });
    const all = [...HALL_COLLIDERS, ...place.colliders];
    const from: Point = { x: HALL_DOOR.x - 10, y: HALL_DOOR.y + 1 };
    let a = from;
    for (const b of planPath(from, ASSEMBLY.stand, obstacles())) {
      const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.2);
      for (let i = 0; i <= n; i++) {
        const p = { x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n };
        for (const c of all) expect(inCollider(c, p.x, p.y, 0.4)).toBe(false);
      }
      a = b;
    }
    // Within reach of the bench's edge, facing it.
    expect(ASSEMBLY.bench.y - ASSEMBLY.bench.hy - ASSEMBLY.stand.y).toBeLessThan(0.8);
  });

  test("he's at the bench while his experiment is being built, and not once it's tested", () => {
    const g = { station: "field" as const, doing: "Building", experiment: "ex_AAAAAAAAAAAA", model: null, since: 0 };
    expect(buildingAt(g, [view()])).toMatchObject({ x: BENCH.stand.x, y: BENCH.stand.y, facing: Math.PI / 2 });
    expect(buildingAt(g, [view({ phase: "testing", status: "running" })])).toBeNull();
    // An older node's experiment that's starting is being built too.
    expect(buildingAt(g, [view({ phase: undefined })])).not.toBeNull();
    expect(buildingAt({ ...g, station: "observatory" }, [view()])).toBeNull();
    // On the bench: his, or else the newest being built that has bodies.
    const other = view({ id: "ex_BBBBBBBBBBBB", startedAt: 5 });
    expect(benchFor({ galahad: g, experiments: [other, view()] })!.id).toBe("ex_AAAAAAAAAAAA");
    expect(benchFor({ galahad: { ...g, experiment: null }, experiments: [view(), other] })!.id).toBe("ex_BBBBBBBBBBBB");
    expect(benchFor({ galahad: g, experiments: [view({ scene: [] })] })).toBeNull();
  });
});

describe("the kit", () => {
  const bounds = (a: Float32Array, add?: Float32Array) => {
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < a.length; i += 3) for (let c = 0; c < 3; c++) {
      const v = a[i + c]! + (add ? add[i + c]! : 0);
      lo[c] = Math.min(lo[c]!, v);
      hi[c] = Math.max(hi[c]!, v);
    }
    return { lo, hi };
  };

  test("assembled as its first frame stands, sized to the bench, standing on it; laid out first, each part on the bench", () => {
    const g = buildKit(view({ assembly: { pedestal: [0, 0, 0.25, 1, 0, 0, 0], upper: [0.25, 0, 0.55, 0.7071, 0, 0.7071, 0], hand: [0.5, 0, 0.55, 1, 0, 0, 0] } }))!;
    const pos = g.getAttribute("position").array as Float32Array;
    const kit = g.getAttribute("kit").array as Float32Array;
    const done = bounds(pos);
    // On the top (scene y up), within the bench's footprint; the ground plane isn't a part.
    expect(done.lo[1]).toBeCloseTo(0.005, 3);
    expect(done.hi[0]! - done.lo[0]!).toBeLessThanOrEqual(ASSEMBLY.bench.hx * 2);
    expect(done.hi[2]! - done.lo[2]!).toBeLessThanOrEqual(ASSEMBLY.bench.hy * 2);
    const laid = bounds(pos, kit);
    expect(laid.lo[1]).toBeGreaterThan(-0.001);
    expect(Math.max(Math.abs(laid.lo[0]!), Math.abs(laid.hi[0]!))).toBeLessThanOrEqual(ASSEMBLY.bench.hx + 0.3);
    // Three parts, in order.
    expect(new Set(g.getAttribute("slot").array as Float32Array)).toEqual(new Set([0, 0.5, 1]));
  });

  test("before it's known how they stand, the parts stay laid out; with nothing but a ground, there's no kit", () => {
    const g = buildKit(view())!;
    expect([...(g.getAttribute("kit").array as Float32Array)].every((v) => v === 0)).toBe(true);
    expect(buildKit(view({ scene: [{ id: "floor", shape: { kind: "plane", size: [4, 4] } }] }))).toBeNull();
  });
});
