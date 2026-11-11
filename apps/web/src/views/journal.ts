import type { JournalEntry, JournalView } from "@galahad/core/journal";
import { isUnavailable } from "../api.ts";
import type { View } from "../context.ts";
import { danishToday, type JournalPage, journalPages, mergeEntries, pagingFrom } from "../lib/journal.ts";
import { busy, button, empty, errorState, pageHead, skeletonBlock } from "../ui/controls.ts";
import { h, keepPlace, nextId, replace } from "../ui/dom.ts";

/*
 * His journal (#/journal; the book on his desk in the SANDBOX opens it). Every
 * evening at 21:30, Denmark's time, he recollects the day in his own words; here
 * each day is a page, newest first: the date written out, his recollection as prose,
 * then what he learned and what he'd like to do next, set apart. Read-only: the
 * entries are his memories, kept by the journal's loop on the node (Loops runs it).
 */

/** Denmark's clock at an instant: when he wrote. */
const WRITTEN = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Copenhagen", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

const items = (lines: string[]): HTMLElement => h("ul", {}, ...lines.map((line) => h("li", {}, line)));

function page(p: JournalPage): HTMLElement {
  const id = nextId("journal");
  return h(
    "article",
    { class: "card journal-page", "aria-labelledby": id, "data-day": p.day },
    h("header", { class: "journal-date" }, h("h2", { id }, p.date), p.when ? h("span", { class: "when" }, p.when) : null),
    p.recollection.length ? h("div", { class: "journal-prose" }, ...p.recollection.map((paragraph) => h("p", {}, paragraph))) : null,
    p.learned.length || p.next.length
      ? h(
          "div",
          { class: "journal-notes" },
          p.learned.length ? h("section", { class: "journal-note" }, h("h3", {}, "Learned"), items(p.learned)) : null,
          p.next.length
            ? h("section", { class: "journal-note" }, h("h3", {}, "Next"), items(p.next), h("p", { class: "tiny subtle" }, "What he'd like to do. Each went to your Inbox as a suggestion; he does none of them on his own."))
            : null,
        )
      : null,
    h("footer", { class: "journal-foot tiny subtle", title: new Date(p.writtenAt).toLocaleString() }, `Written at ${WRITTEN.format(p.writtenAt)}, Denmark's time`),
  );
}

export const journalView: View = (root, ctx, { scope }) => {
  let entries: JournalEntry[] = [];
  let more = false;
  let loaded = false;
  const list = h("div", { class: "journal", "aria-busy": "true" }, skeletonBlock(260), skeletonBlock(220));
  const olderSlot = h("div", { class: "journal-more" });

  /** What's on screen, so a refresh that brings nothing new leaves the page (and what you've selected on it) alone. */
  let shown = "";

  function draw(): void {
    const today = danishToday();
    const key = JSON.stringify([today, more, entries.map((e) => [e.id, e.day])]);
    if (key === shown) return;
    shown = key;
    const pages = journalPages(entries, today);
    keepPlace(list, () =>
      replace(
        list,
        pages.length
          ? pages.map(page)
          : empty({
              icon: "journal",
              title: "No pages yet",
              body: "He writes every evening at 21:30, Denmark's time: the day in his own words, what he learned, and what he'd like to do next. To have him write today's now, run the journal's loop from Loops.",
              actions: button("Open Loops", { icon: "repeat", onClick: () => ctx.navigate("loops") }),
            }),
      ),
    );
    list.setAttribute("aria-busy", "false");
    replace(olderSlot, more ? older : null);
  }

  /** The newest pages (again, while the page is open: tonight's entry appears when it's written). */
  async function refresh(): Promise<void> {
    try {
      const view = await ctx.api.post<JournalView>("/api/journal", pagingFrom([]), scope.signal);
      if (scope.disposed) return;
      // Older pages already on screen stay; whether more remain is known from the fetch that reached furthest back.
      if (!loaded || entries.length <= view.entries.length) more = view.more;
      entries = mergeEntries(entries, view.entries);
      loaded = true;
      draw();
    } catch (error) {
      if (scope.disposed || loaded) return;
      list.setAttribute("aria-busy", "false");
      replace(
        list,
        isUnavailable(error)
          ? empty({ icon: "journal", title: "His journal isn't on this node yet", body: "It arrives with an update.", compact: true })
          : errorState("Couldn't open his journal", error, () => void refresh()),
      );
    }
  }

  const older = button("Older pages", {
    icon: "chevron-down",
    onClick: () =>
      void busy(older, async () => {
        try {
          const view = await ctx.api.post<JournalView>("/api/journal", pagingFrom(entries), scope.signal);
          if (scope.disposed) return;
          entries = mergeEntries(entries, view.entries);
          more = view.more;
          draw();
        } catch (error) {
          if (!scope.disposed) replace(olderSlot, errorState("Couldn't fetch older pages", error, () => replace(olderSlot, older)));
        }
      }),
  });

  replace(
    root,
    h(
      "div",
      { class: "page narrow" },
      pageHead("Journal", "Each evening Galahad sits down at his desk and recollects the day in his own words: his work, what he built and tested, who worked with him, and his day in the SANDBOX with his dog."),
      list,
      olderSlot,
    ),
  );
  scope.interval(() => void refresh(), 60_000);
  void refresh();
};
