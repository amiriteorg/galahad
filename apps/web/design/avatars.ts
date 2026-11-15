#!/usr/bin/env bun
/*
 * Draws apps/web/design/avatars.html: the knights (src/ui/avatar.ts), the ten drawings, every state as the app shows
 * it, at 32, 56 and 112 px, on a dark page and a light one, and Galahad, in beast mode too. One file, its pictures the
 * app's own (src/knights/). It is not part of the app: the node serves only what assets.ts names.
 *
 *   bun apps/web/design/avatars.ts     writes it again; a test fails when the committed file has drifted
 *
 * The drawings and their motion are the app's own function's and stylesheet's, so the sheet can't show something
 * the app wouldn't.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { AVATAR_EXPRESSIONS, AVATAR_LOOKS, lookProfile, type AvatarExpression } from "@galahad/core/avatar";
import { KNIGHT_CSS, workerAvatar, type WorkerAvatarOptions } from "../src/ui/avatar.ts";

interface Drawn {
  tag: string;
  attrs: Record<string, string>;
  children: (Drawn | string)[];
}
const escape = (text: string): string => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const VOID = new Set(["img"]);
const markup = (node: Drawn | string): string => {
  if (typeof node === "string") return escape(node);
  const attrs = Object.entries(node.attrs).map(([key, value]) => ` ${key}="${escape(value)}"`).join("");
  return VOID.has(node.tag) ? `<${node.tag}${attrs}>` : `<${node.tag}${attrs}>${node.children.map(markup).join("")}</${node.tag}>`;
};

/** An avatar as markup: the app's function draws it into a stand-in for the page, which is then written out (its
 * pictures from this folder's neighbour, where the app keeps them). */
function draw(options: WorkerAvatarOptions): string {
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  const make = (tag: string): Drawn & { setAttribute(key: string, value: string): void; appendChild(child: Drawn | string): void; addEventListener(): void } => ({
    tag,
    attrs: {},
    children: [],
    setAttribute(key, value) { this.attrs[key] = key === "src" || key === "srcset" ? value.replaceAll("/knights/", "../src/knights/") : value; },
    appendChild(child) { this.children.push(child); },
    addEventListener() {},
  });
  const standIn = { createElement: make, createElementNS: (_namespace: string, tag: string) => make(tag), createTextNode: (text: string) => text };
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
  thinking: "it is planning (its task's latest line starts “Plan ·” or “Thinking ·”), or writing you an answer: its eyes up",
  working: "a command of its task is running (“Running ·”), or a step the others don't name: its eyes down at the work, moving along it",
  reading: "it is reading what the command printed (“Exit N ·”): its eyes along the lines",
  browsing: "it is using its desktop (“Running · desktop …”): its eyes after the pointer",
  checking: "its gates are running, or its work is under review (“Gate i/n ·”, “Review ·”): its eyes back and forth",
  asking: "it asks your leave for something (an approval waiting in the Inbox): wide eyes, and a red mark beside it",
  resting: "it is paused: shut eyes, its colour drained",
  waiting: "it has work queued: its eyes up and away",
  concerned: "something of its failed or was interrupted in the last 30 seconds: lowered eyes",
  pleased: "a task of its passed its checks in the last 30 seconds: happy eyes",
  idle: "none of these: it blinks, and a curious or lively one glances about",
};
const ORDER: AvatarExpression[] = ["thinking", "working", "reading", "browsing", "checking", "asking", "resting", "waiting", "concerned", "pleased", "idle"];
const SIZES = [32, 56, 112];

export function avatarSheet(): string {
  if (!AVATAR_EXPRESSIONS.every((expression) => ORDER.includes(expression))) throw new Error("a state is missing from the sheet");
  const looks = AVATAR_LOOKS.map((look) => `<figure>${draw({ id: `sheet-${look.id}`, name: look.name, profile: lookProfile(look.id), size: 112, still: true })}<figcaption>${escape(look.name)}</figcaption></figure>`).join("");
  const page = (theme: "dark" | "light") => `
        <div class="panel ${theme}">
          <table>
            <tr><th></th>${SIZES.map((size) => `<th>${size} px</th>`).join("")}</tr>${ORDER.map((expression) => `
            <tr><th>${expression}</th>${SIZES.map((size) => `<td>${draw({ id: "ada", name: "Percival", profile: lookProfile("percival"), expression, size })}</td>`).join("")}</tr>`).join("")}
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
      body { margin: 0; padding: 24px; background: #fafafa; color: #0a0a0b; font: 14px/1.5 -apple-system, system-ui, sans-serif; }
      main { max-width: 1120px; margin: 0 auto; }
      h1 { font-size: 24px; margin: 0 0 8px; letter-spacing: -0.02em; }
      h2 { font-size: 18px; margin: 36px 0 8px; letter-spacing: -0.01em; }
      p, dl { max-width: 76ch; margin: 0 0 12px; color: #52525a; }
      dl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 16px; }
      dt { color: #0a0a0b; font-weight: 600; }
      dd { margin: 0; }
      code { font-size: 0.92em; }
      .looks { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 14px; }
      figure { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 4px; }
      figcaption { font-size: 12px; text-align: center; color: #52525a; }
      .galahad { display: flex; flex-wrap: wrap; gap: 14px; }
      .panels { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
      .panel { padding: 16px; border-radius: 16px; } .panel.dark { background: #08080a; color: #ededef; } .panel.light { background: #ffffff; box-shadow: inset 0 0 0 1px #e6e6e8; }
      table { border-collapse: collapse; }
      th { padding: 6px 16px 6px 0; text-align: left; font-size: 12px; font-weight: 500; opacity: .7; }
      td { padding: 6px 16px 6px 0; vertical-align: middle; }
      ${KNIGHT_CSS.trim().split("\n").join("\n      ")}
    </style>
  </head>
  <body>
    <main>
      <h1>The knights</h1>
      <p>Each knight is one of the owner's ten drawings, the drawing itself cut out of its paper, with live eyes over the drawn ones; from <code>apps/web/src/ui/avatar.ts</code> and <code>apps/web/src/knights/</code>. Which one a knight is, it chooses (Edit knight, or <code>galahad roundtable avatar &lt;id&gt; --look &lt;name&gt;</code>); until it does, a knight called by a drawing's name is that drawing, and any other is one of the ten from its handle. Galahad is his own drawing, with his red cross; in beast mode he is the Black Knight. Every avatar is named for a screen reader: "Percival · working", or "Percival's avatar" beside something it said earlier, where it stays still.</p>
      <h2>The ten drawings</h2>
      <div class="looks">${looks}</div>
      <h2>What a knight is doing, it shows</h2>
      <p>A state is never a mood. It is what the node says of the knight's work, by this rule, the first that holds. Only the mark that starts a task's latest line is read, never the words after it. Nothing moves when the device asks for reduced motion.</p>
      <dl>${ORDER.map((expression) => `<dt>${expression}</dt><dd>${escape(MEANS[expression])}</dd>`).join("")}</dl>
      <div class="galahad">${ORDER.map((expression) => `<figure>${draw({ id: "galahad", name: "Galahad", expression, size: 96 })}<figcaption>${expression}</figcaption></figure>`).join("")}</div>
      <h2>Galahad in beast mode: the Black Knight</h2>
      <div class="galahad">${ORDER.map((expression) => `<figure>${draw({ id: "galahad", name: "Galahad", expression, size: 96, beast: true })}<figcaption>${expression}</figcaption></figure>`).join("")}</div>
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
