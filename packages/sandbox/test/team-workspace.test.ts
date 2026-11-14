import { describe, expect, test } from "bun:test";
import { containerName, LABEL, NETWORKS, SandboxHost, type LedgerEntryInput, type TokenMinter, type Workspaces } from "../src/index.ts";

const ID = "0123456789";
const QUEST = "arm.team.abcdef0123.builder";
const OLD_LEASE = "test-only-old-lease-hash";
const lease = (n: number) => `test-only-gateway-lease-${n}`;
/** Where the helper mounted the VM's disk on the host. */
const DISK = `/var/lib/galahad-workspaces/${ID}/mnt`;
const REMADE = { providers: ["openai"], approvedBy: "test-owner" };

/** Docker/helper stand-ins: no containers, mounts, host files, or real credentials. */
function teammateHost(opts: {
  status?: string;
  labels?: Record<string, string>;
  missing?: boolean;
  legacyHelper?: boolean;
  failure?: "mount" | "start" | "write" | "throw-write" | "run";
  /** A remake that was cut short: the container is only there under the name it was set aside as. */
  setAside?: boolean;
} = {}) {
  const commands: string[][] = [];
  const events: string[] = [];
  /** `events`, and with them everything else asked of Docker (stop, rename, run, rm), in the order it happened. */
  const all: string[] = [];
  const note = (event: string) => { events.push(event); all.push(event); };
  const ledger: LedgerEntryInput[] = [];
  const minted: Parameters<TokenMinter["mint"]>[0][] = [];
  const revoked: string[] = [];
  const stored = new Map([[ID, OLD_LEASE]]);
  /** The containers Docker has by name. */
  const named = new Set([opts.setAside ? `${containerName(ID)}-replaced` : containerName(ID)]);
  const workspaces: Workspaces = {
    available: async () => true,
    create: async () => { throw new Error("resume must not create a workspace"); },
    retain: async (id) => { note(`retain:${id}`); },
    mount: async (id) => {
      note(`mount:${id}`);
      if (opts.failure === "mount") throw new Error("existing workspace is missing");
    },
    remove: async (id) => { note(`remove:${id}`); },
    removeRetained: async (id) => { note(`remove-owned:${id}`); },
    stats: async () => ({ totalBytes: 100, freeBytes: 90, images: [
      { id: ID, sizeBytes: 10, usedBytes: 1, mounted: false, createdAt: 0, retained: true },
    ] }),
  };
  if (opts.legacyHelper) { delete workspaces.mount; delete workspaces.retain; }
  const labels = {
    [LABEL]: "1", [`${LABEL}.id`]: ID, [`${LABEL}.node`]: "test", [`${LABEL}.quest`]: QUEST,
    [`${LABEL}.network`]: "gateway", [`${LABEL}.ephemeral`]: "false", [`${LABEL}.isolation`]: "vm",
    // A VM made before the world was removed: its label still names that scope, and it is read as nothing.
    [`${LABEL}.providers`]: "openai,world", [`${LABEL}.disk`]: "20", ...opts.labels,
  };
  const host = new SandboxHost({
    node: "test", maxCpus: 8, maxMemoryGb: 16, workspaces,
    tokenStore: {
      put: (id, hash) => { stored.set(id, hash); },
      take: (id) => { const value = stored.get(id) ?? null; stored.delete(id); return value; },
    },
    tokens: {
      mint: (scope) => {
        minted.push(scope); note("mint");
        return { token: lease(minted.length), info: { hash: `test-only-hash-${minted.length}` } };
      },
      revoke: (hash) => { revoked.push(hash); note(`revoke:${hash}`); return true; },
    },
    ledger: (entry) => { ledger.push(entry); },
    runner: async (args) => {
      commands.push(args);
      if (args[0] === "ps") return { code: 0, stdout: opts.missing ? "" : ID, stderr: "" };
      // (Asked of one container by name: whether it is there, and where its /work comes from.)
      if (args[0] === "inspect" && args[1] === "--format") {
        if (args[2] === "{{.Name}}") return named.has(args[3]!) ? { code: 0, stdout: `/${args[3]}`, stderr: "" } : { code: 1, stdout: "", stderr: "No such object" };
        return { code: 0, stdout: JSON.stringify([{ Type: "bind", Source: DISK, Destination: "/work" }, { Type: "bind", Source: "/etc/galahad/resolv.conf", Destination: "/etc/resolv.conf" }]), stderr: "" };
      }
      if (args[0] === "stop") all.push("stop");
      if (args[0] === "rename") { all.push(`rename:${args[1]}>${args[2]}`); named.delete(args[1]!); named.add(args[2]!); }
      if (args[0] === "rm") { all.push(`rm:${args.at(-1)}`); named.delete(args.at(-1)!); }
      if (args[0] === "run") {
        all.push("run");
        if (opts.failure === "run") return { code: 125, stdout: "", stderr: `kata: could not start the VM (${lease(1)})` };
        named.add(args[args.indexOf("--name") + 1]!);
      }
      if (args[0] === "inspect") return { code: 0, stdout: JSON.stringify([
        { Config: { Labels: labels, Image: "galahad/sandbox:1" }, State: { Status: opts.status ?? "exited" } },
      ]), stderr: "" };
      if (args[0] === "start") {
        note("start");
        if (opts.failure === "start") return { code: 1, stdout: "", stderr: "failed to start" };
      }
      if (args[0] === "exec") {
        note("write");
        if (opts.failure === "throw-write") throw new Error(`transport failed with ${lease(1)}`);
        if (opts.failure === "write") return { code: 1, stdout: lease(1), stderr: lease(1) };
      }
      return { code: 0, stdout: "", stderr: "" };
    },
  });
  return { host, commands, events, all, ledger, minted, revoked, stored };
}

