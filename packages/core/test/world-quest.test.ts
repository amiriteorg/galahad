import { describe, expect, test } from "bun:test";
import { aboutBank, chalkLine, planSteps, type QuestView, questsForWorld, readWorldQuests, WORLD_QUESTS, worldQuest, worldQuestLine } from "../src/index.ts";

/*
 * A quest as the SANDBOX draws it on his slate: the planner's steps, the stage and
 * the command he's on, the gates' marks; bounded, with nothing a command printed, and
 * never a word of a quest that touches the bank.
 */

const view = (over: Partial<QuestView> = {}): QuestView => ({
  quest: "q-1",
  goal: "Fix the flaky sync test",
  state: "working",
  plan: "1. Reproduce the failure.\n2. Find the race\n   in the queue.\n3. Fix it and add a test.\nDone when: the suite passes ten times in a row.\nGate: bun test packages/link",
  step: 7,
  maxSteps: 30,
  doing: "$ bun test packages/link",
  revisions: 0,
  gates: [
    { command: "bun test packages/link", by: "owner", exitCode: 0, excerpt: "12 pass" },
    { command: "bun run check", by: "planner", exitCode: null },
  ],
  by: "you",
  startedAt: 1000,
  updatedAt: 5000,
  silent: false,
  ...over,
});

describe("a plan, as its steps", () => {
  test("numbered lines are the steps (a line that follows one is the rest of it); Done when and Gate lines stand apart", () => {
    expect(planSteps(view().plan!)).toEqual({ steps: ["Reproduce the failure.", "Find the race in the queue.", "Fix it and add a test."], doneWhen: "the suite passes ten times in a row." });
  });

  test("a plan with no numbers is its first lines; at most seven steps, each cut to a line", () => {
    expect(planSteps("- Read the code\n- Change it\n**Done when:** it works").steps).toEqual(["Read the code", "Change it"]);
    const long = Array.from({ length: 12 }, (_, i) => `${i + 1}. ${"word ".repeat(40)}`).join("\n");
    const { steps } = planSteps(long);
    expect(steps).toHaveLength(WORLD_QUESTS.planLines);
    for (const s of steps) expect([...s].length).toBeLessThanOrEqual(WORLD_QUESTS.line);
  });

  test("chalk is plain text on one line: no control, bidirectional or zero-width characters, no emphasis marks", () => {
    expect(chalkLine("  **Run**\t`bun test`\u202e evil\u200b\nnext\u0007 ", 80)).toBe("Run bun test evil next");
    // Markup is only ever letters (it's drawn as text); a command keeps its pipe, glob and underscore.
    expect(chalkLine("<img src=x onerror=alert(1)>", 80)).toBe("<img src=x onerror=alert(1)>");
    expect(chalkLine("pytest test_sync.py -k 'a*' | tee out_1.txt", 80)).toBe("pytest test_sync.py -k 'a*' | tee out_1.txt");
    expect(chalkLine("## Heading", 80)).toBe("Heading");
    expect(chalkLine("abcdefghij", 6)).toBe("abcde…");
  });
});

