import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { ao } from "three/addons/tsl/display/GTAONode.js";
import { float, mix, pass, uniform, vec4 } from "three/tsl";
import { Color, type DirectionalLight, type Node, type PerspectiveCamera, RenderPipeline, type Scene, Vector2, type Vector3, type WebGPURenderer } from "three/webgpu";
import { type ShaftAir, SunShafts } from "./shafts.ts";

/*
 * The light's finish on the high tier (WebGPU): what browsers have instead of
 * ray tracing (WebGPU exposes none), through three's render pipeline. Ground-truth
 * ambient occlusion (GTAO, at 0.4 resolution) darkens creases and contacts; the
 * sun's (or the moon's) light is marched through its shadow map at half
 * resolution, so shafts of lit air stand between the trees and under the keep,
 * in mist and rain (shafts.ts); a soft bloom lifts lamps, glows, the sun and
 * lightning. The scene pass keeps the canvas's multisampling, so edges stay as
 * clean as before. Each effect can be shed (the governor drops them first when
 * frames run slow); with none left the renderer draws straight to the canvas
 * again. Phones and the WebGL2 fallback never build this.
 */

export interface PostFlags {
  ao: boolean;
  shafts: boolean;
  bloom: boolean;
}

export const anyPost = (f: PostFlags): boolean => f.ao || f.shafts || f.bloom;

export class Post {
  private readonly pipeline: RenderPipeline;
  private readonly shaftStrength = uniform(0);
  private readonly shaftColor = uniform(new Color(1, 0.9, 0.75));
  private readonly bloomStrength = uniform(0.15);
  private flags: PostFlags = { ao: false, shafts: false, bloom: false };
  private scenePass: ReturnType<typeof pass> | null = null;
  private shafts: SunShafts | null = null;
  private readonly size = new Vector2();

  constructor(
    renderer: WebGPURenderer,
    private readonly scene: Scene,
    private readonly camera: PerspectiveCamera,
    flags: PostFlags,
    /** The sun (its shadow map is what the shafts are marched through) and the air's mist. */
    private readonly light: DirectionalLight,
    private readonly air: ShaftAir,
  ) {
    this.pipeline = new RenderPipeline(renderer);
    this.set(flags);
  }

  /** Whether anything is on (otherwise draw straight to the canvas). */
  get active(): boolean {
    return anyPost(this.flags);
  }

  /** Whether the light shafts are on (the mist then leaves its sunlit share to them). */
  get shafted(): boolean {
    return this.flags.shafts;
  }

  /** Turns effects on or off; the pipeline is rebuilt only when they change. */
  set(flags: PostFlags): void {
    if (flags.ao === this.flags.ao && flags.shafts === this.flags.shafts && flags.bloom === this.flags.bloom) return;
    this.flags = { ...flags };
    this.shafts = null;
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
      // Lit air, marched through the sun's shadow map (it only shows where the light really falls).
      this.shafts = new SunShafts(depth, this.camera, this.light, this.air);
      const lit = (this.shafts.node as unknown as { r: ReturnType<typeof float> }).r;
      out = out.add(this.shaftColor.mul(lit.mul(this.shaftStrength)));
    }
    if (flags.bloom) {
      const glow = bloom(color, 1, 0.4, 0.95);
      out = out.add(glow.rgb.mul(this.bloomStrength));
    }
    this.pipeline.outputNode = vec4(out, 1);
    this.pipeline.needsUpdate = true;
  }

  /**
   * The light this frame: where it comes from (scene axes, unit), how strongly
   * its shafts show (low suns, mist and rain make them; cloud takes them away),
   * their colour (sRGB), how far from the camera the shadow map reaches, and
   * how much the clear air itself scatters, per metre (rain and snow add to it).
   */
  update(lightDir: Vector3, strength: number, color: number, range: number, haze: number): void {
    const shafts = this.shafts;
    if (!shafts) return;
    this.pipeline.renderer.getDrawingBufferSize(this.size);
    shafts.update(this.camera, range, this.size.x, this.size.y);
    shafts.lightDir.value.copy(lightDir);
    shafts.haze.value = haze;
    this.shaftStrength.value = strength;
    this.shaftColor.value.setHex(color);
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
