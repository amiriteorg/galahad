/*
 * Crest: Galahad's emblem, on a 1024 grid. A lodestar flying at the head of
 * swept wings, drawn like a fighter's planform: the star is the nose, the
 * first chevron gives its peak to the star and becomes two tapered wings, the
 * second is the tail. Every edge runs at one of two sweep angles or parallel
 * to the line of flight (planform alignment), and one gap holds it together:
 * every star tip that faces a wing or the tail stops exactly one gap short of
 * it, and the wings fly one gap ahead of the tail. Ridged facets catch the
 * starlight. (assets/paragon-v1.svg is the first drawing it grew from.)
 *
 * Pure data and a tiny SVG tree, no DOM: the PWA turns the tree into elements
 * (ui/emblem.ts), scripts/brand.ts serialises it into the icon files, so every
 * surface draws the same mark.
 */

export type Point = readonly [number, number];

const round = (n: number): number => Math.round(n * 10) / 10;

/** The proportions. Change these, run `bun scripts/brand.ts --png`, and every surface follows. */
export const CREST = {
  /** The one gap: lower ray tip to wing root, wing to tail, south tip to the tail's peak. */
  gap: 30,
  /** The two sweeps, in degrees back from the span: the wings' leading edges, and every other edge. */
  sweep: { lead: 52, trail: 40 },
  /** The star's centre on the grid. */
  centre: 400,
  /** The wings: the root's top (below the star's centre) and its chord; the tips' distance from the centre line. */
  wing: { top: 52, chord: 178, span: 420 },
  /** The tail: the tips' distance from the centre line, and its chord. */
  tail: { span: 262, chord: 138 },
  /**
   * The lodestar: a long north ray (the nose), east and west, short upper
   * diagonals, lower rays aimed at the wing roots, heavy valleys. The lower
   * rays' angle and the south ray are set by the gap.
   */
  star: { north: 300, east: 150, diagonal: 96, lower: 132, valley: 54 },
} as const;

const CX = 512;
const CY = CREST.centre;
const RAD = Math.PI / 180;
const LEAD = Math.tan(CREST.sweep.lead * RAD);
const TRAIL = Math.tan(CREST.sweep.trail * RAD);

/**
 * Where the wing roots stand (their distance from the centre line). Each lower
 * ray aims at the middle of its root and stops one gap short of it, so the
 * root and the ray's angle settle together.
 */
const ROOT = (() => {
  const middle = CREST.wing.top + CREST.wing.chord / 2;
  let root = CREST.star.lower + CREST.gap;
  for (let i = 0; i < 60; i++) root = CREST.star.lower * Math.cos(Math.atan2(middle, root)) + CREST.gap;
  return root;
})();

/** The lower rays' bearing, clockwise from north. */
const LOWER_BEARING = 90 + Math.atan2(CREST.wing.top + CREST.wing.chord / 2, ROOT) / RAD;

/** The wings' leading and trailing edges, at a distance dx from the centre line. */
const leading = (dx: number): number => CY + CREST.wing.top + LEAD * (dx - ROOT);
const trailing = (dx: number): number => CY + CREST.wing.top + CREST.wing.chord + TRAIL * (dx - ROOT);
/** The tail's leading edge flies one gap (square to the edges) behind the wings' trailing edge. */
const tailLeading = (dx: number): number => trailing(0) + CREST.gap * Math.hypot(1, TRAIL) + TRAIL * dx;
const tailTrailing = (dx: number): number => tailLeading(dx) + CREST.tail.chord;

/** The south ray stops one gap (square to the tail's edges) above the tail's peak. */
export const SOUTH = round(tailLeading(0) - CY - CREST.gap / Math.cos(CREST.sweep.trail * RAD));

function lodestar(): Point[] {
  const r = CREST.star;
  const rays: [number, number][] = [
    [0, r.north],
    [45, r.diagonal],
    [90, r.east],
    [LOWER_BEARING, r.lower],
    [180, SOUTH],
    [360 - LOWER_BEARING, r.lower],
    [270, r.east],
    [315, r.diagonal],
  ];
  const points: Point[] = [];
  rays.forEach(([bearing, length], i) => {
    const next = rays[(i + 1) % rays.length]![0] + (i + 1 === rays.length ? 360 : 0);
    const valley = ((bearing + next) / 2) * RAD;
    points.push([round(CX + length * Math.sin(bearing * RAD)), round(CY - length * Math.cos(bearing * RAD))]);
    points.push([round(CX + r.valley * Math.sin(valley)), round(CY - r.valley * Math.cos(valley))]);
  });
  return points;
}

