import { describe, expect, test } from "bun:test";
import type { NodeCapacity } from "@galahad/core";
import { CapacityError, Governor } from "../src/compute/governor.ts";

/*
 * The governor: a node's slots. Work that fits is admitted; work that doesn't waits
 * its turn, first come first served, and is never run on top of the ceiling.
 */

const capacity = (over: Partial<NodeCapacity> = {}): NodeCapacity => ({ cores: 8, memoryGb: 16, sandboxes: 2, modelCalls: 2, strength: 8, speed: 1, measured: true, reasons: [], ...over });
const slot = { cpus: 4, memoryGb: 8 };
const idle = { load: 0, cores: 16, freeMemoryGb: 60, totalMemoryGb: 64 };
const settle = () => Bun.sleep(1);

function governor(over: { capacity?: () => NodeCapacity; host?: () => typeof idle | null; maxWaitMs?: number; retryMs?: number; now?: () => number } = {}) {
  let changes = 0;
  const g = new Governor({ capacity: over.capacity ?? (() => capacity()), host: over.host ?? (() => idle), maxWaitMs: over.maxWaitMs, retryMs: over.retryMs ?? 5, now: over.now, onChange: () => changes++ });
  return { g, changes: () => changes };
}

describe("sandbox slots", () => {
  test("what fits runs; the next waits, and takes the slot when one is freed", async () => {
    const { g } = governor();
    const a = await g.acquire(slot, { quest: "q-a" });
    const b = await g.acquire(slot, { quest: "q-b" });
    let third = "waiting";
    const c = g.acquire(slot, { quest: "q-c" }).then((ticket) => {
      third = "running";
      return ticket;
    });
    await settle();
    expect(third).toBe("waiting");
    expect(g.usage()).toMatchObject({ sandboxes: 2, cores: 8, memoryGb: 16, queued: 1 });
    expect(g.queue()).toMatchObject([{ quest: "q-c", cpus: 4, memoryGb: 8 }]);
    expect(g.queue()[0]!.why).toMatch(/every slot is in use/);
    g.release(a);
    await c;
    expect(third).toBe("running");
    expect(g.usage()).toMatchObject({ sandboxes: 2, queued: 0 });
    g.release(b);
    g.release(await c);
    expect(g.usage()).toMatchObject({ sandboxes: 0, cores: 0, memoryGb: 0 });
  });

  test("first come, first served: a small request doesn't jump one that's waiting", async () => {
    const { g } = governor({ capacity: () => capacity({ sandboxes: 4 }) });
    const big = await g.acquire({ cpus: 6, memoryGb: 8 }, { quest: "big" });
    const order: string[] = [];
    const second = g.acquire({ cpus: 4, memoryGb: 4 }, { quest: "second" }).then((t) => (order.push("second"), t));
    const small = g.acquire({ cpus: 1, memoryGb: 1 }, { quest: "small" }).then((t) => (order.push("small"), t));
    await settle();
    expect(order).toEqual([]); // 1 CPU would fit, but it's behind "second"
    g.release(big);
    await Promise.all([second, small]);
    expect(order).toEqual(["second", "small"]);
  });

  test("a sandbox is known by its id once it exists, and released by it", async () => {
    const { g } = governor();
    const ticket = await g.acquire(slot, { quest: "q" });
    g.bind(ticket, "0123456789");
    expect(g.usage().sandboxes).toBe(1);
    g.release("0123456789");
    expect(g.usage().sandboxes).toBe(0);
    g.release("0123456789"); // twice is nothing
    expect(g.usage().sandboxes).toBe(0);
  });

  test("Docker's own list is the truth: sandboxes from before a restart are counted, vanished ones freed", async () => {
    const { g } = governor();
    g.adopt([
      { id: "aaaaaaaaaa", cpus: 4, memoryGb: 8, isolation: "container" },
      { id: "bbbbbbbbbb", cpus: 2, memoryGb: 4, isolation: "vm" },
    ]);
    // A microVM's overhead is counted on top of its limits.
    expect(g.usage()).toMatchObject({ sandboxes: 2, cores: 7, memoryGb: 14 });
    let admitted = false;
    const waiting = g.acquire(slot, { quest: "q" }).then((t) => ((admitted = true), t));
    await settle();
    expect(admitted).toBe(false);
    // One being created isn't in Docker's list yet: an adoption never drops it.
    g.adopt([{ id: "aaaaaaaaaa", cpus: 4, memoryGb: 8, isolation: "container" }]);
    await waiting;
    expect(g.usage()).toMatchObject({ sandboxes: 2, cores: 8 });
    g.adopt([{ id: "aaaaaaaaaa", cpus: 4, memoryGb: 8, isolation: "container" }]);
    expect(g.usage().sandboxes).toBe(2);
  });

  test("he waits while the machine is busy, and goes on when it eases", async () => {
    let load = 15;
    const { g } = governor({ host: () => ({ ...idle, load }) });
    let admitted = false;
    const waiting = g.acquire(slot, { quest: "q" }).then((t) => ((admitted = true), t));
    await Bun.sleep(20);
    expect(admitted).toBe(false);
    expect(g.queue()[0]!.why).toMatch(/busy with other work/);
    load = 1;
    await waiting;
    expect(admitted).toBe(true);
  });

  test("load that is his own doesn't hold him back: what his sandboxes held a moment ago is remembered", async () => {
    let now = 1_000_000;
    let load = 0;
    const { g } = governor({ host: () => ({ ...idle, cores: 8, load }), capacity: () => capacity({ cores: 4, sandboxes: 1 }), now: () => now });
    const first = await g.acquire(slot, { quest: "one" });
    load = 4; // his own sandbox, flat out
    g.release(first);
    now += 5_000; // the load average hasn't decayed yet
    const next = await g.acquire(slot, { quest: "two" });
    g.release(next);
    // Two minutes later that load would be someone else's.
    now += 120_000;
    let admitted = false;
    void g.acquire(slot, { quest: "three" }).then(() => (admitted = true));
    await Bun.sleep(15);
    expect(admitted).toBe(false);
  });

  test("a wait has an end: the caller hears why", async () => {
    const { g } = governor({ maxWaitMs: 20 });
    await g.acquire(slot, { quest: "a" });
    await g.acquire(slot, { quest: "b" });
    const waited = g.acquire(slot, { quest: "c" });
    await expect(waited).rejects.toBeInstanceOf(CapacityError);
    await expect(waited).rejects.toThrow(/every slot is in use/);
    expect(g.usage().queued).toBe(0);
  });

  test("a caller that goes away leaves the queue", async () => {
    const { g } = governor();
    await g.acquire(slot, { quest: "a" });
    await g.acquire(slot, { quest: "b" });
    const gone = new AbortController();
    const waited = g.acquire(slot, { quest: "c" }, gone.signal);
    await settle();
    gone.abort();
    await expect(waited).rejects.toThrow(/gave up waiting/);
    expect(g.usage().queued).toBe(0);
    const already = new AbortController();
    already.abort();
    await expect(g.acquire(slot, { quest: "d" }, already.signal)).rejects.toThrow(/gave up waiting/);
  });

  test("a node that takes no sandboxes refuses at once instead of queueing forever", async () => {
    const { g } = governor({ capacity: () => capacity({ sandboxes: 0 }) });
    await expect(g.acquire(slot, { quest: "q" })).rejects.toThrow(/takes no sandboxes/);
  });

  test("a ceiling lowered while work runs admits nothing new until it fits again", async () => {
    let sandboxes = 2;
    const { g } = governor({ capacity: () => capacity({ sandboxes }) });
    const a = await g.acquire(slot, { quest: "a" });
    sandboxes = 1;
    let admitted = false;
    const waiting = g.acquire(slot, { quest: "b" }).then((t) => ((admitted = true), t));
    await settle();
    expect(admitted).toBe(false);
    g.release(a);
    await waiting;
    expect(admitted).toBe(true);
  });

  test("watchers hear of every change", async () => {
    const { g, changes } = governor();
    const ticket = await g.acquire(slot, { quest: "q" });
    g.release(ticket);
    expect(changes()).toBeGreaterThanOrEqual(2);
  });
});

