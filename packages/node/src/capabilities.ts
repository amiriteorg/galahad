import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import type { Presence } from "@galahad/core";
import { probeSandbox } from "@galahad/sandbox";

/*
 * What this body can do. Stable facts go into the node's profile in the mind
 * (re-published only when they change); live load travels with sync as presence.
 */

export interface Capabilities {
  os: string;
  arch: string;
  hostname: string;
  cores: number;
  cpu: string;
  memoryGb: number;
  hasBattery: boolean;
  gpu: { name: string; memoryGb: number | null }[];
  docker: boolean;
  vm: { kvm: boolean; tools: string[] };
  tools: string[];
  localModels: { runtime: string; models: string[] }[];
  tailscale: { ip: string | null; dnsName: string | null } | null;
  /** Present when this node can host sandboxes (Docker reachable). */
  sandbox?: { image: boolean; networks: boolean } | null;
}

const TOOLS = [
  "git", "gh", "docker", "podman", "incus", "virsh", "qemu-system-x86_64", "multipass", "nix",
  "ollama", "llama-server", "vllm", "mlx_lm.server",
  "opencode", "hermes", "claude", "codex", "cursor-agent", "t3", "sccache", "uv", "python3", "node", "bun",
];

async function run(cmd: string[], timeoutMs = 3000): Promise<string | null> {
  if (!Bun.which(cmd[0]!)) return null;
  try {
    const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore", stdin: "ignore" });
    const timer = setTimeout(() => proc.kill(), timeoutMs);
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    clearTimeout(timer);
    return code === 0 ? out.trim() : null;
  } catch {
    return null;
  }
}

async function gpus(): Promise<Capabilities["gpu"]> {
  const nvidia = await run(["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"]);
  if (nvidia) {
    return nvidia.split("\n").filter(Boolean).map((line) => {
      const [name, mem] = line.split(",").map((s) => s.trim());
      return { name: name ?? "nvidia", memoryGb: mem ? Math.round(Number(mem) / 1024) : null };
    });
  }
  if (process.platform === "darwin" && process.arch === "arm64") {
    return [{ name: "Apple Silicon (unified memory)", memoryGb: Math.round(os.totalmem() / 2 ** 30) }];
  }
  return [];
}

async function localModels(): Promise<Capabilities["localModels"]> {
  const out: Capabilities["localModels"] = [];
  const probes: [string, string][] = [
    ["ollama", "http://127.0.0.1:11434/v1/models"],
    ["llamacpp", "http://127.0.0.1:8080/v1/models"],
  ];
  await Promise.all(
    probes.map(async ([runtime, url]) => {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(800) });
        if (!response.ok) return;
        const json = (await response.json()) as { data?: { id: string }[] };
        out.push({ runtime, models: (json.data ?? []).map((m) => m.id).slice(0, 50) });
      } catch {
        /* runtime not running */
      }
    }),
  );
  return out;
}

export async function tailscaleInfo(): Promise<Capabilities["tailscale"]> {
  const raw = await run(["tailscale", "status", "--json", "--self", "--peers=false"]);
  if (!raw) return null;
  try {
    const status = JSON.parse(raw) as { Self?: { TailscaleIPs?: string[]; DNSName?: string } };
    const ip = status.Self?.TailscaleIPs?.find((a) => a.includes(".")) ?? null;
    return { ip, dnsName: status.Self?.DNSName?.replace(/\.$/, "") || null };
  } catch {
    return null;
  }
}

/**
 * A server: Linux and no battery. Windows and macOS machines are personal bodies that
 * sleep and travel, battery or not (Windows doesn't always report a laptop's battery).
 */
export const isAlwaysOn = (caps: Partial<Pick<Capabilities, "os" | "hasBattery">> | null | undefined): boolean =>
  caps?.os === "linux" && caps.hasBattery === false;

function hasBattery(): boolean {
  if (process.platform === "linux") {
    return ["BAT0", "BAT1"].some((b) => existsSync(`/sys/class/power_supply/${b}`));
  }
  return process.platform === "darwin" ? os.hostname().toLowerCase().includes("book") : false;
}

export async function probeCapabilities(): Promise<Capabilities> {
  const tools = TOOLS.filter((tool) => Bun.which(tool));
  const [gpu, models, docker, tailscale, windowsBattery, sandbox] = await Promise.all([
    gpus(),
    localModels(),
    tools.includes("docker") ? run(["docker", "info", "--format", "{{.ServerVersion}}"], 5000) : Promise.resolve(null),
    tailscaleInfo(),
    process.platform === "win32" ? batteryWindows() : Promise.resolve(null),
    tools.includes("docker") ? probeSandbox() : Promise.resolve(null),
  ]);
  const cpus = os.cpus();
  return {
    os: process.platform,
    arch: process.arch,
    hostname: os.hostname(),
    cores: cpus.length,
    cpu: cpus[0]?.model?.trim() ?? "unknown",
    memoryGb: Math.round(os.totalmem() / 2 ** 30),
    hasBattery: process.platform === "win32" ? windowsBattery !== null : hasBattery(),
    gpu,
    docker: !!docker,
    vm: {
      kvm: process.platform === "linux" && existsSync("/dev/kvm"),
      tools: tools.filter((t) => ["incus", "virsh", "qemu-system-x86_64", "multipass"].includes(t)),
    },
    tools,
    localModels: models,
    tailscale,
    sandbox,
  };
}

async function batteryWindows(): Promise<{ onBattery: boolean; percent: number } | null> {
  const out = await run(
    [
      "powershell",
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_Battery | Select-Object -First 1 BatteryStatus,EstimatedChargeRemaining | ConvertTo-Json -Compress",
    ],
    5000,
  );
  if (!out) return null;
  try {
    const b = JSON.parse(out) as { BatteryStatus?: number; EstimatedChargeRemaining?: number };
    return { onBattery: b.BatteryStatus === 1, percent: b.EstimatedChargeRemaining ?? 0 };
  } catch {
    return null;
  }
}

function batteryLinux(): { onBattery: boolean; percent: number } | null {
  for (const bat of ["BAT0", "BAT1"]) {
    const dir = `/sys/class/power_supply/${bat}`;
    if (!existsSync(dir)) continue;
    try {
      const status = readFileSync(`${dir}/status`, "utf8").trim();
      const percent = Number(readFileSync(`${dir}/capacity`, "utf8").trim());
      return { onBattery: status === "Discharging", percent };
    } catch {
      return null;
    }
  }
  return null;
}

let batteryCache: { at: number; value: { onBattery: boolean; percent: number } | null } | null = null;

export async function presence(): Promise<Presence> {
  if (!batteryCache || Date.now() - batteryCache.at > 60_000) {
    const value = process.platform === "win32" ? await batteryWindows() : process.platform === "linux" ? batteryLinux() : null;
    batteryCache = { at: Date.now(), value };
  }
  const cores = os.cpus().length;
  return {
    load: process.platform === "win32" ? 0 : (os.loadavg()[0] ?? 0),
    cores,
    freeMemoryGb: Math.round((os.freemem() / 2 ** 30) * 10) / 10,
    onBattery: batteryCache.value?.onBattery ?? null,
    batteryPercent: batteryCache.value?.percent ?? null,
  };
}
