import type { ActionView, PairingView } from "@galahad/core";
import { type Api, setNetworkHandler } from "./api.ts";
import type { Ctx, NavigateOptions, Route, View } from "./context.ts";
import type { BrowserIdentity } from "./identity.ts";
import { startLive } from "./live.ts";
import { shortId } from "./lib/text.ts";
import { setMotion, setSidebarCollapsed, setTheme, sidebarCollapsed } from "./prefs.ts";
import type { AnyScope, WhoAmI } from "./types.ts";
import { button, dot, kbd, retryFailed } from "./ui/controls.ts";
import { openSheet } from "./ui/dialog.ts";
import { h, isMac, isTyping, replace, Scope } from "./ui/dom.ts";
import { emblem } from "./ui/emblem.ts";
import { icon } from "./ui/icons.ts";
import { type Command, isPaletteOpen, openPalette } from "./ui/palette.ts";
import { toast } from "./ui/toast.ts";
import { activityView } from "./views/activity.ts";
import { artifactsView } from "./views/artifacts.ts";
import { archiveView, openNewIdea } from "./views/archive.ts";
import { bankView } from "./views/bank.ts";
import { projectsView } from "./views/projects.ts";
import { rosterNav } from "./views/roster.ts";
import { chatActivityPill, chatsForPalette, chatView, lookAtWork, startNewChat } from "./views/chat.ts";
import { filterConversations } from "./lib/chats.ts";
import { homeOf, type Place, placesFor, railOf, routeOf, tabOf, tabsOf } from "./lib/nav.ts";
import { keyboardOpen } from "./lib/viewport.ts";
import { conversationFromHash } from "@galahad/core/notify-payload";
import { readOpenMessage } from "./lib/push.ts";
import { badgeMessage, type Badging, showBadge } from "./lib/badge.ts";
import { syncPush } from "./views/notifications.ts";
import { connectorsView } from "./views/connectors.ts";
import { findingsView } from "./views/findings.ts";
import { fleetView, openInvite } from "./views/fleet.ts";
import { inboxView } from "./views/inbox.ts";
import { loopsView, openLoopSheet } from "./views/loops.ts";
import { memoryView, openRemember } from "./views/memory.ts";
import { skillsView } from "./views/skills.ts";
import { modelsView } from "./views/models.ts";
import { moreView } from "./views/more.ts";
import { overviewView } from "./views/overview.ts";
import { openCreateSandbox, sandboxesView } from "./views/sandboxes.ts";
import { forgetThisBrowser, settingsView } from "./views/settings.ts";
import { trialsView } from "./views/trials.ts";
import { teamView } from "./views/team.ts";
import { giveToRoundtable } from "./views/team-forms.ts";
import { landingHash, teamHash, teamLocation } from "./lib/team.ts";
import { openAddKey, vaultView } from "./views/vault.ts";

/** Each place's page (the places themselves, and where each is reached from, are lib/nav.ts). */
const VIEWS: Record<Route, View> = {
  chat: chatView,
  team: teamView,
  inbox: inboxView,
  more: moreView,
  overview: overviewView,
  projects: projectsView,
  loops: loopsView,
  activity: activityView,
  artifacts: artifactsView,
  trials: trialsView,
  memory: memoryView,
  skills: skillsView,
  archive: archiveView,
  findings: findingsView,
  fleet: fleetView,
  sandboxes: sandboxesView,
  vault: vaultView,
  models: modelsView,
  connectors: connectorsView,
  bank: bankView,
  settings: settingsView,
};

export interface ShellBase {
  api: Api;
  identity: BrowserIdentity;
  whoami: WhoAmI;
}

