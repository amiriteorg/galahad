import type { TrialRunsView, TrialView } from "@galahad/core";
import { effortReport } from "@galahad/core/galahad-index";
import { isUnavailable } from "../api.ts";
import type { Ctx, View } from "../context.ts";
import { plural } from "../lib/text.ts";
import { absoluteTime, relativeTime } from "../lib/time.ts";
import { byProblem, durationLabel, groupRuns, type Mark, markOf, numberLabel, offBy, percent, type RunSummary } from "../lib/trials.ts";
import { badge, button, callout, copyField, empty, errorState, meter, pageHead, section, skeletonBlock, skeletonRows, statTile, type Tone } from "../ui/controls.ts";
import { openSheet } from "../ui/dialog.ts";
import { h, keepPlace, replace } from "../ui/dom.ts";
import { icon } from "../ui/icons.ts";

/*
 * Trials: problems with exact answers, posed with fresh random parameters, solved
 * in the Lab as ordinary quests, and graded by a program on the node, never by a
 * model. Here: the Galahad Index per run, each problem over every run, and every
 * answer beside the exact one. Runs start from a terminal (`galahad trial run`).
 * When runs were made at more than one effort, the Index per effort level says, with
 * its interval, whether more compute made him more capable (and says so when it didn't).
 */

const MARK: Record<Mark, { label: string; tone: Tone }> = {
  solved: { label: "Solved", tone: "ok" },
  partial: { label: "Partly", tone: "warn" },
  missed: { label: "Missed", tone: "danger" },
  crashed: { label: "Crashed", tone: "neutral" },
};

const scoreTone = (x: number) => (x >= 0.9 ? "var(--ok)" : x >= 0.6 ? "var(--warn)" : "var(--danger)");

function openTrial(ctx: Ctx, t: TrialView): void {
  const mark = MARK[markOf(t)];
  const passed = t.answers.filter((a) => a.ok).length;
  const answers = h(
    "div",
    { class: "rows" },
    ...t.answers.map((a) =>
      h(
        "div",
        { class: "item" },
        h(
          "div",
          { class: "grow", style: "min-width:0" },
          h("div", { class: "row wrap" }, h("span", { class: "mono strong small" }, a.key), h("span", { class: "tiny subtle" }, a.units)),
          h(
            "div",
            { class: "meta tnum" },
            h("span", {}, "got ", h("span", { class: "mono" }, numberLabel(a.got))),
            h("span", {}, "exact ", h("span", { class: "mono" }, numberLabel(a.expected)), " ± ", h("span", { class: "mono" }, numberLabel(a.tolerance))),
          ),
        ),
        badge(offBy(a), a.ok ? "ok" : "danger", a.ok ? "check" : "x"),
      ),
    ),
  );
  const facts: [string, string][] = [
    ["Domain", t.domain],
    ["Seed", String(t.seed)],
    ["Run", t.run],
    ["Revision", t.version],
    ["Models", t.models.join(", ") || "—"],
    ["Quest", t.quest ? `${t.quest.status}, ${plural(t.quest.steps, "command")}, ${plural(t.quest.revisions, "revision")}` : "—"],
    ["Took", durationLabel(t.seconds)],
    ["Recorded", `${absoluteTime(t.recordedAt)} on ${t.nodeName}`],
  ];
  const body = h(
    "div",
    { class: "stack" },
    h("div", { class: "row wrap" }, badge(mark.label, mark.tone), t.status === "scored" ? h("span", { class: "small muted tnum" }, `${passed} of ${t.answers.length} answers within tolerance`) : null),
    t.note ? callout(t.status === "crashed" ? "warn" : "quiet", t.note, { title: t.status === "crashed" ? "The run itself failed, so it isn't counted" : undefined }) : null,
    answers,
    h("dl", { class: "kv" }, ...facts.flatMap(([k, v]) => [h("dt", {}, k), h("dd", { class: k === "Revision" || k === "Run" ? "mono" : null }, v)])),
    h("p", { class: "tiny subtle" }, "Graded by a program against the exact solution. The same seed poses exactly this problem again."),
    t.artifact
      ? h(
          "div",
          { class: "row", style: "justify-content:flex-end" },
          button("Open its work", {
            icon: "archive",
            onClick: () => {
              sheet.close();
              ctx.navigate("artifacts", { intent: t.artifact! });
            },
          }),
        )
      : null,
  );
  const sheet = openSheet({ title: t.title, description: `Trial ${t.problem}`, body });
}

