import { BufferAttribute, BufferGeometry, type Matrix4 } from "three/webgpu";
import { DRIVERS, GROW, TINT } from "./flora-season.ts";
import { type AmbientOcclusion, flatNormals, linear, type Paint } from "./mesher.ts";

/*
 * Merged, flat-shaded, vertex-coloured geometry for what grows, like mesher.ts'
 * but every part also says what the season does to it: which of the year's
 * tints takes it from its summer colour to its other one (a leaf's gold, a
 * blade's straw, the heather's purple), which of the year's amounts grows it (a
 * leaf, a twig, a flower, a mushroom), the point it grows from, and its place in
 * the queue (so the parts of one plant come and go one after another). The
 * plants' shader (flora-shade.ts) reads these and does the rest; nothing is
 * rebuilt as the date creeps.
 *
 * Built geometries are packed small: a phone fetches every vertex of every
 * plant every frame, so normals are bytes, colours are bytes (stored as square
 * roots, for the dark end) and the season's data is eight more bytes:
 *
 *   position  3 floats
 *   normal    4 signed bytes
 *   color     4 bytes: the summer colour's square root (linear r, g, b)
 *   tone      4 bytes: the other colour's square root, and the part's tint and amount (tint + 16 × amount)
 *   season    4 signed shorts: the point it grows from (model metres / PIVOT_RANGE), and its place in the queue (0 to 1)
 *
 * 32 bytes a vertex, where position, normal and colour as floats were 36.
 */

/** A model's parts grow from points within this of its origin (metres): the scale of the packed pivots. */
export const PIVOT_RANGE = 16;

/** Where a part grows from: each face from its own middle, the whole part from its middle, or a given point. */
type Pivot = "face" | "part" | readonly [number, number, number];

interface Tag {
  tint: number;
  grow: number;
  /** The other colour (sRGB): one, one of several per face, or a Paint; null: the same as its summer colour. */
  alt: number | readonly number[] | Paint | null;
  pivot: Pivot;
  /** Its place in the queue, 0 to 1: per face, one for the part (by the part's own number), or given. */
  key: "face" | "part" | number;
}

const PLAIN: Tag = { tint: TINT.none, grow: GROW.none, alt: null, pivot: "part", key: "part" };

export interface PlantBuild {
  ao?: AmbientOcclusion;
  /** "up": every normal points up (grass and flowers shade like the ground they stand on). */
  normals?: "flat" | "up";
}

const fract = (x: number): number => x - Math.floor(x);

export class PlantMesher {
  private readonly pos: number[] = [];
  private readonly col: number[] = [];
  private readonly alt: number[] = [];
  private readonly piv: number[] = [];
  private readonly keys: number[] = [];
  private readonly codes: number[] = [];
  private faces = 0;
  private parts = 0;
  private tag: Tag = PLAIN;

  /** What the season does to what's added next (until the next call; `plain()` for nothing). */
  season(tint: number, grow: number, options: { alt?: Tag["alt"]; pivot?: Pivot; key?: Tag["key"] } = {}): this {
    if (tint >= DRIVERS || grow >= DRIVERS) throw new Error("no such season driver");
    this.tag = { tint, grow, alt: options.alt ?? null, pivot: options.pivot ?? "part", key: options.key ?? "part" };
    return this;
  }

  plain(): this {
    this.tag = PLAIN;
    return this;
  }

  /** Adds a primitive, transformed by `m`, painted `color` (sRGB, or a Paint per face) with `vary` (0..1) per-face brightness variation. */
  add(geometry: BufferGeometry, color: number | Paint, m?: Matrix4, vary = 0.06): this {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    if (m) g.applyMatrix4(m);
    const p = g.getAttribute("position");
    const points = new Array<number>(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      points[i * 3] = p.getX(i);
      points[i * 3 + 1] = p.getY(i);
      points[i * 3 + 2] = p.getZ(i);
    }
    g.dispose();
    geometry.dispose();
    return this.put(points, color, vary);
  }

  /** Adds raw triangles (scene coordinates, three vertices each). */
  triangles(points: number[], color: number | Paint, vary = 0): this {
    return this.put(points, color, vary);
  }

