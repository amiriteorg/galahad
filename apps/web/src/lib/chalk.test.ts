import { describe, expect, test } from "bun:test";
import { BOARD_H, BOARD_W, type BoardItem, type BoardStroke, emptyBoard } from "@galahad/core/board";
import { chartGeometry, clampView, drawOrder, ease, finishStroke, fitView, Outbox, pinchView, pressed, readBoard, simplify, StrokeHistory, strokeId, toBoard, toScreen, withPending, zoomAt } from "./chalk.ts";

/*
 * The chalkboard page's pure parts: the view (fit, zoom, two-finger pinch), a
 * hand's points to a stroke, undo and redo, the outbox that sends on pen-up and
 * waits for the node, a chart's geometry, and the board read at the boundary.
 */

const stroke = (id: string, at = 0, more: Partial<BoardStroke> = {}): BoardStroke => ({ id, color: "white", width: 6, points: [0, 0, 10, 10], at, ...more });

describe("the view", () => {
  test("the board fits, centred, and screen and board points round-trip", () => {
    const v = fitView(1000, 1000, 0);
    expect(v.scale).toBeCloseTo(1000 / BOARD_W);
    expect(v.y).toBeCloseTo((1000 - BOARD_H * v.scale) / 2);
    const [x, y] = toScreen(v, 800, 450);
    expect(toBoard(v, x, y)).toEqual([800, 450]);
  });

  test("zooming keeps the point under the cursor where it is, within the limits", () => {
    const v = fitView(1600, 900, 0);
    const z = zoomAt(v, 2, 400, 300, { min: 0.5, max: 4 });
    expect(z.scale).toBe(2);
    expect(toBoard(z, 400, 300)).toEqual(toBoard(v, 400, 300));
    expect(zoomAt(v, 100, 0, 0, { min: 0.5, max: 4 }).scale).toBe(4);
  });

  test("two fingers: apart is closer, together is farther, and the board follows their middle", () => {
    const v = { scale: 1, x: 0, y: 0 };
    const limits = { min: 0.1, max: 10 };
    const wider = pinchView(v, [100, 100], [200, 100], [50, 100], [250, 100], limits);
    expect(wider.scale).toBeCloseTo(2);
    // The board point between the fingers stays between them.
    expect(toBoard(wider, 150, 100)).toEqual([150, 100]);
    const moved = pinchView(v, [100, 100], [200, 100], [130, 140], [230, 140], limits);
    expect(moved).toEqual({ scale: 1, x: 30, y: 40 });
  });

  test("panned however far, a quarter of the board stays on the screen", () => {
    const v = clampView({ scale: 1, x: -100_000, y: 100_000 }, 800, 600);
    expect(v.x + BOARD_W).toBeGreaterThan(0);
    expect(v.y).toBeLessThan(600);
  });
});

