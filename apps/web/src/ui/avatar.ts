import { AVATAR_EXPRESSIONS, AVATAR_LOOKS, AVATAR_TEMPERAMENTS, avatarLook, lookProfile, resolveAvatar, type AvatarExpression, type AvatarLook, type AvatarProfile } from "@galahad/core/avatar";
import { button, field } from "./controls.ts";
import { h, replace, svg } from "./dom.ts";

/*
 * A knight as the owner drew it: the drawing itself (src/knights/, cut out of its paper), with live eyes drawn over the
 * drawn ones. Which of the ten drawings a knight is, core's avatarLook says; Galahad wears his red cross, and in beast
 * mode he is the Black Knight, his eyes burning red. Every drawing is on the same square canvas with its figure on the
 * same baseline, so any two line up at any size.
 *
 * What a knight is doing (core's avatarExpression) it shows with its eyes, and a little with its body: looking up while
 * it thinks, down at the work while a command runs, along the lines while it reads what the command printed, after
 * the pointer at its desktop, back and forth while its gates run, up and away while its work waits; wide-eyed with a
 * red mark beside it when it asks your leave, happy eyes and a hop after a task passed, lowered eyes after something
 * failed, shut eyes and drained colour while it is paused. At rest it blinks, and a curious or lively one glances or
 * hops. A speaker in a conversation's history stays still and neutral, and nothing moves when the device asks for
 * reduced motion.
 *
 * The pictures are the app's own files, by fixed names: nothing from a profile reaches a URL, a style or a paint.
 */

type Art = AvatarLook | "galahad" | "black-knight";
/** An eye on the drawing's 768-unit canvas: its centre, its radius, and the dark of the slit round it. */
type Eye = readonly [x: number, y: number, r: number, slit: string];
/** The canvas every drawing is on, in the units its eyes are given in. */
const CANVAS = 768;
/** Where each drawing's eyes are, and the box its figure fills (for what is drawn beside it): design/knights-cutout.py
 * prints a drawing's line when it cuts it out. The two the app shows big (Galahad's own) come at twice the size too. */
const ART: Record<Art, { eyes: readonly [Eye, Eye]; box: readonly [number, number, number, number]; large?: true }> = {
  galahad: { eyes: [[281, 293, 13.7, "#342015"], [483, 294, 13.6, "#331e13"]], box: [123, 23, 645, 730], large: true },
  "black-knight": { eyes: [[230, 282, 12.8, "#271b12"], [428, 282, 13.6, "#251a11"]], box: [140, 23, 628, 730], large: true },
  kay: { eyes: [[271, 304, 12.8, "#24170c"], [444, 304, 12.8, "#25170c"]], box: [137, 23, 631, 730] },
  gaheris: { eyes: [[278, 291, 13.7, "#2a1e17"], [484, 290, 13.7, "#2b1e17"]], box: [122, 23, 646, 730] },
  percival: { eyes: [[222, 303, 12.3, "#33261d"], [360, 300, 12.9, "#2a1f17"]], box: [130, 23, 638, 730] },
  palamedes: { eyes: [[300, 325, 10.9, "#2b1e15"], [467, 325, 11.0, "#2b1e15"]], box: [152, 23, 616, 730] },
  gawain: { eyes: [[228, 377, 18.2, "#2c2114"], [401, 377, 18.8, "#2a1f13"]], box: [47, 23, 721, 730] },
  tristan: { eyes: [[243, 300, 15.3, "#2a2018"], [415, 300, 15.4, "#2a2019"]], box: [137, 23, 631, 730] },
  lancelot: { eyes: [[239, 300, 12.3, "#231a14"], [375, 300, 12.4, "#221913"]], box: [142, 23, 626, 730] },
  bedivere: { eyes: [[236, 295, 12.2, "#211b12"], [376, 293, 12.2, "#211a12"]], box: [137, 23, 631, 730] },
  bors: { eyes: [[296, 258, 11.9, "#2b1f16"], [455, 258, 12.0, "#291e15"]], box: [33, 23, 735, 730] },
  gareth: { eyes: [[236, 350, 18.6, "#2f1f14"], [429, 350, 18.7, "#2d1e13"]], box: [14, 23, 754, 730] },
};
/** Above this size a drawing that has its larger file uses it, so it stays sharp on a dense screen. */
const LARGE_FROM = 120;
const title = (value: string) => value[0]!.toUpperCase() + value.slice(1);
const n1 = (value: number) => String(Math.round(value * 10) / 10);

