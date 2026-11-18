import { describe, expect, test } from "bun:test";
import { entryOf, idOf, labelOf } from "./entry.ts";
import { probe } from "./probe.ts";
import { parsePsl, pslFromJson, pslToJson, registrable } from "./psl.ts";
import { candidate, namespaceDomain, type RegistryRecord } from "./registry.ts";

/* The indexer's own parts (README.md), each with stand-ins: no network, no D1. */

const PSL = parsePsl(`// ===BEGIN ICANN DOMAINS===
com
co.uk
uk
dev
app
*.ck
!www.ck
// ===END ICANN DOMAINS===
// ===BEGIN PRIVATE DOMAINS===
workers.dev
github.io
vercel.app
// ===END PRIVATE DOMAINS===`);

describe("the Public Suffix List", () => {
  test("a registrable domain, and whether it is a platform's tenant", () => {
    expect(registrable("mcp.stripe.com", PSL)).toEqual({ site: "stripe.com", platform: false });
    expect(registrable("api.bbc.co.uk", PSL)).toEqual({ site: "bbc.co.uk", platform: false });
    expect(registrable("tool.someone.workers.dev", PSL)).toEqual({ site: "someone.workers.dev", platform: true });
    expect(registrable("a.b.ck", PSL).site).toBe("a.b.ck");
    expect(registrable("www.ck", PSL).site).toBe("www.ck");
    expect(registrable("com", PSL).site).toBeNull();
    // Kept in D1 as JSON, and the same after.
    expect(registrable("x.someone.vercel.app", pslFromJson(pslToJson(PSL)))).toEqual({ site: "someone.vercel.app", platform: true });
  });
});

const record = (name: string, url: string, over: Partial<RegistryRecord["server"]> = {}, status = "active"): RegistryRecord => ({
  server: { name, title: "", description: "Does a thing.", remotes: [{ type: "streamable-http", url }], ...over },
  _meta: { "io.modelcontextprotocol.registry/official": { status, updatedAt: "2026-11-01T00:00:00Z" } },
});

describe("the service's own server", () => {
  test("its namespace is a domain its publisher proved, and its endpoint is https on that very domain", () => {
    expect(namespaceDomain("com.paypal.mcp/mcp")).toBe("mcp.paypal.com");
    expect(candidate(record("com.stripe/mcp", "https://mcp.stripe.com"), PSL)).toMatchObject({ name: "com.stripe/mcp", url: "https://mcp.stripe.com", site: "stripe.com" });
    expect(candidate(record("com.paypal.mcp/mcp", "https://mcp.paypal.com/mcp"), PSL)).toMatchObject({ site: "paypal.com" });
  });

  test("refused: someone else's domain, a platform's tenant, a tunnel, http, a query or credentials, a template, a deleted server", () => {
    expect(candidate(record("com.stripe/mcp", "https://stripe-mcp.example.com/mcp"), PSL)).toBeNull();
    expect(candidate(record("com.paypal.mcp/mcp", "https://paypal.com/mcp"), PSL)).toBeNull(); // the proven domain is mcp.paypal.com
    expect(candidate(record("dev.workers.someone/tool", "https://someone.workers.dev/mcp"), PSL)).toBeNull();
    expect(candidate(record("io.github.someone/tool", "https://someone.github.io/mcp"), PSL)).toBeNull();
    expect(candidate(record("life.lhr.abc/tool", "https://abc.lhr.life/mcp"), PSL)).toBeNull();
    expect(candidate(record("com.stripe/mcp", "http://mcp.stripe.com"), PSL)).toBeNull();
    expect(candidate(record("com.stripe/mcp", "https://mcp.stripe.com/?key=1"), PSL)).toBeNull();
    expect(candidate(record("com.stripe/mcp", "https://u:p@mcp.stripe.com"), PSL)).toBeNull();
    expect(candidate(record("com.stripe/mcp", "https://{tenant}.stripe.com/mcp"), PSL)).toBeNull();
    expect(candidate(record("com.stripe/mcp", "https://mcp.stripe.com", {}, "deleted"), PSL)).toBeNull();
  });

  test("the secret headers it declares are kept, by name", () => {
    const c = candidate({ ...record("com.acme/mcp", "https://mcp.acme.com/mcp"), server: { name: "com.acme/mcp", remotes: [{ type: "streamable-http", url: "https://mcp.acme.com/mcp", headers: [{ name: "X-API-Key", isSecret: true }, { name: "X-Region", isSecret: false }] }] } }, PSL);
    expect(c?.headers).toEqual(["X-API-Key"]);
  });
});

/** A stand-in server: what it answers an initialize, and its well-known documents. */
function server(answer: { status: number; body?: string; auth?: string }, docs: Record<string, unknown> = {}) {
  const asked: string[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    asked.push(`${init?.method ?? "GET"} ${url}`);
    if (init?.method === "POST") return new Response(answer.body ?? "", { status: answer.status, headers: answer.auth ? { "www-authenticate": answer.auth } : {} });
    const path = new URL(url).pathname;
    return path in docs ? Response.json(docs[path]) : new Response("no", { status: 404 });
  }) as typeof fetch;
  return { fetcher, asked };
}
const AS = { issuer: "https://auth.acme.com", authorization_endpoint: "https://auth.acme.com/authorize", token_endpoint: "https://auth.acme.com/token", registration_endpoint: "https://auth.acme.com/register", code_challenge_methods_supported: ["S256"] };

