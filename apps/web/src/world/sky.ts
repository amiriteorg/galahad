import { abs, acos, asin, atan, dot, exp, float, floor, fract, max, mix, normalize, positionLocal, sin, smoothstep, sqrt, step, uniform, vec2, vec3 } from "three/tsl";
import { BackSide, Color, Group, Mesh, MeshBasicNodeMaterial, type Node, type PerspectiveCamera, SphereGeometry, Vector2, Vector3 } from "three/webgpu";
import { air, airColor, lobes, wind as windWay } from "./air.ts";
import { type Sky, turned } from "./daynight.ts";
import { seasonState } from "./season.ts";
import { GALACTIC, type Mat3, rotate, skyMatrix, type Vec3 } from "./sky/celestial.ts";
import { skyNow } from "./sky/clock.ts";
import { cloudField, setCloudField, setCloudTravel, sheetSeen } from "./sky/cloud-field.ts";
import { CloudMesh } from "./sky/cloud-mesh.ts";
import { blow, cloudKinds, type CloudWeather, emptyKinds, emptyTravel } from "./sky/clouds.ts";
import { dither } from "./sky/dither.ts";
import { Meteors } from "./sky/meteors.ts";
import { HALO, haloStrength, noctilucent, parhelion, rainbowStrength, rainMemory } from "./sky/optics.ts";
import { HEAVENS_FLOOR, HEAVENS_TOP, heavensTop, seenDirection } from "./sky/panorama.ts";
import { Rainbow } from "./sky/rainbow.ts";
import { StarField } from "./sky/star-field.ts";
import { seasonWarmth } from "./sky/words.ts";
import type { TierName } from "./tiers.ts";
import { only, weatherUniforms } from "./wet.ts";

/*
 * The sky. One dome drawn in the shader, and on it and before it everything
 * that is in the heavens and the air:
 *
 * - the air from the horizon (the fog's own colour that way, so the land melts
 *   into it) to the zenith, a band of peach along the horizon at golden hour;
 * - the sun: a disc that flattens and reddens as it sinks, cut by the thick
 *   air's bands at the horizon, in a corona that widens in haze;
 * - the moon in its real phase (a sphere lit by the true direction of the sun),
 *   amber when it's low, its dark part faintly lit by the Earth when it's a
 *   thin crescent;
 * - the real stars and planets (sky/star-field.ts), the Milky Way as a soft
 *   band in its real place, a meteor now and then on a shower's nights;
 * - clouds of three kinds, each where the weather puts it (sky/clouds.ts): the
 *   low heaps as real shapes before the dome (sky/cloud-mesh.ts), a sheet of
 *   flat-toned facets above them, and cirrus streaked along the wind above
 *   that; lit by the day, from below by a sun at the horizon, by the moon, and
 *   from inside by lightning (with, for a strike that shows one, a jagged bolt
 *   from the cloud's base down behind the far hills);
 * - what the light does: a rainbow opposite a low sun in rain (sky/rainbow.ts),
 *   a 22° halo and sundogs in thin high cloud, noctilucent clouds on summer
 *   nights (sky/optics.ts has when);
 * - curtains of rain hanging far off, and a pale band of mist along the horizon.
 *
 * Everything among the stars is drawn at its real bearing with its height
 * squeezed into the strip of sky the camera sees (sky/panorama.ts); the sun and
 * everything in the air is where it really is.
 *
 * It is drawn last of the solid things, behind them all: only the pixels where
 * sky actually shows are shaded. Each part sits behind a branch on its uniform
 * (or isn't drawn at all), so a clear day pays for the air and the sun and
 * nothing else, and a clear night for the stars. A fine dither keeps the long
 * gradients free of banding. It follows the camera and ignores the fog.
 */

/** Out near the far plane (2000), beyond the far hills, which are drawn before it. */
const RADIUS = 1900;
/** The cloud's base, where a bolt leaves it (sine of its height on the sky: about 10°, just above what a low camera sees). */
const BOLT_TOP = 0.17;
/** The moon's radius on the sky (a little larger than life: 1.15°), as a sine. */
const MOON_SIN = Math.sin((1.15 * Math.PI) / 180);
/** The sun's (1.45°), radians. */
const SUN_RADIUS = (1.45 * Math.PI) / 180;

type F = Node<"float">;
type V3 = Node<"vec3">;

const DEG = 180 / Math.PI;
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export { dither };

/** A pseudo-random number per 2D cell, 0..1. */
const hash = (p: Node<"vec2">) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));

/** What a tier's sky holds: how many stars, how many puffs a low cloud is a heap of and how finely each is faceted, and whether the Milky Way is drawn. */
const DETAIL: Record<TierName, { stars: number; puffs: number; facets: number; milkyWay: boolean }> = {
  low: { stars: 900, puffs: 4, facets: 1, milkyWay: false },
  medium: { stars: 2600, puffs: 5, facets: 1, milkyWay: true },
  high: { stars: 6000, puffs: 7, facets: 2, milkyWay: true },
};

