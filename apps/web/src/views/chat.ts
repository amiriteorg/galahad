import type { ChatMessage, ChatStreamEvent, ConversationSummary, ConversationView, ProjectView } from "@galahad/core";
import { findSecrets } from "@galahad/core/secret-scan";
import type { QueuedMessage, QueueHold, TurnView } from "@galahad/core/turns";
import { type Api, ApiError, isAbort } from "../api.ts";
import { errorMessage, type View } from "../context.ts";
import { filterConversations, groupConversations } from "../lib/chats.ts";
import { plural } from "../lib/text.ts";
import { duration, relativeTime } from "../lib/time.ts";
import { applyEvent, asideOf, beginTurn, composerAction, composerHint, endTurn, failTurn, stateBadge, type Step, type Thread, type Turn, turnOf } from "../lib/turns.ts";
import { chatEnter, lastRole, openChatId, rememberOpenChat, rememberRole } from "../prefs.ts";
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
import { openAside } from "./chat-aside.ts";
import { queuePanel } from "./chat-queue.ts";
import { openAddKey } from "./vault.ts";

/*
 * Chat. A turn runs on the node, not in this page: the page starts it and watches
 * it, and if the page goes away (a locked phone, a reload, another tab) the turn goes
 * on, and whoever opens the chat next attaches to it and sees it from its start. Stop
 * is always one click (or Esc) away, here or in the top bar, and it is said to the
 * node: it is the only thing that stops him. While he works, a new message steers him
 * (he's told at his next safe point) or is queued on the node (sent when he's done).
 * The conversation is kept by the node; nothing of it is written to this device.
 */

/** Which icon a tool's step shows. */
function toolIcon(name: string): IconName {
  if (name.startsWith("bank_")) return "bank";
  if (name.startsWith("sandbox_")) return "sandbox";
  if (name.startsWith("connector")) return "plug";
  if (name.startsWith("artifact")) return "archive";
  if (name.startsWith("archive_")) return "library";
  const icons: Record<string, IconName> = { recall: "memory", remember: "memory", web_search: "globe", fleet: "fleet", place: "fleet", loops: "repeat", notices: "inbox", ledger: "activity", decide: "compass", request_secret: "key", note_idea: "lightbulb" };
  return icons[name] ?? "zap";
}
/** A step's icon: a tool's own, or the step's. */
const stepIcon = (s: Step): IconName => (s.toolName ? toolIcon(s.toolName) : (s.icon as IconName));

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

// ---- module state: survives navigation; the conversation itself, and the turn, are kept by the node ----
const thread: Thread = { turns: [], nextId: 1, target: null, base: null };
let draft = "";
let role = lastRole() ?? "planner";
let roster: Record<string, RoleSpec> | null = null;
const changed = new Set<(turn: Turn | null) => void>();

/**
 * The turn this page is watching: started here, or attached to. `id` is null for the moment between
 * sending and the node saying which turn it is. Leaving (another chat, another page) ends the
 * watching, never the turn.
 */
interface Watching {
  api: Api;
  id: string | null;
  /** When the node stops it by itself. */
  deadline: number | null;
  watch: AbortController;
  /** Stop was asked before the node had said which turn it is. */
  stopAsked: boolean;
  /** Reconnections tried since the last word from the node. */
  tries: number;
}
let live: Watching | null = null;
/** What you queued behind this chat, and why it's held if it is. */
let queue: QueuedMessage[] = [];
let held: QueueHold | null = null;
/** Messages sent to steer him that haven't reached him yet (he's mid-tool, or mid-thought). */
let steering: string[] = [];
/** A turn is running in this chat that this device may not watch (it may read the bank). */
let unwatchable: TurnView | null = null;

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

/** For the shell: whether Galahad is answering right now, and with which model. */
export const chatActivity = signal<{ streaming: boolean; model: string | null }>({ streaming: false, model: null });

const emit = (turn: Turn | null) => {
  for (const fn of changed) fn(turn);
};

/* ---------- watching a turn the node runs ---------- */

