import { afterAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { randomId } from "@galahad/core";
import { type LedgerEntryInput, SandboxHost, WORKSPACE_SOCKET, WorkspaceHelper } from "../src/index.ts";

/*
 * Real Docker, real containers. Opt-in (GALAHAD_DOCKER_TESTS=1) and meant for a
 * sandbox host such as ultra, after `galahad sandbox build` has built the image.
 */
const enabled = process.env.GALAHAD_DOCKER_TESTS === "1";

describe.if(enabled)("sandbox host on real Docker", () => {
  const node = `n_it_${randomId(6)}`;
  const revoked: string[] = [];
  const ledger: LedgerEntryInput[] = [];
  const tokens = {
    mint: () => ({ token: `gw_${randomId(32)}`, info: { hash: randomId(16) } }),
    revoke: (hash: string) => (revoked.push(hash), true),
  };
  const host = new SandboxHost({ node, tokens, ledger: (e) => ledger.push(e), maxCpus: 4, maxMemoryGb: 4 });
  const base = { cpus: 1, memoryGb: 1, ttlMinutes: 5, persistent: false } as const;

  afterAll(async () => {
    for (const s of await host.list()) await host.destroy(s.id, { approvedBy: "test-cleanup" });
  });

  test("runs as uid 1000 with zero capabilities, a read-only root and a writable workspace", async () => {
    const sb = await host.create({ ...base, network: "isolated", quest: "it-1" });
    expect((await host.exec(sb.id, ["id", "-u"])).stdout.trim()).toBe("1000");
    expect((await host.exec(sb.id, ["sh", "-c", "grep CapEff /proc/self/status"])).stdout).toContain("0000000000000000");
    expect((await host.exec(sb.id, ["sh", "-c", "touch /etc/pwned"])).exitCode).not.toBe(0);
    expect((await host.exec(sb.id, ["sh", "-c", "echo ok > /work/f && cat /work/f"])).stdout.trim()).toBe("ok");
    expect((await host.exec(sb.id, ["sh", "-c", "curl -s -m 3 https://1.1.1.1 >/dev/null"])).exitCode).not.toBe(0);
    expect((await host.exec(sb.id, ["sleep", "30"], 1)).exitCode).toBe(137);
    expect((await host.destroy(sb.id, { quest: "it-1" })).verdict).toBe("allow");
    expect(await host.get(sb.id)).toBeNull();
  }, 120_000);

  test("gateway mode has no internet; online mode does", async () => {
    const gw = await host.create({ ...base, network: "gateway", quest: "it-2", providers: ["deepseek"] });
    const env = (await host.exec(gw.id, ["sh", "-c", "echo $OPENAI_BASE_URL; echo ${OPENAI_API_KEY%%_*}"])).stdout.split("\n");
    expect(env[0]).toBe("http://172.31.250.1:7779/gw/deepseek");
    expect(env[1]).toBe("gw"); // a scoped gateway token, never a provider key
    expect((await host.exec(gw.id, ["sh", "-c", "curl -s -m 4 https://example.com >/dev/null"])).exitCode).not.toBe(0);
    const online = await host.create({ ...base, network: "online", quest: "it-2" });
    expect((await host.exec(online.id, ["sh", "-c", "curl -s -m 10 -o /dev/null -w '%{http_code}' https://example.com"])).stdout).toBe("200");
    await host.destroy(gw.id, { quest: "it-2" });
    expect(revoked.length).toBeGreaterThan(0); // its token died with it
    await host.destroy(online.id, { quest: "it-2" });
  }, 180_000);

  test("sandboxes cannot reach each other", async () => {
    const a = await host.create({ ...base, network: "online", quest: "it-3" });
    const b = await host.create({ ...base, network: "online", quest: "it-3" });
    const ipB = (await host.exec(b.id, ["sh", "-c", "hostname -I | awk '{print $1}'"])).stdout.trim();
    await host.exec(b.id, ["sh", "-c", "nohup python3 -m http.server 8000 >/dev/null 2>&1 &"]);
    expect((await host.exec(a.id, ["sh", "-c", `curl -s -m 3 http://${ipB}:8000/ >/dev/null`])).exitCode).not.toBe(0);
    await host.destroy(a.id, { quest: "it-3" });
    await host.destroy(b.id, { quest: "it-3" });
  }, 120_000);

  test("destroying a persistent sandbox asks; your approval goes through", async () => {
    const keep = await host.create({ ...base, network: "isolated", persistent: true, quest: "it-4" });
    expect((await host.destroy(keep.id, { quest: "it-4" })).verdict).toBe("ask");
    expect(ledger.at(-1)?.verdict).toBe("ask");
    expect((await host.destroy(keep.id, { approvedBy: "owner" })).verdict).toBe("allow");
    expect(ledger.at(-1)?.verdict).toBe("approved");
  }, 120_000);

  test("the reaper removes expired ephemeral sandboxes, and only those", async () => {
    const short = await host.create({ ...base, network: "isolated", ttlMinutes: 1, quest: "it-5" });
    const kept = await host.create({ ...base, network: "isolated", persistent: true, quest: "it-5" });
    const later = new SandboxHost({ node, tokens, ledger: () => {}, maxCpus: 4, maxMemoryGb: 4, now: () => Date.now() + 3_600_000 });
    const reaped = await later.reap();
    expect(reaped).toContain(short.name);
    expect(reaped).not.toContain(kept.name);
    expect(await host.get(short.id)).toBeNull();
    expect(await host.get(kept.id)).not.toBeNull();
  }, 120_000);
});

/* With the workspace helper installed (deploy --sudo): every workspace is its own fixed-size disk. */
describe.if(enabled && existsSync(WORKSPACE_SOCKET))("size-limited workspaces on real Docker", () => {
  const node = `n_it_${randomId(6)}`;
  const tokens = { mint: () => ({ token: `gw_${randomId(32)}`, info: { hash: randomId(16) } }), revoke: () => true };
  const workspaces = new WorkspaceHelper();
  const host = new SandboxHost({ node, tokens, ledger: () => {}, maxCpus: 4, maxMemoryGb: 4, maxDiskGb: 4096, workspaces });
  const base = { cpus: 1, memoryGb: 1, ttlMinutes: 5, persistent: false, network: "isolated" } as const;

  afterAll(async () => {
    for (const s of await host.list()) await host.destroy(s.id, { approvedBy: "test-cleanup" });
  });

  test("a squire fills its own workspace and stops there; the host's disk is untouched", async () => {
    const sb = await host.create({ ...base, quest: "it-disk", diskGb: 1 });
    expect(sb.disk).toMatchObject({ limitGb: 1 });
    const size = Number((await host.exec(sb.id, ["sh", "-c", "df -k /work | tail -1 | awk '{print $2}'"])).stdout.trim());
    expect(size).toBeGreaterThan(900 * 1024);
    expect(size).toBeLessThan(1100 * 1024);
    const fill = await host.exec(sb.id, ["sh", "-c", "dd if=/dev/zero of=/work/fill bs=1M count=3000 2>&1; echo done"]);
    expect(fill.stdout).toMatch(/No space left on device/);
    expect((await host.get(sb.id))!.disk!.usedGb).toBeGreaterThan(0.8);
    // It's still the squire's own, writable workspace, owned by the squire.
    expect((await host.exec(sb.id, ["sh", "-c", "rm /work/fill && echo ok > /work/f && stat -c %u /work/f"])).stdout.trim()).toBe("1000");
    await host.destroy(sb.id, { quest: "it-disk" });
    expect((await workspaces.stats()).images.some((i) => i.id === sb.id)).toBe(false);
  }, 180_000);

  test("a workspace that doesn't fit the disk's budget is refused before anything is made", async () => {
    const before = (await workspaces.stats()).images.length;
    await expect(host.create({ ...base, quest: "it-disk", diskGb: 4096 })).rejects.toThrow(/doesn't fit/);
    expect((await workspaces.stats()).images.length).toBe(before);
  }, 60_000);

  test("the image stays in use (a stopped keeper container), so `docker image prune -a` leaves it alone", async () => {
    expect(await host.keepImage()).toBe(true);
    const inspect = (args: string[]) => new TextDecoder().decode(Bun.spawnSync(["docker", ...args]).stdout).trim();
    const image = inspect(["image", "inspect", "galahad/sandbox:1", "--format", "{{.Id}}"]);
    expect(inspect(["container", "inspect", "galahad-sandbox-image", "--format", "{{.Image}} {{.State.Status}}"])).toBe(`${image} created`);
  }, 60_000);
});

