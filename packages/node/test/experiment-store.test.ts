import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import type { ExperimentPhase, ExperimentView, PhaseTimes, Pose, RecordingPage } from "@galahad/core";
import { ExperimentStore } from "../src/experiment-store.ts";

/*
 * The experiment archive on the node that ran them: every experiment kept, complete and for good
 * (only the owner deletes one), compressed; a safety limit only against a runaway; what survives a
 * restart or a damaged file; and the two functions a general archive takes them in by. Temp homes only.
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
type Fields = ExperimentView & { phase: ExperimentPhase; phases: PhaseTimes };
function view(over: Partial<Fields> = {}): Fields {
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
      { id: "elbow", shape: { kind: "mesh", vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] }, color: "#e64d40" },
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
/** It ends, and is examined: done (or failed), as the hub says it. */
function finish(store: ExperimentStore, v: Fields, status: "done" | "failed" = "done") {
  const ended = { ...v, status, endedAt: v.startedAt + 30_000, phase: "examining" as ExperimentPhase, phases: { ...v.phases, testing: v.startedAt + 1000, examining: v.startedAt + 30_000 } };
  store.finish(ended);
  store.update({ ...ended, phase: status, phases: { ...ended.phases, ended: v.startedAt + 40_000 } });
}
const all = (store: ExperimentStore, id: string, hz?: number) => {
  const frames: number[][] = [];
  let from: number | null = 0;
  while (from !== null) {
    const page: RecordingPage = store.recording(id, from, 2000, hz)!;
    frames.push(...page.frames);
    from = page.next;
  }
  return frames;
};

describe("every experiment, complete", () => {
  test("every frame and every readout as the simulation sent them, gzipped; its scene (meshes too) as sent", () => {
    const dir = temp();
    const store = open(dir);
    const v = view();
    store.begin(v);
    const frames = run(10, 60);
    store.record(v.id, frames, 5_000_000);
    finish(store, v);
    const saved = store.get(v.id)!;
    expect(saved.recording).toMatchObject({ frames: 600, truncated: null, bodies: ["base", "hand", "elbow"], t0: 0 });
    expect(saved.samples).toEqual({ count: 600, truncated: null });
    expect(saved.readouts.error_mm).toMatchObject({ count: 600, max: 500 + 100 * Math.exp(-7 / 60) });
    // Every frame, exactly: the 300th is the 300th sent.
    const kept = all(store, v.id);
    expect(kept).toHaveLength(600);
    expect(kept[299]).toEqual([299 / 60, 1, ...frames[299]!.poses.hand!, 2, ...frames[299]!.poses.elbow!]);
    // On disk: gzip, a fraction of the text.
    const chunk = readFileSync(join(dir, v.id, "frames", "000000.jsonl.gz"));
    expect(gunzipSync(chunk).toString().split("\n")).toHaveLength(600);
    expect(chunk.length).toBeLessThan(gunzipSync(chunk).length / 3);
    expect(JSON.parse(readFileSync(join(dir, v.id, "scene.json"), "utf8"))).toEqual(v.scene);
    expect(saved.scene).toEqual(v.scene);
  });

  test("a replay's view of it: at most so many frames a second, each with what moved in the frames it stands for", () => {
    const store = open(temp());
    const v = view();
    store.begin(v);
    store.record(v.id, run(10, 60), 5_000_000);
    finish(store, v);
    const replay = all(store, v.id, 15);
    expect(replay.length).toBeGreaterThanOrEqual(150);
    expect(replay.length).toBeLessThanOrEqual(151);
    const bodies = (f: number[]) => f.filter((_, i) => i > 0 && (i - 1) % 8 === 0).sort();
    expect(bodies(replay[0]!)).toEqual([0, 1]);
    // The elbow moved only every other frame, yet every kept frame has its latest pose.
    for (const f of replay.slice(1)) expect(bodies(f)).toEqual([1, 2]);
    expect(replay.at(-1)![0]).toBeCloseTo(599 / 60, 6);
  });

  test("in chunks: a long one is read across them, page by page, from anywhere", () => {
    const dir = temp();
    const store = open(dir, { chunkBytes: 8_000, pageBytes: 15_000 });
    const v = view();
    store.begin(v);
    for (let s = 0; s < 6; s++) {
      store.record(v.id, run(10, 30, s * 10).map((f) => ({ t: f.t, poses: f.poses })), 5_000_000 + s * 10_000);
      store.flush();
    }
    // While it runs, its open chunk is read from memory, the closed ones from disk.
    expect(all(store, v.id)).toHaveLength(1800);
    finish(store, v);
    expect(readdirSync(join(dir, v.id, "frames")).length).toBeGreaterThan(5);
    const frames = all(store, v.id);
    expect(frames).toHaveLength(1800);
    for (let i = 1; i < frames.length; i++) expect(frames[i]![0]!).toBeGreaterThan(frames[i - 1]![0]!);
    expect(store.recording(v.id, 1234, 3)!.frames).toEqual(frames.slice(1234, 1237));
  });

  test("a simulation that starts its clock over is recorded running forwards; how fast it played is kept", () => {
    const store = open(temp());
    const v = view();
    store.begin(v);
    store.record(v.id, run(5, 10), 5_000_000);
    store.record(v.id, run(5, 10).map((f) => ({ ...f, poses: { hand: f.poses.hand! } })), 5_005_000);
    finish(store, v);
    const frames = all(store, v.id);
    for (let i = 1; i < frames.length; i++) expect(frames[i]![0]!).toBeGreaterThanOrEqual(frames[i - 1]![0]!);
    expect(store.get(v.id)!.recording.rate).toBeCloseTo(2, 0);
  });

  test("only a runaway reaches the safety limit: there the recording stops, and the record and the examination say where", () => {
    const store = open(temp(), { recordingBytes: 30_000, readoutBytes: 10_000 });
    const v = view();
    store.begin(v);
    store.record(v.id, run(60, 30), 5_000_000);
    finish(store, v);
    const saved = store.get(v.id)!;
    expect(saved.recording.truncated).toMatchObject({ limit: 30_000 });
    expect(saved.recording.truncated!.t).toBeGreaterThan(5);
    expect(saved.recording.truncated!.t).toBeLessThan(60);
    expect(all(store, v.id)).toHaveLength(saved.recording.frames);
    expect(saved.recording.t1!).toBeLessThan(saved.recording.truncated!.t);
    expect(saved.samples.truncated).toMatchObject({ limit: 10_000 });
    // The readouts' exact figures still cover every sample sent.
    expect(saved.readouts.error_mm!.count).toBe(1800);
    const notable = store.examination(v.id)!.notable;
    expect(notable.some((s) => /^Its recording stopped at \d+ s: it reached its safety limit \(0 MB\)/.test(s))).toBe(true);
    expect(notable.some((s) => /^Its readouts stopped at/.test(s))).toBe(true);
  });
});

