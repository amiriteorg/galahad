import { describe, expect, test } from "bun:test";
import type { ExperimentView, WorldEvent, WorldWeather } from "@galahad/core/world";
import { PADS } from "@galahad/core/world";
import { applyWorldEvent, backoffMs, emptyWorld, experimentPlace, followWorld, MAX_ENDED, MAX_THOUGHTS, metricLabel, metricValue, readWorldEvent, type StreamStatus, weatherLabel, worldSummary } from "./world.ts";

const experiment = (over: Partial<ExperimentView> = {}): ExperimentView => ({
  id: "x1",
  title: "Arm reach",
  engine: "mujoco",
  status: "running",
  plot: { x: 60, y: 30, size: 20 },
  scale: 5,
  scene: [{ id: "link", shape: { kind: "capsule", radius: 0.05, length: 0.5 } }],
  startedAt: 1000,
  endedAt: null,
  nodeName: "ultra",
  sandbox: null,
  quest: null,
  metrics: {},
  summary: null,
  ...over,
});

const weather = (over: Partial<WorldWeather> = {}): WorldWeather => ({
  kind: "overcast",
  cloud: 0.92,
  precipitation: 0,
  visibility: 20760,
  wind: 1.6,
  temperature: 6.8,
  humidity: 0.84,
  observed: 1_794_329_100_000,
  place: "Copenhagen",
  source: "DMI HARMONIE via Open-Meteo",
  ...over,
});

const hello = (over: Partial<Extract<WorldEvent, { type: "hello" }>> = {}): WorldEvent => ({
  type: "hello",
  at: 10,
  galahad: { station: "keep", doing: "Checking the fleet", experiment: null, model: null, since: 5 },
  nodes: [{ id: "n1", name: "ultra", kind: "node", online: true, self: true, sandboxHost: true }],
  experiments: [experiment()],
  thoughts: ["one"],
  ...over,
});

