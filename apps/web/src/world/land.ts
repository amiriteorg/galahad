import { abs, attribute, cameraPosition, clamp, float, fract, mix, modelWorldMatrix, normalize, positionLocal, positionWorld, pow, sin, smoothstep, time, uniform, uv, vec3, vec4, vertexColor } from "three/tsl";
import { BufferAttribute, BufferGeometry, Color, DoubleSide, type Group, Mesh, MeshLambertNodeMaterial, MeshPhongNodeMaterial } from "three/webgpu";
import { toScene } from "./coords.ts";
import { flatNormals, linear } from "./mesher.ts";
import { built } from "./path.ts";
import { BIG, CELL, CELLS, CHUNK, chunkKey, type ChunkSamples, chunkSamples, chunksAround, type Flat, flatKey, flatsTouching, growLayer, heightAt, KEEP_FLAT, type Layer, streamAt, streamLevel, WATER_LEVEL, waterAt } from "./terrain.ts";

/*
 * The land on the GPU: one mesh per loaded 64 m chunk (faces coloured, flat
 * shaded, with foam lapping where it meets the water), the water itself (one
 * faceted, gently waving sheet that follows the camera) and, where a stream runs
 * in a chunk, its pools and waterfalls. Chunks load nearest first within a time
 * budget per frame (never a hitch), and unload behind you; what grows on them is
 * drawn by the vegetation, which hears of each chunk as it comes and goes.
 * Everything sits under the world root, which the floating origin moves, so the
 * GPU's numbers stay small however far you go.
 */

export interface Chunk {
  key: string;
  cx: number;
  cy: number;
  mesh: Mesh;
  /** Its stream's pools and falls, if one runs here. */
  stream: Mesh | null;
  samples: ChunkSamples;
  /** Which flats it was grown with: a change means it grows again. */
  flats: string;
}

/** The water's colour (time of day) and the waves' strength (0 under reduced motion). */
export const waterUniforms = { color: uniform(new Color(0x4fd2cc)), sky: uniform(new Color(0xdfe4f6)), waves: uniform(1) };

/** Water: faceted, waving, a little see-through, tinted towards the sky at a grazing look; falls foam white. */
function waterMaterial(near: boolean): MeshPhongNodeMaterial {
  const m = new MeshPhongNodeMaterial({ transparent: true, flatShading: true, shininess: 70, depthWrite: true, side: near ? 0 : DoubleSide });
  m.specular.setRGB(0.5, 0.48, 0.42);
  const fall = near ? float(0) : attribute("fall", "float");
  const world = modelWorldMatrix.mul(vec4(positionLocal, 1));
  // Waves fade towards the sheet's far edge (the vertices there are kilometres apart).
  const reach = near ? float(1).sub(smoothstep(110, 160, abs(positionLocal.x).max(abs(positionLocal.z)))) : float(1).sub(fall);
  // Three swells across each other: a gentle, never-repeating chop (metres).
  const t = time.mul(waterUniforms.waves);
  const wave = sin(world.x.mul(0.31).add(t.mul(1.1)))
    .mul(0.05)
    .add(sin(world.z.mul(0.23).sub(t.mul(0.8)).add(world.x.mul(0.07))).mul(0.045))
    .add(sin(world.x.mul(0.9).add(world.z.mul(0.7)).add(t.mul(1.9))).mul(0.018));
  m.positionNode = positionLocal.add(vec3(0, wave.mul(reach), 0));
  const view = normalize(cameraPosition.sub(positionWorld));
  const grazing = pow(float(1).sub(clamp(view.y, 0, 1)), 3).mul(0.55);
  const surface = mix(waterUniforms.color, waterUniforms.sky, grazing);
  if (near) {
    m.colorNode = surface;
    m.opacityNode = float(0.84);
  } else {
    // A waterfall: white streaks running down (uv.y grows downwards), over the water's colour.
    const streak = smoothstep(0.35, 0.9, fract(uv().y.mul(2.2).sub(time.mul(1.4)).add(sin(uv().x.mul(17)).mul(0.25))));
    m.colorNode = mix(surface, vec3(0.97, 1, 1), fall.mul(streak.mul(0.6).add(0.35)));
    m.opacityNode = mix(float(0.86), float(0.95), fall);
  }
  return m;
}

