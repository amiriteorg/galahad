import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ChatStreamEvent, type RouteName, routes } from "@galahad/core";
import { foundFleet, MindStore } from "@galahad/mind";
import type { Capabilities } from "../src/capabilities.ts";
import { type Daemon, startDaemon } from "../src/daemon.ts";
import { Home } from "../src/home.ts";
import { chatTools, type GalahadTool, type ToolApi, TOOLS, toolsFor } from "../src/tools.ts";
import { z } from "zod";

/*
 * The same Galahad on every surface: chat in the PWA and the terminal gets the tools
 * agents get over MCP, run in the node as the agent "galahad", within the caller's
 * scopes. Against a real daemon and a stand-in model.
 */

const caps: Capabilities = {
  os: "linux",
  arch: "x64",
  hostname: "chat-test",
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

const root = mkdtempSync(join(tmpdir(), "galahad-chat-"));
const home = new Home(join(root, "node"));
const port = freePort();
let daemon: Daemon;

/** The stand-in model: each request gets the next scripted answer; bodies are kept. */
const bodies: any[] = [];
let script: (() => Response)[] = [];
const sse = (...chunks: object[]) => () => new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
const say = (text: string) => sse({ choices: [{ delta: { content: text } }] });
const callTool = (name: string, args: object) => sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: `call_${name}`, function: { name, arguments: JSON.stringify(args) } }] } }] });
const model = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch: async (req) => {
    bodies.push(await req.json());
    return (script.shift() ?? say("OK."))();
  },
});

/** Another service, for connector calls: records what reached it. */
const reached: string[] = [];
const service = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch: (req) => {
    reached.push(`${req.method} ${new URL(req.url).pathname}`);
    return Response.json({ ok: true });
  },
});

async function call(name: RouteName, input: unknown, token: string) {
  const route = routes[name];
  return fetch(`http://127.0.0.1:${port}${route.path}`, {
    method: route.method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: route.method === "POST" ? JSON.stringify(input ?? {}) : undefined,
  });
}

async function ask(token: string, content: string, extra: object = {}): Promise<ChatStreamEvent[]> {
  bodies.length = 0;
  const response = await call("chat", { messages: [{ role: "user", content }], ...extra }, token);
  expect(response.status).toBe(200);
  return (await response.text())
    .split("\n")
    .filter((l) => l.startsWith("data: "))
    .map((l) => JSON.parse(l.slice(6)) as ChatStreamEvent);
}
const offered = () => ((bodies[0]?.tools ?? []) as { function: { name: string } }[]).map((t) => t.function.name);

beforeAll(async () => {
  const { identity, keystore } = await home.createIdentity("file");
  const store = new MindStore(home.mindPath);
  const fleet = foundFleet(store, identity, { fleetName: "camelot", nodeName: "chat-node" });
  store.close();
  home.writeConfig({ v: 1, name: "chat-node", fleet, port, keystore, advertise: "127.0.0.1" });
  daemon = await startDaemon(home, { capabilities: caps, proxyPort: freePort(), log: () => {} });
  const admin = home.adminToken();
  expect((await call("setProvider", { id: "stand-in", kind: "openai", baseUrl: `http://127.0.0.1:${model.port}/v1` }, admin)).status).toBe(200);
  expect((await call("setRoster", { role: "planner", models: ["stand-in/m"] }, admin)).status).toBe(200);
});

afterAll(async () => {
  await daemon?.stop();
  model.stop(true);
  service.stop(true);
  rmSync(root, { recursive: true, force: true });
});

