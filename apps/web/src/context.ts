import type { ActionView, FleetView, LoopDraftView, NoticeView, PairingView, SecretRequestView } from "@galahad/core";
import type { TeamSnapshot } from "@galahad/core/team";
import type { Api } from "./api.ts";
import type { BrowserIdentity } from "./identity.ts";
import type { AnyScope, WhoAmI } from "./types.ts";
import type { Scope } from "./ui/dom.ts";
import type { Signal } from "./ui/signal.ts";
import type { Route } from "./lib/nav.ts";
import type { TeamTab } from "./lib/team.ts";

export type { Route };

export interface NavigateOptions {
  /** A secret detected in chat or memory, handed to the vault form. Kept in memory only, never in the URL. */
  prefillKey?: string;
  /** A search to run on arrival (memory). */
  query?: string;
  /** Something to open on arrival, e.g. "add-key", "invite", "create", "remember", "place", "add-loop", "check". */
  intent?: string;
  /** A kept chat to open (chat), or a project to show or start a chat in (projects, chat). */
  conversation?: string;
  project?: string;
  /** A persistent team room or direct conversation, and its selected view. */
  room?: string;
  teamTab?: TeamTab;
}

/** Live data shared by the shell and the views, polled while the app is visible. */
export interface Live {
  fleet: Signal<FleetView | null>;
  pairings: Signal<PairingView[]>;
  secretRequests: Signal<SecretRequestView[]>;
  /** The oath's outbox: actions waiting for your answer, and recently decided ones. */
  actions: Signal<ActionView[]>;
  /** What the heartbeat found, dismissed ones included (the Inbox shows the open ones). */
  notices: Signal<NoticeView[]>;
  /** Loops Galahad drafted when you asked for one in chat, waiting for you to add or dismiss. */
  loopDrafts: Signal<LoopDraftView[]>;
  online: Signal<boolean>;
  /** The inbox has been asked at least once (until then, "nothing needs you" would be a guess). */
  inboxLoaded: Signal<boolean>;
  inboxCount: Signal<number>;
  /** The knights, their rooms and their work, as the node last gave them (null: not yet, or not this device's to read). Set anew at every asking. */
  team: Signal<TeamSnapshot | null>;
  /** Why the last asking for the team failed (null: it didn't). */
  teamProblem: Signal<unknown>;
  refreshTeam(): Promise<void>;
  /** How often the team is asked for while the app is visible (null: not at all). The shell says, from what is on screen. */
  watchTeam(everyMs: number | null): void;
  refreshFleet(): Promise<void>;
  refreshActions(): Promise<void>;
  refreshNotices(): Promise<void>;
  refreshLoopDrafts(): Promise<void>;
  /** Pairings, secret requests, actions, notices and loop drafts. */
  refreshInbox(): Promise<void>;
  /** Stops polling and listening (when the app shell is torn down). */
  stop(): void;
}

export interface Ctx {
  api: Api;
  identity: BrowserIdentity;
  whoami: WhoAmI;
  can(scope: AnyScope): boolean;
  navigate(route: Route, opts?: NavigateOptions): void;
  live: Live;
  /** Opens the command palette, optionally with a query; given the button pressed for it, on a phone it grows out of it. */
  palette(query?: string, from?: Element): void;
}

export interface ViewArgs {
  /** Disposed when the view is left: timers, listeners, aborts in-flight requests. */
  scope: Scope;
  opts: NavigateOptions;
}

export type View = (root: HTMLElement, ctx: Ctx, args: ViewArgs) => void;

export const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));
