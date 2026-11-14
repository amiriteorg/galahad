import {
  type Comparison,
  compareTrials,
  costOf,
  type EffortLevel,
  mergeSpend,
  modelReport,
  reviewerLine,
  reviewerReport,
  type RoleReport,
  variantReport,
  parseVariant,
  type Price,
  type Prices,
  describeVariant,
  spendLabel,
  spendTotal,
  tokensLabel,
  TRIAL_ROLES,
  VARIANTS,
  type TrialPins,
  type TrialRunsView,
  type TrialVariant,
  type TrialView,
  type UsageLine,
  type UsageView,
  usdLabel,
} from "@galahad/core";
import type { NodeClient } from "./quest-cli.ts";
import { budgetLabel, describeCost, describeDone, describeEffort, describeIndex, describeTrial, estimateLabel, estimateRun, type RunResult, type TrialBudget, trialRunFromCli } from "./trial-cli.ts";
import { suiteNamed, TRIAL_SUITES } from "./trial-suites.ts";

/*
 * `galahad trial …`, `galahad trials`, `galahad price …` and `galahad usage`: the
 * terminal's side of the Trials and of what model calls cost. Everything here reads
 * the node or starts a run through it; nothing is decided here that a replica
 * couldn't check.
 */

const tty = process.stdout.isTTY;
const dim = (s: string) => (tty ? `\x1b[2m${s}\x1b[0m` : s);
const bold = (s: string) => (tty ? `\x1b[1m${s}\x1b[0m` : s);

export class UsageError extends Error {}
const bad = (message: string): never => {
  throw new UsageError(message);
};

export interface TrialArgs {
  command: "trial" | "trials";
  sub: string | undefined;
  rest: readonly string[];
  flags: Readonly<Record<string, unknown>>;
  /** The node, when the command needs one (listing a suite's problems doesn't). */
  node: () => NodeClient;
  isolation?: "vm" | "container";
}

const str = (flags: TrialArgs["flags"], key: string): string | undefined => (typeof flags[key] === "string" ? (flags[key] as string) : undefined);
const many = (flags: TrialArgs["flags"], key: string): string[] => {
  const v = flags[key];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" ? [v] : [];
};

function whole(flags: TrialArgs["flags"], key: string, fallback: number, max: number): number {
  const raw = str(flags, key);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > max) bad(`--${key} must be a whole number from 1 to ${max}`);
  return n;
}

/** `2M`, `750k`, `1500000`: tokens. */
export function parseTokens(raw: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*([kKmM]?)$/.exec(raw.trim());
  if (!m) return bad(`"${raw}" isn't a number of tokens (2M, 750k, 1500000)`);
  const n = Math.round(Number(m[1]) * (m[2] === "" ? 1 : m[2]!.toLowerCase() === "k" ? 1e3 : 1e6));
  if (!Number.isSafeInteger(n) || n < 1) return bad(`"${raw}" isn't a number of tokens (2M, 750k, 1500000)`);
  return n;
}

/** `--budget 2M` (tokens) and `--budget-usd 5` (money at your prices); neither: the run's default allowance. */
export function parseBudget(flags: TrialArgs["flags"]): TrialBudget | undefined {
  const tokens = str(flags, "budget");
  const usdRaw = str(flags, "budget-usd");
  const usd = usdRaw === undefined ? undefined : Number(usdRaw.replace(/^\$/, ""));
  if (usd !== undefined && (!Number.isFinite(usd) || usd <= 0)) bad("--budget-usd takes an amount in US dollars, e.g. --budget-usd 5");
  if (tokens === undefined && usd === undefined) return undefined;
  return { ...(tokens !== undefined ? { tokens: parseTokens(tokens) } : {}), ...(usd !== undefined ? { usd } : {}) };
}

/** `--pin engineer=provider/model` (repeatable): one model for that role, for the whole run. */
export function parsePins(pins: readonly string[]): TrialPins | undefined {
  const out: Record<string, string> = {};
  for (const pin of pins) {
    const eq = pin.indexOf("=");
    const role = eq > 0 ? pin.slice(0, eq) : "";
    const model = eq > 0 ? pin.slice(eq + 1) : "";
    if (!(TRIAL_ROLES as readonly string[]).includes(role) || !/^[A-Za-z0-9._:-]+\/\S+$/.test(model)) bad(`--pin takes <role>=<provider>/<model>, the role one of ${TRIAL_ROLES.join(", ")} (got "${pin}")`);
    if (out[role]) bad(`--pin names ${role} twice: a role is held to one model`);
    out[role] = model;
  }
  return Object.keys(out).length ? (out as TrialPins) : undefined;
}

