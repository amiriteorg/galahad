import { readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The PWA, bundled in memory at daemon start so every node serves the same app it runs. */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

export interface Assets {
  has(path: string): boolean;
  serve(path: string): Response;
}

interface Asset {
  body: string | Uint8Array<ArrayBuffer>;
  type: string;
}

export async function buildAssets(webDir = join(REPO_ROOT, "apps/web")): Promise<Assets> {
  const files = new Map<string, Asset>();
  const src = join(webDir, "src");
  try {
    // Each entrypoint is self-contained (no shared chunks), so the service worker can cache the
    // shell by fixed names: app.js (the app), boot.js (theme before first paint), sw.js, and
    // pair.js (the pairing flow with the invite schema, fetched only when a #pair= link opens).
    const result = await Bun.build({
      entrypoints: [join(src, "app.ts"), join(src, "boot.ts"), join(src, "pair.ts"), join(src, "sw.ts")],
      target: "browser",
      minify: true,
      naming: "[name].[ext]",
    });
    if (!result.success) throw new Error(result.logs.map((l) => String(l)).join("\n"));
    for (const output of result.outputs) {
      files.set(`/${basename(output.path)}`, { body: await output.text(), type: "text/javascript; charset=utf-8" });
    }
    const html = readFileSync(join(src, "index.html"));
    files.set("/", { body: html, type: "text/html; charset=utf-8" });
    files.set("/index.html", { body: html, type: "text/html; charset=utf-8" });
    files.set("/manifest.webmanifest", {
      body: readFileSync(join(src, "manifest.webmanifest")),
      type: "application/manifest+json",
    });
    files.set("/icon.svg", { body: readFileSync(join(REPO_ROOT, "assets/icon.svg")), type: "image/svg+xml" });
    files.set("/icon-maskable.svg", { body: readFileSync(join(src, "icon-maskable.svg")), type: "image/svg+xml" });
    // Raster icons for platforms that won't take SVG (iOS home screen, older Android launchers).
    // Rendered from the one emblem definition by `bun scripts/brand.ts --png`.
    for (const name of ["apple-touch-icon.png", "icon-192.png", "icon-512.png", "icon-maskable-512.png"]) {
      files.set(`/${name}`, { body: new Uint8Array(readFileSync(join(src, name))), type: "image/png" });
    }
  } catch (error) {
    const message = String((error as Error).message ?? error).replace(/[<>&]/g, "");
    files.set("/", { body: `<!doctype html><title>Galahad</title><p>The PWA failed to build: ${message}</p>`, type: "text/html" });
  }
  return {
    has: (path) => files.has(path),
    serve: (path) => {
      const asset = files.get(path)!;
      return new Response(asset.body, {
        headers: {
          "content-type": asset.type,
          "content-security-policy": CSP,
          "cache-control": "no-cache",
          "x-content-type-options": "nosniff",
          "referrer-policy": "no-referrer",
          "x-frame-options": "DENY",
        },
      });
    },
  };
}
