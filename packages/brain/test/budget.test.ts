import { describe, expect, test } from "bun:test";
import type { ChatMessage } from "@galahad/core";
import { type QuestEvent, type QuestOptions, type QuestRole, runQuest } from "../src/quest.ts";

const sh = (command: string) => `Next.\n\`\`\`sh\n${command}\n\`\`\``;

/** A quest whose every model call costs `per` dollars (as its caller prices them), with a script for each role. */
function priced(engineer: string[], options: Partial<QuestOptions>, per = 0.1, complete = true) {
  const queues: Record<QuestRole, string[]> = { planner: ["1. Do it.\nDone when: it is done."], engineer: [...engineer], reviewer: ["PASS\nIt is."] };
  let usd = 0;
  const seen: { role: QuestRole; messages: ChatMessage[] }[] = [];
  const events: QuestEvent[] = [];
  const run = runQuest(
    { goal: "make it so", environment: "a test sandbox", ...options },
    {
      ask: async (role, messages) => {
        seen.push({ role, messages });
        usd += per;
        const text = queues[role].shift();
        if (text === undefined) throw new Error(`the ${role} ran out of script`);
        return { text, model: `test/${role}` };
      },
      exec: async () => ({ exitCode: 0, stdout: "ok\n", stderr: "", durationMs: 5, truncated: false }),
      emit: (event) => events.push(event),
      spentUsd: () => ({ usd, complete }),
    },
  );
  const told = () => seen.filter((s) => s.role === "engineer").map((s) => s.messages.at(-1)!.content);
  return { run, events, told };
}

describe("a budget in dollars", () => {
  test("each step says what is spent; past four fifths he is told to wrap up; spent, the work stops and what is there is judged", async () => {
    const q = priced(Array.from({ length: 10 }, (_, i) => sh(`echo ${i}`)), { budgetUsd: 0.6, submitAtLimit: true });
    const outcome = await q.run;
    expect(outcome.status).toBe("done");
    expect(outcome.summary).toContain("Its budget ($0.60) was spent before he said he was done");
    const told = q.told();
    expect(told[1]).toContain("(Spent $0.20 of $0.60.)");
    expect(told.some((m) => m.includes("of $0.60: wrap up."))).toBe(true);
    expect(q.events.filter((e) => e.type === "budget")).toEqual([
      { type: "budget", spentUsd: expect.closeTo(0.5, 5), budgetUsd: 0.6, out: false },
      { type: "budget", spentUsd: expect.closeTo(0.6, 5), budgetUsd: 0.6, out: true },
    ]);
  });

  test("without submitAtLimit a quest whose budget is spent stops, and says it was the budget", async () => {
    const q = priced(Array.from({ length: 10 }, (_, i) => sh(`echo ${i}`)), { budgetUsd: 0.3 });
    const outcome = await q.run;
    expect(outcome.status).toBe("stopped");
    expect(outcome.summary).toBe("Stopped: its budget ($0.30) was spent before he finished.");
  });

  test("with no budget nothing is said of money", async () => {
    const q = priced([sh("echo 1"), "DONE\nDone."], {});
    expect((await q.run).status).toBe("done");
    expect(q.told().some((m) => m.includes("Spent $"))).toBe(false);
    expect(q.events.some((e) => e.type === "budget")).toBe(false);
  });

  test("when some calls have no price, what is spent is said to be at least that", async () => {
    const q = priced([sh("echo 1"), "DONE\nDone."], { budgetUsd: 5 }, 0.1, false);
    await q.run;
    expect(q.told()[1]).toContain("(Spent at least $0.20 of $5.00: some calls have no price.)");
  });
});
