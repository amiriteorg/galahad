import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { b64u, type GEvent, newNodeIdentity, type NodeIdentity, readCompanion } from "@galahad/core";
import { enrollDevice, foundFleet, MindStore } from "../src/index.ts";

/*
 * His dog's name is an owner's setting in the mind: signed, synced, last writer wins.
 * It converges like everything else (any order, duplicates, a rebuild), only a full
 * node sets it, and a replica that held the events before it knew the kind applies
 * them once it does.
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

function shuffle<T>(items: T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const allEvents = (store: MindStore): GEvent[] => store.eventsSince({}, 100_000).events;

function syncInto(from: MindStore, to: MindStore): void {
  for (;;) {
    const { events, more } = from.eventsSince(to.frontier(), 7);
    to.ingest(events);
    if (!more) return;
  }
}

function fleet(): { a: NodeIdentity; b: NodeIdentity; storeA: MindStore; storeB: MindStore } {
  const a = newNodeIdentity();
  const b = newNodeIdentity();
  const storeA = new MindStore(":memory:");
  foundFleet(storeA, a, { fleetName: "camelot", nodeName: "laptop" });
  enrollDevice(storeA, a, { device: b.id, name: "server", kind: "node", box: b64u(b.boxPublic) });
  const storeB = new MindStore(":memory:");
  storeB.expectFleet(storeA.fleet!);
  syncInto(storeA, storeB);
  return { a, b, storeA, storeB };
}

const nameOn = (store: MindStore) => readCompanion(store.lww("companion")?.value)?.name ?? null;

describe("his dog's name", () => {
  test("named on one node, it's the same on every node; unnamed, it's gone everywhere", () => {
    const { a, b, storeA, storeB } = fleet();
    expect(nameOn(storeA)).toBeNull();
    storeA.emit(a, "companion.named", { name: "Bors" });
    syncInto(storeA, storeB);
    expect(nameOn(storeB)).toBe("Bors");
    storeB.emit(b, "companion.unnamed", {});
    syncInto(storeB, storeA);
    expect(nameOn(storeA)).toBeNull();
    expect(storeA.digest()).toBe(storeB.digest());
  });

  test("two nodes naming it while apart agree on the later name once they meet", () => {
    const { a, b, storeA, storeB } = fleet();
    storeA.emit(a, "companion.named", { name: "Bors" });
    storeB.emit(b, "companion.named", { name: "Cavall" });
    syncInto(storeA, storeB);
    syncInto(storeB, storeA);
    expect(nameOn(storeA)).toBe(nameOn(storeB));
    expect(["Bors", "Cavall"]).toContain(nameOn(storeA)!);
    expect(storeA.digest()).toBe(storeB.digest());
  });

  test("PROPERTY: any delivery order, with duplicates, yields the same name and the identical mind; a rebuild too", () => {
    const { a, b, storeA, storeB } = fleet();
    for (let i = 0; i < 6; i++) {
      storeA.emit(a, "companion.named", { name: `Bors ${i}` });
      storeB.emit(b, i % 2 ? "companion.unnamed" : "companion.named", i % 2 ? {} : { name: `Cavall ${i}` });
      storeA.remember(a, `note ${i}`);
    }
    const everything = [...allEvents(storeA), ...allEvents(storeB)];
    let reference: { digest: string; name: string | null } | null = null;
    for (let seed = 1; seed <= 8; seed++) {
      const random = rng(seed);
      const replica = new MindStore(":memory:");
      replica.expectFleet(storeA.fleet!);
      const order = shuffle([...everything, ...everything.slice(0, 8)], random);
      for (let i = 0; i < order.length; i += 1 + Math.floor(random() * 5)) replica.ingest(order.slice(i, i + 5));
      replica.ingest(order);
      reference ??= { digest: replica.digest(), name: nameOn(replica) };
      expect({ digest: replica.digest(), name: nameOn(replica) }).toEqual(reference);
      replica.rebuild();
      expect({ digest: replica.digest(), name: nameOn(replica) }).toEqual(reference);
      replica.close();
    }
  }, 30_000);

  test("only a full node names it", () => {
    const { a, storeA } = fleet();
    const limited = newNodeIdentity();
    storeA.emit(a, "device.enrolled", { device: limited.id, name: "sensor", kind: "node", role: "limited", box: b64u(limited.boxPublic), scopes: [] });
    const store = new MindStore(":memory:");
    store.expectFleet(storeA.fleet!);
    syncInto(storeA, store);
    expect(() => store.emit(limited, "companion.named", { name: "Mordred" })).toThrow("only full nodes may name his dog");
    expect(() => store.emit(limited, "companion.unnamed", {})).toThrow("only full nodes may name his dog");
    expect(nameOn(store)).toBeNull();
  });

  test("a name the log takes but a reader doesn't know is no name, never an error", () => {
    const { a, storeA } = fleet();
    storeA.emit(a, "companion.named", { name: "Rex the 3rd!" });
    expect(storeA.lww("companion")?.value).toEqual({ name: "Rex the 3rd!" });
    expect(nameOn(storeA)).toBeNull();
  });

  test("a replica that held the name before it knew the kind applies it when it's upgraded", () => {
    const dir = mkdtempSync(join(tmpdir(), "galahad-companion-"));
    try {
      const path = join(dir, "mind.db");
      const a = newNodeIdentity();
      const store = new MindStore(path);
      foundFleet(store, a, { fleetName: "camelot", nodeName: "laptop" });
      store.emit(a, "companion.named", { name: "Bors" });
      const digest = store.digest();
      store.close();
      // As the older code left it: the events in the log, nothing in the views, the older schema version.
      const raw = new Database(path);
      raw.exec("DELETE FROM v_lww WHERE k = 'companion'; PRAGMA user_version = 1;");
      raw.close();
      const upgraded = new MindStore(path);
      expect(upgraded.schemaVersion()).toBe(3);
      expect(nameOn(upgraded)).toBe("Bors");
      expect(upgraded.digest()).toBe(digest);
      upgraded.close();
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
});
