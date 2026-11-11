/*
 * The chalkboard Galahad and his liege share. One board of fixed aspect (16:9),
 * measured in board units: 1600 across, 900 down, the origin at the top left, y
 * down (as a canvas draws). On it, Galahad's items (text, notes, equations
 * written as text, charts of a few series) and the owner's freehand strokes in
 * chalk (and the duster's strokes that rub chalk out).
 *
 * This module is the contract's shape and its pure parts (sizes, layout, the
 * next free space, the drawing in words), with no zod: the PWA and the world's
 * renderer import it. What the node accepts is checked in board-input.ts.
 */

export const BOARD_W = 1600;
export const BOARD_H = 900;

/** The chalk box: a few colours, as they look on slate. */
export const CHALK = ["white", "yellow", "pink", "blue", "green", "orange"] as const;
export type Chalk = (typeof CHALK)[number];
export const CHALK_HEX: Record<Chalk, string> = {
  white: "#f2efe6",
  yellow: "#f4d872",
  pink: "#f2a3bd",
  blue: "#9cccef",
  green: "#a7d99c",
  orange: "#f3ad74",
};
/** The slate, and the frame round it (for renderers). */
export const SLATE_HEX = "#2f3b36";

/** Every limit the node holds the board to. */
export const BOARD_LIMITS = {
  /** Galahad's items on the board at once. */
  items: 60,
  /** The owner's strokes at once, and their points (x,y pairs) all told. */
  strokes: 1500,
  boardPoints: 60_000,
  /** Points in one stroke. */
  strokePoints: 1000,
  /** Strokes sent at once (the PWA sends on pen-up, a few at a time). */
  strokesPerDraw: 64,
  /** Ids erased in one call. */
  erasePerCall: 500,
  /** A stroke's width, board units. */
  minWidth: 1,
  maxWidth: 48,
  /** Characters. */
  text: 2000,
  note: 4000,
  equation: 300,
  title: 120,
  label: 40,
  /** A chart's series, values per series, and values all told. */
  series: 6,
  values: 400,
  chartValues: 1200,
  /** The snapshot the PWA uploads of what the owner sees: a PNG, at most this many bytes and pixels. */
  snapshotBytes: 512 * 1024,
  snapshotMinW: 160,
  snapshotMaxW: 1600,
} as const;

export const STROKE_ID = /^s_[A-Za-z0-9_-]{8,24}$/;
export const ITEM_ID = /^i_[A-Za-z0-9_-]{8,24}$/;

/** One stroke of the owner's: chalk (or the duster, `erase`), its points flat as x,y pairs in board units, and per-point pressure when the pen gave it. */
export interface BoardStroke {
  id: string;
  color: Chalk;
  width: number;
  points: number[];
  pressure?: number[];
  erase?: boolean;
  at: number;
}

export type ChartType = "line" | "bar" | "scatter";
export type TextSize = "s" | "m" | "l";

/** What Galahad writes: its content. */
export type ItemContent =
  | { kind: "text"; text: string; size?: TextSize }
  /** Markdown-ish: lines starting "# " or "## " are headings, "- " or "* " bullets, "1. " numbered. */
  | { kind: "note"; title?: string; text: string }
  /** Written as text: x^2 + y^2 = r^2, a_n, sqrt(2), ->, >=, pi. */
  | { kind: "equation"; text: string }
  /** `xValues`: the x of each value (by default 0, 1, 2…). */
  | { kind: "chart"; title?: string; type?: ChartType; series: { name: string; values: number[] }[]; xValues?: number[]; xLabel?: string; yLabel?: string };

export type ItemKind = ItemContent["kind"];

/** An item on the board: its content, who wrote it (an agent's label: "galahad", or the owner), and its box in board units. */
export type BoardItem = ItemContent & { id: string; by: string; x: number; y: number; w: number; h: number; color: Chalk; at: number };

export interface BoardSnapshotInfo {
  /** When it was taken, and the board's version it shows. */
  at: number;
  version: number;
  width: number;
  height: number;
  bytes: number;
}

