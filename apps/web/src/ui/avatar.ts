import { AVATAR_ACCESSORIES, AVATAR_EXPRESSIONS, AVATAR_EYES, AVATAR_FORMS, AVATAR_PALETTES, AVATAR_TEMPERAMENTS, resolveAvatar, withBodyColor, type AvatarExpression, type AvatarProfile } from "@galahad/core/avatar";
import { CROSS, HELM, SLITS as HELM_SLITS } from "../brand.ts";
import { button, field } from "./controls.ts";
import { h, replace, svg } from "./dom.ts";

/*
 * A knight in lit dots on a dark panel, the same grammar as Galahad's mark: an angular helmet (its corners cut, a V at
 * the jaw) with a visor of dark glass, eyes that glow in the knight's own colour, a status light at its side, a small
 * body, hands; cream armour for every knight, one accent (a fin, wings, a crown), the panel tinted with its colour.
 * The shapes are sampled onto a grid of dots, coarser for a small avatar so its dots stay dots. Galahad wears a
 * Templar's helm cut like a heater shield, its brow band and nasal strip the oxblood cross, his eyes in the slit, on
 * navy; in beast mode he is the Black Knight, red-eyed.
 *
 * What a knight is doing (core's avatarExpression) it acts out with what it holds and with its eyes: the keys while a
 * command runs, a page while it reads what the command printed, its desktop's screen, a lens while its gates run;
 * looking up while it thinks, wide-eyed with a hand up when it asks your leave, happy eyes after a task passed, worried
 * ones after something failed, shut ones while paused. A chip in the top corner says the states its face can't:
 * thinking, waiting, asking, passed, failed, paused. Its status light blinks while it works. At rest it blinks, and a
 * curious or lively one glances or hops. A speaker in a conversation's history stays still and neutral, and nothing
 * moves when the device asks for reduced motion: what it holds still says what it is doing.
 *
 * Only validated hex colours, and colours mixed from them here, reach paint attributes; nothing in an avatar has an
 * id or points at another, so any number of them can share a page.
 */

type Form = AvatarProfile["form"];
type Look = Pick<AvatarProfile, "form" | "color" | "accent" | "eyes" | "accessory" | "temperament">;
type Who = "knight" | "galahad" | "black";

/** The drawing: 32 cells a side, ten units each, the figure drawn at 90% about the middle for a margin. */
const D = 32;
const M = D / 2;
const P = 10;
const VIEW = D * P;
const SHRINK = 0.9;
const CREAM = "#ece6da";
const GLASS = "#050506";
const OXBLOOD = "#b23c3d";
const NIGHT = "#08080a";
/** Galahad's look: a Templar's helm (HELMS.templar). His colours are his own (paintOf). */
const GALAHAD: Look = { form: "armored", color: CREAM, accent: OXBLOOD, eyes: "oval", accessory: "none", temperament: "calm" };
const title = (value: string) => value[0]!.toUpperCase() + value.slice(1);
const n1 = (value: number) => String(Math.round(value * 10) / 10);

/* ---------- shapes, as signed distances in cells (negative inside) ---------- */
type Shape = (x: number, y: number) => number;
type Point = readonly [number, number];
const circle = (cx: number, cy: number, r: number): Shape => (x, y) => Math.hypot(x - cx, y - cy) - r;
const box = (cx: number, cy: number, hw: number, hh: number): Shape => (x, y) => Math.max(Math.abs(x - cx) - hw, Math.abs(y - cy) - hh);
const polygon = (points: readonly Point[]): Shape => (x, y) => {
  let inside = false, nearest = Infinity;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i]!, [xj, yj] = points[j]!;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    const dx = xj - xi, dy = yj - yi;
    const t = Math.max(0, Math.min(1, ((x - xi) * dx + (y - yi) * dy) / (dx * dx + dy * dy || 1)));
    nearest = Math.min(nearest, Math.hypot(x - (xi + dx * t), y - (yi + dy * t)));
  }
  return inside ? -nearest : nearest;
};
const union = (...shapes: Shape[]): Shape => (x, y) => Math.min(...shapes.map((shape) => shape(x, y)));
const cut = (shape: Shape, ...holes: Shape[]): Shape => (x, y) => Math.max(shape(x, y), ...holes.map((hole) => -hole(x, y)));
const mirrored = (shape: Shape): Shape => (x, y) => Math.min(shape(x, y), shape(2 * M - x, y));
/** A symmetric polygon from its left half (top to bottom), mirrored to the right. */
const halves = (left: readonly Point[]): Point[] => [...left, ...left.slice().reverse().map(([x, y]) => [2 * M - x, y] as const)];
const symmetric = (left: readonly Point[]): Shape => polygon(halves(left));

