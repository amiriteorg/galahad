import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type ComputeView, type EffortLevel, effortReport, galahadIndex, type SandboxNetwork, type TrialRecord, type TrialRunsView, type TrialView } from "@galahad/core";
import { grade, pose, SUITES, TRIAL_EVIDENCE, TRIAL_INSTRUCTIONS, type TrialProblem } from "@galahad/brain";
import { type NodeClient, runNodeQuest } from "./quest-cli.ts";

/*
 * `galahad trial run`: each problem is posed with fresh random parameters, solved as
 * an ordinary quest in the Lab (models only, no internet: nothing to look up), graded
 * here against the exact answers, and recorded in the mind. The Galahad Index is the
 * mean score of a run, with a bootstrap interval.
 *
 * Trials run in parallel across the fleet's free slots, and a run may spend effort: each
 * trial then makes that many attempts, the reviewer takes one on the evidence, and only
 * that one's answers are graded (the grader never tells the reviewer which was right).
 * A run records its effort, so the Index per effort level says, with its interval,
 * whether more compute made him more capable.
 */

export interface TrialRunOptions {
  suite: string;
  problems: readonly TrialProblem[];
  /** The same seed poses the same problem (default: a fresh one per trial). */
  seed?: number;
  repeat: number;
  /** How many trials at once; "auto": as many as the free slots carry at this effort. */
  parallel: number | "auto";
  /** Attempts per trial (the run records it). Left out: one, and nothing about effort is recorded or asked. */
  effort?: EffortLevel;
  network: SandboxNetwork;
  isolation?: "container" | "vm";
  on?: string;
  signal?: AbortSignal;
  /** As each trial starts and ends. */
  progress?(
    event:
      | { type: "start"; problem: TrialProblem; seed: number }
      | { type: "done"; trial: TrialView }
      | { type: "skipped"; problem: TrialProblem; why: string }
      /** How the run will go: trials at once, and why (the slots there are). */
      | { type: "plan"; parallel: number; effort: EffortLevel | null; why: string },
  ): void;
}

/**
 * How many trials run at once: no more than the fleet's sandbox slots carry at this effort (what's asked for
 * beyond that would only wait in the queue until it gave up). With "auto", what's free now. A fleet whose
 * slots can't carry one trial at the effort asked can't measure it, and says so.
 */
