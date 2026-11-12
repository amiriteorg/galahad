import { describe, expect, test } from "bun:test";
import { emptyHeavens, type Heavens, heavensAt, TIME_PRESETS } from "../daynight.ts";
import { equatorial, rotate, skyMatrix, type Vec3 } from "./celestial.ts";
import { emptyShowers, Meteors, showerRate, SHOWERS, showersAt, showerTonight } from "./meteors.ts";
import { antisolar, bowDistance, haloStrength, noctilucent, noctilucentSeason, parhelion, rainbowAt, rainbowStrength, rainMemory } from "./optics.ts";
import { compass, moonName, skyWords } from "./words.ts";

/*
 * What happens in the sky by real conditions only: meteor showers on their
 * dates from their radiants, a rainbow opposite a low sun in rain, a halo and
 * sundogs in thin high cloud, noctilucent clouds on summer nights; and the
 * line of words that says what's there.
 */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const at = (iso: string) => Date.parse(iso);
const shower = (name: string) => SHOWERS.find((s) => s.name === name)!;

describe("meteor showers", () => {
  test("the five are the International Meteor Organization's: their radiants, rates and speeds", () => {
    expect(SHOWERS.map((s) => s.name)).toEqual(["Quadrantids", "Lyrids", "Perseids", "Leonids", "Geminids"]);
    const per = shower("Perseids");
    expect([per.ra, per.dec, per.zhr, per.speed, per.peak]).toEqual([48, 58, 100, 59, 140]);
    const gem = shower("Geminids");
    expect([gem.ra, gem.dec, gem.zhr, gem.speed, gem.peak]).toEqual([112, 33, 150, 35, 262.2]);
    const leo = shower("Leonids");
    expect([leo.ra, leo.dec, leo.zhr, leo.speed, leo.peak]).toEqual([152, 22, 15, 71, 235.27]);
    const qua = shower("Quadrantids");
    expect([qua.ra, qua.dec, qua.zhr, qua.speed, qua.peak]).toEqual([230, 49, 80, 41, 283.15]);
    const lyr = shower("Lyrids");
    expect([lyr.ra, lyr.dec, lyr.zhr, lyr.speed, lyr.peak]).toEqual([271, 34, 18, 49, 32.32]);
  });

  test("each peaks on its real night, at about its rate", () => {
    // The IMO's 2026 maxima: Quadrantids 3 January, Lyrids 22 April 19:40 UT, Perseids 13 August 02 to 04 UT,
    // Leonids 17 November 23:45 UT, Geminids 14 December 14 UT.
    const peaks: [string, string][] = [
      ["Quadrantids", "2026-01-03T21:00:00Z"],
      ["Lyrids", "2026-04-22T19:40:00Z"],
      ["Perseids", "2026-08-13T03:00:00Z"],
      ["Leonids", "2026-11-17T23:45:00Z"],
      ["Geminids", "2026-12-14T14:00:00Z"],
    ];
    for (const [name, iso] of peaks) {
      const s = shower(name);
      const rate = showerRate(s, at(iso));
      expect(rate).toBeGreaterThan(s.zhr * 0.8);
      expect(rate).toBeLessThanOrEqual(s.zhr);
      // The best hour of the year is within a day of it.
      let best = 0;
      let when = 0;
      for (let h = -24 * 12; h <= 24 * 12; h++) {
        const r = showerRate(s, at(iso) + h * 3_600_000);
        if (r > best) {
          best = r;
          when = h;
        }
      }
      expect(Math.abs(when)).toBeLessThanOrEqual(24);
    }
  });

  test("outside its weeks a shower gives nothing; inside them, a few before the peak and many at it", () => {
    const per = shower("Perseids");
    expect(showerRate(per, at("2026-06-01T00:00:00Z"))).toBe(0);
    expect(showerRate(per, at("2026-07-10T00:00:00Z"))).toBe(0);
    expect(showerRate(per, at("2026-07-20T00:00:00Z"))).toBeGreaterThan(0);
    expect(showerRate(per, at("2026-07-20T00:00:00Z"))).toBeLessThan(8);
    expect(showerRate(per, at("2026-08-10T00:00:00Z"))).toBeGreaterThan(10);
    expect(showerRate(per, at("2026-08-10T00:00:00Z"))).toBeLessThan(60);
    expect(showerRate(per, at("2026-08-30T00:00:00Z"))).toBe(0);
    // The Quadrantids' weeks run over the new year, and their peak is hours long.
    const qua = shower("Quadrantids");
    expect(showerRate(qua, at("2026-12-30T00:00:00Z"))).toBeGreaterThan(0);
    expect(showerRate(qua, at("2027-01-10T00:00:00Z"))).toBeGreaterThan(0);
    expect(showerRate(qua, at("2026-12-20T00:00:00Z"))).toBe(0);
    expect(showerRate(qua, at("2026-01-02T21:00:00Z"))).toBeLessThan(qua.zhr * 0.3);
    // Leonids on 11 November: its weeks have begun, but it's nearly a week to the peak.
    const leo = shower("Leonids");
    expect(showerRate(leo, at("2026-11-11T22:00:00Z"))).toBeGreaterThan(0.2);
    expect(showerRate(leo, at("2026-11-11T22:00:00Z"))).toBeLessThan(3);
  });

  test("the radiant stands where it does: the Perseids' high in the north-east on an August night, the Leonids' down in the evening", () => {
    const now = emptyShowers();
    showersAt(at("2026-08-13T01:00:00Z"), now);
    const per = now.find((s) => s.shower.name === "Perseids")!;
    expect(per.elevation * DEG).toBeGreaterThan(50);
    expect(per.azimuth * DEG).toBeGreaterThan(20);
    expect(per.azimuth * DEG).toBeLessThan(90);
    expect(per.rate).toBeGreaterThan(80);
    showersAt(at("2026-11-17T19:00:00Z"), now);
    expect(now.find((s) => s.shower.name === "Leonids")!.elevation).toBeLessThan(0);
    showersAt(at("2026-11-18T03:00:00Z"), now);
    expect(now.find((s) => s.shower.name === "Leonids")!.elevation * DEG).toBeGreaterThan(35);
  });

  test("which shower to name tonight: the one worth watching, or none", () => {
    expect(showerTonight(at("2026-08-12T21:00:00Z"))?.shower.name).toBe("Perseids");
    expect(showerTonight(at("2026-08-12T21:00:00Z"))?.strength).toBe("peak");
    expect(showerTonight(at("2026-12-13T20:00:00Z"))?.shower.name).toBe("Geminids");
    expect(showerTonight(at("2026-11-11T22:00:00Z"))?.shower.name).toBe("Leonids");
    expect(showerTonight(at("2026-11-11T22:00:00Z"))?.strength).toBe("few");
    expect(showerTonight(at("2026-08-08T22:00:00Z"))?.strength).toBe("active");
    expect(showerTonight(at("2026-06-15T22:00:00Z"))).toBeNull();
    expect(showerTonight(at("2026-03-10T22:00:00Z"))).toBeNull();
  });

  test("meteors are sparse and brief: one at a time, a second at most, tens an hour at the Perseids' peak", () => {
    const meteors = new Meteors(7);
    const t0 = at("2026-08-13T00:30:00Z");
    let count = 0;
    let longest = 0;
    let alive = false;
    let started = 0;
    const dt = 0.05;
    for (let i = 0; i < 3600 / dt; i++) {
      const t = i * dt;
      meteors.step(dt, t0 + t * 1000, 1, true);
      if (meteors.alive && !alive) {
        count++;
        started = t;
        expect(meteors.life).toBeGreaterThan(0.2);
        expect(meteors.life).toBeLessThanOrEqual(1.3);
        expect(meteors.shower).toBe("Perseids");
      }
      if (!meteors.alive && alive) longest = Math.max(longest, t - started);
      alive = meteors.alive;
    }
    expect(count).toBeGreaterThan(60);
    expect(count).toBeLessThan(450);
    expect(longest).toBeLessThanOrEqual(1.35);
  });

  test("each streaks away from its shower's radiant along a great circle", () => {
    const meteors = new Meteors(3);
    const t0 = at("2026-12-14T00:00:00Z");
    const m = skyMatrix(t0, new Float64Array(9));
    const gem = shower("Geminids");
    const radiant = rotate(m, equatorial(gem.ra * RAD, gem.dec * RAD, [0, 0, 0]), [0, 0, 0]);
    const dot = (a: Readonly<Vec3>, b: Readonly<Vec3>) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    let seen = 0;
    let was = false;
    for (let i = 0; i < 40000 && seen < 25; i++) {
      // (The sky held still, so the radiant is where it was worked out.)
      meteors.step(0.05, t0, 1, true);
      if (meteors.alive && !was) {
        seen++;
        const f = meteors.from;
        const e = meteors.to;
        expect(Math.hypot(...f)).toBeCloseTo(1, 9);
        expect(Math.hypot(...e)).toBeCloseTo(1, 9);
        // It starts above the horizon, moves away from the radiant, and its path's plane holds the radiant.
        expect(f[2]).toBeGreaterThan(0);
        expect(dot(e, radiant)).toBeLessThan(dot(f, radiant));
        const nx = f[1] * e[2] - f[2] * e[1];
        const ny = f[2] * e[0] - f[0] * e[2];
        const nz = f[0] * e[1] - f[1] * e[0];
        const n = Math.hypot(nx, ny, nz);
        expect(n).toBeGreaterThan(0.01);
        expect(Math.abs((nx * radiant[0] + ny * radiant[1] + nz * radiant[2]) / n)).toBeLessThan(1e-6);
        // A few degrees to a few tens of degrees long.
        const length = Math.acos(Math.min(1, dot(f, e))) * DEG;
        expect(length).toBeGreaterThan(1);
        expect(length).toBeLessThan(40);
      }
      was = meteors.alive;
    }
    expect(seen).toBe(25);
  });

  test("none on a night with no shower, in daylight, with the radiant down, or under reduced motion; the same seed gives the same night", () => {
    const run = (iso: string, dark: number, motion: boolean, seed = 5) => {
      const meteors = new Meteors(seed);
      const t0 = at(iso);
      let count = 0;
      let was = false;
      const starts: number[] = [];
      for (let i = 0; i < 36000; i++) {
        meteors.step(0.1, t0 + i * 100, dark, motion);
        if (meteors.alive && !was) {
          count++;
          starts.push(i);
        }
        was = meteors.alive;
      }
      return { count, starts };
    };
    expect(run("2026-06-15T23:00:00Z", 1, true).count).toBe(0);
    expect(run("2026-08-13T00:30:00Z", 0, true).count).toBe(0);
    expect(run("2026-08-13T00:30:00Z", 1, false).count).toBe(0);
    // The Leonids' radiant is below the horizon in the early evening of their peak.
    expect(run("2026-11-17T17:30:00Z", 1, true).count).toBe(0);
    const a = run("2026-08-13T00:30:00Z", 1, true, 11);
    const b = run("2026-08-13T00:30:00Z", 1, true, 11);
    expect(a.starts).toEqual(b.starts);
    expect(a.count).toBeGreaterThan(10);
  });
});

