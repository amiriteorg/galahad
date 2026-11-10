import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SandboxNetwork, TrialRecord, TrialView } from "@galahad/core";
import { galahadIndex, grade, pose, SUITES, TRIAL_EVIDENCE, TRIAL_INSTRUCTIONS, type TrialProblem } from "@galahad/brain";
import { type NodeClient, runNodeQuest } from "./quest-cli.ts";

/*
 * `galahad trial run`: each problem is posed with fresh random parameters, solved as
 * an ordinary quest in the Lab (models only, no internet: nothing to look up), graded
 * here against the exact answers, and recorded in the mind. The Galahad Index is the
 * mean score of a run, with a bootstrap interval.
 */

export interface TrialRunOptions {
  suite: string;
  problems: readonly TrialProblem[];
  /** The same seed poses the same problem (default: a fresh one per trial). */
  seed?: number;
  repeat: number;
  parallel: number;
  network: SandboxNetwork;
  isolation?: "container" | "vm";
  on?: string;
  signal?: AbortSignal;
  /** As each trial starts and ends. */
  progress?(event: { type: "start"; problem: TrialProblem; seed: number } | { type: "done"; trial: TrialView } | { type: "skipped"; problem: TrialProblem; why: string }): void;
}

/** This checkout's revision: the deploy's REVISION file, else git, else "unknown". */
export function galahadRevision(): string {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  try {
    const rev = readFileSync(join(root, "REVISION"), "utf8").trim();
    if (/^[0-9a-f]{7,40}$/.test(rev)) return rev;
  } catch {
    /* not a deployed release */
  }
  try {
    const git = Bun.spawnSync(["git", "describe", "--always", "--dirty=+dirty", "--abbrev=12"], { cwd: root, stderr: "ignore" });
    const rev = git.stdout.toString().trim();
    if (git.exitCode === 0 && rev) return rev.slice(0, 64);
  } catch {
    /* no git */
  }
  return "unknown";
}

const freshSeed = (): number => crypto.getRandomValues(new Uint32Array(1))[0]!;

/** One trial: pose, solve as a quest, grade, record. Null when you stopped it. */
export async function runTrial(
  node: NodeClient,
  job: { problem: TrialProblem; seed: number; run: string; suite: string; version: string; network: SandboxNetwork; isolation?: "container" | "vm"; on?: string; signal?: AbortSignal },
): Promise<TrialView | null> {
  const { problem, seed } = job;
  const posed = pose(problem, seed);
  const models = new Set<string>();
  const started = Date.now();
  const base = { run: job.run, suite: job.suite, problem: problem.id, title: problem.title, domain: problem.domain, seed, version: job.version };
  let record: TrialRecord;
  try {
    let answer: string | null = null;
    const { outcome, artifact } = await runNodeQuest(
      node,
      {
        goal: posed.goal,
        network: job.network,
        lab: true,
        ...(job.isolation ? { isolation: job.isolation } : {}),
        ...(job.on ? { on: job.on } : {}),
        ...(problem.budget?.maxSteps ? { maxSteps: problem.budget.maxSteps } : {}),
        ...(problem.budget?.commandTimeoutSec ? { commandTimeoutSec: problem.budget.commandTimeoutSec } : {}),
        instructions: TRIAL_INSTRUCTIONS,
        evidence: TRIAL_EVIDENCE,
        label: `Trial ${problem.id} (seed ${seed})`,
        remember: false,
      },
      {
        signal: job.signal,
        emit: (event) => {
          if ((event.type === "plan" || event.type === "thought" || event.type === "review") && event.model) models.add(event.model);
        },
        finished: async (exec) => {
          const read = await exec("cat /work/out/answer.json 2>/dev/null | head -c 100000", 60).catch(() => null);
          answer = read?.exitCode === 0 ? read.stdout : null;
        },
      },
    );
    // Your Ctrl-C says nothing about ability; running out of commands does, and is scored.
    if (job.signal?.aborted) return null;
    const graded = grade(posed.expected, answer);
    record = {
      ...base,
      status: "scored",
      score: graded.score,
      answers: graded.answers,
      quest: { status: outcome.status, steps: outcome.steps, revisions: outcome.revisions },
      models: [...models].slice(0, 8),
      seconds: Math.round((Date.now() - started) / 1000),
      ...(artifact ? { artifact: artifact.id } : {}),
      ...(graded.note ? { note: graded.note } : {}),
    };
  } catch (error) {
    if (job.signal?.aborted) return null;
    record = {
      ...base,
      status: "crashed",
      score: 0,
      answers: grade(posed.expected, null).answers,
      models: [...models].slice(0, 8),
      seconds: Math.round((Date.now() - started) / 1000),
      note: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
    };
  }
  return (await node.call<{ trial: TrialView }>("recordTrial", record)).trial;
}

