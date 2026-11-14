import { JOURNAL_SOURCE, JOURNAL_TAG, journalDate, type JournalEntry, journalEntry, journalParts, type JournalView, REFLECTION_TAG } from "@galahad/core";
import type { MindStore } from "@galahad/mind";

/*
 * His journal, read back from the mind. The entries are the
 * memories the reflect loop kept (reflect.ts): tagged `journal` or `reflection`, and
 * written with the loop's own provenance, which no route gives anyone else. So a
 * memory an agent tagged to look like his journal isn't shown as his, and doesn't
 * stop him writing that day's.
 */

/** Far more days than a fleet has lived: every entry is read, then paged. */
const MAX_ENTRIES = 5000;
const DEFAULT_PAGE = 30;

/** His entries, newest day first: one a day (the latest written for it), paged by `limit` and `before` (a day), or one `day`. */
export function journalEntries(store: Pick<MindStore, "memoriesTagged" | "event">, opts: { limit?: number | undefined; before?: string | undefined; day?: string | undefined } = {}): JournalView {
  const tagged = [...store.memoriesTagged(JOURNAL_TAG, MAX_ENTRIES), ...store.memoriesTagged(REFLECTION_TAG, MAX_ENTRIES)].sort((a, b) => (a.hlc < b.hlc ? 1 : a.hlc > b.hlc ? -1 : 0));
  const byDay = new Map<string, JournalEntry>();
  for (const memory of tagged) {
    const entry = journalEntry(memory);
    if (!entry || byDay.has(entry.day)) continue;
    if (opts.day ? entry.day !== opts.day : opts.before !== undefined && entry.day >= opts.before) continue;
    // Only what his loop kept.
    if (store.event(memory.id)?.prov?.source !== JOURNAL_SOURCE) continue;
    byDay.set(entry.day, entry);
  }
  const entries = [...byDay.values()].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
  const limit = opts.limit ?? DEFAULT_PAGE;
  return { entries: entries.slice(0, limit), more: entries.length > limit };
}

/** An entry in words, for a terminal or a model: its date written out, his recollection, what he learned, what he'd like to do. */
export function entryInWords(entry: JournalEntry): string {
  const parts = journalParts(entry.text);
  return [
    `${journalDate(entry.day)} (${entry.day})`,
    ...(parts.recollection.length ? ["", parts.recollection.join("\n\n")] : []),
    ...(parts.learned.length ? ["", "Learned:", ...parts.learned.map((l) => `- ${l}`)] : []),
    ...(parts.next.length ? ["", "Next (suggestions he made; he does none of them on his own):", ...parts.next.map((l) => `- ${l}`)] : []),
  ].join("\n");
}
