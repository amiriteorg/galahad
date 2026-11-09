import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { b64u, clientIdFromKey, type FleetView, newNodeIdentity, routes, type RouteName, signRequest, utf8 } from "@galahad/core";
import { requestPairing, signedPost, type SyncPage, waitForApproval } from "@galahad/link";
import { foundFleet, MindStore } from "@galahad/mind";
import type { Capabilities } from "../src/capabilities.ts";
import { type Daemon, startDaemon } from "../src/daemon.ts";
import { Home } from "../src/home.ts";

/*
 * M0, end to end, over real HTTP:
 *   laptop founds a fleet → invites the server → you approve the matching code →
 *   memories flow both ways → a key added on the laptop is used by the server's
 *   gateway on behalf of an arm that never sees it → a browser-style client pairs
 *   with a WebCrypto key and is held to its scopes.
 */

const fakeCaps = (hostname: string, extra: Partial<Capabilities> = {}): Capabilities => ({
  os: "linux",
  arch: "x64",
  hostname,
  cores: 8,
  cpu: "test",
  memoryGb: 16,
  hasBattery: false,
  gpu: [],
  docker: false,
  vm: { kvm: false, tools: [] },
  tools: ["git"],
  localModels: [],
  tailscale: null,
  ...extra,
});

function freePort(): number {
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() });
  const port = server.port!;
  server.stop(true);
  return port;
}

async function until(check: () => boolean | Promise<boolean>, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await Bun.sleep(50);
  }
  throw new Error("condition not met in time");
}

function admin(home: Home, port: number) {
  const token = home.adminToken();
  return async <T = any>(name: RouteName, input?: unknown): Promise<T> => {
    const route = routes[name];
    const response = await fetch(`http://127.0.0.1:${port}${route.path}`, {
      method: route.method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: route.method === "POST" ? JSON.stringify(input ?? {}) : undefined,
    });
    if (!response.ok) throw new Error(`${name} → ${response.status} ${await response.text()}`);
    return (await response.json()) as T;
  };
}

const root = mkdtempSync(join(tmpdir(), "galahad-e2e-"));
const homeA = new Home(join(root, "laptop"));
const homeB = new Home(join(root, "server"));
const portA = freePort();
const portB = freePort();
const proxyA = freePort();
const proxyB = freePort();
let laptop: Daemon;
let server: Daemon;
let upstream: ReturnType<typeof Bun.serve>;
let upstreamAuth: string | null = null;

beforeAll(async () => {
  // A stand-in for any OpenAI-compatible provider (DeepSeek, OrcaRouter, Verda, Ollama…).
  upstream = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      upstreamAuth = req.headers.get("authorization");
      const body = (await req.json()) as { stream?: boolean; messages: { content: string }[] };
      if (!body.stream) return Response.json({ choices: [{ message: { content: "pong" } }] });
      const chunks = ["Good ", "day, ", "my liege."].map((t) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`);
      return new Response(`${chunks.join("")}data: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
    },
  });

  // The laptop founds the fleet.
  const { identity, keystore } = await homeA.createIdentity("file");
  const store = new MindStore(homeA.mindPath);
  const fleet = foundFleet(store, identity, { fleetName: "camelot", nodeName: "laptop" });
  store.close();
  homeA.writeConfig({ v: 1, name: "laptop", fleet, port: portA, keystore, advertise: "127.0.0.1" });
  laptop = await startDaemon(homeA, {
    capabilities: fakeCaps("laptop", { hasBattery: true }),
    syncIntervalMs: 150,
    proxyPort: proxyA,
    log: () => {},
  });
});

afterAll(async () => {
  await server?.stop();
  await laptop?.stop();
  upstream?.stop(true);
  rmSync(root, { recursive: true, force: true });
});