/** Stop watching (the turn itself goes on). A temporary chat's turn has nobody else to watch it: that one is stopped. */
function leave(): void {
  const was = live;
  if (!was) return;
  live = null;
  if (!current && was.id) void was.api.post("/api/turns/stop", { turn: was.id }).catch(() => {});
  was.watch.abort();
  if (thread.target) endTurn(thread, Date.now());
  steering = [];
  chatActivity.set({ streaming: false, model: null });
}

/** Stop him: said to the node, which stops the turn and keeps what he'd said. */
export function stopChat(): void {
  const w = live;
  if (!w) return;
  if (!w.id) {
    // The node hasn't said which turn it is yet: it's stopped the moment it does.
    w.stopAsked = true;
    return;
  }
  void w.api.post("/api/turns/stop", { turn: w.id }).catch((error: unknown) => toast("Couldn't stop him", { tone: "error", description: errorMessage(error) }));
}

function handle(w: Watching, event: ChatStreamEvent): void {
  w.tries = 0;
  if (event.type === "turn") {
    w.id = event.id;
    w.deadline = event.deadline;
    if (w.stopAsked) {
      w.stopAsked = false;
      stopChat();
    }
  } else if (event.type === "conversation") {
    current = { id: event.id, title: event.title, project: event.project, bank: current?.bank ?? false, pinned: current?.pinned ?? false };
    startIn = null;
    rememberOpenChat(event.id);
    for (const fn of keptChanged) fn();
    return;
  } else if (event.type === "steer") {
    const at = steering.indexOf(event.text);
    if (at >= 0) steering.splice(at, 1);
  } else if (event.type === "undelivered") {
    steering = [];
    if (event.queued) toast(`${plural(event.texts.length, "message")} didn't reach him before the turn ended`, { description: "Queued, first in line, and held until you resume." });
    else {
      // A temporary chat keeps nothing on the node: the words come back to the box.
      draft = [draft, ...event.texts].filter(Boolean).join("\n\n");
      toast("Your message didn't reach him before the turn ended", { description: "It's back in the message box." });
    }
    emit(null);
    return;
  }
  const what = applyEvent(thread, event, Date.now());
  if (event.type === "model" || event.type === "done") chatActivity.set({ streaming: true, model: event.ref });
  if (what === "all") emit(null);
  else if (what) emit(what);
}

/** Read a turn's stream into the thread, to its end; find the turn again if the connection drops while he works. */
async function follow(w: Watching, open: (signal: AbortSignal) => AsyncGenerator<ChatStreamEvent>): Promise<void> {
  let ended = false;
  let failure: unknown = null;
  try {
    for await (const event of open(w.watch.signal)) {
      if (live !== w) return;
      handle(w, event);
      if (event.type === "done" || event.type === "error" || event.type === "stopped") ended = true;
    }
  } catch (error) {
    if (live !== w || isAbort(error)) return;
    failure = error;
  }
  if (live !== w) return;
  if (ended) return finish(w);
  // The node never said which turn it is: the message wasn't taken (a secret in it, he's busy in this chat, the node is full).
  if (!w.id) {
    const error = failure;
    const text =
      error instanceof ApiError && (error.status === 422 || error.status === 409 || error.status === 429)
        ? error.message
        : error instanceof TypeError
          ? `Couldn't reach ${location.host}. Retry asks again.`
          : error
            ? errorMessage(error)
            : "The node didn't answer.";
    return finish(w, text);
  }
  // He is (or was) working on the node; only the watching was cut. A turn that is gone has ended: its chat has how.
  if (failure instanceof ApiError && (failure.status === 404 || failure.status === 403)) {
    if (current) {
      const id = current.id;
      live = null;
      thread.target = null;
      chatActivity.set({ streaming: false, model: null });
      void openConversation(w.api, id).catch(() => {});
      return;
    }
    return finish(w, failure.status === 403 ? failure.message : "The node restarted while he was answering, and a temporary chat's turn isn't kept anywhere.");
  }
  if (w.tries >= 8) return finish(w, `Lost the connection to ${location.host}. He may still be working there: open this chat again to see.`);
  w.tries += 1;
  const turn = thread.target;
  if (turn) {
    const last = turn.steps.at(-1);
    if (last?.text !== RECONNECTING) turn.steps.push({ icon: "refresh", text: RECONNECTING, detail: "He's still working on the node; only this page's connection dropped.", state: "active" });
    emit(turn);
  }
  await new Promise((resolve) => setTimeout(resolve, Math.min(500 * 2 ** (w.tries - 1), 8000)));
  if (live !== w) return;
  return follow(w, (signal) => w.api.events("/api/turns/attach", { turn: w.id }, signal));
}
const RECONNECTING = "Reconnecting to the node";

