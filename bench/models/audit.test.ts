import { describe, expect, test } from "bun:test";
import { type Attribute, auditGeometry, auditObject, emptyAudit, type Geometry } from "./audit.ts";
import { BUILDERS, ofTier } from "./builders.ts";

/*
 * The mesh audit, held to meshes whose faults are known: a sound cube, the same
 * cube inside out, with its normals turned in, with a face of no area, a face
 * drawn twice. And the knight himself, as his own code builds him.
 */

const attribute = (values: number[], itemSize: number): Attribute => ({ array: Float32Array.from(values), itemSize, count: values.length / itemSize });

/** A geometry of bare triangles (three corners each, nine numbers), with whatever else is given. */
function mesh(triangles: number[][], extra: Record<string, Attribute> = {}): Geometry {
  const attributes: Record<string, Attribute> = { position: attribute(triangles.flat(), 3), ...extra };
  return { index: null, getAttribute: (name) => attributes[name] };
}

/** A unit cube from the origin, twelve triangles wound counter-clockwise seen from outside. */
function cube(): number[][] {
  const quad = (a: number[], b: number[], c: number[], d: number[]): number[][] => [[...a, ...b, ...c], [...a, ...c, ...d]];
  const p = (x: number, y: number, z: number): number[] => [x, y, z];
  return [
    ...quad(p(0, 0, 1), p(1, 0, 1), p(1, 1, 1), p(0, 1, 1)), // front (+z)
    ...quad(p(1, 0, 0), p(0, 0, 0), p(0, 1, 0), p(1, 1, 0)), // back
    ...quad(p(1, 0, 1), p(1, 0, 0), p(1, 1, 0), p(1, 1, 1)), // right (+x)
    ...quad(p(0, 0, 0), p(0, 0, 1), p(0, 1, 1), p(0, 1, 0)), // left
    ...quad(p(0, 1, 1), p(1, 1, 1), p(1, 1, 0), p(0, 1, 0)), // top (+y)
    ...quad(p(0, 0, 0), p(1, 0, 0), p(1, 0, 1), p(0, 0, 1)), // bottom
  ];
}
/** Each triangle's own normal, at each of its corners. */
function flat(triangles: number[][], sign = 1): Attribute {
  const out: number[] = [];
  for (const t of triangles) {
    const u = [t[3]! - t[0]!, t[4]! - t[1]!, t[5]! - t[2]!];
    const v = [t[6]! - t[0]!, t[7]! - t[1]!, t[8]! - t[2]!];
    const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    const length = Math.hypot(...n) || 1;
    for (let k = 0; k < 3; k++) out.push((sign * n[0]!) / length, (sign * n[1]!) / length, (sign * n[2]!) / length);
  }
  return attribute(out, 3);
}
const turned = (triangles: number[][]): number[][] => triangles.map((t) => [...t.slice(0, 3), ...t.slice(6, 9), ...t.slice(3, 6)]);

