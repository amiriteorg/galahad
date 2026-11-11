import { describe, expect, test } from "bun:test";
import type { Examination, RecordingPage, SavedExperiment, SavedSummary } from "@galahad/core/experiments";
import type { ExperimentView } from "@galahad/core/world";
import { chartGeometry, chartX, chartY } from "./charts.ts";
import { lookOptions, SAVED_SHOWN } from "./look.ts";
import { busyPlot, decodeRecording, frameAt, posesAt, ReplayClock, readoutsAt, replayRate, replayView, ReplayWorld } from "./replay.ts";
import { applyWorldEvent, emptyWorld, phaseLine, readWorldEvent, type WorldModel } from "./world.ts";

/*
 * Saved experiments in the SANDBOX: listed in the selector, replayed where they were tested
 * (decoded once, played, paused and scrubbed), their readouts charted.
 */

const page = (frames: number[][], over: Partial<RecordingPage> = {}): RecordingPage => ({ id: "ex_AAAAAAAAAAAA", bodies: ["base", "hand"], rate: 2, t0: 0, t1: 2, total: frames.length, from: 0, frames, next: null, ...over });
const p = (k: number, x: number) => [k, x, 0, 1, 1, 0, 0, 0];

describe("a recording, decoded", () => {
  test("every body's pose at every frame, carried forward from where it was last posed; bad rows skipped", () => {
    const rec = decodeRecording([page([[0, ...p(0, 9), ...p(1, 0)], [1, ...p(1, 1)]]), page([[2, ...p(1, 2)], [3, 7, 0], [4, ...p(5, 1)]] as number[][])]);
    expect([...rec.times]).toEqual([0, 1, 2, 3, 4]);
    expect(rec.rate).toBe(2);
    // The base was posed once, in the first frame; it stands there throughout.
    expect(posesAt(rec, 2)).toEqual({ base: [9, 0, 1, 1, 0, 0, 0], hand: [2, 0, 1, 1, 0, 0, 0] });
    // A row that's cut short, or names a body there isn't, changes nothing.
    expect(posesAt(rec, 4)).toEqual(posesAt(rec, 2));
    expect(frameAt(rec.times, -1)).toBe(0);
    expect(frameAt(rec.times, 1.5)).toBe(1);
    expect(frameAt(rec.times, 99)).toBe(4);
  });

  test("before a body's first pose it has none", () => {
    const rec = decodeRecording([page([[0, ...p(1, 0)], [1, ...p(0, 3), ...p(1, 1)]])]);
    expect(Object.keys(posesAt(rec, 0))).toEqual(["hand"]);
    expect(Object.keys(posesAt(rec, 1)).sort()).toEqual(["base", "hand"]);
  });

  test("it plays as it did live, unless that was unwatchably fast", () => {
    expect(replayRate(4)).toBe(4);
    expect(replayRate(300)).toBe(1);
    expect(replayRate(0)).toBe(1);
  });
});

describe("the replay's clock", () => {
  test("plays at its rate, pauses, scrubs, rests at the end, and starts over when played again", () => {
    const c = new ReplayClock(0, 10, 2, 1000);
    expect(c.at(2000)).toBe(2);
    c.pause(2000);
    expect(c.at(9000)).toBe(2);
    c.seek(7, 9000);
    c.play(9000);
    expect(c.at(10_000)).toBe(9);
    expect(c.at(20_000)).toBe(10);
    expect(c.ended).toBe(true);
    c.play(21_000);
    expect(c.at(21_000)).toBe(0);
    c.seek(-5, 21_000);
    expect(c.at(21_000)).toBe(0);
  });
});

const saved: SavedExperiment = {
  id: "ex_AAAAAAAAAAAA",
  title: "Gripper",
  engine: "mujoco",
  status: "done",
  plot: { x: 112, y: 11, size: 10 },
  scale: 1,
  scene: [{ id: "hand", shape: { kind: "sphere", radius: 0.1 } }],
  startedAt: 1000,
  endedAt: 9000,
  nodeName: "ultra",
  sandbox: "0123456789",
  quest: null,
  metrics: { error_mm: 3 },
  summary: "it held",
  phase: "done",
  phases: { building: 1000, testing: 2000, examining: 9000, ended: 12_000 },
  pinned: false,
  bytes: 100,
  recording: { frames: 3, bytes: 90, hz: 15, thinned: false, rate: 1, t0: 0, t1: 2, bodies: ["hand"] },
  readouts: {},
  code: null,
};
const live = (over: Partial<ExperimentView>): ExperimentView => ({ ...replayView(saved), id: "ex_live", title: "Live", status: "done", endedAt: 5, ...over });
const hello = (experiments: ExperimentView[], savedList: SavedSummary[] = []): WorldModel =>
  applyWorldEvent(emptyWorld(), { type: "hello", at: 10, galahad: { station: "keep", doing: "", experiment: null, model: null, since: 0 }, nodes: [], experiments, thoughts: [], saved: savedList });

