import { AVATAR_EXPRESSIONS, isOrbProfile, KNIGHT_TINT_NAMES, KNIGHT_TINTS, knightColors, type AvatarExpression, type OrbProfile } from "@galahad/core/avatar";
import { type KnightState, STATES } from "../lib/knight-state.ts";
import { orbToneOfState } from "../lib/orb.ts";
import { orbMoodOfExpression, orbMoodOfState } from "../lib/orb-motion.ts";
import { button, dot } from "./controls.ts";
import { h, replace } from "./dom.ts";
import { knightFace, orb, seatLights } from "./orb.ts";

/*
 * A knight as an orb (your word, 25 November 2026: "drop the knight avatars, and just use custom/procedurally generated
 * colored particle orbs"): a sphere of points of light in a colour of its own, the one you chose for it or its
 * handle's, turning as its work goes (ui/orb.ts' knightFace, lib/orb-sphere.ts). Where it sits at a list or a board,
 * its seat is a ring of its state's colour round it, with its state's lights moving round the ring (seat()). Galahad
 * himself is his orb. A speaker in a conversation's history is drawn still, and nothing moves when the device asks for
 * reduced motion. Nothing from a profile reaches a URL, a style or a paint but a colour checked to be six hex digits.
 */

/** How a face is put on the page, and the colour picker's swatches: given to the page once, by the first drawn. */
export const KNIGHT_CSS = `
.worker-avatar { position: relative; display: inline-grid; place-items: center; flex: none; }
.knight-orb { position: relative; display: block; flex: none; width: var(--orb-size, 40px); height: var(--orb-size, 40px); }
.knight-orb > svg, .knight-orb > canvas { display: block; width: 100%; height: 100%; }
.orb-editor-stage { display: flex; align-items: center; gap: var(--sp-4, 16px); }
.orb-swatches { display: grid; grid-template-columns: repeat(auto-fill, minmax(34px, 1fr)); gap: 6px; }
.orb-swatch { width: 30px; height: 30px; margin: 2px; padding: 0; border: 0; border-radius: 50%; background: var(--swatch); cursor: pointer; box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.14); }
.orb-swatch:focus-visible { outline: 2px solid var(--focus, currentColor); outline-offset: 2px; }
.orb-swatch[aria-pressed="true"] { box-shadow: 0 0 0 2px var(--bg, #000), 0 0 0 4px var(--accent, currentColor); }
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
  /** Its saved avatar: a colour you chose for it (core's OrbProfile); anything else is its handle's colour. */
  profile?: unknown;
  /** What it is doing (core's avatarExpression): its orb moves as that does. */
  expression?: AvatarExpression;
  size?: number;
  /** Historical messages identify a speaker, without inventing a past state: drawn still. */
  still?: boolean;
}

const sized = (size: number | undefined, fallback = 40): number => (Number.isFinite(size) ? Math.round(Math.max(16, Math.min(256, size!))) : fallback);

/** A knight's face, alone (beside its words, in a header, in a pick list): its orb, moving as its work does. */
export function workerAvatar(options: WorkerAvatarOptions): HTMLElement {
  ensureStyles();
  const id = typeof options.id === "string" ? options.id : "knight";
  const size = sized(options.size);
  const name = String(options.name || "Knight").slice(0, 160);
  const expression = !options.still && AVATAR_EXPRESSIONS.includes(options.expression!) ? options.expression! : "idle";
  const mood = options.still ? undefined : orbMoodOfExpression(expression);
  const label = options.still ? `${name}'s orb` : `${name} · ${expression}`;
  if (id === "galahad") return h("span", { class: "worker-avatar", "data-galahad": "true" }, orb({ size, label, mood, key: "galahad:face" }));
  return h("span", { class: "worker-avatar", "data-expression": expression }, knightFace({ id, profile: options.profile, size, mood, label, key: `face:${id}` }));
}

/** What a seat leaves round its face for its ring, by its size (the stylesheet's --seat-pad), and how wide its ring is
 * when it says a state (the stylesheet's --ring-w; a hairline at rest). */
const SEAT_PAD = { s: 4, m: 7, l: 9 } as const;
const RING_W = { s: 2, m: 2.5, l: 3 } as const;

/**
 * A knight in its seat: its orb in a ring of its state's colour (lib/knight-state.ts). Round the ring its state's lights
 * move (ui/orb.ts' seatLights; your word, 24 November 2026: "pulsing/moving when doing a task, sitting idle, waiting,
 * done"): a light runs round it at work, it beats and sends out waves while it needs you, it bursts when work is done,
 * and its motes run down when work failed. Its orb turns on the same course, so face and ring move as one. Its size
 * follows the face's: `seat-s` for a row's, `seat-m` for a card's, `seat-l` for a portrait. Galahad himself is his orb
 * (your word, 23 November 2026) in the room a face and its ring take, its colour and its motion where he stands, as the
 * ring's would be. A seat drawn `still` (a conversation's history) moves nothing.
 */
