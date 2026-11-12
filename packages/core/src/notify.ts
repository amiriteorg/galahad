import { sha256 } from "@noble/hashes/sha2.js";
import { b64u, utf8 } from "./bytes.ts";
import { journalDate } from "./journal.ts";
import { isTimeZone, zonedParts } from "./schedule.ts";
import { findSecrets } from "./secret-scan.ts";
import { isConversationId, isNotifyTag, NOTIFY_BODY_MAX, NOTIFY_KINDS, NOTIFY_TITLE_MAX, notifyClean, type NotifyKind, type NotifyOpen, type NotifyPayload } from "./notify-payload.ts";

export * from "./notify-payload.ts";

/*
 * He comes to you: notifications to your own paired devices (Web Push; webpush.ts).
 *
 * This file is the contract and the rules, all pure: the kinds and their switches, quiet
 * hours and the day's limit, what a notification may say (a short title, one line, where
 * it opens: never a secret, never anything about the bank, never a model's free text),
 * the small payload the service worker turns into a notification, and which push
 * services a node may call.
 *
 * No zod here: the PWA and its service worker read from this file. What the node takes
 * from a device is checked in notify-input.ts.
 */

/* ---------- kinds, and the owner's switches ---------- */

export const NOTIFY_KIND_INFO: Record<NotifyKind, { label: string; hint: string; on: boolean }> = {
  "needs-you": { label: "Something needs you", hint: "A warning or an alert from his heartbeat: once per finding, not again while it stands.", on: true },
  approval: { label: "An approval is waiting", hint: "Something he or an agent wants to send or delete, filed for your answer.", on: true },
  finished: { label: "He has finished", hint: "A chat turn nobody was watching, or a quest or experiment you started: done, unverified, gave up or failed, said as it is.", on: true },
  question: { label: "He has a question", hint: "An answer that ends by asking you, or a key he needs.", on: true },
  journal: { label: "His journal is written", hint: "Once each evening.", on: false },
};

export interface QuietHours {
  on: boolean;
  /** HH:MM, in `tz`. From the one to the other, across midnight when `to` is the earlier. */
  from: string;
  to: string;
  tz: string;
}

export interface NotifyPrefs {
  kinds: Record<NotifyKind, boolean>;
  /** Everything but an alert waits until they end, then one message says what waited. */
  quiet: QuietHours;
  /** At most this many notifications a day; when it's reached, one last message says so. */
  perDay: number;
}

export const NOTIFY_PER_DAY = { min: 1, max: 50, default: 12 } as const;
export const NOTIFY_DEFAULTS: NotifyPrefs = {
  kinds: { "needs-you": true, approval: true, finished: true, question: true, journal: false },
  quiet: { on: true, from: "22:00", to: "07:00", tz: "Europe/Copenhagen" },
  perDay: NOTIFY_PER_DAY.default,
};

export const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Stored preferences, read leniently: whatever doesn't read as a setting is the default. */
export function readNotifyPrefs(raw: unknown): NotifyPrefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as { kinds?: Record<string, unknown>; quiet?: Record<string, unknown>; perDay?: unknown };
  const kinds = { ...NOTIFY_DEFAULTS.kinds };
  for (const kind of NOTIFY_KINDS) if (typeof r.kinds?.[kind] === "boolean") kinds[kind] = r.kinds[kind] as boolean;
  const q = r.quiet ?? {};
  const clock = (value: unknown, fallback: string) => (typeof value === "string" && CLOCK.test(value) ? value : fallback);
  return {
    kinds,
    quiet: {
      on: typeof q.on === "boolean" ? q.on : NOTIFY_DEFAULTS.quiet.on,
      from: clock(q.from, NOTIFY_DEFAULTS.quiet.from),
      to: clock(q.to, NOTIFY_DEFAULTS.quiet.to),
      tz: typeof q.tz === "string" && isTimeZone(q.tz) ? q.tz : NOTIFY_DEFAULTS.quiet.tz,
    },
    perDay: typeof r.perDay === "number" && Number.isInteger(r.perDay) && r.perDay >= NOTIFY_PER_DAY.min && r.perDay <= NOTIFY_PER_DAY.max ? r.perDay : NOTIFY_DEFAULTS.perDay,
  };
}

