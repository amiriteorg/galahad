import { type Child, cx, h, nextId } from "./dom.ts";
import { icon, type IconName } from "./icons.ts";
import { toast } from "./toast.ts";

/* Shared building blocks. Tones map to semantic tokens (see docs/DESIGN.md). */

export type Tone = "ok" | "warn" | "danger" | "info" | "accent" | "agent" | "neutral";

export function badge(text: string, tone: Tone = "neutral", iconName?: IconName): HTMLElement {
  return h("span", { class: "badge", "data-tone": tone }, iconName ? icon(iconName, { size: 12 }) : null, text);
}

export function dot(tone: Tone | null, options: { live?: boolean; label?: string } = {}): HTMLElement {
  return h("span", {
    class: cx("dot", options.live && "live"),
    "data-tone": tone,
    role: options.label ? "img" : null,
    "aria-label": options.label ?? null,
    "aria-hidden": options.label ? null : "true",
  });
}

export function count(n: number, quiet = false): HTMLElement {
  return h("span", { class: cx("count", quiet && "quiet"), "aria-label": `${n} waiting` }, n > 99 ? "99+" : String(n));
}

export function kbd(...keys: string[]): HTMLElement[] {
  return keys.map((k) => h("kbd", {}, k));
}

export interface ButtonOptions {
  variant?: "primary" | "danger" | "danger-solid" | "ghost" | "default";
  size?: "sm" | "lg";
  icon?: IconName;
  iconOnly?: boolean;
  label?: string;
  type?: "button" | "submit";
  disabled?: boolean;
  title?: string;
  block?: boolean;
  onClick?: (event: MouseEvent) => void;
}

export function button(text: string, options: ButtonOptions = {}): HTMLButtonElement {
  const variant = options.variant && options.variant !== "default" ? options.variant : null;
  const el = h(
    "button",
    {
      class: cx("btn", variant, options.size, options.iconOnly && "icon-only", options.block && "block"),
      type: options.type ?? "button",
      disabled: options.disabled ?? false,
      title: options.title ?? (options.iconOnly ? text : null),
      "aria-label": options.iconOnly ? (options.label ?? text) : (options.label ?? null),
    },
    options.icon ? icon(options.icon, { size: options.size === "sm" ? 14 : 16 }) : null,
    options.iconOnly ? null : h("span", {}, text),
  );
  if (options.onClick) el.addEventListener("click", options.onClick);
  return el;
}

/** Disables the button and shows a spinner while `work` runs. Returns its result. */
export async function busy<T>(el: HTMLButtonElement, work: () => Promise<T>): Promise<T> {
  if (el.getAttribute("aria-busy") === "true") throw new Error("already running");
  const wasDisabled = el.disabled;
  el.disabled = true;
  el.setAttribute("aria-busy", "true");
  const spinner = h("span", { class: "spinner", "aria-hidden": "true" });
  const firstIcon = el.querySelector("svg.icon");
  if (firstIcon) firstIcon.replaceWith(spinner);
  else el.prepend(spinner);
  try {
    return await work();
  } finally {
    if (firstIcon) spinner.replaceWith(firstIcon);
    else spinner.remove();
    el.removeAttribute("aria-busy");
    el.disabled = wasDisabled;
  }
}

export function callout(tone: Tone | "quiet", body: Child, options: { title?: string; icon?: IconName; actions?: Child } = {}): HTMLElement {
  const iconName: IconName = options.icon ?? (tone === "danger" ? "alert" : tone === "warn" ? "alert" : tone === "ok" ? "check-circle" : "info");
  return h(
    "div",
    { class: cx("callout", tone === "quiet" && "quiet"), "data-tone": tone === "quiet" ? null : tone, role: tone === "danger" ? "alert" : null },
    icon(iconName, { size: 16 }),
    h(
      "div",
      { class: "callout-body" },
      options.title ? h("div", { class: "callout-title" }, options.title) : null,
      h("div", {}, body),
      options.actions ? h("div", { class: "row wrap" }, options.actions) : null,
    ),
  );
}

export function empty(options: { icon: IconName; title: string; body?: Child; actions?: Child; compact?: boolean }): HTMLElement {
  return h(
    "div",
    { class: cx("empty", options.compact && "compact") },
    h("div", { class: "empty-icon" }, icon(options.icon, { size: 20 })),
    h("h3", {}, options.title),
    options.body ? h("p", {}, options.body) : null,
    options.actions ? h("div", { class: "btn-group" }, options.actions) : null,
  );
}

