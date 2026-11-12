import { BoxGeometry, type BufferGeometry, ConeGeometry, CylinderGeometry, IcosahedronGeometry, InterleavedBuffer, InterleavedBufferAttribute, type Matrix4, OctahedronGeometry, TetrahedronGeometry } from "three/webgpu";
import { at, groundAO, lumpy, Mesher } from "../mesher.ts";

/*
 * The animals' bodies: each an original, faceted model of a few hundred
 * triangles, built from primitives into one geometry (one draw call a kind).
 *
 * They move without bones. Every vertex belongs to a part (a leg, the neck
 * and head, a wing, or the body), and carries where that part hinges (`pivot`)
 * and how it answers what its animal is doing (`rigA`, `rigB`); the vertex
 * shader (view.ts) turns the part about its hinge by its instance's numbers:
 *
 *   about x   swing · amount · sin(phase + offset)   legs in step with the ground covered
 *           + nod · headDown                         neck and head, down to graze or up to watch
 *           + fold · pose                            legs folding as it lies down
 *   about z   flap · amount · sin(phase + offset)    wings
 *   about y   tuck · pose                            wings folded along the back
 *
 * and a part marked `only` is drawn for some of a kind and not others (a
 * buck's antlers; a drake's colours against a duck's). Models face +z, stand
 * on y = 0, metres.
 */

interface Part {
  pivot: readonly [number, number, number];
  /** Radians of swing at a full stride, and where in the stride it comes. */
  swing?: number;
  offset?: number;
  /** Radians its head goes down per unit of nod (negative: it rises). */
  nod?: number;
  /** Radians it folds when lying (legs) or about z as it's posed. */
  fold?: number;
  /** Radians of flap (signed by its side), and of tuck when folded. */
  flap?: number;
  tuck?: number;
  /** 1: drawn only when its instance's flag is set; −1: only when it isn't. */
  only?: number;
}

class Rig {
  private readonly m = new Mesher();
  private readonly parts: Part[] = [{ pivot: [0, 0, 0] }];

  /** What's added next belongs to this part. */
  part(p: Part): this {
    this.parts.push(p);
    this.m.bone(this.parts.length - 1);
    return this;
  }

  /** What's added next is the body again. */
  body(): this {
    this.m.bone(0);
    return this;
  }

  add(geometry: BufferGeometry, color: number, matrix?: Matrix4, vary = 0.07): this {
    this.m.add(geometry, color, matrix, vary);
    return this;
  }

  tri(points: number[], color: number): this {
    this.m.triangles(points, color);
    return this;
  }

  build(shade = true): BufferGeometry {
    const g = this.m.build(shade ? { ao: groundAO(0.72, 0.5, 0.8) } : {});
    const n = g.getAttribute("position").count;
    const skin = g.getAttribute("skinIndex");
    // One buffer for the whole rig, ten numbers a vertex (a pipeline may have only eight buffers in all).
    const rig = new Float32Array(n * 10);
    for (let i = 0; i < n; i++) {
      const p = this.parts[skin ? skin.getX(i) : 0]!;
      rig.set(p.pivot, i * 10);
      rig.set([p.swing ?? 0, p.offset ?? 0, p.nod ?? 0, p.fold ?? 0, p.flap ?? 0, p.tuck ?? 0, p.only ?? 0], i * 10 + 3);
    }
    const buffer = new InterleavedBuffer(rig, 10);
    g.setAttribute("pivot", new InterleavedBufferAttribute(buffer, 3, 0));
    g.setAttribute("rigA", new InterleavedBufferAttribute(buffer, 4, 3));
    g.setAttribute("rigB", new InterleavedBufferAttribute(buffer, 3, 7));
    g.deleteAttribute("skinIndex");
    g.deleteAttribute("skinWeight");
    return g;
  }
}

const ball = (r: number, detail = 1): BufferGeometry => new IcosahedronGeometry(r, detail);
const PI = Math.PI;

/** A leg in two tapering lengths with a foot, hinged at its hip: down from (x, y, z), `len` long. */
function leg(r: Rig, x: number, y: number, z: number, len: number, thick: number, color: number, foot: number, offset: number, swing: number, fold: number, knee = 0.06): void {
  r.part({ pivot: [x, y, z], swing, offset, fold });
  const upper = len * 0.52;
  const lower = len - upper;
  r.add(new CylinderGeometry(thick, thick * 0.62, upper, 5), color, at(x, y - upper / 2, z + knee / 2, 0, 1, knee / upper));
  r.add(new CylinderGeometry(thick * 0.6, thick * 0.42, lower, 5), color, at(x, y - upper - lower / 2, z + knee / 2, 0, 1, -knee / lower));
  r.add(new BoxGeometry(thick * 1.1, len * 0.07, thick * 1.5), foot, at(x, len * 0.035, z + thick * 0.2), 0.03);
}

