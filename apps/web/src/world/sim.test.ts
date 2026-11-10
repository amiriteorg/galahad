import { describe, expect, test } from "bun:test";
import { applyWeather, emptyHeavens, emptySky, type Heavens, heavensAt, skyFor, TIME_PRESETS } from "./daynight.ts";
import { Walker } from "./path.ts";
import { Boids, criticalDamping, moveOnGround, Particles, rng, springStep } from "./physics.ts";
import { chooseTier, lowerTier, ResolutionGovernor, TIERS } from "./tiers.ts";
import { ArmTask, fingertips, follow, type Joints, SLOTS, solveArm } from "./arms.ts";
import { MicroduckFlock } from "./microducks.ts";

describe("the SO-101 arms on the lab bench", () => {
  test("inverse kinematics puts the fingertips on the target, gripper pointing down", () => {
    const j: Joints = [0, 0, 0, 0, 0, 0];
    const tip: [number, number, number] = [0, 0, 0];
    for (const [x, y, z] of [[0, 0.26, 0.12], [-0.2, 0.024, 0.22], [0.22, 0.14, 0.2], [0.02, 0.05, 0.3], [0.1, 0.2, -0.05]] as const) {
      expect(solveArm(x, y, z, j)).toBe(true);
      fingertips(j, tip);
      expect(tip[0]).toBeCloseTo(x, 9);
      expect(tip[1]).toBeCloseTo(y, 9);
      expect(tip[2]).toBeCloseTo(z, 9);
      expect(j[1] + j[2] + j[3]).toBeCloseTo(Math.PI, 12);
    }
    expect(solveArm(2, 0, 2, j)).toBe(false);
  });

  test("busy, it picks and places cubes between slots without ever stacking two; idle, it rests at home", () => {
    const arm = new ArmTask(9);
    let placed = 0;
    let lastHeld = -1;
    for (let i = 0; i < 60 * 40; i++) {
      arm.step(1 / 60, true);
      if (lastHeld >= 0 && arm.held < 0) placed++;
      lastHeld = arm.held;
      const slots = arm.cubes.filter((c) => c.slot >= 0).map((c) => c.slot);
      expect(new Set(slots).size).toBe(slots.length);
      for (const c of arm.cubes) if (c.slot >= 0) expect([c.x, c.z]).toEqual(SLOTS[c.slot]!);
    }
    expect(placed).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < 60 * 15; i++) arm.step(1 / 60, false);
    expect(arm.held).toBe(-1);
    expect(arm.phase).toBe("rest");
    const tip = fingertips(arm.joints, [0, 0, 0]);
    expect(tip[1]).toBeCloseTo(0.26, 3);
  });

  test("the follower mirrors the leader's joints, a moment behind", () => {
    const leader: Joints = [0.5, 0.3, 1, 1.8, 0.2, 1];
    const f: Joints = [0, 0, 0, 0, 0, 0];
    follow(leader, f, 1 / 60);
    expect(Math.abs(f[0])).toBeLessThan(0.5);
    for (let i = 0; i < 300; i++) follow(leader, f, 1 / 60);
    expect(f[0]).toBeCloseTo(-0.5, 6);
    expect(f[4]).toBeCloseTo(-0.2, 6);
    expect(f[1]).toBeCloseTo(0.3, 6);
  });
});

