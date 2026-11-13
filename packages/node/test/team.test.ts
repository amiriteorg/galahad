import { afterEach, describe, expect, test } from "bun:test";
import { TeamStore } from "../src/team-store.ts";
import { TeamError, TeamService, type TeamServiceOptions } from "../src/team.ts";

const fixtures: { store: TeamStore; service: TeamService }[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) { await fixture.service.stop(); fixture.store.close(); } });
const deferred = <T = void>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; };
async function until(ready: () => boolean): Promise<void> { for (let n = 0; n < 100 && !ready(); n++) await new Promise((resolve) => setTimeout(resolve, 1)); expect(ready()).toBe(true); }
function setup(options: Partial<Omit<TeamServiceOptions, "store">> = {}, budget = 8) {
  const store = new TeamStore(":memory:");
  for (const [id, name] of [["ada", "Ada"], ["lin", "Lin"], ["sam", "Sam"]] as const) store.saveTeammate({ id, name });
  store.saveRoom({ id: "workshop", name: "Workshop", members: ["ada", "lin"], turnBudget: budget });
  const service = new TeamService({ store, respond: async () => "", executeTask: async () => ({ verified: true, output: "Verified" }), ...options });
  fixtures.push({ store, service });
  return { store, service };
}

describe("teammates converse through the node", () => {
  test("an owner message reaches every member without mentions; silence does not fan out", async () => {
    const heard: string[] = [];
    const { store, service } = setup({ respond: async (teammate, _room, history) => { heard.push(teammate.id); expect(history[0]?.speaker).toBe("owner"); return ""; } });
    service.post({ room: "workshop", text: "Review this together." }); service.start(); await service.settled();
    expect(heard.sort()).toEqual(["ada", "lin"]);
    expect(store.messages("workshop")).toHaveLength(1);
    expect(store.deliveries().every((d) => d.status === "done")).toBe(true);
  });
  test("ordinary replies preserve identity and conversation ping-pong stops at the shared budget", async () => {
    const { store, service } = setup({ respond: async (teammate) => `I am ${teammate.name}.` }, 3);
    service.post({ room: "workshop", text: "Discuss." }); service.start(); await service.settled();
    const messages = store.messages("workshop");
    expect(messages).toHaveLength(4);
    expect(new Set(messages.map((m) => m.chainId)).size).toBe(1);
    expect(messages.slice(1).every((m) => m.speaker === "ada" || m.speaker === "lin")).toBe(true);
    expect(store.teammates().reduce((sum, t) => sum + t.turnsToday, 0)).toBe(3);
    expect(store.queued()).toHaveLength(0);
    expect(store.deliveries().some((d) => d.error?.includes("turn budget"))).toBe(true);
  });
  test("initiated DMs keep the same causal budget across rooms", async () => {
    let turns = 0;
    const { store, service } = setup({ respond: async (teammate, _room, _history, context) => { turns++; context.send({ teammate: teammate.id === "ada" ? "lin" : "ada" }, "Please discuss."); return ""; } }, 4);
    service.saveRoom({ id: "workshop", name: "Workshop", members: ["ada"] });
    service.post({ room: "workshop", text: "Ask Lin." }); service.start(); await service.settled();
    expect(turns).toBe(4);
    const direct = store.rooms().find((r) => r.direct)!;
    expect(direct.members.sort()).toEqual(["ada", "lin"]);
    const all = [...store.messages("workshop"), ...store.messages(direct.id)];
    expect(new Set(all.map((m) => m.chainId)).size).toBe(1);
  });
  test("the callback cannot spoof a sender or post into a room it does not belong to", async () => {
    const { store, service } = setup({ respond: async (_teammate, _room, _history, context) => { context.send({ room: "private" }, "Intrusion"); return ""; } });
    service.saveRoom({ id: "workshop", name: "Workshop", members: ["ada"] });
    service.saveRoom({ id: "private", name: "Private", members: ["sam"] });
    service.post({ room: "workshop", text: "Work." }); service.start(); await service.settled();
    expect(store.messages("private")).toHaveLength(0);
    expect(store.deliveries()[0]?.status).toBe("failed");
    expect(store.deliveries()[0]?.error).toContain("not a member");
  });
  test("model memory is private to the callback's identity and secret output never lands in history", async () => {
    const fake = "sk-ant-" + "obviouslyfaketest".repeat(3);
    const { store, service } = setup({ respond: async (teammate, _room, _history, context) => { context.remember(`${teammate.name}'s note.`); return fake; } }, 2);
    service.post({ room: "workshop", text: "Remember." }); service.start(); await service.settled();
    expect(store.teammate("ada")?.memory).toBe("Ada's note.");
    expect(store.teammate("lin")?.memory).toBe("Lin's note.");
    expect(store.teammate("sam")?.memory).toBe("");
    expect(JSON.stringify(store.messages("workshop"))).not.toContain(fake);
  });
});

