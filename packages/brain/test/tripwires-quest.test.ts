import { describe, expect, test } from "bun:test";
import type { ChatMessage, ExecResult, NamedRule } from "@galahad/core";
import { commandsRun, type QuestEvent, type QuestOptions, type QuestRole, runQuest } from "../src/quest.ts";

/*
 * Your tripwires in the quest loop: checked before each command it runs (one, or each of a parallel batch) and each
 * gate, against your rules as they stand at that moment. `halt`: the quest stops, saying which rule. `refuse`: that
 * command isn't run, the engineer is told which rule refused it and why, and the work goes on. Each trip is an event
 * and is handed to whoever keeps the ledger. Nothing that a tripwire stopped is counted as a command that ran.
 */

const fence = "```";
const sh = (...commands: string[]) => `Next.\n${commands.map((c) => `${fence}sh\n${c}\n${fence}`).join("\n")}`;
const rule = (name: string, does: "halt" | "refuse", words: string[], contains?: string): NamedRule => ({ name, on: "command", does, words, ...(contains !== undefined ? { contains } : {}) });

type Tripped = Extract<QuestEvent, { type: "tripped" }>;

function harness(script: Partial<Record<QuestRole, string[]>>, rules: NamedRule[] | (() => NamedRule[]), options: Partial<QuestOptions> = {}) {
  const queues: Record<QuestRole, string[]> = { planner: ["1. Do it."], engineer: [], reviewer: ["PASS\nIt holds up."], ...script };
  const seen: { role: QuestRole; messages: ChatMessage[] }[] = [];
  const events: QuestEvent[] = [];
  const commands: string[] = [];
  const told: { rule: string; does: string; why: string; command: string; gate?: boolean }[] = [];
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
        await Bun.sleep(1);
        return { exitCode: command.includes("fail") ? 1 : 0, stdout: `ran ${command}\n`, stderr: "", durationMs: 1, truncated: false };
      },
      rules: () => (typeof rules === "function" ? rules() : rules),
      tripped: async (trip) => void told.push(trip),
      emit: (event) => events.push(event),
      sleep: async () => {},
    },
  );
  const engineerSaw = (turn: number) => seen.filter((s) => s.role === "engineer")[turn]!.messages.at(-1)!.content;
  const trips = () => events.filter((e): e is Tripped => e.type === "tripped");
  return { run, seen, events, commands, told, engineerSaw, trips };
}

describe("refuse", () => {
  test("the command isn't run; the engineer is told which rule refused it and why; the work goes on", async () => {
    const h = harness({ engineer: [sh("rm -f bun.lock"), sh("echo fixed"), "DONE\nFixed without touching the lockfile."] }, [rule("no-locks", "refuse", ["*.lock"])]);
    const outcome = await h.run;
    expect(h.commands).toEqual(["echo fixed"]);
    expect(h.engineerSaw(1)).toStartWith('Not run: your liege\'s tripwire "no-locks" refuses this command (the word `bun.lock` matches `*.lock`).');
    expect(h.trips()).toEqual([{ type: "tripped", step: 1, command: "rm -f bun.lock", rule: "no-locks", does: "refuse", why: "the word `bun.lock` matches `*.lock`" }]);
    // Never shown as a command that ran.
    expect(h.events.filter((e) => e.type === "command").map((e) => (e as { command: string }).command)).toEqual(["echo fixed"]);
    expect(h.told).toEqual([{ rule: "no-locks", does: "refuse", why: "the word `bun.lock` matches `*.lock`", command: "rm -f bun.lock" }]);
    expect(outcome).toMatchObject({ status: "done", steps: 2, tripped: 1 });
    expect(commandsRun(outcome)).toBe(1);
    // The reviewer sees it was tried and not run.
    const review = h.seen.find((s) => s.role === "reviewer")!.messages[0]!.content;
    expect(review).toContain('$ rm -f bun.lock\n   exit -1\n   Not run: your liege\'s tripwire "no-locks"');
  });

  test("the same refused command three times in a row ends the quest, as a command that fails the same way does", async () => {
    const h = harness({ engineer: [sh("rm x"), sh("rm x"), sh("rm x"), sh("echo never")] }, [rule("no-rm", "refuse", ["rm"])]);
    const outcome = await h.run;
    expect(h.commands).toEqual([]);
    expect(outcome.status).toBe("stopped");
    expect(outcome.summary).toContain("3 times in a row");
    expect(h.engineerSaw(2)).toContain("2 times in a row");
    expect(outcome).toMatchObject({ steps: 3, tripped: 3 });
    expect(commandsRun(outcome)).toBe(0);
  });
});

