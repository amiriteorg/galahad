import { z } from "zod";
import {
  TEAM_GALAHAD, TEAM_LIMITS, TeamControlInput, TeamRoomId, type TeamSayInput, TeammateId,
  type Teammate, type TeammateInput, type TeamRecruitInput, type TeamRoom, type TeamRoomInput, type TeamPostInput, type TeamWorkspace,
  type TeamMessage, type TeamTask, type TeamTaskInput, type TeamSnapshot, type TeamRoomView, type TeamOverview,
} from "../../core/src/team.ts";
import { TeamStore, TeamError, teamInput, teamOutput, teamText, type TeamJob, type TeamSelection } from "./team-store.ts";

export { TeamError } from "./team-store.ts";

export interface TeamRunContext {
  signal: AbortSignal;
  chainId: string;
  /** The sender is this callback's teammate, never a field supplied by a model. */
  send(to: { room: string } | { teammate: string }, text: string): TeamMessage;
  /** Replaces only this teammate's private working notes. */
  remember(text: string): Teammate;
  /** Delegation stays in the current room and in the current causal budget. */
  delegate(task: Omit<TeamTaskInput, "room">): TeamTask;
  /** A new worker, made by this one (never a field a model supplies): it joins this room unless the room is a
   * direct conversation, and what it then does here spends this same causal budget. */
  recruit(worker: TeamRecruitInput): Teammate;
  emit(progress: string): void;
}

export interface TeamServiceOptions {
  store: TeamStore;
  respond(teammate: Teammate, room: TeamRoom, history: TeamMessage[], context: TeamRunContext): Promise<string | { text: string }>;
  executeTask(teammate: Teammate, task: TeamTask, context: TeamRunContext): Promise<{ verified: boolean; output: string; error?: string }>;
  concurrency?: number;
  timeoutMs?: number;
  /** Shutdown waits this long for callbacks to settle, then leaves their persisted state interrupted. */
  shutdownGraceMs?: number;
  onChange?(): void;
  /** A worker Galahad made for himself (in your conversation, or one of his workers in its room): for the record. */
  onRecruit?(made: Teammate): void;
}

interface Active {
  job: TeamJob;
  controller: AbortController;
  done: Promise<void>;
  timer: ReturnType<typeof setTimeout> | null;
}

const Destination = z.union([z.strictObject({ room: TeamRoomId }), z.strictObject({ teammate: TeammateId })]);
const selected = (job: TeamJob, select: TeamSelection): boolean => (!select.room || job.room === select.room) && (!select.teammate || job.teammate === select.teammate) && (!select.task || job.id === select.task);

/** A single controller schedules named teammates. The injected runner owns models and VM transport;
 * this service owns identity, delivery, persistence, budgets, dependencies and exclusive access. */
export class TeamService {
  private readonly active = new Map<string, Active>();
  /** Workers on their way out: between the pause and the record's retirement nothing may bring one back. */
  private readonly removing = new Set<string>();
  private readonly concurrency: number;
  private readonly timeoutMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private scheduled = false;
  private stopping: Promise<void> | null = null;

  constructor(private readonly options: TeamServiceOptions) {
    this.concurrency = Math.max(1, Math.min(16, Math.trunc(options.concurrency ?? 4)));
    this.timeoutMs = Math.max(1, Math.min(2 * 60 * 60_000, options.timeoutMs ?? 30 * 60_000));
  }

