import { AVATAR_ACCESSORIES, AVATAR_EXPRESSIONS, AVATAR_EYES, AVATAR_FORMS, AVATAR_PALETTES, AVATAR_TEMPERAMENTS, resolveAvatar, withBodyColor, type AvatarExpression, type AvatarProfile } from "@galahad/core/avatar";
import { button, field } from "./controls.ts";
import { h, replace, svg } from "./dom.ts";

/*
 * A knight is drawn as a little creature built of merged dots: its body (the profile's form), its eyes, what it wears
 * on its head (a plume, ears, a crown), in its colour on a deep tile of the same hue, so it reads the same on a light
 * page as on a dark one. What it is doing (core's avatarExpression) it acts out with one thing in front of it: keys
 * while a command runs, a page while it reads what the command printed, its desktop's screen, a lens while its gates
 * run; thought bubbles while it plans or writes an answer, an hourglass while its work waits, a raised hand and an
 * oxblood mark when it needs you, happy eyes after a task passed its checks, a worried brow after something failed,
 * shut eyes while paused. At rest it blinks, and a curious or lively one glances about or hops. Galahad is off-white
 * on navy, with an oxblood plume. A speaker in a conversation's history stays still and neutral, and nothing moves
 * when the device asks for reduced motion: what a knight is doing still shows in what it holds.
 *
 * Only validated hex colours, and colours mixed from them here, reach paint attributes; nothing in an avatar has an
 * id or points at another, so any number of them can share a page.
 */

type Form = AvatarProfile["form"];
type Look = Pick<AvatarProfile, "form" | "color" | "accent" | "eyes" | "accessory" | "temperament">;

/** A cell of the grid a knight is drawn on, and how many a side. */
const P = 10;
const VIEW = 13 * P;
const MID = VIEW / 2;
const PAPER = "#ece6da";
const LINES = "#2a2a31";
const SCREEN = "#121216";
const NIGHT = "#0b0b0e";
/** Galahad's own: off-white, on navy, with an oxblood plume. */
const GALAHAD: Look & { tile: string } = { form: "armored", color: "#ece6da", accent: "#a8373a", eyes: "oval", accessory: "plume", temperament: "calm", tile: "#1c2a4a" };
const title = (value: string) => value[0]!.toUpperCase() + value.slice(1);
const n = (value: number) => String(Math.round(value * 100) / 100);

/* Each body as cells ('#'), where its eyes sit, where its hands rest, and what it can wear over it ('a' the accent,
 * 'b' more of the body). */
const SHAPES: Record<Form, { body: string; eyes: number; hands: [number, number, number, number]; wear: Record<Exclude<AvatarProfile["accessory"], "none">, string> }> = {
  round: {
    body: `
      .............
      .............
      .............
      ....#####....
      ...#######...
      ...#######...
      ...#######...
      ...#######...
      ...#######...
      ...#######...
      ....#####....
      ....#.#.#....`,
    eyes: 63,
    hands: [17, 94, 113, 94],
    wear: {
      plume: `
      .............
      ......aa.....
      ......a......`,
      ears: `
      .............
      .............
      ...b.....b...
      ...b.....b...`,
      crown: `
      .............
      ....a.a.a....
      ....aaaaa....`,
    },
  },
  armored: {
    body: `
      .............
      .............
      .............
      ....#####....
      ...#######...
      ...#######...
      ...#######...
      ..#########..
      ..#########..
      ...#######...
      ...#######...
      ...##...##...`,
    eyes: 52,
    hands: [21, 101, 109, 101],
    wear: {
      plume: `
      .............
      ......aa.....
      ......a......`,
      ears: `
      .............
      .............
      ....b...b....`,
      crown: `
      .............
      ....a.a.a....
      ....aaaaa....`,
    },
  },
  hooded: {
    body: `
      .............
      .............
      ......#......
      .....###.....
      ....#####....
      ...#######...
      ...#######...
      ...#######...
      ...#######...
      ...#######...
      ...#######...
      ...#.#.#.#...`,
    eyes: 69,
    hands: [17, 97, 113, 97],
    wear: {
      plume: `
      .............
      ......aa.....`,
      ears: `
      .............
      .............
      ....b...b....
      ....b...b....`,
      crown: `
      .............
      .....a.a.....
      .....aaa.....`,
    },
  },
};

