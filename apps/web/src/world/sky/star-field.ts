import { abs, asin, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, cos, cross, dot, exp, float, hash, instancedBufferAttribute, instanceIndex, length, max, mix, normalize, select, sin, smoothstep, sqrt, time, uniform, uv, varying, vec2, vec3, vec4 } from "three/tsl";
import { AdditiveBlending, DoubleSide, InstancedBufferAttribute, InstancedMesh, MeshBasicNodeMaterial, type Node, PlaneGeometry, Vector3 } from "three/webgpu";
import { type Mat3, skyMatrix, type Vec3 } from "./celestial.ts";
import { sheetVeil } from "./cloud-field.ts";
import type { Meteors } from "./meteors.ts";
import { HEAVENS_FLOOR, HEAVENS_RISE, HEAVENS_TOP, seenDirection } from "./panorama.ts";
import { emptyPlanets, type Planet, planetsAt } from "./planets.ts";
import { STAR_COUNT, STAR_DATA } from "./stars-data.ts";
import { starBrightness, starColor, starSize, unpackStars } from "./stars.ts";

/*
 * The stars, the planets and a meteor's streak: one instanced quad a star,
 * placed in the vertex shader. Each star's place among the others is fixed (its
 * unit vector, J2000, from the table); one matrix turns them all to where they
 * stand over Copenhagen now (celestial.ts), and the panorama's squeeze
 * (panorama.ts) brings their heights into the strip of sky the camera sees. So
 * the sky turns round the pole star through the night and the seasons with one
 * uniform's upload a second, and nothing per star.
 *
 * Each comes out in the dusk when the sky is dark enough for one as bright (the
 * planets and the first stars early, the faint ones last, and on a midsummer
 * night never), twinkles more the lower it stands (the planets don't), dims
 * through the thick air at the horizon, and is hidden by the sheet of cloud and
 * the moon's disc; the low clouds and the far hills hide it by standing in
 * front. The four planets are four more instances whose places are worked out
 * again every minute. Brightest first, so a device that draws fewer simply
 * stops early. Drawn only at night: by day it costs nothing.
 */

type F = Node<"float">;
type V3 = Node<"vec3">;

/** How far out they are drawn (metres from the camera): beyond the low clouds, inside the sky's dome. */
const RADIUS = 1880;
/** A planet is a steady disc, a little larger than a star as bright. */
const PLANET_SIZE = 1.5;
/** The sun's depth (degrees below the horizon) at which a star of a magnitude is fully out, and how long it takes to come out. */
const outAt = (magnitude: number): number => Math.max(0, 5.5 + 1.6 * magnitude);
const COMING_OUT = 2.5;

/** A unit vector in the horizon's frame (x east, y north, z up) as the scene has it (x east, y up, z south), into `out`. */
function toScene(v: Readonly<Vec3>, out: Vector3): Vector3 {
  return out.set(v[0], v[2], -v[1]);
}