  get store(): TeamStore { return this.options.store; }
  /** Who is at work now: a fresh projection, with no database or output payloads. */
  activeWork(): readonly { teammate: string; room: string; kind: "delivery" | "task" }[] {
    return [...this.active.values()].map(({ job }) => ({ teammate: job.teammate, room: job.room, kind: job.kind }));
  }
  snapshot(): TeamSnapshot { return this.store.snapshot(); }
  room(id: string): TeamRoomView { return this.store.roomView(id); }
  messages(room: string, limit?: number): TeamMessage[] { return this.store.messages(room, limit); }
  saveTeammate(input: TeammateInput): Teammate {
    this.accepting();
    this.steady((input as { id?: unknown } | null)?.id);
    const saved = this.store.saveTeammate(input);
    if (!saved.enabled) this.cancel({ teammate: saved.id }, "interrupted", "Paused by you.");
    this.changed(); this.kick();
    return saved;
  }
  setWorkspace(id: string, binding: TeamWorkspace | null): Teammate {
    this.accepting();
    this.steady(id);
    if (this.active.has(id) && this.store.requireTeammate(id).workspace) throw new TeamError(409, "Stop this squire's work before changing its workspace.");
    const saved = this.store.setWorkspace(id, binding);
    this.changed();
    return saved;
  }
  remember(id: string, text: string): Teammate { this.accepting(); const saved = this.store.remember(id, text); this.changed(); return saved; }
  planWorkspace(id: string, node: string): Teammate {
    this.accepting();
    this.steady(id);
    if (this.active.has(id) && this.store.requireTeammate(id).workspace) throw new TeamError(409, "Stop this squire's work before provisioning its workspace.");
    const saved = this.store.planWorkspace(id, node); this.changed(); return saved;
  }
  saveRoom(input: TeamRoomInput): TeamRoom {
    this.accepting();
    const saved = this.store.saveRoom(input);
    for (const work of this.active.values()) if (work.job.room === saved.id && !saved.members.includes(work.job.teammate)) this.cancel({ teammate: work.job.teammate, room: saved.id }, "stopped", "Removed from this room.");
    this.changed(); this.kick();
    return saved;
  }
  direct(teammate: string): TeamRoom { this.accepting(); const room = this.store.direct(teammate); this.changed(); return room; }
  post(input: TeamPostInput): TeamMessage { this.accepting(); const message = this.store.post(input); this.changed(); this.kick(); return message; }
  /** His workers as Galahad himself reads them. */
  overview(room?: string): TeamOverview { return this.store.overview(room); }
  /** Galahad himself, from your conversation with him: a new worker of his own. */
  recruit(input: TeamRecruitInput): Teammate {
    this.accepting();
    const made = this.store.recruit(input, TEAM_GALAHAD);
    this.recruited(made);
    return made;
  }
  /** Galahad himself, from your conversation with him: his words to one worker (where you talk with it too) or to a room. */
  say(input: TeamSayInput): TeamMessage {
    this.accepting();
    const message = this.store.say(input);
    this.changed(); this.kick();
    return message;
  }
  createTask(input: TeamTaskInput): TeamTask { this.accepting(); const task = this.store.createTask(input); this.changed(); this.kick(); return task; }

