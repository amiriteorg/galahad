import { BOARD_H, BOARD_W, type BoardItem, type BoardStroke, type BoardView, type Chalk, CHALK_HEX, equationRuns, layoutItem, SLATE_HEX, tickLabel } from "@galahad/core/board";
import { barBase, type BoardViewport, chartGeometry, drawOrder, pressed } from "../lib/chalk.ts";

/*
 * Chalk on slate, on a 2D canvas: for the page you draw on, the picture of the
 * board the models see, and the face of the board in the world (all from the
 * same state, so they agree). Grain comes from a small noise tile used as the
 * chalk's pattern (no pass over the picture afterwards); each stroke gets a
 * thinner, drier second edge a hair off the first, so the line isn't perfect;
 * the duster rubs chalk out (destination-out), leaving a little haze. Items
 * are drawn as text only, never markup, in the system's handwriting faces (no
 * fonts are fetched). Everything is in board units under one transform.
 */

/** Handwriting faces the systems have (iOS and macOS have Chalkboard SE), then cursive. */
export const CHALK_FONT = '"Chalkboard SE", "Chalkduster", "Segoe Print", "Ink Free", "Bradley Hand", "Comic Sans MS", cursive';

type Ctx = CanvasRenderingContext2D;

/** A small seeded random, so the grain (and every picture of the board) is the same each time. */
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A string's hash, for each item's little tilt. */
const hash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

const TILE = 64;
const tiles = new Map<string, HTMLCanvasElement>();

/** A tile of chalk: the colour, its alpha speckled from `lo` to 1 (the grain). */
function tile(hex: string, lo: number): HTMLCanvasElement {
  const key = `${hex}:${lo}`;
  const have = tiles.get(key);
  if (have) return have;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = TILE;
  const g = canvas.getContext("2d")!;
  const image = g.createImageData(TILE, TILE);
  const random = mulberry(hash(key));
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const gr = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  for (let i = 0; i < TILE * TILE; i++) {
    // Mostly solid, with pits: chalk skipping over the slate's tooth.
    const v = random();
    const a = v < 0.12 ? lo * random() : lo + (1 - lo) * Math.sqrt(random());
    image.data[i * 4] = r;
    image.data[i * 4 + 1] = gr;
    image.data[i * 4 + 2] = b;
    image.data[i * 4 + 3] = Math.round(a * 255);
  }
  g.putImageData(image, 0, 0);
  tiles.set(key, canvas);
  return canvas;
}

const patterns = new WeakMap<Ctx, Map<string, CanvasPattern>>();

/** The chalk's pattern for this context, its grain kept at one tile pixel per device pixel whatever the zoom. */
function chalkStyle(g: Ctx, hex: string, lo: number, deviceScale: number): CanvasPattern | string {
  let mine = patterns.get(g);
  if (!mine) patterns.set(g, (mine = new Map()));
  const key = `${hex}:${lo}`;
  let p = mine.get(key);
  if (!p) {
    p = g.createPattern(tile(hex, lo), "repeat") ?? undefined;
    if (!p) return hex;
    mine.set(key, p);
  }
  try {
    p.setTransform(new DOMMatrix().scaleSelf(1 / deviceScale, 1 / deviceScale));
  } catch {
    /* older engines: grain scales with the zoom */
  }
  return p;
}

/** The slate: the frame's wood round it, the board's dark green-grey, and the haze of old wiping. */
export function paintSlate(g: Ctx, width: number, height: number, view: BoardViewport, dpr: number): void {
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = "#4a3a2c";
  g.fillRect(0, 0, width, height);
  g.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.x, dpr * view.y);
  g.fillStyle = SLATE_HEX;
  g.fillRect(0, 0, BOARD_W, BOARD_H);
  const random = mulberry(7);
  for (let i = 0; i < 9; i++) {
    const x = random() * BOARD_W;
    const y = random() * BOARD_H;
    const r = 180 + random() * 420;
    const haze = g.createRadialGradient(x, y, 0, x, y, r);
    haze.addColorStop(0, "rgba(220, 230, 222, 0.045)");
    haze.addColorStop(1, "rgba(220, 230, 222, 0)");
    g.fillStyle = haze;
    g.fillRect(0, 0, BOARD_W, BOARD_H);
  }
  g.fillStyle = chalkStyle(g, "#dfe6df", 0, dpr * view.scale);
  g.globalAlpha = 0.035;
  g.fillRect(0, 0, BOARD_W, BOARD_H);
  g.globalAlpha = 1;
}

