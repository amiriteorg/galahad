/*
 * Service worker: keeps the app shell available offline.
 * Shell assets are served from cache and refreshed in the background
 * (stale-while-revalidate), so a new build is picked up on the next load.
 * Anything under /api, /link or /gw is never cached: those are signed,
 * live requests and always go to the network.
 */

const VERSION = "galahad-shell-v1";
const SHELL = ["/", "/app.js", "/manifest.webmanifest", "/icon.svg"];
const NEVER_CACHE = ["/api/", "/link/", "/gw/"];

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
  clients: { claim(): Promise<void> };
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

async function fromShell(request: Request, key: string): Promise<Response> {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(key);
  const refresh = fetch(request)
    .then(async (response) => {
      if (response.ok) await cache.put(key, response.clone());
      return response;
    })
    .catch(() => null);
  if (cached) return cached;
  const fresh = await refresh;
  return fresh ?? new Response("Galahad is offline and this page is not cached yet.", { status: 503 });
}

sw.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== sw.location.origin) return;
  if (NEVER_CACHE.some((prefix) => url.pathname.startsWith(prefix))) return;
  if (request.mode === "navigate") {
    event.respondWith(fromShell(request, "/"));
    return;
  }
  if (SHELL.includes(url.pathname)) event.respondWith(fromShell(request, url.pathname));
});
