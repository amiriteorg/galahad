import type { ExperimentView, SiteName, Station, WorldEvent } from "@galahad/core/world";
import { SITE_NAMES, SITES, STATIONS } from "@galahad/core/world";
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
  weatherLabel,
  worldSummary,
} from "../lib/world.ts";
import { relativeTime } from "../lib/time.ts";
import { badge, button, callout, dot, segmented } from "../ui/controls.ts";
import { openSheet } from "../ui/dialog.ts";
import { h, isTyping, replace } from "../ui/dom.ts";
import { icon } from "../ui/icons.ts";
import { toast } from "../ui/toast.ts";
import { FIELD, RUNWAY } from "../world/field-plan.ts";
import { HALL } from "../world/hall-plan.ts";

/*
 * The SANDBOX: a 3D world where Galahad is seen at work, walking between the
 * places of his keep, and every experiment runs live on its own plot. The world
 * itself is a separate bundle (/world.js, three.js on WebGPU or WebGL2), fetched
 * only when this page opens; this page keeps the stream (GET /api/world, signed,
 * reconnecting), the model, and the HUD. A node that doesn't stream the world yet
 * gets a clearly labelled demo. Leaving the page closes the stream and gives the
 * GPU everything back. The sky is the real one over Denmark now (its clock on
 * the HUD), unless a preset is chosen; the weather is the viewer's choice, kept
 * in this browser.
 */

const WORLD_MODULE = "/world.js";
/** The bundle this page speaks to (bumped together with world.ts's WORLD_API). */
const WORLD_API = 5;

/** What each test site is for, in a line (the Go to list). */
const SITE_ABOUT: Record<SiteName, string> = {
  field: "Aircraft, rockets and rovers: the runway, the launch pad, the course",
  hall: "Robots, assemblies and machines, indoors",
};
type WorldModule = typeof import("../world.ts");
type Handle = Awaited<ReturnType<WorldModule["mountWorld"]>>;
type TierName = NonNullable<Parameters<WorldModule["mountWorld"]>[1]["tier"]>;
const TIME_CHOICES = [
  { value: "now", label: "Now", short: "Now", icon: "clock" },
  { value: "dawn", label: "Dawn", short: "Dawn", icon: "sun" },
  { value: "day", label: "Day", short: "Day", icon: "sun" },
  { value: "golden", label: "Golden hour", short: "Golden", icon: "sun" },
  { value: "night", label: "Night", short: "Night", icon: "moon" },
] as const;
type TimeChoice = (typeof TIME_CHOICES)[number]["value"];
const WEATHER_CHOICES = [
  // Denmark's weather now (DMI's model at Copenhagen, from the node); clear while it isn't known.
  { value: "live", label: "Live", icon: "globe" },
  { value: "clear", label: "Clear", icon: "sun" },
  { value: "mist", label: "Mist", icon: "mist" },
  { value: "rain", label: "Rain", icon: "rain" },
] as const;
type WeatherChoice = (typeof WEATHER_CHOICES)[number]["value"];
/** This viewer's weather (only theirs: it's kept in this browser). */
const WEATHER_KEY = "galahad.world.weather";

function storedWeather(): WeatherChoice {
  try {
    const v = localStorage.getItem(WEATHER_KEY);
    return WEATHER_CHOICES.some((c) => c.value === v) ? (v as WeatherChoice) : "live";
  } catch {
    return "live";
  }
}

/** Whether this viewer keeps the map open (kept in this browser; open by default where there's room). */
const MAP_KEY = "galahad.world.map";

function storedMap(): boolean {
  try {
    const v = localStorage.getItem(MAP_KEY);
    if (v === "on" || v === "off") return v === "on";
  } catch {
    /* storage off: the default */
  }
  return !matchMedia("(max-width: 639px)").matches;
}

