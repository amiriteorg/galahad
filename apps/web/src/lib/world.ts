import type {
  BodyShape,
  ExperimentEngine,
  ExperimentFrame,
  ExperimentStatus,
  ExperimentView,
  GalahadState,
  HeartbeatFinding,
  HeartbeatPlace,
  Pose,
  SceneBody,
  Station,
  WeatherKind,
  WorldEvent,
  WorldHeartbeat,
  WorldNode,
  WorldPartner,
  WorldWeather,
} from "@galahad/core/world";
import { HEARTBEAT_FINDINGS, MAX_PARTNERS, padAt, SITES, STATIONS } from "@galahad/core/world";

/*
 * The SANDBOX's model of the world, as the page keeps it: what Galahad is doing,
 * the fleet, every experiment with its last frame, and his latest thoughts. Events
 * from the node (GET /api/world) are read defensively at the boundary (a 3D
 * renderer must never be handed a million-vertex mesh or a NaN pose), then folded
 * in by a pure reducer. Pure, so unit-tested.
 */

export const MAX_THOUGHTS = 8;
/** Ended experiments stay on their plots, dimmed: this many of the most recent. */
export const MAX_ENDED = 12;

export interface WorldNotice {
  at: number;
  severity: "info" | "warn" | "error";
  title: string;
}

export interface WorldModel {
  /** The latest event's time (the node's clock, ms); 0 before the first. */
  at: number;
  galahad: GalahadState;
  nodes: WorldNode[];
  /** Running ones and the most recent ended ones, oldest first. */
  experiments: ExperimentView[];
  /** The last frame of each experiment, by id, with every body's latest pose (fixed bodies are posed once, in the first frame). */
  frames: Record<string, ExperimentFrame>;
  /** Newest last, at most MAX_THOUGHTS. */
  thoughts: string[];
  /** The latest notice, if any. */
  notice: WorldNotice | null;
  /** Denmark's weather now, as the node says (null: unknown, or turned off there). */
  weather: WorldWeather | null;
  /** His heartbeat (null: none yet, or an older node). */
  heartbeat: WorldHeartbeat | null;
  /** The agents working with him now. */
  partners: WorldPartner[];
}

export const emptyWorld = (): WorldModel => ({
  at: 0,
  galahad: { station: "keep", doing: "", experiment: null, model: null, since: 0 },
  nodes: [],
  experiments: [],
  frames: {},
  thoughts: [],
  notice: null,
  weather: null,
  heartbeat: null,
  partners: [],
});

const isEnded = (e: ExperimentView): boolean => e.status === "done" || e.status === "failed";

/** Keeps every running experiment and the MAX_ENDED most recently ended; drops frames of the rest. */
function prune(experiments: ExperimentView[], frames: Record<string, ExperimentFrame>): Pick<WorldModel, "experiments" | "frames"> {
  const ended = experiments.filter(isEnded).sort((a, b) => (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt));
  const dropped = new Set(ended.slice(MAX_ENDED).map((e) => e.id));
  const kept = dropped.size ? experiments.filter((e) => !dropped.has(e.id)) : experiments;
  const keptFrames: Record<string, ExperimentFrame> = {};
  for (const e of kept) if (frames[e.id]) keptFrames[e.id] = frames[e.id]!;
  return { experiments: kept, frames: keptFrames };
}

/**
 * Folds one event into the model. Returns the same object when the event changes
 * nothing (a frame for an unknown experiment, an event kind this page doesn't know),
 * so callers can skip work.
 */
