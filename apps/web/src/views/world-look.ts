import { type DogLook, type LookGroup, type LookOption, type LookTarget, lookOptions, type WildLine } from "../lib/look.ts";
import type { WorldModel } from "../lib/world.ts";
import { dot } from "../ui/controls.ts";
import { h, replace } from "../ui/dom.ts";
import { icon } from "../ui/icons.ts";

/*
 * The SANDBOX's smart selector: one button that says what the view is on
 * ("Galahad · Reading the bank", "Proving ground", an experiment's name), with
 * how many experiments are running, and behind it everything the view can look
 * at instead, grouped and searchable: type to narrow, arrows to move, Enter to
 * go, Escape to close. It takes the place of Follow, Go to and the experiments
 * list; a saved experiment picked here is replayed. What's offered and in what
 * order is lib/look.ts.
 */

export interface Look {
  /** The button and its card, side by side in the HUD's row (the card opens under it). */
  readonly el: HTMLElement;
  readonly isOpen: boolean;
  open(): void;
  close(focusButton?: boolean): void;
  /** What the view is on now, and how many experiments run; written only when they change. */
  show(label: string, meta: string, running: number): void;
  /** The model changed: refresh the list if it's open. */
  refresh(): void;
  /** A line at the foot of the card (the renderer's backend, tier and frame rate). */
  setFoot(text: string): void;
  dispose(): void;
}

let ids = 0;

export function createLook(options: { model: () => WorldModel; life?: () => string; dog?: () => DogLook | null; wild?: () => readonly WildLine[]; onPick: (target: LookTarget) => void; onOpen?: () => void }): Look {
  const listId = `world-look-list-${++ids}`;
  const label = h("span", { class: "look-label ellipsis" });
  const meta = h("span", { class: "look-meta ellipsis" });
  const running = h("span", { class: "look-running tnum", hidden: true });
  const button = h(
    "button",
    { class: "btn sm world-look-btn", type: "button", "aria-haspopup": "dialog", "aria-expanded": "false" },
    icon("compass", { size: 15 }),
    h("span", { class: "look-text" }, label, meta),
    running,
    icon("chevron-down", { size: 14, class: "subtle" }),
  );
  const input = h("input", {
    class: "input sm",
    type: "search",
    placeholder: "Galahad, his dog, an experiment, a place…",
    "aria-label": "Find what to look at",
    role: "combobox",
    "aria-controls": listId,
    "aria-expanded": "true",
    "aria-autocomplete": "list",
    autocomplete: "off",
    spellcheck: "false",
  }) as HTMLInputElement;
  const list = h("div", { class: "look-list", id: listId, role: "listbox", "aria-label": "What to look at" });
  const foot = h("span", { class: "tiny subtle grow ellipsis" });
  const card = h(
    "div",
    { class: "world-look-card card", role: "dialog", "aria-label": "Go to", hidden: true },
    h("div", { class: "look-search" }, icon("search", { size: 14, class: "subtle" }), input),
    list,
    h("div", { class: "look-foot" }, foot, h("span", { class: "tiny subtle" }, "L opens · F follows · M map")),
  );
  const el = h("div", { class: "world-look" }, button, card);

  let open = false;
  let shown: LookOption[] = [];
  let active = 0;
  let last = { label: "", meta: "", running: -1 };

  function render(): void {
    shown = lookOptions(options.model(), input.value, options.life?.() ?? "", Date.now(), options.dog?.() ?? null, options.wild?.() ?? []);
    active = Math.min(active, Math.max(0, shown.length - 1));
    const rows: HTMLElement[] = [];
    let group: LookGroup | null = null;
    shown.forEach((o, i) => {
      if (o.group !== group) {
        group = o.group;
        rows.push(h("div", { class: "look-group tiny", role: "presentation" }, o.group));
      }
      rows.push(
        h(
          "div",
          {
            class: "look-option",
            id: `${listId}-${i}`,
            role: "option",
            "aria-selected": String(i === active),
            "data-here": o.here ? "true" : null,
            onclick: () => pick(i),
            onpointermove: () => setActive(i),
          },
          o.tone ? dot(o.tone, { live: o.live }) : icon(o.icon, { size: 15, class: "subtle" }),
          h("span", { class: "grow look-option-text" }, h("span", { class: "small strong ellipsis" }, o.label), o.meta ? h("span", { class: "meta ellipsis" }, o.meta) : null),
          o.here ? h("span", { class: "tiny look-here" }, o.hereText ?? (o.group === "Partners" ? "with him" : "here")) : null,
        ),
      );
    });
    if (!shown.length) rows.push(h("p", { class: "small muted look-none" }, "Nothing by that name."));
    replace(list, ...rows);
    input.setAttribute("aria-activedescendant", shown.length ? `${listId}-${active}` : "");
  }

  function setActive(i: number): void {
    if (i === active || !shown.length) return;
    list.querySelector(`#${listId}-${active}`)?.setAttribute("aria-selected", "false");
    active = i;
    const row = list.querySelector(`#${listId}-${active}`);
    row?.setAttribute("aria-selected", "true");
    row?.scrollIntoView({ block: "nearest" });
    input.setAttribute("aria-activedescendant", `${listId}-${active}`);
  }

  function pick(i: number): void {
    const o = shown[i];
    if (!o) return;
    close(true);
    options.onPick(o.target);
  }

  function close(focusButton = false): void {
    if (!open) return;
    open = false;
    card.hidden = true;
    button.setAttribute("aria-expanded", "false");
    if (focusButton) button.focus();
  }

  button.addEventListener("click", () => (open ? close() : look.open()));
  input.addEventListener("input", () => {
    active = 0;
    render();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (shown.length) setActive((active + (event.key === "ArrowDown" ? 1 : shown.length - 1)) % shown.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      pick(active);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }
  });
  // A press anywhere else closes it.
  const outside = (event: PointerEvent) => {
    if (open && !el.contains(event.target as Node)) close();
  };
  document.addEventListener("pointerdown", outside);

  const look: Look = {
    el,
    get isOpen() {
      return open;
    },
    open() {
      if (open) return;
      open = true;
      input.value = "";
      active = 0;
      render();
      card.hidden = false;
      button.setAttribute("aria-expanded", "true");
      options.onOpen?.();
      input.focus({ preventScroll: true });
    },
    close,
    show(text, line, count) {
      if (text === last.label && line === last.meta && count === last.running) return;
      last = { label: text, meta: line, running: count };
      label.textContent = text;
      meta.textContent = line ? ` · ${line}` : "";
      running.hidden = count === 0;
      running.textContent = `${count} running`;
      button.setAttribute("aria-label", `Go to: looking at ${text}${line ? `, ${line}` : ""}${count ? `. ${count} experiment${count === 1 ? "" : "s"} running` : ""}`);
    },
    refresh() {
      if (open) render();
    },
    setFoot(text) {
      if (foot.textContent !== text) foot.textContent = text;
    },
    dispose() {
      document.removeEventListener("pointerdown", outside);
    },
  };
  return look;
}
