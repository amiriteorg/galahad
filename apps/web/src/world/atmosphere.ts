import { cameraPosition, dot, exp, float, Fn, length, max, mix, normalize, output, positionWorld, rangeFogFactor, renderGroup, select, sin, smoothstep, uniform, vec2, vec3, vec4 } from "three/tsl";
import { Color, type Node, Vector2, Vector3 } from "three/webgpu";
import { air, airColor, lobes, WIND_X, WIND_Z } from "./air.ts";
import type { Sky } from "./daynight.ts";
import { dither } from "./sky.ts";
import { WATER_LEVEL } from "./terrain.ts";
import { only, weatherUniforms } from "./wet.ts";

/*
 * The air between the camera and everything: one node on the scene (its fog),
 * so every material gets it with no pass and no transparent cards.
 *
 * - Haze: thicker far off and low down, coloured by the way you look (air.ts):
 *   warm and glowing towards the sun, cooler away from it, with rays where
 *   broken cloud or mist breaks the light.
 * - Mist: fog that thins with height above the water, summed along the line of
 *   sight in closed form, so it lies in hollows and over lakes; and a thin sheet
 *   of it on the ground where the camera is, at dawn and after dark. Both drift
 *   in slow banks, read at the point looked at and halfway to it, so the banks
 *   slide over the land as you move: they read as air, not as paint on the hills.
 *   Mist glows towards the light.
 * - Cloud shadows: on days of broken cloud, soft shadows drift over the land
 *   with the wind (what's already lit is dimmed a little and cooled).
 * - Lightning: a flash lights the land and the air for an instant.
 * - The grade: what's lit is given the time of day's colour (daynight.ts: a
 *   saturation, and tints for its shadows and its highlights) before the air
 *   lies over it, so the distance still melts into the sky.
 *
 * Mist, cloud shadows and rays each sit behind a branch on their uniform, so a
 * clear day pays for none of them; the uniforms are in the render's shared
 * group (uploaded once a render, not once per draw). Dithered against banding.
 */

/** The haze and the sky's horizon, a little below the painted colour (AgX lifts pale colours towards white). */
export const HAZE = 0.8;
/** The mist thins by e every this many metres above the water; its density at the water (per metre) when it's thickest. */
const MIST_HEIGHT = 1.7;
const MIST_DENSITY = 0.075;
/** The sheet of mist on the ground: thinner, and denser at its foot. */
const SHEET_HEIGHT = 0.6;
const SHEET_DENSITY = 0.045;
/** What a cloud's shadow leaves of the light (linear): the sun is gone, the sky's blue stays. */
const SHADOW_TINT = vec3(0.56, 0.62, 0.78);
/** How brightly lightning lights the land. */
const FLASH_LAND = 1.6;

type F = Node<"float">;

export class Atmosphere {
  /** The scene's fog node. */
  readonly node: Node;
  private readonly near = uniform(60).setGroup(renderGroup);
  private readonly far = uniform(300).setGroup(renderGroup);
  private readonly mistDensity = uniform(0).setGroup(renderGroup);
  private readonly sheetDensity = uniform(0).setGroup(renderGroup);
  private readonly sheetLevel = uniform(0).setGroup(renderGroup);
  private readonly mistColor = uniform(new Color(0xffffff)).setGroup(renderGroup);
  private readonly mistGlow = uniform(new Color(0xffffff)).setGroup(renderGroup);
  private readonly mistDrift = uniform(0).setGroup(renderGroup);
  private readonly shade = uniform(0).setGroup(renderGroup);
  private readonly shadeCover = uniform(0.4).setGroup(renderGroup);
  private readonly shadeAt = uniform(new Vector2(0, 0)).setGroup(renderGroup);
  private readonly gradeSat = uniform(1).setGroup(renderGroup);
  private readonly gradeShadow = uniform(new Vector3(1, 1, 1)).setGroup(renderGroup);
  private readonly gradeLight = uniform(new Vector3(1, 1, 1)).setGroup(renderGroup);
  /** How far the haze reaches (1 clear; rain, snow, cloud and mist bring it in). */
  private reachFactor = 1;
  private level = Number.NaN;
  private readonly a = new Vector3();
  private readonly b = new Vector3();
  private readonly zenith = new Color();