describe("a rainbow", () => {
  test("stands opposite the sun, 42° round the antisolar point, red outside; a fainter second bow at 51° with its colours turned", () => {
    const sun: Vec3 = [Math.cos(10 * RAD) * Math.sin(250 * RAD), Math.cos(10 * RAD) * Math.cos(250 * RAD), Math.sin(10 * RAD)];
    const anti = antisolar(sun, [0, 0, 0]);
    expect(anti[0]).toBeCloseTo(-sun[0], 12);
    expect(anti[2]).toBeCloseTo(-sun[2], 12);
    // The top of the bow: straight above the antisolar point's bearing, 42° from it: 32° up when the sun is 10° up.
    const top: Vec3 = [Math.cos(32 * RAD) * Math.sin(70 * RAD), Math.cos(32 * RAD) * Math.cos(70 * RAD), Math.sin(32 * RAD)];
    expect(bowDistance(top, sun) * DEG).toBeCloseTo(42, 6);
    // Across the bows: nothing inside 39°, the first bow at 42°, a dark band, the second at 51° and half as bright at most.
    expect(rainbowAt(38).primary).toBe(0);
    expect(rainbowAt(41.6).primary).toBeGreaterThan(0.8);
    expect(rainbowAt(44.5).primary).toBe(0);
    expect(rainbowAt(46).secondary).toBe(0);
    expect(rainbowAt(52).secondary).toBeGreaterThan(0.3);
    expect(rainbowAt(52).secondary).toBeLessThan(0.5);
    expect(rainbowAt(56).secondary).toBe(0);
    // Red (hue 0) on the outside of the first bow and the inside of the second; violet (hue 1) the other way.
    expect(rainbowAt(42.6).hue).toBeLessThan(rainbowAt(40.8).hue);
    expect(rainbowAt(50.6).hue).toBeLessThan(rainbowAt(53).hue);
  });

  test("only while the sun is below 42°, out, and rain is falling or just past", () => {
    // A shower with the sun out: a bow. The same shower under a closed sky, at night, or with the sun high: none.
    expect(rainbowStrength(20, 0.6, 0.6, 0.5)).toBeGreaterThan(0.4);
    expect(rainbowStrength(20, 0.6, 0.6, 1)).toBe(0);
    expect(rainbowStrength(-5, 0.6, 0.6, 0.5)).toBe(0);
    expect(rainbowStrength(0.2, 0.6, 0.6, 0.5)).toBeLessThan(0.1);
    expect(rainbowStrength(43, 0.6, 0.6, 0.5)).toBe(0);
    expect(rainbowStrength(40, 0.6, 0.6, 0.5)).toBeLessThan(rainbowStrength(30, 0.6, 0.6, 0.5));
    // No rain, none past: no bow, however fine the evening.
    expect(rainbowStrength(20, 0, 0, 0.3)).toBe(0);
    // Rain just past, the sky breaking: a bow.
    expect(rainbowStrength(20, 0, 0.7, 0.4)).toBeGreaterThan(0.4);
  });

  test("the rain just past is remembered for a couple of minutes, then forgotten", () => {
    let past = 0;
    for (let i = 0; i < 100; i++) past = rainMemory(past, 1, 0.1);
    expect(past).toBeGreaterThan(0.6);
    const wet = past;
    for (let i = 0; i < 300; i++) past = rainMemory(past, 0, 0.1);
    expect(past).toBeGreaterThan(wet * 0.5);
    for (let i = 0; i < 6000; i++) past = rainMemory(past, 0, 0.1);
    expect(past).toBeLessThan(0.01);
    expect(rainMemory(0, 0, 1)).toBe(0);
  });
});

