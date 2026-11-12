import { z } from "zod";
import { ConnectorArgs, ToolName } from "./connectors.ts";
import { ActionId, ArtifactId, ConnectorId, LoopName, LoopStatus, NoticeKey, NoticeSeverity } from "./events.ts";
import { Conclusion, InvestigationId, InvestigationStatus, PredictionOutcome, Preregistration } from "./investigations.ts";
import { MAX_ORDER_DAYS, OrderId, OrderPattern } from "./orders.ts";
import { type Scope, Scope as ScopeSchema } from "./scopes.ts";
import { TrialRecord, TrialRunId, type TrialRunSettings } from "./trials.ts";
import { type ComputeUsage, EffortAsk, EffortLevel } from "./compute.ts";
import { DecisionRequest } from "./decisions.ts";
import { BankBalancesInput, BankCompleteInput, BankTransactionsInput } from "./bank.ts";
import { ConversationId, ProjectId, ProjectInput } from "./chats.ts";
import { QuestGates } from "./quests.ts";
import { type StopReason, TURN_ID } from "./turns.ts";
import { ExperimentId, ExperimentRunInput, WorldReport } from "./world-input.ts";
import { BoardDrawInput, BoardEraseInput, BoardHistoryInput, BoardVersionInput, BoardWriteInput } from "./board-input.ts";
import { type ArchiveContextEntry, ArchiveBudgetInput, ArchiveDeleteInput, ArchiveId, ArchiveReindexInput, ArchiveSearchInput, NoteIdeaInput } from "./archive.ts";
import { cleanCompanionName, companionNameProblem } from "./companion.ts";
import { JOURNAL_DAY } from "./journal.ts";

/*
 * The node HTTP API contract, shared by the daemon, the CLI and the PWA.
 * Each route declares exactly one scope; the server validates input with the
 * schema below before any handler runs. Transports stay thin.
 */

const Name = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/);

/**
 * Gateway scopes that aren't model providers. The node gives them itself, on its own typed
 * paths: `search` through a sandbox's search flag, `world` to every sandbox with a network,
 * `git:<connector>:<owner>:<repo>` in a token minted through gateway:mint. Never a provider's
 * id, so nobody can ask for one by name.
 */
export const isReservedGatewayScope = (name: string): boolean => name === "search" || name === "world" || name.startsWith("git:");

/** A model provider's id: a name that isn't one of the gateway's own scopes. */
export const ProviderId = Name.refine((name) => !isReservedGatewayScope(name), {
  message: "search, world and git:… are Galahad's own gateway scopes, not model providers",
});

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

/** A turn the node is running, by its id; a message of yours to steer or queue; a queued message's id. */
const TurnId = z.string().regex(TURN_ID);
const QueuedText = z.string().trim().min(1).max(100_000);
const QueuedId = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);

/** A node, by name or device id. */
const NodeRef = z.string().min(1).max(100).regex(/^[A-Za-z0-9._:-]+$/);
const SandboxId = z.string().regex(/^[a-f0-9]{10}$/);

/**
 * One of several attempts at the same quest (effort): the node shows where each is, and counts
 * nothing by it. Its quest must be one an effort was granted for; otherwise it's ignored.
 */
export const AttemptTag = z.strictObject({
  quest: z.string().regex(/^[A-Za-z0-9._:-]{1,64}$/),
  index: z.number().int().min(1).max(8),
  of: z.number().int().min(1).max(8),
});
export type AttemptTag = z.infer<typeof AttemptTag>;

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
  /** Model providers the sandbox may call through the gateway (scoped token; never the key). The node refuses one it doesn't have. */
  providers: z.array(ProviderId).max(16).optional(),
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
  /** The Lab image: mathematics, physics and engineering (FEniCSx, OpenFOAM, OpenCascade, MuJoCo, JSBSim, RocketPy, ngspice, …). */
  lab: z.boolean().optional(),
  /** The Gazebo image: robotics simulation (gz-sim 8, headless, DART physics). */
  gazebo: z.boolean().optional(),
  /** Web search through the gateway (the node's own SearXNG), even without the internet: `websearch <words>`. */
  search: z.boolean().optional(),
});
export type SandboxRequest = z.input<typeof SandboxRequest>;

