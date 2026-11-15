import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AVATAR_EXPRESSIONS, AVATAR_LOOKS, defaultAvatar, lookProfile } from "@galahad/core/avatar";
import { avatarSheet } from "../../design/avatars.ts";
import { KNIGHT_CSS, workerAvatar, type WorkerAvatarOptions } from "./avatar.ts";

/** Captures the renderer's real createElement and createElementNS calls, without an HTML parser or a browser. */
class Node_ {
  readonly attrs: Record<string, string> = {};
  readonly children: Node_[] = [];
  constructor(readonly tag: string, readonly ns: "html" | "svg", readonly text = "") {}
  setAttribute(key: string, value: string) { this.attrs[key] = value; }
  appendChild(child: Node_) { this.children.push(child); return child; }
  addEventListener() {}
}
function render(...options: WorkerAvatarOptions[]): Node_[] {
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    createElement: (tag: string) => new Node_(tag, "html"),
    createElementNS(namespace: string, tag: string) {
      expect(namespace).toBe("http://www.w3.org/2000/svg");
      return new Node_(tag, "svg");
    },
    createTextNode: (text: string) => new Node_("#text", "html", text),
  } });
  try { return options.map((option) => workerAvatar(option) as unknown as Node_); }
  finally { if (original) Object.defineProperty(globalThis, "document", original); else Reflect.deleteProperty(globalThis, "document"); }
}
const walk = (node: Node_): Node_[] => [node, ...node.children.flatMap(walk)];
const parts = (node: Node_, name: string) => walk(node).filter((child) => child.attrs.class?.split(" ").includes(name));
const img = (node: Node_) => walk(node).find((child) => child.tag === "img")!;
const HEX = /^#[0-9a-f]{6}$/i;
const KNIGHTS_DIR = join(import.meta.dir, "../knights");

