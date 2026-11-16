import { describe, expect, test } from "bun:test";
import { readOf, writesOf } from "../src/shell-paths.ts";

describe("which file a command shows", () => {
  test("a plain read of one file names it", () => {
    for (const [command, path] of [
      ["cat src/x.ts", "src/x.ts"],
      ["cat -n ./src/x.ts", "src/x.ts"],
      ["head -n 40 src/x.ts", "src/x.ts"],
      ["head -40 src/x.ts", "src/x.ts"],
      ["tail -n 20 'src/my file.ts'", "src/my file.ts"],
      ["sed -n '1,80p' src/x.ts", "src/x.ts"],
      ["sed -n \"10,20p\" src/x.ts", "src/x.ts"],
      ["nl -ba src/x.ts", "src/x.ts"],
    ] as const) expect(readOf(command)).toBe(path);
  });

  test("anything more than one plain read names nothing: what it showed may not be the file", () => {
    for (const command of [
      "cat src/x.ts | grep foo",
      "cat src/a.ts src/b.ts",
      "cat src/x.ts && bun test",
      "cat $(ls src | head -1)",
      "cat src/*.ts",
      "sed 's/a/b/' src/x.ts",
      "sed -n '1,10p' src/a.ts src/b.ts",
      "head -n",
      "cat",
      "grep -n foo src/x.ts",
      "cat <<'EOF'\nhello\nEOF",
    ]) expect(readOf(command)).toBeNull();
  });
});

describe("which files a command changes", () => {
  test("redirects, in-place edits, tee, moves, copies, removals and restores", () => {
    for (const [command, paths] of [
      ["printf 'x\\n' > src/x.ts", ["src/x.ts"]],
      ["echo y >> ./src/x.ts", ["src/x.ts"]],
      ["cat > src/x.ts <<'EOF'\nexport const a = 1;\nEOF", ["src/x.ts"]],
      ["sed -i 's/a/b/' src/x.ts", ["src/x.ts"]],
      ["sed -i.bak -e 's/a/b/' -e 's/c/d/' src/x.ts src/y.ts", ["src/x.ts", "src/y.ts"]],
      ["sed -i '' 's/a/b/' src/x.ts", ["src/x.ts"]],
      ["bun run gen | tee src/out.json", ["src/out.json"]],
      ["mv src/old.ts src/new.ts", ["src/old.ts", "src/new.ts"]],
      ["cp src/a.ts src/b.ts", ["src/b.ts"]],
      ["rm -f src/x.ts", ["src/x.ts"]],
      ["git checkout -- src/x.ts", ["src/x.ts"]],
      ["git restore src/x.ts", ["src/x.ts"]],
      ["cd src && sed -i 's/a/b/' x.ts && bun test", ["x.ts"]],
      ["bun test 2> err.log", ["err.log"]],
    ] as const) expect(writesOf(command), command).toEqual([...paths]);
  });

  test("reads, tests and searches change nothing", () => {
    for (const command of ["cat src/x.ts", "bun test", "grep -rn foo src", "sed -n '1,5p' src/x.ts", "ls -la", "echo '> not a redirect'", "git diff -- src/x.ts"]) expect(writesOf(command), command).toEqual([]);
  });
});