describe("Galahad's chat has his tools", () => {
  test("from a terminal: the same tools agents get, the bank included, and the steps stream back", async () => {
    script = [callTool("recall", { query: "round table" }), say("Nothing about it yet.")];
    const events = await ask(home.adminToken(), "What do you remember about the round table?");
    expect(offered().sort()).toEqual(TOOLS.map((t) => t.name).sort());
    expect(events.map((e) => e.type)).toEqual(["model", "tool", "tool_result", "text", "done"]);
    expect(events[1]).toMatchObject({ type: "tool", name: "recall", title: "Recall from the shared mind", input: '{"query":"round table"}' });
    expect(bodies[1].messages.at(-1)).toEqual({ role: "tool", tool_call_id: "call_recall", content: 'Nothing remembered about "round table".' });
  });

  test("within the caller's scopes: an agent without bank:read gets no bank tools, and gets them once granted", async () => {
    const admin = home.adminToken();
    const { token } = (await (await call("mintArm", { label: "helper" }, admin)).json()) as { token: string };
    script = [say("Hi.")];
    await ask(token, "hello");
    expect(offered().some((n) => n.startsWith("bank_"))).toBe(false);
    expect(offered()).toContain("recall");
    await call("grantArm", { label: "helper", add: ["bank:read"] }, admin);
    script = [say("Hi.")];
    await ask(token, "hello");
    expect(offered()).toContain("bank_transactions");
  });

  test("in chat he acts as an agent: what he remembers is labelled agent, never owner", async () => {
    script = [callTool("remember", { text: "The liege prefers Danish kroner" }), say("Noted.")];
    const events = await ask(home.adminToken(), "Remember that I prefer Danish kroner.");
    expect(events.find((e) => e.type === "tool_result")).toMatchObject({ ok: true, summary: "Remembered as agent. Every node will have it within seconds." });
    const memory = daemon.store.recall("kroner")[0]!;
    expect(memory.trust).toBe("agent");
  });

  test("an outward call he makes in chat is filed for your approval, not sent", async () => {
    const admin = home.adminToken();
    const manifest = {
      id: "forge",
      label: "Forge",
      origin: `http://127.0.0.1:${service.port}`,
      auth: { secret: "forge", scheme: "bearer" },
      tools: { post: { description: "Post.", method: "POST", path: "/posts", params: { text: { type: "string", required: true } }, class: "outward" } },
    };
    expect((await call("setConnector", { id: "forge", manifest }, admin)).status).toBe(200);
    expect((await call("setSecret", { name: "forge", value: "forge-chat-key-0123456789", connector: "forge" }, admin)).status).toBe(200);
    script = [callTool("connector_call", { connector: "forge", tool: "post", args: { text: "hello world" }, why: "you asked" }), say("Filed it.")];
    const events = await ask(admin, "Post hello world on the forge.");
    expect(events.find((e) => e.type === "tool_result")).toMatchObject({ ok: true, summary: expect.stringContaining("Filed for the user's approval") });
    expect(reached).toEqual([]);
    const { actions } = (await (await call("actions", undefined, admin)).json()) as { actions: { state: string; tool: string; by: string }[] };
    expect(actions.find((a) => a.tool === "post")).toMatchObject({ state: "waiting", by: "arm:galahad" });
  });

  test("quests turn the tools off: their roles have their own", async () => {
    script = [say("Plan.")];
    await ask(home.adminToken(), "plan", { tools: false });
    expect(bodies[0].tools).toBeUndefined();
  });

  test("no agent can be minted as galahad", async () => {
    const response = await call("mintArm", { label: "galahad" }, home.adminToken());
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toMatch(/Galahad himself/);
  });
});

describe("one answer's tools", () => {
  const fake = (name: string, flow: GalahadTool["flow"], run: () => Promise<string>): GalahadTool => ({ name, title: name, description: name, input: { q: z.string().optional() }, routes: ["recall"], flow, run });
  const api: ToolApi = { call: async <T,>() => ({}) as T, bytes: async () => ({ bytes: new Uint8Array(), type: "" }) };
  const explain = (e: unknown) => (e as Error).message;

  test("once bank data is in the answer, nothing that can carry it out runs", async () => {
    let searched = 0;
    const tools = chatTools([fake("bank_balances", "private", async () => '{"untrusted_data":true}'), fake("web_search", "egress", async () => `result ${++searched}`)], api, explain);
    expect((await tools.run({ id: "1", name: "web_search", input: {} })).isError).toBeUndefined();
    expect((await tools.run({ id: "2", name: "bank_balances", input: {} })).isError).toBeUndefined();
    const refused = await tools.run({ id: "3", name: "web_search", input: { q: "my balance" } });
    expect(refused).toMatchObject({ isError: true, summary: "refused: bank data is in this answer" });
    expect(searched).toBe(1);
    expect(tools.specs.find((s) => s.name === "web_search")!.description).toContain("Refused once the user's bank data is in the answer");
  });

  test("a bank call that failed brought no data: the web stays available", async () => {
    const tools = chatTools([fake("bank_balances", "private", async () => Promise.reject(new Error("bank access is off"))), fake("web_search", "egress", async () => "ok")], api, explain);
    expect(await tools.run({ id: "1", name: "bank_balances", input: {} })).toMatchObject({ isError: true, content: "Galahad: bank access is off" });
    expect((await tools.run({ id: "2", name: "web_search", input: {} })).isError).toBeUndefined();
  });

  test("the model's input is checked before anything runs; unknown tools are refused", async () => {
    let ran = 0;
    const tools = chatTools([fake("recall", undefined, async () => `${++ran}`)], api, explain);
    expect(await tools.run({ id: "1", name: "recall", input: { q: 42 } })).toMatchObject({ isError: true, summary: expect.stringContaining("invalid input") });
    expect(await tools.run({ id: "2", name: "recall", input: "not json" })).toMatchObject({ isError: true });
    expect(await tools.run({ id: "3", name: "vault_read", input: {} })).toMatchObject({ isError: true, summary: "no such tool" });
    expect(ran).toBe(0);
  });

  test("every bank tool is private, everything that reaches outside is egress, and agents' defaults hold no bank tool", () => {
    const flow = (name: string) => TOOLS.find((t) => t.name === name)!.flow;
    for (const name of ["bank_status", "bank_accounts", "bank_balances", "bank_transactions"]) expect(flow(name)).toBe("private");
    for (const name of ["web_search", "connector_call", "sandbox_run", "sandbox_exec", "decide"]) expect(flow(name)).toBe("egress");
    expect(toolsFor(["mind:read", "mind:write", "sandbox", "vault:read", "chat", "connect"]).some((t) => t.flow === "private")).toBe(false);
  });
});
