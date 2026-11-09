import { readFileSync } from "node:fs";
import type { ActionView, ConnectorView, FindingView, LoopRunView, LoopTask, LoopView, NoticeView, RouteName } from "@galahad/core";

/*
 * The terminal side of loops, the heartbeat, notices, connectors and approvals.
 * Thin: every rule lives in the node; this only shapes input and prints.
 */

export interface Api {
  call<T = any>(name: RouteName, input?: unknown): Promise<T>;
}

type Flags = Record<string, string | boolean | (string | boolean)[] | undefined>;

const tty = process.stdout.isTTY;
const dim = (s: string) => (tty ? `\x1b[2m${s}\x1b[0m` : s);
const bold = (s: string) => (tty ? `\x1b[1m${s}\x1b[0m` : s);
const str = (flags: Flags, key: string) => (typeof flags[key] === "string" ? (flags[key] as string) : undefined);
const list = (flags: Flags, key: string): string[] => {
  const value = flags[key];
  return (Array.isArray(value) ? value : value === undefined ? [] : [value]).filter((v): v is string => typeof v === "string");
};
const when = (ms: number | null) => (ms === null ? "never" : new Date(ms).toLocaleString());
const MARK: Record<string, string> = { ok: "✓", attention: "△", failed: "✗", interrupted: "■", info: "·", warn: "△", alert: "✗" };

export function describeTask(task: LoopTask | null): string {
  if (!task) return "(a task this version can't read)";
  if (task.kind === "heartbeat") return task.checklist ? "heartbeat + your checklist" : "heartbeat";
  if (task.kind === "quest") return `quest (${task.network}): ${task.goal.length > 70 ? `${task.goal.slice(0, 70)}…` : task.goal}`;
  const args = Object.entries(task.args ?? {}).map(([k, v]) => `${k}=${v}`).join(" ");
  return `call ${task.connector}.${task.tool}${args ? ` ${args}` : ""}`;
}

function printRun(run: LoopRunView, loop?: string): void {
  const head = `${MARK[run.status] ?? "?"} ${dim(new Date(run.started).toLocaleString())}${loop ? ` ${bold(loop)}` : ""} ${run.status}${run.slot === null ? dim(" (by hand)") : ""}`;
  console.log(`  ${head}\n      ${run.summary.replace(/\n/g, "\n      ")}`);
}

/** `--arg key=value` pairs, typed by the tool's declared params. */
async function toolArgs(api: Api, connector: string, tool: string, flags: Flags): Promise<Record<string, string | number | boolean>> {
  const pairs = list(flags, "arg");
  if (!pairs.length) return {};
  const { connectors } = await api.call<{ connectors: ConnectorView[] }>("connectors");
  const params = connectors.find((c) => c.id === connector)?.tools.find((t) => t.name === tool)?.params ?? {};
  const args: Record<string, string | number | boolean> = {};
  for (const pair of pairs) {
    const at = pair.indexOf("=");
    if (at < 1) throw new Error(`--arg takes key=value, not "${pair}"`);
    const key = pair.slice(0, at);
    const raw = pair.slice(at + 1);
    const type = params[key]?.type;
    args[key] = type === "integer" || type === "number" ? Number(raw) : type === "boolean" ? raw === "true" : raw;
  }
  return args;
}

async function taskFrom(api: Api, flags: Flags): Promise<LoopTask | undefined> {
  const kinds = ["heartbeat", "quest", "call"].filter((k) => flags[k] !== undefined);
  if (kinds.length > 1) throw new Error("give one of --heartbeat, --quest or --call");
  if (flags.heartbeat) return { kind: "heartbeat", ...(str(flags, "checklist") ? { checklist: str(flags, "checklist")! } : {}) };
  if (str(flags, "quest")) {
    const steps = str(flags, "steps");
    return {
      kind: "quest",
      goal: str(flags, "quest")!,
      network: (str(flags, "net") ?? "isolated") as "isolated" | "gateway" | "online",
      ...(steps ? { maxSteps: Number(steps) } : {}),
    };
  }
  if (str(flags, "call")) {
    const [connector, ...rest] = str(flags, "call")!.split(".");
    const tool = rest.join(".");
    if (!connector || !tool) throw new Error("--call takes <connector>.<tool>, e.g. github.notifications");
    return { kind: "call", connector, tool, args: await toolArgs(api, connector, tool, flags) };
  }
  if (str(flags, "checklist") !== undefined) return { kind: "heartbeat", checklist: str(flags, "checklist")! };
  return undefined;
}