describe("Microducks", () => {
  // A pond to the east and the keep's walls in the middle; nothing else in the way.
  const ground = { height: () => 0, blocked: (x: number, y: number) => Math.hypot(x, y) < 8.5 || Math.hypot(x - 25, y + 5) < 6 };

  test("they waddle about near home, never into water or walls, and keep apart", () => {
    const flock = new MicroduckFlock(6, ground, 3);
    const lead = { x: 0, y: -10, heading: 0 };
    for (let i = 0; i < 60 * 90; i++) {
      flock.step(1 / 60, i / 60, lead, lead);
      for (const d of flock.ducks) {
        expect(ground.blocked(d.x, d.y)).toBe(false);
        expect(Math.hypot(d.x, d.y)).toBeLessThan(48);
      }
    }
    let minGap = Infinity;
    for (const a of flock.ducks) for (const b of flock.ducks) if (a !== b) minGap = Math.min(minGap, Math.hypot(a.x - b.x, a.y - b.y));
    expect(minGap).toBeGreaterThan(0.2);
  });

  test("a waddle sways the body and swings the legs in turn; standing still, neither", () => {
    const flock = new MicroduckFlock(1, ground, 4);
    const d = flock.ducks[0]!;
    const g = { roll: 0, left: 0, right: 0, bob: 0 };
    d.speed = 0.45;
    d.phase = Math.PI / 2;
    MicroduckFlock.gait(d, g);
    expect(g.roll).toBeGreaterThan(0.1);
    expect(g.left).toBeCloseTo(-g.right, 12);
    d.speed = 0;
    MicroduckFlock.gait(d, g);
    expect(g.roll).toBe(0);
    expect(flock.near(d.x + 0.3, d.y, 0.9)).toBe(d);
    expect(flock.near(d.x + 3, d.y, 0.9)).toBeNull();
  });

  test("now and then one tags along behind Galahad", () => {
    const flock = new MicroduckFlock(6, ground, 5);
    const lead = { x: 12, y: -14, heading: Math.PI };
    let followed = 0;
    for (let i = 0; i < 60 * 240; i++) {
      flock.step(1 / 60, i / 60, lead, lead);
      followed += flock.ducks.filter((d) => d.following !== 0).length;
    }
    expect(followed).toBeGreaterThan(0);
  });
});