/** What each error state on screen would do to try again (see retryFailed). */
const retries = new WeakMap<Element, () => void>();

/** A courteous error with a way forward. When the node comes back, the shell tries it again by itself. */
export function errorState(title: string, error: unknown, retry?: () => void): HTMLElement {
  const el = empty({
    icon: "alert",
    title,
    body: error instanceof Error ? error.message : String(error),
    actions: retry ? button("Try again", { icon: "retry", onClick: retry }) : null,
    compact: true,
  });
  if (retry) {
    el.dataset.retry = "";
    retries.set(el, retry);
  }
  return el;
}

/** Tries again every error state under `root` that can (after a dropped connection comes back). Returns how many. */
export function retryFailed(root: ParentNode): number {
  let n = 0;
  for (const el of root.querySelectorAll("[data-retry]")) {
    const retry = retries.get(el);
    if (!retry) continue;
    retries.delete(el);
    n++;
    retry();
  }
  return n;
}

/** Skeleton rows standing in for a list, the same height as the real thing (no layout jump). */
export function skeletonRows(n = 3, options: { avatar?: boolean } = {}): HTMLElement {
  return h(
    "div",
    { class: "rows", "aria-hidden": "true" },
    ...Array.from({ length: n }, (_, i) =>
      h(
        "div",
        { class: "sk-row" },
        options.avatar ? h("div", { class: "skeleton", style: "width:28px;height:28px;border-radius:8px;flex:none" }) : null,
        h(
          "div",
          { class: "grow stack tight" },
          h("div", { class: "skeleton sk-line", style: `width:${[62, 48, 70, 55][i % 4]}%` }),
          h("div", { class: "skeleton sk-line", style: `width:${[34, 28, 40, 30][i % 4]}%;height:10px` }),
        ),
      ),
    ),
  );
}

export function skeletonBlock(height: number): HTMLElement {
  return h("div", { class: "skeleton", style: `height:${height}px;border-radius:12px`, "aria-hidden": "true" });
}

export async function copyText(text: string, what = "Copied", options: { quiet?: boolean } = {}): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    if (!options.quiet) toast(what, { tone: "ok", duration: 2000 });
    return true;
  } catch {
    if (!options.quiet) toast("Couldn't copy automatically", { tone: "warn", description: "Select the text and copy it by hand." });
    return false;
  }
}

/** A value with a copy button that reports on itself (it often lives inside a sheet). For invite links and commands; never for secrets. */
export function copyField(text: string, label = "Copy"): HTMLElement {
  const word = h("span", { "aria-live": "polite" }, "Copy");
  const btn = h("button", { class: "btn sm", type: "button", "aria-label": label }, icon("copy", { size: 14 }), word);
  btn.addEventListener("click", async () => {
    const ok = await copyText(text, label, { quiet: true });
    word.textContent = ok ? "Copied" : "Select it";
    setTimeout(() => (word.textContent = "Copy"), 1600);
  });
  return h("div", { class: "copyfield" }, h("code", {}, text), btn);
}

/**
 * A labelled field. The label, id and hint attach to the form control itself, even when
 * `control` is a wrapper around it (an icon-decorated secret field, for instance).
 */
export function field(label: string, control: HTMLElement, options: { hint?: Child; id?: string; error?: HTMLElement } = {}): HTMLElement {
  const target = control.matches("input, select, textarea") ? control : (control.querySelector<HTMLElement>("input, select, textarea") ?? control);
  const id = options.id ?? (target.id || nextId("f"));
  target.id = id;
  const hintId = options.hint ? `${id}-hint` : null;
  if (hintId) target.setAttribute("aria-describedby", hintId);
  return h("div", { class: "field" }, h("label", { for: id }, label), control, options.hint ? h("div", { class: "hint", id: hintId }, options.hint) : null, options.error ?? null);
}

/**
 * The only way keys are entered: a password field that never autocompletes,
 * spellchecks or capitalises. Callers read it once and clear it immediately.
 */
export function secretInput(options: { id?: string; placeholder?: string; label?: string } = {}): { wrap: HTMLElement; input: HTMLInputElement } {
  const input = h("input", {
    class: "input",
    type: "password",
    id: options.id ?? nextId("secret"),
    autocomplete: "off",
    spellcheck: "false",
    autocapitalize: "off",
    autocorrect: "off",
    "data-1p-ignore": "true",
    "data-lpignore": "true",
    placeholder: options.placeholder ?? "Paste the key here",
    "aria-label": options.label ?? null,
  });
  return { wrap: h("div", { class: "secret-field" }, icon("key", { size: 16 }), input), input };
}

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
  /** CSS color for the selected icon (semantic tones, e.g. network risk). */
  tone?: string;
  title?: string;
}

