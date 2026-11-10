import { describe, expect, test } from "bun:test";
import { emptySky, localHours, skyAt } from "./daynight.ts";
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
    for (let i = 0; i < 20; i++) actions.push(second((t += 1100), () => 15 + 40 * (g.dpr / 2) ** 2));
    expect(actions.filter((a) => a !== "none")).toEqual(["dpr", "dpr", "dpr", "dpr", "drop-shadows", "drop-grass"]);
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
    for (let i = 0; i < 12; i++) actions.push(second(26));
    expect(actions.filter((a) => a !== "none")).toEqual(["dpr", "dpr", "drop-shadows", "drop-grass"]);
    expect(g.dpr).toBe(2);
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
    for (let i = 0; i < 12; i++) second(() => Math.max(12, 30 * (g.dpr / 2) ** 2));
    expect(g.dpr).toBeLessThan(2);
    expect(g.dpr).toBeGreaterThanOrEqual(TIERS.high.minDpr);
  });

  test("phones never drop below a pixel ratio of 1", () => {
    expect(TIERS.medium.minDpr).toBeGreaterThanOrEqual(1);
  });
});

describe("day and night", () => {
  const sky = emptySky();

  test("the sun rises in the east, is high and south at noon, sets in the west, and is down at night", () => {
    skyAt(6.5, sky);
    expect(sky.sun[0]).toBeGreaterThan(0.5);
    expect(sky.sun[2]).toBeGreaterThan(0);
    skyAt(12.5, sky);
    expect(sky.sun[2]).toBeGreaterThan(0.8);
    expect(sky.sun[1]).toBeLessThan(0);
    skyAt(18.5, sky);
    expect(sky.sun[0]).toBeLessThan(-0.5);
    skyAt(1, sky);
    expect(sky.sun[2]).toBeLessThan(0);
    expect(sky.moon[2]).toBeGreaterThan(0.3);
    expect(sky.night).toBe(1);
    expect(sky.stars).toBeGreaterThan(0.9);
    expect(sky.lightFromSun).toBe(false);
  });

  test("days are bright and starless, golden hour is warm, nights are dark; colours change smoothly", () => {
    skyAt(12.5, sky);
    expect(sky.night).toBe(0);
    expect(sky.stars).toBe(0);
    const noon = sky.lightIntensity;
    skyAt(18.6, sky);
    expect(sky.golden).toBeGreaterThan(0.3);
    expect(((sky.light >> 16) & 255) - (sky.light & 255)).toBeGreaterThan(60);
    skyAt(23, sky);
    expect(sky.lightIntensity).toBeLessThan(noon / 3);
    const lum = (c: number) => ((c >> 16) & 255) + ((c >> 8) & 255) + (c & 255);
    expect(lum(sky.zenith)).toBeLessThan(100);
    let prev = lum(skyAt(0, sky).horizon);
    for (let h = 0.05; h < 24; h += 0.05) {
      const now = lum(skyAt(h, sky).horizon);
      expect(Math.abs(now - prev)).toBeLessThan(60);
      prev = now;
    }
    expect(skyAt(24, sky).zenith).toBe(skyAt(0, sky).zenith);
  });

  test("the local hour comes from the viewer's clock", () => {
    expect(localHours(new Date(2026, 0, 1, 18, 30))).toBeCloseTo(18.5, 9);
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
