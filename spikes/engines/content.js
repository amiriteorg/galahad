/*
 * The slice every spike draws: the same numbers for each engine, made here once from a seed.
 *
 * It's a small stand-in for what the SANDBOX draws, shaped like it: chunks of faceted land with a colour a face;
 * kinds of plants, each one instanced mesh with a matrix and a colour an instance, swaying in the vertex shader;
 * kinds of animals, each one instanced mesh whose instances are written on the CPU every frame (they walk) and
 * whose legs swing in the vertex shader; one skinned figure; a sun with a shadow map, a sky light, fog.
 *
 * `x` asks for more of it: x times the chunks, the kinds of plants and the kinds of animals (so the draw calls
 * grow, as they do in the SANDBOX; each kind keeps its number of instances).
 */

export const CHUNK = 64;
const CELLS = 24;
const PLANTS_A_KIND = 500;
const ANIMALS_A_KIND = 50;

export function rng(seed) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}

export const heightAt = (x, z) => 3 * Math.sin(x * 0.03) * Math.cos(z * 0.04) + 1.2 * Math.sin(x * 0.11 + z * 0.07);

/** What the slice holds for `x` (1: 25 chunks, 24 kinds of plants, 8 kinds of animals). */
export function sizes(x) {
  return { chunksX: 5, chunksZ: 5 * x, plantKinds: 24 * x, animalKinds: 8 * x };
}

/** The land: one non-indexed, flat-shaded mesh a chunk (position, normal, colour rgb; in the chunk's own frame). */
export function terrain(x) {
  const { chunksX, chunksZ } = sizes(x);
  const out = [];
  const cell = CHUNK / CELLS;
  for (let cz = 0; cz < chunksZ; cz++) {
    for (let cx = 0; cx < chunksX; cx++) {
      const ox = (cx - chunksX / 2) * CHUNK;
      const oz = (cz - chunksZ / 2) * CHUNK;
      const n = CELLS * CELLS * 6;
      const positions = new Float32Array(n * 3);
      const normals = new Float32Array(n * 3);
      const colors = new Float32Array(n * 3);
      let v = 0;
      const tri = (ax, az, bx, bz, cx2, cz2) => {
        const ay = heightAt(ox + ax, oz + az);
        const by = heightAt(ox + bx, oz + bz);
        const cy = heightAt(ox + cx2, oz + cz2);
        const ux = bx - ax, uy = by - ay, uz = bz - az;
        const wx = cx2 - ax, wy = cy - ay, wz = cz2 - az;
        let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l; ny /= l; nz /= l;
        const h = (ay + by + cy) / 3;
        // Pastel greens by height, a little of the slope's own shade.
        const g = 0.62 + 0.05 * h + 0.1 * ny;
        const r = 0.45 + 0.03 * h, b = 0.38 + 0.02 * h;
        for (const [px, py, pz] of [[ax, ay, az], [bx, by, bz], [cx2, cy, cz2]]) {
          positions.set([px, py, pz], v * 3);
          normals.set([nx, ny, nz], v * 3);
          colors.set([r, g, b], v * 3);
          v++;
        }
      };
      for (let j = 0; j < CELLS; j++) {
        for (let i = 0; i < CELLS; i++) {
          const x0 = i * cell, x1 = x0 + cell, z0 = j * cell, z1 = z0 + cell;
          tri(x0, z0, x0, z1, x1, z1);
          tri(x0, z0, x1, z1, x1, z0);
        }
      }
      out.push({ x: ox, z: oz, positions, normals, colors });
    }
  }
  return out;
}

/** A faceted solid from quads and triangles, with a `sway` pair a vertex (how far it moves, and its phase). */
function builder() {
  const positions = [], normals = [], colors = [], sway = [];
  const tri = (a, b, c, color, wa, wb, wc, phase = 0) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const wx = c[0] - a[0], wy = c[1] - a[1], wz = c[2] - a[2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    [[a, wa], [b, wb], [c, wc]].forEach(([p, w]) => {
      positions.push(p[0], p[1], p[2]);
      normals.push(nx, ny, nz);
      colors.push(color[0], color[1], color[2]);
      sway.push(w, phase);
    });
  };
  const box = (x0, y0, z0, x1, y1, z1, color, weight, phase = 0) => {
    const c = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
    const w = c.map((p) => weight(p[1]));
    const quad = (i, j, k, l) => {
      tri(c[i], c[j], c[k], color, w[i], w[j], w[k], phase);
      tri(c[i], c[k], c[l], color, w[i], w[k], w[l], phase);
    };
    quad(1, 0, 3, 2); quad(4, 5, 6, 7); quad(0, 4, 7, 3); quad(5, 1, 2, 6); quad(3, 7, 6, 2); quad(0, 1, 5, 4);
  };
  return { tri, box, done: () => ({ positions: new Float32Array(positions), normals: new Float32Array(normals), colors: new Float32Array(colors), sway: new Float32Array(sway), triangles: positions.length / 9 }) };
}