describe("the mesh audit", () => {
  test("a sound cube: one closed part, the right way out, nothing wrong; its bounds as it's placed", () => {
    const a = auditGeometry(mesh(cube(), { normal: flat(cube()) }), emptyAudit(), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 2, -3, 1]);
    expect(a).toMatchObject({ meshes: 1, vertices: 36, triangles: 12, nonFinite: 0, degenerate: 0, closedParts: 1, insideOut: 0, inwardNormals: 0, unnormalised: 0, clashing: 0, redundant: 0, twoSided: 0 });
    expect(a.min).toEqual([10, 2, -3]);
    expect(a.max).toEqual([11, 3, -2]);
    // The same mesh, the same digest; another, another.
    expect(auditGeometry(mesh(cube())).digest).toBe(auditGeometry(mesh(cube())).digest);
    expect(auditGeometry(mesh(cube().map((t) => t.map((x) => x * 2)))).digest).not.toBe(auditGeometry(mesh(cube())).digest);
  });

  test("the same cube wound inside out is caught; and one whose winding is right but whose normals point in", () => {
    expect(auditGeometry(mesh(turned(cube())))).toMatchObject({ closedParts: 1, insideOut: 1 });
    expect(auditGeometry(mesh(cube(), { normal: flat(cube(), -1) }))).toMatchObject({ closedParts: 1, insideOut: 0, inwardNormals: 12 });
    // A sheet has no inside: an open part isn't held to either.
    const sheet = cube().slice(0, 2);
    expect(auditGeometry(mesh(sheet, { normal: flat(sheet, -1) }))).toMatchObject({ closedParts: 0, insideOut: 0, inwardNormals: 0 });
  });

  test("a triangle of no area, a number that isn't one, a normal that isn't a unit", () => {
    const line = [0, 0, 0, 1, 0, 0, 2, 0, 0];
    const point = [5, 5, 5, 5, 5, 5, 6, 5, 5];
    expect(auditGeometry(mesh([...cube(), line, point]))).toMatchObject({ degenerate: 2, closedParts: 1 });
    // A mesh of nothing but such triangles is a strip its shader opens out: no fault.
    expect(auditGeometry(mesh([line, point]))).toMatchObject({ degenerate: 0, expanded: 1 });
    expect(auditGeometry(mesh([[0, 0, 0, 1, 0, 0, 0, Number.NaN, 0]])).nonFinite).toBe(1);
    expect(auditGeometry(mesh(cube().slice(0, 1), { normal: attribute([0, 0, 1, 0, 0, 2, 0, 0, 0], 3) })).unnormalised).toBe(2);
    // What grows packs its shading into four numbers: not a normal to hold to anything.
    expect(auditGeometry(mesh(cube(), { normal: attribute(new Array(36 * 4).fill(0.5), 4) }))).toMatchObject({ unnormalised: 0, inwardNormals: 0 });
  });

  test("a face drawn twice: clashing in another colour, redundant in the same, two-sided the other way round", () => {
    const face = cube().slice(0, 1);
    const colours = (first: number[], second: number[]): Attribute => attribute([...first, ...first, ...first, ...second, ...second, ...second], 3);
    const twice = [...face, ...face];
    expect(auditGeometry(mesh(twice, { color: colours([1, 0, 0], [0, 0, 1]) }))).toMatchObject({ clashing: 1, redundant: 0, twoSided: 0 });
    expect(auditGeometry(mesh(twice, { color: colours([1, 0, 0], [0, 0, 1]) })).clashingAt).toHaveLength(1);
    expect(auditGeometry(mesh(twice, { color: colours([1, 0, 0], [1, 0, 0]) }))).toMatchObject({ clashing: 0, redundant: 1 });
    expect(auditGeometry(mesh([...face, ...turned(face)]))).toMatchObject({ clashing: 0, redundant: 0, twoSided: 1 });
    // The same corners starting from another one is still the same face.
    const rolled = [[...face[0]!.slice(3, 9), ...face[0]!.slice(0, 3)]];
    expect(auditGeometry(mesh([...face, ...rolled]))).toMatchObject({ redundant: 1 });
  });

  test("skin: weights that don't sum to one and bones that aren't there; two parts in one place on different bones aren't one", () => {
    const face = cube().slice(0, 1);
    const weights = attribute([1, 0, 0, 0, 0.5, 0.4, 0, 0, 0.7, 0.3, 0, 0], 4);
    const indices = attribute([0, 0, 0, 0, 1, 2, 0, 0, 9, 1, 0, 0], 4);
    expect(auditGeometry(mesh(face, { skinWeight: weights, skinIndex: indices }), emptyAudit(), undefined, 4)).toMatchObject({ skinned: 3, badWeights: 1, badBones: 1 });
    // Sixteen printers are modelled in one spot and carried apart by their bones: no clash while they're on different ones.
    const two = [...face, ...face];
    const on = (first: number, second: number): Record<string, Attribute> => ({
      color: attribute([1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3),
      skinWeight: attribute(new Array(6).fill([1, 0, 0, 0]).flat(), 4),
      skinIndex: attribute([first, first, first, second, second, second].flatMap((b) => [b, 0, 0, 0]), 4),
    });
    expect(auditGeometry(mesh(two, on(1, 2)), emptyAudit(), undefined, 4).clashing).toBe(0);
    expect(auditGeometry(mesh(two, on(1, 1)), emptyAudit(), undefined, 4).clashing).toBe(1);
  });

  test("the knight, as his own code builds him: about two and a half metres, his feet on the ground, sound, within his budget, the same every time", async () => {
    const builder = BUILDERS.find((b) => b.name === "knight")!;
    const built = await builder.build("high");
    const all = auditObject(built.root!);
    const body = auditObject(built.root!, emptyAudit(), "skinned");
    expect(body.max[1] - body.min[1]).toBeGreaterThan(2.1);
    expect(body.max[1] - body.min[1]).toBeLessThan(2.7);
    expect(Math.abs(body.min[1])).toBeLessThan(0.03);
    expect(all).toMatchObject({ nonFinite: 0, degenerate: 0, insideOut: 0, inwardNormals: 0, clashing: 0, badWeights: 0, badBones: 0 });
    expect(all.skinned).toBeGreaterThan(20_000);
    expect(all.triangles).toBeLessThanOrEqual(ofTier(builder.budget, "high"));
    expect(auditObject((await builder.build("high")).root!).digest).toBe(all.digest);
  });

  test("every builder has a name of its own and a budget", () => {
    expect(new Set(BUILDERS.map((b) => b.name)).size).toBe(BUILDERS.length);
    for (const b of BUILDERS) for (const tier of b.tiers ?? (["high"] as const)) expect(ofTier(b.budget, tier)).toBeGreaterThan(0);
  });
});
