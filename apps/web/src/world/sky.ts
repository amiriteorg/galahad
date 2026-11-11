import { abs, atan, dot, exp, float, floor, fract, max, mix, mx_noise_float, normalize, positionLocal, screenCoordinate, sin, smoothstep, sqrt, step, time, uniform, vec2, vec3 } from "three/tsl";
import { BackSide, Color, Group, Mesh, MeshBasicNodeMaterial, type Node, SphereGeometry, Vector3 } from "three/webgpu";
import { air, airColor, lobes, wind as windWay } from "./air.ts";
import type { Sky } from "./daynight.ts";
import { only, weatherUniforms } from "./wet.ts";

/*
 * The sky: one dome drawn in the shader. From the air at the horizon (the same
 * colour the fog has that way, so the land melts into it) up to the zenith; a
 * band of peach along the horizon at golden hour; the sun, a crisp disc in a
 * corona; at night, stars that twinkle and the moon in its real phase (a sphere
 * lit by the true direction of the sun, drawn where daynight.ts says it shows).
 * Weather lies on it: clouds that gather into a deck, lit by the day, lit from
 * below by a sun at the horizon, lit from inside by lightning (and, for a
 * strike that shows one, a jagged bolt from the cloud's base to the ground at
 * the strike's bearing, behind the far hills); curtains of rain
 * hanging under them far off; a pale band of mist along the horizon. Stars,
 * moon, clouds and curtains each sit behind a branch on their uniform, so a
 * clear day pays for none of them.
 *
 * It is drawn last of the solid things, behind them all: only the pixels where
 * sky actually shows are shaded (drawn first, as it was, every pixel of the
 * screen paid for the sky and was then painted over). A fine dither keeps the
 * long gradients free of banding. It follows the camera and ignores the fog.
 */

/** Out near the far plane (2000), beyond the far hills, which are drawn before it. */
const RADIUS = 1900;
/** The cloud's base, where a bolt leaves it (sine of its height on the sky: about 10°, just above what a low camera sees). */
const BOLT_TOP = 0.17;
/** The moon's radius on the sky (a little larger than life: 1.15°), as a sine. */
const MOON_SIN = Math.sin((1.15 * Math.PI) / 180);

type F = Node<"float">;
type V3 = Node<"vec3">;

/** Half a step of 8-bit colour, as noise on the screen: no bands in long gradients. */
export function dither() {
  return fract(sin(dot(screenCoordinate.xy, vec2(12.9898, 78.233))).mul(43758.5453)).sub(0.5).mul(1 / 255);
}

/** A pseudo-random number per 2D cell, 0..1. */
const hash = (p: Node<"vec2">) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));

export class SkyDome {
  readonly group = new Group();
  private readonly zenith = uniform(new Color(0x86c1f2));
  private readonly sunDir = uniform(new Vector3(0, 1, 0));
  private readonly sunColor = uniform(new Color(0xfff8ec));
  private readonly sunUp = uniform(1);
  private readonly golden = uniform(0);
  private readonly glowColor = uniform(new Color(0xfff2dc));
  private readonly starOpacity = uniform(0);
  /** 1 while things may move (the stars twinkle), else 0. */
  private readonly lively = uniform(1);
  private readonly moonDir = uniform(new Vector3(0, 1, 0));
  private readonly moonSun = uniform(new Vector3(0, 1, 0));
  private readonly moonOpacity = uniform(0);
  private readonly moonShade = uniform(new Color(0x101830));
  private readonly cloud = uniform(0);
  private readonly cloudLit = uniform(new Color(0xe8e6f0));
  private readonly cloudShade = uniform(new Color(0xb8b4c8));
  private readonly cloudUnder = uniform(new Color(0xffb090));
  private readonly underlight = uniform(0);
  private readonly mist = uniform(0);
  private readonly mistColor = uniform(new Color(0xe6e2ee));
  /** Rain far off: curtains hanging under the cloud. */
  private readonly curtains = uniform(0);
  private readonly curtainColor = uniform(new Color(0x808898));
  /** Where lightning strikes (a unit vector along the ground, scene axes). */
  private readonly flashDir = uniform(new Vector3(1, 0, 0));
  /** Whether the latest strike shows a bolt (1) or only lights the cloud (0), and its shape's seed. */
  private readonly boltOn = uniform(0);
  private readonly boltSeed = uniform(0);
  /** The clouds' drift across the sky (noise units), advanced by the renderer (still under reduced motion). */
  readonly drift = uniform(new Vector3(0, 0, 0));
  private readonly material: MeshBasicNodeMaterial;
  private readonly scratch = new Color();