export async function loopCommand(api: Api, sub: string | undefined, rest: string[], flags: Flags): Promise<void> {
  const name = rest[0];
  switch (sub) {
    case undefined:
    case "ls": {
      const { loops } = await api.call<{ loops: LoopView[] }>("loops");
      if (!loops.length) console.log('No loops yet. Try: galahad loop add morning --cron "0 7 * * 1-5" --tz Europe/Copenhagen --quest "…"');
      for (const loop of loops) {
        const state = loop.enabled ? (loop.running ? bold("running") : "on") : dim("paused");
        console.log(`  ${bold(loop.name.padEnd(16))} ${state.padEnd(tty ? 7 : 7)}  ${loop.schedule}${loop.tz !== "UTC" ? ` (${loop.tz})` : ""} on ${loop.onName ?? loop.on.slice(0, 12)}`);
        console.log(`  ${" ".repeat(16)} ${dim(describeTask(loop.task))}${loop.problem ? `  ${bold(loop.problem)}` : ""}`);
        console.log(`  ${" ".repeat(16)} ${dim(`next ${loop.enabled ? when(loop.next) : "—"}`)}${loop.last ? dim(` · last ${MARK[loop.last.status]} ${loop.last.summary.split("\n")[0]!.slice(0, 80)}`) : ""}`);
      }
      return;
    }
    case "add":
    case "set": {
      if (!name) throw new Error(`usage: galahad loop ${sub} <name> (--every 30m | --cron "0 7 * * *") [--tz Zone] [--on node] (--heartbeat | --quest "goal" | --call connector.tool [--arg k=v])`);
      const every = str(flags, "every");
      const cron = str(flags, "cron");
      if (every && cron) throw new Error("give --every or --cron, not both");
      const schedule = every ? `every ${every}` : cron;
      const task = await taskFrom(api, flags);
      if (sub === "add" && (!schedule || !task)) throw new Error("a new loop needs --every or --cron, and --heartbeat, --quest or --call");
      const { loop } = await api.call<{ loop: LoopView }>("setLoop", {
        name,
        ...(schedule ? { schedule } : {}),
        ...(str(flags, "tz") ? { tz: str(flags, "tz") } : {}),
        ...(str(flags, "on") ? { on: str(flags, "on") } : {}),
        ...(task ? { task } : {}),
        ...(str(flags, "label") ? { label: str(flags, "label") } : {}),
      });
      console.log(`Loop ${bold(loop.name)}: ${loop.schedule}${loop.tz !== "UTC" ? ` (${loop.tz})` : ""} on ${loop.onName}, ${describeTask(loop.task)}. Next run ${when(loop.next)}.`);
      return;
    }
    case "pause":
    case "resume": {
      if (!name) throw new Error(`usage: galahad loop ${sub} <name>`);
      await api.call("setLoop", { name, enabled: sub === "resume" });
      console.log(sub === "pause" ? `Paused ${name}.` : `Resumed ${name}.`);
      return;
    }
    case "rm": {
      if (!name) throw new Error("usage: galahad loop rm <name>");
      await api.call("removeLoop", { name });
      console.log(`Removed ${name}. Its runs stay in the mind's history.`);
      return;
    }
    case "run": {
      if (!name) throw new Error("usage: galahad loop run <name>");
      const result = await api.call<{ run: string; node: string }>("runLoop", { name });
      console.log(`Started ${name} on ${result.node} (run ${result.run}). See it with: galahad loop runs ${name}`);
      return;
    }
    case "runs": {
      const { runs } = await api.call<{ runs: LoopRunView[] }>("loopRuns", { ...(name ? { name } : {}), limit: Number(str(flags, "limit") ?? 10) });
      if (!runs.length) console.log(name ? `${name} hasn't run yet.` : "No loop has run yet.");
      for (const run of runs.reverse()) printRun(run, name ? undefined : run.loop);
      return;
    }
    default:
      throw new Error("usage: galahad loop ls | add | set | pause | resume | rm | run | runs");
  }
}

