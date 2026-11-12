import { attribute, cos, float, fract, hash, instanceIndex, mix, positionGeometry, sin, smoothstep, uniform, varying, vec3 } from "three/tsl";
import { BufferAttribute, BufferGeometry, DoubleSide, type Group, InstancedBufferAttribute, InstancedMesh, MeshLambertNodeMaterial, Vector3 } from "three/webgpu";
import { air } from "./air.ts";
import { TREE_SOLIDS } from "./flora-plan.ts";
import { seasonShown } from "./flora-shade.ts";
import { GROW, TINT } from "./flora-season.ts";
import { seasonState } from "./season.ts";
import { STRIDE, type ChunkSamples } from "./terrain.ts";

/*
 * Leaves coming down in the autumn wind: a few hundred at most, each let go
 * from the crown of one of the deciduous trees nearest the focus, tumbling down
 * and downwind to the ground, then let go again. One instanced mesh, placed and
 * moved in the vertex shader from each leaf's number and its tree (an instanced
 * attribute written only when the focus has moved or the land has changed: a
 * few kilobytes); nothing is uploaded per frame but a clock. How many fall
 * follows the season (none while the crowns are full or bare, most as they
 * thin) and the wind; under reduced motion, none.
 */

/** The trees whose leaves fall (TREE_KINDS: not the pine, not the spruce). */
const DECIDUOUS = [true, false, true, true, true, true, false, true, true];
/** Trees this near the focus shed into the air (metres), and at most this many of them. */
const REACH = 46;
const TREES = 28;

export class LeafFall {
  /** The trees round the focus have changed: gather them again. */
  stale = true;
  private readonly mesh: InstancedMesh | null = null;
  private readonly source: InstancedBufferAttribute | null = null;
  private readonly clock = uniform(0);
  /** The wind's speed as the leaves feel it (m/s). */
  private readonly drift = uniform(3);
  /** The trees shedding now: x, y, the ground under them, how high their crowns stand; a slot's x is NaN while it's free. */
  private readonly slots = new Float64Array(TREES * 4).fill(Number.NaN);
  private readonly kept = new Uint8Array(TREES);
  private readonly near = new Float64Array(TREES * 5);
  private falling = 0;

