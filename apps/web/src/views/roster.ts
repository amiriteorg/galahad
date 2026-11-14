import { isUnavailable } from "../api.ts";
import type { Ctx, Route } from "../context.ts";
import { isWaiting } from "../live.ts";
import { galahadNow } from "../lib/now.ts";
import { galahadNeeds, rosterRows, type RosterRow, type Said } from "../lib/roster.ts";
import { teamHash } from "../lib/team.ts";
import { button, skeletonRows } from "../ui/controls.ts";
import { h, keepPlace, replace, type Child } from "../ui/dom.ts";
import { icon } from "../ui/icons.ts";
import { workerAvatar } from "../ui/avatar.ts";
import type { Signal } from "../ui/signal.ts";
import { answerStep, chatActivity, galahadWork, nodeTurns, questsInHand, stopChat } from "./chat.ts";
import { editKnight, editRoom, giveToRoundtable, openDirect } from "./team-forms.ts";

/*
 * The roster: the app's home, the Roundtable. Galahad first, as your primary knight and first among
 * equals, then every other knight, then each room; every row a face, a name, one line of latest
 * activity, and a mark when it needs you (lib/roster.ts, lib/now.ts). It is the sidebar on a wide
 * screen and the first screen on a phone. It asks the node nothing of its own: it reads the team,
 * the Inbox and his work as the app has them.
 */

/** What a knight's card says of it in a word, on a phone (its line says the rest; a row on a wide screen has its mark). */
interface Badge { text: string; tone: "needs" | "quiet" | "ok" }
const badgeOf = (item: RosterRow): Badge | null =>
  item.needs ? { text: "Needs you", tone: "needs" } : item.expression === "resting" ? { text: "Paused", tone: "quiet" } : item.expression === "pleased" ? { text: "Verified", tone: "ok" } : null;

/** The last thing said in each conversation the app has read (it reads one only when it is opened). */
const said = new Map<string, Said>();
export const noteSaid = (room: string, message: Said | undefined): void => {
  if (message) said.set(room, message);
};

export interface Roster {
  el: HTMLElement;
  /** Where the app is: the row that is open is marked. */
  at(where: { route: Route; room?: string }): void;
  dispose(): void;
}

