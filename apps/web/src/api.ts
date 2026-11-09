import { type ChatStreamEvent, signRequest, utf8 } from "@galahad/core";
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
  ) {
    super(message);
  }
}

type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler = () => {};
export const setUnauthorizedHandler = (handler: UnauthorizedHandler) => {
  onUnauthorized = handler;
};

async function signedFetch(
  identity: BrowserIdentity,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  const bytes = body === undefined ? new Uint8Array() : utf8(JSON.stringify(body));
  const headers = await signRequest(identity.device, signerFor(identity), method, path, bytes);
  const response = await fetch(`${location.origin}${path}`, {
    method,
    headers: { ...headers, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: method === "GET" ? undefined : bytes,
    signal,
    cache: "no-store",
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    if (response.status === 401) onUnauthorized();
    throw new ApiError(response.status, payload.error ?? `${response.status} ${response.statusText}`);
  }
  return response;
}

export interface Api {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  chat(body: unknown, signal: AbortSignal): AsyncGenerator<ChatStreamEvent>;
}

export function apiFor(identity: BrowserIdentity): Api {
  return {
    async get<T>(path: string) {
      return (await (await signedFetch(identity, "GET", path)).json()) as T;
    },
    async post<T>(path: string, body: unknown = {}) {
      return (await (await signedFetch(identity, "POST", path, body)).json()) as T;
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
