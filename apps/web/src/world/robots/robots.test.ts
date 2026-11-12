import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ArmTask } from "../arms.ts";
import { ROBOT_MANIFESTS } from "../assets/robots/index.ts";
import { footContacts, OpenDuck, strideFor } from "./duck.ts";
import { Skeleton, type Vec3 } from "./kinematics.ts";
import { Group, Matrix4, MeshLambertMaterial } from "three/webgpu";
import { linkGeometry, type RobotAsset, RobotInstances } from "./load.ts";
import { decodeMeshes, parseManifest, type RobotManifest, treeOf } from "./manifest.ts";
import { ReachyMini } from "./reachy.ts";
import { So101 } from "./so101.ts";

const DIR = join(import.meta.dir, "../assets/robots");
/** Each robot's triangle budget and the most its geometry may weigh. */
const BUDGETS: Record<string, { triangles: number; bytes: number }> = {
  "open-duck-mini-v2": { triangles: 25_000, bytes: 300 * 1024 },
  "so-101": { triangles: 15_000, bytes: 300 * 1024 },
  "reachy-mini": { triangles: 30_000, bytes: 300 * 1024 },
  "open-source-rover": { triangles: 9_000, bytes: 120 * 1024 },
};

function load(name: string): { manifest: RobotManifest; bin: ArrayBuffer } {
  const manifest = parseManifest(JSON.parse(readFileSync(join(DIR, `${name}.json`), "utf8")));
  const bytes = readFileSync(join(DIR, manifest.bin.file));
  return { manifest, bin: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
}

describe("the generated robot assets", () => {
  test("every robot is there, within its triangle budget and size, and decodes", () => {
    expect(Object.keys(ROBOT_MANIFESTS).sort()).toEqual(Object.keys(BUDGETS).sort());
    for (const [name, budget] of Object.entries(BUDGETS)) {
      const { manifest, bin } = load(name);
      expect(manifest.name).toBe(name);
      expect(manifest.triangles).toBeLessThanOrEqual(budget.triangles);
      // Simplified to the budget, not far under it.
      expect(manifest.triangles).toBeGreaterThan(budget.triangles * 0.9);
      expect(bin.byteLength).toBeLessThanOrEqual(budget.bytes);
      expect(statSync(join(DIR, `${name}.json`)).size).toBeLessThan(32 * 1024);
      const meshes = decodeMeshes(manifest, bin);
      expect(meshes.reduce((n, m) => n + m.indices.length / 3, 0)).toBe(manifest.triangles);
      // Every drawn link is a link of the tree, and has something in it.
      for (const m of meshes) {
        expect(manifest.links.some((l) => l.name === m.link)).toBe(true);
        expect(m.indices.length).toBeGreaterThan(0);
      }
      expect(manifest.source.license).toBe("Apache-2.0");
      expect(manifest.source.commit).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  test("every joint names links that exist, every site sits on one, and the tree holds together", () => {
    for (const name of Object.keys(BUDGETS)) {
      const { manifest } = load(name);
      const links = new Set(manifest.links.map((l) => l.name));
      for (const j of manifest.joints) {
        expect(links.has(j.parent)).toBe(true);
        expect(links.has(j.child)).toBe(true);
      }
      for (const s of manifest.sites) expect(links.has(s.link)).toBe(true);
      const sk = new Skeleton(treeOf(manifest));
      // Depth-first, as written: the skeleton keeps the manifest's order.
      expect(sk.links).toEqual(manifest.links.map((l) => l.name));
    }
  });

  test("the index the world fetches by points at each manifest's current content", () => {
    for (const [name, entry] of Object.entries(ROBOT_MANIFESTS)) {
      const version = createHash("sha256").update(readFileSync(join(DIR, `${name}.json`))).digest("hex").slice(0, 8);
      expect(entry).toBe(`${name}.json?v=${version}`);
    }
    // No stale binaries left behind: one per robot, the one its manifest names.
    const bins = readdirSync(DIR).filter((f) => f.endsWith(".bin")).sort();
    expect(bins).toEqual(Object.keys(BUDGETS).map((n) => load(n).manifest.bin.file).sort());
  });

  test("the notice credits every model's source and commit, beside the licence", () => {
    const notice = readFileSync(join(DIR, "NOTICE.txt"), "utf8");
    for (const name of Object.keys(BUDGETS)) {
      const { manifest } = load(name);
      expect(notice).toContain(manifest.source.repo);
      expect(notice).toContain(manifest.source.commit);
    }
    expect(readFileSync(join(DIR, "LICENSE.txt"), "utf8")).toContain("Apache License");
  });

  test("a binary that doesn't match its manifest is refused, not half-drawn", () => {
    const { manifest, bin } = load("so-101");
    expect(() => decodeMeshes(manifest, bin.slice(0, bin.byteLength - 2))).toThrow("bytes");
    const broken = new Uint8Array(bin.slice(0));
    // An index pointing past its link's vertices.
    const layoutIndices = broken.byteLength - manifest.bin.indices * 2;
    broken[layoutIndices] = 0xff;
    broken[layoutIndices + 1] = 0xff;
    expect(() => decodeMeshes(manifest, broken.buffer)).toThrow("out of range");
    expect(() => parseManifest({ ...manifest, joints: manifest.joints.map((j, i) => (i === 0 ? { ...j, parent: "nowhere" } : j)) })).toThrow("isn't there");
  });
});

describe("the Open Duck Mini's gait", () => {
  const { manifest } = load("open-duck-mini-v2");
  const sk = new Skeleton(treeOf(manifest));
  const duck = new OpenDuck(sk, manifest);
  const input = { phase: 0, speed: 0.26, cadence: 9.9, hop: 0, headYaw: 0, headPitch: 0, chatter: 0, perky: false, t: 0, seed: 0 };

  test("the feet take turns: one swings while the other is planted, never both off the ground", () => {
    const swings: string[] = [];
    let last = "";
    for (let i = 0; i <= 400; i++) {
      const [left, right] = footContacts((i / 100) * Math.PI * 2);
      expect(left || right).toBe(true);
      const now = !left ? "L" : !right ? "R" : "";
      if (now && now !== last) swings.push(now);
      if (now) last = now;
    }
    expect(swings.join("")).toBe("LRLRLRLR");
  });

  test("on its real legs: a planted sole stays on the ground and slides back under the body, a swinging one lifts and comes forward", () => {
    const sole: Vec3 = [0, 0, 0];
    const stride = strideFor(input.speed, input.cadence);
    expect(stride).toBeGreaterThan(0.05);
    for (let i = 0; i < 64; i++) {
      const phase = (i / 64) * Math.PI * 2;
      duck.pose({ ...input, phase });
      const contacts = footContacts(phase);
      for (const leg of [0, 1] as const) {
        duck.sole(leg, sole);
        const theta = phase + (leg === 0 ? 0 : Math.PI);
        // Forward and back along the stride, wherever it is in the cycle (a millimetre or two of slack).
        expect(Math.abs(sole[0] - (duck.legs[leg]!.home[0] - (stride / 2) * Math.cos(theta)))).toBeLessThan(0.004);
        if (contacts[leg] && Math.sin(theta) < -0.2) expect(Math.abs(sole[2])).toBeLessThan(0.004);
        if (Math.sin(theta) > 0.7) expect(sole[2]).toBeGreaterThan(0.015);
      }
      // Every joint within its limits.
      sk.joints.forEach((j, k) => {
        if (j.type === "revolute") {
          expect(sk.q[k]!).toBeGreaterThanOrEqual(j.lower - 1e-9);
          expect(sk.q[k]!).toBeLessThanOrEqual(j.upper + 1e-9);
        }
      });
    }
  });

  test("standing, it's the real duck's crouch, about half a metre tall; pecking tips the head down", () => {
    duck.pose({ ...input, speed: 0 });
    expect(duck.standHeight).toBeGreaterThan(0.14);
    expect(duck.standHeight).toBeLessThan(0.19);
    expect(duck.height).toBeGreaterThan(0.4);
    expect(duck.height).toBeLessThan(0.6);
    const head = sk.linkIndex("head_assembly");
    const up = sk.point(head, [0.1, 0, 0], [0, 0, 0])[2];
    duck.pose({ ...input, speed: 0, headPitch: 1.1 });
    expect(sk.point(head, [0.1, 0, 0], [0, 0, 0])[2]).toBeLessThan(up - 0.03);
  });
});

describe("the SO-101 on the bench", () => {
  const { manifest } = load("so-101");

  test("inverse kinematics on the real arm reaches every point of the pick-and-place, within the joints' limits", () => {
    const arm = new So101(new Skeleton(treeOf(manifest)), manifest);
    let solves = 0;
    let misses = 0;
    const layout = arm.layout();
    const task = new ArmTask(5, {
      ...layout,
      solve: (x, y, z, out) => {
        solves++;
        const ok = layout.solve(x, y, z, out);
        if (!ok) misses++;
        return ok;
      },
    });
    let placed = 0;
    let held = -1;
    for (let i = 0; i < 60 * 40; i++) {
      task.step(1 / 60, i < 60 * 30);
      if (held >= 0 && task.held < 0) placed++;
      held = task.held;
      arm.sk.joints.forEach((j, k) => {
        expect(arm.sk.q[k]!).toBeGreaterThanOrEqual(j.lower - 1e-9);
        expect(arm.sk.q[k]!).toBeLessThanOrEqual(j.upper + 1e-9);
      });
    }
    expect(solves).toBeGreaterThan(60 * 40);
    expect(misses).toBe(0);
    expect(placed).toBeGreaterThanOrEqual(3);
    expect(task.phase).toBe("rest");
  });

  test("it puts the fingertips on each cube, pointing straight down", () => {
    const arm = new So101(new Skeleton(treeOf(manifest)), manifest);
    const layout = arm.layout();
    const j: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
    for (const [x, z] of layout.slots) {
      for (const y of [layout.cube * 0.6, layout.cube / 2 + layout.above]) {
        expect(layout.solve(x, y, z, j)).toBe(true);
        const w = arm.sk.world;
        const g = arm.sk.joints[arm.roll]!.child * 16;
        // The gripper's own z runs from its tip back up its length: straight up.
        expect(w[g + 9]!).toBeGreaterThan(0.999);
      }
    }
    // Out of reach: it says so.
    expect(layout.solve(0, 0.05, 0.6, j)).toBe(false);
  });
});

describe("Reachy Mini on the council table", () => {
  const { manifest } = load("reachy-mini");

  test("it turns to look at someone, body and head together, and looks about when no one's there", () => {
    const reachy = new ReachyMini(new Skeleton(treeOf(manifest)), manifest);
    const target: Vec3 = [0.4, 0.6, 0.5];
    for (let i = 0; i < 300; i++) reachy.step(1 / 30, i / 30, target);
    const face = reachy.facing([0, 0, 0]);
    const d = [target[0] - reachy.pivot[0], target[1] - reachy.pivot[1], target[2] - reachy.pivot[2]];
    const n = Math.hypot(d[0]!, d[1]!, d[2]!);
    // Within the head's limits, it faces the target to within a few degrees.
    expect((face[0] * d[0]! + face[1] * d[1]! + face[2] * d[2]!) / n).toBeGreaterThan(Math.cos((6 * Math.PI) / 180));
    const body = reachy.sk.q[reachy.sk.jointIndex("yaw_body")]!;
    expect(body).toBeGreaterThan(0.1);
    // Alone, it wanders its gaze, slowly.
    const yaws: number[] = [];
    for (let i = 0; i < 600; i++) {
      reachy.step(1 / 30, 100 + i / 30, null);
      yaws.push(reachy.facing([0, 0, 0])[1]);
    }
    expect(Math.max(...yaws) - Math.min(...yaws)).toBeGreaterThan(0.3);
  });
});

describe("many of a robot, drawn", () => {
  const asset = (name: string): RobotAsset => {
    const { manifest, bin } = load(name);
    return { manifest, geometries: new Map(decodeMeshes(manifest, bin).map((m) => [m.link, linkGeometry(m, manifest.materials)])) };
  };

  test("every link of every robot of a kind is one mesh: one object for the renderer, whatever the flock", () => {
    for (const name of ["open-duck-mini-v2", "so-101", "reachy-mini"]) {
      const a = asset(name);
      const root = new Group();
      const instances = new RobotInstances(a, new Skeleton(treeOf(a.manifest)), 5, root, new MeshLambertMaterial({ vertexColors: true }), true);
      expect(root.children).toEqual([instances.mesh]);
      expect(instances.mesh.castShadow).toBe(true);
      // All its links' triangles, once (the robots share them), and an instance for each link of each robot.
      expect(instances.mesh.geometry.getAttribute("position").count).toBe(a.manifest.triangles * 3);
      expect(instances.mesh.instanceCount).toBe(5 * a.geometries.size);
      instances.dispose();
      expect(root.children).toEqual([]);
    }
  });

  test("a robot's links are written where its posed skeleton has them, placed in the scene; the rest are hidden", () => {
    const a = asset("so-101");
    const sk = new Skeleton(treeOf(a.manifest));
    const instances = new RobotInstances(a, sk, 3, new Group(), new MeshLambertMaterial(), false);
    sk.q[0] = 0.4;
    sk.q[1] = -0.3;
    sk.fk();
    const place = new Matrix4().makeRotationY(0.7).setPosition(3, 1, -2).scale({ x: 2.5, y: 2.5, z: 2.5 } as never);
    instances.write(1, sk, place);
    const links = [...a.geometries.keys()];
    const got = new Matrix4();
    const want = new Matrix4();
    links.forEach((link, k) => {
      const l = sk.linkIndex(link) * 16;
      // (The skeleton's frames are rigid: its last row is 0 0 0 1.)
      const w = sk.world;
      want.set(w[l]!, w[l + 4]!, w[l + 8]!, w[l + 12]!, w[l + 1]!, w[l + 5]!, w[l + 9]!, w[l + 13]!, w[l + 2]!, w[l + 6]!, w[l + 10]!, w[l + 14]!, 0, 0, 0, 1).premultiply(place);
      instances.frame(1, k, got);
      for (let e = 0; e < 16; e++) expect(got.elements[e]!).toBeCloseTo(want.elements[e]!, 5);
    });
    // Fewer robots than there's room for: the others aren't drawn, and come back when asked for.
    const visible = (): number => {
      let n = 0;
      for (let i = 0; i < 3; i++) for (let k = 0; k < links.length; k++) if (instances.mesh.getVisibleAt(i * links.length + k)) n++;
      return n;
    };
    expect(visible()).toBe(3 * links.length);
    instances.count = 1;
    expect(visible()).toBe(links.length);
    instances.count = 3;
    expect(visible()).toBe(3 * links.length);
    instances.dispose();
  });
});