describe("a halo and sundogs", () => {
  test("show round a lowish sun in thin high cloud, and not through thick cloud or by night", () => {
    expect(haloStrength(12, 0.7, 0.2)).toBeGreaterThan(0.4);
    expect(haloStrength(12, 0, 0.2)).toBe(0);
    expect(haloStrength(-3, 0.7, 0.2)).toBe(0);
    expect(haloStrength(12, 0.7, 0.95)).toBe(0);
    expect(haloStrength(55, 0.7, 0.2)).toBe(0);
    expect(haloStrength(8, 0.7, 0.2)).toBeGreaterThan(haloStrength(8, 0.3, 0.2));
  });

  test("the sundogs stand at the sun's height, 22° from it when it's on the horizon and a little farther as it climbs", () => {
    expect(parhelion(0).distance * DEG).toBeCloseTo(21.8, 0);
    expect(parhelion(10 * RAD).distance * DEG).toBeGreaterThan(22);
    expect(parhelion(10 * RAD).distance * DEG).toBeLessThan(23.2);
    expect(parhelion(30 * RAD).distance * DEG).toBeGreaterThan(27);
    // Along the sun's own height, the turn of bearing that is that far away.
    for (const h of [0, 5, 12, 25]) {
      const p = parhelion(h * RAD);
      const cosAway = Math.sin(h * RAD) ** 2 + Math.cos(h * RAD) ** 2 * Math.cos(p.bearing);
      expect(Math.acos(cosAway)).toBeCloseTo(p.distance, 9);
    }
  });
});

