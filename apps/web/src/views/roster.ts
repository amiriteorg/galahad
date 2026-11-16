import type { TeamSnapshot } from "@galahad/core/team";
import { isUnavailable } from "../api.ts";
import type { Ctx, Route } from "../context.ts";
import { isWaiting } from "../live.ts";
import { GALAHAD, placed, seating } from "../lib/arrange.ts";
import { besideChip, galahadState, type KnightState } from "../lib/knight-state.ts";
import { galahadNow, type Now } from "../lib/now.ts";
import { galahadNeeds, rosterRows, type RosterRow, type Said } from "../lib/roster.ts";
import { teamHash } from "../lib/team.ts";
import { type RosterSection, rosterFolded, setRosterFolded } from "../prefs.ts";
import { button, skeletonRows } from "../ui/controls.ts";
import { cx, h, keepPlace, replace, type Child } from "../ui/dom.ts";
import { sortable } from "../ui/drag.ts";
import { icon } from "../ui/icons.ts";
import { leadMark, seat, stateChip } from "../ui/avatar.ts";
import type { Signal } from "../ui/signal.ts";
import { arrange, arrangeControls, arranged, pending, primaryOf } from "./arrange.ts";
import { answerStep, chatActivity, galahadWork, nodeTurns, questsInHand, stopChat } from "./chat.ts";
import { editKnight, editRoom, giveToRoundtable, openDirect } from "./team-forms.ts";

/*
 * The roster: the app's home, the Roundtable. Who leads first (Galahad, unless you made a knight primary, and then
 * Galahad beside it), then every other knight in your order, then each room; every row a face in its seat (a ring of
 * its state's colour), a name, one line of latest activity, and the state in a word where there is room for it
 * (lib/roster.ts, lib/now.ts, lib/knight-state.ts). It is the sidebar on a wide screen (its sections fold, and its
 * knights are dragged into your order) and the first screen on a phone (its knights are cards, and Arrange moves them
 * with buttons). It asks the node nothing of its own: it reads the team, the Inbox and his work as the app has them.
 */

/** The last thing said in each conversation the app has read (it reads one only when it is opened). */
const said = new Map<string, Said>();
export const noteSaid = (room: string, message: Said | undefined): void => {
  if (message) said.set(room, message);
};

/** Everyone at the table, as any list of them draws them: Galahad's row is his line, a knight's its own. */
export interface Seat {
  id: string;
  name: string;
  line: string;
  state: KnightState;
  needs: boolean;
  /** Where its row goes: his chat, a knight's own conversation (null until there is one), a room. */
  href: string;
  room: string | null;
  row: RosterRow | null;
  now: Now | null;
}

/** The table as the app knows it now: the team (as you arranged it), every seat in order, the rooms, his line. */
export interface Table {
  snapshot: TeamSnapshot | null;
  problem: unknown;
  seats: Seat[];
  rooms: RosterRow[];
  primary: string;
  answering: boolean;
}

/** What any list of the knights is drawn from: watched, it is drawn again whenever one of these changes. */
export const tableSources = (ctx: Ctx): Signal<unknown>[] =>
  [ctx.live.team, ctx.live.teamProblem, ctx.live.actions, ctx.live.inboxCount, ctx.live.inboxLoaded, nodeTurns, questsInHand, answerStep, chatActivity, pending] as Signal<unknown>[];

export function tableOf(ctx: Ctx): Table {
  const raw = ctx.live.team.value;
  const snapshot = raw ? arranged(raw) : null;
  const now = Date.now();
  const asks = ctx.live.actions.value.filter((action) => isWaiting(action, now));
  const rows = snapshot ? rosterRows({ snapshot, said, asks, now }) : [];
  const knights = rows.filter((row) => row.kind === "knight");
  const galahad = galahadNow({ ...galahadWork(), needs: ctx.live.inboxLoaded.value ? galahadNeeds(ctx.live.inboxCount.value, asks, snapshot?.teammates.map((person) => person.id) ?? []) : null });
  const primary = snapshot ? primaryOf(snapshot) : GALAHAD;
  const seats = seating(knights.map((row) => row.id), primary).map((id): Seat => {
    if (id === GALAHAD) return { id, name: "Galahad", line: galahad.text, state: galahadState(galahad), needs: galahad.tone === "warn", href: "#/chat", room: null, row: null, now: galahad };
    const row = knights.find((knight) => knight.id === id)!;
    return { id, name: row.name, line: row.line, state: row.state ?? "resting", needs: row.needs, href: row.room ? teamHash({ room: row.room }) : "#/team", room: row.room, row, now: null };
  });
  return { snapshot, problem: snapshot ? null : ctx.live.teamProblem.value, seats, rooms: rows.filter((row) => row.kind === "room"), primary, answering: chatActivity.value.streaming };
}

/** A seat's face: Galahad's with his expression, a knight's with its own drawing and work. */
export const seatFace = (seated: Seat, size: number): HTMLElement =>
  seat({ id: seated.id, name: seated.name, profile: seated.row?.avatar, expression: seated.now?.expression ?? seated.row?.expression, state: seated.state, size });

