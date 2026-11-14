import { AVATAR_EXPRESSIONS, AVATAR_PALETTES, resolveAvatar, withBodyColor, type AvatarExpression, type AvatarProfile } from "@galahad/core/avatar";
import { teammateInitials } from "../lib/team.ts";
import { button, field } from "./controls.ts";
import { h, replace, svg } from "./dom.ts";

/** The ways a squire can be drawn. The app draws the first; apps/web/design/avatars.html shows all three. */
export const AVATAR_STYLES = ["face", "initials", "glyph"] as const;
export type AvatarStyle = (typeof AVATAR_STYLES)[number];

const INK = "#18232b";
const LIGHT = "#fff9ed";
/* Everything is drawn on a 24-unit square with lines two units thick, so at 24 px a line is two pixels.
 * A head by the profile's form (the glyph style; a face is always round), and Galahad's own mark: a star. */
const HEADS: Record<AvatarProfile["form"], string> = {
  round: "M12 0a12 12 0 1 0 0 24a12 12 0 1 0 0-24z",
  armored: "M7 0h10a7 7 0 0 1 7 7v10a7 7 0 0 1-7 7H7a7 7 0 0 1-7-7V7a7 7 0 0 1 7-7z",
  hooded: "M12 0a12 12 0 0 1 12 12v8a4 4 0 0 1-4 4H4a4 4 0 0 1-4-4v-8A12 12 0 0 1 12 0z",
};
const STAR = "M18.5 2.5l.85 2.15 2.15.85-2.15.85-.85 2.15-.85-2.15-2.15-.85 2.15-.85z";
// (Eyes and mouths sit on whole units, so at 24 px their edges fall on pixels and stay sharp.)
const EYES = { open: "M8 9v2M16 9v2", wide: "M8 8v3M16 8v3", up: "M10 7v2M18 7v2", flat: "M7 10h2M15 10h2", glad: "M6 11q2-3 4 0M14 11q2-3 4 0", shut: "M6 9.5q2 3 4 0M14 9.5q2 3 4 0" };
const MOUTHS = { flat: "M9 16h6", busy: "M8 16h0M12 16h0M16 16h0", aside: "M13 16h3", smile: "M8 15q4 4 8 0", frown: "M8 18q4-4 8 0", small: "M11 16h2" };
/** What each expression looks like: the mouth says most of it (at work: three dots; well: a smile; trouble: a frown). */
const FACES: Record<AvatarExpression, [eyes: string, mouth: string]> = {
  idle: [EYES.open, MOUTHS.flat],
  thinking: [EYES.up, MOUTHS.aside],
  working: [EYES.open, MOUTHS.busy],
  waiting: [EYES.flat, MOUTHS.flat],
  pleased: [EYES.glad, MOUTHS.smile],
  concerned: [EYES.wide, MOUTHS.frown],
  resting: [EYES.shut, MOUTHS.small],
};
const title = (value: string) => value[0]!.toUpperCase() + value.slice(1);

export interface WorkerAvatarOptions {
  /** A squire's handle, or "galahad" for Galahad himself (a handle no squire can have). */
  id: string;
  name: string;
  profile?: unknown;
  expression?: AvatarExpression;
  size?: number;
  /** Historical messages identify a speaker, without inventing a past emotional state. */
  still?: boolean;
  style?: AvatarStyle;
}

/** Constant geometry, nothing that moves. Only validated hex colours reach SVG paint attributes;
 * names remain text and profiles can never supply tags, paths, CSS or URLs. */
