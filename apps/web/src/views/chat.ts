import { type ChatMessage, findSecrets } from "@galahad/core";
import { errorMessage, type View } from "../context.ts";
import { append, h, notice, replace, richText } from "../dom.ts";

interface Turn {
  role: "user" | "assistant";
  content: string;
  by?: string;
  notes: string[];
  error?: string;
}

// Conversation lives in memory only for this page session; it is never persisted in the browser.
const conversation: Turn[] = [];
let role = "planner";

export const chatView: View = (root, ctx) => {
  let controller: AbortController | null = null;

  const list = h("div", { class: "messages", "aria-live": "polite", "aria-relevant": "additions text" });
  const alerts = h("div");
  const input = h("textarea", {
    id: "chat-input",
    rows: 1,
    placeholder: "Ask Galahad…",
    "aria-label": "Message to Galahad",
    autocomplete: "off",
  });
  const roleSelect = h("select", { "aria-label": "Role", style: "width:auto" }, h("option", { value: role }, role));
  const send = h("button", { class: "btn primary", type: "submit" }, "Send");
  const stop = h("button", { class: "btn", type: "button", hidden: true }, "Stop");

  function bubble(turn: Turn): HTMLElement {
    const el = h("div", { class: `msg ${turn.role}` });
    append(el, richText(turn.content || (turn.role === "assistant" && !turn.error ? "…" : "")));
    if (turn.error) append(el, h("span", { class: "by", style: "color:var(--danger)" }, turn.error));
    const meta = [turn.by ? `— ${turn.by}` : "", ...turn.notes].filter(Boolean).join(" · ");
    if (meta) append(el, h("span", { class: "by" }, meta));
    return el;
  }

  function renderAll(): void {
    if (!conversation.length) {
      replace(
        list,
        h(
          "div",
          { class: "empty" },
          h("img", { src: "/icon.svg", alt: "" }),
          h("p", {}, "At your service."),
          h("p", { class: "small" }, "Ask anything. Galahad recalls what your fleet remembers. Keys belong in the Vault, never here."),
        ),
      );
      return;
    }
    replace(list, ...conversation.map(bubble));
  }

  function renderLast(): void {
    const last = list.lastElementChild;
    const turn = conversation.at(-1);
    if (last && turn) last.replaceWith(bubble(turn));
    window.scrollTo({ top: document.body.scrollHeight });
  }

  function showSecretNotice(kind: string, secret: string): void {
    replace(
      alerts,
      notice(
        h(
          "div",
          {},
          h("p", {}, `That looks like a ${kind}. Secrets never go into chat — the models you talk to would see them.`),
          h(
            "div",
            { class: "row" },
            h(
              "button",
              {
                class: "btn primary small",
                type: "button",
                onclick: () => {
                  input.value = "";
                  replace(alerts);
                  ctx.navigate("vault", { prefillKey: secret });
                },
              },
              "Store it in the vault instead",
            ),
            h("button", { class: "btn small", type: "button", onclick: () => replace(alerts) }, "Dismiss"),
          ),
        ),
        "warn",
      ),
    );
  }

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || controller) return;
    const finding = findSecrets(text)[0];
    if (finding) {
      showSecretNotice(finding.kind, text.slice(finding.index, finding.index + finding.length));
      return;
    }
    replace(alerts);
    input.value = "";
    conversation.push({ role: "user", content: text, notes: [] });
    const turn: Turn = { role: "assistant", content: "", notes: [] };
    conversation.push(turn);
    renderAll();
    window.scrollTo({ top: document.body.scrollHeight });

    controller = new AbortController();
    send.disabled = true;
    stop.hidden = false;
    const messages: ChatMessage[] = conversation
      .filter((t) => t !== turn && t.content && !t.error)
      .map((t) => ({ role: t.role, content: t.content }));
    try {
      for await (const ev of ctx.api.chat({ role, messages }, controller.signal)) {
        if (ev.type === "text") turn.content += ev.text;
        else if (ev.type === "model") turn.by = ev.ref;
        else if (ev.type === "fallback") turn.notes.push(`skipped ${ev.from}`);
        else if (ev.type === "error") turn.error = ev.error;
        renderLast();
      }
    } catch (error) {
      if ((error as Error).name !== "AbortError") turn.error = errorMessage(error);
      else turn.notes.push("stopped");
      renderLast();
    } finally {
      controller = null;
      send.disabled = false;
      stop.hidden = true;
      input.focus();
    }
  }

  stop.addEventListener("click", () => controller?.abort());
  roleSelect.addEventListener("change", () => {
    role = roleSelect.value;
  });
  input.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void submit(event);
    }
  });
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 200)}px`;
  });

  const form = h("form", { onsubmit: (event: Event) => void submit(event) }, input, send, stop);
  replace(
    root,
    h(
      "section",
      { class: "chat", "aria-labelledby": "chat-title" },
      h("div", { class: "row" }, h("h1", { id: "chat-title", class: "grow" }, "Counsel"), roleSelect),
      list,
      h("div", { class: "composer" }, alerts, form),
    ),
  );
  renderAll();

  if (!ctx.can("chat")) {
    input.disabled = true;
    send.disabled = true;
    replace(alerts, notice("This device was not granted the chat scope.", "warn"));
  }

  ctx.api
    .get<{ roster: Record<string, { models: string[]; description: string }> }>("/api/roster")
    .then(({ roster }) => {
      replace(
        roleSelect,
        ...Object.entries(roster).map(([name, spec]) =>
          h("option", { value: name, title: `${spec.description} — ${spec.models.join(" → ")}`, selected: name === role }, name),
        ),
      );
    })
    .catch(() => {
      /* roster needs mind:read; keep the default role */
    });

  return () => controller?.abort();
};
