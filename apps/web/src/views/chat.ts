import type { ChatMessage } from "@galahad/core";
import { findSecrets } from "@galahad/core/secret-scan";
import { type Api, ApiError, isAbort } from "../api.ts";
import { errorMessage, type View } from "../context.ts";
import { duration } from "../lib/time.ts";
import { lastRole, rememberRole } from "../prefs.ts";
import type { RoleSpec } from "../types.ts";
import { button, callout, copyText, segmented } from "../ui/controls.ts";
import { debounce, h, replace } from "../ui/dom.ts";
import { emblem } from "../ui/emblem.ts";
import { icon, type IconName } from "../ui/icons.ts";
import { renderMarkdown } from "../ui/markdown.ts";
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
const ROLE_ICON: Record<string, IconName> = { planner: "compass", engineer: "code", reviewer: "review", swift: "zap" };

// ---- module state: survives navigation, never persisted ----
let turns: Turn[] = [];
let nextId = 1;
let controller: AbortController | null = null;
let draft = "";
let role = lastRole() ?? "planner";
let roster: Record<string, RoleSpec> | null = null;
const changed = new Set<(turn: Turn | null) => void>();

/** For the shell: whether Galahad is answering right now, and with which model. */
export const chatActivity = signal<{ streaming: boolean; model: string | null }>({ streaming: false, model: null });

const emit = (turn: Turn | null) => {
  for (const fn of changed) fn(turn);
};

export function stopChat(): void {
  controller?.abort();
}

/** Clears the conversation; returns a function that restores it (for Undo). */
export function newConversation(): () => void {
  stopChat();
  const saved = turns;
  turns = [];
  emit(null);
  return () => {
    if (turns.length) return;
    turns = saved;
    emit(null);
  };
}

/** "New chat" from anywhere: clears the conversation, and offers Undo when there was one. */
export function startNewChat(): void {
  if (!turns.length) return;
  const restore = newConversation();
  toast("Conversation cleared", { action: { label: "Undo", run: restore } });
}

const toolCount = (turn: Turn): number => turn.steps.filter((s) => s.tool).length;

function step(turn: Turn, next: Step): void {
  const last = turn.steps.at(-1);
  if (last?.state === "active") last.state = "done";
  turn.steps.push(next);
}

async function run(api: Api, turn: Turn): Promise<void> {
  controller = new AbortController();
  chatActivity.set({ streaming: true, model: null });
  const history: ChatMessage[] = turns
    .filter((t) => t !== turn && t.content && t.status !== "error" && t.id < turn.id)
    .map((t) => ({ role: t.role, content: t.content }));
  step(turn, { icon: "arrow-up", text: `Asked as ${turn.as}`, state: "done" });
  try {
    for await (const event of api.chat({ role: turn.as, messages: history }, controller.signal)) {
      if (event.type === "model") {
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
      turn.error = error instanceof ApiError && error.status === 422 ? error.message : errorMessage(error);
      step(turn, { icon: "x-circle", text: "Couldn't answer", detail: turn.error, state: "error" });
    }
  } finally {
    turn.endedAt = Date.now();
    controller = null;
    chatActivity.set({ streaming: false, model: null });
    emit(turn);
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

function retry(api: Api, turn: Turn): void {
  if (controller) return;
  const index = turns.indexOf(turn);
  if (index < 0) return;
  turns.splice(index, 1);
  const again: Turn = { id: nextId++, role: "assistant", content: "", as: role, steps: [], status: "streaming", fallbacks: 0, startedAt: Date.now() };
  turns.push(again);
  emit(null);
  void run(api, again);
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

  // Role control
  const roleHost = h("div", { class: "row" });
  function renderRoles(): void {
    const specs = roster ?? DEFAULT_ROLES;
    const names = Object.keys(specs);
    if (!names.includes(role)) role = names[0] ?? "planner";
    if (names.length <= 5) {
      const control = segmented(
        names.map((name) => ({ value: name, label: name[0]!.toUpperCase() + name.slice(1), icon: ROLE_ICON[name] ?? "sparkle", title: specs[name]!.description })),
        role,
        (value) => {
          role = value;
          rememberRole(value);
          renderMeta();
        },
        { label: "Who answers", small: true },
      );
      replace(roleHost, control.el);
    } else {
      const select = h("select", { class: "select", "aria-label": "Who answers", style: "width:auto" }, ...names.map((n) => h("option", { value: n, selected: n === role }, n)));
      select.addEventListener("change", () => {
        role = select.value;
        rememberRole(role);
        renderMeta();
      });
      replace(roleHost, select);
    }
    renderMeta();
  }
  function renderMeta(): void {
    const spec = (roster ?? DEFAULT_ROLES)[role];
    const first = spec?.models[0];
    meta.textContent = controller ? "Esc to stop" : first ? `${role} → ${first}${spec!.models.length > 1 ? ` (+${spec!.models.length - 1} fallback${spec!.models.length > 2 ? "s" : ""})` : ""}` : `Enter to send · Shift+Enter for a new line`;
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
      h("h2", {}, "At your service."),
      h("p", {}, "Ask anything. Galahad recalls what your fleet remembers. Keys belong in the vault, never here."),
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
    if (force || nearBottom()) window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" as ScrollBehavior });
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
      h("div", { class: "chat-head" }, roleHost, h("span", { class: "spacer" }), newChat),
      thread,
      h("div", { class: "composer-wrap", style: "position:sticky" }, h("div", { style: "position:relative" }, jump), alerts, form),
    ),
  );

  changed.add(onChange);
  scope.add(() => changed.delete(onChange));
  renderAll();
  renderRoles();
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
