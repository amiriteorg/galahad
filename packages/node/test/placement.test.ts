import { describe, expect, test } from "bun:test";
import { type Calibration, bodyFingerprint, computeBody, type ComputeNodeView, deriveCapacity, KERNEL, type PeerStatus, REFERENCE_SINGLE } from "@galahad/core";
import type { Capabilities } from "../src/capabilities.ts";
import { type Candidate, Dispatched, fleetCandidates, place, sandboxHost, withDispatched } from "../src/placement.ts";

/*
 * Placement with compute: a node's measured strength counts instead of its core
 * count, room counts for it and a full node against it, and every reason is said.
 */

const caps = (over: Partial<Capabilities> = {}): Capabilities => ({
  os: "linux",
  arch: "x64",
  hostname: "h",
  cores: 32,
  cpu: "test",
  memoryGb: 128,
  hasBattery: false,
  gpu: [],
  docker: true,
  vm: { kvm: true, tools: [] },
  tools: ["git"],
  localModels: [],
  tailscale: null,
  sandbox: { image: true, networks: true },
  ...over,
});

/** A candidate that measured `delivered` cores' worth at `speed` times the reference, with `free` slots free and `queued` waiting. */
function node(name: string, c: Capabilities, measured: { delivered: number; speed?: number } | null, room: { free: number | null; queued?: number } | null = null): Candidate {
  const body = computeBody(c)!;
  const threads = Math.floor(c.cores / 2);
  const single = REFERENCE_SINGLE * (measured?.speed ?? 1);
  const calibration: Calibration | null = measured ? { at: 1, tookMs: 1, reason: "joined", body: bodyFingerprint(body, null), cpu: { single, multi: single * measured.delivered, threads, kernel: KERNEL } } : null;
  return { device: `n_${name}`, name, caps: c, online: true, self: false, presence: null, compute: { capacity: deriveCapacity(body, calibration, null), free: room?.free ?? null, queued: room?.queued ?? 0 } };
}

describe("placement uses what was measured", () => {
  test("the measured strength decides, not the core count: fewer, faster cores can win", () => {
    const many = node("many", caps({ cores: 64 }), { delivered: 12, speed: 0.5 }); // 64 slow threads: 6 reference cores' worth
    const few = node("few", caps({ cores: 16 }), { delivered: 8, speed: 2.5 }); // 16 fast threads: 20 reference cores' worth
    const { ranked } = place({ docker: true }, [many, few]);
    expect(ranked[0]!.name).toBe("few");
    expect(ranked[0]!.reasons).toContain("measured 20.0 reference cores' worth");
    expect(ranked[1]!.reasons).toContain("measured 6.0 reference cores' worth");
  });

  test("a node that hasn't measured itself is guessed from its threads, and the reason says it's a guess", () => {
    const { ranked } = place({ docker: true }, [node("new", caps(), null)]);
    expect(ranked[0]!.reasons).toContain("not measured yet: guessing from 32 threads");
  });

  test("without compute (an older caller) it scores as it always did", () => {
    const plain: Candidate = { device: "n_plain", name: "plain", caps: caps({ cores: 8 }), online: true, self: false, presence: null };
    const { ranked } = place({ docker: true }, [plain]);
    expect(ranked[0]).toMatchObject({ score: 52, reasons: [] });
  });
});