/** What `trial run`, `sweep` and `ab` share: the suite, the problems, how many, at what effort, within what budget. */
async function runOptions(args: TrialArgs, names: readonly string[]) {
  const { flags } = args;
  const suite = suiteNamed(str(flags, "suite") ?? "engineering");
  const network = str(flags, "net") ?? suite.network;
  if (!(suite.networks as readonly string[]).includes(network)) bad(`--net must be ${suite.networks.join(" or ")} for the ${suite.id} suite`);
  const seedRaw = str(flags, "seed");
  const seed = seedRaw === undefined ? undefined : Number(seedRaw);
  if (seed !== undefined && (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)) bad("--seed must be a whole number from 0 to 4294967295");
  const levelRaw = str(flags, "level");
  if (levelRaw !== undefined && !suite.levels) bad(`the ${suite.id} suite has no --level`);
  const level = levelRaw === undefined ? undefined : Number(levelRaw);
  if (level !== undefined && suite.levels && (!Number.isInteger(level) || level < suite.levels.min || level > suite.levels.max)) bad(`--level must be a whole number from ${suite.levels.min} to ${suite.levels.max}`);
  const problems = suite.choose(names, level);
  // A run is measured at one level: auto would mix them.
  const effortRaw = str(flags, "effort");
  if (effortRaw !== undefined && !["1", "2", "3"].includes(effortRaw)) bad("--effort must be 1, 2 or 3 for a trial run (a run is measured at one level; auto would mix them)");
  const variantRaw = str(flags, "variant");
  let variant: TrialVariant | undefined;
  if (variantRaw !== undefined) {
    try {
      variant = parseVariant(variantRaw);
    } catch (error) {
      bad(`--variant: ${(error as Error).message}`);
    }
    if (effortRaw !== undefined && Number(effortRaw) !== variant!.options.effort) bad(`--effort ${effortRaw} and variant ${variant!.name} (effort ${variant!.options.effort}) disagree: a run is measured at one level`);
  }
  const budget = parseBudget(flags);
  // Across the free slots by default (auto); a number is kept within what the slots carry.
  const parallelRaw = str(flags, "parallel");
  const node = args.node();
  // A money budget is counted at your prices: they're read once, when the run starts.
  const prices: Prices = (await node.call<{ prices: Record<string, Price> }>("prices").catch(() => ({ prices: {} }))).prices;
  return {
    suite,
    node,
    options: {
      suite: suite.id,
      problems,
      repeat: whole(flags, "repeat", 1, 20),
      parallel: parallelRaw === undefined || parallelRaw === "auto" ? ("auto" as const) : whole(flags, "parallel", 3, 8),
      ...(effortRaw !== undefined ? { effort: Number(effortRaw) as EffortLevel } : {}),
      ...(variant ? { variant } : {}),
      ...(parsePins(many(flags, "pin")) ? { pins: parsePins(many(flags, "pin"))! } : {}),
      ...(budget ? { budget } : {}),
      prices,
      network: network as "gateway" | "online" | "isolated",
      ...(args.isolation ? { isolation: args.isolation } : {}),
      ...(str(flags, "on") ? { on: str(flags, "on")! } : {}),
      ...(seed !== undefined ? { seed } : {}),
    },
  };
}

const pct = (x: number): string => `${(100 * x).toFixed(0)}%`;
const fig = (x: number): string => (x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x >= 1 ? x.toFixed(2) : x.toPrecision(2));