export function seat(options: WorkerAvatarOptions & { state?: KnightState }): HTMLElement {
  ensureStyles();
  const size = sized(options.size);
  const scale = size <= 48 ? "s" : size <= 96 ? "m" : "l";
  const state = options.state ?? "resting";
  const box = size + 2 * SEAT_PAD[scale];
  const mood = options.still ? undefined : orbMoodOfState(state);
  const name = String(options.name || "Knight").slice(0, 160);
  if (options.id === "galahad") {
    // (His seat's orb is its own: the Roundtable's word on where he stands can be a moment behind his chat's.)
    return h("span", { class: `seat seat-${scale} seat-orb`, "data-state": state }, orb({ size: box, tone: orbToneOfState(state), label: "Galahad", mood, key: "galahad:seat" }));
  }
  const id = String(options.id);
  const lights = mood ? seatLights({ box, ring: state === "resting" ? 1 : RING_W[scale], state, key: id }) : null;
  const words = STATES[state]?.words;
  const label = options.still ? `${name}'s orb` : words ? `${name} · ${words}` : name;
  return h("span", { class: `seat seat-${scale}`, "data-state": state }, h("span", { class: "worker-avatar" }, knightFace({ id, profile: options.profile, size, mood, label, key: `seat:${id}` })), lights);
}

/** A knight's state in words, beside its name (a badge in the state's tone; working has a live dot, so it isn't read as
 * a quiet state). Null at rest: its line says what it is for. */
export function stateChip(state: KnightState | undefined): HTMLElement | null {
  const look = STATES[state ?? "resting"];
  if (!look.words) return null;
  return h("span", { class: "badge state-chip", "data-tone": look.tone }, state === "working" ? dot("work", { live: true }) : null, look.words);
}

/** The mark of the one who leads the Roundtable, beside its name: small, in ink, in words. */
export const leadMark = (name?: string): HTMLElement =>
  h("span", { class: "lead-mark", title: name && name !== "Galahad" ? `${name} leads the Roundtable: what you say to a room ${name} sits in without naming anyone is its to answer` : "Leads the Roundtable" }, "Leads");

/**
 * A knight's colour, as you choose it: its orb as it will be, and the 24 colours to choose from, or the one its handle
 * gives it. An unsaved draft: the form it is in decides whether to save it. Its value: the colour you chose (an
 * OrbProfile), null to let it go back to its handle's, or undefined when nothing was touched (what is saved stays).
 */
export function avatarEditor(options: { id(): string; name(): string; profile?: unknown }): { element: HTMLElement; value(): OrbProfile | null | undefined; refreshIdentity(): void } {
  ensureStyles();
  let chosen: string | null = isOrbProfile(options.profile) ? options.profile.color.toLowerCase() : null;
  let touched = false;
  const preview = h("div", { class: "orb-editor-preview" });
  const note = h("p", { class: "small muted" });
  const swatches = h("div", { class: "orb-swatches", role: "group", "aria-label": "Its colour" });
  const choose = (color: string | null) => ((chosen = color), (touched = true), render());
  function render(): void {
    const id = options.id() || "knight";
    const colors = knightColors(id, chosen ? { v: 2, color: chosen } : undefined);
    replace(preview, workerAvatar({ id, name: options.name() || "Your knight", profile: chosen ? { v: 2, color: chosen } : undefined, expression: "idle", size: 96 }));
    replace(note, chosen ? "The colour you chose." : `Its handle gives it ${KNIGHT_TINT_NAMES[KNIGHT_TINTS.indexOf(colors.tint as never)] ?? "this colour"}: change its handle and its colour comes with it, until you choose one.`);
    replace(swatches, ...KNIGHT_TINTS.map((tint, n) =>
      h("button", { type: "button", class: "orb-swatch", style: `--swatch:${tint}`, title: KNIGHT_TINT_NAMES[n], "aria-label": KNIGHT_TINT_NAMES[n], "aria-pressed": String(chosen === tint), onclick: () => choose(tint) })));
  }
  const element = h(
    "fieldset",
    { class: "avatar-editor" },
    h("legend", {}, "Colour"),
    h("div", { class: "orb-editor-stage" }, preview, h("div", { class: "stack" }, note, button("Its handle's colour", { variant: "ghost", size: "sm", onClick: () => choose(null) }))),
    swatches,
  );
  render();
  return {
    element,
    value: () => (!touched ? undefined : chosen ? { v: 2, color: chosen } : null),
    refreshIdentity: () => render(),
  };
}
