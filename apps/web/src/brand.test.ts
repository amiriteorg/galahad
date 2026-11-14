import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { appIcon, CELLS, crestFile, CROSS, dotAt, emblemTree, EYES, flatMark, HELM, INK, markOnGrid, maskableIcon, SLITS, toSvg, type SvgNode } from "./brand.ts";

const ROOT = resolve(import.meta.dir, "../../..");
const M = CELLS / 2;

const walk = (node: SvgNode, out: SvgNode[] = []): SvgNode[] => {
  out.push(node);
  for (const child of node.children ?? []) walk(child, out);
  return out;
};
/** The centres of a dot path's dots (each drawn from its left edge, then two arcs of its radius). */
const centres = (d: string): [number, number][] => [...d.matchAll(/M(-?[\d.]+) (-?[\d.]+)a([\d.]+)/g)].map((m) => [Number(m[1]) + Number(m[3]), Number(m[2])]);

describe("the mark: a Templar's helm", () => {
  test("cut like a heater shield: mirror-true, a flat crown, its corners cut, its sides angled in to a point", () => {
    for (const [x, y] of HELM) expect(HELM.some(([mx, my]) => Math.abs(mx - (2 * M - x)) < 1e-9 && my === y)).toBe(true);
    const top = Math.min(...HELM.map(([, y]) => y));
    expect(HELM.filter(([, y]) => y === top)).toHaveLength(2);
    const bottom = HELM.reduce((low, point) => (point[1] > low[1] ? point : low));
    expect(bottom[0]).toBe(M);
    // Every edge is straight and none upright but the sides: the corners are cut, the jaw angled to the point.
    const edges = HELM.map((point, i) => [point, HELM[(i + 1) % HELM.length]!] as const);
    const slopes = edges.map(([[ax, ay], [bx, by]]) => (Math.atan2(Math.abs(by - ay), Math.abs(bx - ax)) * 180) / Math.PI);
    expect(slopes.filter((angle) => angle > 30 && angle < 60).length).toBeGreaterThanOrEqual(4);
    for (const [x, y] of HELM) {
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(CELLS);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(CELLS);
    }
  });

  test("its brow band and nasal strip are the cross; the slits sit under the brow, either side of the strip, with his eyes in them", () => {
    const [brow, strip] = CROSS;
    expect(brow!.hw).toBeGreaterThan(brow!.hh);
    expect(strip!.hh).toBeGreaterThan(strip!.hw);
    expect(strip!.cx).toBe(M);
    expect(SLITS).toHaveLength(2);
    for (const slit of SLITS) {
      expect(slit.cy - slit.hh).toBeGreaterThanOrEqual(brow!.cy + brow!.hh);
      expect(Math.abs(slit.cx - M) - slit.hw).toBeGreaterThanOrEqual(strip!.hw);
      expect(SLITS.some((other) => Math.abs(other.cx - (2 * M - slit.cx)) < 1e-9 && other.cy === slit.cy)).toBe(true);
    }
    for (const [i, eye] of EYES.entries()) {
      const slit = SLITS[i]!;
      expect(eye.hw).toBeLessThanOrEqual(slit.hw);
      expect(eye.hh).toBeLessThanOrEqual(slit.hh);
    }
    // The strip runs down to the point.
    expect(strip!.cy + strip!.hh).toBeGreaterThanOrEqual(Math.max(...HELM.map(([, y]) => y)) - 1);
  });

  test("in dots, at any grain: mirror-true, the cross oxblood and the rest white, never a dot in a slit", () => {
    for (const grain of [13, 17, 23, 31, 39]) {
      const tree = emblemTree({ grain, side: 1000, eyes: true });
      const paths = walk(tree).filter((node) => node.tag === "path");
      const helm = paths.find((path) => path.attrs.fill === INK.helm)!;
      const cross = paths.find((path) => path.attrs.fill === INK.cross)!;
      expect(centres(String(cross.attrs.d)).length, `grain ${grain}`).toBeGreaterThan(grain / 3);
      for (const path of [helm, cross]) {
        // (Each dot is written to a tenth of a unit, so its mirror is found within a unit.)
        const dots = centres(String(path.attrs.d));
        for (const [x, y] of dots) expect(dots.some(([mx, my]) => Math.abs(mx - (1000 - x)) < 1 && Math.abs(my - y) < 1), `grain ${grain}: ${x},${y}`).toBe(true);
      }
      // The slits are glass with his eyes in them; the eyes are inside the glass.
      const rects = walk(tree).filter((node) => node.tag === "rect");
      expect(rects.filter((rect) => rect.attrs.fill === INK.night)).toHaveLength(2);
      expect(rects.filter((rect) => rect.attrs.fill === INK.eyes)).toHaveLength(2);
    }
    for (const slit of SLITS) for (let dx = -slit.hw; dx <= slit.hw; dx += 0.5) for (let dy = -slit.hh; dy <= slit.hh; dy += 0.5) expect(dotAt(slit.cx + dx, slit.cy + dy)).toBeNull();
    expect(dotAt(M, CROSS[0]!.cy)).toBe("cross");
    expect(dotAt(M - 7, 6)).toBe("helm");
    expect(dotAt(1, 1)).toBeNull();
  });

  test("one ink draws it all, the cross and the slits gaps in it; nothing in it points at another", () => {
    const flat = walk(emblemTree({ grain: 23, side: 1000, ink: "currentColor", eyes: true }));
    expect(flat.filter((node) => node.tag === "path").map((node) => node.attrs.fill)).toEqual(["currentColor"]);
    expect(flat.some((node) => node.tag === "rect")).toBe(false);
    for (const tree of [appIcon(), maskableIcon(), flatMark(), crestFile("white"), crestFile("black"), emblemTree({ grain: 13, side: 24, eyes: true, unlit: true })]) {
      for (const node of walk(tree)) {
        expect(node.attrs.id).toBeUndefined();
        expect(Object.values(node.attrs).some((value) => String(value).includes("url("))).toBe(false);
      }
    }
  });

  test("the small mark is the whole helm inside the 24px icon grid, its T cut out", () => {
    const d = markOnGrid(24);
    expect(d.match(/M/g)).toHaveLength(1 + 2 + SLITS.length); // the outline, the cross's two bars, the slits
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
      "apps/site/public/crest-white.svg": crestFile("white"),
      "apps/site/public/crest-black.svg": crestFile("black"),
    };
    for (const [path, tree] of Object.entries(expected)) {
      expect(readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n")).toBe(`${toSvg(tree)}\n`);
    }
  });

  test("serialisation escapes attribute values", () => {
    expect(toSvg({ tag: "g", attrs: { "data-x": `a"b<c&d` } })).toBe(`<g data-x="a&quot;b&lt;c&amp;d"/>`);
  });
});
