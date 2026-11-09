import { EMBLEM_BOX, emblemTree, INK_TOKENS, type SvgNode } from "../brand.ts";
import { svg } from "./dom.ts";

/*
 * Paragon, inline: the faceted emblem in theme ink (the --em-* tokens), built
 * with createElementNS from constant geometry. Each instance gets its own
 * definition ids so gradients never resolve against another copy.
 */

let instances = 0;

function build(node: SvgNode): Element {
  const el = svg(node.tag as keyof SVGElementTagNameMap, node.attrs);
  for (const child of node.children ?? []) {
    if (child.tag === "#text") el.appendChild(document.createTextNode(String(child.attrs.text ?? "")));
    else el.appendChild(build(child));
  }
  return el;
}

export interface EmblemOptions {
  size?: number;
  class?: string;
  /** Accessible name. Omit when the emblem sits beside the word "Galahad" (decorative). */
  label?: string;
}

export function emblem(options: EmblemOptions = {}): SVGSVGElement {
  const size = options.size ?? 24;
  // Square view box around the mark, with a hair of air.
  const side = Math.max(EMBLEM_BOX.width, EMBLEM_BOX.height) + 16;
  const x = EMBLEM_BOX.x + EMBLEM_BOX.width / 2 - side / 2;
  const y = EMBLEM_BOX.y + EMBLEM_BOX.height / 2 - side / 2;
  const el = svg("svg", {
    viewBox: `${x} ${y} ${side} ${side}`,
    width: size,
    height: size,
    fill: "none",
    class: options.class ? `emblem ${options.class}` : "emblem",
    focusable: "false",
    ...(options.label ? { role: "img", "aria-label": options.label } : { "aria-hidden": "true" }),
  });
  el.appendChild(build(emblemTree(`paragon-${++instances}`, INK_TOKENS)));
  return el;
}