/** A run: every problem (repeated), a few at a time. */
export async function runTrials(node: NodeClient, options: TrialRunOptions): Promise<{ run: string; trials: TrialView[] }> {
  const run = `r-${Date.now().toString(36)}`;
  const version = galahadRevision();
  const jobs = options.problems.flatMap((problem) =>
    Array.from({ length: options.repeat }, (_, i) => ({ problem, seed: options.seed === undefined ? freshSeed() : (options.seed + i) >>> 0 })),
  );
  const trials: TrialView[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < jobs.length && !options.signal?.aborted) {
      const { problem, seed } = jobs[next++]!;
      options.progress?.({ type: "start", problem, seed });
      const trial = await runTrial(node, { problem, seed, run, suite: options.suite, version, network: options.network, isolation: options.isolation, on: options.on, signal: options.signal });
      if (trial) {
        trials.push(trial);
        options.progress?.({ type: "done", trial });
      } else options.progress?.({ type: "skipped", problem, why: "stopped" });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(options.parallel, jobs.length)) }, worker));
  return { run, trials };
}

/* ---------- the terminal ---------- */

const tty = process.stdout.isTTY;
const dim = (s: string) => (tty ? `\x1b[2m${s}\x1b[0m` : s);
const bold = (s: string) => (tty ? `\x1b[1m${s}\x1b[0m` : s);
const pct = (x: number) => `${(100 * x).toFixed(0)}%`;
const minutes = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s` : `${s}s`);
const num = (x: number | null) => (x === null ? "—" : Number(x.toPrecision(6)).toString());

export function describeTrial(t: TrialView, detail = false): string {
  const passed = t.answers.filter((a) => a.ok).length;
  const mark = t.status === "crashed" ? "!" : t.score === 1 ? "✓" : t.score > 0 ? "△" : "✗";
  const head = `${mark} ${t.problem.padEnd(26)} ${t.status === "crashed" ? "crashed".padEnd(9) : `${passed}/${t.answers.length}`.padEnd(9)} ${dim(`${minutes(t.seconds)} · seed ${t.seed}`)}`;
  const lines = [head];
  for (const a of t.answers) {
    if (!detail && a.ok) continue;
    lines.push(dim(`      ${a.ok ? "ok " : "off"} ${a.key.padEnd(22)} got ${num(a.got).padEnd(12)} expected ${num(a.expected)} ± ${num(a.tolerance)} ${a.units}`));
  }
  if (t.note && (detail || t.status === "crashed")) lines.push(dim(`      ${t.note}`));
  return lines.join("\n");
}

export function describeIndex(trials: readonly TrialView[]): string {
  const scored = trials.filter((t) => t.status === "scored");
  const crashed = trials.length - scored.length;
  const index = galahadIndex(scored.map((t) => t.score));
  const solved = scored.filter((t) => t.score === 1).length;
  return (
    `${bold(`Galahad Index ${pct(index.mean)}`)} ${dim(`(90% interval ${pct(index.low)}–${pct(index.high)})`)} · ` +
    `${solved} of ${scored.length} solved outright${crashed ? ` · ${crashed} crashed (not counted)` : ""}`
  );
}

export async function trialRunFromCli(node: NodeClient, options: Omit<TrialRunOptions, "signal" | "progress">): Promise<TrialView[]> {
  const controller = new AbortController();
  const onInterrupt = (): void => {
    controller.abort();
    process.stderr.write(dim("\n[stopping: running trials end after their current step and aren't recorded; Ctrl-C again to quit now]\n"));
    process.once("SIGINT", () => process.exit(130));
  };
  process.once("SIGINT", onInterrupt);
  const total = options.problems.length * options.repeat;
  console.log(dim(`[${total} trial(s) from the ${options.suite} suite, ${Math.min(options.parallel, total)} at a time, in the Lab · network ${options.network} · revision ${galahadRevision()}]\n`));
  try {
    const { run, trials } = await runTrials(node, {
      ...options,
      signal: controller.signal,
      progress: (event) => {
        if (event.type === "start") console.log(dim(`… ${event.problem.id} (seed ${event.seed})`));
        else if (event.type === "done") console.log(describeTrial(event.trial));
      },
    });
    if (trials.length) console.log(`\n${describeIndex(trials)}\n${dim(`run ${run} · galahad trials · galahad trial ${run}`)}`);
    return trials;
  } finally {
    process.off("SIGINT", onInterrupt);
  }
}

/** The problems a run would pose: all of a suite, or those named (by id or domain). */
export function chooseProblems(suite: string, names: readonly string[]): TrialProblem[] {
  const all = SUITES[suite];
  if (!all) throw new Error(`no trial suite "${suite}" (there is: ${Object.keys(SUITES).join(", ")})`);
  if (!names.length) return [...all];
  const chosen = all.filter((p) => names.includes(p.id) || names.includes(p.domain));
  const unknown = names.filter((n) => !all.some((p) => p.id === n || p.domain === n));
  if (unknown.length) throw new Error(`no such problem or domain: ${unknown.join(", ")} (galahad trial problems lists them)`);
  return chosen;
}
