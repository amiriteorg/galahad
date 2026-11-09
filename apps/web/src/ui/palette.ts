import { rank } from "../lib/fuzzy.ts";
import { h, nextId, prefersReducedMotion, replace } from "./dom.ts";
import { icon, type IconName } from "./icons.ts";

/*
 * The command palette (⌘K / Ctrl+K): fuzzy search over everywhere you can go
 * and everything you can do. A combobox + listbox, fully keyboard-driven;
 * opens instantly (it is used often, so it barely animates).
 */

export interface Command {
  id: string;
  label: string;
  group: string;
  icon: IconName;
  keywords?: string[];
  /** Shortcut hint shown on the right, e.g. "G C". */
  hint?: string;
  run(): void;
}

export interface PaletteSource {
  commands(): Command[];
  /** Extra items computed from the query, e.g. "Search memory for …". */
  dynamic?(query: string): Command[];
}

let openDialog: HTMLDialogElement | null = null;

export function isPaletteOpen(): boolean {
  return Boolean(openDialog?.open);
}

export function openPalette(source: PaletteSource, initialQuery = ""): void {
  if (openDialog?.open) {
    openDialog.querySelector("input")?.focus();
    return;
  }
  const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const listId = nextId("palette-list");
  const input = h("input", {
    type: "text",
    role: "combobox",
    "aria-expanded": "true",
    "aria-controls": listId,
    "aria-autocomplete": "list",
    "aria-label": "Search commands and pages",
    placeholder: "Search or jump to…",
    autocomplete: "off",
    spellcheck: "false",
    value: initialQuery,
  });
  const list = h("div", { class: "palette-list", role: "listbox", id: listId, "aria-label": "Results" });
  const status = h("div", { class: "sr-only", role: "status", "aria-live": "polite" });
  const dialog = h(
    "dialog",
    { class: "palette", "aria-label": "Command palette" },
    h("div", { class: "palette-input" }, icon("search", { size: 18 }), input, h("kbd", {}, "Esc")),
    list,
    h(
      "div",
      { class: "palette-foot", "aria-hidden": "true" },
      h("span", {}, h("kbd", {}, "↑"), h("kbd", {}, "↓"), "to move"),
      h("span", {}, h("kbd", {}, "↵"), "to choose"),
      h("span", {}, h("kbd", {}, "Esc"), "to close"),
    ),
    status,
  );
  openDialog = dialog;

  let items: { command: Command; el: HTMLElement }[] = [];
  let active = 0;

  function select(index: number, scroll = true): void {
    if (!items.length) {
      input.removeAttribute("aria-activedescendant");
      return;
    }
    active = (index + items.length) % items.length;
    items.forEach((item, i) => item.el.setAttribute("aria-selected", String(i === active)));
    const el = items[active]!.el;
    input.setAttribute("aria-activedescendant", el.id);
    if (scroll) el.scrollIntoView({ block: "nearest" });
  }

  function labelWithMatches(label: string, indices: number[]): HTMLElement {
    const span = h("span", { class: "pl-label" });
    const set = new Set(indices);
    let run = "";
    let marked = false;
    const flush = () => {
      if (!run) return;
      span.append(marked ? h("mark", {}, run) : run);
      run = "";
    };
    for (let i = 0; i < label.length; i++) {
      const m = set.has(i);
      if (m !== marked) {
        flush();
        marked = m;
      }
      run += label[i];
    }
    flush();
    return span;
  }

  function render(): void {
    const query = input.value;
    const ranked = rank(query, source.commands());
    const extra = query.trim() ? (source.dynamic?.(query.trim()) ?? []) : [];
    const results = [...ranked.map((r) => ({ command: r.item, indices: r.match.indices })), ...extra.map((command) => ({ command, indices: [] as number[] }))];
    items = [];
    const nodes: HTMLElement[] = [];
    let group = "";
    // Without a query, keep the curated grouping; with one, a flat best-first list.
    const grouped = !query.trim();
    for (const { command, indices } of results) {
      if (grouped && command.group !== group) {
        group = command.group;
        nodes.push(h("div", { class: "palette-group", role: "presentation" }, group));
      }
      const el = h(
        "div",
        { class: "palette-item", role: "option", id: nextId("pl"), "aria-selected": "false" },
        icon(command.icon, { size: 16 }),
        labelWithMatches(command.label, indices),
        command.hint ? h("span", { class: "pl-hint" }, command.hint) : null,
      );
      const index = items.length;
      el.addEventListener("pointermove", () => active !== index && select(index, false));
      el.addEventListener("click", () => choose(index));
      items.push({ command, el });
      nodes.push(el);
    }
    if (!items.length) nodes.push(h("div", { class: "empty compact" }, h("p", {}, "Nothing matches. Try another word.")));
    replace(list, ...nodes);
    status.textContent = `${items.length} result${items.length === 1 ? "" : "s"}`;
    select(0);
  }

  function finish(): void {
    if (!dialog.isConnected) return;
    if (dialog.open) dialog.close();
    dialog.remove();
    if (openDialog === dialog) openDialog = null;
    // Only once the palette has left the top layer can focus go back where it was.
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  }

  function close(): void {
    if (!dialog.open) return;
    dialog.classList.remove("shown");
    if (prefersReducedMotion()) finish();
    else setTimeout(finish, 130);
  }

  function choose(index: number): void {
    const item = items[index];
    if (!item) return;
    // Choosing is frequent: leave at once, restore focus, then run (a command may open its own dialog).
    finish();
    item.command.run();
  }

  input.addEventListener("input", render);
  input.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "ArrowDown" || (event.ctrlKey && event.key === "n")) {
      event.preventDefault();
      select(active + 1);
    } else if (event.key === "ArrowUp" || (event.ctrlKey && event.key === "p")) {
      event.preventDefault();
      select(active - 1);
    } else if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      choose(active);
    } else if (event.key === "Home" && event.ctrlKey) {
      select(0);
    }
  });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) close();
  });

  document.body.appendChild(dialog);
  dialog.showModal();
  render();
  input.focus();
  input.select();
  requestAnimationFrame(() => dialog.classList.add("shown"));
}