describe("the world reducer", () => {
  test("hello replaces the world; later events fold in", () => {
    let w = applyWorldEvent(emptyWorld(), hello());
    expect(w.at).toBe(10);
    expect(w.experiments.map((e) => e.id)).toEqual(["x1"]);
    w = applyWorldEvent(w, { type: "galahad", at: 11, galahad: { station: "forge", doing: "Running code", experiment: null, model: null, since: 11 } });
    expect(w.galahad.station).toBe("forge");
    w = applyWorldEvent(w, { type: "fleet", at: 12, nodes: [] });
    expect(w.nodes).toEqual([]);
    w = applyWorldEvent(w, { type: "notice", at: 13, severity: "warn", title: "Approval waiting" });
    expect(w.notice).toEqual({ at: 13, severity: "warn", title: "Approval waiting" });
    // A fresh hello (a reconnect) keeps the notice but replaces the rest.
    w = applyWorldEvent(w, hello({ at: 20, experiments: [] }));
    expect(w.experiments).toEqual([]);
    expect(w.notice?.title).toBe("Approval waiting");
  });

  test("keeps the latest eight thoughts, trimmed, ignoring empty ones", () => {
    let w = applyWorldEvent(emptyWorld(), hello({ thoughts: [] }));
    for (let i = 0; i < 12; i++) w = applyWorldEvent(w, { type: "thought", at: 20 + i, text: ` t${i} ` });
    const same = applyWorldEvent(w, { type: "thought", at: 40, text: "   " });
    expect(same).toBe(w);
    expect(w.thoughts).toHaveLength(MAX_THOUGHTS);
    expect(w.thoughts.at(-1)).toBe("t11");
    expect(w.thoughts[0]).toBe("t4");
  });

  test("frames keep the last pose per experiment and merge their metrics; unknown experiments are ignored", () => {
    const w = applyWorldEvent(emptyWorld(), hello());
    const f1 = applyWorldEvent(w, { type: "frame", at: 11, frame: { experiment: "x1", t: 0.1, poses: { link: [0, 0, 1, 1, 0, 0, 0] }, metrics: { reward: 0.5 } } });
    expect(f1.frames.x1?.t).toBe(0.1);
    expect(f1.experiments[0]!.metrics).toEqual({ reward: 0.5 });
    const f2 = applyWorldEvent(f1, { type: "frame", at: 12, frame: { experiment: "x1", t: 0.2, poses: { link: [0, 0, 2, 1, 0, 0, 0] }, metrics: { error_m: 0.1 } } });
    expect(f2.frames.x1?.poses.link?.[2]).toBe(2);
    expect(f2.experiments[0]!.metrics).toEqual({ reward: 0.5, error_m: 0.1 });
    expect(f1.frames.x1?.t).toBe(0.1); // the old state is untouched
    expect(applyWorldEvent(f2, { type: "frame", at: 13, frame: { experiment: "nope", t: 1, poses: {} } })).toBe(f2);
  });

  test("a fixed body posed only in the first frame keeps that pose; moving bodies take their latest", () => {
    let w = applyWorldEvent(emptyWorld(), hello());
    w = applyWorldEvent(w, { type: "frame", at: 11, frame: { experiment: "x1", t: 0, poses: { ground: [0, 0, -0.1, 1, 0, 0, 0], link: [0, 0, 1, 1, 0, 0, 0] } } });
    w = applyWorldEvent(w, { type: "frame", at: 12, frame: { experiment: "x1", t: 0.1, poses: { link: [0, 0, 2, 1, 0, 0, 0] } } });
    expect(w.frames.x1?.poses).toEqual({ ground: [0, 0, -0.1, 1, 0, 0, 0], link: [0, 0, 2, 1, 0, 0, 0] });
    expect(w.frames.x1?.t).toBe(0.1);
  });

  test("an experiment event inserts or replaces; ended ones beyond the 12 most recent go, with their frames", () => {
    let w = applyWorldEvent(emptyWorld(), hello({ experiments: [] }));
    for (let i = 0; i < MAX_ENDED + 3; i++) {
      w = applyWorldEvent(w, { type: "experiment", at: 100 + i, experiment: experiment({ id: `e${i}`, status: "done", endedAt: 100 + i }) });
      w = applyWorldEvent(w, { type: "frame", at: 100 + i, frame: { experiment: `e${i}`, t: 1, poses: {} } });
    }
    w = applyWorldEvent(w, { type: "experiment", at: 200, experiment: experiment({ id: "live" }) });
    expect(w.experiments).toHaveLength(MAX_ENDED + 1);
    expect(w.experiments.some((e) => e.id === "live")).toBe(true);
    expect(w.experiments.some((e) => e.id === "e0")).toBe(false);
    expect(w.frames.e0).toBeUndefined();
    expect(w.frames.e14).toBeDefined();
    // Replacing keeps its place and its frame.
    w = applyWorldEvent(w, { type: "experiment", at: 201, experiment: experiment({ id: "e14", status: "failed", endedAt: 300, summary: "it tipped over" }) });
    expect(w.experiments.find((e) => e.id === "e14")?.status).toBe("failed");
    expect(w.frames.e14).toBeDefined();
  });

  test("an unknown event kind changes nothing", () => {
    const w = applyWorldEvent(emptyWorld(), hello());
    expect(applyWorldEvent(w, { type: "rainbow", at: 99 } as unknown as WorldEvent)).toBe(w);
  });

  test("the weather comes with hello and changes with weather events; an older node's hello has none", () => {
    let w = applyWorldEvent(emptyWorld(), hello({ weather: weather() }));
    expect(w.weather?.kind).toBe("overcast");
    w = applyWorldEvent(w, { type: "weather", at: 30, weather: weather({ kind: "rain", precipitation: 2 }) });
    expect(w.weather?.kind).toBe("rain");
    w = applyWorldEvent(w, { type: "weather", at: 31, weather: null });
    expect(w.weather).toBeNull();
    expect(applyWorldEvent(emptyWorld(), hello()).weather).toBeNull();
  });
});

