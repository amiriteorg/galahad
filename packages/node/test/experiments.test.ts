import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ExecResult, type ExperimentRunResult, type RouteName, routes, type SandboxView } from "@galahad/core";
import { foundFleet, MindStore } from "@galahad/mind";
import type { CreateInput } from "@galahad/sandbox";
import { z } from "zod";
import type { Capabilities } from "../src/capabilities.ts";
import { type Daemon, startDaemon } from "../src/daemon.ts";
import { ExperimentStore } from "../src/experiment-store.ts";
import { runExperiment, type RunHost } from "../src/experiment-run.ts";
import { Home } from "../src/home.ts";
import { chatTools, type GalahadTool, type ToolApi, TOOLS } from "../src/tools.ts";
import { WorldHub } from "../src/world-hub.ts";

/*
 * Saved experiments through the node's API (each route's one scope, its input checked), a run of
 * experiment_run against a stand-in sandbox host that plays the Python module's part, and Galahad's
 * three experiment tools. A real daemon in a temp home; never the OS keychain or a real ~/.galahad.
 */

const caps: Capabilities = { os: "linux", arch: "x64", hostname: "exp-test", cores: 4, cpu: "test", memoryGb: 8, hasBattery: false, gpu: [], docker: false, vm: { kvm: false, tools: [] }, tools: [], localModels: [], tailscale: null };
const freePort = () => {
  const s = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() });
  const port = s.port!;
  s.stop(true);
  return port;
};
const root = mkdtempSync(join(tmpdir(), "galahad-exp-"));
const home = new Home(join(root, "node"));
const port = freePort();
let daemon: Daemon;

async function call(name: RouteName, input: unknown, token: string) {
  const route = routes[name];
  return fetch(`http://127.0.0.1:${port}${route.path}`, {
    method: route.method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: route.method === "POST" ? JSON.stringify(input ?? {}) : undefined,
  });
}

const scene = [
  { id: "base", shape: { kind: "box" as const, size: [1, 1, 0.2] as [number, number, number] }, fixed: true },
  { id: "hand", shape: { kind: "sphere" as const, radius: 0.1 } },
];
/** An experiment, as a sandbox's module would run it, straight into the daemon's world. */
function experiment(world: WorldHub, title: string, sandbox = "0123456789") {
  const e = world.start({ title, engine: "mujoco", scene, extent: 2 }, { nodeName: "exp-node", sandbox, quest: null });
  for (let i = 0; i < 20; i++) world.frames(e.id, e.key, { frames: [{ t: i / 10, poses: { ...(i ? {} : { base: [0, 0, 0.1, 1, 0, 0, 0] as const }), hand: [i / 20, 0, 1, 1, 0, 0, 0] }, metrics: { error_mm: 50 / (i + 1) } }] as never });
  world.end(e.id, e.key, { status: "done", summary: "it held" });
  return e.id;
}

beforeAll(async () => {
  const { identity, keystore } = await home.createIdentity("file");
  const store = new MindStore(home.mindPath);
  const fleet = foundFleet(store, identity, { fleetName: "camelot", nodeName: "exp-node" });
  store.close();
  home.writeConfig({ v: 1, name: "exp-node", fleet, port, keystore, advertise: "127.0.0.1" });
  daemon = await startDaemon(home, { capabilities: caps, proxyPort: freePort(), log: () => {}, defaultHeartbeat: false });
});

afterAll(async () => {
  await daemon?.stop();
  rmSync(root, { recursive: true, force: true });
});

