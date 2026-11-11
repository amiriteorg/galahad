import { cleanCompanionName, companionNameProblem, type CompanionView, JOURNAL_DAY, journalDate, type JournalEntry, journalParts, type JournalView, type RouteName } from "@galahad/core";

/*
 * `galahad journal` and `galahad dog`: his journal read at a terminal, and his dog's
 * name. Thin: the node keeps both; this shapes input and prints.
 */

interface Api {
  call<T = any>(name: RouteName, input?: unknown): Promise<T>;
}

type Flags = Record<string, string | boolean | (string | boolean)[] | undefined>;

const tty = process.stdout.isTTY;
const dim = (s: string) => (tty ? `\x1b[2m${s}\x1b[0m` : s);
const bold = (s: string) => (tty ? `\x1b[1m${s}\x1b[0m` : s);

const NONE_YET = "He hasn't written in his journal yet. He writes every evening at 21:30, Denmark's time; `galahad loop run reflect` has him write today's now.";

/** An entry as a page at a terminal: the date written out, his recollection, what he learned, what he'd like to do. */
export function entryLines(entry: JournalEntry): string[] {
  const parts = journalParts(entry.text);
  return [
    `${bold(journalDate(entry.day))} ${dim(`· written ${new Date(entry.at).toLocaleString()}`)}`,
    ...parts.recollection.flatMap((p) => ["", p]),
    ...(parts.learned.length ? ["", bold("Learned"), ...parts.learned.map((l) => `  ${l}`)] : []),
    ...(parts.next.length ? ["", `${bold("Next")} ${dim("(his suggestions: they're in your inbox, and he does none on his own)")}`, ...parts.next.map((l) => `  · ${l}`)] : []),
  ];
}

/** A day's entry in a line, for the list: its date and how it opens. */
export function entryLine(entry: JournalEntry): string {
  const opening = journalParts(entry.text).recollection[0] ?? entry.text.split("\n")[0] ?? "";
  return `${entry.day}  ${opening.length > 90 ? `${opening.slice(0, 89)}…` : opening}`;
}

export async function journalCommand(api: Api, sub: string | undefined, flags: Flags): Promise<void> {
  if (flags.list) {
    const limit = typeof flags.limit === "string" ? Number(flags.limit) : 30;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("--limit takes a number from 1 to 100");
    const { entries, more } = await api.call<JournalView>("journal", { limit });
    if (!entries.length) console.log(NONE_YET);
    for (const entry of entries) console.log(entryLine(entry));
    if (more) console.log(dim(`Older ones: galahad journal --list --limit ${Math.min(100, limit * 2)}, or galahad journal <YYYY-MM-DD>`));
    return;
  }
  if (sub !== undefined && !JOURNAL_DAY.test(sub)) throw new Error("usage: galahad journal [<YYYY-MM-DD>] | galahad journal --list [--limit 30]");
  const { entries } = await api.call<JournalView>("journal", sub ? { day: sub } : { limit: 1 });
  if (!entries.length) console.log(sub ? `No journal entry for ${sub}. \`galahad journal --list\` shows the days he wrote.` : NONE_YET);
  else console.log(entryLines(entries[0]!).join("\n"));
}

const describeDog = (view: CompanionView) => (view.name ? `His dog is ${bold(view.name)}.` : `His dog has no name yet. \`galahad dog name <name>\` gives it one.`);

export async function dogCommand(api: Api, sub: string | undefined, rest: string[]): Promise<void> {
  if (sub === undefined) {
    console.log(describeDog(await api.call<CompanionView>("companion")));
    return;
  }
  if (sub === "unname" && !rest.length) {
    await api.call<CompanionView>("setCompanion", { name: null });
    console.log("His dog has no name now: it's the dog again, in the world and in his journal.");
    return;
  }
  if (sub !== "name" || !rest.length) throw new Error("usage: galahad dog | galahad dog name <name> | galahad dog unname");
  const name = cleanCompanionName(rest.join(" "));
  // The node checks it again; here it's said in words before anything is sent.
  const problem = companionNameProblem(name);
  if (problem) throw new Error(problem);
  const view = await api.call<CompanionView>("setCompanion", { name });
  console.log(`${describeDog(view)} Every device's world and his journal call it that from now on.`);
}