describe("knights at the page's boundary", () => {
  test("every picture is one of the app's own files: nothing from a profile or a name reaches a URL, a style or a paint", () => {
    const name = '<image href="https://invalid.example/pixel" onload="alert(1)">';
    const profile = { ...defaultAvatar("ada"), color: "url(https://invalid.example/paint)", accent: '#fff" onload="alert(1)', form: "foreignObject", onload: "alert(1)" };
    const [node] = render({ id: "ada", name, profile, expression: 'idle" onload="alert(1)' as never });
    expect(node!.attrs["aria-label"]).toBe(`${name} · idle`);
    expect(node!.attrs["data-expression"]).toBe("idle");
    for (const drawn of render(...AVATAR_EXPRESSIONS.flatMap((expression) => [{ id: "ada", name, profile, expression, size: 96 }, { id: "galahad", name, expression, beast: true, size: 200 }]))) {
      expect(img(drawn).attrs.src).toMatch(/^\/knights\/[a-z-]+\.webp$/);
      for (const child of walk(drawn)) {
        expect(child.ns === "html" ? ["span", "img"] : ["svg", "g", "circle", "path"]).toContain(child.tag);
        for (const [key, value] of Object.entries(child.attrs)) {
          expect(key).not.toMatch(/^(on|href|xlink)/i);
          if (key !== "aria-label") expect(value).not.toContain("invalid.example");
          if (key === "style") expect(value).toMatch(/^--kn-size:\d+px$/);
          if (key === "srcset") expect(value).toMatch(/^\/knights\/[a-z-]+\.webp 288w, \/knights\/[a-z-]+@2x\.webp 576w$/);
          if (key === "fill") expect(value === "none" || HEX.test(value)).toBe(true);
          if (key === "stroke") expect(value).toMatch(HEX);
        }
      }
    }
  });

  test("a knight is the drawing it chose, else the one its name is, else one from its handle; Galahad is his own", () => {
    const look = (options: WorkerAvatarOptions) => render(options)[0]!.attrs["data-look"];
    expect(look({ id: "ada", name: "Ada", profile: lookProfile("bors") })).toBe("bors");
    expect(look({ id: "ada", name: "Gareth", profile: lookProfile("bors") })).toBe("bors");
    expect(look({ id: "gareth", name: "Gareth", profile: defaultAvatar("gareth") })).toBe("gareth");
    expect(look({ id: "ada", name: "Ada" })).toBe(look({ id: "ada", name: "Ada", profile: "not a profile" }));
    expect(AVATAR_LOOKS.map((each) => each.id)).toContain(look({ id: "ada", name: "Ada" }) as never);
    expect(look({ id: "galahad", name: "Kay" })).toBe("galahad");
    expect(look({ id: "galahad", name: "Galahad", beast: true })).toBe("black-knight");
    // Only Galahad becomes the Black Knight.
    expect(look({ id: "ada", name: "Ada", beast: true })).not.toBe("black-knight");
  });

  test("what a knight is doing shows in its eyes, and its asking in a red mark where the mark can be read", () => {
    for (const expression of AVATAR_EXPRESSIONS) {
      const [small, large] = render({ id: "ada", name: "Ada", expression, size: 40 }, { id: "ada", name: "Ada", expression, size: 96 });
      expect(large!.attrs["data-expression"]).toBe(expression);
      expect(large!.attrs["aria-label"]).toBe(`Ada · ${expression}`);
      // The drawn eyes are covered and drawn again: two of each, whatever the state.
      expect(parts(large!, "kn-eye")).toHaveLength(2);
      expect(parts(large!, "kn-gaze")).toHaveLength(2);
      const drawnEye = parts(large!, "kn-eye")[0]!.children[0]!;
      expect(drawnEye.tag).toBe(expression === "pleased" || expression === "resting" ? "path" : "circle");
      expect(parts(large!, "kn-ask")).toHaveLength(expression === "asking" ? 1 : 0);
      // On a row's face the row says it needs you; the face stays a face.
      expect(parts(small!, "kn-ask")).toHaveLength(0);
    }
    // Looking up while it thinks, down at its work: the same eyes, moved.
    const [thinking, working] = render({ id: "ada", name: "Ada", expression: "thinking", size: 96 }, { id: "ada", name: "Ada", expression: "working", size: 96 });
    const y = (node: Node_) => Number(parts(node, "kn-eye")[0]!.children[0]!.attrs.cy);
    expect(y(thinking!)).toBeLessThan(y(working!));
  });

  test("in beast mode Galahad's eyes are embers; nowhere else", () => {
    const [beast, plain] = render({ id: "galahad", name: "Galahad", beast: true, size: 96 }, { id: "galahad", name: "Galahad", size: 96 });
    expect(beast!.attrs["data-beast"]).toBe("true");
    expect(beast!.attrs["aria-label"]).toBe("Galahad · idle · beast mode");
    expect(parts(beast!, "kn-ember")).toHaveLength(2);
    expect(parts(plain!, "kn-ember")).toHaveLength(0);
    expect(plain!.attrs["data-beast"]).toBeUndefined();
  });

  test("historical speakers stay still and neutral, and sizes cannot break the layout", () => {
    const [still] = render({ id: "ada", name: "Ada", expression: "asking", still: true, size: 96 });
    expect(still!.attrs["data-still"]).toBe("true");
    expect(still!.attrs["data-expression"]).toBe("idle");
    expect(still!.attrs["aria-label"]).toBe("Ada's avatar");
    expect(parts(still!, "kn-ask")).toHaveLength(0);
    const sizes = render(...[-5, 0, 7, 40, 999, Number.NaN, Infinity].map((size) => ({ id: "ada", name: "Ada", size }))).map((node) => node.attrs.style);
    expect(sizes).toEqual(["--kn-size:20px", "--kn-size:20px", "--kn-size:20px", "--kn-size:40px", "--kn-size:256px", "--kn-size:40px", "--kn-size:40px"]);
  });

  test("Galahad drawn large uses his larger file, so he is sharp on a dense screen; small, and every knight, the one file", () => {
    const [big, small, beast, knight] = render({ id: "galahad", name: "Galahad", size: 200 }, { id: "galahad", name: "Galahad", size: 40 }, { id: "galahad", name: "Galahad", beast: true, size: 220 }, { id: "ada", name: "Ada", size: 200 });
    expect(img(big!).attrs.srcset).toBe("/knights/galahad.webp 288w, /knights/galahad@2x.webp 576w");
    expect(img(big!).attrs.sizes).toBe("200px");
    expect(img(small!).attrs.srcset).toBeUndefined();
    expect(img(beast!).attrs.srcset).toContain("black-knight@2x.webp");
    expect(img(knight!).attrs.srcset).toBeUndefined();
  });
});

test("every drawing the app can show is a file it has", () => {
  for (const name of [...AVATAR_LOOKS.map((look) => look.id), "galahad", "black-knight", "galahad@2x", "black-knight@2x"]) {
    const file = join(KNIGHTS_DIR, `${name}.webp`);
    expect(existsSync(file)).toBe(true);
    // RIFF....WEBP: a WebP, and small enough for a phone.
    const bytes = readFileSync(file);
    expect(bytes.subarray(0, 4).toString("latin1")).toBe("RIFF");
    expect(bytes.subarray(8, 12).toString("latin1")).toBe("WEBP");
    expect(bytes.length).toBeLessThan(name.includes("@2x") ? 64_000 : 24_000);
  }
});

test("the design sheet in apps/web/design is the one these knights draw", () => {
  // `bun apps/web/design/avatars.ts` writes it again after a change to the drawings.
  expect(readFileSync(join(import.meta.dir, "../../design/avatars.html"), "utf8")).toBe(avatarSheet());
});

test("the knights' bodies stay still: only their eyes move (and beast mode's embers glow), and the ask mark stands", () => {
  // (Every rule that sets an animation, but the ones that turn animation off.)
  const animated = [...KNIGHT_CSS.matchAll(/([^{}]+)\{[^{}]*\banimation:(?!\s*none)[^;}]+/g)].map(([, selector]) => selector!.trim());
  expect(animated.length).toBeGreaterThan(0);
  for (const selector of animated) expect([selector, /\.kn-(eye|gaze|ember)$/.test(selector)]).toEqual([selector, true]);
  // Working has eyes of its own: down at the work, moving along it.
  expect(animated.some((selector) => selector.includes('[data-expression="working"]'))).toBe(true);
});
