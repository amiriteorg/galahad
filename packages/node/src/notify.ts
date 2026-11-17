import {
  actionItem,
  type ApplePushInput,
  connectorItem,
  inQuietHours,
  isP256Point,
  fromB64u,
  limitMessage,
  limitReached,
  noticeItem,
  toldItem,
  notifyDay,
  type NotifyDeviceView,
  type NotifyItem,
  notifyMessage,
  type NotifyPayload,
  type NotifyPrefs,
  type NotifyPrefsInput,
  type NotifyView,
  planNotifications,
  type PushSubscriptionInput,
  pushService,
  questInHand,
  questItem,
  type QuestView,
  randomId,
  redact,
  secretItem,
  testMessage,
  turnItem,
} from "@galahad/core";
import type { MindStore } from "@galahad/mind";
import type { LedgerEntryInput } from "@galahad/sandbox";
import type { KeptSummary } from "./chats.ts";
import type { NotifyStore, Subscription } from "./notify-store.ts";
import { appleEndpoint } from "./apns-send.ts";
import type { PushDelivery, PushOutcome, PushTarget } from "./push-send.ts";
import type { LiveTurn } from "./turns.ts";

/*
 * He comes to you. The node's own events become notifications on the owner's paired
 * devices, through one door: `tick()`. It looks at what stands (findings that need you,
 * approvals waiting, keys he asked for) and at what happened (a turn
 * that ended unwatched, a quest you started), asks the pure rules in
 * core's notify.ts what may be told now, and delivers that as one message a device.
 *
 * Nothing else raises one. There is no route, tool or event that carries a title or a
 * line: every word comes from the typed builders in notify.ts, from records this node
 * holds. An agent can't subscribe a device, read a subscription, change what's sent or
 * send anything.
 */

export class NotifyError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface NotifySources {
  notices(): { key: string; severity: string; title: string; source: string; dismissed: boolean }[];
  actions(): { id: string; connector: string; tool: string; state: string; requestedAt: string; expires: number }[];
  /** The keys he's waiting for, by name. */
  secretRequests(): string[];
  /** The connectors agents asked for and you haven't added, by request id. */
  connectorRequests(): string[];
  turns: { running(): LiveTurn[]; view(turn: LiveTurn, watchable: boolean): { watchers: number } };
  chats: { summary(id: string): KeptSummary | null };
  quests: { list(): QuestView[]; onChange(fn: () => void): () => void };
}

/** What sends: browsers' push services (push-send.ts) and Apple's, for the iPhone app (apns-send.ts), by the subscription. */
export interface NotifySender {
  /** This node's VAPID key, which browsers subscribe to. */
  publicKey(): Promise<string>;
  send(target: PushTarget, payload: NotifyPayload, delivery: PushDelivery, signal?: AbortSignal): Promise<PushOutcome>;
  close?(): void;
}

export interface NotifyOptions {
  mind: MindStore;
  nodeName: string;
  db: NotifyStore;
  sender: NotifySender;
  /** Push services the owner allowed beyond the known ones. */
  allowed: readonly string[];
  sources: NotifySources;
  ledger: (entry: LedgerEntryInput) => void;
  log: (message: string) => void;
  now?: () => number;
  /** How often he looks (default 15 s); false: only when told to (tests drive it). */
  tickMs?: number | false;
}

const HOUR = 60 * 60_000;
/** A finding that went away and comes back within this isn't told again: one that flaps tells you once. */
export const NOTICE_COOLDOWN_MS = 6 * HOUR;
/** Something that happened and couldn't be told (quiet hours, the limit) is still news for this long. */
export const PENDING_KEEP_MS = 18 * HOUR;
const TOLD_KEEP_MS = 48 * HOUR;
/** Your own test, at most this often, and this many a day. */
export const TEST_EVERY_MS = 5_000;
export const TESTS_PER_DAY = 20;
const TURN_POLL_MS = 1_000;
const QUEST_ID = /^[A-Za-z0-9._:-]{1,64}$/;

const hlcMs = (hlc: string): number => Number(hlc.split(".")[0]);
/** Whose keys only stand for something that can go away and come back. */
const standsFor = (key: string): boolean => key.startsWith("notice:") || key.startsWith("action:") || key.startsWith("secret:");