  constructor() {
    const toPoint = positionWorld.sub(cameraPosition);
    const view = normalize(toPoint);
    const l = lobes(view);
    const hazeColor = airColor(view, l);
    const thin = float(1).sub(smoothstep(4, 70, positionWorld.y).mul(0.35));
    const haze = rangeFogFactor(this.near, this.far).mul(thin);

    // Mist: two layers, each exp(−height / scale) above its own level, averaged along the ray in closed form.
    const drift = this.mistDrift;
    const mist = only(this.mistDensity.add(this.sheetDensity).greaterThan(1e-5), float(0) as unknown as F, () => {
      const layer = (level: F | number, height: number, floor: number) => {
        const k = 1 / height;
        const above = (y: F) => y.sub(level).max(floor);
        const yc = above(cameraPosition.y as unknown as F);
        const yp = above(positionWorld.y as unknown as F);
        const ec = exp(yc.mul(-k));
        const ep = exp(yp.mul(-k));
        const dy = yp.sub(yc);
        const steep = dy.abs().greaterThan(0.05);
        return select(steep, ec.sub(ep).div(select(steep, dy, float(1)).mul(k)), ep);
      };
      // Banks: two warped sines (cheap), at the point looked at and halfway to it.
      const bank = (x: F, z: F) =>
        sin(x.mul(0.021).add(sin(z.mul(0.017).add(drift)).mul(1.7)).add(drift.mul(0.6))).mul(sin(z.mul(0.026).add(sin(x.mul(0.013)).mul(1.3)).sub(drift.mul(0.4))));
      const half = positionWorld.add(cameraPosition).mul(0.5);
      const banks = bank(positionWorld.x as unknown as F, positionWorld.z as unknown as F)
        .add(bank(half.x as unknown as F, half.z as unknown as F))
        .mul(0.35)
        .add(1);
      const depth = this.mistDensity.mul(layer(WATER_LEVEL, MIST_HEIGHT, -1.5)).add(this.sheetDensity.mul(layer(this.sheetLevel as unknown as F, SHEET_HEIGHT, -0.35)));
      return float(1).sub(exp(depth.mul(length(toPoint)).mul(banks).negate())) as unknown as F;
    });
    const mistTint = mix(this.mistColor, this.mistGlow, l.broad.mul(0.6).add(l.tight.mul(0.4))).mul(float(1).add(weatherUniforms.flash));

    // Cloud shadows: soft blobs sliding over the land, more of them the more cloud there is.
    const shadow = only(this.shade.greaterThan(0.003), float(0) as unknown as F, () => {
      const q = vec2(positionWorld.x, positionWorld.z).add(this.shadeAt);
      const n = sin(q.x.mul(0.043).add(sin(q.y.mul(0.031)).mul(2.1))).mul(sin(q.y.mul(0.049).add(sin(q.x.mul(0.023)).mul(1.7))));
      const edge = float(1.02).sub(this.shadeCover);
      return smoothstep(edge.sub(0.3), edge, n.mul(0.5).add(0.5)).mul(this.shade) as unknown as F;
    });

    const total = float(1).sub(float(1).sub(haze).mul(float(1).sub(mist)));
    const airTint = mix(hazeColor, mistTint, mist.div(haze.add(mist).max(1e-4)));
    this.node = Fn(() => {
      const lit = output.rgb.mul(mix(vec3(1), SHADOW_TINT, shadow)).mul(float(1).add(weatherUniforms.flash.mul(FLASH_LAND)));
      // The grade: saturation about the pixel's own brightness, then the shadows' tint giving way to the highlights'.
      const lum = dot(lit, vec3(0.2126, 0.7152, 0.0722));
      const rich = max(mix(vec3(lum), lit, this.gradeSat), vec3(0));
      const graded = rich.mul(mix(this.gradeShadow, this.gradeLight, lum.div(lum.add(0.18))));
      return vec4(mix(graded, airTint, total.add(dither().mul(2)).clamp(0, 1)), output.a);
    })() as unknown as Node;
  }

  /** The mist as the light shafts need it (post.ts marches the sun's light through the same air). */
  get shaftAir(): { mist: Node; sheet: Node; sheetLevel: Node } {
    return { mist: this.mistDensity as unknown as Node, sheet: this.sheetDensity as unknown as Node, sheetLevel: this.sheetLevel as unknown as Node };
  }