/** Each role's candidates: the Index with its interval, tokens, time and money a trial, and what the quality cost; then which is best, and how sure. */
export function describeModels(reports: readonly RoleReport[]): string {
  const out: string[] = [];
  for (const report of reports) {
    out.push(`${bold(`As ${report.role}`)} ${dim("(one role held to one model; every other role as the roster has it; effort 1, the baseline harness)")}`);
    for (const row of report.rows) {
      const cost = [
        row.tokensPerTrial !== null ? `${tokensLabel(row.tokensPerTrial)} tokens a trial` : "tokens unknown",
        `${Math.round(row.secondsPerTrial)}s a trial`,
        row.usdPerTrial !== null ? `${usdLabel(row.usdPerTrial)} a trial` : "no price",
        row.perUsd ? `${fig(row.perUsd.mean)} points a dollar (${fig(row.perUsd.low)}–${fig(row.perUsd.high)})` : row.perMTok ? `${fig(row.perMTok.mean)} points a million tokens (${fig(row.perMTok.low)}–${fig(row.perMTok.high)})` : "",
      ].filter(Boolean);
      out.push(`  ${(row.model ?? "the roster as it is").padEnd(40)} ${pct(row.quality.mean).padStart(4)}  ${dim(`90% interval ${pct(row.quality.low)}–${pct(row.quality.high)} · ${row.quality.n} trial${row.quality.n === 1 ? "" : "s"}${row.crashed ? ` · ${row.crashed} crashed` : ""} · ${cost.join(" · ")}`)}`);
    }
    out.push(`  ${report.best}`, `  ${report.bestForCost}`);
  }
  return out.join("\n");
}

/** A comparison of two sets of trials, in the words the report gives it. */
export const describeComparison = (c: Comparison): string => [`${bold(`${c.b.name} against ${c.a.name}`)} ${dim(`(runs ${[...c.a.runs, ...c.b.runs].join(", ")})`)}`, ...c.lines.map((line) => `  ${line}`)].join("\n");

/** What a budget has left after what was spent (a run made after others in one command gets the rest). */
function remaining(budget: TrialBudget | undefined, spent: readonly UsageLine[], prices: Prices): TrialBudget | undefined {
  if (!budget) return undefined;
  return {
    ...(budget.tokens !== undefined ? { tokens: Math.max(1, budget.tokens - spendTotal(spent).tokens) } : {}),
    ...(budget.usd !== undefined ? { usd: Math.max(0, budget.usd - costOf(spent, prices).usd) } : {}),
  };
}
const spentOut = (budget: TrialBudget | undefined, spent: readonly UsageLine[], prices: Prices): boolean =>
  !!budget && ((budget.tokens !== undefined && spendTotal(spent).tokens >= budget.tokens) || (budget.usd !== undefined && costOf(spent, prices).usd >= budget.usd));

/** A fresh seed for runs that must pose the same tasks, and the group they share. */
const freshGroup = (): { seed: number; group: string } => ({ seed: crypto.getRandomValues(new Uint32Array(1))[0]! >>> 1, group: `g-${Date.now().toString(36)}` });

