import { z } from "zod";
import { findSecrets } from "./secret-scan.ts";

/*
 * Connectors: how Galahad reaches the services you use (GitHub, Cloudflare,
 * Home Assistant…). A connector is a manifest, data rather than code: one pinned
 * origin, the vault secret it authenticates with, and a set of tools. Each tool is
 * one HTTP request template plus its oath class, which decides whether Galahad
 * may simply do it (read, create, modify) or must ask you first (outward, delete).
 *
 * The node that runs a call injects the key on the way out, and only to the origin
 * the key was pinned to when you entered it. No connector code ever runs, and no
 * model, arm or loop ever sees a key.
 */

const Id = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/, "lowercase letters, digits and - (max 40)");
export const ToolName = z.string().regex(/^[a-z][a-z0-9_.-]{0,47}$/, "lowercase letters, digits, . _ - (max 48)");
const ParamName = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/);
const SecretName = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/);
const HeaderName = z.string().regex(/^[A-Za-z0-9-]{1,64}$/);

/** Headers a manifest may never set: credentials are the broker's job, routing is the fetch's. */
const RESERVED_HEADERS = /^(authorization|proxy-.*|cookie|set-cookie|host|x-api-key|content-length|connection|transfer-encoding)$/i;

export const ConnectorParam = z.strictObject({
  type: z.enum(["string", "integer", "number", "boolean"]),
  description: z.string().max(300).optional(),
  required: z.boolean().optional(),
  enum: z.array(z.string().max(100)).min(1).max(64).optional(),
  /** A regular expression the whole value must match. */
  pattern: z.string().max(200).optional(),
  /** Where the value goes. Default: the path if the path names it, else the query (GET) or the JSON body. */
  in: z.enum(["path", "query", "body"]).optional(),
});
export type ConnectorParam = z.infer<typeof ConnectorParam>;

export const ToolClass = z.enum(["read", "create", "modify", "outward", "delete"]);