const minutes = (clock: string): number => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));

/** Whether an instant falls in the quiet hours (from inclusive, to exclusive; across midnight when `to` is earlier). */
export function inQuietHours(quiet: QuietHours, now: number): boolean {
  if (!quiet.on || !CLOCK.test(quiet.from) || !CLOCK.test(quiet.to) || quiet.from === quiet.to || !isTimeZone(quiet.tz)) return false;
  const parts = zonedParts(now, quiet.tz);
  const at = parts.hour * 60 + parts.minute;
  const from = minutes(quiet.from);
  const to = minutes(quiet.to);
  return from < to ? at >= from && at < to : at >= from || at < to;
}

const dayFormats = new Map<string, Intl.DateTimeFormat>();
/** The calendar day an instant falls on in a zone, YYYY-MM-DD: the day the limit counts. */
export function notifyDay(now: number, tz: string): string {
  const zone = isTimeZone(tz) ? tz : NOTIFY_DEFAULTS.quiet.tz;
  let format = dayFormats.get(zone);
  if (!format) dayFormats.set(zone, (format = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" })));
  const p: Record<string, string> = {};
  for (const part of format.formatToParts(now)) p[part.type] = part.value;
  return `${p.year}-${p.month}-${p.day}`;
}

/* ---------- what he may say: one item per thing worth telling ---------- */

export interface NotifyItem {
  /** Told once: "notice:<key>", "action:<id>", "secret:<name>", "turn:<id>", "quest:<id>", "experiment:<id>", "journal:<day>". */
  key: string;
  kind: NotifyKind;
  /** An alert isn't held by quiet hours. */
  alert: boolean;
  title: string;
  body: string;
  open: NotifyOpen;
  conversation?: string;
  /** Scopes a device must hold to be told (what it could see in the app anyway). */
  needs: string[];
}

/** A line that may be shown: cleaned and cut; null when it looks like it holds a secret (the caller says something general instead). */
export function notifyLine(text: string, max = NOTIFY_BODY_MAX): string | null {
  const line = notifyClean(text, max);
  if (!line || findSecrets(line).length) return null;
  return line;
}

const INBOX_NEEDS_YOU = "Something in your Inbox needs you.";
/** Notices whose titles are the node's own fixed words around names (never a model's sentence). */
const TITLED_SOURCES = /^(heartbeat|archive|compute|loop:[a-z0-9][a-z0-9._-]{0,39})$/;
const ABOUT_BANK = /\bbank|\bconsent\b|\baccounts?\b|\bbalances?\b|\btransactions?\b/i;

/**
 * A finding that needs you: a notice of warn or alert that you haven't dismissed. Its own title is shown
 * (bounded and redacted when it was raised, scanned again here) when the node wrote it from a fixed
 * sentence; anything about the bank, and any notice whose title could be a model's words, says only that
 * something in the Inbox needs you.
 */
export function noticeItem(n: { key: string; severity: string; title: string; source: string; dismissed: boolean }): NotifyItem | null {
  if (n.dismissed || (n.severity !== "warn" && n.severity !== "alert")) return null;
  const alert = n.severity === "alert";
  const bank = n.key.startsWith("bank") || n.source === "bank" || ABOUT_BANK.test(n.title);
  const line = !bank && TITLED_SOURCES.test(n.source) ? notifyLine(n.title) : null;
  return { key: `notice:${n.key}`, kind: "needs-you", alert, title: alert ? "Galahad: alert" : "Galahad: this needs you", body: line ?? INBOX_NEEDS_YOU, open: "inbox", needs: ["mind:read"] };
}

/** How long an action must have waited before it's told: one that a standing order answers at once never is. */
export const ACTION_SETTLE_MS = 5_000;
const TOOL_REF = /^[a-z][a-z0-9-]{0,39}\.[a-z][a-z0-9_.-]{0,47}$/;

/** An approval waiting for your answer: which tool (its name is the manifest's, bounded), never the arguments or the reason given. */
export function actionItem(a: { id: string; connector: string; tool: string; state: string; requestedMs: number; expires: number }, now: number): NotifyItem | null {
  if (a.state !== "waiting" || a.expires <= now || now - a.requestedMs < ACTION_SETTLE_MS) return null;
  const tool = `${a.connector}.${a.tool}`;
  return {
    key: `action:${a.id}`,
    kind: "approval",
    alert: false,
    title: "Galahad asks your approval",
    body: TOOL_REF.test(tool) ? `${tool} is waiting for your answer in the Inbox.` : "An action is waiting for your answer in the Inbox.",
    open: "inbox",
    needs: ["mind:read"],
  };
}

/** A key he asked for: its name (letters, digits, . _ : -), never what it's for (that's a model's sentence). */
export function secretItem(name: string): NotifyItem | null {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(name)) return null;
  return { key: `secret:${name}`, kind: "question", alert: false, title: "Galahad asks for a key", body: notifyClean(`${name}: fill it in the Vault. He learns only that it's there.`, NOTIFY_BODY_MAX), open: "inbox", needs: ["vault:read"] };
}

/**
 * A chat turn that ended with nobody watching: finished, couldn't finish, or ended by asking you.
 * The chat's title is yours (your first message, or the name you gave it); a chat where he read the
 * bank is told without it, and only to devices that may read the bank.
 */
export function turnItem(t: { id: string; conversation: string; title: string; bank: boolean; state: "done" | "error"; question: boolean; waiting: boolean }): NotifyItem | null {
  if (!isConversationId(t.conversation)) return null;
  const title = t.bank ? null : notifyLine(t.title, 90);
  const where = title ? `“${title}”` : "A chat you left him working in";
  const asks = t.state === "done" && t.question;
  return {
    key: `turn:${t.id}`,
    kind: asks ? "question" : "finished",
    alert: false,
    title: t.state === "error" ? "Galahad couldn't finish" : asks ? "Galahad has a question for you" : "Galahad has finished",
    body: notifyClean(t.state === "error" ? `${where} ended with an error. Nothing is retried.` : t.waiting ? `${where}: it waits on your answer in the Inbox.` : `${where}.`, NOTIFY_BODY_MAX),
    open: "chat",
    conversation: t.conversation,
    needs: t.bank ? ["chat", "bank:read"] : ["chat"],
  };
}

const QUEST_ENDS: Record<string, string> = { done: "Quest done", unverified: "Quest ended unverified", "gave-up": "Quest gave up", failed: "Quest failed" };

/** A quest you started that has ended, said as it ended. One you stopped yourself isn't news. The goal is your own words. */
export function questItem(q: { quest: string; goal: string; state: string }): NotifyItem | null {
  const title = QUEST_ENDS[q.state];
  if (!title || !/^[A-Za-z0-9._:-]{1,64}$/.test(q.quest)) return null;
  const goal = notifyLine(q.goal, 110);
  return { key: `quest:${q.quest}`, kind: "finished", alert: false, title, body: goal ? `“${goal}”` : "A quest you started has ended.", open: "overview", needs: ["mind:read"] };
}

/** An experiment you started that has ended. Its title is a script's, so it isn't shown. */
export function experimentItem(e: { id: string; status: "done" | "failed" }): NotifyItem | null {
  if (!/^[A-Za-z0-9._:-]{1,64}$/.test(e.id)) return null;
  return { key: `experiment:${e.id}`, kind: "finished", alert: false, title: e.status === "done" ? "Experiment done" : "Experiment failed", body: "An experiment you started has ended. It's saved in the SANDBOX.", open: "overview", needs: ["mind:read"] };
}

/** His journal for a day is written. The day, never a word of the entry. */
export function journalItem(day: string): NotifyItem | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  return { key: `journal:${day}`, kind: "journal", alert: false, title: "His journal is written", body: notifyClean(journalDate(day), NOTIFY_BODY_MAX), open: "journal", needs: ["mind:read"] };
}

