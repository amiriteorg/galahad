import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AVATAR_ACCESSORIES, AVATAR_EXPRESSIONS, AVATAR_EYES, AVATAR_FORMS, defaultAvatar } from "@galahad/core/avatar";
import { avatarSheet } from "../../design/avatars.ts";
import { outline, workerAvatar, type WorkerAvatarOptions } from "./avatar.ts";

/** Captures the renderer's real createElementNS calls, without an HTML parser or browser dependency. */
class SvgNode {
  readonly attrs: Record<string, string> = {};
  readonly children: SvgNode[] = [];
  constructor(readonly tag: string, readonly text = "") {}
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
    createTextNode: (text: string) => new SvgNode("#text", text),
  } });
  try { return options.map((option) => workerAvatar(option) as unknown as SvgNode); }
  finally { if (original) Object.defineProperty(globalThis, "document", original); else Reflect.deleteProperty(globalThis, "document"); }
}
const walk = (node: SvgNode): SvgNode[] => [node, ...node.children.flatMap(walk)];
const part = (node: SvgNode, name: string) => walk(node).find((child) => child.attrs.class?.split(" ").includes(name));
const parts = (node: SvgNode, name: string) => walk(node).filter((child) => child.attrs.class?.split(" ").includes(name));
/** What an avatar draws, without how it is named, what it is doing, or its moment in the blink. */
const picture = (node: SvgNode) => JSON.stringify(node.children);
const HEX = /^#[0-9a-f]{6}$/i;