/** `galahad trial …` and `galahad trials`. Returns the process's exit code. */
export async function trialCommand(args: TrialArgs): Promise<number> {
  const { command, sub, rest, flags } = args;
  // The suites are part of Galahad, not of a node: listing one needs no node.
  if (command === "trial" && sub === "problems") {
    const only = str(flags, "suite");
    for (const suite of only ? [suiteNamed(only)] : Object.values(TRIAL_SUITES)) {
      console.log(`${bold(suite.id)} ${dim(`· ${suite.about}${suite.levels ? ` · --level ${suite.levels.min} to ${suite.levels.max} (usually ${suite.levels.usual})` : ""}`)}`);
      const levelRaw = str(flags, "level");
      for (const p of suite.list(levelRaw === undefined ? undefined : Number(levelRaw))) console.log(`  ${p.id.padEnd(26)} ${p.domain.padEnd(13)} ${p.title}`);
    }
    return 0;
  }
  if (command === "trial" && sub === "run") {
    const { node, suite, options } = await runOptions(args, rest);
    const { trials } = await trialRunFromCli(node, options, suite.where);
    return trials.length ? 0 : 1;
  }
  // One run a candidate, each with the role held to it, on the same seeded tasks: then the role's table.
  if (command === "trial" && sub === "sweep") {
    const [role, ...candidates] = rest;
    if (!role || !(TRIAL_ROLES as readonly string[]).includes(role) || !candidates.length) bad(`usage: galahad trial sweep <${TRIAL_ROLES.join("|")}> <provider/model> [<provider/model> …] [--suite s] [--only problem,…] [--repeat n] [--seed n] [--budget 2M]`);
    for (const ref of candidates) if (!/^[A-Za-z0-9._:-]+\/\S+$/.test(ref)) bad(`a candidate is <provider>/<model>, not "${ref}"`);
    const { node, suite, options } = await runOptions(args, (str(flags, "only") ?? "").split(",").map((s) => s.trim()).filter(Boolean));
    if (options.pins?.[role as keyof TrialPins]) bad(`--pin ${role}=… and a sweep of ${role} disagree: the sweep holds that role to each candidate in turn`);
    const together = { ...freshGroup(), ...(options.seed !== undefined ? { seed: options.seed } : {}) };
    const spent: UsageLine[] = [];
    const made: RunResult[] = [];
    console.log(dim(`[a sweep of ${candidates.length} candidate(s) for ${role}: each runs the same ${options.problems.length * options.repeat} task(s) (seed ${together.seed}) with every other role as the roster has it]\n`));
    for (const ref of candidates) {
      if (spentOut(options.budget, spent, options.prices)) {
        console.log(`${bold("■ The budget is spent:")} ${ref} and what follows weren't run.`);
        break;
      }
      console.log(bold(`— ${role} = ${ref} —`));
      const result = await trialRunFromCli(node, { ...options, ...together, pins: { ...options.pins, [role as string]: ref }, ...(options.budget ? { budget: remaining(options.budget, spent, options.prices)! } : {}) }, suite.where);
      made.push(result);
      spent.push(...result.spent);
      console.log("");
    }
    const { trials, runs = {} } = await node.call<{ trials: TrialView[]; runs?: TrialRunsView }>("trials");
    const mine = new Set(made.map((m) => m.run));
    const report = modelReport(trials.filter((t) => mine.has(t.run)), runs, options.prices, suite.id);
    if (report.length) console.log(describeModels(report));
    console.log(dim(`\nspent in all: ${spendLabel(mergeSpend(spent), options.prices)} · every run of this suite: galahad trials --suite ${suite.id}`));
    return made.some((m) => m.trials.length) ? 0 : 1;
  }
  // The same seeded tasks under two variants of the harness: then whether the second measurably helps, and what it cost.
  if (command === "trial" && sub === "ab") {
    const [first, second, ...names] = rest;
    if (!first || !second) bad("usage: galahad trial ab <variant> <variant> [problem …] [--suite s] [--repeat n] [--seed n] [--budget 2M]   (variants: galahad trial variants)");
    let variants: TrialVariant[] = [];
    try {
      variants = [parseVariant(first!), parseVariant(second!)];
    } catch (error) {
      bad((error as Error).message);
    }
    if (variants[0]!.name === variants[1]!.name) bad("an A/B needs two different variants");
    if (str(flags, "variant") || str(flags, "effort")) bad("an A/B takes its two variants (and their effort) as its arguments, not --variant or --effort");
    const { node, suite, options } = await runOptions(args, names);
    const together = { ...freshGroup(), ...(options.seed !== undefined ? { seed: options.seed } : {}) };
    const spent: UsageLine[] = [];
    const made: { variant: TrialVariant; result: RunResult }[] = [];
    console.log(dim(`[${variants[0]!.name} and ${variants[1]!.name} on the same ${options.problems.length * options.repeat} task(s) (seed ${together.seed}): the second is compared with the first]\n`));
    for (const variant of variants) {
      if (spentOut(options.budget, spent, options.prices)) {
        console.log(`${bold("■ The budget is spent:")} ${variant.name} wasn't run, so there is nothing to compare.`);
        break;
      }
      console.log(bold(`— ${variant.name}: ${describeVariant(variant.options)} —`));
      const result = await trialRunFromCli(node, { ...options, ...together, variant, ...(options.budget ? { budget: remaining(options.budget, spent, options.prices)! } : {}) }, suite.where);
      made.push({ variant, result });
      spent.push(...result.spent);
      console.log("");
    }
    if (made.length === 2) console.log(describeComparison(compareTrials({ name: made[0]!.variant.name, trials: made[0]!.result.trials }, { name: made[1]!.variant.name, trials: made[1]!.result.trials }, options.prices)));
    console.log(dim(`\nspent in all: ${spendLabel(mergeSpend(spent), options.prices)}`));
    return made.length === 2 && made.every((m) => m.result.trials.length) ? 0 : 1;
  }
  if (command === "trial" && sub === "variants" && !rest.length && !str(flags, "suite")) {
    console.log(dim("Named sets of harness switches. Each differs from the baseline by one (bare: by all); your own: <name>:gates=off,skills=on,effort=2,planner-gates=on,archive=off,revisions=1"));
    for (const [name, options] of Object.entries(VARIANTS)) console.log(`  ${name.padEnd(15)} ${describeVariant(options)}`);
    return 0;
  }
  if (command === "trial" && sub === "estimate") {
    const { node, options } = await runOptions(args, rest);
    const { trials, runs = {} } = await node.call<{ trials: TrialView[]; runs?: TrialRunsView }>("trials");
    const effort = options.variant?.options.effort ?? options.effort ?? 1;
    const estimate = estimateRun(trials, options.problems, options.repeat, effort, Object.fromEntries(Object.entries(runs).map(([r, s]) => [r, s.effort])), options.prices);
    console.log(`${options.problems.length * options.repeat} trial(s) from the ${options.suite} suite at effort ${effort}: ${estimateLabel(estimate)}.`);
    if (options.budget) console.log(dim(`Your budget: ${budgetLabel(options.budget)}.`));
    return 0;
  }

  const node = args.node();
  const [{ trials, runs: settings = {} }, { prices }] = await Promise.all([
    node.call<{ trials: TrialView[]; runs?: TrialRunsView }>("trials"),
    node.call<{ prices: Record<string, Price> }>("prices").catch(() => ({ prices: {} as Record<string, Price> })),
  ]);
  // Two runs, the second against the first: by the rule, with what each cost.
  if (command === "trial" && sub === "compare") {
    const [a, b] = rest;
    const of = (run: string | undefined): TrialView[] => trials.filter((t) => t.run === run);
    if (!a || !b || !of(a).length || !of(b).length) bad("usage: galahad trial compare <run> <run>   (two runs that have trials: galahad trials lists them)");
    // A run is called by what set it apart (its variant, the role it held to a model), else by its id.
    const said = (run: string): string => settings[run]?.variant?.name ?? Object.entries(settings[run]?.pins ?? {}).map(([role, model]) => `${role}=${model}`).join(" ");
    const names = said(a!) && said(b!) && said(a!) !== said(b!) ? [said(a!), said(b!)] : [a!, b!];
    console.log(describeComparison(compareTrials({ name: names[0]!, trials: of(a) }, { name: names[1]!, trials: of(b) }, prices)));
    return 0;
  }
  if (command === "trials" || !sub || sub === "models" || sub === "variants") {
    if (!trials.length) {
      console.log("No trials yet: galahad trial run (or galahad trial run cantilever-beam for one)");
      return 0;
    }
    const only = str(flags, "suite");
    const suites = [...new Set(trials.map((t) => t.suite))].filter((s) => !only || s === only);
    for (const suite of suites) {
      const of = trials.filter((t) => t.suite === suite);
      if (suites.length > 1 || only) console.log(`${bold(`— ${suite} —`)}`);
      const runs = new Map<string, TrialView[]>();
      for (const t of of) runs.set(t.run, [...(runs.get(t.run) ?? []), t]);
      for (const [run, ts] of [...runs].slice(0, flags.all ? undefined : 10)) {
        const models = [...new Set(ts.flatMap((t) => t.models))];
        const s = settings[run];
        const held = [s ? `effort ${s.effort}` : "", s?.variant ? `variant ${s.variant.name}` : "", ...Object.entries(s?.pins ?? {}).map(([role, model]) => `${role}=${model}`)].filter(Boolean);
        console.log(`${bold(run)} ${dim(`${new Date(Math.min(...ts.map((t) => t.recordedAt))).toLocaleString()} · ${ts[0]!.suite}${held.length ? ` · ${held.join(" · ")}` : ""} · revision ${ts[0]!.version}${models.length ? ` · ${models.join(", ")}` : ""}`)}`);
        console.log(`  ${describeIndex(ts)}`);
        for (const line of [describeCost(ts, prices), describeDone(ts)]) if (line) console.log(line);
      }
      if (runs.size > 10 && !flags.all) console.log(dim(`  … ${runs.size - 10} older run(s): --all`));
      // Did more compute make him more capable? The Index per effort level, with its interval, says.
      const byEffort = describeEffort(of, settings);
      if (byEffort) console.log(`\n${byEffort}`);
      // Which model is best in which role, and best for its cost: from the runs that held a role to one model.
      const byModel = modelReport(of, settings, prices, suite);
      if (byModel.length) console.log(`\n${describeModels(byModel)}`);
      // Does a change to the harness help? Each variant against the baseline run beside it.
      const byVariant = variantReport(of, settings, prices, suite);
      if (byVariant.length) console.log(`\n${bold("Variants of the harness")} ${dim("(the same tasks under each; a change wins only if its interval clears the baseline's)")}\n${byVariant.map(describeComparison).join("\n")}`);
      if (suite === "reviewer") {
        console.log(`\n${bold("The reviewer")} ${dim("(by the model that reviewed; the first error lets wrong work through, the second wastes revisions)")}`);
        for (const row of reviewerReport(of)) console.log(`  ${reviewerLine(row)}`);
      }
      console.log(`\n${bold("By problem")} ${dim("(every run)")}`);
      const known = TRIAL_SUITES[suite]?.list() ?? [];
      const ids = [...new Set([...known.map((p) => p.id), ...of.map((t) => t.problem)])];
      for (const id of ids) {
        const ts = of.filter((t) => t.problem === id && t.status === "scored");
        if (!ts.length) {
          console.log(dim(`  ${id.padEnd(26)} not tried yet`));
          continue;
        }
        const mean = ts.reduce((sum, t) => sum + t.score, 0) / ts.length;
        const counted = ts.filter((t) => t.spent?.lines.length && spendTotal(t.spent.lines).complete);
        const tokens = counted.length ? ` · ${tokensLabel(counted.reduce((sum, t) => sum + spendTotal(t.spent!.lines).tokens, 0) / counted.length)} tokens a try` : "";
        console.log(`  ${id.padEnd(26)} ${`${ts.filter((t) => t.score === 1).length}/${ts.length}`.padEnd(6)} solved · mean score ${(100 * mean).toFixed(0)}%${tokens}`);
      }
      if (suites.length > 1) console.log("");
    }
    return 0;
  }
  const one = trials.find((t) => t.id === sub);
  if (one) {
    console.log(`${bold(one.title)} ${dim(`· ${one.domain} · ${one.id}`)}`);
    console.log(describeTrial(one, true, prices));
    console.log(
      dim(
        `run ${one.run} on ${one.nodeName} · revision ${one.version} · ${new Date(one.recordedAt).toLocaleString()}` +
          (one.quest ? ` · quest ${one.quest.status}, ${one.quest.steps} commands, ${one.quest.revisions} revisions` : "") +
          (one.models.length ? `\nmodels: ${one.models.join(", ")}` : "") +
          (one.artifact ? `\nthe work: galahad artifact ${one.artifact}` : ""),
      ),
    );
    return 0;
  }
  const run = trials.filter((t) => t.run === sub);
  if (!run.length) bad(`no trial or run ${sub}`);
  for (const t of [...run].reverse()) console.log(describeTrial(t));
  const s = settings[sub!];
  console.log(`\n${describeIndex(run)}${s ? dim(` · effort ${s.effort}${s.variant ? ` · variant ${s.variant.name}` : ""}`) : ""}`);
  for (const line of [describeCost(run, prices), describeDone(run)]) if (line) console.log(line);
  return 0;
}

