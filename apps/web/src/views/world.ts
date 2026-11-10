import type { ExperimentView, Station, WorldEvent } from "@galahad/core/world";
import { STATIONS } from "@galahad/core/world";
import { isUnavailable } from "../api.ts";
import { errorMessage, type View } from "../context.ts";
import {
  applyWorldEvent,
  emptyWorld,
  ENGINE_LABEL,
  experimentEnded,
  followWorld,
  metricLabel,
  metricValue,
  STATUS_LABEL,
  STATUS_TONE,
  type StreamStatus,
  stationLabel,
  type WorldModel,
  worldSummary,
} from "../lib/world.ts";
import { relativeTime } from "../lib/time.ts";
import { badge, button, callout, dot, segmented } from "../ui/controls.ts";
import { openSheet } from "../ui/dialog.ts";
import { h, isTyping, replace } from "../ui/dom.ts";
import { icon } from "../ui/icons.ts";
import { toast } from "../ui/toast.ts";

/*
 * The SANDBOX: a 3D world where Galahad is seen at work, walking between the
 * places of his keep, and every experiment runs live on its own plot. The world
 * itself is a separate bundle (/world.js, three.js on WebGPU or WebGL2), fetched
 * only when this page opens; this page keeps the stream (GET /api/world, signed,
 * reconnecting), the model, and the HUD. A node that doesn't stream the world yet
 * gets a clearly labelled demo. Leaving the page closes the stream and gives the
 * GPU everything back.
 */

const WORLD_MODULE = "/world.js";
type WorldModule = typeof import("../world.ts");
type Handle = Awaited<ReturnType<WorldModule["mountWorld"]>>;
type TierName = NonNullable<Parameters<WorldModule["mountWorld"]>[1]["tier"]>;
const TIME_CHOICES = [
  { value: "now", label: "Now", icon: "clock" },
  { value: "dawn", label: "Dawn", icon: "sun" },
  { value: "day", label: "Day", icon: "sun" },
  { value: "golden", label: "Golden hour", icon: "sun" },
  { value: "night", label: "Night", icon: "moon" },
] as const;
type TimeChoice = (typeof TIME_CHOICES)[number]["value"];

/** A notice this recent (node's clock) still lights the beacon. */
const NOTICE_MS = 10 * 60_000;
const MAX_RESTARTS = 2;

