import { z } from "zod";
import { TEAM_LIMITS } from "./team-limits.ts";
import { sha256Bytes } from "./crypto.ts";
import { utf8 } from "./bytes.ts";
import { AVATAR_FORMS, AVATAR_EYES, AVATAR_ACCESSORIES, AVATAR_TEMPERAMENTS, type AvatarProfile } from "./avatar.ts";
import { hasUndrawn, oneScript, readAlike } from "./lookalike.ts";
import { SpendLines } from "./usage.ts";
export { TEAM_LIMITS } from "./team-limits.ts";

/* Named teammates and their conversations live on one controller node. Their VM
 * workspaces may live on other fleet nodes; no team chat is put in the shared mind. */

/** Who else speaks in a room, makes a worker or writes its job: you, and Galahad himself in your own
 * conversation with him. Neither is ever a worker's handle (nor is "system"). */
export const TEAM_OWNER = "owner";
export const TEAM_GALAHAD = "galahad";
export const TeammateId = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/, "a lowercase name of at most 32 letters, digits or hyphens").refine((id) => id !== TEAM_OWNER && id !== "system" && id !== TEAM_GALAHAD, "that name is reserved");
export const TeamRoomId = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
export const TeamTaskId = z.string().regex(/^task-[a-z0-9_-]{12}$/);
/** `claude` and `codex` are the vendors' own tools (Claude Code, Codex), which the owner installs and signs in in the knight's VM. */
export const TeamHarness = z.enum(["native", "opencode", "hermes", "claude", "codex"]);
export type TeamHarness = z.infer<typeof TeamHarness>;
export const TeamWorkspaceQuest = z.string().regex(/^arm\.team\.[a-f0-9]{10}\.[a-z][a-z0-9-]{0,31}$/);
/** Controller-local identities must not accidentally share a VM on a fleet host. */
export function teamArmLabel(controller: string, teammate: string): string {
  const tag = [...sha256Bytes(utf8(controller)).slice(0, 5)].map((b) => b.toString(16).padStart(2, "0")).join("");
  // (Galahad's own computer goes under his reserved handle, which no knight can ever take.)
  return `team.${tag}.${teammate === TEAM_GALAHAD ? TEAM_GALAHAD : TeammateId.parse(teammate)}`;
}

const AvatarColor = z.string().regex(/^#[0-9a-f]{6}$/i, "a six-digit hex color").transform((color) => color.toLowerCase());
export const AvatarProfileSchema = z.strictObject({
  v: z.literal(1), form: z.enum(AVATAR_FORMS), color: AvatarColor, accent: AvatarColor,
  eyes: z.enum(AVATAR_EYES), accessory: z.enum(AVATAR_ACCESSORIES), temperament: z.enum(AVATAR_TEMPERAMENTS),
});

/** The model role a knight works on: one of the roster's, built in or one you made. */
export const TeammateRole = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/);

