import { describe, expect, test } from "bun:test";
import { type ExperimentView, PADS } from "@galahad/core/world";
import { Box3, type Mesh } from "three/webgpu";
import { HALL, HALL_AISLE } from "./hall-plan.ts";
import { Plots } from "./plots.ts";

const COLORS = { accent: 0xe8853a, ok: 0x3aa66a, warn: 0xd89a2b, danger: 0xd24b3e, neutral: 0x9a9ea6 };
const emitter = { exhaustAt() {} };

const experiment = (plot: ExperimentView["plot"]): ExperimentView => ({
  id: "ex1",
  title: "Gripper on the bench",
  engine: "mujoco",
  status: "running",
  plot,
  scale: 1,
  scene: [{ id: "base", shape: { kind: "box", size: [1, 1, 1] }, fixed: true }],
  startedAt: 0,
  endedAt: null,
  nodeName: "ultra",
  sandbox: null,
  quest: null,
  metrics: {},
  summary: null,
});

/** The plot's own furniture (fence, sign, dome), as a box in world metres (x east, y north). */
function furniture(plots: Plots, id: string): { minX: number; maxX: number; minY: number; maxY: number } | null {
  const plot = plots.get(id)!;
  plot.base.updateMatrixWorld(true);
  const box = new Box3();
  for (const child of plot.base.children) {
    if (!child.userData.fence) continue;
    const mesh = child as Mesh;
    mesh.geometry.computeBoundingBox();
    if (!mesh.geometry.boundingBox || mesh.geometry.boundingBox.isEmpty()) continue;
    box.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
  }
  if (box.isEmpty()) return null;
  // Scene (x, y up, z = −north) back to the world's frame.
  return { minX: box.min.x, maxX: box.max.x, minY: -box.max.z, maxY: -box.min.z };
}

describe("a plot's own furniture", () => {
  test("a test cell in the hall has no signpost of its own: nothing stands in the aisle, and the label floats over the cell", () => {
    const cell = PADS.find((p) => p.id === "cell-1")!;
    const plots = new Plots(COLORS, false, emitter);
    plots.sync([experiment({ x: cell.x, y: cell.y, size: cell.size })], {});
    const box = furniture(plots, "ex1");
    // Nothing of it reaches the aisle (the cell's own fence, gate and stack light are the hall's).
    if (box) expect(box.minY).toBeGreaterThan(HALL.y + HALL_AISLE);
    const sign = plots.get("ex1")!.signPoint;
    expect(Math.abs(sign[0] - cell.x)).toBeLessThanOrEqual(cell.size / 2);
    expect(Math.abs(sign[1] - cell.y)).toBeLessThanOrEqual(cell.size / 2);
    plots.dispose();
  });

  test("a plot on open land keeps its fence, and its signpost stands outside it by the gate, even on a plot diagonal from the keep", () => {
    // (On a diagonal plot the sign stood inside the fence: the gate was placed on a circle, not on the square.)
    for (const plot of [{ x: 110, y: 110, size: 48 }, { x: 0, y: 110, size: 96 }, { x: -110, y: 110, size: 24 }]) {
      const plots = new Plots(COLORS, false, emitter);
      plots.sync([experiment(plot)], {});
      const box = furniture(plots, "ex1")!;
      expect(box.maxX - box.minX).toBeGreaterThan(plot.size);
      const sign = plots.get("ex1")!.signPoint;
      expect(Math.max(Math.abs(sign[0] - plot.x), Math.abs(sign[1] - plot.y))).toBeGreaterThan(plot.size / 2 + 1);
      // On the keep's side.
      expect(Math.hypot(sign[0], sign[1])).toBeLessThan(Math.hypot(plot.x, plot.y));
      plots.dispose();
    }
  });
});
