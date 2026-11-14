import type { Database } from "bun:sqlite";
import { randomId, redact, sha256B64u } from "@galahad/core";
import type { MindStore, Vault } from "@galahad/mind";
import { gatewaySession, keyHeaders, planOf, resolveProvider } from "./providers.ts";

/*
 * The model gateway: how arms (OpenCode, Claude Code, Codex, Hermes, sandboxes)
 * use your API keys without ever seeing them.
 *
 *   OPENAI_BASE_URL    = http://127.0.0.1:<port>/gw/deepseek
 *   ANTHROPIC_BASE_URL = http://127.0.0.1:<port>/gw/anthropic
 *   *_API_KEY          = gw_…  (scoped to providers, expires, capped, revocable)
 *
 * The gateway injects the real key on the way out. A prompt-injected arm can at
 * worst burn its own capped token; it can never exfiltrate the provider key.
 * Tokens are node-local (never replicated) and stored only as hashes.
 */

export interface TokenScope {
  label: string;
  providers?: string[];
  ttlMinutes: number;
  maxRequests: number;
}

export interface TokenInfo {
  hash: string;
  label: string;
  providers: string[] | null;
  expiresAt: number;
  maxRequests: number;
  used: number;
}

export class GatewayTokens {
  constructor(
    private readonly db: Database,
    private readonly now: () => number = Date.now,
  ) {
    db.exec(`CREATE TABLE IF NOT EXISTS gw_tokens (
      hash TEXT PRIMARY KEY, label TEXT NOT NULL, providers TEXT, expires_at INTEGER NOT NULL,
      max_requests INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`);
  }

  mint(scope: TokenScope): { token: string; info: TokenInfo } {
    const token = `gw_${randomId(32)}`;
    const hash = sha256B64u(token);
    const expiresAt = this.now() + scope.ttlMinutes * 60_000;
    this.db
      .query("INSERT INTO gw_tokens (hash, label, providers, expires_at, max_requests, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(hash, scope.label, scope.providers ? JSON.stringify(scope.providers) : null, expiresAt, scope.maxRequests, this.now());
    return { token, info: this.info(hash)! };
  }

  /** Atomically checks scope and consumes one request. */
  consume(token: string, provider: string): { ok: true } | { ok: false; reason: string } {
    if (!/^gw_[A-Za-z0-9_-]{43}$/.test(token)) return { ok: false, reason: "not a gateway token" };
    const hash = sha256B64u(token);
    const info = this.info(hash);
    if (!info) return { ok: false, reason: "unknown token" };
    if (info.expiresAt <= this.now()) return { ok: false, reason: "token expired" };
    if (info.providers && !info.providers.includes(provider)) return { ok: false, reason: `token not valid for ${provider}` };
    const updated = this.db
      .query("UPDATE gw_tokens SET used = used + 1 WHERE hash = ? AND used < max_requests")
      .run(hash).changes;
    return updated ? { ok: true } : { ok: false, reason: "token request budget exhausted" };
  }

  revoke(hash: string): boolean {
    return this.db.query("DELETE FROM gw_tokens WHERE hash = ?").run(hash).changes > 0;
  }

  list(): TokenInfo[] {
    return this.db
      .query<TokenRow, []>("SELECT * FROM gw_tokens ORDER BY created_at DESC")
      .all()
      .map(toInfo);
  }

  /** The label a token was minted with (e.g. "sandbox:<id>"), without spending it; null if it isn't one. */
  labelOf(token: string): string | null {
    if (!/^gw_[A-Za-z0-9_-]{43}$/.test(token)) return null;
    return this.info(sha256B64u(token))?.label ?? null;
  }

  private info(hash: string): TokenInfo | null {
    const row = this.db.query<TokenRow, [string]>("SELECT * FROM gw_tokens WHERE hash = ?").get(hash);
    return row ? toInfo(row) : null;
  }
}

interface TokenRow {
  hash: string;
  label: string;
  providers: string | null;
  expires_at: number;
  max_requests: number;
  used: number;
}

const toInfo = (row: TokenRow): TokenInfo => ({
  hash: row.hash,
  label: row.label,
  providers: row.providers ? (JSON.parse(row.providers) as string[]) : null,
  expiresAt: row.expires_at,
  maxRequests: row.max_requests,
  used: row.used,
});

const FORWARDED_HEADERS = ["content-type", "accept", "anthropic-version", "anthropic-beta", "openai-beta", "user-agent"];

export interface GatewayContext {
  store: MindStore;
  vault: Vault;
  tokens: GatewayTokens;
  fetch?: typeof fetch;
}

const json = (status: number, error: string) =>
  Response.json({ error: { type: "galahad_gateway", message: error } }, { status });

/** Handles `/gw/<provider>/<rest>` by forwarding to the provider with the real key. */
export async function handleGateway(request: Request, ctx: GatewayContext): Promise<Response> {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/gw\/([A-Za-z0-9._:-]+)\/(.+)$/);
  if (!match) return json(404, "use /gw/<provider>/<path>");
  const [, providerId, rest] = match as unknown as [string, string, string];
  if (rest.split("/").some((segment) => segment === ".." || segment === ".")) return json(400, "bad path");

  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  const token = bearer ?? request.headers.get("x-api-key") ?? "";
  const verdict = ctx.tokens.consume(token, providerId);
  if (!verdict.ok) return json(401, verdict.reason);

  // The one place a coding plan's key is handed over: to a tool, calling as itself.
  const provider = resolveProvider(ctx.store, ctx.vault, providerId, "tool");
  if (!provider) return json(404, `provider ${providerId} is not configured`);
  if (!provider.apiKey && !provider.local) return json(424, `provider ${providerId} has no key on this fleet`);

  const headers = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  // A plan that routes a conversation by its session refuses a call without one: the tool's own goes on as it
  // sent it, and a tool that sent none is given its VM's.
  const session = planOf(providerId)?.session;
  if (session) {
    const own = request.headers.get(session);
    headers.set(session, own && /^[\x21-\x7e]{1,128}$/.test(own) ? own : gatewaySession(token));
  }
  for (const [name, value] of Object.entries(keyHeaders(provider))) headers.set(name, value);
  const target = `${provider.baseUrl.replace(/\/$/, "")}/${rest}${url.search}`;
  const upstream = await (ctx.fetch ?? fetch)(target, {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer(),
    // The key is pinned to this provider's origin: it never chases a Location header to another host.
    redirect: "manual",
    signal: request.signal,
  });
  const responseHeaders = new Headers();
  for (const name of ["content-type", "cache-control", "request-id", "x-request-id", "retry-after"]) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  if (!upstream.ok) {
    // Error bodies are small; scrub them in case the provider echoes the key back.
    const text = redact(await upstream.text(), [provider.apiKey]);
    return new Response(text, { status: upstream.status, headers: responseHeaders });
  }
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}
