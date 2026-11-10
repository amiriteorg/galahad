import { z } from "zod";
import { ConnectorArgs, ToolName } from "./connectors.ts";
import { ActionId, ArtifactId, ConnectorId, LoopName, LoopStatus, NoticeKey, NoticeSeverity } from "./events.ts";
import { Conclusion, InvestigationId, InvestigationStatus, PredictionOutcome, Preregistration } from "./investigations.ts";
import { MAX_ORDER_DAYS, OrderId, OrderPattern } from "./orders.ts";
import { type Scope, Scope as ScopeSchema } from "./scopes.ts";
import { TrialRecord } from "./trials.ts";
import { DecisionRequest } from "./decisions.ts";
import { BankBalancesInput, BankCompleteInput, BankTransactionsInput } from "./bank.ts";

/*
 * The node HTTP API contract, shared by the daemon, the CLI and the PWA.
 * Each route declares exactly one scope; the server validates input with the
 * schema below before any handler runs. Transports stay thin.
 */

const Name = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/);
const ModelRef = z.string().min(3).max(256);

export const ChatMessage = z.strictObject({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(400_000),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

export const PlacementNeeds = z.strictObject({
  docker: z.boolean().optional(),
  vm: z.boolean().optional(),
  gpu: z.boolean().optional(),
  minMemoryGb: z.number().min(0).max(4096).optional(),
  tools: z.array(z.string().max(64)).max(32).optional(),
  localModels: z.boolean().optional(),
  longRunning: z.boolean().optional(),
  interactive: z.boolean().optional(),
  untrusted: z.boolean().optional(),
  prefer: z.string().optional(),
});
export type PlacementNeeds = z.infer<typeof PlacementNeeds>;

/** A node, by name or device id. */
const NodeRef = z.string().min(1).max(100).regex(/^[A-Za-z0-9._:-]+$/);
const SandboxId = z.string().regex(/^[a-f0-9]{10}$/);

export const SandboxNetwork = z.enum(["isolated", "gateway", "online"]);
export type SandboxNetwork = z.infer<typeof SandboxNetwork>;

export const SandboxRequest = z.strictObject({
  /** isolated = no network · gateway = models only (default) · online = internet + models */
  network: SandboxNetwork.default("gateway"),
  image: z
    .string()
    .max(200)
    .regex(/^[a-z0-9][a-z0-9._/:@-]*$/)
    .optional(),
  cpus: z.number().min(0.25).max(64).default(4),
  memoryGb: z.number().min(0.25).max(512).default(8),
  ttlMinutes: z.number().int().min(1).max(7 * 24 * 60).default(120),
  /** Providers the sandbox may call through the gateway (scoped token; never the key). */
  providers: z.array(Name).max(16).optional(),
  /** Persistent sandboxes are not cleaned up automatically; destroying one asks first. */
  persistent: z.boolean().default(false),
  quest: z.string().max(64).regex(/^[A-Za-z0-9._:-]+$/).optional(),
  /** The workspace's size limit in GB (default 20). /work can't grow past it. */
  diskGb: z.number().int().min(1).max(2048).optional(),
  /**
   * container: a hardened container on the host's kernel. vm: the same container inside its own
   * KVM microVM with its own kernel (Kata), for code there's no reason to trust. Default: vm for
   * online sandboxes where the host has microVMs, container otherwise.
   */
  isolation: z.enum(["container", "vm"]).optional(),
  /** The Lab image: mathematics, physics and engineering (FEniCSx, OpenFOAM, OpenCascade, MuJoCo, ngspice, …). */
  lab: z.boolean().optional(),
  /** Web search through the gateway (the node's own SearXNG), even without the internet: `websearch <words>`. */
  search: z.boolean().optional(),
});
export type SandboxRequest = z.input<typeof SandboxRequest>;

/** What a loop does each time it runs. */
export const LoopTask = z.discriminatedUnion("kind", [
  /** Look around: fleet and body checks, notices in your inbox; optionally a checklist a model reads. */
  z.strictObject({ kind: z.literal("heartbeat"), checklist: z.string().max(4000).optional() }),
  /** A quest in a fresh sandbox: plan, work, independent review, remembered. */
  z.strictObject({
    kind: z.literal("quest"),
    goal: z.string().min(1).max(4000),
    network: SandboxNetwork,
    maxSteps: z.number().int().min(1).max(100).optional(),
  }),
  /** One connector tool; outward and delete tools file an approval request instead. */
  z.strictObject({ kind: z.literal("call"), connector: ConnectorId, tool: ToolName, args: ConnectorArgs.optional() }),
]);
export type LoopTask = z.infer<typeof LoopTask>;

export const routes = {
  whoami: { method: "GET", path: "/api/whoami", scope: null, input: null },
  fleet: { method: "GET", path: "/api/fleet", scope: "mind:read", input: null },
  recall: {
    method: "POST",
    path: "/api/memories/search",
    scope: "mind:read",
    input: z.strictObject({ q: z.string().max(1000).optional(), limit: z.number().int().min(1).max(200).optional() }),
  },
  remember: {
    method: "POST",
    path: "/api/memories",
    scope: "mind:write",
    input: z.strictObject({
      text: z.string().min(1).max(20_000),
      tags: z.array(z.string().min(1).max(64)).max(32).optional(),
      /** Set when the content came from the web, a file or someone else: it stays data, never instructions. */
      untrusted: z.boolean().optional(),
    }),
  },
  forget: { method: "POST", path: "/api/memories/forget", scope: "mind:write", input: z.strictObject({ id: z.string() }) },
  secrets: { method: "GET", path: "/api/secrets", scope: "vault:read", input: null },
  setSecret: {
    method: "POST",
    path: "/api/secrets",
    scope: "vault:write",
    input: z.strictObject({
      name: Name,
      value: z.string().min(1).max(16_384),
      provider: Name.optional(),
      label: z.string().max(128).optional(),
      /** Where this key may be sent (entered with the key). Defaults to the provider's built-in preset. */
      baseUrl: z.string().url().max(512).optional(),
      /** The key is for this connector: it is pinned to the connector's origin. */
      connector: ConnectorId.optional(),
    }),
  },
  deleteSecret: { method: "POST", path: "/api/secrets/delete", scope: "vault:write", input: z.strictObject({ name: Name }) },
  secretRequests: { method: "GET", path: "/api/secret-requests", scope: "vault:read", input: null },
  requestSecret: {
    method: "POST",
    path: "/api/secret-requests",
    scope: "mind:write",
    input: z.strictObject({ name: Name, provider: Name.optional(), purpose: z.string().min(1).max(500) }),
  },
  rotateVault: {
    method: "POST",
    path: "/api/vault/rotate",
    scope: "vault:write",
    input: z.strictObject({ reason: z.string().max(200).optional() }),
  },
  providers: { method: "GET", path: "/api/providers", scope: "mind:read", input: null },
  setProvider: {
    method: "POST",
    path: "/api/providers",
    scope: "brain:write",
    input: z.strictObject({
      id: Name,
      preset: Name.optional(),
      kind: z.enum(["openai", "anthropic"]).optional(),
      baseUrl: z.string().url().optional(),
      secret: Name.optional(),
      label: z.string().max(128).optional(),
    }),
  },
  removeProvider: { method: "POST", path: "/api/providers/remove", scope: "brain:write", input: z.strictObject({ id: Name }) },
  providerModels: { method: "POST", path: "/api/providers/models", scope: "mind:read", input: z.strictObject({ id: Name }) },
  roster: { method: "GET", path: "/api/roster", scope: "mind:read", input: null },
  setRoster: {
    method: "POST",
    path: "/api/roster",
    scope: "brain:write",
    input: z.strictObject({ role: Name, models: z.array(ModelRef).max(16) }),
  },
  chat: {
    method: "POST",
    path: "/api/chat",
    scope: "chat",
    input: z.strictObject({
      role: Name.optional(),
      model: ModelRef.optional(),
      messages: z.array(ChatMessage).min(1).max(500),
      /** Galahad's tools, within the caller's scopes (default). Quests turn them off: their roles have their own. */
      tools: z.boolean().optional(),
    }),
  },
  createInvite: {
    method: "POST",
    path: "/api/invites",
    scope: "fleet:admin",
    input: z.strictObject({
      kind: z.enum(["node", "client"]),
      scopes: z.array(ScopeSchema).max(16).optional(),
      origin: z.string().url().optional(),
    }),
  },
  pairings: { method: "GET", path: "/api/pairings", scope: "fleet:admin", input: null },
  approvePairing: {
    method: "POST",
    path: "/api/pairings/approve",
    scope: "fleet:admin",
    input: z.strictObject({ invite: z.string(), device: z.string() }),
  },
  rejectPairing: {
    method: "POST",
    path: "/api/pairings/reject",
    scope: "fleet:admin",
    input: z.strictObject({ invite: z.string(), device: z.string() }),
  },
  revokeDevice: {
    method: "POST",
    path: "/api/devices/revoke",
    scope: "fleet:admin",
    input: z.strictObject({ device: z.string(), reason: z.string().max(500).optional() }),
  },
  setDeviceScopes: {
    method: "POST",
    path: "/api/devices/scopes",
    scope: "fleet:admin",
    input: z.strictObject({ device: z.string(), scopes: z.array(ScopeSchema).max(16) }),
  },
  place: { method: "POST", path: "/api/place", scope: "mind:read", input: PlacementNeeds },
  mintToken: {
    method: "POST",
    path: "/api/tokens",
    scope: "gateway:mint",
    input: z.strictObject({
      label: z.string().min(1).max(64),
      providers: z.array(Name).max(32).optional(),
      ttlMinutes: z.number().int().min(1).max(7 * 24 * 60).default(60),
      maxRequests: z.number().int().min(1).max(1_000_000).default(1000),
    }),
  },
  revokeToken: {
    method: "POST",
    path: "/api/tokens/revoke",
    scope: "gateway:mint",
    input: z.strictObject({ hash: z.string().min(10).max(64) }),
  },
  ledger: { method: "GET", path: "/api/ledger", scope: "mind:read", input: null },
  sandboxes: { method: "POST", path: "/api/sandboxes/list", scope: "sandbox", input: z.strictObject({ on: NodeRef.optional() }) },
  createSandbox: { method: "POST", path: "/api/sandboxes", scope: "sandbox", input: SandboxRequest.extend({ on: NodeRef.optional() }) },
  execSandbox: {
    method: "POST",
    path: "/api/sandboxes/exec",
    scope: "sandbox",
    input: z.strictObject({
      id: SandboxId,
      cmd: z.array(z.string().max(100_000)).min(1).max(256),
      timeoutSec: z.number().int().min(1).max(3600).optional(),
      on: NodeRef.optional(),
      /** Set by a full node relaying an arm's request: the arm may only use its own sandboxes. */
      quest: z.string().max(64).optional(),
    }),
  },
  destroySandbox: {
    method: "POST",
    path: "/api/sandboxes/destroy",
    scope: "sandbox",
    input: z.strictObject({
      id: SandboxId,
      on: NodeRef.optional(),
      /** Set by a full node forwarding an owner's request; honored only from full nodes. */
      onBehalfOf: z.string().max(100).optional(),
      /** Set by a full node relaying an arm's request: cleanup of that quest's own sandboxes only. */
      quest: z.string().max(64).optional(),
    }),
  },
  buildSandboxImage: {
    method: "POST",
    path: "/api/sandboxes/build",
    scope: "sandbox",
    input: z.strictObject({ on: NodeRef.optional(), lab: z.boolean().optional() }),
  },
  loops: { method: "GET", path: "/api/loops", scope: "mind:read", input: null },
  setLoop: {
    method: "POST",
    path: "/api/loops",
    scope: "brain:write",
    // A new loop needs a schedule and a task; an existing one keeps whatever you leave out.
    input: z.strictObject({
      name: LoopName,
      schedule: z.string().min(1).max(128).optional(),
      tz: z.string().max(64).optional(),
      on: NodeRef.optional(),
      enabled: z.boolean().optional(),
      task: LoopTask.optional(),
      label: z.string().max(128).optional(),
    }),
  },
  removeLoop: { method: "POST", path: "/api/loops/remove", scope: "brain:write", input: z.strictObject({ name: LoopName }) },
  runLoop: { method: "POST", path: "/api/loops/run", scope: "brain:write", input: z.strictObject({ name: LoopName }) },
  loopRuns: {
    method: "POST",
    path: "/api/loops/runs",
    scope: "mind:read",
    input: z.strictObject({ name: LoopName.optional(), limit: z.number().int().min(1).max(200).optional() }),
  },
  notices: { method: "GET", path: "/api/notices", scope: "mind:read", input: null },
  dismissNotice: { method: "POST", path: "/api/notices/dismiss", scope: "mind:write", input: z.strictObject({ key: NoticeKey }) },
  /** Run the heartbeat's checks here, now, and return what they find (writes nothing). */
  heartbeat: { method: "POST", path: "/api/heartbeat", scope: "mind:read", input: z.strictObject({}) },
  connectors: { method: "GET", path: "/api/connectors", scope: "mind:read", input: null },
  setConnector: {
    method: "POST",
    path: "/api/connectors",
    scope: "brain:write",
    input: z.strictObject({
      id: ConnectorId,
      /** For a catalog connector whose origin is yours (Home Assistant on your LAN). */
      origin: z.string().url().max(256).optional(),
      /** A connector of your own: a full manifest. */
      manifest: z.record(z.string(), z.unknown()).optional(),
      /** A remote MCP server: Galahad lists its tools now (again, to refresh) and keeps the classes you chose. */
      mcp: z
        .strictObject({
          url: z.string().url().max(512),
          label: z.string().min(1).max(64).optional(),
          description: z.string().max(500).optional(),
          /** How the key is sent, if it needs one: bearer (Authorization) or a header of the server's choosing. */
          auth: z.enum(["none", "bearer", "header"]).optional(),
          header: z.string().regex(/^[A-Za-z0-9-]{1,64}$/).optional(),
          /** Install only these tools (the server's names). */
          only: z.array(z.string().min(1).max(128)).max(128).optional(),
          /** Your class for a tool (server or local name); "*" for the ones you don't name. */
          classes: z.record(z.string().min(1).max(128), z.enum(["read", "create", "modify", "outward", "delete"])).optional(),
        })
        .optional(),
    }),
  },
  removeConnector: { method: "POST", path: "/api/connectors/remove", scope: "brain:write", input: z.strictObject({ id: ConnectorId }) },
  callConnector: {
    method: "POST",
    path: "/api/connectors/call",
    scope: "connect",
    input: z.strictObject({
      connector: ConnectorId,
      tool: ToolName,
      args: ConnectorArgs.optional(),
      why: z.string().max(500).optional(),
      /**
       * You, asking to be asked: file it for approval like an agent's call (on behalf of a quest
       * you started), instead of running it now. Standing orders still answer it.
       */
      ask: z.strictObject({ quest: z.string().regex(/^q-[a-z0-9]{1,16}$/).optional() }).optional(),
    }),
  },
  actions: { method: "GET", path: "/api/actions", scope: "mind:read", input: null },
  decideAction: {
    method: "POST",
    path: "/api/actions/decide",
    scope: "fleet:admin",
    input: z.strictObject({ id: ActionId, approve: z.boolean(), note: z.string().max(500).optional() }),
  },
  investigations: { method: "GET", path: "/api/investigations", scope: "mind:read", input: null },
  /** Record a pre-registration before anything runs (it never changes afterwards). */
  registerInvestigation: {
    method: "POST",
    path: "/api/investigations",
    scope: "mind:write",
    input: z.strictObject({ registration: Preregistration }),
  },
  /** How it ended, once, by the node that registered it. */
  concludeInvestigation: {
    method: "POST",
    path: "/api/investigations/conclude",
    scope: "mind:write",
    input: z.strictObject({
      id: InvestigationId,
      status: InvestigationStatus,
      conclusion: Conclusion.optional(),
      summary: z.string().max(4000),
      review: z.string().max(4000).optional(),
      artifact: z.string().regex(/^art_[A-Za-z0-9_-]{22}$/).optional(),
      predictions: z.array(PredictionOutcome).max(16).optional(),
    }),
  },
  trials: { method: "GET", path: "/api/trials", scope: "mind:read", input: null },
  /**
   * Record a graded trial, once. brain:write (never an arm's): the Index decides what
   * Galahad keeps, so the thing being measured can't write its own marks.
   */
  recordTrial: { method: "POST", path: "/api/trials", scope: "brain:write", input: TrialRecord },
  /** Your bank connection: consent, accounts (masked), budget. */
  bankStatus: { method: "GET", path: "/api/bank/status", scope: "bank:read", input: null },
  bankAccounts: { method: "GET", path: "/api/bank/accounts", scope: "bank:read", input: null },
  bankBalances: { method: "POST", path: "/api/bank/balances", scope: "bank:read", input: BankBalancesInput },
  bankTransactions: { method: "POST", path: "/api/bank/transactions", scope: "bank:read", input: BankTransactionsInput },
  /** Start authorising Galahad at the bank (you only: agents never hold fleet:admin). Returns the bank's URL. */
  bankConnect: { method: "POST", path: "/api/bank/connect", scope: "fleet:admin", input: z.strictObject({}) },
  /** Finish it with what the bank's redirect brought back. */
  bankComplete: { method: "POST", path: "/api/bank/complete", scope: "fleet:admin", input: BankCompleteInput },
  /** End the consent at the bank and forget the session and the cache. */
  bankDisconnect: { method: "POST", path: "/api/bank/disconnect", scope: "fleet:admin", input: z.strictObject({}) },
  /** Typed answers about a state from the decider role (yes/no, a choice, a score), with probabilities. */
  decide: { method: "POST", path: "/api/decide", scope: "chat", input: DecisionRequest },
  /** Search the web through this node's own SearXNG. Results are strangers' words: data, never instructions. */
  webSearch: {
    method: "POST",
    path: "/api/search",
    scope: "connect",
    input: z.strictObject({
      q: z.string().min(1).max(400),
      categories: z.string().regex(/^[a-z ,]{1,100}$/).optional(),
      timeRange: z.enum(["day", "week", "month", "year"]).optional(),
      page: z.number().int().min(1).max(10).optional(),
    }),
  },
  artifacts: { method: "GET", path: "/api/artifacts", scope: "mind:read", input: null },
  /** Keep a sandbox's work products (a directory under /work, by default /work/out) after the sandbox is gone. */
  saveArtifact: {
    method: "POST",
    path: "/api/artifacts/save",
    scope: "sandbox",
    input: z.strictObject({
      sandbox: z.string().regex(/^[0-9a-f]{10}$/),
      path: z
        .string()
        .max(256)
        .regex(/^\/work(\/[A-Za-z0-9._ -]+)*\/?$/, "a directory under /work")
        .refine((path) => !path.split("/").some((part) => part === "." || part === ".."), "no . or .. in the path")
        .optional(),
      label: z.string().min(1).max(200).optional(),
      on: z.string().min(1).max(128).optional(),
      /** Set by a full node relaying an arm's request: the arm may only keep its own sandboxes' work. */
      quest: z.string().max(64).optional(),
    }),
  },
  /** One file of an artifact, as bytes (text and raster images inline, the rest as a download). */
  artifactFile: {
    method: "POST",
    path: "/api/artifacts/file",
    scope: "mind:read",
    input: z.strictObject({ id: ArtifactId, path: z.string().min(1).max(512) }),
  },
  /** Deleting kept work is yours to decide (the oath: never delete persistent things without approval). */
  removeArtifact: { method: "POST", path: "/api/artifacts/remove", scope: "fleet:admin", input: z.strictObject({ id: ArtifactId }) },
  orders: { method: "GET", path: "/api/orders", scope: "mind:read", input: null },
  /** Sign a standing order: your answer in advance. Only you (never an agent or another node). */
  setOrder: {
    method: "POST",
    path: "/api/orders",
    scope: "fleet:admin",
    input: z.strictObject({
      connector: ConnectorId,
      tool: ToolName,
      args: z.record(z.string().max(40), OrderPattern),
      callers: z.array(OrderPattern).min(1).max(16).optional(),
      /** How long it lasts (default 30 days). */
      days: z.number().int().min(1).max(MAX_ORDER_DAYS).optional(),
      label: z.string().min(1).max(128),
      /** Also approve this waiting action, which the order was made from. */
      approve: ActionId.optional(),
    }),
  },
  revokeOrder: { method: "POST", path: "/api/orders/revoke", scope: "fleet:admin", input: z.strictObject({ id: OrderId }) },
  arms: { method: "GET", path: "/api/arms", scope: "fleet:admin", input: null },
  mintArm: {
    method: "POST",
    path: "/api/arms",
    scope: "fleet:admin",
    input: z.strictObject({ label: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,47}$/), scopes: z.array(ScopeSchema).max(16).optional() }),
  },
  /** Change what an agent may do without changing its token (e.g. grant bank:read). */
  grantArm: {
    method: "POST",
    path: "/api/arms/grant",
    scope: "fleet:admin",
    input: z.strictObject({
      label: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,47}$/),
      add: z.array(ScopeSchema).max(16).optional(),
      remove: z.array(ScopeSchema).max(16).optional(),
    }),
  },
  revokeArm: {
    method: "POST",
    path: "/api/arms/revoke",
    scope: "fleet:admin",
    input: z.strictObject({ label: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,47}$/) }),
  },
} as const satisfies Record<string, { method: "GET" | "POST"; path: string; scope: Scope | null; input: z.ZodType | null }>;

