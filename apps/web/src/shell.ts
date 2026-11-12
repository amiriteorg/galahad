import type { ActionView, PairingView } from "@galahad/core";
import { type Api, setNetworkHandler } from "./api.ts";
import type { Ctx, NavigateOptions, Route, View } from "./context.ts";
import type { BrowserIdentity } from "./identity.ts";
import { startLive } from "./live.ts";
import { shortId } from "./lib/text.ts";
import { lastRoute, rememberRoute, setMotion, setSidebarCollapsed, setTheme, sidebarCollapsed } from "./prefs.ts";
import type { AnyScope, WhoAmI } from "./types.ts";
import { button, count, dot, kbd, retryFailed } from "./ui/controls.ts";
import { openSheet } from "./ui/dialog.ts";
import { cx, h, isMac, isTyping, replace, Scope } from "./ui/dom.ts";
import { emblem } from "./ui/emblem.ts";
import { icon, type IconName } from "./ui/icons.ts";
import { type Command, isPaletteOpen, openPalette } from "./ui/palette.ts";
import { toast } from "./ui/toast.ts";
import { activityView } from "./views/activity.ts";
import { artifactsView } from "./views/artifacts.ts";
import { archiveView, openNewIdea } from "./views/archive.ts";
import { bankView } from "./views/bank.ts";
import { projectsView } from "./views/projects.ts";
import { worldView } from "./views/world.ts";
import { boardView } from "./views/board.ts";
import { chatActivityPill, chatsForPalette, chatView, startNewChat } from "./views/chat.ts";
import { filterConversations } from "./lib/chats.ts";
import { keyboardOpen } from "./lib/viewport.ts";
import { conversationFromHash } from "@galahad/core/notify-payload";
import { readOpenMessage } from "./lib/push.ts";
import { syncPush } from "./views/notifications.ts";
import { connectorsView } from "./views/connectors.ts";
import { findingsView } from "./views/findings.ts";
import { fleetView, openInvite } from "./views/fleet.ts";
import { inboxView } from "./views/inbox.ts";
import { journalView } from "./views/journal.ts";
import { loopsView, openLoopSheet } from "./views/loops.ts";
import { memoryView, openRemember } from "./views/memory.ts";
import { skillsView } from "./views/skills.ts";
import { modelsView } from "./views/models.ts";
import { overviewView } from "./views/overview.ts";
import { openCreateSandbox, sandboxesView } from "./views/sandboxes.ts";
import { forgetThisBrowser, settingsView } from "./views/settings.ts";
import { trialsView } from "./views/trials.ts";
import { openAddKey, vaultView } from "./views/vault.ts";

interface RouteSpec {
  id: Route;
  label: string;
  icon: IconName;
  group: "main" | "mind" | "bodies" | "keys";
  scope: AnyScope | null;
  /** Also listed (read-only) for devices holding this scope. */
  alsoFor?: AnyScope;
  key: string;
  keywords: string[];
  view: View;
}