/** The land's material: vertex colours, and foam lapping where it meets a water surface (its "water" level). */
function landMaterial(): MeshLambertNodeMaterial {
  const m = new MeshLambertNodeMaterial({ vertexColors: true });
  const level = attribute("water", "float");
  const y = positionWorld.y;
  const lap = sin(time.mul(waterUniforms.waves).mul(1.3).add(positionWorld.x.mul(0.35)).add(positionWorld.z.mul(0.27))).mul(0.05);
  const above = y.sub(level).sub(lap);
  const foam = smoothstep(0.2, 0.04, above).mul(smoothstep(-0.06, 0.02, above));
  const wet = smoothstep(0.55, 0.15, above).mul(smoothstep(-0.2, 0.0, above));
  const ground = mix(vertexColor(), vertexColor().mul(0.82), wet);
  m.colorNode = mix(ground, vec3(0.93, 0.98, 0.96), foam.mul(0.8));
  return m;
}

export class Land {
  readonly material = landMaterial();
  readonly chunks = new Map<string, Chunk>();
  /** The same chunks as a list (walked every frame without allocating). */
  readonly list: Chunk[] = [];
  readonly water: Mesh;
  private readonly waterNear = waterMaterial(true);
  private readonly streamMaterial = waterMaterial(false);
  private readonly waterCell: number;
  /** The keep's ground is level from the start: plots add theirs (setFlats), and a node with none never calls it. */
  private flats: Flat[] = [KEEP_FLAT];
  /** Bumped whenever the set of loaded chunks changes. */
  version = 0;
  /** Told of every chunk as it's grown and dropped (the vegetation). */
  onGrow: (chunk: Chunk) => void = () => {};
  onDrop: (chunk: Chunk) => void = () => {};

