import { describe, expect, test } from "bun:test";
import { fuzzyMatch, rank } from "./fuzzy.ts";
import { type Block, type Inline, inlineText, parseInline, parseMarkdown, safeHref } from "./markdown.ts";
import { describeSchedule, scheduleProblem } from "./schedule.ts";
import { detectProvider, matchRanges, parseCommand } from "./text.ts";
import { countdown, duration, hlcMs, minutesLabel, relativeTime } from "./time.ts";

const text = (v: string): Inline => ({ t: "text", v });

describe("markdown-lite", () => {
  test("paragraphs keep single newlines as line breaks", () => {
    expect(parseMarkdown("one\ntwo\n\nthree")).toEqual([
      { t: "p", c: [text("one"), { t: "br" }, text("two")] },
      { t: "p", c: [text("three")] },
    ]);
  });

  test("raw HTML is never interpreted: it stays literal text", () => {
    const blocks = parseMarkdown('<img src=x onerror="alert(1)"> <script>alert(1)</script>');
    expect(blocks).toEqual([{ t: "p", c: [text('<img src=x onerror="alert(1)"> <script>alert(1)</script>')] }]);
  });

  test("only http(s) links become links", () => {
    expect(parseInline("[ok](https://example.com/a)")).toEqual([{ t: "link", href: "https://example.com/a", c: [text("ok")] }]);
    expect(parseInline("[bad](javascript:alert(1))")).toEqual([text("[bad](javascript:alert(1))")]);
    expect(parseInline("[bad](data:text/html,x)")).toEqual([text("[bad](data:text/html,x)")]);
    expect(safeHref("JAVASCRIPT:alert(1)")).toBeNull();
    expect(safeHref("https://example.com")).toBe("https://example.com/");
  });

  test("bare URLs are linked without trailing punctuation", () => {
    expect(parseInline("see https://example.com/x.")).toEqual([
      text("see "),
      { t: "link", href: "https://example.com/x", c: [text("https://example.com/x")] },
      text("."),
    ]);
  });

  test("fenced code keeps its content verbatim, and an unclosed fence is still code (streaming)", () => {
    expect(parseMarkdown("```ts\nconst a = **b**;\n```")).toEqual([{ t: "code", lang: "ts", v: "const a = **b**;", open: false }]);
    expect(parseMarkdown("intro\n```\nhalf")).toEqual([
      { t: "p", c: [text("intro")] },
      { t: "code", lang: "", v: "half", open: true },
    ]);
  });

  test("inline code, bold, italic and strike", () => {
    expect(parseInline("a `x*y*` **b** *c* ~~d~~ snake_case_name")).toEqual([
      text("a "),
      { t: "code", v: "x*y*" },
      text(" "),
      { t: "strong", c: [text("b")] },
      text(" "),
      { t: "em", c: [text("c")] },
      text(" "),
      { t: "del", c: [text("d")] },
      text(" snake_case_name"),
    ]);
    expect(parseInline("2 * 3 * 4")).toEqual([text("2 * 3 * 4")]);
    expect(parseInline("**unclosed")).toEqual([text("**unclosed")]);
  });

  test("lists, nested by indentation", () => {
    const blocks = parseMarkdown("- one\n- two\n  - deep\n3. not this list");
    expect(blocks[0]).toEqual({
      t: "list",
      ordered: false,
      start: 1,
      items: [
        [{ t: "p", c: [text("one")] }],
        [
          { t: "p", c: [text("two")] },
          { t: "list", ordered: false, start: 1, items: [[{ t: "p", c: [text("deep")] }]] },
        ],
      ],
    });
    expect(blocks[1]).toMatchObject({ t: "list", ordered: true, start: 3 });
  });

  test("headings, quotes, rules and tables", () => {
    const blocks = parseMarkdown("## Plan\n> careful\n---\n| a | b |\n|:--|--:|\n| 1 | `x|y` |");
    expect(blocks[0]).toEqual({ t: "h", level: 2, c: [text("Plan")] });
    expect(blocks[1]).toEqual({ t: "quote", c: [{ t: "p", c: [text("careful")] }] });
    expect(blocks[2]).toEqual({ t: "hr" });
    const table = blocks[3] as Extract<Block, { t: "table" }>;
    expect(table.align).toEqual(["left", "right"]);
    expect(table.rows[0]!.map(inlineText)).toEqual(["1", "x|y"]);
  });

  test("pathological input stays bounded (it is re-parsed every frame while streaming)", () => {
    const deep = `${"> ".repeat(200)}x`;
    expect(() => parseMarkdown(deep)).not.toThrow();
    // Bounded means linear: four times the input takes about four times as long, on any machine
    // (a quadratic parser would take sixteen). The fastest of a few runs keeps a pause out of it.
    const fastest = (text: string) => {
      let best = Infinity;
      for (let i = 0; i < 5; i++) {
        const started = performance.now();
        parseMarkdown(text);
        best = Math.min(best, performance.now() - started);
      }
      return best;
    };
    for (const unit of ["*a ", "a *b ", "_x ", "**a ", "~~a "]) {
      parseMarkdown(unit.repeat(1000)); // warm
      expect(fastest(unit.repeat(8000)) / fastest(unit.repeat(2000))).toBeLessThan(10);
    }
  });

  test("link text never nests another link", () => {
    const [link] = parseInline("[https://example.com](https://evil.example/x)");
    expect(link).toEqual({ t: "link", href: "https://evil.example/x", c: [text("https://example.com")] });
  });
});

