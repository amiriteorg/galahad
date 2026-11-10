import { describe, expect, test } from "bun:test";
import { buildRequest, ConnectorManifest, newNodeIdentity } from "@galahad/core";
import { foundFleet, MindStore, Vault } from "@galahad/mind";
import { CATALOG, type DiscoveredTool, excerpt, keyState, MAX_RESPONSE_BYTES, mergeMcpTools, sendConnectorRequest } from "../src/index.ts";

function vault() {
  const identity = newNodeIdentity();
  const store = new MindStore(":memory:");
  foundFleet(store, identity, { fleetName: "camelot", nodeName: "ultra" });
  return new Vault(store, identity);
}

const forge = ConnectorManifest.parse({
  id: "forge",
  label: "Forge",
  origin: "https://api.forge.test",
  auth: { secret: "forge", scheme: "bearer" },
  tools: { me: { description: "me", method: "GET", path: "/user", class: "read" } },
});
const KEY = "forge_test_key_0123456789";

function recorder(respond: (req: Request) => Response | Promise<Response>) {
  const seen: Request[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(input as string, init);
    seen.push(req);
    return respond(req);
  }) as typeof globalThis.fetch;
  return { seen, fetch };
}

describe("the connector catalog", () => {
  test("every built-in connector is a valid manifest", () => {
    for (const [id, entry] of Object.entries(CATALOG)) {
      const parsed = ConnectorManifest.safeParse({ ...entry.manifest, origin: entry.manifest.origin ?? "http://homeassistant.local:8123" });
      expect(parsed.success ? null : parsed.error.issues).toBeNull();
      expect(parsed.data!.id).toBe(id);
    }
  });

  test("Cloudflare: creating buckets is Galahad's to do; deleting one asks", () => {
    const cf = CATALOG.cloudflare!.manifest.tools;
    expect(cf["r2.bucket.create"]!.class).toBe("create");
    expect(cf["r2.bucket.delete"]!.class).toBe("delete");
    const outward = Object.values(CATALOG.github!.manifest.tools).filter((t) => t.class === "outward");
    expect(outward.length).toBeGreaterThan(0);
    expect(CATALOG["home-assistant"]!.manifest.tools.service!.class).toBe("outward"); // the physical world always asks
  });
});

describe("sending a request", () => {
  test("the key is injected only when it was pinned to this origin, for this connector", async () => {
    const v = vault();
    expect(keyState(v, forge)).toBe("missing");
    v.set("forge", KEY, { provider: "forge", origin: "https://api.forge.test" });
    expect(keyState(v, forge)).toBe("ready");
    const { seen, fetch } = recorder(() => Response.json({ login: "galahad" }));
    const result = await sendConnectorRequest({ vault: v, fetch }, forge, buildRequest(forge, "me"));
    expect(result).toMatchObject({ ok: true, status: 200 });
    expect(seen[0]!.headers.get("authorization")).toBe(`Bearer ${KEY}`);
    expect(seen[0]!.url).toBe("https://api.forge.test/user");
  });

  test("a key pinned elsewhere, or entered for another service, is never sent", async () => {
    const v = vault();
    v.set("forge", KEY, { provider: "forge", origin: "https://api.other.test" });
    expect(keyState(v, forge)).toBe("wrong-origin");
    const { seen, fetch } = recorder(() => Response.json({}));
    await expect(sendConnectorRequest({ vault: v, fetch }, forge, buildRequest(forge, "me"))).rejects.toThrow(/pinned to another origin/);
    v.set("forge", KEY, { provider: "deepseek", origin: "https://api.forge.test" });
    expect(keyState(v, forge)).toBe("wrong-origin");
    expect(seen).toHaveLength(0);
  });

  test("an optional key that isn't there means a call without one", async () => {
    const open = ConnectorManifest.parse({ ...forge, auth: { ...forge.auth!, optional: true } });
    const { seen, fetch } = recorder(() => Response.json({}));
    await sendConnectorRequest({ vault: vault(), fetch }, open, buildRequest(open, "me"));
    expect(seen[0]!.headers.get("authorization")).toBeNull();
  });

  test("redirects aren't followed, and an echoed key comes back redacted", async () => {
    const v = vault();
    v.set("forge", KEY, { provider: "forge", origin: "https://api.forge.test" });
    const { seen, fetch } = recorder((req) =>
      req.url.endsWith("/user") ? new Response(`you sent ${KEY}`, { status: 302, headers: { location: "https://evil.test/steal" } }) : Response.json({}),
    );
    const result = await sendConnectorRequest({ vault: v, fetch }, forge, buildRequest(forge, "me"));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.redirect).toBe("manual");
    expect(result.status).toBe(302);
    expect(result.body).not.toContain(KEY);
    expect(result.body).toContain("[redacted]");
  });

  test("answers are size-capped", async () => {
    const { fetch } = recorder(() => new Response("x".repeat(MAX_RESPONSE_BYTES + 10_000)));
    const open = ConnectorManifest.parse({ ...forge, auth: undefined });
    const result = await sendConnectorRequest({ vault: vault(), fetch }, open, buildRequest(open, "me"));
    expect(result.truncated).toBe(true);
    expect(result.body.length).toBeLessThanOrEqual(60_000);
  });
});

