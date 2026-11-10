import { describe, expect, test } from "bun:test";
import { Skeleton } from "../../apps/web/src/world/robots/kinematics.ts";
import { meshPath, plan } from "./build.ts";
import { area, parseStl, simplify, toSoup, weld } from "./mesh.ts";
import { parseUrdf, parseXml } from "./urdf.ts";

// A small robot: a base, a turning shoulder, an arm on a fixed bracket, and a gripper frame. Not a real one.
const URDF = `<?xml version="1.0"?>
<!-- a comment with <angle brackets> and a "quote" -->
<robot name="tiny">
  <material name="printed"><color rgba="1 0.82 0.12 1"/></material>
  <link name="base">
    <visual>
      <origin xyz="0 0 0.01" rpy="0 0 1.5708"/>
      <geometry><mesh filename="package://assets/base.stl" scale="0.001 0.001 0.001"/></geometry>
      <material name="printed"/>
    </visual>
    <collision><geometry><box size="1 1 1"/></geometry></collision>
  </link>
  <link name="shoulder">
    <visual>
      <geometry><mesh filename="assets/motor.stl"/></geometry>
      <material name="motor"><color rgba="0.1 0.1 0.1 1"/></material>
    </visual>
  </link>
  <link name="bracket">
    <visual><geometry><mesh filename="assets/bracket.stl"/></geometry></visual>
  </link>
  <link name="tip"/>
  <joint name="pan" type="revolute">
    <origin xyz="0 0 0.05" rpy="0 0 0"/>
    <parent link="base"/>
    <child link="shoulder"/>
    <axis xyz="0 0 1"/>
    <limit effort="1" velocity="1" lower="-1.5" upper="1.5"/>
  </joint>
  <joint name="mount" type="fixed">
    <origin xyz="0.1 0 0" rpy="0 1.5708 0"/>
    <parent link="shoulder"/>
    <child link="bracket"/>
  </joint>
  <joint name="tip_frame" type="fixed">
    <origin xyz="0 0 0.2" rpy="0 0 0"/>
    <parent link="bracket"/>
    <child link="tip"/>
  </joint>
  <ros2_control name="hw" type="system">
    <joint name="pan"><command_interface name="position"/></joint>
  </ros2_control>
</robot>`;

describe("reading URDF", () => {
  test("links, their visuals (origin, mesh, scale, colour inline or by name), and joints", () => {
    const urdf = parseUrdf(URDF);
    expect(urdf.name).toBe("tiny");
    expect(urdf.links.map((l) => l.name)).toEqual(["base", "shoulder", "bracket", "tip"]);
    const base = urdf.links[0]!.visuals[0]!;
    expect(base.origin).toEqual({ xyz: [0, 0, 0.01], rpy: [0, 0, 1.5708] });
    expect(base.mesh).toBe("package://assets/base.stl");
    expect(base.scale).toEqual([0.001, 0.001, 0.001]);
    expect(base.rgba).toEqual([1, 0.82, 0.12, 1]);
    expect(urdf.links[1]!.visuals[0]!.rgba).toEqual([0.1, 0.1, 0.1, 1]);
    expect(urdf.links[2]!.visuals[0]!.rgba).toBeNull();
    // Only the joints directly under <robot>: the controller block's <joint> isn't one.
    expect(urdf.joints.map((j) => j.name)).toEqual(["pan", "mount", "tip_frame"]);
    const pan = urdf.joints[0]!;
    expect(pan).toMatchObject({ type: "revolute", parent: "base", child: "shoulder", axis: [0, 0, 1], lower: -1.5, upper: 1.5 });
    expect(pan.origin.xyz).toEqual([0, 0, 0.05]);
    expect(urdf.joints[1]!.origin.rpy).toEqual([0, 1.5708, 0]);
  });

  test("malformed documents are refused", () => {
    expect(() => parseXml("<robot><link></robot>")).toThrow("mismatched");
    expect(() => parseXml("<robot>")).toThrow("unclosed");
    expect(() => parseUrdf("<notarobot/>")).toThrow("no <robot>");
    expect(() => parseUrdf('<robot><joint name="j" type="floating"><parent link="a"/><child link="b"/></joint></robot>')).toThrow("aren't supported");
    expect(() => parseUrdf('<robot><link name="a"><visual><origin xyz="0 0"/></visual></link></robot>')).toThrow("expected 3 numbers");
  });

  test("its kinematic tree poses links as the URDF says", () => {
    const urdf = parseUrdf(URDF);
    const p = plan(urdf, { sites: ["tip"] });
    // The bracket (and the tip frame) hang on fixed joints: they merge into the shoulder.
    expect([...p.groups.keys()]).toEqual(["base", "shoulder"]);
    expect(p.groups.get("shoulder")!.members).toEqual(["shoulder", "bracket", "tip"]);
    expect(p.joints.map((j) => j.name)).toEqual(["pan"]);
    // The tip: 0.1 out along x, then 0.2 along the bracket's z, which the mount pitched onto +x.
    expect(p.sites[0]!.link).toBe("shoulder");
    p.sites[0]!.xyz.forEach((v, i) => expect(v).toBeCloseTo([0.3, 0, 0][i]!, 4));
    const sk = new Skeleton({ links: [...p.groups.keys()], joints: p.joints });
    sk.set(0, 1);
    sk.fk();
    const tip = sk.point(sk.linkIndex("shoulder"), p.sites[0]!.xyz, [0, 0, 0]);
    [0.3 * Math.cos(1), 0.3 * Math.sin(1), 0.05].forEach((v, i) => expect(tip[i]).toBeCloseTo(v, 4));
    // Beyond its limit (±1.5), the pan stops at it.
    expect(sk.set(0, Math.PI / 2)).toBe(1.5);
  });

  test("mesh filenames resolve against the URDF's folder, never outside the repository", () => {
    expect(meshPath("robots/duck/robot.urdf", "package:///head.stl")).toBe("robots/duck/head.stl");
    expect(meshPath("a/b/robot.urdf", "package://assets/x.stl")).toBe("a/b/assets/x.stl");
    expect(meshPath("Simulation/SO101/arm.urdf", "assets/base.stl")).toBe("Simulation/SO101/assets/base.stl");
    expect(() => meshPath("robot.urdf", "../../etc/x.stl")).toThrow("outside");
  });
});

