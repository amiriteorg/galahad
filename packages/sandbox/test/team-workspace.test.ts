import { describe, expect, test } from "bun:test";
import { containerName, LABEL, SandboxHost, type LedgerEntryInput, type TokenMinter, type Workspaces } from "../src/index.ts";

const ID = "0123456789";
const QUEST = "arm.team.abcdef0123.builder";
const OLD_LEASE = "test-only-old-lease-hash";
const lease = (n: number) => `test-only-gateway-lease-${n}`;

/** Docker/helper stand-ins: no containers, mounts, host files, or real credentials. */
function teammateHost(opts: {
  status?: string;
  labels?: Record<string, string>;
  missing?: boolean;
  legacyHelper?: boolean;
  failure?: "mount" | "start" | "write" | "throw-write";
} = {}) {
  const commands: string[][] = [];
  const events: string[] = [];
  const ledger: LedgerEntryInput[] = [];
  const minted: Parameters<TokenMinter["mint"]>[0][] = [];
  const revoked: string[] = [];
  const stored = new Map([[ID, OLD_LEASE]]);
  const workspaces: Workspaces = {
    available: async () => true,
    create: async () => { throw new Error("resume must not create a workspace"); },
    retain: async (id) => { events.push(`retain:${id}`); },
    mount: async (id) => {
      events.push(`mount:${id}`);
      if (opts.failure === "mount") throw new Error("existing workspace is missing");
    },
    remove: async (id) => { events.push(`remove:${id}`); },
    removeRetained: async (id) => { events.push(`remove-owned:${id}`); },
    stats: async () => ({ totalBytes: 100, freeBytes: 90, images: [
      { id: ID, sizeBytes: 10, usedBytes: 1, mounted: false, createdAt: 0, retained: true },
    ] }),
  };
  if (opts.legacyHelper) { delete workspaces.mount; delete workspaces.retain; }
  const labels = {
    [LABEL]: "1", [`${LABEL}.id`]: ID, [`${LABEL}.node`]: "test", [`${LABEL}.quest`]: QUEST,
    [`${LABEL}.network`]: "gateway", [`${LABEL}.ephemeral`]: "false", [`${LABEL}.isolation`]: "vm",
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
        minted.push(scope); events.push("mint");
        return { token: lease(minted.length), info: { hash: `test-only-hash-${minted.length}` } };
      },
      revoke: (hash) => { revoked.push(hash); events.push(`revoke:${hash}`); return true; },
    },
    ledger: (entry) => { ledger.push(entry); },
    runner: async (args) => {
      commands.push(args);
      if (args[0] === "ps") return { code: 0, stdout: opts.missing ? "" : ID, stderr: "" };
      if (args[0] === "inspect") return { code: 0, stdout: JSON.stringify([
        { Config: { Labels: labels, Image: "galahad/sandbox:1" }, State: { Status: opts.status ?? "exited" } },
      ]), stderr: "" };
      if (args[0] === "start") {
        events.push("start");
        if (opts.failure === "start") return { code: 1, stdout: "", stderr: "failed to start" };
      }
      if (args[0] === "exec") {
        events.push("write");
        if (opts.failure === "throw-write") throw new Error(`transport failed with ${lease(1)}`);
        if (opts.failure === "write") return { code: 1, stdout: lease(1), stderr: lease(1) };
      }
      return { code: 0, stdout: "", stderr: "" };
    },
  });
  return { host, commands, events, ledger, minted, revoked, stored };
}

describe("persistent teammate workspaces", () => {
  test("resume remounts and starts the exact existing VM, then rotates a bounded scoped lease", async () => {
    const f = teammateHost();
    const resumed = await f.host.prepareTeam(ID, QUEST, { connector: "github", owner: "example", repo: "project" });
    expect(resumed).toMatchObject({ id: ID, quest: QUEST, status: "running", ephemeral: false, isolation: "vm" });
    expect(f.events).toEqual([`retain:${ID}`, `mount:${ID}`, "start", `revoke:${OLD_LEASE}`, "mint", "write"]);
    expect(f.commands.find((args) => args[0] === "start")).toEqual(["start", containerName(ID)]);
    expect(f.commands.some((args) => ["run", "create", "volume"].includes(args[0]!))).toBe(false);
    expect(f.minted).toEqual([{ label: `sandbox:${ID}`, providers: ["openai", "world", "git:github:example:project"], ttlMinutes: 30, maxRequests: 500 }]);
    const payload = f.commands.find((args) => args[0] === "exec")!.at(-1)!;
    const env = JSON.parse(Buffer.from(payload, "base64").toString());
    expect(env.OPENAI_API_KEY).toBe(lease(1));
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
