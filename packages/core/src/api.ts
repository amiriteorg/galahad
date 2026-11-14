import { z } from "zod";
import { ConnectorArgs, ToolName } from "./connectors.ts";
import { ActionId, ArtifactId, ConnectorId, LoopName, LoopStatus, NoticeKey, NoticeSeverity } from "./events.ts";
import { Conclusion, InvestigationId, InvestigationStatus, PredictionOutcome, Preregistration } from "./investigations.ts";
import { MAX_ORDER_DAYS, OrderId, OrderPattern } from "./orders.ts";
import { type Scope, Scope as ScopeSchema } from "./scopes.ts";
import { TrialRecord, TrialRunId, type TrialRunSettings } from "./trials.ts";
import { HarnessOptions, TrialPins, VariantName } from "./trials.ts";
import type { Usage } from "./spend.ts";
import { PricedModel, PriceSchema, SpendLines, type TrialSpent } from "./usage.ts";
import { type ComputeUsage, EffortAsk, EffortLevel } from "./compute.ts";
import { DecisionRequest } from "./decisions.ts";
import { BankBalancesInput, BankCompleteInput, BankTransactionsInput } from "./bank.ts";
import { ConversationId, ProjectId, ProjectInput } from "./chats.ts";
import { TeammateInput, TeamEngramInput, TeamRecruitInput, TeamRemoveInput, TeamRoomId, TeamRoomInput, TeamPostInput, TeamSayInput, TeamTaskId, TeamTaskInput, TeamGiveInput, TeamControlInput, TeamWorkspaceQuest } from "./team.ts";
import { QuestGates, QuestProgressInput } from "./quests.ts";
import { type StopReason, TURN_ID } from "./turns.ts";
import { type ArchiveContextEntry, ArchiveBudgetInput, ArchiveDeleteInput, ArchiveId, ArchiveReindexInput, ArchiveSearchInput, NoteIdeaInput } from "./archive.ts";
import { QuestEvidenceInput, SkillApproveInput, SkillId, SkillLockInput, SkillRetireInput, SkillsBudgetInput, SkillWriteInput } from "./skills-input.ts";
import { NotifyDeviceRef, NotifyPrefsInput, PushSubscriptionInput } from "./notify-input.ts";

/*
 * The node HTTP API contract, shared by the daemon, the CLI and the PWA.
 * Each route declares exactly one scope; the server validates input with the
 * schema below before any handler runs. Transports stay thin.
 */

const Name = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/);

/**
 * Gateway scopes that aren't model providers. The node gives them itself, on its own typed
 * paths: `search` through a sandbox's search flag, `git:<connector>:<owner>:<repo>` in a token
 * minted through gateway:mint. Never a provider's id, so nobody can ask for one by name.
 * `world` is retired (the SANDBOX it served was removed on 14 November 2026): tokens and sandboxes
 * from before still carry it, so it stays reserved and no provider is ever reached under that name.
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
const AsideId = z.string().regex(/^as_[A-Za-z0-9_-]{22}$/);

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
  /** The desktop image: the workshop with a display, a window manager and a browser (`desktop help` inside it). */
  desktop: z.boolean().optional(),
  /** Web search through the gateway (the node's own SearXNG), even without the internet: `websearch <words>`. */
  search: z.boolean().optional(),
});
export type SandboxRequest = z.input<typeof SandboxRequest>;

