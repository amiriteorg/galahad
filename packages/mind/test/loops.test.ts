import { describe, expect, test } from "bun:test";
import { b64u, type GEvent, newNodeIdentity, registrationDigest, toolDigest } from "@galahad/core";
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

const PR = {
  id: "github",
  label: "GitHub",
  origin: "https://api.github.com",
  tools: {
    "issue.create": {
      description: "Open an issue.",
      method: "POST",
      path: "/repos/{owner}/{repo}/issues",
      params: { owner: { type: "string" }, repo: { type: "string" }, title: { type: "string", required: true } },
      class: "outward",
    },
  },
};
const orderId = (n: number) => `o_${String(n).padStart(22, "0")}`;
const order = (id: string, patch: Record<string, unknown> = {}) => ({
  id,
  connector: "github",
  tool: "issue.create",
  class: "outward" as const,
  args: { owner: "amiriteorg", repo: "*" },
  until: 4_000_000_000_000,
  digest: toolDigest(PR as never, "issue.create")!,
  label: "Issues in our repos",
  ...patch,
});

describe("standing orders in the log", () => {
  test("an order answers the action it covers, and the log says which order did", () => {
    const { a, storeA } = fleet();
    storeA.emit(a, "connector.set", { id: "github", manifest: PR });
    storeA.emit(a, "order.set", order(orderId(1)), { trust: "owner", via: `c_${"P".repeat(43)}` });
    expect(() => storeA.emit(a, "order.set", order(orderId(1), { label: "changed" }))).toThrow(/already exists/);
    storeA.emit(a, "action.requested", request(actionId(10)));
    storeA.emit(a, "order.applied", { order: orderId(1), action: actionId(10) });
    expect(storeA.lww(`action-decision:${actionId(10)}`)?.value).toMatchObject({ verdict: "approved", order: orderId(1) });
    // Once answered, nobody answers again, and the order can't be applied twice.
    expect(() => storeA.emit(a, "action.decided", { id: actionId(10), verdict: "denied" })).toThrow(/already decided/);
    expect(() => storeA.emit(a, "order.applied", { order: orderId(1), action: actionId(10) })).toThrow(/already decided/);
    storeA.emit(a, "action.done", { id: actionId(10), ok: true, receipt: "201" });
  });

  test("replicas refuse an order applied to what it doesn't cover", () => {
    const { a, b, storeA, storeB } = fleet();
    storeA.emit(a, "connector.set", { id: "github", manifest: PR });
    storeA.emit(a, "order.set", order(orderId(2), { args: { owner: "amiriteorg", repo: "website" } }));
    storeA.emit(a, "action.requested", request(actionId(11))); // repo galahad
    expect(() => storeA.emit(a, "order.applied", { order: orderId(2), action: actionId(11) })).toThrow(/doesn't cover/);
    expect(() => storeA.emit(a, "order.applied", { order: orderId(9), action: actionId(11) })).toThrow(/no such order/);
    storeA.emit(a, "order.set", order(orderId(3)));
    syncInto(storeA, storeB);
    // Only the node that filed the action applies an order to it.
    expect(() => storeB.emit(b, "order.applied", { order: orderId(3), action: actionId(11) })).toThrow(/only the node that filed/);
    // The tool changed after you signed: the order no longer applies.
    storeA.emit(a, "connector.set", { id: "github", manifest: { ...PR, tools: { "issue.create": { ...PR.tools["issue.create"], path: "/repos/{owner}/{repo}/pulls" } } } });
    expect(() => storeA.emit(a, "order.applied", { order: orderId(3), action: actionId(11) })).toThrow(/doesn't cover/);
  });

  test("a revoked order answers nothing, and an expired one neither", () => {
    const { a, storeA } = fleet();
    storeA.emit(a, "connector.set", { id: "github", manifest: PR });
    storeA.emit(a, "order.set", order(orderId(4)));
    storeA.emit(a, "order.revoked", { id: orderId(4) });
    expect(() => storeA.emit(a, "order.revoked", { id: orderId(4) })).toThrow(/already revoked/);
    expect(storeA.lww<{ revoked: boolean; label: string }>(`order:${orderId(4)}`)?.value).toMatchObject({ revoked: true, label: "Issues in our repos" });
    storeA.emit(a, "action.requested", request(actionId(12)));
    expect(() => storeA.emit(a, "order.applied", { order: orderId(4), action: actionId(12) })).toThrow(/revoked/);
    storeA.emit(a, "order.set", order(orderId(5), { until: 1_000 }));
    expect(() => storeA.emit(a, "order.applied", { order: orderId(5), action: actionId(12) })).toThrow(/doesn't cover/);
  });

  test("revoked on one node while applied on another: every replica agrees on what stood first", () => {
    const { a, b, storeA, storeB } = fleet();
    storeA.emit(a, "connector.set", { id: "github", manifest: PR });
    storeA.emit(a, "order.set", order(orderId(6)));
    storeA.emit(a, "action.requested", request(actionId(13)));
    syncInto(storeA, storeB);
    storeB.emit(b, "order.revoked", { id: orderId(6) });
    storeA.emit(a, "order.applied", { order: orderId(6), action: actionId(13) });
    syncInto(storeA, storeB);
    syncInto(storeB, storeA);
    expect(storeA.digest()).toBe(storeB.digest());
    const decided = storeA.lww(`action-decision:${actionId(13)}`)?.value ?? null;
    expect(storeB.lww(`action-decision:${actionId(13)}`)?.value ?? null).toEqual(decided);
  });
});

describe("investigations in the log", () => {
  const registration = {
    question: "Is f1 near 2 Hz?",
    hypothesis: "Euler–Bernoulli says so.",
    alternative: "Shear deformation matters.",
    predictions: [{ id: "P1", statement: "f1 ≈ 2.09 Hz", quantity: "f1 (Hz)", expected: "2.09 ± 1 %", refutedIf: "off by more than 1 %" }],
    method: "FEM",
    verification: ["mesh convergence"],
    uncertainty: "Richardson",
    decision: "Supported if P1 holds.",
  };
  const invId = (n: number) => `inv_${String(n).padStart(22, "0")}`;

  test("registered with its digest, immutable; concluded once, by the node that ran it", () => {
    const { a, b, storeA, storeB } = fleet();
    const digest = registrationDigest(registration);
    expect(() =>
      storeA.emit(a, "investigation.registered", { id: invId(1), question: "q", registration: { ...registration, decision: "moved goalposts" }, digest }),
    ).toThrow(/doesn't match its digest/);
    storeA.emit(a, "investigation.registered", { id: invId(1), question: "q", registration, digest });
    expect(() => storeA.emit(a, "investigation.registered", { id: invId(1), question: "q", registration, digest })).toThrow(/already registered/);
    syncInto(storeA, storeB);
    expect(() => storeB.emit(b, "investigation.concluded", { id: invId(1), status: "done", conclusion: "supported", summary: "s" })).toThrow(/only the node that ran/);
    storeA.emit(a, "investigation.concluded", { id: invId(1), status: "done", conclusion: "refuted", summary: "P1 off by 4 %" });
    expect(() => storeA.emit(a, "investigation.concluded", { id: invId(1), status: "done", conclusion: "supported", summary: "second thoughts" })).toThrow(/already concluded/);
    expect(storeA.lww<{ conclusion: string }>(`investigation-result:${invId(1)}`)?.value?.conclusion).toBe("refuted");
    expect(() => storeA.emit(a, "investigation.concluded", { id: invId(2), status: "stopped", summary: "" })).toThrow(/no such investigation/);
  });

  test("any order, one digest", () => {
    const { a, storeA } = fleet();
    storeA.emit(a, "investigation.registered", { id: invId(3), question: "q", registration, digest: registrationDigest(registration) });
    storeA.emit(a, "investigation.concluded", { id: invId(3), status: "done", conclusion: "supported", summary: "ok", predictions: [{ id: "P1", verdict: "consistent", value: 2.089, units: "Hz" }] });
    const digest = storeA.digest();
    const events = storeA.eventsSince({}, 100_000).events;
    for (let seed = 1; seed <= 6; seed++) {
      const random = rng(seed);
      const order = [...events].sort(() => random() - 0.5);
      const replica = new MindStore(":memory:");
      replica.expectFleet(storeA.fleet!);
      for (const event of order) replica.ingest([event]);
      expect(replica.digest()).toBe(digest);
    }
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
    storeA.emit(a, "connector.set", { id: "github", manifest: PR });
    storeB.emit(b, "order.set", order(orderId(7)));
    syncInto(storeB, storeA);
    storeA.emit(a, "action.requested", request(actionId(6)));
    storeA.emit(a, "order.applied", { order: orderId(7), action: actionId(6) });
    storeB.emit(b, "order.set", order(orderId(8)));
    syncInto(storeB, storeA);
    storeA.emit(a, "order.revoked", { id: orderId(8) });
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
