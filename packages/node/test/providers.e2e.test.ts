import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type RouteName, routes } from "@galahad/core";
import { foundFleet, MindStore } from "@galahad/mind";
import type { Capabilities } from "../src/capabilities.ts";
import { type Daemon, startDaemon } from "../src/daemon.ts";
import { Home } from "../src/home.ts";

/*
 * Providers through a real node (a temp home, the file keystore, loopback only): what the routes every surface
 * uses (the CLI, the app, the iPhone) do with a provider's key and its models. Every key here is fake, made here.
 */

const caps: Capabilities = {
  os: "linux",
  arch: "x64",
  hostname: "providers-test",
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

const fakeKey = (id: string) => ["FAKE", id, "key", "for", "tests", crypto.randomUUID().slice(0, 8)].join("-");

const root = mkdtempSync(join(tmpdir(), "galahad-providers-"));
const home = new Home(join(root, "node"));
const port = freePort();
let daemon: Daemon;

/** A stand-in provider that refuses every key, in the words a provider uses, and echoes the key it was sent. */
const refusing = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch: (req) => Response.json({ error: { message: `Invalid API key: ${req.headers.get("authorization")}` } }, { status: 401 }),
});

async function call(name: RouteName, input?: unknown): Promise<Response> {
  const route = routes[name];
  return fetch(`http://127.0.0.1:${port}${route.path}`, {
    method: route.method,
    headers: { authorization: `Bearer ${home.adminToken()}`, "content-type": "application/json" },
    body: route.method === "POST" ? JSON.stringify(input ?? {}) : undefined,
  });
}

async function ok<T = any>(name: RouteName, input?: unknown): Promise<T> {
  const response = await call(name, input);
  if (!response.ok) throw new Error(`${name} → ${response.status} ${await response.text()}`);
  return (await response.json()) as T;
}

beforeAll(async () => {
  const { identity, keystore } = await home.createIdentity("file");
  const store = new MindStore(home.mindPath);
  const fleet = foundFleet(store, identity, { fleetName: "camelot", nodeName: "providers-node" });
  store.close();
  home.writeConfig({ v: 1, name: "providers-node", fleet, port, keystore, advertise: "127.0.0.1" });
  daemon = await startDaemon(home, { capabilities: caps, proxyPort: freePort(), log: () => {} });
});

afterAll(async () => {
  await daemon?.stop();
  refusing.stop(true);
  rmSync(root, { recursive: true, force: true });
});

describe("a provider's models, listed through the node", () => {
  test("a provider that can't list them says which provider it was and why, in its own words, and never the key", async () => {
    const key = fakeKey("strict");
    const baseUrl = `http://127.0.0.1:${refusing.port}/v1`;
    await ok("setSecret", { name: "strict", value: key, provider: "strict", baseUrl });
    await ok("setProvider", { id: "strict", kind: "openai", baseUrl, secret: "strict" });
    const response = await call("providerModels", { id: "strict" });
    expect(response.status).toBe(502);
    const { error } = (await response.json()) as { error: string };
    expect(error).toContain("strict /models → 401");
    expect(error).toContain("Invalid API key");
    expect(error).not.toContain(key);
  });

  test("one that isn't running says which and why too", async () => {
    await ok("setProvider", { id: "stopped", kind: "openai", baseUrl: `http://127.0.0.1:${freePort()}/v1` });
    const response = await call("providerModels", { id: "stopped" });
    expect(response.status).toBe(502);
    expect(((await response.json()) as { error: string }).error).toStartWith("stopped /models: ");
  });

  test("a Cloudflare AI Gateway lists none: it says they are yours to name", async () => {
    const baseUrl = "https://gateway.ai.cloudflare.com/v1/0123456789abcdef0123456789abcdef/galahad/compat";
    await ok("setSecret", { name: "cloudflare-ai", value: fakeKey("cloudflare-ai"), provider: "cloudflare-ai", baseUrl });
    await ok("setProvider", { id: "cloudflare-ai", baseUrl, secret: "cloudflare-ai" });
    const response = await call("providerModels", { id: "cloudflare-ai" });
    expect(response.status).toBe(502);
    expect(((await response.json()) as { error: string }).error).toBe("cloudflare-ai doesn't list its models: name them yourself in the roster, as cloudflare-ai/<model>");
  });
});
