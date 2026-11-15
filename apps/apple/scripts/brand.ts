#!/usr/bin/env bun
/*
 * Writes the Apple app's brand assets from the PWA's own (apps/web/src/brand.ts), so the two can't drift:
 *   - the app icon: appIcon() rendered at 1024 px. iOS rounds an icon's corners itself and wants it opaque, so the
 *     drawing is the icon's tile edge to edge (its rounded corners and its edge's highlight are iOS's to draw); the
 *     Roundtable sits on the tile exactly as appIcon() seats it;
 *   - the Roundtable's mark (roundtableIcon()) in the black tile's ink for light mode and the cream ink for dark, Galahad's
 *     seat in his red for each;
 *   - Galahad's colours (INK): his red for what needs you, the cream ink, the black tile, and the app's ink accent.
 *
 *   bun apps/apple/scripts/brand.ts      (renders with headless Chrome and flattens with ImageMagick; GALAHAD_BROWSER
 *                                        names another Chromium-family browser)
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appIcon, INK, roundtableIcon, TILE, toSvg, type SvgNode } from "../../web/src/brand.ts";

const ASSETS = join(import.meta.dir, "../Galahad/Assets.xcassets");
const write = (path: string, text: string) => {
  mkdirSync(join(ASSETS, path, ".."), { recursive: true });
  writeFileSync(join(ASSETS, path), text);
  console.log(`wrote ${path}`);
};
const contents = (value: object) => `${JSON.stringify({ ...value, info: { author: "xcode", version: 1 } }, null, 2)}\n`;

// ---- colours -------------------------------------------------------------------------------------------------------
const rgb = (hex: string) => ({ red: `0x${hex.slice(1, 3)}`, green: `0x${hex.slice(3, 5)}`, blue: `0x${hex.slice(5, 7)}`, alpha: "1.000" });
const colour = (name: string, light: string, dark: string) =>
  write(
    `${name}.colorset/Contents.json`,
    contents({
      colors: [
        { color: { "color-space": "srgb", components: rgb(light) }, idiom: "universal" },
        { appearances: [{ appearance: "luminosity", value: "dark" }], color: { "color-space": "srgb", components: rgb(dark) }, idiom: "universal" },
      ],
    }),
  );
// The ink: the black tile on light, the cream on dark; and what is written on it.
colour("AccentColor", INK.tile, INK.light);
colour("OnAccent", INK.light, INK.tile);
// Galahad's red: what waits on you, and his seat.
colour("Siege", INK.siege, INK.siegeOnDark);
colour("Tile", INK.tile, INK.tile);
colour("Cream", INK.light, INK.light);

// ---- the Roundtable's mark -------------------------------------------------------------------------------------------
const mark = (ink: string, seat: string) => `${toSvg(roundtableIcon()).replaceAll("currentColor", ink).replaceAll(INK.siege, seat)}\n`;
write("Roundtable.imageset/roundtable.svg", mark(INK.tile, INK.siege));
write("Roundtable.imageset/roundtable-dark.svg", mark(INK.light, INK.siegeOnDark));
write(
  "Roundtable.imageset/Contents.json",
  contents({
    images: [
      { filename: "roundtable.svg", idiom: "universal" },
      { appearances: [{ appearance: "luminosity", value: "dark" }], filename: "roundtable-dark.svg", idiom: "universal" },
    ],
    properties: { "preserves-vector-representation": true, "template-rendering-intent": "original" },
  }),
);

// ---- the app icon ----------------------------------------------------------------------------------------------------
function fullBleed(icon: SvgNode): SvgNode {
  const [title, tile, table] = icon.children ?? [];
  if (!title || tile?.tag !== "rect" || table?.tag !== "g") throw new Error("appIcon() is no longer a tile with the table on it: look again at this script");
  return { ...icon, attrs: { ...icon.attrs, viewBox: `${TILE.x} ${TILE.y} ${TILE.width} ${TILE.height}` }, children: [title, { ...tile, attrs: { ...tile.attrs, rx: 0 } }, table] };
}

const browser = [process.env.GALAHAD_BROWSER, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/chromium", "/usr/bin/google-chrome"].find((path): path is string => Boolean(path && existsSync(path)));
const magick = Bun.which("magick");
if (!browser || !magick) throw new Error("Rendering the icon takes a Chromium-family browser (GALAHAD_BROWSER) and ImageMagick (magick).");
const work = mkdtempSync(join(tmpdir(), "galahad-apple-brand-"));
try {
  const page = join(work, "icon.html");
  writeFileSync(page, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:${INK.paper}}svg{display:block;width:1024px;height:1024px}</style>${toSvg(fullBleed(appIcon()))}`);
  const shot = join(work, "shot.png");
  const proc = Bun.spawn([browser, "--headless=new", "--disable-gpu", "--no-first-run", "--disable-extensions", `--user-data-dir=${join(work, "profile")}`, "--hide-scrollbars", "--window-size=1024,1024", `--screenshot=${shot}`, `file://${page}`], { stdout: "ignore", stderr: "ignore" });
  const timer = setTimeout(() => proc.kill(), 30_000);
  await proc.exited;
  clearTimeout(timer);
  if (!existsSync(shot)) throw new Error("the browser did not render the icon");
  // Opaque, as iOS wants an icon: the tile's white under anything the render left transparent, and no metadata.
  const flat = join(work, "flat.png");
  const done = Bun.spawnSync([magick, shot, "-background", INK.paper, "-alpha", "remove", "-alpha", "off", "-strip", "-resize", "1024x1024!", `PNG24:${flat}`]);
  if (done.exitCode !== 0 || !existsSync(flat)) throw new Error(`ImageMagick couldn't flatten the icon: ${done.stderr.toString()}`);
  mkdirSync(join(ASSETS, "AppIcon.appiconset"), { recursive: true });
  copyFileSync(flat, join(ASSETS, "AppIcon.appiconset/AppIcon.png"));
  console.log("rendered AppIcon.appiconset/AppIcon.png");
  write("AppIcon.appiconset/Contents.json", contents({ images: [{ filename: "AppIcon.png", idiom: "universal", platform: "ios", size: "1024x1024" }] }));
} finally {
  rmSync(work, { recursive: true, force: true });
}
