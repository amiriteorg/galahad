import type { ProjectView } from "@galahad/core";
import type { TeamRoom } from "@galahad/core/team";
import { isAbort } from "../api.ts";
import type { View } from "../context.ts";
import { teamHash } from "../lib/team.ts";
import { workOf, type WorkProject, type WorkTask } from "../lib/work.ts";
import { seat } from "../ui/avatar.ts";
import { button, empty, list, listRow, pageBody, pageHead, section, skeletonRows } from "../ui/controls.ts";
import { h, replace } from "../ui/dom.ts";
import { giveTask, giveToRoundtable } from "./team-forms.ts";

/*
 * The work, by project (your word, 25 November 2026: "way more task/coding focused … the other knights should be more
 * like per task/per project like t3code"): what is under way across every project, what needs you first; then each
 * project (a repository its knights work in) with its tasks, the newest first, each a thread of its own that opens in
 * its knight's conversation at that task; then other work; and the knights themselves a tap away, at the Roundtable.
 * It asks the node only for your projects (their names); the rest is the team the app already has (lib/work.ts).
 */

/** How many of a project's tasks show before "Show all". */
const SHOWN = 6;

export const workView: View = (root, ctx, { scope }) => {
  let projects: ProjectView[] = [];
  const open = new Set<string>();
  const canGive = ctx.can("fleet:admin") && ctx.can("chat");

  /** A task's row: its knight in a seat of the task's state, its title, and its line; it opens the task where it is. */
  const taskRow = (task: WorkTask): HTMLElement =>
    listRow({
      lead: seat({ id: task.knight.id, name: task.knight.name, profile: task.knight.avatar, state: task.state, size: 28 }),
      title: task.title,
      sub: task.line,
      href: teamHash({ room: task.room, task: task.id }),
      chevron: true,
      key: `work-task:${task.id}`,
    });

  /** Gives a task in a project: to its one knight, in its own conversation; else to the Roundtable, whose best-suited
   * knight takes it. */
  const giveIn = (project: WorkProject): void => {
    const snapshot = ctx.live.team.value;
    const only = project.knights.length === 1 ? project.knights[0] : null;
    const room = only ? snapshot?.rooms.find((candidate: TeamRoom) => candidate.direct && candidate.members.length === 1 && candidate.members[0] === only) : undefined;
    if (room) giveTask(ctx, room);
    else giveToRoundtable(ctx);
  };

  const projectSection = (project: WorkProject): HTMLElement => {
    const all = open.has(project.key);
    const shown = all ? project.tasks : project.tasks.slice(0, SHOWN);
    const knights = project.knights.map((id) => ctx.live.team.value?.teammates.find((knight) => knight.id === id)?.name ?? id);
    const note = [project.host, knights.length ? knights.join(", ") : null].filter(Boolean).join(" · ");
    return section(
      project.name,
      {
        id: `project-${project.key}`,
        count: `${project.tasks.length} ${project.tasks.length === 1 ? "task" : "tasks"}`,
        note: note || undefined,
        actions: canGive ? button("New task", { size: "sm", variant: "ghost", icon: "plus", onClick: () => giveIn(project) }) : undefined,
      },
      shown.length ? list(shown.map(taskRow)) : h("p", { class: "small muted" }, "No task here yet."),
      project.tasks.length > SHOWN
        ? button(all ? "Show fewer" : `Show all ${project.tasks.length}`, { size: "sm", variant: "ghost", onClick: () => (all ? open.delete(project.key) : open.add(project.key), render()) })
        : null,
    );
  };

  const body = h("div", { class: "stack" });
  function render(): void {
    const snapshot = ctx.live.team.value;
    if (!snapshot) return void replace(body, skeletonRows(4, { avatar: true }));
    const work = workOf({ snapshot, projects, now: Date.now() });
    const parts: (HTMLElement | null)[] = [];
    if (work.underWay.length) parts.push(section("Under way", { count: String(work.underWay.length) }, list(work.underWay.map(taskRow))));
    for (const project of work.projects) parts.push(projectSection(project));
    if (work.other) parts.push(projectSection(work.other));
    if (!parts.length) {
      parts.push(
        empty({
          icon: "layers",
          title: "No work yet",
          body: "Give a task to a knight, or ask Galahad to: each task is a thread here, under the project it's in.",
          actions: canGive ? button("Give a task", { icon: "layers", onClick: () => giveToRoundtable(ctx) }) : undefined,
        }),
      );
    }
    parts.push(section("Knights", { note: "Who works on what: their order, their rooms, their VMs" }, list([listRow({ lead: "roundtable", title: "The Roundtable", sub: `${snapshot.teammates.length} ${snapshot.teammates.length === 1 ? "knight" : "knights"}`, href: "#/team", chevron: true })])));
    replace(body, ...parts);
  }

  replace(root, pageBody(pageHead("Work", "What is under way, and every project's tasks: each a thread of its own.", canGive ? button("Give a task", { icon: "layers", onClick: () => giveToRoundtable(ctx) }) : undefined), body));
  render();
  scope.add(ctx.live.team.watch(() => render()));
  if (ctx.can("mind:read")) {
    ctx.api.get<{ projects: ProjectView[] }>("/api/projects", scope.signal).then(
      (answer) => {
        if (scope.disposed) return;
        projects = answer.projects;
        render();
      },
      (error) => void (isAbort(error) || null),
    );
  }
};
