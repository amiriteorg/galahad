import { padAt, phaseOf, type SiteName, SITE_NAMES, SITES, type Station, STATIONS } from "@galahad/core/world";
import { BENCH_AREA, CAMP } from "../world/hearth-plan.ts";
import { relativeTime } from "./time.ts";
import { ENGINE_LABEL, experimentEnded, experimentPlace, heartbeatLine, isIdle, PHASE_LABEL, STATUS_LABEL, STATUS_TONE, stationLabel, type WorldModel } from "./world.ts";

/*
 * The SANDBOX's one selector: what the view is looking at, in a few words, and
 * everything it can look at instead (Galahad, his dog, the chalkboard, his
 * journal, the experiments, the saved ones to replay, his partners: the agents
 * working with him and the fleet's nodes, the two test sites, his hearth, the
 * bench by the lake and the keep's stations), ranked and searchable. Pure, so
 * unit-tested; the view draws it (views/world-look.ts).
 */

export type LookTarget =
  | { kind: "galahad" }
  | { kind: "experiment"; id: string }
  /** A saved experiment: picking it replays it where it was tested. */
  | { kind: "saved"; id: string }
  | { kind: "site"; site: SiteName }
  | { kind: "station"; station: Exclude<Station, "field"> }
  /** The chalkboard at the observatory: it opens, to draw on. */
  | { kind: "board" }
  /** His dog, wherever it is. */
  | { kind: "dog" }
  /** His journal: it opens, to read. */
  | { kind: "journal" }
  /** A place of his own: his hearth south of the keep, the bench by the lake. */
  | { kind: "place"; place: HisPlace }
  /** An agent working with him (its figure in the world), or one of the fleet's nodes (its spot at the keep). */
  | { kind: "partner"; name: string }
  | { kind: "node"; id: string };

export type LookGroup = "Galahad" | "Experiments" | "Saved experiments" | "Partners" | "Test sites" | "The keep";

export type HisPlace = "hearth" | "bench";

/** His own places: where they are, what they're called, what they're for, and what of his day happens there. */
export const HIS_PLACES: Record<HisPlace, { x: number; y: number; near: number; label: string; meta: string; life: RegExp }> = {
  hearth: { x: CAMP.x, y: CAMP.y, near: 7, label: "His hearth", meta: "His bed, the fire, his desk and journal, the dog's bed", life: /hearth|fire|journal|turning in|woken|bed to charge/i },
  bench: { x: BENCH_AREA.x, y: BENCH_AREA.y, near: 6, label: "The bench by the lake", meta: "Where he sits and thinks", life: /by the lake/i },
};

/** His dog, as the selector says it: its name (once it has one), what it's doing, its battery (0..1). */
export interface DogLook {
  name: string;
  state: string;
  charge: number;
}

/** The dog's line: "Lying by him · battery 82 %". */
export const dogLine = (dog: DogLook): string => `${dog.state.charAt(0).toUpperCase()}${dog.state.slice(1)} · battery ${Math.round(Math.max(0, Math.min(1, dog.charge)) * 100)} %`;

export interface LookOption {
  key: string;
  target: LookTarget;
  group: LookGroup;
  label: string;
  meta: string;
  icon: "user" | "flask" | "compass" | "landscape" | "board" | "play-circle" | "code" | "server" | "paw" | "journal" | "flame";
  /** A status dot (experiments). */
  tone?: "ok" | "warn" | "neutral" | "danger";
  live?: boolean;
  /** Galahad is there now, or it's what the view is on. */
  here?: boolean;
  /** What he's doing with it, when he's at it: "building", "watching", "examining". */
  hereText?: string;
}

/** What each test site is for, in a line. */
export const SITE_ABOUT: Record<SiteName, string> = {
  field: "Aircraft, rockets and rovers: the runway, the launch pad, the course",
  hall: "Robots, assemblies and machines, indoors",
};

