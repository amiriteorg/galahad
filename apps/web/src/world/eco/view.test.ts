import { describe, expect, test } from "bun:test";
import { Group, type InstancedMesh } from "three/webgpu";
import { Solids } from "../collide.ts";
import { emptySky } from "../daynight.ts";
import { Fauna } from "../fauna.ts";
import { TIERS } from "../tiers.ts";
import { Weather } from "../weather.ts";
import { plainHabitat } from "./habitat.ts";
import { Insects, NUDGE } from "./insects.ts";
import * as models from "./models.ts";
import { ANIM, batch, LEAN, MESHES, place, Poser, SPOT, STRIDE } from "./pose.ts";
import { Ecosystem, emptyEnv } from "./sim.ts";
import * as S from "./species.ts";
import { DOING, NO_CAPS, SPECS } from "./species.ts";
import { labelOf, summarise, summaryText } from "./summary.ts";
import { seasonOf } from "../season.ts";
import { WATER_LEVEL } from "../terrain.ts";

/*
 * The ecosystem as it's drawn and said: the models (each a real body standing on the ground, with its rig), the
 * pose written from the simulation (feet on the ground, nobody hovering or sunk), the scene's side of it (the
 * solids, the hover label, the HUD's summary, the dog's two calls), the insects and the fireflies' falling into step.
 */

const habitat = plainHabitat();
const ground = { height: habitat.height, blocked: habitat.blocked };

describe("the models", () => {
  const walkers = { roe: models.roe, hare: models.hare, fox: models.fox, hedgehog: models.hedgehog, squirrel: models.squirrel, mallard: models.mallard, heron: models.heron, bird: models.bird };
  // (The swan is never off the water: its body is drawn as it floats.)
  const flyers = { swan: models.swan, swallow: models.swallow, goose: models.goose, kestrel: models.kestrel, owl: models.owl, bat: models.bat, insect: models.insect };

  test("every animal is its own faceted body, a few hundred triangles, standing on the ground and facing forward, with a rig on every vertex", () => {
    for (const [name, make] of Object.entries({ ...walkers, ...flyers })) {
      const g = make();
      const p = g.getAttribute("position");
      const triangles = p.count / 3;
      expect(triangles, name).toBeGreaterThan(name === "insect" || name === "bat" ? 10 : 60);
      expect(triangles, name).toBeLessThan(1100);
      // Faceted: not indexed, a normal a face (three.js shades it flat).
      expect(g.index).toBeNull();
      for (const key of ["pivot", "rigA", "rigB", "color"] as const) {
        const a = g.getAttribute(key);
        expect(a.count, `${name} ${key}`).toBe(p.count);
        for (let i = 0; i < a.array.length; i++) expect(Number.isFinite(a.array[i]!)).toBe(true);
      }
      g.computeBoundingBox();
      const box = g.boundingBox!;
      // Symmetrical about its middle, longer than it's wide (it faces +z).
      expect(Math.abs(box.min.x + box.max.x), name).toBeLessThan(0.05);
      if (name in walkers) {
        // Its feet are on the ground: nothing below it, and something within a couple of centimetres of it.
        expect(box.min.y, name).toBeGreaterThan(-0.02);
        expect(box.min.y, name).toBeLessThan(0.04);
      }
      g.dispose();
    }
  });

  test("legs swing about their hips, necks about the shoulder, wings about theirs; only a buck has antlers and only a drake a green head", () => {
    const parts = (g: ReturnType<typeof models.roe>) => {
      const rigA = g.getAttribute("rigA");
      const rigB = g.getAttribute("rigB");
      let swing = 0;
      let nod = 0;
      let flapL = 0;
      let flapR = 0;
      let only = 0;
      let never = 0;
      for (let i = 0; i < rigA.count; i++) {
        if (rigA.getX(i) !== 0) swing++;
        if (rigA.getZ(i) !== 0) nod++;
        if (rigB.getX(i) > 0) flapL++;
        if (rigB.getX(i) < 0) flapR++;
        if (rigB.getZ(i) > 0) only++;
        if (rigB.getZ(i) < 0) never++;
      }
      return { swing, nod, flapL, flapR, only, never };
    };
    const deer = parts(models.roe());
    expect(deer.swing).toBeGreaterThan(100);
    expect(deer.nod).toBeGreaterThan(100);
    expect(deer.only).toBeGreaterThan(20);
    const duck = parts(models.mallard());
    // The drake's parts and the duck's, as many of each; and a wing a side.
    expect(duck.only).toBe(duck.never);
    expect(duck.only).toBeGreaterThan(100);
    expect(duck.flapL).toBe(duck.flapR);
    expect(duck.flapL).toBeGreaterThan(5);
    for (const make of [models.swallow, models.goose, models.kestrel, models.owl, models.bat, models.heron, models.swan, models.bird]) {
      const w = parts(make());
      expect(w.flapL).toBe(w.flapR);
      expect(w.flapL).toBeGreaterThan(5);
    }
  });
});

