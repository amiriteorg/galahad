import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newNodeIdentity, type RouteName, routes, type SelfActionView } from "@galahad/core";
import { foundFleet, MindStore } from "@galahad/mind";
import type { Capabilities } from "../src/capabilities.ts";
import { type Daemon, ensureReflection, startDaemon } from "../src/daemon.ts";
import { Home } from "../src/home.ts";
import { loopRecords } from "../src/loops.ts";

/*
 * His heartbeat, self-action and the daily reflection, against a real daemon in a
 * temp home with a stand-in model and a stand-in service: the founding node's default
 * loops, the owner's switch (and that agents can't touch it), the heartbeat and the
 * agents with him in the world's stream, a fix he makes himself, and a reflection.
 */

const caps: Capabilities = {
  os: "linux",
  arch: "x64",
  hostname: "life-test",
  cores: 4,
  cpu: "test",
  memoryGb: 8,
  hasBattery: false,
  gpu: [],
  docker: false,
  vm: { kvm: false, tools: [] },
  tools: [],
  // The stand-in model on loopback counts as a local runtime this node serves.
  localModels: [{ runtime: "stand-in", models: ["m"] }],
  tailscale: null,
};

const freePort = () => {
  const s = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() });
  const port = s.port!;
  s.stop(true);
  return port;
};

const root = mkdtempSync(join(tmpdir(), "galahad-life-"));
const home = new Home(join(root, "node"));
const port = freePort();
let daemon: Daemon;

/** The stand-in model: what it was asked, and its answer. */
const asked: string[] = [];
const model = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch: async (req) => {
    const body = (await req.json()) as { messages: { content: string }[] };
    asked.push(body.messages.map((m) => m.content).join("\n"));
    const text = "Happened: a quiet day on the keep.\nLearned: the site wobbles now and then.\nNext:\n- Ask the owner whether to watch the site hourly";
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
  },
});

/** A stand-in service whose status page is down the first time it's asked, then fine. */
let hits = 0;
const service = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => (++hits === 1 ? new Response("down", { status: 503 }) : Response.json({ status: "up" })) });

async function call(name: RouteName, input: unknown, token = home.adminToken()) {
  const route = routes[name];
  return fetch(`http://127.0.0.1:${port}${route.path}`, {
    method: route.method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: route.method === "POST" ? JSON.stringify(input ?? {}) : undefined,
  });
}
const json = async <T,>(response: Response): Promise<T> => {
  expect(response.status).toBe(200);
  return (await response.json()) as T;
};
const arm = async (label: string) => (await json<{ token: string }>(await call("mintArm", { label }))).token;

/** Reads the world's stream while `during` runs, until `until` holds (or 5 s pass). */
async function watchWorld(during: () => Promise<unknown>, until: (events: any[]) => boolean): Promise<any[]> {
  const controller = new AbortController();
  const response = await fetch(`http://127.0.0.1:${port}/api/world`, { headers: { authorization: `Bearer ${home.adminToken()}` }, signal: controller.signal });
  expect(response.status).toBe(200);
  const reader = response.body!.getReader();
  const events: any[] = [];
  let buffer = "";
  const reading = (async () => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !until(events)) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += new TextDecoder().decode(value);
      for (let i = buffer.indexOf("\n\n"); i >= 0; i = buffer.indexOf("\n\n")) {
        const chunk = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        if (chunk.startsWith("data: ")) events.push(JSON.parse(chunk.slice(6)));
      }
    }
  })();
  await new Promise((r) => setTimeout(r, 50));
  await during();
  await reading;
  controller.abort();
  return events;
}

beforeAll(async () => {
  const { identity, keystore } = await home.createIdentity("file");
  const store = new MindStore(home.mindPath);
  const fleet = foundFleet(store, identity, { fleetName: "camelot", nodeName: "life-node" });
  store.close();
  home.writeConfig({ v: 1, name: "life-node", fleet, port, keystore, advertise: "127.0.0.1" });
  daemon = await startDaemon(home, { capabilities: caps, proxyPort: freePort(), log: () => {}, loopIntervalMs: 60_000 });
  expect((await call("setProvider", { id: "stand-in", kind: "openai", baseUrl: `http://127.0.0.1:${model.port}/v1` })).status).toBe(200);
  for (const role of ["swift", "planner"]) expect((await call("setRoster", { role, models: ["stand-in/m"] })).status).toBe(200);
});

afterAll(async () => {
  await daemon?.stop();
  model.stop(true);
  service.stop(true);
  rmSync(root, { recursive: true, force: true });
});

