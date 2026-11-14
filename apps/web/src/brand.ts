/*
 * The mark: a Templar's great helm, front on, cut like a heater shield (a flat crown, its corners cut, its sides
 * angled in to a point), drawn in lit dots: its brow band and its nasal strip are the oxblood cross, and Galahad's
 * eyes glow in the slit under the brow. It is the helm Galahad wears as a knight (ui/avatar.ts draws him from these
 * same numbers), on the same 32-cell drawing as every knight.
 *
 * Pure data and a tiny SVG tree, no DOM: the PWA turns the tree into elements (ui/emblem.ts), scripts/brand.ts
 * serialises it into the icon files, so every surface draws the same mark.
 */

export type Point = readonly [number, number];

const round = (n: number): number => Math.round(n * 10) / 10;

/** The drawing: 32 cells a side, the helm's centre line on the middle one. */
export const CELLS = 32;
const M = CELLS / 2;

/** The helm's left half, from the crown down to the point; the right is its mirror. */
const HELM_LEFT: readonly Point[] = [[M - 7.0, 2.8], [M - 10.2, 6.0], [M - 10.2, 14.6], [M - 6.4, 20.6], [M, 23.8]];
/** The helm's outline, clockwise from the crown's left corner. */
export const HELM: readonly Point[] = [...HELM_LEFT, ...HELM_LEFT.slice(0, -1).reverse().map(([x, y]) => [2 * M - x, y] as const)];
/** A box by its centre and half sizes, in cells. */
export interface Box { cx: number; cy: number; hw: number; hh: number }
/** The slits, under the brow band, either side of the nasal strip. */
export const SLITS: readonly Box[] = [{ cx: M - 4.6, cy: 12.6, hw: 3.3, hh: 1.1 }, { cx: M + 4.6, cy: 12.6, hw: 3.3, hh: 1.1 }];
/** The cross: the brow band across the helm, the nasal strip down it to the point. */
export const CROSS: readonly Box[] = [{ cx: M, cy: 10.55, hw: 8.6, hh: 0.95 }, { cx: M, cy: 13.2, hw: 1.05, hh: 10.2 }];
/** Where Galahad's eyes sit in the slits, and their size (cells). */
export const EYES: readonly Box[] = SLITS.map(({ cx, cy }) => ({ cx, cy, hw: 1.3, hh: 0.65 }));

/** The colours: black, the helm's white, the oxblood cross, the glow of his eyes. */
export const INK = { night: "#050506", helm: "#f2eee6", cross: "#b23c3d", eyes: "#fff1d6", unlit: "#16161a" } as const;

