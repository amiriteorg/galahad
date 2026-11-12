import { type ChatMessage, type ChatStreamEvent, redact } from "@galahad/core";
import type { MindStore, Vault } from "@galahad/mind";
import { anthropicConversation, openAIConversation, RefusalError, type ToolCall, type ToolImage, type ToolSpec, ToolsUnsupportedError, type TurnEnd } from "./adapters.ts";
import { rotated } from "./effort.ts";
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
  /** Start the role's models at this position (effort: each parallel attempt takes another one first). */
  rotate?: number;
  /** Messages the owner sends while this answer is under way: each reaches the model at the next safe point. */
  steering?: Steering;
}

/**
 * Steering: what the owner says while an answer is under way. Whoever owns the turn offers
 * each message; `chat()` takes them at the next safe point (a model call is ended cleanly;
 * a running tool finishes and reports first; tools not yet started aren't run) and goes on
 * with them, as with any message of the owner's. When the answer ends with nothing waiting
 * it accepts no more: a message after that belongs to a new turn.
 */
export class Steering {
  private pending: string[] = [];
  private closed = false;
  private readonly listeners = new Set<() => void>();

  /** The owner's message for the answer under way. False once the answer has ended: send it as a new message. */
  offer(text: string): boolean {
    if (this.closed) return false;
    this.pending.push(text);
    for (const listener of [...this.listeners]) listener();
    return true;
  }

  /** How many messages wait to be handed over. */
  get waiting(): number {
    return this.pending.length;
  }

  /** Everything waiting, in the order it came. */
  take(): string[] {
    const taken = this.pending;
    this.pending = [];
    return taken;
  }

  /** The answer has come to its end: what arrived in time is taken (and the answer goes on); nothing waiting, and it's over. */
  finish(): string[] {
    const late = this.take();
    if (!late.length) this.closed = true;
    return late;
  }

  /** The answer ended some other way (an error, a stop): no more is accepted, and what never reached him is handed back. */
  close(): string[] {
    this.closed = true;
    return this.take();
  }

  /** Told when a message arrives. Returns how to stop listening. */
  onArrive(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }
}

/** What a tool that hadn't started is answered with when a message from the owner arrived first. */
const NOT_RUN = {
  content: "Not run: a new message from your liege arrived before this call started. Read it first; call the tool again only if it is still wanted.",
  isError: true,
  summary: "not run: your new message came first",
} as const;

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
  /** A result may carry pictures (the chalkboard): models that see get them, the rest their descriptions. */
  run(call: ToolCall, signal?: AbortSignal): Promise<{ content: string; isError?: boolean; summary: string; images?: ToolImage[] }>;
  /**
   * Whether running this call only looks (it changes nothing, so a model that takes an answer over may run
   * it again). Absent, or false: it may change something, and is never run twice for one answer.
   */
  readOnly?(call: ToolCall): boolean;
}

/** Tool rounds per answer; past it every call is refused, and then the answer ends. */
export const MAX_TOOL_ROUNDS = 12;

/** How many times an answer cut off by the model's output limit is continued. */
export const MAX_CONTINUATIONS = 3;

/**
 * How many times one model call is asked again when its provider's filter ended it before it said or asked
 * for anything. Such filters aren't steady (the same conversation passes the next time more often than not),
 * and asking again loses nothing: what he'd said and done stays, and no tool is run twice.
 */
export const MAX_REFUSAL_RETRIES = 2;

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
 * would start over and might repeat what was done). One exception: a model that
 * declines for good after it has only looked (no tool that changes anything has
 * run) hands the answer to the next one, which starts it again from your message.
 */
