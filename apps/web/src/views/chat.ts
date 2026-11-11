import type { ChatMessage, ConversationSummary, ConversationView, ProjectView } from "@galahad/core";
import { findSecrets } from "@galahad/core/secret-scan";
import { type Api, ApiError, isAbort } from "../api.ts";
import { errorMessage, type View } from "../context.ts";
import { filterConversations, groupConversations, stepsOf } from "../lib/chats.ts";
import { plural } from "../lib/text.ts";
import { duration, relativeTime } from "../lib/time.ts";
import { lastRole, rememberRole } from "../prefs.ts";
import type { RoleSpec } from "../types.ts";
import { badge, button, callout, copyText, empty, skeletonRows } from "../ui/controls.ts";
import { confirmAction, openSheet } from "../ui/dialog.ts";
import { debounce, h, replace } from "../ui/dom.ts";
import { emblem } from "../ui/emblem.ts";
import { icon, type IconName } from "../ui/icons.ts";
import { renderMarkdown } from "../ui/markdown.ts";
import { selector, type SelectorGroup } from "../ui/selector.ts";
import { signal } from "../ui/signal.ts";
import { toast } from "../ui/toast.ts";
import { openAddKey } from "./vault.ts";

/*
 * Chat. The conversation lives in this page's memory only: it is never
 * written to localStorage or IndexedDB, and it's gone when the tab closes.
 * A stream keeps running if you look at another page, and Stop is always
 * one click (or Esc) away, here or in the top bar.
 */

type StepState = "active" | "done" | "warn" | "error";
interface Step {
  icon: IconName;
  text: string;
  detail?: string;
  state: StepState;
  /** A tool call's id (tool steps only). */
  tool?: string;
}

/** Which icon a tool's step shows. */
function toolIcon(name: string): IconName {
  if (name.startsWith("bank_")) return "bank";
  if (name.startsWith("sandbox_")) return "sandbox";
  if (name.startsWith("connector")) return "plug";
  if (name.startsWith("artifact")) return "archive";
  const icons: Record<string, IconName> = { recall: "memory", remember: "memory", web_search: "globe", fleet: "fleet", place: "fleet", loops: "repeat", notices: "inbox", ledger: "activity", decide: "compass", request_secret: "key" };
  return icons[name] ?? "zap";
}

interface Turn {
  id: number;
  role: "user" | "assistant";
  content: string;
  /** The roster role that answered (assistant turns). */
  as?: string;
  model?: string;
  steps: Step[];
  status: "streaming" | "done" | "error" | "stopped";
  error?: string;
  fallbacks: number;
  startedAt: number;
  endedAt?: number;
}

const DEFAULT_ROLES: Record<string, RoleSpec> = {
  planner: { models: [], configured: false, description: "decomposes quests, makes judgment calls, talks to you" },
  engineer: { models: [], configured: false, description: "writes and changes code" },
  reviewer: { models: [], configured: false, description: "independent check, ideally a different model family" },
  swift: { models: [], configured: false, description: "cheap and fast: routing, classification, summaries" },
};
const ROLE_ICON: Record<string, IconName> = { planner: "compass", engineer: "code", reviewer: "review", swift: "zap", decider: "sparkle" };
const roleTitle = (name: string): string => name[0]!.toUpperCase() + name.slice(1);
/** A model as people say it: "claude-opus-5-5" for anthropic/claude-opus-5-5, "ollama" for ollama/*. */
export const modelName = (ref: string | undefined): string => {
  if (!ref) return "";
  const [provider, ...rest] = ref.split("/");
  const model = rest.join("/");
  return !model || model === "*" ? (provider ?? ref) : model;
};
/** Why a role can't answer a chat, if it can't. */
function roleProblem(name: string): string | null {
  if (name === "decider") return "Answers typed decisions, not chat";
  if (roster && roster[name] && !roster[name]!.models.length) return "No model hired yet";
  return null;
}

// ---- module state: survives navigation; the conversation itself is kept by the node ----
let turns: Turn[] = [];
let nextId = 1;
let controller: AbortController | null = null;
let draft = "";
let role = lastRole() ?? "planner";
let roster: Record<string, RoleSpec> | null = null;
const changed = new Set<(turn: Turn | null) => void>();

/** The kept conversation on screen (null: a new one, kept from its first answer, unless temporary). */
interface Current {
  id: string;
  title: string;
  project: string | null;
  bank: boolean;
  pinned: boolean;
}
let current: Current | null = null;
/** Not kept anywhere: gone when you start another chat or close the tab. */
let temporary = false;
/** The project a new conversation starts in. */
let startIn: string | null = null;
/** Your chats and projects, as last fetched. */
let kept: ConversationSummary[] | null = null;
let projects: ProjectView[] | null = null;
const keptChanged = new Set<() => void>();

async function refreshKept(api: Api): Promise<void> {
  try {
    kept = (await api.get<{ conversations: ConversationSummary[] }>("/api/conversations")).conversations;
    const mine = current && kept.find((c) => c.id === current!.id);
    if (mine) current = { id: mine.id, title: mine.title, project: mine.project, bank: mine.bank, pinned: mine.pinned };
    for (const fn of keptChanged) fn();
  } catch {
    // A node without chat history yet (or out of reach): chats still work; no recent ones to show.
    if (kept === null) {
      kept = [];
      for (const fn of keptChanged) fn();
    }
  }
}

