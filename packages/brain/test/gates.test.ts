import { describe, expect, test } from "bun:test";
import { type ChatMessage, type ExecResult, findSecrets } from "@galahad/core";
import { evidenceCollector } from "../src/effort.ts";
import type { AgentDriver, AgentEvent } from "../src/agents.ts";
import { parseProposedGates, type QuestEvent, type QuestOptions, type QuestRole, runQuest } from "../src/quest.ts";

/*
 * Gates: "done means this command passes". After the engineer says DONE every gate runs
 * in the quest's own sandbox, and each must exit 0 before the independent reviewer is
 * asked at all. A failing gate goes back to the engineer as a revision; a quest whose
 * gates never pass is never done.
 */

/** Obviously fake, but shaped like a real key so the scanner catches it. */
const FAKE_KEY = `sk-ant-api03-${"FAKE".repeat(8)}`;

const sh = (command: string, thought = "Next step.") => `${thought}\n\`\`\`sh\n${command}\n\`\`\``;

interface Script {
  planner?: string[];
  engineer: string[];
  reviewer?: string[];
  /** What a command answers, by the command itself (default: exit 0, "ok"). */
  exec?: (command: string, nth: number) => Partial<ExecResult> | Error;
}

function harness(script: Script, options: Partial<QuestOptions> = {}) {
  const queues: Record<QuestRole, string[]> = {
    planner: [...(script.planner ?? ["1. Do it.\nDone when: it is done."])],
    engineer: [...script.engineer],
    reviewer: [...(script.reviewer ?? ["PASS\nLooks right."])],
  };
  const seen: { role: QuestRole; messages: ChatMessage[] }[] = [];
  const commands: string[] = [];
  const events: QuestEvent[] = [];
  /** Everything that happened, in order: who was asked, what ran. */
  const order: string[] = [];
  const runs = new Map<string, number>();
  const run = runQuest(
    { goal: "make it so", environment: "a test sandbox", ...options },
    {
      ask: async (role, messages) => {
        seen.push({ role, messages });
        order.push(role);
        const text = queues[role].shift();
        if (text === undefined) throw new Error(`the ${role} ran out of script`);
        return { text, model: `test/${role}` };
      },
      exec: async (command) => {
        commands.push(command);
        order.push(`$ ${command}`);
        const nth = (runs.get(command) ?? 0) + 1;
        runs.set(command, nth);
        const answer = script.exec?.(command, nth) ?? {};
        if (answer instanceof Error) throw answer;
        return { exitCode: 0, stdout: "ok\n", stderr: "", durationMs: 5, truncated: false, ...answer };
      },
      emit: (event) => events.push(event),
    },
  );
  return { run, seen, commands, events, order };
}

const gateEvents = (events: QuestEvent[]) => events.filter((e): e is Extract<QuestEvent, { type: "gate" }> => e.type === "gate");
const reviews = (h: { seen: { role: QuestRole; messages: ChatMessage[] }[] }) => h.seen.filter((s) => s.role === "reviewer");