export async function* chat(ctx: BrainContext, req: ChatRequest): AsyncGenerator<ChatStreamEvent> {
  const listed = req.model ? [req.model] : await expand(ctx, roleModels(ctx.store, req.role ?? "planner"));
  // A parallel attempt starts at another of the role's models; the rest stay its fallbacks, in order.
  const candidates = req.rotate ? rotated(listed, req.rotate) : listed;
  const tools = req.tools?.specs.length ? req.tools : undefined;
  const steering = req.steering;
  // Every message handed over so far: a model that takes over (or starts again without tools) is handed them too.
  const handed: string[][] = [];
  /** A tool that may change something has run for this answer: from then on no other model takes it over. */
  let changed = false;
  /** He has said something in this answer (whichever model said it). */
  let wrote = false;
  /** Why the model that had begun this answer declined, when another was asked to take it over. */
  let declined: string | null = null;
  /** Another model has taken the answer over after words were said: its first words are a paragraph of their own. */
  let apart = false;
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
    const start = () => {
      const fresh = (provider.kind === "anthropic" ? anthropicConversation : openAIConversation)({
        provider,
        model: parsed.model,
        system,
        messages: req.messages,
        effort: effortFor(req.role),
        signal: req.signal,
        fetch: ctx.fetch,
      });
      for (const texts of handed) fresh.interject(texts, "");
      return fresh;
    };
    let conversation = start();
    let offered = tools?.specs ?? [];
    let emitted = false;
    try {
      yield { type: "model", ref };
      let spoke = false;
      let resumed = false;
      let continued = 0;
      let refused = 0;
      // The owner's message(s) reach him: the turn goes on with them, as with a new message of theirs.
      const handOver = function* (texts: string[], partial: string | null): Generator<ChatStreamEvent> {
        conversation.interject(texts, partial);
        handed.push(texts);
        for (const text of texts) yield { type: "steer", text };
        // What follows answers a new message: its own paragraphs, its own continuations.
        spoke = resumed = false;
        continued = 0;
      };
      for (let round = 0; ; round++) {
        // A message that came while a tool ran (or before he began): he's told before the next model call.
        const waiting = steering?.take() ?? [];
        if (waiting.length) {
          yield* handOver(waiting, null);
          round = 0;
        }
        let end: TurnEnd;
        // A message arriving ends this one model call cleanly; the turn's own signal still ends everything.
        const cut = new AbortController();
        const deaf = steering?.onArrive(() => cut.abort());
        let said = "";
        try {
          const turn = conversation.turn(offered, steering ? (req.signal ? AbortSignal.any([req.signal, cut.signal]) : cut.signal) : undefined);
          let next = await turn.next();
          for (; !next.done; next = await turn.next()) {
            // Text after a round of tools starts a new paragraph.
            if (resumed || apart) yield { type: "text", text: "\n\n" };
            resumed = apart = false;
            emitted = spoke = wrote = true;
            said += next.value;
            yield { type: "text", text: next.value };
          }
          end = next.value;
        } catch (error) {
          // Cut short for the owner's message (not a stop): what he'd said stays said, and the turn goes on with it.
          const arrived = cut.signal.aborted && !req.signal?.aborted ? (steering?.take() ?? []) : [];
          if (arrived.length) {
            yield* handOver(arrived, said);
            round = -1;
            continue;
          }
          // Declined before this call came to anything: the same call, again (see MAX_REFUSAL_RETRIES).
          if (error instanceof RefusalError && !said && refused < MAX_REFUSAL_RETRIES && !req.signal?.aborted) {
            refused++;
            round--;
            continue;
          }
          // A runtime that can't take tools (some local models): the same model, without them.
          if (error instanceof ToolsUnsupportedError && !emitted) {
            conversation = start();
            offered = [];
            round = -1;
            continue;
          }
          throw error;
        } finally {
          deaf?.();
        }
        refused = 0;
        if (!end.calls.length) {
          // Cut off by the model's output limit: it goes on where it stopped, in the same answer.
          if (end.truncated && continued < MAX_CONTINUATIONS) {
            continued++;
            conversation.resume();
            round--;
            continue;
          }
          if (end.truncated) yield { type: "text", text: "\n\n*(This answer reached the model's length limit. Ask me to go on.)*" };
          // A message that arrived as he finished is answered in this turn, after the whole answer. None: it's over.
          const late = steering?.finish() ?? [];
          if (late.length) {
            yield* handOver(late, null);
            round = -1;
            continue;
          }
          // An answer with no words in it is not an answer: it failed, and says how the provider ended it.
          if (!spoke) throw new Error(`${ref} ended its answer without saying anything${end.detail ? ` (${end.detail})` : ""}`);
          break;
        }
        const calls: ToolCall[] = end.calls;
        if (round > MAX_TOOL_ROUNDS) throw new Error(`stopped after ${MAX_TOOL_ROUNDS} rounds of tools without an answer`);
        emitted = true;
        const outcomes = [];
        for (const call of calls) {
          const { title, input } = tools!.describe(call);
          yield { type: "tool", id: call.id, name: call.name, title, input };
          // A tool that is running always finishes and reports. One that hasn't started when a message
          // arrives isn't run: every call still gets its outcome, and this one's says why.
          const runs = !steering?.waiting && round < MAX_TOOL_ROUNDS;
          if (runs && !tools!.readOnly?.(call)) changed = true;
          const outcome = steering?.waiting
            ? NOT_RUN
            : round >= MAX_TOOL_ROUNDS
              ? { content: `No more tools for this answer (${MAX_TOOL_ROUNDS} rounds). Answer with what you have.`, isError: true, summary: "no more tools for this answer" }
              : await tools!.run(call, req.signal);
          yield { type: "tool_result", id: call.id, name: call.name, ok: !outcome.isError, summary: outcome.summary };
          outcomes.push({ id: call.id, content: outcome.content, ...(outcome.isError ? { isError: true } : {}), ...("images" in outcome && outcome.images?.length ? { images: outcome.images } : {}) });
        }
        conversation.answer(outcomes);
        resumed = spoke;
      }
      yield { type: "done", ref };
      return;
    } catch (error) {
      // Some providers echo the credential in error text; never let it reach a client.
      const message = redact(String((error as Error).message ?? error), [provider.apiKey]).slice(0, 500);
      // Declined for good, and all he had done was look: the next model takes the answer over from your message.
      const handsOver = error instanceof RefusalError && emitted && !changed && !req.signal?.aborted;
      if ((emitted && !handsOver) || req.signal?.aborted) {
        yield { type: "error", error: message };
        return;
      }
      if (handsOver) {
        declined = message;
        apart = wrote;
      }
      yield { type: "fallback", from: ref, error: message };
    }
  }
  yield { type: "error", error: declined ? `${declined}. No other model in the roster could take the answer over.` : "no model in the roster could answer; add a key or adjust the roster" };
}
