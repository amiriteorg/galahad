import type { DeviceDigest, MindStore } from "./store.ts";

/** What a pull asks a peer for (the body of /link/sync, see SyncRequest in core). */
export interface PullRequest {
  have: Record<string, string>;
  sets?: Record<string, DeviceDigest>;
}

/** What a peer answers (see MindStore.eventsSince). */
export interface PullPage {
  events: unknown[];
  more: boolean;
  repair?: string[];
}

interface Walk {
  /** The newest of the device's events received so far on this walk. */
  cursor: string;
  /** Our frontier for the device when the walk began: past it, the walk is done. */
  until: string;
}

/*
 * Our side of pulling from one peer, without the transport: what to ask for next, and what
 * an answer means. The sync engine sends the requests; tests call eventsSince directly.
 *
 * A peer that finds a hole in our copy of a device's log (eventsSince) names the device in
 * `repair`. We then walk that log from its start, a page at a time, by asking as if we held
 * none of it (and without its digest, which would only flag it again), until we're past what
 * we held when the peer said so. Pages stay one page, whatever the log's size. A walk outlives
 * a pull, since a long log takes several, and each device is walked at most once per pull.
 */
export class PullState {
  private readonly walks = new Map<string, Walk>();
  private walked = new Set<string>();

  constructor(private readonly store: MindStore) {}

  /** A new pull starts (walks in progress go on). */
  begin(): void {
    this.walked = new Set();
  }

  /** Devices whose logs are being walked. */
  walking(): string[] {
    return [...this.walks.keys()];
  }

  /** The next request; `sets` only to a peer that compares them (an older one refuses the field). */
  request(withSets: boolean): PullRequest {
    const have = this.store.frontier();
    const sets = withSets ? this.store.deviceDigests() : undefined;
    for (const [device, walk] of this.walks) {
      if (walk.cursor) have[device] = walk.cursor;
      else delete have[device];
      if (sets) delete sets[device];
    }
    return { have, ...(sets ? { sets } : {}) };
  }

  /** Take one answer: ingest it, move the walks on. `more`: ask again. */
  receive(page: PullPage): { added: number; more: boolean } {
    const added = this.store.ingest(page.events).added;
    for (const [device, walk] of this.walks) {
      for (const event of page.events) {
        const e = event as { device?: unknown; hlc?: unknown } | null;
        if (e?.device === device && typeof e.hlc === "string" && e.hlc > walk.cursor) walk.cursor = e.hlc;
      }
      // Done once past where we were, or when the peer has nothing more at all.
      if (!page.more || (walk.until && walk.cursor >= walk.until)) this.walks.delete(device);
    }
    for (const device of page.repair ?? []) {
      if (typeof device !== "string" || this.walks.has(device) || this.walked.has(device)) continue;
      this.walked.add(device);
      this.walks.set(device, { cursor: "", until: this.store.frontier()[device] ?? "" });
    }
    return { added, more: page.more || this.walks.size > 0 };
  }
}