/** A roe deer: slender, long-legged, a short face and big ears, a white rump; the buck's antlers are short, three points a side. */
export function roe(): BufferGeometry {
  const coat = 0xc98a58;
  const pale = 0xe9c9a0;
  const dark = 0x8c5a3a;
  const r = new Rig();
  // Barrel, chest and haunch.
  r.add(lumpy(ball(0.5, 1), 3, 0.06), coat, at(0, 0.98, -0.02, 0, [0.46, 0.5, 1.02]));
  r.add(ball(0.3, 1), coat, at(0, 1.0, 0.36, 0, [0.72, 0.86, 0.8]));
  r.add(ball(0.3, 1), coat, at(0, 1.02, -0.42, 0, [0.78, 0.9, 0.8]));
  r.add(ball(0.24, 0), pale, at(0, 0.8, 0, 0, [0.7, 0.4, 2.2]), 0.03);
  // The white rump and the stub of a tail.
  r.add(ball(0.16, 0), 0xf7f1e4, at(0, 1.06, -0.63, 0, [1.05, 1.1, 0.5]), 0.02);
  r.add(new ConeGeometry(0.035, 0.1, 4), pale, at(0, 1.1, -0.72, 0, 1, -2.2), 0);
  // Neck and head, hinged at the shoulder: down to graze, up to watch.
  r.part({ pivot: [0, 1.06, 0.5], nod: -1.95 });
  r.add(new CylinderGeometry(0.1, 0.17, 0.62, 6), coat, at(0, 1.3, 0.64, 0, 1, 0.5));
  r.add(ball(0.13, 1), coat, at(0, 1.57, 0.8, 0, [0.9, 0.95, 1.15]));
  r.add(new CylinderGeometry(0.05, 0.09, 0.2, 5), dark, at(0, 1.52, 0.96, 0, 1, PI / 2 + 0.25), 0.04);
  r.add(ball(0.04, 0), 0x2b2320, at(0, 1.5, 1.07), 0);
  r.add(ball(0.024, 0), 0x1d1a18, at(0.085, 1.61, 0.86), 0);
  r.add(ball(0.024, 0), 0x1d1a18, at(-0.085, 1.61, 0.86), 0);
  for (const s of [1, -1]) r.add(new ConeGeometry(0.055, 0.2, 4), dark, at(s * 0.11, 1.74, 0.72, 0, [1, 1, 0.5], -0.25, -s * 0.5), 0.05);
  // The buck's antlers.
  r.part({ pivot: [0, 1.06, 0.5], nod: -1.95, only: 1 });
  for (const s of [1, -1]) {
    r.add(new CylinderGeometry(0.012, 0.02, 0.24, 4), 0xdccfb4, at(s * 0.055, 1.8, 0.75, 0, 1, -0.2, -s * 0.12), 0);
    r.add(new ConeGeometry(0.012, 0.11, 4), 0xdccfb4, at(s * 0.07, 1.84, 0.8, 0, 1, 0.9, -s * 0.1), 0);
    r.add(new ConeGeometry(0.012, 0.1, 4), 0xdccfb4, at(s * 0.08, 1.93, 0.7, 0, 1, -0.7, -s * 0.35), 0);
  }
  // Four legs: they go in diagonal pairs.
  leg(r, 0.13, 0.92, 0.36, 0.92, 0.062, dark, 0x3a2c25, 0, 0.55, -1.45);
  leg(r, -0.13, 0.92, 0.36, 0.92, 0.062, dark, 0x3a2c25, PI, 0.55, -1.45);
  leg(r, 0.14, 0.95, -0.42, 0.95, 0.07, dark, 0x3a2c25, PI, 0.55, -1.4, -0.09);
  leg(r, -0.14, 0.95, -0.42, 0.95, 0.07, dark, 0x3a2c25, 0, 0.55, -1.4, -0.09);
  return r.build();
}

/** A hare: long hind legs, a long back, black-tipped ears as long as its head. */
export function hare(): BufferGeometry {
  const coat = 0xbf9a72;
  const pale = 0xe8d9bd;
  const r = new Rig();
  r.add(lumpy(ball(0.2, 1), 5, 0.05), coat, at(0, 0.3, 0, 0, [0.72, 0.8, 1.45], -0.12));
  r.add(ball(0.16, 0), coat, at(0, 0.26, -0.2, 0, [0.95, 0.95, 0.9]));
  r.add(ball(0.12, 0), pale, at(0, 0.2, 0.02, 0, [0.7, 0.5, 2]), 0.03);
  r.add(ball(0.055, 0), 0xfaf6ee, at(0, 0.3, -0.36), 0);
  // Head and ears, hinged at the shoulders.
  r.part({ pivot: [0, 0.36, 0.2], nod: -0.95 });
  r.add(ball(0.095, 1), coat, at(0, 0.47, 0.3, 0, [0.9, 0.95, 1.2]));
  r.add(ball(0.035, 0), 0x3a2c25, at(0, 0.44, 0.41), 0);
  r.add(ball(0.02, 0), 0x1d1a18, at(0.065, 0.5, 0.33), 0);
  r.add(ball(0.02, 0), 0x1d1a18, at(-0.065, 0.5, 0.33), 0);
  for (const s of [1, -1]) {
    r.add(new CylinderGeometry(0.02, 0.034, 0.24, 4), coat, at(s * 0.045, 0.66, 0.24, 0, [1, 1, 0.5], -0.22, -s * 0.16), 0.04);
    r.add(new ConeGeometry(0.021, 0.07, 4), 0x2b2320, at(s * 0.063, 0.8, 0.21, 0, [1, 1, 0.5], -0.22, -s * 0.16), 0);
  }
  // Short forelegs, long folded hind legs: fore and hind go in pairs (it bounds).
  leg(r, 0.07, 0.22, 0.16, 0.22, 0.026, coat, pale, 0, 0.7, -1.3);
  leg(r, -0.07, 0.22, 0.16, 0.22, 0.026, coat, pale, 0.5, 0.7, -1.3);
  for (const s of [1, -1]) {
    r.part({ pivot: [s * 0.1, 0.24, -0.2], swing: 0.9, offset: PI + (s > 0 ? 0 : 0.4), fold: -0.3 });
    r.add(ball(0.1, 0), coat, at(s * 0.11, 0.2, -0.18, 0, [0.6, 1.1, 1.3]));
    r.add(new BoxGeometry(0.05, 0.035, 0.24), pale, at(s * 0.11, 0.02, -0.08), 0.03);
  }
  return r.build();
}

