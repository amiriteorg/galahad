import type { ProviderView } from "@galahad/core";
import type { MindStore, Vault } from "@galahad/mind";

export type ProviderKind = "openai" | "anthropic";

export interface ProviderPreset {
  id: string;
  kind: ProviderKind;
  baseUrl: string;
  /** Key prefixes that identify this provider when you just paste a key. */
  keyPrefixes?: string[];
  /** Runs on the node itself (no key, nothing leaves the machine). */
  local?: boolean;
  note?: string;
}

/**
 * Starting points, not hard-coded truth: everything here is overridable with
 * `galahad provider add`. Base URLs were checked against each provider's docs
 * (Nov 2026); Verda's endpoint is account-specific so it must be supplied.
 */
export const PRESETS: ProviderPreset[] = [
  { id: "anthropic", kind: "anthropic", baseUrl: "https://api.anthropic.com", keyPrefixes: ["sk-ant-"] },
  { id: "deepseek", kind: "openai", baseUrl: "https://api.deepseek.com/v1" },
  { id: "abliteration", kind: "openai", baseUrl: "https://api.abliteration.ai/v1" },
  { id: "orcarouter", kind: "openai", baseUrl: "https://api.orcarouter.ai/v1", keyPrefixes: ["sk-orca-"] },
  { id: "openrouter", kind: "openai", baseUrl: "https://openrouter.ai/api/v1", keyPrefixes: ["sk-or-"] },
  { id: "moonshot", kind: "openai", baseUrl: "https://api.moonshot.ai/v1" },
  {
    id: "cloudflare-ai",
    kind: "openai",
    baseUrl: "",
    note: "Cloudflare AI Gateway's OpenAI-compatible endpoint: --base-url https://gateway.ai.cloudflare.com/v1/<account id>/<gateway id>/compat. The key is the gateway's token; the providers' own keys stay stored in Cloudflare. Models are named <provider>/<model>, e.g. deepseek/deepseek-chat.",
  },
  {
    id: "verda",
    kind: "openai",
    baseUrl: "",
    note: "Verda's OpenAI-compatible endpoint is shown in your Verda console; pass it with --base-url",
  },
  { id: "ollama", kind: "openai", baseUrl: "http://127.0.0.1:11434/v1", local: true },
  { id: "llamacpp", kind: "openai", baseUrl: "http://127.0.0.1:8080/v1", local: true },
];

export const preset = (id: string): ProviderPreset | undefined => PRESETS.find((p) => p.id === id);

/** Guess the provider from a pasted key, when the key format is distinctive. */
export function detectProvider(key: string): string | null {
  const sorted = PRESETS.flatMap((p) => (p.keyPrefixes ?? []).map((prefix) => ({ id: p.id, prefix }))).sort(
    (a, b) => b.prefix.length - a.prefix.length,
  );
  return sorted.find(({ prefix }) => key.startsWith(prefix))?.id ?? null;
}

export interface ProviderRecord {
  id: string;
  kind: ProviderKind;
  baseUrl: string;
  secret?: string;
  label?: string;
}

export interface ResolvedProvider extends ProviderRecord {
  apiKey: string | null;
  local: boolean;
}

const isLocalUrl = (url: string) => /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\//.test(`${url}/`);

export function providerRecords(store: MindStore): ProviderRecord[] {
  return store.lwwPrefix<ProviderRecord>("provider:").map((entry) => entry.value!);
}

export function providerRecord(store: MindStore, id: string): ProviderRecord | null {
  return store.lww<ProviderRecord>(`provider:${id}`)?.value ?? null;
}

export const originOf = (url: string): string | null => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

/**
 * Whether the provider may use its configured key. A key is only ever sent to the
 * origin it was pinned to when you entered it, and only for the provider it was
 * entered for, so repointing a provider (or borrowing another provider's key)
 * cannot carry the key to a host of someone else's choosing.
 */
export function keyUsable(vault: Vault, record: ProviderRecord): boolean {
  if (!record.secret) return false;
  const info = vault.info(record.secret);
  return !!info && info.provider === record.id && !!info.origin && info.origin === originOf(record.baseUrl);
}

/** Provider config plus its key, decrypted in memory on this node only. */
export function resolveProvider(store: MindStore, vault: Vault, id: string): ResolvedProvider | null {
  const record = providerRecord(store, id);
  if (!record) return null;
  let apiKey: string | null = null;
  if (keyUsable(vault, record)) {
    try {
      apiKey = vault.reveal(record.secret!);
    } catch {
      apiKey = null;
    }
  }
  return { ...record, apiKey, local: isLocalUrl(record.baseUrl) };
}

/**
 * One-time migration: keys entered before origin pinning are pinned to the origin
 * their provider uses *now* (trusted configuration). Idempotent.
 */
export function pinLegacyKeys(store: MindStore, vault: Vault): string[] {
  if (!vault.unlocked()) return [];
  const pinned: string[] = [];
  for (const record of providerRecords(store)) {
    if (!record.secret) continue;
    const info = vault.info(record.secret);
    const origin = originOf(record.baseUrl);
    if (info && !info.origin && info.provider === record.id && origin && vault.pin(record.secret, origin)) pinned.push(record.secret);
  }
  return pinned;
}

export function providerViews(store: MindStore, vault: Vault): ProviderView[] {
  return providerRecords(store).map((p) => ({
    id: p.id,
    kind: p.kind,
    baseUrl: p.baseUrl,
    secret: p.secret ?? null,
    label: p.label ?? null,
    hasKey: keyUsable(vault, p),
  }));
}

/** Hosts whose OpenAI-compatible endpoint takes the key in a header of its own. */
const KEY_HEADERS: Record<string, string> = {
  // Cloudflare AI Gateway: the gateway's token goes in cf-aig-authorization, and no Authorization
  // header at all, so Cloudflare adds the provider key you stored with it (an Authorization
  // header would be forwarded to the provider as its key).
  "https://gateway.ai.cloudflare.com": "cf-aig-authorization",
};

/** The headers that carry a provider's key, by its protocol and host. */
export function keyHeaders(provider: { kind: ProviderKind; baseUrl: string; apiKey: string | null }): Record<string, string> {
  if (!provider.apiKey) return {};
  if (provider.kind === "anthropic") return { "x-api-key": provider.apiKey };
  return { [KEY_HEADERS[originOf(provider.baseUrl) ?? ""] ?? "authorization"]: `Bearer ${provider.apiKey}` };
}

/** Ask a provider which models it serves (OpenAI-style and Anthropic `/v1/models`). */
export async function listModels(provider: ResolvedProvider, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const url = provider.kind === "anthropic" ? `${provider.baseUrl}/v1/models?limit=100` : `${provider.baseUrl}/models`;
  const headers: Record<string, string> = { ...keyHeaders(provider), ...(provider.kind === "anthropic" ? { "anthropic-version": "2023-06-01" } : {}) };
  const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(provider.local ? 1500 : 10_000) });
  if (!response.ok) throw new Error(`${provider.id} /models → ${response.status}`);
  const json = (await response.json()) as { data?: { id: string }[] };
  return (json.data ?? []).map((m) => m.id).sort();
}
