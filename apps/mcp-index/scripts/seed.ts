#!/usr/bin/env bun
/*
 * Starts the index's database full (README.md): what the Worker would gather over weeks at a free Worker's pace, at
 * once. The registry read whole (or a crawl given), its candidates (the service's own servers), every candidate site
 * ranked from Tranco's daily list, and the servers on ranked sites probed, a few dozen at a time. Writes SQL for
 * `wrangler d1 execute --remote --file`; the Worker carries on from there.
 *
 *   bun apps/mcp-index/scripts/seed.ts --tranco top-1m.csv --out seed.sql [--crawl crawl.json] [--psl psl.dat] [--concurrency 24]
 *
 * --tranco is Tranco's list (tranco-list.eu/top-1m.csv.zip, unzipped). --crawl is a saved crawl: an object of the
 * registry's records by name. Only servers on ranked sites go into the database: an unranked one is never listed.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { entryOf, idOf, labelOf, RESERVED_IDS } from "../src/entry.ts";
import { type Probed, probe } from "../src/probe.ts";
import { parsePsl, pslToJson } from "../src/psl.ts";
import { type Candidate, candidate, type RegistryRecord, registryPage } from "../src/registry.ts";
import { pslPieces } from "../src/worker.ts";

const flag = (name: string) => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? undefined : process.argv[at + 1];
};
const out = flag("out");
const trancoFile = flag("tranco");
if (!out || !trancoFile) throw new Error("usage: seed.ts --tranco top-1m.csv --out seed.sql [--crawl crawl.json] [--psl psl.dat] [--concurrency 24]");
const concurrency = Number(flag("concurrency") ?? 24);
const started = new Date().toISOString();

const pslText = flag("psl") ? readFileSync(flag("psl")!, "utf8") : await (await fetch("https://publicsuffix.org/list/public_suffix_list.dat")).text();
const psl = parsePsl(pslText);

// The registry: a saved crawl, or read whole now (the latest version of each server, about 700 pages).
let records: RegistryRecord[];
if (flag("crawl")) {
  const crawl = JSON.parse(readFileSync(flag("crawl")!, "utf8")) as Record<string, { server: RegistryRecord["server"]; meta: NonNullable<RegistryRecord["_meta"]>["io.modelcontextprotocol.registry/official"] }>;
  records = Object.values(crawl).map((r) => ({ server: r.server, _meta: { "io.modelcontextprotocol.registry/official": r.meta } }));
} else {
  records = [];
  let cursor: string | null = null;
  do {
    const page = await registryPage(fetch, { cursor });
    records.push(...page.records);
    cursor = page.next;
  } while (cursor);
}
const candidates = records.map((r) => candidate(r, psl)).filter((c): c is Candidate => c !== null);

const rank = new Map<string, number>();
for (const line of readFileSync(trancoFile, "utf8").split("\n")) {
  const [r, domain] = line.trim().split(",");
  if (r && domain) rank.set(domain.toLowerCase(), Number(r));
}
const perSite = new Map<string, number>();
for (const c of candidates) perSite.set(c.site, (perSite.get(c.site) ?? 0) + 1);
const ranked = candidates.filter((c) => rank.has(c.site)).sort((a, b) => rank.get(a.site)! - rank.get(b.site)! || a.name.localeCompare(b.name));
console.error(`${records.length} servers, ${candidates.length} their service's own, ${ranked.length} on ${new Set(ranked.map((c) => c.site)).size} ranked sites`);

// Ids, the most popular first: each its own, a taken one with -2, -3…
const taken = new Set(RESERVED_IDS);
const ids = new Map<string, string>();
for (const c of ranked) {
  const base = idOf(labelOf(c));
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base.slice(0, 36)}-${n}`;
  taken.add(id);
  ids.set(c.name, id);
}

// Probed, a few dozen at a time.
const probed = new Map<string, Probed>();
let next = 0;
let done = 0;
await Promise.all(
  Array.from({ length: concurrency }, async () => {
    while (next < ranked.length) {
      const c = ranked[next++]!;
      probed.set(c.name, await probe(c.url, c.headers));
      if (++done % 100 === 0) console.error(`probed ${done} of ${ranked.length}`);
    }
  }),
);

const q = (v: string | number | null) => (v === null ? "NULL" : typeof v === "number" ? String(v) : `'${v.replace(/'/g, "''")}'`);
const sql: string[] = [];
const sites = [...new Set(ranked.map((c) => c.site))];
for (let i = 0; i < sites.length; i += 200) {
  sql.push(`INSERT OR REPLACE INTO sites (site, rank, checked) VALUES ${sites.slice(i, i + 200).map((s) => `(${q(s)}, ${rank.get(s)!}, ${q(started)})`).join(", ")};`);
}
for (let i = 0; i < ranked.length; i += 20) {
  const rows = ranked.slice(i, i + 20).map((c) => {
    const p = probed.get(c.name)!;
    const entry = entryOf(c, ids.get(c.name)!, p, rank.get(c.site)!);
    return `(${[c.name, ids.get(c.name)!, c.url, c.site, c.title, c.description, JSON.stringify(c.headers), c.updated, p.auth, p.auth === "key" ? p.header : null, started, entry ? JSON.stringify(entry) : null].map(q).join(", ")})`;
  });
  sql.push(`INSERT OR REPLACE INTO servers (name, id, url, site, title, description, headers, updated, auth, header, probed, entry) VALUES ${rows.join(", ")};`);
}
sql.push("DELETE FROM meta WHERE k LIKE 'psl.%';");
pslPieces(pslToJson(psl)).forEach((piece, i) => sql.push(`INSERT OR REPLACE INTO meta (k, v) VALUES (${q(`psl.${String(i).padStart(2, "0")}`)}, ${q(piece)});`));
sql.push(`INSERT OR REPLACE INTO meta (k, v) VALUES ('psl_at', ${q(started)}), ('synced', ${q(started)});`);
writeFileSync(out, `${sql.join("\n")}\n`);

const kinds = new Map<string, number>();
for (const p of probed.values()) kinds.set(p.auth, (kinds.get(p.auth) ?? 0) + 1);
console.error(`probed: ${[...kinds].map(([k, n]) => `${n} ${k}`).join(", ")}; wrote ${sql.length} statements to ${out}`);