/** A red fox: low and long, a pointed face, black stockings, a brush as long as its body with a white tip. */
export function fox(): BufferGeometry {
  const coat = 0xd9713a;
  const pale = 0xf5ead8;
  const sock = 0x33282a;
  const r = new Rig();
  r.add(lumpy(ball(0.26, 1), 7, 0.05), coat, at(0, 0.5, 0, 0, [0.62, 0.66, 1.5]));
  r.add(ball(0.18, 0), pale, at(0, 0.4, 0.12, 0, [0.6, 0.5, 1.6]), 0.03);
  // The brush.
  r.add(new CylinderGeometry(0.1, 0.05, 0.42, 6), coat, at(0, 0.42, -0.6, 0, 1, -1.95));
  r.add(new ConeGeometry(0.1, 0.24, 6), pale, at(0, 0.3, -0.88, 0, 1, -1.95), 0.03);
  // Neck and head.
  r.part({ pivot: [0, 0.56, 0.3], nod: -1.25 });
  r.add(new CylinderGeometry(0.1, 0.13, 0.26, 6), coat, at(0, 0.64, 0.4, 0, 1, 0.75));
  r.add(ball(0.13, 1), coat, at(0, 0.74, 0.52, 0, [1, 0.9, 1.05]));
  r.add(new ConeGeometry(0.075, 0.22, 5), pale, at(0, 0.7, 0.7, 0, [1, 1, 0.75], PI / 2 + 0.12), 0.03);
  r.add(ball(0.028, 0), 0x1d1a18, at(0, 0.7, 0.81), 0);
  r.add(ball(0.02, 0), 0x1d1a18, at(0.07, 0.79, 0.6), 0);
  r.add(ball(0.02, 0), 0x1d1a18, at(-0.07, 0.79, 0.6), 0);
  for (const s of [1, -1]) {
    r.add(new ConeGeometry(0.055, 0.15, 4), coat, at(s * 0.085, 0.92, 0.48, 0, [1, 1, 0.5], -0.1, -s * 0.22), 0.04);
    r.add(new ConeGeometry(0.03, 0.06, 4), sock, at(s * 0.097, 0.98, 0.475, 0, [1, 1, 0.5], -0.1, -s * 0.22), 0);
  }
  leg(r, 0.09, 0.44, 0.24, 0.44, 0.04, sock, sock, 0, 0.6, -1.45);
  leg(r, -0.09, 0.44, 0.24, 0.44, 0.04, sock, sock, PI, 0.6, -1.45);
  leg(r, 0.1, 0.46, -0.28, 0.46, 0.045, sock, sock, PI, 0.6, -1.4, -0.06);
  leg(r, -0.1, 0.46, -0.28, 0.46, 0.045, sock, sock, 0, 0.6, -1.4, -0.06);
  return r.build();
}

/** A hedgehog: a dome of spines over a pale face and a pointed snout; curled, the face tucks under. */
export function hedgehog(): BufferGeometry {
  const r = new Rig();
  // The spines: a lumpy dome with a ruff of cones.
  r.add(lumpy(ball(0.2, 1), 9, 0.14), 0x8a6f52, at(0, 0.17, -0.02, 0, [0.82, 0.8, 1.1]), 0.14);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * PI * 2;
    const up = 0.5 + 0.4 * ((i * 7) % 3);
    r.add(new ConeGeometry(0.03, 0.09, 3), i % 2 ? 0xb89b78 : 0x6f573f, at(Math.sin(a) * 0.13, 0.22 + up * 0.07, -0.02 + Math.cos(a) * 0.17, a, 1, 0.9 - up * 0.5), 0.05);
  }
  // Face and snout: they go down and under as it curls.
  r.part({ pivot: [0, 0.14, 0.12], nod: -0.7, fold: 1.2 });
  r.add(ball(0.085, 0), 0xe6d2b4, at(0, 0.12, 0.2, 0, [0.95, 0.85, 1.1]), 0.03);
  r.add(new ConeGeometry(0.04, 0.1, 5), 0xd9c2a2, at(0, 0.1, 0.3, 0, 1, PI / 2 + 0.15), 0.03);
  r.add(ball(0.018, 0), 0x1d1a18, at(0, 0.09, 0.355), 0);
  r.add(ball(0.013, 0), 0x1d1a18, at(0.04, 0.15, 0.25), 0);
  r.add(ball(0.013, 0), 0x1d1a18, at(-0.04, 0.15, 0.25), 0);
  for (const [x, z, o] of [[0.07, 0.1, 0], [-0.07, 0.1, PI], [0.07, -0.12, PI], [-0.07, -0.12, 0]] as const) {
    r.part({ pivot: [x, 0.07, z], swing: 0.7, offset: o, fold: -1.2 });
    r.add(new BoxGeometry(0.035, 0.07, 0.05), 0x4a3b30, at(x, 0.035, z), 0.03);
  }
  return r.build();
}

