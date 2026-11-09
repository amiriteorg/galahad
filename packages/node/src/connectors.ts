import type { Database } from "bun:sqlite";
import {
  type ActionView,
  type ArgValue,
  buildRequest,
  ConnectorArgs,
  ConnectorError,
  type ConnectorManifest,
  decide,
  findSecrets,
  type NodeIdentity,
  randomId,
  redact,
} from "@galahad/core";
import { type ConnectorResult, excerpt, installedConnector, keyState, sendConnectorRequest } from "@galahad/brain";
import type { MindStore, Vault } from "@galahad/mind";
import type { LedgerEntryInput } from "@galahad/sandbox";

/*
 * Connector calls, through the oath gate:
 *
 *   read, create, modify   run now, ledgered
 *   outward, delete        you asking = the approval: run now, ledgered as approved
 *                          an agent asking (arm, loop, quest): an action request in your
 *                          inbox; nothing is sent until you approve it
 *
 * Approved actions leave through an outbox. The node that filed the request is the
 * only one that sends it, it marks the send in local storage before the request
 * goes out, and writes the receipt to the mind afterwards. A crash in between is
 * reported as "outcome unknown", never retried: an approval sends at most once.
 */

export type Caller = { kind: "owner"; device: string } | { kind: "agent"; by: string; quest?: string };

export type CallOutcome =
  | { status: "done"; class: string; target: string; result: ConnectorResult }
  | { status: "asked"; action: string; class: string; target: string; expires: number };

export class ConnectorCallError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface ConnectorServiceOptions {
  store: MindStore;
  vault: Vault;
  identity: NodeIdentity;
  local: Database;
  ledger: (entry: LedgerEntryInput) => void;
  log: (message: string) => void;
  fetch?: typeof fetch;
  now?: () => number;
}

/** How long an action waits for you. No answer means no. */
export const ACTION_TTL_MS = 24 * 60 * 60_000;

export class ConnectorService {
  private readonly now: () => number;
  private draining: Promise<void> | null = null;

  constructor(private readonly o: ConnectorServiceOptions) {
    this.now = o.now ?? Date.now;
    o.local.exec("CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY, state TEXT NOT NULL, at INTEGER NOT NULL)");
  }

  private manifest(id: string): ConnectorManifest {
    const manifest = installedConnector(this.o.store, id);
    if (!manifest) throw new ConnectorCallError(404, `no connector "${id}" is installed (galahad connector add ${id})`);
    return manifest;
  }

  async call(input: { connector: string; tool: string; args?: Record<string, ArgValue>; why?: string }, caller: Caller): Promise<CallOutcome> {
    const manifest = this.manifest(input.connector);
    const args = ConnectorArgs.parse(input.args ?? {});
    // Arguments leave this machine (and approvals replicate in plaintext): no keys in them.
    for (const value of Object.values(args)) {
      if (typeof value === "string" && findSecrets(value).length) {
        throw new ConnectorCallError(422, "an argument looks like a credential; connectors take keys from the vault, never from arguments");
      }
    }
    let request: ReturnType<typeof buildRequest>;
    try {
      request = buildRequest(manifest, input.tool, args);
    } catch (error) {
      throw new ConnectorCallError(400, (error as Error).message);
    }
    const resource = `connector.${manifest.id}`;
    const quest = caller.kind === "agent" ? caller.quest : undefined;
    const decision = decide({ class: request.class, resource, target: request.target, ...(quest ? { quest } : {}) });
    if (decision.verdict === "deny") throw new ConnectorCallError(403, decision.reason);

    if (decision.verdict === "ask" && caller.kind === "agent") {
      const id = `a_${randomId(16)}`;
      const expires = this.now() + ACTION_TTL_MS;
      this.o.store.emit(this.o.identity, "action.requested", {
        id,
        connector: manifest.id,
        tool: input.tool,
        args,
        class: request.class,
        target: request.target,
        by: caller.by,
        ...(input.why ? { why: redact(input.why).slice(0, 500) } : {}),
        expires,
      });
      this.o.ledger({ class: request.class, resource, target: request.target, verdict: "ask", reason: decision.reason, quest, detail: `action ${id}, asked by ${caller.by}` });
      return { status: "asked", action: id, class: request.class, target: request.target, expires };
    }

    const approved = decision.verdict === "ask"; // the owner asked: that is the approval
    const result = await this.send(manifest, request);
    this.o.ledger({
      class: request.class,
      resource,
      target: request.target,
      verdict: approved ? "approved" : "allow",
      reason: approved ? "you asked for it" : decision.reason,
      quest,
      detail: `${caller.kind === "owner" ? "by you" : `by ${caller.by}`} · ${excerpt(result, 300)}`.slice(0, 2000),
    });
    return { status: "done", class: request.class, target: request.target, result };
  }

  private async send(manifest: ConnectorManifest, request: ReturnType<typeof buildRequest>): Promise<ConnectorResult> {
    try {
      return await sendConnectorRequest({ vault: this.o.vault, fetch: this.o.fetch }, manifest, request);
    } catch (error) {
      if (error instanceof ConnectorError) {
        // Missing key: ask for it once, in the vault, never in chat.
        if (manifest.auth && keyState(this.o.vault, manifest) === "missing" && !this.o.vault.requests().some((r) => r.name === manifest.auth!.secret)) {
          try {
            this.o.vault.request(manifest.auth.secret, `The ${manifest.label} connector needs its key (for ${manifest.origin}).`, manifest.id);
          } catch {
            /* a request is a courtesy, not a requirement */
          }
        }
        throw new ConnectorCallError(424, error.message);
      }
      const message = (error as Error).name === "TimeoutError" ? "timed out" : redact(String((error as Error).message ?? error));
      throw new ConnectorCallError(502, `${manifest.label} unreachable: ${message}`);
    }
  }