describe("saved experiments through the API", () => {
  test("listed and read by you and by agents (the world's scope); pinned and deleted by you alone", async () => {
    const admin = home.adminToken();
    const id = experiment(daemon.world, "Bench rig");
    const { token: arm } = (await (await call("mintArm", { label: "helper" }, admin)).json()) as { token: string };

    for (const token of [admin, arm]) {
      const list = (await (await call("experiments", undefined, token)).json()) as { node: string; experiments: { id: string; title: string }[]; total: number };
      expect(list).toMatchObject({ node: "exp-node", total: 1, experiments: [{ id, title: "Bench rig" }] });
      const got = (await (await call("experiment", { id }, token)).json()) as { experiment: { status: string; phase: string }; examination: { readouts: { key: string; trend: string }[] } };
      expect(got.experiment).toMatchObject({ status: "done", phase: "done" });
      expect(got.examination.readouts[0]).toMatchObject({ key: "error_mm", trend: "falling" });
      const page = (await (await call("experimentRecording", { id, limit: 5 }, token)).json()) as { frames: number[][]; next: number | null; bodies: string[] };
      expect(page).toMatchObject({ bodies: ["base", "hand"], next: 5 });
      expect(page.frames).toHaveLength(5);
    }
    // An agent holds mind:write, but pinning is yours; deleting needs fleet:admin, which no agent holds.
    expect(await (await call("pinExperiment", { id, pinned: true }, arm)).json()).toEqual({ error: "only you pin saved experiments" });
    expect((await call("deleteExperiment", { id }, arm)).status).toBe(403);
    expect((await call("pinExperiment", { id, pinned: true }, admin)).status).toBe(200);
    expect((await call("deleteExperiment", { id }, admin)).status).toBe(200);
    expect((await call("experiment", { id }, admin)).status).toBe(404);
  });

  test("every input is checked: ids, pages, code only when asked", async () => {
    const admin = home.adminToken();
    expect((await call("experiment", { id: "../etc/passwd" }, admin)).status).toBe(400);
    expect((await call("experiment", { id: "ex_AAAAAAAAAAAA", extra: 1 }, admin)).status).toBe(400);
    expect((await call("experimentRecording", { id: "ex_AAAAAAAAAAAA", from: -1 }, admin)).status).toBe(400);
    expect((await call("experimentRecording", { id: "ex_AAAAAAAAAAAA" }, admin)).status).toBe(404);
    expect((await call("pinExperiment", { id: "ex_AAAAAAAAAAAA" }, admin)).status).toBe(400);
    const id = experiment(daemon.world, "With code");
    daemon.world.keepCode(id, "rig.py", "print('rig')\n");
    expect(await (await call("experiment", { id }, admin)).json()).not.toHaveProperty("code");
    expect(((await (await call("experiment", { id, code: true }, admin)).json()) as { code: unknown }).code).toEqual({ name: "rig.py", source: "print('rig')\n" });
    // Running one needs a sandbox host: this node isn't one, and there's none in its fleet.
    const run = await call("runExperiment", { title: "x", engine: "custom", script: "print(1)" }, admin);
    expect(run.status).toBe(424);
    expect((await call("runExperiment", { title: "x", engine: "isaac", script: "print(1)" }, admin)).status).toBe(400);
    expect((await call("runExperiment", { title: "x", engine: "custom", script: "print(1)", minutes: 61 }, admin)).status).toBe(400);
  });

  test("after a restart of the node, its saved experiments are still listed", async () => {
    const admin = home.adminToken();
    const id = experiment(daemon.world, "Survives a restart");
    await daemon.stop();
    daemon = await startDaemon(home, { capabilities: caps, proxyPort: freePort(), log: () => {}, defaultHeartbeat: false });
    const list = (await (await call("experiments", undefined, admin)).json()) as { experiments: { id: string }[] };
    expect(list.experiments.map((e) => e.id)).toContain(id);
    // And the world offers it to replay.
    expect((daemon.world.hello() as { saved?: { id: string }[] }).saved?.map((s) => s.id)).toContain(id);
  });
});