export function applyWorldEvent(state: WorldModel, event: WorldEvent): WorldModel {
  const at = Math.max(state.at, event.at);
  switch (event.type) {
    case "hello": {
      const { experiments, frames } = prune(dedupe(event.experiments), state.frames);
      return {
        at,
        galahad: event.galahad,
        nodes: event.nodes,
        experiments,
        frames,
        thoughts: event.thoughts.slice(-MAX_THOUGHTS),
        notice: state.notice,
        weather: event.weather ?? null,
        heartbeat: event.heartbeat ?? null,
        partners: event.partners ?? [],
      };
    }
    case "galahad":
      return { ...state, at, galahad: event.galahad };
    case "thought": {
      const text = event.text.trim();
      if (!text) return state;
      return { ...state, at, thoughts: [...state.thoughts, text].slice(-MAX_THOUGHTS) };
    }
    case "experiment": {
      const i = state.experiments.findIndex((e) => e.id === event.experiment.id);
      const next = i < 0 ? [...state.experiments, event.experiment] : state.experiments.map((e, j) => (j === i ? event.experiment : e));
      return { ...state, at, ...prune(next, state.frames) };
    }
    case "frame": {
      const id = event.frame.experiment;
      const i = state.experiments.findIndex((e) => e.id === id);
      if (i < 0) return state;
      const metrics = event.frame.metrics;
      const experiments = metrics ? state.experiments.map((e, j) => (j === i ? { ...e, metrics: { ...e.metrics, ...metrics } } : e)) : state.experiments;
      // Fixed bodies are posed in the first frame only: keep every body's latest pose, not just this frame's.
      const poses = { ...state.frames[id]?.poses, ...event.frame.poses };
      return { ...state, at, experiments, frames: { ...state.frames, [id]: { ...event.frame, poses } } };
    }
    case "fleet":
      return { ...state, at, nodes: event.nodes };
    case "notice":
      return { ...state, at, notice: { at: event.at, severity: event.severity, title: event.title } };
    case "weather":
      return { ...state, at, weather: event.weather };
    case "heartbeat":
      return { ...state, at, heartbeat: event.heartbeat };
    case "partners":
      return { ...state, at, partners: event.partners };
    case "cleared": {
      if (!state.experiments.some((e) => e.id === event.experiment)) return state;
      const { [event.experiment]: _gone, ...frames } = state.frames;
      return { ...state, at, experiments: state.experiments.filter((e) => e.id !== event.experiment), frames };
    }
    default:
      return state;
  }
}

function dedupe(experiments: ExperimentView[]): ExperimentView[] {
  const byId = new Map<string, ExperimentView>();
  for (const e of experiments) byId.set(e.id, e);
  return [...byId.values()];
}

// ---------- reading events at the boundary ----------

const LIMITS = {
  id: 128,
  text: 500,
  bodies: 256,
  meshVertices: 20_000,
  meshTriangles: 40_000,
  metrics: 32,
  nodes: 256,
  experiments: 256,
  extent: 1e6,
} as const;

const STATION_NAMES = new Set<string>([...Object.keys(STATIONS), "field"]);
const ENGINES = new Set<string>(["mujoco", "gazebo", "isaac", "jsbsim", "rocketpy", "custom"]);
const STATUSES = new Set<string>(["starting", "running", "done", "failed"]);
const SEVERITIES = new Set<string>(["info", "warn", "error"]);
const WEATHER_KINDS = new Set<string>(["clear", "cloudy", "overcast", "mist", "drizzle", "rain", "snow", "storm"]);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const str = (v: unknown, max: number = LIMITS.text): v is string => typeof v === "string" && v.length <= max;
const id = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= LIMITS.id;
const nullable = <T>(v: unknown, check: (v: unknown) => v is T): v is T | null => v === null || check(v);
const size = (v: unknown): v is number => num(v) && v > 0 && v <= LIMITS.extent;
const vec = (v: unknown, n: number): v is number[] => Array.isArray(v) && v.length === n && v.every(size);

function readGalahad(v: unknown): GalahadState | null {
  if (!isObj(v) || !str(v.station, 32) || !str(v.doing) || !nullable(v.experiment, id) || !nullable(v.model, (m): m is string => str(m, 200)) || !num(v.since)) return null;
  // A station this page doesn't know yet: show him at his hall rather than drop the event.
  const station = (STATION_NAMES.has(v.station) ? v.station : "keep") as Station;
  const state: GalahadState = { station, doing: v.doing, experiment: v.experiment, model: v.model, since: v.since };
  if (v.idle === true) state.idle = true;
  return state;
}

const PLACES = new Set<string>(["keep", "node", "council", "forge", "messenger", "racks"]);
const FINDING_SEVERITIES = new Set<string>(["info", "warn", "alert"]);
const RUN_STATUSES = new Set<string>(["ok", "attention", "failed", "interrupted"]);
const count = (v: unknown): v is number => num(v) && Number.isInteger(v) && v >= 0 && v <= 10_000;

