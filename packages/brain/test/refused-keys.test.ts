import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { newNodeIdentity } from "@galahad/core";
import { foundFleet, MindStore, Vault } from "@galahad/mind";
import { chat, GatewayTokens, handleGateway, RefusedKeys, refusedKeysOf } from "../src/index.ts";

/*
 * A provider that refuses its key (a 401 or 403 to a model call) is remembered, as a spent allowance is: which
 * provider, when, and what it said. A later call to that provider that succeeds forgets it, whichever of chat or a
 * tool's call through the gateway got through. The doctor and the Inbox say each still remembered.
 */

const NOW = Date.UTC(2026, 10, 22, 1, 28); // 22 Nov 2026 01:28 UTC

describe("a provider that refused its key", () => {
  test("is remembered with its words; a later success forgets it", () => {
    const refusals = new RefusedKeys();
    refusals.now = () => NOW;
    const kept: string[] = [];
    const forgot: string[] = [];
    refusals.kept = (r) => void kept.push(r.provider);
    refusals.forgot = (p) => void forgot.push(p);

    const refusal = refusals.note("mimo-token", 'mimo-token → 401 {"error":{"message":"Invalid API Key"}}')!;
    expect(refusal).toEqual({ provider: "mimo-token", at: NOW, said: "401: Invalid API Key" });
    expect(refusals.refused("mimo-token")).toEqual(refusal);
    expect(refusals.list()).toEqual([refusal]);
    expect(kept).toEqual(["mimo-token"]);

    refusals.forget("mimo-token");
    expect(refusals.list()).toEqual([]);
    expect(refusals.refused("mimo-token")).toBeNull();
    expect(forgot).toEqual(["mimo-token"]);
  });

  test("only a 401 or 403 is a refused key: a 429, a 500 and an empty answer aren't", () => {
    const refusals = new RefusedKeys();
    refusals.now = () => NOW;
    expect(refusals.note("deepseek", 'deepseek → 429 {"error":{"message":"slow down"}}')).toBeNull();
    expect(refusals.note("deepseek", "deepseek → 500 Internal Server Error")).toBeNull();
    expect(refusals.note("deepseek", "ended its answer without saying anything")).toBeNull();
    expect(refusals.list()).toEqual([]);
  });

  test("kept through a restart: restored refusals are as they were told", () => {
    const before = new RefusedKeys();
    before.now = () => NOW;
    const refusal = before.note("mimo-token", '401 {"error":{"message":"Invalid API Key"}}')!;
    const after = new RefusedKeys();
    after.restore([refusal]);
    expect(after.list()).toEqual([refusal]);
    expect(after.refused("mimo-token")).toEqual(refusal);
  });

  test("each node keeps its own: another mind's refusals are not this one's", () => {
    const a = new RefusedKeys();
    const b = new RefusedKeys();
    a.note("mimo-token", "401 denied");
    expect(b.list()).toEqual([]);
  });
});

