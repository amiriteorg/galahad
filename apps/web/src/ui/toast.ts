import { h } from "./dom.ts";
import { icon, type IconName } from "./icons.ts";

/*
 * Stacked toasts in the Sonner manner: newest in front, older ones tucked
 * behind and scaled back, the whole stack fanning out on hover or focus.
 * Timers pause while you're reading. Errors stay longer and are announced
 * assertively; everything else politely.
 */

export type ToastTone = "info" | "ok" | "warn" | "error";

export interface ToastOptions {
  description?: string;
  tone?: ToastTone;
  action?: { label: string; run: () => void };
  /** ms; 0 keeps it until dismissed. */
  duration?: number;
}

interface Live {
  el: HTMLElement;
  remaining: number;
  started: number;
  timer: ReturnType<typeof setTimeout> | null;
}

const MAX_VISIBLE = 3;
const TONE_ICON: Record<ToastTone, IconName> = { info: "info", ok: "check-circle", warn: "alert", error: "x-circle" };
const TONE_VAR: Record<ToastTone, string> = { info: "var(--text-2)", ok: "var(--ok)", warn: "var(--warn)", error: "var(--danger)" };

let toaster: HTMLElement | null = null;
let politeRegion: HTMLElement | null = null;
let assertiveRegion: HTMLElement | null = null;
const live: Live[] = [];
let paused = false;

function ensureToaster(): HTMLElement {
  if (toaster?.isConnected) return toaster;
  toaster = h("section", { class: "toaster", "aria-label": "Notifications" });
  politeRegion = h("div", { class: "sr-only", role: "status", "aria-live": "polite" });
  assertiveRegion = h("div", { class: "sr-only", role: "alert", "aria-live": "assertive" });
  toaster.addEventListener("pointerenter", pause);
  toaster.addEventListener("pointerleave", resume);
  toaster.addEventListener("focusin", pause);
  toaster.addEventListener("focusout", resume);
  document.body.append(toaster, politeRegion, assertiveRegion);
  return toaster;
}

/** Newest first: depth `--i` for the tucked stack, `--offset` for the fanned-out one. */
function layout(): void {
  let offset = 0;
  for (let index = live.length - 1; index >= 0; index--) {
    const item = live[index]!;
    const depth = live.length - 1 - index;
    item.el.style.setProperty("--i", String(Math.min(depth, MAX_VISIBLE)));
    item.el.style.setProperty("--offset", `${offset}px`);
    item.el.style.zIndex = String(100 - depth);
    item.el.dataset.hidden = String(depth >= MAX_VISIBLE);
    offset += item.el.offsetHeight + 8;
  }
}

function schedule(item: Live): void {
  if (item.remaining <= 0 || paused) return;
  item.started = Date.now();
  item.timer = setTimeout(() => dismiss(item), item.remaining);
}

function pause(): void {
  paused = true;
  for (const item of live) {
    if (item.timer) {
      clearTimeout(item.timer);
      item.timer = null;
      item.remaining -= Date.now() - item.started;
    }
  }
}

function resume(): void {
  paused = false;
  for (const item of live) if (!item.timer && item.remaining > 0) schedule(item);
}

function dismiss(item: Live): void {
  const index = live.indexOf(item);
  if (index < 0) return;
  live.splice(index, 1);
  if (item.timer) clearTimeout(item.timer);
  item.el.classList.add("leaving");
  const remove = () => item.el.remove();
  item.el.addEventListener("transitionend", remove, { once: true });
  setTimeout(remove, 400);
  layout();
}

/** A toast as it is drawn: `done` puts it away (its close button, and its action once run). toast() raises one; the
 * gallery (apps/web/design/gallery.ts) draws them in place. */
export function toastCard(title: string, options: ToastOptions = {}, done: () => void = () => {}): HTMLElement {
  const tone = options.tone ?? "info";
  const close = h("button", { class: "btn ghost sm icon-only", type: "button", "aria-label": "Dismiss", onclick: done }, icon("x", { size: 14 }));
  return h(
    "div",
    { class: "toast", style: `--tone:${TONE_VAR[tone]}` },
    icon(TONE_ICON[tone], { size: 16 }),
    h("div", { class: "toast-body" }, h("div", { class: "toast-title" }, title), options.description ? h("div", { class: "toast-desc" }, options.description) : null),
    options.action
      ? h(
          "button",
          {
            class: "btn sm",
            type: "button",
            onclick: () => {
              options.action?.run();
              done();
            },
          },
          options.action.label,
        )
      : null,
    close,
  );
}

export function toast(title: string, options: ToastOptions = {}): () => void {
  // A modal dialog makes the rest of the page inert and covers it, so a toast raised
  // now would be hidden and unannounced. Show it once the dialog has closed instead;
  // feedback that belongs inside a dialog is shown inline there.
  const modal = [...document.querySelectorAll<HTMLDialogElement>("dialog[open]")].at(-1);
  if (modal) {
    let cancelled = false;
    let dismissLater: (() => void) | null = null;
    modal.addEventListener("close", () => {
      if (!cancelled) dismissLater = toast(title, options);
    }, { once: true });
    return () => {
      cancelled = true;
      dismissLater?.();
    };
  }
  const host = ensureToaster();
  const tone = options.tone ?? "info";
  const duration = options.duration ?? (tone === "error" ? 8000 : options.action ? 6000 : 4000);
  const el = toastCard(title, options, () => dismiss(item));
  el.classList.add("entering");
  const item: Live = { el, remaining: duration, started: Date.now(), timer: null };
  host.appendChild(el);
  live.push(item);
  layout();
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove("entering")));
  const region = tone === "error" ? assertiveRegion : politeRegion;
  if (region) region.textContent = options.description ? `${title}. ${options.description}` : title;
  schedule(item);
  while (live.length > 8) dismiss(live[0]!);
  return () => dismiss(item);
}
