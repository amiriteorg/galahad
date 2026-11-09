import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { appIcon, CHEVRON_FACETS, CHEVRONS, CREST, EMBLEM_BOX, emblemTree, flatMark, INK_ON_DARK, INK_TOKENS, markOnGrid, maskableIcon, SOUTH, STAR, STAR_CENTER, STAR_FACETS, toSvg, type SvgNode } from "./brand.ts";

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
  /** An edge's sweep in degrees back from the span (90 is parallel to the line of flight). */
  const sweepOf = ([[ax, ay], [bx, by]]: [XY, XY]): number => (Math.atan2(Math.abs(by - ay), Math.abs(bx - ax)) * 180) / Math.PI;
  const [LOWER_RIGHT, SOUTH_TIP, LOWER_LEFT] = [STAR[6]! as XY, STAR[8]! as XY, STAR[10]! as XY]; // ray k = 3, 4, 5

  test("planform alignment: every wing and tail edge runs at one of two sweeps, or along the line of flight", () => {
    const allowed = [CREST.sweep.lead, CREST.sweep.trail, 90];
    const shapes = CHEVRONS.map(points);
    expect(shapes).toHaveLength(3);
    for (const shape of shapes) {
      for (const edge of edges(shape)) {
        const sweep = sweepOf(edge);
        expect(allowed.some((a) => Math.abs(a - sweep) < 0.2)).toBe(true);
      }
    }
    // the wings sweep harder at the leading edge than the trailing one, so they taper to their tips
    const [, right] = shapes as [XY[], XY[]];
    const [root, tip] = [right[3]![1] - right[0]![1], right[2]![1] - right[1]![1]];
    expect(tip).toBeGreaterThan(0);
    expect(tip).toBeLessThan(root / 2);
  });

  test("the lower rays aim at the middle of the wing roots", () => {
    const [left, right] = CHEVRONS.map(points) as [XY[], XY[]];
    const rootMid = (shape: XY[], top: number, bottom: number): XY => [shape[top]![0], (shape[top]![1] + shape[bottom]![1]) / 2];
    expect(toLine(rootMid(right, 0, 3), [...STAR_CENTER], LOWER_RIGHT)).toBeLessThan(0.3);
    expect(toLine(rootMid(left, 3, 0), [...STAR_CENTER], LOWER_LEFT)).toBeLessThan(0.3);
  });

  test("one gap: every star tip that faces a wing or the tail stops one gap short, and the wings fly one gap ahead of the tail", () => {
    const [left, right, tail] = CHEVRONS.map(points) as [XY[], XY[], XY[]];
    const gap = CREST.gap;
    // lower ray tips to the wing roots (cut along the line of flight)
    expect(toLine(LOWER_RIGHT, right[0]!, right[3]!)).toBeCloseTo(gap, 0);
    expect(toLine(LOWER_LEFT, left[0]!, left[3]!)).toBeCloseTo(gap, 0);
    // wing trailing edge to the tail's leading edge, square to both
    expect(toLine(right[3]!, tail[0]!, tail[1]!)).toBeCloseTo(gap, 0);
    expect(toLine(right[2]!, tail[0]!, tail[1]!)).toBeCloseTo(gap, 0);
    // south tip to the tail's leading edges
    expect(SOUTH_TIP[0]).toBe(512);
    expect(SOUTH_TIP[1]).toBeCloseTo(STAR_CENTER[1] + SOUTH, 1);
    expect(toLine(SOUTH_TIP, tail[0]!, tail[1]!)).toBeCloseTo(gap, 0);
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
    const facets = walk(emblemTree("t", INK_ON_DARK)).filter((n) => n.tag === "path" && /^url\(#t-(lit|shade)\)$/.test(String(n.attrs.fill ?? "")));
    expect(facets.map((f) => f.attrs.fill)).toEqual(STAR_FACETS.map((_, i) => (i % 2 === 0 ? "url(#t-lit)" : "url(#t-shade)")));
  });

  test("the wings and the tail are ridges: the face toward the star lit, the face away shaded", () => {
    expect(CHEVRON_FACETS).toHaveLength(6);
    expect(CHEVRON_FACETS.filter((f) => f.lit)).toHaveLength(3);
    const faces = walk(emblemTree("t", INK_ON_DARK)).filter((n) => n.tag === "path" && /^url\(#t-(upper|under)\)$/.test(String(n.attrs.fill ?? "")));
    expect(faces.map((f) => f.attrs.fill)).toEqual(CHEVRON_FACETS.map((f) => (f.lit ? "url(#t-upper)" : "url(#t-under)")));
    // each lit face sits above its shaded twin
    const top = (d: string): number => Math.min(...points(d).map(([, y]) => y));
    const [lw, rw, lwu, rwu, tu, tl] = CHEVRON_FACETS.map((f) => top(f.d)) as number[];
    expect(lw).toBeLessThan(lwu!);
    expect(rw).toBeLessThan(rwu!);
    expect(tu).toBeLessThan(tl!);
  });

  test("every definition is prefixed, so many emblems can share a page", () => {
    const ids = walk(emblemTree("abc", INK_TOKENS))
      .map((n) => n.attrs.id)
      .filter((id): id is string => typeof id === "string");
    expect(ids.sort()).toEqual(["abc-lit", "abc-shade", "abc-under", "abc-upper"]);
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
