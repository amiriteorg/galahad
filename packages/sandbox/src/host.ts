import { existsSync } from "node:fs";
import { join } from "node:path";
import { type ActionClass, type Decision, decide, type ExecResult, isReservedGatewayScope, randomBytes, redact, type SandboxNetwork, type SandboxView, TeamWorkspaceQuest } from "@galahad/core";
import {
  CONTAINER_MAJOR,
  containerBuildArgs,
  containerCannot,
  containerCollectArgs,
  containerDeleteArgs,
  containerExecArgs,
  containerImageInspectArgs,
  containerListArgs,
  containerNetworkCreateArgs,
  containerNetworkInspectArgs,
  containerRunArgs,
  containerStopArgs,
  containerTerminalArgs,
  containerVersionArgs,
  containerVolumeDeleteArgs,
  parseContainers,
  parseContainerVersion,
  type SandboxAsk,
} from "./container.ts";
import { ContainerVolumes } from "./container-volumes.ts";
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
  TERMINAL_HANG_UP,
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
  /**
   * Size-limited workspaces; null or absent: /work is an unlimited Docker volume (the heartbeat says so). On a Mac
   * they are container's own volumes (ContainerVolumes), each of a fixed size, unless others are given.
   */
  workspaces?: Workspaces | null;
  /** The sandbox directory (its Dockerfile, and lab/ for the Lab), so a missing image is rebuilt instead of failing. */
  imageContext?: string;
  /** Whether this host runs KVM microVMs (Kata installed, /dev/kvm present). */
  microVMs?: boolean;
  /** The resolv.conf online microVMs get (see vmResolvConf). */
  resolvConf?: string;
  tokenStore?: SandboxTokenStore;
  /**
   * The command line that runs sandboxes here: Docker's (the default), or Apple's `container` on a Mac, where every
   * sandbox is a lightweight VM of its own (container.ts: each of Docker's flags there, and what a Mac can't make).
   */
  engine?: "docker" | "container";
  /** The engine's binary (default: docker, or container). */
  docker?: string;
  /** How the engine is run (tests pass a stand-in that answers its commands; nothing is spawned then). */
  runner?: DockerRunner;
  /** How a terminal's process is started (tests pass one that starts a local shell instead of `docker exec`). */
  spawnTerminal?: SpawnTerminal;
  now?: () => number;
  /** How long to wait before starting a sandbox once more (tests pass one that doesn't). */
  pause?: (ms: number) => Promise<void>;
}

/**
 * Kata's rootless runtime gives each microVM a user of its own and hands a UID out again as soon as it is free: a VM
 * started while a finished one's teardown is still removing that UID's runtime directory loses its files, and Docker
 * says this (ultra, 16 November 2026, under parallel trials). The runtime's race, not the sandbox's fault.
 */
const lostItsFiles = (stderr: string): boolean => /failed to create shim task/.test(stderr) && /no such file or directory/.test(stderr);

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

/** Where a sandbox reads a repository through the git gateway, beside the model gateway (`…/gw`). */
const repositoryUrl = (gateway: string, git: { connector: string; owner: string; repo: string }): string =>
  `${gateway.replace(/\/gw$/, "")}/git/${git.connector}/${git.owner}/${git.repo}.git`;

/**
 * A commit fetched into a sandbox, run there as `python3 -c CHECKOUT_SCRIPT <path> <commit>`: the lease is read and
 * removed before anything else, and its token goes to git only as a header of that one fetch (never into the
 * repository's configuration). The commit and up to 50 commits of its history, checked out detached, with no remote.
 */