describe("fuzzy search", () => {
  test("subsequence match with word-start preference", () => {
    expect(fuzzyMatch("nc", "New chat")?.indices).toEqual([0, 4]);
    expect(fuzzyMatch("xyz", "New chat")).toBeNull();
  });

  test("rank puts prefix and word-start matches first", () => {
    const items = [{ label: "Invite a machine" }, { label: "New chat" }, { label: "Theme: dark" }];
    expect(rank("nc", items)[0]!.item.label).toBe("New chat");
    expect(rank("dark", items)[0]!.item.label).toBe("Theme: dark");
    expect(rank("", items).map((r) => r.item.label)).toEqual(items.map((i) => i.label));
  });

  test("keywords are searchable", () => {
    expect(rank("api key", [{ label: "Add a key", keywords: ["api key", "secret"] }])).toHaveLength(1);
  });
});

describe("text helpers", () => {
  test("matchRanges merges overlapping hits case-insensitively", () => {
    expect(matchRanges("Tailscale serve on tailnet", "tail")).toEqual([
      [0, 4],
      [19, 23],
    ]);
    expect(matchRanges("abc", "")).toEqual([]);
  });

  test("parseCommand splits argv and routes shell syntax through sh -c", () => {
    expect(parseCommand(`git commit -m "first try" 'it''s'`)).toEqual({ argv: ["git", "commit", "-m", "first try", "its"], viaShell: false });
    expect(parseCommand("ls -la | head")).toEqual({ argv: ["sh", "-c", "ls -la | head"], viaShell: true });
    expect(parseCommand('echo "$HOME"')).toEqual({ argv: ["sh", "-c", 'echo "$HOME"'], viaShell: true });
    expect(parseCommand("echo 'a|b'")).toEqual({ argv: ["echo", "a|b"], viaShell: false });
    expect(parseCommand("   ")).toEqual({ argv: [], viaShell: false });
  });

  test("detectProvider: the longest prefix wins", () => {
    const presets = [
      { id: "openai", keyPrefixes: ["sk-"] },
      { id: "orcarouter", keyPrefixes: ["sk-orca-"] },
      { id: "anthropic", keyPrefixes: ["sk-ant-"] },
      { id: "deepseek" },
    ];
    expect(detectProvider("sk-orca-abc", presets)).toBe("orcarouter");
    expect(detectProvider("sk-ant-abc", presets)).toBe("anthropic");
    expect(detectProvider("sk-abc", presets)).toBe("openai");
    expect(detectProvider("nothing", presets)).toBeNull();
  });
});

describe("time", () => {
  test("hlc carries wall-clock milliseconds before the dot", () => {
    expect(hlcMs("001762689012345.000003")).toBe(1762689012345);
    expect(hlcMs("000001762689012345.000003")).toBe(1762689012345);
    expect(hlcMs("garbage")).toBeNull();
  });

  test("relative and durations read like people speak", () => {
    const now = Date.UTC(2026, 10, 9, 12, 0, 0);
    expect(relativeTime(now - 10_000, now)).toBe("just now");
    expect(relativeTime(now - 4 * 60_000, now)).toBe("4 min ago");
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe("3 h ago");
    expect(relativeTime(now + 5 * 60_000, now)).toBe("in 5 min");
    expect(duration(850)).toBe("850 ms");
    expect(duration(4_200)).toBe("4.2 s");
    expect(duration(200_000)).toBe("3 min 20 s");
    expect(countdown(9 * 60_000 + 5_000)).toBe("9:05");
    expect(minutesLabel(90)).toBe("1 h 30 min");
    expect(minutesLabel(24 * 60)).toBe("1 d");
  });
});

describe("schedules", () => {
  test("intervals and common cron lines read like people say them", () => {
    expect(describeSchedule("every 30m")).toBe("Every 30 minutes");
    expect(describeSchedule("every 1h")).toBe("Every hour");
    expect(describeSchedule("Every 2 d")).toBe("Every 2 days");
    expect(describeSchedule("*/15 * * * *")).toBe("Every 15 minutes");
    expect(describeSchedule("0 * * * *")).toBe("Every hour");
    expect(describeSchedule("@hourly")).toBe("Every hour");
    expect(describeSchedule("30 * * * *")).toBe("Every hour at :30");
    expect(describeSchedule("0 7 * * *")).toBe("Every day at 07:00");
    expect(describeSchedule("0 7 * * 1-5")).toBe("Weekdays at 07:00");
    expect(describeSchedule("0 9 * * sat,sun")).toBe("Weekends at 09:00");
    expect(describeSchedule("15 18 * * 5-7")).toBe("Fri, Sat, Sun at 18:15");
    expect(describeSchedule("0 8 * * 1")).toBe("Mondays at 08:00");
    expect(describeSchedule("0 8 * * 7")).toBe("Sundays at 08:00");
    expect(describeSchedule("0 6 1 * *")).toBe("Monthly on day 1 at 06:00");
  });

  test("anything unusual is left as written", () => {
    expect(describeSchedule("0 7 * 1 *")).toBeNull();
    expect(describeSchedule("0 7,19 * * *")).toBeNull();
    expect(describeSchedule("0 7 * * */2")).toBeNull();
    expect(describeSchedule("whenever")).toBeNull();
  });

  test("the quick check catches the wrong shape and leaves values to the node", () => {
    expect(scheduleProblem("")).not.toBeNull();
    expect(scheduleProblem("every 30m")).toBeNull();
    expect(scheduleProblem("every thirty minutes")).not.toBeNull();
    expect(scheduleProblem("0 7 * * 1-5")).toBeNull();
    expect(scheduleProblem("@daily")).toBeNull();
    expect(scheduleProblem("0 7 * *")).not.toBeNull();
  });
});