export class NotifyService {
  private readonly now: () => number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private poll: ReturnType<typeof setInterval> | null = null;
  private soon: ReturnType<typeof setTimeout> | null = null;
  private ticking: Promise<void> | null = null;
  private again = false;
  private stopped = false;
  private readonly abort = new AbortController();
  private stopQuests: (() => void) | null = null;
  /** Turns he's watching to their end: how many were watching each at the last look. */
  private readonly turns = new Map<string, { watchers: number }>();
  /** Quests of yours seen in hand, by the quest they belong to. */
  private readonly quests = new Set<string>();
  private keyProblem: string | null = null;
  private tagSalt: string | null = null;

  constructor(private readonly o: NotifyOptions) {
    this.now = o.now ?? Date.now;
  }

  start(): void {
    if (this.stopped || this.timer) return;
    this.stopQuests = this.o.sources.quests.onChange(() => this.lookAtQuests());
    this.poll = setInterval(() => this.lookAtTurns(), TURN_POLL_MS);
    if (this.o.tickMs !== false) this.timer = setInterval(() => void this.tick(), this.o.tickMs ?? 15_000);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.abort.abort();
    if (this.timer) clearInterval(this.timer);
    if (this.poll) clearInterval(this.poll);
    if (this.soon) clearTimeout(this.soon);
    this.stopQuests?.();
    await this.ticking?.catch(() => {});
    this.o.sender.close?.();
  }

  /** Look again shortly: something just happened that may be worth telling. */
  private nudge(): void {
    if (this.stopped || this.o.tickMs === false || this.soon) return;
    this.soon = setTimeout(() => {
      this.soon = null;
      void this.tick();
    }, 1500);
  }

  /** This node's own secret for notification tags (notify.ts `tagOf`): random, made once, kept in its private database. */
  private salt(): string {
    if (this.tagSalt) return this.tagSalt;
    let salt = this.o.db.setting("tag-salt");
    if (!salt) {
      salt = randomId(16);
      this.o.db.setSetting("tag-salt", salt);
    }
    return (this.tagSalt = salt);
  }

  /* ---------- what happened: turns that end unwatched, quests you started ---------- */

  /** Called every second: follows each running turn to its end, remembering whether anyone was watching. */
  lookAtTurns(): void {
    for (const turn of this.o.sources.turns.running()) {
      const watchers = this.o.sources.turns.view(turn, false).watchers;
      const known = this.turns.get(turn.id);
      if (known) {
        known.watchers = watchers;
        continue;
      }
      const seen = { watchers };
      this.turns.set(turn.id, seen);
      void turn.ended.then(
        () => this.turnEnded(turn, seen.watchers),
        () => void this.turns.delete(turn.id),
      );
    }
  }

  private turnEnded(turn: LiveTurn, watchers: number): void {
    this.turns.delete(turn.id);
    const chat = turn.spec.conversation;
    // Someone was watching, you stopped it yourself, or it's kept nowhere: nothing to tell.
    if (this.stopped || watchers > 0 || !chat || (turn.state !== "done" && turn.state !== "error")) return;
    const kept = this.o.sources.chats.summary(chat.id);
    if (!kept) return;
    const waits = kept.waits;
    const item = turnItem({ id: turn.id, conversation: chat.id, title: kept.title, bank: kept.bank, state: turn.state, question: !!waits?.question, waiting: !!waits && waits.actions.length + waits.secrets.length > 0 });
    if (!item) return;
    this.o.db.addPending(item);
    this.nudge();
  }

