import { describe, expect, test } from "bun:test";
import { STATIONS } from "@galahad/core/world";
import { CAMERA_PAD, CameraRig, pitchFor, type Point3, SpringArm } from "./camera.ts";
import { BUILDS, Solids } from "./collide.ts";
import { FIELD } from "./field-plan.ts";
import { addPlants } from "./flora-plan.ts";
import { HALL } from "./hall-plan.ts";
import { KEEP_COLLIDERS } from "./keep-plan.ts";
import { Planner } from "./nav.ts";
import { obstacles, PLACES, standAt, Walker } from "./path.ts";
import { SITE_COLLIDERS } from "./sites.ts";
import { BASE_FLATS, BIG, CHUNK, chunkSamples, heightAt, SEED } from "./terrain.ts";

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

  test("it eases: turned all the way round a station by hand, it moves smoothly but for a hop or two past something big (the giant tree's crown)", () => {
    for (const place of ["keep", "forge", "council", "watchtower", "library", "messenger"] as const) {
      const s = standAt(place);
      for (const distance of [10, 22]) {
        // A frame of the turn itself moves it 8 to 18 cm, the arm at most 20 cm more: a hop is more than half a metre.
        expect(orbit(s.x, s.y, distance).pops).toBeLessThanOrEqual(4);
      }
    }
  });

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

  test("under reduced motion it goes straight where it may, with nothing eased", () => {
    const s = standAt("keep");
    const { faults } = orbit(s.x, s.y, 10, false);
    expect(faults).toEqual([]);
  });
});
