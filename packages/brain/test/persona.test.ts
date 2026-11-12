import { describe, expect, test } from "bun:test";
import { MAX_PROPOSED_GATES } from "@galahad/core";
import { GALAHAD_SYSTEM, TOOL_GUIDE } from "../src/persona.ts";

/*
 * What he is told about himself. Asked on ultra what a quest gate is, he recalled
 * nothing and guessed (wrongly: "a reviewer looks at the evidence"). He should be
 * able to say how his own work goes, and say so when he doesn't know.
 */

describe("what he knows about his own work", () => {
  test("a quest and its gates, a turn and how to steer it, in the guide that goes with his tools", () => {
    // A gate is a command, run in the quest's sandbox, before the reviewer.
    expect(TOOL_GUIDE).toMatch(/A gate \(`--gate "<command>"`\) is a shell command/);
    expect(TOOL_GUIDE).toMatch(/must exit 0 in that sandbox before the reviewer is even asked/);
    expect(TOOL_GUIDE).toContain(`up to ${["zero", "one", "two", "three", "four"][MAX_PROPOSED_GATES]} of its own`);
    expect(TOOL_GUIDE).toContain("galahad quests");
    // A turn outlives the page; steer, queue, a side question, stop.
    expect(TOOL_GUIDE).toMatch(/runs on the node to its end/);
    for (const word of ["steer you", "queue messages", "side question", "stop you"]) expect(TOOL_GUIDE).toContain(word);
    // And he says when he doesn't know.
    expect(TOOL_GUIDE).toMatch(/say what you don't know/);
    expect(TOOL_GUIDE).toContain("galahad help");
  });

  test("it stays small: the guide and the persona are sent with every answer", () => {
    expect(TOOL_GUIDE.length).toBeLessThan(6500);
    expect(GALAHAD_SYSTEM.length).toBeLessThan(2500);
    // Quests' own roles get the persona without the guide, so nothing about tools or commands is in it.
    expect(GALAHAD_SYSTEM).not.toMatch(/--gate|galahad quests/);
  });
});