/** The board as the node serves it. */
export interface BoardView {
  version: number;
  updatedAt: number;
  items: BoardItem[];
  strokes: BoardStroke[];
  snapshot: BoardSnapshotInfo | null;
}

/** What changed, as the world's stream says it: enough for a page to fetch the board again, and for the world to show him writing where the item went. */
export interface BoardChange {
  version: number;
  change: "draw" | "write" | "erase" | "clear";
  by: "owner" | "agent";
  /** Where on the board (board units), when it's one place: an item written there. */
  region: { x: number; y: number; w: number; h: number } | null;
}

export const emptyBoard = (): BoardView => ({ version: 0, updatedAt: 0, items: [], strokes: [], snapshot: null });

/* ---------------- layout: the same for the node (measuring) and every renderer (drawing) ---------------- */

/** A glyph's advance and a line's height, in ems: a hand a little narrower than most. Renderers squeeze a line to its measured width if their font runs wider. */
export const ADVANCE = 0.52;
export const LINE = 1.28;
/** The padding round an item's text, board units. */
export const PAD = 12;

export const TEXT_SIZE: Record<TextSize, number> = { s: 30, m: 40, l: 56 };
const NOTE_BODY = 28;
const NOTE_TITLE = 40;
const NOTE_H1 = 36;
const NOTE_H2 = 31;
const EQUATION = 48;
/** A chart's plot, without its title. */
export const CHART_W = 560;
export const CHART_H = 330;

/** Default widths to wrap at. */
const WRAP: Record<ItemKind, number> = { text: 720, note: 600, equation: 1200, chart: CHART_W };

export interface ChalkLine {
  text: string;
  /** Font size, board units. */
  size: number;
  /** Offsets within the item's box: the line's left and its baseline. */
  x: number;
  y: number;
  /** The width it's measured at (renderers squeeze to it). */
  width: number;
  bold?: boolean;
  /** A bullet or number, drawn hanging left of x. */
  marker?: string;
}

export interface ItemLayout {
  w: number;
  h: number;
  lines: ChalkLine[];
  /** A chart's plot area within the box. */
  plot?: { x: number; y: number; w: number; h: number };
}

const measure = (text: string, size: number): number => [...text].length * ADVANCE * size;

/** Words to lines no wider than `max` (a word longer than a line is cut). */
export function wrap(text: string, size: number, max: number): string[] {
  const out: string[] = [];
  const perLine = Math.max(1, Math.floor(max / (ADVANCE * size)));
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const raw of paragraph.split(/[ \t]+/)) {
      let word = raw;
      while ([...word].length > perLine) {
        if (line) {
          out.push(line);
          line = "";
        }
        const chars = [...word];
        out.push(chars.slice(0, perLine).join(""));
        word = chars.slice(perLine).join("");
      }
      const next = line ? `${line} ${word}` : word;
      if ([...next].length > perLine) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

/** Equations written as text, in the symbols a hand would chalk. */
export function equationText(text: string): string {
  return text
    .replace(/<=/g, "≤")
    .replace(/>=/g, "≥")
    .replace(/!=/g, "≠")
    .replace(/->/g, "→")
    .replace(/\+-/g, "±")
    .replace(/\bsqrt\b/g, "√")
    .replace(/\binf(inity)?\b/g, "∞")
    .replace(/\bpi\b/g, "π")
    .replace(/\btheta\b/g, "θ")
    .replace(/\balpha\b/g, "α")
    .replace(/\bbeta\b/g, "β")
    .replace(/\bdelta\b/g, "δ")
    .replace(/\bDelta\b/g, "Δ")
    .replace(/\bomega\b/g, "ω")
    .replace(/\bsigma\b/g, "σ")
    .replace(/\blambda\b/g, "λ")
    .replace(/\bmu\b/g, "μ")
    .replace(/(\S)\s*\*\s*(\S)/g, "$1·$2");
}

/** An equation's runs: plain, raised (after ^) or lowered (after _), a run being one character or a {group}. */
export function equationRuns(text: string): { text: string; shift: -1 | 0 | 1 }[] {
  const runs: { text: string; shift: -1 | 0 | 1 }[] = [];
  const push = (t: string, shift: -1 | 0 | 1) => {
    const last = runs.at(-1);
    if (last && last.shift === shift) last.text += t;
    else if (t) runs.push({ text: t, shift });
  };
  const chars = [...equationText(text)];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]!;
    if ((c === "^" || c === "_") && i + 1 < chars.length) {
      const shift = c === "^" ? 1 : -1;
      if (chars[i + 1] === "{") {
        const end = chars.indexOf("}", i + 2);
        if (end > 0) {
          push(chars.slice(i + 2, end).join(""), shift);
          i = end;
          continue;
        }
      }
      // A run of digits or letters after the mark, as written (x^10, a_ij).
      let j = i + 1;
      while (j < chars.length && /[\p{L}\p{N}.]/u.test(chars[j]!) && (j === i + 1 || /\p{N}/u.test(chars[i + 1]!) === /\p{N}/u.test(chars[j]!))) j++;
      if (j === i + 1) j = i + 2;
      push(chars.slice(i + 1, j).join(""), shift);
      i = j - 1;
      continue;
    }
    push(c, 0);
  }
  return runs;
}

