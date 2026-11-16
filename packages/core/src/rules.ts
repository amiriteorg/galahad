import { z } from "zod";

/*
 * Your rules (PLAN #23), and their first kind: tripwires on the commands his work runs. A rule is data you write,
 * never code and never a model's judgment: globs matched against a command's words, a piece of text it must hold,
 * and what happens to a command that trips it. Only you write them: the mind refuses one that isn't your word, from
 * a full node (rule.set, rule.removed; the last writer wins, by name), so every replica holds the same rules.
 *
 * The quest loop checks them before each command it runs, each of a parallel batch, and each gate (brain's
 * tripwires.ts). `halt`: the quest or task stops, saying which rule. `refuse`: that command isn't run, the engineer
 * is told which rule refused it and why, and the work goes on.
 */

/** A rule's name: what it is known, replaced and removed by. */
export const RuleName = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,39}$/, "lowercase letters, digits, . _ - (max 40)");

export const RULE_DOES = ["halt", "refuse"] as const;
export type RuleDoes = (typeof RULE_DOES)[number];

/** The most rules you may keep, and the most globs one rule may hold. */
export const MAX_RULES = 32;
export const MAX_RULE_GLOBS = 8;

const oneLine = (text: string): boolean => !/[\u0000-\u001f\u007f]/.test(text);

/**
 * A glob matched against a command's words: `*` is any run of characters but `/`, `**` any run, `?` one character but
 * `/`, and every other character itself (case counts). One that starts with `/` is matched against a whole word; any
 * other against a whole word or what follows any `/` in it: `*.lock` is `bun.lock` and `web/bun.lock`, `rm` is
 * `/bin/rm`, and `migrations/**` is anything in a migrations folder, and the folder itself. Never a regular expression.
 */
export const RuleGlob = z.string().min(1).max(100).refine(oneLine, "a glob is one line of text");

/** A piece of a command's text (here-documents included) that a command must hold to trip the rule. */
export const RuleText = z.string().min(1).max(200).refine(oneLine, "one line of text");

const terms = {
  /** Where it applies: before a command runs (the one point there is yet). */
  on: z.literal("command"),
  does: z.enum(RULE_DOES),
  /** Globs: a word of the command matching one trips the rule (with `contains`: as well as holding that). */
  words: z.array(RuleGlob).max(MAX_RULE_GLOBS),
  contains: RuleText.optional(),
};

const matchesSomething = (rule: { words: string[]; contains?: string }): boolean => rule.words.length > 0 || rule.contains !== undefined;
const SOMETHING = "a rule needs a glob, or a piece of text it must hold (--contains)";

/**
 * A rule as this node reads it from the log, where it is open. A field this node doesn't know is set aside and the rest
 * stands, so an older node applies a newer rule at least as strictly as written; a point or an effect it doesn't have
 * (another `on`, another `does`) is no rule here (readRule: null), and is shown as such.
 */
export const RuleTerms = z.object(terms).refine(matchesSomething, SOMETHING);
export type Rule = z.infer<typeof RuleTerms>;

/** A rule with its name, as the quest loop checks it. */
export type NamedRule = Rule & { name: string };

/** What the log holds for a rule, read: the rule, or null when this node doesn't understand it. */
export function readRule(value: unknown): Rule | null {
  const read = RuleTerms.safeParse(value);
  return read.success ? read.data : null;
}

/** A rule, as you set it (setRule): strict, so a field nobody knows never slips in. */
export const RuleInput = z
  .strictObject({ name: RuleName, does: terms.does, words: terms.words, contains: terms.contains })
  .refine(matchesSomething, SOMETHING);
export type RuleInput = z.infer<typeof RuleInput>;

/** A rule stopped a command of a quest's, said to the node for the ledger (ruleTripped); the node checks the rule stops it. */
export const RuleTrippedInput = z.strictObject({
  quest: z.string().regex(/^[A-Za-z0-9._:-]{1,64}$/),
  rule: RuleName,
  command: z.string().min(1).max(100_000),
  /** It was one of the quest's gates. */
  gate: z.boolean().optional(),
});
export type RuleTrippedInput = z.infer<typeof RuleTrippedInput>;

/** A rule as every surface shows it. */
export interface RuleView {
  name: string;
  /** As this node reads it; null: a newer node's rule this one doesn't understand (kept and shown, not applied here). */
  rule: Rule | null;
  setAt: number;
  /** The device you set it from (null: a terminal on a node). */
  setVia: string | null;
}