describe("a quest, as the world draws it", () => {
  test("its plan, stage, command and gates; never what a command printed, the command he's running, or its summary", () => {
    const q = worldQuest(view({ summary: "It printed SECRET-OUTPUT." , doing: "$ cat secret-output.txt" }), false);
    expect(q).toMatchObject({
      id: "q-1",
      by: "you",
      state: "working",
      title: "Fix the flaky sync test",
      plan: ["Reproduce the failure.", "Find the race in the queue.", "Fix it and add a test."],
      doneWhen: "the suite passes ten times in a row.",
      step: 7,
      maxSteps: 30,
      gates: [
        { label: "bun test packages/link", by: "owner", passed: true },
        { label: "bun run check", by: "planner", passed: null },
      ],
      gatesPassed: 1,
      gatesFailed: 0,
      gatesTotal: 2,
      endedAt: null,
      veiled: false,
    });
    const sent = JSON.stringify(q);
    expect(sent).not.toContain("12 pass");
    expect(sent).not.toContain("SECRET-OUTPUT");
    expect(sent).not.toContain("secret-output");
    expect(worldQuestLine(q)).toBe("Working · command 7 of 30 · 1 of 2 gates passed");
  });

  test("a failed gate shows as failed; an ended quest says how, honestly", () => {
    const q = worldQuest(view({ state: "unverified", gates: [{ command: "bun test", by: "owner", exitCode: 1 }], revisions: 2 }), false);
    expect(q.gates[0]!.passed).toBe(false);
    expect(q.endedAt).toBe(5000);
    expect(worldQuestLine(q)).toBe("Not accepted · command 7 of 30 · 1 of 1 gate failed · sent back 2 times");
    expect(worldQuestLine(worldQuest(view({ state: "planning", gates: [], plan: "" }), false))).toBe("Planning");
  });

  test("nothing about the bank is drawn: a quest that mentions it keeps its shape and loses every word", () => {
    for (const over of [{ goal: "Sum October from my bank export" }, { plan: "1. Read the IBAN list." }, { gates: [{ command: "grep saldo konto.csv", by: "owner" as const, exitCode: 0 }] }, { doing: "$ cat netbank.csv" }]) {
      const q = worldQuest(view(over), false);
      expect(q.veiled).toBe(true);
      expect(q.title).toBe("");
      expect(q.plan).toEqual([]);
      expect(q.doneWhen).toBe("");
      expect(q.gates.every((g) => g.label === "")).toBe(true);
      // Its shape stays: where it stands, and how its gates went.
      expect(q.step).toBe(7);
      expect(q.gatesTotal).toBeGreaterThan(0);
    }
    expect(aboutBank("Kontoudtog for marts")).toBe(true);
    expect(aboutBank("Enable Banking session")).toBe(true);
    expect(aboutBank("Balance the pendulum on the river bend")).toBe(false);
  });

  test("a reporter that may read the bank: the same, whatever its words say", () => {
    const q = worldQuest(view({ goal: "Tidy the notes" }), true);
    expect(q).toMatchObject({ veiled: true, title: "", plan: [], doneWhen: "" });
    expect(worldQuestLine(q)).toBe("Working · command 7 of 30 · 1 of 2 gates passed");
  });

  test("the slice: those in hand, then those that just ended; wiped ten minutes after; at most four", () => {
    const now = 1_000_000;
    const views = [
      view({ quest: "a", updatedAt: now }),
      view({ quest: "b", state: "done", updatedAt: now - WORLD_QUESTS.wipeMs + 1 }),
      view({ quest: "c", state: "done", updatedAt: now - WORLD_QUESTS.wipeMs - 1 }),
    ];
    expect(questsForWorld(views, now).map((q) => q.id)).toEqual(["a", "b"]);
    expect(questsForWorld(Array.from({ length: 9 }, (_, i) => view({ quest: `q${i}`, updatedAt: now })), now)).toHaveLength(WORLD_QUESTS.max);
    expect(questsForWorld(views, now, (v) => v.quest === "a")[0]!.veiled).toBe(true);
  });
});

describe("read at the page's boundary", () => {
  test("what the node sends reads back as it was", () => {
    const sent = questsForWorld([view(), view({ quest: "q-2", state: "done", attempt: { of: "q", index: 2, attempts: 3 } })], 6000);
    expect(readWorldQuests(JSON.parse(JSON.stringify(sent)))).toEqual(sent);
  });

  test("bounded again, whatever is sent: long lines cut, extra steps and quests dropped, a veiled quest wordless", () => {
    const one = questsForWorld([view()], 6000)[0]!;
    const big = { ...one, plan: Array.from({ length: 20 }, () => "x".repeat(200)), title: "t".repeat(250) };
    const read = readWorldQuests(Array.from({ length: 30 }, () => big))!;
    expect(read).toHaveLength(WORLD_QUESTS.max);
    expect(read[0]!.plan).toHaveLength(WORLD_QUESTS.planLines);
    expect([...read[0]!.plan[0]!].length).toBe(WORLD_QUESTS.line);
    expect([...read[0]!.title].length).toBe(WORLD_QUESTS.title);
    const veiled = readWorldQuests([{ ...one, veiled: true }])![0]!;
    expect([veiled.title, veiled.plan, veiled.doneWhen, veiled.gates.map((g) => g.label)]).toEqual(["", [], "", ["", ""]]);
  });

  test("what isn't a quest is left out; what isn't a list is nothing", () => {
    const one = questsForWorld([view()], 6000)[0]!;
    expect(readWorldQuests([one, { ...one, state: "exploding" }, { ...one, id: "<script>" }, { ...one, step: -1 }, { ...one, plan: "1. no" }, null, 7])).toEqual([one]);
    expect(readWorldQuests({ quests: [] })).toBeNull();
    expect(readWorldQuests(undefined)).toBeNull();
  });
});
