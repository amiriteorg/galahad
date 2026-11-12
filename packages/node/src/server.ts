import {
  type ActionView,
  canonical,
  type Json,
  CLIENT_DEFAULT_SCOPES,
  SELF_ACTION_KINDS,
  SELF_ACTION_RESOURCE,
  SELF_ACTIONS,
  type SelfActionView,
  type ChatStreamEvent,
  type ChatMessage,
  stationForTool,
  staysPut,
  type EyesPlace,
  type WorldEvent,
  type WorldNode,
  type ConversationSummary,
  type ConversationView,
  type ChatNeeds,
  chatState,
  type QueuedMessage,
  type QueueHold,
  type TurnView,
  type ProjectView,
  type StoredStep,
  SyncRequest,
  titleFrom,
  ConnectorManifest,
  type ConnectorView,
  type FindingView,
  type InvestigationView,
  isMcpTool,
  Preregistration,
  randomId,
  redact,
  registrationDigest,
  isTimeZone,
  type LoopTask,
  type LoopView,
  nextRun,
  type NoticeView,
  type DeviceView,
  equalBytes,
  findSecrets,
  SECRET_REDIRECT,
  type FleetView,
  type NodeIdentity,
  NonceCache,
  OWNER_SCOPES,
  type Presence,
  PushRequest,
  type RouteName,
  routes,
  type Scope,
  type SecretView,
  type TrialRecord,
  trialProblem,
  type TrialRunsView,
  TrialRunSettings,
  type TrialView,
  ComputeLimit,
  COMPUTE_RESOURCE,
  type Station,
  utf8,
  verifyRequestSignature,
} from "@galahad/core";
import {
  CATALOG,
  chat,
  decide,
  DecisionError,
  GatewayTokens,
  installedConnector,
  installedConnectors,
  keyState,
  handleGateway,
  listModels,
  originOf,
  parseRef,
  PRESETS,
  preset,
  providerRecord,
  providerViews,
  resolveProvider,
  roster,
} from "@galahad/brain";
import { answerPush, answerSync, PairingError, type PairingHost, signedFetch, signedPost, type SyncEngine } from "@galahad/link";
import { type Device, isFullNode, type MindStore, revokeDevice, type SecretInfo, type Vault } from "@galahad/mind";
import { type LedgerEntryInput, SandboxError } from "@galahad/sandbox";
import type { GovernedSandboxHost } from "./compute/governed-host.ts";
import type { Governor } from "./compute/governor.ts";
import type { ComputeService } from "./compute/service.ts";
import { z, ZodError } from "zod";
import { ARM_FORBIDDEN_SCOPES, type ArmTokens, armQuest, GALAHAD_ARM } from "./arms.ts";
import { chatTools, type ToolApi, TOOLS, toolsFor } from "./tools.ts";
import type { ChatStore, KeptSummary, QueuedBy, Waits } from "./chats.ts";
import { type AnswerRecord, asideMessages, broughtBack, keepStep, type LiveTurn, TurnError, type TurnHub, type TurnSpec } from "./turns.ts";
import type { QuestBoard } from "./quests.ts";
import { handleSandboxWorld, type WorldHub } from "./world-hub.ts";
import { ExperimentError } from "./experiment-store.ts";
import { RunError, runExperiment } from "./experiment-run.ts";
import { ArtifactError, type ArtifactStore, contentTypeOf } from "./artifacts.ts";
import { fenceMemories } from "./archive/retrieval.ts";
import type { ArchiveService } from "./archive/service.ts";
import { ArchiveError } from "./archive/store.ts";
import { type Eyes, EyesError } from "./eyes.ts";
import type { ReviewResult, ReviewState } from "./world-review.ts";
import type { Assets } from "./assets.ts";
import { compressedJson } from "./compress.ts";
import { type Capabilities, isAlwaysOn } from "./capabilities.ts";
import { handleGitGateway } from "./git-gateway.ts";
import { BankError, type BankService } from "./bank/service.ts";
import { BoardError, type BoardStore } from "./board.ts";
import { boardVersionForArchive } from "./board-history.ts";
import { handleSandboxSearch, SearchError, searchWeb } from "./search.ts";
import { ConnectorCallError, type ConnectorService } from "./connectors.ts";
import { checkSchedule, LoopError, loopRecords, type LoopRunner, runView } from "./loops.ts";
import { selfActionOn } from "./heartbeat-world.ts";
import { companionOf, companionView, journalEntries } from "./journal.ts";
import { type Candidate, Dispatched, fleetCandidates, place, sandboxHost } from "./placement.ts";

/**
 * loopback  127.0.0.1:<port>         local processes only: CLI (admin token), model gateway
 * proxied   127.0.0.1:<port + 1>     target of `tailscale serve` (HTTPS PWA): remote traffic, treated like tailnet
 * tailnet   <tailnet ip>:<port>      node-to-node link
 * sandbox   <gateway bridge>:7779    reachable only from sandboxes: the model gateway and nothing else
 */
export type Listener = "loopback" | "proxied" | "tailnet" | "sandbox";

export interface AppContext {
  identity: NodeIdentity;
  /** Sandbox work products kept on this node. */
  artifacts: ArtifactStore;
  nodeName: string;
  port: number;
  store: MindStore;
  vault: Vault;
  pairing: PairingHost;
  sync: SyncEngine;
  tokens: GatewayTokens;
  arms: ArmTokens;
  adminToken: string;
  assets: Assets;
  caps: () => Capabilities | null;
  presence: () => Promise<Presence>;
  log: (message: string) => void;
  /** Present when this node is a sandbox host: every sandbox it creates takes a slot first (compute/governed-host.ts). */
  sandbox?: GovernedSandboxHost | null;
  /** This node's slots: sandboxes and model calls. */
  governor: Governor;
  /** Compute: the census, this node's calibration, the plan, effort. */
  compute: ComputeService;
  /** Look at this node's compute now (a ceiling of its own changed): it measures itself again if that's due. */
  computeUpkeep?: () => void;
  /** Build context for the sandbox image (repo `sandbox/`). */
  sandboxContext?: string;
  connectors: ConnectorService;
  loops: LoopRunner;
  /** The heartbeat's checks, run here and now (no writes). */
  heartbeatCheck: () => Promise<FindingView[]>;
  /** Read-only bank access (Enable Banking), on the node that holds the key. */
  bank: BankService;
  /** Your chat history, on this node. */
  chats: ChatStore;
  /** The turns this node runs for you: each to its end whoever listens, with what you steer and queue. */
  turns: TurnHub;
  /** The quests in hand, as whoever runs each one reports it. */
  quests: QuestBoard;
  /** The SANDBOX: what Galahad is doing, and the experiments on their plots. */
  world: WorldHub;
  /** The chalkboard you and Galahad share. */
  board: BoardStore;
  /** His eyes: frames a page rendered from his point of view, and the words for what he sees (eyes.ts). */
  eyes: Eyes;
  /** His review of his own world through them (world-review.ts): yours to start. */
  review: { run(places?: readonly EyesPlace[], signal?: AbortSignal): Promise<ReviewResult>; state: ReviewState };
  /** The archive: what this node keeps for good, and searches by words and meaning. */
  archive: ArchiveService;
  /** What the node did, for the ledger (the git gateway's reads). */
  ledger?: (entry: LedgerEntryInput) => void;
  /** How the node reaches the world (tests pass a stand-in). */
  fetch?: typeof fetch;
  /** Aborted when the node stops: streams that would never end on their own (the world) end. */
  shutdown?: AbortSignal;
}

interface Principal {
  device: string;
  /** admin = you at a terminal · client = a paired device · node = a fleet node · arm = a coding agent via MCP */
  kind: "admin" | "node" | "client" | "arm";
  scopes: Scope[];
  label?: string;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
};

/** POST routes that only read (a search, a kept chat): compressed like the GET ones. */
const COMPRESSED_READS = new Set<RouteName>(["recall", "journal", "conversation", "sandboxes", "experiment", "experimentRecording", "archiveSearch", "archiveEntry"]);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...SECURITY_HEADERS } });

const statusOf = (error: unknown): number =>
  error instanceof HttpError || error instanceof SandboxError || error instanceof PairingError ? error.status : 500;

/**
 * For work that may outlast every idle timer between here and the caller (Bun's
 * 255 s cap, proxies): if it settles within `graceMs` it is an ordinary response
 * with a real status code; otherwise the response streams whitespace heartbeats
 * (valid leading JSON whitespace) and ends with the JSON result. A failure after
 * streaming began arrives as `{ "error", "status" }`, which every Galahad client checks.
 */
export async function longRunning<T>(work: Promise<T>, graceMs = 300, heartbeatMs = 10_000): Promise<Response> {
  const outcome = work.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  const early = await Promise.race([outcome, Bun.sleep(graceMs).then(() => null)]);
  if (early) {
    if (early.ok) return json(early.value);
    throw early.error;
  }
  const encoder = new TextEncoder();
  let beat: ReturnType<typeof setInterval> | undefined;
  let open = true;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (text: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          open = false; // the caller went away; the work itself still finishes and is recorded
        }
      };
      beat = setInterval(() => send(" "), heartbeatMs);
      void outcome.then((result) => {
        clearInterval(beat);
        const body = result.ok
          ? result.value
          : { error: String((result.error as Error).message ?? result.error), status: statusOf(result.error) };
        send(JSON.stringify(body));
        if (open) {
          open = false;
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      });
    },
    cancel() {
      open = false;
      clearInterval(beat);
    },
  });
  return new Response(stream, { headers: { "content-type": "application/json", ...SECURITY_HEADERS } });
}

/** Unwrap a `{ error, status }` body produced by a streamed long-running response. */
export function streamedError(body: unknown): { error: string; status: number } | null {
  if (body && typeof body === "object" && "error" in body && "status" in body) {
    const { error, status } = body as { error: unknown; status: unknown };
    if (typeof error === "string" && typeof status === "number") return { error, status };
  }
  return null;
}

const StatusInput = z.strictObject({ invite: z.string().max(64), device: z.string().max(100), proof: z.string().max(100) });

const secretView = (s: SecretInfo): SecretView => ({
  name: s.name,
  provider: s.provider,
  hint: s.hint,
  origin: s.origin,
  label: s.label,
  updatedAt: s.hlc,
  updatedBy: s.device,
});

