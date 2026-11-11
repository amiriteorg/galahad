import { BOARD_H, BOARD_W, type BoardView, describeDrawing, equationText, type BoardItem } from "@galahad/core";

/*
 * `galahad board`: the chalkboard in words, for you at a terminal. What Galahad
 * and your agents wrote (in full: they're words for you to read, cleaned of
 * control characters when they were written), then your drawing in words.
 */

const by = (item: BoardItem) => (item.by === "owner" ? "you" : item.by === "galahad" ? "Galahad" : item.by);

function body(item: BoardItem): string[] {
  switch (item.kind) {
    case "text":
      return item.text.split("\n");
    case "note":
      return [...(item.title ? [item.title] : []), ...item.text.split("\n")];
    case "equation":
      return item.text.split("\n").map(equationText);
    case "chart":
      return [
        `${item.title ? `${item.title}: ` : ""}a ${item.type ?? "line"} chart${item.xLabel || item.yLabel ? ` (${item.xLabel ?? "x"} against ${item.yLabel ?? "y"})` : ""}`,
        ...item.series.map((s) => {
          const lo = Math.min(...s.values);
          const hi = Math.max(...s.values);
          return `${s.name}: ${s.values.length} values, ${Number(lo.toPrecision(4))} to ${Number(hi.toPrecision(4))}`;
        }),
      ];
  }
}

/** The board, as lines for a terminal (no colour codes: the caller adds its own). */
export function boardLines(board: BoardView): { head: string; items: { title: string; lines: string[] }[]; drawing: string } {
  const head = `The chalkboard (${BOARD_W} × ${BOARD_H}) · version ${board.version}${board.updatedAt ? ` · changed ${new Date(board.updatedAt).toLocaleString()}` : ""}`;
  const items = board.items.map((item) => ({ title: `${item.kind} by ${by(item)} at ${item.x},${item.y} · ${item.id}`, lines: body(item) }));
  return { head, items, drawing: describeDrawing(board) };
}