describe("excerpts", () => {
  const result = (body: string, contentType: string) => ({ ok: false, status: 503, contentType, body, truncated: false, durationMs: 5 });
  test("HTML becomes its text on one line; JSON is compacted", () => {
    const page = "<html><head><title>x</title><style>h1{}</style></head><body>\n<h1>503 Service&nbsp;Unavailable</h1>\n<script>var a = 1;</script></body></html>";
    expect(excerpt(result(page, "text/html; charset=utf-8"))).toBe("503 503 Service Unavailable");
    expect(excerpt(result('{\n  "a": 1\n}', "application/json"))).toBe('503 {"a":1}');
    expect(excerpt(result("line one\n\nline two", "text/plain"), 8)).toBe("503 line one…");
  });
});

describe("merging an MCP server's tools", () => {
  const tool = (remote: string, hints: DiscoveredTool["hints"] = {}, schema = `s-${remote}`): DiscoveredTool => ({
    remote,
    description: `${remote} does things`,
    params: {},
    hints,
    schema,
  });

  test("new tools start from the hints; your classes win; what you chose before stays", () => {
    const first = mergeMcpTools([tool("search", { readOnly: true }), tool("sendMail"), tool("dropTable", { destructive: true })], {}, { classes: { sendMail: "modify" } });
    expect(Object.fromEntries(Object.entries(first.tools).map(([k, t]) => [k, t.class]))).toEqual({ search: "read", send_mail: "modify", drop_table: "delete" });
    expect(first.report).toEqual({ added: ["search", "send_mail", "drop_table"], changed: [], removed: [], skipped: 0 });

    // Later: the server changed sendMail and dropped dropTable; your class for send_mail stays.
    const again = mergeMcpTools([tool("search", { readOnly: true }), tool("sendMail", {}, "s-new"), tool("newThing")], first.tools);
    expect(again.tools.send_mail!.class).toBe("modify");
    expect(again.tools.new_thing!.class).toBe("outward");
    expect(again.report).toEqual({ added: ["new_thing"], changed: ["send_mail"], removed: ["drop_table"], skipped: 0 });
  });

  test("* sets the class of tools you don't name; only narrows what's installed", () => {
    const all = mergeMcpTools([tool("a"), tool("b"), tool("c")], {}, { classes: { "*": "read", c: "outward" }, only: ["a", "c"] });
    expect(Object.fromEntries(Object.entries(all.tools).map(([k, t]) => [k, t.class]))).toEqual({ a: "read", c: "outward" });
    expect(all.report.skipped).toBe(1);
  });

  test("on a refresh, * you give now applies to every tool you don't name, old ones too", () => {
    const first = mergeMcpTools([tool("a"), tool("b"), tool("c")], {});
    const again = mergeMcpTools([tool("a"), tool("b"), tool("c")], first.tools, { classes: { "*": "read", c: "outward" } });
    expect(Object.fromEntries(Object.entries(again.tools).map(([k, t]) => [k, t.class]))).toEqual({ a: "read", b: "read", c: "outward" });
  });

  test("a description that looks like a key never enters the log", () => {
    const leaky = { ...tool("leak"), description: "use sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789 to call" };
    expect(mergeMcpTools([leaky], {}).tools.leak!.description).toMatch(/withheld/);
  });
});
