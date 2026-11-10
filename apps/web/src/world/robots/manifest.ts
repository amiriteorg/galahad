import type { JointSpec, JointType, KinematicTree, Vec3 } from "./kinematics.ts";

/*
 * The world's robots as compact assets (written by `bun scripts/robots/build.ts`
 * from each robot's URDF and meshes): a JSON manifest (the kinematic tree, its
 * joints and limits, named sites, the materials, the source and its licence) and
 * one binary of quantized geometry. Each link with something to draw has a range:
 * its vertices (positions as uint16 within the link's box, and a material index
 * each) and its triangles (uint16 indices into the link's own vertices).
 *
 * Binary layout: [positions: u16 × 3 per vertex, all links][materials: u8 per
 * vertex][padding to 2 bytes][indices: u16, all links]. Little-endian.
 *
 * The world fetches these from its own origin; `parseManifest` and `decodeMeshes`
 * check everything before it's used, so a bad or stale file is refused (and the
 * world draws its hand-made robots instead), never half-drawn.
 */

export const MANIFEST_FORMAT = 1;

export interface MeshRange {
  /** First vertex (in the whole binary) and how many. */
  vertexOffset: number;
  vertices: number;
  /** First index (in the whole binary) and how many (three per triangle). */
  indexOffset: number;
  indices: number;
  /** The box the quantized positions span, in the link's frame (metres). */
  min: Vec3;
  max: Vec3;
}

export interface LinkEntry {
  name: string;
  mesh: MeshRange | null;
}

/** A named frame on a link (a fingertip, a foot's sole, a head). */
export interface Site {
  name: string;
  link: string;
  xyz: Vec3;
  rpy: Vec3;
}

export interface RobotManifest {
  format: typeof MANIFEST_FORMAT;
  /** File stem, e.g. "open-duck-mini-v2". */
  name: string;
  /** What it is, for people: "Open Duck Mini v2". */
  title: string;
  source: { repo: string; commit: string; path: string; license: string };
  /** sRGB colours as 0xrrggbb. */
  materials: number[];
  /** Depth-first: the root first, every parent before its children. */
  links: LinkEntry[];
  joints: JointSpec[];
  sites: Site[];
  bin: { file: string; bytes: number; vertices: number; indices: number };
  triangles: number;
}

const JOINT_TYPES: readonly JointType[] = ["revolute", "continuous", "prismatic", "fixed"];
const NAME = /^[A-Za-z0-9_.-]{1,80}$/;
const MAX_VERTICES = 200_000;
const MAX_INDICES = 600_000;

