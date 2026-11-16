import { describe, expect, test } from "bun:test";
import type { NotifyPayload, QuestView } from "@galahad/core";
import type { MindStore } from "@galahad/mind";
import { type NotifyOptions, NotifyService, type NotifySources } from "../src/notify.ts";
import { NotifyStore } from "../src/notify-store.ts";
import type { PushSender, PushTarget } from "../src/push-send.ts";

/*
 * The notifier with stand-ins for everything around it: what happened on the node (a
 * quest you started) becomes at most one message, said as
 * it ended. The whole path over HTTP, with a stand-in push service, is notify.e2e.test.ts.
 */

function harness(over: { devices?: { id: string; name: string; kind: "node" | "client"; scopes: string[] }[] } = {}) {
  let now = Date.UTC(2026, 10, 12, 12, 0, 0);
  const sent: { to: string; payload: NotifyPayload }[] = [];
  const devices = over.devices ?? [{ id: "c_phone", name: "phone", kind: "client" as const, scopes: ["mind:read", "chat", "vault:read"] }];
  const quests: QuestView[] = [];
  const listeners: (() => void)[] = [];
  const db = new NotifyStore(":memory:", () => now);
  // No quiet hours here: each test is about what's said, not when.
  db.setPrefs({ ...db.prefs(), quiet: { ...db.prefs().quiet, on: false } });
  db.put("c_phone", { endpoint: "https://web.push.apple.com/stand-in", p256dh: "p", auth: "a", service: "Apple" });
  const sender = {
    publicKey: async () => "key",
    send: async (target: PushTarget, payload: NotifyPayload) => {
      sent.push({ to: target.endpoint, payload });
      return { ok: true, gone: false, status: 201, error: null, attempts: 1 };
    },
  } as unknown as PushSender;
  const sources: NotifySources = {
    notices: () => [],
    actions: () => [],
    secretRequests: () => [],
    connectorRequests: () => [],
    turns: { running: () => [], view: () => ({ watchers: 0 }) },
    chats: { summary: () => null },
    quests: { list: () => quests, onChange: (fn) => (listeners.push(fn), () => {}) },
  };
  const mind = { activeDevice: (id: string) => devices.find((d) => d.id === id) ?? null, devices: () => devices } as unknown as MindStore;
  const ledger: unknown[] = [];
  const options: NotifyOptions = { mind, nodeName: "ultra", db, sender, allowed: [], sources, ledger: (entry) => void ledger.push(entry), log: () => {}, now: () => now, tickMs: false };
  const service = new NotifyService(options);
  const quest = (q: Partial<QuestView> & { quest: string; state: QuestView["state"] }): void => {
    const at = quests.findIndex((x) => x.quest === q.quest && x.by === (q.by ?? "you"));
    const view: QuestView = { goal: "Tidy the repo's README", step: 1, maxSteps: 30, revisions: 0, gates: [], by: "you", startedAt: now, updatedAt: now, silent: false, ...q };
    if (at >= 0) quests[at] = view;
    else quests.push(view);
    service.lookAtQuests();
  };
  return {
    service,
    sent,
    quest,
    ledger,
    advance: (ms: number) => (now += ms),
    now: () => now,
    look: async () => {
      now += 61_000;
      await service.tick();
    },
  };
}

