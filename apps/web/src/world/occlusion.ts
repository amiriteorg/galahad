import { float, fract, mix, positionWorld, renderGroup, screenCoordinate, smoothstep, step, uniform } from "three/tsl";
import { Vector3 } from "three/webgpu";

/*
 * Nothing hides Galahad: whatever stands between the camera and him (a tree, the
 * keep's trunk, a building) dissolves around the line of sight in a fine dither
 * (screen-door transparency: no sorting, no blending, one comparison), and comes
 * back as soon as it's out of the way. The renderer sets the two ends each frame
 * (scene coordinates); materials that can stand in the way use the mask.
 */

/** (The same for every object: in the render's shared group, uploaded once a render rather than per draw.) */
export const occlusion = {
  /** The camera. */
  from: uniform(new Vector3()).setGroup(renderGroup),
  /** His chest. */
  to: uniform(new Vector3()).setGroup(renderGroup),
  /** His feet's height: the ground near him never dissolves. */
  floor: uniform(0).setGroup(renderGroup),
  /** 0 when not following him (nothing dissolves), 1 when following. */
  on: uniform(0).setGroup(renderGroup),
};

/** A material's maskNode: false (discarded) for the dithered part of whatever stands in the way. */
export function occlusionMask() {
  const p = positionWorld;
  const a = occlusion.from;
  const ab = occlusion.to.sub(a);
  const t = p.sub(a).dot(ab).div(ab.dot(ab).max(1e-4));
  const closest = a.add(ab.mul(t.clamp(0, 1)));
  const d = p.sub(closest).length();
  // A cone: narrow at the camera, about his width where he stands.
  const radius = mix(float(0.45), float(1.6), t.clamp(0, 1));
  const inside = smoothstep(radius, radius.mul(0.6), d)
    .mul(step(0.03, t))
    .mul(step(t, 0.93))
    .mul(step(occlusion.floor.add(0.3), p.y));
  // An interleaved-gradient threshold: an even, structured screen-door pattern rather than speckled noise.
  const p2 = screenCoordinate.xy.floor();
  const threshold = fract(fract(p2.x.mul(0.06711056).add(p2.y.mul(0.00583715))).mul(52.9829189));
  // Up to nineteen pixels in twenty go; enough is left to see what it was.
  return threshold.greaterThan(inside.mul(occlusion.on).mul(0.95));
}
