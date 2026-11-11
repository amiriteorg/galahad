import { describe, expect, test } from "bun:test";
import {
  BOARD_H,
  BOARD_LIMITS,
  BOARD_W,
  BoardDrawInput,
  BoardEraseInput,
  type BoardItem,
  type BoardStroke,
  BoardWriteInput,
  describeDrawing,
  equationRuns,
  equationText,
  freeSpot,
  layoutItem,
  niceScale,
  noteLines,
  stationForTool,
  strokeShape,
  tickLabel,
  wrap,
} from "../src/index.ts";

/*
 * The chalkboard's contract: every field bounded, agents' text cleaned, and the
 * pure parts (layout, the next free space, the drawing in words) that the node
 * and every renderer share.
 */

const stroke = (id: string, points: number[], more: Partial<BoardStroke> = {}): BoardStroke => ({ id, color: "white", width: 6, points, at: 0, ...more });
const item = (x: number, y: number, w: number, h: number, more: Partial<BoardItem> = {}): BoardItem =>
  ({ kind: "text", text: "hello", id: "i_aaaaaaaaaaaa", by: "galahad", x, y, w, h, color: "white", at: 0, ...more }) as BoardItem;

describe("what the node takes", () => {
  test("a stroke: its id, a palette colour, a width in range, x,y pairs on the board, one pressure per point", () => {
    const ok = { id: "s_abcdefghij", color: "yellow", width: 6, points: [10, 10, 20, 30] };
    expect(BoardDrawInput.safeParse({ strokes: [ok] }).success).toBe(true);
    expect(BoardDrawInput.safeParse({ strokes: [{ ...ok, pressure: [0.2, 0.9] }] }).success).toBe(true);
    for (const bad of [
      { ...ok, id: "x" },
      { ...ok, color: "#ff0000" },
      { ...ok, width: 0 },
      { ...ok, width: 400 },
      { ...ok, points: [10, 10, 20] },
      { ...ok, points: [10, 10, 99_999, 10] },
      { ...ok, points: [10, 10, 20, 5000] },
      { ...ok, points: [10, Number.NaN] },
      { ...ok, pressure: [0.5] },
      { ...ok, pressure: [0.5, 2] },
      { ...ok, extra: true },
    ]) {
      expect(BoardDrawInput.safeParse({ strokes: [bad] }).success).toBe(false);
    }
  });

  test("bounded: strokes per request, points per stroke, the snapshot's size", () => {
    const one = { id: "s_abcdefghij", color: "white", width: 4, points: [1, 1, 2, 2] };
    expect(BoardDrawInput.safeParse({ strokes: Array.from({ length: BOARD_LIMITS.strokesPerDraw + 1 }, (_, i) => ({ ...one, id: `s_${String(i).padStart(10, "0")}` })) }).success).toBe(false);
    expect(BoardDrawInput.safeParse({ strokes: [{ ...one, points: Array(BOARD_LIMITS.strokePoints * 2 + 2).fill(5) }] }).success).toBe(false);
    expect(BoardDrawInput.safeParse({ strokes: [], snapshot: "A".repeat(Math.ceil((BOARD_LIMITS.snapshotBytes * 4) / 3) + 8) }).success).toBe(false);
    expect(BoardDrawInput.safeParse({ strokes: [], snapshot: "not base64!" }).success).toBe(false);
  });

  test("an item: each kind with its limits; a chart's series and values bounded, its x values one per value", () => {
    const ok = (item: unknown) => BoardWriteInput.safeParse({ item }).success;
    expect(ok({ kind: "text", text: "Hello", size: "l" })).toBe(true);
    expect(ok({ kind: "note", title: "Plan", text: "# One\n- a\n- b" })).toBe(true);
    expect(ok({ kind: "equation", text: "x^2 + y^2 = r^2" })).toBe(true);
    expect(ok({ kind: "chart", series: [{ name: "v", values: [1, 2, 3] }], xValues: [0, 1, 2] })).toBe(true);
    expect(ok({ kind: "text", text: "   " })).toBe(false);
    expect(ok({ kind: "text", text: "x".repeat(BOARD_LIMITS.text + 1) })).toBe(false);
    expect(ok({ kind: "equation", text: "x".repeat(BOARD_LIMITS.equation + 1) })).toBe(false);
    expect(ok({ kind: "chart", series: [] })).toBe(false);
    expect(ok({ kind: "chart", series: Array.from({ length: 7 }, () => ({ name: "s", values: [1] })) })).toBe(false);
    expect(ok({ kind: "chart", series: Array.from({ length: 4 }, () => ({ name: "s", values: Array(350).fill(1) })) })).toBe(false);
    expect(ok({ kind: "chart", series: [{ name: "v", values: [1, 2, 3] }], xValues: [0, 1] })).toBe(false);
    expect(ok({ kind: "chart", series: [{ name: "v", values: [1, Number.POSITIVE_INFINITY] }] })).toBe(false);
    expect(ok({ kind: "html", text: "<b>hi</b>" })).toBe(false);
    expect(BoardWriteInput.safeParse({ item: { kind: "text", text: "a" }, x: BOARD_W + 1 }).success).toBe(false);
  });

  test("an agent's text is cleaned: no control characters, no bidirectional overrides; markup stays text", () => {
    const parsed = BoardWriteInput.parse({ item: { kind: "text", text: "pay \u202Eexe.txt\u202C now\u0007\u009b31m\r\nok <script>" } });
    // C1's CSI (U+009B) goes too: a terminal (galahad board) would read it as an escape.
    expect(parsed.item.kind === "text" && parsed.item.text).toBe("pay exe.txt now31m\nok <script>");
  });

  test("erasing names at least one stroke or item, by id", () => {
    expect(BoardEraseInput.safeParse({}).success).toBe(false);
    expect(BoardEraseInput.safeParse({ items: ["i_abcdefghij"] }).success).toBe(true);
    expect(BoardEraseInput.safeParse({ strokes: ["../../etc"] }).success).toBe(false);
  });

  test("the board's tools send him to the observatory", () => {
    for (const name of ["board_write", "board_read", "board_erase"]) expect(stationForTool(name)).toBe("observatory");
  });
});

