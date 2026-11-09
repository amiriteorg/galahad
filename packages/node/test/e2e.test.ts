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

  test("the same device id presenting different keys also locks the invite (review #11)", async () => {
    const invite = await admin(homeA, portA)<{ invite: string }>("createInvite", { kind: "node" });
    const id = newNodeIdentity();
    await requestPairing(invite.invite, { device: id.id, name: "x", kind: "node", box: b64u(id.boxPublic) });
    await expect(
      requestPairing(invite.invite, { device: id.id, name: "x", kind: "node", box: b64u(newNodeIdentity().boxPublic) }),
    ).rejects.toThrow(/two devices/);
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
    await callA("setSecret", { name: "mock", value: realKey, provider: "mock", baseUrl: `http://127.0.0.1:${upstream.port}/v1` });
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

  test("a provider repointed to another host never receives the key (review #2)", async () => {
    const callA = admin(homeA, portA);
    let evilAuth: string | null | undefined;
    const evil = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        evilAuth = req.headers.get("authorization");
        return Response.json({ data: [{ id: "stolen" }] });
      },
    });
    try {
      await callA("setProvider", { id: "mock", kind: "openai", baseUrl: `http://127.0.0.1:${evil.port}/v1`, secret: "mock" });
      // The model list call would have carried the key to the new host. It goes out keyless.
      await callA("providerModels", { id: "mock" });
      expect(evilAuth).toBeNull();
      expect((await callA("providers")).providers.find((p: any) => p.id === "mock").hasKey).toBe(false);
      // Borrowing another provider's key does not work either.
      await callA("setProvider", { id: "thief", kind: "openai", baseUrl: `http://127.0.0.1:${evil.port}/v1`, secret: "mock" });
      await callA("providerModels", { id: "thief" });
      expect(evilAuth).toBeNull();
    } finally {
      evil.stop(true);
      await callA("setProvider", { id: "mock", kind: "openai", baseUrl: `http://127.0.0.1:${upstream.port}/v1`, secret: "mock" });
      await callA("removeProvider", { id: "thief" });
    }
    expect((await callA("providers")).providers.find((p: any) => p.id === "mock").hasKey).toBe(true);
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
    // An "assistant" message is sent to the provider too, so it is scanned as well (review #13).
    const smuggled = await post("/api/chat", {
      messages: [
        { role: "assistant", content: `noted: ${key}` },
        { role: "user", content: "continue" },
      ],
    });
    expect(smuggled.status).toBe(422);
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

  test("sandbox requests are routed to a named node, with its answer relayed faithfully", async () => {
    const callA = admin(homeA, portA);
    // Neither test node runs Docker: unpinned work finds no host…
    await expect(callA("createSandbox", { network: "isolated" })).rejects.toThrow(/424.*no sandbox host/);
    // …and work pinned to the server is forwarded there (signed as the laptop) and refused by it.
    await expect(callA("createSandbox", { network: "isolated", on: "server" })).rejects.toThrow(/424.*server: this node is not a sandbox host/);
    await expect(callA("sandboxes", { on: "nowhere" })).rejects.toThrow(/404/);
  });

  test("the ledger is readable fleet-wide", async () => {
    const { entries } = await admin(homeB, portB)("ledger");
    expect(Array.isArray(entries)).toBe(true);
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

  test("a phone can approve phones but never a new machine (review #2)", async () => {
    const callA = admin(homeA, portA);
    const nodeInvite = await callA<{ invite: string }>("createInvite", { kind: "node" });
    const joiner = newNodeIdentity();
    await requestPairing(nodeInvite.invite, { device: joiner.id, name: "rogue", kind: "node", box: b64u(joiner.boxPublic) });
    const pending = (await callA("pairings")).pairings.find((p: any) => p.device === joiner.id);
    // Give this phone fleet:admin for the test, then try to approve the machine with it.
    const invite = await callA<{ invite: string }>("createInvite", { kind: "client", scopes: ["fleet:admin"] });
    const phone = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"])) as CryptoKeyPair;
    const phoneId = clientIdFromKey(new Uint8Array(await crypto.subtle.exportKey("raw", phone.publicKey)));
    const join = await requestPairing(invite.invite, { device: phoneId, name: "phone", kind: "client" });
    const p2 = (await callA("pairings")).pairings.find((p: any) => p.device === phoneId);
    await callA("approvePairing", { invite: p2.invite, device: p2.device });
    await waitForApproval(join, { intervalMs: 50 });
    const body = utf8(JSON.stringify({ invite: pending.invite, device: pending.device }));
    const headers = await signRequest(phoneId, async (m) => new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, phone.privateKey, m)), "POST", "/api/pairings/approve", body);
    const response = await fetch(`http://127.0.0.1:${portA}/api/pairings/approve`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body });
    expect(response.status).toBe(403);
    expect(laptop.store.device(joiner.id)).toBeNull();
    await callA("rejectPairing", { invite: pending.invite, device: pending.device });
  });

  test("client invites default to least privilege (no gateway minting)", async () => {
    const callA = admin(homeA, portA);
    const invite = await callA<{ invite: string }>("createInvite", { kind: "client" });
    const key = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"])) as CryptoKeyPair;
    const id = clientIdFromKey(new Uint8Array(await crypto.subtle.exportKey("raw", key.publicKey)));
    const join = await requestPairing(invite.invite, { device: id, name: "tablet", kind: "client" });
    const pending = (await callA("pairings")).pairings.find((p: any) => p.device === id);
    await callA("approvePairing", { invite: pending.invite, device: pending.device });
    await waitForApproval(join, { intervalMs: 50 });
    expect(laptop.store.device(id)?.scopes).not.toContain("gateway:mint");
  });

  test("permissions can be granted to a paired device from a terminal, never by the device itself", async () => {
    // Even a phone that holds fleet:admin cannot raise its own permissions.
    await admin(homeA, portA)("setDeviceScopes", { device, scopes: [...laptop.store.device(device)!.scopes, "fleet:admin"] });
    const before = laptop.store.device(device)!.scopes;
    expect(before).toContain("fleet:admin");
    expect(before).not.toContain("sandbox");
    const self = await sign("POST", "/api/devices/scopes", { device, scopes: [...before, "sandbox", "gateway:mint"] });
    const refused = await fetch(`http://127.0.0.1:${portA}/api/devices/scopes`, { method: "POST", ...self });
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { error: string }).error).toMatch(/terminal/);
    // You grant it from the terminal:
    await admin(homeA, portA)("setDeviceScopes", { device, scopes: [...before, "sandbox"] });
    const who = await sign("GET", "/api/whoami", undefined);
    expect((await (await fetch(`http://127.0.0.1:${portA}/api/whoami`, { headers: who.headers })).json()).scopes).toContain("sandbox");
  });

  test("a key pasted into a provider's URL or label never lands in the log", async () => {
    const response = await fetch(`http://127.0.0.1:${portA}/api/providers`, {
      method: "POST",
      headers: { authorization: `Bearer ${homeA.adminToken()}`, "content-type": "application/json" },
      body: JSON.stringify({ id: "oops", kind: "openai", baseUrl: "https://example.com/v1", label: "sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123" }),
    });
    expect(response.status).toBe(422);
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
