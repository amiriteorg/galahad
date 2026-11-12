import { describe, expect, test } from "bun:test";
import { newNodeIdentity } from "@galahad/core";
import { foundFleet, MindStore, Vault } from "@galahad/mind";
import { see, seeingModel, seeingRole, type ToolImage } from "../src/index.ts";

/*
 * Looking at pictures (vision.ts): one question about a picture, to a model that
 * sees, with no tools. Which role has such a model, cheapest first; how the
 * picture reaches Claude and an Ollama vision model; and that a model that can't
 * see is never sent one. Against stand-in providers.
 */

const FRAME: ToolImage = { mediaType: "image/jpeg", data: "/9j/4AAQFAKEJPEG", alt: "He is at his hearth." };

function brain(roster: Record<string, string[]>, opts: { claudeKey?: boolean } = {}) {
  const identity = newNodeIdentity();
  const store = new MindStore(":memory:");
  foundFleet(store, identity, { fleetName: "camelot", nodeName: "n" });
  const vault = new Vault(store, identity);
  store.emit(identity, "provider.set", { id: "deepseek", kind: "openai", baseUrl: "https://deepseek.test/v1", secret: "deepseek" });
  vault.set("deepseek", "test-deepseek-key-FAKE-0000", { provider: "deepseek", origin: "https://deepseek.test" });
  store.emit(identity, "provider.set", { id: "ollama", kind: "openai", baseUrl: "http://127.0.0.1:11434/v1" });
  store.emit(identity, "provider.set", { id: "claude", kind: "anthropic", baseUrl: "https://anthropic.test", secret: "claude" });
  if (opts.claudeKey !== false) vault.set("claude", "test-anthropic-key-FAKE-0000", { provider: "claude", origin: "https://anthropic.test" });
  for (const [role, models] of Object.entries(roster)) store.emit(identity, "roster.set", { role, models });
  return { store, vault };
}

function scripted(responses: (() => Response)[]) {
  const bodies: any[] = [];
  const urls: string[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    urls.push(String(url));
    if (init?.body) bodies.push(JSON.parse(String(init.body)));
    const next = responses.shift();
    return next ? next() : new Response("no more responses", { status: 500 });
  }) as typeof globalThis.fetch;
  return { fetch, bodies, urls };
}

const openai = (text: string) => () => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
function anthropic(text: string) {
  const events: [string, object][] = [
    ["message_start", { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-haiku-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 20 } }],
    ["message_stop", { type: "message_stop" }],
  ];
  return () => new Response(events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
}
const text = async (stream: AsyncGenerator<string>) => {
  let out = "";
  for await (const chunk of stream) out += chunk;
  return out;
};

describe("which model looks", () => {
  test("a role's first usable model that sees; a model that can't see, or has no key, is passed over", async () => {
    const ctx = brain({ swift: ["deepseek/deepseek-chat", "claude/claude-haiku-5-5"], reviewer: ["deepseek/deepseek-chat"], planner: ["claude/claude-opus-5-5"] });
    expect(await seeingModel(ctx, "swift")).toBe("claude/claude-haiku-5-5");
    expect(await seeingModel(ctx, "reviewer")).toBeNull();
    expect(await seeingRole(ctx, ["reviewer", "swift", "planner"])).toEqual({ role: "swift", ref: "claude/claude-haiku-5-5" });
    expect(await seeingRole(ctx, ["reviewer"])).toBeNull();
    const noKey = brain({ swift: ["claude/claude-haiku-5-5"] }, { claudeKey: false });
    expect(await seeingModel(noKey, "swift")).toBeNull();
  });

  test("`ollama/*`: the first model that runtime serves that sees, never one that doesn't", async () => {
    const ctx = brain({ swift: ["ollama/*"] });
    const served = (ids: string[]) => scripted([() => Response.json({ data: ids.map((id) => ({ id })) })]).fetch;
    expect(await seeingModel({ ...ctx, fetch: served(["qwen3-embedding:0.6b", "llama3.1:8b", "gemma3:4b"]) }, "swift")).toBe("ollama/gemma3:4b");
    expect(await seeingModel({ ...ctx, fetch: served(["llama3.1:8b"]) }, "swift")).toBeNull();
    // The runtime isn't running: none.
    expect(await seeingModel({ ...ctx, fetch: (async () => Promise.reject(new Error("refused"))) as unknown as typeof fetch }, "swift")).toBeNull();
  });
});

describe("how the picture reaches the model", () => {
  test("Claude: an image block leading the user's message, then the question", async () => {
    const model = scripted([anthropic('{"findings":[]}')]);
    const ctx = { ...brain({}), fetch: model.fetch };
    const answer = await text(see(ctx, { ref: "claude/claude-haiku-5-5", role: "swift", system: "You look at pictures.", prompt: "What looks wrong?", images: [FRAME] }));
    expect(answer).toBe('{"findings":[]}');
    expect(model.bodies[0].system).toBe("You look at pictures.");
    expect(model.bodies[0].messages).toEqual([
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: FRAME.data } },
          { type: "text", text: "What looks wrong?" },
        ],
      },
    ]);
    expect(model.bodies[0].tools).toBeUndefined();
  });

  test("an Ollama vision model: the question, then the picture as an image_url part", async () => {
    const model = scripted([openai("Nothing looks wrong.")]);
    const ctx = { ...brain({}), fetch: model.fetch };
    expect(await text(see(ctx, { ref: "ollama/gemma3:4b", role: "swift", system: "s", prompt: "What looks wrong?", images: [FRAME] }))).toBe("Nothing looks wrong.");
    expect(model.bodies[0].messages.at(-1)).toEqual({
      role: "user",
      content: [
        { type: "text", text: "What looks wrong?" },
        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${FRAME.data}` } },
      ],
    });
  });

  test("a model that can't see is never sent a picture: asking it is refused before anything leaves", () => {
    const model = scripted([]);
    const ctx = { ...brain({}), fetch: model.fetch };
    expect(() => see(ctx, { ref: "deepseek/deepseek-chat", role: "swift", system: "s", prompt: "p", images: [FRAME] })).toThrow(/can't see pictures/);
    expect(() => see(ctx, { ref: "nowhere/model", role: "swift", system: "s", prompt: "p", images: [FRAME] })).toThrow(/not configured/);
    expect(model.urls).toEqual([]);
  });
});
