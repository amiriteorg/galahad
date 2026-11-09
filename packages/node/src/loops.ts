import type { Database } from "bun:sqlite";
import {
  dueRun,
  LoopTask,
  type LoopRunView,
  type NodeIdentity,
  nextRun,
  parseSchedule,
  redact,
  type Schedule,
  ScheduleError,
} from "@galahad/core";
import type { MindStore } from "@galahad/mind";

/*
 * Loops: work Galahad does on a schedule. A loop lives in the mind (so every
 * device sees it and its history) and names exactly one node that runs it, so it
 * never runs twice. That node's runner wakes every few seconds, finds loops that
 * are due, and runs each one at most once per slot:
 *
 *   - a run is marked in local storage before it starts and recorded in the mind
 *     (`loop.ran`) when it ends; a crash in between is recorded as interrupted on
 *     the next start, never rerun;
 *   - a node that was away runs a missed loop once, not once per missed slot;
 *   - a run that outlives its deadline is stopped.
 */

export interface LoopRecord {
  name: string;
  scheduleText: string;
  schedule: Schedule | null;
  tz: string;
  on: string;
  enabled: boolean;
  task: LoopTask | null;
  problem: string | null;
  label: string | null;
  updatedHlc: string;
  updatedAt: number;
}

export const hlcMs = (hlc: string): number => Number(hlc.split(".")[0]);

interface StoredLoop {
  name: string;
  schedule: string;
  tz?: string;
  on: string;
  enabled: boolean;
  task: unknown;
  label?: string;
}

export function loopRecords(store: MindStore): LoopRecord[] {
  return store.lwwPrefix<StoredLoop>("loop:").map((entry) => {
    const stored = entry.value!;
    const problems: string[] = [];
    let schedule: Schedule | null = null;
    try {
      schedule = parseSchedule(stored.schedule);
    } catch (error) {
      problems.push(`schedule: ${(error as Error).message}`);
    }
    const task = LoopTask.safeParse(stored.task);
    if (!task.success) problems.push("this node doesn't understand the task (written by a newer version?)");
    return {
      name: stored.name,
      scheduleText: stored.schedule,
      schedule,
      tz: stored.tz ?? "UTC",
      on: stored.on,
      enabled: stored.enabled,
      task: task.success ? task.data : null,
      problem: problems.length ? problems.join("; ") : null,
      label: stored.label ?? null,
      updatedHlc: entry.hlc,
      updatedAt: hlcMs(entry.hlc),
    };
  });
}

export function runView(event: {
  device: string;
  body: { loop: string; run: string; slot: number | null; status: LoopRunView["status"]; started: number; finished: number; summary: string };
}): LoopRunView {
  const { loop, run, slot, status, started, finished, summary } = event.body;
  return { loop, run, slot, status, started, finished, summary, node: event.device };
}

export interface RunContext {
  run: string;
  slot: number | null;
  signal: AbortSignal;
}

export interface RunResult {
  status: "ok" | "attention" | "failed";
  summary: string;
}

export type RunnableLoop = LoopRecord & { task: LoopTask; schedule: Schedule };

export interface LoopRunnerOptions {
  store: MindStore;
  identity: NodeIdentity;
  local: Database;
  log: (message: string) => void;
  execute: (loop: RunnableLoop, ctx: RunContext) => Promise<RunResult>;
  now?: () => number;
  /** Runs at once on this node; a due loop waits for a free place. */
  maxConcurrent?: number;
  /** No run lasts longer than this. */
  deadlineMs?: number;
}

export class LoopError extends Error {}