async function refreshProjects(api: Api): Promise<void> {
  try {
    projects = (await api.get<{ projects: ProjectView[] }>("/api/projects")).projects;
    for (const fn of keptChanged) fn();
  } catch {
    /* projects need mind:read */
  }
}

/** For the command palette: your kept chats and projects, fetched once when nothing is known yet. */
export function chatsForPalette(api: Api, can: { chat: boolean; read: boolean }): { chats: ConversationSummary[]; projects: ProjectView[] } {
  if (can.chat && kept === null) void refreshKept(api);
  if (can.read && projects === null) void refreshProjects(api);
  return { chats: kept ?? [], projects: projects ?? [] };
}

/** A kept conversation, back on screen with its answers' steps. */
export async function openConversation(api: Api, id: string): Promise<void> {
  if (controller) return;
  const { conversation } = await api.post<{ conversation: ConversationView }>("/api/conversations/get", { id });
  turns = conversation.messages.map((m) => {
    const steps: Step[] =
      m.role === "assistant"
        ? stepsOf(m, conversation.role).map((s) => ({
            icon: s.tool ? toolIcon(s.tool.name) : (STEP_ICON[s.kind] ?? "check"),
            text: s.text,
            ...(s.detail ? { detail: s.detail } : {}),
            state: s.state,
            ...(s.tool ? { tool: s.tool.id } : {}),
          }))
        : [];
    return {
      id: nextId++,
      role: m.role,
      content: m.content,
      as: conversation.role,
      ...(m.model ? { model: m.model } : {}),
      steps,
      status: m.status === "streaming" ? "stopped" : m.status,
      ...(m.error ? { error: m.error } : {}),
      fallbacks: m.steps.filter((s) => s.kind === "fallback").length,
      startedAt: m.createdAt,
      ...(m.endedAt ? { endedAt: m.endedAt } : {}),
    };
  });
  current = { id: conversation.id, title: conversation.title, project: conversation.project, bank: conversation.bank, pinned: conversation.pinned };
  temporary = false;
  startIn = null;
  emit(null);
  for (const fn of keptChanged) fn();
}

const STEP_ICON: Record<string, IconName> = { asked: "arrow-up", model: "models", fallback: "alert", answer: "chat", error: "x-circle", stopped: "stop" };

/** For the shell: whether Galahad is answering right now, and with which model. */
export const chatActivity = signal<{ streaming: boolean; model: string | null }>({ streaming: false, model: null });

const emit = (turn: Turn | null) => {
  for (const fn of changed) fn(turn);
};

export function stopChat(): void {
  controller?.abort();
}

/** A new conversation (in the same project, unless told otherwise); returns a function that brings the last one back (for Undo). */
export function newConversation(project: string | null = current?.project ?? startIn): () => void {
  stopChat();
  const saved = { turns, current, startIn, temporary };
  turns = [];
  current = null;
  startIn = project;
  emit(null);
  for (const fn of keptChanged) fn();
  return () => {
    if (turns.length) return;
    ({ turns, current, startIn, temporary } = saved);
    emit(null);
    for (const fn of keptChanged) fn();
  };
}

/** "New chat" from anywhere. A kept chat stays in your history; a temporary one can be brought back once. */
export function startNewChat(): void {
  if (!turns.length) return;
  const wasTemporary = temporary && !current;
  const restore = newConversation();
  if (wasTemporary) toast("Temporary chat cleared", { action: { label: "Undo", run: restore } });
}

const toolCount = (turn: Turn): number => turn.steps.filter((s) => s.tool).length;

function step(turn: Turn, next: Step): void {
  const last = turn.steps.at(-1);
  if (last?.state === "active") last.state = "done";
  turn.steps.push(next);
}