/** What a loop does each time it runs. */
export const LoopTask = z.discriminatedUnion("kind", [
  /**
   * Look around: fleet and body checks, notices in your inbox; optionally a checklist a model reads. After
   * it, Galahad fixes what's on the self-action allowlist himself (self-action.ts) unless `selfAction` is false.
   */
  z.strictObject({ kind: z.literal("heartbeat"), checklist: z.string().max(4000).optional(), selfAction: z.boolean().optional() }),
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

/**
 * Kinds of task this version no longer has, and what each was. A fleet's mind may still hold a loop with one:
 * it never runs, and every surface that lists it says its task no longer exists (loops.ts' loopRecords).
 */
export const RETIRED_LOOP_TASKS: Readonly<Record<string, string>> = {
  review: "his review of the 3D world, removed with it on 14 November 2026",
  reflect: "his journal, removed on 14 November 2026; what he wrote is still in his memory",
};

/** A place on a knight's screen, in its pixels. */
const ScreenPx = z.number().int().min(0).max(10_000);
/** One thing done on a knight's desktop from outside its VM (`look`: nothing, only the picture). */
export const DesktopAction = z.discriminatedUnion("do", [
  z.strictObject({ do: z.literal("look") }),
  z.strictObject({ do: z.literal("click"), x: ScreenPx, y: ScreenPx, button: z.enum(["left", "right", "middle", "double"]).optional() }),
  z.strictObject({ do: z.literal("move"), x: ScreenPx, y: ScreenPx }),
  z.strictObject({ do: z.literal("scroll"), direction: z.enum(["up", "down"]), times: z.number().int().min(1).max(50).optional() }),
  z.strictObject({ do: z.literal("type"), text: z.string().min(1).max(2000) }),
  z.strictObject({ do: z.literal("key"), keys: z.array(z.string().regex(/^[A-Za-z0-9_+]{1,40}$/)).min(1).max(8) }),
  z.strictObject({ do: z.literal("open"), address: z.string().max(2000).regex(/^(https?:\/\/|file:\/\/|about:)/) }),
]);
export type DesktopAction = z.infer<typeof DesktopAction>;

export const routes = {
  team: { method: "GET", path: "/api/team", scope: "chat", input: null },
  saveTeammate: { method: "POST", path: "/api/team/teammates", scope: "fleet:admin", input: TeammateInput },
  saveTeamRoom: { method: "POST", path: "/api/team/rooms", scope: "fleet:admin", input: TeamRoomInput },
  directTeammate: { method: "POST", path: "/api/team/direct", scope: "fleet:admin", input: z.strictObject({ id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,31}$/) }) },
  teamRoom: { method: "POST", path: "/api/team/room", scope: "chat", input: z.strictObject({ id: z.string().min(1).max(80) }) },
  /** What a task did, as it happened: its kept lines after number `after`, a page at a time, with the task's status now. Yours to read, like a room. */
  teamTrail: { method: "POST", path: "/api/team/trail", scope: "chat", input: z.strictObject({ task: TeamTaskId, after: z.number().int().min(0).max(10_000_000).optional() }) },
  postTeamMessage: { method: "POST", path: "/api/team/messages", scope: "fleet:admin", input: TeamPostInput },
  createTeamTask: { method: "POST", path: "/api/team/tasks", scope: "fleet:admin", input: TeamTaskInput },
  /** A task given to the Roundtable: the knight best suited to it takes it, and the answer says who and why (everyone considered, each with its reasons). */
  giveTeamTask: { method: "POST", path: "/api/team/give", scope: "fleet:admin", input: TeamGiveInput },
  controlTeam: { method: "POST", path: "/api/team/control", scope: "fleet:admin", input: TeamControlInput },
  /** Yours alone, and for good. A worker with a VM goes only with `destroyWorkspace`, from a device that also holds `sandbox`. */
  removeTeammate: { method: "POST", path: "/api/team/remove", scope: "fleet:admin", input: TeamRemoveInput },
  teamMemory: { method: "POST", path: "/api/team/memory", scope: "fleet:admin", input: z.strictObject({ id: z.string().min(1).max(32), text: z.string().max(20000) }) },
  /** The VMs' notes store (Engram) for this node's knights: on or off, and yours alone to say. `team` says when it is on; a knight's `teamWorkspace` says whether its VM has it. */
  teamEngram: { method: "POST", path: "/api/team/engram", scope: "fleet:admin", input: TeamEngramInput },
  /* Galahad's own way to the other knights, from your conversation with him (his tools: team, team_recruit, team_message).
   * Refused to everyone else whatever their scopes, you included: the routes above are yours. */
  teamOverview: { method: "POST", path: "/api/team/overview", scope: "mind:read", input: z.strictObject({ room: TeamRoomId.optional() }) },
  recruitTeammate: { method: "POST", path: "/api/team/recruit", scope: "mind:write", input: TeamRecruitInput },
  sayToTeam: { method: "POST", path: "/api/team/say", scope: "mind:write", input: TeamSayInput },
  /** His work for the Roundtable: the knight best suited to it takes it, as when you give one; within his allowance for the day. */
  giveToTeam: { method: "POST", path: "/api/team/galahad-give", scope: "mind:write", input: TeamGiveInput },
  teamWorkspace: { method: "POST", path: "/api/team/workspace", scope: "sandbox", input: z.strictObject({ id: z.string().min(1).max(32) }) },
  provisionTeammate: {
    method: "POST", path: "/api/team/provision", scope: "fleet:admin",
    input: z.strictObject({
      id: z.string().min(1).max(32), on: NodeRef.optional(), cpus: z.number().min(0.25).max(64).default(1), memoryGb: z.number().min(0.25).max(512).default(2), diskGb: z.number().int().min(1).max(2048).default(20),
      /**
       * What the knight's VM can reach: `online` (the internet and the model gateway: the owner's word is that
       * knights can use the internet) or `gateway` (the model gateway and nothing else). Set when the VM is made:
       * a microVM's network can't be changed afterwards.
       */
      network: z.enum(["online", "gateway"]).default("online"),
      /** A desktop in its VM (a display, a window manager, a browser) for work that needs a screen. Set when the VM is made, or made again. */
      desktop: z.boolean().optional(),
    }),
  },
  /**
   * A knight's VM made again from its image as it is now, on your word: the same VM and `/work`, a new
   * container, so a fix to the image (or a newer tool in it) reaches a knight that was made before it. Its
   * network may be chosen again with it. Refused while the knight is working. Yours alone, like its removal.
   */
  remakeTeammate: {
    method: "POST", path: "/api/team/remake", scope: "fleet:admin",
    input: z.strictObject({ id: z.string().min(1).max(32), network: z.enum(["online", "gateway"]).optional(), /** With a desktop from now on (true), or without one (false); absent: as it is. */ desktop: z.boolean().optional() }),
  },
  /** The same, asked of the node that hosts the VM by the team's controller (never by a knight). */
  remakeTeamWorkspace: {
    method: "POST", path: "/api/team/remake-workspace", scope: "fleet:admin",
    input: z.strictObject({
      id: SandboxId, on: NodeRef.optional(), quest: TeamWorkspaceQuest, providers: z.array(z.string().min(1).max(64)).max(16), network: z.enum(["online", "gateway"]).optional(), desktop: z.boolean().optional(),
      /** The device whose word it was, when a node passes the request on to the VM's host. */
      onBehalfOf: z.string().max(100).optional(),
    }),
  },
  /**
   * A knight's desktop, for you to watch and to take over (to sign in for it, to get it past something): one
   * thing done there, or nothing (`look`), and a picture of the screen back. Yours alone. What you type is carried
   * to the VM and never written to the ledger.
   */
  teamDesktop: { method: "POST", path: "/api/team/desktop", scope: "sandbox", input: z.strictObject({ id: z.string().min(1).max(32), action: DesktopAction.default({ do: "look" }) }) },
  /** The same, asked of the node that hosts the VM by the team's controller. */
  teamDesktopOn: { method: "POST", path: "/api/team/desktop-workspace", scope: "sandbox", input: z.strictObject({ id: SandboxId, on: NodeRef.optional(), quest: TeamWorkspaceQuest, action: DesktopAction }) },
  prepareTeamWorkspace: {
    method: "POST", path: "/api/team/prepare-workspace", scope: "fleet:admin",
    input: z.strictObject({ id: SandboxId, on: NodeRef.optional(), quest: TeamWorkspaceQuest, repository: z.string().regex(/^https:\/\/github\.com\/[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}\/?$/).optional() }),
  },
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
      /** This call is one attempt's (effort): the census counts it as that attempt's, not his own. */
      attempt: AttemptTag.optional(),
      /**
       * This call is a quest of his own (its planner's or its engineer's): the skills that bear on its goal go
       * with it, fenced as data, chosen once and the same for every call of that quest (skills.ts), and their
       * use is counted against it. Only his own quests (yours from a terminal, a loop's): never an agent's.
       */
      quest: z.strictObject({ id: z.string().regex(/^[A-Za-z0-9._:-]{1,64}$/), goal: z.string().min(1).max(4000) }).optional(),
      /**
       * This call is coding work (a quest's planner, engineer or reviewer): a coding plan's models may answer
       * it, called as Galahad. Without it a plan's models are passed over, as for any talk with him.
       */
      coding: z.boolean().optional(),
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
  /**
   * A side question: answered (server-sent events) from what a chat holds and what its running turn has said
   * and done so far, without his tools, and added to nothing. The working turn never sees it unless you
   * bring it back. Names a kept chat, or a running turn (a temporary chat's).
   */
  askAside: {
    method: "POST",
    path: "/api/turns/aside",
    scope: "chat",
    input: z
      .strictObject({ conversation: ConversationId.optional(), turn: TurnId.optional(), question: z.string().trim().min(1).max(4000) })
      .refine((input) => Boolean(input.conversation) !== Boolean(input.turn), "name a conversation or a turn (one of them)"),
  },
  /** Bring a side question and its answer back: the turn under way is steered with them; with none running, they join the kept chat. */
  bringBack: { method: "POST", path: "/api/turns/aside/bring", scope: "chat", input: z.strictObject({ aside: AsideId }) },
  /** The quests in hand on this node and the ones that just ended: each one's plan, the step he's on, its gates' last results. */
  quests: { method: "GET", path: "/api/quests", scope: "mind:read", input: null },
  /** Whoever runs a quest says where it stands (whoever may run its sandbox may: the sandbox scope). */
  questProgress: { method: "POST", path: "/api/quests/progress", scope: "sandbox", input: QuestProgressInput },
  projects: { method: "GET", path: "/api/projects", scope: "mind:read", input: null },
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
    input: z.strictObject({ on: NodeRef.optional(), lab: z.boolean().optional(), gazebo: z.boolean().optional(), desktop: z.boolean().optional() }),
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
  /**
   * The doctor (doctor.ts): one look at this node's whole installation, answered in plain lines (ok, needs you,
   * broken) with what to do for anything that isn't ok. It changes nothing. `quick`: only what costs nothing to
   * look at; `offline`: no model is asked and no connector's service probed. Yours alone (fleet:admin, from a
   * terminal or a paired device; never an agent, never another node): a full check asks each role's model a word.
   */
  doctor: { method: "POST", path: "/api/doctor", scope: "fleet:admin", input: z.strictObject({ quick: z.boolean().optional(), offline: z.boolean().optional() }) },
  /** Whether Galahad fixes what's on the self-action allowlist himself after each heartbeat, and what he fixed lately. */
  selfAction: { method: "GET", path: "/api/self-action", scope: "mind:read", input: null },
  /** The owner's switch for self-action (on by default). It steers Galahad, so it's brain:write: never an agent's. */
  setSelfAction: { method: "POST", path: "/api/self-action", scope: "brain:write", input: z.strictObject({ on: z.boolean() }) },
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
  recordTrial: {
    method: "POST",
    path: "/api/trials",
    scope: "brain:write",
    /** `spent`: what its model calls came to, by role and model (counts only), recorded beside it (`trial.spent`). */
    input: TrialRecord.extend({ spent: SpendLines.optional() }),
  },
  /** A run's settings (its effort, what it pinned, its variant, its budget), recorded once when it starts: the reports read them. */
  startTrialRun: {
    method: "POST",
    path: "/api/trials/runs",
    scope: "brain:write",
    input: z.strictObject({
      run: TrialRunId,
      suite: z.string().regex(/^[a-z0-9][a-z0-9-]{0,59}$/),
      effort: EffortLevel,
      parallel: z.number().int().min(1).max(64).optional(),
      pins: TrialPins.optional(),
      variant: z.strictObject({ name: VariantName, options: z.strictObject(HarnessOptions.shape) }).optional(),
      seed: z.number().int().min(0).max(0xffffffff).optional(),
      group: z.string().regex(/^g-[a-z0-9]{1,16}$/).optional(),
      budget: z.strictObject({ tokens: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(), usd: z.number().min(0).max(1_000_000).optional() }).optional(),
    }),
  },
  // ---- What model calls cost (usage.ts): tokens as the providers report them, money at your prices ----
  /** Your prices, per model, in US dollars per million tokens. */
  prices: { method: "GET", path: "/api/prices", scope: "mind:read", input: null },
  /** State a model's price (yours to state, never an agent's: it decides what "cheaper" means). `<provider>/*` prices all of a provider's models. */
  setPrice: { method: "POST", path: "/api/prices", scope: "brain:write", input: z.strictObject({ model: PricedModel, ...z.strictObject(PriceSchema.shape).shape }) },
  removePrice: { method: "POST", path: "/api/prices/remove", scope: "brain:write", input: z.strictObject({ model: PricedModel }) },
  /** This node's own count of its model calls, by day, who asked, role and model (never a prompt or an answer), and your prices. */
  usage: { method: "POST", path: "/api/usage", scope: "mind:read", input: z.strictObject({ days: z.number().int().min(1).max(366).optional() }) },

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

  // ---- His skills (skills.ts): how he did a kind of work, as words he reads --------
  /** Every skill with its state, uses and track record, and the day's budget for distilling. Read like any memory. */
  skills: { method: "GET", path: "/api/skills", scope: "mind:read", input: null },
  /** One skill in full: every version kept, where each came from, and the quests it was given to. */
  skill: { method: "POST", path: "/api/skills/get", scope: "mind:read", input: z.strictObject({ id: SkillId }) },
  /**
   * Write a skill, or a new version of one. Who asks decides its trust, never the caller's say: yours are
   * owner; what he writes when asked in a chat, and what another agent proposes, is untrusted and waits for you.
   */
  writeSkill: { method: "POST", path: "/api/skills", scope: "mind:write", input: SkillWriteInput },
  /**
   * A quest of his has ended: its outcome is recorded against the skills it was given, and if its review
   * passed, one bounded call distils at most one skill from its evidence. His own quests only.
   */
  learnSkill: { method: "POST", path: "/api/skills/learn", scope: "mind:write", input: QuestEvidenceInput },
  /** Yours alone: approve exactly the version you read (an untrusted skill is given to no model before that). */
  approveSkill: { method: "POST", path: "/api/skills/approve", scope: "fleet:admin", input: SkillApproveInput },
  /** Yours alone: locked, he may use it but not change it. */
  lockSkill: { method: "POST", path: "/api/skills/lock", scope: "fleet:admin", input: SkillLockInput },
  /** Yours alone: retired, it's kept and never offered (nothing is deleted); put back with `retired: false`. */
  retireSkill: { method: "POST", path: "/api/skills/retire", scope: "fleet:admin", input: SkillRetireInput },
  /** Yours alone: one step back, to the version before the latest. */
  rollbackSkill: { method: "POST", path: "/api/skills/rollback", scope: "fleet:admin", input: z.strictObject({ id: SkillId }) },
  /** The day's budget for distilling skills, in tokens (0: he distils none). */
  setSkillsBudget: { method: "POST", path: "/api/skills/budget", scope: "brain:write", input: SkillsBudgetInput },
  // ---- Notifications: he comes to you, on your own paired devices (notify.ts; node-local) ----------
  /*
   * Yours alone, every one of them: the node refuses agents and other nodes whatever their scopes. No route takes a
   * title or a line: what a notification says comes only from the node's own records, through its own rules.
   */
  /** Who is notified (devices by name, never an endpoint), what he sends and when he stays silent, what was sent today, and this node's public key to subscribe to. */
  notify: { method: "GET", path: "/api/notify", scope: "mind:read", input: null },
  /** What he sends and when he stays silent: the kinds, quiet hours, the day's limit. It steers him: brain:write, never an agent's. */
  setNotify: { method: "POST", path: "/api/notify", scope: "brain:write", input: NotifyPrefsInput },
  /** This device turns notifications on, for itself: its browser's push subscription, kept as that device's. Only a paired device may, and only its own. */
  pushSubscribe: { method: "POST", path: "/api/notify/subscribe", scope: "mind:read", input: PushSubscriptionInput },
  /** Off again: this device's own; another's by id only from a terminal or a device that may administer the fleet. */
  pushUnsubscribe: { method: "POST", path: "/api/notify/unsubscribe", scope: "mind:read", input: z.strictObject({ device: NotifyDeviceRef.optional() }) },
  /** One fixed test message: to the device that asks, or from a terminal to every subscribed device (or the one named). */
  notifyTest: { method: "POST", path: "/api/notify/test", scope: "mind:read", input: z.strictObject({ device: NotifyDeviceRef.optional() }) },
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
  /** null when this node can't read the task (a newer version's, or one this version no longer has): `problem` says which. */
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
  /** What its model calls came to, by role and model (absent: recorded before calls were counted). */
  spent?: TrialSpent;
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
  /**
   * One model call's tokens, as its provider reported them when the call ended (null: it reported nothing,
   * which is said as unknown, never estimated). Counts only: nothing of the prompt or the answer.
   */
  | { type: "usage"; ref: string; usage: Usage | null }
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
  /** First in a side question's stream: its id, to bring it back by. */
  | { type: "aside"; id: string }
  | { type: "done"; ref: string }
  | { type: "error"; error: string };