/** The weather as the sky needs it: the world's weather state has all of this. */
export type SkyWeatherNow = CloudWeather & { wind?: number };

export class SkyDome {
  readonly group = new Group();
  private readonly zenith = uniform(new Color(0x86c1f2));
  private readonly sunDir = uniform(new Vector3(0, 1, 0));
  /** Across and up the sun's disc (unit vectors at right angles to its direction), how flat it is, and how low (0..1). */
  private readonly sunRight = uniform(new Vector3(1, 0, 0));
  private readonly sunAbove = uniform(new Vector3(0, 0, 1));
  private readonly sunFlat = uniform(1);
  private readonly sunLow = uniform(0);
  private readonly sunColor = uniform(new Color(0xfff8ec));
  private readonly sunUp = uniform(1);
  /** How far the corona spreads in haze, 0..1. */
  private readonly coronaWide = uniform(0);
  private readonly golden = uniform(0);
  private readonly glowColor = uniform(new Color(0xfff2dc));
  /** The drawn height of the zenith (radians): the top of the strip the heavens are squeezed into; it follows the view's. */
  private readonly top = uniform(HEAVENS_TOP);
  private readonly moonDir = uniform(new Vector3(0, 1, 0));
  private readonly moonSun = uniform(new Vector3(0, 1, 0));
  private readonly moonOpacity = uniform(0);
  /** Its lit face's colour (amber when it's low), and its dark part (the sky's own colour, and the Earth's light on a thin crescent). */
  private readonly moonFace = uniform(new Color(1.25, 1.22, 1.1));
  private readonly moonShade = uniform(new Color(0x101830));
  /** The Milky Way: how bright, and the galaxy's axes in the scene's (towards its centre, along its plane, to its pole). */
  private readonly milky = uniform(0);
  private readonly galaxyCentre = uniform(new Vector3(1, 0, 0));
  private readonly galaxyAlong = uniform(new Vector3(0, 0, 1));
  private readonly galaxyPole = uniform(new Vector3(0, 1, 0));
  /** The sheet's colours: lit, shaded, and lit from below. */
  private readonly cloudLit = uniform(new Color(0xe8e6f0));
  private readonly cloudShade = uniform(new Color(0xb8b4c8));
  private readonly cloudUnder = uniform(new Color(0xffb090));
  private readonly underlight = uniform(0);
  /** The sun's way along the ground (scene x, z), for the facets' tilt. */
  private readonly sunWay = uniform(new Vector2(1, 0));
  /** Cirrus: its colour, and how far the wind has carried it (sky units). */
  private readonly cirrusColor = uniform(new Color(1, 1, 1));
  private readonly cirrusDrift = uniform(new Vector2(0, 0));
  /** The halo: how strong, its colour, and where the two sundogs stand. */
  private readonly halo = uniform(0);
  private readonly haloColor = uniform(new Color(1, 1, 1));
  private readonly dogLeft = uniform(new Vector3(1, 0, 0));
  private readonly dogRight = uniform(new Vector3(-1, 0, 0));
  /** Noctilucent clouds: how strong, and the bearing they stand at (over the sun, below the horizon: scene x, z). */
  private readonly nlc = uniform(0);
  private readonly nlcWay = uniform(new Vector2(0, -1));
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
  /** The curtains' and the ripples' slow drift (noise units), advanced with the wind (still under reduced motion). */
  private readonly drift = uniform(new Vector3(0, 0, 0));
  private readonly material: MeshBasicNodeMaterial;
  private readonly clouds: CloudMesh;
  private readonly stars: StarField;
  private readonly bow = new Rainbow();
  private readonly meteors = new Meteors();
  private readonly kinds = emptyKinds();
  private readonly travel = emptyTravel();
  private readonly detail: (typeof DETAIL)[TierName];
  private readonly scratch = new Color();
  private readonly matrix: Mat3 = new Float64Array(9);
  private readonly axis: Vec3 = [0, 0, 0];
  private galaxyAt = Number.NEGATIVE_INFINITY;
  /** The sun and the moon where they really are (the world's frame: x east, y north, z up), as `set` last heard. */
  private readonly sunReal: Vec3 = [0, 0, 1];
  private readonly moonReal: Vec3 = [0, 0, -1];
  private readonly moonSeen: Vec3 = [0, 0, 1];
  private readonly moonLight: Vec3 = [0, 0, 1];
  private readonly forward = new Vector3();
  /** What `set` last heard, for what's worked out every frame (the rainbow, the meteors). */
  private sunElevation = 0;
  private rain = 0;
  private cover = 0;
  private rainPast = 0;
  /** How dark and clear the night is for a meteor, 0..1. */
  private nightSky = 0;