describe("how a server lets a client in", () => {
  test("it answers an initialize with no credentials: open", async () => {
    expect(await probe("https://mcp.acme.com/mcp", [], server({ status: 200, body: '{"jsonrpc":"2.0","id":1,"result":{}}' }).fetcher)).toEqual({ auth: "none" });
    expect(await probe("https://mcp.acme.com/mcp", [], server({ status: 200, body: "<html>" }).fetcher)).toMatchObject({ auth: "down" });
  });

  test("a 401 naming an authorization server that lets a client register, with PKCE: you sign in", async () => {
    const s = server({ status: 401, auth: 'Bearer resource_metadata="https://mcp.acme.com/.well-known/oauth-protected-resource/mcp"' }, {
      "/.well-known/oauth-protected-resource/mcp": { resource: "https://mcp.acme.com/mcp", authorization_servers: ["https://auth.acme.com"] },
      "/.well-known/oauth-authorization-server": AS,
    });
    expect(await probe("https://mcp.acme.com/mcp", [], s.fetcher)).toEqual({ auth: "oauth" });
    // Found at the well-known place too, when the 401 doesn't name it.
    const t = server({ status: 401 }, { "/.well-known/oauth-protected-resource": { authorization_servers: ["https://auth.acme.com"] }, "/.well-known/oauth-authorization-server": AS });
    expect(await probe("https://mcp.acme.com/mcp", [], t.fetcher)).toEqual({ auth: "oauth" });
  });

  test("any other 401 takes a key: in the header it declares, else Authorization", async () => {
    expect(await probe("https://mcp.acme.com/mcp", [], server({ status: 401 }).fetcher)).toEqual({ auth: "key", header: "Authorization" });
    expect(await probe("https://mcp.acme.com/mcp", ["X-API-Key"], server({ status: 403 }).fetcher)).toEqual({ auth: "key", header: "X-API-Key" });
    // An authorization server that won't let a client register itself, or has no PKCE: a key.
    const noDcr = server({ status: 401 }, { "/.well-known/oauth-protected-resource": { authorization_servers: ["https://auth.acme.com"] }, "/.well-known/oauth-authorization-server": { ...AS, registration_endpoint: undefined } });
    expect(await probe("https://mcp.acme.com/mcp", [], noDcr.fetcher)).toEqual({ auth: "key", header: "Authorization" });
    const http = server({ status: 401 }, { "/.well-known/oauth-protected-resource": { authorization_servers: ["http://auth.acme.com"] } });
    expect(await probe("https://mcp.acme.com/mcp", [], http.fetcher)).toEqual({ auth: "key", header: "Authorization" });
  });

  test("a redirect, an error or nothing: down, and nothing followed elsewhere", async () => {
    const moved = server({ status: 302 });
    expect(await probe("https://mcp.acme.com/mcp", [], moved.fetcher)).toEqual({ auth: "down", note: "answered 302" });
    expect(moved.asked).toHaveLength(1);
    expect(await probe("https://mcp.acme.com/mcp", [], server({ status: 500 }).fetcher)).toMatchObject({ auth: "down" });
    expect(await probe("http://mcp.acme.com/mcp", [], server({ status: 200 }).fetcher)).toMatchObject({ auth: "down", note: "not https" });
    const failing = (async () => {
      throw new TypeError("network");
    }) as unknown as typeof fetch;
    expect(await probe("https://mcp.acme.com/mcp", [], failing)).toMatchObject({ auth: "down", note: "unreachable" });
  });
});

describe("the entry the library lists", () => {
  test("a name without 'MCP Server', else its site's; an id from it", () => {
    expect(labelOf({ title: "Atlassian Rovo MCP Server", site: "atlassian.com", name: "com.atlassian/atlassian-mcp-server" })).toBe("Atlassian Rovo");
    expect(labelOf({ title: "Porkbun (official)", site: "porkbun.com", name: "com.porkbun/mcp" })).toBe("Porkbun");
    expect(labelOf({ title: "", site: "stripe.com", name: "com.stripe/mcp" })).toBe("Stripe");
    expect(labelOf({ title: "", site: "cloudinary.com", name: "com.cloudinary/asset-management-mcp" })).toBe("Cloudinary Asset Management");
    expect(idOf("Atlassian Rovo")).toBe("atlassian-rovo");
    expect(idOf("monday.com")).toBe("monday-com");
    expect(idOf("1Password")).toBe("mcp-1password");
  });

  test("an entry the rules allow, with its shelf; none for a server that is down", () => {
    const c = { name: "com.stripe/mcp", title: "", description: "Customers, payments, subscriptions and invoices.", url: "https://mcp.stripe.com", site: "stripe.com", headers: [], updated: "2026-11-01T00:00:00Z" };
    expect(entryOf(c, "stripe", { auth: "oauth" }, 214)).toEqual({
      id: "stripe",
      label: "Stripe",
      description: "Customers, payments, subscriptions and invoices.",
      url: "https://mcp.stripe.com",
      site: "stripe.com",
      category: "Commerce & payments",
      auth: "oauth",
      rank: 214,
      registry: "com.stripe/mcp",
      updated: "2026-11-01T00:00:00Z",
    });
    expect(entryOf(c, "stripe", { auth: "key", header: "Authorization" }, 214)).toMatchObject({ auth: "key", header: "Authorization" });
    expect(entryOf(c, "stripe", { auth: "down", note: "answered 500" }, 214)).toBeNull();
  });
});
