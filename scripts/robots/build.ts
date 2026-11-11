#!/usr/bin/env bun
/*
 * Builds the world's robot assets from the real open-source models.
 *
 *   bun scripts/robots/build.ts            # all robots
 *   bun scripts/robots/build.ts so-101     # one
 *
 * For each robot in robots.ts it fetches the URDF and its STL meshes at the pinned
 * commit (raw.githubusercontent.com; cached under the OS temp folder, so a rebuild
 * doesn't fetch again), checks the repository's licence is Apache-2.0, and writes
 * into apps/web/src/world/assets/robots/:
 *
 *   <robot>.json          the manifest: kinematic tree, joints and limits, sites, materials, source
 *   <robot>.<hash>.bin    the geometry: positions quantized per link, a material per vertex, indices
 *   index.ts              each manifest's URL with a content version, for the world to fetch
 *   NOTICE.txt, LICENSE.txt   attribution, and the Apache License 2.0
 *
 * Links joined by fixed joints are merged into one rigid part (one draw call); each
 * part's meshes are welded, then simplified by edge collapse to the robot's
 * triangle budget (one error bound for every part, searched for). The generated files are
 * committed: builds never fetch.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fromXyzRpy, invertRigid, type JointSpec, type Mat4, mat4, multiply, rpyOf, Skeleton, type Vec3 } from "../../apps/web/src/world/robots/kinematics.ts";
import { binLayout, type LinkEntry, MANIFEST_FORMAT, parseManifest, type RobotManifest, type Site } from "../../apps/web/src/world/robots/manifest.ts";
import { type Indexed, parseStl, type Soup, simplify, transformSoup, weld } from "./mesh.ts";
import { ROBOTS, type RobotSpec } from "./robots.ts";
import { type Joint, parseUrdf, type Urdf } from "./urdf.ts";
import { expandXacro } from "./xacro.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const OUT_DIR = join(REPO_ROOT, "apps/web/src/world/assets/robots");
const CACHE = join(tmpdir(), "galahad-robot-sources");

// ---------- fetching (pinned, cached) ----------

const LFS_POINTER = /^version https:\/\/git-lfs\.github\.com\/spec\/v1\noid sha256:([0-9a-f]{64})\nsize (\d+)\n?$/;

/** A file of the repository at the commit; Git LFS pointers are followed (and the content checked against the pointer's hash). */
async function fetchRepoFile(repo: string, commit: string, path: string, optional = false): Promise<Uint8Array | null> {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`${repo}: pin a full commit SHA`);
  const local = join(CACHE, `${repo.replace("/", "__")}@${commit}`, ...path.split("/"));
  let bytes: Uint8Array | null;
  try {
    bytes = new Uint8Array(readFileSync(local));
  } catch {
    bytes = await download(`https://raw.githubusercontent.com/${repo}/${commit}/${path.split("/").map(encodeURIComponent).join("/")}`, optional);
    if (!bytes) return null;
    mkdirSync(dirname(local), { recursive: true });
    writeFileSync(local, bytes);
  }
  const pointer = bytes.byteLength < 200 ? LFS_POINTER.exec(new TextDecoder().decode(bytes)) : null;
  if (!pointer) return bytes;
  const [, oid, size] = pointer;
  const blob = join(CACHE, "lfs", oid!);
  let content: Uint8Array;
  try {
    content = new Uint8Array(readFileSync(blob));
  } catch {
    content = (await download(`https://media.githubusercontent.com/media/${repo}/${commit}/${path.split("/").map(encodeURIComponent).join("/")}`, false))!;
    mkdirSync(dirname(blob), { recursive: true });
    writeFileSync(blob, content);
  }
  if (content.byteLength !== Number(size) || createHash("sha256").update(content).digest("hex") !== oid) throw new Error(`${path}: LFS content doesn't match its pointer`);
  return content;
}

async function download(url: string, optional: boolean): Promise<Uint8Array | null> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, { headers: { "user-agent": "galahad-robot-assets" } });
    if (response.status === 404 && optional) return null;
    if (response.ok) return new Uint8Array(await response.arrayBuffer());
    // A network hiccup isn't a reason to fail a build; a missing file is.
    if (response.status < 500 || attempt >= 2) throw new Error(`${url}: HTTP ${response.status}`);
  }
}

async function pool<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await work(items[i]!);
      }
    }),
  );
  return out;
}

