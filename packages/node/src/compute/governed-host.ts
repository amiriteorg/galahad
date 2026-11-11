import { clampNeed, type Decision, type NodeCapacity, type SandboxView, VM_OVERHEAD } from "@galahad/core";
import { chooseIsolation, type CreateInput, SandboxError, SandboxHost, type SandboxHostOptions } from "@galahad/sandbox";
import { CapacityError, type Governor } from "./governor.ts";

/*
 * This node's sandbox host, behind its governor: every sandbox it creates, whoever
 * asks (a quest, an agent, an experiment, the owner, a calibration), first takes a
 * slot, and waits for one when the node is full. There is no other door: the node
 * holds only this host. A request for more than the ceiling gets the ceiling (a
 * sandbox's CPUs and memory are limits, not promises), and the ledger says so.
 */

export interface GovernedOptions {
  governor: Governor;
  /** What this node may carry, derived now. */
  capacity(): NodeCapacity;
  /** Whether this host runs microVMs (as the host itself was told). */
  microVMs: boolean;
}

export class GovernedSandboxHost extends SandboxHost {
  constructor(
    options: SandboxHostOptions,
    private readonly governed: GovernedOptions,
  ) {
    super(options);
  }

  /** `wait.signal`: the caller went away while it queued, so it leaves the queue (a sandbox being created is finished). */
  override async create(input: CreateInput, wait: { signal?: AbortSignal } = {}): Promise<SandboxView> {
    const capacity = this.governed.capacity();
    const vm = chooseIsolation(input.network, input.isolation, this.governed.microVMs) === "vm";
    // What the sandbox itself gets: never more than the ceiling, less a microVM's own overhead.
    const cpus = Math.max(0.25, Math.min(input.cpus, capacity.cores - (vm ? VM_OVERHEAD.cpus : 0)));
    const memoryGb = Math.max(0.25, Math.min(input.memoryGb, capacity.memoryGb - (vm ? VM_OVERHEAD.memoryGb : 0)));
    const need = clampNeed(capacity, { cpus, memoryGb }, vm);
    let ticket: Awaited<ReturnType<Governor["acquire"]>>;
    try {
      ticket = await this.governed.governor.acquire(need, { quest: input.quest ?? "adhoc" }, wait.signal);
    } catch (error) {
      if (error instanceof CapacityError) throw new SandboxError(error.message, error.status);
      throw error;
    }
    try {
      const view = await super.create({ ...input, cpus, memoryGb });
      this.governed.governor.bind(ticket, view.id);
      return view;
    } catch (error) {
      this.governed.governor.release(ticket);
      throw error;
    }
  }

  override async destroy(id: string, opts: { approvedBy?: string; quest?: string } = {}): Promise<Decision> {
    const decision = await super.destroy(id, opts);
    if (decision.verdict === "allow") this.governed.governor.release(id);
    return decision;
  }

  override async reap(): Promise<string[]> {
    const reaped = await super.reap();
    await this.reconcile();
    return reaped;
  }

  /** Bring the governor in line with Docker's own list (at start, after reaping, now and then). */
  async reconcile(): Promise<void> {
    // When Docker can't say, nothing changes: a list that failed is never read as "no sandboxes" (which would free every slot).
    const listed = await this.listed();
    if (listed) this.governed.governor.adopt(listed.map((s) => ({ id: s.id, cpus: s.cpus, memoryGb: s.memoryGb, isolation: s.isolation })));
  }
}