describe("a hand's points to chalk", () => {
  test("tremor is eased, quick movement isn't held back", () => {
    const slow = ease([0, 0], 1, 0, 1);
    const fast = ease([0, 0], 40, 0, 1);
    expect(slow[0]).toBeLessThan(1);
    expect(fast[0]).toBe(40);
  });

  test("simplified: a straight run of points is its ends; a corner stays", () => {
    const line = Array.from({ length: 50 }, (_, i) => [i, i * 0.5]).flat();
    expect(simplify(line, 0.5)).toEqual([0, 49]);
    const corner = [0, 0, 50, 0, 100, 0, 100, 50, 100, 100];
    expect(simplify(corner, 0.5)).toEqual([0, 2, 4]);
  });

  test("a finished stroke keeps a pen's pressure for the points that stay, at most the contract's points, a tap is a dot", () => {
    const raw = { points: [0, 0, 5, 0, 10, 0, 10, 10], pressure: [0.2, 0.3, 0.9, 0.5] };
    const done = finishStroke(raw, 0.5, 1000)!;
    expect(done.points).toEqual([0, 0, 10, 0, 10, 10]);
    expect(done.pressure).toEqual([0.2, 0.9, 0.5]);
    const wiggle = Array.from({ length: 3000 }, (_, i) => [i % 2 ? 0 : 40, i * 0.25]).flat();
    expect(finishStroke({ points: wiggle, pressure: null }, 0.1, 1000)!.points.length / 2).toBeLessThanOrEqual(1000);
    expect(finishStroke({ points: [5, 5], pressure: null }, 0.5, 1000)!.points.length).toBe(4);
    expect(finishStroke({ points: [], pressure: null }, 0.5, 1000)).toBeNull();
    expect(finishStroke({ points: [0.123456, 1.987654, 3, 4], pressure: null }, 0.1, 1000)!.points).toEqual([0.1, 2, 3, 4]);
  });

  test("pressure: finer for a light touch, broader for a hard one; none, as chosen", () => {
    expect(pressed(10, undefined)).toBe(10);
    expect(pressed(10, 0.1)).toBeLessThan(pressed(10, 0.9));
  });

  test("ids the node accepts, never the same twice", () => {
    const a = strokeId(crypto.getRandomValues(new Uint8Array(14)));
    const b = strokeId(crypto.getRandomValues(new Uint8Array(14)));
    expect(a).toMatch(/^s_[A-Za-z0-9_-]{14}$/);
    expect(a).not.toBe(b);
  });

  test("drawn in the order things were put there, items and strokes together (the duster takes only what came before it)", () => {
    const item = { kind: "text", text: "hi", id: "i_aaaaaaaaaa", by: "galahad", x: 0, y: 0, w: 10, h: 10, color: "white", at: 5 } as BoardItem;
    const order = drawOrder({ items: [item], strokes: [stroke("s_a", 1), stroke("s_rub", 9, { erase: true })] });
    expect(order.map((m) => ("item" in m ? m.item.id : m.stroke.id))).toEqual(["s_a", "i_aaaaaaaaaa", "s_rub"]);
  });
});

describe("undo and redo, your own strokes", () => {
  test("undo takes the last off, redo puts it back, a new stroke forgets what was undone", () => {
    const h = new StrokeHistory();
    h.drew(stroke("s_1"));
    h.drew(stroke("s_2"));
    expect(h.undo()!.id).toBe("s_2");
    expect(h.redo()!.id).toBe("s_2");
    h.undo();
    h.drew(stroke("s_3"));
    expect(h.canRedo).toBe(false);
    // Strokes cleared elsewhere can't be undone.
    h.keepOnly(new Set(["s_3"]));
    expect(h.undo()!.id).toBe("s_3");
    expect(h.undo()).toBeNull();
  });
});

describe("the outbox: on pen-up, a few at a time, waiting for the node", () => {
  test("draws go in batches, an erase on its own after them; sent ones leave", () => {
    const o = new Outbox();
    for (let i = 0; i < 5; i++) o.add({ kind: "draw", stroke: stroke(`s_${i}`) });
    o.inFlight = true;
    o.add({ kind: "erase", id: "s_0" });
    o.inFlight = false;
    expect(o.next(3)).toEqual({ draw: [stroke("s_0"), stroke("s_1"), stroke("s_2")] });
    o.sent(3);
    expect(o.next(3)).toEqual({ draw: [stroke("s_3"), stroke("s_4")] });
    o.sent(2);
    expect(o.next(3)).toEqual({ erase: ["s_0"] });
  });

  test("undoing a stroke that hasn't left yet: it never goes at all", () => {
    const o = new Outbox();
    o.add({ kind: "draw", stroke: stroke("s_1") });
    o.add({ kind: "erase", id: "s_1" });
    expect(o.waiting).toBe(0);
  });

  test("a failed send stays at the front and waits longer each time (2 s to 30 s); a refusal drops it", () => {
    const o = new Outbox();
    o.add({ kind: "draw", stroke: stroke("s_1") });
    expect([o.failed(), o.failed(), o.failed(), o.failed(), o.failed(), o.failed()]).toEqual([2000, 4000, 8000, 16_000, 30_000, 30_000]);
    expect(o.failing).toBe(true);
    expect(o.next(10)).toEqual({ draw: [stroke("s_1")] });
    o.sent(1);
    expect(o.failing).toBe(false);
    o.add({ kind: "draw", stroke: stroke("s_2") });
    o.drop(1);
    expect(o.waiting).toBe(0);
  });

  test("the page shows what's on its way in, and leaves out what's on its way out", () => {
    const board = { ...emptyBoard(), strokes: [stroke("s_a"), stroke("s_b")] };
    expect(withPending(board, [stroke("s_c"), stroke("s_a")], new Set(["s_b"])).strokes.map((s) => s.id)).toEqual(["s_a", "s_c"]);
  });
});

