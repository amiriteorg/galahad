import { describe, expect, test } from "bun:test";
import { BOARD_H, BOARD_W, layoutItem } from "@galahad/core/board";
import type { WorldQuest } from "@galahad/core/world-quest";
import { STATIONS } from "@galahad/core/world";
import type { Collider } from "../world/colliders.ts";
import { KEEP_COLLIDERS } from "../world/keep-plan.ts";
import { standAt } from "../world/path.ts";
import { overSlate, SLATE, SLATE_COLLIDERS, slatePoint, slateStand } from "../world/slate-plan.ts";
import { applyWorldEvent, emptyWorld, readWorldEvent, slateQuest, worldSummary } from "./world.ts";
import { planSlate, SLATE_REGIONS, slateChore, slateKey } from "./world-quest.ts";

/*
 * His slate: a quest in hand as chalk marks (text and lines only), what's worth his
 * walking over to write, how the page keeps the stream's `quests`, and where the
 * slate stands (clear of the council's deck, of him, and of where he writes).
 */

const quest = (over: Partial<WorldQuest> = {}): WorldQuest => ({
  id: "q-1",
  by: "you",
  attempt: null,
  state: "working",
  title: "Fix the flaky sync test",
  plan: ["Reproduce the failure.", "Find the race in the queue.", "Fix it and add a test."],
  doneWhen: "the suite passes ten times in a row.",
  step: 7,
  maxSteps: 30,
  revisions: 0,
  gates: [
    { label: "bun test packages/link", by: "owner", passed: true },
    { label: "bun run check", by: "planner", passed: null },
  ],
  gatesPassed: 1,
  gatesFailed: 0,
  gatesTotal: 2,
  startedAt: 1,
  endedAt: null,
  silent: false,
  veiled: false,
  ...over,
});

const words = (q: WorldQuest | null, more = 0): string[] => planSlate(q, more).items.map((i) => ("text" in i ? i.text : ""));

