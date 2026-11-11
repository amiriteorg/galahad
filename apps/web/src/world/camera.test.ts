import { describe, expect, test } from "bun:test";
import { STATIONS } from "@galahad/core/world";
import { ARM_SPEED, CAMERA_PAD, CameraRig, pitchFor, type Point3, SpringArm } from "./camera.ts";
import { BUILDS, Solids } from "./collide.ts";
import { ProvingGround } from "./field.ts";
import { FIELD } from "./field-plan.ts";
import { addPlants } from "./flora-plan.ts";
import { Workshop } from "./hall.ts";
import { HALL } from "./hall-plan.ts";
import { KEEP_COLLIDERS } from "./keep-plan.ts";
import { Planner } from "./nav.ts";
import { angleDiff, obstacles, PLACES, standAt, Walker } from "./path.ts";
import type { Place } from "./place.ts";
import { SITE_COLLIDERS } from "./sites.ts";
import { BASE_FLATS, BIG, CHUNK, chunkSamples, heightAt, SEED } from "./terrain.ts";
import { TIERS } from "./tiers.ts";

/*
 * The camera's spring arm on the real land among the real solids: orbiting
 * every station, the hall and the proving ground's edge (5 m up a hillside),
 * near and far, the camera is never inside anything, never under the land, and
 * it never jumps from one frame to the next.
 */

const ground = (x: number, y: number): number => heightAt(SEED, x, y, BASE_FLATS);
const solids = new Solids();
solids.add(KEEP_COLLIDERS);
solids.add(SITE_COLLIDERS, ground);
// The sites' own solids (the hangar, the tower, the hall's machines and fences), and their machines where they stand to begin with.
for (const place of [new ProvingGround({ tier: TIERS.medium, shadows: false, ground }), new Workshop({ tier: TIERS.medium, shadows: false, ground })] as Place[]) {
  solids.add(place.colliders, ground);
  solids.add((place.movers ?? []).filter((m) => m.r > 0).map((m) => ({ kind: "circle" as const, x: m.x, y: m.y, r: m.r, top: 3 })), ground);
  place.dispose();
}
for (let cx = Math.floor(-230 / CHUNK); cx <= Math.floor(150 / CHUNK); cx++) {
  for (let cy = Math.floor(-120 / CHUNK); cy <= Math.floor(100 / CHUNK); cy++) {
    const s = chunkSamples(SEED, cx, cy, BASE_FLATS, () => false, BIG);
    addPlants(solids, s.layers.trees, s.layers.rocks);
  }
}

/** Is the camera at (x, y, z) inside anything it keeps out of, or below the land? */
function wrong(x: number, y: number, z: number): string | null {
  if (solids.inside(x, y, z, CAMERA_PAD * 0.9)) return `inside a solid at ${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)}`;
  if (z < ground(x, y) + 0.5) return `under the land at ${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)}`;
  return null;
}

/** Turns the camera once round a focus at a distance, a frame at a time; the faults it meets, its biggest move in a frame and how many frames it moved more than half a metre in. */
function orbit(fx: number, fy: number, distance: number, motion = true): { faults: string[]; jump: number; pops: number } {
  const rig = new CameraRig();
  const arm = new SpringArm();
  rig.lookAt(fx, fy, distance);
  rig.target.yaw = 0;
  rig.update(0, false);
  const pivot: Point3 = { x: 0, y: 0, z: 0 };
  const want: Point3 = { x: 0, y: 0, z: 0 };
  const faults: string[] = [];
  let jump = 0;
  let pops = 0;
  let px = Number.NaN;
  let py = 0;
  let pz = 0;
  const dt = 1 / 60;
  // A full turn in eight seconds, as the HUD's rotate buttons or a drag would.
  for (let k = 0; k <= 480; k++) {
    rig.target.yaw = (k / 480) * Math.PI * 2;
    rig.update(motion ? dt : 0, motion);
    rig.wanted(ground(rig.x, rig.y), want, pivot);
    arm.update(pivot, want, solids, ground, dt, motion);
    const f = wrong(arm.x, arm.y, arm.z);
    if (f && faults.length < 5) faults.push(`yaw ${((rig.yaw * 180) / Math.PI).toFixed(0)}°: ${f}`);
    if (!Number.isNaN(px)) {
      const d = Math.hypot(arm.x - px, arm.y - py, arm.z - pz);
      jump = Math.max(jump, d);
      if (d > 0.5) pops++;
    }
    px = arm.x;
    py = arm.y;
    pz = arm.z;
  }
  return { faults, jump, pops };
}

