import { describe, expect, test } from "bun:test";
import { buildAssets } from "../src/assets.ts";

describe("the PWA bundle", () => {
  test("builds and is served with a strict CSP", async () => {
    const assets = await buildAssets();

    const index = assets.serve("/");
    const html = await index.text();
    expect(html).not.toContain("failed to build");
    expect(html).toContain('<script type="module" src="/app.js"></script>');
    expect(html).toContain('rel="manifest"');
    expect(index.headers.get("content-security-policy")).toContain("script-src 'self'");
    expect(index.headers.get("x-frame-options")).toBe("DENY");

    for (const path of ["/app.js", "/sw.js"]) {
      expect(assets.has(path)).toBe(true);
      const response = assets.serve(path);
      expect(response.headers.get("content-type")).toContain("javascript");
      expect(response.headers.get("content-security-policy")).toBeTruthy();
      expect((await response.text()).length).toBeGreaterThan(path === "/app.js" ? 5_000 : 300);
    }

    const manifest = JSON.parse(await assets.serve("/manifest.webmanifest").text());
    expect(manifest.name).toBe("Galahad");
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons[0].src).toBe("/icon.svg");
    expect(assets.has("/icon.svg")).toBe(true);
  });

  test("the browser bundle carries no server-only code", async () => {
    const app = await (await buildAssets()).serve("/app.js").text();
    expect(app).not.toContain("bun:sqlite");
    expect(app).not.toContain("@anthropic-ai/sdk");
    expect(app).not.toMatch(/localStorage\.setItem\([^)]*(secret|key-value)/i);
  });
});
