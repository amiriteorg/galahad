import { describe, expect, test } from "bun:test";
import {
  blow,
  CELL,
  CELLS,
  cloudAt,
  cloudKinds,
  cloudShade,
  cloudSpeed,
  CUMULUS_BASE,
  cumulusOver,
  emptyCloud,
  emptyKinds,
  emptyTravel,
  FIELD,
  hash32,
  shadowCaster,
  SHEET_HEIGHT,
  SHEET_SPEED,
  sheetEdge,
  sheetField,
  sheetOver,
  sheetReach,
  SQUASH,
  TOWER_SHARE,
} from "./clouds.ts";

/*
 * The clouds as numbers: the kinds a weather makes, the field of low clouds,
 * the sheet, how the wind carries them, and the shadows they throw.
 */

const kinds = emptyKinds();
const cloud = emptyCloud();
const RAD = Math.PI / 180;

describe("the kinds of cloud", () => {
  const of = (w: { cloud: number; rain?: number; mist?: number; snow?: number; storm?: number }, sun = 45, warmth = 1) => ({ ...cloudKinds({ rain: 0, mist: 0, ...w }, sun, warmth, kinds) });

  test("a clear sky has none", () => {
    const k = of({ cloud: 0 });
    expect(k.cumulus + k.sheet + k.cirrus + k.towers).toBe(0);
    expect(k.kind).toBe("clear");
  });

  test("a summer's day of broken cloud is cumulus: heaps, hardly any sheet", () => {
    const k = of({ cloud: 0.4 }, 50, 1);
    expect(k.kind).toBe("cumulus");
    expect(k.cumulus).toBeGreaterThan(0.4);
    expect(k.sheet).toBeLessThan(0.08);
    expect(k.towers).toBe(0);
  });

  test("the same cover at night, or in winter, lies as a sheet with few heaps", () => {
    const night = of({ cloud: 0.4 }, -20, 1);
    expect(night.sheet).toBeGreaterThan(0.25);
    expect(night.cumulus).toBeLessThan(night.sheet);
    expect(night.kind).toBe("stratocumulus");
    const winter = of({ cloud: 0.4 }, 11, 0);
    expect(winter.cumulus).toBeLessThan(of({ cloud: 0.4 }, 50, 1).cumulus * 0.6);
  });

  test("a little cloud is cirrus, high and thin, most when nothing is rising", () => {
    const k = of({ cloud: 0.15 }, -20, 0.3);
    expect(k.cirrus).toBeGreaterThan(0.4);
    expect(k.kind).toBe("cirrus");
    // None in a clear sky, under a closed one, or in rain.
    expect(of({ cloud: 0 }).cirrus).toBe(0);
    expect(of({ cloud: 0.9 }).cirrus).toBeLessThan(0.01);
    expect(of({ cloud: 0.3, rain: 0.8 }).cirrus).toBeLessThan(0.1);
  });

  test("as the cover closes the sheet takes over, and an overcast sky is a lid", () => {
    let last = -1;
    for (let c = 0; c <= 1.0001; c += 0.05) {
      const k = of({ cloud: Math.min(1, c) }, 30, 0.6);
      expect(k.sheet).toBeGreaterThanOrEqual(last - 1e-9);
      last = k.sheet;
    }
    const lid = of({ cloud: 1 });
    expect(lid.sheet).toBe(1);
    expect(lid.kind).toBe("stratus");
    expect(of({ cloud: 0.85 }, 30, 0.6).sheet).toBeGreaterThan(0.6);
  });

  test("mist keeps the heaps down: its cloud is sheet", () => {
    const k = of({ cloud: 0.35, mist: 0.75 }, 30, 1);
    expect(k.sheet).toBeGreaterThan(k.cumulus);
  });

  test("rain falls from a lid with scud under it; thunder brings towers", () => {
    const rain = of({ cloud: 0.92, rain: 1, mist: 0.2 });
    expect(rain.sheet).toBeGreaterThan(0.9);
    expect(rain.scud).toBe(1);
    expect(rain.cumulus).toBeGreaterThan(0.2);
    expect(rain.towers).toBe(0);
    expect(rain.kind).toBe("nimbostratus");
    const storm = of({ cloud: 1, rain: 1, storm: 1 });
    expect(storm.towers).toBe(1);
    expect(storm.sheet).toBe(1);
    expect(storm.kind).toBe("cumulonimbus");
    const snow = of({ cloud: 0.88, snow: 0.8, mist: 0.3 });
    expect(snow.sheet).toBeGreaterThan(0.85);
    expect(snow.kind).toBe("nimbostratus");
  });

  test("nothing jumps as the weather eases: every share moves a little for a little", () => {
    for (const [sun, warmth] of [[50, 1], [-20, 0.2], [8, 0.5]] as const) {
      let before = of({ cloud: 0 }, sun, warmth);
      for (let i = 1; i <= 200; i++) {
        const c = i / 200;
        const now = of({ cloud: c, rain: Math.max(0, c - 0.6) * 2.5, storm: Math.max(0, c - 0.9) * 10 }, sun, warmth);
        for (const key of ["cumulus", "sheet", "cirrus", "towers", "scud"] as const) {
          expect(Math.abs(now[key] - before[key])).toBeLessThan(0.08);
          expect(now[key]).toBeGreaterThanOrEqual(0);
          expect(now[key]).toBeLessThanOrEqual(1);
        }
        before = now;
      }
    }
  });
});

