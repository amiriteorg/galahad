import { describe, expect, test } from "bun:test";
import { AVATAR_ACCESSORIES, AVATAR_EXPRESSIONS, AVATAR_EYES, AVATAR_FORMS, defaultAvatar } from "@galahad/core/avatar";
import { workerAvatar, type WorkerAvatarOptions } from "./avatar.ts";

/** Captures the renderer's real createElementNS calls, without an HTML parser or browser dependency. */
class SvgNode {
  readonly attrs: Record<string, string> = {};
  readonly children: SvgNode[] = [];
  constructor(readonly tag: string) {}
  setAttribute(key: string, value: string) { this.attrs[key] = value; }
  appendChild(child: SvgNode) { this.children.push(child); return child; }
}
function render(...options: WorkerAvatarOptions[]): SvgNode[] {
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    createElementNS(namespace: string, tag: string) {
      expect(namespace).toBe("http://www.w3.org/2000/svg");
      return new SvgNode(tag);
    },
  } });
  try { return options.map((option) => workerAvatar(option) as unknown as SvgNode); }
  finally { if (original) Object.defineProperty(globalThis, "document", original); else Reflect.deleteProperty(globalThis, "document"); }
}
const walk = (node: SvgNode): SvgNode[] => [node, ...node.children.flatMap(walk)];

describe("worker mascots at the SVG boundary", () => {
  test("malformed snapshot profiles cannot introduce markup, event attributes or external paint", () => {
    const name = '<image href="https://invalid.example/pixel" onload="alert(1)">';
    const profile = { ...defaultAvatar("ada"), color: "url(https://invalid.example/paint)", accent: '#fff" onload="alert(1)', form: "foreignObject", onload: "alert(1)" };
    const [node] = render({ id: "ada", name, profile, expression: 'idle" onload="alert(1)' as never });
    expect(node!.attrs["aria-label"]).toBe(`${name} · idle`);
    expect(node!.attrs["data-expression"]).toBe("idle");
    expect(walk(node!).some((part) => part.attrs["stop-color"] === defaultAvatar("ada").color)).toBe(true);
    for (const part of walk(node!)) {
      expect(["svg", "defs", "radialGradient", "stop", "g", "ellipse", "circle", "path", "rect"]).toContain(part.tag);
      for (const [key, value] of Object.entries(part.attrs)) {
        expect(key).not.toMatch(/^(on|href|style)/i);
        if (key !== "aria-label") expect(value).not.toContain("invalid.example");
        if (key === "fill" || key === "stroke" || key === "stop-color") expect(value).toMatch(/^(none|#[0-9a-f]{6}|url\(#worker-paint-\d+\))$/i);
      }
    }
  });

  test("gradients stay local and unique when many workers share a page", () => {
    const nodes = render(...Array.from({ length: 32 }, (_, i) => ({ id: `worker-${i}`, name: `Worker ${i}` })));
    const ids = nodes.flatMap((node) => walk(node).flatMap((part) => part.attrs.id ? [part.attrs.id] : []));
    expect(new Set(ids).size).toBe(32);
    for (const node of nodes) {
      const own = new Set(walk(node).flatMap((part) => part.attrs.id ? [part.attrs.id] : []));
      for (const part of walk(node)) if (part.attrs.fill?.startsWith("url(")) expect(own.has(part.attrs.fill.slice(5, -1))).toBe(true);
    }
  });

  test("all supported small silhouettes and expressions render without arbitrary SVG content", () => {
    const options = AVATAR_FORMS.flatMap((form) => AVATAR_EYES.flatMap((eyes) => AVATAR_ACCESSORIES.flatMap((accessory) => AVATAR_EXPRESSIONS.map((expression) => ({ id: "ada", name: "Ada", profile: { ...defaultAvatar("ada"), form, eyes, accessory }, expression, size: 28 })))));
    for (const node of render(...options)) {
      expect(node.attrs.width).toBe("28");
      expect(node.attrs.height).toBe("28");
      expect(walk(node).length).toBeLessThan(40);
      expect(JSON.stringify(node)).not.toMatch(/NaN|undefined|Infinity/);
      expect(node.attrs.role).toBe("img");
    }
  });

  test("historical speakers stay neutral and dimensions cannot break the layout", () => {
    const [history, oversized, invalid] = render(
      { id: "ada", name: "Ada", still: true, expression: "concerned" },
      { id: "ada", name: "Ada", size: 10_000 },
      { id: "ada", name: "Ada", size: NaN },
    );
    expect(history!.attrs["data-expression"]).toBe("idle");
    expect(history!.attrs["data-still"]).toBe("true");
    expect(history!.attrs["aria-label"]).toBe("Ada's avatar");
    expect(oversized!.attrs.width).toBe("192");
    expect(invalid!.attrs.width).toBe("40");
  });

  test("dark custom armour keeps eyes legible", () => {
    const [node] = render({ id: "ada", name: "Ada", profile: { ...defaultAvatar("ada"), color: "#080808" } });
    const eyes = walk(node!).find((part) => part.attrs.class === "worker-avatar-eyes")!;
    expect(eyes.attrs.fill).toBe("#fff9ed");
  });

  test("motion phase follows immutable identity across renames and appearance changes", () => {
    const [first, renamed, restyled, ...others] = render(
      { id: "ada", name: "Ada" },
      { id: "ada", name: "A new name", expression: "working" },
      { id: "ada", name: "Ada", profile: { ...defaultAvatar("ada"), temperament: "lively" } },
      ...Array.from({ length: 16 }, (_, i) => ({ id: `worker-${i}`, name: "Same display name" })),
    );
    expect(first!.attrs["data-phase"]).toMatch(/^[0-7]$/);
    expect(renamed!.attrs["data-phase"]).toBe(first!.attrs["data-phase"]);
    expect(restyled!.attrs["data-phase"]).toBe(first!.attrs["data-phase"]);
    expect(new Set(others.map((node) => node.attrs["data-phase"])).size).toBeGreaterThan(1);
  });
});
