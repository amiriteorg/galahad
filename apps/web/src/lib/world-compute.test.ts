import { describe, expect, test } from "bun:test";
import type { WorldEvent } from "@galahad/core/world";
import type { WorldCompute } from "@galahad/core/world-compute";
import { lookOptions } from "./look.ts";
import { applyWorldEvent, emptyWorld, readWorldEvent, worldSummary } from "./world.ts";
import { helperDoing, slotPips, slotWords } from "./world-compute.ts";

/*
 * Compute in the world's stream: each node's slots and strength, and his helpers at
 * work. Additive and optional: a node from before it says nothing (the model keeps
 * null), and what a page can't read is left out, never a reason to lose the world.
 */

const compute = (over: Partial<WorldCompute> = {}): WorldCompute => ({
  nodes: [{ id: "n_ultra", name: "ultra", slots: 3, inUse: 2, queued: 1, strength: 13.9 }],
  attempts: [
    { id: "q-abc#1", quest: "q-abc", index: 1, of: 3, label: "Attempt 1 of 3: compute the tip deflection", station: "forge", node: "ultra", since: 100 },
    { id: "q-abc#2", quest: "q-abc", index: 2, of: 3, label: "Attempt 2 of 3: compute the tip deflection", station: "council", node: null, since: 101 },
  ],
  ...over,
});

const hello = (extra: Record<string, unknown> = {}) => ({
  type: "hello",
  at: 10,
  galahad: { station: "council", doing: "Leading 3 attempts at a quest", experiment: null, model: null, since: 5 },
  nodes: [{ id: "n_ultra", name: "ultra", kind: "node", online: true, self: true, sandboxHost: true }],
  experiments: [],
  thoughts: [],
  ...extra,
});

describe("reading compute at the boundary", () => {
  test("a hello carries it; a node from before compute says nothing, and the model keeps null", () => {
    const withCompute = readWorldEvent(hello({ compute: compute() })) as Extract<WorldEvent, { type: "hello" }>;
    expect(withCompute.compute).toEqual(compute());
    const older = readWorldEvent(hello()) as Extract<WorldEvent, { type: "hello" }>;
    expect(older.type).toBe("hello");
    expect("compute" in older).toBe(false);
    expect(applyWorldEvent(emptyWorld(), older).compute).toBeNull();
    expect(applyWorldEvent(emptyWorld(), withCompute).compute).toEqual(compute());
  });

  test("the compute event replaces what the model holds", () => {
    const first = applyWorldEvent(emptyWorld(), readWorldEvent(hello({ compute: compute() }))!);
    const event = readWorldEvent({ type: "compute", at: 20, compute: compute({ attempts: [] }) })!;
    expect(event.type).toBe("compute");
    const next = applyWorldEvent(first, event);
    expect(next.compute!.attempts).toEqual([]);
    expect(next.compute!.nodes[0]).toMatchObject({ slots: 3, inUse: 2, queued: 1, strength: 13.9 });
    expect(next.at).toBe(20);
    // Everything else stands.
    expect(next.galahad).toBe(first.galahad);
    expect(next.nodes).toBe(first.nodes);
  });

  test("compute it can't read in a hello is unknown compute, not a lost hello", () => {
    for (const bad of ["lots", 7, { nodes: "many", attempts: [] }, { nodes: [{ id: "n", name: "x", slots: -1, inUse: 0, queued: 0, strength: null }], attempts: [] }]) {
      const read = readWorldEvent(hello({ compute: bad })) as Extract<WorldEvent, { type: "hello" }>;
      expect(read.type).toBe("hello");
      expect(read.compute).toBeNull();
    }
    expect(readWorldEvent(hello({ compute: null }))).toMatchObject({ type: "hello", compute: null });
  });

  test("a malformed compute event is dropped; counts and labels are bounded", () => {
    expect(readWorldEvent({ type: "compute", at: 1, compute: null })).toBeNull();
    expect(readWorldEvent({ type: "compute", at: 1, compute: { nodes: [], attempts: [{ id: "a", quest: "q", index: 0, of: 3, label: "x", station: "forge", node: null, since: 1 }] } })).toBeNull();
    expect(readWorldEvent({ type: "compute", at: 1, compute: { nodes: [{ id: "n", name: "x", slots: 1e9, inUse: 0, queued: 0, strength: 1 }], attempts: [] } })).toBeNull();
    expect(readWorldEvent({ type: "compute", at: 1, compute: { nodes: [{ id: "n", name: "x", slots: 1, inUse: 0, queued: 0, strength: Number.NaN }], attempts: [] } })).toBeNull();
    expect(readWorldEvent({ type: "compute", at: 1, compute: { nodes: [], attempts: [{ id: "a", quest: "q", index: 1, of: 3, label: "x".repeat(500), station: "forge", node: null, since: 1 }] } })).toBeNull();
    // More helpers than a page shows: the first ones are kept.
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `q#${i + 1}`, quest: "q", index: (i % 8) + 1, of: 8, label: `Attempt ${i + 1}`, station: "forge", node: "ultra", since: i }));
    const read = readWorldEvent({ type: "compute", at: 1, compute: { nodes: [], attempts: many } }) as Extract<WorldEvent, { type: "compute" }>;
    expect(read.compute.attempts).toHaveLength(8);
    // A station this page doesn't know yet: the helper is shown at the keep rather than lost.
    const odd = readWorldEvent({ type: "compute", at: 1, compute: { nodes: [], attempts: [{ ...many[0], station: "orbital-platform" }] } }) as Extract<WorldEvent, { type: "compute" }>;
    expect(odd.compute.attempts[0]!.station).toBe("keep");
    // Unknown fields are ignored.
    const extra = readWorldEvent({ type: "compute", at: 1, compute: { nodes: [{ id: "n", name: "x", slots: 2, inUse: 1, queued: 0, strength: null, gpus: 4 }], attempts: [], future: true } }) as Extract<WorldEvent, { type: "compute" }>;
    expect(extra.compute.nodes[0]).toEqual({ id: "n", name: "x", slots: 2, inUse: 1, queued: 0, strength: null });
  });
});