  /** The air for this sky and weather (`rain` and `snow` falling, 0..1). */
  set(s: Sky, rain: number, snow: number): void {
    air.color.value.setHex(s.horizon).multiplyScalar(HAZE);
    air.sun.value.setHex(s.airLight).multiplyScalar(HAZE);
    air.shade.value.setHex(s.horizon).lerp(this.zenith.setHex(s.zenith), 0.5).multiplyScalar(HAZE * 0.92);
    // Scene axes: (x, z, −y).
    const dir = air.sunDir.value.set(s.airDir[0], s.airDir[2], -s.airDir[1]).normalize();
    air.warm.value = s.airWarm;
    air.glow.value = s.airGlow;
    air.cool.value = s.airCool;
    air.rays.value = s.rays * 0.42;
    // Two axes across the light's direction, for the rays' pattern round it.
    this.a.set(0, 1, 0).cross(dir);
    if (this.a.lengthSq() < 1e-6) this.a.set(1, 0, 0);
    this.a.normalize();
    this.b.crossVectors(dir, this.a).normalize();
    air.rayA.value.copy(this.a);
    air.rayB.value.copy(this.b);
    // The mist takes the haze's colour, lit a little by the low sun (rosy at dawn, white by day, blue at night),
    // and glows towards the light.
    // (On the high tier the light shafts take the sun's share away again where the mist lies in shadow: post.ts.)
    this.mistColor.value.copy(air.color.value).lerp(air.sun.value, 0.3 * (1 - s.cloud)).multiplyScalar(1.04);
    this.mistGlow.value.copy(this.mistColor.value).lerp(air.sun.value, 0.75).multiplyScalar(1 + 0.3 * Math.min(1, s.airWarm + s.airGlow));
    this.mistDensity.value = s.mist * MIST_DENSITY;
    this.sheetDensity.value = s.groundMist * SHEET_DENSITY;
    this.reachFactor = Math.max(0.3, 1 - 0.3 * rain - 0.12 * s.cloud - 0.15 * s.mist - 0.32 * snow);
    this.shade.value = s.cloudShadow * 0.5;
    this.shadeCover.value = Math.min(0.7, Math.max(0.15, s.cloud));
    this.gradeSat.value = s.gradeSat;
    this.gradeShadow.value.set(s.gradeShadow[0], s.gradeShadow[1], s.gradeShadow[2]);
    this.gradeLight.value.set(s.gradeLight[0], s.gradeLight[1], s.gradeLight[2]);
  }

  /** How far the haze reaches this frame: to the edge of the loaded land, and never closer than the view needs. */
  reach(loadRadius: number, distance: number): void {
    const far = loadRadius * 0.94 * this.reachFactor;
    this.far.value = far;
    this.near.value = Math.max(far * 0.3, Math.min(far * 0.8, distance * 1.5 + 30));
  }

  /** The ground under the camera's focus: the sheet of mist lies on it (eased, so it never bobs with the view). */
  ground(level: number, dt: number): void {
    if (this.sheetDensity.value <= 0 || Number.isNaN(this.level) || Math.abs(level - this.level) > 8) this.level = level;
    else this.level += (level - this.level) * (1 - Math.exp(-dt * 0.5));
    if (Math.abs(this.sheetLevel.value - this.level) > 0.004) this.sheetLevel.value = this.level;
  }

  /** Moves the banks, the cloud shadows and the rays on with the wind (metres a second). Only what's in the air moves: a clear day uploads nothing. */
  drift(dt: number, wind: number): void {
    if (this.mistDensity.value + this.sheetDensity.value > 1e-5) this.mistDrift.value = (this.mistDrift.value + dt * (0.004 + 0.0012 * wind)) % 10_000;
    if (this.shade.value > 0.003) {
      // Clouds ride a faster wind than the one on the ground. (Wrapped far out, so the GPU's floats stay precise.)
      const speed = 3 + wind * 1.3;
      const at = this.shadeAt.value;
      at.set((at.x - WIND_X * speed * dt) % 60_000, (at.y - WIND_Z * speed * dt) % 60_000);
    }
    if (air.rays.value > 0.003) air.rayDrift.value = (air.rayDrift.value + dt * 0.03) % 6000;
  }
}
