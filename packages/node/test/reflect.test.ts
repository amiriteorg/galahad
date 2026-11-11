import { describe, expect, test } from "bun:test";
import { b64u, findSecrets, newNodeIdentity, REFLECT_BUDGET, REFLECT_BUDGET_MAX, REFLECT_BUDGET_MIN, routes } from "@galahad/core";
import { foundFleet, MindStore } from "@galahad/mind";
import { danishDay, readReflection, type ReflectDeps, reflectionLines, reflectionPrompt, reflectOnce, type ReflectionInputs, tokensOf } from "../src/reflect.ts";
import { heartbeatView, selfActionOn } from "../src/heartbeat-world.ts";

/*
 * The daily reflection reads the day (never the bank, never a secret) within a budget,
 * keeps a few lines as his own memory, and turns what he'd like to do into suggestions.
 * And his heartbeat as the world shows it: from the mind, never the bank.
 */

const NOW = Date.parse("2026-11-11T20:30:00Z");
const H = 60 * 60_000;
// Obviously fake, but shaped like the real thing: the scanner must catch it.
const FAKE_KEY = `sk-ant-api03-${"FAKEFAKE".repeat(8)}`;

const day = (over: Partial<ReflectionInputs> = {}): ReflectionInputs => ({
  now: NOW,
  ledger: [
    { at: NOW - H, class: "create", resource: "docker.container", target: "galahad-q-abc", verdict: "allow" },
    { at: NOW - 2 * H, class: "read", resource: "bank", target: "transactions DK12 3456", verdict: "allow" },
    { at: NOW - 3 * H, class: "read", resource: "search", target: "rocket nozzle expansion ratio", verdict: "allow" },
    { at: NOW - 3 * H, class: "read", resource: "connector", target: `github key ${FAKE_KEY}`, verdict: "allow" },
    { at: NOW - 30 * H, class: "read", resource: "search", target: "yesterday's search", verdict: "allow" },
  ],
  notices: [
    { key: "node-offline:n_rack", severity: "warn", title: "rack is offline", source: "heartbeat", dismissed: false },
    { key: "bank-consent:n_self", severity: "warn", title: "The bank consent has ended", source: "heartbeat", dismissed: false },
    { key: "suggestion:2026-11-10:1", severity: "info", title: "Galahad suggests: yesterday's idea", source: "reflect", dismissed: false },
  ],
  runs: [
    { at: NOW - H, loop: "heartbeat", status: "ok", summary: "All quiet." },
    { at: NOW - 2 * H, loop: "reflect", status: "ok", summary: "Reflected on 2026-11-10" },
  ],
  chats: [
    { title: "Plan the round table", updatedAt: NOW - H, bank: false },
    { title: "What did I spend in October", updatedAt: NOW - H, bank: true },
    { title: "Old chat", updatedAt: NOW - 48 * H, bank: false },
  ],
  ...over,
});

const all = (sections: Record<string, string[]>) => Object.values(sections).flat().join("\n");

describe("what he reads", () => {
  test("the day's ledger, notices, runs and the titles of kept chats", () => {
    const text = all(reflectionLines(day()).sections);
    expect(text).toContain("create docker.container galahad-q-abc: allow");
    expect(text).toContain("rocket nozzle expansion ratio");
    expect(text).toContain("rack is offline");
    expect(text).toContain("heartbeat: ok");
    expect(text).toContain('"Plan the round table"');
  });

  test("never the bank: no bank ledger entry, no bank notice, no chat where he read the bank", () => {
    const text = all(reflectionLines(day()).sections);
    expect(text).not.toContain("DK12");
    expect(text).not.toContain("bank consent");
    expect(text).not.toContain("October");
    expect(text.toLowerCase()).not.toContain("bank");
  });

  test("never a secret: a line that looks like one is dropped whole", () => {
    const text = all(reflectionLines(day()).sections);
    expect(text).not.toContain("sk-ant");
    expect(text).not.toContain("github key");
    expect(findSecrets(text)).toEqual([]);
  });

  test("only today's (the last 24 hours), and not his own earlier reflections or suggestions", () => {
    const text = all(reflectionLines(day()).sections);
    expect(text).not.toContain("yesterday's search");
    expect(text).not.toContain("Old chat");
    expect(text).not.toContain("yesterday's idea");
    expect(text).not.toContain("Reflected on");
  });

  test("cut to the budget's reading share, a line from each heading in turn", () => {
    const busy = day({ ledger: Array.from({ length: 2000 }, (_, i) => ({ at: NOW - 60_000, class: "read", resource: "memory", target: `recall number ${i} of a long day`, verdict: "allow" })) });
    const small = reflectionLines(busy, REFLECT_BUDGET_MIN);
    const prompt = reflectionPrompt("2026-11-11", small.sections, 300);
    expect(tokensOf(prompt.length)).toBeLessThanOrEqual(REFLECT_BUDGET_MIN * 0.75);
    // A busy ledger doesn't crowd out the rest.
    expect(small.sections["Chats the owner kept (titles only)"]).toEqual(['"Plan the round table"']);
    expect(small.sections["What needs the owner (notices)"]!.length).toBeGreaterThan(0);
    const big = reflectionLines(busy, REFLECT_BUDGET_MAX);
    expect(big.tokens).toBeGreaterThan(small.tokens);
  });

  test("the budget is the owner's to set, within bounds, on the loop (brain:write)", () => {
    const task = (budget: number) => routes.setLoop.input.safeParse({ name: "reflect", task: { kind: "reflect", budget } }).success;
    expect(task(REFLECT_BUDGET)).toBe(true);
    expect(task(REFLECT_BUDGET_MIN - 1)).toBe(false);
    expect(task(REFLECT_BUDGET_MAX + 1)).toBe(false);
    expect(routes.setLoop.scope).toBe("brain:write");
  });
});

