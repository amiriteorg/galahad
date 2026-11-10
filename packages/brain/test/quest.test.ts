import { describe, expect, test } from "bun:test";
import { type ChatMessage, type ExecResult, findSecrets } from "@galahad/core";
import { clip, observation, parseAction, parseVerdict, type QuestEvent, type QuestRole, runQuest } from "../src/quest.ts";

/** Obviously fake, but shaped like a real key so the scanner catches it. */
const FAKE_KEY = `sk-ant-api03-${"FAKE".repeat(8)}`;

interface Script {
  planner?: string[];
  engineer: string[];
  reviewer?: string[];
  outputs?: Partial<ExecResult>[];
}

function harness(script: Script, options: { maxSteps?: number; maxRevisions?: number; abortAfterCommands?: number } = {}) {
  const queues: Record<QuestRole, string[]> = {
    planner: [...(script.planner ?? ["1. Do it.\nDone when: it is done."])],
    engineer: [...script.engineer],
    reviewer: [...(script.reviewer ?? ["PASS\nLooks right."])],
  };
  const outputs = [...(script.outputs ?? [])];
  const seen: { role: QuestRole; messages: ChatMessage[] }[] = [];
  const commands: string[] = [];
  const events: QuestEvent[] = [];
  const controller = new AbortController();
  const run = runQuest(
    { goal: "make it so", environment: "a test sandbox", maxSteps: options.maxSteps, maxRevisions: options.maxRevisions },
    {
      ask: async (role, messages) => {
        seen.push({ role, messages });
        const text = queues[role].shift();
        if (text === undefined) throw new Error(`the ${role} ran out of script`);
        return { text, model: `test/${role}` };
      },
      exec: async (command) => {
        commands.push(command);
        if (options.abortAfterCommands && commands.length >= options.abortAfterCommands) controller.abort();
        return { exitCode: 0, stdout: "ok\n", stderr: "", durationMs: 5, truncated: false, ...outputs.shift() };
      },
      emit: (event) => events.push(event),
      signal: controller.signal,
    },
  );
  return { run, seen, commands, events };
}

const sh = (command: string, thought = "Next step.") => `${thought}\n\`\`\`sh\n${command}\n\`\`\``;