/** His heartbeat, checked: unknown fields are ignored, a place this page doesn't know is the keep; null if malformed. */
function readHeartbeat(v: unknown): WorldHeartbeat | null {
  if (!isObj(v) || !nullable(v.ran, num) || !(v.status === null || (typeof v.status === "string" && RUN_STATUSES.has(v.status)))) return null;
  const c = v.counts;
  if (!isObj(c) || !count(c.info) || !count(c.warn) || !count(c.alert) || typeof v.selfAction !== "boolean") return null;
  const findings = readList(v.findings, 64, (f): HeartbeatFinding | null => {
    if (!isObj(f) || !id(f.key) || typeof f.severity !== "string" || !FINDING_SEVERITIES.has(f.severity) || !str(f.title, 200) || !nullable(f.node, id)) return null;
    const place = (typeof f.place === "string" && PLACES.has(f.place) ? f.place : "keep") as HeartbeatPlace;
    return { key: f.key, severity: f.severity as HeartbeatFinding["severity"], title: f.title, place, node: place === "node" ? f.node : null };
  });
  const fixed = readList(v.fixed, 64, (t) => (str(t, 300) ? t : null));
  if (!findings || !fixed) return null;
  return {
    ran: v.ran,
    status: v.status as WorldHeartbeat["status"],
    counts: { info: c.info, warn: c.warn, alert: c.alert },
    findings: findings.slice(0, HEARTBEAT_FINDINGS),
    fixed: fixed.slice(0, HEARTBEAT_FINDINGS),
    selfAction: v.selfAction,
  };
}

/** A partner, checked: its name is an agent's label (lowercase letters, digits, . _ -). */
function readPartner(v: unknown): WorldPartner | null {
  if (!isObj(v) || typeof v.name !== "string" || !/^[a-z0-9][a-z0-9._-]{0,47}$/.test(v.name) || !str(v.station, 32) || !str(v.doing) || !num(v.since) || !num(v.last)) return null;
  const station = (STATION_NAMES.has(v.station) ? v.station : "keep") as Station;
  return { name: v.name, station, doing: v.doing, since: v.since, last: v.last };
}

function readNode(v: unknown): WorldNode | null {
  if (!isObj(v) || !id(v.id) || !str(v.name, 200) || (v.kind !== "node" && v.kind !== "client")) return null;
  if (typeof v.online !== "boolean" || typeof v.self !== "boolean" || typeof v.sandboxHost !== "boolean") return null;
  return { id: v.id, name: v.name, kind: v.kind, online: v.online, self: v.self, sandboxHost: v.sandboxHost };
}

function readShape(v: unknown): BodyShape | null {
  if (!isObj(v)) return null;
  switch (v.kind) {
    case "box":
      return vec(v.size, 3) ? { kind: "box", size: [v.size[0]!, v.size[1]!, v.size[2]!] } : null;
    case "sphere":
      return size(v.radius) ? { kind: "sphere", radius: v.radius } : null;
    case "capsule":
    case "cylinder":
      return size(v.radius) && size(v.length) ? { kind: v.kind, radius: v.radius, length: v.length } : null;
    case "plane":
      return vec(v.size, 2) ? { kind: "plane", size: [v.size[0]!, v.size[1]!] } : null;
    case "aircraft":
      return size(v.span) && size(v.length) ? { kind: "aircraft", span: v.span, length: v.length } : null;
    case "rocket":
      return size(v.radius) && size(v.length) ? { kind: "rocket", radius: v.radius, length: v.length } : null;
    case "mesh": {
      const { vertices, indices } = v;
      if (!Array.isArray(vertices) || !Array.isArray(indices)) return null;
      const count = vertices.length / 3;
      if (vertices.length % 3 || count > LIMITS.meshVertices || indices.length % 3 || indices.length / 3 > LIMITS.meshTriangles) return null;
      if (!vertices.every((x) => num(x) && Math.abs(x) <= LIMITS.extent)) return null;
      if (!indices.every((i) => Number.isInteger(i) && i >= 0 && i < count)) return null;
      return { kind: "mesh", vertices: vertices as number[], indices: indices as number[] };
    }
    default:
      return null;
  }
}

