import Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage } from "@galahad/core";
import type { Effort } from "./roster.ts";
import { keyHeaders, type ResolvedProvider, withoutRedirects } from "./providers.ts";

export interface CompletionInput {
  provider: ResolvedProvider;
  model: string;
  system: string;
  messages: ChatMessage[];
  effort: Effort;
  signal?: AbortSignal;
  fetch?: typeof fetch;
}

export class RefusalError extends Error {}

/** The model can't take tools at all (some local runtimes); the caller asks again without them. */
export class ToolsUnsupportedError extends Error {}

/** A tool as a model sees it: a name, when to use it, and a JSON Schema for its input. */
export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** A call the model made. The input is the model's, unchecked: validate it before running anything. */
export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolOutcome {
  id: string;
  content: string;
  isError?: boolean;
}

/** How a turn ended: the tools it called (none: the answer is complete), or cut off by the output limit. */
export interface TurnEnd {
  calls: ToolCall[];
  truncated: boolean;
}

/** What a model is told when its answer was cut off by its output limit. */
export const CONTINUE =
  "Your answer was cut off by the output limit. Continue exactly where it stopped (mid-sentence if need be), without repeating anything and without mentioning the cut.";

/**
 * One model, one answer, any number of tool rounds. Each turn streams text and then
 * says how it ended; `answer` hands back the outcomes of the tools it called, and
 * `resume` asks it to go on after its output limit cut it off. The provider's own
 * format (Anthropic's thinking blocks with their signatures, OpenAI's tool_calls)
 * stays inside.
 */
export interface Conversation {
  turn(tools: ToolSpec[]): AsyncGenerator<string, TurnEnd>;
  answer(outcomes: ToolOutcome[]): void;
  resume(): void;
}

/** Models that accept Anthropic's server-side refusal fallback ("default" routing). */
const SERVER_FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

/** Claude via the official SDK: adaptive thinking, explicit effort, streaming, tools. */
export function anthropicConversation(input: CompletionInput): Conversation {
  const client = new Anthropic({ apiKey: input.provider.apiKey ?? "", baseURL: input.provider.baseUrl, maxRetries: 2, fetch: withoutRedirects(input.fetch) });
  const serverFallback = input.provider.baseUrl === "https://api.anthropic.com" && SERVER_FALLBACK_MODELS.has(input.model);
  const messages: Anthropic.Beta.BetaMessageParam[] = input.messages.map((m) => ({ role: m.role, content: m.content }));
  let last: Anthropic.Beta.BetaContentBlockParam[] = [];
  return {
    async *turn(tools) {
      if (!input.provider.apiKey) throw new Error(`${input.provider.id} has no API key`);
      // pause_turn only comes from server-side tools; resume it a few times, never forever.
      for (let pauses = 0; ; pauses++) {
        const stream = client.beta.messages.stream(
          {
            model: input.model,
            max_tokens: 64_000,
            system: input.system,
            messages,
            thinking: { type: "adaptive" },
            output_config: { effort: input.effort },
            ...(tools.length ? { tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema })) } : {}),
            ...(serverFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
          },
          { signal: input.signal },
        );
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") yield event.delta.text;
        }
        const final = await stream.finalMessage();
        // A refusal can cut a tool call off mid-input: never run that turn's tools.
        if (final.stop_reason === "refusal") throw new RefusalError(`${input.model} declined this request`);
        if (final.stop_reason === "pause_turn" && pauses < 3) {
          messages.push({ role: "assistant", content: final.content as Anthropic.Beta.BetaContentBlockParam[] });
          continue;
        }
        const calls = final.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
        if (!calls.length) {
          last = final.content as Anthropic.Beta.BetaContentBlockParam[];
          return { calls: [], truncated: final.stop_reason === "max_tokens" };
        }
        if (final.stop_reason === "max_tokens") throw new Error(`${input.model} ran out of room in the middle of a tool call`);
        // The whole turn goes back as it came, thinking blocks and signatures included.
        messages.push({ role: "assistant", content: final.content as Anthropic.Beta.BetaContentBlockParam[] });
        return { calls: calls.map((b) => ({ id: b.id, name: b.name, input: b.input })), truncated: false };
      }
    },
    answer(outcomes) {
      messages.push({
        role: "user",
        content: outcomes.map((o) => ({ type: "tool_result" as const, tool_use_id: o.id, content: o.content, ...(o.isError ? { is_error: true } : {}) })),
      });
    },
    resume() {
      if (last.length) messages.push({ role: "assistant", content: last });
      messages.push({ role: "user", content: CONTINUE });
    },
  };
}

type OpenAIMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; reasoning_content?: string; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
  | { role: "tool"; tool_call_id: string; content: string };

