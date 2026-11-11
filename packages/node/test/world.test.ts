import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { GatewayTokens } from "@galahad/brain";
import { PADS, padKindFor, SITES, STATIONS, type WorldEvent } from "@galahad/core";
import { GAZEBO_IMAGE, gatewayEnv, OWN_IMAGES } from "@galahad/sandbox";
import { cellAt, cellOnSite, handleSandboxWorld, WorldHub } from "../src/world-hub.ts";

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

  test("on open land an experiment gets the next free plot, scaled to fit, and never one that crowds a site", () => {
    const { world } = hub();
    const a = world.start({ title: "Arm", engine: "mujoco", scene: [box], extent: 2, site: "open" }, origin);
    const b = world.start({ title: "Survey", engine: "custom", scene: [box], extent: 20_000, plot: "large" }, origin);
    // East of the keep is the hall's, west the proving ground's: the first free cells are to the north.
    expect(a.view.plot).toEqual({ x: 110, y: 110, size: 48 });
    expect(a.view.scale).toBe(1);
    expect(b.view.plot).toMatchObject({ x: 0, y: 110, size: 96 });
    expect(b.view.scale).toBeCloseTo((96 * 0.85) / 20_000, 10);
    expect(cellOnSite({ x: 110, y: 0 })).toBe(true);
    expect(cellOnSite({ x: -110, y: 0 })).toBe(true);
    expect(cellOnSite({ x: 0, y: -110 })).toBe(false);
    // Whatever the layout, no cell that's given out lets its largest plot reach a site.
    for (let n = 0; n < 120; n++) {
      const c = cellAt(n);
      if (cellOnSite(c)) continue;
      for (const s of Object.values(SITES)) expect(Math.abs(c.x - s.x) >= s.w / 2 + 48 || Math.abs(c.y - s.y) >= s.d / 2 + 48).toBe(true);
    }
  });
});

describe("the test sites", () => {
  const pad = (id: string) => {
    const p = PADS.find((x) => x.id === id)!;
    return { x: p.x, y: p.y, size: p.size };
  };

  test("aircraft fly over the runway, rockets leave the launch pad, bench tests go indoors, the rest stand on open land", () => {
    expect(padKindFor("jsbsim", 20_000)).toBe("flight");
    expect(padKindFor("rocketpy", 3000)).toBe("launch");
    expect(padKindFor("mujoco", 2)).toBe("cell");
    expect(padKindFor("custom", 8.5)).toBe("cell");
    expect(padKindFor("gazebo", 9)).toBeNull();
    expect(padKindFor("mujoco", undefined)).toBeNull();
    // Asked for, that's where it goes: a rover on the course, a big rig indoors, a small one outdoors.
    expect(padKindFor("gazebo", 30, "field")).toBe("course");
    expect(padKindFor("jsbsim", 20_000, "field")).toBe("flight");
    expect(padKindFor("custom", 40, "hall")).toBe("cell");
    expect(padKindFor("mujoco", 2, "open")).toBeNull();
    expect(padKindFor("jsbsim", 20_000, "open")).toBeNull();

    const { world } = hub();
    const flight = world.start({ title: "Circuits", engine: "jsbsim", scene: [box], extent: 3000, plot: "large" }, origin);
    const rocket = world.start({ title: "Mk II", engine: "rocketpy", scene: [box], extent: 900, plot: "large" }, origin);
    const arm = world.start({ title: "Arm", engine: "mujoco", scene: [box], extent: 2, plot: "small" }, origin);
    const rover = world.start({ title: "Rover", engine: "gazebo", scene: [box], extent: 60, site: "field" }, origin);
    const ramp = world.start({ title: "Ramp", engine: "gazebo", scene: [box], extent: 9 }, origin);
    expect(flight.view.plot).toEqual(pad("flight"));
    expect(flight.view.scale).toBeCloseTo((96 * 0.85) / 3000, 10);
    expect(rocket.view.plot).toEqual(pad("launch"));
    expect(arm.view.plot).toEqual(pad("cell-1"));
    expect(arm.view.scale).toBe(1);
    expect(rover.view.plot).toEqual(pad("course"));
    expect(rover.view.scale).toBeCloseTo((42 * 0.85) / 60, 10);
    expect(ramp.view.plot).toEqual({ x: 110, y: 110, size: 48 });
    // A view never says which pad or cell: the plot's place is all a renderer needs.
    expect(Object.keys(arm.view)).not.toContain("pad");
    expect(Object.keys(arm.view)).not.toContain("cell");
  });

  test("a pad in use sends the next one on: to the next cell indoors, to open land when the site has no more", () => {
    const { world } = hub();
    const cells = [1, 2, 3, 4, 5].map((n) => world.start({ title: `Bench ${n}`, engine: "mujoco", scene: [box], extent: 1 }, origin).view.plot);
    expect(cells.slice(0, 4)).toEqual([pad("cell-1"), pad("cell-2"), pad("cell-3"), pad("cell-4")]);
    expect(cells[4]).toEqual({ x: 110, y: 110, size: 48 });
    world.start({ title: "First flight", engine: "jsbsim", scene: [box], extent: 3000 }, origin);
    expect(world.start({ title: "Second flight", engine: "jsbsim", scene: [box], extent: 3000, plot: "large" }, origin).view.plot).toEqual({ x: 0, y: 110, size: 96 });
  });

  test("an ended experiment is cleared from its pad when the next one needs it, and watchers are told", () => {
    const { world, events } = hub();
    const first = world.start({ title: "First flight", engine: "jsbsim", scene: [box], extent: 3000 }, origin);
    world.end(first.id, first.key, { status: "done", summary: "three circuits" });
    // It stays on the runway, ended, until the runway is wanted.
    expect((world.hello() as Extract<WorldEvent, { type: "hello" }>).experiments.map((e) => e.id)).toEqual([first.id]);
    events.length = 0;
    const second = world.start({ title: "Second flight", engine: "jsbsim", scene: [box], extent: 3000 }, origin);
    expect(second.view.plot).toEqual(pad("flight"));
    expect(events[0]).toMatchObject({ type: "cleared", experiment: first.id });
    expect(events[1]).toMatchObject({ type: "experiment", experiment: { id: second.id } });
    expect((world.hello() as Extract<WorldEvent, { type: "hello" }>).experiments.map((e) => e.id)).toEqual([second.id]);
    // Its key no longer opens anything.
    expect(() => world.frames(first.id, first.key, { frames: [{ t: 1, poses: {} }] })).toThrow(/not yours/);
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
