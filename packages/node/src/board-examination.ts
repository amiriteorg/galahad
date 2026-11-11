import { BOARD_LIMITS as L, type BoardWriteInput, type Examination, type ReadoutExamination } from "@galahad/core";

/*
 * An experiment's examination, written up on the chalkboard at the observatory
 * (the place it's examined): a note with what it showed in words, and a chart of
 * the readout that changed most over the run. Pure, so tested; the daemon writes
 * these when the hub reaches an experiment's examination (WorldHub.onExamine),
 * each new write-up in place of the last one's (the board's history keeps them
 * all).
 */

/** How much a readout changed over the run, relative to its size: the one worth a chart. */
function movement(r: ReadoutExamination): number {
  const span = r.max - r.min;
  const scale = Math.max(Math.abs(r.max), Math.abs(r.min), 1e-9);
  return r.series.length < 2 ? -1 : span / scale + (r.ranAway ? 10 : 0);
}

const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

/** The write-up: a note, and a chart when a readout has a series worth drawing. Each within the board's limits. */
export function examinationOnBoard(ex: Examination): BoardWriteInput[] {
  const lines = [ex.words, ...ex.notable.filter((n) => !ex.words.includes(n)).map((n) => `- ${n}`), ...ex.readouts.slice(0, 6).map((r) => `- ${r.sentence}`)];
  const note: BoardWriteInput = {
    item: { kind: "note", title: clip(`Examined: ${ex.title}`, L.title), text: clip(lines.join("\n"), L.note) },
    x: 40,
    y: 40,
    width: 760,
  };
  const best = [...ex.readouts].sort((a, b) => movement(b) - movement(a))[0];
  if (!best || movement(best) <= 0) return [note];
  const points = best.series.slice(0, L.values);
  const chart: BoardWriteInput = {
    item: {
      kind: "chart",
      title: clip(`${ex.title}: ${best.label}`, L.title),
      type: "line",
      series: [{ name: clip(best.label, L.label), values: points.map(([, v]) => v) }],
      xValues: points.map(([t]) => t),
      xLabel: "time (s)",
      yLabel: clip(best.label, L.label),
    },
    x: 840,
    y: 40,
    width: 720,
    color: best.ranAway ? "pink" : "yellow",
  };
  return [note, chart];
}

/**
 * What the daemon listens to the world with (WorldHub.onExamine): each examination written up on the board, in
 * place of the last write-up's items when they're still there (so the board doesn't fill with them; its history
 * keeps every one). A write that fails is logged, never thrown into the world.
 */
export function writeUpExaminations(write: (input: BoardWriteInput) => { id: string }, has: (id: string) => boolean, log: (line: string) => void = () => {}): (examination: Examination | null) => void {
  let last: string[] = [];
  return (examination) => {
    if (!examination) return;
    const written: string[] = [];
    for (const [i, input] of examinationOnBoard(examination).entries()) {
      const previous = last[i];
      try {
        written.push(write(previous && has(previous) ? { ...input, replace: previous } : input).id);
      } catch (error) {
        log(`chalkboard: the examination of ${examination.id} wasn't written up (${error instanceof Error ? error.message : String(error)})`);
      }
    }
    last = written;
  };
}
