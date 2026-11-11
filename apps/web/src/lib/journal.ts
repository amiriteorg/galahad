import { journalDate, type JournalEntry, journalParts } from "@galahad/core/journal";

/*
 * The Journal view's model (views/journal.ts draws it): his entries as pages, one a
 * day and newest first, and where the next fetch of older pages starts. Pure, so
 * unit-tested; what an entry's parts are is core's (journalParts), the same on every
 * surface.
 */

/** How many pages one fetch asks for: about two weeks. */
export const JOURNAL_PAGE = 14;

export interface JournalPage {
  id: string;
  day: string;
  /** The date written out, the day before the month: "Wednesday 11 November 2026". */
  date: string;
  /** "Today", "Yesterday" or nothing. */
  when: string;
  /** When he wrote it (ms). */
  writtenAt: number;
  /** His recollection, a paragraph each. */
  recollection: string[];
  learned: string[];
  /** What he'd like to do next: suggestions in the Inbox, never actions. */
  next: string[];
}

const DANISH_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit" });

/** The day in Denmark now, YYYY-MM-DD: his journal's days are Denmark's, whatever this device's zone. */
export const danishToday = (now = Date.now()): string => DANISH_DAY.format(now);

const dayNumber = (day: string): number => Math.round(Date.parse(`${day}T00:00:00Z`) / 86_400_000);

/** "Today" or "Yesterday" for an entry's day, seen from today's (both Denmark's); otherwise nothing. */
export function dayWord(day: string, today: string): string {
  const ago = dayNumber(today) - dayNumber(day);
  return ago === 0 ? "Today" : ago === 1 ? "Yesterday" : "";
}

export function journalPage(entry: JournalEntry, today: string): JournalPage {
  return { id: entry.id, day: entry.day, date: journalDate(entry.day), when: dayWord(entry.day, today), writtenAt: entry.at, ...journalParts(entry.text) };
}

const newestFirst = (a: JournalEntry, b: JournalEntry): number => (a.day < b.day ? 1 : a.day > b.day ? -1 : b.at - a.at);

/** The entries on screen with more fetched: one a day (the later written), newest day first. */
export function mergeEntries(have: readonly JournalEntry[], more: readonly JournalEntry[]): JournalEntry[] {
  const byDay = new Map<string, JournalEntry>();
  for (const entry of [...have, ...more]) {
    const held = byDay.get(entry.day);
    if (!held || entry.at > held.at) byDay.set(entry.day, entry);
  }
  return [...byDay.values()].sort(newestFirst);
}

export const journalPages = (entries: readonly JournalEntry[], today: string): JournalPage[] => mergeEntries(entries, []).map((entry) => journalPage(entry, today));

/** What to ask the node for next: the first pages, or the ones before the oldest day on screen. */
export function pagingFrom(entries: readonly JournalEntry[]): { limit: number; before?: string } {
  const oldest = entries.reduce<string | null>((min, e) => (min === null || e.day < min ? e.day : min), null);
  return oldest === null ? { limit: JOURNAL_PAGE } : { limit: JOURNAL_PAGE, before: oldest };
}
