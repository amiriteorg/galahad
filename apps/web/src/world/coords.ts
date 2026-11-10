/*
 * The contract's frame is z up (x east, y north); three.js is y up. The scene
 * maps a world point (x, y, z) to (x, z, −y): a proper rotation (−90° about x),
 * so handedness and every orientation survive. Experiments keep their own z-up
 * frame inside a plot group turned the same way.
 */

export type Vec3 = [number, number, number];

export const toScene = (x: number, y: number, z = 0): Vec3 => [x, z, -y];
export const fromScene = (sx: number, sy: number, sz: number): Vec3 => [sx, -sz, sy];

export interface Plot {
  x: number;
  y: number;
  size: number;
}

/** An experiment's own coordinates on its plot: scaled, then offset by the plot's centre (the contract's rule). */
export const plotToWorld = (plot: Plot, scale: number, p: Vec3): Vec3 => [plot.x + p[0] * scale, plot.y + p[1] * scale, p[2] * scale];

/** The inverse, for picking: a world point in the experiment's own coordinates. */
export const worldToPlot = (plot: Plot, scale: number, p: Vec3): Vec3 => [(p[0] - plot.x) / scale, (p[1] - plot.y) / scale, p[2] / scale];

/** True when the world point (x, y) stands on the plot. */
export const onPlot = (plot: Plot, x: number, y: number, margin = 0): boolean => Math.abs(x - plot.x) <= plot.size / 2 + margin && Math.abs(y - plot.y) <= plot.size / 2 + margin;

/**
 * A heading in the world (radians, counter-clockwise from east, as atan2(dy, dx))
 * as a turn about the scene's up axis for a model whose front faces scene +z.
 */
export const headingToSceneYaw = (heading: number): number => heading + Math.PI / 2;
