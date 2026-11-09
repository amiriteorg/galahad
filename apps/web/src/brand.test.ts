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

  type XY = [number, number];
  const edges = (shape: XY[]): [XY, XY][] => shape.map((p, i) => [p, shape[(i + 1) % shape.length]!]);
  /** An edge's angle from the baseline, in degrees. */
  const angleOf = ([[ax, ay], [bx, by]]: [XY, XY]): number => (Math.atan2(Math.abs(by - ay), Math.abs(bx - ax)) * 180) / Math.PI;
  const [LOWER_RIGHT, SOUTH_TIP, LOWER_LEFT] = [STAR[6]! as XY, STAR[8]! as XY, STAR[10]! as XY]; // rays 3, 4 and 5

  test("a pyramid: every band ends on one baseline, and every long edge runs at the pyramid's slope", () => {
    const shapes = CHEVRONS.map(points);
    expect(shapes).toHaveLength(4); // two legs, the chevron, the core
    for (const shape of shapes) {
      expect(Math.max(...shape.map(([, y]) => y))).toBe(CREST.base);
      for (const edge of edges(shape)) {
        const onBase = edge[0][1] === CREST.base && edge[1][1] === CREST.base;
        const angle = angleOf(edge);
        // the legs' top ends are cut square to the leg
        const square = Math.abs(angle - (90 - CREST.slope)) < 0.2;
        expect(onBase || square || Math.abs(angle - CREST.slope) < 0.2).toBe(true);
      }
    }
    // the core is solid: a triangle
    expect(shapes[3]).toHaveLength(3);
  });

  test("the star is the capstone: its lower rays point straight down the legs", () => {
    const [left, right] = CHEVRONS.map(points) as [XY[], XY[]];
    const middle = (a: XY, b: XY): XY => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    // a leg's centre line runs from the middle of its top cut to the middle of its foot
    expect(toLine(LOWER_RIGHT, middle(right[0]!, right[3]!), middle(right[1]!, right[2]!))).toBeLessThan(0.3);
    expect(toLine(LOWER_LEFT, middle(left[0]!, left[3]!), middle(left[1]!, left[2]!))).toBeLessThan(0.3);
    expect(toLine([...STAR_CENTER], middle(right[0]!, right[3]!), middle(right[1]!, right[2]!))).toBeLessThan(0.3);
  });

  test("one gap: every star tip that faces a band stops one gap short, and the bands are one gap apart", () => {
    const [left, right, chevron, core] = CHEVRONS.map(points) as [XY[], XY[], XY[], XY[]];
    const gap = CREST.gap;
    // lower ray tips to the legs' top cuts
    expect(toLine(LOWER_RIGHT, right[0]!, right[3]!)).toBeCloseTo(gap, 0);
    expect(toLine(LOWER_LEFT, left[0]!, left[3]!)).toBeCloseTo(gap, 0);
    // leg to chevron, chevron to core, square to the bands
    expect(toLine(right[3]!, chevron[0]!, chevron[1]!)).toBeCloseTo(gap, 0);
    expect(toLine(chevron[3]!, core[0]!, core[1]!)).toBeCloseTo(gap, 0);
    // south tip to the chevron's peak
    expect(SOUTH_TIP[0]).toBe(512);
    expect(SOUTH_TIP[1]).toBeCloseTo(STAR_CENTER[1] + SOUTH, 1);
    expect(toLine(SOUTH_TIP, chevron[0]!, chevron[1]!)).toBeCloseTo(gap, 0);
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