/** A red squirrel: tufted ears, a white bib, and a tail as big as itself curled up its back. */
export function squirrel(): BufferGeometry {
  const coat = 0xc4582c;
  const r = new Rig();
  r.add(lumpy(ball(0.11, 1), 11, 0.05), coat, at(0, 0.15, 0, 0, [0.8, 0.85, 1.5], -0.25));
  r.add(ball(0.07, 0), 0xf6ecdc, at(0, 0.12, 0.08, 0, [0.7, 0.7, 1.1]), 0.02);
  // The tail: up and over the back in three lumps.
  r.add(ball(0.07, 0), coat, at(0, 0.18, -0.2, 0, [0.8, 1, 1]));
  r.add(ball(0.09, 0), 0xd0683a, at(0, 0.31, -0.25, 0, [0.85, 1.25, 0.9]));
  r.add(ball(0.08, 0), 0xd0683a, at(0, 0.44, -0.19, 0, [0.8, 1.1, 0.9]));
  r.part({ pivot: [0, 0.2, 0.1], nod: -0.9 });
  r.add(ball(0.065, 1), coat, at(0, 0.25, 0.17, 0, [0.95, 0.95, 1.15]));
  r.add(ball(0.02, 0), 0x2b2320, at(0, 0.23, 0.245), 0);
  r.add(ball(0.014, 0), 0x1d1a18, at(0.045, 0.27, 0.19), 0);
  r.add(ball(0.014, 0), 0x1d1a18, at(-0.045, 0.27, 0.19), 0);
  for (const s of [1, -1]) r.add(new ConeGeometry(0.022, 0.09, 3), coat, at(s * 0.04, 0.34, 0.14, 0, 1, -0.15, -s * 0.2), 0.03);
  for (const [x, z, o] of [[0.05, 0.1, 0], [-0.05, 0.1, 0.4], [0.06, -0.08, PI], [-0.06, -0.08, PI + 0.4]] as const) {
    r.part({ pivot: [x, 0.1, z], swing: 0.9, offset: o, fold: -0.8 });
    r.add(new BoxGeometry(0.03, 0.1, 0.04), 0xa8481f, at(x, 0.05, z), 0.03);
  }
  return r.build();
}

/** A wing as a few flat facets from a shoulder out along x (`side` 1 left, −1 right), `span` long and `chord` deep. */
function wing(r: Rig, side: number, x: number, y: number, z: number, span: number, chord: number, color: number, tip: number, flap: number, tuck: number, offset = 0, sweep = 0.15): void {
  r.part({ pivot: [side * x, y, z], flap: side * flap, tuck: side * tuck, offset });
  const a = side * x;
  const b = side * (x + span * 0.55);
  const c = side * (x + span);
  const front = z + chord * 0.5;
  const back = z - chord * 0.5;
  const mid = z - span * sweep * 0.5;
  const out = z - span * sweep;
  // Inner panel, outer panel, and the tip (two triangles each but the tip); wound to face up on either side.
  const quad = (x0: number, f0: number, b0: number, x1: number, f1: number, b1: number, col: number): void => {
    const pts = side > 0 ? [x0, y, f0, x1, y, f1, x1, y, b1, x0, y, f0, x1, y, b1, x0, y, b0] : [x0, y, f0, x1, y, b1, x1, y, f1, x0, y, f0, x0, y, b0, x1, y, b1];
    r.tri(pts, col);
  };
  quad(a, front, back, b, mid + chord * 0.45, mid - chord * 0.5, color);
  quad(b, mid + chord * 0.45, mid - chord * 0.5, c, out + chord * 0.12, out - chord * 0.12, tip);
}