describe("halt", () => {
  test("the quest stops at once, saying which rule and what it stopped; nothing of it runs and nobody is asked again", async () => {
    const h = harness({ engineer: [sh("echo looking"), sh("cat config/.env.production"), sh("echo never")] }, [rule("no-env", "halt", [".env*"])]);
    const outcome = await h.run;
    expect(h.commands).toEqual(["echo looking"]);
    expect(outcome.status).toBe("stopped");
    expect(outcome.summary).toBe('Halted by your tripwire "no-env": the word `config/.env.production` matches `.env*`.\n$ cat config/.env.production');
    expect(h.trips().map((t) => [t.rule, t.does, t.step])).toEqual([["no-env", "halt", 2]]);
    expect(h.told.map((t) => t.command)).toEqual(["cat config/.env.production"]);
    expect(h.seen.filter((s) => s.role === "engineer")).toHaveLength(2);
    expect(h.seen.some((s) => s.role === "reviewer")).toBe(false);
    expect(outcome).toMatchObject({ steps: 2, tripped: 1 });
    expect(commandsRun(outcome)).toBe(1);
    expect(h.events.at(-1)).toMatchObject({ type: "finished", outcome: { status: "stopped" } });
  });

  test("of a halt and a refusal both tripped, the halt stands", async () => {
    const h = harness({ engineer: [sh("rm bun.lock")] }, [rule("a-refuse", "refuse", ["rm"]), rule("z-halt", "halt", ["*.lock"])]);
    expect((await h.run).summary).toStartWith('Halted by your tripwire "z-halt"');
  });
});

describe("in a parallel batch", () => {
  test("a refused command isn't run and is said in its place; the others run", async () => {
    const h = harness({ engineer: [sh("echo a", "rm x", "echo b"), "DONE\nBoth checks ran."] }, [rule("no-rm", "refuse", ["rm"])], { parallelCommands: 3 });
    const outcome = await h.run;
    expect(h.commands.sort()).toEqual(["echo a", "echo b"]);
    const back = h.engineerSaw(1);
    expect(back).toMatch(/^\[1\] \$ echo a\nexit 0/);
    expect(back).toContain('[2] $ rm x\nNot run: your liege\'s tripwire "no-rm" refuses this command');
    expect(back).toContain("[3] $ echo b\nexit 0");
    expect(h.trips().map((t) => [t.step, t.command])).toEqual([[2, "rm x"]]);
    expect(h.events.filter((e) => e.type === "command").map((e) => (e as { step: number }).step)).toEqual([1, 3]);
    expect(outcome).toMatchObject({ status: "done", steps: 3, tripped: 1 });
    expect(commandsRun(outcome)).toBe(2);
  });

  test("a command that halts stops the batch before any of it runs", async () => {
    const h = harness({ engineer: [sh("echo a", "git push --force", "echo b")] }, [rule("no-force", "halt", ["git"], "--force")], { parallelCommands: 3 });
    const outcome = await h.run;
    expect(h.commands).toEqual([]);
    expect(outcome.status).toBe("stopped");
    expect(outcome.summary).toStartWith('Halted by your tripwire "no-force": the word `git` matches `git`, and it holds `--force`.');
    expect(commandsRun(outcome)).toBe(0);
  });
});

