import { type BoardVersionInfo, type ChatStreamEvent, type ConversationSummary, type Examination, JOURNAL_SOURCE, type NodeIdentity, redact, REFLECT_BUDGET, retriedRuns, type RouteName, routes, type SavedSummary, SELF_ACTION_RESOURCE } from "@galahad/core";
import type { BankService } from "./bank/service.ts";
import { chat, excerpt, installedConnector, installedConnectors, keyState, parseRef, resolveProvider, roster, sseData } from "@galahad/brain";
import type { SyncEngine } from "@galahad/link";
import type { MindStore, Vault } from "@galahad/mind";
import type { SandboxHost } from "@galahad/sandbox";
import type { ArmTokens } from "./arms.ts";
import { type Capabilities, isAlwaysOn } from "./capabilities.ts";
import type { ComputeService } from "./compute/service.ts";
import type { ConnectorService } from "./connectors.ts";
import { selfActionOn } from "./heartbeat-world.ts";
import { assess, checklistPrompt, diskOf, type Finding, type HeartbeatSnapshot, readChecklistReply, reconcile } from "./heartbeat.ts";
import { hlcMs, loopRecords, type RunContext, type RunnableLoop, type RunResult } from "./loops.ts";
import { companionOf, journalEntries } from "./journal.ts";
import { type JournalInputs, ledgerAgent, REFLECT_ROLES, reflectOnce } from "./reflect.ts";
import { selfAct, type SelfActionOutcome, type SelfSnapshot } from "./self-action.ts";
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
  bank?: BankService;
  /* ---- self-action and his journal (set by the daemon) ---- */
  /** Start a run of one of this node's loops now (self-action's retry). */
  runLoop?: (name: string) => void;
  /** Whether one of this node's loops is running now. */
  isRunning?: (name: string) => boolean;
  /** The world's weather, for self-action's refresh: fetched here at all, someone watching, known now. */
  weather?: { enabled: boolean; watched(): boolean; known(): boolean; refresh(): Promise<void> };
  /** Your kept chats (their titles are what his journal reads of them). */
  chats?: { list(): ConversationSummary[] };
  /** The experiments this node saved (his journal reads the ones that finished today, and each one's examination). */
  experiments?: { listing(limit?: number): { experiments: SavedSummary[] }; examination(id: string): Examination | null };
  /** The chalkboard's history (his journal reads today's versions: who changed it, and how, in a line). */
  board?: { history: { before(before: number | null, limit: number): { versions: BoardVersionInfo[] } } };
  /** This node's compute: its calibration and the fleet's plan (self-action), what he'd suggest (the heartbeat). */
  compute?: ComputeService;
  /** His review of his own world through his eyes (world-review.ts; set by the daemon). */
  review?: (places?: undefined, signal?: AbortSignal) => Promise<{ status: "ok" | "attention"; summary: string }>;
}

/** A node that joined this long ago and still hasn't measured itself is worth a line. */
const UNMEASURED_AFTER_MS = 60 * 60_000;

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

/** The bank connection, as the heartbeat sees it: only once it's set up on this node. */
function bankOf(bank: BankService | undefined): HeartbeatSnapshot["bank"] {
  if (!bank) return null;
  const status = bank.status();
  if (!status.configured) return null;
  return { problem: status.problem, connected: !status.reauthorizationRequired && status.accounts.length > 0, daysRemaining: status.daysRemaining, hadSession: status.validUntil !== null };
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
    bank: bankOf(deps.bank),
    compute: deps.compute ? computeOf(deps, now) : null,
  };
}

/** Compute never stops a heartbeat: if it can't be read, the beat goes on without it and the log says why. */
function quietly<T>(deps: LoopTaskDeps, what: string, read: () => T): T | null {
  try {
    return read();
  } catch (error) {
    deps.log(`${what}: ${(error as Error).message}`);
    return null;
  }
}