  constructor(tier: TierName = "high") {
    const detail = DETAIL[tier];
    this.detail = detail;
    const dome = new MeshBasicNodeMaterial({ side: BackSide, depthWrite: false });
    dome.fog = false;
    const dir = normalize(positionLocal) as unknown as V3;
    const up = dir.y as unknown as F;
    const l = lobes(dir);
    // From the air at the horizon to the zenith: most of the way within the strip of sky a low camera sees.
    const base = mix(airColor(dir, l), this.zenith, smoothstep(-0.04, 0.44, up).pow(0.75));
    const toSun = dot(dir, this.sunDir);
    const facing = max(toSun, 0);
    // At golden hour, a broad band of the sun's colour along the horizon on its side of the sky.
    const band = float(1).sub(smoothstep(0, 0.3, abs(up))).mul(facing.mul(facing).mul(sqrt(facing))).mul(this.golden);
    const warm = mix(base, this.glowColor, band.mul(0.7).min(1));

    // The Milky Way: a soft band along the galaxy's plane, brighter towards its centre, with its dark lane; where it
    // really is (the panorama's squeeze undone for this pixel: its real height from the drawn one).
    const milky = detail.milkyWay
      ? only(this.milky.greaterThan(0.003), vec3(0) as unknown as V3, () => {
          const sinReal = asin(up.clamp(-1, 1)).sub(HEAVENS_FLOOR).div(this.top.sub(HEAVENS_FLOOR)).clamp(0, 1);
          const flat = normalize(vec2(dir.x, dir.z).add(vec2(1e-5, 0)));
          const cosReal = sqrt(float(1).sub(sinReal.mul(sinReal)));
          const real = vec3(flat.x.mul(cosReal), sinReal, flat.y.mul(cosReal));
          const gx = dot(real, this.galaxyCentre);
          const gy = dot(real, this.galaxyAlong);
          const gz = dot(real, this.galaxyPole);
          const core = exp(gz.mul(gz).mul(-1 / (2 * 0.1 * 0.1)));
          const glow = exp(gz.mul(gz).mul(-1 / (2 * 0.28 * 0.28))).mul(0.22);
          const towards = smoothstep(-0.7, 0.9, gx).mul(0.6).add(0.4);
          const clumps = sin(gx.mul(11).add(sin(gy.mul(8)).mul(1.8))).mul(sin(gy.mul(13).add(gx.mul(4)))).mul(0.26).add(0.74);
          const lane = float(1).sub(exp(gz.sub(0.012).mul(gz.sub(0.012)).mul(-1 / (2 * 0.026 * 0.026))).mul(smoothstep(-0.15, 0.5, gx)).mul(0.55));
          // (Dimmer through the thick air low down; and towards the top of the strip, where the whole of the sky
          // overhead is drawn in a line, so that the zenith's share of it isn't a bright cap.)
          const through = smoothstep(HEAVENS_FLOOR * 0.5, HEAVENS_FLOOR * 1.25, up).mul(float(1).sub(smoothstep(0.72, 1, sinReal).mul(0.75)));
          return vec3(0.6, 0.68, 1).mul(core.mul(clumps).mul(lane).add(glow).mul(towards).mul(through).mul(this.milky)) as unknown as V3;
        })
      : (vec3(0) as unknown as V3);

    // Noctilucent clouds: a silver-blue veil low over where the sun is, below the horizon, in soft patches crossed by
    // fine wavy billows, a few to a degree, lying nearly level.
    const shining = only(this.nlc.greaterThan(0.003), vec3(0) as unknown as V3, () => {
      const flat = normalize(vec2(dir.x, dir.z).add(vec2(1e-5, 0)));
      const towards = dot(flat, this.nlcWay);
      const off = atan(flat.x.mul(this.nlcWay.y).sub(flat.y.mul(this.nlcWay.x)), towards);
      const span = smoothstep(0.45, 0.95, towards);
      const height = smoothstep(0.03, 0.085, up).mul(float(1).sub(smoothstep(0.12, 0.22, up)));
      const patches = sin(off.mul(5.3).add(sin(up.mul(31)).mul(1.7)).add(this.drift.x.mul(0.3))).mul(sin(up.mul(44).add(off.mul(3.1)))).mul(0.5).add(0.5);
      const billows = sin(up.mul(520).add(sin(off.mul(13)).mul(3.2)).add(off.mul(21))).mul(0.5).add(0.5);
      const cross = sin(up.mul(300).sub(off.mul(47)).add(sin(off.mul(7)).mul(2))).mul(0.5).add(0.5);
      const veil = smoothstep(0.3, 0.75, patches);
      const lines = smoothstep(0.55, 0.95, billows).mul(0.7).add(smoothstep(0.7, 1, cross).mul(0.3));
      return vec3(0.45, 0.76, 1).mul(veil.mul(lines.mul(0.8).add(0.2)).mul(span).mul(height).mul(this.nlc)) as unknown as V3;
    });

    // The moon: a sphere lit by the sun, so its phase is simply what the sun lights of it; its dark part has the
    // sky's colour and, on a thin crescent, the Earth's light.
    const moon = only(this.moonOpacity.greaterThan(0.003), vec3(0) as unknown as V3, () => {
      const towards = dot(dir, this.moonDir);
      const p = dir.sub(this.moonDir.mul(towards)).div(MOON_SIN);
      const r2 = dot(p, p);
      const inside = float(1).sub(smoothstep(0.86, 1, r2)).mul(step(0, towards));
      const normal = p.sub(this.moonDir.mul(sqrt(max(float(1).sub(r2), 0))));
      const sunlit = smoothstep(-0.06, 0.14, dot(normal, this.moonSun));
      // A few soft seas on its face (fixed to the disc), so it isn't a blank coin.
      const seas = sin(p.x.mul(4.1).add(sin(p.y.mul(3.3)).mul(1.4))).mul(sin(p.y.mul(3.7).add(p.z.mul(2.9)))).mul(0.13).add(0.87);
      // (A little darker towards its limb, as a ball is.)
      const limb = float(1).sub(r2.mul(r2).mul(0.16));
      const face = mix(this.moonShade.mul(seas.mul(seas)), this.moonFace.mul(seas).mul(limb), sunlit);
      return face.mul(inside).mul(this.moonOpacity) as unknown as V3;
    });
    const moonMask = only(this.moonOpacity.greaterThan(0.003), float(0) as unknown as F, () => {
      const towards = dot(dir, this.moonDir);
      const p = dir.sub(this.moonDir.mul(towards)).div(MOON_SIN);
      return float(1).sub(smoothstep(0.86, 1, dot(p, p))).mul(step(0, towards)).mul(this.moonOpacity) as unknown as F;
    });
    // The moon's disc hides the sky behind it (its dark side is dark, not see-through).
    const heavens = mix(warm.add(milky).add(shining), vec3(0), moonMask).add(moon);

    // The halo: a ring 22° from the sun, sharp and reddish inside, soft and pale outside, and a sundog either side.
    const ring = only(this.halo.greaterThan(0.003), vec3(0) as unknown as V3, () => {
      const theta = acos(toSun.clamp(-1, 1));
      const edge = smoothstep(HALO - 0.02, HALO, theta).mul(float(1).sub(smoothstep(HALO, HALO + 0.085, theta)));
      const tint = mix(vec3(1, 0.6, 0.42), vec3(0.9, 0.95, 1), smoothstep(HALO - 0.012, HALO + 0.035, theta));
      const dog = (at: typeof this.dogLeft) => {
        const d = max(dot(dir, at), 0);
        const d2 = d.mul(d);
        const d8 = d2.mul(d2).mul(d2).mul(d2);
        const d64 = d8.mul(d8).mul(d8).mul(d8).mul(d8).mul(d8).mul(d8).mul(d8);
        const d512 = d64.mul(d64).mul(d64).mul(d64).mul(d64).mul(d64).mul(d64).mul(d64);
        // A bright knot with a paler tail.
        return d512.mul(d512).mul(d512).add(d512.mul(0.3));
      };
      const dogs = dog(this.dogLeft).add(dog(this.dogRight));
      return tint.mul(edge.mul(0.28)).add(this.haloColor.mul(dogs.mul(0.9))).mul(this.halo).mul(smoothstep(0, 0.03, up)) as unknown as V3;
    });

    // Cirrus: a few thin wisps along the wind, high above everything else, each bent and hooked (a strand that
    // wanders: its place across the wind swings widely along it), in tufts with open sky between.
    const wisps = only((cloudField.kinds.z as unknown as F).greaterThan(0.01), float(0) as unknown as F, () => {
      const q = vec2(dir.x, dir.z).div(max(up, 0).add(0.3)).mul(2.3).add(this.cirrusDrift);
      const along = dot(q, air.wind);
      const across = q.x.mul(air.wind.y).sub(q.y.mul(air.wind.x));
      const wander = sin(along.mul(0.55).add(sin(across.mul(0.8)).mul(2))).mul(3.4).add(sin(along.mul(1.7).add(across.mul(0.6))).mul(1.5));
      const strand = sin(across.mul(7).add(wander)).mul(0.5).add(0.5);
      const tufts = sin(along.mul(2.6).add(sin(across.mul(1.9)).mul(1.8))).mul(sin(across.mul(2.3).sub(along.mul(0.7)))).mul(0.5).add(0.5);
      const fibres = sin(across.mul(46).add(wander.mul(5)).add(along.mul(3))).mul(0.5).add(0.5);
      const amount = cloudField.kinds.z as unknown as F;
      // (Whole strands that fade in with the amount, never crumbs of one: soft down their middles, combed into
      // fibres at their edges.)
      const edge = mix(float(0.74), float(0.52), amount);
      const soft = smoothstep(edge, edge.add(0.42), strand).mul(smoothstep(0.4, 0.72, tufts));
      const body = soft.mul(mix(fibres, float(1), soft).mul(0.75).add(0.25));
      return body.mul(smoothstep(0.02, 0.09, up)).mul(smoothstep(0, 0.5, amount)) as unknown as F;
    });
    const high = mix(heavens.add(ring), this.cirrusColor, wisps.mul(0.46));

    // The sheet: flat-toned facets with a straight-edged rim (sky/cloud-field.ts), gathering into a lid as the cover
    // grows. x: how much cloud is here; y: how deep into it the facet is; z: how it tilts to the sun.
    const sheet = only((cloudField.kinds.y as unknown as F).greaterThan(0.004), vec3(0) as unknown as V3, () => {
      const s = sheetSeen(dir, this.sunWay as unknown as Node<"vec2">);
      return vec3(s.cover.mul(smoothstep(0, 0.05, up)), s.depth, s.tilt) as unknown as V3;
    });
    const cover = sheet.x as unknown as F;
    const deep = smoothstep(0, 0.3, sheet.y);
    // Lit by the day at its rim and on the facets that lean to the sun, shaded within; lit from below by a sun at the
    // horizon (most on the sun's side of the sky); lit from inside by lightning (most where it strikes).
    const litShare = float(1).sub(deep.mul(0.62)).add(sheet.z.mul(0.11)).add(l.broad.mul(0.36)).clamp(0, 1);
    const dayLit = mix(this.cloudShade, this.cloudLit, litShare);
    const under = this.underlight.mul(facing.mul(0.75).add(0.5)).mul(deep.mul(0.35).add(0.65)).mul(sheet.z.mul(0.18).add(1));
    const struck = weatherUniforms.flash.mul(max(dot(normalize(vec3(dir.x, 0, dir.z)), this.flashDir), 0).pow(3).mul(0.8).add(0.2));
    const cloudColor = mix(dayLit, this.cloudUnder, under.min(1)).add(vec3(0.75, 0.8, 1).mul(struck.mul(1.4)));
    const clouded = mix(high, cloudColor, cover.mul(0.96));

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

    // The sun: a crisp disc, flattened by the thick air as it nears the horizon, redder towards its foot and cut by
    // a band or two of that air; in a corona that is tight in clear air and spreads in haze. Hidden where the cloud
    // is thick.
    const sx = dot(dir, this.sunRight).div(SUN_RADIUS);
    const sy = dot(dir, this.sunAbove).div(this.sunFlat.mul(SUN_RADIUS));
    const disc = float(1).sub(smoothstep(0.84, 1, sx.mul(sx).add(sy.mul(sy)))).mul(step(0, toSun));
    const foot = float(0.5).sub(sy.mul(0.5)).clamp(0, 1);
    const bands = float(1).sub(this.sunLow.mul(0.3).mul(step(0.62, fract(sy.mul(2.4).add(0.31)))).mul(foot));
    const discColor = mix(this.sunColor, vec3(1, 0.24, 0.1), this.sunLow.mul(foot.mul(0.5).add(0.3))).mul(bands);
    const corona = mix(l.tight.mul(l.tight).mul(0.5), l.tight.mul(0.42).add(l.broad.mul(0.15)), this.coronaWide);
    const veil = float(1).sub(cover.mul(0.92)).mul(float(1).sub(wisps.mul(0.3)));
    // (Less glare on a low sun, so its colour shows.)
    const glare = float(3).sub(this.sunLow.mul(1.1));
    dome.colorNode = misty.add(discColor.mul(disc.mul(glare)).add(this.sunColor.mul(corona)).mul(this.sunUp).mul(veil)).add(dither());
    const sky = new Mesh(new SphereGeometry(RADIUS, 48, 24), dome);
    // After everything solid (so only the sky that shows is shaded), before anything see-through.
    sky.renderOrder = 50;
    sky.frustumCulled = false;
    this.material = dome;
    this.clouds = new CloudMesh(detail.puffs, detail.facets);
    this.stars = new StarField(detail.stars);
    this.group.add(sky, this.clouds.mesh, this.stars.mesh, this.stars.streak, this.bow.mesh);
  }

