import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { GatewayTokens } from "@galahad/brain";
import { STATIONS, type WorldEvent } from "@galahad/core";
import { GAZEBO_IMAGE, gatewayEnv, OWN_IMAGES } from "@galahad/sandbox";
import { cellAt, handleSandboxWorld, WorldHub } from "../src/world-hub.ts";

/*
 * The SANDBOX's node side: where Galahad is, the experiments on their plots, and how a
 * simulation in a sandbox reaches the world (its token to start, its key for frames).
 */

const box = { id: "base", shape: { kind: "box" as const, size: [1, 1, 0.2] as [number, number, number] } };
const origin = { nodeName: "ultra", sandbox: "0123456789", quest: null };

function hub(now = { t: 1_000_000 }) {
  const world = new WorldHub({ now: () => now.t });
  const events: WorldEvent[] = [];
  world.watch((e) => events.push(e));
  return { world, events, now };
}

describe("the world's plots", () => {
  test("never overlap, never on the keep, ring by ring", () => {
    const cells = Array.from({ length: 200 }, (_, n) => cellAt(n));
    expect(new Set(cells.map((c) => `${c.x},${c.y}`)).size).toBe(200);
    for (const c of cells) expect(Math.max(Math.abs(c.x), Math.abs(c.y))).toBeGreaterThanOrEqual(110);
    // Every station of the keep stays clear of the nearest plots (largest plot: 96 m).
    const nearest = Math.min(...cells.slice(0, 8).map((c) => Math.max(Math.abs(c.x), Math.abs(c.y)) - 48));
    for (const s of Object.values(STATIONS)) expect(Math.max(Math.abs(s.x), Math.abs(s.y))).toBeLessThan(nearest);
  });

  test("an experiment gets the next free plot, scaled to fit; ended ones free theirs only when pruned", () => {
    const { world } = hub();
    const a = world.start({ title: "Arm", engine: "mujoco", scene: [box], extent: 2 }, origin);
    const b = world.start({ title: "Flight", engine: "jsbsim", scene: [box], extent: 20_000, plot: "large" }, origin);
    expect(a.view.plot).toEqual({ x: 110, y: 0, size: 48 });
    expect(a.view.scale).toBe(1);
    expect(b.view.plot).toMatchObject({ x: 110, y: 110, size: 96 });
    expect(b.view.scale).toBeCloseTo((96 * 0.85) / 20_000, 10);
  });
});

describe("an experiment", () => {
  test("starts, runs on its frames (only with its key), ends; Galahad walks out to watch it", () => {
    const { world, events } = hub();
    const { id, key } = world.start({ title: "Pendulum", engine: "mujoco", scene: [box] }, origin);
    expect(events.map((e) => e.type)).toEqual(["experiment", "galahad", "thought"]);
    expect(events[1]).toMatchObject({ galahad: { station: "field", experiment: id } });
    expect(() => world.frames(id, "A".repeat(43), { frames: [{ t: 0, poses: {} }] })).toThrow(/not yours/);
    world.frames(id, key, { frames: [{ t: 0.05, poses: { base: [0, 0, 1, 1, 0, 0, 0] }, metrics: { angle: 0.3 } }] });
    expect(events.filter((e) => e.type === "frame")).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ type: "experiment", experiment: { status: "running", metrics: { angle: 0.3 } } });
    const ended = world.end(id, key, { status: "done", summary: "it swung up in 2.1 s" });
    expect(ended).toMatchObject({ status: "done", summary: "it swung up in 2.1 s" });
    expect(() => world.frames(id, key, { frames: [{ t: 1, poses: {} }] })).toThrow(/ended/);
  });

  test("at most 60 frames a second are passed on; the rest are dropped, not queued", () => {
    const { world, events } = hub();
    const { id, key } = world.start({ title: "Fast", engine: "custom", scene: [box] }, origin);
    const frames = Array.from({ length: 100 }, (_, i) => ({ t: i / 1000, poses: { base: [0, 0, 0, 1, 0, 0, 0] as [number, number, number, number, number, number, number] } }));
    expect(world.frames(id, key, { frames: frames.slice(0, 80) }).accepted).toBe(60);
    expect(world.frames(id, key, { frames: frames.slice(80) }).accepted).toBe(0);
    expect(events.filter((e) => e.type === "frame")).toHaveLength(60);
  });

  test("one that goes quiet for 90 seconds has stopped; a sandbox that's gone takes its own with it", () => {
    const { world, now } = hub();
    const quiet = world.start({ title: "Hung", engine: "custom", scene: [box] }, origin);
    const other = world.start({ title: "Other", engine: "custom", scene: [box] }, { ...origin, sandbox: "aaaaaaaaaa" });
    now.t += 91_000;
    world.quiet();
    expect((world.hello() as Extract<WorldEvent, { type: "hello" }>).experiments.find((e) => e.id === quiet.id)).toMatchObject({ status: "failed", summary: "it stopped sending frames" });
    const fresh = world.start({ title: "Fresh", engine: "custom", scene: [box] }, { ...origin, sandbox: "bbbbbbbbbb" });
    world.sandboxGone("bbbbbbbbbb");
    const all = (world.hello() as Extract<WorldEvent, { type: "hello" }>).experiments;
    expect(all.find((e) => e.id === fresh.id)!.status).toBe("failed");
    expect(all.find((e) => e.id === other.id)!.status).toBe("failed"); // quiet too
  });
});