export function workerAvatar(options: WorkerAvatarOptions): SVGSVGElement {
  const id = typeof options.id === "string" ? options.id : "worker";
  const profile = resolveAvatar(id, options.profile);
  const galahad = id === "galahad";
  const style = AVATAR_STYLES.includes(options.style!) ? options.style! : "face";
  const expression = !options.still && AVATAR_EXPRESSIONS.includes(options.expression!) ? options.expression! : "idle";
  const size = Number.isFinite(options.size) ? Math.max(24, Math.min(192, options.size!)) : 40;
  const name = String(options.name || "Worker").slice(0, 160);
  const luminance = [0.2126, 0.7152, 0.0722].reduce((sum, weight, index) => sum + weight * parseInt(profile.color.slice(1 + index * 2, 3 + index * 2), 16), 0);
  // Galahad is drawn in the page's own ink (index.html gives it both tones); a squire in its one flat colour.
  const ink = galahad ? "currentColor" : luminance < 90 ? LIGHT : INK;
  const [eyes, mouth] = FACES[expression];
  return svg("svg", {
    class: "worker-avatar", viewBox: "0 0 24 24", width: size, height: size, role: "img", focusable: "false",
    "aria-label": options.still ? `${name}'s avatar` : `${name} · ${expression}`,
    "data-expression": expression, ...(options.still ? { "data-still": "true" } : {}), ...(galahad ? { "data-galahad": "true" } : {}),
    ...(expression === "resting" ? { opacity: 0.6 } : {}),
  },
    svg("path", { d: HEADS[style === "glyph" ? profile.form : "round"], fill: galahad ? "currentColor" : profile.color }),
    // With letters, they stand where the eyes would be and the mouth alone says how the work goes.
    svg("path", { class: "worker-avatar-ink", d: style === "initials" ? mouth : eyes + mouth, stroke: ink, "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round", fill: "none" }),
    style === "initials" ? svg("text", { class: "worker-avatar-ink", x: 12, y: 12.4, "text-anchor": "middle", "font-size": 9, "font-weight": 700, fill: ink }, teammateInitials(name)) : null,
    galahad ? svg("path", { class: "worker-avatar-ink", d: STAR, fill: ink }) : null,
  );
}

/** An unsaved draft. The enclosing profile editor decides whether to persist it. */
export function avatarEditor(options: { id(): string; name(): string; profile?: unknown }): { element: HTMLElement; value(): AvatarProfile | null; refreshIdentity(): void } {
  let profile = resolveAvatar(options.id(), options.profile);
  let edited = false;
  let reset = false;
  const preview = h("div", { class: "avatar-editor-preview" });
  const expression = h("select", { class: "select", "aria-label": "Preview expression" }, ...AVATAR_EXPRESSIONS.map((value) => h("option", { value }, title(value))));
  expression.addEventListener("change", () => render());
  const picker = h("input", { type: "color", value: profile.color, "aria-label": "Color", class: "avatar-color-picker" });
  const hex = h("input", { class: "input mono", value: profile.color, required: true, pattern: "#[0-9a-fA-F]{6}", maxlength: 7, "aria-label": "Color hex", spellcheck: "false", autocomplete: "off" });
  const change = (next: AvatarProfile, wasReset = false) => { profile = next; edited = true; reset = wasReset; sync(); };
  // The accent a profile carries isn't drawn; it still follows the colour, as the profile's contract has it.
  const recolor = (value: string) => { if (/^#[0-9a-fA-F]{6}$/.test(value)) change(withBodyColor(profile, value)); };
  picker.addEventListener("input", () => recolor(picker.value));
  hex.addEventListener("input", () => recolor(hex.value));
  const paletteButtons = AVATAR_PALETTES.map((palette) => {
    const choice = button(palette.name, { variant: "ghost", iconOnly: true, label: `${palette.name} palette`, onClick: () => change({ ...profile, color: palette.color, accent: palette.accent }) });
    choice.classList.add("avatar-palette");
    choice.appendChild(svg("svg", { viewBox: "0 0 28 28", width: 28, height: 28, "aria-hidden": "true" }, svg("circle", { cx: 14, cy: 14, r: 12, fill: palette.color })));
    return choice;
  });
  function render(): void {
    replace(preview, workerAvatar({ id: options.id(), name: options.name() || "Your worker", profile, expression: expression.value as AvatarExpression, size: 96 }));
    paletteButtons.forEach((choice, i) => choice.setAttribute("aria-pressed", String(profile.color === AVATAR_PALETTES[i]!.color)));
  }
  function sync(): void {
    picker.value = hex.value = profile.color;
    render();
  }
  const element = h("fieldset", { class: "avatar-editor" }, h("legend", {}, "Avatar"),
    h("div", { class: "avatar-editor-stage" }, preview, h("div", { class: "stack" }, h("p", { class: "small muted" }, "Expressions follow current work. Preview an expression here without changing their status."), field("Preview expression", expression))),
    h("div", { class: "avatar-palettes", "aria-label": "Avatar palettes" }, ...paletteButtons),
    field("Color", h("div", { class: "avatar-color-field" }, picker, hex)),
    button("Reset avatar", { variant: "ghost", size: "sm", onClick: () => change(resolveAvatar(options.id()), true) }),
  );
  render();
  return {
    element,
    value: () => reset ? null : { ...profile },
    refreshIdentity() { if (reset || (!edited && !options.profile)) { profile = resolveAvatar(options.id()); sync(); } else render(); },
  };
}
