import { AVATAR_ACCESSORIES, AVATAR_EXPRESSIONS, AVATAR_EYES, AVATAR_FORMS, AVATAR_PALETTES, AVATAR_TEMPERAMENTS, resolveAvatar, withBodyColor, type AvatarExpression, type AvatarProfile } from "@galahad/core/avatar";
import { button, field } from "./controls.ts";
import { h, replace, svg } from "./dom.ts";

const INK = "#18232b";
const LIGHT = "#fff9ed";
const title = (value: string) => value[0]!.toUpperCase() + value.slice(1);
let instances = 0;
const shade = (hex: string, light: number): string => `#${[1, 3, 5].map((offset) => {
  const value = parseInt(hex.slice(offset, offset + 2), 16);
  return Math.round(light > 0 ? value + (255 - value) * light : value * (1 + light)).toString(16).padStart(2, "0");
}).join("")}`;

export interface WorkerAvatarOptions {
  id: string;
  name: string;
  profile?: unknown;
  expression?: AvatarExpression;
  size?: number;
  /** Historical messages identify a speaker, without inventing a past emotional state. */
  still?: boolean;
}

/** Original, constant geometry. Only validated hex colours reach SVG paint attributes;
 * names remain text attributes and profiles can never supply tags, paths, CSS or URLs. */
