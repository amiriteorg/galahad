/*
 * What the index reads from the official MCP Registry (registry.modelcontextprotocol.io), and the one test a server
 * passes to be listed at all: it is the service's own. A server's name begins with a namespace its publisher proved to
 * the registry (com.stripe: control of stripe.com), and one of its endpoints is https on that very domain. A namespace
 * on a hosting platform (dev.workers.someone, io.github.someone) or a tunnel is someone's project, not a service's.
 */
import type { Psl } from "./psl.ts";
import { registrable } from "./psl.ts";

export const REGISTRY = "https://registry.modelcontextprotocol.io/v0.1/servers";

/** A server as the registry describes it (the fields the index reads). */
export interface RegistryServer {
  name: string;
  title?: string;
  description?: string;
  websiteUrl?: string;
  remotes?: { type?: string; url?: string; headers?: { name?: string; isSecret?: boolean }[] }[];
}
/** One record of a page: the server, and the registry's own word on it. */
export interface RegistryRecord {
  server: RegistryServer;
  _meta?: { "io.modelcontextprotocol.registry/official"?: { status?: string; updatedAt?: string; isLatest?: boolean } };
}

/** A server the index may list once it is ranked and probed. */
export interface Candidate {
  name: string;
  title: string;
  description: string;
  url: string;
  /** The registrable domain of its proven namespace. */
  site: string;
  /** The secret headers it says it takes, by name. */
  headers: string[];
  updated: string;
}

/** Tunnels and wildcard DNS that aren't on the Public Suffix List: whatever is there is temporary, and someone's. */
const TUNNELS = new Set(["lhr.life", "sslip.io", "nip.io", "pinggy.net", "pinggy.link", "ngrok.io", "ngrok-free.app", "ngrok.app", "trycloudflare.com", "loca.lt", "serveo.net", "localhost.run", "tunnelmole.net", "devtunnels.ms"]);

/** The domain a namespace names: com.paypal.mcp is mcp.paypal.com. */
export function namespaceDomain(name: string): string | null {
  const ns = name.split("/", 1)[0]!.toLowerCase();
  const labels = ns.split(".");
  if (labels.length < 2 || labels.some((l) => !/^[a-z0-9-]{1,63}$/.test(l))) return null;
  return labels.reverse().join(".");
}

const clean = (text: string | undefined, max: number) => (text ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** The server as a candidate, or null when it isn't the service's own (or has no endpoint Galahad can call). */
export function candidate(record: RegistryRecord, psl: Psl): Candidate | null {
  const s = record.server;
  const meta = record._meta?.["io.modelcontextprotocol.registry/official"];
  if (meta?.status && meta.status !== "active") return null;
  const domain = s?.name ? namespaceDomain(s.name) : null;
  if (!domain) return null;
  const { site, platform } = registrable(domain, psl);
  if (!site || platform || TUNNELS.has(site)) return null;
  for (const remote of s.remotes ?? []) {
    if (remote.type !== "streamable-http" || !remote.url || remote.url.includes("{")) continue;
    let url: URL;
    try {
      url = new URL(remote.url);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) continue;
    const host = url.hostname.toLowerCase();
    if (host !== domain && !host.endsWith(`.${domain}`)) continue;
    return {
      name: s.name,
      title: clean(s.title, 80),
      description: clean(s.description, 400),
      url: url.pathname === "/" ? url.origin : url.toString(),
      site,
      headers: (remote.headers ?? []).filter((h) => h.isSecret && h.name && /^[A-Za-z0-9-]{1,64}$/.test(h.name)).map((h) => h.name!),
      updated: meta?.updatedAt ?? "",
    };
  }
  return null;
}

/** One page of the registry's latest versions changed since `since` (deleted ones included, as the registry gives them then). */
export async function registryPage(fetcher: typeof fetch, opts: { since?: string; cursor?: string | null }): Promise<{ records: RegistryRecord[]; next: string | null }> {
  const q = new URLSearchParams({ limit: "100", version: "latest" });
  if (opts.since) q.set("updated_since", opts.since);
  if (opts.cursor) q.set("cursor", opts.cursor);
  const response = await fetcher(`${REGISTRY}?${q}`, { headers: { accept: "application/json", "user-agent": "galahad-mcp-index/1 (+https://galahad.sh)" } });
  if (!response.ok) throw new Error(`the registry answered ${response.status}`);
  const page = (await response.json()) as { servers?: RegistryRecord[]; metadata?: { nextCursor?: string } };
  return { records: page.servers ?? [], next: page.metadata?.nextCursor ?? null };
}