  start(): void {
    if (this.running) return;
    if (this.stopping) throw new TeamError(409, "This team controller has stopped.");
    this.store.recover();
    this.running = true;
    // A daily budget can become available while nobody has the page open.
    this.timer = setInterval(() => { if (this.active.size) this.changed(); this.kick(); }, 15_000);
    this.kick();
  }

  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopping = this.shutdown();
    return this.stopping;
  }
  private async shutdown(): Promise<void> {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const active of this.active.values()) this.store.pauseRoom(active.job.room, true);
    this.cancel({}, "interrupted", "The node stopped during this work. Review it before resuming.");
    // A runner that ignores cancellation keeps its teammate's lock until it really ends.
    // Shutdown itself is bounded, and the persisted interrupted job will never silently replay.
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([Promise.all([...this.active.values()].map((a) => a.done)), new Promise<void>((resolve) => { timer = setTimeout(resolve, this.options.shutdownGraceMs ?? 10_000); })]);
    if (timer) clearTimeout(timer);
  }

  control(raw: TeamControlInput): TeamSnapshot {
    this.accepting();
    const input = teamInput(TeamControlInput, raw);
    const select: TeamSelection = { ...(input.room ? { room: input.room } : {}), ...(input.teammate ? { teammate: input.teammate } : {}), ...(input.task ? { task: input.task } : {}) };
    if (input.room) this.store.requireRoom(input.room);
    if (input.teammate) { this.store.requireTeammate(input.teammate); this.steady(input.teammate); }
    if (input.task && !this.store.task(input.task)) throw new TeamError(404, "No such team task.");
    if (input.action === "resume") {
      // A callback may still be winding down its VM command. It cannot be overlapped by a retry.
      if ([...this.active.values()].some((a) => selected(a.job, select))) throw new TeamError(409, "This work is still stopping. Wait for its current command to finish.");
      if (input.room) this.store.pauseRoom(input.room, false);
      if (input.teammate) this.store.enable(input.teammate, true);
      this.store.resume(select);
    } else {
      if (input.room) this.store.pauseRoom(input.room, true);
      if (input.teammate) this.store.enable(input.teammate, false);
      const state = input.action === "pause" ? "interrupted" : "stopped";
      this.cancel(select, state, input.action === "pause" ? "Paused by you." : "Stopped by you.");
      if (input.action === "stop" || input.task) this.store.stopQueued(select);
    }
    this.changed(); this.kick();
    return this.snapshot();
  }

  /**
   * Take a worker out for good, which is yours alone to ask. It is paused and its running work stopped first; if
   * that work is still winding down when the wait is over, the removal is refused and the worker stays, paused.
   * A workspace goes only through `release`, which the caller gives to destroy whatever VM the worker has (bound
   * here or not): with none given, a bound worker's removal is refused before anything is touched, and if the
   * release fails the worker stays too, paused and still bound. Only then is its record retired
   * (TeamStore.remove), so neither running work nor a workspace is ever left behind by it.
   */
  async remove(id: string, options: { release?(member: Teammate): Promise<void>; waitMs?: number } = {}): Promise<Teammate> {
    this.accepting();
    const member = this.store.requireTeammate(id);
    this.steady(id);
    if (member.workspace && !options.release) throw new TeamError(409, `${member.name} has a persistent workspace. Removing ${member.name} destroys it and everything in it: say so, or pause ${member.name} instead.`);
    this.removing.add(id);
    try {
      this.store.enable(id, false);
      this.cancel({ teammate: id }, "stopped", "Stopped to remove its squire.");
      const winding = this.active.get(id);
      if (winding) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([winding.done, new Promise<void>((resolve) => { timer = setTimeout(resolve, options.waitMs ?? 10_000); })]);
        if (timer) clearTimeout(timer);
        this.accepting();
      }
      // A callback may still be winding down its VM command: its teammate's record and workspace must outlast it.
      if (this.active.has(id)) throw new TeamError(409, "This squire's work is still stopping. It is paused now: remove it once its current command has finished.");
      const bound = this.store.requireTeammate(id);
      if (options.release) await options.release(bound);
      else if (bound.workspace) throw new TeamError(409, "This squire has a workspace and nothing was given to release it.");
      // What was released is gone: the record follows it at once, even if the controller has begun to stop meanwhile.
      if (bound.workspace) this.store.setWorkspace(id, null);
      return this.store.remove(id);
    } finally {
      this.removing.delete(id);
      if (!this.stopping) { this.changed(); this.kick(); }
    }
  }

  /** Useful to tests and shutdown callers: waits for currently runnable work, not blocked dependencies. */
  async settled(): Promise<void> {
    for (;;) {
      await Promise.resolve();
      this.pump();
      const active = [...this.active.values()].map((a) => a.done);
      if (!active.length) return;
      await Promise.all(active);
    }
  }

  private accepting(): void { if (this.stopping) throw new TeamError(409, "This team controller has stopped."); }
  private steady(id: unknown): void { if (typeof id === "string" && this.removing.has(id)) throw new TeamError(409, "This squire is being removed."); }
  private changed(): void { try { this.options.onChange?.(); } catch { /* an observer cannot stop the scheduler */ } }
  private recruited(made: Teammate): void {
    try { this.options.onRecruit?.(made); } catch { /* nor undo what was made */ }
    this.changed(); this.kick();
  }
  private kick(): void {
    if (!this.running || this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => { this.scheduled = false; this.pump(); });
  }
  private pump(): void {
    if (!this.running) return;
    for (const job of this.store.queued()) {
      if (this.active.size >= this.concurrency) break;
      if (this.active.has(job.teammate) || !this.store.claim(job.id)) continue;
      this.launch(job);
    }
  }
  private cancel(select: TeamSelection, status: "interrupted" | "stopped", error: string): void {
    for (const active of this.active.values()) {
      if (!selected(active.job, select)) continue;
      this.store.finish(active.job.id, status, error);
      if (active.timer) clearTimeout(active.timer);
      active.timer = null;
      active.controller.abort(new Error(error));
    }
    this.changed();
  }
  private launch(job: TeamJob): void {
    const controller = new AbortController();
    const active: Active = { job, controller, done: Promise.resolve(), timer: null };
    this.active.set(job.teammate, active);
    active.timer = setTimeout(() => {
      if (!this.running) return;
      this.store.finish(job.id, "interrupted", "This work reached its time limit. Review it before resuming.");
      this.store.pauseRoom(job.room, true);
      controller.abort(new Error("Team work timed out"));
      this.changed();
    }, this.timeoutMs);
    active.done = Promise.resolve().then(() => this.run(job, controller.signal)).catch((error) => {
      if (this.running) this.store.finish(job.id, "failed", String((error as Error).message ?? error));
    }).finally(() => {
      if (active.timer) clearTimeout(active.timer);
      this.active.delete(job.teammate);
      if (this.running) { this.changed(); this.kick(); }
    });
    this.changed();
  }
  private async run(job: TeamJob, signal: AbortSignal): Promise<void> {
    let calls = 0;
    const current = () => {
      if (signal.aborted || this.store.job(job.id)?.status !== "running") throw new TeamError(409, "This squire's work has stopped.");
      const member = this.store.requireTeammate(job.teammate);
      const room = this.store.requireRoom(job.room);
      if (!member.enabled || room.paused || !room.members.includes(member.id)) throw new TeamError(403, "This squire may no longer act in this room.");
    };
    const budget = () => { current(); if (++calls > 64) throw new TeamError(429, "This turn reached its team action limit."); };
    const context: TeamRunContext = {
      signal,
      chainId: job.chainId,
      send: (raw, text) => {
        budget();
        const target = teamInput(Destination, raw);
        teamText(text);
        const room = "room" in target ? this.store.requireRoom(target.room) : this.store.direct(target.teammate, job.teammate);
        const message = this.store.post({ room: room.id, text }, { teammate: job.teammate, chainId: job.chainId });
        this.changed(); this.kick(); return message;
      },
      remember: (text) => { budget(); const saved = this.store.remember(job.teammate, text); this.changed(); return saved; },
      delegate: (task) => { budget(); const saved = this.store.createTask({ ...task, room: job.room }, { teammate: job.teammate, chainId: job.chainId }); this.changed(); this.kick(); return saved; },
      recruit: (worker) => { budget(); const made = this.store.recruit(worker, job.teammate, job.room); this.recruited(made); return made; },
      emit: (progress) => { current(); this.store.progress(job.id, progress); this.changed(); },
    };
    current();
    const teammate = this.store.requireTeammate(job.teammate);
    const room = this.store.requireRoom(job.room);
    if (job.kind === "delivery") {
      const response = await this.options.respond(teammate, room, this.store.messages(room.id), context);
      current();
      const text = teamOutput(typeof response === "string" ? response : response.text, TEAM_LIMITS.message).trim();
      if (text) this.store.post({ room: room.id, text }, { teammate: teammate.id, chainId: job.chainId, output: true });
      this.store.finish(job.id, "done");
    } else {
      const task = this.store.task(job.id)!;
      const outcome = await this.options.executeTask(teammate, task, context);
      current();
      this.store.finish(job.id, outcome.verified ? "done" : "failed", outcome.error ?? (outcome.verified ? null : "The work was not independently verified."), outcome);
    }
  }
}
