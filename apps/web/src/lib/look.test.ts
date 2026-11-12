import { describe, expect, test } from "bun:test";
import { type ExperimentView, PADS, SITES, STATIONS } from "@galahad/core/world";
import { dogLine, HIS_PLACES, lookingAt, lookOptions, matches, runningCount, wildLine } from "./look.ts";
import { applyWorldEvent, emptyWorld, type WorldModel } from "./world.ts";

const experiment = (over: Partial<ExperimentView> = {}): ExperimentView => ({
  id: "x1",
  title: "Arm reach",
  engine: "mujoco",
  status: "running",
  plot: { x: 110, y: 110, size: 48 },
  scale: 1,
  scene: [],
  startedAt: 1,
  endedAt: null,
  nodeName: "ultra",
  sandbox: null,
  quest: null,
  metrics: {},
  summary: null,
  ...over,
});

function world(experiments: ExperimentView[], galahad: Partial<WorldModel["galahad"]> = {}): WorldModel {
  return applyWorldEvent(emptyWorld(), {
    type: "hello",
    at: 10,
    galahad: { station: "keep", doing: "", experiment: null, model: null, since: 0, ...galahad },
    nodes: [],
    experiments,
    thoughts: [],
  });
}

describe("the SANDBOX's selector", () => {
  test("words match the start of words, whatever the case or accents", () => {
    expect(matches("Proving ground", "prov gr")).toBe(true);
    expect(matches("Proving ground", "ground")).toBe(true);
    expect(matches("Proving ground", "round")).toBe(false);
    expect(matches("Messenger's post", "messenger")).toBe(true);
    expect(matches("Café robot", "cafe")).toBe(true);
    expect(matches("anything", "  ")).toBe(true);
  });

  test("Galahad first, then running experiments before ended ones (newest first), the sites, then the keep", () => {
    const flight = PADS.find((p) => p.id === "flight")!;
    const m = world(
      [
        experiment({ id: "old", title: "Old run", status: "done", startedAt: 1, endedAt: 5 }),
        experiment({ id: "new", title: "New run", status: "running", startedAt: 9, plot: { x: flight.x, y: flight.y, size: flight.size } }),
        experiment({ id: "mid", title: "Mid run", status: "failed", startedAt: 2, endedAt: 8 }),
      ],
      { station: "field", experiment: "new", doing: "Watching the flight" },
    );
    const options = lookOptions(m);
    expect(options[0]).toMatchObject({ group: "Galahad", label: "Galahad", meta: "Watching the flight" });
    expect(options.filter((o) => o.group === "Experiments").map((o) => o.label)).toEqual(["New run", "Mid run", "Old run"]);
    expect(options.find((o) => o.label === "New run")).toMatchObject({ live: true, tone: "ok", here: true, meta: "MuJoCo · Running on the proving ground" });
    const groups = options.map((o) => o.group);
    expect(groups.indexOf("Test sites")).toBeGreaterThan(groups.lastIndexOf("Experiments"));
    expect(groups.indexOf("The keep")).toBeGreaterThan(groups.lastIndexOf("Test sites"));
    // He's out at the flight, on the proving ground: that site is marked.
    expect(options.find((o) => o.label === SITES.field.label)?.here).toBe(true);
    // His own places, then the keep's stations.
    expect(options.filter((o) => o.group === "The keep").map((o) => o.label)).toEqual(["His hearth", "The bench by the lake", ...Object.values(STATIONS).map((s) => s.label)]);
  });

  test("the station he's at is marked, and the search narrows everything", () => {
    const m = world([experiment()], { station: "library", doing: "Recalling" });
    expect(lookOptions(m).find((o) => o.label === STATIONS.library.label)).toMatchObject({ here: true, meta: "Galahad is here" });
    expect(lookOptions(m, "arm").map((o) => o.label)).toEqual(["Arm reach"]);
    expect(lookOptions(m, "work").map((o) => o.label)).toEqual(["Workshop"]);
    // A group's name finds its members.
    expect(lookOptions(m, "test sites").map((o) => o.label)).toEqual([SITES.field.label, SITES.hall.label]);
    expect(lookOptions(m, "zzz")).toEqual([]);
  });

  test("what the view is on: the open experiment, Galahad when following, else what's under the focus", () => {
    const cell = PADS.find((p) => p.id === "cell-2")!;
    const m = world([experiment(), experiment({ id: "x2", title: "Gripper", plot: { x: cell.x, y: cell.y, size: cell.size } })], { doing: "Checking the fleet" });
    expect(lookingAt(m, { x: 0, y: 0 }, true, "x1")).toMatchObject({ label: "Arm reach", meta: "Running" });
    expect(lookingAt(m, { x: 500, y: 500 }, true, null)).toMatchObject({ label: "Galahad", meta: "Checking the fleet" });
    expect(lookingAt(m, { x: 112, y: 104 }, false, null).label).toBe("Arm reach");
    // A cell in the hall is the experiment's, before the hall.
    expect(lookingAt(m, { x: cell.x, y: cell.y }, false, null).label).toBe("Gripper");
    expect(lookingAt(m, { x: SITES.hall.x - 20, y: SITES.hall.y }, false, null).label).toBe(SITES.hall.label);
    expect(lookingAt(m, { x: SITES.field.x, y: SITES.field.y }, false, null).label).toBe(SITES.field.label);
    expect(lookingAt(m, { x: STATIONS.library.x + 3, y: STATIONS.library.y }, false, null).label).toBe(STATIONS.library.label);
    expect(lookingAt(m, { x: 400, y: -400 }, false, null)).toEqual({ label: "Exploring", meta: "", target: null });
  });

  test("counts what's still running", () => {
    expect(runningCount(world([experiment(), experiment({ id: "b", status: "starting" }), experiment({ id: "c", status: "done", endedAt: 3 })]))).toBe(2);
  });

  test("his dog by its name and what it's doing, his journal, his hearth and the bench: there to look at, and marked when his day has him there", () => {
    const m = world([], { idle: true });
    const unnamed = lookOptions(m, "", "Morning rounds", 0, null);
    expect(unnamed.slice(0, 4).map((o) => o.label)).toEqual(["Galahad", "His dog", "Chalkboard", "His journal"]);
    expect(unnamed[1]).toMatchObject({ target: { kind: "dog" }, meta: "Always with him", icon: "paw" });
    expect(unnamed[3]).toMatchObject({ target: { kind: "journal" }, icon: "journal" });
    // Named, with its battery and what it's doing.
    const named = lookOptions(m, "", "Writing his journal", 0, { name: "Bors", state: "lying by him", charge: 0.823 });
    expect(named[1]).toMatchObject({ label: "Bors", meta: "Lying by him · battery 82 %" });
    expect(dogLine({ name: "", state: "asleep", charge: 1.4 })).toBe("Asleep · battery 100 %");
    expect(lookOptions(m, "bors", "", 0, { name: "Bors", state: "with him", charge: 1 }).map((o) => o.label)).toEqual(["Bors"]);
    // At his desk in the evening: his hearth is where he is, not the keep the stream leaves him at.
    const hearth = named.find((o) => o.label === "His hearth")!;
    expect(hearth).toMatchObject({ here: true, target: { kind: "place", place: "hearth" }, icon: "flame" });
    expect(named.find((o) => o.label === STATIONS.keep.label)).toMatchObject({ here: false, meta: "" });
    expect(named.find((o) => o.label === "The bench by the lake")?.here).toBe(false);
    for (const life of ["Asleep at his hearth, the dog beside him", "By the fire with Bors", "Woken by the dog", "Turning in: a last pat for the dog"]) {
      expect(lookOptions(m, "", life).find((o) => o.label === "His hearth")?.here).toBe(true);
    }
    expect(lookOptions(m, "", "Thinking by the lake, the dog at his feet").find((o) => o.label === "The bench by the lake")?.here).toBe(true);
    // At work, his station is where he is, whatever his day would have been.
    const working = lookOptions(world([], { station: "library", doing: "Reading" }), "", "");
    expect(working.find((o) => o.label === STATIONS.library.label)?.here).toBe(true);
    expect(working.find((o) => o.label === "His hearth")?.here).toBe(false);
    // The view over one of his places says so.
    expect(lookingAt(m, { x: HIS_PLACES.hearth.x + 2, y: HIS_PLACES.hearth.y }, false, null)).toMatchObject({ label: "His hearth", target: { kind: "place", place: "hearth" } });
    expect(lookingAt(m, { x: HIS_PLACES.bench.x, y: HIS_PLACES.bench.y + 3 }, false, null).label).toBe("The bench by the lake");
  });

  test("the wildlife that's about: each kind with how many, its young and what most are doing; picking one goes to the nearest", () => {
    const m = world([], { idle: true });
    const wild = [
      { kind: "roe", name: "Roe deer", count: 5, young: 2, doing: "grazing" },
      { kind: "hare", name: "Hare", count: 9, young: 0, doing: "feeding" },
      { kind: "owl", name: "Tawny owl", count: 0, young: 0, doing: "" },
      { kind: "bumblebee", name: "Bumblebee", count: 14, young: 0, doing: "" },
    ];
    const options = lookOptions(m, "", "", 0, null, wild).filter((o) => o.group === "Wildlife");
    // (What isn't about isn't listed.)
    expect(options.map((o) => [o.label, o.meta])).toEqual([
      ["Roe deer", "5 · 2 young · grazing"],
      ["Hare", "9 · feeding"],
      ["Bumblebee", "14"],
    ]);
    expect(options[0]).toMatchObject({ target: { kind: "wild", species: "roe" }, icon: "paw" });
    expect(wildLine(wild[0]!)).toBe("5 · 2 young · grazing");
    // The last group; found by name, by what they're doing, or as "wildlife".
    const all = lookOptions(m, "", "", 0, null, wild);
    expect(all.at(-1)!.group).toBe("Wildlife");
    expect(lookOptions(m, "roe", "", 0, null, wild).map((o) => o.label)).toEqual(["Roe deer"]);
    expect(lookOptions(m, "grazing", "", 0, null, wild).map((o) => o.label)).toEqual(["Roe deer"]);
    expect(lookOptions(m, "wildlife", "", 0, null, wild)).toHaveLength(3);
    // None about (a node's world before the page has stepped): no group.
    expect(lookOptions(m).some((o) => o.group === "Wildlife")).toBe(false);
  });
});