const fold = (s: string): string => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** True when every word of the query starts a word of the text ("prov gr" finds "Proving ground"). */
export function matches(text: string, query: string): boolean {
  const words = fold(query).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (!words.length) return true;
  const have = fold(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return words.every((w) => have.some((h) => h.startsWith(w)));
}

/** "Saved experiments" shows this many before a search narrows them (the node's hello offers up to 24). */
export const SAVED_SHOWN = 8;

/**
 * His line: what he's doing (his work, or with nothing to do the part of his day the world shows, `life`), and
 * his heartbeat ("Walking the dog · Heartbeat ✓ 12:30", "Needs you: rack is offline").
 */
export function galahadLine(model: WorldModel, life = ""): string {
  const g = model.galahad;
  const doing = isIdle(g) ? life || g.doing || "At the keep" : g.doing || `At ${stationLabel(g.station).toLowerCase()}`;
  const heart = heartbeatLine(model.heartbeat, doing);
  return heart ? `${doing} · ${heart}` : doing;
}

/**
 * Everything the view can look at, in the order it's offered: Galahad, his dog, the
 * chalkboard and his journal; the experiments (running ones first, then those that
 * ended, newest first); the saved ones to replay (newest first; the most recent few,
 * or every match of a search); his partners (the agents with him, then the fleet's
 * nodes); the test sites; his hearth, the bench by the lake and the keep's stations,
 * the one he's at marked. Filtered by `query`.
 */
export function lookOptions(model: WorldModel, query = "", life = "", now = Date.now(), dog: DogLook | null = null): LookOption[] {
  const g = model.galahad;
  const idle = isIdle(g);
  const out: LookOption[] = [
    { key: "galahad", target: { kind: "galahad" }, group: "Galahad", label: "Galahad", meta: galahadLine(model, life), icon: "user" },
    // His dog: by its name once it has one.
    { key: "dog", target: { kind: "dog" }, group: "Galahad", label: dog?.name || "His dog", meta: dog ? dogLine(dog) : "Always with him", icon: "paw" },
    // The board you share: it opens to draw on.
    { key: "board", target: { kind: "board" }, group: "Galahad", label: "Chalkboard", meta: "At the observatory: draw on it, read what he wrote", icon: "board" },
    // What he wrote of each day: it opens to read.
    { key: "journal", target: { kind: "journal" }, group: "Galahad", label: "His journal", meta: "What he wrote of each day, every evening at his desk", icon: "journal" },
  ];
  const time = (e: (typeof model.experiments)[number]) => e.endedAt ?? e.startedAt;
  const experiments = [...model.experiments].sort((a, b) => Number(experimentEnded(a)) - Number(experimentEnded(b)) || time(b) - time(a));
  for (const e of experiments) {
    out.push({
      key: `exp:${e.id}`,
      target: { kind: "experiment", id: e.id },
      group: "Experiments",
      label: e.title,
      meta: `${ENGINE_LABEL[e.engine]} · ${phaseOf(e) === "building" || phaseOf(e) === "examining" ? PHASE_LABEL[phaseOf(e)] : `${STATUS_LABEL[e.status]} ${experimentPlace(e)}`}`,
      icon: "flask",
      tone: STATUS_TONE[e.status],
      live: e.status === "running",
      here: g.experiment === e.id && (g.station === "field" || g.station === "observatory"),
      hereText: phaseOf(e) === "building" ? "building" : phaseOf(e) === "examining" ? "examining" : "watching",
    });
  }
  const searching = Boolean(query.trim());
  for (const s of searching ? model.saved : model.saved.slice(0, SAVED_SHOWN)) {
    const place = experimentPlace(s);
    out.push({
      key: `saved:${s.id}`,
      target: { kind: "saved", id: s.id },
      group: "Saved experiments",
      label: s.title,
      meta: `Replay · ${ENGINE_LABEL[s.engine]} · ${STATUS_LABEL[s.status]} ${place} · ${relativeTime(s.endedAt ?? s.startedAt, now)}`,
      icon: "play-circle",
      tone: s.status === "failed" ? "danger" : undefined,
    });
  }
  for (const p of model.partners) {
    out.push({ key: `partner:${p.name}`, target: { kind: "partner", name: p.name }, group: "Partners", label: p.name, meta: p.doing || `At ${stationLabel(p.station).toLowerCase()}`, icon: "code", tone: "ok", live: true, here: g.station === p.station });
  }
  for (const n of model.nodes) {
    if (n.kind !== "node") continue;
    out.push({
      key: `node:${n.id}`,
      target: { kind: "node", id: n.id },
      group: "Partners",
      label: n.name,
      meta: `${n.online ? "Online" : "Silent"}${n.sandboxHost ? " · sandboxes" : ""}${n.self ? " · this node" : ""}`,
      icon: "server",
      tone: n.online ? "ok" : "danger",
    });
  }
  const at = g.station === "field" ? model.experiments.find((e) => e.id === g.experiment) : undefined;
  const atPad = at ? padAt(at.plot) : null;
  for (const site of SITE_NAMES) {
    out.push({ key: `site:${site}`, target: { kind: "site", site }, group: "Test sites", label: SITES[site].label, meta: SITE_ABOUT[site], icon: "landscape", here: atPad?.site === site });
  }
  for (const [place, p] of Object.entries(HIS_PLACES) as [HisPlace, (typeof HIS_PLACES)[HisPlace]][]) {
    out.push({ key: `place:${place}`, target: { kind: "place", place }, group: "The keep", label: p.label, meta: p.meta, icon: place === "hearth" ? "flame" : "landscape", here: idle && p.life.test(life) });
  }
  for (const [id, s] of Object.entries(STATIONS) as [Exclude<Station, "field">, { label: string }][]) {
    // (With no work he's wherever his day has him, not at the keep the stream leaves him at.)
    const here = g.station === id && !(idle && life);
    out.push({ key: `station:${id}`, target: { kind: "station", station: id }, group: "The keep", label: s.label, meta: here ? "Galahad is here" : "", icon: "compass", here });
  }
  return searching ? out.filter((o) => matches(`${o.label} ${o.meta} ${o.group}`, query)) : out;
}

/** Within this of a station's centre, the view is "at" it (metres). */
const NEAR_STATION = 14;

/**
 * What the view is on, in a label and a line: the experiment open in the panel; Galahad,
 * when following him; otherwise whatever the camera's focus is over (an experiment's plot,
 * a test site, a station of the keep), or "Exploring".
 */
export function lookingAt(model: WorldModel, focus: { x: number; y: number }, following: boolean, selected: string | null, life = ""): { label: string; meta: string; target: LookTarget | null } {
  const open = selected ? model.experiments.find((e) => e.id === selected) : undefined;
  /** Its status, or where it is when that says more (being built, being examined). */
  const said = (e: (typeof model.experiments)[number]) => (phaseOf(e) === "building" || phaseOf(e) === "examining" ? PHASE_LABEL[phaseOf(e)] : STATUS_LABEL[e.status]);
  if (open) return { label: open.title, meta: said(open), target: { kind: "experiment", id: open.id } };
  if (following) return { label: "Galahad", meta: galahadLine(model, life), target: { kind: "galahad" } };
  for (const e of model.experiments) {
    if (Math.abs(focus.x - e.plot.x) <= e.plot.size / 2 + 2 && Math.abs(focus.y - e.plot.y) <= e.plot.size / 2 + 2) {
      return { label: e.title, meta: said(e), target: { kind: "experiment", id: e.id } };
    }
  }
  for (const site of SITE_NAMES) {
    const s = SITES[site];
    if (Math.abs(focus.x - s.x) <= s.w / 2 && Math.abs(focus.y - s.y) <= s.d / 2) return { label: s.label, meta: "", target: { kind: "site", site } };
  }
  for (const [place, p] of Object.entries(HIS_PLACES) as [HisPlace, (typeof HIS_PLACES)[HisPlace]][]) {
    if (Math.hypot(focus.x - p.x, focus.y - p.y) < p.near) return { label: p.label, meta: "", target: { kind: "place", place } };
  }
  let best: { id: Exclude<Station, "field">; d: number } | null = null;
  for (const [id, s] of Object.entries(STATIONS) as [Exclude<Station, "field">, { x: number; y: number }][]) {
    const d = Math.hypot(focus.x - s.x, focus.y - s.y);
    if (d < NEAR_STATION && (!best || d < best.d)) best = { id, d };
  }
  if (best) return { label: STATIONS[best.id].label, meta: "", target: { kind: "station", station: best.id } };
  return { label: "Exploring", meta: "", target: null };
}

/** How many experiments are running or starting. */
export const runningCount = (model: WorldModel): number => model.experiments.filter((e) => !experimentEnded(e)).length;