describe("a quest, in chalk", () => {
  test("what it is and where it stands, the goal, the planner's plan said to be the planner's, the stage ringed, the gates", () => {
    const slate = planSlate(quest());
    const said = words(quest());
    expect(said[0]).toBe("QUEST · WORKING");
    expect(said).toContain("Fix the flaky sync test");
    expect(said).toContain("the planner's plan");
    expect(said).toContain("1. Reproduce the failure.\n2. Find the race in the queue.\n3. Fix it and add a test.");
    expect(said).toContain("Done when: the suite passes ten times in a row.");
    expect(said).toContain("7 of 30");
    expect(said).toContain("bun test packages/link");
    // The stage he's at is in yellow and ringed; the plan is behind him (ticked); the gate that passed is ticked, the other boxed.
    const stage = (name: string) => slate.items.find((i) => "text" in i && i.text === name)!;
    expect(stage("work").color).toBe("yellow");
    expect(stage("plan").color).toBe("white");
    expect(slate.strokes.filter((s) => s.color === "yellow")).toHaveLength(1);
    expect(slate.strokes.filter((s) => s.color === "green")).toHaveLength(2);
    // Seven commands: a gate of five and two.
    expect(slate.strokes.filter((s) => s.color === "white" && s.width === 4)).toHaveLength(7);
  });

  test("every mark is on the slate, no line of text wraps, and nothing is markup (text items only)", () => {
    const long = quest({ title: "T".repeat(64), plan: Array.from({ length: 7 }, () => "w".repeat(72)), doneWhen: "d".repeat(96), gates: Array.from({ length: 6 }, (_, i) => ({ label: "g".repeat(44), by: i % 2 ? "planner" : "owner", passed: i % 3 === 0 ? true : i % 3 === 1 ? false : null })), gatesTotal: 9, revisions: 3, attempt: { index: 2, of: 3 }, silent: true }, );
    for (const q of [long, quest(), quest({ state: "done", endedAt: 5 }), quest({ state: "planning", plan: [], step: 0 }), quest({ veiled: true, title: "", plan: [], doneWhen: "" })]) {
      const slate = planSlate(q, 3);
      for (const item of slate.items) {
        expect(item.kind === "text" || item.kind === "note").toBe(true);
        const layout = layoutItem(item, item.w);
        const lines = item.kind === "note" ? item.text.split("\n").length : 1;
        expect(layout.lines).toHaveLength(lines);
        expect(item.x).toBeGreaterThanOrEqual(0);
        expect(item.x + item.w).toBeLessThanOrEqual(BOARD_W);
        expect(item.y + layout.h).toBeLessThanOrEqual(BOARD_H);
      }
      for (const s of slate.strokes) {
        for (let k = 0; k < s.points.length; k += 2) {
          expect(s.points[k]!).toBeGreaterThanOrEqual(0);
          expect(s.points[k]!).toBeLessThanOrEqual(BOARD_W);
          expect(s.points[k + 1]!).toBeGreaterThanOrEqual(0);
          expect(s.points[k + 1]!).toBeLessThanOrEqual(BOARD_H);
        }
      }
    }
  });

  test("a failed gate is crossed; how it ended is written large, and only a reviewed quest is green", () => {
    const failed = planSlate(quest({ state: "unverified", endedAt: 9, gates: [{ label: "bun test", by: "owner", passed: false }], gatesPassed: 0, gatesFailed: 1, gatesTotal: 1 }));
    expect(failed.strokes.filter((s) => s.color === "pink")).toHaveLength(2);
    const outcome = failed.items.find((i) => "text" in i && i.text === "Not accepted")!;
    expect(outcome).toMatchObject({ size: "l", color: "orange" });
    const done = planSlate(quest({ state: "done", endedAt: 9 }));
    expect(done.items.find((i) => "text" in i && i.text === "Done, reviewed")).toMatchObject({ size: "l", color: "green" });
    expect(words(quest({ state: "done", endedAt: 9 }))[0]).toBe("QUEST · DONE, REVIEWED");
  });

  test("a veiled quest (one that touches the bank) is drawn without a word of its own", () => {
    const said = words(quest({ veiled: true, title: "", plan: [], doneWhen: "", gates: [{ label: "", by: "owner", passed: true }], gatesTotal: 1 })).join("\n");
    expect(said).toContain("A quest in hand");
    expect(said).toContain("its words are kept off this slate");
    expect(said).toContain("gate 1");
    expect(said).not.toContain("planner's plan");
  });

  test("wiped: nothing on it; more in hand is said; the face is painted again only when what's drawn changes", () => {
    expect(planSlate(null)).toEqual({ items: [], strokes: [] });
    expect(words(quest(), 2).join("\n")).toContain("+2 more in hand");
    expect(slateKey(quest())).toBe(slateKey(quest({ startedAt: 99 })));
    expect(slateKey(quest())).not.toBe(slateKey(quest({ step: 8 })));
    expect(slateKey(null)).toBe("");
  });

  test("what's worth walking over to chalk: the plan when it's first there, a gate's result, the outcome; not one more command", () => {
    expect(slateChore(null, quest())).toBe("plan");
    expect(slateChore(quest({ state: "planning", plan: [] }), quest())).toBe("plan");
    expect(slateChore(quest(), quest({ step: 8 }))).toBeNull();
    expect(slateChore(quest(), quest({ state: "gating" }))).toBe("stage");
    expect(slateChore(quest(), quest({ gates: [{ label: "bun test packages/link", by: "owner", passed: true }, { label: "bun run check", by: "planner", passed: false }] }))).toBe("gates");
    expect(slateChore(quest(), quest({ state: "done", endedAt: 9 }))).toBe("outcome");
    expect(slateChore(quest({ state: "done", endedAt: 9 }), quest({ state: "done", endedAt: 9 }))).toBeNull();
    expect(slateChore(quest(), null)).toBeNull();
    for (const r of Object.values(SLATE_REGIONS)) expect(r.x + r.w).toBeLessThanOrEqual(BOARD_W);
  });
});

describe("the page keeps what the stream says of quests", () => {
  const hello = { type: "hello", at: 10, galahad: { station: "council", doing: "The engineer is thinking", experiment: null, model: null, since: 1 }, nodes: [], experiments: [], thoughts: [] };

  test("a hello's quests and a quests event, each read at the boundary; an older node says none", () => {
    expect(emptyWorld().quests).toEqual([]);
    const first = readWorldEvent({ ...hello, quests: [quest(), { nonsense: true }] })!;
    let w = applyWorldEvent(emptyWorld(), first);
    expect(w.quests.map((q) => q.id)).toEqual(["q-1"]);
    w = applyWorldEvent(w, readWorldEvent({ type: "quests", at: 11, quests: [quest({ step: 9 }), quest({ id: "q-2", state: "done", endedAt: 10 })] })!);
    expect(w.quests.map((q) => [q.id, q.step])).toEqual([["q-1", 9], ["q-2", 7]]);
    expect(readWorldEvent({ type: "quests", at: 12, quests: "no" })).toBeNull();
    expect(applyWorldEvent(w, readWorldEvent(hello)!).quests).toEqual([]);
  });

  test("the slate shows the first in hand, else the one that ended last; the summary says it in fixed words only", () => {
    const ended = quest({ id: "q-0", state: "done", endedAt: 5 });
    expect(slateQuest([ended, quest()])!.id).toBe("q-1");
    expect(slateQuest([ended])!.id).toBe("q-0");
    expect(slateQuest([])).toBeNull();
    const w = applyWorldEvent(emptyWorld(), readWorldEvent({ ...hello, quests: [quest()] })!);
    expect(worldSummary(w)).toContain("A quest in hand: working · command 7 of 30 · 1 of 2 gates passed.");
    expect(worldSummary(w)).not.toContain("flaky");
  });
});

