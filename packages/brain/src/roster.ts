import { TeammateRole } from "@galahad/core";
import type { MindStore } from "@galahad/mind";

/*
 * Models are hired by role, not by vendor. Each role is an ordered list of
 * `<provider>/<model>` refs; the first one that answers wins, the rest are
 * fallbacks. `<provider>/*` means "whatever that provider serves first"
 * (handy for local runtimes whose installed models vary per node).
 */

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface RoleSpec {
  description: string;
  defaults: string[];
  effort: Effort;
}

export const ROLES: Record<string, RoleSpec> = {
  planner: {
    description: "decomposes quests, makes judgment calls, talks to you",
    defaults: ["anthropic/claude-opus-5-5"],
    effort: "high",
  },
  engineer: { description: "writes and changes code", defaults: ["anthropic/claude-opus-5-5"], effort: "xhigh" },
  reviewer: {
    description: "independent check, ideally a different model family than the author",
    defaults: ["anthropic/claude-opus-5-5"],
    effort: "high",
  },
  swift: {
    description: "cheap and fast: routing, classification, summaries; local first",
    defaults: ["ollama/*", "llamacpp/*", "anthropic/claude-haiku-5-5"],
    effort: "low",
  },
  decider: {
    description: "typed decisions (yes/no, a choice, a score) with calibrated probabilities, from a decision model such as TypeSafe's Jev",
    defaults: [],
    effort: "low",
  },
  // A knight's eyes (Computer Use): the model its desktop's `look` puts a screenshot and a question to, through the
  // gateway, from the knight's own VM. None until you name one: it must take images, and to be clicked on it must
  // answer a place in the screenshot's own pixels (measured, not assumed: TRIALS.md).
  eyes: {
    description: "looks at a knight's screen: says what is on it, and where, in pixels (Computer Use)",
    defaults: [],
    effort: "low",
  },
  // The archive's search by meaning. None until you hire one: a local model (deploy --embedder) keeps
  // the archive on your machines. Its first model is the archive's model (vectors can't be mixed).
  embedder: {
    description: "turns text into vectors for the archive's search by meaning; local first, so the archive never leaves your machines",
    defaults: [],
    effort: "low",
  },
};

/** The chores that run on a role of their own once you hire models for one (choreRole), and what each does. */
export const CHORES: Record<string, string> = {
  fold: "sums up a long chat, or a room's conversation, into its story; the swift role does it until you hire models for this",
};

/** Built-in roles that aren't a knight's to work on: the independent check of its work, and the tools'. */
const NOT_FOR_KNIGHTS = new Set(["reviewer", "decider", "eyes", "embedder"]);

/**
 * The role a knight's work runs on (its tasks, its harness): its own, unless that is the reviewer's or a tool's, when
 * it is the engineer's. A knight may talk on the reviewer's models; the reviewer never does the work it checks.
 */
export const workRole = (role: string): string => (NOT_FOR_KNIGHTS.has(role) ? "engineer" : role);

/**
 * The role a chore runs on (`fold`: a long chat or a room's conversation summed up into its story): the role named after
 * the chore once you hire models for it (`galahad roster set fold <provider/model> …`), the swift role until then. What a
 * chore costs is yours to choose, apart from what answers you.
 */
export function choreRole(store: MindStore, chore: string): string {
  return store.lww<string[]>(`roster:${chore}`)?.value?.length ? chore : "swift";
}

export function roleModels(store: MindStore, role: string): string[] {
  const configured = store.lww<string[]>(`roster:${role}`)?.value;
  if (configured?.length) return configured;
  if (ROLES[role]) return ROLES[role].defaults;
  // A role nobody hired (a knight made with a role of its own, or one you since removed): the engineer's models as
  // you set them. (Its built-in default would be a model you may hold no key for.)
  return roleModels(store, "engineer");
}

export interface RosterRole {
  models: string[];
  configured: boolean;
  description: string;
  /** A role you made (not built in, not a chore's): yours to remove. */
  custom: boolean;
  /** A knight may work on it: the planner, engineer and swift roles, and the roles you made. */
  forKnights: boolean;
}

export function roster(store: MindStore): Record<string, RosterRole> {
  const names = new Set([...Object.keys(ROLES), ...store.lwwPrefix("roster:").map((e) => e.key.slice("roster:".length))]);
  return Object.fromEntries(
    [...names].flatMap((role) => {
      const configured = store.lww<string[]>(`roster:${role}`)?.value;
      const builtIn = Boolean(ROLES[role]);
      // A role you made and then emptied is gone; a built-in one goes back to its defaults.
      if (!builtIn && !configured?.length) return [];
      const chore = CHORES[role];
      return [
        [
          role,
          {
            models: configured?.length ? configured : (ROLES[role]?.defaults ?? []),
            configured: !!configured?.length,
            description: ROLES[role]?.description ?? chore ?? "a role you made",
            custom: !builtIn && !chore,
            forKnights: !chore && !NOT_FOR_KNIGHTS.has(role) && TeammateRole.safeParse(role).success,
          },
        ],
      ];
    }),
  );
}

export function parseRef(ref: string): { provider: string; model: string } {
  const slash = ref.indexOf("/");
  if (slash <= 0 || slash === ref.length - 1) throw new Error(`model ref must be <provider>/<model>: ${ref}`);
  return { provider: ref.slice(0, slash), model: ref.slice(slash + 1) };
}

export const effortFor = (role: string | undefined): Effort => ROLES[role ?? "planner"]?.effort ?? "high";