describe("layout", () => {
  test("text wraps at its width, a word longer than a line is cut, paragraphs stay", () => {
    expect(wrap("the quick brown fox", 20, 120)).toEqual(["the quick", "brown fox"]);
    expect(wrap("abcdefghijklmnop", 20, 104)).toEqual(["abcdefghij", "klmnop"]);
    expect(wrap("one\ntwo", 20, 400)).toEqual(["one", "two"]);
  });

  test("an item's box holds its lines, within the board", () => {
    const short = layoutItem({ kind: "text", text: "Hi" });
    const long = layoutItem({ kind: "text", text: "A good deal more to say, over several lines of chalk, than fits on one." });
    expect(long.h).toBeGreaterThan(short.h);
    expect(long.w).toBeLessThanOrEqual(720);
    for (const l of long.lines) expect(l.x + l.width).toBeLessThanOrEqual(long.w);
    const chart = layoutItem({ kind: "chart", title: "Speed", series: [{ name: "v", values: [1, 2] }] });
    expect(chart.plot!.y + chart.plot!.h).toBeLessThanOrEqual(chart.h);
    const huge = layoutItem({ kind: "text", text: "word ".repeat(400) }, BOARD_W);
    expect(huge.w).toBeLessThanOrEqual(BOARD_W);
  });

  test("a note's headings, bullets and numbers", () => {
    expect(noteLines("# Plan\n## Then\n- a\n2. b\nplain").map((l) => [l.style, l.text, l.marker])).toEqual([
      ["h1", "Plan", undefined],
      ["h2", "Then", undefined],
      ["bullet", "a", "•"],
      ["number", "b", "2."],
      ["body", "plain", undefined],
    ]);
  });

  test("equations in chalk's symbols, with raised and lowered runs", () => {
    expect(equationText("a >= b -> c != d, 2 * pi")).toBe("a ≥ b → c ≠ d, 2·π");
    expect(equationText("T = 2 * pi * sqrt(L / g)")).toBe("T = 2·π·√(L / g)");
    expect(equationRuns("x^2 + a_n = y^{10}")).toEqual([
      { text: "x", shift: 0 },
      { text: "2", shift: 1 },
      { text: " + a", shift: 0 },
      { text: "n", shift: -1 },
      { text: " = y", shift: 0 },
      { text: "10", shift: 1 },
    ]);
  });

  test("a chart's axes take round ticks, and their labels stay short", () => {
    expect(niceScale(0.3, 9.6).ticks).toEqual([0, 2, 4, 6, 8, 10]);
    expect(niceScale(5, 5).ticks.length).toBeGreaterThan(1);
    expect(niceScale(3, 8, 4, true).min).toBe(0);
    expect([tickLabel(1200), tickLabel(25_000), tickLabel(0.5), tickLabel(3.4e-5)]).toEqual(["1200", "25k", "0.5", "3.4e-5"]);
  });
});

