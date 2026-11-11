import { describe, expect, test } from "bun:test";
import { buildAssets } from "../src/assets.ts";

const STATIC_IMPORT = /\bimport\s*[{*"']|\bimport\s+[\w$]/;

describe("the PWA bundle", () => {
  test("builds and is served with a strict CSP", async () => {
    const assets = await buildAssets();

    const index = assets.serve("/");
    const html = await index.text();
    expect(html).not.toContain("failed to build");
    expect(html).toContain('<script type="module" src="/app.js"></script>');
    expect(html).toContain('<script src="/boot.js"></script>');
    expect(html).toContain('rel="manifest"');
    expect(index.headers.get("content-security-policy")).toContain("script-src 'self'");
    expect(index.headers.get("x-frame-options")).toBe("DENY");
    // No inline scripts or inline event handlers: the CSP would block them anyway.
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);

    for (const path of ["/app.js", "/boot.js", "/pair.js", "/sw.js"]) {
      expect(assets.has(path)).toBe(true);
      const response = assets.serve(path);
      expect(response.headers.get("content-type")).toContain("javascript");
      expect(response.headers.get("content-security-policy")).toBeTruthy();
      expect((await response.text()).length).toBeGreaterThan(path === "/app.js" ? 5_000 : 200);
    }

    const manifest = JSON.parse(await assets.serve("/manifest.webmanifest").text());
    expect(manifest.name).toBe("Galahad");
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons[0].src).toBe("/icon.svg");
    expect(manifest.icons.some((icon: { purpose: string }) => icon.purpose === "maskable")).toBe(true);
    for (const icon of manifest.icons as { src: string }[]) expect(assets.has(icon.src)).toBe(true);
  });

  test("raster icons are real PNGs, and iOS gets one", async () => {
    const assets = await buildAssets();
    const html = await assets.serve("/").text();
    expect(html).toContain('rel="apple-touch-icon" href="/apple-touch-icon.png"');
    const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    for (const path of ["/apple-touch-icon.png", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png"]) {
      const response = assets.serve(path);
      expect(response.headers.get("content-type")).toBe("image/png");
      const bytes = new Uint8Array(await response.arrayBuffer());
      expect([...bytes.slice(0, 8)]).toEqual(PNG);
      // Width and height live in the IHDR chunk; a render that went wrong would not be square.
      const view = new DataView(bytes.buffer);
      expect(view.getUint32(16)).toBe(view.getUint32(20));
    }
  });

  test("every entry is self-contained, so the service worker can cache the shell by name", async () => {
    const assets = await buildAssets();
    for (const path of ["/app.js", "/boot.js", "/pair.js", "/sw.js"]) {
      expect(await assets.serve(path).text()).not.toMatch(STATIC_IMPORT);
    }
    // boot.js runs as a classic script before first paint: no module syntax at all.
    expect(await assets.serve("/boot.js").text()).not.toMatch(/\bexport\b/);
  });

  test("the browser bundles carry no server-only code and no HTML-string sinks", async () => {
    const assets = await buildAssets();
    for (const path of ["/app.js", "/pair.js"]) {
      const code = await assets.serve(path).text();
      expect(code).not.toContain("bun:sqlite");
      expect(code).not.toContain("@anthropic-ai/sdk");
      // Model output, memories and device names are only ever set as text.
      expect(code).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|createContextualFragment/);
      expect(code).not.toMatch(/localStorage\.setItem\([^)]*(secret|key-value|chat)/i);
      expect(code).not.toMatch(/sessionStorage|indexedDB\.open\([^)]*chat/i);
    }
  });

  test("the world's robot models are served as files, versioned ones cached for good", async () => {
    const assets = await buildAssets();
    const world = await assets.serve("/world.js").text();
    // The index the world fetches by is bundled into it; every file it names is served.
    const manifests = [...world.matchAll(/"([a-z0-9-]+\.json\?v=[0-9a-f]{8})"/g)].map((m) => m[1]!);
    // The Open Duck Mini, SO-101, Reachy Mini and the Open Source Rover.
    expect(manifests.length).toBe(4);
    for (const entry of manifests) {
      const path = `/world-assets/robots/${entry.split("?")[0]}`;
      expect(assets.has(path)).toBe(true);
      const response = assets.serve(path);
      expect(response.headers.get("content-type")).toBe("application/json");
      expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      const manifest = (await response.json()) as { bin: { file: string; bytes: number } };
      const bin = assets.serve(`/world-assets/robots/${manifest.bin.file}`);
      expect(bin.headers.get("content-type")).toBe("application/octet-stream");
      expect(bin.headers.get("cache-control")).toContain("immutable");
      expect((await bin.arrayBuffer()).byteLength).toBe(manifest.bin.bytes);
    }
    // The attribution is there for anyone who looks, and isn't cached for good.
    const notice = assets.serve("/world-assets/robots/NOTICE.txt");
    expect(notice.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(notice.headers.get("cache-control")).toBe("no-cache");
    expect(await notice.text()).toContain("Apache");
    expect(assets.has("/world-assets/robots/LICENSE.txt")).toBe(true);
    // Only the asset files: not the generated source beside them.
    expect(assets.has("/world-assets/robots/index.ts")).toBe(false);
  });

  test("daily use doesn't load the pairing schema; the pairing bundle does", async () => {
    const assets = await buildAssets();
    const app = await assets.serve("/app.js").text();
    const pair = await assets.serve("/pair.js").text();
    expect(app).toContain("/pair.js");
    expect(pair).toContain("invalid_type"); // zod, for the invite schema
    expect(app).not.toContain("invalid_type");
  });

  test("the shell goes compressed to a browser that takes it, and a copy it already has costs a 304", async () => {
    const assets = await buildAssets();
    const plain = assets.serve("/app.js");
    const body = await plain.text();
    const etag = plain.headers.get("etag");
    expect(etag).toBeTruthy();
    expect(plain.headers.get("vary")).toBe("Accept-Encoding");

    const br = assets.serve("/app.js", new Request("https://node.test/app.js", { headers: { "accept-encoding": "gzip, deflate, br" } }));
    expect(br.headers.get("content-encoding")).toBe("br");
    const brBytes = new Uint8Array(await br.arrayBuffer());
    expect(brBytes.length).toBeLessThan(body.length / 2);
    const { brotliDecompressSync, gunzipSync } = await import("node:zlib");
    expect(brotliDecompressSync(brBytes).toString("utf8")).toBe(body);
    expect(br.headers.get("content-security-policy")).toContain("script-src 'self'");

    const gz = assets.serve("/app.js", new Request("https://node.test/app.js", { headers: { "accept-encoding": "gzip" } }));
    expect(gz.headers.get("content-encoding")).toBe("gzip");
    expect(gunzipSync(new Uint8Array(await gz.arrayBuffer())).toString("utf8")).toBe(body);

    // Revalidating what it has: nothing comes back but the headers.
    const again = assets.serve("/app.js", new Request("https://node.test/app.js", { headers: { "if-none-match": etag!, "accept-encoding": "br" } }));
    expect(again.status).toBe(304);
    expect(await again.text()).toBe("");
    expect(again.headers.get("etag")).toBe(etag);
    // The page itself too (it carries all the CSS), and a changed file has another tag.
    const page = assets.serve("/");
    expect(assets.serve("/", new Request("https://node.test/", { headers: { "if-none-match": page.headers.get("etag")! } })).status).toBe(304);
    expect(assets.serve("/pair.js").headers.get("etag")).not.toBe(etag);
    // Images are already compressed: they're sent as they are.
    expect(assets.serve("/icon-192.png", new Request("https://node.test/icon-192.png", { headers: { "accept-encoding": "br" } })).headers.get("content-encoding")).toBeNull();
  });
});