describe("the pose", () => {
  function posed(year = 0.45, night = 0) {
    const caps = { ...NO_CAPS, roe: 6, hare: 8, fox: 2, squirrel: 3, mallard: 6, swan: 2, heron: 1, fish: 8, songbird: 20, insects: 60, fireflies: 30 };
    const eco = new Ecosystem(habitat, { caps, seed: 3 });
    const insects = new Insects(habitat, caps.insects, caps.fireflies);
    const poser = new Poser(eco, insects);
    const batches = MESHES.map(() => batch(64));
    const env = emptyEnv();
    seasonOf(year, env.season);
    env.night = night;
    env.twilight = Math.max(0, 1 - Math.abs(night - 0.45) / 0.45);
    env.evening = 1;
    const run = (seconds: number, each?: () => void): void => {
      for (let t = 0; t < seconds; t += 1 / 30) {
        eco.step(1 / 30, env);
        insects.step(1 / 30, env, eco.midges);
        poser.write(batches, 0, 0, habitat.height, t, env.season);
        each?.();
      }
    };
    return { eco, insects, poser, batches, env, run };
  }

  test("everything that walks stands on the ground as it's drawn, the ducks ride the water, and nobody is drawn twice or left over", () => {
    const { eco, poser, batches, run } = posed();
    let checked = 0;
    run(90, () => {
      for (let i = 0; i < eco.n; i++) {
        if (!poser.drawn[i] || eco.air[i]) continue;
        const k = eco.kind[i]!;
        const h = habitat.height(eco.x[i]!, eco.y[i]!);
        const y = poser.drawnY[i]!;
        checked++;
        if (SPECS[k]!.realm === S.LAND) {
          // On the ground: never under it, never more than a bound above it (lying lowers a body onto its legs).
          expect(y - h).toBeGreaterThan(-0.7);
          expect(y - h).toBeLessThan(0.85);
          if (eco.speed[i]! < 0.05 && eco.lie[i]! < 0.01 && eco.doing[i] !== S.MOUSE) expect(Math.abs(y - h)).toBeLessThan(1e-4);
        } else if (SPECS[k]!.realm === S.WATER && h < WATER_LEVEL - 0.04) {
          expect(Math.abs(y - WATER_LEVEL)).toBeLessThan(0.15);
        } else if (k === S.FISH) expect(Math.abs(y - WATER_LEVEL)).toBeLessThan(0.05);
      }
    });
    expect(checked).toBeGreaterThan(10_000);
    // As many instances as animals in sight, each in its own mesh.
    const drawn = batches.reduce((n, b, m) => (m < 15 ? n + b.count : n), 0);
    let seen = 0;
    for (let i = 0; i < eco.n; i++) if (poser.drawn[i]) seen++;
    expect(drawn).toBe(seen);
    expect(batches[MESHES.indexOf("roe")]!.count).toBe(eco.count[S.ROE]!);
  });

  test("an instance is where its animal is, faces its way, and carries its rig: phase, stride, head and how far it's lying", () => {
    const out = batch(4);
    place(out, 2, 1, 2, 3, 0.5, 0.1, -0.2, 1.5, 1.25);
    const o = 2 * STRIDE;
    expect([...out.data.slice(o + SPOT, o + SPOT + 4)]).toEqual([1, 2, 3, 0.5]);
    expect(out.data[o + LEAN]).toBeCloseTo(0.1);
    expect(out.data[o + LEAN + 1]).toBeCloseTo(-0.2);
    expect(out.data[o + LEAN + 2]).toBeCloseTo(1.5);
    expect(out.data[o + LEAN + 3]).toBeCloseTo(1.25);
    const { eco, batches, run } = posed();
    let grazed = false;
    let walked = false;
    run(120, () => {
      const deer = batches[0]!;
      let n = 0;
      for (let i = eco.first[S.ROE]!; i < eco.first[S.ROE + 1]!; i++) {
        if (!eco.alive[i] || eco.shown[i]! < 0.02) continue;
        const q = n++ * STRIDE;
        expect(deer.data[q + SPOT]).toBeCloseTo(eco.x[i]!, 3);
        expect(deer.data[q + SPOT + 2]).toBeCloseTo(-eco.y[i]!, 3);
        // Facing its way (the scene's yaw is the heading turned a quarter).
        expect(deer.data[q + SPOT + 3]).toBeCloseTo(eco.heading[i]! + Math.PI / 2, 4);
        // Head down to graze, and legs still; legs going when it walks.
        if (eco.doing[i] === S.GRAZE && deer.data[q + ANIM + 2]! < -0.8 && deer.data[q + ANIM + 1]! < 0.05) grazed = true;
        if (eco.speed[i]! > 0.9 && deer.data[q + ANIM + 1]! > 0.4) walked = true;
      }
    });
    expect(grazed).toBe(true);
    expect(walked).toBe(true);
  });

  test("legs keep time with the ground covered: nobody slides (a stride's phase for a stride's length, at any speed)", () => {
    const eco = new Ecosystem(habitat, { caps: { ...NO_CAPS, roe: 1, hare: 1, fox: 1 }, seed: 9 });
    const env = emptyEnv();
    eco.step(1 / 60, env);
    for (const k of [S.ROE, S.HARE, S.FOX]) {
      const i = eco.first[k]!;
      const spec = SPECS[k]!;
      eco.x[i] = -20;
      eco.y[i] = -60 - k * 8;
      // A long walk east, then a run.
      for (const running of [false, true]) {
        eco.doing[i] = running ? S.FLEE : S.WALK;
        eco.fearX[i] = eco.x[i]! - 5;
        eco.fearY[i] = eco.y[i]!;
        eco.tx[i] = eco.x[i]! + 60;
        eco.ty[i] = eco.y[i]!;
        eco.timer[i] = 30;
        eco.think[i] = 30;
        let travelled = 0;
        let turned = 0;
        for (let f = 0; f < 60 * 4; f++) {
          const x = eco.x[i]!;
          const y = eco.y[i]!;
          const phase = eco.phase[i]!;
          eco.think[i] = 30;
          eco.step(1 / 60, env);
          const moved = Math.hypot(eco.x[i]! - x, eco.y[i]! - y);
          const dp = (eco.phase[i]! - phase + Math.PI * 2) % (Math.PI * 2);
          if (f < 30) continue;
          travelled += moved;
          turned += dp;
          // Standing, its legs are still; moving, they move.
          if (moved < 1e-6) expect(dp).toBe(0);
          else expect(dp).toBeGreaterThan(0);
        }
        // A stride (a full turn of the phase) covers between half and twice the animal's own stride length.
        const stride = travelled / (turned / (Math.PI * 2));
        expect(travelled).toBeGreaterThan(running ? 10 : 2.5);
        expect(stride).toBeGreaterThan(spec.stride * 0.5);
        expect(stride).toBeLessThan(spec.stride * 2.2);
      }
    }
  });
});

