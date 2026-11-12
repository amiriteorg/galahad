import { describe, expect, test } from "bun:test";
import { type QuestProgressInput, WORLD_QUESTS } from "@galahad/core";
import { QUEST_SILENT_MS, QuestBoard } from "../src/quests.ts";

const progress = (over: Partial<QuestProgressInput> = {}): QuestProgressInput => ({ quest: "q-1", goal: "write hi", state: "working", plan: "1. Write it.", step: 2, maxSteps: 30, doing: "$ echo hi", revisions: 0, gates: [], ...over });

describe("the quests in hand, as a node shows them", () => {
  test("each report replaces the last; in hand first, then the ones that ended", () => {
    let now = 1000;
    const board = new QuestBoard(() => now);
    board.report("you", progress());
    now += 10;
    board.report("you", progress({ quest: "q-2", state: "done", step: 4, summary: "Done." }));
    now += 10;
    board.report("you", progress({ step: 3, doing: "$ cat a.txt", gates: [{ command: "bun test", by: "owner", exitCode: null }] }));
    const list = board.list();
    expect(list.map((q) => [q.quest, q.state, q.step])).toEqual([
      ["q-1", "working", 3],
      ["q-2", "done", 4],
    ]);
    expect(list[0]).toMatchObject({ by: "you", startedAt: 1000, updatedAt: 1020, silent: false, gates: [{ command: "bun test", by: "owner", exitCode: null }] });
  });

  test("each reporter has its own quests: an agent can't write over yours", () => {
    const board = new QuestBoard();
    board.report("you", progress({ goal: "yours" }));
    board.report("claude-code", progress({ goal: "the agent's", state: "done" }));
    expect(board.list().map((q) => [q.by, q.goal, q.state])).toEqual([
      ["you", "yours", "working"],
      ["claude-code", "the agent's", "done"],
    ]);
  });

  test("an ended quest stays ended, and a quest in hand that goes quiet says so", () => {
    let now = 0;
    const board = new QuestBoard(() => now);
    board.report("you", progress({ state: "done" }));
    board.report("you", progress({ state: "working" }));
    expect(board.list()[0]!.state).toBe("done");
    board.report("you", progress({ quest: "q-quiet" }));
    now += QUEST_SILENT_MS + 1;
    expect(board.list().find((q) => q.quest === "q-quiet")).toMatchObject({ state: "working", silent: true });
    // A day on, the ended one is off the board; the one in hand is still shown (as silent).
    now += 24 * 60 * 60_000;
    expect(board.list().map((q) => q.quest)).toEqual(["q-quiet"]);
  });

  test("what's shown is redacted again here, and the board is bounded per reporter", () => {
    const FAKE_KEY = `sk-ant-api03-${"FAKE".repeat(8)}`;
    const board = new QuestBoard();
    board.report("you", progress({ goal: `use ${FAKE_KEY}`, plan: `1. ${FAKE_KEY}`, doing: `$ echo ${FAKE_KEY}`, summary: FAKE_KEY, gates: [{ command: `curl -H ${FAKE_KEY}`, by: "owner", exitCode: 1, excerpt: FAKE_KEY }] }));
    expect(JSON.stringify(board.list())).not.toContain(FAKE_KEY);
    for (let i = 0; i < 60; i++) board.report("noisy", progress({ quest: `q-n${i}`, state: i % 2 ? "done" : "working" }));
    const noisy = board.list().filter((q) => q.by === "noisy");
    expect(noisy).toHaveLength(40);
    // The ended ones went first.
    expect(noisy.filter((q) => q.state === "working")).toHaveLength(30);
    expect(board.list().some((q) => q.by === "you")).toBe(true);
  });
});

describe("the quests his slate shows, in the SANDBOX", () => {
  test("the plan, the stage and the gates' marks; nothing a command printed; wiped ten minutes after it ended", () => {
    let now = 1000;
    const board = new QuestBoard(() => now);
    const heard: number[] = [];
    board.onChange(() => heard.push(now));
    board.report("you", progress({ plan: "1. Write it.\n2. Check it.\nDone when: it says hi.", gates: [{ command: "bun test", by: "owner", exitCode: 1, excerpt: "FAILED-OUTPUT" }], summary: "It printed something." }));
    expect(heard).toEqual([1000]);
    expect(board.world()).toMatchObject([{ id: "q-1", by: "you", state: "working", title: "write hi", plan: ["Write it.", "Check it."], doneWhen: "it says hi.", step: 2, gates: [{ label: "bun test", passed: false }], endedAt: null, veiled: false }]);
    expect(JSON.stringify(board.world())).not.toContain("FAILED-OUTPUT");
    expect(JSON.stringify(board.world())).not.toContain("printed something");
    expect(JSON.stringify(board.world())).not.toContain("echo hi");
    now += 60_000;
    board.report("you", progress({ state: "done", step: 4 }));
    expect(board.world()).toMatchObject([{ state: "done", endedAt: now }]);
    now += WORLD_QUESTS.wipeMs + 1;
    expect(board.world()).toEqual([]);
    // (It's still on the node's own list for a day: only the slate is wiped.)
    expect(board.list()).toHaveLength(1);
  });

  test("nothing about the bank is drawn: an agent that may read the bank, or a quest that mentions it, is its shape alone", () => {
    let now = 1000;
    const board = new QuestBoard(() => now);
    board.report("ledger-agent", progress({ goal: "Tidy the notes", plan: "1. Read them." }), { bank: true });
    now += 10;
    board.report("you", progress({ quest: "q-2", goal: "Chart my bank spending" }));
    now += 10;
    board.report("you", progress({ quest: "q-3", goal: "Chart the wind" }));
    const world = board.world();
    expect(world.map((q) => [q.by, q.veiled, q.title, q.plan.length])).toEqual([
      ["you", false, "Chart the wind", 1],
      ["you", true, "", 0],
      ["ledger-agent", true, "", 0],
    ]);
    // Once its reporter could read the bank, a quest stays wordless (a later report without the grant doesn't bring its words back).
    now += 10;
    board.report("ledger-agent", progress({ goal: "Tidy the notes", step: 5 }));
    expect(board.world().find((q) => q.by === "ledger-agent")).toMatchObject({ veiled: true, title: "", step: 5 });
  });
});