/** How wide an equation's runs are at a size (raised and lowered runs are smaller). */
export const equationWidth = (text: string, size: number): number => equationRuns(text).reduce((w, r) => w + measure(r.text, r.shift ? size * 0.62 : size), 0);

/** A note's lines: headings, bullets, numbers, paragraphs. */
export function noteLines(text: string): { text: string; style: "h1" | "h2" | "bullet" | "number" | "body"; marker?: string }[] {
  return text.split("\n").map((raw) => {
    const line = raw.trimEnd();
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^##+\s+(.*)$/))) return { text: m[1]!, style: "h2" };
    if ((m = line.match(/^#\s+(.*)$/))) return { text: m[1]!, style: "h1" };
    if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) return { text: m[1]!, style: "bullet", marker: "•" };
    if ((m = line.match(/^\s*(\d{1,3})[.)]\s+(.*)$/))) return { text: m[2]!, style: "number", marker: `${m[1]}.` };
    return { text: line, style: "body" };
  });
}

/** An item's box and its lines, wrapped at `width` (or its kind's default). */
export function layoutItem(content: ItemContent, width?: number): ItemLayout {
  const max = Math.max(80, Math.min(BOARD_W - 2 * PAD, (width ?? WRAP[content.kind]) - 2 * PAD));
  const lines: ChalkLine[] = [];
  let y = PAD;
  let widest = 0;
  const add = (text: string, size: number, x: number, extra: Partial<ChalkLine> = {}) => {
    y += size * (LINE - 0.28);
    const w = Math.min(max - x + PAD, measure(text, size));
    lines.push({ text, size, x, y, width: w, ...extra });
    widest = Math.max(widest, x - PAD + w);
    y += size * 0.28;
  };
  switch (content.kind) {
    case "text": {
      const size = TEXT_SIZE[content.size ?? "m"];
      for (const line of wrap(content.text, size, max)) add(line, size, PAD);
      break;
    }
    case "note": {
      if (content.title) {
        for (const line of wrap(content.title, NOTE_TITLE, max)) add(line, NOTE_TITLE, PAD, { bold: true });
        y += 6;
      }
      for (const line of noteLines(content.text)) {
        const size = line.style === "h1" ? NOTE_H1 : line.style === "h2" ? NOTE_H2 : NOTE_BODY;
        const indent = line.marker ? 30 + (line.style === "number" ? 10 : 0) : 0;
        if (line.style === "h1" || line.style === "h2") y += 4;
        const wrapped = wrap(line.text, size, max - indent);
        wrapped.forEach((text, i) => add(text, size, PAD + indent, { ...(line.style === "h1" || line.style === "h2" ? { bold: true } : {}), ...(i === 0 && line.marker ? { marker: line.marker } : {}) }));
      }
      break;
    }
    case "equation": {
      const size = EQUATION;
      for (const line of content.text.split("\n")) {
        y += size * (LINE - 0.28);
        const w = Math.min(max, equationWidth(line, size));
        lines.push({ text: line, size, x: PAD, y, width: w });
        widest = Math.max(widest, w);
        y += size * 0.28;
      }
      break;
    }
    case "chart": {
      if (content.title) {
        for (const line of wrap(content.title, 32, CHART_W - 2 * PAD)) add(line, 32, PAD, { bold: true });
        y += 4;
      }
      const plot = { x: PAD, y: y + 6, w: CHART_W - 2 * PAD, h: CHART_H - 2 * PAD };
      return { w: CHART_W, h: Math.ceil(plot.y + plot.h + PAD), lines, plot };
    }
  }
  return { w: Math.ceil(Math.max(widest, 40) + 2 * PAD), h: Math.ceil(y + PAD), lines };
}

/* ---------------- a chart's axes ---------------- */

export interface ChartScale {
  min: number;
  max: number;
  /** Round values for gridlines and labels, within [min, max]. */
  ticks: number[];
}

/** Round ticks over a range: 1, 2 or 5 times a power of ten, about `count` of them. */
export function niceScale(lo: number, hi: number, count = 5, zero = false): ChartScale {
  let min = Number.isFinite(lo) ? lo : 0;
  let max = Number.isFinite(hi) ? hi : 1;
  if (zero) {
    min = Math.min(0, min);
    max = Math.max(0, max);
  }
  if (max - min < 1e-9) {
    const pad = Math.abs(max) > 1e-9 ? Math.abs(max) * 0.1 : 1;
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / Math.max(1, count);
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw * 0.999)!;
  const start = Math.floor(min / step + 1e-9) * step;
  const end = Math.ceil(max / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = start; v <= end + step * 1e-6 && ticks.length < 12; v += step) ticks.push(Math.abs(v) < step * 1e-9 ? 0 : Number(v.toPrecision(12)));
  return { min: start, max: end, ticks };
}

/** A tick's label, short: 1200 → 1.2k, 0.000034 → 3.4e-5. */
export function tickLabel(v: number): string {
  const a = Math.abs(v);
  if (a === 0) return "0";
  if (a >= 1e6 || a < 1e-3) return v.toExponential(1).replace("e+", "e");
  if (a >= 1e4) return `${Number((v / 1000).toPrecision(3))}k`;
  return String(Number(v.toPrecision(3)));
}

/* ---------------- where things are ---------------- */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A stroke's bounding box (its width included). */
export function strokeBounds(s: Pick<BoardStroke, "points" | "width">): Box {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i + 1 < s.points.length; i += 2) {
    x0 = Math.min(x0, s.points[i]!);
    x1 = Math.max(x1, s.points[i]!);
    y0 = Math.min(y0, s.points[i + 1]!);
    y1 = Math.max(y1, s.points[i + 1]!);
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 };
  const r = s.width / 2;
  return { x: x0 - r, y: y0 - r, w: x1 - x0 + 2 * r, h: y1 - y0 + 2 * r };
}

