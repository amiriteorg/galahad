import { type ExecResult, redact } from "@galahad/core";

/*
 * Coding agents in the sandbox: for long work on real codebases, a full harness
 * (OpenCode) does the engineer's part instead of the quest's one-command-at-a-time
 * loop. It runs headless in the background inside the sandbox, so it isn't bound by
 * one command's time limit; its model calls go through Galahad's gateway on a token
 * scoped to that sandbox (it never sees a key); Galahad follows its event stream, so
 * every command and edit is visible as it happens; and the independent reviewer
 * still judges the result. Pure orchestration over `exec`, like the quest itself.
 */

/** The model the agent uses, through the gateway. */
export interface AgentModel {
  /** The gateway provider, e.g. "orcarouter". */
  provider: string;
  model: string;
}

export type AgentEvent =
  | { type: "session"; id: string }
  | { type: "text"; text: string }
  | { type: "tool"; tool: string; input: string; output: string; ok: boolean }
  | { type: "tokens"; input: number; output: number }
  | { type: "error"; message: string };

export interface AgentDriver {
  name: string;
  /** Files written before the first run (absolute path → content). */
  files(model: AgentModel): Record<string, string>;
  /** The command for one run, reading its message from AGENT_DIR/prompt.md (a session id continues one). */
  command(model: AgentModel, session: string | null): string;
  /** One line of the event stream, or null if it's nothing to report. */
  read(line: string): AgentEvent[];
}

export const AGENT_DIR = "/work/.agent";

const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const brief = (value: unknown, max: number): string => {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

/**
 * OpenCode (v2, headless): `opencode run --standalone --auto --format json`, stdin closed
 * (with stdin open it waits for more input and never starts). Its state and config live
 * under the sandbox's HOME (/work). Every tool is allowed: the sandbox is the boundary,
 * and its network decides what's reachable.
 */
export const OPENCODE: AgentDriver = {
  name: "opencode",
  files: (model) => ({
    "/work/.config/opencode/opencode.json": JSON.stringify(
      {
        $schema: "https://opencode.ai/config.json",
        update: "disable",
        model: `galahad/${model.model}`,
        providers: {
          galahad: {
            name: `Galahad gateway (${model.provider})`,
            env: ["OPENAI_API_KEY"],
            package: "@opencode/ai/providers/openai-compatible",
            settings: { baseURL: "{env:OPENAI_BASE_URL}", apiKey: "{env:OPENAI_API_KEY}" },
            models: { [model.model]: { name: model.model } },
          },
        },
        permissions: [{ action: "*", resource: "*", effect: "allow" }],
      },
      null,
      2,
    ),
  }),
  command: (_model, session) =>
    `opencode run --standalone --auto --format json --title galahad${session ? ` --session ${quote(session)}` : ""} "$(cat ${AGENT_DIR}/prompt.md)"`,
  read(line) {
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      return [];
    }
    if (!event || typeof event !== "object") return [];
    const out: AgentEvent[] = [];
    if (typeof event.sessionID === "string") out.push({ type: "session", id: event.sessionID });
    const part = event.part ?? {};
    if (event.type === "text" && typeof part.text === "string" && part.text.trim()) out.push({ type: "text", text: part.text });
    if (event.type === "tool_use" && part.state && part.state.status !== "running" && part.state.status !== "pending") {
      const input = part.state.input ?? {};
      out.push({
        type: "tool",
        tool: String(part.tool ?? "tool"),
        input: brief(typeof input.command === "string" ? input.command : input, 2000),
        output: brief(part.state.output ?? part.state.error ?? "", 4000),
        ok: part.state.status === "completed" && (part.state.metadata?.metadata?.exit ?? 0) === 0,
      });
    }
    if (event.type === "step_finish" && part.tokens) out.push({ type: "tokens", input: Number(part.tokens.input) || 0, output: Number(part.tokens.output) || 0 });
    if (/error/i.test(String(event.type))) out.push({ type: "error", message: brief(event.error ?? event.message ?? event, 1000) });
    return out;
  },
};

export const AGENTS: Record<string, AgentDriver> = { opencode: OPENCODE };

export interface AgentRunDeps {
  exec(command: string, timeoutSec: number): Promise<ExecResult>;
  /** Each event as it arrives. */
  event?(event: AgentEvent): void;
  signal?: AbortSignal;
  sleep(ms: number): Promise<void>;
  now?(): number;
}

export interface AgentRun {
  status: "finished" | "failed" | "timeout" | "stopped";
  /** The agent's last words: its own account of what it did. */
  summary: string;
  /** Tool calls it made. */
  steps: number;
  session: string | null;
  tokens: { input: number; output: number };
  /** Why it failed (its exit, its last error, its stderr). */
  error?: string;
}