/* ---------- the dots ---------- */
interface Part { ink: string; shape: Shape; /** A dark gap this wide (cells) round it, cut out of what is behind. */ halo?: number }

/** How fine the dots are for a size: a small avatar is sampled coarser, so its dots stay dots. */
export const grain = (size: number): number => size <= 30 ? 15 : size <= 44 ? 18 : size <= 64 ? 22 : size <= 100 ? 27 : 32;
/** A point of the drawing where the shrunk figure puts it, in view-box units. */
const at = (x: number, y: number): [number, number] => [(M + (x - M) * SHRINK) * P, (M + (y - M) * SHRINK) * P];

/**
 * Parts sampled onto an n-cell grid: each cell takes the last part covering its centre, a part's halo leaving a dark
 * gap round it. With `unlit`, every other cell shows as a dim dot, as on a dot-matrix display. One path per ink, so a
 * figure is a handful of elements, never a dot an element.
 */
function dots(parts: readonly Part[], n: number, cls: string, unlit?: string): SVGElement[] {
  const unit = D / n;
  const byInk = new Map<string, string>();
  const add = (ink: string, cx: number, cy: number, r: number) => byInk.set(ink, `${byInk.get(ink) ?? ""}M${n1(cx - r)} ${n1(cy)}a${n1(r)} ${n1(r)} 0 1 0 ${n1(2 * r)} 0a${n1(r)} ${n1(r)} 0 1 0 ${n1(-2 * r)} 0`);
  for (let gy = 0; gy < n; gy++) for (let gx = 0; gx < n; gx++) {
    const x = M + ((gx + 0.5) * unit - M) / SHRINK, y = M + ((gy + 0.5) * unit - M) / SHRINK;
    let found: Part | null = null;
    for (const part of parts) {
      const d = part.shape(x, y);
      if (d <= 0.04 * unit) found = part;
      else if (part.halo && d <= part.halo) found = null;
    }
    const cx = (gx + 0.5) * unit * P, cy = (gy + 0.5) * unit * P;
    if (found) add(found.ink, cx, cy, unit * P * 0.43);
    else if (unlit) add(unlit, cx, cy, unit * P * 0.28);
  }
  return [...byInk].map(([ink, d]) => svg("path", { class: cls, d, fill: ink }));
}

/* ---------- colour, on validated six-digit hex ---------- */
const channels = (hex: string) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
const mix = (a: string, b: string, t: number) => {
  const to = channels(b);
  return `#${channels(a).map((v, i) => Math.round(v + (to[i]! - v) * t).toString(16).padStart(2, "0")).join("")}`;
};

/* ---------- the knight ---------- */
/** The helmets, every corner cut at an angle: a sallet, a great helm with a V jaw, a peaked hood; and Galahad's, a
 * Templar's helm cut like a heater shield: a flat crown, its corners cut, its sides angled in to a point. */
const HELMS: Record<Form | "templar", Shape> = {
  round: symmetric([[M - 6.4, 3.2], [M - 10.6, 7.4], [M - 10.6, 17.2], [M - 8.2, 21.0]]),
  armored: symmetric([[M - 8.4, 3.4], [M - 10.8, 5.8], [M - 10.8, 17.6], [M - 6.2, 21.6], [M - 0.01, 22.6]]),
  hooded: symmetric([[M - 0.01, 1.4], [M - 7.6, 6.2], [M - 11.0, 11.8], [M - 11.4, 22.4]]),
  // Galahad's is the mark's (../brand.ts), drawn on the same 32-cell grid.
  templar: polygon(HELM),
};
/** Each visor: dark glass across the face, its ends cut at an angle, narrower below (its left half). */
const VISORS: Record<Form, Point[]> = {
  round: [[M - 8.6, 10.8], [M - 9.4, 13.8], [M - 7.6, 17.4]],
  armored: [[M - 8.9, 10.6], [M - 9.6, 13.6], [M - 7.4, 17.2]],
  hooded: [[M - 7.9, 11.4], [M - 8.8, 14.2], [M - 7.0, 18.0]],
};
/** Galahad's T, the mark's: slits under the brow band, the brow band and the nasal strip his cross. */
const SLITS: [number, number, number, number][] = HELM_SLITS.map(({ cx, cy, hw, hh }) => [cx, cy, hw, hh]);
const TEMPLAR_SLITS = union(...SLITS.map(([cx, cy, hw, hh]) => box(cx, cy, hw, hh)));
const TEMPLAR_CROSS = union(...CROSS.map(({ cx, cy, hw, hh }) => box(cx, cy, hw, hh)));