function finish(w: Watching, failure?: string): void {
  const turn = failure ? failTurn(thread, failure, Date.now()) : endTurn(thread, Date.now());
  live = null;
  steering = [];
  chatActivity.set({ streaming: false, model: null });
  emit(turn);
  // What you queued may be next, and the list's states have changed.
  if (current) void sync(w.api);
}

function watching(api: Api, id: string | null = null): Watching {
  const w: Watching = { api, id, deadline: null, watch: new AbortController(), stopAsked: false, tries: 0 };
  live = w;
  unwatchable = null;
  chatActivity.set({ streaming: true, model: null });
  return w;
}

/** A kept chat as the node has it now: its queue, and the turn running in it (attached to, if this device may watch it). */
async function sync(api: Api): Promise<void> {
  const id = current?.id;
  if (!id) return;
  void refreshKept(api);
  let conversation: ConversationView;
  try {
    ({ conversation } = await api.post<{ conversation: ConversationView }>("/api/conversations/get", { id }));
  } catch {
    return;
  }
  if (current?.id !== id) return;
  queue = conversation.queue;
  held = conversation.held;
  adopt(api, conversation);
  emit(null);
}

/** Show a kept chat as the node has it, and attach to the turn running in it. */
function adopt(api: Api, conversation: ConversationView): void {
  const running = conversation.turn;
  unwatchable = running && !running.watchable ? running : null;
  if (live) return;
  if (!running || !running.watchable) return;
  // Rebuilt from what the node keeps; the turn's own answers then come from its replay.
  thread.turns = conversation.messages.map((m) => turnOf(m, conversation.role, thread.nextId++));
  thread.target = null;
  thread.base = null;
  const w = watching(api, running.id);
  w.deadline = running.deadline;
  void follow(w, (signal) => api.events("/api/turns/attach", { turn: running.id }, signal));
}

/** A kept conversation, back on screen with its answers' steps; if he's working in it, live from where he is. */
export async function openConversation(api: Api, id: string): Promise<void> {
  const { conversation } = await api.post<{ conversation: ConversationView }>("/api/conversations/get", { id });
  leave();
  // With no turn running, an answer still marked as being written can't finish any more.
  thread.turns = conversation.messages.map((m) => turnOf(m.status === "streaming" && !conversation.turn ? { ...m, status: "stopped" } : m, conversation.role, thread.nextId++));
  thread.target = null;
  thread.base = null;
  current = { id: conversation.id, title: conversation.title, project: conversation.project, bank: conversation.bank, pinned: conversation.pinned };
  temporary = false;
  startIn = null;
  rememberOpenChat(conversation.id);
  queue = conversation.queue;
  held = conversation.held;
  steering = [];
  adopt(api, conversation);
  emit(null);
  for (const fn of keptChanged) fn();
}

/** A new conversation (in the same project, unless told otherwise); returns a function that brings the last one back (for Undo). */
export function newConversation(project: string | null = current?.project ?? startIn): () => void {
  // He goes on working in a kept chat (it's in your chats, marked as working); a temporary one ends here.
  leave();
  const saved = { turns: thread.turns, current, startIn, temporary, queue, held };
  thread.turns = [];
  thread.target = null;
  thread.base = null;
  current = null;
  startIn = project;
  queue = [];
  held = null;
  unwatchable = null;
  rememberOpenChat(null);
  emit(null);
  for (const fn of keptChanged) fn();
  return () => {
    if (thread.turns.length) return;
    ({ current, startIn, temporary, queue, held } = saved);
    rememberOpenChat(current?.id ?? null);
    thread.turns = saved.turns;
    emit(null);
    for (const fn of keptChanged) fn();
  };
}

