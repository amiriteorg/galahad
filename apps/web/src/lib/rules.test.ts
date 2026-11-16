import { describe, expect, test } from "bun:test";
import { MAX_RULE_GLOBS as CONTRACT_GLOBS, RuleInput } from "@galahad/core";
import { globsFromText, MAX_GLOB_LENGTH, MAX_RULE_GLOBS, MAX_TEXT_LENGTH, ruleFromForm, ruleParts, ruleWhen } from "./rules.ts";

describe("a tripwire typed into the app", () => {
  test("its globs at spaces, commas or new lines, each once, as typed", () => {
    expect(globsFromText("*.lock, package-lock.json\n.env*  migrations/** *.lock")).toEqual(["*.lock", "package-lock.json", ".env*", "migrations/**"]);
    expect(globsFromText("   ")).toEqual([]);
  });

  test("what the form says is what the node takes: a name, what it does, its globs, the text it must hold", () => {
    expect(ruleFromForm({ name: "no-locks", does: "halt", globs: "*.lock package-lock.json", contains: "" })).toEqual({ rule: { name: "no-locks", does: "halt", words: ["*.lock", "package-lock.json"] } });
    expect(ruleFromForm({ name: "no-push", does: "refuse", globs: "", contains: "  git push " })).toEqual({ rule: { name: "no-push", does: "refuse", words: [], contains: "git push" } });
    for (const draft of [
      { name: "no-locks", does: "halt" as const, globs: "*.lock", contains: "" },
      { name: "no-force", does: "refuse" as const, globs: "git", contains: "--force" },
    ]) {
      const made = ruleFromForm(draft);
      expect("rule" in made && RuleInput.safeParse(made.rule).success).toBe(true);
    }
  });

  test("what isn't a rule is said before anything is sent", () => {
    const problem = (draft: Partial<Parameters<typeof ruleFromForm>[0]>) => {
      const made = ruleFromForm({ name: "no-locks", does: "halt", globs: "*.lock", contains: "", ...draft });
      return "problem" in made ? made.problem : null;
    };
    expect(problem({ name: "No Locks" })).toBe("Its name: lowercase letters, digits and . _ - (at most 40), starting with a letter or digit.");
    expect(problem({ name: "" })).toBe("Its name: lowercase letters, digits and . _ - (at most 40), starting with a letter or digit.");
    expect(problem({ globs: "", contains: "" })).toBe("Give it a glob to match a command's words, or a piece of text it must hold.");
    expect(problem({ globs: Array.from({ length: MAX_RULE_GLOBS + 1 }, (_, i) => `g${i}`).join(" ") })).toBe("A tripwire takes at most 8 globs (this is 9).");
    expect(problem({ globs: `ok ${"x".repeat(MAX_GLOB_LENGTH + 1)}` })).toBe("Glob 2 is longer than 100 characters.");
    expect(problem({ contains: "x".repeat(MAX_TEXT_LENGTH + 1) })).toBe("The text it must hold is longer than 200 characters.");
  });

  test("the app's limits are the contract's", () => {
    expect(MAX_RULE_GLOBS).toBe(CONTRACT_GLOBS);
    const rule = (words: string[], contains?: string) => RuleInput.safeParse({ name: "r", does: "halt", words, ...(contains ? { contains } : {}) }).success;
    expect(rule(["x".repeat(MAX_GLOB_LENGTH)])).toBe(true);
    expect(rule(["x".repeat(MAX_GLOB_LENGTH + 1)])).toBe(false);
    expect(rule([], "x".repeat(MAX_TEXT_LENGTH))).toBe(true);
    expect(rule([], "x".repeat(MAX_TEXT_LENGTH + 1))).toBe(false);
    for (const name of ["no-locks", "a", "x".repeat(40)]) expect("rule" in ruleFromForm({ name, does: "halt", globs: "x", contains: "" })).toBe(RuleInput.safeParse({ name, does: "halt", words: ["x"] }).success);
    for (const name of ["-x", "x".repeat(41), "No"]) expect("rule" in ruleFromForm({ name, does: "halt", globs: "x", contains: "" })).toBe(RuleInput.safeParse({ name, does: "halt", words: ["x"] }).success);
  });
});

describe("a tripwire in words", () => {
  test("what it does, and when (the terminal says the same)", () => {
    expect(ruleWhen({ does: "halt", words: ["*.lock", "package-lock.json"] })).toBe("halts the work when a word matches *.lock or package-lock.json");
    expect(ruleWhen({ does: "refuse", words: [], contains: "git push" })).toBe('refuses the command when it holds "git push"');
    expect(ruleWhen({ does: "refuse", words: ["git"], contains: "--force" })).toBe('refuses the command when a word matches git and it holds "--force"');
    expect(ruleWhen({ does: "refuse", words: ["a", "b", "c"] })).toBe("refuses the command when a word matches a, b or c");
  });

  test("in parts, so what it matches is shown as written: each glob, and its text", () => {
    expect(ruleParts({ does: "refuse", words: ["git", "gh"], contains: "--force" })).toEqual([
      { kind: "words", text: "refuses the command when " },
      { kind: "words", text: "a word matches " },
      { kind: "glob", text: "git" },
      { kind: "words", text: " or " },
      { kind: "glob", text: "gh" },
      { kind: "words", text: " and it holds " },
      { kind: "text", text: "--force" },
    ]);
  });
});
