/*
 * How a server lets a client in, found the way a client finds it (MCP's authorization spec), without signing in or
 * registering anything: an initialize sent with no credentials. A server that answers it is open. One that answers 401
 * and names an authorization server that lets a client register itself, with PKCE (S256), is one you sign in to as
 * yourself; one that asks for credentials any other way takes a key. Anything else (no answer, a redirect, an error)
 * is down for now. At most five requests, none followed elsewhere.
 */

export type Probed = { auth: "none" } | { auth: "oauth" } | { auth: "key"; header: string } | { auth: "down"; note: string };

const INITIALIZE = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "galahad-mcp-index", version: "1" } },
});
const UA = "galahad-mcp-index/1 (+https://galahad.sh)";

/** An https address, or null. */
const https = (value: unknown, base?: string): URL | null => {
  try {
    const url = new URL(String(value), base);
    return url.protocol === "https:" && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
};

/** JSON from a GET, or null for anything that isn't a JSON object. */
async function json(fetcher: typeof fetch, url: URL, timeoutMs: number): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetcher(url, { headers: { accept: "application/json", "user-agent": UA }, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    const body = (await response.json()) as unknown;
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Where RFC 8414 (and OpenID before it) put an issuer's metadata: the well-known name inserted before its path. */
const wellKnown = (base: URL, name: string): URL => new URL(`/.well-known/${name}${base.pathname === "/" ? "" : base.pathname.replace(/\/$/, "")}`, base.origin);

export async function probe(url: string, secretHeaders: readonly string[], fetcher: typeof fetch = fetch, timeoutMs = 8000): Promise<Probed> {
  const endpoint = https(url);
  if (!endpoint) return { auth: "down", note: "not https" };
  let response: Response;
  try {
    response = await fetcher(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18", "user-agent": UA },
      body: INITIALIZE,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return { auth: "down", note: error instanceof Error && error.name === "TimeoutError" ? "no answer in time" : "unreachable" };
  }
  if (response.ok) {
    const text = await response.text().catch(() => "");
    return text.includes('"jsonrpc"') ? { auth: "none" } : { auth: "down", note: "answered, but not as MCP" };
  }
  if (response.status !== 401 && response.status !== 403) return { auth: "down", note: `answered ${response.status}` };
  const key = { auth: "key" as const, header: secretHeaders[0] ?? "Authorization" };

  // Its protected resource metadata: named in its 401, else at the well-known address for its path, then for its origin.
  const named = /resource_metadata="([^"]+)"/.exec(response.headers.get("www-authenticate") ?? "")?.[1];
  const places = [named ? https(named, endpoint.origin) : null, wellKnown(endpoint, "oauth-protected-resource"), new URL("/.well-known/oauth-protected-resource", endpoint.origin)];
  let resource: Record<string, unknown> | null = null;
  for (const place of places) {
    if (place && (resource = await json(fetcher, place, timeoutMs))) break;
  }
  const servers = Array.isArray(resource?.authorization_servers) ? resource!.authorization_servers : [];
  const issuer = https(servers[0]);
  if (!issuer) return key;
  // Its authorization server's metadata (OAuth's, else OpenID's).
  const metadata = (await json(fetcher, wellKnown(issuer, "oauth-authorization-server"), timeoutMs)) ?? (await json(fetcher, wellKnown(issuer, "openid-configuration"), timeoutMs));
  const methods = Array.isArray(metadata?.code_challenge_methods_supported) ? (metadata!.code_challenge_methods_supported as unknown[]) : [];
  return https(metadata?.registration_endpoint) && https(metadata?.authorization_endpoint) && https(metadata?.token_endpoint) && methods.includes("S256") ? { auth: "oauth" } : key;
}