  constructor() {
    const dome = new MeshBasicNodeMaterial({ side: BackSide, depthWrite: false });
    dome.fog = false;
    const dir = normalize(positionLocal) as unknown as V3;
    const up = dir.y as unknown as F;
    const l = lobes(dir);
    // From the air at the horizon to the zenith: most of the way within the strip of sky a low camera sees.
    const base = mix(airColor(dir, l), this.zenith, smoothstep(-0.04, 0.44, up).pow(0.75));
    const facing = max(dot(dir, this.sunDir), 0);
    // At golden hour, a broad band of the sun's colour along the horizon on its side of the sky.
    const band = float(1).sub(smoothstep(0, 0.3, abs(up))).mul(facing.mul(facing).mul(sqrt(facing))).mul(this.golden);
    const warm = mix(base, this.glowColor, band.mul(0.7).min(1));

    // Stars: two grids of cells over the sky (bearing by height), a star in some cells, each twinkling on its own clock.
    const night = only(this.starOpacity.greaterThan(0.003), vec3(0) as unknown as V3, () => {
      const at = vec2(atan(dir.z, dir.x), up);
      const field = (scale: number, share: number, size: number, salt: number) => {
        const p = at.mul(scale);
        const id = floor(p).add(salt);
        const h = hash(id);
        const where = vec2(hash(id.add(31.7)), hash(id.add(57.3))).mul(0.7).add(0.15);
        const d = fract(p).sub(where).length();
        const bright = h.sub(1 - share).div(share).max(0);
        const twinkle = sin(time.mul(h.mul(3).add(1.5)).add(h.mul(90))).mul(0.3).mul(this.lively).add(0.75);
        return float(1).sub(smoothstep(size * 0.35, size, d)).mul(bright.mul(bright).mul(0.85).add(0.15)).mul(step(1 - share, h)).mul(twinkle);
      };
      const stars = field(64, 0.3, 0.095, 0).add(field(150, 0.26, 0.14, 7.1).mul(0.45));
      // Fewer through the thick air at the horizon; a few warm ones among the blue-white.
      const through = smoothstep(0.01, 0.1, up);
      const tint = mix(vec3(0.82, 0.88, 1), vec3(1, 0.86, 0.7), step(0.82, hash(floor(at.mul(64)).add(11.3))));
      return tint.mul(stars.mul(through).mul(this.starOpacity).mul(1.6)) as unknown as V3;
    });

    // The moon: a sphere lit by the sun, so its phase is simply what the sun lights of it, with earthshine on the rest.
    const moon = only(this.moonOpacity.greaterThan(0.003), vec3(0) as unknown as V3, () => {
      const towards = dot(dir, this.moonDir);
      const p = dir.sub(this.moonDir.mul(towards)).div(MOON_SIN);
      const r2 = dot(p, p);
      const inside = float(1).sub(smoothstep(0.86, 1, r2)).mul(step(0, towards));
      const normal = p.sub(this.moonDir.mul(sqrt(max(float(1).sub(r2), 0))));
      const sunlit = smoothstep(-0.06, 0.14, dot(normal, this.moonSun));
      // A few soft seas on its face (fixed to the disc), so it isn't a blank coin.
      const seas = sin(p.x.mul(4.1).add(sin(p.y.mul(3.3)).mul(1.4))).mul(sin(p.y.mul(3.7).add(p.z.mul(2.9)))).mul(0.07).add(0.93);
      const face = mix(this.moonShade, vec3(1.25, 1.22, 1.1).mul(seas), sunlit);
      return face.mul(inside).mul(this.moonOpacity) as unknown as V3;
    });
    const moonMask = only(this.moonOpacity.greaterThan(0.003), float(0) as unknown as F, () => {
      const towards = dot(dir, this.moonDir);
      const p = dir.sub(this.moonDir.mul(towards)).div(MOON_SIN);
      return float(1).sub(smoothstep(0.86, 1, dot(p, p))).mul(step(0, towards)).mul(this.moonOpacity) as unknown as F;
    });
    // The moon's disc hides the sky behind it (its dark side is dark, not see-through); stars shine round it.
    const heavens = mix(warm.add(night), vec3(0), moonMask).add(moon);

    // Clouds: soft noise on a curved sheet overhead (so their shapes still read low in the sky), gathering into
    // a deck as the cover grows. Behind a branch on the cover: a clear sky doesn't pay for the noise.
    // x: how much cloud is here (crisp-edged shapes, in keeping with the faceted world); y: how deep inside one (0 at its rim).
    const clouds = only(this.cloud.greaterThan(0.002), vec3(0) as unknown as V3, () => {
      const sheet = dir.xz.div(max(up, 0).add(0.22)).mul(2.6).add(this.drift.xy);
      const n = mx_noise_float(sheet).mul(0.9).add(mx_noise_float(sheet.mul(2.6).add(this.drift.z)).mul(0.45)).mul(0.5).add(0.5);
      // The share of sky covered follows the cover: a quarter cloud is scattered clouds, three quarters a deck with
      // gaps, all of it a lid; and clouds crowd towards the horizon, as they do.
      const edge = float(0.76)
        .sub(this.cloud.mul(0.52))
        .sub(smoothstep(0.82, 1, this.cloud).mul(0.5))
        .sub(float(1).sub(smoothstep(0, 0.3, up)).mul(0.07));
      const body = smoothstep(edge, edge.add(0.035), n).mul(smoothstep(0, 0.05, up)).mul(this.cloud.mul(5).min(1));
      return vec3(body, smoothstep(edge.add(0.03), edge.add(0.3), n), n) as unknown as V3;
    });
    const cover = clouds.x as unknown as F;
    // Lit by the day at their rims and on the sun's side, shaded within; lit from below by a sun at the horizon
    // (most on the sun's side of the sky); lit from inside by lightning (most where it strikes).
    const litShare = float(1).sub(clouds.y.mul(0.75)).sub(clouds.z.sub(0.5).mul(0.5)).add(l.broad.mul(0.4)).clamp(0, 1);
    const dayLit = mix(this.cloudShade, this.cloudLit, litShare);
    const under = this.underlight.mul(facing.mul(0.75).add(0.5)).mul(clouds.y.mul(0.35).add(0.65));
    const struck = weatherUniforms.flash.mul(max(dot(normalize(vec3(dir.x, 0, dir.z)), this.flashDir), 0).pow(3).mul(0.8).add(0.2));
    const cloudColor = mix(dayLit, this.cloudUnder, under.min(1)).add(vec3(0.75, 0.8, 1).mul(struck.mul(1.4)));
    const clouded = mix(heavens, cloudColor, cover.mul(0.96));

    // Rain far off: darker curtains hanging from the cloud to the horizon, leaning with the wind.
    const rainy = only(this.curtains.greaterThan(0.003), float(0) as unknown as F, () => {
      const round = normalize(vec2(dir.x, dir.z)).add(air.wind.mul(up.mul(1.6)));
      const veil = sin(round.x.mul(5).add(sin(round.y.mul(4).add(this.drift.x.mul(0.5))).mul(2.2))).mul(sin(round.y.mul(6).sub(round.x.mul(3)).add(this.drift.y.mul(0.5))));
      const hang = smoothstep(0, 0.04, up).mul(float(1).sub(smoothstep(0.08, 0.34, up)));
      return smoothstep(-0.2, 0.7, veil).mul(hang).mul(this.curtains) as unknown as F;
    });
    const curtained = mix(clouded, this.curtainColor, rainy.mul(0.62));

    // The bolt: a jagged stroke (a zigzag between hashed offsets, leaning one way, with one fork) at the strike's
    // bearing, from the cloud's base down behind the far hills; a white core in a blue glow, only while it flashes.
    const bolt = only(weatherUniforms.flash.mul(this.boltOn).greaterThan(0.02), vec3(0) as unknown as V3, () => {
      const flat = normalize(vec2(dir.x, dir.z).add(vec2(1e-5, 0)));
      const f = this.flashDir;
      const across = atan(flat.x.mul(f.z).sub(flat.y.mul(f.x)), flat.x.mul(f.x).add(flat.y.mul(f.z)));
      const h = up.div(BOLT_TOP);
      const seed = this.boltSeed;
      const jag = (k: Node<"float">, salt: number) => hash(vec2(k.add(salt), seed)).sub(0.5);
      const path = (steps: number, size: number, salt: number) => {
        const at = h.mul(steps);
        const i = floor(at);
        return mix(jag(i, salt), jag(i.add(1), salt), fract(at)).mul(size);
      };
      const lean = hash(vec2(seed, 7.1)).sub(0.5).mul(0.06).mul(h);
      const main = path(9, 0.014, 0).add(path(31, 0.004, 3.3)).add(lean);
      const stroke = (d: Node<"float">, width: number) => float(1).sub(smoothstep(width * 0.35, width, d)).mul(3).add(exp(d.mul(-75)).mul(0.5));
      const trunk = stroke(abs(across.sub(main)), 0.003);
      // The fork leaves the trunk halfway down and splays away from it.
      const forkAt = hash(vec2(seed, 2.9)).mul(0.25).add(0.4);
      const side = step(0.5, hash(vec2(seed, 5.3))).mul(2).sub(1);
      const below = forkAt.sub(h).max(0);
      const fork = stroke(abs(across.sub(main.add(below.mul(side).mul(0.09)).add(path(23, 0.005, 9.7)))), 0.002).mul(0.55).mul(step(h, forkAt)).mul(smoothstep(0, 0.35, h));
      const span = smoothstep(-0.01, 0.015, up).mul(float(1).sub(smoothstep(0.88, 1, h)));
      return vec3(0.82, 0.88, 1).mul(trunk.add(fork)).mul(span).mul(weatherUniforms.flash) as unknown as V3;
    });

    // Mist along the horizon: pale, low, soft.
    const misty = mix(curtained, this.mistColor, this.mist.mul(float(1).sub(smoothstep(-0.02, 0.18, up))).mul(0.6)).add(bolt);

    // The sun: a crisp disc in a tight corona, hidden where the cloud is thick.
    const disc = smoothstep(0.99962, 0.99974, facing);
    const corona = l.tight.mul(l.tight).mul(0.5);
    const veil = float(1).sub(cover.mul(0.92));
    dome.colorNode = misty.add(this.sunColor.mul(disc.mul(3).add(corona)).mul(this.sunUp).mul(veil)).add(dither());
    const sky = new Mesh(new SphereGeometry(RADIUS, 48, 24), dome);
    // After everything solid (so only the sky that shows is shaded), before anything see-through.
    sky.renderOrder = 50;
    sky.frustumCulled = false;
    this.material = dome;
    this.group.add(sky);
  }