/* ---------- when he speaks, and when he stays silent ---------- */

/** Between two messages that aren't alerts: what comes in meanwhile is told together. */
export const NOTIFY_GAP_MS = 60_000;

export interface NotifyPlan {
  /** What to tell now, as one message (empty: stay silent). */
  send: NotifyItem[];
  /** Why the rest waits: quiet hours, the day's limit, or too soon after the last message. */
  waiting: "quiet" | "limit" | "gap" | null;
  /** This message reaches the day's limit: one last message says so, then silence until tomorrow. */
  limit: boolean;
}

/**
 * What to tell at this moment. Never anything for "all quiet": with nothing new there is nothing to send.
 * Everything new goes as one message (a burst is one buzz); quiet hours hold everything but alerts, and
 * what was held is told together when they end; the day's limit holds everything, alerts too.
 * `told`: the items already told (an alert is told again when it was told only as a warning).
 */
export function planNotifications(input: {
  now: number;
  prefs: NotifyPrefs;
  items: readonly NotifyItem[];
  told: ReadonlyMap<string, { alert: boolean }>;
  sentToday: number;
  lastSentAt: number | null;
}): NotifyPlan {
  const fresh = input.items.filter((item) => {
    if (!input.prefs.kinds[item.kind]) return false;
    const before = input.told.get(item.key);
    return !before || (item.alert && !before.alert);
  });
  if (!fresh.length) return { send: [], waiting: null, limit: false };
  if (input.sentToday >= input.prefs.perDay) return { send: [], waiting: "limit", limit: false };
  const quiet = inQuietHours(input.prefs.quiet, input.now);
  const due = quiet ? fresh.filter((item) => item.alert) : fresh;
  if (!due.length) return { send: [], waiting: "quiet", limit: false };
  const urgent = due.some((item) => item.alert);
  if (!urgent && input.lastSentAt !== null && input.now - input.lastSentAt < NOTIFY_GAP_MS) return { send: [], waiting: "gap", limit: false };
  return { send: due, waiting: quiet && due.length < fresh.length ? "quiet" : null, limit: input.sentToday + 1 >= input.prefs.perDay };
}

