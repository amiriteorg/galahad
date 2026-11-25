import { describe, expect, test } from "bun:test";
import { sphereShades } from "../lib/orb-sphere.ts";
import { orbPalette, orbParts } from "../lib/orb.ts";
import { orb, type OrbTone } from "./orb.ts";

/** Captures the renderer's real createElement and createElementNS calls, without an HTML parser or a browser. */
class Node_ {
  readonly attrs: Record<string, string> = {};
  readonly children: Node_[] = [];
  text = "";
  constructor(readonly tag: string, readonly ns: "html" | "svg") {}
  setAttribute(key: string, value: string) { this.attrs[key] = value; }
  appendChild(child: Node_) { this.children.push(child); return child; }
  addEventListener() {}
}
function draw(...options: Parameters<typeof orb>[0][]): Node_[] {
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    createElement: (tag: string) => new Node_(tag, "html"),
    createElementNS(namespace: string, tag: string) {
      expect(namespace).toBe("http://www.w3.org/2000/svg");
      return new Node_(tag, "svg");
    },
    createTextNode: (text: string) => Object.assign(new Node_("#text", "html"), { text }),
  } });
  try { return options.map((option) => orb(option) as unknown as Node_); }
  finally { if (original) Object.defineProperty(globalThis, "document", original); else Reflect.deleteProperty(globalThis, "document"); }
}
const walk = (node: Node_): Node_[] => [node, ...node.children.flatMap(walk)];
const classed = (node: Node_, name: string) => walk(node).filter((child) => child.attrs.class?.split(" ").includes(name));
/** The shapes drawn, in order: the svg's children after its defs. */
const shapes = (node: Node_) => node.children[0]!.children.slice(1);

// Your word, 23 November 2026: Galahad, the one you talk to, as a Jarvis-like orb.
describe("Galahad's orb", () => {
  test("in the colour of his state, at any size, from fixed shapes alone", () => {
    for (const tone of ["neutral", "accent", "warn", "ok", "danger"] as OrbTone[]) {
      const [node] = draw({ tone, size: 168 });
      expect(node!.attrs["data-tone"]).toBe(tone);
      expect(node!.attrs.style).toBe("--orb-size:168px");
      for (const child of walk(node!)) {
        expect(child.ns === "html" ? ["span", "#text"] : ["svg", "defs", "radialGradient", "stop", "circle", "path", "g", "text"]).toContain(child.tag);
        for (const key of Object.keys(child.attrs)) expect(key).not.toMatch(/^(on|href|xlink)/i);
      }
      // Its colours are its state's own, its rings' and its glows' its tint; its points its tint's shades, and white's
      // (lib/orb-sphere.ts' sphereShades), lit by how near they are.
      const colors = new Set(walk(node!).flatMap((child) => [child.attrs.stroke, child.attrs["stop-color"]]).filter((c) => c?.startsWith("#")));
      const { tint, light, deep } = orbPalette(tone);
      // (Its nucleus is white at its heart.)
      expect([...colors].sort()).toEqual([tint, "#ffffff"].sort());
      // His data ring is lit in his light.
      for (const digit of classed(node!, "orb-data")[0]!.children) expect([digit.attrs.fill, "0123456789ABCDEF".includes(digit.children[0]!.text)]).toEqual([light, true]);
      const points = new Set(classed(node!, "orb-sphere")[0]!.children.map((child) => child.attrs.fill));
      for (const fill of points) expect([...sphereShades(tint, light, deep), ...sphereShades("#ffffff", "#ffffff", light)]).toContain(fill as string);
      expect(points.has("#ffffff")).toBe(true);
    }
    // A tone it doesn't know is its rest; a size past its bounds is held to them.
    const [odd, tiny, huge] = draw({ tone: "pulse" as OrbTone, size: 36 }, { size: 4 }, { size: 900 });
    expect([odd!.attrs["data-tone"], tiny!.attrs.style, huge!.attrs.style]).toEqual(["neutral", "--orb-size:16px", "--orb-size:320px"]);
  });

  test("each part as lib/orb.ts gives it, in its order: the whole display on his welcome, the sphere and a ring beside his words", () => {
    const [large, seat, small] = draw({ size: 168 }, { size: 64 }, { size: 28 });
    for (const [node, size] of [[large!, 168], [seat!, 64], [small!, 28]] as const) {
      expect(shapes(node).map((child) => child.attrs.class)).toEqual(orbParts(size).map((part) => `orb-${part.name}`));
    }
    // The ticks round the full display, each a stroke of its own: 72 fine ones and 12 marks.
    expect(classed(large!, "orb-ticks")[0]!.attrs.d!.match(/M/g)!.length).toBe(72);
    expect(classed(large!, "orb-marks")[0]!.attrs.d!.match(/M/g)!.length).toBe(12);
    // The outer ring's four arcs leave its notches room, at the top, the sides and the foot.
    expect(classed(large!, "orb-ring")[0]!.attrs.d).toStartWith("M9.93 -94.48A95 95 0 0 1 94.48 -9.93M94.48 9.93");
    expect(classed(small!, "orb-ticks")).toEqual([]);
  });

  test("two on one page never share a gradient, and each fill and stroke names its own", () => {
    const [a, b] = draw({ size: 168 }, { size: 168 });
    const ids = (node: Node_) => walk(node).filter((child) => child.tag.endsWith("Gradient")).map((child) => child.attrs.id!);
    expect(ids(a!).some((id) => ids(b!).includes(id))).toBe(false);
    for (const node of [a!, b!]) {
      const refs = walk(node).flatMap((child) => [child.attrs.fill, child.attrs.stroke]).filter((paint) => paint?.startsWith("url("));
      expect(refs.length).toBe(ids(node).length);
      for (const paint of refs) expect(ids(node)).toContain(paint!.slice(5, -1));
    }
  });

  test("named when it stands alone, decorative beside his name", () => {
    const [named, plain] = draw({ label: "Galahad: at work" }, {});
    expect([named!.attrs.role, named!.attrs["aria-label"], named!.attrs["aria-hidden"]]).toEqual(["img", "Galahad: at work", undefined]);
    expect([plain!.attrs.role, plain!.attrs["aria-hidden"]]).toEqual([undefined, "true"]);
  });
});
