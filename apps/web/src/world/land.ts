import { abs, attribute, cameraPosition, clamp, float, fract, length, mix, modelWorldMatrix, normalize, positionLocal, positionWorld, pow, sin, smoothstep, time, uniform, uv, vec2, vec3, vec4, vertexColor } from "three/tsl";
import { BufferAttribute, BufferGeometry, Color, DoubleSide, type Group, Mesh, MeshLambertNodeMaterial, MeshPhongNodeMaterial, type Node } from "three/webgpu";
import { toScene } from "./coords.ts";
import { groundSeason } from "./flora-shade.ts";
import { flatNormals, linear } from "./mesher.ts";
import { built } from "./path.ts";
import { BIG, CELL, CELLS, CHUNK, chunkKey, type ChunkSamples, chunkSamples, chunksAround, FINE_CELL, type Flat, flatKey, flatsTouching, fineSurface, growLayer, heightAt, BASE_FLATS, type Layer, SPLITS, streamAt, streamLevel, type Surface, surfaceAt, surfaceHeight, WATER_LEVEL, waterAt, waterAtHeight } from "./terrain.ts";
import { ripples, wetDarken, wetSheen } from "./wet.ts";

/*
 * The land on the GPU: one mesh per loaded 64 m chunk (faces coloured, flat
 * shaded, with foam lapping where it meets the water), the water itself (one
 * faceted, gently waving sheet that follows the camera) and, where a stream runs
 * in a chunk, its pools and waterfalls. Chunks load nearest first within a time
 * budget per frame (never a hitch), and unload behind you; what grows on them is
 * drawn by the vegetation, which hears of each chunk as it comes and goes.
 *
 * Every chunk is drawn on the base grid (4 m cells); near the camera's focus it
 * swaps to the fine grid (2 m cells), grown a chunk at a time within the same
 * budget. The fine grid morphs into the base one in the vertex shader as it nears
 * the edge of its ring, so by the time a chunk swaps back (or meets a neighbour
 * still on the base grid) the two are the same surface: no pop, no crack. A short
 * skirt hangs from every chunk's edges, so a moment's mismatch while a chunk is
 * still growing its fine grid shows no gap either. Everything sits under the
 * world root, which the floating origin moves, so the GPU's numbers stay small
 * however far you go.
 */

export interface Chunk {
  key: string;
  cx: number;
  cy: number;
  /** The base grid. */
  mesh: Mesh;
  /** The fine grid, while the chunk is near the focus (the base mesh is hidden then). */
  fine: Mesh | null;
  /** Its stream's pools and falls, if one runs here. */
  stream: Mesh | null;
  samples: ChunkSamples;
  /** Which flats it was grown with: a change means it grows again. */
  flats: string;
}

/** The water's colour (time of day) and the waves' strength (0 under reduced motion). */
export const waterUniforms = { color: uniform(new Color(0x4fd2cc)), sky: uniform(new Color(0xdfe4f6)), waves: uniform(1) };

/** How far the water's surface stands over its level at a point of the scene's world, metres: three swells across each other, a gentle, never-repeating chop. */
export function waterWave(world: Node<"vec4"> | Node<"vec3">): Node<"float"> {
  const t = time.mul(waterUniforms.waves);
  return sin(world.x.mul(0.31).add(t.mul(1.1)))
    .mul(0.05)
    .add(sin(world.z.mul(0.23).sub(t.mul(0.8)).add(world.x.mul(0.07))).mul(0.045))
    .add(sin(world.x.mul(0.9).add(world.z.mul(0.7)).add(t.mul(1.9))).mul(0.018)) as unknown as Node<"float">;
}