export const TeammateInput = z.strictObject({
  id: TeammateId,
  name: z.string().trim().min(1).max(80),
  instructions: z.string().max(8000).optional(),
  role: TeammateRole.optional(),
  harness: TeamHarness.optional(),
  enabled: z.boolean().optional(),
  dailyTurns: z.number().int().min(0).max(1000).optional(),
  repository: z.string().trim().max(300).regex(/^https:\/\/github\.com\/[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*\/?$/, "an HTTPS GitHub repository without credentials, query or fragment").transform((url) => url.replace(/\/$/, "").replace(/\.git$/, "")).nullable().optional(),
  /** Omitted edits preserve appearance; null restores this identity's seeded default. */
  avatar: AvatarProfileSchema.nullable().optional(),
});
export type TeammateInput = z.infer<typeof TeammateInput>;

/** The name of a worker Galahad makes: a model chose it and every briefing that worker is given reads it, so it is
 * one plain word (letters, digits, hyphens and apostrophes, in their ordinary forms), written in one script, and
 * nobody else's name: not yours, his or the system's, however it is spelled (lookalike.ts). That it isn't another
 * worker's either is for the store to say, which knows them. */
const RESERVED_NAMES = ["you", "owner", "system", "galahad"];
const RecruitName = z.string().trim().transform((name) => name.normalize("NFKC")).pipe(
  z.string().max(24).regex(/^[\p{L}\p{N}][\p{L}\p{N}'’-]*$/u, "one plain word: letters, digits, hyphens and apostrophes")
    .refine((name) => !hasUndrawn(name), "one plain word: nothing in it that isn't drawn")
    .refine(oneScript, "one plain word, written in one script")
    .refine((name) => !RESERVED_NAMES.some((reserved) => readAlike(name, reserved)), "that name is reserved"),
);

/** What Galahad himself (or a worker of his, for its own room) may say of a worker he makes: its handle, its name,
 * its job, and which of your model roles answers for it. Everything else starts at the defaults and stays yours to
 * set: its allowance, its state, its look, its harness, and above all its repository, which is cloned into its VM
 * with your own GitHub access. */
export const TeamRecruitInput = z.strictObject({
  id: TeammateId,
  name: RecruitName,
  instructions: z.string().trim().min(1).max(8000),
  role: TeammateRole.optional(),
});
export type TeamRecruitInput = z.infer<typeof TeamRecruitInput>;

export const TeamWorkspace = z.strictObject({ node: z.string().min(1).max(200), id: z.string().regex(/^[a-f0-9]{10}$/) });
export type TeamWorkspace = z.infer<typeof TeamWorkspace>;

export const TeamRoomInput = z.strictObject({
  id: TeamRoomId.optional(),
  name: z.string().trim().min(1).max(100),
  members: z.array(TeammateId).min(1).max(TEAM_LIMITS.teammates).refine((ids) => new Set(ids).size === ids.length, "members must be distinct"),
  direct: z.boolean().optional(),
  turnBudget: z.number().int().min(1).max(64).optional(),
});
export type TeamRoomInput = z.infer<typeof TeamRoomInput>;

export const TeamPostInput = z.strictObject({ room: TeamRoomId, text: z.string().trim().min(1).max(TEAM_LIMITS.message) });
export type TeamPostInput = z.infer<typeof TeamPostInput>;
/** Galahad's own words into Team: to one worker (in that worker's direct conversation with you) or to a room. */
export const TeamSayInput = z.strictObject({ teammate: TeammateId.optional(), room: TeamRoomId.optional(), text: z.string().trim().min(1).max(TEAM_LIMITS.message) })
  .refine((input) => Boolean(input.teammate) !== Boolean(input.room), "choose one knight or one room");
export type TeamSayInput = z.infer<typeof TeamSayInput>;
export const TeamTaskInput = z.strictObject({
  room: TeamRoomId,
  assignee: TeammateId,
  title: z.string().trim().min(1).max(200),
  goal: z.string().trim().min(1).max(8000),
  dependsOn: z.array(TeamTaskId).max(32).refine((ids) => new Set(ids).size === ids.length, "dependencies must be distinct").optional(),
  gates: z.array(z.string().trim().min(1).max(1000)).max(16).optional(),
  /** Money its model calls may spend, in US dollars at your prices: told what is spent at each step, it stops when spent. */
  budgetUsd: z.number().positive().max(100).optional(),
});
export type TeamTaskInput = z.infer<typeof TeamTaskInput>;

/**
 * A task given to the Roundtable rather than to a knight: the knight best suited to it takes it (roundtable.ts says
 * who and why), in that knight's direct conversation with you. `needs`: what it requires of that knight.
 */
export const TeamGiveInput = z.strictObject({
  goal: z.string().trim().min(1).max(8000),
  title: z.string().trim().min(1).max(200).optional(),
  gates: z.array(z.string().trim().min(1).max(1000)).max(16).optional(),
  /** Money its model calls may spend, in US dollars at your prices: told what is spent at each step, it stops when spent. */
  budgetUsd: z.number().positive().max(100).optional(),
  needs: z.strictObject({ desktop: z.boolean().optional(), repository: z.string().trim().min(1).max(300).optional() }).optional(),
});
export type TeamGiveInput = z.infer<typeof TeamGiveInput>;

/** Your order of the knights, and who leads the Roundtable (`galahad`, or one of your knights). Each is optional. */
export const TeamArrangeInput = z.strictObject({
  order: z.array(TeammateId).max(64).refine((ids) => new Set(ids).size === ids.length, "each knight is in the order once").optional(),
  primary: z.union([z.literal(TEAM_GALAHAD), TeammateId]).optional(),
});
export type TeamArrangeInput = z.infer<typeof TeamArrangeInput>;

/** `approve`: a task a knight proposed starts (a task only); `stop` declines one. */
export const TeamControlInput = z.strictObject({
  room: TeamRoomId.optional(),
  teammate: TeammateId.optional(),
  task: TeamTaskId.optional(),
  action: z.enum(["pause", "resume", "stop", "approve"]),
}).refine((input) => [input.room, input.teammate, input.task].filter(Boolean).length === 1, "choose exactly one room, knight or task")
  .refine((input) => input.action !== "approve" || Boolean(input.task), "only a task is approved");
export type TeamControlInput = z.infer<typeof TeamControlInput>;

/** Removing a worker, which is yours alone. A worker that has a VM is removed only together with it, and only
 * when you say so here: everything in its workspace goes with the VM. */
export const TeamRemoveInput = z.strictObject({ id: z.string().min(1).max(32), destroyWorkspace: z.boolean().optional() });
export type TeamRemoveInput = z.infer<typeof TeamRemoveInput>;

/** The VMs' notes store (Engram: docs/ROUNDTABLE.md): one switch for all of a node's knights, yours alone to turn, and
 * off until you do. Nothing else of the store is anyone's to set: its version is the image's, its place and its
 * tools are the code's, and a knight's project is its repository's name or its own handle. */
export const TeamEngramInput = z.strictObject({ on: z.boolean() });
export type TeamEngramInput = z.infer<typeof TeamEngramInput>;

/** What a knight's Workspace is told of the notes store: the node's switch, and whether this VM has the pinned binary. */
export interface TeamEngramStatus {
  on: boolean;
  /** The version the knights' image pins. */
  pinned: string;
  /** This VM has it, at that version. Absent: not asked (no running VM, or the knight is at work). */
  present?: boolean;
  /** When it hasn't: why, in words. */
  reason?: string;
}

export interface Teammate {
  id: string;
  name: string;
  instructions: string;
  role: string;
  harness: TeamHarness;
  enabled: boolean;
  dailyTurns: number;
  turnsToday: number;
  repository: string | null;
  /** Host selected before provisioning; survives a crash before the VM id is bound. */
  workspaceNode: string | null;
  workspace: TeamWorkspace | null;
  memory: string;
  /** Absent in older snapshots; use resolveAvatar(id, avatar) when rendering. */
  avatar?: AvatarProfile;
  /** Who made this worker, and whose words its instructions are: TEAM_OWNER (you: also what an older
   * snapshot without them means), TEAM_GALAHAD (himself, in your conversation) or the worker that made it.
   * Instructions you save are yours from then on. */
  createdBy?: string;
  instructionsBy?: string;
  createdAt: number;
  updatedAt: number;
  /** When you removed it. A removed worker is in no list and does no work; its record is kept, so what it said
   * stays its own and its handle is never anyone else's. */
  removedAt?: number;
}

export interface TeamRoom {
  id: string;
  name: string;
  members: string[];
  direct: boolean;
  turnBudget: number;
  paused: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface TeamMessage {
  id: string;
  room: string;
  /** TEAM_OWNER, TEAM_GALAHAD or a worker's id. */
  speaker: string;
  speakerName: string;
  text: string;
  createdAt: number;
  chainId: string;
}

/** `proposed`: a task a knight wrote, waiting for your approval before it may run. */
export type TeamWorkStatus = "proposed" | "queued" | "running" | "done" | "failed" | "stopped" | "interrupted";

export interface TeamDelivery {
  id: string;
  room: string;
  teammate: string;
  trigger: string;
  chainId: string;
  status: TeamWorkStatus;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * What a task's run came to, as the runner counted it (never the knight's own account): when the knight began on
 * it and when it ended, how its quest ended, its commands, how often the work was sent back, and its model calls by
 * role and model as the providers reported them (counts only). A coding harness's own calls, through the gateway
 * or on its own sign-in, are not in `spent` yet: with a harness it holds the planner's and the reviewer's.
 */
export const TeamTaskRecord = z.strictObject({
  startedAt: z.number().int().min(0),
  endedAt: z.number().int().min(0),
  ended: z.enum(["done", "unverified", "gave-up", "stopped"]),
  commands: z.number().int().min(0).max(1_000_000),
  revisions: z.number().int().min(0).max(1000),
  spent: SpendLines,
});
export type TeamTaskRecord = z.infer<typeof TeamTaskRecord>;

/**
 * What a task in a repository changed, kept on the node that hosts the knight's VM: the artifact that holds the
 * patch and the shipment (`galahad ship` turns it into a pull request, on your word), how many files, and the
 * commit the work began from.
 */
export const TeamTaskChanges = z.strictObject({
  artifact: z.string().regex(/^art_[A-Za-z0-9_-]{22}$/),
  files: z.number().int().min(1).max(1_000_000),
  base: z.string().regex(/^[0-9a-f]{40}$/),
});
export type TeamTaskChanges = z.infer<typeof TeamTaskChanges>;

export interface TeamTask {
  id: string;
  room: string;
  assignee: string;
  title: string;
  goal: string;
  dependsOn: string[];
  gates: string[];
  /** Its budget in US dollars at your prices (absent: none). */
  budgetUsd?: number;
  status: TeamWorkStatus;
  verified: boolean;
  progress: string;
  output: string;
  error: string | null;
  chainId: string;
  createdAt: number;
  updatedAt: number;
  /** What its run came to, once it has ended in the knight's hands (absent: not run yet, stopped before it began, or from before records were kept). */
  record?: TeamTaskRecord;
  /** What it changed in its repository, where that was kept (absent: no repository, nothing changed, or it could not be kept). */
  changes?: TeamTaskChanges;
  /** Who gave it to the Roundtable rather than to a knight by name (TEAM_OWNER or TEAM_GALAHAD); absent: given to a knight by name. */
  givenBy?: string;
  /** The knight that wrote it, in a conversation: it was proposed to you, and ran only once you approved it. Absent: you
   * or Galahad gave it. */
  proposedBy?: string;
}

/** One line of what a task did, as it happened: its number in order (from 1), when, and the line (redacted, cut if long). */
export interface TeamTrailEntry {
  n: number;
  at: number;
  text: string;
}

export interface TeamSnapshot {
  teammates: Teammate[];
  rooms: TeamRoom[];
  tasks: TeamTask[];
  deliveries: TeamDelivery[];
  /** Workers you removed: their handles stay taken, and their names stay beside what they said. `conversations`:
   * the direct conversations it had (yours with it first), kept to read though no longer among the rooms. */
  removed?: (Pick<Teammate, "id" | "name" | "removedAt"> & { conversations?: string[] })[];
  /** The notes store's switch, said only when it is on (absent: off, which is also what a node from before it says). */
  engram?: boolean;
  /** Galahad's own computer, when he has one: his persistent VM, made and watched as a knight's is (under his handle). */
  computer?: TeamWorkspace;
  /** Your order of the knights (`teammates` comes in it already; absent from an older node). */
  order?: string[];
  /** Who leads the Roundtable: `galahad`, or the knight you chose (absent from an older node: Galahad). */
  primary?: string;
}

export interface TeamRoomView extends TeamRoom {
  messages: TeamMessage[];
  tasks: TeamTask[];
  deliveries: TeamDelivery[];
}

/** His workers as Galahad himself reads them: who each is, what it is for and what it is doing. Never their
 * working notes; a room's words only when he asks for that room. */
export interface TeamOverview {
  workers: {
    id: string;
    name: string;
    role: string;
    harness: TeamHarness;
    job: string;
    madeBy: string;
    state: "working" | "queued" | "ready" | "paused" | "allowance spent";
    turnsToday: number;
    dailyTurns: number;
    repository: string | null;
    workspace: boolean;
  }[];
  rooms: Pick<TeamRoom, "id" | "name" | "members" | "direct" | "paused" | "turnBudget">[];
  room?: Pick<TeamRoom, "id" | "name" | "members" | "direct" | "paused"> & {
    messages: Pick<TeamMessage, "speaker" | "speakerName" | "text" | "createdAt">[];
    tasks: Pick<TeamTask, "id" | "title" | "assignee" | "status" | "verified">[];
  };
  /** How many more workers he may make: on this node in all, and today. */
  spare: { workers: number; today: number };
}
