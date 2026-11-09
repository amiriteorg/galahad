import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { b64u, newNodeIdentity, type NodeIdentity } from "@galahad/core";
import { enrollDevice, foundFleet, MindStore } from "@galahad/mind";
import { LoopRunner, type RunContext, type RunnableLoop, type RunResult } from "../src/loops.ts";

/*
 * The loop runner on a fake clock: due slots run once, missed slots once, a crash
 * mid-run is recorded and never rerun, and only the named node ever runs a loop.
 */

const T0 = Date.parse("2026-11-09T10:00:00Z");
const MIN = 60_000;

function world() {
  const a = newNodeIdentity();
  const b = newNodeIdentity();
  const store = new MindStore(":memory:");
  foundFleet(store, a, { fleetName: "camelot", nodeName: "ultra" });
  enrollDevice(store, a, { device: b.id, name: "laptop", kind: "node", box: b64u(b.boxPublic) });
  let now = T0;
  const clock = { now: () => now, set: (t: number) => void (now = t) };
  const calls: { loop: string; slot: number | null }[] = [];
  let behaviour: (loop: RunnableLoop, ctx: RunContext) => Promise<RunResult> = async () => ({ status: "ok", summary: "fine" });
  const local = new Database(":memory:");
  const runner = (identity: NodeIdentity = a, db = local) =>
    new LoopRunner({
      store,
      identity,
      local: db,
      log: () => {},
      now: clock.now,
      execute: (loop, ctx) => {
        calls.push({ loop: loop.name, slot: ctx.slot });
        return behaviour(loop, ctx);
      },
    });
  const define = (name: string, on: string, schedule = "every 30m", extra: Record<string, unknown> = {}) =>
    store.emit(a, "loop.set", { name, schedule, tz: "UTC", on, enabled: true, task: { kind: "heartbeat" }, ...extra });
  return { a, b, store, clock, calls, local, runner, define, setBehaviour: (f: typeof behaviour) => void (behaviour = f) };
}

describe("the loop runner", () => {
  test("a due slot runs once; the next slot runs next time", async () => {
    const w = world();
    w.clock.set(T0 - 5 * MIN); // defined at 09:55 (the clock is only used for runs; definitions carry their own hlc)
    w.define("beat", w.a.id);
    const r = w.runner();
    w.clock.set(Date.now() + 31 * MIN); // past the first slot after the definition
    r.tick();
    await r.settled();
    r.tick();
    await r.settled();
    expect(w.calls).toHaveLength(1);
    const first = w.calls[0]!.slot!;
    expect(first % (30 * MIN)).toBe(0);
    expect(w.store.loopRuns("beat").map((x) => x.body.status)).toEqual(["ok"]);
    w.clock.set(first + 30 * MIN + 1);
    r.tick();
    await r.settled();
    expect(w.calls.map((c) => c.slot)).toEqual([first, first + 30 * MIN]);
  });

  test("a node away for hours runs a missed loop once, not once per slot", async () => {
    const w = world();
    w.define("beat", w.a.id);
    const r = w.runner();
    w.clock.set(Date.now() + 5 * 60 * MIN);
    r.tick();
    await r.settled();
    r.tick();
    await r.settled();
    expect(w.calls).toHaveLength(1);
  });

  test("only the node a loop names runs it; paused loops wait", async () => {
    const w = world();
    w.define("elsewhere", w.b.id);
    w.define("paused", w.a.id, "every 30m", { enabled: false });
    const r = w.runner();
    w.clock.set(Date.now() + 61 * MIN);
    r.tick();
    await r.settled();
    expect(w.calls).toEqual([]);
    expect(r.mine().map((l) => l.name)).toEqual(["paused"]);
  });

  test("a run that throws is recorded as failed, with why", async () => {
    const w = world();
    w.define("bad", w.a.id);
    w.setBehaviour(async () => {
      throw new Error("no sandbox host is online");
    });
    const r = w.runner();
    w.clock.set(Date.now() + 31 * MIN);
    r.tick();
    await r.settled();
    expect(w.store.loopRuns("bad")[0]!.body).toMatchObject({ status: "failed", summary: "no sandbox host is online" });
  });

  test("a crash mid-run is recorded as interrupted on the next start, and that slot never reruns", async () => {
    const w = world();
    w.define("long", w.a.id);
    let release!: () => void;
    w.setBehaviour(() => new Promise<RunResult>((resolve) => (release = () => resolve({ status: "ok", summary: "late" }))));
    const crashed = w.runner();
    w.clock.set(Date.now() + 31 * MIN);
    crashed.tick();
    expect(w.calls).toHaveLength(1);
    // The process dies here: no loop.ran was written. A new runner starts on the same local storage.
    w.setBehaviour(async () => ({ status: "ok", summary: "fine" }));
    const restarted = w.runner();
    restarted.start(60 * 60_000);
    await restarted.settled();
    expect(w.store.loopRuns("long").map((x) => x.body.status)).toEqual(["interrupted"]);
    expect(w.calls).toHaveLength(1); // not rerun
    await restarted.stop();
    release();
    await crashed.settled();
  });

  test("by hand: runs now, doesn't count as the scheduled run, and never twice at once", async () => {
    const w = world();
    w.define("beat", w.a.id);
    let release!: () => void;
    w.setBehaviour(() => new Promise<RunResult>((resolve) => (release = () => resolve({ status: "attention", summary: "1 finding" }))));
    const r = w.runner();
    const { run } = r.runNow("beat");
    expect(run.startsWith("m")).toBe(true);
    expect(() => r.runNow("beat")).toThrow(/already running/);
    expect(r.isRunning("beat")).toBe(true);
    release();
    await r.settled();
    expect(w.store.loopRuns("beat")[0]!.body).toMatchObject({ slot: null, status: "attention" });
    expect(w.store.lastSlot("beat", w.a.id)).toBeNull();
    expect(() => r.runNow("nope")).toThrow(/doesn't run on this node/);
  });

  test("a run past its deadline is stopped", async () => {
    const w = world();
    w.define("slow", w.a.id);
    w.setBehaviour((_loop, ctx) => new Promise<RunResult>((_resolve, reject) => ctx.signal.addEventListener("abort", () => reject(new Error("aborted")))));
    const r = new LoopRunner({
      store: w.store,
      identity: w.a,
      local: w.local,
      log: () => {},
      now: w.clock.now,
      deadlineMs: 30,
      execute: (loop, ctx) => {
        w.calls.push({ loop: loop.name, slot: ctx.slot });
        return new Promise<RunResult>((_resolve, reject) => ctx.signal.addEventListener("abort", () => reject(new Error("aborted"))));
      },
    });
    r.runNow("slow");
    await r.settled();
    expect(w.store.loopRuns("slow")[0]!.body).toMatchObject({ status: "failed", summary: "Stopped at its deadline." });
  });

  test("at most a few runs at once; the rest wait their turn", async () => {
    const w = world();
    for (const name of ["one", "two", "three"]) w.define(name, w.a.id);
    const releases: (() => void)[] = [];
    w.setBehaviour(() => new Promise<RunResult>((resolve) => releases.push(() => resolve({ status: "ok", summary: "ok" }))));
    const r = w.runner();
    w.clock.set(Date.now() + 31 * MIN);
    r.tick();
    expect(w.calls).toHaveLength(2);
    for (const release of releases.splice(0)) release();
    await r.settled();
    r.tick();
    expect(w.calls).toHaveLength(3);
    for (const release of releases.splice(0)) release();
    await r.settled();
  });
});