describe("gates on a quest", () => {
  test("every gate runs after DONE, in order, and only then is the reviewer asked", async () => {
    const h = harness({ engineer: [sh("echo hi > a.txt"), "DONE\nWrote it."] }, { gates: ["test -f a.txt", "grep -q hi a.txt"] });
    const outcome = await h.run;
    expect(outcome.status).toBe("done");
    expect(h.order).toEqual(["planner", "engineer", "$ echo hi > a.txt", "engineer", "$ test -f a.txt", "$ grep -q hi a.txt", "reviewer"]);
    // A gate is not one of the engineer's commands: the budget is his.
    expect(outcome.steps).toBe(1);
    expect(outcome.gates).toMatchObject([
      { command: "test -f a.txt", by: "owner", exitCode: 0 },
      { command: "grep -q hi a.txt", by: "owner", exitCode: 0 },
    ]);
    expect(gateEvents(h.events).map((e) => [e.index, e.of, e.round, e.exitCode])).toEqual([
      [1, 2, 1, 0],
      [2, 2, 1, 0],
    ]);
  });

  test("the engineer is told the gates up front, word for word, and that they are yours", async () => {
    const h = harness({ engineer: ["DONE\nok"] }, { gates: ["bun test --bail"] });
    await h.run;
    const briefing = h.seen.find((s) => s.role === "engineer")!.messages[0]!.content;
    expect(briefing).toContain("$ bun test --bail (set by your liege)");
    expect(briefing).toMatch(/each must exit 0 before your work goes to the reviewer/);
  });

  test("a failing gate goes back to the engineer with its command, exit code and output, and the reviewer isn't asked", async () => {
    const h = harness(
      {
        engineer: [sh("touch a.txt"), "DONE\nall good", sh("echo hi > a.txt"), "DONE\nnow it says hi"],
        exec: (command, nth) => (command === "grep -q hi a.txt" && nth === 1 ? { exitCode: 1, stdout: "", stderr: "no match in a.txt\n" } : {}),
      },
      { gates: ["grep -q hi a.txt"] },
    );
    const outcome = await h.run;
    expect(outcome.status).toBe("done");
    expect(outcome.revisions).toBe(1);
    // One review only: the first DONE never reached the reviewer.
    expect(reviews(h)).toHaveLength(1);
    expect(h.order).toEqual(["planner", "engineer", "$ touch a.txt", "engineer", "$ grep -q hi a.txt", "engineer", "$ echo hi > a.txt", "engineer", "$ grep -q hi a.txt", "reviewer"]);
    const sentBack = h.seen.filter((s) => s.role === "engineer")[2]!.messages.at(-1)!.content;
    expect(sentBack).toContain("$ grep -q hi a.txt");
    expect(sentBack).toContain("exit 1");
    expect(sentBack).toContain("no match in a.txt");
    expect(sentBack).toMatch(/You can't change the gates/);
    // The reviewer sees the gates as evidence: that they pass now, and the run that failed.
    const review = reviews(h)[0]!.messages[0]!.content;
    expect(review).toContain("Gates");
    expect(review).toContain("$ grep -q hi a.txt");
    expect(review).toMatch(/run 1[^\n]*exit 1/);
    expect(review).toContain("no match in a.txt");
    expect(h.events.filter((e) => e.type === "gated").map((e) => (e.type === "gated" ? [e.round, e.passed] : null))).toEqual([
      [1, false],
      [2, true],
    ]);
  });

  test("gates that never pass: the quest is never done, the reviewer is never asked, and it says which gate", async () => {
    const h = harness(
      { engineer: ["DONE\ntrust me", "DONE\nreally", "DONE\nplease"], exec: (command) => (command === "false" ? { exitCode: 1, stdout: "" } : {}) },
      { gates: ["true", "false"] },
    );
    const outcome = await h.run;
    expect(outcome.status).toBe("unverified");
    expect(outcome.revisions).toBe(2);
    expect(reviews(h)).toHaveLength(0);
    expect(outcome.review).toContain("$ false");
    expect(outcome.review).toMatch(/1 of 2 gates did not pass/);
    expect(outcome.gates).toMatchObject([
      { command: "true", exitCode: 0 },
      { command: "false", exitCode: 1 },
    ]);
    // Every gate ran on every submission (three DONEs: the first, and two revisions).
    expect(h.commands).toEqual(["true", "false", "true", "false", "true", "false"]);
  });

  test("a gate failure and a reviewer's REVISE share the one revision limit", async () => {
    const h = harness(
      {
        engineer: ["DONE\none", "DONE\ntwo", "DONE\nthree"],
        reviewer: ["REVISE\nNo evidence.", "REVISE\nStill none."],
        exec: (command, nth) => (command === "check" && nth === 1 ? { exitCode: 2 } : {}),
      },
      { gates: ["check"], maxRevisions: 2 },
    );
    const outcome = await h.run;
    // Gate failed (revision 1), reviewer said REVISE (revision 2), reviewer said REVISE again: the limit.
    expect(outcome.status).toBe("unverified");
    expect(outcome.revisions).toBe(2);
    expect(outcome.review).toBe("Still none.");
    expect(reviews(h)).toHaveLength(2);
  });

  test("a gate the sandbox can't run has not passed", async () => {
    const h = harness({ engineer: ["DONE\nok"], exec: (command) => (command === "check" ? new Error("sandbox gone") : {}) }, { gates: ["check"], maxRevisions: 0 });
    const outcome = await h.run;
    expect(outcome.status).toBe("unverified");
    expect(outcome.gates).toMatchObject([{ command: "check", exitCode: -1 }]);
    expect(outcome.review).toContain("sandbox gone");
    expect(reviews(h)).toHaveLength(0);
  });

  test("giving up, stopping and running out of commands stay what they were", async () => {
    const gaveUp = await harness({ engineer: ["GIVE UP\nCan't be done."] }, { gates: ["true"] }).run;
    expect(gaveUp.status).toBe("gave-up");
    expect(gaveUp.gates).toBeUndefined();
    const outOfSteps = harness({ engineer: [sh("a"), sh("b")] }, { gates: ["true"], maxSteps: 2 });
    expect((await outOfSteps.run).status).toBe("stopped");
    expect(outOfSteps.commands).toEqual(["a", "b"]);
  });

  test("a secret a gate prints never reaches a model", async () => {
    const h = harness(
      {
        engineer: ["DONE\nok", "DONE\nok again"],
        exec: (command, nth) => (command === "env" ? { exitCode: nth === 1 ? 1 : 0, stdout: `ANTHROPIC_API_KEY=${FAKE_KEY}\n` } : {}),
      },
      { gates: ["env"] },
    );
    const outcome = await h.run;
    expect(outcome.status).toBe("done");
    for (const { messages } of h.seen) for (const m of messages) expect(findSecrets(m.content)).toEqual([]);
    expect(findSecrets(JSON.stringify(outcome.gates))).toEqual([]);
    expect(findSecrets(JSON.stringify(h.events))).toEqual([]);
  });
});

describe("gates tried before the work (gatesFirst)", () => {
  // Seen on ultra on 14 November 2026: a squire's gate, `bun test`, could not run in its VM at all. That was found
  // out only after the work was done: eleven commands, two send-backs and $0.20 for a task that could never pass.
  const script = (exec: Script["exec"]) => harness({ engineer: [sh("echo fixed > calc.txt"), "DONE\nFixed."], exec }, { gates: ["bun test", "test -f calc.txt", "lint"], gatesFirst: true });

  test("each gate runs once before the engineer is asked anything, and he is told what each did: failing, passing already, or unable to run", async () => {
    const h = script((command, nth) => (command === "bun test" ? (nth === 1 ? { exitCode: 1, stdout: "1 fail\n" } : {}) : command === "lint" && nth === 1 ? { exitCode: 127, stdout: "", stderr: "bash: lint: command not found\n" } : {}));
    await h.run;
    // The plan, the three gates as the workspace stands, and only then the engineer.
    expect(h.order.slice(0, 5)).toEqual(["planner", "$ bun test", "$ test -f calc.txt", "$ lint", "engineer"]);
    const briefing = h.seen[1]!.messages[0]!.content;
    expect(briefing).toContain("Each was run once before you began, as the workspace stood");
    expect(briefing).toMatch(/1\. exit 1: it fails now, and must pass when you are done\./);
    expect(briefing).toMatch(/2\. exit 0: it passes already\. Its passing will show nothing about your work/);
    expect(briefing).toMatch(/3\. exit 127: it could not run here \(bash: lint: command not found\)\. If nothing in your workspace can make it run, reply GIVE UP and say so before you do the work\./);
    // It is an event of its own, never a submission's round of the gates.
    const baseline = h.events.find((e) => e.type === "baseline");
    expect(baseline).toMatchObject({ results: [{ command: "bun test", exitCode: 1 }, { command: "test -f calc.txt", exitCode: 0 }, { command: "lint", exitCode: 127 }] });
    expect(h.events.filter((e) => e.type === "gated").map((e) => (e as { round: number }).round)).toEqual([1]);
  });

  test("the reviewer is told too: a gate that passed before any work shows nothing by passing after it", async () => {
    const h = script((command, nth) => (command === "bun test" && nth === 1 ? { exitCode: 1, stdout: "1 fail\n" } : {}));
    const outcome = await h.run;
    expect(outcome.status).toBe("done");
    const review = h.seen.at(-1)!.messages[0]!.content;
    expect(review).toContain("Before any work was done, the same gates as the workspace stood then:");
    expect(review).toMatch(/1\. \$ bun test → exit 1\n/);
    expect(review).toMatch(/2\. \$ test -f calc\.txt → exit 0 \(it passed before any work: its passing now shows nothing about this work\)/);
    // What the quest came to keeps them, beside each gate's last run.
    expect(outcome.gatesBefore?.map((g) => g.exitCode)).toEqual([1, 0, 0]);
    expect(outcome.gates?.map((g) => g.exitCode)).toEqual([0, 0, 0]);
  });

  test("a secret a gate prints before the work reaches no model either, and a gate the sandbox can't run is one that could not run", async () => {
    const h = harness({ engineer: ["GIVE UP\nThe gate cannot run here."], exec: (command) => (command === "leak" ? { exitCode: 1, stdout: `KEY=${FAKE_KEY}\n` } : new Error("no such container")) }, { gates: ["leak", "broken"], gatesFirst: true });
    const outcome = await h.run;
    expect(outcome.status).toBe("gave-up");
    for (const { messages } of h.seen) for (const m of messages) expect(findSecrets(m.content)).toEqual([]);
    expect(h.seen[1]!.messages[0]!.content).toMatch(/2\. exit -1: it could not run here \(The sandbox could not run this: no such container\)/);
    expect(outcome.gatesBefore).toHaveLength(2);
  });

  test("without the switch nothing runs before the work, and nothing of it is said: a quest is what it was", async () => {
    const h = harness({ engineer: [sh("echo fixed"), "DONE\nFixed."] }, { gates: ["bun test"] });
    const outcome = await h.run;
    expect(h.order.slice(0, 2)).toEqual(["planner", "engineer"]);
    expect(h.seen[1]!.messages[0]!.content).not.toContain("before you began");
    expect(h.seen.at(-1)!.messages[0]!.content).not.toContain("Before any work");
    expect("gatesBefore" in outcome).toBe(false);
    expect(h.events.some((e) => e.type === "baseline")).toBe(false);
    // With the switch and no gates there is nothing to try.
    const none = harness({ engineer: ["DONE\nNothing to do."] }, { gatesFirst: true });
    await none.run;
    expect(none.order[1]).toBe("engineer");
  });
});

describe("gates the planner proposes", () => {
  test("read from its Gate: lines, at most three, a command each", () => {
    expect(parseProposedGates("1. Write it.\nDone when: the file says hi.\nGate: grep -q hi /work/out/a.txt")).toEqual(["grep -q hi /work/out/a.txt"]);
    expect(parseProposedGates("Done when: tests pass.\n- **Gate:** `bun test`\nGate:   \nGate: a\nGate: b\nGate: c")).toEqual(["bun test", "a", "b"]);
    expect(parseProposedGates("Done when: it is done.")).toEqual([]);
    expect(parseProposedGates(`Gate: ${"x".repeat(1001)}`)).toEqual([]);
  });

  test("the planner isn't asked for gates unless the quest allows it, and its Gate: lines are then only text", async () => {
    const h = harness({ planner: ["1. Do it.\nDone when: done.\nGate: false"], engineer: ["DONE\nok"] });
    const outcome = await h.run;
    expect(h.seen[0]!.messages[0]!.content).not.toContain("Gate:");
    expect(outcome.status).toBe("done");
    expect(outcome.gates).toBeUndefined();
    expect(h.commands).toEqual([]);
  });

  test("its proposals run after yours, marked as its own; yours are never dropped or rewritten", async () => {
    const h = harness(
      { planner: ["1. Do it.\nDone when: a.txt says hi.\nGate: grep -q hi a.txt\nGate: test -f a.txt"], engineer: ["DONE\nok"] },
      { gates: ["test -f a.txt", "  bun test  "], proposeGates: true },
    );
    const outcome = await h.run;
    expect(h.seen[0]!.messages[0]!.content).toMatch(/lines starting "Gate:"/);
    // Yours first, as you gave them; the planner's duplicate of yours isn't run twice.
    expect(h.commands).toEqual(["test -f a.txt", "  bun test  ", "grep -q hi a.txt"]);
    expect(outcome.gates!.map((g) => [g.command, g.by])).toEqual([
      ["test -f a.txt", "owner"],
      ["  bun test  ", "owner"],
      ["grep -q hi a.txt", "planner"],
    ]);
    const briefing = h.seen.find((s) => s.role === "engineer")!.messages[0]!.content;
    expect(briefing).toContain("$ grep -q hi a.txt (proposed by the planner)");
    expect(h.events.find((e) => e.type === "gates")).toEqual({
      type: "gates",
      gates: [
        { command: "test -f a.txt", by: "owner" },
        { command: "  bun test  ", by: "owner" },
        { command: "grep -q hi a.txt", by: "planner" },
      ],
    });
  });

  test("a plan fixed in advance proposes nothing", async () => {
    const h = harness({ planner: [], engineer: ["DONE\nok"] }, { plan: "1. Do it.\nGate: false", proposeGates: true });
    const outcome = await h.run;
    expect(outcome.status).toBe("done");
    expect(h.commands).toEqual([]);
  });
});

describe("gates with a coding agent", () => {
  /** A driver whose event stream is already Galahad's own events, a JSON list a line. */
  const driver: AgentDriver = { name: "stub", title: "Stub", kind: "openai", check: "true", files: () => ({}), command: () => "stub-agent", read: (line) => JSON.parse(line) as AgentEvent[] };

  test("a failing gate continues the agent's own session, and the reviewer is asked only once they pass", async () => {
    const prompts: string[] = [];
    const sessions: boolean[] = [];
    let gateRuns = 0;
    const asked: QuestRole[] = [];
    const ok = (stdout = ""): ExecResult => ({ exitCode: 0, stdout, stderr: "", durationMs: 1, truncated: false });
    const outcome = await runQuest(
      { goal: "g", environment: "e", gates: ["bun test"], agent: { driver, models: [{ provider: "p", model: "m" }], minutes: 5, workdir: "/work" } },
      {
        ask: async (role) => {
          asked.push(role);
          return { text: role === "planner" ? "1. x\nDone when: y" : "PASS", model: "t" };
        },
        exec: async (command) => {
          if (command === "bun test") {
            gateRuns += 1;
            return { ...ok(gateRuns === 1 ? "1 fail\n" : "all pass\n"), exitCode: gateRuns === 1 ? 1 : 0 };
          }
          // The agent's start: its message goes in as base64.
          const prompt = /printf %s '([A-Za-z0-9+/=]+)' \| base64 -d > \/work\/\.agent\/prompt\.md/.exec(command)?.[1];
          if (prompt) {
            prompts.push(Buffer.from(prompt, "base64").toString("utf8"));
            return ok();
          }
          if (command.startsWith("stat -c")) return ok("0\n");
          // Each poll: it has ended, having said what it did.
          if (command.startsWith("python3 -c") && command.includes("d, off =")) {
            sessions.push(true);
            return ok(JSON.stringify({ alive: false, exit: 0, next: 10, lines: [JSON.stringify([{ type: "session", id: "ses_1" }, { type: "text", text: "did it" }])] }));
          }
          return ok();
        },
        sleep: async () => {},
      },
    );
    expect(outcome.status).toBe("done");
    expect(outcome.revisions).toBe(1);
    expect(gateRuns).toBe(2);
    expect(asked).toEqual(["planner", "reviewer"]);
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain("$ bun test (set by your liege)");
    expect(prompts[1]).toMatch(/1 of 1 gate did not pass/);
    expect(prompts[1]).toContain("1 fail");
    expect(outcome.gates).toMatchObject([{ command: "bun test", by: "owner", exitCode: 0 }]);
  });
});

describe("gates in an attempt's evidence (effort)", () => {
  test("the comparison shows each gate's last result", () => {
    const collect = evidenceCollector();
    collect.emit({ type: "command", step: 1, command: "echo hi" });
    collect.emit({ type: "observation", step: 1, exitCode: 0, durationMs: 1, output: "exit 0 · 1 ms\nhi" });
    collect.emit({ type: "gated", round: 1, passed: false, results: [{ command: "bun test", by: "owner", exitCode: 1, durationMs: 3, excerpt: "1 fail" }] });
    collect.emit({ type: "gated", round: 2, passed: true, results: [{ command: "bun test", by: "owner", exitCode: 0, durationMs: 3, excerpt: "all pass" }] });
    const text = collect.text({ status: "done", summary: "ok", steps: 1, revisions: 1, plan: "p" });
    expect(text).toContain("Gates");
    expect(text).toContain("$ bun test");
    expect(text).toContain("exit 0");
    expect(text).toContain("all pass");
    expect(text).not.toContain("1 fail");
  });
});
