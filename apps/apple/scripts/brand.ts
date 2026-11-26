#!/usr/bin/env bun
/*
 * Writes the Apple app's brand assets from the PWA's own (apps/web/src/brand.ts), so the two can't drift:
 *   - the app icon: Galahad's field in gold, rendered as light by scripts/field-icon.ts (the same renderer as the web
 *     app's icons): 1024 px edge to edge and opaque, with iOS's dark and tinted forms; the Mac's at each size it takes;
 *   - the Roundtable's mark (roundtableIcon()) in the black tile's ink for light mode and the cream ink for dark, Galahad's
 *     seat in his red for each;
 *   - Galahad's colours (INK): his red for what needs you, the cream ink, the black tile, and the app's ink accent.
 *
 *   bun apps/apple/scripts/brand.ts      (pure TypeScript: no browser, no ImageMagick)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { INK, roundtableIcon, toSvg } from "../../web/src/brand.ts";
import { downscale, greyscale, png, renderField, rgba } from "../../../scripts/field-icon.ts";

const ASSETS = join(import.meta.dir, "../Galahad/Assets.xcassets");
const MAC_ICON = join(import.meta.dir, "../Galahad/Mac/MacAssets.xcassets/MacIcon.appiconset");
/** A Mac icon's sizes, in points and scales. */
const MAC_SIZES = [[16, 1], [16, 2], [32, 1], [32, 2], [128, 1], [128, 2], [256, 1], [256, 2], [512, 1], [512, 2]] as const;
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
// Galahad's field in gold (apps/web/src/lib/field.ts; the owner's choice, 26 November 2026), rendered as light by
// scripts/field-icon.ts: edge to edge and opaque, as iOS wants an icon (it rounds the corners itself). iOS 18 and later
// also take a dark form (the same file: the icon is a night already) and a tinted one (its light in grey, for the system to
// colour). The Mac's is the same picture at each size a Mac draws one at: macOS clips it to its own rounded shape.
const icon = rgba(renderField(1024));
mkdirSync(join(ASSETS, "AppIcon.appiconset"), { recursive: true });
writeFileSync(join(ASSETS, "AppIcon.appiconset/AppIcon.png"), png(icon, 1024));
writeFileSync(join(ASSETS, "AppIcon.appiconset/AppIcon-tinted.png"), png(greyscale(icon), 1024));
console.log("rendered AppIcon.appiconset (any, dark, tinted)");
write(
  "AppIcon.appiconset/Contents.json",
  contents({
    images: [
      { filename: "AppIcon.png", idiom: "universal", platform: "ios", size: "1024x1024" },
      { appearances: [{ appearance: "luminosity", value: "dark" }], filename: "AppIcon.png", idiom: "universal", platform: "ios", size: "1024x1024" },
      { appearances: [{ appearance: "luminosity", value: "tinted" }], filename: "AppIcon-tinted.png", idiom: "universal", platform: "ios", size: "1024x1024" },
    ],
  }),
);
mkdirSync(MAC_ICON, { recursive: true });
for (const px of new Set(MAC_SIZES.map(([points, scale]) => points * scale))) writeFileSync(join(MAC_ICON, `icon_${px}.png`), png(px === 1024 ? icon : downscale(icon, 1024, px), px));
writeFileSync(
  join(MAC_ICON, "Contents.json"),
  contents({ images: MAC_SIZES.map(([points, scale]) => ({ filename: `icon_${points * scale}.png`, idiom: "mac", scale: `${scale}x`, size: `${points}x${points}` })) }),
);
console.log("rendered the Mac's MacIcon.appiconset");