type Eyes = "open" | "wide" | "low" | "happy" | "shut" | "ember";
/** How each state shows: its eyes, and where they look (in eye radii, x then y; the page's motion moves some). */
const SHOWN: Record<AvatarExpression, { eyes: Eyes; gaze: readonly [number, number] }> = {
  idle: { eyes: "open", gaze: [0, 0] },
  thinking: { eyes: "open", gaze: [0.4, -0.32] },
  working: { eyes: "open", gaze: [-0.1, 0.34] },
  reading: { eyes: "open", gaze: [0, 0.22] },
  browsing: { eyes: "open", gaze: [0, 0.22] },
  checking: { eyes: "open", gaze: [0, 0.28] },
  waiting: { eyes: "open", gaze: [-0.38, -0.3] },
  asking: { eyes: "wide", gaze: [0, 0] },
  pleased: { eyes: "happy", gaze: [0, 0] },
  concerned: { eyes: "low", gaze: [0, 0.3] },
  resting: { eyes: "shut", gaze: [0, 0] },
};

/** The live eyes: the drawn ones covered in the slit's own dark, and drawn again as this state has them. */
function eyes(art: Art, eyes: Eyes, gaze: readonly [number, number]): SVGElement[] {
  return ART[art].eyes.flatMap(([x, y, r, slit]) => {
    const cover = svg("circle", { cx: n1(x), cy: n1(y), r: n1(r * 1.3), fill: slit });
    const [gx, gy] = [x + gaze[0] * r, y + gaze[1] * r];
    let eye: SVGElement;
    if (eyes === "happy") eye = svg("path", { d: `M${n1(gx - 1.1 * r)} ${n1(gy + 0.42 * r)}Q${n1(gx)} ${n1(gy - 1.15 * r)} ${n1(gx + 1.1 * r)} ${n1(gy + 0.42 * r)}`, fill: "none", stroke: "#ffffff", "stroke-width": n1(0.62 * r), "stroke-linecap": "round" });
    else if (eyes === "shut") eye = svg("path", { d: `M${n1(gx - 1.1 * r)} ${n1(gy)}Q${n1(gx)} ${n1(gy + 0.8 * r)} ${n1(gx + 1.1 * r)} ${n1(gy)}`, fill: "none", stroke: "#ffffff", "stroke-width": n1(0.55 * r), "stroke-linecap": "round" });
    // Embers: a red glow in rings round a hot core, with no filter (nothing in an avatar has an id).
    else if (eyes === "ember") eye = svg("g", { class: "kn-ember" }, svg("circle", { cx: n1(gx), cy: n1(gy), r: n1(2.3 * r), fill: "#ff3b4e", opacity: 0.16 }), svg("circle", { cx: n1(gx), cy: n1(gy), r: n1(1.6 * r), fill: "#ff3b4e", opacity: 0.32 }), svg("circle", { cx: n1(gx), cy: n1(gy), r: n1(1.12 * r), fill: "#ff4a5a" }), svg("circle", { cx: n1(gx), cy: n1(gy), r: n1(0.55 * r), fill: "#fff1f2" }));
    else eye = svg("circle", { cx: n1(gx), cy: n1(gy + (eyes === "low" ? 0.12 * r : 0)), r: n1(r * (eyes === "wide" ? 1.18 : eyes === "low" ? 0.86 : 1)), fill: "#ffffff" });
    return [cover, svg("g", { class: "kn-gaze" }, svg("g", { class: "kn-eye" }, eye))];
  });
}

