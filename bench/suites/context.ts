import type { ChatMessage, ExecResult } from "../../packages/core/src/index.ts";
import { type QuestRole, runQuest } from "../../packages/brain/src/quest.ts";
import type { Suite } from "../lib.ts";

/*
 * What a quest sends its engineer: the characters of every turn's conversation, summed over a whole quest, for three
 * kinds of work a stand-in engineer does the same way every time. The engineer's conversation is most of what a quest
 * costs, so a change that sends more (or rewrites the beginning a provider caches) shows here as a number, not a feeling.
 *
 * No model is called: the planner, engineer and reviewer are scripts, and every command answers at once.
 */

interface Work {
  /** The engineer's commands, in order; DONE after the last. */
  commands: string[];
  /** What each command printed, by the command and its place. */
  answer(command: string, i: number): Partial<ExecResult>;
}

/** The engineer's conversation on every turn of one quest. */
async function sent(work: Work): Promise<ChatMessage[][]> {
  const replies = [...work.commands.map((c) => `Next.\n\`\`\`sh\n${c}\n\`\`\``), "DONE\nIt is done."];
  const turns: ChatMessage[][] = [];
  let step = 0;
  await runQuest(
    { goal: "make it so", environment: "a stand-in sandbox", maxSteps: work.commands.length + 4 },
    {
      ask: async (role: QuestRole, messages: ChatMessage[]) => {
        if (role === "engineer") turns.push(messages.map((m) => ({ ...m })));
        if (role === "planner") return { text: "1. Do it.\nDone when: it is done.", model: "stand-in" };
        if (role === "reviewer") return { text: "PASS\nIt is.", model: "stand-in" };
        return { text: replies.shift()!, model: "stand-in" };
      },
      exec: async (command: string) => ({ exitCode: 0, stdout: "", stderr: "", durationMs: 5, truncated: false, ...work.answer(command, step++) }),
    },
  );
  return turns;
}

const size = (turn: readonly ChatMessage[]): number => turn.reduce((sum, m) => sum + m.content.length, 0);

/** Turns whose conversation doesn't begin with the turn before's: each one a beginning a provider can't read from its cache. */
const rewrites = (turns: readonly ChatMessage[][]): number => {
  let n = 0;
  for (let t = 1; t < turns.length; t++) if (JSON.stringify(turns[t]!.slice(0, turns[t - 1]!.length)) !== JSON.stringify(turns[t - 1])) n += 1;
  return n;
};

const page = (c: string, n: number): string => c.repeat(n);

/** The tests run after each of thirteen edits, failing until the last. */
const testsAfterEdits: Work = {
  commands: Array.from({ length: 26 }, (_, i) => (i % 2 === 0 ? "bun test" : `sed -i 's/a${i}/b${i}/' src/x.ts`)),
  answer: (command, i) => (command === "bun test" ? { exitCode: i >= 24 ? 0 : 1, stdout: `${i} fail\n${page("y", 3000)}\n` } : {}),
};

/** Ten files, each read, edited in place, and the tests run after it. */
const readEditTest: Work = {
  commands: Array.from({ length: 10 }, (_, k) => [`cat src/f${k}.ts`, `sed -i 's/x/y/' src/f${k}.ts`, "bun test"]).flat(),
  answer: (command, i) => (command.startsWith("cat ") ? { stdout: `${page("x", 2400)}\n` } : command === "bun test" ? { exitCode: i >= 29 ? 0 : 1, stdout: `${page("f", 1500)}\n` } : {}),
};

/** Thirty different commands that each print a page: nothing is superseded or made stale, only cut short. */
const longSurvey: Work = {
  commands: Array.from({ length: 30 }, (_, i) => `grep -rn "symbol${i}" src`),
  answer: () => ({ stdout: `${page("g", 2000)}\n` }),
};

export const suite: Suite = {
  name: "context",
  about: "what a quest sends its engineer over a whole quest, for three kinds of work done by a stand-in: characters, and beginnings a provider can't cache",
  headline: ["context.quest.tests-after-edits", "context.quest.read-edit-test", "context.quest.survey", "context.quest.read-edit-test.last-turn", "context.quest.rewrites"],
  async run(ctx) {
    const kinds: [string, Work, string][] = [
      ["tests-after-edits", testsAfterEdits, "the tests run after each of 13 edits, failing until the last (26 commands)"],
      ["read-edit-test", readEditTest, "ten files, each read, edited in place and tested (30 commands)"],
      ["survey", longSurvey, "thirty different searches that each print a page (30 commands)"],
    ];
    let rewritten = 0;
    for (const [name, work, about] of kinds) {
      const turns = await sent(work);
      ctx.quality(`context.quest.${name}`, turns.reduce((sum, t) => sum + size(t), 0), "chars", "lower", { note: `every engineer turn's conversation, summed: ${about}` });
      if (name === "read-edit-test") ctx.quality("context.quest.read-edit-test.last-turn", size(turns.at(-1)!), "chars", "lower", { note: "the last turn of the same quest: what a long quest's every turn tends to" });
      rewritten += rewrites(turns);
    }
    ctx.quality("context.quest.rewrites", rewritten, "turns", "lower", { note: "turns, over the three quests, whose conversation doesn't begin with the turn before's (a batch cut is one)" });
  },
};
