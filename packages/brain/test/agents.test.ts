import { describe, expect, test } from "bun:test";
import type { ExecResult } from "@galahad/core";
import { AGENT_DIR, type AgentEvent, chooseAgentModels, OPENCODE, runAgent } from "../src/agents.ts";
import { type QuestEvent, type QuestRole, runQuest } from "../src/quest.ts";

/*
 * Coding agents: OpenCode's event stream as Galahad reads it (lines captured from a
 * real run in a microVM, trimmed), and the runner driven against a fake sandbox that
 * plays the background process.
 */

const SESSION = "ses_e3b7b5785ffeWOUAvU1UHA94R4";
const line = (type: string, part: object) => JSON.stringify({ type, timestamp: 1794298395235, sessionID: SESSION, part: { sessionID: SESSION, ...part } });
const LINES = {
  start: line("step_start", { type: "step-start" }),
  shell: line("tool_use", {
    type: "tool",
    tool: "shell",
    state: { status: "completed", input: { command: "python3 test_calc.py", workdir: "/work/repo" }, output: "ok\n", metadata: { metadata: { status: "completed", exit: 0 } } },
  }),
  failing: line("tool_use", {
    type: "tool",
    tool: "shell",
    state: { status: "completed", input: { command: "python3 test_calc.py" }, output: "AssertionError", metadata: { metadata: { exit: 1 } } },
  }),
  edit: line("tool_use", { type: "tool", tool: "edit", state: { status: "completed", input: { filePath: "/work/repo/calc.py", oldString: "a - b", newString: "a + b" }, output: "" } }),
  running: line("tool_use", { type: "tool", tool: "shell", state: { status: "running", input: { command: "sleep 1" } } }),
  finish: line("step_finish", { type: "step-finish", reason: "tool-calls", tokens: { input: 8140, output: 94 } }),
  text: line("text", { type: "text", text: "`python3 test_calc.py` now passes. The bug was `a - b`; it's `a + b` now." }),
};