describe("reading events at the boundary", () => {
  test("accepts the contract's shapes, round trip through JSON", () => {
    const events: WorldEvent[] = [
      hello(),
      { type: "thought", at: 1, text: "hmm" },
      { type: "frame", at: 2, frame: { experiment: "x1", t: 0, poses: { a: [0, 0, 0, 1, 0, 0, 0] } } },
      { type: "notice", at: 3, severity: "error", title: "Down" },
      { type: "experiment", at: 4, experiment: experiment({ scene: [{ id: "m", shape: { kind: "mesh", vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] }, color: "#aabbcc", trail: true }] }) },
      hello({ weather: weather() }),
      hello({ weather: null }),
      { type: "weather", at: 5, weather: weather({ kind: "drizzle", visibility: null }) },
      { type: "weather", at: 6, weather: null },
      // The wind's direction: given, unknown (null), or absent (an older node).
      { type: "weather", at: 7, weather: weather({ windFrom: 250 }) },
      { type: "weather", at: 8, weather: weather({ windFrom: null }) },
    ];
    for (const e of events) expect(readWorldEvent(JSON.parse(JSON.stringify(e)))).toEqual(e);
  });

  test("refuses what would hurt the renderer or isn't the contract", () => {
    const bad: unknown[] = [
      null,
      { type: "thought", text: "no time" },
      { type: "frame", at: 1, frame: { experiment: "x", t: 0, poses: { a: [0, 0, 0, 1, 0, 0] } } },
      { type: "frame", at: 1, frame: { experiment: "x", t: 0, poses: { a: [0, 0, Number.NaN, 1, 0, 0, 0] } } },
      { type: "experiment", at: 1, experiment: { ...experiment(), status: "paused" } },
      { type: "experiment", at: 1, experiment: { ...experiment(), scale: 0 } },
      { type: "experiment", at: 1, experiment: experiment({ scene: [{ id: "m", shape: { kind: "mesh", vertices: [0, 0, 0], indices: [0, 1, 2] } }] }) },
      { type: "experiment", at: 1, experiment: experiment({ scene: [{ id: "m", shape: { kind: "mesh", vertices: new Array(20_001 * 3).fill(0), indices: [] } }] }) },
      { type: "experiment", at: 1, experiment: experiment({ scene: [{ id: "b", shape: { kind: "box", size: [1, -1, 1] } }] }) },
      { type: "experiment", at: 1, experiment: experiment({ scene: [{ id: "b", shape: { kind: "box", size: [1, 1, 1] }, color: "red" }] }) },
      { type: "notice", at: 1, severity: "fatal", title: "x" },
      { type: "weather", at: 1 },
      { type: "weather", at: 1, weather: { ...weather(), temperature: Number.NaN } },
      { type: "weather", at: 1, weather: { ...weather(), cloud: 3 } },
      { type: "weather", at: 1, weather: { ...weather(), place: "x".repeat(200) } },
    ];
    for (const b of bad) expect(readWorldEvent(b)).toBeNull();
  });

  test("weather it can't read in a hello, or of a kind it doesn't know, is unknown weather, not a lost hello", () => {
    const e = readWorldEvent({ ...hello(), weather: { ...weather(), wind: -1 } });
    expect(e?.type === "hello" && e.weather).toBeNull();
    const hail = readWorldEvent({ type: "weather", at: 1, weather: { ...weather(), kind: "hail" } });
    expect(hail).toEqual({ type: "weather", at: 1, weather: null });
  });

  test("a station or engine it doesn't know yet is shown as the keep or a custom engine", () => {
    const e = readWorldEvent({ ...hello(), galahad: { station: "stables", doing: "", experiment: null, model: null, since: 0 }, experiments: [{ ...experiment(), engine: "drake" }] });
    expect(e?.type === "hello" && e.galahad.station).toBe("keep");
    expect(e?.type === "hello" && e.experiments[0]!.engine).toBe("custom");
  });
});

