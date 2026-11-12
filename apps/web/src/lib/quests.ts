/*
 * Quests as the app shows them: the gates you give one ("done means this command
 * passes"), and a gate's last result in words. Pure functions (no DOM), unit-tested.
 * The limits are the contract's (packages/core/src/quests.ts), restated here so the
 * app doesn't carry the schema library for them; a test holds the two together.
 */

export const MAX_GATES = 8;
export const MAX_GATE_LENGTH = 1000;

/** The gates typed into a field, one shell command a line: blank lines dropped, or why it won't do. */
export function gatesFromText(text: string): { gates: string[] } | { problem: string } {
  const gates = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (gates.length > MAX_GATES) return { problem: `A quest takes at most ${MAX_GATES} gates (this is ${gates.length}).` };
  const long = gates.findIndex((g) => g.length > MAX_GATE_LENGTH);
  if (long >= 0) return { problem: `Gate ${long + 1} is longer than ${MAX_GATE_LENGTH} characters. Put a long check in a script and run that.` };
  return { gates };
}

/** Whose gate it is, as the app says it. */
export const gateOwner = (by: "owner" | "planner"): string => (by === "owner" ? "yours" : "proposed by the planner");

/** A gate's last result in a word or two, and its tone. */
export function gateResult(exitCode: number | null): { text: string; tone: "ok" | "danger" | "neutral" } {
  if (exitCode === null) return { text: "not run yet", tone: "neutral" };
  return exitCode === 0 ? { text: "passed", tone: "ok" } : { text: `failed (exit ${exitCode})`, tone: "danger" };
}
