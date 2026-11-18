/*
 * The Public Suffix List (publicsuffix.org), parsed: where a registrable domain begins (stripe.com, not mcp.stripe.com;
 * bbc.co.uk, not co.uk), and which suffixes are hosting platforms whose names belong to whoever deploys there
 * (workers.dev, vercel.app, github.io: the list's private section). The index keeps the parsed rules in D1 and fetches
 * the list again weekly.
 */

export interface Psl {
  rules: Set<string>;
  wild: Set<string>;
  exceptions: Set<string>;
  /** Suffixes from the private section: a name under one is a tenant's, not the platform's. */
  platforms: Set<string>;
}

export function parsePsl(text: string): Psl {
  const psl: Psl = { rules: new Set(), wild: new Set(), exceptions: new Set(), platforms: new Set() };
  let platform = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.includes("===BEGIN PRIVATE DOMAINS===")) platform = true;
    if (!line || line.startsWith("//")) continue;
    const rule = line.split(/\s/)[0]!.toLowerCase();
    if (rule.startsWith("!")) psl.exceptions.add(rule.slice(1));
    else if (rule.startsWith("*.")) {
      psl.wild.add(rule.slice(2));
      if (platform) psl.platforms.add(rule.slice(2));
    } else {
      psl.rules.add(rule);
      if (platform) psl.platforms.add(rule);
    }
  }
  return psl;
}

/** As kept in D1: the four sets as lists. */
export const pslToJson = (psl: Psl): string => JSON.stringify({ r: [...psl.rules], w: [...psl.wild], e: [...psl.exceptions], p: [...psl.platforms] });
export function pslFromJson(json: string): Psl {
  const o = JSON.parse(json) as { r: string[]; w: string[]; e: string[]; p: string[] };
  return { rules: new Set(o.r), wild: new Set(o.w), exceptions: new Set(o.e), platforms: new Set(o.p) };
}

/** A host's public suffix: the longest rule that matches it (an exception's parent; a wildcard's child), else its last label. */
export function publicSuffix(host: string, psl: Psl): string {
  const labels = host.toLowerCase().replace(/\.$/, "").split(".");
  for (let i = 0; i < labels.length; i++) {
    const tail = labels.slice(i).join(".");
    if (psl.exceptions.has(tail)) return labels.slice(i + 1).join(".");
    if (psl.rules.has(tail)) return tail;
    if (i + 1 < labels.length && psl.wild.has(labels.slice(i + 1).join("."))) return tail;
  }
  return labels.at(-1) ?? "";
}

/** A host's registrable domain (its suffix and one label more), and whether that suffix is a hosting platform's. */
export function registrable(host: string, psl: Psl): { site: string | null; platform: boolean } {
  const h = host.toLowerCase().replace(/\.$/, "");
  const suffix = publicSuffix(h, psl);
  const labels = h.split(".");
  const n = suffix.split(".").length;
  return { site: labels.length > n ? labels.slice(-(n + 1)).join(".") : null, platform: psl.platforms.has(suffix) };
}