describe("model calls", () => {
  test("background calls wait for a slot; yours never waits, but is counted", async () => {
    const { g } = governor();
    const one = await g.enterModel({ wait: true });
    const two = await g.enterModel({ wait: true });
    let third = false;
    const waiting = g.enterModel({ wait: true }).then((leave) => ((third = true), leave));
    await settle();
    expect(third).toBe(false);
    expect(g.usage()).toMatchObject({ modelCalls: 2, modelQueued: 1 });
    const yours = await g.enterModel({ wait: false });
    expect(g.usage().modelCalls).toBe(3);
    yours();
    await settle();
    expect(third).toBe(false); // still two background calls running
    one();
    (await waiting)();
    two();
    one(); // leaving twice is nothing
    expect(g.usage()).toMatchObject({ modelCalls: 0, modelQueued: 0 });
  });

  test("a caller that goes away while it waits leaves the queue", async () => {
    const { g } = governor({ capacity: () => capacity({ modelCalls: 1 }) });
    const held = await g.enterModel({ wait: true });
    const gone = new AbortController();
    const waiting = g.enterModel({ wait: true }, gone.signal);
    gone.abort();
    await expect(waiting).rejects.toThrow(/gave up waiting/);
    held();
    expect(g.usage()).toMatchObject({ modelCalls: 0, modelQueued: 0 });
  });
});