/**
 * A hand turn, all the way round a focus at a distance: `drag` turns the view smoothly (a full turn in eight
 * seconds), `buttons` a sixteenth of a turn at a press, a press every half second (the HUD's buttons, Q and E),
 * the rig easing after each as it does. The faults it meets; the most the camera moved in a frame beyond what the
 * turn itself moved the arm's end that frame (and where), and the most it moved in a frame at all.
 */
function turn(fx: number, fy: number, distance: number, kind: "drag" | "buttons", dt: number): { faults: string[]; extra: number; at: string; most: number; behind: number } {
  const rig = new CameraRig();
  const arm = new SpringArm();
  rig.lookAt(fx, fy, distance);
  rig.target.yaw = 0.3;
  rig.update(0, false);
  const pivot: Point3 = { x: 0, y: 0, z: 0 };
  const want: Point3 = { x: 0, y: 0, z: 0 };
  const faults: string[] = [];
  let extra = 0;
  let at = "";
  let most = 0;
  let samples = 0;
  let behind = 0;
  let cx = Number.NaN;
  let cy = 0;
  let cz = 0;
  let wx = 0;
  let wy = 0;
  let wz = 0;
  const frames = Math.round(9 / dt);
  for (let k = 0; k <= frames; k++) {
    const t = k * dt;
    if (kind === "drag") rig.rotateBy(t < 8 ? (Math.PI * 2 * dt) / 8 : 0);
    else if (k > 0 && Math.floor(t / 0.5) !== Math.floor((t - dt) / 0.5) && t < 8.2) rig.rotateBy(Math.PI / 8);
    rig.update(dt, true);
    rig.wanted(ground(rig.x, rig.y), want, pivot);
    arm.update(pivot, want, solids, ground, dt, true);
    const f = wrong(arm.x, arm.y, arm.z);
    if (f && faults.length < 3) faults.push(`yaw ${((rig.yaw * 180) / Math.PI).toFixed(0)}°: ${f}`);
    if (!Number.isNaN(cx)) {
      const moved = Math.hypot(arm.x - cx, arm.y - cy, arm.z - cz);
      const turned = Math.hypot(want.x - wx, want.y - wy, want.z + arm.lift - wz);
      most = Math.max(most, moved);
      if (t < 8) {
        // How far it is off the arm's line (from his head out through where the turn wants it, lifted over the land).
        samples++;
        if (offArm(pivot, want.x, want.y, want.z + arm.lift, arm) > 3) behind++;
      }
      if (moved - turned > extra) {
        extra = moved - turned;
        at = `yaw ${((rig.yaw * 180) / Math.PI).toFixed(0)}°, ${moved.toFixed(2)} m against the turn's ${turned.toFixed(2)}`;
      }
    }
    cx = arm.x;
    cy = arm.y;
    cz = arm.z;
    wx = want.x;
    wy = want.y;
    wz = want.z + arm.lift;
  }
  return { faults, extra, at, most, behind: behind / Math.max(1, samples) };
}

/** How far the camera is from the arm's line: from the pivot out through (wx, wy, wz) and on, whatever it's tilted. */
function offArm(p: Point3, wx: number, wy: number, wz: number, c: Point3): number {
  // In the vertical plane of the arm, the camera may be tilted up from it; across it, it may not.
  const ax = wx - p.x;
  const ay = wy - p.y;
  const h = Math.hypot(ax, ay) || 1;
  const across = Math.abs(((c.x - p.x) * ay - (c.y - p.y) * ax) / h);
  const along = ((c.x - p.x) * ax + (c.y - p.y) * ay) / h;
  return Math.max(across, along < 0 ? -along : 0);
}