export type RouteName = keyof typeof routes;
export type RouteInput<R extends RouteName> = (typeof routes)[R]["input"] extends z.ZodType
  ? z.input<(typeof routes)[R]["input"]>
  : undefined;

// ---- Response shapes -------------------------------------------------------

export interface DeviceView {
  id: string;
  name: string;
  kind: "node" | "client";
  role: string;
  scopes: Scope[];
  enrolledAt: string;
  revokedAt: string | null;
  endpoint: string | null;
  caps: Record<string, unknown> | null;
}

export interface PeerStatus {
  device: string;
  online: boolean;
  lastSeen: number | null;
  rttMs: number | null;
  error: string | null;
  /** Live load reported by the peer on its last sync (not stored in the log). */
  presence?: Presence | null;
}

export interface Presence {
  load: number;
  cores: number;
  freeMemoryGb: number;
  onBattery: boolean | null;
  batteryPercent: number | null;
}

export interface FleetView {
  fleet: string;
  name: string;
  self: string;
  devices: DeviceView[];
  peers: PeerStatus[];
  events: number;
  digest: string;
}

export interface MemoryView {
  id: string;
  text: string;
  tags: string[];
  device: string;
  via: string | null;
  trust: string;
  hlc: string;
}

export interface SecretView {
  name: string;
  provider: string | null;
  hint: string | null;
  /** The only origin this key is ever sent to. */
  origin: string | null;
  label: string | null;
  updatedAt: string;
  updatedBy: string;
}

