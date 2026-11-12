import { describe, expect, test } from "bun:test";
import { type ChatStreamEvent, type RouteName, routes, spendTotal, TrialRecord, type TrialRunsView, type TrialView, type Usage, VARIANTS } from "@galahad/core";
import { ENGINEERING_SUITE, pose, type TrialProblem } from "@galahad/brain";
import { DEFAULT_TOKENS_PER_ATTEMPT, describeCost, describeTrial, estimateLabel, estimateRun, runTrials, type TrialUnit } from "../src/trial-cli.ts";
import { parseBudget, parsePins, parseTokens } from "../src/trial-commands.ts";

/*
 * What a run costs, against a fake node whose stand-in models report their usage (or
 * don't): every model call is counted by role and model and recorded with its trial; a
 * run keeps to its budget and says what it finished; it says first what past runs of the
 * same problems cost; a pinned role asks exactly its model; a variant's switches reach
 * the quest.
 */

const cantilever = ENGINEERING_SUITE.find((p) => p.id === "cantilever-beam")!;
const rlc = ENGINEERING_SUITE.find((p) => p.id === "rlc-step")!;
const exactAnswers = (problem: TrialProblem, seed: number) => JSON.stringify(Object.fromEntries(pose(problem, seed).expected.map((e) => [e.key, e.value])));

interface FakeOptions {
  /** What each role's call reports (null: the provider says nothing). */
  usage?: (role: string, model: string) => Usage | null;
  past?: { trials: TrialView[]; runs?: TrialRunsView };
}

function fakeNode(options: FakeOptions = {}) {
  const calls: { name: RouteName; input: any }[] = [];
  const chats: any[] = [];
  const recorded: TrialView[] = [];
  const runs: any[] = [];
  const turns = new Map<string, number>();
  let created = 0;
  const node = {
    async call<T>(name: RouteName, input?: any): Promise<T> {
      calls.push({ name, input });
      switch (name) {
        case "trials":
          return (options.past ?? { trials: [], runs: {} }) as T;
        case "startTrialRun":
          runs.push(routes.startTrialRun.input.parse(input));
          return { run: input.run } as T;
        case "effort":
          return { quest: input.quest, attempts: input.effort, asked: input.effort, host: "ultra", reasons: [], budget: { perDay: 12, usedToday: 0 } } as T;
        case "createSandbox":
          created += 1;
          return { sandbox: { id: String(created).padStart(10, "0"), node: "n_ultra", image: "galahad/lab:1", network: input.network, isolation: "container", cpus: 4, memoryGb: 8, providers: [], quest: input.quest } } as T;
        case "fleet":
          throw new Error("not needed");
        case "execSandbox": {
          const command: string = input.cmd[2];
          await Bun.sleep(1);
          if (command.includes("cat /work/out/answer.json")) return { exitCode: 0, stdout: exactAnswers(cantilever, 11), stderr: "", durationMs: 1, truncated: false } as T;
          return { exitCode: 0, stdout: "ok", stderr: "", durationMs: 1, truncated: false } as T;
        }
        case "saveArtifact":
          return { artifact: null } as T;
        case "destroySandbox":
          return {} as T;
        case "recordTrial": {
          const { spent, ...record } = routes.recordTrial.input.parse(input);
          const view = { ...TrialRecord.parse(record), id: `tr_${String(recorded.length).padStart(22, "0")}`, recordedAt: recorded.length, nodeName: "ultra", ...(spent ? { spent: { lines: spent } } : {}) };
          recorded.push(view);
          return { trial: view } as T;
        }
        default:
          throw new Error(`unexpected call ${name}`);
      }
    },
    async *stream(_name: RouteName, input: any): AsyncGenerator<ChatStreamEvent> {
      chats.push(input);
      const role: string = input.role;
      const ref: string = input.model ?? `fake/${role}`;
      yield { type: "model", ref };
      const first: string = input.messages[0].content;
      let text: string;
      if (role === "planner") text = "1. Solve it.\n2. Write answer.json.";
      else if (role === "engineer") {
        const turn = (turns.get(first) ?? 0) + 1;
        turns.set(first, turn);
        text = turn % 2 === 1 ? "Solving.\n```sh\npython3 /work/out/solve.py\n```" : "DONE\nWrote /work/out/answer.json.";
      } else text = "PASS\nThe answer file is there.";
      yield { type: "text", text };
      const usage = options.usage ? options.usage(role, ref) : { input: 1000, output: 100 };
      yield { type: "usage", ref, usage };
      yield { type: "done", ref };
    },
  };
  return { node, calls, chats, recorded, runs };
}