describe("noctilucent clouds", () => {
  test("their season is Denmark's summer nights: late May to early August, most about midsummer", () => {
    expect(noctilucentSeason(at("2026-04-20T22:00:00Z"))).toBe(0);
    expect(noctilucentSeason(at("2026-05-15T22:00:00Z"))).toBe(0);
    expect(noctilucentSeason(at("2026-06-01T22:00:00Z"))).toBeGreaterThan(0.2);
    expect(noctilucentSeason(at("2026-06-25T22:00:00Z"))).toBe(1);
    expect(noctilucentSeason(at("2026-07-15T22:00:00Z"))).toBe(1);
    expect(noctilucentSeason(at("2026-08-05T22:00:00Z"))).toBeGreaterThan(0.1);
    expect(noctilucentSeason(at("2026-08-20T22:00:00Z"))).toBe(0);
    expect(noctilucentSeason(at("2026-11-11T22:00:00Z"))).toBe(0);
  });

  test("they show only while the sun is 6° to 16° down, under an open sky", () => {
    const june = at("2026-06-25T22:30:00Z");
    expect(noctilucent(june, -10, 0)).toBeGreaterThan(0.8);
    expect(noctilucent(june, -4, 0)).toBe(0);
    expect(noctilucent(june, -18, 0)).toBe(0);
    expect(noctilucent(june, 5, 0)).toBe(0);
    expect(noctilucent(june, -10, 0.9)).toBeLessThan(0.15);
    expect(noctilucent(at("2026-11-11T17:00:00Z"), -10, 0)).toBe(0);
    // On a real midsummer night over Copenhagen the sun is in that band from about 22 h to 2 h UT.
    const h = heavensAt(at("2026-06-25T23:00:00Z"), emptyHeavens());
    expect(noctilucent(at("2026-06-25T23:00:00Z"), h.sunElevation * DEG, 0)).toBeGreaterThan(0.5);
  });
});

