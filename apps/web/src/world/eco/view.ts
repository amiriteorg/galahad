import { abs, attribute, cos, float, max, mix, modelWorldMatrix, positionGeometry, sin, smoothstep, step, time, uniform, vec3, vec4 } from "three/tsl";
import { AdditiveBlending, type BufferGeometry, DoubleSide, type Group, InstancedBufferAttribute, InstancedMesh, MeshBasicNodeMaterial, MeshLambertNodeMaterial, type Node, OctahedronGeometry, type Vector3 } from "three/webgpu";
import { waterUniforms } from "../land.ts";
import * as models from "./models.ts";
import { type Batch, M_FIREFLY, M_FISH, M_INSECT, M_RING, MESHES, type MeshName } from "./pose.ts";

/*
 * The ecosystem on the GPU: one instanced mesh a kind (one draw call each, and
 * none at all while nobody of that kind is in sight), their instances written
 * by pose.ts straight into the attributes' own arrays. The vertex shader does
 * the moving: each part of a body turned about its hinge by its instance's
 * four numbers (models.ts), then the whole body leaned, turned to face its way
 * and set in its place. No bones, no matrices on the CPU.
 *
 * Four materials for everything: the animals (lit, flat-shaded: faceted, never
 * smooth), the insects (their own colour, by the day's light), what's on the
 * water (the fish's shadows and the rings, riding its waves), and the
 * fireflies' light.
 */

type Vec3Node = Node<"vec3">;
type FloatNode = Node<"float">;
type Vec4Node = Node<"vec4">;

/** A point turned about the x axis by `a` (its nose down for a positive turn). */
const aboutX = (p: Vec3Node, a: FloatNode): Vec3Node => {
  const c = cos(a);
  const s = sin(a);
  return vec3(p.x, p.y.mul(c).sub(p.z.mul(s)), p.y.mul(s).add(p.z.mul(c)));
};
const aboutY = (p: Vec3Node, a: FloatNode): Vec3Node => {
  const c = cos(a);
  const s = sin(a);
  return vec3(p.x.mul(c).add(p.z.mul(s)), p.y, p.z.mul(c).sub(p.x.mul(s)));
};
const aboutZ = (p: Vec3Node, a: FloatNode): Vec3Node => {
  const c = cos(a);
  const s = sin(a);
  return vec3(p.x.mul(c).sub(p.y.mul(s)), p.x.mul(s).add(p.y.mul(c)), p.z);
};

// An instance's numbers (pose.ts): typed here once, the typings don't carry an attribute's type through.
const spot = attribute("spot", "vec4") as unknown as Vec4Node;
const lean = attribute("lean", "vec4") as unknown as Vec4Node;
const anim = attribute("anim", "vec4") as unknown as Vec4Node;
const look = attribute("look", "vec4") as unknown as Vec4Node;

/** A body's vertex in the world: scaled, banked, nose up, turned to face its way, and set in its place. */
const set = (p: Vec3Node): Vec3Node => aboutY(aboutX(aboutZ(p.mul(vec3(lean.z, lean.w, lean.z)), lean.y.negate()), lean.x.negate()), spot.w).add(spot.xyz);

/** A vertex of a rigged model, moved by its part's hinge and its instance's numbers (models.ts). */
function rigged(): Vec3Node {
  const pivot = attribute("pivot", "vec3") as unknown as Vec3Node;
  const rigA = attribute("rigA", "vec4") as unknown as Vec4Node;
  const rigB = attribute("rigB", "vec3") as unknown as Vec3Node;
  const beat = sin(anim.x.add(rigA.y)).mul(anim.y);
  const turnX = rigA.x.mul(beat).add(rigA.z.mul(anim.z)).add(rigA.w.mul(anim.w));
  const turnZ = rigB.x.mul(beat);
  const turnY = rigB.y.mul(anim.w);
  const d = aboutY(aboutZ(aboutX(positionGeometry.sub(pivot), turnX), turnZ), turnY);
  // Parts only some of a kind have fold away to their hinge (nothing is drawn of them).
  const flag = step(0.5, look.w);
  const shown = float(1).sub(abs(rigB.z).mul(float(1).sub(mix(float(1).sub(flag), flag, step(0, rigB.z)))));
  return pivot.add(d.mul(shown));
}

export class EcoView {
  /** What pose.ts writes into: each mesh's own attribute arrays. */
  readonly batches: Batch[];
  private readonly meshes: InstancedMesh[] = [];
  private readonly attributes: InstancedBufferAttribute[][] = [];
  private readonly materials: (MeshLambertNodeMaterial | MeshBasicNodeMaterial)[] = [];
  /** The day's light on the insects (they aren't lit by the sun's lamp: too small to shade), 0..1. */
  private readonly daylight = uniform(1);