/** A mallard: the drake with his green head, white collar and chestnut breast, the duck in mottled browns; both with the blue wing patch. */
export function mallard(): BufferGeometry {
  const r = new Rig();
  const both = (drake: boolean): void => {
    const only = drake ? 1 : -1;
    r.part({ pivot: [0, 0, 0], only });
    r.add(lumpy(ball(0.19, 1), 13, 0.04), drake ? 0xcfcac0 : 0xa98a66, at(0, 0.2, -0.02, 0, [0.82, 0.68, 1.42]), drake ? 0.05 : 0.14);
    r.add(ball(0.12, 0), drake ? 0x8a4a34 : 0xb8996f, at(0, 0.2, 0.2, 0, [0.95, 0.95, 0.9]));
    r.add(new ConeGeometry(0.09, 0.2, 5), drake ? 0x2e2a2c : 0x8f7353, at(0, 0.26, -0.33, 0, [1, 1, 0.5], -PI / 2 - 0.35), 0.05);
    r.add(new BoxGeometry(0.03, 0.05, 0.13), 0x4f7fd6, at(0.135, 0.24, -0.08, 0, 1, 0, 0.3), 0);
    r.add(new BoxGeometry(0.03, 0.05, 0.13), 0x4f7fd6, at(-0.135, 0.24, -0.08, 0, 1, 0, -0.3), 0);
    r.part({ pivot: [0, 0.26, 0.2], nod: -1.1, only });
    r.add(new CylinderGeometry(0.05, 0.07, 0.16, 6), drake ? 0xf2efe6 : 0xb8996f, at(0, 0.33, 0.25, 0, 1, 0.35), 0.03);
    r.add(ball(0.078, 1), drake ? 0x2f8a55 : 0xa98a66, at(0, 0.43, 0.3, 0, [0.95, 1, 1.1]));
    r.add(new BoxGeometry(0.06, 0.028, 0.13), drake ? 0xe9c23f : 0xd18a3a, at(0, 0.41, 0.42), 0.02);
    r.add(ball(0.014, 0), 0x1d1a18, at(0.05, 0.45, 0.33), 0);
    r.add(ball(0.014, 0), 0x1d1a18, at(-0.05, 0.45, 0.33), 0);
  };
  both(true);
  both(false);
  wing(r, 1, 0.12, 0.27, 0.02, 0.34, 0.2, 0x9c8a74, 0x6f6a66, 1.0, 1.35);
  wing(r, -1, 0.12, 0.27, 0.02, 0.34, 0.2, 0x9c8a74, 0x6f6a66, 1.0, 1.35);
  for (const [x, o] of [[0.07, 0], [-0.07, PI]] as const) {
    r.part({ pivot: [x, 0.12, -0.04], swing: 0.7, offset: o });
    r.add(new CylinderGeometry(0.015, 0.015, 0.11, 4), 0xe88a2e, at(x, 0.06, -0.04), 0);
    r.add(new BoxGeometry(0.06, 0.012, 0.08), 0xe88a2e, at(x, 0.006, 0), 0);
  }
  return r.build();
}

/** A mute swan: all white, the neck in an S, an orange bill with its black knob; the wings arch over the back when it's roused. */
export function swan(): BufferGeometry {
  const white = 0xfbfaf4;
  const r = new Rig();
  r.add(lumpy(ball(0.42, 1), 15, 0.04), white, at(0, 0.36, -0.05, 0, [0.72, 0.62, 1.35]), 0.04);
  r.add(new ConeGeometry(0.16, 0.34, 6), white, at(0, 0.5, -0.66, 0, [1, 1, 0.55], -PI / 2 - 0.5), 0.04);
  // The neck: up from the breast, back, and forward again to the head; all of it goes down to feed.
  r.part({ pivot: [0, 0.5, 0.42], nod: -1.75 });
  r.add(new CylinderGeometry(0.075, 0.11, 0.42, 6), white, at(0, 0.68, 0.5, 0, 1, 0.45), 0.03);
  r.add(new CylinderGeometry(0.062, 0.075, 0.4, 6), white, at(0, 1.02, 0.56, 0, 1, -0.12), 0.03);
  r.add(new CylinderGeometry(0.058, 0.062, 0.2, 6), white, at(0, 1.26, 0.6, 0, 1, 0.7), 0.03);
  r.add(ball(0.085, 1), white, at(0, 1.3, 0.72, 0, [0.9, 0.9, 1.25]), 0.03);
  r.add(new ConeGeometry(0.045, 0.2, 5), 0xf08a34, at(0, 1.25, 0.88, 0, [1, 1, 0.7], PI / 2 + 0.3), 0.02);
  r.add(ball(0.03, 0), 0x1d1a18, at(0, 1.32, 0.8), 0);
  r.add(ball(0.014, 0), 0x1d1a18, at(0.055, 1.33, 0.75), 0);
  r.add(ball(0.014, 0), 0x1d1a18, at(-0.055, 1.33, 0.75), 0);
  wing(r, 1, 0.2, 0.52, 0, 0.85, 0.5, white, 0xf1efe6, 0.9, 1.42);
  wing(r, -1, 0.2, 0.52, 0, 0.85, 0.5, white, 0xf1efe6, 0.9, 1.42);
  return r.build();
}

