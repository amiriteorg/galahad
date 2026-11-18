/*
 * When a loop runs: "every 30m", "every 2h", "every 1d", a five-field cron
 * line ("0 7 * * 1-5") read in an IANA time zone, or "never" (only what wakes
 * it: a webhook, new mail, a GitHub event). Pure and deterministic: the
 * same schedule, zone and instant always give the same next run, on any node.
 *
 * Intervals are aligned to the clock (every 30m runs at :00 and :30 UTC), so a
 * restart never shifts them. Cron follows Vixie cron: when both day-of-month and
 * day-of-week are restricted, a day matching either runs.
 */

export type Schedule =
  | { kind: "never"; text: "never" }
  | { kind: "every"; ms: number; text: string }
  | {
      kind: "cron";
      text: string;
      minute: ReadonlySet<number>;
      hour: ReadonlySet<number>;
      dom: ReadonlySet<number>;
      month: ReadonlySet<number>;
      dow: ReadonlySet<number>;
      domRestricted: boolean;
      dowRestricted: boolean;
    };

export class ScheduleError extends Error {}

const MINUTE = 60_000;
const UNITS: Record<string, number> = { m: MINUTE, h: 60 * MINUTE, d: 24 * 60 * MINUTE };
/** The shortest interval a loop may have. */
export const MIN_INTERVAL_MS = MINUTE;
const MAX_INTERVAL_MS = 366 * UNITS.d!;

const ALIASES: Record<string, string> = {
  "@hourly": "0 * * * *",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@weekly": "0 0 * * 0",
  "@monthly": "0 0 1 * *",
};
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function field(text: string, min: number, max: number, names: string[] = [], nameBase = min): { values: Set<number>; restricted: boolean } {
  const values = new Set<number>();
  const value = (token: string): number => {
    const named = names.indexOf(token.toLowerCase());
    if (named >= 0) return named + nameBase;
    if (!/^\d{1,2}$/.test(token)) throw new ScheduleError(`"${token}" is not a number`);
    const n = Number(token);
    if (n < min || n > max) throw new ScheduleError(`${n} is outside ${min}-${max}`);
    return n;
  };
  for (const part of text.split(",")) {
    const [range, stepText, extra] = part.split("/");
    if (extra !== undefined || range === undefined || range === "") throw new ScheduleError(`bad cron field "${text}"`);
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1 || step > max) throw new ScheduleError(`bad step in "${part}"`);
    let lo: number;
    let hi: number;
    if (range === "*") [lo, hi] = [min, max];
    else if (range.includes("-")) {
      const [a, b, more] = range.split("-");
      if (more !== undefined || !a || !b) throw new ScheduleError(`bad range "${range}"`);
      [lo, hi] = [value(a), value(b)];
      if (lo > hi) throw new ScheduleError(`range "${range}" runs backwards`);
    } else {
      lo = value(range);
      hi = stepText === undefined ? lo : max;
    }
    for (let n = lo; n <= hi; n += step) values.add(n);
  }
  return { values, restricted: text !== "*" };
}

export function parseSchedule(input: string): Schedule {
  const text = input.trim().replace(/\s+/g, " ");
  if (/^never$/i.test(text)) return { kind: "never", text: "never" };
  const every = text.match(/^every (\d{1,4}) ?([mhd])$/i);
  if (every) {
    const ms = Number(every[1]) * UNITS[every[2]!.toLowerCase()]!;
    if (ms < MIN_INTERVAL_MS) throw new ScheduleError("loops run at most once a minute");
    if (ms > MAX_INTERVAL_MS) throw new ScheduleError("use a cron line for anything rarer than yearly");
    return { kind: "every", ms, text: `every ${every[1]}${every[2]!.toLowerCase()}` };
  }
  const line = ALIASES[text.toLowerCase()] ?? text;
  const parts = line.split(" ");
  if (parts.length !== 5) throw new ScheduleError('use "every 30m" (m, h or d) or a five-field cron line such as "0 7 * * 1-5"');
  const [mi, ho, dm, mo, dw] = parts as [string, string, string, string, string];
  const dow = field(dw, 0, 7, DAYS, 0);
  if (dow.values.delete(7)) dow.values.add(0); // 7 is Sunday too
  const dom = field(dm, 1, 31);
  return {
    kind: "cron",
    text,
    minute: field(mi, 0, 59).values,
    hour: field(ho, 0, 23).values,
    dom: dom.values,
    month: field(mo, 1, 12, MONTHS, 1).values,
    dow: dow.values,
    domRestricted: dom.restricted,
    dowRestricted: dow.restricted,
  };
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      weekday: "short",
    });
    formatters.set(tz, f);
  }
  return f;
}

export function isTimeZone(tz: string): boolean {
  if (!/^[A-Za-z0-9_+\-/]{1,64}$/.test(tz)) return false;
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock parts of an instant in a zone. */
export function zonedParts(ms: number, tz: string): { month: number; day: number; hour: number; minute: number; dow: number } {
  const parts: Record<string, string> = {};
  for (const p of formatter(tz).formatToParts(ms)) parts[p.type] = p.value;
  return {
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    dow: DAYS.indexOf(parts.weekday!.slice(0, 3).toLowerCase()),
  };
}

/** The first run strictly after `after`, or null if the schedule never runs (say, 31 February). */
export function nextRun(schedule: Schedule, after: number, tz = "UTC"): number | null {
  if (schedule.kind === "never") return null;
  if (schedule.kind === "every") return Math.floor(after / schedule.ms) * schedule.ms + schedule.ms;
  let t = Math.floor(after / MINUTE) * MINUTE + MINUTE;
  // Skip whole days, then hours, then minutes. Stepping from wall-clock parts each
  // time corrects itself across daylight-saving shifts and odd offsets (+05:30).
  for (let guard = 0; guard < 200_000; guard++) {
    const p = zonedParts(t, tz);
    const domOk = schedule.dom.has(p.day);
    const dowOk = schedule.dow.has(p.dow);
    const dayOk =
      schedule.month.has(p.month) &&
      (schedule.domRestricted && schedule.dowRestricted ? domOk || dowOk : domOk && dowOk);
    if (!dayOk) t += ((23 - p.hour) * 60 + (60 - p.minute)) * MINUTE;
    else if (!schedule.hour.has(p.hour)) t += (60 - p.minute) * MINUTE;
    else if (!schedule.minute.has(p.minute)) t += MINUTE;
    else return t;
    if (t - after > 5 * 366 * UNITS.d!) return null;
  }
  return null;
}

/** A loop catches up at most this far back after its node was away. */
export const CATCH_UP_MS = 7 * UNITS.d!;

/**
 * The run that is due now: the latest scheduled time in (since, now], or null.
 * Missed runs are not replayed one by one; a node that was away runs once.
 */
export function dueRun(schedule: Schedule, since: number, now: number, tz = "UTC"): number | null {
  if (schedule.kind === "never") return null;
  if (schedule.kind === "every") {
    const slot = Math.floor(now / schedule.ms) * schedule.ms;
    return slot > since ? slot : null;
  }
  let due: number | null = null;
  let t = Math.max(since, now - CATCH_UP_MS);
  for (;;) {
    const next = nextRun(schedule, t, tz);
    if (next === null || next > now) return due;
    due = next;
    t = next;
  }
}
