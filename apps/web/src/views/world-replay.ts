import type { Examination, ReadoutExamination, SavedExperiment } from "@galahad/core/experiments";
import { chartGeometry, chartX } from "../lib/charts.ts";
import { readoutsAt } from "../lib/replay.ts";
import { relativeTime } from "../lib/time.ts";
import { ENGINE_LABEL, experimentPlace, metricValue, STATUS_LABEL, STATUS_TONE } from "../lib/world.ts";
import { badge, button, callout, dot } from "../ui/controls.ts";
import { h } from "../ui/dom.ts";
import { icon } from "../ui/icons.ts";

/*
 * What an experiment showed, in its panel: the examination in words, then each readout as a small
 * stat tile (its label, its final value, its trend and range) over a sparkline of the whole run,
 * drawn in plain SVG in ink (danger only for a readout that ran away, always with the words). Hover
 * a sparkline for the value at that moment. And the replay's panel: marked as a replay, never live,
 * with play, pause and a scrubber, the readouts at the playhead and a playhead on every chart.
 */

const W = 300;
const H = 36;
const SVG = "http://www.w3.org/2000/svg";
const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

const TREND: Record<ReadoutExamination["trend"], string> = {
  steady: "held steady",
  rising: "rose",
  falling: "fell",
  peaked: "peaked",
  dipped: "dipped",
  oscillating: "oscillated",
  fluctuating: "varied",
};

const seconds = (t: number) => `${t < 100 ? t.toFixed(1) : Math.round(t)} s`;

export interface ExaminationView {
  readonly el: HTMLElement;
  /** The replay's playhead (simulation seconds), or null for none; values shown are then the playhead's. */
  setTime(t: number | null): void;
}

/** The examination: words, what's notable, and a tile with a sparkline per readout. */
export function examinationView(ex: Examination, options: { replay?: boolean } = {}): ExaminationView {
  const heads: { line: SVGLineElement; value: HTMLElement; r: ReadoutExamination; g: ReturnType<typeof chartGeometry> }[] = [];
  const tiles = ex.readouts.map((r) => {
    const g = chartGeometry(r.series, W, H);
    const danger = r.ranAway;
    const chart = svg("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", class: "readout-chart", role: "img", "aria-label": `${r.label} over the run: ${r.sentence}` });
    // A recessive baseline at the readout's lowest; the line in ink (danger when it ran away).
    chart.append(svg("line", { x1: 2, x2: W - 2, y1: H - 2, y2: H - 2, class: "readout-base" }));
    chart.append(svg("path", { d: g.path, class: danger ? "readout-line danger" : "readout-line", "vector-effect": "non-scaling-stroke" }));
    const head = svg("line", { x1: 0, x2: 0, y1: 0, y2: H, class: "readout-head", "vector-effect": "non-scaling-stroke" });
    head.style.display = "none";
    chart.append(head);
    const value = h("span", { class: "mono readout-value" }, metricValue(r.final));
    const tile = h(
      "div",
      { class: "readout" },
      h(
        "div",
        { class: "readout-top" },
        h("span", { class: "small strong grow ellipsis" }, r.label),
        danger ? badge("ran away", "danger", "alert") : null,
        value,
      ),
      chart,
      h("div", { class: "tiny muted readout-foot" }, `${TREND[r.trend]} · ${metricValue(r.min)} to ${metricValue(r.max)} · ${r.count} sample${r.count === 1 ? "" : "s"}`),
    );
    heads.push({ line: head, value, r, g });
    // Hover: the value at that moment (and back to the final, or the playhead's, on leaving).
    chart.addEventListener("pointermove", (event) => {
      const box = chart.getBoundingClientRect();
      const t = g.t0 + ((event.clientX - box.left) / Math.max(1, box.width)) * (g.t1 - g.t0);
      const at = readoutsAt({ ...ex, readouts: [r] }, t)[r.key];
      if (at !== undefined) value.textContent = `${metricValue(at)} at ${seconds(t)}`;
    });
    chart.addEventListener("pointerleave", () => view.setTime(playhead));
    return tile;
  });
  let playhead: number | null = null;
  const notable = ex.notable.filter((n) => !/^In its own words/.test(n));
  const el = h(
    "div",
    { class: "stack tight world-exam" },
    h("p", { class: "small" }, ex.words),
    notable.length && ex.status === "failed" ? callout("danger", notable.join(" "), { title: "Notable" }) : notable.length ? h("p", { class: "tiny muted" }, notable.join(" ")) : null,
    tiles.length ? h("div", { class: "readouts" }, ...tiles) : null,
    options.replay ? null : h("p", { class: "tiny subtle" }, "Hover a chart for the value at that moment."),
  );
  const view: ExaminationView = {
    el,
    setTime(t) {
      playhead = t;
      const at = t === null ? null : readoutsAt(ex, t);
      for (const { line, value, r, g } of heads) {
        if (t === null) {
          line.style.display = "none";
          value.textContent = metricValue(r.final);
          continue;
        }
        const x = String(chartX(g, t, W));
        line.setAttribute("x1", x);
        line.setAttribute("x2", x);
        line.style.display = "";
        if (at?.[r.key] !== undefined) value.textContent = metricValue(at[r.key]!);
      }
    },
  };
  return view;
}