function gateway(id = "mimo-token") {
  const identity = newNodeIdentity();
  const store = new MindStore(":memory:");
  foundFleet(store, identity, { fleetName: "camelot", nodeName: "ultra" });
  const vault = new Vault(store, identity);
  const baseUrl = "https://plan.invalid/v1";
  vault.set(id, ["FAKE", id, "key"].join("-"), { provider: id, origin: new URL(baseUrl).origin });
  store.emit(identity, "provider.set", { id, kind: "openai", baseUrl, secret: id });
  const tokens = new GatewayTokens(new Database(":memory:"));
  const { token } = tokens.mint({ label: "sandbox:0123456789", providers: [id], ttlMinutes: 10, maxRequests: 20 });
  const ctx = {
    store,
    vault,
    tokens,
    fetch: (async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method !== "POST") return Response.json({ data: [{ id: "glm-5.3" }] });
      return answer(init);
    }) as typeof fetch,
  };
  let answer = (_init: RequestInit) => new Response('{"error":{"message":"Invalid API Key"}}', { status: 401, headers: { "content-type": "application/json" } });
  refusedKeysOf(store).now = () => NOW;
  const call = () =>
    handleGateway(
      new Request(`http://127.0.0.1:7777/gw/${id}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ model: "glm-5.3", messages: [] }),
      }),
      ctx,
    );
  return { store, call, setAnswer: (next: (init: RequestInit) => Response) => (answer = next) };
}

describe("through the gateway", () => {
  test("a tool's 401 is remembered with its words, and a later call that got through forgets it", async () => {
    const g = gateway();
    const refused = await g.call();
    expect(refused.status).toBe(401);
    expect(await refused.text()).toContain("Invalid API Key");
    expect(refusedKeysOf(g.store).list()).toEqual([{ provider: "mimo-token", at: NOW, said: "401: Invalid API Key" }]);

    g.setAnswer(() => Response.json({ choices: [{ message: { content: "aye" } }] }));
    const through = await g.call();
    expect(through.status).toBe(200);
    expect(refusedKeysOf(g.store).list()).toEqual([]);
  });

  test("a refusal that says the key back keeps none of it: not the provider's own, nor anything shaped like a key", async () => {
    // A provider refusing a key often says it back ("Incorrect API key provided: sk-…"): the reviewer of this work asked
    // that what is remembered (and so kept in the node's database and said in the doctor and the Inbox) never holds it.
    const g = gateway();
    const own = ["FAKE", "mimo-token", "key"].join("-");
    const shaped = ["sk", "proj", "A".repeat(20), "B".repeat(20)].join("-");
    g.setAnswer(() => new Response(JSON.stringify({ error: { message: `Incorrect API key provided: ${own}. Another seen: ${shaped}` } }), { status: 401, headers: { "content-type": "application/json" } }));
    expect((await g.call()).status).toBe(401);
    const [kept] = refusedKeysOf(g.store).list();
    expect(kept!.said).toStartWith("401: Incorrect API key provided:");
    expect(kept!.said).not.toContain(own);
    expect(kept!.said).not.toContain("A".repeat(20));
  });

  test("a 429 (a spent allowance, not a refused key) is not remembered as a refused key", async () => {
    const g = gateway();
    g.setAnswer(() => new Response('{"error":{"message":"Too Many Requests"}}', { status: 429, headers: { "content-type": "application/json" } }));
    expect((await g.call()).status).toBe(429);
    expect(refusedKeysOf(g.store).list()).toEqual([]);
  });
});

describe("through chat", () => {
  function brain() {
    const id = "deepseek";
    const identity = newNodeIdentity();
    const store = new MindStore(":memory:");
    foundFleet(store, identity, { fleetName: "camelot", nodeName: "n" });
    const vault = new Vault(store, identity);
    const baseUrl = "https://deepseek.invalid/v1";
    vault.set(id, "sk-test", { provider: id, origin: new URL(baseUrl).origin });
    store.emit(identity, "provider.set", { id, kind: "openai", baseUrl, secret: id });
    store.emit(identity, "roster.set", { role: "planner", models: [`${id}/deepseek-chat`] });
    return { store, vault };
  }

  test("a call's 401 is remembered with its words, and a later call that got through forgets it", async () => {
    const ctx0 = brain();
    let refused = true;
    const fetch = (async (_url: string | URL | Request) => {
      if (refused) return new Response('{"error":{"message":"Invalid API Key"}}', { status: 401, headers: { "content-type": "application/json" } });
      return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: "Answered." }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
    }) as typeof globalThis.fetch;
    const ctx = { ...ctx0, fetch };
    refusedKeysOf(ctx.store).now = () => NOW;
    const run = async () => {
      for await (const _ of chat(ctx, { models: ["deepseek/deepseek-chat"], messages: [{ role: "user", content: "Go on" }] }));
    };

    await run();
    expect(refusedKeysOf(ctx.store).list()).toEqual([{ provider: "deepseek", at: NOW, said: "401: Invalid API Key" }]);

    refused = false;
    await run();
    expect(refusedKeysOf(ctx.store).list()).toEqual([]);
  });

  test("a failure that is not a refused key is not remembered as one", async () => {
    const ctx0 = brain();
    const fetch = (async (_url: string | URL | Request) => new Response('{"error":{"message":"the engine hiccupped"}}', { status: 500, headers: { "content-type": "application/json" } })) as typeof globalThis.fetch;
    const ctx = { ...ctx0, fetch };
    refusedKeysOf(ctx.store).now = () => NOW;
    for await (const _ of chat(ctx, { models: ["deepseek/deepseek-chat"], messages: [{ role: "user", content: "Go on" }] }));
    expect(refusedKeysOf(ctx.store).list()).toEqual([]);
  });
});
