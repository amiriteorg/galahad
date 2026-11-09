import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ActionView, type ConnectorView, type LoopRunView, type LoopView, newNodeIdentity, type NoticeView, type RouteName, routes } from "@galahad/core";
import { foundFleet, MindStore, Vault } from "@galahad/mind";
import type { Capabilities } from "../src/capabilities.ts";
import { ConnectorService } from "../src/connectors.ts";
import { type Daemon, startDaemon } from "../src/daemon.ts";
import { Home } from "../src/home.ts";

/*
 * Connectors, approvals and loops, end to end over real HTTP: a stand-in service,
 * a node, you (the admin token) and a coding agent (an arm token). Reads and
 * creates just happen; outward and delete wait for you and are sent exactly once.
 */

const caps: Capabilities = {
  os: "linux",
  arch: "x64",
  hostname: "connector-test",
  cores: 4,
  cpu: "test",
  memoryGb: 8,
  hasBattery: false,
  gpu: [],
  docker: false,
  vm: { kvm: false, tools: [] },
  tools: [],
  localModels: [],
  tailscale: null,
};

const freePort = () => {
  const s = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() });
  const port = s.port!;
  s.stop(true);
  return port;
};

async function until<T>(check: () => Promise<T | null | undefined | false> | T | null | undefined | false, timeoutMs = 8000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await Bun.sleep(40);
  }
}

const KEY = "forge_e2e_key_0123456789abcdef";
const root = mkdtempSync(join(tmpdir(), "galahad-connectors-"));
const home = new Home(join(root, "node"));
const port = freePort();
let daemon: Daemon;
let upstream: ReturnType<typeof Bun.serve>;
let origin: string;
let armToken: string;
const hits: { method: string; path: string; auth: string | null; body: string }[] = [];

function manifest(id = "forge") {
  return {
    id,
    label: "Forge",
    origin,
    auth: { secret: "forge", scheme: "bearer" },
    tools: {
      me: { description: "Who am I.", method: "GET", path: "/user", class: "read" },
      echo: { description: "Echo back.", method: "GET", path: "/echo", class: "read" },
      bounce: { description: "Redirects away.", method: "GET", path: "/bounce", class: "read" },
      post: { description: "Post publicly.", method: "POST", path: "/posts", params: { text: { type: "string", required: true } }, class: "outward" },
      "bucket.create": { description: "Create a bucket.", method: "POST", path: "/buckets", params: { name: { type: "string", required: true } }, class: "create" },
      "bucket.delete": { description: "Delete a bucket.", method: "DELETE", path: "/buckets/{name}", params: { name: { type: "string" } }, class: "delete" },
    },
  };
}

async function as<T = any>(token: string, name: RouteName, input?: unknown): Promise<{ status: number; body: T }> {
  const route = routes[name];
  const response = await fetch(`http://127.0.0.1:${port}${route.path}`, {
    method: route.method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: route.method === "POST" ? JSON.stringify(input ?? {}) : undefined,
  });
  return { status: response.status, body: (await response.json()) as T };
}
const admin = <T = any>(name: RouteName, input?: unknown) => as<T>(home.adminToken(), name, input);
const arm = <T = any>(name: RouteName, input?: unknown) => as<T>(armToken, name, input);
const posts = () => hits.filter((h) => h.method === "POST" && h.path === "/posts");

beforeAll(async () => {
  upstream = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      hits.push({ method: req.method, path: url.pathname, auth: req.headers.get("authorization"), body: await req.text() });
      if (url.pathname === "/bounce") return new Response(null, { status: 302, headers: { location: "https://evil.test/steal" } });
      if (url.pathname === "/echo") return Response.json({ youSent: req.headers.get("authorization") });
      if (req.method === "POST") return Response.json({ created: true }, { status: 201 });
      if (req.method === "DELETE") return new Response(null, { status: 204 });
      return Response.json({ login: "galahad" });
    },
  });
  origin = `http://127.0.0.1:${upstream.port}`;

  const { identity, keystore } = await home.createIdentity("file");
  const store = new MindStore(home.mindPath);
  const fleet = foundFleet(store, identity, { fleetName: "camelot", nodeName: "ultra" });
  store.close();
  home.writeConfig({ v: 1, name: "ultra", fleet, port, keystore, advertise: "127.0.0.1" });
  daemon = await startDaemon(home, { capabilities: caps, proxyPort: freePort(), log: () => {} });
  armToken = (await admin<{ token: string }>("mintArm", { label: "test-arm" })).body.token;
});

