import { describe, expect, test } from "bun:test";
import type { JournalEntry } from "@galahad/core/journal";
import { danishToday, dayWord, JOURNAL_PAGE, journalPage, journalPages, mergeEntries, pagingFrom } from "./journal.ts";

/*
 * The Journal view's model: entries as pages (the date written out, his recollection,
 * what he learned and what he'd like to do), one a day and newest first as older
 * pages are fetched, and where the next fetch starts.
 */

const entry = (day: string, text = `The day ${day}.`, at = Date.parse(`${day}T20:30:00Z`)): JournalEntry => ({ id: `m-${day}-${at}`, day, at, text });

describe("a page of his journal", () => {
  test("the date written out, his recollection in paragraphs, Learned and Next set apart", () => {
    const page = journalPage(entry("2026-11-11", "Bors woke me a little after six.\n\nIn the afternoon I built the arm.\nLearned: rack sleeps at night.\nNext:\n- Ask about rack's power settings\n- Tidy old artifacts"), "2026-11-11");
    expect(page).toMatchObject({
      day: "2026-11-11",
      date: "Wednesday 11 November 2026",
      when: "Today",
      recollection: ["Bors woke me a little after six.", "In the afternoon I built the arm."],
      learned: ["rack sleeps at night."],
      next: ["Ask about rack's power settings", "Tidy old artifacts"],
    });
    expect(page.writtenAt).toBe(Date.parse("2026-11-11T20:30:00Z"));
  });

  test("an older reflection reads as a page too: what happened is its recollection", () => {
    const page = journalPage(entry("2026-11-09", "Happened: twelve sandboxes came and went.\nLearned: nothing new.\nNext: tidy up"), "2026-11-11");
    expect(page).toMatchObject({ when: "", recollection: ["twelve sandboxes came and went."], learned: ["nothing new."], next: ["tidy up"] });
  });

  test("an entry with nothing but prose is all recollection; an empty one still has its date", () => {
    expect(journalPage(entry("2026-11-10", "A quiet day by the fire."), "2026-11-11")).toMatchObject({ when: "Yesterday", recollection: ["A quiet day by the fire."], learned: [], next: [] });
    expect(journalPage(entry("2026-11-10", ""), "2026-11-11")).toMatchObject({ date: "Tuesday 10 November 2026", recollection: [] });
  });

  test("today and yesterday are Denmark's, across a month's end and a year's", () => {
    expect(dayWord("2026-11-11", "2026-11-11")).toBe("Today");
    expect(dayWord("2026-11-10", "2026-11-11")).toBe("Yesterday");
    expect(dayWord("2026-10-31", "2026-11-01")).toBe("Yesterday");
    expect(dayWord("2026-12-31", "2027-01-01")).toBe("Yesterday");
    expect(dayWord("2026-11-09", "2026-11-11")).toBe("");
    expect(dayWord("2026-11-12", "2026-11-11")).toBe("");
    // 23:30 UTC in November is already tomorrow in Copenhagen.
    expect(danishToday(Date.parse("2026-11-11T22:59:00Z"))).toBe("2026-11-11");
    expect(danishToday(Date.parse("2026-11-11T23:30:00Z"))).toBe("2026-11-12");
  });
});

describe("the list of pages", () => {
  test("newest day first, whatever order they came in", () => {
    const pages = journalPages([entry("2026-11-09"), entry("2026-11-11"), entry("2026-11-10")], "2026-11-11");
    expect(pages.map((p) => p.day)).toEqual(["2026-11-11", "2026-11-10", "2026-11-09"]);
    expect(pages.map((p) => p.when)).toEqual(["Today", "Yesterday", ""]);
  });

  test("older pages join the ones on screen: one a day, the later written kept", () => {
    const have = [entry("2026-11-11"), entry("2026-11-10", "First try.", 1000)];
    const merged = mergeEntries(have, [entry("2026-11-10", "Written again.", 2000), entry("2026-11-09"), entry("2026-11-08")]);
    expect(merged.map((e) => e.day)).toEqual(["2026-11-11", "2026-11-10", "2026-11-09", "2026-11-08"]);
    expect(merged[1]!.text).toBe("Written again.");
    // Fetching the same page twice changes nothing.
    expect(mergeEntries(merged, [entry("2026-11-09"), entry("2026-11-08")])).toEqual(merged);
  });

  test("the next fetch starts before the oldest day on screen; the first has no start", () => {
    expect(pagingFrom([])).toEqual({ limit: JOURNAL_PAGE });
    expect(pagingFrom([entry("2026-11-11"), entry("2026-11-09"), entry("2026-11-10")])).toEqual({ limit: JOURNAL_PAGE, before: "2026-11-09" });
  });
});
