/*
 * A plan's allowance runs in windows (OpenCode Go: five hours, then a week, then a month). Once its provider has
 * said the window is spent and when it resets, asking it again before then only fails again, slowly, before the
 * next model is tried: on 14 November 2026 every call of a sweep did. So a node remembers each window it is told
 * of, chat passes that provider's models over without asking until the window ends (and says until when), and
 * then asks again. Kept in memory, a node's own: a restart forgets, and the next refusal teaches it again.
 */

/** One provider's allowance, spent until the time its provider gave. */
export interface SpentWindow {
  provider: string;
  /** When it resets (ms). */
  until: number;
  /** When it was told. */
  noted: number;
  /** What its provider said, as it said it (cut short). */
  said: string;
}

const UNIT: Record<string, number> = { d: 86_400_000, h: 3_600_000, m: 60_000, s: 1_000 };
const SPAN = String.raw`(?:\d+\s*(?:days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b\s*,?\s*(?:and\s+)?)+`;
const RESETS = new RegExp(String.raw`(?:resets?|renews?)\s+in\s+(${SPAN})`, "i");
const AGAIN = new RegExp(String.raw`try again in\s+(${SPAN})`, "i");

/**
 * When a provider's refusal says its allowance is spent and when that resets: the time it resets (ms), else null.
 * Only a refusal about an allowance or a limit, with a span ("resets in 1h 37m", "try again in 20s"), counts; a
 * clock time without a day or a zone ("Try again at 3:45 PM") is not read, and nothing more than a month away.
 */
export function spentUntil(error: string, now: number): number | null {
  if (!/\b429\b|limit|quota|allowance|exhausted/i.test(error)) return null;
  if (!/limit|quota|allowance|exhausted|spent/i.test(error)) return null;
  const span = (RESETS.exec(error) ?? AGAIN.exec(error))?.[1];
  if (!span) return null;
  let ms = 0;
  for (const [, n, unit] of span.matchAll(/(\d+)\s*([a-z]+)/gi)) ms += Number(n) * (UNIT[unit!.slice(0, 1).toLowerCase()] ?? 0);
  return ms > 0 && ms <= 31 * 86_400_000 ? now + ms : null;
}

/** HH:MM in UTC, and a span in hours and minutes: how a window is said. */
export const clockUtc = (at: number): string => new Date(at).toISOString().slice(11, 16);
export const spanWords = (ms: number): string => {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`;
};

export class SpentWindows {
  /** The clock (tests set their own). */
  now: () => number = Date.now;
  private readonly windows = new Map<string, SpentWindow>();

  /** Read a provider's refusal: when it says its allowance is spent and when it resets, remember that. */
  note(provider: string, error: string): SpentWindow | null {
    const noted = this.now();
    const until = spentUntil(error, noted);
    if (until === null) return null;
    const window: SpentWindow = { provider, until, noted, said: error.replace(/\s+/g, " ").slice(0, 300) };
    this.windows.set(provider, window);
    return window;
  }

  /** The window a provider is in now, or null (one that has ended is forgotten). */
  spent(provider: string): SpentWindow | null {
    const window = this.windows.get(provider);
    if (!window) return null;
    if (window.until <= this.now()) {
      this.windows.delete(provider);
      return null;
    }
    return window;
  }

  /** Every window open now. */
  list(): SpentWindow[] {
    return [...this.windows.keys()].map((provider) => this.spent(provider)).filter((w): w is SpentWindow => w !== null);
  }

  /** Why a provider's models are passed over now, in the words a fallback says. */
  why(window: SpentWindow): string {
    return `its allowance is spent until ${clockUtc(window.until)} UTC (${spanWords(window.until - this.now())} from now), as its provider said: passed over without asking`;
  }
}

const kept = new WeakMap<object, SpentWindows>();

/** A node's own record of spent allowances: one for each mind it keeps (a node keeps one). */
export function windowsOf(store: object): SpentWindows {
  let windows = kept.get(store);
  if (!windows) {
    windows = new SpentWindows();
    kept.set(store, windows);
  }
  return windows;
}
