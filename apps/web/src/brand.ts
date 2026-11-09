/*
 * Crest: Galahad's emblem, on a 1024 grid. A lodestar crowning a pyramid of
 * chevrons. The outer chevron's centre lines meet at the star's centre, so the
 * star's lower rays point straight down its legs: the star is the pyramid's
 * capstone. Inside, a full chevron and a solid core; every band ends on one
 * baseline and runs at one slope (the Great Pyramid's, 52°). One gap holds it
 * together: every star tip that faces a band stops exactly one gap short of
 * it, and the bands are one gap apart. Lit from the upper left like a real
 * pyramid. (assets/paragon-v1.svg is the first drawing it grew from.)
 *
 * Pure data and a tiny SVG tree, no DOM: the PWA turns the tree into elements
 * (ui/emblem.ts), scripts/brand.ts serialises it into the icon files, so every
 * surface draws the same mark.
 */

export type Point = readonly [number, number];

const round = (n: number): number => Math.round(n * 10) / 10;

/** The proportions. Change these, run `bun scripts/brand.ts --png`, and every surface follows. */
export const CREST = {
  /** The one gap: lower ray tip to leg, band to band, south tip to the chevron's peak. */
  gap: 26,
  /** Each band's thickness, measured across it. */
  band: 80,
  /** The pyramid's slope, in degrees from the baseline. */
  slope: 52,
  /** The star's centre (where the outer chevron's centre lines meet) and the baseline. */
  centre: 360,
  base: 830,
  /**
   * The lodestar: a north ray, east and west, short upper diagonals, lower
   * diagonals that run down the legs, heavy valleys. The south ray is set by the gap.
   */
  star: { north: 200, east: 140, diagonal: 84, lower: 124, valley: 46 },
} as const;

const CX = 512;
const CY = CREST.centre;
const RAD = Math.PI / 180;
const SLOPE = CREST.slope * RAD;
const HALF = CREST.band / 2;

/**
 * A point by the right leg's own axes: `s` runs from the star's centre down
 * the leg's centre line, `e` runs across it (positive is up and out). Side 1
 * is the right, -1 its mirror.
 */
function onLeg(s: number, e: number, side: 1 | -1): Point {
  return [round(CX + side * (s * Math.cos(SLOPE) + e * Math.sin(SLOPE))), round(CY + s * Math.sin(SLOPE) - e * Math.cos(SLOPE))];
}
/** How far down its axis an edge (at `e` across) reaches the baseline. */
const toBase = (e: number): number => (CREST.base - CY + e * Math.cos(SLOPE)) / Math.sin(SLOPE);
/** Where an edge (at `e` across) meets the centre line. */
const peak = (e: number): Point => [CX, round(CY - e / Math.cos(SLOPE))];

/** The south ray stops one gap (square to the edges) above the chevron's peak. */
export const SOUTH = round(HALF / Math.cos(SLOPE));

function lodestar(): Point[] {
  const r = CREST.star;
  const lower = 90 + CREST.slope;
  const rays: [number, number][] = [
    [0, r.north],
    [45, r.diagonal],
    [90, r.east],
    [lower, r.lower],
    [180, SOUTH],
    [360 - lower, r.lower],
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

/** A leg: the outer chevron below the star, from one gap past the lower ray's tip down to the baseline. */
function leg(side: 1 | -1): Point[] {
  const from = CREST.star.lower + CREST.gap;
  const points: Point[] = [onLeg(from, HALF, side), onLeg(toBase(HALF), HALF, side), onLeg(toBase(-HALF), -HALF, side), onLeg(from, -HALF, side)];
  return side === 1 ? points : points.reverse();
}

/** The chevron inside the legs, one gap in, ending on the baseline. */
function chevron(): Point[] {
  const top = HALF - CREST.band - CREST.gap;
  const bottom = top - CREST.band;
  return [peak(top), onLeg(toBase(top), top, 1), onLeg(toBase(bottom), bottom, 1), peak(bottom), onLeg(toBase(bottom), bottom, -1), onLeg(toBase(top), top, -1)];
}

/** The core: a solid pyramid one gap inside the chevron. */
function core(): Point[] {
  const top = HALF - 2 * (CREST.band + CREST.gap);
  return [peak(top), onLeg(toBase(top), top, 1), onLeg(toBase(top), top, -1)];
}

const CHEVRON_POINTS: readonly Point[][] = [leg(-1), leg(1), chevron(), core()];

const pathOf = (points: readonly Point[]): string => `M${points.map(([x, y]) => `${x} ${y}`).join(" ")}Z`;

/** The pyramid's shapes: the left leg, the right leg, the chevron, the core. */
export const CHEVRONS: readonly string[] = CHEVRON_POINTS.map(pathOf);

/** Where the pyramid's bands start: the legs' top corners. */
const CHEVRON_TOP = Math.min(...CHEVRON_POINTS.flat().map(([, y]) => y));

/** What the emblem covers, north tip to the baseline. */
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

/** Black ink on a light ground: the lit face in graphite, the shaded face near black. */
export const INK_ON_LIGHT: EmblemPaint = { lit: ["#3a3a3d", "#1c1c1e", "#000000"], shade: ["#1a1a1c", "#0c0c0d", "#000000"], base: "#0c0c0d" };
/** White ink on a dark ground: the lit face starts white, the shaded face is a step down into steel. */
export const INK_ON_DARK: EmblemPaint = { lit: ["#ffffff", "#f1f1f3", "#d4d4d9"], shade: ["#e2e2e6", "#cdcdd3", "#b4b4bc"], base: "#cdcdd3" };
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

  // Lit from the upper left, like a pyramid in the sun: every band's left face
  // is lit and its right face shaded, and each ray of the star has a lit and a
  // shaded side. A base under the star's facets hides the seams.
  const box = EMBLEM_BOX;
  const floor = box.y + box.height;
  const [sx, sy] = STAR_CENTER;
  const { east, lower } = CREST.star;
  const defs = n(
    "defs",
    {},
    n("clipPath", { id: `${id}-chevrons` }, ...CHEVRONS.map((d) => n("path", { d }))),
    gradient(`${id}-left`, [box.x, CHEVRON_TOP, CX, floor], ink.lit),
    gradient(`${id}-right`, [CX, CHEVRON_TOP, box.x + box.width, floor], ink.shade),
    gradient(`${id}-lit`, [sx - east, sy - east, sx + east / 2, sy + lower], ink.lit),
    gradient(`${id}-shade`, [sx, sy - east, sx + east, sy + lower], ink.shade),
  );
  const half = { y: round(CHEVRON_TOP - 1), height: round(floor - CHEVRON_TOP + 2) };
  return n(
    "g",
    {},
    defs,
    n(
      "g",
      { "clip-path": `url(#${id}-chevrons)` },
      // The left face overlaps the right by a unit so the ridge shows no seam.
      n("rect", { x: CX, ...half, width: round(box.x + box.width - CX + 1), fill: `url(#${id}-right)` }),
      n("rect", { x: round(box.x - 1), ...half, width: round(CX - box.x + 2), fill: `url(#${id}-left)` }),
    ),
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
  const emblem = placed("em", INK_ON_DARK, 0.7);
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