  /** Takes the sky's colours, the sun and moon (world frame, z up), and the weather on it; `motion` false stills the stars. */
  set(s: Sky, w: SkyWeatherNow, motion: boolean): void {
    const rain = w.rain;
    const snow = w.snow ?? 0;
    const storm = w.storm ?? 0;
    const e = s.sunElevation * DEG;
    // As deep as the fog (atmosphere.ts HAZE), so the land melts into the sky with no seam.
    this.zenith.value.setHex(s.zenith).multiplyScalar(0.88);
    this.glowColor.value.setHex(s.sunGlow).multiplyScalar(0.8);
    // Scene axes: (x, z, −y).
    const sun = this.sunDir.value.set(s.sun[0], s.sun[2], -s.sun[1]);
    // Across and up its disc; the thick air at the horizon flattens it and reddens it.
    this.sunRight.value.set(-sun.z, 0, sun.x);
    if (this.sunRight.value.lengthSq() < 1e-8) this.sunRight.value.set(1, 0, 0);
    this.sunRight.value.normalize();
    this.sunAbove.value.crossVectors(this.sunRight.value, sun).normalize();
    const low = 1 - smooth(0, 7, e);
    this.sunFlat.value = 1 - 0.22 * low;
    this.sunLow.value = s.lightFromSun ? 1 - smooth(0.5, 12, e) : 1;
    // The disc reddens as it sinks.
    const sinking = 1 - Math.min(1, Math.max(0, s.sun[2] / 0.2));
    this.sunColor.value.setHex(s.light).lerp(this.scratch.setRGB(1, 0.42, 0.2), s.lightFromSun ? sinking * 0.5 : 0.6);
    this.sunUp.value = (s.lightFromSun ? Math.min(1, s.sun[2] * 6 + 0.25) : Math.max(0, s.sun[2] * 4 + 0.3)) * (1 - s.cloud * 0.6);
    this.golden.value = Math.min(1, s.golden * 1.4);

    // The clouds: their kinds by the weather, the sun's height and the season; then each kind's light.
    const kinds = cloudKinds(w, e, seasonWarmth(seasonState), this.kinds);
    // Shadows fall away from the sun; the light on the clouds comes from the sun, its afterglow at the horizon, or the moon.
    setCloudField(kinds, this.travel, sun.x, sun.y, sun.z);
    this.sunWay.value.set(sun.x, sun.z);
    if (this.sunWay.value.lengthSq() < 1e-8) this.sunWay.value.set(1, 0);
    this.sunWay.value.normalize();
    this.coronaWide.value = clamp01(0.9 * s.mist + 0.5 * kinds.cirrus + 0.3 * low * (s.lightFromSun ? 1 : 0));

    // The moon: bright at night (in its phase), a pale ghost by day, hidden below the horizon; amber when it's low.
    // (Where it's drawn is worked out every frame, with the strip's top: `follow`.)
    for (let i = 0; i < 3; i++) {
      this.sunReal[i] = s.sun[i]!;
      this.moonReal[i] = s.moon[i]!;
    }
    this.placeMoon();
    this.moonOpacity.value = Math.min(1, Math.max(s.night * 1.3, 0.28)) * s.moonUp * (1 - 0.4 * s.mist);
    const moonLow = 1 - smooth(2, 20, Math.asin(Math.max(-1, Math.min(1, s.moon[2]))) * DEG);
    this.moonFace.value.setRGB(1.25, 1.22, 1.1).lerp(this.scratch.setRGB(1.25, 0.92, 0.58), 0.75 * moonLow);
    // Its unlit part: the sky's own colour, and earthshine, strongest on a thin crescent in a dark sky.
    const earthshine = (1 - s.moonLit) ** 2.2 * s.night;
    this.moonShade.value.setHex(s.zenith).multiplyScalar(1.5).addScalar(0.012).add(this.scratch.setRGB(0.05, 0.068, 0.105).multiplyScalar(earthshine));

    // The sheet. (Lit: the light's own colour on white, far brighter than the sky behind; shaded: the sky's
    // blue-grey, deeper. Under a full deck both go to the grey the weather has already made of the horizon. At night
    // the moon lights it, by its phase and height.)
    const deck = Math.min(1, Math.max(0, (s.cloud - 0.55) / 0.35));
    const dayness = 1 - s.night * (0.89 - 0.06 * s.moonlight);
    this.cloudLit.value
      .setRGB(1, 1, 1)
      .lerp(this.scratch.setHex(s.light), 0.45)
      .multiplyScalar(1.08 * dayness)
      .lerp(this.scratch.setHex(s.horizon), deck * 0.7)
      .multiplyScalar(1 - 0.42 * storm);
    this.cloudShade.value.setHex(s.horizon).lerp(this.scratch.setHex(s.zenith), 0.6).multiplyScalar((0.7 - s.cloud * 0.14 - rain * 0.1) * (1 - 0.25 * storm));
    this.cloudUnder.value.setHex(s.sunGlow).lerp(this.scratch.setRGB(1, 0.46, 0.34), 0.4).multiplyScalar(1.12);
    this.underlight.value = Math.min(1, s.underlight * 1.25);
    // Cirrus is the first to catch a rising sun and the last to lose a setting one: white by day, rose at the day's ends.
    this.cirrusColor.value
      .setRGB(1, 1, 1)
      .lerp(this.scratch.setHex(s.light), 0.3)
      .lerp(this.scratch.setHex(s.sunGlow), 0.55 * Math.min(1, s.golden + s.underlight))
      .multiplyScalar(1.02 * (1 - s.night * (0.97 - 0.05 * s.moonlight)));

    // The low clouds: a blush of the light's colour on white where it falls, lavender where it doesn't, a darker
    // flat base; peach from below at the day's ends; slate under rain and thunder; the moon's silver at night.
    const c = this.clouds;
    const dim = 1 - s.night * (0.95 - 0.08 * s.moonlight);
    const heavy = 1 - 0.3 * Math.max(rain, snow * 0.4) - 0.22 * storm;
    c.lit.value.setRGB(1, 0.955, 0.95).lerp(this.scratch.setHex(s.light), 0.42).lerp(this.scratch.setHex(s.sunGlow), 0.3 * s.golden).multiplyScalar(1.14 * dim * heavy).lerp(this.scratch.setHex(s.horizon).multiplyScalar(0.9), deck * 0.55);
    c.shade.value.setHex(0xc6b4e2).lerp(this.scratch.setHex(s.horizon), 0.3).lerp(this.scratch.setHex(s.zenith), 0.25).multiplyScalar((0.72 - s.cloud * 0.12) * dim * heavy * heavy);
    c.base.value.copy(c.shade.value).multiplyScalar(0.7);
    c.under.value.copy(this.cloudUnder.value);
    c.underlight.value = this.underlight.value;
    c.rim.value.setHex(s.light).multiplyScalar(1.5);
    c.rimStrength.value = (s.lightFromSun ? 0.85 * (1 - 0.6 * s.cloud) : 0.5 * s.moonlight) * (1 - 0.5 * storm);
    c.light.value.set(s.airDir[0], s.airDir[2], -s.airDir[1]);
    // (Deep in a moonless night the air's light has no source: the sky's own glow, from overhead.)
    if (!s.lightFromSun && s.sunElevation * DEG < -10.5 && s.moonUp < 0.02) c.light.value.set(0.2, 0.9, 0.38).normalize();
    c.scud.value = kinds.scud;
    c.show(kinds.cumulus > 0.004 || kinds.towers > 0.01);

    // The stars come out by the sun's depth; mist, falling rain and snow dim them. The Milky Way needs it darker, and no bright moon.
    const clear = (1 - 0.5 * s.mist) * (1 - 0.7 * Math.max(rain, snow));
    this.stars.set(-e, clear, motion, this.moonSeen, this.moonOpacity.value > 0.003 ? MOON_SIN : 0);
    this.milky.value = smooth(11, 17, -e) * clear * (1 - 0.65 * s.moonlight) * 0.95;
    this.nightSky = smooth(8, 14, -e) * clear * (1 - smooth(0.5, 0.95, kinds.sheet));

    // What the light does: a halo and sundogs in cirrus round a lowish sun; noctilucent clouds on a summer's night.
    this.halo.value = haloStrength(e, kinds.cirrus, s.cloud);
    if (this.halo.value > 0.003) {
      const dog = parhelion(Math.max(0, s.sunElevation));
      const bearing = Math.atan2(s.sun[0], s.sun[1]);
      const flat = Math.cos(Math.max(0, s.sunElevation));
      const z = Math.sin(Math.max(0, s.sunElevation));
      this.dogLeft.value.set(flat * Math.sin(bearing - dog.bearing), z, -flat * Math.cos(bearing - dog.bearing));
      this.dogRight.value.set(flat * Math.sin(bearing + dog.bearing), z, -flat * Math.cos(bearing + dog.bearing));
      this.haloColor.value.setHex(s.light).lerp(this.scratch.setRGB(1, 0.8, 0.6), 0.3);
    }
    this.nlc.value = noctilucent(skyNow(), e, s.cloud) * 0.34;
    if (this.nlc.value > 0.003) {
      this.nlcWay.value.set(s.sun[0], -s.sun[1]);
      if (this.nlcWay.value.lengthSq() < 1e-8) this.nlcWay.value.set(0, -1);
      this.nlcWay.value.normalize();
    }

    this.mist.value = Math.max(s.mist, s.snow * 0.7);
    this.mistColor.value.setHex(s.horizon).lerp(this.glowColor.value, 0.25).multiplyScalar(0.9);
    this.curtains.value = Math.max(rain, s.snow * 0.6) * Math.min(1, s.cloud * 1.3);
    this.curtainColor.value.copy(this.cloudShade.value).multiplyScalar(0.82);
    this.sunElevation = e;
    this.rain = rain;
    this.cover = s.cloud;
  }

