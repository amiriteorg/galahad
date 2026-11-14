/*
 * A notification's payload: the small JSON the node encrypts to a browser and the service
 * worker turns into a notification. Its own file, with no imports, because the service
 * worker reads it at its boundary and should carry nothing else.
 */

export const NOTIFY_KINDS = ["needs-you", "approval", "finished", "question"] as const;
export type NotifyKind = (typeof NOTIFY_KINDS)[number];

/** Where a notification opens the app. A fixed list: a payload can't name anything else. */
export const NOTIFY_OPENS = ["inbox", "chat", "overview", "settings"] as const;
export type NotifyOpen = (typeof NOTIFY_OPENS)[number];

export const NOTIFY_TITLE_MAX = 60;
export const NOTIFY_BODY_MAX = 140;
const CONVERSATION = /^cv_[A-Za-z0-9_-]{22}$/;
const TAG = /^[A-Za-z0-9._:-]{1,64}$/;
/** A kept chat's id, and a notification's tag, as a payload may carry them. */
export const isConversationId = (id: string): boolean => CONVERSATION.test(id);
export const isNotifyTag = (tag: string): boolean => TAG.test(tag);

export interface NotifyPayload {
  v: 1;
  /** What it's about: one of the kinds, several at once, the day's limit, or your own test. */
  kind: NotifyKind | "summary" | "limit" | "test";
  title: string;
  body: string;
  open: NotifyOpen;
  /** A kept chat to open (with `open: "chat"`). */
  conversation?: string;
  /** The same thing told again replaces its notification rather than stacking. */
  tag: string;
}

/** What's shown when a push can't be read as a notification of ours: browsers require one, and it must mean something. */
export const GENERIC_NOTIFICATION: NotifyPayload = { v: 1, kind: "needs-you", title: "Galahad", body: "Something needs you. Open the app to see it.", open: "inbox", tag: "galahad" };

const KINDS = new Set<string>([...NOTIFY_KINDS, "summary", "limit", "test"]);
// Control characters, bidirectional overrides and isolates, zero-width characters: nothing a lock screen should act on.
const HIDDEN = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g;

/** Text as a notification may carry it: one line, nothing hidden, cut to `max`. */
export function notifyClean(text: string, max: number): string {
  const line = text.replace(HIDDEN, " ").replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/**
 * A payload read strictly (the service worker's boundary, and the node's last look before it
 * encrypts): exactly the fields above, bounded, nothing hidden in the text. Anything else is no payload.
 */
export function readNotifyPayload(raw: unknown): NotifyPayload | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const p = raw as Record<string, unknown>;
  const allowed = new Set(["v", "kind", "title", "body", "open", "conversation", "tag"]);
  if (Object.keys(p).some((key) => !allowed.has(key))) return null;
  if (p.v !== 1 || typeof p.kind !== "string" || !KINDS.has(p.kind)) return null;
  if (typeof p.title !== "string" || typeof p.body !== "string" || typeof p.tag !== "string" || !TAG.test(p.tag)) return null;
  if (typeof p.open !== "string" || !(NOTIFY_OPENS as readonly string[]).includes(p.open)) return null;
  if (p.conversation !== undefined && (typeof p.conversation !== "string" || !CONVERSATION.test(p.conversation) || p.open !== "chat")) return null;
  const title = notifyClean(p.title, NOTIFY_TITLE_MAX);
  const body = notifyClean(p.body, NOTIFY_BODY_MAX);
  if (!title || title !== p.title || body !== p.body) return null;
  return { v: 1, kind: p.kind as NotifyPayload["kind"], title, body, open: p.open as NotifyOpen, ...(p.conversation ? { conversation: p.conversation as string } : {}), tag: p.tag };
}

/** The address a notification opens, within the app's own origin. */
export const notifyUrl = (payload: Pick<NotifyPayload, "open" | "conversation">): string => `/#/${payload.open}${payload.conversation ? `?c=${payload.conversation}` : ""}`;

/** A kept chat named in the app's address by a notification ("#/chat?c=cv_…"), or null. */
export function conversationFromHash(hash: string): string | null {
  const id = /^#\/chat\?c=([A-Za-z0-9_-]+)$/.exec(hash)?.[1] ?? null;
  return id && CONVERSATION.test(id) ? id : null;
}