const CELL = 25;
const COLS = BOARD_W / CELL;
const ROWS = BOARD_H / CELL;
/** Room kept round a new item. */
const MARGIN = 20;

/**
 * Where a new item of w × h goes when no place is given: the first space, reading
 * the board as a page (top to bottom, left to right), clear of every item and of
 * the owner's chalk. Failing that, clear of the items alone; failing that, the
 * place it overlaps least.
 */
export function freeSpot(board: Pick<BoardView, "items" | "strokes">, w: number, h: number): { x: number; y: number } {
  const iw = Math.min(BOARD_W, w);
  const ih = Math.min(BOARD_H, h);
  const grids = (withStrokes: boolean) => {
    const used = new Uint8Array(COLS * ROWS);
    const mark = (b: Box, pad: number) => {
      const c0 = Math.max(0, Math.floor((b.x - pad) / CELL));
      const c1 = Math.min(COLS - 1, Math.floor((b.x + b.w + pad) / CELL));
      const r0 = Math.max(0, Math.floor((b.y - pad) / CELL));
      const r1 = Math.min(ROWS - 1, Math.floor((b.y + b.h + pad) / CELL));
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) used[r * COLS + c] = 1;
    };
    for (const item of board.items) mark(item, MARGIN);
    if (withStrokes) {
      for (const s of board.strokes) {
        if (s.erase) continue;
        const p = s.points;
        const pad = s.width / 2 + MARGIN;
        mark({ x: p[0]!, y: p[1]!, w: 0, h: 0 }, pad);
        // Along each segment, every half cell: a long straight stroke covers what it crosses.
        for (let i = 2; i + 1 < p.length; i += 2) {
          const steps = Math.max(1, Math.ceil(Math.hypot(p[i]! - p[i - 2]!, p[i + 1]! - p[i - 1]!) / (CELL / 2)));
          for (let k = 1; k <= steps; k++) mark({ x: p[i - 2]! + ((p[i]! - p[i - 2]!) * k) / steps, y: p[i - 1]! + ((p[i + 1]! - p[i - 1]!) * k) / steps, w: 0, h: 0 }, pad);
        }
      }
    }
    // Summed-area table: the cells used in any rectangle at once.
    const sum = new Int32Array((COLS + 1) * (ROWS + 1));
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) sum[(r + 1) * (COLS + 1) + c + 1] = used[r * COLS + c]! + sum[r * (COLS + 1) + c + 1]! + sum[(r + 1) * (COLS + 1) + c]! - sum[r * (COLS + 1) + c]!;
    return (c: number, r: number, cw: number, rh: number) => sum[(r + rh) * (COLS + 1) + c + cw]! - sum[r * (COLS + 1) + c + cw]! - sum[(r + rh) * (COLS + 1) + c]! + sum[r * (COLS + 1) + c]!;
  };
  const cw = Math.min(COLS, Math.ceil(iw / CELL));
  const rh = Math.min(ROWS, Math.ceil(ih / CELL));
  const at = (c: number, r: number) => ({ x: Math.min(BOARD_W - iw, c * CELL + (c === 0 ? MARGIN : 0)), y: Math.min(BOARD_H - ih, r * CELL + (r === 0 ? MARGIN : 0)) });
  for (const withStrokes of [true, false]) {
    const count = grids(withStrokes);
    for (let r = 0; r + rh <= ROWS; r++) for (let c = 0; c + cw <= COLS; c++) if (count(c, r, cw, rh) === 0) return at(c, r);
  }
  const count = grids(false);
  let best = { c: 0, r: 0, n: Infinity };
  for (let r = 0; r + rh <= ROWS; r++) {
    for (let c = 0; c + cw <= COLS; c++) {
      const n = count(c, r, cw, rh);
      if (n < best.n) best = { c, r, n };
    }
  }
  return at(best.c, best.r);
}