describe("Galahad makes and briefs his own workers", () => {
  test("a worker that needs another makes one: it joins the room and takes work there, all within the one bounded chain", async () => {
    const heard: string[] = [];
    const recruited: string[] = [];
    const { store, service } = setup({
      onRecruit: (made) => { recruited.push(`${made.id} by ${made.createdBy}`); throw new Error("an observer cannot undo it"); },
      respond: async (teammate, _room, _history, context) => {
        heard.push(teammate.id);
        if (teammate.id !== "ada" || store.teammate("rev")) return "";
        const made = context.recruit({ id: "rev", name: "Rev", instructions: "Review Ada's diffs independently." });
        context.delegate({ assignee: made.id, title: "Review", goal: "Review the parser fix." });
        return "I made Rev to review this.";
      },
    }, 6);
    service.saveRoom({ id: "workshop", name: "Workshop", members: ["ada"] });
    const asked = service.post({ room: "workshop", text: "Fix the parser, and have it reviewed." }); service.start(); await service.settled();
    expect(store.teammate("rev")).toMatchObject({ createdBy: "ada", instructionsBy: "ada", enabled: true, instructions: "Review Ada's diffs independently." });
    expect(recruited).toEqual(["rev by ada"]);
    expect(store.room("workshop")!.members).toEqual(["ada", "rev"]);
    expect(store.tasks("workshop").map((task) => [task.assignee, task.status, task.chainId])).toEqual([["rev", "done", asked.chainId]]);
    // Rev hears Ada's reply in the room it joined, in the same chain: nothing of this started a budget of its own.
    expect(heard).toContain("rev");
    expect(store.deliveries().every((delivery) => delivery.chainId === asked.chainId)).toBe(true);
    expect(store.teammates().reduce((sum, t) => sum + t.turnsToday, 0)).toBeLessThanOrEqual(6);
  });
  test("making workers is held to the day's allowance and to a turn's actions; one who may no longer act makes none", async () => {
    const outcomes: string[] = [];
    const { store, service } = setup({ respond: async (teammate, _room, _history, context) => {
      if (teammate.id !== "ada") return "";
      for (let n = 0; n < 70; n++) {
        try { context.recruit({ id: `helper-${n}`, name: `Helper-${n}`, instructions: "Help." }); outcomes.push("made"); }
        catch (error) { const message = (error as Error).message; outcomes.push(message.includes("allowance") ? "allowance" : message.includes("action limit") ? "actions" : message); }
      }
      return "";
    } });
    service.saveRoom({ id: "workshop", name: "Workshop", members: ["ada"] });
    service.post({ room: "workshop", text: "Get help." }); service.start(); await service.settled();
    // Eight in a day; asking again is an action too, and a turn has sixty-four of those.
    expect(outcomes.slice(0, 8)).toEqual(Array(8).fill("made"));
    expect(outcomes.slice(8, 64)).toEqual(Array(56).fill("allowance"));
    expect(outcomes.slice(64)).toEqual(Array(6).fill("actions"));
    expect(store.teammates().filter((t) => t.createdBy === "ada")).toHaveLength(8);
  });
  test("a worker that was paused while it worked makes no one", async () => {
    let outcome = "";
    const { store, service } = setup({ respond: async (teammate, _room, _history, context) => {
      if (teammate.id !== "ada") return "";
      store.enable("ada", false);
      try { context.recruit({ id: "after-pause", name: "After", instructions: "Help." }); outcome = "made"; } catch (error) { outcome = (error as Error).message; }
      return "";
    } });
    service.saveRoom({ id: "workshop", name: "Workshop", members: ["ada"] });
    service.post({ room: "workshop", text: "Get help." }); service.start(); await service.settled();
    expect(outcome).toContain("may no longer act");
    expect(store.teammate("after-pause")).toBeNull();
  });
  test("a worker made in a direct conversation stays out of it, and is reached by a message of its maker's", async () => {
    const { store, service } = setup({ respond: async (teammate, room, _history, context) => {
      if (teammate.id === "ada" && room.direct && room.members.length === 1 && !store.teammate("aide")) {
        const made = context.recruit({ id: "aide", name: "Aide", instructions: "Gather the references Ada asks for." });
        context.send({ teammate: made.id }, "Please gather the parser references.");
        return "I made Aide and asked for the references.";
      }
      return teammate.id === "aide" ? "Here they are." : "";
    } }, 5);
    const direct = service.direct("ada");
    const asked = service.post({ room: direct.id, text: "Find the references." }); service.start(); await service.settled();
    expect(store.room(direct.id)!.members).toEqual(["ada"]);
    const between = store.rooms().find((room) => room.direct && room.members.length === 2)!;
    expect(between.members).toEqual(["ada", "aide"]);
    expect(store.messages(between.id).map((message) => [message.speaker, message.chainId])).toEqual([["ada", asked.chainId], ["aide", asked.chainId]]);
  });
  test("Galahad's own message reaches a worker in its direct conversation with you, or a room, as his", async () => {
    const { store, service } = setup({ respond: async (teammate, _room, history) => `${teammate.name} heard ${history.at(-1)!.speakerName}.` }, 2);
    service.start();
    const toSam = service.say({ teammate: "sam", text: "Look into the flaky test." }); await service.settled();
    const direct = store.rooms().find((room) => room.direct)!;
    expect(direct.members).toEqual(["sam"]);
    expect(toSam.room).toBe(direct.id);
    expect(store.messages(direct.id).map((message) => [message.speaker, message.speakerName, message.text])).toEqual([["galahad", "Galahad", "Look into the flaky test."], ["sam", "Sam", "Sam heard Galahad."]]);
    // The same conversation you have with Sam: your own message lands beside his.
    expect(service.direct("sam").id).toBe(direct.id);
    const toRoom = service.say({ room: "workshop", text: "Compare notes." }); await service.settled();
    expect(toRoom).toMatchObject({ room: "workshop", speaker: "galahad" });
    expect(store.messages("workshop").filter((message) => message.chainId === toRoom.chainId).length).toBe(3);
    expect(() => service.say({ teammate: "nobody", text: "Anyone?" })).toThrow(/No such teammate/);
    expect(() => service.say({ text: "Nobody." } as never)).toThrow(TeamError);
    expect(() => service.say({ teammate: "sam", room: "workshop", text: "Both." })).toThrow(TeamError);
  });
  test("he makes a worker himself: new, his by record, told to whoever keeps the ledger; a stopped controller makes none", async () => {
    const recruited: string[] = [];
    const { store, service } = setup({ onRecruit: (made) => { recruited.push(`${made.id} by ${made.createdBy}`); } });
    expect(service.recruit({ id: "scout", name: "Scout", instructions: "Watch the dependency updates." })).toMatchObject({ id: "scout", createdBy: "galahad", instructionsBy: "galahad" });
    expect(recruited).toEqual(["scout by galahad"]);
    expect(() => service.recruit({ id: "ada", name: "Impostor", instructions: "Replace her." })).toThrow(/already exists/);
    expect(service.overview().workers.map((worker) => [worker.id, worker.madeBy])).toEqual([["ada", "owner"], ["lin", "owner"], ["sam", "owner"], ["scout", "galahad"]]);
    await service.stop();
    expect(() => service.recruit({ id: "late", name: "Late", instructions: "Too late." })).toThrow(/stopped/);
    expect(() => service.say({ teammate: "scout", text: "Too late." })).toThrow(/stopped/);
    expect(store.teammate("late")).toBeNull();
    expect(recruited).toEqual(["scout by galahad"]);
  });
});

