import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bodyFingerprint, ceilingThreads, KERNEL, REFERENCE_SINGLE, routes, teamArmLabel, type RouteName, type SandboxView, type TeamSnapshot, type TeamTask } from "@galahad/core";
import { foundFleet, MindStore } from "@galahad/mind";
import { startDaemon, type Daemon } from "../src/daemon.ts";
import { Home } from "../src/home.ts";
import type { Capabilities } from "../src/capabilities.ts";
import { fakeDocker } from "./fake-docker.ts";

// Real HTTP/controller/host/quest code, with stand-ins only for Docker and models.
const root = mkdtempSync(join(tmpdir(), "galahad-team-vm-"));
const home = new Home(join(root, "node"));
const freePort = () => { const s = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() }); const p = s.port!; s.stop(true); return p; };
const port = freePort();
const caps: Capabilities = { os: "linux", arch: "x64", hostname: "team-vm-test", cores: 16, cpu: "test", memoryGb: 32, hasBattery: false, gpu: [], docker: true, vm: { kvm: true, tools: ["kata"] }, tools: ["docker"], localModels: [], tailscale: null, sandbox: { image: true, networks: true, vm: true } };
const docker = fakeDocker();
const runs: string[][] = [];
const events: { kind: "cleanup" | "lease" | "exec" | "model"; target: string; text: string }[] = [];
const active = new Map<string, number>();
const peak = new Map<string, number>();
const prompts: { model: string; messages: { role: string; content: string }[] }[] = [];
let daemon: Daemon;
let alphaEntered = false;
let releaseAlpha: (() => void) | undefined;
let alphaHold: Promise<void> | undefined;
let cleanupFailure = false;
function worldWorker(id: string) {
  const hello = daemon.world.hello();
  if (hello.type !== "hello") throw new Error("Expected world hello");
  return hello.partners?.find((partner) => partner.id === teamArmLabel(daemon.identity.id, id));
}
const summaries: Record<string, string> = { ALPHA: "Verified predecessor contract: packet-v1.", BETA: "Verified independent follow-up.", GAMMA: "Verified consumer of packet-v1." };
const model = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: async (request) => {
  const body = await request.json() as (typeof prompts)[number];
  prompts.push(body);
  const turns = body.messages.filter((message) => message.role !== "system");
  const task = /TASK_(ALPHA|BETA|GAMMA|CLEANUP)/.exec(turns[0]?.content ?? "")?.[1] ?? "UNKNOWN";
  events.push({ kind: "model", target: task, text: body.model });
  let text = "1. Make the change.\n2. Run the required gate.\nDone when: the gate and independent review pass.";
  if (body.model === "engineer") {
    text = turns.some((message) => message.role === "assistant")
      ? `DONE\n${summaries[task] ?? "Unexpected task."}`
      : `\`\`\`sh\nprintf '%s' ${task} > result.txt # write-${task.toLowerCase()}\n\`\`\``;
  } else if (body.model === "reviewer") text = "PASS\nThe required gate passed and execution evidence supports the result.";
  return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
} });

async function api<T = any>(name: RouteName, input?: unknown): Promise<T> {
  const route = routes[name];
  const response = await fetch(`http://127.0.0.1:${port}${route.path}`, { method: route.method,
    headers: { authorization: `Bearer ${home.adminToken()}`, "content-type": "application/json" },
    body: route.method === "POST" ? JSON.stringify(input ?? {}) : undefined,
  });
  const body = await response.json() as { error?: string; status?: number };
  if (!response.ok || body.error) throw new Error(`${name}: ${response.status} ${body.error ?? "request failed"}`);
  return body as T;
}
async function until(condition: () => boolean | Promise<boolean>) {
  const end = Date.now() + 8000;
  while (Date.now() < end) { if (await condition()) return; await Bun.sleep(5); }
  const state = await api<TeamSnapshot>("team");
  throw new Error(`team VM condition was not reached: ${JSON.stringify(state.tasks.map(({ title, status, error }) => ({ title, status, error })))}`);
}
const snapshot = () => api<TeamSnapshot>("team");
const task = async (id: string) => (await snapshot()).tasks.find((item) => item.id === id)!;
const create = (assignee: string, tag: string, dependsOn: string[] = []) => api<{ task: TeamTask }>("createTeamTask", {
  room: "vm-forge", assignee, title: tag, goal: `TASK_${tag}: Build and verify this bounded change.`, dependsOn, gates: [`test -f result.txt # gate-${tag.toLowerCase()}`],
});
const start = () => startDaemon(home, { capabilities: caps, proxyPort: freePort(), log: () => {},
  docker: (args, timeout) => { if (args[0] === "run") runs.push(args); return docker.runner(args, timeout); },
  measure: async (reason, body, limit) => {
    const threads = ceilingThreads(body, limit);
    return { at: Date.now(), tookMs: 1, reason, body: bodyFingerprint(body, limit), cpu: { single: REFERENCE_SINGLE, multi: REFERENCE_SINGLE * threads, threads, kernel: KERNEL } };
  },
  shutdownGraceMs: 100, defaultHeartbeat: false, archiveIntervalMs: false,
});

