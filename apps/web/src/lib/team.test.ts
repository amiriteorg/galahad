import { describe, expect, test } from "bun:test";
import type { TeamTask, Teammate } from "@galahad/core/team";
import { TeamHarness } from "@galahad/core/team";
import { engramLine, HANDLE_PATTERN, HARNESS, harnessNote, landingHash, removalPlan, takenHandles, taskDependencies, teamHash, teamLocation, teamSpeaker, teammateId, teammateMaker, teammateState } from "./team.ts";

const person: Teammate = { id: "ada", name: "Ada", instructions: "", role: "engineer", harness: "native", enabled: true, dailyTurns: 4, turnsToday: 1, memory: "", repository: null, workspaceNode: null, workspace: null, createdAt: 1, updatedAt: 1 };
const task: TeamTask = { id: "task-abcdefghijkl", room: "work", assignee: "ada", title: "Check inputs", goal: "Check", dependsOn: [], gates: [], status: "done", verified: true, progress: "", output: "", error: null, chainId: "chain", createdAt: 1, updatedAt: 1 };

describe("team navigation and identity", () => {
  test("a room and work tab survive reload and history navigation", () => {
    expect(teamLocation(teamHash({ room: "room-a_1", teamTab: "work" }))).toEqual({ room: "room-a_1", teamTab: "work" });
    expect(teamLocation("#/team?room=room-a_1&tab=chat")).toEqual({ room: "room-a_1" });
    expect(teamLocation("#/chat?room=room-a_1")).toEqual({});
    expect(teamLocation("#/team?room=../secret&tab=unknown")).toEqual({});
  });
  test("the address the app opens on is its page's own, and Team's keeps its room and tab: a reload comes back to the same conversation", () => {
    expect(landingHash("team", "#/team?room=room-dhvmdz1bdolx")).toBe("#/team?room=room-dhvmdz1bdolx");
    expect(landingHash("team", "#/team?room=room-a_1&tab=work")).toBe("#/team?room=room-a_1&tab=work");
    expect(landingHash("team", "#/team?room=room-a_1&tab=chat&x=1")).toBe("#/team?room=room-a_1");
    expect(landingHash("team", "#/team?room=../secret")).toBe("#/team");
    expect(landingHash("team", "")).toBe("#/team");
    // Every other page is tidied to itself, as it was.
    expect(landingHash("chat", "#/chat?c=cv_abc")).toBe("#/chat");
    expect(landingHash("overview", "#/team?room=room-a_1")).toBe("#/overview");
  });
  test("the handle field's pattern is one a browser can compile, and it takes handles and nothing else", () => {
    // (A browser compiles a field's pattern with the v flag, under which a bare hyphen in a class is an error:
    // the field is then never checked at all, and says so only in the console.)
    const field = new RegExp(`^(?:${HANDLE_PATTERN})$`, "v");
    for (const handle of ["ada", "a", "ada-2", "a-b-c", "x".repeat(32)]) expect([handle, field.test(handle)]).toEqual([handle, true]);
    for (const handle of ["Not A Handle!", "-ada", "2ada", "Ada", "ada_2", "", "x".repeat(33)]) expect([handle, field.test(handle)]).toEqual([handle, false]);
  });
  test("new teammate IDs cannot impersonate owner/system or collide", () => {
    expect(teammateId("Owner", [])).toBe("owner-2");
    expect(teammateId("Galahad", [])).toBe("galahad-2");
    expect(teammateId("System", ["system-2"])).toBe("system-3");
    expect(teammateId("Áda", ["ada", "ada-2"])).toBe("ada-3");
    expect(teammateId("123", [])).toBe("squire-123");
    expect(teammateId("研究", [])).toMatch(/^[a-z][a-z0-9-]{0,31}$/);
  });
  test("a historical speaker keeps their saved name after a rename", () => {
    expect(teamSpeaker({ speaker: "ada", speakerName: "Ada" }, [{ ...person, name: "Analyst" }])).toBe("Ada");
    expect(teamSpeaker({ speaker: "owner", speakerName: "Someone" }, [])).toBe("You");
    expect(teamSpeaker({ speaker: "former", speakerName: "Former teammate" }, [])).toBe("Former teammate");
  });
  test("Galahad's own words in a room are said to be his, and who made a worker is said only when it wasn't you", () => {
    expect(teamSpeaker({ speaker: "galahad", speakerName: "Galahad" }, [])).toBe("Galahad");
    expect(teamSpeaker({ speaker: "galahad", speakerName: "" }, [{ ...person, id: "galahad-2", name: "Not him" }])).toBe("Galahad");
    expect(teammateMaker(person, [])).toBeNull();
    expect(teammateMaker({ ...person, createdBy: "owner" }, [])).toBeNull();
    expect(teammateMaker({ ...person, createdBy: "galahad" }, [])).toBe("Galahad");
    expect(teammateMaker({ ...person, createdBy: "lin" }, [{ ...person, id: "lin", name: "Lin" }])).toBe("Lin");
    expect(teammateMaker({ ...person, createdBy: "gone" }, [])).toBe("gone");
  });
});

