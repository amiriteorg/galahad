import { z } from "zod";
import type { AttachmentRef } from "./api.ts";
import type { AnswerStatus, ChatNeeds, ChatState, QueuedMessage, QueueHold, TurnView } from "./turns.ts";

/*
 * Chat history and projects.
 *
 * A conversation lives on the node that served it (a private database there): every
 * device and the terminal see the same history through that node, and deleting one
 * deletes it. Only you read it (never an agent), and a conversation where Galahad read
 * the bank is shown only to a device that may read the bank.
 *
 * A project is a workspace that every node knows (the mind, `project.set`): a name,
 * the instructions Galahad follows in its chats, an optional repository. Its chats and
 * the memories made in them are grouped under it.
 */

export const ProjectId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "lowercase letters, digits and - (max 40)");
export const ConversationId = z.string().regex(/^cv_[A-Za-z0-9_-]{22}$/);

export const ProjectInput = z.strictObject({
  id: ProjectId,
  name: z.string().trim().min(1).max(80),
  instructions: z.string().max(8000).optional(),
  /** An https URL of the project's repository (null: none). */
  repo: z.string().url().max(300).regex(/^https:\/\//, "an https:// URL").nullable().optional(),
});

export interface ProjectView {
  id: string;
  name: string;
  instructions: string;
  repo: string | null;
  /** Where its work is kept on his computer (`projectCheckout`): the Build view's files, changes and branch are that folder's. */
  checkout: string;
  updatedAt: number;
}

/** A project's checkout on Galahad's computer: one folder per project, under /work. */
export const projectCheckout = (id: string): string => `/work/projects/${id}`;

/** A branch's name as git takes one (its own check runs too): letters, digits and . _ / -, never starting with - . or /. */
export const BranchName = z
  .string()
  .min(1)
  .max(100)
  .regex(/^(?![-./])[A-Za-z0-9._/-]+$/, "letters, digits and . _ / -")
  .refine((name) => !name.includes("..") && !name.endsWith("/") && !name.endsWith(".") && !name.endsWith(".lock"), "not a branch name git takes");
/** The Build view's git, yours alone, on a project's checkout: its state, a branch to switch to or start, a commit, the first clone. */
export const ProjectGitInput = z.strictObject({ id: ProjectId });
export const ProjectBranchInput = z.strictObject({ id: ProjectId, branch: BranchName, create: z.boolean().default(false) });
export const ProjectCommitInput = z.strictObject({ id: ProjectId, message: z.string().trim().min(1).max(2000) });

/** A project's checkout as git has it (`POST /api/projects/git`). */
export interface ProjectGitView {
  checkout: string;
  /** missing: no folder yet (Set up clones it); not-a-repository: a folder git doesn't know. */
  state: "ready" | "missing" | "not-a-repository";
  /** Null when detached, or not ready. */
  branch: string | null;
  head: string | null;
  /** Its branches, the latest worked on first. */
  branches: string[];
  /** Files changed or new, not yet committed. */
  changed: number;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
  /** origin's address, with any credentials in it taken out. */
  remote: string | null;
  /** Its latest commits, newest first. */
  log: { sha: string; subject: string; at: number }[];
}

/** One step of an answer, as the chat streamed it (kept with the answer). */
export type StoredStep =
  | { kind: "model"; ref: string }
  | { kind: "fallback"; from: string; error: string }
  | { kind: "tool"; id: string; name: string; title: string; input: string; ok: boolean | null; summary: string | null }
  /** Archived entries Galahad was given as context for this answer. */
  | { kind: "archive"; entries: { id: string; title: string; kind: string; trust: string }[] };

export interface StoredMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  /** Your files with it, as kept on the node (a message of yours alone). */
  attachments?: AttachmentRef[];
  /** Assistant answers: which model, what it did, how it ended. */
  model: string | null;
  steps: StoredStep[];
  /** "steered": you sent a message while he was answering; the turn went on with it, in the next answer. */
  status: AnswerStatus;
  error: string | null;
  createdAt: number;
  endedAt: number | null;
}

export interface ConversationSummary {
  id: string;
  title: string;
  project: string | null;
  /** The roster role it was asked as. */
  role: string;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  /** How many messages it holds. */
  count: number;
  /** Galahad read the bank in it: shown only to devices that may read the bank. */
  bank: boolean;
  /** Where it stands, at a glance (turns.ts): working, waiting on you, queued, stopped, failed or done. */
  state: ChatState;
  /** Messages of yours queued behind it, and why they're held (null: they go when the turn before them ends). */
  queued: number;
  held: QueueHold | null;
  /** What it waits on you for (null: nothing). */
  needs: ChatNeeds | null;
}

export interface ConversationView extends ConversationSummary {
  messages: StoredMessage[];
  /** The turn the node is running in it now (attach to watch it), if any. */
  turn: TurnView | null;
  /** Your queued messages, in the order they'll be sent. */
  queue: QueuedMessage[];
}

/** A title from the first thing you asked: its first line, at most 60 characters. */
export function titleFrom(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 60 ? `${line.slice(0, 59).trimEnd()}…` : line || "New chat";
}