describe("kept for good", () => {
  test("nothing is cleared to make room; a favourite is offered first; only removing one deletes it", () => {
    const store = open(temp());
    const made = Array.from({ length: 30 }, () => {
      const v = view();
      store.begin(v);
      store.record(v.id, run(2, 15), 5_000_000);
      finish(store, v);
      return v;
    });
    expect(store.listing().total).toBe(30);
    expect(store.recent(5).map((s) => s.id)).toEqual(made.slice(-5).reverse().map((v) => v.id));
    expect(store.pin(made[0]!.id, true)).toMatchObject({ pinned: true });
    expect(store.recent(5)[0]!.id).toBe(made[0]!.id);
    expect(() => store.pin("ex_nonexistent0", true)).toThrow(/no such/);
    expect(store.remove(made[1]!.id)).toBe(true);
    expect(store.listing().total).toBe(29);
  });

  test("code is kept up to 64 KB; one still running can't be deleted", () => {
    const store = open(temp());
    const v = view();
    store.begin(v);
    expect(() => store.setCode(v.id, "big.py", "x".repeat(64 * 1024 + 1))).toThrow(/64 KB/);
    expect(() => store.remove(v.id)).toThrow(/still running/);
    finish(store, v);
    expect(store.remove(v.id)).toBe(true);
    expect(store.remove(v.id)).toBe(false);
    expect(store.get(v.id)).toBeNull();
    expect(store.get("../../etc")).toBeNull();
  });
});

