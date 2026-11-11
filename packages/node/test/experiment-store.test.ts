import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExperimentPhase, ExperimentView, PhaseTimes, Pose, RecordingPage } from "@galahad/core";
import { ExperimentStore, Thinned } from "../src/experiment-store.ts";

/*
 * Saved experiments on the node that ran them: what's kept, within what, and what survives a
 * restart or a damaged file. Temp homes only.
 */

const dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), "galahad-experiments-"));
  dirs.push(dir);
  return dir;
};
const stores: ExperimentStore[] = [];
const open = (dir: string, limits: ConstructorParameters<typeof ExperimentStore>[0]["limits"] = {}, logs: string[] = []) => {
  const store = new ExperimentStore({ dir, limits: { flushMs: 60_000, ...limits }, log: (m) => logs.push(m) });
  stores.push(store);
  return store;
};
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

let n = 0;
function view(over: Partial<ExperimentView & { phase: ExperimentPhase; phases: PhaseTimes }> = {}): ExperimentView & { phase: ExperimentPhase; phases: PhaseTimes } {
  n++;
  const startedAt = over.startedAt ?? 1_000_000 + n * 1000;
  return {
    id: `ex_test${String(n).padStart(8, "0")}`,
    title: `Rig ${n}`,
    engine: "mujoco",
    status: "starting",
    plot: { x: 112, y: 11, size: 10 },
    scale: 1,
    scene: [
      { id: "base", shape: { kind: "box", size: [1, 1, 0.2] }, fixed: true },
      { id: "hand", shape: { kind: "sphere", radius: 0.1 } },
      { id: "elbow", shape: { kind: "sphere", radius: 0.1 } },
    ],
    startedAt,
    endedAt: null,
    nodeName: "ultra",
    sandbox: "0123456789",
    quest: null,
    metrics: {},
    summary: null,
    phase: "building",
    phases: { building: startedAt, testing: null, examining: null, ended: null },
    ...over,
  };
}
const pose = (x: number): Pose => [x, 0, 1, 1, 0, 0, 0];
/** `seconds` of frames at `fps`: the hand moves every frame, the elbow every other one, the base once. */
const run = (seconds: number, fps: number, t0 = 0) =>
  Array.from({ length: Math.round(seconds * fps) }, (_, i) => {
    const t = t0 + i / fps;
    const poses: Record<string, Pose> = { hand: pose(t) };
    if (i % 2) poses.elbow = pose(-t);
    if (i === 0 && t0 === 0) poses.base = pose(0);
    return { t, poses, metrics: { error_mm: 100 * Math.exp(-t) + (i === 7 ? 500 : 0) } };
  });
const ended = (v: ReturnType<typeof view>, status: "done" | "failed" = "done") => ({ ...v, status, endedAt: v.startedAt + 30_000, phase: status as ExperimentPhase, phases: { ...v.phases, testing: v.startedAt + 1000, examining: v.startedAt + 30_000, ended: v.startedAt + 40_000 } });