export interface SecretRequestView {
  name: string;
  provider: string | null;
  purpose: string;
  requestedAt: string;
  requestedBy: string;
}

export interface ProviderView {
  id: string;
  kind: "openai" | "anthropic";
  baseUrl: string;
  secret: string | null;
  label: string | null;
  hasKey: boolean;
}

export interface PairingView {
  invite: string;
  device: string;
  name: string;
  kind: "node" | "client";
  sas: string;
  requestedAt: number;
  conflict: boolean;
}

export interface SandboxView {
  id: string;
  name: string;
  node: string;
  quest: string;
  image: string;
  network: SandboxNetwork;
  cpus: number;
  memoryGb: number;
  createdAt: number;
  expiresAt: number;
  status: string;
  ephemeral: boolean;
  providers: string[];
  /** The workspace's limit and what it uses now; null when this host can't limit disk (see the heartbeat). */
  disk: { limitGb: number; usedGb: number | null } | null;
  /** container (the host's kernel) or vm (its own KVM microVM and kernel). */
  isolation: "container" | "vm";
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  truncated: boolean;
}

export interface LedgerEntry {
  id: string;
  hlc: string;
  device: string;
  class: "read" | "create" | "modify" | "outward" | "delete" | "forbidden";
  resource: string;
  target: string;
  verdict: "allow" | "ask" | "deny" | "approved";
  reason: string | null;
  quest: string | null;
  detail: string | null;
}

