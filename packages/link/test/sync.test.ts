import { describe, expect, test } from "bun:test";
import { b64u, type GEvent, newNodeIdentity, type NodeIdentity, SyncRequest } from "@galahad/core";
import { type Device, enrollDevice, foundFleet, MindStore } from "@galahad/mind";
import { answerSync, SyncEngine } from "../src/index.ts";

/*
 * The sync engine against a peer that answers like today's nodes, and like the nodes from
 * before set hashes: the fleet keeps converging while it's being upgraded.
 */

function fleet() {
  const a = newNodeIdentity();
  const b = newNodeIdentity();
  const storeA = new MindStore(":memory:");
  foundFleet(storeA, a, { fleetName: "link", nodeName: "a" });
  enrollDevice(storeA, a, { device: b.id, name: "b", kind: "node", box: b64u(b.boxPublic) });
  for (let i = 0; i < 120; i++) storeA.emit(a, "ledger.recorded", { class: "create", resource: "sandbox.exec", target: `sb${i}`, verdict: "allow" });
  const storeB = new MindStore(":memory:");
  storeB.expectFleet(storeA.fleet!);
  return { a, b, storeA, storeB };
}

const peer = (identity: NodeIdentity): Device => ({ id: identity.id, profile: { endpoint: "http://peer.invalid", caps: {} } }) as Device;

interface Seen {
  bodies: Record<string, unknown>[];
  largest: number;
}

/** A peer answering /link/sync the way today's server does. */
function today(store: MindStore, seen: Seen, limit = 25) {
  return async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(new TextDecoder().decode(init!.body as Uint8Array)) as Record<string, unknown>;
    seen.bodies.push(body);
    const page = answerSync(store, SyncRequest.parse(body), limit);
    seen.largest = Math.max(seen.largest, page.events.length);
    return Response.json(page);
  };
}

/** A peer from before set hashes: its strict schema knows `have` and `digests` only, and it never says `repair`. */
function before(store: MindStore, seen: Seen) {
  return async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(new TextDecoder().decode(init!.body as Uint8Array)) as Record<string, unknown>;
    seen.bodies.push(body);
    if (Object.keys(body).some((key) => key !== "have" && key !== "digests")) return Response.json({ error: "invalid input" }, { status: 400 });
    const { events, more } = store.eventsSince(body.have as Record<string, string>, 500);
    return Response.json({ events, more });
  };
}

describe("the sync engine", () => {
  test("against today's nodes: learns they compare set hashes, then sends them, and repairs a hole page by page", async () => {
    const { a, b, storeA, storeB } = fleet();
    const seen: Seen = { bodies: [], largest: 0 };
    const engine = new SyncEngine(storeB, b, { fetch: today(storeA, seen) });
    await engine.pullFrom(peer(a));
    expect(storeB.digest()).toBe(storeA.digest());
    expect(seen.bodies[0]).not.toHaveProperty("sets"); // it doesn't know yet
    expect(seen.bodies.at(-1)).toHaveProperty("sets");

    // Punch a hole in b's copy of a's log, below its frontier.
    const victim = storeA.ledger(200).at(-10)!;
    storeB.db.query("DELETE FROM events WHERE id = ?").run(victim.id);
    storeB.rebuild();
    expect(storeB.event(victim.id)).toBeNull();
    seen.bodies.length = 0;
    seen.largest = 0;
    await engine.pullFrom(peer(a));
    expect(storeB.event(victim.id)).not.toBeNull();
    expect(storeB.digest()).toBe(storeA.digest());
    expect(storeB.deviceDigests()).toEqual(storeA.deviceDigests());
    expect(seen.largest).toBeLessThanOrEqual(25); // never more than a page
    expect(seen.bodies.length).toBeGreaterThan(120 / 25); // the walk took pages
    // Each page after the first went on from the event the walk had reached, not just its hlc.
    const walking = seen.bodies.filter((body) => !(body.have as Record<string, string>)[a.id] || (body.after as Record<string, string> | undefined)?.[a.id]);
    expect(walking.length).toBeGreaterThan(1);
    for (const body of walking.slice(1)) expect(body.after).toHaveProperty(a.id);
  });

  test("a walk's place is part of the contract; an older node's request, without it, still parses", () => {
    expect(SyncRequest.parse({ have: { n_x: "000000000000001.000000" } })).toEqual({ have: { n_x: "000000000000001.000000" } });
    expect(SyncRequest.parse({ have: {}, after: { n_x: "8SpuaToTVJa71zgvba41gtk83EkAB8nIV4TUfLJurdo" } }).after).toBeDefined();
    expect(() => SyncRequest.parse({ have: {}, after: { n_x: "x".repeat(65) } })).toThrow();
  });

  test("against a node from before set hashes: never sends them, and still converges", async () => {
    const { a, b, storeA, storeB } = fleet();
    const seen: Seen = { bodies: [], largest: 0 };
    const engine = new SyncEngine(storeB, b, { fetch: before(storeA, seen) });
    await engine.pullFrom(peer(a));
    await engine.pullFrom(peer(a));
    expect(storeB.digest()).toBe(storeA.digest());
    expect(seen.bodies.length).toBeGreaterThan(0);
    for (const body of seen.bodies) expect(Object.keys(body)).toEqual(["have"]);
  });

  test("today's nodes accept an older node's digests and ignore them: no repair, no whole log", () => {
    const { storeA, storeB } = fleet();
    storeB.ingest(storeA.eventsSince({}, 10_000).events);
    const request = SyncRequest.parse({ have: storeB.frontier(), digests: { [storeA.genesis!.device]: { n: 1, h: "sorted-ids-hash" } } });
    const page = answerSync(storeA, request);
    expect(page).toEqual({ events: [] as GEvent[], more: false, sets: true });
  });
});