export const ConnectorTool = z.strictObject({
  description: z.string().min(1).max(500),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  /** Relative to the origin (and basePath), with {param} placeholders. */
  path: z
    .string()
    .max(300)
    .regex(/^\/[A-Za-z0-9._~\-/{}:@!$&'()*+,;=%]*$/, "an absolute path such as /repos/{owner}/{repo}"),
  params: z.record(ParamName, ConnectorParam).optional(),
  /** The oath class: read, create and modify run freely (logged); outward and delete ask you first. */
  class: ToolClass,
});
export type ConnectorTool = z.infer<typeof ConnectorTool>;

const Origin = z
  .string()
  .max(256)
  .regex(/^https?:\/\/[^/?#\s]+$/, "an origin such as https://api.github.com (no path)")
  .refine((origin) => {
    try {
      const url = new URL(origin);
      // Plain http only for this machine and private networks (Home Assistant on the LAN, a tailnet service).
      return url.protocol === "https:" || isPrivateHost(url.hostname);
    } catch {
      return false;
    }
  }, "use https (plain http only for localhost and private networks)");

export const ConnectorAuth = z.strictObject({
  /** The vault secret holding the key. Its pinned origin must be this connector's origin. */
  secret: SecretName,
  /** bearer: Authorization: Bearer <key> · header: <header>: <key> · basic: the key is "user:password". */
  scheme: z.enum(["bearer", "header", "basic"]),
  header: HeaderName.optional(),
  /** Call without a key when none is set (public APIs with a lower rate limit). */
  optional: z.boolean().optional(),
});

export const ConnectorManifest = z
  .strictObject({
    id: Id,
    label: z.string().min(1).max(64),
    description: z.string().max(500).optional(),
    origin: Origin,
    basePath: z
      .string()
      .max(100)
      .regex(/^(\/[A-Za-z0-9._~-]+)+$/)
      .optional(),
    auth: ConnectorAuth.optional(),
    headers: z.record(HeaderName, z.string().max(300)).optional(),
    tools: z.record(ToolName, ConnectorTool),
  })
  .superRefine((manifest, issue) => {
    const tools = Object.entries(manifest.tools);
    if (tools.length === 0 || tools.length > 64) issue.addIssue({ code: "custom", message: "a connector has 1 to 64 tools", path: ["tools"] });
    if (manifest.auth?.scheme === "header" && !manifest.auth.header) {
      issue.addIssue({ code: "custom", message: "auth scheme header needs a header name", path: ["auth", "header"] });
    }
    if (manifest.auth?.header && RESERVED_HEADERS.test(manifest.auth.header) && manifest.auth.header.toLowerCase() !== "x-api-key") {
      issue.addIssue({ code: "custom", message: `the key can't go in ${manifest.auth.header}`, path: ["auth", "header"] });
    }
    for (const [name, value] of Object.entries(manifest.headers ?? {})) {
      if (RESERVED_HEADERS.test(name)) issue.addIssue({ code: "custom", message: `a manifest can't set ${name}`, path: ["headers", name] });
      if (findSecrets(value).length) issue.addIssue({ code: "custom", message: "keys go in the vault, never in a manifest", path: ["headers", name] });
    }
    for (const [name, tool] of tools) {
      const where = ["tools", name];
      if (!classFits(tool.method, tool.class)) {
        issue.addIssue({ code: "custom", message: `${tool.method} can't be class ${tool.class} (${CLASS_RULE})`, path: [...where, "class"] });
      }
      const params = tool.params ?? {};
      const placeholders = [...tool.path.matchAll(/\{([^}]*)\}/g)].map((m) => m[1]!);
      if (/[{}]/.test(tool.path.replace(/\{[a-zA-Z][a-zA-Z0-9_]{0,39}\}/g, ""))) {
        issue.addIssue({ code: "custom", message: "bad {placeholder} in path", path: [...where, "path"] });
      }
      if (/\/\.\.?(\/|$)|\/\//.test(tool.path)) issue.addIssue({ code: "custom", message: "no . or .. segments or // in paths", path: [...where, "path"] });
      for (const placeholder of placeholders) {
        const param = params[placeholder];
        if (!param) issue.addIssue({ code: "custom", message: `{${placeholder}} is not a declared param`, path: [...where, "path"] });
        else if (param.in && param.in !== "path") issue.addIssue({ code: "custom", message: `{${placeholder}} must be in: path`, path: [...where, "params", placeholder] });
      }
      for (const [pname, param] of Object.entries(params)) {
        if (param.in === "path" && !placeholders.includes(pname)) {
          issue.addIssue({ code: "custom", message: `the path has no {${pname}}`, path: [...where, "params", pname] });
        }
        if (param.in === "body" && tool.method === "GET") issue.addIssue({ code: "custom", message: "GET has no body", path: [...where, "params", pname] });
        if (param.pattern !== undefined) {
          try {
            new RegExp(param.pattern, "u");
          } catch {
            issue.addIssue({ code: "custom", message: "bad pattern", path: [...where, "params", pname, "pattern"] });
          }
        }
      }
    }
  });
export type ConnectorManifest = z.infer<typeof ConnectorManifest>;

const CLASS_RULE = "GET reads or is outward; DELETE deletes; POST, PUT and PATCH create, modify, are outward or delete";
function classFits(method: ConnectorTool["method"], cls: ConnectorTool["class"]): boolean {
  if (method === "GET") return cls === "read" || cls === "outward";
  if (method === "DELETE") return cls === "delete";
  return cls !== "read";
}

export function isPrivateHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".ts.net") || h === "::1") return true;
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!v4) return /^f[cd][0-9a-f]{2}:/.test(h); // IPv6 unique local
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

export type ArgValue = string | number | boolean;
export const ConnectorArgs = z.record(z.string().max(40), z.union([z.string().max(8000), z.number(), z.boolean()]));

export class ConnectorError extends Error {}

export interface BuiltRequest {
  method: ConnectorTool["method"];
  url: string;
  /** Static, non-secret headers from the manifest (the broker adds the key). */
  headers: Record<string, string>;
  body?: string;
  class: ConnectorTool["class"];
  /** What the ledger and approvals show, e.g. "POST /repos/amiriteorg/galahad/issues". */
  target: string;
}

const placementOf = (tool: ConnectorTool, name: string, param: ConnectorParam): "path" | "query" | "body" =>
  param.in ?? (tool.path.includes(`{${name}}`) ? "path" : tool.method === "GET" || tool.method === "DELETE" ? "query" : "body");

function checkValue(name: string, param: ConnectorParam, value: ArgValue): ArgValue {
  switch (param.type) {
    case "string":
      if (typeof value !== "string") throw new ConnectorError(`${name} must be text`);
      if (param.enum && !param.enum.includes(value)) throw new ConnectorError(`${name} must be one of ${param.enum.join(", ")}`);
      if (param.pattern !== undefined && !new RegExp(`^(?:${param.pattern})$`, "u").test(value)) {
        throw new ConnectorError(`${name} doesn't match ${param.pattern}`);
      }
      return value;
    case "integer":
      if (typeof value !== "number" || !Number.isInteger(value)) throw new ConnectorError(`${name} must be a whole number`);
      return value;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) throw new ConnectorError(`${name} must be a number`);
      return value;
    case "boolean":
      if (typeof value !== "boolean") throw new ConnectorError(`${name} must be true or false`);
      return value;
  }
}