export async function heartbeatCommand(api: Api): Promise<void> {
  const { node, findings } = await api.call<{ node: string; findings: FindingView[] }>("heartbeat", {});
  if (!findings.length) console.log(`✓ All quiet, as seen from ${node}.`);
  for (const f of findings) console.log(`  ${MARK[f.severity]} ${bold(f.title)}\n      ${f.body}`);
}

export async function noticeCommand(api: Api, sub: string | undefined, rest: string[], flags: Flags): Promise<void> {
  if (sub === "dismiss") {
    if (!rest[0]) throw new Error("usage: galahad notice dismiss <key>");
    await api.call("dismissNotice", { key: rest[0] });
    console.log("Dismissed. It stays quiet until it changes.");
    return;
  }
  const { notices } = await api.call<{ notices: NoticeView[] }>("notices");
  const shown = flags.all ? notices : notices.filter((n) => !n.dismissed);
  if (!shown.length) console.log("Nothing needs you.");
  for (const n of shown) console.log(`  ${MARK[n.severity]} ${bold(n.title)}${n.dismissed ? dim(" (dismissed)") : ""}  ${dim(n.key)}\n      ${n.body}`);
}

export async function connectorCommand(api: Api, sub: string | undefined, rest: string[], flags: Flags): Promise<void> {
  switch (sub) {
    case undefined:
    case "ls": {
      const { connectors } = await api.call<{ connectors: ConnectorView[] }>("connectors");
      for (const c of connectors) {
        const key = { "none-needed": "no key needed", ready: "key ✓", missing: "needs a key", "optional-missing": "no key (public only)", "wrong-origin": "key pinned elsewhere" }[c.key] ?? c.key;
        console.log(`  ${bold(c.id.padEnd(16))} ${(c.installed ? "installed" : dim("available")).padEnd(tty ? 18 : 9)} ${c.origin ?? dim("(your address)")}  ${c.installed ? key : ""}`);
        if (c.problem) console.log(`      ${bold(c.problem)}`);
      }
      console.log(dim("\n  galahad connector add <id> · galahad connector tools <id> · galahad connector call <id>.<tool> --arg k=v"));
      return;
    }
    case "add": {
      const file = str(flags, "manifest");
      if (file) {
        const manifest = JSON.parse(readFileSync(file, "utf8")) as { id?: string };
        const { connector } = await api.call<{ connector: ConnectorView }>("setConnector", { id: manifest.id ?? rest[0], manifest });
        console.log(`Installed ${connector.label} (${connector.tools.length} tools) for ${connector.origin}.`);
        if (connector.secret && connector.key !== "ready") console.log(`Its key: galahad secret set ${connector.secret} --connector ${connector.id}`);
        return;
      }
      if (!rest[0]) throw new Error("usage: galahad connector add <id> [--origin url] | galahad connector add --manifest file.json");
      const { connector } = await api.call<{ connector: ConnectorView }>("setConnector", { id: rest[0], ...(str(flags, "origin") ? { origin: str(flags, "origin") } : {}) });
      console.log(`Installed ${connector.label} (${connector.tools.length} tools) for ${connector.origin}.`);
      if (connector.secret && connector.key !== "ready") {
        console.log(`Its key${connector.key === "optional-missing" ? " (optional; public reads work without it)" : ""}: galahad secret set ${connector.secret} --connector ${connector.id}${connector.keyHelp ? dim(`\n  (${connector.keyHelp})`) : ""}`);
      }
      return;
    }
    case "rm": {
      if (!rest[0]) throw new Error("usage: galahad connector rm <id>");
      await api.call("removeConnector", { id: rest[0] });
      console.log(`Removed ${rest[0]}. Its key stays in the vault until you remove it.`);
      return;
    }
    case "tools": {
      const { connectors } = await api.call<{ connectors: ConnectorView[] }>("connectors");
      const c = connectors.find((x) => x.id === rest[0]);
      if (!c) throw new Error(`no connector "${rest[0]}"`);
      for (const t of c.tools) {
        const params = Object.entries(t.params).map(([k, p]) => (p.required ? k : `[${k}]`)).join(" ");
        console.log(`  ${bold(`${c.id}.${t.name}`)} ${params}  ${t.asks ? bold(`(${t.class}: asks you)`) : dim(`(${t.class})`)}\n      ${t.description}`);
      }
      return;
    }
    case "call": {
      const [connector, ...toolParts] = (rest[0] ?? "").split(".");
      const tool = toolParts.join(".");
      if (!connector || !tool) throw new Error("usage: galahad connector call <id>.<tool> [--arg key=value …]");
      const args = await toolArgs(api, connector, tool, flags);
      const outcome = await api.call<{ status: string; action?: string; target: string; result?: { status: number; body: string; truncated: boolean } }>("callConnector", {
        connector,
        tool,
        args,
        ...(str(flags, "why") ? { why: str(flags, "why") } : {}),
      });
      if (outcome.status === "asked") {
        console.log(`Filed for approval: action ${outcome.action}.`);
        return;
      }
      const result = outcome.result!;
      console.error(dim(`${outcome.target} → ${result.status}${result.truncated ? " (truncated)" : ""}`));
      let body = result.body;
      try {
        body = JSON.stringify(JSON.parse(body), null, 2);
      } catch {
        /* not JSON */
      }
      console.log(body);
      return;
    }
    default:
      throw new Error("usage: galahad connector ls | add | rm | tools | call");
  }
}