beforeAll(async () => {
  const { identity, keystore } = await home.createIdentity("file");
  const mind = new MindStore(home.mindPath);
  const fleet = foundFleet(mind, identity, { fleetName: "team-vms", nodeName: "keep" }); mind.close();
  home.writeConfig({ v: 1, name: "keep", fleet, port, keystore, advertise: "127.0.0.1" });
  docker.onExec = async (container, command) => {
    const text = command.join("\n");
    const kind = text.includes("def cleanup(") ? "cleanup" : text.includes("tempfile.mkstemp") ? "lease" : "exec";
    events.push({ kind, target: container, text });
    const count = (active.get(container) ?? 0) + 1;
    active.set(container, count); peak.set(container, Math.max(peak.get(container) ?? 0, count));
    try {
      if (kind === "cleanup" && cleanupFailure) return { code: 137, stdout: "", stderr: "cleanup deadline expired" };
      if (text.includes("write-alpha")) { alphaEntered = true; await alphaHold; }
      return { code: 0, stdout: text.includes("gate-") ? "required gate passed" : "command completed" };
    } finally { active.set(container, count - 1); }
  };
  daemon = await start();
  await until(() => daemon.store.lww(`calibration:${daemon.identity.id}`) !== null);
  await api("setProvider", { id: "stand-in", kind: "openai", baseUrl: `http://127.0.0.1:${model.port}/v1` });
  for (const role of ["planner", "engineer", "reviewer"]) await api("setRoster", { role, models: [`stand-in/${role}`] });
  for (const id of ["ada", "lin"]) await api("saveTeammate", { id, name: id.toUpperCase(), role: "engineer" });
  await api("saveTeamRoom", { id: "vm-forge", name: "VM Forge", members: ["ada", "lin"] });
});
afterAll(async () => { releaseAlpha?.(); await daemon?.stop(); model.stop(true); rmSync(root, { recursive: true, force: true }); });

