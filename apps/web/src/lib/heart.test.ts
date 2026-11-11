import { describe, expect, test } from "bun:test";
import type { GalahadState, WorldHeartbeat, WorldPartner } from "@galahad/core/world";
import { galahadLine, lookOptions } from "./look.ts";
import { applyWorldEvent, danishClock, emptyWorld, heartbeatConcern, heartbeatLine, isIdle, readWorldEvent, worldSummary } from "./world.ts";

/*
 * His heartbeat and his partners, as the page reads them from the stream: checked at the
 * boundary (unknown fields ignored, an older node's hello without them is fine), folded
 * into the model, and said in words: "Heartbeat ✓ 12:30", or what needs you.
 */

const RAN = Date.parse("2026-11-11T11:30:00Z"); // 12:30 in Denmark
const beat = (over: Partial<WorldHeartbeat> = {}): WorldHeartbeat => ({ ran: RAN, status: "ok", counts: { info: 0, warn: 0, alert: 0 }, findings: [], fixed: [], selfAction: true, ...over });
const partner = (name: string): WorldPartner => ({ name, station: "library", doing: "Recall from the shared mind: the round table", since: 1, last: 2 });
const galahad: GalahadState = { station: "keep", doing: "At the keep", experiment: null, model: null, since: 0, idle: true };
const hello = (extra: object = {}) => ({ type: "hello", at: 5, galahad, nodes: [], experiments: [], thoughts: [], ...extra });
const round = (v: unknown) => readWorldEvent(JSON.parse(JSON.stringify(v)));

describe("reading the heartbeat and partners", () => {
  test("in a hello, and as their own events; JSON round trip", () => {
    const h = beat({ counts: { info: 0, warn: 1, alert: 0 }, findings: [{ key: "node-offline:n_rack", severity: "warn", title: "rack is offline", place: "node", node: "n_rack" }], fixed: ["Ran loop site again after one bad run"] });
    expect(round(hello({ heartbeat: h, partners: [partner("claude-code")] }))).toEqual({ type: "hello", at: 5, galahad, nodes: [], experiments: [], thoughts: [], heartbeat: h, partners: [partner("claude-code")] });
    expect(round({ type: "heartbeat", at: 6, heartbeat: h })).toEqual({ type: "heartbeat", at: 6, heartbeat: h });
    expect(round({ type: "heartbeat", at: 6, heartbeat: null })).toEqual({ type: "heartbeat", at: 6, heartbeat: null });
    expect(round({ type: "partners", at: 7, partners: [partner("opencode")] })).toEqual({ type: "partners", at: 7, partners: [partner("opencode")] });
  });

  test("unknown fields are ignored; a place it doesn't know is the keep; an older node's hello has neither", () => {
    const read = round(hello({ heartbeat: { ...beat(), mood: "fine", findings: [{ key: "k", severity: "warn", title: "t", place: "moon", node: "n_x", extra: 1 }] } }));
    expect(read && read.type === "hello" && read.heartbeat).toEqual(beat({ findings: [{ key: "k", severity: "warn", title: "t", place: "keep", node: null }] }));
    const old = round(hello());
    expect(old && old.type === "hello" && "heartbeat" in old).toBe(false);
    expect(applyWorldEvent(emptyWorld(), old!).heartbeat).toBeNull();
    expect(applyWorldEvent(emptyWorld(), old!).partners).toEqual([]);
  });

  test("what doesn't read is dropped, never the world: a bad heartbeat in a hello is unknown, a bad event is ignored", () => {
    const bad = round(hello({ heartbeat: { ran: "noon" }, partners: [{ name: "Not A Label!" }] }));
    expect(bad && bad.type === "hello" && bad.heartbeat).toBeNull();
    expect(bad && bad.type === "hello" && bad.partners).toEqual([]);
    expect(round({ type: "heartbeat", at: 1, heartbeat: { ...beat(), counts: { info: -1, warn: 0, alert: 0 } } })).toBeNull();
    expect(round({ type: "partners", at: 1, partners: [{ ...partner("x"), name: "<script>" }] })).toBeNull();
    expect(round({ type: "partners", at: 1, partners: Array.from({ length: 10 }, (_, i) => partner(`a${i}`)) })).toMatchObject({ partners: { length: 6 } });
  });

  test("idle: as the node says, or (an older node) resting at the keep", () => {
    expect(isIdle(galahad as never)).toBe(true);
    expect(isIdle({ ...galahad, idle: undefined } as never)).toBe(true);
    expect(isIdle({ ...galahad, idle: undefined, doing: "Recall from the shared mind" } as never)).toBe(false);
    expect(isIdle({ station: "library", doing: "Recall", experiment: null, model: null, since: 0 })).toBe(false);
  });
});

