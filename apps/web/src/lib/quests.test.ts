import { describe, expect, test } from "bun:test";
import { MAX_QUEST_GATES, QuestGates } from "@galahad/core";
import { gateOwner, gateResult, gatesFromText, MAX_GATE_LENGTH, MAX_GATES } from "./quests.ts";

describe("gates typed into the app", () => {
  test("one command a line, blank lines dropped, each as typed (trimmed)", () => {
    expect(gatesFromText("bun test\n\n  test -s /work/out/report.md  \n")).toEqual({ gates: ["bun test", "test -s /work/out/report.md"] });
    expect(gatesFromText("")).toEqual({ gates: [] });
  });

  test("the app's limits are the contract's", () => {
    expect(MAX_GATES).toBe(MAX_QUEST_GATES);
    expect(QuestGates.safeParse(["x".repeat(MAX_GATE_LENGTH)]).success).toBe(true);
    expect(QuestGates.safeParse(["x".repeat(MAX_GATE_LENGTH + 1)]).success).toBe(false);
    const many = Array.from({ length: MAX_GATES + 1 }, (_, i) => `check ${i}`).join("\n");
    expect(gatesFromText(many)).toEqual({ problem: "A quest takes at most 8 gates (this is 9)." });
    expect(gatesFromText(`ok\n${"x".repeat(MAX_GATE_LENGTH + 1)}`)).toMatchObject({ problem: expect.stringContaining("Gate 2 is longer") });
    // What the field accepts, the contract accepts.
    const typed = gatesFromText("bun test\ngrep -q hi a.txt");
    expect("gates" in typed && QuestGates.parse(typed.gates)).toEqual(["bun test", "grep -q hi a.txt"]);
  });

  test("a gate's result and whose it is, in words", () => {
    expect(gateResult(null)).toEqual({ text: "not run yet", tone: "neutral" });
    expect(gateResult(0)).toEqual({ text: "passed", tone: "ok" });
    expect(gateResult(2)).toEqual({ text: "failed (exit 2)", tone: "danger" });
    expect(gateOwner("owner")).toBe("yours");
    expect(gateOwner("planner")).toBe("proposed by the planner");
  });
});