  /** A quest you run (from a terminal) that was in hand and has ended. With effort: once every attempt has. */
  lookAtQuests(): void {
    if (this.stopped) return;
    // "you" is how the node names a quest run from your terminal or device. A node enrolled under that very name
    // would be named the same, and a quest's goal is shown as your words: with such a node, nothing is told.
    if (this.o.mind.devices().some((d) => d.kind === "node" && d.name === "you")) return;
    const mine = this.o.sources.quests.list().filter((q) => q.by === "you");
    const groups = new Map<string, QuestView[]>();
    for (const quest of mine) {
      const id = quest.attempt?.of ?? quest.quest;
      groups.set(id, [...(groups.get(id) ?? []), quest]);
    }
    for (const [id, quests] of groups) {
      if (!QUEST_ID.test(id)) continue;
      if (quests.some((q) => questInHand(q.state))) {
        this.quests.add(id);
        continue;
      }
      if (!this.quests.delete(id)) continue; // never seen in hand here: old news
      // The best any attempt reached, as the quest's own outcome is.
      const order = ["done", "unverified", "gave-up", "failed", "stopped"];
      const best = [...quests].sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state))[0]!;
      const item = questItem({ quest: id, goal: best.goal, state: best.state });
      if (!item) continue;
      this.o.db.addPending(item);
      this.nudge();
    }
  }

  /* ---------- the one door ---------- */

  /** What stands now that may be worth telling, from this node's own records. */
  private standing(now: number): NotifyItem[] {
    const out: (NotifyItem | null)[] = [];
    const safely = <T,>(what: string, read: () => T[]): T[] => {
      try {
        return read();
      } catch (error) {
        this.o.log(`notifications: ${what} not read (${redact(String((error as Error).message)).slice(0, 160)})`);
        return [];
      }
    };
    for (const notice of safely("notices", () => this.o.sources.notices())) out.push(noticeItem(notice), toldItem(notice));
    for (const action of safely("approvals", () => this.o.sources.actions())) out.push(actionItem({ id: action.id, connector: action.connector, tool: action.tool, state: action.state, requestedMs: hlcMs(action.requestedAt), expires: action.expires }, now));
    for (const name of safely("key requests", () => this.o.sources.secretRequests())) out.push(secretItem(name));
    for (const id of safely("connector requests", () => this.o.sources.connectorRequests())) out.push(connectorItem(id));
    return out.filter((item): item is NotifyItem => item !== null);
  }

  /** One look: what may be told now is told, as one message a device. Never overlaps itself. */
  tick(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.ticking) {
      this.again = true;
      return this.ticking;
    }
    this.ticking = this.look()
      .catch((error) => this.o.log(`notifications: ${redact(String((error as Error).message)).slice(0, 200)}`))
      .finally(() => {
        this.ticking = null;
        if (this.again && !this.stopped) {
          this.again = false;
          void this.tick();
        }
      });
    return this.ticking;
  }

  private async look(): Promise<void> {
    const { db } = this.o;
    const now = this.now();
    const prefs = db.prefs();
    const standing = this.standing(now);
    const standingKeys = new Set(standing.map((item) => item.key));
    const told = db.told();

    // What a told key was about has gone away: it's remembered a while (a finding that flaps tells you once), then forgotten.
    for (const [key, row] of told) {
      if (standsFor(key)) {
        if (standingKeys.has(key)) {
          if (row.goneAt !== null) db.setGone(key, null);
        } else if (row.goneAt === null) db.setGone(key, now);
        else if (now - row.goneAt > (key.startsWith("notice:") ? NOTICE_COOLDOWN_MS : 0)) {
          db.forget(key);
          told.delete(key);
        }
      } else if (now - row.at > TOLD_KEEP_MS) {
        db.forget(key);
        told.delete(key);
      }
    }

    const waiting = db.pending();
    const stale = waiting.filter((p) => now - p.at > PENDING_KEEP_MS).map((p) => p.item.key);
    if (stale.length) db.dropPending(stale);
    const items = [...standing, ...waiting.filter((p) => now - p.at <= PENDING_KEEP_MS).map((p) => p.item)];

    const devices = this.devices();
    // Nobody to tell: what stands now is old news by the time a device is turned on.
    if (!devices.length) {
      const fresh = items.filter((item) => !told.has(item.key));
      if (fresh.length) db.tell(fresh);
      db.dropPending(fresh.map((item) => item.key));
      return;
    }

    const day = notifyDay(now, prefs.quiet.tz);
    const plan = planNotifications({ now, prefs, items, told, sentToday: db.countOn(day), lastSentAt: db.lastSentAt() });
    if (plan.send.length) await this.deliver(plan.send, devices, day);
    // Ordinary news has reached the day's limit: one message says so, once that day, and not in quiet hours.
    if (limitReached(prefs, db.countOn(day)) && db.setting("limit-said") !== day && !inQuietHours(prefs.quiet, now)) {
      db.setSetting("limit-said", day);
      const said = await Promise.all(devices.map((device) => this.send(device, limitMessage(prefs.perDay), { ttlSeconds: 12 * 3600, urgency: "normal" })));
      db.logSent(day, "limit", devices.map((d) => d.name), said.some(Boolean));
    }
  }

  /** The subscribed devices that are still yours: one that was revoked loses its subscription here. */
  private devices(): { sub: Subscription; name: string; scopes: string[] }[] {
    const out: { sub: Subscription; name: string; scopes: string[] }[] = [];
    for (const sub of this.o.db.subscriptions()) {
      const device = this.o.mind.activeDevice(sub.device);
      if (!device || device.kind !== "client") {
        this.o.db.remove(sub.device);
        this.o.log("notifications: a revoked device's subscription was removed");
        continue;
      }
      out.push({ sub, name: device.name, scopes: device.scopes });
    }
    return out;
  }

  private async send(to: { sub: Subscription; name: string }, payload: NotifyPayload, delivery: PushDelivery): Promise<boolean> {
    const outcome = await this.o.sender.send(to.sub, payload, delivery, this.abort.signal);
    if (outcome.gone) {
      // The browser unsubscribed, or the app was removed: the push service has forgotten it, and so does the node.
      this.o.db.remove(to.sub.device);
      this.o.log(`notifications: ${to.name}'s subscription is gone at its push service; removed`);
    } else if (outcome.ok) this.o.db.mark(to.sub.device, { ok: true });
    else this.o.db.mark(to.sub.device, { ok: false, error: outcome.error ?? "the send failed" });
    return outcome.ok;
  }

  private async deliver(items: NotifyItem[], devices: { sub: Subscription; name: string; scopes: string[] }[], day: string): Promise<void> {
    const { db } = this.o;
    const alert = items.some((item) => item.alert);
    const delivery: PushDelivery = { ttlSeconds: alert ? 24 * 3600 : 12 * 3600, urgency: alert || items.some((item) => item.kind === "approval" || item.kind === "question") ? "high" : "normal" };
    // Told from here on, whatever the push service answers: a failing service is never a reason to try the same news again.
    db.tell(items);
    db.dropPending(items.map((item) => item.key));
    const results = await Promise.all(
      devices.map(async (device) => {
        // Each device is told what it could see in the app anyway.
        const payload = notifyMessage(items.filter((item) => item.needs.every((scope) => device.scopes.includes(scope))), this.salt());
        if (!payload) return null;
        return { name: device.name, ok: await this.send(device, payload, delivery) };
      }),
    );
    const sent = results.filter((r): r is { name: string; ok: boolean } => r !== null);
    if (!sent.length) return;
    const kind = notifyMessage(items, this.salt())!.kind;
    db.logSent(day, kind, sent.map((s) => s.name), sent.some((s) => s.ok));
    // His own act, in the ledger: what kind and to which devices, never what it said.
    this.o.ledger({ class: "outward", resource: "notify", target: kind, verdict: "approved", reason: "you turned notifications on for these devices", quest: "galahad.self", detail: `to ${sent.map((s) => s.name).join(", ")}`.slice(0, 500) });
  }

  /* ---------- the owner's own acts: this device on and off, the settings, a test ---------- */

  /** A paired device turns notifications on for itself. The endpoint must be a push service; it's kept as that device's. */
  async subscribe(device: string, input: PushSubscriptionInput): Promise<NotifyDeviceView> {
    const paired = this.o.mind.activeDevice(device);
    if (!paired || paired.kind !== "client") throw new NotifyError(403, "only a paired device turns notifications on, for itself");
    const service = pushService(input.endpoint, this.o.allowed);
    if (!service.ok) throw new NotifyError(400, service.why);
    let point = false;
    try {
      point = isP256Point(fromB64u(input.keys.p256dh)) && fromB64u(input.keys.auth).length === 16;
    } catch {
      point = false;
    }
    if (!point) throw new NotifyError(400, "that isn't a browser's push subscription (its keys don't read as one)");
    // An endpoint is one browser's: another paired device can't take it while that device is still yours.
    const owner = this.o.db.ownerOf(input.endpoint);
    if (owner && owner !== device) {
      if (this.o.mind.activeDevice(owner)) throw new NotifyError(409, "that subscription is another paired device's; turn notifications off there first, or revoke that device");
      this.o.db.remove(owner);
    }
    await this.publicKey();
    const kept = this.o.db.put(device, { endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth, service: service.service });
    return this.deviceView(kept, paired.name);
  }

  /** The iPhone app turns notifications on, for itself: its Apple push token, kept as that device's (one a device). */
  subscribeApple(device: string, input: ApplePushInput): NotifyDeviceView {
    const paired = this.o.mind.activeDevice(device);
    if (!paired || paired.kind !== "client") throw new NotifyError(403, "only a paired device turns notifications on, for itself");
    const endpoint = appleEndpoint(input.environment, input.token);
    // A token is one app install's: another paired device can't take it while that device is still yours.
    const owner = this.o.db.ownerOf(endpoint);
    if (owner && owner !== device) {
      if (this.o.mind.activeDevice(owner)) throw new NotifyError(409, "that iPhone's token is another paired device's; turn notifications off there first, or revoke that device");
      this.o.db.remove(owner);
    }
    const kept = this.o.db.put(device, { endpoint, p256dh: "", auth: "", service: input.environment === "production" ? "Apple" : "Apple (a development build)" });
    this.nudge();
    return this.deviceView(kept, paired.name);
  }

  unsubscribe(device: string): boolean {
    return this.o.db.remove(device);
  }

  setPrefs(input: NotifyPrefsInput): NotifyPrefs {
    const current = this.o.db.prefs();
    const next: NotifyPrefs = {
      kinds: { ...current.kinds, ...Object.fromEntries(Object.entries(input.kinds ?? {}).filter(([, v]) => v !== undefined)) },
      quiet: { ...current.quiet, ...Object.fromEntries(Object.entries(input.quiet ?? {}).filter(([, v]) => v !== undefined)) },
      perDay: input.perDay ?? current.perDay,
    };
    this.o.db.setPrefs(next);
    this.nudge();
    return this.o.db.prefs();
  }

  /** A fixed test message, to one device or to all of them. Yours to send; it doesn't count against the day's limit. */
  async test(only?: string): Promise<{ sent: { device: string; ok: boolean; error: string | null }[] }> {
    const now = this.now();
    const devices = this.devices().filter((d) => !only || d.sub.device === only);
    if (!devices.length) throw new NotifyError(409, only ? "notifications aren't turned on for that device" : "no device has notifications turned on (Settings, on each device)");
    // Yours to send, but not without end: a page stuck in a loop can't buzz the phone with tests.
    const last = this.o.db.lastTestAt();
    if (last !== null && now - last < TEST_EVERY_MS) throw new NotifyError(429, "a test was just sent; give it a few seconds");
    if (this.o.db.testsOn(notifyDay(now, this.o.db.prefs().quiet.tz)) >= TESTS_PER_DAY) throw new NotifyError(429, `that's ${TESTS_PER_DAY} tests today; more tomorrow`);
    const sent = await Promise.all(
      devices.map(async (device) => {
        const ok = await this.send(device, testMessage(device.name), { ttlSeconds: 600, urgency: "high" });
        return { device: device.name, ok, error: ok ? null : (this.o.db.subscription(device.sub.device)?.lastError ?? "its subscription was gone, and was removed") };
      }),
    );
    this.o.db.logSent(notifyDay(now, this.o.db.prefs().quiet.tz), "test", sent.map((s) => s.device), sent.some((s) => s.ok));
    this.o.ledger({ class: "outward", resource: "notify", target: "test", verdict: "approved", reason: "you asked for a test", quest: "galahad.self", detail: `to ${sent.map((s) => s.device).join(", ")}`.slice(0, 500) });
    return { sent };
  }

  /* ---------- what's shown ---------- */

  private async publicKey(): Promise<string> {
    try {
      const key = await this.o.sender.publicKey();
      this.keyProblem = null;
      return key;
    } catch (error) {
      this.keyProblem = redact(String((error as Error).message)).slice(0, 200);
      throw new NotifyError(500, "this node's notification key can't be used; `galahad doctor` says more");
    }
  }

  private deviceView(sub: Subscription, name: string): NotifyDeviceView {
    return { device: sub.device, name, service: sub.service, since: sub.createdAt, lastOk: sub.lastOk, lastError: sub.lastError };
  }

  /** Everything the Settings page and `galahad notify` show. Never an endpoint or a key but this node's public one. */
  async view(asking: string | null): Promise<NotifyView> {
    const { db } = this.o;
    const now = this.now();
    const prefs = db.prefs();
    const day = notifyDay(now, prefs.quiet.tz);
    const devices = this.devices();
    const quiet = inQuietHours(prefs.quiet, now);
    const told = db.told();
    const held = quiet ? [...this.standing(now), ...db.pending().map((p) => p.item)].filter((item) => prefs.kinds[item.kind] && !item.alert && !told.has(item.key)).length : 0;
    return {
      node: this.o.nodeName,
      key: await this.publicKey(),
      prefs,
      devices: devices.map((d) => this.deviceView(d.sub, d.name)),
      subscribed: asking === null ? null : devices.some((d) => d.sub.device === asking),
      today: { day, sent: db.sentOn(day), count: db.countOn(day), limit: prefs.perDay },
      quiet,
      held,
    };
  }

  /** For the doctor: whether anyone can be reached, and a device whose sends keep failing. */
  doctorFacts(): { devices: number; failing: { device: string; error: string }[]; keyProblem: string | null } {
    const devices = this.devices();
    return {
      devices: devices.length,
      failing: devices.filter((d) => d.sub.failures >= 2 && d.sub.lastError).map((d) => ({ device: d.name, error: d.sub.lastError! })),
      keyProblem: this.keyProblem,
    };
  }
}
