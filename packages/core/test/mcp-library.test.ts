import { describe, expect, test } from "bun:test";
import { ConnectorManifest, entryProblem, indexEntry, MCP_LIBRARY, mcpLibraryEntry, reviewedEntries } from "../src/index.ts";

/* The library of hosted MCP servers (mcp-library.ts): each one addable as it stands. */

describe("the library of hosted MCP servers", () => {
  test("each has an id a connector may have, its own https address with no query or credentials, and says whether you sign in", () => {
    expect(new Set(MCP_LIBRARY.map((entry) => entry.id)).size).toBe(MCP_LIBRARY.length);
    for (const entry of MCP_LIBRARY) {
      const at = new URL(entry.url);
      expect(at.protocol).toBe("https:");
      expect(at.search + at.hash + at.username + at.password).toBe("");
      expect(["oauth", "none"]).toContain(entry.auth);
      expect(entry.description.length).toBeGreaterThan(10);
      // It makes a manifest the node accepts, as installing it does.
      const manifest = ConnectorManifest.safeParse({ id: entry.id, label: entry.label, origin: at.origin, mcp: { path: at.pathname || "/" }, tools: {}, ...(entry.auth === "oauth" ? { auth: { secret: entry.id, scheme: "oauth", oauth: { provider: "mcp", scopes: [] } } } : {}) });
      expect(manifest.success).toBe(true);
    }
    expect(mcpLibraryEntry("linear")?.url).toBe("https://mcp.linear.app/mcp");
    expect(mcpLibraryEntry("nothing-like-it")).toBeNull();
  });

  test("each reviewed one passes every rule an index entry is held to (its address on its own site), and is marked reviewed", () => {
    for (const entry of reviewedEntries()) {
      expect([entry.id, entryProblem(entry)]).toEqual([entry.id, null]);
      expect(entry.reviewed).toBe(true);
    }
  });

  test("an entry from the index is taken in only as the rules allow, and never as reviewed", () => {
    const good = { id: "acme", label: "Acme", description: "Builds.", url: "https://mcp.acme.example/mcp", site: "acme.example", category: "Developer tools", auth: "oauth", rank: 10, registry: "example.acme/mcp", updated: "", reviewed: true };
    expect(indexEntry(good)).toMatchObject({ id: "acme" });
    expect(indexEntry(good)?.reviewed).toBeUndefined();
    expect(indexEntry({ ...good, url: "https://mcp.elsewhere.example/mcp" })).toBeNull();
    expect(indexEntry({ ...good, category: "Toys" })).toBeNull();
    expect(indexEntry({ ...good, rank: -1 })).toBeNull();
    expect(indexEntry("not an object")).toBeNull();
  });
});
