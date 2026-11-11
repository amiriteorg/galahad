import { dot, exp, float, floor, Fn, fract, getViewPosition, If, interleavedGradientNoise, length, lightShadowMatrix, Loop, max, min, rtt, screenCoordinate, smoothstep, step, texture, uniform, uv, vec2, vec4 } from "three/tsl";
import { type DirectionalLight, type Node, type PerspectiveCamera, type Texture, Vector2, Vector3 } from "three/webgpu";
import { WATER_LEVEL } from "./terrain.ts";

/*
 * Light in the air (the high tier): for every pixel, a march from the camera
 * towards what it sees, asking the sun's shadow map at each step whether that
 * point of air is lit. Lit air scatters the light towards the eye, shadowed air
 * doesn't, so shafts stand between the trees, under the keep's deck and through
 * its railings wherever the light really falls, whether or not the sun is on
 * screen, and nothing streaks across the ground. The air scatters forwards (a
 * phase peaked towards the light, next to nothing to the side and behind), so
 * the shafts glow when you look towards a low sun and stay out of the way
 * otherwise; mist and the sheet of it on the ground scatter far more than clear
 * air.
 *
 * At 0.4 resolution, 16 steps a pixel, each started at a different depth by a
 * fixed screen pattern (interleaved gradient noise: no flicker), then blurred
 * across neighbours of like depth, which turns the pattern into smooth light;
 * brought back to full resolution by the depth of each pixel (a joint bilateral
 * upsample), so silhouettes against the sky stay crisp. Only inside the shadow
 * map's box (faded at its sides), so it ends softly.
 */

const STEPS = 16;
const SCALE = 0.4;

export interface ShaftAir {
  /** Mist: its density at the water, the sheet's on the ground, and the level the sheet lies on (the atmosphere's own uniforms). */
  mist: Node;
  sheet: Node;
  sheetLevel: Node;
}

type F = Node<"float">;
type Tex = { sample(uv: Node): Node<"vec4"> };

export class SunShafts {
  /** How far from the camera the march goes (metres): to the far side of the shadow map's box. */
  readonly range = uniform(60);
  /** Clear air's own scattering, per metre (mist adds to it). */
  readonly haze = uniform(0.004);
  /** Where the light comes from (scene axes, unit). */
  readonly lightDir = uniform(new Vector3(0, 1, 0));
  /** 1 while the shafts have any strength (else the march is skipped: overcast, rain, a moonless night). */
  readonly active = uniform(1);
  private readonly eye = uniform(new Vector3());
  /** One texel of the low-resolution targets, in uv. */
  private readonly texel = uniform(new Vector2(1 / 640, 1 / 400));
  private readonly projectionInverse: Node;
  private readonly cameraWorld: Node;
  /**
   * The blurred shafts at low resolution: red, the light scattered towards the eye; green, how far the pixel
   * is (0..1 of the range); blue, the share of the near mist that lies in shadow.
   */
  private readonly blurred: Node;