function trialRow(ctx: Ctx, t: TrialView): HTMLElement {
  const mark = MARK[markOf(t)];
  const passed = t.answers.filter((a) => a.ok).length;
  return h(
    "button",
    { class: "item item-button", type: "button", "data-key": t.id, "aria-label": `${t.title}: ${mark.label}`, onclick: () => openTrial(ctx, t) },
    h("span", { class: "avatar" }, icon(t.status === "crashed" ? "alert" : t.score === 1 ? "check" : "x", { size: 14 })),
    h(
      "div",
      { class: "grow", style: "min-width:0" },
      h("div", { class: "row wrap" }, h("span", { class: "strong small" }, t.title), badge(mark.label, mark.tone)),
      h(
        "div",
        { class: "meta tnum" },
        h("span", {}, t.domain),
        t.status === "scored" ? h("span", {}, `${passed}/${t.answers.length} answers`) : null,
        h("span", {}, durationLabel(t.seconds)),
        h("span", {}, `seed ${t.seed}`),
      ),
    ),
    icon("chevron-right", { size: 16, class: "subtle" }),
  );
}

function openRun(ctx: Ctx, r: RunSummary): void {
  const body = h(
    "div",
    { class: "stack" },
    h(
      "div",
      { class: "stack tight" },
      h("div", { class: "row wrap between" }, h("span", { class: "strong" }, `Galahad Index ${percent(r.index.mean)}`), h("span", { class: "small muted tnum" }, `90% interval ${percent(r.index.low)}–${percent(r.index.high)}`)),
      meter(r.index.mean, scoreTone(r.index.mean), "Galahad Index"),
      h("p", { class: "small muted" }, `${r.solved} of ${r.index.n} solved outright${r.crashed ? `; ${plural(r.crashed, "trial")} crashed and ${r.crashed === 1 ? "isn't" : "aren't"} counted` : ""}. Revision `, h("span", { class: "mono" }, r.version), ` on ${r.nodeName}.`),
    ),
    h("div", { class: "rows" }, ...r.trials.map((t) => trialRow(ctx, t))),
  );
  openSheet({ title: `Run ${r.run}`, description: `${r.suite} · ${absoluteTime(r.startedAt)}`, body });
}

