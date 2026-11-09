import type { Scope } from "@galahad/core";
import type { Api } from "./api.ts";
import type { BrowserIdentity } from "./identity.ts";

export type Tab = "chat" | "memory" | "vault" | "models" | "fleet";

export interface WhoAmI {
  device: string;
  kind: string;
  scopes: Scope[];
  node: string;
  nodeName: string;
  fleet: string;
  fleetName: string | null;
}

export interface NavigateOptions {
  /** Hand a detected secret from chat to the vault form (never sent anywhere). */
  prefillKey?: string;
}

export interface Ctx {
  api: Api;
  identity: BrowserIdentity;
  whoami: WhoAmI;
  can(scope: Scope): boolean;
  navigate(tab: Tab, opts?: NavigateOptions): void;
}

/** A view renders into `root` and may return a cleanup function (timers, aborts). */
export type View = (root: HTMLElement, ctx: Ctx, opts: NavigateOptions) => void | (() => void);

export interface PresetView {
  id: string;
  kind: "openai" | "anthropic";
  baseUrl: string;
  keyPrefixes?: string[];
  local?: boolean;
  note?: string;
}

export const errorMessage = (error: unknown): string => String((error as Error)?.message ?? error);
