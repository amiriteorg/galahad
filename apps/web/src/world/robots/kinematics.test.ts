import { describe, expect, test } from "bun:test";
import { aimDirection, ccd, twoBone } from "./ik.ts";
import { fromXyzRpy, invertRigid, type JointSpec, type KinematicTree, mat4, multiply, rotation, rpyOf, Skeleton, transformPoint, type Vec3 } from "./kinematics.ts";

const joint = (name: string, parent: string, child: string, xyz: Vec3, axis: Vec3, type: JointSpec["type"] = "revolute", lower = -Math.PI, upper = Math.PI): JointSpec => ({
  name,
  type,
  parent,
  child,
  xyz,
  rpy: [0, 0, 0],
  axis,
  lower,
  upper,
});

const close = (a: readonly number[], b: readonly number[], digits = 9): void => {
  expect(a.length).toBe(b.length);
  a.forEach((x, i) => expect(x).toBeCloseTo(b[i]!, digits));
};

describe("rigid transforms", () => {
  test("a URDF origin turns roll about x, then pitch about y, then yaw about z (fixed axes), and rpyOf undoes it", () => {
    // Roll a quarter turn: y goes to z.
    const roll = fromXyzRpy([0, 0, 0], [Math.PI / 2, 0, 0]);
    close(transformPoint(roll, 0, 1, 0, [0, 0, 0]), [0, 0, 1]);
    // Yaw a quarter turn after rolling: x goes to y; the rolled y (now z) stays z.
    const both = fromXyzRpy([1, 2, 3], [Math.PI / 2, 0, Math.PI / 2]);
    close(transformPoint(both, 1, 0, 0, [0, 0, 0]), [1, 3, 3]);
    close(transformPoint(both, 0, 1, 0, [0, 0, 0]), [1, 2, 4]);
    for (const rpy of [[0.1, 0.2, 0.3], [-2.5, 1.2, 3], [0.4, -1.5, -0.7], [3.1, 0.01, -3.1]] as Vec3[]) {
      const m = fromXyzRpy([0, 0, 0], rpy);
      const again = fromXyzRpy([0, 0, 0], rpyOf(m));
      close(Array.from(again), Array.from(m), 9);
    }
    // Straight up or down (gimbal lock) still round-trips the rotation.
    const lock = fromXyzRpy([0, 0, 0], [0.3, Math.PI / 2, 0.2]);
    close(Array.from(fromXyzRpy([0, 0, 0], rpyOf(lock))), Array.from(lock), 9);
  });

  test("inverting a rigid transform and composing it gives the identity", () => {
    const m = fromXyzRpy([0.3, -1, 2], [0.4, -0.2, 1.1]);
    close(Array.from(multiply(m, invertRigid(m), mat4())), Array.from(mat4()), 12);
    // A quarter turn about the diagonal permutes the axes.
    const r = rotation(1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3), (2 * Math.PI) / 3);
    close(transformPoint(r, 1, 0, 0, [0, 0, 0]), [0, 1, 0]);
  });
});

describe("a skeleton's forward kinematics", () => {
  // A turning base, an arm 0.3 m long on a pitching joint, a 0.2 m tool: easy to work out by hand.
  const tree: KinematicTree = {
    links: ["tool", "base", "upper", "fore"],
    joints: [joint("yaw", "base", "upper", [0, 0, 0.1], [0, 0, 1]), joint("pitch", "upper", "fore", [0.3, 0, 0], [0, 1, 0], "revolute", -1, 1), joint("tip", "fore", "tool", [0.2, 0, 0], [1, 0, 0], "fixed")],
  };

  test("links are ordered root first, each subtree in one run, whatever order the file lists them in", () => {
    const sk = new Skeleton(tree);
    expect(sk.links).toEqual(["base", "upper", "fore", "tool"]);
    expect(Array.from(sk.parent)).toEqual([-1, 0, 1, 2]);
    expect(Array.from(sk.subtreeEnd)).toEqual([4, 4, 4, 4]);
  });

  test("link poses match the ones worked out by hand", () => {
    const sk = new Skeleton(tree);
    const at = (link: string): Vec3 => sk.point(sk.linkIndex(link), [0, 0, 0], [0, 0, 0]);
    close(at("tool"), [0.5, 0, 0.1]);
    sk.set(sk.jointIndex("yaw"), Math.PI / 2);
    sk.fk();
    close(at("fore"), [0, 0.3, 0.1]);
    close(at("tool"), [0, 0.5, 0.1]);
    // Pitch −1 about y tips the tool up (x → x cos + z sin, z → −x sin + z cos).
    sk.set(sk.jointIndex("pitch"), -1);
    sk.fk();
    close(at("tool"), [0, 0.3 + 0.2 * Math.cos(1), 0.1 + 0.2 * Math.sin(1)]);
    // The base moved: everything moves with it.
    sk.base.set(fromXyzRpy([1, 2, 3], [0, 0, 0]));
    sk.fk();
    close(at("tool"), [1, 2.3 + 0.2 * Math.cos(1), 3.1 + 0.2 * Math.sin(1)]);
  });

  test("joint values keep to their limits; continuous joints have none; fixed joints don't move", () => {
    const sk = new Skeleton({
      links: ["a", "b", "c", "d"],
      joints: [joint("r", "a", "b", [0, 0, 0], [0, 0, 1], "revolute", -0.5, 0.25), joint("c", "b", "c", [0, 0, 0], [0, 0, 1], "continuous"), joint("p", "c", "d", [0, 0, 0], [1, 0, 0], "prismatic", 0, 0.1)],
    });
    expect(sk.set(0, 2)).toBe(0.25);
    expect(sk.set(0, -2)).toBe(-0.5);
    expect(sk.set(1, 7)).toBe(7);
    expect(sk.set(2, 0.5)).toBe(0.1);
    sk.set(0, 0);
    sk.fk();
    close(sk.point(sk.linkIndex("d"), [0, 0, 0], [0, 0, 0]), [0.1 * Math.cos(7), 0.1 * Math.sin(7), 0]);
  });

  test("a tree that doesn't hold together is refused", () => {
    expect(() => new Skeleton({ links: ["a", "b"], joints: [] })).toThrow("exactly one root");
    expect(() => new Skeleton({ links: ["a"], joints: [joint("j", "a", "ghost", [0, 0, 0], [0, 0, 1])] })).toThrow("no child link ghost");
    expect(() => new Skeleton({ links: ["a", "b", "c"], joints: [joint("j", "a", "c", [0, 0, 0], [0, 0, 1]), joint("k", "b", "c", [0, 0, 0], [0, 0, 1])] })).toThrow("two parents");
  });
});

