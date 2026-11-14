#!/usr/bin/env bun
/*
 * Draws apps/web/design/avatars.html: the three ways a squire can be drawn (src/ui/avatar.ts), side by
 * side at 24, 40 and 96 px, in light and in dark, in every expression, so one can be chosen by eye.
 * One file with nothing to fetch. It is not part of the app: the node serves only what assets.ts names.
 *
 *   bun apps/web/design/avatars.ts     writes it again; a test fails when the committed file has drifted
 *
 * The drawings are the app's own function's, and the colours and the avatar's few rules are read out of
 * the app's stylesheet, so the sheet can't show something the app wouldn't.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AVATAR_EXPRESSIONS, defaultAvatar, type AvatarExpression } from "@galahad/core/avatar";
import { AVATAR_STYLES, workerAvatar, type AvatarStyle, type WorkerAvatarOptions } from "../src/ui/avatar.ts";

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

const STYLES: Record<AvatarStyle, { title: string; says: string }> = {
  face: { title: "Face", says: "A round face in the squire's one flat colour: two eyes and a mouth, drawn as a single line. The plainest of the three, and the one the app draws now. Squires are told apart by colour alone, and there are eight colours unless you choose another, so two squires can look the same." },
  initials: { title: "Initials", says: "The squire's initials in its colour, with the mouth under them. The letters stand where the eyes would be, so only the mouth is left to say how the work goes." },
  glyph: { title: "Glyph", says: "The same face on one of three shapes (round, square, arched), which follows the profile's form. Shape and colour together tell more squires apart; it is a little less plain." },
};
/** The rule is avatarExpression's, in packages/core/src/avatar.ts: the first of these that holds. */
const MEANS: Record<AvatarExpression, string> = {
  working: "one of its tasks is running",
  thinking: "it is writing an answer",
  resting: "it is paused",
  waiting: "it has work queued",
  concerned: "something of its failed or was interrupted in the last 30 seconds",
  pleased: "a task of its passed its checks in the last 30 seconds",
  idle: "none of these",
};
const ORDER: AvatarExpression[] = ["working", "thinking", "resting", "waiting", "concerned", "pleased", "idle"];
const ROSTER: WorkerAvatarOptions[] = [
  { id: "galahad", name: "Galahad" },
  { id: "ada", name: "Ada" },
  { id: "lin", name: "Lin" },
  { id: "kay", name: "Kay" },
  { id: "bors", name: "Bors" },
  { id: "percival", name: "Percival" },
  { id: "gareth", name: "Gareth Vale" },
  { id: "mordred", name: "Dark colour", profile: { ...defaultAvatar("mordred"), color: "#22303a" } },
];
const SIZES = [24, 40, 96];

export function avatarSheet(): string {
  const app = readFileSync(join(import.meta.dir, "../src/index.html"), "utf8").match(/<style>([^]*?)<\/style>/)![1]!;
  const token = (name: string): string => `--${name}: ${app.match(new RegExp(`--${name}: ([^;]+);`))![1]};`;
  const tokens = ["bg", "surface", "border", "text", "text-2", "accent", "on-accent", "font-sans"].map(token).join(" ");
  const rules = app.split("\n").filter((line) => line.trim().startsWith(".worker-avatar")).map((line) => line.trim()).join("\n      ");
  if (!AVATAR_EXPRESSIONS.every((expression) => ORDER.includes(expression))) throw new Error("an expression is missing from the sheet");
  /** Expressions a style can't tell apart, said under it: found by comparing the drawings, not claimed. */
  const alike = (style: AvatarStyle): string => {
    const drawn = new Map<string, AvatarExpression[]>();
    for (const expression of ORDER) {
      const picture = draw({ id: "ada", name: "Ada", expression, style }).replace(/ (aria-label|data-expression)="[^"]*"/g, "");
      drawn.set(picture, [...(drawn.get(picture) ?? []), expression]);
    }
    const twins = [...drawn.values()].filter((group) => group.length > 1).map((group) => group.join(" and "));
    return twins.length ? `Drawn the same in this style: ${twins.join("; ")}.` : "Each expression has a drawing of its own.";
  };
  const panel = (style: AvatarStyle, theme: "light" | "dark"): string => `
        <div class="panel" style="color-scheme: ${theme}">
          <h3>${theme === "light" ? "Light" : "Dark"}</h3>
          <table>
            <tr><th></th>${SIZES.map((size) => `<th>${size} px</th>`).join("")}</tr>${ORDER.map((expression) => `
            <tr><th>${expression}</th>${SIZES.map((size) => `<td>${draw({ id: "ada", name: "Ada", expression, style, size })}</td>`).join("")}</tr>`).join("")}
          </table>
          <h4>As a speaker in a conversation, where no expression is drawn</h4>
          <div class="roster">${ROSTER.map((who) => `<figure>${draw({ ...who, style, still: true })}<figcaption>${escape(who.name)}</figcaption></figure>`).join("")}</div>
          <div class="roster small">${ROSTER.map((who) => draw({ ...who, style, still: true, size: 24 })).join("")}</div>
        </div>`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Squires' avatars: three styles</title>
    <style>
      :root { color-scheme: light dark; ${tokens} }
      body { margin: 0; padding: 24px; background: var(--bg); color: var(--text); font: 14px/1.5 var(--font-sans); }
      main { max-width: 1120px; margin: 0 auto; }
      h1 { font-size: 24px; margin: 0 0 8px; }
      h2 { font-size: 18px; margin: 40px 0 4px; }
      h3 { font-size: 13px; margin: 0 0 8px; color: var(--text-2); }
      h4 { font-size: 12px; font-weight: 500; margin: 16px 0 8px; color: var(--text-2); }
      p, dl { max-width: 76ch; margin: 0 0 12px; color: var(--text-2); }
      dl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 16px; }
      dt { color: var(--text); font-weight: 600; }
      dd { margin: 0; }
      code { font-size: 0.92em; }
      .panels { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
      .panel { padding: 16px; background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: 12px; }
      table { border-collapse: collapse; }
      th { padding: 6px 16px 6px 0; text-align: left; font-size: 12px; font-weight: 500; color: var(--text-2); }
      td { padding: 6px 16px 6px 0; vertical-align: middle; }
      .roster { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px; margin-bottom: 12px; }
      .roster.small { gap: 8px; }
      figure { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 4px; }
      figcaption { font-size: 11px; color: var(--text-2); }
      ${rules}
    </style>
  </head>
  <body>
    <main>
      <h1>Squires' avatars: three styles</h1>
      <p>Three ways to draw a squire, all from the one function in <code>apps/web/src/ui/avatar.ts</code>. Each is shown at 24, 40 and 96 px, in light and in dark, in every expression. Nothing moves in any of them, so they are the same with reduced motion. Every avatar is named for a screen reader: "Ada · working", or "Ada's avatar" beside something it said earlier. Galahad is the one in ink with a star.</p>
      <p>An expression is never a mood. It is what the node says of the squire's work, by this rule, the first that holds:</p>
      <dl>${ORDER.map((expression) => `<dt>${expression}</dt><dd>${MEANS[expression]}</dd>`).join("")}</dl>${AVATAR_STYLES.map((style) => `
      <h2>${STYLES[style].title}</h2>
      <p>${STYLES[style].says} ${alike(style)}</p>
      <div class="panels">${panel(style, "light")}${panel(style, "dark")}
      </div>`).join("")}
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