describe("placement is capacity-aware", () => {
  test("room counts for a node; a full one is ranked behind and says work would wait", () => {
    const full = node("full", caps(), { delivered: 16 }, { free: 0, queued: 2 });
    const roomy = node("roomy", caps({ cores: 16, memoryGb: 64 }), { delivered: 8 }, { free: 2 });
    const { ranked } = place({ docker: true, untrusted: true }, [full, roomy]);
    expect(ranked.map((p) => p.name)).toEqual(["roomy", "full"]);
    expect(ranked[0]!.reasons).toContain("2 of 2 slots free");
    expect(ranked[1]!.reasons).toContain("full: work waits for a slot (2 ahead)");
  });

  test("when every host is full, the one with the shorter queue is first", () => {
    const long = node("long", caps(), { delivered: 16 }, { free: 0, queued: 5 });
    const short = node("short", caps(), { delivered: 16 }, { free: 0, queued: 1 });
    expect(place({ docker: true }, [long, short]).ranked[0]!.name).toBe("short");
  });

  test("a node whose ceiling takes no sandboxes is ruled out for sandbox work, with the reason", () => {
    const none = node("none", caps(), { delivered: 16 }, { free: 0 });
    none.compute!.capacity.sandboxes = 0;
    const { ranked, rejected } = place({ docker: true, untrusted: true }, [none]);
    expect(ranked).toEqual([]);
    expect(rejected).toEqual([{ device: "n_none", name: "none", reason: "its ceiling takes no sandboxes" }]);
    // Work that needs no sandbox may still go there.
    expect(place({}, [none]).ranked).toHaveLength(1);
  });

  test("a node whose use isn't known says so and is neither favoured nor ruled out", () => {
    const { ranked } = place({ docker: true }, [node("quiet", caps(), { delivered: 16 }, { free: null })]);
    expect(ranked[0]!.reasons).toContain("4 slots (in use: not known)");
  });

  test("local-model work prefers the node whose model measured faster", () => {
    const slow = node("slow", caps({ localModels: [{ runtime: "ollama", models: ["a"] }] }), { delivered: 16 });
    const fast = node("fast", caps({ localModels: [{ runtime: "ollama", models: ["a"] }] }), { delivered: 16 });
    slow.compute!.capacity.reasons.push("x");
    fast.compute!.localTps = 60;
    slow.compute!.localTps = 6;
    const { ranked } = place({ localModels: true }, [slow, fast]);
    expect(ranked[0]!.name).toBe("fast");
    expect(ranked[0]!.reasons).toContain("its local model wrote 60 tokens a second");
  });
});

