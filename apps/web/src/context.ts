import type { ActionView, FleetView, NoticeView, PairingView, SecretRequestView } from "@galahad/core";
import type { Api } from "./api.ts";
import type { BrowserIdentity } from "./identity.ts";
import type { AnyScope, WhoAmI } from "./types.ts";
import type { Scope } from "./ui/dom.ts";
import type { Signal } from "./ui/signal.ts";

export type Route = "overview" | "inbox" | "chat" | "activity" | "loops" | "artifacts" | "findings" | "trials" | "bank" | "projects" | "memory" | "fleet" | "sandboxes" | "vault" | "models" | "connectors" | "settings";

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
  online: Signal<boolean>;
  inboxCount: Signal<number>;
  refreshFleet(): Promise<void>;
  refreshActions(): Promise<void>;
  refreshNotices(): Promise<void>;
  /** Pairings, secret requests, actions and notices. */
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
  /** Opens the command palette, optionally with a query. */
  palette(query?: string): void;
}

export interface ViewArgs {
  /** Disposed when the view is left: timers, listeners, aborts in-flight requests. */
  scope: Scope;
  opts: NavigateOptions;
}

export type View = (root: HTMLElement, ctx: Ctx, args: ViewArgs) => void;

export const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));
