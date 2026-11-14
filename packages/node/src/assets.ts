import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { brotli, gzip, pickEncoding } from "./compress.ts";

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
  /** The file, compressed when the request accepts it, or 304 when it already holds this version. */
  serve(path: string, request?: Request): Response;
}

interface Asset {
  body: string | Uint8Array<ArrayBuffer>;
  type: string;
  /** Content-versioned files may be kept for good; everything else is revalidated. */
  immutable?: boolean;
}

/** Text compresses well; images are sent as they are. */
const COMPRESSIBLE = /^(text\/|application\/(json|manifest\+json)|image\/svg\+xml)/;

/**
 * What each file is sent as: its validator, and its compressed copies (made on first
 * request, then kept: daemons that never serve the app never pay for them).
 */
interface Prepared {
  etag: string;
  bytes: Uint8Array<ArrayBuffer>;
  br?: Uint8Array<ArrayBuffer>;
  gzip?: Uint8Array<ArrayBuffer>;
}

function prepare(asset: Asset): Prepared {
  const bytes = typeof asset.body === "string" ? new TextEncoder().encode(asset.body) : asset.body;
  // Weak: the same file, whichever encoding carried it.
  return { etag: `W/"${createHash("sha256").update(bytes).digest("base64url").slice(0, 27)}"`, bytes: bytes as Uint8Array<ArrayBuffer> };
}

/** Does If-None-Match name this version (weak comparison, as RFC 9110 has it for GET)? */
const holds = (ifNoneMatch: string | null, etag: string): boolean =>
  Boolean(ifNoneMatch) && (ifNoneMatch!.trim() === "*" || ifNoneMatch!.split(",").some((tag) => tag.trim().replace(/^W\//, "") === etag.replace(/^W\//, "")));

export async function buildAssets(webDir = join(REPO_ROOT, "apps/web")): Promise<Assets> {
  const files = new Map<string, Asset>();
  const src = join(webDir, "src");
  try {
    // Each entrypoint is self-contained (no shared chunks), so the service worker can cache the
    // shell by fixed names: app.js (the app), boot.js (theme before first paint), sw.js,
    // pair.js (the pairing flow with the invite schema, fetched only when a #pair= link opens), and
    // term.js (the terminal emulator, fetched only when a terminal opens).
    const result = await Bun.build({
      entrypoints: [join(src, "app.ts"), join(src, "boot.ts"), join(src, "pair.ts"), join(src, "sw.ts"), join(src, "term.ts")],
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
    // Where the bank sends you back after authorising: the app itself finishes it.
    files.set("/bank/callback", { body: html, type: "text/html; charset=utf-8" });
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
  const prepared = new Map<string, Prepared>();
  return {
    has: (path) => files.has(path),
    serve: (path, request) => {
      const asset = files.get(path)!;
      let ready = prepared.get(path);
      if (!ready) prepared.set(path, (ready = prepare(asset)));
      const compressible = COMPRESSIBLE.test(asset.type);
      const headers: Record<string, string> = {
        "content-type": asset.type,
        "content-security-policy": CSP,
        "cache-control": asset.immutable ? "public, max-age=31536000, immutable" : "no-cache",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        "x-frame-options": "DENY",
        etag: ready.etag,
        ...(compressible ? { vary: "Accept-Encoding" } : {}),
      };
      // "no-cache" means "ask first": a browser (or the service worker) that has this version gets no body.
      if (holds(request?.headers.get("if-none-match") ?? null, ready.etag)) return new Response(null, { status: 304, headers });
      const encoding = compressible ? pickEncoding(request?.headers.get("accept-encoding") ?? null) : null;
      if (encoding === "br") {
        ready.br ??= brotli(ready.bytes, 9);
        return new Response(ready.br, { headers: { ...headers, "content-encoding": "br" } });
      }
      if (encoding === "gzip") {
        ready.gzip ??= gzip(ready.bytes, 9);
        return new Response(ready.gzip, { headers: { ...headers, "content-encoding": "gzip" } });
      }
      return new Response(ready.bytes, { headers });
    },
  };
}