describe("a chart's geometry", () => {
  const chart = (more: Partial<Extract<BoardItem, { kind: "chart" }>> = {}) =>
    ({ kind: "chart", series: [{ name: "v", values: [0, 5, 10] }], id: "i_cccccccccc", by: "galahad", x: 0, y: 0, w: 560, h: 340, color: "white", at: 0, ...more }) as Extract<BoardItem, { kind: "chart" }>;
  test("values within the frame, the highest at the top, the lowest at the bottom", () => {
    const g = chartGeometry(chart(), { x: 0, y: 0, w: 500, h: 300 });
    const ys = g.series[0]!.points.map((p) => p[1]);
    expect(ys[2]!).toBeLessThan(ys[0]!);
    for (const [x, y] of g.series[0]!.points) {
      expect(x).toBeGreaterThanOrEqual(g.frame.x - 0.001);
      expect(x).toBeLessThanOrEqual(g.frame.x + g.frame.w + 0.001);
      expect(y).toBeGreaterThanOrEqual(g.frame.y - 0.001);
      expect(y).toBeLessThanOrEqual(g.frame.y + g.frame.h + 0.001);
    }
  });
  test("bars side by side in their slots, each series its own chalk", () => {
    const g = chartGeometry(chart({ type: "bar", series: [{ name: "a", values: [1, 2] }, { name: "b", values: [2, 1] }] }), { x: 0, y: 0, w: 500, h: 300 });
    expect(g.bar).toBeGreaterThan(0);
    expect(g.series[1]!.points[0]![0]).toBeGreaterThan(g.series[0]!.points[0]![0]);
    expect(g.series[0]!.chalk).not.toBe(g.series[1]!.chalk);
  });
});

describe("the board, read at the boundary", () => {
  test("what can't be drawn is left out, a kind this page doesn't know too; not a board is null", () => {
    const read = readBoard({
      version: 3,
      updatedAt: 1,
      items: [
        { kind: "text", text: "hi", id: "i_aaaaaaaaaa", by: "galahad", x: 1, y: 2, w: 3, h: 4, color: "white", at: 0 },
        { kind: "hologram", text: "from the future", id: "i_bbbbbbbbbb", by: "galahad", x: 1, y: 2, w: 3, h: 4, color: "white", at: 0 },
        { kind: "text", text: "no colour", id: "i_cccccccccc", by: "galahad", x: 1, y: 2, w: 3, h: 4, color: "#ff0000", at: 0 },
      ],
      strokes: [stroke("s_ok"), { ...stroke("s_nan"), points: [0, Number.NaN] }, { ...stroke("s_odd"), points: [1, 2, 3] }],
      snapshot: null,
    })!;
    expect(read.items.map((i) => i.id)).toEqual(["i_aaaaaaaaaa"]);
    expect(read.strokes.map((s) => s.id)).toEqual(["s_ok"]);
    expect(readBoard({ items: "x" })).toBeNull();
    expect(readBoard(null)).toBeNull();
  });
});
