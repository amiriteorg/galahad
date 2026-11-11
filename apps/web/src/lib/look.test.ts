import { describe, expect, test } from "bun:test";
import { type ExperimentView, PADS, SITES, STATIONS } from "@galahad/core/world";
import { lookingAt, lookOptions, matches, runningCount } from "./look.ts";
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
    expect(options.filter((o) => o.group === "The keep")).toHaveLength(Object.keys(STATIONS).length);
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
});