/**
 * After a reload (the page's memory is gone, the node's isn't): back to the kept chat you had open, attached
 * to the turn he's working on in it. Once per page load. A temporary chat is gone with the page; the node
 * stops its turn once nobody has watched it for a while (it's kept nowhere, so nobody could read it).
 */
let restored = false;
export function restoreOpenChat(api: Api): void {
  if (restored) return;
  restored = true;
  const id = openChatId();
  if (!id || current || thread.turns.length || live) return;
  void openConversation(api, id).catch(() => rememberOpenChat(null));
}

/** "New chat" from anywhere. A kept chat stays in your history; a temporary one can be brought back once. */
export function startNewChat(): void {
  if (!thread.turns.length) return;
  const wasTemporary = temporary && !current;
  const restore = newConversation();
  if (wasTemporary) toast("Temporary chat cleared", { action: { label: "Undo", run: restore } });
}

const toolCount = (turn: Turn): number => turn.steps.filter((s) => s.tool).length;

function send(api: Api, text: string, again = false): void {
  if (live) return;
  const history: ChatMessage[] = thread.turns.filter((t) => t.content && t.status !== "error").map((t) => ({ role: t.role, content: t.content }));
  const asked: ChatMessage = { role: "user", content: text };
  beginTurn(thread, text, role, Date.now());
  // A kept conversation: the node holds what was said, so only the question goes. A new one is kept from now (unless temporary).
  const body = current
    ? { role, conversation: current.id, messages: [asked], ...(again ? { retry: true } : {}) }
    : temporary
      ? { role, messages: [...history, asked] }
      : { role, save: true, messages: [...history, asked], ...(startIn ? { project: startIn } : {}) };
  const w = watching(api);
  emit(null);
  void follow(w, (signal) => api.chat(body, signal));
}

function retry(api: Api, turn: Turn): void {
  if (live) return;
  const index = thread.turns.indexOf(turn);
  if (index < 0) return;
  // Asked again: the question before this answer, and everything after it, is replaced by the new exchange.
  let asked = index - 1;
  while (asked >= 0 && thread.turns[asked]!.role !== "user") asked -= 1;
  if (asked < 0) return;
  const text = thread.turns[asked]!.content;
  thread.turns.length = asked;
  send(api, text, true);
}

/**
 * Your message, from the composer. With nothing running it's sent. While he works, `modifier` says
 * whether the other of steer and queue was asked for (this device's Enter does one, the modifier the other).
 * Resolves to what became of it, or why it wasn't taken.
 */
export async function sendMessage(api: Api, raw: string, opts: { modifier?: boolean; how?: "steer" | "queue" } = {}): Promise<"sent" | "steered" | "queued" | { problem: string }> {
  const text = raw.trim();
  if (!text) return { problem: "Nothing to send." };
  const action = opts.how && live ? (opts.how === "queue" && !current ? "steer" : opts.how) : composerAction({ busy: live !== null, enter: chatEnter(), modifier: Boolean(opts.modifier), canQueue: current !== null });
  if (action === "send") {
    send(api, text);
    return "sent";
  }
  try {
    if (action === "queue") {
      const view = await api.post<{ queue: QueuedMessage[]; held: QueueHold | null; started: TurnView | null }>("/api/conversations/queue", { conversation: current!.id, text, role });
      queue = view.queue;
      held = view.held;
      emit(null);
      // He'd finished in the meantime, so its turn came at once.
      if (view.started && !live) void sync(api);
      return "queued";
    }
    const w = live;
    if (!w?.id) return { problem: "He's only just starting: try again in a moment." };
    await api.post("/api/turns/steer", { turn: w.id, text });
    steering.push(text);
    emit(null);
    return "steered";
  } catch (error) {
    // He finished while you typed: it's simply your next message.
    if (error instanceof ApiError && error.status === 409 && action === "steer") {
      await sync(api);
      if (!live) {
        send(api, text);
        return "sent";
      }
    }
    return { problem: errorMessage(error) };
  }
}

