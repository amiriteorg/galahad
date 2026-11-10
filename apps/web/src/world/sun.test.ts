import { describe, expect, test } from "bun:test";
import { danishTime, emptyMoon, emptySun, moonAt, sunAt } from "./sun.ts";

const DEG = 180 / Math.PI;
const MIN = 60_000;

/** The minute (UTC ms) the sun's centre crosses −0.833° (refraction and its radius: the almanac's sunrise) between `from` and `to`. */
function crossing(from: number, to: number, rising: boolean): number {
  const s = emptySun();
  const f = (t: number) => sunAt(t, s).elevation * DEG + 0.833;
  let a = from;
  let b = to;
  expect(Math.sign(f(a))).toBe(rising ? -1 : 1);
  expect(Math.sign(f(b))).toBe(rising ? 1 : -1);
  for (let i = 0; i < 40; i++) {
    const m = (a + b) / 2;
    if (f(m) < 0 === rising) a = m;
    else b = m;
  }
  return (a + b) / 2;
}

const at = (iso: string) => Date.parse(iso);
const near = (actual: number, expected: number, minutes: number) => expect(Math.abs(actual - expected) / MIN).toBeLessThanOrEqual(minutes);

describe("the sun over Copenhagen", () => {
  // Almanac times (timeanddate.com, sunrise-sunset.org): 21 June 2026 04:25 and 21:57 CEST; 21 December 2026 08:37 and 15:38 CET.
  test("rises and sets on midsummer's day within minutes of the almanac", () => {
    near(crossing(at("2026-06-21T00:00:00Z"), at("2026-06-21T06:00:00Z"), true), at("2026-06-21T02:25:00Z"), 5);
    near(crossing(at("2026-06-21T16:00:00Z"), at("2026-06-21T23:00:00Z"), false), at("2026-06-21T19:57:00Z"), 5);
  });

  test("rises and sets on midwinter's day within minutes of the almanac", () => {
    near(crossing(at("2026-12-21T05:00:00Z"), at("2026-12-21T10:00:00Z"), true), at("2026-12-21T07:37:00Z"), 5);
    near(crossing(at("2026-12-21T12:00:00Z"), at("2026-12-21T17:00:00Z"), false), at("2026-12-21T14:38:00Z"), 5);
  });

  test("stands low and due south at noon in winter, high in summer; east in the morning, west in the evening", () => {
    const s = emptySun();
    // Solar noon in Copenhagen is about 11:08 UTC at midwinter (12:08 CET), 10:54 UTC in November.
    sunAt(at("2026-12-21T11:08:00Z"), s);
    expect(s.elevation * DEG).toBeGreaterThan(10.4);
    expect(s.elevation * DEG).toBeLessThan(11.4);
    expect(Math.abs(s.azimuth * DEG - 180)).toBeLessThan(2);
    expect(Math.abs(s.hourAngle * DEG)).toBeLessThan(1);
    sunAt(at("2026-11-10T10:54:00Z"), s);
    expect(s.elevation * DEG).toBeGreaterThan(15);
    expect(s.elevation * DEG).toBeLessThan(19);
    sunAt(at("2026-06-21T11:11:00Z"), s);
    expect(s.elevation * DEG).toBeGreaterThan(57);
    sunAt(at("2026-06-21T05:00:00Z"), s);
    expect(s.azimuth * DEG).toBeGreaterThan(45);
    expect(s.azimuth * DEG).toBeLessThan(110);
    expect(s.hourAngle).toBeLessThan(0);
    sunAt(at("2026-06-21T17:00:00Z"), s);
    expect(s.azimuth * DEG).toBeGreaterThan(250);
    expect(s.hourAngle).toBeGreaterThan(0);
    // Midsummer midnight: down, but never far (Danish nights in June stay in twilight).
    sunAt(at("2026-06-21T23:20:00Z"), s);
    expect(s.elevation * DEG).toBeLessThan(-9);
    expect(s.elevation * DEG).toBeGreaterThan(-12);
  });
});

describe("the moon", () => {
  test("is full and new on the right nights", () => {
    const s = emptySun();
    const m = emptyMoon();
    // The total lunar eclipse of 3 March 2026 (full), and the total solar eclipse of 12 August 2026 (new).
    const full = at("2026-03-03T11:38:00Z");
    moonAt(full, sunAt(full, s), m);
    expect(m.lit).toBeGreaterThan(0.98);
    expect(Math.abs(m.phase - 0.5)).toBeLessThan(0.03);
    const fresh = at("2026-08-12T17:37:00Z");
    moonAt(fresh, sunAt(fresh, s), m);
    expect(m.lit).toBeLessThan(0.02);
    // A week after new: about half lit, waxing.
    const quarter = at("2026-08-20T02:00:00Z");
    moonAt(quarter, sunAt(quarter, s), m);
    expect(m.lit).toBeGreaterThan(0.35);
    expect(m.lit).toBeLessThan(0.65);
    expect(m.phase).toBeGreaterThan(0.15);
    expect(m.phase).toBeLessThan(0.35);
  });

  test("a full moon rides opposite the sun: up at midnight, low in the south in summer", () => {
    const s = emptySun();
    const m = emptyMoon();
    const t = at("2026-03-03T23:00:00Z");
    moonAt(t, sunAt(t, s), m);
    expect(m.elevation * DEG).toBeGreaterThan(25);
    expect(Math.abs(m.azimuth * DEG - 180)).toBeLessThan(25);
  });
});

describe("Danish time", () => {
  test("is the clock in Denmark, with summer time, whatever the device's zone", () => {
    expect(danishTime(at("2026-06-21T12:00:00Z"))).toBe("14:00");
    expect(danishTime(at("2026-12-21T12:32:00Z"))).toBe("13:32");
    expect(danishTime(at("2026-03-29T00:59:00Z"))).toBe("01:59");
    expect(danishTime(at("2026-03-29T01:00:00Z"))).toBe("03:00");
  });

  test("a device in another time zone sees the same time and the same sun", () => {
    const instant = at("2026-11-10T13:32:00Z");
    const before = process.env.TZ;
    const seen: { clock: string; elevation: number; azimuth: number; localHour: number }[] = [];
    try {
      for (const zone of ["Europe/Copenhagen", "America/Los_Angeles", "Asia/Tokyo", "UTC"]) {
        process.env.TZ = zone;
        const s = sunAt(instant, emptySun());
        seen.push({ clock: danishTime(instant), elevation: s.elevation, azimuth: s.azimuth, localHour: new Date(instant).getHours() });
      }
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
    for (const s of seen) {
      expect(s.clock).toBe("14:32");
      expect(s.elevation).toBe(seen[0]!.elevation);
      expect(s.azimuth).toBe(seen[0]!.azimuth);
    }
    // The zones really did differ on this runtime (so the check above meant something).
    expect(new Set(seen.map((s) => s.localHour)).size).toBeGreaterThan(1);
  });
});