describe("the founding node's default loops", () => {
  test("a heartbeat every 30 minutes and a reflection each evening in Denmark, on the same always-on node", () => {
    const loops = loopRecords(daemon.store);
    const beat = loops.find((l) => l.name === "heartbeat")!;
    const reflect = loops.find((l) => l.name === "reflect")!;
    expect(beat.task).toEqual({ kind: "heartbeat" });
    expect(reflect).toMatchObject({ scheduleText: "30 21 * * *", tz: "Europe/Copenhagen", on: beat.on, task: { kind: "reflect" } });
  });

  test("the reflection is created once: removed, it stays removed; a node that didn't found the fleet never creates it", () => {
    const a = newNodeIdentity();
    const store = new MindStore(":memory:");
    foundFleet(store, a, { fleetName: "camelot", nodeName: "ultra" });
    ensureReflection(store, a);
    ensureReflection(store, a);
    expect(store.loopRuns("reflect")).toEqual([]);
    expect(loopRecords(store).filter((l) => l.name === "reflect")).toHaveLength(1);
    store.emit(a, "loop.removed", { name: "reflect" });
    ensureReflection(store, a);
    expect(loopRecords(store).filter((l) => l.name === "reflect")).toHaveLength(0);
    const other = new MindStore(":memory:");
    foundFleet(other, newNodeIdentity(), { fleetName: "x", nodeName: "y" });
    ensureReflection(other, a);
    expect(loopRecords(other)).toHaveLength(0);
  });
});

describe("the owner's self-action switch", () => {
  test("on by default; only you turn it off (brain:write), never an agent; changing the heartbeat keeps it", async () => {
    expect((await json<SelfActionView>(await call("selfAction", undefined))).on).toBe(true);
    const agent = await arm("busybody");
    // An agent can read it (mind:read) but never set it.
    expect((await call("selfAction", undefined, agent)).status).toBe(200);
    expect((await call("setSelfAction", { on: false }, agent)).status).toBe(403);
    expect(routes.setSelfAction.scope).toBe("brain:write");

    const off = await json<SelfActionView>(await call("setSelfAction", { on: false }));
    expect(off).toMatchObject({ on: false, heartbeats: ["heartbeat"] });
    expect(off.allowlist.map((a) => a.kind).sort()).toEqual(["reap-sandbox", "refresh-weather", "retry-loop"]);
    expect(loopRecords(daemon.store).find((l) => l.name === "heartbeat")!.task).toEqual({ kind: "heartbeat", selfAction: false });
    // Giving the heartbeat a checklist doesn't quietly turn it back on.
    await json(await call("setLoop", { name: "heartbeat", task: { kind: "heartbeat", checklist: "Is the backup there?" } }));
    expect(loopRecords(daemon.store).find((l) => l.name === "heartbeat")!.task).toEqual({ kind: "heartbeat", checklist: "Is the backup there?", selfAction: false });

    const on = await json<SelfActionView>(await call("setSelfAction", { on: true }));
    expect(on.on).toBe(true);
    // On is the default: the field is gone again, so the task reads as it always did.
    expect(loopRecords(daemon.store).find((l) => l.name === "heartbeat")!.task).toEqual({ kind: "heartbeat", checklist: "Is the backup there?" });
    await json(await call("setLoop", { name: "heartbeat", task: { kind: "heartbeat" } }));
  });
});