describe("quality tiers", () => {
  const base = { webgpu: true, fallbackAdapter: false, coarse: false, minScreen: 900, memory: 8, cores: 8 };

  test("desktops with WebGPU get high; WebGL2 desktops medium; phones medium at most; weak or software low", () => {
    expect(chooseTier(base)).toBe("high");
    expect(chooseTier({ ...base, webgpu: false })).toBe("medium");
    expect(chooseTier({ ...base, coarse: true, minScreen: 390 })).toBe("medium");
    expect(chooseTier({ ...base, coarse: true, minScreen: 390, webgpu: false })).toBe("low");
    expect(chooseTier({ ...base, fallbackAdapter: true })).toBe("low");
    expect(chooseTier({ ...base, memory: 2 })).toBe("low");
    expect(chooseTier({ ...base, memory: null, cores: null })).toBe("high");
    expect(lowerTier("high")).toBe("medium");
    expect(lowerTier("low")).toBe("low");
  });

  test("every tier caps every count, and the caps grow with the tier", () => {
    const keys = ["trees", "bushes", "flowers", "grass", "rocks", "birds", "deer", "rabbits", "ducks", "microducks", "fireflies", "particles", "lights", "radius"] as const;
    for (const k of keys) {
      expect(TIERS.low[k]).toBeLessThanOrEqual(TIERS.medium[k]);
      expect(TIERS.medium[k]).toBeLessThanOrEqual(TIERS.high[k]);
    }
    expect(TIERS.low.maxDpr).toBeLessThanOrEqual(1);
    expect(TIERS.high.maxDpr).toBeLessThanOrEqual(2);
  });

  test("the governor lowers the pixel ratio first, then drops shadows, then grass; and recovers when fast", () => {
    const g = new ResolutionGovernor(TIERS.high, 2);
    const second = (start: number, ms: number | (() => number)) => {
      let action = "none";
      for (let t = 0; t <= 1000; t += 1000 / 30) {
        const a = g.frame(start + t, typeof ms === "number" ? ms : ms());
        if (a !== "none") action = a;
      }
      return action;
    };
    let t = 0;
    const actions: string[] = [];
    // A hitch (one slow second between fast ones) and the warm-up change nothing.
    for (let i = 0; i < 4; i++) second((t += 1100), 10);
    expect(second((t += 1100), 60)).toBe("none");
    expect(second((t += 1100), 10)).toBe("none");
    expect(g.dpr).toBe(2);
    // Fill-bound, and slow even at the floor: each step down helps, but not enough.
    for (let i = 0; i < 26; i++) actions.push(second((t += 1100), () => 15 + 40 * (g.dpr / 2) ** 2));
    expect(actions.filter((a) => a !== "none")).toEqual(["drop-post", "drop-post", "drop-post", "dpr", "dpr", "dpr", "dpr", "drop-shadows", "drop-grass"]);
    expect(g.post).toEqual({ ao: false, shafts: false, bloom: false });
    expect(g.dpr).toBe(TIERS.high.minDpr);
    for (let i = 0; i < 12; i++) second((t += 1100), 5);
    expect(g.dpr).toBeGreaterThan(TIERS.high.minDpr);
    // Too few frames in a second (rendering on demand) never count.
    const idle = new ResolutionGovernor(TIERS.high, 2);
    for (let i = 0; i < 10; i++) idle.frame(i * 400, 100);
    expect(idle.dpr).toBe(2);
  });

  test("when a lower pixel ratio doesn't make frames faster, the governor puts it back and drops effects instead", () => {
    // A phone held back by something other than pixels (an iPhone at 26 ms a frame at dpr 0.75 as at 1.5):
    // blurring the picture buys nothing, so it keeps it sharp.
    const g = new ResolutionGovernor(TIERS.high, 2);
    let t = 0;
    const second = (ms: number) => {
      t += 1100;
      let action = "none";
      for (let s = 0; s <= 1000; s += 1000 / 30) {
        const a = g.frame(t + s, ms);
        if (a !== "none") action = a;
      }
      return action;
    };
    for (let i = 0; i < 4; i++) second(10);
    const actions: string[] = [];
    for (let i = 0; i < 18; i++) actions.push(second(26));
    expect(actions.filter((a) => a !== "none")).toEqual(["drop-post", "drop-post", "drop-post", "dpr", "dpr", "drop-shadows", "drop-grass"]);
    expect(g.dpr).toBe(2);
  });

  test("post effects are shed first, dearest first, before the picture gets any blurrier or loses its shadows", () => {
    const g = new ResolutionGovernor(TIERS.high, 2);
    let t = 0;
    const second = (ms: number) => {
      t += 1100;
      let action = "none";
      for (let s = 0; s <= 1000; s += 1000 / 30) {
        const a = g.frame(t + s, ms);
        if (a !== "none") action = a;
      }
      return action;
    };
    for (let i = 0; i < 4; i++) second(10);
    // Two slow seconds per step: ambient occlusion goes, then the sun's shafts, then bloom; shadows and sharpness stay.
    const steps: { post: string; dpr: number; shadows: boolean }[] = [];
    for (let i = 0; i < 3; i++) {
      second(30);
      expect(second(30)).toBe("drop-post");
      steps.push({ post: JSON.stringify(g.post), dpr: g.dpr, shadows: g.shadows });
    }
    expect(steps.map((s) => s.post)).toEqual([
      JSON.stringify({ ao: false, shafts: true, bloom: true }),
      JSON.stringify({ ao: false, shafts: false, bloom: true }),
      JSON.stringify({ ao: false, shafts: false, bloom: false }),
    ]);
    expect(steps.every((s) => s.dpr === 2 && s.shadows)).toBe(true);
    // Only then the pixel ratio.
    second(30);
    expect(second(30)).toBe("dpr");
    // Phones and low tiers have none to shed.
    expect(TIERS.medium.post).toEqual({ ao: false, shafts: false, bloom: false });
    expect(TIERS.low.post).toEqual({ ao: false, shafts: false, bloom: false });
  });

  test("a lower pixel ratio that helps is kept", () => {
    const g = new ResolutionGovernor(TIERS.high, 2);
    let t = 0;
    const second = (ms: () => number) => {
      t += 1100;
      for (let s = 0; s <= 1000; s += 1000 / 30) g.frame(t + s, ms());
    };
    for (let i = 0; i < 4; i++) second(() => 10);
    // Fill-bound: frame time follows the pixel count.
    for (let i = 0; i < 18; i++) second(() => Math.max(12, 30 * (g.dpr / 2) ** 2));
    expect(g.dpr).toBeLessThan(2);
    expect(g.dpr).toBeGreaterThanOrEqual(TIERS.high.minDpr);
  });

  test("phones never drop below a pixel ratio of 1", () => {
    expect(TIERS.medium.minDpr).toBeGreaterThanOrEqual(1);
  });
});

