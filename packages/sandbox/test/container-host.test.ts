import { describe, expect, test } from "bun:test";
import { CONTAINER_CANNOT, ContainerVolumes, GATEWAY_KEEPER, LABEL, NETWORKS, SandboxError, SandboxHost, type CreateInput, type LedgerEntryInput, type SandboxHostOptions, type TokenMinter } from "../src/index.ts";
import { fakeContainer } from "./fake-container.ts";

/*
 * The sandbox host on a Mac, through Apple's `container` (a stand-in for it: fake-container.ts). The same host as on
 * Docker, its ledger lines, leases, workspaces and labels; what differs is the command line under it, and what a
 * Mac can't give, which is refused with the reason before anything is made.
 */

const GIB = 2 ** 30;
const ASK: CreateInput = { network: "gateway", cpus: 2, memoryGb: 4, ttlMinutes: 30, persistent: false, quest: "q-mac" };

function macHost(over: Partial<SandboxHostOptions> = {}, disk = { totalBytes: 1000 * GIB, freeBytes: 900 * GIB }) {
  const fake = fakeContainer();
  const ledger: LedgerEntryInput[] = [];
  const minted: Parameters<TokenMinter["mint"]>[0][] = [];
  const revoked: string[] = [];
  const host = new SandboxHost({
    node: "n_mac",
    engine: "container",
    runner: fake.runner,
    workspaces: new ContainerVolumes(fake.runner, () => disk),
    tokens: {
      mint: (scope) => {
        minted.push(scope);
        return { token: `test-only-token-${minted.length}`, info: { hash: `test-only-hash-${minted.length}` } };
      },
      revoke: (hash) => {
        revoked.push(hash);
        return true;
      },
    },
    ledger: (entry) => void ledger.push(entry),
    maxCpus: 8,
    maxMemoryGb: 16,
    microVMs: true,
    ...over,
  });
  return { host, fake, ledger, minted, revoked };
}

const commands = (calls: string[][], name: string) => calls.filter((c) => c[0] === name);