afterAll(async () => {
  await daemon?.stop();
  upstream?.stop(true);
  rmSync(root, { recursive: true, force: true });
});

describe("connectors", () => {
  test("the catalog is listed, a manifest of your own installs, and an invalid one is refused with why", async () => {
    const before = (await admin<{ connectors: ConnectorView[] }>("connectors")).body.connectors;
    expect(before.map((c) => c.id)).toEqual(["cloudflare", "github", "home-assistant"]);
    expect(before.every((c) => !c.installed)).toBe(true);

    const bad = await admin("setConnector", { id: "forge", manifest: { ...manifest(), tools: { x: { description: "x", method: "DELETE", path: "/x", class: "read" } } } });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/DELETE can't be class read/);
    expect((await arm("setConnector", { id: "forge", manifest: manifest() })).status).toBe(403); // agents can't install

    const installed = await admin<{ connector: ConnectorView }>("setConnector", { id: "forge", manifest: manifest() });
    expect(installed.status).toBe(200);
    expect(installed.body.connector).toMatchObject({ installed: true, key: "missing", origin });
    expect(installed.body.connector.tools.find((t) => t.name === "post")).toMatchObject({ class: "outward", asks: true });
  });

  test("without its key a call fails, sends nothing, and files a secret request", async () => {
    const response = await admin("callConnector", { connector: "forge", tool: "me" });
    expect(response.status).toBe(424);
    expect(hits).toHaveLength(0);
    const { requests } = (await admin<{ requests: { name: string; provider: string }[] }>("secretRequests")).body;
    expect(requests).toContainEqual(expect.objectContaining({ name: "forge", provider: "forge" }));
  });

  test("with its key, reads run at once with the key injected, and are ledgered", async () => {
    // Filling the request the connector filed pins the key to the connector's origin.
    expect((await admin("setSecret", { name: "forge", value: KEY, provider: "forge" })).status).toBe(200);
    expect((await admin<{ connectors: ConnectorView[] }>("connectors")).body.connectors.find((c) => c.id === "forge")!.key).toBe("ready");
    const me = await arm<{ status: string; result: { status: number; body: string } }>("callConnector", { connector: "forge", tool: "me" });
    expect(me.body.status).toBe("done");
    expect(JSON.parse(me.body.result.body)).toEqual({ login: "galahad" });
    expect(hits.at(-1)).toMatchObject({ method: "GET", path: "/user", auth: `Bearer ${KEY}` });
    const { entries } = (await admin<{ entries: { resource: string; verdict: string; class: string; detail: string }[] }>("ledger")).body;
    expect(entries[0]).toMatchObject({ resource: "connector.forge", class: "read", verdict: "allow" });
    expect(entries[0]!.detail).toContain("by arm:test-arm");
  });

  test("the key never comes back: echoed keys are redacted, redirects aren't followed", async () => {
    const echo = await arm<{ result: { body: string } }>("callConnector", { connector: "forge", tool: "echo" });
    expect(echo.body.result.body).not.toContain(KEY);
    const bounce = await arm<{ result: { status: number } }>("callConnector", { connector: "forge", tool: "bounce" });
    expect(bounce.body.result.status).toBe(302);
    expect(hits.filter((h) => h.path === "/steal")).toHaveLength(0);
  });

  test("an argument that looks like a key is refused before anything is sent", async () => {
    const response = await arm("callConnector", { connector: "forge", tool: "post", args: { text: "ghp_0123456789abcdefghijABCDEFGHIJ0123456789" } });
    expect(response.status).toBe(422);
  });

  test("creating is Galahad's to do: an agent's create runs at once", async () => {
    const created = await arm<{ status: string }>("callConnector", { connector: "forge", tool: "bucket.create", args: { name: "galahad-cache" } });
    expect(created.body.status).toBe("done");
    expect(hits.at(-1)).toMatchObject({ method: "POST", path: "/buckets", body: JSON.stringify({ name: "galahad-cache" }) });
  });

  test("outward: an agent's call waits for you, and is sent exactly once after you approve", async () => {
    const asked = await arm<{ status: string; action: string }>("callConnector", { connector: "forge", tool: "post", args: { text: "Hello, world" }, why: "announce the release" });
    expect(asked.body.status).toBe("asked");
    expect(posts()).toHaveLength(0);

    const waiting = (await admin<{ actions: ActionView[] }>("actions")).body.actions.find((a) => a.id === asked.body.action)!;
    expect(waiting).toMatchObject({ state: "waiting", class: "outward", by: "arm:test-arm", why: "announce the release", target: "POST /posts" });
    // The agent can't answer its own request.
    expect((await arm("decideAction", { id: asked.body.action, approve: true })).status).toBe(403);

    const decided = await admin<{ action: ActionView }>("decideAction", { id: asked.body.action, approve: true });
    expect(decided.status).toBe(200);
    await daemon.connectors.drain();
    const done = await until(async () => (await admin<{ actions: ActionView[] }>("actions")).body.actions.find((a) => a.id === asked.body.action && a.state === "done"));
    expect(done.receipt).toContain("201");
    expect(posts()).toHaveLength(1);
    expect(JSON.parse(posts()[0]!.body)).toEqual({ text: "Hello, world" });

    // Answering again changes nothing, and draining again sends nothing.
    expect((await admin("decideAction", { id: asked.body.action, approve: true })).status).toBe(409);
    await daemon.connectors.drain();
    expect(posts()).toHaveLength(1);
  });

  test("delete: declined means never sent", async () => {
    const asked = await arm<{ status: string; action: string }>("callConnector", { connector: "forge", tool: "bucket.delete", args: { name: "galahad-cache" } });
    expect(asked.body.status).toBe("asked");
    await admin("decideAction", { id: asked.body.action, approve: false, note: "keep it" });
    await daemon.connectors.drain();
    expect(hits.filter((h) => h.method === "DELETE")).toHaveLength(0);
    expect((await admin<{ actions: ActionView[] }>("actions")).body.actions.find((a) => a.id === asked.body.action)!.state).toBe("denied");
  });

  test("you asking is the approval: your own outward call runs, ledgered as approved", async () => {
    const mine = await admin<{ status: string }>("callConnector", { connector: "forge", tool: "post", args: { text: "from me" } });
    expect(mine.body.status).toBe("done");
    expect(posts()).toHaveLength(2);
    const { entries } = (await admin<{ entries: { verdict: string; reason: string }[] }>("ledger")).body;
    expect(entries[0]).toMatchObject({ verdict: "approved", reason: "you asked for it" });
  });
});