function readBody(v: unknown): SceneBody | null {
  if (!isObj(v) || !id(v.id)) return null;
  const shape = readShape(v.shape);
  if (!shape) return null;
  if (v.color !== undefined && !(typeof v.color === "string" && /^#[0-9a-fA-F]{6}$/.test(v.color))) return null;
  if (v.label !== undefined && !str(v.label, 200)) return null;
  const body: SceneBody = { id: v.id, shape };
  if (v.color !== undefined) body.color = v.color as string;
  if (v.fixed === true) body.fixed = true;
  if (v.label !== undefined) body.label = v.label as string;
  if (v.trail === true) body.trail = true;
  return body;
}

function readMetrics(v: unknown): Record<string, number> | null {
  if (!isObj(v)) return null;
  const entries = Object.entries(v);
  if (entries.length > LIMITS.metrics) return null;
  const out: Record<string, number> = {};
  for (const [key, value] of entries) {
    if (key.length > 64 || !num(value)) return null;
    out[key] = value;
  }
  return out;
}

function readExperiment(v: unknown): ExperimentView | null {
  if (!isObj(v) || !id(v.id) || !str(v.title, 200) || !str(v.engine, 32) || !str(v.status, 16) || !STATUSES.has(v.status)) return null;
  const plot = v.plot;
  if (!isObj(plot) || !num(plot.x) || !num(plot.y) || !size(plot.size) || Math.abs(plot.x) > LIMITS.extent || Math.abs(plot.y) > LIMITS.extent) return null;
  if (!num(v.scale) || v.scale <= 0 || v.scale > 1e3) return null;
  if (!Array.isArray(v.scene) || v.scene.length > LIMITS.bodies) return null;
  const scene: SceneBody[] = [];
  for (const b of v.scene) {
    const body = readBody(b);
    if (!body) return null;
    scene.push(body);
  }
  if (!num(v.startedAt) || !nullable(v.endedAt, num) || !str(v.nodeName, 200) || !nullable(v.sandbox, id) || !nullable(v.quest, (q): q is string => str(q, 200))) return null;
  const metrics = readMetrics(v.metrics);
  if (!metrics || !nullable(v.summary, (s): s is string => str(s))) return null;
  // An engine this page doesn't know yet is drawn like any other ("custom").
  const engine = (ENGINES.has(v.engine) ? v.engine : "custom") as ExperimentEngine;
  return {
    id: v.id,
    title: v.title,
    engine,
    status: v.status as ExperimentStatus,
    plot: { x: plot.x, y: plot.y, size: plot.size },
    scale: v.scale,
    scene,
    startedAt: v.startedAt,
    endedAt: v.endedAt,
    nodeName: v.nodeName,
    sandbox: v.sandbox,
    quest: v.quest,
    metrics,
    summary: v.summary,
  };
}

const isPose = (v: unknown): v is Pose => Array.isArray(v) && v.length === 7 && v.every((x) => num(x) && Math.abs(x) <= LIMITS.extent);

function readFrame(v: unknown): ExperimentFrame | null {
  if (!isObj(v) || !id(v.experiment) || !num(v.t) || !isObj(v.poses)) return null;
  const entries = Object.entries(v.poses);
  if (entries.length > LIMITS.bodies) return null;
  const poses: Record<string, Pose> = {};
  for (const [key, pose] of entries) {
    if (!id(key) || !isPose(pose)) return null;
    poses[key] = [pose[0], pose[1], pose[2], pose[3], pose[4], pose[5], pose[6]];
  }
  const frame: ExperimentFrame = { experiment: v.experiment, t: v.t, poses };
  if (v.metrics !== undefined) {
    const metrics = readMetrics(v.metrics);
    if (!metrics) return null;
    frame.metrics = metrics;
  }
  return frame;
}

function readList<T>(v: unknown, max: number, read: (v: unknown) => T | null): T[] | null {
  if (!Array.isArray(v) || v.length > max) return null;
  const out: T[] = [];
  for (const item of v) {
    const value = read(item);
    if (value === null) return null;
    out.push(value);
  }
  return out;
}

/**
 * One event from the stream, checked against the contract (packages/core/src/world.ts),
 * or null: malformed, out of bounds, or a kind this page doesn't know (ignored, so a
 * newer node can add kinds without breaking an older page).
 */
export function readWorldEvent(v: unknown): WorldEvent | null {
  if (!isObj(v) || !num(v.at)) return null;
  const at = v.at;
  switch (v.type) {
    case "hello": {
      const galahad = readGalahad(v.galahad);
      const nodes = readList(v.nodes, LIMITS.nodes, readNode);
      const experiments = readList(v.experiments, LIMITS.experiments, readExperiment);
      const thoughts = readList(v.thoughts, 64, (t) => (str(t) ? t : null));
      if (!(galahad && nodes && experiments && thoughts)) return null;
      // Weather, a heartbeat or partners it can't read are unknown: never a reason to lose the world.
      const hello: Extract<WorldEvent, { type: "hello" }> = { type: "hello", at, galahad, nodes, experiments, thoughts };
      if (v.weather !== undefined) hello.weather = readWeather(v.weather) ?? null;
      if (v.heartbeat !== undefined) hello.heartbeat = readHeartbeat(v.heartbeat);
      if (v.partners !== undefined) hello.partners = (readList(v.partners, 64, readPartner) ?? []).slice(-MAX_PARTNERS);
      return hello;
    }
    case "heartbeat": {
      if (v.heartbeat === null) return { type: "heartbeat", at, heartbeat: null };
      const heartbeat = readHeartbeat(v.heartbeat);
      return heartbeat ? { type: "heartbeat", at, heartbeat } : null;
    }
    case "partners": {
      const partners = readList(v.partners, 64, readPartner);
      return partners ? { type: "partners", at, partners: partners.slice(-MAX_PARTNERS) } : null;
    }
    case "galahad": {
      const galahad = readGalahad(v.galahad);
      return galahad ? { type: "galahad", at, galahad } : null;
    }
    case "thought":
      return str(v.text) ? { type: "thought", at, text: v.text } : null;
    case "experiment": {
      const experiment = readExperiment(v.experiment);
      return experiment ? { type: "experiment", at, experiment } : null;
    }
    case "frame": {
      const frame = readFrame(v.frame);
      return frame ? { type: "frame", at, frame } : null;
    }
    case "fleet": {
      const nodes = readList(v.nodes, LIMITS.nodes, readNode);
      return nodes ? { type: "fleet", at, nodes } : null;
    }
    case "notice":
      return typeof v.severity === "string" && SEVERITIES.has(v.severity) && str(v.title) ? { type: "notice", at, severity: v.severity as WorldNotice["severity"], title: v.title } : null;
    case "cleared":
      return id(v.experiment) ? { type: "cleared", at, experiment: v.experiment } : null;
    case "weather": {
      if (v.weather === null) return { type: "weather", at, weather: null };
      const weather = readWeather(v.weather);
      return weather === undefined ? null : { type: "weather", at, weather };
    }
    default:
      return null;
  }
}

/** Denmark's weather, checked: the weather, null for a kind this page doesn't know yet (shown as unknown), undefined if malformed. */
function readWeather(v: unknown): WorldWeather | null | undefined {
  if (!isObj(v)) return undefined;
  const { kind, cloud, precipitation, visibility, wind, windFrom, temperature, humidity, observed, place, source } = v;
  const unit = (x: unknown): x is number => num(x) && x >= 0 && x <= 1;
  const ok =
    typeof kind === "string" &&
    unit(cloud) &&
    unit(humidity) &&
    num(precipitation) &&
    precipitation >= 0 &&
    precipitation <= 500 &&
    (visibility === null || (num(visibility) && visibility >= 0)) &&
    num(wind) &&
    wind >= 0 &&
    wind <= 120 &&
    (windFrom === undefined || windFrom === null || (num(windFrom) && windFrom >= 0 && windFrom <= 360)) &&
    num(temperature) &&
    temperature >= -60 &&
    temperature <= 60 &&
    num(observed) &&
    str(place, 80) &&
    str(source, 80);
  if (!ok) return undefined;
  if (!WEATHER_KINDS.has(kind)) return null;
  const from = typeof windFrom === "number" ? { windFrom } : windFrom === null ? { windFrom: null } : {};
  return { kind: kind as WeatherKind, cloud, precipitation, visibility: visibility as number | null, wind, ...from, temperature, humidity, observed, place, source };
}

// ---------- words ----------

export const ENGINE_LABEL: Record<ExperimentEngine, string> = {
  mujoco: "MuJoCo",
  gazebo: "Gazebo",
  isaac: "Isaac",
  jsbsim: "JSBSim",
  rocketpy: "RocketPy",
  custom: "Custom",
};

export const STATUS_LABEL: Record<ExperimentStatus, string> = { starting: "Starting", running: "Running", done: "Done", failed: "Failed" };
export const STATUS_TONE: Record<ExperimentStatus, "warn" | "ok" | "neutral" | "danger"> = { starting: "warn", running: "ok", done: "neutral", failed: "danger" };

export const WEATHER_LABEL: Record<WeatherKind, string> = {
  clear: "Clear",
  cloudy: "Cloudy",
  overcast: "Overcast",
  mist: "Mist",
  drizzle: "Drizzle",
  rain: "Rain",
  snow: "Snow",
  storm: "Thunder",
};

export const weatherLabel = (w: WorldWeather): string => WEATHER_LABEL[w.kind];

export const stationLabel = (station: Station): string => (station === "field" ? "the field" : STATIONS[station].label);

/** Nothing to do: he lives his day. (An older node doesn't say; it rests him at the keep with "At the keep".) */
export const isIdle = (g: GalahadState): boolean => g.idle ?? (g.station === "keep" && (g.doing === "At the keep" || g.doing === ""));

const DANISH_CLOCK = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Copenhagen", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
/** "12:30", in Denmark, whatever the device's zone. */
export const danishClock = (ms: number): string => DANISH_CLOCK.format(ms);

/** What needs the owner enough for him to go to it: the most serious open finding that isn't only for information. */
export function heartbeatConcern(h: WorldHeartbeat | null): HeartbeatFinding | null {
  return h?.findings.find((f) => f.severity !== "info") ?? null;
}

/** His heartbeat in a few words: "Heartbeat ✓ 12:30", or what needs you ("Needs you: rack is offline", "+2 more"). */
export function heartbeatLine(h: WorldHeartbeat | null): string | null {
  if (!h) return null;
  const concern = heartbeatConcern(h);
  if (concern) {
    const more = h.counts.alert + h.counts.warn - 1;
    return `Needs you: ${concern.title}${more > 0 ? ` (+${more} more)` : ""}`;
  }
  if (h.ran === null) return "Heartbeat: not yet";
  return `Heartbeat ${h.status === "failed" ? "✗" : "✓"} ${danishClock(h.ran)}`;
}

/** Where an experiment stands, in words: "on the proving ground", "in the workshop", "on open land". */
export function experimentPlace(e: ExperimentView): string {
  const pad = padAt(e.plot);
  if (!pad) return "on open land";
  return pad.site === "hall" ? `in the ${SITES.hall.label.toLowerCase()}` : `on the ${SITES.field.label.toLowerCase()}`;
}

/** "altitude_m" → "altitude (m)", "speed_mps" → "speed (m/s)". */
export function metricLabel(key: string): string {
  const units: Record<string, string> = { m: "m", mps: "m/s", s: "s", kt: "kt", deg: "°", rad: "rad", n: "N", kn: "kN", kg: "kg", pct: "%", hz: "Hz", ms: "ms" };
  const match = key.match(/^(.*)_([a-z]+)$/);
  const unit = match ? units[match[2]!] : undefined;
  const name = (unit ? match![1]! : key).replace(/_/g, " ");
  return unit ? `${name} (${unit})` : name;
}

/** A readout with sensible precision: 1 234, 12.3, 0.0123. */
export function metricValue(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1000) return Math.round(value).toLocaleString("en-US").replace(/,/g, " ");
  if (abs >= 100) return value.toFixed(0);
  if (abs >= 10) return value.toFixed(1);
  if (abs >= 0.01 || abs === 0) return value.toFixed(2);
  return value.toExponential(1);
}

/**
 * What a screen reader hears: what Galahad is doing, and each experiment with its
 * status. Changes only when those do (never with poses or readouts), so it can sit
 * in a polite live region.
 */
export function worldSummary(model: WorldModel): string {
  const g = model.galahad;
  const where = g.station === "field" ? `out at ${model.experiments.find((e) => e.id === g.experiment)?.title ?? "an experiment"}` : `at ${stationLabel(g.station)}`;
  const parts = [`Galahad is ${where}${g.doing ? `: ${g.doing}` : ""}.`];
  if (g.model) parts.push(`Thinking with ${g.model}.`);
  if (model.weather) parts.push(`In ${model.weather.place}: ${weatherLabel(model.weather).toLowerCase()}, ${Math.round(model.weather.temperature)} °C.`);
  const heart = heartbeatLine(model.heartbeat);
  if (heart) parts.push(`${heart}.`);
  if (model.partners.length) parts.push(`With him: ${model.partners.map((p) => p.name).join(", ")}.`);
  const running = model.experiments.filter((e) => !isEnded(e));
  const ended = model.experiments.filter(isEnded);
  if (!model.experiments.length) parts.push("No experiments.");
  else {
    parts.push(`${model.experiments.length} experiment${model.experiments.length === 1 ? "" : "s"}${ended.length ? `, ${ended.length} ended` : ""}:`);
    for (const e of [...running, ...ended]) parts.push(`${e.title} (${ENGINE_LABEL[e.engine]}), ${STATUS_LABEL[e.status].toLowerCase()} ${experimentPlace(e)}, on ${e.nodeName}${e.summary && isEnded(e) ? `: ${e.summary}` : ""}.`);
  }
  return parts.join(" ");
}

export const experimentEnded = isEnded;

// ---------- the stream, kept open ----------

export type StreamStatus = "connecting" | "live" | "reconnecting" | "unavailable";

export interface FollowOptions {
  /** Opens the stream: yields parsed JSON frames, ends or throws when it drops. */
  open(signal: AbortSignal): AsyncIterable<unknown>;
  onEvent(event: WorldEvent): void;
  onStatus(status: StreamStatus): void;
  /** True when the node doesn't have the world yet (404 and friends). */
  unavailable(error: unknown): boolean;
  signal: AbortSignal;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Backoff after a drop: 1 s doubling to this; how long to wait before asking an unavailable node again. */
  maxBackoffMs?: number;
  unavailableRetryMs?: number;
}

const abortableSleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });

