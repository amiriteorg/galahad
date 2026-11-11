import { z } from "zod";
import { EffortLevel } from "./compute.ts";

/*
 * Trials: problems with known answers, scored by a program, never by a model.
 * A trial run hands Galahad a problem (with fresh random parameters, so a
 * remembered answer doesn't help), lets him solve it in a sandbox as he would any
 * quest, and grades the numbers he leaves in /work/out/answer.json against the
 * exact solution within a stated tolerance. The record is checkable by every
 * replica: each answer's verdict and the score follow from the numbers recorded.
 */

export const TrialId = z.string().regex(/^tr_[A-Za-z0-9_-]{22}$/);
/** Trials started together (one `galahad trial run`) share a run id: the Galahad Index is computed per run. */
export const TrialRunId = z.string().regex(/^r-[a-z0-9]{1,16}$/);
const Slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,59}$/);

export const TrialAnswer = z.strictObject({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  units: z.string().max(20),
  expected: z.number(),
  /** What Galahad answered (null: missing or not a number). */
  got: z.number().nullable(),
  /** Absolute: |got − expected| ≤ tolerance passes. */
  tolerance: z.number().min(0),
  ok: z.boolean(),
});
export type TrialAnswer = z.infer<typeof TrialAnswer>;

export const TrialRecord = z.strictObject({
  run: TrialRunId,
  suite: Slug,
  problem: Slug,
  title: z.string().min(1).max(200),
  domain: Slug,
  /** The parameters' seed: the same seed is the same problem. */
  seed: z.number().int().min(0).max(0xffffffff),
  /** scored: graded; crashed: the run itself failed (no sandbox, no model…), which says nothing about ability. */
  status: z.enum(["scored", "crashed"]),
  score: z.number().min(0).max(1),
  answers: z.array(TrialAnswer).max(16),
  quest: z
    .strictObject({ status: z.enum(["done", "unverified", "gave-up", "stopped"]), steps: z.number().int().min(0), revisions: z.number().int().min(0) })
    .optional(),
  /** The models that did the work (planner, engineer, reviewer as they answered). */
  models: z.array(z.string().max(120)).max(8),
  /** Galahad's revision that ran it. */
  version: z.string().max(64),
  seconds: z.number().int().min(0),
  artifact: z.string().regex(/^art_[A-Za-z0-9_-]{22}$/).optional(),
  note: z.string().max(1000).optional(),
});
export type TrialRecord = z.infer<typeof TrialRecord>;

/**
 * How a run was run: its effort (attempts per trial, the best taken by the reviewer on the evidence before
 * anything is graded) and how many trials ran at once. Read leniently from the log (trial.run).
 */
export const TrialRunSettings = z.object({ effort: EffortLevel, parallel: z.number().int().min(1).max(64).optional() });
export type TrialRunSettings = z.infer<typeof TrialRunSettings>;

/** An answer passes when it is within its tolerance of the exact one. */
export const answerOk = (got: number | null, expected: number, tolerance: number): boolean =>
  got !== null && Number.isFinite(got) && Math.abs(got - expected) <= tolerance;

/** The score is the share of answers that pass. */
export const trialScore = (answers: readonly { ok: boolean }[]): number => (answers.length ? answers.filter((a) => a.ok).length / answers.length : 0);

/**
 * Why a record doesn't add up, or null. Every replica runs this: a verdict or a score
 * that doesn't follow from the recorded numbers is refused, so nobody can inflate one.
 */
export function trialProblem(record: Pick<TrialRecord, "status" | "score" | "answers">): string | null {
  for (const a of record.answers) {
    if (a.ok !== answerOk(a.got, a.expected, a.tolerance)) return `answer ${a.key}'s verdict doesn't follow from its numbers`;
  }
  if (new Set(record.answers.map((a) => a.key)).size !== record.answers.length) return "an answer is listed twice";
  if (record.status === "scored" && !record.answers.length) return "a scored trial has answers";
  const score = record.status === "crashed" ? 0 : trialScore(record.answers);
  if (Math.abs(record.score - score) > 1e-12) return "the score doesn't follow from the answers";
  return null;
}