/** A closed box as a binary STL (12 triangles, the facet normals left zero). */
function boxStl(sx: number, sy: number, sz: number): Uint8Array {
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [(i & 1 ? 1 : -1) * sx, (i & 2 ? 1 : -1) * sy, (i & 4 ? 1 : -1) * sz]);
  const faces = [[0, 2, 1], [1, 2, 3], [4, 5, 6], [5, 7, 6], [0, 1, 4], [1, 5, 4], [2, 6, 3], [3, 6, 7], [0, 4, 2], [2, 4, 6], [1, 3, 5], [3, 7, 5]];
  const bytes = new Uint8Array(84 + faces.length * 50);
  const view = new DataView(bytes.buffer);
  view.setUint32(80, faces.length, true);
  faces.forEach((f, t) => f.forEach((c, k) => corners[c]!.forEach((v, a) => view.setFloat32(84 + t * 50 + 12 + k * 12 + a * 4, v, true))));
  return bytes;
}

describe("meshes", () => {
  test("binary and ASCII STL both read; welding joins the corners triangles share", () => {
    const soup = parseStl(boxStl(1, 2, 3));
    expect(soup.length).toBe(12 * 9);
    expect(area(soup)).toBeCloseTo(2 * (2 * 4 + 2 * 6 + 4 * 6), 4);
    const mesh = weld(soup);
    expect(mesh.positions.length / 3).toBe(8);
    expect(mesh.indices.length).toBe(36);
    const ascii = new TextEncoder().encode("solid t\n facet normal 0 0 1\n  outer loop\n   vertex 0 0 0\n   vertex 1 0 0\n   vertex 0 1 0\n  endloop\n endfacet\nendsolid t\n");
    expect(Array.from(parseStl(ascii))).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(() => parseStl(new TextEncoder().encode("not a mesh"))).toThrow("not an STL");
  });

  test("simplifying a dense part keeps its shape within the error, with far fewer triangles", () => {
    // A finely tessellated sphere of radius 5 cm.
    const tris: number[] = [];
    const n = 48;
    const point = (i: number, j: number): number[] => {
      const th = (i / n) * Math.PI;
      const ph = (j / n) * 2 * Math.PI;
      return [0.05 * Math.sin(th) * Math.cos(ph), 0.05 * Math.sin(th) * Math.sin(ph), 0.05 * Math.cos(th)];
    };
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) tris.push(...point(i, j), ...point(i + 1, j), ...point(i + 1, j + 1), ...point(i, j), ...point(i + 1, j + 1), ...point(i, j + 1));
    }
    const dense = weld(Float32Array.from(tris));
    const low = simplify(dense, 0.002);
    expect(low.indices.length).toBeLessThan(dense.indices.length / 5);
    expect(low.indices.length).toBeGreaterThan(30);
    // Every vertex still on the sphere, near enough; the surface hardly smaller.
    for (let v = 0; v < low.positions.length / 3; v++) {
      expect(Math.abs(Math.hypot(low.positions[v * 3]!, low.positions[v * 3 + 1]!, low.positions[v * 3 + 2]!) - 0.05)).toBeLessThan(1e-4);
    }
    expect(area(toSoup(low)) / area(toSoup(dense))).toBeGreaterThan(0.9);
  });
});
