import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { b64u, HlcClock, newNodeIdentity, signEvent } from "@galahad/core";
import { enrollDevice, foundFleet, MindStore, PullState } from "../src/index.ts";

/*
 * Review of t3/stability-speed-fixes-batch: adversarial cases. Each test states what should
 * hold; a failing one demonstrates a finding.
 */

const pull = (from: MindStore, to: MindStore, limit = 500) => {
  const state = new PullState(to);
  state.begin();
  for (let i = 0; i < 10_000; i++) {
    const { have, sets, after } = state.request(true);
    if (!state.receive(from.eventsSince(have, limit, sets, after)).more) return;
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