function fail(what: string): never {
  throw new Error(`robot manifest: ${what}`);
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const int = (v: unknown, max: number): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max;

function vec3(v: unknown, what: string): Vec3 {
  if (!Array.isArray(v) || v.length !== 3 || !v.every(finite)) fail(`${what} must be three numbers`);
  const [x, y, z] = v as number[];
  return [x!, y!, z!];
}

function name(v: unknown, what: string): string {
  if (typeof v !== "string" || !NAME.test(v)) fail(`${what} must be a name`);
  return v;
}

function text(v: unknown, what: string, max = 200): string {
  if (typeof v !== "string" || v.length === 0 || v.length > max) fail(`${what} must be text`);
  return v;
}

/** Checks a manifest's shape, names and numbers (not yet against its binary: see `decodeMeshes`). */
export function parseManifest(json: unknown): RobotManifest {
  if (!isObject(json)) fail("not an object");
  if (json.format !== MANIFEST_FORMAT) fail(`unsupported format ${String(json.format)}`);
  const source = json.source;
  if (!isObject(source)) fail("source missing");
  const materials = json.materials;
  if (!Array.isArray(materials) || materials.length === 0 || materials.length > 255 || !materials.every((c) => int(c, 0xffffff))) fail("materials must be 1–255 colours");
  const bin = json.bin;
  if (!isObject(bin)) fail("bin missing");
  const { bytes, vertices, indices } = bin;
  if (!int(bytes, 16 << 20) || !int(vertices, MAX_VERTICES) || !int(indices, MAX_INDICES)) fail("bin sizes out of range");
  if (typeof bin.file !== "string" || !/^[a-z0-9-]+(\.[a-f0-9]{8})?\.bin$/.test(bin.file)) fail("bin file name");
  if (!Array.isArray(json.links) || json.links.length === 0 || json.links.length > 400) fail("links");
  const linkNames = new Set<string>();
  const links: LinkEntry[] = json.links.map((l, i) => {
    if (!isObject(l)) fail(`link ${i}`);
    const n = name(l.name, `link ${i} name`);
    if (linkNames.has(n)) fail(`duplicate link ${n}`);
    linkNames.add(n);
    if (l.mesh === null) return { name: n, mesh: null };
    const m = l.mesh;
    if (!isObject(m)) fail(`link ${n} mesh`);
    if (!int(m.vertexOffset, MAX_VERTICES) || !int(m.vertices, 65_535) || !int(m.indexOffset, MAX_INDICES) || !int(m.indices, MAX_INDICES) || m.indices % 3 !== 0) fail(`link ${n} mesh range`);
    if (m.vertexOffset + m.vertices > vertices || m.indexOffset + m.indices > indices) fail(`link ${n} mesh outside the binary`);
    return { name: n, mesh: { vertexOffset: m.vertexOffset, vertices: m.vertices, indexOffset: m.indexOffset, indices: m.indices, min: vec3(m.min, `${n} min`), max: vec3(m.max, `${n} max`) } };
  });
  if (!Array.isArray(json.joints) || json.joints.length !== links.length - 1) fail("a tree of n links has n − 1 joints");
  const jointNames = new Set<string>();
  const joints: JointSpec[] = json.joints.map((j, i) => {
    if (!isObject(j)) fail(`joint ${i}`);
    const n = name(j.name, `joint ${i} name`);
    if (jointNames.has(n)) fail(`duplicate joint ${n}`);
    jointNames.add(n);
    if (!JOINT_TYPES.includes(j.type as JointType)) fail(`joint ${n} type`);
    const parent = name(j.parent, `joint ${n} parent`);
    const child = name(j.child, `joint ${n} child`);
    if (!linkNames.has(parent) || !linkNames.has(child)) fail(`joint ${n} names a link that isn't there`);
    if (!finite(j.lower) || !finite(j.upper) || j.lower > j.upper) fail(`joint ${n} limits`);
    return { name: n, type: j.type as JointType, parent, child, xyz: vec3(j.xyz, `${n} xyz`), rpy: vec3(j.rpy, `${n} rpy`), axis: vec3(j.axis, `${n} axis`), lower: j.lower, upper: j.upper };
  });
  if (!Array.isArray(json.sites) || json.sites.length > 64) fail("sites");
  const sites: Site[] = json.sites.map((s, i) => {
    if (!isObject(s)) fail(`site ${i}`);
    const link = name(s.link, `site ${i} link`);
    if (!linkNames.has(link)) fail(`site ${i} names a link that isn't there`);
    return { name: name(s.name, `site ${i} name`), link, xyz: vec3(s.xyz, `site ${i} xyz`), rpy: vec3(s.rpy, `site ${i} rpy`) };
  });
  const triangles = json.triangles;
  if (!int(triangles, MAX_INDICES / 3) || triangles * 3 !== indices) fail("triangle count");
  return {
    format: MANIFEST_FORMAT,
    name: name(json.name, "name"),
    title: text(json.title, "title"),
    source: { repo: text(source.repo, "source repo"), commit: text(source.commit, "source commit", 64), path: text(source.path, "source path"), license: text(source.license, "source license", 40) },
    materials: materials as number[],
    links,
    joints,
    sites,
    bin: { file: bin.file, bytes, vertices, indices },
    triangles,
  };
}

export const treeOf = (m: RobotManifest): KinematicTree => ({ links: m.links.map((l) => l.name), joints: m.joints });

/** Byte offsets of the three sections, for a binary of `vertices` vertices and `indices` indices. */
export function binLayout(vertices: number, indices: number): { positions: number; materials: number; indices: number; bytes: number } {
  const materials = vertices * 6;
  const idx = materials + vertices + ((materials + vertices) & 1);
  return { positions: 0, materials, indices: idx, bytes: idx + indices * 2 };
}

/** One link's geometry, decoded: positions (metres, link frame), a material per vertex, indexed triangles. */
export interface LinkMesh {
  link: string;
  positions: Float32Array;
  materials: Uint8Array;
  indices: Uint16Array;
}

/** Decodes every link's geometry from the binary, checking that it fits the manifest exactly. */
export function decodeMeshes(manifest: RobotManifest, buffer: ArrayBuffer): LinkMesh[] {
  const { vertices, indices } = manifest.bin;
  const layout = binLayout(vertices, indices);
  if (buffer.byteLength !== manifest.bin.bytes || layout.bytes !== buffer.byteLength) fail(`binary is ${buffer.byteLength} bytes, expected ${layout.bytes}`);
  const view = new DataView(buffer);
  const out: LinkMesh[] = [];
  const materialCount = manifest.materials.length;
  for (const link of manifest.links) {
    const m = link.mesh;
    if (!m) continue;
    const positions = new Float32Array(m.vertices * 3);
    const materials = new Uint8Array(m.vertices);
    for (let v = 0; v < m.vertices; v++) {
      const at = layout.positions + (m.vertexOffset + v) * 6;
      for (let k = 0; k < 3; k++) {
        const u = view.getUint16(at + k * 2, true) / 65535;
        positions[v * 3 + k] = m.min[k]! + (m.max[k]! - m.min[k]!) * u;
      }
      const material = view.getUint8(layout.materials + m.vertexOffset + v);
      if (material >= materialCount) fail(`${link.name}: material ${material} out of range`);
      materials[v] = material;
    }
    const idx = new Uint16Array(m.indices);
    for (let i = 0; i < m.indices; i++) {
      const value = view.getUint16(layout.indices + (m.indexOffset + i) * 2, true);
      if (value >= m.vertices) fail(`${link.name}: index ${value} out of range`);
      idx[i] = value;
    }
    out.push({ link: link.name, positions, materials, indices: idx });
  }
  return out;
}
