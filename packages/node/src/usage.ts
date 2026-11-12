import type { Database } from "bun:sqlite";
import { type Price, PriceSchema, type Usage, type UsageRow } from "@galahad/core";
import type { MindStore } from "@galahad/mind";

/*
 * This node's own count of its model calls: for each day, who asked, the role and the
 * model, how many calls and their tokens as the providers reported them. Node-local
 * (the home's local database, never the mind's log): it is telemetry about this
 * node's calls, a row per day and model, and nothing any replica decides on. What must
 * be the same everywhere (your prices, what a trial spent) is in the log instead.
 *
 * Counts only. Nothing of a prompt or an answer ever reaches this table.
 */

/** Days of rows kept (older ones are dropped as new ones are written). */
export const USAGE_KEEP_DAYS = 400;

const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export class UsageStore {
  private lastPruned = "";

  constructor(
    private readonly db: Database,
    private readonly now: () => number = Date.now,
  ) {
    db.exec(`CREATE TABLE IF NOT EXISTS usage_daily (
      day TEXT NOT NULL, who TEXT NOT NULL, role TEXT NOT NULL, model TEXT NOT NULL,
      calls INTEGER NOT NULL DEFAULT 0, unknown INTEGER NOT NULL DEFAULT 0,
      input INTEGER NOT NULL DEFAULT 0, output INTEGER NOT NULL DEFAULT 0,
      cached INTEGER NOT NULL DEFAULT 0, reasoning INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, who, role, model))`);
  }

  /** One model call that ended: its tokens as the provider reported them, or null when it reported nothing. */
  note(who: string, role: string, model: string, usage: Usage | null): void {
    const day = dayOf(this.now());
    const n = (x: number | undefined): number => (typeof x === "number" && Number.isFinite(x) && x > 0 ? Math.floor(x) : 0);
    const input = usage ? n(usage.input) : 0;
    const output = usage ? n(usage.output) : 0;
    this.db
      .query(
        `INSERT INTO usage_daily (day, who, role, model, calls, unknown, input, output, cached, reasoning) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
         ON CONFLICT (day, who, role, model) DO UPDATE SET calls = calls + 1, unknown = unknown + excluded.unknown,
           input = input + excluded.input, output = output + excluded.output, cached = cached + excluded.cached, reasoning = reasoning + excluded.reasoning`,
      )
      .run(day, who.slice(0, 100), role.slice(0, 40), model.slice(0, 200), usage ? 0 : 1, input, output, usage ? Math.min(n(usage.cached), input) : 0, usage ? Math.min(n(usage.reasoning), output) : 0);
    if (day !== this.lastPruned) {
      this.lastPruned = day;
      this.db.query("DELETE FROM usage_daily WHERE day < ?").run(dayOf(this.now() - USAGE_KEEP_DAYS * 86_400_000));
    }
  }

  /** The rows of the last `days` days (today included), newest day first. */
  rows(days: number): { since: string; rows: UsageRow[] } {
    const since = dayOf(this.now() - (Math.max(1, Math.floor(days)) - 1) * 86_400_000);
    const rows = this.db
      .query<UsageRow, [string]>("SELECT day, who, role, model, calls, unknown, input, output, cached, reasoning FROM usage_daily WHERE day >= ? ORDER BY day DESC, who, role, model")
      .all(since);
    return { since, rows };
  }
}

/** Your prices as the mind holds them: the latest for each model, read leniently (one a newer node wrote in a shape this one can't read is left out). */
export function pricesOf(store: Pick<MindStore, "lwwPrefix">): Record<string, Price> {
  const prices: Record<string, Price> = {};
  for (const entry of store.lwwPrefix<unknown>("price:")) {
    if (entry.value === null || entry.value === undefined) continue;
    const price = PriceSchema.safeParse(entry.value);
    if (price.success) prices[entry.key.slice("price:".length)] = price.data;
  }
  return prices;
}