describe("the field of low clouds", () => {
  test("the hash is the GPU's: PCG on 32-bit integers, evenly spread", () => {
    // (Worked by hand from three's TSL hash for seed 1: state 3639133150, word 2647919483, result 2647920114.)
    const state = (Math.imul(1, 747796405) + 2891336453) >>> 0;
    const word = Math.imul((state >>> ((state >>> 28) + 4)) ^ state, 277803737) >>> 0;
    expect(hash32(1)).toBe((((word >>> 22) ^ word) >>> 0) / 4294967296);
    let sum = 0;
    const tenths = new Array<number>(10).fill(0);
    for (let i = 0; i < 20000; i++) {
      const h = hash32(i);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
      sum += h;
      tenths[Math.floor(h * 10)]!++;
    }
    expect(sum / 20000).toBeCloseTo(0.5, 1);
    for (const n of tenths) expect(Math.abs(n - 2000)).toBeLessThan(220);
  });

  test("each cell's cloud stays in its cell, whatever its size, so one look-up finds the cloud over any point", () => {
    for (let cj = 0; cj < CELLS; cj++) {
      for (let ci = 0; ci < CELLS; ci++) {
        const c = cloudAt(ci, cj, 1, 0, cloud);
        expect(c.x - c.r).toBeGreaterThanOrEqual(ci * CELL);
        expect(c.x + c.r).toBeLessThanOrEqual((ci + 1) * CELL);
        expect(c.z - c.r).toBeGreaterThanOrEqual(cj * CELL);
        expect(c.z + c.r).toBeLessThanOrEqual((cj + 1) * CELL);
      }
    }
  });

  test("more of them form as the level rises, each growing from nothing; a full field has every one", () => {
    const count = (level: number) => {
      let n = 0;
      for (let cj = 0; cj < CELLS; cj++) for (let ci = 0; ci < CELLS; ci++) if (cloudAt(ci, cj, level, 0, cloud).grown > 0.5) n++;
      return n / (CELLS * CELLS);
    };
    expect(count(0)).toBe(0);
    expect(count(0.25)).toBeGreaterThan(0.1);
    expect(count(0.25)).toBeLessThan(0.36);
    expect(count(0.5)).toBeGreaterThan(count(0.25) + 0.15);
    expect(count(1)).toBe(1);
    // One cloud, as the level passes its rank: it swells smoothly.
    let last = 0;
    for (let level = 0; level <= 1; level += 0.005) {
      const c = cloudAt(3, 7, level, 0, cloud);
      expect(c.r).toBeGreaterThanOrEqual(last - 1e-9);
      expect(c.r - last).toBeLessThan(8);
      last = c.r;
    }
    expect(last).toBeGreaterThan(40);
  });

  test("they are different sizes, turned different ways, and a few are thunderheads", () => {
    const radii: number[] = [];
    const turns = new Set<number>();
    let towers = 0;
    for (let cj = 0; cj < CELLS; cj++) {
      for (let ci = 0; ci < CELLS; ci++) {
        const c = cloudAt(ci, cj, 1, 0, cloud);
        radii.push(c.r);
        turns.add(Math.round(c.turn * 10));
        if (c.tower) towers++;
      }
    }
    expect(Math.max(...radii) / Math.min(...radii)).toBeGreaterThan(1.8);
    expect(turns.size).toBeGreaterThan(20);
    expect(towers).toBeGreaterThan(CELLS * CELLS * TOWER_SHARE * 0.4);
    expect(towers).toBeLessThan(CELLS * CELLS * TOWER_SHARE * 2);
  });

  test("they change slowly: over a minute a cloud hardly swells or fades, over a quarter of an hour it does", () => {
    let most = 0;
    let slowest = 0;
    for (let cj = 0; cj < CELLS; cj++) {
      for (let ci = 0; ci < CELLS; ci++) {
        const a = cloudAt(ci, cj, 0.5, 1000, cloud).grown;
        const b = cloudAt(ci, cj, 0.5, 1060, cloud).grown;
        const c = cloudAt(ci, cj, 0.5, 1900, cloud).grown;
        most = Math.max(most, Math.abs(b - a));
        slowest = Math.max(slowest, Math.abs(c - a));
      }
    }
    expect(most).toBeLessThan(0.3);
    expect(slowest).toBeGreaterThan(0.3);
    // The clock's wrap can't be seen.
    for (let ci = 0; ci < CELLS; ci++) expect(cloudAt(ci, 2, 0.5, 86_400, cloud).grown).toBeCloseTo(cloudAt(ci, 2, 0.5, 0, cloud).grown, 9);
  });

  test("under a cloud there is cloud, beside it there isn't, and everything repeats every field", () => {
    const travel = emptyTravel();
    let under = 0;
    for (let cj = 0; cj < CELLS; cj++) {
      for (let ci = 0; ci < CELLS; ci++) {
        const c = cloudAt(ci, cj, 0.6, 0, cloud);
        if (c.r < 20) {
          // Not formed: the whole cell is open sky.
          expect(cumulusOver((ci + 0.5) * CELL, (cj + 0.5) * CELL, 0.6, travel)).toBeLessThan(c.r < 1 ? 1e-9 : 1.01);
          continue;
        }
        under++;
        expect(cumulusOver(c.x, c.z, 0.6, travel)).toBe(1);
        // Past its long axis' end, and past its narrower side: open sky.
        const ax = Math.cos(c.turn);
        const az = Math.sin(c.turn);
        expect(cumulusOver(c.x + ax * c.r * 1.06, c.z + az * c.r * 1.06, 0.6, travel)).toBe(0);
        expect(cumulusOver(c.x + ax * c.r * 0.7, c.z + az * c.r * 0.7, 0.6, travel)).toBe(1);
        expect(cumulusOver(c.x - az * c.r * SQUASH * 1.06, c.z + ax * c.r * SQUASH * 1.06, 0.6, travel)).toBe(0);
        expect(cumulusOver(c.x + FIELD, c.z - 3 * FIELD, 0.6, travel)).toBeCloseTo(1, 9);
      }
    }
    expect(under).toBeGreaterThan(40);
    expect(cumulusOver(123, 456, 0, travel)).toBe(0);
  });
});