describe("day and night, by the real sun", () => {
  const sky = emptySky();
  const h = emptyHeavens();
  const DEG = Math.PI / 180;
  const at = (iso: string) => skyFor(heavensAt(Date.parse(iso), h), sky);
  const lum = (c: number) => ((c >> 16) & 255) + ((c >> 8) & 255) + (c & 255);
  const warmth = (c: number) => ((c >> 16) & 255) - (c & 255);

  test("the sun rises in the east, is south at noon, sets in the west, and is down at night", () => {
    at("2026-06-21T03:30:00Z");
    expect(sky.sun[0]).toBeGreaterThan(0.3);
    expect(sky.sun[2]).toBeGreaterThan(0);
    expect(sky.evening).toBeLessThan(0.2);
    at("2026-06-21T11:11:00Z");
    expect(sky.sun[2]).toBeGreaterThan(0.8);
    expect(sky.sun[1]).toBeLessThan(0);
    at("2026-06-21T18:30:00Z");
    expect(sky.sun[0]).toBeLessThan(-0.3);
    expect(sky.evening).toBeGreaterThan(0.8);
    at("2026-12-21T22:00:00Z");
    expect(sky.sun[2]).toBeLessThan(0);
    expect(sky.night).toBe(1);
    expect(sky.stars).toBeGreaterThan(0.9);
    expect(sky.lightFromSun).toBe(false);
    expect(sky.lamps).toBe(1);
  });

  test("a winter noon is a long golden hour: low, warm and bright, never drab", () => {
    at("2026-12-21T11:08:00Z");
    expect(sky.sunElevation / DEG).toBeLessThan(12);
    expect(sky.night).toBe(0);
    expect(sky.golden).toBeGreaterThan(0.5);
    expect(sky.lightIntensity).toBeGreaterThan(2);
    expect(warmth(sky.light)).toBeGreaterThan(40);
    expect(sky.lamps).toBeLessThan(0.05);
    // Its light is nearly as strong as a summer noon's, only warmer.
    const winter = { intensity: sky.lightIntensity, warmth: warmth(sky.light) };
    at("2026-06-21T11:11:00Z");
    expect(sky.golden).toBe(0);
    expect(winter.intensity).toBeGreaterThan(sky.lightIntensity * 0.85);
    expect(winter.warmth).toBeGreaterThan(warmth(sky.light));
  });

  test("winter days are short and summer nights stay in twilight", () => {
    // 16:30 CET in December is dusk going on dark; at the same clock time in June it's broad day.
    at("2026-12-21T15:30:00Z");
    expect(sky.night).toBeGreaterThan(0.3);
    at("2026-06-21T14:30:00Z");
    expect(sky.night).toBe(0);
    // Midsummer midnight: the sun is down, but the sky isn't the dead of a winter night.
    at("2026-06-21T23:15:00Z");
    expect(sky.lightFromSun).toBe(false);
    const june = lum(sky.horizon);
    at("2026-12-21T23:15:00Z");
    expect(june).toBeGreaterThan(lum(sky.horizon));
  });

  test("dusk goes golden, then peach and lavender, then deep blue night; smoothly, minute by minute", () => {
    at("2026-11-10T14:40:00Z");
    expect(sky.golden).toBeGreaterThan(0.5);
    expect(warmth(sky.light)).toBeGreaterThan(60);
    at("2026-11-10T15:40:00Z");
    expect(sky.lightFromSun).toBe(false);
    expect(warmth(sky.horizon)).toBeGreaterThan(20);
    at("2026-11-10T17:40:00Z");
    expect(sky.night).toBe(1);
    expect(lum(sky.zenith)).toBeLessThan(100);
    const start = Date.parse("2026-11-10T00:00:00Z");
    let prev = lum(skyFor(heavensAt(start, h), sky).horizon);
    for (let m = 2; m < 24 * 60; m += 2) {
      const now = lum(skyFor(heavensAt(start + m * 60_000, h), sky).horizon);
      expect(Math.abs(now - prev)).toBeLessThan(25);
      prev = now;
    }
  });

  test("the night light is the moon when it's up, brighter when it's full, and the sky's glow when it's down", () => {
    const night = (moonElevation: number, moonLit: number) =>
      skyFor({ sunElevation: -30 * DEG, sunAzimuth: 0, evening: 1, moonElevation: moonElevation * DEG, moonAzimuth: 180 * DEG, moonLit } satisfies Heavens, sky);
    night(40, 1);
    const full = sky.lightIntensity;
    expect(sky.lightDir[1]).toBeLessThan(-0.5);
    night(40, 0.05);
    expect(sky.lightIntensity).toBeLessThan(full);
    night(-20, 1);
    expect(sky.moonUp).toBe(0);
    expect(sky.lightIntensity).toBeGreaterThan(0.2);
    expect(sky.lightDir[2]).toBeGreaterThan(0.8);
  });

  test("the presets are places of the sun: dawn low and rising, day high, golden low and sinking, night dark", () => {
    skyFor(TIME_PRESETS.dawn, sky);
    expect(sky.evening).toBe(0);
    expect(sky.golden).toBeGreaterThan(0.5);
    skyFor(TIME_PRESETS.day, sky);
    expect(sky.golden).toBe(0);
    expect(sky.night).toBe(0);
    skyFor(TIME_PRESETS.golden, sky);
    expect(sky.golden).toBeGreaterThan(0.8);
    expect(warmth(sky.light)).toBeGreaterThan(60);
    skyFor(TIME_PRESETS.night, sky);
    expect(sky.night).toBe(1);
    expect(sky.moonUp).toBe(1);
  });

  test("cloud greys the sky, softens the sun and its shadows, and lowers the exposure; clear changes nothing", () => {
    skyFor(TIME_PRESETS.day, sky);
    const clear = { zenith: sky.zenith, light: sky.lightIntensity, exposure: sky.exposure, hemi: sky.hemiIntensity };
    applyWeather(sky, { cloud: 0.9, rain: 1, mist: 0.2, wetness: 1 });
    const sat = (c: number) => Math.max((c >> 16) & 255, (c >> 8) & 255, c & 255) - Math.min((c >> 16) & 255, (c >> 8) & 255, c & 255);
    expect(sat(sky.zenith)).toBeLessThan(sat(clear.zenith) / 2);
    expect(sky.lightIntensity).toBeLessThan(clear.light / 2);
    expect(sky.hemiIntensity).toBeGreaterThan(clear.hemi);
    expect(sky.exposure).toBeLessThan(clear.exposure);
    expect(sky.shadow).toBeLessThan(0.5);
    expect(sky.cloud).toBe(0.9);
    skyFor(TIME_PRESETS.day, sky);
    const before = JSON.stringify(sky);
    applyWeather(sky, { cloud: 0, rain: 0, mist: 0, wetness: 0 });
    expect(JSON.stringify(sky)).toBe(before);
  });
});

