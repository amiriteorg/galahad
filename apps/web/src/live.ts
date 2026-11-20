import type { ActionView, ConnectorRequestView, FleetView, LoopDraftView, MemoryView, NoticeView, PairingView, QuestionView, ScreenSessionView, SecretRequestView } from "@galahad/core";
import type { TeamSnapshot } from "@galahad/core/team";
import type { Api } from "./api.ts";
import type { Live } from "./context.ts";
import type { AnyScope } from "./types.ts";
import { signal } from "./ui/signal.ts";

/*
 * Background polling for what the shell shows everywhere: fleet health, the
 * inbox (pairing requests, secret requests, actions waiting for your answer,
 * the heartbeat's notices) and the team (the knights, their rooms and work:
 * the roster's rows and every timeline read the one snapshot). It pauses while
 * the app is hidden and catches up the moment it's visible again.
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
  const loopDrafts = signal<LoopDraftView[]>([]);
  const connectorRequests = signal<ConnectorRequestView[]>([]);
  const aboutYou = signal<MemoryView[]>([]);
  const actions = signal<ActionView[]>([]);
  /** His asks to use a Mac itself, and his sessions there (core's screen.ts). */
  const screenSessions = signal<ScreenSessionView[]>([]);
  /** MCP servers' questions to you, mid-call (core's questions.ts). */
  const questions = signal<QuestionView[]>([]);
  const notices = signal<NoticeView[]>([]);
  const online = signal(navigator.onLine);
  const inboxLoaded = signal(false);
  const inboxCount = signal(0);
  const team = signal<TeamSnapshot | null>(null);
  const teamProblem = signal<unknown>(null);
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
        screenSessions.value.filter((s) => s.state === "waiting" || s.state === "allowed").length +
        questions.value.filter((q) => q.expires > Date.now()).length +
        notices.value.filter((n) => !n.dismissed).length +
        loopDrafts.value.length +
        connectorRequests.value.length +
        aboutYou.value.length,
    );
  pairings.subscribe(recount);
  secretRequests.subscribe(recount);
  loopDrafts.subscribe(recount);
  connectorRequests.subscribe(recount);
  aboutYou.subscribe(recount);
  actions.subscribe(recount);
  screenSessions.subscribe(recount);
  questions.subscribe(recount);
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

  async function refreshLoopDrafts(): Promise<void> {
    if (!can("mind:read")) return;
    try {
      const { drafts } = await api.get<{ drafts: LoopDraftView[] }>("/api/loops/drafts");
      if (JSON.stringify(drafts.map((d) => d.id)) !== JSON.stringify(loopDrafts.value.map((d) => d.id))) loopDrafts.set(drafts);
    } catch {
      /* transient, or an older node with no drafts */
    }
  }

  async function refreshConnectorRequests(): Promise<void> {
    if (!can("mind:read")) return;
    try {
      const { requests } = await api.get<{ requests: ConnectorRequestView[] }>("/api/connectors/requests");
      if (JSON.stringify(requests.map((r) => r.id)) !== JSON.stringify(connectorRequests.value.map((r) => r.id))) connectorRequests.set(requests);
    } catch {
      /* transient, or an older node that takes no requests */
    }
  }

  /** The facts about you he proposed, waiting for you (what you kept is on the Memory page). */
  async function refreshAboutYou(): Promise<void> {
    if (!can("mind:read")) return;
    try {
      const { proposed } = await api.get<{ proposed: MemoryView[] }>("/api/about-you");
      if (JSON.stringify(proposed.map((m) => m.id)) !== JSON.stringify(aboutYou.value.map((m) => m.id))) aboutYou.set(proposed);
    } catch {
      /* transient, or an older node that keeps nothing about you */
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

  let lastScreen = "";
  async function refreshScreenSessions(): Promise<void> {
    if (!can("mind:read")) return;
    try {
      const { sessions } = await api.get<{ sessions: ScreenSessionView[] }>("/api/screen/sessions");
      const signature = JSON.stringify(sessions);
      if (signature !== lastScreen) {
        lastScreen = signature;
        screenSessions.set(sessions);
      }
    } catch {
      /* transient, or an older node without screen sessions */
    }
  }

  let lastQuestions = "";
  async function refreshQuestions(): Promise<void> {
    if (!can("mind:read")) return;
    try {
      const { questions: list } = await api.get<{ questions: QuestionView[] }>("/api/questions");
      const signature = JSON.stringify(list);
      if (signature !== lastQuestions) {
        lastQuestions = signature;
        questions.set(list);
      }
    } catch {
      /* transient, or an older node without questions */
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

  // One asking at a time: whoever asks meanwhile is given the same answer. Each answer is set anew, so what
  // moves with the clock (a face that was pleased for half a minute) is worked out again by whoever shows it.
  let teamAsking: Promise<void> | null = null;
  function refreshTeam(): Promise<void> {
    if (!can("chat")) return Promise.resolve();
    teamAsking ??= api
      .get<TeamSnapshot>("/api/team")
      .then(
        (next) => {
          teamProblem.set(null);
          team.set(next);
        },
        (error: unknown) => teamProblem.set(error),
      )
      .finally(() => (teamAsking = null));
    return teamAsking;
  }
  let teamEvery: number | null = null;
  let teamTimer: ReturnType<typeof setInterval> | undefined;
  function watchTeam(everyMs: number | null = teamEvery): void {
    if (everyMs === teamEvery && teamTimer) return;
    teamEvery = everyMs;
    clearInterval(teamTimer);
    teamTimer = undefined;
    if (everyMs === null || document.hidden) return;
    void refreshTeam();
    teamTimer = setInterval(() => void refreshTeam(), everyMs);
  }

  const refreshInbox = async () => {
    await Promise.all([refreshPairings(), refreshRequests(), refreshActions(), refreshScreenSessions(), refreshQuestions(), refreshNotices(), refreshLoopDrafts(), refreshConnectorRequests(), refreshAboutYou()]);
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
    timers.push(setInterval(() => void refreshLoopDrafts(), REQUESTS_MS));
    timers.push(setInterval(() => void refreshConnectorRequests(), REQUESTS_MS));
    timers.push(setInterval(() => void refreshAboutYou(), REQUESTS_MS));
    timers.push(setInterval(() => void refreshActions(), ACTIONS_MS));
    timers.push(setInterval(() => void refreshScreenSessions(), ACTIONS_MS));
    // (A question holds a call: it's looked for as often as an action is.)
    timers.push(setInterval(() => void refreshQuestions(), ACTIONS_MS));
    timers.push(setInterval(() => void refreshNotices(), NOTICES_MS));
    watchTeam();
  }
  function stop(): void {
    for (const t of timers.splice(0)) clearInterval(t);
    clearInterval(teamTimer);
    teamTimer = undefined;
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
  return { fleet, pairings, secretRequests, actions, screenSessions, refreshScreenSessions, questions, refreshQuestions, notices, loopDrafts, connectorRequests, aboutYou, refreshAboutYou, online, inboxLoaded, inboxCount, team, teamProblem, refreshTeam, watchTeam, refreshFleet, refreshActions, refreshNotices, refreshLoopDrafts, refreshConnectorRequests, refreshInbox, stop: dispose };
}
