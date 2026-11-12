import { EYES, EYES_PLACE_LABEL, type EyesRequest, imageInfo, type ReviewStatus } from "@galahad/core/eyes";
import type { Api } from "../api.ts";
import { errorMessage } from "../context.ts";
import { button } from "../ui/controls.ts";
import { h } from "../ui/dom.ts";
import { toast } from "../ui/toast.ts";
import type { EyesShot, EyesState } from "../world/scene.ts";

/*
 * His eyes, on the SANDBOX's HUD: a small picture of what Galahad sees from his
 * own visor, under the map. A button in the tools row opens and closes it (V;
 * remembered in this browser, like the map; open by default where there's room
 * and the device isn't on the low tier); in it, one button swaps it with the main
 * view (B: look through his eyes full size, the usual view in the panel, and
 * back) and one opens his review of his own world. Asleep his eyes are shut: two
 * lids close over the picture (over the whole view when it's his), and open when
 * the dog wakes him; he blinks now and then (CSS alone; never under reduced
 * motion, where the lids simply are where they are).
 *
 * What he sees is also said: the picture has a text alternative, worked out from
 * the world's own knowledge (where he is, what he's looking at, what stands in
 * view), refreshed every couple of seconds while the panel is open.
 *
 * This is also where the page answers the node's `eyes` requests (the `look`
 * tool, his review): one frame, rendered here, posted back with its words. A
 * hidden tab draws nothing and stays silent: another page may answer.
 */

const EYES_KEY = "galahad.world.eyes";

/** The viewer's own choice for the panel, if they've made one in this browser. */
function storedEyes(): boolean | null {
  try {
    const v = localStorage.getItem(EYES_KEY);
    if (v === "on" || v === "off") return v === "on";
  } catch {
    /* storage off: the default */
  }
  return null;
}

/** The world's handle, as far as his eyes need it. */
interface EyesHandle {
  eyes: {
    open(container: HTMLElement | null): void;
    swap(on: boolean): void;
    state(): EyesState;
    words(): string;
    shot(request: { width: number; place?: EyesRequest["place"] }): Promise<EyesShot | null>;
  };
  stats(): { tier: string };
}

