import { describe, expect, test } from "bun:test";
import { parseUrdf } from "./urdf.ts";
import { evaluate, expandXacro } from "./xacro.ts";

describe("xacro", () => {
  test("arithmetic in ${…} is read, not run: numbers, names, + − × ÷ and brackets only", () => {
    expect(evaluate("dir*0.153", { dir: "-1" })).toBeCloseTo(-0.153, 12);
    expect(evaluate("-dir*1.57", { dir: "1" })).toBeCloseTo(-1.57, 12);
    expect(evaluate("dir*-0.060920", { dir: "1" })).toBeCloseTo(-0.06092, 12);
    expect(evaluate("(a + 2) / 4", { a: "6" })).toBe(2);
    for (const bad of ["process.exit()", "a;b", "1 +", "[1]", "a.b"]) expect(() => evaluate(bad, { a: "1", b: "2" })).toThrow();
  });

  test("macros expand with their parameters, properties and $(find) resolve, and the result is a URDF", () => {
    const urdf = parseUrdf(
      expandXacro(
        `<?xml version="1.0"?>
<robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="r">
  <xacro:include filename="$(find p)/urdf/other.xacro"/>
  <xacro:property name="half" value="0.25"/>
  <link name="base"/>
  <xacro:macro name="leg" params="side dir">
    <link name="leg_\${side}"><visual><geometry><mesh filename="file://$(find p)/meshes/leg.stl"/></geometry></visual></link>
    <joint name="hip_\${side}" type="revolute">
      <parent link="base"/><child link="leg_\${side}"/>
      <origin xyz="0 \${dir*half} 0" rpy="0 0 0"/><axis xyz="0 1 0"/><limit lower="-1" upper="1"/>
    </joint>
  </xacro:macro>
  <xacro:leg side="L" dir="1"/>
  <xacro:leg side="R" dir="-1"/>
</robot>`,
        (name) => (name === "p" ? ".." : "?"),
      ),
    );
    expect(urdf.links.map((l) => l.name)).toEqual(["base", "leg_L", "leg_R"]);
    expect(urdf.joints.map((j) => [j.name, j.origin.xyz[1]])).toEqual([["hip_L", 0.25], ["hip_R", -0.25]]);
    expect(urdf.links[1]!.visuals[0]!.mesh).toBe("file://../meshes/leg.stl");
  });
});
