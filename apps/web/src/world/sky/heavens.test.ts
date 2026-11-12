import { describe, expect, test } from "bun:test";
import { COPENHAGEN } from "../sun.ts";
import { azimuthOf, elevationOf, equatorial, GALACTIC, type Mat3, rotate, siderealTime, skyMatrix, solarLongitude, type Vec3 } from "./celestial.ts";
import { HEAVENS_FLOOR, HEAVENS_TOP, HEAVENS_TOP_MOST, heavensTop, realElevation, seenDirection, seenElevation } from "./panorama.ts";
import { emptyPlanets, type PlanetName, planetsAt } from "./planets.ts";
import { STAR_COUNT, STAR_DATA, STAR_LIMIT, STAR_NAMES } from "./stars-data.ts";
import { starBrightness, starColor, unpackStars } from "./stars.ts";

/*
 * Where things stand in the sky over Copenhagen. The reference heights and
 * bearings are the U.S. Naval Observatory's (its Astronomical Applications
 * API, "celnav": computed altitude Hc and azimuth Zn, no refraction) for
 * 55.676° N, 12.568° E at the instants given.
 */

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;
const at = (iso: string) => Date.parse(iso);
const stars = unpackStars(STAR_DATA, STAR_COUNT);
const m: Mat3 = new Float64Array(9);
const v: Vec3 = [0, 0, 0];

/** A named star's height and bearing (degrees) at an instant. */
function star(name: string, ms: number): { alt: number; az: number } {
  const i = STAR_NAMES[name];
  if (i === undefined) throw new Error(`no star named ${name}`);
  rotate(skyMatrix(ms, m), stars.dir, v, i * 3);
  return { alt: elevationOf(v) * DEG, az: azimuthOf(v) * DEG };
}
/** The difference between two bearings, degrees. */
const turn = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

describe("the turning sky", () => {
  test("sidereal time runs a day in 23 h 56 min and is the right ascension on the meridian", () => {
    const t = at("2026-11-11T22:00:00Z");
    const day = 86_164_090.5;
    const a = siderealTime(t);
    const b = siderealTime(t + day);
    expect(Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)))).toBeLessThan(1e-5);
    // The Naval Observatory's GHA of Aries at that instant: 21.060°; ours is that plus the longitude.
    expect(turn(siderealTime(t, 0) * DEG, 21.06)).toBeLessThan(0.02);
    expect(turn(siderealTime(t) * DEG, 21.06 + COPENHAGEN.lon)).toBeLessThan(0.02);
  });

  test("the pole stands due north at the latitude's height, and nothing moves it", () => {
    for (const iso of ["2026-01-01T00:00:00Z", "2026-06-21T12:00:00Z", "2026-11-11T22:00:00Z"]) {
      // (The pole of the date: where the J2000 pole has precessed to is a third of a degree off by now.)
      skyMatrix(at(iso), m);
      const up: Vec3 = [m[2]!, m[5]!, m[8]!];
      expect(Math.hypot(...up)).toBeCloseTo(1, 9);
      rotate(m, equatorial(0, Math.PI / 2, v), v);
      expect(elevationOf(v) * DEG).toBeGreaterThan(COPENHAGEN.lat - 0.4);
      expect(elevationOf(v) * DEG).toBeLessThan(COPENHAGEN.lat + 0.4);
    }
  });

  test("the matrix is a rotation: lengths and angles are kept", () => {
    skyMatrix(at("2026-03-03T03:00:00Z"), m);
    const a = rotate(m, equatorial(1.1, 0.3, [0, 0, 0]), [0, 0, 0]);
    const b = rotate(m, equatorial(2.7, -0.6, [0, 0, 0]), [0, 0, 0]);
    const ea = equatorial(1.1, 0.3, [0, 0, 0]);
    const eb = equatorial(2.7, -0.6, [0, 0, 0]);
    expect(Math.hypot(...a)).toBeCloseTo(1, 12);
    expect(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]).toBeCloseTo(ea[0] * eb[0] + ea[1] * eb[1] + ea[2] * eb[2], 12);
  });

  test("the sun's longitude along the ecliptic is 0 at the March equinox and 90 at midsummer, less what the equinox has moved since 2000", () => {
    // (Equinox 20 March 2026 14:46 UTC; solstice 21 June 2026 08:24 UTC. The equinox moves 1.397° a century, and
    // showers are tabulated for where it was in 2000.)
    const moved = (iso: string) => (1.396971 * (at(iso) - at("2000-01-01T12:00:00Z"))) / (36525 * 86_400_000);
    expect(turn(solarLongitude(at("2026-03-20T14:46:00Z")) * DEG, 360 - moved("2026-03-20T14:46:00Z"))).toBeLessThan(0.03);
    expect(turn(solarLongitude(at("2026-06-21T08:24:00Z")) * DEG, 90 - moved("2026-06-21T08:24:00Z"))).toBeLessThan(0.03);
  });

  test("the galaxy's pole and centre are where they are: in Coma Berenices and in Sagittarius", () => {
    const pole = GALACTIC.pole;
    const centre = GALACTIC.centre;
    expect(Math.asin(pole[2]) * DEG).toBeCloseTo(27.13, 1);
    expect(((Math.atan2(pole[1], pole[0]) * DEG + 360) % 360) / 15).toBeCloseTo(12.857, 2);
    expect(Math.asin(centre[2]) * DEG).toBeCloseTo(-28.94, 1);
    expect(pole[0] * centre[0] + pole[1] * centre[1] + pole[2] * centre[2]).toBeCloseTo(0, 3);
  });
});

