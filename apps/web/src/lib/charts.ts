/*
 * A readout's chart, as plain SVG geometry: its line over simulation time, scaled into a box, and the
 * mapping a playhead uses. No chart library: a few numbers into a path. Pure, so unit-tested; the
 * panel draws it (views/world-replay.ts).
 */

export interface ChartGeometry {
  /** The line, as an SVG path ("M x y L x y …"). */
  path: string;
  /** What the box's bottom and top stand for (a flat readout gets a little room either side). */
  min: number;
  max: number;
  t0: number;
  t1: number;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

export function chartGeometry(series: readonly (readonly [number, number])[], width: number, height: number, pad = 2): ChartGeometry {
  if (!series.length) return { path: "", min: 0, max: 1, t0: 0, t1: 1 };
  const t0 = series[0]![0];
  const t1 = series.length > 1 && series.at(-1)![0] > t0 ? series.at(-1)![0] : t0 + 1;
  let min = Infinity;
  let max = -Infinity;
  for (const [, v] of series) {
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  if (max - min < 1e-12 * Math.max(1, Math.abs(max))) {
    const room = Math.abs(max) * 0.05 || 1;
    min -= room;
    max += room;
  }
  const g = { min, max, t0, t1 };
  const parts = series.map(([t, v], i) => `${i ? "L" : "M"}${r1(chartX(g, t, width, pad))} ${r1(chartY(g, v, height, pad))}`);
  return { path: parts.join(" "), ...g };
}

/** Where simulation time `t` falls across the box (clamped to it). */
export function chartX(g: Pick<ChartGeometry, "t0" | "t1">, t: number, width: number, pad = 2): number {
  const u = Math.max(0, Math.min(1, (t - g.t0) / (g.t1 - g.t0)));
  return pad + u * (width - 2 * pad);
}

/** Where a value falls up the box (higher values higher). */
export function chartY(g: Pick<ChartGeometry, "min" | "max">, v: number, height: number, pad = 2): number {
  const u = (v - g.min) / (g.max - g.min);
  return height - pad - u * (height - 2 * pad);
}
