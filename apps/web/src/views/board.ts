import { BOARD_LIMITS, type BoardItem, type BoardStroke, type BoardView, type Chalk, CHALK, describeDrawing, emptyBoard, equationText, itemSummary, noteLines } from "@galahad/core/board";
import { ApiError, isNetworkError } from "../api.ts";
import { type Ctx, errorMessage, type View } from "../context.ts";
import {
  type BoardViewport,
  clampView,
  ease,
  finishStroke,
  fitView,
  Outbox,
  pinchView,
  pressed,
  readBoard,
  StrokeHistory,
  strokeId,
  toBoard,
  withPending,
  zoomAt,
  zoomLimits,
} from "../lib/chalk.ts";
import { chalkColor, paintBoard, paintChalk, paintSlate, paintStroke } from "../ui/chalk.ts";
import { button, callout, segmented } from "../ui/controls.ts";
import { confirmAction, openSheet } from "../ui/dialog.ts";
import { h, isTyping, replace, type Scope } from "../ui/dom.ts";
import { toast } from "../ui/toast.ts";

/*
 * The chalkboard you share with Galahad: you draw (a finger, a pen with its
 * pressure, the mouse), he writes (text, notes, equations, charts), live, on
 * the same board. Its own page (#/board) and a sheet over the SANDBOX (full
 * screen on a phone). One finger (or the pen, or the mouse) draws; two fingers
 * move and zoom the view and never draw; once a pen has touched it, a finger
 * only moves the view (a resting palm draws nothing). Strokes are smoothed as
 * they come and sent on pen-up, a few at a time; one that can't reach the node
 * says so and goes when it's back. A picture of the board follows a moment
 * after you stop, for the models that can see. Undo and redo are yours, this
 * visit. Galahad's writing is a list for screen readers, and the drawing has a
 * description.
 */

/** Board versions as they're announced (the world's stream says when the board changes). */
export interface BoardFeed {
  subscribe(fn: (version: number) => void): () => void;
}

const COLOR_NAME: Record<Chalk, string> = { white: "White", yellow: "Yellow", pink: "Pink", blue: "Blue", green: "Green", orange: "Orange" };
const WIDTHS = { fine: 4, medium: 8, bold: 16 } as const;
type Width = keyof typeof WIDTHS;
/** The duster is broader than the chalk. */
const DUSTER = 3.2;
/** The picture for the models: this size, or smaller if it won't fit the node's limit. */
const SNAPSHOT_SIZES = [1280, 960, 640] as const;
const SNAPSHOT_AFTER_MS = 1500;

/** The board's own page. */
export const boardView: View = (root, ctx, { scope }) => {
  const board = createBoard(ctx, scope, { feed: worldFeed(ctx, scope) });
  replace(
    root,
    h(
      "div",
      { class: "page full board-page" },
      h(
        "header",
        { class: "page-head board-head" },
        h("div", { class: "grow" }, h("h1", {}, "Chalkboard"), h("p", { class: "lede" }, "Yours and Galahad's: draw on it, and he writes on it as he works.")),
      ),
      board.el,
    ),
  );
};

/** Over the SANDBOX: a sheet, full screen on a phone; the world's own stream says when the board changes. */
export function openBoardSheet(ctx: Ctx, feed: BoardFeed): void {
  const sheet = openSheet({ title: "Chalkboard", description: "Yours and Galahad's. Two fingers move the view.", size: "full" });
  const board = createBoard(ctx, sheet.scope, { feed });
  sheet.body.classList.add("board-sheet-body");
  sheet.body.append(board.el);
  board.focus();
}

