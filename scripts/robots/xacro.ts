import { parseXml, type XmlElement } from "./urdf.ts";

/*
 * Just enough xacro for the robot asset build: a robot description written as
 * xacro macros (the NASA JPL Open Source Rover's is) expanded into plain URDF.
 * It knows <xacro:property>, <xacro:macro> with plain parameters, macro calls,
 * ${name} and ${arithmetic} in attributes (numbers, + − × ÷, brackets: parsed
 * here, never evaluated as code: the file comes from the internet), and
 * $(find package), which becomes a path relative to the URDF's folder. Includes
 * (Gazebo plugins, transmissions) and anything else xacro is dropped: the build
 * only reads links, joints and materials.
 */

const XACRO = "xacro:";

/** Evaluates a small arithmetic expression over numbers and named values. Throws on anything else. */
export function evaluate(expr: string, values: Readonly<Record<string, string>>): number {
  const tokens = expr.match(/\s*([A-Za-z_][A-Za-z0-9_]*|\d*\.?\d+(?:[eE][-+]?\d+)?|[-+*/()])/g);
  if (!tokens || tokens.join("").replace(/\s+/g, "") !== expr.replace(/\s+/g, "")) throw new Error(`xacro: can't read "${expr}"`);
  const t = tokens.map((s) => s.trim());
  let i = 0;
  const peek = () => t[i];
  const next = () => t[i++];
  const atom = (): number => {
    const s = next();
    if (s === undefined) throw new Error(`xacro: "${expr}" ends early`);
    if (s === "-") return -atom();
    if (s === "+") return atom();
    if (s === "(") {
      const v = sum();
      if (next() !== ")") throw new Error(`xacro: unbalanced "${expr}"`);
      return v;
    }
    if (/^[A-Za-z_]/.test(s)) {
      if (s === "pi") return Math.PI;
      const v = values[s];
      if (v === undefined) throw new Error(`xacro: no value for ${s}`);
      const n = Number(v);
      if (!Number.isFinite(n)) throw new Error(`xacro: ${s} isn't a number`);
      return n;
    }
    const n = Number(s);
    if (!Number.isFinite(n)) throw new Error(`xacro: bad number ${s}`);
    return n;
  };
  const product = (): number => {
    let v = atom();
    while (peek() === "*" || peek() === "/") v = next() === "*" ? v * atom() : v / atom();
    return v;
  };
  const sum = (): number => {
    let v = product();
    while (peek() === "+" || peek() === "-") v = next() === "+" ? v + product() : v - product();
    return v;
  };
  const v = sum();
  if (i !== t.length) throw new Error(`xacro: trailing "${t.slice(i).join(" ")}" in "${expr}"`);
  return v;
}

/** An attribute's value with every ${…} and $(find …) replaced. */
function substitute(value: string, values: Readonly<Record<string, string>>, packages: (name: string) => string): string {
  return value
    .replace(/\$\(find\s+([A-Za-z0-9_]+)\)/g, (_m, name: string) => packages(name))
    .replace(/\$\{([^}]*)\}/g, (_m, expr: string) => {
      const name = expr.trim();
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && values[name] !== undefined) return values[name]!;
      return String(evaluate(expr, values));
    });
}

const escape = (s: string): string => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function serialize(e: XmlElement): string {
  const attrs = Object.entries(e.attrs)
    .map(([k, v]) => ` ${k}="${escape(v)}"`)
    .join("");
  if (e.children.length === 0) return `<${e.tag}${attrs}/>`;
  return `<${e.tag}${attrs}>${e.children.map(serialize).join("")}</${e.tag}>`;
}

/**
 * Expands a xacro document into URDF text. `packages(name)` gives the path a $(find name) stands for (relative to
 * the URDF's folder, e.g. ".." when the URDF sits in the package's urdf/ folder).
 */
export function expandXacro(source: string, packages: (name: string) => string): string {
  const doc = parseXml(source);
  const robot = doc.children.find((c) => c.tag === "robot");
  if (!robot) throw new Error("xacro: no <robot>");
  const properties: Record<string, string> = {};
  const macros = new Map<string, { params: string[]; body: XmlElement[] }>();
  // Definitions first (a macro may be called before it's written).
  for (const e of robot.children) {
    if (e.tag === `${XACRO}property` && e.attrs.name !== undefined && e.attrs.value !== undefined) properties[e.attrs.name] = e.attrs.value;
    if (e.tag === `${XACRO}macro` && e.attrs.name) macros.set(e.attrs.name, { params: (e.attrs.params ?? "").split(/\s+/).filter(Boolean), body: e.children });
  }
  const out: XmlElement[] = [];
  const expand = (e: XmlElement, values: Readonly<Record<string, string>>, into: XmlElement[], depth: number): void => {
    if (depth > 20) throw new Error("xacro: macros nest too deep");
    if (e.tag.startsWith(XACRO)) {
      const name = e.tag.slice(XACRO.length);
      const macro = macros.get(name);
      if (!macro) return; // property, macro definition, include, or something the build doesn't need
      const args: Record<string, string> = { ...values };
      for (const p of macro.params) {
        const [key, fallback] = p.split(":=") as [string, string | undefined];
        const given = e.attrs[key];
        if (given === undefined && fallback === undefined) throw new Error(`xacro: ${name} needs ${key}`);
        args[key] = substitute(given ?? fallback!, values, packages);
      }
      for (const child of macro.body) expand(child, args, into, depth + 1);
      return;
    }
    const attrs: Record<string, string> = {};
    for (const [k, v] of Object.entries(e.attrs)) attrs[k] = substitute(v, values, packages);
    const copy: XmlElement = { tag: e.tag, attrs, children: [] };
    for (const child of e.children) expand(child, values, copy.children, depth);
    into.push(copy);
  };
  for (const e of robot.children) expand(e, properties, out, 0);
  const attrs = Object.fromEntries(Object.entries(robot.attrs).filter(([k]) => !k.startsWith("xmlns")));
  return `<?xml version="1.0"?>${serialize({ tag: "robot", attrs, children: out })}`;
}