export const STAR_CENTER: Point = [CX, CY];

/** The star's outline, clockwise from the north point. */
export const STAR: readonly Point[] = lodestar();

const at = (dx: number, y: number): Point => [round(CX + dx), round(y)];
const mirrored = (points: readonly Point[]): Point[] => points.map(([x, y]) => [round(2 * CX - x), y] as Point).reverse();

/** The right wing: root and tip cut parallel to the line of flight. */
const RIGHT_WING: Point[] = [at(ROOT, leading(ROOT)), at(CREST.wing.span, leading(CREST.wing.span)), at(CREST.wing.span, trailing(CREST.wing.span)), at(ROOT, trailing(ROOT))];

/** The tail: a whole chevron, its tips cut parallel to the line of flight. */
const TAIL: Point[] = (() => {
  const s = CREST.tail.span;
  const right = [at(0, tailLeading(0)), at(s, tailLeading(s)), at(s, tailTrailing(s)), at(0, tailTrailing(0))];
  return [right[0]!, right[1]!, right[2]!, right[3]!, ...mirrored([right[1]!, right[2]!])];
})();

const CHEVRON_POINTS: readonly Point[][] = [mirrored(RIGHT_WING), RIGHT_WING, TAIL];

const pathOf = (points: readonly Point[]): string => `M${points.map(([x, y]) => `${x} ${y}`).join(" ")}Z`;

/** The chevrons' shapes: the left wing, the right wing, then the tail. */
export const CHEVRONS: readonly string[] = CHEVRON_POINTS.map(pathOf);

/**
 * The chevrons' facets: each wing and the tail is a ridge along its length,
 * the face toward the star lit and the face away from it shaded.
 */
export const CHEVRON_FACETS: readonly { d: string; lit: boolean }[] = (() => {
  const mid = (a: Point, b: Point): Point => [round((a[0] + b[0]) / 2), round((a[1] + b[1]) / 2)];
  const [r0, r1, r2, r3] = RIGHT_WING as [Point, Point, Point, Point];
  const rootMid = mid(r0, r3);
  const tipMid = mid(r1, r2);
  const upper: Point[] = [r0, r1, tipMid, rootMid];
  const lower: Point[] = [rootMid, tipMid, r2, r3];
  const s = CREST.tail.span;
  const tailMid = (dx: number): number => (tailLeading(dx) + tailTrailing(dx)) / 2;
  const tailUpper: Point[] = [at(0, tailLeading(0)), at(s, tailLeading(s)), at(s, tailMid(s)), at(0, tailMid(0)), at(-s, tailMid(s)), at(-s, tailLeading(s))];
  const tailLower: Point[] = [at(0, tailMid(0)), at(s, tailMid(s)), at(s, tailTrailing(s)), at(0, tailTrailing(0)), at(-s, tailTrailing(s)), at(-s, tailMid(s))];
  return [
    { d: pathOf(mirrored(upper)), lit: true },
    { d: pathOf(upper), lit: true },
    { d: pathOf(mirrored(lower)), lit: false },
    { d: pathOf(lower), lit: false },
    { d: pathOf(tailUpper), lit: true },
    { d: pathOf(tailLower), lit: false },
  ];
})();

/** Where the chevrons start: the wing roots' top corners. */
const CHEVRON_TOP = Math.min(...CHEVRON_POINTS.flat().map(([, y]) => y));

/** What the emblem covers, nose to the lowest tail corner. */
export const EMBLEM_BOX = (() => {
  const all = [...STAR, ...CHEVRON_POINTS.flat()];
  const xs = all.map(([x]) => x);
  const ys = all.map(([, y]) => y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: round(Math.max(...xs) - x), height: round(Math.max(...ys) - y) };
})();

export const STAR_PATH = pathOf(STAR);

/** The star's facets: a triangle from the centre to each pair of neighbouring points. Even facets are lit, odd ones shaded. */
export const STAR_FACETS: readonly string[] = STAR.map((p, i) => pathOf([STAR_CENTER, p, STAR[(i + 1) % STAR.length]!]));

/**
 * The whole mark as one filled path on a small icon grid (avatars, menus),
 * fitted inside `inset`. Same shapes as the emblem, flat.
 */