describe("knights at the SVG boundary", () => {
  test("malformed snapshot profiles cannot introduce markup, event attributes or external paint", () => {
    const name = '<image href="https://invalid.example/pixel" onload="alert(1)">';
    const profile = { ...defaultAvatar("ada"), color: "url(https://invalid.example/paint)", accent: '#fff" onload="alert(1)', form: "foreignObject", onload: "alert(1)" };
    const [node] = render({ id: "ada", name, profile, expression: 'idle" onload="alert(1)' as never });
    expect(node!.attrs["aria-label"]).toBe(`${name} · idle`);
    expect(node!.attrs["data-expression"]).toBe("idle");
    // The whole profile was refused, so the knight wears its default.
    expect(part(node!, "kn-shape")!.attrs.fill).toBe(defaultAvatar("ada").color);
    for (const drawn of render(...AVATAR_EXPRESSIONS.map((expression) => ({ id: "ada", name, profile, expression })))) {
      for (const child of walk(drawn)) {
        expect(["svg", "rect", "path", "g", "circle"]).toContain(child.tag);
        for (const [key, value] of Object.entries(child.attrs)) {
          expect(key).not.toMatch(/^(on|href|style)/i);
          if (key !== "aria-label") expect(value).not.toContain("invalid.example");
          if (key === "fill") expect(value === "none" || HEX.test(value)).toBe(true);
          if (key === "stroke") expect(value).toMatch(HEX);
        }
      }
    }
  });

  test("nothing in an avatar points at another, so any number can share a page", () => {
    const nodes = render(...Array.from({ length: 48 }, (_, i) => ({ id: `knight-${i}`, name: `Knight ${i}`, expression: AVATAR_EXPRESSIONS[i % AVATAR_EXPRESSIONS.length] })));
    for (const child of nodes.flatMap(walk)) {
      expect(child.attrs.id).toBeUndefined();
      expect(Object.values(child.attrs).some((value) => value.includes("url("))).toBe(false);
    }
  });

  test("every body, eyes and headwear is its own picture, in a handful of elements, at any size asked for", () => {
    const looks = AVATAR_FORMS.flatMap((form) => AVATAR_EYES.flatMap((eyes) => AVATAR_ACCESSORIES.map((accessory) => ({ ...defaultAvatar("ada"), form, eyes, accessory }))));
    const drawn = render(...looks.map((profile) => ({ id: "ada", name: "Ada", profile, size: 28 })));
    expect(new Set(drawn.map(picture)).size).toBe(looks.length);
    for (const node of drawn) {
      expect(node.attrs.width).toBe("28");
      expect(node.attrs.height).toBe("28");
      expect(node.attrs.role).toBe("img");
      expect(JSON.stringify(node)).not.toMatch(/NaN|undefined|Infinity/);
    }
  });

  test("each state is its own picture, named for the page's motion and for a screen reader", () => {
    for (const id of ["ada", "galahad"]) {
      const states = render(...AVATAR_EXPRESSIONS.map((expression) => ({ id, name: "Ada", expression })));
      expect(new Set(states.map(picture)).size).toBe(AVATAR_EXPRESSIONS.length);
      for (const [i, node] of states.entries()) {
        expect(node.attrs["aria-label"]).toBe(`Ada · ${AVATAR_EXPRESSIONS[i]}`);
        expect(node.attrs["data-expression"]).toBe(AVATAR_EXPRESSIONS[i]!);
        // A tile, a body, its eyes, and one thing it holds: never a dot an element.
        expect(walk(node).length).toBeLessThanOrEqual(24);
        expect(JSON.stringify(node)).not.toMatch(/NaN|undefined|Infinity/);
      }
    }
  });

  test("what a knight is doing shows in what it holds, so it reads without motion too", () => {
    const at = Object.fromEntries(AVATAR_EXPRESSIONS.map((expression) => [expression, render({ id: "ada", name: "Ada", expression })[0]!]));
    const holds = (expression: string) => parts(at[expression]!, "kn-prop")[0]?.children.length ?? 0;
    expect(holds("idle")).toBe(0);
    // At the keys with both hands on them, and holding the page by its edges: hands in front of what they hold.
    expect(holds("working")).toBe(2);
    const keys = part(at.working!, "kn-prop")!.children[0]!;
    expect(parts(at.working!, "kn-hand").map((hand) => Number(hand.attrs.cy))).toEqual([Number(keys.attrs.y) + 1, Number(keys.attrs.y) + 1]);
    const page = part(at.reading!, "kn-prop")!.children[0]!;
    expect(parts(at.reading!, "kn-hand").map((hand) => Number(hand.attrs.cx))).toEqual([Number(page.attrs.x), Number(page.attrs.x) + Number(page.attrs.width)]);
    for (const expression of ["working", "reading"]) {
      const figure = part(at[expression]!, "kn-figure")!.children.map((child) => child.attrs.class!.split(" ")[0]);
      expect(figure.indexOf("kn-prop")).toBeLessThan(figure.indexOf("kn-hand"));
    }
    for (const expression of ["thinking", "reading", "browsing", "checking", "waiting", "asking", "pleased", "concerned", "resting"]) expect(holds(expression), expression).toBeGreaterThan(0);
    expect(part(at.browsing!, "kn-pointer")).toBeDefined();
    expect(part(at.checking!, "kn-lens")).toBeDefined();
    expect(part(at.waiting!, "kn-glass")).toBeDefined();
    expect(parts(at.thinking!, "kn-bubble")).toHaveLength(3);
    // Needing you is the one state in oxblood, and its hand is up.
    expect(part(at.asking!, "kn-call")!.children[0]!.attrs.fill).toBe("#b0463f");
    expect(part(at.asking!, "kn-wave")).toBeDefined();
    expect(walk(at.idle!).some((child) => child.attrs.fill === "#b0463f")).toBe(false);
    expect(part(at.concerned!, "kn-brow")).toBeDefined();
    expect(part(at.pleased!, "kn-eye-line")).toBeDefined();
    expect(part(at.resting!, "kn-eye-line")).toBeDefined();
    expect(parts(at.resting!, "kn-eye")).toHaveLength(0);
  });

  test("historical speakers stay still and neutral, and sizes cannot break the layout", () => {
    const [history, oversized, invalid, small] = render(
      { id: "ada", name: "Ada", still: true, expression: "concerned" },
      { id: "ada", name: "Ada", size: 10_000 },
      { id: "ada", name: "Ada", size: NaN },
      { id: "ada", name: "Ada", size: 3 },
    );
    expect(history!.attrs["data-expression"]).toBe("idle");
    expect(history!.attrs["data-still"]).toBe("true");
    expect(history!.attrs["aria-label"]).toBe("Ada's avatar");
    expect(picture(history!)).toBe(picture(render({ id: "ada", name: "Ada" })[0]!));
    expect(oversized!.attrs.width).toBe("192");
    expect(invalid!.attrs.width).toBe("40");
    expect(small!.attrs.width).toBe("24");
  });

  test("a knight's look follows its handle, never its name or what it is doing", () => {
    const [first, renamed, ...others] = render(
      { id: "ada", name: "Ada" },
      { id: "ada", name: "A new name" },
      ...Array.from({ length: 16 }, (_, i) => ({ id: `knight-${i}`, name: "Same display name" })),
    );
    expect(picture(renamed!)).toBe(picture(first!));
    expect(renamed!.attrs.class).toBe(first!.attrs.class);
    expect(new Set(others.map(picture)).size).toBeGreaterThan(8);
  });

  test("Galahad is off-white on navy with an oxblood plume: a knight dressed like him never takes his tile", () => {
    const [galahad, knight] = render({ id: "galahad", name: "Galahad", still: true }, { id: "ada", name: "Ada", profile: { ...defaultAvatar("ada"), form: "armored", eyes: "oval", accessory: "plume", color: "#ece6da", accent: "#a8373a" }, still: true });
    expect(galahad!.attrs["data-galahad"]).toBe("true");
    expect(knight!.attrs["data-galahad"]).toBeUndefined();
    expect(galahad!.attrs["aria-label"]).toBe("Galahad's avatar");
    expect(part(galahad!, "kn-tile")!.attrs.fill).toBe("#1c2a4a");
    expect(part(galahad!, "kn-shape")!.attrs.fill).toBe("#ece6da");
    expect(part(galahad!, "kn-trim")!.attrs.fill).toBe("#a8373a");
    expect(part(knight!, "kn-tile")!.attrs.fill).not.toBe("#1c2a4a");
    expect(part(knight!, "kn-shape")!.attrs.d).toBe(part(galahad!, "kn-shape")!.attrs.d);
  });

  test("a colour too dark to stand on its own deep tile gets a light one, and its eyes still show", () => {
    for (const color of ["#000000", "#16161a", "#1c2a4a", "#3a2020"]) {
      const [node] = render({ id: "ada", name: "Ada", profile: { ...defaultAvatar("ada"), color } });
      const tile = part(node!, "kn-tile")!.attrs.fill!;
      const eye = part(node!, "kn-eye")!.attrs.fill!;
      expect(tile).not.toBe(color);
      expect(eye).toBe(tile);
      const light = (hex: string) => [1, 3, 5].reduce((sum, at) => sum + parseInt(hex.slice(at, at + 2), 16), 0);
      expect(Math.abs(light(tile) - light(color))).toBeGreaterThan(200);
    }
  });
});