  constructor(
    root: Group,
    private readonly cap: number,
  ) {
    if (cap <= 0) return;
    // A leaf: a little kite.
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array([-0.09, 0, 0, 0, 0, 0.045, 0.09, 0, 0, -0.09, 0, 0, 0.09, 0, 0, 0, 0, -0.045]), 3));
    g.setAttribute("normal", new BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
    this.source = new InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    g.setAttribute("source", this.source);
    const mat = new MeshLambertNodeMaterial({ side: DoubleSide });
    const id = instanceIndex;
    const h1 = hash(id);
    const h2 = hash(id.add(7919));
    const h3 = hash(id.add(15485));
    const h4 = hash(id.add(32452));
    const src = attribute("source", "vec4");
    // Each leaf on its own clock: let go, six to ten seconds down, and again.
    const life = fract(this.clock.mul(h1.mul(0.07).add(0.1)).add(h2));
    const height = src.w;
    const spread = height.mul(0.36);
    const from = vec3(src.x.add(h3.sub(0.5).mul(spread).mul(2)), src.y.add(height.mul(h4.mul(0.4).add(0.5))), src.z.add(h1.sub(0.5).mul(spread).mul(2)));
    // Down to the ground, slowing as it sideslips; carried downwind all the way, swinging from side to side.
    const fallen = life.mul(life.mul(-0.35).add(1.35));
    const y = mix(from.y, src.y.add(0.05), fallen);
    const carried = this.drift.mul(life).mul(h2.mul(0.5).add(0.6));
    const swing = sin(life.mul(h3.mul(9).add(11)).add(h4.mul(6.3))).mul(0.45);
    const centre = vec3(from.x.add(air.wind.x.mul(carried)).sub(air.wind.y.mul(swing)), y, from.z.add(air.wind.y.mul(carried)).add(air.wind.x.mul(swing)));
    // Tumbling: the kite turns about its own length and swings round.
    const roll = life.mul(h1.mul(20).add(14)).add(h3.mul(6.3));
    const yaw = life.mul(h4.mul(6).add(3)).add(h2.mul(6.3));
    const size = smoothstep(0, 0.05, life).mul(float(1).sub(smoothstep(0.93, 1, life))).mul(h4.mul(0.5).add(0.75));
    const px = positionGeometry.x.mul(size);
    const pz = positionGeometry.z.mul(size);
    const local = vec3(px.mul(cos(yaw)).sub(pz.mul(cos(roll)).mul(sin(yaw))), pz.mul(sin(roll)), px.mul(sin(yaw)).add(pz.mul(cos(roll)).mul(cos(yaw))));
    mat.positionNode = centre.add(local);
    // Gold, amber, coral: each leaf its own.
    const gold = vec3(0.89, 0.63, 0.14);
    const amber = vec3(0.87, 0.36, 0.11);
    const coral = vec3(0.81, 0.23, 0.15);
    mat.colorNode = varying(mix(mix(gold, amber, smoothstep(0.2, 0.6, h3)), coral, smoothstep(0.7, 0.95, h3)));
    this.mesh = new InstancedMesh(g, mat, cap);
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    root.add(this.mesh);
  }

  /**
   * How many leaves are in the air for the season as it's shown: none while the crowns are full, most as they thin,
   * none once they're bare; only in the autumn half of the year.
   */
  static share(leaf: number, turn: number, autumn: boolean): number {
    if (!autumn) return 0;
    const thinning = Math.min(1, Math.max(0, (1 - leaf) / 0.12)) * Math.min(1, Math.max(0, leaf / 0.12));
    return thinning * Math.min(1, turn * 1.5);
  }

  /** The deciduous trees nearest the focus, from the chunks grown (nearest first): their leaves are the ones in the air. */
  gather(order: readonly { chunk: { samples: ChunkSamples }; dist: number }[], focusX: number, focusY: number, anchorX: number, anchorY: number): void {
    this.stale = false;
    if (!this.mesh || !this.source) return;
    // The nearest TREES of them: x, y, ground, height, distance (kept in order as they're found).
    const near = this.near;
    let n = 0;
    for (let c = 0; c < order.length; c++) {
      const g = order[c]!;
      if (g.dist > REACH + 46) break;
      const trees = g.chunk.samples.layers.trees;
      if (!trees) continue;
      for (let i = 0; i < trees.length; i += STRIDE) {
        const kind = trees[i + 5]!;
        if (!DECIDUOUS[kind]) continue;
        const d = Math.hypot(trees[i]! - focusX, trees[i + 1]! - focusY);
        if (d > REACH || (n === TREES && d >= near[(TREES - 1) * 5 + 4]!)) continue;
        let k = n < TREES ? n++ : TREES - 1;
        while (k > 0 && near[(k - 1) * 5 + 4]! > d) {
          near.copyWithin(k * 5, (k - 1) * 5, k * 5);
          k--;
        }
        near[k * 5] = trees[i]!;
        near[k * 5 + 1] = trees[i + 1]!;
        near[k * 5 + 2] = trees[i + 2]!;
        near[k * 5 + 3] = TREE_SOLIDS[kind]!.top * trees[i + 3]! * 0.86;
        near[k * 5 + 4] = d;
      }
    }
    // A tree that's still among them keeps its slot (its leaves in the air stay its own); the rest are given out anew.
    const slots = this.slots;
    this.kept.fill(0);
    for (let s = 0; s < TREES; s++) {
      let found = false;
      for (let k = 0; k < n && !found; k++) {
        if (near[k * 5] === slots[s * 4] && near[k * 5 + 1] === slots[s * 4 + 1]) {
          found = true;
          near[k * 5 + 4] = -1;
        }
      }
      if (found) this.kept[s] = 1;
    }
    let next = 0;
    let filled = 0;
    for (let s = 0; s < TREES; s++) {
      if (!this.kept[s]) {
        while (next < n && near[next * 5 + 4] === -1) next++;
        if (next < n) {
          slots.set(near.subarray(next * 5, next * 5 + 4), s * 4);
          next++;
        } else slots[s * 4] = Number.NaN;
      }
      if (!Number.isNaN(slots[s * 4]!)) filled++;
    }
    const a = this.source.array as Float32Array;
    for (let i = 0; i < this.cap; i++) {
      // Each leaf belongs to a slot; one whose slot is empty waits under the ground.
      const s = i % TREES;
      const empty = Number.isNaN(slots[s * 4]!);
      a[i * 4] = empty ? 0 : slots[s * 4]! - anchorX;
      a[i * 4 + 1] = empty ? -1e4 : slots[s * 4 + 2]!;
      a[i * 4 + 2] = empty ? 0 : -(slots[s * 4 + 1]! - anchorY);
      a[i * 4 + 3] = empty ? 0 : slots[s * 4 + 3]!;
    }
    this.source.needsUpdate = true;
    this.trees = filled;
  }

  private trees = 0;

  /** A frame: the leaves' clock moves on (not under reduced motion), and as many fall as the season and the wind let go. */
  animate(dt: number, speed: number, motion: boolean): void {
    if (!this.mesh) return;
    const season = LeafFall.share(seasonShown.grow[GROW.leaf]!, seasonShown.tint[TINT.leaf]!, seasonState.year > 0.5);
    const want = motion && this.trees > 0 ? Math.round(this.cap * season * (0.35 + 0.65 * Math.min(1, speed / 8))) : 0;
    // (Eased, so leaves begin and stop a few at a time.)
    this.falling += (want - this.falling) * Math.min(1, dt * 1.5);
    const count = Math.min(this.cap, Math.round(this.falling));
    this.mesh.count = count;
    this.mesh.visible = count > 0;
    if (count > 0) {
      this.clock.value = (this.clock.value + dt) % 3600;
      this.drift.value = 0.8 + speed * 0.5;
    }
  }

  /** How many leaves are in the air now (for the stats and the tests). */
  get count(): number {
    return this.mesh?.count ?? 0;
  }

  place(anchorX: number, anchorY: number): void {
    if (!this.mesh) return;
    this.mesh.position.copy(v.set(anchorX, 0, -anchorY));
    this.mesh.updateMatrix();
  }

  dispose(): void {
    if (!this.mesh) return;
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshLambertNodeMaterial).dispose();
    this.mesh.dispose();
  }
}

const v = new Vector3();
