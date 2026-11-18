import { Database } from "bun:sqlite";
import { closeSync, existsSync, openSync } from "node:fs";
import { type NotifyItem, type NotifyPayload, type NotifyPrefs, readNotifyPrefs } from "@galahad/core";

/*
 * What this node keeps for notifications, in its own private database (push.db, mode
 * 600 in the node's 700 home, never replicated, like chat history):
 *
 *   subscriptions  one per paired device: where its push service takes messages for it,
 *                  and the two keys messages are encrypted to. The endpoint is a
 *                  capability, so it lives here and nowhere else: not in the mind, not
 *                  in a log line, not in any answer a route gives.
 *   settings       what he sends and when he stays silent (kinds, quiet hours, the limit).
 *   told           what was already told, so a finding is told once and not again while
 *                  it stands.
 *   pending        things that happened and wait to be told (a turn that ended at night).
 *   sent           what was sent, by kind and device: never a title or a line.
 *
 * `secure_delete` overwrites what a removed subscription held.
 */

export interface Subscription {
  device: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  /** The push service by name (Apple, Google, …), for what's shown. */
  service: string;
  createdAt: number;
  updatedAt: number;
  lastOk: number | null;
  lastError: string | null;
  failures: number;
}

export interface ToldRow {
  alert: boolean;
  at: number;
  /** When what it was about went away (null: it still stands). */
  goneAt: number | null;
}

export interface SentRow {
  at: number;
  kind: NotifyPayload["kind"];
  devices: string[];
  ok: boolean;
}

interface SubscriptionRecord {
  device: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  service: string;
  created_at: number;
  updated_at: number;
  last_ok: number | null;
  last_error: string | null;
  failures: number;
}

/** Sends that don't count against the day's limit: your own test, and the message that says the limit was reached. */
const UNCOUNTED = "('test', 'limit')";
const KEEP_SENT_MS = 30 * 24 * 60 * 60_000;

export class NotifyStore {
  private readonly db: Database;

  constructor(
    path: string,
    private readonly now: () => number = Date.now,
    /** The node's own time zone: quiet hours are read in it until you set one. */
    private readonly zone: string = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  ) {
    if (path !== ":memory:" && !existsSync(path)) closeSync(openSync(path, "wx", 0o600));
    this.db = new Database(path);
    this.db.exec("PRAGMA secure_delete = ON;");
    this.db.exec(`CREATE TABLE IF NOT EXISTS subscriptions (
        device TEXT PRIMARY KEY, endpoint TEXT NOT NULL UNIQUE, p256dh TEXT NOT NULL, auth TEXT NOT NULL, service TEXT NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_ok INTEGER, last_error TEXT, failures INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS told (key TEXT PRIMARY KEY, alert INTEGER NOT NULL, at INTEGER NOT NULL, gone_at INTEGER);
      CREATE TABLE IF NOT EXISTS pending (key TEXT PRIMARY KEY, item TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sent (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, devices TEXT NOT NULL, ok INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS sent_by_day ON sent (day, id);`);
  }

  close(): void {
    this.db.close();
  }

  /* ---------- subscriptions ---------- */

  private static view(r: SubscriptionRecord): Subscription {
    return { device: r.device, endpoint: r.endpoint, p256dh: r.p256dh, auth: r.auth, service: r.service, createdAt: r.created_at, updatedAt: r.updated_at, lastOk: r.last_ok, lastError: r.last_error, failures: r.failures };
  }

  subscriptions(): Subscription[] {
    return this.db.query<SubscriptionRecord, []>("SELECT * FROM subscriptions ORDER BY rowid").all().map(NotifyStore.view);
  }

  subscription(device: string): Subscription | null {
    const row = this.db.query<SubscriptionRecord, [string]>("SELECT * FROM subscriptions WHERE device = ?").get(device);
    return row ? NotifyStore.view(row) : null;
  }

  /** The device an endpoint is kept for, if any. */
  ownerOf(endpoint: string): string | null {
    return this.db.query<{ device: string }, [string]>("SELECT device FROM subscriptions WHERE endpoint = ?").get(endpoint)?.device ?? null;
  }

  /** This device's subscription, new or replacing its last one (it keeps the day it was first turned on). */
  put(device: string, sub: { endpoint: string; p256dh: string; auth: string; service: string }): Subscription {
    const at = this.now();
    this.db
      .query(
        `INSERT INTO subscriptions (device, endpoint, p256dh, auth, service, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (device) DO UPDATE SET endpoint = excluded.endpoint, p256dh = excluded.p256dh, auth = excluded.auth, service = excluded.service,
           updated_at = excluded.updated_at, last_error = NULL, failures = 0`,
      )
      .run(device, sub.endpoint, sub.p256dh, sub.auth, sub.service, at, at);
    return this.subscription(device)!;
  }

  /** This device's subscription answered at another endpoint than kept (an iPhone's token on Apple's other service): kept
   * there from now on. */
  move(device: string, endpoint: string, service: string): void {
    this.db.query("UPDATE subscriptions SET endpoint = ?, service = ?, updated_at = ? WHERE device = ?").run(endpoint, service, this.now(), device);
  }

  remove(device: string): boolean {
    return this.db.query("DELETE FROM subscriptions WHERE device = ?").run(device).changes > 0;
  }

