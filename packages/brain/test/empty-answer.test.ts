import { describe, expect, test } from "bun:test";
import { type ChatStreamEvent, newNodeIdentity } from "@galahad/core";
import { foundFleet, MindStore, Vault } from "@galahad/mind";
import { chat, type ChatTools } from "../src/index.ts";

/*
 * An answer with no words in it is never an answer. A reply that stops arriving before
 * the model was done, or one that ends cleanly with nothing said, is a failure that
 * says so: the next model takes over if nothing had happened yet, and otherwise the
 * answer ends with an error. Neither is ever kept as "done".
 */

function brain(models: string[]) {
  const identity = newNodeIdentity();
  const store = new MindStore(":memory:");
  foundFleet(store, identity, { fleetName: "camelot", nodeName: "n" });
  const vault = new Vault(store, identity);
  store.emit(identity, "provider.set", { id: "local", kind: "openai", baseUrl: "http://127.0.0.1:9/v1" });
  store.emit(identity, "roster.set", { role: "planner", models });
  return { store, vault };
}

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

const frame = (chunk: object) => `data: ${JSON.stringify(chunk)}\n\n`;
const sse = (body: string): Response => new Response(body, { headers: { "content-type": "text/event-stream" } });
/** A whole reply: its chunks, then the stream's own end. */
const whole = (...chunks: object[]): Reply => () => sse(chunks.map(frame).join("") + "data: [DONE]\n\n");
const stop = { choices: [{ delta: {}, finish_reason: "stop" }] };
const words = (text: string) => ({ choices: [{ delta: { content: text } }] });
const calls = (id: string, args: object) => [{ choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name: "post", arguments: JSON.stringify(args) } }] } }] }, { choices: [{ delta: {}, finish_reason: "tool_calls" }] }];

const tools = (): ChatTools & { ran: number } => {
  const t = {
    ran: 0,
    specs: [{ name: "post", description: "Post a note.", inputSchema: { type: "object", properties: { text: { type: "string" } } } }],
    describe: (call: { input: unknown }) => ({ title: "Post a note", input: JSON.stringify(call.input) }),
    run: async () => {
      t.ran++;
      return { content: "posted", summary: "posted" };
    },
  };
  return t;
};

const ask = (content: string) => [{ role: "user" as const, content }];
const all = async (events: AsyncGenerator<ChatStreamEvent>) => {
  const out: ChatStreamEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
};
const types = (events: ChatStreamEvent[]) => events.map((e) => e.type);
const textOf = (events: ChatStreamEvent[]) => events.flatMap((e) => (e.type === "text" ? [e.text] : [])).join("");
const errorOf = (events: ChatStreamEvent[]) => events.flatMap((e) => (e.type === "error" ? [e.error] : [])).join("");

describe("an answer with no words in it", () => {
  test("a reply that stops arriving before the model was done is an error, never a finished answer", async () => {
    // Half a sentence, and then the stream just ends: no finish reason, no end-of-stream marker.
    const model = scripted([() => sse(frame(words("Half a sen")))]);
    const events = await all(chat({ ...brain(["local/a"]), fetch: model.fetch }, { messages: ask("Go on") }));
    expect(textOf(events)).toBe("Half a sen");
    expect(types(events)).not.toContain("done");
    expect(errorOf(events)).toMatch(/stopped arriving before it was finished/);
  });

  test("after his tools ran, a reply that ends cleanly with nothing said is an error that says what did arrive", async () => {
    const t = tools();
    const model = scripted([
      whole(...calls("c1", { text: "one" })),
      // It ends properly, but its words went somewhere this node doesn't read.
      whole({ choices: [{ delta: { reasoning: "I should summarise now." } }] }, stop),
    ]);
    const events = await all(chat({ ...brain(["local/a"]), fetch: model.fetch }, { messages: ask("Post it, then tell me"), tools: t }));
    expect(t.ran).toBe(1);
    expect(types(events)).not.toContain("done");
    expect(errorOf(events)).toMatch(/ended its answer without saying anything/);
    expect(errorOf(events)).toMatch(/finish reason: stop/);
    expect(errorOf(events)).toMatch(/reasoning/);
  });

  test("he may end without another word when he has already spoken in this answer", async () => {
    const t = tools();
    const model = scripted([whole(words("Posting it now."), ...calls("c1", { text: "one" })), whole(stop)]);
    const events = await all(chat({ ...brain(["local/a"]), fetch: model.fetch }, { messages: ask("Post it"), tools: t }));
    expect(textOf(events)).toBe("Posting it now.");
    expect(types(events).at(-1)).toBe("done");
    expect(errorOf(events)).toBe("");
  });

  test("a first reply with nothing in it: the next model takes over", async () => {
    const model = scripted([whole(stop), whole(words("Here I am."), stop)]);
    const events = await all(chat({ ...brain(["local/a", "local/b"]), fetch: model.fetch }, { messages: ask("Anyone?") }));
    expect(types(events)).toEqual(["model", "fallback", "model", "text", "done"]);
    expect(textOf(events)).toBe("Here I am.");
    expect(model.bodies.map((b) => b.model)).toEqual(["a", "b"]);
  });
});
