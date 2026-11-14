#!/usr/bin/env bun
/*
 * Draws apps/web/design/avatars.html: the knights (src/ui/avatar.ts), every helmet, eyes and headwear, the presets,
 * every state moving as the app moves it, at 24, 40 and 96 px, on a dark page and a light one, and Galahad in beast
 * mode. One file with nothing to fetch. It is not part of the app: the node serves only what assets.ts names.
 *
 *   bun apps/web/design/avatars.ts     writes it again; a test fails when the committed file has drifted
 *
 * The drawings and their motion are the app's own function's and stylesheet's, so the sheet can't show something
 * the app wouldn't.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { AVATAR_ACCESSORIES, AVATAR_EXPRESSIONS, AVATAR_EYES, AVATAR_FORMS, AVATAR_PALETTES, defaultAvatar, type AvatarExpression, type AvatarProfile } from "@galahad/core/avatar";
import { KNIGHT_CSS, workerAvatar, type WorkerAvatarOptions } from "../src/ui/avatar.ts";

interface Drawn {
  tag: string;
  attrs: Record<string, string>;
  children: (Drawn | string)[];
}
const escape = (text: string): string => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const markup = (node: Drawn | string): string =>
  typeof node === "string" ? escape(node) : `<${node.tag}${Object.entries(node.attrs).map(([key, value]) => ` ${key}="${escape(value)}"`).join("")}>${node.children.map(markup).join("")}</${node.tag}>`;

/** An avatar as markup: the app's function draws it into a stand-in for the page, which is then written out. */
function draw(options: WorkerAvatarOptions): string {
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  const standIn = {
    createElementNS: (_namespace: string, tag: string): Drawn & { setAttribute(key: string, value: string): void; appendChild(child: Drawn | string): void } => ({
      tag,
      attrs: {},
      children: [],
      setAttribute(key, value) { this.attrs[key] = value; },
      appendChild(child) { this.children.push(child); },
    }),
    createTextNode: (text: string) => text,
  };
  Object.defineProperty(globalThis, "document", { configurable: true, value: standIn });
  try {
    return markup(workerAvatar(options) as unknown as Drawn);
  } finally {
    if (original) Object.defineProperty(globalThis, "document", original);
    else Reflect.deleteProperty(globalThis, "document");
  }
}

/** The rule is avatarExpression's, in packages/core/src/avatar.ts (the roster adds asking): the first of these that holds. */
const MEANS: Record<AvatarExpression, string> = {
  thinking: "it is planning (its task's latest line starts “Plan ·” or “Thinking ·”), or writing you an answer: eyes up, a chip of three dots",
  working: "a command of its task is running (“Running ·”), or a step the others don't name: at the keys, its status light blinking",
  reading: "it is reading what the command printed (“Exit N ·”): behind a page, its eyes along the lines",
  browsing: "it is using its desktop (“Running · desktop …”): at the screen, its eyes on the pointer",
  checking: "its gates are running, or its work is under review (“Gate i/n ·”, “Review ·”): a lens over it, its eyes narrowed",
  asking: "it asks your leave for something (an approval waiting in the Inbox): a hand up, wide eyes, the one chip in oxblood",
  resting: "it is paused: shut eyes, dimmed",
  waiting: "it has work queued: an hourglass chip, its eyes up",
  concerned: "something of its failed or was interrupted in the last 30 seconds: worried eyes",
  pleased: "a task of its passed its checks in the last 30 seconds: happy eyes, a hop",
  idle: "none of these: it blinks, and a curious or lively one glances about or hops",
};
const ORDER: AvatarExpression[] = ["thinking", "working", "reading", "browsing", "checking", "asking", "resting", "waiting", "concerned", "pleased", "idle"];
const SIZES = [24, 40, 96];
const title = (value: string) => value[0]!.toUpperCase() + value.slice(1);

