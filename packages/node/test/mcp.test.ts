import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { routes, type RouteName } from "@galahad/core";
import { foundFleet, MindStore } from "@galahad/mind";
import type { Capabilities } from "../src/capabilities.ts";
import { type Daemon, startDaemon } from "../src/daemon.ts";
import { Home } from "../src/home.ts";

/*
 * The mind for every arm: a real MCP client (the official SDK) spawns `galahad mcp`
 * over stdio against a real daemon, and the arm's credential is held to least privilege.
 */

const caps: Capabilities = {
  os: "linux",
  arch: "x64",
  hostname: "mcp-test",
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

const root = mkdtempSync(join(tmpdir(), "galahad-mcp-"));
const home = new Home(join(root, "node"));
const port = freePort();
const proxyPort = freePort();
let daemon: Daemon;
let armToken: string;
let client: Client;

async function call(name: RouteName, input: unknown, token: string, at = port) {
  const route = routes[name];
  return fetch(`http://127.0.0.1:${at}${route.path}`, {
    method: route.method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: route.method === "POST" ? JSON.stringify(input ?? {}) : undefined,
  });
}

const text = (result: Awaited<ReturnType<Client["callTool"]>>) =>
  (result.content as { type: string; text: string }[]).map((c) => c.text).join("\n");

beforeAll(async () => {
  const { identity, keystore } = await home.createIdentity("file");
  const store = new MindStore(home.mindPath);
  const fleet = foundFleet(store, identity, { fleetName: "camelot", nodeName: "mcp-node" });
  store.close();
  home.writeConfig({ v: 1, name: "mcp-node", fleet, port, keystore, advertise: "127.0.0.1" });
  daemon = await startDaemon(home, { capabilities: caps, proxyPort, log: () => {} });

  const minted = (await (await call("mintArm", { label: "test-arm" }, home.adminToken())).json()) as { token: string };
  armToken = minted.token;
  home.writeArmToken("test-arm", armToken);

  client = new Client({ name: "galahad-test", version: "1.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [resolve(import.meta.dir, "../src/cli.ts"), "mcp", "--arm", "test-arm", "--home", home.dir],
      stderr: "ignore",
    }),
  );
});

afterAll(async () => {
  await client?.close();
  await daemon?.stop();
  rmSync(root, { recursive: true, force: true });
});

describe("arm credentials", () => {
  test("hold only memory, sandbox, ledger and secret-request powers", async () => {
    const who = (await (await call("whoami", undefined, armToken)).json()) as { kind: string; scopes: string[] };
    expect(who.kind).toBe("arm");
    expect(who.scopes).not.toContain("vault:write");
    expect(who.scopes).not.toContain("fleet:admin");
    expect((await call("setSecret", { name: "x", value: "y-value-123" }, armToken)).status).toBe(403);
    expect((await call("createInvite", { kind: "client" }, armToken)).status).toBe(403);
    expect((await call("mintToken", { label: "x" }, armToken)).status).toBe(403);
  });

  test("can never be minted with vault, device or gateway powers", async () => {
    const response = await call("mintArm", { label: "greedy", scopes: ["vault:write"] }, home.adminToken());
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toMatch(/never hold/);
  });

  test("are local credentials: refused through tailscale serve", async () => {
    expect((await call("whoami", undefined, armToken, proxyPort)).status).toBe(401);
  });

  test("stop working the moment they are revoked", async () => {
    const extra = (await (await call("mintArm", { label: "temporary" }, home.adminToken())).json()) as { token: string };
    expect((await call("whoami", undefined, extra.token)).status).toBe(200);
    await call("revokeArm", { label: "temporary" }, home.adminToken());
    expect((await call("whoami", undefined, extra.token)).status).toBe(401);
  });
});