/** A mesh filename as the URDF writes it ("package://assets/x.stl", "package:///x.stl", "assets/x.stl"), from the repository's root. */
export function meshPath(urdfPath: string, filename: string): string {
  const relative = filename.replace(/^package:\/\/+/, "").replace(/^file:\/\/+/, "");
  const path = posix.normalize(posix.join(posix.dirname(urdfPath), relative));
  if (path.startsWith("..")) throw new Error(`mesh ${filename} is outside the repository`);
  return path;
}

const stem = (filename: string): string => posix.basename(filename).replace(/\.[^.]+$/, "");

// ---------- the kinematic tree: merge rigid parts, re-hang detached ones ----------

const r7 = (x: number): number => Math.round(x * 1e7) / 1e7;
const v7 = (v: readonly number[]): Vec3 => [r7(v[0]!), r7(v[1]!), r7(v[2]!)];

function treeOfUrdf(urdf: Urdf): { links: string[]; joints: JointSpec[] } {
  return {
    links: urdf.links.map((l) => l.name),
    joints: urdf.joints.map((j) => ({ name: j.name, type: j.type, parent: j.parent, child: j.child, xyz: j.origin.xyz, rpy: j.origin.rpy, axis: j.axis, lower: j.lower, upper: j.upper })),
  };
}

interface Group {
  /** The output link's name. */
  name: string;
  /** Its frame at rest, in the robot's root frame. */
  frame: Mat4;
  /** URDF links rigidly part of it. */
  members: string[];
}

export interface Plan {
  groups: Map<string, Group>;
  /** Each URDF link's group. */
  groupOf: Map<string, string>;
  joints: JointSpec[];
  sites: Site[];
  /** Each URDF link's frame at rest. */
  rest: Map<string, Mat4>;
}

/** Decides the output tree: which URDF links merge into which rigid part, and the joints between parts (re-expressed in the parts' frames). */
export function plan(urdf: Urdf, spec: Pick<RobotSpec, "movable" | "detach" | "sites">): Plan {
  const sk = new Skeleton(treeOfUrdf(urdf));
  const rest = new Map<string, Mat4>();
  sk.links.forEach((name, i) => rest.set(name, sk.world.slice(i * 16, i * 16 + 16)));
  const urdfJoint = new Map<string, Joint>(urdf.joints.map((j) => [j.child, j]));
  const movable = (j: Joint): boolean => (spec.movable ? spec.movable(j.name) : j.type !== "fixed");
  const detach = spec.detach;
  const groupOf = new Map<string, string>();
  const groups = new Map<string, Group>();
  const joints: JointSpec[] = [];
  for (const link of sk.links) {
    const via = urdfJoint.get(link);
    if (detach && link === detach.link) {
      const pivot = rest.get(detach.pivot);
      const parentFrame = groups.get(groupOf.get(detach.parent) ?? "")?.frame;
      if (!pivot || !parentFrame) throw new Error(`detach: no ${detach.pivot} or ${detach.parent} before ${link}`);
      // The new joints turn about the pivot, along the robot's own axes at rest.
      const frame = mat4();
      frame[12] = pivot[12]!;
      frame[13] = pivot[13]!;
      frame[14] = pivot[14]!;
      const origin = multiply(invertRigid(parentFrame), frame, mat4());
      let parent = groupOf.get(detach.parent)!;
      detach.joints.forEach((j, i) => {
        const child = i === detach.joints.length - 1 ? link : `${j.name}_link`;
        const first = i === 0;
        joints.push({ name: j.name, type: "revolute", parent, child, xyz: first ? v7([origin[12]!, origin[13]!, origin[14]!]) : [0, 0, 0], rpy: first ? v7(rpyOf(origin)) : [0, 0, 0], axis: j.axis, lower: j.lower, upper: j.upper });
        if (child !== link) groups.set(child, { name: child, frame, members: [] });
        parent = child;
      });
      groups.set(link, { name: link, frame, members: [link] });
      groupOf.set(link, link);
      continue;
    }
    if (!via || movable(via)) {
      groups.set(link, { name: link, frame: rest.get(link)!, members: [link] });
      groupOf.set(link, link);
      if (via) {
        const parentGroup = groups.get(groupOf.get(via.parent)!)!;
        const origin = multiply(invertRigid(parentGroup.frame), rest.get(link)!, mat4());
        joints.push({ name: via.name, type: via.type, parent: parentGroup.name, child: link, xyz: v7([origin[12]!, origin[13]!, origin[14]!]), rpy: v7(rpyOf(origin)), axis: v7(via.axis), lower: r7(via.lower), upper: r7(via.upper) });
      }
      continue;
    }
    const g = groupOf.get(via.parent)!;
    groupOf.set(link, g);
    groups.get(g)!.members.push(link);
  }
  const sites: Site[] = spec.sites.map((name) => {
    const g = groups.get(groupOf.get(name) ?? "");
    const frame = rest.get(name);
    if (!g || !frame) throw new Error(`no site link ${name}`);
    const local = multiply(invertRigid(g.frame), frame, mat4());
    return { name, link: g.name, xyz: v7([local[12]!, local[13]!, local[14]!]), rpy: v7(rpyOf(local)) };
  });
  return { groups, groupOf, joints, sites, rest };
}

