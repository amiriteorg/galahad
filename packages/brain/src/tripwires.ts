import type { NamedRule, RuleDoes } from "@galahad/core";
import { commandWords } from "./shell-paths.ts";

/*
 * Tripwires: your rules (core's rules.ts), checked before a command runs. A rule's globs are matched against the
 * command's words (shell-paths' commandWords) and its piece of text against the whole command; the quest loop halts
 * the work or refuses the command on what this says. Deterministic: no model is asked, nothing is run.
 *
 * Globs, never regular expressions: a glob becomes a short list of steps, and a word is read once, left to right,
 * keeping every place in the glob it could have reached by then (an automaton, not backtracking). A check costs at
 * most the glob's length times the word's, whatever the glob, so no rule can make one hang.
 */

/** One step of a glob: a character as itself, `?`, `*`, `**`, or `**` with a `/` after it (no folder, or any folders). */
type Step = { kind: "char"; char: string } | { kind: "one" } | { kind: "star" } | { kind: "any" } | { kind: "dirs" };

export interface Glob {
  steps: Step[];
  /** It starts with `/`: matched against a whole word only. */
  anchored: boolean;
  /** It ends with `/**`: the folder itself, or anything in it. */
  rest: boolean;
}

export function compileGlob(glob: string): Glob {
  const anchored = glob.startsWith("/");
  const rest = glob.length > 3 && glob.endsWith("/**");
  const text = rest ? glob.slice(0, -3) : glob;
  const steps: Step[] = [];
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char === "*" && text[i + 1] === "*") {
      // (Three stars or more are two.)
      let end = i + 2;
      while (text[end] === "*") end++;
      if (text[end] === "/") {
        steps.push({ kind: "dirs" });
        i = end;
      } else {
        steps.push({ kind: "any" });
        i = end - 1;
      }
    } else if (char === "*") steps.push({ kind: "star" });
    else if (char === "?") steps.push({ kind: "one" });
    else steps.push({ kind: "char", char });
  }
  return { steps, anchored, rest };
}

/** Whether a word matches a glob: the whole word, or (unless the glob starts with `/`) what follows any `/` in it. */
export function globMatches(glob: Glob, word: string): boolean {
  const { steps, anchored, rest } = glob;
  const n = steps.length;
  let now = new Uint8Array(n + 1);
  let next = new Uint8Array(n + 1);
  for (let at = 0; ; at++) {
    if (at === 0 || (!anchored && word[at - 1] === "/")) now[0] = 1;
    // A star, `**` and `**/` may match nothing: the step after one may begin here too.
    for (let i = 0; i < n; i++) if (now[i] && steps[i]!.kind !== "char" && steps[i]!.kind !== "one") now[i + 1] = 1;
    if (now[n] && (at === word.length || (rest && word[at] === "/"))) return true;
    if (at === word.length) return false;
    const char = word[at]!;
    next.fill(0);
    for (let i = 0; i < n; i++) {
      if (!now[i]) continue;
      const step = steps[i]!;
      if (step.kind === "char") {
        if (step.char === char) next[i + 1] = 1;
      } else if (step.kind === "one") {
        if (char !== "/") next[i + 1] = 1;
      } else if (step.kind === "star") {
        if (char !== "/") next[i] = 1;
      } else if (step.kind === "any") next[i] = 1;
      else {
        next[i] = 1;
        if (char === "/") next[i + 1] = 1;
      }
    }
    [now, next] = [next, now];
  }
}

/** A command a rule of yours stopped: which rule, what it does, and why, in words (the word and its glob, the text it holds). */
export interface Trip {
  rule: string;
  does: RuleDoes;
  why: string;
}

/** Halts first, then refusals, each by name: whatever order the rules come in, a command trips the same one. */
const first = (a: NamedRule, b: NamedRule): number => (a.does !== b.does ? (a.does === "halt" ? -1 : 1) : a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

const shown = (word: string): string => (word.length > 80 ? `${word.slice(0, 79)}…` : word);

/** The rule a command trips, if any. */
export function tripOf(rules: readonly NamedRule[], command: string): Trip | null {
  let words: string[] | null = null;
  for (const rule of [...rules].sort(first)) {
    if (rule.contains !== undefined && !command.includes(rule.contains)) continue;
    let matched = "";
    if (rule.words.length) {
      words ??= commandWords(command);
      const globs = rule.words.map((glob) => ({ glob, compiled: compileGlob(glob) }));
      for (const word of words) {
        const hit = globs.find((g) => globMatches(g.compiled, word));
        if (!hit) continue;
        matched = `the word \`${shown(word)}\` matches \`${hit.glob}\``;
        break;
      }
      if (!matched) continue;
    }
    const held = rule.contains !== undefined ? `it holds \`${rule.contains}\`` : "";
    return { rule: rule.name, does: rule.does, why: [matched, held].filter(Boolean).join(", and ") };
  }
  return null;
}
