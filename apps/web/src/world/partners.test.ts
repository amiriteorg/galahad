import { describe, expect, test } from "bun:test";
import { defaultAvatar, type AvatarProfile } from "@galahad/core/avatar";
import type { WorldPartner } from "@galahad/core/world";
import { Color, DoubleSide, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three/webgpu";
import { auditGeometry } from "../../../../bench/models/audit.ts";
import { Solids } from "./collide.ts";
import { KEEP_COLLIDERS } from "./keep-plan.ts";
import { figureInWords, KEEP_DOOR, MAX, PartnerFigures, Partners, SQUIRE } from "./partners.ts";

/*
 * The agents working with him, as figures: one appears at the keep when its first call
 * comes, walks to a place beside him, and when it's gone quiet walks back and fades.
 */

const partner = (name: string, station: WorldPartner["station"] = "library"): WorldPartner => ({ name, station, doing: "Recall from the shared mind", since: 0, last: 0 });
const him = { x: -18, y: 12, heading: Math.PI / 2, moving: false };
const run = (f: PartnerFigures, seconds: number, motion = true) => {
  for (let s = 0; s < seconds; s += 1 / 30) f.step(1 / 30, him, motion);
};
const worker = (id: string, name = id, avatar: AvatarProfile = defaultAvatar(id)): WorldPartner => ({ ...partner(name), id, avatar, expression: "idle" });

describe("a partner", () => {
  test("a worker keeps its figure and position when renamed, including names shared by another worker or arm", () => {
    const f = new PartnerFigures();
    f.sync([worker("team:a", "Moss"), worker("team:b", "Moss"), partner("Moss")]);
    run(f, 2);
    const a = f.squires.find((s) => s.id === "team:a")!;
    const before = [a.x, a.y, a.shown, a.phase];
    f.sync([worker("team:a", "Fern"), worker("team:b", "Moss"), partner("Moss")]);
    expect(f.count).toBe(3);
    expect(f.squires.find((s) => s.id === "team:a")).toBe(a);
    expect([a.x, a.y, a.shown, a.phase]).toEqual(before);
    expect(a.name).toBe("Fern");
    expect(f.squires.find((s) => s.name === "Moss" && !s.id)?.avatar).toBeUndefined();
  });

  test("cosmetic rhythms follow immutable identity across renames, snapshots and slot order", () => {
    const f = new PartnerFigures();
    f.sync([worker("team:a", "Moss"), worker("team:b", "Moss")]);
    const a = f.squires[0]!.avatarPhase, b = f.squires[1]!.avatarPhase;
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).not.toBe(b);
    f.sync([worker("team:b", "Fern"), worker("team:a", "Juniper")]);
    expect(f.squires.find((s) => s.id === "team:a")!.avatarPhase).toBe(a);
    const fresh = new PartnerFigures();
    fresh.sync([worker("team:b", "Fern"), worker("team:a", "Juniper")]);
    expect(fresh.squires[1]!.avatarPhase).toBe(a);
  });

  test("avatar updates use safe profile data and a reused slot returns to the legacy squire", () => {
    const f = new PartnerFigures();
    const p = worker("team:a");
    f.sync([p]);
    p.avatar!.color = "url(unsafe)";
    expect(f.squires[0]!.avatar!.color).not.toBe("url(unsafe)");
    f.sync([p]);
    expect(f.squires[0]!.avatar).toEqual(defaultAvatar(p.id!));
    f.sync([]);
    run(f, 1 / 30, false);
    f.sync([partner("opencode")]);
    expect(f.squires[0]!.id).toBeUndefined();
    expect(f.squires[0]!.avatar).toBeUndefined();
    expect(f.squires[0]!.expression).toBeUndefined();
  });
  test("appears at the keep's door, small, and grows as it comes", () => {
    const f = new PartnerFigures();
    f.sync([partner("claude-code")]);
    const s = f.squires.find((q) => q.name === "claude-code")!;
    expect([s.x, s.y]).toEqual([KEEP_DOOR.x, KEEP_DOOR.y]);
    expect(s.shown).toBe(0);
    run(f, 0.3);
    expect(s.shown).toBeGreaterThan(0);
    expect(s.shown).toBeLessThan(1);
    expect(f.count).toBe(1);
  });

  test("walks to its place beside him, and stays there while he works", () => {
    const f = new PartnerFigures();
    f.sync([partner("claude-code")]);
    run(f, 20);
    const s = f.squires.find((q) => q.name === "claude-code")!;
    expect(Math.hypot(s.x - him.x, s.y - him.y)).toBeLessThan(2.2);
    expect(Math.hypot(s.x - him.x, s.y - him.y)).toBeGreaterThan(1);
    expect(s.shown).toBe(1);
    expect(s.r).toBeGreaterThan(0);
  });

  test("its door at the keep is open ground, and from there it finds its way round the keep to him, in his footsteps", () => {
    const solids = new Solids();
    solids.add(KEEP_COLLIDERS);
    const probe = solids.join({ x: KEEP_DOOR.x, y: KEEP_DOOR.y, r: SQUIRE.r }, SQUIRE);
    expect(probe.fits(KEEP_DOOR.x, KEEP_DOOR.y, 0.05)).toBe(true);
    const f = new PartnerFigures();
    f.join(solids, { height: () => 0, blocked: () => false });
    f.sync([partner("claude-code")]);
    // He walks from the keep's door round to the library's side (north-west, past the keep), leaving footsteps.
    const leader = { x: KEEP_DOOR.x, y: KEEP_DOOR.y - 1, heading: Math.PI, moving: true };
    const way = [
      [-10, -9],
      [-14, -2],
      [-15, 6],
    ];
    for (const [x, y] of way) {
      for (let k = 0; k < 120; k++) {
        const d = Math.hypot(x! - leader.x, y! - leader.y);
        if (d < 0.05) break;
        leader.heading = Math.atan2(y! - leader.y, x! - leader.x);
        const step = Math.min(d, 2 / 30);
        leader.x += Math.cos(leader.heading) * step;
        leader.y += Math.sin(leader.heading) * step;
        f.step(1 / 30, leader, true);
      }
    }
    leader.moving = false;
    for (let k = 0; k < 600; k++) f.step(1 / 30, leader, true);
    const s = f.squires.find((q) => q.name === "claude-code")!;
    expect(Math.hypot(s.x - leader.x, s.y - leader.y)).toBeLessThan(2.5);
  });

  test("the page opens with him already at the library, the keep in the way and no footsteps to follow: a worker still ends beside him, and is never left walking on the spot", () => {
    const solids = new Solids();
    solids.add(KEEP_COLLIDERS);
    const f = new PartnerFigures();
    f.join(solids, { height: () => 0, blocked: () => false });
    // Where he stood when a real browser showed two knights stuck at the foot of the keep's stairs (13 November 2026).
    const leader = { x: -14.253, y: 6.335, heading: Math.PI / 2, moving: false };
    f.sync([worker("team.0a1b2c3d4e.ada", "Galahad · Ada"), worker("team.0a1b2c3d4e.bors", "Galahad · Bors"), partner("claude-code")]);
    const far = (s: { x: number; y: number }) => Math.hypot(s.x - leader.x, s.y - leader.y);
    for (let k = 0; k < 30 * 30; k++) f.step(1 / 30, leader, true);
    const figures = f.squires.filter((s) => s.name);
    expect(figures).toHaveLength(3);
    for (const s of figures) expect([s.name, far(s) < 3.5, s.shown]).toEqual([s.name, true, 1]);
    // Once there it stays there: nothing moves it again while he stands still.
    const before = figures.map((s) => [s.x, s.y]);
    for (let k = 0; k < 30 * 20; k++) f.step(1 / 30, leader, true);
    for (const [i, s] of figures.entries()) expect(Math.hypot(s.x - before[i]![0]!, s.y - before[i]![1]!)).toBeLessThan(0.3);
  });

  test("a figure that is making its way is left to it: one walking his footsteps round the keep is never moved for it", () => {
    const solids = new Solids();
    solids.add(KEEP_COLLIDERS);
    const f = new PartnerFigures();
    f.join(solids, { height: () => 0, blocked: () => false });
    f.sync([worker("team.0a1b2c3d4e.ada", "Galahad · Ada")]);
    const leader = { x: KEEP_DOOR.x, y: KEEP_DOOR.y - 1, heading: Math.PI, moving: true };
    const s = f.squires.find((q) => q.id === "team.0a1b2c3d4e.ada")!;
    let jumped = 0;
    const stride = (to: [number, number]) => {
      for (let k = 0; k < 400; k++) {
        const d = Math.hypot(to[0] - leader.x, to[1] - leader.y);
        if (d < 0.05) break;
        leader.heading = Math.atan2(to[1] - leader.y, to[0] - leader.x);
        const step = Math.min(d, 2 / 30);
        leader.x += Math.cos(leader.heading) * step;
        leader.y += Math.sin(leader.heading) * step;
        const [x, y] = [s.x, s.y];
        f.step(1 / 30, leader, true);
        // (Walking covers at most a few centimetres a step: more than half a metre is a figure that was put somewhere.)
        if (Math.hypot(s.x - x, s.y - y) > 0.5) jumped++;
      }
    };
    for (const to of [[-10, -9], [-14, -2], [-15, 6]] as [number, number][]) stride(to);
    leader.moving = false;
    for (let k = 0; k < 600; k++) { const [x, y] = [s.x, s.y]; f.step(1 / 30, leader, true); if (Math.hypot(s.x - x, s.y - y) > 0.5) jumped++; }
    expect(jumped).toBe(0);
    expect(Math.hypot(s.x - leader.x, s.y - leader.y)).toBeLessThan(2.5);
  });

  test("two never stand in one place", () => {
    const f = new PartnerFigures();
    f.sync([partner("claude-code"), partner("opencode")]);
    run(f, 20);
    const [a, b] = f.squires.filter((q) => q.name);
    expect(Math.hypot(a!.x - b!.x, a!.y - b!.y)).toBeGreaterThan(0.6);
  });

  test("gone quiet: it walks back to the keep and fades, and its place is free again", () => {
    const f = new PartnerFigures();
    f.sync([partner("claude-code")]);
    run(f, 20);
    f.sync([]);
    run(f, 0.4);
    const s = f.squires.find((q) => q.name === "claude-code")!;
    expect(s.here).toBe(false);
    expect(s.shown).toBeLessThan(1);
    run(f, 30);
    expect(f.squires.some((q) => q.name === "claude-code")).toBe(false);
    expect(f.count).toBe(0);
  });

  test("six of them cost next to nothing a frame", () => {
    const solids = new Solids();
    solids.add(KEEP_COLLIDERS);
    const f = new PartnerFigures();
    f.join(solids, { height: () => 0, blocked: () => false });
    f.sync(Array.from({ length: MAX }, (_, i) => partner(`agent-${i}`)));
    const leader = { x: -18, y: 12, heading: 0, moving: true };
    for (let k = 0; k < 60; k++) f.step(1 / 30, leader, true);
    // The fastest of a few batches: what the code costs, not what the machine was busy with (the suite runs alongside).
    let per = Infinity;
    for (let batch = 0; batch < 5; batch++) {
      const t0 = performance.now();
      for (let k = 0; k < 300; k++) {
        leader.heading += 0.01;
        f.step(1 / 30, leader, true);
      }
      per = Math.min(per, (performance.now() - t0) / 300);
    }
    expect(per).toBeLessThan(0.2);
    console.log(`partners: ${(per * 1000).toFixed(1)} µs a frame for ${MAX}`);
  });

  test("at most a handful at once; under reduced motion they're simply there, or not", () => {
    const f = new PartnerFigures();
    f.sync(Array.from({ length: MAX + 3 }, (_, i) => partner(`agent-${i}`)));
    expect(f.count).toBe(MAX);
    const still = new PartnerFigures();
    still.sync([partner("claude-code")]);
    run(still, 1 / 30, false);
    const s = still.squires.find((q) => q.name === "claude-code")!;
    expect(s.shown).toBe(1);
    expect(Math.hypot(s.x - him.x, s.y - him.y)).toBeLessThan(2.2);
    still.sync([]);
    run(still, 1 / 30, false);
    expect(still.count).toBe(0);
  });

  test("said in words, a worker is his own and an agent over MCP is an agent: under the pointer and in what he sees", () => {
    const view = new Partners(new Group(), false);
    view.figures.sync([worker("team.0a1b2c3d4e.ada", "Galahad · Ada"), partner("claude-code")]);
    run(view.figures, 1 / 30, false);
    const out: [number, number, number] = [0, 0, 0];
    const figure = (who: string) => view.figures.squires.find((q) => (q.id ?? q.name) === who)!;
    const under = (who: string) => view.hover(figure(who).x, figure(who).y, out);
    expect(under("team.0a1b2c3d4e.ada")).toBe("Galahad · Ada: one of his workers");
    expect(under("claude-code")).toBe("claude-code: an agent working with Galahad");
    expect(figureInWords(figure("team.0a1b2c3d4e.ada"))).toBe("his worker Galahad · Ada");
    expect(figureInWords(figure("claude-code"))).toBe("the agent claude-code");
  });
});