describe("what he writes", () => {
  test("three parts; the ideas are what's under Next", () => {
    const { text, ideas } = readReflection("Happened: a quiet day, one sandbox.\nLearned: rack drops off at night.\nNext:\n- Ask the owner about rack's power settings\n- Re-run the nozzle study with finer mesh\n2) Tidy old artifacts\n- a fourth idea");
    expect(text.split("\n")[0]).toBe("Happened: a quiet day, one sandbox.");
    expect(ideas).toEqual(["Ask the owner about rack's power settings", "Re-run the nozzle study with finer mesh", "Tidy old artifacts"]);
    expect(readReflection("**Next:** check the backups").ideas).toEqual(["check the backups"]);
    expect(readReflection("Happened: nothing much.").ideas).toEqual([]);
  });

  test("the day is Denmark's", () => {
    expect(danishDay(Date.parse("2026-11-11T22:59:00Z"))).toBe("2026-11-11");
    expect(danishDay(Date.parse("2026-11-11T23:01:00Z"))).toBe("2026-11-12");
  });
});

describe("a reflection", () => {
  function deps(over: Partial<ReflectDeps> = {}) {
    const asked: { role: string; prompt: string; maxChars: number }[] = [];
    const kept: { text: string; tags: string[] }[] = [];
    const suggested: string[][] = [];
    const d: ReflectDeps = {
      now: NOW,
      inputs: day(),
      budget: REFLECT_BUDGET,
      doneToday: () => false,
      role: () => "swift",
      ask: async (role, prompt, maxChars) => {
        asked.push({ role, prompt, maxChars });
        return "Happened: rack went offline.\nLearned: it sleeps at night.\nNext:\n- Ask about rack's sleep settings";
      },
      remember: (text, tags) => void kept.push({ text, tags }),
      suggest: (_day, ideas) => void suggested.push(ideas),
      ...over,
    };
    return { d, asked, kept, suggested };
  }

  test("is kept as his own memory for the day, and his ideas become suggestions", async () => {
    const { d, asked, kept, suggested } = deps();
    const result = await reflectOnce(d, new AbortController().signal);
    expect(result.status).toBe("ok");
    expect(asked[0]!.role).toBe("swift");
    expect(kept).toEqual([{ text: "Reflection on 2026-11-11:\nHappened: rack went offline.\nLearned: it sleeps at night.\nNext:\n- Ask about rack's sleep settings", tags: ["reflection", "day:2026-11-11"] }]);
    expect(suggested).toEqual([["Ask about rack's sleep settings"]]);
    // Within the budget: what he reads and what he may write together.
    expect(tokensOf(asked[0]!.prompt.length) + asked[0]!.maxChars / 4).toBeLessThanOrEqual(REFLECT_BUDGET + 1);
    expect(result.summary).toMatch(/of 4000 tokens/);
  });

  test("once a day: a second run that day asks no model", async () => {
    const { d, asked, kept } = deps({ doneToday: () => true });
    expect((await reflectOnce(d, new AbortController().signal)).summary).toContain("kept already");
    expect(asked).toEqual([]);
    expect(kept).toEqual([]);
  });

  test("what he writes is cut at his share of the budget", async () => {
    const { d, kept } = deps({ budget: REFLECT_BUDGET_MIN, ask: async () => `Happened: ${"a long ramble ".repeat(2000)}` });
    await reflectOnce(d, new AbortController().signal);
    expect(kept[0]!.text.length).toBeLessThanOrEqual(1500 + 40);
  });

  test("no usable role: no reflection, and it says so", async () => {
    const { d, asked } = deps({ role: () => null });
    expect(await reflectOnce(d, new AbortController().signal)).toMatchObject({ status: "attention" });
    expect(asked).toEqual([]);
  });

  test("a reflection that looks like it holds a secret isn't kept", async () => {
    const { d, kept, suggested } = deps({ ask: async () => `Happened: found ${FAKE_KEY} in a log.` });
    expect((await reflectOnce(d, new AbortController().signal)).status).toBe("attention");
    expect(kept).toEqual([]);
    expect(suggested).toEqual([]);
  });
});