type Cell = readonly [number, number];
const cellsOf = (drawing: string, mark: string): Cell[] =>
  drawing.trim().split("\n").flatMap((row, y) => [...row.trim()].flatMap((ch, x) => (mark.includes(ch) ? [[x, y] as const] : [])));

/**
 * Cells as one outline: the edge between lit and unlit cells, walked clockwise, each outer corner rounded by half a
 * cell (so a lone cell is a dot and a row of them a rounded bar) and each inner one by a quarter.
 */
export function outline(cells: readonly Cell[]): string {
  const lit = new Set(cells.map(([x, y]) => `${x},${y}`));
  const on = (x: number, y: number) => lit.has(`${x},${y}`);
  type Edge = { x0: number; y0: number; x1: number; y1: number; used: boolean };
  const edges: Edge[] = [];
  const from = new Map<string, Edge[]>();
  const add = (x0: number, y0: number, x1: number, y1: number) => {
    const edge = { x0, y0, x1, y1, used: false };
    edges.push(edge);
    from.set(`${x0},${y0}`, [...(from.get(`${x0},${y0}`) ?? []), edge]);
  };
  for (const [x, y] of cells) {
    if (!on(x, y - 1)) add(x, y, x + 1, y);
    if (!on(x + 1, y)) add(x + 1, y, x + 1, y + 1);
    if (!on(x, y + 1)) add(x + 1, y + 1, x, y + 1);
    if (!on(x - 1, y)) add(x, y + 1, x, y);
  }
  let d = "";
  for (const start of edges) {
    if (start.used) continue;
    const corners: { x: number; y: number; dx: number; dy: number; ox: number; oy: number }[] = [];
    let edge = start;
    do {
      edge.used = true;
      const dx = edge.x1 - edge.x0, dy = edge.y1 - edge.y0;
      const ways = from.get(`${edge.x1},${edge.y1}`)!.filter((way) => !way.used || way === start);
      // Where two cells meet only at a corner, turn right: each keeps an outline of its own.
      const next = ways.find((way) => way.x1 - way.x0 === -dy && way.y1 - way.y0 === dx) ?? ways[0]!;
      const ox = next.x1 - next.x0, oy = next.y1 - next.y0;
      if (ox !== dx || oy !== dy) corners.push({ x: edge.x1 * P, y: edge.y1 * P, dx, dy, ox, oy });
      edge = next;
    } while (edge !== start);
    const turns = corners.map(({ x, y, dx, dy, ox, oy }) => {
      const outer = dx * oy - dy * ox > 0;
      const r = outer ? P / 2 : P / 4;
      return { a: `${n(x - dx * r)} ${n(y - dy * r)}`, b: `${n(x + ox * r)} ${n(y + oy * r)}`, arc: `A${r} ${r} 0 0 ${outer ? 1 : 0} ` };
    });
    d += `M${turns.at(-1)!.b}${turns.map((turn) => `L${turn.a}${turn.arc}${turn.b}`).join("")}Z`;
  }
  return d;
}

const drawn = new Map<string, { body: string; trim: string }>();
/** A form wearing an accessory, as two outlines: its body, and what it wears in its accent. */
function figure(form: Form, accessory: AvatarProfile["accessory"]): { body: string; trim: string } {
  const key = `${form}:${accessory}`;
  let found = drawn.get(key);
  if (!found) {
    const shape = SHAPES[form];
    const wear = accessory === "none" ? "" : shape.wear[accessory];
    const trim = cellsOf(wear, "a");
    const over = new Set(trim.map(([x, y]) => `${x},${y}`));
    const body = [...cellsOf(shape.body, "#"), ...cellsOf(wear, "b")].filter(([x, y]) => !over.has(`${x},${y}`));
    drawn.set(key, (found = { body: outline(body), trim: trim.length ? outline(trim) : "" }));
  }
  return found;
}

// Colour arithmetic, on validated six-digit hex.
const channels = (hex: string) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
const mix = (a: string, b: string, t: number) => {
  const to = channels(b);
  return `#${channels(a).map((v, i) => Math.round(v + (to[i]! - v) * t).toString(16).padStart(2, "0")).join("")}`;
};
const luminance = (hex: string) => {
  const [r, g, b] = channels(hex).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: string, b: string) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi! + 0.05) / (lo! + 0.05); };

