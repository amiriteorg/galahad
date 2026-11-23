import { orbPalette, orbParts, orbTone, type OrbInk, type OrbPalette, type OrbPart, type OrbStop, type OrbTone } from "../lib/orb.ts";
import { h, svg } from "./dom.ts";

/*
 * Galahad as an orb (your word, 23 November 2026: "a Jarvis … like visual, the orb graphic", the one you talk to): the
 * parts lib/orb.ts gives, drawn as SVG, in the colour of his state (lib/now.ts's tone). The Apple and Android apps draw
 * the same parts. It never moves (your word of 18 November 2026: no spinning or pulsing state): a new state is a new
 * colour, drawn anew. Drawn from fixed shapes; nothing in it comes from a name, a profile or a model.
 */

export type { OrbTone };

export interface OrbOptions {
  /** Its width and height in CSS pixels (16 to 320; 36 when left out). */
  size?: number;
  tone?: OrbTone;
  /** Its accessible name ("Galahad: at work"). Leave it out beside the word "Galahad": the orb is then decorative. */
  label?: string;
}

let drawn = 0;

export function orb(options: OrbOptions = {}): HTMLElement {
  const size = Number.isFinite(options.size) ? Math.round(Math.max(16, Math.min(320, options.size!))) : 36;
  const tone = orbTone(options.tone);
  const palette = orbPalette(tone);
  // Each orb's gradients have names of their own: two on one page (his line, the welcome) never share one.
  const id = `orb-${++drawn}`;
  const defs: SVGElement[] = [];
  const shapes = orbParts(size).map((part, n) => shape(part, `${id}-${n}`, palette, defs));
  return h(
    "span",
    {
      class: "orb",
      "data-tone": tone,
      style: `--orb-size:${size}px`,
      ...(options.label ? { role: "img", "aria-label": options.label } : { "aria-hidden": "true" }),
    },
    svg("svg", { viewBox: "-100 -100 200 200", focusable: "false" }, svg("defs", {}, ...defs), ...shapes),
  );
}

/** One part as SVG; a gradient it fills or strokes with goes into `defs`, named `id`. */
function shape(part: OrbPart, id: string, palette: OrbPalette, defs: SVGElement[]): SVGElement {
  const ink = (name: OrbInk): string => (name === "white" ? "#ffffff" : palette[name]);
  const stops = (list: readonly OrbStop[]) => list.map((s) => svg("stop", { offset: String(s.at), "stop-color": ink(s.ink), "stop-opacity": String(s.opacity) }));
  const named = { class: `orb-${part.name}` };
  switch (part.kind) {
    case "disc":
      defs.push(svg("radialGradient", { id, cx: String(part.cx), cy: String(part.cy), r: String(part.spread) }, ...stops(part.stops)));
      return svg("circle", { ...named, r: String(part.r), fill: `url(#${id})` });
    case "ring": {
      const stroke = { ...named, fill: "none", stroke: ink(part.ink), "stroke-width": String(part.width), opacity: String(part.opacity) };
      if (!part.arcs) return svg("circle", { ...stroke, r: String(part.r) });
      return svg("path", { ...stroke, d: part.arcs.map(([from, to]) => `M${point(part.r, from)}A${part.r} ${part.r} 0 ${to - from > 180 ? 1 : 0} 1 ${point(part.r, to)}`).join("") });
    }
    case "ticks": {
      const d = Array.from({ length: part.count }, (_, i) => part.offset + (360 * i) / part.count)
        .map((angle) => `M${point(part.r - part.length / 2, angle)}L${point(part.r + part.length / 2, angle)}`)
        .join("");
      return svg("path", { ...named, d, fill: "none", stroke: ink(part.ink), "stroke-width": String(part.width), opacity: String(part.opacity) });
    }
    case "rim":
      defs.push(svg("linearGradient", { id, gradientUnits: "userSpaceOnUse", x1: String(part.from[0]), y1: String(part.from[1]), x2: String(part.to[0]), y2: String(part.to[1]) }, ...stops(part.stops)));
      return svg("circle", { ...named, r: String(part.r), fill: "none", stroke: `url(#${id})`, "stroke-width": String(part.width) });
    case "shine":
      return svg("ellipse", { ...named, cx: String(part.cx), cy: String(part.cy), rx: String(part.rx), ry: String(part.ry), fill: "#ffffff", opacity: String(part.opacity), transform: `rotate(${part.rotate} ${part.cx} ${part.cy})` });
  }
}

/** The point `r` from the middle at `angle` degrees clockwise from the top, as SVG takes it ("x y", y down). */
function point(r: number, angle: number): string {
  const radians = (angle * Math.PI) / 180;
  const round = (n: number) => String(Math.round(n * 1000) / 1000);
  return `${round(r * Math.sin(radians))} ${round(-r * Math.cos(radians))}`;
}