const inBox = ({ cx, cy, hw, hh }: Box, x: number, y: number, grow = 0): boolean => Math.abs(x - cx) <= hw + grow && Math.abs(y - cy) <= hh + grow;
/** Whether a point (cells) is inside the helm. */
export function inHelm(x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = HELM.length - 1; i < HELM.length; j = i++) {
    const [xi, yi] = HELM[i]!, [xj, yj] = HELM[j]!;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** What a dot at a point (cells) is: the helm's white, the cross, nothing (a slit, or off the helm). Asked of the
 * left half only, so the dots are mirror-true by construction, whatever a point on an edge would round to. */
export function dotAt(x: number, y: number): "helm" | "cross" | null {
  x = Math.min(x, 2 * M - x);
  if (!inHelm(x, y) || SLITS.some((slit) => inBox(slit, x, y, 0.45))) return null;
  return CROSS.some((bar) => inBox(bar, x, y)) ? "cross" : "helm";
}

/** The helm's bounds, in cells, and the square the mark is drawn in: the helm centred with a little air. */
export const HELM_BOX = (() => {
  const xs = HELM.map(([x]) => x), ys = HELM.map(([, y]) => y);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
})();

export interface MarkOptions {
  /** How many dots across the square. */
  grain: number;
  /** The side of the square the mark fills, in the drawing's units, and its top-left corner. */
  side: number;
  x?: number;
  y?: number;
  /** How much of the square the helm spans (its height). */
  fill?: number;
  /** One ink for everything: the cross and the slits are then gaps in it. */
  ink?: string;
  /** The square's other cells shown as dim dots, as on a dot-matrix display. */
  unlit?: boolean;
  /** His eyes in the slits (only on a dark ground). */
  eyes?: boolean;
}

/* ---------- the tree ---------- */

export interface SvgNode {
  tag: string;
  attrs: Record<string, string | number>;
  children?: SvgNode[];
}

const n = (tag: string, attrs: Record<string, string | number>, ...children: SvgNode[]): SvgNode => ({ tag, attrs, children });
const dot = (cx: number, cy: number, r: number): string => `M${round(cx - r)} ${round(cy)}a${round(r)} ${round(r)} 0 1 0 ${round(2 * r)} 0a${round(r)} ${round(r)} 0 1 0 ${round(-2 * r)} 0`;

/**
 * The mark as a group of paths: its dots sampled from the helm on a grid of `grain` dots across a square of `side`
 * units (one path per ink), the slits as dark glass with his eyes in them. A dot is as big as its cell allows; an
 * unlit one is smaller.
 */
export function emblemTree(options: MarkOptions): SvgNode {
  const { grain, side } = options;
  const ox = options.x ?? 0, oy = options.y ?? 0;
  const pitch = side / grain;
  // Cells of the drawing per unit: the helm's height fills `fill` of the square, centred.
  const scale = (HELM_BOX.height + 0.6) / (side * (options.fill ?? 0.78));
  const midX = HELM_BOX.x + HELM_BOX.width / 2, midY = HELM_BOX.y + HELM_BOX.height / 2;
  const toCells = (u: number, mid: number) => mid + (u - side / 2) * scale;
  const toUnits = (c: number, mid: number) => side / 2 + (c - mid) / scale;
  let helm = "", cross = "", unlit = "";
  for (let gy = 0; gy < grain; gy++) for (let gx = 0; gx < grain; gx++) {
    const ux = (gx + 0.5) * pitch, uy = (gy + 0.5) * pitch;
    const kind = dotAt(toCells(ux, midX), toCells(uy, midY));
    if (kind === "helm" || (kind === "cross" && options.ink)) helm += dot(ox + ux, oy + uy, pitch * 0.43);
    else if (kind === "cross") cross += dot(ox + ux, oy + uy, pitch * 0.43);
    else if (options.unlit && !inHelm(Math.min(toCells(ux, midX), 2 * M - toCells(ux, midX)), toCells(uy, midY))) unlit += dot(ox + ux, oy + uy, pitch * 0.27);
  }
  const box = ({ cx, cy, hw, hh }: Box, ink: string, extra: Record<string, string | number> = {}) =>
    n("rect", { x: round(ox + toUnits(cx - hw, midX)), y: round(oy + toUnits(cy - hh, midY)), width: round((2 * hw) / scale), height: round((2 * hh) / scale), ...extra, fill: ink });
  const children: SvgNode[] = [];
  if (unlit) children.push(n("path", { d: unlit, fill: INK.unlit }));
  children.push(n("path", { d: helm, fill: options.ink ?? INK.helm }));
  if (cross) children.push(n("path", { d: cross, fill: INK.cross }));
  if (!options.ink) children.push(...SLITS.map((slit) => box(slit, INK.night)));
  if (options.eyes && !options.ink) children.push(...EYES.map((eye) => box(eye, INK.eyes, { rx: round(eye.hh / scale) })));
  return n("g", {}, ...children);
}

/**
 * The whole helm as one filled path on a small icon grid (menus, the icon set), fitted inside `inset`: its outline,
 * the slits and the cross cut out of it (wound the other way, so they are holes under the nonzero rule).
 */
export function markOnGrid(size = 24, inset = 1.5): string {
  const scale = (size - 2 * inset) / Math.max(HELM_BOX.width, HELM_BOX.height);
  const at = ([x, y]: Point): string => `${round(size / 2 + (x - (HELM_BOX.x + HELM_BOX.width / 2)) * scale)} ${round(size / 2 + (y - (HELM_BOX.y + HELM_BOX.height / 2)) * scale)}`;
  // The outline clockwise; each hole counter-clockwise.
  const hole = ({ cx, cy, hw, hh }: Box): string => `M${at([cx - hw, cy - hh])}L${at([cx - hw, cy + hh])}L${at([cx + hw, cy + hh])}L${at([cx + hw, cy - hh])}Z`;
  const [brow, strip] = CROSS as [Box, Box];
  // The cross's two bars as one hole: the brow band, then the strip below and above it, so they never overlap.
  const below = { cx: strip.cx, hw: strip.hw, cy: (brow.cy + brow.hh + strip.cy + strip.hh) / 2, hh: (strip.cy + strip.hh - (brow.cy + brow.hh)) / 2 - 0.05 };
  return `M${HELM.map(at).join("L")}Z${hole(brow)}${hole(below)}${SLITS.map(hole).join("")}`;
}

/* ---------- icons ---------- */

const root = (viewBox: string, title: string, ...children: SvgNode[]): SvgNode =>
  n("svg", { xmlns: "http://www.w3.org/2000/svg", viewBox, fill: "none" }, n("title", {}, { tag: "#text", attrs: { text: title } }), ...children);

/** The app tile: a rounded square of night on the 1024 grid. */
export const TILE = { x: 64, y: 64, width: 896, height: 896, rx: 214 } as const;

/** The app icon: a night tile, a dot-matrix panel, the helm lit in it with his eyes. Transparent corners. */
export function appIcon(): SvgNode {
  const { x, y, width, height, rx } = TILE;
  const inner = 96;
  return root(
    "48 48 928 928",
    "Galahad",
    n("rect", { x, y, width, height, rx, fill: INK.night }),
    emblemTree({ grain: 39, side: width - 2 * inner, x: x + inner, y: y + inner, fill: 0.86, unlit: true, eyes: true }),
    n("rect", { x: x + 1, y: y + 1, width: width - 2, height: height - 2, rx: rx - 1, stroke: "#ffffff", "stroke-opacity": 0.12, "stroke-width": 2 }),
  );
}

/**
 * Full bleed for platform masks (Android adaptive icons, iOS): the helm scaled into the centre so it survives any
 * mask shape.
 */
export function maskableIcon(scale = 0.6): SvgNode {
  const side = 1024 * scale;
  return root(
    "0 0 1024 1024",
    "Galahad",
    n("rect", { width: 1024, height: 1024, fill: INK.night }),
    emblemTree({ grain: 31, side, x: (1024 - side) / 2, y: (1024 - side) / 2, fill: 0.92, eyes: true }),
  );
}

/** The flat, single-colour mark (currentColor): its dots in one ink, the cross and slits gaps in it. */
export function flatMark(): SvgNode {
  return root("0 0 1024 1024", "Galahad", emblemTree({ grain: 27, side: 1024, fill: 0.9, ink: "currentColor" }));
}

/** The mark alone on a transparent ground, its dots in white or black ink, the cross oxblood: for the website. */
export function crestFile(ink: "white" | "black"): SvgNode {
  const tree = emblemTree({ grain: 27, side: 1024, fill: 0.92 });
  // On a transparent ground the slits are gaps, not glass; the helm's dots take the page's ink.
  const children = (tree.children ?? []).filter((child) => child.tag === "path").map((child) => (child.attrs.fill === INK.helm ? { ...child, attrs: { ...child.attrs, fill: ink === "white" ? INK.helm : "#141416" } } : child));
  return root("0 0 1024 1024", "Galahad", n("g", {}, ...children));
}

const escapeAttr = (value: string | number): string => String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** Serialise a tree as SVG markup (two-space indented). */
export function toSvg(node: SvgNode, depth = 0): string {
  const pad = "  ".repeat(depth);
  if (node.tag === "#text") return escapeAttr(node.attrs.text ?? "");
  const attrs = Object.entries(node.attrs)
    .map(([k, v]) => ` ${k}="${escapeAttr(v)}"`)
    .join("");
  const kids = node.children ?? [];
  if (kids.length === 0) return `${pad}<${node.tag}${attrs}/>`;
  if (kids.length === 1 && kids[0]!.tag === "#text") return `${pad}<${node.tag}${attrs}>${toSvg(kids[0]!)}</${node.tag}>`;
  return `${pad}<${node.tag}${attrs}>\n${kids.map((k) => toSvg(k, depth + 1)).join("\n")}\n${pad}</${node.tag}>`;
}
