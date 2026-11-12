import { Database } from "bun:sqlite";
import { afterAll, describe, expect, jest, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GatewayTokens } from "@galahad/brain";
import { EXAMINE_MAX_MS, HOLD_MAX_MS, PADS, padKindFor, type Pose, SITES, STATIONS, type WorldEvent, type WorldQuest } from "@galahad/core";
import { GAZEBO_IMAGE, gatewayEnv, OWN_IMAGES } from "@galahad/sandbox";
import { ExperimentStore } from "../src/experiment-store.ts";
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
  test("starts (being built), runs on its frames (only with its key), ends; Galahad builds it, then goes out to watch it", () => {
    const { world, events } = hub();
    const { id, key } = world.start({ title: "Pendulum", engine: "mujoco", scene: [box] }, origin);
    expect(events.map((e) => e.type)).toEqual(["experiment", "galahad", "thought"]);
    expect(events[0]).toMatchObject({ experiment: { status: "starting", phase: "building" } });
    expect(events[1]).toMatchObject({ galahad: { station: "field", experiment: id } });
    expect(() => world.frames(id, "A".repeat(43), { frames: [{ t: 0, poses: {} }] })).toThrow(/not yours/);
    events.length = 0;
    world.frames(id, key, { frames: [{ t: 0.05, poses: { base: [0, 0, 1, 1, 0, 0, 0] }, metrics: { angle: 0.3 } }] });
    // Its first frame is the test: that's said first, then the frame.
    expect(events.map((e) => e.type)).toEqual(["experiment", "galahad", "thought", "frame"]);
    expect(events[0]).toMatchObject({ type: "experiment", experiment: { status: "running", phase: "testing" } });
    expect(events[1]).toMatchObject({ galahad: { station: "field", experiment: id, doing: "Testing: Pendulum" } });
    expect((world.hello() as Extract<WorldEvent, { type: "hello" }>).experiments[0]).toMatchObject({ metrics: { angle: 0.3 } });
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

describe("built, tested, examined", () => {
  const scene = [
    { id: "base", shape: { kind: "box" as const, size: [1, 1, 0.2] as [number, number, number] }, fixed: true },
    { id: "hand", shape: { kind: "sphere" as const, radius: 0.1 } },
  ];
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
  /** A hub that saves to a temp home's store; watched unless said otherwise. */
  function saving(watched = true) {
    const dir = mkdtempSync(join(tmpdir(), "galahad-world-"));
    dirs.push(dir);
    const store = new ExperimentStore({ dir, limits: { flushMs: 60_000 } });
    const now = { t: 1_000_000 };
    const world = new WorldHub({ now: () => now.t, store });
    const events: WorldEvent[] = [];
    if (watched) world.watch((e) => events.push(e));
    return { world, store, events, now };
  }
  const galahad = (events: WorldEvent[]) => (events.filter((e) => e.type === "galahad").at(-1) as Extract<WorldEvent, { type: "galahad" }>).galahad;

  test("watched: built at the bench (its first frame held while he gets there and puts it together), tested, examined at the observatory, done", async () => {
    jest.useFakeTimers();
    try {
      const { world, store, events, now } = saving();
      const examined: { headline: string | undefined; id: string }[] = [];
      world.onExamine((ex, e) => examined.push({ headline: ex?.headline, id: e.id }));
      const { id, key, view, build } = world.start({ title: "Arm", engine: "mujoco", scene, extent: 2 }, origin);
      // From the keep to the bench is a long way: the most the world ever holds a simulation back.
      expect(build).toBe(HOLD_MAX_MS / 1000);
      expect(view).toMatchObject({ phase: "building", status: "starting", build: { from: now.t, until: now.t + HOLD_MAX_MS } });
      expect(galahad(events)).toMatchObject({ station: "field", experiment: id, doing: "Building an experiment: Arm" });
      expect(world.phase(id, key, { phase: "building", poses: { hand: [0.5, 0, 1, 1, 0, 0, 0], ghost: [0, 0, 0, 1, 0, 0, 0] } }).assembly).toEqual({ hand: [0.5, 0, 1, 1, 0, 0, 0] });
      now.t += 20_000;
      expect(world.phase(id, key, { phase: "testing" })).toMatchObject({ phase: "testing", status: "running", assembly: null, phases: { testing: now.t } });
      expect(galahad(events)).toMatchObject({ station: "field", experiment: id, doing: "Testing: Arm" });
      world.frames(id, key, { frames: [{ t: 0, poses: { base: [0, 0, 0.1, 1, 0, 0, 0], hand: [0.5, 0, 1, 1, 0, 0, 0] }, metrics: { error_mm: 90 } }] });
      world.frames(id, key, { frames: [1, 2, 3, 4, 5, 6].map((t) => ({ t, poses: { hand: [0.5, 0, 1, 1, 0, 0, 0] as Pose }, metrics: { error_mm: 90 / (t + 1) } })) });
      now.t += 10_000;
      const ended = world.end(id, key, { status: "done", summary: "it tracked the circle" });
      expect(ended).toMatchObject({ phase: "examining", status: "done", endedAt: now.t });
      expect(galahad(events)).toMatchObject({ station: "observatory", experiment: id, doing: "Examining: Arm" });
      // The chalkboard's seam: the examination as data, as examining begins.
      expect(examined).toEqual([{ id, headline: expect.stringMatching(/^Arm finished: error \(mm\) fell from 90\.0 to 12\.9/) }]);
      // It's saved already (the panel, the tools and the CLI read it from here).
      expect(store.get(id)).toMatchObject({ status: "done", phase: "examining", readouts: { error_mm: { count: 7 } } });
      const settled = world.settled(id);
      // He walks from the test cell to the observatory, then examines it: held for that, at most a minute.
      jest.advanceTimersByTime(30_000);
      expect(world.current(id)).toMatchObject({ phase: "examining" });
      jest.advanceTimersByTime(EXAMINE_MAX_MS - 30_000);
      await settled;
      expect(world.current(id)).toMatchObject({ phase: "done" });
      expect(store.get(id)).toMatchObject({ phase: "done", phases: { ended: now.t } });
      expect(events.filter((e) => e.type === "thought").at(-1)).toMatchObject({ text: expect.stringMatching(/^Arm finished/) });
      // The world's list of saved ones follows.
      expect(events.filter((e) => e.type === "saved").at(-1)).toMatchObject({ saved: [{ id, phase: "done", readouts: { error_mm: expect.any(Number) } }] });
      expect((world.hello() as Extract<WorldEvent, { type: "hello" }>).saved?.map((s) => s.id)).toEqual([id]);
    } finally {
      jest.useRealTimers();
    }
  });

  test("the live stream is held to 60 frames a second; the record keeps every readout", () => {
    const { world, store, events } = saving();
    const { id, key } = world.start({ title: "Fast", engine: "custom", scene }, origin);
    const frames = Array.from({ length: 100 }, (_, i) => ({ t: i / 100, poses: { hand: [i / 100, 0, 1, 1, 0, 0, 0] as Pose }, metrics: { v: i } }));
    expect(world.frames(id, key, { frames }).accepted).toBe(60);
    expect(events.filter((e) => e.type === "frame")).toHaveLength(60);
    world.end(id, key, { status: "done" });
    expect(store.get(id)!.readouts.v).toMatchObject({ count: 100, max: 99, last: [0.99, 99] });
  });

  test("with nobody watching, nothing waits: no hold before the test, examined at once", () => {
    const { world, store } = saving(false);
    const { id, key, build } = world.start({ title: "Quick", engine: "custom", scene }, origin);
    expect(build).toBe(0);
    world.frames(id, key, { frames: [{ t: 0, poses: { hand: [0, 0, 1, 1, 0, 0, 0] } }] });
    expect(world.end(id, key, { status: "failed", summary: "diverged" })).toMatchObject({ phase: "failed", status: "failed" });
    expect(store.get(id)).toMatchObject({ phase: "failed", summary: "diverged" });
  });

  test("a run's draft: built while its sandbox spins up, filled in by its simulation's start, placed again by its real size", () => {
    const { world, events } = saving();
    const draft = world.draft({ title: "Gripper", engine: "mujoco" }, { ...origin, sandbox: null });
    expect(draft).toMatchObject({ phase: "building", scene: [], build: null, plot: { x: 110, y: 110, size: 48 } });
    expect(galahad(events)).toMatchObject({ station: "field", experiment: draft.id });
    world.attach(draft.id, "abcdef0123");
    // Quiet for long (a big image starting): the run ends it, not the sweep.
    world.quiet();
    // Another sandbox's experiment is its own; this sandbox's start is the draft's.
    const other = world.start({ title: "Other", engine: "custom", scene }, { ...origin, sandbox: "9999999999" });
    expect(other.id).not.toBe(draft.id);
    const filled = world.start({ title: "MuJoCo", engine: "mujoco", scene, extent: 2 }, { ...origin, sandbox: "abcdef0123" });
    expect(filled.id).toBe(draft.id);
    // Its title is the run's; its size now says it fits a test cell.
    expect(filled.view).toMatchObject({ title: "Gripper", scene, plot: { size: 10 }, phase: "building" });
    expect(filled.build).toBeGreaterThan(0);
  });

  test("a run's draft that never gets going fails, saying why, and is examined like any other", () => {
    const { world, store } = saving(false);
    const draft = world.draft({ title: "Broken", engine: "rocketpy" }, { ...origin, sandbox: null });
    world.keepCode(draft.id, "experiment.py", "raise SystemExit(3)\n");
    world.abandon(draft.id, "its script stopped before it started (exit 3)");
    expect(world.current(draft.id)).toMatchObject({ status: "failed", phase: "failed", summary: "its script stopped before it started (exit 3)" });
    expect(store.get(draft.id)).toMatchObject({ code: { name: "experiment.py" } });
    expect(store.examination(draft.id)!.notable).toContain("It sent no readouts.");
  });

  test("a sandbox that's gone ends what it left running; an experiment cleared while it's examined doesn't come back", async () => {
    jest.useFakeTimers();
    try {
      const { world, events } = saving();
      const a = world.start({ title: "First flight", engine: "jsbsim", scene, extent: 3000 }, origin);
      world.frames(a.id, a.key, { frames: [{ t: 0, poses: { hand: [0, 0, 1, 1, 0, 0, 0] } }] });
      world.sandboxGone(origin.sandbox!);
      expect(world.current(a.id)).toMatchObject({ status: "failed", phase: "examining", summary: "its sandbox stopped before it finished" });
      // The runway is wanted again while he's still examining the first.
      const b = world.start({ title: "Second flight", engine: "jsbsim", scene, extent: 3000 }, { ...origin, sandbox: "aaaaaaaaaa" });
      expect(events).toContainEqual(expect.objectContaining({ type: "cleared", experiment: a.id }));
      events.length = 0;
      jest.advanceTimersByTime(EXAMINE_MAX_MS);
      expect(events.some((e) => e.type === "experiment" && e.experiment.id === a.id)).toBe(false);
      expect(world.current(b.id)).toMatchObject({ phase: "building" });
    } finally {
      jest.useRealTimers();
    }
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

  test("phases and code: with the experiment's key only; the start says how long to hold its first frame", async () => {
    const { token } = tokens.mint({ label: "sandbox:0123456789", providers: ["world"], ttlMinutes: 10, maxRequests: 10 });
    world.watch(() => {});
    const started = (await (await post("/world/experiments", { title: "Arm", engine: "mujoco", scene: [{ id: "hand", shape: { kind: "sphere", radius: 0.1 } }], extent: 2 }, { authorization: `Bearer ${token}` })).json()) as { id: string; key: string; build: number };
    expect(started.build).toBeGreaterThan(0);
    const key = { "x-experiment-key": started.key };
    expect((await post(`/world/experiments/${started.id}/phase`, { phase: "building", poses: { hand: [0, 0, 1, 1, 0, 0, 0] } }, { "x-experiment-key": "wrong" })).status).toBe(404);
    expect((await post(`/world/experiments/${started.id}/phase`, { phase: "examining" }, key)).status).toBe(400);
    expect((await post(`/world/experiments/${started.id}/phase`, { phase: "building", poses: { hand: [0, 0, 1, 1, 0, 0, Number.MAX_VALUE * 2] } }, key)).status).toBe(400);
    expect(await (await post(`/world/experiments/${started.id}/phase`, { phase: "building", poses: { hand: [0, 0, 1, 1, 0, 0, 0] } }, key)).json()).toEqual({ phase: "building" });
    // This hub keeps no experiments: code has nowhere to go, and that's no error.
    expect((await post(`/world/experiments/${started.id}/code`, { name: "arm.py", source: "print('hi')\n" }, key)).status).toBe(200);
    expect((await post(`/world/experiments/${started.id}/code`, { name: "../../etc/passwd", source: "" }, key)).status).toBe(400);
    expect((await post(`/world/experiments/${started.id}/code`, { name: "big.py", source: "x".repeat(64 * 1024 + 1) }, key)).status).toBe(400);
    expect(await (await post(`/world/experiments/${started.id}/phase`, { phase: "testing" }, key)).json()).toEqual({ phase: "testing" });
    await post(`/world/experiments/${started.id}/end`, { status: "done" }, key);
    expect((await post(`/world/experiments/${started.id}/phase`, { phase: "testing" }, key)).status).toBe(409);
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

describe("the quests in hand, on his slate", () => {
  const quest = (step: number, over: Partial<WorldQuest> = {}): WorldQuest => ({ id: "q-1", by: "you", attempt: null, state: "working", title: "Write hi", plan: ["Write it."], doneWhen: "", step, maxSteps: 30, revisions: 0, gates: [], gatesPassed: 0, gatesFailed: 0, gatesTotal: 0, startedAt: 1, endedAt: null, silent: false, veiled: false, ...over });

  test("in hello; a quests event only when what's drawn changed", () => {
    const { world, events } = hub();
    expect(world.hello()).not.toHaveProperty("quests"); // a node with no quest board says nothing (as older ones do)
    let now: WorldQuest[] = [quest(1)];
    world.setQuests(() => now);
    expect(world.hello()).toMatchObject({ quests: [{ id: "q-1", step: 1 }] });
    world.questsChanged();
    expect(events.filter((e) => e.type === "quests")).toHaveLength(0);
    now = [quest(2)];
    world.questsChanged();
    world.questsChanged();
    now = [];
    world.questsChanged();
    expect(events.filter((e) => e.type === "quests").map((e) => (e.type === "quests" ? e.quests.map((q) => q.step) : null))).toEqual([[2], []]);
    world.close();
  });

  test("a source that throws is no quests, never a broken stream; with nobody watching nothing is sent", () => {
    const world = new WorldHub();
    world.setQuests(() => {
      throw new Error("no");
    });
    expect(world.hello()).toMatchObject({ quests: [] });
    world.questsChanged();
    world.close();
  });
});