export function workerAvatar(options: WorkerAvatarOptions): SVGSVGElement {
  const id = typeof options.id === "string" ? options.id : "worker";
  const profile = resolveAvatar(id, options.profile);
  const expression = !options.still && AVATAR_EXPRESSIONS.includes(options.expression!) ? options.expression! : "idle";
  const size = Number.isFinite(options.size) ? Math.max(24, Math.min(192, options.size!)) : 40;
  const name = String(options.name || "Worker").slice(0, 160);
  const paintId = `worker-paint-${++instances}`;
  const paint = `url(#${paintId})`;
  const luminance = [0.2126, 0.7152, 0.0722].reduce((sum, weight, index) => sum + weight * parseInt(profile.color.slice(1 + index * 2, 3 + index * 2), 16), 0);
  const faceInk = luminance < 90 ? LIGHT : INK;
  const faceColor = shade(profile.color, luminance < 90 ? 0.12 : 0.46);
  // A small fixed phase bucket dephases CSS motion without timers, inline styles,
  // random seeds or display names. Renaming a worker never changes its rhythm.
  let phase = 0;
  for (let i = 0; i < id.length; i++) phase = (Math.imul(phase, 31) + id.charCodeAt(i)) >>> 0;
  const root = svg("svg", {
    class: "worker-avatar", viewBox: "0 0 80 80", width: size, height: size, fill: "none", role: "img", focusable: "false",
    "aria-label": options.still ? `${name}'s avatar` : `${name} · ${expression}`,
    "data-expression": expression, "data-temperament": profile.temperament, "data-form": profile.form, "data-phase": phase % 8,
    ...(options.still ? { "data-still": "true" } : {}),
  });
  root.appendChild(svg("defs", {}, svg("radialGradient", { id: paintId, cx: "0.28", cy: "0.2", r: "0.86" },
    svg("stop", { offset: "0", "stop-color": shade(profile.color, 0.38) }),
    svg("stop", { offset: "0.58", "stop-color": profile.color }),
    svg("stop", { offset: "1", "stop-color": shade(profile.color, -0.19) }),
  )));
  root.appendChild(svg("ellipse", { cx: 40, cy: 71, rx: 19, ry: 2.8, fill: INK, opacity: 0.12, class: "worker-avatar-shadow" }));
  const body = svg("g", { class: "worker-avatar-body" });
  root.appendChild(body);
  body.appendChild(svg("g", { fill: paint },
    svg("ellipse", { cx: 31, cy: 67.5, rx: 5.5, ry: 4.2 }), svg("ellipse", { cx: 49, cy: 67.5, rx: 5.5, ry: 4.2 }),
  ));
  body.appendChild(profile.form === "round"
    ? svg("path", { d: "M40 17C56 17 61 28 64 42C68 57 66 68 40 68C14 68 12 57 16 42C19 28 24 17 40 17Z", fill: paint })
    : profile.form === "armored"
      ? svg("path", { d: "M40 18C59 18 64 25 64 41V50C64 64 59 68 40 68C21 68 16 64 16 50V41C16 25 21 18 40 18Z", fill: paint })
      : svg("path", { d: "M40 14C49 18 59 26 62 38L66 53C69 64 59 68 40 68C21 68 11 64 14 53L18 38C21 26 31 18 40 14Z", fill: paint }));
  body.appendChild(svg("path", { d: "M22 45C19 53 20 59 26 62C22 56 23 50 25 46Z", fill: LIGHT, opacity: 0.16 }));
  body.appendChild(svg("path", { d: "M31 51Q40 53 49 51V60Q49 64 40 65Q31 64 31 60Z", fill: profile.accent, opacity: 0.86 }));
  for (const side of ["left", "right"] as const) body.appendChild(svg("g", { class: `worker-avatar-hand worker-avatar-hand-${side}` },
    svg("ellipse", { cx: side === "left" ? 19 : 61, cy: 50, rx: 5.3, ry: 7, fill: paint }),
  ));
  const head = svg("g", { class: "worker-avatar-head" });
  body.appendChild(head);
  if (profile.accessory === "plume") head.appendChild(svg("path", { d: "M37 20C34 17 29 10 34 6C39 2 46 7 45 12C40 9 38 14 42 20Z", fill: profile.accent }));
  if (profile.accessory === "ears") head.appendChild(svg("path", { d: "M24 27C16 26 12 20 14 15C16 10 26 18 29 25M51 25C54 18 64 10 66 15C68 20 64 26 56 27", fill: profile.accent }));
  if (profile.accessory === "crown") head.appendChild(svg("path", { d: "M30 22L29 17L36 20L40 14L44 20L51 17L50 22Z", stroke: profile.accent, fill: profile.accent, "stroke-width": 3, "stroke-linejoin": "round" }));
  // The face is a soft opening in the helmet, not a dark robot screen.
  const opening = profile.form === "hooded"
    ? "M40 25C48 28 55 32 55 39C55 47 50 51 40 51C30 51 25 47 25 39C25 32 32 28 40 25Z"
    : profile.form === "armored"
      ? "M29 29H51Q56 29 56 35V41Q56 51 40 51Q24 51 24 41V35Q24 29 29 29Z"
      : "M40 27C50 27 55 30 55 36V41C55 48 50 51 40 51C30 51 25 48 25 41V36C25 30 30 27 40 27Z";
  head.appendChild(svg("path", { d: opening, fill: faceColor, stroke: shade(profile.color, -0.08), "stroke-width": 1.1 }));
  head.appendChild(svg("path", { d: profile.form === "hooded" ? "M27 26Q33 20 40 18" : "M25 26Q30 20 40 20Q49 20 54 25", stroke: LIGHT, opacity: 0.32, "stroke-width": 2.2, "stroke-linecap": "round", fill: "none" }));
  const face = svg("g", { class: "worker-avatar-face" });
  const gaze = svg("g", { class: "worker-avatar-gaze" });
  const eyes = svg("g", { class: "worker-avatar-eyes", fill: faceInk, stroke: faceInk, "stroke-width": 2.4, "stroke-linecap": "round" });
  head.appendChild(face); face.appendChild(gaze); gaze.appendChild(eyes);
  const glints: string[] = [];
  for (const x of [33, 47]) {
    if (expression === "pleased") eyes.appendChild(svg("path", { d: `M${x - 3} 39Q${x} 33.8 ${x + 3} 39`, fill: "none" }));
    else if (expression === "resting") eyes.appendChild(svg("path", { d: `M${x - 3} 37Q${x} 40.5 ${x + 3} 37`, fill: "none" }));
    else {
      const cx = x + (expression === "thinking" ? 1.2 : expression === "waiting" ? -1.1 : 0);
      const cy = expression === "thinking" ? 36 : expression === "working" ? 38.3 : 38;
      const ry = expression === "working" ? 3 : expression === "waiting" ? 3.4 : profile.eyes === "round" ? 3.6 : 4.4;
      if (profile.eyes === "visor") eyes.appendChild(svg("rect", { x: cx - 3.4, y: cy - 1.6, width: 6.8, height: 3.2, rx: 1.6, stroke: "none" }));
      else eyes.appendChild(svg("ellipse", { cx, cy, rx: profile.eyes === "round" ? 3.3 : 2.9, ry: expression === "concerned" && x === 33 ? ry + 0.3 : ry, stroke: "none" }));
      const r = profile.eyes === "visor" ? 0.45 : 0.8;
      glints.push(`M${cx - 0.7 - r} ${cy - 1.1}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0`);
    }
  }
  if (glints.length) eyes.appendChild(svg("path", { d: glints.join(""), fill: faceInk === LIGHT ? INK : LIGHT, stroke: "none", opacity: faceInk === LIGHT ? 0.3 : 0.9, class: "worker-avatar-glints" }));
  if (expression === "working") gaze.appendChild(svg("path", { d: "M29 33H37V36.3Q33 35.2 29 36.3ZM43 33H51V36.3Q47 35.2 43 36.3Z", fill: faceColor }));
  const brows = expression === "concerned" ? "M29.5 31.5Q32 32 35 30.5M45 30.5Q48 32 50.5 31.5"
    : expression === "thinking" ? "M30 30.5Q33 29 35.5 30.5M45.5 32Q48 30.7 50.5 32"
      : expression === "working" ? "M30 32.5L35.5 33.5M44.5 33.5L50 32.5"
        : expression === "waiting" ? "M30 32Q33 31.5 35 32M45 31.5Q48 30 50 31" : "";
  if (brows) face.appendChild(svg("path", { d: brows, stroke: faceInk, opacity: 0.65, "stroke-width": 1.25, "stroke-linecap": "round", fill: "none" }));
  const mouth = expression === "pleased" ? "M36.8 45.5Q40 48 43.2 45.5Q42.5 49.5 40 49.5Q37.5 49.5 36.8 45.5Z"
    : expression === "concerned" ? "M37 47Q40 44.5 43 47"
      : expression === "working" ? "M38 46.5Q40 46 42 46.5"
        : expression === "waiting" ? "M37 46.5Q38.5 47.3 40 46.5"
          : expression === "resting" ? "M39 47Q40 48 41 47" : "M37.5 46Q40 48.7 42.5 46";
  face.appendChild(svg("path", { d: mouth, stroke: faceInk, "stroke-width": 1.35, "stroke-linecap": "round", fill: expression === "pleased" ? faceInk : "none", opacity: 0.8 }));
  if (expression === "pleased") face.appendChild(svg("path", { d: "M27 43a2.4 1.1 0 1 0 4.8 0a2.4 1.1 0 1 0-4.8 0M48.2 43a2.4 1.1 0 1 0 4.8 0a2.4 1.1 0 1 0-4.8 0", fill: profile.accent, opacity: 0.23 }));
  return root;
}

