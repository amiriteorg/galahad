import { heightAt, SEED, BASE_FLATS, WATER_LEVEL, waterAtHeight } from "./terrain.ts";
const h = (x: number, y: number) => heightAt(SEED, x, y, BASE_FLATS);
const w = (x: number, y: number) => waterAtHeight(SEED, x, y, h(x, y), BASE_FLATS);
for (const x of [-12, -6, -2, 2, 8, 14]) {
  let line = `x=${x}: `;
  for (let y = -38; y >= -58; y -= 2) line += `${y}:${h(x, y).toFixed(2)}${h(x, y) < w(x, y) + 0.05 ? "~" : ""} `;
  console.log(line);
}
console.log("water level", WATER_LEVEL, "hearth h", h(2, -18), h(-3, -18), h(5, -17));
const pts: [number, number][] = [[2, -24], [-10, -30], [-16, -40], [-8, -46], [-2, -46], [12, -44], [24, -38], [36, -26], [40, -16], [30, -14], [16, -20]];
for (const [x, y] of pts) console.log(x, y, h(x, y).toFixed(2), w(x, y).toFixed(2), h(x, y) < w(x, y) + 0.3 ? "WET" : "dry");