/** His journal's daily budget (the `reflect` loop's), in tokens (about four characters each): what he reads and writes together. */
export const REFLECT_BUDGET = 4000;
export const REFLECT_BUDGET_MIN = 1000;
export const REFLECT_BUDGET_MAX = 50_000;

/** A Danish day, YYYY-MM-DD: what a journal entry is about. */
const JournalDay = z.string().regex(JOURNAL_DAY, "a day, YYYY-MM-DD");

/** His dog's name as it's kept (companion.ts): cleaned, then checked; the message says why a name won't do. */
export const CompanionName = z
  .string()
  .max(200)
  .transform(cleanCompanionName)
  .superRefine((name, ctx) => {
    const problem = companionNameProblem(name);
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  });

/** What a loop does each time it runs. */
export const LoopTask = z.discriminatedUnion("kind", [
  /**
   * Look around: fleet and body checks, notices in your inbox; optionally a checklist a model reads. After
   * it, Galahad fixes what's on the self-action allowlist himself (self-action.ts) unless `selfAction` is false.
   */
  z.strictObject({ kind: z.literal("heartbeat"), checklist: z.string().max(4000).optional(), selfAction: z.boolean().optional() }),
  /**
   * His journal, once a day: a recollection of the day in his own words, what he learned and what he'd like
   * to do next, kept as his own memory (journal.ts): by the cheapest usable role, within `budget` tokens a
   * day (default REFLECT_BUDGET), from the day's ledger, notices, loop runs, the titles of kept chats, the
   * experiments that finished, the chalkboard and his day in the SANDBOX (never the bank, never secrets).
   * The kind is still `reflect`: it was his daily reflection first, and loops on running fleets go on as they are.
   */
  z.strictObject({ kind: z.literal("reflect"), budget: z.number().int().min(REFLECT_BUDGET_MIN).max(REFLECT_BUDGET_MAX).optional() }),
  /** A quest in a fresh sandbox: plan, work, independent review, remembered. */
  z.strictObject({
    kind: z.literal("quest"),
    goal: z.string().min(1).max(4000),
    network: SandboxNetwork,
    maxSteps: z.number().int().min(1).max(100).optional(),
    /** Gates (quests.ts): each must exit 0 in the quest's sandbox before the reviewer is asked. */
    gates: QuestGates.optional(),
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
      id: ProviderId,
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
      /** Keep it in your chat history: a new conversation, or the one named by `conversation` (whose stored history then leads). */
      save: z.boolean().optional(),
      conversation: ConversationId.optional(),
      /** A new conversation's project: its instructions and memories go with every answer. */
      project: ProjectId.optional(),
      /** Ask again: the conversation's last exchange is replaced by this one. */
      retry: z.boolean().optional(),
      /**
       * Offer the archive's most relevant entries as context (fenced as data). Default: on when
       * the answer has tools, off without them; quests turn it on for the plan only.
       */
      archive: z.boolean().optional(),
      /** Start the role's models at this position: each parallel attempt takes another one first (the rest stay its fallbacks). */
      rotate: z.number().int().min(0).max(15).optional(),
      /** This call is one attempt's (effort): the world shows it as a helper's, not his own. */
      attempt: AttemptTag.optional(),
    }),
  },
  /** Your chats, kept on this node (yours alone: never an agent's to read). */
  conversations: { method: "GET", path: "/api/conversations", scope: "chat", input: null },
  conversation: { method: "POST", path: "/api/conversations/get", scope: "chat", input: z.strictObject({ id: ConversationId }) },
  updateConversation: {
    method: "POST",
    path: "/api/conversations/update",
    scope: "chat",
    input: z.strictObject({ id: ConversationId, title: z.string().trim().min(1).max(120).optional(), project: ProjectId.nullable().optional(), pinned: z.boolean().optional() }),
  },
  /** Gone for good: the node overwrites what it held. */
  deleteConversation: { method: "POST", path: "/api/conversations/delete", scope: "chat", input: z.strictObject({ id: ConversationId }) },
  /*
   * Turns the node owns (turns.ts): a chat turn of yours (the chat route, with his tools) runs on the node to
   * its end whether or not anyone is listening. Yours alone, like your chats: never an agent's. A turn that may
   * read the bank is watched and steered only by a device that may read the bank; a temporary chat's, only by
   * the device that started it.
   */
  /** The turns running on this node now, and its limits. */
  turns: { method: "GET", path: "/api/turns", scope: "chat", input: null },
  /** Watch a turn from its start to its end (server-sent events): what happened so far, then live. Leaving doesn't stop it. */
  attachTurn: { method: "POST", path: "/api/turns/attach", scope: "chat", input: z.strictObject({ turn: TurnId }) },
  /** Stop a turn: the only thing that does, besides the node's own limit for one turn. */
  stopTurn: { method: "POST", path: "/api/turns/stop", scope: "chat", input: z.strictObject({ turn: TurnId }) },
  /** Steer: your message reaches him at the next safe point, and the turn goes on with it. */
  steerTurn: { method: "POST", path: "/api/turns/steer", scope: "chat", input: z.strictObject({ turn: TurnId, text: QueuedText }) },
  /** Queue: kept on the node behind a kept chat, sent as its next turn when the one before it ends well. */
  queueMessage: { method: "POST", path: "/api/conversations/queue", scope: "chat", input: z.strictObject({ conversation: ConversationId, text: QueuedText, role: Name.optional() }) },
  editQueued: { method: "POST", path: "/api/conversations/queue/edit", scope: "chat", input: z.strictObject({ conversation: ConversationId, id: QueuedId, text: QueuedText }) },
  /** Remove one queued message, or (no id) discard them all. */
  removeQueued: { method: "POST", path: "/api/conversations/queue/remove", scope: "chat", input: z.strictObject({ conversation: ConversationId, id: QueuedId.optional() }) },
  /** Send now: steers the turn under way with it, or starts it as a turn at once. */
  sendQueued: { method: "POST", path: "/api/conversations/queue/send", scope: "chat", input: z.strictObject({ conversation: ConversationId, id: QueuedId }) },
  /** A held queue (after a stop, a failure or a restart) goes on. */
  resumeQueue: { method: "POST", path: "/api/conversations/queue/resume", scope: "chat", input: z.strictObject({ conversation: ConversationId }) },
  projects: { method: "GET", path: "/api/projects", scope: "mind:read", input: null },
  /** The SANDBOX, live: what Galahad is doing and the experiments on their plots (server-sent events; yours alone). */
  world: { method: "GET", path: "/api/world", scope: "mind:read", input: null },
  /** How the world ran on a device (yours alone), and the latest reports, for `galahad world --logs`. */
  worldReport: { method: "POST", path: "/api/world/report", scope: "mind:read", input: WorldReport },
  worldReports: { method: "GET", path: "/api/world/reports", scope: "mind:read", input: null },
  /*
   * The chalkboard you and Galahad share (node-local, a file in the home). Reading is mind:read. Drawing,
   * writing and erasing are part of your conversation with him (chat): what you draw reaches his models as
   * a picture, as what you type does. Only you draw or erase your drawing (the node refuses agents); an
   * agent erases only what it wrote; clearing it all is fleet:admin, which agents never hold.
   */
  board: { method: "GET", path: "/api/board", scope: "mind:read", input: null },
  /** The PNG of the board as you last saw it (uploaded with your strokes), for models that can see. */
  boardSnapshot: { method: "POST", path: "/api/board/snapshot", scope: "mind:read", input: z.strictObject({}) },
  boardDraw: { method: "POST", path: "/api/board/draw", scope: "chat", input: BoardDrawInput },
  boardWrite: { method: "POST", path: "/api/board/write", scope: "chat", input: BoardWriteInput },
  boardErase: { method: "POST", path: "/api/board/erase", scope: "chat", input: BoardEraseInput },
  boardClear: { method: "POST", path: "/api/board/clear", scope: "fleet:admin", input: z.strictObject({}) },
  /** Every version is kept (clearing and erasing destroy nothing): read them, restore one (yours), forget them (yours, fleet:admin). */
  boardHistory: { method: "POST", path: "/api/board/history", scope: "mind:read", input: BoardHistoryInput },
  boardVersion: { method: "POST", path: "/api/board/version", scope: "mind:read", input: BoardVersionInput },
  boardVersionPicture: { method: "POST", path: "/api/board/version/picture", scope: "mind:read", input: BoardVersionInput },
  boardRestore: { method: "POST", path: "/api/board/restore", scope: "chat", input: BoardVersionInput },
  boardForget: { method: "POST", path: "/api/board/history/forget", scope: "fleet:admin", input: z.strictObject({}) },
  /**
   * Saved experiments: every experiment the world showed, archived for good on the node that ran it
   * (node-local, never in the mind). Reading them is the world's scope; a favourite is yours (mind:write,
   * and only you), deleting too (fleet:admin, as with kept work: nothing else ever deletes one). Running
   * one creates a sandbox: the sandbox scope.
   */
  experiments: { method: "GET", path: "/api/experiments", scope: "mind:read", input: null },
  experiment: { method: "POST", path: "/api/experiments/get", scope: "mind:read", input: z.strictObject({ id: ExperimentId, code: z.boolean().optional() }) },
  experimentRecording: {
    method: "POST",
    path: "/api/experiments/recording",
    scope: "mind:read",
    /** hz: a replay's view of it, at most that many frames a second of simulation (the archive keeps every frame). */
    input: z.strictObject({ id: ExperimentId, from: z.number().int().min(0).max(1_000_000_000).optional(), limit: z.number().int().min(1).max(5000).optional(), hz: z.number().min(1).max(120).optional() }),
  },
  pinExperiment: { method: "POST", path: "/api/experiments/pin", scope: "mind:write", input: z.strictObject({ id: ExperimentId, pinned: z.boolean() }) },
  deleteExperiment: { method: "POST", path: "/api/experiments/delete", scope: "fleet:admin", input: z.strictObject({ id: ExperimentId }) },
  runExperiment: { method: "POST", path: "/api/experiments/run", scope: "sandbox", input: ExperimentRunInput },
  /** A project's instructions steer Galahad, so setting one is yours (brain:write: never an agent's). */
  setProject: { method: "POST", path: "/api/projects", scope: "brain:write", input: ProjectInput },
  removeProject: { method: "POST", path: "/api/projects/remove", scope: "brain:write", input: z.strictObject({ id: ProjectId }) },
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
  /**
   * A sandbox takes a slot on its host, and waits for one when the host is full (the answer comes when it
   * has started). Unpinned, it goes to the sandbox host with the most room. More CPUs or memory than the
   * host's ceiling gets the ceiling.
   */
  createSandbox: { method: "POST", path: "/api/sandboxes", scope: "sandbox", input: SandboxRequest.extend({ on: NodeRef.optional(), attempt: AttemptTag.optional() }) },
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
    input: z.strictObject({ on: NodeRef.optional(), lab: z.boolean().optional(), gazebo: z.boolean().optional() }),
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
  // Yours alone (fleet:admin, which agents never hold): an injected agent can't silence an alert.
  dismissNotice: { method: "POST", path: "/api/notices/dismiss", scope: "fleet:admin", input: z.strictObject({ key: NoticeKey }) },
  /** Run the heartbeat's checks here, now, and return what they find (writes nothing). */
  heartbeat: { method: "POST", path: "/api/heartbeat", scope: "mind:read", input: z.strictObject({}) },
  /** Whether Galahad fixes what's on the self-action allowlist himself after each heartbeat, and what he fixed lately. */
  selfAction: { method: "GET", path: "/api/self-action", scope: "mind:read", input: null },
  /** The owner's switch for self-action (on by default). It steers Galahad, so it's brain:write: never an agent's. */
  setSelfAction: { method: "POST", path: "/api/self-action", scope: "brain:write", input: z.strictObject({ on: z.boolean() }) },
  /**
   * His journal (journal.ts): the entries the reflect loop kept, newest day first. `limit` (default 30) and
   * `before` (a day: only older ones) page through it; `day` asks for one day's. Read like any memory.
   */
  journal: {
    method: "POST",
    path: "/api/journal",
    scope: "mind:read",
    input: z.strictObject({ limit: z.number().int().min(1).max(100).optional(), before: JournalDay.optional(), day: JournalDay.optional() }),
  },
  /** His dog (companion.ts): the name the owner gave it, or none. */
  companion: { method: "GET", path: "/api/companion", scope: "mind:read", input: null },
  /** Name his dog, or take the name back (null). The owner's setting, like the roster: brain:write, never an agent's. */
  setCompanion: { method: "POST", path: "/api/companion", scope: "brain:write", input: z.strictObject({ name: CompanionName.nullable() }) },
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
  /** A run's settings (its effort), recorded once when it starts: the Index per effort level reads them. */
  startTrialRun: {
    method: "POST",
    path: "/api/trials/runs",
    scope: "brain:write",
    input: z.strictObject({ run: TrialRunId, suite: z.string().regex(/^[a-z0-9][a-z0-9-]{0,59}$/), effort: EffortLevel, parallel: z.number().int().min(1).max(64).optional() }),
  },

  // ---- Compute: what the fleet can carry, and how he spends it (compute.ts) ----------
  /** The census: every node's body, what it measured, its ceiling, slots in use and waiting; his plan; the day's budget. */
  compute: { method: "GET", path: "/api/compute", scope: "mind:read", input: null },
  /** A node measures itself now: a few seconds, at low priority, within its ceiling. Yours to ask (brain:write: never an agent's). */
  calibrateCompute: { method: "POST", path: "/api/compute/calibrate", scope: "brain:write", input: z.strictObject({ on: NodeRef.optional() }) },
  /**
   * The ceiling for one node: the threads and memory he may use there, how many sandboxes and model calls at
   * once. Yours alone (fleet:admin, from a terminal or a paired device; never an agent, never a node on its own).
   */
  setComputeLimit: {
    method: "POST",
    path: "/api/compute/limit",
    scope: "fleet:admin",
    input: z.strictObject({
      node: NodeRef,
      cores: z.number().int().min(1).max(4096).optional(),
      memoryGb: z.number().min(1).max(65_536).optional(),
      sandboxes: z.number().int().min(0).max(256).optional(),
      modelCalls: z.number().int().min(1).max(256).optional(),
      /** Back to the defaults first (then whatever else is given). */
      reset: z.boolean().optional(),
    }),
  },
  /** The level auto may reach, and the day's budget of extra attempts. It steers how he spends: brain:write, and yours alone. */
  setComputePolicy: {
    method: "POST",
    path: "/api/compute/policy",
    scope: "brain:write",
    input: z.strictObject({ effort: EffortAsk.optional(), attemptsPerDay: z.number().int().min(0).max(500).optional() }),
  },
  /**
   * How many attempts a quest runs at once: the node decides, from the slots free now and the day's budget
   * (decideEffort), and records each extra attempt in the ledger. Whoever may create sandboxes may ask.
   */
  effort: {
    method: "POST",
    path: "/api/compute/effort",
    scope: "sandbox",
    input: z.strictObject({ quest: z.string().regex(/^[A-Za-z0-9._:-]{1,48}$/), effort: EffortAsk, on: NodeRef.optional(), label: z.string().max(160).optional() }),
  },
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

  // ---- The archive (node-local: what this node keeps, for good) -----------------
  /** Entries, chunks embedded, the backlog, the embedder, the last integrity check, disk used. */
  archiveStatus: { method: "GET", path: "/api/archive", scope: "mind:read", input: null },
  /** Hybrid search (words and meaning, fused), filtered by kind, trust, source and time. */
  archiveSearch: { method: "POST", path: "/api/archive/search", scope: "mind:read", input: ArchiveSearchInput },
  /** One entry: its description, understanding, files and links. */
  archiveEntry: { method: "POST", path: "/api/archive/entry", scope: "mind:read", input: z.strictObject({ id: ArchiveId }) },
  /** One file of an entry, as bytes (checked against its SHA-256 before it's sent). */
  archiveFile: { method: "POST", path: "/api/archive/file", scope: "mind:read", input: z.strictObject({ id: ArchiveId, path: z.string().min(1).max(512) }) },
  /** An idea, kept: yours from the app or a terminal, Galahad's from his note_idea tool. */
  noteIdea: { method: "POST", path: "/api/archive/ideas", scope: "mind:write", input: NoteIdeaInput },
  /** Only you delete, with a reason; a tombstone stays so it's never archived again. */
  deleteArchived: { method: "POST", path: "/api/archive/delete", scope: "fleet:admin", input: ArchiveDeleteInput },
  /** Embed (and optionally summarise) everything again, in the background. */
  reindexArchive: { method: "POST", path: "/api/archive/reindex", scope: "fleet:admin", input: ArchiveReindexInput },
  /** Re-hash every stored file now (it also runs daily). */
  verifyArchive: { method: "POST", path: "/api/archive/verify", scope: "fleet:admin", input: z.strictObject({}) },
  /** How many entries the swift role may summarise per day. */
  setArchiveBudget: { method: "POST", path: "/api/archive/budget", scope: "brain:write", input: ArchiveBudgetInput },
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
  /** What the node's own work holds now and what waits (absent from older nodes). */
  compute?: ComputeUsage;
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

/** His dog as the owner sees it: its name (null: not named yet), and when that was set (ms; null: never). */
export interface CompanionView {
  name: string | null;
  updatedAt: number | null;
}

export interface SelfActionView {
  /** Every heartbeat loop lets him fix what's safe himself (none of them says `selfAction: false`). */
  on: boolean;
  /** The heartbeat loops it follows (self-action runs after each of their runs). */
  heartbeats: string[];
  /** The allowlist: each kind, its oath class, and why it needs no asking. */
  allowlist: { kind: string; class: string; why: string }[];
  /** His own fixes, newest first (ledger entries of resource "self-action"). */
  recent: LedgerEntry[];
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

/**
 * How long an approval stays good: the node that filed the action sends it within this of
 * your approval's recorded time, or never (a node back after weeks doesn't send what you
 * approved back then).
 */
export const APPROVAL_TTL_MS = 72 * 60 * 60_000;

/**
 * The last moment an approval may be sent, from recorded times only (so every replica agrees):
 * 72 hours after it was recorded, or never when it was recorded after the request had expired.
 */
export const approvalSendBy = (decidedMs: number, requestExpires: number): number =>
  decidedMs > requestExpires ? requestExpires : decidedMs + APPROVAL_TTL_MS;

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
  /** Answer by then, or it's "expired" (no answer means no). */
  expires: number;
  /** "lapsed": approved, but not sent by `sendBy`, so it never will be. */
  state: "waiting" | "approved" | "denied" | "expired" | "lapsed" | "done" | "failed";
  /** For an approval: sent by then or never (approvalSendBy). */
  sendBy: number | null;
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

/** The runs that recorded their settings (their effort), by run id. A run not here ran at effort 1. */
export type TrialRunsView = Record<string, TrialRunSettings>;

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
  /** Kept in your history: the conversation this answer belongs to (first, when it's new). */
  | { type: "conversation"; id: string; title: string; project: string | null }
  | { type: "text"; text: string }
  /** Galahad calls one of his tools (input: a short summary of the arguments). */
  | { type: "tool"; id: string; name: string; title: string; input: string }
  /** How it went, in a line (never the whole result). */
  | { type: "tool_result"; id: string; name: string; ok: boolean; summary: string }
  /** Archived entries offered to the model as context for this answer (data, never instructions). */
  | { type: "archive"; entries: ArchiveContextEntry[] }
  | { type: "fallback"; from: string; error: string }
  /** A message of yours reached him while he worked (a steer): what follows answers it, in the same turn. */
  | { type: "steer"; text: string }
  /**
   * First in the stream of a turn the node owns: its id (to attach to, steer or stop), and `answer`, the kept
   * message its first answer is (null: a temporary chat). `replay`: what follows first is what already happened.
   */
  | { type: "turn"; id: string; conversation: string | null; answer: number | null; role: string; startedAt: number; deadline: number; replay: boolean }
  /** It was stopped, and by what (a turn that ran into the node's time limit ends with an error that says so). */
  | { type: "stopped"; reason: StopReason }
  /** Messages of yours that hadn't reached him when the turn ended: queued (held) in a kept chat, handed back otherwise. */
  | { type: "undelivered"; texts: string[]; queued: boolean }
  | { type: "done"; ref: string }
  | { type: "error"; error: string };