/** A knight's paint: its tile, a deep tone of its own colour (a light one under a colour too dark to stand on it), which
 * is also the ink of its eyes; and whether paper in front of it needs an edge to stand apart from a pale body. */
function paint(look: Look, galahad: boolean): { tile: string; edge: string | null } {
  const deep = galahad ? GALAHAD.tile : mix(look.color, NIGHT, 0.8);
  const tile = contrast(look.color, deep) >= 2 ? deep : mix(look.color, "#ffffff", 0.75);
  return { tile, edge: contrast(look.color, PAPER) < 1.7 ? tile : null };
}

const rect = (x0: number, y0: number, x1: number, y1: number) => `M${n(x0)} ${n(y0)}H${n(x1)}V${n(y1)}H${n(x0)}Z`;
const dot = (cx: number, cy: number, r: number) => `M${n(cx - r)} ${n(cy)}a${n(r)} ${n(r)} 0 1 1 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 1 ${n(-2 * r)} 0Z`;

/** Its eyes, open (1) or narrowed, looking aside (dx, dy), or wide. */
function eyes(look: Look, ink: string, y: number, open = 1, dx = 0, dy = 0, wide = 1): SVGElement[] {
  if (look.eyes === "visor") {
    const w = 42 * wide, h = Math.max(2.5, 10 * open * wide);
    return [svg("rect", { class: "kn-eye", x: n(MID - w / 2 + dx), y: n(y - h / 2 + dy), width: n(w), height: n(h), rx: n(h / 2), fill: ink })];
  }
  const round = look.eyes === "round";
  const w = (round ? 14 : 11) * wide, h = Math.max(2.5, (round ? 14 : 18) * open * wide), gap = round ? 15 : 13;
  return [-1, 1].map((side) => svg("rect", { class: "kn-eye", x: n(MID + side * gap - w / 2 + dx), y: n(y - h / 2 + dy), width: n(w), height: n(h), rx: n(Math.min(w, h) / 2), fill: ink }));
}
/** Eyes as lines: happy (∩) or shut (‿). */
function eyeLines(look: Look, ink: string, y: number, happy: boolean): SVGElement {
  const gap = look.eyes === "visor" ? 12 : look.eyes === "round" ? 15 : 13, half = look.eyes === "round" ? 7 : 6;
  const arc = (x: number) => happy ? `M${n(x - half)} ${n(y + 3)}Q${n(x)} ${n(y - 9)} ${n(x + half)} ${n(y + 3)}` : `M${n(x - half)} ${n(y - 1)}Q${n(x)} ${n(y + 7)} ${n(x + half)} ${n(y - 1)}`;
  return svg("path", { class: "kn-eye-line", d: arc(MID - gap) + arc(MID + gap), fill: "none", stroke: ink, "stroke-width": 5, "stroke-linecap": "round" });
}