export interface LoopRunView {
  loop: string;
  run: string;
  /** The scheduled time it ran for; null when run by hand. */
  slot: number | null;
  status: z.infer<typeof LoopStatus>;
  started: number;
  finished: number;
  summary: string;
  node: string;
}

export interface LoopView {
  name: string;
  schedule: string;
  tz: string;
  on: string;
  onName: string | null;
  enabled: boolean;
  /** null when this node can't read the task (written by a newer version). */
  task: LoopTask | null;
  problem: string | null;
  label: string | null;
  updatedAt: string;
  next: number | null;
  last: LoopRunView | null;
  /** Known only on the node that runs it. */
  running: boolean | null;
}

export interface NoticeView {
  key: string;
  severity: z.infer<typeof NoticeSeverity>;
  title: string;
  body: string;
  source: string;
  node: string | null;
  at: number;
  dismissed: boolean;
}

export interface FindingView {
  key: string;
  severity: z.infer<typeof NoticeSeverity>;
  title: string;
  body: string;
  node?: string;
}

export interface ConnectorToolView {
  name: string;
  description: string;
  /** GET, POST… or MCP. */
  method: string;
  /** The request path with its {placeholders} (where the call goes); null for MCP tools. */
  path: string | null;
  /** An MCP tool's name on its server, and what the server claimed about it (hints only). */
  remote?: string;
  hints?: { readOnly?: boolean; destructive?: boolean } | null;
  class: "read" | "create" | "modify" | "outward" | "delete";
  /** read, create and modify run freely; outward and delete ask you. */
  asks: boolean;
  params: Record<string, { type: string; required: boolean; description: string | null; enum: string[] | null }>;
}

