import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { BRAND_SVGS } from "../../../scripts/brand.ts";
import { appIcon, INK, MARK_PATH, maskableIcon, TILE, toSvg, type SvgNode } from "./brand.ts";

const ROOT = resolve(import.meta.dir, "../../..");
const walk = (node: SvgNode, out: SvgNode[] = []): SvgNode[] => {
  out.push(node);
  for (const child of node.children ?? []) walk(child, out);
  return out;
};
const HELM = "data:image/webp;base64,UklGRg==";

describe("the mark: Galahad's helm as the owner drew it", () => {
  test("its flat form is the helm's silhouette on the icon grid, the cross and the slit cut out of it", () => {
    // Only moves, curves, lines and closes, in plain numbers: nothing else can ride in a path.
    expect(MARK_PATH).toMatch(/^[MCLZ0-9 .-]+$/);
    const numbers = MARK_PATH.match(/-?\d+(\.\d+)?/g)!.map(Number);
    // Inside the 24-unit grid, within its 1.5 inset (a curve's handles may lean a hair past it).
    expect(Math.min(...numbers)).toBeGreaterThanOrEqual(1.2);
    expect(Math.max(...numbers)).toBeLessThanOrEqual(22.8);
    // The outline, and holes in it: the cross and the slit.
    expect(MARK_PATH.match(/M/g)!.length).toBeGreaterThanOrEqual(3);
  });

  test("the app icon is the drawn helm on a black tile; the maskable one keeps it inside any platform's mask", () => {
    const icon = walk(appIcon(HELM));
    const tile = icon.find((node) => node.tag === "rect")!;
    expect(tile.attrs).toMatchObject({ ...TILE, fill: INK.tile });
    const helm = icon.find((node) => node.tag === "image")!;
    expect(helm.attrs.href).toBe(HELM);
    // On the tile, with room round it.
    expect(Number(helm.attrs.x)).toBeGreaterThan(TILE.x);
    expect(Number(helm.attrs.x) + Number(helm.attrs.width)).toBeLessThan(TILE.x + TILE.width);
    for (const scale of [0.6, 0.72]) {
      const masked = walk(maskableIcon(HELM, scale));
      expect(masked.find((node) => node.tag === "rect")!.attrs).toMatchObject({ width: 1024, height: 1024, fill: INK.tile });
      const image = masked.find((node) => node.tag === "image")!;
      // Within the safe zone: the circle of 80% that every mask keeps.
      const corner = Math.hypot(Number(image.attrs.width) / 2, Number(image.attrs.height) / 2) * 0.62; // the helm's own round shoulders
      expect(corner).toBeLessThanOrEqual(0.4 * 1024);
    }
  });

  test("the committed brand files match the definition (run `bun scripts/brand.ts`)", () => {
    for (const [path, tree] of Object.entries(BRAND_SVGS)) expect(readFileSync(join(ROOT, path), "utf8")).toBe(`${toSvg(tree())}\n`);
  });

  test("a brand file carries the helm as the app serves it, and nothing that is fetched", () => {
    const served = readFileSync(join(ROOT, "apps/web/src/knights/galahad-helm.webp")).toString("base64");
    for (const path of ["assets/icon.svg", "apps/web/src/icon-maskable.svg", "apps/site/public/crest-white.svg"]) {
      const svg = readFileSync(join(ROOT, path), "utf8");
      expect(svg).toContain(`data:image/webp;base64,${served}`);
      expect(svg).not.toMatch(/href="(?!data:image\/webp;base64,)/);
    }
  });
});