describe("after a restart", () => {
  test("everything is there again; one that was running when the node stopped ended then, failed, and is archived after the rest", () => {
    const dir = temp();
    const first = open(dir);
    const done = view({ title: "Finished one" });
    first.begin(done);
    first.record(done.id, run(5, 15), 5_000_000);
    first.setCode(done.id, "experiment.py", "import galahad_world as gw\n");
    finish(first, done);
    first.pin(done.id, true);
    const cut = view({ title: "Cut short" });
    first.begin(cut);
    first.update({ ...cut, status: "running", phase: "testing", phases: { ...cut.phases, testing: cut.startedAt + 500 } });
    first.record(cut.id, run(3, 15), 5_000_000);
    first.flush();
    // The node stops (no close: as if it died).
    stores.splice(stores.indexOf(first), 1);

    const again = open(dir);
    expect(again.listing().experiments.map((e) => e.title).sort()).toEqual(["Cut short", "Finished one"]);
    expect(again.get(done.id)).toMatchObject({ pinned: true, status: "done", phase: "done", code: { name: "experiment.py" } });
    expect(again.code(done.id)!.source).toBe("import galahad_world as gw\n");
    expect(again.get(cut.id)).toMatchObject({ status: "failed", phase: "failed", summary: "the node stopped before it finished" });
    expect(all(again, cut.id)).toHaveLength(45);
    expect(again.archiveSince(null).experiments.map((e) => e.title)).toEqual(["Finished one", "Cut short"]);
  });

  test("damage: a view that can't be read is left as it is (only the owner deletes), the rest load; a damaged line or chunk is skipped", () => {
    const dir = temp();
    const logs: string[] = [];
    const first = open(dir, { chunkBytes: 500 });
    const [good, bad] = [view(), view()];
    for (const v of [good, bad]) {
      first.begin(v);
      for (let s = 0; s < 4; s++) {
        first.record(v.id, run(1, 15, s).map((f) => ({ t: f.t, poses: f.poses })), 5_000_000);
        first.flush();
      }
      finish(first, v);
    }
    first.close();
    stores.splice(stores.indexOf(first), 1);
    writeFileSync(join(dir, bad.id, "view.json"), '{"id": "ex_trunc');
    const chunks = readdirSync(join(dir, good.id, "frames")).sort();
    expect(chunks.length).toBeGreaterThan(2);
    const chunk = join(dir, good.id, "frames", chunks[0]!);
    const lines = gunzipSync(readFileSync(chunk)).toString().split("\n");
    lines[3] = "[1, 2, garbage";
    writeFileSync(chunk, gzipSync(lines.join("\n")));
    const lost = gunzipSync(readFileSync(join(dir, good.id, "frames", chunks[1]!))).toString().split("\n").length;
    writeFileSync(join(dir, good.id, "frames", chunks[1]!), "not gzip at all");
    mkdirSync(join(dir, "not-an-experiment"));

    const again = open(dir, {}, logs);
    expect(again.listing().experiments.map((e) => e.id)).toEqual([good.id]);
    expect(existsSync(join(dir, bad.id, "view.json"))).toBe(true);
    expect(existsSync(join(dir, "not-an-experiment"))).toBe(true);
    expect(logs.some((l) => l.includes(bad.id) && /can't be read.*left as it is/.test(l))).toBe(true);
    expect(all(again, good.id).length).toBe(60 - 1 - lost);
    expect(logs.some((l) => /chunk can't be read/.test(l))).toBe(true);
  });
});

describe("for a general archive", () => {
  test("every finished experiment after a cursor, oldest first, in a stable order; running ones wait; deleted ones go", () => {
    const store = open(temp());
    const made: Fields[] = [];
    for (let i = 0; i < 5; i++) {
      const v = view({ startedAt: 2_000_000 - i * 1000 });
      store.begin(v);
      finish(store, v);
      made.push(v);
    }
    const running = view();
    store.begin(running);
    const first = store.archiveSince(null, 3);
    expect(first.experiments.map((e) => e.id)).toEqual(made.slice(0, 3).map((v) => v.id));
    expect(first.experiments.map((e) => e.seq)).toEqual([1, 2, 3]);
    store.remove(made[3]!.id);
    const rest = store.archiveSince(first.cursor);
    expect(rest.experiments.map((e) => e.id)).toEqual([made[4]!.id]);
    expect(store.archiveSince(rest.cursor)).toEqual({ experiments: [], cursor: rest.cursor });
    finish(store, running);
    expect(store.archiveSince(rest.cursor).experiments.map((e) => e.id)).toEqual([running.id]);
    expect(() => store.archiveSince("-1")).toThrow(/cursor/);
  });

  test("an entry: its files, each with its role, size and SHA-256, and the plain text of it", () => {
    const store = open(temp());
    const v = view({ title: "Gripper on the bench", summary: null });
    store.begin(v);
    store.record(v.id, run(3, 15), 5_000_000);
    store.setCode(v.id, "gripper.py", "print('grip')\n");
    expect(store.archiveEntry(v.id)).toBeNull();
    finish(store, { ...v, summary: "it held 2 kg" });
    const entry = store.archiveEntry(v.id)!;
    expect(entry.files.map((f) => [f.role, f.name, f.type])).toEqual([
      ["view", "view.json", "application/json"],
      ["scene", "scene.json", "application/json"],
      ["frames", "frames/000000.jsonl.gz", "application/gzip"],
      ["readouts", "readouts/000000.jsonl.gz", "application/gzip"],
      ["code", "code.txt", "text/plain; charset=utf-8"],
    ]);
    for (const f of entry.files) expect(f.sha256).toBe(createHash("sha256").update(readFileSync(f.path)).digest("hex"));
    expect(entry.text).toContain("Experiment: Gripper on the bench");
    expect(entry.text).toContain("Tested in the workshop hall's test cell 1");
    expect(entry.text).toContain("Status: done: it held 2 kg");
    expect(entry.text).toContain("Examination: Gripper on the bench (MuJoCo) finished");
    expect(entry.text).toContain("Code (gripper.py):\nprint('grip')");
    expect(entry.summary).toMatchObject({ id: v.id, frames: 45 });
  });
});
