import type { ActionView, FleetView, NoticeView, PairingView, SecretRequestView } from "@galahad/core";
import type { Api } from "./api.ts";
import type { Live } from "./context.ts";
import type { AnyScope } from "./types.ts";
import { signal } from "./ui/signal.ts";

/*
 * Background polling for what the shell shows everywhere: fleet health and
 * the inbox (pairing requests, secret requests, actions waiting for your
 * answer, the heartbeat's notices). It pauses while the app is hidden and
 * catches up the moment it's visible again.
 */

const FLEET_MS = 10_000;
const PAIRINGS_MS = 3_000;
const REQUESTS_MS = 15_000;
const ACTIONS_MS = 5_000;
const NOTICES_MS = 15_000;

export interface LiveEvents {
  /** A device asked to join since the last look. */
  onNewPairing(pairing: PairingView): void;
  /** An action began waiting for your answer since the last look. */
  onNewAction(action: ActionView): void;
}

/** Waiting, and not yet past its deadline (the node says expired on its next answer). */
export const isWaiting = (action: ActionView, now = Date.now()): boolean => action.state === "waiting" && action.expires > now;

export function startLive(api: Api, can: (scope: AnyScope) => boolean, events: LiveEvents): Live {
  const fleet = signal<FleetView | null>(null);
  const pairings = signal<PairingView[]>([]);
  const secretRequests = signal<SecretRequestView[]>([]);
  const actions = signal<ActionView[]>([]);
  const notices = signal<NoticeView[]>([]);
  const online = signal(navigator.onLine);
  const inboxLoaded = signal(false);
  const inboxCount = signal(0);
  const seen = new Set<string>();
  const seenActions = new Set<string>();
  let lastFleet = "";
  let lastActions = "";
  let lastNotices = "";
  let primed = false;
  let actionsPrimed = false;

  const recount = () =>
    inboxCount.set(
      pairings.value.length +
        secretRequests.value.length +
        actions.value.filter((a) => isWaiting(a)).length +
        notices.value.filter((n) => !n.dismissed).length,
    );
  pairings.subscribe(recount);
  secretRequests.subscribe(recount);
  actions.subscribe(recount);
  notices.subscribe(recount);

  async function refreshFleet(): Promise<void> {
    if (!can("mind:read")) return;
    try {
      const next = await api.get<FleetView>("/api/fleet");
      // Only wake the views when something actually changed.
      const signature = JSON.stringify(next);
      if (signature !== lastFleet) {
        lastFleet = signature;
        fleet.set(next);
      }
    } catch {
      /* the shell shows offline state; views show their own errors */
    }
  }

  async function refreshPairings(): Promise<void> {
    if (!can("fleet:admin")) return;
    try {
      const { pairings: list } = await api.get<{ pairings: PairingView[] }>("/api/pairings");
      for (const p of list) {
        const key = `${p.invite}:${p.device}`;
        if (!seen.has(key)) {
          seen.add(key);
          if (primed) events.onNewPairing(p);
        }
      }
      primed = true;
      const same = list.length === pairings.value.length && list.every((p, i) => p.device === pairings.value[i]?.device && p.conflict === pairings.value[i]?.conflict);
      if (!same) pairings.set(list);
    } catch {
      /* transient; next poll retries */
    }
  }

  async function refreshRequests(): Promise<void> {
    if (!can("vault:read")) return;
    try {
      const { requests } = await api.get<{ requests: SecretRequestView[] }>("/api/secret-requests");
      const same = requests.length === secretRequests.value.length && requests.every((r, i) => r.name === secretRequests.value[i]?.name);
      if (!same) secretRequests.set(requests);
    } catch {
      /* transient */
    }
  }

  async function refreshActions(): Promise<void> {
    if (!can("mind:read")) return;
    try {
      const { actions: list } = await api.get<{ actions: ActionView[] }>("/api/actions");
      for (const a of list) {
        if (!isWaiting(a) || seenActions.has(a.id)) continue;
        seenActions.add(a.id);
        if (actionsPrimed) events.onNewAction(a);
      }
      actionsPrimed = true;
      const signature = JSON.stringify(list);
      if (signature !== lastActions) {
        lastActions = signature;
        actions.set(list);
      }
    } catch {
      /* transient; an older node without the outbox answers 404 and shows nothing */
    }
  }

  async function refreshNotices(): Promise<void> {
    if (!can("mind:read")) return;
    try {
      const { notices: list } = await api.get<{ notices: NoticeView[] }>("/api/notices");
      const signature = JSON.stringify(list);
      if (signature !== lastNotices) {
        lastNotices = signature;
        notices.set(list);
      }
    } catch {
      /* transient */
    }
  }

  const refreshInbox = async () => {
    await Promise.all([refreshPairings(), refreshRequests(), refreshActions(), refreshNotices()]);
    inboxLoaded.set(true);
  };

  const timers: ReturnType<typeof setInterval>[] = [];
  function start(): void {
    stop();
    void refreshFleet();
    void refreshInbox();
    timers.push(setInterval(() => void refreshFleet(), FLEET_MS));
    timers.push(setInterval(() => void refreshPairings(), PAIRINGS_MS));
    timers.push(setInterval(() => void refreshRequests(), REQUESTS_MS));
    timers.push(setInterval(() => void refreshActions(), ACTIONS_MS));
    timers.push(setInterval(() => void refreshNotices(), NOTICES_MS));
  }
  function stop(): void {
    for (const t of timers.splice(0)) clearInterval(t);
  }

  const listeners = new AbortController();
  const until = listeners.signal;
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()), { signal: until });
  window.addEventListener("online", () => {
    online.set(true);
    start();
  }, { signal: until });
  window.addEventListener("offline", () => online.set(false), { signal: until });
  if (!document.hidden) start();

  const dispose = () => {
    stop();
    listeners.abort();
  };
  return { fleet, pairings, secretRequests, actions, notices, online, inboxLoaded, inboxCount, refreshFleet, refreshActions, refreshNotices, refreshInbox, stop: dispose };
}