interface Paint { armor: string; under: string; accent: string; glow: string; panel: string; unlit: string; cross: string | null; held: string }
function paintOf(look: Look, who: Who): Paint {
  if (who === "galahad") return { armor: "#f2eee6", under: "#bdb6a8", accent: OXBLOOD, glow: "#fff1d6", panel: "#0d1322", unlit: "#18213a", cross: OXBLOOD, held: "#8fa7d6" };
  if (who === "black") return { armor: "#6b6b78", under: "#4b4b55", accent: OXBLOOD, glow: "#ff4a3d", panel: "#0d0809", unlit: "#1f1314", cross: OXBLOOD, held: CREAM };
  // The knight's colour is in its light: its eyes, its status light, its accent, and the panel's tint.
  return { armor: CREAM, under: "#b9b2a4", accent: look.color, glow: mix(look.color, "#ffffff", 0.3), panel: mix(look.color, NIGHT, 0.87), unlit: mix(look.color, NIGHT, 0.76), cross: null, held: mix(look.color, "#ffffff", 0.55) };
}

/** The figure's parts: its body, its head, and the visor's shape (a hole in the helmet, drawn as glass). */
function figure(look: Look, who: Who, paint: Paint): { body: Part[]; head: Part[]; visor: Shape } {
  const knight = who === "knight";
  const body: Part[] = [], head: Part[] = [];
  body.push({ ink: paint.under, halo: 0.3, shape: mirrored(box(M - 2.9, 28.4, 1.9, 1.2)) });
  body.push({ ink: paint.armor, halo: 0.6, shape: symmetric([[M - 5.2, 21.2], [M - 6.4, 27.4]]) });
  if (paint.cross) body.push({ ink: paint.cross, shape: union(box(M, 24.6, 0.55, 2.0), box(M, 23.7, 1.7, 0.55)) });
  const visor = knight ? symmetric(VISORS[look.form]) : TEMPLAR_SLITS;
  const glassEdge: Shape = (x, y) => visor(x, y) - 0.5;
  head.push({ ink: paint.armor, halo: 0.8, shape: cut(knight ? HELMS[look.form] : HELMS.templar, glassEdge) });
  if (paint.cross) head.push({ ink: paint.cross, shape: cut(TEMPLAR_CROSS, glassEdge) });
  // What it wears, in front of the helmet and apart from it: a swept fin, fins at its sides, a crown of spikes.
  const accessory = knight ? look.accessory : "none";
  if (accessory === "plume") head.push({ ink: paint.accent, halo: 0.45, shape: polygon([[M + 1.4, 3.2], [M - 2.6, 3.2], [M - 6.2, -0.4], [M - 10.6, -0.4], [M - 10.6, 1.4], [M - 4.4, 3.2]]) });
  if (accessory === "ears") head.push({ ink: paint.accent, halo: 0.45, shape: mirrored(polygon([[M - 11.0, 8.6], [M - 15.0, 2.4], [M - 13.8, 9.8], [M - 11.0, 12.6]])) });
  if (accessory === "crown") head.push({ ink: paint.accent, halo: 0.45, shape: union(box(M, 2.4, 4.6, 0.85), ...[-3.8, 0, 3.8].map((dx) => polygon([[M + dx - 1.4, 2.0], [M + dx, -0.6], [M + dx + 1.4, 2.0]]))) });
  return { body, head, visor };
}

type Mood = "open" | "narrow" | "wide" | "happy" | "shut" | "sad" | "fierce";
/** Its eyes: pills of light with a faint glow round them, by mood; chevrons when happy (^) or shut (v); a lid of the
 * glass's dark over one top corner makes them worried (the outer corner) or fierce (the inner one). */
