import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/* The app's stylesheet, as rules: a selector list and its declarations. */
const css = readFileSync(join(import.meta.dir, "index.html"), "utf8").match(/<style>([^]*?)<\/style>/)![1]!;
const rules = [...css.replace(/\/\*[^]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selectors, body]) => ({
  selectors: selectors!.split(",").map((s) => s.trim().replace(/\s+/g, " ")),
  body: body!,
}));

/* The same rules with the @media conditions they sit in, for what a given screen sees. */
interface Placed { selectors: string[]; body: string; media: string[] }
function placed(text: string, media: string[] = []): Placed[] {
  const out: Placed[] = [];
  let at = 0;
  while (at < text.length) {
    const open = text.indexOf("{", at);
    if (open < 0) break;
    const prelude = text.slice(at, open).trim();
    let depth = 1, end = open + 1;
    for (; depth > 0 && end < text.length; end++) depth += text[end] === "{" ? 1 : text[end] === "}" ? -1 : 0;
    const inside = text.slice(open + 1, end - 1);
    if (prelude.startsWith("@media")) out.push(...placed(inside, [...media, prelude.slice(6).trim()]));
    else if (!prelude.startsWith("@")) out.push({ selectors: prelude.split(",").map((s) => s.trim().replace(/\s+/g, " ")), body: inside, media });
    at = end;
  }
  return out;
}
const all = placed(css.replace(/\/\*[^]*?\*\//g, ""));

interface Screen { width: number; touch: boolean }
/** Whether a media query holds on a screen: width and pointer are known; anything else might hold, so it's taken to. */
const holds = (query: string, screen: Screen) =>
  query.split(",").some((either) =>
    either.split(/\band\b/).every((part) => {
      const [, feature, value] = part.match(/\(\s*([\w-]+)\s*:\s*([^)]+)\)/) ?? [];
      if (feature === "max-width") return screen.width <= parseFloat(value!);
      if (feature === "min-width") return screen.width >= parseFloat(value!);
      if (feature === "pointer") return value!.trim() === (screen.touch ? "coarse" : "fine");
      if (feature === "hover") return value!.trim() === (screen.touch ? "none" : "hover");
      return !/^\s*print\s*$/.test(part);
    }),
  );

/** A font size as a screen computes it, in px: the root's custom properties, calc() sums. */
function px(value: string, vars: Map<string, string>): number {
  const resolved = value.replace(/var\((--[\w-]+)\)/g, (_, name: string) => vars.get(name) ?? "NaN");
  if (resolved.includes("var(")) return px(resolved, vars);
  const sum = resolved.replace(/^calc\((.*)\)$/, "$1").replace(/px/g, "");
  if (!/^[\d.\s+-]+$/.test(sum)) return Number.NaN;
  return sum.split(/\s+(?=[+-]\s)/).reduce((total, term) => total + Number(term.replace(/\s+/g, "")), 0);
}

describe("the stylesheet", () => {
  test("on a phone or a touch screen, no field the keyboard opens for is under 16px (iOS zooms the page into one that is)", () => {
    const field = /(^|[\s>+~])(input|textarea|select)(?![\w-])(?!\[type="(range|checkbox|radio)"\])|\.(input|textarea|select)(?![\w-])/;
    for (const screen of [{ width: 390, touch: true }, { width: 1024, touch: true }, { width: 800, touch: false }] satisfies Screen[]) {
      const seen = all.filter((rule) => rule.media.every((query) => holds(query, screen)));
      const vars = new Map<string, string>();
      for (const rule of seen.filter((r) => r.selectors.includes(":root"))) {
        for (const [, name, value] of rule.body.matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)) vars.set(name!, value!.trim());
      }
      const small: string[] = [];
      for (const rule of seen) {
        const targets = rule.selectors.filter((s) => field.test(s.split(/::?(?=placeholder|-webkit|-moz|-ms)/)[0]!) && !/::|:(hover|focus|disabled)/.test(s));
        if (!targets.length) continue;
        const size = rule.body.match(/(?:^|;)\s*font-size\s*:\s*([^;]+)/)?.[1] ?? rule.body.match(/(?:^|;)\s*font\s*:\s*(?:[\d]{3}\s+)?((?:var\([^)]+\)|calc\([^;]*?\)|[\d.]+px))/)?.[1];
        if (!size || /inherit/.test(size)) continue;
        const computed = px(size.trim(), vars);
        if (!(computed >= 16)) small.push(`${targets.join(", ")}: ${size.trim()} = ${computed}px`);
      }
      expect({ screen, small }).toEqual({ screen, small: screen.touch || screen.width < 960 ? [] : small });
    }
  });

  test("a double tap never zooms the page (pinching still does), and holding a tab, a button or a card brings up no link preview and selects nothing", () => {
    const declares = (selector: string, declaration: RegExp) => all.some((rule) => rule.media.length === 0 && rule.selectors.includes(selector) && declaration.test(rule.body));
    expect(declares("html", /touch-action:\s*manipulation/)).toBe(true);
    // Safari reads only the prefixed user-select.
    for (const control of [".tab", ".btn", ".sidebar a", ".roster-row", ".selector-trigger"]) {
      expect([control, declares(control, /-webkit-touch-callout:\s*none/), declares(control, /-webkit-user-select:\s*none/)]).toEqual([control, true, true]);
    }
  });

  test("with the keyboard up, nothing keeps clear the home indicator's strip: the keyboard covers it", () => {
    // Seen in the iOS 26.1 simulator: the chat's message box stood the inset's 34 px above the keyboard.
    expect(all.some((rule) => rule.media.length === 0 && rule.selectors.includes(':root[data-keyboard="open"]') && /--safe-bottom:\s*0px/.test(rule.body))).toBe(true);
  });

  test("what a finger presses answers at once: the knights' cards and rows, the sidebar, the rail and More's rows look pressed", () => {
    const pressed = (selector: string) => all.some((rule) => rule.selectors.some((s) => s === `${selector}:active`));
    for (const control of [".roster-row", ".nav-item", ".rail-item", ".rows > a.item", ".suggestion"]) expect([control, pressed(control)]).toEqual([control, true]);
  });

  test("on a phone, the palette's field lies exactly over the search button at the top bar's end (which grows into it), and the Roundtable's head puts it in the same place", () => {
    const phone: Screen = { width: 390, touch: true };
    const seen = all.filter((rule) => rule.media.every((query) => holds(query, phone)));
    // A phone held upright: no inset at the sides; the status bar's is the same for the bar and the palette.
    const vars = new Map([["--safe-top", "0px"], ["--safe-right", "0px"], ["--safe-left", "0px"]]);
    for (const rule of seen.filter((r) => r.selectors.includes(":root") || r.selectors.includes("dialog.palette"))) {
      for (const [, name, value] of rule.body.matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)) if (!name!.startsWith("--safe-")) vars.set(name!, value!.trim());
    }
    const declared = (selector: string, property: string) =>
      seen.filter((r) => r.selectors.includes(selector)).map((r) => r.body.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`))?.[1]?.trim()).filter(Boolean).at(-1) ?? "";
    // A shorthand's parts (a calc() is one part); a length as arithmetic once its custom properties are filled in.
    const parts = (shorthand: string) => shorthand.match(/(?:[^\s(]+|\((?:[^()]|\([^()]*\))*\))+/g) ?? [];
    const length = (expression: string): number => {
      let e = expression;
      while (e.includes("var(")) e = e.replace(/var\((--[\w-]+)\)/g, (_, name: string) => vars.get(name) ?? "NaN");
      e = e.replace(/calc\(/g, "(").replace(/([\d.]+)vw/g, (_, n: string) => String((Number(n) * phone.width) / 100)).replace(/px/g, "");
      return /^[\d.\s+\-*/()]+$/.test(e) ? Number(Function(`return ${e}`)()) : Number.NaN;
    };
    const control = length("var(--control-h)");
    const button = { top: (length("var(--topbar-h)") - control) / 2, height: control, right: length(parts(declared(".topbar", "padding"))[1]!) };
    const field = { top: length(declared("dialog.palette", "margin-top")), height: length(declared("dialog.palette .palette-input", "height")), right: (phone.width - length(declared("dialog.palette", "width"))) / 2 };
    expect(field).toEqual(button);
    expect(declared('.shell[data-pane="roster"] .sidebar-head', "padding")).toBe(declared(".topbar", "padding"));
  });

  test("a text field that drops the browser's focus ring shows focus another way", () => {
    const unringed = rules.filter((r) => /outline:\s*none/.test(r.body)).flatMap((r) => r.selectors.filter((s) => /(^| )(input|textarea)$/.test(s)));
    const focusStyled = (field: string) => {
      const container = field.replace(/ (input|textarea)$/, "");
      return rules.some((r) => r.selectors.some((s) => s.startsWith(`${field}:focus`) || s === `${container}:focus-within`));
    };
    expect(unringed.filter((field) => !focusStyled(field))).toEqual([]);
  });

  test("with the keyboard up, the palette ends above it, so its last result can be reached", () => {
    // Seen in the iOS 26.1 simulator: iOS keeps the page full height under its keyboard, and the palette's lower part,
    // its last results with it, stood behind the keyboard. The palette measures the room above it (palette.ts).
    for (const screen of [{ width: 390, touch: true }, { width: 1024, touch: true }] satisfies Screen[]) {
      const heights = all.filter((r) => r.media.every((q) => holds(q, screen)) && r.selectors.includes("dialog.palette")).map((r) => r.body.match(/(?:^|;)\s*max-height\s*:\s*([^;]+)/)?.[1]?.trim()).filter(Boolean);
      expect([screen, heights.at(-1)?.includes("var(--room")]).toEqual([screen, true]);
    }
  });

  test("the palette's field keeps its height however long the list under it", () => {
    // The palette is a column with a height cap, and what may shrink in one does: with every command listed, it squeezed
    // the field from 54 px to 27 px, the text against its top and the focus line under it (seen in Chrome, 15 Nov).
    const keeps = rules.some((r) => r.selectors.includes(".palette-input") && /(?:^|;)\s*(?:flex\s*:\s*none|flex-shrink\s*:\s*0)\s*(?:;|$)/.test(r.body));
    expect(keeps).toBe(true);
  });
});