export function planParallel(census: Pick<ComputeView, "nodes"> | null, asked: number | "auto", effort: number, jobs: number, on?: string): { parallel: number; why: string } {
  const fallback = Math.max(1, Math.min(asked === "auto" ? 3 : asked, jobs));
  if (!census) return { parallel: fallback, why: "the node doesn't say what it carries" };
  const hosts = census.nodes.filter((n) => (on ? n.name === on || n.id === on : n.online) && (n.capacity?.sandboxes ?? 0) > 0);
  const slots = hosts.reduce((sum, n) => sum + n.capacity!.sandboxes, 0);
  const free = hosts.reduce((sum, n) => sum + (n.free ?? 0), 0);
  const where = on ?? (hosts.length === 1 ? hosts[0]!.name : "the fleet");
  if (slots < effort) throw new Error(`${where} carries ${slots} sandbox${slots === 1 ? "" : "es"} at once: effort ${effort} can't be measured there (galahad compute)`);
  const most = Math.max(1, Math.floor(slots / effort));
  if (asked === "auto") {
    const now = Math.max(1, Math.min(most, Math.floor(free / effort) || 1, jobs, 8));
    return { parallel: now, why: `${free} of ${slots} slots free on ${where}${effort > 1 ? `, ${effort} attempts a trial` : ""}` };
  }
  const parallel = Math.max(1, Math.min(asked, most, jobs));
  return { parallel, why: parallel < Math.min(asked, jobs) ? `${where} carries ${slots} slots${effort > 1 ? `, ${effort} attempts a trial` : ""}: ${parallel} at once, not ${asked}` : `${slots} slots on ${where}` };
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
  job: { problem: TrialProblem; seed: number; run: string; suite: string; version: string; network: SandboxNetwork; isolation?: "container" | "vm"; on?: string; signal?: AbortSignal; effort?: EffortLevel },
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
        ...(job.effort !== undefined ? { effort: job.effort } : {}),
      },
      {
        signal: job.signal,
        // A run is measured at one effort: a trial the node couldn't give it to says nothing about that level.
        effort: (event) => {
          if (event.type === "granted" && job.effort !== undefined && event.grant.attempts !== job.effort) {
            throw new Error(`the node granted ${event.grant.attempts} attempt(s), not the run's ${job.effort}: ${event.grant.reasons.join(" ")}`);
          }
        },
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
  // Across the slots there are: with effort (or "auto"), the node says what it carries; otherwise as asked.
  const effort = options.effort;
  const census = effort !== undefined || options.parallel === "auto" ? await node.call<ComputeView>("compute").catch(() => null) : null;
  const plan = effort !== undefined || options.parallel === "auto" ? planParallel(census, options.parallel, effort ?? 1, jobs.length, options.on) : { parallel: options.parallel as number, why: "as asked" };
  options.progress?.({ type: "plan", parallel: Math.max(1, Math.min(plan.parallel, jobs.length)), effort: effort ?? null, why: plan.why });
  // The run's effort is on record before its first trial, so the Index per effort can be told apart.
  if (effort !== undefined) await node.call("startTrialRun", { run, suite: options.suite, effort, parallel: plan.parallel });
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < jobs.length && !options.signal?.aborted) {
      const { problem, seed } = jobs[next++]!;
      options.progress?.({ type: "start", problem, seed });
      const trial = await runTrial(node, { problem, seed, run, suite: options.suite, version, network: options.network, isolation: options.isolation, on: options.on, signal: options.signal, ...(effort !== undefined ? { effort } : {}) });
      if (trial) {
        trials.push(trial);
        options.progress?.({ type: "done", trial });
      } else options.progress?.({ type: "skipped", problem, why: "stopped" });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(plan.parallel, jobs.length)) }, worker));
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

/**
 * The Index per effort level, and whether more compute measurably helped (the same rule as any change: its
 * interval must clear effort 1's). Empty when no run recorded an effort above 1.
 */
export function describeEffort(trials: readonly TrialView[], runs: TrialRunsView): string {
  const efforts = Object.fromEntries(Object.entries(runs).map(([run, settings]) => [run, settings.effort]));
  if (!Object.values(efforts).some((e) => e > 1)) return "";
  const report = effortReport(trials, efforts);
  return [
    `${bold("By effort")} ${dim("(attempts per trial; the reviewer takes one on the evidence before anything is graded)")}`,
    ...report.levels.map((l) => `  effort ${l.effort}   ${pct(l.mean).padStart(4)}  ${dim(`90% interval ${pct(l.low)}–${pct(l.high)} · ${l.n} trial${l.n === 1 ? "" : "s"} in ${l.runs} run${l.runs === 1 ? "" : "s"}`)}`),
    `  ${report.verdict}`,
  ].join("\n");
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
  try {
    const { run, trials } = await runTrials(node, {
      ...options,
      signal: controller.signal,
      progress: (event) => {
        if (event.type === "plan") {
          console.log(
            dim(
              `[${total} trial(s) from the ${options.suite} suite, ${event.parallel} at a time (${event.why})${event.effort ? `, effort ${event.effort}${event.effort > 1 ? `: ${event.effort} attempts each, ${total * (event.effort - 1)} extra attempts in all` : ""}` : ""}, in the Lab · network ${options.network} · revision ${galahadRevision()}]\n`,
            ),
          );
        } else if (event.type === "start") console.log(dim(`… ${event.problem.id} (seed ${event.seed})`));
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
