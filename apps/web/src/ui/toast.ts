import { stackPlaces } from "../lib/alerts.ts";
import { h } from "./dom.ts";
import { icon, type IconName } from "./icons.ts";

/*
 * Stacked toasts in the Sonner manner: newest in front, older ones tucked behind and scaled back, the whole stack
 * fanning out on hover or focus. Timers pause while you're reading. Errors stay longer and are announced
 * assertively; everything else politely.
 *
 * Their look (26 November 2026, to sit with Galahad's field): a precise surface with a hairline edge, its tone in that
 * edge and in a faint light behind its mark, never a coloured slab; one about a knight or Galahad may lead with their
 * orb, small and still. One comes into focus as it rises (a few pixels, out of a slight blur, with a whisper of
 * scale) and leaves with a short fade and drop. Where motion is reduced it only appears, and goes.
 */

export type ToastTone = "info" | "ok" | "warn" | "error";

export interface ToastOptions {
  description?: string;
  tone?: ToastTone;
  action?: { label: string; run: () => void };
  /** ms; 0 keeps it until dismissed. */
  duration?: number;
  /** Who it is about, in place of the tone's mark: a knight's face or Galahad's orb (ui/orb.ts knightFace, orb), 28 px
   * and still, its name in the title beside it. */
  lead?: HTMLElement;
}

interface Live {
  el: HTMLElement;
  /** Its height drawn whole: the stack, tucked, draws those behind the front one at the front one's height. */
  height: number;
  remaining: number;
  started: number;
  timer: ReturnType<typeof setTimeout> | null;
}

const TONE_ICON: Record<ToastTone, IconName> = { info: "info", ok: "check-circle", warn: "alert", error: "x-circle" };
/** Its colours, by index.html's [data-tone]: an error's are the danger tone's. */
const TONE_DATA: Record<ToastTone, string> = { info: "info", ok: "ok", warn: "warn", error: "danger" };
/** How long one takes to go, at most (its fade is --d-2; it is taken out of the page by then, transition or not). */
const LEAVING_MS = 400;

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

/** Each toast in its place (lib/alerts.ts stackPlaces): `--i` its step back while tucked, `--offset` its height above
 * the foot when fanned out; the front one marked, and its height the stack's (`--front-h`). */
function layout(): void {
  const places = stackPlaces(live.map((item) => item.height));
  live.forEach((item, index) => {
    const place = places[index]!;
    item.el.style.setProperty("--i", String(place.step));
    item.el.style.setProperty("--offset", `${place.offset}px`);
    item.el.style.zIndex = String(place.z);
    item.el.dataset.hidden = String(place.hidden);
    item.el.toggleAttribute("data-front", place.depth === 0);
  });
  toaster?.style.setProperty("--front-h", `${live.at(-1)?.height ?? 0}px`);
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
  // (Its own transition's end, not one of its words' fading inside it.)
  item.el.addEventListener("transitionend", (event) => event.target === item.el && remove());
  setTimeout(remove, LEAVING_MS);
  layout();
}

/** A toast as it is drawn: `done` puts it away (its close button, and its action once run). toast() raises one; the
 * gallery (apps/web/design/gallery.ts) draws them in place. */
export function toastCard(title: string, options: ToastOptions = {}, done: () => void = () => {}): HTMLElement {
  const tone = options.tone ?? "info";
  const close = h("button", { class: "btn ghost sm icon-only toast-close", type: "button", "aria-label": "Dismiss", onclick: done }, icon("x", { size: 14 }));
  return h(
    "div",
    { class: "toast", "data-tone": TONE_DATA[tone] },
    options.lead ? h("span", { class: "toast-lead is-face" }, options.lead) : h("span", { class: "toast-lead" }, icon(TONE_ICON[tone], { size: 16 })),
    h("div", { class: "toast-body" }, h("div", { class: "toast-title" }, title), options.description ? h("div", { class: "toast-desc" }, options.description) : null),
    options.action
      ? h(
          "button",
          {
            class: "btn sm toast-action",
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
  const modal = [...document.querySelectorAll<HTMLDialogElement>("dialog:modal")].at(-1);
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
  // It comes in at the front: drawn whole, so its height is its own (the tucked ones take it from it).
  el.classList.add("entering");
  el.toggleAttribute("data-front", true);
  const item: Live = { el, height: 0, remaining: duration, started: Date.now(), timer: null };
  host.appendChild(el);
  item.height = el.offsetHeight;
  live.push(item);
  layout();
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove("entering")));
  const region = tone === "error" ? assertiveRegion : politeRegion;
  if (region) region.textContent = options.description ? `${title}. ${options.description}` : title;
  schedule(item);
  while (live.length > 8) dismiss(live[0]!);
  return () => dismiss(item);
}