  constructor(
    private readonly depth: Node,
    camera: PerspectiveCamera,
    light: DirectionalLight,
    air: ShaftAir,
  ) {
    this.projectionInverse = uniform(camera.projectionMatrixInverse) as unknown as Node;
    this.cameraWorld = uniform(camera.matrixWorld) as unknown as Node;
    const marched = rtt(
      Fn(() => {
        const map = light.shadow.map?.depthTexture as Texture | undefined;
        if (!map) return vec4(0, 1, 0, 1);
        const shadowMatrix = lightShadowMatrix(light);
        const { dir, far } = this.ray(uv());
        const reach = min(far, this.range);
        const stride = reach.div(STEPS);
        const jitter = interleavedGradientNoise(screenCoordinate);
        const sum = float(0).toVar();
        const mistAll = float(0).toVar();
        const mistLit = float(0).toVar();
        const mist = air.mist as unknown as F;
        const sheet = air.sheet as unknown as F;
        const sheetLevel = air.sheetLevel as unknown as F;
        If(this.active.greaterThan(0.5), () => {
        Loop(STEPS, ({ i }) => {
          const t = float(i).add(jitter).mul(stride);
          const p = this.eye.add(dir.mul(t));
          const c = shadowMatrix.mul(vec4(p, 1));
          const cx = c.x;
          const cy = c.y.oneMinus();
          // Inside the shadow map's box, fading towards its sides (outside it nothing is known, so nothing is added).
          const side = min(min(cx, cx.oneMinus()), min(cy, cy.oneMinus()));
          const inside = smoothstep(0, 0.1, side).mul(step(0, c.z)).mul(step(c.z, 1));
          const lit = texture(map, vec2(cx, cy)).compare(c.z);
          // The air there: thin haze, and the mist (as atmosphere.ts lays it: above the water, and the sheet on the ground).
          const misty = mist.mul(exp(p.y.sub(WATER_LEVEL).max(-1.5).mul(-1 / 1.7))).add(sheet.mul(exp(p.y.sub(sheetLevel).max(-0.35).mul(-1 / 0.6)))).mul(inside);
          sum.addAssign(lit.mul(inside).mul(this.haze).add(lit.mul(misty).mul(1.5)));
          mistAll.addAssign(misty);
          mistLit.addAssign(misty.mul(lit));
        });
        });
        // What the lit air along the ray scatters: never more than all of the light (1 − e^−depth).
        const scattered = float(1).sub(exp(sum.mul(stride).negate()));
        // How much of the mist's light the fog drew that the sun doesn't give (the mist in shadow): e^−lit − e^−all.
        const shaded = exp(mistLit.mul(stride).negate()).sub(exp(mistAll.mul(stride).negate()));
        // Forward scattering: a broad lobe and a tight one towards the light; a breath to the side, none behind.
        const f = max(dot(dir, this.lightDir), 0);
        const f2 = f.mul(f);
        const f4 = f2.mul(f2);
        const f8 = f4.mul(f4);
        const f32 = f8.mul(f8).mul(f8).mul(f8);
        const phase = float(0.04).add(f4.mul(0.5)).add(f32.mul(1.4));
        return vec4(scattered.mul(phase), reach.div(this.range), shaded, 1);
      })(),
      null,
      null,
      { resolutionScale: SCALE },
    );
    const blur = (source: Node, x: number, y: number) =>
      rtt(
        Fn(() => {
          const tex = source as unknown as Tex;
          const here = tex.sample(uv());
          const sum = vec2(0).toVar();
          const weights = float(0).toVar();
          for (let k = -3; k <= 3; k++) {
            const tap = k === 0 ? here : tex.sample(uv().add(this.texel.mul(vec2(x * k * 1.2, y * k * 1.2))));
            const w = exp(tap.g.sub(here.g).abs().mul(-40)).mul(Math.exp(-(k * k) / 6));
            sum.addAssign(tap.rb.mul(w));
            weights.addAssign(w);
          }
          const out = sum.div(weights);
          return vec4(out.x, here.g, out.y, 1);
        })(),
        null,
        null,
        { resolutionScale: SCALE },
      );
    this.blurred = blur(blur(marched, 1, 0), 0, 1);
  }

  /** The view ray through a screen point: its direction (world, unit) and how far the surface seen there is. */
  private ray(at: Node<"vec2">): { dir: Node<"vec3">; far: F } {
    const d = (this.depth as unknown as Tex).sample(at).r;
    const seen = (this.cameraWorld as unknown as { mul(v: Node): Node<"vec4"> }).mul(vec4(getViewPosition(at, d, this.projectionInverse as never), 1)).xyz;
    const ray = seen.sub(this.eye);
    const far = length(ray) as unknown as F;
    return { dir: ray.div(max(far, 1e-3)) as unknown as Node<"vec3">, far };
  }

  /**
   * The shafts at full resolution (x: the light they add; y: the share of the near mist in shadow): of the four low-resolution texels round
   * each pixel, those at its own depth count (a joint bilateral upsample), so
   * a branch against the sky doesn't take the sky's light, nor the sky the
   * branch's shadow.
   */
  light(): Node<"vec2"> {
    return Fn(() => {
      const tex = this.blurred as unknown as Tex;
      const { far } = this.ray(uv());
      const g = min(far, this.range).div(this.range);
      const p = uv().div(this.texel).sub(0.5);
      const base = floor(p);
      const w = fract(p);
      const sum = vec2(0).toVar();
      const weights = float(1e-4).toVar();
      for (const [ox, oy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
        const tap = tex.sample(base.add(vec2(ox + 0.5, oy + 0.5)).mul(this.texel));
        const bilinear = (ox ? w.x : w.x.oneMinus()).mul(oy ? w.y : w.y.oneMinus());
        const weight = bilinear.mul(exp(tap.g.sub(g).abs().mul(-60))).add(1e-5);
        sum.addAssign(tap.rb.mul(weight));
        weights.addAssign(weight);
      }
      return sum.div(weights);
    })() as unknown as Node<"vec2">;
  }

  /** The camera this frame, the shafts' reach, and the drawing buffer's size (pixels). */
  update(camera: PerspectiveCamera, range: number, width: number, height: number): void {
    this.eye.value.setFromMatrixPosition(camera.matrixWorld);
    this.range.value = range;
    this.texel.value.set(1 / Math.max(1, Math.floor(width * SCALE)), 1 / Math.max(1, Math.floor(height * SCALE)));
  }
}
