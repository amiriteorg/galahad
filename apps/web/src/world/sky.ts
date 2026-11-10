import { abs, dot, float, fract, max, mix, mx_noise_float, normalize, normalWorld, positionLocal, pow, screenCoordinate, sin, smoothstep, uniform, vec2 } from "three/tsl";
import { BackSide, BufferAttribute, BufferGeometry, Color, Group, IcosahedronGeometry, Mesh, MeshBasicNodeMaterial, type Node, Points, PointsNodeMaterial, SphereGeometry, Vector3 } from "three/webgpu";
import type { Sky } from "./daynight.ts";
import { rng } from "./physics.ts";
import { only } from "./wet.ts";

/*
 * The sky: a dome drawn in the shader, from the horizon's haze to the zenith,
 * warmed towards the sun (a band of peach along the horizon at golden hour), with
 * a soft sun and its glow; stars and the moon at night, the moon in its real
 * phase (its sphere is lit by the true direction of the sun, so its lit side and
 * how much of it shows are right without any phase arithmetic). Weather lies on
 * it: a soft deck of cloud that thickens with the cover and hides the sun, and a
 * paler band of mist along the horizon. A fine dither keeps the long gradients
 * free of banding. It follows the camera, so it's always at the horizon, and it
 * ignores the fog (the fog is tinted to match it instead).
 */

const RADIUS = 900;

/** Half a step of 8-bit colour, as noise on the screen: no bands in long gradients. */
export function dither() {
  return fract(sin(dot(screenCoordinate.xy, vec2(12.9898, 78.233))).mul(43758.5453)).sub(0.5).mul(1 / 255);
}

export class SkyDome {
  readonly group = new Group();
  private readonly zenith = uniform(new Color(0x86c1f2));
  private readonly horizon = uniform(new Color(0xe0f0f6));
  private readonly glowColor = uniform(new Color(0xfff2dc));
  private readonly sunDir = uniform(new Vector3(0, 1, 0));
  private readonly sunColor = uniform(new Color(0xfff8ec));
  private readonly sunUp = uniform(1);
  private readonly golden = uniform(0);
  private readonly starOpacity = uniform(0);
  private readonly moonOpacity = uniform(0);
  private readonly cloud = uniform(0);
  private readonly cloudLit = uniform(new Color(0xe8e6f0));
  private readonly cloudShade = uniform(new Color(0xb8b4c8));
  private readonly mist = uniform(0);
  private readonly mistColor = uniform(new Color(0xe6e2ee));
  /** The cloud deck's drift (metres of noise), advanced by the renderer (still under reduced motion). */
  readonly drift = uniform(0);
  private readonly moon: Mesh;
  private readonly materials: (MeshBasicNodeMaterial | PointsNodeMaterial)[] = [];

  constructor(starCount: number) {
    const dome = new MeshBasicNodeMaterial({ side: BackSide, depthWrite: false });
    dome.fog = false;
    const dir = normalize(positionLocal);
    const up = dir.y;
    const base = mix(this.horizon, this.zenith, pow(smoothstep(-0.03, 0.62, up), float(0.85)));
    const facing = max(dot(dir, this.sunDir), 0);
    // Towards the sun the haze warms: a broad band along the horizon at golden hour, a soft halo by day.
    const band = float(1).sub(smoothstep(0, 0.32, abs(up))).mul(pow(facing, 2.5)).mul(this.golden);
    const warm = mix(base, this.glowColor, band.mul(0.85).add(pow(facing, 10).mul(0.3).mul(this.sunUp)).min(1));
    // A deck of cloud as the cover grows: soft noise on a plane overhead, thinning towards the horizon's haze
    // (behind a branch on the cover: a clear sky doesn't pay for the noise).
    const cover = only(this.cloud.greaterThan(0.002), float(0) as unknown as Node<"float">, () => {
      const deck = dir.xz.div(max(up, 0.06)).mul(1.4).add(vec2(this.drift, this.drift.mul(0.4)));
      const n = mx_noise_float(deck).mul(0.6).add(mx_noise_float(deck.mul(2.7)).mul(0.3)).mul(0.5).add(0.5);
      return smoothstep(float(1.05).sub(this.cloud.mul(1.1)), float(1.35).sub(this.cloud.mul(1.1)), n).mul(smoothstep(-0.02, 0.2, up)).mul(this.cloud.mul(1.4).min(1)) as unknown as Node<"float">;
    });
    const lit = mix(this.cloudShade, this.cloudLit, cover.mul(0.5).add(pow(facing, 3).mul(0.4)).add(0.1).min(1));
    const clouded = mix(warm, lit, cover.mul(0.92));
    // Mist along the horizon: pale, low, soft.
    const misty = mix(clouded, this.mistColor, this.mist.mul(float(1).sub(smoothstep(-0.02, 0.18, up))).mul(0.6));
    const disc = smoothstep(0.9986, 0.9993, facing);
    const glow = pow(facing, 90).mul(0.7).add(pow(facing, 14).mul(0.12));
    // The sun hides behind the deck where it's thick.
    const veil = float(1).sub(cover.mul(0.9));
    dome.colorNode = misty.add(this.sunColor.mul(disc.mul(2.4).add(glow)).mul(this.sunUp).mul(veil)).add(dither());
    const sky = new Mesh(new SphereGeometry(RADIUS, 48, 24), dome);
    sky.renderOrder = -10;
    sky.frustumCulled = false;

    const random = rng(7);
    const positions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const a = random() * Math.PI * 2;
      const y = 0.08 + random() * 0.92;
      const r = Math.sqrt(1 - y * y);
      positions.set([Math.cos(a) * r * RADIUS * 0.95, y * RADIUS * 0.95, Math.sin(a) * r * RADIUS * 0.95], i * 3);
    }
    const starGeometry = new BufferGeometry();
    starGeometry.setAttribute("position", new BufferAttribute(positions, 3));
    const stars = new PointsNodeMaterial({ color: 0xf4f1ff, transparent: true, depthWrite: false });
    stars.fog = false;
    stars.opacityNode = this.starOpacity;
    const starPoints = new Points(starGeometry, stars);
    starPoints.renderOrder = -9;
    starPoints.frustumCulled = false;