/** A grey heron: stilt legs, a dagger of a bill, a long neck held in an S, a black plume from the eye. */
export function heron(): BufferGeometry {
  const grey = 0xaeb6c2;
  const pale = 0xeef0f2;
  const r = new Rig();
  r.add(lumpy(ball(0.22, 1), 17, 0.04), grey, at(0, 1.0, -0.05, 0, [0.75, 0.9, 1.5], 0.45));
  r.add(new ConeGeometry(0.1, 0.3, 5), 0x8d96a4, at(0, 0.8, -0.36, 0, [1, 1, 0.5], -PI / 2 - 0.9), 0.04);
  r.part({ pivot: [0, 1.12, 0.14], nod: -1.3 });
  r.add(new CylinderGeometry(0.045, 0.075, 0.34, 5), pale, at(0, 1.26, 0.22, 0, 1, 0.5), 0.03);
  r.add(new CylinderGeometry(0.038, 0.045, 0.32, 5), pale, at(0, 1.52, 0.24, 0, 1, -0.3), 0.03);
  r.add(ball(0.062, 1), pale, at(0, 1.7, 0.24, 0, [0.9, 0.95, 1.3]), 0.03);
  r.add(new ConeGeometry(0.028, 0.3, 4), 0xe2b340, at(0, 1.68, 0.46, 0, [1, 1, 0.6], PI / 2), 0.02);
  r.add(new ConeGeometry(0.018, 0.2, 3), 0x2b2c33, at(0, 1.74, 0.08, 0, 1, -PI / 2 - 0.3), 0);
  r.add(ball(0.012, 0), 0x1d1a18, at(0.04, 1.72, 0.29), 0);
  r.add(ball(0.012, 0), 0x1d1a18, at(-0.04, 1.72, 0.29), 0);
  wing(r, 1, 0.1, 1.08, -0.02, 0.8, 0.42, grey, 0x4a5060, 0.85, 1.4);
  wing(r, -1, 0.1, 1.08, -0.02, 0.8, 0.42, grey, 0x4a5060, 0.85, 1.4);
  for (const [x, o] of [[0.06, 0], [-0.06, PI]] as const) {
    r.part({ pivot: [x, 0.86, -0.02], swing: 0.5, offset: o });
    r.add(new CylinderGeometry(0.016, 0.014, 0.86, 4), 0xc9b46a, at(x, 0.43, -0.02), 0);
    r.add(new BoxGeometry(0.03, 0.012, 0.14), 0xc9b46a, at(x, 0.006, 0.03), 0);
  }
  return r.build();
}

/** A small bird: round body, short tail, a beak; the same shape for every songbird and for the starlings (their colours are their instance's). */
export function bird(): BufferGeometry {
  const r = new Rig();
  // (Near white: each one's own colour multiplies it.)
  r.add(ball(0.07, 1), 0xf2efe8, at(0, 0.08, 0, 0, [0.85, 0.85, 1.25]), 0.05);
  r.add(ball(0.05, 0), 0xd9d5cc, at(0, 0.075, 0.02, 0, [0.8, 0.7, 1.3]), 0.03);
  r.add(new BoxGeometry(0.05, 0.012, 0.11), 0x9c9890, at(0, 0.085, -0.12, 0, 1, 0.15), 0.04);
  r.part({ pivot: [0, 0.1, 0.05], nod: -1.2 });
  r.add(ball(0.046, 1), 0xf2efe8, at(0, 0.135, 0.07), 0.05);
  r.add(new ConeGeometry(0.014, 0.05, 4), 0xe0a23c, at(0, 0.13, 0.125, 0, 1, PI / 2), 0);
  r.add(ball(0.009, 0), 0x1d1a18, at(0.03, 0.145, 0.09), 0);
  r.add(ball(0.009, 0), 0x1d1a18, at(-0.03, 0.145, 0.09), 0);
  wing(r, 1, 0.04, 0.1, 0.01, 0.17, 0.11, 0xbcb8b0, 0x8f8b84, 1.2, 1.4);
  wing(r, -1, 0.04, 0.1, 0.01, 0.17, 0.11, 0xbcb8b0, 0x8f8b84, 1.2, 1.4);
  r.body();
  for (const x of [0.02, -0.02]) r.add(new CylinderGeometry(0.004, 0.004, 0.035, 3), 0x6a5a4a, at(x, 0.017, 0), 0);
  return r.build();
}

/** A swallow: steel-blue above, a rusty throat, long pointed wings and a deeply forked tail. */
export function swallow(): BufferGeometry {
  const blue = 0x33466e;
  const r = new Rig();
  r.add(ball(0.055, 1), blue, at(0, 0, 0, 0, [0.8, 0.75, 1.6]), 0.05);
  r.add(ball(0.04, 0), 0xf3ead8, at(0, -0.012, 0, 0, [0.75, 0.6, 1.5]), 0.02);
  r.add(ball(0.036, 0), blue, at(0, 0.012, 0.08), 0.04);
  r.add(ball(0.02, 0), 0xb8532c, at(0, -0.004, 0.1), 0);
  r.add(new ConeGeometry(0.008, 0.03, 3), 0x1d1a18, at(0, 0.008, 0.125, 0, 1, PI / 2), 0);
  // The fork.
  r.tri([0.012, 0, -0.07, 0.07, 0, -0.26, 0.03, 0, -0.1], blue);
  r.tri([-0.012, 0, -0.07, -0.03, 0, -0.1, -0.07, 0, -0.26], blue);
  wing(r, 1, 0.03, 0.01, 0.02, 0.24, 0.085, blue, 0x26334f, 1.0, 1.4, 0, 0.6);
  wing(r, -1, 0.03, 0.01, 0.02, 0.24, 0.085, blue, 0x26334f, 1.0, 1.4, 0, 0.6);
  return r.build(false);
}

