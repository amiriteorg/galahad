import { describe, expect, test } from "bun:test";
import { type Calibration, bodyFingerprint, computeBody, deriveCapacity, REFERENCE_SINGLE } from "@galahad/core";
import type { Capabilities } from "../src/capabilities.ts";
import { type Candidate, place } from "../src/placement.ts";

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
  const calibration: Calibration | null = measured ? { at: 1, tookMs: 1, reason: "joined", body: bodyFingerprint(body, null), cpu: { single, multi: single * measured.delivered, threads } } : null;
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