/** A tree of a kind: a trunk and tiers of cones (about a hundred triangles); it sways more the higher up. */
function plantGeometry(kind) {
  const b = builder();
  const tiers = 3 + (kind % 3);
  const sides = 8 + (kind % 4) * 2;
  const tall = 4 + (kind % 5);
  const wide = 1.2 + (kind % 4) * 0.35;
  const leaf = [0.42 + 0.05 * (kind % 3), 0.68 + 0.04 * (kind % 4), 0.4 + 0.04 * (kind % 5)];
  const bark = [0.5, 0.4, 0.33];
  const w = (y) => Math.max(0, y / tall) ** 2;
  b.box(-0.15, 0, -0.15, 0.15, tall * 0.35, 0.15, bark, w);
  for (let t = 0; t < tiers; t++) {
    const y0 = tall * (0.25 + (0.6 * t) / tiers);
    const y1 = y0 + (tall * 0.75) / tiers + 0.6;
    const r = wide * (1 - (0.6 * t) / tiers);
    for (let s = 0; s < sides; s++) {
      const a0 = (s / sides) * Math.PI * 2, a1 = ((s + 1) / sides) * Math.PI * 2;
      const p0 = [Math.cos(a0) * r, y0, Math.sin(a0) * r], p1 = [Math.cos(a1) * r, y0, Math.sin(a1) * r];
      b.tri(p1, p0, [0, y1, 0], leaf, w(y0), w(y0), w(y1), t);
      b.tri(p0, p1, [0, y0, 0], leaf, w(y0), w(y0), w(y0), t);
    }
  }
  return b.done();
}

/** An animal of a kind: a body, a head and four legs (72 triangles); its legs swing in diagonal pairs. */
function animalGeometry(kind) {
  const b = builder();
  const long = 0.9 + (kind % 4) * 0.2;
  const tall = 0.5 + (kind % 3) * 0.2;
  const coat = [0.7 - 0.05 * (kind % 3), 0.55 + 0.04 * (kind % 4), 0.42 + 0.03 * (kind % 5)];
  const none = () => 0;
  b.box(-0.2, tall, -long / 2, 0.2, tall + 0.4, long / 2, coat, none);
  b.box(-0.14, tall + 0.3, long / 2, 0.14, tall + 0.62, long / 2 + 0.34, coat, none);
  const leg = (x, z, phase) => b.box(x - 0.06, 0, z - 0.06, x + 0.06, tall, z + 0.06, coat, (y) => 1 - y / tall, phase);
  leg(-0.14, long / 2 - 0.1, 0); leg(0.14, long / 2 - 0.1, Math.PI); leg(-0.14, -long / 2 + 0.1, Math.PI); leg(0.14, -long / 2 + 0.1, 0);
  return b.done();
}

/** The plants: for each kind its geometry, its instances' matrices (column-major, 16 an instance) and tints (rgb, times the vertices' own colours), and whether it casts a shadow. */
export function plants(x) {
  const { chunksX, chunksZ, plantKinds } = sizes(x);
  const random = rng(0x9a1a4ad);
  const out = [];
  for (let k = 0; k < plantKinds; k++) {
    const count = PLANTS_A_KIND;
    const matrices = new Float32Array(count * 16);
    const tints = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const px = (random() - 0.5) * chunksX * CHUNK;
      const pz = (random() - 0.5) * chunksZ * CHUNK;
      const yaw = random() * Math.PI * 2;
      const s = 0.7 + random() * 0.8;
      const c = Math.cos(yaw) * s, n = Math.sin(yaw) * s;
      matrices.set([c, 0, -n, 0, 0, s, 0, 0, n, 0, c, 0, px, heightAt(px, pz), pz, 1], i * 16);
      const tint = 0.85 + random() * 0.3;
      tints.set([tint, tint, tint * (0.9 + random() * 0.2)], i * 3);
    }
    out.push({ ...plantGeometry(k), count, matrices, tints, shadow: k % 2 === 0 });
  }
  return out;
}

/** The animals: for each kind its geometry, how many, and each one's walk (a circle: its centre, radius, speed and where on it it starts). */
export function animals(x) {
  const { chunksX, chunksZ, animalKinds } = sizes(x);
  const random = rng(0x5eed);
  const out = [];
  for (let k = 0; k < animalKinds; k++) {
    const count = ANIMALS_A_KIND;
    const walk = new Float32Array(count * 5);
    for (let i = 0; i < count; i++) walk.set([(random() - 0.5) * chunksX * CHUNK * 0.9, (random() - 0.5) * chunksZ * CHUNK * 0.9, 3 + random() * 12, 0.5 + random() * 1.5, random() * Math.PI * 2], i * 5);
    out.push({ ...animalGeometry(k), count, walk, matrices: new Float32Array(count * 16) });
  }
  return out;
}

