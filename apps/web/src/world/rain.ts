import { abs, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, cameraWorldMatrix, cross, float, hash, instanceIndex, length, mix, mod, normalize, sin, smoothstep, step, uniform, uv, varying, vec2, vec3, vec4 } from "three/tsl";
import { Color, InstancedMesh, MeshBasicNodeMaterial, type Node, PlaneGeometry, type Scene, Vector2 } from "three/webgpu";
import { wind as windWay } from "./air.ts";
import { HALL, HALL_EAVES } from "./hall-plan.ts";
import { originUniform } from "./plots.ts";
import { weatherUniforms } from "./wet.ts";

/*
 * Rain and snow in the air: streaks and flakes, every one placed and moved in
 * the vertex shader from its instance number (a hash: no buffers, no per-frame
 * uploads). Each lives in one of three boxes that ride ahead of the camera,
 * a small one near, a wider one behind it and a wide one far off, and is drawn
 * thicker and fainter the farther its box: so the fall has depth, from single
 * drops at arm's length to a grey veil over the meadow, for the same count as
 * one box had. Each stays put in the world until it leaves its box (the boxes
 * wrap), so nothing swims as the view turns. The wind leans the rain and carries
 * the snow; flakes flutter as they fall. The count drawn follows the weather
 * (the instance count, set on the CPU), and the tier caps it. Lightning lights
 * the rain. Under reduced motion drops and flakes hang still and faint. None
 * falls inside the workshop hall: a drop over its floor and under its roof is
 * folded to nothing in the vertex shader (four compares a vertex).
 */

type F = Node<"float">;
type V3 = Node<"vec3">;

/** Rain is pale whatever the light: the streaks lean this way. */
const PALE = new Color(0.85, 0.88, 0.95);
const WHITE = new Color(0.96, 0.97, 1);

/** The workshop hall's footprint (world x, y and half-sizes, metres) and how high its roof stands above its floor. */
const HALL_BOX = vec4(HALL.x, HALL.y, HALL.hx, HALL.hy);
const HALL_ROOF = HALL_EAVES + 4;

/** The three boxes (metres): near, middle, far. A drop's box is drawn from its instance number: five in eight near, a quarter in the middle, an eighth far. */
const NEAR = vec3(14, 12, 14);
const MID = vec3(34, 20, 34);
const FAR = vec3(84, 34, 84);

interface Layered {
  /** The centre of the drop or flake, world. */
  centre: V3;
  /** 0 or 1: in the middle box, in the far box. */
  mid: F;
  far: F;
  /** Fades at the box's faces (where it wraps) and right at the camera. */
  fade: F;
  /** 0 under the hall's roof (nothing falls there), else 1: a size multiplies by it. */
  open: F;
  seed: Node<"vec4">;
}

/** Places instance `id` in its box ahead of the camera, moved by `travel` (metres, world) since the clock began. */
function layered(travel: (seed: Node<"vec4">) => V3, hallFloor: F): Layered {
  const id = instanceIndex;
  const seed = vec4(hash(id), hash(id.add(7919)), hash(id.add(15485)), hash(id.add(32452)));
  const pick = hash(id.add(49157));
  const far = step(pick, 0.125) as unknown as F;
  const mid = step(pick, 0.375).sub(far) as unknown as F;
  const box = NEAR.add(MID.sub(NEAR).mul(mid)).add(FAR.sub(NEAR).mul(far));
  const half = box.mul(0.5);
  // The box rides ahead of the camera along the ground, so most of it is in view.
  const forward = cameraWorldMatrix.mul(vec4(0, 0, -1, 0)).xyz;
  const ahead = normalize(vec3(forward.x, 0, forward.z).add(vec3(1e-4, 0, 0)));
  const middle = cameraPosition.add(ahead.mul(box.x.mul(0.4)));
  const moved = seed.xyz.mul(box).add(travel(seed));
  // Wrapped round the box's middle: each stays where it is in the world until it leaves the box.
  const rel = mod(moved.sub(middle).add(half), box).sub(half);
  const centre = middle.add(rel) as unknown as V3;
  const edge = abs(rel).div(half);
  const inBox = float(1).sub(smoothstep(0.72, 1, edge.x)).mul(float(1).sub(smoothstep(0.72, 1, edge.y))).mul(float(1).sub(smoothstep(0.72, 1, edge.z)));
  // Faded right at the camera (no smears across the lens).
  const fade = inBox.mul(smoothstep(0.8, 2.4, length(centre.sub(cameraPosition)))) as unknown as F;
  // Under the hall's roof: world (x, y) is scene (x, −z) plus the floating origin.
  const inside = step(abs(centre.x.add(originUniform.x).sub(HALL_BOX.x)), HALL_BOX.z)
    .mul(step(abs(centre.z.negate().add(originUniform.y).sub(HALL_BOX.y)), HALL_BOX.w))
    .mul(step(centre.y, hallFloor.add(HALL_ROOF)));
  return { centre, mid, far, fade, open: float(1).sub(inside) as unknown as F, seed };
}

