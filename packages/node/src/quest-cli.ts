import { type ArtifactView, type ChatStreamEvent, type ExecResult, type FleetView, type ProviderView, redact, type Results, type RouteName, type SandboxNetwork, type SandboxView } from "@galahad/core";
import { SHIPMENT_SCRIPT } from "./ship.ts";
import { AGENTS, chooseAgentModel, investigate, type InvestigationOutcome, type QuestEvent, type QuestOptions, type QuestOutcome, readResults, runQuest } from "@galahad/brain";

/*
 * `galahad do "<goal>"`: a quest from the terminal. The loop itself is pure
 * (@galahad/brain runQuest); this wires it to the node: models through the
 * roster (keys never leave the vault), work in a fresh sandbox on the best
 * sandbox host, every command in the ledger, the outcome in the mind.
 */

export interface NodeClient {
  call<T = any>(name: RouteName, input?: unknown): Promise<T>;
  stream(name: RouteName, input: unknown): AsyncGenerator<ChatStreamEvent>;
}

export interface DoOptions {
  goal: string;
  network: SandboxNetwork;
  /** container or vm; default: the host decides (online code in a microVM where it can). */
  isolation?: "container" | "vm";
  /** Work in the Lab (mathematics, physics, engineering) instead of the workshop. */
  lab?: boolean;
  on?: string;
  maxSteps?: number;
  commandTimeoutSec?: number;
  keep?: boolean;
  /** More for the engineer, after the usual instructions (a trial's answer contract). */
  instructions?: string;
  /** Commands whose output the reviewer sees too, e.g. `cat /work/out/answer.json`. */
  evidence?: string[];
  /** The kept artifact's label (default: the goal). */
  label?: string;
  /** Remember the outcome in the mind (default yes; a trial records its own result instead). */
  remember?: boolean;
  /**
   * A coding agent (opencode) does the engineer's part, for up to `minutes`, in a clone of
   * `repo` if given (which needs --net online). Its model calls go through the gateway.
   */
  agent?: { name: string; minutes: number; repo?: string };
  /** With a GitHub repo: once the reviewer passes the work, ask you (or a standing order) to open a pull request. */
  ship?: { title?: string; base?: string; draft?: boolean; connector?: string };
}

/** What became of shipping a quest's work. */
export interface Shipped {
  /** Filed for your approval. */
  action?: string;
  /** Sent at once: a standing order covered it. */
  receipt?: string;
  /** Why nothing was filed. */
  problem?: string;
}

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** owner/repo of a github.com clone URL, or null. */
export function githubRepo(url: string): { owner: string; repo: string } | null {
  const m = url.match(/^https:\/\/github\.com\/([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100}?)(?:\.git)?\/?$/);
  return m ? { owner: m[1]!, repo: m[2]! } : null;
}

/** A branch name from a title: galahad/<words>-<quest>. */
export function shipBranch(title: string, quest: string): string {
  const words = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48).replace(/-+$/, "");
  return `galahad/${words || "changes"}-${quest.replace(/^q-/, "")}`;
}

/** The GitHub connector for an owner: github-<owner> if installed with its key, else github. */
export async function githubConnector(node: NodeClient, owner: string): Promise<string> {
  const { connectors } = await node.call<{ connectors: { id: string; installed: boolean; key: string }[] }>("connectors");
  const own = connectors.find((c) => c.id === `github-${owner.toLowerCase()}` && c.installed && c.key === "ready");
  return own ? own.id : "github";
}

const tty = process.stdout.isTTY;
const dim = (s: string) => (tty ? `\x1b[2m${s}\x1b[0m` : s);
const bold = (s: string) => (tty ? `\x1b[1m${s}\x1b[0m` : s);
const firstLines = (text: string, n: number): string => {
  const lines = text.trim().split("\n");
  return lines.slice(0, n).join("\n") + (lines.length > n ? dim(` … (+${lines.length - n} lines)`) : "");
};
const indent = (text: string, pad = "  "): string => text.replace(/^/gm, pad);

const NETWORK: Record<SandboxNetwork, string> = {
  isolated: "none at all (no internet, no models)",
  gateway: "only Galahad's model gateway (no internet)",
  online: "the internet",
};