  constructor(
    private readonly root: Group,
    private readonly seed: number,
    private readonly shadows: boolean,
    waterGrid = 48,
  ) {
    // A grid of `waterGrid` cells a side over 320 m (waves need vertices), its outer ring stretched far
    // past the fog, so one sheet reaches the horizon with no seam.
    const n = waterGrid;
    const size = 320;
    this.waterCell = size / (n - 2);
    const coord = (i: number) => (i === 0 ? -3000 : i === n ? 3000 : -size / 2 + (i - 1) * this.waterCell);
    const pos: number[] = [];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x0 = coord(i);
        const x1 = coord(i + 1);
        const z0 = coord(j);
        const z1 = coord(j + 1);
        pos.push(x0, 0, z0, x0, 0, z1, x1, 0, z1, x0, 0, z0, x1, 0, z1, x1, 0, z0);
      }
    }
    const geometry = new BufferGeometry();
    const positions = new Float32Array(pos);
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new BufferAttribute(flatNormals(positions), 3));
    this.water = new Mesh(geometry, this.waterNear);
    this.water.frustumCulled = false;
    this.water.renderOrder = 1;
    this.water.position.y = WATER_LEVEL;
    this.water.receiveShadow = shadows;
    root.add(this.water);
  }

  /** Which ground stays level (the keep, every plot). Chunks grown with other flats grow again. */
  setFlats(flats: Flat[]): void {
    this.flats = flats;
    for (const chunk of [...this.list]) {
      if (keyOf(flatsTouching(chunk.cx, chunk.cy, flats)) !== chunk.flats) this.drop(chunk);
    }
  }

  heightAt(x: number, y: number): number {
    return heightAt(this.seed, x, y, this.flats);
  }

  /** The water's surface at (x, y): a lake's or a stream pool's, or −Infinity where it's dry. */
  waterAt(x: number, y: number): number {
    return waterAt(this.seed, x, y, this.flats);
  }

  /** A chunk's small layer (grass, flowers, pebbles), grown the first time it's asked for. */
  smallLayer(chunk: Chunk, layer: Layer): Float64Array {
    return growLayer(this.seed, chunk.samples, layer, built);
  }

  setWaterColor(hex: number, sky: number): void {
    waterUniforms.color.value.setHex(hex);
    waterUniforms.sky.value.setHex(sky);
  }

  /**
   * Loads the chunks within `radius` of the world point (x, y), nearest first,
   * until `deadline` (performance.now(); at least one a call, at most
   * `maxNew`), and drops those well beyond it. Returns true while chunks within
   * reach are still to grow.
   */
  update(x: number, y: number, radius: number, deadline: number, maxNew: number): boolean {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const chunk = this.list[i]!;
      const dx = (chunk.cx + 0.5) * CHUNK - x;
      const dy = (chunk.cy + 0.5) * CHUNK - y;
      if (Math.hypot(dx, dy) > radius + CHUNK * 1.5) this.drop(chunk);
    }
    // Only when something may be missing: the list of chunks around is the one allocation here.
    if (this.lastX !== Math.round(x / 8) || this.lastY !== Math.round(y / 8) || this.lastRadius !== radius || this.missing) {
      this.lastX = Math.round(x / 8);
      this.lastY = Math.round(y / 8);
      this.lastRadius = radius;
      this.missing = false;
      this.wanted = chunksAround(x, y, radius).filter(([cx, cy]) => !this.chunks.has(chunkKey(cx, cy)));
      this.next = 0;
    }
    let grown = 0;
    while (this.next < this.wanted.length) {
      if (grown >= maxNew || (grown > 0 && performance.now() > deadline)) break;
      const [cx, cy] = this.wanted[this.next++]!;
      if (this.chunks.has(chunkKey(cx, cy))) continue;
      this.grow(cx, cy);
      grown++;
    }
    // Keep the water's grid on whole cells, so its waves don't swim as it follows.
    const [sx, , sz] = toScene(Math.round(x / this.waterCell) * this.waterCell, Math.round(y / this.waterCell) * this.waterCell);
    this.water.position.x = sx;
    this.water.position.z = sz;
    return this.next < this.wanted.length;
  }

  private lastX = Number.NaN;
  private lastY = Number.NaN;
  private lastRadius = 0;
  private missing = true;
  private wanted: [number, number][] = [];
  private next = 0;

  private grow(cx: number, cy: number): void {
    const near = flatsTouching(cx, cy, this.flats);
    const s = chunkSamples(this.seed, cx, cy, near, built, BIG);
    const n = CELLS + 1;
    const x0 = cx * CHUNK;
    const y0 = cy * CHUNK;
    // The water's surface at every corner, for the foam.
    const levels = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) levels[j * n + i] = Math.max(-1000, waterAt(this.seed, x0 + i * CELL, y0 + j * CELL, near));
    const positions = new Float32Array(CELLS * CELLS * 2 * 9);
    const colors = new Float32Array(positions.length);
    const water = new Float32Array(positions.length / 3);
    let p = 0;
    // Local scene coordinates from the chunk's south-west corner: x east, y up, z south (−north).
    const put = (i: number, j: number) => {
      water[p / 3] = levels[j * n + i]!;
      positions[p++] = i * CELL;
      positions[p++] = s.heights[j * n + i]!;
      positions[p++] = -j * CELL;
    };
    for (let j = 0; j < CELLS; j++) {
      for (let i = 0; i < CELLS; i++) {
        // Counter-clockwise seen from above (scene +y), in the same order as the face colours.
        put(i, j);
        put(i + 1, j);
        put(i + 1, j + 1);
        put(i, j);
        put(i + 1, j + 1);
        put(i, j + 1);
      }
    }
    for (let f = 0; f < s.faces.length; f++) {
      const [r, g, b] = linear(s.faces[f]!);
      for (let v = 0; v < 3; v++) {
        const k = (f * 3 + v) * 3;
        colors[k] = r;
        colors[k + 1] = g;
        colors[k + 2] = b;
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setAttribute("color", new BufferAttribute(colors, 3));
    geometry.setAttribute("normal", new BufferAttribute(flatNormals(positions), 3));
    geometry.setAttribute("water", new BufferAttribute(water, 1));
    geometry.computeBoundingSphere();
    const mesh = new Mesh(geometry, this.material);
    const [sx, sy, sz] = toScene(x0, y0, 0);
    mesh.position.set(sx, sy, sz);
    mesh.receiveShadow = this.shadows;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.root.add(mesh);
    const stream = this.streamMesh(cx, cy, near);
    if (stream) {
      stream.position.copy(mesh.position);
      stream.matrixAutoUpdate = false;
      stream.updateMatrix();
      this.root.add(stream);
    }
    const key = chunkKey(cx, cy);
    const chunk: Chunk = { key, cx, cy, mesh, stream, samples: s, flats: keyOf(near) };
    this.chunks.set(key, chunk);
    this.list.push(chunk);
    this.version++;
    this.onGrow(chunk);
  }

  /**
   * A stream's pools (level sheets over its bed, above the lakes) and its falls
   * (a sheet down every edge where it drops to a lower pool or a lake), in the
   * chunk's local scene coordinates. Null where no stream runs above the lakes.
   */
  private streamMesh(cx: number, cy: number, near: readonly Flat[]): Mesh | null {
    const x0 = cx * CHUNK;
    const y0 = cy * CHUNK;
    // Each cell's pool level (or NaN: no pool; WATER_LEVEL: a lake).
    const level = (i: number, j: number): number => {
      const x = x0 + (i + 0.5) * CELL;
      const y = y0 + (j + 0.5) * CELL;
      const h = heightAt(this.seed, x, y, near);
      if (streamAt(this.seed, x, y) > 0.4) {
        const l = streamLevel(this.seed, x, y);
        if (l > WATER_LEVEL + 0.01 && h < l - 0.1 && waterAt(this.seed, x, y, near) === l) return l;
      }
      return h < WATER_LEVEL ? WATER_LEVEL : Number.NaN;
    };
    const pos: number[] = [];
    const falls: number[] = [];
    const uvs: number[] = [];
    const quad = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx2: number, cy2: number, cz: number, dx: number, dy: number, dz: number, fall: number) => {
      pos.push(ax, ay, az, bx, by, bz, cx2, cy2, cz, ax, ay, az, cx2, cy2, cz, dx, dy, dz);
      for (let k = 0; k < 6; k++) falls.push(fall);
      uvs.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
    };
    for (let j = -1; j <= CELLS; j++) {
      for (let i = -1; i <= CELLS; i++) {
        const inside = i >= 0 && j >= 0 && i < CELLS && j < CELLS;
        const l = inside ? level(i, j) : Number.NaN;
        if (Number.isNaN(l) || l <= WATER_LEVEL + 0.01) continue;
        const ax = i * CELL;
        const bx = (i + 1) * CELL;
        const az = -j * CELL;
        const bz = -(j + 1) * CELL;
        // The pool over this cell (edge to edge with its neighbours: no overlap to double up).
        quad(ax, l, az, bx, l, az, bx, l, bz, ax, l, bz, 0);
        // Falls to every lower neighbour: east, west, north, south.
        const edges: [number, number, number, number, number, number][] = [
          [i + 1, j, bx, az, bx, bz],
          [i - 1, j, ax, bz, ax, az],
          [i, j + 1, bx, bz, ax, bz],
          [i, j - 1, ax, az, bx, az],
        ];
        for (const [ni, nj, ex0, ez0, ex1, ez1] of edges) {
          const nl = level(ni, nj);
          if (Number.isNaN(nl) || nl > l - 0.5) continue;
          // Down from this pool to the next, facing the lower side, a touch below its surface.
          quad(ex0, l + 0.02, ez0, ex1, l + 0.02, ez1, ex1, nl - 0.1, ez1, ex0, nl - 0.1, ez0, 1);
        }
      }
    }
    if (!pos.length) return null;
    const geometry = new BufferGeometry();
    const positions = new Float32Array(pos);
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new BufferAttribute(flatNormals(positions), 3));
    geometry.setAttribute("fall", new BufferAttribute(new Float32Array(falls), 1));
    geometry.setAttribute("uv", new BufferAttribute(new Float32Array(uvs), 2));
    geometry.computeBoundingSphere();
    const mesh = new Mesh(geometry, this.streamMaterial);
    mesh.renderOrder = 1;
    return mesh;
  }

  private drop(chunk: Chunk): void {
    this.root.remove(chunk.mesh);
    chunk.mesh.geometry.dispose();
    if (chunk.stream) {
      this.root.remove(chunk.stream);
      chunk.stream.geometry.dispose();
    }
    this.chunks.delete(chunk.key);
    this.list.splice(this.list.indexOf(chunk), 1);
    this.missing = true;
    this.version++;
    this.onDrop(chunk);
  }

  dispose(): void {
    for (const chunk of [...this.list]) this.drop(chunk);
    this.root.remove(this.water);
    this.water.geometry.dispose();
    this.material.dispose();
    this.waterNear.dispose();
    this.streamMaterial.dispose();
  }
}

const keyOf = (flats: readonly Flat[]): string => flats.map(flatKey).sort().join("|");
