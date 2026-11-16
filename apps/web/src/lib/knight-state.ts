import type { Now } from "./now.ts";

/*
 * What a knight is doing, in a word and a colour: the ring round its face and the chip beside its name (ui/avatar.ts's
 * seat, ui/controls.ts's badge). Pure (no DOM). Which one a knight is in, its row says (lib/roster.ts); Galahad's, his
 * line (lib/now.ts). The colour is never the only telling: every state the ring colours is said in words too.
 */

export type KnightState = "working" | "needs" | "failed" | "paused" | "queued" | "verified" | "resting";

export interface StateLook {
  /** The chip's words. None for a knight at rest: its line says what it is for, and its ring says nothing. */
  words: string | null;
  /** The chip's tone, which is the ring's colour too: ink while it works (the ring turns), Galahad's oxblood when it
   * waits on you, red for a failure, green for work verified a moment ago, grey otherwise. */
  tone: "accent" | "needs" | "danger" | "ok" | "neutral";
}

export const STATES: Record<KnightState, StateLook> = {
  working: { words: "Working", tone: "accent" },
  needs: { words: "Needs you", tone: "needs" },
  failed: { words: "Failed", tone: "danger" },
  paused: { words: "Paused", tone: "neutral" },
  queued: { words: "Queued", tone: "neutral" },
  verified: { words: "Verified", tone: "ok" },
  resting: { words: null, tone: "neutral" },
};

/** Galahad's state, from what his line says: what waits on you first, as a knight's row has it (what only you can
 * answer is what the row is marked for); then work in hand or an answer being written; at rest otherwise. */
export const galahadState = (now: Pick<Now, "expression" | "tone">): KnightState => (now.tone === "warn" ? "needs" : now.tone === "accent" || now.expression === "thinking" || now.expression === "working" ? "working" : "resting");

/** How a knight is named with its state, for a screen reader and a tooltip: "Ada, working". */
export const withState = (name: string, state: KnightState): string => (STATES[state].words ? `${name}, ${STATES[state].words!.toLowerCase()}` : name);