describe("the stars", () => {
  test("the table is the naked-eye sky: a few thousand stars, brightest first, on the unit sphere", () => {
    expect(stars.count).toBe(STAR_COUNT);
    expect(STAR_COUNT).toBeGreaterThan(4000);
    expect(STAR_COUNT).toBeLessThan(6000);
    for (let i = 0; i < stars.count; i++) {
      expect(Math.hypot(stars.dir[i * 3]!, stars.dir[i * 3 + 1]!, stars.dir[i * 3 + 2]!)).toBeCloseTo(1, 5);
      if (i) expect(stars.mag[i]!).toBeGreaterThanOrEqual(stars.mag[i - 1]!);
    }
    expect(stars.mag[stars.count - 1]!).toBeLessThanOrEqual(STAR_LIMIT + 0.02);
    // Sirius leads, at −1.46; about 20 are first magnitude, about 50 brighter than second.
    expect(STAR_NAMES.Sirius).toBe(0);
    expect(stars.mag[0]!).toBeCloseTo(-1.46, 1);
    let first = 0;
    let second = 0;
    for (let i = 0; i < stars.count; i++) {
      if (stars.mag[i]! < 1.5) first++;
      if (stars.mag[i]! < 2) second++;
    }
    expect(first).toBeGreaterThanOrEqual(19);
    expect(first).toBeLessThanOrEqual(24);
    expect(second).toBeGreaterThanOrEqual(44);
    expect(second).toBeLessThanOrEqual(54);
  });

  test("Polaris is within a degree of the pole, at about 55.7° up in the north, all night and all year", () => {
    for (const [iso, alt, az] of [
      ["2026-11-11T22:00:00Z", 56.281, 0.264],
      ["2026-02-01T20:00:00Z", 56.162, 359.312],
      ["2026-06-21T23:00:00Z", 55.203, 0.73],
      ["2030-09-01T03:00:00Z", 56.28, 0.207],
    ] as const) {
      const p = star("Polaris", at(iso));
      expect(Math.abs(p.alt - alt)).toBeLessThan(0.1);
      expect(turn(p.az, az)).toBeLessThan(0.2);
      expect(Math.abs(p.alt - COPENHAGEN.lat)).toBeLessThan(1);
    }
  });

  test("Sirius, Vega, Betelgeuse and others stand where the Naval Observatory has them", () => {
    const pins: [string, string, number, number][] = [
      ["Sirius", "2026-02-01T20:00:00Z", 16.162, 163.079],
      ["Sirius", "2026-11-12T04:00:00Z", 15.165, 202.101],
      ["Vega", "2026-11-11T22:00:00Z", 19.738, 310.95],
      ["Vega", "2026-06-21T23:00:00Z", 71.4, 150.174],
      ["Vega", "2026-02-01T20:00:00Z", 5.323, 348.434],
      ["Betelgeuse", "2026-11-11T22:00:00Z", 25.023, 115.541],
      ["Betelgeuse", "2026-02-01T20:00:00Z", 41.6, 173.968],
      ["Capella", "2026-11-11T22:00:00Z", 60.002, 89.106],
      ["Arcturus", "2026-06-21T23:00:00Z", 35.913, 249.746],
      ["Antares", "2026-06-21T23:00:00Z", 6.083, 197.889],
      ["Deneb", "2026-06-21T23:00:00Z", 61.411, 92.864],
      ["Aldebaran", "2026-11-11T22:00:00Z", 42.384, 130.704],
      ["Rigel", "2026-11-11T22:00:00Z", 15.962, 132.923],
    ];
    for (const [name, iso, alt, az] of pins) {
      const s = star(name, at(iso));
      expect(Math.abs(s.alt - alt)).toBeLessThan(0.1);
      // (A bearing is worth less the higher the star stands.)
      expect(turn(s.az, az) * Math.cos(alt * RAD)).toBeLessThan(0.1);
    }
  });

  test("the sky turns round Polaris: a night's turn brings a star back four minutes early", () => {
    const t = at("2026-11-11T22:00:00Z");
    const a = star("Vega", t);
    const b = star("Vega", t + 86_164_090);
    expect(Math.abs(a.alt - b.alt)).toBeLessThan(0.01);
    expect(turn(a.az, b.az)).toBeLessThan(0.01);
    // Six hours on, it has swung a quarter of the way round the pole.
    const c = star("Vega", t + 6 * 3_600_000);
    expect(Math.abs(c.alt - a.alt)).toBeGreaterThan(5);
  });

  test("a star's colour follows its B−V: Rigel blue-white, Betelgeuse orange", () => {
    const c: Vec3 = [0, 0, 0];
    const blue = [...starColor(stars.color[STAR_NAMES.Rigel!]!, c)];
    const red = [...starColor(stars.color[STAR_NAMES.Betelgeuse!]!, c)];
    expect(blue[2]!).toBeGreaterThan(blue[0]!);
    expect(red[0]!).toBeGreaterThan(red[2]! * 1.4);
    // Brightness: a magnitude is a factor of 2.512; brighter stars draw brighter, never without end.
    expect(starBrightness(1) / starBrightness(2)).toBeGreaterThan(1.2);
    expect(starBrightness(-1.5)).toBeLessThanOrEqual(1);
    expect(starBrightness(6)).toBeGreaterThan(0);
  });
});

