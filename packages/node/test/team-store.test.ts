import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { avatarExpression, defaultAvatar } from "@galahad/core/avatar";
import { TEAM_LIMITS } from "@galahad/core/team-limits";
import { TeamStore, TeamError } from "../src/team-store.ts";

const stores: TeamStore[] = [];
const dirs: string[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const make = (path = ":memory:", now?: () => number) => { const store = new TeamStore(path, now); stores.push(store); return store; };
const close = (store: TeamStore) => { store.close(); stores.splice(stores.indexOf(store), 1); };
const setup = (store: TeamStore) => {
  store.saveTeammate({ id: "ada", name: "Ada" }); store.saveTeammate({ id: "lin", name: "Lin" });
  store.saveRoom({ id: "workshop", name: "Workshop", members: ["ada", "lin"] });
};

describe("private team persistence", () => {
  test("custom appearances survive omitted edits and reopen; explicit null resets the seeded default", () => {
    const dir = mkdtempSync(join(tmpdir(), "galahad-team-avatar-")); dirs.push(dir); const path = join(dir, "team.db");
    const store = make(path);
    const avatar = { ...defaultAvatar("ada"), form: "round" as const, color: "#ffccdd", accessory: "plume" as const };
    expect(store.saveTeammate({ id: "ada", name: "Ada" }).avatar).toEqual(defaultAvatar("ada"));
    expect(store.saveTeammate({ id: "ada", name: "Ada", avatar }).avatar).toEqual(avatar);
    store.saveTeammate({ id: "ada", name: "Augusta" }); store.remember("ada", "Keep these notes.");
    store.setWorkspace("ada", { node: "host", id: "0123456789" }); close(store);
    const reopened = make(path);
    expect(reopened.teammate("ada")).toMatchObject({ name: "Augusta", avatar, memory: "Keep these notes.", workspace: { node: "host", id: "0123456789" } });
    expect(() => reopened.saveTeammate({ id: "ada", name: "Augusta", avatar: { ...avatar, color: "url(https://example.invalid/p)" } })).toThrow(TeamError);
    expect(reopened.teammate("ada")?.avatar).toEqual(avatar);
    expect(reopened.saveTeammate({ id: "ada", name: "Augusta", avatar: null }).avatar).toEqual(defaultAvatar("ada"));
  });
  test("legacy records get deterministic appearances without rewriting their saved JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "galahad-team-avatar-")); dirs.push(dir); const path = join(dir, "team.db");
    const store = make(path);
    const { avatar: _unused, ...legacy } = store.saveTeammate({ id: "ada", name: "Ada", instructions: "Preserve this instruction." }); close(store);
    const raw = JSON.stringify(legacy);
    const db = new Database(path);
    db.query("UPDATE team_teammates SET value=? WHERE id='ada'").run(raw);
    const reopened = make(path);
    expect(reopened.teammate("ada")).toMatchObject({ avatar: defaultAvatar("ada"), instructions: "Preserve this instruction." });
    expect(db.query<{ value: string }, []>("SELECT value FROM team_teammates WHERE id='ada'").get()?.value).toBe(raw);
    db.close();
  });
  test("teammates, memory, workspace, messages and queued work survive reopen; files stay private", () => {
    const dir = mkdtempSync(join(tmpdir(), "galahad-team-")); dirs.push(dir);
    const path = join(dir, "team.db");
    const store = make(path); setup(store);
    store.remember("ada", "The fixture uses Bun.");
    store.setWorkspace("ada", { node: "host", id: "0123456789" });
    store.post({ room: "workshop", text: "Discuss the fixture." });
    close(store);
    const reopened = make(path);
    expect(reopened.teammate("ada")).toMatchObject({ memory: "The fixture uses Bun.", workspace: { node: "host", id: "0123456789" } });
    expect(reopened.messages("workshop")).toHaveLength(1);
    expect(reopened.queued()).toHaveLength(2);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
  test("opening team tables does not rewrite unrelated existing tables", () => {
    const dir = mkdtempSync(join(tmpdir(), "galahad-team-")); dirs.push(dir);
    const path = join(dir, "team.db");
    const before = new Database(path); before.exec("CREATE TABLE previous_data(value TEXT); INSERT INTO previous_data VALUES('kept');"); before.close();
    make(path);
    const after = new Database(path); expect(after.query("SELECT value FROM previous_data").get()).toEqual({ value: "kept" }); after.close();
  });
  test("restart marks in-flight side effects interrupted, holds that room, and keeps queued work", () => {
    const store = make(); setup(store); store.post({ room: "workshop", text: "Work" });
    const first = store.queued()[0]!;
    expect(store.claim(first.id)).toBe(true);
    store.recover();
    expect(store.job(first.id)?.status).toBe("interrupted");
    expect(store.room("workshop")?.paused).toBe(true);
    expect(store.queued()).toHaveLength(1);
    expect(store.claim(store.queued()[0]!.id)).toBe(false);
  });
  test("renaming does not replace identity, memory or VM and historical names remain snapshots", () => {
    const store = make(); setup(store);
    store.remember("ada", "My notes"); store.setWorkspace("ada", { node: "host", id: "0123456789" });
    const owner = store.post({ room: "workshop", text: "Hello" });
    store.post({ room: "workshop", text: "Hello there" }, { teammate: "ada", chainId: owner.chainId });
    store.saveTeammate({ id: "ada", name: "Augusta" });
    expect(store.teammate("ada")).toMatchObject({ name: "Augusta", memory: "My notes", workspace: { node: "host", id: "0123456789" } });
    expect(store.messages("workshop").at(-1)?.speakerName).toBe("Ada");
    expect(() => store.setWorkspace("lin", { node: "host", id: "0123456789" })).toThrow(/another teammate/);
  });
  test("provisioning intent survives reopen and neither its host nor a bound repository silently changes", () => {
    const dir = mkdtempSync(join(tmpdir(), "galahad-team-")); dirs.push(dir); const path = join(dir, "team.db");
    const store = make(path); setup(store);
    store.saveTeammate({ id: "ada", name: "Ada", repository: "https://github.com/example/fixture.git" });
    store.planWorkspace("ada", "chosen-host"); close(store);
    const reopened = make(path);
    expect(reopened.teammate("ada")).toMatchObject({ workspace: null, workspaceNode: "chosen-host" });
    expect(() => reopened.planWorkspace("ada", "another-host")).toThrow(/another host/);
    expect(() => reopened.setWorkspace("ada", { node: "another-host", id: "0123456789" })).toThrow(/another host/);
    reopened.setWorkspace("ada", { node: "chosen-host", id: "0123456789" });
    expect(() => reopened.saveTeammate({ id: "ada", name: "Ada", repository: "https://github.com/example/different" })).toThrow(/already bound/);
    expect(() => reopened.saveTeammate({ id: "ada", name: "Augusta", repository: "https://github.com/example/fixture.git" })).not.toThrow();
  });
});

describe("team boundaries", () => {
  test("avatar telemetry keeps old live work and recent outcomes, grouped without private text", () => {
    let now = 100_000;
    const store = make(":memory:", () => now); setup(store);
    const old = store.createTask({ room: "workshop", assignee: "ada", title: "private old title", goal: "private old goal" });
    store.finish(old.id, "done", null, { verified: true, output: "private old output" });
    const running = store.createTask({ room: "workshop", assignee: "ada", title: "private active title", goal: "private active goal" }); store.claim(running.id);
    for (let n = 0; n < 3; n++) store.createTask({ room: "workshop", assignee: "ada", title: `private queued ${n}`, goal: "private goal" });
    store.post({ room: "workshop", text: "private conversation" });
    const delivery = store.queued().find((job) => job.kind === "delivery" && job.teammate === "lin")!; store.claim(delivery.id);
    now += 120_000;
    const failed = store.createTask({ room: "workshop", assignee: "lin", title: "private failure", goal: "private goal" });
    store.finish(failed.id, "done", null, { verified: false, output: "private unverified claim" });
    for (let n = 0; n < 3; n++) {
      const done = store.createTask({ room: "workshop", assignee: "lin", title: "private completion", goal: "private goal" });
      store.finish(done.id, "done", null, { verified: true, output: "private evidence ".repeat(2000) }); now++;
    }
    const activity = store.avatarActivity();
    expect(activity.tasks).toHaveLength(4); // one row per worker/status, not per task
    expect(activity.tasks).toContainEqual({ assignee: "ada", status: "running", verified: false, updatedAt: 100_000 });
    expect(activity.tasks).toContainEqual({ assignee: "ada", status: "queued", verified: false, updatedAt: 100_000 });
    expect(activity.tasks).toContainEqual({ assignee: "lin", status: "failed", verified: false, updatedAt: 220_000 });
    expect(activity.tasks).toContainEqual({ assignee: "lin", status: "done", verified: true, updatedAt: 220_002 });
    expect(activity.deliveries).toHaveLength(2);
    expect(JSON.stringify(activity)).not.toContain("private");
    expect(Object.keys(activity.tasks[0]!).sort()).toEqual(["assignee", "status", "updatedAt", "verified"]);
    expect(Object.keys(activity.deliveries[0]!).sort()).toEqual(["status", "teammate", "updatedAt"]);
    expect(avatarExpression(store.requireTeammate("ada"), activity, now)).toBe("working");
    expect(avatarExpression(store.requireTeammate("lin"), activity, now)).toBe("thinking");
    store.finish(delivery.id, "done");
    expect(avatarExpression(store.requireTeammate("lin"), store.avatarActivity(), now)).toBe("concerned");
  });
  test("secrets are refused before input storage; errors and progress never retain them", () => {
    const store = make(); setup(store);
    const fake = "sk-ant-" + "obviouslyfaketest".repeat(3);
    expect(() => store.post({ room: "workshop", text: fake })).toThrow(TeamError);
    expect(() => store.remember("ada", fake)).toThrow(TeamError);
    expect(() => store.saveTeammate({ id: "ada", name: "Ada", instructions: fake })).toThrow(TeamError);
    const task = store.createTask({ room: "workshop", assignee: "ada", title: "Check", goal: "Check" });
    store.claim(task.id); store.progress(task.id, fake); store.finish(task.id, "failed", fake, { verified: false, output: fake });
    expect(JSON.stringify(store.snapshot())).not.toContain(fake);
    expect(store.messages("workshop")).toHaveLength(0);
  });
  test("posts and delegated tasks cannot cross membership boundaries", () => {
    const store = make(); setup(store); store.saveTeammate({ id: "outsider", name: "Outside" });
    const message = store.post({ room: "workshop", text: "Work" });
    expect(() => store.post({ room: "workshop", text: "Pretend I am inside" }, { teammate: "outsider", chainId: message.chainId })).toThrow(/not a member/);
    expect(() => store.post({ room: "workshop", text: "Fresh budget" }, { teammate: "ada" })).toThrow(/current conversation/);
    expect(() => store.createTask({ room: "workshop", assignee: "outsider", title: "Work", goal: "Work" })).toThrow(/not a member/);
    expect(() => store.createTask({ room: "workshop", assignee: "ada", title: "Work", goal: "Work" }, { teammate: "outsider", chainId: message.chainId })).toThrow(/not a member/);
  });
  test("direct conversation membership is immutable and owner DMs differ from peer DMs", () => {
    const store = make(); setup(store);
    const owner = store.direct("ada"); const peers = store.direct("ada", "lin");
    expect(store.direct("lin", "ada").id).toBe(peers.id);
    expect(owner.id).not.toBe(peers.id);
    expect(owner.members).toEqual(["ada"]);
    expect(() => store.saveRoom({ id: peers.id, name: "Changed", members: ["ada"] })).toThrow(/cannot be changed/);
  });
  test("only verified successful dependencies unblock, and dependencies must already exist in the room", () => {
    const store = make(); setup(store);
    const parent = store.createTask({ room: "workshop", assignee: "ada", title: "First", goal: "First" });
    const child = store.createTask({ room: "workshop", assignee: "lin", title: "Next", goal: "Next", dependsOn: [parent.id] });
    expect(store.claim(child.id)).toBe(false);
    store.claim(parent.id); store.finish(parent.id, "done", null, { verified: false, output: "Claims done" });
    expect(store.task(parent.id)?.status).toBe("failed"); expect(store.claim(child.id)).toBe(false);
    store.resume({ task: parent.id }); store.claim(parent.id); store.finish(parent.id, "done", null, { verified: true, output: "Tests passed" });
    expect(store.claim(child.id)).toBe(true);
    const other = store.direct("ada");
    expect(() => store.createTask({ room: other.id, assignee: "ada", title: "Bad", goal: "Bad", dependsOn: [parent.id] })).toThrow(/this room/);
  });
  test("turn budgets are reserved before execution and daily allowance does not reset across rooms", () => {
    let now = Date.UTC(2026, 10, 12, 12);
    const store = make(":memory:", () => now); setup(store); store.saveTeammate({ id: "ada", name: "Ada", dailyTurns: 1 });
    const first = store.createTask({ room: "workshop", assignee: "ada", title: "First", goal: "First" });
    const room = store.direct("ada");
    const second = store.createTask({ room: room.id, assignee: "ada", title: "Next", goal: "Next" });
    expect(store.claim(first.id)).toBe(true); expect(store.claim(second.id)).toBe(false);
    store.finish(first.id, "failed", "Failure still costs a turn");
    expect(store.claim(second.id)).toBe(false); expect(store.teammate("ada")?.turnsToday).toBe(1);
    now += 86_400_000;
    expect(store.claim(second.id)).toBe(true);
  });
  test("a full queue refuses a whole owner post without leaving an unserviceable message", () => {
    const store = make(); setup(store);
    for (let n = 0; n < 128; n++) store.post({ room: "workshop", text: `Question ${n}` });
    expect(store.queued()).toHaveLength(256);
    const before = store.messages("workshop");
    expect(() => store.post({ room: "workshop", text: "Too much" })).toThrow(/queue is full/);
    expect(store.messages("workshop")).toEqual(before);
  });
  test("old running and queued work stays visible after more than 512 newer finished jobs", () => {
    const store = make(); setup(store);
    const running = store.createTask({ room: "workshop", assignee: "ada", title: "Long work", goal: "Long work" });
    store.claim(running.id);
    const queued = store.createTask({ room: "workshop", assignee: "ada", title: "Waiting", goal: "Waiting" });
    store.saveRoom({ id: "messages", name: "Messages", members: ["lin"] });
    store.post({ room: "messages", text: "A long conversation" });
    const liveDelivery = store.queued().find((job) => job.room === "messages")!;
    store.claim(liveDelivery.id);
    store.post({ room: "messages", text: "Waiting on that conversation" });
    const queuedDelivery = store.queued().find((job) => job.room === "messages")!;
    for (let n = 0; n < 520; n++) {
      const task = store.createTask({ room: "workshop", assignee: "lin", title: `Finished ${n}`, goal: "Finished" });
      store.finish(task.id, "done", null, { verified: true, output: "Verified" });
      const message = store.post({ room: "messages", text: `Finished conversation ${n}` });
      const delivery = store.queued().find((job) => job.room === "messages" && job.chainId === message.chainId)!;
      store.finish(delivery.id, "done");
    }
    for (const tasks of [store.tasks(), store.tasks("workshop"), store.snapshot().tasks, store.roomView("workshop").tasks]) {
      expect(tasks).toHaveLength(512);
      expect(tasks.slice(0, 2).map((task) => task.id)).toEqual([running.id, queued.id]);
    }
    for (const deliveries of [store.deliveries(), store.deliveries("messages"), store.snapshot().deliveries, store.roomView("messages").deliveries]) {
      expect(deliveries).toHaveLength(512);
      expect(deliveries.slice(0, 2).map((delivery) => delivery.id)).toEqual([liveDelivery.id, queuedDelivery.id]);
    }
  });
});

describe("the workers Galahad makes for himself", () => {
  const DAY = 24 * 3_600_000;
  const job = (id: string) => ({ id, name: id[0]!.toUpperCase() + id.slice(1), instructions: "A lasting job." });

  test("a worker he makes is a new one with the defaults, and says whose words its job is", () => {
    const store = make(); setup(store);
    const scout = store.recruit({ id: "scout", name: "Scout", instructions: "Watch the dependency updates.", role: "reviewer" }, "galahad");
    expect(scout).toMatchObject({ id: "scout", name: "Scout", instructions: "Watch the dependency updates.", role: "reviewer", harness: "native", enabled: true, dailyTurns: 40, turnsToday: 0, repository: null, workspace: null, workspaceNode: null, memory: "", avatar: defaultAvatar("scout"), createdBy: "galahad", instructionsBy: "galahad" });
    // Never an existing worker: yours stay exactly as you left them.
    const ada = store.teammate("ada");
    expect(ada).toMatchObject({ createdBy: "owner", instructionsBy: "owner" });
    expect(() => store.recruit({ id: "ada", name: "Impostor", instructions: "Take her place." }, "galahad")).toThrow(/already exists/);
    expect(store.teammate("ada")).toEqual(ada);
    // Its allowance, its state and its look are not his to choose; nor is a credential ever part of a job.
    for (const extra of [{ dailyTurns: 1000 }, { enabled: false }, { avatar: defaultAvatar("x") }, { createdBy: "owner" }]) expect(() => store.recruit({ ...job("x"), ...extra } as never, "galahad")).toThrow(TeamError);
    expect(() => store.recruit({ ...job("keys"), instructions: `Sign in with ${"sk-ant-" + "obviouslyfaketest".repeat(3)}` }, "galahad")).toThrow(/credential/);
    expect(store.teammates().map((t) => t.id)).toEqual(["ada", "lin", "scout"]);
    // Its job becomes yours when you change its words, never by saving something else about it (the app sends
    // the whole profile with every save); who made it stays on record.
    expect(store.saveTeammate({ id: "scout", name: "Scout the second" })).toMatchObject({ createdBy: "galahad", instructionsBy: "galahad" });
    expect(store.saveTeammate({ id: "scout", name: "Scout", instructions: "Watch the dependency updates.", dailyTurns: 12, avatar: defaultAvatar("other") })).toMatchObject({ createdBy: "galahad", instructionsBy: "galahad", dailyTurns: 12 });
    expect(store.saveTeammate({ id: "scout", name: "Scout", instructions: "Watch them weekly." })).toMatchObject({ createdBy: "galahad", instructionsBy: "owner" });
    expect(store.saveTeammate({ id: "scout", name: "Scout", instructions: "Watch them weekly." })).toMatchObject({ createdBy: "galahad", instructionsBy: "owner" });
  });

  test("provenance survives a reopen, and an older record without it is yours", () => {
    const dir = mkdtempSync(join(tmpdir(), "galahad-team-made-")); dirs.push(dir); const path = join(dir, "team.db");
    const store = make(path); setup(store);
    store.recruit(job("scout"), "ada");
    const { createdBy: _made, instructionsBy: _written, ...legacy } = store.teammate("lin")!; close(store);
    const db = new Database(path);
    db.query("UPDATE team_teammates SET value=? WHERE id='lin'").run(JSON.stringify(legacy)); db.close();
    const reopened = make(path);
    expect(reopened.teammate("scout")).toMatchObject({ createdBy: "ada", instructionsBy: "ada" });
    expect(reopened.teammate("lin")).toMatchObject({ createdBy: "owner", instructionsBy: "owner" });
  });

  test("he may make only a few in a day and never past the node's limit; yours never count against him", () => {
    let now = Date.UTC(2026, 10, 13, 12);
    const store = make(":memory:", () => now);
    for (let n = 0; n < 5; n++) store.saveTeammate({ id: `yours-${n}`, name: `Yours ${n}` });
    for (let n = 0; n < TEAM_LIMITS.recruitsPerDay; n++) store.recruit(job(`his-${n}`), n % 2 ? "galahad" : "yours-0");
    expect(() => store.recruit(job("one-more"), "galahad")).toThrow(/allowance/);
    expect(() => store.recruit(job("one-more"), "yours-1")).toThrow(/allowance/);
    expect(store.teammate("one-more")).toBeNull();
    expect(store.saveTeammate({ id: "yours-5", name: "Yours 5" }).createdBy).toBe("owner");
    now += DAY - 1;
    expect(() => store.recruit(job("one-more"), "galahad")).toThrow(/allowance/);
    now += 2;
    expect(store.recruit(job("one-more"), "galahad").createdBy).toBe("galahad");
    // The node's own limit holds for him as for you.
    for (let n = store.teammates().length; n < TEAM_LIMITS.teammates; n++) store.saveTeammate({ id: `fill-${n}`, name: `Fill ${n}` });
    now += DAY * 2;
    expect(() => store.recruit(job("past-the-limit"), "galahad")).toThrow(new RegExp(`At most ${TEAM_LIMITS.teammates}`));
    expect(store.teammates()).toHaveLength(TEAM_LIMITS.teammates);
  });

  test("a worker made by a worker joins its maker's shared room at once; never a direct conversation; and all of it or none", () => {
    const store = make(); setup(store);
    const made = store.recruit({ ...job("rev"), instructions: "Review Ada's diffs." }, "ada", "workshop");
    expect(made).toMatchObject({ createdBy: "ada", instructionsBy: "ada" });
    expect(store.room("workshop")!.members).toEqual(["ada", "lin", "rev"]);
    const direct = store.direct("lin");
    store.recruit(job("aide"), "lin", direct.id);
    expect(store.room(direct.id)!.members).toEqual(["lin"]);
    expect(() => store.recruit(job("orphan"), "nobody")).toThrow(/No such teammate/);
    expect(() => store.recruit(job("lost"), "ada", "no-such-room")).toThrow(/No such team room/);
    // Nor into a room its maker is not in.
    store.saveRoom({ id: "private", name: "Private", members: ["lin"] });
    expect(() => store.recruit(job("intruder"), "ada", "private")).toThrow(/not a member/);
    expect(store.room("private")!.members).toEqual(["lin"]);
    for (const id of ["orphan", "lost", "intruder"]) expect(store.teammate(id)).toBeNull();
  });

  test("his own words reach a room as his, start their own bounded chain, and have a daily allowance of their own", () => {
    let now = Date.UTC(2026, 10, 13, 12);
    const store = make(":memory:", () => now); setup(store);
    const said = store.post({ room: "workshop", text: "Compare notes on the fixture." }, { galahad: true });
    expect(said).toMatchObject({ speaker: "galahad", speakerName: "Galahad", text: "Compare notes on the fixture." });
    expect(store.queued().map((queued) => queued.teammate).sort()).toEqual(["ada", "lin"]);
    expect(store.queued().every((queued) => queued.chainId === said.chainId)).toBe(true);
    const yours = store.post({ room: "workshop", text: "And tell me what you find." });
    expect(yours).toMatchObject({ speaker: "owner", speakerName: "You" });
    expect(yours.chainId).not.toBe(said.chainId);
    expect(() => store.post({ room: "workshop", text: `The key is ${"sk-ant-" + "obviouslyfaketest".repeat(3)}` }, { galahad: true })).toThrow(/credential/);
    expect(() => store.post({ room: "no-such-room", text: "Anyone?" }, { galahad: true })).toThrow(/No such team room/);
    store.stopQueued({});
    for (let n = 1; n < TEAM_LIMITS.saysPerDay; n++) { store.post({ room: "workshop", text: `Message ${n}.` }, { galahad: true }); store.stopQueued({}); }
    expect(() => store.post({ room: "workshop", text: "One more." }, { galahad: true })).toThrow(/allowance/);
    expect(store.post({ room: "workshop", text: "You always can." }).speaker).toBe("owner");
    now += DAY + 1;
    expect(store.post({ room: "workshop", text: "A new day." }, { galahad: true }).speaker).toBe("galahad");
  });

  test("his words never fill the queue: half of it is always left for yours", () => {
    const store = make();
    const members = Array.from({ length: 16 }, (_, n) => `worker-${n}`);
    for (const id of members) store.saveTeammate({ id, name: id });
    store.saveRoom({ id: "hall", name: "Hall", members });
    // A held room keeps what is said to it: nothing he sends there runs, and it would all stay queued.
    store.pauseRoom("hall", true);
    for (let n = 0; n < TEAM_LIMITS.pending / 2 / members.length; n++) store.post({ room: "hall", text: `Message ${n}.` }, { galahad: true });
    expect(store.queued()).toHaveLength(TEAM_LIMITS.pending / 2);
    expect(() => store.post({ room: "hall", text: "One more." }, { galahad: true })).toThrow(/queue/);
    expect(store.queued()).toHaveLength(TEAM_LIMITS.pending / 2);
    expect(store.post({ room: "hall", text: "Yours still goes." }).speaker).toBe("owner");
  });

  test("a message of his that is refused leaves nothing behind, not even the conversation it would have opened", () => {
    const store = make(); setup(store);
    expect(() => store.say({ teammate: "ada", text: `The key is ${"sk-ant-" + "obviouslyfaketest".repeat(3)}` })).toThrow(/credential/);
    expect(() => store.say({ teammate: "nobody", text: "Anyone?" })).toThrow(/No such teammate/);
    expect(() => store.say({ text: "To nobody." } as never)).toThrow(TeamError);
    expect(store.rooms().map((room) => room.id)).toEqual(["workshop"]);
    const said = store.say({ teammate: "ada", text: "Look into the flaky test." });
    const direct = store.rooms().find((room) => room.direct)!;
    expect(direct.members).toEqual(["ada"]);
    expect(said).toMatchObject({ room: direct.id, speaker: "galahad" });
    expect(store.say({ room: "workshop", text: "Compare notes." })).toMatchObject({ room: "workshop", speaker: "galahad" });
  });

  test("his overview says who each worker is and what it is doing, never its working notes; a room's words only when asked", () => {
    let now = Date.UTC(2026, 10, 13, 12);
    const store = make(":memory:", () => now); setup(store);
    store.saveTeammate({ id: "ada", name: "Ada", instructions: `Implement small changes.\n${"More detail. ".repeat(60)}`, repository: "https://github.com/example/fixture" });
    store.remember("ada", "private working note");
    store.recruit(job("scout"), "galahad");
    store.enable("lin", false);
    store.post({ room: "workshop", text: "The newest question." });
    store.claim(store.queued().find((queued) => queued.teammate === "ada")!.id);
    const task = store.createTask({ room: "workshop", assignee: "ada", title: "Fix the parser", goal: "private goal text" });
    const view = store.overview();
    expect(view.workers.map((w) => [w.id, w.state, w.madeBy])).toEqual([["ada", "working", "owner"], ["lin", "paused", "owner"], ["scout", "ready", "galahad"]]);
    expect(view.workers[0]).toMatchObject({ name: "Ada", role: "engineer", harness: "native", repository: "https://github.com/example/fixture", workspace: false, turnsToday: 1, dailyTurns: 40 });
    expect(view.workers[0]!.job.length).toBeLessThanOrEqual(400);
    expect(view.workers[0]!.job).toContain("Implement small changes.");
    expect(view.rooms).toEqual([{ id: "workshop", name: "Workshop", members: ["ada", "lin"], direct: false, paused: false, turnBudget: 8 }]);
    expect(view.room).toBeUndefined();
    expect(view.spare).toEqual({ workers: TEAM_LIMITS.teammates - 3, today: TEAM_LIMITS.recruitsPerDay - 1 });
    expect(JSON.stringify(view)).not.toContain("private");
    const room = store.overview("workshop").room!;
    expect(room).toMatchObject({ id: "workshop", name: "Workshop", members: ["ada", "lin"] });
    expect(room.messages).toEqual([{ speaker: "owner", speakerName: "You", text: "The newest question.", createdAt: now }]);
    expect(room.tasks).toEqual([{ id: task.id, title: "Fix the parser", assignee: "ada", status: "queued", verified: false }]);
    expect(() => store.overview("no-such-room")).toThrow(/No such team room/);
    // Long conversations come as their latest part, each message clipped.
    for (let n = 0; n < 40; n++) { store.post({ room: "workshop", text: `${n}: ${"long ".repeat(800)}` }); store.stopQueued({}); now += 1; }
    const latest = store.overview("workshop").room!.messages;
    expect(latest).toHaveLength(20);
    expect(latest.at(-1)!.text.startsWith("39: ")).toBe(true);
    expect(latest.every((message) => message.text.length <= 1300)).toBe(true);
  });
});