/** One stroke, in board units under the current transform. */
function strokePath(g: Ctx, p: readonly number[], from = 0, to = p.length / 2 - 1): void {
  g.beginPath();
  g.moveTo(p[2 * from]!, p[2 * from + 1]!);
  if (to - from < 2) {
    g.lineTo(p[2 * to]!, p[2 * to + 1]!);
    return;
  }
  // Through the midpoints, each point a control: a smooth line through a hand's corners.
  for (let i = from + 1; i < to; i++) {
    const mx = (p[2 * i]! + p[2 * i + 2]!) / 2;
    const my = (p[2 * i + 1]! + p[2 * i + 3]!) / 2;
    g.quadraticCurveTo(p[2 * i]!, p[2 * i + 1]!, mx, my);
  }
  g.lineTo(p[2 * to]!, p[2 * to + 1]!);
}

export function paintStroke(g: Ctx, s: Pick<BoardStroke, "points" | "pressure" | "width" | "color" | "erase">, deviceScale: number): void {
  g.lineCap = "round";
  g.lineJoin = "round";
  const n = s.points.length / 2;
  if (n < 1) return;
  if (s.erase) {
    g.globalCompositeOperation = "destination-out";
    g.strokeStyle = chalkStyle(g, "#ffffff", 0.82, deviceScale);
  } else g.strokeStyle = chalkStyle(g, CHALK_HEX[s.color], 0.42, deviceScale);
  const runs: [number, number, number][] = [];
  if (s.pressure && n > 2) {
    // Runs of like width, each its own path: a pen's pressure in the line.
    let start = 0;
    let width = pressed(s.width, s.pressure[0]);
    for (let i = 1; i < n; i++) {
      const w = pressed(s.width, ((s.pressure[i - 1] ?? 0.5) + (s.pressure[i] ?? 0.5)) / 2);
      if (Math.abs(w - width) > s.width * 0.12 || i === n - 1) {
        runs.push([start, i, width]);
        start = i;
        width = w;
      }
    }
  } else runs.push([0, n - 1, s.width]);
  for (const [a, b, w] of runs) {
    g.lineWidth = w;
    strokePath(g, s.points, a, b);
    g.stroke();
  }
  if (!s.erase) {
    // The dry edge: thinner, fainter, a hair off the line.
    g.globalAlpha = 0.45;
    g.save();
    g.translate(s.width * 0.16, -s.width * 0.1);
    for (const [a, b, w] of runs) {
      g.lineWidth = Math.max(0.6, w * 0.5);
      strokePath(g, s.points, a, b);
      g.stroke();
    }
    g.restore();
    g.globalAlpha = 1;
  }
  g.globalCompositeOperation = "source-over";
}

const fontOf = (size: number, bold?: boolean) => `${bold ? "700 " : ""}${size}px ${CHALK_FONT}`;

/** A line of text at most `width` wide: squeezed if this system's hand runs wider than the layout's measure. */
function fitText(g: Ctx, text: string, x: number, y: number, width: number): void {
  if (!text) return;
  const real = g.measureText(text).width;
  if (real <= width || real === 0) g.fillText(text, x, y);
  else {
    g.save();
    g.translate(x, y);
    g.scale(width / real, 1);
    g.fillText(text, 0, 0);
    g.restore();
  }
}

export function paintItem(g: Ctx, item: BoardItem, deviceScale: number): void {
  const layout = layoutItem(item, item.w);
  g.save();
  // A hand never writes quite level.
  const tilt = (((hash(item.id) % 1000) / 1000) * 2 - 1) * 0.008;
  g.translate(item.x + item.w / 2, item.y + item.h / 2);
  g.rotate(tilt);
  g.translate(-item.w / 2, -item.h / 2);
  g.textBaseline = "alphabetic";
  const style = chalkStyle(g, CHALK_HEX[item.color], 0.4, deviceScale);
  g.fillStyle = style;
  g.strokeStyle = style;
  for (const line of layout.lines) {
    g.font = fontOf(line.size, line.bold);
    if (line.marker) g.fillText(line.marker, line.x - (line.marker.length > 1 ? 34 : 24), line.y);
    if (item.kind === "equation") paintEquation(g, line.text, line.x, line.y, line.size, line.width);
    else fitText(g, line.text, line.x, line.y, line.width);
  }
  if (item.kind === "chart" && layout.plot) paintChart(g, item, layout.plot, deviceScale);
  g.restore();
}

function paintEquation(g: Ctx, text: string, x: number, y: number, size: number, width: number): void {
  const runs = equationRuns(text).map((r) => ({ ...r, size: r.shift ? size * 0.62 : size }));
  const widths = runs.map((r) => {
    g.font = fontOf(r.size);
    return g.measureText(r.text).width;
  });
  const total = widths.reduce((a, b) => a + b, 0);
  const k = total > width && total > 0 ? width / total : 1;
  g.save();
  g.translate(x, y);
  g.scale(k, 1);
  let at = 0;
  runs.forEach((r, i) => {
    g.font = fontOf(r.size);
    g.fillText(r.text, at, r.shift > 0 ? -size * 0.4 : r.shift < 0 ? size * 0.2 : 0);
    at += widths[i]!;
  });
  g.restore();
}

