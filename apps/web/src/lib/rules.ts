/*
 * Your tripwires as the app takes and shows them (core's rules.ts): the globs typed into a field, the rule a form
 * says, and what a rule does in words. Pure functions (no DOM), unit-tested. The limits are the contract's, restated
 * here so the app doesn't carry the schema library for them; a test holds the two together.
 */

export const MAX_RULE_GLOBS = 8;
export const MAX_GLOB_LENGTH = 100;
export const MAX_TEXT_LENGTH = 200;
const NAME = /^[a-z0-9][a-z0-9._-]{0,39}$/;

export type RuleDoes = "halt" | "refuse";

/** A rule as the node takes it (POST /api/rules). */
export interface RuleSent {
  name: string;
  does: RuleDoes;
  words: string[];
  contains?: string;
}

/** The globs typed into a field: at spaces, commas or new lines, each once. */
export function globsFromText(text: string): string[] {
  return [...new Set(text.split(/[\s,]+/).filter(Boolean))];
}

/** The rule a form says, or why it won't do. */
export function ruleFromForm(form: { name: string; does: RuleDoes; globs: string; contains: string }): { rule: RuleSent } | { problem: string } {
  const name = form.name.trim();
  if (!NAME.test(name)) return { problem: "Its name: lowercase letters, digits and . _ - (at most 40), starting with a letter or digit." };
  const words = globsFromText(form.globs);
  const contains = form.contains.trim();
  if (!words.length && !contains) return { problem: "Give it a glob to match a command's words, or a piece of text it must hold." };
  if (words.length > MAX_RULE_GLOBS) return { problem: `A tripwire takes at most ${MAX_RULE_GLOBS} globs (this is ${words.length}).` };
  const long = words.findIndex((glob) => glob.length > MAX_GLOB_LENGTH);
  if (long >= 0) return { problem: `Glob ${long + 1} is longer than ${MAX_GLOB_LENGTH} characters.` };
  if (contains.length > MAX_TEXT_LENGTH) return { problem: `The text it must hold is longer than ${MAX_TEXT_LENGTH} characters.` };
  return { rule: { name, does: form.does, words, ...(contains ? { contains } : {}) } };
}

/** A piece of what a rule says: words, or what it matches as written (a glob, its text). */
export interface RulePart {
  kind: "words" | "glob" | "text";
  text: string;
}

/** What a rule does, and when, in parts: what it matches is shown as written. */
export function ruleParts(rule: { does: RuleDoes; words: readonly string[]; contains?: string }): RulePart[] {
  const parts: RulePart[] = [{ kind: "words", text: rule.does === "halt" ? "halts the work when " : "refuses the command when " }];
  if (rule.words.length) {
    parts.push({ kind: "words", text: "a word matches " });
    rule.words.forEach((glob, i) => {
      if (i) parts.push({ kind: "words", text: i === rule.words.length - 1 ? " or " : ", " });
      parts.push({ kind: "glob", text: glob });
    });
  }
  if (rule.contains !== undefined) parts.push({ kind: "words", text: rule.words.length ? " and it holds " : "it holds " }, { kind: "text", text: rule.contains });
  return parts;
}

/** The same in a line (its text in quotes), as the terminal says it. */
export const ruleWhen = (rule: { does: RuleDoes; words: readonly string[]; contains?: string }): string => ruleParts(rule).map((part) => (part.kind === "text" ? `"${part.text}"` : part.text)).join("");