/** Water: faceted, waving, a little see-through, tinted towards the sky at a grazing look; falls foam white. */
function waterMaterial(near: boolean): MeshPhongNodeMaterial {
  const m = new MeshPhongNodeMaterial({ transparent: true, flatShading: true, shininess: 70, depthWrite: true, side: near ? 0 : DoubleSide });
  m.specular.setRGB(0.5, 0.48, 0.42);
  const fall = near ? float(0) : attribute("fall", "float");
  const world = modelWorldMatrix.mul(vec4(positionLocal, 1));
  // Waves fade towards the sheet's far edge (the vertices there are kilometres apart).
  const reach = near ? float(1).sub(smoothstep(110, 160, abs(positionLocal.x).max(abs(positionLocal.z)))) : float(1).sub(fall);
  m.positionNode = positionLocal.add(vec3(0, waterWave(world).mul(reach), 0));
  const view = normalize(cameraPosition.sub(positionWorld));
  const grazing = pow(float(1).sub(clamp(view.y, 0, 1)), 3).mul(0.55);
  // Rain rings the surface.
  const surface = mix(mix(waterUniforms.color, waterUniforms.sky, grazing), vec3(0.92, 0.96, 1), ripples().mul(0.55));
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

/** Where the fine grid has fully become the base one: a world point (scene x, z) and the distances it morphs between. */
const morph = { focus: uniform(vec2(0, 0)), near: uniform(1e5), far: uniform(2e5) };

/**
 * The land's material: each face's colour, as the season has it (its summer
 * colour with the year's tints laid over what covers it: grass that pales,
 * heath in flower, fallen leaves, a marsh gone to straw; and the wind's gusts
 * crossing its grass), and foam lapping where it meets a water surface (its
 * "water" level). Each vertex eases from its own height to the base grid's
 * under it ("coarse") between the morph's distances; faces are shaded by their
 * own slope (flat shading from the surface's derivatives), so they shade true
 * while they morph.
 */
function landMaterial(): MeshLambertNodeMaterial {
  const m = new MeshLambertNodeMaterial({ flatShading: true });
  const at = modelWorldMatrix.mul(vec4(positionLocal.x, 0, positionLocal.z, 1));
  const k = smoothstep(morph.near, morph.far, length(at.xz.sub(morph.focus)));
  m.positionNode = vec3(positionLocal.x, mix(positionLocal.y, attribute("coarse", "float"), k), positionLocal.z);
  const level = attribute("water", "float");
  const y = positionWorld.y;
  const lap = sin(time.mul(waterUniforms.waves).mul(1.3).add(positionWorld.x.mul(0.35)).add(positionWorld.z.mul(0.27))).mul(0.05);
  const above = y.sub(level).sub(lap);
  const foam = smoothstep(0.2, 0.04, above).mul(smoothstep(-0.06, 0.02, above));
  const wet = smoothstep(0.55, 0.15, above).mul(smoothstep(-0.2, 0.0, above));
  // (A face's summer colour is its vertex colour twice over, as it always was.)
  const paint = vertexColor().rgb;
  const ground = groundSeason(paint.mul(paint).mul(mix(float(1), float(0.82), wet)), attribute("cover", "vec4"));
  m.colorNode = mix(ground.mul(wetDarken(1, 1, ground)), paint.mul(vec3(0.93, 0.98, 0.96)), foam.mul(0.8));
  // Wet ground takes a sheen of the sky.
  m.emissiveNode = wetSheen(1);
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
  /** The keep's ground, the sites' and their roads' are level from the start: plots add theirs (setFlats), and a node with none never calls it. */
  private flats: Flat[] = BASE_FLATS;
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
    /** The fine grid is drawn this far round the focus (metres); 0: never. */
    private readonly fineRadius = 0,
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

  /**
   * The ground's height at (x, y) as it's drawn, so feet, paws and contact
   * shadows stand on the faceted surface: the fine grid's triangles where the
   * chunk is drawn on it (wherever anyone walks), the base grid's elsewhere, and
   * the fine surface where nothing's loaded yet.
   */
  heightAt(x: number, y: number): number {
    let c = this.last;
    if (!c || x < c.cx * CHUNK || y < c.cy * CHUNK || x >= (c.cx + 1) * CHUNK || y >= (c.cy + 1) * CHUNK) {
      c = this.chunks.get(chunkKey(Math.floor(x / CHUNK), Math.floor(y / CHUNK))) ?? null;
      this.last = c;
    }
    if (!c) return surfaceAt(this.seed, x, y, this.flats);
    const u = x - c.cx * CHUNK;
    const v = y - c.cy * CHUNK;
    const fine = c.fine ? c.samples.fine : undefined;
    return fine ? surfaceHeight(fine, u / FINE_CELL, v / FINE_CELL) : surfaceHeight(c.samples, u / CELL, v / CELL);
  }

  /** The chunk heightAt looked in last (most calls in a frame fall in the same one). */
  private last: Chunk | null = null;

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
    const refining = this.refine(x, y, deadline);
    // Keep the water's grid on whole cells, so its waves don't swim as it follows.
    const [sx, , sz] = toScene(Math.round(x / this.waterCell) * this.waterCell, Math.round(y / this.waterCell) * this.waterCell);
    this.water.position.x = sx;
    this.water.position.z = sz;
    return this.next < this.wanted.length || refining;
  }

  /** How many chunks are drawn on the fine grid now (for tests and the stats). */
  get fineChunks(): number {
    let n = 0;
    for (const c of this.list) if (c.fine) n++;
    return n;
  }

  /**
   * The fine ring: chunks near the focus swap to the fine grid (nearest first,
   * while the frame's budget lasts, and one step past it when a chunk close to
   * the focus still lacks it), and those that have left the ring swap back at
   * once. Returns true while chunks are still to refine.
   */
  private refine(x: number, y: number, deadline: number): boolean {
    const r = this.fineRadius;
    if (r <= 0) return false;
    // The morph, in the scene's world frame (the root is moved by the floating origin); only when the focus has
    // moved a metre or so (a uniform that changes has to be uploaded, and a metre is nothing to the morph).
    const [fx, , fz] = toScene(x, y);
    const wx = fx + this.root.position.x;
    const wz = fz + this.root.position.z;
    if (Math.abs(wx - morph.focus.value.x) + Math.abs(wz - morph.focus.value.y) > 1 || morph.far.value !== r) {
      morph.focus.value.set(wx, wz);
      morph.near.value = r - fineBand(r);
      morph.far.value = r;
    }
    // Flying over the land (the focus moving fast), no step past the budget: the base grid shows a moment
    // longer, and the frame stays smooth.
    const fast = Math.hypot(x - this.lastFocusX, y - this.lastFocusY) > FAST_STEP;
    this.lastFocusX = x;
    this.lastFocusY = y;
    let best: Chunk | null = null;
    let bestD = Infinity;
    let pending = 0;
    for (let i = 0; i < this.list.length; i++) {
      const c = this.list[i]!;
      const d = chunkDistance(c.cx, c.cy, x, y);
      const want = wantsFine(d, c.fine !== null, r);
      if (!want && c.fine) this.coarsen(c);
      else if (want && !c.fine) {
        pending++;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
    }
    // The nearest first; then, while there's time, the next nearest (one scan each: there are only a few).
    let done = 0;
    while (best) {
      // Within the frame's budget; past it, one step only for a chunk close to the focus (where the base grid
      // would show at once), so moving fast never piles the work into one frame.
      if ((done > 0 || fast || bestD >= r * 0.5) && performance.now() > deadline) break;
      this.refineChunk(best);
      done++;
      if (best.fine) pending--;
      best = null;
      bestD = Infinity;
      for (let i = 0; i < this.list.length; i++) {
        const c = this.list[i]!;
        if (c.fine) continue;
        const d = chunkDistance(c.cx, c.cy, x, y);
        if (wantsFine(d, false, r) && d < bestD) {
          bestD = d;
          best = c;
        }
      }
    }
    return pending > 0;
  }

  private lastFocusX = Number.NaN;
  private lastFocusY = Number.NaN;

  /** One step towards a chunk's fine grid: its samples (unless it has them), else its mesh. */
  private refineChunk(chunk: Chunk): void {
    if (!chunk.samples.fine) {
      fineSurface(this.seed, chunk.samples, built);
      return;
    }
    const fine = chunk.samples.fine;
    const mesh = this.surfaceMesh(chunk.cx, chunk.cy, fine, fine.coarse, chunk.samples.near);
    chunk.fine = mesh;
    chunk.mesh.visible = false;
    this.root.add(mesh);
  }

  private coarsen(chunk: Chunk): void {
    if (!chunk.fine) return;
    this.root.remove(chunk.fine);
    chunk.fine.geometry.dispose();
    chunk.fine = null;
    chunk.mesh.visible = true;
  }

  /** A surface's mesh, placed at its chunk's south-west corner. */
  private surfaceMesh(cx: number, cy: number, s: Surface, coarse: Float32Array | null, near: readonly Flat[]): Mesh {
    const n = s.cells + 1;
    const cell = CHUNK / s.cells;
    const x0 = cx * CHUNK;
    const y0 = cy * CHUNK;
    // The water's surface at every corner, for the foam.
    const levels = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) levels[j * n + i] = Math.max(-1000, waterAtHeight(this.seed, x0 + i * cell, y0 + j * cell, s.heights[j * n + i]!, near));
    const a = surfaceArrays(s, coarse, levels);
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(a.positions, 3));
    geometry.setAttribute("color", new BufferAttribute(a.colors, 3));
    geometry.setAttribute("cover", new BufferAttribute(a.cover, 4, true));
    // No normals: the material shades each face by its own slope.
    geometry.setAttribute("water", new BufferAttribute(a.water, 1));
    geometry.setAttribute("coarse", new BufferAttribute(a.coarse, 1));
    geometry.computeBoundingSphere();
    const mesh = new Mesh(geometry, this.material);
    const [sx, sy, sz] = toScene(x0, y0, 0);
    mesh.position.set(sx, sy, sz);
    mesh.receiveShadow = this.shadows;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    return mesh;
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
    const mesh = this.surfaceMesh(cx, cy, s, null, near);
    this.root.add(mesh);
    const stream = this.streamMesh(cx, cy, near);
    if (stream) {
      stream.position.copy(mesh.position);
      stream.matrixAutoUpdate = false;
      stream.updateMatrix();
      this.root.add(stream);
    }
    const key = chunkKey(cx, cy);
    const chunk: Chunk = { key, cx, cy, mesh, fine: null, stream, samples: s, flats: keyOf(near) };
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
    if (this.last === chunk) this.last = null;
    this.coarsen(chunk);
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

/** A focus that moves farther than this between frames (metres) is flying, not walking (he runs at 5 m/s). */
const FAST_STEP = 0.35;

/** How far a chunk's square is from (x, y), metres (0 inside it). */
export function chunkDistance(cx: number, cy: number, x: number, y: number): number {
  const nx = Math.max(cx * CHUNK, Math.min(x, (cx + 1) * CHUNK));
  const ny = Math.max(cy * CHUNK, Math.min(y, (cy + 1) * CHUNK));
  return Math.hypot(nx - x, ny - y);
}

/** The width of the band over which the fine grid morphs into the base one, at the edge of a ring `radius` wide. */
export const fineBand = (radius: number): number => Math.min(40, radius * 0.4);

/**
 * Whether a chunk `d` metres from the focus wants the fine grid (it has it now:
 * `fine`). It asks a little before the ring reaches it and lets go a little after,
 * so it doesn't flip on the edge; and a chunk on the base grid always lies wholly
 * beyond the ring, where its fine neighbours have morphed into the same surface.
 */
export function wantsFine(d: number, fine: boolean, radius: number): boolean {
  if (radius <= 0) return false;
  return fine ? d < radius + CHUNK * 0.5 : d < radius + CHUNK * 0.25;
}

/** sRGB channel (0..255) to linear, as the renderer's colour management does it (faces are coloured thousands at a time). */
const SRGB = Float32Array.from({ length: 256 }, (_, i) => linear(i)[2]);

/** How far a skirt hangs below a chunk's edge, metres. */
export const SKIRT = 1.5;

export interface SurfaceArrays {
  positions: Float32Array;
  colors: Float32Array;
  /** The base grid's height under each vertex: where it morphs to. */
  coarse: Float32Array;
  /** The water's level at each vertex (for the foam). */
  water: Float32Array;
  /** What covers each vertex's face, four bytes: grass, heath, a deciduous wood's floor, marsh (the season tints the ground by them). */
  cover: Uint8Array;
}

/**
 * A surface's triangles in its chunk's local scene coordinates (x east, y up, z
 * south, from the chunk's south-west corner), each vertex with its face's colour
 * (linear), the base grid's height under it (`coarse`; its own height when null)
 * and the water's level (`levels`, per corner); and a skirt hanging SKIRT below
 * every edge, facing out, morphing with it.
 */
export function surfaceArrays(s: Surface, coarse: Float32Array | null, levels: Float32Array): SurfaceArrays {
  const cells = s.cells;
  const n = cells + 1;
  const cell = CHUNK / cells;
  const tris = cells * cells * 2 + cells * 8;
  const positions = new Float32Array(tris * 9);
  const colors = new Float32Array(tris * 9);
  const under = new Float32Array(tris * 3);
  const water = new Float32Array(tris * 3);
  const cover = new Uint8Array(tris * 12);
  let face = 0;
  const target = coarse ?? s.heights;
  let v = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  const color = (hex: number, k = 1) => {
    r = SRGB[(hex >> 16) & 255]! * k;
    g = SRGB[(hex >> 8) & 255]! * k;
    b = SRGB[hex & 255]! * k;
  };
  const put = (i: number, j: number, drop = 0) => {
    const k = j * n + i;
    positions[v * 3] = i * cell;
    positions[v * 3 + 1] = s.heights[k]! - drop;
    positions[v * 3 + 2] = -j * cell;
    colors[v * 3] = r;
    colors[v * 3 + 1] = g;
    colors[v * 3 + 2] = b;
    under[v] = target[k]! - drop;
    water[v] = drop ? -1000 : levels[k]!;
    cover[v * 4] = s.cover[face * 4]!;
    cover[v * 4 + 1] = s.cover[face * 4 + 1]!;
    cover[v * 4 + 2] = s.cover[face * 4 + 2]!;
    cover[v * 4 + 3] = s.cover[face * 4 + 3]!;
    v++;
  };
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const c = SPLITS[s.split[j * cells + i]!]!;
      for (let t = 0; t < 2; t++) {
        face = (j * cells + i) * 2 + t;
        color(s.faces[face]!);
        for (let q = 0; q < 3; q++) put(i + c[t * 6 + q * 2]!, j + c[t * 6 + q * 2 + 1]!);
      }
    }
  }
  // Skirts: south and east edges run with the grid, north and west against it, so each faces out.
  const skirt = (ai: number, aj: number, bi: number, bj: number, of: number, outward: boolean) => {
    face = of;
    color(s.faces[face]!, 0.8);
    if (outward) {
      put(ai, aj, SKIRT);
      put(bi, bj, SKIRT);
      put(bi, bj);
      put(ai, aj, SKIRT);
      put(bi, bj);
      put(ai, aj);
    } else {
      put(bi, bj, SKIRT);
      put(ai, aj, SKIRT);
      put(ai, aj);
      put(bi, bj, SKIRT);
      put(ai, aj);
      put(bi, bj);
    }
  };
  for (let k = 0; k < cells; k++) {
    skirt(k, 0, k + 1, 0, k * 2, true);
    skirt(cells, k, cells, k + 1, (k * cells + cells - 1) * 2, true);
    skirt(k, cells, k + 1, cells, ((cells - 1) * cells + k) * 2 + 1, false);
    skirt(0, k, 0, k + 1, k * cells * 2 + 1, false);
  }
  return { positions, colors, coarse: under, water, cover };
}