describe("the wind carries them", () => {
  test("clouds drift the way the wind blows, faster in more wind, and stay themselves", () => {
    const travel = emptyTravel();
    const c = { ...cloudAt(4, 4, 0.7, 0, cloud) };
    // A westerly of 6 m/s (blowing towards the east: +x) for a minute.
    blow(travel, 60, 6, 1, 0);
    const moved = cloudSpeed(6) * 60;
    expect(travel.x).toBeCloseTo(moved, 6);
    expect(travel.z).toBe(0);
    expect(moved).toBeGreaterThan(300);
    // The cloud is now that far east: there is cloud over where it has got to, and none where it was (it has left its old place).
    expect(cumulusOver(c.x + moved, c.z, 0.7, { ...travel, clock: 0 })).toBe(1);
    expect(cloudSpeed(14)).toBeGreaterThan(cloudSpeed(3) * 2);
    expect(cloudSpeed(0)).toBeGreaterThan(0);
  });

  test("the sheet rides a faster wind, and both wrap far out without a jump", () => {
    const travel = emptyTravel();
    blow(travel, 10, 5, 0, -1);
    expect(travel.sheetZ).toBeCloseTo(FIELD - cloudSpeed(5) * 10 * SHEET_SPEED, 6);
    expect(travel.z).toBeCloseTo(FIELD - cloudSpeed(5) * 10, 6);
    const before = sheetOver(700, 900, 0.5, travel);
    const lowBefore = cumulusOver(700, 900, 0.6, travel);
    // A long blow: hours of gale. Always inside the field, and the pattern at a whole field's travel is the same.
    for (let i = 0; i < 5000; i++) blow(travel, 7.3, 30, 0.6, 0.8);
    for (const v of [travel.x, travel.z, travel.sheetX, travel.sheetZ]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(FIELD);
    }
    const shifted = { ...emptyTravel(), x: FIELD * 3, z: -FIELD, sheetX: FIELD, sheetZ: 2 * FIELD };
    const zero = emptyTravel();
    expect(sheetOver(700, 900, 0.5, shifted)).toBeCloseTo(sheetOver(700, 900, 0.5, zero), 9);
    expect(cumulusOver(700, 900, 0.6, shifted)).toBeCloseTo(cumulusOver(700, 900, 0.6, zero), 9);
    expect(before).toBeGreaterThanOrEqual(0);
    expect(lowBefore).toBeGreaterThanOrEqual(0);
  });
});