describe("where his slate stands", () => {
  const GALAHAD_R = 0.45;
  /** How far a point is from a collider's footprint (negative inside). */
  function distance(c: Collider, x: number, y: number): number {
    if (c.kind === "circle") return Math.hypot(x - c.x, y - c.y) - c.r;
    const yaw = c.yaw ?? 0;
    const dx = x - c.x;
    const dy = y - c.y;
    const u = Math.abs(dx * Math.cos(yaw) + dy * Math.sin(yaw)) - c.hx;
    const v = Math.abs(-dx * Math.sin(yaw) + dy * Math.cos(yaw)) - c.hy;
    return u > 0 || v > 0 ? Math.hypot(Math.max(u, 0), Math.max(v, 0)) : Math.max(u, v);
  }

  test("by the council table, clear of its deck and every solid of the keep; he and the dog have their room at the table", () => {
    expect(Math.hypot(SLATE.x - STATIONS.council.x, SLATE.y - STATIONS.council.y)).toBeLessThan(7);
    const frame = SLATE_COLLIDERS[0]!;
    // Its frame's corners and middle are clear of everything the keep has standing.
    if (frame.kind !== "box") throw new Error("the slate's solid is a box");
    const yaw = frame.yaw ?? 0;
    for (const [u, v] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]] as const) {
      const x = frame.x + Math.cos(yaw) * frame.hx * u - Math.sin(yaw) * frame.hy * v;
      const y = frame.y + Math.sin(yaw) * frame.hx * u + Math.cos(yaw) * frame.hy * v;
      for (const c of KEEP_COLLIDERS) expect(distance(c, x, y)).toBeGreaterThan(0.1);
    }
    const stand = standAt("council");
    expect(distance(frame, stand.x, stand.y)).toBeGreaterThan(2);
    // The dog's place at his right.
    expect(distance(frame, stand.x + 1.05, stand.y - 0.55)).toBeGreaterThan(1);
  });

  test("where he stands to write each part: before the face, clear of every solid, facing it", () => {
    for (const region of Object.values(SLATE_REGIONS)) {
      const stand = slateStand(region);
      expect(distance(SLATE_COLLIDERS[0]!, stand.x, stand.y)).toBeGreaterThan(GALAHAD_R);
      // (What a walker meets: not the great tree's crown overhead, which only the camera keeps out of.)
      for (const c of KEEP_COLLIDERS) if (c.stops !== "camera" && (c.bottom ?? 0) < 2.2) expect(distance(c, stand.x, stand.y)).toBeGreaterThan(GALAHAD_R);
      expect((stand.x - SLATE.x) * Math.cos(SLATE.facing) + (stand.y - SLATE.y) * Math.sin(SLATE.facing)).toBeGreaterThan(0.5);
      expect(Math.cos(stand.facing - SLATE.facing)).toBeCloseTo(-1);
    }
  });

  test("slate points land on the face, and a tap before it finds it (not the council table)", () => {
    const a = { x: 0, y: 0, z: 0 };
    const b = { x: 0, y: 0, z: 0 };
    slatePoint(0, 0, a);
    slatePoint(BOARD_W, BOARD_H, b);
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(SLATE.width, 2);
    expect(a.z).toBeGreaterThan(b.z);
    expect(b.z).toBeGreaterThan(0.5);
    expect(a.z).toBeLessThan(2.2);
    expect(overSlate(SLATE.x, SLATE.y)).toBe(true);
    expect(overSlate(STATIONS.council.x, STATIONS.council.y)).toBe(false);
    expect(overSlate(standAt("council").x, standAt("council").y)).toBe(false);
  });
});