/** How each state moves, and the editor's choices: given to the page once, by the first avatar drawn. */
export const KNIGHT_CSS = `
.knight { display: block; flex: none; overflow: visible; }
.knight .kn-lids, .knight .kn-hand, .knight .kn-glass, .knight .kn-bubble, .knight .kn-spark, .knight .kn-call { transform-box: fill-box; transform-origin: center; }
.knight .kn-figure { transform-box: view-box; transform-origin: 50% 92%; }
@keyframes kn-blink { 0%, 93%, 100% { transform: scaleY(1); } 95.5% { transform: scaleY(.1); } }
.knight:is([data-expression="idle"], [data-expression="thinking"], [data-expression="working"], [data-expression="browsing"], [data-expression="waiting"], [data-expression="asking"]) .kn-lids { animation: kn-blink 5.3s infinite; }
.knight.kn-t1 .kn-lids { animation-delay: -1.1s; } .knight.kn-t2 .kn-lids { animation-delay: -2.3s; } .knight.kn-t3 .kn-lids { animation-delay: -3.4s; } .knight.kn-t4 .kn-lids { animation-delay: -4.2s; }
@keyframes kn-glance { 0%, 56%, 100% { transform: translate(0, 0); } 60%, 70% { transform: translate(-6px, -1px); } 74%, 84% { transform: translate(6px, -1px); } 88% { transform: translate(0, 0); } }
.knight[data-expression="idle"]:not([data-temper="calm"]) .kn-gaze { animation: kn-glance 8.5s ease-in-out infinite; }
.knight.kn-t1 .kn-gaze { animation-delay: -1.7s; } .knight.kn-t2 .kn-gaze { animation-delay: -3.1s; } .knight.kn-t3 .kn-gaze { animation-delay: -4.9s; } .knight.kn-t4 .kn-gaze { animation-delay: -6.2s; }
@keyframes kn-hop { 0%, 78%, 100% { transform: translateY(0); } 83% { transform: translateY(-7px); } 88% { transform: translateY(0) scaleY(.96); } 92% { transform: translateY(-3px); } 96% { transform: translateY(0); } }
.knight[data-expression="idle"][data-temper="lively"] .kn-figure { animation: kn-hop 6.5s ease-in-out infinite; }
@keyframes kn-tap { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(4px); } }
.knight[data-expression="working"] .kn-l { animation: kn-tap .34s ease-in-out infinite; }
.knight[data-expression="working"] .kn-r { animation: kn-tap .34s ease-in-out -.17s infinite; }
@keyframes kn-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(1.6px); } }
.knight[data-expression="working"] .kn-head { animation: kn-bob .68s ease-in-out infinite; }
@keyframes kn-keys { 0%, 100% { transform: translateX(-3px); } 50% { transform: translateX(3px); } }
.knight[data-expression="working"] .kn-gaze { animation: kn-keys 2.7s ease-in-out infinite; }
@keyframes kn-read { 0% { transform: translate(-5px, -2px); } 26% { transform: translate(5px, -2px); } 32% { transform: translate(-5px, 1px); } 58% { transform: translate(5px, 1px); } 64% { transform: translate(-5px, 4px); } 90% { transform: translate(5px, 4px); } 100% { transform: translate(-5px, -2px); } }
.knight[data-expression="reading"] .kn-gaze { animation: kn-read 3.4s ease-in-out infinite; }
@keyframes kn-ponder { 0%, 100% { transform: translate(0, 0); } 50% { transform: translate(-2px, 1px); } }
.knight[data-expression="thinking"] .kn-gaze { animation: kn-ponder 3.2s ease-in-out infinite; }
@keyframes kn-bubble { 0%, 12% { opacity: 0; transform: scale(.4); } 24%, 78% { opacity: 1; transform: scale(1); } 90%, 100% { opacity: 0; transform: scale(.4); } }
.knight[data-expression="thinking"] .kn-bubble { animation: kn-bubble 2.4s ease-in-out infinite; }
.knight[data-expression="thinking"] .kn-b2 { animation-delay: .25s; } .knight[data-expression="thinking"] .kn-b3 { animation-delay: .5s; }
@keyframes kn-point { 0%, 100% { transform: translate(-14px, 4px); } 30%, 45% { transform: translate(14px, -2px); } 70%, 85% { transform: translate(-2px, 8px); } }
@keyframes kn-follow { 0%, 100% { transform: translate(-5px, 0); } 30%, 45% { transform: translate(5px, -1px); } 70%, 85% { transform: translate(0, 2px); } }
.knight[data-expression="browsing"] .kn-pointer { animation: kn-point 3s ease-in-out infinite; }
.knight[data-expression="browsing"] .kn-gaze { animation: kn-follow 3s ease-in-out infinite; }
@keyframes kn-sweep { 0%, 100% { transform: translateX(-16px); } 50% { transform: translateX(12px); } }
@keyframes kn-squint { 0%, 100% { transform: translateX(-6px); } 50% { transform: translateX(5px); } }
.knight[data-expression="checking"] .kn-lens { animation: kn-sweep 2.6s ease-in-out infinite; }
.knight[data-expression="checking"] .kn-gaze { animation: kn-squint 2.6s ease-in-out infinite; }
@keyframes kn-turn { 0%, 70% { transform: rotate(0); } 85%, 100% { transform: rotate(180deg); } }
.knight[data-expression="waiting"] .kn-glass { animation: kn-turn 2.6s ease-in-out infinite; }
@keyframes kn-fidget { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-2px); } }
.knight[data-expression="waiting"] .kn-figure { animation: kn-fidget 1.3s ease-in-out infinite; }
@keyframes kn-wave { 0%, 100% { transform: translate(0, 0); } 25% { transform: translate(-5px, -3px); } 75% { transform: translate(4px, 2px); } }
.knight[data-expression="asking"] .kn-wave { animation: kn-wave .7s ease-in-out infinite; }
@keyframes kn-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.14); } }
.knight[data-expression="asking"] .kn-call { animation: kn-pulse 1.4s ease-in-out infinite; }
@keyframes kn-joy { 0%, 100% { transform: translateY(0); } 12% { transform: translateY(-8px); } 24% { transform: translateY(0) scaleY(.95); } 34% { transform: translateY(-4px); } 44% { transform: translateY(0); } }
.knight[data-expression="pleased"] .kn-figure { animation: kn-joy 2.2s ease-in-out infinite; }
@keyframes kn-twinkle { 0%, 100% { transform: scale(.2); opacity: 0; } 30%, 60% { transform: scale(1); opacity: 1; } }
.knight[data-expression="pleased"] .kn-spark { animation: kn-twinkle 2.2s ease-in-out infinite; }
.knight[data-expression="pleased"] .kn-s2 { animation-delay: .5s; }
@keyframes kn-sweat { 0% { transform: translateY(-4px); opacity: 0; } 20% { opacity: 1; } 80% { transform: translateY(12px); opacity: 1; } 100% { transform: translateY(16px); opacity: 0; } }
.knight[data-expression="concerned"] .kn-drop { animation: kn-sweat 2.4s ease-in infinite; }
@keyframes kn-sigh { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(2.5px); } }
.knight[data-expression="concerned"] .kn-figure { animation: kn-sigh 3.2s ease-in-out infinite; }
@keyframes kn-breathe { 0%, 100% { transform: scaleY(1); } 50% { transform: scaleY(1.035); } }
.knight[data-expression="resting"] .kn-figure { animation: kn-breathe 4s ease-in-out infinite; opacity: .8; }
@keyframes kn-snooze { 0% { transform: translate(-6px, 8px); opacity: 0; } 25%, 75% { opacity: 1; } 100% { transform: translate(2px, -6px); opacity: 0; } }
.knight[data-expression="resting"] .kn-z { animation: kn-snooze 3.6s ease-in-out infinite; }
.knight[data-expression="resting"] .kn-z2 { animation-delay: 1.8s; }
.knight[data-still], .knight[data-still] * { animation: none !important; }
@media (prefers-reduced-motion: reduce) { .knight, .knight * { animation: none !important; } }
.avatar-choices { display: flex; flex-wrap: wrap; gap: 6px; }
.avatar-choice { padding: 0; border: 0; background: none; border-radius: 12px; cursor: pointer; display: grid; place-items: center; }
.avatar-choice[aria-pressed="true"] { box-shadow: 0 0 0 2px var(--bg, #0a0a0b), 0 0 0 3.5px currentColor; }
`;