/** Where every animal of a kind is at `t` seconds: its matrices written again (what the SANDBOX's ecosystem does each frame for what it draws). */
export function walkAnimals(kind, t) {
  const { walk, matrices, count } = kind;
  for (let i = 0; i < count; i++) {
    const a = walk[i * 5 + 4] + (t * walk[i * 5 + 3]) / walk[i * 5 + 2];
    const px = walk[i * 5] + Math.cos(a) * walk[i * 5 + 2];
    const pz = walk[i * 5 + 1] + Math.sin(a) * walk[i * 5 + 2];
    // Facing along the circle.
    const c = -Math.sin(a), s = Math.cos(a);
    const o = i * 16;
    matrices[o] = s; matrices[o + 1] = 0; matrices[o + 2] = -c; matrices[o + 3] = 0;
    matrices[o + 4] = 0; matrices[o + 5] = 1; matrices[o + 6] = 0; matrices[o + 7] = 0;
    matrices[o + 8] = c; matrices[o + 9] = 0; matrices[o + 10] = s; matrices[o + 11] = 0;
    matrices[o + 12] = px; matrices[o + 13] = heightAt(px, pz); matrices[o + 14] = pz; matrices[o + 15] = 1;
  }
}

/**
 * The figure: a tree of bones (hips, spine, head, arms, legs), a box round each, every vertex wholly its bone's.
 * `bones`: each one's parent (-1: none), where it starts in its parent's frame, and its length (it runs along +y).
 */
export function figure() {
  const bones = [];
  const add = (parent, x, y, z, length) => bones.push({ parent, x, y, z, length }) - 1;
  const hips = add(-1, 0, 2.2, 0, 0.4);
  let spine = hips;
  for (let i = 0; i < 4; i++) spine = add(spine, 0, i ? 0.4 : 0.4, 0, 0.4);
  add(spine, 0, 0.4, 0, 0.45);
  for (const side of [-1, 1]) {
    let arm = add(spine, side * 0.35, 0.3, 0, 0.2);
    for (let i = 0; i < 4; i++) arm = add(arm, 0, i ? 0.45 : 0.2, 0, 0.45);
    let leg = add(hips, side * 0.2, 0, 0, 0.1);
    for (let i = 0; i < 4; i++) leg = add(leg, 0, i ? 0.5 : 0.1, 0, 0.5);
  }
  // Where each bone starts in the figure's own frame at rest (arms and legs hang: their chains run downwards).
  const rest = bones.map(() => [0, 0, 0]);
  const down = bones.map(() => false);
  bones.forEach((b, i) => {
    const p = b.parent;
    down[i] = p >= 0 && (down[p] || Math.abs(b.x) > 0.01);
    const sign = p >= 0 && down[p] ? -1 : 1;
    rest[i] = p < 0 ? [b.x, b.y, b.z] : [rest[p][0] + b.x, rest[p][1] + sign * b.y, rest[p][2] + b.z];
  });
  const b = builder();
  const skin = [];
  bones.forEach((bone, i) => {
    const [x, y, z] = rest[i];
    const sign = down[i] ? -1 : 1;
    const before = b.done().positions.length / 3;
    const r = 0.11;
    const segments = 4;
    for (let s = 0; s < segments; s++) {
      const y0 = y + (sign * bone.length * s) / segments, y1 = y + (sign * bone.length * (s + 1)) / segments;
      b.box(x - r, Math.min(y0, y1), z - r, x + r, Math.max(y0, y1), z + r, [0.92, 0.88, 0.8], () => 0);
    }
    const after = b.done().positions.length / 3;
    for (let v = before; v < after; v++) skin.push(i);
  });
  return { ...b.done(), bones, rest, down, skin: new Uint16Array(skin) };
}

/** The slice's numbers, for the record. */
export function describe(x) {
  const s = sizes(x);
  const plant = plants(1).slice(0, 24);
  return { chunks: s.chunksX * s.chunksZ, chunkTriangles: CELLS * CELLS * 2, plantKinds: s.plantKinds, plantsAKind: PLANTS_A_KIND, plantTriangles: Math.round(plant.reduce((n, p) => n + p.triangles, 0) / plant.length), animalKinds: s.animalKinds, animalsAKind: ANIMALS_A_KIND, animalTriangles: 72, figureBones: figure().bones.length, figureTriangles: figure().triangles };
}

/** The sun's way (towards the light), the sky's and the ground's colours, the fog's. */
export const LIGHT = { dir: [0.5, 0.8, 0.33], sun: [1, 0.95, 0.85], sky: [0.75, 0.82, 1], ground: [0.45, 0.5, 0.4], fog: [0.8, 0.86, 0.95], fogDensity: 0.0035, shadowSize: 2048, shadowBox: 90 };
/** The view at `t` seconds: high over the slice's middle, turning slowly round it. */
export function view(t) {
  const a = t * 0.1;
  return { eye: [Math.sin(a) * 120, 45, Math.cos(a) * 120], at: [0, 2, 0], fov: 45, near: 0.5, far: 1500 };
}
