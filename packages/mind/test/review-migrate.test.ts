import { describe, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MindStore } from "../src/index.ts";

/*
 * Review: a legacy (v1) fleet that adopted chains, written by the store at 391be80 (the
 * merge base), as the owner's fleet likely is (deployed before chains existed). One of its
 * nodes wrote an unchained event after the adoption (an old binary), and a revoked node
 * wrote in order after its revocation.
 */
const fixture = join(import.meta.dir, "fixtures", "review-legacy-v0.db");
const expected = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "review-legacy-v0.json"), "utf8"));

function open() {
  const dir = mkdtempSync(join(tmpdir(), "galahad-review-"));
  const path = join(dir, "mind.db");
  copyFileSync(fixture, path);
  return { dir, store: new MindStore(path) };
}

describe("review: migrating a legacy fleet", () => {
  test("it migrates with nothing lost", () => {
    const { dir, store } = open();
    try {
      expect(store.schemaVersion()).toBe(1);
      expect(store.eventCount()).toBe(expected.count);
      expect(store.digest()).toBe(expected.digest);
      expect(store.db.query("SELECT id, reason FROM v_rejected ORDER BY id").all()).toEqual(expected.rejected);
      expect(store.pendingCount()).toBe(expected.pending);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("after migrating, the replica agrees with a rebuild of the same log (and so with a replica that joins today)", () => {
    const { dir, store } = open();
    try {
      const migrated = store.digest();
      store.rebuild();
      expect(store.digest()).toBe(migrated);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the node that once wrote an unchained event doesn't replay the log for each of its events from now on", () => {
    const { dir, store } = open();
    try {
      expect(store.db.query("SELECT device FROM v_chainbad").all()).not.toContainEqual({ device: expected.devices.b });
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
