import { findSecrets } from "@galahad/core/secret-scan";
import type { Api } from "../api.ts";
import { button } from "../ui/controls.ts";
import { h, replace } from "../ui/dom.ts";
import { icon } from "../ui/icons.ts";
import { renderMarkdown } from "../ui/markdown.ts";
import { askGalahad, type ChatTurn, chatState, onChatChange, stopChat } from "./chat.ts";

/*
 * Talking to Galahad in the SANDBOX: a composer at the foot of the world and,
 * above it, the last few turns of the conversation, so you can ask him
 * something and watch him walk off to the library, the watchtower or the
 * treasury to answer it. It's the same conversation the Chat page shows (its
 * role, project and keeping apply): start here, carry on there, or the other
 * way round. A message that looks like a secret is never sent.
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
  const form = h("form", { class: "world-chat-bar" }, icon("chat", { size: 16, class: "subtle" }), input, sendButton);
  const el = h("div", { class: "world-chat" }, log, alert, form);
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
    sendButton.replaceChildren(icon(state.busy ? "stop" : "arrow-up", { size: 16 }));
    sendButton.setAttribute("aria-label", state.busy ? "Stop" : "Send");
    sendButton.disabled = !state.busy && (!input.value.trim() || blocked);
    log.hidden = collapsed || !turns.length;
    if (log.hidden) return;
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    replace(
      log,
      h(
        "div",
        { class: "world-chat-head" },
        h("span", { class: "small strong grow ellipsis" }, state.title ?? "Talking with Galahad"),
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

  function submit(event?: Event): void {
    event?.preventDefault();
    if (chatState().busy) {
      stopChat();
      return;
    }
    check();
    const text = input.value.trim();
    if (!text || blocked) return;
    if (!askGalahad(opts.api, text)) return;
    input.value = "";
    grow();
    collapsed = false;
    opts.onAsk();
    schedule();
  }

  form.addEventListener("submit", submit);
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
      if (!chatState().busy) submit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (chatState().busy) stopChat();
      else input.blur();
    }
  });
  const stop = onChatChange(schedule);
  render();

  return {
    el,
    focus: () => input.focus(),
    dispose() {
      stop();
      if (frame) cancelAnimationFrame(frame);
    },
  };
}