/** A greylag goose, as it's seen from below: grey-brown, a long neck stretched out, an orange bill. */
export function goose(): BufferGeometry {
  const grey = 0xa39a8c;
  const r = new Rig();
  r.add(lumpy(ball(0.2, 1), 19, 0.04), grey, at(0, 0, -0.05, 0, [0.8, 0.7, 1.7]), 0.06);
  r.add(ball(0.13, 0), 0xe9e4d8, at(0, -0.02, -0.3, 0, [0.9, 0.7, 1]), 0.03);
  r.add(new ConeGeometry(0.09, 0.16, 5), 0x6f685e, at(0, 0, -0.46, 0, [1, 0.4, 1], -PI / 2), 0.04);
  r.add(new CylinderGeometry(0.045, 0.07, 0.42, 5), 0x8f8678, at(0, 0.02, 0.46, 0, 1, PI / 2 - 0.05), 0.04);
  r.add(ball(0.055, 0), 0x8f8678, at(0, 0.04, 0.69, 0, [0.9, 0.9, 1.2]), 0.04);
  r.add(new ConeGeometry(0.028, 0.1, 4), 0xf0963c, at(0, 0.035, 0.79, 0, 1, PI / 2), 0);
  wing(r, 1, 0.1, 0.02, 0, 0.8, 0.34, grey, 0x5a554e, 0.75, 1.4, 0, 0.2);
  wing(r, -1, 0.1, 0.02, 0, 0.8, 0.34, grey, 0x5a554e, 0.75, 1.4, 0, 0.2);
  return r.build(false);
}

/** A kestrel: chestnut back spotted dark, a grey head, long pointed wings and a long tail it fans to hover. */
export function kestrel(): BufferGeometry {
  const chestnut = 0xb8703e;
  const r = new Rig();
  r.add(lumpy(ball(0.1, 1), 21, 0.04), chestnut, at(0, 0, 0, 0, [0.85, 0.8, 1.6]), 0.12);
  r.add(ball(0.075, 0), 0xf0dcb8, at(0, -0.02, 0.01, 0, [0.8, 0.6, 1.5]), 0.05);
  // The tail, fanned: grey with a black band at its tip.
  r.tri([0, 0, -0.1, 0.11, 0, -0.38, -0.11, 0, -0.38], 0xaeb2ba);
  r.tri([0.11, 0, -0.38, 0.12, 0, -0.43, -0.12, 0, -0.43, 0.11, 0, -0.38, -0.12, 0, -0.43, -0.11, 0, -0.38], 0x2b2c33);
  r.part({ pivot: [0, 0.01, 0.1], nod: -0.9 });
  r.add(ball(0.06, 1), 0xaeb6c2, at(0, 0.03, 0.15), 0.04);
  r.add(new ConeGeometry(0.018, 0.045, 4), 0x2b2c33, at(0, 0.015, 0.21, 0, 1, PI / 2 + 0.6), 0);
  r.add(ball(0.012, 0), 0x1d1a18, at(0.04, 0.04, 0.17), 0);
  r.add(ball(0.012, 0), 0x1d1a18, at(-0.04, 0.04, 0.17), 0);
  wing(r, 1, 0.06, 0.02, 0.03, 0.42, 0.17, chestnut, 0x3a3230, 0.8, 1.4, 0, 0.35);
  wing(r, -1, 0.06, 0.02, 0.03, 0.42, 0.17, chestnut, 0x3a3230, 0.8, 1.4, 0, 0.35);
  return r.build(false);
}

/** A tawny owl: a barrel of a body, a great round head with a pale face and dark eyes, broad rounded wings. */
export function owl(): BufferGeometry {
  const brown = 0x9a7550;
  const r = new Rig();
  r.add(lumpy(ball(0.15, 1), 23, 0.05), brown, at(0, 0.2, 0, 0, [0.9, 1.2, 0.9]), 0.14);
  r.add(ball(0.1, 0), 0xd9c4a0, at(0, 0.18, 0.06, 0, [0.85, 1.3, 0.6]), 0.1);
  r.add(new BoxGeometry(0.14, 0.02, 0.14), 0x7a5b3c, at(0, 0.06, -0.1, 0, 1, 0.5), 0.08);
  r.part({ pivot: [0, 0.34, 0], nod: -0.5 });
  r.add(ball(0.13, 1), brown, at(0, 0.42, 0.01, 0, [1.05, 0.95, 0.95]), 0.1);
  r.add(ball(0.085, 0), 0xe8dcc2, at(0, 0.42, 0.075, 0, [1.15, 1.05, 0.5]), 0.03);
  r.add(ball(0.028, 0), 0x1d1a18, at(0.045, 0.44, 0.12), 0);
  r.add(ball(0.028, 0), 0x1d1a18, at(-0.045, 0.44, 0.12), 0);
  r.add(new ConeGeometry(0.016, 0.04, 3), 0xd9b86a, at(0, 0.4, 0.125, 0, 1, PI), 0);
  wing(r, 1, 0.1, 0.3, 0, 0.5, 0.32, brown, 0x6f5236, 0.85, 1.45, 0, 0.05);
  wing(r, -1, 0.1, 0.3, 0, 0.5, 0.32, brown, 0x6f5236, 0.85, 1.45, 0, 0.05);
  return r.build(false);
}

