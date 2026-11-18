/*
 * The MCP library's index, a Cloudflare Worker at mcp.galahad.sh (README.md). Every ten minutes it reads what changed in
 * the official MCP Registry, keeps the servers that are their service's own (registry.ts), ranks their sites by the
 * Tranco list (a few a run, as Tranco asks), and probes how each lets a client in (probe.ts), popular ones first, again
 * weekly. GET /v1/library.json is the library every Galahad node reads; GET /v1/health says how far along it is. Each
 * run stays within a free Worker's limits: a few registry pages, two ranks and six probes.
 */
import type { McpIndexEntry } from "../../../packages/core/src/mcp-index.ts";
import { entryOf, idOf, labelOf, RESERVED_IDS } from "./entry.ts";
import { type Probed, probe } from "./probe.ts";
import { parsePsl, type Psl, pslFromJson, pslToJson } from "./psl.ts";
import { type Candidate, candidate, registryPage } from "./registry.ts";

// What the Worker is given (wrangler.jsonc): its database. Declared here, as no Workers type package is installed.
interface D1Result<T> {
  results: T[];
}
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<unknown>;
}
interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>;
}
interface Env {
  DB: D1Database;
}
interface Ctx {
  waitUntil(promise: Promise<unknown>): void;
}

const PSL_URL = "https://publicsuffix.org/list/public_suffix_list.dat";
const TRANCO = (site: string) => `https://tranco-list.eu/api/ranks/domain/${encodeURIComponent(site)}`;
const PAGES_PER_RUN = 4;
const RANKS_PER_RUN = 2;
const PROBES_PER_RUN = 6;
const DAY = 86_400_000;
/** A server is probed again after a week; a site ranked again after a month (a site Tranco didn't rank, after three). */
const REPROBE = 7 * DAY;
const RERANK = 30 * DAY;
const RERANK_UNRANKED = 90 * DAY;
/** A site with more servers than this is a platform hosting others' (a vendor with many of its own is named). */
const MAX_PER_SITE = 12;
const VENDORS = ["googleapis.com", "google.com", "cloudflare.com", "microsoft.com", "cloudinary.com", "atlassian.com", "amazon.com"];
/** The weekly cron (wrangler.jsonc) refreshes the Public Suffix List alone: its parse is the heaviest thing the index does. */
const WEEKLY = "17 3 * * 1";

const meta = async (env: Env, k: string) => (await env.DB.prepare("SELECT v FROM meta WHERE k = ?").bind(k).first<{ v: string }>())?.v ?? null;
const setMeta = (env: Env, k: string, v: string) => env.DB.prepare("INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v").bind(k, v);