/** A knight you have not written to yet: its conversation is made on the way in. */
export const openSeat = (ctx: Ctx, seated: Seat) => (seated.id !== GALAHAD && !seated.room ? (event: Event) => (event.preventDefault(), void openDirect(ctx, { id: seated.id })) : undefined);

/** A knight dropped at `index` among the others that move: your new order, said to the node (nothing, if it stayed). */
export function dropped(ctx: Ctx, table: Table, key: string, index: number): void {
  const order = table.snapshot?.teammates.map((knight) => knight.id) ?? [];
  const next = placed(order, key.replace(/^person:/, ""), index, table.primary);
  if (next.join() !== order.join()) void arrange(ctx, { order: next });
}

export interface Roster {
  el: HTMLElement;
  /** Where the app is: the row that is open is marked. */
  at(where: { route: Route; room?: string }): void;
  dispose(): void;
}

export function rosterNav(ctx: Ctx): Roster {
  const el = h("nav", { class: "roster", "aria-label": "The Roundtable" }, skeletonRows(3, { avatar: true }));
  const canEdit = ctx.can("fleet:admin");
  // A phone's roster is the whole screen, its knights cards; a wide screen's is the sidebar, a row each.
  const narrow = matchMedia("(max-width: 959px)");
  let where: { route: Route | null; room?: string } = { route: null };
  let shown = "";
  /** Arranging the knights with buttons (a phone's way; a wide screen drags them here, and arranges on the board). */
  let arranging = false;
  let folded = rosterFolded();
  let table: Table | null = null;

  const drag = canEdit
    ? sortable(el, {
        items: () => [...el.querySelectorAll<HTMLElement>(".roster-row[data-moves]")],
        layout: () => ({ kind: "rows", gap: 1 }),
        onDrop: (key, index) => table && dropped(ctx, table, key, index),
        onEnd: () => render(),
      })
    : null;

  const row = (opts: { seated?: Seat; key: string; href: string; current: boolean; face: Child; name: string; line: string; needs: boolean; lead?: boolean; leads?: boolean; chip?: Child; moves?: boolean; rest?: boolean; onclick?: (event: Event) => void; after?: Child }): HTMLElement =>
    h(
      "a",
      {
        class: cx("roster-row", opts.lead && "roster-lead"),
        href: opts.href,
        draggable: "false",
        "data-key": opts.key,
        "aria-current": opts.current ? "page" : null,
        "data-needs": opts.needs ? "" : null,
        "data-moves": opts.moves ? "" : null,
        "data-rest": opts.rest ? "" : null,
        title: `${opts.name}: ${opts.line}`,
        onclick: opts.onclick,
      },
      h("span", { class: "roster-face" }, opts.face, opts.needs && !opts.seated ? h("span", { class: "roster-mark", role: "img", "aria-label": "Needs you" }) : null),
      h("span", { class: "roster-text" }, h("span", { class: "roster-head" }, h("span", { class: "roster-name ellipsis" }, opts.name), opts.leads ? leadMark(opts.name) : null, opts.chip ?? null), h("span", { class: "roster-line ellipsis" }, opts.line)),
      opts.after,
    );

  // A section's head: on a wide screen it folds the section (remembered on this device); on a phone it is a label.
  const label = (section: RosterSection, text: string, phone: boolean, ...actions: Child[]): HTMLElement =>
    h(
      "div",
      { class: "roster-label" },
      phone
        ? h("span", { class: "grow" }, text)
        : h("button", { type: "button", class: "roster-fold grow", "aria-expanded": String(!folded.has(section)), onclick: () => fold(section) }, icon("chevron-down", { size: 12, class: "chev" }), h("span", {}, text)),
      ...actions,
    );
  const fold = (section: RosterSection): void => {
    setRosterFolded(section, !folded.has(section));
    folded = rosterFolded();
    render();
  };
  // (On a phone the last card seats a knight, and the floating button gives a task; so these are the wide screen's.)
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

  function seatRow(seated: Seat, phone: boolean, at: number, head: number, now: Table): HTMLElement {
    const galahad = seated.id === GALAHAD;
    const lead = at === 0;
    // On a phone, who leads is the card across the top, the others cards two to a row; a wide screen's rows are one size.
    const size = !phone ? 32 : lead ? 76 : 84;
    return row({
      seated,
      key: galahad ? "galahad" : `person:${seated.id}`,
      href: seated.href,
      current: galahad ? where.route === "chat" : where.route === "team" && seated.room !== null && seated.room === where.room,
      face: seatFace(seated, size),
      name: seated.name,
      // Beside its chip (a phone's), the line doesn't say the chip's word again.
      line: phone ? besideChip(seated.line, seated.state) : seated.line,
      needs: seated.needs,
      lead,
      leads: seated.id === now.primary,
      chip: phone ? stateChip(seated.state) : null,
      moves: canEdit && !phone && !galahad && seated.id !== now.primary,
      rest: at >= head,
      ...(openSeat(ctx, seated) ? { onclick: openSeat(ctx, seated)! } : {}),
      // Stop is one click away from every page: said to the node, like the composer's.
      after: galahad && now.answering ? button("Stop", { variant: "ghost", size: "sm", iconOnly: true, icon: "stop", label: "Stop Galahad answering", onClick: (event) => (event.preventDefault(), stopChat()) }) : null,
    });
  }

  /** A seat while you arrange the table: its face, its name and line, who leads, and the buttons that move it. */
  const arrangeRow = (seated: Seat, now: Table): HTMLElement =>
    h(
      "div",
      { class: "roster-row arrange-row", "data-key": seated.id === GALAHAD ? "galahad" : `person:${seated.id}` },
      h("span", { class: "roster-face" }, seatFace(seated, 32)),
      h("span", { class: "roster-text" }, h("span", { class: "roster-head" }, h("span", { class: "roster-name ellipsis" }, seated.name)), h("span", { class: "roster-line ellipsis" }, seated.id === GALAHAD ? "First among equals" : (now.snapshot?.teammates.find((knight) => knight.id === seated.id)?.role ?? ""))),
      h("span", { class: "arrange-controls" }, ...arrangeControls(ctx, now.snapshot!, seated)),
    );

  function render(): void {
    // (Redrawn once a drag has let go: a row under the pointer stays the one it lifted.)
    if (drag?.dragging()) return;
    const now = tableOf(ctx);
    table = now;
    const phone = narrow.matches;
    if (!phone || !now.snapshot?.teammates.length) arranging = false;
    const version = JSON.stringify([now.seats, now.rooms, now.primary, where, now.answering, Boolean(now.snapshot), Boolean(now.problem), phone, arranging, [...folded]]);
    if (version === shown) return;
    shown = version;
    const { snapshot, problem, seats, rooms } = now;
    const knights = seats.length - 1;
    // Who leads and Galahad sit at the head of the table: a folded list of knights keeps them.
    const head = seats.findIndex((seated) => seated.id === GALAHAD) + 1;
    if (arranging) el.dataset.arranging = "";
    else delete el.dataset.arranging;
    el.dataset.folded = [...folded].join(" ");
    const [first, ...others] = seats.map((seated, at) => seatRow(seated, phone, at, head, now));
    keepPlace(el, () =>
      replace(
        el,
        // Giving a task to the Roundtable (the knight best suited takes it), or to one knight by name: one sheet.
        label(
          "knights",
          "Knights",
          phone,
          arranging ? button("Done", { variant: "primary", size: "sm", onClick: () => ((arranging = false), render()) }) : null,
          !arranging && phone && canEdit && knights ? button("Arrange", { variant: "ghost", size: "sm", title: "Your order of the knights, and who leads", onClick: () => ((arranging = true), render()) }) : null,
          // (A phone gives a task from its floating button: there, this one steps aside.)
          canEdit && knights && !arranging ? give() : null,
          !phone && canEdit ? newKnight() : null,
        ),
        // (Until the team is known, who sits first isn't: the rows' place is held, so none moves when it arrives.)
        !snapshot && !problem
          ? skeletonRows(4, { avatar: true })
          : arranging
          ? h("div", { class: "roster-arrange", role: "group", "aria-label": "Your order of the knights, and who leads" }, ...seats.map((seated) => arrangeRow(seated, now)))
          : [
              first,
              // On a phone the knights are cards, two to a row, and the last card seats a new one.
              others.length || (canEdit && snapshot) ? h("div", { class: "roster-knights" }, ...others, phone && canEdit && snapshot ? h("button", { type: "button", class: "roster-add", onclick: () => void editKnight(ctx) }, h("span", { class: "roster-add-plus" }, icon("plus", { size: 18 })), "Add a knight") : null) : null,
            ],
        problem ? h("p", { class: "roster-note" }, isUnavailable(problem) ? "This node seats no other knights yet." : "Couldn't reach the Roundtable just now. ", isUnavailable(problem) ? null : button("Try again", { variant: "ghost", size: "sm", onClick: () => void ctx.live.refreshTeam() })) : null,
        snapshot && !knights ? h("p", { class: "roster-note" }, canEdit ? "Seat a knight beside Galahad: a name, a lasting job and a workspace of its own." : "No other knights yet. Seating one needs fleet:admin access on an owner device.") : null,
        !arranging && (rooms.length || (canEdit && knights)) ? label("rooms", "Rooms", phone, canEdit ? button("New room", { variant: "ghost", size: "sm", iconOnly: true, icon: "plus", onClick: () => editRoom(ctx) }) : null) : null,
        ...(arranging
          ? []
          : rooms.map((item) =>
              row({ key: item.key, href: teamHash({ room: item.room! }), current: where.route === "team" && item.room === where.room, face: h("span", { class: "avatar" }, icon("hash", { size: 16 })), name: item.name, line: item.line, needs: item.needs }),
            )),
      ),
    );
  }

  const watching = tableSources(ctx).map((source) => source.subscribe(render));
  const media = () => render();
  narrow.addEventListener("change", media);
  render();
  return {
    el,
    at(next) {
      where = next;
      render();
    },
    dispose: () => {
      watching.forEach((stop) => stop());
      narrow.removeEventListener("change", media);
      drag?.dispose();
    },
  };
}