describe("task orchestration", () => {
  test("the first active task may bind its VM once, but can never replace an existing workspace", async () => {
    const { store, service } = setup({ executeTask: async (teammate) => {
      service.planWorkspace(teammate.id, "host");
      service.setWorkspace(teammate.id, { node: "host", id: "0123456789" });
      expect(() => service.setWorkspace(teammate.id, { node: "host", id: "9999999999" })).toThrow(/Stop/);
      return { verified: true, output: "Prepared" };
    } });
    service.createTask({ room: "workshop", assignee: "ada", title: "First", goal: "First" });
    service.start(); await service.settled();
    expect(store.teammate("ada")?.workspace).toEqual({ node: "host", id: "0123456789" });
    expect(() => store.setWorkspace("ada", { node: "host", id: "9999999999" })).toThrow(/already has/);
  });
  test("activeWork projects current identities without fetching a snapshot", async () => {
    const finish = deferred<{ verified: boolean; output: string }>();
    const { store, service } = setup({ executeTask: async () => finish.promise });
    service.createTask({ room: "workshop", assignee: "ada", title: "Work", goal: "Work" });
    service.start(); await until(() => store.tasks()[0]?.status === "running");
    const snapshot = store.snapshot;
    store.snapshot = () => { throw new Error("Telemetry must not query the database"); };
    try {
      const work = service.activeWork();
      expect(work).toEqual([{ teammate: "ada", room: "workshop", kind: "task" }]);
      (work[0] as { teammate: string }).teammate = "not-the-worker";
      expect(service.activeWork()[0]?.teammate).toBe("ada");
    } finally { store.snapshot = snapshot; finish.resolve({ verified: true, output: "Verified" }); }
    await service.settled();
    expect(service.activeWork()).toEqual([]);
  });
  test("each teammate is serial across chat rooms and tasks while other teammates run in parallel", async () => {
    const chat = deferred<string>(); const task = deferred<{ verified: boolean; output: string }>();
    const starts: string[] = [];
    const { store, service } = setup({ respond: async (teammate) => { starts.push(`chat:${teammate.id}`); return teammate.id === "ada" ? chat.promise : ""; }, executeTask: async (teammate) => { starts.push(`task:${teammate.id}`); return task.promise; } });
    service.post({ room: "workshop", text: "Discuss." });
    service.createTask({ room: "workshop", assignee: "ada", title: "Implement", goal: "Implement" });
    service.start(); await until(() => starts.length === 2);
    expect(starts.sort()).toEqual(["chat:ada", "chat:lin"]);
    const dm = service.direct("ada"); service.post({ room: dm.id, text: "More" });
    expect(starts).not.toContain("task:ada");
    chat.resolve(""); await until(() => starts.includes("task:ada"));
    expect(starts.filter((s) => s === "chat:ada")).toHaveLength(1);
    task.resolve({ verified: true, output: "Checked" }); await service.settled();
    expect(starts.filter((s) => s === "chat:ada")).toHaveLength(2);
    expect(store.tasks()[0]?.status).toBe("done");
  });
  test("independent tasks run together; a dependent starts only after both verified results", async () => {
    const first = deferred<{ verified: boolean; output: string }>(); const second = deferred<{ verified: boolean; output: string }>();
    const started: string[] = [];
    const { store, service } = setup({ executeTask: async (_teammate, task) => { started.push(task.title); return task.title === "First" ? first.promise : task.title === "Second" ? second.promise : { verified: true, output: "Joined" }; } });
    service.saveRoom({ id: "workshop", name: "Workshop", members: ["ada", "lin", "sam"] });
    const a = service.createTask({ room: "workshop", assignee: "ada", title: "First", goal: "First" });
    const b = service.createTask({ room: "workshop", assignee: "lin", title: "Second", goal: "Second" });
    const c = service.createTask({ room: "workshop", assignee: "sam", title: "Join", goal: "Join", dependsOn: [a.id, b.id] });
    service.start(); await until(() => started.length === 2);
    first.resolve({ verified: true, output: "One" }); await until(() => store.task(a.id)?.status === "done");
    expect(started).not.toContain("Join");
    second.resolve({ verified: true, output: "Two" }); await service.settled();
    expect(started).toEqual(["First", "Second", "Join"]);
    expect(store.task(c.id)).toMatchObject({ status: "done", verified: true });
  });
  test("delegated tasks inherit identity, room and causal budget", async () => {
    const { store, service } = setup({ respond: async (_teammate, _room, _history, context) => { context.delegate({ assignee: "lin", title: "Check", goal: "Check", gates: ["bun test"] }); return ""; } }, 1);
    const owner = service.post({ room: "workshop", text: "Delegate." });
    service.start(); await service.settled();
    expect(store.tasks()).toHaveLength(1);
    expect(store.tasks()[0]).toMatchObject({ room: "workshop", assignee: "lin", chainId: owner.chainId, status: "stopped", gates: ["bun test"] });
  });
  test("an unverified result fails and never releases its dependents", async () => {
    const calls: string[] = [];
    const { store, service } = setup({ executeTask: async (_teammate, task) => { calls.push(task.id); return { verified: false, output: "I think it works" }; } });
    const a = service.createTask({ room: "workshop", assignee: "ada", title: "First", goal: "First" });
    const b = service.createTask({ room: "workshop", assignee: "lin", title: "Next", goal: "Next", dependsOn: [a.id] });
    service.start(); await service.settled();
    expect(calls).toEqual([a.id]); expect(store.task(a.id)?.status).toBe("failed"); expect(store.task(b.id)?.status).toBe("queued");
  });
});