// ---------- geometry ----------

interface Piece {
  group: string;
  material: number;
  mesh: Indexed;
}

/** Simplifies every piece to one error (metres). */
function reduce(pieces: Piece[], error: number): Indexed[] {
  return pieces.map((p) => simplify(p.mesh, error));
}

const triangles = (meshes: Indexed[]): number => meshes.reduce((n, m) => n + m.indices.length / 3, 0);

/** The smallest error (so the most detail), the same for every part, that keeps the robot within its budget. */
function fitBudget(pieces: Piece[], budget: number): { error: number; meshes: Indexed[] } {
  let lo = 0.00005;
  let hi = 0.02;
  let best = { error: hi, meshes: reduce(pieces, hi) };
  if (triangles(best.meshes) > budget) throw new Error(`even ${hi * 1000} mm of error exceeds the budget`);
  for (let i = 0; i < 14; i++) {
    const mid = Math.sqrt(lo * hi);
    const meshes = reduce(pieces, mid);
    if (triangles(meshes) <= budget) {
      best = { error: mid, meshes };
      hi = mid;
    } else lo = mid;
  }
  return best;
}

const hex = (rgba: readonly number[]): number => (Math.round(rgba[0]! * 255) << 16) | (Math.round(rgba[1]! * 255) << 8) | Math.round(rgba[2]! * 255);

// ---------- one robot ----------

export interface Built {
  manifest: RobotManifest;
  json: string;
  bin: Uint8Array;
  /** The simplification's error bound (metres). */
  error: number;
  rawTriangles: number;
}

