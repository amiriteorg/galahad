import { acos, float, mix, normalize, positionLocal, smoothstep, uniform, vec3 } from "three/tsl";
import { AdditiveBlending, BufferAttribute, BufferGeometry, DoubleSide, Mesh, MeshBasicNodeMaterial, type Node, Quaternion, Vector3 } from "three/webgpu";
import { RAINBOW } from "./optics.ts";

/*
 * The rainbow: exactly where it must be. A band of a sphere round the camera
 * whose axis points away from the sun, from 38° to 56° off that axis, so the
 * first bow lies 42° and the second 51° from the point opposite the sun,
 * whatever the view (optics.ts has the angles and when it shows). It hangs
 * half a kilometre off, in the rain: in front of the far hills and the sky,
 * behind the keep and the trees, its feet coming down into the haze over the
 * land. Light added to what's behind it; drawn only while there is one.
 */

type F = Node<"float">;

const RAD = Math.PI / 180;
/** How far off it hangs (metres): beyond the land that's drawn, before the nearest of the far hills. */
const DISTANCE = 560;
const INNER = 38 * RAD;
const OUTER = 56 * RAD;

/** The spectrum, red (0) to violet (1), pastel as the world is (linear light). */
const SPECTRUM: readonly (readonly [number, number, number])[] = [
  [1, 0.22, 0.2],
  [1, 0.55, 0.16],
  [1, 0.9, 0.3],
  [0.32, 0.9, 0.42],
  [0.25, 0.6, 1],
  [0.56, 0.36, 1],
];

export class Rainbow {
  readonly mesh: Mesh;
  private readonly strength = uniform(0);
  private readonly material: MeshBasicNodeMaterial;
  private readonly axis = new Vector3();
  private readonly up = new Vector3(0, 1, 0);
  private readonly turn = new Quaternion();

  constructor() {
    // The band: rings of the sphere about its y axis, a strip between each pair.
    const segments = 96;
    const rings = 4;
    const positions: number[] = [];
    const index: number[] = [];
    for (let r = 0; r <= rings; r++) {
      const a = INNER + ((OUTER - INNER) * r) / rings;
      for (let s = 0; s <= segments; s++) {
        const b = (s / segments) * 2 * Math.PI;
        positions.push(Math.sin(a) * Math.cos(b) * DISTANCE, Math.cos(a) * DISTANCE, Math.sin(a) * Math.sin(b) * DISTANCE);
      }
    }
    for (let r = 0; r < rings; r++) {
      for (let s = 0; s < segments; s++) {
        const i = r * (segments + 1) + s;
        index.push(i, i + 1, i + segments + 1, i + 1, i + segments + 2, i + segments + 1);
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
    geometry.setIndex(index);

    const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide });
    m.fog = false;
    // The angle from the point opposite the sun, degrees; then the bows across it (optics.ts' rainbowAt).
    const angle = acos(normalize(positionLocal).y.clamp(-1, 1)).mul(180 / Math.PI) as unknown as F;
    const band = (t: F): F => smoothstep(0, 0.22, t).mul(float(1).sub(smoothstep(0.78, 1, t))) as unknown as F;
    const p = angle.sub(RAINBOW.inner).div(RAINBOW.outer - RAINBOW.inner) as unknown as F;
    const s = angle.sub(RAINBOW.secondInner).div(RAINBOW.secondOuter - RAINBOW.secondInner) as unknown as F;
    const first = band(p);
    const second = band(s).mul(RAINBOW.second);
    // Red outside the first bow, inside the second.
    const hue = mix(s.clamp(0, 1), float(1).sub(p.clamp(0, 1)), smoothstep(0, 0.02, first));
    let colour = vec3(...SPECTRUM[0]!) as unknown as Node<"vec3">;
    for (let i = 1; i < SPECTRUM.length; i++) {
      const at = (i - 0.5) / (SPECTRUM.length - 1);
      colour = mix(colour, vec3(...SPECTRUM[i]!), smoothstep(at - 0.1, at + 0.1, hue)) as unknown as Node<"vec3">;
    }
    // Inside the first bow the sky is a breath brighter.
    const inside = float(1).sub(smoothstep(RAINBOW.inner - 2.2, RAINBOW.inner + 0.3, angle)).mul(0.035);
    m.colorNode = colour.mul(first.add(second)).add(vec3(inside)).mul(this.strength);
    this.material = m;
    this.mesh = new Mesh(geometry, m);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    // Over the sky and the far hills, after them.
    this.mesh.renderOrder = 52;
  }

  /** How strongly it shows (0: none, and it isn't drawn), and where the sun is (a unit vector, scene axes). */
  set(strength: number, sun: Vector3): void {
    this.strength.value = strength * 0.42;
    this.mesh.visible = strength > 0.01;
    if (!this.mesh.visible) return;
    // Its axis points away from the sun.
    this.axis.copy(sun).negate().normalize();
    this.mesh.quaternion.copy(this.turn.setFromUnitVectors(this.up, this.axis));
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
