import type { Station } from "./world.ts";

/*
 * Compute, as the SANDBOX shows it: each node's strength and slots at the keep, and
 * Galahad's helpers at work (the parallel attempts at a quest), each at the station
 * its work is at. No zod: the page imports this directly (@galahad/core/world-compute).
 *
 * It travels in the world's hello (`compute`) and in a `compute` event when it
 * changes; pages and nodes from before it ignore both. Nothing in it is a secret:
 * labels are "Attempt 2 of 3" and a quest's first words, never what a model read.
 */

export interface WorldComputeNode {
  /** The node's device id (as in the world's `nodes`). */
  id: string;
  name: string;
  /** Sandboxes it carries at once, how many are running, how many wait for a slot. */
  slots: number;
  inUse: number;
  queued: number;
  /** What it measured, in reference cores' worth of work at once (null: not measured yet). */
  strength: number | null;
}

/** One of several attempts at the same quest, running now: a helper at work. */
export interface WorldAttempt {
  /** `<quest>#<index>`: the same attempt keeps it for as long as it runs. */
  id: string;
  quest: string;
  /** Which attempt it is, of how many (1-based). */
  index: number;
  of: number;
  /** "Attempt 2 of 3: compute the tip deflection…" (at most 96 characters). */
  label: string;
  /** Where its work is now: the council (planning), the forge (working in its sandbox), the observatory (being reviewed). */
  station: Station;
  /** The node its sandbox is on, by name (null: not known yet). */
  node: string | null;
  /** When it was first heard of (the node's clock, ms). */
  since: number;
}

export interface WorldCompute {
  nodes: WorldComputeNode[];
  /** Running parallel attempts, oldest first (at most MAX_WORLD_ATTEMPTS). */
  attempts: WorldAttempt[];
}

/** At most this many helpers are shown. */
export const MAX_WORLD_ATTEMPTS = 8;
/** An attempt that's made no call for this long, with none under way, has finished (or was abandoned). */
export const ATTEMPT_IDLE_MS = 3 * 60_000;
