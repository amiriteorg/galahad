import { type ChatStreamEvent, type ExecResult, redact, type RouteName, type SandboxNetwork, type SandboxView } from "@galahad/core";
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

function environment(sandbox: SandboxView): string {
  return [
    `a Debian Linux sandbox on ${sandbox.node}: unprivileged user, no sudo, no package installs via apt.`,
    "Workspace /work (kept for the whole quest); /tmp is scratch.",
    "Tools: bash, git, curl, jq, ripgrep, python3 (use a venv for pip), gcc and make, bun 1.4.4.",
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

export async function questFromCli(node: NodeClient, options: DoOptions): Promise<QuestOutcome> {
  const quest = `q-${Date.now().toString(36)}`;
  const { sandbox } = await node.call<{ sandbox: SandboxView }>("createSandbox", {
    network: options.network,
    quest,
    ...(options.on ? { on: options.on } : {}),
  });
  console.log(dim(`[quest ${quest} · sandbox ${sandbox.id} on ${sandbox.node} · network ${sandbox.network} · Ctrl-C stops after the current step]\n`));

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
    outcome = await runQuest(
      { goal: options.goal, environment: environment(sandbox), maxSteps: options.maxSteps, commandTimeoutSec: options.commandTimeoutSec },
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
        emit: print,
        signal: controller.signal,
      },
    );
  } finally {
    process.off("SIGINT", onInterrupt);
    if (options.keep) console.log(dim(`[sandbox kept: galahad sandbox exec ${sandbox.id} --on ${sandbox.node} -- …]`));
    else await node.call("destroySandbox", { id: sandbox.id, on: sandbox.node }).catch(() => {});
  }

  console.log(`${bold(VERDICT[outcome.status])} ${dim(`${outcome.steps} commands · ${outcome.revisions} revisions`)}`);
  console.log(indent(outcome.summary.trim()));
  if (outcome.status !== "done" && outcome.review) console.log(`\nReviewer:\n${indent(outcome.review.trim())}`);

  // The mind remembers what was done. Marked untrusted: the summary is model
  // output shaped by whatever the sandbox read, so it stays data, never instructions.
  const memory = redact(
    [`Quest (${outcome.status}): ${options.goal}`, outcome.summary.trim(), outcome.review ? `Reviewer: ${outcome.review.trim()}` : ""].filter(Boolean).join("\n"),
  ).slice(0, 20_000);
  await node.call("remember", { text: memory, tags: ["quest", quest], untrusted: true }).catch(() => {});
  return outcome;
}