describe("what a trial spent", () => {
  test("every model call is counted by role and model, and recorded beside the trial: counts only", async () => {
    const { node, recorded } = fakeNode({ usage: (role) => (role === "engineer" ? { input: 4000, output: 300, cached: 3000, reasoning: 120 } : { input: 900, output: 80 }) });
    const { trials, spent } = await runTrials(node, { suite: "engineering", problems: [cantilever], repeat: 1, parallel: 1, network: "gateway", seed: 11 });
    expect(trials[0]!.score).toBe(1);
    // One plan, two engineer turns (a command, then DONE), one review.
    expect(trials[0]!.spent!.lines).toEqual([
      { role: "engineer", model: "fake/engineer", calls: 2, unknown: 0, input: 8000, output: 600, cached: 6000, reasoning: 240 },
      { role: "planner", model: "fake/planner", calls: 1, unknown: 0, input: 900, output: 80, cached: 0, reasoning: 0 },
      { role: "reviewer", model: "fake/reviewer", calls: 1, unknown: 0, input: 900, output: 80, cached: 0, reasoning: 0 },
    ]);
    expect(spendTotal(spent).tokens).toBe(8600 + 980 + 980);
    // Nothing of a prompt or an answer is in what's recorded.
    expect(JSON.stringify(recorded[0]!.spent)).not.toMatch(/Solving|DONE|PASS|cantilever/i);
    expect(describeTrial(trials[0]!, true, { "fake/*": { input: 1, output: 2 } })).toMatch(/spent: 9,800 tokens in \(6,000 cached\), 760 out \(240 reasoning\) · 4 calls · \$0\.01/);
  });

  test("a provider that reports nothing: the calls are counted, their tokens unknown, and no figure is made up", async () => {
    const { node } = fakeNode({ usage: (role) => (role === "engineer" ? null : { input: 500, output: 50 }) });
    const { trials } = await runTrials(node, { suite: "engineering", problems: [cantilever], repeat: 1, parallel: 1, network: "gateway", seed: 11 });
    const engineer = trials[0]!.spent!.lines.find((l) => l.role === "engineer")!;
    expect(engineer).toMatchObject({ calls: 2, unknown: 2, input: 0, output: 0 });
    expect(spendTotal(trials[0]!.spent!.lines).complete).toBe(false);
    // The Index's cost columns leave such a trial out rather than count it short.
    expect(describeCost(trials, {})).toMatch(/tokens unknown/);
  });
});