const ROUTES: RouteSpec[] = [
  { id: "overview", label: "Overview", icon: "overview", group: "main", scope: null, key: "o", keywords: ["home", "dashboard", "health"], view: overviewView },
  { id: "inbox", label: "Inbox", icon: "inbox", group: "main", scope: null, key: "i", keywords: ["approvals", "pairing", "requests", "actions", "notices", "oath"], view: inboxView },
  { id: "chat", label: "Chat", icon: "chat", group: "main", scope: "chat", key: "c", keywords: ["counsel", "ask", "talk", "history", "conversations"], view: chatView },
  { id: "world", label: "SANDBOX", icon: "landscape", group: "main", scope: "mind:read", key: "x", keywords: ["sandbox", "world", "3d", "experiments", "simulation", "galahad", "playground"], view: worldView },
  { id: "board", label: "Chalkboard", icon: "board", group: "main", scope: "mind:read", key: "d", keywords: ["whiteboard", "chalk", "draw", "sketch", "board", "notes", "equations", "charts"], view: boardView },
  { id: "projects", label: "Projects", icon: "folder", group: "main", scope: "mind:read", key: "p", keywords: ["workspaces", "instructions", "repositories", "folders"], view: projectsView },
  { id: "journal", label: "Journal", icon: "journal", group: "mind", scope: "mind:read", key: "j", keywords: ["diary", "day", "recollection", "reflection", "evening", "dog", "learned", "log"], view: journalView },
  { id: "memory", label: "Memory", icon: "memory", group: "mind", scope: "mind:read", key: "m", keywords: ["remember", "recall", "mind"], view: memoryView },
  { id: "skills", label: "Skills", icon: "scroll", group: "mind", scope: "mind:read", key: "u", keywords: ["learn", "learned", "how", "notes", "playbook", "procedures", "know-how", "approve", "proposed", "library"], view: skillsView },
  { id: "activity", label: "Activity", icon: "activity", group: "mind", scope: "mind:read", key: "a", keywords: ["ledger", "log", "audit", "history"], view: activityView },
  { id: "loops", label: "Loops", icon: "repeat", group: "mind", scope: "mind:read", key: "r", keywords: ["schedule", "cron", "heartbeat", "routine", "recurring"], view: loopsView },
  { id: "artifacts", label: "Artifacts", icon: "archive", group: "mind", scope: "mind:read", key: "w", keywords: ["work", "results", "files", "outputs", "kept", "reports", "plots"], view: artifactsView },
  { id: "archive", label: "Archive", icon: "library", group: "mind", scope: "mind:read", key: "k", keywords: ["kept", "forever", "ideas", "lessons", "experiments", "models", "teachings", "semantic", "search", "vector", "history"], view: archiveView },
  { id: "findings", label: "Findings", icon: "flask", group: "mind", scope: "mind:read", key: "e", keywords: ["investigations", "experiments", "hypotheses", "science", "conclusions", "predictions"], view: findingsView },
  { id: "trials", label: "Trials", icon: "gauge", group: "mind", scope: "mind:read", key: "t", keywords: ["benchmarks", "evals", "galahad index", "score", "tests", "progress"], view: trialsView },
  { id: "fleet", label: "Fleet", icon: "fleet", group: "bodies", scope: "mind:read", key: "f", keywords: ["devices", "nodes", "machines"], view: fleetView },
  // Owner devices see Sandboxes even before they hold the new scope, so the feature can be found;
  // the page explains what's missing instead of offering actions that would be refused.
  { id: "sandboxes", label: "Sandboxes", icon: "sandbox", group: "bodies", scope: "sandbox", alsoFor: "fleet:admin", key: "s", keywords: ["containers", "vm", "console"], view: sandboxesView },
  { id: "vault", label: "Vault", icon: "vault", group: "keys", scope: "vault:read", key: "v", keywords: ["keys", "secrets", "api key"], view: vaultView },
  { id: "models", label: "Models", icon: "models", group: "keys", scope: "mind:read", key: "l", keywords: ["providers", "roster", "llm"], view: modelsView },
  { id: "bank", label: "Bank", icon: "bank", group: "keys", scope: "bank:read", key: "b", keywords: ["lunar", "accounts", "balances", "transactions", "enable banking", "money", "finance"], view: bankView },
  { id: "connectors", label: "Connectors", icon: "plug", group: "keys", scope: "mind:read", key: "n", keywords: ["github", "cloudflare", "home assistant", "integrations", "services", "tools"], view: connectorsView },
  { id: "settings", label: "Settings", icon: "settings", group: "keys", scope: null, key: ",", keywords: ["preferences", "theme", "device"], view: settingsView },
];

const GROUP_LABEL: Record<RouteSpec["group"], string | null> = { main: null, mind: "Mind", bodies: "Bodies", keys: "Keys & models" };
const MOBILE_PRIMARY: Route[] = ["overview", "chat", "inbox", "fleet", "activity", "memory"];

export interface ShellBase {
  api: Api;
  identity: BrowserIdentity;
  whoami: WhoAmI;
}