/* ---------- prices and usage ---------- */

const perMillion = (x: number): string => `$${x.toFixed(x < 1 && x > 0 ? 3 : 2)}`;

/** `galahad price` · `price set <provider/model> <in> <out> [--cached x]` · `price rm <provider/model>`. */
export async function priceCommand(node: NodeClient, sub: string | undefined, rest: readonly string[], flags: Readonly<Record<string, unknown>>): Promise<number> {
  if (sub === "set") {
    const [model, input, output] = rest;
    const cachedRaw = str(flags, "cached");
    const numbers = [input, output, cachedRaw].map((x) => (x === undefined ? undefined : Number(String(x).replace(/^\$/, ""))));
    if (!model || numbers[0] === undefined || numbers[1] === undefined || numbers.some((n) => n !== undefined && (!Number.isFinite(n) || n < 0))) {
      bad("usage: galahad price set <provider/model | provider/*> <$ per million tokens in> <$ per million out> [--cached <$ per million cached in>]");
    }
    await node.call("setPrice", { model, input: numbers[0], output: numbers[1], ...(numbers[2] !== undefined ? { cached: numbers[2] } : {}) });
  } else if (sub === "rm" || sub === "remove") {
    if (!rest[0]) bad("usage: galahad price rm <provider/model>");
    await node.call("removePrice", { model: rest[0] });
  } else if (sub) bad("usage: galahad price | price set <provider/model> <in> <out> [--cached x] | price rm <provider/model>");
  const [{ prices }, { roster }] = await Promise.all([node.call<{ prices: Record<string, Price> }>("prices"), node.call<{ roster: Record<string, { models: string[] }> }>("roster")]);
  const hired = [...new Set(Object.values(roster).flatMap((r) => r.models))];
  const rows = [...new Set([...Object.keys(prices), ...hired])].sort();
  console.log(dim("US dollars per million tokens: yours to state (galahad price set <provider/model> <in> <out>). Tokens are always counted; money only where a price is."));
  for (const model of rows) {
    const own = prices[model];
    const slash = model.indexOf("/");
    const provider = slash > 0 ? prices[`${model.slice(0, slash)}/*`] : undefined;
    const price = own ?? provider;
    console.log(
      price
        ? `  ${model.padEnd(44)} ${perMillion(price.input).padStart(8)} in  ${perMillion(price.output).padStart(8)} out${price.cached !== undefined ? `  ${perMillion(price.cached).padStart(8)} cached` : ""}${own ? "" : dim(`  (its provider's: ${model.slice(0, slash)}/*)`)}`
        : `  ${model.padEnd(44)} ${dim("no price: its tokens are counted, its money isn't")}`,
    );
  }
  if (!rows.length) console.log(dim("  no prices yet"));
  return 0;
}

/** `galahad usage [--days 30]`: this node's own count of its model calls. */
export async function usageCommand(node: NodeClient, flags: Readonly<Record<string, unknown>>): Promise<number> {
  const daysRaw = str(flags, "days");
  const days = daysRaw === undefined ? 30 : Number(daysRaw);
  if (!Number.isInteger(days) || days < 1 || days > 366) bad("--days must be a whole number from 1 to 366");
  const view = await node.call<UsageView>("usage", { days });
  if (!view.rows.length) {
    console.log(`No model calls counted on ${view.node} since ${view.since}.`);
    return 0;
  }
  const lines = (rows: typeof view.rows): UsageLine[] => rows.map(({ day: _day, who: _who, ...line }) => line);
  console.log(`${bold(`Model calls on ${view.node}`)} ${dim(`since ${view.since} (UTC) · tokens as the providers reported them · money at your prices`)}`);
  console.log(`  ${spendLabel(mergeSpend(lines(view.rows)), view.prices)}`);
  const group = (title: string, key: (r: (typeof view.rows)[number]) => string): void => {
    console.log(`\n${bold(title)}`);
    const keys = [...new Set(view.rows.map(key))];
    const totals = keys.map((k) => ({ k, lines: mergeSpend(lines(view.rows.filter((r) => key(r) === k))) })).sort((a, b) => spendTotal(b.lines).tokens - spendTotal(a.lines).tokens);
    for (const { k, lines: ls } of totals) {
      const t = spendTotal(ls);
      const cost = costOf(ls, view.prices);
      const money = cost.complete ? usdLabel(cost.usd) : cost.unpriced.length ? dim("no price") : `≥ ${usdLabel(cost.usd)}`;
      console.log(`  ${k.padEnd(44)} ${String(t.calls).padStart(6)} calls  ${tokensLabel(t.input).padStart(8)} in  ${tokensLabel(t.output).padStart(8)} out  ${money}${t.unknown ? dim(`  (${t.unknown} unreported)`) : ""}`);
    }
  };
  group("By model", (r) => r.model);
  group("By role", (r) => r.role);
  group("By who asked", (r) => r.who);
  group("By day", (r) => r.day);
  return 0;
}