/** Overlap of two boxes, as an area. */
const overlap = (a: Box, b: Box): number => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/** Where on the board a point is, in words: "top left", "middle", "bottom right". */
export function regionName(x: number, y: number): string {
  const col = x < BOARD_W / 3 ? "left" : x < (2 * BOARD_W) / 3 ? "" : "right";
  const row = y < BOARD_H / 3 ? "top" : y < (2 * BOARD_H) / 3 ? "" : "bottom";
  return [row, col].filter(Boolean).join(" ") || "middle";
}

/** A stroke's shape, roughly: a dot, a line, a closed loop, or a scribble. */
export function strokeShape(s: Pick<BoardStroke, "points" | "width">): "dot" | "line" | "loop" | "curve" | "scribble" {
  const p = s.points;
  const n = p.length / 2;
  const b = strokeBounds(s);
  if (Math.max(b.w, b.h) < s.width * 2 + 6) return "dot";
  if (n < 3) return "line";
  let length = 0;
  for (let i = 2; i + 1 < p.length; i += 2) length += Math.hypot(p[i]! - p[i - 2]!, p[i + 1]! - p[i - 1]!);
  const ends = Math.hypot(p[p.length - 2]! - p[0]!, p[p.length - 1]! - p[1]!);
  if (length > 0 && ends / length > 0.9) return "line";
  if (ends < Math.max(b.w, b.h) * 0.2 && length > Math.max(b.w, b.h) * 2) return "loop";
  return length > (b.w + b.h) * 3 ? "scribble" : "curve";
}