  /** Takes the sky's colours, the sun and moon (world frame, z up), and the weather on it; `rain` 0..1; `motion` false stills the stars. */
  set(s: Sky, rain: number, motion: boolean): void {
    // As deep as the fog (atmosphere.ts HAZE), so the land melts into the sky with no seam.
    this.zenith.value.setHex(s.zenith).multiplyScalar(0.88);
    this.glowColor.value.setHex(s.sunGlow).multiplyScalar(0.8);
    // Scene axes: (x, z, −y).
    this.sunDir.value.set(s.sun[0], s.sun[2], -s.sun[1]);
    // The disc reddens as it sinks.
    const low = 1 - Math.min(1, Math.max(0, s.sun[2] / 0.2));
    this.sunColor.value.setHex(s.light).lerp(this.scratch.setRGB(1, 0.42, 0.2), s.lightFromSun ? low * 0.5 : 0.6);
    this.sunUp.value = (s.lightFromSun ? Math.min(1, s.sun[2] * 6 + 0.25) : Math.max(0, s.sun[2] * 4 + 0.3)) * (1 - s.cloud * 0.6);
    this.golden.value = Math.min(1, s.golden * 1.4);
    this.starOpacity.value = s.stars * (1 - 0.5 * s.mist);
    this.lively.value = motion ? 1 : 0;
    // The moon: bright at night (in its phase), a pale ghost by day, hidden below the horizon.
    this.moonDir.value.set(s.moonSeen[0], s.moonSeen[2], -s.moonSeen[1]);
    this.moonSun.value.set(s.moonSun[0], s.moonSun[2], -s.moonSun[1]);
    this.moonOpacity.value = Math.min(1, Math.max(s.night * 1.3, 0.28)) * s.moonUp * (1 - 0.4 * s.mist);
    // Its unlit side: the sky's own colour, a little lifted by earthshine.
    this.moonShade.value.setHex(s.zenith).multiplyScalar(1.5).addScalar(0.012);
    // Clouds: a bright soft grey lit by the day, darker under rain, deep blue-grey at night; peach from below at sunset.
    this.cloud.value = s.cloud;
    // (Lit: the light's own colour on white, far brighter than the sky behind; shaded: the sky's blue-grey, deeper.
    // Under a full deck both go to the grey the weather has already made of the horizon.)
    const deck = Math.min(1, Math.max(0, (s.cloud - 0.55) / 0.35));
    const dayness = 1 - s.night * 0.86;
    this.cloudLit.value.setRGB(1, 1, 1).lerp(this.scratch.setHex(s.light), 0.45).multiplyScalar(1.08 * dayness).lerp(this.scratch.setHex(s.horizon), deck * 0.7);
    this.cloudShade.value.setHex(s.horizon).lerp(this.scratch.setHex(s.zenith), 0.6).multiplyScalar(0.7 - s.cloud * 0.14 - rain * 0.1);
    this.cloudUnder.value.setHex(s.sunGlow).lerp(this.scratch.setRGB(1, 0.46, 0.34), 0.4).multiplyScalar(1.12);
    this.underlight.value = Math.min(1, s.underlight * 1.25);
    this.mist.value = Math.max(s.mist, s.snow * 0.7);
    this.mistColor.value.setHex(s.horizon).lerp(this.glowColor.value, 0.25).multiplyScalar(0.9);
    this.curtains.value = Math.max(rain, s.snow * 0.6) * Math.min(1, s.cloud * 1.3);
    this.curtainColor.value.copy(this.cloudShade.value).multiplyScalar(0.82);
  }

  /** Where the latest lightning struck (a compass bearing, radians), whether it shows a bolt, and which strike it is (its bolt's shape). */
  strike(bearing: number, bolt = false, n = 0): void {
    this.flashDir.value.set(Math.sin(bearing), 0, -Math.cos(bearing));
    this.boltOn.value = bolt ? 1 : 0;
    this.boltSeed.value = (n % 997) + 0.5;
  }

  /** Moves the clouds on with the wind (metres a second). */
  blow(dt: number, wind: number): void {
    const d = this.drift.value;
    const speed = (0.004 + 0.0022 * wind) * dt;
    // (Wrapped far out, so the GPU's floats stay precise in a page left open for days.)
    d.set((d.x - windWay.x * speed) % 4096, (d.y - windWay.z * speed) % 4096, (d.z + speed * 0.6) % 4096);
  }

  /** Keeps the dome centred on the camera. */
  follow(camera: Vector3): void {
    this.group.position.copy(camera);
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof Mesh) o.geometry.dispose();
    });
    this.material.dispose();
  }
}