/** Where the hand turns are tried. */
const FOCI: [string, number, number][] = (() => {
  const out: [string, number, number][] = [];
  for (const place of PLACES) {
    const s = standAt(place);
    out.push([`${place}'s stand`, s.x, s.y]);
    for (const r of [5, 10]) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + r * 0.1;
        out.push([`${place} +${r} m ${k * 45}°`, STATIONS[place].x + Math.cos(a) * r, STATIONS[place].y + Math.sin(a) * r]);
      }
    }
  }
  // The hall: before its door, in the doorway, along the aisle, by each wall inside and out, in its corners.
  const { x, y, hx, hy } = HALL;
  for (const [name, fx, fy] of [
    ["before the hall's door", x - hx - 6, y],
    ["the hall's doorway", x - hx + 1, y],
    ["the hall's aisle", x - 8, y],
    ["the hall's far end", x + hx - 4, y],
    ["by the hall's north wall, in", x, y + hy - 2],
    ["by the hall's south wall, in", x + 6, y - hy + 2],
    ["by the hall's north wall, out", x - 5, y + hy + 3],
    ["by the hall's south wall, out", x + 10, y - hy - 3],
    ["by the hall's east wall, out", x + hx + 3, y + 8],
    ["the hall's north-west corner, in", x - hx + 3, y + hy - 3],
    ["the hall's south-east corner, in", x + hx - 3, y - hy + 3],
    ["outside the hall's south-west corner", x - hx - 3, y - hy - 3],
  ] as const) out.push([name, fx, fy]);
  // Along the proving ground's edge: below it on the slope, on it, just inside it; every side.
  for (const [name, fx, fy] of [
    ["below the proving ground's east edge", FIELD.x + FIELD.hx + 8, FIELD.y],
    ["on the proving ground's east edge", FIELD.x + FIELD.hx + 2, FIELD.y - 30],
    ["inside the proving ground's east edge", FIELD.x + FIELD.hx - 3, FIELD.y + 40],
    ["by the proving ground's gate", FIELD.x + FIELD.hx + 3, FIELD.y + 4],
    ["off the proving ground's north edge", FIELD.x + 20, FIELD.y + FIELD.hy + 6],
    ["off the proving ground's south edge", FIELD.x - 10, FIELD.y - FIELD.hy - 6],
    ["by the hangar", FIELD.x - 20, FIELD.y + 30],
    ["on the apron", FIELD.x - 10, FIELD.y + 10],
  ] as const) out.push([name, fx, fy]);
  return out;
})();