describe("M0: one mind, two bodies", () => {
  test("the server joins with a one-time invite and a matching code", async () => {
    const callA = admin(homeA, portA);
    const invite = await callA<{ invite: string; id: string }>("createInvite", { kind: "node" });

    const { identity, keystore } = await homeB.createIdentity("file");
    const join = await requestPairing(invite.invite, {
      device: identity.id,
      name: "server",
      kind: "node",
      box: b64u(identity.boxPublic),
      endpoint: `http://127.0.0.1:${portB}`,
    });

    // The approving side shows the same code the joining side shows.
    const { pairings } = await callA("pairings");
    expect(pairings).toHaveLength(1);
    expect(pairings[0].sas).toBe(join.sas);
    await callA("approvePairing", { invite: pairings[0].invite, device: pairings[0].device });

    const { fleet } = await waitForApproval(join, { intervalMs: 50 });
    const store = new MindStore(homeB.mindPath);
    store.expectFleet(fleet);
    const page = await signedPost<SyncPage>(identity, laptop.endpoint, "/link/sync", { have: {} });
    store.ingest(page.events);
    expect(store.activeDevice(identity.id)?.name).toBe("server");
    store.close();
    homeB.writeConfig({ v: 1, name: "server", fleet, port: portB, keystore, advertise: "127.0.0.1" });
    server = await startDaemon(homeB, {
      capabilities: fakeCaps("server", { docker: true, cores: 32, memoryGb: 128, vm: { kvm: true, tools: ["incus"] } }),
      syncIntervalMs: 150,
      proxyPort: proxyB,
      log: () => {},
    });
  });

  test("an invite used by two devices is locked (possible interception)", async () => {
    const invite = await admin(homeA, portA)<{ invite: string }>("createInvite", { kind: "node" });
    const fields = (device: string) => ({ device, name: "intruder?", kind: "node" as const, box: b64u(new Uint8Array(32)) });
    await requestPairing(invite.invite, fields(newNodeIdentity().id));
    await expect(requestPairing(invite.invite, fields(newNodeIdentity().id))).rejects.toThrow(/two devices/);
    expect((await admin(homeA, portA)("pairings")).pairings).toHaveLength(0);
  });

  test("memories written on either body reach the other", async () => {
    const callA = admin(homeA, portA);
    const callB = admin(homeB, portB);
    await callB("remember", { text: "the server has 32 cores and KVM", tags: ["fleet"] });
    await callA("remember", { text: "wckdboy uses tailscale everywhere" });
    await until(async () => (await callA("recall", { q: "KVM" })).memories.length === 1);
    await until(async () => (await callB("recall", { q: "tailscale" })).memories.length === 1);
    await until(async () => {
      const [a, b] = await Promise.all([callA<FleetView>("fleet"), callB<FleetView>("fleet")]);
      return a.digest === b.digest;
    });
  });

  test("a key added on the laptop is used by the server's gateway; the arm never sees it", async () => {
    const callA = admin(homeA, portA);
    const callB = admin(homeB, portB);
    const realKey = "sk-test-REAL-PROVIDER-KEY-0123456789";
    await callA("setSecret", { name: "mock", value: realKey, provider: "mock" });
    await callA("setProvider", { id: "mock", kind: "openai", baseUrl: `http://127.0.0.1:${upstream.port}/v1`, secret: "mock" });
    await until(async () => (await callB("providers")).providers.some((p: any) => p.id === "mock" && p.hasKey));

    const { token } = await callB<{ token: string }>("mintToken", { label: "opencode", providers: ["mock"], ttlMinutes: 5, maxRequests: 2 });
    const call = () =>
      fetch(`http://127.0.0.1:${portB}/gw/mock/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ model: "test", messages: [{ role: "user", content: "ping" }] }),
      });
    const response = await call();
    expect(response.status).toBe(200);
    expect(upstreamAuth).toBe(`Bearer ${realKey}`);
    expect(JSON.stringify(await response.json())).not.toContain(realKey);
    expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(401); // request budget exhausted
    const wrongProvider = await fetch(`http://127.0.0.1:${portB}/gw/anthropic/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": token },
      body: "{}",
    });
    expect(wrongProvider.status).toBe(401);
  });

  test("chat streams through the roster with fallback", async () => {
    const callB = admin(homeB, portB);
    await callB("setRoster", { role: "swift", models: ["nowhere/missing", "mock/test-model"] });
    const response = await fetch(`http://127.0.0.1:${portB}/api/chat`, {
      method: "POST",
      headers: { authorization: `Bearer ${homeB.adminToken()}`, "content-type": "application/json" },
      body: JSON.stringify({ role: "swift", messages: [{ role: "user", content: "greet me" }] }),
    });
    const text = await response.text();
    const events = text
      .split("\n\n")
      .filter((l) => l.startsWith("data: "))
      .map((l) => JSON.parse(l.slice(6)));
    expect(events.find((e) => e.type === "fallback")?.from).toBe("nowhere/missing");
    expect(events.filter((e) => e.type === "text").map((e) => e.text).join("")).toBe("Good day, my liege.");
    expect(events.at(-1).type).toBe("done");
  });

  test("keys pasted into chat or memory are refused and redirected to the vault", async () => {
    const post = (path: string, body: unknown) =>
      fetch(`http://127.0.0.1:${portA}${path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${homeA.adminToken()}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const key = "sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
    const chatted = await post("/api/chat", { messages: [{ role: "user", content: `use this key ${key}` }] });
    expect(chatted.status).toBe(422);
    expect((await chatted.json()).error).toMatch(/vault/);
    const remembered = await post("/api/memories", { text: `my anthropic key is ${key}` });
    expect(remembered.status).toBe(422);
    expect(JSON.stringify(laptop.store.eventsSince({}, 100_000))).not.toContain(key);
  });

  test("Galahad can request a credential; filling it on another device resolves the request", async () => {
    const callA = admin(homeA, portA);
    const callB = admin(homeB, portB);
    await callB("requestSecret", { name: "verda", provider: "verda", purpose: "Kimi K3.1 Pro for the engineer role" });
    await until(async () => (await callA("secretRequests")).requests.some((r: any) => r.name === "verda"));
    await callA("setSecret", { name: "verda", value: "verda-key-0123456789abcdef", provider: "verda" });
    await until(async () => (await callB("secretRequests")).requests.length === 0);
  });

  test("placement sends long, untrusted work to the always-on sandbox host", async () => {
    const callA = admin(homeA, portA);
    // Placement only considers peers the laptop has actually reached.
    await until(async () => (await callA<FleetView>("fleet")).peers.some((p) => p.online));
    const result = await callA("place", { longRunning: true, untrusted: true });
    expect(result.ranked[0].name).toBe("server");
    expect(result.ranked[0].reasons).toContain("always-on");
    expect(result.rejected.find((r: any) => r.name === "laptop")?.reason).toMatch(/sandbox/);
  });
});

describe("a browser client (the PWA path)", () => {
  let keys: CryptoKeyPair;
  let device: string;
  const sign = async (method: string, path: string, body: unknown) => {
    const bytes = body === undefined ? new Uint8Array() : utf8(JSON.stringify(body));
    const headers = await signRequest(device, async (m) => new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey, m)), method, path, bytes);
    return { headers: { ...headers, "content-type": "application/json" }, body: body === undefined ? undefined : bytes };
  };

  test("pairs with a non-extractable WebCrypto key and calls the API within its scopes", async () => {
    keys = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"])) as CryptoKeyPair;
    device = clientIdFromKey(new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey)));
    const callA = admin(homeA, portA);
    const invite = await callA<{ invite: string }>("createInvite", { kind: "client", scopes: ["mind:read", "chat"] });
    const join = await requestPairing(invite.invite, { device, name: "iphone", kind: "client" });
    const { pairings } = await callA("pairings");
    await callA("approvePairing", { invite: pairings[0].invite, device: pairings[0].device });
    await waitForApproval(join, { intervalMs: 50 });

    const who = await sign("GET", "/api/whoami", undefined);
    const whoami = await fetch(`http://127.0.0.1:${portA}/api/whoami`, { headers: who.headers });
    expect((await whoami.json()).scopes).toEqual(["mind:read", "chat"]);

    const recall = await sign("POST", "/api/memories/search", { q: "tailscale" });
    const found = await fetch(`http://127.0.0.1:${portA}/api/memories/search`, { method: "POST", ...recall });
    expect((await found.json()).memories[0].text).toContain("tailscale");

    // Outside its scopes:
    const write = await sign("POST", "/api/secrets", { name: "x", value: "y" });
    expect((await fetch(`http://127.0.0.1:${portA}/api/secrets`, { method: "POST", ...write })).status).toBe(403);
    // Clients can never speak the node-to-node protocol:
    const link = await sign("POST", "/link/sync", { have: {} });
    expect((await fetch(`http://127.0.0.1:${portA}/link/sync`, { method: "POST", ...link })).status).toBe(401);
  });

  test("replayed and unsigned requests are refused", async () => {
    const signed = await sign("GET", "/api/whoami", undefined);
    expect((await fetch(`http://127.0.0.1:${portA}/api/whoami`, { headers: signed.headers })).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${portA}/api/whoami`, { headers: signed.headers })).status).toBe(401);
    expect((await fetch(`http://127.0.0.1:${portA}/api/fleet`)).status).toBe(401);
  });

  test("the client's enrollment replicated to the server too", async () => {
    await until(() => server.store.activeDevice(device) !== null);
  });

  test("the tailscale-serve listener serves the PWA and signed clients, but never the admin token or gateway", async () => {
    const proxied = `http://127.0.0.1:${proxyA}`;
    expect((await fetch(`${proxied}/`)).status).toBe(200);
    const signed = await sign("GET", "/api/whoami", undefined);
    expect((await fetch(`${proxied}/api/whoami`, { headers: signed.headers })).status).toBe(200);
    const asAdmin = await fetch(`${proxied}/api/whoami`, { headers: { authorization: `Bearer ${homeA.adminToken()}` } });
    expect(asAdmin.status).toBe(401);
    const { token } = await admin(homeA, portA)<{ token: string }>("mintToken", { label: "t", ttlMinutes: 1, maxRequests: 5 });
    const viaGateway = await fetch(`${proxied}/gw/mock/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: "{}",
    });
    expect(viaGateway.status).toBe(404);
  });
});