function ensureStyles(): void {
  // (In tests and the design sheet there is no page to give it to.)
  if (typeof document === "undefined" || typeof document.getElementById !== "function" || document.getElementById("knight-css")) return;
  const style = document.createElement("style");
  style.id = "knight-css";
  style.textContent = KNIGHT_CSS;
  document.head.append(style);
}

export interface WorkerAvatarOptions {
  /** A knight's handle, or "galahad" for Galahad himself (a handle no other knight can have). */
  id: string;
  name: string;
  profile?: unknown;
  expression?: AvatarExpression;
  size?: number;
  /** Historical messages identify a speaker, without inventing a past emotional state. */
  still?: boolean;
}

export function workerAvatar(options: WorkerAvatarOptions): SVGSVGElement {
  ensureStyles();
  const id = typeof options.id === "string" ? options.id : "knight";
  const galahad = id === "galahad";
  const look: Look = galahad ? GALAHAD : resolveAvatar(id, options.profile);
  const expression = !options.still && AVATAR_EXPRESSIONS.includes(options.expression!) ? options.expression! : "idle";
  const size = Number.isFinite(options.size) ? Math.max(24, Math.min(192, options.size!)) : 40;
  const name = String(options.name || "Knight").slice(0, 160);
  const { tile, edge } = paint(look, galahad);
  const ink = tile;
  const shape = SHAPES[look.form];
  const { body, trim } = figure(look.form, look.accessory);
  const y = shape.eyes;
  const [lx, ly, rx, ry] = shape.hands;
  const hand = (side: "l" | "r", x: number, at: number, extra = "") => svg("circle", { class: `kn-hand kn-${side}${extra}`, cx: n(x), cy: n(at), r: 6.5, fill: look.color });
  // Paper (a page, keys, a screen's bezel) is off-white; on a pale body it is edged in the tile's ink.
  const paper = (attrs: Record<string, string | number>) => svg("rect", { ...attrs, fill: PAPER, ...(edge ? { stroke: edge, "stroke-width": 3.5 } : {}) });
  let face: SVGElement[] = eyes(look, ink, y);
  let hands: SVGElement[] = [hand("l", lx, ly), hand("r", rx, ry)];
  let held: SVGElement[] = [];
  let brow: SVGElement | null = null;
  switch (expression) {
    case "thinking":
      face = eyes(look, ink, y, 0.85, 4, -5);
      held = [[100, 36, 3.2], [106.5, 26, 4.6], [114, 14.5, 6.2]].map(([cx, cy, r], i) => svg("circle", { class: `kn-bubble kn-b${i + 1}`, cx: cx!, cy: cy!, r: r!, fill: PAPER }));
      break;
    case "working": {
      face = eyes(look, ink, y, 0.7, 0, 6);
      const top = Math.max(y + 26, 96);
      held = [paper({ x: 22, y: top, width: 86, height: 20, rx: 6 }), svg("path", { d: [0, 1, 2, 3, 4, 5].map((i) => rect(31 + i * 12, top + 6.5, 37 + i * 12, top + 9.5)).join("") + rect(43, top + 13, 87, top + 16), fill: LINES, opacity: 0.5 })];
      hands = [hand("l", 50, top + 1), hand("r", 80, top + 1)];
      break;
    }
    case "reading": {
      face = eyes(look, ink, y, 0.72, 0, 5);
      const top = Math.max(y + 18, 86);
      held = [paper({ x: 38, y: top, width: 54, height: 126 - top, rx: 5 }), svg("path", { d: rect(46, top + 9, 84, top + 13) + rect(46, top + 18, 80, top + 22) + rect(46, top + 27, 72, top + 31), fill: LINES, opacity: 0.5 })];
      hands = [hand("l", 38, top + 21), hand("r", 92, top + 21)];
      break;
    }
    case "browsing": {
      face = eyes(look, ink, y, 0.9, 0, 6);
      const top = Math.max(y + 24, 88);
      held = [
        paper({ x: 24, y: top, width: 82, height: 124 - top, rx: 7 }),
        svg("rect", { x: 29.5, y: top + 5.5, width: 71, height: 113 - top, rx: 3, fill: SCREEN }),
        svg("rect", { x: 35, y: top + 11, width: 26, height: 4, rx: 2, fill: look.accent }),
        svg("path", { class: "kn-pointer", d: `M62 ${top + 14}l0 13 3.6-3.4 2.6 5.6 2.6-1.2-2.6-5.4 5-.4z`, fill: PAPER }),
      ];
      hands = [];
      break;
    }
    case "checking":
      face = eyes(look, ink, y, 0.55, 0, 5);
      held = [svg("g", { class: "kn-lens" },
        svg("circle", { cx: 60, cy: 97, r: 13, fill: "#ffffff", "fill-opacity": 0.16, stroke: PAPER, "stroke-width": 5 }),
        svg("path", { d: "M70 107L80 117", stroke: PAPER, "stroke-width": 7, "stroke-linecap": "round" }),
        svg("circle", { cx: 83, cy: 119, r: 6.5, fill: look.color, ...(edge ? { stroke: edge, "stroke-width": 3 } : {}) }),
      )];
      hands = [hand("l", lx, ly)];
      break;
    case "waiting":
      face = eyes(look, ink, y, 1, 4, -4);
      held = [svg("g", { class: "kn-glass" },
        svg("path", { d: "M100 12h18v4h-2c0 6-6 8-6 10s6 4 6 10h2v4h-18v-4h2c0-6 6-8 6-10s-6-4-6-10h-2z", fill: PAPER }),
        svg("path", { d: "M106 19h6c0 3-3 4-3 6 0-2-3-3-3-6zM104 37c0-3 3-5 5-5s5 2 5 5z", fill: SCREEN }),
      )];
      break;
    case "asking":
      face = eyes(look, ink, y, 1.05, 0, -1, 1.12);
      hands = [hand("l", lx, ly), hand("r", 109, 42, " kn-wave")];
      held = [svg("g", { class: "kn-call" }, svg("circle", { cx: 19, cy: 19, r: 10, fill: "#b0463f" }), svg("path", { d: rect(17.2, 11.5, 20.8, 21.5) + dot(19, 25.6, 2.1), fill: PAPER }))];
      break;
    case "pleased":
      face = [eyeLines(look, ink, y, true)];
      held = [
        svg("path", { class: "kn-spark kn-s1", d: "M17 32l3 7 7 3-7 3-3 7-3-7-7-3 7-3z", fill: look.accent }),
        svg("path", { class: "kn-spark kn-s2", d: "M110 18l2 5 5 2-5 2-2 5-2-5-5-2 5-2z", fill: look.accent }),
      ];
      break;
    case "concerned": {
      face = eyes(look, ink, y, 0.8, 0, 4, 0.92);
      const [outer, inner] = look.eyes === "visor" ? [22, 6] : [20, 7];
      brow = svg("path", { class: "kn-brow", d: `M${MID - outer} ${y - 9}L${MID - inner} ${y - 15}M${MID + outer} ${y - 9}L${MID + inner} ${y - 15}`, stroke: ink, "stroke-width": 4.5, "stroke-linecap": "round", fill: "none" });
      held = [svg("path", { class: "kn-drop", d: "M110 40c4 6 6 9 6 12a6 6 0 0 1-12 0c0-3 2-6 6-12z", fill: "#bfd8f2" })];
      break;
    }
    case "resting":
      face = [eyeLines(look, ink, y, false)];
      held = [["M97 30h10l-10 11h10", 3.2], ["M108 12h8l-8 9h8", 2.8]].map(([d, width], i) => svg("path", { class: `kn-z kn-z${i + 1}`, d: d!, fill: "none", stroke: PAPER, "stroke-width": width!, "stroke-linecap": "round", "stroke-linejoin": "round" }));
      break;
  }
  // A knight's own moment in the blink and the glance, from its handle, so a roster doesn't blink as one.
  let beat = 0;
  for (const ch of id) beat = (beat * 31 + ch.charCodeAt(0)) % 5;
  return svg("svg", {
    class: `worker-avatar knight kn-t${beat}`, viewBox: `0 0 ${VIEW} ${VIEW}`, width: size, height: size, role: "img", focusable: "false",
    "aria-label": options.still ? `${name}'s avatar` : `${name} · ${expression}`,
    "data-expression": expression, "data-temper": look.temperament, ...(options.still ? { "data-still": "true" } : {}), ...(galahad ? { "data-galahad": "true" } : {}),
  },
    svg("rect", { class: "kn-tile", width: VIEW, height: VIEW, rx: 32, fill: tile }),
    svg("g", { class: "kn-figure" },
      svg("g", { class: "kn-head" },
        svg("path", { class: "kn-shape", d: body, fill: look.color }),
        trim ? svg("path", { class: "kn-trim", d: trim, fill: look.accent }) : null,
        brow,
        svg("g", { class: "kn-gaze" }, svg("g", { class: "kn-lids" }, ...face)),
      ),
      // What it holds or works at, in front of it, and its hands in front of that: on the keys, at the page's edges.
      held.length ? svg("g", { class: "kn-prop" }, ...held) : null,
      ...hands,
    ),
  );
}

