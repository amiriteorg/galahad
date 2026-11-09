import type { GEvent, NodeIdentity, PeerStatus } from "@galahad/core";
import type { Device, MindStore } from "@galahad/mind";
import { type FetchLike, signedPost, type SyncPage } from "./client.ts";

/*
 * Gossip-style sync. Every node periodically pulls from every reachable peer
 * ("give me what's after my frontier") and pushes fresh local events right away.
 * Because ingest is idempotent and order-independent, retries, duplicates and
 * partitions are harmless: the minds converge whenever they can talk.
 */

export interface SyncOptions {
  intervalMs?: number;
  fetch?: FetchLike;
  log?: (message: string) => void;
}

export class SyncEngine {
  private readonly statuses = new Map<string, PeerStatus>();
  private readonly inFlight = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly store: MindStore,
    private readonly identity: NodeIdentity,
    private readonly opts: SyncOptions = {},
  ) {}

  peers(): Device[] {
    return this.store
      .devices()
      .filter((d) => d.kind === "node" && d.id !== this.identity.id && typeof d.profile?.endpoint === "string");
  }

  status(): PeerStatus[] {
    return this.peers().map(
      (peer) => this.statuses.get(peer.id) ?? { device: peer.id, online: false, lastSeen: null, rttMs: null, error: null },
    );
  }

  async pullFrom(peer: Device): Promise<number> {
    const started = performance.now();
    let added = 0;
    let presence: SyncPage["presence"] | null = null;
    try {
      for (let page = 0; page < 1000; page++) {
        const result = await signedPost<SyncPage>(
          this.identity,
          peer.profile!.endpoint!,
          "/link/sync",
          { have: this.store.frontier() },
          { fetch: this.opts.fetch, timeoutMs: 8000 },
        );
        presence = result.presence ?? presence;
        added += this.store.ingest(result.events).added;
        if (!result.more) break;
      }
      this.statuses.set(peer.id, {
        device: peer.id,
        online: true,
        lastSeen: Date.now(),
        rttMs: Math.round(performance.now() - started),
        error: null,
        presence,
      });
    } catch (error) {
      const previous = this.statuses.get(peer.id);
      this.statuses.set(peer.id, {
        device: peer.id,
        online: false,
        lastSeen: previous?.lastSeen ?? null,
        rttMs: null,
        error: String((error as Error).message ?? error).slice(0, 200),
      });
    }
    return added;
  }

  /** One round of pulls from every peer, in parallel. */
  async round(): Promise<number> {
    const results = await Promise.all(this.peers().map((peer) => this.pullFrom(peer)));
    return results.reduce((a, b) => a + b, 0);
  }

  /** Best-effort immediate fan-out of freshly written events. */
  push(events: GEvent[]): void {
    for (const peer of this.peers()) {
      if (this.statuses.get(peer.id)?.online === false) continue;
      signedPost(this.identity, peer.profile!.endpoint!, "/link/push", { events }, { fetch: this.opts.fetch, timeoutMs: 5000 }).catch(
        () => {},
      );
    }
  }

  start(): void {
    if (this.timer) return;
    // Each peer is pulled independently: a slow or unreachable peer never delays the others.
    const tick = () => {
      for (const peer of this.peers()) {
        if (this.inFlight.has(peer.id)) continue;
        this.inFlight.add(peer.id);
        this.pullFrom(peer)
          .then((added) => {
            if (added) this.opts.log?.(`sync: +${added} events from ${peer.name}`);
          })
          .finally(() => this.inFlight.delete(peer.id));
      }
    };
    tick();
    this.timer = setInterval(tick, this.opts.intervalMs ?? 5000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