/** The backoff before reconnect attempt n (0-based): 1 s, 2 s, 4 s… up to max. */
export const backoffMs = (attempt: number, max = 30_000): number => Math.min(max, 1000 * 2 ** Math.min(attempt, 16));

/**
 * Keeps the world stream open until `signal` aborts: reconnects with backoff when it
 * drops (a successful hello resets the backoff), and when the node doesn't serve the
 * world yet, says so and asks again now and then.
 */
export async function followWorld(options: FollowOptions): Promise<void> {
  const sleep = options.sleep ?? abortableSleep;
  const { signal } = options;
  let attempt = 0;
  let status: StreamStatus | null = null;
  const say = (next: StreamStatus) => {
    if (next !== status) options.onStatus((status = next));
  };
  say("connecting");
  while (!signal.aborted) {
    try {
      for await (const raw of options.open(signal)) {
        const event = readWorldEvent(raw);
        if (!event) continue;
        if (event.type === "hello") {
          attempt = 0;
          say("live");
        }
        if (status === "live") options.onEvent(event);
      }
    } catch (error) {
      if (signal.aborted) return;
      if (options.unavailable(error)) {
        say("unavailable");
        await sleep(options.unavailableRetryMs ?? 60_000, signal);
        continue;
      }
    }
    if (signal.aborted) return;
    if (status !== "unavailable") say("reconnecting");
    await sleep(backoffMs(attempt++, options.maxBackoffMs), signal);
  }
}