describe("the tiny knight renderer", () => {
  const mesh = (group: Group, name: string) => group.children.find((child) => child.name === name) as InstancedMesh;
  const matrices = (group: Group) => group.children.map((child) => {
    const m = child as InstancedMesh;
    return Array.from(m.instanceMatrix.array.slice(0, m.count * 16));
  });

  /** One knight of each form, standing at the origin and facing +z, so a helm's own space is the scene's but for its height. */
  const HELM = 0.45;
  const FORMS = ["round", "armored", "hooded"] as const;
  const standing = (view: Partners, avatar: AvatarProfile, expression: WorldPartner["expression"] = "idle") => {
    view.figures.sync([{ ...worker("team:a", "Moss", avatar), expression }]);
    run(view.figures, 1 / 30, false);
    Object.assign(view.figures.squires.find((s) => s.id === "team:a")!, { x: 0, y: 0, heading: -Math.PI / 2 });
    view.pose(() => 0, [0, 0], 1);
  };
  const paint = (helm: InstancedMesh, name: "armor" | "face" | "accent", n = 0) => new Color().fromArray(helm.geometry.getAttribute(name).array as Float32Array, n * 3);
  const light = (color: Color) => color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
  const ARMOR = 0, FACE = 1, TABARD = 2;
  /** The helm's mesh as something a ray can be cast at, and which part the triangle it hits belongs to. */
  const probe = (helm: InstancedMesh) => {
    const solid = new Mesh(helm.geometry, new MeshBasicMaterial({ side: DoubleSide }));
    const part = helm.geometry.getAttribute("part");
    const ray = new Raycaster();
    return (from: Vector3, towards: Vector3) => {
      ray.set(from, towards);
      return ray.intersectObject(solid).map((hit) => ({ distance: hit.distance, part: part.getX(hit.face!.a), normal: hit.face!.normal }));
    };
  };

  test("the face and the tabard are the helm's own surface, set into it: nothing stands off it as a plate", () => {
    const group = new Group();
    const view = new Partners(group, false);
    for (const form of FORMS) {
      standing(view, { ...defaultAvatar("a"), form, accessory: "none" });
      const helm = mesh(group, `knight-${form}`);
      const position = helm.geometry.getAttribute("position"), normal = helm.geometry.getAttribute("normal"), part = helm.geometry.getAttribute("part"), shade = helm.geometry.getAttribute("shade");
      const cast = probe(helm);
      const at = new Vector3(), out = new Vector3(), inward = new Vector3();
      const seen = new Set<number>();
      let proud = 0;
      for (let i = 0; i < position.count; i++) {
        seen.add(part.getX(i));
        expect(shade.getX(i)).toBeGreaterThan(0.5);
        expect(shade.getX(i)).toBeLessThanOrEqual(1);
        if (part.getX(i) === ARMOR) continue;
        at.fromBufferAttribute(position, i);
        out.fromBufferAttribute(normal, i);
        expect(at.z).toBeGreaterThan(0);
        // Straight in from a patch's vertex, the helm itself is within a few millimetres (what the patch stands off
        // it, and what the helm's flat triangles fall short of its curve), and faces the same way.
        const beneath = cast(at.clone().addScaledVector(out, -1e-5), inward.copy(out).negate()).find((hit) => hit.part === ARMOR);
        expect(beneath).toBeDefined();
        expect(beneath!.distance).toBeLessThan(0.008);
        expect(beneath!.normal.dot(out)).toBeGreaterThan(0.97);
        proud = Math.max(proud, beneath!.distance);
      }
      expect([...seen].sort()).toEqual([ARMOR, FACE, TABARD]);
      expect(proud).toBeGreaterThan(0.001);
    }
    view.dispose();
  });

  test("its eyes are set on the face, and even dark custom armor keeps a light face behind them", () => {
    const group = new Group();
    const view = new Partners(group, false);
    for (const form of FORMS) {
      for (const eyes of ["oval", "round", "visor"] as const) {
        standing(view, { ...defaultAvatar("dark"), form, eyes, color: "#080808", accessory: "none" });
        const helm = mesh(group, `knight-${form}`);
        const details = mesh(group, "knight-details");
        const cast = probe(helm);
        const matrix = new Matrix4(), scale = new Vector3(), at = new Vector3(), color = new Color();
        let found = 0;
        for (let n = 0; n < details.count; n++) {
          details.getMatrixAt(n, matrix);
          details.getColorAt(n, color);
          scale.setFromMatrixScale(matrix);
          if (color.getHexString() !== "15171b" || scale.x < 0.025 || scale.y < 0.015) continue;
          found++;
          // Looking straight at the eye from in front, the first of the helm behind it is its face, close behind.
          at.setFromMatrixPosition(matrix);
          const behind = cast(new Vector3(at.x, at.y - HELM, 1), new Vector3(0, 0, -1))[0]!;
          expect(behind.part).toBe(FACE);
          expect(Math.abs(1 - behind.distance - at.z)).toBeLessThan(0.012);
          expect((light(paint(helm, "face")) + 0.05) / (light(color) + 0.05)).toBeGreaterThan(4.5);
        }
        expect(found).toBe(2);
      }
    }
    view.dispose();
  });

  test("legacy helpers allocate only their existing three meshes; custom shared geometry has sound normals and winding", () => {
    const group = new Group();
    const view = new Partners(group, false);
    view.figures.sync([partner("opencode")]);
    run(view.figures, 1 / 30, false);
    view.pose(() => 0, [0, 0], 0);
    expect(group.children).toHaveLength(3);
    // Allocation after a floating-origin shift must inherit it immediately.
    const origin = new Vector3(10, 0, -20);
    view.place(origin);
    view.figures.sync([worker("team:a")]);
    run(view.figures, 1 / 30, false);
    view.pose(() => 0, [0, 0], 0);
    for (const child of group.children.filter((child) => child.name.startsWith("knight-"))) {
      expect(child.position.equals(origin)).toBe(true);
      const a = auditGeometry((child as InstancedMesh).geometry);
      expect({ nonFinite: a.nonFinite, degenerate: a.degenerate, insideOut: a.insideOut, inwardNormals: a.inwardNormals, unnormalised: a.unnormalised }).toEqual({ nonFinite: 0, degenerate: 0, insideOut: 0, inwardNormals: 0, unnormalised: 0 });
    }
    view.dispose();
  });

  test("shares bounded geometry while rendering the three forms, individual colors and legacy squires together", () => {
    const group = new Group();
    const view = new Partners(group, false);
    const profiles = FORMS.map((form, i) => ({ ...defaultAvatar(String(i)), form, color: ["#cc8899", "#88aacc", "#aacc88"][i]!, accent: ["#884466", "#446688", "#668844"][i]!, accessory: "none" as const }));
    const partners = profiles.map((p, i) => worker(`team:${i}`, `Knight ${i}`, p));
    view.figures.sync([...partners, partner("claude-code")]);
    run(view.figures, 1 / 30, false);
    view.pose(() => 0, [0, 0], 0);
    // Three squire meshes, a helm a form, and the details: however many knights there are.
    expect(group.children.map((child) => child.name).sort()).toEqual(["knight-armored", "knight-details", "knight-hooded", "knight-round", "squire-arms", "squire-body", "squire-legs"]);
    for (const p of profiles) {
      const m = mesh(group, `knight-${p.form}`);
      expect(m.count).toBe(1);
      // Each wears its own colors, deepened for the world's light with the hue held: the same channels lead and trail.
      for (const [name, hex] of [["armor", p.color], ["accent", p.accent]] as const) {
        const given = new Color(hex), worn = paint(m, name);
        const order = (c: Color) => [c.r, c.g, c.b].map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]).map(([, i]) => i);
        expect(order(worn)).toEqual(order(given));
        expect(light(worn)).toBeLessThan(light(given));
        expect(light(worn)).toBeGreaterThan(light(given) * 0.4);
        for (const v of [worn.r, worn.g, worn.b]) expect(v >= 0 && v <= 1).toBe(true);
      }
      expect(light(paint(m, "face"))).toBeGreaterThan(light(paint(m, "armor")));
    }
    expect(mesh(group, "squire-body").count).toBe(1);
    // A helm with its face and tabard is one mesh of a bounded size; a detail is small.
    for (const form of FORMS) expect(mesh(group, `knight-${form}`).geometry.index!.count / 3).toBeLessThanOrEqual(1300);
    expect(mesh(group, "knight-details").geometry.index!.count / 3).toBeLessThanOrEqual(150);
    const geometry = group.children.map((m) => (m as InstancedMesh).geometry);
    for (let n = 0; n < 25; n++) {
      view.figures.sync(partners.map((p) => ({ ...p, name: `Renamed ${n}`, avatar: { ...p.avatar!, accessory: "crown" } })));
      run(view.figures, 1 / 30, false);
      view.pose(() => 0, [0, 0], n);
      for (const child of group.children) {
        const m = child as InstancedMesh;
        expect(m.count).toBeLessThanOrEqual(m.instanceMatrix.count);
      }
    }
    expect(group.children.map((m) => (m as InstancedMesh).geometry)).toEqual(geometry);
    view.dispose();
    expect(group.children).toHaveLength(0);
  });

  test("the three forms are three silhouettes: an egg, a squarer helm, a hood with a peak", () => {
    const group = new Group();
    const view = new Partners(group, false);
    const bounds = Object.fromEntries(FORMS.map((form) => {
      standing(view, { ...defaultAvatar("a"), form, accessory: "none" });
      const g = mesh(group, `knight-${form}`).geometry;
      g.computeBoundingBox();
      const position = g.getAttribute("position"), at = new Vector3();
      // How wide the helm still is high up (two thirds of the way to a round helm's top), as seen from the front.
      let shoulder = 0;
      for (let i = 0; i < position.count; i++) {
        at.fromBufferAttribute(position, i);
        if (Math.abs(at.z) < 0.03 && at.y > 0.2 && at.y < 0.26) shoulder = Math.max(shoulder, Math.abs(at.x));
      }
      return [form, { top: g.boundingBox!.max.y, foot: g.boundingBox!.min.y, wide: g.boundingBox!.max.x, shoulder }];
    }));
    expect(bounds.hooded!.top).toBeGreaterThan(bounds.round!.top + 0.06);
    expect(bounds.armored!.shoulder).toBeGreaterThan(bounds.round!.shoulder + 0.02);
    expect(bounds.armored!.shoulder).toBeGreaterThan(bounds.hooded!.shoulder + 0.02);
    for (const form of FORMS) {
      expect(bounds[form]!.foot).toBeCloseTo(-0.33, 2);
      expect(bounds[form]!.wide).toBeGreaterThan(0.3);
      expect(bounds[form]!.wide).toBeLessThan(0.38);
    }
    view.dispose();
  });

  test("expressions remain readable without animation when reduced motion is enabled", () => {
    const group = new Group();
    const view = new Partners(group, false);
    const p = worker("team:a", "Moss", { ...defaultAvatar("a"), form: "round", eyes: "oval", accessory: "none" });
    view.figures.sync([p]);
    run(view.figures, 1 / 30, false);
    view.pose(() => 0, [0, 0], 0);
    const idle = matrices(group);
    view.pose(() => 0, [0, 0], 123);
    expect(matrices(group)).toEqual(idle);
    for (const expression of ["thinking", "working", "waiting", "pleased", "concerned", "resting"] as const) {
      view.figures.sync([{ ...p, expression }]);
      view.pose(() => 0, [0, 0], 0);
      const face = matrices(group);
      expect(face).not.toEqual(idle);
      view.pose(() => 0, [0, 0], 987);
      expect(matrices(group)).toEqual(face);
    }
    view.dispose();
  });

  test("blink timing is independent of stride and leaves pleased or sleeping eye shapes alone", () => {
    const group = new Group();
    const view = new Partners(group, false);
    const p = worker("team:a", "Moss", { ...defaultAvatar("a"), form: "round", eyes: "oval", accessory: "none" });
    view.figures.sync([p]);
    const s = view.figures.squires[0]!;
    Object.assign(s, { shown: 1, motion: true, walk: 0 });
    const start = 5.9 * 3 - s.avatarPhase! * 2;
    view.pose(() => 0, [0, 0], start + 1);
    const before = matrices(group);
    s.phase += 2;
    view.pose(() => 0, [0, 0], start + 1);
    expect(matrices(group)).toEqual(before);
    const openness = (time: number) => {
      view.pose(() => 0, [0, 0], time);
      const m = mesh(group, "knight-details"), matrix = new Matrix4(), scale = new Vector3(), color = new Color();
      for (let n = 0; n < m.count; n++) {
        m.getMatrixAt(n, matrix); scale.setFromMatrixScale(matrix); m.getColorAt(n, color);
        if (color.getHexString() === "15171b" && scale.x > 0.02) return scale.y / scale.x;
      }
      throw new Error("missing eye");
    };
    expect(openness(start + 0.14)).toBeLessThan(openness(start + 1) * 0.2);
    for (const expression of ["pleased", "resting"] as const) {
      view.figures.sync([{ ...p, expression }]);
      expect(Math.abs(openness(start + 0.14) - openness(start + 1))).toBeLessThan(0.02);
    }
    view.dispose();
  });

  test("six fully decorated knights remain within the original instance budget across states and motion", () => {
    const group = new Group();
    const view = new Partners(group, false);
    for (const expression of ["idle", "thinking", "working", "waiting", "pleased", "concerned", "resting"] as const) {
      view.figures.sync(Array.from({ length: MAX }, (_, i) => worker(`team:${i}`, `Knight ${i}`, { ...defaultAvatar(String(i)), accessory: "crown" })).map((p) => ({ ...p, expression })));
      run(view.figures, 1 / 30, false);
      for (const s of view.figures.squires) s.motion = true;
      for (const time of [0, 0.14, 1, 4.5, 20]) {
        view.pose(() => 0, [0, 0], time);
        expect(group.children).toHaveLength(7);
        const details = mesh(group, "knight-details");
        expect(details.instanceMatrix.count).toBe(MAX * 14);
        expect(details.count).toBeLessThanOrEqual(MAX * 14);
        for (const child of group.children) {
          const m = child as InstancedMesh;
          expect(m.count).toBeLessThanOrEqual(m.instanceMatrix.count);
          expect(Array.from(m.instanceMatrix.array.slice(0, m.count * 16)).every(Number.isFinite)).toBe(true);
        }
      }
    }
    view.dispose();
  });

  test("accessories stay within the existing collision height and every mesh follows the floating origin", () => {
    const group = new Group();
    const view = new Partners(group, false);
    for (const accessory of ["none", "plume", "ears", "crown"] as const) {
      view.figures.sync([worker("team:a", "Moss", { ...defaultAvatar("a"), accessory })]);
      run(view.figures, 1 / 30, false);
      view.pose(() => 0, [0, 0], 0);
      for (const child of group.children) {
        const m = child as InstancedMesh;
        m.geometry.computeBoundingBox();
        for (let n = 0; n < m.count; n++) {
          const matrix = new Matrix4();
          m.getMatrixAt(n, matrix);
          const bounds = m.geometry.boundingBox!.clone().applyMatrix4(matrix);
          expect(bounds.min.y).toBeGreaterThanOrEqual(-0.01);
          expect(bounds.max.y).toBeLessThanOrEqual(SQUIRE.height);
        }
      }
    }
    const origin = new Vector3(10, 0, -20);
    view.place(origin);
    for (const child of group.children) expect(child.position.equals(origin)).toBe(true);
    view.dispose();
  });
});
