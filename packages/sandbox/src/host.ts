import { existsSync } from "node:fs";
import { join } from "node:path";
import { type ActionClass, type Decision, decide, type ExecResult, isReservedGatewayScope, randomBytes, redact, type SandboxView, TeamWorkspaceQuest } from "@galahad/core";
import {
  chooseIsolation,
  containerName,
  DEFAULT_IMAGE,
  execArgs,
  gatewayEnv,
  DESKTOP_IMAGE,
  GAZEBO_IMAGE,
  LAB_IMAGE,
  LABEL,
  NETWORKS,
  networkCreateArgs,
  OWN_IMAGES,
  RETIRED_SCOPE,
  runArgs,
  type SandboxSpec,
  SEARCH_SCOPE,
  terminalArgs,
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
  /** How Docker is run (tests pass a stand-in that answers its commands; nothing is spawned then). */
  runner?: DockerRunner;
  /** How a terminal's process is started (tests pass one that starts a local shell instead of `docker exec`). */
  spawnTerminal?: SpawnTerminal;
  now?: () => number;
}

/** One docker command: its arguments in, its exit code and output out. */
export type DockerRunner = (args: string[], timeoutMs: number) => Promise<{ code: number; stdout: string; stderr: string }>;

/** A process on a terminal: what it prints comes to the `onData` it was started with; keys and sizes go in. */
export interface TerminalProcess {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  /** Its exit code once it has ended. */
  exited: Promise<number>;
}

export type SpawnTerminal = (argv: string[], size: { cols: number; rows: number }, onData: (bytes: Uint8Array) => void) => TerminalProcess;

/**
 * A process under a pseudo-terminal on this host (Bun's own): it sees a real terminal, and a resize reaches it.
 * Killing it hangs up its terminal (an interactive shell ignores SIGTERM), and two seconds on, kills it outright.
 */
export const spawnTerminal: SpawnTerminal = (argv, size, onData) => {
  const proc = Bun.spawn(argv, { terminal: { cols: size.cols, rows: size.rows, data: (_terminal, bytes) => onData(bytes) } });
  const terminal = proc.terminal!;
  const exited = proc.exited.finally(() => terminal.close());
  return {
    write: (data) => {
      if (!terminal.closed) terminal.write(data);
    },
    resize: (cols, rows) => {
      if (!terminal.closed) terminal.resize(cols, rows);
    },
    kill: () => {
      proc.kill("SIGHUP");
      const outright = setTimeout(() => proc.kill("SIGKILL"), 2000);
      void exited.finally(() => clearTimeout(outright));
    },
    exited,
  };
};

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
  /** The Gazebo image (robotics simulation) instead of the workshop. */
  gazebo?: boolean;
  /** The desktop image (a display, a window manager and a browser) instead of the workshop. */
  desktop?: boolean;
  /** Web search through the gateway (the node's own SearXNG): `websearch` in the images. */
  search?: boolean;
}

/** One thing done on a knight's desktop from outside its VM (`look`: nothing, only the picture). */
export type DesktopAction =
  | { do: "look" }
  | { do: "click"; x: number; y: number; button?: "left" | "right" | "middle" | "double" }
  | { do: "move"; x: number; y: number }
  | { do: "scroll"; direction: "up" | "down"; times?: number }
  | { do: "type"; text: string }
  | { do: "key"; keys: string[] }
  | { do: "open"; address: string };

/** The screen as it is now: a JPEG, and the display's size in the pixels a click is given in. */
export interface DesktopView {
  shot: { mediaType: "image/jpeg"; data: string };
  width: number;
  height: number;
}

export class SandboxError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/**
 * The gateway scopes a sandbox's token carries: the model providers asked for, and web search
 * by its own flag. An internal scope (search, git:…, the retired world) asked for by name is
 * refused, however the request got here.
 */
