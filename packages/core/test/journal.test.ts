import { describe, expect, test } from "bun:test";
import { routes } from "../src/index.ts";
import { journalDate, journalEntry, journalHeading, journalParts, journalTags } from "../src/journal.ts";

/*
 * His journal as every surface reads it (an entry from the memory the loop kept, its
 * recollection, what he learned and what he'd like to do next, an older reflection
 * too).
 */

const HLC = "001794430200000.000000";

describe("a journal entry", () => {
  const text = `${journalHeading("2026-11-11")}\nThe dog woke me a little after six, and we did the rounds.\n\nIn the afternoon I built the arm.\nLearned: rack sleeps at night.\nNext:\n- Ask about rack's power settings`;

  test("is the memory the loop kept: its day from its tag, its text without the heading", () => {
    expect(journalEntry({ id: "m1", text, tags: journalTags("2026-11-11"), hlc: HLC })).toEqual({
      id: "m1",
      day: "2026-11-11",
      at: 1_794_430_200_000,
      text: text.slice(text.indexOf("\n") + 1),
    });
    expect(journalTags("2026-11-11")).toEqual(["journal", "reflection", "day:2026-11-11"]);
  });

  test("an older reflection is one too", () => {
    const old = journalEntry({ id: "m0", text: "Reflection on 2026-11-10:\nHappened: twelve sandboxes came and went.\nLearned: nothing new.\nNext: tidy up", tags: ["reflection", "day:2026-11-10"], hlc: HLC });
    expect(old).toMatchObject({ day: "2026-11-10", text: "Happened: twelve sandboxes came and went.\nLearned: nothing new.\nNext: tidy up" });
  });

  test("a memory that isn't tagged as one, or names no day, is not", () => {
    expect(journalEntry({ id: "m2", text, tags: ["day:2026-11-11"], hlc: HLC })).toBeNull();
    expect(journalEntry({ id: "m3", text: "Just a note", tags: ["journal"], hlc: HLC })).toBeNull();
    expect(journalEntry({ id: "m4", text, tags: ["journal", "day:tomorrow"], hlc: HLC })?.day).toBe("2026-11-11");
  });

  test("reads as a recollection in paragraphs, then what he learned and what he'd like to do next", () => {
    const parts = journalParts(text.slice(text.indexOf("\n") + 1));
    expect(parts.recollection).toEqual(["The dog woke me a little after six, and we did the rounds.", "In the afternoon I built the arm."]);
    expect(parts.learned).toEqual(["rack sleeps at night."]);
    expect(parts.next).toEqual(["Ask about rack's power settings"]);
  });

  test("a paragraph broken over lines is one paragraph; bold headings and numbered ideas are read", () => {
    const parts = journalParts("I walked the dog\nand then worked.\n\n**Learned:** two things\nthat matter\n**Next:**\n1. First idea\n2) Second idea\n* Third idea");
    expect(parts.recollection).toEqual(["I walked the dog and then worked."]);
    expect(parts.learned).toEqual(["two things", "that matter"]);
    expect(parts.next).toEqual(["First idea", "Second idea", "Third idea"]);
  });

  test("an older reflection's Happened is its recollection", () => {
    const parts = journalParts("Happened: twelve sandboxes came and went.\n- and a search\nLearned: nothing new.\nNext: tidy up");
    expect(parts.recollection).toEqual(["twelve sandboxes came and went.", "and a search"]);
    expect(parts.learned).toEqual(["nothing new."]);
    expect(parts.next).toEqual(["tidy up"]);
  });

  test("the date written out, day before month", () => {
    expect(journalDate("2026-11-11")).toBe("Wednesday 11 November 2026");
    expect(journalDate("2027-01-01")).toBe("Friday 1 January 2027");
    expect(journalDate("not a day")).toBe("not a day");
  });

  test("one route reads it, with paging, under the scope that reads memories", () => {
    expect(routes.journal.scope).toBe(routes.recall.scope);
    const ok = (input: unknown) => routes.journal.input.safeParse(input).success;
    expect(ok({})).toBe(true);
    expect(ok({ limit: 10, before: "2026-11-11" })).toBe(true);
    expect(ok({ day: "2026-11-11" })).toBe(true);
    expect(ok({ day: "11/11/2026" })).toBe(false);
    expect(ok({ limit: 0 })).toBe(false);
    expect(ok({ limit: 101 })).toBe(false);
    expect(ok({ q: "x" })).toBe(false);
  });
});
