import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { BRAND_SVGS } from "../../../scripts/brand.ts";
import { appIcon, INK, MARK_PATH, maskableIcon, monoIcon, ROUNDTABLE, TILE, toSvg, type SvgNode } from "./brand.ts";

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

  test("the app icon is the Roundtable on a white tile: its ring and chairs in black, Galahad's seat in the red that holds on white", () => {
    // The owner's, 15 Nov: "the white background with the black table and red".
    const icon = walk(appIcon());
    expect(icon.find((node) => node.tag === "rect")!.attrs).toMatchObject({ ...TILE, fill: INK.paper });
    expect(icon.find((node) => node.tag === "circle")!.attrs).toMatchObject({ stroke: INK.tile, "stroke-width": ROUNDTABLE.table.width });
    expect(icon.filter((node) => node.tag === "rect" && node.attrs.fill === INK.siege)).toHaveLength(1);
    expect(icon.find((node) => node.tag === "g" && node.attrs.fill === INK.tile)!.children).toHaveLength(ROUNDTABLE.seats.length);
    // The full-bleed form a Home Screen shows is the same: white, the table in black.
    expect(walk(maskableIcon()).find((node) => node.tag === "rect")!.attrs.fill).toBe(INK.paper);
    // Drawn, never a picture: crisp at a favicon's 16 px and a Home Screen's 180.
    expect(icon.some((node) => node.tag === "image")).toBe(false);
  });

  test("the full-bleed forms (Android's mask, iOS's Home Screen) keep the whole table inside the circle every mask keeps", () => {
    for (const scale of [0.6, 0.66]) {
      const placed = walk(maskableIcon(scale)).find((node) => node.tag === "g" && String(node.attrs.transform ?? "").includes("scale"))!;
      const [, tx, , k] = /translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)/.exec(String(placed.attrs.transform))!.map(Number) as number[];
      // The table's farthest point: a chair's outer corner, 2 units across and R + d/2 out from the middle.
      const { chair, siege } = ROUNDTABLE;
      const reach = Math.max(Math.hypot(chair.w / 2, chair.R + chair.d / 2), Math.hypot(siege.w / 2, siege.R + siege.d / 2));
      expect(Math.abs(tx! + 12 * k! - 512)).toBeLessThan(1);
      expect(reach * k!).toBeLessThanOrEqual(0.4 * 1024);
    }
  });

  test("the notification badge is the Roundtable in white on nothing: Android draws it from its alpha", () => {
    const icon = walk(monoIcon());
    expect(icon.some((node) => node.tag === "rect" && node.attrs.fill === INK.tile)).toBe(false);
    const inks = new Set(icon.flatMap((node) => [node.attrs.fill, node.attrs.stroke]).filter((ink) => ink !== undefined && ink !== "none"));
    expect([...inks]).toEqual(["#ffffff"]);
    // The table's ring, and a chair at every seat with Galahad's.
    expect(icon.filter((node) => node.tag === "circle")).toHaveLength(1);
    expect(icon.filter((node) => node.tag === "rect")).toHaveLength(ROUNDTABLE.seats.length + 1);
  });

  test("the committed brand files match the definition (run `bun scripts/brand.ts`)", () => {
    for (const [path, tree] of Object.entries(BRAND_SVGS)) expect(readFileSync(join(ROOT, path), "utf8")).toBe(`${toSvg(tree())}\n`);
  });

  test("the website's crest carries the helm as the app serves it, and nothing that is fetched; the icons carry no picture", () => {
    const served = readFileSync(join(ROOT, "apps/web/src/knights/galahad-helm.webp")).toString("base64");
    for (const path of ["assets/icon.svg", "apps/web/src/icon-maskable.svg", "apps/site/public/icon.svg"]) expect(readFileSync(join(ROOT, path), "utf8")).not.toContain("<image");
    for (const path of ["apps/site/public/crest-white.svg"]) {
      const svg = readFileSync(join(ROOT, path), "utf8");
      expect(svg).toContain(`data:image/webp;base64,${served}`);
      expect(svg).not.toMatch(/href="(?!data:image\/webp;base64,)/);
    }
  });
});