describe("reading OpenCode", () => {
  test("its events: the session, commands and edits with their outcome, tokens, and its last words", () => {
    const events = Object.values(LINES).flatMap((l) => OPENCODE.read(l)).filter((e) => e.type !== "session");
    expect(events).toEqual([
      { type: "tool", tool: "shell", input: "python3 test_calc.py", output: "ok\n", ok: true },
      { type: "tool", tool: "shell", input: "python3 test_calc.py", output: "AssertionError", ok: false },
      { type: "tool", tool: "edit", input: JSON.stringify({ filePath: "/work/repo/calc.py", oldString: "a - b", newString: "a + b" }), output: "", ok: true },
      { type: "tokens", input: 8140, output: 94 },
      { type: "text", text: "`python3 test_calc.py` now passes. The bug was `a - b`; it's `a + b` now." },
    ]);
    expect(OPENCODE.read(LINES.start)).toEqual([{ type: "session", id: SESSION }]);
    // As seen live: a provider's filter is a failure with a reason.
    expect(OPENCODE.read(JSON.stringify({ type: "provider.content-filter", message: "Provider blocked the response" }))).toEqual([{ type: "error", message: "Provider blocked the response" }]);
    expect(OPENCODE.read("not json")).toEqual([]);
  });

  test("its config: every model through the gateway (never a key), no self-updates, every tool allowed", () => {
    const files = OPENCODE.files([
      { provider: "orcarouter", model: "anthropic/claude-opus-5.5" },
      { provider: "deepseek", model: "deepseek-v4-pro" },
    ]);
    const config = JSON.parse(files["/work/.config/opencode/opencode.json"]!);
    expect(config.model).toBe("g-orcarouter/anthropic/claude-opus-5.5");
    expect(config.update).toBe("disable");
    expect(config.providers["g-orcarouter"].settings).toEqual({ baseURL: "{env:GALAHAD_GATEWAY}/orcarouter", apiKey: "{env:OPENAI_API_KEY}" });
    expect(config.providers["g-deepseek"].settings).toEqual({ baseURL: "{env:GALAHAD_GATEWAY}/deepseek", apiKey: "{env:OPENAI_API_KEY}" });
    expect(Object.keys(config.providers["g-deepseek"].models)).toEqual(["deepseek-v4-pro"]);
    expect(config.permissions).toEqual([{ action: "*", resource: "*", effect: "allow" }]);
  });

  test("its models: the engineer's, in the roster's order, on OpenAI-compatible providers with a key", () => {
    const providers = [
      { id: "anthropic", kind: "anthropic", hasKey: true },
      { id: "orcarouter", kind: "openai", hasKey: true },
      { id: "deepseek", kind: "openai", hasKey: false },
    ];
    const withDeepseek = providers.map((p) => (p.id === "deepseek" ? { ...p, hasKey: true } : p));
    expect(chooseAgentModels(["anthropic/claude-opus-5-5", "ollama/*", "orcarouter/anthropic/claude-opus-5.5", "deepseek/deepseek-v4-pro"], withDeepseek)).toEqual([
      { provider: "orcarouter", model: "anthropic/claude-opus-5.5" },
      { provider: "deepseek", model: "deepseek-v4-pro" },
    ]);
    expect(chooseAgentModels(["deepseek/v4", "orcarouter/x"], providers)).toEqual([{ provider: "orcarouter", model: "x" }]);
    expect(chooseAgentModels(["anthropic/claude-opus-5-5"], providers)).toEqual([]);
  });

  test("a run continues its session when there is one", () => {
    expect(OPENCODE.command({ provider: "p", model: "m" }, null)).not.toContain("--session");
    expect(OPENCODE.command({ provider: "p", model: "m" }, SESSION)).toContain(`--session '${SESSION}'`);
    expect(OPENCODE.command({ provider: "orcarouter", model: "anthropic/claude-opus-5.5" }, null)).toContain("--model 'g-orcarouter/anthropic/claude-opus-5.5'");
  });
});

/** A sandbox that plays a background agent: each poll returns the next batch of lines; then it exits. */
function sandbox(batches: string[][], exit: number | null = 0, options: { stderr?: string; forever?: boolean } = {}) {
  const commands: string[] = [];
  let polls = 0;
  let offset = 0;
  const exec = async (command: string): Promise<ExecResult> => {
    commands.push(command);
    const ok = (stdout = "") => ({ exitCode: 0, stdout, stderr: "", durationMs: 1, truncated: false });
    if (command.startsWith("python3 -c")) {
      const batch = batches[polls] ?? [];
      polls += 1;
      const alive = options.forever || polls < batches.length;
      offset += batch.join("\n").length + (batch.length ? 1 : 0);
      return ok(JSON.stringify({ alive, exit: alive ? null : exit, next: offset, lines: batch }));
    }
    if (command.startsWith("stat -c")) return ok("0\n");
    if (command.startsWith("tail -c 2000")) return ok(options.stderr ?? "");
    return ok();
  };
  return { exec, commands };
}

const model = { provider: "orcarouter", model: "anthropic/claude-opus-5.5" };
const noSleep = async () => {};

