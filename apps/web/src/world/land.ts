import { BufferAttribute, BufferGeometry, type Group, Mesh, MeshLambertMaterial, PlaneGeometry } from "three/webgpu";
import { toScene } from "./coords.ts";
import { flatNormals, linear } from "./mesher.ts";
import { built } from "./path.ts";
import { CELL, CELLS, CHUNK, type ChunkSamples, chunkKey, chunkSamples, chunksAround, type Flat, flatKey, flatsTouching, heightAt, WATER_LEVEL } from "./terrain.ts";

/*
 * The land on the GPU: one mesh per loaded 64 m chunk (faces coloured, flat
 * shaded) and one sheet of water that follows the camera. Chunks load nearest
 * first, a few per frame, and unload behind you; what grows on them is drawn by
 * the vegetation, from the same samples. Everything sits under the world root,
 * which the floating origin moves, so the GPU's numbers stay small however far
 * you go.
 */

export interface Chunk {
  key: string;
  cx: number;
  cy: number;
  mesh: Mesh;
  samples: ChunkSamples;
  /** Which flats it was grown with: a change means it grows again. */
  flats: string;
}

export class Land {
  readonly material = new MeshLambertMaterial({ vertexColors: true });
  readonly chunks = new Map<string, Chunk>();
  /** The same chunks as a list (walked every frame without allocating). */
  readonly list: Chunk[] = [];
  readonly water: Mesh;
  private readonly waterMaterial = new MeshLambertMaterial({ color: 0x6dbad6, transparent: true, opacity: 0.84 });
  private flats: Flat[] = [];
  /** Bumped whenever the set of loaded chunks changes (the vegetation refills on a change). */
  version = 0;

  constructor(
    private readonly root: Group,
    private readonly seed: number,
    private readonly shadows: boolean,
  ) {
    const water = new PlaneGeometry(3000, 3000, 1, 1);
    water.rotateX(-Math.PI / 2);
    this.water = new Mesh(water, this.waterMaterial);
    this.water.renderOrder = 1;
    this.water.position.y = WATER_LEVEL;
    root.add(this.water);
  }

  /** Which ground stays level (the keep, every plot). Chunks grown with other flats grow again. */
  setFlats(flats: Flat[]): void {
    this.flats = flats;
    for (const chunk of this.chunks.values()) {
      if (keyOf(flatsTouching(chunk.cx, chunk.cy, flats)) !== chunk.flats) this.drop(chunk);
    }
  }

  heightAt(x: number, y: number): number {
    return heightAt(this.seed, x, y, this.flats);
  }

  setWaterColor(hex: number): void {
    this.waterMaterial.color.setHex(hex);
  }

  /**
   * Loads the chunks within `radius` of the world point (x, y) (at most `budget`
   * this call, nearest first) and drops those well beyond it. Returns true while
   * chunks within reach are still to grow.
   */
  update(x: number, y: number, radius: number, budget: number): boolean {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const chunk = this.list[i]!;
      const dx = (chunk.cx + 0.5) * CHUNK - x;
      const dy = (chunk.cy + 0.5) * CHUNK - y;
      if (Math.hypot(dx, dy) > radius + CHUNK * 1.5) this.drop(chunk);
    }
    let pending = false;
    // Only when something may be missing: the list of chunks around is the one allocation here.
    if (this.lastX !== Math.round(x / 8) || this.lastY !== Math.round(y / 8) || this.lastRadius !== radius || this.missing) {
      this.lastX = Math.round(x / 8);
      this.lastY = Math.round(y / 8);
      this.lastRadius = radius;
      this.missing = false;
      for (const [cx, cy] of chunksAround(x, y, radius)) {
        if (this.chunks.has(chunkKey(cx, cy))) continue;
        if (budget-- <= 0) {
          pending = this.missing = true;
          break;
        }
        this.grow(cx, cy);
      }
    }
    const [sx, , sz] = toScene(x, y);
    this.water.position.x = sx;
    this.water.position.z = sz;
    return pending;
  }

  private lastX = Number.NaN;
  private lastY = Number.NaN;
  private lastRadius = 0;
  private missing = true;

  private grow(cx: number, cy: number): void {
    const near = flatsTouching(cx, cy, this.flats);
    const s = chunkSamples(this.seed, cx, cy, near, built);
    const n = CELLS + 1;
    const positions = new Float32Array(CELLS * CELLS * 2 * 9);
    const colors = new Float32Array(positions.length);
    let p = 0;
    // Local scene coordinates from the chunk's south-west corner: x east, y up, z south (−north).
    const put = (i: number, j: number) => {
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
    geometry.computeBoundingSphere();
    const mesh = new Mesh(geometry, this.material);
    const [sx, sy, sz] = toScene(cx * CHUNK, cy * CHUNK, 0);
    mesh.position.set(sx, sy, sz);
    mesh.receiveShadow = this.shadows;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.root.add(mesh);
    const key = chunkKey(cx, cy);
    const chunk = { key, cx, cy, mesh, samples: s, flats: keyOf(near) };
    this.chunks.set(key, chunk);
    this.list.push(chunk);
    this.version++;
  }

  private drop(chunk: Chunk): void {
    this.root.remove(chunk.mesh);
    chunk.mesh.geometry.dispose();
    this.chunks.delete(chunk.key);
    this.list.splice(this.list.indexOf(chunk), 1);
    this.missing = true;
    this.version++;
  }

  dispose(): void {
    for (const chunk of [...this.chunks.values()]) this.drop(chunk);
    this.root.remove(this.water);
    this.water.geometry.dispose();
    this.material.dispose();
    this.waterMaterial.dispose();
  }
}

const keyOf = (flats: Flat[]): string => flats.map(flatKey).sort().join("|");