  private put(points: number[], color: number | Paint, vary: number): this {
    const tag = this.tag;
    const part = ++this.parts;
    // The part's middle, for a part that grows from it.
    let mx = 0;
    let my = 0;
    let mz = 0;
    for (let i = 0; i < points.length; i += 3) {
      mx += points[i]!;
      my += points[i + 1]!;
      mz += points[i + 2]!;
    }
    const n = points.length / 3;
    mx /= n;
    my /= n;
    mz /= n;
    const partKey = typeof tag.key === "number" ? tag.key : fract(Math.sin(part * 78.233) * 43758.5453);
    const code = tag.tint + 16 * tag.grow;
    for (let i = 0; i + 8 < points.length; i += 9) {
      const cx = (points[i]! + points[i + 3]! + points[i + 6]!) / 3;
      const cy = (points[i + 1]! + points[i + 4]! + points[i + 7]!) / 3;
      const cz = (points[i + 2]! + points[i + 5]! + points[i + 8]!) / 3;
      const h = fract(Math.sin(++this.faces * 12.9898) * 43758.5453);
      const k = vary ? 1 - vary + 2 * vary * h : 1;
      const [r, g, b] = linear(typeof color === "number" ? color : color(cx, cy, cz));
      let ar = r;
      let ag = g;
      let ab = b;
      if (tag.alt !== null) {
        const other = typeof tag.alt === "number" ? tag.alt : typeof tag.alt === "function" ? tag.alt(cx, cy, cz) : tag.alt[Math.floor(fract(h * 7.31 + 0.13) * tag.alt.length)]!;
        [ar, ag, ab] = linear(other);
      }
      const key = tag.key === "face" ? fract(h * 3.77 + 0.31) : partKey;
      const px = tag.pivot === "face" ? cx : tag.pivot === "part" ? mx : tag.pivot[0];
      const py = tag.pivot === "face" ? cy : tag.pivot === "part" ? my : tag.pivot[1];
      const pz = tag.pivot === "face" ? cz : tag.pivot === "part" ? mz : tag.pivot[2];
      for (let v = 0; v < 3; v++) {
        this.pos.push(points[i + v * 3]!, points[i + v * 3 + 1]!, points[i + v * 3 + 2]!);
        this.col.push(r * k, g * k, b * k);
        this.alt.push(ar * k, ag * k, ab * k);
        this.piv.push(px, py, pz);
        this.keys.push(key);
        this.codes.push(code);
      }
    }
    return this;
  }

  get triangleCount(): number {
    return this.pos.length / 9;
  }

  build(options: PlantBuild = {}): BufferGeometry {
    const positions = new Float32Array(this.pos);
    const flat = options.normals === "up" ? null : flatNormals(positions);
    const n = positions.length / 3;
    const normal = new Int8Array(n * 4);
    const color = new Uint8Array(n * 4);
    const tone = new Uint8Array(n * 4);
    const season = new Int16Array(n * 4);
    const byte = (linearValue: number): number => Math.round(Math.sqrt(Math.max(0, Math.min(1, linearValue))) * 255);
    const short = (v: number): number => Math.round(Math.max(-1, Math.min(1, v)) * 32767);
    for (let i = 0; i < n; i++) {
      const nx = flat ? flat[i * 3]! : 0;
      const ny = flat ? flat[i * 3 + 1]! : 1;
      const nz = flat ? flat[i * 3 + 2]! : 0;
      const f = options.ao ? options.ao(positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!, nx, ny, nz) : 1;
      // (A part's other colour is shaded half as deep: a turned leaf lets the light through, and dry grass is pale to its foot.)
      const g = f + (1 - f) * 0.5;
      normal[i * 4] = Math.round(nx * 127);
      normal[i * 4 + 1] = Math.round(ny * 127);
      normal[i * 4 + 2] = Math.round(nz * 127);
      for (let c = 0; c < 3; c++) {
        color[i * 4 + c] = byte(this.col[i * 3 + c]! * f);
        tone[i * 4 + c] = byte(this.alt[i * 3 + c]! * g);
      }
      color[i * 4 + 3] = 255;
      tone[i * 4 + 3] = this.codes[i]!;
      for (let c = 0; c < 3; c++) season[i * 4 + c] = short(this.piv[i * 3 + c]! / PIVOT_RANGE);
      season[i * 4 + 3] = short(this.keys[i]!);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new BufferAttribute(normal, 4, true));
    geometry.setAttribute("color", new BufferAttribute(color, 4, true));
    geometry.setAttribute("tone", new BufferAttribute(tone, 4, true));
    geometry.setAttribute("season", new BufferAttribute(season, 4, true));
    geometry.computeBoundingSphere();
    return geometry;
  }
}

/** Two built models as one (a patch of two kinds of flower), the second moved by (dx, dz). */
export function together(a: BufferGeometry, b: BufferGeometry, dx: number, dz: number): BufferGeometry {
  const out = new BufferGeometry();
  for (const name of ["position", "normal", "color", "tone", "season"] as const) {
    const A = a.getAttribute(name);
    const B = b.getAttribute(name);
    const pa = A.array as Float32Array;
    const pb = (B.array as Float32Array).slice();
    if (name === "position") {
      for (let i = 0; i < pb.length; i += 3) {
        pb[i] = pb[i]! + dx;
        pb[i + 2] = pb[i + 2]! + dz;
      }
    } else if (name === "season") {
      // (Its parts' pivots move with it.)
      for (let i = 0; i < pb.length; i += 4) {
        pb[i] = pb[i]! + Math.round((dx / PIVOT_RANGE) * 32767);
        pb[i + 2] = pb[i + 2]! + Math.round((dz / PIVOT_RANGE) * 32767);
      }
    }
    const merged = new (pa.constructor as Float32ArrayConstructor)(pa.length + pb.length);
    merged.set(pa);
    merged.set(pb, pa.length);
    out.setAttribute(name, new BufferAttribute(merged, A.itemSize, A.normalized));
  }
  a.dispose();
  b.dispose();
  out.computeBoundingSphere();
  return out;
}
