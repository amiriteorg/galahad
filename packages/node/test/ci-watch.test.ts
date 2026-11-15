import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { type ActionView, newNodeIdentity } from "@galahad/core";
import { foundFleet, MindStore } from "@galahad/mind";
import { CI_NO_CHECKS_MS, CI_WATCH_FOR_MS, CiWatch, ciVerdict, type ShippedPull, shippedPulls } from "../src/ci-watch.ts";

/* After you ship: the node that shipped follows the pull request's checks, and a failure waits in your Inbox. */

const run = (id: number, name: string, status: string, conclusion: string | null = null) => ({ id, name, status, conclusion });

describe("where a pull request's checks stand", () => {
  test("running until every check has ended; then passed, or failed with the ones that failed", () => {
    expect(ciVerdict([run(1, "test", "in_progress"), run(2, "lint", "completed", "success")], 60_000)).toEqual({ state: "running" });
    expect(ciVerdict([run(1, "test", "completed", "success"), run(2, "lint", "completed", "skipped"), run(3, "docs", "completed", "neutral")], 60_000)).toEqual({ state: "passed", total: 3 });
    expect(ciVerdict([run(1, "test", "completed", "failure"), run(2, "lint", "completed", "success"), run(3, "e2e", "completed", "timed_out")], 60_000)).toEqual({
      state: "failed",
      total: 3,
      failing: [run(1, "test", "completed", "failure"), run(3, "e2e", "completed", "timed_out")],
    });
    // A run cancelled because a newer one took its place isn't a failure.
    expect(ciVerdict([run(1, "test", "completed", "cancelled"), run(2, "test", "completed", "success")], 60_000)).toEqual({ state: "passed", total: 2 });
  });

  test("no check at all: still starting, until long enough after the ship that the repository has none", () => {
    expect(ciVerdict([], CI_NO_CHECKS_MS - 1)).toEqual({ state: "running" });
    expect(ciVerdict([], CI_NO_CHECKS_MS)).toEqual({ state: "none" });
  });
});

describe("which pull requests are followed", () => {
  const ship = (over: Partial<ActionView> = {}): ActionView => ({
    id: "a_ship1",
    connector: "github",
    tool: "ship",
    args: { owner: "amiriteorg", repo: "galahad", branch: "galahad/units", artifact: "art_x", title: "Units" },
    class: "outward",
    target: "POST /repos/amiriteorg/galahad/pulls (ship)",
    by: "galahad",
    why: null,
    node: "n_here",
    requestedAt: "x",
    expires: 0,
    state: "done",
    sendBy: null,
    decidedVia: null,
    order: null,
    receipt: "pull request #12: https://github.com/amiriteorg/galahad/pull/12 (3 files on galahad/units into main, commit 4f7a1c2e9b8d)",
    ...over,
  });
  const at = () => 1_000;

  test("each ship this node sent that went through, with its repository, branch and pull request", () => {
    expect(shippedPulls([ship()], "n_here", at)).toEqual([{ action: "a_ship1", owner: "amiriteorg", repo: "galahad", branch: "galahad/units", pr: 12, at: 1_000 }]);
  });

  test("not another node's, not one that failed or waits for you, not any other call", () => {
    for (const other of [ship({ node: "n_other" }), ship({ state: "failed" }), ship({ state: "waiting" }), ship({ tool: "pr.create" }), ship({ connector: "forge" })]) {
      expect(shippedPulls([other], "n_here", at)).toEqual([]);
    }
  });
});

