import { describe, expect, test } from "bun:test";
import { b64u, type GEvent, newNodeIdentity } from "@galahad/core";
import { enrollDevice, foundFleet, MindStore, revokeDevice } from "../src/index.ts";

/*
 * Loops, notices, connectors and the action outbox, as rules of the log: who may
 * write what, what stands when two answers race, and that every replica agrees.
 */

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const syncInto = (from: MindStore, to: MindStore) => {
  for (;;) {
    const { events, more } = from.eventsSince(to.frontier(), 50);
    to.ingest(events);
    if (!more) return;
  }
};

function fleet() {
  const a = newNodeIdentity();
  const b = newNodeIdentity();
  const storeA = new MindStore(":memory:");
  foundFleet(storeA, a, { fleetName: "camelot", nodeName: "ultra" });
  enrollDevice(storeA, a, { device: b.id, name: "laptop", kind: "node", box: b64u(b.boxPublic) });
  const storeB = new MindStore(":memory:");
  storeB.expectFleet(storeA.fleet!);
  syncInto(storeA, storeB);
  return { a, b, storeA, storeB };
}

const loop = (on: string, name = "heartbeat") => ({ name, schedule: "every 30m", tz: "UTC", on, enabled: true, task: { kind: "heartbeat" } });
const actionId = (n: number) => `a_${String(n).padStart(22, "0")}`;
const request = (id: string) => ({
  id,
  connector: "github",
  tool: "issue.create",
  args: { owner: "amiriteorg", repo: "galahad", title: "hi" },
  class: "outward" as const,
  target: "POST /repos/amiriteorg/galahad/issues",
  by: "arm:claude-code",
  expires: 2_000_000_000_000,
});

describe("loops in the log", () => {
  test("a loop names one active full node, and runs are recorded by nodes", () => {
    const { a, b, storeA } = fleet();
    storeA.emit(a, "loop.set", loop(b.id));
    expect(storeA.lww<{ on: string }>("loop:heartbeat")?.value?.on).toBe(b.id);
    const client = `c_${"A".repeat(43)}`;
    expect(() => storeA.emit(a, "loop.set", loop(client, "bad"))).toThrow(/active full node/);

    storeA.emit(a, "loop.ran", { loop: "heartbeat", run: "s1", slot: 1_800_000, status: "ok", started: 1, finished: 2, summary: "All quiet." });
    storeA.emit(a, "loop.ran", { loop: "heartbeat", run: "m2", slot: null, status: "attention", started: 3, finished: 4, summary: "One finding." });
    storeA.emit(a, "loop.ran", { loop: "other", run: "s9", slot: 9_000_000, status: "ok", started: 3, finished: 4, summary: "x" });
    expect(storeA.loopRuns("heartbeat").map((r) => r.body.run)).toEqual(["m2", "s1"]);
    expect(storeA.loopRuns(undefined, 2).map((r) => r.body.run)).toEqual(["s9", "m2"]);
    // By-hand runs don't count as the scheduled one.
    expect(storeA.lastSlot("heartbeat", a.id)).toBe(1_800_000);
    expect(storeA.lastSlot("heartbeat", b.id)).toBeNull();

    storeA.emit(a, "loop.removed", { name: "heartbeat" });
    expect(storeA.lww("loop:heartbeat")?.value).toBeNull();
    expect(storeA.lwwPrefix("loop:")).toHaveLength(0);
  });

  test("a revoked node's later loop definitions don't count", () => {
    const { a, b, storeA, storeB } = fleet();
    revokeDevice(storeA, a, b.id, "lost");
    // b hasn't heard yet and writes a loop; every replica that has the revocation refuses it.
    const late = storeB.emit(b, "loop.set", loop(b.id, "sneaky")) as GEvent;
    storeA.ingest([late]);
    expect(storeA.rejection(late.id)).not.toBeNull();
    expect(storeA.lww("loop:sneaky")).toBeNull();
  });
});

describe("notices in the log", () => {
  test("raised, dismissed (it stays dismissed), raised again when it changes, cleared", () => {
    const { a, storeA } = fleet();
    const raise = (body: string) => storeA.emit(a, "notice.raised", { key: "disk:x", severity: "warn", title: "Low disk", body, source: "heartbeat", at: 1 });
    raise("Under 4 GB free.");
    expect(storeA.lww<{ dismissed: boolean }>("notice:disk:x")?.value?.dismissed).toBe(false);
    storeA.emit(a, "notice.dismissed", { key: "disk:x" });
    expect(storeA.lww<{ dismissed: boolean; body: string }>("notice:disk:x")?.value).toMatchObject({ dismissed: true, body: "Under 4 GB free." });
    raise("Under 1 GB free.");
    expect(storeA.lww<{ dismissed: boolean }>("notice:disk:x")?.value?.dismissed).toBe(false);
    storeA.emit(a, "notice.cleared", { key: "disk:x" });
    expect(storeA.lww("notice:disk:x")?.value).toBeNull();
    expect(() => storeA.emit(a, "notice.dismissed", { key: "disk:x" })).toThrow(/no such notice/);
  });
});

