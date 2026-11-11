import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BoardWriteInput } from "@galahad/core";
import { boardsAdapter, experimentsAdapter } from "../src/archive/adapters.ts";
import { boardSource, boardTrust, experimentSource, STROKE_RUN_MS } from "../src/archive/external.ts";
import { BoardStore } from "../src/board.ts";

/*
 * The experiments and the chalkboard, as the archive takes them in: every finished
 * experiment with its recording (streamed from disk), and the board's versions with
 * a run of strokes kept as one (its last version shows them all; the board's own
 * history keeps every one), each version as trusted as the least trusted hand on it.
 */

const root = mkdtempSync(join(tmpdir(), "galahad-archive-external-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let n = 0;
const clock = { t: 1_000_000 };
const now = () => clock.t;
const stroke = (i: number) => ({ id: `s_${String(i).padStart(10, "0")}`, color: "white" as const, width: 6, points: [10 + i, 10, 200, 120] });
const note = (title: string) => BoardWriteInput.parse({ item: { kind: "note", title, text: "words" } });

describe("the chalkboard, in the archive", () => {
  test("a run of strokes is one entry; what he and other agents write are their own, each as trusted as its hands", async () => {
    const board = new BoardStore({ dir: join(root, `b${++n}`), now });
    // You draw three strokes a minute apart: one run.
    for (const i of [1, 2, 3]) {
      clock.t += 60_000;
      board.draw([stroke(i)], undefined, "iPhone");
    }
    clock.t += 60_000;
    board.write(note("The plan"), "galahad");
    clock.t += 60_000;
    board.write(note("Do this instead"), "claude-code");
    // Then, much later, one more stroke: a run of its own.
    clock.t += STROKE_RUN_MS * 2;
    board.draw([stroke(4)], undefined, "iPhone");

    const source = boardSource(board);
    const { records, cursor } = await source.listSince(null, 50);
    const all = board.history.since(null, 100);
    const drawn = all.filter((v) => v.change === "draw").map((v) => v.version);
    // Of the first run's three versions only its last; the later stroke stands alone.
    const listed = records.map((r) => Number(r.id));
    expect(listed.filter((v) => drawn.includes(v))).toEqual([drawn[2]!, drawn[3]!]);
    expect(records.map((r) => r.title).some((t) => /^Chalkboard, version \d+: /.test(t))).toBe(true);
    expect(cursor).toBe(`board:main:${all.at(-1)!.version}`);

    const trustOf = async (change: string, by: string) => (await source.describe(String(all.find((v) => v.change === change && v.by === by)!.version))).trust;
    expect(await trustOf("draw", "owner")).toBe("owner");
    expect(await trustOf("write", "galahad")).toBe("agent");
    // From the moment another agent's words are on the board, every version holding them is untrusted.
    expect(await trustOf("write", "claude-code")).toBe("untrusted");
    expect((await source.describe(String(drawn[3]!))).trust).toBe("untrusted");
    expect((await source.describe(String(drawn[2]!))).description).toMatch(/^Chalkboard, version/);

    // Nothing new: no cursor, so the archive's stays where it was.
    expect(await source.listSince(cursor, 50)).toEqual({ records: [], cursor: null });
  });

  test("a page ends where it ends: the last stroke of a page is kept if the next page goes on with the run", async () => {
    const board = new BoardStore({ dir: join(root, `b${++n}`), now });
    for (const i of [1, 2, 3, 4, 5]) {
      clock.t += 1000;
      board.draw([stroke(i)], undefined, "iPhone");
    }
    const source = boardSource(board);
    const first = await source.listSince(null, 2);
    // It looked one past the page: the page's stroke goes on into the next page's, and the history's start is a blank
    // board, so neither is listed; the cursor moves on past both.
    expect(first.records).toEqual([]);
    expect(first.cursor).toBe("board:main:1");
    const rest = await source.listSince(first.cursor, 50);
    expect(rest.records.map((r) => r.id)).toEqual([String(board.history.since(null, 100).at(-1)!.version)]);
  });

  test("trust: the least trusted hand on the board", () => {
    expect(boardTrust([])).toBe("owner");
    expect(boardTrust([{ by: "owner" }])).toBe("owner");
    expect(boardTrust([{ by: "owner" }, { by: "galahad" }])).toBe("agent");
    expect(boardTrust([{ by: "galahad" }, { by: "opencode" }])).toBe("untrusted");
  });

  test("the adapter takes the version's own trust", async () => {
    const board = new BoardStore({ dir: join(root, `b${++n}`), now });
    clock.t += 1000;
    board.write(note("From outside"), "claude-code");
    const page = await boardsAdapter(boardSource(board)).pull(null, 50);
    // (The history's start, a blank board, isn't kept.) The version with another agent's words on it is untrusted.
    expect(page.entries.map((e) => e.trust)).toEqual(["untrusted"]);
  });
});

describe("saved experiments, in the archive", () => {
  const summary = (id: string, seq: number) => ({ id, seq, title: `Arm ${seq}`, engine: "mujoco", status: "done", startedAt: 1000 * seq, endedAt: 1000 * seq + 500 });
  const store = {
    archiveSince: (cursor: string | null) => {
      const after = cursor === null ? 0 : Number(cursor);
      const items = [summary("ex_aaaaaaaaaaaa", 1), summary("ex_bbbbbbbbbbbb", 2)].filter((s) => s.seq > after);
      return { experiments: items, cursor: items.length ? String(items.at(-1)!.seq) : cursor } as never;
    },
    archiveEntry: (id: string) =>
      id === "ex_aaaaaaaaaaaa"
        ? ({ id, seq: 1, summary: summary(id, 1), text: "Arm 1 (MuJoCo) finished.", files: [{ role: "frames", name: "frames/000000.jsonl.gz", path: "/node/experiments/ex_a/frames/000000.jsonl.gz", bytes: 9, type: "application/gzip", sha256: "x" }] } as never)
        : null,
  };

  test("each finished one, with its files streamed from where they lie, titled and dated by when it ended", async () => {
    const source = experimentSource(store);
    const { records, cursor } = await source.listSince(null, 50);
    expect(records).toEqual([
      { id: "ex_aaaaaaaaaaaa", title: "Arm 1", at: 1500 },
      { id: "ex_bbbbbbbbbbbb", title: "Arm 2", at: 2500 },
    ]);
    expect(cursor).toBe("2");
    expect(await source.describe("ex_aaaaaaaaaaaa")).toEqual({ description: "Arm 1 (MuJoCo) finished.", files: [{ path: "frames/000000.jsonl.gz", fromPath: "/node/experiments/ex_a/frames/000000.jsonl.gz" }] });
  });

  test("one you deleted after it was listed fails this pull, never archived half; the next listing goes without it", async () => {
    await expect(experimentSource(store).describe("ex_bbbbbbbbbbbb")).rejects.toThrow(/no longer kept/);
    await expect(experimentsAdapter(experimentSource(store)).pull("1", 50)).rejects.toThrow(/no longer kept/);
  });
});
