import { dot, float, length, max, mix, renderGroup, sin, smoothstep, uniform } from "three/tsl";
import { Color, type Node, Vector2, Vector3 } from "three/webgpu";
import { WIND_HEADING } from "./place.ts";
import { only, weatherUniforms } from "./wet.ts";

/*
 * The colour of the air by the way you look: the haze's own colour, warmed
 * towards the light (a broad lobe, and a tight glow right round the sun or the
 * moon), cooled away from it, with rays fanning from the sun where broken cloud
 * or mist breaks its light. One function, read by the fog on everything and by
 * the sky at its horizon, so the land melts into the sky with no seam whichever
 * way the light falls. A few multiplies per pixel: it costs phones next to
 * nothing (the rays sit behind a branch).
 */

type F = Node<"float">;
type V3 = Node<"vec3">;

/**
 * The way the wind blows towards, in scene axes (x east, z south), a unit vector: the weather's
 * (Denmark's, when it's live and the node says where it blows from; otherwise from the
 * west-south-west, Denmark's prevailing wind, as the windsocks have it: place.ts). Read on the
 * CPU from `wind`, in shaders from `air.wind`; `setWindHeading` moves both.
 */
export const wind = { x: Math.cos(WIND_HEADING), z: -Math.sin(WIND_HEADING), heading: WIND_HEADING };

/** In the render's shared group: uploaded once a render, not once per draw. */
export const air = {
  /** The haze: the sky at the horizon (linear). */
  color: uniform(new Color(1, 1, 1)).setGroup(renderGroup),
  /** Towards the light: warm white by day, peach at golden hour, silver under the moon. */
  sun: uniform(new Color(1, 1, 1)).setGroup(renderGroup),
  /** Away from the light: cooler and a little deeper. */
  shade: uniform(new Color(1, 1, 1)).setGroup(renderGroup),
  /** Where the light in the air comes from (scene axes, unit). */
  sunDir: uniform(new Vector3(0, 1, 0)).setGroup(renderGroup),
  /** How far the air warms towards the light (broadly), glows right round it, and cools away from it. */
  warm: uniform(0.2).setGroup(renderGroup),
  glow: uniform(0).setGroup(renderGroup),
  cool: uniform(0).setGroup(renderGroup),
  /** Rays fanning from the sun: their strength, two axes across the sun's direction, and their slow drift. */
  rays: uniform(0).setGroup(renderGroup),
  rayA: uniform(new Vector3(1, 0, 0)).setGroup(renderGroup),
  rayB: uniform(new Vector3(0, 0, 1)).setGroup(renderGroup),
  rayDrift: uniform(0).setGroup(renderGroup),
  /** The wind's way (scene x, z), for shaders. */
  wind: uniform(new Vector2(wind.x, wind.z)).setGroup(renderGroup),
};

/** The wind now blows towards `heading` (atan2 convention: 0 east, π/2 north). Cheap when it hasn't changed. */
export function setWindHeading(heading: number): void {
  if (Math.abs(heading - wind.heading) < 1e-4) return;
  wind.heading = heading;
  wind.x = Math.cos(heading);
  wind.z = -Math.sin(heading);
  air.wind.value.set(wind.x, wind.z);
}

export interface Lobes {
  /** The cosine of the angle between the view and the light. */
  cos: F;
  /** Towards the light, broadly (about 40° wide) and tightly (about 12°); away from it. All 0..1. */
  broad: F;
  tight: F;
  back: F;
}

/** How much a view direction (unit) looks towards the light, and away from it: powers by squaring, no pow(). */
export function lobes(view: V3): Lobes {
  const cos = dot(view, air.sunDir);
  const f = max(cos, 0);
  const f2 = f.mul(f);
  const f4 = f2.mul(f2);
  const f8 = f4.mul(f4);
  const f16 = f8.mul(f8);
  const b = max(cos.negate(), 0);
  return { cos: cos as unknown as F, broad: f4.mul(f) as unknown as F, tight: f16.mul(f16).mul(f8) as unknown as F, back: b.mul(b) as unknown as F };
}

/** How brightly lightning lights the air. */
const FLASH_AIR = 1.1;

/** The air's colour looking along `view` (unit), given its lobes. */
export function airColor(view: V3, l: Lobes = lobes(view)): V3 {
  const warmed = mix(air.color, air.sun, l.broad.mul(air.warm).min(1));
  const cooled = mix(warmed, air.shade, l.back.mul(air.cool));
  // Rays: a pattern that depends only on the bearing round the sun, so it is constant along every line through it.
  const rays = only(air.rays.greaterThan(0.003), float(0) as unknown as F, () => {
    const across = view.sub(air.sunDir.mul(l.cos));
    const n = across.div(max(length(across), 1e-4));
    const a = dot(n, air.rayA);
    const b = dot(n, air.rayB);
    const fan = sin(a.mul(7).add(sin(b.mul(5).add(air.rayDrift)).mul(1.8))).mul(sin(b.mul(9).add(a.mul(4)).sub(air.rayDrift.mul(0.6))));
    return smoothstep(-0.25, 0.85, fan).mul(l.broad).mul(float(1).sub(l.tight)).mul(air.rays) as unknown as F;
  });
  const lit = cooled.add(air.sun.mul(l.tight.mul(air.glow).add(rays)));
  return lit.mul(float(1).add(weatherUniforms.flash.mul(FLASH_AIR))) as unknown as V3;
}
