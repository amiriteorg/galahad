import { cameraProjectionMatrix, float, instancedBufferAttribute, length, mix, modelViewMatrix, positionGeometry, sin, smoothstep, time, uniform, uv, varying, vec3, vec4 } from "three/tsl";
import { AdditiveBlending, type Group, InstancedBufferAttribute, InstancedMesh, MeshBasicNodeMaterial, PlaneGeometry } from "three/webgpu";
import { linear } from "./mesher.ts";

/*
 * Warm glows round lamps, lanterns and lit windows after dark: one instanced
 * quad per light, turned to face the camera in the vertex shader, a soft round
 * falloff added onto what's behind it. One draw call for all of them, and they
 * fade in with the evening. The lights stay where they were put (scene
 * coordinates under the world root): the keep's, the plots', the landmarks'.
 */

/** Beyond this a glow is as it was put (metres from the eye); within `GLOW_NEAR.from` it's at its smallest and softest. */
export const GLOW_NEAR = { from: 0.6, to: 6, size: 0.3, light: 0.35, before: 0.12 } as const;

/** How near the eye a glow is, 0 (at `from` or nearer) to 1 (at `to` or beyond), eased. */
export function glowCloseness(distance: number): number {
  const t = Math.max(0, Math.min(1, (distance - GLOW_NEAR.from) / (GLOW_NEAR.to - GLOW_NEAR.from)));
  return t * t * (3 - 2 * t);
}

/** A glow's size and light for its distance from the eye, as shares of what it was given (the shader's own sums: `glowCloseness`). */
function glowNear(distance: ReturnType<typeof length>) {
  const closeness = smoothstep(GLOW_NEAR.from, GLOW_NEAR.to, distance);
  return { size: mix(float(GLOW_NEAR.size), float(1), closeness), light: mix(float(GLOW_NEAR.light), float(1), closeness), before: mix(float(GLOW_NEAR.before), float(0.35), closeness) };
}

export class Glows {
  private readonly mesh: InstancedMesh;
  private readonly at: InstancedBufferAttribute;
  private readonly tint: InstancedBufferAttribute;
  private readonly strength = uniform(0);
  private readonly material: MeshBasicNodeMaterial;
  private count = 0;
  private readonly keys = new Map<string, number[]>();

  constructor(
    root: Group,
    private readonly capacity: number,
  ) {
    this.at = new InstancedBufferAttribute(new Float32Array(Math.max(1, capacity) * 4), 4);
    this.tint = new InstancedBufferAttribute(new Float32Array(Math.max(1, capacity) * 3), 3);
    const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
    m.fog = false;
    // (The typings don't carry the attribute's type through; it is a vec4 and a vec3.)
    const at = instancedBufferAttribute(this.at, "vec4") as unknown as ReturnType<typeof vec4>;
    const tint = instancedBufferAttribute(this.tint, "vec3") as unknown as ReturnType<typeof vec3>;
    // Facing the camera: the corner offset is added in view space, a little towards the eye.
    const centre = modelViewMatrix.mul(vec4(at.xyz, 1));
    // Close to the eye a glow draws in round its lamp and softens (`glowNear` has the numbers): its size is a
    // world's, right from across the lawn, but from beside it (through his own eyes at his fire, his desk's
    // lantern, the library's lamp) a disc that size is the whole view, and everything in it washed out.
    const near = glowNear(length(centre.xyz));
    // (And it stands less far before its lamp: a third of a metre towards the eye is nothing from across the
    // lawn, and from a metre off puts the glow well to one side of what glows.)
    const corner = vec3(positionGeometry.xy.mul(at.w).mul(near.size), near.before);
    m.vertexNode = cameraProjectionMatrix.mul(vec4(centre.xyz.add(corner), 1));
    const r = length(uv().sub(0.5)).mul(2);
    const falloff = float(1).sub(smoothstep(0, 1, r)).pow(2.2);
    const flicker = sin(time.mul(7.3).add(at.x.mul(3.1))).mul(0.06).add(0.94);
    m.colorNode = tint.mul(falloff).mul(this.strength).mul(flicker).mul(varying(near.light));
    this.material = m;
    this.mesh = new InstancedMesh(new PlaneGeometry(2, 2), m, Math.max(1, capacity));
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    root.add(this.mesh);
  }

  /**
   * Sets a group of glows (a station's lamps, a plot's lamp) under `key`,
   * replacing what it had: [x, y, z, radius] each, scene coordinates, sRGB colour.
   */
  set(key: string, points: readonly (readonly [number, number, number, number])[], color: number): void {
    this.remove(key);
    const [r, g, b] = linear(color);
    const slots: number[] = [];
    for (const [x, y, z, radius] of points) {
      if (this.count >= this.capacity) break;
      const i = this.count++;
      this.at.setXYZW(i, x, y, z, radius);
      this.tint.setXYZ(i, r, g, b);
      slots.push(i);
    }
    this.keys.set(key, slots);
    this.at.needsUpdate = true;
    this.tint.needsUpdate = true;
    this.mesh.count = this.count;
  }

  /** Removes a group, compacting the rest (rare: a plot comes or goes). */
  remove(key: string): void {
    const slots = this.keys.get(key);
    if (!slots) return;
    this.keys.delete(key);
    const keep: [string, number[]][] = [];
    for (const [k, s] of this.keys) keep.push([k, s]);
    const at = this.at.array as Float32Array;
    const tint = this.tint.array as Float32Array;
    const oldAt = at.slice(0, this.count * 4);
    const oldTint = tint.slice(0, this.count * 3);
    this.count = 0;
    for (const [k, s] of keep) {
      const moved: number[] = [];
      for (const i of s) {
        at.set(oldAt.subarray(i * 4, i * 4 + 4), this.count * 4);
        tint.set(oldTint.subarray(i * 3, i * 3 + 3), this.count * 3);
        moved.push(this.count++);
      }
      this.keys.set(k, moved);
    }
    this.at.needsUpdate = true;
    this.tint.needsUpdate = true;
    this.mesh.count = this.count;
  }

  /** 0 by day, up to 1 at night. */
  setStrength(v: number): void {
    this.strength.value = v;
    this.mesh.visible = v > 0.01 && this.count > 0;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.dispose();
    this.material.dispose();
  }
}