describe("words", () => {
  test("metric labels and values", () => {
    expect(metricLabel("altitude_m")).toBe("altitude (m)");
    expect(metricLabel("speed_mps")).toBe("speed (m/s)");
    expect(metricLabel("reward")).toBe("reward");
    expect(metricValue(1234.5)).toBe("1 235");
    expect(metricValue(12.345)).toBe("12.3");
    expect(metricValue(0.5)).toBe("0.50");
    expect(metricValue(0.0012)).toBe("1.2e-3");
  });

  test("the summary names what he does and every experiment, never poses", () => {
    let w = applyWorldEvent(emptyWorld(), hello({ experiments: [experiment(), experiment({ id: "x2", title: "Rocket", engine: "rocketpy", status: "done", endedAt: 5, summary: "Apogee 900 m" })] }));
    w = applyWorldEvent(w, { type: "galahad", at: 11, galahad: { station: "field", doing: "Watching the rocket", experiment: "x2", model: "m1", since: 11 } });
    const text = worldSummary(w);
    expect(text).toContain("Galahad is out at Rocket: Watching the rocket.");
    expect(text).toContain("Thinking with m1.");
    expect(text).toContain("Arm reach (MuJoCo), running on open land, on ultra.");
    expect(text).toContain("Rocket (RocketPy), done on open land, on ultra: Apogee 900 m.");
    const moved = applyWorldEvent(w, { type: "frame", at: 12, frame: { experiment: "x1", t: 1, poses: { link: [1, 2, 3, 1, 0, 0, 0] }, metrics: { reward: 1 } } });
    expect(worldSummary(moved)).toBe(text);
  });

  test("an experiment on a pad is said to be on the proving ground or in the workshop", () => {
    const pad = (id: string) => {
      const p = PADS.find((x) => x.id === id)!;
      return { x: p.x, y: p.y, size: p.size };
    };
    expect(experimentPlace(experiment({ plot: pad("flight") }))).toBe("on the proving ground");
    expect(experimentPlace(experiment({ plot: pad("course") }))).toBe("on the proving ground");
    expect(experimentPlace(experiment({ plot: pad("cell-3") }))).toBe("in the workshop");
    expect(experimentPlace(experiment())).toBe("on open land");
    const w = applyWorldEvent(emptyWorld(), hello({ experiments: [experiment({ plot: pad("cell-1") })] }));
    expect(worldSummary(w)).toContain("Arm reach (MuJoCo), running in the workshop, on ultra.");
  });

  test("an experiment cleared from its pad leaves the model, with its frames; clearing one it doesn't know changes nothing", () => {
    let w = applyWorldEvent(emptyWorld(), hello({ experiments: [experiment(), experiment({ id: "x2", status: "done", endedAt: 5 })] }));
    w = applyWorldEvent(w, { type: "frame", at: 11, frame: { experiment: "x2", t: 1, poses: { link: [1, 2, 3, 1, 0, 0, 0] } } });
    expect(Object.keys(w.frames)).toEqual(["x2"]);
    const event = readWorldEvent({ type: "cleared", at: 12, experiment: "x2" })!;
    expect(event).toEqual({ type: "cleared", at: 12, experiment: "x2" });
    const cleared = applyWorldEvent(w, event);
    expect(cleared.experiments.map((e) => e.id)).toEqual(["x1"]);
    expect(cleared.frames).toEqual({});
    expect(applyWorldEvent(cleared, event)).toBe(cleared);
    expect(readWorldEvent({ type: "cleared", at: 12 })).toBeNull();
    expect(readWorldEvent({ type: "cleared", at: 12, experiment: "x".repeat(500) })).toBeNull();
  });

  test("the summary says the weather in Denmark when it's known", () => {
    const w = applyWorldEvent(emptyWorld(), hello({ weather: weather({ kind: "rain", temperature: 6.6, precipitation: 1.2 }) }));
    expect(worldSummary(w)).toContain("In Copenhagen: rain, 7 °C.");
    expect(weatherLabel(weather({ kind: "clear" }))).toBe("Clear");
    expect(weatherLabel(weather({ kind: "storm" }))).toBe("Thunder");
    expect(worldSummary(applyWorldEvent(emptyWorld(), hello()))).not.toContain("Copenhagen");
  });
});