describe("removing a worker, as the page says it", () => {
  test("a handle that belonged to a worker you removed is taken, like one in use", () => {
    const snapshot = { teammates: [person], removed: [{ id: "lin", name: "Lin", removedAt: 5 }] };
    expect(takenHandles(snapshot)).toEqual(["ada", "lin"]);
    expect(takenHandles({ teammates: [person] })).toEqual(["ada"]);
    expect(takenHandles(null)).toEqual([]);
    expect(teammateId("Lin", takenHandles(snapshot))).toBe("lin-2");
    // Who made a worker is still named once its maker is gone.
    expect(teammateMaker({ ...person, createdBy: "lin" }, [], snapshot.removed)).toBe("Lin");
  });
  test("the question says what goes and what stays; a VM goes with it, and only from a device that may destroy one", () => {
    const plain = removalPlan(person, { sandbox: false });
    expect(plain).toMatchObject({ blocked: null, destroyWorkspace: false });
    expect(plain.lines.join(" ")).toContain("The handle ada is never used again");
    expect(plain.lines.join(" ")).not.toContain("VM");
    const bound = { ...person, workspace: { node: "host", id: "0123456789" } };
    const withVm = removalPlan(bound, { sandbox: true });
    expect(withVm).toMatchObject({ blocked: null, destroyWorkspace: true });
    expect(withVm.lines.join(" ")).toContain("Ada's VM is destroyed with it, and everything in its /work");
    // One a VM was being made for when the node stopped may have one that was never bound: asked the same way.
    const planned = removalPlan({ ...person, workspaceNode: "host" }, { sandbox: true });
    expect(planned).toMatchObject({ blocked: null, destroyWorkspace: true });
    expect(planned.lines.join(" ")).toContain("A VM was being made for Ada");
    expect(removalPlan({ ...person, workspaceNode: "host" }, { sandbox: false }).blocked).toContain("may manage sandboxes");
    const refused = removalPlan(bound, { sandbox: false });
    expect(refused.blocked).toContain("may manage sandboxes");
    expect(refused.destroyWorkspace).toBe(true);
  });
});

describe("team work is reported from server facts", () => {
  test("an active task stays visible even while the teammate is paused", () => {
    expect(teammateState({ ...person, enabled: false }, { tasks: [{ ...task, status: "running" }], deliveries: [] }).text).toBe("Working");
    expect(teammateState({ ...person, enabled: false }, { tasks: [], deliveries: [] }).text).toBe("Paused");
    expect(teammateState({ ...person, turnsToday: 4 }, { tasks: [], deliveries: [] }).text).toBe("Daily limit reached");
  });
  test("missing, failed and unverified predecessors never look satisfied", () => {
    const dependsOn = [task.id];
    expect(taskDependencies({ dependsOn }, [task])[0]?.satisfied).toBe(true);
    expect(taskDependencies({ dependsOn }, [{ ...task, verified: false }])[0]?.satisfied).toBe(false);
    expect(taskDependencies({ dependsOn }, [{ ...task, status: "failed" }])[0]?.satisfied).toBe(false);
    expect(taskDependencies({ dependsOn }, [])[0]?.satisfied).toBe(false);
  });
});

describe("a squire's coding harness", () => {
  test("every harness the node takes has a name here, the vendors' own tools by their own names", () => {
    expect(Object.keys(HARNESS).sort()).toEqual([...TeamHarness.options].sort());
    expect(HARNESS).toMatchObject({ native: "Galahad", claude: "Claude Code", codex: "Codex" });
  });
  test("readiness says what a harness would run on, or what to do so that it can", () => {
    expect(harnessNote({ id: "claude", ready: true, on: "its own sign-in in this VM (claude.ai), then anthropic/claude-opus-5-5 through the gateway" })).toBe("Runs on its own sign-in in this VM (claude.ai), then anthropic/claude-opus-5-5 through the gateway");
    expect(harnessNote({ id: "codex", ready: false, reason: "Sign Codex in in this squire's VM (codex login --device-auth), or put an OpenAI-compatible model that speaks the Responses API on the engineer's roster" })).toBe("Sign Codex in in this squire's VM (codex login --device-auth), or put an OpenAI-compatible model that speaks the Responses API on the engineer's roster");
    // His own harness has nothing to say, and a node that says nothing of what one runs on (an older one) is shown as before.
    expect(harnessNote({ id: "native", ready: true })).toBeNull();
    expect(harnessNote({ id: "opencode", ready: true })).toBeNull();
  });
});

describe("the notes store in a squire's Workspace", () => {
  const absent = "this VM's image has no Engram 3.7.2 (a VM keeps the image it was made from)";
  test("its line says the switch and whether this VM has the pinned Engram, and never calls a store ready that isn't there", () => {
    expect(engramLine({ on: true, pinned: "3.7.2", present: true })).toEqual({ badge: "On", tone: "ok", text: "Engram 3.7.2 is in this VM, and this squire's tasks are given it. Notes are a task's own leads, kept in this VM and checked before they are trusted." });
    expect(engramLine({ on: true, pinned: "3.7.2", present: false, reason: absent })).toEqual({ badge: "Not in this VM", tone: "warn", text: `On, but ${absent}. This squire's tasks run without it and say so.` });
    expect(engramLine({ on: true, pinned: "3.7.2", present: false, reason: "this VM has Engram 3.7.1, not the pinned 3.7.2" })?.badge).toBe("Not in this VM");
    expect(engramLine({ on: true, pinned: "3.7.2" })).toEqual({ badge: "On", tone: "neutral", text: "On. Whether this VM has Engram 3.7.2 is asked when the squire is idle and its VM is running." });
    expect(engramLine({ on: false, pinned: "3.7.2", present: true })).toEqual({ badge: "Off", tone: "neutral", text: "Off: tasks are given no notes store. Engram 3.7.2 is in this VM, should you turn it on." });
    expect(engramLine({ on: false, pinned: "3.7.2", present: false, reason: absent })).toEqual({ badge: "Off", tone: "neutral", text: `Off: tasks are given no notes store. Turned on, it would not reach this squire: ${absent}.` });
    expect(engramLine({ on: false, pinned: "3.7.2" })).toEqual({ badge: "Off", tone: "neutral", text: "Off: tasks are given no notes store." });
    // A node from before the switch says nothing of it: there is no line to show.
    expect(engramLine(undefined)).toBeNull();
  });
});