export function renderShell(root: HTMLElement, base: ShellBase): { dispose(): void } {
  const lifetime = new AbortController();
  const scopes = new Set<AnyScope>(base.whoami.scopes);
  const can = (scope: AnyScope) => scopes.has(scope);
  const visible = placesFor(can);
  // The roster and More: the roster is the sidebar on a wide screen and the first screen on a phone, whose
  // bar is the roster and More. The app opens on the roster (lib/nav.ts).
  const tabs = tabsOf(visible);
  const hasRoster = tabs.some((spec) => spec.id === "team");
  const narrow = matchMedia("(max-width: 959px)");
  const home = (): Route => homeOf(visible, { narrow: narrow.matches });

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
      const target = visible.find((r) => r.id === route) ? route : home();
      pending = { route: target, opts };
      const hash = target === "team" ? teamHash(opts) : `#/${target}`;
      if (location.hash === hash) render();
      else location.hash = hash;
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

  const link = (spec: Place, className: string, content: (HTMLElement | SVGElement | string | null)[]): HTMLAnchorElement => {
    const a = h("a", { class: className, href: `#/${spec.id}`, title: className === "nav-item" ? `${spec.label}  (G then ${spec.key.toUpperCase()})` : null }, ...content);
    navLinks.set(spec.id, [...(navLinks.get(spec.id) ?? []), a]);
    return a;
  };
  // (Where the app opens depends on the screen: these follow it.)
  const homeLinks: HTMLAnchorElement[] = [];
  const homeLink = (className: string, ...content: (HTMLElement | SVGElement)[]): HTMLAnchorElement => {
    const a = h("a", { class: className, href: `#/${home()}`, "aria-label": "Galahad" }, ...content);
    homeLinks.push(a);
    return a;
  };

  const inboxBadges: HTMLElement[] = [];
  const inboxBadge = () => {
    const el = h("span", { class: "count", hidden: true });
    inboxBadges.push(el);
    return el;
  };

  // Sidebar: the roster, and under it More (a device with no roster has its Inbox there).
  const roster = hasRoster ? rosterNav(ctx) : null;
  const navChildren = tabs.filter((spec) => spec.id !== "team").map((spec) => link(spec, "nav-item", [icon(spec.icon), h("span", { class: "label" }, spec.label), spec.id === "inbox" ? inboxBadge() : null]));
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
    h("div", { class: "sidebar-head" }, homeLink("wordmark grow", emblem({ size: 22 }), h("span", {}, "Galahad")), collapse),
    h(
      "button",
      { class: "search-trigger", type: "button", onclick: () => ctx.palette(), "aria-label": "Search and commands" },
      icon("search", { size: 15 }),
      h("span", { class: "label" }, "Search…"),
      h("span", { class: "kbds" }, ...kbd(isMac() ? "⌘" : "Ctrl", "K")),
    ),
    roster?.el ?? null,
    h("nav", { class: "nav", "aria-label": "Sections" }, ...navChildren),
    h("div", { class: "sidebar-foot" }, deviceChip),
  );

  // Top bar
  const fleetPill = h("a", { class: "fleet-pill", href: "#/fleet", hidden: !can("mind:read") });
  const topbar = h(
    "header",
    { class: "topbar" },
    homeLink("brand-mini", emblem({ size: 24 })),
    topTitle,
    h(
      "div",
      { class: "actions" },
      chatActivityPill(),
      fleetPill,
      button("Search", { variant: "ghost", iconOnly: true, icon: "search", onClick: () => ctx.palette(), label: `Search and commands (${isMac() ? "⌘" : "Ctrl"}+K)` }),
    ),
  );

  // Rail (wide screens): every other place one click away, under More's headings, this device's settings at its foot.
  // (On a phone they are behind More.) What waits in the Inbox is counted on it.
  const railLinks = new Map<Route, HTMLAnchorElement>();
  const railLink = (spec: Place): HTMLAnchorElement => {
    const a = h("a", { class: "rail-item", href: `#/${spec.id}`, "aria-label": spec.label, "data-tip": spec.label, "data-keys": `G ${spec.key.toUpperCase()}` }, icon(spec.icon, { size: 18 }), spec.id === "inbox" ? inboxBadge() : null);
    railLinks.set(spec.id, a);
    return a;
  };
  const places = railOf(visible);
  const rail = h(
    "nav",
    { class: "rail", "aria-label": "Places" },
    ...places.groups.map((group) => h("div", { class: "rail-group" }, ...group.map(railLink))),
    h("div", { class: "rail-group rail-foot" }, ...places.foot.map(railLink)),
  );
  // Each place's name beside the rail as you point at it or tab to it (its link is named for a screen reader already).
  const railTip = h("div", { class: "rail-tip", "aria-hidden": "true", hidden: true });
  const tipFor = (target: EventTarget | null) => {
    const item = target instanceof Element ? target.closest<HTMLElement>(".rail-item") : null;
    if (!item) return void (railTip.hidden = true);
    const box = item.getBoundingClientRect();
    replace(railTip, item.dataset.tip ?? "", h("span", { class: "rail-keys" }, item.dataset.keys ?? ""));
    railTip.style.left = `${box.right + 8}px`;
    railTip.style.top = `${box.top + box.height / 2}px`;
    railTip.hidden = false;
  };
  for (const type of ["pointerover", "focusin"]) rail.addEventListener(type, (event) => tipFor(event.target), { signal: lifetime.signal });
  for (const type of ["pointerleave", "focusout", "scroll", "click"]) rail.addEventListener(type, () => (railTip.hidden = true), { signal: lifetime.signal });

  // Tab bar (phones): the Roundtable, and More. What waits in the Inbox is counted on the first.
  const tabbar = h(
    "nav",
    { class: "tabbar", "aria-label": "Sections" },
    ...tabs.map((spec, i) => link(spec, "tab", [icon(spec.icon), h("span", {}, spec.label), i === 0 ? inboxBadge() : null])),
  );

  const shell = h("div", { class: "shell" }, rail, sidebar, h("div", { class: "main-col" }, topbar, banner, main), tabbar, railTip);
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
  // The number on the app's icon: what waits in the Inbox, once it has been read (lib/badge.ts). The service worker
  // is told it too, and counts on from there the pushes that come while the app is closed.
  const toIcon = () => {
    if (!live.inboxLoaded.value) return;
    const n = live.inboxCount.value;
    void showBadge(navigator as Badging, n);
    if (isSecureContext && "serviceWorker" in navigator) {
      navigator.serviceWorker.ready.then((registration) => registration.active?.postMessage(badgeMessage(n))).catch(() => {});
    }
  };
  live.inboxCount.subscribe(toIcon);
  live.inboxLoaded.watch(toIcon);
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
  // (The Roundtable is #/team, and #/roundtable as well.)
  const routeFromHash = (): Route | null => routeOf(location.hash, visible);

  /** How often the team is asked for: every two seconds on its own pages, slowly while it is only the sidebar, never when nothing shows it. */
  const watch = (): void => live.watchTeam(!hasRoster ? null : current === "team" ? 2000 : narrow.matches ? null : 6000);
  narrow.addEventListener("change", () => (watch(), syncHome()), { signal: lifetime.signal });
  const syncHome = (): void => {
    for (const a of homeLinks) a.href = `#/${home()}`;
  };

  function render(): void {
    const route = routeFromHash() ?? home();
    const spec = visible.find((r) => r.id === route)!;
    const opts = pending?.route === route ? pending.opts : route === "team" ? teamLocation(location.hash) : {};
    pending = null;
    viewScope?.dispose();
    viewScope = new Scope();
    const changed = current !== route;
    current = route;
    shell.dataset.route = route;
    // A timeline (his, a knight's, a room's) has no top bar: its header is whose it is. On a phone it is the whole
    // screen, and the roster is the screen before it.
    shell.dataset.pane = route === "chat" || (route === "team" && opts.room) ? "timeline" : route === "team" ? "roster" : "page";
    roster?.at({ route, ...(route === "team" && opts.room ? { room: opts.room } : {}) });
    watch();
    // A place reached from More keeps More marked.
    for (const [id, els] of navLinks) for (const el of els) id === tabOf(route, tabs) ? el.setAttribute("aria-current", "page") : el.removeAttribute("aria-current");
    for (const [id, el] of railLinks) id === route ? el.setAttribute("aria-current", "page") : el.removeAttribute("aria-current");
    topTitle.textContent = spec.label;
    const n = live.inboxCount.value;
    document.title = `${n ? `(${n}) ` : ""}${spec.label} · Galahad`;
    replace(main);
    VIEWS[route](main, ctx, { scope: viewScope, opts });
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

  // ---------- command palette ----------
  const paletteSource = {
    commands(): Command[] {
      const go: Command[] = visible.map((spec) => ({
        id: `go:${spec.id}`,
        label: spec.label,
        group: "Go to",
        icon: spec.icon,
        keywords: [...spec.keywords],
        hint: `G ${spec.key.toUpperCase()}`,
        run: () => ctx.navigate(spec.id),
      }));
      const actions: Command[] = [];
      if (can("chat")) actions.push({ id: "new-chat", label: "New chat", group: "Actions", icon: "chat", keywords: ["clear", "conversation"], run: () => (startNewChat(), ctx.navigate("chat")) });
      if (can("vault:write")) actions.push({ id: "add-key", label: "Add a key to the vault", group: "Actions", icon: "key", keywords: ["api key", "secret", "seal"], run: () => openAddKey(ctx) });
      if (can("fleet:admin") && can("chat")) actions.push({ id: "give", label: "Give a task to the Roundtable", group: "Actions", icon: "layers", keywords: ["task", "knights", "delegate", "best suited", "assign"], run: () => giveToRoundtable(ctx) });
      if (can("fleet:admin")) {
        actions.push({ id: "invite-client", label: "Pair a phone or browser", group: "Actions", icon: "phone", keywords: ["invite", "device", "add"], run: () => openInvite(ctx, "client") });
        actions.push({ id: "invite-node", label: "Add a machine to the fleet", group: "Actions", icon: "server", keywords: ["invite", "node", "join"], run: () => openInvite(ctx, "node") });
      }
      if (can("mind:write")) actions.push({ id: "remember", label: "Remember something", group: "Actions", icon: "memory", keywords: ["note", "add memory"], run: () => openRemember(ctx) });
      if (can("mind:write")) actions.push({ id: "new-idea", label: "New idea", group: "Actions", icon: "lightbulb", keywords: ["archive", "note", "keep", "thought"], run: () => openNewIdea(ctx) });
      if (can("sandbox")) actions.push({ id: "create-sandbox", label: "Create a sandbox", group: "Actions", icon: "sandbox", keywords: ["container", "vm", "new"], run: () => openCreateSandbox(ctx) });
      if (can("mind:read")) actions.push({ id: "place", label: "Where would this run?", group: "Actions", icon: "compass", keywords: ["placement", "playground", "schedule"], run: () => ctx.navigate("fleet", { intent: "place" }) });
      if (can("brain:write")) actions.push({ id: "add-loop", label: "Add a loop", group: "Actions", icon: "repeat", keywords: ["schedule", "cron", "every", "routine"], run: () => openLoopSheet(ctx) });
      if (can("mind:read")) actions.push({ id: "heartbeat", label: "Run the heartbeat's checks now", group: "Actions", icon: "review", keywords: ["health", "check", "notices"], run: () => ctx.navigate("loops", { intent: "check" }) });
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
  // His row says what he is doing wherever the roster shows: asked for here while no chat is on screen to ask it.
  const work = (): void => {
    if (roster && (!narrow.matches || shell.dataset.pane === "roster")) void lookAtWork(base.api, { chat: can("chat"), read: can("mind:read") });
  };
  const working = setInterval(work, 15_000);
  lifetime.signal.addEventListener("abort", () => clearInterval(working));
  chatFromAddress();
  const initial = routeFromHash() ?? home();
  // (Tidied to its page; Team's address keeps its room and tab, which is what a reload comes back to.)
  const landing = landingHash(initial, location.hash);
  if (location.hash !== landing) history.replaceState(null, "", landing);
  render();
  work();
  return {
    dispose() {
      lifetime.abort();
      roster?.dispose();
      viewScope?.dispose();
      titleObserver?.disconnect();
      live.stop();
    },
  };
}
