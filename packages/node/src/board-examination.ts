import { BOARD_LIMITS as L, type BoardItem, type BoardWriteInput, type Examination, type ReadoutExamination } from "@galahad/core";

/*
 * An experiment's examination, written up on the chalkboard at the observatory
 * (the place it's examined): a note with what it showed in words, and a chart of
 * the readout that changed most over the run. Pure, so tested; the daemon writes
 * these when the hub reaches an experiment's examination (WorldHub.onExamine),
 * each new write-up in place of the last one's (the board's history keeps them
 * all).
 */

/** How much a readout changed over the run, relative to its size. */
function movement(r: ReadoutExamination): number {
  const span = r.max - r.min;
  const scale = Math.max(Math.abs(r.max), Math.abs(r.min), 1e-9);
  return r.series.length < 2 ? -1 : span / scale + (r.ranAway ? 10 : 0);
}

const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

/** The write-up's note is titled this, then the experiment's title. */
const NOTE_TITLE = "Examined: ";

/** A readout that changed less than this over the run, for its size, says nothing as a chart. */
const FLAT = 0.05;

/**
 * The note's lines: the examination's own words as a list, each sentence once. Its words open with what ran and
 * how it ended, then each readout's sentence; when they don't (no readouts), the words as they are.
 */
function noteLines(ex: Examination): string[] {
  const shown = ex.readouts.slice(0, 6);
  const start = shown.length ? ex.words.indexOf(shown[0]!.sentence) : -1;
  if (start <= 0) return [ex.words];
  const more = ex.readouts.length - shown.length;
  return [
    ex.words.slice(0, start).trim(),
    ...shown.map((r) => `- ${r.sentence}`),
    ...(more > 0 ? [`- ${more} more readout${more === 1 ? "" : "s"} in the list.`] : []),
    // What the readouts' sentences haven't said already (a runaway is in its readout's sentence).
    ...ex.notable.filter((n) => !/ ran away, /.test(n)).map((n) => `- ${n}`),
    ...(ex.readouts.some((r) => r.ranAway) ? [] : ["- Nothing ran away."]),
  ];
}

/**
 * The readout to chart: what the examination leads with (the one that ran away, else the first the experiment
 * sent, which is the one its author put first), unless that hardly moved; then the one that moved most.
 */
function charted(ex: Examination): ReadoutExamination | undefined {
  const drawable = ex.readouts.filter((r) => r.series.length >= 2);
  const lead = drawable.find((r) => r.ranAway) ?? drawable[0];
  if (lead && (lead.ranAway || movement(lead) >= FLAT)) return lead;
  const most = [...drawable].sort((a, b) => movement(b) - movement(a))[0];
  return most && movement(most) > 0 ? most : undefined;
}

/** The write-up: a note, and a chart when a readout has a series worth drawing. Each within the board's limits. */
export function examinationOnBoard(ex: Examination): BoardWriteInput[] {
  const note: BoardWriteInput = {
    item: { kind: "note", title: clip(`${NOTE_TITLE}${ex.title}`, L.title), text: clip(noteLines(ex).join("\n"), L.note) },
    x: 40,
    y: 40,
    width: 760,
  };
  const best = charted(ex);
  if (!best) return [note];
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
 * The last write-up on the board, found there (so a restart doesn't lose it): his note titled "Examined: X", and his
 * chart titled "X: …" beside it. Only his own items: the owner's are never taken for one.
 */
export function lastWriteUp(items: readonly BoardItem[], by = "galahad"): { note?: string; chart?: string } {
  const note = items.find((i) => i.by === by && i.kind === "note" && i.title?.startsWith(NOTE_TITLE));
  if (!note) return {};
  const about = (note.kind === "note" ? (note.title ?? "") : "").slice(NOTE_TITLE.length).replace(/…$/, "");
  const chart = items.find((i) => i.by === by && i.kind === "chart" && i.title?.startsWith(about));
  return { note: note.id, chart: chart?.id };
}

/**
 * What the daemon listens to the world with (WorldHub.onExamine): each examination written up on the board, in
 * place of the last write-up's items (so the board doesn't fill with them; its history keeps every one). A write
 * that fails is logged, never thrown into the world.
 */
export function writeUpExaminations(write: (input: BoardWriteInput) => { id: string }, items: () => readonly BoardItem[], log: (line: string) => void = () => {}): (examination: Examination | null) => void {
  return (examination) => {
    if (!examination) return;
    const last = lastWriteUp(items());
    for (const input of examinationOnBoard(examination)) {
      const previous = input.item.kind === "note" ? last.note : last.chart;
      try {
        write(previous ? { ...input, replace: previous } : input);
      } catch (error) {
        log(`chalkboard: the examination of ${examination.id} wasn't written up (${error instanceof Error ? error.message : String(error)})`);
      }
    }
  };
}
