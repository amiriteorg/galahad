import { describe, expect, test } from "bun:test";
import type { ChatMessage, ExecResult } from "@galahad/core";
import type { AgentDriver, AgentEvent } from "../src/agents.ts";
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

/**
 * A coding agent at work (a stub whose events are Galahad's own), each look at it costing `perPoll` dollars of its own
 * calls through the gateway, as the caller counts them; it ends of itself after `polls` looks. The planner and the
 * reviewer cost `perAsk` a call.
 */
function agentAtWork(options: Partial<QuestOptions>, { perPoll, polls = 6, perAsk = 0, reviewer = ["PASS\nIt holds."] }: { perPoll: number; polls?: number; perAsk?: number; reviewer?: string[] }) {
  const driver: AgentDriver = { name: "stub", title: "Stub", kind: "openai", check: "true", files: () => ({}), command: () => "stub-agent", read: (line) => JSON.parse(line) as AgentEvent[] };
  const ok = (stdout = ""): ExecResult => ({ exitCode: 0, stdout, stderr: "", durationMs: 1, truncated: false });
  const queues: Record<QuestRole, string[]> = { planner: ["1. Do it.\nDone when: it is done."], engineer: [], reviewer: [...reviewer] };
  let usd = 0;
  let looked = 0;
  const events: QuestEvent[] = [];
  const prompts: string[] = [];
  let stopped = 0;
  const run = runQuest(
    { goal: "make it so", environment: "a test sandbox", agent: { driver, models: [{ provider: "p", model: "m" }], minutes: 60, workdir: "/work" }, ...options },
    {
      ask: async (role) => {
        usd += perAsk;
        const text = queues[role].shift();
        if (text === undefined) throw new Error(`the ${role} ran out of script`);
        return { text, model: `test/${role}` };
      },
      exec: async (command) => {
        const prompt = /printf %s '([A-Za-z0-9+/=]+)' \| base64 -d > \/work\/\.agent\/prompt\.md/.exec(command)?.[1];
        if (prompt) {
          prompts.push(Buffer.from(prompt, "base64").toString("utf8"));
          return ok();
        }
        if (command.startsWith("stat -c")) return ok("0\n");
        if (command.startsWith("python3 -c") && command.includes("d, off =")) {
          looked += 1;
          usd += perPoll;
          const lines = [JSON.stringify([{ type: "session", id: "ses_1" }, { type: "tool", tool: "bash", input: `step ${looked}`, output: "ok", ok: true }, { type: "text", text: `did ${looked}` }])];
          return ok(JSON.stringify({ alive: looked < polls, exit: looked < polls ? null : 0, next: looked * 10, lines }));
        }
        return ok();
      },
      stopAgent: async () => void (stopped += 1),
      emit: (event) => events.push(event),
      spentUsd: () => ({ usd, complete: true }),
      sleep: async () => {},
    },
  );
  return { run, events, prompts, budget: () => events.filter((e) => e.type === "budget"), stopped: () => stopped, looked: () => looked };
}

describe("a coding agent, held to its budget", () => {
  test("its own calls count as it works: past four fifths it is said, and spent, the agent is stopped and what it left is judged", async () => {
    const q = agentAtWork({ budgetUsd: 0.5, submitAtLimit: true }, { perPoll: 0.2 });
    const outcome = await q.run;
    expect(q.looked()).toBe(3);
    expect(q.stopped()).toBe(1);
    expect(q.budget()).toEqual([
      { type: "budget", spentUsd: expect.closeTo(0.4, 5), budgetUsd: 0.5, out: false },
      { type: "budget", spentUsd: expect.closeTo(0.6, 5), budgetUsd: 0.5, out: true },
    ]);
    expect(outcome.status).toBe("done");
    expect(outcome.summary).toBe("Its budget ($0.50) was spent before he said he was done. The work as it stood was put to the reviewer, who accepted it.");
  });

  test("without submitAtLimit it stops, saying it was the budget", async () => {
    const q = agentAtWork({ budgetUsd: 0.5 }, { perPoll: 0.2 });
    const outcome = await q.run;
    expect(q.stopped()).toBe(1);
    expect(outcome.status).toBe("stopped");
    expect(outcome.summary).toBe("Stopped: its budget ($0.50) was spent before he finished.");
  });

  test("work sent back isn't taken up again once the budget is spent: it ends with the reviewer's word", async () => {
    const q = agentAtWork({ budgetUsd: 0.5 }, { perPoll: 0.1, polls: 2, perAsk: 0.2, reviewer: ["REVISE\nThe test still fails."] });
    const outcome = await q.run;
    expect(q.prompts).toHaveLength(1);
    expect(q.stopped()).toBe(0);
    expect(outcome.status).toBe("unverified");
    expect(outcome.review).toBe("The test still fails.");
    expect(q.budget().at(-1)).toEqual({ type: "budget", spentUsd: expect.closeTo(0.6, 5), budgetUsd: 0.5, out: true });
  });

  test("with no budget nothing is said of money and the agent works to its end", async () => {
    const q = agentAtWork({}, { perPoll: 5, polls: 4 });
    expect((await q.run).status).toBe("done");
    expect(q.looked()).toBe(4);
    expect(q.stopped()).toBe(0);
    expect(q.budget()).toEqual([]);
  });
});
