#!/usr/bin/env bun
/*
 * Regenerates every brand file from the one emblem definition (apps/web/src/brand.ts).
 *
 *   bun scripts/brand.ts          SVGs only (deterministic; safe to run any time)
 *   bun scripts/brand.ts --png    also renders the PNG icons with headless Chromium
 *                                 (set GALAHAD_BROWSER to the browser binary if it isn't found)
 */
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { appIcon, emblemTree, EMBLEM_BOX, flatMark, INK_ON_DARK, INK_ON_LIGHT, maskableIcon, toSvg, type SvgNode } from "../apps/web/src/brand.ts";

const ROOT = resolve(import.meta.dir, "..");
const at = (p: string): string => join(ROOT, p);

/** The emblem alone on a transparent ground, cropped to the mark. */
function emblemFile(ink: typeof INK_ON_DARK): SvgNode {
  const pad = 8;
  const { x, y, width, height } = EMBLEM_BOX;
  return {
    tag: "svg",
    attrs: { xmlns: "http://www.w3.org/2000/svg", viewBox: `${x - pad} ${y - pad} ${width + 2 * pad} ${height + 2 * pad}`, fill: "none" },
    children: [{ tag: "title", attrs: {}, children: [{ tag: "#text", attrs: { text: "Galahad" } }] }, emblemTree("em", ink)],
  };
}

const svgs: Record<string, SvgNode> = {
  "assets/icon.svg": appIcon(),
  "assets/galahad-mark.svg": flatMark(),
  "apps/web/src/icon-maskable.svg": maskableIcon(),
  "apps/site/public/icon.svg": appIcon(),
  "apps/site/public/crest-white.svg": emblemFile(INK_ON_DARK),
  "apps/site/public/crest-black.svg": emblemFile(INK_ON_LIGHT),
};

for (const [path, tree] of Object.entries(svgs)) {
  writeFileSync(at(path), `${toSvg(tree)}\n`);
  console.log(`wrote ${path}`);
}

if (Bun.argv.includes("--png")) await renderPngs();

async function renderPngs(): Promise<void> {
  const browser = findBrowser();
  if (!browser) throw new Error("No Chromium-family browser found; set GALAHAD_BROWSER to its binary.");
  const work = mkdtempSync(join(tmpdir(), "galahad-brand-"));
  try {
    const pngs: [string, SvgNode, number, string][] = [
      ["apps/web/src/icon-192.png", appIcon(), 192, "transparent"],
      ["apps/web/src/icon-512.png", appIcon(), 512, "transparent"],
      ["apps/web/src/icon-maskable-512.png", maskableIcon(), 512, "#050506"],
      // iOS rounds the corners itself, so the touch icon is full bleed with a larger emblem.
      ["apps/web/src/apple-touch-icon.png", maskableIcon(0.7), 180, "#050506"],
    ];
    for (const [path, tree, size, background] of pngs) {
      const out = join(work, `${size}-${pngs.findIndex((p) => p[0] === path)}.png`);
      await screenshot(browser, work, toSvg(tree), size, background, out);
      copyFileSync(out, at(path));
      console.log(`rendered ${path}`);
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