describe("a recording", () => {
  test("keeps at most 15 frames a second of simulation, and nothing that moved only between them is lost", () => {
    const store = open(temp());
    const v = view();
    store.begin(v);
    store.record(v.id, run(10, 60), 5_000_000);
    store.finish(ended(v));
    const saved = store.get(v.id)!;
    expect(saved.recording.frames).toBeGreaterThanOrEqual(149);
    expect(saved.recording.frames).toBeLessThanOrEqual(151);
    expect(saved.recording.bodies).toEqual(["base", "hand", "elbow"]);
    const page = store.recording(v.id)!;
    const bodies = (f: number[]) => f.filter((_, i) => i > 0 && (i - 1) % 8 === 0).sort();
    // The first frame poses the fixed base (and the hand); every later one has the elbow's latest pose, though it moved only every other frame.
    expect(bodies(page.frames[0]!)).toEqual([0, 1]);
    for (const f of page.frames.slice(1)) expect(bodies(f)).toEqual([1, 2]);
    // The last frame is the very last pose.
    expect(page.frames.at(-1)![2]).toBeCloseTo(599 / 60, 3);
    expect(page.next).toBeNull();
  });

  test("past its cap it's thinned (every other frame, again and again), so it still covers the whole run", () => {
    const store = open(temp(), { recordingBytes: 40_000 });
    const v = view();
    store.begin(v);
    store.record(v.id, run(120, 30), 5_000_000);
    store.finish(ended(v));
    const saved = store.get(v.id)!;
    expect(saved.recording.thinned).toBe(true);
    expect(saved.recording.hz).toBeLessThan(15);
    expect(saved.recording.bytes).toBeLessThanOrEqual(40_000);
    expect(saved.recording.t0).toBe(0);
    expect(saved.recording.t1).toBeCloseTo(119.967, 2);
    const page = store.recording(v.id)!;
    // The base, posed only in the very first frame, is still there.
    expect(page.frames[0]!.filter((_, i) => i > 0 && (i - 1) % 8 === 0)).toContain(0);
    expect(store.examination(v.id)!.notable.some((s) => /thinned/.test(s))).toBe(true);
  });

  test("readouts: their exact range over every sample (the spike between kept samples too), the series thinned", () => {
    const store = open(temp());
    const v = view();
    store.begin(v);
    store.record(v.id, run(10, 120), 5_000_000);
    store.finish(ended(v));
    const stats = store.get(v.id)!.readouts.error_mm!;
    expect(stats.count).toBe(1200);
    expect(stats.max).toBeCloseTo(500 + 100 * Math.exp(-7 / 120), 6);
    expect(stats.first).toEqual([0, 100]);
    const ex = store.examination(v.id)!;
    expect(ex.readouts[0]).toMatchObject({ key: "error_mm", count: 1200 });
    expect(ex.readouts[0]!.series.length).toBeLessThanOrEqual(96);
  });

  test("a simulation that starts its clock over is recorded running forwards; how fast it played is kept", () => {
    const store = open(temp());
    const v = view();
    store.begin(v);
    store.record(v.id, run(5, 10), 5_000_000);
    store.record(v.id, run(5, 10).map((f) => ({ ...f, poses: { hand: f.poses.hand! } })), 5_005_000);
    store.finish(ended(v));
    const page = store.recording(v.id)!;
    for (let i = 1; i < page.frames.length; i++) expect(page.frames[i]![0]!).toBeGreaterThan(page.frames[i - 1]![0]!);
    // 10 s of simulation over 5 s of the node's clock: it played at twice real time.
    expect(store.get(v.id)!.recording.rate).toBeCloseTo(2, 0);
  });

  test("pages: from where the last one stopped", () => {
    const store = open(temp(), { pageBytes: 2_000 });
    const v = view();
    store.begin(v);
    store.record(v.id, run(10, 15), 5_000_000);
    store.finish(ended(v));
    const all: number[][] = [];
    let from: number | null = 0;
    while (from !== null) {
      const page: RecordingPage = store.recording(v.id, from)!;
      all.push(...page.frames);
      from = page.next;
    }
    expect(all.length).toBe(store.get(v.id)!.recording.frames);
  });

  test("Thinned on its own: the first and last are always kept", () => {
    const t = new Thinned(1, 10, 200);
    for (let i = 0; i < 1000; i++) t.offer(i / 10, [[0, [i]]]);
    t.close();
    expect(t.bytes).toBeLessThanOrEqual(200);
    expect(t.first).toBe(0);
    expect(t.last).toBeCloseTo(99.9, 6);
    expect(t.thinned).toBe(true);
  });
});

describe("the budget", () => {
  test("over it, the oldest unpinned ended ones go first; pinned and running ones stay", () => {
    const logs: string[] = [];
    const dir = temp();
    const store = open(dir, { budgetBytes: 40_000 }, logs);
    const made = Array.from({ length: 6 }, () => {
      const v = view();
      store.begin(v);
      store.record(v.id, run(10, 15), 5_000_000);
      store.finish(ended(v));
      return v;
    });
    const each = store.get(made[5]!.id)!.bytes;
    expect(each).toBeGreaterThan(8_000);
    const left = () => store.listing().experiments.map((e) => e.id);
    // Only as many as fit are left, and they're the newest.
    expect(store.listing().bytes).toBeLessThanOrEqual(40_000);
    const kept = left();
    expect(kept[0]).toBe(made[5]!.id);
    expect(kept).not.toContain(made[0]!.id);
    expect(existsSync(join(dir, made[0]!.id))).toBe(false);
    expect(logs.some((l) => /cleared \d+ old saved experiment/.test(l))).toBe(true);
    // Pin the oldest left; a running one and more new ones come; the pinned one stays.
    const oldest = kept.at(-1)!;
    store.pin(oldest, true);
    const running = view();
    store.begin(running);
    store.record(running.id, run(10, 15), 5_000_000);
    for (let i = 0; i < 4; i++) {
      const v = view();
      store.begin(v);
      store.record(v.id, run(10, 15), 5_000_000);
      store.finish(ended(v));
    }
    store.flush();
    expect(left()).toContain(oldest);
    expect(left()).toContain(running.id);
    expect(store.listing().total).toBeLessThan(11);
  });

  test("pins have their own share of it; a pin past that is refused", () => {
    const store = open(temp(), { pinnedBytes: 15_000 });
    const [a, b] = [view(), view()];
    for (const v of [a, b]) {
      store.begin(v);
      store.record(v.id, run(10, 15), 5_000_000);
      store.finish(ended(v));
    }
    expect(store.pin(a.id, true)).toMatchObject({ pinned: true });
    expect(() => store.pin(b.id, true)).toThrow(/at most; unpin one first/);
    store.pin(a.id, false);
    expect(store.pin(b.id, true).pinned).toBe(true);
    expect(() => store.pin("ex_nonexistent0", true)).toThrow(/no such/);
  });

  test("never more than the count", () => {
    const store = open(temp(), { count: 3 });
    for (let i = 0; i < 5; i++) {
      const v = view();
      store.begin(v);
      store.finish(ended(v));
    }
    expect(store.listing().total).toBe(3);
  });
});