/** A red speech mark beside the knight's helm, for asking your leave: drawn where it can be read (not on a row's face). */
function askMark(art: Art): SVGElement {
  const [x0, y0, x1] = ART[art].box;
  const w = 0.24 * (x1 - x0), k = w / 44;
  return svg("g", { transform: `translate(${n1(x1 - w * 0.95)} ${n1(Math.max(4, y0 - 6))}) scale(${n1(k)})` },
    svg("g", { class: "kn-ask" },
      svg("path", { d: "M8 0H36Q44 0 44 8V24Q44 32 36 32H24L16 40L17 32H8Q0 32 0 24V8Q0 0 8 0Z", fill: "#a8373a", stroke: "#2a2120", "stroke-width": 1.6 }),
      svg("path", { d: "M22 7V18", stroke: "#ffffff", "stroke-width": 4, "stroke-linecap": "round" }),
      svg("circle", { cx: 22, cy: 25, r: 2.4, fill: "#ffffff" })));
}

/** How each state moves, and the editor's choices: given to the page once, by the first avatar drawn. */
export const KNIGHT_CSS = `
.knight { position: relative; display: block; flex: none; width: var(--kn-size, 40px); height: var(--kn-size, 40px); }
.knight .kn-figure { position: absolute; inset: 0; transform-origin: 50% 95%; }
.knight img, .knight .kn-live { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.knight img { object-fit: contain; pointer-events: none; user-select: none; -webkit-user-select: none; -webkit-user-drag: none; }
.knight .kn-live { overflow: visible; pointer-events: none; }
.knight :is(.kn-eye, .kn-ask) { transform-box: fill-box; transform-origin: center; }
.knight .kn-ask { transform-origin: 20% 100%; }
@keyframes kn-blink { 0%, 93%, 100% { transform: scaleY(1); } 95.5% { transform: scaleY(.08); } }
.knight:not([data-expression="pleased"], [data-expression="resting"]) .kn-eye { animation: kn-blink 5.3s infinite; }
.knight.kn-t1 .kn-eye { animation-delay: -1.1s; } .knight.kn-t2 .kn-eye { animation-delay: -2.3s; } .knight.kn-t3 .kn-eye { animation-delay: -3.4s; } .knight.kn-t4 .kn-eye { animation-delay: -4.2s; }
@keyframes kn-glance { 0%, 56%, 100% { transform: translate(0, 0); } 60%, 70% { transform: translate(-5px, -1px); } 74%, 84% { transform: translate(5px, -1px); } 88% { transform: translate(0, 0); } }
.knight[data-expression="idle"]:not([data-temper="calm"]) .kn-gaze { animation: kn-glance 8.5s ease-in-out infinite; }
.knight.kn-t1 .kn-gaze { animation-delay: -1.7s; } .knight.kn-t2 .kn-gaze { animation-delay: -3.1s; } .knight.kn-t3 .kn-gaze { animation-delay: -4.9s; } .knight.kn-t4 .kn-gaze { animation-delay: -6.2s; }
@keyframes kn-hop { 0%, 78%, 100% { transform: translateY(0); } 83% { transform: translateY(-5%); } 88% { transform: translateY(0) scaleY(.97); } 92% { transform: translateY(-2%); } 96% { transform: translateY(0); } }
.knight[data-expression="idle"][data-temper="lively"] .kn-figure { animation: kn-hop 6.5s ease-in-out infinite; }
@keyframes kn-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(1.2%); } }
.knight[data-expression="working"] .kn-figure { animation: kn-bob .9s ease-in-out infinite; }
@keyframes kn-read { 0% { transform: translate(-5px, -1px); } 26% { transform: translate(5px, -1px); } 32% { transform: translate(-5px, 2px); } 58% { transform: translate(5px, 2px); } 64% { transform: translate(-5px, 4px); } 90% { transform: translate(5px, 4px); } 100% { transform: translate(-5px, -1px); } }
.knight[data-expression="reading"] .kn-gaze { animation: kn-read 3.4s ease-in-out infinite; }
@keyframes kn-follow { 0%, 100% { transform: translate(-5px, 0); } 30%, 45% { transform: translate(5px, -1px); } 70%, 85% { transform: translate(0, 2px); } }
.knight[data-expression="browsing"] .kn-gaze { animation: kn-follow 3s ease-in-out infinite; }
@keyframes kn-scan { 0%, 100% { transform: translateX(-5px); } 50% { transform: translateX(5px); } }
.knight[data-expression="checking"] .kn-gaze { animation: kn-scan 2.6s ease-in-out infinite; }
@keyframes kn-ponder { 0%, 100% { transform: translate(0, 0); } 50% { transform: translate(-2px, 1px); } }
.knight[data-expression="thinking"] .kn-gaze { animation: kn-ponder 3.2s ease-in-out infinite; }
@keyframes kn-nudge { 0%, 80%, 100% { transform: rotate(0); } 86% { transform: rotate(-8deg); } 92% { transform: rotate(6deg); } }
.knight[data-expression="asking"] .kn-ask { animation: kn-nudge 2.8s ease-in-out infinite; }
@keyframes kn-joy { 0%, 100% { transform: translateY(0); } 12% { transform: translateY(-5%); } 24% { transform: translateY(0) scaleY(.97); } 34% { transform: translateY(-2%); } 44% { transform: translateY(0); } }
.knight[data-expression="pleased"] .kn-figure { animation: kn-joy 2.2s ease-in-out infinite; }
@keyframes kn-sigh { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(1.5%); } }
.knight[data-expression="concerned"] .kn-figure { animation: kn-sigh 3.2s ease-in-out infinite; }
.knight[data-expression="resting"] img { filter: grayscale(.85); opacity: .62; }
@keyframes kn-embers { 0%, 100% { opacity: .78; } 50% { opacity: 1; } }
.knight[data-beast] .kn-ember { animation: kn-embers 1.6s ease-in-out infinite; }
.knight[data-still], .knight[data-still] * { animation: none !important; }
@media (prefers-reduced-motion: reduce) { .knight, .knight * { animation: none !important; } }
.avatar-looks { display: grid; grid-template-columns: repeat(auto-fill, minmax(76px, 1fr)); gap: 4px; }
.avatar-look { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 6px 2px 8px; border: 0; border-radius: 14px; background: none; color: inherit; font: inherit; font-size: 12px; cursor: pointer; }
.avatar-look:hover { background: var(--surface-2, transparent); }
.avatar-look[aria-pressed="true"] { background: var(--surface-2, transparent); box-shadow: inset 0 0 0 1.5px var(--accent, currentColor); }
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

/** Which drawing an avatar shows, and how lively it is at rest. */
function artOf(options: WorkerAvatarOptions): { art: Art; temper: AvatarProfile["temperament"] } {
  const id = typeof options.id === "string" ? options.id : "knight";
  if (id === "galahad") return { art: options.beast === true ? "black-knight" : "galahad", temper: "calm" };
  return { art: avatarLook(id, String(options.name ?? ""), options.profile), temper: resolveAvatar(id, options.profile).temperament };
}

export function workerAvatar(options: WorkerAvatarOptions): HTMLElement {
  ensureStyles();
  const id = typeof options.id === "string" ? options.id : "knight";
  const { art, temper } = artOf(options);
  const expression = !options.still && AVATAR_EXPRESSIONS.includes(options.expression!) ? options.expression! : "idle";
  const size = Number.isFinite(options.size) ? Math.round(Math.max(20, Math.min(256, options.size!))) : 40;
  const name = String(options.name || "Knight").slice(0, 160);
  const shown = SHOWN[expression];
  const beast = art === "black-knight";
  const large = ART[art].large && size > LARGE_FROM;
  // A knight's own moment in the blink and the glance, from its handle, so a roster doesn't blink as one.
  let beat = 0;
  for (const ch of id) beat = (beat * 31 + ch.charCodeAt(0)) % 5;
  return h(
    "span",
    {
      class: `worker-avatar knight kn-t${beat}`, role: "img", style: `--kn-size:${size}px`,
      "aria-label": options.still ? `${name}'s avatar` : `${name} · ${expression}${beast ? " · beast mode" : ""}`,
      "data-expression": expression, "data-temper": temper, "data-look": art,
      ...(options.still ? { "data-still": "true" } : {}), ...(id === "galahad" ? { "data-galahad": "true" } : {}), ...(beast ? { "data-beast": "true" } : {}),
    },
    h("span", { class: "kn-figure" },
      h("img", { src: `/knights/${art}.webp`, ...(large ? { srcset: `/knights/${art}.webp 288w, /knights/${art}@2x.webp 576w`, sizes: `${size}px` } : {}), alt: "", draggable: "false", decoding: "async" }),
      svg("svg", { class: "kn-live", viewBox: `0 0 ${CANVAS} ${CANVAS}`, "aria-hidden": "true", focusable: "false" },
        ...eyes(art, beast ? "ember" : shown.eyes, shown.gaze),
        expression === "asking" && size >= 48 ? askMark(art) : null,
      ),
    ),
  );
}