export function markOnGrid(size = 24, inset = 1.5): string {
  const { x, y, width, height } = EMBLEM_BOX;
  const scale = (size - 2 * inset) / Math.max(width, height);
  const cx = x + width / 2;
  const cy = y + height / 2;
  const fine = (n: number): number => Math.round(n * 100) / 100;
  return [STAR, ...CHEVRON_POINTS].map((shape) => pathOf(shape.map(([px, py]) => [fine(size / 2 + (px - cx) * scale), fine(size / 2 + (py - cy) * scale)] as const))).join("");
}

/* ---------- the tree ---------- */

export interface SvgNode {
  tag: string;
  attrs: Record<string, string | number>;
  children?: SvgNode[];
}

const n = (tag: string, attrs: Record<string, string | number>, ...children: SvgNode[]): SvgNode => ({ tag, attrs, children });

/**
 * How the emblem is painted: three stops (light end, middle, deep end) for the
 * lit and shaded facets, plus the base under the star's facets. A colour may
 * be a CSS custom property (var(--x)), which is applied as a style so it can
 * follow the theme.
 */
export interface EmblemPaint {
  lit: readonly [string, string, string];
  shade: readonly [string, string, string];
  base: string;
}

/** Black ink on a light ground: lit faces in graphite, shaded faces near black. */
export const INK_ON_LIGHT: EmblemPaint = { lit: ["#4a4a4e", "#26262a", "#050506"], shade: ["#141415", "#070708", "#000000"], base: "#050506" };
/** White ink on a dark ground: lit from the star above, so lit faces start white and shaded ones are steel. */
export const INK_ON_DARK: EmblemPaint = { lit: ["#ffffff", "#f1f1f3", "#d4d4d9"], shade: ["#d2d2d8", "#bcbcc3", "#a2a2ab"], base: "#bcbcc3" };
/** Theme-following ink for the PWA (the --em-* tokens in index.html). */
export const INK_TOKENS: EmblemPaint = {
  lit: ["var(--em-lit)", "var(--em-mid)", "var(--em-deep)"],
  shade: ["var(--em-shade)", "var(--em-mid-shade)", "var(--em-shade-deep)"],
  base: "var(--em-base)",
};

const paint = (color: string): Record<string, string> => (color.startsWith("var(") ? { style: `stop-color:${color}` } : { "stop-color": color });
const fillOf = (color: string): Record<string, string> => (color.startsWith("var(") ? { style: `fill:${color}` } : { fill: color });

function gradient(id: string, [x1, y1, x2, y2]: readonly [number, number, number, number], stops: readonly [string, string, string]): SvgNode {
  return n(
    "linearGradient",
    { id, gradientUnits: "userSpaceOnUse", x1, y1, x2, y2 },
    n("stop", { offset: 0, ...paint(stops[0]) }),
    n("stop", { offset: 0.5, ...paint(stops[1]) }),
    n("stop", { offset: 1, ...paint(stops[2]) }),
  );
}

/**
 * The emblem on the 1024 grid. `id` prefixes every definition so several
 * emblems can share a document. A plain colour (or "currentColor") draws it
 * flat; an EmblemPaint draws the faceted mark.
 */
export function emblemTree(id: string, ink: EmblemPaint | string): SvgNode {
  if (typeof ink === "string") return n("g", fillOf(ink), n("path", { d: STAR_PATH }), ...CHEVRONS.map((d) => n("path", { d })));

  // Light falls from the star: the wings and the tail are ridges (the face
  // toward the star lit, the face away shaded), and each ray of the star has a
  // lit and a shaded side. A base under each set of facets hides the seams.
  const floor = EMBLEM_BOX.y + EMBLEM_BOX.height;
  const [sx, sy] = STAR_CENTER;
  // The star's light spans its body, so the long north ray burns white at the tip.
  const { east, lower } = CREST.star;
  const defs = n(
    "defs",
    {},
    gradient(`${id}-upper`, [CX, CHEVRON_TOP, CX, floor], ink.lit),
    gradient(`${id}-under`, [CX, CHEVRON_TOP, CX, floor], ink.shade),
    gradient(`${id}-lit`, [sx - east, sy - east, sx + east / 2, sy + lower], ink.lit),
    gradient(`${id}-shade`, [sx, sy - east, sx + east, sy + lower], ink.shade),
  );
  return n(
    "g",
    {},
    defs,
    ...CHEVRONS.map((d) => n("path", { d, ...fillOf(ink.base) })),
    ...CHEVRON_FACETS.map(({ d, lit }) => n("path", { d, fill: `url(#${id}-${lit ? "upper" : "under"})` })),
    n("path", { d: STAR_PATH, ...fillOf(ink.base) }),
    ...STAR_FACETS.map((d, i) => n("path", { d, fill: `url(#${id}-${i % 2 === 0 ? "lit" : "shade"})` })),
  );
}

