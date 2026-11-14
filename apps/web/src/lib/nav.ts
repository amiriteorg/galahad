import type { AnyScope } from "../types.ts";
import type { IconName } from "../ui/icons.ts";

/*
 * The app's places, as one list (pure: no DOM; the shell gives each its view). Three come
 * first everywhere: Chat, Squires and Inbox. Every other place is reached from More, one
 * plain index under a few headings. An address (`#/fleet`) is a contract: a place is never
 * renamed or dropped here, and what a device may see follows its scopes.
 */

const HEADINGS = { work: "Work", knowledge: "Knowledge", machines: "Machines", keys: "Keys and models", device: "This device" } as const;

interface PlaceSpec {
  id: string;
  label: string;
  icon: IconName;
  /** Where it's reached from: one of the three places, a heading on More, or (null) More itself. */
  under: "primary" | keyof typeof HEADINGS | null;
  scope: AnyScope | null;
  /** Also listed (read-only) for devices holding this scope. */
  alsoFor?: AnyScope;
  /** The key after G that goes there. */
  key: string;
  keywords: readonly string[];
  /** What's there, in a line (More's index). */
  about: string;
}

const LIST = [
  { id: "chat", label: "Chat", icon: "chat", under: "primary", scope: "chat", key: "c", keywords: ["galahad", "counsel", "ask", "talk", "history", "conversations", "home"], about: "" },
  { id: "team", label: "Squires", icon: "fleet", under: "primary", scope: "chat", key: "h", keywords: ["squires", "team", "teammates", "rooms", "messages", "workers", "sub-galahads", "hermes", "tasks", "coordination"], about: "" },
  { id: "inbox", label: "Inbox", icon: "inbox", under: "primary", scope: null, key: "i", keywords: ["approvals", "pairing", "requests", "actions", "notices", "oath"], about: "" },
  { id: "more", label: "More", icon: "more", under: null, scope: null, key: ".", keywords: ["everything", "all", "index", "menu"], about: "" },
  { id: "overview", label: "Overview", icon: "overview", under: "work", scope: null, key: "o", keywords: ["dashboard", "health", "doctor"], about: "Health, what's in hand and recent activity" },
  { id: "projects", label: "Projects", icon: "folder", under: "work", scope: "mind:read", key: "p", keywords: ["workspaces", "instructions", "repositories", "folders"], about: "Instructions and chats, by project" },
  { id: "loops", label: "Loops", icon: "repeat", under: "work", scope: "mind:read", key: "r", keywords: ["schedule", "cron", "heartbeat", "routine", "recurring"], about: "What he does on a schedule" },
  { id: "activity", label: "Activity", icon: "activity", under: "work", scope: "mind:read", key: "a", keywords: ["ledger", "log", "audit", "history"], about: "Everything he did, and why it was allowed" },
  { id: "artifacts", label: "Artifacts", icon: "archive", under: "work", scope: "mind:read", key: "w", keywords: ["work", "results", "files", "outputs", "kept", "reports", "plots"], about: "Files his work kept" },
  { id: "trials", label: "Trials", icon: "gauge", under: "work", scope: "mind:read", key: "t", keywords: ["benchmarks", "evals", "galahad index", "score", "tests", "progress"], about: "Whether he is getting better" },
  { id: "memory", label: "Memory", icon: "memory", under: "knowledge", scope: "mind:read", key: "m", keywords: ["remember", "recall", "mind"], about: "What the fleet remembers" },
  { id: "skills", label: "Skills", icon: "scroll", under: "knowledge", scope: "mind:read", key: "u", keywords: ["learn", "learned", "how", "notes", "playbook", "procedures", "know-how", "approve", "proposed", "library"], about: "What he learned to do, for you to approve" },
  { id: "archive", label: "Archive", icon: "library", under: "knowledge", scope: "mind:read", key: "k", keywords: ["kept", "forever", "ideas", "lessons", "models", "teachings", "semantic", "search", "vector", "history"], about: "Everything kept for good, searchable" },
  { id: "findings", label: "Findings", icon: "flask", under: "knowledge", scope: "mind:read", key: "e", keywords: ["investigations", "experiments", "hypotheses", "science", "conclusions", "predictions"], about: "What his investigations concluded" },
  { id: "fleet", label: "Fleet", icon: "fleet", under: "machines", scope: "mind:read", key: "f", keywords: ["devices", "nodes", "machines", "compute", "agents"], about: "Your machines and devices" },
  // Owner devices see Sandboxes even before they hold the new scope, so the feature can be found;
  // the page explains what's missing instead of offering actions that would be refused.
  { id: "sandboxes", label: "Sandboxes", icon: "sandbox", under: "machines", scope: "sandbox", alsoFor: "fleet:admin", key: "s", keywords: ["containers", "vm", "console"], about: "Isolated places where work runs" },
  { id: "vault", label: "Vault", icon: "vault", under: "keys", scope: "vault:read", key: "v", keywords: ["keys", "secrets", "api key"], about: "Sealed keys; no model ever sees one" },
  { id: "models", label: "Models", icon: "models", under: "keys", scope: "mind:read", key: "l", keywords: ["providers", "roster", "llm"], about: "Who answers: roles, models, providers" },
  { id: "connectors", label: "Connectors", icon: "plug", under: "keys", scope: "mind:read", key: "n", keywords: ["github", "cloudflare", "home assistant", "integrations", "services", "tools", "mcp", "standing orders"], about: "Services and MCP servers he may call" },
  { id: "bank", label: "Bank", icon: "bank", under: "keys", scope: "bank:read", key: "b", keywords: ["lunar", "accounts", "balances", "transactions", "enable banking", "money", "finance"], about: "The bank connection, and who may read it" },
  { id: "settings", label: "Settings", icon: "settings", under: "device", scope: null, key: ",", keywords: ["preferences", "theme", "device", "notifications"], about: "Theme, notifications, this device" },
] as const satisfies readonly PlaceSpec[];

export type Route = (typeof LIST)[number]["id"];
export type Place = PlaceSpec & { id: Route };
export const PLACES: readonly Place[] = LIST;

/** The places a device may see: its scopes decide. */
export const placesFor = (can: (scope: AnyScope) => boolean): Place[] => PLACES.filter((place) => place.scope === null || can(place.scope) || (place.alsoFor !== undefined && can(place.alsoFor)));

/** The places that come first, on the tab bar and in the sidebar. */
export const primaryOf = (visible: Place[]): Place[] => visible.filter((place) => place.under === "primary");

/** The place the app opens on, and falls back to: Chat, or the Inbox for a device that may not chat. */
export const homeOf = (visible: Place[]): Route => primaryOf(visible)[0]?.id ?? "inbox";

/** More's index: every other place this device may see, under its heading. */
export function moreIndex(visible: Place[]): { heading: string; places: Place[] }[] {
  return Object.entries(HEADINGS)
    .map(([under, heading]) => ({ heading, places: visible.filter((place) => place.under === under) }))
    .filter((group) => group.places.length > 0);
}

/** Which entry of the navigation a place is under: itself for the three, More for the rest. */
export const tabOf = (route: Route): Route => (PLACES.find((place) => place.id === route)?.under === "primary" ? route : "more");