export async function buildRobot(spec: RobotSpec, log: (line: string) => void = () => {}): Promise<Built> {
  const licence = await fetchRepoFile(spec.repo, spec.commit, spec.license ?? "LICENSE");
  const licenceText = new TextDecoder().decode(licence!);
  if (!/Apache License/.test(licenceText) || !/Version 2\.0/.test(licenceText)) throw new Error(`${spec.repo}: not Apache-2.0`);
  if (spec.copyright && !licenceText.replace(/\s+/g, " ").includes(spec.copyright)) throw new Error(`${spec.repo}: its licence no longer carries "${spec.copyright}"`);
  const source = new TextDecoder().decode((await fetchRepoFile(spec.repo, spec.commit, spec.urdf))!);
  const xacro = spec.xacro;
  const urdf = parseUrdf(xacro ? expandXacro(source, (name) => xacro[name] ?? ((): never => { throw new Error(`$(find ${name}): unknown package`); })()) : source);
  for (const [name, free] of Object.entries(spec.free ?? {})) {
    const j = urdf.joints.find((x) => x.name === name);
    if (!j) throw new Error(`${spec.repo}: no joint ${name} to free`);
    Object.assign(j, { type: "revolute", axis: free.axis, lower: free.lower, upper: free.upper });
  }
  const p = plan(urdf, spec);

  // Every mesh file once.
  const files = [...new Set(urdf.links.flatMap((l) => l.visuals.flatMap((v) => (v.mesh && !spec.skip?.test(stem(v.mesh)) ? [meshPath(spec.urdf, v.mesh)] : []))))];
  const soups = new Map<string, Soup>();
  await pool(files, 8, async (path) => {
    soups.set(path, parseStl((await fetchRepoFile(spec.repo, spec.commit, path))!));
  });
  log(`  ${files.length} mesh files`);

  // Each part's visuals in the part's frame, grouped by colour.
  const palette: number[] = [];
  const colourIndex = (rgba: readonly number[]): number => {
    const c = hex(rgba);
    let i = palette.indexOf(c);
    if (i < 0) {
      i = palette.length;
      palette.push(c);
    }
    return i;
  };
  const byPiece = new Map<string, Soup[]>();
  let rawTriangles = 0;
  for (const link of urdf.links) {
    const group = p.groups.get(p.groupOf.get(link.name)!)!;
    const toGroup = multiply(invertRigid(group.frame), p.rest.get(link.name)!, mat4());
    for (const v of link.visuals) {
      if (!v.mesh || spec.skip?.test(stem(v.mesh))) continue;
      const soup = soups.get(meshPath(spec.urdf, v.mesh))!;
      const m = multiply(toGroup, fromXyzRpy(v.origin.xyz, v.origin.rpy), mat4());
      const material = colourIndex(v.rgba ?? spec.defaultRgba);
      const key = `${group.name}\u0000${material}`;
      const list = byPiece.get(key) ?? [];
      list.push(transformSoup(soup, m, v.scale));
      byPiece.set(key, list);
      rawTriangles += soup.length / 9;
    }
  }
  const pieces: Piece[] = [...byPiece].map(([key, list]) => {
    const [group, material] = key.split("\u0000") as [string, string];
    const all = new Float32Array(list.reduce((n, s) => n + s.length, 0));
    let at = 0;
    for (const s of list) {
      all.set(s, at);
      at += s.length;
    }
    return { group, material: Number(material), mesh: weld(all) };
  });
  const { error, meshes } = fitBudget(pieces, spec.budget);
  log(`  ${rawTriangles} triangles → ${triangles(meshes)} (within ${(error * 1000).toFixed(2)} mm)`);

  // The output tree, depth-first, and each part's geometry.
  const names = [...p.groups.keys()];
  const order = new Skeleton({ links: names, joints: p.joints }).links;
  const positions: number[] = [];
  const materials: number[] = [];
  const indices: number[] = [];
  const links: LinkEntry[] = order.map((name) => {
    const parts = pieces.map((piece, i) => ({ piece, mesh: meshes[i]! })).filter((x) => x.piece.group === name && x.mesh.indices.length > 0);
    if (parts.length === 0) return { name, mesh: null };
    const min: Vec3 = [Infinity, Infinity, Infinity];
    const max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const { mesh } of parts) {
      for (let i = 0; i < mesh.positions.length; i++) {
        min[i % 3] = Math.min(min[i % 3]!, mesh.positions[i]!);
        max[i % 3] = Math.max(max[i % 3]!, mesh.positions[i]!);
      }
    }
    for (let k = 0; k < 3; k++) {
      min[k] = Math.floor(min[k]! * 1e6) / 1e6;
      max[k] = Math.max(min[k]! + 1e-6, Math.ceil(max[k]! * 1e6) / 1e6);
    }
    const vertexOffset = positions.length / 3;
    const indexOffset = indices.length;
    let local = 0;
    for (const { piece, mesh } of parts) {
      for (let v = 0; v < mesh.positions.length / 3; v++) {
        for (let k = 0; k < 3; k++) positions.push(Math.round(((mesh.positions[v * 3 + k]! - min[k]!) / (max[k]! - min[k]!)) * 65535));
        materials.push(piece.material);
      }
      for (const i of mesh.indices) indices.push(local + i);
      local += mesh.positions.length / 3;
    }
    if (local > 65535) throw new Error(`${name}: ${local} vertices won't fit 16-bit indices`);
    return { name, mesh: { vertexOffset, vertices: local, indexOffset, indices: indices.length - indexOffset, min, max } };
  });

  const vertices = positions.length / 3;
  const layout = binLayout(vertices, indices.length);
  const bin = new Uint8Array(layout.bytes);
  const view = new DataView(bin.buffer);
  positions.forEach((q, i) => view.setUint16(layout.positions + i * 2, q, true));
  materials.forEach((m, i) => view.setUint8(layout.materials + i, m));
  indices.forEach((x, i) => view.setUint16(layout.indices + i * 2, x, true));
  const hash = createHash("sha256").update(bin).digest("hex").slice(0, 8);
  const manifest: RobotManifest = {
    format: MANIFEST_FORMAT,
    name: spec.name,
    title: spec.title,
    source: { repo: `https://github.com/${spec.repo}`, commit: spec.commit, path: spec.urdf, license: "Apache-2.0" },
    materials: palette,
    links,
    joints: order.slice(1).map((child) => p.joints.find((j) => j.child === child)!),
    sites: p.sites,
    bin: { file: `${spec.name}.${hash}.bin`, bytes: bin.byteLength, vertices, indices: indices.length },
    triangles: indices.length / 3,
  };
  parseManifest(manifest); // what the world will check, checked now
  return { manifest, json: `${JSON.stringify(manifest, null, 1)}\n`, bin, error, rawTriangles };
}