describe("the outbox survives a crash without sending twice", () => {
  test("a send that was in flight when the node died is reported, never retried", async () => {
    const identity = newNodeIdentity();
    const store = new MindStore(":memory:");
    foundFleet(store, identity, { fleetName: "camelot", nodeName: "solo" });
    const vault = new Vault(store, identity);
    vault.set("forge", KEY, { provider: "forge", origin });
    store.emit(identity, "connector.set", { id: "forge", manifest: manifest() });
    const local = new Database(":memory:");
    let sent = 0;
    const fetch = (async () => {
      sent += 1;
      return Response.json({}, { status: 201 });
    }) as unknown as typeof globalThis.fetch;
    const service = new ConnectorService({ store, vault, identity, local, ledger: () => {}, log: () => {}, fetch });
    const asked = await service.call({ connector: "forge", tool: "post", args: { text: "once" } }, { kind: "agent", by: "loop:x" });
    expect(asked.status).toBe("asked");
    const id = (asked as { action: string }).action;
    // Approve, but the "process" dies after marking the send and before the receipt.
    local.query("INSERT INTO outbox (id, state, at) VALUES (?, 'sending', 0)").run(id);
    service.decide(id, true, null);
    await service.drain();
    expect(sent).toBe(0);
    const action = service.actions().find((a) => a.id === id)!;
    expect(action.state).toBe("failed");
    expect(action.receipt).toMatch(/outcome unknown/);
  });
});

