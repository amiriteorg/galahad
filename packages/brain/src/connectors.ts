import { type BuiltRequest, ConnectorError, ConnectorManifest, redact } from "@galahad/core";
import type { MindStore, Vault } from "@galahad/mind";

/*
 * The connector broker's outbound half: send one built request with the key
 * injected, and bring back a bounded, redacted answer. The key is used only if
 * the vault pinned it to this connector's origin when you entered it; redirects
 * are never followed (a key must not chase a Location header to another host).
 */

export interface InstalledConnector {
  id: string;
  /** null when the stored manifest no longer validates (written by a newer node, or tampered). */
  manifest: ConnectorManifest | null;
  problem: string | null;
  installedAt: string;
  installedBy: string;
}

export function installedConnectors(store: MindStore): InstalledConnector[] {
  return store.lwwPrefix<unknown>("connector:").map((entry) => {
    const parsed = ConnectorManifest.safeParse(entry.value);
    return {
      id: entry.key.slice("connector:".length),
      manifest: parsed.success ? parsed.data : null,
      problem: parsed.success ? null : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ").slice(0, 300),
      installedAt: entry.hlc,
      installedBy: entry.device,
    };
  });
}

export function installedConnector(store: MindStore, id: string): ConnectorManifest | null {
  const parsed = ConnectorManifest.safeParse(store.lww(`connector:${id}`)?.value);
  return parsed.success ? parsed.data : null;
}

export type KeyState = "none-needed" | "ready" | "missing" | "optional-missing" | "wrong-origin";

/** Whether the connector's key is in the vault and pinned to the connector's origin. */
export function keyState(vault: Vault, manifest: ConnectorManifest): KeyState {
  if (!manifest.auth) return "none-needed";
  const info = vault.info(manifest.auth.secret);
  if (!info) return manifest.auth.optional ? "optional-missing" : "missing";
  // Pinned to this origin *and* entered for this connector: a manifest can't borrow another service's key.
  return info.origin === new URL(manifest.origin).origin && info.provider === manifest.id ? "ready" : "wrong-origin";
}

export interface ConnectorResult {
  ok: boolean;
  status: number;
  contentType: string | null;
  /** Redacted, clipped. */
  body: string;
  truncated: boolean;
  durationMs: number;
}

export const MAX_RESPONSE_BYTES = 512 * 1024;
const RETURNED_CHARS = 60_000;

async function readCapped(response: Response, cap: number): Promise<{ text: string; truncated: boolean }> {
  if (!response.body) return { text: "", truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.byteLength > cap) {
      chunks.push(value.subarray(0, cap - size));
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
    size += value.byteLength;
  }
  return { text: new TextDecoder().decode(Buffer.concat(chunks)), truncated };
}

export interface SendContext {
  vault: Vault;
  fetch?: typeof fetch;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export async function sendConnectorRequest(ctx: SendContext, manifest: ConnectorManifest, request: BuiltRequest): Promise<ConnectorResult> {
  const headers = new Headers({ accept: "application/json", "user-agent": "galahad/0.1 (+https://galahad.bot)" });
  for (const [name, value] of Object.entries(request.headers)) headers.set(name, value);
  if (request.body !== undefined) headers.set("content-type", "application/json");

  let key: string | null = null;
  const state = keyState(ctx.vault, manifest);
  if (state === "ready") key = ctx.vault.reveal(manifest.auth!.secret);
  else if (state === "missing") throw new ConnectorError(`${manifest.id} needs its key: add the secret "${manifest.auth!.secret}" for ${manifest.origin}`);
  else if (state === "wrong-origin") {
    throw new ConnectorError(`the secret "${manifest.auth!.secret}" is pinned to another origin; it is never sent to ${manifest.origin}`);
  }
  if (key && manifest.auth) {
    if (manifest.auth.scheme === "bearer") headers.set("authorization", `Bearer ${key}`);
    else if (manifest.auth.scheme === "basic") headers.set("authorization", `Basic ${Buffer.from(key).toString("base64")}`);
    else headers.set(manifest.auth.header!, key);
  }

  const started = performance.now();
  const timeout = AbortSignal.timeout(ctx.timeoutMs ?? 30_000);
  const response = await (ctx.fetch ?? fetch)(request.url, {
    method: request.method,
    headers,
    body: request.body,
    redirect: "manual",
    signal: ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout,
  });
  const { text, truncated } = await readCapped(response, MAX_RESPONSE_BYTES);
  const known = key ? [key, Buffer.from(key).toString("base64")] : [];
  const clean = redact(text, known);
  const clipped = clean.length > RETURNED_CHARS;
  return {
    ok: response.ok,
    status: response.status,
    contentType: response.headers.get("content-type"),
    body: clipped ? clean.slice(0, RETURNED_CHARS) : clean,
    truncated: truncated || clipped,
    durationMs: Math.round(performance.now() - started),
  };
}

/** A short, human-sized excerpt of a result for ledgers, receipts and run summaries. */
export function excerpt(result: ConnectorResult, max = 600): string {
  let body = result.body.trim();
  let json = false;
  if (result.contentType?.includes("json")) {
    try {
      body = JSON.stringify(JSON.parse(body));
      json = true;
    } catch {
      /* not JSON after all */
    }
  }
  // HTML becomes its text, and text collapses to one line: summaries, receipts and ledger rows stay readable.
  if (!json && result.contentType?.includes("html")) {
    body = body
      .replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  }
  if (!json) body = body.replace(/\s+/g, " ").trim();
  const head = `${result.status}${result.truncated ? " (truncated)" : ""}`;
  return `${head} ${body.length > max ? `${body.slice(0, max)}…` : body}`.trim();
}