describe("galahad mcp (official MCP client over stdio)", () => {
  test("offers the mind's tools and the Oath", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "artifact_read",
        "artifacts",
        "connector_call",
        "connectors",
        "decide",
        "fleet",
        "ledger",
        "loops",
        "notices",
        "place",
        "recall",
        "remember",
        "request_secret",
        "sandbox_create",
        "sandbox_destroy",
        "sandbox_exec",
        "sandbox_run",
        "sandbox_save",
        "web_search",
      ].sort(),
    );
    const oath = await client.readResource({ uri: "galahad://oath" });
    expect(JSON.stringify(oath.contents)).toContain("Oath");
  });

  test("remember and recall: an agent's memories are labelled agent, never owner", async () => {
    expect(text(await client.callTool({ name: "remember", arguments: { text: "The round table meets on Tuesdays", tags: ["ritual"] } }))).toMatch(
      /agent/,
    );
    expect(text(await client.callTool({ name: "remember", arguments: { text: "A web page claims knights prefer tea", untrusted: true } }))).toMatch(
      /untrusted/,
    );
    const recalled = text(await client.callTool({ name: "recall", arguments: { query: "round table" } }));
    expect(recalled).toContain("[agent] The round table meets on Tuesdays");
    expect(daemon.store.recall("tea")[0]?.trust).toBe("untrusted");
  });

  test("an agent cannot erase your memories, only its own (review #7)", async () => {
    const mine = (await (await call("remember", { text: "owner memory: the oath is not negotiable" }, home.adminToken())).json()) as { id: string };
    expect((await call("forget", { id: mine.id }, armToken)).status).toBe(403);
    const its = (await (await call("remember", { text: "agent scratch note" }, armToken)).json()) as { id: string };
    expect((await call("forget", { id: its.id }, armToken)).status).toBe(200);
  });

  test("secrets are refused, and the agent is pointed to request_secret", async () => {
    const result = await client.callTool({ name: "remember", arguments: { text: "key: sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123" } });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/vault/);
    expect(text(await client.callTool({ name: "request_secret", arguments: { name: "deepseek", purpose: "reviewer role" } }))).toMatch(/never see/);
  });

  test("connectors: reads come back, outward calls are filed for you, and the key never shows", async () => {
    const seen: string[] = [];
    const service = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: (req) => {
        seen.push(`${req.method} ${new URL(req.url).pathname} ${req.headers.get("authorization")}`);
        return Response.json({ ok: true, token: req.headers.get("authorization") });
      },
    });
    try {
      const manifest = {
        id: "forge",
        label: "Forge",
        origin: `http://127.0.0.1:${service.port}`,
        auth: { secret: "forge", scheme: "bearer" },
        tools: {
          status: { description: "Status.", method: "GET", path: "/status", class: "read" },
          post: { description: "Post.", method: "POST", path: "/posts", params: { text: { type: "string", required: true } }, class: "outward" },
        },
      };
      expect((await call("setConnector", { id: "forge", manifest }, home.adminToken())).status).toBe(200);
      expect((await call("setSecret", { name: "forge", value: "forge-mcp-key-0123456789", connector: "forge" }, home.adminToken())).status).toBe(200);

      expect(text(await client.callTool({ name: "connectors", arguments: {} }))).toMatch(/post\(text: string\) \[outward: asks the user\]/);
      const read = text(await client.callTool({ name: "connector_call", arguments: { connector: "forge", tool: "status" } }));
      expect(read).toContain("GET /status → 200");
      expect(read).not.toContain("forge-mcp-key-0123456789");
      expect(seen).toEqual(["GET /status Bearer forge-mcp-key-0123456789"]);

      const outward = text(await client.callTool({ name: "connector_call", arguments: { connector: "forge", tool: "post", args: { text: "hi" }, why: "say hi" } }));
      expect(outward).toMatch(/Filed for the user's approval as action a_/);
      expect(seen).toHaveLength(1);

      // A standing order the user signed: the agent sees it, and a covered call goes straight out.
      const signed = await call("setOrder", { connector: "forge", tool: "post", args: { text: "status: *" }, label: "Status posts" }, home.adminToken());
      expect(signed.status).toBe(200);
      expect(text(await client.callTool({ name: "connectors", arguments: {} }))).toMatch(/standing order "Status posts" \(no need to ask\): forge\.post text=status: \*/);
      const covered = text(await client.callTool({ name: "connector_call", arguments: { connector: "forge", tool: "post", args: { text: "status: green" } } }));
      expect(covered).toMatch(/Sent under the user's standing order "Status posts"/);
      expect(covered).toContain("POST /posts → 200");
      expect(seen).toHaveLength(2);
    } finally {
      service.stop(true);
    }
  });

  test("tool failures come back as readable errors, not crashes", async () => {
    const result = await client.callTool({ name: "sandbox_run", arguments: { command: "echo hi" } });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/sandbox host/);
    expect(text(await client.callTool({ name: "fleet", arguments: {} }))).toContain("mcp-node");
  });
});
