import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { appIcon, emblemTree, flatMark, INK_ON_DARK, INK_TOKENS, maskableIcon, STAR, STAR_FACETS, starOnGrid, toSvg, type SvgNode } from "./brand.ts";

const ROOT = resolve(import.meta.dir, "../../..");

const walk = (node: SvgNode, out: SvgNode[] = []): SvgNode[] => {
  out.push(node);
  for (const child of node.children ?? []) walk(child, out);
  return out;
};

describe("Paragon, the emblem", () => {
  test("the star is faceted into sixteen triangles that alternate lit and shaded", () => {
    expect(STAR).toHaveLength(16);
    expect(STAR_FACETS).toHaveLength(16);
    const facets = walk(emblemTree("t", INK_ON_DARK)).filter((n) => n.tag === "path" && String(n.attrs.fill ?? "").startsWith("url(#t-"));
    expect(facets.map((f) => f.attrs.fill)).toEqual(STAR_FACETS.map((_, i) => (i % 2 === 0 ? "url(#t-lit)" : "url(#t-shade)")));
  });

  test("every definition is prefixed, so many emblems can share a page", () => {
    const ids = walk(emblemTree("abc", INK_TOKENS))
      .map((n) => n.attrs.id)
      .filter((id): id is string => typeof id === "string");
    expect(ids.length).toBeGreaterThan(5);
    for (const id of ids) expect(id.startsWith("abc-")).toBe(true);
  });

  test("theme ink is applied as a style (presentation attributes can't take var())", () => {
    const stops = walk(emblemTree("t", INK_TOKENS)).filter((n) => n.tag === "stop");
    expect(stops.length).toBe(12);
    for (const stop of stops) {
      expect(stop.attrs["stop-color"]).toBeUndefined();
      expect(String(stop.attrs.style)).toMatch(/^stop-color:var\(--em-[a-z-]+\)$/);
    }
  });

  test("the small mark fits the 24px icon grid", () => {
    const numbers = starOnGrid(24, 2).match(/-?\d+(\.\d+)?/g)!.map(Number);
    expect(Math.min(...numbers)).toBeGreaterThanOrEqual(2);
    expect(Math.max(...numbers)).toBeLessThanOrEqual(22);
  });

  test("the committed brand files match the definition (run `bun scripts/brand.ts`)", () => {
    const expected: Record<string, SvgNode> = {
      "assets/icon.svg": appIcon(),
      "assets/galahad-mark.svg": flatMark(),
      "apps/web/src/icon-maskable.svg": maskableIcon(),
      "apps/site/public/icon.svg": appIcon(),
    };
    for (const [path, tree] of Object.entries(expected)) {
      expect(readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n")).toBe(`${toSvg(tree)}\n`);
    }
  });

  test("serialisation escapes attribute values", () => {
    expect(toSvg({ tag: "g", attrs: { "data-x": `a"b<c&d` } })).toBe(`<g data-x="a&quot;b&lt;c&amp;d"/>`);
  });
});
