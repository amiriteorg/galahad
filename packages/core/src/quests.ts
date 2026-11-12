import { z } from "zod";

/*
 * Quests, as the contract sees them: the gates a quest must pass, and where a quest
 * in hand stands (its plan, the step he's on, each gate's last result).
 *
 * A gate is a shell command you name ("done means this passes"): it runs in the quest's
 * own sandbox after the engineer says DONE, and every gate must exit 0 before the
 * independent reviewer is even asked. The planner may propose gates of its own; those
 * are marked as its proposal, and yours are never dropped or rewritten.
 */

/** The most gates you may give one quest. */
export const MAX_QUEST_GATES = 8;
/** The most gates a planner may propose on top of yours. */
export const MAX_PROPOSED_GATES = 3;

/** One gate: a shell command, run with `bash -c` in the quest's sandbox. */
export const QuestGate = z
  .string()
  .trim()
  .min(1, "a gate is a shell command")
  .max(1000)
  .refine((command) => !command.includes("\0"), "no NUL bytes in a gate");

export const QuestGates = z.array(QuestGate).max(MAX_QUEST_GATES);

/** Who set a gate: you, or the planner (its own proposal, from its "Done when:" line). */
export type GateBy = "owner" | "planner";

/** A gate's last run, as every surface shows it. `exitCode` null: not run yet. */
export interface GateView {
  command: string;
  by: GateBy;
  exitCode: number | null;
  /** An excerpt of what it printed (redacted), when it has run. */
  excerpt?: string;
}
