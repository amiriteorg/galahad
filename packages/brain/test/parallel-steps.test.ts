import { describe, expect, test } from "bun:test";
import type { ChatMessage, ExecResult } from "@galahad/core";
import { type QuestEvent, type QuestRole, runQuest } from "../src/quest.ts";

/*
 * Parallel sub-steps: with effort, the engineer may send several commands that
 * don't depend on each other in one reply; they run at the same time in the same
 * sandbox. Each still counts against the step budget, each is in the evidence, and
 * without the option the protocol is exactly what it was.
 */

const fence = "```";
const sh = (...commands: string[]) => `Next.\n${commands.map((c) => `${fence}sh\n${c}\n${fence}`).join("\n")}`;

function harness(engineer: string[], options: { parallelCommands?: number; maxSteps?: number } = {}) {
  const queues: Record<QuestRole, string[]> = { planner: ["1. Do it."], engineer: [...engineer], reviewer: ["PASS"] };
  const seen: { role: QuestRole; messages: ChatMessage[] }[] = [];
  const events: QuestEvent[] = [];
  let running = 0;
  let peak = 0;
  const commands: string[] = [];
  const run = runQuest(
    { goal: "make it so", environment: "a test sandbox", ...options },
    {
      ask: async (role, messages) => {
        seen.push({ role, messages });
        const text = queues[role].shift();
        if (text === undefined) throw new Error(`the ${role} ran out of script`);
        return { text, model: `test/${role}` };
      },
      exec: async (command): Promise<ExecResult> => {
        commands.push(command);
        running += 1;
        peak = Math.max(peak, running);
        await Bun.sleep(15);
        running -= 1;
        return { exitCode: command.includes("fail") ? 1 : 0, stdout: `ran ${command}\n`, stderr: "", durationMs: 15, truncated: false };
      },
      emit: (event) => events.push(event),
      sleep: async () => {},
    },
  );
  return { run, seen, events, commands, peak: () => peak };
}

describe("parallel sub-steps", () => {
  test("several commands in one reply run at the same time; every result comes back, in order", async () => {
    const h = harness([sh("test-a", "test-b fail", "test-c"), "DONE\nAll three ran."], { parallelCommands: 3 });
    const outcome = await h.run;
    expect(outcome).toMatchObject({ status: "done", steps: 3 });
    expect(h.peak()).toBe(3);
    const back = h.seen.filter((s) => s.role === "engineer")[1]!.messages.at(-1)!.content;
    expect(back).toMatch(/^\[1\] \$ test-a\nexit 0/);
    expect(back).toContain("[2] $ test-b fail\nexit 1");
    expect(back).toContain("[3] $ test-c\nexit 0");
    // Each is a step of its own in what's shown and in the reviewer's evidence.
    expect(h.events.filter((e) => e.type === "command").map((e) => (e as { step: number }).step)).toEqual([1, 2, 3]);
    const review = h.seen.find((s) => s.role === "reviewer")!.messages[0]!.content;
    expect(review).toContain("$ test-b fail");
    expect(review).toContain("exit 1");
    // The briefing says they may, and how many.
    expect(h.seen.find((s) => s.role === "engineer")!.messages[0]!.content).toMatch(/up to 3 separate/);
  });

  test("more blocks than allowed is a malformed reply; the step budget still holds", async () => {
    const tooMany = harness([sh("a", "b", "c"), sh("a"), "DONE\nok"], { parallelCommands: 2 });
    await tooMany.run;
    expect(tooMany.commands).toEqual(["a"]);
    expect(tooMany.events.filter((e) => e.type === "format")).toHaveLength(1);

    const budget = harness([sh("a", "b"), sh("c", "d"), sh("e")], { parallelCommands: 2, maxSteps: 3 });
    const outcome = await budget.run;
    expect(outcome.status).toBe("stopped");
    expect(budget.commands).toEqual(["a", "b", "c"]);
  });

  test("without the option, two blocks are refused as they always were, and the briefing doesn't offer it", async () => {
    const h = harness([sh("a", "b"), sh("a"), "DONE\nok"]);
    await h.run;
    expect(h.commands).toEqual(["a"]);
    expect(h.seen.find((s) => s.role === "engineer")!.messages[0]!.content).not.toMatch(/separate/);
  });
});