/**
 * A radiogroup that looks like a segmented control, with a sliding thumb. Arrow
 * keys move, skipping options that are disabled (with the reason as their tooltip).
 */
export function segmented<T extends string>(
  options: SegmentOption<T>[],
  value: T,
  onChange: (value: T) => void,
  config: { label: string; block?: boolean; small?: boolean } = { label: "Options" },
): { el: HTMLElement; set(value: T): void; disable(value: T, disabled: boolean, reason?: string): void } {
  const thumb = h("span", { class: "thumb", "aria-hidden": "true" });
  let current = value;
  const buttons = options.map((option) =>
    h(
      "button",
      {
        type: "button",
        role: "radio",
        // Labels may be visually hidden on narrow screens; the accessible name never is.
        "aria-label": option.label,
        title: option.title ?? option.label,
        "data-value": option.value,
        style: option.tone ? `--seg-tone:${option.tone}` : null,
      },
      option.icon ? icon(option.icon, { size: 15 }) : null,
      h("span", { class: "seg-label" }, option.label),
    ),
  );
  const el = h("div", { class: cx("segmented", config.block && "block", config.small && "sm"), role: "radiogroup", "aria-label": config.label }, thumb, ...buttons);

  function position(): void {
    const active = buttons.find((b) => b.dataset.value === current);
    if (!active || !active.offsetWidth) return;
    thumb.style.width = `${active.offsetWidth}px`;
    thumb.style.transform = `translateX(${active.offsetLeft}px)`;
  }
  function set(next: T, notify = false): void {
    current = next;
    for (const b of buttons) {
      const on = b.dataset.value === next;
      b.setAttribute("aria-checked", String(on));
      b.tabIndex = on ? 0 : -1;
    }
    position();
    if (notify) onChange(next);
  }
  buttons.forEach((b, i) => {
    b.addEventListener("click", () => set(options[i]!.value, true));
    b.addEventListener("keydown", (event: KeyboardEvent) => {
      const delta = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
      if (!delta) return;
      event.preventDefault();
      let next = i;
      do next = (next + delta + buttons.length) % buttons.length;
      while (buttons[next]!.disabled && next !== i);
      if (next === i) return;
      set(options[next]!.value, true);
      buttons[next]!.focus();
    });
  });
  set(value);
  // Measure once laid out, and whenever the control resizes.
  new ResizeObserver(position).observe(el);
  return {
    el,
    set: (v: T) => set(v),
    disable(v: T, disabled: boolean, reason?: string) {
      const i = options.findIndex((o) => o.value === v);
      const b = buttons[i];
      if (!b) return;
      b.disabled = disabled;
      b.title = disabled && reason ? reason : (options[i]!.title ?? options[i]!.label);
    },
  };
}

export function switchControl(label: Child, checked: boolean, onChange: (checked: boolean) => void, options: { hint?: Child; disabled?: boolean } = {}): HTMLElement {
  const input = h("input", { type: "checkbox", role: "switch", checked, disabled: options.disabled ?? false });
  input.addEventListener("change", () => onChange(input.checked));
  return h(
    "label",
    { class: "switch" },
    input,
    h("span", { class: "track", "aria-hidden": "true" }),
    h("span", { class: "stack", style: "gap:0" }, h("span", { class: "small strong" }, label), options.hint ? h("span", { class: "tiny subtle" }, options.hint) : null),
  );
}

export function rangeControl(options: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format: (value: number) => string;
  onInput?: (value: number) => void;
  scale?: [string, string];
}): { el: HTMLElement; input: HTMLInputElement; value(): number } {
  const id = nextId("range");
  const input = h("input", { type: "range", id, min: options.min, max: options.max, step: options.step, value: options.value });
  const output = h("output", { for: id });
  const sync = () => {
    const v = Number(input.value);
    output.textContent = options.format(v);
    input.setAttribute("aria-valuetext", options.format(v));
    input.style.setProperty("--fill", `${((v - options.min) / (options.max - options.min || 1)) * 100}%`);
  };
  input.addEventListener("input", () => {
    sync();
    options.onInput?.(Number(input.value));
  });
  sync();
  return {
    el: h(
      "div",
      { class: "range" },
      h("div", { class: "range-top" }, h("label", { for: id, class: "label" }, options.label), output),
      input,
      options.scale ? h("div", { class: "scale", "aria-hidden": "true" }, h("span", {}, options.scale[0]), h("span", {}, options.scale[1])) : null,
    ),
    input,
    value: () => Number(input.value),
  };
}

