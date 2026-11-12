import { findSecrets } from "@galahad/core/secret-scan";
import type { Api } from "../api.ts";
import { asideOf } from "../lib/turns.ts";
import { chatEnter } from "../prefs.ts";
import { button } from "../ui/controls.ts";
import { h, replace } from "../ui/dom.ts";
import { icon } from "../ui/icons.ts";
import { renderMarkdown } from "../ui/markdown.ts";
import { toast } from "../ui/toast.ts";
import { type ChatTurn, chatState, onChatChange, openChatAside, queueActions, sendMessage, stopChat, watchTurns } from "./chat.ts";
import { queuePanel } from "./chat-queue.ts";

/*
 * Talking to Galahad in the SANDBOX: a composer at the foot of the world and,
 * above it, the last few turns of the conversation, so you can ask him
 * something and watch him walk off to the library, the watchtower or the
 * treasury to answer it. It's the same conversation the Chat page shows (its
 * role, project and keeping apply): start here, carry on there, or the other
 * way round. The turn runs on the node, so it goes on if you leave the world;
 * while he works, a message here steers him now or is queued for after, as on
 * the Chat page. A message that looks like a secret is never sent.
 */

/** The last this many turns show in the world (the Chat page has the rest). */
const SHOWN = 6;

export interface WorldChat {
  readonly el: HTMLElement;
  focus(): void;
  dispose(): void;
}

