import { describe, expect, test } from "bun:test";
import type { NamedRule } from "@galahad/core";
import { commandWords } from "../src/shell-paths.ts";
import { compileGlob, globMatches, tripOf } from "../src/tripwires.ts";

/*
 * Tripwires: your rules, checked before a command runs. A rule's globs are matched against the command's words as
 * shell-paths' tokenizer splits them (quotes taken away, simple commands apart, a here-document's lines left out),
 * and its piece of text against the whole command. Globs, never regular expressions: matching costs at most the
 * glob's length times the word's, whatever the glob, so no rule can make a check hang.
 */

const matches = (glob: string, word: string): boolean => globMatches(compileGlob(glob), word);

describe("a glob, against a word", () => {
  test("*.lock: a lockfile wherever it is, and nothing that only starts like one", () => {
    for (const word of ["bun.lock", "yarn.lock", "web/bun.lock", "/work/repo/Cargo.lock", ".lock"]) expect(matches("*.lock", word), word).toBe(true);
    for (const word of ["bun.lockb", "bun.lock.bak", "bunlock", "lock", "bun.LOCK"]) expect(matches("*.lock", word), word).toBe(false);
  });

  test(".env*: an env file in any folder, and nothing that only ends like one", () => {
    for (const word of [".env", ".env.local", "config/.env.production", "./.envrc"]) expect(matches(".env*", word), word).toBe(true);
    for (const word of ["x.env", "env", ".en", "config.env/x"]) expect(matches(".env*", word), word).toBe(false);
  });

  test("migrations/**: the folder, anything in it at any depth, wherever the folder is", () => {
    for (const word of ["migrations", "migrations/", "migrations/001_init.sql", "db/migrations/2026/11/x.sql", "./migrations/x", "/work/repo/migrations"]) {
      expect(matches("migrations/**", word), word).toBe(true);
    }
    for (const word of ["migrations.txt", "mymigrations/x", "migrations-old/x", "db/migration/x"]) expect(matches("migrations/**", word), word).toBe(false);
  });

  test("rm: the command by its name or its path, never another word that holds it", () => {
    for (const word of ["rm", "/bin/rm", "/usr/bin/rm"]) expect(matches("rm", word), word).toBe(true);
    for (const word of ["rmdir", "-rm", "arm", "rm/x", "RM"]) expect(matches("rm", word), word).toBe(false);
  });

  test("* and ? never cross a /, ** does, and **/ may be no folder at all", () => {
    expect(matches("src/*.ts", "src/a.ts")).toBe(true);
    expect(matches("src/*.ts", "packages/web/src/a.ts")).toBe(true);
    expect(matches("src/*.ts", "src/lib/a.ts")).toBe(false);
    expect(matches("src/**/*.ts", "src/lib/deep/a.ts")).toBe(true);
    expect(matches("src/**/*.ts", "src/a.ts")).toBe(true);
    expect(matches("src/**.ts", "src/lib/a.ts")).toBe(true);
    expect(matches("file?.txt", "file1.txt")).toBe(true);
    expect(matches("file?.txt", "file10.txt")).toBe(false);
    expect(matches("a?b", "a/b")).toBe(false);
  });

  test("one that starts with / is the whole word: an absolute path, not one that ends like it", () => {
    for (const word of ["/etc", "/etc/passwd", "/etc/ssh/sshd_config"]) expect(matches("/etc/**", word), word).toBe(true);
    for (const word of ["etc/passwd", "/work/etc/passwd", "x/etc"]) expect(matches("/etc/**", word), word).toBe(false);
  });

  test("every other character is itself: no classes, no alternatives, no escapes", () => {
    expect(matches("[ab].txt", "[ab].txt")).toBe(true);
    expect(matches("[ab].txt", "a.txt")).toBe(false);
    expect(matches("a+b", "a+b")).toBe(true);
    expect(matches("a+b", "aab")).toBe(false);
    expect(matches("{x,y}", "x")).toBe(false);
    expect(matches("(.*)", "(.*)")).toBe(true);
    expect(matches("(.*)", "anything")).toBe(false);
  });

  test("no catastrophic backtracking: a glob of many stars against a long word that almost matches answers at once", () => {
    const word = "a".repeat(30_000);
    const started = performance.now();
    expect(matches(`${"*a".repeat(12)}*b`, word)).toBe(false);
    expect(matches(`${"**a".repeat(12)}**b`, `${"a/".repeat(15_000)}`)).toBe(false);
    expect(matches(`${"*a".repeat(12)}*`, word)).toBe(true);
    // (As a regular expression, the first alone takes longer than the age of the universe.)
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe("a command's words, as the tokenizer splits them", () => {
  const trips = (glob: string, command: string): boolean => commandWords(command).some((word) => matches(glob, word));

  test("inside quotes and escapes: the word the shell reads", () => {
    for (const command of ["rm 'bun.lock'", 'rm "bun.lock"', "rm bun\\.lock", "rm \"web/my dir/bun.lock\"", "git add -- 'bun'.lock"]) expect(trips("*.lock", command), command).toBe(true);
    for (const command of ["r'm' -f x", 'r"m" x', "\\rm x"]) expect(trips("rm", command), command).toBe(true);
  });

  test("in compound commands: every simple command, whatever joins them", () => {
    for (const command of [
      "cd web && rm -f bun.lock",
      "true; rm bun.lock",
      "make || rm -rf build",
      "ls | xargs rm",
      "(cd web; rm x)",
      "sleep 1 & rm x",
      "bun install\nrm bun.lock",
    ]) expect(trips("rm", command), command).toBe(true);
    for (const command of ["printf x > bun.lock", "echo hi>bun.lock", "bun install 2>bun.lock", "cat bun.lock | wc -l"]) expect(trips("*.lock", command), command).toBe(true);
  });

  test("a here-document: the command around it is read, its lines are what it reads, not what it runs", () => {
    expect(trips(".env*", "cat > .env <<'EOF'\nKEY=1\nEOF")).toBe(true);
    expect(trips("*.lock", "cat <<EOF > bun.lock\n{}\nEOF")).toBe(true);
    expect(trips("*.lock", "cat > notes.md <<'EOF'\nnever touch bun.lock\nEOF")).toBe(false);
    expect(trips("rm", "cat > clean.sh <<'EOF'\nrm -rf build\nEOF\nchmod +x clean.sh")).toBe(false);
    // ...and what follows the here-document is a command again.
    expect(trips("rm", "cat > clean.sh <<'EOF'\nset -e\nEOF\nrm clean.sh")).toBe(true);
    // A here-document whose end never comes is not taken on trust: its lines are read.
    expect(trips("rm", "echo 'see <<EOF in the docs'\nrm bun.lock")).toBe(true);
  });

  test("a command given to another shell to run is read as one: bash -c, ssh, a substitution", () => {
    for (const command of ["bash -c 'rm -rf migrations'", "ssh box \"cd app && rm bun.lock\"", "echo $(rm bun.lock)", "x=`rm -f a`", "timeout 60 sh -c \"r'm' x\""]) {
      expect(trips("rm", command), command).toBe(true);
    }
    expect(trips("migrations/**", "bash -c 'rm -rf migrations'")).toBe(true);
    expect(trips("bun.lock", "bun install --lockfile=bun.lock")).toBe(true);
  });

  test("a command the tokenizer can't read for certain is still read, at its spaces and punctuation", () => {
    expect(trips("rm", "rm bun.lock # don't")).toBe(true);
    expect(trips("*.lock", "cat bun.lock 'unclosed")).toBe(true);
  });
});

const rule = (name: string, does: "halt" | "refuse", words: string[], contains?: string): NamedRule => ({ name, on: "command", does, words, ...(contains !== undefined ? { contains } : {}) });

describe("a rule, against a command", () => {
  test("its globs trip on a word, and it says which word and which glob", () => {
    expect(tripOf([rule("no-locks", "halt", ["*.lock", "package-lock.json"])], "cd web && rm -f bun.lock")).toEqual({ rule: "no-locks", does: "halt", why: "the word `bun.lock` matches `*.lock`" });
    expect(tripOf([rule("no-locks", "halt", ["*.lock"])], "bun test")).toBeNull();
  });

  test("its piece of text trips on the whole command, here-documents included, and case counts", () => {
    expect(tripOf([rule("no-push", "refuse", [], "git push")], "git add -A && git push origin main")).toEqual({ rule: "no-push", does: "refuse", why: "it holds `git push`" });
    expect(tripOf([rule("no-drops", "refuse", [], "DROP TABLE")], "psql <<'SQL'\nDROP TABLE users;\nSQL")).toEqual({ rule: "no-drops", does: "refuse", why: "it holds `DROP TABLE`" });
    expect(tripOf([rule("no-push", "refuse", [], "git push")], "GIT PUSH")).toBeNull();
  });

  test("with both, both must hold", () => {
    const force = [rule("no-force", "refuse", ["git"], "--force")];
    expect(tripOf(force, "git push --force")).toEqual({ rule: "no-force", does: "refuse", why: "the word `git` matches `git`, and it holds `--force`" });
    expect(tripOf(force, "git push")).toBeNull();
    expect(tripOf(force, "echo --force")).toBeNull();
  });

  test("of several, a halt comes before a refusal, then by name: the same answer every time", () => {
    const rules = [rule("b-refuse", "refuse", ["rm"]), rule("z-halt", "halt", ["*.lock"]), rule("a-halt", "halt", ["rm"]), rule("a-refuse", "refuse", ["*.lock"])];
    expect(tripOf(rules, "rm bun.lock")?.rule).toBe("a-halt");
    expect(tripOf([...rules].reverse(), "rm bun.lock")?.rule).toBe("a-halt");
    expect(tripOf(rules.filter((r) => r.does === "refuse"), "rm bun.lock")?.rule).toBe("a-refuse");
    expect(tripOf([], "rm -rf /")).toBeNull();
  });
});