export async function actionCommand(api: Api, sub: string | undefined, rest: string[], flags: Flags): Promise<void> {
  if (sub === "approve" || sub === "deny") {
    if (!rest[0]) throw new Error(`usage: galahad action ${sub} <id> [--note text]`);
    const { action } = await api.call<{ action: ActionView }>("decideAction", { id: rest[0], approve: sub === "approve", ...(str(flags, "note") ? { note: str(flags, "note") } : {}) });
    console.log(sub === "approve" ? `Approved: ${action.target}. The node that asked sends it once.` : "Declined. Nothing was sent.");
    return;
  }
  const { actions } = await api.call<{ actions: ActionView[] }>("actions");
  const shown = flags.all ? actions : actions.filter((a) => a.state === "waiting" || a.state === "approved");
  if (!shown.length) console.log(flags.all ? "No actions yet." : "Nothing is waiting for you. (--all shows history)");
  for (const a of shown) {
    console.log(`  ${bold(a.id)}  ${a.state.padEnd(8)} ${a.class.padEnd(7)} ${a.connector}.${a.tool}  ${dim(`asked by ${a.by}`)}`);
    console.log(`      ${a.target}${a.why ? dim(`  · ${a.why}`) : ""}${a.receipt ? `\n      ${dim(a.receipt.slice(0, 200))}` : ""}`);
  }
  if (shown.some((a) => a.state === "waiting")) console.log(dim("\n  galahad action approve <id> · galahad action deny <id>"));
}

/** One line for `galahad status`: loops, what needs you, what waits for your answer. */
export async function statusLine(api: Api): Promise<void> {
  const [loops, notices, actions] = await Promise.all([
    api.call<{ loops: LoopView[] }>("loops").then((r) => r.loops).catch(() => [] as LoopView[]),
    api.call<{ notices: NoticeView[] }>("notices").then((r) => r.notices.filter((n) => !n.dismissed)).catch(() => [] as NoticeView[]),
    api.call<{ actions: ActionView[] }>("actions").then((r) => r.actions.filter((a) => a.state === "waiting")).catch(() => [] as ActionView[]),
  ]);
  const beat = loops.find((l) => l.name === "heartbeat")?.last;
  const parts = [
    `${loops.length} loop${loops.length === 1 ? "" : "s"}`,
    beat ? `heartbeat ${MARK[beat.status]} ${new Date(beat.finished).toLocaleTimeString()}` : "no heartbeat yet",
    notices.length ? bold(`${notices.length} notice${notices.length === 1 ? "" : "s"}`) : "nothing needs you",
    ...(actions.length ? [bold(`${actions.length} waiting for your answer (galahad action ls)`)] : []),
  ];
  console.log(`\n  ${parts.join(" · ")}`);
}
