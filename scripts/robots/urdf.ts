import type { JointType, Vec3 } from "../../apps/web/src/world/robots/kinematics.ts";

/*
 * A small URDF reader for the robot asset build: just enough XML (elements,
 * attributes, comments, declarations; text content is ignored) and the parts of
 * URDF the world uses: links and their visuals (origin, mesh and scale, material
 * colour), and joints (type, origin, axis, limits, parent and child). Collision,
 * inertia and controller blocks are skipped. Only <link>, <joint> and <material>
 * directly under <robot> count, so a <joint> inside a <ros2_control> or
 * <transmission> block isn't mistaken for a real one.
 */

export interface XmlElement {
  tag: string;
  attrs: Record<string, string>;
  children: XmlElement[];
}

const ENTITIES: Record<string, string> = { "&lt;": "<", "&gt;": ">", "&amp;": "&", "&quot;": '"', "&apos;": "'" };
const decode = (s: string): string => s.replace(/&(lt|gt|amp|quot|apos);/g, (m) => ENTITIES[m]!);

/** Parses XML into elements (throws on malformed nesting). */
export function parseXml(source: string): XmlElement {
  const root: XmlElement = { tag: "#document", attrs: {}, children: [] };
  const stack: XmlElement[] = [root];
  let i = 0;
  while (i < source.length) {
    const lt = source.indexOf("<", i);
    if (lt < 0) break;
    if (source.startsWith("<!--", lt)) {
      const end = source.indexOf("-->", lt + 4);
      if (end < 0) throw new Error("unterminated comment");
      i = end + 3;
      continue;
    }
    if (source.startsWith("<?", lt) || source.startsWith("<!", lt)) {
      const end = source.indexOf(">", lt);
      if (end < 0) throw new Error("unterminated declaration");
      i = end + 1;
      continue;
    }
    if (source.startsWith("</", lt)) {
      const end = source.indexOf(">", lt);
      const tag = source.slice(lt + 2, end).trim();
      const open = stack.pop();
      if (!open || open.tag !== tag || stack.length === 0) throw new Error(`mismatched </${tag}>`);
      i = end + 1;
      continue;
    }
    // An opening tag: its name, attributes, maybe self-closing. Quoted values may hold '>'.
    let j = lt + 1;
    while (j < source.length && /[^\s/>]/.test(source[j]!)) j++;
    const tag = source.slice(lt + 1, j);
    if (!tag) throw new Error(`bad tag at ${lt}`);
    const attrs: Record<string, string> = {};
    let selfClosing = false;
    for (;;) {
      while (j < source.length && /\s/.test(source[j]!)) j++;
      if (j >= source.length) throw new Error(`unterminated <${tag}>`);
      if (source[j] === "/" && source[j + 1] === ">") {
        selfClosing = true;
        j += 2;
        break;
      }
      if (source[j] === ">") {
        j++;
        break;
      }
      const eq = source.indexOf("=", j);
      if (eq < 0) throw new Error(`bad attribute in <${tag}>`);
      const key = source.slice(j, eq).trim();
      let k = eq + 1;
      while (/\s/.test(source[k] ?? "")) k++;
      const quote = source[k];
      if (quote !== '"' && quote !== "'") throw new Error(`unquoted attribute ${key} in <${tag}>`);
      const close = source.indexOf(quote, k + 1);
      if (close < 0) throw new Error(`unterminated attribute ${key}`);
      attrs[key] = decode(source.slice(k + 1, close));
      j = close + 1;
    }
    const element: XmlElement = { tag, attrs, children: [] };
    stack[stack.length - 1]!.children.push(element);
    if (!selfClosing) stack.push(element);
    i = j;
  }
  if (stack.length !== 1) throw new Error(`unclosed <${stack[stack.length - 1]!.tag}>`);
  return root;
}

export interface Origin {
  xyz: Vec3;
  rpy: Vec3;
}

export interface Visual {
  origin: Origin;
  /** As written (e.g. "package://assets/base.stl"). */
  mesh: string | null;
  scale: Vec3;
  /** RGBA 0..1, if the URDF gives one (inline or by a named material). */
  rgba: [number, number, number, number] | null;
  material: string | null;
}

export interface Link {
  name: string;
  visuals: Visual[];
}

