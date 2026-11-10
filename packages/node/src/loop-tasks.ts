import { type ChatStreamEvent, type NodeIdentity, redact, type RouteName, routes } from "@galahad/core";
import { chat, excerpt, installedConnectors, keyState, parseRef, resolveProvider, roster, sseData } from "@galahad/brain";
import type { SyncEngine } from "@galahad/link";
import type { MindStore, Vault } from "@galahad/mind";
import type { SandboxHost } from "@galahad/sandbox";
import type { ArmTokens } from "./arms.ts";
import { type Capabilities, isAlwaysOn } from "./capabilities.ts";
import type { ConnectorService } from "./connectors.ts";
import { assess, checklistPrompt, diskOf, type Finding, type HeartbeatSnapshot, readChecklistReply, reconcile } from "./heartbeat.ts";
import { loopRecords, type RunContext, type RunnableLoop, type RunResult } from "./loops.ts";
import { type NodeClient, runNodeQuest } from "./quest-cli.ts";
import { streamedError } from "./server.ts";

/*
 * What each kind of loop does when it runs. A loop acts as Galahad on his own,
 * never as you: a quest loop works through a short-lived arm token (its sandboxes
 * are its own and ephemeral, and it can't touch the vault, devices or the roster),
 * and a connector call from a loop is an agent's call, so anything outward asks you.
 */

export interface LoopTaskDeps {
  store: MindStore;
  vault: Vault;
  identity: NodeIdentity;
  nodeName: string;
  sync: SyncEngine;
  caps: () => Capabilities | null;
  sandbox: SandboxHost | null;
  connectors: ConnectorService;
  arms: ArmTokens;
  port: number;
  home: string;
  startedAt: number;
  log: (message: string) => void;
  now?: () => number;
  fetch?: typeof fetch;
}

/** A node API client on loopback, holding an arm token. */
export class LocalClient implements NodeClient {
  constructor(
    private readonly base: string,
    private readonly token: string,
  ) {}