export const trialsView: View = (root, ctx, { scope }) => {
  const stats = h("div", { class: "grid stats" }, skeletonBlock(92), skeletonBlock(92), skeletonBlock(92));
  const runsBox = h("div", { class: "card" }, skeletonRows(3, { avatar: true }));
  const problemsBox = h("div", { class: "card" }, skeletonRows(4, { avatar: true }));
  const content = h("div", { class: "stack" });
  /** Each run's effort (attempts per trial), for the runs that recorded one. */
  let efforts: Record<string, number> = {};

  /** The Index per effort level, with the verdict: did more compute help? Null when no run spent more than one attempt. */
  function effortSection(trials: readonly TrialView[]): HTMLElement | null {
    if (!Object.values(efforts).some((e) => e > 1)) return null;
    const report = effortReport(trials, efforts);
    return section(
      "By effort",
      { count: "attempts per trial" },
      h(
        "div",
        { class: "card" },
        h(
          "div",
          { class: "rows" },
          ...report.levels.map((l) =>
            h(
              "div",
              { class: "item" },
              h("span", { class: "avatar tnum strong" }, String(l.effort)),
              h(
                "div",
                { class: "grow stack tight", style: "min-width:0" },
                h("div", { class: "row wrap" }, h("span", { class: "strong small tnum" }, `Index ${percent(l.mean)}`), h("span", { class: "tiny subtle tnum" }, `${percent(l.low)}–${percent(l.high)}`)),
                meter(l.mean, scoreTone(l.mean), `Galahad Index at effort ${l.effort}`),
                h("div", { class: "meta tnum" }, h("span", {}, l.effort === 1 ? "one attempt a trial" : `${l.effort} attempts a trial`), h("span", {}, plural(l.n, "trial")), h("span", {}, plural(l.runs, "run"))),
              ),
            ),
          ),
        ),
      ),
      callout(report.helps ? "ok" : "quiet", report.verdict, { title: report.helps ? "More compute made him more capable" : report.helps === false ? "More compute didn't measurably help" : "Not compared yet", icon: "gauge" }),
      h("p", { class: "tiny subtle" }, "With effort, each trial makes that many attempts; the independent reviewer takes one on the evidence before anything is graded, and only that one's answers count."),
    );
  }

  function runRow(r: RunSummary): HTMLElement {
    return h(
      "button",
      { class: "item item-button", type: "button", "data-key": r.run, "aria-label": `Run ${r.run}: Index ${percent(r.index.mean)}`, onclick: () => openRun(ctx, r) },
      h("span", { class: "avatar" }, icon("gauge", { size: 14 })),
      h(
        "div",
        { class: "grow stack tight", style: "min-width:0" },
        h("div", { class: "row wrap" }, h("span", { class: "strong small tnum" }, `Index ${percent(r.index.mean)}`), h("span", { class: "tiny subtle tnum" }, `${percent(r.index.low)}–${percent(r.index.high)}`), efforts[r.run] ? badge(`effort ${efforts[r.run]}`, efforts[r.run]! > 1 ? "accent" : "neutral") : null, r.crashed ? badge(`${r.crashed} crashed`, "neutral") : null),
        meter(r.index.mean, scoreTone(r.index.mean)),
        h(
          "div",
          { class: "meta tnum" },
          h("span", { title: absoluteTime(r.startedAt) }, relativeTime(r.startedAt)),
          h("span", {}, `${r.solved}/${r.index.n} solved`),
          h("span", { class: "mono" }, r.version),
          r.models.length ? h("span", { class: "wrap-anywhere" }, r.models.join(", ")) : null,
        ),
      ),
      icon("chevron-right", { size: 16, class: "subtle" }),
    );
  }

  async function refresh(): Promise<void> {
    try {
      const { trials, runs: settings = {} } = await ctx.api.get<{ trials: TrialView[]; runs?: TrialRunsView }>("/api/trials", scope.signal);
      if (scope.disposed) return;
      efforts = Object.fromEntries(Object.entries(settings).map(([run, s]) => [run, s.effort]));
      if (!trials.length) {
        replace(
          content,
          empty({
            icon: "gauge",
            title: "No trials yet",
            body: h(
              "div",
              { class: "stack tight" },
              h("p", {}, "Fourteen mathematics, physics and engineering problems with exact answers, each posed with fresh random parameters. Start a run from a terminal on a node; each problem takes a few minutes in the Lab."),
              copyField("galahad trial run"),
            ),
          }),
        );
        return;
      }
      const runs = groupRuns(trials);
      const latest = runs[0]!;
      replace(
        content,
        stats,
        effortSection(trials),
        section("Runs", { count: plural(runs.length, "run") }, runsBox),
        section("By problem", { count: "every run" }, problemsBox),
      );
      replace(
        stats,
        statTile({
          label: "Galahad Index",
          icon: "gauge",
          value: percent(latest.index.mean),
          note: `latest run · 90% interval ${percent(latest.index.low)}–${percent(latest.index.high)}`,
        }),
        statTile({ label: "Solved", icon: "check", value: `${latest.solved}/${latest.index.n}`, note: latest.crashed ? `${latest.crashed} crashed, not counted` : "outright, in the latest run" }),
        statTile({ label: "Revision", icon: "code", value: h("span", { class: "mono" }, latest.version.slice(0, 12)), note: latest.models.join(", ") || "models unknown" }),
      );
      keepPlace(runsBox, () => replace(runsBox, h("div", { class: "rows" }, ...runs.map(runRow))));
      keepPlace(problemsBox, () =>
        replace(
          problemsBox,
          h(
            "div",
            { class: "rows" },
            ...byProblem(trials).map((p) =>
              h(
                "button",
                { class: "item item-button", type: "button", "data-key": p.problem, "aria-label": `${p.title}: ${p.solved} of ${p.tries} solved`, onclick: () => openTrial(ctx, p.latest) },
                h("span", { class: "avatar" }, icon(p.solved === p.tries ? "check" : p.solved ? "minus" : "x", { size: 14 })),
                h(
                  "div",
                  { class: "grow stack tight", style: "min-width:0" },
                  h("div", { class: "row wrap" }, h("span", { class: "strong small" }, p.title), h("span", { class: "tiny subtle" }, p.domain)),
                  meter(p.mean, scoreTone(p.mean)),
                  h("div", { class: "meta tnum" }, h("span", {}, `${p.solved} of ${plural(p.tries, "try", "tries")} solved`), h("span", {}, `mean ${percent(p.mean)}`), h("span", {}, `latest ${relativeTime(p.latest.recordedAt)}`)),
                ),
                icon("chevron-right", { size: 16, class: "subtle" }),
              ),
            ),
          ),
        ),
      );
    } catch (error) {
      if (scope.disposed) return;
      replace(
        content,
        isUnavailable(error)
          ? empty({ icon: "gauge", title: "Trials aren't available on this node yet", body: "They arrive with an update: problems with exact answers, graded by a program.", compact: true })
          : errorState("Couldn't load trials", error, () => void refresh()),
      );
    }
  }

  replace(
    root,
    h(
      "div",
      { class: "page narrow" },
      pageHead(
        "Trials",
        "Is Galahad getting better? Problems with exact answers, posed with fresh random parameters, solved in the Lab and graded by a program, never a model. The Galahad Index is a run's mean score, with its 90% interval.",
      ),
      content,
    ),
  );
  replace(content, stats, section("Runs", {}, runsBox), section("By problem", {}, problemsBox));
  scope.interval(() => void refresh(), 30_000);
  void refresh();
};