interface OpenAIChunk {
  choices?: {
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string | Record<string, unknown> } }[];
    };
    finish_reason?: string | null;
  }[];
  error?: { message?: string };
}

/** Any OpenAI-compatible endpoint (DeepSeek, Mistral, Cloudflare AI Gateway, Ollama, llama.cpp …), with function calling. */
export function openAIConversation(input: CompletionInput): Conversation {
  const messages: OpenAIMessage[] = [{ role: "system", content: input.system }, ...input.messages];
  let last = "";
  return {
    async *turn(tools) {
      const response = await (input.fetch ?? fetch)(`${input.provider.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...keyHeaders(input.provider) },
        body: JSON.stringify({
          model: input.model,
          stream: true,
          messages,
          ...(tools.length ? { tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } })) } : {}),
        }),
        redirect: "manual",
        signal: input.signal,
      });
      if (!response.ok || !response.body) {
        const body = (await response.text().catch(() => "")).slice(0, 300);
        if (tools.length && response.status >= 400 && response.status < 500 && /\btools?\b|function/i.test(body)) {
          throw new ToolsUnsupportedError(`${input.provider.id}/${input.model} doesn't take tools`);
        }
        throw new Error(`${input.provider.id} → ${response.status} ${body}`);
      }
      let text = "";
      let reasoning = "";
      let finish: string | null = null;
      const calls = new Map<number, { id: string; name: string; args: string }>();
      for await (const data of sseData(response.body)) {
        if (data === "[DONE]") break;
        let chunk: OpenAIChunk;
        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }
        if (chunk.error) throw new Error(`${input.provider.id}: ${chunk.error.message ?? "stream error"}`);
        const delta = chunk.choices?.[0]?.delta;
        finish = chunk.choices?.[0]?.finish_reason ?? finish;
        if (delta?.reasoning_content) reasoning += delta.reasoning_content;
        for (const part of delta?.tool_calls ?? []) {
          const index = part.index ?? calls.size;
          const slot = calls.get(index) ?? { id: "", name: "", args: "" };
          if (part.id) slot.id = part.id;
          if (part.function?.name && !slot.name) slot.name = part.function.name;
          const args = part.function?.arguments;
          if (args !== undefined) slot.args += typeof args === "string" ? args : JSON.stringify(args);
          calls.set(index, slot);
        }
        if (delta?.content) {
          text += delta.content;
          yield delta.content;
        }
      }
      if (!calls.size) {
        last = text;
        return { calls: [], truncated: finish === "length" };
      }
      if (finish === "length") throw new Error(`${input.provider.id}/${input.model} ran out of room in the middle of a tool call`);
      const list = [...calls.entries()].sort(([a], [b]) => a - b).map(([index, c]) => ({ ...c, id: c.id || `call_${index}`, args: c.args || "{}" }));
      messages.push({
        role: "assistant",
        content: text || null,
        // Reasoning models (DeepSeek's thinking mode) want their reasoning back within a tool loop.
        ...(reasoning ? { reasoning_content: reasoning } : {}),
        tool_calls: list.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.args } })),
      });
      return { calls: list.map((c) => ({ id: c.id, name: c.name, input: parseArgs(c.args) })), truncated: false };
    },
    answer(outcomes) {
      for (const o of outcomes) messages.push({ role: "tool", tool_call_id: o.id, content: o.isError ? `Error: ${o.content}` : o.content });
    },
    resume() {
      if (last) messages.push({ role: "assistant", content: last });
      messages.push({ role: "user", content: CONTINUE });
    },
  };
}

/** The model's arguments; anything that isn't JSON comes back as the raw text, which validation then refuses. */
function parseArgs(args: string): unknown {
  try {
    return JSON.parse(args);
  } catch {
    return args;
  }
}

/** One turn, no tools: plain streamed text (for callers that only want an answer). */
async function* textOnly(conversation: Conversation): AsyncGenerator<string> {
  const turn = conversation.turn([]);
  for (let next = await turn.next(); !next.done; next = await turn.next()) yield next.value;
}

/** Claude via the official SDK, text only. */
export const streamAnthropic = (input: CompletionInput): AsyncGenerator<string> => textOnly(anthropicConversation(input));

/** Any OpenAI-compatible endpoint, text only. */
export const streamOpenAICompatible = (input: CompletionInput): AsyncGenerator<string> => textOnly(openAIConversation(input));

/** Minimal server-sent-events reader that tolerates arbitrary chunk boundaries. */
export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      if (line.startsWith("data:")) yield line.slice(5).trimStart();
    }
  }
  if (buffer.startsWith("data:")) yield buffer.slice(5).trimStart();
}
