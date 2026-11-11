import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { b64u, type GEvent, HlcClock, newNodeIdentity, type NodeIdentity, signEvent } from "@galahad/core";
import { enrollDevice, foundFleet, MindStore, PullState } from "../src/index.ts";

/*
 * Review of t3/stability-speed-fixes-batch: adversarial cases. Each test states what should
 * hold; a failing one demonstrates a finding.
 */

const pull = (from: MindStore, to: MindStore, limit = 500) => {
  const state = new PullState(to);
  state.begin();
  for (let i = 0; i < 10_000; i++) {
    const { have, sets } = state.request(true);
    if (!state.receive(from.eventsSince(have, limit, sets)).more) return;
  }
  throw new Error("the pull never ended");
};

function twoNodes() {
  const a = newNodeIdentity();
  const b = newNodeIdentity();
  let now = Date.UTC(2026, 10, 1);
  const full = new MindStore(":memory:", new HlcClock(() => now));
  foundFleet(full, a, { fleetName: "review", nodeName: "a" });
  enrollDevice(full, a, { device: b.id, name: "b", kind: "node", box: b64u(b.boxPublic) });
  const replica = () => {
    const store = new MindStore(":memory:", new HlcClock(() => now));
    store.expectFleet(full.fleet!);
    return store;
  };
  return { a, b, full, replica, tick: () => (now += 10) };
}

/** `node`'s next event, dated exactly like its head, with an id ground to sort after it: chain-valid. */
function twin(store: MindStore, node: NodeIdentity, text: string): GEvent {
  const parent = store.event(store.head(node.id)!)!;
  for (let nonce = 0; ; nonce++) {
    const event = signEvent({ v: 2, fleet: store.fleet!, hlc: parent.hlc, device: node.id, prev: parent.id, kind: "memory.added", body: { text: `${text} ${nonce}` } }, node);
    if (event.id > parent.id) return event;
  }
}

describe("review: paged repair pages by hlc alone", () => {
  test("a device whose 500th and 501st events share an hlc can't be repaired: replicas disagree for good", () => {
    const { b, full, replica, tick } = twoNodes();
    // b (a stolen key) writes 500 ordinary events...
    for (let i = 0; i < 500; i++) {
      tick();
      full.emit(b, "memory.added", { text: `b ${i}` });
    }
    const first500 = full.eventsSince({}, 100_000).events;
    // ...then a 501st dated the same instant as the 500th (two tries to grind its id), then more.
    const hidden = twin(full, b, "hidden");
    full.ingest([hidden]);
    expect(full.rejection(hidden.id)).toBeNull();
    tick();
    const after = full.emit(b, "memory.added", { text: "after the twin" });

    // Another replica got b's first 500 straight from b (a partial delivery: SECURITY.md #4).
    const other = replica();
    other.ingest(first500);
    for (let i = 0; i < 5; i++) pull(full, other);

    // Each pull flags b for repair and walks it, but the walk's page ends at the 500th event, its
    // cursor is that event's hlc, and the next page asks for hlc > cursor: the 501st never comes.
    expect(other.event(hidden.id)).not.toBeNull();
    // So b's later events are a gap here and accepted there.
    expect(other.rejection(after.id)).toBe(full.rejection(after.id));
    expect(other.digest()).toBe(full.digest());
  });
});

describe("review: one refused unchained event makes a device replay forever", () => {
  test("a v1 event refused in a chained fleet doesn't make each of that node's later events replay the log", () => {
    const { b, full, replica, tick } = twoNodes();
    const other = replica();
    pull(full, other);
    // One unchained (v1) event signed by b: an old binary, say. Refused, harmlessly.
    tick();
    const v1 = signEvent({ v: 1, fleet: full.fleet!, hlc: new HlcClock(() => Date.UTC(2026, 10, 1) + 5).tick(), device: b.id, kind: "memory.added", body: { text: "old binary" } } as never, b);
    other.ingest([v1]);
    expect(other.rejection(v1.id)).toMatch(/unchained/);
    // b's ordinary, in-order, chained events from then on: each one replays the whole log here.
    let replays = 0;
    for (let i = 0; i < 5; i++) {
      tick();
      const event = full.emit(b, "ledger.recorded", { class: "read", resource: "t", target: `x${i}`, verdict: "allow" });
      if (other.ingest([event]).rebuilt) replays++;
    }
    expect(replays).toBe(0);
  });
});

describe("review: the running summaries and the cached digest", () => {
  test("a refused emit leaves the running summaries as the log says", () => {
    const { a, full } = twoNodes();
    const before = { n: full.eventCount(), d: full.deviceDigests() };
    expect(() => full.emit(a, "notice.dismissed", { key: "no-such-notice" })).toThrow(/not authorized/);
    expect({ n: full.eventCount(), d: full.deviceDigests() }).toEqual(before);
    expect(full.db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM events").get()!.n).toBe(before.n);
  });

  test("a second process writing the same replica (galahad rebuild, say) doesn't leave a stale digest behind", () => {
    const dir = mkdtempSync(join(tmpdir(), "galahad-review-"));
    try {
      const { b, full } = twoNodes();
      const path = join(dir, "mind.db");
      const daemon = new MindStore(path);
      daemon.expectFleet(full.fleet!);
      daemon.ingest(full.eventsSince({}, 1000).events);
      const cached = daemon.digest();
      const cli = new MindStore(path);
      cli.ingest([full.emit(b, "memory.added", { text: "written by another process" })]);
      cli.close();
      expect(daemon.digest()).not.toBe(cached);
      daemon.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
