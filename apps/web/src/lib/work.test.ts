import { describe, expect, test } from "bun:test";
import type { TeamSnapshot, TeamTask, Teammate } from "@galahad/core/team";
import { projectKey, taskState, workOf } from "./work.ts";

const NOW = 1_764_000_000_000;
const ago = (minutes: number) => NOW - minutes * 60_000;
const knight = (id: string, repository: string | null, extra: Partial<Teammate> = {}): Teammate => ({
  id, name: id[0]!.toUpperCase() + id.slice(1), instructions: "", role: "engineer", harness: "native", enabled: true, dailyTurns: 40, turnsToday: 0,
  repository, workspaceNode: null, workspace: null, memory: "", createdAt: ago(600), updatedAt: ago(600), ...extra,
});
let n = 0;
const task = (assignee: string, status: TeamTask["status"], minutes: number, extra: Partial<TeamTask> = {}): TeamTask => ({
  id: `task-${String(++n).padStart(12, "0")}`, room: "room-x", assignee, title: `Task ${n}`, goal: "Do it.", dependsOn: [], gates: [], status, verified: false,
  progress: "", output: "", error: null, chainId: "c", createdAt: ago(minutes + 5), updatedAt: ago(minutes), ...extra,
});
const snapshot = (teammates: Teammate[], tasks: TeamTask[]): Pick<TeamSnapshot, "teammates" | "tasks"> => ({ teammates, tasks });

// Your word, 25 November 2026: the knights "more like per task/per project like t3code": the work is told by project,
// each task a thread of its own, the knight on it beside it.
describe("the work, by project", () => {
  test("a project is a repository: its address however it was written, its name its own last part or a project's of yours", () => {
    expect(projectKey("https://github.com/amiriteorg/galahad")).toBe("github.com/amiriteorg/galahad");
    expect(projectKey("https://GitHub.com/amiriteorg/galahad.git/")).toBe("github.com/amiriteorg/galahad");
    expect(projectKey("https://sovware.io/amiriteorg/galahad")).toBe("sovware.io/amiriteorg/galahad");
    expect(projectKey("not a url")).toBeNull();
    const work = workOf({ snapshot: snapshot([knight("gareth", "https://github.com/amiriteorg/galahad"), knight("kay", "https://github.com/amiriteorg/importer")], [task("gareth", "done", 30)]), projects: [{ id: "imp", name: "The importer", instructions: "", repo: "https://github.com/amiriteorg/importer.git", checkout: "/work/projects/imp", updatedAt: 1 }], now: NOW });
    expect(work.projects.map((p) => [p.name, p.repo, p.host, p.knights])).toEqual([
      ["galahad", "https://github.com/amiriteorg/galahad", "github.com", ["gareth"]],
      ["The importer", "https://github.com/amiriteorg/importer", "github.com", ["kay"]],
    ]);
  });

  test("each task is in its knight's project, the newest first; a knight with no repository's are other work", () => {
    const tasks = [task("gareth", "done", 90, { verified: true }), task("percival", "failed", 20), task("gareth", "running", 5, { progress: "Gate 1/2 · bun test" }), task("gareth", "stopped", 300)];
    const work = workOf({ snapshot: snapshot([knight("gareth", "https://github.com/amiriteorg/galahad"), knight("percival", null)], tasks), projects: [], now: NOW });
    expect(work.projects).toHaveLength(1);
    expect(work.projects[0]!.tasks.map((t) => t.id)).toEqual([tasks[2]!.id, tasks[0]!.id, tasks[3]!.id]);
    expect(work.other!.tasks.map((t) => t.id)).toEqual([tasks[1]!.id]);
    expect(work.other!.name).toBe("Other work");
    // A task's knight goes with it: its name, and its avatar for its orb.
    expect(work.projects[0]!.tasks[0]!.knight).toEqual({ id: "gareth", name: "Gareth", avatar: undefined });
  });

  test("what is under way, across every project: at work, waiting on you, queued; what needs you first", () => {
    const tasks = [task("gareth", "running", 5), task("kay", "proposed", 2, { proposedBy: "kay" }), task("gareth", "queued", 1), task("kay", "done", 0, { verified: true })];
    const work = workOf({ snapshot: snapshot([knight("gareth", "https://github.com/a/b"), knight("kay", "https://github.com/a/c")], tasks), projects: [], now: NOW });
    expect(work.underWay.map((t) => [t.id, t.state])).toEqual([[tasks[1]!.id, "needs"], [tasks[0]!.id, "working"], [tasks[2]!.id, "queued"]]);
    // A project with work in hand or waiting on you comes before one at rest.
    expect(work.projects.map((p) => [p.name, p.running, p.needs])).toEqual([["c", 0, 1], ["b", 1, 0]]);
  });

  test("a task's state is its ring's, and its line says who, what and how it went, in a word", () => {
    expect(taskState(task("a", "running", 0))).toBe("working");
    expect(taskState(task("a", "proposed", 0))).toBe("needs");
    expect(taskState(task("a", "interrupted", 0))).toBe("needs");
    expect(taskState(task("a", "queued", 0))).toBe("queued");
    expect(taskState(task("a", "failed", 0))).toBe("failed");
    expect(taskState(task("a", "done", 0, { verified: true }))).toBe("verified");
    expect(taskState(task("a", "done", 0))).toBe("resting");
    expect(taskState(task("a", "stopped", 0))).toBe("paused");
    const lines = workOf({
      snapshot: snapshot([knight("gareth", "https://github.com/a/b")], [
        task("gareth", "running", 12, { progress: "Gate 1/2 · bun test\nmore" }),
        task("gareth", "done", 30, { verified: true }),
        task("gareth", "failed", 44, { error: "gave-up" }),
      ]),
      projects: [],
      now: NOW,
    }).projects[0]!.tasks.map((t) => t.line);
    expect(lines).toEqual(["Gareth · Gate 1/2 · bun test", "Gareth · verified · 30 min ago", "Gareth · failed: gave up · 44 min ago"]);
  });

  test("a removed knight's tasks keep their place, under its name; nothing at all is no project", () => {
    const work = workOf({ snapshot: snapshot([], [task("old", "done", 10)]), projects: [], now: NOW });
    expect(work.projects).toEqual([]);
    expect(work.other!.tasks[0]!.knight).toEqual({ id: "old", name: "old", avatar: undefined });
    expect(workOf({ snapshot: snapshot([], []), projects: [], now: NOW })).toEqual({ underWay: [], projects: [], other: null });
  });
});