describe("the panorama", () => {
  test("heights are squeezed into the strip of sky a low camera sees: always there when up, never above the strip", () => {
    expect(seenElevation(-5 * RAD)).toBe(-5 * RAD);
    expect(seenElevation(0)).toBe(0);
    let last = 0;
    for (let e = 0.25; e <= 90; e += 0.25) {
      const seen = seenElevation(e * RAD) * DEG;
      expect(seen).toBeGreaterThan(last);
      expect(seen).toBeLessThanOrEqual(HEAVENS_TOP * DEG + 1e-9);
      last = seen;
    }
    expect(last).toBeCloseTo(HEAVENS_TOP * DEG, 6);
    // What rises clears the far hills soon; the pole star stands near the strip's top.
    expect(seenElevation(6 * RAD) * DEG).toBeGreaterThan(5);
    expect(seenElevation(COPENHAGEN.lat * RAD) * DEG).toBeGreaterThan(9);
    expect(HEAVENS_TOP * DEG).toBeLessThan(11);
  });

  test("above the hills the squeeze keeps areas: as many stars a square degree at the top of the strip as at its foot", () => {
    // Equal bands of sin(height) hold equal shares of the sky; they must be drawn equally tall.
    const band = (lo: number, hi: number) => (seenElevation(Math.asin(hi)) - seenElevation(Math.asin(lo))) * DEG;
    const low = band(0.2, 0.3);
    const high = band(0.8, 0.9);
    expect(Math.abs(low - high)).toBeLessThan(0.02 * low);
    expect(HEAVENS_FLOOR).toBeLessThan(HEAVENS_TOP);
  });

  test("the strip opens with the view: zoomed in, or on a tall screen, the zenith is drawn just under the view's top", () => {
    // As the view opens (its top edge 11.5° up) the strip is at its least; looking down from far out it stays there.
    expect(heavensTop(11.5 * RAD)).toBeCloseTo(HEAVENS_TOP, 9);
    expect(heavensTop(-20 * RAD)).toBe(HEAVENS_TOP);
    // Zoomed right in the view's top is 15.5° up: the zenith a degree under it. Never more than the most.
    expect(heavensTop(15.5 * RAD) * DEG).toBeCloseTo(14.4, 6);
    expect(heavensTop(40 * RAD)).toBe(HEAVENS_TOP_MOST);
    // It opens smoothly as the view tilts up: never a jump.
    let last = heavensTop(0);
    for (let v = 0; v <= 30; v += 0.1) {
      const top = heavensTop(v * RAD);
      expect(top).toBeGreaterThanOrEqual(last);
      expect(top - last).toBeLessThan(0.11 * RAD);
      last = top;
    }
    // In an opened strip everything keeps its order and its bearing, the zenith is at the top, what rises still
    // clears the hills at once, and the squeeze still keeps areas and can be undone.
    const top = heavensTop(15.5 * RAD);
    expect(seenElevation(Math.PI / 2, top)).toBeCloseTo(top, 12);
    expect(seenElevation(6 * RAD, top) * DEG).toBeGreaterThan(5);
    expect(seenElevation(COPENHAGEN.lat * RAD, top)).toBeGreaterThan(seenElevation(COPENHAGEN.lat * RAD));
    const band = (lo: number, hi: number) => seenElevation(Math.asin(hi), top) - seenElevation(Math.asin(lo), top);
    expect(Math.abs(band(0.2, 0.3) - band(0.8, 0.9))).toBeLessThan(0.02 * band(0.2, 0.3));
    for (const e of [0.5, 3, 12, 40, 55.7, 89]) expect(realElevation(seenElevation(e * RAD, top), top) * DEG).toBeCloseTo(e, 4);
    const seen = seenDirection([0.5, -0.3, Math.sqrt(1 - 0.34)], [0, 0, 0], top);
    expect(Math.atan2(seen[0], seen[1])).toBeCloseTo(Math.atan2(0.5, -0.3), 12);
    expect(Math.asin(seen[2])).toBeCloseTo(seenElevation(Math.asin(Math.sqrt(1 - 0.34)), top), 12);
  });

  test("it can be undone, and a direction keeps its bearing", () => {
    for (const e of [0.5, 3, 12, 40, 55.7, 89]) expect(realElevation(seenElevation(e * RAD)) * DEG).toBeCloseTo(e, 4);
    expect(realElevation(-0.2)).toBe(-0.2);
    const real = equatorial(0, 0, [0, 0, 0]);
    real[0] = 0.5;
    real[1] = -0.3;
    real[2] = Math.sqrt(1 - 0.34);
    const seen = seenDirection(real, [0, 0, 0]);
    expect(Math.hypot(...seen)).toBeCloseTo(1, 12);
    expect(Math.atan2(seen[0], seen[1])).toBeCloseTo(Math.atan2(real[0], real[1]), 12);
    expect(Math.asin(seen[2])).toBeCloseTo(seenElevation(Math.asin(real[2])), 12);
  });
});