export function renderShell(root: HTMLElement, base: ShellBase): { dispose(): void } {
  const lifetime = new AbortController();
  const scopes = new Set<AnyScope>(base.whoami.scopes);
  const can = (scope: AnyScope) => scopes.has(scope);
  const visible = ROUTES.filter((r) => r.scope === null || can(r.scope) || (r.alsoFor && can(r.alsoFor)));
  const mobileTabs = MOBILE_PRIMARY.filter((id) => visible.some((r) => r.id === id)).slice(0, 4);

  let current: Route | null = null;
  let viewScope: Scope | null = null;
  let pending: { route: Route; opts: NavigateOptions } | null = null;
  let titleObserver: IntersectionObserver | null = null;

  const live = startLive(base.api, can, {
    onNewPairing(pairing: PairingView) {
      if (current === "inbox") return;
      toast(`${pairing.name} asks to join`, {
        description: "Compare the six-digit code before you approve.",
        action: { label: "Review", run: () => ctx.navigate("inbox") },
        duration: 12_000,
      });
    },
    onNewAction(action: ActionView) {
      if (current === "inbox") return;
      toast(action.class === "delete" ? "Galahad asks to delete something" : "Galahad asks your leave", {
        description: `${action.connector}.${action.tool}: ${action.target}`,
        action: { label: "Review", run: () => ctx.navigate("inbox") },
        duration: 12_000,
      });
    },
  });
  setNetworkHandler((ok) => live.online.set(ok));

  const ctx: Ctx = {
    ...base,
    can,
    live,
    navigate(route, opts = {}) {
      const target = visible.find((r) => r.id === route) ? route : "overview";
      pending = { route: target, opts };
      if (location.hash === `#/${target}`) render();
      else location.hash = `#/${target}`;
    },
    palette: (query) => {
      // Your chats and projects, so the palette can find them by name.
      chatsForPalette(base.api, { chat: can("chat"), read: can("mind:read") });
      openPalette(paletteSource, query);
    },
  };

  // ---------- layout ----------
  const main = h("main", { class: "view", id: "main", tabindex: -1 });
  const banner = h("div", { class: "banner", role: "status", hidden: true });
  const topTitle = h("span", { class: "title" });
  const navLinks = new Map<Route, HTMLAnchorElement[]>();

  const link = (spec: RouteSpec, className: string, content: (HTMLElement | SVGElement | string | null)[]): HTMLAnchorElement => {
    const a = h("a", { class: className, href: `#/${spec.id}`, title: className === "nav-item" ? `${spec.label}  (G then ${spec.key.toUpperCase()})` : null }, ...content);
    navLinks.set(spec.id, [...(navLinks.get(spec.id) ?? []), a]);
    return a;
  };

  const inboxBadges: HTMLElement[] = [];
  const inboxBadge = () => {
    const el = h("span", { class: "count", hidden: true });
    inboxBadges.push(el);
    return el;
  };

  // Sidebar (desktop)
  const navChildren: HTMLElement[] = [];
  let lastGroup: RouteSpec["group"] | null = null;
  for (const spec of visible.filter((r) => r.id !== "settings")) {
    if (spec.group !== lastGroup) {
      const label = GROUP_LABEL[spec.group];
      if (label) navChildren.push(h("div", { class: "nav-sep", "aria-hidden": "true" }), h("div", { class: "nav-label" }, label));
      lastGroup = spec.group;
    }
    navChildren.push(link(spec, "nav-item", [icon(spec.icon), h("span", { class: "label" }, spec.label), spec.id === "inbox" ? inboxBadge() : null]));
  }
  const settingsSpec = ROUTES.find((r) => r.id === "settings")!;
  const collapse = button(sidebarCollapsed() ? "Expand sidebar" : "Collapse sidebar", {
    variant: "ghost",
    size: "sm",
    iconOnly: true,
    icon: "sidebar",
    onClick: () => toggleSidebar(),
  });
  const deviceChip = h(
    "a",
    { class: "device-chip", href: "#/settings", title: "This device" },
    h("span", { class: "avatar" }, icon(base.identity.name.includes("iPhone") || base.identity.name.includes("Android") ? "phone" : "laptop", { size: 16 })),
    h("span", { class: "device-meta" }, h("div", { class: "name ellipsis" }, base.identity.name), h("div", { class: "id mono subtle" }, shortId(base.identity.device))),
  );
  const sidebar = h(
    "aside",
    { class: "sidebar", "aria-label": "Sidebar" },
    h("div", { class: "sidebar-head" }, h("a", { class: "wordmark grow", href: "#/overview", "aria-label": "Galahad, overview" }, emblem({ size: 22 }), h("span", {}, "Galahad")), collapse),
    h(
      "button",
      { class: "search-trigger", type: "button", onclick: () => ctx.palette(), "aria-label": "Search and commands" },
      icon("search", { size: 15 }),
      h("span", { class: "label" }, "Search…"),
      h("span", { class: "kbds" }, ...kbd(isMac() ? "⌘" : "Ctrl", "K")),
    ),
    h("nav", { class: "nav", "aria-label": "Sections" }, ...navChildren),
    h("div", { class: "sidebar-foot" }, link(settingsSpec, "nav-item", [icon("settings"), h("span", { class: "label" }, "Settings")]), deviceChip),
  );

  // Top bar
  const fleetPill = h("a", { class: "fleet-pill", href: "#/fleet", hidden: !can("mind:read") });
  const topbar = h(
    "header",
    { class: "topbar" },
    h("a", { class: "brand-mini", href: "#/overview", "aria-label": "Galahad, overview" }, emblem({ size: 24 })),
    topTitle,
    h(
      "div",
      { class: "actions" },
      chatActivityPill(),
      fleetPill,
      button("Search", { variant: "ghost", iconOnly: true, icon: "search", onClick: () => ctx.palette(), label: `Search and commands (${isMac() ? "⌘" : "Ctrl"}+K)` }),
    ),
  );

  // Tab bar (phones)
  const moreTab = h("button", { class: "tab", type: "button", "aria-haspopup": "dialog" }, icon("more"), h("span", {}, "More"));
  const tabbar = h(
    "nav",
    { class: "tabbar", "aria-label": "Sections" },
    ...mobileTabs.map((id) => {
      const spec = visible.find((r) => r.id === id)!;
      return link(spec, "tab", [icon(spec.icon), h("span", {}, spec.id === "overview" ? "Home" : spec.label), spec.id === "inbox" ? inboxBadge() : null]);
    }),
    moreTab,
  );
  moreTab.addEventListener("click", () => openMore());

  const shell = h("div", { class: "shell" }, sidebar, h("div", { class: "main-col" }, topbar, banner, main), tabbar);
  replace(root, shell);

  // ---------- the on-screen keyboard ----------
  // iOS keeps the page full height under its keyboard: while you type, the tab bar steps aside so
  // the chat composer (or whatever you're typing in) sits right above the keyboard, not behind it.
  const viewport = window.visualViewport;
  if (viewport) {
    let fullHeight = window.innerHeight;
    const syncKeyboard = () => {
      fullHeight = Math.max(fullHeight, window.innerHeight);
      const open = keyboardOpen({ coarse: matchMedia("(pointer: coarse)").matches, typing: isTyping(document.activeElement), fullHeight, visibleHeight: viewport.height });
      if (open) document.documentElement.dataset.keyboard = "open";
      else delete document.documentElement.dataset.keyboard;
    };
    viewport.addEventListener("resize", syncKeyboard, { signal: lifetime.signal });
    document.addEventListener("focusin", syncKeyboard, { signal: lifetime.signal });
    document.addEventListener("focusout", () => setTimeout(syncKeyboard, 50), { signal: lifetime.signal });
    window.addEventListener("orientationchange", () => (fullHeight = 0), { signal: lifetime.signal });
    lifetime.signal.addEventListener("abort", () => delete document.documentElement.dataset.keyboard);
  }

  // ---------- live chrome ----------
  live.inboxCount.watch((n) => {
    for (const el of inboxBadges) {
      el.hidden = n === 0;
      el.textContent = n > 99 ? "99+" : String(n);
      el.setAttribute("aria-label", `${n} waiting`);
    }
    document.title = document.title.replace(/^\(\d+\+?\) /, "");
    if (n) document.title = `(${n}) ${document.title}`;
  });
  live.fleet.watch((fleet) => {
    if (!fleet) {
      replace(fleetPill, dot(null), h("span", {}, base.whoami.fleetName ?? "fleet"));
      return;
    }
    const nodes = fleet.devices.filter((d) => d.kind === "node" && !d.revokedAt);
    const onlineCount = nodes.filter((d) => d.id === fleet.self || fleet.peers.find((p) => p.device === d.id)?.online).length;
    const tone = onlineCount === nodes.length ? "ok" : onlineCount === 0 ? "danger" : "warn";
    replace(fleetPill, dot(tone, { live: true }), h("span", { class: "tnum" }, `${fleet.name || base.whoami.fleetName || "fleet"} · ${onlineCount}/${nodes.length} online`));
    fleetPill.setAttribute("aria-label", `Fleet ${fleet.name}: ${onlineCount} of ${nodes.length} nodes online`);
  });
  live.online.subscribe((ok) => {
    banner.hidden = ok;
    if (!ok) {
      replace(
        banner,
        icon("offline", { size: 16 }),
        h("span", { class: "grow" }, navigator.onLine ? "Can't reach Galahad right now. What you see may be out of date." : "You're offline. The app is cached; live data returns when you reconnect."),
        button("Retry", { size: "sm", onClick: () => void live.refreshFleet() }),
      );
    } else {
      // Whatever failed while the node was away is asked again, so the page heals by itself.
      retryFailed(main);
      toast("Reconnected", { tone: "ok", duration: 2000 });
    }
  });

  function toggleSidebar(): void {
    const next = !sidebarCollapsed();
    setSidebarCollapsed(next);
    collapse.setAttribute("aria-label", next ? "Expand sidebar" : "Collapse sidebar");
    collapse.title = next ? "Expand sidebar" : "Collapse sidebar";
  }

  // ---------- routing ----------
  function routeFromHash(): Route | null {
    const id = location.hash.match(/^#\/([a-z]+)/)?.[1];
    return visible.find((r) => r.id === id)?.id ?? null;
  }

  function render(): void {
    const route = routeFromHash() ?? "overview";
    const spec = visible.find((r) => r.id === route)!;
    const opts = pending?.route === route ? pending.opts : {};
    pending = null;
    viewScope?.dispose();
    viewScope = new Scope();
    const changed = current !== route;
    current = route;
    shell.dataset.route = route;
    rememberRoute(route);
    for (const [id, els] of navLinks) for (const el of els) id === route ? el.setAttribute("aria-current", "page") : el.removeAttribute("aria-current");
    if (mobileTabs.includes(route)) moreTab.removeAttribute("aria-current");
    else moreTab.setAttribute("aria-current", "page");
    topTitle.textContent = spec.label;
    const n = live.inboxCount.value;
    document.title = `${n ? `(${n}) ` : ""}${spec.label} · Galahad`;
    replace(main);
    spec.view(main, ctx, { scope: viewScope, opts });
    // The top bar names the page only once the page's own heading has scrolled away.
    titleObserver?.disconnect();
    const heading = main.querySelector<HTMLElement>(".page-head h1");
    topTitle.classList.toggle("tucked", Boolean(heading));
    if (heading) {
      titleObserver = new IntersectionObserver(([entry]) => topTitle.classList.toggle("tucked", Boolean(entry?.isIntersecting)), { rootMargin: "-60px 0px 0px 0px" });
      titleObserver.observe(heading);
    }
    if (changed) {
      window.scrollTo({ top: 0 });
      if (document.activeElement === document.body || document.activeElement?.closest(".sidebar, .tabbar")) main.focus({ preventScroll: true });
    }
  }

  // A notification named a kept chat in the address ("#/chat?c=…"): that's the chat to show.
  const chatFromAddress = (): void => {
    const conversation = conversationFromHash(location.hash);
    if (conversation) pending = { route: "chat", opts: { conversation } };
  };
  window.addEventListener("hashchange", chatFromAddress, { signal: lifetime.signal });
  window.addEventListener("hashchange", render, { signal: lifetime.signal });
  // A notification tapped while the app is open: the service worker says where to go. And when the browser
  // replaces this device's push subscription, the node is handed the new one.
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener(
      "message",
      (event: MessageEvent) => {
        const open = readOpenMessage(event.data);
        if (open) ctx.navigate(open.route, open.conversation ? { conversation: open.conversation } : {});
        else if ((event.data as { type?: string } | null)?.type === "galahad:push-changed") void syncPush(base.api);
      },
      { signal: lifetime.signal },
    );
  }

  // ---------- More sheet (phones) ----------
  function openMore(): void {
    const items = visible.filter((r) => !mobileTabs.includes(r.id));
    const sheet = openSheet({
      title: "More",
      body: h(
        "nav",
        { class: "stack tight", "aria-label": "More sections" },
        ...items.map((spec) =>
          h(
            "a",
            { class: cx("nav-item"), href: `#/${spec.id}`, style: "height:48px", "aria-current": spec.id === current ? "page" : null, onclick: () => sheet.close() },
            icon(spec.icon),
            h("span", {}, spec.label),
            spec.id === "inbox" && live.inboxCount.value ? count(live.inboxCount.value) : null,
          ),
        ),
        h("hr", { class: "divider" }),
        h(
          "button",
          {
            class: "nav-item",
            type: "button",
            style: "height:48px;border:0;background:none;width:100%",
            onclick: () => {
              sheet.close();
              setTimeout(() => ctx.palette(), 50);
            },
          },
          icon("search"),
          h("span", {}, "Search and commands"),
        ),
      ),
    });
  }

  // ---------- command palette ----------
  const paletteSource = {
    commands(): Command[] {
      const go: Command[] = visible.map((spec) => ({
        id: `go:${spec.id}`,
        label: spec.label,
        group: "Go to",
        icon: spec.icon,
        keywords: spec.keywords,
        hint: `G ${spec.key.toUpperCase()}`,
        run: () => ctx.navigate(spec.id),
      }));
      const actions: Command[] = [];
      if (can("chat")) actions.push({ id: "new-chat", label: "New chat", group: "Actions", icon: "chat", keywords: ["clear", "conversation"], run: () => (startNewChat(), ctx.navigate("chat")) });
      if (can("vault:write")) actions.push({ id: "add-key", label: "Add a key to the vault", group: "Actions", icon: "key", keywords: ["api key", "secret", "seal"], run: () => openAddKey(ctx) });
      if (can("fleet:admin")) {
        actions.push({ id: "invite-client", label: "Pair a phone or browser", group: "Actions", icon: "phone", keywords: ["invite", "device", "add"], run: () => openInvite(ctx, "client") });
        actions.push({ id: "invite-node", label: "Add a machine to the fleet", group: "Actions", icon: "server", keywords: ["invite", "node", "join"], run: () => openInvite(ctx, "node") });
      }
      if (can("mind:read")) actions.push({ id: "search-memory", label: "Search memory", group: "Actions", icon: "search", keywords: ["recall", "find"], run: () => ctx.navigate("memory") });
      if (can("mind:write")) actions.push({ id: "remember", label: "Remember something", group: "Actions", icon: "memory", keywords: ["note", "add memory"], run: () => openRemember(ctx) });
      if (can("mind:write")) actions.push({ id: "new-idea", label: "New idea", group: "Actions", icon: "lightbulb", keywords: ["archive", "note", "keep", "thought"], run: () => openNewIdea(ctx) });
      if (can("sandbox")) actions.push({ id: "create-sandbox", label: "Create a sandbox", group: "Actions", icon: "sandbox", keywords: ["container", "vm", "new"], run: () => openCreateSandbox(ctx) });
      if (can("mind:read")) actions.push({ id: "place", label: "Where would this run?", group: "Actions", icon: "compass", keywords: ["placement", "playground", "schedule"], run: () => ctx.navigate("fleet", { intent: "place" }) });
      if (can("brain:write")) actions.push({ id: "add-loop", label: "Add a loop", group: "Actions", icon: "repeat", keywords: ["schedule", "cron", "every", "routine"], run: () => openLoopSheet(ctx) });
      if (can("mind:read")) actions.push({ id: "heartbeat", label: "Run the heartbeat's checks now", group: "Actions", icon: "review", keywords: ["health", "check", "notices"], run: () => ctx.navigate("loops", { intent: "check" }) });
      if (can("brain:write")) actions.push({ id: "add-connector", label: "Install a connector", group: "Actions", icon: "plug", keywords: ["github", "cloudflare", "home assistant", "integration"], run: () => ctx.navigate("connectors") });
      const appearance: Command[] = [
        { id: "theme-system", label: "Theme: match system", group: "Appearance", icon: "monitor", keywords: ["auto"], run: () => setTheme("system") },
        { id: "theme-light", label: "Theme: light", group: "Appearance", icon: "sun", run: () => setTheme("light") },
        { id: "theme-dark", label: "Theme: dark", group: "Appearance", icon: "moon", run: () => setTheme("dark") },
        { id: "motion-reduce", label: "Reduce motion", group: "Appearance", icon: "zap", keywords: ["animation", "accessibility"], run: () => setMotion("reduce") },
        { id: "motion-system", label: "Motion: match system", group: "Appearance", icon: "zap", keywords: ["animation"], run: () => setMotion("system") },
        { id: "sidebar", label: "Toggle sidebar", group: "Appearance", icon: "sidebar", hint: "[", run: toggleSidebar },
      ];
      const device: Command[] = [
        { id: "shortcuts", label: "Keyboard shortcuts", group: "Help", icon: "command", hint: "?", run: openShortcuts },
        { id: "forget", label: "Forget this browser…", group: "Help", icon: "logout", keywords: ["sign out", "unpair", "remove key"], run: () => void forgetThisBrowser() },
      ];
      return [...go, ...actions, ...appearance, ...device];
    },
    dynamic(query: string): Command[] {
      const out: Command[] = [];
      const { chats, projects } = chatsForPalette(base.api, { chat: can("chat"), read: can("mind:read") });
      const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? id;
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      for (const p of projects.filter((p) => words.every((w) => `${p.name} ${p.id}`.toLowerCase().includes(w))).slice(0, 3)) {
        out.push({ id: `project:${p.id}`, label: p.name, group: "Projects", icon: "folder", run: () => ctx.navigate("projects", { project: p.id }) });
      }
      for (const c of filterConversations(chats, query, projectName).slice(0, 5)) {
        out.push({ id: `chat:${c.id}`, label: c.title, group: "Chats", icon: c.pinned ? "pin" : "chat", hint: c.project ? projectName(c.project) : undefined, run: () => ctx.navigate("chat", { conversation: c.id }) });
      }
      if (can("mind:read")) out.push({ id: "q-memory", label: `Search memory for “${query}”`, group: "Search", icon: "memory", run: () => ctx.navigate("memory", { query }) });
      if (can("chat")) out.push({ id: "q-chat", label: `Ask Galahad: “${query}”`, group: "Search", icon: "mark", run: () => ctx.navigate("chat", { query }) });
      return out;
    },
  };

  function openShortcuts(): void {
    const mod = isMac() ? "⌘" : "Ctrl";
    const row = (label: string, ...keys: string[]) => [h("span", {}, label), h("span", { class: "keys" }, ...kbd(...keys))];
    openSheet({
      title: "Keyboard shortcuts",
      size: "small",
      body: h(
        "div",
        { class: "help-list" },
        ...row("Search and commands", mod, "K"),
        ...row("Show shortcuts", "?"),
        ...row("Toggle sidebar", "["),
        ...visible.flatMap((spec) => row(`Go to ${spec.label}`, "G", spec.key.toUpperCase())),
        ...row("Send message", "Enter"),
        ...row("New line in a message", "Shift", "Enter"),
        ...row("Stop Galahad answering", "Esc"),
      ),
    });
  }

  // ---------- keyboard ----------
  let gPressed = 0;
  document.addEventListener("keydown", onKey, { signal: lifetime.signal });
  function onKey(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k") {
      event.preventDefault();
      ctx.palette();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target) || isPaletteOpen() || document.querySelector("dialog[open]")) return;
    if (event.key === "?") {
      event.preventDefault();
      openShortcuts();
    } else if (event.key === "[") {
      toggleSidebar();
    } else if (event.key === "/") {
      event.preventDefault();
      ctx.palette();
    } else if (event.key.toLowerCase() === "g") {
      gPressed = Date.now();
    } else if (Date.now() - gPressed < 1200) {
      const spec = visible.find((r) => r.key === event.key.toLowerCase());
      gPressed = 0;
      if (spec) {
        event.preventDefault();
        ctx.navigate(spec.id);
      }
    }
  }

  // ---------- go ----------
  chatFromAddress();
  const initial = routeFromHash() ?? (visible.find((r) => r.id === lastRoute())?.id ?? "overview");
  if (location.hash !== `#/${initial}`) history.replaceState(null, "", `#/${initial}`);
  render();
  return {
    dispose() {
      lifetime.abort();
      viewScope?.dispose();
      titleObserver?.disconnect();
      live.stop();
    },
  };
}
