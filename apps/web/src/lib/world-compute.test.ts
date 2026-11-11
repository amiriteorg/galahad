import { describe, expect, test } from "bun:test";
import type { WorldEvent } from "@galahad/core/world";
import type { WorldCompute } from "@galahad/core/world-compute";
import { applyWorldEvent, emptyWorld, readWorldEvent, worldSummary } from "./world.ts";

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