describe("running an agent", () => {
  test("started in the background with stdin closed, followed to the end, its last words its summary", async () => {
    const box = sandbox([[LINES.start, LINES.shell], [LINES.edit, LINES.finish], [LINES.text]]);
    const seen: AgentEvent[] = [];
    const run = await runAgent(OPENCODE, { model, prompt: "Fix it ‘now’", session: null, deadline: Date.now() + 60_000, workdir: "/work/repo" }, { exec: box.exec, sleep: noSleep, event: (e) => seen.push(e) });
    expect(run).toMatchObject({ status: "finished", steps: 2, session: SESSION, tokens: { input: 8140, output: 94 } });
    expect(run.summary).toContain("now passes");
    const launch = box.commands[0]!;
    expect(launch).toContain(`base64 -d > ${AGENT_DIR}/prompt.md`);
    expect(launch).toContain("cd '/work/repo'");
    expect(launch).toContain("setsid bash -c");
    expect(launch).toContain("< /dev/null");
    expect(Buffer.from(launch.match(/printf %s '([A-Za-z0-9+/=]+)'/)![1]!, "base64").toString("utf8")).toBe("Fix it ‘now’");
    expect(seen.filter((e) => e.type === "tool")).toHaveLength(2);
  });

  test("every command it sends the sandbox is valid shell (seen live: `… & && echo $!` broke the launch)", async () => {
    const box = sandbox([[LINES.start], [LINES.shell]], null, { forever: true });
    let t = 0;
    await runAgent(OPENCODE, { model, prompt: "it's \"quoted\" & $(dangerous)", session: SESSION, deadline: 15_000, workdir: "/work/my repo" }, { exec: box.exec, sleep: noSleep, now: () => (t += 10_000) });
    const kinds = new Set(box.commands.map((c) => c.split(" ")[0]));
    expect([...kinds].sort()).toEqual(["kill", "mkdir", "python3", "stat"]);
    for (const command of box.commands) {
      const check = Bun.spawnSync(["bash", "-n", "-c", command]);
      expect({ command: command.slice(0, 120), stderr: check.stderr.toString() }).toEqual({ command: command.slice(0, 120), stderr: "" });
    }
  });

  test("a failed run says why: its exit, its last error, its stderr", async () => {
    const box = sandbox([[LINES.start]], 1, { stderr: "provider galahad: 401 unknown token" });
    const run = await runAgent(OPENCODE, { model, prompt: "x", session: null, deadline: Date.now() + 60_000, workdir: "/work" }, { exec: box.exec, sleep: noSleep });
    expect(run.status).toBe("failed");
    expect(run.error).toContain("exited with 1");
    expect(run.error).toContain("401 unknown token");
  });

  test("past its deadline it's stopped, its whole process group", async () => {
    const box = sandbox([[LINES.start], [LINES.shell]], null, { forever: true });
    let t = 0;
    const run = await runAgent(OPENCODE, { model, prompt: "x", session: null, deadline: 25_000, workdir: "/work" }, { exec: box.exec, sleep: noSleep, now: () => (t += 10_000) });
    expect(run.status).toBe("timeout");
    expect(box.commands.some((c) => c.startsWith(`kill -TERM -- -$(cat ${AGENT_DIR}/pid)`))).toBe(true);
  });

  test("stopped by you: it's stopped", async () => {
    const controller = new AbortController();
    controller.abort();
    const box = sandbox([[LINES.start]], null, { forever: true });
    const run = await runAgent(OPENCODE, { model, prompt: "x", session: null, deadline: Date.now() + 60_000, workdir: "/work" }, { exec: box.exec, sleep: noSleep, signal: controller.signal });
    expect(run.status).toBe("stopped");
  });
});