function paintChart(g: Ctx, item: Extract<BoardItem, { kind: "chart" }>, plot: { x: number; y: number; w: number; h: number }, deviceScale: number): void {
  const c = chartGeometry(item, plot);
  const f = c.frame;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(f.x, f.y);
  g.lineTo(f.x, f.y + f.h);
  g.lineTo(f.x + f.w, f.y + f.h);
  g.stroke();
  g.font = fontOf(18);
  g.lineWidth = 2;
  for (const t of c.yTicks) {
    g.beginPath();
    g.moveTo(f.x - 8, t.at);
    g.lineTo(f.x, t.at);
    g.stroke();
    const label = tickLabel(t.v);
    fitText(g, label, f.x - 12 - Math.min(48, label.length * 9.5), t.at + 6, 48);
  }
  for (const t of c.xTicks) {
    g.beginPath();
    g.moveTo(t.at, f.y + f.h);
    g.lineTo(t.at, f.y + f.h + 8);
    g.stroke();
    const label = tickLabel(t.v);
    fitText(g, label, t.at - label.length * 4.5, f.y + f.h + 28, 60);
  }
  if (item.xLabel) fitText(g, item.xLabel, f.x + f.w - Math.min(f.w, item.xLabel.length * 10), plot.y + plot.h, f.w);
  if (item.yLabel) {
    g.save();
    g.translate(plot.x + 14, f.y + f.h);
    g.rotate(-Math.PI / 2);
    fitText(g, item.yLabel, 0, 0, f.h);
    g.restore();
  }
  const type = item.type ?? "line";
  const base = barBase(c);
  c.series.forEach((s, i) => {
    const style = chalkStyle(g, CHALK_HEX[s.chalk], 0.4, deviceScale);
    g.strokeStyle = style;
    g.fillStyle = style;
    if (type === "bar") {
      for (const [x, y] of s.points) g.fillRect(x - c.bar / 2, Math.min(y, base), c.bar * 0.92, Math.abs(base - y));
    } else if (type === "scatter") {
      for (const [x, y] of s.points) {
        g.beginPath();
        g.arc(x, y, 5, 0, Math.PI * 2);
        g.fill();
      }
    } else {
      g.lineWidth = 4;
      g.beginPath();
      s.points.forEach(([x, y], j) => (j ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.stroke();
    }
    if (c.series.length > 1) {
      // The legend, along the top.
      const lx = f.x + i * Math.min(170, f.w / c.series.length);
      g.fillRect(lx, plot.y + 8, 22, 6);
      g.font = fontOf(18);
      fitText(g, s.name, lx + 28, plot.y + 16, Math.min(170, f.w / c.series.length) - 34);
    }
  });
}

/**
 * The chalk (Galahad's items and the owner's strokes, in the order they were
 * put there) onto a transparent canvas, in the view. `dpr` maps CSS pixels to
 * the canvas's.
 */
export function paintChalk(g: Ctx, board: Pick<BoardView, "items" | "strokes">, view: BoardViewport, dpr: number, opts: { hide?: ReadonlySet<string> } = {}): void {
  const scale = dpr * view.scale;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, g.canvas.width, g.canvas.height);
  g.setTransform(scale, 0, 0, scale, dpr * view.x, dpr * view.y);
  for (const mark of drawOrder(board)) {
    if ("item" in mark) {
      if (!opts.hide?.has(mark.item.id)) paintItem(g, mark.item, scale);
    } else paintStroke(g, mark.stroke, scale);
  }
}

/** A palette swatch's colour, for the page's buttons. */
export const chalkColor = (c: Chalk): string => CHALK_HEX[c];

/**
 * The whole board, slate and chalk, onto `out` at its size (16:9): the picture
 * the models see, and the world's board's face. `chalk` is a scratch canvas the
 * chalk is laid on first (the duster rubs out chalk, never the slate).
 */
export function paintBoard(out: HTMLCanvasElement, chalk: HTMLCanvasElement, board: Pick<BoardView, "items" | "strokes">, opts: { hide?: ReadonlySet<string> } = {}): void {
  const view: BoardViewport = { scale: out.width / BOARD_W, x: 0, y: 0 };
  if (chalk.width !== out.width || chalk.height !== out.height) {
    chalk.width = out.width;
    chalk.height = out.height;
  }
  const g = out.getContext("2d")!;
  paintSlate(g, out.width, out.height, view, 1);
  paintChalk(chalk.getContext("2d")!, board, view, 1, opts);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(chalk, 0, 0);
}