describe("the outline cells are drawn with", () => {
  test("a lone cell is a dot, a row a rounded bar; inner corners are softened, not cut", () => {
    const arcs = (d: string) => [...d.matchAll(/A(\d+(?:\.\d+)?) /g)].map((match) => Number(match[1]));
    expect(arcs(outline([[0, 0]]))).toEqual([5, 5, 5, 5]);
    expect(arcs(outline([[0, 0], [1, 0], [2, 0]]))).toEqual([5, 5, 5, 5]);
    // An L: five outer corners and one inner.
    expect(arcs(outline([[0, 0], [0, 1], [1, 1]])).sort()).toEqual([2.5, 5, 5, 5, 5, 5]);
  });

  test("cells that meet only at a corner keep outlines of their own, and a ring keeps its hole", () => {
    expect(outline([[0, 0], [1, 1]]).match(/M/g)).toHaveLength(2);
    const ring = [[0, 0], [1, 0], [2, 0], [0, 1], [2, 1], [0, 2], [1, 2], [2, 2]] as const;
    expect(outline(ring).match(/M/g)).toHaveLength(2);
  });
});

test("the design sheet in apps/web/design is the one these knights draw", () => {
  // `bun apps/web/design/avatars.ts` writes it again after a change to the drawings.
  expect(readFileSync(join(import.meta.dir, "../../design/avatars.html"), "utf8")).toBe(avatarSheet());
});
