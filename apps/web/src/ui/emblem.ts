import { emblemTree, INK, type SvgNode } from "../brand.ts";
import { svg } from "./dom.ts";

/*
 * The mark, inline: the Templar's helm in lit dots on its own dark tile, the way every knight stands on its panel, so
 * it reads the same in a light theme as in a dark one. Built with createElementNS from constant geometry; nothing in
 * it has an id, so any number can share a page.
 */

function build(node: SvgNode): Element {
  const el = svg(node.tag as keyof SVGElementTagNameMap, node.attrs);
  for (const child of node.children ?? []) {
    if (child.tag === "#text") el.appendChild(document.createTextNode(String(child.attrs.text ?? "")));
    else el.appendChild(build(child));
  }
  return el;
}

/** How fine the dots are for a size: a small mark is sampled coarser, so its dots stay dots. */
export const markGrain = (size: number): number => size <= 24 ? 13 : size <= 40 ? 17 : size <= 80 ? 23 : 31;

export interface EmblemOptions {
  size?: number;
  class?: string;
  /** Accessible name. Omit when the emblem sits beside the word "Galahad" (decorative). */
  label?: string;
}

export function emblem(options: EmblemOptions = {}): SVGSVGElement {
  const size = options.size ?? 24;
  const el = svg("svg", {
    viewBox: "0 0 1024 1024",
    width: size,
    height: size,
    fill: "none",
    class: options.class ? `emblem ${options.class}` : "emblem",
    focusable: "false",
    ...(options.label ? { role: "img", "aria-label": options.label } : { "aria-hidden": "true" }),
  });
  el.appendChild(svg("rect", { width: 1024, height: 1024, rx: 236, fill: INK.night }));
  el.appendChild(build(emblemTree({ grain: markGrain(size), side: 1024, fill: 0.8, eyes: true })));
  return el;
}