describe("the line of words", () => {
  const weather = (over: Partial<Parameters<typeof skyWords>[2]> = {}) => ({ cloud: 0, rain: 0, mist: 0, wind: 4, windHeading: 0, ...over });
  const real = (iso: string): Heavens => heavensAt(at(iso), emptyHeavens());

  test("bearings and moons have their names", () => {
    expect(compass(0)).toBe("north");
    expect(compass(44 * RAD)).toBe("north-east");
    expect(compass(135 * RAD)).toBe("south-east");
    expect(compass(180 * RAD)).toBe("south");
    expect(compass(271 * RAD)).toBe("west");
    expect(compass(350 * RAD)).toBe("north");
    expect(moonName(0.01, 0.005)).toBe("New moon");
    expect(moonName(0.12, 0.15)).toBe("Waxing crescent moon");
    expect(moonName(0.25, 0.5)).toBe("First quarter moon");
    expect(moonName(0.37, 0.8)).toBe("Waxing gibbous moon");
    expect(moonName(0.5, 0.995)).toBe("Full moon");
    expect(moonName(0.63, 0.8)).toBe("Waning gibbous moon");
    expect(moonName(0.75, 0.5)).toBe("Last quarter moon");
    expect(moonName(0.9, 0.1)).toBe("Waning crescent moon");
  });

  test("a clear winter's night: the moon in its phase, the planets that are up and where, the shower of the season", () => {
    // 1 February 2026, 20:00 UT: a full moon in the east-south-east, Jupiter high in the south-east (U.S. Naval Observatory).
    const t = at("2026-02-01T20:00:00Z");
    const words = skyWords(t, real("2026-02-01T20:00:00Z"), weather());
    expect(words).toContain("Full moon");
    expect(words).toContain("Jupiter in the south-east");
    expect(words.length).toBeLessThanOrEqual(4);
    expect(words.every((w) => w.length > 0 && w.length <= 40)).toBe(true);
    // 11 November 2026, 22:00 UT: Saturn in the south-south-west, and the Leonids' weeks have begun.
    const november = skyWords(at("2026-11-11T22:00:00Z"), real("2026-11-11T22:00:00Z"), weather());
    expect(november.some((w) => /^Saturn in the south/.test(w))).toBe(true);
    expect(november).toContain("A few Leonids tonight");
    // At the Perseids' peak.
    expect(skyWords(at("2026-08-12T23:00:00Z"), real("2026-08-12T23:00:00Z"), weather())).toContain("Perseids at their peak tonight");
  });

  test("by day it says the clouds, by their kind, and where they drift from", () => {
    const noon = real("2026-07-01T11:00:00Z");
    expect(skyWords(at("2026-07-01T11:00:00Z"), noon, weather())).toEqual(["Clear sky"]);
    // A westerly blows towards the east (heading 0 in the atan2 convention).
    const cumulus = skyWords(at("2026-07-01T11:00:00Z"), noon, weather({ cloud: 0.4, wind: 6, windHeading: 0 }), 4, 1);
    expect(cumulus).toContain("Cumulus, drifting from the west");
    const overcast = skyWords(at("2026-07-01T11:00:00Z"), noon, weather({ cloud: 1, wind: 5, windHeading: Math.PI / 2 }), 4, 1);
    expect(overcast).toEqual(["Stratus overcast, from the south"]);
    expect(skyWords(at("2026-07-01T11:00:00Z"), noon, weather({ cloud: 1, rain: 1, wind: 8, windHeading: 0.35 }), 4, 1)[0]).toMatch(/^Rain clouds from the west/);
    expect(skyWords(at("2026-07-01T11:00:00Z"), noon, weather({ cloud: 1, rain: 1, storm: 1, wind: 14, windHeading: 0.35 }), 4, 1)[0]).toMatch(/^Thunderclouds from the west/);
    expect(skyWords(at("2026-01-10T11:00:00Z"), real("2026-01-10T11:00:00Z"), weather({ cloud: 0.9, snow: 0.8, wind: 2 }), 4, 0)[0]).toMatch(/^Snow clouds/);
    // In a calm they don't drift from anywhere.
    expect(skyWords(at("2026-07-01T11:00:00Z"), noon, weather({ cloud: 0.4, wind: 0.2 }), 4, 1)).toContain("Cumulus, hardly moving");
  });

  test("a rainbow is said, and where: opposite the sun", () => {
    // An evening sun in the west-north-west, a shower passing: the bow is in the east-south-east.
    const evening = real("2026-07-01T18:00:00Z");
    const words = skyWords(at("2026-07-01T18:00:00Z"), evening, weather({ cloud: 0.5, rain: 0.5, rainPast: 0.6 }), 4, 1);
    expect(words.some((w) => /^A rainbow in the (east|south-east)$/.test(w))).toBe(true);
    // Not at night, and not under a closed sky.
    expect(skyWords(at("2026-07-01T23:30:00Z"), real("2026-07-01T23:30:00Z"), weather({ cloud: 0.5, rain: 0.5, rainPast: 0.6 })).some((w) => /rainbow/.test(w))).toBe(false);
    expect(skyWords(at("2026-07-01T18:00:00Z"), evening, weather({ cloud: 1, rain: 1, rainPast: 1 })).some((w) => /rainbow/.test(w))).toBe(false);
  });

  test("a closed sky hides what's above it: no moon, no planets, no stars said", () => {
    const t = at("2026-02-01T20:00:00Z");
    const words = skyWords(t, real("2026-02-01T20:00:00Z"), weather({ cloud: 1 }), 4, 0);
    expect(words.some((w) => /moon|Jupiter|Milky/i.test(w))).toBe(false);
    expect(words[words.length - 1]).toMatch(/^Stratus overcast/);
  });

  test("noctilucent clouds, a halo and the sun at the horizon are said when they're there", () => {
    const nlc = skyWords(at("2026-06-25T23:00:00Z"), real("2026-06-25T23:00:00Z"), weather());
    expect(nlc).toContain("Noctilucent clouds in the north");
    // A low winter sun in thin high cloud.
    const halo = skyWords(at("2026-12-21T11:00:00Z"), real("2026-12-21T11:00:00Z"), weather({ cloud: 0.15 }), 4, 0);
    expect(halo.some((w) => /^A halo/.test(w))).toBe(true);
    const sunset = skyWords(at("2026-06-21T19:50:00Z"), real("2026-06-21T19:50:00Z"), weather());
    expect(sunset).toContain("Sun setting in the north-west");
    const sunrise = skyWords(at("2026-12-21T07:40:00Z"), real("2026-12-21T07:40:00Z"), weather());
    expect(sunrise).toContain("Sun rising in the south-east");
  });

  test("a preset's sky is said too, and there are never more phrases than asked for", () => {
    const words = skyWords(at("2026-11-11T12:00:00Z"), TIME_PRESETS.night, weather({ cloud: 0.3 }), 3, 0.4);
    expect(words.length).toBeLessThanOrEqual(3);
    expect(words.length).toBeGreaterThan(0);
    // The clouds are always the last word.
    expect(words[words.length - 1]).toMatch(/Cirrus|Stratocumulus|Cumulus/);
    expect(skyWords(at("2026-11-11T12:00:00Z"), TIME_PRESETS.night, weather(), 1)).toHaveLength(1);
    // A gibbous moon whose side isn't known (a preset has no phase) is just that.
    expect(skyWords(at("2026-11-11T12:00:00Z"), TIME_PRESETS.night, weather(), 4).some((w) => w === "Gibbous moon")).toBe(true);
  });
});
