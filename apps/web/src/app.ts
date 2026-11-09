import type { Scope } from "@galahad/core";
import { ApiError, apiFor, setUnauthorizedHandler } from "./api.ts";
import { type Ctx, errorMessage, type NavigateOptions, type Tab, type View, type WhoAmI } from "./context.ts";
import { h, notice, replace } from "./dom.ts";
import { createIdentity, loadIdentity } from "./identity.ts";
import { renderInsecure, renderPairing, renderRevoked, renderWelcome } from "./pair.ts";
import { chatView } from "./views/chat.ts";
import { fleetView } from "./views/fleet.ts";
import { memoryView } from "./views/memory.ts";
import { modelsView } from "./views/models.ts";
import { vaultView } from "./views/vault.ts";

interface TabSpec {
  id: Tab;
  label: string;
  glyph: string;
  scope: Scope;
  view: View;
}

const TABS: TabSpec[] = [
  { id: "chat", label: "Chat", glyph: "💬", scope: "chat", view: chatView },
  { id: "memory", label: "Memory", glyph: "🧠", scope: "mind:read", view: memoryView },
  { id: "vault", label: "Vault", glyph: "🔐", scope: "vault:read", view: vaultView },
  { id: "models", label: "Models", glyph: "⚙️", scope: "mind:read", view: modelsView },
  { id: "fleet", label: "Fleet", glyph: "🛡️", scope: "mind:read", view: fleetView },
];

const LAST_TAB = "galahad:last-tab";

function rememberTab(tab: Tab): void {
  try {
    localStorage.setItem(LAST_TAB, tab);
  } catch {
    /* storage unavailable; harmless */
  }
}

function lastTab(): Tab | null {
  try {
    return localStorage.getItem(LAST_TAB) as Tab | null;
  } catch {
    return null;
  }
}

function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator) || !isSecureContext) return;
  navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
    /* offline shell is a convenience, not a requirement */
  });
}

function renderShell(root: HTMLElement, base: Omit<Ctx, "navigate">): void {
  const visible = TABS.filter((tab) => base.can(tab.scope));
  const main = h("main", { id: "main", tabindex: -1 });
  const nav = h("nav", { class: "tabs", "aria-label": "Sections" });
  let dispose: (() => void) | void;
  let current: Tab | null = null;

  const ctx: Ctx = {
    ...base,
    navigate(tab: Tab, opts: NavigateOptions = {}) {
      const spec = visible.find((t) => t.id === tab) ?? visible[0];
      if (!spec) return;
      if (typeof dispose === "function") dispose();
      current = spec.id;
      rememberTab(spec.id);
      for (const button of nav.querySelectorAll("button")) {
        if (button.dataset.tab === spec.id) button.setAttribute("aria-current", "page");
        else button.removeAttribute("aria-current");
      }
      replace(main);
      dispose = spec.view(main, ctx, opts);
      main.focus({ preventScroll: true });
      window.scrollTo({ top: 0 });
    },
  };

  for (const tab of visible) {
    nav.appendChild(
      h(
        "button",
        { type: "button", "data-tab": tab.id, onclick: () => tab.id !== current && ctx.navigate(tab.id) },
        h("span", { class: "glyph", "aria-hidden": "true" }, tab.glyph),
        h("span", {}, tab.label),
      ),
    );
  }

  const meta = [base.whoami.fleetName ? `fleet ${base.whoami.fleetName}` : null, `via ${base.whoami.nodeName}`].filter(Boolean).join(" · ");
  replace(
    root,
    h(
      "div",
      { class: "shell" },
      nav,
      h(
        "div",
        { class: "content" },
        h("header", { class: "topbar" }, h("div", { class: "brand" }, h("img", { src: "/icon.svg", alt: "" }), "Galahad"), h("div", { class: "meta" }, meta)),
        main,
      ),
    ),
  );

  if (!visible.length) {
    replace(main, notice("This device was paired without any scopes that have a view here.", "warn"));
    return;
  }
  const preferred = lastTab();
  ctx.navigate(visible.some((t) => t.id === preferred) ? (preferred as Tab) : visible[0]!.id);
}

async function boot(): Promise<void> {
  const root = document.getElementById("app")!;
  if (!isSecureContext || !crypto?.subtle) {
    renderInsecure(root);
    return;
  }
  registerServiceWorker();

  let identity = await loadIdentity();
  const inviteText = location.hash.match(/[#&]pair=([A-Za-z0-9._-]+)/)?.[1];
  if (inviteText) {
    if (identity?.enrolled) {
      history.replaceState(null, "", `${location.pathname}${location.search}`);
    } else {
      identity ??= await createIdentity();
      renderPairing(root, identity, inviteText, () => void boot());
      return;
    }
  }
  if (!identity?.enrolled) {
    renderWelcome(root, identity);
    return;
  }

  const api = apiFor(identity);
  setUnauthorizedHandler(() => renderRevoked(root));
  let whoami: WhoAmI;
  try {
    whoami = await api.get<WhoAmI>("/api/whoami");
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return; // handler already rendered the re-pair screen
    replace(
      root,
      h(
        "div",
        { class: "center" },
        h(
          "div",
          { class: "card stack" },
          h("h1", {}, "Galahad can't be reached just now."),
          notice(errorMessage(error), "error"),
          h("button", { class: "btn primary", type: "button", onclick: () => void boot() }, "Try again"),
        ),
      ),
    );
    return;
  }
  const scopes = new Set<Scope>(whoami.scopes);
  renderShell(root, { api, identity, whoami, can: (scope) => scopes.has(scope) });
}

void boot();
