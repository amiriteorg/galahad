import { dot, max, mix, normalize, positionLocal, pow, smoothstep, uniform } from "three/tsl";
import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicNodeMaterial,
  Points,
  PointsNodeMaterial,
  SphereGeometry,
  Vector3,
} from "three/webgpu";
import type { Sky } from "./daynight.ts";
import { rng } from "./physics.ts";

/*
 * The sky: a dome drawn in the shader, pastel from horizon to zenith with a
 * bright sun and its glow; stars and a moon at night. It follows the camera, so
 * it's always at the horizon, and it ignores the fog (the fog is tinted to match
 * its horizon instead).
 */

const RADIUS = 900;

export class SkyDome {
  readonly group = new Group();
  private readonly zenith = uniform(new Color(0x86c1f2));
  private readonly horizon = uniform(new Color(0xe0f0f6));
  private readonly sunDir = uniform(new Vector3(0, 1, 0));
  private readonly sunColor = uniform(new Color(0xfff8ec));
  private readonly sunUp = uniform(1);
  private readonly starOpacity = uniform(0);
  private readonly moonOpacity = uniform(0);
  private readonly moon: Mesh;
  private readonly materials: (MeshBasicNodeMaterial | PointsNodeMaterial)[] = [];

  constructor(starCount: number) {
    const dome = new MeshBasicNodeMaterial({ side: BackSide, depthWrite: false });
    dome.fog = false;
    const dir = normalize(positionLocal);
    const base = mix(this.horizon, this.zenith, smoothstep(-0.02, 0.6, dir.y));
    const facing = max(dot(dir, this.sunDir), 0);
    const disc = smoothstep(0.9991, 0.9996, facing);
    const glow = pow(facing, 48).mul(0.55).add(pow(facing, 6).mul(0.16));
    dome.colorNode = base.add(this.sunColor.mul(disc.mul(2.2).add(glow)).mul(this.sunUp));
    const sky = new Mesh(new SphereGeometry(RADIUS, 32, 16), dome);
    sky.renderOrder = -10;
    sky.frustumCulled = false;

    const random = rng(7);
    const positions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const a = random() * Math.PI * 2;
      const y = 0.08 + random() * 0.92;
      const r = Math.sqrt(1 - y * y);
      positions.set([Math.cos(a) * r * RADIUS * 0.95, y * RADIUS * 0.95, Math.sin(a) * r * RADIUS * 0.95], i * 3);
    }
    const starGeometry = new BufferGeometry();
    starGeometry.setAttribute("position", new BufferAttribute(positions, 3));
    const stars = new PointsNodeMaterial({ color: 0xf4f1ff, transparent: true, depthWrite: false });
    stars.fog = false;
    stars.opacityNode = this.starOpacity;
    const starPoints = new Points(starGeometry, stars);
    starPoints.renderOrder = -9;
    starPoints.frustumCulled = false;

    const moonMaterial = new MeshBasicNodeMaterial({ color: 0xf2f0e6, transparent: true, depthWrite: false });
    moonMaterial.fog = false;
    moonMaterial.opacityNode = this.moonOpacity;
    this.moon = new Mesh(new IcosahedronGeometry(22, 2), moonMaterial);
    this.moon.renderOrder = -8;
    this.moon.frustumCulled = false;

    this.materials.push(dome, stars, moonMaterial);
    this.group.add(sky, starPoints, this.moon);
  }

  /** Takes the sky's colours and the sun and moon (world frame, z up). */
  set(s: Sky): void {
    this.zenith.value.setHex(s.zenith);
    this.horizon.value.setHex(s.horizon);
    // Scene axes: (x, z, −y).
    this.sunDir.value.set(s.sun[0], s.sun[2], -s.sun[1]);
    this.sunColor.value.setHex(s.light);
    this.sunUp.value = s.lightFromSun ? Math.min(1, s.sun[2] * 6 + 0.25) : Math.max(0, s.sun[2] * 4 + 0.3);
    this.starOpacity.value = s.stars;
    this.moonOpacity.value = Math.min(1, s.night * 1.2);
    this.moon.position.set(s.moon[0] * RADIUS * 0.85, s.moon[2] * RADIUS * 0.85, -s.moon[1] * RADIUS * 0.85);
  }

  /** Keeps the dome centred on the camera. */
  follow(camera: Vector3): void {
    this.group.position.copy(camera);
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof Mesh || o instanceof Points) o.geometry.dispose();
    });
    for (const m of this.materials) m.dispose();
  }
}