export function sandboxScopes(input: { network: CreateInput["network"]; providers?: string[]; search?: boolean }): string[] {
  const reserved = (input.providers ?? []).filter(isReservedGatewayScope);
  if (reserved.length) throw new SandboxError(`${reserved.join(", ")}: not a model provider (search is the request's own flag; repositories come from the node)`);
  if (input.network === "isolated") return [];
  return [...(input.providers ?? []), ...(input.search ? [SEARCH_SCOPE] : [])];
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
 * A sandbox host: this node runs knights' work in hardened containers.
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
    if (this.opts.runner) return { ...(await this.opts.runner(args, timeoutMs)), truncated: false };
    const proc = Bun.spawn([this.bin, ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => proc.kill(), timeoutMs);
    const [out, err, code] = await Promise.all([readCapped(proc.stdout, max), readCapped(proc.stderr, max), proc.exited]);
    clearTimeout(timer);
    return { code, stdout: out.text, stderr: err.text, truncated: out.truncated || err.truncated };
  }

  async available(): Promise<boolean> {
    if (!this.opts.runner && !Bun.which(this.bin)) return false;
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
    const providers = sandboxScopes(input);
    if (!(await this.available())) throw new SandboxError("docker is not available on this node", 424);
    if (input.cpus > this.opts.maxCpus) throw new SandboxError(`at most ${this.opts.maxCpus} CPUs on this node`);
    if (input.memoryGb > this.opts.maxMemoryGb) throw new SandboxError(`at most ${this.opts.maxMemoryGb} GB memory per sandbox on this node`);
    const isolation = chooseIsolation(input.network, input.isolation, !!this.opts.microVMs);
    if (isolation === "vm" && !this.opts.microVMs) {
      throw new SandboxError("this host can't run microVMs: it needs KVM and Kata Containers, which a deploy with sudo installs", 424);
    }
    const image = input.lab ? LAB_IMAGE : input.gazebo ? GAZEBO_IMAGE : input.desktop ? DESKTOP_IMAGE : (input.image ?? DEFAULT_IMAGE);
    const own = OWN_IMAGES[image];
    if (own && !(await this.hasImage(image))) {
      // Gone (pruned) or never built: building it is Galahad's to do (create), rather than failing the quest.
      if (!this.opts.imageContext) throw new SandboxError(`${image} is not built on this node yet: run \`galahad sandbox build${input.lab ? " --lab" : input.gazebo ? " --gazebo" : input.desktop ? " --desktop" : ""}\``, 424);
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
          if (input.persistent && quest.startsWith("arm.team.")) {
            if (!this.opts.workspaces!.retain) throw new Error("the workspace helper needs persistent teammate support");
            await this.opts.workspaces!.retain!(id);
          }
        } catch (error) {
          if (tokenHash) this.opts.tokens.revoke(tokenHash);
          if (spec.workspace) await this.opts.workspaces!.remove(id).catch(() => {});
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
    const models = providers.filter((p) => p !== SEARCH_SCOPE);
    this.opts.ledger({
      class: "create",
      resource: "docker.container",
      target: containerName(id),
      verdict: "allow",
      quest,
      detail: `${isolation === "vm" ? "microVM" : "container"} · ${input.network} · ${input.cpus} cpu · ${input.memoryGb} GB · ${spec.workspace ? `${diskGb} GB disk` : "unlimited disk"} · ${image}${models.length ? ` · models: ${models.join(", ")}` : ""}${providers.includes(SEARCH_SCOPE) ? " · web search" : ""}`,
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
    // A stand-in for Docker has no files to copy out.
    if (this.opts.runner) return null;
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
    return (await this.listed()) ?? [];
  }

  /** This node's sandboxes as Docker lists them, or null when Docker couldn't say (never mistaken for "none"). */
  async listed(): Promise<SandboxView[] | null> {
    if (!(await this.available())) return null;
    const listing = await this.docker(["ps", "-aq", "--filter", `label=${LABEL}=1`, "--filter", `label=${LABEL}.node=${this.opts.node}`]);
    if (listing.code !== 0) return null;
    const ids = listing.stdout
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!ids.length) return [];
    const inspected = await this.docker(["inspect", ...ids]);
    if (inspected.code !== 0) return null;
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

  /** Owner/controller only. Resume the exact existing VM and give this run bounded model access. */
  async prepareTeam(id: string, quest: string, git?: { connector: string; owner: string; repo: string }): Promise<SandboxView> {
    const sandbox = await this.get(id);
    if (!sandbox) throw new SandboxError("the teammate's VM is missing; its workspace must be recovered, not replaced", 404);
    if (!TeamWorkspaceQuest.safeParse(quest).success || sandbox.quest !== quest || sandbox.ephemeral || sandbox.isolation !== "vm") {
      throw new SandboxError("that is not this teammate's persistent VM", 403);
    }
    if (sandbox.disk) {
      if (!this.opts.workspaces?.mount || !this.opts.workspaces.retain) throw new SandboxError("update the workspace helper before resuming this teammate", 424);
      await this.opts.workspaces.retain(id);
      await this.opts.workspaces.mount(id);
    }
    if (sandbox.status !== "running") {
      if (!['exited', 'created'].includes(sandbox.status)) throw new SandboxError(`the teammate's VM is ${sandbox.status}`, 409);
      const started = await this.docker(["start", containerName(id)], 120_000);
      if (started.code !== 0) throw new SandboxError(`could not resume the teammate's VM: ${redact(started.stderr).slice(0, 300)}`, 424);
    }
    // Fresh credentials are written directly inside the VM, never returned through an API or logged.
    // Revocation and request caps remain real: this is a new lease, not an indefinitely extended token.
    const previous = this.tokenStore.take(id);
    if (previous) this.opts.tokens.revoke(previous);
    const scopes = [...sandbox.providers, ...(git ? [`git:${git.connector}:${git.owner}:${git.repo}`] : [])];
    const minted = this.opts.tokens.mint({ label: `sandbox:${id}`, providers: scopes, ttlMinutes: 30, maxRequests: 500 });
    this.tokenStore.put(id, minted.info.hash);
    const env = gatewayEnv(minted.token, sandbox.providers);
    if (git) env.GALAHAD_REPO_URL = `${env.GALAHAD_GATEWAY!.replace(/\/gw$/, "")}/git/${git.connector}/${git.owner}/${git.repo}.git`;
    const payload = Buffer.from(JSON.stringify(env)).toString("base64");
    const write = "import os,sys,base64,tempfile; f,p=tempfile.mkstemp(prefix='.galahad-gateway-',dir='/work'); os.write(f,base64.b64decode(sys.argv[1])); os.fsync(f); os.close(f); os.replace(p,'/work/.galahad-gateway.json')";
    try {
      const wrote = await this.docker(execArgs(id, ["python3", "-c", write, payload], 30), 45_000);
      if (wrote.code !== 0) throw new Error("lease write failed");
    } catch {
      this.opts.tokens.revoke(minted.info.hash);
      throw new SandboxError("could not prepare the teammate's model access", 424);
    }
    this.opts.ledger({ class: "modify", resource: "sandbox.team-ready", target: sandbox.name, verdict: "allow", quest, detail: "existing VM resumed; model access capped at 30 minutes and 500 requests" });
    return { ...sandbox, status: "running" };
  }

  /**
   * Owner only. Make a knight's VM again from its image as it is now: the same VM (its id, its `/work`, what it
   * was given), a new container. A VM is made from the image as it was that day, so a fix to the image, or a
   * newer tool in it, reaches an existing knight only this way. The container that was is set aside under
   * another name and removed only once the new one runs; one that won't start is cleared away and the old one
   * is put back as it was. Its network may change with it (a microVM's can't be changed any other way), and its
   * gateway token covers `providers`, as for a VM made today. Everything outside `/work` is the image's again.
   */
  async remakeTeam(id: string, quest: string, opts: { providers: string[]; network?: "online" | "gateway"; desktop?: boolean; approvedBy: string }): Promise<SandboxView> {
    const sandbox = await this.get(id);
    if (!sandbox) throw new SandboxError("the teammate's VM is missing; its workspace must be recovered, not replaced", 404);
    if (!TeamWorkspaceQuest.safeParse(quest).success || sandbox.quest !== quest || sandbox.ephemeral || sandbox.isolation !== "vm") {
      throw new SandboxError("that is not this teammate's persistent VM", 403);
    }
    const name = containerName(id);
    const aside = `${name}-replaced`;
    const network = opts.network ?? (sandbox.network === "isolated" ? "gateway" : sandbox.network);
    const providers = sandboxScopes({ network, providers: opts.providers, search: sandbox.providers.includes(SEARCH_SCOPE) });
    // With a desktop from now on, or without one, when asked; else the image it has (by its name: as it is built now).
    const image = opts.desktop === true ? DESKTOP_IMAGE : opts.desktop === false ? DEFAULT_IMAGE : sandbox.image;
    if (!(await this.hasImage(image))) throw new SandboxError(`${image} is not built on this node: run \`galahad sandbox build${image === DESKTOP_IMAGE ? " --desktop" : ""}\` first`, 424);
    const ws = this.opts.workspaces;
    if (sandbox.disk && (!ws?.mount || !ws.retain)) throw new SandboxError("update the workspace helper before making this teammate's VM again", 424);
    // A remake that was cut short after the old container was set aside left it there: it gets its name back first.
    if ((await this.docker(["inspect", "--format", "{{.Name}}", name])).code !== 0) {
      const back = await this.docker(["rename", aside, name]);
      if (back.code !== 0) throw new SandboxError("the teammate's VM is missing; its workspace must be recovered, not replaced", 404);
    }
    let workspace: string | undefined;
    if (sandbox.disk) {
      // Where its disk is on this host, as the container that has it says: never worked out from its id.
      const mounts = await this.docker(["inspect", "--format", "{{json .Mounts}}", name]);
      let found: { Type?: string; Source?: string; Destination?: string }[] = [];
      try {
        found = mounts.code === 0 ? (JSON.parse(mounts.stdout) as typeof found) : [];
      } catch {
        // (Not JSON: the same as not told.)
      }
      workspace = found.find((m) => m.Destination === "/work" && m.Type === "bind")?.Source;
      if (!workspace?.startsWith("/")) throw new SandboxError("could not tell where this teammate's workspace disk is; nothing was changed", 424);
      // Kept, whatever becomes of its container.
      await ws!.retain!(id);
    }
    await this.ensureNetworks();

    await this.docker(["stop", "-t", "10", name], 60_000);
    let moved = await this.docker(["rename", name, aside]);
    if (moved.code !== 0) {
      // (A remake before this one may have ended with its new VM running and the old container still set aside: that one goes.)
      await this.docker(["rm", "--force", aside]);
      moved = await this.docker(["rename", name, aside]);
    }
    if (moved.code !== 0) {
      if (sandbox.status === "running") await this.docker(["start", name], 120_000);
      throw new SandboxError(`could not set the teammate's VM aside, so it is as it was: ${redact(moved.stderr).split("\n")[0]!.slice(0, 300)}`, 424);
    }
    /** The old container under its own name again, running if it was. */
    const putBack = async (): Promise<void> => {
      await this.docker(["rm", "--force", name]);
      await this.docker(["rename", aside, name]);
      if (sandbox.status === "running") await this.docker(["start", name], 120_000);
    };
    let minted: { token: string; hash: string } | undefined;
    try {
      if (sandbox.disk) await ws!.mount!(id);
      let env: Record<string, string> = {};
      if (providers.length) {
        const lease = this.opts.tokens.mint({ label: `sandbox:${id}`, providers, ttlMinutes: 7 * 24 * 60, maxRequests: 100_000 });
        env = gatewayEnv(lease.token, providers);
        minted = { token: lease.token, hash: lease.info.hash };
      }
      const spec: SandboxSpec = {
        id,
        quest,
        node: this.opts.node,
        image,
        network,
        cpus: sandbox.cpus,
        memoryGb: sandbox.memoryGb,
        pidsLimit: 1024,
        ttlMinutes: Math.max(0, Math.round((sandbox.expiresAt - sandbox.createdAt) / 60_000)),
        ephemeral: false,
        providers,
        createdAt: sandbox.createdAt,
        env,
        isolation: "vm",
        ...(this.opts.resolvConf ? { resolvConf: this.opts.resolvConf } : {}),
        ...(minted ? { tokenHash: minted.hash } : {}),
        ...(workspace && sandbox.disk ? { workspace, diskGb: sandbox.disk.limitGb } : {}),
      };
      const run = await this.docker(runArgs(spec), 10 * 60_000);
      if (run.code !== 0) throw new Error(run.stderr.trim() || `docker run exited ${run.code}`);
    } catch (error) {
      await putBack();
      if (minted) this.opts.tokens.revoke(minted.hash);
      // (Docker may say the new container's arguments back, and its token is among them.)
      let why = redact(String((error as Error).message ?? error)).split("\n")[0]!.slice(0, 300);
      if (minted) why = why.replaceAll(minted.token, "[its token]");
      throw new SandboxError(`could not make the teammate's VM again, so it is as it was: ${why}`, 424);
    }
    await this.docker(["rm", "--force", aside]);
    const previous = this.tokenStore.take(id);
    if (previous) this.opts.tokens.revoke(previous);
    if (minted) this.tokenStore.put(id, minted.hash);
    this.opts.ledger({
      class: "modify",
      resource: "docker.container",
      target: name,
      verdict: "approved",
      reason: `approved by ${opts.approvedBy.slice(0, 12)}`,
      quest,
      detail: `made again from ${image} as it is now · /work kept · ${network} · ${sandbox.cpus} cpu · ${sandbox.memoryGb} GB`,
    });
    return (await this.get(id))!;
  }

  /**
   * A knight's desktop, from outside its VM (the owner watching, or taking over to sign in): do one thing there
   * with the VM's own `desktop` command, then bring back a picture of the screen. No port is opened into the VM.
   * Each thing done is a line in the ledger; looking is not (whoever watches asks again every second or two);
   * what is typed is carried to the VM as one argument no shell reads, and the ledger says only how much.
   */
  async desktop(id: string, quest: string, action: DesktopAction): Promise<DesktopView> {
    const whole = (n: number, max: number) => Number.isInteger(n) && n >= 0 && n <= max;
    const refuse = (why: string): never => { throw new SandboxError(why, 400); };
    let argv: string[] | null = null;
    let did = "";
    switch (action.do) {
      case "look": break;
      case "click":
        if (!whole(action.x, 10_000) || !whole(action.y, 10_000)) refuse("a place on the screen is two whole numbers");
        argv = ["desktop", "click", String(action.x), String(action.y), action.button ?? "left"];
        break;
      case "move":
        if (!whole(action.x, 10_000) || !whole(action.y, 10_000)) refuse("a place on the screen is two whole numbers");
        argv = ["desktop", "move", String(action.x), String(action.y)];
        break;
      case "scroll":
        if (!whole(action.times ?? 1, 50) || (action.times ?? 1) < 1) refuse("scroll takes a whole number of times, from 1 to 50");
        argv = ["desktop", "scroll", action.direction, String(action.times ?? 1)];
        break;
      case "key":
        if (!action.keys.length || action.keys.length > 8 || action.keys.some((k) => !/^[A-Za-z0-9_+]{1,40}$/.test(k))) refuse("keys are names like Return, Tab, Escape, ctrl+l");
        argv = ["desktop", "key", ...action.keys];
        break;
      case "open":
        if (action.address.length > 2000 || !/^(https?:\/\/|file:\/\/|about:)/.test(action.address)) refuse("an address begins with http, https, file or about");
        argv = ["desktop", "open", action.address];
        break;
      case "type":
        if (!action.text.length || action.text.length > 2000) refuse("type takes some text, at most 2,000 characters");
        // (As base64 to a line of Python there, which hands it to the command as one argument.)
        argv = ["python3", "-c", "import base64,subprocess,sys; sys.exit(subprocess.run(['desktop','type',base64.b64decode(sys.argv[1]).decode()]).returncode)", Buffer.from(action.text, "utf8").toString("base64")];
        did = `type (${action.text.length} characters, not recorded)`;
        break;
    }
    const sandbox = await this.get(id);
    if (!sandbox) throw new SandboxError("the teammate's VM is missing", 404);
    if (!TeamWorkspaceQuest.safeParse(quest).success || sandbox.quest !== quest || sandbox.ephemeral || sandbox.isolation !== "vm") throw new SandboxError("that is not this teammate's persistent VM", 403);
    if (sandbox.status !== "running") throw new SandboxError(`the teammate's VM is ${sandbox.status}`, 409);
    /** Why the VM's command failed, as the owner should read it. */
    const failed = (run: Run): never => {
      if (run.code === 127 || /desktop: (command )?not found/.test(run.stderr)) throw new SandboxError("this teammate's VM has no desktop: have it made again with one (galahad roundtable provision <id> --remake --desktop)", 424);
      throw new SandboxError(`the desktop could not do that: ${redact(run.stderr.trim().split("\n").at(-1) ?? "").slice(0, 300) || `exit ${run.code}`}`, 424);
    };
    if (argv) {
      const ran = await this.docker(execArgs(id, argv, 60), 75_000);
      if (ran.code !== 0) failed(ran);
      this.opts.ledger({ class: "modify", resource: "sandbox.desktop", target: sandbox.name, verdict: "allow", quest, detail: did || redact(argv.slice(1).join(" ")).slice(0, 300) });
    }
    const shot = await this.docker(execArgs(id, ["sh", "-c", 'f="${TMPDIR:-/tmp}/watch-$$.jpg"; desktop shot "$f" >/dev/null && base64 -w0 "$f"; code=$?; rm -f "$f"; exit $code'], 60), 75_000);
    if (shot.code !== 0 || !shot.stdout.trim()) failed(shot);
    return { shot: { mediaType: "image/jpeg", data: shot.stdout.trim() }, width: 1280, height: 800 };
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
      detail: `${truncateLedgerDetail(redact(cmd.join(" ")))} → exit ${result.code}`,
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
   * A shell in a running sandbox on a terminal of its own, for its owner: `docker exec --tty` under a pseudo-terminal
   * here, so what runs there (an editor, a vendor's sign-in, a coding tool's screen) has a real terminal. Not ledgered
   * here: whoever keeps the terminal says when it opened and closed, and never what was typed or shown.
   */
  async terminal(id: string, size: { cols: number; rows: number }, onData: (bytes: Uint8Array) => void): Promise<{ name: string; quest: string | null; process: TerminalProcess }> {
    const sandbox = await this.get(id);
    if (!sandbox) throw new SandboxError("no such sandbox on this node", 404);
    if (sandbox.status !== "running") throw new SandboxError(`sandbox is ${sandbox.status}`, 409);
    const shell = (this.opts.spawnTerminal ?? spawnTerminal)([this.bin, ...terminalArgs(id)], size, onData);
    return { name: sandbox.name, quest: sandbox.quest || null, process: shell };
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
    if (sandbox.disk) {
      const ws = this.opts.workspaces;
      const remove = opts.approvedBy && !sandbox.ephemeral && ws?.removeRetained ? ws.removeRetained.bind(ws) : ws?.remove.bind(ws);
      await remove?.(id).catch((error) => this.opts.ledger({ class: "delete", resource: "sandbox.workspace", target: id, verdict: "allow", detail: `not removed: ${(error as Error).message}` }));
    }
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
        if (image.retained || listed.code !== 0 || alive.has(image.id) || this.creating.has(image.id) || now - image.createdAt < 10 * 60_000) continue;
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

const LEDGER_DETAIL_LIMIT = 400;

/** Keep a long command's start and end for the ledger, with a note of how many characters were omitted. */
function truncateLedgerDetail(command: string): string {
  if (command.length <= LEDGER_DETAIL_LIMIT) return command;
  const note = (omitted: number) => `…[${omitted} characters omitted]…`;
  // The note's size depends on the omitted count's digit count: settle it in a couple of passes.
  let omitted = command.length - LEDGER_DETAIL_LIMIT;
  for (let i = 0; i < 3; i++) omitted = command.length - (LEDGER_DETAIL_LIMIT - note(omitted).length);
  const kept = LEDGER_DETAIL_LIMIT - note(omitted).length;
  const head = Math.floor(kept / 2);
  const tail = kept - head;
  return command.slice(0, head) + note(omitted) + command.slice(command.length - tail);
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
    providers: (labels[`${LABEL}.providers`] ?? "").split(",").filter((p) => p && p !== RETIRED_SCOPE),
    disk: limit > 0 ? { limitGb: limit, usedGb: used === undefined ? null : Math.round((used / 2 ** 30) * 10) / 10 } : null,
    isolation: labels[`${LABEL}.isolation`] === "vm" ? "vm" : "container",
  };
}