  /** `room`: the most instances each mesh will hold (0: that mesh isn't made at all). */
  constructor(root: Group, room: Record<MeshName, number>, shadows: boolean) {
    // ---- the animals: lit and faceted ----
    const animal = new MeshLambertNodeMaterial({ vertexColors: true, flatShading: true, side: DoubleSide });
    animal.positionNode = set(rigged());
    // (The material multiplies by the vertex colour itself: this is only each one's own tint.)
    animal.colorNode = look.xyz;
    // ---- the insects: their own colours, by the day's light ----
    const insect = new MeshBasicNodeMaterial({ vertexColors: true, side: DoubleSide });
    insect.positionNode = set(rigged());
    insect.colorNode = look.xyz.mul(this.daylight);
    // ---- on the water: the fish's shadows and the rings ----
    const water = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: DoubleSide });
    {
      // The tail's third wags (a fish only: a ring has no wag in it).
      const wag = sin(anim.x.add(positionGeometry.z.mul(9))).mul(anim.y).mul(0.05).mul(smoothstep(0.08, -0.26, positionGeometry.z));
      const flat = set(vec3(positionGeometry.x.add(wag), positionGeometry.y, positionGeometry.z));
      // It rides the water's own waves (land.ts' swells), unless it's in the air (a leap).
      const world = modelWorldMatrix.mul(vec4(flat, 1));
      const t = time.mul(waterUniforms.waves);
      const wave = sin(world.x.mul(0.31).add(t.mul(1.1)))
        .mul(0.05)
        .add(sin(world.z.mul(0.23).sub(t.mul(0.8)).add(world.x.mul(0.07))).mul(0.045))
        .add(sin(world.x.mul(0.9).add(world.z.mul(0.7)).add(t.mul(1.9))).mul(0.018));
      water.positionNode = flat.add(vec3(0, wave.mul(float(1).sub(anim.w)).mul(waterUniforms.waves), 0));
      // Dark under the water; silver in the air, white as a ring.
      water.colorNode = mix(vec3(0.03, 0.09, 0.1), vec3(0.86, 0.9, 0.93), look.w).mul(max(this.daylight, 0.35));
      water.opacityNode = anim.z;
    }
    // ---- the fireflies' light ----
    const glow = new MeshBasicNodeMaterial({ color: 0xe6ff7a, transparent: true, depthWrite: false, blending: AdditiveBlending });
    glow.fog = false;
    glow.positionNode = set(positionGeometry);
    glow.opacityNode = anim.z;
    this.materials.push(animal, insect, water, glow);

    const geometry: Record<MeshName, () => BufferGeometry> = {
      roe: models.roe,
      hare: models.hare,
      fox: models.fox,
      hedgehog: models.hedgehog,
      squirrel: models.squirrel,
      mallard: models.mallard,
      swan: models.swan,
      heron: models.heron,
      bird: models.bird,
      swallow: models.swallow,
      goose: models.goose,
      kestrel: models.kestrel,
      owl: models.owl,
      bat: models.bat,
      fish: models.fishShadow,
      ring: models.ring,
      insect: models.insect,
      firefly: () => new OctahedronGeometry(0.085, 0),
    };
    this.batches = MESHES.map((name, m) => {
      const n = Math.max(0, Math.floor(room[name]));
      const material = m === M_FISH || m === M_RING ? water : m === M_INSECT ? insect : m === M_FIREFLY ? glow : animal;
      // (A kind this device doesn't draw gets a batch of one that's never filled, and no mesh.)
      const g = n ? geometry[name]() : null;
      const attributes = (["spot", "lean", "anim", "look"] as const).map((key) => {
        // (Static usage on purpose, as the plants': only the range that was written is uploaded.)
        const a = new InstancedBufferAttribute(new Float32Array(Math.max(1, n) * 4), 4);
        g?.setAttribute(key, a);
        return a;
      });
      this.attributes.push(attributes);
      if (g) {
        const mesh = new InstancedMesh(g, material, n);
        mesh.count = 0;
        mesh.visible = false;
        mesh.frustumCulled = false;
        // (What walks and what perches throws a shadow where the tier has them; not what's a flicker in the air.)
        mesh.castShadow = shadows && material === animal;
        mesh.renderOrder = m === M_FISH || m === M_RING ? 2 : 0;
        root.add(mesh);
        this.meshes[m] = mesh;
      }
      return { spot: attributes[0]!.array as Float32Array, lean: attributes[1]!.array as Float32Array, anim: attributes[2]!.array as Float32Array, look: attributes[3]!.array as Float32Array, room: n, count: 0 };
    });
  }

  /** After pose.ts has written: each mesh draws what it was given (and isn't drawn at all with nothing). `light` 0 night to 1 day. */
  commit(light: number): void {
    this.daylight.value = 0.2 + 0.8 * light;
    for (let m = 0; m < this.batches.length; m++) {
      const mesh = this.meshes[m];
      if (!mesh) continue;
      const n = this.batches[m]!.count;
      mesh.count = n;
      mesh.visible = n > 0;
      if (!n) continue;
      const attributes = this.attributes[m]!;
      for (let a = 0; a < attributes.length; a++) {
        // Only what was written goes to the GPU.
        attributes[a]!.clearUpdateRanges();
        attributes[a]!.addUpdateRange(0, n * 4);
        attributes[a]!.needsUpdate = true;
      }
    }
  }

  /** How many draw calls it's making now, and how many triangles (for the stats and the tour). */
  stats(out: { calls: number; triangles: number }): void {
    out.calls = 0;
    out.triangles = 0;
    for (const mesh of this.meshes) {
      if (!mesh?.visible) continue;
      out.calls++;
      out.triangles += (mesh.geometry.getAttribute("position").count / 3) * mesh.count;
    }
  }

  /** The meshes sit at the floating origin (their instances are relative to it). */
  place(originScene: Vector3): void {
    for (const mesh of this.meshes) mesh?.position.copy(originScene);
  }

  dispose(): void {
    for (const mesh of this.meshes) {
      if (!mesh) continue;
      mesh.removeFromParent();
      mesh.geometry.dispose();
      mesh.dispose();
    }
    for (const material of this.materials) material.dispose();
  }
}