describe("the world while a replay plays", () => {
  test("the replay on its plot, marked; what ended there out of the way; the same objects for the same inputs", () => {
    const view = replayView(saved);
    expect(view).toMatchObject({ id: "replay:ex_AAAAAAAAAAAA", title: "Replay · Gripper", status: "running", plot: saved.plot });
    const other = live({ id: "ex_other", plot: { x: 124, y: 11, size: 10 } });
    const model = hello([live({}), other]);
    const world = new ReplayWorld();
    const first = { experiment: view.id, t: 0, poses: { hand: [0, 0, 1, 1, 0, 0, 0] as [number, number, number, number, number, number, number] } };
    const shown = world.shown(model, view, first);
    expect(shown.experiments.map((e) => e.id)).toEqual(["ex_other", view.id]);
    expect(shown.frames[view.id]).toBe(first);
    expect(world.shown(model, view, first)).toBe(shown);
    // A live frame elsewhere changes the model, not the experiments: the renderer has nothing to rebuild.
    const next = { ...model, frames: { ...model.frames } };
    expect(world.shown(next, view, first).experiments).toBe(shown.experiments);
    expect(world.shown(model, null, null)).toBe(model);
    // One still running there is in the way.
    expect(busyPlot(hello([live({ endedAt: null, status: "running" })]), saved.plot)?.id).toBe("ex_live");
    expect(busyPlot(model, saved.plot)).toBeUndefined();
  });

  test("readouts at the playhead, from the examination's series", () => {
    const ex = { readouts: [{ key: "error_mm", series: [[0, 10], [2, 0]] }] } as unknown as Examination;
    expect(readoutsAt(ex, 1)).toEqual({ error_mm: 5 });
    expect(readoutsAt(ex, -1)).toEqual({ error_mm: 10 });
    expect(readoutsAt(ex, 9)).toEqual({ error_mm: 0 });
  });
});

describe("a readout's chart", () => {
  test("its line in the box, higher values higher; a flat one in the middle; the playhead's place", () => {
    const g = chartGeometry([[0, 0], [5, 10], [10, 5]], 100, 40, 2);
    expect(g.path).toBe("M2 38 L50 2 L98 20");
    expect(chartX(g, 5, 100, 2)).toBe(50);
    expect(chartX(g, 99, 100, 2)).toBe(98);
    expect(chartY(g, 10, 40, 2)).toBe(2);
    const flat = chartGeometry([[0, 3], [1, 3]], 100, 40, 2);
    expect(flat.path).toBe("M2 20 L98 20");
    expect(chartGeometry([], 100, 40).path).toBe("");
  });
});

describe("saved experiments in the selector and the stream", () => {
  const summary = (i: number, over: Partial<SavedSummary> = {}): SavedSummary => ({ id: `ex_AAAAAAAAAA${String(i).padStart(2, "0")}`, title: `Rig ${i}`, engine: "mujoco", status: "done", phase: "done", startedAt: 1000, endedAt: 2000, nodeName: "ultra", plot: { x: 112, y: 11, size: 10 }, summary: null, pinned: false, bytes: 1, frames: 3, duration: 2, readouts: {}, code: false, ...over });

  test("a group to replay from: the newest few, and every match of a search", () => {
    const list = Array.from({ length: 12 }, (_, i) => summary(i, i === 11 ? { title: "Rover on the course", status: "failed" } : {}));
    const model = hello([], list);
    const group = lookOptions(model, "", 3000).filter((o) => o.group === "Saved experiments");
    expect(group).toHaveLength(SAVED_SHOWN);
    expect(group[0]).toMatchObject({ target: { kind: "saved", id: list[0]!.id }, icon: "play-circle", meta: "Replay · MuJoCo · Done in the workshop · just now" });
    const found = lookOptions(model, "rover", 3000).filter((o) => o.group === "Saved experiments");
    expect(found.map((o) => o.label)).toEqual(["Rover on the course"]);
    expect(found[0]).toMatchObject({ tone: "danger" });
  });

  test("hello and saved events carry the list; what can't be read of it is left out", () => {
    const raw = { type: "hello", at: 5, galahad: { station: "keep", doing: "", experiment: null, model: null, since: 0 }, nodes: [], experiments: [], thoughts: [], saved: [summary(1), { id: "x", title: 5 }] };
    const event = readWorldEvent(raw)!;
    let model = applyWorldEvent(emptyWorld(), event);
    expect(model.saved.map((s) => s.title)).toEqual(["Rig 1"]);
    model = applyWorldEvent(model, readWorldEvent({ type: "saved", at: 6, saved: [summary(2), summary(1)] })!);
    expect(model.saved.map((s) => s.title)).toEqual(["Rig 2", "Rig 1"]);
    // An older node says nothing of saved ones: none.
    expect(applyWorldEvent(emptyWorld(), readWorldEvent({ ...raw, saved: undefined })!).saved).toEqual([]);
  });

  test("an experiment's phase is read at the boundary, and said in words", () => {
    const raw = { ...replayView(saved), id: "ex_b", phase: "building", phases: { building: 1, testing: null, examining: null, ended: null }, assembly: { hand: [0, 0, 1, 1, 0, 0, 0] }, build: { from: 1, until: 9 } };
    const event = readWorldEvent({ type: "experiment", at: 1, experiment: raw })!;
    const e = (event as { experiment: ExperimentView }).experiment;
    expect(e).toMatchObject({ phase: "building", assembly: { hand: [0, 0, 1, 1, 0, 0, 0] }, build: { from: 1, until: 9 } });
    expect(phaseLine(e)).toBe("Being built in the workshop");
    // A phase this page doesn't know, or a broken assembly, is left out (the status says the rest).
    const odd = (readWorldEvent({ type: "experiment", at: 1, experiment: { ...raw, phase: "dreaming", assembly: { hand: [1, 2] } } }) as { experiment: ExperimentView }).experiment;
    expect(odd.phase).toBeUndefined();
    expect(odd.assembly).toBeUndefined();
    expect(phaseLine({ ...odd, status: "running" })).toBe("Testing in the workshop");
  });
});