async function run(api: Api, turn: Turn, again = false): Promise<void> {
  controller = new AbortController();
  chatActivity.set({ streaming: true, model: null });
  const history: ChatMessage[] = turns
    .filter((t) => t !== turn && t.content && t.status !== "error" && t.id < turn.id)
    .map((t) => ({ role: t.role, content: t.content }));
  // A kept conversation: the node holds what was said, so only the question goes. A new one is kept from now (unless temporary).
  const body = current
    ? { role: turn.as, conversation: current.id, messages: history.slice(-1), ...(again ? { retry: true } : {}) }
    : temporary
      ? { role: turn.as, messages: history }
      : { role: turn.as, save: true, messages: history, ...(startIn ? { project: startIn } : {}) };
  step(turn, { icon: "arrow-up", text: `Asked as ${turn.as}`, state: "done" });
  try {
    for await (const event of api.chat(body, controller.signal)) {
      if (event.type === "conversation") {
        current = { id: event.id, title: event.title, project: event.project, bank: false, pinned: false };
        startIn = null;
        for (const fn of keptChanged) fn();
      } else if (event.type === "model") {
        turn.model = event.ref;
        chatActivity.set({ streaming: true, model: event.ref });
        step(turn, { icon: "models", text: `Thinking with ${event.ref}`, state: "active" });
      } else if (event.type === "fallback") {
        turn.fallbacks++;
        const last = turn.steps.at(-1);
        if (last?.state === "active") {
          last.state = "warn";
          last.text = `${event.from} didn't answer`;
          last.detail = event.error;
        } else step(turn, { icon: "alert", text: `${event.from} didn't answer`, detail: event.error, state: "warn" });
      } else if (event.type === "tool") {
        step(turn, { icon: toolIcon(event.name), text: event.title, ...(event.input ? { detail: event.input } : {}), state: "active", tool: event.id });
      } else if (event.type === "tool_result") {
        const s = turn.steps.find((x) => x.tool === event.id);
        if (s) {
          s.state = event.ok ? "done" : "warn";
          s.detail = [s.detail, event.summary].filter(Boolean).join(" → ");
        }
      } else if (event.type === "text") {
        const last = turn.steps.at(-1);
        if (!(last?.text === "Answering" && last.state === "active")) step(turn, { icon: "chat", text: "Answering", state: "active" });
        turn.content += event.text;
      } else if (event.type === "done") {
        turn.model = event.ref;
      } else if (event.type === "error") {
        turn.error = event.error;
      }
      emit(turn);
    }
    if (turn.error) {
      turn.status = "error";
      step(turn, { icon: "x-circle", text: "Couldn't answer", detail: turn.error, state: "error" });
    } else {
      turn.status = "done";
      const last = turn.steps.at(-1);
      if (last?.state === "active") last.state = "done";
    }
  } catch (error) {
    if (isAbort(error)) {
      turn.status = "stopped";
      step(turn, { icon: "stop", text: "Stopped by you", state: "warn" });
    } else {
      turn.status = "error";
      // A stream cut off mid-answer (the phone changed networks, the node restarted) says so plainly.
      turn.error =
        error instanceof TypeError
          ? `The connection to ${location.host} dropped${turn.content ? " while Galahad was answering" : ""}. Retry asks again.`
          : error instanceof ApiError && error.status === 422
            ? error.message
            : errorMessage(error);
      step(turn, { icon: "x-circle", text: "Couldn't answer", detail: turn.error, state: "error" });
    }
  } finally {
    turn.endedAt = Date.now();
    controller = null;
    chatActivity.set({ streaming: false, model: null });
    emit(turn);
    if (current) void refreshKept(api);
  }
}

function send(api: Api, text: string): void {
  if (controller) return;
  turns.push({ id: nextId++, role: "user", content: text, steps: [], status: "done", fallbacks: 0, startedAt: Date.now() });
  const turn: Turn = { id: nextId++, role: "assistant", content: "", as: role, steps: [], status: "streaming", fallbacks: 0, startedAt: Date.now() };
  turns.push(turn);
  emit(null);
  void run(api, turn);
}

// ---- the same conversation, for other surfaces (the SANDBOX talks to Galahad here too) ----

/** A turn of the conversation as another surface shows it. */
export type ChatTurn = Readonly<Pick<Turn, "id" | "role" | "content" | "status" | "error" | "model" | "as">> & { readonly step: string | null };

/** The conversation as it stands (the one the Chat page shows): its turns, the step the answer is at, and its title. */
export function chatState(): { turns: ChatTurn[]; busy: boolean; title: string | null } {
  return {
    turns: turns.map((t) => ({ id: t.id, role: t.role, content: t.content, status: t.status, error: t.error, model: t.model, as: t.as, step: t.steps.at(-1)?.text ?? null })),
    busy: controller !== null,
    title: current?.title ?? null,
  };
}

/** Told whenever the conversation changes (a turn added, an answer streaming in). Returns the way to stop listening. */
export function onChatChange(fn: () => void): () => void {
  const listener = () => fn();
  changed.add(listener);
  return () => changed.delete(listener);
}

/** Ask Galahad in the conversation (the Chat page's role, project and keeping apply). False while an answer is still coming. */
export function askGalahad(api: Api, text: string): boolean {
  if (controller || !text.trim()) return false;
  send(api, text.trim());
  return true;
}

function retry(api: Api, turn: Turn): void {
  if (controller) return;
  const index = turns.indexOf(turn);
  if (index < 0) return;
  turns.splice(index, 1);
  const again: Turn = { id: nextId++, role: "assistant", content: "", as: role, steps: [], status: "streaming", fallbacks: 0, startedAt: Date.now() };
  turns.push(again);
  emit(null);
  void run(api, again, true);
}

// ---- view ----

