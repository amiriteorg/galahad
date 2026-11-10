import Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage } from "@galahad/core";
import type { Effort } from "./roster.ts";
import { keyHeaders, type ResolvedProvider } from "./providers.ts";

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

/** Models that accept Anthropic's server-side refusal fallback ("default" routing). */
const SERVER_FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

/** Claude via the official SDK: adaptive thinking, explicit effort, streaming. */
export async function* streamAnthropic(input: CompletionInput): AsyncGenerator<string> {
  if (!input.provider.apiKey) throw new Error(`${input.provider.id} has no API key`);
  const client = new Anthropic({ apiKey: input.provider.apiKey, baseURL: input.provider.baseUrl, maxRetries: 2 });
  const serverFallback = input.provider.baseUrl === "https://api.anthropic.com" && SERVER_FALLBACK_MODELS.has(input.model);
  const stream = client.beta.messages.stream(
    {
      model: input.model,
      max_tokens: 64_000,
      system: input.system,
      messages: input.messages,
      thinking: { type: "adaptive" },
      output_config: { effort: input.effort },
      ...(serverFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    },
    { signal: input.signal },
  );
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") yield event.delta.text;
  }
  const final = await stream.finalMessage();
  if (final.stop_reason === "refusal") throw new RefusalError(`${input.model} declined this request`);
}

/** Any OpenAI-compatible endpoint (DeepSeek, OrcaRouter, Abliteration, Verda, Ollama, llama.cpp …). */
export async function* streamOpenAICompatible(input: CompletionInput): AsyncGenerator<string> {
  const response = await (input.fetch ?? fetch)(`${input.provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...keyHeaders(input.provider),
    },
    body: JSON.stringify({
      model: input.model,
      stream: true,
      messages: [{ role: "system", content: input.system }, ...input.messages],
    }),
    signal: input.signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(`${input.provider.id} → ${response.status} ${(await response.text().catch(() => "")).slice(0, 300)}`);
  }
  for await (const data of sseData(response.body)) {
    if (data === "[DONE]") return;
    let chunk: { choices?: { delta?: { content?: string | null } }[]; error?: { message?: string } };
    try {
      chunk = JSON.parse(data);
    } catch {
      continue;
    }
    if (chunk.error) throw new Error(`${input.provider.id}: ${chunk.error.message ?? "stream error"}`);
    const text = chunk.choices?.[0]?.delta?.content;
    if (text) yield text;
  }
}

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