describe("the insects", () => {
  function meadow(year: number, night: number, opts: { rain?: number; lamps?: number } = {}) {
    const insects = new Insects(habitat, 80, 40, 7);
    insects.lights.set([0, -40, 2], 0);
    insects.lightCount = 1;
    const env = emptyEnv();
    seasonOf(year, env.season);
    env.night = night;
    env.twilight = Math.max(0, 1 - Math.abs(night - 0.45) / 0.45);
    env.evening = 1;
    env.rain = opts.rain ?? 0;
    env.lamps = opts.lamps ?? (night > 0.5 ? 1 : 0);
    env.fx = 20;
    env.fy = -10;
    const run = (seconds: number, each?: () => void): void => {
      for (let t = 0; t < seconds; t += 1 / 30) {
        insects.step(1 / 30, env, 0.8);
        each?.();
      }
    };
    return { insects, env, run };
  }

  test("bees and butterflies work flowers that are really there, by day, in bloom, in the dry; none in winter or in rain", () => {
    const { insects, run } = meadow(0.45, 0);
    let onFlower = 0;
    let looked = 0;
    run(40, () => {
      for (let i = 0; i < insects.n; i++) {
        const k = insects.kind[i]!;
        if ((k !== S.BUMBLEBEE && k !== S.BUTTERFLY) || insects.amount[i]! > 0.9) continue;
        // Settled: there's a flower's head right there.
        looked++;
        const flowers = habitat.flowers(Math.floor(insects.x[i]! / 64), Math.floor(insects.y[i]! / 64))!;
        for (let f = 0; f < flowers.length; f += 6) {
          if (Math.hypot(flowers[f]! - insects.x[i]!, flowers[f + 1]! - insects.y[i]!) < 0.08) {
            onFlower++;
            break;
          }
        }
      }
    });
    expect(insects.count[S.BUMBLEBEE]!).toBeGreaterThan(8);
    expect(insects.count[S.BUTTERFLY]!).toBeGreaterThan(8);
    expect(looked).toBeGreaterThan(500);
    expect(onFlower / looked).toBeGreaterThan(0.98);
    // The same meadow in January, and in June rain: nobody.
    for (const world of [meadow(0.04, 0), meadow(0.45, 0, { rain: 1 })]) {
      world.run(30);
      expect(world.insects.count[S.BUMBLEBEE]! + world.insects.count[S.BUTTERFLY]!).toBe(0);
    }
  });

  test("dragonflies keep to the water's edge by day; mayflies dance over it at dusk; moths circle a lit lantern at night", () => {
    const day = meadow(0.55, 0);
    day.env.fx = 28;
    day.env.fy = 0;
    day.run(40);
    expect(day.insects.count[S.DRAGONFLY]!).toBeGreaterThan(2);
    expect(day.insects.count[S.MAYFLY]!).toBe(0);
    expect(day.insects.count[S.MOTH]!).toBe(0);
    for (let i = 0; i < day.insects.n; i++) {
      if (day.insects.kind[i] !== S.DRAGONFLY) continue;
      expect(habitat.height(day.insects.x[i]!, day.insects.y[i]!)).toBeLessThan(WATER_LEVEL + 0.6);
      expect(day.insects.z[i]! - WATER_LEVEL).toBeGreaterThan(0.2);
    }
    const dusk = meadow(0.5, 0.45);
    dusk.env.fx = 28;
    dusk.env.fy = 0;
    let rose = 0;
    let fell = 0;
    const last = new Float32Array(dusk.insects.n);
    dusk.run(40, () => {
      for (let i = 0; i < dusk.insects.n; i++) {
        if (dusk.insects.kind[i] !== S.MAYFLY) continue;
        const dz = dusk.insects.z[i]! - last[i]!;
        if (last[i]! && dz > 0) rose++;
        if (last[i]! && dz < 0) fell++;
        last[i] = dusk.insects.z[i]!;
      }
    });
    expect(dusk.insects.count[S.MAYFLY]!).toBeGreaterThan(8);
    // Up slowly, down fast: about three frames rising for each falling.
    expect(rose / fell).toBeGreaterThan(2);
    expect(rose / fell).toBeLessThan(4.5);
    const night = meadow(0.5, 0.95);
    night.env.fx = 5;
    night.env.fy = -35;
    night.run(30);
    expect(night.insects.count[S.MOTH]!).toBeGreaterThan(2);
    for (let i = 0; i < night.insects.n; i++) {
      if (night.insects.kind[i] !== S.MOTH) continue;
      // Round the lantern, within arm's reach of it, never in it.
      const d = Math.hypot(night.insects.x[i]! - 0, night.insects.y[i]! + 40, night.insects.z[i]! - 2);
      expect(d).toBeLessThan(1.2);
      expect(d).toBeGreaterThan(0.1);
    }
    // The lantern out: no moths.
    const dark = meadow(0.5, 0.95, { lamps: 0 });
    dark.run(30);
    expect(dark.insects.count[S.MOTH]!).toBe(0);
  });

  test("fireflies fall into step with their neighbours, as real ones do; without seeing each other they never would", () => {
    const { insects, run } = meadow(0.5, 0.9);
    insects.coupled = false;
    run(60);
    const apart = insects.inStep();
    expect(insects.fireflyLevel).toBeGreaterThan(0.8);
    // Each on its own clock: no more in step than chance.
    expect(Math.abs(apart)).toBeLessThan(0.3);
    insects.coupled = true;
    run(150);
    const together = insects.inStep();
    expect(together).toBeGreaterThan(0.8);
    expect(NUDGE).toBeGreaterThan(0);
    // And they do flash: each bright for a moment in every couple of seconds.
    let flashes = 0;
    run(10, () => {
      for (let i = 0; i < insects.fireflies; i++) if (insects.glow[i]! > 0.97) flashes++;
    });
    expect(flashes).toBeGreaterThan(insects.fireflies * 3);
    console.log(`fireflies: in step with their neighbours ${apart.toFixed(2)} uncoupled, ${together.toFixed(2)} after two and a half minutes of seeing each other`);
  });
});

