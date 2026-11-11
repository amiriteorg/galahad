import { abs, cameraPosition, clamp, dot, float, floor, Fn, fract, If, length, max, mix, normalize, normalWorld, positionWorld, pow, renderGroup, sin, smoothstep, step, uniform, vec2, vec3, vertexColor } from "three/tsl";
import { Color, type Node } from "three/webgpu";
import { WATER_LEVEL } from "./terrain.ts";

/*
 * The weather on the materials: one set of uniforms (wetness, rain, lying snow,
 * the rain's clock, the sky's colour, lightning's flash) that the land, rocks,
 * trees and the keep read through the same few hooks. Wet things go darker and
 * take a sheen of the sky (an emissive term, so Lambert materials stay Lambert:
 * no new lighting model); level paths gather puddles, and the water and the
 * puddles ring with drops while it rains; on tiers that can afford it, drops
 * splash where they land. Snow lies on whatever faces up (the ground, roofs, the
 * tops of crowns and rocks): it gathers in patches, covers, and thaws back the
 * same way, as the surface's own colour turned to white, so it is lit and
 * shadowed like everything else. Each of these sits behind a branch on its
 * uniform, so on a dry day the GPU skips them: a phone pays for rain only while
 * it rains, and for snow only while it lies.
 */

/**
 * The same for every object, so in the render's shared group: uploaded once a
 * render, not once per draw (three's default), which would cost phones CPU.
 */
export const weatherUniforms = {
  /** 0 dry .. 1 soaked. */
  wetness: uniform(0).setGroup(renderGroup),
  /** 0 .. 1: how hard it's raining (ripples). */
  rain: uniform(0).setGroup(renderGroup),
  /** The rain's clock, seconds (it stops under reduced motion). */
  time: uniform(0).setGroup(renderGroup),
  /** The sky's colour overhead, for the sheen on wet surfaces (linear). */
  sky: uniform(new Color(0.6, 0.65, 0.75)).setGroup(renderGroup),
  /** 0 bare .. 1 covered: snow lying on what faces up. */
  snow: uniform(0).setGroup(renderGroup),
  /** Lightning: 0 dark .. 1 at the flash (it lights the land, the air, the clouds and the rain). */
  flash: uniform(0).setGroup(renderGroup),
  /** 1 on tiers that draw splashes where rain lands, else 0. */
  splash: uniform(0).setGroup(renderGroup),
};

type F = Node<"float">;
type V3 = Node<"vec3">;

/**
 * `compute()` only while `on` holds, otherwise `zero`. The condition is on
 * uniforms, so every pixel takes the same way and the skipped work costs
 * nothing.
 */
export function only<T extends F | V3>(on: Node<"bool">, zero: T, compute: () => T): T {
  return (Fn as unknown as (f: () => T) => () => T)(() => {
    const out = (zero as unknown as { toVar(): T }).toVar();
    If(on, () => {
      (out as unknown as { assign(v: T): void }).assign(compute());
    });
    return out;
  })();
}

const wet = () => weatherUniforms.wetness.greaterThan(0.002);
const snowy = () => weatherUniforms.snow.greaterThan(0.002);

/** Snow as a surface colour (linear): white, a breath of blue. */
const SNOW = vec3(0.86, 0.89, 0.95);

/**
 * How much of this point the snow covers, 0..1: what faces up, above the
 * water; while it's thin it lies in patches that grow together, and it thaws
 * back into the same patches. (Call it inside a snowy branch.)
 */
function snowCover(): F {
  const p = vec2(positionWorld.x, positionWorld.z);
  const patch = sin(p.x.mul(0.83).add(sin(p.y.mul(0.61)).mul(1.9)))
    .mul(sin(p.y.mul(0.97).add(sin(p.x.mul(0.43)).mul(1.4))))
    .mul(0.5)
    .add(0.5);
  const lying = smoothstep(0, 0.3, weatherUniforms.snow.mul(1.4).sub(patch.mul(0.6)));
  const up = smoothstep(0.38, 0.74, normalWorld.y);
  const dry = smoothstep(WATER_LEVEL + 0.03, WATER_LEVEL + 0.3, positionWorld.y);
  return lying.mul(up).mul(dry) as unknown as F;
}

/**
 * The factor a surface's colour is multiplied by for the weather: darker when
 * wet (porous ground darkens most), and turned to snow where snow lies. A
 * material's colour is its vertex colour times this; `colours` says how many
 * times the vertex colour is multiplied in (the land's goes in twice), so the
 * snow comes out white whatever is under it.
 */
export function wetDarken(porosity = 1, colours = 1): V3 {
  const wetFactor = vec3(float(1).sub(weatherUniforms.wetness.mul(0.38 * porosity)));
  return only(snowy(), wetFactor as unknown as V3, () => {
    const under = max(vertexColor().rgb, vec3(0.03));
    const white = SNOW.div(colours === 2 ? under.mul(under) : under);
    return mix(wetFactor, white, snowCover()) as unknown as V3;
  });
}

/** A pseudo-random number per 2D cell, 0..1. */
const hash = (p: Node<"vec2">) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));

/**
 * Rings where drops land: a jittered grid of cells (`cell` metres), each ringing
 * on its own clock; 0..1. Only a share of cells ring at a time (by the rain).
 */
