import type { ConversationSummary, StoredMessage } from "@galahad/core";

/*
 * Chat history and projects as the app shows them. Pure functions (no DOM), unit-tested.
 */

export interface ChatGroup {
  label: string;
  items: ConversationSummary[];
}

const DAY = 86_400_000;

/** Pinned first, then by when they were last active: today, yesterday, this week, earlier. */
export function groupConversations(list: ConversationSummary[], now = Date.now()): ChatGroup[] {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const today = midnight.getTime();
  const groups: ChatGroup[] = ["Pinned", "Today", "Yesterday", "This week", "Earlier"].map((label) => ({ label, items: [] }));
  for (const c of [...list].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const at = c.updatedAt;
    groups[c.pinned ? 0 : at >= today ? 1 : at >= today - DAY ? 2 : at >= today - 6 * DAY ? 3 : 4]!.items.push(c);
  }
  return groups.filter((g) => g.items.length);
}

/** Every word of the query in the title or the project (any case). */
export function filterConversations(list: ConversationSummary[], query: string): ConversationSummary[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  return list.filter((c) => {
    const text = `${c.title} ${c.project ?? ""}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

export interface KeptStep {
  kind: "asked" | "model" | "fallback" | "tool" | "answer" | "error" | "stopped";
  text: string;
  detail?: string;
  state: "done" | "warn" | "error";
  /** For tool steps: the tool's name (for its icon) and the call's id. */
  tool?: { name: string; id: string };
}

/** A kept answer's steps, as the chat shows them while one streams. */
export function stepsOf(answer: StoredMessage, role: string): KeptStep[] {
  const steps: KeptStep[] = [{ kind: "asked", text: `Asked as ${role}`, state: "done" }];
  for (const s of answer.steps) {
    if (s.kind === "model") steps.push({ kind: "model", text: `Thinking with ${s.ref}`, state: "done" });
    else if (s.kind === "fallback") steps.push({ kind: "fallback", text: `${s.from} didn't answer`, detail: s.error, state: "warn" });
    else {
      const detail = [s.input, s.summary].filter(Boolean).join(" → ");
      steps.push({ kind: "tool", text: s.title, ...(detail ? { detail } : {}), state: s.ok === false ? "warn" : "done", tool: { name: s.name, id: s.id } });
    }
  }
  if (answer.content) steps.push({ kind: "answer", text: "Answering", state: "done" });
  if (answer.status === "error") steps.push({ kind: "error", text: "Couldn't answer", ...(answer.error ? { detail: answer.error } : {}), state: "error" });
  if (answer.status === "stopped") steps.push({ kind: "stopped", text: "Stopped", state: "warn" });
  return steps;
}

/** A project's id from its name: lowercase letters, digits and dashes, unique among those taken. */
export function projectIdFrom(name: string, taken: string[] = []): string {
  const base =
    name
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/æ/g, "ae")
      .replace(/ø/g, "o")
      .replace(/å/g, "a")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 34) || "project";
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n++) if (!taken.includes(`${base}-${n}`)) return `${base}-${n}`;
}