  /** Where the latest lightning struck (a compass bearing, radians), whether it shows a bolt, and which strike it is (its bolt's shape). */
  strike(bearing: number, bolt = false, n = 0): void {
    this.flashDir.value.set(Math.sin(bearing), 0, -Math.cos(bearing));
    this.clouds.flashDir.value.copy(this.flashDir.value);
    this.boltOn.value = bolt ? 1 : 0;
    this.boltSeed.value = (n % 997) + 0.5;
  }

  /** Moves the clouds on with the wind (metres a second): the low clouds, the sheet, the cirrus and their shadows, together. */
  blow(dt: number, wind: number): void {
    setCloudTravel(blow(this.travel, dt, wind, windWay.x, windWay.z));
    // Cirrus is far above: it crosses the sky slowly. (Wrapped far out, so the GPU's floats stay precise.)
    const slow = (0.0032 + 0.0018 * wind) * dt;
    const cirrus = this.cirrusDrift.value;
    cirrus.set((cirrus.x - windWay.x * slow) % 4096, (cirrus.y - windWay.z * slow) % 4096);
    const d = this.drift.value;
    const speed = (0.004 + 0.0022 * wind) * dt;
    d.set((d.x - windWay.x * speed) % 4096, (d.y - windWay.z * speed) % 4096, (d.z + speed * 0.6) % 4096);
  }