describe("persistent teammate workspaces", () => {
  test("resume remounts and starts the exact existing VM, then rotates a bounded scoped lease", async () => {
    const f = teammateHost();
    const resumed = await f.host.prepareTeam(ID, QUEST, { connector: "github", owner: "example", repo: "project" });
    expect(resumed).toMatchObject({ id: ID, quest: QUEST, status: "running", ephemeral: false, isolation: "vm" });
    expect(f.events).toEqual([`retain:${ID}`, `mount:${ID}`, "start", `revoke:${OLD_LEASE}`, "mint", "write"]);
    expect(f.commands.find((args) => args[0] === "start")).toEqual(["start", containerName(ID)]);
    expect(f.commands.some((args) => ["run", "create", "volume"].includes(args[0]!))).toBe(false);
    expect(f.minted).toEqual([{ label: `sandbox:${ID}`, providers: ["openai", "git:github:example:project"], ttlMinutes: 30, maxRequests: 500 }]);
    const payload = f.commands.find((args) => args[0] === "exec")!.at(-1)!;
    const env = JSON.parse(Buffer.from(payload, "base64").toString());
    expect(env.OPENAI_API_KEY).toBe(lease(1));
    expect(env.OPENAI_BASE_URL).toBe("http://172.31.250.1:7779/gw/openai");
    expect(env).not.toHaveProperty("GALAHAD_WORLD");
    expect(env.GALAHAD_TOKEN).toBe(lease(1));
    expect(env.GALAHAD_REPO_URL).toBe("http://172.31.250.1:7779/git/github/example/project.git");
    const visible = JSON.stringify({ resumed, ledger: f.ledger });
    expect(visible).not.toContain(lease(1));
    expect(visible).not.toContain("test-only-hash-1");
    expect(visible).not.toContain(payload);
    expect(f.ledger).toEqual([expect.objectContaining({ resource: "sandbox.team-ready", quest: QUEST, verdict: "allow" })]);
  });

  test("renewal revokes the persisted prior lease and then each superseded lease", async () => {
    const f = teammateHost({ status: "running" });
    await f.host.prepareTeam(ID, QUEST);
    await f.host.prepareTeam(ID, QUEST);
    expect(f.revoked).toEqual([OLD_LEASE, "test-only-hash-1"]);
    expect(f.stored.get(ID)).toBe("test-only-hash-2");
    expect(f.commands.some((args) => args[0] === "start")).toBe(false);
    expect(f.minted.every((scope) => scope.ttlMinutes === 30 && scope.maxRequests === 500)).toBe(true);
  });

  test("a missing VM is never replaced during resume", async () => {
    const f = teammateHost({ missing: true });
    await expect(f.host.prepareTeam(ID, QUEST)).rejects.toMatchObject({ status: 404 });
    expect(f.events).toEqual([]);
    expect(f.commands.some((args) => ["run", "create", "start", "exec", "volume"].includes(args[0]!))).toBe(false);
  });

  const refusedResumes: { name: string; id: string; quest: string; labels: Record<string, string>; status: number }[] = [
    { name: "another VM id", id: "9876543210", quest: QUEST, labels: {}, status: 404 },
    { name: "another teammate", id: ID, quest: "arm.team.abcdef0123.other", labels: {}, status: 403 },
    { name: "another controller", id: ID, quest: "arm.team.9876543210.builder", labels: {}, status: 403 },
    { name: "an unscoped legacy quest", id: ID, quest: "arm.team.builder", labels: { [`${LABEL}.quest`]: "arm.team.builder" }, status: 403 },
    { name: "a non-team quest", id: ID, quest: "arm.other", labels: { [`${LABEL}.quest`]: "arm.other" }, status: 403 },
    { name: "an ephemeral VM", id: ID, quest: QUEST, labels: { [`${LABEL}.ephemeral`]: "true" }, status: 403 },
    { name: "a persistent container", id: ID, quest: QUEST, labels: { [`${LABEL}.isolation`]: "container" }, status: 403 },
  ];
  test.each(refusedResumes)("resume refuses $name before workspace or credential mutations", async ({ id, quest, labels, status }) => {
    const f = teammateHost({ labels });
    await expect(f.host.prepareTeam(id, quest)).rejects.toMatchObject({ status });
    expect(f.events).toEqual([]);
    expect(f.stored.get(ID)).toBe(OLD_LEASE);
  });

  test.each(["created", "exited"])("a %s VM can resume; an unsupported state cannot", async (status) => {
    const f = teammateHost({ status });
    expect((await f.host.prepareTeam(ID, QUEST)).status).toBe("running");
    expect(f.events).toContain("start");
    const paused = teammateHost({ status: "paused" });
    await expect(paused.host.prepareTeam(ID, QUEST)).rejects.toMatchObject({ status: 409 });
    expect(paused.minted).toEqual([]);
    expect(paused.commands.some((args) => ["start", "exec"].includes(args[0]!))).toBe(false);
  });

  test("an old helper or unavailable disk refuses resume without starting a VM or minting access", async () => {
    for (const options of [{ legacyHelper: true }, { failure: "mount" as const }, { failure: "start" as const }]) {
      const f = teammateHost(options);
      await expect(f.host.prepareTeam(ID, QUEST)).rejects.toThrow();
      expect(f.minted).toEqual([]);
      expect(f.commands.some((args) => args[0] === "exec")).toBe(false);
      if (options.failure !== "start") expect(f.commands.some((args) => args[0] === "start")).toBe(false);
    }
  });

  test.each(["write", "throw-write"] as const)("a %s failure revokes the new lease and exposes no token", async (failure) => {
    const f = teammateHost({ failure });
    let thrown: unknown;
    try { await f.host.prepareTeam(ID, QUEST); } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(Error);
    expect(f.revoked).toEqual([OLD_LEASE, "test-only-hash-1"]);
    expect(String(thrown)).not.toContain(lease(1));
    expect(JSON.stringify(f.ledger)).not.toContain(lease(1));
    expect(f.ledger.some((entry) => entry.resource === "sandbox.team-ready")).toBe(false);
  });

  test("only owner-approved destruction removes retained workspace data", async () => {
    const f = teammateHost();
    expect((await f.host.destroy(ID, { quest: QUEST })).verdict).toBe("ask");
    expect(f.events).toEqual([]);
    expect(f.commands.some((args) => args[0] === "rm")).toBe(false);
    expect((await f.host.destroy(ID, { approvedBy: "test-owner" })).verdict).toBe("allow");
    expect(f.events).toEqual([`remove-owned:${ID}`, `revoke:${OLD_LEASE}`]);
    expect(f.commands.find((args) => args[0] === "rm")).toEqual(["rm", "--force", "--volumes", containerName(ID)]);
    expect(f.ledger.at(-1)?.verdict).toBe("approved");
  });

  test("a knight's VM is made again from its image as it is now: the same VM and disk, a new lease, and the old container goes only once the new one runs", async () => {
    const f = teammateHost({ status: "running", labels: { [`${LABEL}.cpus`]: "2", [`${LABEL}.memory`]: "4", [`${LABEL}.created`]: "1000", [`${LABEL}.expires`]: "604801000" } });
    const remade = await f.host.remakeTeam(ID, QUEST, REMADE);
    expect(remade).toMatchObject({ id: ID, quest: QUEST, ephemeral: false, isolation: "vm" });
    const name = containerName(ID);
    expect(f.all).toEqual([`retain:${ID}`, "stop", `rename:${name}>${name}-replaced`, `mount:${ID}`, "mint", "run", `rm:${name}-replaced`, `revoke:${OLD_LEASE}`]);
    const run = f.commands.find((args) => args[0] === "run")!;
    const after = (flag: string) => run[run.indexOf(flag) + 1];
    // The same VM: its name, its disk where the helper has it, what it was given, and who it is.
    expect(after("--name")).toBe(name);
    expect(run).toContain(`type=bind,src=${DISK},dst=/work`);
    expect([after("--cpus"), after("--memory"), after("--runtime"), after("--network")]).toEqual(["2", "4096m", "io.containerd.kata.v2", NETWORKS.gateway.name]);
    for (const label of [`${LABEL}.id=${ID}`, `${LABEL}.quest=${QUEST}`, `${LABEL}.ephemeral=false`, `${LABEL}.created=1000`, `${LABEL}.expires=604801000`, `${LABEL}.disk=20`, `${LABEL}.isolation=vm`, `${LABEL}.providers=openai`]) expect(run).toContain(label);
    // From the image by its name, which is the image as it is built now.
    expect(run.slice(-3)).toEqual(["galahad/sandbox:1", "sleep", "infinity"]);
    // The container that was is removed, and nothing of its disk: no volumes flag, no word to the helper to remove.
    expect(f.commands.filter((args) => args[0] === "rm")).toEqual([["rm", "--force", `${name}-replaced`]]);
    expect(f.all.some((event) => event.startsWith("remove"))).toBe(false);
    // A new lease in its environment; the one before is revoked only after the new VM runs.
    expect(run).toContain(`GALAHAD_TOKEN=${lease(1)}`);
    expect(f.stored.get(ID)).toBe("test-only-hash-1");
    expect(f.minted).toEqual([{ label: `sandbox:${ID}`, providers: ["openai"], ttlMinutes: 7 * 24 * 60, maxRequests: 100_000 }]);
    expect(f.ledger).toEqual([expect.objectContaining({ class: "modify", resource: "docker.container", target: name, verdict: "approved", quest: QUEST, detail: expect.stringContaining("made again from galahad/sandbox:1") })]);
    expect(JSON.stringify({ remade, ledger: f.ledger })).not.toContain(lease(1));
  });

  test("a VM that will not start again is put back as it was, and the lease it had still holds", async () => {
    const f = teammateHost({ status: "running", failure: "run" });
    const name = containerName(ID);
    let thrown: unknown;
    try { await f.host.remakeTeam(ID, QUEST, REMADE); } catch (error) { thrown = error; }
    expect(thrown).toMatchObject({ status: 424 });
    expect(String(thrown)).toContain("as it was");
    expect(String(thrown)).not.toContain(lease(1));
    // The new one is cleared away, the old one gets its name back and is started, as it was running before.
    expect(f.all).toEqual([`retain:${ID}`, "stop", `rename:${name}>${name}-replaced`, `mount:${ID}`, "mint", "run", `rm:${name}`, `rename:${name}-replaced>${name}`, "start", "revoke:test-only-hash-1"]);
    expect(f.stored.get(ID)).toBe(OLD_LEASE);
    expect(f.ledger).toEqual([]);
    // One that was not running is left stopped.
    const stopped = teammateHost({ status: "exited", failure: "run" });
    await expect(stopped.host.remakeTeam(ID, QUEST, REMADE)).rejects.toMatchObject({ status: 424 });
    expect(stopped.all).not.toContain("start");
  });

  test("its network can change with it, which nothing else can do to a microVM", async () => {
    const f = teammateHost({ status: "running" });
    await f.host.remakeTeam(ID, QUEST, { ...REMADE, network: "online" });
    const run = f.commands.find((args) => args[0] === "run")!;
    expect(run.filter((_, i) => run[i - 1] === "--network")).toEqual([NETWORKS.online.name, NETWORKS.gateway.name]);
    expect(run).toContain(`${LABEL}.network=online`);
  });

  test("made again, a VM can be given a desktop or have it taken away; unasked it keeps the image it has", async () => {
    const image = async (desktop?: boolean) => {
      const f = teammateHost({ status: "running" });
      await f.host.remakeTeam(ID, QUEST, { ...REMADE, ...(desktop === undefined ? {} : { desktop }) });
      return { run: f.commands.find((args) => args[0] === "run")!.at(-3), ledger: f.ledger.at(-1)!.detail };
    };
    expect(await image()).toMatchObject({ run: "galahad/sandbox:1" });
    expect(await image(true)).toEqual({ run: "galahad/desktop:1", ledger: expect.stringContaining("made again from galahad/desktop:1") });
    expect((await image(false)).run).toBe("galahad/sandbox:1");
  });

  test("a remake that was cut short is taken up again: the container that was set aside gets its name back first", async () => {
    const f = teammateHost({ status: "exited", setAside: true });
    const name = containerName(ID);
    await f.host.remakeTeam(ID, QUEST, REMADE);
    expect(f.all.slice(0, 2)).toEqual([`rename:${name}-replaced>${name}`, `retain:${ID}`]);
    expect(f.all.at(-2)).toBe(`rm:${name}-replaced`);
  });

  test.each(refusedResumes)("making again refuses $name before anything is touched", async ({ id, quest, labels, status }) => {
    const f = teammateHost({ labels });
    await expect(f.host.remakeTeam(id, quest, REMADE)).rejects.toMatchObject({ status });
    expect(f.all).toEqual([]);
    expect(f.stored.get(ID)).toBe(OLD_LEASE);
  });

  test("an old helper, or a disk whose place can't be told, refuses before anything is touched", async () => {
    const f = teammateHost({ legacyHelper: true });
    await expect(f.host.remakeTeam(ID, QUEST, REMADE)).rejects.toMatchObject({ status: 424 });
    expect(f.commands.some((args) => ["stop", "rename", "run", "rm"].includes(args[0]!))).toBe(false);
    expect(f.minted).toEqual([]);
  });

  test("a retained disk is not reaped when its container is missing", async () => {
    const removed: string[] = [];
    const workspaces: Workspaces = {
      available: async () => true,
      create: async () => "/unused",
      remove: async (id) => { removed.push(id); },
      stats: async () => ({ totalBytes: 100, freeBytes: 90, images: [
        { id: "0123456789", sizeBytes: 10, usedBytes: 1, mounted: false, createdAt: 0, retained: true },
        { id: "9876543210", sizeBytes: 10, usedBytes: 1, mounted: false, createdAt: 0 },
      ] }),
    };
    const host = new SandboxHost({ node: "test", maxCpus: 8, maxMemoryGb: 16, workspaces,
      tokens: { mint: () => ({ token: "fake", info: { hash: "fake" } }), revoke: () => true },
      ledger: () => {}, now: () => 3600000, runner: async () => ({ code: 0, stdout: "", stderr: "" }),
    });
    await host.reap();
    expect(removed).toEqual(["9876543210"]);
  });
});