describe("his heartbeat, as the world shows it", () => {
  function mind() {
    const a = newNodeIdentity();
    const store = new MindStore(":memory:");
    foundFleet(store, a, { fleetName: "camelot", nodeName: "ultra" });
    return { a, store };
  }
  const raise = (store: MindStore, a: ReturnType<typeof newNodeIdentity>, key: string, severity: "info" | "warn" | "alert", title: string, source = "heartbeat") =>
    store.emit(a, "notice.raised", { key, severity, title, body: "b", source, at: NOW });

  test("nothing before there's a heartbeat", () => {
    const { store } = mind();
    expect(heartbeatView(store)).toBeNull();
  });

  test("its last run, what's still open by severity and where, what he fixed; never the bank, never what's dismissed", () => {
    const { a, store } = mind();
    store.emit(a, "loop.set", { name: "heartbeat", schedule: "every 30m", tz: "UTC", on: a.id, enabled: true, task: { kind: "heartbeat" } });
    raise(store, a, "node-offline:n_rack", "warn", "rack is offline");
    raise(store, a, "disk:n_self", "alert", "ultra is low on disk");
    raise(store, a, "loop-failing:site", "warn", "Loop site keeps failing");
    raise(store, a, "sandbox-overdue:0123456789", "warn", "Sandbox 0123456789 outlived its time");
    raise(store, a, "bank-consent:n_self", "warn", "The bank consent has ended");
    raise(store, a, "connector-key:github", "info", "GitHub needs its key");
    store.emit(a, "notice.dismissed", { key: "connector-key:github" });
    raise(store, a, "loop:site", "warn", "Loop site failed", "loop:site");
    const started = Date.now();
    store.emit(a, "ledger.recorded", { class: "delete", resource: "self-action", target: "reap-sandbox:0123456789", verdict: "allow", quest: "galahad.self", detail: "Removed sandbox 0123456789, which had outlived its time" });
    store.emit(a, "loop.ran", { loop: "heartbeat", run: "s1", slot: null, status: "attention", started, finished: Date.now() + 1, summary: "x" });
    const view = heartbeatView(store)!;
    expect(view.status).toBe("attention");
    expect(view.counts).toEqual({ alert: 1, warn: 3, info: 0 });
    expect(view.findings.map((f) => [f.key, f.place, f.node])).toEqual([
      ["disk:n_self", "racks", null],
      ["loop-failing:site", "messenger", null],
      ["node-offline:n_rack", "node", "n_rack"],
      ["sandbox-overdue:0123456789", "forge", null],
    ]);
    expect(JSON.stringify(view)).not.toMatch(/bank/i);
    expect(view.fixed).toEqual(["Removed sandbox 0123456789, which had outlived its time"]);
    expect(view.selfAction).toBe(true);
  });

  test("self-action is on unless a heartbeat loop says it's off", () => {
    const { a, store } = mind();
    expect(selfActionOn(store)).toEqual({ on: true, heartbeats: [] });
    store.emit(a, "loop.set", { name: "heartbeat", schedule: "every 30m", tz: "UTC", on: a.id, enabled: true, task: { kind: "heartbeat" } });
    expect(selfActionOn(store).on).toBe(true);
    store.emit(a, "loop.set", { name: "heartbeat", schedule: "every 30m", tz: "UTC", on: a.id, enabled: true, task: { kind: "heartbeat", selfAction: false } });
    expect(selfActionOn(store)).toEqual({ on: false, heartbeats: ["heartbeat"] });
    expect(heartbeatView(store)!.selfAction).toBe(false);
    void b64u;
  });
});
