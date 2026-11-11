import { BASE_FLATS, heightAt, SEED, WATER_LEVEL, waterAtHeight } from "./terrain.ts";

/*
 * The world as a small map, north up: the window of land the HUD's map shows
 * (the keep, the proving ground to its west, the workshop to its east, the lake
 * to the south and the nearest plots), and a sketch of that land (water, and
 * how high the ground is) to draw under the markers. Pure, so unit-tested.
 */

/** The map's window: its centre and its side (world metres). */
export const MAP_VIEW = { x: -35, y: 0, span: 400 } as const;

/** A world point on the map: u east and v south, 0 to 1 across the window (outside it: beyond 0 or 1). */
export function mapPoint(x: number, y: number, out: [number, number] = [0, 0]): [number, number] {
  out[0] = (x - MAP_VIEW.x) / MAP_VIEW.span + 0.5;
  out[1] = 0.5 - (y - MAP_VIEW.y) / MAP_VIEW.span;
  return out;
}

/** The world point under a point of the map. */
export function mapToWorld(u: number, v: number, out: [number, number] = [0, 0]): [number, number] {
  out[0] = MAP_VIEW.x + (u - 0.5) * MAP_VIEW.span;
  out[1] = MAP_VIEW.y + (0.5 - v) * MAP_VIEW.span;
  return out;
}

/**
 * The land in the map's window as n x n cells, north at the top: 0 for water,
 * otherwise 1 (the shore) to 255 (11 m up) for the ground's height.
 */
export function sketchLand(n: number): Uint8Array {
  const out = new Uint8Array(n * n);
  const at: [number, number] = [0, 0];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      mapToWorld((i + 0.5) / n, (j + 0.5) / n, at);
      const h = heightAt(SEED, at[0], at[1], BASE_FLATS);
      if (waterAtHeight(SEED, at[0], at[1], h, BASE_FLATS) > Number.NEGATIVE_INFINITY) continue;
      out[j * n + i] = 1 + Math.round(Math.max(0, Math.min(1, (h - WATER_LEVEL) / (11 - WATER_LEVEL))) * 254);
    }
  }
  return out;
}