test("first task provisions one persistent VM; same-worker tasks serialize and verified dependencies cross workers", async () => {
  expect(runs).toHaveLength(0);
  expect((await snapshot()).teammates.every((member) => member.workspace === null)).toBe(true);
  alphaHold = new Promise<void>((resolve) => { releaseAlpha = resolve; });
  const alpha = (await create("ada", "ALPHA")).task;
  try {
    await until(() => alphaEntered);
    const beta = (await create("ada", "BETA")).task;
    const gamma = (await create("lin", "GAMMA", [alpha.id])).task;
    const held = await snapshot();
    expect(held.tasks.find((item) => item.id === alpha.id)?.status).toBe("running");
    expect(held.tasks.find((item) => item.id === beta.id)?.status).toBe("queued");
    expect(held.tasks.find((item) => item.id === gamma.id)?.status).toBe("queued");
    expect(held.teammates.find((member) => member.id === "lin")?.workspace).toBeNull();
    const bound = held.teammates.find((member) => member.id === "ada")!.workspace!;
    expect(worldWorker("ada")).toMatchObject({ expression: "working", avatar: held.teammates.find((member) => member.id === "ada")!.avatar });
    expect(bound.id).toMatch(/^[0-9a-f]{10}$/);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toContain(`dev.galahad.quest=arm.${teamArmLabel(daemon.identity.id, "ada")}`);
    expect(runs[0]).toContain("dev.galahad.ephemeral=false");
    expect(runs[0]).toContain("dev.galahad.isolation=vm");
    expect(runs[0]).toContain("io.containerd.kata.v2");
    // A UI readiness probe must not become a second writer while this task owns the VM.
    const busy = await api<{ workspace: SandboxView; harnesses: { id: string; ready: boolean }[] }>("teamWorkspace", { id: "ada" });
    expect(busy.workspace.id).toBe(bound.id);
    expect(busy.harnesses.filter((h) => h.id !== "native").every((h) => !h.ready)).toBe(true);
    expect(peak.get(`galahad-sbx-${bound.id}`)).toBe(1);
    releaseAlpha!();
    await until(async () => (await snapshot()).tasks.every((item) => !["queued", "running"].includes(item.status)));
    const finished = await snapshot();
    expect(worldWorker("ada")?.expression).toBe("pleased");
    expect(worldWorker("lin")?.expression).toBe("pleased");
    expect(JSON.stringify(worldWorker("ada"))).not.toContain(summaries.ALPHA!);
    for (const id of [alpha.id, beta.id, gamma.id]) expect(finished.tasks.find((item) => item.id === id)).toMatchObject({ status: "done", verified: true, error: null });
    expect(finished.teammates.find((member) => member.id === "ada")!.workspace).toEqual(bound);
    const other = finished.teammates.find((member) => member.id === "lin")!.workspace!;
    expect(other.id).not.toBe(bound.id);
    expect(runs).toHaveLength(2);
    expect([...peak.values()].every((value) => value === 1)).toBe(true);
    for (const id of [bound.id, other.id]) {
      const activity = events.filter((event) => event.target === `galahad-sbx-${id}`);
      const lease = activity.findIndex((event) => event.kind === "lease");
      expect(activity[0]?.kind).toBe("cleanup");
      expect(lease).toBeGreaterThanOrEqual(0);
      expect(lease).toBeLessThan(activity.findIndex((event) => event.text.includes("mkdir -p")));
    }
    const consumer = prompts.find((body) => body.model === "engineer" && body.messages.some((message) => message.content.startsWith("Quest: TASK_GAMMA")))!;
    expect(JSON.stringify(consumer)).toContain(summaries.ALPHA!);
    expect(JSON.stringify(consumer)).toContain("Verified predecessor results (file paths belong to their original VM)");
    for (const tag of ["ALPHA", "BETA", "GAMMA"]) {
      const review = prompts.find((body) => body.model === "reviewer" && JSON.stringify(body).includes(`TASK_${tag}`))!;
      expect(JSON.stringify(review)).toContain(`gate-${tag.toLowerCase()}`);
      expect(JSON.stringify(review)).toContain("required gate passed");
      const gate = events.findIndex((event) => event.kind === "exec" && event.text.includes(`gate-${tag.toLowerCase()}`));
      expect(gate).toBeGreaterThanOrEqual(0);
      expect(gate).toBeLessThan(events.findIndex((event) => event.kind === "model" && event.target === tag && event.text === "reviewer"));
    }
  } finally { releaseAlpha?.(); }
}, 15000);

test("controller restart keeps the exact VM; failed old-worker cleanup blocks new credentials and work", async () => {
  const binding = (await snapshot()).teammates.find((member) => member.id === "ada")!.workspace;
  await daemon.stop(); daemon = await start();
  expect((await snapshot()).teammates.find((member) => member.id === "ada")!.workspace).toEqual(binding);
  cleanupFailure = true;
  const before = events.length;
  const existingVMs = runs.length;
  try {
    const created = (await create("ada", "CLEANUP")).task;
    await until(async () => !["queued", "running"].includes((await task(created.id)).status));
    const finished = await task(created.id);
    expect(finished.status).toBe("failed");
    expect(finished.verified).toBe(false);
    expect(worldWorker("ada")?.expression).toBe("concerned");
    const attempted = events.slice(before);
    expect(attempted.map((event) => event.kind)).toEqual(["cleanup"]);
    expect(attempted[0]?.target).toBe(`galahad-sbx-${(await snapshot()).teammates.find((member) => member.id === "ada")!.workspace!.id}`);
    expect(runs).toHaveLength(existingVMs);
  } finally { cleanupFailure = false; }
}, 10000);