describe("physics, in proportion", () => {
  test("a critically damped spring settles on its target without overshooting", () => {
    const s = { x: 0, y: 0, vx: 0, vy: 0 };
    const k = 30;
    let maxX = 0;
    for (let i = 0; i < 300; i++) {
      springStep(s, 5, -2, k, criticalDamping(k), 1 / 60);
      maxX = Math.max(maxX, s.x);
    }
    expect(s.x).toBeCloseTo(5, 3);
    expect(s.y).toBeCloseTo(-2, 3);
    expect(maxX).toBeLessThanOrEqual(5 + 1e-6);
  });

  test("ballistic particles fall as they should, and the pool reuses its oldest slot", () => {
    const p = new Particles(4);
    p.drag = 0;
    p.emit(0, 0, 0, 3, 0, 10, 5);
    for (let i = 0; i < 100; i++) p.step(0.01);
    expect(p.pos[0]).toBeCloseTo(3, 4);
    expect(p.pos[2]).toBeCloseTo(10 - 0.5 * 9.81, 1);
    for (let i = 0; i < 5; i++) p.emit(i, 0, 0, 0, 0, 0, 1);
    expect(p.alive).toBe(4);
    expect(p.pos[0]).toBe(3); // the first slot, the oldest, went to the fourth of these
  });

  test("boids keep their speed in bounds, stay near home and don't collapse into one point", () => {
    const b = new Boids(30, 3);
    b.home = { x: 100, y: 50, z: 30 };
    for (let i = 0; i < 1200; i++) b.step(1 / 30);
    let minD = Infinity;
    for (let i = 0; i < b.count; i++) {
      const speed = Math.hypot(b.vel[i * 3]!, b.vel[i * 3 + 1]!, b.vel[i * 3 + 2]! * 2);
      expect(speed).toBeGreaterThanOrEqual(b.minSpeed - 1e-3);
      expect(speed).toBeLessThanOrEqual(b.maxSpeed + 1e-3);
      expect(Math.hypot(b.pos[i * 3]! - 100, b.pos[i * 3 + 1]! - 50)).toBeLessThan(b.range * 1.5);
      for (let j = 0; j < i; j++) minD = Math.min(minD, Math.hypot(b.pos[i * 3]! - b.pos[j * 3]!, b.pos[i * 3 + 1]! - b.pos[j * 3 + 1]!, b.pos[i * 3 + 2]! - b.pos[j * 3 + 2]!));
    }
    expect(minD).toBeGreaterThan(0.05);
  });

  test("the ground controller turns aside from water and refuses cliffs", () => {
    const lake = { height: (x: number) => (x > 5 ? -3 : 0), blocked: (x: number) => x > 5 };
    const out = { x: 0, y: 0 };
    expect(moveOnGround(lake, 0, 0, 0, 1, out)).toBe(0);
    expect(out.x).toBe(1);
    expect(moveOnGround(lake, 5, 0, 0, 1, out)).not.toBeNull();
    expect(out.x).toBeLessThanOrEqual(5);
    const cliff = { height: (x: number) => (x > 0.5 ? 10 : 0), blocked: () => false };
    expect(moveOnGround(cliff, 0, 0, 0, 1, out, 0.7)).not.toBe(0);
    const walled = { height: () => 0, blocked: () => true };
    expect(moveOnGround(walled, 2, 3, 0, 1, out)).toBeNull();
    expect(out).toEqual({ x: 2, y: 3 });
    expect(rng(5)()).toBe(rng(5)());
  });

  test("Galahad walks round a pond in his way, and never sets foot in it", () => {
    const pond = { height: () => 0, blocked: (x: number, y: number) => Math.hypot(x - 50, y) < 8 };
    const w = new Walker({ x: 0, y: 0.5, facing: 0 });
    w.go({ x: 100, y: 0.5, facing: 0 }, []);
    for (let i = 0; i < 60 * 60 && (w.moving || w.waypoints.length); i++) {
      w.step(1 / 60, pond);
      expect(pond.blocked(w.x, w.y)).toBe(false);
    }
    expect(w.x).toBeCloseTo(100, 6);
    expect(w.y).toBeCloseTo(0.5, 6);
  });
});