const counted = (n: number, one: string, many: string): string => (n === 1 ? one : many.replace("%", String(n)));

/** One message for what's told now: the item itself when it's one, otherwise how many of each kind, without their words. */
export function notifyMessage(items: readonly NotifyItem[]): NotifyPayload | null {
  if (!items.length) return null;
  if (items.length === 1) {
    const item = items[0]!;
    return { v: 1, kind: item.kind, title: notifyClean(item.title, NOTIFY_TITLE_MAX), body: notifyClean(item.body, NOTIFY_BODY_MAX), open: item.open, ...(item.conversation ? { conversation: item.conversation } : {}), tag: tagOf(item.key) };
  }
  const count = (kind: NotifyKind) => items.filter((item) => item.kind === kind).length;
  const parts = [
    count("needs-you") ? counted(count("needs-you"), "1 thing needs you", "% things need you") : null,
    count("approval") ? counted(count("approval"), "1 approval is waiting", "% approvals are waiting") : null,
    count("question") ? counted(count("question"), "he has a question", "he has % questions") : null,
    count("finished") ? counted(count("finished"), "he finished 1 piece of work", "he finished % pieces of work") : null,
    count("journal") ? "his journal is written" : null,
  ].filter((part): part is string => part !== null);
  const body = parts.join(", ");
  // One place when they all open the same one; otherwise the Inbox, where what needs you is.
  const opens = new Set(items.map((item) => item.open));
  const open = opens.size === 1 ? items[0]!.open : "inbox";
  return {
    v: 1,
    kind: "summary",
    title: items.some((item) => item.alert) ? "Galahad: alert" : `Galahad: ${items.length} things`,
    body: notifyClean(`${body.charAt(0).toUpperCase()}${body.slice(1)}.`, NOTIFY_BODY_MAX),
    open: open === "chat" ? "overview" : open,
    tag: "summary",
  };
}

/**
 * A notification's tag from an item's key: the same finding told again replaces its old notification.
 * A digest, never the key itself: a key names what it's about ("bank-consent:…"), and a payload doesn't.
 */
export function tagOf(key: string): string {
  const tag = `t-${b64u(sha256(utf8(key))).slice(0, 22)}`;
  return isNotifyTag(tag) ? tag : "galahad";
}

export const limitMessage = (perDay: number): NotifyPayload => ({
  v: 1,
  kind: "limit",
  title: "Galahad: quiet until tomorrow",
  body: `That's ${perDay} ${perDay === 1 ? "notification" : "notifications"} today, the most you allow. The rest waits in your Inbox.`,
  open: "inbox",
  tag: "limit",
});

