import { describe, expect, test } from "bun:test";
import { orb, type OrbTone } from "./orb.ts";

/** Captures the renderer's real createElement and createElementNS calls, without an HTML parser or a browser. */
class Node_ {
  readonly attrs: Record<string, string> = {};
  readonly children: Node_[] = [];
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
    createTextNode: () => new Node_("#text", "html"),
  } });
  try { return options.map((option) => orb(option) as unknown as Node_); }
  finally { if (original) Object.defineProperty(globalThis, "document", original); else Reflect.deleteProperty(globalThis, "document"); }
}
const walk = (node: Node_): Node_[] => [node, ...node.children.flatMap(walk)];
const classed = (node: Node_, name: string) => walk(node).filter((child) => child.attrs.class?.split(" ").includes(name));

// Your word, 23 November 2026: Galahad, the one you talk to, as a Jarvis-like orb.
describe("Galahad's orb", () => {
  test("in the colour of his state, at any size, from fixed shapes alone", () => {
    for (const tone of ["neutral", "accent", "warn", "ok", "danger"] as OrbTone[]) {
      const [node] = draw({ tone, size: 168 });
      expect(node!.attrs["data-tone"]).toBe(tone);
      expect(node!.attrs.style).toBe("--orb-size:168px");
      for (const child of walk(node!)) {
        expect(child.ns === "html" ? ["span"] : ["svg", "defs", "radialGradient", "stop", "circle", "ellipse"]).toContain(child.tag);
        for (const key of Object.keys(child.attrs)) expect(key).not.toMatch(/^(on|href|xlink)/i);
      }
    }
    // A tone it doesn't know is its rest; a size past its bounds is held to them.
    const [odd, tiny, huge] = draw({ tone: "pulse" as OrbTone, size: 36 }, { size: 4 }, { size: 900 });
    expect([odd!.attrs["data-tone"], tiny!.attrs.style, huge!.attrs.style]).toEqual(["neutral", "--orb-size:16px", "--orb-size:320px"]);
  });

  test("large, the still rings of a heads-up display around it; small, the sphere with one ring", () => {
    const [large, small] = draw({ size: 168 }, { size: 36 });
    expect([classed(large!, "orb-ticks").length, classed(large!, "orb-ring").length, classed(large!, "orb-halo").length]).toEqual([1, 2, 1]);
    expect([classed(small!, "orb-ticks").length, classed(small!, "orb-ring").length, classed(small!, "orb-halo").length]).toEqual([0, 1, 0]);
  });

  test("two on one page never share a gradient, and each fill names its own", () => {
    const [a, b] = draw({ size: 168 }, { size: 168 });
    const ids = (node: Node_) => walk(node).filter((child) => child.tag === "radialGradient").map((child) => child.attrs.id!);
    expect(ids(a!).some((id) => ids(b!).includes(id))).toBe(false);
    for (const node of [a!, b!]) for (const fill of walk(node).map((child) => child.attrs.fill).filter(Boolean)) expect(ids(node)).toContain(fill!.slice(5, -1));
  });

  test("named when it stands alone, decorative beside his name", () => {
    const [named, plain] = draw({ label: "Galahad: at work" }, {});
    expect([named!.attrs.role, named!.attrs["aria-label"], named!.attrs["aria-hidden"]]).toEqual(["img", "Galahad: at work", undefined]);
    expect([plain!.attrs.role, plain!.attrs["aria-hidden"]]).toEqual([undefined, "true"]);
  });
});