/** What you can do with your queue. Each resolves to a problem in words, or null. */
export const queueActions = (api: Api) => {
  const run = async (path: string, body: object): Promise<string | null> => {
    if (!current) return "This chat isn't kept, so nothing is queued behind it.";
    try {
      const view = await api.post<{ queue: QueuedMessage[]; held: QueueHold | null }>(path, { conversation: current.id, ...body });
      queue = view.queue;
      held = view.held;
      emit(null);
      // Send now and Resume may have started a turn (or steered the one under way).
      if (!live) void sync(api);
      return null;
    } catch (error) {
      void sync(api);
      return errorMessage(error);
    }
  };
  return {
    edit: (id: number, text: string) => run("/api/conversations/queue/edit", { id, text }),
    remove: (id: number) => run("/api/conversations/queue/remove", { id }),
    discard: () => run("/api/conversations/queue/remove", {}),
    sendNow: (id: number) => run("/api/conversations/queue/send", { id }),
    resume: () => run("/api/conversations/queue/resume", {}),
  };
};

/**
 * While a chat is on screen: notice a turn that started in it elsewhere (another device, the queue going
 * on) and attach to it; keep the list's states fresh. Asks the node only while the app is visible.
 */
export function watchTurns(api: Api, signal: AbortSignal): void {
  let known = "";
  const look = async (): Promise<void> => {
    if (document.hidden) return;
    try {
      const view = await api.get<{ turns: TurnView[] }>("/api/turns", signal);
      const now = view.turns.map((t) => `${t.id}:${t.conversation}`).sort().join(",");
      const mine = current && view.turns.find((t) => t.conversation === current!.id);
      if (now !== known) {
        known = now;
        void refreshKept(api);
      }
      if (mine && !live && (!unwatchable || unwatchable.id !== mine.id)) void sync(api);
      else if (!mine && unwatchable) void sync(api);
    } catch {
      /* out of reach just now: the next look tries again */
    }
  };
  const timer = setInterval(() => void look(), 4000);
  signal.addEventListener("abort", () => clearInterval(timer));
  void look();
}

/** A chat's state as its badge in a list (a spinner while he's working in it). */
export function chatStateBadge(c: Pick<ConversationSummary, "state" | "queued" | "held" | "needs">): HTMLElement | null {
  const b = stateBadge(c);
  if (!b) return null;
  const el = badge(b.text, b.tone);
  el.classList.add("chat-state");
  if (b.live) el.prepend(h("span", { class: "spinner", style: "width:10px;height:10px", "aria-hidden": "true" }));
  return el;
}

/** What a side question would be about: this kept chat, or the temporary chat's turn under way (null: nothing yet). */
function asideTarget(): { conversation: string } | { turn: string } | null {
  if (current) return { conversation: current.id };
  return live?.id ? { turn: live.id } : null;
}

/** Ask on the side: answered apart, and part of nothing unless brought back. */
export function openChatAside(api: Api, question = ""): void {
  const about = asideTarget();
  if (!about) return void toast("Nothing to ask on the side yet", { description: "A side question is about a chat: ask something first.", tone: "warn" });
  openAside(api, about, { question, working: live !== null, onBroughtBack: () => void sync(api) });
}

// ---- view ----