describe("gates", () => {
  test("a refused gate is not run and does not pass: the engineer is told, and the work is never taken as done", async () => {
    const h = harness(
      { engineer: [sh("echo work"), "DONE\nDone.", "DONE\nStill done."] },
      [rule("no-push", "refuse", [], "git push")],
      { gates: ["echo checked", "git push origin main"], maxRevisions: 1 },
    );
    const outcome = await h.run;
    expect(h.commands.filter((c) => c.includes("git push"))).toEqual([]);
    expect(outcome.status).toBe("unverified");
    const gates = h.events.filter((e): e is Extract<QuestEvent, { type: "gate" }> => e.type === "gate");
    expect(gates.filter((g) => g.command === "git push origin main").map((g) => g.exitCode)).toEqual([-1, -1]);
    expect(h.engineerSaw(2)).toContain('Not run: your liege\'s tripwire "no-push" refuses this command (it holds `git push`).');
    expect(h.trips().map((t) => [t.command, t.gate])).toEqual([["git push origin main", true], ["git push origin main", true]]);
    expect(h.told.every((t) => t.gate === true)).toBe(true);
    expect(h.seen.some((s) => s.role === "reviewer")).toBe(false);
    // A gate isn't one of the engineer's commands: nothing is taken off what he ran.
    expect(outcome.tripped).toBeUndefined();
  });

  test("a gate the planner proposed is held to your rules too", async () => {
    const h = harness({ planner: ["1. Clean up.\nDone when: it's clean.\nGate: rm -rf build && test ! -e build"], engineer: [sh("echo work"), "DONE\nDone."] }, [rule("no-rm", "refuse", ["rm"])], { proposeGates: true, maxRevisions: 0 });
    const outcome = await h.run;
    expect(h.commands).toEqual(["echo work"]);
    expect(outcome.status).toBe("unverified");
    expect(h.trips().map((t) => [t.rule, t.gate])).toEqual([["no-rm", true]]);
  });

  test("a gate that halts stops the quest, before any work when the gates are tried first", async () => {
    const h = harness({ engineer: [sh("echo never")] }, [rule("no-push", "halt", [], "git push")], { gates: ["git push origin main"], gatesFirst: true });
    const outcome = await h.run;
    expect(h.commands).toEqual([]);
    expect(outcome.status).toBe("stopped");
    expect(outcome.summary).toBe('Halted by your tripwire "no-push": it holds `git push`.\n$ git push origin main');
    expect(h.seen.some((s) => s.role === "engineer")).toBe(false);
  });
});

describe("your rules, as they stand", () => {
  test("are read before every command: one you add while the quest runs stops its next command", async () => {
    const rules: NamedRule[] = [];
    let ran = 0;
    const h = harness({ engineer: [sh("echo one"), sh("rm x"), "DONE\nok"] }, () => {
      // (The rule arrives once the first command has run.)
      if (ran++ === 1) rules.push(rule("no-rm", "refuse", ["rm"]));
      return rules;
    });
    const outcome = await h.run;
    expect(h.commands).toEqual(["echo one"]);
    expect(outcome.tripped).toBe(1);
  });

  test("that can't be read stop the quest: no command runs unchecked", async () => {
    const h = harness({ engineer: [sh("echo one")] }, () => {
      throw new Error("the node is restarting");
    });
    const outcome = await h.run;
    expect(h.commands).toEqual([]);
    expect(outcome.status).toBe("stopped");
    expect(outcome.summary).toBe("Stopped: your tripwires could not be read (the node is restarting), so no command ran unchecked.");
  });

  test("none: a quest is what it was, and its outcome says nothing of tripwires", async () => {
    const h = harness({ engineer: [sh("rm x"), "DONE\nok"] }, []);
    const outcome = await h.run;
    expect(h.commands).toEqual(["rm x"]);
    expect(outcome.status).toBe("done");
    expect("tripped" in outcome).toBe(false);
  });
});