function environment(sandbox: SandboxView, host: string): string {
  return [
    `a Debian Linux sandbox on ${host}${sandbox.isolation === "vm" ? ", inside its own KVM microVM" : ""}: unprivileged user, no sudo, no package installs via apt.`,
    "Workspace /work (kept for the whole quest); /tmp is scratch. Put what should outlive the sandbox (reports, plots, data, models, code) in /work/out: it's kept, with hashes, when the quest ends.",
    sandbox.image.includes("/lab")
      ? "The Lab: python3 at /opt/lab with numpy, scipy, sympy, mpmath, pandas, statsmodels, matplotlib (save figures to files), Pint, uncertainties, SALib; " +
        "FEniCSx (dolfinx, PETSc, MPI: mpirun), gmsh, scikit-fem, OpenSees; build123d on OpenCascade (STEP/STL); MuJoCo; CoolProp, Cantera; " +
        "python-control, cvxpy, Z3; OpenFOAM (run its commands as `openfoam blockMesh` etc.; tutorials listed by `openfoam`); ngspice; Octave; Maxima; " +
        "gcc, gfortran, cmake, bun 1.4.4. `lab-check` proves each tool against a known answer."
      : "Tools: bash, git, curl, jq, ripgrep, python3 (use a venv for pip), gcc and make, bun 1.4.4.",
    `Network: ${NETWORK[sandbox.network]}.`,
    `Limits: ${sandbox.cpus} CPUs, ${sandbox.memoryGb} GB of memory.`,
  ].join(" ");
}

function print(event: QuestEvent): void {
  switch (event.type) {
    case "plan":
      console.log(`${bold("◇ Plan")} ${dim(`· ${event.model}`)}\n${indent(event.text)}\n`);
      return;
    case "thought":
      console.log(`${bold(`▸ ${event.step}`)} ${dim(firstLines(event.text, 2))}`);
      return;
    case "command":
      console.log(indent(`$ ${firstLines(event.command, 4)}`));
      return;
    case "observation": {
      const [status, ...output] = event.output.split("\n");
      console.log(dim(indent(`${status}${output.length ? `\n${firstLines(output.join("\n"), 3)}` : ""}`, "    ")));
      return;
    }
    case "format":
      console.log(dim(`  (step ${event.step}: ${event.problem})`));
      return;
    case "submitted":
      console.log(`\n${bold("◇ Submitted")}\n${indent(firstLines(event.summary, 6))}`);
      return;
    case "review":
      console.log(`${bold(`◇ Review: ${event.verdict === "pass" ? "PASS" : "REVISE"}`)} ${dim(`· ${event.model}`)}${event.notes ? `\n${indent(firstLines(event.notes, 6))}` : ""}\n`);
      return;
    case "retry":
      console.log(dim(`  (the ${event.role} couldn't answer: ${event.error.split("\n")[0]}; asking again in ${Math.round(event.waitMs / 1000)} s)`));
      return;
    case "finished":
      return;
  }
}

const VERDICT: Record<QuestOutcome["status"], string> = {
  done: "✓ Done, and an independent review agrees.",
  unverified: "△ Finished, but the reviewer did not accept it.",
  "gave-up": "✗ Galahad gave up.",
  stopped: "■ Stopped.",
};

export interface NodeQuestHooks {
  emit?(event: QuestEvent): void;
  signal?: AbortSignal;
  /** Once the sandbox exists. */
  started?(info: { quest: string; sandbox: SandboxView; host: string }): void;
  /** Once the loop has ended, before the work is kept and the sandbox goes: read what it left. */
  finished?(exec: (command: string, timeoutSec: number) => Promise<ExecResult>): Promise<void>;
}

/**
 * One quest through a node's API: a fresh sandbox, the pure loop, cleanup, and the
 * outcome remembered. The CLI and loops both run quests this way; the node decides
 * what the caller may do (an arm's or a loop's sandboxes are always its own and ephemeral).
 */