describe("the planets", () => {
  const planets = emptyPlanets();
  const find = (name: PlanetName, ms: number) => {
    const p = planetsAt(ms, planets).find((x) => x.name === name)!;
    return { alt: p.elevation * DEG, az: p.azimuth * DEG, mag: p.magnitude, elongation: p.elongation * DEG };
  };

  test("Venus, Mars, Jupiter and Saturn stand where the Naval Observatory has them, within half a degree", () => {
    const pins: [PlanetName, string, number, number][] = [
      ["Venus", "2025-01-15T17:30:00Z", 16.805, 228.491],
      ["Venus", "2026-06-21T20:30:00Z", 12.148, 287.259],
      ["Mars", "2025-01-15T17:30:00Z", 21.158, 76.155],
      ["Mars", "2026-11-12T04:00:00Z", 45.861, 147.08],
      ["Mars", "2027-02-20T00:00:00Z", 49.28, 191.79],
      ["Mars", "2030-09-01T03:00:00Z", 12.487, 75.047],
      ["Jupiter", "2025-01-15T17:30:00Z", 44.934, 122.415],
      ["Jupiter", "2026-02-01T20:00:00Z", 52.434, 141.724],
      ["Jupiter", "2026-06-21T20:30:00Z", 6.755, 297.688],
      ["Jupiter", "2026-11-12T04:00:00Z", 44.056, 146.388],
      ["Jupiter", "2027-02-20T00:00:00Z", 47.396, 207.103],
      ["Saturn", "2025-01-15T17:30:00Z", 17.681, 225.026],
      ["Saturn", "2026-11-11T22:00:00Z", 31.798, 209.342],
      ["Saturn", "2030-09-01T03:00:00Z", 47.932, 136.599],
    ];
    for (const [name, iso, alt, az] of pins) {
      const p = find(name, at(iso));
      expect(Math.abs(p.alt - alt)).toBeLessThan(0.5);
      expect(turn(p.az, az) * Math.cos(alt * RAD)).toBeLessThan(0.5);
    }
  });

  test("they are as bright as they are: Venus brightest, then Jupiter; Mars at its brightest at opposition", () => {
    const t = at("2025-01-15T17:30:00Z");
    const venus = find("Venus", t);
    const jupiter = find("Jupiter", t);
    const mars = find("Mars", t);
    const saturn = find("Saturn", t);
    expect(venus.mag).toBeLessThan(-4);
    expect(venus.mag).toBeGreaterThan(-5);
    expect(jupiter.mag).toBeLessThan(-2.2);
    expect(jupiter.mag).toBeGreaterThan(-3);
    // Mars at its January 2025 opposition: about −1.4; far from the Sun's glare.
    expect(mars.mag).toBeLessThan(-1);
    expect(mars.mag).toBeGreaterThan(-1.8);
    expect(mars.elongation).toBeGreaterThan(170);
    expect(saturn.mag).toBeGreaterThan(0);
    expect(saturn.mag).toBeLessThan(1.6);
    // Venus never strays more than 47° from the Sun.
    for (let d = 0; d < 600; d += 9) expect(find("Venus", t + d * 86_400_000).elongation).toBeLessThan(48);
  });

  test("nothing is allocated: the same objects come back", () => {
    const a = planetsAt(at("2026-01-01T00:00:00Z"), planets);
    const first = a[0];
    const b = planetsAt(at("2026-01-02T00:00:00Z"), planets);
    expect(b).toBe(a);
    expect(b[0]).toBe(first);
  });
});
