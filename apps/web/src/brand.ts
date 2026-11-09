/*
 * Paragon: Galahad's emblem. An eight-point north star above ascending
 * chevrons, on a 1024 grid, with very faint faceting (assets/paragon.svg is
 * the reference drawing). Pure data and a tiny SVG tree, no DOM: the PWA turns
 * the tree into elements (ui/emblem.ts), scripts/brand.ts serialises it into
 * the icon files, so every surface draws the same mark.
 */

export type Point = readonly [number, number];

/** The star's outline, clockwise from the north point. */
export const STAR: readonly Point[] = [
  [512, 176], [531, 330], [650, 230], [544, 348], [694, 362], [544, 376], [620, 456], [531, 394],
  [512, 486], [493, 394], [404, 456], [480, 376], [330, 362], [480, 348], [374, 230], [493, 330],
];
export const STAR_CENTER: Point = [512, 362];

/** The rounded square every chevron is clipped to (and the app icon's tile). */
export const BOUNDARY = { x: 128, y: 136, width: 768, height: 736, rx: 190 } as const;

export const CHEVRONS: readonly string[] = [
  "M128 650 380 440 377 468 128 678Z M896 650 644 440 647 468 896 678Z",
  "M128 758 476 453 476 489 128 794Z M896 758 548 453 548 489 896 794Z",
  "M128 875 512 500 896 875 896 957 512 582 128 957Z",
  "M274 872 512 630 750 872 675 872 512 726 349 872Z",
];

/** What the emblem covers: star tip to the boundary's floor. */
export const EMBLEM_BOX = { x: 128, y: 176, width: 768, height: 696 } as const;

const pathOf = (points: readonly Point[]): string => `M${points.map(([x, y]) => `${x} ${y}`).join(" ")}Z`;
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
  const { x, y, width, height, rx } = BOUNDARY;
  const defs = n(
    "defs",
    {},
    n("clipPath", { id: `${id}-boundary` }, n("rect", { x, y, width, height, rx })),
    n("clipPath", { id: `${id}-chevrons` }, ...CHEVRONS.map((d) => n("path", { d }))),
  );
  if (typeof ink === "string") {
    return n(
      "g",
      fillOf(ink),
      defs,
      n("path", { d: STAR_PATH }),
      n("g", { "clip-path": `url(#${id}-boundary)` }, n("g", { "clip-path": `url(#${id}-chevrons)` }, n("rect", { x, y: 430, width, height: 550 }))),
    );
  }
  defs.children!.push(
    gradient(`${id}-left`, [128, 440, 512, 872], ink.lit),
    gradient(`${id}-right`, [512, 440, 896, 872], ink.shade),
    gradient(`${id}-lit`, [374, 176, 620, 486], ink.lit),
    gradient(`${id}-shade`, [512, 176, 694, 486], ink.shade),
  );
  return n(
    "g",
    {},
    defs,
    n(
      "g",
      { "clip-path": `url(#${id}-boundary)` },
      n(
        "g",
        { "clip-path": `url(#${id}-chevrons)` },
        // The left half overlaps the right by a unit so the apex shows no seam.
        n("rect", { x: 512, y: 430, width: 384, height: 550, fill: `url(#${id}-right)` }),
        n("rect", { x: 128, y: 430, width: 385, height: 550, fill: `url(#${id}-left)` }),
      ),
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

/** The app icon: a night tile, a breath of starlight, the emblem in white ink. Transparent corners. */
export function appIcon(): SvgNode {
  const { x, y, width, height, rx } = BOUNDARY;
  return root(
    "112 104 800 800",
    "Galahad",
    n("defs", {}, night("night", y, y + height), starlight("starlight", 512, 340, 250, 0.2)),
    n("rect", { x, y, width, height, rx, fill: "url(#night)" }),
    n("rect", { x, y, width, height, rx, fill: "url(#starlight)" }),
    emblemTree("em", INK_ON_DARK),
    n("rect", { x: x + 1, y: y + 1, width: width - 2, height: height - 2, rx: rx - 1, stroke: "#ffffff", "stroke-opacity": 0.12, "stroke-width": 2 }),
  );
}

/**
 * Full bleed for platform masks (Android adaptive icons, iOS): the emblem is
 * scaled into the centre so it survives any mask shape.
 */
export function maskableIcon(scale = 0.74): SvgNode {
  const cy = EMBLEM_BOX.y + EMBLEM_BOX.height / 2;
  const starY = 512 + (STAR_CENTER[1] - cy) * scale;
  return root(
    "0 0 1024 1024",
    "Galahad",
    n("defs", {}, night("night", 0, 1024), starlight("starlight", 512, Math.round(starY), Math.round(420 * scale), 0.2)),
    n("rect", { width: 1024, height: 1024, fill: "url(#night)" }),
    n("rect", { width: 1024, height: 1024, fill: "url(#starlight)" }),
    n("g", { transform: `translate(512 512) scale(${scale}) translate(-512 -${cy})` }, emblemTree("em", INK_ON_DARK)),
  );
}

/** The flat, single-colour mark (currentColor): for embedding wherever one ink is wanted. */
export function flatMark(): SvgNode {
  return root("112 104 800 800", "Galahad", emblemTree("mark", "currentColor"));
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
