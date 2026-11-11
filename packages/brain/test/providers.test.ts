import { Database } from "bun:sqlite";
import { afterAll, describe, expect, test } from "bun:test";
import { newNodeIdentity } from "@galahad/core";
import { foundFleet, MindStore, Vault } from "@galahad/mind";
import { GatewayTokens, handleGateway, keyHeaders, listModels, preset, streamAnthropic, streamOpenAICompatible } from "../src/index.ts";

/*
 * Where a provider's key goes. Most OpenAI-compatible endpoints take it as
 * `Authorization: Bearer`; Cloudflare AI Gateway takes its own token as
 * `cf-aig-authorization` and must get no Authorization header, or it forwards that
 * to the provider instead of the key you stored with Cloudflare.
 */

const CF = "https://gateway.ai.cloudflare.com/v1/0123456789abcdef0123456789abcdef/galahad/compat";
const TOKEN = "cf_aig_FAKE_token_for_tests_0123456789";

describe("key headers", () => {
  test("by protocol and host", () => {
    expect(keyHeaders({ kind: "openai", baseUrl: "https://api.deepseek.com/v1", apiKey: "k" })).toEqual({ authorization: "Bearer k" });
    expect(keyHeaders({ kind: "anthropic", baseUrl: "https://api.anthropic.com", apiKey: "k" })).toEqual({ "x-api-key": "k" });
    expect(keyHeaders({ kind: "openai", baseUrl: CF, apiKey: "k" })).toEqual({ "cf-aig-authorization": "Bearer k" });
    expect(keyHeaders({ kind: "openai", baseUrl: "http://127.0.0.1:11434/v1", apiKey: null })).toEqual({});
  });

  test("Cloudflare AI Gateway is a preset that says how to point it", () => {
    expect(preset("cloudflare-ai")).toMatchObject({ kind: "openai", baseUrl: "" });
    expect(preset("cloudflare-ai")!.note).toContain("gateway.ai.cloudflare.com/v1/<account id>/<gateway id>/compat");
  });

  test("chat through Cloudflare sends the gateway token in its own header, and no Authorization", async () => {
    const seen: Headers[] = [];
    const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      seen.push(new Headers(init?.headers));
      return new Response('data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } });
    }) as typeof globalThis.fetch;
    let text = "";
    for await (const chunk of streamOpenAICompatible({
      provider: { id: "cloudflare-ai", kind: "openai", baseUrl: CF, apiKey: TOKEN, local: false },
      model: "deepseek/deepseek-chat",
      system: "s",
      messages: [{ role: "user", content: "hello" }],
      effort: "medium",
      fetch,
    })) text += chunk;
    expect(text).toBe("hi");
    expect(seen[0]!.get("cf-aig-authorization")).toBe(`Bearer ${TOKEN}`);
    expect(seen[0]!.has("authorization")).toBe(false);
  });

  test("the model gateway lends Cloudflare to tools the same way", async () => {
    const identity = newNodeIdentity();
    const store = new MindStore(":memory:");
    foundFleet(store, identity, { fleetName: "camelot", nodeName: "ultra" });
    const vault = new Vault(store, identity);
    vault.set("cloudflare-ai", TOKEN, { provider: "cloudflare-ai", origin: "https://gateway.ai.cloudflare.com" });
    store.emit(identity, "provider.set", { id: "cloudflare-ai", kind: "openai", baseUrl: CF, secret: "cloudflare-ai" });
    const tokens = new GatewayTokens(new Database(":memory:"));
    const { token } = tokens.mint({ label: "arm", providers: ["cloudflare-ai"], ttlMinutes: 10, maxRequests: 5 });
    const seen: { url: string; headers: Headers }[] = [];
    const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), headers: new Headers(init?.headers) });
      return Response.json({ ok: true });
    }) as typeof globalThis.fetch;
    const response = await handleGateway(
      new Request("http://127.0.0.1:7777/gw/cloudflare-ai/chat/completions", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: "{}" }),
      { store, vault, tokens, fetch },
    );
    expect(response.status).toBe(200);
    expect(seen[0]!.url).toBe(`${CF}/chat/completions`);
    expect(seen[0]!.headers.get("cf-aig-authorization")).toBe(`Bearer ${TOKEN}`);
    // The tool's own gateway token stays behind; nothing goes out as Authorization.
    expect(seen[0]!.headers.has("authorization")).toBe(false);
  });
});

/*
 * A key is pinned to the origin it was entered for. A redirect answered by that origin
 * must not carry the key (or the conversation) on to another one: fetch keeps custom
 * headers such as x-api-key and cf-aig-authorization across origins, and resends the body.
 */
describe("a provider's key never follows a redirect", () => {
  const KEY = "sk-FAKE-key-for-redirect-tests-0000";
  const elsewhere: { path: string; key: string | null }[] = [];
  const other = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (req) => {
      elsewhere.push({ path: new URL(req.url).pathname, key: req.headers.get("x-api-key") ?? req.headers.get("authorization") });
      return Response.json({ data: [] });
    },
  });
  // The provider the key is pinned to answers every request by pointing somewhere else.
  const pinned = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.redirect(`http://localhost:${other.port}/elsewhere`, 307) });
  const baseUrl = `http://127.0.0.1:${pinned.port}`;
  afterAll(async () => {
    await pinned.stop(true);
    await other.stop(true);
  });

  test("through the model gateway", async () => {
    const identity = newNodeIdentity();
    const store = new MindStore(":memory:");
    foundFleet(store, identity, { fleetName: "camelot", nodeName: "ultra" });
    const vault = new Vault(store, identity);
    vault.set("claude", KEY, { provider: "claude", origin: baseUrl });
    store.emit(identity, "provider.set", { id: "claude", kind: "anthropic", baseUrl, secret: "claude" });
    const tokens = new GatewayTokens(new Database(":memory:"));
    const { token } = tokens.mint({ label: "arm", providers: ["claude"], ttlMinutes: 10, maxRequests: 5 });
    elsewhere.length = 0;
    const response = await handleGateway(
      new Request("http://127.0.0.1:7777/gw/claude/v1/messages", { method: "POST", headers: { "x-api-key": token, "content-type": "application/json" }, body: "{}" }),
      { store, vault, tokens },
    );
    expect(elsewhere).toEqual([]);
    // The tool sees that the provider redirected; it isn't told where to.
    expect(response.status).toBe(307);
    expect(response.headers.has("location")).toBe(false);
  });

  test("when listing a provider's models", async () => {
    elsewhere.length = 0;
    await expect(listModels({ id: "claude", kind: "anthropic", baseUrl, apiKey: KEY, local: false })).rejects.toThrow("307");
    expect(elsewhere).toEqual([]);
  });

  test("in chat with an OpenAI-compatible provider", async () => {
    elsewhere.length = 0;
    const answer = (async () => {
      for await (const _ of streamOpenAICompatible({ provider: { id: "p", kind: "openai", baseUrl, apiKey: KEY, local: false }, model: "m", system: "s", messages: [{ role: "user", content: "hello" }], effort: "medium" })) void _;
    })();
    await expect(answer).rejects.toThrow("307");
    expect(elsewhere).toEqual([]);
  });

  test("in chat with Claude", async () => {
    elsewhere.length = 0;
    const answer = (async () => {
      for await (const _ of streamAnthropic({ provider: { id: "claude", kind: "anthropic", baseUrl, apiKey: KEY, local: false }, model: "claude-opus-5-5", system: "s", messages: [{ role: "user", content: "hello" }], effort: "medium" })) void _;
    })();
    await expect(answer).rejects.toThrow();
    expect(elsewhere).toEqual([]);
  });
});
