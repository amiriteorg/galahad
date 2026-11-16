/**
 * The gate before galahad.sh goes out, run on the built site (dist/, from `astro build`). Fails (non-zero) if it would:
 *  - run an inline script, or use an inline style or handler, that the CSP forbids (or load a script from elsewhere);
 *  - link to a page that does not exist;
 *  - leak private infrastructure (tailnet names, tailnet/private IPs, device names, emails), the Mac app's feed included;
 *  - hand `curl … | bash` anything but scripts/install.sh as the repository has it, or show another script's SHA-256.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../dist");
const installer = resolve(here, "../../../scripts/install.sh");
/** Paths the Worker answers (src/worker.ts), which no file in dist/ stands for. */
const WORKER_ROUTES = new Set(["/install"]);

if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
  console.error("site check: no dist/ to check: run `astro build` first");
  process.exit(1);
}

const files = (function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
})(root);

const problems: string[] = [];
const PRIVATE = [
  [/\btail[0-9a-f]{4,}\b/i, "tailnet name"],
  [/\.ts\.net\b/i, "tailnet DNS name"],
  [/\b100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b/, "tailnet IP"],
  [/\b(10|192\.168|172\.(1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}(\.\d{1,3})?\b/, "private IP"],
  [/\b(ultra|wkp-minaltan|optimus|gamma)\b/i, "private device name"],
  // (An image's density suffix, galahad@2x.webp, is not an address.)
  [/[A-Za-z0-9._%+-]+@(?!\d+x\.)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, "email address"],
] as const;

for (const file of files) {
  const rel = relative(root, file).replaceAll("\\", "/");
  if (!/\.(html|css|js|txt|svg|sh|xml)$/.test(file) && !rel.endsWith("_headers")) continue;
  const text = readFileSync(file, "utf8");
  for (const [pattern, what] of PRIVATE) if (pattern.test(text)) problems.push(`${rel}: contains a ${what} (${text.match(pattern)![0]})`);
  if (!file.endsWith(".html")) continue;
  for (const [tag, attrs] of text.matchAll(/<script\b([^>]*)>/gi)) {
    const src = /\ssrc="([^"]*)"/i.exec(attrs!)?.[1];
    if (!src) problems.push(`${rel}: an inline <script> is not allowed (CSP: script-src 'self')`);
    else if (!src.startsWith("/")) problems.push(`${rel}: a script from elsewhere (${src}) is not allowed: ${tag}`);
  }
  if (/<style\b/i.test(text)) problems.push(`${rel}: an inline <style> is blocked by the CSP`);
  if (/\sstyle=/i.test(text)) problems.push(`${rel}: inline style attributes are blocked by the CSP`);
  if (/\son[a-z]+=/i.test(text)) problems.push(`${rel}: inline event handlers are not allowed`);
  if (/\ssrc="data:/i.test(text)) problems.push(`${rel}: a data: image is blocked by the CSP (img-src 'self')`);
  for (const [, href] of text.matchAll(/\s(?:href|src)="(\/[^"#?]*)/g)) {
    if (WORKER_ROUTES.has(href!)) continue;
    const target = join(root, href!);
    const candidates = [target, join(target, "index.html"), `${target}.html`];
    if (!candidates.some((c) => statSync(c, { throwIfNoEntry: false })?.isFile())) problems.push(`${rel}: broken link ${href}`);
  }
}

// What `curl -fsSL https://galahad.sh | bash` runs: the repository's installer, exactly, and the hash the page shows.
const served = statSync(join(root, "install.sh"), { throwIfNoEntry: false }) ? readFileSync(join(root, "install.sh")) : null;
const source = readFileSync(installer);
if (!served) problems.push("install.sh: missing (src/pages/install.sh.ts)");
else if (!served.equals(source)) problems.push("install.sh: differs from scripts/install.sh");
const sha = createHash("sha256").update(source).digest("hex");
const home = readFileSync(join(root, "index.html"), "utf8");
if (!home.includes(sha)) problems.push(`index.html: doesn't show the installer's SHA-256 (${sha})`);

if (problems.length) {
  console.error(`site check failed:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`site check passed (${files.length} files; the installer is scripts/install.sh, ${sha.slice(0, 12)}…)`);
