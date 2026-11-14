import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AVATAR_ACCESSORIES, AVATAR_EXPRESSIONS, AVATAR_EYES, AVATAR_FORMS, AVATAR_PALETTES, defaultAvatar } from "@galahad/core/avatar";
import { avatarSheet } from "../../design/avatars.ts";
import { grain, workerAvatar, type WorkerAvatarOptions } from "./avatar.ts";

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
const inks = (node: SvgNode, name: string) => parts(node, name).map((child) => child.attrs.fill);
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
    // The whole profile was refused, so the knight wears its default: its eyes glow in its default colour.
    expect(render({ id: "ada", name: "Ada" }).map(picture)).toEqual([picture(node!)]);
    for (const drawn of render(...AVATAR_EXPRESSIONS.flatMap((expression) => [{ id: "ada", name, profile, expression }, { id: "galahad", name, expression, beast: true }]))) {
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
    const nodes = render(...Array.from({ length: 48 }, (_, i) => ({ id: `knight-${i}`, name: `Knight ${i}`, expression: AVATAR_EXPRESSIONS[i % AVATAR_EXPRESSIONS.length], size: [28, 40, 56, 96, 150][i % 5] })));
    for (const child of nodes.flatMap(walk)) {
      expect(child.attrs.id).toBeUndefined();
      expect(Object.values(child.attrs).some((value) => value.includes("url("))).toBe(false);
    }
  });

  test("every helmet, eyes and headwear is its own picture, in a handful of elements, at any size asked for", () => {
    const looks = AVATAR_FORMS.flatMap((form) => AVATAR_EYES.flatMap((eyes) => AVATAR_ACCESSORIES.map((accessory) => ({ ...defaultAvatar("ada"), form, eyes, accessory }))));
    for (const size of [28, 46, 112]) {
      const drawn = render(...looks.map((profile) => ({ id: "ada", name: "Ada", profile, size })));
      expect(new Set(drawn.map(picture)).size).toBe(looks.length);
      for (const node of drawn) {
        expect(node.attrs.width).toBe(String(size));
        expect(node.attrs.role).toBe("img");
        expect(JSON.stringify(node)).not.toMatch(/NaN|undefined|Infinity/);
      }
    }
  });

  test("each state is its own picture, named for the page's motion and for a screen reader, in a handful of elements", () => {
    for (const id of ["ada", "galahad"]) {
      const states = render(...AVATAR_EXPRESSIONS.map((expression) => ({ id, name: "Ada", expression, size: 112 })));
      expect(new Set(states.map(picture)).size).toBe(AVATAR_EXPRESSIONS.length);
      for (const [i, node] of states.entries()) {
        expect(node.attrs["aria-label"]).toBe(`Ada · ${AVATAR_EXPRESSIONS[i]}`);
        expect(node.attrs["data-expression"]).toBe(AVATAR_EXPRESSIONS[i]!);
        // A panel, the dots as a path per ink, the glass, the eyes, what it holds: never a dot an element.
        expect(walk(node).length).toBeLessThanOrEqual(32);
        expect(JSON.stringify(node)).not.toMatch(/NaN|undefined|Infinity/);
      }
    }
  });

  test("what a knight is doing shows in what it holds, so it reads without motion too", () => {
    const at = Object.fromEntries(AVATAR_EXPRESSIONS.map((expression) => [expression, render({ id: "ada", name: "Ada", expression })[0]!]));
    for (const expression of ["working", "reading", "browsing"]) expect(part(at[expression]!, "kn-prop"), expression).toBeDefined();
    expect(part(at.idle!, "kn-prop")).toBeUndefined();
    expect(part(at.browsing!, "kn-pointer")).toBeDefined();
    expect(part(at.checking!, "kn-lens")).toBeDefined();
    // At the keys and the page, both hands; on its desktop, none; asking, one waves.
    expect(parts(at.working!, "kn-hand")).toHaveLength(2);
    expect(parts(at.browsing!, "kn-hand")).toHaveLength(0);
    expect(part(at.asking!, "kn-wave")).toBeDefined();
    for (const expression of ["working", "reading"]) {
      const figure = part(at[expression]!, "kn-figure")!.children.map((child) => child.attrs.class!.split(" ")[0]);
      expect(figure.indexOf("kn-prop")).toBeLessThan(figure.indexOf("kn-hand"));
    }
    // The chip says what the face can't: needing you is the one in oxblood.
    for (const expression of ["thinking", "waiting", "asking", "pleased", "concerned", "resting"]) expect(part(at[expression]!, "kn-chip"), expression).toBeDefined();
    for (const expression of ["idle", "working", "reading", "browsing", "checking"]) expect(part(at[expression]!, "kn-chip"), expression).toBeUndefined();
    expect(part(at.asking!, "kn-chip")!.children[0]!.attrs.fill).toBe("#b23c3d");
    expect(part(at.thinking!, "kn-chip")!.children[0]!.attrs.fill).not.toBe("#b23c3d");
    // Happy and shut eyes are chevrons of light, not pills.
    expect(part(at.pleased!, "kn-eye")!.tag).toBe("path");
    expect(part(at.resting!, "kn-eye")!.tag).toBe("path");
    expect(part(at.idle!, "kn-eye")!.tag).toBe("rect");
  });

  test("a small avatar is sampled coarser, so its dots stay dots; a large one is a dot-matrix panel", () => {
    expect([24, 30, 44, 64, 100, 192].map(grain)).toEqual([15, 15, 18, 22, 27, 32]);
    const count = (node: SvgNode) => parts(node, "kn-helm").reduce((sum, path) => sum + (path.attrs.d!.match(/M/g) ?? []).length, 0);
    const [small, large] = render({ id: "ada", name: "Ada", size: 28 }, { id: "ada", name: "Ada", size: 150 });
    expect(count(large!)).toBeGreaterThan(count(small!) * 3);
    // Only a large one shows its unlit dots.
    expect(inks(large!, "kn-body").length).toBeGreaterThan(inks(small!, "kn-body").length);
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

  test("every knight is cream, its colour in its light: its eyes, its accent and its panel", () => {
    for (const palette of AVATAR_PALETTES) {
      const [node] = render({ id: "ada", name: "Ada", profile: { ...defaultAvatar("ada"), color: palette.color, accent: palette.accent, accessory: "crown" } });
      expect(inks(node!, "kn-helm")).toContain("#ece6da");
      expect(inks(node!, "kn-helm")).toContain(palette.color);
      expect(part(node!, "kn-panel")!.attrs.fill).not.toBe(palette.color);
    }
    // Even a knight dressed in black stays a cream figure on its panel.
    const [dark] = render({ id: "ada", name: "Ada", profile: { ...defaultAvatar("ada"), color: "#000000" } });
    expect(inks(dark!, "kn-helm")).toContain("#ece6da");
  });

  test("Galahad is a Templar in white with an oxblood cross on navy; in beast mode, the Black Knight", () => {
    const [galahad, black, knight] = render(
      { id: "galahad", name: "Galahad", still: true },
      { id: "galahad", name: "Galahad", beast: true, expression: "working" },
      { id: "ada", name: "Ada", profile: { ...defaultAvatar("ada"), form: "armored", color: "#b23c3d" }, beast: true, still: true },
    );
    expect(galahad!.attrs["data-galahad"]).toBe("true");
    expect(galahad!.attrs["aria-label"]).toBe("Galahad's avatar");
    expect(part(galahad!, "kn-panel")!.attrs.fill).toBe("#0d1322");
    expect(inks(galahad!, "kn-helm")).toEqual(expect.arrayContaining(["#f2eee6", "#b23c3d"]));
    expect(black!.attrs["data-beast"]).toBe("true");
    expect(black!.attrs["aria-label"]).toBe("Galahad · working · beast mode");
    expect(inks(black!, "kn-helm")).toEqual(expect.arrayContaining(["#6b6b78", "#b23c3d"]));
    expect(parts(black!, "kn-eye").every((eye) => eye.attrs.fill === "#ff4a3d")).toBe(true);
    // Beast mode is his alone; a knight, even in oxblood, never takes his panel or his cross.
    expect(knight!.attrs["data-beast"]).toBeUndefined();
    expect(knight!.attrs["data-galahad"]).toBeUndefined();
    expect(part(knight!, "kn-panel")!.attrs.fill).not.toBe("#0d1322");
    expect(part(knight!, "kn-visor")!.attrs.d).not.toBe(part(galahad!, "kn-visor")!.attrs.d);
  });
});

test("the design sheet in apps/web/design is the one these knights draw", () => {
  // `bun apps/web/design/avatars.ts` writes it again after a change to the drawings.
  expect(readFileSync(join(import.meta.dir, "../../design/avatars.html"), "utf8")).toBe(avatarSheet());
});
