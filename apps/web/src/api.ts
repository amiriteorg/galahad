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

/** A file the node sent as bytes, with how it said to treat them. */
export interface Bytes {
  data: Uint8Array;
  /** The node's content type (it decides what may be shown inline). */
  type: string;
}

export interface Api {
  get<T>(path: string, signal?: AbortSignal): Promise<T>;
  post<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T>;
  /** A POST whose answer is bytes (an artifact's file), not JSON. */
  bytes(path: string, body: unknown, signal?: AbortSignal): Promise<Bytes>;
  chat(body: unknown, signal: AbortSignal): AsyncGenerator<ChatStreamEvent>;
  /** A signed GET that answers with server-sent events (the world): each `data:` frame, parsed as JSON. Unchecked: callers read it at their boundary. */
  stream(path: string, signal: AbortSignal): AsyncGenerator<unknown>;
}

/**
 * A long-running answer (creating a sandbox, keeping its work) has already sent
 * 200 when the work fails, so the failure arrives as exactly `{ error, status }`.
 */
function lateError(payload: unknown): ApiError | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as { error?: unknown; status?: unknown };
  return Object.keys(p).length === 2 && typeof p.error === "string" && typeof p.status === "number" ? new ApiError(p.status, p.error) : null;
}

export function apiFor(identity: BrowserIdentity): Api {
  return {
    async get<T>(path: string, signal?: AbortSignal) {
      return (await (await signedFetch(identity, "GET", path, undefined, signal)).json()) as T;
    },
    async post<T>(path: string, body: unknown = {}, signal?: AbortSignal) {
      const payload = await (await signedFetch(identity, "POST", path, body, signal)).json();
      const late = lateError(payload);
      if (late) throw late;
      return payload as T;
    },
    async bytes(path: string, body: unknown, signal?: AbortSignal) {
      const response = await signedFetch(identity, "POST", path, body, signal);
      return { data: new Uint8Array(await response.arrayBuffer()), type: response.headers.get("content-type") ?? "application/octet-stream" };
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
    async *stream(path: string, signal: AbortSignal) {
      const response = await signedFetch(identity, "GET", path, undefined, signal);
      if (!response.body) return;
      for await (const data of sseData(response.body)) {
        try {
          yield JSON.parse(data) as unknown;
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

/** How long a pairing request may take before the page says it can't reach the node. */
export const PAIR_TIMEOUT_MS = 12_000;

/**
 * Unauthenticated pairing endpoints (the invite proof is the credential). Never waits
 * forever: a stalled connection (Tailscale reconnecting, a phone changing networks) or
 * an unreachable node becomes ApiError(0), which callers treat as "retry, and say so".
 */
export async function pairPost<T>(path: "/link/pair/request" | "/link/pair/status", body: unknown, timeoutMs = PAIR_TIMEOUT_MS): Promise<T> {
  let response: Response;
  let payload: T & { error?: string };
  try {
    response = await fetch(`${location.origin}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  } catch (error) {
    const timedOut = error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new ApiError(0, timedOut ? `No answer from ${location.host} within ${Math.round(timeoutMs / 1000)} s` : `Can't reach ${location.host}`);
  }
  if (!response.ok) throw new ApiError(response.status, payload.error ?? `${response.status}`);
  return payload;
}

/**
 * Can this device reach the node right now? A deliberately empty status request: any
 * answer at all (it's refused as malformed) proves the path works. Never cached (POST),
 * so a page the service worker served from cache can't pretend to be connected.
 */
export async function nodeReachable(timeoutMs = 6000): Promise<boolean> {
  try {
    await pairPost("/link/pair/status", {}, timeoutMs);
    return true;
  } catch (error) {
    return !(error instanceof ApiError && error.status === 0);
  }
}