/** An unsaved draft. The enclosing profile editor decides whether to persist it. */
export function avatarEditor(options: { id(): string; name(): string; profile?: unknown }): { element: HTMLElement; value(): AvatarProfile | null; refreshIdentity(): void } {
  let look: AvatarLook = avatarLook(options.id(), options.name(), options.profile);
  let temperament = resolveAvatar(options.id(), options.profile).temperament;
  let edited = false;
  let reset = false;
  const preview = h("div", { class: "avatar-editor-preview" });
  const expression = h("select", { class: "select", "aria-label": "Preview what it is doing" }, ...AVATAR_EXPRESSIONS.map((value) => h("option", { value }, title(value))));
  expression.addEventListener("change", () => render());
  const temper = h("select", { class: "select", "aria-label": "At rest" }, ...AVATAR_TEMPERAMENTS.map((value) => h("option", { value }, title(value))));
  temper.addEventListener("change", () => ((temperament = temper.value as AvatarProfile["temperament"]), (edited = true), (reset = false), render()));
  // The ten drawings, each shown as it is, by the name it was drawn as.
  const looks = h("div", { class: "avatar-looks", role: "group", "aria-label": "Which knight" });
  const choose = (next: AvatarLook) => ((look = next), (edited = true), (reset = false), render());
  function render(): void {
    replace(preview, workerAvatar({ id: options.id(), name: options.name() || "Your knight", profile: lookProfile(look, temperament), expression: expression.value as AvatarExpression, size: 120 }));
    replace(looks, ...AVATAR_LOOKS.map((each) => h("button", { type: "button", class: "avatar-look", "aria-pressed": String(each.id === look), onclick: () => choose(each.id) },
      workerAvatar({ id: options.id(), name: each.name, profile: lookProfile(each.id, temperament), still: true, size: 60 }), h("span", {}, each.name))));
    temper.value = temperament;
  }
  const element = h("fieldset", { class: "avatar-editor" }, h("legend", {}, "Avatar"),
    h("div", { class: "avatar-editor-stage" }, preview, h("div", { class: "stack" }, h("p", { class: "small muted" }, "It shows what it is doing. Preview each here without changing it."), field("Preview what it is doing", expression))),
    field("Which knight", looks),
    field("At rest", temper),
    button("Reset avatar", { variant: "ghost", size: "sm", onClick: () => { look = avatarLook(options.id(), options.name(), undefined); temperament = resolveAvatar(options.id()).temperament; reset = true; render(); } }),
  );
  render();
  return {
    element,
    value: () => (reset ? null : lookProfile(look, temperament)),
    refreshIdentity() {
      // A knight nobody chose for yet is drawn as its name says, as it is named.
      if (reset || (!edited && !options.profile)) look = avatarLook(options.id(), options.name(), undefined);
      render();
    },
  };
}