export interface Joint {
  name: string;
  type: JointType;
  parent: string;
  child: string;
  origin: Origin;
  axis: Vec3;
  lower: number;
  upper: number;
  /** Mimic joints follow another joint; the world treats them as their own. */
  mimic: string | null;
}

export interface Urdf {
  name: string;
  links: Link[];
  joints: Joint[];
}

const child = (e: XmlElement, tag: string): XmlElement | undefined => e.children.find((c) => c.tag === tag);

function numbers(s: string | undefined, n: number, fallback: number[]): number[] {
  if (s === undefined) return fallback;
  const parts = s.trim().split(/\s+/).map(Number);
  if (parts.length !== n || !parts.every(Number.isFinite)) throw new Error(`expected ${n} numbers, got "${s}"`);
  return parts;
}

const vec = (s: string | undefined, fallback: Vec3): Vec3 => numbers(s, 3, fallback) as Vec3;

function origin(e: XmlElement): Origin {
  const o = child(e, "origin");
  return { xyz: vec(o?.attrs.xyz, [0, 0, 0]), rpy: vec(o?.attrs.rpy, [0, 0, 0]) };
}

function rgbaOf(material: XmlElement | undefined): [number, number, number, number] | null {
  const color = material && child(material, "color");
  return color ? (numbers(color.attrs.rgba, 4, [1, 1, 1, 1]) as [number, number, number, number]) : null;
}

const JOINT_TYPES = new Set<string>(["revolute", "continuous", "prismatic", "fixed", "floating", "planar"]);

/** Reads a URDF document. */
export function parseUrdf(source: string): Urdf {
  const doc = parseXml(source);
  const robot = doc.children.find((c) => c.tag === "robot");
  if (!robot) throw new Error("no <robot>");
  const named = new Map<string, [number, number, number, number]>();
  for (const m of robot.children) {
    if (m.tag !== "material" || !m.attrs.name) continue;
    const rgba = rgbaOf(m);
    if (rgba) named.set(m.attrs.name, rgba);
  }
  const links: Link[] = [];
  const joints: Joint[] = [];
  for (const e of robot.children) {
    if (e.tag === "link") {
      if (!e.attrs.name) throw new Error("a <link> without a name");
      const visuals: Visual[] = [];
      for (const v of e.children) {
        if (v.tag !== "visual") continue;
        const geometry = child(v, "geometry");
        const mesh = geometry && child(geometry, "mesh");
        const material = child(v, "material");
        const materialName = material?.attrs.name ?? null;
        visuals.push({
          origin: origin(v),
          mesh: mesh?.attrs.filename ?? null,
          scale: vec(mesh?.attrs.scale, [1, 1, 1]),
          rgba: rgbaOf(material) ?? (materialName ? (named.get(materialName) ?? null) : null),
          material: materialName,
        });
      }
      links.push({ name: e.attrs.name, visuals });
    } else if (e.tag === "joint") {
      const type = e.attrs.type ?? "";
      if (!e.attrs.name || !JOINT_TYPES.has(type)) throw new Error(`joint ${e.attrs.name ?? "?"}: bad type ${type}`);
      if (type === "floating" || type === "planar") throw new Error(`joint ${e.attrs.name}: ${type} joints aren't supported`);
      const parent = child(e, "parent")?.attrs.link;
      const kid = child(e, "child")?.attrs.link;
      if (!parent || !kid) throw new Error(`joint ${e.attrs.name}: needs a parent and a child`);
      const limit = child(e, "limit");
      const lower = Number(limit?.attrs.lower ?? (type === "continuous" ? -Math.PI : 0));
      const upper = Number(limit?.attrs.upper ?? (type === "continuous" ? Math.PI : 0));
      if (!Number.isFinite(lower) || !Number.isFinite(upper)) throw new Error(`joint ${e.attrs.name}: bad limits`);
      joints.push({
        name: e.attrs.name,
        type: type as JointType,
        parent,
        child: kid,
        origin: origin(e),
        axis: vec(child(e, "axis")?.attrs.xyz, [1, 0, 0]),
        lower,
        upper,
        mimic: child(e, "mimic")?.attrs.joint ?? null,
      });
    }
  }
  return { name: robot.attrs.name ?? "robot", links, joints };
}
