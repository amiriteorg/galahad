/*
 * Crest: Galahad's emblem. A lodestar above two blade-cut chevrons, on a 1024
 * grid, with very faint faceting. One rhythm holds it together: the gap from
 * the star's south tip to the first apex is the gap between the chevrons.
 * (assets/paragon-v1.svg is the first drawing it grew from.)
 *
 * Pure data and a tiny SVG tree, no DOM: the PWA turns the tree into elements
 * (ui/emblem.ts), scripts/brand.ts serialises it into the icon files, so every
 * surface draws the same mark.
 */

export type Point = readonly [number, number];

const round = (n: number): number => Math.round(n * 10) / 10;

/** The proportions. Change these, run `bun scripts/brand.ts --png`, and every surface follows. */
export const CREST = {
  /** The rhythm: star tip to apex, and chevron to chevron. */
  gap: 50,
  /** Each chevron's vertical thickness. */
  band: 108,
  /** Rise over run of the chevron arms. */
  slope: 0.6,
  /** Half the chevrons' span. */
  reach: 345,
  /** The first chevron's apex. */
  apex: 500,
  /** The lodestar: a long north ray, a shorter south one, short diagonals, heavy valleys. */
  star: { north: 235, east: 192, south: 135, diagonal: 114, valley: 60 },
} as const;

const CX = 512;

function compassStar(cx: number, cy: number, r: typeof CREST.star): Point[] {
  const points: Point[] = [];
  for (let k = 0; k < 16; k++) {
    const angle = (k * Math.PI) / 8;
    const radius = k % 2 === 1 ? r.valley : k === 0 ? r.north : k === 8 ? r.south : k % 4 === 0 ? r.east : r.diagonal;
    points.push([round(cx + radius * Math.sin(angle)), round(cy - radius * Math.cos(angle))]);
  }
  return points;
}

/** An upward chevron whose arm ends are cut square to the arm, like a blade. */
function bladeChevron(apex: number): Point[] {
  const { band, slope, reach } = CREST;
  const k = band / (1 + slope * slope);
  const drop = reach * slope;
  return [
    [round(CX - reach + k * slope), round(apex + drop + k)],
    [CX - reach, round(apex + drop)],
    [CX, apex],
    [CX + reach, round(apex + drop)],
    [round(CX + reach - k * slope), round(apex + drop + k)],
    [CX, apex + band],
  ];
}

export const STAR_CENTER: Point = [CX, CREST.apex - CREST.gap - CREST.star.south];

/** The star's outline, clockwise from the north point. */
export const STAR: readonly Point[] = compassStar(STAR_CENTER[0], STAR_CENTER[1], CREST.star);

const CHEVRON_POINTS: readonly Point[][] = [bladeChevron(CREST.apex), bladeChevron(CREST.apex + CREST.band + CREST.gap)];

const pathOf = (points: readonly Point[]): string => `M${points.map(([x, y]) => `${x} ${y}`).join(" ")}Z`;

export const CHEVRONS: readonly string[] = CHEVRON_POINTS.map(pathOf);

/** What the emblem covers, star tip to the lowest blade corner. */
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

/** The north star alone, fitted to a 24px icon grid (for avatars and small marks). */
export function starOnGrid(size = 24, inset = 2.5): string {
  const xs = STAR.map(([x]) => x);
  const ys = STAR.map(([, y]) => y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const scale = (size - 2 * inset) / Math.max(maxX - minX, maxY - minY);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const round = (n: number): number => Math.round(n * 100) / 100;
  return pathOf(STAR.map(([x, y]) => [round(size / 2 + (x - cx) * scale), round(size / 2 + (y - cy) * scale)] as const));
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

/** Black ink on a light ground: the reference drawing's own values. */
export const INK_ON_LIGHT: EmblemPaint = { lit: ["#333333", "#191919", "#000000"], shade: ["#242424", "#101010", "#000000"], base: "#080808" };
/** White ink on a dark ground: lit from the star above, so the light end is white. */
export const INK_ON_DARK: EmblemPaint = { lit: ["#ffffff", "#f1f1f3", "#d4d4d9"], shade: ["#ececef", "#e2e2e6", "#d4d4d9"], base: "#d4d4d9" };
/** Theme-following ink for the PWA (the --em-* tokens in index.html). */
export const INK_TOKENS: EmblemPaint = {
  lit: ["var(--em-lit)", "var(--em-mid)", "var(--em-deep)"],
  shade: ["var(--em-shade)", "var(--em-mid-shade)", "var(--em-deep)"],
  base: "var(--em-deep)",
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
  const defs = n("defs", {}, n("clipPath", { id: `${id}-chevrons` }, ...CHEVRONS.map((d) => n("path", { d }))));

  // Light falls from the star: each chevron is a ridge (its left face lit, its
  // right face shaded) and each ray of the star has a lit and a shaded side.
  const box = EMBLEM_BOX;
  const floor = box.y + box.height;
  const [sx, sy] = STAR_CENTER;
  const { north, east, south } = CREST.star;
  defs.children!.push(
    gradient(`${id}-left`, [box.x, CREST.apex, CX, floor], ink.lit),
    gradient(`${id}-right`, [CX, CREST.apex, box.x + box.width, floor], ink.shade),
    gradient(`${id}-lit`, [sx - east, sy - north, sx + east / 2, sy + south], ink.lit),
    gradient(`${id}-shade`, [sx, sy - north, sx + east, sy + south], ink.shade),
  );
  const half = { y: CREST.apex - 1, height: round(floor - CREST.apex + 2) };
  return n(
    "g",
    {},
    defs,
    n(
      "g",
      { "clip-path": `url(#${id}-chevrons)` },
      // The left face overlaps the right by a unit so the ridge shows no seam.
      n("rect", { x: CX, ...half, width: round(box.x + box.width - CX + 1), fill: `url(#${id}-right)` }),
      n("rect", { x: box.x - 1, ...half, width: round(CX - box.x + 2), fill: `url(#${id}-left)` }),
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