describe("the camera's spring arm", () => {
  test("round every station, near and farther, it's never inside anything or under the land", () => {
    const faults: string[] = [];
    for (const place of PLACES) {
      const s = standAt(place);
      for (const distance of [5, 10, 22, 40]) for (const f of orbit(s.x, s.y, distance).faults) faults.push(`${place} at ${distance} m, ${f}`);
      for (const f of orbit(STATIONS[place].x, STATIONS[place].y, 10).faults) faults.push(`${place}'s middle, ${f}`);
    }
    expect(faults).toEqual([]);
  });

  test("on the edge of the proving ground, 5 m up its hillside, it stays over the land all the way round", () => {
    const faults: string[] = [];
    // Below the east edge on the slope, on the edge, and just inside it; north and south edges too.
    const foci: [number, number][] = [
      [FIELD.x + FIELD.hx + 8, FIELD.y],
      [FIELD.x + FIELD.hx + 2, FIELD.y - 30],
      [FIELD.x + FIELD.hx - 3, FIELD.y + 40],
      [FIELD.x + 20, FIELD.y + FIELD.hy + 6],
      [FIELD.x - 10, FIELD.y - FIELD.hy - 6],
    ];
    for (const [x, y] of foci) for (const distance of [5, 10, 22, 60]) for (const f of orbit(x, y, distance).faults) faults.push(`${x},${y} at ${distance} m, ${f}`);
    expect(faults).toEqual([]);
  });

  test("at the workshop hall, outside and indoors, it never stands in a wall", () => {
    const faults: string[] = [];
    for (const [x, y] of [[HALL.x - HALL.hx - 4, HALL.y], [HALL.x, HALL.y], [HALL.x + 10, HALL.y + 11], [HALL.x - HALL.hx + 3, HALL.y - HALL.hy + 3]] as const) {
      for (const distance of [5, 10, 22, 62]) for (const f of orbit(x, y, distance).faults) faults.push(`${x},${y} at ${distance} m, ${f}`);
    }
    expect(faults).toEqual([]);
  });

  test("turned by hand anywhere round the keep, the stations, the hall and the proving ground's edge, it never jumps: it moves no more in a frame than the turn does, plus the arm's own 12 m/s", () => {
    // A dense set of places (FOCI), near and far; turned smoothly (a drag or a twist: a full turn in eight seconds,
    // at 60 frames a second) and in steps (the HUD's buttons, Q and E: a press every half second, at a phone's 30).
    const faults: string[] = [];
    let most = 0;
    let worst = 0;
    // How much of each turn it spends more than 3 m off its arm's line (against a wall the arm points through, round
    // the keep's tree): in all, and at his stands.
    let behind = 0;
    let turns = 0;
    let behindAtStands = 0;
    let stands = 0;
    for (const [name, x, y] of FOCI) {
      for (const distance of [5, 10, 14, 22, 32]) {
        for (const [kind, dt] of [["drag", 1 / 60], ["buttons", 1 / 30]] as const) {
          const r = turn(x, y, distance, kind, dt);
          const where = `${name} at ${distance} m (${kind})`;
          for (const f of r.faults) if (faults.length < 40) faults.push(`${where}: ${f}`);
          // Beyond what the turn itself moves it, the arm adds no more than ARM_SPEED: 0.2 m a frame at 60, 0.4 at 30.
          if (r.extra > ARM_SPEED * dt + 0.02 && faults.length < 40) faults.push(`${where}: hopped ${r.extra.toFixed(2)} m more than the turn (${r.at})`);
          worst = Math.max(worst, r.extra / dt);
          if (kind === "drag") most = Math.max(most, r.most);
          behind += r.behind;
          turns++;
          if (name.endsWith("'s stand")) {
            behindAtStands += r.behind;
            stands++;
          }
        }
      }
    }
    expect(faults).toEqual([]);
    // At a drag's pace it never moves more than 0.65 m in a frame anywhere: the turn itself moves it 0.42 m a frame
    // 32 m out, and the arm adds at most 0.2.
    expect(most).toBeLessThan(0.65);
    expect(worst).toBeLessThan(ARM_SPEED * 1.1 + 1);
    // And it's on its arm's line (within 3 m) nineteen frames in twenty, at his stands as everywhere: it isn't left behind.
    expect(behind / turns).toBeLessThan(0.07);
    expect(behindAtStands / stands).toBeLessThan(0.07);
  }, 30_000); // (A dense sweep: about 5 s here, more on a busy machine.)

  test("following him from station to station, it swings round behind him in clear air: never inside anything, and no hops", () => {
    const planner = new Planner(solids);
    const walker = new Walker(standAt("keep"));
    const mover = solids.join(walker, BUILDS.galahad);
    walker.join({ planner, mover, wet: null });
    const rig = new CameraRig();
    const arm = new SpringArm();
    const pivot: Point3 = { x: 0, y: 0, z: 0 };
    const want: Point3 = { x: 0, y: 0, z: 0 };
    // As the scene asks: from his head to where the camera would be, nothing blocks the view, and it's over the land.
    const clear = (x: number, y: number): boolean => {
      const t = rig.target;
      const g = ground(t.x, t.y);
      const z = g + 1.5 + t.distance * Math.sin(pitchFor(t.distance));
      return ground(x, y) + 0.8 < z && solids.view(t.x, t.y, g + 2.3, x, y, z, 0.3, CAMERA_PAD) > 0.97;
    };
    const faults: string[] = [];
    let pops = 0;
    const dt = 1 / 60;
    let last: Point3 | null = null;
    for (const place of ["forge", "council", "watchtower", "observatory", "library", "oracle", "treasury", "messenger", "keep"] as const) {
      walker.go(standAt(place), obstacles());
      for (let k = 0; k < 60 * 30 && (walker.moving || walker.waypoints.length || k < 60 * 8); k++) {
        walker.step(dt);
        rig.lookAt(walker.x, walker.y);
        rig.trail(walker.heading, walker.moving, dt, clear);
        rig.update(dt, true);
        rig.wanted(ground(rig.x, rig.y), want, pivot);
        arm.update(pivot, want, solids, ground, dt, true);
        const f = wrong(arm.x, arm.y, arm.z);
        if (f && faults.length < 5) faults.push(`to the ${place}: ${f}`);
        if (last && Math.hypot(arm.x - last.x, arm.y - last.y, arm.z - last.z) > 0.5) pops++;
        last = { x: arm.x, y: arm.y, z: arm.z };
      }
    }
    expect(faults).toEqual([]);
    expect(pops).toBe(0);
  });

  test("turned by hand while it follows him, it stays where it's turned, as far out as it was", () => {
    const rig = new CameraRig();
    rig.lookAt(0, 0, 14);
    rig.target.yaw = 0;
    rig.update(0, false);
    // Everything east of him blocks the view.
    const clear = (x: number) => x < 0;
    // Turned to look west from the east: where nothing would be clear.
    rig.rotateBy(Math.PI);
    for (let k = 0; k < 60 * 3; k++) rig.trail(0, false, 1 / 60, clear);
    expect(Math.abs(angleDiff(rig.target.yaw, Math.PI))).toBeLessThan(1e-9);
    expect(rig.target.distance).toBe(14);
    // Left alone a while, it goes back round to a clear side.
    for (let k = 0; k < 60 * 8; k++) rig.trail(0, false, 1 / 60, clear);
    expect(Math.cos(rig.target.yaw)).toBeGreaterThan(0);
  });

  test("under reduced motion it goes straight where it may, with nothing eased", () => {
    const s = standAt("keep");
    const { faults } = orbit(s.x, s.y, 10, false);
    expect(faults).toEqual([]);
  });
});
