/*
 * Service worker: keeps the app shell available offline.
 * The page itself comes from the network first (it carries all the CSS), the
 * cached copy only when the network is slow or gone. Other shell assets are served
 * from cache and refreshed in the background (stale-while-revalidate).
 * Anything under /api, /link or /gw is never cached: those are signed,
 * live requests and always go to the network. The pairing bundle (/pair.js)
 * is not cached either: pairing needs the network anyway. The SANDBOX bundle
 * (/world.js, three.js and the world, the biggest file) is cached the first time
 * that page is opened, not on install, and refreshed like the shell.
 */

const VERSION = "galahad-shell-v4";
const SHELL = ["/", "/app.js", "/boot.js", "/manifest.webmanifest", "/icon.svg", "/icon-maskable.svg", "/icon-192.png", "/apple-touch-icon.png"];
const NEVER_CACHE = ["/api/", "/link/", "/gw/"];
/** Cached on first use rather than on install. */
const LAZY = ["/world.js"];

interface ExtendableEventLike extends Event {
  waitUntil(promise: Promise<unknown>): void;
}

interface FetchEventLike extends ExtendableEventLike {
  request: Request;
  respondWith(response: Response | Promise<Response>): void;
}

interface ServiceWorkerScope {
  location: Location;
  addEventListener(type: "install" | "activate", listener: (event: ExtendableEventLike) => void): void;
  addEventListener(type: "fetch", listener: (event: FetchEventLike) => void): void;
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void>; matchAll(options: { type: "window" }): Promise<{ postMessage(message: unknown): void }[]> };
}

const sw = self as unknown as ServiceWorkerScope;

sw.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => sw.skipWaiting()),
  );
});

sw.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => sw.clients.claim()),
  );
});

/** Tell open pages that a newer app has been fetched, so they can offer a reload. */
async function announceUpdate(): Promise<void> {
  for (const client of await sw.clients.matchAll({ type: "window" })) client.postMessage({ type: "galahad:updated" });
}

async function fromShell(event: FetchEventLike, key: string): Promise<Response> {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(key);
  const before = key === "/app.js" || key === "/world.js" ? cached?.clone() : undefined;
  const refresh = fetch(event.request)
    .then(async (response) => {
      if (response.ok) {
        if (before && (await before.text()) !== (await response.clone().text())) await announceUpdate();
        await cache.put(key, response.clone());
      }
      return response;
    })
    .catch(() => null);
  event.waitUntil(refresh);
  if (cached) return cached;
  const fresh = await refresh;
  return fresh ?? new Response("Galahad is offline and this page is not cached yet.", { status: 503 });
}

/** How long opening the app waits for the network before falling back to the cached page. */
const PAGE_TIMEOUT_MS = 3500;

/**
 * Opening the app: the page from the network first (it holds all the CSS, so a cached
 * copy meant the first launch after an update still showed the old look, unannounced),
 * the cached page when the network is slow or gone.
 */
async function page(event: FetchEventLike): Promise<Response> {
  const cache = await caches.open(VERSION);
  try {
    const response = await fetch(event.request, { signal: AbortSignal.timeout(PAGE_TIMEOUT_MS) });
    if (response.ok) {
      event.waitUntil(cache.put("/", response.clone()));
      return response;
    }
  } catch {
    /* slow or offline: the cached page */
  }
  return (await cache.match("/")) ?? new Response("Galahad is offline and this page is not cached yet.", { status: 503 });
}

sw.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== sw.location.origin) return;
  if (NEVER_CACHE.some((prefix) => url.pathname.startsWith(prefix))) return;
  if (request.mode === "navigate") {
    event.respondWith(page(event));
    return;
  }
  if (SHELL.includes(url.pathname) || LAZY.includes(url.pathname)) event.respondWith(fromShell(event, url.pathname));
});
