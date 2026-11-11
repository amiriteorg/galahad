import { type ChatMessage, type ChatStreamEvent, redact } from "@galahad/core";
import type { MindStore, Vault } from "@galahad/mind";
import { anthropicConversation, openAIConversation, type ToolCall, type ToolSpec, ToolsUnsupportedError, type TurnEnd } from "./adapters.ts";
import { isEmbeddingModel } from "./embeddings.ts";
import { GALAHAD_SYSTEM, runtimeContext, TOOL_GUIDE } from "./persona.ts";
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
  /** What the model may call while it answers, and how each call runs. */
  tools?: ChatTools;
}

/**
 * Tools for one answer. The specs stay the same for the whole answer (the provider
 * caches them, and a history naming tools it no longer sees can be refused); `run`
 * decides each call, so it can refuse one (checked input, scopes, what's already in
 * the conversation). `run` never throws: a failure is an outcome.
 */
export interface ChatTools {
  specs: ToolSpec[];
  /** The tool's title and a short, safe summary of the arguments, for the user's view. */
  describe(call: ToolCall): { title: string; input: string };
  run(call: ToolCall, signal?: AbortSignal): Promise<{ content: string; isError?: boolean; summary: string }>;
}

/** Tool rounds per answer; past it every call is refused, and then the answer ends. */
export const MAX_TOOL_ROUNDS = 12;

/** How many times an answer cut off by the model's output limit is continued. */
export const MAX_CONTINUATIONS = 3;

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
      // An embedding model can't chat: a local runtime serving the archive's embedder isn't picked for a chat role.
      const first = (await listModels(resolved, ctx.fetch)).find((m) => !isEmbeddingModel(m));
      if (first) out.push(`${provider}/${first}`);
    } catch {
      /* local runtime not running on this node */
    }
  }
  return out;
}

/**
 * Stream a reply, walking the role's roster: if a model fails *before* producing
 * anything (no key, outage, rate limit, refusal) the next one takes over. With
 * tools, the model may call them in rounds before it answers; once text has
 * streamed or a tool has run, a failure ends the answer instead (another model
 * would start over and might repeat what was done).
 */
export async function* chat(ctx: BrainContext, req: ChatRequest): AsyncGenerator<ChatStreamEvent> {
  const candidates = req.model ? [req.model] : await expand(ctx, roleModels(ctx.store, req.role ?? "planner"));
  const tools = req.tools?.specs.length ? req.tools : undefined;
  for (const ref of candidates) {
    // Stable persona first (cacheable), then what changes: the model, then recalled memories.
    const system = [GALAHAD_SYSTEM, tools ? TOOL_GUIDE : null, runtimeContext(ref), req.context].filter(Boolean).join("\n\n");
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
    const start = () =>
      (provider.kind === "anthropic" ? anthropicConversation : openAIConversation)({
        provider,
        model: parsed.model,
        system,
        messages: req.messages,
        effort: effortFor(req.role),
        signal: req.signal,
        fetch: ctx.fetch,
      });
    let conversation = start();
    let offered = tools?.specs ?? [];
    let emitted = false;
    try {
      yield { type: "model", ref };
      let spoke = false;
      let resumed = false;
      let continued = 0;
      for (let round = 0; ; round++) {
        let end: TurnEnd;
        try {
          const turn = conversation.turn(offered);
          let next = await turn.next();
          for (; !next.done; next = await turn.next()) {
            // Text after a round of tools starts a new paragraph.
            if (resumed) yield { type: "text", text: "\n\n" };
            resumed = false;
            emitted = spoke = true;
            yield { type: "text", text: next.value };
          }
          end = next.value;
        } catch (error) {
          // A runtime that can't take tools (some local models): the same model, without them.
          if (error instanceof ToolsUnsupportedError && !emitted) {
            conversation = start();
            offered = [];
            round = -1;
            continue;
          }
          throw error;
        }
        if (!end.calls.length) {
          // Cut off by the model's output limit: it goes on where it stopped, in the same answer.
          if (end.truncated && continued < MAX_CONTINUATIONS) {
            continued++;
            conversation.resume();
            round--;
            continue;
          }
          if (end.truncated) yield { type: "text", text: "\n\n*(This answer reached the model's length limit. Ask me to go on.)*" };
          break;
        }
        const calls: ToolCall[] = end.calls;
        if (round > MAX_TOOL_ROUNDS) throw new Error(`stopped after ${MAX_TOOL_ROUNDS} rounds of tools without an answer`);
        emitted = true;
        const outcomes = [];
        for (const call of calls) {
          const { title, input } = tools!.describe(call);
          yield { type: "tool", id: call.id, name: call.name, title, input };
          const outcome =
            round >= MAX_TOOL_ROUNDS
              ? { content: `No more tools for this answer (${MAX_TOOL_ROUNDS} rounds). Answer with what you have.`, isError: true, summary: "no more tools for this answer" }
              : await tools!.run(call, req.signal);
          yield { type: "tool_result", id: call.id, name: call.name, ok: !outcome.isError, summary: outcome.summary };
          outcomes.push({ id: call.id, content: outcome.content, ...(outcome.isError ? { isError: true } : {}) });
        }
        conversation.answer(outcomes);
        resumed = spoke;
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