/** Tags as chips: Enter or comma adds, Backspace on empty removes the last. */
export function chipInput(options: { id?: string; placeholder?: string; max?: number; validate?: (tag: string) => string | null }): {
  el: HTMLElement;
  values(): string[];
  clear(): void;
} {
  const tags: string[] = [];
  const input = h("input", { type: "text", id: options.id ?? nextId("chips"), autocomplete: "off", spellcheck: "false", placeholder: options.placeholder ?? "" });
  const el = h("div", { class: "chip-input" }, input);
  el.addEventListener("click", () => input.focus());
  const render = () => {
    for (const chip of [...el.querySelectorAll(".tag")]) chip.remove();
    tags.forEach((tag, i) => {
      el.insertBefore(
        h(
          "span",
          { class: "tag" },
          `#${tag}`,
          h(
            "button",
            {
              type: "button",
              "aria-label": `Remove tag ${tag}`,
              onclick: () => {
                tags.splice(i, 1);
                render();
                input.focus();
              },
            },
            icon("x", { size: 12 }),
          ),
        ),
        input,
      );
    });
  };
  const problemLine = h("div", { class: "error", role: "alert", hidden: true });
  const commit = () => {
    const raw = input.value.replace(/,/g, " ").trim().replace(/^#/, "");
    problemLine.hidden = true;
    if (!raw) return;
    for (const part of raw.split(/\s+/)) {
      const tag = part.slice(0, 64);
      if (!tag || tags.includes(tag) || tags.length >= (options.max ?? 32)) continue;
      const problem = options.validate?.(tag);
      if (problem) {
        problemLine.textContent = problem;
        problemLine.hidden = false;
        continue;
      }
      tags.push(tag);
    }
    input.value = "";
    render();
  };
  input.addEventListener("keydown", (event: KeyboardEvent) => {
    if ((event.key === "Enter" || event.key === ",") && input.value.trim()) {
      event.preventDefault();
      commit();
    } else if (event.key === "Backspace" && !input.value && tags.length) {
      tags.pop();
      render();
    }
  });
  input.addEventListener("blur", commit);
  return {
    el: h("div", { class: "stack tight" }, el, problemLine),
    values: () => {
      commit();
      return [...tags];
    },
    clear: () => {
      tags.length = 0;
      input.value = "";
      render();
    },
  };
}

/** A six-digit short authentication string ("023 811"), shown large and grouped 3+3. */
export function sasCode(code: string): HTMLElement {
  const digits = code.replace(/\s+/g, "").split("");
  return h("div", { class: "sas", role: "img", "aria-label": `Code ${digits.join(" ")}` }, ...digits.map((d) => h("span", { "aria-hidden": "true" }, d)));
}

export function statTile(options: { label: string; icon: IconName; value: Child; note?: Child; href?: string }): HTMLElement {
  const content = [
    h("div", { class: "stat-label" }, icon(options.icon, { size: 14 }), options.label),
    h("div", { class: "stat-value" }, options.value),
    options.note ? h("div", { class: "stat-note" }, options.note) : null,
  ];
  return options.href ? h("a", { class: "card stat", href: options.href }, ...content) : h("div", { class: "card stat" }, ...content);
}

export function meter(fraction: number, tone?: string, label?: string): HTMLElement {
  const clamped = Math.max(0, Math.min(1, fraction));
  return h(
    "div",
    { class: "meter", role: "meter", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": Math.round(clamped * 100), "aria-label": label ?? null },
    h("span", { style: `width:${(clamped * 100).toFixed(1)}%${tone ? `;--tone:${tone}` : ""}` }),
  );
}

export function section(title: string, options: { actions?: Child; count?: string; id?: string } = {}, ...children: Child[]): HTMLElement {
  const id = options.id ?? nextId("sec");
  return h(
    "section",
    { class: "section", "aria-labelledby": id },
    h("div", { class: "section-head" }, h("h2", { id }, title), options.count ? h("span", { class: "count-label tnum" }, options.count) : null, options.actions ? h("div", { class: "actions" }, options.actions) : null),
    ...children,
  );
}

export function pageHead(title: string, lede?: Child, actions?: Child): HTMLElement {
  return h(
    "header",
    { class: "page-head" },
    h("div", { class: "grow" }, h("h1", {}, title), lede ? h("p", { class: "lede" }, lede) : null),
    actions ? h("div", { class: "actions" }, actions) : null,
  );
}
