import { existsSync } from "node:fs";
import { join } from "node:path";
import { type ActionClass, type Decision, decide, type ExecResult, randomBytes, redact, type SandboxView } from "@galahad/core";
import {
  chooseIsolation,
  containerName,
  DEFAULT_IMAGE,
  execArgs,
  gatewayEnv,
  LAB_IMAGE,
  LABEL,
  NETWORKS,
  networkCreateArgs,
  OWN_IMAGES,
  runArgs,
  type SandboxSpec,
  volumeName,
} from "./spec.ts";
import { type ExtractLimits, type ExtractResult, extractTar } from "./tar.ts";
import { budgetProblem, DEFAULT_DISK_GB, type Workspaces, type WorkspaceStats } from "./workspaces.ts";

export interface LedgerEntryInput {
  class: ActionClass;
  resource: string;
  target: string;
  verdict: "allow" | "ask" | "deny" | "approved";
  reason?: string;
  quest?: string;
  detail?: string;
}

export interface TokenMinter {
  mint(scope: { label: string; providers?: string[]; ttlMinutes: number; maxRequests: number }): {
    token: string;
    info: { hash: string };
  };
  revoke(hash: string): boolean;
}

/** Node-local record of which gateway token belongs to which sandbox (never a container label). */
export interface SandboxTokenStore {
  put(id: string, tokenHash: string): void;
  take(id: string): string | null;
}

export function memoryTokenStore(): SandboxTokenStore {
  const map = new Map<string, string>();
  return {
    put: (id, hash) => void map.set(id, hash),
    take: (id) => {
      const hash = map.get(id) ?? null;
      map.delete(id);
      return hash;
    },
  };
}

export interface SandboxHostOptions {
  node: string;
  tokens: TokenMinter;
  ledger: (entry: LedgerEntryInput) => void;
  maxCpus: number;
  maxMemoryGb: number;
  /** The largest workspace one sandbox may have (default 200 GB). */
  maxDiskGb?: number;
  /** Size-limited workspaces; null or absent: /work is an unlimited Docker volume (the heartbeat says so). */
  workspaces?: Workspaces | null;
  /** The sandbox directory (its Dockerfile, and lab/ for the Lab), so a missing image is rebuilt instead of failing. */
  imageContext?: string;
  /** Whether this host runs KVM microVMs (Kata installed, /dev/kvm present). */
  microVMs?: boolean;
  /** The resolv.conf online microVMs get (see vmResolvConf). */
  resolvConf?: string;
  tokenStore?: SandboxTokenStore;
  docker?: string;
  now?: () => number;
}

/** Parsed (defaults applied) create request. */
export interface CreateInput {
  network: "isolated" | "gateway" | "online";
  image?: string;
  cpus: number;
  memoryGb: number;
  ttlMinutes: number;
  providers?: string[];
  persistent: boolean;
  quest?: string;
  /** The workspace's size limit (default 20 GB). */
  diskGb?: number;
  /** container or vm; default: vm for online sandboxes where this host has microVMs. */
  isolation?: "container" | "vm";
  /** The Lab image (mathematics, physics, engineering) instead of the workshop. */
  lab?: boolean;
  /** Web search through the gateway (the node's own SearXNG): `websearch` in the images. */
  search?: boolean;
}

export class SandboxError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

interface Run {
  code: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
}

const MAX_OUTPUT = 1024 * 1024;
const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

async function readCapped(stream: ReadableStream<Uint8Array>, max: number): Promise<{ text: string; truncated: boolean }> {
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  let truncated = false;
  for await (const chunk of stream) {
    if (size >= max) {
      truncated = true; // keep draining so the process never blocks on a full pipe
      continue;
    }
    const room = max - size;
    const piece = chunk.length > room ? chunk.subarray(0, room) : chunk;
    if (piece.length < chunk.length) truncated = true;
    text += decoder.decode(piece, { stream: true });
    size += piece.length;
  }
  return { text: text + decoder.decode(), truncated };
}