describe("from a sandbox, through its gateway", () => {
  const tokens = new GatewayTokens(new Database(":memory:"));
  const world = new WorldHub();
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    handleSandboxWorld(new Request(`http://10.89.0.1:7779${path}`, { method: "POST", headers, body: JSON.stringify(body) }), { tokens, world, nodeName: "ultra" });
  const scene = [{ id: "rocket", shape: { kind: "rocket", radius: 0.1, length: 2 }, trail: true }];

  test("a token with the world scope starts one (and names its sandbox); others are refused", async () => {
    const { token } = tokens.mint({ label: "sandbox:0123456789", providers: ["world"], ttlMinutes: 10, maxRequests: 10 });
    const { token: modelsOnly } = tokens.mint({ label: "sandbox:9999999999", providers: ["deepseek"], ttlMinutes: 10, maxRequests: 10 });
    expect((await post("/world/experiments", { title: "Hop", engine: "rocketpy", scene }, { authorization: `Bearer ${modelsOnly}` })).status).toBe(401);
    const started = await post("/world/experiments", { title: "Hop", engine: "rocketpy", scene, extent: 3000 }, { authorization: `Bearer ${token}` });
    expect(started.status).toBe(200);
    const { id, key, scale } = (await started.json()) as { id: string; key: string; scale: number };
    expect(scale).toBeLessThan(1);
    expect((world.hello() as Extract<WorldEvent, { type: "hello" }>).experiments.find((e) => e.id === id)!.sandbox).toBe("0123456789");

    const frames = { frames: [{ t: 0.1, poses: { rocket: [0, 0, 5, 1, 0, 0, 0] }, metrics: { altitude_m: 5 } }] };
    expect((await post(`/world/experiments/${id}/frames`, frames, { "x-experiment-key": "wrong" })).status).toBe(404);
    expect((await post(`/world/experiments/${id}/frames`, frames, { "x-experiment-key": key })).status).toBe(200);
    expect((await post(`/world/experiments/${id}/end`, { status: "done", summary: "apogee 812 m" }, { "x-experiment-key": key })).status).toBe(200);
  });

  test("what it sends is checked: shapes, sizes, numbers", async () => {
    const { token } = tokens.mint({ label: "sandbox:0123456789", providers: ["world"], ttlMinutes: 10, maxRequests: 10 });
    const auth = { authorization: `Bearer ${token}` };
    const bad = [
      { title: "x", engine: "mujoco", scene: [{ id: "a", shape: { kind: "teapot" } }] },
      { title: "x", engine: "mujoco", scene: [{ id: "a b", shape: { kind: "sphere", radius: 1 } }] },
      { title: "x", engine: "mujoco", scene: [{ id: "a", shape: { kind: "mesh", vertices: [0, 0, 0], indices: [0, 1, 2] } }] },
      { title: "x", engine: "unity", scene: [{ id: "a", shape: { kind: "sphere", radius: 1 } }] },
    ];
    for (const body of bad) expect((await post("/world/experiments", body, auth)).status).toBe(400);
    const { id, key } = (await (await post("/world/experiments", { title: "ok", engine: "custom", scene: [{ id: "a", shape: { kind: "sphere", radius: 1 } }] }, auth)).json()) as { id: string; key: string };
    const nan = await handleSandboxWorld(
      new Request(`http://10.89.0.1:7779/world/experiments/${id}/frames`, { method: "POST", headers: { "x-experiment-key": key }, body: '{"frames":[{"t":0,"poses":{"a":[0,0,0,1,0,0,null]}}]}' }),
      { tokens, world, nodeName: "ultra" },
    );
    expect(nan.status).toBe(400);
  });

  test("a sandbox with a network is told where the world is", () => {
    const env = gatewayEnv("gw_token", ["world", "search"]);
    expect(env.GALAHAD_WORLD).toBe(env.GALAHAD_GATEWAY!.replace(/\/gw$/, "/world"));
    expect(env).not.toHaveProperty("OPENAI_BASE_URL");
    expect(gatewayEnv("gw_token", ["deepseek"])).not.toHaveProperty("GALAHAD_WORLD");
  });
});

describe("galahad_world, in the images", () => {
  test("the same module in the workshop and the Lab, and valid Python", () => {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");
    const repo = join(import.meta.dir, "..", "..", "..");
    const workshop = readFileSync(join(repo, "sandbox", "galahad_world.py"), "utf8");
    for (const image of ["lab", "gazebo"]) {
      expect(readFileSync(join(repo, "sandbox", image, "galahad_world.py"), "utf8")).toBe(workshop);
      expect(readFileSync(join(repo, "sandbox", image, "websearch"), "utf8")).toBe(readFileSync(join(repo, "sandbox", "websearch"), "utf8"));
    }
    const python = ["python3", "python"].find((p) => Bun.which(p));
    if (python) {
      for (const file of [join(repo, "sandbox", "galahad_world.py"), join(repo, "sandbox", "gazebo", "gz-check")]) {
        expect(Bun.spawnSync([python, "-c", `import ast,sys; ast.parse(open(sys.argv[1], encoding="utf8").read())`, file]).exitCode).toBe(0);
      }
    }
  });

  test("Gazebo is one of Galahad's own images: rebuilt when missing, kept from pruning", () => {
    expect(OWN_IMAGES[GAZEBO_IMAGE]).toEqual({ context: "gazebo", keeper: "galahad-gazebo-image" });
  });
});