describe("a quest with a coding agent", () => {
  test("plan, the agent's run, an independent review; the reviewer's notes continue the agent's session", async () => {
    const replies: Record<QuestRole, string[]> = { planner: ["1. Fix calc.py.\nDone when: the test passes."], engineer: [], reviewer: ["REVISE\nAlso add a test for negative numbers.", "PASS\nBoth tests pass in the sandbox."] };
    const box = sandbox([[LINES.start, LINES.shell, LINES.text]]);
    let runs = 0;
    const commands: string[] = [];
    const exec = async (command: string) => {
      commands.push(command);
      if (command.startsWith("mkdir -p /work/.agent")) runs += 1;
      if (runs === 2 && command.startsWith("python3 -c")) {
        return { exitCode: 0, stdout: JSON.stringify({ alive: false, exit: 0, next: 9999, lines: [LINES.edit, LINES.text] }), stderr: "", durationMs: 1, truncated: false };
      }
      return box.exec(command);
    };
    const asked: QuestRole[] = [];
    const events: QuestEvent[] = [];
    const outcome = await runQuest(
      { goal: "make the test pass", environment: "a sandbox", evidence: ["cd /work/repo && git diff --stat"], agent: { driver: OPENCODE, models: [model], minutes: 30, workdir: "/work/repo" } },
      {
        ask: async (role) => {
          asked.push(role);
          return { text: replies[role].shift()!, model: `test/${role}` };
        },
        exec,
        emit: (e) => events.push(e),
        sleep: noSleep,
      },
    );
    expect(outcome).toMatchObject({ status: "done", revisions: 1, steps: 2 });
    expect(asked).toEqual(["planner", "reviewer", "reviewer"]);
    // Its config was written first; the second run continued the session with the reviewer's notes.
    expect(commands[0]).toContain("/work/.config/opencode/opencode.json");
    const launches = commands.filter((c) => c.startsWith("mkdir -p /work/.agent"));
    expect(launches[1]).toContain(`--session`);
    const second = Buffer.from(launches[1]!.match(/printf %s '([A-Za-z0-9+/=]+)'/)![1]!, "base64").toString("utf8");
    expect(second).toContain("Also add a test for negative numbers.");
    // The reviewer saw the evidence from the sandbox.
    expect(commands).toContain("cd /work/repo && git diff --stat");
    for (const command of commands) expect(Bun.spawnSync(["bash", "-n", "-c", command]).stderr.toString()).toBe("");
    expect(events.some((e) => e.type === "command" && e.command === "shell: python3 test_calc.py")).toBe(true);
  });
});

describe("an agent's model fails", () => {
  test("the next model carries on the same session (seen live: a provider's content filter ended the quest)", async () => {
    const replies: Record<QuestRole, string[]> = { planner: ["1. Count files."], engineer: [], reviewer: ["PASS"] };
    const filtered = JSON.stringify({ type: "provider.content-filter", message: "Provider blocked the response" });
    let runs = 0;
    const launches: string[] = [];
    const exec = async (command: string): Promise<ExecResult> => {
      const ok = (stdout = "") => ({ exitCode: 0, stdout, stderr: "", durationMs: 1, truncated: false });
      if (command.startsWith("mkdir -p /work/.agent")) {
        runs += 1;
        launches.push(command);
        return ok();
      }
      if (command.startsWith("python3 -c")) {
        return ok(JSON.stringify(runs === 1 ? { alive: false, exit: 1, next: 10, lines: [LINES.start, LINES.shell, filtered] } : { alive: false, exit: 0, next: 20, lines: [LINES.edit, LINES.text] }));
      }
      return ok(command.startsWith("stat") ? "0" : "");
    };
    const events: QuestEvent[] = [];
    const outcome = await runQuest(
      {
        goal: "inventory",
        environment: "a sandbox",
        agent: { driver: OPENCODE, models: [model, { provider: "deepseek", model: "deepseek-v4-pro" }], minutes: 30, workdir: "/work/repo" },
      },
      { ask: async (role) => ({ text: replies[role].shift()!, model: `test/${role}` }), exec, emit: (e) => events.push(e), sleep: noSleep },
    );
    expect(outcome.status).toBe("done");
    expect(launches).toHaveLength(2);
    expect(launches[0]).toContain("g-orcarouter/anthropic/claude-opus-5.5");
    expect(launches[1]).toContain("g-deepseek/deepseek-v4-pro");
    expect(launches[1]).toContain("--session");
    expect(launches[1]).toContain(SESSION);
    const second = Buffer.from(launches[1]!.match(/printf %s '([A-Za-z0-9+/=]+)'/)![1]!, "base64").toString("utf8");
    expect(second).toContain("Continue the quest from where you left off");
    expect(second).toContain("Provider blocked the response");
    expect(events.find((e) => e.type === "retry")).toMatchObject({ role: "engineer", attempt: 1 });
  });
});