  /** The moon as drawn: its real bearing, its height squeezed into the strip as it stands now; the sun turned with it, so its phase is real. */
  private placeMoon(): void {
    seenDirection(this.moonReal, this.moonSeen, this.top.value);
    turned(this.sunReal, this.moonReal, this.moonSeen, this.moonLight);
    // Scene axes: (x, z, −y).
    this.moonDir.value.set(this.moonSeen[0], this.moonSeen[2], -this.moonSeen[1]);
    this.moonSun.value.set(this.moonLight[0], this.moonLight[2], -this.moonLight[1]);
    this.stars.moon(this.moonSeen[0], this.moonSeen[2], -this.moonSeen[1]);
  }

  /**
   * Keeps the dome centred on the camera, and the heavens to the instant and
   * the view: the strip they are squeezed into opened to the view's top, the
   * stars turned to where they stand now, a meteor if one falls, the rainbow
   * while its conditions hold. `dt` seconds since the last frame drawn.
   */
  follow(camera: PerspectiveCamera, dt = 0, motion = true): void {
    this.group.position.copy(camera.position);
    // How high the view's top edge looks: the heavens fill the strip up to just under it (eased, so a zoom opens them smoothly).
    const viewTop = Math.asin(Math.max(-1, Math.min(1, camera.getWorldDirection(this.forward).y))) + (camera.fov * Math.PI) / 360;
    const want = heavensTop(viewTop);
    const top = motion && dt > 0 ? this.top.value + (want - this.top.value) * (1 - Math.exp(-dt * 5)) : want;
    if (Math.abs(top - this.top.value) > 1e-5) {
      this.top.value = Math.abs(top - want) < 2e-5 ? want : top;
      this.stars.open(this.top.value);
      this.placeMoon();
    }
    const now = skyNow();
    this.stars.place(now);
    if (this.detail.milkyWay && this.milky.value > 0.003 && Math.abs(now - this.galaxyAt) > 20_000) {
      // The galaxy's axes over the horizon now (east, north, up), in the scene's (x, z, −y).
      this.galaxyAt = now;
      const m = skyMatrix(now, this.matrix);
      const pole = rotate(m, GALACTIC.pole, this.axis);
      this.galaxyPole.value.set(pole[0], pole[2], -pole[1]);
      const centre = rotate(m, GALACTIC.centre, this.axis);
      this.galaxyCentre.value.set(centre[0], centre[2], -centre[1]);
      this.galaxyAlong.value.crossVectors(this.galaxyPole.value, this.galaxyCentre.value).normalize();
    }
    // A meteor on a shower's night (never under reduced motion).
    if (this.nightSky > 0.02 || this.meteors.alive) {
      this.meteors.step(dt, now, this.nightSky, motion);
      this.stars.meteor(this.meteors, this.nightSky);
    } else this.stars.meteor(this.meteors, 0);
    // The rainbow: while rain falls or has just passed, the sun is out and lower than 42°.
    this.rainPast = rainMemory(this.rainPast, this.rain, dt);
    this.bow.set(rainbowStrength(this.sunElevation, this.rain, this.rainPast, this.cover), this.sunDir.value);
  }

  /** What the sky remembers of a shower just past, 0..1 (for the HUD's words). */
  get showerPast(): number {
    return this.rainPast;
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof Mesh && o.material === this.material) o.geometry.dispose();
    });
    this.material.dispose();
    this.clouds.dispose();
    this.stars.dispose();
    this.bow.dispose();
  }
}