describe("the sheet", () => {
  test("it covers the share of sky asked for, from scattered patches to a lid", () => {
    const travel = emptyTravel();
    const share = (cover: number) => {
      let n = 0;
      const steps = 120;
      for (let i = 0; i < steps; i++) for (let j = 0; j < steps; j++) if (sheetOver((i + 0.5) * (FIELD / steps), (j + 0.5) * (FIELD / steps), cover, travel) > 0.5) n++;
      return n / (steps * steps);
    };
    expect(share(0)).toBe(0);
    for (const cover of [0.15, 0.3, 0.5, 0.7, 0.85]) expect(Math.abs(share(cover) - cover)).toBeLessThan(0.1);
    expect(share(1)).toBe(1);
    expect(share(0.3)).toBeLessThan(share(0.5));
    // The edge falls as the cover grows.
    let last = 2;
    for (let c = 0; c <= 1; c += 0.02) {
      expect(sheetEdge(c)).toBeLessThanOrEqual(last + 1e-12);
      last = sheetEdge(c);
    }
  });

  test("its field is 0..1 and repeats with the field", () => {
    for (let i = 0; i < 2000; i++) {
      const x = hash32(i) * 9000 - 2000;
      const z = hash32(i + 77777) * 9000 - 2000;
      const v = sheetField(x, z);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(sheetField(x + FIELD, z - FIELD)).toBeCloseTo(v, 6);
    }
  });

  test("it is drawn on a shell that comes down to the horizon: never infinitely far, nearer overhead", () => {
    const horizon = sheetReach(0);
    expect(horizon).toBeGreaterThan(1500);
    expect(horizon).toBeLessThan(2600);
    let last = Number.POSITIVE_INFINITY;
    for (let e = 0; e <= 89; e += 1) {
      const r = sheetReach(e * RAD);
      expect(r).toBeLessThan(last);
      last = r;
    }
    // Straight up it is right overhead; high up it is where a flat sheet would be.
    expect(sheetReach(89.9 * RAD)).toBeLessThan(2);
    const flat = SHEET_HEIGHT / Math.tan(60 * RAD);
    expect(Math.abs(sheetReach(60 * RAD) - flat) / flat).toBeLessThan(0.03);
  });
});

