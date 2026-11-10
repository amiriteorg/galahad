import { abs, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, cross, float, hash, instanceIndex, length, mod, normalize, smoothstep, uniform, uv, varying, vec2, vec3, vec4 } from "three/tsl";
import { Color, InstancedMesh, MeshBasicNodeMaterial, PlaneGeometry, type Scene } from "three/webgpu";
import { weatherUniforms } from "./wet.ts";

/*
 * Rain: thin streaks falling round the camera, every one placed and moved in the
 * vertex shader from its instance number (a hash: no buffers, no per-frame
 * uploads), wrapped in a box that rides with the camera so the drops stay put in
 * the world as you move. The count drawn follows the rain (the instance count,
 * set on the CPU), and the tier caps it. Under reduced motion the drops hang
 * still and faint.
 */

/** The box of rain round the camera (metres): wide enough to fill the view near by, the haze does the rest. */
const BOX = vec3(30, 22, 30);
const HALF = vec3(15, 11, 15);
/** Rain is pale whatever the light: the streaks lean this way. */
const PALE = new Color(0.85, 0.88, 0.95);

export class Rain {
  private readonly mesh: InstancedMesh;
  private readonly material: MeshBasicNodeMaterial;
  private readonly strength = uniform(0);
  private readonly wind = uniform(vec2(1.2, 0.5));
  private readonly color = uniform(new Color(0.8, 0.84, 0.92));
  private visible = 0;

  constructor(
    scene: Scene,
    private readonly capacity: number,
  ) {
    const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    m.fog = false;
    const id = instanceIndex;
    const seed = vec4(hash(id), hash(id.add(7919)), hash(id.add(15485)), hash(id.add(32452)));
    const speed = float(8.5).add(seed.w.mul(3));
    const t = weatherUniforms.time;
    const start = seed.xyz.mul(BOX);
    const moved = start.add(vec3(this.wind.x.mul(t), speed.mul(t).negate(), this.wind.y.mul(t)));
    // Wrapped round the camera: each drop stays where it is in the world until it leaves the box.
    const rel = mod(moved.sub(cameraPosition).add(HALF), BOX).sub(HALF);
    const centre = cameraPosition.add(rel);
    const along = normalize(vec3(this.wind.x, speed.negate(), this.wind.y));
    const side = normalize(cross(along, normalize(cameraPosition.sub(centre))));
    // A streak about as long as a drop falls in a 30th of a second, and a couple of centimetres wide.
    const length_ = speed.mul(0.05);
    const corner = side.mul(uv().x.sub(0.5).mul(0.022)).add(along.mul(uv().y.sub(0.5).mul(length_)));
    m.vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(centre.add(corner), 1)));
    // Faded right at the camera (no smears across the lens) and out into the haze.
    const d = length(rel);
    const fade = varying(smoothstep(1.2, 3, d).mul(float(1).sub(smoothstep(9, 15, d))));
    const across = float(1).sub(abs(uv().x.sub(0.5)).mul(2));
    const head = smoothstep(0, 0.65, uv().y);
    m.colorNode = this.color;
    m.opacityNode = across.mul(head).mul(fade).mul(this.strength);
    this.material = m;
    this.mesh = new InstancedMesh(new PlaneGeometry(1, 1), m, Math.max(1, capacity));
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    scene.add(this.mesh);
  }

  /**
   * How hard it rains (0..1), the sky's light (sRGB: the streaks catch it), and
   * whether things may move. Only the instance count and uniforms change.
   */
  set(rain: number, light: number, night: number, motion: boolean): void {
    const n = Math.round(this.capacity * Math.min(1, rain * 1.1) * (motion ? 1 : 0.5));
    if (n !== this.visible) {
      this.visible = n;
      this.mesh.count = Math.max(1, n);
      this.mesh.visible = n > 0;
    }
    this.color.value.setHex(light).lerp(PALE, 0.6);
    this.strength.value = (0.3 + 0.25 * rain) * (1 - night * 0.55) * (motion ? 1 : 0.6);
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.dispose();
    this.material.dispose();
  }
}