export interface ConnectorView {
  id: string;
  label: string;
  description: string | null;
  /** http: request templates · mcp: a remote MCP server (its tools listed from the server). */
  kind: "http" | "mcp";
  /** An MCP server's endpoint. */
  url: string | null;
  origin: string | null;
  installed: boolean;
  /** none-needed · ready · missing · optional-missing · wrong-origin */
  key: string;
  secret: string | null;
  keyHelp: string | null;
  needsOrigin: boolean;
  problem: string | null;
  tools: ConnectorToolView[];
}

export interface ActionView {
  id: string;
  connector: string;
  tool: string;
  args: Record<string, unknown>;
  class: string;
  target: string;
  by: string;
  why: string | null;
  node: string;
  requestedAt: string;
  expires: number;
  state: "waiting" | "approved" | "denied" | "expired" | "done" | "failed";
  decidedVia: string | null;
  /** The standing order that answered it, when one did. */
  order: { id: string; label: string } | null;
  receipt: string | null;
}

export interface InvestigationView {
  id: string;
  question: string;
  /** The pre-registration, as recorded before anything ran (null if a newer node wrote a shape this one can't read). */
  registration: Preregistration | null;
  registeredAt: number;
  /** The node that ran it. */
  nodeName: string;
  status: "running" | z.infer<typeof InvestigationStatus>;
  conclusion: Conclusion | null;
  summary: string | null;
  review: string | null;
  artifact: string | null;
  predictions: z.infer<typeof PredictionOutcome>[];
  concludedAt: number | null;
}