    // The moon, lit by the real sun: its phase is simply what the sun lights of it, with a faint earthshine on the rest.
    const moonMaterial = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    moonMaterial.fog = false;
    const sunlit = smoothstep(-0.06, 0.14, dot(normalWorld, this.sunDir));
    moonMaterial.colorNode = mix(this.zenith.mul(1.6).add(0.04), new Color(0xf6f2e4), sunlit);
    moonMaterial.opacityNode = this.moonOpacity.mul(sunlit.mul(0.85).add(0.15));
    this.moon = new Mesh(new IcosahedronGeometry(22, 2), moonMaterial);
    this.moon.renderOrder = -8;
    this.moon.frustumCulled = false;

    this.materials.push(dome, stars, moonMaterial);
    this.group.add(sky, starPoints, this.moon);
  }

  /** Takes the sky's colours, the sun and moon (world frame, z up), and the weather on it. */
  set(s: Sky): void {
    // As deep as the fog (scene.ts HAZE), so the land melts into the sky with no seam.
    this.zenith.value.setHex(s.zenith).multiplyScalar(0.88);
    this.horizon.value.setHex(s.horizon).multiplyScalar(0.8);
    this.glowColor.value.setHex(s.sunGlow).multiplyScalar(0.8);
    // Scene axes: (x, z, −y).
    this.sunDir.value.set(s.sun[0], s.sun[2], -s.sun[1]);
    this.sunColor.value.setHex(s.light);
    this.sunUp.value = (s.lightFromSun ? Math.min(1, s.sun[2] * 6 + 0.25) : Math.max(0, s.sun[2] * 4 + 0.3)) * (1 - s.cloud * 0.6);
    this.golden.value = Math.min(1, s.golden * 1.4);
    this.starOpacity.value = s.stars;
    // The moon: up at night (in its phase), a pale ghost by day, hidden by thick cloud and below the horizon.
    this.moonOpacity.value = Math.min(1, Math.max(s.night * 1.2, 0.3)) * s.moonUp * (1 - s.cloud * 0.85);
    this.moon.position.set(s.moon[0] * RADIUS * 0.85, s.moon[2] * RADIUS * 0.85, -s.moon[1] * RADIUS * 0.85);
    this.moon.visible = this.moonOpacity.value > 0.003;
    // Clouds: a bright soft grey lit by the day, darker under rain, deep blue-grey at night.
    this.cloud.value = s.cloud;
    this.cloudLit.value.setHex(s.horizon).lerp(this.sunColor.value, 0.25).multiplyScalar(0.92);
    this.cloudShade.value.copy(this.cloudLit.value).multiplyScalar(0.72 - s.cloud * 0.12);
    this.mist.value = s.mist;
    this.mistColor.value.setHex(s.horizon).lerp(this.glowColor.value, 0.25).multiplyScalar(0.9);
  }

  /** Keeps the dome centred on the camera. */
  follow(camera: Vector3): void {
    this.group.position.copy(camera);
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof Mesh || o instanceof Points) o.geometry.dispose();
    });
    for (const m of this.materials) m.dispose();
  }
}
