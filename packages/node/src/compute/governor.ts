import { admit, type ComputeUsage, type ComputeUse, type HostLoad, type NodeCapacity, type QueuedWork, VM_OVERHEAD } from "@galahad/core";

/*
 * The governor: this node's slots. A sandbox is admitted only when it fits inside
 * the ceiling (the owner's, or the default half) and the machine itself has room
 * (he backs off while other work is using it); otherwise it waits its turn, first
 * come, first served. Nothing here runs anything: it only says when.
 *
 * What's in use is what the node's own sandboxes hold (Docker's list is the truth,
 * `adopt`), plus those being created. Model calls have their own, simpler count.
 */

export class CapacityError extends Error {
  constructor(
    message: string,
    readonly status = 503,
  ) {
    super(message);
  }
}

export interface GovernorOptions {
  /** What this node may carry, derived now (the mind's calibration and ceiling). */
  capacity(): NodeCapacity;
  /** The machine, live (null: not known, so only the ceiling counts). */
  host(): Omit<HostLoad, "oursRecently"> | null;
  now?(): number;
  /** The longest a sandbox waits for a slot before its caller is told why not (default 30 minutes). */
  maxWaitMs?: number;
  /** How often waiting work looks again while only the machine's load is in the way (default 10 s). */
  retryMs?: number;
  onChange?(): void;
}

export interface Ticket {
  id: string;
}

interface Held {
  cpus: number;
  memoryGb: number;
  /** Not yet a sandbox Docker lists: being created. */
  creating: boolean;
  /** When it became a sandbox (the governor's own count of such moments): a listing taken before that can't speak for it. */
  bound: number;
}

interface Waiting {
  need: { cpus: number; memoryGb: number };
  quest: string;
  since: number;
  why: string;
  admit(ticket: Ticket): void;
  refuse(error: Error): void;
  cleanup(): void;
}

interface ModelWaiting {
  go(): void;
  cleanup(): void;
}

/** His own load is remembered this long: the machine's load average takes about as long to forget it. */
const OURS_FOR_MS = 90_000;