describe("in words", () => {
  test("Heartbeat ✓ 12:30 in Denmark; what needs you, and how many more; nothing before there's one", () => {
    expect(danishClock(RAN)).toBe("12:30");
    expect(heartbeatLine(beat())).toBe("Heartbeat ✓ 12:30");
    expect(heartbeatLine(beat({ status: "failed" }))).toBe("Heartbeat ✗ 12:30");
    expect(heartbeatLine(null)).toBeNull();
    expect(heartbeatLine(beat({ ran: null, status: null }))).toBe("Heartbeat: not yet");
    const two = beat({
      counts: { info: 1, warn: 1, alert: 1 },
      findings: [
        { key: "disk:n", severity: "alert", title: "ultra is low on disk", place: "racks", node: null },
        { key: "node-offline:n_rack", severity: "warn", title: "rack is offline", place: "node", node: "n_rack" },
        { key: "connector-key:gh", severity: "info", title: "GitHub needs its key", place: "messenger", node: null },
      ],
    });
    expect(heartbeatLine(two)).toBe("Needs you: ultra is low on disk (+1 more)");
    expect(heartbeatConcern(two)?.place).toBe("racks");
    // Information only isn't worth leaving his day for.
    expect(heartbeatConcern(beat({ counts: { info: 1, warn: 0, alert: 0 }, findings: [two.findings[2]!] }))).toBeNull();
  });

  test("his line in the selector: his day (or his work) and his heartbeat; the summary says it too", () => {
    const m = applyWorldEvent(emptyWorld(), { type: "hello", at: 1, galahad, nodes: [], experiments: [], thoughts: [], heartbeat: beat(), partners: [partner("claude-code")] });
    expect(galahadLine(m, "Walking the dog")).toBe("Walking the dog · Heartbeat ✓ 12:30");
    const working = applyWorldEvent(m, { type: "galahad", at: 2, galahad: { station: "library", doing: "Recall from the shared mind", experiment: null, model: null, since: 2 } });
    expect(galahadLine(working, "Walking the dog")).toBe("Recall from the shared mind · Heartbeat ✓ 12:30");
    expect(worldSummary(m)).toContain("Heartbeat ✓ 12:30.");
    expect(worldSummary(m)).toContain("With him: claude-code.");
  });

  test("the selector's Partners: the agents with him, then the fleet's nodes", () => {
    const m = applyWorldEvent(emptyWorld(), {
      type: "hello",
      at: 1,
      galahad,
      nodes: [
        { id: "n_ultra", name: "ultra", kind: "node", online: true, self: true, sandboxHost: true },
        { id: "n_rack", name: "rack", kind: "node", online: false, self: false, sandboxHost: false },
        { id: "c_phone", name: "phone", kind: "client", online: true, self: false, sandboxHost: false },
      ],
      experiments: [],
      thoughts: [],
      partners: [partner("claude-code")],
    });
    const partners = lookOptions(m).filter((o) => o.group === "Partners");
    expect(partners.map((o) => [o.label, o.target.kind, o.tone])).toEqual([
      ["claude-code", "partner", "ok"],
      ["ultra", "node", "ok"],
      ["rack", "node", "danger"],
    ]);
    expect(partners[2]!.meta).toBe("Silent");
    expect(lookOptions(m, "claude").map((o) => o.label)).toEqual(["claude-code"]);
  });
});