describe("after a heartbeat", () => {
  test("a read-only loop that went wrong once is checked again by Galahad himself, and that's in the ledger as his own", async () => {
    const manifest = {
      id: "site",
      label: "Site",
      origin: `http://127.0.0.1:${service.port}`,
      tools: { status: { description: "Is it up?", method: "GET", path: "/status", params: {}, class: "read" } },
    };
    await json(await call("setConnector", { id: "site", manifest }));
    await json(await call("setLoop", { name: "site", schedule: "every 6h", task: { kind: "call", connector: "site", tool: "status" } }));
    await json(await call("runLoop", { name: "site" }));
    await daemon.loops.settled("site");
    expect(daemon.store.loopRuns("site", 1)[0]!.body.status).toBe("attention");

    const events = await watchWorld(
      async () => {
        await json(await call("runLoop", { name: "heartbeat" }));
        await daemon.loops.settled("heartbeat");
        await daemon.loops.settled("site");
      },
      (seen) => seen.some((e) => e.type === "heartbeat" && e.heartbeat?.fixed?.length),
    );
    // He ran it again, and this time it was fine.
    expect(hits).toBe(2);
    expect(daemon.store.loopRuns("site", 1)[0]!.body.status).toBe("ok");
    const beat = daemon.store.loopRuns("heartbeat", 1)[0]!.body;
    expect(beat.summary).toContain("Fixed himself: Ran loop site again after one bad run");
    const view = await json<SelfActionView>(await call("selfAction", undefined));
    expect(view.recent[0]).toMatchObject({ class: "read", resource: "self-action", quest: "galahad.self", detail: "Ran loop site again after one bad run" });
    expect(view.recent[0]!.target).toMatch(/^retry-loop:site:/);
    // The world heard the heartbeat, with what he fixed.
    expect(events[0]).toMatchObject({ type: "hello", heartbeat: expect.anything(), partners: [] });
    const heard = events.find((e) => e.type === "heartbeat" && e.heartbeat?.fixed?.length);
    expect(heard.heartbeat).toMatchObject({ status: expect.any(String), fixed: ["Ran loop site again after one bad run"], selfAction: true });
    expect(heard.heartbeat.ran).toBeGreaterThan(0);

    // A second heartbeat leaves it alone: one retry for one bad run.
    await json(await call("runLoop", { name: "heartbeat" }));
    await daemon.loops.settled("heartbeat");
    expect(hits).toBe(2);
  });

  test("with self-action off he only reports", async () => {
    await json(await call("setSelfAction", { on: false }));
    hits = 0;
    await json(await call("runLoop", { name: "site" }));
    await daemon.loops.settled("site");
    expect(daemon.store.loopRuns("site", 1)[0]!.body.status).toBe("attention");
    await json(await call("runLoop", { name: "heartbeat" }));
    await daemon.loops.settled("heartbeat");
    await daemon.loops.settled("site");
    expect(hits).toBe(1);
    expect(daemon.store.loopRuns("heartbeat", 1)[0]!.body.summary).not.toContain("Fixed himself");
    await json(await call("setSelfAction", { on: true }));
  });
});

describe("partners in the world", () => {
  test("a coding agent's calls bring it to the station beside him, by its name; his own chat and loops aren't partners", async () => {
    const token = await arm("claude-code");
    const events = await watchWorld(
      () => call("recall", { q: "the round table" }, token),
      (seen) => seen.some((e) => e.type === "partners" && e.partners.length),
    );
    const partners = events.find((e) => e.type === "partners")!.partners;
    expect(partners).toEqual([expect.objectContaining({ name: "claude-code", station: "library", doing: "Recall from the shared mind: the round table" })]);
    expect(events.some((e) => e.type === "galahad" && e.galahad.station === "library")).toBe(true);
    expect(JSON.stringify(events)).not.toContain('"name":"galahad"');
    expect(JSON.stringify(events)).not.toContain("loop.");
  });

  test("goes home once it's quiet", () => {
    // The hub's own clock decides; here, as if the agent went quiet long ago.
    const world = daemon.world as unknown as { partners: Map<string, { last: number }>; partnersQuiet(): void };
    for (const p of world.partners.values()) p.last = 0;
    world.partnersQuiet();
    expect(world.partners.size).toBe(0);
  });
});

describe("the daily reflection", () => {
  test("reads the day (never a secret, never the bank), keeps a few lines as his own memory, suggests, and is done for the day", async () => {
    asked.length = 0;
    await json(await call("runLoop", { name: "reflect" }));
    await daemon.loops.settled("reflect");
    const run = daemon.store.loopRuns("reflect", 1)[0]!.body;
    expect(run.status).toBe("ok");
    expect(run.summary).toMatch(/with the swift role \(~\d+ of 4000 tokens\); 1 suggestion/);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("daily reflection");
    expect(asked[0]).toContain("site: ok");
    expect(asked[0]!.toLowerCase()).not.toContain("bank");
    const memory = daemon.store.memoriesTagged("reflection", 5)[0]!;
    expect(memory.trust).toBe("agent");
    expect(memory.text).toStartWith("Reflection on ");
    expect(memory.tags).toEqual(["reflection", expect.stringMatching(/^day:\d{4}-\d{2}-\d{2}$/)]);
    const { notices } = await json<{ notices: { key: string; title: string; source: string }[] }>(await call("notices", undefined));
    expect(notices.find((n) => n.source === "reflect")).toMatchObject({ title: "Galahad suggests: Ask the owner whether to watch the site hourly" });
    // A second run that day asks no model.
    await json(await call("runLoop", { name: "reflect" }));
    await daemon.loops.settled("reflect");
    expect(asked).toHaveLength(1);
    expect(daemon.store.loopRuns("reflect", 1)[0]!.body.summary).toContain("kept already");
  });
});