function eyes(look: Look, who: Who, mood: Mood, glow: string): SVGElement[] {
  const slit = who !== "knight";
  const single = !slit && look.eyes === "visor";
  const round = !slit && look.eyes === "round";
  const s = SHRINK * P;
  const y0 = slit ? 12.6 : 14.0;
  return (single ? [M] : slit ? [M - 4.6, M + 4.6] : [M - 3.2, M + 3.2]).flatMap((ex, i) => {
    const [x, y] = at(ex, y0);
    const side = i === 0 ? -1 : 1;
    if (mood === "happy" || mood === "shut") {
      const w = (single ? 3.4 : 1.3) * s;
      const [edge, tip] = mood === "happy" ? [0.5, -0.8] : [-0.2, 0.7];
      return [svg("path", { class: "kn-eye", d: `M${n1(x - w)} ${n1(y + edge * s)}L${n1(x)} ${n1(y + tip * s)}L${n1(x + w)} ${n1(y + edge * s)}`, fill: "none", stroke: glow, "stroke-width": n1(0.7 * s), "stroke-linecap": "round", "stroke-linejoin": "round" })];
    }
    const [w0, h0] = single ? [7.2, 1.2] : slit ? [2.6, 1.3] : round ? [2.1, 2.1] : [1.9, 3.0];
    const [kw, kh] = ({ narrow: [1.1, 0.45], wide: [1.12, 1.18] } as Partial<Record<Mood, [number, number]>>)[mood] ?? [1, 1];
    const w = w0 * kw * s, h = h0 * kh * s, drop = mood === "sad" ? 0.4 * s : 0;
    const pill = (grow: number, faint: boolean) => svg("rect", { class: faint ? "kn-glow" : "kn-eye", x: n1(x - w / 2 - grow), y: n1(y - h / 2 - grow + drop), width: n1(w + 2 * grow), height: n1(h + 2 * grow), rx: n1(Math.min(w, h) / 2 + grow), fill: glow, ...(faint ? { opacity: 0.16 } : {}) });
    const out: SVGElement[] = [pill(0.9 * s, true), pill(0, false)];
    if (mood === "sad" || mood === "fierce") {
      const outer = (mood === "sad" ? side : -side) * (single ? 4 : 1.9) * s;
      out.push(svg("path", { class: "kn-lid", d: `M${n1(x + outer)} ${n1(y - 2.4 * s)}L${n1(x + outer)} ${n1(y - 0.1 * s)}L${n1(x - outer)} ${n1(y - 2.4 * s)}Z`, fill: GLASS }));
    }
    return out;
  });
}

/** A chip in the panel's top corner, for the states its face can't say alone. Bigger on a small avatar, to be read. */
function chip(expression: AvatarExpression, paint: Paint, size: number): SVGElement | null {
  const r = size <= 44 ? 34 : 27, x = r + 12, y = r + 12;
  const ink = "#16161a";
  const plate = (fill: string, ...inside: SVGElement[]) => svg("g", { class: "kn-chip" }, svg("rect", { x: x - r, y: y - r, width: 2 * r, height: 2 * r, rx: n1(r * 0.42), fill, stroke: NIGHT, "stroke-width": 6 }), ...inside);
  const k = r / 21;
  switch (expression) {
    case "thinking": return plate(CREAM, ...[-8, 0, 8].map((dx, i) => svg("circle", { class: `kn-b${i + 1}`, cx: n1(x + dx * k), cy: y, r: n1(3.4 * k), fill: ink })));
    case "waiting": return plate(CREAM, svg("path", { class: "kn-glass", d: `M${n1(x - 8 * k)} ${n1(y - 11 * k)}h${n1(16 * k)}l${n1(-8 * k)} ${n1(11 * k)}l${n1(8 * k)} ${n1(11 * k)}h${n1(-16 * k)}l${n1(8 * k)} ${n1(-11 * k)}z`, fill: ink }));
    case "asking": return plate(OXBLOOD, svg("path", { d: `M${n1(x - 2.6 * k)} ${n1(y - 12 * k)}h${n1(5.2 * k)}v${n1(14 * k)}h${n1(-5.2 * k)}zM${n1(x - 3 * k)} ${n1(y + 7 * k)}a${n1(3 * k)} ${n1(3 * k)} 0 1 0 ${n1(6 * k)} 0a${n1(3 * k)} ${n1(3 * k)} 0 1 0 ${n1(-6 * k)} 0`, fill: CREAM }));
    case "pleased": return plate(paint.glow, svg("path", { d: `M${n1(x - 9 * k)} ${n1(y + k)}l${n1(6 * k)} ${n1(6 * k)}l${n1(12 * k)} ${n1(-13 * k)}`, fill: "none", stroke: ink, "stroke-width": n1(5 * k), "stroke-linecap": "round", "stroke-linejoin": "round" }));
    case "concerned": return plate("#bfd8f2", svg("path", { d: `M${n1(x)} ${n1(y - 10 * k)}l${n1(6 * k)} ${n1(10 * k)}l${n1(-6 * k)} ${n1(8 * k)}l${n1(-6 * k)} ${n1(-8 * k)}z`, fill: ink }));
    case "resting": return plate(CREAM, svg("path", { d: `M${n1(x - 8 * k)} ${n1(y - 8 * k)}h${n1(16 * k)}l${n1(-16 * k)} ${n1(16 * k)}h${n1(16 * k)}`, fill: "none", stroke: ink, "stroke-width": n1(4.5 * k), "stroke-linecap": "round", "stroke-linejoin": "round" }));
    default: return null;
  }
}