/* ---------- icons ---------- */

const NIGHT = ["#1e1e21", "#050506"] as const;

function night(id: string, y1: number, y2: number): SvgNode {
  return n("linearGradient", { id, x1: 0, y1, x2: 0, y2, gradientUnits: "userSpaceOnUse" }, n("stop", { offset: 0, "stop-color": NIGHT[0] }), n("stop", { offset: 1, "stop-color": NIGHT[1] }));
}

function starlight(id: string, cx: number, cy: number, r: number, opacity: number): SvgNode {
  return n(
    "radialGradient",
    { id, cx, cy, r, gradientUnits: "userSpaceOnUse" },
    n("stop", { offset: 0, "stop-color": "#ffffff", "stop-opacity": opacity }),
    n("stop", { offset: 1, "stop-color": "#ffffff", "stop-opacity": 0 }),
  );
}

const root = (viewBox: string, title: string, ...children: SvgNode[]): SvgNode =>
  n("svg", { xmlns: "http://www.w3.org/2000/svg", viewBox, fill: "none" }, n("title", {}, { tag: "#text", attrs: { text: title } }), ...children);

/** The emblem scaled about its centre and placed at (cx, cy) on the 1024 grid. */
function placed(id: string, ink: EmblemPaint | string, scale: number, cx = 512, cy = 512): { node: SvgNode; starY: number } {
  const ex = EMBLEM_BOX.x + EMBLEM_BOX.width / 2;
  const ey = EMBLEM_BOX.y + EMBLEM_BOX.height / 2;
  return {
    node: n("g", { transform: `translate(${cx} ${cy}) scale(${scale}) translate(${-ex} ${-ey})` }, emblemTree(id, ink)),
    starY: round(cy + (STAR_CENTER[1] - ey) * scale),
  };
}

/** The app tile: a rounded square of night on the 1024 grid. */
export const TILE = { x: 64, y: 64, width: 896, height: 896, rx: 214 } as const;

/** The app icon: a night tile, a breath of starlight, the emblem in white ink. Transparent corners. */
export function appIcon(): SvgNode {
  const { x, y, width, height, rx } = TILE;
  const emblem = placed("em", INK_ON_DARK, 0.66);
  return root(
    "48 48 928 928",
    "Galahad",
    n("defs", {}, night("night", y, y + height), starlight("starlight", 512, emblem.starY, 300, 0.2)),
    n("rect", { x, y, width, height, rx, fill: "url(#night)" }),
    n("rect", { x, y, width, height, rx, fill: "url(#starlight)" }),
    emblem.node,
    n("rect", { x: x + 1, y: y + 1, width: width - 2, height: height - 2, rx: rx - 1, stroke: "#ffffff", "stroke-opacity": 0.12, "stroke-width": 2 }),
  );
}

/**
 * Full bleed for platform masks (Android adaptive icons, iOS): the emblem is
 * scaled into the centre so it survives any mask shape.
 */
export function maskableIcon(scale = 0.6): SvgNode {
  const emblem = placed("em", INK_ON_DARK, scale);
  return root(
    "0 0 1024 1024",
    "Galahad",
    n("defs", {}, night("night", 0, 1024), starlight("starlight", 512, emblem.starY, round(560 * scale), 0.2)),
    n("rect", { width: 1024, height: 1024, fill: "url(#night)" }),
    n("rect", { width: 1024, height: 1024, fill: "url(#starlight)" }),
    emblem.node,
  );
}

/** The flat, single-colour mark (currentColor): for embedding wherever one ink is wanted. */
export function flatMark(): SvgNode {
  const pad = 24;
  const { x, y, width, height } = EMBLEM_BOX;
  return root(`${round(x - pad)} ${round(y - pad)} ${round(width + 2 * pad)} ${round(height + 2 * pad)}`, "Galahad", emblemTree("mark", "currentColor"));
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