export class Rain {
  private readonly streaks: InstancedMesh;
  private readonly flakes: InstancedMesh;
  private readonly materials: MeshBasicNodeMaterial[] = [];
  private readonly strength = uniform(0);
  private readonly snowStrength = uniform(0);
  /** The wind on the rain, metres a second (scene x, z), and how far it has carried the drops and the flakes. */
  private readonly lean = uniform(new Vector2(1.2, 0.5));
  private readonly carried = uniform(new Vector2(0, 0));
  private readonly blown = uniform(new Vector2(0, 0));
  private readonly color = uniform(new Color(0.8, 0.84, 0.92));
  private readonly snowColor = uniform(new Color(0.95, 0.96, 1));
  /** The hall's floor (scene y, metres). */
  private readonly hallFloor = uniform(0);
  private drops = 0;
  private flakeCount = 0;

  constructor(
    scene: Scene,
    private readonly capacity: number,
  ) {
    const t = weatherUniforms.time;
    const flash = float(1).add(weatherUniforms.flash.mul(2.2));

    // ---- rain: streaks along the way they fall ----
    {
      const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
      m.fog = false;
      let speed: F = float(0) as unknown as F;
      const at = layered((seed) => {
        speed = float(8.5).add(seed.w.mul(3)) as unknown as F;
        return vec3(this.carried.x, speed.mul(t).negate(), this.carried.y) as unknown as V3;
      }, this.hallFloor as unknown as F);
      const along = normalize(vec3(this.lean.x, speed.negate(), this.lean.y));
      const side = normalize(cross(along, normalize(cameraPosition.sub(at.centre))));
      // A streak about as long as a drop falls in a 25th of a second; thicker and longer the farther its box, so it still shows.
      const width = float(0.013).add(at.mid.mul(0.017)).add(at.far.mul(0.065)).mul(at.open);
      const reach = speed.mul(float(0.03).add(at.mid.mul(0.03)).add(at.far.mul(0.09)));
      const corner = side.mul(uv().x.sub(0.5).mul(width)).add(along.mul(uv().y.sub(0.5).mul(reach)));
      m.vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(at.centre.add(corner), 1)));
      const fade = varying(at.fade.mul(float(1).sub(at.mid.mul(0.45)).sub(at.far.mul(0.72))));
      const across = float(1).sub(abs(uv().x.sub(0.5)).mul(2));
      const head = smoothstep(0, 0.65, uv().y);
      m.colorNode = this.color.mul(flash);
      m.opacityNode = across.mul(head).mul(fade).mul(this.strength);
      this.materials.push(m);
      this.streaks = new InstancedMesh(new PlaneGeometry(1, 1), m, Math.max(1, capacity));
    }

    // ---- snow: soft flakes that face the camera, fluttering as they fall ----
    {
      const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
      m.fog = false;
      const at = layered((seed) => {
        const fall = float(1.1).add(seed.w.mul(0.8));
        // A flutter of a few hand-widths, each flake on its own clock and bearing.
        const sway = sin(t.mul(seed.x.mul(0.9).add(0.7)).add(seed.y.mul(40))).mul(0.22);
        const turn = seed.z.mul(6.283);
        return vec3(this.blown.x.add(sin(turn).mul(sway)), fall.mul(t).negate(), this.blown.y.add(sin(turn.add(1.571)).mul(sway))) as unknown as V3;
      }, this.hallFloor as unknown as F);
      const size = float(0.032).add(at.seed.x.mul(0.02)).add(at.mid.mul(0.045)).add(at.far.mul(0.13)).mul(at.open);
      const eye = cameraViewMatrix.mul(vec4(at.centre, 1));
      m.vertexNode = cameraProjectionMatrix.mul(vec4(eye.xy.add(uv().sub(0.5).mul(size)), eye.z, 1));
      const fade = varying(at.fade.mul(float(1).sub(at.mid.mul(0.35)).sub(at.far.mul(0.62))));
      const round = float(1).sub(smoothstep(0.25, 1, length(uv().sub(0.5)).mul(2)));
      m.colorNode = this.snowColor.mul(flash);
      m.opacityNode = round.mul(fade).mul(this.snowStrength);
      this.materials.push(m);
      this.flakes = new InstancedMesh(new PlaneGeometry(1, 1), m, Math.max(1, capacity));
    }

    for (const mesh of [this.streaks, this.flakes]) {
      mesh.count = 0;
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 4;
      scene.add(mesh);
    }
  }

  /**
   * How hard it rains and snows (0..1 each), the sky's light (sRGB: the streaks
   * and flakes catch it), the night, the wind (metres a second) and whether
   * things may move. Only instance counts and uniforms change.
   */
  set(rain: number, snow: number, light: number, night: number, wind: number, motion: boolean): void {
    const still = motion ? 1 : 0.5;
    const n = Math.round(this.capacity * Math.min(1, rain * 1.1) * still);
    if (n !== this.drops) {
      this.drops = n;
      this.streaks.count = Math.max(1, n);
      this.streaks.visible = n > 0;
    }
    const f = Math.round(this.capacity * Math.min(1, snow * 1.2) * still);
    if (f !== this.flakeCount) {
      this.flakeCount = f;
      this.flakes.count = Math.max(1, f);
      this.flakes.visible = f > 0;
    }
    this.color.value.setHex(light).lerp(PALE, 0.6);
    this.strength.value = (0.26 + 0.2 * rain) * (1 - night * 0.62) * (motion ? 1 : 0.6);
    this.snowColor.value.setHex(light).lerp(WHITE, 0.75).multiplyScalar(1 - night * 0.45);
    this.snowStrength.value = (0.7 + 0.25 * snow) * (motion ? 1 : 0.7);
    // The rain leans with the wind (a gale lays it nearly flat, so not all the way).
    const lean = Math.min(wind, 16) * 0.75;
    this.lean.value.set(windWay.x * lean, windWay.z * lean);
  }

  /** The workshop hall's floor height (metres): no rain or snow falls under its roof. */
  setHallFloor(height: number): void {
    this.hallFloor.value = height;
  }

  /** Carries the drops and the flakes with the wind (metres a second) for `dt` seconds. Call only while something falls and may move. */
  blow(dt: number, wind: number): void {
    const lean = this.lean.value;
    // (Wrapped at a whole number of every box: no jump, and the GPU's floats stay precise.)
    const wrap = 14 * 17 * 6;
    const c = this.carried.value;
    c.set((c.x + lean.x * dt) % wrap, (c.y + lean.y * dt) % wrap);
    if (this.flakeCount > 0) {
      const b = this.blown.value;
      const s = Math.min(wind, 12) * 0.85 * dt;
      b.set((b.x + windWay.x * s) % wrap, (b.y + windWay.z * s) % wrap);
    }
  }

  dispose(): void {
    for (const mesh of [this.streaks, this.flakes]) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      mesh.dispose();
    }
    for (const m of this.materials) m.dispose();
  }
}
