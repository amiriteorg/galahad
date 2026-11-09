/*
 * Tiny DOM helpers. Everything is built with createElement + textContent:
 * model output, memories and device names are never parsed as HTML.
 */

type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | null | undefined | ((event: any) => void)>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === "class") {
      el.className = String(value);
    } else if (key === "value" && "value" in el) {
      (el as HTMLInputElement).value = String(value);
    } else if (value === true) {
      el.setAttribute(key, "");
    } else {
      el.setAttribute(key, String(value));
    }
  }
  append(el, ...children);
  return el;
}

export function append(parent: Node, ...children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === "string" || typeof child === "number" ? document.createTextNode(String(child)) : child);
  }
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function replace(node: Element, ...children: Child[]): void {
  clear(node);
  append(node, ...children);
}

/** Plain text with ```fenced code``` rendered as <pre>. XSS-safe by construction. */
export function richText(text: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const parts = text.split(/```/);
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      const newline = part.indexOf("\n");
      const code = newline >= 0 && /^[\w+-]*$/.test(part.slice(0, newline).trim()) ? part.slice(newline + 1) : part;
      fragment.appendChild(h("pre", {}, h("code", {}, code.replace(/\n$/, ""))));
    } else if (part) {
      fragment.appendChild(document.createTextNode(part));
    }
  });
  return fragment;
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export function toast(message: string, kind: "info" | "error" = "info"): void {
  document.querySelector(".toast")?.remove();
  const el = h("div", { class: `toast${kind === "error" ? " error" : ""}`, role: "status", "aria-live": "polite" }, message);
  document.body.appendChild(el);
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 4000);
}

export function notice(message: string | Node, kind: "info" | "error" | "warn" | "ok" = "info"): HTMLElement {
  return h("div", { class: `notice${kind === "info" ? "" : ` ${kind}`}`, role: kind === "error" ? "alert" : "status" }, message);
}

export function badge(text: string, kind: "" | "ok" | "warn" | "danger" | "accent" = ""): HTMLElement {
  return h("span", { class: `badge${kind ? ` ${kind}` : ""}` }, text);
}

export async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied.");
  } catch {
    toast("Couldn't copy automatically; please select and copy it.", "error");
  }
}

export function copyBox(text: string): HTMLElement {
  return h("div", { class: "copybox" }, h("code", {}, text), h("button", { class: "btn small", type: "button", onclick: () => copy(text) }, "Copy"));
}

/** Hybrid logical clock string → human time. */
export function hlcDate(hlc: string): string {
  const ms = Number(hlc.slice(0, 15));
  if (!Number.isFinite(ms) || ms <= 0) return "";
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export const short = (id: string, n = 8): string => (id.length > n + 2 ? `${id.slice(2, 2 + n)}…` : id);