/** The map's colours: paper and ink, the same in both themes (it lies over the world, like the labels). */
const MAP_INK = "rgb(59 53 80 / 0.6)";
const MAP_STATUS: Record<ExperimentView["status"], string> = { running: "#3aa66a", starting: "#d89a2b", failed: "#d24b3e", done: "#9a9ea6" };

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
  let timeChoice: TimeChoice = "now";
  let weatherChoice: WeatherChoice = storedWeather();

  // ---------- layout ----------
  const statusBadge = h("span", {});
  const stage = h("div", { class: "world-stage", role: "region", "aria-label": "The SANDBOX: a 3D view. Arrow keys pan, plus and minus zoom, Q and E turn, F follows Galahad, M shows the map.", tabindex: 0 });
  const loading = h("div", { class: "world-loading" }, h("span", { class: "spinner", "aria-hidden": "true" }), h("span", {}, "Opening the world…"));
  const fallback = h("div", { class: "world-fallback", hidden: true });
  const banner = h("div", { class: "world-banner", hidden: true });
  const followButton = button("Follow Galahad", { icon: "user", size: "sm", onClick: () => setFollow(!following) });
  const goButton = button("Go to", { icon: "compass", size: "sm", onClick: () => openGoTo() });
  const listButton = button("Experiments", { icon: "flask", size: "sm", onClick: () => togglePanel() });
  const time = segmented<TimeChoice>(TIME_CHOICES.map((c) => ({ value: c.value, label: c.short, title: c.label, icon: c.icon })), "now", (v) => setTime(v), { label: "Time of day", small: true, block: true });
  const weatherControl = segmented<WeatherChoice>(WEATHER_CHOICES.map((c) => ({ value: c.value, label: c.label, icon: c.icon })), weatherChoice, (v) => setWeather(v), { label: "Weather", small: true, block: true });
  // The sky, in one control: the time in Denmark and its weather on the button; the choices behind it.
  const clock = h("span", { class: "sky-time tnum" });
  const skyMore = h("span", { class: "sky-more" });
  const skyButton = h("button", { class: "btn sm world-sky-btn", type: "button", "aria-expanded": "false", "aria-controls": "world-sky", onclick: () => setSky(!skyOpen) }, icon("clock", { size: 15 }), clock, skyMore);
  const skyNote = h("p", { class: "tiny muted grow" });
  const skyReset = button("Back to now", {
    icon: "clock",
    size: "sm",
    onClick: () => {
      time.set("now");
      weatherControl.set("live");
      setTime("now");
      setWeather("live");
    },
  });
  const skyPanel = h(
    "div",
    { class: "world-sky card", id: "world-sky", role: "group", "aria-label": "The sky", hidden: true },
    h("div", { class: "sky-row" }, h("span", { class: "small strong" }, "Time"), time.el),
    h("div", { class: "sky-row" }, h("span", { class: "small strong" }, "Weather"), weatherControl.el),
    h("div", { class: "sky-foot" }, skyNote, skyReset),
  );
  let skyOpen = false;
  let mapOn = storedMap();
  const mapCanvas = h("canvas", { class: "world-map", "aria-hidden": "true", hidden: !mapOn }) as HTMLCanvasElement;
  const mapButton = button("Map", { icon: "landscape", size: "sm", onClick: () => setMap(!mapOn) });
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
    h(
      "div",
      { class: "world-top" },
      h("div", { class: "world-left" }, banner, mapCanvas),
      h("div", { class: "world-right" }, h("div", { class: "world-tools" }, followButton, goButton, listButton, mapButton, skyButton), skyPanel),
    ),
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
    timeChoice = choice;
    handle?.setTimeOfDay(choice === "now" ? null : choice);
    showClock();
  }

  /** The chosen weather to the world: a preset, or Denmark's real weather when it's known (clear until then). */
  function applyWeather(snap = false): void {
    if (!handle || !mod) return;
    if (weatherChoice !== "live") handle.setWeather(weatherChoice);
    else if (model.weather) handle.aimWeather(mod.liveTarget(model.weather), snap);
    else handle.setWeather("clear");
  }

  function setWeather(choice: WeatherChoice): void {
    weatherChoice = choice;
    applyWeather();
    showClock();
    try {
      localStorage.setItem(WEATHER_KEY, choice);
    } catch {
      /* storage off (a private window): the choice lasts this visit */
    }
  }

  /** The sky's choices, open or shut. */
  function setSky(open: boolean): void {
    skyOpen = open;
    skyPanel.hidden = !open;
    skyButton.setAttribute("aria-expanded", String(open));
  }

  /**
   * The sky's button and note: the time in Denmark (whatever the device's zone) and its weather; when a
   * preset is on, that it's a preview of another light or weather, with a way back.
   */
  function showClock(): void {
    if (!mod) return;
    const w = weatherChoice === "live" ? model.weather : null;
    const showing = [timeChoice !== "now" ? TIME_CHOICES.find((c) => c.value === timeChoice)!.label : null, weatherChoice !== "live" ? WEATHER_CHOICES.find((c) => c.value === weatherChoice)!.label : null]
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .join(", ")
      .toLowerCase();
    const real = w ? `${weatherLabel(w).toLowerCase()}, ${Math.round(w.temperature)} °C` : "";
    clock.textContent = mod.danishTime(Date.now());
    skyMore.textContent = ` in Denmark${showing ? ` · showing ${showing}` : real ? ` · ${real}` : ""}`;
    skyButton.dataset.preview = String(Boolean(showing));
    skyButton.title = showing ? "A preview of another sky. Open to go back to now." : "The sky follows the real sun, moon and weather over Denmark. Open to preview another.";
    skyNote.textContent = showing
      ? "A preview. The real sky is Denmark's, now."
      : w
        ? `${w.place}: ${real}, wind ${Math.round(w.wind)} m/s. ${w.source}, ${new Date(w.observed).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`
        : "The real sun and moon over Denmark. Its weather isn't known right now, so the sky is shown clear.";
    skyReset.hidden = !showing;
  }
  scope.interval(showClock, 15_000);

  // ---------- the map: the keep, the two sites, the plots, Galahad and where the view looks; tap it to go there ----------
  function setMap(on: boolean): void {
    mapOn = on;
    mapCanvas.hidden = !on;
    mapButton.setAttribute("aria-pressed", String(on));
    try {
      localStorage.setItem(MAP_KEY, on ? "on" : "off");
    } catch {
      /* storage off: the choice lasts this visit */
    }
    drawMap();
  }
  mapButton.setAttribute("aria-pressed", String(mapOn));

  const where = { galahadX: 0, galahadY: 0, galahadHeading: 0, focusX: 0, focusY: 0, yaw: 0, distance: 0 };
  const uv: [number, number] = [0, 0];
  let mapLand: HTMLCanvasElement | null = null;

  /** The land under the markers, sketched once: water, and the ground paler the lower it lies. */
  function landSketch(m: WorldModule): HTMLCanvasElement {
    const n = 80;
    const cells = m.sketchLand(n);
    const canvas = document.createElement("canvas");
    canvas.width = n;
    canvas.height = n;
    const g = canvas.getContext("2d")!;
    const image = g.createImageData(n, n);
    for (let i = 0; i < cells.length; i++) {
      const v = cells[i]!;
      const t = (v - 1) / 254;
      image.data[i * 4] = v ? 228 - 46 * t : 168;
      image.data[i * 4 + 1] = v ? 235 - 30 * t : 207;
      image.data[i * 4 + 2] = v ? 203 - 55 * t : 230;
      image.data[i * 4 + 3] = 238;
    }
    g.putImageData(image, 0, 0);
    return canvas;
  }

  function drawMap(): void {
    if (!mapOn || !handle || !mod || document.hidden) return;
    const size = mapCanvas.clientWidth;
    if (!size) return;
    const px = Math.round(size * Math.min(2, devicePixelRatio || 1));
    if (mapCanvas.width !== px) {
      mapCanvas.width = px;
      mapCanvas.height = px;
    }
    const g = mapCanvas.getContext("2d");
    if (!g) return;
    const m = mod;
    mapLand ??= landSketch(m);
    // One unit is the whole map; `one` is a CSS pixel.
    g.setTransform(px, 0, 0, px, 0, 0);
    const one = 1 / size;
    const span = m.MAP_VIEW.span;
    g.clearRect(0, 0, 1, 1);
    g.imageSmoothingEnabled = true;
    g.drawImage(mapLand, 0, 0, 1, 1);
    /** A world point on the map, kept just inside its edge (what's beyond shows at the rim). */
    const at = (x: number, y: number): [number, number] => {
      m.mapPoint(x, y, uv);
      uv[0] = Math.max(0.04, Math.min(0.96, uv[0]));
      uv[1] = Math.max(0.04, Math.min(0.96, uv[1]));
      return uv;
    };
    const rect = (r: { x: number; y: number; hx: number; hy: number }, fill: string, stroke?: string): void => {
      m.mapPoint(r.x - r.hx, r.y + r.hy, uv);
      g.fillStyle = fill;
      g.fillRect(uv[0], uv[1], (2 * r.hx) / span, (2 * r.hy) / span);
      if (!stroke) return;
      g.strokeStyle = stroke;
      g.lineWidth = one;
      g.strokeRect(uv[0], uv[1], (2 * r.hx) / span, (2 * r.hy) / span);
    };
    const dot = (x: number, y: number, r: number, fill: string, ring?: string): void => {
      const [u, v] = at(x, y);
      g.beginPath();
      g.arc(u, v, r * one, 0, Math.PI * 2);
      g.fillStyle = fill;
      g.fill();
      if (!ring) return;
      g.strokeStyle = ring;
      g.lineWidth = 1.5 * one;
      g.stroke();
    };
    // The two sites, the runway and the hall's door; then the keep's stations.
    rect(FIELD, "rgb(214 230 170 / 0.9)", MAP_INK);
    rect(RUNWAY, "#8d9097");
    rect(HALL, "rgb(190 186 178 / 0.95)", MAP_INK);
    for (const s of Object.values(STATIONS)) dot(s.x, s.y, 1.5, "rgb(59 53 80 / 0.75)");
    // Every experiment where it stands, in its status's colour.
    for (const e of model.experiments) {
      const [u, v] = at(e.plot.x, e.plot.y);
      const half = Math.max(3 * one, e.plot.size / 2 / span);
      g.fillStyle = MAP_STATUS[e.status];
      g.fillRect(u - half, v - half, 2 * half, 2 * half);
      g.strokeStyle = "rgb(255 255 255 / 0.9)";
      g.lineWidth = one;
      g.strokeRect(u - half, v - half, 2 * half, 2 * half);
    }
    // Where the view looks: an open wedge from its focus.
    handle.where(where);
    const [fu, fv] = at(where.focusX, where.focusY);
    g.beginPath();
    for (const side of [-0.45, 0.45]) {
      g.moveTo(fu, fv);
      g.lineTo(fu + Math.cos(where.yaw + side) * 13 * one, fv - Math.sin(where.yaw + side) * 13 * one);
    }
    g.strokeStyle = MAP_INK;
    g.lineWidth = 1.5 * one;
    g.stroke();
    // Galahad, and the way he faces.
    const [gu, gv] = at(where.galahadX, where.galahadY);
    g.beginPath();
    g.moveTo(gu, gv);
    g.lineTo(gu + Math.cos(where.galahadHeading) * 7 * one, gv - Math.sin(where.galahadHeading) * 7 * one);
    g.strokeStyle = "#e8853a";
    g.lineWidth = 2 * one;
    g.stroke();
    dot(where.galahadX, where.galahadY, 3.6, "#e8853a", "#ffffff");
  }
  scope.interval(drawMap, 200);
  scope.listen(mapCanvas, "click", (event) => {
    if (!handle || !mod) return;
    const box = mapCanvas.getBoundingClientRect();
    const { clientX, clientY } = event as MouseEvent;
    mod.mapToWorld((clientX - box.left) / box.width, (clientY - box.top) / box.height, uv);
    setFollow(false);
    handle.goTo({ kind: "point", x: uv[0], y: uv[1] });
    drawMap();
  });

  // ---------- the model ----------
  let hudTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSummary = "";
  let summaryTimer: ReturnType<typeof setTimeout> | null = null;

  function apply(event: WorldEvent): void {
    const next = applyWorldEvent(model, event);
    if (next === model) return;
    model = next;
    handle?.update(model, event);
    if ((event.type === "weather" || event.type === "hello") && weatherChoice === "live") {
      applyWeather();
      showClock();
    }
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

  // ---------- diagnostics: how it ran here, reported to the node (galahad world --logs) ----------
  type DiagKind = "start" | "slow" | "lost" | "restart" | "fallback" | "error" | "warning";
  const session = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
  const diag = { events: [] as { at: number; kind: DiagKind; text: string }[], fps: [] as number[], slow: 0, lastSlowNote: 0, adapter: undefined as string | undefined };
  const note = (kind: DiagKind, text: string) => {
    diag.events.push({ at: Date.now(), kind, text: text.slice(0, 600) });
    if (diag.events.length > 40) diag.events.shift();
    if (kind !== "start" && kind !== "slow") void sendReport();
  };
  let lastReport = 0;
  let reportTimer: ReturnType<typeof setTimeout> | null = null;
  async function sendReport(): Promise<void> {
    // At most one every 5 s; the rest wait for that.
    const wait = 5000 - (Date.now() - lastReport);
    if (wait > 0) {
      reportTimer ??= setTimeout(() => {
        reportTimer = null;
        void sendReport();
      }, wait);
      return;
    }
    lastReport = Date.now();
    const s = handle?.stats();
    const fps = diag.fps.length ? diag.fps : [0];
    try {
      await ctx.api.post("/api/world/report", {
        session,
        mode: !fallback.hidden ? "fallback" : demoTimer ? "demo" : "live",
        backend: s?.backend ?? "none",
        tier: s?.tier ?? String(tier ?? "?"),
        dpr: s?.dpr ?? 0,
        fps: { now: fps.at(-1)!, avg: Math.round(fps.reduce((a, b) => a + b, 0) / fps.length), min: Math.min(...fps) },
        frameMs: s?.frameMs ?? 0,
        drawCalls: s?.drawCalls ?? 0,
        shadows: s?.shadows ?? false,
        viewport: [innerWidth, innerHeight, devicePixelRatio],
        userAgent: navigator.userAgent.slice(0, 400),
        ...(diag.adapter ? { adapter: diag.adapter } : {}),
        restarts,
        experiments: model.experiments.length,
        events: diag.events,
      });
    } catch {
      /* a node without reports yet: nothing to do */
    }
  }
  // Errors and warnings while the world is open (three.js and the GPU speak through the console).
  const original = { warn: console.warn, error: console.error };
  const said = (args: unknown[]) => args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === "string" ? a : JSON.stringify(a)?.slice(0, 200))).join(" ");
  console.warn = (...args: unknown[]) => {
    note("warning", said(args));
    original.warn.apply(console, args);
  };
  console.error = (...args: unknown[]) => {
    note("error", said(args));
    original.error.apply(console, args);
  };
  scope.add(() => {
    console.warn = original.warn;
    console.error = original.error;
    if (reportTimer) clearTimeout(reportTimer);
    void sendReport();
  });
  scope.listen(window, "error", (e: ErrorEvent) => note("error", `${e.message} (${(e.filename || "").split("/").pop()}:${e.lineno})`));
  scope.listen(window, "unhandledrejection", (e: PromiseRejectionEvent) => note("error", `unhandled: ${e.reason instanceof Error ? e.reason.message : String(e.reason)}`));
  scope.interval(() => void sendReport(), 30_000);
  void (async () => {
    try {
      const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ info?: Record<string, string> } | null> } }).gpu;
      const info = (await gpu?.requestAdapter())?.info;
      if (info) diag.adapter = [info.vendor, info.architecture, info.device, info.description].filter(Boolean).join(" · ").slice(0, 300) || undefined;
    } catch {
      /* no adapter info here */
    }
  })();

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
          ...SITE_NAMES.map((site) =>
            h(
              "button",
              { class: "item item-button", type: "button", onclick: go(() => (setFollow(false), handle?.goTo({ kind: "site", site }))) },
              icon("compass", { size: 16 }),
              h("div", { class: "grow" }, h("div", { class: "strong small" }, SITES[site].label), h("div", { class: "meta" }, SITE_ABOUT[site])),
            ),
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
      m: () => setMap(!mapOn),
      // (Only while the sky's choices are open: Escape belongs to whatever else is.)
      ...(skyOpen ? { Escape: () => setSky(false) } : {}),
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
      if (loaded.WORLD_API !== WORLD_API) throw new Error("version");
      return loaded;
    } catch {
      showFallback("The SANDBOX was just updated. Reload the page to open it.", true);
      return null;
    }
  }

  function showFallback(message: string, reload = false): void {
    note("fallback", message);
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
        weather: weatherChoice === "live" ? "clear" : weatherChoice,
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
      const s = mounted.stats();
      note("start", `${s.backend} · ${s.tier} · dpr ${s.dpr}${restarts ? ` (restart ${restarts})` : ""}`);
      setTimeout(() => void sendReport(), 6000);
      handle.update(model, null);
      handle.select(selected);
      handle.setFollow(following);
      handle.setTimeOfDay(timeChoice === "now" ? null : timeChoice);
      applyWeather(true);
      showClock();
      updateBeacon();
      scope.add(() => handle?.dispose());
    } catch (error) {
      showFallback(`This device can't draw the world: ${errorMessage(error)}. Here is what's happening, in words.`);
    }
  }

  async function lostDevice(reason: string): Promise<void> {
    const was = handle?.stats();
    note("lost", `${reason} (${was?.backend ?? "?"} · ${was?.tier ?? "?"})`);
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
    note("restart", `restarting at ${tier}${forceWebGL ? " on WebGL2" : ""}`);
    toast("The 3D view restarted", { tone: "info", description: "The graphics device was reset; it's running at a lighter setting now." });
    await new Promise((resolve) => setTimeout(resolve, 800));
    await start();
  }

  // ---------- stats ----------
  scope.interval(() => {
    const s = handle?.stats();
    if (!s) return;
    stats.textContent = `${s.backend === "webgpu" ? "WebGPU" : "WebGL2"} · ${s.tier} · ${s.fps} fps`;
    if (document.visibilityState === "visible" && s.fps > 0) {
      diag.fps.push(s.fps);
      if (diag.fps.length > 30) diag.fps.shift();
      // Slow for three readings in a row (6 s): note it, at most once a minute.
      diag.slow = s.fps < 24 ? diag.slow + 1 : 0;
      if (diag.slow >= 3 && Date.now() - diag.lastSlowNote > 60_000) {
        diag.lastSlowNote = Date.now();
        note("slow", `${s.fps} fps, ${s.frameMs} ms a frame, dpr ${s.dpr}, ${s.drawCalls} draw calls, shadows ${s.shadows ? "on" : "off"}`);
      }
    }
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
