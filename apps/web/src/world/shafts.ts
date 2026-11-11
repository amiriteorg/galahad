import { dot, exp, float, Fn, getViewPosition, interleavedGradientNoise, length, lightShadowMatrix, Loop, max, min, rtt, screenCoordinate, smoothstep, step, texture, uniform, uv, vec2, vec4 } from "three/tsl";
import { type DirectionalLight, type Node, type PerspectiveCamera, type Texture, Vector2, Vector3 } from "three/webgpu";
import { WATER_LEVEL } from "./terrain.ts";

/*
 * Light in the air (the high tier): for every pixel, a march from the camera
 * towards what it sees, asking the sun's shadow map at each step whether that
 * point of air is lit. Lit air scatters the light towards the eye (more where
 * mist lies, more when looking towards the sun); shadowed air doesn't. So shafts
 * stand between the trees, under the keep's deck and through its railings,
 * wherever the light really falls, whether or not the sun is on screen, and
 * nothing streaks across the ground.
 *
 * At half resolution, 20 steps a pixel, each started at a different depth by a
 * fixed screen pattern (interleaved gradient noise: no flicker), then blurred
 * across neighbours of like depth, which turns the pattern into smooth light.
 * Only inside the shadow map's box (faded at its sides), so it ends softly.
 */

const STEPS = 20;
const SCALE = 0.5;

export interface ShaftAir {
  /** Mist: its density at the water, the sheet's on the ground, and the level the sheet lies on (the atmosphere's own uniforms). */
  mist: Node;
  sheet: Node;
  sheetLevel: Node;
}

export class SunShafts {
  /** How far from the camera the march goes (metres): to the far side of the shadow map's box. */
  readonly range = uniform(60);
  /** Thin air's own scattering, per metre (mist adds to it). */
  readonly haze = uniform(0.0025);
  /** Where the light comes from (scene axes, unit). */
  readonly lightDir = uniform(new Vector3(0, 1, 0));
  private readonly eye = uniform(new Vector3());
  private readonly texel = uniform(new Vector2(1 / 640, 1 / 400));
  /** The shafts: a texture node whose red channel is the light scattered towards the eye. */
  readonly node: Node;

  constructor(depth: Node, camera: PerspectiveCamera, light: DirectionalLight, air: ShaftAir) {
    const projectionInverse = uniform(camera.projectionMatrixInverse);
    const cameraWorld = uniform(camera.matrixWorld);
    const marched = rtt(
      Fn(() => {
        const map = light.shadow.map?.depthTexture as Texture | undefined;
        if (!map) return vec4(0, 1, 0, 1);
        const shadowMatrix = lightShadowMatrix(light);
        const d = (depth as unknown as { sample(uv: Node): { r: Node } }).sample(uv()).r;
        const seen = cameraWorld.mul(vec4(getViewPosition(uv(), d, projectionInverse), 1)).xyz;
        const ray = seen.sub(this.eye);
        const far = length(ray);
        const dir = ray.div(max(far, 1e-3));
        const reach = min(far, this.range);
        const stride = reach.div(STEPS);
        const jitter = interleavedGradientNoise(screenCoordinate);
        const sum = float(0).toVar();
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
          // The air there: thin haze, the mist above the water, the sheet on the ground.
          const density = this.haze
            .add((air.mist as unknown as ReturnType<typeof float>).mul(1.5).mul(exp(p.y.sub(WATER_LEVEL).max(-1.5).mul(-1 / 1.7))))
            .add((air.sheet as unknown as ReturnType<typeof float>).mul(1.5).mul(exp(p.y.sub(air.sheetLevel as unknown as ReturnType<typeof float>).max(-0.35).mul(-1 / 0.6))));
          sum.addAssign(lit.mul(inside).mul(density));
        });
        // What the lit air along the ray scatters: never more than all of the light (1 − e^−depth).
        const scattered = float(1).sub(exp(sum.mul(stride).negate()));
        // Towards the light the air scatters far more (a broad lobe and a tight one); 0.25 to the side, 1 straight at it.
        const f = max(dot(dir, this.lightDir), 0);
        const f2 = f.mul(f);
        const f4 = f2.mul(f2);
        const phase = float(0.25).add(f2.mul(0.35)).add(f4.mul(f4).mul(0.4));
        // Red: the light. Green: how far the pixel is, for the blur to keep to surfaces of like depth.
        return vec4(scattered.mul(phase), reach.div(this.range), 0, 1);
      })(),
      null,
      null,
      { resolutionScale: SCALE },
    );
    const blur = (source: Node, x: number, y: number) =>
      rtt(
        Fn(() => {
          const tex = source as unknown as { sample(uv: Node): Node<"vec4"> };
          const here = tex.sample(uv());
          const sum = float(0).toVar();
          const weights = float(0).toVar();
          for (let k = -3; k <= 3; k++) {
            const tap = k === 0 ? here : tex.sample(uv().add(this.texel.mul(vec2(x * k * 1.5, y * k * 1.5))));
            const w = exp(tap.g.sub(here.g).abs().mul(-40)).mul(Math.exp(-(k * k) / 6));
            sum.addAssign(tap.r.mul(w));
            weights.addAssign(w);
          }
          return vec4(sum.div(weights), here.g, 0, 1);
        })(),
        null,
        null,
        { resolutionScale: SCALE },
      );
    this.node = blur(blur(marched, 1, 0), 0, 1);
  }

  /** The camera this frame, the shafts' reach, and the drawing buffer's size (pixels). */
  update(camera: PerspectiveCamera, range: number, width: number, height: number): void {
    this.eye.value.setFromMatrixPosition(camera.matrixWorld);
    this.range.value = range;
    this.texel.value.set(1 / Math.max(1, Math.floor(width * SCALE)), 1 / Math.max(1, Math.floor(height * SCALE)));
  }
}
