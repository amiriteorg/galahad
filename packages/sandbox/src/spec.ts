import type { SandboxNetwork } from "@galahad/core";

/*
 * A sandbox is where a squire works: an unprivileged, resource-capped container
 * with its own workspace and nothing else of the host. This module is pure: it
 * turns a spec into `docker` arguments, so the security posture is unit-tested.
 */

export const LABEL = "dev.galahad";
export const DEFAULT_IMAGE = "galahad/sandbox:1";
/** Port of the sandbox-only model gateway listener on the gateway network's bridge IP. */
export const SANDBOX_GATEWAY_PORT = 7779;

/**
 * gateway: Docker `--internal` network: no route out; the only reachable host
 *          service is the sandbox gateway (UFW allows just that port on galahad0).
 * online:  ordinary bridge with egress, plus the gateway network for models.
 * Inter-container traffic is disabled on both, so sandboxes cannot reach each other.
 */
export const NETWORKS = {
  gateway: { name: "galahad-gw", bridge: "galahad0", subnet: "172.31.250.0/24", gateway: "172.31.250.1", internal: true },
  online: { name: "galahad-net", bridge: "galahad1", subnet: "172.31.249.0/24", gateway: "172.31.249.1", internal: false },
} as const;

export interface SandboxSpec {
  id: string;
  quest: string;
  node: string;
  image: string;
  network: SandboxNetwork;
  cpus: number;
  memoryGb: number;
  pidsLimit: number;
  ttlMinutes: number;
  ephemeral: boolean;
  providers: string[];
  createdAt: number;
  env: Record<string, string>;
  tokenHash?: string;
  /** Host path of a size-limited workspace (see workspaces.ts); without one, /work is an unlimited Docker volume. */
  workspace?: string;
  /** The workspace's limit, when it has one. */
  diskGb?: number;
}

/** A stopped container that keeps the sandbox image in use, so image pruning (Coolify's nightly cleanup) leaves it alone. */
export const KEEPER = "galahad-sandbox-image";

export const containerName = (id: string) => `galahad-sbx-${id}`;
export const volumeName = (id: string) => `galahad-sbx-${id}-work`;

export function labels(spec: SandboxSpec): Record<string, string> {
  return {
    [LABEL]: "1",
    [`${LABEL}.id`]: spec.id,
    [`${LABEL}.quest`]: spec.quest,
    [`${LABEL}.node`]: spec.node,
    [`${LABEL}.network`]: spec.network,
    [`${LABEL}.ephemeral`]: String(spec.ephemeral),
    [`${LABEL}.created`]: String(spec.createdAt),
    [`${LABEL}.expires`]: String(spec.createdAt + spec.ttlMinutes * 60_000),
    [`${LABEL}.providers`]: spec.providers.join(","),
    [`${LABEL}.cpus`]: String(spec.cpus),
    [`${LABEL}.memory`]: String(spec.memoryGb),
    [`${LABEL}.disk`]: spec.workspace && spec.diskGb ? String(spec.diskGb) : "none",
    // The gateway token's hash is deliberately NOT a label: images can carry labels of
    // their own, so anything security-relevant lives in node-local state instead.
  };
}

/** `docker run` arguments. Every hardening flag here is asserted by tests. */
export function runArgs(spec: SandboxSpec): string[] {
  const memory = `${Math.round(spec.memoryGb * 1024)}m`;
  const args = [
    "run",
    "--detach",
    "--name",
    containerName(spec.id),
    "--hostname",
    "squire",
    "--init",
    // Nobody inside is root, nothing can gain privileges, the kernel surface is minimal.
    "--user",
    "1000:1000",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges:true",
    // The image is immutable; the squire writes only to its workspace and /tmp.
    "--read-only",
    "--tmpfs",
    "/tmp:rw,nosuid,nodev,size=2g,mode=1777",
    "--mount",
    spec.workspace ? `type=bind,src=${spec.workspace},dst=/work` : `type=volume,src=${volumeName(spec.id)},dst=/work`,
    "--workdir",
    "/work",
    "--env",
    "HOME=/work",
    // Bounded resources: a runaway squire cannot starve the host.
    "--cpus",
    String(spec.cpus),
    "--memory",
    memory,
    "--memory-swap",
    memory,
    "--pids-limit",
    String(spec.pidsLimit),
    "--ulimit",
    "nofile=8192:8192",
    "--network",
    spec.network === "isolated" ? "none" : spec.network === "gateway" ? NETWORKS.gateway.name : NETWORKS.online.name,
  ];
  for (const [key, value] of Object.entries(labels(spec))) args.push("--label", `${key}=${value}`);
  for (const [key, value] of Object.entries(spec.env)) args.push("--env", `${key}=${value}`);
  args.push(spec.image, "sleep", "infinity");
  return args;
}

/** Environment that points tools at the sandbox gateway with a scoped token (never a key). */
export function gatewayEnv(token: string, providers: string[]): Record<string, string> {
  const base = `http://${NETWORKS.gateway.gateway}:${SANDBOX_GATEWAY_PORT}/gw`;
  const openai = providers.find((p) => p !== "anthropic");
  return {
    GALAHAD_GATEWAY: base,
    ...(providers.includes("anthropic") ? { ANTHROPIC_BASE_URL: `${base}/anthropic`, ANTHROPIC_AUTH_TOKEN: token } : {}),
    ...(openai ? { OPENAI_BASE_URL: `${base}/${openai}`, OPENAI_API_KEY: token } : {}),
    GALAHAD_TOKEN: token,
  };
}

/** Commands run under a hard deadline inside the container (killing `docker exec` alone would not stop them). */
export const execArgs = (id: string, cmd: string[], timeoutSec: number): string[] => [
  "exec",
  "--interactive",
  "--workdir",
  "/work",
  containerName(id),
  "timeout",
  "--signal=KILL",
  `${timeoutSec}s`,
  ...cmd,
];

export function networkCreateArgs(kind: keyof typeof NETWORKS): string[] {
  const n = NETWORKS[kind];
  return [
    "network",
    "create",
    ...(n.internal ? ["--internal"] : []),
    "--subnet",
    n.subnet,
    "--gateway",
    n.gateway,
    "-o",
    `com.docker.network.bridge.name=${n.bridge}`,
    "-o",
    "com.docker.network.bridge.enable_icc=false",
    "--label",
    `${LABEL}=1`,
    n.name,
  ];
}
