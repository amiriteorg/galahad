import { type ChatStreamEvent, type ExecResult, type FleetView, redact, type RouteName, type SandboxNetwork, type SandboxView } from "@galahad/core";
import { type QuestEvent, type QuestOutcome, runQuest } from "@galahad/brain";

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
    "Workspace /work (kept for the whole quest); /tmp is scratch.",
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
}

/**
 * One quest through a node's API: a fresh sandbox, the pure loop, cleanup, and the
 * outcome remembered. The CLI and loops both run quests this way; the node decides
 * what the caller may do (an arm's or a loop's sandboxes are always its own and ephemeral).
 */
export async function runNodeQuest(node: NodeClient, options: DoOptions, hooks: NodeQuestHooks = {}): Promise<{ outcome: QuestOutcome; quest: string }> {
  const quest = `q-${Date.now().toString(36)}`;
  const { sandbox } = await node.call<{ sandbox: SandboxView }>("createSandbox", {
    network: options.network,
    ...(options.isolation ? { isolation: options.isolation } : {}),
    ...(options.lab ? { lab: true } : {}),
    quest,
    ...(options.on ? { on: options.on } : {}),
  });
  // Sandboxes name their host by device id; people (and the engineer) know it by name.
  const fleet = await node.call<FleetView>("fleet").catch(() => null);
  const host = fleet?.devices.find((d) => d.id === sandbox.node)?.name ?? sandbox.node;
  hooks.started?.({ quest, sandbox, host });

  let outcome: QuestOutcome;
  try {
    outcome = await runQuest(
      { goal: options.goal, environment: environment(sandbox, host), maxSteps: options.maxSteps, commandTimeoutSec: options.commandTimeoutSec },
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
        exec: (command, timeoutSec) =>
          node.call<ExecResult>("execSandbox", { id: sandbox.id, cmd: ["bash", "-c", command], timeoutSec, on: sandbox.node }),
        emit: hooks.emit,
        signal: hooks.signal,
      },
    );
  } finally {
    if (!options.keep) await node.call("destroySandbox", { id: sandbox.id, on: sandbox.node }).catch(() => {});
  }

  // The mind remembers what was done. Marked untrusted: the summary is model
  // output shaped by whatever the sandbox read, so it stays data, never instructions.
  const memory = redact(
    [`Quest (${outcome.status}): ${options.goal}`, outcome.summary.trim(), outcome.review ? `Reviewer: ${outcome.review.trim()}` : ""].filter(Boolean).join("\n"),
  ).slice(0, 20_000);
  await node.call("remember", { text: memory, tags: ["quest", quest], untrusted: true }).catch(() => {});
  return { outcome, quest };
}

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
  try {
    ({ outcome } = await runNodeQuest(node, options, {
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
  return outcome;
}