/** Prints {alive, exit, next, lines} for the events written since byte `offset`. */
const POLL = `import json, os, sys
d, off = ${JSON.stringify(AGENT_DIR)}, int(sys.argv[1])
alive = False
try:
    os.kill(int(open(d + "/pid").read()), 0)
    alive = True
except Exception:
    pass
exit_code = None
try:
    exit_code = int(open(d + "/exit").read())
except Exception:
    pass
lines, nxt = [], off
try:
    with open(d + "/events.jsonl", "rb") as f:
        f.seek(off)
        data = f.read(2000000)
    end = data.rfind(b"\\n")
    if end >= 0:
        lines = [raw[:20000].decode("utf-8", "replace") for raw in data[:end].split(b"\\n")]
        nxt = off + end + 1
except FileNotFoundError:
    pass
print(json.dumps({"alive": alive, "exit": exit_code, "next": nxt, "lines": lines}))`;

/**
 * One run of a coding agent: write its message, start it in the background (its own
 * process group, so it outlives the command that started it and can be stopped as a
 * whole), follow its events until it ends, the deadline passes or you stop it.
 */
export async function runAgent(
  driver: AgentDriver,
  input: { model: AgentModel; prompt: string; session: string | null; deadline: number; workdir: string; pollMs?: number },
  deps: AgentRunDeps,
): Promise<AgentRun> {
  const now = deps.now ?? Date.now;
  const run: AgentRun = { status: "finished", summary: "", steps: 0, session: input.session, tokens: { input: 0, output: 0 } };
  const prompt = Buffer.from(input.prompt, "utf8").toString("base64");
  const started = await deps.exec(
    [
      `mkdir -p ${AGENT_DIR} && rm -f ${AGENT_DIR}/exit ${AGENT_DIR}/pid`,
      `printf %s ${quote(prompt)} | base64 -d > ${AGENT_DIR}/prompt.md`,
      `cd ${quote(input.workdir)}`,
      `setsid bash -c ${quote(`${driver.command(input.model, input.session)} < /dev/null >> ${AGENT_DIR}/events.jsonl 2>> ${AGENT_DIR}/stderr.log; echo $? > ${AGENT_DIR}/exit`)} > /dev/null 2>&1 &`,
      `echo $! > ${AGENT_DIR}/pid`,
    ].join(" && "),
    60,
  );
  if (started.exitCode !== 0) return { ...run, status: "failed", error: redact(`couldn't start ${driver.name}: ${started.stderr || started.stdout}`).slice(0, 2000) };

  const offsetCmd = `stat -c %s ${AGENT_DIR}/events.jsonl 2>/dev/null || echo 0`;
  // A continued session appends to the same stream: start reading where the last run ended.
  let offset = Number((await deps.exec(offsetCmd, 30)).stdout.trim()) || 0;
  const stop = async () => {
    await deps.exec(`kill -TERM -- -$(cat ${AGENT_DIR}/pid) 2>/dev/null; sleep 5; kill -KILL -- -$(cat ${AGENT_DIR}/pid) 2>/dev/null; true`, 30).catch(() => {});
  };
  let lastError = "";
  for (;;) {
    let poll: { alive: boolean; exit: number | null; next: number; lines: string[] };
    try {
      const result = await deps.exec(`python3 -c ${quote(POLL)} ${offset}`, 60);
      poll = JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "");
    } catch {
      poll = { alive: true, exit: null, next: offset, lines: [] };
    }
    offset = poll.next;
    for (const line of poll.lines) {
      for (const event of driver.read(line)) {
        if (event.type === "session") {
          run.session = event.id;
          continue;
        }
        if (event.type === "text") run.summary = event.text;
        if (event.type === "tool") run.steps += 1;
        if (event.type === "tokens") {
          run.tokens.input += event.input;
          run.tokens.output += event.output;
        }
        if (event.type === "error") lastError = event.message;
        deps.event?.(event);
      }
    }
    if (!poll.alive) {
      if (poll.exit !== 0 || (!run.summary && lastError)) {
        const stderr = (await deps.exec(`tail -c 2000 ${AGENT_DIR}/stderr.log 2>/dev/null`, 30).catch(() => null))?.stdout ?? "";
        return { ...run, status: "failed", error: redact([poll.exit === null ? "it stopped without an exit code" : `it exited with ${poll.exit}`, lastError, stderr.trim()].filter(Boolean).join("\n")).slice(0, 3000) };
      }
      return run;
    }
    if (deps.signal?.aborted) {
      await stop();
      return { ...run, status: "stopped" };
    }
    if (now() > input.deadline) {
      await stop();
      return { ...run, status: "timeout", error: "it ran out of time" };
    }
    await deps.sleep(input.pollMs ?? 10_000);
  }
}

/**
 * The agent's model: the engineer's first model on a provider the gateway can reach with
 * a key, speaking the OpenAI-compatible API (the protocol the agent's config uses here).
 */
export function chooseAgentModel(engineer: readonly string[], providers: readonly { id: string; kind: string; hasKey: boolean }[]): AgentModel | null {
  for (const ref of engineer) {
    const slash = ref.indexOf("/");
    if (slash <= 0) continue;
    const provider = ref.slice(0, slash);
    const model = ref.slice(slash + 1);
    if (!model || model === "*") continue;
    const known = providers.find((p) => p.id === provider);
    if (known?.hasKey && known.kind === "openai") return { provider, model };
  }
  return null;
}