describe("a run: built, tested, examined (the sandbox host stood in for)", () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
  function setup(script: (world: WorldHub, sandbox: string) => ExecResult | Promise<ExecResult>, opts: { failCreate?: boolean } = {}) {
    const dir = mkdtempSync(join(tmpdir(), "galahad-run-"));
    dirs.push(dir);
    const world = new WorldHub({ store: new ExperimentStore({ dir, limits: { flushMs: 60_000 } }) });
    const calls: { created: CreateInput[]; exec: string[][]; destroyed: { id: string; quest?: string }[] } = { created: [], exec: [], destroyed: [] };
    const host: RunHost = {
      async create(input) {
        calls.created.push(input);
        if (opts.failCreate) throw new Error("no room on the host's disk");
        return { id: "abcdef0123", node: "node-1", quest: input.quest ?? "", image: "galahad/lab:1", network: input.network } as SandboxView;
      },
      async exec(id, cmd) {
        calls.exec.push(cmd);
        if (cmd[0] === "python3") return { exitCode: 0, stdout: "", stderr: "", durationMs: 5, truncated: false };
        return script(world, id);
      },
      async destroy(id, o) {
        calls.destroyed.push({ id, ...o });
        return { verdict: "allow" };
      },
    };
    return { world, host, calls, run: (input: Parameters<typeof runExperiment>[1], owner = {}) => runExperiment({ sandbox: host, world, nodeName: "node-1" }, input, owner) };
  }
  /** The module's part: start (through the sandbox's gateway, so the sandbox is known), say its phases, frames, end. */
  const module = (world: WorldHub, sandbox: string, end: "done" | "failed" | null = "done") => {
    const e = world.start({ title: "MuJoCo", engine: "mujoco", scene, extent: 2 }, { nodeName: "node-1", sandbox, quest: null });
    world.phase(e.id, e.key, { phase: "building", poses: { hand: [0, 0, 1, 1, 0, 0, 0] } });
    world.phase(e.id, e.key, { phase: "testing" });
    for (let i = 0; i < 30; i++) world.frames(e.id, e.key, { frames: [{ t: i / 10, poses: { hand: [i / 30, 0, 1, 1, 0, 0, 0] }, metrics: { error_mm: 40 * Math.exp(-i / 5) } }] });
    if (end) world.end(e.id, e.key, { status: end, summary: "it tracked the target" });
    return e.id;
  };
  const script = "import galahad_world as gw\n# a two-link arm\n";

  test("the right image, the gateway only, its own quest; his script goes in; the draft is the experiment; examined; the sandbox destroyed", async () => {
    let started = "";
    const { run, calls, world } = setup((w, sandbox) => {
      started = module(w, sandbox);
      return { exitCode: 0, stdout: "done\n", stderr: 'galahad_world: "MuJoCo" is on its plot\n', durationMs: 3000, truncated: false };
    });
    const out = await run({ title: "Two-link arm", engine: "mujoco", script });
    expect(calls.created[0]).toMatchObject({ network: "gateway", lab: true, persistent: false });
    expect(calls.created[0]!.providers ?? []).toEqual([]);
    expect(calls.created[0]!.quest).toBe(`experiment.${out.experiment!.id}`);
    // The script goes in as base64, never through a shell.
    expect(calls.exec[0]!.slice(0, 2)).toEqual(["python3", "-c"]);
    expect(Buffer.from(calls.exec[0]!.at(-1)!, "base64").toString()).toBe(script);
    expect(calls.exec[1]).toEqual(["sh", "-c", "cd /work && exec python3 -u /work/experiment.py"]);
    expect(calls.destroyed).toEqual([{ id: "abcdef0123", quest: `experiment.${out.experiment!.id}` }]);
    expect(started).toBe(out.experiment!.id);
    expect(out).toMatchObject({ experiment: { title: "Two-link arm", status: "done", phase: "done", code: true }, exitCode: 0, sandbox: "abcdef0123", others: [] });
    expect(out.examination!.readouts[0]).toMatchObject({ key: "error_mm", trend: "falling" });
    expect(world.store!.code(out.experiment!.id)).toEqual({ name: "experiment.py", source: script });
  });

  test("Gazebo's own image for Gazebo; an arm's run is its quest's", async () => {
    const { run, calls } = setup((w, sandbox) => (module(w, sandbox), { exitCode: 0, stdout: "", stderr: "", durationMs: 1, truncated: false }));
    await run({ title: "Ramp", engine: "gazebo", script }, { quest: "arm.galahad" });
    expect(calls.created[0]).toMatchObject({ gazebo: true, quest: "arm.galahad" });
    expect(calls.created[0]).not.toHaveProperty("lab");
    expect(calls.destroyed[0]!.quest).toBe("arm.galahad");
  });

  test("a script that fails before it starts its experiment: failed, saying why (its error, any secret in it redacted), examined", async () => {
    const leak = `sk-ant-api03-${"A".repeat(90)}`;
    const { run } = setup(() => ({ exitCode: 1, stdout: "", stderr: `Traceback (most recent call last):\n  File "/work/experiment.py", line 3\nNameError: name '${leak}' is not defined\n`, durationMs: 40, truncated: false }));
    const out = await run({ title: "Typo", engine: "custom", script });
    expect(out.experiment).toMatchObject({ status: "failed", phase: "failed" });
    expect(out.experiment!.summary).toMatch(/^its script stopped before it started \(exit 1\): NameError: name/);
    expect(out.experiment!.summary).not.toContain(leak);
    expect(out.stderr).not.toContain(leak);
    expect(out.examination!.notable[0]).toMatch(/^It failed: its script stopped before it started/);
  });

  test("its sandbox couldn't start; it ran out of time: failed, examined, and nothing left running", async () => {
    const a = setup(() => ({ exitCode: 0, stdout: "", stderr: "", durationMs: 0, truncated: false }), { failCreate: true });
    const failed = await a.run({ title: "No room", engine: "mujoco", script });
    expect(failed).toMatchObject({ experiment: { status: "failed", summary: "its sandbox couldn't start: no room on the host's disk" }, exitCode: null, sandbox: null });
    expect(a.calls.exec).toEqual([]);

    const b = setup((w, sandbox) => (module(w, sandbox, null), { exitCode: 137, stdout: "", stderr: "", durationMs: 600_000, truncated: false }));
    const late = await b.run({ title: "Too long", engine: "mujoco", script, minutes: 10 });
    expect(late.experiment).toMatchObject({ status: "failed", phase: "failed", summary: "it ran out of time (10 min)" });
    expect(b.world.experimentsOf("abcdef0123").every((e) => e.endedAt !== null)).toBe(true);
  });
});