export const chatView: View = (root, ctx, { scope, opts }) => {
  const threadEl = h("div", { class: "thread", "aria-label": "Conversation" });
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
  const announced = new Map<number, Turn["status"]>(thread.turns.map((t) => [t.id, t.status]));
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
    meta.textContent = composerHint({ busy: live !== null, enter: chatEnter(), canQueue: current !== null, coarse, mac: /Mac|iPhone|iPad/.test(navigator.platform) });
  }

  // ---- rendering thread.turns ----
  function processView(turn: Turn): HTMLElement {
    const writing = turn.status === "streaming";
    const current = turn.steps.at(-1);
    // An answer that was stopped, or that a message of yours cut, says so on its one line (not only inside).
    const cut = turn.status === "stopped" ? (current?.text ?? "Stopped") : turn.status === "steered" ? "Steered here" : null;
    const summaryText = writing
      ? (current?.text ?? "Starting…")
      : [
          cut,
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
      { class: "process", open: writing && turn.steps.length > 1 },
      h(
        "summary",
        {},
        writing ? h("span", { class: "spinner", style: "width:12px;height:12px", "aria-hidden": "true" }) : icon("chevron-right", { size: 14, class: "chev" }),
        h("span", { class: "ellipsis" }, summaryText),
      ),
      h(
        "ol",
        { class: "steps" },
        ...turn.steps.map((s) =>
          h(
            "li",
            { class: "step", "data-state": s.state },
            h("span", { class: "step-mark" }, s.state === "active" ? h("span", { class: "spinner", style: "width:11px;height:11px" }) : icon(s.state === "done" ? "check" : stepIcon(s))),
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
    const isLast = thread.turns.at(-1) === turn;
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
      { class: `turn assistant${thread.turns.at(-1) === turn ? " last" : ""}`, "aria-label": "Galahad said" },
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
    if (!thread.turns.length) {
      replace(threadEl, emptyState());
      return;
    }
    replace(
      threadEl,
      ...thread.turns.map((t) => {
        const el = renderTurn(t);
        nodes.set(t.id, el);
        return el;
      }),
    );
  }

  let frame = 0;
  const dirty = new Set<Turn>();
  function onChange(turn: Turn | null): void {
    announce(turn ?? thread.turns.at(-1));
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
      else jump.hidden = !live;
    });
  }

  const nearBottom = () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 160;
  function scrollToEnd(force: boolean): void {
    // A new chat reads from the top (its welcome and your recent chats); a conversation from its latest answer.
    if (!thread.turns.length) window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    else if (force || nearBottom()) window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" as ScrollBehavior });
    jump.hidden = true;
  }

  // ---- composer ----
  function grow(): void {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, Math.round(window.innerHeight * 0.4))}px`;
  }

  // While he works, a message steers him now or is queued for after: what Enter does is this device's choice
  // (Settings), Ctrl or ⌘ with Enter does the other, and each has its own button (the way on a phone).
  const steerButton = button("Steer", { size: "sm", title: "Tell him now: it reaches him at his next safe point", onClick: () => void deliver({ how: "steer" }) });
  const queueButton = button("Queue", { size: "sm", title: "Keep it on the node and send it when he's done", onClick: () => void deliver({ how: "queue" }) });
  const stopButton = button("Stop", { icon: "stop", iconOnly: true, label: "Stop him", title: "Stop him (Esc)", onClick: () => stopChat() });
  stopButton.classList.add("send");
  const asideButton = button("Ask on the side", { variant: "ghost", size: "sm", icon: "chat", iconOnly: true, title: "Ask on the side: answered apart, without changing what he's doing (/btw)", onClick: () => openChatAside(ctx.api) });
  const panel = queuePanel(queueActions(ctx.api));
  const elsewhere = h("div", { class: "composer-alerts" });
  let shownElsewhere = "";

  function syncComposer(): void {
    const busy = live !== null;
    const has = Boolean(input.value.trim()) && !blocked;
    const canQueue = current !== null;
    const enter = chatEnter();
    sendButton.hidden = busy;
    sendButton.disabled = !canChat || !has;
    stopButton.hidden = !busy;
    steerButton.hidden = !busy;
    queueButton.hidden = !busy || !canQueue;
    steerButton.disabled = queueButton.disabled = !canChat || !has;
    // The one Enter does is in ink.
    steerButton.classList.toggle("primary", !canQueue || enter === "steer");
    queueButton.classList.toggle("primary", canQueue && enter === "queue");
    asideButton.hidden = !canChat || !asideTarget();
    input.placeholder = busy ? (canQueue ? "Steer him, or queue what's next…" : "Steer him…") : "Ask Galahad…";
    panel.render({ queue, held, steering, busy, deadline: live?.deadline ?? null });
    // He's working in this chat on a turn this device may not watch (it may read the bank): said, with Stop.
    const other = unwatchable && !live ? unwatchable.id : "";
    if (other !== shownElsewhere) {
      shownElsewhere = other;
      replace(
        elsewhere,
        other
          ? callout("info", "That turn may read the bank, and this device may not, so it isn't shown here. It goes on on the node; the answer will be in the chat for devices that may.", {
              title: "He's working in this chat, started from another device",
              actions: button("Stop him", { size: "sm", icon: "stop", onClick: () => void ctx.api.post("/api/turns/stop", { turn: other }).catch((error: unknown) => toast("Couldn't stop him", { tone: "error", description: errorMessage(error) })) }),
            })
          : null,
      );
    }
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

  /** Your message: sent, or (while he works) steered or queued. Whatever is asked of it, it's checked for secrets first. */
  async function deliver(how: { modifier?: boolean; how?: "steer" | "queue" } = {}): Promise<void> {
    check(); // never trust a debounced result at the moment of sending
    const text = input.value.trim();
    if (!text || blocked || !canChat) return;
    const clear = (): void => {
      input.value = "";
      draft = "";
      grow();
      syncComposer();
    };
    // A side question typed into the box ("/btw …") is asked apart; it never becomes a message by accident.
    const aside = asideOf(text);
    if (aside !== null) {
      if (!asideTarget()) return void toast("Nothing to ask on the side yet", { description: "A side question is about a chat: ask something first.", tone: "warn" });
      clear();
      openChatAside(ctx.api, aside);
      return;
    }
    clear();
    const result = await sendMessage(ctx.api, text, how);
    if (typeof result === "object") {
      // It wasn't taken: the words go back in the box, and why is said.
      if (!scope.disposed && !input.value) {
        input.value = text;
        grow();
        check();
      } else if (!draft) draft = text;
      toast("Couldn't send it", { tone: "error", description: result.problem });
    }
  }

  input.addEventListener("input", () => {
    grow();
    syncComposer();
    checkSoon();
  });
  input.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      // Enter never stops him: it sends, steers or queues. Only Stop or Esc stops.
      void deliver({ modifier: event.ctrlKey || event.metaKey });
    }
  });
  scope.listen(document, "keydown", (event: KeyboardEvent) => {
    if (event.key === "Escape" && live && !document.querySelector("dialog[open]")) {
      event.preventDefault();
      stopChat();
    }
  });
  scope.listen(window, "scroll", () => {
    if (nearBottom()) jump.hidden = true;
  }, { passive: true });
  // A turn that started in this chat elsewhere (another device, the queue going on) is noticed and attached to.
  if (canChat) watchTurns(ctx.api, scope.signal);
  // The minute "stops by itself in …" names moves on while he works.
  const ticking = setInterval(() => live && syncComposer(), 30_000);
  scope.add(() => clearInterval(ticking));

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
      } else if (group === "project") {
        const next = option.value || null;
        temporary = false;
        if (thread.turns.length) newConversation(next);
        else startIn = next;
      } else if (group === "keep") {
        if (thread.turns.length) newConversation();
        temporary = !temporary;
      }
      renderSub();
      if (!thread.turns.length) renderAll();
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
      // Where it stands, at a glance: working, needs you, queued, stopped or failed (nothing when it's simply done).
      chatStateBadge(c),
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
    if (!thread.turns.length) renderAll();
  };
  keptChanged.add(onKept);
  scope.add(() => keptChanged.delete(onKept));

  const form = h(
    "form",
    {
      class: "composer",
      onsubmit: (event: Event) => {
        event.preventDefault();
        void deliver();
      },
    },
    input,
    h("div", { class: "composer-bar" }, icon("shield-check", { size: 14, class: "subtle", label: "Checked for secrets before sending" }), meta, asideButton, queueButton, steerButton, stopButton, sendButton),
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
      threadEl,
      h("div", { class: "composer-wrap", style: "position:sticky" }, h("div", { style: "position:relative" }, jump), alerts, elsewhere, panel.el, form),
    ),
  );

  changed.add(onChange);
  scope.add(() => changed.delete(onChange));
  // Arriving for one chat, or to start one in a project.
  if (opts.conversation && opts.conversation !== current?.id) {
    openConversation(ctx.api, opts.conversation).catch((error: unknown) => toast("Couldn't open that chat", { tone: "error", description: errorMessage(error) }));
  } else if (opts.project && !live && startIn !== opts.project) {
    if (thread.turns.length) newConversation(opts.project);
    else startIn = opts.project;
  } else if (!opts.conversation && !opts.query && canChat) restoreOpenChat(ctx.api);
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