export function rosterNav(ctx: Ctx): Roster {
  const el = h("nav", { class: "roster", "aria-label": "The Roundtable" }, skeletonRows(3, { avatar: true }));
  const canEdit = ctx.can("fleet:admin");
  let where: { route: Route | null; room?: string } = { route: null };
  let shown = "";

  const row = (opts: { key: string; href: string; current: boolean; face: Child; name: string; line: string; needs: boolean; badge?: Badge | null; galahad?: boolean; onclick?: (event: Event) => void; after?: Child }): HTMLElement =>
    h(
      "a",
      { class: opts.galahad ? "roster-row roster-galahad" : "roster-row", href: opts.href, "data-key": opts.key, "aria-current": opts.current ? "page" : null, "data-needs": opts.needs ? "" : null, title: `${opts.name}: ${opts.line}`, onclick: opts.onclick },
      h("span", { class: "roster-face" }, opts.face, opts.needs ? h("span", { class: "roster-mark", role: "img", "aria-label": "Needs you" }) : null),
      h(
        "span",
        { class: "roster-text" },
        h("span", { class: "roster-head" }, h("span", { class: "roster-name ellipsis" }, opts.name), opts.badge ? h("span", { class: "roster-badge", "data-tone": opts.badge.tone, "aria-hidden": "true" }, opts.badge.text) : null),
        h("span", { class: "roster-line ellipsis" }, opts.line),
      ),
      opts.after,
    );

  const label = (text: string, ...actions: Child[]): HTMLElement => h("div", { class: "roster-label" }, h("span", { class: "grow" }, text), ...actions);
  // (On a phone the last card seats a knight, so this one is the wide screen's.)
  const newKnight = (): HTMLElement => {
    const el = button("New knight", { variant: "ghost", size: "sm", iconOnly: true, icon: "plus", onClick: () => void editKnight(ctx) });
    el.dataset.newKnight = "";
    return el;
  };
  const give = (): HTMLElement => {
    const el = button("Give a task", { variant: "ghost", size: "sm", icon: "layers", title: "Give a task to the knight best suited to it, or to one by name", onClick: () => giveToRoundtable(ctx) });
    el.dataset.give = "";
    return el;
  };

  function knightOrRoom(item: RosterRow): HTMLElement {
    const knight = item.kind === "knight";
    return row({
      badge: knight ? badgeOf(item) : null,
      key: item.key,
      href: item.room ? teamHash({ room: item.room }) : "#/team",
      current: where.route === "team" && item.room !== null && item.room === where.room,
      face: knight ? workerAvatar({ id: item.id, name: item.name, profile: item.avatar, expression: item.expression, size: 32 }) : h("span", { class: "avatar" }, icon("hash", { size: 16 })),
      name: item.name,
      line: item.line,
      needs: item.needs,
      // A knight you have not written to yet: its conversation is made on the way in.
      ...(knight && !item.room ? { onclick: (event: Event) => (event.preventDefault(), void openDirect(ctx, item)) } : {}),
    });
  }

  function render(): void {
    const snapshot = ctx.live.team.value;
    const problem = snapshot ? null : ctx.live.teamProblem.value;
    const now = Date.now();
    const asks = ctx.live.actions.value.filter((action) => isWaiting(action, now));
    const rows = snapshot ? rosterRows({ snapshot, said, asks, now }) : [];
    const galahad = galahadNow({ ...galahadWork(), needs: ctx.live.inboxLoaded.value ? galahadNeeds(ctx.live.inboxCount.value, asks, snapshot?.teammates.map((person) => person.id) ?? []) : null });
    const answering = chatActivity.value.streaming;
    const version = JSON.stringify([rows, galahad, where, answering, Boolean(snapshot), Boolean(problem)]);
    if (version === shown) return;
    shown = version;
    const knights = rows.filter((item) => item.kind === "knight");
    const rooms = rows.filter((item) => item.kind === "room");
    keepPlace(el, () =>
      replace(
        el,
        // Giving a task to the Roundtable (the knight best suited takes it), or to one knight by name: one sheet.
        label("Roundtable", canEdit && knights.length ? give() : null, canEdit ? newKnight() : null),
        row({
          key: "galahad",
          galahad: true,
          href: "#/chat",
          current: where.route === "chat",
          face: workerAvatar({ id: "galahad", name: "Galahad", expression: galahad.expression, size: 32 }),
          name: "Galahad",
          line: galahad.text,
          needs: galahad.tone === "warn",
          badge: galahad.tone === "warn" ? { text: "Needs you", tone: "needs" } : null,
          // Stop is one click away from every page: said to the node, like the composer's.
          after: answering ? button("Stop", { variant: "ghost", size: "sm", iconOnly: true, icon: "stop", label: "Stop Galahad answering", onClick: (event) => (event.preventDefault(), stopChat()) }) : null,
        }),
        // On a phone the knights are cards, two to a row, and the last card seats a new one.
        knights.length || canEdit ? h("div", { class: "roster-knights" }, ...knights.map(knightOrRoom), canEdit && snapshot ? h("button", { type: "button", class: "roster-add", onclick: () => void editKnight(ctx) }, h("span", { class: "roster-add-plus" }, icon("plus", { size: 18 })), "Add a knight") : null) : null,
        !snapshot && !problem ? skeletonRows(3, { avatar: true }) : null,
        problem ? h("p", { class: "roster-note" }, isUnavailable(problem) ? "This node seats no other knights yet." : "Couldn't reach the Roundtable just now. ", isUnavailable(problem) ? null : button("Try again", { variant: "ghost", size: "sm", onClick: () => void ctx.live.refreshTeam() })) : null,
        snapshot && !knights.length ? h("p", { class: "roster-note" }, canEdit ? "Seat a knight beside Galahad: a name, a lasting job and a workspace of its own." : "No other knights yet. Seating one needs fleet:admin access on an owner device.") : null,
        rooms.length || (canEdit && knights.length) ? label("Rooms", canEdit ? button("New room", { variant: "ghost", size: "sm", iconOnly: true, icon: "plus", onClick: () => editRoom(ctx) }) : null) : null,
        ...rooms.map(knightOrRoom),
      ),
    );
  }

  const watching = [ctx.live.team, ctx.live.teamProblem, ctx.live.actions, ctx.live.inboxCount, ctx.live.inboxLoaded, nodeTurns, questsInHand, answerStep, chatActivity].map((source) => (source as Signal<unknown>).subscribe(render));
  render();
  return {
    el,
    at(next) {
      where = next;
      render();
    },
    dispose: () => watching.forEach((stop) => stop()),
  };
}
