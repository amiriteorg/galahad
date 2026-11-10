import { describe, expect, test } from "bun:test";
import { SandboxRequest } from "@galahad/core";
import { execArgs, gatewayEnv, NETWORKS, networkCreateArgs, runArgs, type SandboxSpec } from "../src/index.ts";

const base: SandboxSpec = {
  id: "0123456789",
  quest: "q1",
  node: "n_test",
  image: "galahad/sandbox:1",
  network: "gateway",
  cpus: 4,
  memoryGb: 8,
  pidsLimit: 1024,
  ttlMinutes: 120,
  ephemeral: true,
  providers: [],
  createdAt: 1_000,
  env: {},
};

const pair = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

describe("sandbox hardening", () => {
  const args = runArgs(base);

  test("runs unprivileged with every capability dropped and no privilege escalation", () => {
    expect(pair(args, "--user")).toBe("1000:1000");
    expect(pair(args, "--cap-drop")).toBe("ALL");
    expect(pair(args, "--security-opt")).toBe("no-new-privileges:true");
    expect(args).toContain("--read-only");
    expect(args).not.toContain("--privileged");
    expect(args.join(" ")).not.toContain("docker.sock");
    expect(args.join(" ")).not.toMatch(/type=bind|--volume|-v /);
  });

  test("a size-limited workspace is the one host path it sees, mounted at /work", () => {
    const limited = runArgs({ ...base, workspace: "/var/lib/galahad-workspaces/0123456789", diskGb: 20 });
    const mounts = limited.filter((_, i) => limited[i - 1] === "--mount" || limited[i - 1] === "--volume" || limited[i - 1] === "-v");
    expect(mounts).toEqual(["type=bind,src=/var/lib/galahad-workspaces/0123456789,dst=/work"]);
    expect(limited).toContain("dev.galahad.disk=20");
    // Without one, /work is a Docker volume, and the label says it has no limit.
    expect(args.filter((_, i) => args[i - 1] === "--mount")).toEqual(["type=volume,src=galahad-sbx-0123456789-work,dst=/work"]);
    expect(args).toContain("dev.galahad.disk=none");
  });

  test("is resource-bounded", () => {
    expect(pair(args, "--cpus")).toBe("4");
    expect(pair(args, "--memory")).toBe("8192m");
    expect(pair(args, "--memory-swap")).toBe("8192m");
    expect(pair(args, "--pids-limit")).toBe("1024");
  });

  test("network modes map to none / internal gateway net / egress net", () => {
    expect(pair(runArgs({ ...base, network: "isolated" }), "--network")).toBe("none");
    expect(pair(runArgs({ ...base, network: "gateway" }), "--network")).toBe(NETWORKS.gateway.name);
    expect(pair(runArgs({ ...base, network: "online" }), "--network")).toBe(NETWORKS.online.name);
  });

  test("is labelled for ownership, quest, expiry and ephemerality", () => {
    const labels = args.filter((_, i) => args[i - 1] === "--label");
    expect(labels).toContain("dev.galahad=1");
    expect(labels).toContain("dev.galahad.quest=q1");
    expect(labels).toContain("dev.galahad.ephemeral=true");
    expect(labels).toContain(`dev.galahad.expires=${1_000 + 120 * 60_000}`);
  });

  test("the gateway network is internal and sandboxes cannot talk to each other", () => {
    const gw = networkCreateArgs("gateway");
    expect(gw).toContain("--internal");
    expect(gw).toContain("com.docker.network.bridge.enable_icc=false");
    expect(networkCreateArgs("online")).not.toContain("--internal");
    expect(networkCreateArgs("online")).toContain("com.docker.network.bridge.enable_icc=false");
  });

  test("tools get a scoped gateway token, never a provider key", () => {
    const env = gatewayEnv("gw_scoped", ["deepseek", "anthropic"]);
    expect(env.OPENAI_BASE_URL).toBe(`http://${NETWORKS.gateway.gateway}:7779/gw/deepseek`);
    expect(env.ANTHROPIC_BASE_URL).toBe(`http://${NETWORKS.gateway.gateway}:7779/gw/anthropic`);
    expect(Object.values(env).every((v) => !v.startsWith("sk-"))).toBe(true);
  });

  test("commands run under an in-container deadline", () => {
    expect(execArgs("0123456789", ["bun", "test"], 30)).toEqual([
      "exec",
      "--interactive",
      "--workdir",
      "/work",
      "galahad-sbx-0123456789",
      "timeout",
      "--signal=KILL",
      "30s",
      "bun",
      "test",
    ]);
  });

  test("requests default to the safe gateway mode, ephemeral, bounded TTL", () => {
    const parsed = SandboxRequest.parse({});
    expect(parsed).toMatchObject({ network: "gateway", persistent: false, ttlMinutes: 120, cpus: 4, memoryGb: 8 });
    expect(() => SandboxRequest.parse({ image: "Evil Image; rm -rf /" })).toThrow();
  });
});