export interface EyesPanel {
  /** The panel (under the map), its button for the tools row, and the lids over the whole view while it's his. */
  el: HTMLElement;
  button: HTMLButtonElement;
  lids: HTMLElement;
  /** The world was mounted (or restarted, or went away: null). */
  mount(handle: EyesHandle | null): void;
  toggle(): void;
  swap(): void;
  /** The node asks for a frame from his eyes. */
  answer(request: EyesRequest): void;
  dispose(): void;
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

const tokens = (n: number): string => n.toLocaleString("en-US");

export function createEyes(opts: {
  api: Api;
  /** Whether this device may run his review and set its budget (brain:write). */
  mayReview: boolean;
  /** The stage: it carries how far his eyes are shut, and whether his view is the main one. */
  stage: HTMLElement;
  /** His view became the main one (or stopped being it): the page follows him then. */
  onSwap(on: boolean): void;
}): EyesPanel {
  let handle: EyesHandle | null = null;
  let on: boolean | null = storedEyes();
  let swapped = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let ticks = 0;
  let disposed = false;

  const lid = (where: string) => h("span", { class: `eyes-lid ${where}` });
  const tag = h("span", { class: "eyes-tag" }, "His eyes");
  const words = h("p", { class: "sr-only", id: "world-eyes-words" }, "What Galahad sees isn't known yet.");
  const view = h("div", { class: "world-eyes-view", role: "img", "aria-label": "What Galahad sees, through his own eyes", "aria-describedby": "world-eyes-words" }, lid("top"), lid("bottom"), h("span", { class: "eyes-blink", "aria-hidden": "true" }), tag);
  const swapButton = button("Look through his eyes", { iconOnly: true, icon: "swap", size: "sm", onClick: () => swap() });
  swapButton.setAttribute("aria-pressed", "false");
  const reviewButton = button("His review of his world", { iconOnly: true, icon: "search", size: "sm", onClick: () => setCard(Boolean(card.hidden)) });
  reviewButton.setAttribute("aria-expanded", "false");
  reviewButton.setAttribute("aria-controls", "world-eyes-review");

  // His review: where it stands, its budget, and the button that starts one.
  const reviewNote = h("p", { class: "small" }, "He looks at his world from where he is and from a few places of his day, and says what looks wrong or unfinished: suggestions in your Inbox, kept among his ideas. He changes nothing.");
  const reviewStatus = h("p", { class: "tiny muted", "aria-live": "polite" });
  const budget = h("input", { class: "input tnum", type: "number", min: 2000, max: 400_000, step: 1000, "aria-label": "Daily budget for his review, in tokens" }) as HTMLInputElement;
  const setBudget = button("Set", { size: "sm", onClick: () => void saveBudget() });
  const run = button("Review now", { icon: "search", size: "sm", variant: "primary", onClick: () => void review() });
  const card = h(
    "div",
    { class: "world-eyes-review card", id: "world-eyes-review", role: "group", "aria-label": "His review of his world", hidden: true },
    reviewNote,
    opts.mayReview ? h("label", { class: "eyes-budget" }, h("span", { class: "small strong" }, "Tokens a day"), budget, setBudget) : null,
    reviewStatus,
    opts.mayReview ? h("div", { class: "eyes-run" }, run) : h("p", { class: "tiny muted" }, "This device may not start a review."),
  );
  const el = h("section", { class: "world-eyes", "aria-label": "Galahad's eyes", hidden: true }, view, h("div", { class: "world-eyes-bar" }, swapButton, reviewButton), words, card);
  const toggleButton = button("His eyes", { iconOnly: true, icon: "visor", size: "sm", onClick: () => toggle() });
  toggleButton.setAttribute("aria-pressed", "false");
  const lids = h("div", { class: "world-lids", "aria-hidden": "true" }, lid("top"), lid("bottom"), h("span", { class: "eyes-blink" }));

  function showReview(s: ReviewStatus): void {
    if (document.activeElement !== budget) budget.value = String(s.budget);
    const last = s.last ? ` Last: ${s.last.summary}` : " He hasn't reviewed his world yet.";
    reviewStatus.textContent = `${tokens(s.spent)} of ${tokens(s.budget)} tokens used today.${last}`;
  }

  async function loadReview(): Promise<void> {
    try {
      showReview(await opts.api.get<ReviewStatus>("/api/world/review"));
    } catch (error) {
      reviewStatus.textContent = `Where his review stands isn't known: ${errorMessage(error)}`;
    }
  }

  async function saveBudget(): Promise<void> {
    const n = Number(budget.value);
    if (!Number.isInteger(n) || n < 2000 || n > 400_000) {
      reviewStatus.textContent = "A daily budget is a whole number of tokens from 2,000 to 400,000.";
      budget.focus();
      return;
    }
    try {
      showReview(await opts.api.post<ReviewStatus>("/api/world/review/budget", { budget: n }));
    } catch (error) {
      reviewStatus.textContent = `The budget wasn't set: ${errorMessage(error)}`;
    }
  }

  async function review(): Promise<void> {
    run.disabled = true;
    reviewStatus.textContent = "He's looking at his world: the view goes to each place for a moment. This takes a minute or two…";
    try {
      const result = await opts.api.post<{ status: string; summary: string; findings: { view: keyof typeof EYES_PLACE_LABEL | "self"; where: string; what: string }[] }>("/api/world/review", {});
      reviewStatus.textContent = result.summary;
      toast(result.findings.length ? `He has ${result.findings.length} suggestion${result.findings.length === 1 ? "" : "s"} for his world` : "He reviewed his world", { description: result.summary });
    } catch (error) {
      reviewStatus.textContent = `He couldn't review his world: ${errorMessage(error)}`;
    } finally {
      run.disabled = false;
    }
  }

  function setCard(open: boolean): void {
    card.hidden = !open;
    reviewButton.setAttribute("aria-expanded", String(open));
    if (open) void loadReview();
  }

  /** The lids, and (every couple of seconds) the words. */
  function tick(): void {
    if (!handle) return;
    const state = handle.eyes.state();
    opts.stage.style.setProperty("--eyes-shut", state.shut.toFixed(2));
    opts.stage.dataset.eyesShut = state.shut > 0.6 ? "true" : "false";
    if (ticks++ % 10 === 0 && !el.hidden) {
      const text = handle.eyes.words();
      if (words.textContent !== text) words.textContent = text;
      view.title = text;
    }
  }

  function sync(): void {
    const open = !!on && !!handle;
    el.hidden = !open;
    toggleButton.setAttribute("aria-pressed", String(open));
    handle?.eyes.open(open ? view : null);
    if (!open && swapped) setSwap(false);
    if (!open) setCard(false);
    const wanted = open || swapped;
    if (wanted && !timer) {
      ticks = 0;
      timer = setInterval(tick, 200);
      tick();
    } else if (!wanted && timer) {
      clearInterval(timer);
      timer = null;
      opts.stage.style.removeProperty("--eyes-shut");
      delete opts.stage.dataset.eyesShut;
    }
  }

  function setSwap(next: boolean): void {
    swapped = next && !!handle;
    handle?.eyes.swap(swapped);
    if (swapped) opts.stage.dataset.eyes = "main";
    else delete opts.stage.dataset.eyes;
    swapButton.setAttribute("aria-pressed", String(swapped));
    const label = swapped ? "Back to the usual view" : "Look through his eyes";
    swapButton.title = label;
    swapButton.setAttribute("aria-label", label);
    tag.textContent = swapped ? "The usual view" : "His eyes";
    view.setAttribute("aria-label", swapped ? "The usual view, from over his shoulder" : "What Galahad sees, through his own eyes");
    opts.onSwap(swapped);
  }

  function toggle(): void {
    on = !(on && handle);
    try {
      localStorage.setItem(EYES_KEY, on ? "on" : "off");
    } catch {
      /* storage off: it lasts while the page does */
    }
    sync();
  }

  function swap(): void {
    if (!handle) return;
    if (!on) toggle();
    setSwap(!swapped);
    sync();
  }

  async function answer(request: EyesRequest): Promise<void> {
    // A hidden tab draws nothing: it stays silent, and another page may answer.
    if (!handle || disposed || document.hidden) return;
    const shot = await handle.eyes.shot({ width: request.width, ...(request.place ? { place: request.place } : {}) });
    if (!shot || disposed) return;
    const text = shot.words.slice(0, EYES.words);
    let body: Record<string, unknown>;
    if (shot.shut) body = { request: request.id, shut: true, words: text };
    else {
      if (!shot.blob) return;
      const bytes = new Uint8Array(await shot.blob.arrayBuffer());
      // What the browser really encoded (a JPEG; a PNG where it can't), read from its own header as the node will.
      const info = imageInfo(bytes);
      if (!info || bytes.length > EYES.maxBytes) return;
      body = { request: request.id, image: base64(bytes), type: info.type, width: info.width, height: info.height, words: text };
    }
    try {
      await opts.api.post("/api/world/eyes", body);
    } catch {
      /* another page answered first, or the request was no longer waiting */
    }
  }

  return {
    el,
    button: toggleButton,
    lids,
    mount(next) {
      handle = next;
      swapped = false;
      delete opts.stage.dataset.eyes;
      swapButton.setAttribute("aria-pressed", "false");
      // No choice made here yet: open where there's room and the device has it to spare (never by itself on the low tier).
      if (next && on === null) on = !matchMedia("(max-width: 639px)").matches && next.stats().tier !== "low";
      sync();
    },
    toggle,
    swap,
    answer: (request) => void answer(request),
    dispose() {
      disposed = true;
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