/** A pipistrelle: a furry scrap of a body and two wings of skin, scalloped along their trailing edge. */
export function bat(): BufferGeometry {
  const fur = 0x4a3a34;
  const skin = 0x2e2628;
  const r = new Rig();
  r.add(ball(0.035, 0), fur, at(0, 0, 0, 0, [0.9, 0.8, 1.6]), 0.06);
  r.add(ball(0.024, 0), fur, at(0, 0.008, 0.05), 0.04);
  for (const s of [1, -1]) r.add(new TetrahedronGeometry(0.018, 0), fur, at(s * 0.014, 0.03, 0.05), 0);
  for (const s of [1, -1]) {
    r.part({ pivot: [s * 0.02, 0, 0], flap: s * 1.25, tuck: s * 1.3 });
    // Arm, hand and two scallops.
    const pts = (x0: number, z0: number, x1: number, z1: number, x2: number, z2: number): number[] => (s > 0 ? [s * x0, 0, z0, s * x1, 0, z1, s * x2, 0, z2] : [s * x0, 0, z0, s * x2, 0, z2, s * x1, 0, z1]);
    r.tri(pts(0.02, 0.03, 0.14, 0.05, 0.1, -0.05), skin);
    r.tri(pts(0.02, 0.03, 0.1, -0.05, 0.02, -0.06), skin);
    r.tri(pts(0.14, 0.05, 0.27, 0.0, 0.19, -0.04), skin);
    r.tri(pts(0.14, 0.05, 0.19, -0.04, 0.1, -0.05), skin);
  }
  return r.build(false);
}

/** An insect, for all of them: a body and four wings, pale, coloured by its instance (and scaled: a bee is squat, a dragonfly long). */
export function insect(): BufferGeometry {
  const r = new Rig();
  r.add(new OctahedronGeometry(0.02, 0), 0x5a4a3a, at(0, 0, 0, 0, [0.8, 0.8, 2.6]), 0.05);
  for (const s of [1, -1]) {
    r.part({ pivot: [s * 0.006, 0.006, 0], flap: s * 1.15 });
    const pts = (x0: number, z0: number, x1: number, z1: number, x2: number, z2: number): number[] => (s > 0 ? [s * x0, 0.006, z0, s * x1, 0.006, z1, s * x2, 0.006, z2] : [s * x0, 0.006, z0, s * x2, 0.006, z2, s * x1, 0.006, z1]);
    // Fore wing and hind wing.
    r.tri(pts(0.006, 0.02, 0.085, 0.06, 0.07, -0.005), 0xffffff);
    r.tri(pts(0.006, 0.02, 0.07, -0.005, 0.006, -0.005), 0xf2f2f2);
    r.tri(pts(0.006, -0.005, 0.06, -0.01, 0.045, -0.06), 0xe6e6e6);
    r.tri(pts(0.006, -0.005, 0.045, -0.06, 0.006, -0.035), 0xdcdcdc);
  }
  return r.build(false);
}

/** A fish as a shadow in the water: its outline, flat, seen from above; the tail's third wags (view.ts). Faces +z, 0.5 m long. */
export function fishShadow(): BufferGeometry {
  const m = new Mesher();
  const outline: [number, number][] = [[0, 0.25], [0.05, 0.14], [0.06, 0.02], [0.035, -0.1], [0.012, -0.17], [0.06, -0.26], [0, -0.22]];
  const pts: number[] = [];
  for (let i = 0; i + 1 < outline.length; i++) {
    const [x0, z0] = outline[i]!;
    const [x1, z1] = outline[i + 1]!;
    pts.push(0, 0, z0, x0, 0, z0, x1, 0, z1, 0, 0, z0, x1, 0, z1, 0, 0, z1);
    pts.push(0, 0, z0, -x1, 0, z1, -x0, 0, z0, 0, 0, z0, 0, 0, z1, -x1, 0, z1);
  }
  m.triangles(pts, 0xffffff);
  return m.build();
}

/** A ring on the water: a flat annulus of radius 1. */
export function ring(): BufferGeometry {
  const m = new Mesher();
  const pts: number[] = [];
  const n = 18;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * PI * 2;
    const b = ((i + 1) / n) * PI * 2;
    const r0 = 0.86;
    pts.push(Math.cos(a) * r0, 0, Math.sin(a) * r0, Math.cos(b), 0, Math.sin(b), Math.cos(a), 0, Math.sin(a));
    pts.push(Math.cos(a) * r0, 0, Math.sin(a) * r0, Math.cos(b) * r0, 0, Math.sin(b) * r0, Math.cos(b), 0, Math.sin(b));
  }
  m.triangles(pts, 0xffffff);
  return m.build();
}
