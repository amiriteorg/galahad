import { type ExecResult, type ExperimentRunInput, type ExperimentRunResult, redact, SandboxRequest, type SandboxView, summaryOf } from "@galahad/core";
import type { CreateInput } from "@galahad/sandbox";
import type { z } from "zod";
import type { WorldHub } from "./world-hub.ts";

/*
 * Galahad builds, tests and examines an experiment, as one job (experiment_run). Pure orchestration
 * over a sandbox host and the world (both injected, so a test runs the same code against stand-ins):
 *   building   the world gets the experiment at once (he walks to the workshop's bench) while a fresh
 *              sandbox spins up in the right image (the Lab for MuJoCo, JSBSim, RocketPy and custom
 *              work; Gazebo's for Gazebo), on the gateway network (models only, and the world); his
 *              script goes in, and its simulation's start fills in the bodies
 *   testing    the script runs (galahad_world streams it where it belongs), for at most `minutes`
 *   examining  once it ends, at the observatory; the run waits until it's examined
 * The sandbox is ephemeral and the run's own (its quest), destroyed afterwards whatever happened.
 * If the script never started its experiment, or stopped before ending it, the experiment fails with
 * why, and is examined like any other.
 */

export interface RunHost {
  create(input: CreateInput): Promise<SandboxView>;
  exec(id: string, cmd: string[], timeoutSec?: number): Promise<ExecResult>;
  destroy(id: string, opts: { quest?: string }): Promise<{ verdict: string; reason?: string }>;
}

export interface RunDeps {
  sandbox: RunHost;
  world: WorldHub;
  nodeName: string;
  log?: (message: string) => void;
}

export class RunError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** The script's place in the sandbox, and how it's put there (base64 in, so nothing in it is ever read by a shell). */
const SCRIPT = "/work/experiment.py";
const WRITE = "import base64,sys; open(sys.argv[1],'wb').write(base64.b64decode(sys.argv[2]))";
/** The ends of what a script printed, as the result keeps them. */
const TAIL = 2_000;
const tail = (text: string) => (text.length > TAIL ? `…${text.slice(-TAIL)}` : text);
/** The last line that says something (a traceback's last line is its error). */
const lastLine = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("galahad_world:"))
    .at(-1) ?? "";

export async function runExperiment(deps: RunDeps, input: z.infer<typeof ExperimentRunInput>, owner: { quest?: string }): Promise<ExperimentRunResult> {
  const { world } = deps;
  const minutes = input.minutes ?? 10;
  const started = Date.now();
  const draft = world.draft({ title: input.title, engine: input.engine, ...(input.extent ? { extent: input.extent } : {}), ...(input.site ? { site: input.site } : {}) }, { nodeName: deps.nodeName, sandbox: null, quest: owner.quest ?? null });
  world.keepCode(draft.id, "experiment.py", input.script);
  // Its sandbox belongs to the run (or to the arm that asked): ephemeral, cleaned up by the quest that made it.
  const quest = owner.quest ?? `experiment.${draft.id}`;
  const request = SandboxRequest.parse({
    network: "gateway",
    ...(input.engine === "gazebo" ? { gazebo: true } : { lab: true }),
    ttlMinutes: minutes + 10,
    quest,
  });
  let sandbox: SandboxView;
  try {
    sandbox = await deps.sandbox.create(request as CreateInput);
  } catch (error) {
    const why = (error as Error).message;
    world.abandon(draft.id, redact(`its sandbox couldn't start: ${why}`));
    await world.settled(draft.id);
    return result(deps, draft.id, null, null, Date.now() - started);
  }
  world.attach(draft.id, sandbox.id);
  let exec: ExecResult | null = null;
  try {
    const written = await deps.sandbox.exec(sandbox.id, ["python3", "-c", WRITE, SCRIPT, Buffer.from(input.script).toString("base64")], 60);
    if (written.exitCode !== 0) throw new RunError(500, `couldn't put the script in its sandbox: ${lastLine(written.stderr) || `exit ${written.exitCode}`}`);
    exec = await deps.sandbox.exec(sandbox.id, ["sh", "-c", `cd /work && exec python3 -u ${SCRIPT}`], minutes * 60);
  } catch (error) {
    world.abandon(draft.id, redact(`its script couldn't run: ${(error as Error).message}`));
  } finally {
    await deps.sandbox.destroy(sandbox.id, { quest }).catch((error) => deps.log?.(`experiment ${draft.id}: its sandbox ${sandbox.id} wasn't destroyed: ${(error as Error).message}`));
  }
  // What it left unfinished ends now, saying why.
  if (exec) {
    const now = world.current(draft.id);
    if (now && now.endedAt === null && !now.scene.length) {
      const said = lastLine(exec.stderr) || lastLine(exec.stdout);
      world.abandon(draft.id, redact(exec.exitCode === 0 ? "its script ended without starting an experiment (galahad_world.experiment, or one of its runners)" : `its script stopped before it started (exit ${exec.exitCode})${said ? `: ${said}` : ""}`));
    } else if (exec.exitCode === 137) for (const e of world.experimentsOf(sandbox.id)) if (e.endedAt === null) world.abandon(e.id, `it ran out of time (${minutes} min)`);
  }
  world.sandboxGone(sandbox.id);
  await world.settled(draft.id);
  return result(deps, draft.id, sandbox.id, exec, Date.now() - started);
}

function result(deps: RunDeps, id: string, sandbox: string | null, exec: ExecResult | null, durationMs: number): ExperimentRunResult {
  const saved = deps.world.store?.get(id) ?? null;
  return {
    experiment: saved ? summaryOf(saved) : null,
    examination: deps.world.examination(id),
    others: sandbox ? deps.world.experimentsOf(sandbox).map((e) => e.id).filter((x) => x !== id) : [],
    node: deps.nodeName,
    sandbox,
    exitCode: exec?.exitCode ?? null,
    durationMs,
    stdout: redact(tail(exec?.stdout ?? "")),
    stderr: redact(tail(exec?.stderr ?? "")),
  };
}