/**
 * A sandbox host: this node runs squires' work in hardened containers.
 * Creating is free (logged); destroying goes through the oath gate, which lets a
 * quest clean up its own ephemeral sandboxes and asks for everything else.
 */
export class SandboxHost {
  private readonly bin: string;
  private readonly now: () => number;
  private readonly tokenStore: SandboxTokenStore;
  /** Workspaces made for a sandbox that hasn't started yet (so a cleanup never takes them). */
  private readonly creating = new Set<string>();
  private readonly building = new Map<string, Promise<{ ok: boolean; output: string }>>();

  constructor(private readonly opts: SandboxHostOptions) {
    this.bin = opts.docker ?? "docker";
    this.now = opts.now ?? Date.now;
    this.tokenStore = opts.tokenStore ?? memoryTokenStore();
  }

  private async docker(args: string[], timeoutMs = 60_000, max = MAX_OUTPUT): Promise<Run> {
    const proc = Bun.spawn([this.bin, ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => proc.kill(), timeoutMs);
    const [out, err, code] = await Promise.all([readCapped(proc.stdout, max), readCapped(proc.stderr, max), proc.exited]);
    clearTimeout(timer);
    return { code, stdout: out.text, stderr: err.text, truncated: out.truncated || err.truncated };
  }

  async available(): Promise<boolean> {
    if (!Bun.which(this.bin)) return false;
    return (await this.docker(["info", "--format", "{{.ServerVersion}}"], 8000)).code === 0;
  }

  async status() {
    if (!(await this.available())) return { docker: false, image: false, networks: { gateway: false, online: false } };
    const [image, gw, net] = await Promise.all([
      this.docker(["image", "inspect", DEFAULT_IMAGE, "--format", "{{.Id}}"]),
      this.docker(["network", "inspect", NETWORKS.gateway.name, "--format", "{{.Id}}"]),
      this.docker(["network", "inspect", NETWORKS.online.name, "--format", "{{.Id}}"]),
    ]);
    return { docker: true, image: image.code === 0, networks: { gateway: gw.code === 0, online: net.code === 0 } };
  }

  /** Idempotent: creates the sandbox networks if missing. */
  async ensureNetworks(): Promise<void> {
    for (const kind of ["gateway", "online"] as const) {
      const exists = (await this.docker(["network", "inspect", NETWORKS[kind].name, "--format", "{{.Id}}"])).code === 0;
      if (exists) continue;
      const result = await this.docker(networkCreateArgs(kind));
      if (result.code !== 0) throw new SandboxError(`could not create network ${NETWORKS[kind].name}: ${result.stderr.trim()}`, 500);
      this.opts.ledger({ class: "create", resource: "docker.network", target: NETWORKS[kind].name, verdict: "allow" });
    }
  }

  async build(contextDir: string, why?: string, image = DEFAULT_IMAGE): Promise<{ ok: boolean; output: string }> {
    // One build per image at a time: two quests that both find it missing wait for the same build.
    let pending = this.building.get(image);
    if (!pending) {
      pending = (async () => {
        const result = await this.docker(["build", "--pull", "-t", image, contextDir], 60 * 60_000);
        this.opts.ledger({
          class: "create",
          resource: "docker.image",
          target: image,
          verdict: "allow",
          ...(result.code === 0 ? (why ? { detail: why } : {}) : { detail: "build failed" }),
        });
        if (result.code === 0) await this.keepImage(image);
        return { ok: result.code === 0, output: (result.code === 0 ? result.stdout : result.stderr).slice(-4000) };
      })().finally(() => this.building.delete(image));
      this.building.set(image, pending);
    }
    return pending;
  }

  private async hasImage(image = DEFAULT_IMAGE): Promise<boolean> {
    return (await this.docker(["image", "inspect", image, "--format", "{{.Id}}"])).code === 0;
  }

  /** Keep every one of Galahad's images that's built here. */
  async keepImages(): Promise<void> {
    for (const image of Object.keys(OWN_IMAGES)) await this.keepImage(image);
  }

  /**
   * Keep the sandbox image in use with a stopped container, so image pruning
   * (Coolify's nightly cleanup prunes every unused image) leaves it alone.
   * Idempotent; points the keeper at the image's current build.
   */
  async keepImage(tag = DEFAULT_IMAGE): Promise<boolean> {
    const keeper = OWN_IMAGES[tag]?.keeper;
    if (!keeper) return false;
    const image = (await this.docker(["image", "inspect", tag, "--format", "{{.Id}}"])).stdout.trim();
    if (!image) return false;
    const kept = (await this.docker(["container", "inspect", keeper, "--format", "{{.Image}}"])).stdout.trim();
    if (kept === image) return true;
    if (kept) await this.docker(["rm", "--force", keeper]);
    const made = await this.docker(["create", "--name", keeper, "--label", `${LABEL}.keeper=1`, "--network", "none", tag, "true"]);
    return made.code === 0;
  }

  /** Whether sandboxes here get size-limited workspaces. */
  async diskLimited(): Promise<boolean> {
    return !!this.opts.workspaces && (await this.opts.workspaces.available());
  }

  async create(input: CreateInput): Promise<SandboxView> {
    if (!(await this.available())) throw new SandboxError("docker is not available on this node", 424);
    if (input.cpus > this.opts.maxCpus) throw new SandboxError(`at most ${this.opts.maxCpus} CPUs on this node`);
    if (input.memoryGb > this.opts.maxMemoryGb) throw new SandboxError(`at most ${this.opts.maxMemoryGb} GB memory per sandbox on this node`);
    const isolation = chooseIsolation(input.network, input.isolation, !!this.opts.microVMs);
    if (isolation === "vm" && !this.opts.microVMs) {
      throw new SandboxError("this host can't run microVMs: it needs KVM and Kata Containers, which a deploy with sudo installs", 424);
    }
    const image = input.lab ? LAB_IMAGE : (input.image ?? DEFAULT_IMAGE);
    const own = OWN_IMAGES[image];
    if (own && !(await this.hasImage(image))) {
      // Gone (pruned) or never built: building it is Galahad's to do (create), rather than failing the quest.
      if (!this.opts.imageContext) throw new SandboxError(`${image} is not built on this node yet: run \`galahad sandbox build${input.lab ? " --lab" : ""}\``, 424);
      const built = await this.build(join(this.opts.imageContext, own.context), "rebuilt: the image was missing when a sandbox was needed", image);
      if (!built.ok) throw new SandboxError(`${image} was missing and rebuilding it failed: ${built.output.slice(-300)}`, 424);
    }
    const diskGb = input.diskGb ?? DEFAULT_DISK_GB;
    const maxDiskGb = this.opts.maxDiskGb ?? 200;
    if (diskGb > maxDiskGb) throw new SandboxError(`at most ${maxDiskGb} GB of workspace per sandbox on this node`);
    const limited = await this.diskLimited();
    if (limited) {
      const problem = budgetProblem(await this.opts.workspaces!.stats(), diskGb);
      if (problem) throw new SandboxError(problem, 507);
    }
    if (input.network !== "isolated") await this.ensureNetworks();

    const id = hex(randomBytes(5));
    const quest = input.quest ?? `adhoc-${id}`;
    // Wherever there's a network, a sandbox may show its experiments in the world.
    const providers = input.network === "isolated" ? [] : [...(input.providers ?? []), ...(input.search ? ["search"] : []), "world"];
    let env: Record<string, string> = {};
    let tokenHash: string | undefined;
    if (providers.length) {
      const minted = this.opts.tokens.mint({
        label: `sandbox:${id}`,
        providers,
        ttlMinutes: input.persistent ? 7 * 24 * 60 : input.ttlMinutes,
        maxRequests: 100_000,
      });
      env = gatewayEnv(minted.token, providers);
      tokenHash = minted.info.hash;
    }
    const spec: SandboxSpec = {
      id,
      quest,
      node: this.opts.node,
      image,
      network: input.network,
      cpus: input.cpus,
      memoryGb: input.memoryGb,
      pidsLimit: 1024,
      ttlMinutes: input.ttlMinutes,
      ephemeral: !input.persistent,
      providers,
      createdAt: this.now(),
      env,
      isolation,
      ...(this.opts.resolvConf ? { resolvConf: this.opts.resolvConf } : {}),
      ...(tokenHash ? { tokenHash } : {}),
    };

    this.creating.add(id);
    try {
      if (limited) {
        try {
          spec.workspace = await this.opts.workspaces!.create(id, diskGb);
          spec.diskGb = diskGb;
        } catch (error) {
          if (tokenHash) this.opts.tokens.revoke(tokenHash);
          throw new SandboxError(`could not create the workspace: ${(error as Error).message}`, 500);
        }
      } else {
        const volume = await this.docker(["volume", "create", "--label", `${LABEL}=1`, "--label", `${LABEL}.id=${id}`, volumeName(id)]);
        if (volume.code !== 0) throw new SandboxError(`could not create workspace: ${volume.stderr.trim()}`, 500);
      }
      const run = await this.docker(runArgs(spec), 10 * 60_000);
      if (run.code !== 0) {
        await this.docker(["rm", "--force", containerName(id)]);
        if (spec.workspace) await this.opts.workspaces!.remove(id).catch(() => {});
        else await this.docker(["volume", "rm", "-f", volumeName(id)]);
        if (tokenHash) this.opts.tokens.revoke(tokenHash);
        throw new SandboxError(`could not start sandbox: ${redact(run.stderr.trim()).slice(0, 500)}`, 500);
      }
    } finally {
      this.creating.delete(id);
    }
    if (tokenHash) this.tokenStore.put(id, tokenHash);
    this.opts.ledger({
      class: "create",
      resource: "docker.container",
      target: containerName(id),
      verdict: "allow",
      quest,
      detail: `${isolation === "vm" ? "microVM" : "container"} · ${input.network} · ${input.cpus} cpu · ${input.memoryGb} GB · ${spec.workspace ? `${diskGb} GB disk` : "unlimited disk"} · ${image}${providers.some((p) => p !== "search") ? ` · models: ${providers.filter((p) => p !== "search").join(", ")}` : ""}${providers.includes("search") ? " · web search" : ""}`,
    });
    return (await this.get(id))!;
  }

  /**
   * Copy a directory out of a sandbox (by default its /work/out) into `dest`, treating
   * what comes out as hostile: see tar.ts. Null when there's nothing there.
   */
  async collect(id: string, from: string, dest: string, limits: ExtractLimits): Promise<ExtractResult | null> {
    const sandbox = await this.get(id);
    if (!sandbox) throw new SandboxError("no such sandbox on this node", 404);
    const path = `/${from.split("/").filter(Boolean).join("/")}`;
    if (!/^\/work(\/|$)/.test(path) || path.split("/").some((part) => part === "." || part === "..")) {
      throw new SandboxError("only directories under /work can be kept");
    }
    const proc = Bun.spawn([this.bin, "cp", `${containerName(id)}:${path}`, "-"], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => proc.kill(), 15 * 60_000);
    try {
      const [result, err, code] = await Promise.all([
        extractTar(proc.stdout, dest, limits, 1).catch((error: Error) => {
          proc.kill();
          throw error;
        }),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      if (code !== 0) {
        if (/could not find|no such file/i.test(err)) return null;
        throw new SandboxError(`could not copy ${path}: ${redact(err.trim()).slice(0, 300)}`, 500);
      }
      return result;
    } finally {
      clearTimeout(timer);
    }
  }

  async list(): Promise<SandboxView[]> {
    if (!(await this.available())) return [];
    const ids = (await this.docker(["ps", "-aq", "--filter", `label=${LABEL}=1`, "--filter", `label=${LABEL}.node=${this.opts.node}`])).stdout
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!ids.length) return [];
    const inspected = await this.docker(["inspect", ...ids]);
    if (inspected.code !== 0) return [];
    const containers = JSON.parse(inspected.stdout) as { Config: { Labels: Record<string, string>; Image: string }; State: { Status: string } }[];
    const usage = await this.workspaceStats();
    return containers
      .map((c) => toView(c.Config.Labels, c.Config.Image, c.State.Status, usage))
      .filter((v): v is SandboxView => v !== null)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  private async workspaceStats(): Promise<WorkspaceStats | null> {
    if (!this.opts.workspaces) return null;
    try {
      return await this.opts.workspaces.stats();
    } catch {
      return null;
    }
  }

  async get(id: string): Promise<SandboxView | null> {
    return (await this.list()).find((s) => s.id === id) ?? null;
  }

  async exec(id: string, cmd: string[], timeoutSec = 600): Promise<ExecResult> {
    const sandbox = await this.get(id);
    if (!sandbox) throw new SandboxError("no such sandbox on this node", 404);
    if (sandbox.status !== "running") throw new SandboxError(`sandbox is ${sandbox.status}`, 409);
    const started = performance.now();
    const result = await this.docker(execArgs(id, cmd, timeoutSec), (timeoutSec + 15) * 1000);
    this.opts.ledger({
      class: "modify",
      resource: "sandbox.exec",
      target: sandbox.name,
      verdict: "allow",
      quest: sandbox.quest,
      detail: `${redact(cmd.join(" ")).slice(0, 400)} → exit ${result.code}`,
    });
    return {
      exitCode: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: Math.round(performance.now() - started),
      truncated: result.truncated,
    };
  }

  /**
   * Destroy through the oath gate. `approvedBy` is set when the owner asked for it
   * directly (their request *is* the approval); autonomous callers pass a quest.
   */
  async destroy(id: string, opts: { approvedBy?: string; quest?: string } = {}): Promise<Decision> {
    const sandbox = await this.get(id);
    if (!sandbox) throw new SandboxError("no such sandbox on this node", 404);
    const decision: Decision = opts.approvedBy
      ? { verdict: "allow", reason: `approved by ${opts.approvedBy.slice(0, 12)}` }
      : decide({
          class: "delete",
          resource: "docker.container",
          target: sandbox.name,
          createdBy: { quest: sandbox.quest, ephemeral: sandbox.ephemeral },
          ...(opts.quest ? { quest: opts.quest } : {}),
        });
    if (decision.verdict !== "allow") {
      this.opts.ledger({
        class: "delete",
        resource: "docker.container",
        target: sandbox.name,
        verdict: decision.verdict,
        reason: decision.reason,
        quest: sandbox.quest,
      });
      return decision;
    }
    await this.docker(["rm", "--force", "--volumes", containerName(id)]);
    if (sandbox.disk) await this.opts.workspaces?.remove(id).catch((error) => this.opts.ledger({ class: "delete", resource: "sandbox.workspace", target: id, verdict: "allow", detail: `not removed: ${(error as Error).message}` }));
    else await this.docker(["volume", "rm", "--force", volumeName(id)]);
    const tokenHash = this.tokenStore.take(id);
    if (tokenHash) this.opts.tokens.revoke(tokenHash);
    this.opts.ledger({
      class: "delete",
      resource: "docker.container",
      target: sandbox.name,
      verdict: opts.approvedBy ? "approved" : "allow",
      reason: decision.reason,
      quest: sandbox.quest,
    });
    return decision;
  }

  /** Clean up expired ephemeral sandboxes on behalf of the quests that created them. */
  async reap(): Promise<string[]> {
    const now = this.now();
    const reaped: string[] = [];
    const sandboxes = await this.list();
    for (const sandbox of sandboxes) {
      if (!sandbox.ephemeral || sandbox.expiresAt > now) continue;
      const decision = await this.destroy(sandbox.id, { quest: sandbox.quest });
      if (decision.verdict === "allow") reaped.push(sandbox.name);
    }
    // A workspace whose sandbox is gone (its container removed by hand, a crash mid-create) holds
    // disk for nothing: its data was the sandbox's, which no longer exists.
    const stats = await this.workspaceStats();
    if (stats) {
      const listed = await this.docker(["ps", "-a", "--filter", `label=${LABEL}=1`, "--format", `{{.Label "${LABEL}.id"}}`]);
      const alive = new Set(listed.stdout.split("\n").map((s) => s.trim()));
      for (const image of stats.images) {
        // Any galahad container on this Docker counts (another node or a test may share the host), and a
        // young workspace may belong to a sandbox that is still starting in another process.
        if (listed.code !== 0 || alive.has(image.id) || this.creating.has(image.id) || now - image.createdAt < 10 * 60_000) continue;
        await this.opts.workspaces!.remove(image.id).catch(() => {});
        this.opts.ledger({ class: "delete", resource: "sandbox.workspace", target: image.id, verdict: "allow", reason: "cleaning up the workspace of a sandbox that no longer exists" });
        reaped.push(`workspace ${image.id}`);
      }
    }
    return reaped;
  }

}

/** Where Kata's shim may be: on containerd's PATH (installed by scripts/remote-setup.sh). */
const KATA_SHIMS = ["/usr/local/bin/containerd-shim-kata-v2", "/usr/bin/containerd-shim-kata-v2"];

/** Whether this machine can run sandboxes as KVM microVMs: /dev/kvm and Kata's shim. */
export function microVMsAvailable(exists: (path: string) => boolean = existsSync): boolean {
  return process.platform === "linux" && exists("/dev/kvm") && KATA_SHIMS.some((path) => exists(path));
}

/** Cheap readiness probe for capability reporting (no side effects). */
export async function probeSandbox(bin = "docker"): Promise<{ image: boolean; networks: boolean; vm: boolean } | null> {
  if (!Bun.which(bin)) return null;
  const check = async (args: string[]) => {
    try {
      const proc = Bun.spawn([bin, ...args], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
      const timer = setTimeout(() => proc.kill(), 8000);
      const code = await proc.exited;
      clearTimeout(timer);
      return code === 0;
    } catch {
      return false;
    }
  };
  if (!(await check(["info", "--format", "{{.ServerVersion}}"]))) return null;
  const [image, gw] = await Promise.all([
    check(["image", "inspect", DEFAULT_IMAGE, "--format", "{{.Id}}"]),
    check(["network", "inspect", NETWORKS.gateway.name, "--format", "{{.Id}}"]),
  ]);
  return { image, networks: gw, vm: microVMsAvailable() };
}

function toView(labels: Record<string, string>, image: string, status: string, usage: WorkspaceStats | null): SandboxView | null {
  const id = labels[`${LABEL}.id`];
  if (!id || labels[LABEL] !== "1") return null;
  const limit = Number(labels[`${LABEL}.disk`]);
  const used = usage?.images.find((i) => i.id === id)?.usedBytes;
  return {
    id,
    name: containerName(id),
    node: labels[`${LABEL}.node`] ?? "",
    quest: labels[`${LABEL}.quest`] ?? "",
    image,
    network: (labels[`${LABEL}.network`] ?? "isolated") as SandboxView["network"],
    cpus: Number(labels[`${LABEL}.cpus`] ?? 0),
    memoryGb: Number(labels[`${LABEL}.memory`] ?? 0),
    createdAt: Number(labels[`${LABEL}.created`] ?? 0),
    expiresAt: Number(labels[`${LABEL}.expires`] ?? 0),
    status,
    ephemeral: labels[`${LABEL}.ephemeral`] !== "false",
    providers: (labels[`${LABEL}.providers`] ?? "").split(",").filter(Boolean),
    disk: limit > 0 ? { limitGb: limit, usedGb: used === undefined ? null : Math.round((used / 2 ** 30) * 10) / 10 } : null,
    isolation: labels[`${LABEL}.isolation`] === "vm" ? "vm" : "container",
  };
}