export function createWorldChat(opts: { api: Api; onAsk: () => void; openChat: () => void }): WorldChat {
  const log = h("div", { class: "world-chat-log card", "aria-live": "polite", "aria-label": "Your conversation with Galahad", hidden: true });
  const alert = h("p", { class: "world-chat-alert small", role: "alert", hidden: true });
  const input = h("textarea", { rows: 1, placeholder: "Ask Galahad…", "aria-label": "Message to Galahad", autocomplete: "off", enterkeyhint: "send" }) as HTMLTextAreaElement;
  const sendButton = h("button", { class: "btn primary sm icon-only", type: "submit", "aria-label": "Send" }, icon("arrow-up", { size: 16 }));
  // While he works: steer him now, or queue it for after (the one this device's Enter does is in ink), and Stop.
  const steerButton = button("Steer", { size: "sm", title: "Tell him now: it reaches him at his next safe point", onClick: () => void deliver({ how: "steer" }) });
  const queueButton = button("Queue", { size: "sm", title: "Keep it on the node and send it when he's done", onClick: () => void deliver({ how: "queue" }) });
  const stopButton = button("Stop", { size: "sm", icon: "stop", iconOnly: true, label: "Stop him", title: "Stop him (Esc)", onClick: () => stopChat() });
  const form = h("form", { class: "world-chat-bar" }, icon("chat", { size: 16, class: "subtle" }), input, queueButton, steerButton, stopButton, sendButton);
  const panel = queuePanel(queueActions(opts.api), { compact: true });
  const el = h("div", { class: "world-chat" }, log, panel.el, alert, form);
  const watching = new AbortController();
  let collapsed = false;
  let blocked = false;
  let frame = 0;

  const grow = () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
  };

  function turnView(t: ChatTurn): HTMLElement {
    if (t.role === "user") return h("div", { class: "world-chat-turn you" }, t.content);
    const body = h("div", { class: "world-chat-answer" });
    if (t.content) body.append(renderMarkdown(t.content));
    const live = t.status === "streaming";
    return h(
      "div",
      { class: "world-chat-turn galahad", "data-status": t.status },
      live ? h("div", { class: "world-chat-step tiny" }, h("span", { class: "spinner", "aria-hidden": "true" }), t.step ?? "Starting…") : null,
      body,
      t.status === "error" ? h("div", { class: "tiny world-chat-error" }, t.error ?? "Galahad couldn't answer.") : null,
      t.status === "stopped" ? h("div", { class: "tiny subtle" }, "Stopped.") : null,
    );
  }

  function render(): void {
    frame = 0;
    const state = chatState();
    const turns = state.turns.slice(-SHOWN);
    const has = Boolean(input.value.trim()) && !blocked;
    sendButton.hidden = state.busy;
    sendButton.disabled = !has;
    stopButton.hidden = steerButton.hidden = !state.busy;
    queueButton.hidden = !state.busy || !state.canQueue;
    steerButton.disabled = queueButton.disabled = !has;
    const enter = chatEnter();
    steerButton.classList.toggle("primary", !state.canQueue || enter === "steer");
    queueButton.classList.toggle("primary", state.canQueue && enter === "queue");
    input.placeholder = state.busy ? (state.canQueue ? "Steer him, or queue what's next…" : "Steer him…") : "Ask Galahad…";
    panel.render({ queue: state.queue, held: state.held, steering: state.steering, busy: state.busy, deadline: state.deadline });
    log.hidden = collapsed || !turns.length;
    if (log.hidden) return;
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    replace(
      log,
      h(
        "div",
        { class: "world-chat-head" },
        h("span", { class: "small strong grow ellipsis" }, state.title ?? "Talking with Galahad"),
        button("Ask on the side", { variant: "ghost", size: "sm", icon: "chat", iconOnly: true, title: "Ask on the side: answered apart, without changing what he's doing (/btw)", onClick: () => openChatAside(opts.api) }),
        button("Open in Chat", { variant: "ghost", size: "sm", icon: "external", iconOnly: true, onClick: opts.openChat }),
        button("Hide the conversation", { variant: "ghost", size: "sm", icon: "chevron-down", iconOnly: true, onClick: () => setCollapsed(true) }),
      ),
      ...turns.map(turnView),
    );
    if (atBottom || state.busy) log.scrollTop = log.scrollHeight;
  }
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(render);
  };

  function setCollapsed(on: boolean): void {
    collapsed = on;
    schedule();
  }

  function check(): void {
    const finding = findSecrets(input.value)[0];
    blocked = Boolean(finding);
    alert.hidden = !finding;
    alert.textContent = finding ? `That looks like a ${finding.kind}. It won't be sent: the models you talk to would see it. Keep it in the vault.` : "";
    schedule();
  }

  /** Your message: sent, or (while he works) steered or queued. Checked for secrets first, whatever is asked of it. */
  async function deliver(how: { modifier?: boolean; how?: "steer" | "queue" } = {}): Promise<void> {
    check();
    const text = input.value.trim();
    if (!text || blocked) return;
    const clear = (): void => {
      input.value = "";
      grow();
      schedule();
    };
    // A side question typed into the box ("/btw …") is asked apart.
    const aside = asideOf(text);
    if (aside !== null) {
      clear();
      openChatAside(opts.api, aside);
      return;
    }
    const wasIdle = !chatState().busy;
    clear();
    collapsed = false;
    const result = await sendMessage(opts.api, text, how);
    if (typeof result === "object") {
      // It wasn't taken: the words go back in the box, and why is said.
      if (!input.value) {
        input.value = text;
        grow();
        check();
      }
      toast("Couldn't send it", { tone: "error", description: result.problem });
      return;
    }
    if (result === "queued") toast("Queued", { description: "Kept on the node; sent when he's done with this turn." });
    if (wasIdle) opts.onAsk();
    schedule();
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void deliver();
  });
  input.addEventListener("input", () => {
    grow();
    check();
  });
  input.addEventListener("focus", () => {
    if (collapsed && chatState().turns.length) setCollapsed(false);
  });
  input.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      // Enter never stops him: it sends, steers or queues. Only Stop or Esc stops.
      void deliver({ modifier: event.ctrlKey || event.metaKey });
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (chatState().busy) stopChat();
      else input.blur();
    }
  });
  const stop = onChatChange(schedule);
  // A turn started in this chat elsewhere (the Chat page on another device, the queue going on) is attached to here too.
  watchTurns(opts.api, watching.signal);
  render();

  return {
    el,
    focus: () => input.focus(),
    dispose() {
      stop();
      watching.abort();
      if (frame) cancelAnimationFrame(frame);
    },
  };
}
