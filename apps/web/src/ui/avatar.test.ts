import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AVATAR_EXPRESSIONS, AVATAR_FORMS, defaultAvatar } from "@galahad/core/avatar";
import { avatarSheet } from "../../design/avatars.ts";
import { AVATAR_STYLES, workerAvatar, type WorkerAvatarOptions } from "./avatar.ts";

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
/** The face itself: the one stroked path that is the eyes and the mouth. */
const features = (node: SvgNode): SvgNode => walk(node).find((part) => part.tag === "path" && part.attrs.stroke)!;
const head = (node: SvgNode): SvgNode => node.children[0]!;

describe("knights' avatars at the SVG boundary", () => {
  test("malformed snapshot profiles cannot introduce markup, event attributes or external paint", () => {
    const name = '<image href="https://invalid.example/pixel" onload="alert(1)">';
    const profile = { ...defaultAvatar("ada"), color: "url(https://invalid.example/paint)", accent: '#fff" onload="alert(1)', form: "foreignObject", onload: "alert(1)" };
    for (const style of AVATAR_STYLES) {
      const [node] = render({ id: "ada", name, profile, style, expression: 'idle" onload="alert(1)' as never });
      expect(node!.attrs["aria-label"]).toBe(`${name} · idle`);
      expect(node!.attrs["data-expression"]).toBe("idle");
      expect(head(node!).attrs.fill).toBe(defaultAvatar("ada").color);
      for (const part of walk(node!)) {
        expect(["svg", "path", "text", "#text"]).toContain(part.tag);
        for (const [key, value] of Object.entries(part.attrs)) {
          expect(key).not.toMatch(/^(on|href|style)/i);
          if (key !== "aria-label") expect(value).not.toContain("invalid.example");
          if (key === "fill" || key === "stroke") expect(value).toMatch(/^(none|currentColor|#[0-9a-f]{6})$/i);
        }
      }
    }
  });

  test("flat paint: nothing in an avatar points at another when many knights share a page", () => {
    const nodes = render(...AVATAR_STYLES.flatMap((style) => Array.from({ length: 32 }, (_, i) => ({ id: `worker-${i}`, name: `Worker ${i}`, style }))));
    for (const part of nodes.flatMap(walk)) {
      expect(part.attrs.id).toBeUndefined();
      expect(Object.values(part.attrs).some((value) => value.includes("url("))).toBe(false);
    }
  });

  test("every style and expression is a handful of elements, at any size asked for", () => {
    const options = AVATAR_STYLES.flatMap((style) => AVATAR_FORMS.flatMap((form) => AVATAR_EXPRESSIONS.map((expression) => ({ id: "ada", name: "Ada Lovelace", profile: { ...defaultAvatar("ada"), form }, expression, style, size: 28 }))));
    for (const [n, node] of render(...options).entries()) {
      expect(node.attrs.width).toBe("28");
      expect(node.attrs.height).toBe("28");
      expect(node.attrs.viewBox).toBe("0 0 24 24");
      // The plain face is a head and one line drawing; no style needs more than the letters besides.
      expect(walk(node).length).toBe(options[n]!.style === "initials" ? 5 : 3);
      expect(JSON.stringify(node)).not.toMatch(/NaN|undefined|Infinity/);
      expect(node.attrs.role).toBe("img");
    }
  });

  test("the plain round face is the default, and each expression draws its own", () => {
    const faces = render(...AVATAR_EXPRESSIONS.map((expression) => ({ id: "ada", name: "Ada", expression })));
    const explicit = render(...AVATAR_EXPRESSIONS.map((expression) => ({ id: "ada", name: "Ada", expression, style: "face" as const })));
    expect(JSON.stringify(faces)).toBe(JSON.stringify(explicit));
    // Seven expressions, seven drawings: none can be mistaken for another by its lines.
    expect(new Set(faces.map((node) => features(node).attrs.d)).size).toBe(AVATAR_EXPRESSIONS.length);
    for (const [n, node] of faces.entries()) {
      expect(node.attrs["aria-label"]).toBe(`Ada · ${AVATAR_EXPRESSIONS[n]}`);
      expect(node.attrs["data-expression"]).toBe(AVATAR_EXPRESSIONS[n]!);
      // One flat colour, and lines thick enough to be two pixels of a 24-pixel avatar.
      expect(head(node).attrs.fill).toBe(defaultAvatar("ada").color);
      expect(Number(features(node).attrs["stroke-width"])).toBeGreaterThanOrEqual(2);
      expect(features(node).attrs.fill).toBe("none");
      // Every head in this style is the same round one, whatever the profile's form.
      expect(head(node).attrs.d).toBe(head(faces[0]!).attrs.d);
    }
    // A knight that is paused is drawn fainter as well, so it is told from one at work at a glance.
    expect(faces[AVATAR_EXPRESSIONS.indexOf("resting")]!.attrs.opacity).toBeDefined();
    expect(faces[AVATAR_EXPRESSIONS.indexOf("working")]!.attrs.opacity).toBeUndefined();
  });

  test("the other styles: letters from the name as text, and a shape that follows the profile's form", () => {
    const hostile = "<b>Ada</b> Lovelace";
    const [initials, single] = render({ id: "ada", name: hostile, style: "initials" }, { id: "lin", name: "Lin", style: "initials" });
    expect(walk(initials!).filter((part) => part.tag === "#text").map((part) => part.text)).toEqual(["<L"]);
    expect(walk(single!).filter((part) => part.tag === "#text").map((part) => part.text)).toEqual(["L"]);
    const glyphs = render(...AVATAR_FORMS.map((form) => ({ id: "ada", name: "Ada", profile: { ...defaultAvatar("ada"), form }, style: "glyph" as const })));
    expect(new Set(glyphs.map((node) => head(node).attrs.d)).size).toBe(AVATAR_FORMS.length);
  });

  test("historical speakers stay neutral and dimensions cannot break the layout", () => {
    const [history, oversized, invalid, small, idle] = render(
      { id: "ada", name: "Ada", still: true, expression: "concerned" },
      { id: "ada", name: "Ada", size: 10_000 },
      { id: "ada", name: "Ada", size: NaN },
      { id: "ada", name: "Ada", size: 3 },
      { id: "ada", name: "Ada" },
    );
    expect(history!.attrs["data-expression"]).toBe("idle");
    expect(history!.attrs["data-still"]).toBe("true");
    expect(history!.attrs["aria-label"]).toBe("Ada's avatar");
    expect(features(history!).attrs.d).toBe(features(idle!).attrs.d);
    expect(oversized!.attrs.width).toBe("192");
    expect(invalid!.attrs.width).toBe("40");
    expect(small!.attrs.width).toBe("24");
  });

  test("a dark colour keeps its face legible", () => {
    const [dark, light] = render({ id: "ada", name: "Ada", profile: { ...defaultAvatar("ada"), color: "#080808" } }, { id: "ada", name: "Ada" });
    expect(head(dark!).attrs.fill).toBe("#080808");
    expect(features(dark!).attrs.stroke).toBe("#fff9ed");
    expect(features(light!).attrs.stroke).toBe("#18232b");
  });

  test("a knight's look follows its handle, never its name or what it is doing", () => {
    const [first, renamed, ...others] = render(
      { id: "ada", name: "Ada" },
      { id: "ada", name: "A new name", expression: "working" },
      ...Array.from({ length: 16 }, (_, i) => ({ id: `worker-${i}`, name: "Same display name" })),
    );
    expect(head(renamed!).attrs).toEqual(head(first!).attrs);
    expect(new Set(others.map((node) => head(node).attrs.fill)).size).toBeGreaterThan(1);
  });

  test("Galahad himself is the same face in ink, told apart by one small mark", () => {
    for (const style of AVATAR_STYLES) {
      const [galahad, knight] = render({ id: "galahad", name: "Galahad", style, still: true }, { id: "ada", name: "Ada", style, still: true });
      expect(galahad!.attrs["data-galahad"]).toBe("true");
      expect(knight!.attrs["data-galahad"]).toBeUndefined();
      expect(galahad!.attrs["aria-label"]).toBe("Galahad's avatar");
      // Ink is the page's own, so it follows the theme: no colour of his is written into the drawing.
      for (const part of walk(galahad!)) for (const key of ["fill", "stroke"]) if (part.attrs[key]) expect(part.attrs[key]).toMatch(/^(none|currentColor)$/);
      expect(features(galahad!).attrs.d).toBe(features(knight!).attrs.d);
      expect(walk(galahad!).length).toBe(walk(knight!).length + 1);
    }
  });
});

test("the design sheet in apps/web/design is the one these styles draw", () => {
  // `bun apps/web/design/avatars.ts` writes it again after a change to the drawings.
  expect(readFileSync(join(import.meta.dir, "../../design/avatars.html"), "utf8")).toBe(avatarSheet());
});