export function avatarSheet(): string {
  if (!AVATAR_EXPRESSIONS.every((expression) => ORDER.includes(expression))) throw new Error("a state is missing from the sheet");
  const base = defaultAvatar("sheet");
  const looks = AVATAR_FORMS.flatMap((form, f) => AVATAR_EYES.flatMap((eyes, e) => AVATAR_ACCESSORIES.map((accessory, a): [string, AvatarProfile] => {
    const palette = AVATAR_PALETTES[(f * 12 + e * 4 + a) % AVATAR_PALETTES.length]!;
    return [`${title(form)}, ${eyes} eyes${accessory === "none" ? "" : `, ${accessory}`}`, { ...base, form, eyes, accessory, color: palette.color, accent: palette.accent }];
  })));
  const presets = AVATAR_PALETTES.map((palette, i) => `<figure>${draw({ id: `sheet-${i}`, name: palette.name, profile: { ...base, form: AVATAR_FORMS[i % 3]!, color: palette.color, accent: palette.accent }, size: 64, still: true })}<figcaption>${palette.name}</figcaption></figure>`).join("");
  const page = (theme: "dark" | "light") => `
        <div class="panel ${theme}">
          <table>
            <tr><th></th>${SIZES.map((size) => `<th>${size} px</th>`).join("")}</tr>${ORDER.map((expression) => `
            <tr><th>${expression}</th>${SIZES.map((size) => `<td>${draw({ id: "ada", name: "Ada", expression, size })}</td>`).join("")}</tr>`).join("")}
            <tr><th>Galahad</th>${SIZES.map((size) => `<td>${draw({ id: "galahad", name: "Galahad", size, still: true })}</td>`).join("")}</tr>
          </table>
        </div>`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>The knights</title>
    <style>
      body { margin: 0; padding: 24px; background: #0a0a0b; color: #ece6da; font: 14px/1.5 -apple-system, system-ui, sans-serif; }
      main { max-width: 1120px; margin: 0 auto; }
      h1 { font-size: 24px; margin: 0 0 8px; }
      h2 { font-size: 18px; margin: 36px 0 8px; }
      p, dl { max-width: 76ch; margin: 0 0 12px; color: #a39e94; }
      dl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 16px; }
      dt { color: #ece6da; font-weight: 600; }
      dd { margin: 0; }
      code { font-size: 0.92em; }
      .looks { display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 14px; }
      figure { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 6px; }
      figcaption { font-size: 12px; text-align: center; color: #a39e94; }
      .galahad { display: flex; flex-wrap: wrap; gap: 14px; }
      .panels { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
      .panel { padding: 16px; border-radius: 12px; } .panel.dark { background: #111113; } .panel.light { background: #f3efe6; color: #16161a; }
      table { border-collapse: collapse; }
      th { padding: 6px 16px 6px 0; text-align: left; font-size: 12px; font-weight: 500; opacity: .7; }
      td { padding: 6px 16px 6px 0; vertical-align: middle; }
      ${KNIGHT_CSS.trim().split("\n").join("\n      ")}
    </style>
  </head>
  <body>
    <main>
      <h1>The knights</h1>
      <p>Each knight is a small knight in lit dots on a dark panel, the same grammar as Galahad's mark: an angular helmet with a visor of dark glass, eyes that glow in its own colour, a status light, cream armour and one accent; from <code>apps/web/src/ui/avatar.ts</code>. Its helmet, eyes, headwear, colour and how lively it is at rest are its own (Edit knight, or <code>galahad roundtable avatar</code>). Galahad wears a Templar's helm, its brow band and nasal strip the oxblood cross, on navy; in beast mode he is the Black Knight. Every avatar is named for a screen reader: "Ada · working", or "Ada's avatar" beside something it said earlier, where it stays still.</p>
      <h2>Every helmet, eyes and headwear</h2>
      <div class="looks">${looks.map(([caption, profile], i) => `<figure>${draw({ id: `look-${i}`, name: caption, profile, size: 64, still: true })}<figcaption>${escape(caption)}</figcaption></figure>`).join("")}</div>
      <h2>The eight presets</h2>
      <div class="looks">${presets}</div>
      <h2>What a knight is doing, it acts out</h2>
      <p>A state is never a mood. It is what the node says of the knight's work, by this rule, the first that holds. Only the mark that starts a task's latest line is read, never the words after it. Nothing moves when the device asks for reduced motion; what it holds still says what it is doing.</p>
      <dl>${ORDER.map((expression) => `<dt>${expression}</dt><dd>${escape(MEANS[expression])}</dd>`).join("")}</dl>
      <div class="galahad">${ORDER.map((expression) => `<figure>${draw({ id: "galahad", name: "Galahad", expression, size: 72 })}<figcaption>${expression}</figcaption></figure>`).join("")}</div>
      <h2>Galahad in beast mode: the Black Knight</h2>
      <div class="galahad">${ORDER.map((expression) => `<figure>${draw({ id: "galahad", name: "Galahad", expression, size: 72, beast: true })}<figcaption>${expression}</figcaption></figure>`).join("")}</div>
      <div class="panels" style="margin-top:16px">${page("dark")}${page("light")}
      </div>
    </main>
  </body>
</html>
`;
}

if (import.meta.main) {
  const file = join(import.meta.dir, "avatars.html");
  writeFileSync(file, avatarSheet());
  console.log(`wrote ${file}`);
}
