import { describe, expect, test } from "bun:test";
import { openAIConversation } from "../src/index.ts";

/*
 * How hard an OpenAI-compatible model thinks. DeepSeek's chat completions take `reasoning_effort`
 * ("none" disables thinking; low / high / max enable it), mapped from Galahad's five levels by its
 * preset (low→low, medium→high, high→high, xhigh→max, max→max). Every other provider is asked as
 * now, with no level. An endpoint that refuses the field is asked without it, and without it from
 * then on, as `stream_options` is.
 */

type Reply = (body: any) => Response;

function scripted(replies: Reply[]) {
  const bodies: any[] = [];
  const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    bodies.push(body);
    const next = replies.shift();
    return next ? next(body) : new Response("no more responses", { status: 500 });
  }) as typeof globalThis.fetch;
  return { fetch, bodies };
}

const frame = (chunk: object) => `data: ${JSON.stringify(chunk)}\n\n`;
const sse = (body: string): Response => new Response(body, { headers: { "content-type": "text/event-stream" } });
const whole = (...chunks: object[]): Reply => () => sse(chunks.map(frame).join("") + "data: [DONE]\n\n");
const stop = { choices: [{ delta: {}, finish_reason: "stop" }] };
const words = (text: string) => ({ choices: [{ delta: { content: text } }] });

type Level = "low" | "medium" | "high" | "xhigh" | "max";
const msg = (content: string, effort?: Level) => ({ role: "user" as const, content, ...(effort ? { effort } : {}) });

const drain = async (turn: AsyncGenerator<string, unknown>) => {
  for (let next = await turn.next(); !next.done; next = await turn.next());
};

const deepseek = { id: "deepseek", kind: "openai" as const, baseUrl: "http://127.0.0.1:9/v1", apiKey: null, local: true };
const openai = { id: "openai", kind: "openai" as const, baseUrl: "http://127.0.0.1:9/v1", apiKey: null, local: true };

describe("a provider that takes a thinking level", () => {
  test("DeepSeek is asked reasoning_effort mapped from each of Galahad's levels", async () => {
    const mapped = [["low", "low"], ["medium", "high"], ["high", "high"], ["xhigh", "max"], ["max", "max"]] as const;
    for (const [level, sent] of mapped) {
      const model = scripted([whole(words("ok"), stop)]);
      const conversation = openAIConversation({ provider: deepseek, model: "deepseek-v4-pro", system: "s", messages: [msg("Hi")], effort: level, fetch: model.fetch });
      await drain(conversation.turn([]));
      expect(model.bodies[0].reasoning_effort).toBe(sent);
    }
  });

  test("the newest message that says a level is the one sent, over the call's", async () => {
    const model = scripted([whole(words("ok"), stop)]);
    const conversation = openAIConversation({
      provider: deepseek,
      model: "deepseek-v4-pro",
      system: "s",
      messages: [msg("first", "medium"), msg("then", "xhigh"), msg("last", "low")],
      effort: "high",
      fetch: model.fetch,
    });
    await drain(conversation.turn([]));
    expect(model.bodies[0].reasoning_effort).toBe("low");
  });
});

describe("every other OpenAI-compatible provider", () => {
  test("is asked with no level, whatever its messages say", async () => {
    const model = scripted([whole(words("ok"), stop)]);
    const conversation = openAIConversation({ provider: openai, model: "gpt-6.2-astra", system: "s", messages: [msg("Hi", "max")], effort: "max", fetch: model.fetch });
    await drain(conversation.turn([]));
    expect(model.bodies[0]).not.toHaveProperty("reasoning_effort");
    expect(model.bodies[0].stream_options).toEqual({ include_usage: true });
  });
});

describe("an endpoint that refuses the field", () => {
  test("is asked again without it, and so is the next call", async () => {
    const strict = { ...deepseek, baseUrl: "http://127.0.0.1:9/strict/v1" };
    const refuse: Reply = (body) =>
      body.reasoning_effort
        ? new Response(JSON.stringify({ error: { message: "Unrecognized request argument supplied: reasoning_effort" } }), { status: 400 })
        : sse(frame(words("ok")) + frame(stop) + "data: [DONE]\n\n");
    const model = scripted([refuse, refuse, refuse]);
    const first = openAIConversation({ provider: strict, model: "deepseek-v4-pro", system: "s", messages: [msg("Hi")], effort: "high", fetch: model.fetch });
    await drain(first.turn([]));
    expect(model.bodies.map((b) => b.reasoning_effort)).toEqual(["high", undefined]);
    const second = openAIConversation({ provider: strict, model: "deepseek-v4-pro", system: "s", messages: [msg("Again")], effort: "high", fetch: model.fetch });
    await drain(second.turn([]));
    expect(model.bodies.map((b) => b.reasoning_effort)).toEqual(["high", undefined, undefined]);
  });
});
