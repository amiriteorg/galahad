import { describe, expect, test } from "bun:test";
import { galahadState, type KnightState, STATES, withState } from "./knight-state.ts";
import { galahadNow } from "./now.ts";

describe("a knight's state in a word and a colour", () => {
  test("every state the ring colours is said in words too; one at rest says nothing more than its line", () => {
    for (const [state, look] of Object.entries(STATES) as [KnightState, (typeof STATES)[KnightState]][]) {
      expect([state, look.words === null]).toEqual([state, state === "resting"]);
      if (state !== "resting") expect([state, look.words!.length > 0]).toEqual([state, true]);
    }
    // Ink while it works, Galahad's oxblood when it waits on you, red for a failure, green for a pass, grey otherwise.
    expect(Object.fromEntries(Object.entries(STATES).map(([state, look]) => [state, look.tone]))).toEqual({ working: "accent", needs: "needs", failed: "danger", paused: "neutral", queued: "neutral", verified: "ok", resting: "neutral" });
  });

  test("Galahad's, from his line: what waits on you first, then work in hand or an answer he is writing, then rest", () => {
    expect(galahadState(galahadNow({ turns: [], quests: [], needs: 0 }))).toBe("resting");
    expect(galahadState(galahadNow({ turns: [], quests: [], needs: null }))).toBe("resting");
    expect(galahadState(galahadNow({ step: "Thinking with stand-in/planner", turns: [], quests: [], needs: 0 }))).toBe("working");
    expect(galahadState(galahadNow({ turns: [{ title: "Release plan" }], quests: [], needs: 0 }))).toBe("working");
    expect(galahadState(galahadNow({ turns: [], quests: [{ goal: "Make sync resume" }], needs: 2 }))).toBe("needs");
    expect(galahadState(galahadNow({ turns: [], quests: [], needs: 1 }))).toBe("needs");
  });

  test("a knight is named with its state for a screen reader, and alone at rest", () => {
    expect(withState("Ada", "working")).toBe("Ada, working");
    expect(withState("Ada", "needs")).toBe("Ada, needs you");
    expect(withState("Ada", "resting")).toBe("Ada");
  });
});