describe("a run's budget", () => {
  test("the budget is spent: no more trials start, what finished is recorded, and the run says so", async () => {
    // Each trial costs 4 calls of 1,100 tokens: 4,400. A budget of 6,000 is spent during the second.
    const { node, recorded, runs } = fakeNode();
    const events: string[] = [];
    const result = await runTrials(node, {
      suite: "engineering",
      problems: [cantilever],
      repeat: 5,
      parallel: 1,
      network: "gateway",
      seed: 11,
      budget: { tokens: 6000 },
      progress: (e) => void events.push(e.type === "spent" ? `spent:${e.finished}/${e.stopped}/${e.notStarted}` : e.type),
    });
    expect(result.trials).toHaveLength(1);
    expect(recorded).toHaveLength(1);
    // The second was stopped mid-way (not recorded: a stop says nothing about ability); three never started.
    expect(result.budgetEnded).toMatchObject({ stopped: 1, notStarted: 3 });
    expect(result.budgetEnded!.why).toMatch(/budget of 6,000 tokens is spent/);
    expect(events.at(-1)).toBe("spent:1/1/3");
    // It never ran far past it: the stop lands after the call that crossed it.
    expect(spendTotal(result.spent).tokens).toBeLessThanOrEqual(6000 + 1100);
    // The budget is on record with the run.
    expect(runs[0]).toMatchObject({ budget: { tokens: 6000 }, seed: 11, effort: 1 });
  });

  test("with no budget named, the run takes an allowance for every attempt it would make, and says it's the default", async () => {
    const { node, runs } = fakeNode();
    const seen: any[] = [];
    await runTrials(node, { suite: "engineering", problems: [cantilever, rlc], repeat: 2, parallel: 2, network: "gateway", seed: 11, progress: (e) => void (e.type === "budget" && seen.push(e)) });
    expect(seen[0]).toMatchObject({ byDefault: true, budget: { tokens: 4 * DEFAULT_TOKENS_PER_ATTEMPT } });
    // Nothing asked for beyond a plain run: no run record, as ever.
    expect(runs).toEqual([]);
  });

  test("a money budget is counted at your prices, and can't be kept blind: an unpriced model ends the run", async () => {
    const priced = fakeNode();
    const a = await runTrials(priced.node, { suite: "engineering", problems: [cantilever], repeat: 4, parallel: 1, network: "gateway", seed: 11, budget: { usd: 0.01 }, prices: { "fake/*": { input: 1, output: 10 } } });
    // A call costs $0.002: the fifth crosses a cent, in the second trial.
    expect(a.trials).toHaveLength(1);
    expect(a.budgetEnded!.why).toMatch(/budget of \$0\.01 is spent/);
    const blind = fakeNode();
    const b = await runTrials(blind.node, { suite: "engineering", problems: [cantilever], repeat: 2, parallel: 1, network: "gateway", seed: 11, budget: { usd: 5 }, prices: { "fake/planner": { input: 1, output: 1 } } });
    expect(b.trials).toHaveLength(0);
    expect(b.budgetEnded!.why).toMatch(/needs a price for every model that answers, and there's none for fake\/engineer/);
  });

  test("how a budget is spelled", () => {
    expect([parseTokens("2M"), parseTokens("750k"), parseTokens("1500000"), parseTokens("1.5m")]).toEqual([2_000_000, 750_000, 1_500_000, 1_500_000]);
    expect(() => parseTokens("lots")).toThrow(/isn't a number of tokens/);
    expect(parseBudget({ budget: "2M", "budget-usd": "$5" })).toEqual({ tokens: 2_000_000, usd: 5 });
    expect(parseBudget({})).toBeUndefined();
    expect(() => parseBudget({ "budget-usd": "free" })).toThrow(/US dollars/);
  });
});

describe("what a run will cost, going by the past", () => {
  const past = (problem: string, run: string, tokens: number | null): TrialView => ({
    id: `tr_${run}${problem}`,
    run,
    suite: "engineering",
    problem,
    title: problem,
    domain: "x",
    seed: 1,
    status: "scored",
    score: 1,
    answers: [],
    models: [],
    version: "v",
    seconds: 60,
    recordedAt: 0,
    nodeName: "ultra",
    ...(tokens === null ? {} : { spent: { lines: [{ role: "engineer", model: "p/m", calls: 3, unknown: 0, input: tokens - 100, output: 100, cached: 0, reasoning: 0 }] } }),
  });

  test("the mean of each problem's past trials at the same effort; a problem never counted goes by the others, and says so", () => {
    const trials = [past("cantilever-beam", "r-a", 300_000), past("cantilever-beam", "r-b", 500_000), past("rlc-step", "r-a", null)];
    const estimate = estimateRun(trials, [cantilever, rlc], 2, 1, {}, { "p/m": { input: 1, output: 1 } });
    expect(estimate).toMatchObject({ tokens: 1_600_000, known: 2, of: 4 });
    expect(estimate.usd).toBeCloseTo(1.6, 9);
    expect(estimateLabel(estimate)).toBe("going by past runs it will cost about 1.60M tokens ($1.60), known for 2 of its 4 trials and assumed alike for the rest");
  });

  test("past trials at another effort count as that many attempts' worth", () => {
    const estimate = estimateRun([past("cantilever-beam", "r-three", 900_000)], [cantilever], 1, 1, { "r-three": 3 });
    expect(estimate.tokens).toBe(300_000);
    expect(estimateRun([past("cantilever-beam", "r-one", 300_000)], [cantilever], 1, 3, {}).tokens).toBe(900_000);
  });

  test("nothing known: it says so rather than guess", async () => {
    const none = estimateRun([past("rlc-step", "r-a", null)], [cantilever, rlc], 1, 1, {});
    expect(none).toEqual({ tokens: null, usd: null, known: 0, of: 2 });
    expect(estimateLabel(none)).toMatch(/unknown: none of these problems has been tried with its calls counted/);
    // And a run says it before its first trial.
    const { node } = fakeNode({ past: { trials: [past("cantilever-beam", "r-a", 400_000)] } });
    const said: any[] = [];
    await runTrials(node, { suite: "engineering", problems: [cantilever], repeat: 1, parallel: 1, network: "gateway", seed: 11, progress: (e) => void (e.type === "budget" && said.push(e.estimate)) });
    expect(said).toEqual([{ tokens: 400_000, usd: null, known: 1, of: 1 }]);
  });
});

describe("a role held to one model, and a variant of the harness", () => {
  test("--pin engineer=…: the engineer asks exactly that model, the others ask the roster, and the run records it", async () => {
    const { node, chats, runs, recorded } = fakeNode();
    await runTrials(node, { suite: "engineering", problems: [cantilever], repeat: 1, parallel: 1, network: "gateway", seed: 11, pins: { engineer: "deepseek/deepseek-v4-pro" } });
    expect(chats.filter((c) => c.role === "engineer").every((c) => c.model === "deepseek/deepseek-v4-pro")).toBe(true);
    expect(chats.filter((c) => c.role !== "engineer").every((c) => c.model === undefined)).toBe(true);
    expect(runs[0]).toMatchObject({ pins: { engineer: "deepseek/deepseek-v4-pro" }, effort: 1 });
    expect(recorded[0]!.spent!.lines.find((l) => l.role === "engineer")!.model).toBe("deepseek/deepseek-v4-pro");
    expect(parsePins(["engineer=deepseek/deepseek-v4-pro", "reviewer=a/b"])).toEqual({ engineer: "deepseek/deepseek-v4-pro", reviewer: "a/b" });
    expect(parsePins([])).toBeUndefined();
    expect(() => parsePins(["swift=a/b"])).toThrow(/the role one of planner, engineer, reviewer/);
    expect(() => parsePins(["engineer=nomodel"])).toThrow(/<role>=<provider>\/<model>/);
    expect(() => parsePins(["engineer=a/b", "engineer=c/d"])).toThrow(/twice/);
  });

  test("a variant's switches reach the quest, and the run records the variant by name", async () => {
    const bare = fakeNode();
    await runTrials(bare.node, { suite: "engineering", problems: [cantilever], repeat: 1, parallel: 1, network: "gateway", seed: 11, variant: { name: "bare", options: VARIANTS.bare! } });
    expect(bare.recorded[0]).toMatchObject({ status: "scored", score: 1 });
    // No archive context with the plan, no skills offered.
    expect(bare.chats.filter((c) => c.role === "planner")).toHaveLength(1);
    expect(bare.chats.find((c) => c.role === "planner")).not.toHaveProperty("archive");
    expect(bare.chats.every((c) => c.quest === undefined)).toBe(true);
    expect(bare.runs[0]).toMatchObject({ variant: { name: "bare", options: VARIANTS.bare }, effort: 1 });

    const skilled = fakeNode();
    await runTrials(skilled.node, { suite: "engineering", problems: [cantilever], repeat: 1, parallel: 1, network: "gateway", seed: 11, variant: { name: "skills", options: VARIANTS.skills! } });
    expect(skilled.chats.find((c) => c.role === "planner")).toMatchObject({ archive: true, quest: { goal: expect.any(String) } });
    expect(skilled.chats.find((c) => c.role === "reviewer")!.quest).toBeUndefined();
    // Offered, and still a trial: nothing is remembered or learned from it.
    expect(skilled.calls.some((c) => c.name === ("remember" as RouteName) || c.name === ("learnSkill" as RouteName))).toBe(false);
  });
});

describe("a unit of another suite", () => {
  test("its record is recorded with what it spent, like any trial; a crash in it is the unit's to report", async () => {
    const unit: TrialUnit = {
      id: "a-case",
      title: "A case",
      domain: "should-pass",
      attempt: async (_node, job) => {
        job.spent?.({ role: "reviewer", model: "p/judge", usage: { input: 700, output: 9 } });
        return { run: job.run, suite: job.suite, problem: "a-case", title: "A case", domain: "should-pass", seed: job.seed, status: "scored", score: 1, answers: [{ key: "verdict", units: "pass", expected: 1, got: 1, tolerance: 0, ok: true }], models: ["p/judge"], version: job.version, seconds: 1 };
      },
    };
    const { node } = fakeNode();
    const { trials } = await runTrials(node, { suite: "reviewer", problems: [unit], repeat: 2, parallel: 2, network: "gateway", seed: 3 });
    expect(trials.map((t) => [t.problem, t.seed, t.spent!.lines[0]!.input])).toEqual([
      ["a-case", 3, 700],
      ["a-case", 4, 700],
    ]);
    expect(describeTrial(trials[0]!, true)).toContain("ok     verdict");
  });
});