/** How each state moves, and the editor's choices: given to the page once, by the first avatar drawn. */
export const KNIGHT_CSS = `
.knight { display: block; flex: none; overflow: visible; }
.knight .kn-lids, .knight .kn-hand, .knight .kn-chip, .knight .kn-glass { transform-box: fill-box; transform-origin: center; }
.knight .kn-figure { transform-box: view-box; transform-origin: 50% 94%; }
@keyframes kn-blink { 0%, 93%, 100% { transform: scaleY(1); } 95.5% { transform: scaleY(.08); } }
.knight:is([data-expression="idle"], [data-expression="thinking"], [data-expression="working"], [data-expression="reading"], [data-expression="browsing"], [data-expression="checking"], [data-expression="waiting"], [data-expression="asking"]) .kn-lids { animation: kn-blink 5.3s infinite; }
.knight.kn-t1 .kn-lids { animation-delay: -1.1s; } .knight.kn-t2 .kn-lids { animation-delay: -2.3s; } .knight.kn-t3 .kn-lids { animation-delay: -3.4s; } .knight.kn-t4 .kn-lids { animation-delay: -4.2s; }
@keyframes kn-glance { 0%, 56%, 100% { transform: translate(0, 0); } 60%, 70% { transform: translate(-11px, -1px); } 74%, 84% { transform: translate(11px, -1px); } 88% { transform: translate(0, 0); } }
.knight[data-expression="idle"]:not([data-temper="calm"]) .kn-gaze { animation: kn-glance 8.5s ease-in-out infinite; }
.knight.kn-t1 .kn-gaze { animation-delay: -1.7s; } .knight.kn-t2 .kn-gaze { animation-delay: -3.1s; } .knight.kn-t3 .kn-gaze { animation-delay: -4.9s; } .knight.kn-t4 .kn-gaze { animation-delay: -6.2s; }
@keyframes kn-hop { 0%, 78%, 100% { transform: translateY(0); } 83% { transform: translateY(-12px); } 88% { transform: translateY(0) scaleY(.97); } 92% { transform: translateY(-5px); } 96% { transform: translateY(0); } }
.knight[data-expression="idle"][data-temper="lively"] .kn-figure { animation: kn-hop 6.5s ease-in-out infinite; }
@keyframes kn-status { 0%, 49% { opacity: 1; } 50%, 100% { opacity: .25; } }
.knight:is([data-expression="working"], [data-expression="reading"], [data-expression="browsing"], [data-expression="checking"]) .kn-status { animation: kn-status .8s steps(1) infinite; }
@keyframes kn-tap { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(6px); } }
.knight[data-expression="working"] .kn-l { animation: kn-tap .34s ease-in-out infinite; }
.knight[data-expression="working"] .kn-r { animation: kn-tap .34s ease-in-out -.17s infinite; }
@keyframes kn-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(2.5px); } }
.knight[data-expression="working"] .kn-head { animation: kn-bob .68s ease-in-out infinite; }
@keyframes kn-read { 0% { transform: translate(-8px, -2px); } 26% { transform: translate(8px, -2px); } 32% { transform: translate(-8px, 2px); } 58% { transform: translate(8px, 2px); } 64% { transform: translate(-8px, 5px); } 90% { transform: translate(8px, 5px); } 100% { transform: translate(-8px, -2px); } }
.knight[data-expression="reading"] .kn-gaze { animation: kn-read 3.4s ease-in-out infinite; }
@keyframes kn-ponder { 0%, 100% { transform: translate(0, 0); } 50% { transform: translate(-4px, 2px); } }
.knight[data-expression="thinking"] .kn-gaze { animation: kn-ponder 3.2s ease-in-out infinite; }
@keyframes kn-ellipsis { 0%, 20% { opacity: .25; } 40%, 70% { opacity: 1; } 100% { opacity: .25; } }
.knight[data-expression="thinking"] :is(.kn-b1, .kn-b2, .kn-b3) { animation: kn-ellipsis 1.2s ease-in-out infinite; }
.knight[data-expression="thinking"] .kn-b2 { animation-delay: .2s; } .knight[data-expression="thinking"] .kn-b3 { animation-delay: .4s; }
@keyframes kn-point { 0%, 100% { transform: translate(-22px, 3px); } 30%, 45% { transform: translate(22px, -2px); } 70%, 85% { transform: translate(-4px, 9px); } }
@keyframes kn-follow { 0%, 100% { transform: translate(-7px, 0); } 30%, 45% { transform: translate(7px, -1px); } 70%, 85% { transform: translate(0, 2px); } }
.knight[data-expression="browsing"] .kn-pointer { animation: kn-point 3s ease-in-out infinite; }
.knight[data-expression="browsing"] .kn-gaze { animation: kn-follow 3s ease-in-out infinite; }
@keyframes kn-sweep { 0%, 100% { transform: translateX(-24px); } 50% { transform: translateX(16px); } }
@keyframes kn-squint { 0%, 100% { transform: translateX(-8px); } 50% { transform: translateX(7px); } }
.knight[data-expression="checking"] .kn-lens { animation: kn-sweep 2.6s ease-in-out infinite; }
.knight[data-expression="checking"] .kn-gaze { animation: kn-squint 2.6s ease-in-out infinite; }
@keyframes kn-turn { 0%, 70% { transform: rotate(0); } 85%, 100% { transform: rotate(180deg); } }
.knight[data-expression="waiting"] .kn-glass { animation: kn-turn 2.6s ease-in-out infinite; }
@keyframes kn-wave { 0%, 100% { transform: translate(0, 0); } 25% { transform: translate(-7px, -5px); } 75% { transform: translate(6px, 4px); } }
.knight[data-expression="asking"] .kn-wave { animation: kn-wave .7s ease-in-out infinite; }
@keyframes kn-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.12); } }
.knight[data-expression="asking"] .kn-chip { animation: kn-pulse 1.4s ease-in-out infinite; }
@keyframes kn-joy { 0%, 100% { transform: translateY(0); } 12% { transform: translateY(-13px); } 24% { transform: translateY(0) scaleY(.96); } 34% { transform: translateY(-6px); } 44% { transform: translateY(0); } }
.knight[data-expression="pleased"] .kn-figure { animation: kn-joy 2.2s ease-in-out infinite; }
@keyframes kn-sigh { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(4px); } }
.knight[data-expression="concerned"] .kn-figure { animation: kn-sigh 3.2s ease-in-out infinite; }
@keyframes kn-breathe { 0%, 100% { transform: scaleY(1); } 50% { transform: scaleY(1.03); } }
.knight[data-expression="resting"] .kn-figure { animation: kn-breathe 4s ease-in-out infinite; opacity: .78; }
@keyframes kn-embers { 0%, 100% { opacity: .6; } 50% { opacity: 1; } }
.knight[data-beast] :is(.kn-eye, .kn-glow) { animation: kn-embers 1.6s ease-in-out infinite; }
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
  /** Galahad in beast mode: the Black Knight. Nothing for any other knight. */
  beast?: boolean;
}

export function workerAvatar(options: WorkerAvatarOptions): SVGSVGElement {
  ensureStyles();
  const id = typeof options.id === "string" ? options.id : "knight";
  const who: Who = id === "galahad" ? (options.beast === true ? "black" : "galahad") : "knight";
  const look: Look = who === "knight" ? resolveAvatar(id, options.profile) : GALAHAD;
  const expression = !options.still && AVATAR_EXPRESSIONS.includes(options.expression!) ? options.expression! : "idle";
  const size = Number.isFinite(options.size) ? Math.max(24, Math.min(192, options.size!)) : 40;
  const name = String(options.name || "Knight").slice(0, 160);
  const paint = paintOf(look, who);
  const fine = grain(size);
  const { body, head, visor } = figure(look, who, paint);
  const s = SHRINK * P;
  let hands: [number, number][] = [[M - 8.0, 25.4], [M + 8.0, 25.4]];
  let held: Part[] = [];
  let lens: Part[] = [];
  let screen: SVGElement[] = [];
  let mood: Mood = who === "black" ? "fierce" : "open";
  let gaze: [number, number] = [0, 0];
  const intent = (calm: Mood): Mood => (who === "black" ? "fierce" : calm);
  switch (expression) {
    case "thinking": gaze = [1.0, -0.8]; break;
    case "working":
      mood = intent("narrow"); gaze = [0, 0.6];
      held = [{ ink: paint.held, shape: box(M, 28.8, 8.6, 1.5) }];
      hands = [[M - 3.4, 26.8], [M + 3.4, 26.8]];
      break;
    case "reading":
      mood = intent("narrow"); gaze = [0, 0.5];
      held = [{ ink: paint.held, shape: cut(box(M, 25.8, 4.8, 4.4), box(M - 0.4, 24.0, 3.2, 0.35), box(M - 0.8, 25.8, 2.8, 0.35), box(M - 1.4, 27.6, 2.2, 0.35)) }];
      hands = [[M - 5.4, 26.0], [M + 5.4, 26.0]];
      break;
    case "browsing": {
      gaze = [0, 0.6];
      held = [{ ink: paint.held, shape: cut(box(M, 26.4, 7.6, 4.0), box(M, 26.2, 6.4, 3.0)) }];
      const [x0, y0] = at(M - 6.4, 23.2), [x1, y1] = at(M + 6.4, 29.2);
      screen = [
        svg("rect", { x: n1(x0), y: n1(y0), width: n1(x1 - x0), height: n1(y1 - y0), fill: GLASS }),
        svg("rect", { x: n1(x0 + 6), y: n1(y0 + 6), width: n1((x1 - x0) * 0.4), height: 5, fill: paint.glow }),
        svg("path", { class: "kn-pointer", d: `M${n1((x0 + x1) / 2)} ${n1(y0 + 13)}l0 17 4.6-4.4 3.4 7.2 3.4-1.6-3.4-7 6.4-.5z`, fill: CREAM }),
      ];
      hands = [];
      break;
    }
    case "checking":
      mood = intent("narrow"); gaze = [0, 0.5];
      lens = [{ ink: paint.held, shape: union(cut(circle(M - 1.2, 25.2, 3.3), circle(M - 1.2, 25.2, 2.0)), polygon([[M + 1.0, 27.0], [M + 1.9, 26.2], [M + 4.4, 28.6], [M + 3.5, 29.4]])) }];
      hands = [[M - 8.0, 25.4], [M + 4.6, 29.0]];
      break;
    case "waiting": gaze = [-1.0, -0.8]; break;
    case "asking": mood = intent("wide"); hands = [[M - 8.0, 25.4], [M + 12.2, 15.8]]; break;
    case "pleased": mood = "happy"; break;
    case "concerned": mood = "sad"; gaze = [0, 0.5]; break;
    case "resting": mood = "shut"; break;
    case "idle": break;
  }
  // The glass: the visor's polygon, or Galahad's two slits.
  const glass = who === "knight"
    ? svg("path", { class: "kn-visor", d: `M${halves(VISORS[look.form]).map(([x, y]) => at(x, y).map(n1).join(" ")).join("L")}Z`, fill: GLASS })
    : svg("path", { class: "kn-visor", d: SLITS.map(([cx, cy, hw, hh]) => { const [x0, y0] = at(cx - hw, cy - hh), [x1, y1] = at(cx + hw, cy + hh); return `M${n1(x0)} ${n1(y0)}H${n1(x1)}V${n1(y1)}H${n1(x0)}Z`; }).join(""), fill: GLASS });
  void visor;
  const [lx, ly] = at(who === "knight" ? M + 9.4 : M + 8.4, 7.6);
  // A knight's own moment in the blink and the glance, from its handle, so a roster doesn't blink as one.
  let beat = 0;
  for (const ch of id) beat = (beat * 31 + ch.charCodeAt(0)) % 5;
  return svg("svg", {
    class: `worker-avatar knight kn-t${beat}`, viewBox: `0 0 ${VIEW} ${VIEW}`, width: size, height: size, role: "img", focusable: "false",
    "aria-label": options.still ? `${name}'s avatar` : `${name} · ${expression}${who === "black" ? " · beast mode" : ""}`,
    "data-expression": expression, "data-temper": look.temperament,
    ...(options.still ? { "data-still": "true" } : {}), ...(who !== "knight" ? { "data-galahad": "true" } : {}), ...(who === "black" ? { "data-beast": "true" } : {}),
  },
    svg("rect", { class: "kn-panel", width: VIEW, height: VIEW, rx: n1(VIEW * 0.24), fill: paint.panel }),
    svg("g", { class: "kn-figure" },
      ...dots(body, fine, "kn-body", size >= 96 ? paint.unlit : undefined),
      svg("g", { class: "kn-head" },
        ...dots(head, fine, "kn-helm"),
        glass,
        svg("circle", { class: "kn-status", cx: n1(lx), cy: n1(ly), r: n1(0.85 * s), fill: who === "knight" ? paint.glow : OXBLOOD }),
        svg("g", { class: "kn-look", transform: `translate(${n1(gaze[0] * s)} ${n1(gaze[1] * s)})` }, svg("g", { class: "kn-gaze" }, svg("g", { class: "kn-lids" }, ...eyes(look, who, mood, paint.glow)))),
      ),
      held.length || screen.length ? svg("g", { class: "kn-prop" }, ...dots(held, fine, "kn-held"), ...screen) : null,
      lens.length ? svg("g", { class: "kn-lens" }, ...dots(lens, fine, "kn-held")) : null,
      // Its hands in front of what they hold: on the keys, at the page's edges, one up when it asks.
      ...hands.map(([x, y], i) => svg("g", { class: `kn-hand kn-${i === 0 ? "l" : "r"}${expression === "asking" && i === 1 ? " kn-wave" : ""}` }, ...dots([{ ink: paint.armor, halo: 0.5, shape: circle(x, y, 1.75) }], fine, "kn-dots"))),
    ),
    chip(expression, paint, size),
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
  // A new colour brings its own accent, unless an accent was chosen apart from it.
  const recolor = (value: string) => { if (/^#[0-9a-fA-F]{6}$/.test(value)) change(withBodyColor(profile, value)); };
  picker.addEventListener("input", () => recolor(picker.value));
  hex.addEventListener("input", () => recolor(hex.value));
  // What each choice is called: the profile's words are older than the helmets.
  const NAMES: Record<string, string> = { round: "Sallet", armored: "Great helm", hooded: "Hood", oval: "Pills", visor: "A slit", none: "Nothing", plume: "A fin", ears: "Fins", crown: "A crown" };
  // Each choice is shown on this knight, in its own colours, so it is seen as it will look.
  const choices = <K extends "form" | "eyes" | "accessory">(key: K, values: readonly AvatarProfile[K][], label: string) => {
    const row = h("div", { class: "avatar-choices", role: "group", "aria-label": label });
    return { row, render: () => replace(row, ...values.map((value) => h("button", { type: "button", class: "avatar-choice", "aria-label": `${label}: ${NAMES[String(value)] ?? title(String(value))}`, "aria-pressed": String(profile[key] === value), onclick: () => change({ ...profile, [key]: value }) },
      workerAvatar({ id: options.id(), name: NAMES[String(value)] ?? title(String(value)), profile: { ...profile, [key]: value }, still: true, size: 48 })))) };
  };
  const rows = [choices("form", AVATAR_FORMS, "Helmet"), choices("eyes", AVATAR_EYES, "Eyes"), choices("accessory", AVATAR_ACCESSORIES, "On its helmet")];
  const paletteButtons = AVATAR_PALETTES.map((palette) => {
    const choice = button(palette.name, { variant: "ghost", iconOnly: true, label: `${palette.name}`, onClick: () => change({ ...profile, color: palette.color, accent: palette.accent }) });
    choice.classList.add("avatar-palette");
    choice.appendChild(svg("svg", { viewBox: "0 0 28 28", width: 28, height: 28, "aria-hidden": "true" }, svg("circle", { cx: 14, cy: 14, r: 12, fill: palette.color })));
    return choice;
  });
  function render(): void {
    replace(preview, workerAvatar({ id: options.id(), name: options.name() || "Your knight", profile, expression: expression.value as AvatarExpression, size: 112 }));
    for (const row of rows) row.render();
    temperament.value = profile.temperament;
    paletteButtons.forEach((choice, i) => choice.setAttribute("aria-pressed", String(profile.color === AVATAR_PALETTES[i]!.color)));
  }
  function sync(): void {
    picker.value = hex.value = profile.color;
    render();
  }
  const element = h("fieldset", { class: "avatar-editor" }, h("legend", {}, "Avatar"),
    h("div", { class: "avatar-editor-stage" }, preview, h("div", { class: "stack" }, h("p", { class: "small muted" }, "It acts out what it is doing. Preview each here without changing it."), field("Preview what it is doing", expression))),
    field("Helmet", rows[0]!.row), field("Eyes", rows[1]!.row), field("On its helmet", rows[2]!.row),
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
