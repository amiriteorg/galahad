import type { ChatStreamEvent } from "@galahad/core";
import { utf8 } from "@galahad/core/bytes";
import { signRequest } from "@galahad/core/request-auth";
import { type BrowserIdentity, signerFor } from "./identity.ts";

/*
 * Every /api request is signed with this browser's device key over
 * (method, path, time, nonce, body hash) and sent with exactly those bytes.
 * Requests always go to this page's own origin (HTTPS via tailscale serve).
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** The node's clock (from its Date header), to tell a skewed device clock from a revoked key. */
    readonly serverTime: number | null = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** True when the node doesn't have this feature (yet): unknown route, or a capability it lacks. */
export const isUnavailable = (error: unknown): boolean => error instanceof ApiError && (error.status === 404 || error.status === 424 || error.status === 501);

/** True when the request never reached the node (offline, DNS, refused). */
export const isNetworkError = (error: unknown): boolean => error instanceof TypeError || (error instanceof ApiError && error.status === 0);

export const isAbort = (error: unknown): boolean => error instanceof DOMException && error.name === "AbortError";

type Handler = (error: ApiError) => void;
let onUnauthorized: Handler = () => {};
let onNetwork: (ok: boolean) => void = () => {};
export const setUnauthorizedHandler = (handler: Handler): void => {
  onUnauthorized = handler;
};
/** Called with false when a request fails at the network layer, true when one succeeds. */
export const setNetworkHandler = (handler: (ok: boolean) => void): void => {
  onNetwork = handler;
};

async function signedFetch(identity: BrowserIdentity, method: "GET" | "POST", path: string, body?: unknown, signal?: AbortSignal): Promise<Response> {
  const bytes = body === undefined ? new Uint8Array() : utf8(JSON.stringify(body));
  const headers = await signRequest(identity.device, signerFor(identity), method, path, bytes);
  let response: Response;
  try {
    response = await fetch(`${location.origin}${path}`, {
      method,
      headers: { ...headers, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: method === "GET" ? undefined : bytes,
      signal,
      cache: "no-store",
    });
  } catch (error) {
    if (!isAbort(error)) onNetwork(false);
    throw error;
  }
  onNetwork(true);
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    const date = Date.parse(response.headers.get("date") ?? "");
    const error = new ApiError(response.status, payload.error ?? `${response.status} ${response.statusText}`, Number.isFinite(date) ? date : null);
    if (response.status === 401) onUnauthorized(error);
    throw error;
  }
  return response;
}

export interface Api {
  get<T>(path: string, signal?: AbortSignal): Promise<T>;
  post<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T>;
  chat(body: unknown, signal: AbortSignal): AsyncGenerator<ChatStreamEvent>;
}

export function apiFor(identity: BrowserIdentity): Api {
  return {
    async get<T>(path: string, signal?: AbortSignal) {
      return (await (await signedFetch(identity, "GET", path, undefined, signal)).json()) as T;
    },
    async post<T>(path: string, body: unknown = {}, signal?: AbortSignal) {
      return (await (await signedFetch(identity, "POST", path, body, signal)).json()) as T;
    },
    async *chat(body: unknown, signal: AbortSignal) {
      const response = await signedFetch(identity, "POST", "/api/chat", body, signal);
      if (!response.body) return;
      for await (const data of sseData(response.body)) {
        try {
          yield JSON.parse(data) as ChatStreamEvent;
        } catch {
          /* ignore malformed frames */
        }
      }
    },
  };
}

/** Server-sent events reader; skips ": keep-alive" comments. */
export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        for (const line of block.split("\n")) {
          if (line.startsWith("data:")) yield line.slice(5).trimStart();
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Unauthenticated pairing endpoints (the invite proof is the credential). */
export async function pairPost<T>(path: "/link/pair/request" | "/link/pair/status", body: unknown): Promise<T> {
  const response = await fetch(`${location.origin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new ApiError(response.status, payload.error ?? `${response.status}`);
  return payload;
}