export interface ReplayPanel {
  readonly el: HTMLElement;
  /** Where the playhead is, and whether it's playing (called a few times a second while it plays). */
  update(t: number, playing: boolean): void;
}

/** The replay's panel: built once, then only its playhead moves (a scrubber being dragged is never rebuilt under the finger). */
export function replayPanel(o: {
  saved: SavedExperiment;
  examination: Examination | null;
  t0: number;
  t1: number;
  rate: number;
  frames: number;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (t: number) => void;
  onClose: () => void;
}): ReplayPanel {
  const s = o.saved;
  let playing = true;
  const toggle = button("Pause", { iconOnly: true, icon: "pause", size: "sm", onClick: () => (playing ? o.onPause() : o.onPlay()) });
  const scrub = h("input", { type: "range", min: String(o.t0), max: String(Math.max(o.t1, o.t0 + 0.001)), step: "any", value: String(o.t0), "aria-label": "Scrub through the replay" }) as HTMLInputElement;
  let dragging = false;
  scrub.addEventListener("pointerdown", () => (dragging = true));
  scrub.addEventListener("pointerup", () => (dragging = false));
  scrub.addEventListener("input", () => o.onSeek(Number(scrub.value)));
  const range = h("div", { class: "range grow" }, scrub);
  const time = h("span", { class: "tiny mono tnum replay-time" });
  const exam = o.examination ? examinationView(o.examination, { replay: true }) : null;
  const facts = [
    `${ENGINE_LABEL[s.engine]} · ${STATUS_LABEL[s.status]}, tested ${experimentPlace(s)}`,
    `on ${s.nodeName}`,
    relativeTime(s.endedAt ?? s.startedAt),
    `${o.frames} frames${s.recording.thinned ? `, thinned to ${Math.round(s.recording.hz * 10) / 10}/s` : ""}`,
    o.rate !== 1 ? `${Math.round(o.rate * 10) / 10}× real time` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const el = h(
    "div",
    { class: "replay" },
    h(
      "div",
      { class: "card-head" },
      dot(STATUS_TONE[s.status], { label: STATUS_LABEL[s.status] }),
      h("h3", { class: "grow ellipsis" }, s.title),
      badge("Replay", "neutral", "repeat"),
      button("Close the replay", { iconOnly: true, icon: "x", size: "sm", variant: "ghost", onClick: o.onClose }),
    ),
    h(
      "div",
      { class: "card-body stack tight" },
      h("p", { class: "tiny muted world-facts" }, `${facts}. A recording, not live.`),
      h("div", { class: "replay-controls" }, toggle, range, time),
      o.frames ? null : h("p", { class: "small muted" }, "Nothing moved in its recording: its bodies stand as they were."),
      exam?.el ?? h("p", { class: "small muted" }, "It hasn't been examined."),
      s.summary ? callout(s.status === "failed" ? "danger" : "quiet", s.summary, { title: "How it ended" }) : null,
    ),
  );
  const panel: ReplayPanel = {
    el,
    update(t, isPlaying) {
      if (isPlaying !== playing) {
        playing = isPlaying;
        toggle.replaceChildren(icon(playing ? "pause" : "play", { size: 14 }));
        toggle.setAttribute("aria-label", playing ? "Pause" : o.t1 > o.t0 && t >= o.t1 ? "Play again" : "Play");
        toggle.title = toggle.getAttribute("aria-label")!;
      }
      if (!dragging) scrub.value = String(t);
      const span = o.t1 - o.t0;
      scrub.style.setProperty("--fill", `${span > 0 ? (((t - o.t0) / span) * 100).toFixed(1) : 0}%`);
      const label = `${seconds(t - o.t0)} / ${seconds(span)}`;
      if (time.textContent !== label) time.textContent = label;
      exam?.setTime(t);
    },
  };
  panel.update(o.t0, true);
  return panel;
}
