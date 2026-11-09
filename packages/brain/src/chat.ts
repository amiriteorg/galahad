import { type ChatMessage, type ChatStreamEvent, redact } from "@galahad/core";
import type { MindStore, Vault } from "@galahad/mind";
import { streamAnthropic, streamOpenAICompatible } from "./adapters.ts";
import { GALAHAD_SYSTEM, runtimeContext } from "./persona.ts";
import { listModels, resolveProvider } from "./providers.ts";
import { effortFor, parseRef, roleModels } from "./roster.ts";

export interface BrainContext {
  store: MindStore;
  vault: Vault;
  fetch?: typeof fetch;
}

export interface ChatRequest {
  role?: string;
  model?: string;
  messages: ChatMessage[];
  /** Appended after the stable persona (keeps the cacheable prefix intact). */
  context?: string;
  signal?: AbortSignal;
}

/** Expand `<provider>/*` wildcards into the first model that provider serves on this node. */
async function expand(ctx: BrainContext, refs: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const ref of refs) {
    const { provider, model } = parseRef(ref);
    if (model !== "*") {
      out.push(ref);
      continue;
    }
    const resolved = resolveProvider(ctx.store, ctx.vault, provider);
    if (!resolved) continue;
    try {
      const first = (await listModels(resolved, ctx.fetch))[0];
      if (first) out.push(`${provider}/${first}`);
    } catch {
      /* local runtime not running on this node */
    }
  }
  return out;
}

/**
 * Stream a reply, walking the role's roster: if a model fails *before* producing
 * any text (no key, outage, rate limit, refusal) the next one takes over.
 */
export async function* chat(ctx: BrainContext, req: ChatRequest): AsyncGenerator<ChatStreamEvent> {
  const candidates = req.model ? [req.model] : await expand(ctx, roleModels(ctx.store, req.role ?? "planner"));
  for (const ref of candidates) {
    // Stable persona first (cacheable), then what changes: the model, then recalled memories.
    const system = [GALAHAD_SYSTEM, runtimeContext(ref), req.context].filter(Boolean).join("\n\n");
    let parsed: { provider: string; model: string };
    try {
      parsed = parseRef(ref);
    } catch (error) {
      yield { type: "fallback", from: ref, error: (error as Error).message };
      continue;
    }
    const provider = resolveProvider(ctx.store, ctx.vault, parsed.provider);
    if (!provider) {
      yield { type: "fallback", from: ref, error: `provider "${parsed.provider}" is not configured` };
      continue;
    }
    if (!provider.apiKey && !provider.local) {
      yield { type: "fallback", from: ref, error: `provider "${parsed.provider}" has no key in the vault` };
      continue;
    }
    const stream = (provider.kind === "anthropic" ? streamAnthropic : streamOpenAICompatible)({
      provider,
      model: parsed.model,
      system,
      messages: req.messages,
      effort: effortFor(req.role),
      signal: req.signal,
      fetch: ctx.fetch,
    });
    let emitted = false;
    try {
      yield { type: "model", ref };
      for await (const text of stream) {
        emitted = true;
        yield { type: "text", text };
      }
      yield { type: "done", ref };
      return;
    } catch (error) {
      // Some providers echo the credential in error text; never let it reach a client.
      const message = redact(String((error as Error).message ?? error), [provider.apiKey]).slice(0, 500);
      if (emitted || req.signal?.aborted) {
        yield { type: "error", error: message };
        return;
      }
      yield { type: "fallback", from: ref, error: message };
    }
  }
  yield { type: "error", error: "no model in the roster could answer; add a key or adjust the roster" };
}
