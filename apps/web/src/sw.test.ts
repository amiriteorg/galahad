import { afterAll, beforeAll, describe, expect, test } from "bun:test";

/*
 * The service worker, loaded against stand-in caches and network: what a navigation
 * leaves in the cache the app opens from when it's offline.
 */

const ORIGIN = "https://node.test";
const stored = new Map<string, Response>();
const cache = {
  match: async (key: string) => stored.get(key)?.clone(),
  put: async (key: string, response: Response) => void stored.set(key, response),
  addAll: async () => {},
};
const pages: Record<string, () => Response> = {
  "/": () => new Response("<!doctype html><title>Galahad</title>", { headers: { "content-type": "text/html; charset=utf-8" } }),
  "/index.html": () => new Response("<!doctype html><title>Galahad</title>", { headers: { "content-type": "text/html; charset=utf-8" } }),
  "/bank/callback": () => new Response("<!doctype html><title>Galahad</title>", { headers: { "content-type": "text/html; charset=utf-8" } }),
  "/sw.js": () => new Response("self.addEventListener('fetch', () => {})", { headers: { "content-type": "text/javascript; charset=utf-8" } }),
  "/manifest.webmanifest": () => new Response("{}", { headers: { "content-type": "application/manifest+json" } }),
};

const saved = { addEventListener: globalThis.addEventListener, location: (globalThis as any).location, caches: (globalThis as any).caches, fetch: globalThis.fetch };
let onFetch: (event: unknown) => void = () => {};

beforeAll(async () => {
  (globalThis as any).addEventListener = (type: string, listener: (event: unknown) => void) => {
    if (type === "fetch") onFetch = listener;
  };
  (globalThis as any).location = new URL(`${ORIGIN}/`);
  (globalThis as any).caches = { open: async () => cache, keys: async () => [], delete: async () => true };
  (globalThis as any).fetch = async (request: { url: string }) => (pages[new URL(request.url).pathname] ?? (() => new Response("no", { status: 404 })))();
  // A worker script, not a module: loaded for its listeners.
  const worker = "./sw.ts";
  await import(worker);
});

afterAll(() => {
  Object.assign(globalThis, { addEventListener: saved.addEventListener, location: saved.location, caches: saved.caches, fetch: saved.fetch });
});

/** Opens a URL in a tab: the page the worker answers with, once everything it started is done. */
async function navigate(path: string): Promise<Response> {
  let answer: Promise<Response> | null = null;
  const pending: Promise<unknown>[] = [];
  onFetch({ request: { method: "GET", mode: "navigate", url: `${ORIGIN}${path}` }, respondWith: (r: Promise<Response>) => (answer = r), waitUntil: (p: Promise<unknown>) => pending.push(p) });
  if (!answer) throw new Error(`the worker didn't answer ${path}`);
  const response = await answer;
  await Promise.all(pending);
  return response;
}

describe("opening the app offline", () => {
  test("the app's own page is what's kept, and only it", async () => {
    expect((await navigate("/")).status).toBe(200);
    expect(await stored.get("/")!.clone().text()).toContain("<title>Galahad</title>");
    // A script, the manifest or the bank's return opened in a tab is shown, never kept as the app.
    for (const path of ["/sw.js", "/manifest.webmanifest", "/bank/callback?code=fake-code&state=fake-state"]) {
      stored.set("/", pages["/"]!());
      expect((await navigate(path)).status).toBe(200);
      const kept = stored.get("/")!;
      expect(await kept.clone().text()).toContain("<title>Galahad</title>");
      expect(kept.url).not.toContain("fake-code");
    }
    stored.delete("/");
    await navigate("/index.html");
    expect(stored.get("/")).toBeDefined();
  });
});