export class LoopRunner {
  private readonly now: () => number;
  private readonly active = new Map<string, { run: string; controller: AbortController; done: Promise<void> }>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly o: LoopRunnerOptions) {
    this.now = o.now ?? Date.now;
    o.local.exec("CREATE TABLE IF NOT EXISTS loop_runs (loop TEXT NOT NULL, run TEXT NOT NULL, slot INTEGER, started INTEGER NOT NULL, PRIMARY KEY (loop, run))");
  }

  /** Record runs a previous process left unfinished, then wake every `intervalMs`. */
  start(intervalMs = 15_000): void {
    const leftovers = this.o.local
      .query<{ loop: string; run: string; slot: number | null; started: number }, []>("SELECT loop, run, slot, started FROM loop_runs")
      .all();
    for (const row of leftovers) {
      this.record(row.loop, row.run, row.slot, row.started, { status: "interrupted", summary: "The node stopped during this run; it was not rerun." });
    }
    this.tick();
    this.timer = setInterval(() => this.tick(), intervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const { controller } of this.active.values()) controller.abort();
    await Promise.all([...this.active.values()].map((a) => a.done));
  }

  /** Loops this node runs. */
  mine(): LoopRecord[] {
    return loopRecords(this.o.store).filter((loop) => loop.on === this.o.identity.id);
  }

  isRunning(name: string): boolean {
    return this.active.has(name);
  }

  /** The slot a loop would run for now, if any. */
  due(loop: LoopRecord, now = this.now()): number | null {
    if (!loop.enabled || !loop.schedule || !loop.task) return null;
    const last = this.o.store.lastSlot(loop.name, this.o.identity.id);
    // A loop never catches up on slots from before it was (re)defined.
    const since = Math.max(last ?? Number.NEGATIVE_INFINITY, loop.updatedAt);
    return dueRun(loop.schedule, since, now, loop.tz);
  }

  tick(): void {
    const now = this.now();
    for (const loop of this.mine()) {
      if (this.active.has(loop.name)) continue;
      if (this.active.size >= (this.o.maxConcurrent ?? 2)) return;
      const slot = this.due(loop, now);
      if (slot !== null) this.launch(loop as RunnableLoop, slot);
    }
  }

  /** Run a loop now, by hand (it doesn't count as its scheduled run). */
  runNow(name: string): { run: string } {
    const loop = this.mine().find((l) => l.name === name);
    if (!loop) throw new LoopError(`loop ${name} doesn't run on this node`);
    if (!loop.task || !loop.schedule) throw new LoopError(`loop ${name} can't run here: ${loop.problem}`);
    if (this.active.has(name)) throw new LoopError(`loop ${name} is already running`);
    return { run: this.launch(loop as RunnableLoop, null) };
  }

  /** Resolves when a loop's current run (if any) has finished: for tests and graceful stops. */
  async settled(name?: string): Promise<void> {
    const runs = name ? [this.active.get(name)].filter((a) => a !== undefined) : [...this.active.values()];
    await Promise.all(runs.map((a) => a.done));
  }

  private launch(loop: RunnableLoop, slot: number | null): string {
    const started = this.now();
    const run = slot === null ? `m${started.toString(36)}` : `s${slot.toString(36)}`;
    this.o.local.query("INSERT OR IGNORE INTO loop_runs (loop, run, slot, started) VALUES (?, ?, ?, ?)").run(loop.name, run, slot, started);
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), this.o.deadlineMs ?? 2 * 60 * 60_000);
    const done = (async () => {
      let result: RunResult;
      try {
        result = await this.o.execute(loop, { run, slot, signal: controller.signal });
        if (controller.signal.aborted && result.status === "ok") result = { status: "attention", summary: `Stopped: ${result.summary}` };
      } catch (error) {
        result = { status: "failed", summary: controller.signal.aborted ? "Stopped at its deadline." : String((error as Error).message ?? error) };
      } finally {
        clearTimeout(deadline);
      }
      this.record(loop.name, run, slot, started, result);
      this.active.delete(loop.name);
    })();
    this.active.set(loop.name, { run, controller, done });
    return run;
  }

  private record(loop: string, run: string, slot: number | null, started: number, result: { status: RunResult["status"] | "interrupted"; summary: string }): void {
    try {
      this.o.store.emit(this.o.identity, "loop.ran", {
        loop,
        run,
        slot,
        status: result.status,
        started,
        finished: Math.max(started, this.now()),
        summary: redact(result.summary).slice(0, 2000),
      });
    } catch (error) {
      this.o.log(`loop ${loop}: run not recorded: ${(error as Error).message}`);
    }
    this.o.local.query("DELETE FROM loop_runs WHERE loop = ? AND run = ?").run(loop, run);
  }
}

/** Check a schedule and zone the way a runner will read them; returns the next run. */
export function checkSchedule(text: string, tz: string, now: number): number {
  let schedule: Schedule;
  try {
    schedule = parseSchedule(text);
  } catch (error) {
    throw new LoopError(error instanceof ScheduleError ? error.message : "bad schedule");
  }
  const next = nextRun(schedule, now, tz);
  if (next === null) throw new LoopError("that schedule never runs");
  return next;
}
