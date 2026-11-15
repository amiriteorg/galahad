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

  test("a double tap never zooms the page (pinching still does), and holding a tab or a button brings up no link preview", () => {
    const declares = (selector: string, declaration: RegExp) => all.some((rule) => rule.media.length === 0 && rule.selectors.includes(selector) && declaration.test(rule.body));
    expect(declares("html", /touch-action:\s*manipulation/)).toBe(true);
    for (const control of [".tab", ".btn", ".sidebar a"]) expect([control, declares(control, /-webkit-touch-callout:\s*none/)]).toEqual([control, true]);
  });

  test("a text field that drops the browser's focus ring shows focus another way", () => {
    const unringed = rules.filter((r) => /outline:\s*none/.test(r.body)).flatMap((r) => r.selectors.filter((s) => /(^| )(input|textarea)$/.test(s)));
    const focusStyled = (field: string) => {
      const container = field.replace(/ (input|textarea)$/, "");
      return rules.some((r) => r.selectors.some((s) => s.startsWith(`${field}:focus`) || s === `${container}:focus-within`));
    };
    expect(unringed.filter((field) => !focusStyled(field))).toEqual([]);
  });
});
