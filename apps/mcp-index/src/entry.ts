/*
 * A candidate as the library lists it: a name a person reads (the registry's title without "MCP Server", else its
 * site's), an id Galahad can install it under, its shelf, and the entry itself. Worked out when a server changes, so
 * the library is only ever stored entries put together.
 */
import { categorize, entryProblem, type McpIndexEntry } from "../../../packages/core/src/mcp-index.ts";
import type { Probed } from "./probe.ts";
import type { Candidate } from "./registry.ts";

/** Ids Galahad's own connectors and reviewed list already use: an indexed server never takes one. */
export const RESERVED_IDS = new Set(["github", "cloudflare", "home-assistant", "gmail", "outlook", "mcp", "library", "galahad"]);

const titleCase = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/** "Atlassian Rovo MCP Server" → "Atlassian Rovo"; no title → its site's name, and its own when the site has several. */
export function labelOf(c: Pick<Candidate, "title" | "site" | "name">): string {
  const trimmed = c.title
    .replace(/\s*[-–—:|]?\s*\(?(official|remote|hosted)\)?\s*$/i, "")
    .replace(/\s+(remote\s+)?mcp(\s+server)?\s*$/i, "")
    .replace(/^mcp\s+(server\s+)?(for\s+)?/i, "")
    .trim();
  if (trimmed) return trimmed.slice(0, 80);
  const brand = titleCase(c.site.split(".")[0]!);
  const own = c.name.split("/")[1]?.replace(/[-_]?(mcp|server|remote)[-_]?/gi, " ").trim() ?? "";
  return own && own.toLowerCase() !== brand.toLowerCase() ? `${brand} ${own.split(/[\s_-]+/).filter(Boolean).map(titleCase).join(" ")}` : brand;
}

/** An id from a label: lowercase, - between words, starting with a letter, at most 40. */
export function idOf(label: string): string {
  const slug = label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36)
    .replace(/-+$/, "");
  return /^[a-z]/.test(slug) ? slug : `mcp-${slug || "server"}`.slice(0, 40);
}

/** The listed entry, or null when it fails the rules any node holds it to (it is then never listed). */
export function entryOf(c: Candidate, id: string, probed: Probed, rank: number | null): McpIndexEntry | null {
  if (probed.auth === "down") return null;
  const label = labelOf(c);
  const entry: McpIndexEntry = {
    id,
    label,
    description: c.description,
    url: c.url,
    site: c.site,
    category: categorize(label, c.description),
    auth: probed.auth,
    ...(probed.auth === "key" ? { header: probed.header } : {}),
    rank,
    registry: c.name,
    updated: c.updated,
  };
  return entryProblem(entry) ? null : entry;
}