describe("inverse kinematics", () => {
  // A leg: hip pitch, a 0.3 m thigh, a knee, a 0.25 m shin, both turning about y.
  const leg = (kneeLower = -3, kneeUpper = 3): Skeleton =>
    new Skeleton({
      links: ["body", "thigh", "shin", "foot"],
      joints: [joint("hip", "body", "thigh", [0, 0, 0], [0, 1, 0], "revolute", -2, 2), joint("knee", "thigh", "shin", [0, 0, -0.3], [0, 1, 0], "revolute", kneeLower, kneeUpper), joint("ankle", "shin", "foot", [0, 0, -0.25], [0, 1, 0], "fixed")],
    });

  test("two-bone IK puts the end on any reachable target, folding the way it's asked", () => {
    const sk = leg();
    const foot = { link: sk.linkIndex("foot"), point: [0, 0, 0] as Vec3 };
    const out: Vec3 = [0, 0, 0];
    for (const target of [[0.1, 0, -0.4], [-0.2, 0, -0.3], [0.3, 0, -0.35], [0.05, 0, -0.1], [0.5, 0, -0.1]] as Vec3[]) {
      for (const bend of [1, -1] as const) {
        expect(twoBone(sk, 0, 1, foot, target, bend)).toBeLessThan(1e-9);
        close(sk.point(foot.link, foot.point, out), target, 9);
        // Folded one way or the other: the knee's sign follows the fold (its axis is the hip's).
        expect(Math.sign(sk.q[1]!)).toBe(bend);
      }
    }
  });

  test("an unreachable target gets as close as the limits allow, and the limits hold", () => {
    const sk = leg(0, 1.2);
    const foot = { link: sk.linkIndex("foot"), point: [0, 0, 0] as Vec3 };
    // Right by the hip: the knee would have to fold about 2.6 rad.
    const error = twoBone(sk, 0, 1, foot, [0.05, 0, -0.05], -1);
    expect(error).toBeGreaterThan(0.05);
    expect(sk.q[1]!).toBeLessThanOrEqual(1.2);
    expect(sk.q[1]!).toBeGreaterThanOrEqual(0);
    expect(Math.abs(sk.q[0]!)).toBeLessThanOrEqual(2);
    // Too far: it reaches straight out towards it.
    expect(twoBone(sk, 0, 1, foot, [0, 0, -1], -1)).toBeCloseTo(0.45, 6);
  });

  test("CCD reaches targets in 3D with a general chain, within every joint's limits", () => {
    const sk = new Skeleton({
      links: ["base", "a", "b", "c", "d"],
      joints: [joint("j0", "base", "a", [0, 0, 0.1], [0, 0, 1], "revolute", -2, 2), joint("j1", "a", "b", [0, 0, 0], [0, 1, 0], "revolute", -1.5, 1.5), joint("j2", "b", "c", [0.2, 0, 0], [0, 1, 0], "revolute", -2, 2), joint("j3", "c", "d", [0.2, 0, 0], [0, 1, 0], "revolute", -2, 2)],
    });
    const tip = { link: sk.linkIndex("d"), point: [0.1, 0, 0] as Vec3 };
    for (const target of [[0.3, 0.2, 0.2], [0.1, -0.3, 0.05], [0.2, 0.25, 0.3], [0.4, 0, 0.1], [0.15, 0.1, 0.45]] as Vec3[]) {
      // From the chain at rest (CCD is a local method: a start folded the wrong way can stall it).
      sk.q.fill(0);
      sk.fk();
      expect(ccd(sk, [0, 1, 2, 3], tip, target, 60, 1e-5)).toBeLessThan(1e-4);
      sk.joints.forEach((j, i) => {
        expect(sk.q[i]!).toBeGreaterThanOrEqual(j.lower);
        expect(sk.q[i]!).toBeLessThanOrEqual(j.upper);
      });
    }
  });

  test("a joint turns a direction on its link to line up with another, as far as its axis allows", () => {
    const sk = leg();
    sk.set(0, 0.4);
    sk.fk();
    // Keep the shin's own x (the foot's sole, say) level: the knee turns to cancel the hip.
    aimDirection(sk, 1, sk.linkIndex("shin"), [1, 0, 0], [1, 0, 0]);
    const w = sk.world;
    const o = sk.linkIndex("shin") * 16;
    close([w[o]!, w[o + 1]!, w[o + 2]!], [1, 0, 0], 9);
  });
});