describe("quests", () => {
  test("plan, work, review: a clean run", async () => {
    const h = harness({ engineer: [sh("echo hi > a.txt"), sh("cat a.txt"), "DONE\nWrote a.txt; cat shows hi."] });
    const outcome = await h.run;
    expect(outcome.status).toBe("done");
    expect(outcome.steps).toBe(2);
    expect(h.commands).toEqual(["echo hi > a.txt", "cat a.txt"]);
    expect(h.seen.map((s) => s.role)).toEqual(["planner", "engineer", "engineer", "engineer", "reviewer"]);
    // The engineer gets the plan; the reviewer gets the evidence.
    expect(h.seen[1]!.messages[0]!.content).toContain("Done when: it is done.");
    const review = h.seen.at(-1)!.messages[0]!.content;
    expect(review).toContain("$ cat a.txt");
    expect(review).toContain("Wrote a.txt");
    expect(h.events.at(-1)).toEqual({ type: "finished", outcome });
  });

  test("the reviewer can send the work back, and the engineer sees why", async () => {
    const h = harness({
      engineer: [sh("touch a"), "DONE\nall good", sh("bun test"), "DONE\ntests pass"],
      reviewer: ["REVISE\nThere is no evidence the tests pass.", "PASS"],
    });
    const outcome = await h.run;
    expect(outcome.status).toBe("done");
    expect(outcome.revisions).toBe(1);
    const engineerAfterReview = h.seen.filter((s) => s.role === "engineer")[2]!.messages.at(-1)!.content;
    expect(engineerAfterReview).toContain("There is no evidence the tests pass.");
  });

  test("if the reviewer never accepts, the outcome says unverified", async () => {
    const h = harness({ engineer: ["DONE\ntrust me", "DONE\nreally"], reviewer: ["REVISE\nno evidence", "REVISE\nstill none"] }, { maxRevisions: 1 });
    const outcome = await h.run;
    expect(outcome.status).toBe("unverified");
    expect(outcome.review).toBe("still none");
  });

  test("a reviewer that isn't clear is not an approval", () => {
    expect(parseVerdict("Looks mostly fine, I think.").verdict).toBe("revise");
    expect(parseVerdict("**PASS**\nverified").verdict).toBe("pass");
    expect(parseVerdict("REVISE\nfix x").notes).toBe("fix x");
  });

  test("a malformed reply gets a reminder and spends a step", async () => {
    const h = harness({ engineer: ["I will now think.", `${sh("a")}\n${sh("b")}`, sh("ls"), "DONE\nok"] });
    const outcome = await h.run;
    expect(outcome.status).toBe("done");
    expect(outcome.steps).toBe(3);
    expect(h.commands).toEqual(["ls"]);
    expect(h.events.filter((e) => e.type === "format")).toHaveLength(2);
  });

  test("the step budget is a hard limit", async () => {
    const h = harness({ engineer: [sh("a"), sh("b"), sh("c"), sh("d")] }, { maxSteps: 3 });
    const outcome = await h.run;
    expect(outcome.status).toBe("stopped");
    expect(h.commands).toEqual(["a", "b", "c"]);
  });

  test("giving up is an honest outcome, not an error", async () => {
    const h = harness({ engineer: ["GIVE UP\nThe repository is private and the sandbox has no credentials."] });
    const outcome = await h.run;
    expect(outcome.status).toBe("gave-up");
    expect(outcome.summary).toContain("private");
  });

  test("stopping cancels between steps", async () => {
    const h = harness({ engineer: [sh("a"), sh("b"), sh("c")] }, { abortAfterCommands: 1 });
    const outcome = await h.run;
    expect(outcome.status).toBe("stopped");
    expect(h.commands).toEqual(["a"]);
  });

  test("secrets in command output never reach a model", async () => {
    const h = harness({
      engineer: [sh("env"), "DONE\nprinted the environment"],
      outputs: [{ stdout: `ANTHROPIC_API_KEY=${FAKE_KEY}\nPATH=/usr/bin\n` }],
    });
    await h.run;
    for (const { messages } of h.seen) for (const m of messages) expect(findSecrets(m.content)).toEqual([]);
    expect(h.seen.at(-2)!.messages.at(-1)!.content).toContain("[redacted");
  });

  test("a failing sandbox becomes an observation, not a crash", async () => {
    const replies: Record<QuestRole, string[]> = { planner: ["1. x"], engineer: [sh("ls"), "DONE\nok"], reviewer: ["PASS"] };
    const engineerSaw: ChatMessage[][] = [];
    const outcome = await runQuest(
      { goal: "g", environment: "e" },
      {
        ask: async (role, messages) => {
          if (role === "engineer") engineerSaw.push(messages);
          return { text: replies[role].shift()!, model: "t" };
        },
        exec: async () => {
          throw new Error("sandbox gone");
        },
      },
    );
    expect(outcome.status).toBe("done");
    expect(engineerSaw[1]!.at(-1)!.content).toContain("sandbox gone");
  });

  test("a model that fails mid-reply (an outage) is asked again after a pause, not the end of the quest", async () => {
    // Seen live: "The upstream provider is temporarily unavailable" after the reply had begun,
    // which the roster can't fall back from; the quest died with the work half done.
    const replies: Record<QuestRole, string[]> = { planner: ["1. x"], engineer: [sh("ls"), "DONE\nok"], reviewer: ["PASS"] };
    let failures = 2;
    const pauses: number[] = [];
    const events: QuestEvent[] = [];
    const outcome = await runQuest(
      { goal: "g", environment: "e" },
      {
        ask: async (role) => {
          if (role === "engineer" && failures > 0) {
            failures -= 1;
            throw new Error("the engineer could not answer: orcarouter: The upstream provider is temporarily unavailable.");
          }
          return { text: replies[role].shift()!, model: "t" };
        },
        exec: async () => ({ exitCode: 0, stdout: "ok", stderr: "", durationMs: 1, truncated: false }),
        emit: (event) => events.push(event),
        sleep: async (ms) => void pauses.push(ms),
      },
    );
    expect(outcome.status).toBe("done");
    expect(pauses).toHaveLength(2);
    expect(pauses[1]!).toBeGreaterThan(pauses[0]!);
    expect(events.filter((e) => e.type === "retry")).toHaveLength(2);
  });

  test("a model that keeps failing ends the quest with the error, after a few tries", async () => {
    let calls = 0;
    const run = runQuest(
      { goal: "g", environment: "e" },
      {
        ask: async () => {
          calls += 1;
          throw new Error("no model in the roster could answer");
        },
        exec: async () => ({ exitCode: 0, stdout: "", stderr: "", durationMs: 1, truncated: false }),
        sleep: async () => {},
      },
    );
    await expect(run).rejects.toThrow(/no model in the roster could answer/);
    expect(calls).toBe(4);
  });
});

describe("the protocol", () => {
  test("one fenced block is a command, in any common shell dialect", () => {
    for (const lang of ["sh", "bash", "shell", ""]) {
      const action = parseAction(`Look around.\n\`\`\`${lang}\nls -la\n\`\`\``);
      expect(action).toEqual({ kind: "command", command: "ls -la", thought: "Look around." });
    }
  });

  test("DONE on the first line wins, even with code in the summary", () => {
    const action = parseAction("DONE\nThe test passes:\n```sh\nbun test\n```");
    expect(action.kind).toBe("done");
  });

  test("DONE elsewhere is not a submission", () => {
    expect(parseAction("Almost DONE, one more check.").kind).toBe("invalid");
  });

  test("long output keeps its head and tail", () => {
    const text = `${"a".repeat(10_000)}MIDDLE${"z".repeat(10_000)}`;
    const clipped = clip(text);
    expect(clipped.startsWith("aaaa")).toBe(true);
    expect(clipped.endsWith("zzzz")).toBe(true);
    expect(clipped).not.toContain("MIDDLE");
    expect(clipped.length).toBeLessThan(9_000);
  });

  test("observations carry the exit code and both streams", () => {
    const seen = observation({ exitCode: 2, stdout: "out", stderr: "err", durationMs: 7, truncated: false });
    expect(seen).toBe("exit 2 · 7 ms\nout\nstderr:\nerr");
    expect(observation({ exitCode: 137, stdout: "", stderr: "", durationMs: 1, truncated: false })).toContain("time limit");
  });
});