/** Turn a tool call into exactly one request to the connector's origin, or refuse. */
export function buildRequest(manifest: ConnectorManifest, toolName: string, args: Record<string, ArgValue> = {}): BuiltRequest {
  const tool = Object.hasOwn(manifest.tools, toolName) ? manifest.tools[toolName] : undefined;
  if (!tool) throw new ConnectorError(`${manifest.id} has no tool "${toolName}" (it has: ${Object.keys(manifest.tools).join(", ")})`);
  const params = tool.params ?? {};
  for (const name of Object.keys(args)) {
    if (!Object.hasOwn(params, name)) throw new ConnectorError(`${manifest.id}.${toolName} takes no "${name}"`);
  }
  let path = tool.path;
  const query = new URLSearchParams();
  const body: Record<string, ArgValue> = {};
  for (const [name, param] of Object.entries(params)) {
    const raw = args[name];
    if (raw === undefined) {
      if (param.required || placementOf(tool, name, param) === "path") throw new ConnectorError(`${manifest.id}.${toolName} needs ${name}`);
      continue;
    }
    const value = checkValue(name, param, raw);
    const where = placementOf(tool, name, param);
    if (where === "path") {
      const text = String(value);
      if (!text || text === "." || text === "..") throw new ConnectorError(`${name} can't be "${text}"`);
      path = path.replace(`{${name}}`, encodeURIComponent(text));
    } else if (where === "query") query.set(name, String(value));
    else body[name] = value;
  }
  const search = query.size ? `?${query}` : "";
  const fullPath = `${manifest.basePath ?? ""}${path}`;
  const url = new URL(`${manifest.origin}${fullPath}${search}`);
  // Belt and braces: whatever the arguments were, the request goes to the pinned origin.
  if (url.origin !== new URL(manifest.origin).origin) throw new ConnectorError("refusing a request off the connector's origin");
  const hasBody = tool.method !== "GET" && tool.method !== "DELETE" && Object.keys(body).length > 0;
  return {
    method: tool.method,
    url: url.toString(),
    headers: { ...(manifest.headers ?? {}) },
    ...(hasBody ? { body: JSON.stringify(body) } : {}),
    class: tool.class,
    target: `${tool.method} ${url.pathname}${search}`.slice(0, 256),
  };
}