  actions(limit = 100): ActionView[] {
    const now = this.now();
    return this.o.store
      .lwwPrefix<Record<string, unknown>>("action:")
      .map((entry) => {
        const body = entry.value as {
          id: string;
          connector: string;
          tool: string;
          args: Record<string, unknown>;
          class: string;
          target: string;
          by: string;
          why?: string;
          expires: number;
        };
        const decision = this.o.store.lww<{ verdict: "approved" | "denied"; via?: string }>(`action-decision:${body.id}`);
        const done = this.o.store.lww<{ ok: boolean; receipt: string }>(`action-done:${body.id}`)?.value ?? null;
        let state: ActionView["state"];
        if (done) state = done.ok ? "done" : "failed";
        else if (decision?.value) state = decision.value.verdict;
        else state = body.expires <= now ? "expired" : "waiting";
        return {
          id: body.id,
          connector: body.connector,
          tool: body.tool,
          args: body.args,
          class: body.class,
          target: body.target,
          by: body.by,
          why: body.why ?? null,
          node: entry.device,
          requestedAt: entry.hlc,
          expires: body.expires,
          state,
          decidedVia: decision?.value?.via ?? decision?.device ?? null,
          receipt: done?.receipt ?? null,
        };
      })
      .sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : -1))
      .slice(0, limit);
  }

  /** Your answer to an action request. `via` is the device you answered from. */
  decide(id: string, approve: boolean, via: string | null, note?: string): ActionView {
    const action = this.actions(10_000).find((a) => a.id === id);
    if (!action) throw new ConnectorCallError(404, "no such action");
    if (action.state === "expired") throw new ConnectorCallError(409, "that request expired unanswered (no answer means no)");
    if (action.state !== "waiting") throw new ConnectorCallError(409, `already ${action.state}`);
    this.o.store.emit(
      this.o.identity,
      "action.decided",
      { id, verdict: approve ? "approved" : "denied", ...(note ? { note: redact(note).slice(0, 500) } : {}) },
      { trust: "owner", ...(via ? { via } : {}) },
    );
    this.o.ledger({
      class: action.class as LedgerEntryInput["class"],
      resource: `connector.${action.connector}`,
      target: action.target,
      verdict: approve ? "approved" : "deny",
      reason: approve ? "you approved it" : "you declined",
      detail: `action ${id}`,
    });
    if (approve) void this.drain();
    return this.actions(10_000).find((a) => a.id === id)!;
  }

  /** Send every approved action this node filed that hasn't been sent. Safe to call any time. */
  drain(): Promise<void> {
    if (!this.draining) {
      this.draining = this.drainOnce().finally(() => {
        this.draining = null;
      });
    }
    return this.draining;
  }

  private async drainOnce(): Promise<void> {
    const mine = this.actions(10_000).filter((a) => a.node === this.o.identity.id && a.state === "approved");
    for (const action of mine) {
      const row = this.o.local.query<{ state: string }, [string]>("SELECT state FROM outbox WHERE id = ?").get(action.id);
      if (row) {
        // Marked before sending and never cleared: the node stopped mid-send. Don't guess, don't resend.
        if (row.state === "sending") this.receipt(action.id, false, undefined, "outcome unknown: this node stopped while sending it, so it was not retried");
        continue;
      }
      this.o.local.query("INSERT INTO outbox (id, state, at) VALUES (?, 'sending', ?)").run(action.id, this.now());
      let ok = false;
      let status: number | undefined;
      let receipt: string;
      try {
        const manifest = this.manifest(action.connector);
        const request = buildRequest(manifest, action.tool, ConnectorArgs.parse(action.args));
        if (request.target !== action.target) throw new ConnectorCallError(409, "the connector changed since you approved this; not sent");
        const result = await this.send(manifest, request);
        ok = result.ok;
        status = result.status;
        receipt = excerpt(result, 1500);
      } catch (error) {
        receipt = `not sent: ${(error as Error).message}`.slice(0, 2000);
      }
      this.o.local.query("UPDATE outbox SET state = 'sent' WHERE id = ?").run(action.id);
      this.receipt(action.id, ok, status, receipt);
      this.o.ledger({
        class: action.class as LedgerEntryInput["class"],
        resource: `connector.${action.connector}`,
        target: action.target,
        verdict: "approved",
        reason: ok ? "sent after your approval" : "failed after your approval",
        detail: `action ${action.id} · ${receipt}`.slice(0, 2000),
      });
    }
  }

  private receipt(id: string, ok: boolean, status: number | undefined, receipt: string): void {
    try {
      this.o.store.emit(this.o.identity, "action.done", { id, ok, ...(status !== undefined ? { status } : {}), receipt: redact(receipt).slice(0, 2000) });
    } catch (error) {
      this.o.log(`action ${id}: receipt not recorded: ${(error as Error).message}`);
    }
  }
}