export class Governor {
  private readonly held = new Map<string, Held>();
  private readonly waiting: Waiting[] = [];
  private readonly recent: { at: number; cores: number }[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private next = 0;
  /** Counts sandboxes coming to be: a listing of Docker is only as new as the mark taken before it was asked for. */
  private bindings = 0;
  private modelCalls = 0;
  private modelBackground = 0;
  private readonly modelWaiting: ModelWaiting[] = [];

  constructor(private readonly opts: GovernorOptions) {}

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  /** What his sandboxes hold now. */
  use(): ComputeUse {
    let cores = 0;
    let memoryGb = 0;
    for (const h of this.held.values()) {
      cores += h.cpus;
      memoryGb += h.memoryGb;
    }
    return { sandboxes: this.held.size, cores, memoryGb };
  }

  usage(): ComputeUsage {
    return { ...this.use(), queued: this.waiting.length, modelCalls: this.modelCalls, modelQueued: this.modelWaiting.length };
  }

  /** What waits for a slot, oldest first, and why. */
  queue(): QueuedWork[] {
    return this.waiting.map((w) => ({ quest: w.quest, cpus: w.need.cpus, memoryGb: w.need.memoryGb, since: w.since, why: w.why }));
  }

  /** The machine now, with the threads his own sandboxes held lately (their load isn't the host's). */
  hostNow(): HostLoad | null {
    const host = this.opts.host();
    if (!host) return null;
    const cutoff = this.now() - OURS_FOR_MS;
    while (this.recent.length && this.recent[0]!.at < cutoff) this.recent.shift();
    return { ...host, oursRecently: Math.max(this.use().cores, ...this.recent.map((r) => r.cores)) };
  }

  private remember(): void {
    this.recent.push({ at: this.now(), cores: this.use().cores });
    if (this.recent.length > 256) this.recent.splice(0, this.recent.length - 256);
  }

  private changed(): void {
    try {
      this.opts.onChange?.();
    } catch {
      /* a watcher never stops the governor */
    }
  }

  /**
   * A slot for one sandbox: resolves when it fits (at once, when it does), in turn. Rejects when the wait
   * outlasts `maxWaitMs`, the caller goes away, or this node takes no sandboxes at all.
   */
  acquire(need: { cpus: number; memoryGb: number }, meta: { quest: string }, signal?: AbortSignal): Promise<Ticket> {
    if (this.opts.capacity().sandboxes <= 0) return Promise.reject(new CapacityError("this node takes no sandboxes (its ceiling is none)", 409));
    if (signal?.aborted) return Promise.reject(new CapacityError("the caller gave up waiting for a slot", 499));
    return new Promise<Ticket>((resolve, reject) => {
      const since = this.now();
      let timeout: ReturnType<typeof setTimeout> | null = null;
      const leave = (): void => {
        const i = this.waiting.indexOf(entry);
        if (i >= 0) this.waiting.splice(i, 1);
      };
      const onAbort = (): void => {
        leave();
        entry.cleanup();
        reject(new CapacityError("the caller gave up waiting for a slot", 499));
        this.pump();
        this.changed();
      };
      const entry: Waiting = {
        need,
        quest: meta.quest,
        since,
        why: "",
        admit: (ticket) => {
          entry.cleanup();
          resolve(ticket);
        },
        refuse: (error) => {
          entry.cleanup();
          reject(error);
        },
        cleanup: () => {
          if (timeout) clearTimeout(timeout);
          signal?.removeEventListener("abort", onAbort);
        },
      };
      this.waiting.push(entry);
      this.pump();
      if (!this.waiting.includes(entry)) return;
      signal?.addEventListener("abort", onAbort, { once: true });
      timeout = setTimeout(() => {
        leave();
        entry.refuse(new CapacityError(`no slot came free in ${Math.round((this.opts.maxWaitMs ?? 30 * 60_000) / 60_000) || 1} minute(s): ${entry.why || "the node stayed full"}`));
        this.pump();
        this.changed();
      }, this.opts.maxWaitMs ?? 30 * 60_000);
      timeout.unref?.();
      this.changed();
    });
  }

  /** Admit from the front of the queue for as long as the next one fits. */
  private pump(): void {
    let admitted = false;
    while (this.waiting.length) {
      const head = this.waiting[0]!;
      const verdict = admit(this.opts.capacity(), this.use(), head.need, this.hostNow());
      if (!verdict.ok) {
        head.why = verdict.why;
        for (const behind of this.waiting.slice(1)) behind.why ||= "others are ahead of it in the queue";
        break;
      }
      this.waiting.shift();
      this.remember();
      const ticket: Ticket = { id: `t${++this.next}` };
      this.held.set(ticket.id, { ...head.need, creating: true, bound: 0 });
      this.remember();
      head.admit(ticket);
      admitted = true;
    }
    // While something waits, look again now and then: the machine's load eases without telling anyone.
    if (this.waiting.length && !this.timer) {
      this.timer = setInterval(() => this.pump(), this.opts.retryMs ?? 10_000);
      this.timer.unref?.();
    } else if (!this.waiting.length && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (admitted) this.changed();
  }

  /** The sandbox a ticket was for exists now: it's known by its id from here on. */
  bind(ticket: Ticket, sandbox: string): void {
    const held = this.held.get(ticket.id);
    if (!held) return;
    this.held.delete(ticket.id);
    this.held.set(sandbox, { ...held, creating: false, bound: ++this.bindings });
  }

  /** Take this before asking Docker for its list: `adopt` then knows which sandboxes the list is too old to speak for. */
  mark(): number {
    return this.bindings;
  }

  /** A ticket's sandbox never came to be, or a sandbox is gone: its share is free again. */
  release(what: Ticket | string): void {
    const key = typeof what === "string" ? what : what.id;
    if (!this.held.has(key)) return;
    this.remember();
    this.held.delete(key);
    this.remember();
    this.pump();
    this.changed();
  }

  /**
   * Docker's list of this node's sandboxes is the truth: ones from before a restart are counted, ones that
   * vanished (reaped, removed by hand) are freed. Sandboxes still being created are kept, and so is one
   * that came to be after the list was asked for (`asOf`: the mark taken before asking): a stale list
   * never frees the slot of a sandbox that exists.
   */
  adopt(sandboxes: readonly { id: string; cpus: number; memoryGb: number; isolation: "container" | "vm" }[], asOf = this.bindings): void {
    const before = JSON.stringify([...this.held.entries()]);
    this.remember();
    const listed = new Set(sandboxes.map((s) => s.id));
    for (const [key, h] of this.held) if (!h.creating && h.bound <= asOf && !listed.has(key)) this.held.delete(key);
    for (const s of sandboxes) {
      if (this.held.has(s.id)) continue;
      const vm = s.isolation === "vm";
      this.held.set(s.id, { cpus: s.cpus + (vm ? VM_OVERHEAD.cpus : 0), memoryGb: s.memoryGb + (vm ? VM_OVERHEAD.memoryGb : 0), creating: false, bound: 0 });
    }
    this.remember();
    this.pump();
    if (JSON.stringify([...this.held.entries()]) !== before) this.changed();
  }

  /**
   * One model call. A background call (a quest's, an agent's) waits while every slot is taken; yours
   * (`wait: false`) never waits and isn't counted against them. Returns how to leave (idempotent).
   */
  enterModel(opts: { wait: boolean }, signal?: AbortSignal): Promise<() => void> {
    const enter = (background: boolean): (() => void) => {
      this.modelCalls += 1;
      if (background) this.modelBackground += 1;
      this.changed();
      let left = false;
      return () => {
        if (left) return;
        left = true;
        this.modelCalls -= 1;
        if (background) this.modelBackground -= 1;
        this.pumpModels();
        this.changed();
      };
    };
    if (!opts.wait) return Promise.resolve(enter(false));
    if (signal?.aborted) return Promise.reject(new CapacityError("the caller gave up waiting for a model call", 499));
    if (!this.modelWaiting.length && this.modelBackground < Math.max(1, this.opts.capacity().modelCalls)) return Promise.resolve(enter(true));
    return new Promise((resolve, reject) => {
      const onAbort = (): void => {
        const i = this.modelWaiting.indexOf(entry);
        if (i >= 0) this.modelWaiting.splice(i, 1);
        reject(new CapacityError("the caller gave up waiting for a model call", 499));
        this.changed();
      };
      const entry: ModelWaiting = {
        go: () => {
          entry.cleanup();
          resolve(enter(true));
        },
        cleanup: () => signal?.removeEventListener("abort", onAbort),
      };
      this.modelWaiting.push(entry);
      signal?.addEventListener("abort", onAbort, { once: true });
      this.changed();
    });
  }

  private pumpModels(): void {
    while (this.modelWaiting.length && this.modelBackground < Math.max(1, this.opts.capacity().modelCalls)) this.modelWaiting.shift()!.go();
  }

  /** Stop looking again (the node is stopping); whoever still waits is told. */
  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const w of this.waiting.splice(0)) w.refuse(new CapacityError("the node is stopping"));
    for (const m of this.modelWaiting.splice(0)) m.cleanup();
  }
}
