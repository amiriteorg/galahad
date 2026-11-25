import type { ProjectView } from "@galahad/core";
import type { TeamSnapshot, TeamTask } from "@galahad/core/team";
import type { KnightState } from "./knight-state.ts";
import { relativeTime } from "./time.ts";

/*
 * The work, told by project (your word, 25 November 2026: "way more task/coding focused … the other knights should be
 * more like per task/per project like t3code"): every task a thread of its own, under the project it is in, with the
 * knight on it beside it; and what is under way across all of them, what needs you first. Pure (no DOM), from what the
 * app already has: the team as one snapshot, and your projects.
 *
 * A project is a repository: the one a knight works in (its `repository`), named by a project of yours with that
 * repository where there is one, else by the repository's own last part. A task is in its knight's project; a knight
 * with no repository works on other work.
 */

export interface WorkTask {
  id: string;
  /** The conversation it was given in: where it opens. */
  room: string;
  title: string;
  knight: { id: string; name: string; avatar: unknown };
  /** Its ring's state (lib/knight-state.ts). */
  state: KnightState;
  /** Who, and how it stands, in a line: "Gareth · Gate 1/2 · bun test", "Gareth · verified · 30 min ago". */
  line: string;
  at: number;
}

export interface WorkProject {
  /** Its repository's address without its scheme (github.com/owner/repo), or "other". */
  key: string;
  name: string;
  repo: string | null;
  host: string | null;
  /** The knights that work in it, by handle. */
  knights: string[];
  tasks: WorkTask[];
  running: number;
  needs: number;
}

export interface Work {
  underWay: WorkTask[];
  projects: WorkProject[];
  other: WorkProject | null;
}

/** A repository's address as one key, however it was written (case of its host, `.git`, a trailing slash); null for
 * anything that isn't an https address. */
export function projectKey(repo: string): string | null {
  try {
    const url = new URL(repo.trim());
    if (url.protocol !== "https:") return null;
    const path = url.pathname.replace(/\/+$/, "").replace(/\.git$/, "");
    return path.length > 1 ? `${url.host.toLowerCase()}${path}` : null;
  } catch {
    return null;
  }
}

/** A task's state, as its ring shows it: at work; waiting on you (proposed, or cut short and yours to look at); queued;
 * failed; verified; stopped (paused); done without verification, at rest. */
export function taskState(task: Pick<TeamTask, "status" | "verified">): KnightState {
  switch (task.status) {
    case "running": return "working";
    case "proposed": case "interrupted": return "needs";
    case "queued": return "queued";
    case "failed": return "failed";
    case "stopped": return "paused";
    case "done": return task.verified ? "verified" : "resting";
  }
}

const ENDED: Readonly<Record<string, string>> = { "gave-up": "gave up", unverified: "not verified", stopped: "stopped" };
const firstLine = (text: string | null | undefined): string => (text ?? "").trim().split("\n")[0]?.trim() ?? "";

function line(task: TeamTask, who: string, now: number): string {
  const when = relativeTime(task.updatedAt, now);
  switch (task.status) {
    case "running": return `${who} · ${firstLine(task.progress) || "at work"}`;
    case "proposed": return `${task.proposedBy && task.proposedBy !== task.assignee ? "proposed for" : ""} ${who} · waits for your approval`.trim();
    case "queued": return `${who} · queued`;
    case "interrupted": return `${who} · interrupted: look before it resumes`;
    case "failed": {
      const why = firstLine(task.error);
      return `${who} · failed${why ? `: ${ENDED[why] ?? why}` : ""} · ${when}`;
    }
    case "stopped": return `${who} · stopped · ${when}`;
    case "done": return `${who} · ${task.verified ? "verified" : "done, not verified"} · ${when}`;
  }
}

const UNDER_WAY: Partial<Record<KnightState, number>> = { needs: 0, working: 1, queued: 2 };

export function workOf(input: { snapshot: Pick<TeamSnapshot, "teammates" | "tasks">; projects: readonly ProjectView[]; now: number }): Work {
  const { snapshot, now } = input;
  const knights = new Map(snapshot.teammates.map((knight) => [knight.id, knight]));
  const named = new Map(input.projects.flatMap((project) => (project.repo && projectKey(project.repo) ? [[projectKey(project.repo)!, project] as const] : [])));
  const groups = new Map<string, WorkProject>();
  const group = (key: string, make: () => WorkProject): WorkProject => {
    let found = groups.get(key);
    if (!found) groups.set(key, (found = make()));
    return found;
  };
  // Each knight's project, by its repository (so a project with knights but no task yet is still there).
  const projectOf = (repository: string | null | undefined): WorkProject => {
    const key = repository ? projectKey(repository) : null;
    if (!key) return group("other", () => ({ key: "other", name: "Other work", repo: null, host: null, knights: [], tasks: [], running: 0, needs: 0 }));
    const yours = named.get(key);
    return group(key, () => ({ key, name: yours?.name ?? key.split("/").at(-1)!, repo: `https://${key}`, host: key.split("/")[0]!, knights: [], tasks: [], running: 0, needs: 0 }));
  };
  for (const knight of snapshot.teammates) {
    const project = projectOf(knight.repository);
    if (project.key !== "other") project.knights.push(knight.id);
  }
  const tasks = [...snapshot.tasks].sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : 1));
  const underWay: WorkTask[] = [];
  for (const task of tasks) {
    const knight = knights.get(task.assignee);
    const project = projectOf(knight?.repository);
    const state = taskState(task);
    const shown: WorkTask = { id: task.id, room: task.room, title: task.title, knight: { id: task.assignee, name: knight?.name ?? task.assignee, avatar: knight?.avatar }, state, line: line(task, knight?.name ?? task.assignee, now), at: task.updatedAt };
    project.tasks.push(shown);
    if (state === "working") project.running++;
    if (state === "needs") project.needs++;
    if (UNDER_WAY[state] !== undefined) underWay.push(shown);
  }
  underWay.sort((a, b) => UNDER_WAY[a.state]! - UNDER_WAY[b.state]! || b.at - a.at);
  const busy = (p: WorkProject) => (p.needs ? 2 : 0) + (p.running ? 1 : 0);
  const latest = (p: WorkProject) => p.tasks[0]?.at ?? 0;
  const projects = [...groups.values()].filter((p) => p.key !== "other").sort((a, b) => busy(b) - busy(a) || latest(b) - latest(a) || a.name.localeCompare(b.name));
  const other = groups.get("other");
  return { underWay, projects, other: other && other.tasks.length ? other : null };
}