export interface TrialView extends TrialRecord {
  id: string;
  recordedAt: number;
  /** The node that ran it. */
  nodeName: string;
}

export interface ArtifactView {
  id: string;
  label: string;
  quest: string | null;
  sandbox: string | null;
  /** The node holding the files. */
  node: string;
  nodeName: string;
  bytes: number;
  count: number;
  /** Up to 200 files (the holding node has them all). */
  files: { path: string; size: number; sha256: string }[];
  savedAt: number;
  /** The files are on the node you asked. */
  here: boolean;
}

export interface OrderView {
  id: string;
  label: string;
  connector: string;
  tool: string;
  class: "outward" | "delete";
  args: Record<string, string>;
  callers: string[] | null;
  until: number;
  /** active · expired · revoked · stale (the tool changed since you signed, so it no longer applies) */
  state: "active" | "expired" | "revoked" | "stale";
  signedAt: number;
  /** The device you signed it from. */
  signedVia: string | null;
  uses: number;
  lastUsed: number | null;
}

export type ChatStreamEvent =
  | { type: "model"; ref: string }
  | { type: "text"; text: string }
  /** Galahad calls one of his tools (input: a short summary of the arguments). */
  | { type: "tool"; id: string; name: string; title: string; input: string }
  /** How it went, in a line (never the whole result). */
  | { type: "tool_result"; id: string; name: string; ok: boolean; summary: string }
  | { type: "fallback"; from: string; error: string }
  | { type: "done"; ref: string }
  | { type: "error"; error: string };
