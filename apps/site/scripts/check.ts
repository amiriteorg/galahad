/**
 * Pre-deploy gate for galahad.bot. Fails (non-zero) if the public site would:
 *  - run any script, or rely on inline styles/handlers the CSP forbids;
 *  - link to a page that does not exist;
 *  - leak private infrastructure (tailnet names, tailnet/private IPs, device names, emails).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../public");
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
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, "email address"],
] as const;

for (const file of files) {
  const rel = relative(root, file).replaceAll("\\", "/");
  if (!/\.(html|css|txt|svg)$/.test(file) && !rel.endsWith("_headers")) continue;
  const text = readFileSync(file, "utf8");
  for (const [pattern, what] of PRIVATE) if (pattern.test(text)) problems.push(`${rel}: contains a ${what} (${text.match(pattern)![0]})`);
  if (!file.endsWith(".html")) continue;
  if (/<script\b/i.test(text)) problems.push(`${rel}: <script> is not allowed (CSP: default-src 'none')`);
  if (/\sstyle=/i.test(text)) problems.push(`${rel}: inline style attributes are blocked by the CSP`);
  if (/\son[a-z]+=/i.test(text)) problems.push(`${rel}: inline event handlers are not allowed`);
  for (const [, href] of text.matchAll(/\s(?:href|src)="(\/[^"#?]*)/g)) {
    const target = join(root, href!);
    const candidates = [target, join(target, "index.html"), `${target}.html`];
    if (!candidates.some((c) => statSync(c, { throwIfNoEntry: false })?.isFile())) problems.push(`${rel}: broken link ${href}`);
  }
}

if (problems.length) {
  console.error(`site check failed:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`site check passed (${files.length} files)`);
