import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { ao } from "three/addons/tsl/display/GTAONode.js";
import { radialBlur } from "three/addons/tsl/display/radialBlur.js";
import { float, int, length, mix, pass, rtt, select, smoothstep, uniform, uv, vec2, vec4 } from "three/tsl";
import { Color, type Node, type PerspectiveCamera, RenderPipeline, type Scene, Vector2, Vector3, type WebGPURenderer } from "three/webgpu";

/*
 * The light's finish on the high tier (WebGPU): what browsers have instead of
 * ray tracing (WebGPU exposes none), through three's render pipeline. Ground-truth
 * ambient occlusion (GTAO, at 0.4 resolution) darkens creases and contacts; sun
 * shafts (the sky round the sun, blurred towards it at 0.4 resolution) fall
 * through trees, mist and rain; a soft bloom lifts lamps, glows and the sun. The
 * scene pass keeps the canvas's multisampling, so edges stay as clean as before.
 * Each effect can be shed (the governor drops them first when frames run slow);
 * with none left the renderer draws straight to the canvas again. Phones and the
 * WebGL2 fallback never build this.
 */

export interface PostFlags {
  ao: boolean;
  shafts: boolean;
  bloom: boolean;
}

export const anyPost = (f: PostFlags): boolean => f.ao || f.shafts || f.bloom;

export class Post {
  private readonly pipeline: RenderPipeline;
  private readonly sunUv = uniform(new Vector2(0.5, 0.5));
  private readonly aspect = uniform(1);
  private readonly shaftStrength = uniform(0);
  private readonly shaftColor = uniform(new Color(1, 0.9, 0.75));
  private readonly bloomStrength = uniform(0.15);
  private flags: PostFlags = { ao: false, shafts: false, bloom: false };
  private scenePass: ReturnType<typeof pass> | null = null;
  private readonly projected = new Vector3();
  private readonly forward = new Vector3();

  constructor(
    renderer: WebGPURenderer,
    private readonly scene: Scene,
    private readonly camera: PerspectiveCamera,
    flags: PostFlags,
  ) {
    this.pipeline = new RenderPipeline(renderer);
    this.set(flags);
  }

  /** Whether anything is on (otherwise draw straight to the canvas). */
  get active(): boolean {
    return anyPost(this.flags);
  }

  /** Turns effects on or off; the pipeline is rebuilt only when they change. */
  set(flags: PostFlags): void {
    if (flags.ao === this.flags.ao && flags.shafts === this.flags.shafts && flags.bloom === this.flags.bloom) return;
    this.flags = { ...flags };
    if (!this.active) return;
    const scenePass = pass(this.scene, this.camera);
    this.scenePass = scenePass;
    const color = scenePass.getTextureNode("output");
    const depth = scenePass.getTextureNode("depth");
    let out = color.rgb;
    if (flags.ao) {
      // Normals rebuilt from depth (faceted anyway): no second render target, no normal pass.
      const occlusion = ao(depth, null as unknown as Node, this.camera);
      // Measured: 6 samples at 0.4 resolution look the same here as 12 at half, for a third of the cost.
      occlusion.resolutionScale = 0.4;
      occlusion.radius.value = 0.9;
      occlusion.thickness.value = 1.6;
      occlusion.distanceFallOff.value = 0.6;
      occlusion.samples.value = 6;
      out = out.mul(mix(float(1), occlusion.getTextureNode().r, 0.6));
    }
    if (flags.shafts) {
      // What shines: the open sky (nothing drawn in front of it) near the sun, as the sun sees it.
      const reversed = (this.pipeline.renderer as { reversedDepthBuffer?: boolean }).reversedDepthBuffer === true;
      const open = select(reversed ? depth.r.lessThanEqual(0) : depth.r.greaterThanEqual(1), float(1), float(0));
      const fromSun = length(uv().sub(this.sunUv).mul(vec2(this.aspect, 1)));
      const near = float(1).sub(smoothstep(0.05, 0.55, fromSun));
      const mask = rtt(vec4(color.rgb.mul(open).mul(near), 1), null, null, { resolutionScale: 0.4 });
      const shafts = rtt(radialBlur(mask, { center: this.sunUv, weight: float(0.85), decay: float(0.95), count: int(24), exposure: float(2.6) }), null, null, { resolutionScale: 0.4 });
      out = out.add(shafts.rgb.mul(this.shaftColor).mul(this.shaftStrength));
    }
    if (flags.bloom) {
      const glow = bloom(color, 1, 0.4, 0.95);
      out = out.add(glow.rgb.mul(this.bloomStrength));
    }
    this.pipeline.outputNode = vec4(out, 1);
    this.pipeline.needsUpdate = true;
  }

  /**
   * The sun this frame (world frame, z up) and how strongly its shafts show:
   * strongest low in a misty or rainy sky, gone when it's down, behind clouds or
   * behind the camera.
   */
  update(sun: readonly [number, number, number], strength: number, color: number, aspect: number): void {
    if (!this.flags.shafts) return;
    // A point far along the sun's direction, projected (scene axes: x, z up as y, −y as z).
    this.camera.getWorldDirection(this.forward);
    this.projected.set(sun[0], sun[2], -sun[1]);
    const facing = this.forward.dot(this.projected);
    this.projected.multiplyScalar(1000).add(this.camera.position).project(this.camera);
    this.sunUv.value.set((this.projected.x + 1) / 2, (1 - this.projected.y) / 2);
    // Fades as the sun leaves the view, and is nothing behind the camera.
    const off = Math.max(Math.abs(this.projected.x), Math.abs(this.projected.y));
    const inView = Math.max(0, Math.min(1, (1.6 - off) / 0.6)) * Math.max(0, Math.min(1, (facing - 0.1) / 0.3));
    this.shaftStrength.value = strength * inView;
    this.shaftColor.value.setHex(color);
    this.aspect.value = aspect;
  }

  /**
   * Compiles every material for the scene pass's own render target (call after
   * one render, which sizes it), so nothing compiles mid-flight later.
   */
  async compile(): Promise<void> {
    const target = this.scenePass?.renderTarget;
    if (!target) return;
    const renderer = this.pipeline.renderer;
    const before = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    try {
      await renderer.compileAsync(this.scene, this.camera);
    } finally {
      renderer.setRenderTarget(before);
    }
  }

  /** Draws the frame through the pipeline. */
  render(): void {
    this.pipeline.render();
  }

  dispose(): void {
    this.pipeline.dispose();
  }
}
