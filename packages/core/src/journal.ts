import { isHlc } from "./hlc.ts";

/*
 * His journal. Every evening (21:30 in Denmark) Galahad recollects the day: a short
 * piece of prose in his own voice, then what he learned and what he'd like to do next. The node's `reflect` loop writes it
 * (packages/node/src/reflect.ts) and keeps it as one memory a Danish day: its text
 * starts "Journal, <day>:", its tags are `journal`, `reflection` and `day:<day>`.
 * Before the journal he kept a daily reflection ("Reflection on <day>:", tagged
 * `reflection`): those are entries too, and read the same way.
 *
 * Here: an entry as every surface reads it (the CLI, the PWA, an agent over MCP), and
 * its parts. Pure and free of zod, so the PWA uses the same code as the node.
 */

/** One day's entry. `text` is what he wrote, without its heading line. */
export interface JournalEntry {
  /** The memory's id (the event that kept it). */
  id: string;
  /** The Danish day it's about, YYYY-MM-DD. */
  day: string;
  /** When it was kept (ms). */
  at: number;
  text: string;
}

/** What `routes.journal` answers: entries newest day first, and whether older ones remain. */
export interface JournalView {
  entries: JournalEntry[];
  more: boolean;
}

export const JOURNAL_TAG = "journal";
/** What his entries were tagged before they were a journal; new ones carry it too, so the once-a-day check holds across the change. */
export const REFLECTION_TAG = "reflection";
/** The provenance source of a memory the loop kept: nothing else writes with it, so nothing else passes for his journal. */
export const JOURNAL_SOURCE = "reflection";
export const JOURNAL_DAY = /^\d{4}-\d{2}-\d{2}$/;

const PARTS = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
const MIN = 60_000;

/** Denmark's wall clock at an instant: the date (what an entry is about), and when its midnight was (ms). */
export function danishDate(now: number): { day: string; midnight: number } {
  const p: Record<string, number> = {};
  for (const part of PARTS.formatToParts(now)) if (part.type !== "literal") p[part.type] = Number(part.value);
  const wall = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
  // The zone's offset now (whole minutes), and so its midnight on this day.
  const offset = Math.round((wall - Math.floor(now / 1000) * 1000) / MIN) * MIN;
  const day = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  return { day, midnight: Date.UTC(p.year!, p.month! - 1, p.day!) - offset };
}

export const journalHeading = (day: string): string => `Journal, ${day}:`;
export const journalTags = (day: string): string[] => [JOURNAL_TAG, REFLECTION_TAG, `day:${day}`];

const HEADING = /^(?:Journal, |Reflection on )(\d{4}-\d{2}-\d{2}):[ \t]*(?:\r?\n|$)/;

/** What he wrote without a heading line he (or the loop) put first. */
export const withoutHeading = (text: string): string => text.replace(HEADING, "").trim();

/**
 * A memory as a journal entry: tagged `journal` or `reflection`, its day from its `day:` tag (or its heading),
 * its text without the heading. Null when it isn't one. Whether the loop really wrote it is the node's to check
 * (its provenance): this only reads its shape.
 */
export function journalEntry(memory: { id: string; text: string; tags: readonly string[]; hlc: string }): JournalEntry | null {
  if (!memory.tags.includes(JOURNAL_TAG) && !memory.tags.includes(REFLECTION_TAG)) return null;
  const tagged = memory.tags.find((t) => t.startsWith("day:") && JOURNAL_DAY.test(t.slice(4)))?.slice(4);
  const day = tagged ?? HEADING.exec(memory.text)?.[1];
  if (!day) return null;
  return { id: memory.id, day, at: isHlc(memory.hlc) ? Number(memory.hlc.split(".")[0]) : 0, text: withoutHeading(memory.text) };
}

export interface JournalParts {
  /** His recollection of the day, a paragraph each (an older reflection's "Happened"). */
  recollection: string[];
  /** What he learned, a line each. */
  learned: string[];
  /** What he'd like to do next, a line each (they became suggestions in the inbox, never actions). */
  next: string[];
}

const PART = /^\**(happened|learned|next)\**\s*:\**\s*(.*)$/i;
const BULLET = /^([-*•]|\d+[.)])\s+/;

/**
 * An entry's text in its parts: prose until a line headed "Learned:" or "Next:" (bold or not), then a line an
 * item, bullets and numbers taken off. In the recollection a blank line (or a bullet) starts a new paragraph and
 * a broken line goes on with the one before.
 */
export function journalParts(text: string): JournalParts {
  const parts: JournalParts = { recollection: [], learned: [], next: [] };
  let part: keyof JournalParts = "recollection";
  let open = false;
  const add = (line: string) => {
    if (!line) return;
    if (part !== "recollection") parts[part].push(line.replace(BULLET, ""));
    else if (open && !BULLET.test(line)) parts.recollection[parts.recollection.length - 1] += ` ${line}`;
    else parts.recollection.push(line.replace(BULLET, ""));
    open = true;
  };
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    const head = PART.exec(line);
    if (head) {
      const name = head[1]!.toLowerCase();
      part = name === "happened" ? "recollection" : (name as "learned" | "next");
      open = false;
      add(head[2]!.trim());
    } else if (!line) open = false;
    else add(line);
  }
  return parts;
}

const WRITTEN = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" });

/** A day written out as Denmark writes dates, the day before the month: "Wednesday 11 November 2026". Anything else comes back as it is. */
export function journalDate(day: string): string {
  if (!JOURNAL_DAY.test(day)) return day;
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return day;
  const p: Record<string, string> = {};
  for (const part of WRITTEN.formatToParts(date)) p[part.type] = part.value;
  return `${p.weekday} ${p.day} ${p.month} ${p.year}`;
}