describe("after a restart", () => {
  test("everything is there again; one that was running when the node stopped ended then, failed", () => {
    const dir = temp();
    const first = open(dir);
    const done = view({ title: "Finished one" });
    first.begin(done);
    first.record(done.id, run(5, 15), 5_000_000);
    first.setCode(done.id, "experiment.py", "import galahad_world as gw\n");
    first.finish(ended(done));
    first.pin(done.id, true);
    const cut = view({ title: "Cut short" });
    first.begin(cut);
    first.update({ ...cut, status: "running", phase: "testing", phases: { ...cut.phases, testing: cut.startedAt + 500 } });
    first.record(cut.id, run(3, 15), 5_000_000);
    first.flush();
    // The node stops (no close: as if it died).
    stores.splice(stores.indexOf(first), 1);

    const again = open(dir);
    const list = again.listing().experiments;
    expect(list.map((e) => e.title).sort()).toEqual(["Cut short", "Finished one"]);
    expect(again.get(done.id)).toMatchObject({ pinned: true, status: "done", phase: "done", code: { name: "experiment.py" } });
    expect(again.code(done.id)!.source).toBe("import galahad_world as gw\n");
    expect(again.get(cut.id)).toMatchObject({ status: "failed", phase: "failed", summary: "the node stopped before it finished" });
    expect(again.recording(cut.id)!.frames.length).toBeGreaterThan(30);
    expect(again.recent(10).map((e) => e.id)).toContain(cut.id);
  });

  test("a damaged file: a view that can't be read is cleared (the rest load); a damaged line of a recording is skipped", () => {
    const dir = temp();
    const logs: string[] = [];
    const first = open(dir);
    const [good, bad] = [view(), view()];
    for (const v of [good, bad]) {
      first.begin(v);
      first.record(v.id, run(2, 15), 5_000_000);
      first.finish(ended(v));
    }
    first.close();
    stores.splice(stores.indexOf(first), 1);
    writeFileSync(join(dir, bad.id, "view.json"), '{"id": "ex_trunc');
    const lines = readFileSync(join(dir, good.id, "recording.jsonl"), "utf8").split("\n");
    lines[3] = "[1, 2, garbage";
    writeFileSync(join(dir, good.id, "recording.jsonl"), lines.join("\n"));
    // Stray files aren't ours to touch; a temp file from a write cut short is.
    mkdirSync(join(dir, "not-an-experiment"));
    writeFileSync(join(dir, good.id, "view.json.tmp"), "half");

    const again = open(dir, {}, logs);
    expect(again.listing().experiments.map((e) => e.id)).toEqual([good.id]);
    expect(existsSync(join(dir, bad.id))).toBe(false);
    expect(existsSync(join(dir, "not-an-experiment"))).toBe(true);
    expect(existsSync(join(dir, good.id, "view.json.tmp"))).toBe(false);
    expect(logs.some((l) => l.includes(bad.id) && /can't be read/.test(l))).toBe(true);
    const page = again.recording(good.id)!;
    expect(page.frames.length).toBe(lines.length - 1);
    expect(page.total).toBe(lines.length);
  });
});

describe("code and deletion", () => {
  test("code is kept up to 64 KB; deleting one that's still running is refused", () => {
    const store = open(temp());
    const v = view();
    store.begin(v);
    expect(() => store.setCode(v.id, "big.py", "x".repeat(64 * 1024 + 1))).toThrow(/64 KB/);
    expect(() => store.remove(v.id)).toThrow(/still running/);
    store.finish(ended(v));
    expect(store.remove(v.id)).toBe(true);
    expect(store.remove(v.id)).toBe(false);
    expect(store.get(v.id)).toBeNull();
    expect(store.get("../../etc")).toBeNull();
  });
});