describe("keeping the stream open", () => {
  const sleeps: number[] = [];
  const sleep = async (ms: number) => {
    sleeps.push(ms);
  };

  test("reconnects with growing backoff, resets after a hello, and stops when aborted", async () => {
    sleeps.length = 0;
    const controller = new AbortController();
    const statuses: StreamStatus[] = [];
    const seen: string[] = [];
    let opens = 0;
    await followWorld({
      async *open() {
        opens++;
        if (opens === 1 || opens === 2) throw new TypeError("network");
        if (opens === 3) {
          yield { type: "thought", at: 1, text: "before hello: ignored" };
          yield JSON.parse(JSON.stringify(hello()));
          yield { type: "thought", at: 2, text: "after" };
          yield { type: "garbage" };
          return;
        }
        controller.abort();
      },
      onEvent: (e) => seen.push(e.type === "thought" ? e.text : e.type),
      onStatus: (s) => statuses.push(s),
      unavailable: () => false,
      signal: controller.signal,
      sleep,
    });
    expect(seen).toEqual(["hello", "after"]);
    expect(statuses).toEqual(["connecting", "reconnecting", "live", "reconnecting"]);
    expect(sleeps).toEqual([1000, 2000, 1000]);
    expect(backoffMs(10)).toBe(30_000);
  });

  test("a node without the world says so, and is asked again later", async () => {
    sleeps.length = 0;
    const controller = new AbortController();
    const statuses: StreamStatus[] = [];
    let opens = 0;
    await followWorld({
      async *open() {
        if (++opens === 3) controller.abort();
        throw Object.assign(new Error("not found"), { status: 404 });
      },
      onEvent: () => {},
      onStatus: (s) => statuses.push(s),
      unavailable: (e) => (e as { status?: number }).status === 404,
      signal: controller.signal,
      sleep,
      unavailableRetryMs: 60_000,
    });
    expect(statuses).toEqual(["connecting", "unavailable"]);
    expect(sleeps).toEqual([60_000, 60_000]);
  });
});

describe("his dog's name", () => {
  const raw = (over: Record<string, unknown> = {}) => ({ ...(hello() as unknown as Record<string, unknown>), ...over });

  test("unnamed until the node says: a hello with a companion names it, a companion event renames or unnames it", () => {
    expect(emptyWorld().companion).toBeNull();
    let w = applyWorldEvent(emptyWorld(), hello());
    expect(w.companion).toBeNull();
    w = applyWorldEvent(w, { type: "companion", at: 11, companion: { name: "Bors" } });
    expect(w.companion).toEqual({ name: "Bors" });
    expect(w.at).toBe(11);
    w = applyWorldEvent(w, { type: "companion", at: 12, companion: null });
    expect(w.companion).toBeNull();
    // A reconnect's hello is the truth again: named there, named here; not said there, unnamed here.
    w = applyWorldEvent(w, hello({ at: 20, companion: { name: "Cavall" } }));
    expect(w.companion).toEqual({ name: "Cavall" });
    expect(applyWorldEvent(w, hello({ at: 30 })).companion).toBeNull();
  });

  test("read at the boundary: a name that isn't one is no name, never a reason to lose the world", () => {
    expect(readWorldEvent(raw({ companion: { name: "Bors" } }))).toMatchObject({ type: "hello", companion: { name: "Bors" } });
    expect(readWorldEvent(raw({ companion: { name: "Sir Kay-2", breed: "hound" } }))).toMatchObject({ companion: { name: "Sir Kay-2" } });
    for (const bad of [{ name: "<img src=x>" }, { name: "" }, { name: "x".repeat(25) }, { name: 7 }, "Bors", null, 3]) {
      const read = readWorldEvent(raw({ companion: bad }));
      expect(read).toMatchObject({ type: "hello" });
      expect((read as { companion?: unknown }).companion).toBeUndefined();
    }
    // An older node says nothing of a dog's name.
    expect((readWorldEvent(raw()) as { companion?: unknown }).companion).toBeUndefined();
  });

  test("the event: a name, or none; a malformed one is ignored", () => {
    expect(readWorldEvent({ type: "companion", at: 5, companion: { name: "Bors" } })).toEqual({ type: "companion", at: 5, companion: { name: "Bors" } });
    expect(readWorldEvent({ type: "companion", at: 5, companion: null })).toEqual({ type: "companion", at: 5, companion: null });
    expect(readWorldEvent({ type: "companion", at: 5, companion: { name: "Rex!" } })).toBeNull();
    expect(readWorldEvent({ type: "companion", at: 5 })).toBeNull();
    expect(readWorldEvent({ type: "companion", companion: null })).toBeNull();
  });
});