export const testMessage = (device: string): NotifyPayload => ({
  v: 1,
  kind: "test",
  title: "Galahad",
  body: notifyClean(`This is a test. Notifications reach ${notifyLine(device, 40) ?? "this device"}.`, NOTIFY_BODY_MAX),
  open: "settings",
  tag: "test",
});

/* ---------- where a notification may be sent: push services, and nothing else ---------- */

/** The push services browsers use. A subscription that names any other host is refused unless the owner allowed it. */
const PUSH_SERVICES: { name: string; hosts: string[]; suffixes: string[] }[] = [
  { name: "Apple", hosts: ["web.push.apple.com"], suffixes: [".push.apple.com"] },
  { name: "Google", hosts: ["fcm.googleapis.com", "jmt17.google.com"], suffixes: [] },
  { name: "Mozilla", hosts: ["updates.push.services.mozilla.com"], suffixes: [".push.services.mozilla.com"] },
  { name: "Microsoft", hosts: [], suffixes: [".notify.windows.com"] },
];

export type PushServiceVerdict = { ok: true; service: string; origin: string } | { ok: false; why: string };

/**
 * Whether an endpoint is a push service a node may call: https, no credentials in it, the default port,
 * and a host that is one of the known services' (Apple, Google, Mozilla, Microsoft) or one the owner
 * allowed (`allowed`: a host name, "*.suffix", or a whole origin, which is how a test names a stand-in
 * on this machine). The answer names the service, never the endpoint.
 */
export function pushService(endpoint: string, allowed: readonly string[] = []): PushServiceVerdict {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return { ok: false, why: "the subscription's endpoint isn't a URL" };
  }
  if (url.username || url.password) return { ok: false, why: "the subscription's endpoint carries credentials" };
  const host = url.hostname.toLowerCase();
  // An origin the owner named whole (scheme, host and port) is taken as it is: a stand-in push service in a test.
  if (allowed.some((entry) => /^https?:\/\//.test(entry) && entry.replace(/\/$/, "") === url.origin)) return { ok: true, service: "a push service you allowed", origin: url.origin };
  if (url.protocol !== "https:") return { ok: false, why: "a push service is reached over https" };
  if (url.port && url.port !== "443") return { ok: false, why: "a push service is reached on the standard https port" };
  for (const service of PUSH_SERVICES) {
    if (service.hosts.includes(host) || service.suffixes.some((suffix) => host.endsWith(suffix) && host.length > suffix.length)) return { ok: true, service: service.name, origin: url.origin };
  }
  for (const entry of allowed) {
    if (/^https?:\/\//.test(entry)) continue;
    const pattern = entry.toLowerCase();
    if (pattern === host || (pattern.startsWith("*.") && host.endsWith(pattern.slice(1)) && host.length > pattern.length - 1)) return { ok: true, service: "a push service you allowed", origin: url.origin };
  }
  return { ok: false, why: `${host} isn't a push service this node knows (Apple, Google, Mozilla, Microsoft); allow another with GALAHAD_PUSH_HOSTS on the node` };
}

/* ---------- what the app and the terminal read ---------- */

export interface NotifyDeviceView {
  /** The paired device's id, and its name. */
  device: string;
  name: string;
  /** The push service it's reached through, by name (never its endpoint). */
  service: string;
  since: number;
  /** When a notification last reached its push service, and the last failure if it failed since. */
  lastOk: number | null;
  lastError: string | null;
}

export interface NotifySentView {
  at: number;
  kind: NotifyPayload["kind"];
  /** The devices it went to, by name. */
  devices: string[];
  ok: boolean;
}

export interface NotifyView {
  node: string;
  /** This node's public key for subscribing (a browser's applicationServerKey). Public by nature. */
  key: string;
  prefs: NotifyPrefs;
  devices: NotifyDeviceView[];
  /** Whether the device asking is subscribed (null: asked from a terminal). */
  subscribed: boolean | null;
  /** Today, in the quiet hours' zone: what was sent, and how much of the day's limit is used. */
  today: { day: string; sent: NotifySentView[]; count: number; limit: number };
  /** It's quiet hours now; how many things wait for them to end. */
  quiet: boolean;
  held: number;
}
