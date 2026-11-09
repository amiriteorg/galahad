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

  test("daily use doesn't load the pairing schema; the pairing bundle does", async () => {
    const assets = await buildAssets();
    const app = await assets.serve("/app.js").text();
    const pair = await assets.serve("/pair.js").text();
    expect(app).toContain("/pair.js");
    expect(pair).toContain("invalid_type"); // zod, for the invite schema
    expect(app).not.toContain("invalid_type");
  });
});
