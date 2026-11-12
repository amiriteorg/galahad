import { describe, expect, test } from "bun:test";
import type { QuestView, TurnView } from "@galahad/core";
import { questLines, queueLines, turnLine } from "../src/turn-cli.ts";

const now = 10_000_000;
const turn = (over: Partial<TurnView> = {}): TurnView => ({
  id: "tn_aaaaaaaaaaaaaaaaaaaaaa",
  conversation: "cv_bbbbbbbbbbbbbbbbbbbbbb",
  title: "The report",
  role: "planner",
  state: "running",
  startedAt: now - 3 * 60_000,
  endedAt: null,
  deadline: now + 27 * 60_000,
  model: "anthropic/claude-opus-5-5",
  step: "Answering",
  tools: 2,
  watchers: 0,
  steering: 0,
  watchable: true,
  ...over,
});

describe("a running turn in a line", () => {
  test("which chat, what he's doing, what it has cost, who's watching, when it stops by itself", () => {
    expect(turnLine(turn(), now)).toBe("tn_aaaaaaaaaaaaaaaaaaaaaa · The report (cv_bbbbbbbbbbbbbbbbbbbbbb) · planner · 3 min so far · Answering · 2 tools · nobody watching · stops by itself in 27 min");
    expect(turnLine(turn({ conversation: null, title: null, tools: 0, watchers: 2, steering: 1, step: null }), now)).toBe(
      "tn_aaaaaaaaaaaaaaaaaaaaaa · a temporary chat · planner · 3 min so far · starting · 1 of your messages waiting to reach him · 2 watching · stops by itself in 27 min",
    );
    expect(turnLine(turn({ watchable: false, step: null, model: null, watchers: 1 }), now)).toContain("may read the bank: not shown to this device · 2 tools · 1 watching");
  });
});

describe("a chat's queue in words", () => {
  const queue = [
    { id: 7, text: "Then tidy\nup the branch.", role: null, at: now, by: "phone" },
    { id: 9, text: "And tell me when it's done.", role: null, at: now, by: null },
  ];
  test("in order, numbered as you'd name them; held says why and what lets it go", () => {
    expect(queueLines(queue, null)).toEqual(["2 queued: each is sent as the next turn when the one before it ends well.", "  1. Then tidy up the branch.  (from phone)", "  2. And tell me when it's done."]);
    expect(queueLines(queue, "stopped")[0]).toBe("2 queued, held: you stopped him. Nothing is sent until you resume (or send one now).");
    expect(queueLines([], null)).toEqual(["Nothing queued."]);
  });
});

describe("a quest in hand in words", () => {
  const quest = (over: Partial<QuestView> = {}): QuestView => ({
    quest: "q-abc",
    by: "you",
    goal: "Write the report",
    state: "working",
    plan: "1. Read the notes.\n2. Write it.\nDone when: the report exists.",
    step: 3,
    maxSteps: 30,
    doing: "$ cat notes.md",
    revisions: 1,
    gates: [
      { command: "test -s /work/out/report.md", by: "owner", exitCode: 1, excerpt: "" },
      { command: "grep -q Summary /work/out/report.md", by: "planner", exitCode: null },
    ],
    startedAt: now,
    updatedAt: now,
    silent: false,
    ...over,
  });

  test("where it stands, the plan, the step he's on, each gate's last result and whose it is", () => {
    expect(questLines(quest())).toEqual([
      "Write the report  (q-abc · run by you)",
      "  working · command 3 of 30 · sent back 1 time",
      "  now: $ cat notes.md",
      "    1. Read the notes.",
      "    2. Write it.",
      "    Done when: the report exists.",
      "  gate 1: failed (exit 1)  $ test -s /work/out/report.md  (yours)",
      "  gate 2: not run yet  $ grep -q Summary /work/out/report.md  (proposed by the planner)",
    ]);
  });

  test("an attempt says which; a silent one says so; an ended one shows how, not what it was doing", () => {
    expect(questLines(quest({ attempt: { of: "q-abc", index: 2, attempts: 3 }, quest: "q-abc.2" }))[0]).toBe("Write the report  (q-abc.2 · attempt 2 of 3 · run by you)");
    expect(questLines(quest({ silent: true }))[1]).toContain("no word from its runner for a while");
    const ended = questLines(quest({ state: "unverified", revisions: 2, summary: "Wrote it, but the gate never passed.", gates: [{ command: "false", by: "owner", exitCode: 1 }] }), { plan: false });
    expect(ended).toEqual(["Write the report  (q-abc · run by you)", "  finished, but not accepted · command 3 of 30 · sent back 2 times", "  gate 1: failed (exit 1)  $ false  (yours)", "  Wrote it, but the gate never passed."]);
  });
});
