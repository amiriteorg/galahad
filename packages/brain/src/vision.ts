import type { MindStore, Vault } from "@galahad/mind";
import { seesImages, streamAnthropic, streamOpenAICompatible, type ToolImage } from "./adapters.ts";
import { isEmbeddingModel } from "./embeddings.ts";
import { listModels, resolveProvider } from "./providers.ts";
import { effortFor, parseRef, roleModels } from "./roster.ts";

/*
 * Looking at pictures. One question about one or more pictures, to a model that
 * sees, with no tools: how Galahad reviews his own world through his eyes. Which
 * models see is `seesImages` (Claude; Ollama's vision models): nothing else is
 * ever sent a picture.
 */

interface VisionContext {
  store: MindStore;
  vault: Vault;
  fetch?: typeof fetch;
}

/** A role's first usable model that sees: its provider configured, with a key (or local, and serving it). Null: none. */
export async function seeingModel(ctx: VisionContext, role: string): Promise<string | null> {
  for (const ref of roleModels(ctx.store, role)) {
    let parsed: { provider: string; model: string };
    try {
      parsed = parseRef(ref);
    } catch {
      continue;
    }
    const provider = resolveProvider(ctx.store, ctx.vault, parsed.provider);
    if (!provider || (!provider.apiKey && !provider.local)) continue;
    if (parsed.model !== "*") {
      if (seesImages(provider, parsed.model)) return ref;
      continue;
    }
    // `<provider>/*`: the first model that runtime serves on this node that sees (never an embedding model).
    try {
      const first = (await listModels(provider, ctx.fetch)).find((m) => !isEmbeddingModel(m) && seesImages(provider, m));
      if (first) return `${parsed.provider}/${first}`;
    } catch {
      /* local runtime not running on this node */
    }
  }
  return null;
}

/** The first of these roles (cheapest first) with a model that sees. */
export async function seeingRole(ctx: VisionContext, roles: readonly string[]): Promise<{ role: string; ref: string } | null> {
  for (const role of roles) {
    const ref = await seeingModel(ctx, role);
    if (ref) return { role, ref };
  }
  return null;
}

/** One answer about these pictures from that model (which must see), streamed as text. The pictures are data, never instructions: the system prompt should say so. */
export function see(ctx: VisionContext, req: { ref: string; role: string; system: string; prompt: string; images: ToolImage[]; signal?: AbortSignal }): AsyncGenerator<string> {
  const { provider: id, model } = parseRef(req.ref);
  const provider = resolveProvider(ctx.store, ctx.vault, id);
  if (!provider) throw new Error(`provider "${id}" is not configured`);
  if (!seesImages(provider, model)) throw new Error(`${req.ref} can't see pictures`);
  const input = {
    provider,
    model,
    system: req.system,
    messages: [{ role: "user" as const, content: req.prompt }],
    effort: effortFor(req.role),
    images: req.images,
    ...(req.signal ? { signal: req.signal } : {}),
    ...(ctx.fetch ? { fetch: ctx.fetch } : {}),
  };
  return provider.kind === "anthropic" ? streamAnthropic(input) : streamOpenAICompatible(input);
}