describe("a sandbox on a Mac", () => {
  test("is made as its own VM: its volume of a fixed size first, the gateway network once, then the VM, and the ledger says so", async () => {
    const m = macHost();
    const made = await m.host.create(ASK);
    const volume = `galahad-sbx-${made.id}-work`;
    expect(commands(m.fake.calls, "volume").find((c) => c[1] === "create")).toEqual(["volume", "create", "-s", "20G", "--label", "dev.galahad=1", "--label", `dev.galahad.id=${made.id}`, volume]);
    expect(commands(m.fake.calls, "network").filter((c) => c[1] === "create")).toEqual([["network", "create", "--internal", "--subnet", NETWORKS.gateway.subnet, "--label", "dev.galahad=1", NETWORKS.gateway.name]]);
    const vm = m.fake.vms.get(`galahad-sbx-${made.id}`)!;
    expect(vm.volume).toBe(volume);
    expect(vm.args).toContain("--read-only");
    expect(vm.networks).toEqual([NETWORKS.gateway.name]);
    expect(made).toMatchObject({ node: "n_mac", network: "gateway", isolation: "vm", status: "running", cpus: 2, memoryGb: 4, image: "galahad/sandbox:1", ephemeral: true, quest: "q-mac", disk: { limitGb: 20 } });
    expect(m.ledger).toContainEqual(expect.objectContaining({ class: "create", resource: "docker.container", target: `galahad-sbx-${made.id}`, verdict: "allow", quest: "q-mac", detail: "microVM · gateway · 2 cpu · 4 GB · 20 GB disk · galahad/sandbox:1" }));
    // A second sandbox finds the network there.
    await m.host.create(ASK);
    expect(commands(m.fake.calls, "network").filter((c) => c[1] === "create")).toHaveLength(1);
  });

  test("online joins container's default network and the gateway's, egress first", async () => {
    const m = macHost();
    const made = await m.host.create({ ...ASK, network: "online" });
    expect(m.fake.vms.get(`galahad-sbx-${made.id}`)!.networks).toEqual(["default", NETWORKS.gateway.name]);
  });

  test("an isolated sandbox is refused with the reason, and nothing is made", async () => {
    const m = macHost();
    const refused = await m.host.create({ ...ASK, network: "isolated" }).catch((error: SandboxError) => error);
    expect(refused).toBeInstanceOf(SandboxError);
    expect((refused as SandboxError).message).toBe(CONTAINER_CANNOT.isolated);
    expect((refused as SandboxError).status).toBe(424);
    expect(m.fake.calls.filter((c) => ["run", "volume", "network"].includes(c[0]!) && c[1] !== "inspect" && c[1] !== "list")).toEqual([]);
    expect(m.minted).toEqual([]);
  });

  test("the desktop, the Lab and Gazebo are refused with their reasons, nothing made", async () => {
    const m = macHost();
    for (const [ask, why] of [[{ desktop: true }, CONTAINER_CANNOT.desktop], [{ lab: true }, CONTAINER_CANNOT.lab], [{ gazebo: true }, CONTAINER_CANNOT.gazebo]] as const) {
      await expect(m.host.create({ ...ASK, ...ask })).rejects.toThrow(why);
    }
    expect(commands(m.fake.calls, "run")).toEqual([]);
    expect(commands(m.fake.calls, "build")).toEqual([]);
  });

  test("every sandbox here is a VM: one asked for as a container gets a VM, never less", async () => {
    const m = macHost();
    const made = await m.host.create({ ...ASK, isolation: "container" });
    expect(made.isolation).toBe("vm");
    expect(m.fake.vms.get(`galahad-sbx-${made.id}`)!.labels[`${LABEL}.isolation`]).toBe("vm");
    expect(m.host.isolationFor("gateway", "container")).toBe("vm");
    expect(m.host.isolationFor("online", undefined)).toBe("vm");
    expect(m.host.kinds).toEqual(["vm"]);
    expect(m.host.strictest).toBe("gateway");
    expect(m.host.growsLive).toBe(false);
  });

  test("a command runs in it as uid 1000 under its deadline, and the ledger says what ran", async () => {
    const m = macHost();
    const made = await m.host.create(ASK);
    m.fake.onExec = () => ({ code: 0, stdout: "hello\n" });
    const ran = await m.host.exec(made.id, ["echo", "hello"], 30);
    expect(ran).toMatchObject({ exitCode: 0, stdout: "hello\n" });
    expect(m.fake.execs.at(-1)).toEqual({ name: `galahad-sbx-${made.id}`, user: "1000:1000", cmd: ["echo", "hello"] });
    expect(m.ledger.at(-1)).toMatchObject({ class: "modify", resource: "sandbox.exec", target: `galahad-sbx-${made.id}`, detail: "echo hello → exit 0" });
  });

  test("its model access is a scoped lease in its environment, revoked when it is removed", async () => {
    const m = macHost();
    const made = await m.host.create({ ...ASK, providers: ["deepseek"] });
    expect(m.minted).toEqual([{ label: `sandbox:${made.id}`, providers: ["deepseek"], ttlMinutes: 30, maxRequests: 100_000 }]);
    const args = m.fake.vms.get(`galahad-sbx-${made.id}`)!.args;
    expect(args).toContain("GALAHAD_TOKEN=test-only-token-1");
    expect(args).toContain(`OPENAI_BASE_URL=http://${NETWORKS.gateway.gateway}:7779/gw/deepseek`);
    await m.host.destroy(made.id, { quest: "q-mac" });
    expect(m.revoked).toEqual(["test-only-hash-1"]);
  });

  test("it is listed from container's own list: only this node's sandboxes, read as Docker's are", async () => {
    const m = macHost();
    const made = await m.host.create(ASK);
    // Another node's sandbox on the same Mac, and container's own builder: neither is this node's.
    await m.fake.runner(["run", "--detach", "--name", "galahad-sbx-ffffffffff", "--cpus", "1", "--memory", "1024M", "--label", "dev.galahad=1", "--label", "dev.galahad.id=ffffffffff", "--label", "dev.galahad.node=n_other", "galahad/sandbox:1", "sleep", "infinity"], 1000);
    await m.fake.runner(["run", "--detach", "--name", "buildkit", "--cpus", "2", "--memory", "2048M", "builder", "sleep", "infinity"], 1000);
    expect((await m.host.list()).map((s) => s.id)).toEqual([made.id]);
    m.fake.vms.get(`galahad-sbx-${made.id}`)!.state = "stopped";
    expect((await m.host.get(made.id))?.status).toBe("exited");
    // A list that fails is never read as "none".
    m.fake.service = false;
    expect(await m.host.listed()).toBeNull();
  });

  test("removed through the oath gate: its own quest removes it, the VM then its volume; anyone else is asked", async () => {
    const m = macHost();
    const made = await m.host.create(ASK);
    const asked = await m.host.destroy(made.id, { quest: "another-quest" });
    expect(asked.verdict).toBe("ask");
    expect(m.fake.vms.has(`galahad-sbx-${made.id}`)).toBe(true);
    const removed = await m.host.destroy(made.id, { quest: "q-mac" });
    expect(removed.verdict).toBe("allow");
    const order = m.fake.calls.filter((c) => (c[0] === "delete" || (c[0] === "volume" && c[1] === "delete")));
    expect(order).toEqual([["delete", "--force", `galahad-sbx-${made.id}`], ["volume", "delete", `galahad-sbx-${made.id}-work`]]);
    // (The gateway's keeper stays: it is no sandbox.)
    expect([...m.fake.vms.keys()]).toEqual([GATEWAY_KEEPER]);
    expect(m.fake.volumes.size).toBe(0);
    expect(m.ledger.at(-1)).toMatchObject({ class: "delete", resource: "docker.container", verdict: "allow", quest: "q-mac" });
  });

  test("one that won't start leaves nothing behind: its VM, its volume and its lease go, and the error says why", async () => {
    const m = macHost();
    // (Its own start fails; the one-off that hands its volume on has gone through.)
    m.fake.failRun = (args) => (args.includes("--rm") ? null : "Error: failed to boot the VM (test-only-token-1)");
    await expect(m.host.create({ ...ASK, providers: ["deepseek"] })).rejects.toThrow(/could not start sandbox: Error: failed to boot the VM/);
    expect(m.fake.vms.size).toBe(0);
    expect(m.fake.volumes.size).toBe(0);
    expect(m.revoked).toEqual(["test-only-hash-1"]);
  });

  test("its workspace has to fit the disk, as on Linux: a workspace that doesn't is refused before anything is made", async () => {
    const m = macHost({}, { totalBytes: 1000 * GIB, freeBytes: 110 * GIB });
    await expect(m.host.create({ ...ASK, diskGb: 40 })).rejects.toThrow(/a 40 GB workspace doesn't fit/);
    expect(commands(m.fake.calls, "run")).toEqual([]);
  });

  test("its service down, this Mac hosts nothing: refused with what to do", async () => {
    const m = macHost();
    m.fake.service = false;
    expect(await m.host.available()).toBe(false);
    await expect(m.host.create(ASK)).rejects.toThrow(/container system start/);
    // Nor a container whose command line this driver doesn't speak.
    m.fake.service = true;
    m.fake.version = "2.0.0";
    expect(await m.host.available()).toBe(false);
  });

  test("its images are built for Apple silicon, and no keeper holds them (nothing prunes them on a Mac)", async () => {
    const m = macHost();
    const built = await m.host.build("/opt/galahad/sandbox");
    expect(built.ok).toBe(true);
    expect(commands(m.fake.calls, "build")).toEqual([["build", "--pull", "--platform", "linux/arm64", "--tag", "galahad/sandbox:1", "/opt/galahad/sandbox"]]);
    expect(await m.host.keepImage()).toBe(false);
    expect(commands(m.fake.calls, "create")).toEqual([]);
  });

  test("status: its image, the gateway network, and container's own default network", async () => {
    const m = macHost();
    expect(await m.host.status()).toEqual({ docker: true, image: true, networks: { gateway: false, online: true } });
    await m.host.ensureNetworks();
    expect((await m.host.status()).networks.gateway).toBe(true);
  });

  test("the reaper removes an expired sandbox, and a volume whose VM is gone; a knight's volume stays", async () => {
    let now = 1_000_000;
    const m = macHost({ now: () => now });
    const made = await m.host.create(ASK);
    // A knight's workspace whose VM was lost, and an ordinary one: both from long ago.
    await m.fake.runner(["volume", "create", "-s", "20G", "--label", "dev.galahad=1", "--label", "dev.galahad.id=aaaaaaaaaa", "--label", "dev.galahad.retained=1", "galahad-sbx-aaaaaaaaaa-work"], 1000);
    await m.fake.runner(["volume", "create", "-s", "20G", "--label", "dev.galahad=1", "--label", "dev.galahad.id=bbbbbbbbbb", "galahad-sbx-bbbbbbbbbb-work"], 1000);
    now = Date.parse("2026-11-17T00:00:00Z") + 31 * 60_000;
    const reaped = await m.host.reap();
    expect(reaped).toContain(`galahad-sbx-${made.id}`);
    expect(reaped).toContain("workspace bbbbbbbbbb");
    expect([...m.fake.volumes.keys()]).toEqual(["galahad-sbx-aaaaaaaaaa-work"]);
  });
});

describe("its workspaces: container's volumes", () => {
  test("a volume of a fixed size, labelled as its sandbox's; a knight's is kept, and only its owner's removal takes it", async () => {
    const fake = fakeContainer();
    const volumes = new ContainerVolumes(fake.runner, () => ({ totalBytes: 100 * GIB, freeBytes: 60 * GIB }));
    expect(await volumes.create("0123456789", 20)).toBe("galahad-sbx-0123456789-work");
    expect(await volumes.create("abcdefabcd", 30, { retain: true })).toBe("galahad-sbx-abcdefabcd-work");
    expect(fake.volumes.get("galahad-sbx-abcdefabcd-work")!.labels["dev.galahad.retained"]).toBe("1");
    const stats = await volumes.stats();
    expect(stats).toMatchObject({ totalBytes: 100 * GIB, freeBytes: 60 * GIB });
    expect(stats.images.map((i) => [i.id, i.sizeBytes, i.retained])).toEqual([["0123456789", 20 * GIB, false], ["abcdefabcd", 30 * GIB, true]]);
    await volumes.retain("abcdefabcd");
    await expect(volumes.retain("0123456789")).rejects.toThrow(/labels can't be changed/);
    await expect(volumes.remove("abcdefabcd")).rejects.toThrow(/kept/);
    await volumes.removeRetained("abcdefabcd");
    await volumes.remove("0123456789");
    expect(fake.volumes.size).toBe(0);
    // Mounting is container's own: the VM that names a volume has it.
    await volumes.mount("0123456789");
    await expect(volumes.create("not-an-id", 20)).rejects.toThrow(/bad workspace request/);
  });

  test("a new volume's root is handed to the sandbox's user by a one-off container of the node's own, as root: container leaves it root's", async () => {
    const fake = fakeContainer();
    const volumes = new ContainerVolumes(fake.runner, () => ({ totalBytes: 100 * GIB, freeBytes: 60 * GIB }));
    await volumes.create("0123456789", 20);
    expect(fake.oneOffs).toEqual([["run", "--rm", "--user", "0:0", "--entrypoint", "chown", "--network", NETWORKS.gateway.name, "--no-dns", "--mount", "type=volume,source=galahad-sbx-0123456789-work,target=/work", "galahad/sandbox:1", "1000:1000", "/work"]]);
    expect(fake.volumes.get("galahad-sbx-0123456789-work")!.owner).toBe("1000:1000");
  });

  test("a volume that can't be handed on isn't kept: it is removed, and the workspace fails saying why", async () => {
    const fake = fakeContainer();
    fake.failRun = (args) => (args.includes("--rm") ? "Error: the init image is missing" : null);
    const volumes = new ContainerVolumes(fake.runner, () => ({ totalBytes: 100 * GIB, freeBytes: 60 * GIB }));
    await expect(volumes.create("0123456789", 20)).rejects.toThrow(/couldn't give the workspace to the sandbox's user: Error: the init image is missing/);
    expect(fake.volumes.size).toBe(0);
  });
});

describe("the gateway's address on a Mac", () => {
  test("is held by one small VM of the node's own on the gateway network, hardened as a sandbox, made as the networks are", async () => {
    const m = macHost();
    await m.host.ensureNetworks();
    const keeper = m.fake.vms.get(GATEWAY_KEEPER)!;
    expect(keeper.state).toBe("running");
    expect(keeper.args).toEqual(["run", "-d", "--name", GATEWAY_KEEPER, "--label", `${LABEL}.keeper=gateway`, "--cpus", "1", "--memory", "256M", "--network", NETWORKS.gateway.name, "--no-dns", "--read-only", "--cap-drop", "ALL", "--user", "1000:1000", "galahad/sandbox:1", "sleep", "infinity"]);
    // Running: nothing more. Stopped: started again, never made twice.
    await m.host.ensureNetworks();
    expect([...m.fake.calls].filter((c) => c[0] === "run").length).toBe(1);
    keeper.state = "stopped";
    await m.host.ensureNetworks();
    expect(m.fake.vms.get(GATEWAY_KEEPER)!.state).toBe("running");
    expect([...m.fake.calls].filter((c) => c[0] === "run").length).toBe(1);
  });

  test("isn't a sandbox: never listed or reaped as one", async () => {
    const m = macHost();
    await m.host.ensureNetworks();
    expect(await m.host.list()).toEqual([]);
    await m.host.reap();
    expect(m.fake.vms.has(GATEWAY_KEEPER)).toBe(true);
  });

  test("is never made from an image this Mac hasn't got: it would be pulled from wherever that name leads", async () => {
    const m = macHost();
    m.fake.images.clear();
    await m.host.ensureNetworks();
    expect(m.fake.vms.has(GATEWAY_KEEPER)).toBe(false);
    expect(m.fake.calls.some((c) => c[0] === "run")).toBe(false);
  });
});