export const CHECKOUT_SCRIPT = `import json,os,subprocess,sys
root, commit, lease = sys.argv[1], sys.argv[2], '/work/.galahad-gateway.json'
d = json.load(open(lease))
os.remove(lease)
def git(*a):
    try:
        r = subprocess.run(['git','-C',root,*a],capture_output=True,text=True,timeout=540)
    except subprocess.TimeoutExpired:
        sys.exit('git took too long')
    if r.returncode: sys.exit((r.stderr or r.stdout).strip()[-400:] or 'git failed')
    return r.stdout.strip()
os.makedirs(root,exist_ok=True)
git('init','-q')
git('-c','http.extraHeader=Authorization: Bearer '+d['GALAHAD_TOKEN'],'fetch','--quiet','--no-tags','--depth','50',d['GALAHAD_REPO_URL'],commit)
git('-c','advice.detachedHead=false','checkout','--quiet','--detach','FETCH_HEAD')
head = git('rev-parse','HEAD')
if head != commit: sys.exit('the checkout is at '+head+', not '+commit)
print(head)`;

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
  private readonly opts: SandboxHostOptions;
  private readonly bin: string;
  /** Sandboxes here are Apple's `container`'s, on a Mac: every one a VM of its own, its /work a volume. */
  private readonly apple: boolean;
  private readonly now: () => number;
  private readonly tokenStore: SandboxTokenStore;
  /** Workspaces made for a sandbox that hasn't started yet (so a cleanup never takes them). */
  private readonly creating = new Set<string>();
  private readonly building = new Map<string, Promise<{ ok: boolean; output: string }>>();

  constructor(opts: SandboxHostOptions) {
    this.apple = opts.engine === "container";
    this.opts = this.apple && !opts.workspaces ? { ...opts, workspaces: new ContainerVolumes((args, timeoutMs) => this.docker(args, timeoutMs)) } : opts;
    this.bin = opts.docker ?? (this.apple ? "container" : "docker");
    this.now = opts.now ?? Date.now;
    this.tokenStore = opts.tokenStore ?? memoryTokenStore();
  }

  /** What a sandbox asked for runs as: on a Mac always its own VM (more than a container, never less); with Docker, chooseIsolation's. */
  isolationFor(network: SandboxNetwork, asked: "container" | "vm" | undefined): "container" | "vm" {
    return this.apple ? "vm" : chooseIsolation(network, asked, !!this.opts.microVMs);
  }

  /** The kinds of sandbox made here: a Mac's are all VMs. */
  get kinds(): readonly ("container" | "vm")[] {
    return this.apple ? ["vm"] : this.opts.microVMs ? ["container", "vm"] : ["container"];
  }

  /** The most a sandbox is cut off here: no network at all, or on a Mac, which has no such network, the gateway's alone. */
  get strictest(): SandboxNetwork {
    return this.apple ? "gateway" : "isolated";
  }

  /** Whether a VM here grows while it runs (Kata's take more as they run; a Mac's stop and start again: resizeTeam). */
  get growsLive(): boolean {
    return !this.apple;
  }

  /** Whether a sandbox's CPUs are whole here (a Mac's VM is given whole ones: a part of one is a whole one). */
  get wholeCpus(): boolean {
    return this.apple;
  }

  /** Why this host won't make the sandbox asked for (a Mac: no network at all, an image not built for it), or null. */
  refusal(ask: SandboxAsk): string | null {
    return this.apple ? containerCannot(ask) : null;
  }

  /** A command's arguments in a sandbox, for this host's engine. */
  private commandArgs(id: string, cmd: string[], timeoutSec: number): string[] {
    return this.apple ? containerExecArgs(id, cmd, timeoutSec) : execArgs(id, cmd, timeoutSec);
  }

  /** Removing a sandbox's container (or VM), whatever it is doing. */
  private removeArgs(name: string): string[] {
    return this.apple ? containerDeleteArgs(name) : ["rm", "--force", name];
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
    if (this.apple) {
      // Its service answers when the API server's row is there; a major release this driver doesn't speak is no host.
      const version = parseContainerVersion((await this.docker(containerVersionArgs(), 8000)).stdout);
      return !!version?.running && version.major === CONTAINER_MAJOR;
    }
    return (await this.docker(["info", "--format", "{{.ServerVersion}}"], 8000)).code === 0;
  }

  async status() {
    if (!(await this.available())) return { docker: false, image: false, networks: { gateway: false, online: false } };
    if (this.apple) {
      // (`docker`: its engine answers. Online is container's default network, its service's own.)
      const [image, gw] = await Promise.all([this.docker(containerImageInspectArgs(DEFAULT_IMAGE)), this.docker(containerNetworkInspectArgs())]);
      return { docker: true, image: image.code === 0, networks: { gateway: gw.code === 0, online: true } };
    }
    const [image, gw, net] = await Promise.all([
      this.docker(["image", "inspect", DEFAULT_IMAGE, "--format", "{{.Id}}"]),
      this.docker(["network", "inspect", NETWORKS.gateway.name, "--format", "{{.Id}}"]),
      this.docker(["network", "inspect", NETWORKS.online.name, "--format", "{{.Id}}"]),
    ]);
    return { docker: true, image: image.code === 0, networks: { gateway: gw.code === 0, online: net.code === 0 } };
  }

  /**
   * Idempotent: creates the sandbox networks if missing. (On a Mac only the gateway's: online is container's own
   * default network. The ledger's resource names are the kinds of thing Galahad reads them as, whichever engine.)
   */
  async ensureNetworks(): Promise<void> {
    if (this.apple) {
      if ((await this.docker(containerNetworkInspectArgs())).code === 0) return;
      const result = await this.docker(containerNetworkCreateArgs());
      if (result.code !== 0) throw new SandboxError(`could not create network ${NETWORKS.gateway.name}: ${result.stderr.trim()}`, 500);
      this.opts.ledger({ class: "create", resource: "docker.network", target: NETWORKS.gateway.name, verdict: "allow", detail: "host-only (container network create --internal)" });
      return;
    }
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
        const result = await this.docker(this.apple ? containerBuildArgs(image, contextDir) : ["build", "--pull", "-t", image, contextDir], 60 * 60_000);
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
    return (await this.docker(this.apple ? containerImageInspectArgs(image) : ["image", "inspect", image, "--format", "{{.Id}}"])).code === 0;
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
    // (On a Mac nothing prunes images by itself: no keeper is needed, and container has no network to park one on.)
    if (!keeper || this.apple) return false;
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
    // Never weaker than asked: what a Mac can't give (no network at all, an image not built for it) isn't made here.
    const cannot = this.refusal(input);
    if (cannot) throw new SandboxError(cannot, 424);
    if (!(await this.available())) throw new SandboxError(this.apple ? "Apple's container isn't answering on this Mac: its service has to be running (container system start), at a 1.x release" : "docker is not available on this node", 424);
    if (input.cpus > this.opts.maxCpus) throw new SandboxError(`at most ${this.opts.maxCpus} CPUs on this node`);
    if (input.memoryGb > this.opts.maxMemoryGb) throw new SandboxError(`at most ${this.opts.maxMemoryGb} GB memory per sandbox on this node`);
    const isolation = this.isolationFor(input.network, input.isolation);
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
          spec.workspace = await this.opts.workspaces!.create(id, diskGb, { retain: input.persistent && quest.startsWith("arm.team.") });
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
      const args = this.apple ? containerRunArgs(spec) : runArgs(spec);
      let run = await this.docker(args, 10 * 60_000);
      // A microVM that lost its files as it started (lostItsFiles) is started once more, once the teardown it raced is done.
      if (run.code !== 0 && lostItsFiles(run.stderr)) {
        await this.docker(this.removeArgs(containerName(id)));
        await (this.opts.pause ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))))(2_000);
        run = await this.docker(args, 10 * 60_000);
      }
      if (run.code !== 0) {
        await this.docker(this.removeArgs(containerName(id)));
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
    // (container's cp names no tar stream, so on a Mac the VM's own tar writes one: as hostile as Docker's, to the same parser.)
    const proc = Bun.spawn([this.bin, ...(this.apple ? containerCollectArgs(id, path) : ["cp", `${containerName(id)}:${path}`, "-"])], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
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
    if (this.apple) {
      const listing = await this.docker(containerListArgs());
      const found = listing.code === 0 ? parseContainers(listing.stdout) : null;
      if (!found) return null;
      const usage = await this.workspaceStats();
      return found
        .filter((c) => c.labels[LABEL] === "1" && c.labels[`${LABEL}.node`] === this.opts.node)
        .map((c) => toView(c.labels, c.image, c.status, usage, { ...(c.cpus ? { NanoCpus: c.cpus * 1e9 } : {}), ...(c.memoryBytes ? { Memory: c.memoryBytes } : {}) }))
        .filter((v): v is SandboxView => v !== null)
        .sort((a, b) => b.createdAt - a.createdAt);
    }
    const listing = await this.docker(["ps", "-aq", "--filter", `label=${LABEL}=1`, "--filter", `label=${LABEL}.node=${this.opts.node}`]);
    if (listing.code !== 0) return null;
    const ids = listing.stdout
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!ids.length) return [];
    const inspected = await this.docker(["inspect", ...ids]);
    if (inspected.code !== 0) return null;
    const containers = JSON.parse(inspected.stdout) as { Config: { Labels: Record<string, string>; Image: string }; State: { Status: string }; HostConfig?: { NanoCpus?: number; Memory?: number } }[];
    const usage = await this.workspaceStats();
    return containers
      .map((c) => toView(c.Config.Labels, c.Config.Image, c.State.Status, usage, c.HostConfig))
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
  /**
   * A knight's VM, ready for a task: started if it isn't, and given a fresh lease. `providers`: what the lease covers,
   * the providers with a key now (the controller says), so a key added since the VM was made reaches it; absent, what
   * the VM was made with.
   */
  async prepareTeam(id: string, quest: string, git?: { connector: string; owner: string; repo: string }, providers?: readonly string[]): Promise<SandboxView> {
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
    const covered = providers ? [...providers] : sandbox.providers;
    const scopes = [...covered, ...(git ? [`git:${git.connector}:${git.owner}:${git.repo}`] : [])];
    const minted = this.opts.tokens.mint({ label: `sandbox:${id}`, providers: scopes, ttlMinutes: 30, maxRequests: 500 });
    this.tokenStore.put(id, minted.info.hash);
    const env = gatewayEnv(minted.token, covered);
    if (git) env.GALAHAD_REPO_URL = repositoryUrl(env.GALAHAD_GATEWAY!, git);
    if (!(await this.writeLease(id, env))) {
      this.opts.tokens.revoke(minted.info.hash);
      throw new SandboxError("could not prepare the teammate's model access", 424);
    }
    this.opts.ledger({ class: "modify", resource: "sandbox.team-ready", target: sandbox.name, verdict: "allow", quest, detail: "existing VM resumed; model access capped at 30 minutes and 500 requests" });
    return { ...sandbox, status: "running" };
  }

  /** A lease written inside a sandbox as /work/.galahad-gateway.json: JSON, never a shell's configuration. Whether it was. */
  private async writeLease(id: string, env: Record<string, string>): Promise<boolean> {
    const payload = Buffer.from(JSON.stringify(env)).toString("base64");
    const write = "import os,sys,base64,tempfile; f,p=tempfile.mkstemp(prefix='.galahad-gateway-',dir='/work'); os.write(f,base64.b64decode(sys.argv[1])); os.fsync(f); os.close(f); os.replace(p,'/work/.galahad-gateway.json')";
    try {
      return (await this.docker(this.commandArgs(id, ["python3", "-c", write, payload], 30), 45_000)).code === 0;
    } catch {
      return false;
    }
  }

  /**
   * Owner only. A commit of a GitHub repository put in a sandbox that isn't a knight's VM (a trial of your own work's),
   * through the git gateway: a lease for that one repository is written inside the sandbox, where the fetch reads it
   * and removes it (it is in no command, answer or ledger line), and revoked once the fetch is over, whatever happened.
   * The commit and up to 50 commits of its history are checked out at `path`, detached, with no remote: nothing after it.
   */
  async checkoutRepository(id: string, git: { connector: string; owner: string; repo: string }, commit: string, path: string): Promise<{ commit: string }> {
    const sandbox = await this.get(id);
    if (!sandbox) throw new SandboxError("no such sandbox on this node", 404);
    if (!sandbox.ephemeral) throw new SandboxError("a knight's VM is given its repository as it is prepared, not this way", 409);
    if (sandbox.network === "isolated") throw new SandboxError("a sandbox with no network can't reach the git gateway", 409);
    if (sandbox.status !== "running") throw new SandboxError(`sandbox is ${sandbox.status}`, 409);
    const minted = this.opts.tokens.mint({ label: `sandbox:${id}`, providers: [`git:${git.connector}:${git.owner}:${git.repo}`], ttlMinutes: 15, maxRequests: 100 });
    try {
      const { GALAHAD_GATEWAY } = gatewayEnv(minted.token, []);
      if (!(await this.writeLease(id, { GALAHAD_GATEWAY: GALAHAD_GATEWAY!, GALAHAD_TOKEN: minted.token, GALAHAD_REPO_URL: repositoryUrl(GALAHAD_GATEWAY!, git) }))) {
        throw new SandboxError("could not give the sandbox its lease on the repository", 424);
      }
      const fetched = await this.docker(this.commandArgs(id, ["python3", "-c", CHECKOUT_SCRIPT, path, commit], 600), 615_000);
      if (fetched.code !== 0) {
        const said = redact((fetched.stderr || fetched.stdout).replaceAll(minted.token, "…")).trim().split("\n").at(-1) ?? "";
        throw new SandboxError(`couldn't fetch ${commit.slice(0, 12)} of ${git.owner}/${git.repo}: ${said.slice(0, 300) || `exit ${fetched.code}`}`, 424);
      }
      this.opts.ledger({ class: "read", resource: "sandbox.checkout", target: sandbox.name, verdict: "allow", quest: sandbox.quest, detail: `${git.owner}/${git.repo} at ${commit.slice(0, 12)} through ${git.connector}, into ${path}; its lease revoked once fetched` });
      return { commit };
    } finally {
      this.opts.tokens.revoke(minted.info.hash);
    }
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
    const cannot = this.apple ? containerCannot({ desktop: image === DESKTOP_IMAGE }) : null;
    if (cannot) throw new SandboxError(cannot, 424);
    if (!(await this.hasImage(image))) throw new SandboxError(`${image} is not built on this node: run \`galahad sandbox build${image === DESKTOP_IMAGE ? " --desktop" : ""}\` first`, 424);
    if (this.apple) {
      // On a Mac: stopped, deleted and made again on the same volume (no rename there), or put back as it was.
      await this.replaceTeamVm(sandbox, quest, { image, network, providers, cpus: sandbox.cpus, memoryGb: sandbox.memoryGb });
      this.opts.ledger({
        class: "modify",
        resource: "docker.container",
        target: containerName(id),
        verdict: "approved",
        reason: `approved by ${opts.approvedBy.slice(0, 12)}`,
        quest,
        detail: `made again from ${image} as it is now · /work kept · ${network} · ${sandbox.cpus} cpu · ${sandbox.memoryGb} GB`,
      });
      return (await this.get(id))!;
    }
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
   * A knight's VM made bigger while it runs, on the owner's word: more threads and memory (the microVM takes them as it
   * runs, hot-added), and more disk (its workspace grows where it is mounted). Nothing stops and nothing is lost. Never
   * smaller this way: what a running VM was given isn't taken from under it (`remakeTeam` makes it again, and a smaller
   * size takes effect then). `fits` says why what it adds doesn't fit the node's ceiling, or null. Returns it as it is now.
   */
  async resizeTeam(id: string, quest: string, opts: { cpus?: number; memoryGb?: number; diskGb?: number; approvedBy: string; why?: string; fits?: (more: { cpus: number; memoryGb: number }) => string | null; /** Told when it had to stop and start again to take it (a Mac's VM). */ paused?: () => void }): Promise<SandboxView> {
    const sandbox = await this.get(id);
    if (!sandbox) throw new SandboxError("the teammate's VM is missing; its workspace must be recovered, not replaced", 404);
    if (!TeamWorkspaceQuest.safeParse(quest).success || sandbox.quest !== quest || sandbox.ephemeral || sandbox.isolation !== "vm") {
      throw new SandboxError("that is not this teammate's persistent VM", 403);
    }
    const cpus = opts.cpus ?? sandbox.cpus;
    const memoryGb = opts.memoryGb ?? sandbox.memoryGb;
    const disk = sandbox.disk?.limitGb ?? null;
    if (cpus < sandbox.cpus || memoryGb < sandbox.memoryGb || (opts.diskGb !== undefined && disk !== null && opts.diskGb < disk)) {
      throw new SandboxError(`a running VM only grows (it has ${sandbox.cpus} cpu, ${sandbox.memoryGb} GB${disk !== null ? `, ${disk} GB of disk` : ""}): to give it less, make it again`, 409);
    }
    if (opts.diskGb !== undefined && opts.diskGb !== disk && disk === null) throw new SandboxError("this VM's /work has no size of its own to grow: it was made before workspaces had one", 409);
    const maxDiskGb = this.opts.maxDiskGb ?? 200;
    if (opts.diskGb !== undefined && opts.diskGb > maxDiskGb) throw new SandboxError(`at most ${maxDiskGb} GB of workspace per sandbox on this node`);
    const more = { cpus: cpus - sandbox.cpus, memoryGb: memoryGb - sandbox.memoryGb };
    const grows = disk !== null && opts.diskGb !== undefined && opts.diskGb > disk;
    if (!more.cpus && !more.memoryGb && !grows) return sandbox;
    // (container fixes a volume's size as it makes it, and has no way to change it after.)
    if (grows && this.apple) throw new SandboxError("a VM's disk on a Mac keeps the size it was made with: container fixes a volume's size as it makes it, so it can't grow there yet", 409);
    if (grows) {
      if (!this.opts.workspaces?.grow) throw new SandboxError("update the workspace helper before growing a teammate's disk", 424);
      const problem = budgetProblem(await this.opts.workspaces.stats(), opts.diskGb! - disk!);
      if (problem) throw new SandboxError(problem, 507);
    }
    const unfit = more.cpus || more.memoryGb ? (opts.fits?.(more) ?? null) : null;
    if (unfit) throw new SandboxError(unfit, 409);
    const name = containerName(id);
    const record = (now: { cpus: number; memoryGb: number }) =>
      this.opts.ledger({
        class: "modify",
        resource: "docker.container",
        target: name,
        // Galahad's own giving (growTeammate) is his, and says why; anything else was approved by a device of yours.
        verdict: opts.why ? "allow" : "approved",
        reason: opts.why ? `grown by Galahad: ${redact(opts.why).slice(0, 200)}` : `approved by ${opts.approvedBy.slice(0, 12)}`,
        quest,
        detail: `${this.apple ? "paused to grow (a Mac's VM can't grow while it runs)" : "grown while it runs"}: ${now.cpus} cpu · ${now.memoryGb} GB${grows ? ` · ${opts.diskGb} GB disk` : disk !== null ? ` · ${disk} GB disk` : ""}`,
      });
    if (this.apple) {
      // A Mac's VM can't take more as it runs: it stops, is made again with more on its own /work, and starts.
      await this.replaceTeamVm(sandbox, quest, { image: sandbox.image, network: sandbox.network === "isolated" ? "gateway" : sandbox.network, providers: sandbox.providers, cpus, memoryGb });
      opts.paused?.();
      record({ cpus, memoryGb });
      return (await this.get(id))!;
    }
    // The disk first: it isn't the governor's, so when it can't grow nothing the governor counts has changed, and its
    // giving back (governed-host) is true. Threads and memory after: when they can't be added, the disk has grown, and
    // the ledger and the error both say so.
    if (grows) await this.opts.workspaces!.grow!(id, opts.diskGb!);
    if (more.cpus || more.memoryGb) {
      const memory = `${Math.round(memoryGb * 1024)}m`;
      const updated = await this.docker(["update", "--cpus", String(cpus), "--memory", memory, "--memory-swap", memory, name]);
      if (updated.code !== 0) {
        if (grows) record({ cpus: sandbox.cpus, memoryGb: sandbox.memoryGb });
        throw new SandboxError(`could not give the teammate's VM more threads or memory, so they are as they were${grows ? `; its disk did grow, to ${opts.diskGb} GB` : ""}: ${redact(updated.stderr).split("\n")[0]!.slice(0, 300)}`, 424);
      }
    }
    record({ cpus, memoryGb });
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
      const ran = await this.docker(this.commandArgs(id, argv, 60), 75_000);
      if (ran.code !== 0) failed(ran);
      this.opts.ledger({ class: "modify", resource: "sandbox.desktop", target: sandbox.name, verdict: "allow", quest, detail: did || redact(argv.slice(1).join(" ")).slice(0, 300) });
    }
    const shot = await this.docker(this.commandArgs(id, ["sh", "-c", 'f="${TMPDIR:-/tmp}/watch-$$.jpg"; desktop shot "$f" >/dev/null && base64 -w0 "$f"; code=$?; rm -f "$f"; exit $code'], 60), 75_000);
    if (shot.code !== 0 || !shot.stdout.trim()) failed(shot);
    return { shot: { mediaType: "image/jpeg", data: shot.stdout.trim() }, width: 1280, height: 800 };
  }

  async exec(id: string, cmd: string[], timeoutSec = 600): Promise<ExecResult> {
    const sandbox = await this.get(id);
    if (!sandbox) throw new SandboxError("no such sandbox on this node", 404);
    if (sandbox.status !== "running") throw new SandboxError(`sandbox is ${sandbox.status}`, 409);
    const started = performance.now();
    const result = await this.docker(this.commandArgs(id, cmd, timeoutSec), (timeoutSec + 15) * 1000);
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
   * here, so what runs there (an editor, a vendor's sign-in, a coding tool's screen) has a real terminal. Killing it
   * hangs up what it started in the sandbox too (TERMINAL_HANG_UP). Not ledgered here: whoever keeps the terminal
   * says when it opened and closed, and never what was typed or shown.
   */
  async terminal(id: string, size: { cols: number; rows: number }, onData: (bytes: Uint8Array) => void): Promise<{ name: string; quest: string | null; process: TerminalProcess }> {
    const sandbox = await this.get(id);
    if (!sandbox) throw new SandboxError("no such sandbox on this node", 404);
    if (sandbox.status !== "running") throw new SandboxError(`sandbox is ${sandbox.status}`, 409);
    const tag = hex(randomBytes(8));
    const shell = (this.opts.spawnTerminal ?? spawnTerminal)([this.bin, ...(this.apple ? containerTerminalArgs(id, tag) : terminalArgs(id, tag))], size, onData);
    const hangUp = () => void this.docker(this.commandArgs(id, ["sh", "-c", TERMINAL_HANG_UP, "hang-up", tag], 30), 45_000).catch(() => {});
    return {
      name: sandbox.name,
      quest: sandbox.quest || null,
      process: {
        write: (data) => shell.write(data),
        resize: (cols, rows) => shell.resize(cols, rows),
        kill: () => {
          shell.kill();
          hangUp();
        },
        exited: shell.exited,
      },
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
    await this.docker(this.apple ? containerDeleteArgs(containerName(id)) : ["rm", "--force", "--volumes", containerName(id)]);
    if (sandbox.disk) {
      const ws = this.opts.workspaces;
      const remove = opts.approvedBy && !sandbox.ephemeral && ws?.removeRetained ? ws.removeRetained.bind(ws) : ws?.remove.bind(ws);
      await remove?.(id).catch((error) => this.opts.ledger({ class: "delete", resource: "sandbox.workspace", target: id, verdict: "allow", detail: `not removed: ${(error as Error).message}` }));
    }
    else await this.docker(this.apple ? containerVolumeDeleteArgs(id) : ["volume", "rm", "--force", volumeName(id)]);
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
      const alive = await this.aliveIds();
      for (const image of stats.images) {
        // Any galahad container on this Docker counts (another node or a test may share the host), and a
        // young workspace may belong to a sandbox that is still starting in another process.
        if (image.retained || !alive || alive.has(image.id) || this.creating.has(image.id) || now - image.createdAt < 10 * 60_000) continue;
        await this.opts.workspaces!.remove(image.id).catch(() => {});
        this.opts.ledger({ class: "delete", resource: "sandbox.workspace", target: image.id, verdict: "allow", reason: "cleaning up the workspace of a sandbox that no longer exists" });
        reaped.push(`workspace ${image.id}`);
      }
    }
    return reaped;
  }

  /** The ids of every galahad sandbox the engine has, any node's; null when it couldn't say (never read as "none"). */
  private async aliveIds(): Promise<Set<string> | null> {
    if (this.apple) {
      const listing = await this.docker(containerListArgs());
      const found = listing.code === 0 ? parseContainers(listing.stdout) : null;
      return found ? new Set(found.filter((c) => c.labels[LABEL] === "1").map((c) => c.labels[`${LABEL}.id`] ?? "")) : null;
    }
    const listed = await this.docker(["ps", "-a", "--filter", `label=${LABEL}=1`, "--format", `{{.Label "${LABEL}.id"}}`]);
    return listed.code === 0 ? new Set(listed.stdout.split("\n").map((s) => s.trim())) : null;
  }

  /**
   * A knight's VM on a Mac made again as `next`, its /work kept. container can't change a container that exists, nor
   * rename one, so the old one is stopped and deleted (its /work is a volume of its own, made to be kept, which
   * stays), and the new one is made under the same name on the same volume. What ran in it stops, so it paused.
   * One that won't start is cleared away, and the old one is made again as it was (from its image's name, with a
   * fresh lease for what it had) and the error says so. The token store keeps the lease it runs with after.
   */
  private async replaceTeamVm(sandbox: SandboxView, quest: string, next: { image: string; network: "online" | "gateway"; providers: string[]; cpus: number; memoryGb: number }): Promise<void> {
    const id = sandbox.id;
    const name = containerName(id);
    const asWas = { image: sandbox.image, network: sandbox.network === "isolated" ? "gateway" as const : sandbox.network, providers: sandbox.providers, cpus: sandbox.cpus, memoryGb: sandbox.memoryGb };
    const made: string[] = [];
    /** Run it as `as`, with a lease of its own; the lease's hash, or the error. */
    const runAs = async (as: typeof next): Promise<{ hash?: string; error?: string }> => {
      let env: Record<string, string> = {};
      let minted: { token: string; hash: string } | undefined;
      if (as.providers.length) {
        const lease = this.opts.tokens.mint({ label: `sandbox:${id}`, providers: as.providers, ttlMinutes: 7 * 24 * 60, maxRequests: 100_000 });
        env = gatewayEnv(lease.token, as.providers);
        minted = { token: lease.token, hash: lease.info.hash };
      }
      const spec: SandboxSpec = {
        id,
        quest,
        node: this.opts.node,
        image: as.image,
        network: as.network,
        cpus: as.cpus,
        memoryGb: as.memoryGb,
        pidsLimit: 1024,
        ttlMinutes: Math.max(0, Math.round((sandbox.expiresAt - sandbox.createdAt) / 60_000)),
        ephemeral: false,
        providers: as.providers,
        createdAt: sandbox.createdAt,
        env,
        isolation: "vm",
        ...(minted ? { tokenHash: minted.hash } : {}),
        ...(sandbox.disk ? { workspace: volumeName(id), diskGb: sandbox.disk.limitGb } : {}),
      };
      const run = await this.docker(containerRunArgs(spec), 10 * 60_000);
      if (run.code === 0) return minted ? { hash: minted.hash } : {};
      await this.docker(containerDeleteArgs(name));
      if (minted) this.opts.tokens.revoke(minted.hash);
      // (container may say the new VM's arguments back, and its lease is among them.)
      let why = redact(run.stderr.trim() || `container run exited ${run.code}`).split("\n")[0]!.slice(0, 300);
      if (minted) why = why.replaceAll(minted.token, "[its lease]");
      return { error: why };
    };
    // Its volume is never an orphan's while this runs (the reaper skips what is being made).
    this.creating.add(id);
    try {
      await this.ensureNetworks();
      await this.docker(containerStopArgs(name), 60_000);
      const removed = await this.docker(containerDeleteArgs(name));
      if (removed.code !== 0) {
        if (sandbox.status === "running") await this.docker(["start", name], 120_000);
        throw new SandboxError(`could not set the teammate's VM aside, so it is as it was: ${redact(removed.stderr).split("\n")[0]!.slice(0, 300)}`, 424);
      }
      const now = await runAs(next);
      if (now.error) {
        const back = await runAs(asWas);
        if (back.error) throw new SandboxError(`could not make the teammate's VM again (${now.error}), nor put it back as it was (${back.error}): its /work is kept, in ${volumeName(id)}`, 424);
        if (sandbox.status !== "running") await this.docker(containerStopArgs(name), 60_000);
        made.push(...(back.hash ? [back.hash] : []));
        throw new SandboxError(`could not make the teammate's VM again, so it is as it was: ${now.error}`, 424);
      }
      made.push(...(now.hash ? [now.hash] : []));
    } finally {
      this.creating.delete(id);
      // The lease it runs with now (new, or the one it was put back with) is the one the store keeps.
      if (made.length) {
        const previous = this.tokenStore.take(id);
        if (previous) this.opts.tokens.revoke(previous);
        this.tokenStore.put(id, made[0]!);
      }
    }
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

function toView(labels: Record<string, string>, image: string, status: string, usage: WorkspaceStats | null, held?: { NanoCpus?: number; Memory?: number }): SandboxView | null {
  const id = labels[`${LABEL}.id`];
  if (!id || labels[LABEL] !== "1") return null;
  // A VM may have been grown since its labels were written: what Docker holds it to now, and its workspace's size as
  // the helper has it, say what it is (its labels, what it was made with, where those can't be had).
  const workspace = usage?.images.find((i) => i.id === id);
  const labelled = Number(labels[`${LABEL}.disk`]);
  // (A workspace only grows: never less than it was made with.)
  const limit = labelled > 0 && workspace ? Math.max(labelled, Math.round(workspace.sizeBytes / 2 ** 30)) : labelled;
  const used = workspace?.usedBytes;
  return {
    id,
    name: containerName(id),
    node: labels[`${LABEL}.node`] ?? "",
    quest: labels[`${LABEL}.quest`] ?? "",
    image,
    network: (labels[`${LABEL}.network`] ?? "isolated") as SandboxView["network"],
    cpus: held?.NanoCpus ? held.NanoCpus / 1e9 : Number(labels[`${LABEL}.cpus`] ?? 0),
    memoryGb: held?.Memory ? Math.round((held.Memory / 2 ** 30) * 100) / 100 : Number(labels[`${LABEL}.memory`] ?? 0),
    createdAt: Number(labels[`${LABEL}.created`] ?? 0),
    expiresAt: Number(labels[`${LABEL}.expires`] ?? 0),
    status,
    ephemeral: labels[`${LABEL}.ephemeral`] !== "false",
    providers: (labels[`${LABEL}.providers`] ?? "").split(",").filter((p) => p && p !== RETIRED_SCOPE),
    disk: limit > 0 ? { limitGb: limit, usedGb: used === undefined ? null : Math.round((used / 2 ** 30) * 10) / 10 } : null,
    isolation: labels[`${LABEL}.isolation`] === "vm" ? "vm" : "container",
  };
}