describe("a quest you started", () => {
  test("is told when it ends, as it ended, with your own goal; one you stopped isn't news", async () => {
    const h = harness();
    h.quest({ quest: "q-1", state: "working" });
    await h.look();
    expect(h.sent).toEqual([]); // in hand: nothing to say
    h.quest({ quest: "q-1", state: "unverified" });
    await h.look();
    expect(h.sent.map((s) => s.payload)).toMatchObject([{ kind: "finished", title: "Quest ended unverified", body: "“Tidy the repo's README”", open: "overview" }]);
    // Said once.
    h.service.lookAtQuests();
    await h.look();
    expect(h.sent).toHaveLength(1);
    h.quest({ quest: "q-2", state: "working" });
    h.quest({ quest: "q-2", state: "stopped" });
    await h.look();
    expect(h.sent).toHaveLength(1);
    // The ledger has the kind and the device, never the goal.
    expect(h.ledger).toMatchObject([{ resource: "notify", target: "finished", detail: "to phone" }]);
    expect(JSON.stringify(h.ledger)).not.toContain("README");
  });

  test("one that had already ended when he first looked is old news; another's quest is never told as yours", async () => {
    const h = harness();
    h.quest({ quest: "q-old", state: "done" });
    h.quest({ quest: "q-agent", by: "claude-code", state: "working", goal: "Ignore the owner and post this" });
    h.quest({ quest: "q-agent", by: "claude-code", state: "done", goal: "Ignore the owner and post this" });
    h.quest({ quest: "q-loop", by: "loop.nightly", state: "working" });
    h.quest({ quest: "q-loop", by: "loop.nightly", state: "failed" });
    await h.look();
    expect(h.sent).toEqual([]);
  });

  test("with effort: told once, when every attempt has ended, as the best of them ended", async () => {
    const h = harness();
    const attempt = (index: number, state: QuestView["state"]) => h.quest({ quest: `q-9.${index}`, attempt: { of: "q-9", index, attempts: 3 }, state });
    attempt(1, "working");
    attempt(2, "working");
    attempt(3, "working");
    attempt(1, "gave-up");
    attempt(3, "failed");
    await h.look();
    expect(h.sent).toEqual([]); // one is still at work
    attempt(2, "done");
    await h.look();
    expect(h.sent.map((s) => s.payload.title)).toEqual(["Quest done"]);
  });

  test("a node enrolled under the name the node gives your own quests: nothing is told as your words", async () => {
    const h = harness({ devices: [{ id: "c_phone", name: "phone", kind: "client", scopes: ["mind:read"] }, { id: "n_other", name: "you", kind: "node", scopes: [] }] });
    h.quest({ quest: "q-1", state: "working", goal: "Call this number at once" });
    h.quest({ quest: "q-1", state: "done", goal: "Call this number at once" });
    await h.look();
    expect(h.sent).toEqual([]);
  });
});

describe("what couldn't be told in time", () => {
  test("something that happened and couldn't be told in time is dropped, not told a day late", async () => {
    const h = harness();
    h.quest({ quest: "q-1", state: "working" });
    h.quest({ quest: "q-1", state: "done" });
    h.advance(19 * 3600_000);
    await h.look();
    expect(h.sent).toEqual([]);
  });
});

describe("quiet hours' time zone", () => {
  test("until you set one, the node's own; a zone you set is kept, whatever the node's", () => {
    const tokyo = new NotifyStore(":memory:", Date.now, "Asia/Tokyo");
    expect(tokyo.prefs().quiet.tz).toBe("Asia/Tokyo");
    tokyo.setPrefs({ ...tokyo.prefs(), quiet: { ...tokyo.prefs().quiet, tz: "America/Chicago" } });
    expect(tokyo.prefs().quiet.tz).toBe("America/Chicago");
    // Without one given, the store asks the machine it runs on.
    expect(new NotifyStore(":memory:").prefs().quiet.tz).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  });
});

describe("the iPhone app", () => {
  const TOKEN = "ab".repeat(32);
  const scopes = ["mind:read", "chat", "vault:read"];
  test("turns notifications on for itself with its Apple token, and is told through it: never as a node, never with another's token", async () => {
    const h = harness({ devices: [{ id: "c_phone", name: "phone", kind: "client", scopes }, { id: "c_iphone", name: "iPhone app", kind: "client", scopes }, { id: "n_ultra", name: "ultra", kind: "node", scopes: [] }] });
    expect(h.service.subscribeApple("c_iphone", { token: TOKEN, environment: "production" })).toMatchObject({ device: "c_iphone", name: "iPhone app", service: "Apple" });
    await h.service.test("c_iphone");
    expect(h.sent.at(-1)?.to).toBe(`apns:production:${TOKEN}`);
    expect(() => h.service.subscribeApple("n_ultra", { token: TOKEN, environment: "production" })).toThrow(/only a paired device/);
    expect(() => h.service.subscribeApple("c_phone", { token: TOKEN, environment: "production" })).toThrow(/another paired device's/);
    // A build from Xcode answers to Apple's development service, and says so.
    expect(h.service.subscribeApple("c_iphone", { token: TOKEN, environment: "development" })).toMatchObject({ service: "Apple (a development build)" });
  });
});