describe("Galahad's experiment tools", () => {
  const explain = (e: unknown) => (e as Error).message;
  const result: ExperimentRunResult = {
    experiment: { id: "ex_AAAAAAAAAAAA", title: "Two-link arm", engine: "mujoco", status: "done", phase: "done", startedAt: 0, endedAt: 20_000, nodeName: "ultra", plot: { x: 112, y: 11, size: 10 }, summary: "it tracked the circle", pinned: false, bytes: 1, frames: 300, duration: 20, readouts: { error_mm: 3.4 }, code: true },
    examination: {
      id: "ex_AAAAAAAAAAAA",
      title: "Two-link arm",
      engine: "mujoco",
      status: "done",
      duration: 20,
      summary: "it tracked the circle",
      readouts: [{ key: "error_mm", label: "error (mm)", count: 500, min: 2.8, max: 92.1, tMin: 14, tMax: 0, first: 92.1, final: 3.4, trend: "falling", ranAway: false, series: [], sentence: "error (mm) fell from 92.1 to 3.40." }],
      notable: ["In its own words: it tracked the circle."],
      headline: "Two-link arm finished: error (mm) fell from 92.1 to 3.40.",
      words: "Two-link arm (MuJoCo) finished after 20 s of simulation. error (mm) fell from 92.1 to 3.40.",
    },
    others: [],
    node: "ultra",
    sandbox: "abcdef0123",
    exitCode: 0,
    durationMs: 23_400,
    stdout: "",
    stderr: "galahad_world: building\n",
  };

  test("experiment_run says what it found: the experiment, where it was tested, the examination, how the script went", async () => {
    const reached: { name: string; input: unknown }[] = [];
    const api: ToolApi = { call: async <T,>(name: string, input?: unknown) => (reached.push({ name, input }), result as T), bytes: async () => ({ bytes: new Uint8Array(), type: "" }) };
    const tools = chatTools(TOOLS, api, explain);
    const out = await tools.run({ id: "1", name: "experiment_run", input: { title: "Two-link arm", engine: "mujoco", script: "import galahad_world" } });
    expect(reached).toEqual([{ name: "runExperiment", input: { title: "Two-link arm", engine: "mujoco", script: "import galahad_world" } }]);
    expect(out.content).toContain('ex_AAAAAAAAAAAA: "Two-link arm" (mujoco) finished: built in the workshop, tested in the workshop (cell-1), examined at the observatory; saved on ultra.');
    expect(out.content).toContain("Examination: Two-link arm (MuJoCo) finished after 20 s of simulation.");
    expect(out.content).toContain("- error (mm): 92.1 → 3.40 (range 2.80 to 92.1), falling");
    expect(out.content).toContain("Script: exit 0 after 23.4 s in sandbox abcdef0123 (destroyed).");
    expect((await tools.run({ id: "2", name: "experiment_run", input: { title: "x", engine: "isaac", script: "y" } })).isError).toBe(true);
  });

  test("once bank data is in the answer, running one is refused (it reaches out); reading saved ones isn't", async () => {
    const fakeBank: GalahadTool = { name: "bank_balances", title: "b", description: "b", input: { q: z.string().optional() }, routes: ["bankBalances"], flow: "private", run: async () => "{}" };
    const reached: string[] = [];
    const api: ToolApi = {
      call: async <T,>(name: string) => {
        reached.push(name);
        return (name === "experiments" ? { node: "ultra", experiments: [result.experiment], total: 1, bytes: 1, budget: 512 * 2 ** 20 } : { experiment: { ...result.experiment, phases: { building: 0, testing: 1000, examining: 20_000, ended: 30_000 }, recording: { frames: 300, truncated: null }, code: null }, examination: result.examination }) as T;
      },
      bytes: async () => ({ bytes: new Uint8Array(), type: "" }),
    };
    const tools = chatTools([fakeBank, ...TOOLS.filter((t) => t.name.startsWith("experiment"))], api, explain);
    await tools.run({ id: "0", name: "bank_balances", input: {} });
    expect(await tools.run({ id: "1", name: "experiment_run", input: { title: "x", engine: "custom", script: "y" } })).toMatchObject({ isError: true, summary: "refused: bank data is in this answer" });
    const list = await tools.run({ id: "2", name: "experiments", input: {} });
    expect(list.content).toContain("1 saved on ultra");
    expect(list.content).toContain("- ex_AAAAAAAAAAAA 1970-01-01 00:00 · Two-link arm (mujoco) · done · in the workshop (cell-1) · 20 s simulated · error (mm) 3.40");
    const examined = await tools.run({ id: "3", name: "experiment_examine", input: { id: "ex_AAAAAAAAAAAA" } });
    expect(examined.content).toContain("Examination: Two-link arm (MuJoCo) finished");
    expect(examined.content).toContain("- error (mm): 92.1 → 3.40, range 2.80 (at 14 s) to 92.1 (at 0 s), falling, 500 sample(s)");
    expect(reached).toEqual(["experiments", "experiment"]);
    // Their flows, as the bank's gate reads them.
    expect(Object.fromEntries(TOOLS.filter((t) => t.name.startsWith("experiment")).map((t) => [t.name, t.flow ?? null]))).toEqual({ experiment_run: "egress", experiments: null, experiment_examine: null });
  });
});
