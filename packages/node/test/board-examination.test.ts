import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BOARD_LIMITS, BoardWriteInput, type Examination, type ReadoutExamination } from "@galahad/core";
import { BoardStore, writeOnBoard } from "../src/board.ts";
import { examinationOnBoard, writeUpExaminations } from "../src/board-examination.ts";

/*
 * An experiment's examination, written up on the chalkboard at the observatory:
 * a note in words and a chart of the readout that moved most, within the
 * board's limits, each new one in place of the last.
 */

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), "galahad-board-ex-"));
  dirs.push(d);
  return d;
};

const readout = (key: string, values: number[], over: Partial<ReadoutExamination> = {}): ReadoutExamination => ({
  key,
  label: key.replace(/_/g, " "),
  count: values.length,
  min: Math.min(...values),
  max: Math.max(...values),
  tMin: 0,
  tMax: values.length - 1,
  first: values[0]!,
  final: values.at(-1)!,
  trend: "falling" as ReadoutExamination["trend"],
  ranAway: false,
  series: values.map((v, i) => [i, v] as [number, number]),
  sentence: `${key} went from ${values[0]} to ${values.at(-1)}.`,
  ...over,
});

const examination = (over: Partial<Examination> = {}): Examination => ({
  id: "ex_abcdefghijkl",
  title: "Two-link arm",
  engine: "mujoco",
  status: "done",
  duration: 6,
  summary: "it tracked the circle",
  readouts: [readout("speed_mps", [1, 1.01, 0.99, 1]), readout("error_mm", [90, 45, 30, 22, 18, 15, 12.9])],
  notable: ["Its own summary: it tracked the circle."],
  headline: "Two-link arm finished: error (mm) fell from 90.0 to 12.9",
  words: "Two-link arm finished after 6 s. error (mm) fell from 90.0 to 12.9; speed held near 1.",
  ...over,
});

describe("an examination on the chalkboard", () => {
  test("a note in words and a chart of the readout that moved most, each within the board's limits", () => {
    const [note, chart] = examinationOnBoard(examination());
    for (const input of [note, chart]) expect(BoardWriteInput.safeParse(input).success).toBe(true);
    expect(note!.item).toMatchObject({ kind: "note", title: "Examined: Two-link arm" });
    expect((note!.item as { text: string }).text).toContain("fell from 90.0 to 12.9");
    // The speed comes first but barely moved: the error, which moved most, is the one charted, against time.
    expect(chart!.item).toMatchObject({ kind: "chart", title: "Two-link arm: error mm", xLabel: "time (s)" });
    expect((chart!.item as { series: { values: number[] }[] }).series[0]!.values).toEqual([90, 45, 30, 22, 18, 15, 12.9]);
    expect(chart!.color).toBe("yellow");
  });

  test("it charts what the examination leads with, and says each sentence once (as ultra's real arm showed)", () => {
    // The arm's real readouts: the error it was built to shrink first, the torques swinging after it. The torques
    // move more for their size, but the finding is the error falling.
    const readouts = [
      readout("error_mm", [455, 120, 8, 0.9, 0.4, 0.32]),
      readout("shoulder_nm", [25, -5.73, 6, 3.2, 4.4, 3.87], { trend: "oscillating" as ReadoutExamination["trend"] }),
      readout("elbow_nm", [5.15, -2.94, 1.2, 0.3, 1.1, 0.85], { trend: "oscillating" as ReadoutExamination["trend"] }),
    ];
    const words = `Arm (MuJoCo) finished after 8.0 s of simulation. ${readouts.map((r) => r.sentence).join(" ")} In its own words: tracked. Nothing ran away.`;
    const [note, chart] = examinationOnBoard(examination({ readouts, words, notable: ["In its own words: tracked."] }));
    expect((chart!.item as { title: string }).title).toBe("Two-link arm: error mm");
    const text = (note!.item as { text: string }).text;
    for (const sentence of [...readouts.map((r) => r.sentence), "In its own words: tracked.", "Nothing ran away."]) expect(text.split(sentence).length - 1).toBe(1);
    expect(text.split("\n")[0]).toBe("Arm (MuJoCo) finished after 8.0 s of simulation.");
  });

  test("a readout that ran away is charted in warning pink; with nothing to chart, just the note", () => {
    const ranAway = examinationOnBoard(examination({ readouts: [readout("angle_rad", [0.1, 0.3, 5, 90], { ranAway: true })] }));
    expect(ranAway[1]!.color).toBe("pink");
    expect(examinationOnBoard(examination({ readouts: [] }))).toHaveLength(1);
    expect(examinationOnBoard(examination({ readouts: [readout("x", [3])] }))).toHaveLength(1);
  });

  test("long words are cut to the board's limits rather than refused", () => {
    const [note] = examinationOnBoard(examination({ title: "t".repeat(500), words: "w ".repeat(5000) }));
    expect(BoardWriteInput.safeParse(note).success).toBe(true);
    expect((note!.item as { text: string }).text.length).toBeLessThanOrEqual(BOARD_LIMITS.note);
  });

  test("on a real board, each write-up takes the last one's place, so the board doesn't fill with them", () => {
    const board = new BoardStore({ dir: tempDir() });
    const shown: string[] = [];
    const world = { doing: (_station: string, text: string) => shown.push(text) } as never;
    const listener = writeUpExaminations(
      (input) => writeOnBoard({ board, world }, input),
      (id) => board.view().items.some((item) => item.id === id),
    );
    listener(examination());
    expect(board.view().items.map((i) => i.kind).sort()).toEqual(["chart", "note"]);
    expect(shown[0]).toMatch(/^Writing on the chalkboard/);
    listener(examination({ id: "ex_mnopqrstuvwx", title: "Pendulum" }));
    const items = board.view().items;
    expect(items).toHaveLength(2);
    expect(items.find((i) => i.kind === "note")).toMatchObject({ title: "Examined: Pendulum" });
    // An examination that couldn't be made writes nothing.
    listener(null);
    expect(board.view().items).toHaveLength(2);
  });
});