describe("stopping, interruption and resource bounds", () => {
  test("a runner settling after bounded shutdown never touches the closed database or observers", async () => {
    const finish = deferred<{ verified: boolean; output: string }>(); let changes = 0;
    let rejectedAfterClose: boolean[] = [];
    const { store, service } = setup({ timeoutMs: 20, shutdownGraceMs: 1, onChange: () => { changes++; }, executeTask: async (_teammate, _task, context) => {
      const outcome = await finish.promise;
      rejectedAfterClose = [
        () => context.emit("Late progress"),
        () => context.remember("Late memory"),
        () => context.send({ teammate: "lin" }, "Late message"),
        () => context.delegate({ assignee: "lin", title: "Late task", goal: "Late task" }),
      ].map((write) => { try { write(); return false; } catch (error) { return (error as Error).message === "This teammate's work has stopped."; } });
      return outcome;
    } });
    const task = service.createTask({ room: "workshop", assignee: "ada", title: "First", goal: "First" });
    service.start(); await until(() => store.task(task.id)?.status === "running");
    await service.stop();
    expect(store.task(task.id)?.status).toBe("interrupted");
    store.close(); fixtures.splice(fixtures.findIndex((f) => f.service === service), 1);
    const atClose = changes;
    expect(() => service.planWorkspace("ada", "host")).toThrow("This team controller has stopped.");
    expect(() => service.setWorkspace("ada", { node: "host", id: "0123456789" })).toThrow("This team controller has stopped.");
    expect(() => service.post({ room: "workshop", text: "Late owner request" })).toThrow("This team controller has stopped.");
    finish.resolve({ verified: true, output: "Too late" });
    await service.settled(); await new Promise((resolve) => setTimeout(resolve, 25));
    expect(changes).toBe(atClose);
    expect(rejectedAfterClose).toEqual([true, true, true, true]);
    await service.stop();
  });
  test("pause cancels an active teammate, keeps queued work, and requires explicit resume", async () => {
    let calls = 0;
    const { store, service } = setup({ respond: async (teammate, _room, _history, context) => { if (teammate.id !== "ada") return ""; calls++; if (calls > 1) return ""; return new Promise<string>((resolve) => context.signal.addEventListener("abort", () => resolve("late words"), { once: true })); } });
    service.post({ room: "workshop", text: "Work." }); service.start(); await until(() => calls === 1);
    service.control({ teammate: "ada", action: "pause" }); await service.settled();
    expect(store.teammate("ada")?.enabled).toBe(false);
    expect(store.room("workshop")?.paused).toBe(false);
    expect(store.messages("workshop").some((m) => m.text === "late words")).toBe(false);
    service.control({ teammate: "ada", action: "resume" }); await service.settled(); expect(calls).toBe(2);
  });
  test("room stop cancels work and old manually stopped jobs do not replay when a room resumes", async () => {
    const { store, service } = setup();
    service.post({ room: "workshop", text: "Work." }); service.control({ room: "workshop", action: "stop" });
    service.start(); await service.settled();
    expect(store.deliveries().every((d) => d.status === "stopped")).toBe(true);
    service.control({ room: "workshop", action: "resume" }); await service.settled();
    expect(store.deliveries().every((d) => d.status === "stopped")).toBe(true);
    expect(store.teammates().every((t) => t.turnsToday === 0)).toBe(true);
  });
  test("a callback ignoring timeout keeps its VM lock until it ends and cannot publish late results", async () => {
    const finish = deferred<{ verified: boolean; output: string }>(); let calls = 0;
    const { store, service } = setup({ timeoutMs: 10, executeTask: async () => { calls++; return finish.promise; } });
    const a = service.createTask({ room: "workshop", assignee: "ada", title: "First", goal: "First" });
    const b = service.createTask({ room: "workshop", assignee: "ada", title: "Next", goal: "Next" });
    service.start(); await until(() => store.task(a.id)?.status === "interrupted");
    expect(calls).toBe(1); expect(store.task(b.id)?.status).toBe("queued");
    expect(() => service.control({ task: a.id, action: "resume" })).toThrow(/still stopping/);
    finish.resolve({ verified: true, output: "Too late" }); await service.settled();
    expect(store.task(a.id)).toMatchObject({ status: "interrupted", verified: false, output: "" });
  });
  test("restart resumes untouched queues but does not replay interrupted side effects", async () => {
    let calls = 0;
    const { store, service } = setup({ executeTask: async () => { calls++; return { verified: true, output: "Checked" }; } });
    const active = store.createTask({ room: "workshop", assignee: "ada", title: "Interrupted", goal: "Interrupted" });
    const queued = store.createTask({ room: "workshop", assignee: "lin", title: "Queued", goal: "Queued" });
    store.claim(active.id);
    service.start(); await service.settled();
    expect(calls).toBe(0); expect(store.task(active.id)?.status).toBe("interrupted"); expect(store.task(queued.id)?.status).toBe("queued");
    service.control({ room: "workshop", action: "resume" }); await service.settled();
    expect(calls).toBe(2); expect(store.task(active.id)?.status).toBe("done");
  });
});