/** Compute, as the heartbeat sees it: nodes that should have measured themselves by now, and what he'd suggest. */
function computeOf(deps: LoopTaskDeps, now: number): HeartbeatSnapshot["compute"] {
  return quietly(deps, "compute (heartbeat)", () => {
    const nodes = deps.compute!.nodes();
    return {
      unmeasured: nodes
        .filter((n) => n.online && n.body && !n.calibration && now - hlcMs(deps.store.device(n.id)?.enrolledHlc ?? "") > UNMEASURED_AFTER_MS)
        .map((n) => ({ id: n.id, name: n.name })),
      suggestions: deps.compute!.suggestions(nodes),
    };
  });
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

export async function beat(deps: LoopTaskDeps, checklist: string | undefined, signal: AbortSignal, selfAction = true): Promise<RunResult & { findings: Finding[]; fixed: SelfActionOutcome[] }> {
  const now = (deps.now ?? Date.now)();
  let findings = assess(await heartbeatSnapshot(deps));
  // What's on the allowlist he fixes himself; then he looks again, so a fixed problem never becomes a notice.
  const fixed = selfAction ? await selfAct(await selfSnapshot(deps), () => selfSnapshot(deps), selfHands(deps), (entry) => void deps.store.emit(deps.identity, "ledger.recorded", entry)) : [];
  if (fixed.some((f) => f.ok)) findings = assess(await heartbeatSnapshot(deps));
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
  const fixes = fixed.length ? ` Fixed himself: ${fixed.map((f) => f.title).join("; ")}.` : "";
  return { status: serious.length ? "attention" : "ok", summary: `${summary}${changes}${fixes}${note}`.slice(0, 2000), findings, fixed };
}

/* ---------- self-action: this node as the allowlist's plan reads it, and its hands ---------- */

/** A loop that only reads: one connector tool of class read. */
function readsOnly(deps: LoopTaskDeps, task: RunnableLoop["task"] | null): boolean {
  if (task?.kind !== "call") return false;
  return installedConnector(deps.store, task.connector)?.tools[task.tool]?.class === "read";
}

export async function selfSnapshot(deps: LoopTaskDeps): Promise<SelfSnapshot> {
  const now = (deps.now ?? Date.now)();
  const sandboxes = deps.sandbox ? await deps.sandbox.list().catch(() => null) : null;
  return {
    now,
    sandboxes: sandboxes?.map((s) => ({ id: s.id, expiresAt: s.expiresAt, ephemeral: s.ephemeral, quest: s.quest })) ?? null,
    loops: loopRecords(deps.store)
      .filter((l) => l.on === deps.identity.id && l.enabled && l.task)
      .map((l) => ({
        name: l.name,
        readOnly: readsOnly(deps, l.task),
        running: deps.isRunning?.(l.name) ?? false,
        recent: deps.store.loopRuns(l.name, 2).map((r) => ({ run: r.body.run, status: r.body.status, finished: r.body.finished })),
      })),
    retried: retriedRuns(deps.store.ledger(300).filter((e) => e.body.resource === SELF_ACTION_RESOURCE).map((e) => e.body.target)),
    weather: deps.weather ? { enabled: deps.weather.enabled, watched: deps.weather.watched(), known: deps.weather.known() } : null,
    // The node that runs a heartbeat keeps the fleet's plan; every node measures itself.
    compute: computeSnapshot(deps, true),
  };
}

function computeSnapshot(deps: LoopTaskDeps, adapts: boolean): SelfSnapshot["compute"] {
  const compute = deps.compute;
  if (!compute) return null;
  return quietly(deps, "compute (self-action)", () => {
    const drift = compute.planDrift();
    return { canMeasure: compute.canMeasure(), ...compute.due(), adapts, planDigest: drift.digest, recordedDigest: drift.recorded };
  });
}

/**
 * A node's own upkeep of its compute, between heartbeats (at its start, and when its body changes): it
 * measures itself when that's due. The same allowlist, checks, ledger and owner's switch as after a
 * heartbeat; only the plan is left to the node that runs one.
 */
export async function computeUpkeep(deps: LoopTaskDeps): Promise<SelfActionOutcome[]> {
  if (!deps.compute || !selfActionOn(deps.store).on) return [];
  const snapshot = (): SelfSnapshot => ({ now: (deps.now ?? Date.now)(), sandboxes: null, loops: [], retried: [], weather: null, compute: computeSnapshot(deps, false) });
  return selfAct(snapshot(), async () => snapshot(), selfHands(deps), (entry) => void deps.store.emit(deps.identity, "ledger.recorded", entry));
}

function selfHands(deps: LoopTaskDeps) {
  return {
    reap: async (sandbox: string, quest: string) => {
      if (!deps.sandbox) throw new Error("this node is not a sandbox host");
      return deps.sandbox.destroy(sandbox, { quest });
    },
    retry: (loop: string) => {
      if (!deps.runLoop) throw new Error("loops can't be run from here");
      deps.runLoop(loop);
    },
    refreshWeather: async () => {
      if (!deps.weather) throw new Error("no weather here");
      await deps.weather.refresh();
    },
    calibrate: async (why: "joined" | "changed") => {
      if (!deps.compute) throw new Error("no compute here");
      await deps.compute.calibrate(why, "his own upkeep");
    },
    adaptCompute: () => {
      if (!deps.compute) throw new Error("no compute here");
      return deps.compute.adapt();
    },
  };
}

/* ---------- his journal (the reflect loop) ---------- */

/** At most this many of the day's finished experiments are read (each one's examination is read from its recording). */
const JOURNAL_EXPERIMENTS = 20;

/** An examination's opening sentence: what ran and how it ended. */
const openingSentence = (words: string | undefined): string | null => words?.match(/^.*?[.!?](?=\s|$)/s)?.[0]?.trim() || words?.trim() || null;

/** What his journal reads (reflect.ts cuts it to the last day and the budget, and keeps the bank and secrets out). */
export function journalInputs(deps: Pick<LoopTaskDeps, "store" | "chats" | "experiments" | "board" | "log">, now: number): JournalInputs {
  const store = deps.store;
  const since = now - 24 * 60 * 60_000;
  /** A source that can't be read today is left out, and the log says so: the journal is still written. */
  const read = <T,>(what: string, from: () => T[]): T[] => {
    try {
      return from();
    } catch (error) {
      deps.log(`journal: ${what} not read (${redact(String((error as Error).message)).slice(0, 200)})`);
      return [];
    }
  };
  return {
    now,
    ledger: store.ledger(300).map((e) => ({ at: hlcMs(e.hlc), class: e.body.class, resource: e.body.resource, target: e.body.target, verdict: e.body.verdict, by: ledgerAgent(e.body) })),
    notices: store
      .lwwPrefix<{ key: string; severity: string; title: string; source: string; dismissed?: boolean }>("notice:")
      .flatMap((e) => (e.value ? [{ key: e.value.key, severity: e.value.severity, title: e.value.title, source: e.value.source, dismissed: !!e.value.dismissed }] : [])),
    runs: store.loopRuns(undefined, 100).map((r) => ({ at: r.body.finished, loop: r.body.loop, status: r.body.status, summary: r.body.summary })),
    chats: (deps.chats?.list() ?? []).map((c) => ({ title: c.title, updatedAt: c.updatedAt, bank: c.bank })),
    experiments: read("the experiments", () =>
      (deps.experiments?.listing(200).experiments ?? [])
        .filter((e) => e.endedAt !== null && e.endedAt >= since && e.endedAt <= now)
        .slice(0, JOURNAL_EXPERIMENTS)
        .map((e) => ({ endedAt: e.endedAt!, title: e.title, engine: e.engine, status: e.status, examination: openingSentence(deps.experiments!.examination(e.id)?.words) })),
    ),
    board: read("the chalkboard", () =>
      (deps.board?.history.before(null, 200).versions ?? []).filter((v) => v.at >= since && v.change !== "start").map((v) => ({ at: v.at, by: v.by, summary: v.summary })),
    ),
    dog: companionOf(store)?.name ?? null,
  };
}

async function reflect(deps: LoopTaskDeps, budget: number, signal: AbortSignal): Promise<RunResult> {
  const now = (deps.now ?? Date.now)();
  const store = deps.store;
  const models = roster(store);
  return reflectOnce(
    {
      now,
      budget,
      inputs: journalInputs(deps, now),
      // Only an entry his loop kept counts: a memory an agent tagged like one doesn't stop him writing.
      doneToday: (day) => journalEntries(store, { day }).entries.length > 0,
      role: () => REFLECT_ROLES.find((role) => models[role] && roleUsable(deps, models[role]!.models)) ?? null,
      ask: async (role, prompt, maxChars, outer) => {
        // Stopped as soon as it has written its share of the budget.
        const stop = new AbortController();
        const abort = () => stop.abort();
        outer.addEventListener("abort", abort, { once: true });
        let text = "";
        try {
          for await (const event of chat({ store, vault: deps.vault, fetch: deps.fetch }, { role, messages: [{ role: "user", content: prompt }], signal: stop.signal })) {
            if (event.type === "text") text += event.text;
            else if (event.type === "error") throw new Error(event.error);
            if (text.length >= maxChars) {
              stop.abort();
              break;
            }
          }
        } catch (error) {
          if (!stop.signal.aborted || outer.aborted) throw error;
        } finally {
          outer.removeEventListener("abort", abort);
        }
        return text;
      },
      remember: (text, tags) => void store.remember(deps.identity, text, { tags, prov: { trust: "agent", source: JOURNAL_SOURCE } }),
      suggest: (day, ideas) =>
        void reconcile(
          store,
          deps.identity,
          ideas.map((idea, i) => ({
            key: `suggestion:${day}:${i + 1}`,
            severity: "info" as const,
            title: `Galahad suggests: ${idea}`.slice(0, 200),
            body: `From his journal for ${day}. He won't do it on his own: if you'd like it done, ask him, or dismiss it.`,
          })),
          now,
          "reflect",
        ),
    },
    signal,
  );
}

export function loopExecutor(deps: LoopTaskDeps) {
  return async (loop: RunnableLoop, ctx: RunContext): Promise<RunResult> => {
    const task = loop.task;
    switch (task.kind) {
      case "heartbeat":
        return beat(deps, task.checklist, ctx.signal, task.selfAction !== false);
      case "reflect":
        return reflect(deps, task.budget ?? REFLECT_BUDGET, ctx.signal);
      case "review": {
        if (!deps.review) return { status: "attention", summary: "This node can't review his world." };
        const { status, summary } = await deps.review(undefined, ctx.signal);
        return { status, summary };
      }
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