describe("sandboxes asked for between two syncs", () => {
  /** A fleet as the asking node sees it: itself (no sandbox host), and two hosts whose slots it knows from their last sync. */
  function fleet(rack: { free: number; queued?: number; sandboxes?: number }, tower: { free: number; queued?: number; sandboxes?: number }, reportedAt = 10_000) {
    const body = (c: Capabilities) => computeBody(c)!;
    const view = (id: string, name: string, c: Capabilities, delivered: number, room: { free: number; queued?: number; sandboxes?: number }): ComputeNodeView => {
      const threads = Math.floor(c.cores / 2);
      const calibration: Calibration = { at: 1, tookMs: 1, reason: "joined", body: bodyFingerprint(body(c), null), cpu: { single: REFERENCE_SINGLE, multi: REFERENCE_SINGLE * delivered, threads, kernel: KERNEL } };
      const capacity = deriveCapacity(body(c), calibration, null);
      const sandboxes = room.sandboxes ?? capacity.sandboxes - room.free;
      return { id, name, self: false, online: true, body: body(c), calibration, due: null, limit: null, capacity, use: { sandboxes, cores: sandboxes * 4, memoryGb: sandboxes * 8, queued: room.queued ?? 0, modelCalls: 0, modelQueued: 0 }, free: room.free, queue: [] };
    };
    const rackCaps = caps({ cores: 32, memoryGb: 128 }); // 16 threads did 16: 4 slots
    const towerCaps = caps({ cores: 16, memoryGb: 64 }); // 8 threads did 8: 2 slots
    const devices = [
      { id: "n_self", name: "laptop", kind: "node", profile: null },
      { id: "n_rack", name: "rack", kind: "node", profile: { caps: rackCaps as unknown as Record<string, unknown> } },
      { id: "n_tower", name: "tower", kind: "node", profile: { caps: towerCaps as unknown as Record<string, unknown> } },
    ];
    // Each host's sync was asked for at `reportedAt` and took 40 ms.
    const statuses: PeerStatus[] = ["n_rack", "n_tower"].map((device) => ({ device, online: true, lastSeen: reportedAt + 40, rttMs: 40, error: null, presence: null }));
    const compute = [view("n_rack", "rack", rackCaps, 16, rack), view("n_tower", "tower", towerCaps, 8, tower)];
    return { devices, self: "n_self", selfCaps: caps({ docker: false, sandbox: null }), statuses, compute };
  }

  test("a burst doesn't all go to the best host: what this node just sent counts until that host reports again", () => {
    const dispatched = new Dispatched();
    const went: string[] = [];
    // Six sandboxes within a second of each other; both hosts last reported everything free.
    for (let i = 0; i < 6; i++) {
      const host = sandboxHost(fleetCandidates({ ...fleet({ free: 4 }, { free: 2 }), dispatched }))!;
      went.push(host.name);
      dispatched.note(host.device, 1, 10_100 + i * 100);
    }
    // Four fit on the rack and two on the tower: nothing queues while a slot stands free.
    expect(went.filter((name) => name === "rack")).toHaveLength(4);
    expect(went.filter((name) => name === "tower")).toHaveLength(2);
    // Both are full now, as far as this node can tell: the next one's reasons say so.
    const seventh = sandboxHost(fleetCandidates({ ...fleet({ free: 4 }, { free: 2 }), dispatched }))!;
    expect(seventh.reasons.join(" ")).toMatch(/full: work waits for a slot \(0 ahead\)/);
  });

  test("once a host has reported, its report is the truth: nothing is counted twice", () => {
    const dispatched = new Dispatched();
    for (let i = 0; i < 4; i++) dispatched.note("n_rack", 1, 10_100 + i);
    expect(dispatched.since("n_rack", 10_000)).toBe(4);
    // Its next sync was asked for after all four were sent: they're in what it reported.
    const after = fleet({ free: 0 }, { free: 2 }, 15_000);
    const candidates = fleetCandidates({ ...after, dispatched });
    expect(candidates.find((c) => c.name === "rack")!.compute).toMatchObject({ free: 0, queued: 0 });
    expect(dispatched.since("n_rack", 15_000)).toBe(0);
    // A sandbox sent while that sync was under way may not be in it: it still counts.
    dispatched.note("n_tower", 1, 15_020);
    expect(fleetCandidates({ ...after, dispatched }).find((c) => c.name === "tower")!.compute).toMatchObject({ free: 1 });
  });

  test("a sandbox of its own that it ended frees its slot at once, a queue there is served first, and one that was never made is taken back", () => {
    const dispatched = new Dispatched();
    dispatched.note("n_rack", -1, 10_500);
    const full = fleet({ free: 0 }, { free: 0, queued: 1 });
    expect(sandboxHost(fleetCandidates({ ...full, dispatched }))!.name).toBe("rack");
    // On a host with work waiting, the freed slot is the waiting work's.
    dispatched.note("n_tower", -1, 10_600);
    expect(fleetCandidates({ ...full, dispatched }).find((c) => c.name === "tower")!.compute).toMatchObject({ free: 0, queued: 0 });
    const undo = dispatched.note("n_rack", 1, 10_700);
    expect(dispatched.since("n_rack", 10_000)).toBe(0);
    undo();
    expect(dispatched.since("n_rack", 10_000)).toBe(-1);
  });

  test("the correction itself: more than is free queues, fewer never frees more slots than the host has, and room nobody knows stays unknown", () => {
    const capacity = deriveCapacity(computeBody(caps())!, null, null);
    const room = { capacity: { ...capacity, sandboxes: 4 }, free: 2 as number | null, queued: 0 };
    expect(withDispatched(room, 1)).toMatchObject({ free: 1, queued: 0 });
    expect(withDispatched(room, 5)).toMatchObject({ free: 0, queued: 3 });
    expect(withDispatched(room, -1)).toMatchObject({ free: 3, queued: 0 });
    expect(withDispatched(room, -9)).toMatchObject({ free: 4, queued: 0 });
    expect(withDispatched({ ...room, free: 0, queued: 2 }, -3)).toMatchObject({ free: 1, queued: 0 });
    expect(withDispatched({ ...room, free: null }, 3)).toMatchObject({ free: null, queued: 0 });
    expect(withDispatched(room, 0)).toBe(room);
  });
});