export async function runNodeQuest(
  node: NodeClient,
  options: DoOptions,
  hooks: NodeQuestHooks = {},
): Promise<{ outcome: QuestOutcome; quest: string; artifact: ArtifactView | null; shipped?: Shipped }> {
  const quest = `q-${Date.now().toString(36)}`;
  const agent = options.agent ? await agentFor(node, options) : undefined;
  const { sandbox } = await node.call<{ sandbox: SandboxView }>("createSandbox", {
    network: options.network,
    ...(options.isolation ? { isolation: options.isolation } : {}),
    ...(options.lab ? { lab: true } : {}),
    quest,
    ...(options.on ? { on: options.on } : {}),
    // The agent calls models itself, through the gateway, on a token that lives as long as the sandbox.
    ...(agent ? { providers: [agent.model.provider], ttlMinutes: Math.min(agent.minutes + 30, 7 * 24 * 60) } : {}),
  });
  // Sandboxes name their host by device id; people (and the engineer) know it by name.
  const fleet = await node.call<FleetView>("fleet").catch(() => null);
  const host = fleet?.devices.find((d) => d.id === sandbox.node)?.name ?? sandbox.node;
  hooks.started?.({ quest, sandbox, host });

  const exec = (command: string, timeoutSec: number) =>
    node.call<ExecResult>("execSandbox", { id: sandbox.id, cmd: ["bash", "-c", command], timeoutSec, on: sandbox.node });
  let outcome: QuestOutcome;
  let artifact: ArtifactView | null = null;
  try {
    if (options.agent?.repo) {
      const cloned = await exec(`git clone -q --depth 50 '${options.agent.repo}' /work/repo 2>&1 | tail -5; test -d /work/repo/.git`, 900);
      if (cloned.exitCode !== 0) throw new Error(`couldn't clone ${options.agent.repo}: ${cloned.stdout.trim() || cloned.stderr.trim()}`);
    }
    const evidence = options.evidence ?? (agent ? agentEvidence(agent.workdir) : undefined);
    outcome = await runQuest(
      {
        goal: options.goal,
        environment: environment(sandbox, host),
        maxSteps: options.maxSteps,
        commandTimeoutSec: options.commandTimeoutSec,
        ...(options.instructions ? { instructions: options.instructions } : {}),
        ...(evidence ? { evidence } : {}),
        ...(agent ? { agent } : {}),
      },
      {
        ask: async (role, messages) => {
          let text = "";
          let model = "";
          for await (const event of node.stream("chat", { role, messages })) {
            if (event.type === "text") text += event.text;
            else if (event.type === "model") model = event.ref;
            else if (event.type === "error") throw new Error(`the ${role} could not answer: ${event.error}`);
          }
          return { text, model };
        },
        exec,
        emit: hooks.emit,
        signal: hooks.signal,
      },
    );
    // A repository's changes are kept as a patch (new files included) to read, and as a
    // shipment (ship/: the files themselves) that github.ship can turn into a pull request.
    if (options.agent?.repo) {
      await exec("mkdir -p /work/out && cd /work/repo && git add -A && git diff --cached --binary > /work/out/changes.patch && git reset -q", 120).catch(() => {});
      await exec(`python3 -c ${shq(SHIPMENT_SCRIPT)} /work/repo /work/out/ship`, 120).catch(() => {});
    }
    await hooks.finished?.(exec);
  } finally {
    // What the quest put in /work/out outlives the sandbox (nothing there: nothing kept).
    artifact = await node
      .call<{ artifact: ArtifactView | null }>("saveArtifact", { sandbox: sandbox.id, on: sandbox.node, label: (options.label ?? options.goal).slice(0, 200) })
      .then((r) => r.artifact)
      .catch(() => null);
    if (!options.keep) await node.call("destroySandbox", { id: sandbox.id, on: sandbox.node }).catch(() => {});
  }

  const shipped = options.ship ? await shipQuest(node, options, { outcome, quest, artifact }) : undefined;
  if (options.remember === false) return { outcome, quest, artifact, ...(shipped ? { shipped } : {}) };
  // The mind remembers what was done. Marked untrusted: the summary is model
  // output shaped by whatever the sandbox read, so it stays data, never instructions.
  const memory = redact(
    [
      `Quest (${outcome.status}): ${options.goal}`,
      outcome.summary.trim(),
      outcome.review ? `Reviewer: ${outcome.review.trim()}` : "",
      artifact ? `Kept: artifact ${artifact.id} (${artifact.count} file(s): ${artifact.files.slice(0, 8).map((f) => f.path).join(", ")})` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  ).slice(0, 20_000);
  await node.call("remember", { text: memory, tags: ["quest", quest], untrusted: true }).catch(() => {});
  return { outcome, quest, artifact, ...(shipped ? { shipped } : {}) };
}

/** Passed work on a GitHub clone: file github.ship for your approval (a standing order may answer it at once). */
async function shipQuest(node: NodeClient, options: DoOptions, done: { outcome: QuestOutcome; quest: string; artifact: ArtifactView | null }): Promise<Shipped> {
  const where = options.agent?.repo ? githubRepo(options.agent.repo) : null;
  if (!where) return { problem: "only a quest on a github.com clone (--repo) can ship" };
  if (done.outcome.status !== "done") return { problem: "not shipped: the reviewer didn't pass the work" };
  if (!done.artifact?.files.some((f) => f.path === "ship/manifest.json")) return { problem: "nothing to ship: the work changed no files" };
  const title = (options.ship!.title ?? options.goal.split("\n")[0]!).slice(0, 120);
  const body = [
    done.outcome.summary.trim(),
    done.outcome.review ? `**Independent review:** ${done.outcome.review.trim()}` : "",
    `_Made by Galahad in quest ${done.quest}; the work is kept as ${done.artifact.id}._`,
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 20_000);
  const changed = done.artifact.files.filter((f) => f.path.startsWith("ship/files/")).length;
  try {
    const connector = options.ship!.connector ?? (await githubConnector(node, where.owner));
    const result = await node.call<{ status: "asked" | "done"; action?: string; result?: { body: string } }>("callConnector", {
      connector,
      tool: "ship",
      args: {
        owner: where.owner,
        repo: where.repo,
        artifact: done.artifact.id,
        branch: shipBranch(title, done.quest),
        title,
        body,
        ...(options.ship!.base ? { base: options.ship!.base } : {}),
        ...(options.ship!.draft ? { draft: true } : {}),
      },
      why: `Quest ${done.quest} changed ${changed} file(s) in ${where.owner}/${where.repo}, and the independent reviewer passed it. Its patch: ${done.artifact.id}, changes.patch.`.slice(0, 500),
      ask: { quest: done.quest },
    });
    return result.status === "asked" ? { action: result.action! } : { receipt: result.result?.body ?? "sent" };
  } catch (error) {
    return { problem: `couldn't file the pull request: ${(error as Error).message}` };
  }
}

/** The coding agent for a quest: its driver, and the engineer's first model the gateway can serve to it. */
async function agentFor(node: NodeClient, options: DoOptions): Promise<NonNullable<QuestOptions["agent"]>> {
  const wanted = options.agent!;
  const driver = AGENTS[wanted.name];
  if (!driver) throw new Error(`no coding agent "${wanted.name}" (there is: ${Object.keys(AGENTS).join(", ")})`);
  if (options.network === "isolated") throw new Error("a coding agent needs models: use --net gateway (models only) or --net online");
  if (options.lab) throw new Error("coding agents work in the workshop for now, not the Lab");
  if (wanted.repo && options.network !== "online") throw new Error("cloning a repository needs --net online");
  const [{ roster }, { providers }] = await Promise.all([
    node.call<{ roster: Record<string, { models: string[] }> }>("roster"),
    node.call<{ providers: ProviderView[] }>("providers"),
  ]);
  const model = chooseAgentModel(roster.engineer?.models ?? [], providers);
  if (!model) throw new Error("no engineer model on an OpenAI-compatible provider with a key: galahad roster set engineer <provider/model> …");
  return { driver, model, minutes: wanted.minutes, workdir: wanted.repo ? "/work/repo" : "/work" };
}

/** What the reviewer sees of an agent's work, straight from the sandbox. */
const agentEvidence = (workdir: string): string[] => [
  `cd ${workdir} && if [ -d .git ]; then git status --short | head -80; git diff --stat | tail -40; else find . -path ./.agent -prune -o -path ./.local -prune -o -path ./.config -prune -o -path ./.cache -prune -o -type f -newer /work/.agent/prompt.md -print | head -80; fi`,
  "ls -la /work/out 2>/dev/null | head -40",
];

export async function questFromCli(node: NodeClient, options: DoOptions): Promise<QuestOutcome> {
  const controller = new AbortController();
  let interrupts = 0;
  const onInterrupt = (): void => {
    interrupts += 1;
    if (interrupts > 1) process.exit(130);
    controller.abort();
    process.stderr.write(dim("\n[stopping after this step; Ctrl-C again to quit now]\n"));
  };
  process.on("SIGINT", onInterrupt);

  let outcome: QuestOutcome;
  let artifact: ArtifactView | null = null;
  let shipped: Shipped | undefined;
  try {
    ({ outcome, artifact, shipped } = await runNodeQuest(node, options, {
      emit: print,
      signal: controller.signal,
      started: ({ quest, sandbox, host }) => {
        console.log(dim(`[quest ${quest} · sandbox ${sandbox.id} on ${host} · network ${sandbox.network} · Ctrl-C stops after the current step]\n`));
        if (options.keep) console.log(dim(`[the sandbox is kept afterwards: galahad sandbox exec ${sandbox.id} --on ${host} -- …]`));
      },
    }));
  } finally {
    process.off("SIGINT", onInterrupt);
  }

  console.log(`${bold(VERDICT[outcome.status])} ${dim(`${outcome.steps} commands · ${outcome.revisions} revisions`)}`);
  console.log(indent(outcome.summary.trim()));
  if (outcome.status !== "done" && outcome.review) console.log(`\nReviewer:\n${indent(outcome.review.trim())}`);
  if (artifact) {
    const kb = Math.max(1, Math.round(artifact.bytes / 1024));
    console.log(dim(`\nKept ${artifact.count} file(s), ${kb} KB, from /work/out: galahad artifact ${artifact.id}`));
  }
  if (shipped?.action) console.log(`\n${bold("◇ Pull request filed for your approval")} ${dim(`· galahad action approve ${shipped.action} · or the Inbox`)}`);
  if (shipped?.receipt) console.log(`\n${bold("◇ Shipped under your standing order:")} ${shipped.receipt}`);
  if (shipped?.problem) console.log(dim(`\n${shipped.problem}`));
  return outcome;
}

/* ---------- investigations: the scientific method, through the same sandbox ---------- */

export interface InvestigateOptions {
  question: string;
  network: SandboxNetwork;
  isolation?: "container" | "vm";
  /** The Lab unless you say otherwise: investigations are usually mathematics, physics or engineering. */
  workshop?: boolean;
  on?: string;
  maxSteps?: number;
  commandTimeoutSec?: number;
  keep?: boolean;
}

/**
 * One investigation through a node's API: a fresh Lab sandbox, formulate and register
 * the hypothesis before anything runs, the experiment, the method review, the results
 * kept as an artifact, and the conclusion recorded once.
 */
export async function runNodeInvestigation(
  node: NodeClient,
  options: InvestigateOptions,
  hooks: NodeQuestHooks = {},
): Promise<{ result: InvestigationOutcome; artifact: ArtifactView | null; predictions: Results["predictions"] }> {
  const quest = `inv-${Date.now().toString(36)}`;
  const { sandbox } = await node.call<{ sandbox: SandboxView }>("createSandbox", {
    network: options.network,
    ...(options.isolation ? { isolation: options.isolation } : {}),
    ...(options.workshop ? {} : { lab: true }),
    quest,
    ...(options.on ? { on: options.on } : {}),
  });
  const fleet = await node.call<FleetView>("fleet").catch(() => null);
  const host = fleet?.devices.find((d) => d.id === sandbox.node)?.name ?? sandbox.node;
  hooks.started?.({ quest, sandbox, host });
  const exec = (command: string, timeoutSec: number) =>
    node.call<ExecResult>("execSandbox", { id: sandbox.id, cmd: ["bash", "-c", command], timeoutSec, on: sandbox.node });

  let result: InvestigationOutcome;
  let artifact: ArtifactView | null = null;
  let predictions: Results["predictions"] = [];
  try {
    result = await investigate(
      {
        question: options.question,
        environment: environment(sandbox, host),
        maxSteps: options.maxSteps ?? 40,
        commandTimeoutSec: options.commandTimeoutSec ?? 600,
      },
      {
        ask: async (role, messages) => {
          let text = "";
          let model = "";
          for await (const event of node.stream("chat", { role, messages })) {
            if (event.type === "text") text += event.text;
            else if (event.type === "model") model = event.ref;
            else if (event.type === "error") throw new Error(`the ${role} could not answer: ${event.error}`);
          }
          return { text, model };
        },
        exec,
        register: async (registration) => (await node.call<{ id: string }>("registerInvestigation", { registration })).id,
        emit: hooks.emit,
        signal: hooks.signal,
      },
    );
    const read = await exec("cat /work/out/results.json 2>/dev/null | head -c 200000", 60).catch(() => null);
    predictions = (read && readResults(read.stdout)?.predictions) || [];
  } finally {
    artifact = await node
      .call<{ artifact: ArtifactView | null }>("saveArtifact", { sandbox: sandbox.id, on: sandbox.node, label: options.question.slice(0, 200) })
      .then((r) => r.artifact)
      .catch(() => null);
    if (!options.keep) await node.call("destroySandbox", { id: sandbox.id, on: sandbox.node }).catch(() => {});
  }

  if (result.id) {
    const registered = new Set(result.registration?.predictions.map((p) => p.id) ?? []);
    await node
      .call("concludeInvestigation", {
        id: result.id,
        status: result.outcome.status === "done" && !result.conclusion ? "unverified" : result.outcome.status,
        ...(result.conclusion ? { conclusion: result.conclusion } : {}),
        summary: result.outcome.summary.slice(0, 4000),
        ...(result.outcome.review ? { review: result.outcome.review.slice(0, 4000) } : {}),
        ...(artifact ? { artifact: artifact.id } : {}),
        predictions: predictions
          .filter((p) => registered.has(p.id))
          .slice(0, 16)
          .map((p) => ({
            id: p.id,
            verdict: p.verdict,
            ...(typeof p.value === "number" ? { value: p.value } : {}),
            ...(typeof p.uncertainty === "number" ? { uncertainty: p.uncertainty } : {}),
            ...(p.units ? { units: p.units.slice(0, 50) } : {}),
          })),
      })
      .catch(() => {});
  }
  // A finding is remembered as untrusted: it's model output shaped by what the sandbox computed.
  const memory = redact(
    [
      `Investigation ${result.id ?? "(not registered)"} (${result.conclusion ?? result.outcome.status}): ${options.question}`,
      result.registration ? `Hypothesis: ${result.registration.hypothesis}` : "",
      result.outcome.summary.trim(),
      result.outcome.review ? `Reviewer: ${result.outcome.review.trim()}` : "",
      artifact ? `Kept: artifact ${artifact.id} (${artifact.count} file(s))` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  ).slice(0, 20_000);
  await node.call("remember", { text: memory, tags: ["investigation", ...(result.id ? [result.id] : [])], untrusted: true }).catch(() => {});
  return { result, artifact, predictions };
}

const CONCLUSION: Record<string, string> = {
  supported: "✓ SUPPORTED: the method holds up, and so do the predictions.",
  refuted: "✗ REFUTED: the method holds up, and a prediction failed as registered.",
  inconclusive: "△ INCONCLUSIVE: the method holds up, but the evidence can't decide.",
};

export async function investigateFromCli(node: NodeClient, options: InvestigateOptions): Promise<InvestigationOutcome> {
  const controller = new AbortController();
  const onInterrupt = (): void => {
    controller.abort();
    process.stderr.write(dim("\n[stopping after this step; Ctrl-C again to quit now]\n"));
    process.once("SIGINT", () => process.exit(130));
  };
  process.once("SIGINT", onInterrupt);
  try {
    const { result, artifact, predictions } = await runNodeInvestigation(node, options, {
      emit: print,
      signal: controller.signal,
      started: ({ quest, sandbox, host }) => {
        console.log(dim(`[investigation ${quest} · ${sandbox.image.includes("/lab") ? "the Lab" : "workshop"} sandbox ${sandbox.id} on ${host} · network ${sandbox.network}]\n`));
      },
    });
    console.log(bold(result.conclusion ? CONCLUSION[result.conclusion]! : VERDICT[result.outcome.status]));
    if (result.id) console.log(dim(`registered before it ran as ${result.id}`));
    for (const p of predictions) {
      const value = typeof p.value === "number" ? `${p.value}${p.units ? ` ${p.units}` : ""}${typeof p.uncertainty === "number" ? ` ± ${p.uncertainty}` : ""}` : "";
      console.log(`  ${p.id}  ${p.verdict.padEnd(12)} ${value}`);
    }
    console.log(indent(result.outcome.summary.trim()));
    if (result.outcome.review) console.log(`\nReviewer:\n${indent(result.outcome.review.trim())}`);
    if (artifact) console.log(dim(`\nKept ${artifact.count} file(s): galahad artifact ${artifact.id}`));
    return result;
  } finally {
    process.off("SIGINT", onInterrupt);
  }
}
