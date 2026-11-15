import { describe, expect, test } from "bun:test";
import { newNodeIdentity } from "@galahad/core";
import { foundFleet, MindStore, Vault } from "@galahad/mind";
import { anthropicConversation, chat, type ChatTools, openAIConversation } from "../src/index.ts";

/*
 * What a provider may keep in its cache from one call to the next. Anthropic caches only what a call marks: on its own
 * API every call marks the tools and the system prompt (the same in every call of a conversation, and from one turn to
 * the next) and the conversation so far, so the next call reads them at a tenth of the price or less. What changes from
 * turn to turn (the memories recalled for your question) comes after the first mark. Elsewhere nothing new is sent.
 */

type Reply = () => Response;

function scripted(replies: Reply[]) {
  const bodies: any[] = [];
  const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    const next = replies.shift();
    return next ? next() : new Response("no more responses", { status: 500 });
  }) as typeof globalThis.fetch;
  return { fetch, bodies };
}

/** Anthropic's stream for one call: its blocks, the deltas that fill them, how it stopped. */
function anthropicStream(blocks: object[], deltas: object[][], stopReason: string): Reply {
  const events: [string, object][] = [
    ["message_start", { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } }],
  ];
  blocks.forEach((block, index) => {
    events.push(["content_block_start", { type: "content_block_start", index, content_block: block }]);
    for (const delta of deltas[index] ?? []) events.push(["content_block_delta", { type: "content_block_delta", index, delta }]);
    events.push(["content_block_stop", { type: "content_block_stop", index }]);
  });
  events.push(["message_delta", { type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 20 } }]);
  events.push(["message_stop", { type: "message_stop" }]);
  return () => new Response(events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
}

const toolCall = anthropicStream([{ type: "tool_use", id: "toolu_1", name: "post", input: {} }], [[{ type: "input_json_delta", partial_json: '{"text":"hi"}' }]], "tool_use");
const answer = (text: string) => anthropicStream([{ type: "text", text: "" }], [[{ type: "text_delta", text }]], "end_turn");
const post = { name: "post", description: "Post a note.", inputSchema: { type: "object", properties: { text: { type: "string" } } } };
const ask = (content: string) => [{ role: "user" as const, content }];
const provider = (baseUrl: string, kind: "anthropic" | "openai" = "anthropic") => ({ id: "p", kind, baseUrl, apiKey: "test-key-FAKE-0000", local: false }) as never;
const drain = async (turn: AsyncGenerator<string, unknown>) => {
  for (let next = await turn.next(); !next.done; next = await turn.next());
};
/** A request body without its cache marks: what must stay byte for byte the same from one call to the next. */
const unmarked = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (key, v) => (key === "cache_control" ? undefined : v)));

describe("prompt caching", () => {
  test("on Anthropic's own API, each call marks the tools and system prompt, and the conversation so far, for its cache", async () => {
    const model = scripted([toolCall, answer("Posted.")]);
    const conversation = anthropicConversation({ provider: provider("https://api.anthropic.com"), model: "claude-opus-5-5", system: "Who he is.", context: "What he recalled.", messages: ask("Post hi."), effort: "low", fetch: model.fetch });
    await drain(conversation.turn([post]));
    conversation.answer([{ id: "toolu_1", content: "posted" }]);
    await drain(conversation.turn([post]));
    const [first, second] = model.bodies;
    // The tools and the system prompt end at the first mark; what he recalled comes after it, unmarked.
    expect(first.system).toEqual([
      { type: "text", text: "Who he is.", cache_control: { type: "ephemeral" } },
      { type: "text", text: "What he recalled." },
    ]);
    // The conversation so far: the API marks its last block itself, so the mark moves on as it grows.
    expect(first.cache_control).toEqual({ type: "ephemeral" });
    expect(second.cache_control).toEqual({ type: "ephemeral" });
    // What the next call reads from the cache is exactly what the call before it sent: nothing before it changed.
    expect(unmarked(second.system)).toEqual(unmarked(first.system));
    expect(unmarked(second.tools)).toEqual(unmarked(first.tools));
    expect(unmarked(second.messages.slice(0, first.messages.length))).toEqual(unmarked(first.messages));
  });

  test("an Anthropic-compatible endpoint that isn't Anthropic's is sent what it was before: one system prompt and no marks", async () => {
    const model = scripted([answer("Hi.")]);
    const conversation = anthropicConversation({ provider: provider("https://anthropic.test"), model: "claude-opus-5-5", system: "Who he is.", context: "What he recalled.", messages: ask("Hi"), effort: "low", fetch: model.fetch });
    await drain(conversation.turn([post]));
    expect(model.bodies[0].system).toBe("Who he is.\n\nWhat he recalled.");
    expect(JSON.stringify(model.bodies[0])).not.toContain("cache_control");
  });

  test("an OpenAI-compatible provider caches by prefix on its own: its system message is the prompt, then what he recalled", async () => {
    const model = scripted([() => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: "Hi." }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } })]);
    const conversation = openAIConversation({ provider: provider("http://127.0.0.1:9/v1", "openai"), model: "m", system: "Who he is.", context: "What he recalled.", messages: ask("Hi"), effort: "low", fetch: model.fetch });
    await drain(conversation.turn([]));
    expect(model.bodies[0].messages[0]).toEqual({ role: "system", content: "Who he is.\n\nWhat he recalled." });
  });

  test("a chat's recalled memories go after the cached part, so a new question reads the persona and tools from the cache", async () => {
    const identity = newNodeIdentity();
    const store = new MindStore(":memory:");
    foundFleet(store, identity, { fleetName: "camelot", nodeName: "n" });
    const vault = new Vault(store, identity);
    vault.set("claude", "test-anthropic-key-FAKE-0000", { provider: "claude", origin: "https://api.anthropic.com" });
    store.emit(identity, "provider.set", { id: "claude", kind: "anthropic", baseUrl: "https://api.anthropic.com", secret: "claude" });
    store.emit(identity, "roster.set", { role: "planner", models: ["claude/claude-opus-5-5"] });
    const tools: ChatTools = { specs: [post], describe: () => ({ title: "Post", input: "" }), run: async () => ({ content: "posted", summary: "posted" }) };
    const asked = async (question: string, recalled: string) => {
      const model = scripted([answer("Noted.")]);
      for await (const _ of chat({ store, vault, fetch: model.fetch }, { messages: ask(question), context: recalled, tools }));
      return model.bodies[0];
    };
    const monday = await asked("What's on Monday?", "Recalled: the dentist on Monday.");
    const friday = await asked("And Friday?", "Recalled: a flight on Friday.");
    // The persona, its guides and the model it runs on: the same for both questions, and marked.
    expect(friday.system[0]).toEqual(monday.system[0]);
    expect(monday.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(monday.system[0].text).not.toContain("dentist");
    expect(monday.system.at(-1)).toEqual({ type: "text", text: "Recalled: the dentist on Monday." });
    expect(friday.system.at(-1)).toEqual({ type: "text", text: "Recalled: a flight on Friday." });
  });
});
