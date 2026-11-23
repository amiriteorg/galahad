import { h, svg } from "./dom.ts";

/*
 * Galahad as an orb (your word, 23 November 2026: "a Jarvis … like visual, the orb graphic", the one you talk to): a
 * sphere of light in the colour of his state (lib/now.ts's tone: blue at work, amber when something waits on you,
 * green for an answer new to you, red for a failure, a calm blue at rest), inside the still rings of a heads-up
 * display. It never moves (your word of 18 November 2026: no spinning or pulsing state): a new state is a new colour.
 * Drawn from fixed shapes; nothing in it comes from a name, a profile or a model.
 */

export type OrbTone = "neutral" | "accent" | "warn" | "ok" | "danger";
const TONES: readonly OrbTone[] = ["neutral", "accent", "warn", "ok", "danger"];

export interface OrbOptions {
  /** Its width and height in CSS pixels (16 to 320; 36 when left out). */
  size?: number;
  tone?: OrbTone;
  /** Its accessible name ("Galahad: at work"). Leave it out beside the word "Galahad": the orb is then decorative. */
  label?: string;
}

/** Below this size the rings and the halo can't be told apart: the sphere alone, with one ring. */
const FULL_FROM = 64;

let drawn = 0;

export function orb(options: OrbOptions = {}): HTMLElement {
  const size = Number.isFinite(options.size) ? Math.round(Math.max(16, Math.min(320, options.size!))) : 36;
  const tone: OrbTone = TONES.includes(options.tone as OrbTone) ? options.tone! : "neutral";
  // Each orb's gradients have names of their own: two on one page (his line, the welcome) never share one.
  const id = `orb-${++drawn}`;
  const stop = (offset: string, color: string, opacity = 1) => svg("stop", { offset, style: `stop-color:${color};stop-opacity:${opacity}` });
  const full = size >= FULL_FROM;
  return h(
    "span",
    {
      class: "orb",
      "data-tone": tone,
      style: `--orb-size:${size}px`,
      ...(options.label ? { role: "img", "aria-label": options.label } : { "aria-hidden": "true" }),
    },
    svg(
      "svg",
      { viewBox: "-100 -100 200 200", focusable: "false" },
      svg(
        "defs",
        {},
        svg("radialGradient", { id: `${id}-halo` }, stop("0%", "var(--orb)", 0.5), stop("55%", "var(--orb)", 0.14), stop("100%", "var(--orb)", 0)),
        svg(
          "radialGradient",
          { id: `${id}-body`, cx: "0.4", cy: "0.36", r: "0.72" },
          stop("0%", "#ffffff", 0.96),
          stop("24%", "color-mix(in oklab, var(--orb) 45%, #ffffff)"),
          stop("64%", "var(--orb)"),
          stop("100%", "color-mix(in oklab, var(--orb) 52%, #000000)"),
        ),
        svg("radialGradient", { id: `${id}-core` }, stop("0%", "#ffffff", 0.85), stop("100%", "#ffffff", 0)),
      ),
      full ? svg("circle", { class: "orb-halo", r: "99", fill: `url(#${id}-halo)` }) : null,
      full ? svg("circle", { class: "orb-ring", r: "91" }) : null,
      full ? svg("circle", { class: "orb-ticks", r: "82" }) : null,
      svg("circle", { class: full ? "orb-ring orb-faint" : "orb-ring", r: full ? "73" : "94" }),
      svg("circle", { class: "orb-body", r: full ? "60" : "78", fill: `url(#${id}-body)` }),
      svg("circle", { class: "orb-core", r: full ? "24" : "30", fill: `url(#${id}-core)` }),
      svg("ellipse", { class: "orb-shine", cx: full ? "-21" : "-27", cy: full ? "-27" : "-34", rx: full ? "19" : "24", ry: full ? "10" : "13", transform: full ? "rotate(-28 -21 -27)" : "rotate(-28 -27 -34)" }),
    ),
  );
}