/** An unsaved draft. The enclosing profile editor decides whether to persist it. */
export function avatarEditor(options: { id(): string; name(): string; profile?: unknown }): { element: HTMLElement; value(): AvatarProfile | null; refreshIdentity(): void } {
  let profile = resolveAvatar(options.id(), options.profile);
  let edited = false;
  let reset = false;
  let expression: AvatarExpression = "idle";
  const preview = h("div", { class: "avatar-editor-preview" });
  const expressionInput = h("select", { class: "select", "aria-label": "Preview expression" }, ...AVATAR_EXPRESSIONS.map((value) => h("option", { value }, title(value))));
  expressionInput.addEventListener("change", () => { expression = expressionInput.value as AvatarExpression; render(); });
  const choices = <K extends "form" | "eyes" | "accessory" | "temperament">(key: K, values: readonly AvatarProfile[K][]) => {
    const select = h("select", { class: "select", "aria-label": `Avatar ${key}` }, ...values.map((value) => h("option", { value, selected: value === profile[key] }, title(value))));
    select.addEventListener("change", () => { profile = { ...profile, [key]: select.value }; edited = true; reset = false; render(); });
    return select;
  };
  const form = choices("form", AVATAR_FORMS);
  const eyes = choices("eyes", AVATAR_EYES);
  const accessory = choices("accessory", AVATAR_ACCESSORIES);
  const temperament = choices("temperament", AVATAR_TEMPERAMENTS);
  const colors = (["color", "accent"] as const).map((key) => {
    const label = key === "color" ? "Body color" : "Accent color";
    const picker = h("input", { type: "color", value: profile[key], "aria-label": label, class: "avatar-color-picker" });
    const hex = h("input", { class: "input mono", value: profile[key], required: true, pattern: "#[0-9a-fA-F]{6}", maxlength: 7, "aria-label": `${label} hex`, spellcheck: "false", autocomplete: "off" });
    const change = (value: string) => {
      if (!/^#[0-9a-fA-F]{6}$/.test(value)) return;
      // A new body color brings its own accent, unless you had chosen an accent apart from it.
      profile = key === "color" ? withBodyColor(profile, value) : { ...profile, accent: value.toLowerCase() };
      edited = true; reset = false;
      for (const color of colors) color.picker.value = color.hex.value = profile[color.key];
      render();
    };
    picker.addEventListener("input", () => change(picker.value));
    hex.addEventListener("input", () => change(hex.value));
    return { key, picker, hex, element: field(label, h("div", { class: "avatar-color-field" }, picker, hex), key === "accent" ? { hint: "Follows the body color until you choose your own." } : {}) };
  });
  const paletteButtons = AVATAR_PALETTES.map((palette) => {
    const choice = button(palette.name, { variant: "ghost", iconOnly: true, label: `${palette.name} palette`, onClick: () => { profile = { ...profile, color: palette.color, accent: palette.accent }; edited = true; reset = false; sync(); } });
    choice.classList.add("avatar-palette");
    choice.appendChild(svg("svg", { viewBox: "0 0 28 28", width: 28, height: 28, "aria-hidden": "true" }, svg("circle", { cx: 14, cy: 14, r: 12, fill: palette.color }), svg("circle", { cx: 19, cy: 19, r: 5, fill: palette.accent })));
    return choice;
  });
  function render(): void {
    replace(preview, workerAvatar({ id: options.id(), name: options.name() || "Your worker", profile, expression, size: 128 }));
    paletteButtons.forEach((choice, i) => choice.setAttribute("aria-pressed", String(profile.color === AVATAR_PALETTES[i]!.color && profile.accent === AVATAR_PALETTES[i]!.accent)));
  }
  function sync(): void {
    form.value = profile.form; eyes.value = profile.eyes; accessory.value = profile.accessory; temperament.value = profile.temperament;
    for (const color of colors) color.picker.value = color.hex.value = profile[color.key];
    render();
  }
  const element = h("fieldset", { class: "avatar-editor" }, h("legend", {}, "Avatar"),
    h("div", { class: "avatar-editor-stage" }, preview, h("div", { class: "stack" }, h("strong", {}, "A little knight, part of Galahad"), h("p", { class: "small muted" }, "Expressions follow current work. Preview an expression here without changing their status."), field("Preview expression", expressionInput))),
    h("div", { class: "team-form-grid" }, field("Shape", form), field("Eyes", eyes), field("Accessory", accessory), field("Motion", temperament, { hint: "Subtle movement; respects reduced motion." })),
    h("div", { class: "avatar-palettes", "aria-label": "Avatar palettes" }, ...paletteButtons),
    h("div", { class: "team-form-grid" }, ...colors.map((color) => color.element)),
    button("Reset avatar", { variant: "ghost", size: "sm", onClick: () => { profile = resolveAvatar(options.id()); edited = true; reset = true; sync(); } }),
  );
  render();
  return {
    element,
    value: () => reset ? null : { ...profile },
    refreshIdentity() { if (reset || (!edited && !options.profile)) { profile = resolveAvatar(options.id()); sync(); } else render(); },
  };
}