describe("the action outbox in the log", () => {
  test("requested → decided once → done once, by the node that asked", () => {
    const { a, b, storeA, storeB } = fleet();
    storeA.emit(a, "action.requested", request(actionId(1)));
    syncInto(storeA, storeB);
    // You answer from the laptop; the first answer stands.
    storeB.emit(b, "action.decided", { id: actionId(1), verdict: "approved" }, { trust: "owner", via: "c_phone000000000000000000000000000000000000000" });
    expect(() => storeB.emit(b, "action.decided", { id: actionId(1), verdict: "denied" })).toThrow(/already decided/);
    syncInto(storeB, storeA);
    expect(storeA.lww<{ verdict: string; via: string }>(`action-decision:${actionId(1)}`)?.value).toMatchObject({ verdict: "approved" });
    // Only the node that filed it sends it and writes the receipt, and only once.
    expect(() => storeB.emit(b, "action.done", { id: actionId(1), ok: true, receipt: "201" })).toThrow(/only the node that filed/);
    storeA.emit(a, "action.done", { id: actionId(1), ok: true, status: 201, receipt: "201 created" });
    expect(() => storeA.emit(a, "action.done", { id: actionId(1), ok: true, receipt: "again" })).toThrow(/already done/);
  });

  test("nothing completes without an approval, and decisions need a request", () => {
    const { a, storeA } = fleet();
    expect(() => storeA.emit(a, "action.decided", { id: actionId(2), verdict: "approved" })).toThrow(/no such action/);
    storeA.emit(a, "action.requested", request(actionId(3)));
    expect(() => storeA.emit(a, "action.done", { id: actionId(3), ok: true, receipt: "sent anyway" })).toThrow(/not approved/);
    storeA.emit(a, "action.decided", { id: actionId(3), verdict: "denied" });
    expect(() => storeA.emit(a, "action.done", { id: actionId(3), ok: true, receipt: "sent anyway" })).toThrow(/not approved/);
    expect(() => storeA.emit(a, "action.requested", request(actionId(3)))).toThrow(/already filed/);
  });

  test("two answers racing from two nodes: every replica keeps the same first one", () => {
    const { a, b, storeA, storeB } = fleet();
    storeA.emit(a, "action.requested", request(actionId(4)));
    syncInto(storeA, storeB);
    storeA.emit(a, "action.decided", { id: actionId(4), verdict: "denied" });
    storeB.emit(b, "action.decided", { id: actionId(4), verdict: "approved" });
    syncInto(storeA, storeB);
    syncInto(storeB, storeA);
    const verdictA = storeA.lww<{ verdict: string }>(`action-decision:${actionId(4)}`)?.value?.verdict;
    expect(storeB.lww<{ verdict: string }>(`action-decision:${actionId(4)}`)?.value?.verdict).toBe(verdictA!);
    expect(storeA.digest()).toBe(storeB.digest());
  });
});

describe("convergence", () => {
  test("loops, notices, connectors and actions in any order give one digest", () => {
    const { a, b, storeA, storeB } = fleet();
    storeA.emit(a, "loop.set", loop(a.id));
    storeB.emit(b, "loop.set", { ...loop(b.id), schedule: "every 1h" });
    storeA.emit(a, "notice.raised", { key: "k1", severity: "info", title: "t", body: "b", source: "heartbeat", at: 1 });
    storeB.emit(b, "connector.set", { id: "github", manifest: { id: "github", anything: "goes in the log" } });
    storeA.emit(a, "action.requested", request(actionId(5)));
    syncInto(storeA, storeB);
    storeB.emit(b, "action.decided", { id: actionId(5), verdict: "approved" });
    storeB.emit(b, "notice.dismissed", { key: "k1" });
    syncInto(storeB, storeA);
    storeA.emit(a, "action.done", { id: actionId(5), ok: true, receipt: "ok" });
    storeA.emit(a, "loop.ran", { loop: "heartbeat", run: "s1", slot: 1, status: "ok", started: 1, finished: 2, summary: "fine" });
    syncInto(storeA, storeB);
    const digest = storeA.digest();
    expect(storeB.digest()).toBe(digest);

    const events = storeA.eventsSince({}, 100_000).events;
    for (let seed = 1; seed <= 12; seed++) {
      const random = rng(seed);
      const order = [...events];
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [order[i], order[j]] = [order[j]!, order[i]!];
      }
      const replica = new MindStore(":memory:");
      replica.expectFleet(storeA.fleet!);
      for (const event of [...order, ...order.slice(0, 5)]) replica.ingest([event]);
      expect(replica.digest()).toBe(digest);
      replica.rebuild();
      expect(replica.digest()).toBe(digest);
    }
  });
});