export function ripples(cell = 1.1): F {
  return only(weatherUniforms.rain.greaterThan(0.002), float(0) as unknown as F, () => {
    const p = vec2(positionWorld.x, positionWorld.z).div(cell);
    const ring = (offset: number) => {
      const q = p.add(offset);
      const id = floor(q);
      const h = hash(id);
      const centre = vec2(hash(id.add(17.3)), hash(id.add(41.9))).mul(0.5).add(0.25);
      const life = fract(weatherUniforms.time.mul(0.85).add(h.mul(7)));
      const d = length(fract(q).sub(centre));
      const band = float(1).sub(smoothstep(0, 0.045, abs(d.sub(life.mul(0.42)))));
      return band.mul(float(1).sub(life)).mul(step(h, weatherUniforms.rain.mul(0.8).add(0.1)));
    };
    return ring(0).add(ring(0.5)).mul(weatherUniforms.rain) as unknown as F;
  });
}

/**
 * Splashes where rain lands on anything that faces up, near the camera: a
 * bright speck that opens into a small ring and is gone in a sixth of a second,
 * each cell of a jittered grid on its own clock; 0..1. Only on tiers that ask
 * for them (the `splash` uniform), only while it rains.
 */
function splashes(): F {
  return only(weatherUniforms.rain.mul(weatherUniforms.splash).greaterThan(0.02), float(0) as unknown as F, () => {
    const p = vec2(positionWorld.x, positionWorld.z).div(0.28);
    const id = floor(p);
    const h = hash(id);
    const centre = vec2(hash(id.add(17.3)), hash(id.add(41.9))).mul(0.5).add(0.25);
    // A drop lands in a cell every 0.9 s or so; its splash lasts the first fifth of that.
    const t = fract(weatherUniforms.time.mul(1.1).add(h.mul(13))).mul(5);
    const d = length(fract(p).sub(centre));
    const ring = float(1).sub(smoothstep(0, 0.07, abs(d.sub(t.mul(0.24))))).mul(float(1).sub(t));
    const speck = float(1).sub(smoothstep(0, 0.1, d)).mul(float(1).sub(t.mul(2.5)).max(0));
    const falls = step(hash(id.add(73.1)), weatherUniforms.rain.mul(0.75).add(0.1));
    const near = float(1).sub(smoothstep(16, 30, length(positionWorld.sub(cameraPosition))));
    const up = smoothstep(0.55, 0.9, normalWorld.y);
    return ring.add(speck).mul(step(t, 1)).mul(falls).mul(near).mul(up).mul(weatherUniforms.rain.mul(0.6).add(0.4)) as unknown as F;
  });
}

/**
 * The sheen of a wet surface: the sky, mirrored at a grazing look and more on
 * level ground, as an emissive term (`extra()` adds puddles and rings, 0..1);
 * with it, the splashes of the rain. Snow lying on it hides the sheen.
 */
export function wetSheen(porosity = 1, extra?: () => F): V3 {
  return only(wet(), vec3(0) as unknown as V3, () => {
    const n = normalWorld;
    const v = normalize(cameraPosition.sub(positionWorld));
    const fresnel = pow(float(1).sub(clamp(dot(n, v), 0, 1)), 4);
    const level = smoothstep(0.35, 0.95, n.y);
    let amount = fresnel.mul(0.5).add(0.03).mul(level.mul(0.7).add(0.3)).mul(weatherUniforms.wetness.mul(porosity));
    if (extra) amount = amount.add(extra().mul(fresnel.mul(0.55).add(0.14)));
    amount = amount.add(splashes().mul(0.5));
    const bare = only(snowy(), float(1) as unknown as F, () => float(1).sub(snowCover()) as unknown as F);
    return weatherUniforms.sky.mul(amount.mul(bare)) as unknown as V3;
  });
}

/**
 * Puddles on the keep's paths and plazas: level, low, the colour of beaten earth
 * (its vertex colour, linear), in patches; 0..1, growing with the wetness.
 * (Call it inside a wet branch: it assumes the ground is wet.)
 */
function puddlesHere(): F {
  const c = vertexColor();
  const earth = smoothstep(0.25, 0.4, c.r.sub(c.b)).mul(step(c.g, c.r)).mul(step(0.35, c.r));
  const level = smoothstep(0.96, 0.995, normalWorld.y);
  const low = float(1).sub(smoothstep(0.2, 0.35, positionWorld.y));
  const p = vec2(positionWorld.x, positionWorld.z);
  const patch = sin(p.x.mul(0.9).add(sin(p.y.mul(0.7)).mul(1.6))).mul(sin(p.y.mul(1.1).add(sin(p.x.mul(0.5)).mul(1.3))));
  const puddle = smoothstep(0.25, 0.45, patch.add(weatherUniforms.wetness.mul(0.5)).sub(0.5));
  return earth.mul(level).mul(low).mul(puddle).mul(smoothstep(0.35, 0.8, weatherUniforms.wetness)) as unknown as F;
}

/** The colour factor of wet ground with puddles on it: darker still where water stands (and white where snow lies). */
export function puddleDarken(): V3 {
  const surface = wetDarken(1);
  return only(weatherUniforms.wetness.greaterThan(0.35), surface, () => surface.mul(mix(float(1), float(0.55), puddlesHere())) as unknown as V3);
}

/** The keep's wet sheen: walls and roofs, puddles mirroring the sky on the paths, and rings in them while it rains. */
export function pathSheen(porosity: number): V3 {
  return wetSheen(porosity, () => {
    const puddles = puddlesHere();
    return puddles.add(ripples(0.6).mul(max(puddles, smoothstep(0.9, 0.99, normalWorld.y).mul(weatherUniforms.wetness).mul(0.12)))) as unknown as F;
  });
}