export const worldView: View = (root, ctx, { scope }) => {
  let model: WorldModel = emptyWorld();
  let handle: Handle | null = null;
  let mod: WorldModule | null = null;
  let status: StreamStatus = "connecting";
  let demoTimer: ReturnType<typeof setInterval> | null = null;
  let selected: string | null = null;
  let following = true;
  let restarts = 0;
  let tier: TierName | undefined;
  let forceWebGL = false;
  let gPressed = 0;

  // ---------- layout ----------
  const statusBadge = h("span", {});
  const stage = h("div", { class: "world-stage", role: "region", "aria-label": "The SANDBOX: a 3D view. Arrow keys pan, plus and minus zoom, Q and E turn, F follows Galahad.", tabindex: 0 });
  const loading = h("div", { class: "world-loading" }, h("span", { class: "spinner", "aria-hidden": "true" }), h("span", {}, "Opening the world…"));
  const fallback = h("div", { class: "world-fallback", hidden: true });
  const banner = h("div", { class: "world-banner", hidden: true });
  const followButton = button("Follow Galahad", { icon: "user", size: "sm", onClick: () => setFollow(!following) });
  const goButton = button("Go to", { icon: "compass", size: "sm", onClick: () => openGoTo() });
  const listButton = button("Experiments", { icon: "flask", size: "sm", onClick: () => togglePanel() });
  const time = segmented<TimeChoice>(TIME_CHOICES.map((c) => ({ value: c.value, label: c.label, icon: c.icon })), "now", (v) => setTime(v), { label: "Time of day", small: true });
  const panel = h("div", { class: "world-panel card", hidden: true });
  const stats = h("div", { class: "world-stats tiny", "aria-hidden": "true" });
  const controls = h(
    "div",
    { class: "world-controls" },
    button("Zoom in", { iconOnly: true, icon: "plus", size: "sm", onClick: () => handle?.zoom(1) }),
    button("Zoom out", { iconOnly: true, icon: "minus", size: "sm", onClick: () => handle?.zoom(-1) }),
    button("Turn left", { iconOnly: true, icon: "chevron-left", size: "sm", onClick: () => handle?.rotate(-1) }),
    button("Turn right", { iconOnly: true, icon: "chevron-right", size: "sm", onClick: () => handle?.rotate(1) }),
  );
  const hud = h(
    "div",
    { class: "world-hud" },
    h("div", { class: "world-top" }, banner, h("div", { class: "world-tools" }, followButton, goButton, listButton, time.el)),
    h("div", { class: "world-bottom" }, panel, h("div", { class: "world-corner" }, controls, stats)),
  );
  const summary = h("div", { class: "sr-only", "aria-live": "polite" });
  stage.append(loading, fallback, hud);
  replace(
    root,
    h(
      "div",
      { class: "page full world-page" },
      h(
        "header",
        { class: "page-head world-head" },
        h("div", { class: "grow" }, h("h1", {}, "SANDBOX"), h("p", { class: "lede" }, "Galahad at work in his world, and every experiment live on its own plot.")),
        h("div", { class: "actions" }, statusBadge),
      ),
      stage,
      summary,
    ),
  );

  // ---------- status, banner, follow ----------
  function showStatus(): void {
    const [text, tone]: [string, "ok" | "warn" | "neutral" | "danger"] =
      status === "live" ? ["Live", "ok"] : status === "unavailable" ? ["Demo", "warn"] : status === "reconnecting" ? ["Reconnecting…", "warn"] : ["Connecting…", "neutral"];
    replace(statusBadge, badge(text, tone, status === "live" ? "dot" : status === "unavailable" ? "play-circle" : undefined));
    banner.hidden = status !== "unavailable" && status !== "reconnecting";
    if (status === "unavailable") {
      replace(banner, callout("warn", "This node doesn't stream the world yet, so this is a scripted demo: Galahad, the experiments and the fleet here are made up. Nothing you see is real.", { title: "Demo" }));
    } else if (status === "reconnecting") {
      replace(banner, callout("quiet", "The connection to your node dropped; what you see may be out of date. Reconnecting…", { title: "Reconnecting" }));
    }
  }

  function setFollow(on: boolean): void {
    following = on;
    followButton.setAttribute("aria-pressed", String(on));
    followButton.classList.toggle("primary", on);
    handle?.setFollow(on);
  }
  setFollow(true);

  function setTime(choice: TimeChoice): void {
    if (!mod) return;
    handle?.setTimeOfDay(choice === "now" ? null : mod.TIME_PRESETS[choice]);
  }

  // ---------- the model ----------
  let hudTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSummary = "";
  let summaryTimer: ReturnType<typeof setTimeout> | null = null;

  function apply(event: WorldEvent): void {
    const next = applyWorldEvent(model, event);
    if (next === model) return;
    model = next;
    handle?.update(model, event);
    if (event.type !== "frame" || selected === event.frame.experiment) scheduleHud();
  }

  function scheduleHud(): void {
    if (hudTimer) return;
    hudTimer = setTimeout(() => {
      hudTimer = null;
      if (scope.disposed) return;
      renderPanel();
      updateBeacon();
      updateSummary();
    }, 250);
  }
  scope.add(() => {
    if (hudTimer) clearTimeout(hudTimer);
    if (summaryTimer) clearTimeout(summaryTimer);
  });

  function updateSummary(): void {
    const text = worldSummary(model);
    if (text === lastSummary) return;
    lastSummary = text;
    if (!fallback.hidden) replace(fallback.querySelector(".world-summary") ?? fallback, text);
    // Politely, and not more than every couple of seconds.
    if (summaryTimer) clearTimeout(summaryTimer);
    summaryTimer = setTimeout(() => (summary.textContent = lastSummary), 1500);
  }

  function updateBeacon(): void {
    const open = ctx.live.notices.value.some((n) => !n.dismissed);
    const recent = model.notice !== null && model.at - model.notice.at < NOTICE_MS;
    handle?.setBeacon(open || recent);
  }
  scope.add(ctx.live.notices.subscribe(() => updateBeacon()));

  // ---------- the panel: the experiments, or the one selected ----------
  let panelOpen = !matchMedia("(max-width: 639px)").matches;

  function togglePanel(): void {
    if (selected) select(null);
    else panelOpen = !panelOpen;
    listButton.setAttribute("aria-pressed", String(panelOpen && !selected));
    renderPanel();
  }

  function select(id: string | null): void {
    selected = id;
    handle?.select(id);
    if (id) handle?.goTo({ kind: "experiment", id });
    renderPanel();
  }

  function experimentRow(e: ExperimentView): HTMLElement {
    return h(
      "button",
      { class: "item item-button", type: "button", "data-key": e.id, onclick: () => select(e.id), "aria-label": `${e.title}: ${STATUS_LABEL[e.status]}` },
      dot(STATUS_TONE[e.status], { live: e.status === "running" }),
      h(
        "div",
        { class: "grow", style: "min-width:0" },
        h("div", { class: "strong small ellipsis" }, e.title),
        h("div", { class: "meta" }, h("span", {}, ENGINE_LABEL[e.engine]), h("span", {}, e.nodeName), experimentEnded(e) && e.endedAt ? h("span", {}, `ended ${relativeTime(e.endedAt)}`) : null),
      ),
      icon("chevron-right", { size: 14, class: "subtle" }),
    );
  }

  function renderPanel(): void {
    const e = selected ? model.experiments.find((x) => x.id === selected) : undefined;
    if (selected && !e) {
      selected = null;
      handle?.select(null);
    }
    listButton.setAttribute("aria-pressed", String(panelOpen && !selected));
    replace(listButton.querySelector("span") ?? listButton, `Experiments${model.experiments.length ? ` (${model.experiments.length})` : ""}`);
    if (e) {
      panel.hidden = false;
      const metrics = Object.entries(e.metrics);
      replace(
        panel,
        h(
          "div",
          { class: "card-head" },
          dot(STATUS_TONE[e.status], { live: e.status === "running", label: STATUS_LABEL[e.status] }),
          h("h3", { class: "grow ellipsis" }, e.title),
          button("Close", { iconOnly: true, icon: "x", size: "sm", variant: "ghost", onClick: () => select(null) }),
        ),
        h(
          "div",
          { class: "card-body stack tight" },
          h("div", { class: "row wrap" }, badge(STATUS_LABEL[e.status], STATUS_TONE[e.status]), badge(ENGINE_LABEL[e.engine], "neutral")),
          metrics.length
            ? h("dl", { class: "kv tnum world-metrics" }, ...metrics.flatMap(([k, v]) => [h("dt", {}, metricLabel(k)), h("dd", { class: "mono" }, metricValue(v))]))
            : h("p", { class: "small muted" }, "No readouts yet."),
          h(
            "dl",
            { class: "kv" },
            h("dt", {}, "Node"),
            h("dd", {}, e.nodeName),
            h("dt", {}, "Sandbox"),
            h("dd", { class: "mono" }, e.sandbox ?? "—"),
            h("dt", {}, "Quest"),
            h("dd", {}, e.quest ?? "—"),
            h("dt", {}, "Started"),
            h("dd", {}, relativeTime(e.startedAt)),
            model.frames[e.id] ? [h("dt", {}, "Sim time"), h("dd", { class: "mono tnum" }, `${model.frames[e.id]!.t.toFixed(1)} s`)] : null,
          ),
          e.summary ? callout(e.status === "failed" ? "danger" : "quiet", e.summary, { title: experimentEnded(e) ? "How it ended" : undefined }) : null,
        ),
      );
      return;
    }
    panel.hidden = !panelOpen;
    if (!panelOpen) return;
    replace(
      panel,
      h("div", { class: "card-head" }, icon("flask", { size: 16 }), h("h3", { class: "grow" }, "Experiments"), h("span", { class: "tiny subtle tnum" }, String(model.experiments.length))),
      model.experiments.length
        ? h("div", { class: "rows world-list" }, ...[...model.experiments].reverse().map(experimentRow))
        : h("p", { class: "card-body small muted" }, "No experiments yet. When Galahad runs a simulation, it appears here and on its own plot."),
    );
  }

  // ---------- go to ----------
  function openGoTo(): void {
    const go = (fn: () => void) => () => {
      sheet.close();
      fn();
    };
    const places = Object.entries(STATIONS) as [Exclude<Station, "field">, { label: string }][];
    const sheet = openSheet({
      title: "Go to",
      size: "small",
      body: h(
        "div",
        { class: "stack" },
        h(
          "div",
          { class: "rows card" },
          h(
            "button",
            { class: "item item-button", type: "button", onclick: go(() => (setFollow(true), handle?.goTo({ kind: "galahad" }))) },
            icon("user", { size: 16 }),
            h("div", { class: "grow" }, h("div", { class: "strong small" }, "Galahad"), h("div", { class: "meta" }, model.galahad.doing || stationLabel(model.galahad.station))),
          ),
          ...places.map(([id, s]) =>
            h(
              "button",
              { class: "item item-button", type: "button", onclick: go(() => (setFollow(false), handle?.goTo({ kind: "station", station: id }))) },
              icon("compass", { size: 16 }),
              h("div", { class: "grow" }, h("div", { class: "strong small" }, s.label)),
            ),
          ),
        ),
        model.experiments.length
          ? h(
              "div",
              { class: "rows card" },
              ...model.experiments.map((e) =>
                h(
                  "button",
                  { class: "item item-button", type: "button", onclick: go(() => (setFollow(false), select(e.id))) },
                  dot(STATUS_TONE[e.status]),
                  h("div", { class: "grow", style: "min-width:0" }, h("div", { class: "strong small ellipsis" }, e.title), h("div", { class: "meta" }, `${ENGINE_LABEL[e.engine]} · ${STATUS_LABEL[e.status]}`)),
                ),
              ),
            )
          : null,
      ),
    });
  }

  // ---------- keyboard ----------
  scope.listen(document, "keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target) || document.querySelector("dialog[open]")) return;
    const key = event.key;
    // "G then a letter" is the shell's navigation; stay out of its way.
    if (key.toLowerCase() === "g") {
      gPressed = Date.now();
      return;
    }
    if (Date.now() - gPressed < 1200) return;
    const steps: Record<string, () => void> = {
      ArrowLeft: () => handle?.pan(-1, 0),
      ArrowRight: () => handle?.pan(1, 0),
      ArrowUp: () => handle?.pan(0, 1),
      ArrowDown: () => handle?.pan(0, -1),
      "+": () => handle?.zoom(1),
      "=": () => handle?.zoom(1),
      "-": () => handle?.zoom(-1),
      q: () => handle?.rotate(-1),
      e: () => handle?.rotate(1),
      f: () => setFollow(!following),
    };
    const run = steps[key.length === 1 ? key.toLowerCase() : key];
    if (!run) return;
    event.preventDefault();
    run();
  });

  // ---------- the world bundle ----------
  async function loadModule(): Promise<WorldModule | null> {
    try {
      const loaded = (await import(WORLD_MODULE)) as WorldModule;
      if (loaded.WORLD_API !== 1) throw new Error("version");
      return loaded;
    } catch {
      showFallback("The SANDBOX was just updated. Reload the page to open it.", true);
      return null;
    }
  }

  function showFallback(message: string, reload = false): void {
    loading.remove();
    hud.hidden = true;
    fallback.hidden = false;
    replace(
      fallback,
      callout("info", message, {
        title: "The 3D view isn't running",
        actions: reload ? button("Reload", { icon: "refresh", size: "sm", onClick: () => location.reload() }) : button("Try again", { icon: "retry", size: "sm", onClick: () => void start() }),
      }),
      h("h2", { class: "small strong" }, "What's happening"),
      h("p", { class: "small world-summary" }, worldSummary(model)),
    );
  }

  async function start(): Promise<void> {
    if (scope.disposed) return;
    mod ??= await loadModule();
    if (!mod || scope.disposed) return;
    fallback.hidden = true;
    hud.hidden = false;
    if (!loading.isConnected) stage.prepend(loading);
    try {
      const mounted = await mod.mountWorld(stage, {
        tier,
        forceWebGL,
        onSelect: (id) => select(id),
        onFollow: (on) => {
          following = on;
          followButton.setAttribute("aria-pressed", String(on));
          followButton.classList.toggle("primary", on);
        },
        onLost: (reason) => void lostDevice(reason),
      });
      if (scope.disposed) {
        mounted.dispose();
        return;
      }
      handle = mounted;
      loading.remove();
      handle.update(model, null);
      handle.select(selected);
      handle.setFollow(following);
      updateBeacon();
      scope.add(() => handle?.dispose());
    } catch (error) {
      showFallback(`This device can't draw the world: ${errorMessage(error)}. Here is what's happening, in words.`);
    }
  }

  async function lostDevice(reason: string): Promise<void> {
    const was = handle?.stats();
    handle?.dispose();
    handle = null;
    if (scope.disposed) return;
    if (restarts >= MAX_RESTARTS) {
      showFallback(`The graphics device stopped (${reason}). Here is what's happening, in words.`);
      return;
    }
    restarts++;
    // Come back lighter: a tier down, and on WebGL2 if it was WebGPU that went.
    tier = mod?.lowerTier(was?.tier ?? tier ?? "high");
    forceWebGL ||= was?.backend === "webgpu";
    toast("The 3D view restarted", { tone: "info", description: "The graphics device was reset; it's running at a lighter setting now." });
    await new Promise((resolve) => setTimeout(resolve, 800));
    await start();
  }

  // ---------- stats ----------
  scope.interval(() => {
    const s = handle?.stats();
    if (!s) return;
    stats.textContent = `${s.backend === "webgpu" ? "WebGPU" : "WebGL2"} · ${s.tier} · ${s.fps} fps`;
  }, 2000);

  // ---------- the stream, or the demo ----------
  function startDemo(): void {
    if (demoTimer || !mod) return;
    const demo = mod.createDemo(Date.now());
    model = emptyWorld();
    apply(demo.hello(Date.now()));
    demoTimer = setInterval(() => {
      for (const event of demo.step(Date.now())) apply(event);
    }, 50);
  }
  function stopDemo(): void {
    if (!demoTimer) return;
    clearInterval(demoTimer);
    demoTimer = null;
  }
  scope.add(stopDemo);

  const moduleReady = start();
  showStatus();
  void followWorld({
    open: (signal) => ctx.api.stream("/api/world", signal),
    signal: scope.signal,
    unavailable: isUnavailable,
    onStatus: (next) => {
      status = next;
      showStatus();
      if (next === "unavailable") void moduleReady.then(() => !scope.disposed && status === "unavailable" && startDemo());
      if (next === "live" && demoTimer) {
        // The real world replaces the demo entirely (its hello comes next); nothing of the demo stays.
        stopDemo();
        model = emptyWorld();
      }
    },
    onEvent: (event) => apply(event),
  });
  renderPanel();
};
