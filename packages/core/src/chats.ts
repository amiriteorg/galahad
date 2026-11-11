import { z } from "zod";

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
  updatedAt: number;
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
  /** Assistant answers: which model, what it did, how it ended. */
  model: string | null;
  steps: StoredStep[];
  status: "done" | "error" | "stopped" | "streaming";
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
}

export interface ConversationView extends ConversationSummary {
  messages: StoredMessage[];
}

/** A title from the first thing you asked: its first line, at most 60 characters. */
export function titleFrom(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 60 ? `${line.slice(0, 59).trimEnd()}…` : line || "New chat";
}