describe("the next free space", () => {
  test("reads the board as a page: the top left first, then beside, then below what's there", () => {
    expect(freeSpot({ items: [], strokes: [] }, 300, 100)).toEqual({ x: 20, y: 20 });
    const beside = freeSpot({ items: [item(20, 20, 300, 100)], strokes: [] }, 300, 100);
    expect(beside.y).toBe(20);
    expect(beside.x).toBeGreaterThanOrEqual(340);
  });

  test("keeps clear of the owner's chalk, and when nothing's clear of it, of the items at least", () => {
    const scribble = stroke("s_aaaaaaaaaa", [0, 0, 800, 0, 800, 400, 0, 400]);
    const spot = freeSpot({ items: [], strokes: [scribble] }, 300, 100);
    expect(spot.x >= 800 || spot.y >= 400).toBe(true);
    // A board covered in chalk: the items' rule alone.
    const covered = Array.from({ length: 19 }, (_, i) => stroke(`s_${String(i).padStart(10, "0")}`, [0, i * 50, BOARD_W, i * 50], { width: 48 }));
    expect(freeSpot({ items: [], strokes: covered }, 300, 100)).toEqual({ x: 20, y: 20 });
  });

  test("on a full board, the place it overlaps least, and always on the board", () => {
    const full = Array.from({ length: 4 }, (_, i) => item(0, i * 225, BOARD_W, 220));
    const spot = freeSpot({ items: full, strokes: [] }, 400, 200);
    expect(spot.x).toBeGreaterThanOrEqual(0);
    expect(spot.y + 200).toBeLessThanOrEqual(BOARD_H);
  });
});

describe("the drawing in words", () => {
  test("nothing, then the strokes: how many, their colours, where, their shapes, what they're over", () => {
    expect(describeDrawing({ items: [], strokes: [] })).toBe("Nothing drawn on the board.");
    const loop = stroke("s_loop000000", [100, 100, 300, 100, 300, 300, 100, 300, 102, 104], { color: "yellow" });
    const line = stroke("s_line000000", [900, 700, 1500, 720]);
    const rub = stroke("s_rub0000000", [10, 10, 20, 20], { erase: true });
    const text = describeDrawing({ items: [item(150, 150, 200, 80, { text: "Results" } as Partial<BoardItem>)], strokes: [loop, line, rub] });
    expect(text).toContain("2 strokes of chalk (1 yellow, 1 white), and 1 rub of the duster");
    expect(text).toContain("a yellow loop in the top left");
    expect(text).toContain('over "Results"');
    expect(text).toContain("a white line in the bottom right");
    expect(strokeShape(stroke("s_dot0000000", [5, 5, 6, 6]))).toBe("dot");
  });
});