// ---------- all of them ----------

function notice(specs: readonly RobotSpec[]): string {
  const lines = [
    "Robot models in the SANDBOX",
    "===========================",
    "",
    "The robots drawn in Galahad's world are built from these open-source robot",
    "descriptions, each licensed under the Apache License, Version 2.0 (LICENSE.txt",
    "beside this file). Their upstream repositories carry no NOTICE file.",
    "",
  ];
  for (const s of specs) {
    lines.push(`${s.title}`, `  Source:  https://github.com/${s.repo}`, `  Commit:  ${s.commit}`, `  Files:   ${s.urdf} and the meshes it names`, "  License: Apache-2.0", ...(s.copyright ? [`  ${s.copyright}`] : []), "");
  }
  lines.push(
    "Changes made (Apache-2.0 §4(b)): by scripts/robots/build.ts in the Galahad",
    "repository. Each model's links joined by fixed joints were merged into rigid",
    "parts; parts sealed inside a shell and tiny fasteners and connectors were left",
    "out; the meshes were welded and simplified (quadric edge collapse) to a",
    "triangle budget, quantized, and stored with the kinematic tree in a compact",
    "format.",
    "Reachy Mini's head, carried in the original by a Stewart platform (a closed",
    "chain), is instead hung on yaw, pitch and roll joints about its centre.",
    "The Open Source Rover's description (xacro) was expanded to plain URDF, and",
    "its rockers, fixed to the body there, turn on the body as on the real rover.",
    "",
  );
  return lines.join("\n");
}

async function main(): Promise<void> {
  const only = process.argv.slice(2);
  const specs = only.length ? ROBOTS.filter((r) => only.includes(r.name)) : ROBOTS;
  if (specs.length === 0) throw new Error(`no such robot: ${only.join(", ")} (have ${ROBOTS.map((r) => r.name).join(", ")})`);
  mkdirSync(OUT_DIR, { recursive: true });
  for (const spec of specs) {
    console.log(`${spec.title} (${spec.repo}@${spec.commit.slice(0, 7)})`);
    const built = await buildRobot(spec, (line) => console.log(line));
    // Replace this robot's earlier binaries (only files this script names).
    for (const f of readdirSync(OUT_DIR)) if (new RegExp(`^${spec.name}\\.[0-9a-f]{8}\\.bin$`).test(f)) rmSync(join(OUT_DIR, f));
    writeFileSync(join(OUT_DIR, built.manifest.bin.file), built.bin);
    writeFileSync(join(OUT_DIR, `${spec.name}.json`), built.json);
    console.log(`  ${built.manifest.links.filter((l) => l.mesh).length} parts, ${built.manifest.joints.filter((j) => j.type !== "fixed").length} joints; ${built.bin.byteLength} + ${built.json.length} bytes`);
  }
  // The index the world fetches by: every robot on disk, each with its content's version.
  const entries = readdirSync(OUT_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const text = readFileSync(join(OUT_DIR, f));
      const version = createHash("sha256").update(text).digest("hex").slice(0, 8);
      return `  "${f.replace(/\.json$/, "")}": "${f}?v=${version}",`;
    });
  writeFileSync(
    join(OUT_DIR, "index.ts"),
    `// Generated by scripts/robots/build.ts: each robot's manifest, versioned by its content (so it can be cached for good).\nexport const ROBOT_MANIFESTS: Record<string, string> = {\n${entries.join("\n")}\n};\n`,
  );
  writeFileSync(join(OUT_DIR, "NOTICE.txt"), notice(ROBOTS));
  writeFileSync(join(OUT_DIR, "LICENSE.txt"), new TextDecoder().decode((await fetchRepoFile(ROBOTS[0]!.repo, ROBOTS[0]!.commit, "LICENSE"))!));
}

if (import.meta.main) await main();
