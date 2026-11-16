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

function harness(script: Script, options: { maxSteps?: number; maxRevisions?: number; abortAfterCommands?: number; submitAtLimit?: boolean } = {}) {
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
    { goal: "make it so", environment: "a test sandbox", maxSteps: options.maxSteps, maxRevisions: options.maxRevisions, ...(options.submitAtLimit ? { submitAtLimit: true } : {}) },
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

  test("the same command failing the same way is said to fail the same way, and a third time in a row stops the quest", async () => {
    const failing = { exitCode: 1, stdout: "", stderr: "error: cannot find module 'left-pad'", durationMs: 40 };
    const h = harness({ engineer: [sh("bun test"), sh("bun test"), sh("bun test"), sh("bun test")], outputs: [failing, { ...failing, durationMs: 55 }, { ...failing, durationMs: 61 }, failing] });
    const outcome = await h.run;
    expect(h.commands).toEqual(["bun test", "bun test", "bun test"]);
    const told = h.seen.filter((s) => s.role === "engineer").map((s) => s.messages.at(-1)!.content);
    expect(told[1]).not.toContain("the same way");
    expect(told[2]).toContain("The same command failed the same way 2 times in a row: running it again won't change that.");
    expect(outcome.status).toBe("stopped");
    expect(outcome.summary).toContain("Stopped: the same command failed the same way 3 times in a row");
    expect(outcome.summary).toContain("$ bun test");
  });

  test("a failure seen before, with other commands since, is said to be unchanged by them; another failure is just a failure", async () => {
    const failing = { exitCode: 1, stdout: "", stderr: "FAIL parser.test.ts: expected 2, got 3", durationMs: 40 };
    const h = harness({
      engineer: [sh("bun test"), sh("sed -i 's/3/2/' src/parser.ts"), sh("bun test"), sh("bun test --filter parser"), "DONE\nfixed"],
      outputs: [failing, { exitCode: 0, stdout: "" }, failing, { ...failing, stderr: "FAIL parser.test.ts: expected 2, got 4" }],
    });
    await h.run;
    const told = h.seen.filter((s) => s.role === "engineer").map((s) => s.messages.at(-1)!.content);
    expect(told[3]).toContain("This failed exactly as it did at step 1: what you changed since didn't change it.");
    expect(told[4]).not.toContain("exactly as it did");
    expect(told[4]).not.toContain("the same way");
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

  test("replies with no command to run are not commands: three in a row end the quest, and it says what the last one was", async () => {
    // Seen on ultra on 14 November 2026: a knight's engineer sent 16 such replies in a row. Sixteen model calls were
    // paid for, nothing ran, the task said "Stopped after 16 commands", and nothing of the replies was kept.
    const odd = "Listing first.\n```console\n$ ls -la\n```";
    const h = harness({ engineer: [odd, odd, odd, sh("ls"), "DONE\nok"] }, { maxSteps: 16 });
    const outcome = await h.run;
    expect(outcome.status).toBe("stopped");
    expect(h.commands).toEqual([]);
    // Three calls, not sixteen.
    expect(h.seen.filter((s) => s.role === "engineer")).toHaveLength(3);
    expect(outcome.malformed).toBe(3);
    expect(outcome.summary).toContain("3 replies in a row had no command to run");
    expect(outcome.summary).toContain("Your reply had no command block.");
    // What he sent is there to read: the quest's ending, and each reply's event as it happened.
    expect(outcome.summary).toContain("```console\n$ ls -la");
    const formats = h.events.filter((e) => e.type === "format");
    expect(formats).toHaveLength(3);
    expect(formats[0]).toMatchObject({ step: 1, problem: expect.stringContaining("no command block"), reply: odd });
  });

  test("a reply he gets right in between starts the count again, and the ending tells commands from replies without one", async () => {
    const odd = "```console\n$ ls\n```";
    const h = harness({ engineer: [odd, odd, sh("a"), odd, odd, sh("b"), sh("c")] }, { maxSteps: 7 });
    const outcome = await h.run;
    expect(outcome.status).toBe("stopped");
    expect(h.commands).toEqual(["a", "b", "c"]);
    // Each still spent one of his turns: seven in all.
    expect(outcome.steps).toBe(7);
    expect(outcome.malformed).toBe(4);
    expect(outcome.summary).toBe("Stopped after 7 turns without finishing: 3 commands ran, and 4 replies had no command to run.");
    // A quest with none says what it always said, and carries no count.
    const plain = await harness({ engineer: [sh("a"), sh("b")] }, { maxSteps: 2 }).run;
    expect(plain.summary).toBe("Stopped after 2 commands without finishing.");
    expect("malformed" in plain).toBe(false);
  });

  test("a secret in a reply with no command is not kept with it", async () => {
    const h = harness({ engineer: [`The key is ${FAKE_KEY}, I think.`, sh("ls"), "DONE\nok"] });
    await h.run;
    const format = h.events.find((e) => e.type === "format")!;
    expect(findSecrets(JSON.stringify(format))).toEqual([]);
  });

  test("he is told when his commands are running out: once at ten left, then on each of the last five", async () => {
    // Seen on ultra, 14 November 2026: a knight finished its change, went on checking, and ran out of its forty
    // commands without ever saying DONE. Nothing had told it how many were left since the briefing.
    const h = harness({ engineer: Array.from({ length: 14 }, (_, i) => sh(`echo ${i}`)) }, { maxSteps: 14 });
    await h.run;
    const told = h.seen.filter((s) => s.role === "engineer").map((s) => s.messages.at(-1)!.content);
    // (What he is told before each reply: the briefing, then each command's result.)
    const left = told.map((text) => /\((\d+) commands? left/.exec(text)?.[1] ?? null);
    expect(left).toEqual([null, null, null, null, "10", null, null, null, null, "5", "4", "3", "2", "1"]);
    expect(told[9]).toContain("(5 commands left. When the work is done and verified, reply DONE: what is never submitted is never reviewed.)");
    // A short quest is not told at every turn from its first.
    const short = harness({ engineer: [sh("a"), sh("b"), sh("c")] }, { maxSteps: 3 });
    await short.run;
    expect(short.seen.filter((s) => s.role === "engineer").map((s) => /commands? left/.test(s.messages.at(-1)!.content))).toEqual([false, true, true]);
  });

  test("out of commands with work done (submitAtLimit): what is there goes to the gates and the reviewer, and work they pass is done", async () => {
    const h = harness({ engineer: [sh("echo fixed > a.txt"), sh("cat a.txt")], reviewer: ["PASS\nThe file holds the fix and the commands show it."] }, { maxSteps: 2, submitAtLimit: true });
    const outcome = await h.run;
    expect(outcome.status).toBe("done");
    expect(outcome.steps).toBe(2);
    // The reviewer is told that nobody claimed it done: the evidence is all there is.
    expect(h.seen.at(-1)!.role).toBe("reviewer");
    expect(h.seen.at(-1)!.messages[0]!.content).toContain("He ran out of commands before he said he was done: this is the work as it stands.");
    expect(outcome.summary).toContain("ran out of commands");
    expect(outcome.review).toBe("The file holds the fix and the commands show it.");
  });

  test("out of commands and the reviewer isn't satisfied, or nothing ever ran: stopped, as it was, with what the reviewer said", async () => {
    const sentBack = harness({ engineer: [sh("echo half")], reviewer: ["REVISE\nNothing shows it works."] }, { maxSteps: 1, submitAtLimit: true });
    const outcome = await sentBack.run;
    expect(outcome.status).toBe("stopped");
    expect(outcome.summary).toBe("Stopped after 1 commands without finishing. What was there was put to the reviewer, who did not accept it.");
    expect(outcome.review).toBe("Nothing shows it works.");
    // Replies with no command are no work to submit.
    const odd = "```console\n$ ls\n```";
    const idle = harness({ engineer: [odd, odd] }, { maxSteps: 2, submitAtLimit: true });
    expect((await idle.run).status).toBe("stopped");
    expect(idle.seen.some((s) => s.role === "reviewer")).toBe(false);
    // Without the switch a quest is what it was: nobody is asked.
    const plain = harness({ engineer: [sh("a"), sh("b")] }, { maxSteps: 2 });
    expect((await plain.run).summary).toBe("Stopped after 2 commands without finishing.");
    expect(plain.seen.some((s) => s.role === "reviewer")).toBe(false);
  });

  test("a command block whose fence is wrapped in stray angle brackets is still a command", () => {
    // Seen on ultra, 14 November 2026: deepseek-v4-pro sent this three times in a row and the task ended with
    // nothing run. The command is plain to read; only the fence's decoration is off.
    expect(parseAction("I'll confirm the syntax first.\n\n<```sh>\ndesktop help\n```>")).toEqual({ kind: "command", command: "desktop help", thought: "I'll confirm the syntax first." });
    expect(parseAction("<```bash>\nls -la\n```>")).toMatchObject({ kind: "command", command: "ls -la" });
    // The ordinary forms are what they were, and two blocks are still two.
    expect(parseAction("Next.\n```sh\nls\n```")).toEqual({ kind: "command", command: "ls", thought: "Next." });
    expect(parseAction("<```sh>\na\n```>\n<```sh>\nb\n```>").kind).toBe("invalid");
    // A comparison inside a command is not a fence's decoration.
    expect(parseAction("```sh\ntest 1 -lt 2 && echo \"a > b\"\n```")).toMatchObject({ kind: "command", command: 'test 1 -lt 2 && echo "a > b"' });
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

describe("a model that couldn't answer is never passed over in silence", () => {
  test("when a role's first model fails and another answers, whoever watches is told once, with why and who answered instead", async () => {
    const events: QuestEvent[] = [];
    const replies: Record<QuestRole, string[]> = { planner: ["1. Do it.\nDone when: it is done."], engineer: [sh("echo hi"), sh("cat a.txt"), "DONE\nIt is there."], reviewer: ["PASS\nFine."] };
    const outcome = await runQuest(
      { goal: "make it so", environment: "a test sandbox" },
      {
        // The engineer's first model is refused every time; the reviewer's answers at once.
        ask: async (role) => ({
          text: replies[role].shift()!,
          model: `second/${role}`,
          ...(role === "engineer" ? { skipped: [{ model: "plan/first", error: `400 MissingSessionID ${FAKE_KEY}` }] } : {}),
        }),
        exec: async () => ({ exitCode: 0, stdout: "ok\n", stderr: "", durationMs: 5, truncated: false }),
        emit: (event) => events.push(event),
      },
    );
    expect(outcome.status).toBe("done");
    const told = events.filter((e) => e.type === "skipped");
    // Three engineer turns were each answered by the second model: said once, not three times.
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ type: "skipped", role: "engineer", model: "plan/first", answered: "second/engineer" });
    // What the provider said is shown, and nothing secret it echoed.
    expect((told[0] as { error: string }).error).toContain("400 MissingSessionID");
    expect(findSecrets(JSON.stringify(told))).toEqual([]);
    // It comes before that turn's own events.
    expect(events.findIndex((e) => e.type === "skipped")).toBeLessThan(events.findIndex((e) => e.type === "command"));
  });
});

describe("a reply of the engineer's that runs away", () => {
  test("its command runs as sent, but only its beginning and end stay in the conversation, and he is told", async () => {
    // A file written inline, far longer than anything a later turn needs to read again.
    const body = Array.from({ length: 30_000 }, (_, i) => `row ${i},${i * 7}`).join("\n");
    const huge = sh(`cat > data.csv <<'EOF'\n${body}\nEOF`, "Writing the data inline.");
    expect(huge.length).toBeGreaterThan(400_000);
    const h = harness({ engineer: [huge, sh("wc -l data.csv"), "DONE\nWrote data.csv."] });
    const outcome = await h.run;
    expect(outcome.status).toBe("done");
    // The sandbox was sent the command whole.
    expect(h.commands[0]!.length).toBeGreaterThan(400_000);
    expect(h.commands[0]).toContain("row 29999,209993");
    // Every later turn carries a short form of that reply: its start, its end, and how much was left out.
    const later = h.seen.filter((s) => s.role === "engineer").slice(1);
    expect(later).toHaveLength(2);
    for (const turn of later) {
      const reply = turn.messages[1]!;
      expect(reply.role).toBe("assistant");
      expect(reply.content.length).toBeLessThan(30_000);
      expect(reply.content).toContain("Writing the data inline.");
      expect(reply.content).toMatch(/… \[\d+ characters cut\] …/);
      expect(reply.content.endsWith("EOF\n```")).toBe(true);
      // No message of the conversation is beyond what a chat call takes.
      expect(Math.max(...turn.messages.map((m) => m.content.length))).toBeLessThan(400_000);
    }
    // He is told once, with the command's result, so he doesn't take the short form for what he sent.
    const told = later[0]!.messages[2]!.content;
    expect(told).toMatch(/^exit 0 · /);
    expect(told).toMatch(/Your reply was \d[\d,]* characters long: only its beginning and end are kept in this conversation \(the command ran as you sent it\)/);
    expect(later[1]!.messages[4]!.content).not.toContain("Your reply was");
    // The reviewer reads what was run: that command's beginning and end, with how much lies between, and the rest whole.
    const review = h.seen.find((s) => s.role === "reviewer")!.messages[0]!.content;
    expect(review.length).toBeLessThan(30_000);
    expect(review).toContain("1. $ cat > data.csv <<'EOF'\nrow 0,0");
    expect(review).toMatch(/… \[\d+ characters cut\] …/);
    expect(review).toContain("2. $ wc -l data.csv");
  });
});

describe("a long quest's conversation stays affordable, and stays the same", () => {
  test("older observations become excerpts a batch at a time: between batches every turn's conversation begins with the turn before's, whole", async () => {
    const n = 26;
    const page = "x".repeat(3000);
    const h = harness(
      { engineer: [...Array.from({ length: n }, (_, i) => sh(`echo ${i}`)), "DONE\nAll of them ran."], outputs: Array.from({ length: n }, (_, i) => ({ stdout: `out ${i}\n${page}\n` })) },
      { maxSteps: 30 },
    );
    expect((await h.run).status).toBe("done");
    const turns = h.seen.filter((s) => s.role === "engineer").map((s) => s.messages);
    expect(turns).toHaveLength(n + 1);
    // A provider reads a prompt's unchanged beginning from its cache: a turn that rewrites something earlier pays for
    // everything after it again. Cutting one more observation every turn did that on every turn past the ninth.
    let rewritten = 0;
    for (let t = 1; t < turns.length; t++) if (JSON.stringify(turns[t]!.slice(0, turns[t - 1]!.length)) !== JSON.stringify(turns[t - 1])) rewritten += 1;
    expect(rewritten).toBeGreaterThan(0);
    expect(rewritten).toBeLessThanOrEqual(3);
    for (const messages of turns) {
      const observations = messages.filter((m, i) => i > 0 && m.role === "user" && m.content.startsWith("exit 0"));
      const whole = observations.filter((m) => m.content.includes(page));
      // Affordable: never more than a dozen whole, the newest four always among them, and what was cut says so.
      expect(whole.length).toBeLessThanOrEqual(12);
      expect(observations.slice(-4).every((m) => m.content.includes(page))).toBe(true);
      for (const m of observations.filter((o) => !o.content.includes(page))) expect(m.content).toMatch(/… \[\d+ characters cut\] …/);
    }
    // By the end all but the newest few are excerpts.
    expect(turns.at(-1)!.filter((m) => m.content.includes(page)).length).toBeLessThanOrEqual(12);
    expect(turns.at(-1)!.filter((m) => /characters cut/.test(m.content)).length).toBeGreaterThanOrEqual(14);
  });

  test("an older run of a command that ran again later, both in the part cut short, is a line, not an excerpt; the beginning still holds between batches", async () => {
    const n = 26;
    const page = "y".repeat(3000);
    // The tests, run again after each change: their older failures are superseded by the newer runs.
    const commands = Array.from({ length: n }, (_, i) => (i % 2 === 0 ? "bun test" : `sed -i 's/a${i}/b${i}/' src/x.ts`));
    const h = harness(
      {
        engineer: [...commands.map((c) => sh(c)), "DONE\nThe tests pass."],
        outputs: commands.map((c, i) => (c === "bun test" ? { exitCode: 1, stdout: `${i} fail\n${page}\n` } : { stdout: "" })),
      },
      { maxSteps: 30 },
    );
    expect((await h.run).status).toBe("done");
    const turns = h.seen.filter((s) => s.role === "engineer").map((s) => s.messages);
    let rewritten = 0;
    for (let t = 1; t < turns.length; t++) if (JSON.stringify(turns[t]!.slice(0, turns[t - 1]!.length)) !== JSON.stringify(turns[t - 1])) rewritten += 1;
    expect(rewritten).toBeLessThanOrEqual(3);
    const last = turns.at(-1)!.filter((m, i) => i > 0 && m.role === "user" && /^exit -?\d+ · /.test(m.content));
    const superseded = last.filter((m) => m.content.includes("(superseded:"));
    // Each is its first line and what superseded it; the newest runs stay whole, and the last cut one of each command an excerpt.
    expect(superseded.length).toBeGreaterThanOrEqual(8);
    for (const m of superseded) expect(m.content).toMatch(/^exit 1 · \d+ ms\n\(superseded: `bun test` ran again later, and what it printed then is further on\)$/);
    expect(last.slice(-4).every((m) => m.content.includes(page) || m.content.startsWith("exit 0"))).toBe(true);
    const runs = last.filter((m) => m.content.startsWith("exit 1"));
    expect(runs.at(-1)!.content).toContain(page);
    expect(runs.filter((m) => /characters cut/.test(m.content)).length).toBeGreaterThanOrEqual(1);
  });

  test("a file read before a later command changed it, both in the part cut short, is a line saying so; one never changed stays an excerpt", async () => {
    const n = 26;
    const page = "z".repeat(3000);
    // Each file is read, then edited in place; the last file is only read, never edited.
    const commands = Array.from({ length: n }, (_, i) => (i % 2 === 0 ? `cat src/f${i}.ts` : `sed -i 's/a/b/' src/f${i - 1}.ts`));
    commands[0] = "cat src/kept.ts";
    const h = harness(
      {
        engineer: [...commands.map((c) => sh(c)), "DONE\nEdited."],
        outputs: commands.map((c) => (c.startsWith("cat") ? { stdout: `${page}\n` } : { stdout: "" })),
      },
      { maxSteps: 30 },
    );
    expect((await h.run).status).toBe("done");
    const turns = h.seen.filter((s) => s.role === "engineer").map((s) => s.messages);
    let rewritten = 0;
    for (let t = 1; t < turns.length; t++) if (JSON.stringify(turns[t]!.slice(0, turns[t - 1]!.length)) !== JSON.stringify(turns[t - 1])) rewritten += 1;
    expect(rewritten).toBeLessThanOrEqual(3);
    const last = turns.at(-1)!.filter((m, i) => i > 0 && m.role === "user" && /^exit -?\d+ · /.test(m.content));
    const stale = last.filter((m) => m.content.includes("(stale:"));
    expect(stale.length).toBeGreaterThanOrEqual(8);
    for (const m of stale) expect(m.content).toMatch(/^exit 0 · \d+ ms\n\(stale: `src\/f\d+\.ts` was changed later, by `sed -i 's\/a\/b\/' src\/f\d+\.ts`; read it again for what it holds now\)$/);
    // The file never edited is still an excerpt of what it held.
    expect(last[0]!.content).toMatch(/characters cut/);
    expect(last[0]!.content).not.toContain("(stale:");
    // The newest reads stay whole.
    expect(last.slice(-4).some((m) => m.content.includes(page))).toBe(true);
  });
});