export class StarField {
  readonly mesh: InstancedMesh;
  readonly streak: InstancedMesh;
  /** The turning sky: the rows of the matrix from the equator's frame (J2000) to the horizon's (east, north, up). */
  private readonly east = uniform(new Vector3(1, 0, 0));
  private readonly north = uniform(new Vector3(0, 1, 0));
  private readonly upward = uniform(new Vector3(0, 0, 1));
  /** The drawn height of the zenith (radians): the top of the strip the panorama fills (it follows the view's). */
  private readonly top = uniform(HEAVENS_TOP);
  /** How far the sun is below the horizon (degrees), and how clear the air is of mist and falling rain (0..1). */
  private readonly sunDepth = uniform(0);
  private readonly clear = uniform(1);
  /** 1 while things may move (the stars twinkle), else 0. */
  private readonly lively = uniform(1);
  /** The moon as drawn (scene axes), and the cosine of its disc's radius (it hides the stars behind it); −2: no moon. */
  private readonly moonDir = uniform(new Vector3(0, 1, 0));
  private readonly moonCos = uniform(2);
  /** The meteor: where its streak begins and ends as drawn (scene axes), how far along it is (0..1), and how bright. */
  private readonly meteorFrom = uniform(new Vector3(0, 1, 0));
  private readonly meteorTo = uniform(new Vector3(0, 1, 0));
  private readonly meteorAt = uniform(0);
  private readonly meteorBright = uniform(0);
  private readonly places: InstancedBufferAttribute;
  private readonly looks: InstancedBufferAttribute;
  private readonly materials: MeshBasicNodeMaterial[] = [];
  private readonly matrix: Mat3 = new Float64Array(9);
  private readonly planets: Planet[] = emptyPlanets();
  private readonly count: number;
  private placedAt = Number.NEGATIVE_INFINITY;
  private planetsAt = Number.NEGATIVE_INFINITY;
  private readonly scratch: Vec3 = [0, 0, 0];
  private readonly tint: Vec3 = [0, 0, 0];