/** One line about an item, for a list a model or a screen reader reads. */
export function itemSummary(item: BoardItem): string {
  const first = (t: string) => t.split("\n").find((l) => l.trim())?.trim() ?? "";
  switch (item.kind) {
    case "text":
      return first(item.text);
    case "note":
      return item.title ?? first(item.text).replace(/^#+\s*/, "");
    case "equation":
      return equationText(item.text.split("\n")[0] ?? "");
    case "chart":
      return `${item.title ? `${item.title}: ` : ""}a ${item.type ?? "line"} chart of ${item.series.map((s) => s.name).join(", ")}`;
  }
}

const round = (v: number) => Math.round(v);
const boxWords = (b: Box) => `x ${round(b.x)}–${round(b.x + b.w)}, y ${round(b.y)}–${round(b.y + b.h)}`;
const countWords = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The owner's drawing in words: how many strokes, in which colours, where on the
 * board, their shapes, and which of the items they touch. For a model that can't
 * see the picture, and for a screen reader.
 */
export function describeDrawing(board: Pick<BoardView, "items" | "strokes">): string {
  const chalk = board.strokes.filter((s) => !s.erase);
  const rubbed = board.strokes.length - chalk.length;
  if (!chalk.length) return rubbed ? `Nothing drawn: ${countWords(rubbed, "rub")} of the duster on an empty board.` : "Nothing drawn on the board.";
  const colours = new Map<Chalk, number>();
  for (const s of chalk) colours.set(s.color, (colours.get(s.color) ?? 0) + 1);
  const colourWords = [...colours].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${n} ${c}`).join(", ");
  const all = chalk.map(strokeBounds);
  const total: Box = all.reduce((acc, b) => {
    const x0 = Math.min(acc.x, b.x);
    const y0 = Math.min(acc.y, b.y);
    return { x: x0, y: y0, w: Math.max(acc.x + acc.w, b.x + b.w) - x0, h: Math.max(acc.y + acc.h, b.y + b.h) - y0 };
  });
  const regions = new Map<string, number>();
  for (const b of all) {
    const name = regionName(b.x + b.w / 2, b.y + b.h / 2);
    regions.set(name, (regions.get(name) ?? 0) + 1);
  }
  const where = [...regions].sort((a, b) => b[1] - a[1]).map(([name, n]) => `${n} in the ${name}`).join(", ");
  const lines = [
    `The owner's drawing: ${countWords(chalk.length, "stroke")} of chalk (${colourWords})${rubbed ? `, and ${countWords(rubbed, "rub")} of the duster` : ""}, within ${boxWords(total)} of the ${BOARD_W} × ${BOARD_H} board: ${where}.`,
  ];
  // The biggest strokes, each in a line.
  const biggest = chalk
    .map((s, i) => ({ s, b: all[i]! }))
    .sort((a, b) => Math.max(b.b.w, b.b.h) - Math.max(a.b.w, a.b.h))
    .slice(0, 8);
  for (const { s, b } of biggest) {
    const touches = board.items.filter((item) => overlap(b, item) > 0).map((item) => `"${itemSummary(item).slice(0, 40)}"`);
    lines.push(`- a ${s.color} ${strokeShape(s)} in the ${regionName(b.x + b.w / 2, b.y + b.h / 2)} (${boxWords(b)})${touches.length ? `, over ${touches.join(" and ")}` : ""}`);
  }
  if (chalk.length > biggest.length) lines.push(`- and ${countWords(chalk.length - biggest.length, "smaller stroke")}`);
  return lines.join("\n");
}