/** An unsaved draft. The enclosing profile editor decides whether to persist it. */
export function avatarEditor(options: { id(): string; name(): string; profile?: unknown }): { element: HTMLElement; value(): AvatarProfile | null; refreshIdentity(): void } {
  let profile = resolveAvatar(options.id(), options.profile);
  let edited = false;
  let reset = false;
  const preview = h("div", { class: "avatar-editor-preview" });
  const expression = h("select", { class: "select", "aria-label": "Preview what it is doing" }, ...AVATAR_EXPRESSIONS.map((value) => h("option", { value }, title(value))));
  expression.addEventListener("change", () => render());
  const temperament = h("select", { class: "select", "aria-label": "At rest" }, ...AVATAR_TEMPERAMENTS.map((value) => h("option", { value }, title(value))));
  temperament.addEventListener("change", () => change({ ...profile, temperament: temperament.value as AvatarProfile["temperament"] }));
  const picker = h("input", { type: "color", value: profile.color, "aria-label": "Colour", class: "avatar-color-picker" });
  const hex = h("input", { class: "input mono", value: profile.color, required: true, pattern: "#[0-9a-fA-F]{6}", maxlength: 7, "aria-label": "Colour hex", spellcheck: "false", autocomplete: "off" });
  const change = (next: AvatarProfile, wasReset = false) => { profile = next; edited = true; reset = wasReset; sync(); };
  // A new colour brings its own accent (its plume or crown), unless an accent was chosen apart from it.
  const recolor = (value: string) => { if (/^#[0-9a-fA-F]{6}$/.test(value)) change(withBodyColor(profile, value)); };
  picker.addEventListener("input", () => recolor(picker.value));
  hex.addEventListener("input", () => recolor(hex.value));
  // Each choice is shown on this knight, in its own colours, so it is seen as it will look.
  const choices = <K extends "form" | "eyes" | "accessory">(key: K, values: readonly AvatarProfile[K][], label: string) => {
    const row = h("div", { class: "avatar-choices", role: "group", "aria-label": label });
    return { row, render: () => replace(row, ...values.map((value) => h("button", { type: "button", class: "avatar-choice", "aria-label": `${label}: ${title(String(value))}`, "aria-pressed": String(profile[key] === value), onclick: () => change({ ...profile, [key]: value }) },
      workerAvatar({ id: options.id(), name: title(String(value)), profile: { ...profile, [key]: value }, still: true, size: 44 })))) };
  };
  const rows = [choices("form", AVATAR_FORMS, "Body"), choices("eyes", AVATAR_EYES, "Eyes"), choices("accessory", AVATAR_ACCESSORIES, "On its head")];
  const paletteButtons = AVATAR_PALETTES.map((palette) => {
    const choice = button(palette.name, { variant: "ghost", iconOnly: true, label: `${palette.name}`, onClick: () => change({ ...profile, color: palette.color, accent: palette.accent }) });
    choice.classList.add("avatar-palette");
    choice.appendChild(svg("svg", { viewBox: "0 0 28 28", width: 28, height: 28, "aria-hidden": "true" }, svg("circle", { cx: 14, cy: 14, r: 12, fill: palette.color }), svg("circle", { cx: 20, cy: 20, r: 5, fill: palette.accent })));
    return choice;
  });
  function render(): void {
    replace(preview, workerAvatar({ id: options.id(), name: options.name() || "Your knight", profile, expression: expression.value as AvatarExpression, size: 96 }));
    for (const row of rows) row.render();
    temperament.value = profile.temperament;
    paletteButtons.forEach((choice, i) => choice.setAttribute("aria-pressed", String(profile.color === AVATAR_PALETTES[i]!.color && profile.accent === AVATAR_PALETTES[i]!.accent)));
  }
  function sync(): void {
    picker.value = hex.value = profile.color;
    render();
  }
  const element = h("fieldset", { class: "avatar-editor" }, h("legend", {}, "Avatar"),
    h("div", { class: "avatar-editor-stage" }, preview, h("div", { class: "stack" }, h("p", { class: "small muted" }, "It acts out what it is doing. Preview each here without changing it."), field("Preview what it is doing", expression))),
    field("Body", rows[0]!.row), field("Eyes", rows[1]!.row), field("On its head", rows[2]!.row),
    h("div", { class: "avatar-palettes", "aria-label": "Colours" }, ...paletteButtons),
    field("Colour", h("div", { class: "avatar-color-field" }, picker, hex)),
    field("At rest", temperament),
    button("Reset avatar", { variant: "ghost", size: "sm", onClick: () => change(resolveAvatar(options.id()), true) }),
  );
  render();
  return {
    element,
    value: () => reset ? null : { ...profile },
    refreshIdentity() { if (reset || (!edited && !options.profile)) { profile = resolveAvatar(options.id()); sync(); } else render(); },
  };
}
