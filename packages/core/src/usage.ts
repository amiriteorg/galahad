import { z } from "zod";
import type { Price, Usage, UsageLine } from "./spend.ts";

/*
 * The contracts for what model calls cost (spend.ts has the arithmetic): a call's
 * usage as its provider reported it, a tally by role and model, and the owner's
 * prices. Counts only: never a prompt, never an answer.
 */

const Count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const UsageSchema = z.strictObject({ input: Count, output: Count, cached: Count.optional(), reasoning: Count.optional() }) satisfies z.ZodType<Usage>;

/** A model's ref as a tally keeps it: `<provider>/<model>`, or what a coding agent calls its own. */
const TallyModel = z.string().min(1).max(200);

export const UsageLineSchema = z.strictObject({
  role: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
  model: TallyModel,
  calls: Count,
  unknown: Count,
  input: Count,
  output: Count,
  cached: Count,
  reasoning: Count,
}) satisfies z.ZodType<UsageLine>;

/** The most lines one record carries (roles × models that answered, fallbacks included). */
export const MAX_SPEND_LINES = 24;
export const SpendLines = z.array(UsageLineSchema).max(MAX_SPEND_LINES);

/**
 * What a trial spent: its model calls by role and model. Recorded beside the trial (`trial.spent`), open in
 * the log, read leniently: the Index per token, per second and per dollar is computed from it on every replica.
 */
export const TrialSpent = z.object({ lines: SpendLines });
export type TrialSpent = z.infer<typeof TrialSpent>;

/** A model a price is for: `<provider>/<model>`, or `<provider>/*` for everything that provider serves. */
export const PricedModel = z
  .string()
  .min(3)
  .max(256)
  .regex(/^[A-Za-z0-9._:-]+\/\S+$/, "a price is for <provider>/<model>, or <provider>/* for all of a provider's models");

const Dollars = z.number().min(0).max(100_000);
/** US dollars per million tokens. Read leniently from the log (`price.set`). */
export const PriceSchema = z.object({ input: Dollars, output: Dollars, cached: Dollars.optional() }) satisfies z.ZodType<Price>;

/** A row of this node's own count of its model calls: a day, who asked, the role, the model. */
export interface UsageRow extends UsageLine {
  /** UTC day, YYYY-MM-DD. */
  day: string;
  /** you · arm:<label> (a loop's quest is arm:loop.<name>) · galahad (his own upkeep: the heartbeat's words, skills, the archive). */
  who: string;
}

/** What `GET /api/usage` answers: this node's calls (never another node's), and the owner's prices. */
export interface UsageView {
  node: string;
  /** The first day counted, YYYY-MM-DD (UTC). */
  since: string;
  rows: UsageRow[];
  prices: Record<string, Price>;
}