  /** How a send to a device went. */
  mark(device: string, outcome: { ok: true } | { ok: false; error: string }): void {
    if (outcome.ok) this.db.query("UPDATE subscriptions SET last_ok = ?, last_error = NULL, failures = 0 WHERE device = ?").run(this.now(), device);
    else this.db.query("UPDATE subscriptions SET last_error = ?, failures = failures + 1 WHERE device = ?").run(outcome.error.slice(0, 200), device);
  }

  /* ---------- settings ---------- */

  prefs(): NotifyPrefs {
    const row = this.db.query<{ v: string }, []>("SELECT v FROM settings WHERE k = 'prefs'").get();
    if (!row) return readNotifyPrefs(null, this.zone);
    try {
      return readNotifyPrefs(JSON.parse(row.v), this.zone);
    } catch {
      return readNotifyPrefs(null, this.zone);
    }
  }

  setPrefs(prefs: NotifyPrefs): void {
    this.db.query("INSERT INTO settings (k, v) VALUES ('prefs', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v").run(JSON.stringify(prefs));
  }

  /** A setting of the node's own, by name (null: never set). */
  setting(key: string): string | null {
    return this.db.query<{ v: string }, [string]>("SELECT v FROM settings WHERE k = ?").get(key)?.v ?? null;
  }

  setSetting(key: string, value: string): void {
    this.db.query("INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v").run(key, value);
  }

  /* ---------- what was told ---------- */

  told(): Map<string, ToldRow> {
    const rows = this.db.query<{ key: string; alert: number; at: number; gone_at: number | null }, []>("SELECT key, alert, at, gone_at FROM told").all();
    return new Map(rows.map((r) => [r.key, { alert: r.alert === 1, at: r.at, goneAt: r.gone_at }]));
  }

  tell(items: readonly Pick<NotifyItem, "key" | "alert">[]): void {
    const at = this.now();
    const put = this.db.query("INSERT INTO told (key, alert, at, gone_at) VALUES (?, ?, ?, NULL) ON CONFLICT (key) DO UPDATE SET alert = MAX(alert, excluded.alert), at = excluded.at, gone_at = NULL");
    this.db.transaction(() => {
      for (const item of items) put.run(item.key, item.alert ? 1 : 0, at);
    })();
  }

  /** What a told key was about has gone away (or is back): its record is kept a while, so a finding that flaps isn't told each time. */
  setGone(key: string, goneAt: number | null): void {
    this.db.query("UPDATE told SET gone_at = ? WHERE key = ?").run(goneAt, key);
  }

  forget(key: string): void {
    this.db.query("DELETE FROM told WHERE key = ?").run(key);
  }

  /* ---------- what waits to be told ---------- */

  pending(): { item: NotifyItem; at: number }[] {
    const out: { item: NotifyItem; at: number }[] = [];
    for (const row of this.db.query<{ item: string; at: number }, []>("SELECT item, at FROM pending ORDER BY at, key").all()) {
      try {
        out.push({ item: JSON.parse(row.item) as NotifyItem, at: row.at });
      } catch {
        /* not an item: left out */
      }
    }
    return out;
  }

  addPending(item: NotifyItem): void {
    this.db.query("INSERT OR REPLACE INTO pending (key, item, at) VALUES (?, ?, ?)").run(item.key, JSON.stringify(item), this.now());
  }

  dropPending(keys: readonly string[]): void {
    const drop = this.db.query("DELETE FROM pending WHERE key = ?");
    this.db.transaction(() => {
      for (const key of keys) drop.run(key);
    })();
  }

  /* ---------- what was sent ---------- */

  logSent(day: string, kind: NotifyPayload["kind"], devices: string[], ok: boolean): void {
    const at = this.now();
    this.db.query("INSERT INTO sent (at, day, kind, devices, ok) VALUES (?, ?, ?, ?, ?)").run(at, day, kind, JSON.stringify(devices), ok ? 1 : 0);
    this.db.query("DELETE FROM sent WHERE at < ?").run(at - KEEP_SENT_MS);
  }

  sentOn(day: string): SentRow[] {
    return this.db
      .query<{ at: number; kind: string; devices: string; ok: number }, [string]>("SELECT at, kind, devices, ok FROM sent WHERE day = ? ORDER BY id")
      .all(day)
      .map((r) => ({ at: r.at, kind: r.kind as SentRow["kind"], devices: JSON.parse(r.devices) as string[], ok: r.ok === 1 }));
  }

  /** How many notifications count against a day's limit so far. */
  countOn(day: string): number {
    return this.db.query<{ n: number }, [string]>(`SELECT COUNT(*) AS n FROM sent WHERE day = ? AND kind NOT IN ${UNCOUNTED}`).get(day)!.n;
  }

  /** When the last notification that counts was sent. */
  lastSentAt(): number | null {
    return this.db.query<{ at: number | null }, []>(`SELECT MAX(at) AS at FROM sent WHERE kind NOT IN ${UNCOUNTED}`).get()?.at ?? null;
  }

  /** How many tests were sent on a day. */
  testsOn(day: string): number {
    return this.db.query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM sent WHERE day = ? AND kind = 'test'").get(day)!.n;
  }

  /** When the last test was sent to anyone (tests are yours to send, a few seconds apart). */
  lastTestAt(): number | null {
    return this.db.query<{ at: number | null }, []>("SELECT MAX(at) AS at FROM sent WHERE kind = 'test'").get()?.at ?? null;
  }
}