describe("following the checks", () => {
  function harness(shipped: ShippedPull[]) {
    const identity = newNodeIdentity();
    const store = new MindStore(":memory:");
    foundFleet(store, identity, { fleetName: "camelot", nodeName: "here" });
    let now = 10 * 60_000;
    let checks: unknown = { total_count: 0, check_runs: [] };
    const annotations: Record<number, unknown> = {};
    const calls: string[] = [];
    const watch = new CiWatch({
      store,
      identity,
      local: new Database(":memory:"),
      shipped: () => shipped,
      call: async (tool, args) => {
        calls.push(`${tool} ${JSON.stringify(args)}`);
        const body = tool === "checks" ? checks : (annotations[args.check_run_id as number] ?? []);
        return { ok: true, status: 200, body: JSON.stringify(body) };
      },
      now: () => now,
      log: () => {},
    });
    const notices = () => store.lwwPrefix<{ title: string; body: string; severity: string; source: string } | null>("notice:ci:").map((entry) => entry.value).filter(Boolean);
    return { store, watch, calls, notices, set: (next: unknown) => (checks = next), annotate: (id: number, list: unknown) => (annotations[id] = list), at: (ms: number) => (now = ms) };
  }
  const pull: ShippedPull = { action: "a_ship1", owner: "amiriteorg", repo: "galahad", branch: "galahad/units", pr: 12, at: 5 * 60_000 };

  test("a failure waits in the Inbox, naming the pull request, each failing check, and what it reported against the code", async () => {
    const h = harness([pull]);
    h.set({ total_count: 2, check_runs: [run(7, "test", "in_progress"), run(8, "lint", "completed", "success")] });
    await h.watch.tick();
    expect(h.notices()).toEqual([]);
    expect(h.calls).toEqual([`checks {"owner":"amiriteorg","repo":"galahad","ref":"galahad/units","per_page":100}`]);
    h.set({ total_count: 2, check_runs: [run(7, "test", "completed", "failure"), run(8, "lint", "completed", "success")] });
    h.annotate(7, [{ path: "src/importer.ts", start_line: 14, annotation_level: "failure", message: "Expected 3, received 2\n  at importer.test.ts:9" }]);
    await h.watch.tick();
    expect(h.notices()).toEqual([
      expect.objectContaining({ title: "CI failed on amiriteorg/galahad#12", severity: "warn", source: "ci", body: "1 of 2 checks failed: test.\nsrc/importer.ts:14 Expected 3, received 2" }),
    ]);
    // Said once: the same failure seen again writes nothing more.
    const events = h.store.lwwPrefix("notice:ci:")[0]!.hlc;
    await h.watch.tick();
    expect(h.store.lwwPrefix("notice:ci:")[0]!.hlc).toBe(events);
  });

  test("fixed by a later push, the checks pass and the notice goes; then it stops looking", async () => {
    const h = harness([pull]);
    h.set({ total_count: 1, check_runs: [run(7, "test", "completed", "failure")] });
    await h.watch.tick();
    expect(h.notices()).toHaveLength(1);
    h.set({ total_count: 1, check_runs: [run(9, "test", "completed", "success")] });
    await h.watch.tick();
    expect(h.notices()).toEqual([]);
    const asked = h.calls.length;
    await h.watch.tick();
    expect(h.calls).toHaveLength(asked);
  });

  test("what CI printed is someone else's text: a line that looks like a key is left out", async () => {
    const h = harness([pull]);
    h.set({ total_count: 1, check_runs: [run(7, "test", "completed", "failure")] });
    h.annotate(7, [
      { path: "ci.yml", start_line: 3, message: "token ghp_0123456789abcdefghijklmnopqrstuvwxyzAB rejected" },
      { path: "src/a.ts", start_line: 2, message: "Type error" },
    ]);
    await h.watch.tick();
    const [notice] = h.notices();
    expect(notice!.body).not.toContain("ghp_");
    expect(notice!.body).toContain("src/a.ts:2 Type error");
    expect(notice!.body).toContain("a line that looked like a key was left out");
  });

  test("a GitHub connector installed before it could read checks is said once, not every few minutes", async () => {
    const logs: string[] = [];
    const identity = newNodeIdentity();
    const store = new MindStore(":memory:");
    foundFleet(store, identity, { fleetName: "camelot", nodeName: "here" });
    let asked = 0;
    const watch = new CiWatch({
      store,
      identity,
      local: new Database(":memory:"),
      shipped: () => [pull],
      call: async () => {
        asked += 1;
        throw new Error('github has no tool "checks" (it has: me, repo, issues)');
      },
      now: () => pull.at + 60_000,
      log: (line) => logs.push(line),
    });
    await watch.tick();
    await watch.tick();
    expect(asked).toBe(1);
    expect(logs.filter((line) => line.includes("add it again"))).toHaveLength(1);
  });

  test("a repository with no checks, and a ship more than a day old, aren't followed", async () => {
    const h = harness([pull, { ...pull, action: "a_old", at: -CI_WATCH_FOR_MS }]);
    h.at(pull.at + CI_NO_CHECKS_MS);
    await h.watch.tick();
    expect(h.calls).toHaveLength(1);
    await h.watch.tick();
    expect(h.calls).toHaveLength(1);
    expect(h.notices()).toEqual([]);
  });
});
