import type { ProjectView } from "@galahad/core";
import type { Ctx } from "../context.ts";
import { isWaiting } from "../live.ts";
import { hashOf } from "../lib/nav.ts";
import { type Attended, attended, type WorkRow } from "../lib/work.ts";
export { namesProjects } from "../lib/work.ts";
import { cx, h } from "../ui/dom.ts";
import { icon } from "../ui/icons.ts";
import { knightFace } from "../ui/orb.ts";
import { signal, type Signal } from "../ui/signal.ts";

/*
 * The work's rows, as every list of them draws them (a wide screen's sidebar, a phone's Home): a task in three lines, as
 * T3 Code's sidebar has it (your word, 26 November 2026: "project/tasks/coding t3code style for the knights"): its
 * project's badge and name with how it stands in a word in its state's colour; its title; its knight's orb, still, with
 * its name and what it is doing or what it came to. A row opens the task's own thread (#/task/<id>). What the rows say is
 * lib/work.ts's; this only draws them, and keeps what they are drawn from: the team, the approvals waiting, your projects'
 * names. Nothing is asked for per row.
 */

/** Your projects (GET /api/projects), for the names a project's rows go by: asked once a session, where this device may read. */
export const projectNames: Signal<ProjectView[]> = signal<ProjectView[]>([]);
let askedProjects = false;
export function askProjects(ctx: Ctx): void {
  if (askedProjects || !ctx.can("mind:read")) return;
  askedProjects = true;
  ctx.api.get<{ projects: ProjectView[] }>("/api/projects").then(
    (answer) => projectNames.set(answer.projects),
    () => void (askedProjects = false),
  );
}

/** What every list of the work is drawn from: watched, it is drawn again whenever one of these changes. */
export const workSources = (ctx: Ctx): Signal<unknown>[] => [ctx.live.team, ctx.live.actions, projectNames] as Signal<unknown>[];

/** The work by attention as the app has it now (null: the team isn't known yet). */
export function workNow(ctx: Ctx): Attended | null {
  const snapshot = ctx.live.team.value;
  if (!snapshot) return null;
  const now = Date.now();
  const asks = ctx.live.actions.value.filter((action) => isWaiting(action, now)).map((action) => ({ by: action.by, connector: action.connector, tool: action.tool }));
  return attended({ snapshot, projects: projectNames.value, asks, now });
}

/** A row's words, for a screen reader and a tooltip: what it is, where (where there is more than one project), how it
 * stands and who is on it. */
export const rowLabel = (row: WorkRow, project = true): string => [row.title, project ? row.project.name : null, row.word, `${row.knight.name}${row.detail ? `: ${row.detail}` : ""}`, row.age ? `${row.age} ago` : null].filter(Boolean).join(", ");


/** A project's badge: its letter on a small tile (other work's is an empty, dashed one). */
export const projectTile = (project: WorkRow["project"]): HTMLElement => h("span", { class: cx("work-badge", !project.badge && "is-none"), "aria-hidden": "true" }, project.badge);

/**
 * A task as a row of three lines. `face`: its knight's orb's size (14 to 18; still: only the orb in focus moves).
 * `current`: it is the task open now. `project`: its project named on its first line (namesProjects); left out, it is.
 */
export function workRow(row: WorkRow, opts: { face?: number; current?: boolean; project?: boolean } = {}): HTMLAnchorElement {
  const verified = row.state === "verified";
  const project = opts.project ?? true;
  return h(
    "a",
    {
      class: "work-row",
      href: hashOf("task", { task: row.id }),
      draggable: "false",
      "data-key": `task:${row.id}`,
      "data-attention": row.attention,
      "data-state": row.state,
      "aria-current": opts.current ? "page" : null,
      "aria-label": rowLabel(row, project),
      title: rowLabel(row, project),
    },
    h(
      "span",
      { class: cx("work-l1", !project && "is-unnamed") },
      project ? projectTile(row.project) : null,
      project ? h("span", { class: "work-project ellipsis" }, row.project.name) : null,
      h("span", { class: "work-word", "data-tone": row.tone }, verified ? icon("check", { size: 12 }) : null, row.word),
      row.age ? h("span", { class: "work-age tnum" }, row.age) : null,
    ),
    h("span", { class: "work-l2 ellipsis" }, row.title),
    h(
      "span",
      { class: "work-l3" },
      knightFace({ id: row.knight.id, profile: row.knight.avatar, size: opts.face ?? 16 }),
      h("span", { class: "work-knight" }, row.knight.name),
      row.detail ? h("span", { class: cx("work-detail ellipsis", row.mono && "mono") }, row.detail) : null,
    ),
  );
}

/** The rows of a list of the work by keyboard (as T3 Code's sidebar is): ArrowDown and ArrowUp go to the next and the
 * last row (a fold's line among them), Home and End to the first and the last; Enter opens one, as a link does. Tab
 * still leaves the list. */
export function rowKeys(list: HTMLElement): void {
  list.addEventListener("keydown", (event: KeyboardEvent) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || event.altKey || event.metaKey || event.ctrlKey) return;
    const rows = [...list.querySelectorAll<HTMLElement>(".work-row, .side-fold, .side-inbox, .home-fold, .fold-failed")].filter((row) => row.getClientRects().length > 0);
    const at = rows.indexOf(event.target as HTMLElement);
    if (at < 0) return;
    const next = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, at + (event.key === "ArrowDown" ? 1 : -1)));
    event.preventDefault();
    rows[next]?.focus();
  });
}

/** Beside a folded Done, how many of it failed, in red and in words ("Done 4 · 1 failed"; lib/work.ts failedIn), and a
 * tap away: it opens the latest that failed, so why one failed is one tap from the list even once it is settled. None
 * failed: nothing. */
export function failedNote(rows: readonly WorkRow[]): HTMLElement | null {
  const failed = rows.filter((row) => row.state === "failed");
  if (!failed.length) return null;
  const latest = failed.reduce((a, b) => (b.at > a.at ? b : a));
  return h("a", { class: "fold-failed tnum", "data-tone": "failed", href: hashOf("task", { task: latest.id }), title: `Why “${latest.title}” failed` }, `${failed.length} failed`);
}

/** A fold's line: its button (its name, its count, its chevron) and, beside it, what failed in it (failedNote). */
export const foldLine = (fold: HTMLElement, failed: HTMLElement | null): HTMLElement => (failed ? h("div", { class: "fold-line" }, fold, failed) : fold);

/** What a list of rows is drawn as, to be compared before drawing it again (a row that says the same is not redrawn). */
export const rowsVersion = (rows: readonly WorkRow[]): string =>
  JSON.stringify(rows.map((row) => [row.id, row.title, row.word, row.tone, row.age, row.detail, row.state, row.project.name, row.knight.name, row.knight.avatar]));