describe("words", () => {
  test("the summary names his helpers when there are any", () => {
    const model = applyWorldEvent(emptyWorld(), readWorldEvent(hello({ compute: compute() }))!);
    expect(worldSummary(model)).toContain("2 helpers at work: Attempt 1 of 3: compute the tip deflection (at Forge), Attempt 2 of 3: compute the tip deflection (at Council table).");
    const none = applyWorldEvent(emptyWorld(), readWorldEvent(hello({ compute: compute({ attempts: [] }) }))!);
    expect(worldSummary(none)).not.toContain("helper");
  });
});

describe("compute, as the SANDBOX says it", () => {
  test("a node's slots as pips, the busy ones filled, with what waits; numbers beyond eight; nothing for a node that carries none", () => {
    expect(slotPips({ slots: 4, inUse: 2, queued: 0 })).toBe("●●○○");
    expect(slotPips({ slots: 3, inUse: 3, queued: 2 })).toBe("●●● +2");
    expect(slotPips({ slots: 3, inUse: 7, queued: 0 })).toBe("●●●");
    expect(slotPips({ slots: 12, inUse: 5, queued: 0 })).toBe("5/12");
    expect(slotPips({ slots: 0, inUse: 0, queued: 0 })).toBe("");
    expect(slotWords({ slots: 4, inUse: 2, queued: 0 })).toBe("2 of 4 sandbox slots busy");
    expect(slotWords({ slots: 1, inUse: 1, queued: 3 })).toBe("1 of 1 sandbox slot busy, 3 waiting");
    expect(slotWords({ slots: 0, inUse: 0, queued: 0 })).toBe("");
  });

  test("what a helper is doing follows where its attempt's work is", () => {
    expect(helperDoing("council")).toBe("Planning at the council table");
    expect(helperDoing("forge")).toBe("Working at the forge");
    expect(helperDoing("observatory")).toBe("Being reviewed at the observatory");
    expect(helperDoing("keep")).toBe("At work");
  });

  test("the selector lists his helpers with what each is doing, and each node with its slots", () => {
    const hello = (c: WorldCompute | null): WorldEvent => ({
      type: "hello",
      at: 1,
      galahad: { station: "council", doing: "Leading 3 attempts at a quest", experiment: null, model: null, since: 0 },
      nodes: [{ id: "n_ultra", name: "ultra", kind: "node", online: true, self: true, sandboxHost: true }],
      experiments: [],
      thoughts: [],
      compute: c,
    });
    const options = lookOptions(applyWorldEvent(emptyWorld(), hello(compute())));
    const partners = options.filter((o) => o.group === "Partners");
    expect(partners.map((o) => o.label)).toEqual(["His helper 1 of 3", "His helper 2 of 3", "ultra"]);
    expect(partners[0]).toMatchObject({ target: { kind: "station", station: "forge" }, live: true, meta: "Working at the forge · Attempt 1 of 3: compute the tip deflection" });
    expect(partners[2]!.meta).toBe("Online · 2 of 3 sandbox slots busy, 1 waiting · this node");
    // A node from before compute says only that it hosts sandboxes.
    const before = lookOptions(applyWorldEvent(emptyWorld(), hello(null))).filter((o) => o.group === "Partners");
    expect(before.map((o) => o.meta)).toEqual(["Online · sandboxes · this node"]);
  });
});
