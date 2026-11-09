import type { FleetView, PairingView, SecretRequestView } from "@galahad/core";
import type { Api } from "./api.ts";
import type { Live } from "./context.ts";
import type { AnyScope } from "./types.ts";
import { signal } from "./ui/signal.ts";

/*
 * Background polling for what the shell shows everywhere: fleet health and
 * the inbox (pairing requests, secret requests). It pauses while the app is
 * hidden and catches up the moment it's visible again.
 */

const FLEET_MS = 10_000;
const PAIRINGS_MS = 3_000;
const REQUESTS_MS = 15_000;

export function startLive(api: Api, can: (scope: AnyScope) => boolean, onNewPairing: (pairing: PairingView) => void): Live {
  const fleet = signal<FleetView | null>(null);
  const pairings = signal<PairingView[]>([]);
  const secretRequests = signal<SecretRequestView[]>([]);
  const online = signal(navigator.onLine);
  const inboxCount = signal(0);
  const seen = new Set<string>();
  let lastFleet = "";
  let primed = false;

  const recount = () => inboxCount.set(pairings.value.length + secretRequests.value.length);
  pairings.subscribe(recount);
  secretRequests.subscribe(recount);

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
          if (primed) onNewPairing(p);
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

  const refreshInbox = async () => {
    await Promise.all([refreshPairings(), refreshRequests()]);
  };

  const timers: ReturnType<typeof setInterval>[] = [];
  function start(): void {
    stop();
    void refreshFleet();
    void refreshInbox();
    timers.push(setInterval(() => void refreshFleet(), FLEET_MS));
    timers.push(setInterval(() => void refreshPairings(), PAIRINGS_MS));
    timers.push(setInterval(() => void refreshRequests(), REQUESTS_MS));
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
  return { fleet, pairings, secretRequests, online, inboxCount, refreshFleet, refreshInbox, stop: dispose };
}
