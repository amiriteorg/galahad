#!/usr/bin/env bun
/*
 * Regenerates every brand file (apps/web/src/brand.ts): the app's icons are the Roundtable, drawn; the website's crest
 * is Galahad's helm as the owner drew it.
 *
 *   bun scripts/brand.ts          SVGs only (deterministic; safe to run any time)
 *   bun scripts/brand.ts --png    also renders the PNG icons with headless Chromium
 *                                 (set GALAHAD_BROWSER to the browser binary if it isn't found)
 *
 * The icons are drawn (vectors only), so every PNG is rendered from the same SVG at its own size; the crest carries the
 * helm the app serves (apps/web/src/knights/galahad-helm.webp).
 */
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { appIcon, crestFile, flatMark, INK, maskableIcon, monoIcon, roundtableIcon, toSvg, type SvgNode } from "../apps/web/src/brand.ts";

const ROOT = resolve(import.meta.dir, "..");
const at = (p: string): string => join(ROOT, p);
const dataUrl = (p: string): string => `data:image/webp;base64,${readFileSync(at(p)).toString("base64")}`;
/** The helm as the app serves it, for the website's crest. */
const HELM = dataUrl("apps/web/src/knights/galahad-helm.webp");

/** Every committed SVG, by where it goes: what tests read back (brand.test.ts). */
export const BRAND_SVGS: Record<string, () => SvgNode> = {
  "assets/icon.svg": () => appIcon(),
  "assets/galahad-mark.svg": () => flatMark(),
  "assets/roundtable.svg": () => roundtableIcon(),
  "apps/web/src/icon-maskable.svg": () => maskableIcon(),
  "apps/site/public/icon.svg": () => appIcon(),
  "apps/site/public/crest-white.svg": () => crestFile(HELM),
  "apps/site/public/crest-black.svg": () => crestFile(HELM),
};

if (import.meta.main) {
  for (const [path, tree] of Object.entries(BRAND_SVGS)) {
    writeFileSync(at(path), `${toSvg(tree())}\n`);
    console.log(`wrote ${path}`);
  }
  if (Bun.argv.includes("--png")) await renderPngs();
}

async function renderPngs(): Promise<void> {
  const browser = findBrowser();
  if (!browser) throw new Error("No Chromium-family browser found; set GALAHAD_BROWSER to its binary.");
  const work = mkdtempSync(join(tmpdir(), "galahad-brand-"));
  try {
    const pngs: [string, SvgNode, number, string][] = [
      ["apps/web/src/icon-192.png", appIcon(), 192, "transparent"],
      ["apps/web/src/icon-512.png", appIcon(), 512, "transparent"],
      ["apps/web/src/icon-maskable-512.png", maskableIcon(), 512, INK.paper],
      // iOS rounds the corners itself, so the touch icon is full bleed with a larger table.
      ["apps/web/src/apple-touch-icon.png", maskableIcon(0.76), 180, INK.paper],
      // A notification's badge: one colour and its alpha, kept as rendered (a palette would make its edge jagged).
      ["apps/web/src/icon-mono-96.png", monoIcon(), 96, "transparent"],
    ];
    // A drawing makes a heavy PNG: where ImageMagick is installed, each icon is cut to a 256-colour palette (a quarter
    // of the bytes, the same to the eye) and its metadata stripped; without it, the full-colour render is kept.
    const magick = Bun.which("magick");
    for (const [path, tree, size, background] of pngs) {
      const out = join(work, `${size}-${pngs.findIndex((p) => p[0] === path)}.png`);
      await screenshot(browser, work, toSvg(tree), size, background, out);
      const flat = path.includes("-mono-");
      if (magick) {
        const small = `${out}.8.png`;
        const quantised = Bun.spawnSync([magick, out, "-strip", ...(flat ? [`PNG32:${small}`] : ["-dither", "FloydSteinberg", "-colors", "256", `PNG8:${small}`])], { stdout: "ignore", stderr: "ignore" });
        if (quantised.exitCode === 0 && existsSync(small)) copyFileSync(small, out);
      }
      copyFileSync(out, at(path));
      console.log(`rendered ${path}${magick ? (flat ? " (metadata stripped)" : " (256 colours)") : ""}`);
    }
    copyFileSync(at("apps/web/src/apple-touch-icon.png"), at("apps/site/public/apple-touch-icon.png"));
    console.log("copied apps/site/public/apple-touch-icon.png");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function findBrowser(): string | null {
  const candidates = [
    process.env.GALAHAD_BROWSER,
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
  ];
  return candidates.find((c): c is string => Boolean(c && existsSync(c))) ?? null;
}

async function screenshot(browser: string, work: string, svg: string, size: number, background: string, out: string): Promise<void> {
  // The SVG is inlined into the page: no file:// references, so unusual characters in paths can't break it.
  const page = join(work, `page-${size}.html`);
  writeFileSync(page, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:${background}}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  const proc = Bun.spawn(
    [
      browser,
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--disable-extensions",
      `--user-data-dir=${join(work, `profile-${size}-${Date.now()}`)}`,
      "--hide-scrollbars",
      "--default-background-color=00000000",
      `--window-size=${size},${size}`,
      `--screenshot=${out}`,
      `file:///${page.replaceAll("\\", "/")}`,
    ],
    { stdout: "ignore", stderr: "ignore" },
  );
  const timer = setTimeout(() => proc.kill(), 30_000);
  await proc.exited;
  clearTimeout(timer);
  if (!existsSync(out)) throw new Error(`The browser did not render ${out}`);
}