export function createApp(ctx: AppContext) {
  const nonces = new NonceCache();
  const adminBytes = utf8(ctx.adminToken);

  function authenticate(req: Request, body: Uint8Array, pathAndQuery: string, listener: Listener): Principal | null {
    const armToken = req.headers.get("authorization")?.match(/^Bearer\s+(arm_\S+)$/)?.[1];
    if (armToken) {
      // Arm tokens are local credentials too: never valid over the tailnet or through tailscale serve.
      if (listener !== "loopback") return null;
      const arm = ctx.arms.verify(armToken);
      return arm ? { device: `arm:${arm.label}`, kind: "arm", scopes: arm.scopes, label: arm.label } : null;
    }
    const bearer = req.headers.get("authorization")?.match(/^Bearer\s+(adm_\S+)$/)?.[1];
    if (bearer) {
      // The admin token is a local credential for the CLI; it is never valid over the tailnet listener.
      return listener === "loopback" && equalBytes(utf8(bearer), adminBytes)
        ? { device: ctx.identity.id, kind: "admin", scopes: OWNER_SCOPES }
        : null;
    }
    const proof = verifyRequestSignature(req.headers, req.method, pathAndQuery, body);
    if (!proof) return null;
    const device = ctx.store.activeDevice(proof.device);
    if (!device) return null;
    if (!nonces.claim(proof.device, proof.nonce)) return null;
    // Full nodes already hold the vault: they are owner-equivalent, including scopes added later.
    const fullNode = device.kind === "node" && device.role === "full";
    return { device: device.id, kind: device.kind, scopes: fullNode ? OWNER_SCOPES : device.scopes };
  }

  function resolveNode(ref: string): Device {
    const node = ctx.store
      .devices()
      .find((d) => d.kind === "node" && (d.id === ref || d.name === ref || (ref.length >= 6 && d.id.startsWith(ref))));
    if (!node) throw new HttpError(404, `no active node "${ref}"`);
    return node;
  }

  /** Where a sandbox nobody pinned was placed, when that's another node: what follows (its commands, its end) goes there. */
  const placed = new Map<string, string>();
  const remember = (sandbox: string, node: string): void => {
    if (node === ctx.identity.id) return;
    placed.set(sandbox, node);
    while (placed.size > 512) placed.delete(placed.keys().next().value!);
  };

  /**
   * What this node did on other hosts since each last reported: sandboxes sent there, and ones of its own ended
   * there. Another host's slots are only as fresh as its last sync, so placement counts these on top (see Dispatched).
   */
  const dispatched = new Dispatched();

  /**
   * Pick the best sandbox host in the fleet for work nobody pinned to a node: the one with room (this node
   * among them), by what each measured; when every host is full, the one with the shortest queue.
   */
  function placeSandbox(): Device {
    const best = sandboxHost(candidates());
    if (!best) throw new HttpError(424, "no sandbox host is online in this fleet");
    return resolveNode(best.device);
  }

  /** Send a request to another node, signed as this one; its errors come back as ours. */
  async function forward<T>(target: Device, path: string, body: Record<string, unknown>): Promise<T> {
    if (!target.profile?.endpoint) throw new HttpError(424, `${target.name} has no reachable endpoint`);
    let result: T;
    try {
      result = await signedPost<T>(ctx.identity, target.profile.endpoint, path, body, { timeoutMs: 75 * 60_000 });
    } catch (error) {
      const match = String((error as Error).message).match(/→ (\d{3}) (.*)$/s);
      if (!match) throw new HttpError(502, `${target.name} is unreachable`);
      let message = match[2]!;
      try {
        message = (JSON.parse(match[2]!) as { error?: string }).error ?? message;
      } catch {
        /* plain text */
      }
      throw new HttpError(Number(match[1]), `${target.name}: ${message}`);
    }
    const failed = streamedError(result);
    if (failed) throw new HttpError(failed.status, `${target.name}: ${failed.error}`);
    return result;
  }

  /** A kept file's bytes, fenced: opened directly, it can do nothing on this origin. */
  function keptFile(body: BodyInit | null, type: string, disposition: string, length: number | null): Response {
    return new Response(body, {
      headers: {
        "content-type": type,
        ...(length !== null ? { "content-length": String(length) } : {}),
        "content-disposition": disposition,
        "cache-control": "no-store",
        "content-security-policy": "sandbox; default-src 'none'",
        ...SECURITY_HEADERS,
      },
    });
  }

  /** How this node serves a kept file at `path`: its type and name decided here, never by whoever sent the bytes. */
  function keptFileHeaders(path: string): { type: string; disposition: string } {
    const { type, inline } = contentTypeOf(path);
    const name = (path.split("/").at(-1) ?? "file").replace(/[^A-Za-z0-9._ -]/g, "_");
    return { type, disposition: `${inline ? "inline" : "attachment"}; filename="${name}"` };
  }

  /** A kept file from the node that holds it, streamed through with this node's own fences. */
  async function fileFrom(holder: Device, input: { id: string; path: string }): Promise<Response> {
    if (!holder.profile?.endpoint) throw new HttpError(424, `${holder.name} has no reachable endpoint`);
    let upstream: Response;
    try {
      upstream = await signedFetch(ctx.identity, holder.profile.endpoint, routes.artifactFile.path, input, { timeoutMs: 10 * 60_000 });
    } catch {
      throw new HttpError(502, `${holder.name} is unreachable`);
    }
    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "");
      let message = text;
      try {
        message = (JSON.parse(text) as { error?: string }).error ?? text;
      } catch {
        /* plain text */
      }
      throw new HttpError(upstream.status, `${holder.name}: ${message}`.slice(0, 500));
    }
    // Only the bytes (and their length) come from the holder. The type and the name are this
    // node's, from the path asked for, as for a file kept here: a holder answering text/html
    // for a page can't have it rendered on this origin.
    const { type, disposition } = keptFileHeaders(input.path);
    // No length (a chunked answer) is no length, not zero.
    const declared = upstream.headers.get("content-length");
    return keptFile(upstream.body, type, disposition, declared && /^\d{1,15}$/.test(declared) ? Number(declared) : null);
  }

  /**
   * Run here, or forward (signed, as this node) to the node that should run it.
   * A request that another node forwarded always runs where it lands: never re-forwarded,
   * so two nodes can never bounce work back and forth.
   */
  async function onNode<T>(
    p: Principal,
    on: string | undefined,
    path: string,
    body: Record<string, unknown>,
    local: () => Promise<T>,
    /** A new sandbox goes where there's room; what follows goes where its sandbox is. */
    where: { create?: boolean; sandbox?: string } = {},
  ): Promise<T> {
    const elsewhere = where.sandbox ? placed.get(where.sandbox) : undefined;
    const target =
      p.kind === "node" ? null : on ? resolveNode(on) : elsewhere ? (ctx.store.activeDevice(elsewhere) ?? null) : where.create ? placeSandbox() : ctx.sandbox ? null : placeSandbox();
    if (!target || target.id === ctx.identity.id) {
      if (!ctx.sandbox) throw new HttpError(424, "this node is not a sandbox host");
      return local();
    }
    if (!where.create) return forward<T>(target, path, body);
    // A sandbox on its way to another host takes a slot there before that host's next report says so.
    const never = dispatched.note(target.id, 1, Date.now());
    try {
      return await forward<T>(target, path, body);
    } catch (error) {
      never();
      throw error;
    }
  }

  function candidates(): Candidate[] {
    return fleetCandidates({ devices: ctx.store.devices(), self: ctx.identity.id, selfCaps: ctx.caps(), statuses: ctx.sync.status(), compute: ctx.compute.nodes(), dispatched });
  }

  function deviceViews(): DeviceView[] {
    return ctx.store.devices(true).map((d) => ({
      id: d.id,
      name: d.name,
      kind: d.kind,
      role: d.role,
      scopes: d.scopes,
      enrolledAt: d.enrolledHlc,
      revokedAt: d.revokedHlc,
      endpoint: d.profile?.endpoint ?? null,
      caps: d.id === ctx.identity.id ? (ctx.caps() as unknown as Record<string, unknown>) : (d.profile?.caps ?? null),
    }));
  }

  function fleetView(): FleetView {
    return {
      fleet: ctx.store.fleet!,
      name: ctx.store.genesis?.name ?? "",
      self: ctx.identity.id,
      devices: deviceViews(),
      peers: ctx.sync.status(),
      events: ctx.store.eventCount(),
      // A hash of every view (as big as the views, not the log; kept until they change).
      digest: ctx.store.digest(),
    };
  }

  // The world's banners: the fleet's nodes and paired devices, with who's online (no state digest).
  ctx.world.setNodes((): WorldNode[] => {
    const online = new Map(ctx.sync.status().map((p) => [p.device, p.online]));
    return deviceViews()
      .filter((d) => !d.revokedAt)
      .map((d) => ({
        id: d.id,
        name: d.name,
        kind: d.kind,
        self: d.id === ctx.identity.id,
        online: d.id === ctx.identity.id || (online.get(d.id) ?? false),
        sandboxHost: Boolean((d.caps as { sandbox?: { image?: unknown } } | null)?.sandbox?.image),
      }));
  });

  /** Recalled memories become context for chat, labelled with their trust level. */
  function memoryContext(query: string): string | undefined {
    const memories = ctx.store.recall(query, 8);
    if (!memories.length) return undefined;
    // Fenced like the archive: an untrusted memory (a web page, an agent's text) can't pose as the prompt.
    return fenceMemories("Relevant memories from your shared mind:", memories);
  }

  /**
   * Galahad himself, as the agent that runs his tools in chat: the caller's scopes,
   * never more, and never what an agent may not hold (vault, devices, gateway,
   * brain). As an agent, his memories are "agent", his sandboxes are his own, and
   * anything outward or destructive waits for your approval. An agent calling chat
   * keeps its own powers.
   */
  function galahadFor(p: Principal): Principal {
    if (p.kind === "arm") return p;
    return { device: `arm:${GALAHAD_ARM}`, kind: "arm", label: GALAHAD_ARM, scopes: p.scopes.filter((s) => !ARM_FORBIDDEN_SCOPES.includes(s)) };
  }

  /** The tools' way into the node from inside it: the same routes, scope checks and input validation as over HTTP. */
  function inProcess(p: Principal, signal: AbortSignal): ToolApi {
    const invoke = (name: RouteName, raw: unknown) => {
      const route = routes[name];
      if (route.scope && !p.scopes.includes(route.scope)) throw new HttpError(403, `requires scope ${route.scope}`);
      const input = route.input ? route.input.parse(raw ?? {}) : undefined;
      return handlers[name](input, p, new Request("http://galahad.internal/", { signal }));
    };
    const failure = async (response: Response) => {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      return new HttpError(response.status, body.error ?? `${response.status} ${response.statusText}`);
    };
    return {
      async call<T>(name: RouteName, input?: unknown): Promise<T> {
        const result = await invoke(name, input);
        if (!(result instanceof Response)) return result as T;
        if (!result.ok) throw await failure(result);
        const text = (await result.text()).trim();
        const body = (text ? JSON.parse(text) : {}) as { error?: unknown; status?: unknown };
        // Long-running responses report late failures in the body.
        if (typeof body.error === "string" && typeof body.status === "number") throw new HttpError(body.status, body.error);
        return body as T;
      },
      async bytes(name, input) {
        const result = await invoke(name, input);
        if (!(result instanceof Response)) throw new HttpError(500, "that isn't a file");
        if (!result.ok) throw await failure(result);
        return { bytes: new Uint8Array(await result.arrayBuffer()), type: result.headers.get("content-type") ?? "" };
      },
    };
  }

  /**
   * What the world shows of an answer: where Galahad goes for each step, and a line of
   * what he's saying now and then. Once the bank is in the answer, no more lines from it.
   */
  function worldWatcher(role: string, quest: boolean, answer: { content: string; bank: boolean }) {
    let model: string | null = null;
    let spoken = 0;
    let lastLine = 0;
    const thinking = () => ctx.world.doing("council", quest ? `The ${role} is thinking` : "Thinking it over", { model });
    return (event: ChatStreamEvent) => {
      if (event.type === "model") {
        model = event.ref;
        thinking();
      } else if (event.type === "tool" && staysPut(event.name)) {
        // Looking through his own eyes takes him nowhere: he looks from where he stands.
      } else if (event.type === "tool") {
        const tool = TOOLS.find((t) => t.name === event.name);
        // Once the bank is in the answer, a tool's input may carry it: the world gets only its name.
        // On the board, what he writes (its title or its first words), not its JSON.
        const said = event.name.startsWith("board_") ? event.input.match(/"(?:title|text)":"((?:[^"\\]|\\.){1,80})/)?.[1] : undefined;
        const detail = answer.bank || tool?.flow === "private" || !event.input ? "" : `: ${said ?? event.input.replace(/^\{"?(?:query|q|command|text)"?:"?/, "").replace(/"?\}$/, "")}`;
        ctx.world.doing(stationForTool(event.name), `${event.title}${detail}`, { model });
      } else if (event.type === "tool_result") {
        thinking();
      } else if (event.type === "text" && !answer.bank && Date.now() - lastLine > 2_500 && answer.content.length - spoken > 40) {
        // The latest complete sentence he's written, now and then.
        const fresh = answer.content.slice(spoken);
        const sentence = fresh.match(/[^.!?\n]{12,}[.!?](?=\s|$)(?![^]*[^.!?\n]{12,}[.!?](?=\s|$))/)?.[0];
        if (sentence) {
          ctx.world.think(sentence.replace(/[*_`#>]/g, ""));
          spoken = answer.content.length;
          lastLine = Date.now();
        }
      }
    };
  }

  /**
   * What an agent (an arm, Galahad's own tools included) does through the API, as the world shows it. A coding
   * agent (not Galahad's own chat, not a loop: those are him) walks there beside him, as his partner.
   */
  function armActivity(name: RouteName, input: unknown, label?: string): void {
    const tool = TOOLS.find((t) => t.routes[0] === name);
    if (!tool || (name === "connectors" || name === "fleet")) return;
    if (staysPut(tool.name)) return;
    const q = input && typeof input === "object" ? ((input as Record<string, unknown>).q ?? (input as Record<string, unknown>).query) : undefined;
    const station = stationForTool(tool.name);
    const line = `${tool.title}${typeof q === "string" && tool.flow !== "private" ? `: ${q.slice(0, 80)}` : ""}`;
    ctx.world.doing(station, line);
    if (label && label !== GALAHAD_ARM && !label.startsWith("loop.")) ctx.world.partner(label, station, line);
  }

  /** Self-action as the owner sees it: on or off, the heartbeats it follows, the allowlist, his latest fixes. */
  function selfActionView(): SelfActionView {
    const { on, heartbeats } = selfActionOn(ctx.store);
    return {
      on,
      heartbeats,
      allowlist: SELF_ACTION_KINDS.map((kind) => ({ kind, class: SELF_ACTIONS[kind].class, why: SELF_ACTIONS[kind].why })),
      recent: ctx.store
        .ledger(300)
        .filter((e) => e.body.resource === SELF_ACTION_RESOURCE)
        .slice(0, 50)
        .map((e) => ({
          id: e.id,
          hlc: e.hlc,
          device: e.device,
          class: e.body.class,
          resource: e.body.resource,
          target: e.body.target,
          verdict: e.body.verdict,
          reason: e.body.reason ?? null,
          quest: e.body.quest ?? null,
          detail: e.body.detail ?? null,
        })),
    };
  }

  /** A tool's failure in words the model may see: what the API would say, never an internal error's detail. */
  function explain(error: unknown): string {
    if (error instanceof HttpError || error instanceof PairingError || error instanceof SandboxError || error instanceof BoardError) return error.message;
    if (error instanceof ZodError) return `invalid input: ${error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")}`;
    const message = String((error as Error)?.message ?? error);
    if (/not authorized|already|unknown or|refusing|no secret|not configured/.test(message)) return message;
    ctx.log(`chat tool error: ${message}`);
    return "internal error";
  }

  /** You, at a terminal or on a paired device: never an agent, never another node. */
  const isOwner = (p: Principal) => p.kind === "admin" || p.kind === "client";
  function ownerOnly(p: Principal): void {
    if (!isOwner(p)) throw new HttpError(403, "chats are yours alone");
  }
  /** Your device by name, for the board's history ("a terminal" at the CLI). */
  const deviceName = (p: Principal): string | undefined => (!isOwner(p) ? undefined : p.kind === "admin" ? `a terminal on ${ctx.nodeName}` : ctx.store.device(p.device)?.name);
  /** A chat where Galahad read the bank is for devices that may read the bank. */
  const visibleTo = (c: ConversationSummary, p: Principal) => !c.bank || p.scopes.includes("bank:read");

  /* ---------- turns the node owns: who may see, steer and stop them; a chat's state at a glance ---------- */

  const turnErrors = <T,>(work: () => T): T => {
    try {
      return work();
    } catch (error) {
      if (error instanceof TurnError) throw new HttpError(error.status, error.message);
      throw error;
    }
  };
  /** Who asked, as the hub keeps it: enough to act as them again when a queued message's turn comes. */
  const byOf = (p: Principal): QueuedBy => ({ kind: p.kind === "admin" ? "admin" : "client", device: p.device });
  const sameAsker = (by: QueuedBy, p: Principal): boolean => by.device === p.device && (by.kind === "admin") === (p.kind === "admin");
  /**
   * Whether a turn is this device's to know of: you, and for a kept chat a device that may see that chat;
   * a temporary chat's turn is known only to the device that started it (it's kept nowhere).
   */
  function knowsTurn(turn: LiveTurn, p: Principal): boolean {
    if (!isOwner(p)) return false;
    const c = turn.spec.conversation;
    if (!c) return sameAsker(turn.spec.by, p);
    const kept = ctx.chats.summary(c.id);
    return !!kept && visibleTo(kept, p);
  }
  /** Whether it may watch and steer it too: a turn that may read the bank is only for a device that may read the bank. */
  const watchesTurn = (turn: LiveTurn, p: Principal): boolean => knowsTurn(turn, p) && (!turn.spec.bank || p.scopes.includes("bank:read"));
  function watchedTurn(id: string, p: Principal): LiveTurn {
    ownerOnly(p);
    const turn = ctx.turns.get(id);
    if (!turn || !knowsTurn(turn, p)) throw new HttpError(404, "no such turn here (one that ended a while ago is in its chat)");
    if (!watchesTurn(turn, p)) throw new HttpError(403, "that turn may read the bank, and this device may not: it can be stopped from here, not watched or steered");
    return turn;
  }
  const turnView = (turn: LiveTurn, p: Principal): TurnView => ctx.turns.view(turn, watchesTurn(turn, p));
  /** A kept chat of yours that this device may see, or 404. */
  function keptChat(id: string, p: Principal): KeptSummary {
    ownerOnly(p);
    const kept = ctx.chats.summary(id);
    if (!kept || !visibleTo(kept, p)) throw new HttpError(404, "no such conversation");
    return kept;
  }
  /** What a turn left waiting on you, as it stands now: approvals still unanswered, keys still not given. */
  function needsResolver(): (waits: Waits | null) => ChatNeeds | null {
    let waiting: Set<string> | null = null;
    let asked: Set<string> | null = null;
    return (waits) => {
      if (!waits) return null;
      const now = Date.now();
      waiting ??= new Set(ctx.connectors.actions().filter((a) => a.state === "waiting" && a.expires > now).map((a) => a.id));
      asked ??= new Set(ctx.vault.requests().map((r) => r.name));
      const needs = { approvals: waits.actions.filter((id) => waiting!.has(id)).length, keys: waits.secrets.filter((name) => asked!.has(name)).length, question: waits.question };
      return needs.approvals || needs.keys || needs.question ? needs : null;
    };
  }
  /** A kept chat as your devices see it: with its state at a glance (working, waiting on you, queued, stopped, failed, done). */
  function chatSummary(c: KeptSummary, needsOf = needsResolver()): ConversationSummary {
    const { last, waits, ...summary } = c;
    const needs = needsOf(waits);
    return { ...summary, needs, state: chatState({ running: ctx.turns.runningIn(c.id) !== null, needs, queued: c.queued, last }) };
  }
  const deviceLabel = (by: QueuedBy): string | null => (by.kind === "admin" ? `a terminal on ${ctx.nodeName}` : (ctx.store.device(by.device)?.name ?? null));
  /** A chat's queue as your devices see it: your messages in order, and why they're held if they are. */
  function queueView(conversation: string): { queue: QueuedMessage[]; held: QueueHold | null } {
    const queue = ctx.chats.queue(conversation).map((q): QueuedMessage => ({ id: q.id, text: q.text, role: q.role, at: q.at, by: deviceLabel(q.by) }));
    return { queue, held: queue.length ? ctx.chats.held(conversation) : null };
  }

  /**
   * Archived chats are yours, like the chats themselves: shown to you and to Galahad
   * answering you, never to an outside agent or another node.
   */
  const archiveHidden = (p: Principal): string[] => (isOwner(p) || (p.kind === "arm" && p.label === GALAHAD_ARM) ? [] : ["chat"]);
  const archiveErrors = async <T,>(work: () => Promise<T> | T): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      if (error instanceof ArchiveError) throw new HttpError(error.status, error.message);
      throw error;
    }
  };
  function ownerOfArchive(p: Principal): void {
    if (!isOwner(p)) throw new HttpError(403, "only you change the archive this way");
  }

  function projectsView(): ProjectView[] {
    return ctx.store
      .lwwPrefix<{ id: string; name: string; instructions: string; repo?: string }>("project:")
      .filter((e) => e.value)
      .map((e) => ({ id: e.value!.id, name: e.value!.name, instructions: e.value!.instructions, repo: e.value!.repo ?? null, updatedAt: Number(e.hlc.slice(0, 15)) }));
  }

  /** A project's context for an answer: its name, repository, your instructions, and what was remembered in it. */
  function projectContext(project: ProjectView): string {
    const memories = ctx.store.memoriesTagged(`project:${project.id}`, 10);
    return [
      `You are working in your liege's project "${project.name}" (${project.id}). What you remember in this conversation is tagged with it.`,
      project.repo ? `Its repository: ${project.repo}` : null,
      project.instructions ? `Your liege's instructions for this project (follow them unless they conflict with your oath):\n${project.instructions}` : null,
      memories.length ? fenceMemories("What you remember about it:", memories) : null,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  /**
   * Refuse anything credential-shaped: chat goes to providers, memory replicates in plaintext.
   * The ids of events in the mind look like random keys but are public to the fleet (Galahad
   * quotes them from the ledger), so they pass.
   */
  const scanOptions = { isPublic: (token: string) => ctx.store.event(token) !== null };
  function guardAgainstSecrets(...texts: string[]): void {
    for (const text of texts) {
      const finding = findSecrets(text, scanOptions)[0];
      if (finding) throw new HttpError(422, `That looks like a ${finding.kind}. ${SECRET_REDIRECT}`);
    }
  }

  const fullNode = (ref: string): Device => {
    const node = resolveNode(ref);
    if (!isFullNode(node)) throw new HttpError(400, `${ref} is not a full node, so it can't run loops`);
    return node;
  };

  /** Where a new loop runs if you don't say: quests by a sandbox host, the rest on an always-on node. */
  function defaultRunner(task: LoopTask): Device {
    if (task.kind === "quest") return ctx.sandbox ? ctx.store.device(ctx.identity.id)! : placeSandbox();
    if (isAlwaysOn(ctx.caps())) return ctx.store.device(ctx.identity.id)!;
    const server = ctx.store.devices().find((d) => isFullNode(d) && isAlwaysOn(d.profile?.caps as Partial<Capabilities> | undefined));
    return server ?? ctx.store.device(ctx.identity.id)!;
  }

  function loopViews(): LoopView[] {
    const now = Date.now();
    return loopRecords(ctx.store).map((loop) => {
      const last = ctx.store.loopRuns(loop.name, 1)[0];
      const since = Math.max(ctx.store.lastSlot(loop.name, loop.on) ?? Number.NEGATIVE_INFINITY, loop.updatedAt);
      return {
        name: loop.name,
        schedule: loop.scheduleText,
        tz: loop.tz,
        on: loop.on,
        onName: ctx.store.device(loop.on)?.name ?? null,
        enabled: loop.enabled,
        task: loop.task,
        problem: loop.problem,
        label: loop.label,
        updatedAt: loop.updatedHlc,
        next: loop.enabled && loop.schedule ? nextRun(loop.schedule, Number.isFinite(since) ? since : now, loop.tz) : null,
        last: last ? runView(last) : null,
        running: loop.on === ctx.identity.id ? ctx.loops.isRunning(loop.name) : null,
      };
    });
  }

  function connectorViews(): ConnectorView[] {
    const installed = new Map(installedConnectors(ctx.store).map((c) => [c.id, c]));
    const ids = [...new Set([...installed.keys(), ...Object.keys(CATALOG)])].sort();
    return ids.map((id) => {
      const mine = installed.get(id);
      const catalog = Object.hasOwn(CATALOG, id) ? CATALOG[id] : undefined;
      const manifest = mine?.manifest ?? catalog?.manifest ?? null;
      const tools = Object.entries(manifest?.tools ?? {}).map(([name, tool]) => ({
        name,
        description: tool.description,
        method: isMcpTool(tool) ? "MCP" : tool.method,
        path: isMcpTool(tool) ? null : tool.path,
        class: tool.class,
        asks: tool.class === "outward" || tool.class === "delete",
        params: Object.fromEntries(
          Object.entries(tool.params ?? {}).map(([pname, param]) => [
            pname,
            {
              type: param.type,
              required: !!param.required || (!isMcpTool(tool) && tool.path.includes(`{${pname}}`)),
              description: param.description ?? null,
              enum: param.enum ?? null,
            },
          ]),
        ),
        ...(isMcpTool(tool) ? { remote: tool.remote, hints: tool.hints ?? null } : {}),
      }));
      return {
        id,
        label: manifest?.label ?? id,
        description: manifest?.description ?? null,
        kind: manifest?.mcp ? ("mcp" as const) : ("http" as const),
        url: manifest?.mcp ? `${manifest.origin}${manifest.mcp.path}` : null,
        origin: manifest?.origin ?? null,
        installed: !!mine,
        key: mine?.manifest ? keyState(ctx.vault, mine.manifest) : manifest?.auth ? "missing" : "none-needed",
        secret: manifest?.auth?.secret ?? null,
        keyHelp: catalog?.keyHelp ?? null,
        needsOrigin: !!catalog?.needsOrigin,
        problem: mine?.problem ?? null,
        tools,
      };
    });
  }

  /** The runs that recorded their settings (their effort). */
  function trialRuns(): TrialRunsView {
    const runs: TrialRunsView = {};
    for (const entry of ctx.store.lwwPrefix<{ run: string; settings: unknown }>("trial-run:")) {
      const settings = TrialRunSettings.safeParse(entry.value!.settings);
      if (settings.success) runs[entry.value!.run] = settings.data;
    }
    return runs;
  }

  /** Where an attempt's call takes its helper: planning at the council, working at the forge, reviewed at the observatory. */
  const attemptStation = (role: string): Station => (role === "planner" ? "council" : role === "reviewer" ? "observatory" : "forge");

  function trialViews(): TrialView[] {
    return ctx.store
      .lwwPrefix<TrialRecord & { id: string }>("trial:")
      .map((entry) => ({ ...entry.value!, recordedAt: Number(entry.hlc.split(".")[0]), nodeName: ctx.store.device(entry.device)?.name ?? entry.device.slice(0, 12) }))
      .sort((a, b) => b.recordedAt - a.recordedAt);
  }

  function investigationViews(): InvestigationView[] {
    return ctx.store
      .lwwPrefix<{ id: string; question: string; registration: unknown }>("investigation:")
      .map((entry) => {
        const body = entry.value!;
        const result = ctx.store.lww<{
          status: InvestigationView["status"];
          conclusion?: InvestigationView["conclusion"];
          summary: string;
          review?: string;
          artifact?: string;
          predictions?: InvestigationView["predictions"];
        }>(`investigation-result:${body.id}`);
        const registration = Preregistration.safeParse(body.registration);
        return {
          id: body.id,
          question: body.question,
          registration: registration.success ? registration.data : null,
          registeredAt: Number(entry.hlc.split(".")[0]),
          nodeName: ctx.store.device(entry.device)?.name ?? entry.device.slice(0, 12),
          status: result?.value?.status ?? "running",
          conclusion: result?.value?.conclusion ?? null,
          summary: result?.value?.summary ?? null,
          review: result?.value?.review ?? null,
          artifact: result?.value?.artifact ?? null,
          predictions: result?.value?.predictions ?? [],
          concludedAt: result ? Number(result.hlc.split(".")[0]) : null,
        };
      })
      .sort((a, b) => b.registeredAt - a.registeredAt);
  }

  function noticeViews(): NoticeView[] {
    const rank = { alert: 0, warn: 1, info: 2 } as const;
    return ctx.store
      .lwwPrefix<NoticeView & { node?: string }>("notice:")
      .map((entry) => {
        const n = entry.value!;
        return { key: n.key, severity: n.severity, title: n.title, body: n.body, source: n.source, node: n.node ?? null, at: n.at, dismissed: !!n.dismissed };
      })
      .sort((a, b) => rank[a.severity] - rank[b.severity] || b.at - a.at);
  }

  const connectorErrors = async <T>(work: () => Promise<T> | T): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      if (error instanceof ConnectorCallError) throw new HttpError(error.status, error.message);
      throw error;
    }
  };

  type ChatInput = z.infer<NonNullable<(typeof routes)["chat"]["input"]>>;

  /**
   * Everything an answer needs before it starts, for whoever asks (the chat route, and a queued message when
   * its turn comes): the secret check on every message, whose chat it is and whether they may keep one, the
   * kept history that leads, the project, the memories. Nothing here depends on who's listening.
   */
  function prepareAnswer(input: ChatInput, p: Principal) {
    // Every message goes to a provider, whoever "said" it, so all of them are scanned.
    guardAgainstSecrets(...input.messages.map((m) => m.content));
    const { tools: wantTools, save, conversation: continued, project: projectId, retry, archive: wantArchive, attempt, ...request } = input;
    const asked = request.messages.at(-1)!;
    // Kept chats are yours alone: an agent (or a quest) never writes into your history.
    if ((save || continued) && !isOwner(p)) throw new HttpError(403, "only you keep chats");
    let kept: ConversationSummary | null = null;
    let messages = request.messages;
    if (continued) {
      kept = ctx.chats.summary(continued);
      if (!kept || !visibleTo(kept, p)) throw new HttpError(404, "no such conversation");
      if (asked.role !== "user") throw new HttpError(400, "the last message must be yours");
      if (retry) ctx.chats.dropLastExchange(kept.id);
      // The kept conversation leads: what the model sees is what's stored, then your new question.
      messages = [...ctx.chats.history(kept.id), asked];
    }
    const projectOf = kept?.project ?? projectId ?? null;
    const project = projectOf ? projectsView().find((x) => x.id === projectOf) : undefined;
    if (projectId && !project) throw new HttpError(404, `no project ${projectId}`);
    if (save && !kept) {
      kept = ctx.chats.create({ title: titleFrom(request.messages.find((m) => m.role === "user")?.content ?? ""), project: projectOf, role: request.role ?? "planner" });
      // A conversation started elsewhere (a temporary chat you now keep) brings what was said before.
      for (const m of request.messages.slice(0, -1)) {
        if (m.role === "user") ctx.chats.addUser(kept.id, m.content);
        else ctx.chats.finishAnswer(kept.id, ctx.chats.startAnswer(kept.id), { content: m.content, model: null, steps: [], status: "done", error: null, bank: false });
      }
    }
    const known = [project ? projectContext(project) : null, asked.role === "user" ? memoryContext(asked.content) : null].filter(Boolean).join("\n\n") || undefined;
    // The archive's most relevant entries, fenced as data: with tools by default; quests ask for it at their start.
    const fromArchive = (wantArchive ?? wantTools !== false) && asked.role === "user";
    return { request, wantTools, kept, messages, asked, project, known, fromArchive, attempt };
  }

  /** His tools' way into the node, noting what a turn leaves waiting on you: approvals it filed, keys it asked for. */
  function noting(api: ToolApi, waits: TurnSpec["waits"]): ToolApi {
    return {
      ...api,
      async call<T>(name: RouteName, input?: unknown): Promise<T> {
        const result = await api.call<T>(name, input);
        const filed = result as { status?: unknown; action?: unknown } | null;
        if (name === "callConnector" && filed?.status === "asked" && typeof filed.action === "string") waits.actions.push(filed.action);
        const wanted = input as { name?: unknown } | null;
        if (name === "requestSecret" && typeof wanted?.name === "string") waits.secrets.push(wanted.name);
        return result;
      },
    };
  }

  /**
   * A turn of yours, ready for the hub to run: the same answer as ever (his tools within what you may do, as
   * the agent he is, the bank's rules in them, his slot, the archive, the world), on the turn's own signal
   * instead of a request's, so nothing about it depends on a connection.
   */
  function turnSpec(ready: ReturnType<typeof prepareAnswer>, p: Principal): TurnSpec {
    const { request, messages, asked, project, known, fromArchive, kept } = ready;
    const agent = galahadFor(p);
    const role = request.role ?? "planner";
    const waits: TurnSpec["waits"] = { actions: [], secrets: [] };
    return {
      by: byOf(p),
      // Offered the bank's tools, so the answer may come to hold bank data.
      bank: agent.scopes.includes("bank:read"),
      role,
      conversation: kept ? { id: kept.id, title: kept.title, project: kept.project } : null,
      question: asked.content,
      messages,
      waits,
      run: async function* (steering, signal) {
        // One set of tools for the whole turn: what the bank's rules refuse stays refused after a steer.
        const tools = chatTools(toolsFor(agent.scopes), noting(inProcess(agent, signal), waits), explain, project ? { tag: `project:${project.id}` } : {});
        const shown: AnswerRecord = { content: "", model: null, steps: [], error: null, bank: false };
        const seen = worldWatcher(role, false, shown);
        let leave: (() => void) | null = null;
        let answered: (() => void) | null = null;
        try {
          // Yours, with his tools: it never waits for a slot.
          leave = await ctx.governor.enterModel({ wait: false }, signal);
          answered = ctx.archive.answering();
          let context = known;
          if (fromArchive) {
            const found = await ctx.archive.context(asked.content, { hideKinds: archiveHidden(p) }).catch((error) => {
              ctx.log(`archive context: ${(error as Error).message}`);
              return null;
            });
            if (found) {
              context = [known, found.text].filter(Boolean).join("\n\n");
              const event: ChatStreamEvent = { type: "archive", entries: found.entries };
              keepStep(shown, event);
              yield event;
            }
          }
          for await (const event of chat({ store: ctx.store, vault: ctx.vault }, { ...request, messages, tools, context, signal, steering })) {
            keepStep(shown, event);
            seen(event);
            yield event;
          }
        } finally {
          leave?.();
          answered?.();
          ctx.world.rest();
        }
      },
    };
  }

  /** Whoever queued a message, as they stand now: revoked since, or no longer allowed to chat, and it isn't sent. */
  function askerNow(by: QueuedBy): Principal {
    if (by.kind === "admin") return { device: ctx.identity.id, kind: "admin", scopes: OWNER_SCOPES };
    const device = ctx.store.activeDevice(by.device);
    if (!device || device.kind !== "client") throw new TurnError(403, "the device that queued it is no longer paired", "device");
    if (!device.scopes.includes("chat")) throw new TurnError(403, "the device that queued it may no longer chat", "device");
    return { device: device.id, kind: "client", scopes: device.scopes };
  }

  // A queued message becomes a turn exactly as a message sent now would: checked as input, scanned for
  // secrets, with the scopes its device holds now, in a chat that device may still see.
  ctx.turns.setPrepare((conversation, queued) => {
    const p = askerNow(queued.by);
    const kept = ctx.chats.summary(conversation);
    if (!kept || !visibleTo(kept, p)) throw new TurnError(404, "the chat is gone, or the device that queued it may no longer see it", "device");
    const input = routes.chat.input.parse({ role: queued.role ?? kept.role, conversation, messages: [{ role: "user", content: queued.text }] });
    return turnSpec(prepareAnswer(input, p), p);
  });

  /**
   * A turn as server-sent events: what it is, everything so far, then live, to its end. Whoever was watching
   * going away ends the watching and nothing else.
   */
  function watchTurn(turn: LiveTurn, req: Request, starting = false): Response {
    const encoder = new TextEncoder();
    let leave: () => void = () => {};
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let open = true;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const close = (): void => {
          if (!open) return;
          open = false;
          clearInterval(heartbeat);
          leave();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        };
        const write = (text: string): void => {
          if (!open) return;
          try {
            controller.enqueue(encoder.encode(text));
          } catch {
            close();
          }
        };
        // Long thinking produces no text for a while; comments keep proxies and idle timers awake.
        heartbeat = setInterval(() => write(": keep-alive\n\n"), 15_000);
        req.signal.addEventListener("abort", close);
        const unsubscribe = ctx.turns.subscribe(turn, (event) => (event ? write(`data: ${JSON.stringify(event)}\n\n`) : close()), { starting });
        if (open) leave = unsubscribe;
        else unsubscribe();
      },
      cancel() {
        open = false;
        clearInterval(heartbeat);
        leave();
      },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache", ...SECURITY_HEADERS } });
  }

  /*
   * Side questions: answered from a chat's context without his tools, kept apart (here, in memory, for the
   * device that asked, for half an hour) and part of nothing unless brought back. A few at once, no more.
   */
  interface Aside {
    conversation: string | null;
    turn: string | null;
    by: QueuedBy;
    question: string;
    answer: string;
    model: string | null;
    at: number;
  }
  const asides = new Map<string, Aside>();
  let asidesAnswering = 0;
  const MAX_ASIDES_AT_ONCE = 2;
  const ASIDE_KEEP_MS = 30 * 60_000;

  function askAside(input: { conversation?: string; turn?: string; question: string }, p: Principal, req: Request): Response {
    ownerOnly(p);
    // It goes to a model like any message of yours.
    guardAgainstSecrets(input.question);
    let turn: LiveTurn | null = null;
    let kept: KeptSummary | null = null;
    if (input.turn) {
      turn = watchedTurn(input.turn, p);
      const c = turn.spec.conversation;
      if (c) kept = keptChat(c.id, p);
    } else {
      kept = keptChat(input.conversation!, p);
      // What a turn under way has said is part of the answer's context: asking needs what watching needs.
      const running = ctx.turns.runningIn(kept.id);
      if (running) turn = watchedTurn(running.id, p);
    }
    if (asidesAnswering >= MAX_ASIDES_AT_ONCE) throw new HttpError(429, `This node is already answering ${MAX_ASIDES_AT_ONCE} side questions, its limit. Ask again when one is done.`);
    const working = turn && turn.state === "running" ? ctx.turns.sofar(turn) : null;
    const done = turn && turn.state !== "running" ? ctx.turns.sofar(turn) : null;
    // A kept chat already holds the turn's question and what a steer cut; a temporary one is only what the turn was given.
    const held: ChatMessage[] = kept ? ctx.chats.history(kept.id) : [...turn!.spec.messages, ...(done ? [...done.exchange, ...(done.said.trim() ? [{ role: "assistant" as const, content: done.said }] : [])] : [])];
    const messages = asideMessages(held, working && kept ? { ...working, exchange: [] } : working, input.question);
    const role = turn?.spec.role ?? kept?.role ?? "planner";
    const id = `as_${randomId(16)}`;
    const by = byOf(p);
    const encoder = new TextEncoder();
    asidesAnswering += 1;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let open = true;
        const send = (event: ChatStreamEvent): void => {
          if (!open) return;
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          } catch {
            open = false;
          }
        };
        let answer = "";
        let model: string | null = null;
        let failed = false;
        let leave: (() => void) | null = null;
        send({ type: "aside", id });
        try {
          leave = await ctx.governor.enterModel({ wait: false }, req.signal);
          // No tools: answering a side question can do nothing, whatever it's asked.
          for await (const event of chat({ store: ctx.store, vault: ctx.vault }, { role, messages, signal: req.signal })) {
            if (event.type === "text") answer += event.text;
            else if (event.type === "model" || event.type === "done") model = event.ref;
            else if (event.type === "error") failed = true;
            send(event);
          }
        } catch (error) {
          failed = true;
          send({ type: "error", error: redact(String((error as Error).message ?? error)).slice(0, 500) });
        } finally {
          leave?.();
          asidesAnswering -= 1;
        }
        // Kept only when it was answered whole, for the device that asked.
        if (!failed && !req.signal.aborted && answer.trim()) {
          asides.set(id, { conversation: kept?.id ?? null, turn: turn?.id ?? null, by, question: input.question, answer, model, at: Date.now() });
          while (asides.size > 50) asides.delete(asides.keys().next().value!);
        }
        if (open) controller.close();
      },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache", ...SECURITY_HEADERS } });
  }

  function bringBack(id: string, p: Principal): { how: "steered" | "kept" } {
    ownerOnly(p);
    const aside = asides.get(id);
    if (!aside || !sameAsker(aside.by, p) || Date.now() - aside.at > ASIDE_KEEP_MS) {
      throw new HttpError(404, "That side question is gone (one is kept for half an hour, for the device that asked it). Ask it again, or put it in a message.");
    }
    // Brought back, it is your message to him, checked like one.
    const text = broughtBack(aside.question, aside.answer);
    guardAgainstSecrets(text);
    const live = aside.conversation ? ctx.turns.runningIn(aside.conversation) : aside.turn ? ctx.turns.get(aside.turn) : null;
    if (live && live.state === "running") {
      watchedTurn(live.id, p);
      try {
        ctx.turns.steer(live.id, text, byOf(p));
        asides.delete(id);
        return { how: "steered" };
      } catch (error) {
        // He finished in the meantime: it joins the chat instead (below), if there is one.
        if (!(error instanceof TurnError && error.status === 409)) throw error instanceof TurnError ? new HttpError(error.status, error.message) : error;
      }
    }
    if (!aside.conversation) throw new HttpError(409, "That temporary chat's turn has ended. Put the answer in your next message if you want him to have it.");
    const kept = keptChat(aside.conversation, p);
    if (ctx.turns.runningIn(kept.id)) throw new HttpError(409, "He has just started working in that chat again. Try once more: it will steer him.");
    ctx.chats.addUser(kept.id, aside.question);
    ctx.chats.finishAnswer(kept.id, ctx.chats.startAnswer(kept.id), { content: aside.answer, model: aside.model, steps: aside.model ? [{ kind: "model", ref: aside.model }] : [], status: "done", error: null, bank: false });
    asides.delete(id);
    return { how: "kept" };
  }

  type Handler = (input: any, principal: Principal, req: Request) => unknown;
  const handlers: Record<RouteName, Handler> = {
    whoami: (_input, p) => ({
      device: p.device,
      kind: p.kind,
      scopes: p.scopes,
      node: ctx.identity.id,
      nodeName: ctx.nodeName,
      fleet: ctx.store.fleet,
      fleetName: ctx.store.genesis?.name ?? null,
    }),
    fleet: () => fleetView(),
    recall: (input) => ({ memories: ctx.store.recall(input.q, input.limit ?? 50) }),
    remember: (input, p) => {
      guardAgainstSecrets(input.text, ...(input.tags ?? []));
      // Only you write "owner" memories. Agents write "agent" ones; anything from outside is "untrusted".
      const trust = input.untrusted ? "untrusted" : p.kind === "arm" ? "agent" : "owner";
      const event = ctx.store.remember(ctx.identity, input.text, {
        tags: input.tags,
        prov: {
          trust,
          ...(p.kind === "client" ? { via: p.device } : {}),
          ...(p.kind === "arm" ? { source: p.device } : {}),
        },
      });
      return { id: event.id, trust };
    },
    forget: (input, p) => {
      // An agent may forget only what it wrote itself; your memories are yours to delete.
      if (p.kind === "arm" && ctx.store.event(input.id)?.prov?.source !== p.device) {
        throw new HttpError(403, "agents may only forget memories they wrote themselves");
      }
      ctx.store.emit(ctx.identity, "memory.forgotten", { memory: input.id });
      return { ok: true };
    },
    secrets: () => ({ secrets: ctx.vault.list().map(secretView), unlocked: ctx.vault.unlocked() }),
    setSecret: (input) => {
      // Pin the key to an origin taken from what you entered with it, or the built-in
      // preset. Never from a provider record, which someone else may have repointed.
      const known = input.provider ? preset(input.provider) : undefined;
      // A key for a connector (named, or filling a request the connector filed) is pinned to the connector's origin.
      const connectorId: string | undefined =
        input.connector ??
        (input.provider && !known && !providerRecord(ctx.store, input.provider) && (Object.hasOwn(CATALOG, input.provider) || installedConnector(ctx.store, input.provider))
          ? input.provider
          : undefined);
      if (connectorId) {
        const catalog = Object.hasOwn(CATALOG, connectorId) ? CATALOG[connectorId] : undefined;
        const pinned = input.baseUrl
          ? originOf(input.baseUrl)
          : catalog?.manifest.origin && !catalog.needsOrigin
            ? catalog.manifest.origin // built-in (constant)
            : (installedConnector(ctx.store, connectorId)?.origin ?? null);
        if (!pinned) throw new HttpError(400, `install the ${connectorId} connector first: its origin is where this key may go`);
        const info = ctx.vault.set(input.name, input.value, { provider: connectorId, label: input.label, origin: pinned });
        return { secret: secretView(info) };
      }
      let origin: string | null = null;
      if (input.baseUrl) origin = originOf(input.baseUrl); // typed by you, next to the key
      else if (known?.baseUrl) origin = originOf(known.baseUrl); // built-in preset (constant)
      else if (input.provider && !known) origin = originOf(providerRecord(ctx.store, input.provider)?.baseUrl ?? ""); // custom provider
      // A preset without a URL (e.g. Verda) stays unpinned, and therefore unused, until re-added with --base-url.
      const info = ctx.vault.set(input.name, input.value, { provider: input.provider, label: input.label, ...(origin ? { origin } : {}) });
      return { secret: secretView(info) };
    },
    deleteSecret: (input) => {
      ctx.vault.delete(input.name);
      return { ok: true };
    },
    secretRequests: () => ({
      requests: ctx.vault.requests().map((r) => ({
        name: r.name,
        provider: r.provider,
        purpose: r.purpose,
        requestedAt: r.hlc,
        requestedBy: r.device,
      })),
    }),
    requestSecret: (input) => {
      guardAgainstSecrets(input.purpose);
      ctx.vault.request(input.name, input.purpose, input.provider);
      return { ok: true };
    },
    rotateVault: () => ctx.vault.rotate(),
    providers: () => ({ providers: providerViews(ctx.store, ctx.vault), presets: PRESETS }),
    setProvider: (input) => {
      // Provider records replicate in plaintext: a key pasted into a URL or label must never land there.
      guardAgainstSecrets(input.baseUrl ?? "", input.label ?? "");
      const base = preset(input.preset ?? input.id);
      const kind = input.kind ?? base?.kind;
      const baseUrl = input.baseUrl ?? base?.baseUrl;
      if (!kind || !baseUrl) throw new HttpError(400, `provide kind and baseUrl (no usable preset for "${input.id}")`);
      ctx.store.emit(ctx.identity, "provider.set", {
        id: input.id,
        kind,
        baseUrl: baseUrl.replace(/\/$/, ""),
        ...(input.secret ? { secret: input.secret } : {}),
        ...(input.label ? { label: input.label } : {}),
      });
      return { providers: providerViews(ctx.store, ctx.vault) };
    },
    removeProvider: (input) => {
      ctx.store.emit(ctx.identity, "provider.removed", { id: input.id });
      return { ok: true };
    },
    providerModels: async (input) => {
      const provider = resolveProvider(ctx.store, ctx.vault, input.id);
      if (!provider) throw new HttpError(404, `provider ${input.id} is not configured`);
      return { models: await listModels(provider) };
    },
    roster: () => ({ roster: roster(ctx.store) }),
    setRoster: (input) => {
      for (const ref of input.models) parseRef(ref);
      ctx.store.emit(ctx.identity, "roster.set", { role: input.role, models: input.models });
      return { roster: roster(ctx.store) };
    },
    chat: (input, p, req) => {
      const asked = input as ChatInput;
      // Your own chat, with his tools, is a turn the node owns: it runs to its end whoever is listening. A quest's
      // or an agent's call (and yours without tools: a quest you run) lives and ends with its request, as ever.
      const owned = isOwner(p) && asked.tools !== false && !asked.attempt;
      // Asked before anything is written: one turn a chat, so many on the node.
      if (owned) turnErrors(() => ctx.turns.admit(asked.conversation ?? null));
      else if (asked.conversation && ctx.turns.runningIn(asked.conversation)) throw new HttpError(409, "he's still working in that chat");
      const ready = prepareAnswer(asked, p);
      if (owned) return watchTurn(turnErrors(() => ctx.turns.start(turnSpec(ready, p))), req, true);

      const { request, wantTools, kept, messages, project, known, fromArchive, attempt } = ready;
      // One of several attempts at a quest: a helper's call, shown as the helper's (he stays where he leads them from).
      const helper = attempt && ctx.compute.isHelper(attempt) ? attempt : null;
      // The same Galahad on every surface: his tools, within what the caller may do.
      const agent = galahadFor(p);
      const tools = wantTools === false ? undefined : chatTools(toolsFor(agent.scopes), inProcess(agent, req.signal), explain, project ? { tag: `project:${project.id}` } : {});
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          let open = true;
          const write = (text: string) => {
            if (!open) return;
            try {
              controller.enqueue(encoder.encode(text));
            } catch {
              open = false; // the client went away; the answer still finishes and is kept
            }
          };
          const send = (event: ChatStreamEvent) => write(`data: ${JSON.stringify(event)}\n\n`);
          // Long thinking produces no text for a while; comments keep proxies and idle timers awake.
          const heartbeat = setInterval(() => write(": keep-alive\n\n"), 15_000);
          req.signal.addEventListener("abort", () => clearInterval(heartbeat));
          const answer: AnswerRecord = { content: "", model: null, steps: [], error: null, bank: false };
          let answerId: number | null = null;
          if (kept) {
            ctx.chats.addUser(kept.id, ready.asked.content);
            answerId = ctx.chats.startAnswer(kept.id);
            send({ type: "conversation", id: kept.id, title: kept.title, project: kept.project });
          }
          const seen = helper ? (event: ChatStreamEvent) => void (event.type === "model" && ctx.compute.attemptModel(helper, event.ref)) : worldWatcher(request.role ?? "planner", wantTools === false, answer);
          let context = known;
          // A model call takes a slot. Yours, with his tools, never waits; a quest's or an agent's waits its turn.
          let leave: (() => void) | null = null;
          let attemptEnded: (() => void) | null = null;
          // Background archiving waits while an answer streams (not while a call only waits for its slot).
          let answered: (() => void) | null = null;
          try {
            leave = await ctx.governor.enterModel({ wait: !(isOwner(p) && wantTools !== false) }, req.signal);
            answered = ctx.archive.answering();
            if (attempt) attemptEnded = ctx.compute.attemptBegin(attempt, { station: attemptStation(request.role ?? "planner"), doing: `The ${request.role ?? "planner"} is thinking` });
            if (fromArchive) {
              const found = await ctx.archive.context(ready.asked.content, { hideKinds: archiveHidden(p) }).catch((error) => {
                ctx.log(`archive context: ${(error as Error).message}`);
                return null;
              });
              if (found) {
                context = [known, found.text].filter(Boolean).join("\n\n");
                const event: ChatStreamEvent = { type: "archive", entries: found.entries };
                keepStep(answer, event);
                send(event);
              }
            }
            for await (const event of chat({ store: ctx.store, vault: ctx.vault }, { ...request, messages, tools, context, signal: req.signal })) {
              keepStep(answer, event);
              seen(event);
              send(event);
            }
          } catch (error) {
            answer.error = String((error as Error).message ?? error);
            send({ type: "error", error: answer.error });
          } finally {
            leave?.();
            attemptEnded?.();
            answered?.();
            if (!helper) ctx.world.rest();
            clearInterval(heartbeat);
            if (kept && answerId !== null) {
              const status = answer.error ? "error" : req.signal.aborted ? "stopped" : "done";
              ctx.chats.finishAnswer(kept.id, answerId, { ...answer, status });
            }
          }
          if (open) controller.close();
        },
      });
      return new Response(stream, {
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache", ...SECURITY_HEADERS },
      });
    },
    conversations: (_input, p) => {
      ownerOnly(p);
      const needsOf = needsResolver();
      return { conversations: ctx.chats.list().filter((c) => visibleTo(c, p)).map((c) => chatSummary(c, needsOf)) };
    },
    conversation: (input, p) => {
      ownerOnly(p);
      const conversation = ctx.chats.get(input.id);
      if (!conversation || !visibleTo(conversation, p)) throw new HttpError(404, "no such conversation");
      const { messages, ...kept } = conversation;
      const running = ctx.turns.runningIn(kept.id);
      const view: ConversationView = { ...chatSummary(kept), messages, turn: running ? turnView(running, p) : null, queue: queueView(kept.id).queue };
      return { conversation: view };
    },
    updateConversation: (input, p) => {
      keptChat(input.id, p);
      if (input.project && !projectsView().some((x) => x.id === input.project)) throw new HttpError(404, `no project ${input.project}`);
      if (input.title) guardAgainstSecrets(input.title);
      const updated = ctx.chats.update(input.id, input);
      return { conversation: updated ? chatSummary(updated) : null };
    },
    deleteConversation: (input, p) => {
      keptChat(input.id, p);
      // What he's doing in it stops with it; what was queued behind it goes with it.
      const running = ctx.turns.runningIn(input.id);
      if (running) ctx.turns.stop(running.id);
      return { deleted: ctx.chats.delete(input.id) };
    },
    // ---------- turns the node owns: watch, stop, steer; your queue behind a chat ----------
    turns: (_input, p) => {
      ownerOnly(p);
      return {
        turns: ctx.turns
          .running()
          .filter((turn) => knowsTurn(turn, p))
          .map((turn) => turnView(turn, p)),
        limits: ctx.turns.limits(),
      };
    },
    attachTurn: (input, p, req) => watchTurn(watchedTurn(input.turn, p), req),
    stopTurn: (input, p) => {
      ownerOnly(p);
      // Stopping is yours from any device that knows of the turn, even one that may not watch it.
      const turn = ctx.turns.get(input.turn);
      if (!turn || !knowsTurn(turn, p)) throw new HttpError(404, "no such turn here (one that ended a while ago is in its chat)");
      return { stopped: ctx.turns.stop(turn.id, "you"), state: turn.state };
    },
    steerTurn: (input, p) => {
      const turn = watchedTurn(input.turn, p);
      // Your message, like any other: nothing credential-shaped goes to a model.
      guardAgainstSecrets(input.text);
      turnErrors(() => ctx.turns.steer(turn.id, input.text, byOf(p)));
      return { steered: true, waiting: turnView(turn, p).steering };
    },
    queueMessage: (input, p) => {
      const kept = keptChat(input.conversation, p);
      // Kept on the node until its turn, and then sent to a model: nothing credential-shaped.
      guardAgainstSecrets(input.text);
      const { started } = turnErrors(() => ctx.turns.enqueue(kept.id, { text: input.text, role: input.role ?? null, by: byOf(p) }));
      return { ...queueView(kept.id), started: started ? turnView(started, p) : null };
    },
    editQueued: (input, p) => {
      const kept = keptChat(input.conversation, p);
      guardAgainstSecrets(input.text);
      // Rewritten, it is the rewriter's message: it will run with what this device may do, not what the first one could.
      if (!ctx.chats.queueEdit(kept.id, input.id, input.text, byOf(p))) throw new HttpError(404, "that message is no longer queued (it may have been sent)");
      return queueView(kept.id);
    },
    removeQueued: (input, p) => {
      const kept = keptChat(input.conversation, p);
      if (input.id === undefined) ctx.chats.queueClear(kept.id);
      else if (!ctx.chats.queueTake(kept.id, input.id)) throw new HttpError(404, "that message is no longer queued (it may have been sent)");
      return queueView(kept.id);
    },
    sendQueued: (input, p) => {
      const kept = keptChat(input.conversation, p);
      const running = ctx.turns.runningIn(kept.id);
      // Steering needs what watching needs: a turn that may read the bank isn't steered from a device that may not.
      if (running) watchedTurn(running.id, p);
      const sent = turnErrors(() => ctx.turns.sendNow(kept.id, input.id, byOf(p)));
      return { how: sent.how, turn: turnView(sent.turn, p), ...queueView(kept.id) };
    },
    resumeQueue: (input, p) => {
      const kept = keptChat(input.conversation, p);
      ctx.turns.resume(kept.id);
      const running = ctx.turns.runningIn(kept.id);
      return { ...queueView(kept.id), turn: running ? turnView(running, p) : null };
    },
    askAside: (input, p, req) => askAside(input, p, req),
    bringBack: (input, p) => bringBack(input.aside, p),
    // ---------- quests in hand: where each stands, as whoever runs it says ----------
    quests: () => ({ quests: ctx.quests.list() }),
    questProgress: (input, p) => {
      // Each reporter's quests are its own: an agent's or a loop's report never writes over yours.
      // (An agent that may read the bank: the world draws its quest's shape, never its words. world-quest.ts.)
      ctx.quests.report(p.kind === "arm" ? p.label! : p.kind === "node" ? (ctx.store.device(p.device)?.name ?? "a node") : "you", input, { bank: p.kind === "arm" && p.scopes.includes("bank:read") });
      return { ok: true };
    },
    projects: () => ({ projects: projectsView() }),
    worldReport: (input, p) => {
      ownerOnly(p);
      ctx.world.report(input, ctx.store.device(p.device)?.name ?? (p.kind === "admin" ? "a terminal" : p.device));
      return { ok: true };
    },
    worldReports: (_input, p) => {
      ownerOnly(p);
      return { reports: ctx.world.reportsView() };
    },
    // ---------- saved experiments (node-local: what this node's world showed) ----------
    experiments: () => {
      if (!ctx.world.store) throw new HttpError(424, "this node doesn't keep experiments");
      return { node: ctx.nodeName, ...ctx.world.store.listing() };
    },
    experiment: (input) => {
      const store = ctx.world.store;
      const experiment = store?.get(input.id);
      if (!store || !experiment) throw new HttpError(404, `no saved experiment ${input.id} on ${ctx.nodeName}`);
      return { experiment, examination: store.examination(input.id), ...(input.code ? { code: store.code(input.id) } : {}) };
    },
    experimentRecording: (input) => {
      const page = ctx.world.store?.recording(input.id, input.from ?? 0, input.limit ?? 2000, input.hz);
      if (!page) throw new HttpError(404, `no saved experiment ${input.id} on ${ctx.nodeName}`);
      return page;
    },
    pinExperiment: (input, p) => {
      if (!isOwner(p)) throw new HttpError(403, "only you pin saved experiments");
      return experimentErrors(() => ({ experiment: ctx.world.store!.pin(input.id, input.pinned) }));
    },
    deleteExperiment: (input, p) => {
      // Deleting kept work is yours to decide (fleet:admin, which agents can never hold).
      if (!isOwner(p)) throw new HttpError(403, "only you delete saved experiments");
      return experimentErrors(() => {
        if (!ctx.world.store!.remove(input.id)) throw new HttpError(404, `no saved experiment ${input.id} on ${ctx.nodeName}`);
        return { deleted: true };
      });
    },
    runExperiment: (input, p) => {
      const { on, quest: relayed, ...rest } = input;
      // An arm's sandboxes all belong to its own quest (Galahad's own, in chat, too); a node relays the arm's.
      const quest = p.kind === "arm" ? armQuest(p.label!) : p.kind === "node" ? relayed : undefined;
      return longRunning(
        onNode(p, on, routes.runExperiment.path, { ...rest, ...(quest ? { quest } : {}) }, async () => {
          try {
            return await runExperiment({ sandbox: ctx.sandbox!, world: ctx.world, nodeName: ctx.nodeName, log: ctx.log }, rest, quest ? { quest } : {});
          } catch (error) {
            if (error instanceof RunError) throw new HttpError(error.status, error.message);
            throw error;
          }
        }),
      );
    },
    world: (_input, p, req) => {
      // Yours alone: it carries what Galahad is thinking about in your chats.
      ownerOnly(p);
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          let open = true;
          const write = (text: string) => {
            if (!open) return;
            try {
              controller.enqueue(encoder.encode(text));
            } catch {
              open = false;
            }
          };
          const send = (event: WorldEvent) => write(`data: ${JSON.stringify(event)}\n\n`);
          send(ctx.world.hello());
          const stop = ctx.world.watch(send);
          // A page that draws the world can render his eyes (eyes.ts): it says so when it opens the stream.
          const blind = new URL(req.url).searchParams.get("eyes") === "1" ? ctx.world.watchEyes(send) : null;
          const heartbeat = setInterval(() => write(": keep-alive\n\n"), 15_000);
          const end = () => {
            stop();
            blind?.();
            clearInterval(heartbeat);
            if (open) {
              open = false;
              try {
                controller.close();
              } catch {
                /* already closed */
              }
            }
          };
          req.signal.addEventListener("abort", end);
          if (ctx.shutdown?.aborted) end();
          else ctx.shutdown?.addEventListener("abort", end);
        },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache", ...SECURITY_HEADERS } });
    },
    // ---------- his eyes: what he sees, in words and (when a page can render it) a picture; his review of his world ----------
    look: (input) => eyesErrors(() => ctx.eyes.look(input)),
    worldEyes: (input, p) => {
      // A frame is a rendering made on one of your own devices: nothing else answers for his eyes.
      if (!isOwner(p)) throw new HttpError(403, "only your own devices answer for his eyes");
      const frame = eyesErrors(() => ctx.eyes.answer(input, deviceName(p) ?? "a paired device"));
      return { kept: frame.id, at: frame.at };
    },
    worldReviewStatus: () => ctx.review.state.status(),
    worldReview: (input, p, req) => {
      // It spends the day's budget on a model and files suggestions: yours to start (a loop you set up runs it in the node).
      if (!isOwner(p)) throw new HttpError(403, "only you ask him to review his world");
      return longRunning(ctx.review.run(input.places, req.signal));
    },
    setReviewBudget: (input, p) => {
      if (!isOwner(p)) throw new HttpError(403, "only you set the review's budget");
      return ctx.review.state.setBudget(input.budget);
    },
    // ---------- the chalkboard: you draw, Galahad and your agents write, and only you erase your drawing ----------
    board: () => ctx.board.view(),
    boardSnapshot: () => {
      const shot = ctx.board.snapshot();
      if (!shot) throw new HttpError(404, "there's no picture of the board yet: one is taken when the owner draws on it");
      return new Response(shot.png, { headers: { "content-type": "image/png", "content-length": String(shot.png.length), "cache-control": "no-store", "content-security-policy": "sandbox; default-src 'none'", ...SECURITY_HEADERS } });
    },
    boardDraw: (input, p) => {
      if (!isOwner(p)) throw new HttpError(403, "only the owner draws on the board");
      return ctx.board.draw(input.strokes, input.snapshot ? new Uint8Array(Buffer.from(input.snapshot, "base64")) : undefined, deviceName(p));
    },
    boardWrite: (input, p) => {
      const owner = isOwner(p);
      if (!owner && p.kind !== "arm") throw new HttpError(403, "only you and your agents write on the board");
      // Every agent that may read the mind reads the board: nothing credential-shaped goes on it.
      const item = input.item as Record<string, unknown> & { series?: { name: string }[] };
      guardAgainstSecrets(...[item.text, item.title, item.xLabel, item.yLabel, ...(item.series ?? []).map((s) => s.name)].filter((t): t is string => typeof t === "string"));
      return { item: ctx.board.write(input, owner ? "owner" : p.label!, owner, deviceName(p)) };
    },
    boardErase: (input, p) => ({ erased: ctx.board.erase(input, { owner: isOwner(p), by: p.label ?? p.device, device: deviceName(p) }) }),
    boardClear: (_input, p) => {
      if (!isOwner(p)) throw new HttpError(403, "only the owner clears the board");
      ctx.board.clear(deviceName(p));
      return { version: ctx.board.version };
    },
    // Its history: every version kept; read by what may read the board, restored and forgotten only by you.
    boardHistory: (input) => ctx.board.history.before(input.before ?? null, input.limit ?? 50),
    boardVersion: (input) => {
      const found = boardVersionForArchive(ctx.board, input.version);
      if (!found) throw new HttpError(404, `the board's history has no version ${input.version}`);
      const { image, ...view } = found;
      return view;
    },
    boardVersionPicture: (input) => {
      const picture = ctx.board.history.picture(input.version);
      if (!picture) throw new HttpError(404, `there's no picture of the board at version ${input.version}`);
      return new Response(new Uint8Array(picture.png), {
        headers: { "content-type": "image/png", "x-board-picture-of": String(picture.shows), "cache-control": "no-store", "content-security-policy": "sandbox; default-src 'none'", ...SECURITY_HEADERS },
      });
    },
    boardRestore: (input, p) => {
      if (!isOwner(p)) throw new HttpError(403, "only the owner restores the board");
      return ctx.board.restore(input.version, deviceName(p));
    },
    boardForget: (_input, p) => {
      if (!isOwner(p)) throw new HttpError(403, "only the owner forgets the board's history");
      ctx.board.forgetHistory(deviceName(p));
      return { versions: ctx.board.history.size };
    },
    setProject: (input) => {
      guardAgainstSecrets(input.name, input.instructions ?? "", input.repo ?? "");
      const existing = projectsView().find((x) => x.id === input.id);
      const repo = input.repo === undefined ? existing?.repo : input.repo;
      ctx.store.emit(ctx.identity, "project.set", {
        id: input.id,
        name: input.name,
        instructions: input.instructions ?? existing?.instructions ?? "",
        ...(repo ? { repo } : {}),
      });
      return { project: projectsView().find((x) => x.id === input.id)! };
    },
    removeProject: (input) => {
      if (!projectsView().some((x) => x.id === input.id)) throw new HttpError(404, `no project ${input.id}`);
      ctx.store.emit(ctx.identity, "project.removed", { id: input.id });
      ctx.chats.projectRemoved(input.id);
      return { removed: true };
    },
    createInvite: (input, p) => {
      const scopes: Scope[] | undefined = input.scopes ?? (input.kind === "client" ? CLIENT_DEFAULT_SCOPES : undefined);
      // An invite carries no more than its maker holds, so a paired device can't pair itself a stronger one.
      // (A machine's invite still needs approving at a terminal, where you hold everything.)
      const beyond = input.kind === "client" ? scopes!.filter((s) => !p.scopes.includes(s)) : [];
      if (beyond.length) throw new HttpError(403, `an invite can't carry scopes this device doesn't hold: ${beyond.join(", ")}`);
      return ctx.pairing.createInvite(input.kind, { scopes, origin: input.origin });
    },
    pairings: () => ({ pairings: ctx.pairing.pending() }),
    approvePairing: (input, p) => {
      // A new machine receives the vault. A lost or stolen phone must not be able to
      // add one, so machines are approved from a terminal on an existing node.
      const pending = ctx.pairing.pending().find((r) => r.invite === input.invite && r.device === input.device);
      if (pending?.kind === "node" && p.kind === "client") {
        throw new HttpError(403, "approve new machines from a terminal on an existing node (`galahad pairings`)");
      }
      ctx.pairing.approve(input.invite, input.device);
      return { ok: true };
    },
    rejectPairing: (input) => {
      ctx.pairing.reject(input.invite, input.device);
      return { ok: true };
    },
    revokeDevice: (input) => revokeDevice(ctx.store, ctx.identity, input.device, input.reason ?? "revoked by owner"),
    setDeviceScopes: (input, p) => {
      // Granting permissions is never done from a phone, so a phone can't raise its own.
      if (p.kind === "client" || p.kind === "arm") throw new HttpError(403, "change a device's permissions from a terminal on a node");
      ctx.store.emit(ctx.identity, "device.scoped", { device: input.device, scopes: input.scopes });
      return { device: ctx.store.device(input.device) };
    },
    place: (input) => place(input, candidates()),
    mintToken: (input) => {
      const { token, info } = ctx.tokens.mint(input);
      const base = `http://127.0.0.1:${ctx.port}/gw`;
      return {
        token,
        info,
        env: {
          ANTHROPIC_BASE_URL: `${base}/anthropic`,
          ANTHROPIC_AUTH_TOKEN: token,
          OPENAI_BASE_URL: `${base}/<provider>`,
          OPENAI_API_KEY: token,
        },
      };
    },
    revokeToken: (input) => ({ revoked: ctx.tokens.revoke(input.hash) }),
    ledger: () => ({
      entries: ctx.store.ledger(200).map((e) => ({
        id: e.id,
        hlc: e.hlc,
        device: e.device,
        class: e.body.class,
        resource: e.body.resource,
        target: e.body.target,
        verdict: e.body.verdict,
        reason: e.body.reason ?? null,
        quest: e.body.quest ?? null,
        detail: e.body.detail ?? null,
      })),
    }),
    sandboxes: (input, p) =>
      onNode(p, input.on, routes.sandboxes.path, {}, async () => ({ node: ctx.nodeName, sandboxes: await ctx.sandbox!.list() })),
    createSandbox: (input, p, req) => {
      const { on, attempt, ...request } = input;
      // Model providers only, and only ones this fleet has: the gateway's own scopes were refused by the contract.
      const unknown = ((request.providers ?? []) as string[]).filter((id) => !providerRecord(ctx.store, id));
      if (unknown.length) throw new HttpError(400, `no model provider ${unknown.join(", ")} on this fleet (galahad providers lists them)`);
      // An arm's sandboxes all belong to its own quest and are always ephemeral.
      const scoped = p.kind === "arm" ? { ...request, quest: armQuest(p.label!), persistent: false } : request;
      // Creating may pull an image: long-running.
      // It takes a slot on its host first, and waits for one when the host is full (a caller that goes away leaves the queue).
      return longRunning(
        onNode<{ sandbox: { id: string; node: string } }>(p, on, routes.createSandbox.path, scoped, async () => ({ sandbox: await ctx.sandbox!.create(scoped, { signal: req.signal }) }), { create: true }).then((made) => {
          remember(made.sandbox.id, made.sandbox.node);
          if (attempt) ctx.compute.attemptSandbox(attempt, made.sandbox.id, ctx.store.device(made.sandbox.node)?.name ?? made.sandbox.node);
          return made;
        }),
      );
    },
    execSandbox: (input, p) => {
      const { on, quest: relayed, ...rest } = input;
      const quest = p.kind === "arm" ? armQuest(p.label!) : p.kind === "node" ? relayed : undefined;
      // An attempt's command: its helper is at the forge while it runs.
      const tag = ctx.compute.attemptOf(rest.id);
      const ended = tag ? ctx.compute.attemptBegin(tag, { station: "forge", doing: "Running a command" }) : null;
      return longRunning(
        onNode(
          p,
          on,
          routes.execSandbox.path,
          { ...rest, ...(quest ? { quest } : {}) },
          async () => {
            if (quest) {
              const sandbox = await ctx.sandbox!.get(rest.id);
              if (!sandbox) throw new HttpError(404, "no such sandbox on this node");
              if (sandbox.quest !== quest) throw new HttpError(403, "that sandbox belongs to another quest");
            }
            return ctx.sandbox!.exec(rest.id, rest.cmd, rest.timeoutSec);
          },
          { sandbox: rest.id },
        ).finally(() => ended?.()),
      );
    },
    investigations: () => ({ investigations: investigationViews() }),
    registerInvestigation: (input) => {
      // Recorded before anything runs, with its digest: what was promised can't drift afterwards.
      guardAgainstSecrets(JSON.stringify(input.registration));
      const id = `inv_${randomId(16)}`;
      ctx.store.emit(ctx.identity, "investigation.registered", {
        id,
        question: input.registration.question,
        registration: input.registration as unknown as Record<string, unknown>,
        digest: registrationDigest(input.registration),
      });
      return { id };
    },
    concludeInvestigation: (input) => {
      const registered = ctx.store.lww(`investigation:${input.id}`);
      if (!registered?.value) throw new HttpError(404, "no such investigation");
      if (registered.device !== ctx.identity.id) throw new HttpError(409, "only the node that ran an investigation concludes it");
      if (ctx.store.lww(`investigation-result:${input.id}`)) throw new HttpError(409, "already concluded");
      if (input.status === "done" && !input.conclusion) throw new HttpError(400, "a finished investigation has a conclusion");
      guardAgainstSecrets(`${input.summary}\n${input.review ?? ""}`);
      ctx.store.emit(ctx.identity, "investigation.concluded", {
        id: input.id,
        status: input.status,
        ...(input.conclusion ? { conclusion: input.conclusion } : {}),
        summary: redact(input.summary).slice(0, 4000),
        ...(input.review ? { review: redact(input.review).slice(0, 4000) } : {}),
        ...(input.artifact ? { artifact: input.artifact } : {}),
        ...(input.predictions?.length ? { predictions: input.predictions } : {}),
      });
      return { investigation: investigationViews().find((i) => i.id === input.id) };
    },
    trials: () => ({ trials: trialViews(), runs: trialRuns() }),
    startTrialRun: (input) => {
      ctx.store.emit(ctx.identity, "trial.run", { run: input.run, suite: input.suite, settings: { effort: input.effort, ...(input.parallel ? { parallel: input.parallel } : {}) } });
      return { run: input.run, settings: trialRuns()[input.run] };
    },

    // ---------- compute: what the fleet can carry, and how he spends it ----------
    compute: () => ctx.compute.view(),
    calibrateCompute: (input, p) => {
      // Yours to ask (a node may relay it); a node only ever measures itself.
      if (!isOwner(p) && p.kind !== "node") throw new HttpError(403, "only you ask a node to measure itself");
      const target = p.kind === "node" || !input.on ? null : resolveNode(input.on);
      if (target && target.id !== ctx.identity.id) return forward(target, routes.calibrateCompute.path, {});
      if (!ctx.compute.canMeasure()) throw new HttpError(424, `${ctx.nodeName} can't measure itself here`);
      return longRunning(
        ctx.compute
          .calibrate("asked", p.kind === "node" ? `you, through ${ctx.store.device(p.device)?.name ?? "another node"}` : "you")
          .then((calibration) => ({ node: ctx.nodeName, calibration, capacity: ctx.compute.selfCapacity() })),
      );
    },
    setComputeLimit: (input, p) => {
      // The ceiling is yours alone: never an agent's (they can't hold fleet:admin), never a node's on its own.
      if (!isOwner(p)) throw new HttpError(403, "only you set a node's ceiling");
      const { node: ref, reset, ...given } = input;
      const node = resolveNode(ref);
      const limit = ComputeLimit.parse({ ...(reset ? {} : (ctx.compute.limitOf(node.id) ?? {})), ...given });
      ctx.store.emit(ctx.identity, "compute.limit", { node: node.id, limit: limit as Record<string, unknown> }, p.kind === "client" ? { via: p.device, trust: "owner" } : undefined);
      ctx.ledger?.({
        class: "modify",
        resource: COMPUTE_RESOURCE,
        target: `ceiling:${node.name}`,
        verdict: "approved",
        reason: "you set it",
        detail: Object.keys(limit).length ? Object.entries(limit).map(([k, v]) => `${k} ${v}`).join(" · ") : "back to the defaults",
      });
      // This node measures itself again if its own ceiling's threads changed; another node sees it at its next look.
      if (node.id === ctx.identity.id) ctx.computeUpkeep?.();
      ctx.compute.changed();
      return { node: node.name, limit, capacity: ctx.compute.view().nodes.find((n) => n.id === node.id)?.capacity ?? null };
    },
    setComputePolicy: (input, p) => {
      if (!isOwner(p)) throw new HttpError(403, "only you set how he spends compute");
      const policy = { ...ctx.compute.policy(), ...input };
      ctx.store.emit(ctx.identity, "compute.policy", { policy });
      return { policy: ctx.compute.policy(), budget: { perDay: policy.attemptsPerDay, usedToday: ctx.compute.usedToday() } };
    },
    effort: (input, p) => {
      guardAgainstSecrets(input.label ?? "");
      const owner = isOwner(p);
      const by = owner ? "you" : p.kind === "arm" ? `arm:${p.label}` : `node:${ctx.store.device(p.device)?.name ?? p.device}`;
      // An agent's quests are its own: it can't name (or pre-empt) one of yours.
      const quest = owner ? input.quest : `${p.kind === "arm" ? armQuest(p.label!) : "node"}.${input.quest}`.slice(0, 64);
      const grant = ctx.compute.grant({ quest, effort: input.effort, ...(input.on ? { on: resolveNode(input.on).id } : {}), ...(input.label ? { label: input.label } : {}) }, { by, owner });
      if (grant.attempts > 1) ctx.world.doing("council", `Leading ${grant.attempts} attempts at a quest${input.label ? `: ${input.label}` : ""}`);
      return grant;
    },
    recordTrial: (input) => {
      // Every replica checks this too: verdicts and the score must follow from the numbers.
      const problem = trialProblem(input);
      if (problem) throw new HttpError(400, problem);
      if (input.note) guardAgainstSecrets(input.note);
      const id = `tr_${randomId(16)}`;
      ctx.store.emit(ctx.identity, "trial.scored", { id, ...input, ...(input.note ? { note: redact(input.note).slice(0, 1000) } : {}) });
      return { trial: trialViews().find((t) => t.id === id) };
    },
    bankStatus: () => bankErrors(async () => ctx.bank.status()),
    bankAccounts: () => bankErrors(async () => ctx.bank.accounts()),
    bankBalances: (input) => bankErrors(() => ctx.bank.balances(input)),
    bankTransactions: (input) => bankErrors(() => ctx.bank.transactions(input)),
    // Yours alone: fleet:admin, which agents can never hold.
    bankConnect: () => bankErrors(() => ctx.bank.connect()),
    bankComplete: (input) => bankErrors(() => ctx.bank.complete(input)),
    bankDisconnect: () => bankErrors(() => ctx.bank.disconnect()),
    grantArm: (input) => {
      try {
        return { arm: ctx.arms.grant(input.label, input.add ?? [], input.remove ?? []) };
      } catch (error) {
        throw new HttpError(400, (error as Error).message);
      }
    },
    decide: async (input) => {
      // The state and questions go to a provider, like chat: nothing credential-shaped.
      guardAgainstSecrets(JSON.stringify(input));
      try {
        return await decide({ store: ctx.store, vault: ctx.vault, ...(ctx.fetch ? { fetch: ctx.fetch } : {}) }, input);
      } catch (error) {
        if (error instanceof DecisionError) throw new HttpError(error.status, error.message);
        throw error;
      }
    },
    webSearch: async (input, p) => {
      try {
        const found = await searchWeb(input);
        ctx.ledger?.({ class: "read", resource: "search", target: input.q.slice(0, 200), verdict: "allow", reason: `searched by ${p.kind === "arm" ? `arm:${p.label}` : p.kind}` });
        return found;
      } catch (error) {
        if (error instanceof SearchError) throw new HttpError(error.status, error.message);
        throw error;
      }
    },
    artifacts: () => ({ artifacts: ctx.artifacts.list() }),
    saveArtifact: (input, p) => {
      const { on, quest: relayed, ...rest } = input;
      const quest = p.kind === "arm" ? armQuest(p.label!) : p.kind === "node" ? relayed : undefined;
      return longRunning(
        onNode(p, on, routes.saveArtifact.path, { ...rest, ...(quest ? { quest } : {}) }, async () => {
          const sandbox = await ctx.sandbox!.get(rest.sandbox);
          if (!sandbox) throw new HttpError(404, "no such sandbox on this node");
          // An arm (or a loop's quest) keeps only its own sandboxes' work.
          if (quest && sandbox.quest !== quest) throw new HttpError(403, "that sandbox belongs to another quest");
          try {
            const artifact = await ctx.artifacts.save((id, from, dest, limits) => ctx.sandbox!.collect(id, from, dest, limits), {
              sandbox: rest.sandbox,
              ...(rest.path ? { path: rest.path } : {}),
              ...(rest.label ? { label: rest.label } : {}),
              quest: sandbox.quest,
            });
            return { artifact };
          } catch (error) {
            if (error instanceof ArtifactError) throw new HttpError(error.status, error.message);
            throw error;
          }
        }, { sandbox: rest.sandbox }),
      );
    },
    artifactFile: async (input, p) => {
      const artifact = ctx.artifacts.get(input.id);
      // Any device can fetch any artifact: the files stay where they were kept, so ask that node,
      // signed as this one (it checks the same scope). A forwarded request is never sent on.
      if (artifact && !artifact.here && p.kind !== "node") {
        const holder = ctx.store.activeDevice(artifact.node);
        if (!holder) throw new HttpError(409, `${artifact.nodeName} is gone; its files went with it`);
        return fileFrom(holder, input);
      }
      let file: ReturnType<ArtifactStore["read"]>;
      try {
        file = ctx.artifacts.read(input.id, input.path);
      } catch (error) {
        if (error instanceof ArtifactError) throw new HttpError(error.status, error.message);
        throw error;
      }
      const { type, disposition } = keptFileHeaders(input.path);
      return keptFile(file.bytes, type, disposition, file.bytes.length);
    },
    removeArtifact: async (input, p) => {
      if (p.kind !== "admin" && p.kind !== "client" && p.kind !== "node") throw new HttpError(403, "only you remove kept work");
      const artifact = ctx.artifacts.get(input.id);
      if (!artifact) throw new HttpError(404, "no such artifact");
      if (artifact.here) {
        ctx.artifacts.remove(input.id, p.kind === "client" ? `by ${ctx.store.device(p.device)?.name ?? "a paired device"}` : "by you");
        return { ok: true };
      }
      if (p.kind === "node") throw new HttpError(409, "forwarded requests run where they land");
      const holder = ctx.store.activeDevice(artifact.node);
      if (!holder) throw new HttpError(409, `${artifact.nodeName} is gone; its files went with it`);
      return forward(holder, routes.removeArtifact.path, { id: input.id });
    },
    destroySandbox: (input, p) => {
      // A request from you (CLI or a paired device) *is* the approval. A node may relay
      // that approval. An arm, or a node acting on its own, goes through the oath gate.
      const approver: string | undefined = p.kind === "node" ? input.onBehalfOf : p.kind === "arm" ? undefined : p.device;
      const quest = p.kind === "arm" ? armQuest(p.label!) : p.kind === "node" ? input.quest : undefined;
      const relay = { id: input.id, ...(approver ? { onBehalfOf: approver } : {}), ...(quest ? { quest } : {}) };
      return onNode(
        p,
        input.on,
        routes.destroySandbox.path,
        relay,
        async () => {
          const decision = await ctx.sandbox!.destroy(input.id, approver ? { approvedBy: approver } : quest ? { quest } : {});
          if (decision.verdict !== "allow") throw new HttpError(409, `the oath requires approval: ${decision.reason}`);
          return { ok: true };
        },
        { sandbox: input.id },
      ).then((done) => {
        // Its attempt (if it was one) has finished, and it's nowhere any more.
        ctx.compute.sandboxGone(input.id);
        // Its slot on the host this node sent it to is free again, before that host's next report says so.
        const host = placed.get(input.id);
        if (host) dispatched.note(host, -1, Date.now());
        placed.delete(input.id);
        return done;
      });
    },
    loops: () => ({ loops: loopViews() }),
    setLoop: (input) => {
      const existing = loopRecords(ctx.store).find((l) => l.name === input.name);
      if (!existing && (!input.schedule || !input.task)) throw new HttpError(400, "a new loop needs a schedule and a task");
      let task: LoopTask | null = input.task ?? existing?.task ?? null;
      if (!task) throw new HttpError(400, "this node can't read the loop's task; give it again");
      // A heartbeat given again keeps the owner's self-action switch unless it says otherwise (setSelfAction turns it on).
      if (task.kind === "heartbeat" && task.selfAction === undefined && existing?.task?.kind === "heartbeat" && existing.task.selfAction === false) task = { ...task, selfAction: false };
      const schedule: string = input.schedule ?? existing!.scheduleText;
      const tz: string = input.tz ?? existing?.tz ?? "UTC";
      if (!isTimeZone(tz)) throw new HttpError(400, `unknown time zone "${tz}" (use an IANA name such as Europe/Copenhagen)`);
      try {
        checkSchedule(schedule, tz, Date.now());
      } catch (error) {
        throw new HttpError(400, (error as Error).message);
      }
      // Loops replicate in plaintext and their text reaches models: no keys in them.
      guardAgainstSecrets(JSON.stringify(task), input.label ?? "");
      const keep = existing && ctx.store.activeDevice(existing.on) ? existing.on : null;
      const on = input.on ? fullNode(input.on).id : (keep ?? defaultRunner(task).id);
      const label: string | undefined = input.label ?? existing?.label ?? undefined;
      ctx.store.emit(ctx.identity, "loop.set", {
        name: input.name,
        schedule,
        tz,
        on,
        enabled: input.enabled ?? existing?.enabled ?? true,
        task: task as unknown as Record<string, unknown>,
        ...(label ? { label } : {}),
      });
      return { loop: loopViews().find((l) => l.name === input.name) };
    },
    removeLoop: (input) => {
      if (!loopRecords(ctx.store).some((l) => l.name === input.name)) throw new HttpError(404, `no loop "${input.name}"`);
      ctx.store.emit(ctx.identity, "loop.removed", { name: input.name });
      return { ok: true };
    },
    runLoop: async (input, p) => {
      const loop = loopRecords(ctx.store).find((l) => l.name === input.name);
      if (!loop) throw new HttpError(404, `no loop "${input.name}"`);
      if (loop.on === ctx.identity.id) {
        try {
          return { node: ctx.nodeName, ...ctx.loops.runNow(input.name) };
        } catch (error) {
          throw new HttpError(409, (error as Error).message);
        }
      }
      // Forwarded requests run where they land, never onward.
      if (p.kind === "node") throw new HttpError(409, `loop ${input.name} doesn't run on ${ctx.nodeName}`);
      const runner = ctx.store.activeDevice(loop.on);
      if (!runner) throw new HttpError(409, `loop ${input.name} has no runner (its node was revoked)`);
      return forward(runner, routes.runLoop.path, { name: input.name });
    },
    loopRuns: (input) => ({ runs: ctx.store.loopRuns(input.name, input.limit ?? 20).map(runView) }),
    notices: () => ({ notices: noticeViews() }),
    dismissNotice: (input) => {
      if (!ctx.store.lww(`notice:${input.key}`)?.value) throw new HttpError(404, "no such notice");
      ctx.store.emit(ctx.identity, "notice.dismissed", { key: input.key });
      // He stops tending to it in the world.
      ctx.world.heartbeatChanged();
      return { ok: true };
    },
    heartbeat: async () => ({ node: ctx.nodeName, findings: await ctx.heartbeatCheck() }),
    selfAction: () => selfActionView(),
    setSelfAction: (input) => {
      const beats = loopRecords(ctx.store).filter((l) => l.task?.kind === "heartbeat");
      if (!beats.length) throw new HttpError(409, "there's no heartbeat loop, and self-action runs after it (galahad loop add heartbeat --every 30m --heartbeat)");
      for (const loop of beats) {
        if (loop.task?.kind !== "heartbeat") continue;
        const { selfAction: _was, ...rest } = loop.task;
        // On is the default: the field is left out (so the task reads as it always did); off says so.
        const task = input.on ? rest : { ...rest, selfAction: false };
        if (canonical(task as unknown as Json) === canonical(loop.task as unknown as Json)) continue;
        ctx.store.emit(ctx.identity, "loop.set", {
          name: loop.name,
          schedule: loop.scheduleText,
          tz: loop.tz,
          on: loop.on,
          enabled: loop.enabled,
          task: task as unknown as Record<string, unknown>,
          ...(loop.label ? { label: loop.label } : {}),
        });
      }
      ctx.world.heartbeatChanged();
      return selfActionView();
    },
    // His journal: the entries his loop kept, newest day first (read like any memory: agents may read his recollection).
    journal: (input) => journalEntries(ctx.store, input),
    // His dog's name: the owner's setting, the same on every node.
    companion: () => companionView(ctx.store),
    setCompanion: (input) => {
      const name: string | null = input.name;
      // It replicates in plaintext, goes into his journal's prompt and onto every device's world.
      if (name !== null) guardAgainstSecrets(name);
      if ((companionOf(ctx.store)?.name ?? null) !== name) {
        if (name === null) ctx.store.emit(ctx.identity, "companion.unnamed", {});
        else ctx.store.emit(ctx.identity, "companion.named", { name });
      }
      // The world calls the dog by its name at once.
      ctx.world.companionChanged();
      return companionView(ctx.store);
    },
    connectors: () => ({ connectors: connectorViews() }),
    setConnector: async (input) => {
      if (input.mcp) {
        if (input.manifest || input.origin) throw new HttpError(400, "give an MCP server's url, or a manifest, not both");
        const installed = await connectorErrors(() => ctx.connectors.installMcp(input.id, input.mcp!));
        return { connector: connectorViews().find((c) => c.id === input.id), discovered: installed };
      }
      let manifest: ConnectorManifest;
      if (input.manifest) {
        const parsed = ConnectorManifest.safeParse(input.manifest);
        if (!parsed.success) {
          throw new HttpError(400, `not a valid connector: ${parsed.error.issues.map((i) => `${i.path.join(".") || "manifest"}: ${i.message}`).join("; ")}`);
        }
        if (parsed.data.id !== input.id) throw new HttpError(400, `the manifest's id is "${parsed.data.id}", not "${input.id}"`);
        manifest = parsed.data;
      } else {
        const catalog = Object.hasOwn(CATALOG, input.id) ? CATALOG[input.id] : undefined;
        if (!catalog) throw new HttpError(404, `no "${input.id}" in the catalog (${Object.keys(CATALOG).join(", ")}); give a manifest for your own`);
        const origin = catalog.needsOrigin ? (input.origin ? originOf(input.origin) : null) : catalog.manifest.origin;
        if (!origin) throw new HttpError(400, `${catalog.manifest.label} runs at an address of yours: give its origin (e.g. http://homeassistant.local:8123)`);
        const parsed = ConnectorManifest.safeParse({ ...catalog.manifest, origin });
        if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "));
        manifest = parsed.data;
      }
      // Manifests replicate in plaintext: a key pasted into a description or header must never land there.
      guardAgainstSecrets(JSON.stringify({ ...manifest, tools: Object.fromEntries(Object.entries(manifest.tools).map(([k, t]) => [k, t.description])) }));
      ctx.store.emit(ctx.identity, "connector.set", { id: manifest.id, manifest: manifest as unknown as Record<string, unknown> });
      return { connector: connectorViews().find((c) => c.id === manifest.id) };
    },
    removeConnector: (input) => {
      if (!installedConnector(ctx.store, input.id) && !ctx.store.lww(`connector:${input.id}`)?.value) throw new HttpError(404, `${input.id} isn't installed`);
      ctx.store.emit(ctx.identity, "connector.removed", { id: input.id });
      return { ok: true };
    },
    callConnector: ({ ask, ...input }, p) =>
      connectorErrors(() =>
        ctx.connectors.call(
          input,
          (p.kind === "admin" || p.kind === "client") && ask
            ? { kind: "agent", by: "quest", ...(ask.quest ? { quest: ask.quest } : {}) }
            : p.kind === "admin" || p.kind === "client"
            ? { kind: "owner", device: p.device }
            : p.kind === "arm"
              ? { kind: "agent", by: `arm:${p.label}`, quest: armQuest(p.label!) }
              : { kind: "agent", by: `node:${ctx.store.device(p.device)?.name ?? p.device}` },
        ),
      ),
    actions: (): { actions: ActionView[] } => ({ actions: ctx.connectors.actions() }),
    decideAction: (input, p) => {
      // Only you decide: never another node, never an agent (arms can't hold fleet:admin anyway).
      if (p.kind !== "admin" && p.kind !== "client") throw new HttpError(403, "only you can answer an action request");
      return connectorErrors(() => ({ action: ctx.connectors.decide(input.id, input.approve, p.kind === "client" ? p.device : null, input.note) }));
    },
    orders: () => ({ orders: ctx.connectors.orders() }),
    setOrder: (input, p) => {
      // A standing order is an answer given in advance: only you give it, like any answer.
      if (p.kind !== "admin" && p.kind !== "client") throw new HttpError(403, "only you can sign a standing order");
      return connectorErrors(() => ctx.connectors.sign(input, p.kind === "client" ? p.device : null));
    },
    revokeOrder: (input) => connectorErrors(() => ({ order: ctx.connectors.revoke(input.id) })),
    arms: () => ({ arms: ctx.arms.list() }),
    mintArm: (input) => {
      try {
        return ctx.arms.mint(input.label, input.scopes);
      } catch (error) {
        throw new HttpError(400, (error as Error).message);
      }
    },
    revokeArm: (input) => ({ revoked: ctx.arms.revoke(input.label) }),
    buildSandboxImage: (input, p) =>
      longRunning(
        onNode(p, input.on, routes.buildSandboxImage.path, input.lab ? { lab: true } : input.gazebo ? { gazebo: true } : {}, async () => {
          const result = input.lab
            ? await ctx.sandbox!.build(`${ctx.sandboxContext!}/lab`, undefined, "galahad/lab:1")
            : input.gazebo
              ? await ctx.sandbox!.build(`${ctx.sandboxContext!}/gazebo`, undefined, "galahad/gazebo:1")
              : await ctx.sandbox!.build(ctx.sandboxContext!);
          if (!result.ok) throw new HttpError(500, `image build failed: ${result.output.slice(-400)}`);
          return { ok: true };
        }),
      ),

    // ---- The archive (node-local) --------------------------------------------------
    archiveStatus: () => ctx.archive.status(),
    archiveSearch: (input, p) => archiveErrors(() => ctx.archive.search(input, { hideKinds: archiveHidden(p) })),
    archiveEntry: (input, p) => {
      const entry = ctx.archive.entry(input.id, { hideKinds: archiveHidden(p) });
      if (!entry) throw new HttpError(404, "no such entry in this node's archive");
      return { entry };
    },
    archiveFile: (input, p) =>
      archiveErrors(async () => {
        const file = await ctx.archive.file(input.id, input.path, { hideKinds: archiveHidden(p) });
        const name = file.name.replace(/[^A-Za-z0-9._ -]/g, "_");
        const inline = file.type.startsWith("text/") || file.type.startsWith("image/");
        return new Response(file.bytes as Uint8Array<ArrayBuffer>, {
          headers: {
            "content-type": file.type,
            "content-length": String(file.bytes.length),
            "content-disposition": `${inline ? "inline" : "attachment"}; filename="${name}"`,
            "cache-control": "no-store",
            // Opened directly, an archived file can do nothing on this origin.
            "content-security-policy": "sandbox; default-src 'none'",
            ...SECURITY_HEADERS,
          },
        });
      }),
    noteIdea: (input, p) =>
      archiveErrors(async () => {
        // Ideas may be embedded, summarised and (later) replicated: nothing credential-shaped.
        guardAgainstSecrets(input.title, input.text, ...(input.tags ?? []));
        // Yours from a terminal or a paired device; Galahad's own from his tool; an outside agent's text is untrusted.
        const trust = isOwner(p) ? "owner" : p.kind === "arm" && p.label !== GALAHAD_ARM ? "untrusted" : "agent";
        const who = isOwner(p) ? (p.kind === "client" ? (ctx.store.device(p.device)?.name ?? "a paired device") : "you") : p.kind === "arm" ? `arm:${p.label}` : `node:${ctx.store.device(p.device)?.name ?? p.device}`;
        const noted = await ctx.archive.noteIdea(input, { trust, who });
        return { ...noted, trust, node: ctx.nodeName };
      }),
    deleteArchived: (input, p) =>
      archiveErrors(async () => {
        ownerOfArchive(p);
        guardAgainstSecrets(input.reason);
        const entry = ctx.archive.entry(input.id);
        const result = await ctx.archive.delete(input.id, input.reason, p.kind === "client" ? (ctx.store.device(p.device)?.name ?? "a paired device") : "you");
        // The ledger says that it went, never what it held.
        ctx.ledger?.({ class: "delete", resource: "archive", target: input.id, verdict: "approved", reason: "you asked for it", detail: `${entry?.kind ?? "entry"}${result.deleted.length > 1 ? ` and ${result.deleted.length - 1} lesson(s) drawn from it` : ""}` });
        return result;
      }),
    reindexArchive: (input, p) => {
      ownerOfArchive(p);
      return ctx.archive.reindex(input);
    },
    verifyArchive: (_input, p) => {
      ownerOfArchive(p);
      return longRunning(ctx.archive.verify());
    },
    setArchiveBudget: (input, p) => {
      ownerOfArchive(p);
      ctx.archive.setBudget(input.summariesPerDay);
      return { understanding: ctx.archive.status().understanding };
    },
  };

  /** The experiment store's refusals as plain HTTP errors. */
  function experimentErrors<T>(run: () => T): T {
    if (!ctx.world.store) throw new HttpError(424, "this node doesn't keep experiments");
    try {
      return run();
    } catch (error) {
      if (error instanceof ExperimentError) throw new HttpError(error.status, error.message);
      throw error;
    }
  }

  /** Bank failures as plain HTTP errors: a status and a sentence, never the bank's body. */
  async function bankErrors<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof BankError) throw new HttpError(error.status, error.message);
      throw new HttpError(500, "bank access failed");
    }
  }

  /** His eyes' own refusals (nobody asked, not the image it claims, asked too often), with their statuses. */
  function eyesErrors<T>(run: () => T): T {
    const refuse = (error: unknown): never => {
      if (error instanceof EyesError) throw new HttpError(error.status, error.message);
      throw error;
    };
    try {
      const out = run();
      return out instanceof Promise ? (out.catch(refuse) as T) : out;
    } catch (error) {
      return refuse(error);
    }
  }

  const routeTable = new Map(Object.entries(routes).map(([name, r]) => [`${r.method} ${r.path}`, name as RouteName]));

  async function handle(req: Request, listener: Listener): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    // Sandboxes can reach exactly four things on the host, all token-gated: the model
    // gateway, the git gateway (read-only clones of one repository), web search, and the
    // world (their experiments, shown in the SANDBOX).
    if (listener === "sandbox") {
      if (path === "/search") return handleSandboxSearch(req, { tokens: ctx.tokens, ...(ctx.ledger ? { ledger: ctx.ledger } : {}) });
      if (path.startsWith("/world/")) return handleSandboxWorld(req, { tokens: ctx.tokens, world: ctx.world, nodeName: ctx.nodeName });
      if (path.startsWith("/git/")) return handleGitGateway(req, { store: ctx.store, vault: ctx.vault, tokens: ctx.tokens, ...(ctx.ledger ? { ledger: ctx.ledger } : {}), ...(ctx.fetch ? { fetch: ctx.fetch } : {}) });
      if (!path.startsWith("/gw/")) throw new HttpError(404, "not found");
      return handleGateway(req, { store: ctx.store, vault: ctx.vault, tokens: ctx.tokens });
    }

    if (req.method === "GET" && ctx.assets.has(path)) return ctx.assets.serve(path, req);

    if (path.startsWith("/gw/")) {
      if (listener !== "loopback") throw new HttpError(404, "not found");
      return handleGateway(req, { store: ctx.store, vault: ctx.vault, tokens: ctx.tokens });
    }

    if (req.method === "POST" && path === "/link/pair/request") return json(ctx.pairing.request(await req.json()));
    if (req.method === "POST" && path === "/link/pair/status") {
      const input = StatusInput.parse(await req.json());
      return json(ctx.pairing.status(input.invite, input.device, input.proof));
    }

    const body = req.method === "GET" ? new Uint8Array() : new Uint8Array(await req.arrayBuffer());
    const pathAndQuery = `${path}${url.search}`;

    if (req.method === "POST" && (path === "/link/sync" || path === "/link/push")) {
      const principal = authenticate(req, body, pathAndQuery, listener);
      if (!principal || principal.kind !== "node") throw new HttpError(401, "link requests must come from an enrolled node");
      const payload = JSON.parse(new TextDecoder().decode(body));
      if (path === "/link/sync") {
        return json({ ...answerSync(ctx.store, SyncRequest.parse(payload)), presence: await ctx.presence() });
      }
      const { events } = PushRequest.parse(payload);
      return json(answerPush(ctx.store, events));
    }

    if (path.startsWith("/api/")) {
      const name = routeTable.get(`${req.method} ${path}`);
      if (!name) throw new HttpError(404, "no such route");
      const route = routes[name];
      const principal = authenticate(req, body, pathAndQuery, listener);
      if (!principal) throw new HttpError(401, "sign the request with an enrolled device key");
      if (route.scope && !principal.scopes.includes(route.scope)) throw new HttpError(403, `requires scope ${route.scope}`);
      const input = route.input ? route.input.parse(body.length ? JSON.parse(new TextDecoder().decode(body)) : {}) : undefined;
      if (principal.kind === "arm") armActivity(name, input, principal.label);
      const result = await handlers[name](input, principal, req);
      if (result instanceof Response) return result;
      // What the PWA reads goes compressed. Answers that carry a credential (an invite, a token) never do.
      return route.method === "GET" || COMPRESSED_READS.has(name) ? compressedJson(result, req, SECURITY_HEADERS) : json(result);
    }

    throw new HttpError(404, "not found");
  }

  return async (req: Request, listener: Listener): Promise<Response> => {
    try {
      return await handle(req, listener);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      if (error instanceof PairingError) return json({ error: error.message }, error.status);
      if (error instanceof SandboxError) return json({ error: error.message }, error.status);
      if (error instanceof BoardError) return json({ error: error.message }, error.status);
      if (error instanceof ZodError) return json({ error: "invalid input", issues: error.issues }, 400);
      if (error instanceof SyntaxError) return json({ error: "invalid JSON" }, 400);
      const message = String((error as Error).message ?? error);
      if (/not authorized|already|unknown or|refusing|no secret|not configured/.test(message)) return json({ error: message }, 409);
      ctx.log(`error ${req.method} ${new URL(req.url).pathname}: ${message}`);
      return json({ error: "internal error" }, 500);
    }
  };
}

export { GatewayTokens };
