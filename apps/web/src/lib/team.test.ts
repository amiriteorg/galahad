import { describe, expect, test } from "bun:test";
import type { TeamTask, Teammate } from "@galahad/core/team";
import { taskDependencies, teamHash, teamLocation, teamSpeaker, teammateId, teammateMaker, teammateState } from "./team.ts";

const person: Teammate = { id: "ada", name: "Ada", instructions: "", role: "engineer", harness: "native", enabled: true, dailyTurns: 4, turnsToday: 1, memory: "", repository: null, workspaceNode: null, workspace: null, createdAt: 1, updatedAt: 1 };
const task: TeamTask = { id: "task-abcdefghijkl", room: "work", assignee: "ada", title: "Check inputs", goal: "Check", dependsOn: [], gates: [], status: "done", verified: true, progress: "", output: "", error: null, chainId: "chain", createdAt: 1, updatedAt: 1 };

describe("team navigation and identity", () => {
  test("a room and work tab survive reload and history navigation", () => {
    expect(teamLocation(teamHash({ room: "room-a_1", teamTab: "work" }))).toEqual({ room: "room-a_1", teamTab: "work" });
    expect(teamLocation("#/team?room=room-a_1&tab=chat")).toEqual({ room: "room-a_1" });
    expect(teamLocation("#/chat?room=room-a_1")).toEqual({});
    expect(teamLocation("#/team?room=../secret&tab=unknown")).toEqual({});
  });
  test("new teammate IDs cannot impersonate owner/system or collide", () => {
    expect(teammateId("Owner", [])).toBe("owner-2");
    expect(teammateId("Galahad", [])).toBe("galahad-2");
    expect(teammateId("System", ["system-2"])).toBe("system-3");
    expect(teammateId("Áda", ["ada", "ada-2"])).toBe("ada-3");
    expect(teammateId("123", [])).toBe("teammate-123");
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