  /** `limit`: how many stars at most (the brightest). */
  constructor(limit: number) {
    const table = unpackStars(STAR_DATA, STAR_COUNT);
    const stars = Math.max(1, Math.min(limit, table.count));
    this.count = stars + this.planets.length;
    // A star: its place (xyz) and how bright it's drawn (w); its colour (rgb) and the sun's depth it comes out at (a);
    // its size and how much it twinkles.
    const places = new Float32Array(this.count * 4);
    const looks = new Float32Array(this.count * 4);
    const shapes = new Float32Array(this.count * 2);
    for (let i = 0; i < stars; i++) {
      places.set(table.dir.subarray(i * 3, i * 3 + 3), i * 4);
      places[i * 4 + 3] = starBrightness(table.mag[i]!);
      starColor(table.color[i]!, this.tint);
      looks.set(this.tint, i * 4);
      looks[i * 4 + 3] = outAt(table.mag[i]!);
      shapes[i * 2] = starSize(table.mag[i]!);
      shapes[i * 2 + 1] = 1;
    }
    // The planets, after the stars: placed in `place()`.
    for (let p = 0; p < this.planets.length; p++) {
      const i = stars + p;
      places[i * 4 + 2] = -1;
      shapes[i * 2] = starSize(-2) * PLANET_SIZE;
      shapes[i * 2 + 1] = 0;
    }
    this.places = new InstancedBufferAttribute(places, 4);
    this.looks = new InstancedBufferAttribute(looks, 4);
    const shape = new InstancedBufferAttribute(shapes, 2);

    // (Either side: the quads are turned to the camera in the shader, whichever way that winds them.)
    const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide });
    m.fog = false;
    const place = instancedBufferAttribute(this.places, "vec4") as unknown as ReturnType<typeof vec4>;
    const look = instancedBufferAttribute(this.looks, "vec4") as unknown as ReturnType<typeof vec4>;
    const form = instancedBufferAttribute(shape, "vec2") as unknown as ReturnType<typeof vec2>;
    // Over the horizon now: east, north, up.
    const e = dot(this.east, place.xyz);
    const nn = dot(this.north, place.xyz);
    const u = dot(this.upward, place.xyz).clamp(-1, 1);
    const real = asin(u);
    // The panorama's squeeze (panorama.ts' seenElevation), bearing kept.
    const seen = select(u.greaterThan(0), float(HEAVENS_FLOOR).mul(float(1).sub(exp(real.div(-HEAVENS_RISE)))).add(u.mul(this.top.sub(HEAVENS_FLOOR))), real);
    const flat = vec2(e, nn).div(max(length(vec2(e, nn)), 1e-5));
    const cs = cos(seen);
    const dir = vec3(flat.x.mul(cs), sin(seen), flat.y.mul(cs).negate()) as unknown as V3;
    const size = form.x.mul(RADIUS);
    const right = normalize(cross(vec3(0, 1, 0), dir));
    const upright = cross(dir, right);
    const corner = right.mul(uv().x.sub(0.5).mul(2)).add(upright.mul(uv().y.sub(0.5).mul(2))).mul(size);
    m.vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(cameraPosition.add(dir.mul(RADIUS)).add(corner), 1)));
    // Out when the sky is dark enough for one this bright; dimmer through the thick air low down; hidden under the
    // sheet of cloud and behind the moon.
    const out = smoothstep(look.w.sub(COMING_OUT), look.w, this.sunDepth);
    const through = smoothstep(0.004, 0.1, u).mul(0.75).add(0.25).mul(smoothstep(-0.005, 0.012, u));
    const veiled = float(1).sub(sheetVeil(dir));
    const moonless = float(1).sub(smoothstep(this.moonCos.sub(0.00012), this.moonCos, dot(dir, this.moonDir)));
    // Twinkling: each on its own clock, more the lower it stands; the planets hold steady.
    const h = hash(instanceIndex);
    const depth = float(0.36).sub(smoothstep(0.1, 0.8, u).mul(0.24)).mul(form.y).mul(this.lively);
    const twinkle = sin(time.mul(h.mul(3.4).add(1.7)).add(h.mul(90))).mul(depth).add(float(1).sub(depth.mul(0.5)));
    const shine = varying(place.w.mul(out).mul(through).mul(veiled).mul(moonless).mul(twinkle).mul(this.clear), "starShine") as unknown as F;
    const tint = varying(look.xyz, "starTint") as unknown as V3;
    // A small hard glint with four short points: crisp, as everything here is.
    const q = abs(uv().sub(0.5).mul(2));
    const core = float(1).sub(smoothstep(0.3, 0.8, length(q)));
    const points = max(float(1).sub(q.x.add(q.y.mul(4))), 0).add(max(float(1).sub(q.y.add(q.x.mul(4))), 0)).mul(0.5);
    m.colorNode = tint.mul(core.add(points).mul(shine).mul(2.9));
    this.materials.push(m);
    this.mesh = new InstancedMesh(new PlaneGeometry(1, 1), m, this.count);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    // After the sky's dome (they shine on it), still behind the far hills and the low clouds (by depth).
    this.mesh.renderOrder = 51;

    // ---- a meteor: a thin streak along its path, bright at its head, fading behind ----
    {
      const sm = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide });
      sm.fog = false;
      // Along the quad (uv.y): from the tail (0) to the head (1), which is `meteorAt` of the way along the path.
      const tail = float(0.34);
      const along = max(this.meteorAt.sub(float(1).sub(uv().y).mul(tail)), 0).min(1);
      const on = normalize(mix(this.meteorFrom, this.meteorTo, along));
      const way = normalize(this.meteorTo.sub(this.meteorFrom));
      const side = normalize(cross(way, on));
      const width = float(RADIUS * 0.0009).mul(uv().y.mul(0.7).add(0.3));
      sm.vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(cameraPosition.add(on.mul(RADIUS)).add(side.mul(uv().x.sub(0.5).mul(2)).mul(width)), 1)));
      const across = float(1).sub(abs(uv().x.sub(0.5)).mul(2));
      // It flares up as it starts and dies as it ends.
      const life = smoothstep(0, 0.12, this.meteorAt).mul(float(1).sub(smoothstep(0.82, 1, this.meteorAt)));
      const glow = across.mul(across).mul(uv().y.mul(uv().y)).mul(life).mul(this.meteorBright).mul(sqrt(max(on.y, 0).mul(8)).min(1));
      sm.colorNode = vec3(0.86, 0.95, 1).mul(glow.mul(1.5));
      this.materials.push(sm);
      this.streak = new InstancedMesh(new PlaneGeometry(1, 1, 1, 6), sm, 1);
      this.streak.frustumCulled = false;
      this.streak.visible = false;
      this.streak.renderOrder = 51;
    }
  }

  /**
   * The sky at a UTC instant: the stars turned to where they stand now (once a
   * second is plenty: they move a quarter of a degree a minute) and the planets
   * placed among them (once a minute).
   */
  place(now: number): void {
    if (Math.abs(now - this.placedAt) < 1000) return;
    this.placedAt = now;
    const m = skyMatrix(now, this.matrix);
    this.east.value.set(m[0]!, m[1]!, m[2]!);
    this.north.value.set(m[3]!, m[4]!, m[5]!);
    this.upward.value.set(m[6]!, m[7]!, m[8]!);
    if (Math.abs(now - this.planetsAt) < 60_000) return;
    this.planetsAt = now;
    planetsAt(now, this.planets);
    const places = this.places.array as Float32Array;
    const looks = this.looks.array as Float32Array;
    const first = this.count - this.planets.length;
    for (let p = 0; p < this.planets.length; p++) {
      const planet = this.planets[p]!;
      const i = (first + p) * 4;
      places[i] = planet.place[0];
      places[i + 1] = planet.place[1];
      places[i + 2] = planet.place[2];
      places[i + 3] = Math.min(1.25, starBrightness(planet.magnitude) * 1.25);
      // Venus and Jupiter cream, Mars orange, Saturn pale gold.
      starColor(planet.name === "Mars" ? 1.35 : planet.name === "Saturn" ? 0.85 : 0.5, this.tint);
      looks[i] = this.tint[0];
      looks[i + 1] = this.tint[1];
      looks[i + 2] = this.tint[2];
      looks[i + 3] = outAt(planet.magnitude);
    }
    this.places.needsUpdate = true;
    this.looks.needsUpdate = true;
  }

  /**
   * How the night is: the sun's depth below the horizon (degrees; the stars
   * come out by it), how clear the air is (0..1), whether things may move, and
   * the moon as drawn (a scene-axes unit vector; `moonRadius` the sine of its
   * disc's radius, 0 when it isn't up).
   */
  set(sunDepth: number, clear: number, motion: boolean, moon: Readonly<Vec3>, moonRadius: number): void {
    this.sunDepth.value = sunDepth;
    this.clear.value = clear;
    this.lively.value = motion ? 1 : 0;
    this.moonDir.value.set(moon[0], moon[2], -moon[1]);
    this.moonCos.value = moonRadius > 0 ? Math.sqrt(1 - moonRadius * moonRadius) : 2;
    // Drawn only once the first of them could be out (Venus at sunset), and not under a sky with nothing to see.
    this.mesh.visible = sunDepth > -COMING_OUT && clear > 0.02;
  }

  /** The top of the strip the panorama fills (radians): panorama.ts' heavensTop of the view. */
  open(top: number): void {
    if (Math.abs(top - this.top.value) > 1e-5) this.top.value = top;
  }

  /** The moon as drawn now (a scene-axes unit vector): it hides the stars behind its disc. */
  moon(x: number, y: number, z: number): void {
    this.moonDir.value.set(x, y, z);
  }

  /** The meteor in the sky now, if any (its streak is drawn where the panorama puts it). */
  meteor(meteors: Meteors, strength: number): void {
    const on = meteors.alive && strength > 0.02;
    if (on !== this.streak.visible) this.streak.visible = on;
    if (!on) return;
    toScene(seenDirection(meteors.from, this.scratch, this.top.value), this.meteorFrom.value);
    toScene(seenDirection(meteors.to, this.scratch, this.top.value), this.meteorTo.value);
    this.meteorAt.value = Math.min(1, meteors.age / meteors.life);
    this.meteorBright.value = meteors.bright * strength;
  }

  dispose(): void {
    for (const mesh of [this.mesh, this.streak]) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      mesh.dispose();
    }
    for (const m of this.materials) m.dispose();
  }
}