describe("in the scene", () => {
  function scene(tier: "low" | "medium" | "high" = "high") {
    const root = new Group();
    const fauna = new Fauna(root, TIERS[tier], ground, null);
    const solids = new Solids();
    fauna.join(solids);
    const sky = emptySky();
    const weather = new Weather("clear");
    const origin: [number, number] = [0, 0];
    const galahad = { x: 0, y: -30 };
    const dog = { x: 1, y: -31 };
    const frame = (dt = 1 / 30, motion = true) => fauna.step(dt, galahad.x, galahad.y, origin, sky, weather.state, galahad, dog, motion);
    return { root, fauna, solids, sky, weather, origin, galahad, dog, frame };
  }

  test("each kind is one instanced mesh, drawn only while someone of it is in sight; a tier without a kind doesn't make its mesh", () => {
    const { root, fauna, frame } = scene("high");
    for (let k = 0; k < 300; k++) frame();
    const meshes = root.children as InstancedMesh[];
    // Eighteen kinds of mesh and the sparks: no more, whatever is alive.
    expect(meshes.length).toBe(MESHES.length + 1);
    // WebGPU gives a pipeline eight vertex buffers: a mesh brings its position, colour and normal, its rig in one and
    // its instances in one, and the instanced mesh its own matrices. (With a buffer an attribute it was ten, and nothing drew.)
    for (const mesh of meshes) {
      const buffers = new Set<unknown>();
      for (const a of Object.values(mesh.geometry.attributes)) buffers.add((a as { data?: unknown }).data ?? a);
      expect(buffers.size + 1).toBeLessThanOrEqual(8);
    }
    const visible = meshes.filter((mesh) => mesh.visible);
    for (const mesh of visible) expect(mesh.count).toBeGreaterThan(0);
    for (const mesh of meshes) if (!mesh.visible) expect(mesh.count).toBe(0);
    // A summer's day: no bats, no owl, no fireflies, no starlings' roost: their meshes aren't drawn.
    expect(visible.length).toBeLessThan(14);
    expect(visible.length).toBeGreaterThan(5);
    expect(fauna.eco.count[S.BAT]).toBe(0);
    const low = scene("low");
    // (No hedgehog, swan, swallow or owl on the low tier: four meshes fewer.)
    expect(low.root.children.length).toBe(MESHES.length + 1 - 4);
    fauna.dispose();
    low.fauna.dispose();
    expect(root.children.length).toBe(0);
  });

  test("the walkers are among the solids: a hare goes round a trunk in its way, never through it", () => {
    const { fauna, solids, frame } = scene("medium");
    for (let k = 0; k < 30; k++) frame();
    const eco = fauna.eco;
    const hare = eco.first[S.HARE]!;
    expect(eco.alive[hare]).toBe(1);
    // A trunk between the hare and where it's going.
    solids.open();
    solids.circle(5, -60, 0.6, 0.5, 4);
    solids.close();
    eco.x[hare] = 0;
    eco.y[hare] = -60;
    let nearest = Infinity;
    for (let k = 0; k < 30 * 8; k++) {
      eco.doing[hare] = S.WALK;
      eco.tx[hare] = 10;
      eco.ty[hare] = -60;
      eco.timer[hare] = 20;
      eco.think[hare] = 20;
      eco.thirst[hare] = 0;
      frame();
      nearest = Math.min(nearest, Math.hypot(eco.x[hare]! - 5, eco.y[hare]! + 60));
    }
    // It got past, and was never inside the trunk (its own radius and the trunk's apart, less a skin).
    expect(eco.x[hare]!).toBeGreaterThan(7);
    expect(nearest).toBeGreaterThan(0.6 + 0.2 - 0.03);
  });

  test("hovering an animal says what it is and what it's doing; the summary says who's about; the dog's calls answer", () => {
    const { fauna, frame, origin } = scene("high");
    for (let k = 0; k < 200; k++) frame();
    const eco = fauna.eco;
    const deer = eco.first[S.ROE]!;
    // A ray from above and to the side, straight at the deer's middle.
    const from = { x: eco.x[deer]! + 6, y: habitat.height(eco.x[deer]!, eco.y[deer]!) + 5, z: -eco.y[deer]! + 3 };
    const to = { x: eco.x[deer]!, y: habitat.height(eco.x[deer]!, eco.y[deer]!) + 0.8, z: -eco.y[deer]! };
    const len = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    const ray = { origin: from, direction: { x: (to.x - from.x) / len, y: (to.y - from.y) / len, z: (to.z - from.z) / len } };
    const out: [number, number, number] = [0, 0, 0];
    const label = fauna.hover(ray, origin, out);
    expect(label).toBe(labelOf(eco, deer));
    expect(label!.startsWith("Roe deer · ") || label!.startsWith("Roe fawn · ")).toBe(true);
    expect(DOING as readonly string[]).toContain(label!.split(" · ")[1]!);
    expect(out[0]).toBe(eco.x[deer]!);
    // The label sits over its back.
    expect(out[2]).toBeGreaterThan(1);
    expect(out[2]).toBeLessThan(2.6);
    // Pointing at the empty sky: nothing.
    expect(fauna.hover({ origin: from, direction: { x: 0, y: 1, z: 0 } }, origin, out)).toBeNull();
    const sum = fauna.summary();
    expect(sum).toBe(fauna.summary());
    expect(sum.lines.some((l) => l.kind === "roe" && l.count === eco.count[S.ROE] && l.name === "Roe deer")).toBe(true);
    expect(sum.animals).toBeGreaterThan(20);
    expect(summaryText(sum)).toContain("Roe deer");
    expect(summarise(eco, null).lines.every((l) => l.count > 0 && l.doing.length > 0)).toBe(true);
    // The dog's side.
    const quarry = { x: 0, y: 0, kind: "", slot: -1 };
    const hare = eco.first[S.HARE]!;
    expect(fauna.nearestSmall(eco.x[hare]! + 1, eco.y[hare]!, 5, quarry)).toBe(true);
    expect(["hare", "squirrel", "mallard", "songbird"]).toContain(quarry.kind);
    fauna.startle(eco.x[hare]!, eco.y[hare]!, 4);
    expect(eco.doing[hare]).toBe(S.FLEE);
  });

  test("under reduced motion the animals are there, still, in tidy poses; nothing is in the air and nothing flashes", () => {
    const { root, fauna, frame } = scene("high");
    frame(1 / 30, false);
    const eco = fauna.eco;
    const before = [...eco.x];
    for (let k = 0; k < 60; k++) frame(1 / 30, false);
    expect([...eco.x]).toEqual(before);
    const meshes = root.children as InstancedMesh[];
    const shown = (name: (typeof MESHES)[number]) => meshes[MESHES.indexOf(name)]!.count;
    expect(shown("roe")).toBeGreaterThan(2);
    expect(shown("bird")).toBeGreaterThan(10);
    expect(shown("insect")).toBe(0);
    expect(shown("firefly")).toBe(0);
    expect(shown("swallow")).toBe(0);
    expect(shown("ring")).toBe(0);
  });
});