export default {
  async fetch(request: Request, env: Env, ctx: Ctx): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("GET only\n", { status: 405 });
    const { pathname } = new URL(request.url);
    if (pathname === "/v1/library.json") return library(request, env, ctx);
    if (pathname === "/v1/health") return Response.json(await health(env), { headers: { "cache-control": "no-store" } });
    if (pathname === "/") {
      return new Response("Galahad's MCP library: the official MCP Registry's servers that are their service's own, ranked and probed.\nGET /v1/library.json · GET /v1/health · https://github.com/amiriteorg/galahad/tree/main/apps/mcp-index\n", { headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    return new Response("not found\n", { status: 404 });
  },

  async scheduled(controller: { cron: string }, env: Env, ctx: Ctx): Promise<void> {
    ctx.waitUntil(controller.cron === WEEKLY ? refreshPsl(env) : run(env));
  },
};

// ---- the library ------------------------------------------------------------------------------------------------------

async function library(request: Request, env: Env, ctx: Ctx): Promise<Response> {
  const cache = (globalThis as unknown as { caches: { default: { match(r: Request): Promise<Response | undefined>; put(r: Request, res: Response): Promise<void> } } }).caches.default;
  const key = new Request(new URL("/v1/library.json", request.url).toString());
  const cached = await cache.match(key);
  if (cached) return cached;
  const vendors = VENDORS.map(() => "?").join(", ");
  const { results } = await env.DB.prepare(
    `SELECT s.entry AS entry FROM servers s JOIN sites t ON t.site = s.site
     WHERE s.entry IS NOT NULL AND t.rank IS NOT NULL
       AND (t.site IN (${vendors}) OR (SELECT COUNT(*) FROM servers c WHERE c.site = s.site) <= ${MAX_PER_SITE})
     ORDER BY t.rank, s.id`,
  )
    .bind(...VENDORS)
    .all<{ entry: string }>();
  const body = `{"v":1,"generated":${JSON.stringify(new Date().toISOString())},"source":"https://registry.modelcontextprotocol.io","count":${results.length},"entries":[${results.map((r) => r.entry).join(",")}]}`;
  const response = new Response(body, { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=900", "access-control-allow-origin": "*" } });
  ctx.waitUntil(cache.put(key, response.clone()));
  return response;
}

async function health(env: Env) {
  const count = async (sql: string) => (await env.DB.prepare(sql).first<{ n: number }>())?.n ?? 0;
  return {
    servers: await count("SELECT COUNT(*) AS n FROM servers"),
    probed: await count("SELECT COUNT(*) AS n FROM servers WHERE probed IS NOT NULL"),
    listable: await count("SELECT COUNT(*) AS n FROM servers WHERE entry IS NOT NULL"),
    sites: await count("SELECT COUNT(*) AS n FROM sites"),
    ranked: await count("SELECT COUNT(*) AS n FROM sites WHERE rank IS NOT NULL"),
    synced: await meta(env, "synced"),
    ran: await meta(env, "ran"),
    psl: await meta(env, "psl_at"),
  };
}

// ---- a run ------------------------------------------------------------------------------------------------------------

/** The Public Suffix List as D1 keeps it: in pieces (psl.00, psl.01…), as a statement holds at most 100 KB. */
async function storedPsl(env: Env): Promise<Psl | null> {
  const { results } = await env.DB.prepare("SELECT v FROM meta WHERE k LIKE 'psl.%' ORDER BY k").all<{ v: string }>();
  return results.length ? pslFromJson(results.map((r) => r.v).join("")) : null;
}
export const pslPieces = (json: string, size = 60_000): string[] => Array.from({ length: Math.ceil(json.length / size) }, (_, i) => json.slice(i * size, (i + 1) * size));

async function run(env: Env): Promise<void> {
  const now = Date.now();
  // Each step on its own: one that fails (the registry down, Tranco slow) leaves the others to do their part.
  const step = async (name: string, work: () => Promise<unknown>) => {
    try {
      await work();
    } catch (error) {
      console.error(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  await step("sync", async () => {
    const psl = (await storedPsl(env)) ?? (await refreshPsl(env));
    if (psl) await sync(env, psl, now);
  });
  await step("rank", () => rank(env, now));
  await step("probe", () => probeSome(env, now));
  await setMeta(env, "ran", new Date(now).toISOString()).run();
}

/** A query's values in groups D1 takes (at most 100 bound to one statement), the rows put together. */
async function inGroups<T>(env: Env, sql: (marks: string) => string, values: readonly string[]): Promise<T[]> {
  const rows: T[] = [];
  for (let i = 0; i < values.length; i += 90) {
    const group = values.slice(i, i + 90);
    const { results } = await env.DB.prepare(sql(group.map(() => "?").join(", "))).bind(...group).all<T>();
    rows.push(...results);
  }
  return rows;
}

/** The Public Suffix List again (weekly; or once, when the index has none). */
async function refreshPsl(env: Env): Promise<Psl | null> {
  const response = await fetch(PSL_URL, { headers: { "user-agent": "galahad-mcp-index/1 (+https://galahad.sh)" } });
  if (!response.ok) return null;
  const psl = parsePsl(await response.text());
  if (psl.rules.size < 1000) return null;
  const pieces = pslPieces(pslToJson(psl));
  await env.DB.batch([
    env.DB.prepare("DELETE FROM meta WHERE k LIKE 'psl.%'"),
    ...pieces.map((piece, i) => setMeta(env, `psl.${String(i).padStart(2, "0")}`, piece)),
    setMeta(env, "psl_at", new Date().toISOString()),
  ]);
  return psl;
}

/** What changed in the registry since the last sync: candidates kept (a new endpoint is probed again), the rest dropped. */
async function sync(env: Env, psl: Psl, now: number): Promise<void> {
  const synced = (await meta(env, "synced")) ?? new Date(now - DAY).toISOString();
  // A sync that ran out of pages goes on from where it stopped, with the same start.
  const since = (await meta(env, "sync_since")) ?? new Date(Date.parse(synced) - 10 * 60_000).toISOString();
  let cursor = await meta(env, "sync_cursor");
  for (let page = 0; page < PAGES_PER_RUN; page++) {
    const { records, next } = await registryPage(fetch, { since, cursor });
    const found: Candidate[] = [];
    const gone: string[] = [];
    for (const record of records) {
      const name = record.server?.name;
      if (!name) continue;
      const c = candidate(record, psl);
      if (c) found.push(c);
      else gone.push(name);
    }
    await keep(env, found, gone);
    cursor = next;
    if (!cursor) break;
  }
  await env.DB.batch(
    cursor
      ? [setMeta(env, "sync_since", since), setMeta(env, "sync_cursor", cursor)]
      : [setMeta(env, "synced", new Date(now).toISOString()), env.DB.prepare("DELETE FROM meta WHERE k IN ('sync_since', 'sync_cursor')")],
  );
}

/** Candidates in (each id its own: a taken one gets -2, -3…), the rest out. */
async function keep(env: Env, found: Candidate[], gone: string[]): Promise<void> {
  if (!found.length && !gone.length) return;
  const known = new Map<string, { id: string; url: string }>();
  for (const r of await inGroups<{ name: string; id: string; url: string }>(env, (marks) => `SELECT name, id, url FROM servers WHERE name IN (${marks})`, found.map((c) => c.name))) known.set(r.name, r);
  const wanted = found.filter((c) => !known.has(c.name)).map((c) => idOf(labelOf(c)));
  const taken = new Set<string>(RESERVED_IDS);
  // Ids taken already, with the next few each might need (a -2, a -3), a group at a time.
  const asked = [...new Set(wanted.flatMap((id) => [id, `${id.slice(0, 36)}-2`, `${id.slice(0, 36)}-3`]))];
  for (const r of await inGroups<{ id: string }>(env, (marks) => `SELECT id FROM servers WHERE id IN (${marks})`, asked)) taken.add(r.id);
  const statements: D1PreparedStatement[] = gone.map((name) => env.DB.prepare("DELETE FROM servers WHERE name = ?").bind(name));
  for (const c of found) {
    const was = known.get(c.name);
    let id = was?.id ?? idOf(labelOf(c));
    if (!was) {
      for (let n = 2; taken.has(id); n++) id = `${idOf(labelOf(c)).slice(0, 36)}-${n}`;
      taken.add(id);
    }
    const moved = was && was.url !== c.url;
    statements.push(
      env.DB.prepare(
        `INSERT INTO servers (name, id, url, site, title, description, headers, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (name) DO UPDATE SET url = excluded.url, site = excluded.site, title = excluded.title, description = excluded.description,
           headers = excluded.headers, updated = excluded.updated${moved ? ", auth = NULL, header = NULL, probed = NULL, entry = NULL" : ""}`,
      ).bind(c.name, id, c.url, c.site, c.title, c.description, JSON.stringify(c.headers), c.updated),
      env.DB.prepare("INSERT OR IGNORE INTO sites (site, rank, checked) VALUES (?, NULL, '')").bind(c.site),
    );
  }
  await env.DB.batch(statements);
}

/** A couple of sites ranked by Tranco (its rate limit allows no more), and their servers' entries again with the rank. */
async function rank(env: Env, now: number): Promise<void> {
  const wait = await meta(env, "tranco_wait");
  if (wait && Date.parse(wait) > now) return;
  const { results } = await env.DB.prepare("SELECT site FROM sites WHERE checked = '' OR (rank IS NOT NULL AND checked < ?) OR (rank IS NULL AND checked < ?) ORDER BY checked LIMIT ?")
    .bind(new Date(now - RERANK).toISOString(), new Date(now - RERANK_UNRANKED).toISOString(), RANKS_PER_RUN)
    .all<{ site: string }>();
  for (const { site } of results) {
    const response = await fetch(TRANCO(site), { headers: { accept: "application/json", "user-agent": "galahad-mcp-index/1 (+https://galahad.sh)" } });
    if (response.status === 429) {
      await setMeta(env, "tranco_wait", new Date(now + 15 * 60_000).toISOString()).run();
      return;
    }
    let rankOf: number | null = null;
    if (response.ok) {
      const body = (await response.json().catch(() => null)) as { ranks?: { rank?: number }[] } | null;
      const r = body?.ranks?.[0]?.rank;
      rankOf = typeof r === "number" && r > 0 ? r : null;
    }
    await env.DB.prepare("UPDATE sites SET rank = ?, checked = ? WHERE site = ?").bind(rankOf, new Date(now).toISOString(), site).run();
    const { results: servers } = await env.DB.prepare("SELECT * FROM servers WHERE site = ? AND auth IS NOT NULL").bind(site).all<Row>();
    if (servers.length) await env.DB.batch(servers.map((s) => env.DB.prepare("UPDATE servers SET entry = ? WHERE name = ?").bind(entryJson(s, probedOf(s), rankOf), s.name)));
  }
}

interface Row {
  name: string;
  id: string;
  url: string;
  site: string;
  title: string;
  description: string;
  headers: string;
  updated: string;
  auth: string | null;
  header: string | null;
  rank?: number | null;
}

/** A probe's result as the row keeps it. */
const probedOf = (r: Row): Probed =>
  r.auth === "oauth" || r.auth === "none" ? { auth: r.auth } : r.auth === "key" ? { auth: "key", header: r.header ?? "Authorization" } : { auth: "down", note: "kept" };
const candidateOf = (r: Row): Candidate => ({ name: r.name, title: r.title, description: r.description, url: r.url, site: r.site, headers: JSON.parse(r.headers) as string[], updated: r.updated });
function entryJson(r: Row, probed: Probed, rankOf: number | null): string | null {
  const entry: McpIndexEntry | null = entryOf(candidateOf(r), r.id, probed, rankOf);
  return entry ? JSON.stringify(entry) : null;
}

/** A few servers probed, those never probed and the most popular first, then any not probed for a week. */
async function probeSome(env: Env, now: number): Promise<void> {
  const { results } = await env.DB.prepare(
    `SELECT s.*, t.rank AS rank FROM servers s JOIN sites t ON t.site = s.site
     WHERE t.rank IS NOT NULL AND (s.probed IS NULL OR s.probed < ?)
     ORDER BY s.probed IS NOT NULL, t.rank LIMIT ?`,
  )
    .bind(new Date(now - REPROBE).toISOString(), PROBES_PER_RUN)
    .all<Row>();
  if (!results.length) return;
  const probed = await Promise.all(results.map((r) => probe(r.url, JSON.parse(r.headers) as string[])));
  await env.DB.batch(
    results.map((r, i) => {
      const p = probed[i]!;
      return env.DB.prepare("UPDATE servers SET auth = ?, header = ?, probed = ?, entry = ? WHERE name = ?").bind(p.auth, p.auth === "key" ? p.header : null, new Date(now).toISOString(), entryJson(r, p, r.rank ?? null), r.name);
    }),
  );
}