/** The world's stream, for the board's changes only (the page's own, when the SANDBOX isn't open). Reconnects. */
function worldFeed(ctx: Ctx, scope: Scope): BoardFeed {
  const subs = new Set<(version: number) => void>();
  void (async () => {
    let wait = 2000;
    while (!scope.disposed) {
      try {
        for await (const raw of ctx.api.stream("/api/world", scope.signal)) {
          wait = 2000;
          const e = raw as { type?: unknown; version?: unknown; board?: { version?: unknown } };
          const version = e.type === "board" ? e.version : e.type === "hello" ? e.board?.version : undefined;
          if (typeof version === "number" && Number.isFinite(version)) for (const fn of subs) fn(version);
        }
      } catch {
        /* the node is away: try again */
      }
      if (scope.disposed) return;
      await new Promise((resolve) => setTimeout(resolve, wait));
      wait = Math.min(30_000, wait * 2);
    }
  })();
  return {
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

interface Pointer {
  x: number;
  y: number;
  type: string;
}

function createBoard(ctx: Ctx, scope: Scope, opts: { feed: BoardFeed }): { el: HTMLElement; focus(): void } {
  const canDraw = ctx.can("chat");
  const canClear = ctx.can("fleet:admin");
  let remote: BoardView = emptyBoard();
  let loaded = false;
  const outbox = new Outbox();
  const history = new StrokeHistory();
  let color: Chalk = "white";
  let width: Width = "medium";
  let duster = false;

  // ---------- layout ----------
  const swatches = CHALK.map((c) =>
    h(
      "button",
      { class: "chalk-swatch", type: "button", "aria-label": `${COLOR_NAME[c]} chalk`, title: `${COLOR_NAME[c]} chalk`, "aria-pressed": String(c === color), style: `--chalk:${chalkColor(c)}`, onclick: () => setColor(c) },
      h("span", { "aria-hidden": "true" }),
    ),
  );
  const widthControl = segmented<Width>(
    [
      { value: "fine", label: "Fine", title: "A fine line" },
      { value: "medium", label: "Medium", title: "A medium line" },
      { value: "bold", label: "Bold", title: "A bold line" },
    ],
    width,
    (v) => (width = v),
    { label: "Line", small: true },
  );
  const dusterButton = button("Duster", { iconOnly: true, icon: "eraser", size: "sm", label: "Duster: rub chalk out", onClick: () => setDuster(!duster) });
  const undoButton = button("Undo", { iconOnly: true, icon: "undo", size: "sm", label: "Undo your last stroke", onClick: () => undo() });
  const redoButton = button("Redo", { iconOnly: true, icon: "redo", size: "sm", label: "Redo", onClick: () => redo() });
  const fitButton = button("Fit", { iconOnly: true, icon: "expand", size: "sm", label: "Fit the board in view", onClick: () => fit() });
  const listButton = button("Writing", { icon: "scroll", size: "sm", label: "What's written on the board", onClick: () => setList(!listOpen) });
  const clearButton = canClear ? button("Clear…", { icon: "trash", size: "sm", variant: "danger", label: "Clear the board", onClick: () => void clearBoard() }) : null;
  const status = h("span", { class: "board-status tiny", role: "status", "aria-live": "polite" });
  const retry = button("Send now", { size: "sm", icon: "retry", onClick: () => flush(true) });
  retry.hidden = true;
  const tools = h(
    "div",
    { class: "board-tools", role: "toolbar", "aria-label": "Chalk" },
    canDraw ? h("div", { class: "board-swatches", role: "group", "aria-label": "Colour" }, ...swatches) : null,
    canDraw ? widthControl.el : null,
    canDraw ? dusterButton : null,
    canDraw ? h("div", { class: "board-history" }, undoButton, redoButton) : null,
    h("span", { class: "grow" }),
    fitButton,
    listButton,
    clearButton,
  );
  const slate = h("canvas", { class: "board-canvas", "aria-hidden": "true" }) as HTMLCanvasElement;
  const chalk = h("canvas", { class: "board-canvas", "aria-hidden": "true" }) as HTMLCanvasElement;
  const live = h("canvas", { class: "board-canvas", "aria-hidden": "true" }) as HTMLCanvasElement;
  const layers = h("div", { class: "board-layers" }, slate, chalk, live);
  const description = h("p", { class: "small" });
  const items = h("ul", { class: "board-item-list" });
  const list = h("div", { class: "board-list sr-only", id: `board-list-${Math.random().toString(36).slice(2, 8)}` }, h("h2", { class: "small strong" }, "What's on the board"), description, items);
  listButton.setAttribute("aria-controls", list.id);
  const stage = h(
    "div",
    {
      class: "board-stage",
      role: "group",
      tabindex: 0,
      "aria-label": canDraw
        ? "The chalkboard. Draw with a finger, a pen or the mouse; two fingers move and zoom. Z undoes, Shift Z redoes, E is the duster, 1 to 6 choose the chalk, 0 fits the board."
        : "The chalkboard. This device can read it but not draw on it.",
    },
    layers,
  );
  const note = canDraw ? null : callout("quiet", "This device can read the board but not draw on it: it was paired without the chat scope.");
  const el = h("div", { class: "board" }, note, tools, stage, h("div", { class: "board-foot" }, status, retry), list);

  // ---------- the view ----------
  let cssW = 0;
  let cssH = 0;
  let dpr = 1;
  let view: BoardViewport = { scale: 1, x: 0, y: 0 };
  /** The view the canvases were last drawn in (during a gesture they're moved by CSS until it ends). */
  let drawn: BoardViewport = view;
  let fitted = true;

  function resize(): void {
    const rect = stage.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    cssW = rect.width;
    cssH = rect.height;
    // Sharp, but never a huge canvas (a phone at 3x would be 30 MB a layer).
    dpr = Math.min(devicePixelRatio || 1, 2, Math.sqrt(4_000_000 / (cssW * cssH)));
    for (const c of [slate, chalk, live]) {
      c.width = Math.round(cssW * dpr);
      c.height = Math.round(cssH * dpr);
    }
    if (fitted) view = fitView(cssW, cssH);
    else view = clampView(view, cssW, cssH);
    redraw();
  }
  const observer = new ResizeObserver(() => resize());
  observer.observe(stage);
  scope.add(() => observer.disconnect());

  function shown(): BoardView {
    return withPending(remote, outbox.pendingStrokes(), outbox.pendingErases());
  }

  function redraw(): void {
    if (!cssW) return;
    drawn = view;
    layers.style.transform = "";
    paintSlate(slate.getContext("2d")!, cssW, cssH, view, dpr);
    paintChalk(chalk.getContext("2d")!, shown(), view, dpr);
  }

  /** While fingers move the view: move what's drawn with CSS (cheap), and draw it again when they stop. */
  function preview(): void {
    const k = view.scale / drawn.scale;
    layers.style.transform = `translate(${view.x - drawn.x * k}px, ${view.y - drawn.y * k}px) scale(${k})`;
  }
  let settle: ReturnType<typeof setTimeout> | null = null;
  function settleSoon(): void {
    if (settle) clearTimeout(settle);
    settle = setTimeout(() => {
      settle = null;
      redraw();
    }, 140);
  }
  scope.add(() => settle && clearTimeout(settle));

  function setView(next: BoardViewport, now = false): void {
    view = clampView(next, cssW, cssH);
    fitted = false;
    if (now) redraw();
    else {
      preview();
      settleSoon();
    }
  }

  function fit(): void {
    fitted = true;
    view = fitView(cssW, cssH);
    redraw();
  }

  // ---------- what's written, as text ----------
  let listOpen = false;
  function setList(open: boolean): void {
    listOpen = open;
    list.classList.toggle("sr-only", !open);
    listButton.setAttribute("aria-expanded", String(open));
  }
  setList(false);

  function itemText(item: BoardItem): string[] {
    switch (item.kind) {
      case "text":
        return item.text.split("\n");
      case "note":
        return [...(item.title ? [item.title] : []), ...noteLines(item.text).map((l) => (l.marker ? `${l.marker} ${l.text}` : l.text))];
      case "equation":
        return item.text.split("\n").map(equationText);
      case "chart":
        return [itemSummary(item), ...item.series.map((s) => `${s.name}: ${s.values.length} values, from ${Math.min(...s.values)} to ${Math.max(...s.values)}`)];
    }
  }

  function renderList(): void {
    const board = shown();
    description.textContent = describeDrawing(board).replace(/^The owner's drawing/, "Your drawing");
    const by = (i: BoardItem) => (i.by === "galahad" ? "Galahad" : i.by === "owner" ? "you" : i.by);
    replace(
      items,
      ...(board.items.length
        ? board.items.map((item) =>
            h(
              "li",
              { class: "board-item" },
              h("div", { class: "row" }, h("span", { class: "small strong grow" }, `${item.kind === "chart" ? "Chart" : item.kind === "note" ? "Note" : item.kind === "equation" ? "Equation" : "Text"} by ${by(item)}`), canDraw ? button("Erase", { size: "sm", variant: "ghost", icon: "eraser", label: `Erase ${itemSummary(item).slice(0, 40)}`, onClick: () => void eraseItem(item) }) : null),
              // Text only: what an agent wrote is never markup.
              h("div", { class: "board-item-text small" }, ...itemText(item).map((line) => h("div", {}, line || " "))),
            ),
          )
        : [h("li", { class: "small muted" }, "Nothing written on it yet.")]),
    );
    listButton.querySelector("span")!.textContent = board.items.length ? `Writing (${board.items.length})` : "Writing";
  }

  function update(): void {
    redraw();
    renderList();
    undoButton.disabled = !history.canUndo;
    redoButton.disabled = !history.canRedo;
    showStatus();
  }

  // ---------- loading, and staying live ----------
  let fetching = false;
  let want = -1;
  async function load(): Promise<void> {
    if (fetching) return;
    fetching = true;
    try {
      const fresh = readBoard(await ctx.api.get("/api/board", scope.signal));
      if (!fresh) throw new Error("the node's answer isn't a board");
      remote = fresh;
      loaded = true;
      history.keepOnly(new Set([...remote.strokes.map((s) => s.id), ...outbox.pendingStrokes().map((s) => s.id)]));
      update();
    } catch (error) {
      if (scope.disposed) return;
      if (!loaded) replace(status, `Can't read the board right now: ${errorMessage(error)}`);
    } finally {
      fetching = false;
    }
    if (want > remote.version && !scope.disposed) void load();
  }
  void load();
  scope.add(
    opts.feed.subscribe((version) => {
      want = Math.max(want, version);
      if (version !== remote.version) void load();
    }),
  );

  // ---------- sending ----------
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let snapshotTimer: ReturnType<typeof setTimeout> | null = null;
  scope.add(() => {
    if (retryTimer) clearTimeout(retryTimer);
    if (snapshotTimer) clearTimeout(snapshotTimer);
  });

  function showStatus(): void {
    const waiting = outbox.waiting;
    retry.hidden = !outbox.failing;
    if (!loaded) return;
    if (outbox.failing) status.textContent = `${waiting} change${waiting === 1 ? "" : "s"} waiting: the node can't be reached. They'll go when it's back.`;
    else if (waiting) status.textContent = "Sending…";
    else status.textContent = remote.updatedAt ? "On the board." : "";
    status.dataset.tone = outbox.failing ? "warn" : "";
  }

  async function flush(now = false): Promise<void> {
    if (now && retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    if (outbox.inFlight || retryTimer || scope.disposed) return;
    const next = outbox.next(BOARD_LIMITS.strokesPerDraw);
    if (!next) return showStatus();
    outbox.inFlight = true;
    showStatus();
    const count = "draw" in next ? next.draw.length : next.erase.length;
    try {
      const before = remote.version;
      if ("draw" in next) {
        const answer = await ctx.api.post<{ added: number; version: number }>("/api/board/draw", { strokes: next.draw.map(({ at: _at, ...s }) => s) });
        // Ours alone since the last we saw: no need to fetch it again.
        if (answer.version === before + 1) remote = { ...remote, version: answer.version, updatedAt: Date.now(), strokes: [...remote.strokes, ...next.draw.filter((s) => !remote.strokes.some((r) => r.id === s.id))] };
        else want = Math.max(want, answer.version);
      } else {
        await ctx.api.post("/api/board/erase", { strokes: next.erase });
        const gone = new Set(next.erase);
        remote = { ...remote, version: remote.version + 1, strokes: remote.strokes.filter((s) => !gone.has(s.id)) };
        want = remote.version;
      }
      outbox.inFlight = false;
      outbox.sent(count);
      snapshotSoon();
    } catch (error) {
      outbox.inFlight = false;
      if (isNetworkError(error) || (error instanceof ApiError && (error.status >= 500 || error.status === 0))) {
        const wait = outbox.failed();
        retryTimer = setTimeout(() => {
          retryTimer = null;
          void flush();
        }, wait);
      } else {
        // Refused for good (the board is full, say): those changes are dropped, and the board shown as the node has it.
        outbox.drop(count);
        toast("The board didn't take that", { tone: "error", description: errorMessage(error) });
        void load();
      }
    }
    update();
    if (!retryTimer) void flush();
  }
  // Back online, or the app back in front: send what's waiting at once.
  scope.listen(window, "online", () => void flush(true));
  scope.listen(document, "visibilitychange", () => !document.hidden && outbox.failing && void flush(true));

  /** The picture of the board as you see it, for the models that can see, a moment after you stop. */
  function snapshotSoon(): void {
    if (snapshotTimer) clearTimeout(snapshotTimer);
    snapshotTimer = setTimeout(() => {
      snapshotTimer = null;
      if (outbox.waiting) return snapshotSoon();
      void sendSnapshot();
    }, SNAPSHOT_AFTER_MS);
  }

  async function sendSnapshot(): Promise<void> {
    const out = document.createElement("canvas");
    const scratch = document.createElement("canvas");
    for (const w of SNAPSHOT_SIZES) {
      out.width = w;
      out.height = Math.round((w * 9) / 16);
      paintBoard(out, scratch, shown());
      const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/png"));
      if (!blob || blob.size > BOARD_LIMITS.snapshotBytes) continue;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      try {
        await ctx.api.post("/api/board/draw", { strokes: [], snapshot: btoa(binary) });
      } catch {
        /* the strokes are safe; the next drawing sends a picture again */
      }
      return;
    }
  }

  // ---------- drawing ----------
  const pointers = new Map<number, Pointer>();
  let stroke: { id: number; raw: number[]; pressure: number[] | null; last: [number, number] | null; type: string } | null = null;
  let pinch: { start: BoardViewport; a: [number, number]; b: [number, number]; ids: [number, number] } | null = null;
  let pan: { id: number; x: number; y: number; start: BoardViewport } | null = null;
  /** Once a pen has drawn here, fingers only move the view. */
  let penSeen = false;
  let spaceDown = false;

  const local = (event: PointerEvent): [number, number] => {
    const rect = stage.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  };

  function strokeWidth(): number {
    return Math.min(BOARD_LIMITS.maxWidth, WIDTHS[width] * (duster ? DUSTER : 1));
  }

  function beginStroke(event: PointerEvent): void {
    const [sx, sy] = local(event);
    const [bx, by] = toBoard(view, sx, sy);
    const pen = event.pointerType === "pen";
    stroke = { id: event.pointerId, raw: [bx, by], pressure: pen ? [event.pressure || 0.5] : null, last: [bx, by], type: event.pointerType };
    const g = live.getContext("2d")!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, live.width, live.height);
  }

  function extendStroke(event: PointerEvent): void {
    if (!stroke) return;
    const events = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [event];
    const g = live.getContext("2d")!;
    g.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.x, dpr * view.y);
    for (const e of events.length ? events : [event]) {
      const [sx, sy] = local(e);
      const [bx, by] = toBoard(view, sx, sy);
      const [x, y] = ease(stroke.last, bx, by, view.scale);
      const prev = stroke.last!;
      if (Math.hypot(x - prev[0], y - prev[1]) * view.scale < 0.5) continue;
      stroke.raw.push(x, y);
      stroke.pressure?.push(e.pressure || 0.5);
      stroke.last = [x, y];
      // Just the newest piece, on the live layer: nothing else is drawn while the hand moves.
      const w = pressed(strokeWidth(), stroke.pressure?.at(-1));
      if (duster) {
        g.strokeStyle = "rgba(47, 59, 54, 0.9)";
      } else g.strokeStyle = chalkColor(color);
      g.lineCap = "round";
      g.lineWidth = w;
      g.beginPath();
      g.moveTo(prev[0], prev[1]);
      g.lineTo(x, y);
      g.stroke();
    }
  }

  function endStroke(cancel = false): void {
    const done = stroke;
    stroke = null;
    const g = live.getContext("2d")!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, live.width, live.height);
    if (!done || cancel) return;
    const finished = finishStroke({ points: done.raw, pressure: done.pressure }, 0.6 / view.scale, BOARD_LIMITS.strokePoints);
    if (!finished) return;
    const s: BoardStroke = { id: strokeId(crypto.getRandomValues(new Uint8Array(14))), color, width: Math.round(strokeWidth() * 10) / 10, ...finished, ...(duster ? { erase: true } : {}), at: Date.now() };
    history.drew(s);
    outbox.add({ kind: "draw", stroke: s });
    // On the chalk as it is, without drawing the rest again.
    const c = chalk.getContext("2d")!;
    c.setTransform(dpr * drawn.scale, 0, 0, dpr * drawn.scale, dpr * drawn.x, dpr * drawn.y);
    paintStroke(c, s, dpr * drawn.scale);
    renderList();
    undoButton.disabled = !history.canUndo;
    redoButton.disabled = true;
    void flush();
  }

  function undo(): void {
    const s = history.undo();
    if (!s) return;
    outbox.add({ kind: "erase", id: s.id });
    update();
    void flush();
  }

  function redo(): void {
    const s = history.redo();
    if (!s) return;
    outbox.add({ kind: "draw", stroke: { ...s, at: Date.now() } });
    update();
    void flush();
  }

  async function eraseItem(item: BoardItem): Promise<void> {
    try {
      await ctx.api.post("/api/board/erase", { items: [item.id] });
      remote = { ...remote, items: remote.items.filter((i) => i.id !== item.id) };
      update();
    } catch (error) {
      toast("Couldn't erase that", { tone: "error", description: errorMessage(error) });
    }
  }

  async function clearBoard(): Promise<void> {
    const ok = await confirmAction({
      title: "Clear the chalkboard?",
      body: "Your drawing and everything written on it go, on every device. This can't be undone.",
      confirmLabel: "Clear the board",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await ctx.api.post("/api/board/clear", {});
      history.forget();
      while (outbox.waiting) outbox.drop(outbox.waiting);
      remote = { ...emptyBoard(), version: remote.version + 1, updatedAt: Date.now() };
      update();
      void load();
    } catch (error) {
      toast("Couldn't clear the board", { tone: "error", description: errorMessage(error) });
    }
  }

  function setColor(c: Chalk): void {
    color = c;
    if (duster) setDuster(false);
    swatches.forEach((s, i) => s.setAttribute("aria-pressed", String(CHALK[i] === c)));
  }

  function setDuster(on: boolean): void {
    duster = on;
    dusterButton.setAttribute("aria-pressed", String(on));
    stage.dataset.tool = on ? "duster" : "chalk";
  }
  setDuster(false);

  // ---------- pointers: one draws, two move the view ----------
  const drawsWith = (event: PointerEvent): boolean => {
    if (!canDraw || spaceDown) return false;
    if (event.pointerType === "mouse") return event.button === 0;
    if (event.pointerType === "touch") return !penSeen;
    return true;
  };

  stage.addEventListener("pointerdown", (event) => {
    stage.focus({ preventScroll: true });
    const [x, y] = local(event);
    pointers.set(event.pointerId, { x, y, type: event.pointerType });
    stage.setPointerCapture(event.pointerId);
    if (event.pointerType === "pen") penSeen = true;
    const touches = [...pointers.entries()].filter(([, p]) => p.type === "touch");
    if (touches.length >= 2) {
      // A second finger: whatever the first began isn't a stroke after all.
      if (stroke?.type === "touch") endStroke(true);
      pan = null;
      const [[ia, a], [ib, b]] = touches as [[number, Pointer], [number, Pointer]];
      pinch = { start: view, a: [a.x, a.y], b: [b.x, b.y], ids: [ia, ib] };
      return;
    }
    if (pinch || stroke) return;
    if (drawsWith(event)) beginStroke(event);
    else if (event.pointerType !== "mouse" || event.button === 1 || spaceDown || !canDraw) pan = { id: event.pointerId, x, y, start: view };
  });

  stage.addEventListener("pointermove", (event) => {
    const p = pointers.get(event.pointerId);
    if (!p) return;
    const [x, y] = local(event);
    p.x = x;
    p.y = y;
    if (pinch) {
      const a = pointers.get(pinch.ids[0]);
      const b = pointers.get(pinch.ids[1]);
      if (a && b) setView(pinchView(pinch.start, pinch.a, pinch.b, [a.x, a.y], [b.x, b.y], zoomLimits(fitView(cssW, cssH))));
    } else if (pan && pan.id === event.pointerId) {
      setView({ ...pan.start, x: pan.start.x + x - pan.x, y: pan.start.y + y - pan.y });
    } else if (stroke && stroke.id === event.pointerId) extendStroke(event);
  });

  const lift = (event: PointerEvent) => {
    if (!pointers.delete(event.pointerId)) return;
    if (stroke && stroke.id === event.pointerId) endStroke(event.type === "pointercancel");
    if (pan?.id === event.pointerId) pan = null;
    if (pinch && pinch.ids.includes(event.pointerId)) pinch = null;
    // Until every finger is off, the one left doesn't start drawing.
  };
  stage.addEventListener("pointerup", lift);
  stage.addEventListener("pointercancel", lift);
  stage.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const [x, y] = local(event as unknown as PointerEvent);
      // A pinch on a trackpad, or Ctrl and the wheel, zooms; the wheel alone moves the view.
      if (event.ctrlKey || event.metaKey) setView(zoomAt(view, Math.exp(-event.deltaY * 0.01), x, y, zoomLimits(fitView(cssW, cssH))));
      else setView({ ...view, x: view.x - event.deltaX, y: view.y - event.deltaY });
    },
    { passive: false },
  );

  // ---------- keys ----------
  stage.addEventListener("keydown", (event) => {
    if (isTyping(event.target)) return;
    const mod = event.metaKey || event.ctrlKey;
    const k = event.key.toLowerCase();
    if (k === " ") {
      spaceDown = true;
      event.preventDefault();
    } else if (k === "z" && (mod || !event.altKey)) {
      event.preventDefault();
      event.shiftKey ? redo() : undo();
    } else if (k === "y" && mod) {
      event.preventDefault();
      redo();
    } else if (!mod && k === "e" && canDraw) setDuster(!duster);
    else if (!mod && /^[1-6]$/.test(k) && canDraw) setColor(CHALK[Number(k) - 1]!);
    else if (!mod && k === "0") fit();
    else if (!mod && (k === "+" || k === "=")) setView(zoomAt(view, 1.25, cssW / 2, cssH / 2, zoomLimits(fitView(cssW, cssH))), true);
    else if (!mod && k === "-") setView(zoomAt(view, 0.8, cssW / 2, cssH / 2, zoomLimits(fitView(cssW, cssH))), true);
  });
  stage.addEventListener("keyup", (event) => {
    if (event.key === " ") spaceDown = false;
  });

  resize();
  update();
  return { el, focus: () => stage.focus({ preventScroll: true }) };
}

/** For the world page: a feed it fills from its own stream. */
export function boardFeed(): BoardFeed & { announce(version: number): void } {
  const subs = new Set<(version: number) => void>();
  return {
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    announce(version) {
      for (const fn of subs) fn(version);
    },
  };
}

/** What the world shows on its board's face: the node's board, read at the boundary (null: none to show). */
export async function fetchBoard(ctx: Ctx, signal?: AbortSignal): Promise<BoardView | null> {
  return readBoard(await ctx.api.get("/api/board", signal));
}