  private async request(name: RouteName, input?: unknown): Promise<Response> {
    const route = routes[name];
    const response = await fetch(`${this.base}${route.path}`, {
      method: route.method,
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: route.method === "POST" ? JSON.stringify(input ?? {}) : undefined,
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(`${name}: ${body.error ?? response.statusText}`);
    }
    return response;
  }

  async call<T = any>(name: RouteName, input?: unknown): Promise<T> {
    const body = await (await this.request(name, input)).json();
    const failed = streamedError(body);
    if (failed) throw new Error(`${name}: ${failed.error}`);
    return body as T;
  }

  async *stream(name: RouteName, input: unknown): AsyncGenerator<ChatStreamEvent> {
    const response = await this.request(name, input);
    for await (const data of sseData(response.body!)) yield JSON.parse(data) as ChatStreamEvent;
  }
}

function roleUsable(deps: LoopTaskDeps, models: string[]): boolean {
  const caps = deps.caps();
  return models.some((ref) => {
    let parsed: { provider: string; model: string };
    try {
      parsed = parseRef(ref);
    } catch {
      return false;
    }
    const provider = resolveProvider(deps.store, deps.vault, parsed.provider);
    if (!provider) return false;
    if (provider.local) return (caps?.localModels ?? []).some((r) => r.runtime === parsed.provider && r.models.length > 0);
    return !!provider.apiKey;
  });
}

export async function heartbeatSnapshot(deps: LoopTaskDeps): Promise<HeartbeatSnapshot> {
  const now = (deps.now ?? Date.now)();
  const statuses = new Map(deps.sync.status().map((s) => [s.device, s]));
  const devices = deps.store.devices();
  const nameOf = (id: string) => deps.store.device(id)?.name ?? id.slice(0, 12);
  const active = new Set(devices.map((d) => d.id));
  const sandboxes = deps.sandbox ? await deps.sandbox.list().catch(() => null) : null;
  const sandboxHost = deps.sandbox
    ? await Promise.all([deps.sandbox.diskLimited().catch(() => false), deps.sandbox.status().then((s) => s.image).catch(() => true)]).then(
        ([diskLimited, image]) => ({ diskLimited, image, kvm: !!deps.caps()?.vm.kvm, microVMs: !!deps.caps()?.sandbox?.vm }),
      )
    : null;
  return {
    now,
    self: { id: deps.identity.id, name: deps.nodeName, startedAt: deps.startedAt },
    nodes: devices
      .filter((d) => d.kind === "node" && d.id !== deps.identity.id && typeof d.profile?.endpoint === "string")
      .map((d) => {
        const status = statuses.get(d.id);
        const caps = d.profile?.caps as Partial<Capabilities> | undefined;
        return { id: d.id, name: d.name, alwaysOn: isAlwaysOn(caps), online: !!status?.online, lastSeen: status?.lastSeen ?? null };
      }),
    vaultUnlocked: deps.vault.unlocked(),
    roles: Object.entries(roster(deps.store)).map(([role, spec]) => ({ role, models: spec.models, usable: roleUsable(deps, spec.models) })),
    sandboxes: sandboxes?.map((s) => ({ id: s.id, expiresAt: s.expiresAt, ephemeral: s.ephemeral })) ?? null,
    sandboxHost,
    loops: loopRecords(deps.store).map((loop) => ({
      name: loop.name,
      runner: active.has(loop.on) ? loop.on : null,
      recent: deps.store.loopRuns(loop.name, 3).map((r) => r.body.status),
    })),
    forks: deps.store.forks().map((id) => ({ id, name: nameOf(id) })),
    connectors: installedConnectors(deps.store).map((c) => ({
      id: c.id,
      label: c.manifest?.label ?? c.id,
      key: c.manifest ? keyState(deps.vault, c.manifest) : "none-needed",
      problem: c.problem,
    })),
    orders: deps.connectors
      .orders()
      .filter((o) => o.state === "active" || o.state === "stale")
      .map((o) => ({ id: o.id, label: o.label, tool: `${o.connector}.${o.tool}`, stale: o.state === "stale", until: o.until })),
    disk: diskOf(deps.home),
  };
}

/** Recent activity for the checklist model: what Galahad did, as data. */
function recentActivity(store: MindStore): string {
  const ledger = store.ledger(8).map((e) => `- ${e.body.class} ${e.body.resource} ${e.body.target}: ${e.body.verdict}`);
  const runs = store
    .loopRuns(undefined, 12)
    .filter((r) => r.body.loop !== "heartbeat")
    .slice(0, 5)
    .map((r) => `- loop ${r.body.loop}: ${r.body.status}, ${r.body.summary.replace(/\s+/g, " ").slice(0, 160)}`);
  return redact([...ledger, ...runs].join("\n"));
}

async function askSwift(deps: LoopTaskDeps, prompt: string, signal: AbortSignal): Promise<string> {
  let text = "";
  for await (const event of chat({ store: deps.store, vault: deps.vault, fetch: deps.fetch }, { role: "swift", messages: [{ role: "user", content: prompt }], signal })) {
    if (event.type === "text") text += event.text;
    else if (event.type === "error") throw new Error(event.error);
  }
  return text;
}

export async function beat(deps: LoopTaskDeps, checklist: string | undefined, signal: AbortSignal): Promise<RunResult & { findings: Finding[] }> {
  const now = (deps.now ?? Date.now)();
  const findings = assess(await heartbeatSnapshot(deps));
  let note = "";
  if (checklist?.trim()) {
    try {
      const reply = readChecklistReply(await askSwift(deps, checklistPrompt(checklist, findings, recentActivity(deps.store)), signal));
      if (reply) findings.push({ key: "checklist", severity: "info", title: "From your heartbeat checklist", body: redact(reply) });
    } catch (error) {
      note = ` (checklist skipped: ${redact(String((error as Error).message)).slice(0, 200)})`;
    }
  }
  const { raised, cleared } = reconcile(deps.store, deps.identity, findings, now);
  const serious = findings.filter((f) => f.severity !== "info");
  const summary = findings.length
    ? `${findings.length} finding${findings.length === 1 ? "" : "s"}: ${findings.map((f) => f.title).join("; ")}`
    : "All quiet.";
  const changes = raised || cleared ? ` (${raised} raised, ${cleared} cleared)` : "";
  return { status: serious.length ? "attention" : "ok", summary: `${summary}${changes}${note}`.slice(0, 2000), findings };
}

export function loopExecutor(deps: LoopTaskDeps) {
  return async (loop: RunnableLoop, ctx: RunContext): Promise<RunResult> => {
    const task = loop.task;
    switch (task.kind) {
      case "heartbeat":
        return beat(deps, task.checklist, ctx.signal);
      case "call": {
        const outcome = await deps.connectors.call(
          { connector: task.connector, tool: task.tool, args: task.args ?? {} },
          { kind: "agent", by: `loop:${loop.name}`, quest: `loop.${loop.name}` },
        );
        if (outcome.status === "asked") {
          return { status: "attention", summary: `${task.connector}.${task.tool} needs your approval: action ${outcome.action} is in your inbox.` };
        }
        const took = `${outcome.result.durationMs} ms`;
        return { status: outcome.result.ok ? "ok" : "attention", summary: `${task.connector}.${task.tool} → ${excerpt(outcome.result, 240)} (${took})` };
      }
      case "quest": {
        // The loop works as an arm: least privilege, its own ephemeral sandboxes, untrusted memories.
        const label = `loop.${loop.name}`;
        const { token } = deps.arms.mint(label, ["mind:read", "mind:write", "sandbox", "chat"]);
        try {
          const client = new LocalClient(`http://127.0.0.1:${deps.port}`, token);
          const { outcome } = await runNodeQuest(client, { goal: task.goal, network: task.network, maxSteps: task.maxSteps }, { signal: ctx.signal });
          const review = outcome.status !== "done" && outcome.review ? ` Reviewer: ${outcome.review.trim()}` : "";
          return {
            status: outcome.status === "done" ? "ok" : "attention",
            summary: `${outcome.status} after ${outcome.steps} commands: ${outcome.summary.trim()}${review}`,
          };
        } finally {
          deps.arms.revoke(label);
        }
      }
    }
  };
}
