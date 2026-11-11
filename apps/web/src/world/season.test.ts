import { describe, expect, test } from "bun:test";
import { emptySeason, SEASONS, seasonAt, seasonFor, seasonOf, yearFraction } from "./season.ts";

/*
 * The season by Denmark's real date: a year that turns, not four switches. Each
 * season at its middle is itself; between them they cross over weeks; the trees
 * are bare in January, in full leaf in July, gold in October and half bare in
 * mid November; and the same instant gives the same season in any device's zone.
 */

const at = (iso: string) => Date.parse(iso);

describe("the season, by Denmark's date", () => {
  test("how far through the year, by the date in Copenhagen, whatever the device's zone", () => {
    expect(yearFraction(at("2026-01-01T12:00:00Z"))).toBeCloseTo(0.5 / 365, 6);
    expect(yearFraction(at("2026-07-02T12:00:00Z"))).toBeCloseTo(182.5 / 365, 6);
    // 23:30 UTC on 31 December is already 1 January in Denmark.
    expect(yearFraction(at("2026-12-31T23:30:00Z"))).toBeCloseTo(0.5 / 365, 6);
    const now = at("2026-11-11T09:20:00Z");
    const here = yearFraction(now);
    const was = process.env.TZ;
    try {
      process.env.TZ = "America/Los_Angeles";
      expect(yearFraction(now)).toBe(here);
      process.env.TZ = "Asia/Tokyo";
      expect(yearFraction(now)).toBe(here);
    } finally {
      process.env.TZ = was;
    }
    // A leap year is a day longer.
    expect(yearFraction(at("2028-12-31T12:00:00Z"))).toBeCloseTo(365.5 / 366, 6);
  });

  test("each season at its middle is itself; the weights sum to one all year and never jump", () => {
    expect(seasonAt(at("2026-01-15T12:00:00Z")).name).toBe("winter");
    expect(seasonAt(at("2026-04-15T12:00:00Z")).name).toBe("spring");
    expect(seasonAt(at("2026-07-15T12:00:00Z")).name).toBe("summer");
    expect(seasonAt(at("2026-10-15T12:00:00Z")).name).toBe("autumn");
    let before = seasonOf(0);
    for (let d = 0; d <= 365; d++) {
      const s = seasonOf(d / 365);
      expect(s.winter + s.spring + s.summer + s.autumn).toBeCloseTo(1, 9);
      for (const k of [...SEASONS, "leaf", "bloom", "turn", "litter", "vigour"] as const) {
        expect(s[k]).toBeGreaterThanOrEqual(0);
        expect(s[k]).toBeLessThanOrEqual(1);
        // A day changes nothing by more than a few hundredths (round the year's end too).
        expect(Math.abs(s[k] - before[k])).toBeLessThan(0.06);
      }
      before = s;
    }
    // The middle of a season is almost wholly that season.
    for (const name of SEASONS) expect(seasonFor(name, 0)[name]).toBeGreaterThan(0.95);
  });

  test("bare in January, in flower in June, full leaf in July, gold in October, half bare with leaves on the ground in mid November", () => {
    const january = seasonAt(at("2026-01-15T12:00:00Z"));
    expect(january.leaf).toBe(0);
    expect(january.bloom).toBe(0);
    expect(january.vigour).toBe(0);
    expect(january.litter).toBeGreaterThan(0.5);
    const june = seasonAt(at("2026-06-10T12:00:00Z"));
    expect(june.bloom).toBeGreaterThan(0.95);
    expect(june.leaf).toBe(1);
    expect(june.litter).toBe(0);
    const july = seasonAt(at("2026-07-15T12:00:00Z"));
    expect(july.leaf).toBe(1);
    expect(july.turn).toBe(0);
    expect(july.vigour).toBe(1);
    const october = seasonAt(at("2026-10-18T12:00:00Z"));
    expect(october.turn).toBeGreaterThan(0.95);
    expect(october.leaf).toBeGreaterThan(0.6);
    const november = seasonAt(at("2026-11-11T12:00:00Z"));
    expect(november.name).toBe("autumn");
    expect(november.leaf).toBeGreaterThan(0.2);
    expect(november.leaf).toBeLessThan(0.6);
    expect(november.turn).toBeGreaterThan(0.9);
    expect(november.litter).toBeGreaterThan(0.8);
    expect(november.bloom).toBe(0);
  });

  test("a season chosen to look at is its middle, whatever the date; live is the date's", () => {
    const now = at("2026-11-11T12:00:00Z");
    expect(seasonFor("summer", now).name).toBe("summer");
    expect(seasonFor("summer", now).leaf).toBe(1);
    expect(seasonFor("winter", now).leaf).toBe(0);
    expect(seasonFor("live", now)).toEqual(seasonAt(now));
    // Written into the object it's given (nothing allocated in the render loop).
    const out = emptySeason();
    expect(seasonFor("spring", now, out)).toBe(out);
    expect(out.name).toBe("spring");
  });
});
