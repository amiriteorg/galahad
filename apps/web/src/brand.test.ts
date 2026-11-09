import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { appIcon, CHEVRONS, CREST, EMBLEM_BOX, emblemTree, flatMark, INK_ON_DARK, INK_TOKENS, markOnGrid, maskableIcon, SOUTH, STAR, STAR_CENTER, STAR_FACETS, toSvg, type SvgNode } from "./brand.ts";

const ROOT = resolve(import.meta.dir, "../../..");

const walk = (node: SvgNode, out: SvgNode[] = []): SvgNode[] => {
  out.push(node);
  for (const child of node.children ?? []) walk(child, out);
  return out;
};

describe("Crest, the emblem", () => {
  const points = (d: string): [number, number][] => [...d.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  /** Distance from point p to the line through a and b. */
  const toLine = ([px, py]: [number, number], [ax, ay]: [number, number], [bx, by]: [number, number]): number =>
    Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / Math.hypot(bx - ax, by - ay);

  test("the chevrons run on the star's diagonals", () => {
    const [left, right, second] = CHEVRONS.map(points);
    for (const shape of [left!, right!]) {
      // the blade's long edges are at 45°, like the star's diagonal rays
      const [a, b] = [shape[0]!, shape[1]!];
      expect(Math.abs(Math.abs(b[1] - a[1]) - Math.abs(b[0] - a[0]))).toBeLessThan(0.15);
    }
    // the lower diagonal rays point straight down each blade's centre line
    const [southEast, southWest] = [STAR[6]!, STAR[10]!]; // k = 6 points down-right, k = 10 down-left
    const mid = (shape: [number, number][]): [number, number] => [(shape[0]![0] + shape[3]![0]) / 2, (shape[0]![1] + shape[3]![1]) / 2];
    expect(toLine([...southEast], [...STAR_CENTER], mid(right!))).toBeLessThan(0.2);
    expect(toLine([...southWest], [...STAR_CENTER], mid(left!))).toBeLessThan(0.2);
    expect(second).toHaveLength(6);
  });

  test("one gap: every star tip that faces a chevron stops one gap short, and the chevrons are one gap apart", () => {
    const [left, right, second] = CHEVRONS.map(points);
    const gap = CREST.gap;
    // lower ray tips to the blades' square inner ends
    expect(toLine(STAR[6] as [number, number], right![0]!, right![3]!)).toBeCloseTo(gap, 0);
    expect(toLine(STAR[10] as [number, number], left![0]!, left![3]!)).toBeCloseTo(gap, 0);
    // blade to second chevron, across the arm
    expect(toLine(right![3]!, second![0]!, second![1]!)).toBeCloseTo(gap, 0);
    // south tip to the second chevron's peak
    expect(STAR[8]![0]).toBe(512);
    expect(STAR[8]![1]).toBeCloseTo(STAR_CENTER[1] + SOUTH, 1);
    expect(second![0]![1] - STAR[8]![1]).toBeCloseTo(gap, 0);
  });

  test("the mark is symmetric and sits on the 1024 grid", () => {
    for (const [x] of STAR) expect(STAR.some(([mx]) => Math.abs(mx - (1024 - x)) < 0.11)).toBe(true);
    expect(EMBLEM_BOX.x + EMBLEM_BOX.width / 2).toBe(512);
    expect(EMBLEM_BOX.y).toBeGreaterThan(0);
    expect(EMBLEM_BOX.y + EMBLEM_BOX.height).toBeLessThan(1024);
  });

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
    expect(ids.sort()).toEqual(["abc-chevrons", "abc-left", "abc-lit", "abc-right", "abc-shade"]);
  });

  test("theme ink is applied as a style (presentation attributes can't take var())", () => {
    const stops = walk(emblemTree("t", INK_TOKENS)).filter((n) => n.tag === "stop");
    expect(stops.length).toBe(12);
    for (const stop of stops) {
      expect(stop.attrs["stop-color"]).toBeUndefined();
      expect(String(stop.attrs.style)).toMatch(/^stop-color:var\(--em-[a-z-]+\)$/);
    }
  });

  test("the small mark is the whole crest, inside the 24px icon grid", () => {
    const d = markOnGrid(24);
    expect(d.match(/M/g)).toHaveLength(1 + CHEVRONS.length);
    const numbers = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    expect(Math.min(...numbers)).toBeGreaterThanOrEqual(1.5);
    expect(Math.max(...numbers)).toBeLessThanOrEqual(22.5);
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
