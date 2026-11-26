import type { Ctx } from "../context.ts";
import { type Place, placesFor, placesIndex } from "../lib/nav.ts";
import { button, list, listRow, section } from "../ui/controls.ts";
import { openSheet } from "../ui/dialog.ts";
import { h, isMac } from "../ui/dom.ts";
import { icon } from "../ui/icons.ts";
import { giveToRoundtable } from "./team-forms.ts";

/*
 * Everything else, under "…" (your words, 26 November 2026: on a phone no tab bar, "a '…' sheet for everything else";
 * the wide screen's rail went with it, its places here and in the command palette): the Roundtable, where the knights and
 * their rooms are, then every place More lists, each with a line saying what is there, only what this device may see.
 * A sheet on every screen (a bottom sheet on a phone); More (#/more) is the same index as a page.
 */

/** A place's row in the index (the Inbox counts what waits there). */
export function placeRow(place: Place, waiting = 0): HTMLElement {
  return listRow({
    lead: place.icon,
    title: place.label,
    sub: place.about,
    href: `#/${place.id}`,
    chevron: true,
    ...(place.id === "inbox" && waiting ? { trail: h("span", { class: "count", "aria-label": `${waiting} waiting` }, waiting > 99 ? "99+" : String(waiting)) } : {}),
  });
}

/** A place as a tile in the "…" sheet: its icon and its name on one line, 44 px tall (what is there is its tooltip, it is
 * read out after its name, and the palette's search shows it), so the whole index fits a phone's screen. */
export function placeTile(place: Place, waiting = 0): HTMLElement {
  return h(
    "a",
    { class: "place-tile", href: `#/${place.id}`, title: place.about },
    h("span", { class: "place-tile-icon", "aria-hidden": "true" }, icon(place.icon, { size: 16 })),
    h("span", { class: "place-tile-label ellipsis" }, place.label),
    h("span", { class: "sr-only" }, `: ${place.about}`),
    place.id === "inbox" && waiting ? h("span", { class: "count", "aria-label": `${waiting} waiting` }, waiting > 99 ? "99+" : String(waiting)) : null,
  );
}

/** The index as sections: the Roundtable on its own, then More's headings. `compact` (the "…" sheet): the Roundtable as a
 * row with what is there, every other place a tile of one line, two or more a row; otherwise (More's page) rows of two
 * lines. */
export function placesSections(ctx: Ctx, compact = false): HTMLElement[] {
  const waiting = ctx.live.inboxCount.value;
  return placesIndex(placesFor(ctx.can)).map((group) => {
    if (!group.heading) return list(group.places.map((place) => placeRow(place, waiting)), { nav: "The Roundtable" });
    if (!compact) return section(group.heading, {}, list(group.places.map((place) => placeRow(place, waiting)), { nav: group.heading }));
    return section(group.heading, {}, h("nav", { class: "place-tiles", "aria-label": group.heading }, ...group.places.map((place) => placeTile(place, waiting))));
  });
}

/** Opens the index under "…": a search and a task to give at its head, then every place. */
export function openPlaces(ctx: Ctx, from?: Element): void {
  const canGive = ctx.can("fleet:admin") && ctx.can("chat");
  const sheet = openSheet({
    title: "Everything else",
    description: "Every place this device may open. Search finds the rest, and your chats.",
    body: h(
      "div",
      { class: "stack loose places-index" },
      h(
        "div",
        { class: "row wrap" },
        button("Search", { icon: "search", label: `Search and commands (${isMac() ? "⌘" : "Ctrl"}+K)`, onClick: () => (sheet.close(), ctx.palette(undefined, from)) }),
        canGive ? button("Give a task", { icon: "layers", onClick: () => (sheet.close(), giveToRoundtable(ctx)) }) : null,
        // (What the rail's Add was: the palette, on everything this device may add, a key, an MCP server, a loop…)
        button("Add…", { icon: "plus", title: "Add a key, an MCP server, a connector, a loop and more", onClick: () => (sheet.close(), ctx.palette("Add ", from)) }),
      ),
      ...placesSections(ctx, true),
    ),
  });
}