describe("their shadows", () => {
  test("a shadow lies where its cloud stands between the land and the sun", () => {
    const out: [number, number] = [0, 0];
    // The sun high in the south-east (scene axes: x east, y up, z south): the cloud that shades a point stands towards the sun from it.
    const sun = [0.5, 0.707, 0.5] as const;
    shadowCaster(100, 200, sun[0], sun[1], sun[2], CUMULUS_BASE, out);
    expect(out[0]).toBeCloseTo(100 + (0.5 * CUMULUS_BASE) / 0.707, 6);
    expect(out[1]).toBeCloseTo(200 + (0.5 * CUMULUS_BASE) / 0.707, 6);
    // Straight overhead, the cloud is straight overhead.
    shadowCaster(100, 200, 0, 1, 0, CUMULUS_BASE, out);
    expect(out).toEqual([100, 200]);
  });

  test("every low cloud throws its shadow down-sun of itself, and the shadow moves with the cloud", () => {
    const travel = emptyTravel();
    blow(travel, 45, 8, 0.8, 0.6);
    const sunY = Math.sin(40 * RAD);
    const sunX = Math.cos(40 * RAD) * 0.6;
    const sunZ = Math.cos(40 * RAD) * 0.8;
    const k = { cumulus: 0.6, sheet: 0 };
    let checked = 0;
    for (let cj = 0; cj < CELLS; cj++) {
      for (let ci = 0; ci < CELLS; ci++) {
        const c = cloudAt(ci, cj, 0.6, travel.clock, cloud);
        if (c.grown < 0.9) continue;
        checked++;
        // Where it stands over the land now, and the point of flat ground (y 0) its centre shades.
        const wx = c.x + travel.x;
        const wz = c.z + travel.z;
        const gx = wx - (sunX * CUMULUS_BASE) / sunY;
        const gz = wz - (sunZ * CUMULUS_BASE) / sunY;
        expect(cloudShade(gx, 0, gz, sunX, sunY, sunZ, k, travel)).toBe(1);
        // Right under the cloud the sun still gets in from the side, unless another cloud's shadow is there: but a
        // cloud's width up-sun of its shadow there's none of this cloud's.
        expect(cumulusOver(wx, wz, 0.6, travel)).toBe(1);
        // Ten seconds on, the shadow has moved exactly as far as the cloud has.
        const later = { ...travel };
        blow(later, 10, 8, 0.8, 0.6);
        const dx = cloudSpeed(8) * 10 * 0.8;
        const dz = cloudSpeed(8) * 10 * 0.6;
        expect(cloudShade(gx + dx, 0, gz + dz, sunX, sunY, sunZ, k, { ...later, clock: travel.clock })).toBe(1);
      }
    }
    expect(checked).toBeGreaterThan(30);
  });

  test("higher ground is nearer the cloud, so its shadow falls nearer under it", () => {
    const travel = emptyTravel();
    const c = { ...cloudAt(5, 5, 0.8, 0, cloud) };
    const sunY = Math.sin(30 * RAD);
    const sunX = Math.cos(30 * RAD);
    const k = { cumulus: 0.8, sheet: 0 };
    for (const y of [0, 20, 60]) {
      const gx = c.x - (sunX * (CUMULUS_BASE - y)) / sunY;
      expect(cloudShade(gx, y, c.z, sunX, sunY, 0, k, travel)).toBe(1);
    }
  });

  test("the sheet's shadow is the sheet, from its own height; with no cloud nothing is shaded", () => {
    const travel = emptyTravel();
    const sunY = Math.sin(50 * RAD);
    const sunZ = -Math.cos(50 * RAD);
    let shaded = 0;
    let same = 0;
    const n = 400;
    for (let i = 0; i < n; i++) {
      const x = hash32(i + 5) * FIELD;
      const z = hash32(i + 9999) * FIELD;
      const shade = cloudShade(x, 0, z, 0, sunY, sunZ, { cumulus: 0, sheet: 0.5 }, travel);
      if (shade > 0.5) shaded++;
      const over = sheetOver(x, z + (sunZ * SHEET_HEIGHT) / sunY, 0.5, travel);
      if (Math.abs(shade - over) < 1e-9) same++;
      expect(cloudShade(x, 0, z, 0, sunY, sunZ, { cumulus: 0, sheet: 0 }, travel)).toBe(0);
    }
    expect(same).toBe(n);
    expect(shaded / n).toBeGreaterThan(0.3);
    expect(shaded / n).toBeLessThan(0.7);
  });
});