describe("loops over the API", () => {
  test("the founding node gives Galahad a heartbeat, on an always-on node", async () => {
    const { loops } = (await admin<{ loops: LoopView[] }>("loops")).body;
    const beat = loops.find((l) => l.name === "heartbeat")!;
    expect(beat).toMatchObject({ schedule: "every 30m", enabled: true, onName: "ultra", task: { kind: "heartbeat" }, running: false });
    expect(beat.next).toBeGreaterThan(Date.now() - 30 * 60_000);
  });

  test("a heartbeat run raises notices for what needs you; you can dismiss them", async () => {
    const check = await admin<{ findings: { key: string }[] }>("heartbeat", {});
    expect(check.body.findings.map((f) => f.key)).toContain("no-model:planner"); // no model keys in this test fleet
    expect((await admin<{ notices: NoticeView[] }>("notices")).body.notices).toHaveLength(0); // checking writes nothing

    expect((await admin("runLoop", { name: "heartbeat" })).status).toBe(200);
    const run = await until(async () => (await admin<{ runs: LoopRunView[] }>("loopRuns", { name: "heartbeat" })).body.runs[0]);
    expect(run).toMatchObject({ status: "attention", slot: null });
    expect(run.summary).toContain("No model can play planner");
    const { notices } = (await admin<{ notices: NoticeView[] }>("notices")).body;
    expect(notices.find((n) => n.key === "no-model:planner")).toMatchObject({ severity: "warn", source: "heartbeat", dismissed: false });

    expect((await admin("dismissNotice", { key: "no-model:planner" })).status).toBe(200);
    expect((await admin<{ notices: NoticeView[] }>("notices")).body.notices.find((n) => n.key === "no-model:planner")!.dismissed).toBe(true);
  });

  test("a loop that calls a connector: reads report back, outward calls wait for you", async () => {
    const set = await admin<{ loop: LoopView }>("setLoop", { name: "poll", schedule: "every 15m", task: { kind: "call", connector: "forge", tool: "me" } });
    expect(set.status).toBe(200);
    expect(set.body.loop).toMatchObject({ onName: "ultra", enabled: true, schedule: "every 15m", tz: "UTC" });
    await admin("runLoop", { name: "poll" });
    const run = await until(async () => (await admin<{ runs: LoopRunView[] }>("loopRuns", { name: "poll" })).body.runs[0]);
    expect(run.status).toBe("ok");
    expect(run.summary).toContain("forge.me → 200");

    const before = posts().length;
    await admin("setLoop", { name: "poster", schedule: "0 9 * * 1", tz: "Europe/Copenhagen", task: { kind: "call", connector: "forge", tool: "post", args: { text: "weekly" } } });
    await admin("runLoop", { name: "poster" });
    const asked = await until(async () => (await admin<{ runs: LoopRunView[] }>("loopRuns", { name: "poster" })).body.runs[0]);
    expect(asked.status).toBe("attention");
    expect(asked.summary).toContain("needs your approval");
    expect(posts()).toHaveLength(before);
    expect((await admin<{ actions: ActionView[] }>("actions")).body.actions.some((a) => a.by === "loop:poster" && a.state === "waiting")).toBe(true);
  });

  test("pause, resume and change a loop; what you leave out stays", async () => {
    await admin("setLoop", { name: "poll", enabled: false });
    let poll = (await admin<{ loops: LoopView[] }>("loops")).body.loops.find((l) => l.name === "poll")!;
    expect(poll).toMatchObject({ enabled: false, next: null, schedule: "every 15m", task: { kind: "call", tool: "me" } });
    await admin("setLoop", { name: "poll", enabled: true, schedule: "every 1h" });
    poll = (await admin<{ loops: LoopView[] }>("loops")).body.loops.find((l) => l.name === "poll")!;
    expect(poll).toMatchObject({ enabled: true, schedule: "every 1h", task: { kind: "call", tool: "me" } });
    expect((await admin("removeLoop", { name: "poll" })).status).toBe(200);
    expect((await admin<{ loops: LoopView[] }>("loops")).body.loops.some((l) => l.name === "poll")).toBe(false);
  });

  test("loops are checked before they're written", async () => {
    const quest = (goal: string) => ({ kind: "quest", goal, network: "isolated" });
    expect((await admin("setLoop", { name: "x", schedule: "every 5s", task: quest("hi") })).status).toBe(400);
    expect((await admin("setLoop", { name: "x", schedule: "0 0 31 2 *", task: quest("hi") })).body.error).toMatch(/never runs/);
    expect((await admin("setLoop", { name: "x", schedule: "@daily", tz: "Mars/Olympus", task: quest("hi") })).body.error).toMatch(/time zone/);
    expect((await admin("setLoop", { name: "x", schedule: "@daily" })).body.error).toMatch(/needs a schedule and a task/);
    expect((await admin("setLoop", { name: "x", schedule: "@daily", task: quest("use sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123") })).status).toBe(422);
    expect((await admin("setLoop", { name: "Bad Name", schedule: "@daily", task: quest("hi") })).status).toBe(400);
    expect((await admin("runLoop", { name: "nope" })).status).toBe(404);
    // Agents can see loops but not define or run them.
    expect((await arm("loops")).status).toBe(200);
    expect((await arm("setLoop", { name: "x", schedule: "@daily", task: { kind: "heartbeat" } })).status).toBe(403);
    expect((await arm("runLoop", { name: "heartbeat" })).status).toBe(403);
  });
});