export const chatView: View = (root, ctx, { scope, opts }) => {
  const thread = h("div", { class: "thread", "aria-label": "Conversation" });
  const alerts = h("div", { class: "composer-alerts" });
  const input = h("textarea", {
    rows: 1,
    placeholder: "Ask Galahad…",
    "aria-label": "Message to Galahad",
    autocomplete: "off",
    enterkeyhint: "send",
  });
  input.value = opts.query ?? draft;
  const sendButton = h("button", { class: "btn primary send", type: "submit", "aria-label": "Send" }, icon("arrow-up", { size: 18 }));
  const meta = h("span", { class: "hint ellipsis grow" });
  const jump = button("Latest", { size: "sm", icon: "arrow-down", onClick: () => scrollToEnd(true) });
  jump.hidden = true;
  jump.style.cssText = "position:absolute;left:50%;transform:translateX(-50%);top:-40px;box-shadow:var(--shadow-2)";
  const nodes = new Map<number, HTMLElement>();
  // One persistent live region: says when Galahad starts, and reads the answer once it's complete.
  const announcer = h("div", { class: "sr-only", role: "status", "aria-live": "polite" });
  const announced = new Map<number, Turn["status"]>(turns.map((t) => [t.id, t.status]));
  function announce(turn: Turn | undefined): void {
    if (!turn || turn.role !== "assistant" || announced.get(turn.id) === turn.status) return;
    const before = announced.get(turn.id);
    announced.set(turn.id, turn.status);
    if (turn.status === "streaming" && before === undefined) announcer.textContent = "Galahad is answering.";
    else if (turn.status === "done") announcer.textContent = `Galahad answered: ${turn.content.replace(/[*_`#>|~]/g, "").slice(0, 2000)}`;
    else if (turn.status === "error") announcer.textContent = `Galahad couldn't answer. ${turn.error ?? ""}`;
    else if (turn.status === "stopped") announcer.textContent = "Stopped.";
  }
  let blocked: string | null = null;

  const canChat = ctx.can("chat");
  const coarse = matchMedia("(pointer: coarse)").matches;

  // ---- who answers, in which project, kept or not: one control ----
  function renderRoles(): void {
    const names = Object.keys(roster ?? DEFAULT_ROLES);
    if (!names.includes(role) || roleProblem(role)) role = names.find((n) => !roleProblem(n)) ?? names[0] ?? "planner";
    options.refresh();
    renderMeta();
  }
  function renderMeta(): void {
    meta.textContent = controller ? "Esc to stop" : coarse ? "" : "Enter to send · Shift+Enter for a new line";
  }

  // ---- rendering turns ----
  function processView(turn: Turn): HTMLElement {
    const live = turn.status === "streaming";
    const current = turn.steps.at(-1);
    const summaryText = live
      ? (current?.text ?? "Starting…")
      : [
          turn.as,
          turn.model,
          turn.endedAt ? duration(turn.endedAt - turn.startedAt) : null,
          toolCount(turn) ? `${toolCount(turn)} tool${toolCount(turn) > 1 ? "s" : ""}` : null,
          turn.fallbacks ? `${turn.fallbacks} fallback${turn.fallbacks > 1 ? "s" : ""}` : null,
        ]
          .filter(Boolean)
          .join(" · ");
    const details = h(
      "details",
      { class: "process", open: live && turn.steps.length > 1 },
      h(
        "summary",
        {},
        live ? h("span", { class: "spinner", style: "width:12px;height:12px", "aria-hidden": "true" }) : icon("chevron-right", { size: 14, class: "chev" }),
        h("span", { class: "ellipsis" }, summaryText),
      ),
      h(
        "ol",
        { class: "steps" },
        ...turn.steps.map((s) =>
          h(
            "li",
            { class: "step", "data-state": s.state },
            h("span", { class: "step-mark" }, s.state === "active" ? h("span", { class: "spinner", style: "width:11px;height:11px" }) : icon(s.state === "done" ? "check" : s.icon)),
            h("span", { class: "step-text" }, s.text, s.detail ? h("div", { class: "step-detail" }, s.detail) : null),
          ),
        ),
      ),
    );
    return details;
  }

  function turnActions(turn: Turn): HTMLElement {
    const bar = h("div", { class: "turn-actions" });
    if (turn.content) bar.append(button("Copy", { variant: "ghost", size: "sm", iconOnly: true, icon: "copy", onClick: () => void copyText(turn.content, "Message copied") }));
    const isLast = turns.at(-1) === turn;
    if (turn.role === "assistant" && isLast && turn.status !== "streaming" && canChat) {
      bar.append(button("Retry", { variant: "ghost", size: "sm", icon: "retry", onClick: () => retry(ctx.api, turn) }));
    }
    return bar;
  }

  function renderTurn(turn: Turn): HTMLElement {
    if (turn.role === "user") {
      return h("article", { class: "turn user", "aria-label": "You said" }, h("div", { class: "turn-col" }, h("div", { class: "bubble" }, turn.content), turnActions(turn)));
    }
    const content = h("div", { class: "md" });
    content.append(renderMarkdown(turn.content));
    if (turn.status === "streaming") {
      if (turn.content) {
        const last = content.lastElementChild;
        (last && /^(P|LI|UL|OL)$/.test(last.tagName) ? (last.tagName === "P" ? last : last.lastElementChild ?? last) : content).append(h("span", { class: "caret", "aria-hidden": "true" }));
      }
    }
    const errorBox =
      turn.status === "error" && turn.error
        ? /looks like a/i.test(turn.error)
          ? callout("warn", turn.error, { title: "Not sent to any model", actions: ctx.can("vault:write") ? button("Open the vault", { size: "sm", icon: "vault", onClick: () => ctx.navigate("vault") }) : null })
          : callout("danger", turn.error, { title: "Galahad couldn't answer" })
        : null;
    return h(
      "article",
      { class: `turn assistant${turns.at(-1) === turn ? " last" : ""}`, "aria-label": "Galahad said" },
      h("span", { class: "avatar agent", "aria-hidden": "true" }, icon("mark", { size: 16 })),
      h("div", { class: "turn-body" }, processView(turn), turn.content ? content : null, errorBox, turn.status === "streaming" ? null : turnActions(turn)),
    );
  }

  function emptyState(): HTMLElement {
    const suggestions: [string, string][] = [
      ["Catch me up", "What has my fleet been doing today, and does anything need me?"],
      ["Plan", "Plan this week's work on Galahad as a short, ordered list."],
      ["Recall", "What do we remember about how the fleet is deployed?"],
      ["Place", "Which of my machines should run a long build, and why?"],
    ];
    return h(
      "div",
      { class: "chat-hero" },
      h("div", { class: "hero-mark" }, emblem({ size: 52 })),
      h("h2", {}, startIn ? projectName(startIn) : "At your service."),
      h("p", {}, startIn ? "A new chat in this project: its instructions and memories go with every answer." : "Ask anything. Galahad recalls what your fleet remembers, and uses his tools. Keys belong in the vault, never here."),
      canChat
        ? h(
            "div",
            { class: "suggestions" },
            ...suggestions.map(([title, text]) =>
              h(
                "button",
                {
                  class: "suggestion",
                  type: "button",
                  onclick: () => {
                    input.value = text;
                    grow();
                    input.focus();
                  },
                },
                h("strong", {}, title),
                text,
              ),
            ),
          )
        : null,
      recentChats(),
    );
  }

  function renderAll(): void {
    nodes.clear();
    if (!turns.length) {
      replace(thread, emptyState());
      return;
    }
    replace(
      thread,
      ...turns.map((t) => {
        const el = renderTurn(t);
        nodes.set(t.id, el);
        return el;
      }),
    );
  }

  let frame = 0;
  const dirty = new Set<Turn>();
  function onChange(turn: Turn | null): void {
    announce(turn ?? turns.at(-1));
    if (!turn) {
      renderAll();
      syncComposer();
      scrollToEnd(true);
      return;
    }
    dirty.add(turn);
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const stick = nearBottom();
      for (const t of dirty) {
        const old = nodes.get(t.id);
        const next = renderTurn(t);
        nodes.set(t.id, next);
        if (old?.isConnected) old.replaceWith(next);
        else renderAll();
      }
      dirty.clear();
      syncComposer();
      if (stick) scrollToEnd(false);
      else jump.hidden = !controller;
    });
  }

  const nearBottom = () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 160;
  function scrollToEnd(force: boolean): void {
    // A new chat reads from the top (its welcome and your recent chats); a conversation from its latest answer.
    if (!turns.length) window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    else if (force || nearBottom()) window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" as ScrollBehavior });
    jump.hidden = true;
  }

  // ---- composer ----
  function grow(): void {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, Math.round(window.innerHeight * 0.4))}px`;
  }

  function syncComposer(): void {
    const streaming = Boolean(controller);
    replace(sendButton, icon(streaming ? "stop" : "arrow-up", { size: 18 }));
    sendButton.setAttribute("aria-label", streaming ? "Stop" : "Send");
    sendButton.title = streaming ? "Stop (Esc)" : "Send (Enter)";
    sendButton.disabled = !canChat || (!streaming && (Boolean(blocked) || !input.value.trim()));
    renderMeta();
  }

  function secretWarning(kind: string, secret: string): HTMLElement {
    return callout(
      "warn",
      `That looks like a ${kind}. It won't be sent: the models you talk to would see it.`,
      {
        title: "Secrets never go into chat",
        icon: "shield",
        actions: [
          ctx.can("vault:write")
            ? button("Store it in the vault instead", {
                variant: "primary",
                size: "sm",
                icon: "vault",
                onClick: () => {
                  input.value = "";
                  draft = "";
                  blocked = null;
                  replace(alerts);
                  syncComposer();
                  openAddKey(ctx, { prefill: secret });
                },
              })
            : null,
          button("Remove it from my message", {
            size: "sm",
            onClick: () => {
              input.value = input.value.split(secret).join("").replace(/[ \t]{2,}/g, " ");
              check();
              input.focus();
            },
          }),
        ],
      },
    );
  }

  function check(): void {
    const finding = findSecrets(input.value)[0];
    // The draft outlives this view (in memory only); it never keeps anything secret-shaped.
    draft = finding ? "" : input.value;
    if (finding) {
      const secret = input.value.slice(finding.index, finding.index + finding.length);
      blocked = finding.kind;
      replace(alerts, secretWarning(finding.kind, secret));
    } else if (blocked) {
      blocked = null;
      replace(alerts);
    }
    syncComposer();
  }
  const checkSoon = debounce(check, 200);
  scope.add(() => {
    checkSoon.cancel();
    draft = findSecrets(input.value).length ? "" : input.value;
  });

  function submit(event?: Event): void {
    event?.preventDefault();
    if (controller) {
      stopChat();
      return;
    }
    check(); // never trust a debounced result at the moment of sending
    const text = input.value.trim();
    if (!text || blocked || !canChat) return;
    input.value = "";
    draft = "";
    grow();
    send(ctx.api, text);
  }

  input.addEventListener("input", () => {
    grow();
    sendButton.disabled = !canChat || (!controller && !input.value.trim());
    checkSoon();
  });
  input.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      // While an answer streams, Enter keeps your next message in the box; only Stop or Esc stops.
      if (!controller) submit();
    }
  });
  scope.listen(document, "keydown", (event: KeyboardEvent) => {
    if (event.key === "Escape" && controller && !document.querySelector("dialog[open]")) {
      event.preventDefault();
      stopChat();
    }
  });
  scope.listen(window, "scroll", () => {
    if (nearBottom()) jump.hidden = true;
  }, { passive: true });

  const newChat = button("New chat", {
    size: "sm",
    icon: "plus",
    label: "New chat",
    title: "New chat",
    onClick: () => {
      startNewChat();
      input.focus();
    },
  });
  newChat.classList.add("new-chat");

  // ---- your history and projects ----
  const subHead = h("div", { class: "chat-sub" });
  const node = ctx.whoami.nodeName ?? "this node";
  const projectName = (id: string) => projects?.find((p) => p.id === id)?.name ?? id;

  const historyButton = button("Chats", { size: "sm", icon: "clock", label: "Your chats", title: "Your chats", onClick: () => openHistory() });
  historyButton.classList.add("new-chat");

  /** Your projects, the ones you chatted in most recently first. */
  function projectsByUse(): ProjectView[] {
    const last = new Map<string, number>();
    for (const c of kept ?? []) if (c.project) last.set(c.project, Math.max(last.get(c.project) ?? 0, c.updatedAt));
    return [...(projects ?? [])].sort((a, b) => (last.get(b.id) ?? 0) - (last.get(a.id) ?? 0) || a.name.localeCompare(b.name));
  }
  const firstLine = (text: string) => text.split("\n").find((l) => l.trim())?.trim().slice(0, 90) ?? "";
  function projectChoices(chosen: string | null): SelectorGroup {
    return {
      id: "project",
      label: "Project",
      options: [
        { value: "", label: "No project", icon: "chat", meta: "Galahad as he is", selected: !chosen },
        ...projectsByUse().map((p) => ({ value: p.id, label: p.name, icon: "folder" as const, meta: firstLine(p.instructions) || "No instructions yet", keywords: [p.id], selected: chosen === p.id })),
      ],
    };
  }

  // Who answers, in which project, kept or not: one control that says so in words.
  const options = selector({
    label: "Chat options",
    scope,
    search: "auto",
    placeholder: "Find a role or project…",
    current: () => {
      const model = modelName((roster ?? DEFAULT_ROLES)[role]?.models[0]);
      const fresh = !current;
      const parts = [roleTitle(role), model || null, fresh && startIn ? projectName(startIn) : null, fresh && temporary ? "Temporary" : null].filter(Boolean);
      return { text: parts.join(" · "), icon: ROLE_ICON[role] ?? "sparkle", ...(fresh && temporary ? { tone: "warn" as const } : {}) };
    },
    groups: () => {
      const specs = roster ?? DEFAULT_ROLES;
      const groups: SelectorGroup[] = [
        {
          id: "role",
          label: "Who answers",
          options: Object.entries(specs).map(([name, spec]) => {
            const problem = roleProblem(name);
            const models = spec.models;
            return {
              value: name,
              label: roleTitle(name),
              icon: ROLE_ICON[name] ?? "sparkle",
              meta: models.length ? `${models[0]}${models.length > 1 ? ` · ${plural(models.length - 1, "fallback")}` : ""}` : spec.description,
              keywords: [spec.description, ...models],
              selected: name === role,
              ...(problem ? { disabled: problem } : {}),
            };
          }),
        },
      ];
      // A new chat starts in a project (a kept one moves from its own menu).
      if (!current && projects?.length) groups.push(projectChoices(startIn));
      groups.push({
        id: "keep",
        label: "Keeping",
        mode: "many",
        options: [{ value: "temporary", label: "Temporary chat", icon: "eye", meta: current ? "Starts a new chat that isn't kept" : "Not kept: gone when you start another or close the app", selected: temporary && !current }],
      });
      return groups;
    },
    onSelect: (group, option) => {
      if (group === "role") {
        role = option.value;
        rememberRole(role);
      } else if (controller) {
        toast("Galahad is still answering", { description: "Stop him first, or wait for the answer.", tone: "warn" });
        return;
      } else if (group === "project") {
        const next = option.value || null;
        temporary = false;
        if (turns.length) newConversation(next);
        else startIn = next;
      } else if (group === "keep") {
        if (turns.length) newConversation();
        temporary = !temporary;
      }
      renderSub();
      if (!turns.length) renderAll();
      renderMeta();
      if (!coarse) input.focus();
    },
  });
  options.el.classList.add("chat-options");

  async function changeKept(change: { title?: string; project?: string | null; pinned?: boolean }): Promise<void> {
    if (!current) return;
    try {
      await ctx.api.post("/api/conversations/update", { id: current.id, ...change }, scope.signal);
      Object.assign(current, change);
      renderSub();
      void refreshKept(ctx.api);
    } catch (error) {
      toast("Couldn't change it", { tone: "error", description: errorMessage(error) });
    }
  }

  function rename(): void {
    if (!current) return;
    const field = h("input", { class: "input", type: "text", value: current.title, maxlength: 120, "aria-label": "Title" });
    const sheet = openSheet({
      title: "Rename this chat",
      size: "small",
      body: h("form", { onsubmit: (e: Event) => { e.preventDefault(); const title = field.value.trim(); if (title) void changeKept({ title }); sheet.close(); } }, field),
      footer: [button("Cancel", { onClick: () => sheet.close() }), button("Save", { variant: "primary", onClick: () => { const title = field.value.trim(); if (title) void changeKept({ title }); sheet.close(); } })],
      initialFocus: () => field,
    });
  }

  async function deleteCurrent(): Promise<void> {
    if (!current) return;
    const ok = await confirmAction({
      title: "Delete this chat?",
      body: [h("p", {}, `"${current.title}" is deleted on ${node} for good, with every answer in it. Memories Galahad made from it stay in the mind.`)],
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await ctx.api.post("/api/conversations/delete", { id: current.id }, scope.signal);
      newConversation(null);
      void refreshKept(ctx.api);
      toast("Chat deleted", { tone: "info" });
    } catch (error) {
      toast("Couldn't delete it", { tone: "error", description: errorMessage(error) });
    }
  }

  // A kept chat's own menu: rename, pin, its project, delete.
  const chatMenu = selector({
    label: "This chat",
    scope,
    search: false,
    variant: "ghost",
    className: "icon-only",
    current: () => ({ text: "", icon: "more" }),
    groups: () => {
      if (!current) return [];
      const groups: SelectorGroup[] = [
        {
          id: "do",
          mode: "action",
          options: [
            { value: "rename", label: "Rename…", icon: "edit" },
            { value: "pin", label: current.pinned ? "Unpin" : "Pin to the top of your chats", icon: "pin" },
            { value: "delete", label: "Delete…", icon: "trash", meta: `For good, on ${node}` },
          ],
        },
      ];
      if (ctx.can("mind:read") && projects?.length) groups.push({ ...projectChoices(current.project), label: "Move to a project" });
      return groups;
    },
    footer: () => (ctx.can("mind:read") && projects?.length ? "A project's instructions and memories go with every answer." : null),
    onSelect: (group, option) => {
      if (!current) return;
      if (group === "project") void changeKept({ project: option.value || null });
      else if (option.value === "rename") rename();
      else if (option.value === "pin") void changeKept({ pinned: !current.pinned });
      else if (option.value === "delete") void deleteCurrent();
    },
  });

  function renderSub(): void {
    options.refresh();
    if (current) {
      replace(
        subHead,
        h("button", { class: "chat-title", type: "button", title: "Rename", onclick: () => rename() }, current.pinned ? icon("pin", { size: 13, class: "subtle", label: "Pinned" }) : null, h("span", { class: "ellipsis" }, current.title)),
        current.project
          ? h("a", { class: "chip", href: "#/projects", onclick: (e: Event) => { e.preventDefault(); ctx.navigate("projects", { project: current!.project! }); } }, icon("folder", { size: 12 }), projectName(current.project))
          : null,
        current.bank ? badge("bank", "neutral", "bank") : null,
        h("span", { class: "spacer" }),
        chatMenu.el,
      );
    } else if (temporary) {
      replace(subHead, badge("temporary", "warn", "eye"), h("span", { class: "small muted" }, "Not kept: gone when you start another chat or close the app."));
    } else replace(subHead);
  }

  function chatRow(c: ConversationSummary, after: () => void): HTMLElement {
    const meta = [c.project ? projectName(c.project) : null, `${c.count} message${c.count === 1 ? "" : "s"}`, relativeTime(c.updatedAt)].filter(Boolean).join(" · ");
    return h(
      "button",
      {
        class: "item chat-row",
        type: "button",
        "aria-current": current?.id === c.id ? "true" : null,
        onclick: () => {
          after();
          openConversation(ctx.api, c.id).catch((error: unknown) => toast("Couldn't open it", { tone: "error", description: errorMessage(error) }));
        },
      },
      h("span", { class: "avatar" }, icon(c.pinned ? "pin" : c.project ? "folder" : "chat", { size: 14 })),
      h("div", { class: "grow", style: "min-width:0" }, h("div", { class: "strong small ellipsis" }, c.title), h("div", { class: "meta" }, meta, c.bank ? h("span", {}, " · bank") : null)),
    );
  }

  function openHistory(): void {
    const search = h("input", { class: "input", type: "search", placeholder: "Search your chats", "aria-label": "Search your chats", autocomplete: "off" });
    const listHost = h("div", { class: "stack" });
    const sheet = openSheet({ title: "Your chats", description: `Kept privately on ${node}. Temporary chats aren't kept.`, body: [search, listHost], size: "wide" });
    const draw = () => {
      if (!kept) return replace(listHost, skeletonRows(4));
      const shown = filterConversations(kept, search.value, projectName);
      if (!shown.length) return replace(listHost, empty({ icon: "chat", title: search.value ? "No chat matches" : "No chats yet", body: search.value ? undefined : "Ask something: the conversation is kept here.", compact: true }));
      replace(
        listHost,
        ...groupConversations(shown).map((g) => h("div", { class: "stack tight" }, h("div", { class: "tiny subtle" }, g.label), h("div", { class: "card" }, h("div", { class: "rows" }, ...g.items.map((c) => chatRow(c, () => sheet.close())))))),
      );
    };
    search.addEventListener("input", draw);
    keptChanged.add(draw);
    sheet.scope.add(() => keptChanged.delete(draw));
    draw();
    void refreshKept(ctx.api);
  }

  function recentChats(): HTMLElement | null {
    if (temporary) return null;
    // Until your chats arrive, their place is held (the welcome above them doesn't jump).
    if (kept === null && canChat) return h("div", { class: "recent-chats", "aria-hidden": "true" }, h("div", { class: "tiny subtle" }, " "), h("div", { class: "card" }, skeletonRows(4, { avatar: true })));
    if (!kept?.length) return null;
    const recent = (startIn ? kept.filter((c) => c.project === startIn) : kept).slice(0, 4);
    if (!recent.length) return null;
    return h("div", { class: "recent-chats" }, h("div", { class: "tiny subtle" }, startIn ? `Recent in ${projectName(startIn)}` : "Recent"), h("div", { class: "card" }, h("div", { class: "rows" }, ...recent.map((c) => chatRow(c, () => {})))), button("All chats", { variant: "ghost", size: "sm", icon: "clock", onClick: () => openHistory() }));
  }

  const onKept = () => {
    renderSub();
    if (!turns.length) renderAll();
  };
  keptChanged.add(onKept);
  scope.add(() => keptChanged.delete(onKept));

  const form = h(
    "form",
    { class: "composer", onsubmit: (event: Event) => submit(event) },
    input,
    h("div", { class: "composer-bar" }, icon("shield-check", { size: 14, class: "subtle", label: "Checked for secrets before sending" }), meta, sendButton),
  );

  replace(
    root,
    h(
      "section",
      { class: "chat", "aria-labelledby": "chat-title" },
      h("h1", { id: "chat-title", class: "sr-only" }, "Chat with Galahad"),
      announcer,
      h("div", { class: "chat-head" }, options.el, h("span", { class: "spacer" }), historyButton, newChat),
      subHead,
      thread,
      h("div", { class: "composer-wrap", style: "position:sticky" }, h("div", { style: "position:relative" }, jump), alerts, form),
    ),
  );

  changed.add(onChange);
  scope.add(() => changed.delete(onChange));
  // Arriving for one chat, or to start one in a project.
  if (opts.conversation && opts.conversation !== current?.id) {
    openConversation(ctx.api, opts.conversation).catch((error: unknown) => toast("Couldn't open that chat", { tone: "error", description: errorMessage(error) }));
  } else if (opts.project && !controller && startIn !== opts.project) {
    if (turns.length) newConversation(opts.project);
    else startIn = opts.project;
  }
  renderSub();
  renderAll();
  renderRoles();
  void refreshKept(ctx.api);
  if (ctx.can("mind:read")) void refreshProjects(ctx.api);
  syncComposer();
  grow();
  if (input.value) check();

  if (!canChat) {
    input.disabled = true;
    replace(alerts, callout("warn", "This device wasn't granted the chat scope. Ask from a device that was, or pair this one again with chat allowed."));
  } else if (!matchMedia("(pointer: coarse)").matches) {
    input.focus();
  }
  requestAnimationFrame(() => scrollToEnd(true));

  if (!roster && ctx.can("mind:read")) {
    ctx.api
      .get<{ roster: Record<string, RoleSpec> }>("/api/roster", scope.signal)
      .then(({ roster: loaded }) => {
        roster = loaded;
        if (!scope.disposed) renderRoles();
      })
      .catch(() => {
        /* roster needs mind:read; the default roles still work */
      });
  }
};

/** The shell's "answering…" pill: visible from every page while a reply streams. */
export function chatActivityPill(): HTMLElement {
  const pill = h("div", { class: "fleet-pill activity-pill", role: "status", hidden: true, style: "padding-right:4px" });
  chatActivity.watch(({ streaming, model }) => {
    pill.hidden = !streaming;
    if (!streaming) return;
    replace(
      pill,
      h("span", { class: "spinner", style: "width:12px;height:12px", "aria-hidden": "true" }),
      h("a", { href: "#/chat", style: "color:inherit;text-decoration:none" }, model ? `Answering · ${model.split("/").pop()}` : "Answering…"),
      button("Stop", { size: "sm", variant: "ghost", icon: "stop", onClick: stopChat, label: "Stop Galahad answering" }),
    );
  });
  return pill;
}
